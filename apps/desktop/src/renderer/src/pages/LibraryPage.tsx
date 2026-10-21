import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PlusIcon, SearchIcon, TrashIcon } from '../components/icons'
import type { Carrier, ImportResult, SearchHit } from '../env'
import { errorText, formatDate, formatSize } from '../format'

interface LibraryPageProps {
  onOpen(carrierId: string, page?: number): void
}

function summarizeImport(results: ImportResult[]): string {
  const ready = results.filter(item => item.status === 'ready')
  const duplicated = results.filter(item => item.duplicated)
  const failed = results.filter(item => item.status === 'failed')

  const parts = [`导入完成：成功 ${ready.length} 项`]
  if (duplicated.length > 0) parts.push(`其中去重 ${duplicated.length} 项`)
  if (failed.length > 0) {
    parts.push(`失败 ${failed.length} 项：${failed.map(item => `${item.title}（${item.error}）`).join('；')}`)
  }
  return parts.join('，')
}

function StatusTag({ carrier }: { carrier: Carrier }) {
  if (carrier.status === 'ready') return <span className="tag tone-success">可阅读</span>
  if (carrier.status === 'failed') return <span className="tag tone-danger">失败</span>
  return <span className="tag tone-warning">解析中</span>
}

export function LibraryPage({ onOpen }: LibraryPageProps) {
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  const [url, setUrl] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>()
  const [searching, setSearching] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setCarriers(await window.sublate.library.list())
      setAvailable(true)
      setError(undefined)
    } catch (reason) {
      const message = errorText(reason)
      // 插件被停用后频道不再注册，此时隐藏导入与检索入口。
      if (message.includes('No handler registered')) setAvailable(false)
      setError(`读取知识库失败：${message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function importFiles() {
    setMessage(undefined)
    setError(undefined)

    try {
      const paths = await window.sublate.library.pickFiles()
      if (paths.length === 0) return

      setBusy(true)
      const results = await window.sublate.library.importFiles(paths)
      setMessage(summarizeImport(results))
      await refresh()
    } catch (reason) {
      setError(`导入失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function importUrl(event: FormEvent) {
    event.preventDefault()
    const target = url.trim()
    if (!target) return

    setMessage(undefined)
    setError(undefined)

    try {
      setBusy(true)
      const result = await window.sublate.library.importUrl(target)
      setMessage(summarizeImport([result]))
      if (result.status === 'ready') setUrl('')
      await refresh()
    } catch (reason) {
      setError(`网页导入失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    const text = query.trim()
    if (!text) {
      setHits(undefined)
      return
    }

    try {
      setSearching(true)
      setHits(await window.sublate.library.search(text))
      setError(undefined)
    } catch (reason) {
      setError(`检索失败：${errorText(reason)}`)
    } finally {
      setSearching(false)
    }
  }

  async function remove(carrier: Carrier) {
    if (!window.confirm(`把《${carrier.title}》移入回收站？`)) return

    try {
      await window.sublate.library.remove(carrier.id)
      await refresh()
    } catch (reason) {
      setError(`删除失败：${errorText(reason)}`)
    }
  }

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>知识库</h1>
            <p className="page-subtitle">导入 PDF 与网页，检索正文并继续阅读。</p>
          </div>
          {available ? (
            <button className="button primary" type="button" onClick={importFiles} disabled={busy}>
              <PlusIcon />
              {busy ? '处理中…' : '导入 PDF'}
            </button>
          ) : null}
        </header>

        {available ? (
          <section className="toolbar-card">
            <form className="field" onSubmit={search}>
              <span className="field-icon">
                <SearchIcon />
              </span>
              <input
                className="field-input"
                type="search"
                placeholder="全文检索，支持中文短语"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
              <button className="button sm outline" type="submit" disabled={searching}>
                {searching ? '检索中' : '检索'}
              </button>
            </form>

            <form className="field" onSubmit={importUrl}>
              <span className="field-label">网页</span>
              <input
                className="field-input"
                type="url"
                placeholder="粘贴链接，抓取正文并导入"
                value={url}
                onChange={event => setUrl(event.target.value)}
                disabled={busy}
              />
              <button className="button sm ghost" type="submit" disabled={busy || url.trim().length === 0}>
                导入
              </button>
            </form>

            {message ? <p className="notice">{message}</p> : null}
            {error ? <p className="error">{error}</p> : null}
          </section>
        ) : (
          <section className="toolbar-card">
            <p className="muted">知识库插件未启用，导入与检索入口已隐藏。</p>
          </section>
        )}

        {hits ? (
          <section className="section">
            <div className="section-head">
              <h2>检索结果</h2>
              <button className="link" type="button" onClick={() => setHits(undefined)}>
                清除
              </button>
            </div>

            {hits.length === 0 ? (
              <p className="muted">没有匹配的内容。</p>
            ) : (
              <ul className="list">
                {hits.map((hit, index) => (
                  <li key={`${hit.carrierId}-${hit.pageNo}-${index}`} className="row">
                    <button
                      type="button"
                      className="row-main"
                      onClick={() => onOpen(hit.carrierId, hit.pageNo)}
                    >
                      <span className="row-body">
                        <span className="row-title">
                          <span className="row-title-text">{hit.title}</span>
                          <span className="row-page">第 {hit.pageNo} 页</span>
                        </span>
                        <span className="row-snippet">{hit.snippet}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="section">
          <div className="section-head">
            <h2>全部载体</h2>
            <span className="section-count">{carriers.length}</span>
          </div>

          {loading ? <p className="muted">加载中…</p> : null}

          {!loading && carriers.length === 0 ? (
            <div className="empty-state">
              <p>还没有内容</p>
              <span>导入一个 PDF 或网页，开始构建你的知识库。</span>
            </div>
          ) : null}

          <ul className="list">
            {carriers.map(carrier => (
              <li key={carrier.id} className="row">
                <button type="button" className="row-main" onClick={() => onOpen(carrier.id)}>
                  <span className={`row-kind kind-${carrier.kind}`}>
                    {carrier.kind === 'pdf' ? 'PDF' : 'WEB'}
                  </span>

                  <span className="row-body">
                    <span className="row-title">
                      <span className="row-title-text">{carrier.title}</span>
                    </span>
                    <span className="row-meta">
                      {carrier.pageCount} 页 · {formatSize(carrier.file.size)} ·{' '}
                      {formatDate(carrier.updatedAt)}
                      {carrier.error ? ` · ${carrier.error}` : ''}
                    </span>
                  </span>

                  <span className="row-tags">
                    <StatusTag carrier={carrier} />
                  </span>
                </button>

                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={`删除 ${carrier.title}`}
                  title="移入回收站"
                  onClick={() => remove(carrier)}
                >
                  <TrashIcon size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
