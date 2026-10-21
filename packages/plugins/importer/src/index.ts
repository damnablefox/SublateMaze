import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  carrierKindFromExt,
  libraryRelPath,
  mimeFromExt,
  type CarrierKind,
} from '@sublate/core'
import { z } from 'zod'

export const name = 'importer'
export const inject: string[] = []

export interface ImportResult {
  carrierId?: string
  title: string
  duplicated: boolean
  status: 'ready' | 'failed'
  error?: string
}

interface CarrierLike {
  id: string
  title: string
  status: string
  deletedAt?: string
  pageCount: number
  file: { relPath: string; mime: string; sha256: string; size: number }
}

interface CreateCarrierInputLike {
  kind: CarrierKind
  title: string
  sourceUrl?: string
  sha256: string
  relPath: string
  mime: string
  size: number
}

interface CarrierStoreLike {
  create(input: CreateCarrierInputLike): CarrierLike
  get(id: string): CarrierLike | undefined
  findBySha256(sha256: string): CarrierLike | undefined
  list(options?: { includeDeleted?: boolean }): CarrierLike[]
  listTrash(): CarrierLike[]
  setStatus(id: string, status: 'pending' | 'parsing' | 'ready' | 'failed', error?: string): void
  rename(id: string, title: string): void
  replacePages(id: string, pages: { pageNo: number; text: string }[]): void
  getPages(id: string, from: number, to: number): { pageNo: number; text: string }[]
  getReadState(id: string): { pageNo: number; scrollRatio: number } | undefined
  saveReadState(id: string, pageNo: number, scrollRatio: number): void
  softDelete(id: string): void
  restore(id: string): void
}

interface DbLike {
  carriers: CarrierStoreLike
}

interface NativeLike {
  hashFile(path: string): Promise<string>
}

interface VaultLike {
  resolvePath(relativePath: string): string
}

interface ParserLike {
  parsePdf(path: string, sha256: string): Promise<{ title?: string; pages: { pageNo: number; text: string }[] }>
  fetchWeb(url: string): Promise<{ html: string; finalUrl: string }>
  parseWebHtml(
    html: string,
    sha256: string,
    fallbackTitle?: string,
  ): Promise<{ title?: string; pages: { pageNo: number; text: string }[] }>
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

export interface ImporterDeps {
  native: NativeLike
  vault: VaultLike
  db: DbLike
  parser: ParserLike
  emit?: (event: string, payload: unknown) => void
}

const IdInput = z.object({ id: z.string().min(1) })
const ImportUrlInput = z.object({ url: z.string().url() })
const PagesInput = z.object({
  id: z.string().min(1),
  from: z.number().int().positive(),
  to: z.number().int().positive(),
})
const ReadPositionInput = z.object({
  id: z.string().min(1),
  pageNo: z.number().int().positive(),
  scrollRatio: z.number().min(0).max(1),
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 与 Rust 侧 file_sha256 一致：对完整文件字节做 SHA-256。 */
function sha256OfBuffer(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * 导入编排：内容寻址落盘 → 建档 → 解析 → 写页文本与索引。
 *
 * 单个文件失败只记录在该载体上，不阻断同批其他文件。
 */
export class ImporterService {
  private readonly deps: ImporterDeps

  constructor(deps: ImporterDeps) {
    this.deps = deps
  }

  async importFiles(paths: string[]): Promise<ImportResult[]> {
    const results: ImportResult[] = []
    for (const path of paths) {
      results.push(await this.importFile(path))
    }
    return results
  }

  async importFile(sourcePath: string): Promise<ImportResult> {
    const title = basename(sourcePath, extname(sourcePath))

    try {
      const kind = carrierKindFromExt(extname(sourcePath))
      if (!kind) {
        return {
          title,
          duplicated: false,
          status: 'failed',
          error: '暂不支持该文件类型（M1 仅支持 PDF）',
        }
      }

      const sha256 = await this.deps.native.hashFile(sourcePath)
      const existing = this.deps.db.carriers.findBySha256(sha256)
      if (existing) {
        if (existing.deletedAt) this.deps.db.carriers.restore(existing.id)
        return this.resultFromCarrier(existing, true)
      }

      const relPath = libraryRelPath(sha256, extname(sourcePath))
      const target = this.deps.vault.resolvePath(relPath)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(sourcePath, target)

      const size = (await stat(target)).size
      const carrier = this.deps.db.carriers.create({
        kind,
        title,
        sha256,
        relPath,
        mime: mimeFromExt(extname(sourcePath)),
        size,
      })

      try {
        this.deps.db.carriers.setStatus(carrier.id, 'parsing')
        const parsed = await this.deps.parser.parsePdf(target, sha256)
        this.deps.db.carriers.replacePages(carrier.id, parsed.pages)

        if (parsed.title && parsed.title !== carrier.title) {
          this.deps.db.carriers.rename(carrier.id, parsed.title)
        }

        this.deps.db.carriers.setStatus(carrier.id, 'ready')
        this.notify(carrier.id)

        return {
          carrierId: carrier.id,
          title: parsed.title ?? carrier.title,
          duplicated: false,
          status: 'ready',
        }
      } catch (error) {
        this.deps.db.carriers.setStatus(carrier.id, 'failed', errorMessage(error))
        return {
          carrierId: carrier.id,
          title: carrier.title,
          duplicated: false,
          status: 'failed',
          error: errorMessage(error),
        }
      }
    } catch (error) {
      return {
        title,
        duplicated: false,
        status: 'failed',
        error: errorMessage(error),
      }
    }
  }

  async importUrl(url: string): Promise<ImportResult> {
    let fallbackTitle = url

    try {
      const fetched = await this.deps.parser.fetchWeb(url)
      fallbackTitle = fetched.finalUrl

      const bytes = Buffer.from(fetched.html, 'utf8')
      const sha256 = sha256OfBuffer(bytes)
      const existing = this.deps.db.carriers.findBySha256(sha256)
      if (existing) {
        if (existing.deletedAt) this.deps.db.carriers.restore(existing.id)
        return this.resultFromCarrier(existing, true)
      }

      const relPath = libraryRelPath(sha256, 'html')
      const target = this.deps.vault.resolvePath(relPath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes)

      const carrier = this.deps.db.carriers.create({
        kind: 'web',
        title: fallbackTitle,
        sourceUrl: url,
        sha256,
        relPath,
        mime: mimeFromExt('html'),
        size: bytes.byteLength,
      })

      try {
        this.deps.db.carriers.setStatus(carrier.id, 'parsing')
        const parsed = await this.deps.parser.parseWebHtml(fetched.html, sha256, fallbackTitle)
        this.deps.db.carriers.replacePages(carrier.id, parsed.pages)

        if (parsed.title) {
          this.deps.db.carriers.rename(carrier.id, parsed.title)
        }

        this.deps.db.carriers.setStatus(carrier.id, 'ready')
        this.notify(carrier.id)

        return {
          carrierId: carrier.id,
          title: parsed.title ?? carrier.title,
          duplicated: false,
          status: 'ready',
        }
      } catch (error) {
        this.deps.db.carriers.setStatus(carrier.id, 'failed', errorMessage(error))
        return {
          carrierId: carrier.id,
          title: carrier.title,
          duplicated: false,
          status: 'failed',
          error: errorMessage(error),
        }
      }
    } catch (error) {
      return {
        title: fallbackTitle,
        duplicated: false,
        status: 'failed',
        error: errorMessage(error),
      }
    }
  }

  private resultFromCarrier(carrier: CarrierLike, duplicated: boolean): ImportResult {
    return {
      carrierId: carrier.id,
      title: carrier.title,
      duplicated,
      status: carrier.status === 'ready' ? 'ready' : 'failed',
      error: carrier.status === 'ready' ? undefined : '上次导入未完成，请在回收站删除后重新导入',
    }
  }

  private notify(carrierId: string): void {
    this.deps.emit?.('carrier/imported', { carrierId })
  }
}

/** 注册渲染进程可调用的知识库频道。 */
function registerChannels(
  ctx: Context,
  db: DbLike,
  vault: VaultLike,
  importer: ImporterService,
  ipc: IpcLike,
) {
  const disposers: (() => void)[] = []
  const register = (channel: string, handler: (...args: any[]) => any) => {
    disposers.push(ipc.register(channel, handler))
  }

  register('library:list', (options: unknown) => {
    const includeDeleted =
      typeof options === 'object' && options !== null && 'includeDeleted' in options
        ? Boolean((options as { includeDeleted?: boolean }).includeDeleted)
        : false
    return db.carriers.list({ includeDeleted })
  })

  register('library:import-files', (paths: unknown) => {
    const list = z.array(z.string().min(1)).parse(paths)
    return importer.importFiles(list)
  })

  register('library:import-url', (input: unknown) => {
    const { url } = ImportUrlInput.parse(input)
    return importer.importUrl(url)
  })

  register('carrier:detail', (input: unknown) => {
    const { id } = IdInput.parse(input)
    const carrier = db.carriers.get(id)
    if (!carrier) throw new Error(`载体不存在：${id}`)
    return { carrier, readState: db.carriers.getReadState(id) }
  })

  register('carrier:pages', (input: unknown) => {
    const { id, from, to } = PagesInput.parse(input)
    return db.carriers.getPages(id, from, Math.max(from, to))
  })

  // PDF 阅读器按需读取原始文件字节；用 IPC 传输，避免在 file:// 页面下跨源拉取自定义协议。
  register('carrier:file', async (input: unknown) => {
    const { id } = IdInput.parse(input)
    const carrier = db.carriers.get(id)
    if (!carrier) throw new Error(`载体不存在：${id}`)

    const data = await readFile(vault.resolvePath(carrier.file.relPath))
    return new Uint8Array(data)
  })

  register('carrier:read-position', (input: unknown) => {
    const { id, pageNo, scrollRatio } = ReadPositionInput.parse(input)
    db.carriers.saveReadState(id, pageNo, scrollRatio)
  })

  register('carrier:delete', (input: unknown) => {
    const { id } = IdInput.parse(input)
    db.carriers.softDelete(id)
  })

  register('carrier:restore', (input: unknown) => {
    const { id } = IdInput.parse(input)
    db.carriers.restore(id)
  })

  register('trash:list', () => db.carriers.listTrash())

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })

  ctx.logger('importer').info('知识库导入服务已就绪')
}

export function apply(ctx: Context) {
  const native = ctx.get('native') as NativeLike | undefined
  const vault = ctx.get('vault') as VaultLike | undefined
  const db = ctx.get('db') as DbLike | undefined
  const parser = ctx.get('parser') as ParserLike | undefined

  if (!native || !vault || !db || !parser) {
    throw new Error('importer 需要 native、vault、db、parser 服务')
  }

  const service = new ImporterService({
    native,
    vault,
    db,
    parser,
    emit: (event, payload) =>
      (ctx.emit as unknown as (name: string, payload: unknown) => void)(event, payload),
  })

  ctx.provide('importer', service)

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) {
    registerChannels(ctx, db, vault, service, ipc)
  } else {
    ctx.logger('importer').warn('IPC 服务不可用，知识库频道未注册')
  }
}
