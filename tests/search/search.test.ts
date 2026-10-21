import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'
import { makeSnippet, SearchService } from '@sublate/plugin-search'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-search-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const store = sqlite.carriers
  const first = store.create({
    kind: 'pdf',
    title: '认知心理学',
    sha256: 'a'.repeat(64),
    relPath: libraryRelPath('a'.repeat(64), 'pdf'),
    mime: 'application/pdf',
    size: 10,
  })
  store.replacePages(first.id, [
    { pageNo: 1, text: '知识点是学习的最小单位，复习间隔影响记忆保持。' },
    { pageNo: 2, text: 'Machine Learning 与 cognitive psychology 的交集，学习与记忆。' },
  ])

  const second = store.create({
    kind: 'web',
    title: '检索说明',
    sha256: 'b'.repeat(64),
    relPath: libraryRelPath('b'.repeat(64), 'html'),
    mime: 'text/html',
    size: 10,
  })
  store.replacePages(second.id, [{ pageNo: 1, text: '全文检索基于 SQLite FTS5。' }])

  return { sqlite, search: new SearchService(sqlite) }
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

describe('search', () => {
  it('中文短语命中正确页码并带摘要', () => {
    const { search } = setup()

    const hits = search.query('复习间隔')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('认知心理学')
    expect(hits[0]?.pageNo).toBe(1)
    expect(hits[0]?.snippet).toContain('复习间隔')
  })

  it('英文不区分大小写', () => {
    const { search } = setup()

    const hits = search.query('machine learning')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.pageNo).toBe(2)
  })

  it('空查询与纯标点返回空结果', () => {
    const { search } = setup()

    expect(search.query('   ')).toEqual([])
    expect(search.query('，。！')).toEqual([])
  })

  it('回收站中的载体不参与检索', () => {
    const { sqlite, search } = setup()
    const carrier = sqlite.carriers.list().find((item) => item.title === '检索说明')

    sqlite.carriers.softDelete(carrier!.id)

    expect(search.query('FTS5')).toEqual([])
  })

  it('limit 限制返回条数', () => {
    const { search } = setup()

    expect(search.query('学习', 1)).toHaveLength(1)
  })

  it('摘要定位查询词并带前后文', () => {
    const longText = `${'前文'.repeat(100)}目标关键词${'后文'.repeat(100)}`

    const snippet = makeSnippet(longText, '目标关键词', 20)

    expect(snippet).toContain('目标关键词')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })
})
