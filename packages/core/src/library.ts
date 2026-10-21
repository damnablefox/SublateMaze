/**
 * 知识载体的平台无关规则：内容寻址路径、扩展名分类与网页分页。
 *
 * 约束：不依赖 node:path 与 node:fs，路径一律用 POSIX 分隔符拼接，
 * 由宿主插件在落盘时转换。
 */

export type CarrierKind = 'pdf' | 'web'

/** 知识库内的文件相对路径：library/ab/cd/<sha256>.<ext>。 */
export function libraryRelPath(sha256: string, ext: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`非法 SHA-256：${sha256}`)
  }

  const normalized = ext.startsWith('.') ? ext.slice(1) : ext
  const safeExt = normalized.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!safeExt) throw new Error(`非法扩展名：${ext}`)

  return `library/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${safeExt}`
}

/** 按扩展名判断载体类型；M1 只支持 PDF 与网页。 */
export function carrierKindFromExt(ext: string): CarrierKind | undefined {
  const normalized = ext.toLowerCase().replace(/^\./, '')
  if (normalized === 'pdf') return 'pdf'
  if (normalized === 'html' || normalized === 'htm') return 'web'
  return undefined
}

/** 仅用于本地文件；网页抓取固定存为 HTML。 */
export function mimeFromExt(ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, '')
  if (normalized === 'pdf') return 'application/pdf'
  return 'text/html; charset=utf-8'
}

/** 长段落按句末标点切块，找不到合适断点则硬切。 */
function splitLongParagraph(paragraph: string, targetChars: number): string[] {
  if (paragraph.length <= targetChars) return [paragraph]

  const pieces: string[] = []
  let rest = paragraph

  while (rest.length > targetChars) {
    let cut = -1
    for (const mark of ['。', '！', '？', '；', '.', '!', '?', ';', '\n']) {
      cut = Math.max(cut, rest.lastIndexOf(mark, targetChars))
    }

    cut = cut > targetChars * 0.3 ? cut + 1 : targetChars
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }

  if (rest) pieces.push(rest)
  return pieces
}

/** 网页正文按估算长度切分为虚拟页，尽量在段落或句末断开。 */
export function splitWebPages(text: string, targetChars = 1200): string[] {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0)
    .flatMap(paragraph => splitLongParagraph(paragraph, targetChars))

  const pages: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > targetChars) {
      pages.push(current)
      current = paragraph
      continue
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph
  }

  if (current) pages.push(current)

  return pages.length > 0 ? pages : [text.trim()].filter(value => value.length > 0)
}

export interface ChunkDraft {
  pageNo: number
  chunkNo: number
  text: string
}

/** 段落与句末标点优先作为 chunk 断点。 */
const CHUNK_BREAKS = ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';']

/**
 * 把页文本切成约 targetChars 的 chunk，块间保留 overlapChars 的重叠。
 *
 * 页码与块号留在草稿里，写入 SQLite 时再分配稳定 id。
 */
export function chunkPages(
  pages: { pageNo: number; text: string }[],
  targetChars = 900,
  overlapChars = 120,
): ChunkDraft[] {
  const drafts: ChunkDraft[] = []

  for (const page of pages) {
    const text = page.text.trim()
    if (!text) continue

    let start = 0
    let chunkNo = 1

    while (start < text.length) {
      const end = Math.min(text.length, start + targetChars)
      let cut = end

      if (end < text.length) {
        let best = -1
        for (const mark of CHUNK_BREAKS) {
          const index = text.lastIndexOf(mark, end)
          if (index > best) best = index
        }
        if (best > start + Math.floor(targetChars * 0.6)) {
          cut = best + 1
        }
      }

      const piece = text.slice(start, cut).trim()
      if (piece) {
        drafts.push({ pageNo: page.pageNo, chunkNo, text: piece })
        chunkNo += 1
      }

      if (cut >= text.length) break
      start = Math.max(cut - overlapChars, start + 1)
    }
  }

  return drafts
}
