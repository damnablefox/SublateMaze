import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

export const name = 'study-tools'
export const inject: string[] = []

type Permission = 'read' | 'write-draft' | 'write-commit' | 'dangerous'

interface ToolRegistrationLike {
  name: string
  description: string
  permission: Permission
  input: { parse(value: unknown): any }
  execute(input: any, context: { sessionId?: string }): unknown
}

interface ToolsLike {
  register(tool: ToolRegistrationLike): () => void
}

interface SearchHitLike {
  carrierId: string
  title: string
  pageNo: number
  snippet: string
  score: number
  sources: string[]
}

interface SearchLike {
  query(text: string, options?: { limit?: number }): Promise<SearchHitLike[]>
}

interface CarrierLike {
  id: string
  title: string
  pageCount: number
}

interface DbLike {
  carriers: {
    get(id: string): CarrierLike | undefined
    getPages(carrierId: string, from: number, to: number): { pageNo: number; text: string }[]
  }
}

interface ExtractorLike {
  extract(carrierId: string): Promise<unknown>
}

export interface StudyToolDeps {
  tools: ToolsLike
  search: SearchLike
  db: DbLike
  extractor: ExtractorLike
}

const SearchInput = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().positive().max(50).optional(),
})

const ReadInput = z.object({
  carrierId: z.string().min(1),
  from: z.number().int().positive(),
  to: z.number().int().positive(),
})

const DraftInput = z.object({ carrierId: z.string().min(1) })

/**
 * 注册学习域工具；返回注销函数，便于插件卸载。
 *
 * `draft_knowledge_points` 只产生草稿，不触碰已确认数据。
 */
export function registerStudyTools(deps: StudyToolDeps): (() => void)[] {
  return [
    deps.tools.register({
      name: 'search_library',
      description: '检索知识库正文，返回载体标题、页码与摘要',
      permission: 'read',
      input: SearchInput,
      execute: input => deps.search.query(input.query, { limit: input.limit }),
    }),

    deps.tools.register({
      name: 'read_carrier',
      description: '按页范围读取某个载体的文本内容',
      permission: 'read',
      input: ReadInput,
      execute: (input) => {
        const carrier = deps.db.carriers.get(input.carrierId)
        if (!carrier) throw new Error(`载体不存在：${input.carrierId}`)

        const from = Math.min(input.from, input.to)
        const to = Math.max(input.from, input.to)

        return {
          carrierId: carrier.id,
          title: carrier.title,
          pageCount: carrier.pageCount,
          pages: deps.db.carriers.getPages(carrier.id, from, to),
        }
      },
    }),

    deps.tools.register({
      name: 'draft_knowledge_points',
      description: '为指定载体生成知识单元与知识点草稿，需要人工确认',
      permission: 'write-draft',
      input: DraftInput,
      execute: input => deps.extractor.extract(input.carrierId),
    }),
  ]
}

export function apply(ctx: Context) {
  const tools = ctx.get('tools') as ToolsLike | undefined
  const search = ctx.get('search') as SearchLike | undefined
  const db = ctx.get('db') as DbLike | undefined
  const extractor = ctx.get('extractor') as ExtractorLike | undefined

  if (!tools || !search || !db || !extractor) {
    throw new Error('study-tools 需要 tools、search、db、extractor 服务')
  }

  const disposers = registerStudyTools({ tools, search, db, extractor })
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })

  ctx.logger('study-tools').info('学习工具已注册：search_library、read_carrier、draft_knowledge_points')
}
