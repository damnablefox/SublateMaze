import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentEvent, SessionApi } from '@sublate/plugin-sdk'

export const name = 'session'
export const inject: string[] = []

interface StoredSession {
  id: string
  goal: string
  createdAt: string
  events: AgentEvent[]
}

/**
 * 会话与事件日志。
 *
 * M0 为内存实现，满足“每次工具调用可回放”；接入 SQLite 后改为写
 * agent_sessions / agent_events 两张表，接口保持不变。
 */
export class SessionService implements SessionApi {
  private readonly sessions = new Map<string, StoredSession>()

  start(goal: string): { id: string; goal: string; createdAt: string } {
    const session: StoredSession = {
      id: randomUUID(),
      goal,
      createdAt: new Date().toISOString(),
      events: [],
    }

    this.sessions.set(session.id, session)
    return { id: session.id, goal: session.goal, createdAt: session.createdAt }
  }

  append(sessionId: string, type: string, payload: unknown): AgentEvent {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在：${sessionId}`)

    const event: AgentEvent = {
      seq: session.events.length + 1,
      type,
      payload,
      createdAt: new Date().toISOString(),
    }

    session.events.push(event)
    return event
  }

  get(sessionId: string): StoredSession | undefined {
    return this.sessions.get(sessionId)
  }

  list(): { id: string; goal: string; createdAt: string; eventCount: number }[] {
    return [...this.sessions.values()].map(session => ({
      id: session.id,
      goal: session.goal,
      createdAt: session.createdAt,
      eventCount: session.events.length,
    }))
  }
}

export function apply(ctx: Context) {
  ctx.provide('session', new SessionService())
  ctx.logger('session').info('会话服务已就绪')
}
