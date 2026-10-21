import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Carrier, ImportResult, SearchHit } from '../env'
import { errorText, formatDate, formatSize } from '../format'

interface LibraryPageProps {
  onOpen(carrierId: string, page?: number): void
  onOpenTrash(): void
}

function summarizeImport(results: ImportResult[]): string {
  const ready = results.filter((item) => item.status === 'ready')
  const duplicated = results.filter((item) => item.duplicated)
  const failed = results.filter((item) => item.status === 'failed')

  const parts = [`导入完成：成功 ${ready.length} 项`]
  if (duplicated.length > 0) parts.push(`其中去重 ${duplicated.length} 项`)
  if (failed.length > 0) {
    parts.push(`失败 ${failed.length} 项：${failed.map((item) => `${item.title}（${item.error}）`).join('；')}`)
  }
  return parts.join('，')
}

export function LibraryPage({ onOpen, onOpenTrash }: LibraryPageProps) {
  const [carriers, setCarriers] = useState<Carrier[]>([])
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
      setError(undefined)
    } catch (reason) {
      setError(`读取知识库失败：${errorText(reason)}`)
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
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>SublateMaze</h1>
          <p className="subtitle">本地优先的个人学习平台与知识库</p>
        </div>
        <div className="actions">
          <button className="button ghost" type="button" onClick={onOpenTrash}>
            回收站
          </button>
          <button className="button primary" type="button" onClick={importFiles} disabled={busy}>
            {busy ? '处理中…' : '导入 PDF'}
          </button>
        </div>
      </header>

      <section className="panel">
        <form className="row" onSubmit={importUrl}>
          <input
            className="input grow"
            type="url"
            placeholder="粘贴网页链接导入正文"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={busy}
          />
          <button className="button" type="submit" disabled={busy || url.trim().length === 0}>
            导入网页
          </button>
        </form>

        <form className="row" onSubmit={search}>
          <input
            className="input grow"
            type="search"
            placeholder="全文检索（支持中文短语，例如「知识点」）"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="button" type="submit" disabled={searching}>
            {searching ? '检索中…' : '检索'}
          </button>
        </form>

        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      {hits ? (
        <section>
          <div className="section-head">
            <h2>检索结果</h2>
            <button className="link" type="button" onClick={() => setHits(undefined)}>
              清除
            </button>
          </div>

          {hits.length === 0 ? (
            <p className="muted">没有匹配的内容。</p>
          ) : (
            <ul className="hits">
              {hits.map((hit, index) => (
                <li key={`${hit.carrierId}-${hit.pageNo}-${index}`}>
                  <button
                    type="button"
                    className="hit"
                    onClick={() => onOpen(hit.carrierId, hit.pageNo)}
                  >
                    <span className="hit-title">
                      {hit.title} · 第 {hit.pageNo} 页
                    </span>
                    <span className="hit-snippet">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section>
        <div className="section-head">
          <h2>知识库</h2>
          <span className="muted">{carriers.length} 个载体</span>
        </div>

        {loading ? <p className="muted">加载中…</p> : null}
        {!loading && carriers.length === 0 ? (
          <p className="muted">还没有内容，先导入一个 PDF 或网页。</p>
        ) : null}

        <ul className="cards">
          {carriers.map((carrier) => (
            <li key={carrier.id} className={`card status-${carrier.status}`}>
              <button type="button" className="card-main" onClick={() => onOpen(carrier.id)}>
                <span className="card-head">
                  <span className={`badge kind-${carrier.kind}`}>
                    {carrier.kind === 'pdf' ? 'PDF' : '网页'}
                  </span>
                  <span className="card-title">{carrier.title}</span>
                </span>

                <span className="card-meta">
                  {carrier.pageCount} 页 · {formatSize(carrier.file.size)} ·{' '}
                  {formatDate(carrier.updatedAt)}
                </span>

                <span className="card-state">
                  {carrier.status === 'ready'
                    ? '可阅读'
                    : carrier.status === 'failed'
                      ? `导入失败：${carrier.error ?? '未知原因'}`
                      : '解析中…'}
                </span>
              </button>

              <button className="button ghost danger" type="button" onClick={() => remove(carrier)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <footer>M1 知识库 · Windows x64</footer>
    </main>
  )
}
