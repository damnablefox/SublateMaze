/**
 * 专业集画布布局：平台无关的分层排布。
 *
 * 只使用「前置」关系分层，相关关系不影响层级；
 * 环中的节点追加到最大层之后，保证每个节点都有坐标。
 */

export interface LayoutNodeInput {
  id: string
  kind: 'point' | 'carrier'
  position?: number
}

export interface LayoutEdgeInput {
  sourceId: string
  targetId: string
  kind: 'prereq' | 'related'
}

export interface NodePosition {
  nodeId: string
  x: number
  y: number
}

export interface LayoutOptions {
  columnGap?: number
  rowGap?: number
  originX?: number
  originY?: number
}

const DEFAULT_COLUMN_GAP = 360
const DEFAULT_ROW_GAP = 132

export function layoutSetNodes(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  options: LayoutOptions = {},
): NodePosition[] {
  if (nodes.length === 0) return []

  const columnGap = options.columnGap ?? DEFAULT_COLUMN_GAP
  const rowGap = options.rowGap ?? DEFAULT_ROW_GAP
  const originX = options.originX ?? 0
  const originY = options.originY ?? 0

  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const outgoing = new Map<string, string[]>()
  const indegree = new Map(nodes.map(node => [node.id, 0]))

  for (const edge of edges) {
    if (edge.kind !== 'prereq') continue
    if (!indegree.has(edge.sourceId) || !indegree.has(edge.targetId)) continue
    if (edge.sourceId === edge.targetId) continue

    const targets = outgoing.get(edge.sourceId) ?? []
    targets.push(edge.targetId)
    outgoing.set(edge.sourceId, targets)
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1)
  }

  const layers = new Map<string, number>()
  const queue = nodes
    .filter(node => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
    .map(node => node.id)

  for (const id of queue) layers.set(id, 0)

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentLayer = layers.get(current) ?? 0

    for (const target of outgoing.get(current) ?? []) {
      layers.set(target, Math.max(layers.get(target) ?? 0, currentLayer + 1))
      const nextDegree = (indegree.get(target) ?? 1) - 1
      indegree.set(target, nextDegree)
      if (nextDegree === 0) queue.push(target)
    }
  }

  const remaining = nodes
    .filter(node => !layers.has(node.id))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))

  if (remaining.length > 0) {
    const maxLayer = Math.max(-1, ...layers.values())
    for (const [index, node] of remaining.entries()) {
      layers.set(node.id, maxLayer + 1 + Math.floor(index / 6))
    }
  }

  const byLayer = new Map<number, LayoutNodeInput[]>()
  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0
    const list = byLayer.get(layer) ?? []
    list.push(node)
    byLayer.set(layer, list)
  }

  const positions: NodePosition[] = []
  for (const [layer, list] of [...byLayer.entries()].sort((left, right) => left[0] - right[0])) {
    list.sort((left, right) => {
      const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER
      const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER
      if (leftPosition !== rightPosition) return leftPosition - rightPosition
      return (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
    })

    for (const [index, node] of list.entries()) {
      positions.push({
        nodeId: node.id,
        x: originX + layer * columnGap,
        y: originY + index * rowGap,
      })
    }
  }

  return positions
}
