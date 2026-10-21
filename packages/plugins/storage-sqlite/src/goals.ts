import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type GoalStatus = 'active' | 'done' | 'archived'

export interface Goal {
  id: string
  courseId: string
  title: string
  targetDate?: string
  dailyMinutes?: number
  status: GoalStatus
  createdAt: string
  updatedAt: string
}

export interface CreateGoalInput {
  courseId: string
  title: string
  targetDate?: string
  dailyMinutes?: number
}

export interface GoalPatch {
  title?: string
  targetDate?: string | null
  dailyMinutes?: number | null
  status?: GoalStatus
}

interface GoalRow {
  id: string
  course_id: string
  title: string
  target_date: string | null
  daily_minutes: number | null
  status: string
  created_at: string
  updated_at: string
}

function mapGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    targetDate: row.target_date ?? undefined,
    dailyMinutes: row.daily_minutes ?? undefined,
    status: row.status as GoalStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 课程学习目标。 */
export class GoalStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  create(input: CreateGoalInput): Goal {
    const title = input.title.trim()
    if (!title) throw new Error('目标标题不能为空')

    const course = this.db.prepare('SELECT id FROM courses WHERE id = ?').get(input.courseId)
    if (!course) throw new Error('课程不存在')

    const id = randomUUID()
    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO goals (id, course_id, title, target_date, daily_minutes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.courseId,
        title,
        input.targetDate ?? null,
        input.dailyMinutes ?? null,
        timestamp,
        timestamp,
      )

    return this.get(id)!
  }

  get(id: string): Goal | undefined {
    const row = this.db
      .prepare(
        `SELECT id, course_id, title, target_date, daily_minutes, status, created_at, updated_at
         FROM goals WHERE id = ?`,
      )
      .get(id) as GoalRow | undefined

    return row ? mapGoal(row) : undefined
  }

  listByCourse(courseId: string): Goal[] {
    const rows = this.db
      .prepare(
        `SELECT id, course_id, title, target_date, daily_minutes, status, created_at, updated_at
         FROM goals WHERE course_id = ?
         ORDER BY created_at DESC`,
      )
      .all(courseId) as unknown as GoalRow[]

    return rows.map(mapGoal)
  }

  update(id: string, patch: GoalPatch): void {
    const current = this.get(id)
    if (!current) throw new Error('目标不存在')

    if (patch.title !== undefined && !patch.title.trim()) {
      throw new Error('目标标题不能为空')
    }

    const targetDate = patch.targetDate === undefined ? (current.targetDate ?? null) : patch.targetDate
    const dailyMinutes =
      patch.dailyMinutes === undefined ? (current.dailyMinutes ?? null) : patch.dailyMinutes

    this.db
      .prepare(
        `UPDATE goals
         SET title = ?, target_date = ?, daily_minutes = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.title?.trim() ?? current.title,
        targetDate,
        dailyMinutes,
        patch.status ?? current.status,
        new Date().toISOString(),
        id,
      )
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM goals WHERE id = ?').run(id)
  }
}
