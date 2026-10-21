import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-chunks-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: 'chunk 测试',
    sha256: 'c'.repeat(64),
    relPath: libraryRelPath('c'.repeat(64), 'pdf'),
    mime: 'application/pdf',
    size: 10,
  })

  return { sqlite, carrier }
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

describe('storage-sqlite chunk 仓储', () => {
  it('迁移到版本 10 并写入待索引 chunk', () => {
    const { sqlite, carrier } = setup()

    const chunks = sqlite.chunks.replaceChunks(carrier.id, [
      { pageNo: 1, chunkNo: 1, text: '第一块' },
      { pageNo: 2, chunkNo: 1, text: '第二块' },
    ])

    expect(
      (sqlite.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(10)
    expect(chunks).toHaveLength(2)
    expect(sqlite.chunks.listChunks(carrier.id).map(chunk => chunk.status)).toEqual([
      'pending',
      'pending',
    ])
    expect(sqlite.chunks.chunkStats()).toEqual({
      total: 2,
      indexed: 0,
      pending: 2,
      failed: 0,
    })
  })

  it('重复写入替换旧 chunk', () => {
    const { sqlite, carrier } = setup()

    sqlite.chunks.replaceChunks(carrier.id, [{ pageNo: 1, chunkNo: 1, text: '旧块' }])
    sqlite.chunks.replaceChunks(carrier.id, [{ pageNo: 1, chunkNo: 1, text: '新块' }])

    const chunks = sqlite.chunks.listChunks(carrier.id)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('新块')
  })

  it('标记索引成功与失败并汇总状态', () => {
    const { sqlite, carrier } = setup()
    const chunks = sqlite.chunks.replaceChunks(carrier.id, [
      { pageNo: 1, chunkNo: 1, text: 'A' },
      { pageNo: 1, chunkNo: 2, text: 'B' },
    ])

    sqlite.chunks.markChunksIndexed([chunks[0]!.id], 'bge-m3')
    sqlite.chunks.markChunksFailed([chunks[1]!.id], 'HTTP 500')

    expect(sqlite.chunks.chunkStats()).toEqual({
      total: 2,
      indexed: 1,
      pending: 0,
      failed: 1,
    })
    expect(sqlite.chunks.listChunks(carrier.id).find(item => item.id === chunks[0]!.id)?.model).toBe(
      'bge-m3',
    )
  })

  it('模型变化只重置不同模型的 chunk', () => {
    const { sqlite, carrier } = setup()
    const chunks = sqlite.chunks.replaceChunks(carrier.id, [
      { pageNo: 1, chunkNo: 1, text: 'A' },
      { pageNo: 1, chunkNo: 2, text: 'B' },
    ])

    sqlite.chunks.markChunksIndexed([chunks[0]!.id], 'model-a')
    sqlite.chunks.markChunksIndexed([chunks[1]!.id], 'model-b')

    expect(sqlite.chunks.resetChunksForModel('model-a')).toBe(1)
    expect(sqlite.chunks.chunkStats().pending).toBe(1)
    expect(sqlite.chunks.chunkStats().indexed).toBe(1)
  })

  it('按 id 取回时过滤回收站中的载体', () => {
    const { sqlite, carrier } = setup()
    const chunks = sqlite.chunks.replaceChunks(carrier.id, [
      { pageNo: 1, chunkNo: 1, text: '可见' },
    ])

    expect(sqlite.chunks.getChunksByIds([chunks[0]!.id])).toHaveLength(1)

    sqlite.carriers.softDelete(carrier.id)

    expect(sqlite.chunks.getChunksByIds([chunks[0]!.id])).toHaveLength(0)
  })
})
