import { useEffect, useRef, useState, type FormEvent } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { ArrowLeftIcon } from '../components/icons'
import type { CarrierDetail } from '../env'
import { errorText } from '../format'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface ReaderPageProps {
  id: string
  initialPage?: number
  onBack(): void
}

export function ReaderPage({ id, initialPage, onBack }: ReaderPageProps) {
  const [detail, setDetail] = useState<CarrierDetail>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [scale, setScale] = useState<number | 'fit'>('fit')
  const [actualScale, setActualScale] = useState(1)
  const [stageWidth, setStageWidth] = useState(0)
  const [pageText, setPageText] = useState('')

  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [pdfError, setPdfError] = useState<string>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLElement>(null)

  const carrier = detail?.carrier
  const pageCount = Math.max(1, carrier?.pageCount ?? 1)

  // 读取载体详情与上次阅读位置
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const value = await window.sublate.library.detail(id)
        if (cancelled) return
        setDetail(value)
        const start = initialPage ?? value.readState?.pageNo ?? 1
        setPage(Math.min(Math.max(1, start), Math.max(1, value.carrier.pageCount)))
        setLoading(false)
      } catch (reason) {
        if (cancelled) return
        setError(errorText(reason))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id, initialPage])

  // 页码变化时同步输入框并保存阅读位置
  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  useEffect(() => {
    if (!detail) return
    const timer = window.setTimeout(() => {
      void window.sublate.library.saveReadPosition(id, page, 0)
    }, 500)

    return () => window.clearTimeout(timer)
  }, [id, page, detail])

  // 记录阅读区宽度，默认缩放按宽度自适应，避免大页面在窄列里横向溢出
  useEffect(() => {
    const node = stageRef.current
    if (!node) return

    const observer = new ResizeObserver((entries) => {
      setStageWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(node)

    return () => observer.disconnect()
  }, [carrier?.id])

  // 读取当前页提取文本，供侧栏显示与选中复制
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const pages = await window.sublate.library.pages(id, page, page)
        if (!cancelled) setPageText(pages[0]?.text ?? '')
      } catch (reason) {
        if (!cancelled) setPageText(`读取页文本失败：${errorText(reason)}`)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id, page])

  // 打开 PDF 文档：字节由主进程经 IPC 读取，避免 file:// 页面下的跨源协议限制
  useEffect(() => {
    if (carrier?.kind !== 'pdf') return

    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined

    void (async () => {
      try {
        const data = await window.sublate.library.file(id)
        if (cancelled) return

        const assetBase = new URL('./pdfjs/', window.location.href).toString()
        task = pdfjs.getDocument({
          data,
          cMapUrl: new URL('cmaps/', assetBase).toString(),
          standardFontDataUrl: new URL('standard_fonts/', assetBase).toString(),
        })

        const document = await task.promise
        if (cancelled) {
          void task.destroy()
          return
        }
        setPdf(document)
      } catch (reason) {
        if (!cancelled) setPdfError(errorText(reason))
      }
    })()

    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [id, carrier?.kind])

  // 渲染当前页到画布
  useEffect(() => {
    if (!pdf || stageWidth <= 0) return

    let cancelled = false
    let renderTask: RenderTask | undefined

    void (async () => {
      const pdfPage = await pdf.getPage(page)
      if (cancelled) return

      const canvas = canvasRef.current
      if (!canvas) return

      const base = pdfPage.getViewport({ scale: 1 })
      const fitScale = Math.min(1.6, Math.max(0.5, stageWidth / base.width))
      const effectiveScale = scale === 'fit' ? fitScale : scale
      setActualScale(effectiveScale)

      const viewport = pdfPage.getViewport({ scale: effectiveScale })
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      const context = canvas.getContext('2d')
      if (!context) return

      const task = pdfPage.render({
        canvasContext: context,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      })
      renderTask = task

      try {
        await task.promise
      } catch (reason) {
        const name = (reason as { name?: string } | undefined)?.name
        if (!cancelled && name !== 'RenderingCancelledException') {
          setPdfError(errorText(reason))
        }
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, page, scale, stageWidth])

  // 键盘翻页
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        setPage(value => Math.max(1, value - 1))
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        setPage(value => Math.min(pageCount, value + 1))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pageCount])

  function jump(event: FormEvent) {
    event.preventDefault()
    const target = Number.parseInt(pageInput, 10)
    if (Number.isNaN(target)) {
      setPageInput(String(page))
      return
    }
    setPage(Math.min(Math.max(1, target), pageCount))
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-inner">
          <p className="muted">正在打开载体…</p>
        </div>
      </div>
    )
  }

  if (error || !carrier) {
    return (
      <div className="page">
        <div className="page-inner">
          <p className="error">无法打开载体：{error ?? '载体不存在'}</p>
          <button className="button outline" type="button" onClick={onBack}>
            <ArrowLeftIcon />
            返回知识库
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="reader">
      <header className="reader-toolbar">
        <div className="reader-heading">
          <button className="icon-button" type="button" aria-label="返回知识库" onClick={onBack}>
            <ArrowLeftIcon />
          </button>
          <span className="tag tone-outline">{carrier.kind === 'pdf' ? 'PDF' : '网页'}</span>
          <span className="reader-title" title={carrier.title}>
            {carrier.title}
          </span>
        </div>

        <div className="reader-controls">
          <button
            className="button sm ghost"
            type="button"
            onClick={() => setPage(value => Math.max(1, value - 1))}
            disabled={page <= 1}
          >
            上一页
          </button>

          <form className="page-jump" onSubmit={jump}>
            <input
              className="page-input"
              value={pageInput}
              onChange={event => setPageInput(event.target.value)}
              aria-label="页码"
            />
            <span className="page-total">/ {pageCount}</span>
          </form>

          <button
            className="button sm ghost"
            type="button"
            onClick={() => setPage(value => Math.min(pageCount, value + 1))}
            disabled={page >= pageCount}
          >
            下一页
          </button>

          {carrier.kind === 'pdf' ? (
            <div className="zoom">
              <button
                className="icon-button"
                type="button"
                aria-label="缩小"
                onClick={() => setScale(Math.max(0.5, Number((actualScale - 0.2).toFixed(2))))}
              >
                −
              </button>
              <span className="zoom-label">{Math.round(actualScale * 100)}%</span>
              <button
                className="icon-button"
                type="button"
                aria-label="放大"
                onClick={() => setScale(Math.min(3, Number((actualScale + 0.2).toFixed(2))))}
              >
                +
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="reader-body">
        <section className="reader-canvas" ref={stageRef}>
          {pdfError ? <p className="error">PDF 渲染失败：{pdfError}</p> : null}
          {carrier.kind === 'pdf' ? (
            <div className="pdf-stage">
              <canvas ref={canvasRef} />
            </div>
          ) : (
            <article className="web-page">
              <pre>{pageText || '本页没有可显示的正文。'}</pre>
            </article>
          )}
        </section>

        <aside className="reader-side">
          <div className="section-head">
            <h2>第 {page} 页文本</h2>
          </div>
          <pre className="page-text">{pageText || '本页没有可提取的文本。'}</pre>
        </aside>
      </div>
    </div>
  )
}
