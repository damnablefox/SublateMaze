import type { Context } from '@deepseek-ai/cordis'

export const name = 'indexer'
export const inject: string[] = []

/** 单次 embedding 请求的 chunk 数，兼顾延迟与成本。 */
const BATCH_SIZE = 16

export interface IndexResult {
  carrierId: string
  indexed: number
  failed: number
  skipped: boolean
  error?: string
}

export interface IndexerStats {
  chunks: { total: number; indexed: number; pending: number; failed: number }
  vectorRows: number
  model?: string
  available: boolean
}

interface ChunkLike {
  id: string
  carrierId: string
  pageNo: number
  chunkNo: number
  text: string
  status: string
  model?: string
}

interface ChunkStoreLike {
  listChunks(carrierId: string): ChunkLike[]
  markChunksIndexed(ids: string[], model: string): void
  markChunksFailed(ids: string[], error: string): void
  resetChunksForModel(model: string): number
  chunkStats(): { total: number; indexed: number; pending: number; failed: number }
}

interface DbLike {
  carriers: { list(): { id: string }[] }
  chunks: ChunkStoreLike
}

interface AiLike {
  embedding: { available: boolean; model?: string; dim: number; reason?: string }
  embed(
    request: { input: string[] },
    options?: { signal?: AbortSignal },
  ): Promise<{ vectors: number[][] }>
}

interface VectorRecordLike {
  id: string
  vector: number[]
  text?: string
  ownerType?: string
  ownerId?: string
}

interface VectorLike {
  replaceByOwner(ownerType: string, ownerId: string, records: VectorRecordLike[]): Promise<void>
  stats(): Promise<{ rows: number; dim: number; collection: string; staleRows: number }>
}

export interface IndexerDeps {
  db: DbLike
  ai: AiLike
  vector: VectorLike
  log?: (message: string) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 载体 chunk 的向量索引编排。
 *
 * SQLite 先提交 chunk，再异步写入 LanceDB；失败只影响索引状态，
 * 不回滚导入，也不影响 FTS5 检索。
 */
export class IndexerService {
  private readonly db: DbLike
  private readonly ai: AiLike
  private readonly vector: VectorLike
  private readonly log: (message: string) => void

  constructor(deps: IndexerDeps) {
    this.db = deps.db
    this.ai = deps.ai
    this.vector = deps.vector
    this.log = deps.log ?? (() => {})
  }

  /** 向量能力未启用时直接跳过，不把 chunk 标记为失败。 */
  async indexCarrier(carrierId: string): Promise<IndexResult> {
    const model = this.ai.embedding.model
    if (!this.ai.embedding.available || !model) {
      return {
        carrierId,
        indexed: 0,
        failed: 0,
        skipped: true,
        error: this.ai.embedding.reason,
      }
    }

    const chunks = this.db.chunks
      .listChunks(carrierId)
      .filter(chunk => chunk.status !== 'indexed' || chunk.model !== model)

    if (chunks.length === 0) {
      return { carrierId, indexed: 0, failed: 0, skipped: true }
    }

    const succeeded: ChunkLike[] = []
    const records: VectorRecordLike[] = []
    let failed = 0

    for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + BATCH_SIZE)

      try {
        const result = await this.ai.embed({ input: batch.map(chunk => chunk.text) })
        for (const [index, chunk] of batch.entries()) {
          const vector = result.vectors[index]
          if (!vector) continue
          records.push({
            id: chunk.id,
            vector,
            text: chunk.text,
            ownerType: 'carrier',
            ownerId: carrierId,
          })
          succeeded.push(chunk)
        }
      } catch (error) {
        failed += batch.length
        this.db.chunks.markChunksFailed(
          batch.map(chunk => chunk.id),
          errorMessage(error),
        )
        this.log(`chunk 向量化失败：${carrierId} 第 ${offset + 1} 批：${errorMessage(error)}`)
      }
    }

    if (records.length === 0) {
      return {
        carrierId,
        indexed: 0,
        failed,
        skipped: false,
        error: '所有批次的 embedding 均失败',
      }
    }

    try {
      await this.vector.replaceByOwner('carrier', carrierId, records)
      this.db.chunks.markChunksIndexed(
        succeeded.map(chunk => chunk.id),
        model,
      )
    } catch (error) {
      const message = errorMessage(error)
      this.db.chunks.markChunksFailed(
        succeeded.map(chunk => chunk.id),
        message,
      )
      return {
        carrierId,
        indexed: 0,
        failed: failed + succeeded.length,
        skipped: false,
        error: message,
      }
    }

    return { carrierId, indexed: succeeded.length, failed, skipped: false }
  }

  /** 全量重建：模型变化时先把旧模型的 chunk 置回待索引。 */
  async indexAll(): Promise<IndexResult[]> {
    const model = this.ai.embedding.model
    if (this.ai.embedding.available && model) {
      this.db.chunks.resetChunksForModel(model)
    }

    const results: IndexResult[] = []
    for (const carrier of this.db.carriers.list()) {
      results.push(await this.indexCarrier(carrier.id))
    }
    return results
  }

  async stats(): Promise<IndexerStats> {
    const vector = await this.vector.stats()
    return {
      chunks: this.db.chunks.chunkStats(),
      vectorRows: vector.rows,
      model: this.ai.embedding.model,
      available: this.ai.embedding.available,
    }
  }
}

export function apply(ctx: Context) {
  const db = ctx.get('db') as DbLike | undefined
  const ai = ctx.get('ai') as AiLike | undefined
  const vector = ctx.get('vector') as VectorLike | undefined

  if (!db || !ai || !vector) {
    throw new Error('indexer 需要 db、ai、vector 服务')
  }

  const service = new IndexerService({
    db,
    ai,
    vector,
    log: message => ctx.logger('indexer').warn(message),
  })

  ctx.provide('indexer', service)

  const on = ctx.on as unknown as (name: string, listener: (payload: unknown) => void) => void
  on('carrier/imported', (payload) => {
    const carrierId = (payload as { carrierId?: string } | undefined)?.carrierId
    if (!carrierId) return

    void service.indexCarrier(carrierId).catch((error) => {
      ctx.logger('indexer').warn(`载体索引失败：${carrierId}：${errorMessage(error)}`)
    })
  })

  ctx.logger('indexer').info(
    ai.embedding.available
      ? `向量索引已就绪：${ai.embedding.model}`
      : '向量索引未启用（缺少 embedding 模型）',
  )
}
