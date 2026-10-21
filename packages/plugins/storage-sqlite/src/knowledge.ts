import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type KnowledgeStatus = 'draft' | 'confirmed' | 'rejected'

export interface KnowledgeUnit {
  id: string
  carrierId: string
  title: string
  pageStart?: number
  pageEnd?: number
  status: 'draft' | 'confirmed'
  source: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface KnowledgePoint {
  id: string
  unitId?: string
  carrierId: string
  title: string
  content: string
  pageStart: number
  pageEnd: number
  status: KnowledgeStatus
  source: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface PointDraft {
  title: string
  content: string
  pageStart: number
  pageEnd: number
}

export interface UnitDraft {
  title: string
  pageStart?: number
  pageEnd?: number
  points: PointDraft[]
}

export interface KnowledgeDraft {
  units: UnitDraft[]
}

export interface PointStats {
  total: number
  draft: number
  confirmed: number
  rejected: number
}

interface UnitRow {
  id: string
  carrier_id: string
  title: string
  page_start: number | null
  page_end: number | null
  status: string
  source: string
  created_at: string
  updated_at: string
}

interface PointRow {
  id: string
  unit_id: string | null
  carrier_id: string
  title: string
  content: string
  page_start: number
  page_end: number
  status: string
  source: string
  created_at: string
  updated_at: string
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function mapUnit(row: UnitRow): KnowledgeUnit {
  return {
    id: row.id,
    carrierId: row.carrier_id,
    title: row.title,
    pageStart: row.page_start ?? undefined,
    pageEnd: row.page_end ?? undefined,
    status: row.status as KnowledgeUnit['status'],
    source: row.source as KnowledgeUnit['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapPoint(row: PointRow): KnowledgePoint {
  return {
    id: row.id,
    unitId: row.unit_id ?? undefined,
    carrierId: row.carrier_id,
    title: row.title,
    content: row.content,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    status: row.status as KnowledgeStatus,
    source: row.source as KnowledgePoint['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 知识单元与知识点仓储；抽取结果始终以草稿写入。 */
export class KnowledgeStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * 替换某载体的草稿：保留已确认/已拒绝的知识点，
   * 清空无剩余知识点的草稿单元。
   */
  replaceDraft(carrierId: string, draft: KnowledgeDraft): void {
    const timestamp = new Date().toISOString()

    this.db.exec('BEGIN')
    try {
      this.db
        .prepare("DELETE FROM knowledge_points WHERE carrier_id = ? AND status = 'draft'")
        .run(carrierId)

      this.db
        .prepare(
          `DELETE FROM knowledge_units
           WHERE carrier_id = ? AND status = 'draft'
             AND id NOT IN (
               SELECT DISTINCT unit_id FROM knowledge_points
               WHERE carrier_id = ? AND unit_id IS NOT NULL
             )`,
        )
        .run(carrierId, carrierId)

      const insertUnit = this.db.prepare(
        `INSERT INTO knowledge_units
           (id, carrier_id, title, page_start, page_end, status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', 'ai', ?, ?)`,
      )
      const insertPoint = this.db.prepare(
        `INSERT INTO knowledge_points
           (id, unit_id, carrier_id, title, content, page_start, page_end, status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'ai', ?, ?)`,
      )

      for (const unit of draft.units) {
        const unitId = randomUUID()
        insertUnit.run(
          unitId,
          carrierId,
          unit.title,
          unit.pageStart ?? null,
          unit.pageEnd ?? null,
          timestamp,
          timestamp,
        )

        for (const point of unit.points) {
          insertPoint.run(
            randomUUID(),
            unitId,
            carrierId,
            point.title,
            point.content,
            point.pageStart,
            point.pageEnd,
            timestamp,
            timestamp,
          )
        }
      }

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listUnits(carrierId: string): KnowledgeUnit[] {
    const rows = this.db
      .prepare(
        `SELECT id, carrier_id, title, page_start, page_end, status, source, created_at, updated_at
         FROM knowledge_units
         WHERE carrier_id = ?
         ORDER BY COALESCE(page_start, 0) ASC, created_at ASC`,
      )
      .all(carrierId) as unknown as UnitRow[]

    return rows.map(mapUnit)
  }

  listPoints(carrierId: string, options: { status?: KnowledgeStatus } = {}): KnowledgePoint[] {
    const where = options.status ? 'AND status = ?' : ''
    const params = options.status ? [carrierId, options.status] : [carrierId]

    const rows = this.db
      .prepare(
        `SELECT id, unit_id, carrier_id, title, content, page_start, page_end,
                status, source, created_at, updated_at
         FROM knowledge_points
         WHERE carrier_id = ? ${where}
         ORDER BY page_start ASC, created_at ASC`,
      )
      .all(...params) as unknown as PointRow[]

    return rows.map(mapPoint)
  }

  confirmPoints(ids: string[]): void {
    this.updateStatus(ids, 'confirmed')
  }

  rejectPoints(ids: string[]): void {
    this.updateStatus(ids, 'rejected')
  }

  updatePointAnchor(id: string, pageStart: number, pageEnd: number): void {
    this.db
      .prepare(
        'UPDATE knowledge_points SET page_start = ?, page_end = ?, updated_at = ? WHERE id = ?',
      )
      .run(pageStart, Math.max(pageStart, pageEnd), new Date().toISOString(), id)
  }

  pointStats(carrierId: string): PointStats {
    const rows = this.db
      .prepare(
        'SELECT status, COUNT(*) AS count FROM knowledge_points WHERE carrier_id = ? GROUP BY status',
      )
      .all(carrierId) as unknown as { status: string; count: number }[]

    const stats: PointStats = { total: 0, draft: 0, confirmed: 0, rejected: 0 }
    for (const row of rows) {
      stats.total += row.count
      if (row.status === 'draft') stats.draft = row.count
      else if (row.status === 'confirmed') stats.confirmed = row.count
      else if (row.status === 'rejected') stats.rejected = row.count
    }

    return stats
  }

  private updateStatus(ids: string[], status: 'confirmed' | 'rejected'): void {
    if (ids.length === 0) return

    this.db
      .prepare(
        `UPDATE knowledge_points
         SET status = ?, updated_at = ?
         WHERE id IN (${placeholders(ids.length)})`,
      )
      .run(status, new Date().toISOString(), ...ids)
  }
}
