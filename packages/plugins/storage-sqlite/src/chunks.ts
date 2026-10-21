import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ChunkDraft } from '@sublate/core'

export type ChunkStatus = 'pending' | 'indexed' | 'failed'

export interface Chunk {
  id: string
  carrierId: string
  pageNo: number
  chunkNo: number
  text: string
  status: ChunkStatus
  model?: string
  error?: string
}

export interface ChunkWithTitle extends Chunk {
  title: string
}

export interface ChunkStats {
  total: number
  indexed: number
  pending: number
  failed: number
}

interface ChunkRow {
  id: string
  carrier_id: string
  page_no: number
  chunk_no: number
  text: string
  embedding_status: string
  embedding_model: string | null
  error: string | null
  title?: string
}

function mapChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    carrierId: row.carrier_id,
    pageNo: row.page_no,
    chunkNo: row.chunk_no,
    text: row.text,
    status: row.embedding_status as ChunkStatus,
    model: row.embedding_model ?? undefined,
    error: row.error ?? undefined,
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/** 载体 chunk 仓储与 embedding 状态；向量本体在 LanceDB。 */
export class ChunkStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** 整体替换某个载体的 chunk，旧状态随旧行一起清除。 */
  replaceChunks(carrierId: string, drafts: ChunkDraft[]): Chunk[] {
    const timestamp = new Date().toISOString()
    const created: Chunk[] = []

    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM carrier_chunks WHERE carrier_id = ?').run(carrierId)

      const insert = this.db.prepare(
        `INSERT INTO carrier_chunks
           (id, carrier_id, page_no, chunk_no, text, embedding_status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )

      for (const draft of drafts) {
        const id = randomUUID()
        insert.run(id, carrierId, draft.pageNo, draft.chunkNo, draft.text, timestamp)
        created.push({
          id,
          carrierId,
          pageNo: draft.pageNo,
          chunkNo: draft.chunkNo,
          text: draft.text,
          status: 'pending',
        })
      }

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return created
  }

  listChunks(carrierId: string): Chunk[] {
    const rows = this.db
      .prepare(
        `SELECT id, carrier_id, page_no, chunk_no, text, embedding_status, embedding_model, error
         FROM carrier_chunks
         WHERE carrier_id = ?
         ORDER BY page_no ASC, chunk_no ASC`,
      )
      .all(carrierId) as unknown as ChunkRow[]

    return rows.map(mapChunk)
  }

  listPendingChunks(limit = 100): Chunk[] {
    const rows = this.db
      .prepare(
        `SELECT id, carrier_id, page_no, chunk_no, text, embedding_status, embedding_model, error
         FROM carrier_chunks
         WHERE embedding_status = 'pending'
         ORDER BY carrier_id ASC, page_no ASC, chunk_no ASC
         LIMIT ?`,
      )
      .all(Math.min(Math.max(limit, 1), 1_000)) as unknown as ChunkRow[]

    return rows.map(mapChunk)
  }

  /** 按 id 批量取回 chunk，并过滤回收站中的载体。 */
  getChunksByIds(ids: string[]): ChunkWithTitle[] {
    if (ids.length === 0) return []

    const rows = this.db
      .prepare(
        `SELECT k.id, k.carrier_id, k.page_no, k.chunk_no, k.text,
                k.embedding_status, k.embedding_model, k.error, c.title
         FROM carrier_chunks k
         JOIN carriers c ON c.id = k.carrier_id
         WHERE k.id IN (${placeholders(ids.length)}) AND c.deleted_at IS NULL`,
      )
      .all(...ids) as unknown as ChunkRow[]

    return rows.map(row => ({ ...mapChunk(row), title: row.title ?? '' }))
  }

  markChunksIndexed(ids: string[], model: string): void {
    if (ids.length === 0) return

    this.db
      .prepare(
        `UPDATE carrier_chunks
         SET embedding_status = 'indexed', embedding_model = ?, error = NULL, updated_at = ?
         WHERE id IN (${placeholders(ids.length)})`,
      )
      .run(model, new Date().toISOString(), ...ids)
  }

  markChunksFailed(ids: string[], error: string): void {
    if (ids.length === 0) return

    this.db
      .prepare(
        `UPDATE carrier_chunks
         SET embedding_status = 'failed', error = ?, updated_at = ?
         WHERE id IN (${placeholders(ids.length)})`,
      )
      .run(error.slice(0, 500), new Date().toISOString(), ...ids)
  }

  /** 模型变化后把非当前模型的 chunk 重新置为待索引。 */
  resetChunksForModel(model: string): number {
    const result = this.db
      .prepare(
        `UPDATE carrier_chunks
         SET embedding_status = 'pending', embedding_model = NULL, error = NULL, updated_at = ?
         WHERE embedding_model IS NULL OR embedding_model != ?`,
      )
      .run(new Date().toISOString(), model)

    return Number(result.changes)
  }

  chunkStats(): ChunkStats {
    const rows = this.db
      .prepare('SELECT embedding_status AS status, COUNT(*) AS count FROM carrier_chunks GROUP BY embedding_status')
      .all() as unknown as { status: string; count: number }[]

    const stats: ChunkStats = { total: 0, indexed: 0, pending: 0, failed: 0 }
    for (const row of rows) {
      stats.total += row.count
      if (row.status === 'indexed') stats.indexed = row.count
      else if (row.status === 'pending') stats.pending = row.count
      else if (row.status === 'failed') stats.failed = row.count
    }

    return stats
  }
}
