import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { IndexerService } from '@sublate/plugin-indexer'
import { SqliteService } from '@sublate/plugin-storage-sqlite'
import { VectorService } from '@sublate/plugin-storage-lancedb'

const tempDirs: string[] = []
const sqlites: SqliteService[] = []
const vectors: VectorService[] = []

interface AiStub {
  embedding: { available: boolean; model?: string; dim: number; reason?: string }
  embed(request: { input: string[] }): Promise<{ vectors: number[][] }>
}

async function setup(aiOverrides: Partial<AiStub> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-indexer-'))
  tempDirs.push(dir)

  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  sqlites.push(sqlite)

  const vector = new VectorService(join(dir, 'lance'), 3, 'chunks')
  await vector.init()
  vectors.push(vector)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '索引测试',
    sha256: 'd'.repeat(64),
    relPath: libraryRelPath('d'.repeat(64), 'pdf'),
    mime: 'application/pdf',
    size: 10,
  })
  const chunks = sqlite.chunks.replaceChunks(carrier.id, [
    { pageNo: 1, chunkNo: 1, text: '第一段' },
    { pageNo: 1, chunkNo: 2, text: '第二段' },
  ])

  const ai: AiStub = {
    embedding: { available: true, model: 'test-embed', dim: 3 },
    embed: async ({ input }) => ({
      vectors: input.map((_, index) => [index + 1, 0, 0]),
    }),
    ...aiOverrides,
  }

  return { sqlite, vector, carrier, chunks, ai }
}

afterEach(() => {
  for (const vector of vectors.splice(0)) vector.close()
  for (const sqlite of sqlites.splice(0)) {
    try {
      sqlite.close()
    } catch {
      // 已关闭
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('indexer', () => {
  it('把 chunk 写入向量并标记 indexed', async () => {
    const { sqlite, vector, carrier, ai } = await setup()
    const service = new IndexerService({ db: sqlite, ai, vector })

    const result = await service.indexCarrier(carrier.id)

    expect(result).toMatchObject({ indexed: 2, failed: 0, skipped: false })
    expect((await vector.stats()).rows).toBe(2)
    expect(sqlite.chunks.chunkStats().indexed).toBe(2)
    expect(sqlite.chunks.chunkStats().pending).toBe(0)
  })

  it('重复索引不产生重复向量行', async () => {
    const { sqlite, vector, carrier, ai } = await setup()
    const service = new IndexerService({ db: sqlite, ai, vector })

    await service.indexCarrier(carrier.id)
    const second = await service.indexCarrier(carrier.id)

    expect(second.skipped).toBe(true)
    expect((await vector.stats()).rows).toBe(2)
  })

  it('embedding 不可用时跳过且不标记失败', async () => {
    const { sqlite, vector, carrier, ai } = await setup({
      embedding: { available: false, dim: 3, reason: '未配置 AI API Key' },
    })
    const service = new IndexerService({ db: sqlite, ai, vector })

    const result = await service.indexCarrier(carrier.id)

    expect(result.skipped).toBe(true)
    expect(sqlite.chunks.chunkStats().pending).toBe(2)
    expect((await vector.stats()).rows).toBe(0)
  })

  it('embedding 失败时标记 failed 并继续可用', async () => {
    const { sqlite, vector, carrier, ai } = await setup({
      embed: async () => {
        throw new Error('embedding 服务不可用')
      },
    })
    const service = new IndexerService({ db: sqlite, ai, vector })

    const result = await service.indexCarrier(carrier.id)

    expect(result.failed).toBe(2)
    expect(sqlite.chunks.chunkStats().failed).toBe(2)
    expect((await vector.stats()).rows).toBe(0)
  })

  it('stats 汇总 chunk 与向量行数', async () => {
    const { sqlite, vector, carrier, ai } = await setup()
    const service = new IndexerService({ db: sqlite, ai, vector })
    await service.indexCarrier(carrier.id)

    const stats = await service.stats()

    expect(stats.chunks.total).toBe(2)
    expect(stats.vectorRows).toBe(2)
    expect(stats.model).toBe('test-embed')
    expect(stats.available).toBe(true)
  })
})
