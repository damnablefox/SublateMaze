import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createKernel } from '@sublate/kernel'
import type { NativeService } from '@sublate/plugin-native-bridge'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('native-bridge', () => {
  it('对文件计算 SHA-256（Rust 或 TS 后端）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sublate-native-'))
    tempDirs.push(dir)

    const file = join(dir, 'sample.txt')
    const content = 'SublateMaze 原生哈希测试'
    writeFileSync(file, content, 'utf8')

    const { ctx } = await createKernel(resolve(root, 'tests/fixtures/native-profile.yml'))
    const native = ctx.get('native') as NativeService

    const expected = createHash('sha256').update(content).digest('hex')
    expect(await native.hashFile(file)).toBe(expected)
    expect(['rust', 'typescript']).toContain(native.backend)
  })
})
