import { useCallback, useEffect, useMemo, useState } from 'react'
import { PlusIcon } from '../components/icons'
import type {
  Carrier,
  KnowledgePoint,
  KnowledgeSnapshot,
  KnowledgeUnit,
} from '../env'
import { errorText } from '../format'

interface PointGroup {
  unit: KnowledgeUnit
  points: KnowledgePoint[]
}

interface EditorState {
  id: string
  mode: 'anchor' | 'split'
  start: string
  end: string
}

interface KnowledgePageProps {
  onCreateNote?(point: KnowledgePoint): void
}

function statusLabel(status: KnowledgePoint['status']): string {
  if (status === 'confirmed') return '已确认'
  if (status === 'rejected') return '已拒绝'
  return '草稿'
}

function statusTone(status: KnowledgePoint['status']): string {
  if (status === 'confirmed') return 'tone-success'
  if (status === 'rejected') return 'tone-danger'
  return 'tone-warning'
}

function pageRange(unit: KnowledgeUnit): string {
  if (unit.pageStart === undefined) return ''
  return unit.pageEnd === undefined
    ? `第 ${unit.pageStart} 页`
    : `第 ${unit.pageStart}–${unit.pageEnd} 页`
}

export function KnowledgePage({ onCreateNote }: KnowledgePageProps) {
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [carrierId, setCarrierId] = useState('')
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [editing, setEditing] = useState<EditorState>()

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.sublate.library.list()
        setCarriers(list)
        if (list[0]) setCarrierId(list[0].id)
      } catch (reason) {
        setError(`读取知识库失败：${errorText(reason)}`)
      }
    })()
  }, [])

  const refresh = useCallback(async (id: string) => {
    if (!id) {
      setSnapshot(undefined)
      return
    }

    try {
      setSnapshot(await window.sublate.knowledge.list(id))
      setSelected(new Set())
      setError(undefined)
    } catch (reason) {
      setError(`读取知识点失败：${errorText(reason)}`)
    }
  }, [])

  useEffect(() => {
    void refresh(carrierId)
  }, [carrierId, refresh])

  const groups = useMemo<PointGroup[]>(() => {
    if (!snapshot) return []

    const unitMap = new Map(snapshot.units.map(unit => [unit.id, unit]))
    const grouped = new Map<string, PointGroup>()

    for (const unit of snapshot.units) {
      grouped.set(unit.id, { unit, points: [] })
    }

    for (const point of snapshot.points) {
      const unit = point.unitId ? unitMap.get(point.unitId) : undefined
      const key = unit?.id ?? 'ungrouped'

      if (!grouped.has(key)) {
        grouped.set(key, {
          unit: {
            id: key,
            carrierId: point.carrierId,
            title: '未分组',
            status: 'draft',
            source: 'ai',
            createdAt: '',
            updatedAt: '',
          },
          points: [],
        })
      }

      grouped.get(key)!.points.push(point)
    }

    return [...grouped.values()].filter(group => group.points.length > 0)
  }, [snapshot])

  const draftCount = snapshot?.points.filter(point => point.status === 'draft').length ?? 0

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      setBusy(true)
      setMessage(undefined)
      setError(undefined)
      await action()
      setMessage(done)
      await refresh(carrierId)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  async function extract() {
    if (!carrierId) return

    try {
      setBusy(true)
      setMessage(undefined)
      setError(undefined)
      const result = await window.sublate.knowledge.extract(carrierId)

      if (result.status === 'failed') {
        setError(`抽取失败：${result.error ?? '未知原因'}`)
      } else {
        setMessage(`抽取完成：${result.unitCount} 个单元，${result.pointCount} 个知识点`)
      }

      await refresh(carrierId)
    } catch (reason) {
      setError(`抽取失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (!snapshot) return

    const drafts = snapshot.points.filter(point => point.status === 'draft').map(point => point.id)
    setSelected(current => (current.size === drafts.length ? new Set() : new Set(drafts)))
  }

  function startEdit(point: KnowledgePoint, mode: 'anchor' | 'split') {
    setEditing({
      id: point.id,
      mode,
      start: String(mode === 'anchor' ? point.pageStart : Math.min(point.pageStart + 1, point.pageEnd)),
      end: String(point.pageEnd),
    })
  }

  async function saveEdit() {
    if (!editing) return

    const start = Number.parseInt(editing.start, 10)
    const end = Number.parseInt(editing.end, 10)

    if (Number.isNaN(start) || start <= 0) {
      setError('页码必须是正整数')
      return
    }

    await run(async () => {
      if (editing.mode === 'anchor') {
        await window.sublate.knowledge.setAnchor(editing.id, start, Number.isNaN(end) ? start : end)
      } else {
        await window.sublate.knowledge.split(editing.id, start)
      }
      setEditing(undefined)
    }, editing.mode === 'anchor' ? '锚点已更新' : '知识点已拆分')
  }

  async function mergeSelected() {
    const ids = [...selected]
    await run(() => window.sublate.knowledge.merge(ids), `已合并 ${ids.length} 条知识点`)
  }

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>知识点</h1>
            <p className="page-subtitle">抽取后的草稿在这里确认、合并与重设锚点。</p>
          </div>
          <div className="actions">
            <select
              className="select"
              value={carrierId}
              onChange={event => setCarrierId(event.target.value)}
              aria-label="选择载体"
            >
              {carriers.map(carrier => (
                <option key={carrier.id} value={carrier.id}>
                  {carrier.title}
                </option>
              ))}
            </select>
            <button
              className="button primary"
              type="button"
              onClick={extract}
              disabled={!carrierId || busy}
            >
              <PlusIcon />
              {busy ? '处理中…' : '抽取知识点'}
            </button>
          </div>
        </header>

        {snapshot ? (
          <div className="knowledge-stats">
            <span className="tag tone-warning">草稿 {snapshot.stats.draft}</span>
            <span className="tag tone-success">已确认 {snapshot.stats.confirmed}</span>
            <span className="tag tone-danger">已拒绝 {snapshot.stats.rejected}</span>
          </div>
        ) : null}

        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {draftCount > 0 ? (
          <div className="toolbar-card selection-bar">
            <button className="link" type="button" onClick={toggleAll}>
              {selected.size === draftCount ? '取消全选' : '全选草稿'}
            </button>
            <div className="actions">
              <span className="muted">已选 {selected.size} 条</span>
              <button
                className="button sm"
                type="button"
                disabled={selected.size === 0 || busy}
                onClick={() =>
                  run(() => window.sublate.knowledge.confirm([...selected]), '已确认所选知识点')
                }
              >
                确认
              </button>
              <button
                className="button sm ghost"
                type="button"
                disabled={selected.size === 0 || busy}
                onClick={() =>
                  run(() => window.sublate.knowledge.reject([...selected]), '已拒绝所选知识点')
                }
              >
                拒绝
              </button>
              <button
                className="button sm outline"
                type="button"
                disabled={selected.size < 2 || busy}
                onClick={mergeSelected}
              >
                合并
              </button>
            </div>
          </div>
        ) : null}

        {!carrierId ? (
          <div className="empty-state">
            <p>还没有载体</p>
            <span>先在知识库导入 PDF 或网页。</span>
          </div>
        ) : null}

        {snapshot && snapshot.points.length === 0 ? (
          <div className="empty-state">
            <p>还没有知识点</p>
            <span>点击「抽取知识点」生成草稿，或检查上方任务错误。</span>
          </div>
        ) : null}

        <div className="knowledge-groups">
          {groups.map(group => (
            <section key={group.unit.id} className="unit-block">
              <div className="unit-head">
                <h2>{group.unit.title}</h2>
                <span className="unit-range">{pageRange(group.unit)}</span>
              </div>

              <ul className="list">
                {group.points.map(point => (
                  <li key={point.id} className="point-row">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={selected.has(point.id)}
                      onChange={() => toggle(point.id)}
                      aria-label={`选择 ${point.title}`}
                    />

                    <div className="point-body">
                      <div className="row-title">
                        <span className="row-title-text">{point.title}</span>
                        <span className="row-page">
                          第 {point.pageStart}
                          {point.pageEnd > point.pageStart ? `–${point.pageEnd}` : ''} 页
                        </span>
                      </div>
                      <div className="row-snippet">{point.content}</div>

                      {editing?.id === point.id ? (
                        <div className="point-editor">
                          <input
                            className="page-input"
                            value={editing.start}
                            onChange={event =>
                              setEditing({ ...editing, start: event.target.value })
                            }
                            aria-label={editing.mode === 'anchor' ? '起始页' : '拆分页'}
                          />
                          {editing.mode === 'anchor' ? (
                            <input
                              className="page-input"
                              value={editing.end}
                              onChange={event =>
                                setEditing({ ...editing, end: event.target.value })
                              }
                              aria-label="结束页"
                            />
                          ) : null}
                          <button className="button sm" type="button" onClick={saveEdit} disabled={busy}>
                            保存
                          </button>
                          <button
                            className="button sm ghost"
                            type="button"
                            onClick={() => setEditing(undefined)}
                          >
                            取消
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <span className={`tag ${statusTone(point.status)}`}>
                      {statusLabel(point.status)}
                    </span>

                    <div className="point-actions">
                      {onCreateNote ? (
                        <button
                          className="button sm ghost"
                          type="button"
                          onClick={() => onCreateNote(point)}
                        >
                          笔记
                        </button>
                      ) : null}
                      {point.status === 'draft' ? (
                        <>
                          <button
                            className="button sm ghost"
                            type="button"
                            onClick={() => startEdit(point, 'anchor')}
                          >
                            锚点
                          </button>
                          <button
                            className="button sm ghost"
                            type="button"
                            onClick={() => startEdit(point, 'split')}
                            disabled={point.pageEnd <= point.pageStart}
                          >
                            拆分
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
