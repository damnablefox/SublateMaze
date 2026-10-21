import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  masteryScore,
  researchDegree,
  type ResearchDegree,
  type ReviewState,
} from '@sublate/core'

export type SetNodeKind = 'point' | 'carrier'
export type SetEdgeKind = 'prereq' | 'related'

export interface SetRecord {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface SetNodeRecord {
  id: string
  setId: string
  kind: SetNodeKind
  refId: string
  position: number
  createdAt: string
}

export interface SetEdgeRecord {
  id: string
  setId: string
  sourceId: string
  targetId: string
  kind: SetEdgeKind
  createdAt: string
}

export interface SetNodeView extends SetNodeRecord {
  title: string
  subtitle?: string
  status?: string
  missing: boolean
}

export interface SetSummary extends SetRecord {
  nodeCount: number
  pointCount: number
  degree: ResearchDegree
}

export interface SetNodeInput {
  kind: SetNodeKind
  refId: string
}

interface SetRow {
  id: string
  title: string
  description: string
  created_at: string
  updated_at: string
}

interface NodeRow {
  id: string
  set_id: string
  kind: string
  ref_id: string
  position: number
  created_at: string
  point_title: string | null
  point_status: string | null
  point_carrier_title: string | null
  carrier_title: string | null
  carrier_kind: string | null
  carrier_pages: number | null
  carrier_deleted: string | null
}

interface EdgeRow {
  id: string
  set_id: string
  source_id: string
  target_id: string
  kind: string
  created_at: string
}

interface NodeBaseRow {
  id: string
  set_id: string
  kind: string
  ref_id: string
  position: number
  created_at: string
}

interface StatsRow {
  status: string
  mastery_point_id: string | null
  stability: number | null
  difficulty: number | null
  due_at: string | null
  reps: number | null
  lapses: number | null
  card_state: number | null
  scheduled_days: number | null
  learning_steps: number | null
  last_reviewed_at: string | null
  last_rating: number | null
  accuracy_ewma: number | null
}

function mapSet(row: SetRow): SetRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapNode(row: NodeRow): SetNodeView {
  const kind = row.kind as SetNodeKind

  if (kind === 'point') {
    const title = row.point_title ?? '已失效的知识点'
    const carrier = row.point_carrier_title

    return {
      id: row.id,
      setId: row.set_id,
      kind,
      refId: row.ref_id,
      position: row.position,
      createdAt: row.created_at,
      title,
      subtitle: carrier ? `知识点 · ${carrier}` : '知识点',
      status: row.point_status ?? undefined,
      missing: row.point_title === null,
    }
  }

  const label = row.carrier_kind === 'pdf' ? 'PDF' : '网页'
  const pages = row.carrier_pages ?? 0

  return {
    id: row.id,
    setId: row.set_id,
    kind,
    refId: row.ref_id,
    position: row.position,
    createdAt: row.created_at,
    title: row.carrier_title ?? '已失效的载体',
    subtitle: `${label} · ${pages} 页`,
    missing: row.carrier_title === null || row.carrier_deleted !== null,
  }
}

function mapEdge(row: EdgeRow): SetEdgeRecord {
  return {
    id: row.id,
    setId: row.set_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    kind: row.kind as SetEdgeKind,
    createdAt: row.created_at,
  }
}

function mapNodeBase(row: NodeBaseRow): SetNodeRecord {
  return {
    id: row.id,
    setId: row.set_id,
    kind: row.kind as SetNodeKind,
    refId: row.ref_id,
    position: row.position,
    createdAt: row.created_at,
  }
}

function toReviewState(row: StatsRow): ReviewState | undefined {
  if (!row.mastery_point_id) return undefined

  return {
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    dueAt: row.due_at ?? new Date(0).toISOString(),
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    cardState: row.card_state ?? 0,
    scheduledDays: row.scheduled_days ?? 0,
    learningSteps: row.learning_steps ?? 0,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
    lastRating: (row.last_rating as ReviewState['lastRating']) ?? undefined,
    accuracyEwma: row.accuracy_ewma ?? 0.5,
  }
}

const NODE_SELECT = `
  SELECT sn.id, sn.set_id, sn.kind, sn.ref_id, sn.position, sn.created_at,
         kp.title AS point_title, kp.status AS point_status,
         cp.title AS point_carrier_title,
         c2.title AS carrier_title, c2.kind AS carrier_kind, c2.page_count AS carrier_pages,
         c2.deleted_at AS carrier_deleted
  FROM set_nodes sn
  LEFT JOIN knowledge_points kp ON sn.kind = 'point' AND kp.id = sn.ref_id
  LEFT JOIN carriers cp ON cp.id = kp.carrier_id
  LEFT JOIN carriers c2 ON sn.kind = 'carrier' AND c2.id = sn.ref_id
  WHERE sn.set_id = ?
`

/** 专业集存储：集合、节点与关系，研究程度在读取时聚合。 */
export class SetStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  create(input: { title: string; description?: string }): SetRecord {
    const id = randomUUID()
    const now = new Date().toISOString()

    this.db
      .prepare(
        'INSERT INTO sets (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.title.trim(), input.description ?? '', now, now)

    return this.get(id)!
  }

  update(id: string, patch: { title?: string; description?: string }): void {
    const current = this.get(id)
    if (!current) throw new Error(`专业集不存在：${id}`)

    this.db
      .prepare('UPDATE sets SET title = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title?.trim() || current.title,
        patch.description ?? current.description,
        new Date().toISOString(),
        id,
      )
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM sets WHERE id = ?').run(id)
  }

  get(id: string): SetRecord | undefined {
    const row = this.db.prepare('SELECT * FROM sets WHERE id = ?').get(id) as SetRow | undefined
    return row ? mapSet(row) : undefined
  }

  list(): SetSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM sets ORDER BY updated_at DESC')
      .all() as unknown as SetRow[]

    return rows.map((row) => {
      const set = mapSet(row)
      const degree = this.researchStats(set.id)

      return {
        ...set,
        nodeCount: this.countNodes(set.id),
        pointCount: degree.totalPoints,
        degree,
      }
    })
  }

  countNodes(setId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM set_nodes WHERE set_id = ?')
      .get(setId) as { count: number }
    return row.count
  }

  addNodes(setId: string, nodes: SetNodeInput[]): SetNodeRecord[] {
    if (!this.get(setId)) throw new Error(`专业集不存在：${setId}`)

    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM set_nodes WHERE set_id = ?')
      .get(setId) as { position: number }
    let position = next.position

    const insert = this.db.prepare(
      `INSERT INTO set_nodes (id, set_id, kind, ref_id, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(set_id, kind, ref_id) DO NOTHING`,
    )

    this.db.exec('BEGIN')
    try {
      for (const node of nodes) {
        insert.run(randomUUID(), setId, node.kind, node.refId, position, new Date().toISOString())
        position += 1
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return nodes.map(node => this.findNode(setId, node.kind, node.refId)!).filter(Boolean)
  }

  removeNode(setId: string, nodeId: string): void {
    this.db.prepare('DELETE FROM set_nodes WHERE id = ? AND set_id = ?').run(nodeId, setId)
  }

  addEdge(
    setId: string,
    input: { sourceId: string; targetId: string; kind: SetEdgeKind },
  ): SetEdgeRecord {
    if (input.sourceId === input.targetId) throw new Error('不能让节点指向自己')

    const source = this.findNodeById(setId, input.sourceId)
    const target = this.findNodeById(setId, input.targetId)
    if (!source || !target) throw new Error('关系端点必须属于当前专业集')

    const id = randomUUID()
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(
          `INSERT INTO set_edges (id, set_id, source_id, target_id, kind, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, setId, input.sourceId, input.targetId, input.kind, now)
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('相同关系已存在')
      throw error
    }

    return this.findEdge(id)!
  }

  removeEdge(setId: string, edgeId: string): void {
    this.db.prepare('DELETE FROM set_edges WHERE id = ? AND set_id = ?').run(edgeId, setId)
  }

  listNodes(setId: string): SetNodeView[] {
    const rows = this.db.prepare(`${NODE_SELECT} ORDER BY sn.position, sn.created_at`).all(
      setId,
    ) as unknown as NodeRow[]
    return rows.map(mapNode)
  }

  listEdges(setId: string): SetEdgeRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM set_edges WHERE set_id = ? ORDER BY created_at, source_id, target_id',
      )
      .all(setId) as unknown as EdgeRow[]
    return rows.map(mapEdge)
  }

  researchStats(setId: string): ResearchDegree {
    const rows = this.db
      .prepare(
        `WITH refs AS (
           SELECT sn.ref_id AS point_id
           FROM set_nodes sn
           WHERE sn.set_id = ? AND sn.kind = 'point'
           UNION
           SELECT kp.id AS point_id
           FROM set_nodes sn
           JOIN knowledge_points kp ON kp.carrier_id = sn.ref_id
           WHERE sn.set_id = ? AND sn.kind = 'carrier'
         )
         SELECT kp.status AS status,
                m.point_id AS mastery_point_id,
                m.stability, m.difficulty, m.due_at, m.reps, m.lapses, m.card_state,
                m.scheduled_days, m.learning_steps, m.last_reviewed_at, m.last_rating,
                m.accuracy_ewma
         FROM refs
         JOIN knowledge_points kp ON kp.id = refs.point_id
         JOIN carriers c ON c.id = kp.carrier_id AND c.deleted_at IS NULL
         LEFT JOIN mastery m ON m.point_id = kp.id`,
      )
      .all(setId, setId) as unknown as StatsRow[]

    const now = new Date()
    const masteryScores = rows.map(row => masteryScore(toReviewState(row), now))

    return researchDegree({
      totalPoints: rows.length,
      confirmedPoints: rows.filter(row => row.status === 'confirmed').length,
      reviewedPoints: rows.filter(row => (row.reps ?? 0) > 0).length,
      totalReps: rows.reduce((sum, row) => sum + (row.reps ?? 0), 0),
      masteryScores,
    })
  }

  private findNode(setId: string, kind: SetNodeKind, refId: string): SetNodeRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, set_id, kind, ref_id, position, created_at
         FROM set_nodes WHERE set_id = ? AND kind = ? AND ref_id = ?`,
      )
      .get(setId, kind, refId) as NodeBaseRow | undefined

    return row ? mapNodeBase(row) : undefined
  }

  private findNodeById(setId: string, nodeId: string): SetNodeRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, set_id, kind, ref_id, position, created_at
         FROM set_nodes WHERE set_id = ? AND id = ?`,
      )
      .get(setId, nodeId) as NodeBaseRow | undefined

    return row ? mapNodeBase(row) : undefined
  }

  private findEdge(edgeId: string): SetEdgeRecord | undefined {
    const row = this.db.prepare('SELECT * FROM set_edges WHERE id = ?').get(edgeId) as
      | EdgeRow
      | undefined
    return row ? mapEdge(row) : undefined
  }
}
