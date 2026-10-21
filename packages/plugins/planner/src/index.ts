import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_MINUTES_PER_POINT,
  detectConflicts,
  isValidDate,
  replanPending,
  schedulePoints,
  type PlanConflict,
} from '@sublate/core'
import { z } from 'zod'

export const name = 'planner'
export const inject: string[] = []

const DAY_MS = 24 * 60 * 60 * 1000

interface CourseLike {
  id: string
  title: string
  dailyMinutes: number
}

interface CoursePointLike {
  pointId: string
  title: string
  dependsOn: string[]
}

interface GoalLike {
  id: string
  courseId: string
  title: string
  dailyMinutes?: number
}

interface PlanLike {
  id: string
  courseId: string
  startDate: string
  days: number
  dailyMinutes: number
}

interface ItemLike {
  id: string
  planId: string
  pointId: string
  title: string
  date: string
  position: number
  status: 'pending' | 'done' | 'skipped'
}

interface DbLike {
  course: {
    get(id: string): CourseLike | undefined
    listPoints(courseId: string): CoursePointLike[]
  }
  goals: {
    get(id: string): GoalLike | undefined
    listByCourse(courseId: string): GoalLike[]
    create(input: { courseId: string; title: string; targetDate?: string; dailyMinutes?: number }): GoalLike
    update(id: string, patch: Record<string, unknown>): void
    remove(id: string): void
  }
  plans: {
    create(input: {
      courseId: string
      goalId?: string
      startDate: string
      days: number
      dailyMinutes: number
    }): PlanLike
    get(id: string): PlanLike | undefined
    listByCourse(courseId: string): unknown[]
    update(id: string, patch: Record<string, unknown>): void
    remove(id: string): void
    replaceItems(planId: string, days: { date: string; pointIds: string[] }[]): void
    listItems(planId: string): ItemLike[]
    getItem(id: string): ItemLike | undefined
    setItemStatus(id: string, status: 'pending' | 'done' | 'skipped'): void
    moveItems(updates: { id: string; date: string; position: number }[]): void
    today(date: string): unknown
  }
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

export interface GenerateInput {
  courseId: string
  goalId?: string
  startDate?: string
  days?: number
  dailyMinutes?: number
  minutesPerPoint?: number
}

export interface GenerateResult {
  plan: PlanLike
  items: ItemLike[]
  conflicts: PlanConflict[]
  extended: boolean
  message?: string
}

export interface PlanDetail {
  plan: PlanLike
  items: ItemLike[]
  conflicts: PlanConflict[]
}

/** 本地时区的 YYYY-MM-DD，避免跨时区把「今天」算错。 */
export function localDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function spanDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 1

  return Math.max(1, Math.floor((end - start) / DAY_MS) + 1)
}

/**
 * 计划服务：生成计划、重排未完成项、维护今日视图。
 *
 * 计划算法在 `@sublate/core`，这里只负责读取课程编排与写入仓储。
 */
export class PlannerService {
  private readonly db: DbLike

  constructor(deps: { db: DbLike }) {
    this.db = deps.db
  }

  generate(input: GenerateInput): GenerateResult {
    const course = this.db.course.get(input.courseId)
    if (!course) throw new Error('课程不存在')

    const points = this.db.course.listPoints(course.id)
    if (points.length === 0) throw new Error('课程还没有编排知识点')

    const startDate = input.startDate ?? localDate()
    if (!isValidDate(startDate)) throw new Error('计划开始日期格式必须为 YYYY-MM-DD')

    let goal: GoalLike | undefined
    if (input.goalId) {
      goal = this.db.goals.get(input.goalId)
      if (!goal || goal.courseId !== course.id) throw new Error('目标不属于该课程')
    }

    const dailyMinutes = Math.max(1, input.dailyMinutes ?? goal?.dailyMinutes ?? course.dailyMinutes)
    const days = Math.max(1, input.days ?? 30)
    const schedule = schedulePoints(
      points.map(point => ({
        id: point.pointId,
        title: point.title,
        dependsOn: point.dependsOn,
      })),
      {
        startDate,
        days,
        dailyMinutes,
        minutesPerPoint: input.minutesPerPoint ?? DEFAULT_MINUTES_PER_POINT,
      },
    )

    if (schedule.cycleIds.length > 0) {
      const titles = points
        .filter(point => schedule.cycleIds.includes(point.pointId))
        .map(point => `「${point.title}」`)
      throw new Error(`前置关系存在循环，无法生成计划：${titles.join('、')}`)
    }

    const plan = this.db.plans.create({
      courseId: course.id,
      goalId: goal?.id,
      startDate,
      days: schedule.dayCount,
      dailyMinutes,
    })
    this.db.plans.replaceItems(plan.id, schedule.days)

    return {
      plan,
      items: this.db.plans.listItems(plan.id),
      conflicts: [],
      extended: schedule.extended,
      message: schedule.extended
        ? `按每日 ${dailyMinutes} 分钟需要 ${schedule.dayCount} 天，已自动延长计划`
        : undefined,
    }
  }

  detail(planId: string): PlanDetail {
    const plan = this.db.plans.get(planId)
    if (!plan) throw new Error('计划不存在')

    const items = this.db.plans.listItems(planId)

    return { plan, items, conflicts: this.conflictsFor(plan, items) }
  }

  setItemStatus(id: string, status: 'pending' | 'done' | 'skipped'): PlanDetail {
    const item = this.db.plans.getItem(id)
    if (!item) throw new Error('计划项不存在')

    this.db.plans.setItemStatus(id, status)
    return this.detail(item.planId)
  }

  moveItem(id: string, date: string, position?: number): PlanDetail {
    const item = this.db.plans.getItem(id)
    if (!item) throw new Error('计划项不存在')
    if (!isValidDate(date)) throw new Error('日期格式必须为 YYYY-MM-DD')

    this.db.plans.moveItems([
      { id, date, position: Math.max(0, Math.trunc(position ?? item.position)) },
    ])

    return this.detail(item.planId)
  }

  /** 按新的每日时长重排未完成项，已完成与跳过项保持原位。 */
  replan(planId: string, dailyMinutes: number, startDate = localDate()): PlanDetail {
    const plan = this.db.plans.get(planId)
    if (!plan) throw new Error('计划不存在')
    if (!isValidDate(startDate)) throw new Error('重排开始日期格式必须为 YYYY-MM-DD')

    const points = this.db.course.listPoints(plan.courseId)
    const dependsByPoint = new Map(points.map(point => [point.pointId, point.dependsOn]))
    const items = this.db.plans.listItems(planId)

    const result = replanPending(
      items.map(item => ({
        id: item.id,
        pointId: item.pointId,
        status: item.status,
        date: item.date,
        position: item.position,
        dependsOn: dependsByPoint.get(item.pointId) ?? [],
        title: item.title,
      })),
      { startDate, dailyMinutes },
    )

    this.db.plans.moveItems(result.assignments)

    const updated = this.db.plans.listItems(planId)
    const latest = updated.map(item => item.date).sort().at(-1)
    const days = latest ? Math.max(plan.days, spanDays(plan.startDate, latest)) : plan.days

    this.db.plans.update(planId, { dailyMinutes, days })
    return this.detail(planId)
  }

  private conflictsFor(plan: PlanLike, items: ItemLike[]): PlanConflict[] {
    const points = this.db.course.listPoints(plan.courseId)
    const dependsByPoint = new Map(points.map(point => [point.pointId, point.dependsOn]))

    return detectConflicts(
      items.map(item => ({
        id: item.id,
        pointId: item.pointId,
        date: item.date,
        position: item.position,
        dependsOn: dependsByPoint.get(item.pointId) ?? [],
        title: item.title,
      })),
    )
  }
}

const GenerateSchema = z.object({
  courseId: z.string().min(1),
  goalId: z.string().min(1).optional(),
  startDate: z.string().min(1).optional(),
  days: z.number().int().positive().max(3650).optional(),
  dailyMinutes: z.number().int().positive().max(1440).optional(),
  minutesPerPoint: z.number().int().positive().max(240).optional(),
})

const PlanIdInput = z.object({ id: z.string().min(1) })
const ItemStatusInput = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'done', 'skipped']),
})
const ItemMoveInput = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  position: z.number().int().min(0).optional(),
})
const ReplanInput = z.object({
  id: z.string().min(1),
  dailyMinutes: z.number().int().positive().max(1440),
  startDate: z.string().min(1).optional(),
})
const TodayInput = z.object({ date: z.string().min(1).optional() })

const GoalCreateInput = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().min(1),
  targetDate: z.string().min(1).optional(),
  dailyMinutes: z.number().int().positive().max(1440).optional(),
})
const GoalUpdateInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  targetDate: z.string().min(1).nullable().optional(),
  dailyMinutes: z.number().int().positive().max(1440).nullable().optional(),
  status: z.enum(['active', 'done', 'archived']).optional(),
})

function registerChannels(ctx: Context, service: PlannerService, db: DbLike, ipc: IpcLike): void {
  const disposers: (() => void)[] = []
  const register = (channel: string, handler: (...args: any[]) => any) => {
    disposers.push(ipc.register(channel, handler))
  }

  register('goal:list', (input: unknown) => {
    const { courseId } = z.object({ courseId: z.string().min(1) }).parse(input)
    return db.goals.listByCourse(courseId)
  })

  register('goal:create', (input: unknown) => {
    return db.goals.create(GoalCreateInput.parse(input))
  })

  register('goal:update', (input: unknown) => {
    const { id, ...patch } = GoalUpdateInput.parse(input)
    db.goals.update(id, patch)
  })

  register('goal:delete', (input: unknown) => {
    const { id } = PlanIdInput.parse(input)
    db.goals.remove(id)
  })

  register('plan:list', (input: unknown) => {
    const { courseId } = z.object({ courseId: z.string().min(1) }).parse(input)
    return db.plans.listByCourse(courseId)
  })

  register('plan:detail', (input: unknown) => {
    const { id } = PlanIdInput.parse(input)
    return service.detail(id)
  })

  register('plan:generate', (input: unknown) => service.generate(GenerateSchema.parse(input)))

  register('plan:replan', (input: unknown) => {
    const data = ReplanInput.parse(input)
    return service.replan(data.id, data.dailyMinutes, data.startDate)
  })

  register('plan:delete', (input: unknown) => {
    const { id } = PlanIdInput.parse(input)
    db.plans.remove(id)
  })

  register('plan:item-status', (input: unknown) => {
    const data = ItemStatusInput.parse(input)
    return service.setItemStatus(data.id, data.status)
  })

  register('plan:item-move', (input: unknown) => {
    const data = ItemMoveInput.parse(input)
    return service.moveItem(data.id, data.date, data.position)
  })

  register('plan:today', (input: unknown) => {
    const { date } = TodayInput.parse(input)
    const target = date ?? localDate()
    if (!isValidDate(target)) throw new Error('日期格式必须为 YYYY-MM-DD')

    return db.plans.today(target)
  })

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}

export function apply(ctx: Context) {
  const db = ctx.get('db') as DbLike | undefined
  if (!db?.plans) throw new Error('planner 需要 db.plans 服务')

  const service = new PlannerService({ db })
  ctx.provide('planner', service)

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) registerChannels(ctx, service, db, ipc)

  ctx.logger('planner').info('学习计划服务已就绪')
}
