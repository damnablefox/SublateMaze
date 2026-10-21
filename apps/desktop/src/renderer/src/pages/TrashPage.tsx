import { useCallback, useEffect, useState } from 'react'
import type { Carrier } from '../env'
import { errorText, formatDate } from '../format'

interface TrashPageProps {
  onBack(): void
}

export function TrashPage({ onBack }: TrashPageProps) {
  const [items, setItems] = useState<Carrier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      setItems(await window.sublate.library.trash())
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>回收站</h1>
          <p className="subtitle">已删除的载体保留 30 天，可随时恢复</p>
        </div>
        <button className="button ghost" type="button" onClick={onBack}>
          ← 返回知识库
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && items.length === 0 ? <p className="muted">回收站是空的。</p> : null}

      <ul className="cards">
        {items.map((carrier) => (
          <li key={carrier.id} className={`card status-${carrier.status}`}>
            <div className="card-main static">
              <span className="card-head">
                <span className={`badge kind-${carrier.kind}`}>
                  {carrier.kind === 'pdf' ? 'PDF' : '网页'}
                </span>
                <span className="card-title">{carrier.title}</span>
              </span>
              <span className="card-meta">
                {carrier.pageCount} 页 · 删除于 {formatDate(carrier.deletedAt ?? carrier.updatedAt)}
              </span>
            </div>

            <button className="button" type="button" onClick={() => restore(carrier)}>
              恢复
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
