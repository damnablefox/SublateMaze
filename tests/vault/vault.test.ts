import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VaultService } from '@sublate/plugin-vault'

const tempDirs: string[] = []

function createVault() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-vault-'))
  tempDirs.push(dir)
  return { dir, service: new VaultService(dir) }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('vault', () => {
  it('创建目录与 vault.json', () => {
    const { dir, service } = createVault()

    expect(service.getRoot()).toBe(dir)
    expect(service.info.formatVersion).toBe(1)

    const saved = JSON.parse(readFileSync(join(dir, 'vault.json'), 'utf8'))
    expect(saved.path).toBe(dir)
  })

  it('resolvePath 拒绝越界路径', () => {
    const { service } = createVault()

    expect(() => service.resolvePath('../outside.txt')).toThrow('路径越界')
    expect(service.resolvePath('notes/a.md')).toContain('notes')
  })

  it('重新打开时保留创建时间', () => {
    const { dir, service } = createVault()
    const createdAt = service.info.createdAt

    const reopened = new VaultService(dir)
    expect(reopened.info.createdAt).toBe(createdAt)
  })

  it('损坏的 vault.json 会抛错而不是静默覆盖', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sublate-vault-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'vault.json'), '{ broken json', 'utf8')

    expect(() => new VaultService(dir)).toThrow()
  })
})
