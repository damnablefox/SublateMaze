import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-plan-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '计划测试',
    sha256: 'a'.repeat(64),
    relPath: libraryRelPath('a'.repeat(64), 'pdf'),
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

  const course = sqlite.course.create({ title: '线性代数' })
  sqlite.course.addPoints(
    course.id,
    null,
    points.map(point => point.id),
  )

  return { sqlite, course }
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

describe('storage-sqlite 计划仓储', () => {
  it('生成计划项并按日期返回', () => {
    const { sqlite, course } = setup()
    const plan = sqlite.plans.create({
      courseId: course.id,
      startDate: '2026-10-22',
      days: 2,
      dailyMinutes: 30,
    })

    sqlite.plans.replaceItems(plan.id, [
      { date: '2026-10-22', pointIds: [] },
      { date: '2026-10-23', pointIds: [] },
    ])

    const items = sqlite.course.listPoints(course.id)
    sqlite.plans.replaceItems(plan.id, [
      { date: '2026-10-22', pointIds: [items[0]!.pointId, items[1]!.pointId] },
      { date: '2026-10-23', pointIds: [items[2]!.pointId] },
    ])

    const listed = sqlite.plans.listItems(plan.id)
    expect(listed).toHaveLength(3)
    expect(listed[0]).toMatchObject({
      title: '知识点 A',
      date: '2026-10-22',
      position: 0,
      status: 'pending',
      courseTitle: '线性代数',
    })
    expect(listed.map(item => item.date)).toEqual(['2026-10-22', '2026-10-22', '2026-10-23'])
  })

  it('完成状态写入时间，今日统计与逾期分开', () => {
    const { sqlite, course } = setup()
    const plan = sqlite.plans.create({
      courseId: course.id,
      startDate: '2026-10-20',
      days: 3,
      dailyMinutes: 30,
    })
    const points = sqlite.course.listPoints(course.id)

    sqlite.plans.replaceItems(plan.id, [
      { date: '2026-10-20', pointIds: [points[0]!.pointId] },
      { date: '2026-10-22', pointIds: [points[1]!.pointId] },
      { date: '2026-10-22', pointIds: [points[2]!.pointId] },
    ])

    const [overdueItem, firstDue, secondDue] = sqlite.plans.listItems(plan.id)
    sqlite.plans.setItemStatus(firstDue!.id, 'done')
    sqlite.plans.setItemStatus(secondDue!.id, 'skipped')

    const today = sqlite.plans.today('2026-10-22')

    expect(today.stats).toEqual({ total: 2, pending: 0, done: 1, skipped: 1 })
    expect(today.due.map(item => item.id).sort()).toEqual([firstDue!.id, secondDue!.id].sort())
    expect(today.overdue.map(item => item.id)).toEqual([overdueItem!.id])
    expect(sqlite.plans.getItem(firstDue!.id)?.completedAt).toBeTruthy()
    expect(sqlite.plans.getItem(overdueItem!.id)?.completedAt).toBeUndefined()
  })

  it('移动计划项更新日期与顺序', () => {
    const { sqlite, course } = setup()
    const plan = sqlite.plans.create({
      courseId: course.id,
      startDate: '2026-10-22',
      days: 1,
      dailyMinutes: 60,
    })
    const points = sqlite.course.listPoints(course.id)

    sqlite.plans.replaceItems(plan.id, [{ date: '2026-10-22', pointIds: [points[0]!.pointId] }])
    const item = sqlite.plans.listItems(plan.id)[0]!

    sqlite.plans.moveItems([{ id: item.id, date: '2026-10-25', position: 3 }])

    expect(sqlite.plans.getItem(item.id)).toMatchObject({ date: '2026-10-25', position: 3 })
  })

  it('计划列表带完成统计，删除课程级联清理计划', () => {
    const { sqlite, course } = setup()
    const plan = sqlite.plans.create({
      courseId: course.id,
      startDate: '2026-10-22',
      days: 1,
      dailyMinutes: 60,
    })
    const point = sqlite.course.listPoints(course.id)[0]!

    sqlite.plans.replaceItems(plan.id, [{ date: '2026-10-22', pointIds: [point.pointId] }])
    sqlite.plans.setItemStatus(sqlite.plans.listItems(plan.id)[0]!.id, 'done')

    expect(sqlite.plans.listByCourse(course.id)[0]).toMatchObject({ itemCount: 1, doneCount: 1 })

    sqlite.course.remove(course.id)

    expect(sqlite.plans.get(plan.id)).toBeUndefined()
    expect(sqlite.plans.listItems(plan.id)).toEqual([])
  })

  it('目标归属校验与计划关联', () => {
    const { sqlite, course } = setup()
    const other = sqlite.course.create({ title: '另一门课' })
    const goal = sqlite.goals.create({ courseId: course.id, title: '一个月学完', targetDate: '2026-11-21' })
    const plan = sqlite.plans.create({
      courseId: course.id,
      goalId: goal.id,
      startDate: '2026-10-22',
      days: 30,
      dailyMinutes: 30,
    })

    expect(plan.goalId).toBe(goal.id)
    expect(sqlite.goals.listByCourse(course.id)).toHaveLength(1)
    expect(() =>
      sqlite.plans.create({
        courseId: other.id,
        goalId: goal.id,
        startDate: '2026-10-22',
        days: 1,
        dailyMinutes: 30,
      }),
    ).toThrow('目标不属于该课程')
  })
})
