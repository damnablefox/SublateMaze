import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AgentService } from '@sublate/plugin-agent'
import { SessionService } from '@sublate/plugin-session'
import { ToolsService } from '@sublate/plugin-tools'

class ScriptedAi {
  available = true
  calls = 0
  replies: string[]
  usage = { promptTokens: 10, completionTokens: 5 }

  constructor(replies: string[]) {
    this.replies = replies
  }

  async chat() {
    const text = this.replies[this.calls] ?? '{"type":"done","answer":"完成"}'
    this.calls += 1
    return { text, usage: this.usage }
  }
}

function setup(replies: string[], options: { available?: boolean } = {}) {
  const tools = new ToolsService()
  const sessions = new SessionService()
  const ai = new ScriptedAi(replies)
  if (options.available === false) ai.available = false

  const agent = new AgentService(tools, sessions, ai)

  return { tools, sessions, ai, agent }
}

function echoTool(tools: ToolsService, suffix = '') {
  return tools.register({
    name: `demo.echo${suffix}`,
    description: '回显文本',
    permission: 'read',
    input: z.object({ text: z.string() }),
    execute: input => ({ echoed: input.text }),
  })
}

describe('Agent 交互式循环', () => {
  it('无 AI Key 时立即返回明确错误', async () => {
    const { agent, sessions } = setup([], { available: false })

    const step = await agent.start({ goal: '测试无 Key' })

    expect(step.status).toBe('error')
    expect(step.error).toContain('AI API Key')
    expect(sessions.list()[0]?.status).toBe('failed')
  })

  it('逐步执行工具并完成', async () => {
    const { agent, tools } = setup([
      '{"type":"tool","tool":"demo.echo","args":{"text":"第一步"}}',
      '{"type":"tool","tool":"demo.echo","args":{"text":"第二步"}}',
      '{"type":"done","answer":"任务完成"}',
    ])
    echoTool(tools)

    const started = await agent.start({ goal: '演示多步' })
    expect(started.status).toBe('running')
    expect(started.events.some(event => event.type === 'tool_call')).toBe(true)

    const second = await agent.step({ sessionId: started.sessionId })
    expect(second.status).toBe('running')

    const done = await agent.step({ sessionId: started.sessionId })
    expect(done.status).toBe('done')
    expect(done.answer).toBe('任务完成')
    expect(done.events.some(event => event.type === 'done')).toBe(true)
  })

  it('write-commit 工具未确认前不执行', async () => {
    const { agent, tools, sessions } = setup([
      '{"type":"tool","tool":"demo.write","args":{"value":1}}',
      '{"type":"done","answer":"已写入"}',
    ])
    let executed = false

    tools.register({
      name: 'demo.write',
      description: '写入',
      permission: 'write-commit',
      input: z.object({ value: z.number() }),
      execute: () => {
        executed = true
        return 'ok'
      },
    })

    const started = await agent.start({ goal: '验证确认' })
    expect(started.status).toBe('confirm')
    expect(started.pending?.tool).toBe('demo.write')
    expect(executed).toBe(false)

    const rejected = await agent.step({ sessionId: started.sessionId, approved: false })
    expect(rejected.status).toBe('error')
    expect(rejected.error).toContain('用户拒绝')
    expect(executed).toBe(false)
    expect(sessions.get(started.sessionId)?.events.some(event => event.type === 'confirm')).toBe(true)
  })

  it('确认后执行写入并继续', async () => {
    const { agent, tools } = setup([
      '{"type":"tool","tool":"demo.write","args":{"value":2}}',
      '{"type":"done","answer":"ok"}',
    ])
    let executed = false

    tools.register({
      name: 'demo.write',
      description: '写入',
      permission: 'write-commit',
      input: z.object({ value: z.number() }),
      execute: () => {
        executed = true
        return 'ok'
      },
    })

    const started = await agent.start({ goal: '确认后执行' })
    expect(started.status).toBe('confirm')

    const done = await agent.step({ sessionId: started.sessionId, approved: true })

    expect(executed).toBe(true)
    expect(done.status).toBe('done')
  })

  it('超出 token 预算后停止', async () => {
    const { agent, tools } = setup([
      '{"type":"tool","tool":"demo.echo","args":{"text":"一"}}',
      '{"type":"tool","tool":"demo.echo","args":{"text":"二"}}',
    ])
    echoTool(tools)

    const started = await agent.start({ goal: '预算测试', budgetTokens: 20 })
    expect(started.status).toBe('running')
    expect(started.usedTokens).toBe(15)

    const second = await agent.step({ sessionId: started.sessionId })
    expect(second.status).toBe('running')
    expect(second.usedTokens).toBe(30)

    const stopped = await agent.step({ sessionId: started.sessionId })
    expect(stopped.status).toBe('error')
    expect(stopped.error).toContain('预算')
  })

  it('连续两次相同工具与参数时提示无进展', async () => {
    const { agent, tools } = setup([
      '{"type":"tool","tool":"demo.echo","args":{"text":"重复"}}',
      '{"type":"tool","tool":"demo.echo","args":{"text":"重复"}}',
    ])
    echoTool(tools)

    const started = await agent.start({ goal: '无进展检测' })
    expect(started.status).toBe('running')

    const stopped = await agent.step({ sessionId: started.sessionId })
    expect(stopped.status).toBe('error')
    expect(stopped.error).toContain('相同')
  })

  it('取消会话后状态为 cancelled', async () => {
    const { agent, tools, sessions } = setup([
      '{"type":"tool","tool":"demo.write","args":{"value":1}}',
    ])
    tools.register({
      name: 'demo.write',
      description: '写入',
      permission: 'write-commit',
      input: z.object({ value: z.number() }),
      execute: () => 'ok',
    })

    const started = await agent.start({ goal: '取消测试' })
    expect(started.status).toBe('confirm')

    agent.cancel(started.sessionId)

    expect(sessions.get(started.sessionId)?.status).toBe('cancelled')
  })
})
