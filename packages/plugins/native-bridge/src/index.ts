import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'native-bridge'
export const inject: string[] = []

export interface NativeService {
  backend: 'rust' | 'typescript'
  version: string
  hashFile(path: string): Promise<string>
}

interface RustBinding {
  fileSha256(path: string): string
  nativeVersion(): string
}

/** 开发态下发现在 crate 目录；打包后的路径在 M6 处理。 */
function loadRustBinding(): RustBinding | undefined {
  try {
    const require = createRequire(import.meta.url)
    const nodePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../crates/sublate-native/sublate-native.win32-x64-msvc.node',
    )
    return require(nodePath) as RustBinding
  } catch {
    return undefined
  }
}

function hashFileWithNode(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)

    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

/**
 * 原生能力桥。
 *
 * Rust 模块缺失时降级为 Node 的流式哈希，保证文件导入流程不中断。
 */
export function apply(ctx: Context) {
  const binding = loadRustBinding()

  const service: NativeService = binding
    ? {
        backend: 'rust',
        version: binding.nativeVersion(),
        hashFile: async (path) => binding.fileSha256(path),
      }
    : {
        backend: 'typescript',
        version: 'fallback',
        hashFile: hashFileWithNode,
      }

  ctx.provide('native', service)
  console.log(`[native-bridge] 后端：${service.backend}（${service.version}）`)
}
