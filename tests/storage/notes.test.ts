import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-notes-store-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)
  return sqlite
}

function createNote(
  sqlite: SqliteService,
  title: string,
  body = '',
) {
  return sqlite.notes.create({
    title,
    body,
    relPath: `notes/${title}.md`,
  })
}

afterEach(() => {
  for (const service of services.splice(0)) {
    try {
      service.close()
    } catch {
      // 已关闭
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storage-sqlite 笔记仓储', () => {
  it('迁移到版本 9，创建后可读取摘要', () => {
    const sqlite = setup()

    expect((sqlite.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9)

    const note = createNote(sqlite, '线性代数', '# 向量空间\n\n见 [[群论]]')

    expect(note.titleKey).toBe('线性代数')
    expect(note.excerpt).toBe('向量空间 见 群论')
    expect(sqlite.notes.get(note.id)?.body).toContain('[[群论]]')
    expect(sqlite.notes.listSummaries()).toMatchObject([{ id: note.id, linkCount: 0, backlinkCount: 0 }])
  })

  it('活跃笔记同名被拒绝', () => {
    const sqlite = setup()
    createNote(sqlite, 'Linear Algebra')

    expect(() => createNote(sqlite, '  linear   algebra ')).toThrow('同名笔记已存在')
  })

  it('链接解析后反链可见', () => {
    const sqlite = setup()
    const target = createNote(sqlite, '群论')
    const source = createNote(sqlite, '线性代数', '参见 [[群论|对称性]]')

    sqlite.notes.replaceLinks(source.id, [{ targetTitle: '群论', targetKey: '群论' }])
    expect(sqlite.notes.resolveLinks()).toBe(1)

    expect(sqlite.notes.links(source.id)).toMatchObject([
      { targetTitle: '群论', targetNoteId: target.id, targetNoteTitle: '群论' },
    ])
    expect(sqlite.notes.backlinks(target.id)).toMatchObject([
      { noteId: source.id, title: '线性代数', targetTitle: '群论' },
    ])
  })

  it('悬空链接在目标创建后自动接上，删除目标后置空', () => {
    const sqlite = setup()
    const source = createNote(sqlite, '线性代数', '见 [[特征值]]')
    sqlite.notes.replaceLinks(source.id, [{ targetTitle: '特征值', targetKey: '特征值' }])
    sqlite.notes.resolveLinks()

    expect(sqlite.notes.links(source.id)[0]?.targetNoteId).toBeUndefined()

    const target = createNote(sqlite, '特征值')
    sqlite.notes.resolveLinks()
    expect(sqlite.notes.links(source.id)[0]?.targetNoteId).toBe(target.id)
    expect(sqlite.notes.backlinks(target.id)).toHaveLength(1)

    sqlite.notes.remove(target.id)
    sqlite.notes.resolveLinks()
    expect(sqlite.notes.links(source.id)[0]?.targetNoteId).toBeUndefined()
    expect(sqlite.notes.backlinks(target.id)).toHaveLength(0)
  })

  it('保存关联并可按知识点或载体反查', () => {
    const sqlite = setup()
    const note = createNote(sqlite, '线性代数')

    sqlite.notes.replaceRefs(note.id, [
      { refType: 'point', refId: 'point-1' },
      { refType: 'carrier', refId: 'carrier-1' },
    ])

    expect(sqlite.notes.refs(note.id)).toHaveLength(2)
    expect(sqlite.notes.notesForRef('point', 'point-1').map(item => item.id)).toEqual([note.id])
    expect(sqlite.notes.notesForRef('carrier', 'carrier-1').map(item => item.id)).toEqual([note.id])
    expect(sqlite.notes.notesForRef('point', 'point-2')).toEqual([])
  })

  it('软删除进入回收站，恢复后回到列表，彻底删除清理关联', () => {
    const sqlite = setup()
    const target = createNote(sqlite, '群论')
    const source = createNote(sqlite, '线性代数', '见 [[群论]]')
    sqlite.notes.replaceLinks(source.id, [{ targetTitle: '群论', targetKey: '群论' }])
    sqlite.notes.replaceRefs(source.id, [{ refType: 'point', refId: 'point-1' }])
    sqlite.notes.resolveLinks()

    sqlite.notes.remove(target.id)
    expect(sqlite.notes.list().map(note => note.id)).toEqual([source.id])
    expect(sqlite.notes.trash().map(note => note.id)).toEqual([target.id])

    sqlite.notes.restore(target.id)
    expect(sqlite.notes.list()).toHaveLength(2)

    sqlite.notes.remove(source.id)
    sqlite.notes.purge(source.id)
    expect(sqlite.notes.get(source.id)).toBeUndefined()
    expect(
      (sqlite.db.prepare('SELECT COUNT(*) AS count FROM note_links WHERE note_id = ?').get(source.id) as {
        count: number
      }).count,
    ).toBe(0)
    expect(
      (sqlite.db.prepare('SELECT COUNT(*) AS count FROM note_refs WHERE note_id = ?').get(source.id) as {
        count: number
      }).count,
    ).toBe(0)
  })

  it('恢复时与活跃笔记同名则拒绝', () => {
    const sqlite = setup()
    const first = createNote(sqlite, '线性代数')
    sqlite.notes.remove(first.id)
    createNote(sqlite, '线性代数')

    expect(() => sqlite.notes.restore(first.id)).toThrow('同名笔记已存在')
  })

  it('按标题与正文搜索，且只返回活跃笔记', () => {
    const sqlite = setup()
    createNote(sqlite, '线性代数', '向量空间与矩阵')
    createNote(sqlite, '群论', '对称性与置换')
    const deleted = createNote(sqlite, '删除的笔记', '向量')

    sqlite.notes.remove(deleted.id)

    expect(sqlite.notes.list({ query: '向量' }).map(note => note.title)).toEqual(['线性代数'])
    expect(sqlite.notes.list({ query: '对称' }).map(note => note.title)).toEqual(['群论'])
    expect(sqlite.notes.list({ query: '不存在' })).toEqual([])
  })
})
