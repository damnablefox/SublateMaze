/**
 * 笔记领域逻辑：wiki 链接解析、标题规范化与 Markdown 文件序列化。
 *
 * 平台无关：只做字符串处理，文件读写由 notes 插件注入。
 */

export interface WikiLink {
  /** 链接目标标题（去掉别名与锚点后的原文）。 */
  target: string
  /** 显示文本；未写别名时与 target 相同。 */
  label: string
  /** 规范化标题，用于大小写不敏感匹配。 */
  key: string
}

export interface NoteFileMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  pointIds?: string[]
  carrierIds?: string[]
}

const WIKI_LINK = /\[\[([^[\]\n]+?)\]\]/g

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 标题规范化：全角转半角、折叠空白、小写，用于链接定位。 */
export function normalizeNoteTitle(title: string): string {
  return title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 解析正文中的 wiki 链接。
 *
 * - `[[标题]]`、`[[标题|别名]]`、`[[标题#锚点]]` 均指向「标题」；
 * - 同一目标标题只保留第一次出现，避免重复出链；
 * - 空目标与跨行内容忽略。
 */
export function parseWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = []
  const seen = new Set<string>()

  for (const match of markdown.matchAll(WIKI_LINK)) {
    const raw = match[1] ?? ''
    const pipe = raw.indexOf('|')
    const targetPart = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim()
    const labelPart = (pipe >= 0 ? raw.slice(pipe + 1) : '').trim()
    const target = (targetPart.split(/[#^]/)[0] ?? '').trim()
    if (!target) continue

    const key = normalizeNoteTitle(target)
    if (!key || seen.has(key)) continue

    seen.add(key)
    links.push({ target, key, label: labelPart || target })
  }

  return links
}

/** 生成安全的文件名片段：保留中英文，替换路径与保留字符，截断到 60 字。 */
export function noteFileSlug(title: string): string {
  const replaced = title
    .normalize('NFKC')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')

  const trimmed = [...replaced].slice(0, 60).join('').replace(/[-.]+$/g, '')
  if (!trimmed) return 'note'
  return RESERVED_NAMES.test(trimmed) ? `${trimmed}-note` : trimmed
}

function yamlString(value: string): string {
  // JSON 字符串是合法的 YAML 双引号标量，可安全承载中文、引号与换行。
  return JSON.stringify(value)
}

/** 生成带 YAML frontmatter 的 Markdown 文件，供 Obsidian 直接打开。 */
export function serializeNoteFile(meta: NoteFileMeta, body: string): string {
  const points = (meta.pointIds ?? []).map(yamlString).join(', ')
  const carriers = (meta.carrierIds ?? []).map(yamlString).join(', ')

  return [
    '---',
    `sublate_id: ${yamlString(meta.id)}`,
    `title: ${yamlString(meta.title)}`,
    `created: ${yamlString(meta.createdAt)}`,
    `updated: ${yamlString(meta.updatedAt)}`,
    `points: [${points}]`,
    `carriers: [${carriers}]`,
    '---',
    '',
    body.trimEnd(),
  ].join('\n')
}

/** 列表摘要：去掉 Markdown 与 wiki 语法，截断到指定字数。 */
export function noteExcerpt(body: string, length = 120): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^[\]|#^]+)(?:[|#^][^[\]]*)?\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const chars = [...plain]
  return chars.length > length ? `${chars.slice(0, length).join('')}…` : plain
}
