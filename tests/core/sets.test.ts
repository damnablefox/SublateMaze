import { describe, expect, it } from 'vitest'
import { researchDegree, researchLevel } from '@sublate/core'

describe('core 研究程度', () => {
  it('空集合所有分项为 0', () => {
    expect(
      researchDegree({
        totalPoints: 0,
        confirmedPoints: 0,
        reviewedPoints: 0,
        totalReps: 0,
        masteryScores: [],
      }),
    ).toEqual({
      breadth: 0,
      depth: 0,
      mastery: 0,
      score: 0,
      level: '入门',
      totalPoints: 0,
      confirmedPoints: 0,
      reviewedPoints: 0,
    })
  })

  it('按 0.4/0.3/0.3 加权计算综合分', () => {
    const degree = researchDegree({
      totalPoints: 4,
      confirmedPoints: 2,
      reviewedPoints: 1,
      totalReps: 4,
      masteryScores: [0.8, 0, 0, 0],
    })

    expect(degree.breadth).toBeCloseTo(0.5)
    expect(degree.depth).toBeCloseTo(1 / 3)
    expect(degree.mastery).toBeCloseTo(0.2)
    expect(degree.score).toBeCloseTo(0.4 * 0.5 + 0.3 * (1 / 3) + 0.3 * 0.2)
    expect(degree.level).toBe('进阶')
    expect(degree.totalPoints).toBe(4)
    expect(degree.confirmedPoints).toBe(2)
    expect(degree.reviewedPoints).toBe(1)
  })

  it('深度在平均 3 次复习时封顶', () => {
    const degree = researchDegree({
      totalPoints: 2,
      confirmedPoints: 2,
      reviewedPoints: 2,
      totalReps: 20,
      masteryScores: [1, 1],
    })

    expect(degree.depth).toBe(1)
    expect(degree.score).toBe(1)
    expect(degree.level).toBe('精通')
  })

  it('等级边界固定', () => {
    expect(researchLevel(0)).toBe('入门')
    expect(researchLevel(0.2499)).toBe('入门')
    expect(researchLevel(0.25)).toBe('进阶')
    expect(researchLevel(0.4999)).toBe('进阶')
    expect(researchLevel(0.5)).toBe('熟练')
    expect(researchLevel(0.7499)).toBe('熟练')
    expect(researchLevel(0.75)).toBe('精通')
  })

  it('越界的掌握度与计数被收敛到合法范围', () => {
    const degree = researchDegree({
      totalPoints: 2,
      confirmedPoints: 9,
      reviewedPoints: -3,
      totalReps: 0,
      masteryScores: [2, -1],
    })

    expect(degree.breadth).toBe(1)
    expect(degree.confirmedPoints).toBe(2)
    expect(degree.reviewedPoints).toBe(0)
    expect(degree.mastery).toBeCloseTo(0.5)
  })
})
