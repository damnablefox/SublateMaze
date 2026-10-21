import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type AgentSessionStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface AgentSessionRecord {
  id: string
  goal: string
  title: string
  status: AgentSessionStatus
  budgetTokens: number
  usedTokens: number
  answer?: string
  createdAt: string
  updatedAt: string
}

export interface AgentSessionSummary extends AgentSessionRecord {
  eventCount: number
}

export interface AgentEventRecord {
  seq: number
  type: string
  payload: unknown
  createdAt: string
}

export interface AgentSessionDetail {
  session: AgentSessionRecord
  events: AgentEventRecord[]
}

export interface AgentSessionPatch {
  title?: string
  status?: AgentSessionStatus
  budgetTokens?: number
  usedTokens?: number
  answer?: string | null
}

interface SessionRow {
  id: string
  goal: string
  title: string
  status: string
  budget_tokens: number
  used_tokens: number
  answer: string | null
  created_at: string
  updated_at: string
}

interface SummaryRow extends SessionRow {
  event_count: number
}

interface EventRow {
  seq: number
  type: string
  payload_json: string
  created_at: string
}

function mapSession(row: SessionRow): AgentSessionRecord {
  return {
    id: row.id,
    goal: row.goal,
    title: row.title,
    status: row.status as AgentSessionStatus,
    budgetTokens: row.budget_tokens,
    usedTokens: row.used_tokens,
    answer: row.answer ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEvent(row: EventRow): AgentEventRecord {
  let payload: unknown = null

  try {
    payload = JSON.parse(row.payload_json)
  } catch {
    payload = row.payload_json
  }

  return { seq: row.seq, type: row.type, payload, createdAt: row.created_at }
}

/** Agent 会话与事件日志；事件只追加。 */
export class AgentSessionStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  create(goal: string, budgetTokens = 0, title = ''): AgentSessionRecord {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO agent_sessions
           (id, goal, title, status, budget_tokens, used_tokens, answer, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, 0, NULL, ?, ?)`,
      )
      .run(id, goal, title || goal.slice(0, 60), Math.max(0, budgetTokens), timestamp, timestamp)

    return this.getSession(id)!
  }

  getSession(sessionId: string): AgentSessionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, goal, title, status, budget_tokens, used_tokens, answer, created_at, updated_at
         FROM agent_sessions WHERE id = ?`,
      )
      .get(sessionId) as SessionRow | undefined

    return row ? mapSession(row) : undefined
  }

  get(sessionId: string): AgentSessionDetail | undefined {
    const session = this.getSession(sessionId)
    if (!session) return undefined

    const rows = this.db
      .prepare(
        'SELECT seq, type, payload_json, created_at FROM agent_events WHERE session_id = ? ORDER BY seq ASC',
      )
      .all(sessionId) as unknown as EventRow[]

    return { session, events: rows.map(mapEvent) }
  }

  list(limit = 20): AgentSessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.goal, s.title, s.status, s.budget_tokens, s.used_tokens, s.answer,
                s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM agent_events e WHERE e.session_id = s.id) AS event_count
         FROM agent_sessions s
         ORDER BY s.updated_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, limit)) as unknown as SummaryRow[]

    return rows.map(row => ({ ...mapSession(row), eventCount: row.event_count }))
  }

  /** 追加事件；seq 由数据库内当前最大值递增。 */
  append(sessionId: string, type: string, payload: unknown): AgentEventRecord {
    if (!this.getSession(sessionId)) throw new Error('会话不存在')

    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO agent_events (session_id, seq, type, payload_json, created_at)
         SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
         FROM agent_events WHERE session_id = ?`,
      )
      .run(sessionId, type, JSON.stringify(payload), timestamp, sessionId)

    const row = this.db
      .prepare(
        'SELECT seq, type, payload_json, created_at FROM agent_events WHERE session_id = ? ORDER BY seq DESC LIMIT 1',
      )
      .get(sessionId) as unknown as EventRow

    return mapEvent(row)
  }

  update(sessionId: string, patch: AgentSessionPatch): void {
    const current = this.getSession(sessionId)
    if (!current) throw new Error('会话不存在')

    this.db
      .prepare(
        `UPDATE agent_sessions
         SET title = ?, status = ?, budget_tokens = ?, used_tokens = ?, answer = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        patch.status ?? current.status,
        Math.max(0, patch.budgetTokens ?? current.budgetTokens),
        Math.max(0, patch.usedTokens ?? current.usedTokens),
        patch.answer === undefined ? (current.answer ?? null) : patch.answer,
        new Date().toISOString(),
        sessionId,
      )
  }

  remove(sessionId: string): void {
    this.db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId)
  }
}
