import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { isCjkChar, splitWebPages } from '@sublate/core'

export const name = 'parser'
export const inject: string[] = []

export interface PageText {
  pageNo: number
  text: string
}

export interface ParserConfig {
  /** 解析缓存目录，相对 vault 根；默认 `.sublate/cache`。 */
  cacheDir?: string
  /** 网页抓取超时，毫秒。 */
  fetchTimeoutMs?: number
  /** 网页 HTML 体积上限，字节。 */
  maxWebBytes?: number
}

export interface ParsedDocument {
  title?: string
  pageCount: number
  pages: PageText[]
}

export interface FetchedWeb {
  html: string
  finalUrl: string
}

/** 只依赖 vault 的公开方法，不 import 其他插件包。 */
interface VaultLike {
  getRoot(): string
}

interface CacheFile {
  version: 1
  pageCount: number
  pages: PageText[]
  title?: string
}

const CACHE_VERSION = 1
const PDF_PARALLEL = 8

/** 分批并发，避免一次性打开过多页。 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index]!)
    }
  })

  await Promise.all(runners)
  return results
}

/** 相邻文本块之间的连接规则：中文之间不插空格，其余用空格分隔。 */
function joinTextItems(items: { str?: string; hasEOL?: boolean }[]): string {
  let text = ''

  for (const item of items) {
    const value = item.str ?? ''
    if (!value) {
      if (item.hasEOL) text += '\n'
      continue
    }

    if (!text) {
      text = value
    } else if (text.endsWith('\n')) {
      text += value
    } else if (isCjkChar(text.slice(-1)) || isCjkChar(value.slice(0, 1))) {
      text += value
    } else {
      text += ` ${value}`
    }

    if (item.hasEOL) text += '\n'
  }

  return text.replace(/[ \t]+\n/g, '\n').trim()
}

export class ParserService {
  private readonly cacheRoot: string
  private readonly fetchTimeoutMs: number
  private readonly maxWebBytes: number
  private pdfModule?: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>

  constructor(vaultRoot: string, config: ParserConfig = {}) {
    this.cacheRoot = join(vaultRoot, config.cacheDir ?? '.sublate/cache')
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? 20_000
    this.maxWebBytes = config.maxWebBytes ?? 15 * 1024 * 1024
  }

  private cachePath(sha256: string): string {
    return join(this.cacheRoot, sha256, 'pages.json')
  }

  private async readCache(sha256: string): Promise<CacheFile | undefined> {
    try {
      const raw = await readFile(this.cachePath(sha256), 'utf8')
      const parsed = JSON.parse(raw) as CacheFile
      if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.pages)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  private async writeCache(sha256: string, document: ParsedDocument): Promise<void> {
    const path = this.cachePath(sha256)
    await mkdir(join(this.cacheRoot, sha256), { recursive: true })

    const payload: CacheFile = {
      version: CACHE_VERSION,
      pageCount: document.pageCount,
      pages: document.pages,
      title: document.title,
    }

    // 先写临时文件再改名，避免半截缓存被当成有效结果。
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(payload), 'utf8')
    await rename(temp, path)
  }

  private async loadPdfModule(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
    this.pdfModule ??= import('pdfjs-dist/legacy/build/pdf.mjs')
    return this.pdfModule
  }

  /** 提取 PDF 逐页文本；同一 sha256 命中缓存时不再打开文件。 */
  async parsePdf(filePath: string, sha256: string): Promise<ParsedDocument> {
    const cached = await this.readCache(sha256)
    if (cached) {
      return {
        title: cached.title,
        pageCount: cached.pageCount,
        pages: cached.pages,
      }
    }

    const pdfjs = await this.loadPdfModule()
    const data = new Uint8Array(await readFile(filePath))
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    })

    const document = await loadingTask.promise
    try {
      const pageNumbers = Array.from({ length: document.numPages }, (_, index) => index + 1)
      const pages = await mapLimit(pageNumbers, PDF_PARALLEL, async (pageNo) => {
        const page = await document.getPage(pageNo)
        try {
          const content = await page.getTextContent()
          const parts: { str?: string; hasEOL?: boolean }[] = []
          for (const item of content.items) {
            if ('str' in item) parts.push({ str: item.str, hasEOL: item.hasEOL })
          }
          return { pageNo, text: joinTextItems(parts) }
        } finally {
          page.cleanup()
        }
      })

      let title: string | undefined
      try {
        const metadata = await document.getMetadata()
        const rawTitle = (metadata.info as { Title?: unknown } | undefined)?.Title
        if (typeof rawTitle === 'string' && rawTitle.trim()) {
          title = rawTitle.trim()
        }
      } catch {
        // 元数据缺失不影响正文提取
      }

      const parsed: ParsedDocument = { title, pageCount: pages.length, pages }
      await this.writeCache(sha256, parsed)
      return parsed
    } finally {
      await loadingTask.destroy()
    }
  }

  /** 抓取网页 HTML；正文提取由 parseWebHtml 完成，便于先按内容寻址落盘。 */
  async fetchWeb(url: string): Promise<FetchedWeb> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs)

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SublateMaze/0.1',
        },
      })

      if (!response.ok) {
        throw new Error(`抓取失败：HTTP ${response.status} ${response.statusText}`)
      }

      const buffer = new Uint8Array(await response.arrayBuffer())
      if (buffer.byteLength > this.maxWebBytes) {
        throw new Error(`网页过大：${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`)
      }

      return { html: new TextDecoder('utf-8').decode(buffer), finalUrl: response.url || url }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`抓取超时：${url}`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /** 用 Readability 提取正文，再按估算长度切分为虚拟页。 */
  async parseWebHtml(
    html: string,
    sha256: string,
    fallbackTitle?: string,
  ): Promise<ParsedDocument> {
    const cached = await this.readCache(sha256)
    if (cached) {
      return {
        title: cached.title,
        pageCount: cached.pageCount,
        pages: cached.pages,
      }
    }

    const { JSDOM } = await import('jsdom')
    const { Readability } = await import('@mozilla/readability')

    const dom = new JSDOM(html)
    const article = new Readability(dom.window.document).parse()
    dom.window.close()

    const text = article?.textContent?.trim()
    if (!text) {
      throw new Error('未能从网页中提取正文（可能是脚本渲染或纯图片页面）')
    }

    const chunks = splitWebPages(text)
    const pages = chunks.map((chunk, index) => ({ pageNo: index + 1, text: chunk }))

    const parsed: ParsedDocument = {
      title: article?.title?.trim() || fallbackTitle,
      pageCount: pages.length,
      pages,
    }

    await this.writeCache(sha256, parsed)
    return parsed
  }
}

export function apply(ctx: Context, config: ParserConfig = {}) {
  const vault = ctx.get('vault') as VaultLike | undefined
  if (!vault) throw new Error('parser 需要 vault 服务')

  const service = new ParserService(vault.getRoot(), config)
  ctx.provide('parser', service)
  ctx.logger('parser').info('解析服务已就绪（PDF / 网页）')
}
