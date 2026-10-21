import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-sqlite-'))
  tempDirs.push(dir)
  return new SqliteService(join(dir, 'sublate.db'))
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storage-sqlite', () => {
  it('创建数据库并读写 settings', () => {
    const service = createService()

    service.setSetting('theme', { mode: 'dark' })
    expect(service.getSetting('theme')).toEqual({ mode: 'dark' })
    expect(service.db.pragma('user_version', { simple: true })).toBe(1)

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
