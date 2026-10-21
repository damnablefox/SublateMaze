import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs'

/**
 * FSRS 学习卡片调度。
 *
 * 参数固定且关闭模糊，保证同输入得到同结果，便于测试与验收。
 * 状态字段与 ts-fsrs 的 Card 对齐，便于持久化后原样恢复。
 */

export type ReviewRating = 1 | 2 | 3 | 4

const DAY_MS = 24 * 60 * 60 * 1000
const ACCURACY_ALPHA = 0.4

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36_500,
  enable_fuzz: false,
  enable_short_term: false,
})

export interface ReviewState {
  stability: number
  difficulty: number
  dueAt: string
  reps: number
  lapses: number
  cardState: number
  scheduledDays: number
  learningSteps: number
  lastReviewedAt?: string
  lastRating?: ReviewRating
  accuracyEwma: number
}

export interface ReviewOutcome {
  state: ReviewState
  intervalDays: number
  retrievabilityBefore: number
}

function toGrade(rating: ReviewRating): Grade {
  if (rating === 1) return Rating.Again
  if (rating === 2) return Rating.Hard
  if (rating === 3) return Rating.Good
  return Rating.Easy
}

/** 把持久化状态还原为 ts-fsrs 的卡片；未复习过时返回新卡。 */
export function toCard(state: ReviewState | undefined, now: Date): Card {
  if (!state || state.reps === 0) return createEmptyCard(now)

  return {
    due: new Date(state.dueAt),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.cardState as State,
    last_review: state.lastReviewedAt ? new Date(state.lastReviewedAt) : undefined,
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 自评准确率映射：重来 0、困难 0.4、良好 0.8、容易 1。 */
export function updateAccuracy(previous: number, rating: ReviewRating): number {
  const observed = rating === 1 ? 0 : rating === 2 ? 0.4 : rating === 3 ? 0.8 : 1
  return clamp01(clamp01(previous) * (1 - ACCURACY_ALPHA) + observed * ACCURACY_ALPHA)
}

/** FSRS 预测的可提取概率 R；未复习过返回 0。 */
export function retrievability(state: ReviewState | undefined, now: Date): number {
  if (!state || state.reps === 0 || state.stability <= 0) return 0

  const card = toCard(state, now)
  return clamp01(scheduler.get_retrievability(card, now, false))
}

/** 掌握度 M = 0.6 × R + 0.4 × 自评准确率；未复习过为 0。 */
export function masteryScore(state: ReviewState | undefined, now: Date): number {
  if (!state || state.reps === 0) return 0
  return clamp01(0.6 * retrievability(state, now) + 0.4 * clamp01(state.accuracyEwma))
}

/** 按自评推进 FSRS，返回新状态与距下次到期的天数。 */
export function scheduleReview(
  state: ReviewState | undefined,
  rating: ReviewRating,
  now: Date,
): ReviewOutcome {
  const card = toCard(state, now)
  const retrievabilityBefore = state && state.reps > 0 ? retrievability(state, now) : 0
  const { card: next } = scheduler.next(card, now, toGrade(rating))

  return {
    state: {
      stability: next.stability,
      difficulty: next.difficulty,
      dueAt: next.due.toISOString(),
      reps: next.reps,
      lapses: next.lapses,
      cardState: next.state,
      scheduledDays: next.scheduled_days,
      learningSteps: next.learning_steps,
      lastReviewedAt: now.toISOString(),
      lastRating: rating,
      accuracyEwma: updateAccuracy(state?.accuracyEwma ?? 0.5, rating),
    },
    intervalDays: Math.max(0, (next.due.getTime() - now.getTime()) / DAY_MS),
    retrievabilityBefore,
  }
}
