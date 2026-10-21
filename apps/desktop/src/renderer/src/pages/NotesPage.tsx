import { useEffect, useRef, useState } from 'react'
import { PlusIcon, SearchIcon } from '../components/icons'
import { MarkdownView } from '../components/MarkdownView'
import type { NoteDetail, NoteRef, NoteRefOptions, NoteRefType, NoteSummary } from '../env'
import { errorText, formatDate } from '../format'

interface NotesPageProps {
  initialNoteId?: string
  initialRef?: { refType: NoteRefType; refId: string; label: string }
}

interface FormState {
  title: string
  body: string
  refs: NoteRef[]
}

function emptyForm(): FormState {
  return { title: '', body: '', refs: [] }
}

function refKey(ref: NoteRef): string {
  return `${ref.refType}:${ref.refId}`
}

/**
 * 笔记页：左侧列表、中间编辑与预览、右侧关联与双向链接。
 *
 * 数据库是权威来源，Markdown 文件是镜像；保存后立即重建出链与反链。
 */
export function NotesPage({ initialNoteId, initialRef }: NotesPageProps) {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [trash, setTrash] = useState<NoteSummary[]>([])
  const [options, setOptions] = useState<NoteRefOptions>({ carriers: [], points: [] })
  const [mode, setMode] = useState<'active' | 'trash'>('active')
  const [query, setQuery] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<NoteDetail>()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  function applyLoaded(loaded: NoteDetail) {
    setSelectedId(loaded.note.id)
    setDetail(loaded)
    setForm({
      title: loaded.note.title,
      body: loaded.note.body,
      refs: loaded.refs.map(ref => ({ refType: ref.refType, refId: ref.refId })),
    })
    setDirty(false)
    setCreating(false)
    setPreview(false)
    setError(undefined)
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const refOptions = await window.sublate.notes.refOptions()
        if (cancelled) return
        setOptions(refOptions)

        if (initialNoteId) {
          const loaded = await window.sublate.notes.detail(initialNoteId)
          if (!cancelled && loaded) applyLoaded(loaded)
          return
        }

        if (initialRef) {
          if (!cancelled) {
            setCreating(true)
            setForm({
              title: `${initialRef.label} 笔记`.slice(0, 190),
              body: `关联自「${initialRef.label}」。\n\n`,
              refs: [{ refType: initialRef.refType, refId: initialRef.refId }],
            })
            setDirty(true)
          }
          return
        }

        const list = await window.sublate.notes.list()
        if (cancelled) return

        if (list[0]) {
          const loaded = await window.sublate.notes.detail(list[0].id)
          if (!cancelled && loaded) applyLoaded(loaded)
        } else {
          setCreating(true)
        }
      } catch (reason) {
        if (!cancelled) setError(`初始化笔记失败：${errorText(reason)}`)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [list, deleted] = await Promise.all([
          window.sublate.notes.list({ query: query.trim() || undefined }),
          window.sublate.notes.trash(),
        ])
        if (cancelled) return
        setNotes(list)
        setTrash(deleted)
      } catch (reason) {
        if (!cancelled) setError(`读取笔记列表失败：${errorText(reason)}`)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [query, refreshTick])

  async function openNote(id: string) {
    if (id === selectedId && !creating) return
    if (dirty && !window.confirm('当前笔记有未保存的修改，确定放弃吗？')) return

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      applyLoaded(await window.sublate.notes.detail(id))
    } catch (reason) {
      setError(`读取笔记失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  function startCreate(ref?: { refType: NoteRefType; refId: string; label: string }) {
    if (dirty && !window.confirm('当前笔记有未保存的修改，确定放弃吗？')) return

    let nextForm = emptyForm()
    if (ref) {
      nextForm = {
        title: `${ref.label} 笔记`.slice(0, 190),
        body: `关联自「${ref.label}」。\n\n`,
        refs: [{ refType: ref.refType, refId: ref.refId }],
      }
    }

    setSelectedId(undefined)
    setDetail(undefined)
    setCreating(true)
    setPreview(false)
    setMessage(undefined)
    setError(undefined)
    setForm(nextForm)
    setDirty(Boolean(ref))
  }

  async function save(): Promise<boolean> {
    const title = form.title.trim()
    if (!title) {
      setError('笔记标题不能为空')
      return false
    }

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)

      let result: NoteDetail
      if (selectedId) {
        result = await window.sublate.notes.update(selectedId, {
          title,
          body: form.body,
          refs: form.refs,
        })
      } else {
        result = await window.sublate.notes.create({ title, body: form.body, refs: form.refs })
      }

      setSelectedId(result.note.id)
      setDetail(result)
      setCreating(false)
      setForm({
        title: result.note.title,
        body: result.note.body,
        refs: result.refs.map(ref => ({ refType: ref.refType, refId: ref.refId })),
      })
      setDirty(false)
      setMessage('已保存')
      setRefreshTick(tick => tick + 1)
      return true
    } catch (reason) {
      setError(`保存失败：${errorText(reason)}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveRef = useRef<() => Promise<boolean>>(save)
  saveRef.current = save

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveRef.current()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function removeCurrent() {
    if (!selectedId) return
    if (!window.confirm(`确定删除「${form.title}」？可以在回收站恢复。`)) return

    try {
      setBusy(true)
      await window.sublate.notes.remove(selectedId)
      setSelectedId(undefined)
      setDetail(undefined)
      setCreating(false)
      setForm(emptyForm())
      setDirty(false)
      setMessage('已移入回收站')
      setRefreshTick(tick => tick + 1)
    } catch (reason) {
      setError(`删除失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function restoreNote(id: string) {
    try {
      setBusy(true)
      setError(undefined)
      const restored = await window.sublate.notes.restore(id)
      setMode('active')
      applyLoaded(restored)
      setMessage('已恢复')
      setRefreshTick(tick => tick + 1)
    } catch (reason) {
      setError(`恢复失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function purgeNote(note: NoteSummary) {
    if (!window.confirm(`彻底删除「${note.title}」？该操作不可恢复。`)) return

    try {
      setBusy(true)
      setError(undefined)
      await window.sublate.notes.purge(note.id)
      setMessage('已彻底删除')
      setRefreshTick(tick => tick + 1)
    } catch (reason) {
      setError(`彻底删除失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: 'active' | 'trash') {
    if (next === mode) return
    if (dirty && !window.confirm('当前笔记有未保存的修改，确定离开吗？')) return

    setMode(next)
    setMessage(undefined)
    setError(undefined)

    if (next === 'trash') {
      setSelectedId(undefined)
      setDetail(undefined)
      setCreating(false)
      setForm(emptyForm())
      setDirty(false)
    }
  }

  function refLabel(ref: NoteRef): string {
    if (ref.refType === 'point') {
      const point = options.points.find(item => item.id === ref.refId)
      return point ? point.title : '未知知识点'
    }

    const carrier = options.carriers.find(item => item.id === ref.refId)
    return carrier ? carrier.title : '未知载体'
  }

  function addRef(value: string) {
    if (!value) return

    const [refType, refId] = value.split(':')
    if ((refType !== 'point' && refType !== 'carrier') || !refId) return
    if (form.refs.some(ref => ref.refType === refType && ref.refId === refId)) return

    setForm({ ...form, refs: [...form.refs, { refType, refId }] })
    setDirty(true)
  }

  function removeRef(target: NoteRef) {
    setForm({ ...form, refs: form.refs.filter(ref => refKey(ref) !== refKey(target)) })
    setDirty(true)
  }

  async function newFromLink(target: string) {
    if (creating && !form.title.trim() && !form.body.trim()) {
      setForm({ ...form, title: target.slice(0, 190) })
      setDirty(true)
      return
    }

    const saved = await save()
    if (!saved) return

    startCreate()
    setForm({ title: target.slice(0, 190), body: '', refs: [] })
    setDirty(true)
  }

  async function handleWikiLink(target: string) {
    const key = target.trim().replace(/\s+/g, ' ').toLowerCase()
    const local = notes.find(note => note.titleKey === key)
    if (local) {
      await openNote(local.id)
      return
    }

    try {
      const matches = await window.sublate.notes.list({ query: target })
      const found = matches.find(note => note.titleKey === key)
      if (found) {
        await openNote(found.id)
      } else {
        await newFromLink(target)
      }
    } catch (reason) {
      setError(`打开链接失败：${errorText(reason)}`)
    }
  }

  return (
    <div className="notes-page">
      <aside className="notes-rail">
        <div className="notes-rail-head">
          <div className="notes-rail-top">
            <h2>{mode === 'trash' ? '回收站' : '笔记'}</h2>
            {mode === 'active' ? (
              <button className="button sm primary" type="button" onClick={() => startCreate()} disabled={busy}>
                <PlusIcon />
                新建
              </button>
            ) : null}
          </div>

          {mode === 'active' ? (
            <div className="field">
              <span className="field-icon">
                <SearchIcon size={14} />
              </span>
              <input
                className="field-input"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索标题或正文"
                aria-label="搜索笔记"
              />
            </div>
          ) : null}

          <div className="notes-mode">
            <button
              type="button"
              className={mode === 'active' ? 'active' : ''}
              onClick={() => switchMode('active')}
            >
              全部 {notes.length}
            </button>
            <button
              type="button"
              className={mode === 'trash' ? 'active' : ''}
              onClick={() => switchMode('trash')}
            >
              回收站 {trash.length}
            </button>
          </div>

          {message ? <p className="notice notes-message">{message}</p> : null}
          {error ? <p className="error notes-message">{error}</p> : null}
        </div>

        <div className="notes-list">
          {mode === 'active' ? (
            notes.length > 0 ? (
              notes.map(note => (
                <button
                  key={note.id}
                  type="button"
                  className={`note-item${selectedId === note.id ? ' active' : ''}`}
                  onClick={() => void openNote(note.id)}
                >
                  <span className="note-item-title">{note.title}</span>
                  <span className="note-item-excerpt">{note.excerpt || '空笔记'}</span>
                  <span className="note-item-meta">
                    {formatDate(note.updatedAt)}
                    {note.backlinkCount > 0 ? ` · 反链 ${note.backlinkCount}` : ''}
                  </span>
                </button>
              ))
            ) : (
              <div className="notes-empty">
                <p>还没有笔记</p>
                <span>新建一篇，或用 [[标题]] 连接已有笔记。</span>
              </div>
            )
          ) : trash.length > 0 ? (
            trash.map(note => (
              <div key={note.id} className="note-item static">
                <span className="note-item-title">{note.title}</span>
                <span className="note-item-meta">
                  删除于 {formatDate(note.deletedAt ?? note.updatedAt)}
                </span>
                <div className="note-item-actions">
                  <button className="button sm" type="button" onClick={() => void restoreNote(note.id)} disabled={busy}>
                    恢复
                  </button>
                  <button className="button sm ghost" type="button" onClick={() => void purgeNote(note)} disabled={busy}>
                    彻底删除
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="notes-empty">
              <p>回收站是空的</p>
              <span>删除的笔记在这里保留，可随时恢复。</span>
            </div>
          )}
        </div>
      </aside>

      <section className="notes-editor">
        {mode === 'trash' ? (
          <div className="notes-hint">
            <p>回收站中的笔记不可编辑</p>
            <span>从左侧选择笔记进行恢复或彻底删除。</span>
          </div>
        ) : !selectedId && !creating ? (
          <div className="notes-hint">
            <p>选择一篇笔记</p>
            <span>或点击左上角「新建」开始写作。</span>
          </div>
        ) : (
          <>
            <div className="notes-editor-head">
              <input
                className="note-title-input"
                value={form.title}
                onChange={(event) => {
                  setForm({ ...form, title: event.target.value })
                  setDirty(true)
                }}
                placeholder="笔记标题"
                aria-label="笔记标题"
                disabled={busy}
              />

              <div className="actions">
                {dirty ? <span className="note-dirty">未保存</span> : null}
                <button className="button sm outline" type="button" onClick={() => setPreview(!preview)} disabled={busy}>
                  {preview ? '编辑' : '预览'}
                </button>
                <button className="button sm primary" type="button" onClick={() => void save()} disabled={busy}>
                  {busy ? '保存中…' : '保存'}
                </button>
                {selectedId ? (
                  <button className="button sm ghost" type="button" onClick={() => void removeCurrent()} disabled={busy}>
                    删除
                  </button>
                ) : null}
              </div>
            </div>

            {preview ? (
              <div className="note-preview">
                {form.body.trim() ? (
                  <MarkdownView content={form.body} onWikiLink={target => void handleWikiLink(target)} />
                ) : (
                  <p className="muted">还没有内容。</p>
                )}
              </div>
            ) : (
              <textarea
                className="note-textarea"
                value={form.body}
                onChange={(event) => {
                  setForm({ ...form, body: event.target.value })
                  setDirty(true)
                }}
                placeholder="用 Markdown 写笔记；[[标题]] 链接到其他笔记，Ctrl+S 保存。"
                aria-label="笔记正文"
                spellCheck={false}
              />
            )}

            <div className="notes-editor-foot">
              <span className="muted">{form.body.length} 字</span>
              <span className="muted">{selectedId ? detail?.note.relPath : '新建笔记'}</span>
            </div>
          </>
        )}
      </section>

      <aside className="notes-side">
        <section className="note-side-section">
          <div className="note-side-head">
            <h3>关联</h3>
            <span className="section-count">{form.refs.length}</span>
          </div>

          <div className="note-chips">
            {form.refs.map(ref => (
              <span className="note-chip" key={refKey(ref)}>
                <span className="note-chip-text">{refLabel(ref)}</span>
                <button
                  type="button"
                  className="note-chip-remove"
                  aria-label={`移除 ${refLabel(ref)}`}
                  onClick={() => removeRef(ref)}
                  disabled={mode === 'trash'}
                >
                  ×
                </button>
              </span>
            ))}
            {form.refs.length === 0 ? <p className="note-empty">未关联知识点或载体</p> : null}
          </div>

          {mode === 'active' ? (
            <select
              className="select sm note-ref-select"
              value=""
              onChange={event => addRef(event.target.value)}
              aria-label="添加关联"
            >
              <option value="">添加关联…</option>
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
          ) : null}
        </section>

        <section className="note-side-section">
          <div className="note-side-head">
            <h3>出链</h3>
            <span className="section-count">{detail?.links.length ?? 0}</span>
          </div>

          {detail && detail.links.length > 0 ? (
            <ul className="note-link-list">
              {detail.links.map(link => (
                <li key={link.targetKey}>
                  {link.targetNoteId ? (
                    <button className="link" type="button" onClick={() => void openNote(link.targetNoteId!)}>
                      {link.targetNoteTitle ?? link.targetTitle}
                    </button>
                  ) : (
                    <span className="note-link-missing">
                      <span>{link.targetTitle}</span>
                      <button className="link" type="button" onClick={() => void newFromLink(link.targetTitle)}>
                        创建
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="note-empty">还没有出链</p>
          )}
        </section>

        <section className="note-side-section">
          <div className="note-side-head">
            <h3>反链</h3>
            <span className="section-count">{detail?.backlinks.length ?? 0}</span>
          </div>

          {detail && detail.backlinks.length > 0 ? (
            <div className="note-backlinks">
              {detail.backlinks.map(backlink => (
                <button
                  key={backlink.noteId}
                  type="button"
                  className="note-backlink"
                  onClick={() => void openNote(backlink.noteId)}
                >
                  <span className="note-backlink-title">{backlink.title}</span>
                  <span className="note-backlink-excerpt">{backlink.excerpt || '空笔记'}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="note-empty">还没有笔记引用它</p>
          )}
        </section>
      </aside>
    </div>
  )
}
