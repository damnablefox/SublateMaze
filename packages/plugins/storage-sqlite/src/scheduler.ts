import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type ReviewRating = 1 | 2 | 3 | 4

export interface MasteryState {
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

export interface ReviewRecord {
  id: string
  pointId: string
  rating: ReviewRating
  reviewedAt: string
  retrievabilityBefore: number
  intervalDays: number
  stabilityAfter: number
  difficultyAfter: number
}

export interface ReviewCard {
  pointId: string
  title: string
  content: string
  carrierId: string
  carrierTitle: string
  pageStart: number
  pageEnd: number
  mastery?: MasteryState
}

export interface SaveReviewInput {
  pointId: string
  state: Omit<MasteryState, 'pointId' | 'updatedAt'>
  review: {
    rating: ReviewRating
    reviewedAt: string
    retrievabilityBefore: number
    intervalDays: number
    stabilityAfter: number
    difficultyAfter: number
  }
}

interface MasteryRow {
  point_id: string
  stability: number
  difficulty: number
  due_at: string | null
  reps: number
  lapses: number
  card_state: number
  scheduled_days: number
  learning_steps: number
  last_reviewed_at: string | null
  last_rating: number | null
  accuracy_ewma: number
  updated_at: string
}

interface ReviewRow {
  id: string
  point_id: string
  rating: number
  reviewed_at: string
  retrievability_before: number
  interval_days: number
  stability_after: number
  difficulty_after: number
}

interface CardRow {
  point_id: string
  title: string
  content: string
  carrier_id: string
  carrier_title: string
  page_start: number
  page_end: number
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
  updated_at: string | null
}

function mapMastery(row: MasteryRow): MasteryState {
  return {
    pointId: row.point_id,
    stability: row.stability,
    difficulty: row.difficulty,
    dueAt: row.due_at ?? undefined,
    reps: row.reps,
    lapses: row.lapses,
    cardState: row.card_state,
    scheduledDays: row.scheduled_days,
    learningSteps: row.learning_steps,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
    lastRating: (row.last_rating as ReviewRating | null) ?? undefined,
    accuracyEwma: row.accuracy_ewma,
    updatedAt: row.updated_at,
  }
}

function mapReview(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    pointId: row.point_id,
    rating: row.rating as ReviewRating,
    reviewedAt: row.reviewed_at,
    retrievabilityBefore: row.retrievability_before,
    intervalDays: row.interval_days,
    stabilityAfter: row.stability_after,
    difficultyAfter: row.difficulty_after,
  }
}

function mapCard(row: CardRow): ReviewCard {
  let mastery: MasteryState | undefined

  if (row.mastery_point_id && row.updated_at) {
    mastery = {
      pointId: row.mastery_point_id,
      stability: row.stability ?? 0,
      difficulty: row.difficulty ?? 0,
      dueAt: row.due_at ?? undefined,
      reps: row.reps ?? 0,
      lapses: row.lapses ?? 0,
      cardState: row.card_state ?? 0,
      scheduledDays: row.scheduled_days ?? 0,
      learningSteps: row.learning_steps ?? 0,
      lastReviewedAt: row.last_reviewed_at ?? undefined,
      lastRating: (row.last_rating as ReviewRating | null) ?? undefined,
      accuracyEwma: row.accuracy_ewma ?? 0.5,
      updatedAt: row.updated_at,
    }
  }

  return {
    pointId: row.point_id,
    title: row.title,
    content: row.content,
    carrierId: row.carrier_id,
    carrierTitle: row.carrier_title,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    mastery,
  }
}

const CARD_SELECT = `
  SELECT kp.id AS point_id, kp.title, kp.content, kp.carrier_id, c.title AS carrier_title,
         kp.page_start, kp.page_end,
         m.point_id AS mastery_point_id, m.stability, m.difficulty, m.due_at, m.reps, m.lapses,
         m.card_state, m.scheduled_days, m.learning_steps, m.last_reviewed_at, m.last_rating,
         m.accuracy_ewma, m.updated_at
  FROM knowledge_points kp
  JOIN carriers c ON c.id = kp.carrier_id
  LEFT JOIN mastery m ON m.point_id = kp.id
  WHERE kp.status = 'confirmed'
`

/** 知识点掌握状态与复习记录仓储。 */
export class SchedulerStore {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  get(pointId: string): MasteryState | undefined {
    const row = this.db
      .prepare(
        `SELECT point_id, stability, difficulty, due_at, reps, lapses, card_state,
                scheduled_days, learning_steps, last_reviewed_at, last_rating,
                accuracy_ewma, updated_at
         FROM mastery WHERE point_id = ?`,
      )
      .get(pointId) as MasteryRow | undefined

    return row ? mapMastery(row) : undefined
  }

  save(pointId: string, state: Omit<MasteryState, 'pointId' | 'updatedAt'>): void {
    const timestamp = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO mastery
           (point_id, stability, difficulty, due_at, reps, lapses, card_state,
            scheduled_days, learning_steps, last_reviewed_at, last_rating,
            accuracy_ewma, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(point_id) DO UPDATE SET
           stability = excluded.stability,
           difficulty = excluded.difficulty,
           due_at = excluded.due_at,
           reps = excluded.reps,
           lapses = excluded.lapses,
           card_state = excluded.card_state,
           scheduled_days = excluded.scheduled_days,
           learning_steps = excluded.learning_steps,
           last_reviewed_at = excluded.last_reviewed_at,
           last_rating = excluded.last_rating,
           accuracy_ewma = excluded.accuracy_ewma,
           updated_at = excluded.updated_at`,
      )
      .run(
        pointId,
        state.stability,
        state.difficulty,
        state.dueAt ?? null,
        state.reps,
        state.lapses,
        state.cardState,
        state.scheduledDays,
        state.learningSteps,
        state.lastReviewedAt ?? null,
        state.lastRating ?? null,
        state.accuracyEwma,
        timestamp,
      )
  }

  /** 一次复习同时更新掌握状态与追加记录，保证两者一致。 */
  saveReview(input: SaveReviewInput): void {
    const timestamp = new Date().toISOString()

    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO mastery
             (point_id, stability, difficulty, due_at, reps, lapses, card_state,
              scheduled_days, learning_steps, last_reviewed_at, last_rating,
              accuracy_ewma, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(point_id) DO UPDATE SET
             stability = excluded.stability,
             difficulty = excluded.difficulty,
             due_at = excluded.due_at,
             reps = excluded.reps,
             lapses = excluded.lapses,
             card_state = excluded.card_state,
             scheduled_days = excluded.scheduled_days,
             learning_steps = excluded.learning_steps,
             last_reviewed_at = excluded.last_reviewed_at,
             last_rating = excluded.last_rating,
             accuracy_ewma = excluded.accuracy_ewma,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.pointId,
          input.state.stability,
          input.state.difficulty,
          input.state.dueAt ?? null,
          input.state.reps,
          input.state.lapses,
          input.state.cardState,
          input.state.scheduledDays,
          input.state.learningSteps,
          input.state.lastReviewedAt ?? null,
          input.state.lastRating ?? null,
          input.state.accuracyEwma,
          timestamp,
        )

      this.db
        .prepare(
          `INSERT INTO reviews
             (id, point_id, rating, reviewed_at, retrievability_before, interval_days,
              stability_after, difficulty_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.pointId,
          input.review.rating,
          input.review.reviewedAt,
          input.review.retrievabilityBefore,
          input.review.intervalDays,
          input.review.stabilityAfter,
          input.review.difficultyAfter,
        )

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** 到期队列：已确认且到期时间不晚于 now，按到期时间升序。 */
  dueQueue(nowIso: string, limit = 30): ReviewCard[] {
    const rows = this.db
      .prepare(
        `${CARD_SELECT}
         AND m.due_at IS NOT NULL AND m.due_at <= ?
         ORDER BY m.due_at ASC
         LIMIT ?`,
      )
      .all(nowIso, limit) as unknown as CardRow[]

    return rows.map(mapCard)
  }

  /** 新卡队列：已确认但尚无复习记录的知识点。 */
  newQueue(limit = 20): ReviewCard[] {
    const rows = this.db
      .prepare(
        `${CARD_SELECT}
         AND (m.point_id IS NULL OR m.reps = 0)
         ORDER BY c.title ASC, kp.page_start ASC
         LIMIT ?`,
      )
      .all(limit) as unknown as CardRow[]

    return rows.map(mapCard)
  }

  history(pointId: string, limit = 20): ReviewRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, point_id, rating, reviewed_at, retrievability_before, interval_days,
                stability_after, difficulty_after
         FROM reviews WHERE point_id = ?
         ORDER BY reviewed_at DESC
         LIMIT ?`,
      )
      .all(pointId, limit) as unknown as ReviewRow[]

    return rows.map(mapReview)
  }

  reviewedBetween(fromIso: string, toIso: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM reviews WHERE reviewed_at >= ? AND reviewed_at < ?')
      .get(fromIso, toIso) as { count: number }

    return row.count
  }

  /** 供 scheduler 插件校验知识点状态。 */
  getPoint(pointId: string): { id: string; title: string; status: string } | undefined {
    return this.db
      .prepare('SELECT id, title, status FROM knowledge_points WHERE id = ?')
      .get(pointId) as { id: string; title: string; status: string } | undefined
  }

  countConfirmed(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM knowledge_points WHERE status = 'confirmed'")
      .get() as { count: number }

    return row.count
  }

  countDue(nowIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM knowledge_points kp
         JOIN mastery m ON m.point_id = kp.id
         WHERE kp.status = 'confirmed' AND m.due_at IS NOT NULL AND m.due_at <= ?`,
      )
      .get(nowIso) as { count: number }

    return row.count
  }

  countNew(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM knowledge_points kp
         LEFT JOIN mastery m ON m.point_id = kp.id
         WHERE kp.status = 'confirmed' AND (m.point_id IS NULL OR m.reps = 0)`,
      )
      .get() as { count: number }

    return row.count
  }

  listAll(): MasteryState[] {
    const rows = this.db
      .prepare(
        `SELECT point_id, stability, difficulty, due_at, reps, lapses, card_state,
                scheduled_days, learning_steps, last_reviewed_at, last_rating,
                accuracy_ewma, updated_at
         FROM mastery`,
      )
      .all() as unknown as MasteryRow[]

    return rows.map(mapMastery)
  }
}
