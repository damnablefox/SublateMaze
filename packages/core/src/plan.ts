/**
 * 学习计划编排：平台无关的排序、分配与冲突检测。
 *
 * 知识点为最小单位，依赖只引用同课程内的知识点 id；
 * 期望天数装不下时自动延长，重排时已完成项保持原位。
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 每个知识点默认投入的分钟数。 */
export const DEFAULT_MINUTES_PER_POINT = 6

export interface PlanPointInput {
  id: string
  title?: string
  dependsOn?: string[]
}

export interface ScheduleOptions {
  startDate: string
  days: number
  dailyMinutes: number
  minutesPerPoint?: number
}

export interface ScheduledDay {
  date: string
  pointIds: string[]
}

export interface PlanSchedule {
  orderedIds: string[]
  days: ScheduledDay[]
  dayCount: number
  extended: boolean
  cycleIds: string[]
}

export interface PlanItemOrder {
  /** 计划项唯一 id。 */
  id: string
  /** 知识点 id，用于匹配依赖。 */
  pointId: string
  date: string
  position: number
  dependsOn?: string[]
  title?: string
}

export interface PlanConflict {
  pointId: string
  dependsOnId: string
  message: string
}

export interface ReplanItem extends PlanItemOrder {
  status: 'pending' | 'done' | 'skipped'
}

export interface ReplanAssignment {
  id: string
  date: string
  position: number
}

export interface ReplanResult {
  assignments: ReplanAssignment[]
  dayCount: number
  conflicts: PlanConflict[]
}

export function isValidDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false

  const timestamp = Date.parse(`${date}T00:00:00Z`)
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
}

/** 以 UTC 日期运算，避免本地时区把日期推前一天。 */
export function addDays(date: string, offset: number): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(timestamp)) {
    throw new Error('日期格式必须为 YYYY-MM-DD')
  }

  return new Date(timestamp + offset * DAY_MS).toISOString().slice(0, 10)
}

/** 每日可安排的知识点数量，至少 1 个。 */
export function pointsPerDay(dailyMinutes: number, minutesPerPoint = DEFAULT_MINUTES_PER_POINT): number {
  const minutes = Math.max(1, Math.trunc(minutesPerPoint))
  return Math.max(1, Math.floor(Math.max(0, dailyMinutes) / minutes))
}

/**
 * 按依赖做稳定拓扑排序：输入顺序决定同层先后。
 *
 * 缺失的依赖（已被移出课程）忽略；存在环时返回环中的知识点 id，
 * 环内及其下游知识点不输出，由调用方决定是否拒绝。
 */
export function orderPoints(points: PlanPointInput[]): { ordered: PlanPointInput[]; cycleIds: string[] } {
  const byId = new Map(points.map(point => [point.id, point]))
  const visited = new Set<string>()
  const blocked = new Set<string>()
  const cycleIds = new Set<string>()
  const ordered: PlanPointInput[] = []

  const visit = (id: string, path: string[]): boolean => {
    if (visited.has(id)) return true
    if (blocked.has(id)) return false

    const start = path.indexOf(id)
    if (start >= 0) {
      for (const member of path.slice(start)) cycleIds.add(member)
      return false
    }

    const point = byId.get(id)
    if (!point) return true

    path.push(id)
    let valid = true

    for (const dependency of point.dependsOn ?? []) {
      if (!byId.has(dependency)) continue
      if (!visit(dependency, path)) valid = false
    }

    path.pop()

    if (!valid) {
      blocked.add(id)
      return false
    }

    visited.add(id)
    ordered.push(point)
    return true
  }

  for (const point of points) visit(point.id, [])

  return { ordered, cycleIds: [...cycleIds] }
}

/**
 * 把知识点按每日容量分配到日期。
 *
 * 期望天数小于实际所需时自动延长；`days` 为最终天数。
 */
export function schedulePoints(points: PlanPointInput[], options: ScheduleOptions): PlanSchedule {
  if (!isValidDate(options.startDate)) {
    throw new Error('计划开始日期格式必须为 YYYY-MM-DD')
  }

  const perDay = pointsPerDay(options.dailyMinutes, options.minutesPerPoint)
  const { ordered, cycleIds } = orderPoints(points)
  const requiredDays = Math.ceil(ordered.length / perDay)
  const dayCount = Math.max(1, Math.trunc(options.days), requiredDays)
  const days: ScheduledDay[] = []

  for (let index = 0; index < dayCount; index += 1) {
    days.push({
      date: addDays(options.startDate, index),
      pointIds: ordered.slice(index * perDay, (index + 1) * perDay).map(point => point.id),
    })
  }

  return {
    orderedIds: ordered.map(point => point.id),
    days,
    dayCount,
    extended: dayCount > Math.trunc(options.days),
    cycleIds,
  }
}

/** 检查计划项顺序：前置必须排在当前项之前。 */
export function detectConflicts(items: PlanItemOrder[]): PlanConflict[] {
  const sorted = [...items].sort(
    (left, right) => left.date.localeCompare(right.date) || left.position - right.position,
  )
  const orderIndex = new Map(sorted.map((item, index) => [item.pointId, index]))
  const byPointId = new Map(items.map(item => [item.pointId, item]))
  const conflicts: PlanConflict[] = []

  for (const item of sorted) {
    const current = orderIndex.get(item.pointId) ?? 0

    for (const dependsOnId of item.dependsOn ?? []) {
      const dependency = byPointId.get(dependsOnId)
      if (!dependency) continue

      if ((orderIndex.get(dependsOnId) ?? -1) >= current) {
        conflicts.push({
          pointId: item.pointId,
          dependsOnId,
          message: `「${item.title ?? item.pointId}」排在它的前置「${dependency.title ?? dependsOnId}」之前`,
        })
      }
    }
  }

  return conflicts
}

/**
 * 按新的每日时长重排未完成项。
 *
 * `done/skipped` 的日期与顺序原样保留；固定项所占日期计入容量。
 * 只为未完成项返回新的日期与顺序，已经过去且未完成的项也一并前移。
 */
export function replanPending(
  items: ReplanItem[],
  options: { startDate: string; dailyMinutes: number; minutesPerPoint?: number },
): ReplanResult {
  if (!isValidDate(options.startDate)) {
    throw new Error('重排开始日期格式必须为 YYYY-MM-DD')
  }

  const perDay = pointsPerDay(options.dailyMinutes, options.minutesPerPoint)
  const fixed = items.filter(item => item.status !== 'pending')
  const pending = items
    .filter(item => item.status === 'pending')
    .sort((left, right) => left.date.localeCompare(right.date) || left.position - right.position)

  const fixedByDate = new Map<string, number>()
  for (const item of fixed) {
    fixedByDate.set(item.date, (fixedByDate.get(item.date) ?? 0) + 1)
  }

  const assignments: ReplanAssignment[] = []
  let cursor = 0
  let offset = 0

  while (cursor < pending.length) {
    const date = addDays(options.startDate, offset)
    const fixedCount = fixedByDate.get(date) ?? 0
    const capacity = Math.max(0, perDay - fixedCount)

    for (let slot = 0; slot < capacity && cursor < pending.length; slot += 1) {
      assignments.push({ id: pending[cursor]!.id, date, position: fixedCount + slot })
      cursor += 1
    }

    offset += 1
    if (offset > 100_000) throw new Error('重排天数超出上限')
  }

  const assignmentById = new Map(assignments.map(assignment => [assignment.id, assignment]))
  const merged: PlanItemOrder[] = items.map((item) => {
    const assignment = assignmentById.get(item.id)

    return {
      id: item.id,
      pointId: item.pointId,
      date: assignment?.date ?? item.date,
      position: assignment?.position ?? item.position,
      dependsOn: item.dependsOn,
      title: item.title,
    }
  })

  return {
    assignments,
    dayCount: Math.max(1, offset),
    conflicts: detectConflicts(merged),
  }
}
