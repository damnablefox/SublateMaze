import type { ReactNode } from 'react'

interface MarkdownViewProps {
  content: string
  onWikiLink?(target: string): void
}

const INLINE =
  /(\[\[[^[\]\n]+?\]\])|(`[^`\n]+?`)|(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)|(\[[^\]\n]+?\]\(https?:\/\/[^)\s]+?\))/g

function wikiParts(raw: string): { target: string; label: string } {
  const inner = raw.slice(2, -2)
  const [head, alias] = inner.split('|')
  const target = (head ?? '').split(/[#^]/)[0]?.trim() ?? ''
  return { target, label: alias?.trim() || target }
}

/** 行内渲染：wiki 链接、代码、粗体、斜体与外部链接；不使用 innerHTML。 */
function renderInline(text: string, onWikiLink?: (target: string) => void): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let index = 0

  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))

    const raw = match[0]
    const key = `inline-${index++}`

    if (match[1]) {
      const { target, label } = wikiParts(raw)
      nodes.push(
        <button
          key={key}
          type="button"
          className="md-wikilink"
          title={`打开「${target}」`}
          onClick={() => onWikiLink?.(target)}
        >
          {label}
        </button>,
      )
    } else if (match[2]) {
      nodes.push(<code key={key}>{raw.slice(1, -1)}</code>)
    } else if (match[3]) {
      nodes.push(<strong key={key}>{renderInline(raw.slice(2, -2), onWikiLink)}</strong>)
    } else if (match[4]) {
      nodes.push(<em key={key}>{renderInline(raw.slice(1, -1), onWikiLink)}</em>)
    } else {
      const label = /^\[([^\]]+)\]/.exec(raw)?.[1] ?? raw
      const url = /\((https?:\/\/[^)\s]+)\)$/.exec(raw)?.[1]
      nodes.push(
        <a key={key} href={url} target="_blank" rel="noreferrer">
          {label}
        </a>,
      )
    }

    last = start + raw.length
  }

  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,6})\s+/.test(line)
    || /^\s*([-*]|\d+\.)\s+/.test(line)
    || line.startsWith('>')
    || line.trimStart().startsWith('```')
    || /^\s*(---|\*\*\*)\s*$/.test(line)
  )
}

/**
 * 轻量 Markdown 预览。
 *
 * 只支持笔记常用语法，输出 React 节点，避免任何 HTML 注入。
 */
export function MarkdownView({ content, onWikiLink }: MarkdownViewProps) {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let key = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(
        <pre key={key++}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const HeadingTag = (['h3', 'h4', 'h5', 'h6'] as const)[Math.min(level - 1, 3)]
      blocks.push(<HeadingTag key={key++}>{renderInline(heading[2] ?? '', onWikiLink)}</HeadingTag>)
      index += 1
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, onWikiLink)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, onWikiLink)}</li>
          ))}
        </ol>,
      )
      continue
    }

    if (line.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        quote.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={key++}>{renderInline(quote.join(' '), onWikiLink)}</blockquote>)
      continue
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      blocks.push(<hr key={key++} />)
      index += 1
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() && !isBlockStart(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={key++}>{renderInline(paragraph.join(' '), onWikiLink)}</p>)
  }

  return <div className="md-body">{blocks}</div>
}
