/**
 * 每日学习预算：到期复习优先，复习最多占可用时间 40%，
 * 总时间预留 20% 缓冲，单日新学有上限。
 */

export interface BudgetInput {
  dailyMinutes: number
  dueCount: number
  newCount: number
  minutesPerReview?: number
  minutesPerNew?: number
  maxNewPerDay?: number
}

export interface BudgetResult {
  totalMinutes: number
  reserveMinutes: number
  availableMinutes: number
  reviewSlots: number
  newSlots: number
  reviewMinutes: number
  newMinutes: number
  message: string
}

const REVIEW_SHARE = 0.4
const RESERVE_SHARE = 0.2

export function planDailyBudget(input: BudgetInput): BudgetResult {
  const totalMinutes = Math.max(0, input.dailyMinutes)
  const reserveMinutes = totalMinutes * RESERVE_SHARE
  const availableMinutes = totalMinutes - reserveMinutes
  const reviewCapMinutes = availableMinutes * REVIEW_SHARE
  const minutesPerReview = Math.max(1, input.minutesPerReview ?? 3)
  const minutesPerNew = Math.max(1, input.minutesPerNew ?? 10)
  const maxNewPerDay = Math.max(0, Math.trunc(input.maxNewPerDay ?? 5))

  const reviewSlots = Math.min(
    Math.max(0, Math.trunc(input.dueCount)),
    Math.floor(reviewCapMinutes / minutesPerReview),
  )
  const reviewMinutes = reviewSlots * minutesPerReview
  const newBudget = Math.max(0, availableMinutes - reviewMinutes)
  const newSlots = Math.min(
    Math.max(0, Math.trunc(input.newCount)),
    maxNewPerDay,
    Math.floor(newBudget / minutesPerNew),
  )
  const newMinutes = newSlots * minutesPerNew

  return {
    totalMinutes,
    reserveMinutes,
    availableMinutes,
    reviewSlots,
    newSlots,
    reviewMinutes,
    newMinutes,
    message: `今天建议复习 ${reviewSlots} 张、新学 ${newSlots} 个，预留 ${Math.round(
      reserveMinutes,
    )} 分钟缓冲`,
  }
}
