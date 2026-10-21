/**
 * 专业集与研究程度：平台无关的评分逻辑。
 *
 * 综合分由广度、深度与平均掌握加权得到：
 * 0.4 × 广度 + 0.3 × 深度 + 0.3 × 平均掌握。
 */

export interface ResearchInput {
  totalPoints: number
  confirmedPoints: number
  reviewedPoints: number
  totalReps: number
  masteryScores: number[]
}

export type ResearchLevel = '入门' | '进阶' | '熟练' | '精通'

export interface ResearchDegree {
  breadth: number
  depth: number
  mastery: number
  score: number
  level: ResearchLevel
  totalPoints: number
  confirmedPoints: number
  reviewedPoints: number
}

/** 每个知识点复习 3 次视为深度满分。 */
export const DEPTH_TARGET_REPS = 3

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + clamp01(value), 0)
  return clamp01(total / values.length)
}

export function researchLevel(score: number): ResearchLevel {
  if (score < 0.25) return '入门'
  if (score < 0.5) return '进阶'
  if (score < 0.75) return '熟练'
  return '精通'
}

export function researchDegree(input: ResearchInput): ResearchDegree {
  const total = Math.max(0, Math.floor(input.totalPoints))
  const confirmed = Math.min(total, Math.max(0, Math.floor(input.confirmedPoints)))
  const reviewed = Math.min(total, Math.max(0, Math.floor(input.reviewedPoints)))

  const breadth = total > 0 ? clamp01(confirmed / total) : 0
  const depth = total > 0 ? clamp01(input.totalReps / (total * DEPTH_TARGET_REPS)) : 0
  const mastery = total > 0 ? average(input.masteryScores) : 0
  const score = clamp01(0.4 * breadth + 0.3 * depth + 0.3 * mastery)

  return {
    breadth,
    depth,
    mastery,
    score,
    level: researchLevel(score),
    totalPoints: total,
    confirmedPoints: confirmed,
    reviewedPoints: reviewed,
  }
}
