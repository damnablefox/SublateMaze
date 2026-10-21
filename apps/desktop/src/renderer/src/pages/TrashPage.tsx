import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftIcon } from '../components/icons'
import type { Carrier, NoteSummary } from '../env'
import { errorText, formatDate } from '../format'

interface TrashPageProps {
  onBack(): void
}

export function TrashPage({ onBack }: TrashPageProps) {
  const [items, setItems] = useState<Carrier[]>([])
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const [carriers, noteItems] = await Promise.all([
        window.sublate.library.trash(),
        window.sublate.notes.trash(),
      ])
      setItems(carriers)
      setNotes(noteItems)
      setError(undefined)
    } catch (reason) {
      setError(`读取回收站失败：${errorText(reason)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function restore(carrier: Carrier) {
    try {
      await window.sublate.library.restore(carrier.id)
      await refresh()
    } catch (reason) {
      setError(`恢复失败：${errorText(reason)}`)
    }
  }

  async function restoreNote(id: string) {
    try {
      await window.sublate.notes.restore(id)
      await refresh()
    } catch (reason) {
      setError(`恢复笔记失败：${errorText(reason)}`)
    }
  }

  async function purgeNote(note: NoteSummary) {
    if (!window.confirm(`彻底删除「${note.title}」？该操作不可恢复。`)) return

    try {
      await window.sublate.notes.purge(note.id)
      await refresh()
    } catch (reason) {
      setError(`彻底删除失败：${errorText(reason)}`)
    }
  }

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>回收站</h1>
            <p className="page-subtitle">已删除的载体与笔记可随时恢复。</p>
          </div>
          <button className="button ghost" type="button" onClick={onBack}>
            <ArrowLeftIcon />
            返回知识库
          </button>
        </header>

        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">加载中…</p> : null}

        {!loading && items.length === 0 && notes.length === 0 ? (
          <div className="empty-state">
            <p>回收站是空的</p>
            <span>删除的载体与笔记在这里保留。</span>
          </div>
        ) : null}

        <section className="section">
          {items.length > 0 ? (
            <div className="section-head">
              <h2>已删除</h2>
              <span className="section-count">{items.length}</span>
            </div>
          ) : null}

          <ul className="list">
            {items.map(carrier => (
              <li key={carrier.id} className="row">
                <div className="row-main static">
                  <span className={`row-kind kind-${carrier.kind}`}>
                    {carrier.kind === 'pdf' ? 'PDF' : 'WEB'}
                  </span>
                  <span className="row-body">
                    <span className="row-title">
                      <span className="row-title-text">{carrier.title}</span>
                    </span>
                    <span className="row-meta">
                      {carrier.pageCount} 页 · 删除于{' '}
                      {formatDate(carrier.deletedAt ?? carrier.updatedAt)}
                    </span>
                  </span>
                </div>

                <button className="button sm outline" type="button" onClick={() => restore(carrier)}>
                  恢复
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="section">
          {notes.length > 0 ? (
            <div className="section-head">
              <h2>笔记</h2>
              <span className="section-count">{notes.length}</span>
            </div>
          ) : null}

          <ul className="list">
            {notes.map(note => (
              <li key={note.id} className="row">
                <div className="row-main static">
                  <span className="row-kind kind-note">NOTE</span>
                  <span className="row-body">
                    <span className="row-title">
                      <span className="row-title-text">{note.title}</span>
                    </span>
                    <span className="row-meta">
                      删除于 {formatDate(note.deletedAt ?? note.updatedAt)}
                    </span>
                  </span>
                </div>

                <div className="note-item-actions">
                  <button
                    className="button sm outline"
                    type="button"
                    onClick={() => void restoreNote(note.id)}
                  >
                    恢复
                  </button>
                  <button className="button sm ghost" type="button" onClick={() => void purgeNote(note)}>
                    彻底删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
