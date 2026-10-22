/// <reference types="vite/client" />

export interface PluginState {
  id: string
  name: string
  status: 'running' | 'disabled' | 'failed'
  error?: string
}

export interface CarrierFileInfo {
  sha256: string
  relPath: string
  mime: string
  size: number
}

export interface Carrier {
  id: string
  kind: 'pdf' | 'web'
  title: string
  authors: string[]
  sourceUrl?: string
  language?: string
  pageCount: number
  status: 'pending' | 'parsing' | 'ready' | 'failed'
  error?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  file: CarrierFileInfo
}

export interface ReadState {
  pageNo: number
  scrollRatio: number
}

export interface PageText {
  pageNo: number
  text: string
}

export interface SearchHit {
  carrierId: string
  title: string
  pageNo: number
  snippet: string
}

export interface ImportResult {
  carrierId?: string
  title: string
  duplicated: boolean
  status: 'ready' | 'failed'
  error?: string
}

export interface CarrierDetail {
  carrier: Carrier
  readState?: ReadState
}

export interface KnowledgeUnit {
  id: string
  carrierId: string
  title: string
  pageStart?: number
  pageEnd?: number
  status: 'draft' | 'confirmed'
  source: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface KnowledgePoint {
  id: string
  unitId?: string
  carrierId: string
  title: string
  content: string
  pageStart: number
  pageEnd: number
  status: 'draft' | 'confirmed' | 'rejected'
  source: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface KnowledgeStats {
  total: number
  draft: number
  confirmed: number
  rejected: number
}

export interface AiJobSummary {
  id: string
  kind: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
  createdAt: string
}

export interface KnowledgeSnapshot {
  units: KnowledgeUnit[]
  points: KnowledgePoint[]
  stats: KnowledgeStats
  jobs: AiJobSummary[]
}

export interface ExtractResult {
  jobId: string
  status: 'done' | 'failed'
  unitCount: number
  pointCount: number
  error?: string
}

export interface Course {
  id: string
  title: string
  description: string
  status: 'active' | 'archived'
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

export interface CourseDetail {
  course: Course
  units: CourseUnit[]
  points: CoursePoint[]
}

export interface Goal {
  id: string
  courseId: string
  title: string
  targetDate?: string
  dailyMinutes?: number
  status: 'active' | 'done' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface Plan {
  id: string
  courseId: string
  goalId?: string
  startDate: string
  days: number
  dailyMinutes: number
  status: 'active' | 'archived'
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
  status: 'pending' | 'done' | 'skipped'
  completedAt?: string
  updatedAt: string
  pageStart: number
  pageEnd: number
  courseId: string
  courseTitle: string
}

export interface PlanConflict {
  pointId: string
  dependsOnId: string
  message: string
}

export interface PlanDetail {
  plan: Plan
  items: PlanItem[]
  conflicts: PlanConflict[]
}

export interface PlanGenerateResult extends PlanDetail {
  extended: boolean
  message?: string
}

export interface TodaySnapshot {
  date: string
  due: PlanItem[]
  overdue: PlanItem[]
  stats: { total: number; pending: number; done: number; skipped: number }
}

export interface ReviewCard {
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
  due: ReviewCard[]
  newCards: ReviewCard[]
  stats: ReviewStats
}

export interface ReviewResult {
  pointId: string
  dueAt: string
  intervalDays: number
  mastery: number
  accuracy: number
}

export interface BudgetResult {
  totalMinutes: number
  reserveMinutes: number
  availableMinutes: number
  reviewSlots: number
  newSlots: number
  reviewMinutes: number
  newMinutes: number
  message: string
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

export interface AgentEvent {
  seq: number
  type: string
  payload: unknown
  createdAt: string
}

export interface AgentPending {
  tool: string
  args: unknown
  permission: 'read' | 'write-draft' | 'write-commit' | 'dangerous'
}

export interface AgentStep {
  sessionId: string
  status: 'running' | 'confirm' | 'done' | 'error'
  events: AgentEvent[]
  pending?: AgentPending
  answer?: string
  error?: string
  usedTokens: number
  budgetTokens: number
}

export interface AgentSkillInfo {
  id: string
  title: string
  description: string
  keywords: string[]
  tools: string[]
  example: string
}

export interface SessionSummary {
  id: string
  goal: string
  title: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  budgetTokens: number
  usedTokens: number
  createdAt: string
  updatedAt: string
  eventCount: number
}

export interface SessionDetail {
  id: string
  goal: string
  title: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  budgetTokens: number
  usedTokens: number
  answer?: string
  createdAt: string
  updatedAt: string
  events: AgentEvent[]
}

export type NoteRefType = 'point' | 'carrier'

export interface NoteRef {
  refType: NoteRefType
  refId: string
}

export interface NoteRecord {
  id: string
  title: string
  titleKey: string
  body: string
  relPath: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  excerpt: string
}

export interface NoteSummary extends NoteRecord {
  linkCount: number
  backlinkCount: number
  refs: NoteRef[]
}

export interface NoteLink {
  noteId: string
  targetTitle: string
  targetKey: string
  targetNoteId?: string
  targetNoteTitle?: string
}

export interface NoteBacklink {
  noteId: string
  title: string
  targetTitle: string
  updatedAt: string
  excerpt: string
}

export interface NoteDetail {
  note: NoteRecord
  links: NoteLink[]
  backlinks: NoteBacklink[]
  refs: NoteRef[]
}

export interface NoteRefOptions {
  carriers: { id: string; title: string }[]
  points: { id: string; title: string; carrierId: string; carrierTitle: string }[]
}

export interface ResearchDegree {
  breadth: number
  depth: number
  mastery: number
  score: number
  level: '入门' | '进阶' | '熟练' | '精通'
  totalPoints: number
  confirmedPoints: number
  reviewedPoints: number
}

export type SetNodeKind = 'point' | 'carrier'
export type SetEdgeKind = 'prereq' | 'related'

export interface SetRecord {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface SetNode {
  id: string
  setId: string
  kind: SetNodeKind
  refId: string
  position: number
  x?: number
  y?: number
  createdAt: string
  title: string
  subtitle?: string
  status?: string
  missing: boolean
}

export interface SetEdge {
  id: string
  setId: string
  sourceId: string
  targetId: string
  kind: SetEdgeKind
  createdAt: string
}

export interface SetSummary extends SetRecord {
  nodeCount: number
  pointCount: number
  degree: ResearchDegree
}

export interface SetDetail {
  set: SetRecord
  nodes: SetNode[]
  edges: SetEdge[]
  degree: ResearchDegree
}

export interface SetOptions {
  carriers: { id: string; title: string }[]
  points: { id: string; title: string; carrierId: string; carrierTitle: string }[]
}

declare global {
  interface Window {
    sublate: {
      getPlugins(): Promise<PluginState[]>
      demoPing(): Promise<string>
      library: {
        list(): Promise<Carrier[]>
        pickFiles(): Promise<string[]>
        importFiles(paths: string[]): Promise<ImportResult[]>
        importUrl(url: string): Promise<ImportResult>
        detail(id: string): Promise<CarrierDetail>
        file(id: string): Promise<Uint8Array>
        pages(id: string, from: number, to: number): Promise<PageText[]>
        saveReadPosition(id: string, pageNo: number, scrollRatio: number): Promise<void>
        remove(id: string): Promise<void>
        restore(id: string): Promise<void>
        trash(): Promise<Carrier[]>
        search(text: string): Promise<SearchHit[]>
      }
      knowledge: {
        list(carrierId: string): Promise<KnowledgeSnapshot>
        extract(carrierId: string): Promise<ExtractResult>
        confirm(ids: string[]): Promise<void>
        reject(ids: string[]): Promise<void>
        setAnchor(id: string, pageStart: number, pageEnd: number): Promise<void>
        merge(ids: string[]): Promise<{ id: string }>
        split(id: string, splitPage: number): Promise<{ firstId: string; secondId: string }>
      }
      course: {
        list(): Promise<CourseSummary[]>
        create(title: string, description?: string, dailyMinutes?: number): Promise<Course>
        update(id: string, patch: Record<string, unknown>): Promise<void>
        remove(id: string): Promise<void>
        detail(id: string): Promise<CourseDetail>
        createUnit(courseId: string, title: string): Promise<CourseUnit>
        updateUnit(id: string, title: string): Promise<void>
        removeUnit(id: string): Promise<void>
        addPoints(courseId: string, unitId: string | null, pointIds: string[]): Promise<CoursePoint[]>
        removePoints(ids: string[]): Promise<void>
        movePoint(id: string, patch: { unitId?: string | null; position?: number }): Promise<void>
        setDepends(id: string, dependsOn: string[]): Promise<void>
        availablePoints(id: string): Promise<AvailablePoint[]>
      }
      planner: {
        goals(courseId: string): Promise<Goal[]>
        createGoal(
          courseId: string,
          title: string,
          targetDate?: string,
          dailyMinutes?: number,
        ): Promise<Goal>
        updateGoal(id: string, patch: Record<string, unknown>): Promise<void>
        deleteGoal(id: string): Promise<void>
        plans(courseId: string): Promise<PlanSummary[]>
        planDetail(id: string): Promise<PlanDetail>
        generatePlan(input: {
          courseId: string
          goalId?: string
          startDate?: string
          days?: number
          dailyMinutes?: number
        }): Promise<PlanGenerateResult>
        replan(id: string, dailyMinutes: number): Promise<PlanDetail>
        deletePlan(id: string): Promise<void>
        setItemStatus(id: string, status: 'pending' | 'done' | 'skipped'): Promise<PlanDetail>
        moveItem(id: string, date: string, position?: number): Promise<PlanDetail>
        today(date?: string): Promise<TodaySnapshot>
      }
      review: {
        queue(limit?: number): Promise<ReviewQueue>
        submit(pointId: string, rating: 1 | 2 | 3 | 4): Promise<ReviewResult>
        stats(): Promise<ReviewStats>
        overview(): Promise<ReviewOverview>
        history(pointId: string): Promise<unknown[]>
      }
      agent: {
        start(goal: string, budgetTokens?: number): Promise<AgentStep>
        step(sessionId: string, approved?: boolean): Promise<AgentStep>
        cancel(sessionId: string): Promise<void>
        sessions(): Promise<SessionSummary[]>
        session(id: string): Promise<SessionDetail>
        skills(): Promise<AgentSkillInfo[]>
      }
      notes: {
        list(options?: { includeDeleted?: boolean; query?: string }): Promise<NoteSummary[]>
        trash(): Promise<NoteSummary[]>
        detail(id: string): Promise<NoteDetail>
        create(input: { title: string; body?: string; refs?: NoteRef[] }): Promise<NoteDetail>
        update(
          id: string,
          patch: { title?: string; body?: string; refs?: NoteRef[] },
        ): Promise<NoteDetail>
        remove(id: string): Promise<void>
        restore(id: string): Promise<NoteDetail>
        purge(id: string): Promise<void>
        forRef(refType: NoteRefType, refId: string): Promise<NoteRecord[]>
        refOptions(): Promise<NoteRefOptions>
      }
      sets: {
        list(): Promise<SetSummary[]>
        detail(id: string): Promise<SetDetail>
        create(title: string, description?: string): Promise<SetDetail>
        update(
          id: string,
          patch: { title?: string; description?: string },
        ): Promise<SetDetail>
        remove(id: string): Promise<void>
        addNodes(
          id: string,
          nodes: { kind: SetNodeKind; refId: string }[],
        ): Promise<SetDetail>
        removeNode(id: string, nodeId: string): Promise<SetDetail>
        updatePositions(
          id: string,
          positions: { nodeId: string; x: number; y: number }[],
        ): Promise<SetDetail>
        addEdge(
          id: string,
          input: { sourceId: string; targetId: string; kind: SetEdgeKind },
        ): Promise<SetDetail>
        removeEdge(id: string, edgeId: string): Promise<SetDetail>
        options(): Promise<SetOptions>
      }
    }
  }
}

export {}
