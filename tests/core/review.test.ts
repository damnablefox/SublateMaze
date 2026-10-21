import { describe, expect, it } from 'vitest'
import { masteryScore, retrievability, scheduleReview, updateAccuracy } from '@sublate/core'

const NOW = new Date('2026-10-22T08:00:00.000Z')

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

describe('FSRS 调度', () => {
  it('首次评分为良好时安排到未来并记录准确率', () => {
    const result = scheduleReview(undefined, 3, NOW)

    expect(result.state.reps).toBe(1)
    expect(Date.parse(result.state.dueAt)).toBeGreaterThan(NOW.getTime())
    expect(result.intervalDays).toBeGreaterThan(0)
    expect(result.state.accuracyEwma).toBeCloseTo(0.62, 5)
    expect(result.retrievabilityBefore).toBe(0)
  })

  it('重来比容易更早到期，连续良好时间隔递增', () => {
    const again = scheduleReview(undefined, 1, NOW)
    const easy = scheduleReview(undefined, 4, NOW)

    expect(again.intervalDays).toBeLessThan(easy.intervalDays)

    const first = scheduleReview(undefined, 3, NOW)
    const second = scheduleReview(first.state, 3, new Date(first.state.dueAt))
    const third = scheduleReview(second.state, 3, new Date(second.state.dueAt))

    expect(second.intervalDays).toBeGreaterThan(first.intervalDays)
    expect(third.intervalDays).toBeGreaterThan(second.intervalDays)
  })

  it('可提取概率随时间下降', () => {
    const result = scheduleReview(undefined, 3, NOW)
    const due = new Date(result.state.dueAt)
    const atReview = retrievability(result.state, NOW)
    const later = retrievability(result.state, addDays(due, 5))

    expect(atReview).toBeGreaterThan(0.9)
    expect(later).toBeLessThan(atReview)
  })

  it('掌握度冷启动为 0，良好高于重来', () => {
    const good = scheduleReview(undefined, 3, NOW)
    const again = scheduleReview(undefined, 1, NOW)

    expect(masteryScore(undefined, NOW)).toBe(0)
    expect(masteryScore(good.state, NOW)).toBeGreaterThan(masteryScore(again.state, NOW))
  })

  it('准确率按 EWMA 更新并保持在 0–1', () => {
    expect(updateAccuracy(0.5, 3)).toBeCloseTo(0.62, 5)
    expect(updateAccuracy(0.62, 1)).toBeCloseTo(0.372, 5)
    expect(updateAccuracy(0, 4)).toBeCloseTo(0.4, 5)
    expect(updateAccuracy(1, 1)).toBeCloseTo(0.6, 5)
  })
})
