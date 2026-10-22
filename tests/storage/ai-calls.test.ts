import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-ai-calls-'))
  tempDirs.push(dir)
  const service = new SqliteService(join(dir, 'sublate.db'))
  services.push(service)
  return service
}

afterEach(() => {
  for (const service of services.splice(0)) {
    try {
      service.close()
    } catch {
      // 已手动关闭的连接忽略
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storage-sqlite AI 调用记录', () => {
  it('迁移到版本 11 并汇总调用与 token', () => {
    const service = createService()

    service.aiCalls.record({
      provider: 'deepseek',
      kind: 'chat',
      model: 'deepseek-chat',
      status: 'ok',
      promptTokens: 10,
      completionTokens: 5,
      durationMs: 120,
    })
    service.aiCalls.record({
      provider: 'deepseek',
      kind: 'embedding',
      model: 'bge-m3',
      status: 'ok',
      promptTokens: 8,
    })
    service.aiCalls.record({
      provider: 'deepseek',
      kind: 'chat',
      model: 'deepseek-chat',
      status: 'error',
      error: 'HTTP 401',
    })

    expect(
      (service.db.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    ).toBe(11)

    const stats = service.aiCalls.stats()
    expect(stats.calls).toBe(3)
    expect(stats.promptTokens).toBe(18)
    expect(stats.completionTokens).toBe(5)
    expect(stats.byKind).toEqual({ chat: 2, embedding: 1 })

    const entries = service.aiCalls.list()
    expect(entries).toHaveLength(3)
    expect(entries[0]?.status).toBe('error')
    expect(entries[0]?.error).toBe('HTTP 401')
  })

  it('since 过滤只统计指定时间之后', () => {
    const service = createService()

    service.aiCalls.record({
      provider: 'deepseek',
      kind: 'chat',
      model: 'deepseek-chat',
      status: 'ok',
      promptTokens: 4,
    })

    expect(service.aiCalls.stats({ since: '2000-01-01T00:00:00.000Z' }).calls).toBe(1)
    expect(service.aiCalls.stats({ since: '2999-01-01T00:00:00.000Z' }).calls).toBe(0)
  })
})
