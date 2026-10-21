import type { DatabaseSync } from 'node:sqlite'

export type AiCallKind = 'chat' | 'embedding'
export type AiCallStatus = 'ok' | 'error' | 'cancelled'

export interface AiCallRecord {
  provider: string
  kind: AiCallKind
  model: string
  status: AiCallStatus
  promptTokens?: number
  completionTokens?: number
  durationMs?: number
  error?: string
}

export interface AiCallEntry extends AiCallRecord {
  id: number
  createdAt: string
}

export interface AiStats {
  calls: number
  promptTokens: number
  completionTokens: number
  byKind: Record<AiCallKind, number>
}

interface AiCallRow {
  id: number
  provider: string
  kind: string
  model: string
  status: string
  prompt_tokens: number
  completion_tokens: number
  duration_ms: number
  error: string | null
  created_at: string
}

/** AI 调用记录仓储；成本统计只读取本表。 */
export class AiCallStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  record(input: AiCallRecord): void {
    this.db
      .prepare(
        `INSERT INTO ai_calls
           (provider, kind, model, status, prompt_tokens, completion_tokens, duration_ms, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.provider,
        input.kind,
        input.model,
        input.status,
        input.promptTokens ?? 0,
        input.completionTokens ?? 0,
        input.durationMs ?? 0,
        input.error ?? null,
        new Date().toISOString(),
      )
  }

  stats(options: { since?: string } = {}): AiStats {
    const where = options.since ? 'WHERE created_at >= ?' : ''
    const params = options.since ? [options.since] : []

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) AS completion_tokens
         FROM ai_calls ${where}`,
      )
      .get(...params) as {
      calls: number
      prompt_tokens: number
      completion_tokens: number
    }

    const kinds = this.db
      .prepare(`SELECT kind, COUNT(*) AS count FROM ai_calls ${where} GROUP BY kind`)
      .all(...params) as unknown as { kind: string; count: number }[]

    const byKind: Record<AiCallKind, number> = { chat: 0, embedding: 0 }
    for (const row of kinds) {
      if (row.kind === 'chat' || row.kind === 'embedding') byKind[row.kind] = row.count
    }

    return {
      calls: totals.calls,
      promptTokens: totals.prompt_tokens,
      completionTokens: totals.completion_tokens,
      byKind,
    }
  }

  list(limit = 50): AiCallEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, provider, kind, model, status, prompt_tokens, completion_tokens,
                duration_ms, error, created_at
         FROM ai_calls
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(Math.min(Math.max(limit, 1), 500)) as unknown as AiCallRow[]

    return rows.map(row => ({
      id: row.id,
      provider: row.provider,
      kind: row.kind as AiCallKind,
      model: row.model,
      status: row.status as AiCallStatus,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      durationMs: row.duration_ms,
      error: row.error ?? undefined,
      createdAt: row.created_at,
    }))
  }
}
