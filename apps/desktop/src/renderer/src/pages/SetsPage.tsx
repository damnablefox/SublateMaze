import { useEffect, useState } from 'react'
import { PlusIcon } from '../components/icons'
import { SetCanvas } from '../components/SetCanvas'
import type {
  SetDetail,
  SetEdge,
  SetEdgeKind,
  SetNode,
  SetNodeKind,
  SetOptions,
  SetSummary,
} from '../env'
import { errorText } from '../format'

interface EdgeDraft {
  sourceId: string
  targetId: string
  kind: SetEdgeKind
}

const EMPTY_EDGE: EdgeDraft = { sourceId: '', targetId: '', kind: 'related' }

function percent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100)
}

function ResearchBar({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="research-bar">
      <div className="research-bar-head">
        <span>{label}</span>
        <span className="research-bar-value">{percent(value)}%</span>
      </div>
      <div className="progress-track">
        <span className="progress-fill" style={{ width: `${percent(value)}%` }} />
      </div>
      <span className="research-bar-hint">{hint}</span>
    </div>
  )
}

function nodeStatusTag(node: SetNode) {
  if (node.missing) return <span className="tag tone-danger">失效</span>
  if (node.kind !== 'point' || !node.status) return null

  if (node.status === 'confirmed') return <span className="tag tone-success">已确认</span>
  if (node.status === 'rejected') return <span className="tag tone-danger">已拒绝</span>
  return <span className="tag tone-warning">草稿</span>
}

/**
 * 专业集页：左侧集合列表，右侧研究程度、节点与关系。
 */
export function SetsPage() {
  const [sets, setSets] = useState<SetSummary[]>([])
  const [options, setOptions] = useState<SetOptions>({ carriers: [], points: [] })
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<SetDetail>()
  const [form, setForm] = useState({ title: '', description: '' })
  const [dirty, setDirty] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'canvas'>('canvas')
  const [newTitle, setNewTitle] = useState('')
  const [addValue, setAddValue] = useState('')
  const [edge, setEdge] = useState<EdgeDraft>(EMPTY_EDGE)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  function applyDetail(next: SetDetail) {
    setSelectedId(next.set.id)
    setDetail(next)
    setForm({ title: next.set.title, description: next.set.description })
    setDirty(false)
  }

  async function refreshSets() {
    try {
      setSets(await window.sublate.sets.list())
    } catch (reason) {
      setError(`读取专业集失败：${errorText(reason)}`)
    }
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [list, refOptions] = await Promise.all([
          window.sublate.sets.list(),
          window.sublate.sets.options(),
        ])
        if (cancelled) return

        setSets(list)
        setOptions(refOptions)

        if (list[0]) {
          const loaded = await window.sublate.sets.detail(list[0].id)
          if (!cancelled) applyDetail(loaded)
        }
      } catch (reason) {
        if (!cancelled) setError(`初始化专业集失败：${errorText(reason)}`)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  async function selectSet(id: string) {
    if (id === selectedId) return
    if (dirty && !window.confirm('当前专业集有未保存的修改，确定放弃吗？')) return

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      applyDetail(await window.sublate.sets.detail(id))
    } catch (reason) {
      setError(`读取专业集失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function createSet() {
    const title = newTitle.trim()
    if (!title) return

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      const created = await window.sublate.sets.create(title)
      setNewTitle('')
      applyDetail(created)
      setMessage('已创建专业集')
      await refreshSets()
    } catch (reason) {
      setError(`创建失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function saveSet() {
    if (!selectedId) return
    const title = form.title.trim()
    if (!title) {
      setError('专业集标题不能为空')
      return
    }

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      applyDetail(
        await window.sublate.sets.update(selectedId, {
          title,
          description: form.description,
        }),
      )
      setMessage('已保存')
      await refreshSets()
    } catch (reason) {
      setError(`保存失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function deleteSet() {
    if (!selectedId) return
    if (!window.confirm(`删除「${form.title}」？节点与关系会一并删除。`)) return

    try {
      setBusy(true)
      setError(undefined)
      await window.sublate.sets.remove(selectedId)
      setSelectedId(undefined)
      setDetail(undefined)
      setForm({ title: '', description: '' })
      setDirty(false)
      setMessage('已删除专业集')
      await refreshSets()
    } catch (reason) {
      setError(`删除失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<SetDetail>, done: string) {
    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      applyDetail(await action())
      setMessage(done)
      await refreshSets()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  async function addNode() {
    if (!selectedId || !addValue) return

    const [kind, refId] = addValue.split(':')
    if ((kind !== 'point' && kind !== 'carrier') || !refId) return

    await run(
      () => window.sublate.sets.addNodes(selectedId, [{ kind: kind as SetNodeKind, refId }]),
      '已加入节点',
    )
    setAddValue('')
  }

  async function removeNode(nodeId: string) {
    if (!selectedId) return
    await run(() => window.sublate.sets.removeNode(selectedId, nodeId), '已移除节点')
  }

  async function savePositions(positions: { nodeId: string; x: number; y: number }[]) {
    if (!selectedId) return

    try {
      setDetail(await window.sublate.sets.updatePositions(selectedId, positions))
      setError(undefined)
    } catch (reason) {
      setError(`保存画布位置失败：${errorText(reason)}`)
    }
  }

  async function addCanvasNode(
    kind: SetNodeKind,
    refId: string,
    position: { x: number; y: number },
  ) {
    if (!selectedId) return

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      let next = await window.sublate.sets.addNodes(selectedId, [{ kind, refId }])
      const added = next.nodes.find(node => node.kind === kind && node.refId === refId)

      if (added && added.x === undefined && added.y === undefined) {
        next = await window.sublate.sets.updatePositions(selectedId, [
          { nodeId: added.id, x: position.x, y: position.y },
        ])
      }

      applyDetail(next)
      setMessage('已加入节点')
      await refreshSets()
    } catch (reason) {
      setError(`添加节点失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function updateCanvasNode(
    nodeId: string,
    patch: { alias?: string | null; note?: string | null },
  ) {
    if (!selectedId) return
    await run(() => window.sublate.sets.updateNode(selectedId, nodeId, patch), '已更新节点')
  }

  async function updateCanvasEdge(edgeId: string, kind: SetEdgeKind) {
    if (!selectedId) return
    await run(() => window.sublate.sets.updateEdge(selectedId, edgeId, kind), '已更新关系')
  }

  async function addCanvasComment(position: { x: number; y: number }) {
    if (!selectedId) return
    await run(
      () => window.sublate.sets.addComment(selectedId, { x: position.x, y: position.y }),
      '已添加注释',
    )
  }

  async function updateCanvasComment(
    commentId: string,
    patch: {
      x?: number
      y?: number
      width?: number
      height?: number
      text?: string
      color?: 'amber' | 'blue' | 'green' | 'red'
    },
  ) {
    if (!selectedId) return

    try {
      setDetail(await window.sublate.sets.updateComment(selectedId, commentId, patch))
      setError(undefined)
    } catch (reason) {
      setError(`保存注释失败：${errorText(reason)}`)
    }
  }

  async function removeCanvasComment(commentId: string) {
    if (!selectedId) return
    await run(() => window.sublate.sets.removeComment(selectedId, commentId), '已删除注释')
  }

  async function addCanvasEdge(sourceId: string, targetId: string, kind: SetEdgeKind) {
    if (!selectedId) return
    await run(
      () => window.sublate.sets.addEdge(selectedId, { sourceId, targetId, kind }),
      '已添加关系',
    )
  }

  async function addEdge() {
    if (!selectedId || !edge.sourceId || !edge.targetId) return
    if (edge.sourceId === edge.targetId) {
      setError('不能让节点指向自己')
      return
    }

    await run(
      () =>
        window.sublate.sets.addEdge(selectedId, {
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          kind: edge.kind,
        }),
      '已添加关系',
    )
    setEdge({ sourceId: '', targetId: '', kind: edge.kind })
  }

  async function removeEdge(edgeId: string) {
    if (!selectedId) return
    await run(() => window.sublate.sets.removeEdge(selectedId, edgeId), '已移除关系')
  }

  function nodeTitle(nodeId: string): string {
    return detail?.nodes.find(node => node.id === nodeId)?.title ?? '未知节点'
  }

  function describeEdge(item: SetEdge): string {
    return `${nodeTitle(item.sourceId)} → ${nodeTitle(item.targetId)}`
  }

  const relationNodes = detail?.nodes.filter(node => node.kind === 'point') ?? []

  const addNodeBar = (
    <div className="sets-add">
      <select
        className="select"
        value={addValue}
        onChange={event => setAddValue(event.target.value)}
        aria-label="选择要加入的节点"
      >
        <option value="">选择知识点或载体…</option>
        <optgroup label="载体">
          {options.carriers.map(carrier => (
            <option key={carrier.id} value={`carrier:${carrier.id}`}>
              {carrier.title}
            </option>
          ))}
        </optgroup>
        <optgroup label="知识点">
          {options.points.map(point => (
            <option key={point.id} value={`point:${point.id}`}>
              {point.title} · {point.carrierTitle}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        className="button sm"
        type="button"
        onClick={() => void addNode()}
        disabled={busy || !addValue}
      >
        添加
      </button>
    </div>
  )

  return (
    <div className="page">
      <div className="page-inner sets-page-inner">
        <header className="page-header">
          <div>
            <h1>专业集</h1>
            <p className="page-subtitle">把研究领域需要的知识点与载体组织起来，量化研究程度。</p>
          </div>

          {detail ? (
            <div className="actions">
              <div className="sets-view-switch" role="group" aria-label="专业集视图">
                <button
                  type="button"
                  className={`button sm${viewMode === 'list' ? ' primary' : ' ghost'}`}
                  onClick={() => setViewMode('list')}
                >
                  列表
                </button>
                <button
                  type="button"
                  className={`button sm${viewMode === 'canvas' ? ' primary' : ' ghost'}`}
                  onClick={() => setViewMode('canvas')}
                >
                  画布
                </button>
              </div>
              {dirty ? <span className="note-dirty">未保存</span> : null}
              <button
                className="button sm primary"
                type="button"
                onClick={() => void saveSet()}
                disabled={busy || !dirty}
              >
                {busy ? '保存中…' : '保存集合'}
              </button>
              <button className="button sm ghost" type="button" onClick={() => void deleteSet()} disabled={busy}>
                删除集合
              </button>
            </div>
          ) : null}
        </header>

        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="sets-layout">
          <aside className="sets-rail">
            <div className="sets-create">
              <input
                className="text-input"
                value={newTitle}
                onChange={event => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createSet()
                }}
                placeholder="新专业集名称"
                aria-label="新专业集名称"
              />
              <button
                className="button sm primary"
                type="button"
                onClick={() => void createSet()}
                disabled={busy || !newTitle.trim()}
              >
                <PlusIcon />
                新建
              </button>
            </div>

            <ul className="list">
              {sets.map(set => (
                <li key={set.id}>
                  <button
                    type="button"
                    className={`course-chip${selectedId === set.id ? ' active' : ''}`}
                    onClick={() => void selectSet(set.id)}
                  >
                    <span className="course-chip-title">{set.title}</span>
                    <span className="course-chip-meta">
                      {set.pointCount} 个知识点 · {percent(set.degree.score)}% · {set.degree.level}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {sets.length === 0 ? <p className="note-empty">还没有专业集，先创建一个。</p> : null}
          </aside>

          <section className="sets-panel">
            {detail ? (
              <>
                <div className="sets-title-block">
                  <input
                    className="note-title-input"
                    value={form.title}
                    onChange={(event) => {
                      setForm({ ...form, title: event.target.value })
                      setDirty(true)
                    }}
                    placeholder="专业集标题"
                    aria-label="专业集标题"
                    disabled={busy}
                  />
                  <textarea
                    className="sets-description"
                    value={form.description}
                    onChange={(event) => {
                      setForm({ ...form, description: event.target.value })
                      setDirty(true)
                    }}
                    placeholder="这个研究领域的目标与范围"
                    aria-label="专业集描述"
                    rows={2}
                    disabled={busy}
                  />
                </div>

                {viewMode === 'list' ? (
                  <div className="research-card">
                    <div className="research-score">
                      <div className="research-number">
                        <span className="research-value">{percent(detail.degree.score)}</span>
                        <span className="research-unit">%</span>
                      </div>
                      <span className="tag tone-outline">{detail.degree.level}</span>
                    </div>

                    <div className="research-bars">
                      <ResearchBar
                        label="广度"
                        value={detail.degree.breadth}
                        hint={`${detail.degree.confirmedPoints} / ${detail.degree.totalPoints} 个知识点已确认`}
                      />
                      <ResearchBar
                        label="深度"
                        value={detail.degree.depth}
                        hint={`${detail.degree.reviewedPoints} 个知识点已复习，按平均 3 次封顶`}
                      />
                      <ResearchBar
                        label="平均掌握"
                        value={detail.degree.mastery}
                        hint="可提取性与自评准确率的加权平均"
                      />
                    </div>
                  </div>
                ) : null}

                {viewMode === 'canvas' ? (
                  <>
                    <div className="sets-canvas-meta">
                      <span className="tag tone-outline">{percent(detail.degree.score)}% · {detail.degree.level}</span>
                      <span className="muted">{detail.nodes.length} 个节点 · {detail.edges.length} 条关系</span>
                    </div>
                    <SetCanvas
                      nodes={detail.nodes}
                      edges={detail.edges}
                      comments={detail.comments}
                      options={options}
                      onSavePositions={savePositions}
                      onAddNode={addCanvasNode}
                      onRemoveNode={removeNode}
                      onUpdateNode={updateCanvasNode}
                      onAddEdge={addCanvasEdge}
                      onUpdateEdge={updateCanvasEdge}
                      onRemoveEdge={removeEdge}
                      onAddComment={addCanvasComment}
                      onUpdateComment={updateCanvasComment}
                      onRemoveComment={removeCanvasComment}
                    />
                    {addNodeBar}
                  </>
                ) : (
                  <>
                    <section className="section">
                      <div className="section-head">
                        <h2>节点</h2>
                        <span className="section-count">{detail.nodes.length}</span>
                      </div>

                      <ul className="list">
                        {detail.nodes.map(node => (
                          <li key={node.id} className="row">
                            <div className="row-main static">
                              <span className={`tag ${node.kind === 'point' ? 'tone-success' : 'tone-outline'}`}>
                                {node.kind === 'point' ? '知识点' : '载体'}
                              </span>
                              <span className="row-body">
                                <span className="row-title">
                                  <span className="row-title-text">{node.title}</span>
                                  {nodeStatusTag(node)}
                                </span>
                                <span className="row-meta">{node.subtitle}</span>
                              </span>
                            </div>
                            <button
                              className="button sm ghost"
                              type="button"
                              onClick={() => void removeNode(node.id)}
                              disabled={busy}
                            >
                              移除
                            </button>
                          </li>
                        ))}
                      </ul>

                      {detail.nodes.length === 0 ? (
                        <p className="note-empty">还没有节点，从下方加入知识点或整本载体。</p>
                      ) : null}

                      {addNodeBar}
                    </section>

                    <section className="section">
                      <div className="section-head">
                        <h2>关系</h2>
                        <span className="section-count">{detail.edges.length}</span>
                      </div>

                      <ul className="list">
                        {detail.edges.map(item => (
                          <li key={item.id} className="row relation-row">
                            <span className="relation-line">
                              <span className="tag tone-outline">
                                {item.kind === 'prereq' ? '前置' : '相关'}
                              </span>
                              <span className="relation-node" title={describeEdge(item)}>
                                {nodeTitle(item.sourceId)}
                              </span>
                              <span className="relation-arrow">→</span>
                              <span className="relation-node">{nodeTitle(item.targetId)}</span>
                            </span>
                            <button
                              className="button sm ghost"
                              type="button"
                              onClick={() => void removeEdge(item.id)}
                              disabled={busy}
                            >
                              移除
                            </button>
                          </li>
                        ))}
                      </ul>

                      {detail.edges.length === 0 ? <p className="note-empty">还没有关系。</p> : null}

                      <div className="sets-edge-form">
                        <select
                          className="select"
                          value={edge.sourceId}
                          onChange={event => setEdge({ ...edge, sourceId: event.target.value })}
                          aria-label="关系起点"
                        >
                          <option value="">起点节点</option>
                          {relationNodes.map(node => (
                            <option key={node.id} value={node.id}>
                              {node.title}
                            </option>
                          ))}
                        </select>
                        <select
                          className="select"
                          value={edge.kind}
                          onChange={event =>
                            setEdge({ ...edge, kind: event.target.value as SetEdgeKind })
                          }
                          aria-label="关系类型"
                        >
                          <option value="related">相关</option>
                          <option value="prereq">前置</option>
                        </select>
                        <select
                          className="select"
                          value={edge.targetId}
                          onChange={event => setEdge({ ...edge, targetId: event.target.value })}
                          aria-label="关系终点"
                        >
                          <option value="">目标节点</option>
                          {relationNodes.map(node => (
                            <option key={node.id} value={node.id}>
                              {node.title}
                            </option>
                          ))}
                        </select>
                        <button
                          className="button sm"
                          type="button"
                          onClick={() => void addEdge()}
                          disabled={busy || !edge.sourceId || !edge.targetId}
                        >
                          添加关系
                        </button>
                      </div>
                    </section>
                  </>
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>选择或新建一个专业集</p>
                <span>专业集会展示广度、深度与平均掌握，并支持知识点关系。</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
