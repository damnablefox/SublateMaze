import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { ExtractorService } from '@sublate/plugin-extractor'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

interface AiStub {
  available: boolean
  chat(request: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    json?: boolean
    temperature?: number
    maxTokens?: number
  }): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }>
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-extractor-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '抽取测试',
    sha256: 'f'.repeat(64),
    relPath: libraryRelPath('f'.repeat(64), 'pdf'),
    mime: 'application/pdf',
    size: 10,
  })

  const pages = Array.from({ length: 10 }, (_, index) => ({
    pageNo: index + 1,
    text: `第 ${index + 1} 页内容`,
  }))
  sqlite.carriers.replacePages(carrier.id, pages)

  const drafts = Array.from({ length: 15 }, (_, index) => ({
    pageNo: (index % 10) + 1,
    chunkNo: index + 1,
    text: `片段 ${index + 1}`,
  }))
  sqlite.chunks.replaceChunks(carrier.id, drafts)

  return { sqlite, carrier }
}

function response(title: string): string {
  return JSON.stringify({
    units: [
      {
        title,
        pageStart: 999,
        pageEnd: 999,
        points: [
          { title: `${title} 知识点`, content: '可教学的内容', pageStart: 999, pageEnd: 999 },
        ],
      },
    ],
  })
}

function createAi(text: string, available = true): { ai: AiStub; calls: () => number } {
  let count = 0
  const ai: AiStub = {
    available,
    chat: async () => {
      count += 1
      return { text, usage: { promptTokens: 10, completionTokens: 5 } }
    },
  }

  return { ai, calls: () => count }
}

afterEach(() => {
  for (const service of services.splice(0)) {
    try {
      service.close()
    } catch {
      // 已关闭
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('extractor', () => {
  it('分批抽取并写入草稿，页码被限制在载体范围内', async () => {
    const { sqlite, carrier } = setup()
    const { ai, calls } = createAi(response('单元'))
    const service = new ExtractorService({ db: sqlite, ai })

    const result = await service.extract(carrier.id)

    expect(result).toMatchObject({ status: 'done', unitCount: 2, pointCount: 2 })
    expect(calls()).toBe(2)

    const points = sqlite.knowledge.listPoints(carrier.id)
    expect(points).toHaveLength(2)
    expect(points.every(point => point.pageStart <= 10 && point.pageEnd <= 10)).toBe(true)

    const job = sqlite.aiJobs.list()[0]
    expect(job?.status).toBe('done')
    expect(job?.promptTokens).toBe(20)
  })

  it('非法 JSON 使任务失败且不写入数据', async () => {
    const { sqlite, carrier } = setup()
    const { ai } = createAi('这不是 JSON')
    const service = new ExtractorService({ db: sqlite, ai })

    const result = await service.extract(carrier.id)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('JSON')
    expect(sqlite.knowledge.listPoints(carrier.id)).toHaveLength(0)
    expect(sqlite.aiJobs.list()[0]?.status).toBe('failed')
  })

  it('没有 API Key 时直接失败且不调用模型', async () => {
    const { sqlite, carrier } = setup()
    const { ai, calls } = createAi(response('单元'), false)
    const service = new ExtractorService({ db: sqlite, ai })

    const result = await service.extract(carrier.id)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('未配置 AI API Key')
    expect(calls()).toBe(0)
  })

  it('重复抽取保留已确认知识点', async () => {
    const { sqlite, carrier } = setup()
    let current = response('旧单元')
    const ai: AiStub = {
      available: true,
      chat: async () => ({
        text: current,
        usage: { promptTokens: 1, completionTokens: 1 },
      }),
    }
    const service = new ExtractorService({ db: sqlite, ai })

    await service.extract(carrier.id)
    const confirmed = sqlite.knowledge.listPoints(carrier.id)[0]!
    sqlite.knowledge.confirmPoints([confirmed.id])

    current = response('新单元')
    await service.extract(carrier.id)

    const stats = sqlite.knowledge.pointStats(carrier.id)
    expect(stats.confirmed).toBe(1)
    expect(stats.draft).toBe(2)
    expect(stats.total).toBe(3)
  })
})
