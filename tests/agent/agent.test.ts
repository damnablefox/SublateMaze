import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createKernel } from '@sublate/kernel'
import type { AgentApi, SessionApi, ToolsApi } from '@sublate/plugin-sdk'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function loadAgentProfile() {
  const { ctx } = await createKernel(resolve(root, 'tests/fixtures/agent-profile.yml'))
  return {
    ctx,
    agent: ctx.get('agent') as AgentApi,
    sessions: ctx.get('session') as SessionApi,
    tools: ctx.get('tools') as ToolsApi,
  }
}

describe('Agent 循环', () => {
  it('执行三步工具调用并写入完整审计事件', async () => {
    const { agent, sessions } = await loadAgentProfile()

    const result = await agent.run({
      goal: '演示三步任务',
      maxSteps: 6,
      decide: ({ step }) =>
        step < 3
          ? { type: 'tool', tool: 'demo.echo', args: { text: `第 ${step + 1} 步` } }
          : { type: 'done', answer: '完成' },
    })

    expect(result.ok).toBe(true)
    expect(result.answer).toBe('完成')
    expect(result.events.filter((event) => event.type === 'tool_call')).toHaveLength(3)
    expect(result.events.filter((event) => event.type === 'tool_result')).toHaveLength(3)

    const stored = sessions.get(result.sessionId)
    expect(stored?.events).toHaveLength(result.events.length)
  })

  it('write-commit 工具未经确认时拒绝执行', async () => {
    const { agent, tools, sessions } = await loadAgentProfile()
    let executed = false

    tools.register({
      name: 'demo.write',
      description: '写入测试',
      permission: 'write-commit',
      input: z.object({ value: z.number() }),
      execute: () => {
        executed = true
        return '已写入'
      },
    })

    const result = await agent.run({
      goal: '验证确认流程',
      maxSteps: 2,
      decide: () => ({ type: 'tool', tool: 'demo.write', args: { value: 1 } }),
      confirm: () => false,
    })

    expect(result.ok).toBe(false)
    expect(executed).toBe(false)
    expect(result.events.some((event) => event.type === 'confirm')).toBe(true)
    expect(result.events.some((event) => event.type === 'error')).toBe(true)
    expect(sessions.get(result.sessionId)?.events.length).toBe(result.events.length)
  })

  it('超过最大步数后停止并记录错误', async () => {
    const { agent } = await loadAgentProfile()

    const result = await agent.run({
      goal: '无进展任务',
      maxSteps: 2,
      decide: () => ({ type: 'tool', tool: 'demo.echo', args: { text: '循环' } }),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('超过最大步数')
    expect(result.events.filter((event) => event.type === 'tool_call')).toHaveLength(2)
  })
})
