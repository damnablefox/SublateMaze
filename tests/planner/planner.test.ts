import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath, schedulePoints } from '@sublate/core'
import { PlannerService, localDate } from '@sublate/plugin-planner'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-planner-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '计划服务测试',
    sha256: 'b'.repeat(64),
    relPath: libraryRelPath('b'.repeat(64), 'pdf'),
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
  sqlite.knowledge.confirmPoints(points.map(point => point.id))

  const course = sqlite.course.create({ title: '线性代数', dailyMinutes: 30 })
  sqlite.course.addPoints(
    course.id,
    null,
    points.map(point => point.id),
  )

  return { sqlite, course, coursePoints: sqlite.course.listPoints(course.id) }
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

describe('planner 服务', () => {
  it('按每日时长生成计划并在装不下时延长', () => {
    const { sqlite, course } = setup()
    const service = new PlannerService({ db: sqlite })

    const result = service.generate({
      courseId: course.id,
      startDate: '2026-10-22',
      days: 1,
      dailyMinutes: 12,
    })

    expect(result.extended).toBe(true)
    expect(result.message).toContain('自动延长')
    expect(result.plan.days).toBe(2)
    expect(result.items).toHaveLength(3)
    expect(result.items[0]?.date).toBe('2026-10-22')
    expect(result.items[2]?.date).toBe('2026-10-23')
    expect(result.conflicts).toEqual([])
  })

  it('前置在前生成，前置成环时拒绝生成', () => {
    const { sqlite, course, coursePoints } = setup()
    const service = new PlannerService({ db: sqlite })
    const [first, second] = coursePoints

    sqlite.course.setDepends(second!.id, [first!.pointId])

    const result = service.generate({
      courseId: course.id,
      startDate: '2026-10-22',
      days: 10,
      dailyMinutes: 30,
    })
    const orderedIds = result.items.map(item => item.pointId)

    expect(orderedIds.indexOf(first!.pointId)).toBeLessThan(orderedIds.indexOf(second!.pointId))

    sqlite.db
      .prepare('UPDATE course_points SET depends_on_json = ? WHERE id = ?')
      .run(JSON.stringify([second!.pointId]), first!.id)

    expect(() =>
      service.generate({ courseId: course.id, startDate: '2026-10-22' }),
    ).toThrow('循环')
  })

  it('重排保留已完成项，只移动未完成项', () => {
    const { sqlite, course } = setup()
    const service = new PlannerService({ db: sqlite })

    const generated = service.generate({
      courseId: course.id,
      startDate: '2026-10-20',
      days: 2,
      dailyMinutes: 30,
    })
    const done = generated.items[0]!
    service.setItemStatus(done.id, 'done')

    const replanned = service.replan(generated.plan.id, 6, '2026-10-22')
    const doneAfter = replanned.items.find(item => item.id === done.id)!
    const pending = replanned.items.filter(item => item.status === 'pending')

    expect(doneAfter.date).toBe(done.date)
    expect(doneAfter.position).toBe(done.position)
    expect(pending.every(item => item.date >= '2026-10-22')).toBe(true)
    expect(replanned.plan.dailyMinutes).toBe(6)
  })

  it('移动计划项导致前置在后时返回冲突', () => {
    const { sqlite, course, coursePoints } = setup()
    const service = new PlannerService({ db: sqlite })
    const [first, second] = coursePoints

    sqlite.course.setDepends(second!.id, [first!.pointId])

    const generated = service.generate({
      courseId: course.id,
      startDate: '2026-10-22',
      days: 3,
      dailyMinutes: 6,
    })
    const firstItem = generated.items.find(item => item.pointId === first!.pointId)!
    const secondItem = generated.items.find(item => item.pointId === second!.pointId)!

    expect(firstItem.date < secondItem.date).toBe(true)

    const moved = service.moveItem(secondItem.id, '2026-10-21')

    expect(moved.conflicts).toHaveLength(1)
    expect(moved.conflicts[0]?.pointId).toBe(second!.pointId)
    expect(moved.conflicts[0]?.message).toContain('前置')
  })

  it('本地日期格式为 YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('500 个知识点的计划生成在 2 秒内完成', () => {
    const points = Array.from({ length: 500 }, (_, index) => ({
      id: `p${index}`,
      title: `知识点 ${index}`,
      dependsOn: [],
    }))
    const started = performance.now()
    const schedule = schedulePoints(points, {
      startDate: '2026-10-22',
      days: 30,
      dailyMinutes: 120,
      minutesPerPoint: 6,
    })

    expect(schedule.days.flatMap(day => day.pointIds)).toHaveLength(500)
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
