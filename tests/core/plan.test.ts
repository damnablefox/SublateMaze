import { describe, expect, it } from 'vitest'
import {
  addDays,
  detectConflicts,
  orderPoints,
  pointsPerDay,
  replanPending,
  schedulePoints,
} from '@sublate/core'

describe('计划日期工具', () => {
  it('跨月与跨年按 UTC 日期推进', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('计划编排', () => {
  it('每日容量至少为 1', () => {
    expect(pointsPerDay(60, 6)).toBe(10)
    expect(pointsPerDay(5, 6)).toBe(1)
    expect(pointsPerDay(0, 6)).toBe(1)
  })

  it('按容量逐日分配并自动延长天数', () => {
    const points = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}` }))
    const schedule = schedulePoints(points, {
      startDate: '2026-10-22',
      days: 2,
      dailyMinutes: 30,
      minutesPerPoint: 6,
    })

    expect(pointsPerDay(30, 6)).toBe(5)
    expect(schedule.dayCount).toBe(3)
    expect(schedule.extended).toBe(true)
    expect(schedule.days[0]?.pointIds).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(schedule.days[2]?.date).toBe('2026-10-24')
  })

  it('依赖通过拓扑排序前移，同层保持输入顺序', () => {
    const { ordered, cycleIds } = orderPoints([
      { id: 'b', dependsOn: ['a'] },
      { id: 'a' },
      { id: 'c' },
    ])

    expect(cycleIds).toEqual([])
    expect(ordered.map(point => point.id)).toEqual(['a', 'b', 'c'])
  })

  it('依赖成环时返回环成员', () => {
    const { ordered, cycleIds } = orderPoints([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c' },
    ])

    expect(ordered.map(point => point.id)).toEqual(['c'])
    expect(cycleIds.sort()).toEqual(['a', 'b'])
  })

  it('缺失的依赖被忽略，不阻塞排序', () => {
    const { ordered, cycleIds } = orderPoints([{ id: 'a', dependsOn: ['missing'] }])

    expect(cycleIds).toEqual([])
    expect(ordered.map(point => point.id)).toEqual(['a'])
  })

  it('500 个知识点在 30 天计划内 2 秒内完成', () => {
    const points = Array.from({ length: 500 }, (_, index) => ({ id: `p${index}` }))
    const started = performance.now()
    const schedule = schedulePoints(points, {
      startDate: '2026-10-22',
      days: 30,
      dailyMinutes: 120,
      minutesPerPoint: 6,
    })
    const elapsed = performance.now() - started

    expect(schedule.dayCount).toBe(30)
    expect(schedule.extended).toBe(false)
    expect(schedule.days.flatMap(day => day.pointIds)).toHaveLength(500)
    expect(elapsed).toBeLessThan(2_000)
  })
})

describe('计划冲突', () => {
  it('前置排在当前项之后时给出冲突', () => {
    const conflicts = detectConflicts([
      { id: 'i2', pointId: 'b', date: '2026-10-22', position: 0, dependsOn: ['a'], title: 'B' },
      { id: 'i1', pointId: 'a', date: '2026-10-23', position: 0, title: 'A' },
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.pointId).toBe('b')
    expect(conflicts[0]?.message).toContain('前置')
  })

  it('前置在前时不产生冲突', () => {
    const conflicts = detectConflicts([
      { id: 'i1', pointId: 'a', date: '2026-10-22', position: 0 },
      { id: 'i2', pointId: 'b', date: '2026-10-22', position: 1, dependsOn: ['a'] },
    ])

    expect(conflicts).toEqual([])
  })
})

describe('按新时长重排', () => {
  const items = [
    { id: 'i1', pointId: 'a', status: 'done' as const, date: '2026-10-20', position: 0 },
    { id: 'i2', pointId: 'b', status: 'skipped' as const, date: '2026-10-20', position: 1 },
    { id: 'i3', pointId: 'c', status: 'pending' as const, date: '2026-10-21', position: 0 },
    { id: 'i4', pointId: 'd', status: 'pending' as const, date: '2026-10-21', position: 1 },
    { id: 'i5', pointId: 'e', status: 'pending' as const, date: '2026-10-22', position: 0 },
  ]

  it('已完成与跳过项保持日期和顺序', () => {
    const result = replanPending(items, { startDate: '2026-10-22', dailyMinutes: 6 })

    expect(result.assignments.map(assignment => assignment.id)).toEqual(['i3', 'i4', 'i5'])
    expect(result.assignments[0]).toEqual({ id: 'i3', date: '2026-10-22', position: 0 })
    expect(result.assignments[1]).toEqual({ id: 'i4', date: '2026-10-23', position: 0 })
    expect(result.assignments[2]).toEqual({ id: 'i5', date: '2026-10-24', position: 0 })
  })

  it('固定项占用的日期计入容量', () => {
    const withFixed = [
      { id: 'i1', pointId: 'a', status: 'done' as const, date: '2026-10-22', position: 0 },
      { id: 'i2', pointId: 'b', status: 'pending' as const, date: '2026-10-22', position: 1 },
      { id: 'i3', pointId: 'c', status: 'pending' as const, date: '2026-10-22', position: 2 },
    ]
    const result = replanPending(withFixed, { startDate: '2026-10-22', dailyMinutes: 12 })

    expect(result.assignments[0]).toEqual({ id: 'i2', date: '2026-10-22', position: 1 })
    expect(result.assignments[1]).toEqual({ id: 'i3', date: '2026-10-23', position: 0 })
  })
})
