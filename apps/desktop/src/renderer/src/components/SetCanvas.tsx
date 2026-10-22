import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { layoutSetNodes } from '@sublate/core'
import type { SetEdge, SetEdgeKind, SetNode } from '../env'

const NODE_WIDTH = 248
const NODE_HEIGHT = 96
const HEADER_HEIGHT = 24
const SUBTITLE_HEIGHT = 20
const PIN_ROW_HEIGHT = 22
const PIN_TOP = HEADER_HEIGHT + SUBTITLE_HEIGHT + PIN_ROW_HEIGHT / 2
const MIN_SCALE = 0.4
const MAX_SCALE = 1.8

interface Position {
  x: number
  y: number
}

interface ViewState {
  x: number
  y: number
  scale: number
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

interface LinkPreview {
  sourceId: string
  kind: SetEdgeKind
  x: number
  y: number
}

interface SetCanvasProps {
  nodes: SetNode[]
  edges: SetEdge[]
  onSavePositions(positions: { nodeId: string; x: number; y: number }[]): Promise<void>
  onAddEdge(sourceId: string, targetId: string, kind: SetEdgeKind): Promise<void>
  onRemoveEdge(edgeId: string): Promise<void>
  onRemoveNode(nodeId: string): Promise<void>
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

function edgePath(source: Position, target: Position): string {
  const deltaX = target.x - source.x
  const deltaY = target.y - source.y
  // 张力公式对齐 UGraphEditorSettings::ComputeSplineTangent，并按画布尺度限幅。
  const tension = deltaX >= 0
    ? Math.min(Math.abs(deltaX), 1000) + Math.min(Math.abs(deltaY), 1000)
    : 2 * Math.min(Math.abs(deltaX), 200) + 1.5 * Math.min(Math.abs(deltaY), 200)
  const dx = Math.max(28, Math.min(tension, 180))

  return `M ${source.x} ${source.y} C ${source.x + dx} ${source.y}, ${target.x - dx} ${target.y}, ${target.x} ${target.y}`
}

/**
 * 专业集蓝图画布：执行引脚表达前置流程，数据引脚表达相关引用。
 *
 * 节点位置保存到数据库；画布固定深色以保持 UE5 蓝图观感。
 */
export function SetCanvas({
  nodes,
  edges,
  onSavePositions,
  onAddEdge,
  onRemoveEdge,
  onRemoveNode,
}: SetCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const positionsRef = useRef<Record<string, Position>>({})
  const [view, setView] = useState<ViewState>({ x: 80, y: 60, scale: 1 })
  const [linkPreview, setLinkPreview] = useState<LinkPreview>()
  const [selected, setSelected] = useState<string>()
  const interactionRef = useRef<Interaction>()
  const saveRef = useRef(onSavePositions)
  const fittedRef = useRef(false)
  saveRef.current = onSavePositions

  function applyPositions(next: Record<string, Position>) {
    positionsRef.current = next
    setPositions(next)
  }

  function fitView(next: Record<string, Position> = positionsRef.current) {
    const items = nodes
      .map(node => next[node.id])
      .filter((item): item is Position => Boolean(item))
    if (items.length === 0) return

    const minX = Math.min(...items.map(item => item.x))
    const minY = Math.min(...items.map(item => item.y))
    const maxX = Math.max(...items.map(item => item.x + NODE_WIDTH))
    const maxY = Math.max(...items.map(item => item.y + NODE_HEIGHT))
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

  function snapTarget(clientX: number, clientY: number, kind: SetEdgeKind, sourceId: string): Position {
    const world = toWorld(clientX, clientY)
    const target = nodeAt(clientX, clientY)
    if (!target || target.id === sourceId || target.kind !== 'point') return world

    const position = positionsRef.current[target.id]
    const pin = findPin(target, 'in', kind)
    if (!position || !pin) return world

    return pinAnchor(position, pin)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return

    const target = event.target as HTMLElement
    if (target.closest('button') || target.closest('.blueprint-toolbar')) return

    const port = target.closest('[data-port="out"]') as HTMLElement | null
    if (port && event.button === 0) {
      const nodeId = port.dataset.nodeId
      const edgeKind = port.dataset.edgeKind
      if (!nodeId || (edgeKind !== 'prereq' && edgeKind !== 'related')) return

      setSelected(nodeId)
      interactionRef.current = { mode: 'link', sourceId: nodeId, kind: edgeKind }
      const world = toWorld(event.clientX, event.clientY)
      setLinkPreview({ sourceId: nodeId, kind: edgeKind, x: world.x, y: world.y })
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
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
        setSelected(nodeId)
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
    setSelected(undefined)
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
    if ((event.target as HTMLElement).closest('[data-node-id]')) return
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

  const nodeMap = new Map(nodes.map(node => [node.id, node]))

  const previewNode = linkPreview ? nodeMap.get(linkPreview.sourceId) : undefined
  const previewPosition = linkPreview ? positions[linkPreview.sourceId] : undefined
  const previewPin = previewNode && linkPreview ? findPin(previewNode, 'out', linkPreview.kind) : undefined

  return (
    <div
      className="blueprint-canvas"
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="blueprint-transform"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <div className="blueprint-grid" />

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

          {edges.map((edge) => {
            const sourceNode = nodeMap.get(edge.sourceId)
            const targetNode = nodeMap.get(edge.targetId)
            const sourcePosition = positions[edge.sourceId]
            const targetPosition = positions[edge.targetId]
            if (!sourceNode || !targetNode || !sourcePosition || !targetPosition) return null

            const sourcePin = findPin(sourceNode, 'out', edge.kind)
            const targetPin = findPin(targetNode, 'in', edge.kind)
            if (!sourcePin || !targetPin) return null

            return (
              <path
                key={edge.id}
                className={`bp-edge ${edge.kind} from-${sourceNode.kind}`}
                d={edgePath(pinAnchor(sourcePosition, sourcePin), pinAnchor(targetPosition, targetPin))}
                markerEnd={edge.kind === 'prereq' ? 'url(#bp-arrow-exec)' : undefined}
                onPointerDown={event => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  if (window.confirm('删除这条关系？')) void onRemoveEdge(edge.id)
                }}
              />
            )
          })}

          {linkPreview && previewPosition && previewPin ? (
            <path
              className={`bp-edge bp-link-preview ${linkPreview.kind} from-${previewNode?.kind ?? 'point'}`}
              d={edgePath(pinAnchor(previewPosition, previewPin), {
                x: linkPreview.x,
                y: linkPreview.y,
              })}
            />
          ) : null}
        </svg>

        {nodes.map((node) => {
          const position = positions[node.id] ?? { x: 0, y: 0 }
          const badge = badgeFor(node)

          return (
            <div
              key={node.id}
              data-node-id={node.id}
              className={`bp-node ${node.kind}${selected === node.id ? ' selected' : ''}${
                node.missing ? ' missing' : ''
              }`}
              style={{ left: position.x, top: position.y }}
            >
              <div className="bp-node-header" title={node.title}>
                {node.kind === 'point' ? <FunctionIcon /> : <BookIcon />}
                <span className="bp-node-title">{node.title}</span>
                {badge ? (
                  <span className={`bp-node-badge ${badge.tone}`}>{badge.text}</span>
                ) : null}
                {selected === node.id ? (
                  <button
                    className="bp-node-delete"
                    type="button"
                    aria-label={`移除 ${node.title}`}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={() => void onRemoveNode(node.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className="bp-node-subtitle" title={node.subtitle}>
                {node.subtitle ?? (node.kind === 'point' ? '知识点' : '载体')}
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
        <span className="bp-legend">
          <i className="bp-legend-mark exec" />
          执行
        </span>
        <span className="bp-legend">
          <i className="bp-legend-mark data" />
          数据
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

      {nodes.length === 0 ? (
        <div className="blueprint-empty">还没有节点，先在下方加入知识点或载体。</div>
      ) : null}

      <div className="blueprint-hint">
        拖动节点 · 空白平移 · 滚轮缩放 · 从执行或数据引脚拖线
      </div>
    </div>
  )
}
