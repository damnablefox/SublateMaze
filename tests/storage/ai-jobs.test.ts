import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-jobs-'))
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
      // 已关闭
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storage-sqlite AI 任务', () => {
  it('创建任务并更新状态、进度与 token', () => {
    const service = createService()

    const job = service.aiJobs.create({ kind: 'extract_knowledge', refId: 'carrier-1' })
    expect(job.status).toBe('pending')
    expect(job.progress).toBe(0)

    service.aiJobs.update(job.id, {
      status: 'running',
      progress: 0.5,
      promptTokens: 100,
      completionTokens: 20,
    })

    const running = service.aiJobs.get(job.id)
    expect(running?.status).toBe('running')
    expect(running?.progress).toBe(0.5)
    expect(running?.promptTokens).toBe(100)

    service.aiJobs.update(job.id, { status: 'done', progress: 1, resultJson: '{"ok":true}' })
    expect(service.aiJobs.get(job.id)?.resultJson).toBe('{"ok":true}')
  })

  it('进度限制在 0 到 1', () => {
    const service = createService()
    const job = service.aiJobs.create({ kind: 'test' })

    service.aiJobs.update(job.id, { progress: 3 })
    expect(service.aiJobs.get(job.id)?.progress).toBe(1)

    service.aiJobs.update(job.id, { progress: -1 })
    expect(service.aiJobs.get(job.id)?.progress).toBe(0)
  })

  it('列表返回最近任务', () => {
    const service = createService()

    const first = service.aiJobs.create({ kind: 'a' })
    const second = service.aiJobs.create({ kind: 'b' })

    const jobs = service.aiJobs.list()
    expect(jobs).toHaveLength(2)
    expect(jobs[0]?.id).toBe(second.id)
    expect(jobs[1]?.id).toBe(first.id)
  })
})
