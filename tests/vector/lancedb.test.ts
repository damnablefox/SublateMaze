import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VectorService } from '@sublate/plugin-storage-lancedb'

const tempDirs: string[] = []

function createService(dim = 8) {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-lance-'))
  tempDirs.push(dir)
  return new VectorService(dir, dim, 'points')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storage-lancedb', () => {
  it('创建空表并返回统计信息', async () => {
    const service = createService()
    await service.init()

    expect(await service.stats()).toMatchObject({ rows: 0, dim: 8, collection: 'points' })

    service.close()
  })

  it('写入向量后可以按相似度查询', async () => {
    const service = createService()
    await service.init()

    await service.upsert([
      { id: 'a', vector: [1, 0, 0, 0, 0, 0, 0, 0], text: '甲', ownerType: 'point', ownerId: 'a' },
      { id: 'b', vector: [0, 1, 0, 0, 0, 0, 0, 0], text: '乙', ownerType: 'point', ownerId: 'b' },
      { id: 'c', vector: [0.9, 0.1, 0, 0, 0, 0, 0, 0], text: '丙', ownerType: 'point', ownerId: 'c' },
    ])

    expect((await service.stats()).rows).toBe(3)

    const hits = await service.query([1, 0, 0, 0, 0, 0, 0, 0], 2)
    expect(hits).toHaveLength(2)
    expect(hits[0]?.id).toBe('a')

    service.close()
  })

  it('拒绝维度不匹配的向量', async () => {
    const service = createService()
    await service.init()

    await expect(service.upsert([{ id: 'bad', vector: [1, 2] }])).rejects.toThrow('向量维度不匹配')

    service.close()
  })

  it('重新打开后数据仍在', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sublate-lance-'))
    tempDirs.push(dir)

    const first = new VectorService(dir, 4, 'points')
    await first.init()
    await first.upsert([{ id: 'x', vector: [1, 2, 3, 4] }])
    first.close()

    const second = new VectorService(dir, 4, 'points')
    await second.init()
    expect((await second.stats()).rows).toBe(1)
    second.close()
  })
})
