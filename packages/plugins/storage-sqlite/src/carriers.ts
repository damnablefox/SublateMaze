import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { segmentCjk, type CarrierKind } from '@sublate/core'

export type CarrierStatus = 'pending' | 'parsing' | 'ready' | 'failed'

export interface CarrierFile {
  sha256: string
  relPath: string
  mime: string
  size: number
}

export interface Carrier {
  id: string
  kind: CarrierKind
  title: string
  authors: string[]
  sourceUrl?: string
  language?: string
  pageCount: number
  status: CarrierStatus
  error?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  file: CarrierFile
}

export interface CreateCarrierInput {
  kind: CarrierKind
  title: string
  authors?: string[]
  sourceUrl?: string
  language?: string
  sha256: string
  relPath: string
  mime: string
  size: number
}

export interface PageText {
  pageNo: number
  text: string
}

export interface ReadState {
  pageNo: number
  scrollRatio: number
}

export interface SearchPageHit {
  carrierId: string
  title: string
  pageNo: number
  text: string
}

interface CarrierRow {
  id: string
  kind: string
  title: string
  authors_json: string
  source_url: string | null
  language: string | null
  page_count: number
  status: string
  error: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  sha256: string
  rel_path: string
  mime: string
  size: number
}

const CARRIER_SELECT = `
  SELECT c.*, f.sha256, f.rel_path, f.mime, f.size
  FROM carriers c
  JOIN carrier_files f ON f.carrier_id = c.id
`

function mapCarrier(row: CarrierRow): Carrier {
  return {
    id: row.id,
    kind: row.kind as CarrierKind,
    title: row.title,
    authors: JSON.parse(row.authors_json) as string[],
    sourceUrl: row.source_url ?? undefined,
    language: row.language ?? undefined,
    pageCount: row.page_count,
    status: row.status as CarrierStatus,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    file: {
      sha256: row.sha256,
      relPath: row.rel_path,
      mime: row.mime,
      size: row.size,
    },
  }
}

/**
 * 知识载体仓储。
 *
 * 所有 SQL 都集中在这里，其他插件通过 `ctx.db.carriers` 使用，
 * 保持「只有 storage-sqlite 写 SQLite」的边界。
 */
export class CarrierStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  private now(): string {
    return new Date().toISOString()
  }

  create(input: CreateCarrierInput): Carrier {
    const id = randomUUID()
    const timestamp = this.now()

    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO carriers
             (id, kind, title, authors_json, source_url, language, page_count, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
        )
        .run(
          id,
          input.kind,
          input.title,
          JSON.stringify(input.authors ?? []),
          input.sourceUrl ?? null,
          input.language ?? null,
          timestamp,
          timestamp,
        )

      this.db
        .prepare(
          `INSERT INTO carrier_files (carrier_id, sha256, rel_path, mime, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.sha256, input.relPath, input.mime, input.size, timestamp)

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    const created = this.get(id)
    if (!created) throw new Error(`创建载体后无法读回：${id}`)
    return created
  }

  get(id: string): Carrier | undefined {
    const row = this.db
      .prepare(`${CARRIER_SELECT} WHERE c.id = ?`)
      .get(id) as CarrierRow | undefined

    return row ? mapCarrier(row) : undefined
  }

  /** 按内容哈希查找，包含回收站中的载体，便于重复导入时直接恢复。 */
  findBySha256(sha256: string): Carrier | undefined {
    const row = this.db
      .prepare(`${CARRIER_SELECT} WHERE f.sha256 = ?`)
      .get(sha256) as CarrierRow | undefined

    return row ? mapCarrier(row) : undefined
  }

  list(options: { includeDeleted?: boolean } = {}): Carrier[] {
    const sql = options.includeDeleted
      ? `${CARRIER_SELECT} ORDER BY c.created_at DESC`
      : `${CARRIER_SELECT} WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC`

    return (this.db.prepare(sql).all() as unknown as CarrierRow[]).map(mapCarrier)
  }

  /** 回收站：只返回已软删除的载体，最近删除的在前。 */
  listTrash(): Carrier[] {
    const rows = this.db
      .prepare(`${CARRIER_SELECT} WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC`)
      .all() as unknown as CarrierRow[]

    return rows.map(mapCarrier)
  }

  setStatus(id: string, status: CarrierStatus, error?: string): void {
    this.db
      .prepare('UPDATE carriers SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, error ?? null, this.now(), id)
  }

  rename(id: string, title: string): void {
    this.db
      .prepare('UPDATE carriers SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, this.now(), id)
  }

  /** 整体替换页文本与索引；导入与重新解析共用同一条路径。 */
  replacePages(carrierId: string, pages: PageText[]): void {
    const timestamp = this.now()

    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM carrier_pages WHERE carrier_id = ?').run(carrierId)
      this.db.prepare('DELETE FROM carrier_pages_fts WHERE carrier_id = ?').run(carrierId)

      const insertPage = this.db.prepare(
        'INSERT INTO carrier_pages (carrier_id, page_no, text) VALUES (?, ?, ?)',
      )
      const insertIndex = this.db.prepare(
        'INSERT INTO carrier_pages_fts (body, carrier_id, page_no) VALUES (?, ?, ?)',
      )

      for (const page of pages) {
        insertPage.run(carrierId, page.pageNo, page.text)
        insertIndex.run(segmentCjk(page.text), carrierId, page.pageNo)
      }

      this.db
        .prepare('UPDATE carriers SET page_count = ?, updated_at = ? WHERE id = ?')
        .run(pages.length, timestamp, carrierId)

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getPageCount(carrierId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM carrier_pages WHERE carrier_id = ?')
      .get(carrierId) as { count: number } | undefined

    return row?.count ?? 0
  }

  getPages(carrierId: string, from: number, to: number): PageText[] {
    const rows = this.db
      .prepare(
        `SELECT page_no, text FROM carrier_pages
         WHERE carrier_id = ? AND page_no BETWEEN ? AND ?
         ORDER BY page_no ASC`,
      )
      .all(carrierId, from, to) as unknown as { page_no: number; text: string }[]

    return rows.map((row) => ({ pageNo: row.page_no, text: row.text }))
  }

  getReadState(carrierId: string): ReadState | undefined {
    const row = this.db
      .prepare('SELECT page_no, scroll_ratio FROM carrier_read_state WHERE carrier_id = ?')
      .get(carrierId) as { page_no: number; scroll_ratio: number } | undefined

    return row ? { pageNo: row.page_no, scrollRatio: row.scroll_ratio } : undefined
  }

  saveReadState(carrierId: string, pageNo: number, scrollRatio: number): void {
    this.db
      .prepare(
        `INSERT INTO carrier_read_state (carrier_id, page_no, scroll_ratio, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(carrier_id) DO UPDATE SET
           page_no = excluded.page_no,
           scroll_ratio = excluded.scroll_ratio,
           updated_at = excluded.updated_at`,
      )
      .run(carrierId, Math.max(1, Math.trunc(pageNo)), scrollRatio, this.now())
  }

  softDelete(id: string): void {
    this.db
      .prepare('UPDATE carriers SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(this.now(), this.now(), id)
  }

  restore(id: string): void {
    this.db
      .prepare('UPDATE carriers SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(this.now(), id)
  }

  /** 执行 FTS5 MATCH 查询，只返回未删除载体的命中页。 */
  searchPages(match: string, limit = 20): SearchPageHit[] {
    const rows = this.db
      .prepare(
        `SELECT carrier_pages_fts.carrier_id,
                carrier_pages_fts.page_no,
                c.title,
                COALESCE(p.text, '') AS text
         FROM carrier_pages_fts
         JOIN carriers c ON c.id = carrier_pages_fts.carrier_id
         LEFT JOIN carrier_pages p
           ON p.carrier_id = carrier_pages_fts.carrier_id
          AND p.page_no = carrier_pages_fts.page_no
         WHERE carrier_pages_fts MATCH ? AND c.deleted_at IS NULL
         ORDER BY bm25(carrier_pages_fts)
         LIMIT ?`,
      )
      .all(match, limit) as unknown as {
      carrier_id: string
      page_no: number
      title: string
      text: string
    }[]

    return rows.map((row) => ({
      carrierId: row.carrier_id,
      title: row.title,
      pageNo: row.page_no,
      text: row.text,
    }))
  }
}
