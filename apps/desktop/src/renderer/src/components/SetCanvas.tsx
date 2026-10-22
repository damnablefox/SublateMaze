import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { layoutSetNodes } from '@sublate/core'
import type {
  SetComment,
  SetCommentColor,
  SetEdge,
  SetEdgeKind,
  SetNode,
  SetNodeKind,
  SetOptions,
} from '../env'

const NODE_WIDTH = 248
const NODE_HEIGHT = 92
const HEADER_HEIGHT = 22
const SUBTITLE_HEIGHT = 18
const PIN_ROW_HEIGHT = 22
const PIN_TOP = HEADER_HEIGHT + SUBTITLE_HEIGHT + PIN_ROW_HEIGHT / 2
const MIN_SCALE = 0.4
const MAX_SCALE = 1.8
const ROUTING_KEY = 'sublate-canvas-routing'
const COMMENT_MIN_WIDTH = 160
const COMMENT_MIN_HEIGHT = 80
const COMMENT_MAX_WIDTH = 1200
const COMMENT_MAX_HEIGHT = 1000
const COMMENT_DEFAULT_WIDTH = 360
const COMMENT_DEFAULT_HEIGHT = 200
const COMMENT_COLORS: SetCommentColor[] = ['amber', 'blue', 'green', 'red']

type RoutingMode = 'manhattan' | 'diagonal'

interface Position {
  x: number
  y: number
}

interface ViewState {
  x: number
  y: number
  scale: number
}

interface CommentBox {
  x: number
  y: number
  width: number
  height: number
}

interface PinSpec {
  side: 'in' | 'out'
  kind: SetEdgeKind
  type: 'exec' | 'data'
  label: string
  row: number
}

type Interaction =
  | { mode: 'drag'; nodeId: string; offsetX: number; offsetY: number; moved: boolean }
  | { mode: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { mode: 'link'; sourceId: string; kind: SetEdgeKind }
  | { mode: 'comment-drag'; commentId: string; offsetX: number; offsetY: number }
  | {
    mode: 'comment-resize'
    commentId: string
    startX: number
    startY: number
    width: number
    height: number
  }

interface LinkPreview {
  sourceId: string
  kind: SetEdgeKind
  x: number
  y: number
}

type ContextTarget =
  | { type: 'canvas' }
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'comment'; id: string }

interface ContextMenuState {
  screenX: number
  screenY: number
  worldX: number
  worldY: number
  target: ContextTarget
}

type DialogState =
  | { type: 'node'; nodeId: string; title: string; alias: string; note: string }
  | { type: 'picker'; kind: SetNodeKind }

interface SetCanvasProps {
  nodes: SetNode[]
  edges: SetEdge[]
  comments: SetComment[]
  options: SetOptions
  onSavePositions(positions: { nodeId: string; x: number; y: number }[]): Promise<void>
  onAddNode(kind: SetNodeKind, refId: string, position: Position): Promise<void>
  onRemoveNode(nodeId: string): Promise<void>
  onUpdateNode(
    nodeId: string,
    patch: { alias?: string | null; note?: string | null },
  ): Promise<void>
  onAddEdge(sourceId: string, targetId: string, kind: SetEdgeKind): Promise<void>
  onUpdateEdge(edgeId: string, kind: SetEdgeKind): Promise<void>
  onRemoveEdge(edgeId: string): Promise<void>
  onAddComment(position: Position): Promise<void>
  onUpdateComment(
    commentId: string,
    patch: { x?: number; y?: number; width?: number; height?: number; text?: string; color?: SetCommentColor },
  ): Promise<void>
  onRemoveComment(commentId: string): Promise<void>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pinsFor(node: SetNode): PinSpec[] {
  if (node.kind === 'carrier') {
    return [{ side: 'out', kind: 'related', type: 'data', label: '来源', row: 0 }]
  }

  return [
    { side: 'in', kind: 'prereq', type: 'exec', label: '前置', row: 0 },
    { side: 'out', kind: 'prereq', type: 'exec', label: '后续', row: 0 },
    { side: 'in', kind: 'related', type: 'data', label: '相关', row: 1 },
    { side: 'out', kind: 'related', type: 'data', label: '相关', row: 1 },
  ]
}

function findPin(node: SetNode, side: PinSpec['side'], kind: SetEdgeKind): PinSpec | undefined {
  return pinsFor(node).find(pin => pin.side === side && pin.kind === kind)
}

function pinAnchor(position: Position, pin: PinSpec): Position {
  return {
    x: position.x + (pin.side === 'out' ? NODE_WIDTH : 0),
    y: position.y + PIN_TOP + pin.row * PIN_ROW_HEIGHT,
  }
}

function badgeFor(node: SetNode): { text: string; tone: string } | undefined {
  if (node.missing) return { text: '失效', tone: 'missing' }
  if (node.kind === 'carrier') return undefined
  if (node.status === 'confirmed') return { text: '确认', tone: 'confirmed' }
  if (node.status === 'rejected') return { text: '拒绝', tone: 'rejected' }
  return { text: '草稿', tone: 'draft' }
}

function nodeTitle(node: SetNode): string {
  return node.alias ?? node.title
}

function FunctionIcon() {
  return (
    <svg className="bp-node-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.5v9M8.5 1.5v9M3 6h5.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg className="bp-node-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 2.5h3.2c.6 0 1 .4 1 1v6.2H3.1c-.6 0-1.1-.4-1.1-1V2.5Z" fill="currentColor" opacity=".9" />
      <path d="M10 2.5H6.8c-.6 0-1 .4-1 1v6.2h3.1c.6 0 1.1-.4 1.1-1V2.5Z" fill="currentColor" opacity=".55" />
    </svg>
  )
}

/**
 * 曼哈顿走线：输出焊盘水平引出，跨过垂直通道，再水平进入输入焊盘。
 */
function manhattanPath(source: Position, target: Position, lane: number): string {
  const stub = 18
  const start = source
  const first = { x: source.x + stub, y: source.y }
  const last = { x: target.x - stub, y: target.y }
  const points: Position[] = [start, first]

  if (Math.abs(source.y - target.y) < 1) {
    points.push(last, target)
  } else if (first.x <= last.x - 24) {
    const middleX = (first.x + last.x) / 2 + lane
    points.push({ x: middleX, y: first.y }, { x: middleX, y: last.y }, last, target)
  } else {
    const laneX = Math.max(first.x, last.x) + 40 + lane
    points.push({ x: laneX, y: first.y }, { x: laneX, y: last.y }, last, target)
  }

  return roundedPath(points, 5)
}

/**
 * 45° 地铁走线：水平引出后优先用 45° 斜线完成大部分高差。
 */
function diagonalPath(source: Position, target: Position, lane: number): string {
  const stub = 18
  const start = source
  const first = { x: source.x + stub, y: source.y }
  const last = { x: target.x - stub, y: target.y }
  const points: Position[] = [start, first]

  if (Math.abs(first.y - last.y) < 1) {
    points.push(last, target)
  } else if (first.x <= last.x - 24) {
    const dx = last.x - first.x
    const dy = last.y - first.y
    const sign = dy >= 0 ? 1 : -1

    if (Math.abs(dy) <= dx) {
      points.push({ x: first.x + dx - Math.abs(dy), y: first.y }, last, target)
    } else {
      points.push({ x: last.x, y: first.y + sign * dx }, last, target)
    }
  } else {
    const laneX = Math.max(first.x, last.x) + 40 + lane
    const dy = last.y - first.y
    const sign = dy >= 0 ? 1 : -1
    const run = Math.min(Math.abs(dy), laneX - first.x)

    points.push(
      { x: laneX - run, y: first.y },
      { x: laneX, y: first.y + sign * run },
      { x: laneX, y: last.y },
      last,
      target,
    )
  }

  return roundedPath(points, 4)
}

function routePath(
  source: Position,
  target: Position,
  lane: number,
  mode: RoutingMode,
): string {
  return mode === 'diagonal'
    ? diagonalPath(source, target, lane)
    : manhattanPath(source, target, lane)
}

function roundedPath(points: Position[], radius: number): string {
  const clean = points.filter((point, index) => {
    if (index === 0) return true
    const previous = points[index - 1]!
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5
  })

  if (clean.length < 2) return ''

  let path = `M ${clean[0]!.x} ${clean[0]!.y}`

  for (let index = 1; index < clean.length - 1; index += 1) {
    const previous = clean[index - 1]!
    const current = clean[index]!
    const next = clean[index + 1]!
    const inLength = Math.hypot(current.x - previous.x, current.y - previous.y)
    const outLength = Math.hypot(next.x - current.x, next.y - current.y)
    const radiusLimit = Math.min(radius, inLength / 2, outLength / 2)
    const inX = (current.x - previous.x) / inLength
    const inY = (current.y - previous.y) / inLength
    const outX = (next.x - current.x) / outLength
    const outY = (next.y - current.y) / outLength
    const beforeX = current.x - inX * radiusLimit
    const beforeY = current.y - inY * radiusLimit
    const afterX = current.x + outX * radiusLimit
    const afterY = current.y + outY * radiusLimit

    path += ` L ${beforeX} ${beforeY} Q ${current.x} ${current.y} ${afterX} ${afterY}`
  }

  const end = clean[clean.length - 1]!
  path += ` L ${end.x} ${end.y}`
  return path
}

/**
 * 专业集蓝图编辑器：画布是主模式，支持右键菜单、节点/连线/注释编辑与电路板式走线。
 *
 * 节点位置、注释位置保存在数据库；画布固定深色以保持蓝图观感。
 */
export function SetCanvas({
  nodes,
  edges,
  comments,
  options,
  onSavePositions,
  onAddNode,
  onRemoveNode,
  onUpdateNode,
  onAddEdge,
  onUpdateEdge,
  onRemoveEdge,
  onAddComment,
  onUpdateComment,
  onRemoveComment,
}: SetCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const positionsRef = useRef<Record<string, Position>>({})
  const [commentLayout, setCommentLayout] = useState<Record<string, CommentBox>>({})
  const commentLayoutRef = useRef<Record<string, CommentBox>>({})
  const [view, setView] = useState<ViewState>({ x: 80, y: 60, scale: 1 })
  const [linkPreview, setLinkPreview] = useState<LinkPreview>()
  const [selection, setSelection] = useState<
    { type: 'node' | 'comment'; id: string } | undefined
  >()
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [dialog, setDialog] = useState<DialogState>()
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerPosition, setPickerPosition] = useState<Position>({ x: 0, y: 0 })
  const [editingCommentId, setEditingCommentId] = useState<string>()
  const [commentDraft, setCommentDraft] = useState('')
  const [routing, setRouting] = useState<RoutingMode>(() => {
    try {
      return window.localStorage.getItem(ROUTING_KEY) === 'diagonal' ? 'diagonal' : 'manhattan'
    } catch {
      return 'manhattan'
    }
  })
  const interactionRef = useRef<Interaction>()
  const saveRef = useRef(onSavePositions)
  const updateCommentRef = useRef(onUpdateComment)
  const fittedRef = useRef(false)
  saveRef.current = onSavePositions
  updateCommentRef.current = onUpdateComment

  function applyPositions(next: Record<string, Position>) {
    positionsRef.current = next
    setPositions(next)
  }

  function applyComments(next: Record<string, CommentBox>) {
    commentLayoutRef.current = next
    setCommentLayout(next)
  }

  function fitView(
    next: Record<string, Position> = positionsRef.current,
    boxes: Record<string, CommentBox> = commentLayoutRef.current,
  ) {
    const items = nodes
      .map(node => next[node.id])
      .filter((item): item is Position => Boolean(item))
    const area = [
      ...items.map(item => ({ x: item.x, y: item.y, width: NODE_WIDTH, height: NODE_HEIGHT })),
      ...Object.values(boxes).map(box => ({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })),
    ]
    if (area.length === 0) return

    const minX = Math.min(...area.map(item => item.x))
    const minY = Math.min(...area.map(item => item.y))
    const maxX = Math.max(...area.map(item => item.x + item.width))
    const maxY = Math.max(...area.map(item => item.y + item.height))
    const width = containerRef.current?.clientWidth ?? 800
    const height = containerRef.current?.clientHeight ?? 540
    const scale = clamp(
      Math.min(
        (width - 80) / Math.max(maxX - minX, 1),
        (height - 80) / Math.max(maxY - minY, 1),
      ),
      MIN_SCALE,
      1.2,
    )

    setView({
      x: width / 2 - ((minX + maxX) / 2) * scale,
      y: height / 2 - ((minY + maxY) / 2) * scale,
      scale,
    })
  }

  useEffect(() => {
    const mapped: Record<string, Position> = {}
    const missing: SetNode[] = []

    for (const node of nodes) {
      if (node.x !== undefined && node.y !== undefined) {
        mapped[node.id] = { x: node.x, y: node.y }
      } else {
        missing.push(node)
      }
    }

    if (missing.length > 0) {
      const layout = layoutSetNodes(
        nodes.map(node => ({ id: node.id, kind: node.kind, position: node.position })),
        edges.map(edge => ({ sourceId: edge.sourceId, targetId: edge.targetId, kind: edge.kind })),
      )

      for (const item of layout) {
        if (!mapped[item.nodeId]) mapped[item.nodeId] = { x: item.x, y: item.y }
      }

      const toSave = missing
        .map(node => ({ node, position: mapped[node.id] }))
        .filter((item): item is { node: SetNode; position: Position } => Boolean(item.position))
        .map(item => ({
          nodeId: item.node.id,
          x: item.position.x,
          y: item.position.y,
        }))

      if (toSave.length > 0) void saveRef.current(toSave)
    }

    applyPositions(mapped)

    if (!fittedRef.current && nodes.length > 0) {
      fittedRef.current = true
      requestAnimationFrame(() => fitView(mapped))
    }
  }, [nodes, edges])

  useEffect(() => {
    const next: Record<string, CommentBox> = {}
    for (const comment of comments) {
      next[comment.id] = {
        x: comment.x,
        y: comment.y,
        width: comment.width,
        height: comment.height,
      }
    }
    applyComments(next)
  }, [comments])

  useEffect(() => {
    try {
      window.localStorage.setItem(ROUTING_KEY, routing)
    } catch {
      // 存储不可用时仅当前会话生效
    }
  }, [routing])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    function handleWheel(event: WheelEvent) {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top

      setView((current) => {
        const worldX = (pointerX - current.x) / current.scale
        const worldY = (pointerY - current.y) / current.scale
        const nextScale = clamp(
          current.scale * Math.exp(-event.deltaY * 0.001),
          MIN_SCALE,
          MAX_SCALE,
        )

        return {
          x: pointerX - worldX * nextScale,
          y: pointerY - worldY * nextScale,
          scale: nextScale,
        }
      })
    }

    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => {
    if (!contextMenu && !dialog) return

    function closeMenu(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.bp-menu')) return
      setContextMenu(undefined)
    }

    function closeAll(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setContextMenu(undefined)
      setDialog(undefined)
      setEditingCommentId(undefined)
    }

    document.addEventListener('pointerdown', closeMenu, true)
    window.addEventListener('keydown', closeAll)
    return () => {
      document.removeEventListener('pointerdown', closeMenu, true)
      window.removeEventListener('keydown', closeAll)
    }
  }, [contextMenu, dialog])

  function toWorld(clientX: number, clientY: number): Position {
    const rect = containerRef.current?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0

    return {
      x: (clientX - left - view.x) / view.scale,
      y: (clientY - top - view.y) / view.scale,
    }
  }

  function nodeAt(clientX: number, clientY: number): SetNode | undefined {
    const element = document.elementFromPoint(clientX, clientY)
    const nodeElement = element?.closest('[data-node-id]') as HTMLElement | null
    const nodeId = nodeElement?.dataset.nodeId

    return nodeId ? nodes.find(node => node.id === nodeId) : undefined
  }

  function snapTarget(
    clientX: number,
    clientY: number,
    kind: SetEdgeKind,
    sourceId: string,
  ): Position {
    const world = toWorld(clientX, clientY)
    const target = nodeAt(clientX, clientY)
    if (!target || target.id === sourceId || target.kind !== 'point') return world

    const position = positionsRef.current[target.id]
    const pin = findPin(target, 'in', kind)
    if (!position || !pin) return world

    return pinAnchor(position, pin)
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    const target = event.target as HTMLElement
    const world = toWorld(event.clientX, event.clientY)
    const nodeElement = target.closest('[data-node-id]') as HTMLElement | null
    const edgeElement = target.closest('[data-edge-id]') as HTMLElement | null
    const commentElement = target.closest('[data-comment-id]') as HTMLElement | null

    let contextTarget: ContextTarget = { type: 'canvas' }
    if (nodeElement?.dataset.nodeId) {
      contextTarget = { type: 'node', id: nodeElement.dataset.nodeId }
      setSelection({ type: 'node', id: nodeElement.dataset.nodeId })
    } else if (edgeElement?.dataset.edgeId) {
      contextTarget = { type: 'edge', id: edgeElement.dataset.edgeId }
    } else if (commentElement?.dataset.commentId) {
      contextTarget = { type: 'comment', id: commentElement.dataset.commentId }
      setSelection({ type: 'comment', id: commentElement.dataset.commentId })
    } else {
      setSelection(undefined)
    }

    setContextMenu({
      screenX: event.clientX,
      screenY: event.clientY,
      worldX: world.x,
      worldY: world.y,
      target: contextTarget,
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return

    const target = event.target as HTMLElement
    if (
      target.closest('button')
      || target.closest('.blueprint-toolbar')
      || target.closest('.bp-menu')
      || target.closest('.bp-dialog')
    ) {
      return
    }

    setContextMenu(undefined)

    const port = target.closest('[data-port="out"]') as HTMLElement | null
    if (port && event.button === 0) {
      const nodeId = port.dataset.nodeId
      const edgeKind = port.dataset.edgeKind
      if (!nodeId || (edgeKind !== 'prereq' && edgeKind !== 'related')) return

      setSelection({ type: 'node', id: nodeId })
      interactionRef.current = { mode: 'link', sourceId: nodeId, kind: edgeKind }
      const world = toWorld(event.clientX, event.clientY)
      setLinkPreview({ sourceId: nodeId, kind: edgeKind, x: world.x, y: world.y })
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }

    const commentElement = target.closest('[data-comment-id]') as HTMLElement | null
    if (commentElement && event.button === 0) {
      const commentId = commentElement.dataset.commentId
      const box = commentId ? commentLayoutRef.current[commentId] : undefined
      if (!commentId || !box) return

      setSelection({ type: 'comment', id: commentId })
      const world = toWorld(event.clientX, event.clientY)

      if (target.closest('[data-comment-resize]')) {
        interactionRef.current = {
          mode: 'comment-resize',
          commentId,
          startX: world.x,
          startY: world.y,
          width: box.width,
          height: box.height,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        return
      }

      if (target.closest('.bp-comment-head')) {
        interactionRef.current = {
          mode: 'comment-drag',
          commentId,
          offsetX: world.x - box.x,
          offsetY: world.y - box.y,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }
      return
    }

    const nodeElement = target.closest('[data-node-id]') as HTMLElement | null
    if (nodeElement && event.button === 0) {
      const nodeId = nodeElement.dataset.nodeId
      const position = nodeId ? positionsRef.current[nodeId] : undefined

      if (nodeId && position) {
        const world = toWorld(event.clientX, event.clientY)
        interactionRef.current = {
          mode: 'drag',
          nodeId,
          offsetX: world.x - position.x,
          offsetY: world.y - position.y,
          moved: false,
        }
        setSelection({ type: 'node', id: nodeId })
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        return
      }
    }

    interactionRef.current = {
      mode: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    }
    setSelection(undefined)
    setContextMenu(undefined)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current
    if (!interaction) return

    if (interaction.mode === 'drag') {
      const world = toWorld(event.clientX, event.clientY)
      const next = {
        ...positionsRef.current,
        [interaction.nodeId]: {
          x: world.x - interaction.offsetX,
          y: world.y - interaction.offsetY,
        },
      }
      positionsRef.current = next
      setPositions(next)
      interaction.moved = true
      return
    }

    if (interaction.mode === 'pan') {
      setView(current => ({
        ...current,
        x: interaction.originX + (event.clientX - interaction.startX),
        y: interaction.originY + (event.clientY - interaction.startY),
      }))
      return
    }

    if (interaction.mode === 'comment-drag') {
      const world = toWorld(event.clientX, event.clientY)
      const current = commentLayoutRef.current[interaction.commentId]
      if (!current) return

      const next = {
        ...commentLayoutRef.current,
        [interaction.commentId]: {
          ...current,
          x: world.x - interaction.offsetX,
          y: world.y - interaction.offsetY,
        },
      }
      commentLayoutRef.current = next
      setCommentLayout(next)
      return
    }

    if (interaction.mode === 'comment-resize') {
      const world = toWorld(event.clientX, event.clientY)
      const current = commentLayoutRef.current[interaction.commentId]
      if (!current) return

      const next = {
        ...commentLayoutRef.current,
        [interaction.commentId]: {
          ...current,
          width: clamp(
            interaction.width + world.x - interaction.startX,
            COMMENT_MIN_WIDTH,
            COMMENT_MAX_WIDTH,
          ),
          height: clamp(
            interaction.height + world.y - interaction.startY,
            COMMENT_MIN_HEIGHT,
            COMMENT_MAX_HEIGHT,
          ),
        },
      }
      commentLayoutRef.current = next
      setCommentLayout(next)
      return
    }

    const target = snapTarget(event.clientX, event.clientY, interaction.kind, interaction.sourceId)
    setLinkPreview({
      sourceId: interaction.sourceId,
      kind: interaction.kind,
      x: target.x,
      y: target.y,
    })
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current
    interactionRef.current = undefined

    if (interaction?.mode === 'drag' && interaction.moved) {
      const position = positionsRef.current[interaction.nodeId]
      if (position) {
        void saveRef.current([
          { nodeId: interaction.nodeId, x: position.x, y: position.y },
        ])
      }
    }

    if (interaction?.mode === 'comment-drag' || interaction?.mode === 'comment-resize') {
      const box = commentLayoutRef.current[interaction.commentId]
      if (box) {
        void updateCommentRef.current(interaction.commentId, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        })
      }
    }

    if (interaction?.mode === 'link') {
      const sourceNode = nodes.find(node => node.id === interaction.sourceId)
      const targetNode = nodeAt(event.clientX, event.clientY)

      if (
        sourceNode
        && targetNode
        && targetNode.kind === 'point'
        && targetNode.id !== interaction.sourceId
        && !(interaction.kind === 'prereq' && sourceNode.kind !== 'point')
      ) {
        void onAddEdge(interaction.sourceId, targetNode.id, interaction.kind)
      }
    }

    setLinkPreview(undefined)
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.closest('[data-node-id]') || target.closest('[data-comment-id]')) return
    fitView()
  }

  function autoLayout() {
    const layout = layoutSetNodes(
      nodes.map(node => ({ id: node.id, kind: node.kind, position: node.position })),
      edges.map(edge => ({ sourceId: edge.sourceId, targetId: edge.targetId, kind: edge.kind })),
    )
    const next: Record<string, Position> = {}
    for (const item of layout) next[item.nodeId] = { x: item.x, y: item.y }

    applyPositions(next)
    void saveRef.current(layout)
    fitView(next)
  }

  function openNodeDialog(node: SetNode) {
    setDialog({
      type: 'node',
      nodeId: node.id,
      title: node.title,
      alias: node.alias ?? '',
      note: node.note ?? '',
    })
    setContextMenu(undefined)
  }

  function removeNodeWithConfirm(node: SetNode) {
    setContextMenu(undefined)
    if (!window.confirm(`移除节点「${nodeTitle(node)}」？相关关系会一并删除。`)) return
    void onRemoveNode(node.id)
  }

  function startCommentEdit(comment: SetComment) {
    setContextMenu(undefined)
    setEditingCommentId(comment.id)
    setCommentDraft(comment.text)
  }

  function saveCommentText(commentId: string) {
    const text = commentDraft.trim()
    setEditingCommentId(undefined)
    void updateCommentRef.current(commentId, { text })
  }

  function viewCenterWorld(): Position {
    const element = containerRef.current
    if (!element) return { x: 0, y: 0 }
    const rect = element.getBoundingClientRect()
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function openPicker(kind: SetNodeKind, position?: Position) {
    setPickerQuery('')
    setPickerPosition(position ?? viewCenterWorld())
    setDialog({ type: 'picker', kind })
  }

  function addCommentAtCenter() {
    const center = viewCenterWorld()
    void onAddComment({
      x: center.x - COMMENT_DEFAULT_WIDTH / 2,
      y: center.y - COMMENT_DEFAULT_HEIGHT / 2,
    })
  }

  const nodeMap = new Map(nodes.map(node => [node.id, node]))

  const previewNode = linkPreview ? nodeMap.get(linkPreview.sourceId) : undefined
  const previewPosition = linkPreview ? positions[linkPreview.sourceId] : undefined
  const previewPin = previewNode && linkPreview ? findPin(previewNode, 'out', linkPreview.kind) : undefined

  const pickerItems = dialog?.type === 'picker'
    ? dialog.kind === 'point'
      ? options.points.map(item => ({
        key: item.id,
        title: item.title,
        meta: item.carrierTitle,
        refId: item.id,
        used: nodes.some(node => node.kind === 'point' && node.refId === item.id),
      }))
      : options.carriers.map(item => ({
        key: item.id,
        title: item.title,
        meta: '载体',
        refId: item.id,
        used: nodes.some(node => node.kind === 'carrier' && node.refId === item.id),
      }))
    : []

  const filteredPickerItems = pickerItems.filter((item) => {
    if (item.used) return false
    const query = pickerQuery.trim().toLowerCase()
    return !query || item.title.toLowerCase().includes(query) || item.meta.toLowerCase().includes(query)
  })

  const menuNode = contextMenu?.target.type === 'node'
    ? nodeMap.get(contextMenu.target.id)
    : undefined
  const menuEdge = contextMenu?.target.type === 'edge'
    ? edges.find(edge => edge.id === contextMenu.target.id)
    : undefined
  const menuEdgeSource = menuEdge ? nodeMap.get(menuEdge.sourceId) : undefined
  const menuComment = contextMenu?.target.type === 'comment'
    ? comments.find(comment => comment.id === contextMenu.target.id)
    : undefined

  return (
    <div
      className="blueprint-canvas"
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div
        className="blueprint-transform"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <div className="blueprint-grid" />

        {comments.map((comment) => {
          const box = commentLayout[comment.id] ?? comment
          const editing = editingCommentId === comment.id

          return (
            <div
              key={comment.id}
              data-comment-id={comment.id}
              className={`bp-comment ${comment.color}${
                selection?.type === 'comment' && selection.id === comment.id ? ' selected' : ''
              }`}
              style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
            >
              <div
                className="bp-comment-head"
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  startCommentEdit(comment)
                }}
              >
                <span className="bp-comment-title">注释</span>
                <span className="bp-comment-hint">拖动标题移动 · 双击编辑</span>
              </div>

              {editing ? (
                <textarea
                  className="bp-comment-textarea"
                  value={commentDraft}
                  autoFocus
                  onPointerDown={event => event.stopPropagation()}
                  onChange={event => setCommentDraft(event.target.value)}
                  onBlur={() => saveCommentText(comment.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setEditingCommentId(undefined)
                      event.preventDefault()
                    }
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      saveCommentText(comment.id)
                      event.preventDefault()
                    }
                  }}
                />
              ) : (
                <div
                  className="bp-comment-text"
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    startCommentEdit(comment)
                  }}
                >
                  {comment.text || '双击编辑注释'}
                </div>
              )}

              <span className="bp-comment-resize" data-comment-resize={comment.id} />
            </div>
          )
        })}

        <svg className="blueprint-edges" width={6000} height={6000}>
          <defs>
            <marker
              id="bp-arrow-exec"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#ededed" />
            </marker>
          </defs>

          {edges.map((edge, index) => {
            const sourceNode = nodeMap.get(edge.sourceId)
            const targetNode = nodeMap.get(edge.targetId)
            const sourcePosition = positions[edge.sourceId]
            const targetPosition = positions[edge.targetId]
            if (!sourceNode || !targetNode || !sourcePosition || !targetPosition) return null

            const sourcePin = findPin(sourceNode, 'out', edge.kind)
            const targetPin = findPin(targetNode, 'in', edge.kind)
            if (!sourcePin || !targetPin) return null

            const lane = ((index % 5) - 2) * 6

            return (
              <path
                key={edge.id}
                data-edge-id={edge.id}
                className={`bp-edge ${edge.kind} from-${sourceNode.kind}`}
                d={routePath(
                  pinAnchor(sourcePosition, sourcePin),
                  pinAnchor(targetPosition, targetPin),
                  lane,
                  routing,
                )}
                markerEnd={edge.kind === 'prereq' ? 'url(#bp-arrow-exec)' : undefined}
                onPointerDown={event => event.stopPropagation()}
              />
            )
          })}

          {linkPreview && previewPosition && previewPin ? (
            <path
              className={`bp-edge bp-link-preview ${linkPreview.kind} from-${previewNode?.kind ?? 'point'}`}
              d={routePath(pinAnchor(previewPosition, previewPin), {
                x: linkPreview.x,
                y: linkPreview.y,
              }, 0, routing)}
            />
          ) : null}
        </svg>

        {nodes.map((node) => {
          const position = positions[node.id] ?? { x: 0, y: 0 }
          const badge = badgeFor(node)
          const selected = selection?.type === 'node' && selection.id === node.id

          return (
            <div
              key={node.id}
              data-node-id={node.id}
              className={`bp-node ${node.kind}${selected ? ' selected' : ''}${
                node.missing ? ' missing' : ''
              }`}
              style={{ left: position.x, top: position.y }}
            >
              <div className="bp-node-header" title={node.title}>
                {node.kind === 'point' ? <FunctionIcon /> : <BookIcon />}
                <span className="bp-node-title">{nodeTitle(node)}</span>
                {badge ? (
                  <span className={`bp-node-badge ${badge.tone}`}>{badge.text}</span>
                ) : null}
                {selected ? (
                  <button
                    className="bp-node-delete"
                    type="button"
                    aria-label={`移除 ${nodeTitle(node)}`}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={() => removeNodeWithConfirm(node)}
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className="bp-node-subtitle" title={node.note ?? node.subtitle}>
                {node.note ?? node.subtitle ?? (node.kind === 'point' ? '知识点' : '载体')}
              </div>

              {pinsFor(node).map(pin => (
                <div
                  key={`${pin.side}-${pin.kind}`}
                  className={`bp-pin ${pin.side} ${pin.type}`}
                  style={{ top: HEADER_HEIGHT + SUBTITLE_HEIGHT + pin.row * PIN_ROW_HEIGHT }}
                >
                  <span className="bp-pin-label">{pin.label}</span>
                  <span
                    className="bp-pin-mark"
                    data-port={pin.side}
                    data-node-id={node.id}
                    data-edge-kind={pin.kind}
                  />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div className="blueprint-toolbar" onPointerDown={event => event.stopPropagation()}>
        <span className="bp-toolbar-label">蓝图</span>
        <button
          type="button"
          className="bp-button"
          onClick={() => openPicker('point')}
        >
          添加节点
        </button>
        <button type="button" className="bp-button" onClick={addCommentAtCenter}>
          添加注释
        </button>
        <span className="bp-toolbar-divider" />
        <span className="bp-legend">
          <i className="bp-legend-mark exec" />
          执行
        </span>
        <span className="bp-legend">
          <i className="bp-legend-mark data" />
          数据
        </span>
        <span className="bp-route-switch" role="group" aria-label="连线走线风格">
          <button
            type="button"
            className={routing === 'manhattan' ? 'active' : ''}
            onClick={() => setRouting('manhattan')}
          >
            90°
          </button>
          <button
            type="button"
            className={routing === 'diagonal' ? 'active' : ''}
            onClick={() => setRouting('diagonal')}
          >
            45°
          </button>
        </span>
        <span className="bp-toolbar-divider" />
        <button type="button" className="bp-button" onClick={autoLayout}>
          自动布局
        </button>
        <button type="button" className="bp-button" onClick={() => fitView()}>
          适应视图
        </button>
        <span className="bp-zoom">{Math.round(view.scale * 100)}%</span>
      </div>

      {contextMenu ? (
        <div
          className="bp-menu"
          style={{
            left: Math.min(contextMenu.screenX, window.innerWidth - 230),
            top: Math.min(contextMenu.screenY, window.innerHeight - 280),
          }}
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          {contextMenu.target.type === 'canvas' ? (
            <>
              <span className="bp-menu-title">画布</span>
              <button
                type="button"
                className="bp-menu-item"
                onClick={() => {
                  openPicker('point', {
                    x: contextMenu.worldX,
                    y: contextMenu.worldY,
                  })
                  setContextMenu(undefined)
                }}
              >
                添加知识点
              </button>
              <button
                type="button"
                className="bp-menu-item"
                onClick={() => {
                  openPicker('carrier', {
                    x: contextMenu.worldX,
                    y: contextMenu.worldY,
                  })
                  setContextMenu(undefined)
                }}
              >
                添加载体
              </button>
              <button
                type="button"
                className="bp-menu-item"
                onClick={() => {
                  void onAddComment({ x: contextMenu.worldX, y: contextMenu.worldY })
                  setContextMenu(undefined)
                }}
              >
                添加注释
              </button>
              <span className="bp-menu-sep" />
              <button
                type="button"
                className="bp-menu-item"
                onClick={() => {
                  autoLayout()
                  setContextMenu(undefined)
                }}
              >
                自动布局
              </button>
              <button
                type="button"
                className="bp-menu-item"
                onClick={() => {
                  fitView()
                  setContextMenu(undefined)
                }}
              >
                适应视图
              </button>
            </>
          ) : null}

          {menuNode ? (
            <>
              <span className="bp-menu-title">{nodeTitle(menuNode)}</span>
              <button
                type="button"
                className="bp-menu-item"
                onClick={() => openNodeDialog(menuNode)}
              >
                编辑节点
              </button>
              <span className="bp-menu-sep" />
              <button
                type="button"
                className="bp-menu-item danger"
                onClick={() => removeNodeWithConfirm(menuNode)}
              >
                删除节点
              </button>
            </>
          ) : null}

          {menuEdge ? (
            <>
              <span className="bp-menu-title">{menuEdge.kind === 'prereq' ? '前置关系' : '相关关系'}</span>
              {!(menuEdge.kind === 'related' && menuEdgeSource?.kind === 'carrier') ? (
                <button
                  type="button"
                  className="bp-menu-item"
                  onClick={() => {
                    void onUpdateEdge(menuEdge.id, menuEdge.kind === 'prereq' ? 'related' : 'prereq')
                    setContextMenu(undefined)
                  }}
                >
                  {menuEdge.kind === 'prereq' ? '改为相关关系' : '改为前置关系'}
                </button>
              ) : null}
              <span className="bp-menu-sep" />
              <button
                type="button"
                className="bp-menu-item danger"
                onClick={() => {
                  setContextMenu(undefined)
                  if (window.confirm('删除这条关系？')) void onRemoveEdge(menuEdge.id)
                }}
              >
                删除关系
              </button>
            </>
          ) : null}

          {menuComment ? (
            <>
              <span className="bp-menu-title">注释</span>
              <button
                type="button"
                className="bp-menu-item"
                onClick={() => startCommentEdit(menuComment)}
              >
                编辑文本
              </button>
              <span className="bp-menu-sep" />
              <span className="bp-menu-title">颜色</span>
              <div className="bp-menu-colors">
                {COMMENT_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`bp-color-swatch ${color}${
                      menuComment.color === color ? ' active' : ''
                    }`}
                    aria-label={`注释颜色 ${color}`}
                    onClick={() => {
                      void onUpdateComment(menuComment.id, { color })
                      setContextMenu(undefined)
                    }}
                  />
                ))}
              </div>
              <span className="bp-menu-sep" />
              <button
                type="button"
                className="bp-menu-item danger"
                onClick={() => {
                  setContextMenu(undefined)
                  if (window.confirm('删除这个注释？')) void onRemoveComment(menuComment.id)
                }}
              >
                删除注释
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {dialog?.type === 'picker' ? (
        <div
          className="bp-dialog-backdrop"
          onPointerDown={(event) => {
            event.stopPropagation()
            setDialog(undefined)
          }}
        >
          <div
            className="bp-dialog"
            onPointerDown={event => event.stopPropagation()}
          >
            <div className="bp-dialog-head">
              <span>{dialog.kind === 'point' ? '添加知识点' : '添加载体'}</span>
              <button
                type="button"
                className="bp-dialog-close"
                aria-label="关闭"
                onClick={() => setDialog(undefined)}
              >
                ×
              </button>
            </div>

            <input
              className="bp-input"
              value={pickerQuery}
              autoFocus
              placeholder="搜索名称或来源…"
              aria-label="搜索节点"
              onChange={event => setPickerQuery(event.target.value)}
            />

            <div className="bp-picker-list">
              {filteredPickerItems.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className="bp-picker-item"
                  onClick={() => {
                    void onAddNode(dialog.kind, item.refId, pickerPosition)
                    setDialog(undefined)
                  }}
                >
                  <span className="bp-picker-title">{item.title}</span>
                  <span className="bp-picker-meta">{item.meta}</span>
                </button>
              ))}
              {filteredPickerItems.length === 0 ? (
                <p className="bp-picker-empty">没有可添加的节点</p>
              ) : null}
            </div>

            <div className="bp-dialog-actions">
              <button type="button" className="bp-button" onClick={() => setDialog(undefined)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dialog?.type === 'node' ? (
        <div
          className="bp-dialog-backdrop"
          onPointerDown={(event) => {
            event.stopPropagation()
            setDialog(undefined)
          }}
        >
          <div
            className="bp-dialog"
            onPointerDown={event => event.stopPropagation()}
          >
            <div className="bp-dialog-head">
              <span>编辑节点</span>
              <button
                type="button"
                className="bp-dialog-close"
                aria-label="关闭"
                onClick={() => setDialog(undefined)}
              >
                ×
              </button>
            </div>

            <label className="bp-field">
              <span>原始名称</span>
              <input className="bp-input" value={dialog.title} readOnly />
            </label>

            <label className="bp-field">
              <span>别名</span>
              <input
                className="bp-input"
                value={dialog.alias}
                maxLength={100}
                placeholder="留空则使用原始名称"
                onChange={event => setDialog({ ...dialog, alias: event.target.value })}
              />
            </label>

            <label className="bp-field">
              <span>备注</span>
              <textarea
                className="bp-input bp-textarea"
                value={dialog.note}
                maxLength={1000}
                rows={4}
                placeholder="显示在节点副标题位置"
                onChange={event => setDialog({ ...dialog, note: event.target.value })}
              />
            </label>

            <div className="bp-dialog-actions">
              <button
                type="button"
                className="bp-button danger"
                onClick={() => {
                  const node = nodeMap.get(dialog.nodeId)
                  setDialog(undefined)
                  if (node) removeNodeWithConfirm(node)
                }}
              >
                删除节点
              </button>
              <span className="bp-dialog-spacer" />
              <button type="button" className="bp-button" onClick={() => setDialog(undefined)}>
                取消
              </button>
              <button
                type="button"
                className="bp-button primary"
                onClick={() => {
                  void onUpdateNode(dialog.nodeId, {
                    alias: dialog.alias.trim() || null,
                    note: dialog.note.trim() || null,
                  })
                  setDialog(undefined)
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {nodes.length === 0 && comments.length === 0 ? (
        <div className="blueprint-empty">
          右键画布添加知识点、载体或注释，或点击上方「添加节点」。
        </div>
      ) : null}

      <div className="blueprint-hint">
        右键打开菜单 · 拖动节点 · 空白平移 · 滚轮缩放 · 从引脚拖线
      </div>
    </div>
  )
}
