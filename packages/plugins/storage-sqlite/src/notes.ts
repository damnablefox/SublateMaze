import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { noteExcerpt, normalizeNoteTitle } from '@sublate/core'

export type NoteRefType = 'point' | 'carrier'

export interface NoteRecord {
  id: string
  title: string
  titleKey: string
  body: string
  relPath: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  excerpt: string
}

export interface NoteLinkRecord {
  noteId: string
  targetTitle: string
  targetKey: string
  targetNoteId?: string
  targetNoteTitle?: string
}

export interface NoteBacklink {
  noteId: string
  title: string
  targetTitle: string
  updatedAt: string
  excerpt: string
}

export interface NoteRefRecord {
  noteId: string
  refType: NoteRefType
  refId: string
}

export interface NoteSummary extends NoteRecord {
  linkCount: number
  backlinkCount: number
  refs: NoteRefRecord[]
}

export interface NoteListOptions {
  includeDeleted?: boolean
  onlyDeleted?: boolean
  query?: string
  limit?: number
}

interface NoteRow {
  id: string
  title: string
  title_key: string
  body: string
  rel_path: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  link_count: number
  backlink_count: number
}

interface LinkRow {
  note_id: string
  target_title: string
  target_key: string
  target_note_id: string | null
  target_note_title: string | null
}

interface BacklinkRow {
  id: string
  title: string
  updated_at: string
  body: string
  target_title: string
}

interface RefRow {
  note_id: string
  ref_type: string
  ref_id: string
}

const NOTE_SELECT = `
  SELECT n.*,
    (SELECT COUNT(*) FROM note_links l WHERE l.note_id = n.id) AS link_count,
    (SELECT COUNT(*) FROM note_links l WHERE l.target_note_id = n.id) AS backlink_count
  FROM notes n
`

function mapNote(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    title: row.title,
    titleKey: row.title_key,
    body: row.body,
    relPath: row.rel_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    excerpt: noteExcerpt(row.body),
  }
}

function mapSummary(row: NoteRow, refs: NoteRefRecord[]): NoteSummary {
  return {
    ...mapNote(row),
    linkCount: row.link_count,
    backlinkCount: row.backlink_count,
    refs,
  }
}

/** 笔记关系存储；只由 storage-sqlite 持有连接。 */
export class NoteStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  create(input: { id?: string; title: string; body?: string; relPath: string }): NoteRecord {
    const id = input.id ?? randomUUID()
    const now = new Date().toISOString()
    const title = input.title.trim()

    try {
      this.db
        .prepare(
          `INSERT INTO notes (id, title, title_key, body, rel_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, title, normalizeNoteTitle(title), input.body ?? '', input.relPath, now, now)
    } catch (error) {
      throw this.translateUnique(error, title)
    }

    return this.get(id)!
  }

  update(
    id: string,
    patch: { title?: string; body?: string; relPath?: string },
  ): void {
    const current = this.getRow(id)
    if (!current) throw new Error(`笔记不存在：${id}`)

    const title = patch.title?.trim() ?? current.title

    try {
      this.db
        .prepare(
          `UPDATE notes SET title = ?, title_key = ?, body = ?, rel_path = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          title,
          normalizeNoteTitle(title),
          patch.body ?? current.body,
          patch.relPath ?? current.rel_path,
          new Date().toISOString(),
          id,
        )
    } catch (error) {
      throw this.translateUnique(error, title)
    }
  }

  get(id: string): NoteRecord | undefined {
    const row = this.db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(id) as NoteRow | undefined
    return row ? mapNote(row) : undefined
  }

  getRow(id: string): NoteRow | undefined {
    return this.db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(id) as NoteRow | undefined
  }

  getByTitleKey(key: string): NoteRecord | undefined {
    const row = this.db
      .prepare(`${NOTE_SELECT} WHERE n.title_key = ? AND n.deleted_at IS NULL`)
      .get(key) as NoteRow | undefined
    return row ? mapNote(row) : undefined
  }

  list(options: NoteListOptions = {}): NoteRecord[] {
    return this.queryRows(options).map(mapNote)
  }

  listSummaries(options: NoteListOptions = {}): NoteSummary[] {
    return this.queryRows(options).map(row => mapSummary(row, this.refs(row.id)))
  }

  trash(): NoteSummary[] {
    return this.listSummaries({ onlyDeleted: true })
  }

  private queryRows(options: NoteListOptions = {}): NoteRow[] {
    const conditions: string[] = []
    const params: string[] = []

    if (options.onlyDeleted) {
      conditions.push('n.deleted_at IS NOT NULL')
    } else if (!options.includeDeleted) {
      conditions.push('n.deleted_at IS NULL')
    }

    if (options.query?.trim()) {
      const pattern = `%${options.query.trim().replace(/[!%_]/g, ch => `!${ch}`)}%`
      conditions.push('(n.title LIKE ? ESCAPE char(33) OR n.body LIKE ? ESCAPE char(33))')
      params.push(pattern, pattern)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = options.limit && options.limit > 0 ? `LIMIT ${Math.floor(options.limit)}` : ''

    return this.db
      .prepare(`${NOTE_SELECT} ${where} ORDER BY n.updated_at DESC ${limit}`)
      .all(...params) as unknown as NoteRow[]
  }

  countLinks(noteId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM note_links WHERE note_id = ?')
      .get(noteId) as { count: number }
    return row.count
  }

  countBacklinks(noteId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM note_links WHERE target_note_id = ?')
      .get(noteId) as { count: number }
    return row.count
  }

  remove(id: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, now, id)
  }

  restore(id: string): void {
    const row = this.db
      .prepare('SELECT title FROM notes WHERE id = ? AND deleted_at IS NOT NULL')
      .get(id) as { title: string } | undefined
    if (!row) throw new Error(`回收站中找不到笔记：${id}`)

    const conflict = this.getByTitleKey(normalizeNoteTitle(row.title))
    if (conflict && conflict.id !== id) {
      throw new Error(`同名笔记已存在：${row.title}`)
    }

    try {
      this.db
        .prepare('UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id)
    } catch (error) {
      throw this.translateUnique(error, row.title)
    }
  }

  purge(id: string): void {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
  }

  replaceLinks(
    noteId: string,
    links: { targetTitle: string; targetKey: string }[],
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO note_links (note_id, target_title, target_key)
       VALUES (?, ?, ?)
       ON CONFLICT(note_id, target_key) DO UPDATE SET target_title = excluded.target_title`,
    )

    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM note_links WHERE note_id = ?').run(noteId)
      for (const link of links) {
        insert.run(noteId, link.targetTitle, link.targetKey)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  replaceRefs(noteId: string, refs: { refType: NoteRefType; refId: string }[]): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO note_refs (note_id, ref_type, ref_id) VALUES (?, ?, ?)',
    )

    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM note_refs WHERE note_id = ?').run(noteId)
      for (const ref of refs) {
        insert.run(noteId, ref.refType, ref.refId)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  links(noteId: string): NoteLinkRecord[] {
    const rows = this.db
      .prepare(
        `SELECT l.note_id, l.target_title, l.target_key, l.target_note_id,
                t.title AS target_note_title
         FROM note_links l
         LEFT JOIN notes t ON t.id = l.target_note_id
         WHERE l.note_id = ?
         ORDER BY l.rowid`,
      )
      .all(noteId) as unknown as LinkRow[]

    return rows.map(row => ({
      noteId: row.note_id,
      targetTitle: row.target_title,
      targetKey: row.target_key,
      targetNoteId: row.target_note_id ?? undefined,
      targetNoteTitle: row.target_note_title ?? undefined,
    }))
  }

  backlinks(noteId: string): NoteBacklink[] {
    const rows = this.db
      .prepare(
        `SELECT n.id, n.title, n.updated_at, n.body, l.target_title
         FROM note_links l
         JOIN notes n ON n.id = l.note_id
         WHERE l.target_note_id = ? AND n.deleted_at IS NULL
         ORDER BY n.updated_at DESC`,
      )
      .all(noteId) as unknown as BacklinkRow[]

    return rows.map(row => ({
      noteId: row.id,
      title: row.title,
      targetTitle: row.target_title,
      updatedAt: row.updated_at,
      excerpt: noteExcerpt(row.body),
    }))
  }

  refs(noteId: string): NoteRefRecord[] {
    const rows = this.db
      .prepare(
        'SELECT note_id, ref_type, ref_id FROM note_refs WHERE note_id = ? ORDER BY ref_type, ref_id',
      )
      .all(noteId) as unknown as RefRow[]

    return rows.map(row => ({
      noteId: row.note_id,
      refType: row.ref_type as NoteRefType,
      refId: row.ref_id,
    }))
  }

  notesForRef(refType: NoteRefType, refId: string): NoteRecord[] {
    const rows = this.db
      .prepare(
        `${NOTE_SELECT}
         JOIN note_refs r ON r.note_id = n.id
         WHERE r.ref_type = ? AND r.ref_id = ? AND n.deleted_at IS NULL
         ORDER BY n.updated_at DESC`,
      )
      .all(refType, refId) as unknown as NoteRow[]

    return rows.map(mapNote)
  }

  /** 按标题回填所有出链的目标 id；目标被删除时自动置空。 */
  resolveLinks(): number {
    const result = this.db
      .prepare(
        `UPDATE note_links
         SET target_note_id = (
           SELECT n.id FROM notes n
           WHERE n.title_key = note_links.target_key AND n.deleted_at IS NULL
           LIMIT 1
         )`,
      )
      .run()

    return Number(result.changes)
  }

  private translateUnique(error: unknown, title: string): Error {
    if (String(error).includes('UNIQUE')) {
      return new Error(`同名笔记已存在：${title}`)
    }
    return error instanceof Error ? error : new Error(String(error))
  }
}
