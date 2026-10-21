import { describe, expect, it } from 'vitest'
import { planDailyBudget } from '@sublate/core'

describe('每日学习预算', () => {
  it('到期复习优先且最多占可用时间 40%', () => {
    const result = planDailyBudget({ dailyMinutes: 30, dueCount: 10, newCount: 10 })

    expect(result.reserveMinutes).toBeCloseTo(6)
    expect(result.availableMinutes).toBeCloseTo(24)
    expect(result.reviewSlots).toBe(3)
    expect(result.reviewMinutes).toBe(9)
    expect(result.newSlots).toBe(1)
    expect(result.newMinutes).toBe(10)
    expect(result.message).toContain('复习 3 张')
  })

  it('没有到期复习时预算全部给新学', () => {
    const result = planDailyBudget({ dailyMinutes: 30, dueCount: 0, newCount: 10 })

    expect(result.reviewSlots).toBe(0)
    expect(result.newSlots).toBe(2)
  })

  it('单日新学不超过 5 个', () => {
    const result = planDailyBudget({ dailyMinutes: 300, dueCount: 0, newCount: 100 })

    expect(result.newSlots).toBe(5)
  })

  it('预算为 0 时全部为 0', () => {
    const result = planDailyBudget({ dailyMinutes: 0, dueCount: 10, newCount: 10 })

    expect(result).toMatchObject({ reviewSlots: 0, newSlots: 0, reviewMinutes: 0, newMinutes: 0 })
  })

  it('到期数量少于建议张数时只安排到期的数量', () => {
    const result = planDailyBudget({ dailyMinutes: 60, dueCount: 2, newCount: 0 })

    expect(result.reviewSlots).toBe(2)
    expect(result.newSlots).toBe(0)
  })
})
