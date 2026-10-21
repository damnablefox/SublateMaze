import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chunkPages, libraryRelPath } from '@sublate/core'
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
  const firstChunks = sqlite.chunks.replaceChunks(first.id, chunkPages([
    { pageNo: 1, text: '知识点是学习的最小单位，复习间隔影响记忆保持。' },
    { pageNo: 2, text: 'Machine Learning 与 cognitive psychology 的交集，学习与记忆。' },
  ]))

  const second = store.create({
    kind: 'web',
    title: '检索说明',
    sha256: 'b'.repeat(64),
    relPath: libraryRelPath('b'.repeat(64), 'html'),
    mime: 'text/html',
    size: 10,
  })
  store.replacePages(second.id, [{ pageNo: 1, text: '全文检索基于 SQLite FTS5。' }])
  sqlite.chunks.replaceChunks(second.id, chunkPages([{ pageNo: 1, text: '全文检索基于 SQLite FTS5。' }]))

  return {
    sqlite,
    firstChunks,
    search: new SearchService({ db: sqlite }),
  }
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
  it('中文短语命中正确页码并带摘要', async () => {
    const { search } = setup()

    const hits = await search.query('复习间隔')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('认知心理学')
    expect(hits[0]?.pageNo).toBe(1)
    expect(hits[0]?.snippet).toContain('复习间隔')
    expect(hits[0]?.sources).toEqual(['fts'])
  })

  it('英文不区分大小写', async () => {
    const { search } = setup()

    const hits = await search.query('machine learning')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.pageNo).toBe(2)
  })

  it('空查询与纯标点返回空结果', async () => {
    const { search } = setup()

    expect(await search.query('   ')).toEqual([])
    expect(await search.query('，。！')).toEqual([])
  })

  it('回收站中的载体不参与检索', async () => {
    const { sqlite, search } = setup()
    const carrier = sqlite.carriers.list().find(item => item.title === '检索说明')

    sqlite.carriers.softDelete(carrier!.id)

    expect(await search.query('FTS5')).toEqual([])
  })

  it('limit 限制返回条数', async () => {
    const { search } = setup()

    expect(await search.query('学习', { limit: 1 })).toHaveLength(1)
  })

  it('向量与 FTS 双路命中时 RRF 排在单路之前', async () => {
    const { sqlite, firstChunks } = setup()
    const pageTwoChunk = firstChunks.find(chunk => chunk.pageNo === 2)

    const search = new SearchService({
      db: sqlite,
      ai: {
        embedding: { available: true, model: 'test-embed', dim: 3 },
        embed: async () => ({ vectors: [[1, 0, 0]] }),
      },
      vector: {
        query: async () => [{ id: pageTwoChunk!.id }],
      },
    })

    const hits = await search.query('学习')
    const pageTwo = hits.find(hit => hit.title === '认知心理学' && hit.pageNo === 2)

    expect(pageTwo?.sources.sort()).toEqual(['fts', 'vector'])
    expect(hits[0]?.carrierId).toBe(pageTwo?.carrierId)
    expect(hits[0]?.pageNo).toBe(2)
  })

  it('向量检索失败时退化为 FTS5', async () => {
    const { sqlite } = setup()

    const search = new SearchService({
      db: sqlite,
      ai: {
        embedding: { available: true, model: 'test-embed', dim: 3 },
        embed: async () => {
          throw new Error('embedding 服务不可用')
        },
      },
      vector: { query: async () => [] },
    })

    const hits = await search.query('学习')

    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every(hit => hit.sources.every(source => source === 'fts'))).toBe(true)
  })

  it('摘要定位查询词并带前后文', () => {
    const longText = `${'前文'.repeat(100)}目标关键词${'后文'.repeat(100)}`

    const snippet = makeSnippet(longText, '目标关键词', 20)

    expect(snippet).toContain('目标关键词')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })
})
