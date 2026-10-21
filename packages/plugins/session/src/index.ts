import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentEvent, SessionApi, SessionDetail, SessionSummary } from '@sublate/plugin-sdk'

export const name = 'session'
export const inject: string[] = []

interface StoredSession {
  id: string
  goal: string
  title: string
  status: string
  budgetTokens: number
  usedTokens: number
  answer?: string
  createdAt: string
  updatedAt: string
  events: AgentEvent[]
}

interface EventLike {
  seq: number
  type: string
  payload: unknown
  createdAt: string
}

interface SessionStoreLike {
  create(goal: string, budgetTokens?: number, title?: string): Omit<StoredSession, 'events'>
  append(sessionId: string, type: string, payload: unknown): EventLike
  get(sessionId: string): { session: Omit<StoredSession, 'events'>; events: EventLike[] } | undefined
  list(limit?: number): (Omit<StoredSession, 'events'> & { eventCount: number })[]
  update(
    sessionId: string,
    patch: {
      title?: string
      status?: string
      budgetTokens?: number
      usedTokens?: number
      answer?: string | null
    },
  ): void
}

function toDetail(session: Omit<StoredSession, 'events'>, events: EventLike[]): SessionDetail {
  return { ...session, events: [...events] }
}

/**
 * 会话与事件日志。
 *
 * 有 `db.agentSessions` 时写 SQLite，便于重启后回放；
 * 没有数据库的内核测试回退到内存，接口保持一致。
 */
export class SessionService implements SessionApi {
  private readonly store?: SessionStoreLike
  private readonly sessions = new Map<string, StoredSession>()

  constructor(store?: SessionStoreLike) {
    this.store = store
  }

  start(goal: string, options: { budgetTokens?: number } = {}) {
    if (this.store) {
      const session = this.store.create(goal, options.budgetTokens ?? 0)
      return { id: session.id, goal: session.goal, createdAt: session.createdAt }
    }

    const timestamp = new Date().toISOString()
    const session: StoredSession = {
      id: randomUUID(),
      goal,
      title: goal.slice(0, 60),
      status: 'running',
      budgetTokens: options.budgetTokens ?? 0,
      usedTokens: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      events: [],
    }

    this.sessions.set(session.id, session)
    return { id: session.id, goal: session.goal, createdAt: session.createdAt }
  }

  append(sessionId: string, type: string, payload: unknown): AgentEvent {
    if (this.store) return this.store.append(sessionId, type, payload)

    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在：${sessionId}`)

    const event: AgentEvent = {
      seq: session.events.length + 1,
      type,
      payload,
      createdAt: new Date().toISOString(),
    }

    session.events.push(event)
    session.updatedAt = event.createdAt
    return event
  }

  get(sessionId: string): SessionDetail | undefined {
    if (this.store) {
      const detail = this.store.get(sessionId)
      return detail ? toDetail(detail.session, detail.events) : undefined
    }

    const session = this.sessions.get(sessionId)
    return session ? toDetail(session, session.events) : undefined
  }

  list(limit = 20): SessionSummary[] {
    if (this.store) {
      return this.store.list(limit).map(session => ({ ...session }))
    }

    return [...this.sessions.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(session => ({
        id: session.id,
        goal: session.goal,
        title: session.title,
        status: session.status,
        budgetTokens: session.budgetTokens,
        usedTokens: session.usedTokens,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        eventCount: session.events.length,
      }))
  }

  finish(
    sessionId: string,
    patch: { status?: string; usedTokens?: number; answer?: string },
  ): void {
    if (this.store) {
      this.store.update(sessionId, patch)
      return
    }

    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`会话不存在：${sessionId}`)

    if (patch.status) session.status = patch.status
    if (patch.usedTokens !== undefined) session.usedTokens = patch.usedTokens
    if (patch.answer !== undefined) session.answer = patch.answer
    session.updatedAt = new Date().toISOString()
  }
}

export function apply(ctx: Context) {
  const db = ctx.get('db') as { agentSessions?: SessionStoreLike } | undefined
  ctx.provide('session', new SessionService(db?.agentSessions))
  ctx.logger('session').info(
    db?.agentSessions ? '会话服务已就绪（SQLite 持久化）' : '会话服务已就绪（内存）',
  )
}
