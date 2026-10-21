import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SchedulerService } from '@sublate/plugin-scheduler'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-scheduler-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '复习调度测试',
    sha256: 'e'.repeat(64),
    relPath: libraryRelPath('e'.repeat(64), 'pdf'),
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

  return { sqlite, points, service: new SchedulerService({ db: sqlite.scheduler }) }
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

const DAY_MS = 24 * 60 * 60 * 1000
const DAY0 = new Date('2026-10-22T08:00:00.000Z')

function after(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS)
}

describe('scheduler 复习服务', () => {
  it('初始队列包含新卡，复习后进入到期队列', () => {
    const { points, service } = setup()

    const initial = service.queue({ now: DAY0 })
    expect(initial.newCards).toHaveLength(3)
    expect(initial.due).toHaveLength(0)
    expect(initial.stats.newCount).toBe(3)

    const result = service.review({ pointId: points[0]!.id, rating: 3 }, DAY0)
    expect(result.intervalDays).toBeGreaterThan(0)
    expect(result.mastery).toBeGreaterThan(0)

    const later = service.queue({ now: new Date(`${result.dueAt}`) })
    expect(later.due.map(card => card.pointId)).toContain(points[0]!.id)
    expect(later.newCards).toHaveLength(2)
    expect(service.stats(DAY0).reviewedToday).toBe(1)
  })

  it('连续 7 天模拟后按逾期天数降序返回', () => {
    const { points, service } = setup()

    service.review({ pointId: points[0]!.id, rating: 1 }, DAY0)
    service.review({ pointId: points[1]!.id, rating: 4 }, DAY0)
    service.review({ pointId: points[2]!.id, rating: 3 }, DAY0)

    const seventh = after(DAY0, 7)
    const queue = service.queue({ now: seventh })

    expect(queue.due.length).toBeGreaterThanOrEqual(2)
    const dueDates = queue.due.map(card => card.dueAt ?? '')
    expect([...dueDates].sort()).toEqual(dueDates)
    expect(queue.stats.dueCount).toBe(queue.due.length)
  })

  it('拒绝非 1–4 评分与非确认知识点', () => {
    const { sqlite, points, service } = setup()

    expect(() => service.review({ pointId: points[0]!.id, rating: 0 as 1 }, DAY0)).toThrow('1–4')
    expect(() => service.review({ pointId: 'missing', rating: 3 }, DAY0)).toThrow('知识点不存在')

    sqlite.knowledge.rejectPoints([points[2]!.id])
    expect(() => service.review({ pointId: points[2]!.id, rating: 3 }, DAY0)).toThrow('已确认')
  })

  it('掌握度统计只计算已确认知识点', () => {
    const { points, service } = setup()

    expect(service.stats(DAY0)).toMatchObject({
      dueCount: 0,
      newCount: 3,
      reviewedToday: 0,
      averageMastery: 0,
      totalPoints: 3,
    })

    service.review({ pointId: points[0]!.id, rating: 4 }, DAY0)

    const stats = service.stats(DAY0)
    expect(stats.reviewedToday).toBe(1)
    expect(stats.newCount).toBe(2)
    expect(stats.averageMastery).toBeGreaterThan(0)
    expect(stats.averageMastery).toBeLessThan(0.5)
  })
})
