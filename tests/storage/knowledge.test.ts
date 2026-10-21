import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-knowledge-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '知识点测试',
    sha256: 'e'.repeat(64),
    relPath: libraryRelPath('e'.repeat(64), 'pdf'),
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

describe('storage-sqlite 知识仓储', () => {
  it('迁移到版本 5 并写入草稿单元与知识点', () => {
    const { sqlite, carrier } = setup()

    sqlite.knowledge.replaceDraft(carrier.id, {
      units: [
        {
          title: '第一单元',
          pageStart: 1,
          pageEnd: 2,
          points: [
            { title: '知识点 A', content: '内容 A', pageStart: 1, pageEnd: 1 },
            { title: '知识点 B', content: '内容 B', pageStart: 2, pageEnd: 2 },
          ],
        },
      ],
    })

    expect(
      (sqlite.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(5)
    expect(sqlite.knowledge.listUnits(carrier.id)).toHaveLength(1)
    expect(sqlite.knowledge.listPoints(carrier.id)).toHaveLength(2)
    expect(sqlite.knowledge.pointStats(carrier.id)).toEqual({
      total: 2,
      draft: 2,
      confirmed: 0,
      rejected: 0,
    })
  })

  it('重复抽取替换草稿但保留已确认知识点', () => {
    const { sqlite, carrier } = setup()

    sqlite.knowledge.replaceDraft(carrier.id, {
      units: [
        {
          title: '旧单元',
          points: [{ title: '保留', content: '已确认内容', pageStart: 1, pageEnd: 1 }],
        },
      ],
    })
    const confirmed = sqlite.knowledge.listPoints(carrier.id)[0]!
    sqlite.knowledge.confirmPoints([confirmed.id])

    sqlite.knowledge.replaceDraft(carrier.id, {
      units: [
        {
          title: '新单元',
          points: [{ title: '新草稿', content: '新内容', pageStart: 1, pageEnd: 1 }],
        },
      ],
    })

    const points = sqlite.knowledge.listPoints(carrier.id)
    expect(points).toHaveLength(2)
    expect(points.find(point => point.id === confirmed.id)?.status).toBe('confirmed')
    expect(points.find(point => point.title === '新草稿')?.status).toBe('draft')
    expect(sqlite.knowledge.listUnits(carrier.id).some(unit => unit.title === '旧单元')).toBe(true)
  })

  it('确认、拒绝与统计', () => {
    const { sqlite, carrier } = setup()

    sqlite.knowledge.replaceDraft(carrier.id, {
      units: [
        {
          title: '单元',
          points: [
            { title: 'A', content: 'a', pageStart: 1, pageEnd: 1 },
            { title: 'B', content: 'b', pageStart: 1, pageEnd: 1 },
            { title: 'C', content: 'c', pageStart: 1, pageEnd: 1 },
          ],
        },
      ],
    })

    const [a, b, c] = sqlite.knowledge.listPoints(carrier.id)
    sqlite.knowledge.confirmPoints([a!.id, b!.id])
    sqlite.knowledge.rejectPoints([c!.id])

    expect(sqlite.knowledge.pointStats(carrier.id)).toEqual({
      total: 3,
      draft: 0,
      confirmed: 2,
      rejected: 1,
    })
    expect(sqlite.knowledge.listPoints(carrier.id, { status: 'confirmed' })).toHaveLength(2)
  })

  it('更新锚点并纠正倒序页码', () => {
    const { sqlite, carrier } = setup()

    sqlite.knowledge.replaceDraft(carrier.id, {
      units: [
        {
          title: '单元',
          points: [{ title: 'A', content: 'a', pageStart: 1, pageEnd: 1 }],
        },
      ],
    })
    const point = sqlite.knowledge.listPoints(carrier.id)[0]!

    sqlite.knowledge.updatePointAnchor(point.id, 4, 2)

    const updated = sqlite.knowledge.listPoints(carrier.id)[0]!
    expect(updated.pageStart).toBe(4)
    expect(updated.pageEnd).toBe(4)
  })
})
