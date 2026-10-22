import type { Context } from '@deepseek-ai/cordis'
import type { ResearchDegree } from '@sublate/core'
import { z } from 'zod'

export const name = 'sets'
export const inject: string[] = []

export type SetNodeKind = 'point' | 'carrier'
export type SetEdgeKind = 'prereq' | 'related'
export type SetCommentColor = 'amber' | 'blue' | 'green' | 'red'

interface SetRecordLike {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
}

interface SetNodeLike {
  id: string
  setId: string
  kind: SetNodeKind
  refId: string
  position: number
  x?: number
  y?: number
  alias?: string
  note?: string
  createdAt: string
  title: string
  subtitle?: string
  status?: string
  missing: boolean
}

interface SetEdgeLike {
  id: string
  setId: string
  sourceId: string
  targetId: string
  kind: SetEdgeKind
  createdAt: string
}

interface SetCommentLike {
  id: string
  setId: string
  text: string
  x: number
  y: number
  width: number
  height: number
  color: SetCommentColor
  createdAt: string
}

interface SetSummaryLike extends SetRecordLike {
  nodeCount: number
  pointCount: number
  degree: ResearchDegree
}

interface SetStoreLike {
  create(input: { title: string; description?: string }): SetRecordLike
  update(id: string, patch: { title?: string; description?: string }): void
  remove(id: string): void
  get(id: string): SetRecordLike | undefined
  list(): SetSummaryLike[]
  addNodes(setId: string, nodes: { kind: SetNodeKind; refId: string }[]): unknown[]
  removeNode(setId: string, nodeId: string): void
  updateNode(
    setId: string,
    nodeId: string,
    patch: { alias?: string | null; note?: string | null },
  ): void
  updatePositions(setId: string, positions: { id: string; x: number; y: number }[]): void
  addEdge(
    setId: string,
    input: { sourceId: string; targetId: string; kind: SetEdgeKind },
  ): SetEdgeLike
  updateEdge(setId: string, edgeId: string, kind: SetEdgeKind): void
  removeEdge(setId: string, edgeId: string): void
  listNodes(setId: string): SetNodeLike[]
  listEdges(setId: string): SetEdgeLike[]
  listComments(setId: string): SetCommentLike[]
  addComment(
    setId: string,
    input: {
      x: number
      y: number
      width?: number
      height?: number
      text?: string
      color?: SetCommentColor
    },
  ): SetCommentLike
  updateComment(
    setId: string,
    commentId: string,
    patch: {
      x?: number
      y?: number
      width?: number
      height?: number
      text?: string
      color?: SetCommentColor
    },
  ): void
  removeComment(setId: string, commentId: string): void
  researchStats(setId: string): ResearchDegree
}

interface CarrierLike {
  id: string
  title: string
  deletedAt?: string
}

interface PointLike {
  id: string
  title: string
}

interface DbLike {
  sets: SetStoreLike
  carriers: { list(): CarrierLike[] }
  knowledge: { listPoints(carrierId: string): PointLike[] }
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

export interface SetDetail {
  set: SetRecordLike
  nodes: SetNodeLike[]
  edges: SetEdgeLike[]
  comments: SetCommentLike[]
  degree: ResearchDegree
}

export interface SetOptions {
  carriers: { id: string; title: string }[]
  points: { id: string; title: string; carrierId: string; carrierTitle: string }[]
}

const MAX_TITLE_LENGTH = 100
const MAX_NODES = 500
const MAX_COMMENTS = 200
const MAX_ALIAS_LENGTH = 100
const MAX_NOTE_LENGTH = 1000
const MAX_COMMENT_TEXT = 2000

function normalizeText(
  value: string | null | undefined,
  max: number,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null

  const text = value.trim()
  if ([...text].length > max) throw new Error(`${field}不能超过 ${max} 字`)
  return text ? text : null
}

function assertCoordinate(value: number, field: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new Error(`${field}超出允许范围`)
  }
}

function assertSize(value: number, min: number, max: number, field: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field}必须在 ${min}–${max} 之间`)
  }
}

function assertTitle(title: string): void {
  if (!title) throw new Error('专业集标题不能为空')
  if ([...title].length > MAX_TITLE_LENGTH) {
    throw new Error(`专业集标题不能超过 ${MAX_TITLE_LENGTH} 字`)
  }
}

/** 专业集服务：集合、节点、关系与研究程度。 */
export class SetsService {
  private readonly db: DbLike

  constructor(deps: { db: DbLike }) {
    this.db = deps.db
  }

  list(): SetSummaryLike[] {
    return this.db.sets.list()
  }

  detail(id: string): SetDetail {
    const set = this.db.sets.get(id)
    if (!set) throw new Error(`专业集不存在：${id}`)

    return {
      set,
      nodes: this.db.sets.listNodes(id),
      edges: this.db.sets.listEdges(id),
      comments: this.db.sets.listComments(id),
      degree: this.db.sets.researchStats(id),
    }
  }

  create(input: { title: string; description?: string }): SetDetail {
    const title = input.title.trim()
    assertTitle(title)

    const set = this.db.sets.create({ title, description: input.description?.trim() })
    return this.detail(set.id)
  }

  update(id: string, patch: { title?: string; description?: string }): SetDetail {
    if (patch.title !== undefined) assertTitle(patch.title.trim())

    this.db.sets.update(id, {
      title: patch.title?.trim(),
      description: patch.description?.trim(),
    })
    return this.detail(id)
  }

  remove(id: string): void {
    this.db.sets.remove(id)
  }

  addNodes(id: string, nodes: { kind: SetNodeKind; refId: string }[]): SetDetail {
    if (nodes.length === 0) throw new Error('请选择要加入的知识点或载体')
    if (nodes.length > MAX_NODES) throw new Error(`一次最多添加 ${MAX_NODES} 个节点`)

    this.db.sets.addNodes(id, nodes)
    return this.detail(id)
  }

  removeNode(id: string, nodeId: string): SetDetail {
    this.db.sets.removeNode(id, nodeId)
    return this.detail(id)
  }

  updateNode(
    id: string,
    nodeId: string,
    patch: { alias?: string | null; note?: string | null },
  ): SetDetail {
    const detail = this.detail(id)
    if (!detail.nodes.some(node => node.id === nodeId)) throw new Error('节点不存在')

    this.db.sets.updateNode(id, nodeId, {
      alias: normalizeText(patch.alias, MAX_ALIAS_LENGTH, '节点别名'),
      note: normalizeText(patch.note, MAX_NOTE_LENGTH, '节点备注'),
    })
    return this.detail(id)
  }

  updatePositions(
    id: string,
    positions: { nodeId: string; x: number; y: number }[],
  ): SetDetail {
    if (positions.length === 0) throw new Error('没有要保存的画布坐标')
    if (positions.length > MAX_NODES) throw new Error(`一次最多保存 ${MAX_NODES} 个坐标`)

    for (const position of positions) {
      if (
        !Number.isFinite(position.x)
        || !Number.isFinite(position.y)
        || Math.abs(position.x) > 1_000_000
        || Math.abs(position.y) > 1_000_000
      ) {
        throw new Error('画布坐标超出允许范围')
      }
    }

    this.db.sets.updatePositions(
      id,
      positions.map(position => ({
        id: position.nodeId,
        x: position.x,
        y: position.y,
      })),
    )
    return this.detail(id)
  }

  addEdge(
    id: string,
    input: { sourceId: string; targetId: string; kind: SetEdgeKind },
  ): SetDetail {
    const nodes = this.db.sets.listNodes(id)
    const source = nodes.find(node => node.id === input.sourceId)
    const target = nodes.find(node => node.id === input.targetId)

    if (!source || !target) throw new Error('关系端点必须属于当前专业集')
    if (target.kind !== 'point') throw new Error('关系目标必须是知识点')
    if (input.kind === 'prereq' && source.kind !== 'point') {
      throw new Error('前置关系的起点必须是知识点')
    }

    this.db.sets.addEdge(id, input)
    return this.detail(id)
  }

  removeEdge(id: string, edgeId: string): SetDetail {
    this.db.sets.removeEdge(id, edgeId)
    return this.detail(id)
  }

  updateEdge(id: string, edgeId: string, kind: SetEdgeKind): SetDetail {
    const detail = this.detail(id)
    const edge = detail.edges.find(item => item.id === edgeId)
    if (!edge) throw new Error('关系不存在')

    const source = detail.nodes.find(node => node.id === edge.sourceId)
    const target = detail.nodes.find(node => node.id === edge.targetId)
    if (!source || !target) throw new Error('关系端点必须属于当前专业集')
    if (target.kind !== 'point') throw new Error('关系目标必须是知识点')
    if (kind === 'prereq' && source.kind !== 'point') {
      throw new Error('前置关系的起点必须是知识点')
    }

    this.db.sets.updateEdge(id, edgeId, kind)
    return this.detail(id)
  }

  addComment(
    id: string,
    input: {
      x: number
      y: number
      width?: number
      height?: number
      text?: string
      color?: SetCommentColor
    },
  ): SetDetail {
    if (this.db.sets.listComments(id).length >= MAX_COMMENTS) {
      throw new Error(`每个专业集最多 ${MAX_COMMENTS} 个注释`)
    }

    assertCoordinate(input.x, '注释坐标 X')
    assertCoordinate(input.y, '注释坐标 Y')
    if (input.width !== undefined) assertSize(input.width, 80, 1200, '注释宽度')
    if (input.height !== undefined) assertSize(input.height, 60, 1000, '注释高度')

    const text = normalizeText(input.text, MAX_COMMENT_TEXT, '注释文本')

    this.db.sets.addComment(id, {
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      text: text ?? '',
      color: input.color,
    })
    return this.detail(id)
  }

  updateComment(
    id: string,
    commentId: string,
    patch: {
      x?: number
      y?: number
      width?: number
      height?: number
      text?: string
      color?: SetCommentColor
    },
  ): SetDetail {
    if (patch.x !== undefined) assertCoordinate(patch.x, '注释坐标 X')
    if (patch.y !== undefined) assertCoordinate(patch.y, '注释坐标 Y')
    if (patch.width !== undefined) assertSize(patch.width, 80, 1200, '注释宽度')
    if (patch.height !== undefined) assertSize(patch.height, 60, 1000, '注释高度')

    const text = normalizeText(patch.text, MAX_COMMENT_TEXT, '注释文本')

    this.db.sets.updateComment(id, commentId, {
      x: patch.x,
      y: patch.y,
      width: patch.width,
      height: patch.height,
      text: text === undefined ? undefined : (text ?? ''),
      color: patch.color,
    })
    return this.detail(id)
  }

  removeComment(id: string, commentId: string): SetDetail {
    this.db.sets.removeComment(id, commentId)
    return this.detail(id)
  }

  options(): SetOptions {
    const carriers = this.db.carriers.list().filter(carrier => !carrier.deletedAt)
    const points = carriers.flatMap(carrier =>
      this.db.knowledge.listPoints(carrier.id).map(point => ({
        id: point.id,
        title: point.title,
        carrierId: carrier.id,
        carrierTitle: carrier.title,
      })),
    )

    return {
      carriers: carriers.map(carrier => ({ id: carrier.id, title: carrier.title })),
      points,
    }
  }
}

const IdInput = z.object({ id: z.string().min(1) })

const CreateInput = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  description: z.string().max(2000).optional(),
})

const UpdateInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
  description: z.string().max(2000).optional(),
})

const NodesInput = z.object({
  id: z.string().min(1),
  nodes: z
    .array(
      z.object({
        kind: z.enum(['point', 'carrier']),
        refId: z.string().min(1),
      }),
    )
    .min(1)
    .max(MAX_NODES),
})

const RemoveNodeInput = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
})

const PositionsInput = z.object({
  id: z.string().min(1),
  positions: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        x: z.number().finite().min(-1_000_000).max(1_000_000),
        y: z.number().finite().min(-1_000_000).max(1_000_000),
      }),
    )
    .min(1)
    .max(MAX_NODES),
})

const EdgeInput = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  kind: z.enum(['prereq', 'related']),
})

const UpdateNodeInput = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  alias: z.string().max(MAX_ALIAS_LENGTH).nullable().optional(),
  note: z.string().max(MAX_NOTE_LENGTH).nullable().optional(),
})

const UpdateEdgeInput = z.object({
  id: z.string().min(1),
  edgeId: z.string().min(1),
  kind: z.enum(['prereq', 'related']),
})

const CommentColor = z.enum(['amber', 'blue', 'green', 'red'])
const Coordinate = z.number().finite().min(-1_000_000).max(1_000_000)

const AddCommentInput = z.object({
  id: z.string().min(1),
  x: Coordinate,
  y: Coordinate,
  width: z.number().finite().min(80).max(1200).optional(),
  height: z.number().finite().min(60).max(1000).optional(),
  text: z.string().max(MAX_COMMENT_TEXT).optional(),
  color: CommentColor.optional(),
})

const UpdateCommentInput = z.object({
  id: z.string().min(1),
  commentId: z.string().min(1),
  x: Coordinate.optional(),
  y: Coordinate.optional(),
  width: z.number().finite().min(80).max(1200).optional(),
  height: z.number().finite().min(60).max(1000).optional(),
  text: z.string().max(MAX_COMMENT_TEXT).optional(),
  color: CommentColor.optional(),
})

const RemoveCommentInput = z.object({
  id: z.string().min(1),
  commentId: z.string().min(1),
})

const RemoveEdgeInput = z.object({
  id: z.string().min(1),
  edgeId: z.string().min(1),
})

function registerChannels(ctx: Context, sets: SetsService, ipc: IpcLike): void {
  const disposers: (() => void)[] = []
  const register = (channel: string, handler: (...args: any[]) => any) => {
    disposers.push(ipc.register(channel, handler))
  }

  register('set:list', () => sets.list())
  register('set:detail', (input: unknown) => sets.detail(IdInput.parse(input).id))
  register('set:create', (input: unknown) => sets.create(CreateInput.parse(input)))
  register('set:update', (input: unknown) => {
    const { id, ...patch } = UpdateInput.parse(input)
    return sets.update(id, patch)
  })
  register('set:delete', (input: unknown) => {
    sets.remove(IdInput.parse(input).id)
  })
  register('set:add-nodes', (input: unknown) => {
    const data = NodesInput.parse(input)
    return sets.addNodes(data.id, data.nodes)
  })
  register('set:remove-node', (input: unknown) => {
    const data = RemoveNodeInput.parse(input)
    return sets.removeNode(data.id, data.nodeId)
  })
  register('set:update-node', (input: unknown) => {
    const data = UpdateNodeInput.parse(input)
    return sets.updateNode(data.id, data.nodeId, { alias: data.alias, note: data.note })
  })
  register('set:update-positions', (input: unknown) => {
    const data = PositionsInput.parse(input)
    return sets.updatePositions(data.id, data.positions)
  })
  register('set:add-edge', (input: unknown) => {
    const data = EdgeInput.parse(input)
    return sets.addEdge(data.id, {
      sourceId: data.sourceId,
      targetId: data.targetId,
      kind: data.kind,
    })
  })
  register('set:remove-edge', (input: unknown) => {
    const data = RemoveEdgeInput.parse(input)
    return sets.removeEdge(data.id, data.edgeId)
  })
  register('set:update-edge', (input: unknown) => {
    const data = UpdateEdgeInput.parse(input)
    return sets.updateEdge(data.id, data.edgeId, data.kind)
  })
  register('set:add-comment', (input: unknown) => {
    const data = AddCommentInput.parse(input)
    return sets.addComment(data.id, {
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
      text: data.text,
      color: data.color,
    })
  })
  register('set:update-comment', (input: unknown) => {
    const data = UpdateCommentInput.parse(input)
    return sets.updateComment(data.id, data.commentId, {
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
      text: data.text,
      color: data.color,
    })
  })
  register('set:remove-comment', (input: unknown) => {
    const data = RemoveCommentInput.parse(input)
    return sets.removeComment(data.id, data.commentId)
  })
  register('set:options', () => sets.options())

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })

  ctx.logger('sets').info('专业集频道已注册')
}

export function apply(ctx: Context) {
  const db = ctx.get('db') as DbLike | undefined
  if (!db?.sets) throw new Error('sets 需要 db.sets 服务')

  const service = new SetsService({ db })
  ctx.provide('sets', service)

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) {
    registerChannels(ctx, service, ipc)
  } else {
    ctx.logger('sets').warn('IPC 服务不可用，专业集频道未注册')
  }
}
