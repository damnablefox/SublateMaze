import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface AiJob {
  id: string
  kind: string
  refId?: string
  status: JobStatus
  progress: number
  resultJson?: string
  error?: string
  promptTokens: number
  completionTokens: number
  createdAt: string
  updatedAt: string
}

export interface CreateJobInput {
  kind: string
  refId?: string
}

export interface AiJobPatch {
  status?: JobStatus
  progress?: number
  resultJson?: string
  error?: string
  promptTokens?: number
  completionTokens?: number
}

interface JobRow {
  id: string
  kind: string
  ref_id: string | null
  status: string
  progress: number
  result_json: string | null
  error: string | null
  prompt_tokens: number
  completion_tokens: number
  created_at: string
  updated_at: string
}

function mapJob(row: JobRow): AiJob {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.ref_id ?? undefined,
    status: row.status as JobStatus,
    progress: row.progress,
    resultJson: row.result_json ?? undefined,
    error: row.error ?? undefined,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** AI 长任务记录：状态、进度、token 与错误。 */
export class AiJobStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  create(input: CreateJobInput): AiJob {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO ai_jobs
           (id, kind, ref_id, status, progress, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(id, input.kind, input.refId ?? null, timestamp, timestamp)

    const job = this.get(id)
    if (!job) throw new Error(`创建任务后无法读回：${id}`)
    return job
  }

  update(id: string, patch: AiJobPatch): void {
    const fields: string[] = []
    const values: (string | number | null)[] = []

    if (patch.status !== undefined) {
      fields.push('status = ?')
      values.push(patch.status)
    }
    if (patch.progress !== undefined) {
      fields.push('progress = ?')
      values.push(Math.min(Math.max(patch.progress, 0), 1))
    }
    if (patch.resultJson !== undefined) {
      fields.push('result_json = ?')
      values.push(patch.resultJson)
    }
    if (patch.error !== undefined) {
      fields.push('error = ?')
      values.push(patch.error.slice(0, 1_000))
    }
    if (patch.promptTokens !== undefined) {
      fields.push('prompt_tokens = ?')
      values.push(patch.promptTokens)
    }
    if (patch.completionTokens !== undefined) {
      fields.push('completion_tokens = ?')
      values.push(patch.completionTokens)
    }

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())

    this.db.prepare(`UPDATE ai_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
  }

  get(id: string): AiJob | undefined {
    const row = this.db
      .prepare(
        `SELECT id, kind, ref_id, status, progress, result_json, error,
                prompt_tokens, completion_tokens, created_at, updated_at
         FROM ai_jobs WHERE id = ?`,
      )
      .get(id) as JobRow | undefined

    return row ? mapJob(row) : undefined
  }

  list(limit = 20): AiJob[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, ref_id, status, progress, result_json, error,
                prompt_tokens, completion_tokens, created_at, updated_at
         FROM ai_jobs
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(Math.min(Math.max(limit, 1), 200)) as unknown as JobRow[]

    return rows.map(mapJob)
  }
}
