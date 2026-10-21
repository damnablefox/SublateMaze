import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type CourseStatus = 'active' | 'archived'

export interface Course {
  id: string
  title: string
  description: string
  status: CourseStatus
  dailyMinutes: number
  createdAt: string
  updatedAt: string
}

export interface CourseSummary extends Course {
  unitCount: number
  pointCount: number
}

export interface CourseUnit {
  id: string
  courseId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}

export interface CoursePoint {
  id: string
  courseId: string
  unitId?: string
  pointId: string
  title: string
  content: string
  pageStart: number
  pageEnd: number
  position: number
  dependsOn: string[]
  createdAt: string
  updatedAt: string
}

export interface AvailablePoint {
  id: string
  carrierId: string
  carrierTitle: string
  title: string
  pageStart: number
  pageEnd: number
}

export interface CreateCourseInput {
  title: string
  description?: string
  dailyMinutes?: number
}

export interface CoursePatch {
  title?: string
  description?: string
  dailyMinutes?: number
  status?: CourseStatus
}

interface CourseRow {
  id: string
  title: string
  description: string
  status: string
  daily_minutes: number
  created_at: string
  updated_at: string
}

interface CourseSummaryRow extends CourseRow {
  unit_count: number
  point_count: number
}

interface UnitRow {
  id: string
  course_id: string
  title: string
  position: number
  created_at: string
  updated_at: string
}

interface CoursePointRow {
  id: string
  course_id: string
  unit_id: string | null
  point_id: string
  position: number
  depends_on_json: string
  created_at: string
  updated_at: string
  title: string
  content: string
  page_start: number
  page_end: number
}

interface AvailableRow {
  id: string
  carrier_id: string
  carrier_title: string
  title: string
  page_start: number
  page_end: number
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function mapCourse(row: CourseRow): Course {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as CourseStatus,
    dailyMinutes: row.daily_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSummary(row: CourseSummaryRow): CourseSummary {
  return {
    ...mapCourse(row),
    unitCount: row.unit_count,
    pointCount: row.point_count,
  }
}

function mapUnit(row: UnitRow): CourseUnit {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseDepends(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function mapPoint(row: CoursePointRow): CoursePoint {
  return {
    id: row.id,
    courseId: row.course_id,
    unitId: row.unit_id ?? undefined,
    pointId: row.point_id,
    title: row.title,
    content: row.content,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    position: row.position,
    dependsOn: parseDepends(row.depends_on_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 课程、单元与课程内知识点编排。 */
export class CourseStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  create(input: CreateCourseInput): Course {
    const title = input.title.trim()
    if (!title) throw new Error('课程标题不能为空')

    const id = randomUUID()
    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO courses (id, title, description, status, daily_minutes, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(id, title, input.description?.trim() ?? '', Math.max(1, input.dailyMinutes ?? 30), timestamp, timestamp)

    return this.get(id)!
  }

  list(): CourseSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.description, c.status, c.daily_minutes, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM course_units u WHERE u.course_id = c.id) AS unit_count,
                (SELECT COUNT(*) FROM course_points p WHERE p.course_id = c.id) AS point_count
         FROM courses c
         WHERE c.status != 'archived'
         ORDER BY c.created_at ASC`,
      )
      .all() as unknown as CourseSummaryRow[]

    return rows.map(mapSummary)
  }

  get(id: string): Course | undefined {
    const row = this.db
      .prepare(
        'SELECT id, title, description, status, daily_minutes, created_at, updated_at FROM courses WHERE id = ?',
      )
      .get(id) as CourseRow | undefined

    return row ? mapCourse(row) : undefined
  }

  update(id: string, patch: CoursePatch): void {
    const current = this.get(id)
    if (!current) throw new Error('课程不存在')

    if (patch.title !== undefined && !patch.title.trim()) {
      throw new Error('课程标题不能为空')
    }

    this.db
      .prepare(
        `UPDATE courses
         SET title = ?, description = ?, daily_minutes = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.title?.trim() ?? current.title,
        patch.description?.trim() ?? current.description,
        Math.max(1, patch.dailyMinutes ?? current.dailyMinutes),
        patch.status ?? current.status,
        new Date().toISOString(),
        id,
      )
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM courses WHERE id = ?').run(id)
  }

  createUnit(input: { courseId: string; title: string }): CourseUnit {
    if (!this.get(input.courseId)) throw new Error('课程不存在')
    const title = input.title.trim()
    if (!title) throw new Error('单元标题不能为空')

    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_position FROM course_units WHERE course_id = ?')
      .get(input.courseId) as { max_position: number }
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO course_units (id, course_id, title, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.courseId, title, row.max_position + 1, timestamp, timestamp)

    return this.getUnit(id)!
  }

  getUnit(id: string): CourseUnit | undefined {
    const row = this.db
      .prepare(
        'SELECT id, course_id, title, position, created_at, updated_at FROM course_units WHERE id = ?',
      )
      .get(id) as UnitRow | undefined

    return row ? mapUnit(row) : undefined
  }

  listUnits(courseId: string): CourseUnit[] {
    const rows = this.db
      .prepare(
        `SELECT id, course_id, title, position, created_at, updated_at
         FROM course_units WHERE course_id = ?
         ORDER BY position ASC, created_at ASC`,
      )
      .all(courseId) as unknown as UnitRow[]

    return rows.map(mapUnit)
  }

  updateUnit(id: string, patch: { title?: string; position?: number }): void {
    const current = this.getUnit(id)
    if (!current) throw new Error('课程单元不存在')

    if (patch.title !== undefined && !patch.title.trim()) {
      throw new Error('单元标题不能为空')
    }

    this.db
      .prepare('UPDATE course_units SET title = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title?.trim() ?? current.title,
        Math.max(0, Math.trunc(patch.position ?? current.position)),
        new Date().toISOString(),
        id,
      )
  }

  removeUnit(id: string): void {
    this.db.prepare('DELETE FROM course_units WHERE id = ?').run(id)
  }

  /**
   * 从已确认知识点添加编排项。
   *
   * 已在该课程里的知识点会被跳过，重复调用不会产生重复行。
   */
  addPoints(courseId: string, unitId: string | null, pointIds: string[]): CoursePoint[] {
    if (!this.get(courseId)) throw new Error('课程不存在')

    if (unitId) {
      const unit = this.getUnit(unitId)
      if (!unit || unit.courseId !== courseId) throw new Error('课程单元不属于该课程')
    }

    const unique = [...new Set(pointIds)]
    if (unique.length === 0) return []

    const confirmed = this.db
      .prepare(
        `SELECT id FROM knowledge_points
         WHERE status = 'confirmed' AND id IN (${placeholders(unique.length)})`,
      )
      .all(...unique) as unknown as { id: string }[]
    const confirmedIds = new Set(confirmed.map(row => row.id))
    const missing = unique.filter(id => !confirmedIds.has(id))

    if (missing.length > 0) {
      throw new Error(`只能编排已确认的知识点：${missing.join(', ')}`)
    }

    const existing = this.db
      .prepare(
        `SELECT point_id FROM course_points
         WHERE course_id = ? AND point_id IN (${placeholders(unique.length)})`,
      )
      .all(courseId, ...unique) as unknown as { point_id: string }[]
    const existingIds = new Set(existing.map(row => row.point_id))
    const toInsert = unique.filter(id => !existingIds.has(id))
    if (toInsert.length === 0) return []

    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_position FROM course_points WHERE course_id = ?')
      .get(courseId) as { max_position: number }

    const insert = this.db.prepare(
      `INSERT INTO course_points
         (id, course_id, unit_id, point_id, position, depends_on_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
    )
    const timestamp = new Date().toISOString()
    const insertedIds: string[] = []

    this.db.exec('BEGIN')
    try {
      toInsert.forEach((pointId, index) => {
        const id = randomUUID()
        insert.run(id, courseId, unitId, pointId, maxRow.max_position + 1 + index, timestamp, timestamp)
        insertedIds.push(id)
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return this.listPoints(courseId).filter(point => insertedIds.includes(point.id))
  }

  listPoints(courseId: string): CoursePoint[] {
    const rows = this.db
      .prepare(
        `SELECT cp.id, cp.course_id, cp.unit_id, cp.point_id, cp.position, cp.depends_on_json,
                cp.created_at, cp.updated_at,
                kp.title, kp.content, kp.page_start, kp.page_end
         FROM course_points cp
         JOIN knowledge_points kp ON kp.id = cp.point_id
         WHERE cp.course_id = ?
         ORDER BY cp.position ASC, cp.created_at ASC`,
      )
      .all(courseId) as unknown as CoursePointRow[]

    return rows.map(mapPoint)
  }

  getPoint(id: string): CoursePoint | undefined {
    const rows = this.db
      .prepare(
        `SELECT cp.id, cp.course_id, cp.unit_id, cp.point_id, cp.position, cp.depends_on_json,
                cp.created_at, cp.updated_at,
                kp.title, kp.content, kp.page_start, kp.page_end
         FROM course_points cp
         JOIN knowledge_points kp ON kp.id = cp.point_id
         WHERE cp.id = ?`,
      )
      .all(id) as unknown as CoursePointRow[]

    return rows[0] ? mapPoint(rows[0]) : undefined
  }

  removePoints(ids: string[]): void {
    if (ids.length === 0) return
    this.db.prepare(`DELETE FROM course_points WHERE id IN (${placeholders(ids.length)})`).run(...ids)
  }

  movePoint(id: string, patch: { unitId?: string | null; position?: number }): void {
    const current = this.getPoint(id)
    if (!current) throw new Error('课程知识点不存在')

    let unitId = current.unitId ?? null
    if (patch.unitId !== undefined) {
      if (patch.unitId !== null) {
        const unit = this.getUnit(patch.unitId)
        if (!unit || unit.courseId !== current.courseId) throw new Error('课程单元不属于该课程')
      }
      unitId = patch.unitId
    }

    this.db
      .prepare('UPDATE course_points SET unit_id = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(
        unitId,
        Math.max(0, Math.trunc(patch.position ?? current.position)),
        new Date().toISOString(),
        id,
      )
  }

  /** 设置前置知识点；引用不存在或成环时整体回滚。 */
  setDepends(id: string, dependsOn: string[]): void {
    const current = this.getPoint(id)
    if (!current) throw new Error('课程知识点不存在')

    const unique = [...new Set(dependsOn)].filter(pointId => pointId !== current.pointId)
    const inCourse = new Set(this.listPoints(current.courseId).map(point => point.pointId))
    const missing = unique.filter(pointId => !inCourse.has(pointId))

    if (missing.length > 0) {
      throw new Error('前置知识点必须已在该课程中编排')
    }

    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('UPDATE course_points SET depends_on_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(unique), new Date().toISOString(), id)
      this.assertAcyclic(current.courseId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listAvailablePoints(courseId: string): AvailablePoint[] {
    const rows = this.db
      .prepare(
        `SELECT kp.id, kp.carrier_id, c.title AS carrier_title, kp.title, kp.page_start, kp.page_end
         FROM knowledge_points kp
         JOIN carriers c ON c.id = kp.carrier_id
         WHERE kp.status = 'confirmed'
           AND kp.id NOT IN (SELECT point_id FROM course_points WHERE course_id = ?)
         ORDER BY c.title ASC, kp.page_start ASC`,
      )
      .all(courseId) as unknown as AvailableRow[]

    return rows.map(row => ({
      id: row.id,
      carrierId: row.carrier_id,
      carrierTitle: row.carrier_title,
      title: row.title,
      pageStart: row.page_start,
      pageEnd: row.page_end,
    }))
  }

  private assertAcyclic(courseId: string): void {
    const rows = this.db
      .prepare('SELECT point_id, depends_on_json FROM course_points WHERE course_id = ?')
      .all(courseId) as unknown as { point_id: string; depends_on_json: string }[]

    const graph = new Map<string, string[]>()
    for (const row of rows) {
      graph.set(row.point_id, parseDepends(row.depends_on_json))
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (id: string): void => {
      if (visited.has(id)) return
      if (visiting.has(id)) throw new Error('前置关系存在循环，请检查依赖设置')

      visiting.add(id)
      for (const dependency of graph.get(id) ?? []) {
        if (graph.has(dependency)) visit(dependency)
      }
      visiting.delete(id)
      visited.add(id)
    }

    for (const id of graph.keys()) visit(id)
  }
}
