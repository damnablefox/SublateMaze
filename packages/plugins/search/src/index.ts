import type { Context } from '@deepseek-ai/cordis'
import { buildFtsMatch } from '@sublate/core'
import { z } from 'zod'

export const name = 'search'
export const inject: string[] = []

export interface SearchHit {
  carrierId: string
  title: string
  pageNo: number
  snippet: string
}

interface RawHit {
  carrierId: string
  title: string
  pageNo: number
  text: string
}

interface DbLike {
  carriers: { searchPages(match: string, limit?: number): RawHit[] }
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

/** 在原文中定位查询词并截取上下文，找不到时退化为开头片段。 */
export function makeSnippet(text: string, query: string, radius = 60): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  const keywords = query.trim().split(/\s+/).filter(Boolean)
  let hit = -1

  for (const keyword of keywords) {
    const index = normalized.toLowerCase().indexOf(keyword.toLowerCase())
    if (index >= 0) {
      hit = index
      break
    }
  }

  if (hit < 0) {
    return normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized
  }

  const start = Math.max(0, hit - radius)
  const end = Math.min(normalized.length, hit + radius + 40)

  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`
}

/** 基于 SQLite FTS5 的全文检索；分词规则由 core 统一提供。 */
export class SearchService {
  private readonly db: DbLike

  constructor(db: DbLike) {
    this.db = db
  }

  query(text: string, limit = 20): SearchHit[] {
    const match = buildFtsMatch(text)
    if (!match) return []

    return this.db.carriers.searchPages(match, Math.min(Math.max(limit, 1), 100)).map(row => ({
      carrierId: row.carrierId,
      title: row.title,
      pageNo: row.pageNo,
      snippet: makeSnippet(row.text, text),
    }))
  }
}

const QueryInput = z.object({
  text: z.string().trim().min(1),
  limit: z.number().int().positive().max(100).optional(),
})

export function apply(ctx: Context) {
  const db = ctx.get('db') as DbLike | undefined
  if (!db) throw new Error('search 需要 db 服务')

  const service = new SearchService(db)
  ctx.provide('search', service)

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) {
    const dispose = ipc.register('search:query', (input: unknown) => {
      const { text, limit } = QueryInput.parse(input)
      return service.query(text, limit)
    })
    ctx.effect(() => dispose)
  } else {
    ctx.logger('search').warn('IPC 服务不可用，检索频道未注册')
  }

  ctx.logger('search').info('全文检索服务已就绪（FTS5）')
}
