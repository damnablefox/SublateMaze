import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { layoutSetNodes } from '@sublate/core'
import type { SetEdge, SetEdgeKind, SetNode } from '../env'

const NODE_WIDTH = 240
const NODE_HEIGHT = 96
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

type Interaction =
  | { mode: 'drag'; nodeId: string; offsetX: number; offsetY: number; moved: boolean }
  | { mode: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { mode: 'link'; sourceId: string }

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

function statusText(node: SetNode): string {
  if (node.missing) return '已失效'
  if (node.kind === 'carrier') return '载体'
  if (node.status === 'confirmed') return '已确认'
  if (node.status === 'rejected') return '已拒绝'
  return '草稿'
}

function edgePath(source: Position, target: Position): string {
  const sx = source.x + NODE_WIDTH
  const sy = source.y + NODE_HEIGHT / 2
  const tx = target.x
  const ty = target.y + NODE_HEIGHT / 2
  const dx = Math.max(60, Math.abs(tx - sx) * 0.5)

  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
}

/**
 * 专业集蓝图式画布。
 *
 * 节点位置保存在数据库；画布视图固定深色以保持蓝图观感。
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
  const [linkKind, setLinkKind] = useState<SetEdgeKind>('prereq')
  const [linkPreview, setLinkPreview] = useState<{ sourceId: string; x: number; y: number }>()
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

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return

    const target = event.target as HTMLElement
    if (target.closest('button') || target.closest('.blueprint-toolbar')) return

    const port = target.closest('[data-port="out"]') as HTMLElement | null
    if (port && event.button === 0) {
      const nodeId = port.dataset.nodeId
      if (!nodeId) return

      setSelected(nodeId)
      interactionRef.current = { mode: 'link', sourceId: nodeId }
      const world = toWorld(event.clientX, event.clientY)
      setLinkPreview({ sourceId: nodeId, x: world.x, y: world.y })
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

    const world = toWorld(event.clientX, event.clientY)
    setLinkPreview({ sourceId: interaction.sourceId, x: world.x, y: world.y })
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
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const targetElement = element?.closest('[data-node-id]') as HTMLElement | null
      const targetId = targetElement?.dataset.nodeId
      const targetNode = targetId ? nodes.find(node => node.id === targetId) : undefined

      if (
        sourceNode?.kind === 'point'
        && targetNode?.kind === 'point'
        && targetId
        && targetId !== interaction.sourceId
      ) {
        void onAddEdge(interaction.sourceId, targetId, linkKind)
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
              id="bp-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#7fa8ff" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const source = positions[edge.sourceId]
            const target = positions[edge.targetId]
            if (!source || !target || !nodeMap.has(edge.sourceId) || !nodeMap.has(edge.targetId)) {
              return null
            }

            return (
              <path
                key={edge.id}
                className={`bp-edge ${edge.kind}`}
                d={edgePath(source, target)}
                markerEnd={edge.kind === 'prereq' ? 'url(#bp-arrow)' : undefined}
                onPointerDown={event => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  if (window.confirm('删除这条关系？')) void onRemoveEdge(edge.id)
                }}
              />
            )
          })}

          {linkPreview && positions[linkPreview.sourceId] ? (
            <path
              className="bp-edge bp-link-preview"
              d={edgePath(positions[linkPreview.sourceId]!, {
                x: linkPreview.x,
                y: linkPreview.y - NODE_HEIGHT / 2,
              })}
            />
          ) : null}
        </svg>

        {nodes.map((node) => {
          const position = positions[node.id] ?? { x: 0, y: 0 }

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
                {node.title}
              </div>
              <div className="bp-node-body">
                <span className="bp-node-kind">{node.kind === 'point' ? '知识点' : '载体'}</span>
                <span className="bp-node-meta">{node.subtitle ?? ''}</span>
                <span className="bp-node-status">{statusText(node)}</span>
              </div>

              {node.kind === 'point' ? (
                <div className="bp-port in" data-port="in" data-node-id={node.id} />
              ) : null}
              {node.kind === 'point' ? (
                <div className="bp-port out" data-port="out" data-node-id={node.id} />
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
          )
        })}
      </div>

      <div className="blueprint-toolbar" onPointerDown={event => event.stopPropagation()}>
        <select
          className="bp-select"
          value={linkKind}
          onChange={event => setLinkKind(event.target.value as SetEdgeKind)}
          aria-label="新建连线类型"
        >
          <option value="prereq">前置</option>
          <option value="related">相关</option>
        </select>
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
        拖拽节点 · 空白处平移 · 滚轮缩放 · 从右侧端口拖线
      </div>
    </div>
  )
}
