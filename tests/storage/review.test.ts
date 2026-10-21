import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-review-store-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '复习仓储测试',
    sha256: 'd'.repeat(64),
    relPath: libraryRelPath('d'.repeat(64), 'pdf'),
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

  return { sqlite, carrier, points }
}

function state(dueAt: string) {
  return {
    stability: 3,
    difficulty: 5,
    dueAt,
    reps: 1,
    lapses: 0,
    cardState: 2,
    scheduledDays: 3,
    learningSteps: 0,
    lastReviewedAt: '2026-10-20T08:00:00.000Z',
    lastRating: 3 as const,
    accuracyEwma: 0.62,
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

describe('storage-sqlite 复习仓储', () => {
  it('迁移到版本 7，新卡队列包含已确认知识点', () => {
    const { sqlite, points } = setup()

    expect((sqlite.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(7)
    expect(sqlite.scheduler.newQueue()).toHaveLength(3)
    expect(sqlite.scheduler.dueQueue(new Date().toISOString())).toEqual([])
    expect(sqlite.scheduler.countConfirmed()).toBe(3)
    expect(sqlite.scheduler.countNew()).toBe(3)
    expect(sqlite.scheduler.getPoint(points[0]!.id)?.status).toBe('confirmed')
  })

  it('复习写入掌握状态与记录，重复复习只保留一行', () => {
    const { sqlite, points } = setup()
    const pointId = points[0]!.id

    sqlite.scheduler.saveReview({
      pointId,
      state: state('2026-10-23T08:00:00.000Z'),
      review: {
        rating: 3,
        reviewedAt: '2026-10-22T08:00:00.000Z',
        retrievabilityBefore: 0.9,
        intervalDays: 1,
        stabilityAfter: 3,
        difficultyAfter: 5,
      },
    })

    sqlite.scheduler.saveReview({
      pointId,
      state: state('2026-10-26T08:00:00.000Z'),
      review: {
        rating: 4,
        reviewedAt: '2026-10-23T08:00:00.000Z',
        retrievabilityBefore: 0.92,
        intervalDays: 3,
        stabilityAfter: 6,
        difficultyAfter: 4.5,
      },
    })

    expect(sqlite.scheduler.get(pointId)).toMatchObject({ reps: 1, dueAt: '2026-10-26T08:00:00.000Z' })
    expect(sqlite.scheduler.listAll()).toHaveLength(1)
    expect(sqlite.scheduler.history(pointId)).toHaveLength(2)
    expect(sqlite.scheduler.history(pointId)[0]?.rating).toBe(4)
    expect(
      sqlite.scheduler.reviewedBetween('2026-10-22T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
    ).toBe(2)
    expect(sqlite.scheduler.newQueue()).toHaveLength(2)
  })

  it('到期队列按到期时间升序', () => {
    const { sqlite, points } = setup()

    sqlite.scheduler.save(points[0]!.id, state('2026-10-25T08:00:00.000Z'))
    sqlite.scheduler.save(points[1]!.id, state('2026-10-22T08:00:00.000Z'))
    sqlite.scheduler.save(points[2]!.id, state('2026-10-23T08:00:00.000Z'))

    expect(
      sqlite.scheduler
        .dueQueue('2026-10-26T08:00:00.000Z')
        .map(card => card.pointId),
    ).toEqual([points[1]!.id, points[2]!.id, points[0]!.id])
    expect(sqlite.scheduler.countDue('2026-10-26T08:00:00.000Z')).toBe(3)
  })

  it('按载体与课程聚合掌握状态并读取活跃计划时长', () => {
    const { sqlite, points } = setup()

    sqlite.scheduler.save(points[0]!.id, state('2026-10-25T08:00:00.000Z'))

    const course = sqlite.course.create({ title: '线性代数', dailyMinutes: 45 })
    sqlite.course.addPoints(course.id, null, [points[0]!.id, points[1]!.id])
    sqlite.plans.create({
      courseId: course.id,
      startDate: '2026-10-22',
      days: 3,
      dailyMinutes: 45,
    })

    const byCarrier = sqlite.scheduler.listConfirmedByCarrier()
    expect(byCarrier).toHaveLength(3)
    expect(byCarrier.filter(row => row.mastery).map(row => row.pointId)).toEqual([points[0]!.id])

    const byCourse = sqlite.scheduler.listConfirmedByCourse()
    expect(byCourse.map(row => row.scopeTitle)).toEqual(['线性代数', '线性代数'])
    expect(byCourse[0]?.mastery?.reps).toBe(1)

    expect(sqlite.scheduler.activeDailyMinutes()).toBe(45)
  })

  it('删除载体级联清理掌握状态与复习记录', () => {
    const { sqlite, carrier, points } = setup()

    sqlite.scheduler.saveReview({
      pointId: points[0]!.id,
      state: state('2026-10-23T08:00:00.000Z'),
      review: {
        rating: 3,
        reviewedAt: '2026-10-22T08:00:00.000Z',
        retrievabilityBefore: 0,
        intervalDays: 1,
        stabilityAfter: 3,
        difficultyAfter: 5,
      },
    })

    sqlite.db.prepare('DELETE FROM carriers WHERE id = ?').run(carrier.id)

    expect(sqlite.scheduler.get(points[0]!.id)).toBeUndefined()
    expect(sqlite.scheduler.history(points[0]!.id)).toEqual([])
  })
})
