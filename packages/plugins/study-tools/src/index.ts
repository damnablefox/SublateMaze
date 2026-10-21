import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

export const name = 'study-tools'
export const inject: string[] = []

type Permission = 'read' | 'write-draft' | 'write-commit' | 'dangerous'

interface ToolRegistrationLike {
  name: string
  description: string
  permission: Permission
  input: { parse(value: unknown): any }
  execute(input: any, context: { sessionId?: string }): unknown
}

interface ToolsLike {
  register(tool: ToolRegistrationLike): () => void
}

interface SearchHitLike {
  carrierId: string
  title: string
  pageNo: number
  snippet: string
  score: number
  sources: string[]
}

interface SearchLike {
  query(text: string, options?: { limit?: number }): Promise<SearchHitLike[]>
}

interface CarrierLike {
  id: string
  title: string
  pageCount: number
}

interface CourseLike {
  id: string
  title: string
}

interface CoursePointLike {
  pointId: string
  title: string
  dependsOn: string[]
}

interface CourseStoreLike {
  list(): CourseLike[]
  listPoints(courseId: string): CoursePointLike[]
}

interface DbLike {
  carriers: {
    get(id: string): CarrierLike | undefined
    getPages(carrierId: string, from: number, to: number): { pageNo: number; text: string }[]
  }
  course?: CourseStoreLike
}

interface ExtractorLike {
  extract(carrierId: string): Promise<unknown>
}

interface ReviewCardLike {
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

interface ReviewStatsLike {
  dueCount: number
  newCount: number
  reviewedToday: number
  averageMastery: number
  totalPoints: number
}

interface ReviewQueueLike {
  due: ReviewCardLike[]
  newCards: ReviewCardLike[]
  stats: ReviewStatsLike
}

interface ScopeProgressLike {
  id: string
  title: string
  total: number
  learned: number
  mastery: number
}

interface OverviewLike {
  stats: ReviewStatsLike
  dailyMinutes: number
  budget: { reviewSlots: number; newSlots: number; message: string }
  byCarrier: ScopeProgressLike[]
  byCourse: ScopeProgressLike[]
  distribution: { label: string; count: number }[]
}

interface SchedulerLike {
  queue(options?: { limit?: number }): ReviewQueueLike
  overview(): OverviewLike
  card(pointId: string): ReviewCardLike | undefined
  mastery(pointId: string): { reps: number; dueAt?: string; mastery: number } | undefined
}

interface PlanDetailLike {
  conflicts: { message: string }[]
}

interface PlannerLike {
  setItemStatus(id: string, status: 'pending' | 'done' | 'skipped'): PlanDetailLike
  moveItem(id: string, date: string, position?: number): PlanDetailLike
}

export interface StudyToolDeps {
  tools: ToolsLike
  search: SearchLike
  db: DbLike
  extractor: ExtractorLike
  scheduler?: SchedulerLike
  planner?: PlannerLike
  course?: CourseStoreLike
}

const SearchInput = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().positive().max(50).optional(),
})

const ReadInput = z.object({
  carrierId: z.string().min(1),
  from: z.number().int().positive(),
  to: z.number().int().positive(),
})

const DraftInput = z.object({ carrierId: z.string().min(1) })
const DueInput = z.object({ limit: z.number().int().positive().max(20).optional() })
const PointInput = z.object({ pointId: z.string().min(1) })

const PlanUpdateInput = z.object({
  itemId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['pending', 'done', 'skipped']).optional(),
})

function cardSummary(card: ReviewCardLike) {
  return {
    pointId: card.pointId,
    title: card.title,
    carrierId: card.carrierId,
    carrierTitle: card.carrierTitle,
    pageStart: card.pageStart,
    pageEnd: card.pageEnd,
    dueAt: card.dueAt,
    reps: card.reps,
    mastery: card.masteryScore,
    retrievability: card.retrievability,
  }
}

function registerTools(deps: StudyToolDeps): (() => void)[] {
  const disposers: (() => void)[] = [
    deps.tools.register({
      name: 'search_library',
      description: '检索知识库正文，返回载体标题、页码与摘要',
      permission: 'read',
      input: SearchInput,
      execute: input => deps.search.query(input.query, { limit: input.limit }),
    }),

    deps.tools.register({
      name: 'read_carrier',
      description: '按页范围读取某个载体的文本内容',
      permission: 'read',
      input: ReadInput,
      execute: (input) => {
        const carrier = deps.db.carriers.get(input.carrierId)
        if (!carrier) throw new Error(`载体不存在：${input.carrierId}`)

        const from = Math.min(input.from, input.to)
        const to = Math.max(input.from, input.to)

        return {
          carrierId: carrier.id,
          title: carrier.title,
          pageCount: carrier.pageCount,
          pages: deps.db.carriers.getPages(carrier.id, from, to),
        }
      },
    }),

    deps.tools.register({
      name: 'draft_knowledge_points',
      description: '为指定载体生成知识单元与知识点草稿，需要人工确认',
      permission: 'write-draft',
      input: DraftInput,
      execute: input => deps.extractor.extract(input.carrierId),
    }),
  ]

  const scheduler = deps.scheduler

  if (scheduler) {
    disposers.push(
      deps.tools.register({
        name: 'list_due_reviews',
        description: '查看今天到期需要复习的知识点与新卡，含掌握度',
        permission: 'read',
        input: DueInput,
        execute: (input) => {
          const queue = scheduler.queue({ limit: input.limit ?? 10 })

          return {
            due: queue.due.map(cardSummary),
            newCards: queue.newCards.map(cardSummary),
            stats: queue.stats,
          }
        },
      }),

      deps.tools.register({
        name: 'get_point',
        description: '读取某个知识点的正文、页码、到期时间与掌握度',
        permission: 'read',
        input: PointInput,
        execute: (input) => {
          const card = scheduler.card(input.pointId)
          if (!card) throw new Error(`知识点不存在：${input.pointId}`)

          return { ...cardSummary(card), content: card.content }
        },
      }),

      deps.tools.register({
        name: 'analyze_mastery',
        description: '分析整体掌握度、四档分布、载体消化与课程进度',
        permission: 'read',
        input: z.object({}),
        execute: () => {
          const overview = scheduler.overview()

          return {
            stats: overview.stats,
            dailyMinutes: overview.dailyMinutes,
            budget: overview.budget,
            distribution: overview.distribution,
            byCarrier: overview.byCarrier,
            byCourse: overview.byCourse,
          }
        },
      }),

      deps.tools.register({
        name: 'recommend_next',
        description: '推荐下一个要学习的知识点，并说明基于到期或前置关系的理由',
        permission: 'read',
        input: z.object({}),
        execute: () => {
          const queue = scheduler.queue({ limit: 5 })
          const due = queue.due[0]

          if (due) {
            return { ...cardSummary(due), reason: '已到复习时间，优先巩固' }
          }

          if (deps.course) {
            for (const current of deps.course.list()) {
              for (const point of deps.course.listPoints(current.id)) {
                const state = scheduler.mastery(point.pointId)
                if (state && state.reps > 0) continue

                const ready = point.dependsOn.every((dependency) => {
                  const dependencyState = scheduler.mastery(dependency)
                  return Boolean(dependencyState && dependencyState.reps > 0)
                })
                if (!ready) continue

                return {
                  pointId: point.pointId,
                  title: point.title,
                  mastery: state?.mastery ?? 0,
                  reason: `课程「${current.title}」中前置条件已满足，建议学习`,
                }
              }
            }
          }

          const fresh = queue.newCards[0]
          if (fresh) {
            return { ...cardSummary(fresh), reason: '尚未学习，按载体与页码顺序推进' }
          }

          return { pointId: null, reason: '所有已确认知识点都已复习，暂无新卡', mastery: 0 }
        },
      }),
    )
  }

  const planner = deps.planner

  if (planner) {
    disposers.push(
      deps.tools.register({
        name: 'update_plan',
        description: '调整学习计划中某一项的日期或完成状态，写入前需要用户确认',
        permission: 'write-commit',
        input: PlanUpdateInput,
        execute: (input) => {
          if (!input.date && !input.status) {
            throw new Error('至少提供日期或状态')
          }

          let detail: PlanDetailLike | undefined

          if (input.date) detail = planner.moveItem(input.itemId, input.date)
          if (input.status) detail = planner.setItemStatus(input.itemId, input.status)

          return {
            itemId: input.itemId,
            date: input.date,
            status: input.status,
            conflicts: detail?.conflicts.map(conflict => conflict.message) ?? [],
          }
        },
      }),
    )
  }

  return disposers
}

/** 注册学习域工具；返回注销函数，便于插件卸载。 */
export function registerStudyTools(deps: StudyToolDeps): (() => void)[] {
  return registerTools(deps)
}

export function apply(ctx: Context) {
  const tools = ctx.get('tools') as ToolsLike | undefined
  const search = ctx.get('search') as SearchLike | undefined
  const db = ctx.get('db') as DbLike | undefined
  const extractor = ctx.get('extractor') as ExtractorLike | undefined

  if (!tools || !search || !db || !extractor) {
    throw new Error('study-tools 需要 tools、search、db、extractor 服务')
  }

  const scheduler = ctx.get('scheduler') as SchedulerLike | undefined
  const planner = ctx.get('planner') as PlannerLike | undefined

  const disposers = registerStudyTools({
    tools,
    search,
    db,
    extractor,
    scheduler,
    planner,
    course: db.course,
  })

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })

  ctx.logger('study-tools').info(`学习工具已注册：${disposers.length} 个`)
}
