import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { NotesService } from '@sublate/plugin-notes'
import { SqliteService } from '@sublate/plugin-storage-sqlite'
import { parse as parseYaml } from 'yaml'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sublate-notes-plugin-'))
  tempDirs.push(root)

  const sqlite = new SqliteService(join(root, '.sublate', 'sublate.db'))
  services.push(sqlite)

  const vault = {
    resolvePath(relativePath: string) {
      const target = resolve(root, relativePath)
      const rel = relative(root, target)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`路径越界：${relativePath}`)
      }
      return target
    },
  }

  return { root, sqlite, notes: new NotesService({ db: sqlite, vault }) }
}

function frontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) throw new Error('frontmatter 缺失')
  return { meta: parseYaml(match[1]!) as Record<string, unknown>, body: match[2]! }
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

describe('notes 插件', () => {
  it('创建笔记写入 Markdown 文件与合法 frontmatter', () => {
    const { root, notes } = setup()
    const detail = notes.create({
      title: '线性代数',
      body: '见 [[群论]]',
      refs: [{ refType: 'point', refId: 'point-1' }],
    })

    expect(detail.note.relPath).toBe('notes/线性代数.md')

    const raw = readFileSync(join(root, detail.note.relPath), 'utf8')
    const { meta, body } = frontmatter(raw)
    expect(meta).toMatchObject({
      sublate_id: detail.note.id,
      title: '线性代数',
      points: ['point-1'],
      carriers: [],
    })
    expect(body.trim()).toBe('见 [[群论]]')

    expect(detail.links).toMatchObject([{ targetTitle: '群论', targetKey: '群论' }])
    expect(detail.links[0]?.targetNoteId).toBeUndefined()
  })

  it('同名笔记被拒绝且不产生新文件', () => {
    const { root, notes } = setup()
    notes.create({ title: 'Linear Algebra' })

    expect(() => notes.create({ title: '  linear   algebra ' })).toThrow('同名笔记已存在')
    expect(readdirSync(join(root, 'notes'))).toHaveLength(1)
  })

  it('重命名笔记后文件迁移且标题键同步', () => {
    const { root, notes } = setup()
    const first = notes.create({ title: '群论', body: '对称' })

    const renamed = notes.update(first.note.id, { title: '抽象代数' })

    expect(renamed.note.titleKey).toBe('抽象代数')
    expect(renamed.note.relPath).toBe('notes/抽象代数.md')
    expect(existsSync(join(root, 'notes/群论.md'))).toBe(false)
    expect(frontmatter(readFileSync(join(root, renamed.note.relPath), 'utf8')).meta.title).toBe('抽象代数')
  })

  it('更新正文重建出链与反链', () => {
    const { notes } = setup()
    const target = notes.create({ title: '群论' })
    const source = notes.create({ title: '线性代数' })

    notes.update(source.note.id, { body: '见 [[群论]] 与 [[特征值]]' })

    const sourceDetail = notes.detail(source.note.id)!
    expect(sourceDetail.links.map(link => link.targetKey)).toEqual(['群论', '特征值'])
    expect(sourceDetail.links[0]?.targetNoteId).toBe(target.note.id)
    expect(notes.detail(target.note.id)?.backlinks).toHaveLength(1)
  })

  it('删除移入回收站，恢复写回 notes 目录', () => {
    const { root, notes } = setup()
    const detail = notes.create({ title: '线性代数', body: '向量空间' })

    notes.remove(detail.note.id)

    expect(notes.list()).toEqual([])
    expect(notes.trash().map(note => note.id)).toEqual([detail.note.id])
    expect(existsSync(join(root, 'notes/线性代数.md'))).toBe(false)
    expect(existsSync(join(root, '.sublate/trash/notes', `${detail.note.id}.md`))).toBe(true)

    const restored = notes.restore(detail.note.id)
    expect(restored.note.relPath).toBe('notes/线性代数.md')
    expect(readFileSync(join(root, restored.note.relPath), 'utf8')).toContain('向量空间')
    expect(existsSync(join(root, '.sublate/trash/notes', `${detail.note.id}.md`))).toBe(false)
  })

  it('恢复时与活跃笔记同名则拒绝且保留回收站文件', () => {
    const { root, notes } = setup()
    const first = notes.create({ title: '线性代数' })
    notes.remove(first.note.id)
    notes.create({ title: '线性代数' })

    expect(() => notes.restore(first.note.id)).toThrow('同名笔记已存在')
    expect(existsSync(join(root, '.sublate/trash/notes', `${first.note.id}.md`))).toBe(true)
  })

  it('磁盘上已有同名文件时改用带后缀的路径', () => {
    const { root, notes } = setup()
    mkdirSync(join(root, 'notes'), { recursive: true })
    writeFileSync(join(root, 'notes/线性代数.md'), '外部创建的文件', 'utf8')

    const detail = notes.create({ title: '线性代数' })

    expect(detail.note.relPath).toBe(`notes/线性代数-${detail.note.id.slice(0, 6)}.md`)
    expect(readFileSync(join(root, 'notes/线性代数.md'), 'utf8')).toBe('外部创建的文件')
  })

  it('关联知识点后可反查，并给出关联选项', () => {
    const { sqlite, notes } = setup()
    const sha256 = 'a'.repeat(64)
    const carrier = sqlite.carriers.create({
      kind: 'pdf',
      title: '线性代数教材',
      sha256,
      relPath: libraryRelPath(sha256, 'pdf'),
      mime: 'application/pdf',
      size: 10,
    })

    sqlite.knowledge.replaceDraft(carrier.id, {
      units: [
        {
          title: '第一章',
          points: [{ title: '向量空间', content: '内容', pageStart: 1, pageEnd: 1 }],
        },
      ],
    })

    const point = sqlite.knowledge.listPoints(carrier.id)[0]!
    const detail = notes.create({
      title: '向量空间笔记',
      refs: [{ refType: 'point', refId: point.id }, { refType: 'carrier', refId: carrier.id }],
    })

    expect(notes.forRef('point', point.id).map(note => note.id)).toEqual([detail.note.id])
    expect(notes.refOptions()).toEqual({
      carriers: [{ id: carrier.id, title: '线性代数教材' }],
      points: [
        {
          id: point.id,
          title: '向量空间',
          carrierId: carrier.id,
          carrierTitle: '线性代数教材',
        },
      ],
    })
  })

  it('彻底删除清理文件与记录', () => {
    const { root, notes } = setup()
    const detail = notes.create({ title: '线性代数' })
    notes.remove(detail.note.id)

    notes.purge(detail.note.id)

    expect(notes.trash()).toEqual([])
    expect(notes.detail(detail.note.id)).toBeUndefined()
    expect(existsSync(join(root, '.sublate/trash/notes', `${detail.note.id}.md`))).toBe(false)
  })

  it('拒绝超过 1 MB 的正文', () => {
    const { notes } = setup()

    expect(() => notes.create({ title: '大笔记', body: 'x'.repeat(1_000_001) })).toThrow('1 MB')
  })
})
