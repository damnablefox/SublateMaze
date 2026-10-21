import type { Context } from '@deepseek-ai/cordis'
import type {
  AgentApi,
  AgentDecision,
  AgentEvent,
  AgentRunOptions,
  AgentRunResult,
  SessionApi,
  ToolsApi,
} from '@sublate/plugin-sdk'

export const name = 'agent'
export const inject = ['tools', 'session']

/**
 * 学习辅助 Agent 的最小循环。
 *
 * M0 不接真实模型：决策由调用方注入的 `decide` 提供（测试、脚本或后续
 * ai-provider 插件）。循环、工具调用、确认与审计是真实的。
 */
export class AgentService implements AgentApi {
  private readonly tools: ToolsApi
  private readonly sessions: SessionApi

  constructor(tools: ToolsApi, sessions: SessionApi) {
    this.tools = tools
    this.sessions = sessions
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const maxSteps = options.maxSteps ?? 12
    const session = this.sessions.start(options.goal)
    const history: AgentEvent[] = []

    const record = (type: string, payload: unknown): AgentEvent => {
      const event = this.sessions.append(session.id, type, payload)
      history.push(event)
      return event
    }

    for (let step = 0; step < maxSteps; step += 1) {
      let decision: AgentDecision

      try {
        decision = await options.decide({ step, history })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        record('error', { stage: 'decide', message })
        return { sessionId: session.id, ok: false, error: message, events: history }
      }

      if (decision.type === 'done') {
        record('done', { answer: decision.answer })
        return {
          sessionId: session.id,
          ok: true,
          answer: decision.answer,
          events: history,
        }
      }

      record('turn', { step, tool: decision.tool })

      const info = this.tools.list().find(tool => tool.name === decision.tool)
      if (!info) {
        record('error', { stage: 'lookup', message: `未知工具：${decision.tool}` })
        return {
          sessionId: session.id,
          ok: false,
          error: `未知工具：${decision.tool}`,
          events: history,
        }
      }

      let confirmed = false
      if (info.permission === 'write-commit' || info.permission === 'dangerous') {
        record('confirm', { tool: decision.tool, args: decision.args })
        confirmed = (await options.confirm?.(decision.tool, decision.args)) ?? false

        if (!confirmed) {
          const message = `用户未确认工具：${decision.tool}`
          record('error', { stage: 'confirm', message })
          return { sessionId: session.id, ok: false, error: message, events: history }
        }
      }

      record('tool_call', { tool: decision.tool, args: decision.args })

      try {
        const result = await this.tools.invoke(decision.tool, decision.args, {
          sessionId: session.id,
          confirmed,
        })
        record('tool_result', { tool: decision.tool, result })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        record('error', { stage: 'invoke', tool: decision.tool, message })
        return { sessionId: session.id, ok: false, error: message, events: history }
      }
    }

    const message = `超过最大步数（${maxSteps}）`
    record('error', { stage: 'limit', message })
    return { sessionId: session.id, ok: false, error: message, events: history }
  }
}

export function apply(ctx: Context) {
  const tools = ctx.get('tools') as ToolsApi
  const sessions = ctx.get('session') as SessionApi

  ctx.provide('agent', new AgentService(tools, sessions))
  ctx.logger('agent').info('Agent 循环已就绪')
}
