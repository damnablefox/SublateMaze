import type { Context } from '@deepseek-ai/cordis'
import type { ResearchDegree } from '@sublate/core'
import { z } from 'zod'

export const name = 'sets'
export const inject: string[] = []

export type SetNodeKind = 'point' | 'carrier'
export type SetEdgeKind = 'prereq' | 'related'

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
  updatePositions(setId: string, positions: { id: string; x: number; y: number }[]): void
  addEdge(
    setId: string,
    input: { sourceId: string; targetId: string; kind: SetEdgeKind },
  ): SetEdgeLike
  removeEdge(setId: string, edgeId: string): void
  listNodes(setId: string): SetNodeLike[]
  listEdges(setId: string): SetEdgeLike[]
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
  degree: ResearchDegree
}

export interface SetOptions {
  carriers: { id: string; title: string }[]
  points: { id: string; title: string; carrierId: string; carrierTitle: string }[]
}

const MAX_TITLE_LENGTH = 100
const MAX_NODES = 500

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
