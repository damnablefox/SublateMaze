import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

export const name = 'course'
export const inject: string[] = []

interface CourseLike {
  id: string
}

interface CourseStoreLike {
  create(input: { title: string; description?: string; dailyMinutes?: number }): CourseLike
  list(): unknown[]
  get(id: string): CourseLike | undefined
  update(id: string, patch: Record<string, unknown>): void
  remove(id: string): void
  createUnit(input: { courseId: string; title: string }): unknown
  updateUnit(id: string, patch: { title?: string; position?: number }): void
  removeUnit(id: string): void
  listUnits(courseId: string): unknown[]
  listPoints(courseId: string): unknown[]
  addPoints(courseId: string, unitId: string | null, pointIds: string[]): unknown[]
  removePoints(ids: string[]): void
  movePoint(id: string, patch: { unitId?: string | null; position?: number }): void
  setDepends(id: string, dependsOn: string[]): void
  listAvailablePoints(courseId: string): unknown[]
}

interface DbLike {
  course: CourseStoreLike
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

const IdInput = z.object({ id: z.string().min(1) })

const CourseCreateInput = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  dailyMinutes: z.number().int().positive().max(1440).optional(),
})

const CourseUpdateInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  dailyMinutes: z.number().int().positive().max(1440).optional(),
  status: z.enum(['active', 'archived']).optional(),
})

const UnitCreateInput = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().min(1),
})

const UnitUpdateInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  position: z.number().int().min(0).optional(),
})

const PointsAddInput = z.object({
  courseId: z.string().min(1),
  unitId: z.string().min(1).nullable().optional(),
  pointIds: z.array(z.string().min(1)).min(1),
})

const IdsInput = z.object({ ids: z.array(z.string().min(1)).min(1) })

const PointMoveInput = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1).nullable().optional(),
  position: z.number().int().min(0).optional(),
})

const DependsInput = z.object({
  id: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).max(50),
})

/** 课程编排的 IPC 频道；所有输入经 zod 校验。 */
function registerChannels(ctx: Context, db: DbLike, ipc: IpcLike): void {
  const disposers: (() => void)[] = []
  const register = (channel: string, handler: (...args: any[]) => any) => {
    disposers.push(ipc.register(channel, handler))
  }

  register('course:list', () => db.course.list())

  register('course:create', (input: unknown) => {
    const data = CourseCreateInput.parse(input)
    return db.course.create(data)
  })

  register('course:update', (input: unknown) => {
    const data = CourseUpdateInput.parse(input)
    const { id, ...patch } = data
    db.course.update(id, patch)
  })

  register('course:delete', (input: unknown) => {
    const { id } = IdInput.parse(input)
    db.course.remove(id)
  })

  register('course:detail', (input: unknown) => {
    const { id } = IdInput.parse(input)
    const course = db.course.get(id)
    if (!course) throw new Error('课程不存在')

    return {
      course,
      units: db.course.listUnits(id),
      points: db.course.listPoints(id),
    }
  })

  register('course:unit-create', (input: unknown) => {
    const data = UnitCreateInput.parse(input)
    return db.course.createUnit(data)
  })

  register('course:unit-update', (input: unknown) => {
    const { id, ...patch } = UnitUpdateInput.parse(input)
    db.course.updateUnit(id, patch)
  })

  register('course:unit-delete', (input: unknown) => {
    const { id } = IdInput.parse(input)
    db.course.removeUnit(id)
  })

  register('course:points-add', (input: unknown) => {
    const data = PointsAddInput.parse(input)
    return db.course.addPoints(data.courseId, data.unitId ?? null, data.pointIds)
  })

  register('course:points-remove', (input: unknown) => {
    const { ids } = IdsInput.parse(input)
    db.course.removePoints(ids)
  })

  register('course:point-move', (input: unknown) => {
    const { id, ...patch } = PointMoveInput.parse(input)
    db.course.movePoint(id, patch)
  })

  register('course:depends', (input: unknown) => {
    const { id, dependsOn } = DependsInput.parse(input)
    db.course.setDepends(id, dependsOn)
  })

  register('course:available-points', (input: unknown) => {
    const { id } = IdInput.parse(input)
    return db.course.listAvailablePoints(id)
  })

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}

export function apply(ctx: Context) {
  const db = ctx.get('db') as DbLike | undefined
  if (!db?.course) throw new Error('course 需要 db.course 服务')

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) registerChannels(ctx, db, ipc)

  ctx.logger('course').info('课程编排服务已就绪')
}
