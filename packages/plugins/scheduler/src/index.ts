import type { Context } from '@deepseek-ai/cordis'
import {
  masteryScore,
  planDailyBudget,
  retrievability,
  scheduleReview,
  type BudgetResult,
  type ReviewRating,
  type ReviewState,
} from '@sublate/core'
import { z } from 'zod'

export const name = 'scheduler'
export const inject: string[] = []

const DAY_MS = 24 * 60 * 60 * 1000

interface MasteryLike {
  pointId: string
  stability: number
  difficulty: number
  dueAt?: string
  reps: number
  lapses: number
  cardState: number
  scheduledDays: number
  learningSteps: number
  lastReviewedAt?: string
  lastRating?: ReviewRating
  accuracyEwma: number
  updatedAt: string
}

interface CardLike {
  pointId: string
  title: string
  content: string
  carrierId: string
  carrierTitle: string
  pageStart: number
  pageEnd: number
  mastery?: MasteryLike
}

interface PointLike {
  id: string
  title: string
  status: string
}

interface ScopeRowLike {
  scopeId: string
  scopeTitle: string
  pointId: string
  mastery?: MasteryLike
}

interface SchedulerDbLike {
  get(pointId: string): MasteryLike | undefined
  saveReview(input: {
    pointId: string
    state: Omit<MasteryLike, 'pointId' | 'updatedAt'>
    review: {
      rating: ReviewRating
      reviewedAt: string
      retrievabilityBefore: number
      intervalDays: number
      stabilityAfter: number
      difficultyAfter: number
    }
  }): void
  dueQueue(nowIso: string, limit?: number): CardLike[]
  newQueue(limit?: number): CardLike[]
  history(pointId: string, limit?: number): unknown[]
  reviewedBetween(fromIso: string, toIso: string): number
  countDue(nowIso: string): number
  countNew(): number
  countConfirmed(): number
  getPoint(pointId: string): PointLike | undefined
  getCard(pointId: string): CardLike | undefined
  listAll(): MasteryLike[]
  listConfirmedByCarrier(): ScopeRowLike[]
  listConfirmedByCourse(): ScopeRowLike[]
  activeDailyMinutes(): number
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

export interface ReviewCardView {
  pointId: string
  title: string
  content: string
  carrierId: string
  carrierTitle: string
  pageStart: number
  pageEnd: number
  dueAt?: string
  reps: number
  masteryScore: number
  retrievability: number
}

export interface ReviewStats {
  dueCount: number
  newCount: number
  reviewedToday: number
  averageMastery: number
  totalPoints: number
}

export interface ReviewQueue {
  due: ReviewCardView[]
  newCards: ReviewCardView[]
  stats: ReviewStats
}

export interface ReviewResult {
  pointId: string
  dueAt: string
  intervalDays: number
  mastery: number
  accuracy: number
}

export interface ScopeProgress {
  id: string
  title: string
  total: number
  learned: number
  mastery: number
}

export interface MasteryBucket {
  label: string
  count: number
}

export interface ReviewOverview {
  stats: ReviewStats
  dailyMinutes: number
  budget: BudgetResult
  byCarrier: ScopeProgress[]
  byCourse: ScopeProgress[]
  distribution: MasteryBucket[]
}

export interface SchedulerServiceDeps {
  db: SchedulerDbLike
}

function toReviewState(state: MasteryLike): ReviewState {
  return {
    stability: state.stability,
    difficulty: state.difficulty,
    dueAt: state.dueAt ?? new Date().toISOString(),
    reps: state.reps,
    lapses: state.lapses,
    cardState: state.cardState,
    scheduledDays: state.scheduledDays,
    learningSteps: state.learningSteps,
    lastReviewedAt: state.lastReviewedAt,
    lastRating: state.lastRating,
    accuracyEwma: state.accuracyEwma,
  }
}

function todayRange(now: Date): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + DAY_MS).toISOString(),
  }
}

function toView(card: CardLike, now: Date): ReviewCardView {
  const state = card.mastery ? toReviewState(card.mastery) : undefined

  return {
    pointId: card.pointId,
    title: card.title,
    content: card.content,
    carrierId: card.carrierId,
    carrierTitle: card.carrierTitle,
    pageStart: card.pageStart,
    pageEnd: card.pageEnd,
    dueAt: card.mastery?.dueAt,
    reps: card.mastery?.reps ?? 0,
    masteryScore: masteryScore(state, now),
    retrievability: retrievability(state, now),
  }
}

/** 按载体或课程聚合知识点数量、已复习数量与平均掌握度。 */
function aggregateScopes(rows: ScopeRowLike[], now: Date): ScopeProgress[] {
  const grouped = new Map<string, { title: string; total: number; learned: number; score: number }>()

  for (const row of rows) {
    const entry = grouped.get(row.scopeId) ?? {
      title: row.scopeTitle,
      total: 0,
      learned: 0,
      score: 0,
    }

    entry.total += 1
    if (row.mastery && row.mastery.reps > 0) entry.learned += 1
    entry.score += masteryScore(row.mastery ? toReviewState(row.mastery) : undefined, now)
    grouped.set(row.scopeId, entry)
  }

  return [...grouped.entries()]
    .map(([id, entry]) => ({
      id,
      title: entry.title,
      total: entry.total,
      learned: entry.learned,
      mastery: entry.total > 0 ? entry.score / entry.total : 0,
    }))
    .sort((left, right) => right.total - left.total || left.title.localeCompare(right.title))
}

const BUCKET_LABELS = ['0–25%', '25–50%', '50–75%', '75–100%']

/** 掌握度四档分布；未复习知识点落在 0–25%。 */
function distributionOf(rows: ScopeRowLike[], now: Date): MasteryBucket[] {
  const counts = [0, 0, 0, 0]

  for (const row of rows) {
    const score = masteryScore(row.mastery ? toReviewState(row.mastery) : undefined, now)
    const index = Math.min(3, Math.floor(score * 4))
    counts[index] = (counts[index] ?? 0) + 1
  }

  return BUCKET_LABELS.map((label, index) => ({ label, count: counts[index]! }))
}

/** 复习调度服务：到期队列、自评提交与掌握度统计。 */
export class SchedulerService {
  private readonly db: SchedulerDbLike

  constructor(deps: SchedulerServiceDeps) {
    this.db = deps.db
  }

  queue(options: { limit?: number; now?: Date } = {}): ReviewQueue {
    const now = options.now ?? new Date()
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 30), 1), 100)
    const due = this.db.dueQueue(now.toISOString(), limit).map(card => toView(card, now))
    const newCards = this.db.newQueue(Math.min(limit, 20)).map(card => toView(card, now))

    return { due, newCards, stats: this.stats(now) }
  }

  review(input: { pointId: string; rating: ReviewRating }, now = new Date()): ReviewResult {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 4) {
      throw new Error('自评必须是 1–4 的整数')
    }

    const point = this.db.getPoint(input.pointId)
    if (!point) throw new Error('知识点不存在')
    if (point.status !== 'confirmed') throw new Error('只能复习已确认的知识点')

    const current = this.db.get(input.pointId)
    const outcome = scheduleReview(current ? toReviewState(current) : undefined, input.rating, now)

    this.db.saveReview({
      pointId: input.pointId,
      state: {
        stability: outcome.state.stability,
        difficulty: outcome.state.difficulty,
        dueAt: outcome.state.dueAt,
        reps: outcome.state.reps,
        lapses: outcome.state.lapses,
        cardState: outcome.state.cardState,
        scheduledDays: outcome.state.scheduledDays,
        learningSteps: outcome.state.learningSteps,
        lastReviewedAt: outcome.state.lastReviewedAt,
        lastRating: outcome.state.lastRating,
        accuracyEwma: outcome.state.accuracyEwma,
      },
      review: {
        rating: input.rating,
        reviewedAt: now.toISOString(),
        retrievabilityBefore: outcome.retrievabilityBefore,
        intervalDays: outcome.intervalDays,
        stabilityAfter: outcome.state.stability,
        difficultyAfter: outcome.state.difficulty,
      },
    })

    return {
      pointId: input.pointId,
      dueAt: outcome.state.dueAt,
      intervalDays: outcome.intervalDays,
      mastery: masteryScore(outcome.state, now),
      accuracy: outcome.state.accuracyEwma,
    }
  }

  stats(now = new Date()): ReviewStats {
    const totalPoints = this.db.countConfirmed()
    const sum = this.db
      .listAll()
      .reduce((total, state) => total + masteryScore(toReviewState(state), now), 0)
    const { from, to } = todayRange(now)

    return {
      dueCount: this.db.countDue(now.toISOString()),
      newCount: this.db.countNew(),
      reviewedToday: this.db.reviewedBetween(from, to),
      averageMastery: totalPoints > 0 ? sum / totalPoints : 0,
      totalPoints,
    }
  }

  history(pointId: string, limit = 20): unknown[] {
    return this.db.history(pointId, limit)
  }

  /** 读取单个知识点的卡片视图，供 Agent 工具使用。 */
  card(pointId: string): ReviewCardView | undefined {
    const card = this.db.getCard(pointId)
    return card ? toView(card, new Date()) : undefined
  }

  /** 读取单个知识点的掌握摘要；未复习时返回 undefined。 */
  mastery(pointId: string): { reps: number; dueAt?: string; mastery: number } | undefined {
    const state = this.db.get(pointId)
    if (!state) return undefined

    return {
      reps: state.reps,
      dueAt: state.dueAt,
      mastery: masteryScore(toReviewState(state), new Date()),
    }
  }

  /** 进度面板所需的聚合视图：预算、载体消化、课程进度与掌握度分布。 */
  overview(now = new Date()): ReviewOverview {
    const stats = this.stats(now)
    const dailyMinutes = this.db.activeDailyMinutes()
    const carrierRows = this.db.listConfirmedByCarrier()

    return {
      stats,
      dailyMinutes,
      budget: planDailyBudget({
        dailyMinutes,
        dueCount: stats.dueCount,
        newCount: stats.newCount,
      }),
      byCarrier: aggregateScopes(carrierRows, now),
      byCourse: aggregateScopes(this.db.listConfirmedByCourse(), now),
      distribution: distributionOf(carrierRows, now),
    }
  }
}

const QueueInput = z.object({
  limit: z.number().int().positive().max(100).optional(),
})

const SubmitInput = z.object({
  pointId: z.string().min(1),
  rating: z.number().int().min(1).max(4),
})

const HistoryInput = z.object({
  pointId: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
})

function registerChannels(ctx: Context, service: SchedulerService, ipc: IpcLike): void {
  const disposers: (() => void)[] = []
  const register = (channel: string, handler: (...args: any[]) => any) => {
    disposers.push(ipc.register(channel, handler))
  }

  register('review:queue', (input: unknown) => {
    const { limit } = QueueInput.parse(input ?? {})
    return service.queue({ limit })
  })

  register('review:submit', (input: unknown) => {
    const data = SubmitInput.parse(input)
    return service.review({ pointId: data.pointId, rating: data.rating as ReviewRating })
  })

  register('review:stats', () => service.stats())

  register('review:overview', () => service.overview())

  register('review:history', (input: unknown) => {
    const data = HistoryInput.parse(input)
    return service.history(data.pointId, data.limit)
  })

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}

export function apply(ctx: Context) {
  const db = ctx.get('db') as { scheduler?: SchedulerDbLike } | undefined
  if (!db?.scheduler) throw new Error('scheduler 需要 db.scheduler 服务')

  const service = new SchedulerService({ db: db.scheduler })
  ctx.provide('scheduler', service)

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) registerChannels(ctx, service, ipc)

  ctx.logger('scheduler').info('复习调度服务已就绪')
}
