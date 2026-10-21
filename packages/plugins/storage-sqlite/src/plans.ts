import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type PlanStatus = 'active' | 'archived'
export type PlanItemStatus = 'pending' | 'done' | 'skipped'

export interface Plan {
  id: string
  courseId: string
  goalId?: string
  startDate: string
  days: number
  dailyMinutes: number
  status: PlanStatus
  createdAt: string
  updatedAt: string
}

export interface PlanSummary extends Plan {
  itemCount: number
  doneCount: number
}

export interface PlanItem {
  id: string
  planId: string
  coursePointId: string
  pointId: string
  title: string
  unitTitle?: string
  date: string
  position: number
  status: PlanItemStatus
  completedAt?: string
  updatedAt: string
  pageStart: number
  pageEnd: number
}

export interface PlanItemView extends PlanItem {
  courseId: string
  courseTitle: string
}

export interface TodaySnapshot {
  date: string
  due: PlanItemView[]
  overdue: PlanItemView[]
  stats: { total: number; pending: number; done: number; skipped: number }
}

export interface CreatePlanInput {
  courseId: string
  goalId?: string
  startDate: string
  days: number
  dailyMinutes: number
}

export interface PlanPatch {
  days?: number
  dailyMinutes?: number
  status?: PlanStatus
  goalId?: string | null
}

export interface PlanDayInput {
  date: string
  pointIds: string[]
}

export interface PlanItemUpdate {
  id: string
  date: string
  position: number
}

interface PlanRow {
  id: string
  course_id: string
  goal_id: string | null
  start_date: string
  days: number
  daily_minutes: number
  status: string
  created_at: string
  updated_at: string
}

interface PlanSummaryRow extends PlanRow {
  item_count: number
  done_count: number
}

interface ItemRow {
  id: string
  plan_id: string
  course_point_id: string
  point_id: string
  title: string
  unit_title: string | null
  date: string
  position: number
  status: string
  completed_at: string | null
  updated_at: string
  page_start: number
  page_end: number
  course_id: string
  course_title: string
}

function mapPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    courseId: row.course_id,
    goalId: row.goal_id ?? undefined,
    startDate: row.start_date,
    days: row.days,
    dailyMinutes: row.daily_minutes,
    status: row.status as PlanStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapItem(row: ItemRow): PlanItemView {
  return {
    id: row.id,
    planId: row.plan_id,
    coursePointId: row.course_point_id,
    pointId: row.point_id,
    title: row.title,
    unitTitle: row.unit_title ?? undefined,
    date: row.date,
    position: row.position,
    status: row.status as PlanItemStatus,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    courseId: row.course_id,
    courseTitle: row.course_title,
  }
}

const ITEM_SELECT = `
  SELECT pi.id, pi.plan_id, pi.course_point_id, pi.date, pi.position, pi.status, pi.completed_at,
         pi.updated_at, cp.point_id, kp.title, kp.page_start, kp.page_end,
         u.title AS unit_title, c.id AS course_id, c.title AS course_title
  FROM plan_items pi
  JOIN plans p ON p.id = pi.plan_id
  JOIN courses c ON c.id = p.course_id
  JOIN course_points cp ON cp.id = pi.course_point_id
  JOIN knowledge_points kp ON kp.id = cp.point_id
  LEFT JOIN course_units u ON u.id = cp.unit_id
`

/** 学习计划与每日计划项。 */
export class PlanStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  create(input: CreatePlanInput): Plan {
    const course = this.db.prepare('SELECT id FROM courses WHERE id = ?').get(input.courseId)
    if (!course) throw new Error('课程不存在')

    if (input.goalId) {
      const goal = this.db
        .prepare('SELECT course_id FROM goals WHERE id = ?')
        .get(input.goalId) as { course_id: string } | undefined
      if (!goal || goal.course_id !== input.courseId) throw new Error('目标不属于该课程')
    }

    const id = randomUUID()
    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO plans
           (id, course_id, goal_id, start_date, days, daily_minutes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.courseId,
        input.goalId ?? null,
        input.startDate,
        Math.max(1, Math.trunc(input.days)),
        Math.max(1, Math.trunc(input.dailyMinutes)),
        timestamp,
        timestamp,
      )

    return this.get(id)!
  }

  get(id: string): Plan | undefined {
    const row = this.db
      .prepare(
        `SELECT id, course_id, goal_id, start_date, days, daily_minutes, status, created_at, updated_at
         FROM plans WHERE id = ?`,
      )
      .get(id) as PlanRow | undefined

    return row ? mapPlan(row) : undefined
  }

  listByCourse(courseId: string): PlanSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.course_id, p.goal_id, p.start_date, p.days, p.daily_minutes, p.status,
                p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id) AS item_count,
                (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id AND i.status = 'done') AS done_count
         FROM plans p
         WHERE p.course_id = ?
         ORDER BY p.created_at DESC`,
      )
      .all(courseId) as unknown as PlanSummaryRow[]

    return rows.map(row => ({
      ...mapPlan(row),
      itemCount: row.item_count,
      doneCount: row.done_count,
    }))
  }

  update(id: string, patch: PlanPatch): void {
    const current = this.get(id)
    if (!current) throw new Error('计划不存在')

    this.db
      .prepare(
        `UPDATE plans SET days = ?, daily_minutes = ?, status = ?, goal_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        Math.max(1, Math.trunc(patch.days ?? current.days)),
        Math.max(1, Math.trunc(patch.dailyMinutes ?? current.dailyMinutes)),
        patch.status ?? current.status,
        patch.goalId === undefined ? (current.goalId ?? null) : patch.goalId,
        new Date().toISOString(),
        id,
      )
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM plans WHERE id = ?').run(id)
  }

  /** 全量替换计划项，用于首次生成计划。 */
  replaceItems(planId: string, days: PlanDayInput[]): void {
    const plan = this.get(planId)
    if (!plan) throw new Error('计划不存在')

    const rows = this.db
      .prepare('SELECT id, point_id FROM course_points WHERE course_id = ?')
      .all(plan.courseId) as unknown as { id: string; point_id: string }[]
    const coursePointByPoint = new Map(rows.map(row => [row.point_id, row.id]))

    const insert = this.db.prepare(
      `INSERT INTO plan_items
         (id, plan_id, course_point_id, date, position, status, completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?)`,
    )
    const timestamp = new Date().toISOString()

    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM plan_items WHERE plan_id = ?').run(planId)

      for (const day of days) {
        day.pointIds.forEach((pointId, position) => {
          const coursePointId = coursePointByPoint.get(pointId)
          if (!coursePointId) return

          insert.run(randomUUID(), planId, coursePointId, day.date, position, timestamp)
        })
      }

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listItems(planId: string): PlanItemView[] {
    const rows = this.db
      .prepare(`${ITEM_SELECT} WHERE pi.plan_id = ? ORDER BY pi.date ASC, pi.position ASC`)
      .all(planId) as unknown as ItemRow[]

    return rows.map(mapItem)
  }

  getItem(id: string): PlanItemView | undefined {
    const rows = this.db.prepare(`${ITEM_SELECT} WHERE pi.id = ?`).all(id) as unknown as ItemRow[]
    return rows[0] ? mapItem(rows[0]) : undefined
  }

  setItemStatus(id: string, status: PlanItemStatus): void {
    const timestamp = new Date().toISOString()

    this.db
      .prepare('UPDATE plan_items SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status, status === 'done' ? timestamp : null, timestamp, id)
  }

  /** 批量移动计划项；只更新给定的日期与顺序。 */
  moveItems(updates: PlanItemUpdate[]): void {
    if (updates.length === 0) return

    const statement = this.db.prepare(
      'UPDATE plan_items SET date = ?, position = ?, updated_at = ? WHERE id = ?',
    )
    const timestamp = new Date().toISOString()

    this.db.exec('BEGIN')
    try {
      for (const update of updates) {
        statement.run(update.date, Math.max(0, Math.trunc(update.position)), timestamp, update.id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** 今日任务、逾期任务与今日统计（跨所有活跃计划）。 */
  today(date: string): TodaySnapshot {
    const due = this.db
      .prepare(`${ITEM_SELECT} WHERE p.status = 'active' AND pi.date = ? ORDER BY pi.position ASC`)
      .all(date) as unknown as ItemRow[]
    const overdue = this.db
      .prepare(
        `${ITEM_SELECT}
         WHERE p.status = 'active' AND pi.status = 'pending' AND pi.date < ?
         ORDER BY pi.date ASC, pi.position ASC
         LIMIT 200`,
      )
      .all(date) as unknown as ItemRow[]

    const dueItems = due.map(mapItem)
    const pending = dueItems.filter(item => item.status === 'pending').length
    const done = dueItems.filter(item => item.status === 'done').length
    const skipped = dueItems.filter(item => item.status === 'skipped').length

    return {
      date,
      due: dueItems,
      overdue: overdue.map(mapItem),
      stats: { total: dueItems.length, pending, done, skipped },
    }
  }
}
