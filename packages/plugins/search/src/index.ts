import type { Context } from '@deepseek-ai/cordis'
import { buildFtsMatch } from '@sublate/core'
import { z } from 'zod'

export const name = 'search'
export const inject: string[] = []

export type SearchSource = 'fts' | 'vector'

export interface SearchHit {
  carrierId: string
  title: string
  pageNo: number
  snippet: string
  score: number
  sources: SearchSource[]
}

interface FtsHit {
  carrierId: string
  title: string
  pageNo: number
  text: string
}

interface ChunkHit {
  id: string
  carrierId: string
  title: string
  pageNo: number
  text: string
}

interface VectorRow {
  id: string
}

interface DbLike {
  carriers: { searchPages(match: string, limit?: number): FtsHit[] }
  chunks: { getChunksByIds(ids: string[]): ChunkHit[] }
}

interface AiLike {
  embedding: { available: boolean; model?: string; dim: number }
  embed(request: { input: string[] }): Promise<{ vectors: number[][] }>
}

interface VectorLike {
  query(vector: number[], topK: number): Promise<VectorRow[]>
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

export interface SearchDeps {
  db: DbLike
  ai?: AiLike
  vector?: VectorLike
  log?: (message: string) => void
}

const RRF_K = 60
const FTS_LIMIT = 30
const VECTOR_LIMIT = 30

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface FusedEntry {
  carrierId: string
  title: string
  pageNo: number
  text: string
  score: number
  sources: Set<SearchSource>
}

/**
 * 混合检索：FTS5 与向量两路召回，按 RRF 融合。
 *
 * 向量侧不可用或失败时静默退化为 FTS5，检索接口保持一致。
 */
export class SearchService {
  private readonly db: DbLike
  private readonly ai?: AiLike
  private readonly vector?: VectorLike
  private readonly log: (message: string) => void

  constructor(deps: SearchDeps) {
    this.db = deps.db
    this.ai = deps.ai
    this.vector = deps.vector
    this.log = deps.log ?? (() => {})
  }

  async query(text: string, options: { limit?: number } = {}): Promise<SearchHit[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
    const match = buildFtsMatch(text)
    const fused = new Map<string, FusedEntry>()

    const add = (
      row: { carrierId: string; title: string; pageNo: number; text: string },
      source: SearchSource,
      rank: number,
    ) => {
      const key = `${row.carrierId}:${row.pageNo}`
      const existing = fused.get(key)

      if (existing) {
        existing.score += 1 / (RRF_K + rank)
        existing.sources.add(source)
        return
      }

      fused.set(key, {
        carrierId: row.carrierId,
        title: row.title,
        pageNo: row.pageNo,
        text: row.text,
        score: 1 / (RRF_K + rank),
        sources: new Set([source]),
      })
    }

    if (match) {
      this.db.carriers.searchPages(match, FTS_LIMIT).forEach((row, index) => {
        add(row, 'fts', index + 1)
      })
    }

    const vectorHits = await this.searchVector(text)
    vectorHits.forEach((row, index) => {
      add(row, 'vector', index + 1)
    })

    return [...fused.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(entry => ({
        carrierId: entry.carrierId,
        title: entry.title,
        pageNo: entry.pageNo,
        snippet: makeSnippet(entry.text, text),
        score: entry.score,
        sources: [...entry.sources],
      }))
  }

  /** 向量召回后按页去重，同一页只保留排名最好的一条。 */
  private async searchVector(text: string): Promise<ChunkHit[]> {
    if (!this.ai?.embedding.available || !this.ai.embedding.model || !this.vector) {
      return []
    }
    if (!text.trim()) return []

    try {
      const embedded = await this.ai.embed({ input: [text] })
      const vector = embedded.vectors[0]
      if (!vector) return []

      const rows = await this.vector.query(vector, VECTOR_LIMIT)
      const chunks = this.db.chunks.getChunksByIds(rows.map(row => row.id))
      const byId = new Map(chunks.map(chunk => [chunk.id, chunk]))

      const pages: ChunkHit[] = []
      const seen = new Set<string>()

      for (const row of rows) {
        const chunk = byId.get(row.id)
        if (!chunk) continue

        const key = `${chunk.carrierId}:${chunk.pageNo}`
        if (seen.has(key)) continue

        seen.add(key)
        pages.push(chunk)
      }

      return pages
    } catch (error) {
      this.log(`向量检索失败，已退化为 FTS5：${errorMessage(error)}`)
      return []
    }
  }
}

const QueryInput = z.object({
  text: z.string().trim().min(1),
  limit: z.number().int().positive().max(100).optional(),
})

export function apply(ctx: Context) {
  const db = ctx.get('db') as DbLike | undefined
  if (!db) throw new Error('search 需要 db 服务')

  const ai = ctx.get('ai') as AiLike | undefined
  const vector = ctx.get('vector') as VectorLike | undefined

  const service = new SearchService({
    db,
    ai,
    vector,
    log: message => ctx.logger('search').warn(message),
  })

  ctx.provide('search', service)

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) {
    const dispose = ipc.register('search:query', (input: unknown) => {
      const { text, limit } = QueryInput.parse(input)
      return service.query(text, { limit })
    })
    ctx.effect(() => dispose)
  } else {
    ctx.logger('search').warn('IPC 服务不可用，检索频道未注册')
  }

  ctx.logger('search').info(
    ai?.embedding.available && vector ? '混合检索已就绪（FTS5 + 向量）' : '全文检索已就绪（FTS5）',
  )
}
