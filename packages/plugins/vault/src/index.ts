import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'vault'
export const inject: string[] = []

export interface VaultConfig {
  /** vault 根目录；默认 `.vault`。 */
  path?: string
}

export interface VaultInfo {
  path: string
  formatVersion: number
  createdAt: string
}

const FORMAT_VERSION = 1

/**
 * 知识库目录服务。
 *
 * 所有文件访问都必须经过 `resolvePath`，确保目标位于 vault 内。
 */
export class VaultService {
  readonly info: VaultInfo
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
    mkdirSync(join(this.root, '.sublate'), { recursive: true })

    const infoPath = join(this.root, 'vault.json')
    if (existsSync(infoPath)) {
      this.info = JSON.parse(readFileSync(infoPath, 'utf8')) as VaultInfo
    } else {
      this.info = {
        path: this.root,
        formatVersion: FORMAT_VERSION,
        createdAt: new Date().toISOString(),
      }
      writeFileSync(infoPath, `${JSON.stringify(this.info, null, 2)}\n`, 'utf8')
    }
  }

  getInfo(): VaultInfo {
    return this.info
  }

  getRoot(): string {
    return this.root
  }

  /** 解析相对路径并拒绝越界访问。 */
  resolvePath(relativePath: string): string {
    const target = resolve(this.root, relativePath)
    const rel = relative(this.root, target)

    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`路径越界：${relativePath}`)
    }

    return target
  }
}

export function apply(ctx: Context, config: VaultConfig = {}) {
  const service = new VaultService(config.path ?? '.vault')
  ctx.provide('vault', service)
  ctx.logger('vault').info(`知识库已打开：${service.getRoot()}`)
}
