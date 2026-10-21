import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFtsMatch, libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-carriers-'))
  tempDirs.push(dir)
  const service = new SqliteService(join(dir, 'sublate.db'))
  services.push(service)
  return service
}

function openService(path: string) {
  const service = new SqliteService(path)
  services.push(service)
  return service
}

function createCarrier(service: SqliteService, sha256: string, title = '测试教材') {
  return service.carriers.create({
    kind: 'pdf',
    title,
    sha256,
    relPath: libraryRelPath(sha256, 'pdf'),
    mime: 'application/pdf',
    size: 1024,
  })
}

afterEach(() => {
  for (const service of services.splice(0)) {
    try {
      service.close()
    } catch {
      // 已手动关闭的连接忽略
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storage-sqlite 载体仓储', () => {
  it('迁移到版本 2 且保留既有 settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sublate-carriers-'))
    tempDirs.push(dir)
    const path = join(dir, 'sublate.db')

    const first = openService(path)
    first.setSetting('theme', 'dark')

    const second = openService(path)
    expect(second.getSetting('theme')).toBe('dark')
    expect(
      (second.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(2)
  })

  it('创建载体后可按 id 与内容哈希读取', () => {
    const service = createService()
    const sha256 = 'a'.repeat(64)

    const carrier = createCarrier(service, sha256)

    expect(carrier.status).toBe('pending')
    expect(carrier.file.relPath).toBe(`library/aa/aa/${sha256}.pdf`)
    expect(service.carriers.get(carrier.id)?.title).toBe('测试教材')
    expect(service.carriers.findBySha256(sha256)?.id).toBe(carrier.id)
  })

  it('同一内容哈希不能创建第二个文件记录', () => {
    const service = createService()
    const sha256 = 'b'.repeat(64)

    createCarrier(service, sha256)
    expect(() => createCarrier(service, sha256)).toThrow()
  })

  it('替换页文本后可按页码读取并更新页数', () => {
    const service = createService()
    const carrier = createCarrier(service, 'c'.repeat(64))

    service.carriers.replacePages(carrier.id, [
      { pageNo: 1, text: '知识点是学习的最小单位' },
      { pageNo: 2, text: 'Machine learning basics' },
    ])

    expect(service.carriers.getPageCount(carrier.id)).toBe(2)
    expect(service.carriers.getPages(carrier.id, 1, 1)).toEqual([
      { pageNo: 1, text: '知识点是学习的最小单位' },
    ])
    expect(service.carriers.get(carrier.id)?.pageCount).toBe(2)
  })

  it('中文短语与英文单词都能命中正确页码', () => {
    const service = createService()
    const carrier = createCarrier(service, 'd'.repeat(64))

    service.carriers.replacePages(carrier.id, [
      { pageNo: 1, text: '知识点是学习的最小单位' },
      { pageNo: 2, text: 'Machine learning basics' },
    ])

    const zhMatch = buildFtsMatch('知识点')
    const enMatch = buildFtsMatch('machine')
    expect(zhMatch).toBeDefined()
    expect(enMatch).toBeDefined()

    const zhHits = service.carriers.searchPages(zhMatch!, 10)
    const enHits = service.carriers.searchPages(enMatch!, 10)

    expect(zhHits.map((hit) => hit.pageNo)).toEqual([1])
    expect(enHits.map((hit) => hit.pageNo)).toEqual([2])
  })

  it('软删除后默认列表与搜索都不包含，恢复后重新出现', () => {
    const service = createService()
    const carrier = createCarrier(service, 'e'.repeat(64))
    service.carriers.replacePages(carrier.id, [{ pageNo: 1, text: '回收站测试' }])

    service.carriers.softDelete(carrier.id)

    expect(service.carriers.list()).toHaveLength(0)
    expect(service.carriers.listTrash()).toHaveLength(1)
    expect(service.carriers.searchPages(buildFtsMatch('回收站')!, 10)).toHaveLength(0)
    expect(service.carriers.findBySha256('e'.repeat(64))?.deletedAt).toBeDefined()

    service.carriers.restore(carrier.id)

    expect(service.carriers.list()).toHaveLength(1)
    expect(service.carriers.listTrash()).toHaveLength(0)
    expect(service.carriers.searchPages(buildFtsMatch('回收站')!, 10)).toHaveLength(1)
  })

  it('阅读位置可保存并读取', () => {
    const service = createService()
    const carrier = createCarrier(service, 'f'.repeat(64))

    expect(service.carriers.getReadState(carrier.id)).toBeUndefined()

    service.carriers.saveReadState(carrier.id, 12, 0.42)
    expect(service.carriers.getReadState(carrier.id)).toEqual({
      pageNo: 12,
      scrollRatio: 0.42,
    })

    service.carriers.saveReadState(carrier.id, 13, 0.1)
    expect(service.carriers.getReadState(carrier.id)?.pageNo).toBe(13)
  })
})
