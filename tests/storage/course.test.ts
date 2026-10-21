import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-course-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '课程测试',
    sha256: 'f'.repeat(64),
    relPath: libraryRelPath('f'.repeat(64), 'pdf'),
    mime: 'application/pdf',
    size: 10,
  })

  sqlite.knowledge.replaceDraft(carrier.id, {
    units: [
      {
        title: '第一章',
        points: [
          { title: '知识点 A', content: '内容 A', pageStart: 1, pageEnd: 1 },
          { title: '知识点 B', content: '内容 B', pageStart: 2, pageEnd: 2 },
          { title: '知识点 C', content: '内容 C', pageStart: 3, pageEnd: 3 },
        ],
      },
    ],
  })

  const points = sqlite.knowledge.listPoints(carrier.id)
  sqlite.knowledge.confirmPoints(points.slice(0, 2).map(point => point.id))

  return {
    sqlite,
    carrier,
    confirmed: sqlite.knowledge.listPoints(carrier.id).filter(point => point.status === 'confirmed'),
    draft: sqlite.knowledge.listPoints(carrier.id).find(point => point.status === 'draft')!,
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

describe('storage-sqlite 课程仓储', () => {
  it('迁移到版本 9 并创建课程与单元', () => {
    const { sqlite } = setup()

    expect((sqlite.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9)

    const course = sqlite.course.create({ title: '线性代数', description: '入门', dailyMinutes: 45 })
    const unit = sqlite.course.createUnit({ courseId: course.id, title: '第一章' })

    expect(sqlite.course.get(course.id)?.title).toBe('线性代数')
    expect(sqlite.course.list()[0]).toMatchObject({ title: '线性代数', unitCount: 1, pointCount: 0 })
    expect(sqlite.course.listUnits(course.id)).toEqual([
      expect.objectContaining({ id: unit.id, title: '第一章', position: 0 }),
    ])
  })

  it('只能编排已确认知识点，重复添加保持幂等', () => {
    const { sqlite, confirmed, draft } = setup()
    const course = sqlite.course.create({ title: '线性代数' })
    const unit = sqlite.course.createUnit({ courseId: course.id, title: '第一章' })

    expect(() => sqlite.course.addPoints(course.id, unit.id, [draft.id])).toThrow('只能编排已确认的知识点')

    const added = sqlite.course.addPoints(
      course.id,
      unit.id,
      confirmed.map(point => point.id),
    )
    const again = sqlite.course.addPoints(
      course.id,
      unit.id,
      confirmed.map(point => point.id),
    )

    expect(added).toHaveLength(2)
    expect(again).toEqual([])
    expect(sqlite.course.listPoints(course.id)).toHaveLength(2)
    expect(sqlite.course.listPoints(course.id)[0]).toMatchObject({
      title: '知识点 A',
      unitId: unit.id,
      dependsOn: [],
    })
  })

  it('可选知识点排除已编排项', () => {
    const { sqlite, confirmed } = setup()
    const course = sqlite.course.create({ title: '线性代数' })

    expect(sqlite.course.listAvailablePoints(course.id)).toHaveLength(2)

    sqlite.course.addPoints(course.id, null, [confirmed[0]!.id])

    expect(sqlite.course.listAvailablePoints(course.id).map(point => point.id)).toEqual([confirmed[1]!.id])
  })

  it('前置必须在本课程内且不得成环', () => {
    const { sqlite, confirmed } = setup()
    const course = sqlite.course.create({ title: '线性代数' })
    sqlite.course.addPoints(
      course.id,
      null,
      confirmed.map(point => point.id),
    )
    const [first, second] = sqlite.course.listPoints(course.id)

    sqlite.course.setDepends(second!.id, [first!.pointId])
    expect(sqlite.course.getPoint(second!.id)?.dependsOn).toEqual([first!.pointId])

    expect(() => sqlite.course.setDepends(first!.id, [second!.pointId])).toThrow('循环')

    expect(sqlite.course.getPoint(first!.id)?.dependsOn).toEqual([])
    expect(sqlite.course.getPoint(second!.id)?.dependsOn).toEqual([first!.pointId])
  })

  it('移除单元后编排项保留为未分组', () => {
    const { sqlite, confirmed } = setup()
    const course = sqlite.course.create({ title: '线性代数' })
    const unit = sqlite.course.createUnit({ courseId: course.id, title: '第一章' })
    sqlite.course.addPoints(course.id, unit.id, [confirmed[0]!.id])

    sqlite.course.removeUnit(unit.id)

    expect(sqlite.course.listPoints(course.id)[0]?.unitId).toBeUndefined()
  })
})
