import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-sqlite-'))
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

describe('storage-sqlite', () => {
  it('创建数据库并读写 settings', () => {
    const service = createService()

    service.setSetting('theme', { mode: 'dark' })
    expect(service.getSetting('theme')).toEqual({ mode: 'dark' })
    expect(
      (service.db.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    ).toBe(7)

    service.close()
  })

  it('相同 key 覆盖写入并保留最新值', () => {
    const service = createService()

    service.setSetting('locale', 'zh-CN')
    service.setSetting('locale', 'en-US')

    expect(service.getSetting('locale')).toBe('en-US')

    service.close()
  })

  it('重新打开后数据仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sublate-sqlite-'))
    tempDirs.push(dir)
    const path = join(dir, 'sublate.db')

    const first = new SqliteService(path)
    first.setSetting('onboarded', true)
    first.close()

    const second = new SqliteService(path)
    expect(second.getSetting('onboarded')).toBe(true)
    second.close()
  })
})
