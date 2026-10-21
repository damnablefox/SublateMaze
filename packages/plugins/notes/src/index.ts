import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  noteFileSlug,
  normalizeNoteTitle,
  parseWikiLinks,
  serializeNoteFile,
} from '@sublate/core'
import { z } from 'zod'

export const name = 'notes'
export const inject: string[] = []

const MAX_TITLE_LENGTH = 200
const MAX_BODY_LENGTH = 1_000_000
const TRASH_DIR = '.sublate/trash/notes'

export type NoteRefType = 'point' | 'carrier'

export interface NoteRefInput {
  refType: NoteRefType
  refId: string
}

interface NoteRecordLike {
  id: string
  title: string
  titleKey: string
  body: string
  relPath: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  excerpt: string
}

interface NoteLinkLike {
  noteId: string
  targetTitle: string
  targetKey: string
  targetNoteId?: string
  targetNoteTitle?: string
}

interface NoteBacklinkLike {
  noteId: string
  title: string
  targetTitle: string
  updatedAt: string
  excerpt: string
}

interface NoteRefLike {
  noteId: string
  refType: NoteRefType
  refId: string
}

interface NoteStoreLike {
  create(input: { id?: string; title: string; body?: string; relPath: string }): NoteRecordLike
  update(id: string, patch: { title?: string; body?: string; relPath?: string }): void
  get(id: string): NoteRecordLike | undefined
  getByTitleKey(key: string): NoteRecordLike | undefined
  list(options?: { includeDeleted?: boolean; onlyDeleted?: boolean; query?: string }): NoteRecordLike[]
  listSummaries(options?: {
    includeDeleted?: boolean
    onlyDeleted?: boolean
    query?: string
  }): (NoteRecordLike & { linkCount: number; backlinkCount: number; refs: NoteRefLike[] })[]
  trash(): (NoteRecordLike & { linkCount: number; backlinkCount: number; refs: NoteRefLike[] })[]
  remove(id: string): void
  restore(id: string): void
  purge(id: string): void
  replaceLinks(noteId: string, links: { targetTitle: string; targetKey: string }[]): void
  replaceRefs(noteId: string, refs: NoteRefInput[]): void
  links(noteId: string): NoteLinkLike[]
  backlinks(noteId: string): NoteBacklinkLike[]
  refs(noteId: string): NoteRefLike[]
  notesForRef(refType: NoteRefType, refId: string): NoteRecordLike[]
  resolveLinks(): number
}

interface CarrierLike {
  id: string
  title: string
  deletedAt?: string
}

interface PointLike {
  id: string
  title: string
}

interface DbLike {
  notes: NoteStoreLike
  carriers: { list(): CarrierLike[] }
  knowledge: { listPoints(carrierId: string): PointLike[] }
}

interface VaultLike {
  resolvePath(relativePath: string): string
}

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

export interface NotesDeps {
  db: DbLike
  vault: VaultLike
}

export interface NoteSummary extends NoteRecordLike {
  linkCount: number
  backlinkCount: number
  refs: NoteRefLike[]
}

export interface NoteDetail {
  note: NoteRecordLike
  links: NoteLinkLike[]
  backlinks: NoteBacklinkLike[]
  refs: NoteRefLike[]
}

export interface NoteRefOptions {
  carriers: { id: string; title: string }[]
  points: { id: string; title: string; carrierId: string; carrierTitle: string }[]
}

function assertTitle(title: string): void {
  if (!title) throw new Error('笔记标题不能为空')
  if ([...title].length > MAX_TITLE_LENGTH) {
    throw new Error(`笔记标题不能超过 ${MAX_TITLE_LENGTH} 字`)
  }
}

function normalizeRefs(refs: NoteRefInput[] = []): NoteRefInput[] {
  const seen = new Set<string>()
  const output: NoteRefInput[] = []

  for (const ref of refs) {
    const key = `${ref.refType}:${ref.refId}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({ refType: ref.refType, refId: ref.refId })
  }

  return output.slice(0, 50)
}

/**
 * 笔记服务。
 *
 * 数据库是权威来源，Markdown 文件是面向用户的可读镜像；
 * 每次保存都会重写文件与 frontmatter，删除时移入回收站目录。
 */
export class NotesService {
  private readonly db: DbLike
  private readonly vault: VaultLike

  constructor(deps: NotesDeps) {
    this.db = deps.db
    this.vault = deps.vault
  }

  list(options: { includeDeleted?: boolean; query?: string } = {}): NoteSummary[] {
    return this.db.notes.listSummaries(options)
  }

  trash(): NoteSummary[] {
    return this.db.notes.trash()
  }

  detail(id: string): NoteDetail | undefined {
    const note = this.db.notes.get(id)
    if (!note) return undefined

    return {
      note,
      links: this.db.notes.links(id),
      backlinks: this.db.notes.backlinks(id),
      refs: this.db.notes.refs(id),
    }
  }

  create(input: { title: string; body?: string; refs?: NoteRefInput[] }): NoteDetail {
    const title = input.title.trim()
    assertTitle(title)

    if (this.db.notes.getByTitleKey(normalizeNoteTitle(title))) {
      throw new Error(`同名笔记已存在：${title}`)
    }

    const body = input.body ?? ''
    if (body.length > MAX_BODY_LENGTH) {
      throw new Error('笔记正文超过 1 MB 上限')
    }

    const id = randomUUID()
    const refs = normalizeRefs(input.refs)
    const relPath = this.allocateRelPath(title, id)

    this.writeFile({ id, title, body, relPath, refs })

    try {
      this.db.notes.create({ id, title, body, relPath })
    } catch (error) {
      this.removeFile(relPath)
      throw error
    }

    this.db.notes.replaceLinks(id, this.linksOf(body))
    this.db.notes.replaceRefs(id, refs)
    this.db.notes.resolveLinks()

    return this.detail(id)!
  }

  update(
    id: string,
    patch: { title?: string; body?: string; refs?: NoteRefInput[] },
  ): NoteDetail {
    const current = this.db.notes.get(id)
    if (!current || current.deletedAt) throw new Error(`笔记不存在：${id}`)

    const title = patch.title === undefined ? current.title : patch.title.trim()
    assertTitle(title)

    const conflict = this.db.notes.getByTitleKey(normalizeNoteTitle(title))
    if (conflict && conflict.id !== id) {
      throw new Error(`同名笔记已存在：${title}`)
    }

    const body = patch.body ?? current.body
    if (body.length > MAX_BODY_LENGTH) {
      throw new Error('笔记正文超过 1 MB 上限')
    }

    const refs = patch.refs
      ? normalizeRefs(patch.refs)
      : this.db.notes.refs(id).map(ref => ({ refType: ref.refType, refId: ref.refId }))
    const relPath = patch.title === undefined
      ? current.relPath
      : this.allocateRelPath(title, id, current.relPath)

    this.writeFile({ id, title, body, relPath, refs })

    try {
      this.db.notes.update(id, { title, body, relPath })
    } catch (error) {
      if (relPath !== current.relPath) this.removeFile(relPath)
      throw error
    }

    if (relPath !== current.relPath) this.removeFile(current.relPath)

    this.db.notes.replaceLinks(id, this.linksOf(body))
    this.db.notes.replaceRefs(id, refs)
    this.db.notes.resolveLinks()

    return this.detail(id)!
  }

  remove(id: string): void {
    const note = this.db.notes.get(id)
    if (!note || note.deletedAt) return

    const source = this.vault.resolvePath(note.relPath)
    if (existsSync(source)) {
      const target = this.vault.resolvePath(`${TRASH_DIR}/${id}.md`)
      mkdirSync(dirname(target), { recursive: true })
      rmSync(target, { force: true })
      renameSync(source, target)
    }

    this.db.notes.remove(id)
    this.db.notes.resolveLinks()
  }

  restore(id: string): NoteDetail {
    const note = this.db.notes.get(id)
    if (!note) throw new Error(`回收站中找不到笔记：${id}`)
    if (!note.deletedAt) return this.detail(id)!

    this.db.notes.restore(id)
    const restored = this.db.notes.get(id)!
    const refs = this.db.notes.refs(id).map(ref => ({ refType: ref.refType, refId: ref.refId }))
    const relPath = this.allocateRelPath(restored.title, id)

    if (relPath !== restored.relPath) {
      this.db.notes.update(id, { relPath })
    }

    this.writeFile({ ...restored, relPath, refs })
    this.removeFile(`${TRASH_DIR}/${id}.md`)
    this.db.notes.resolveLinks()

    return this.detail(id)!
  }

  purge(id: string): void {
    const note = this.db.notes.get(id)
    if (!note) return

    this.removeFile(note.relPath)
    this.removeFile(`${TRASH_DIR}/${id}.md`)
    this.db.notes.purge(id)
    this.db.notes.resolveLinks()
  }

  forRef(refType: NoteRefType, refId: string): NoteRecordLike[] {
    return this.db.notes.notesForRef(refType, refId)
  }

  refOptions(): NoteRefOptions {
    const carriers = this.db.carriers.list().filter(carrier => !carrier.deletedAt)
    const points = carriers.flatMap(carrier =>
      this.db.knowledge.listPoints(carrier.id).map(point => ({
        id: point.id,
        title: point.title,
        carrierId: carrier.id,
        carrierTitle: carrier.title,
      })),
    )

    return {
      carriers: carriers.map(carrier => ({ id: carrier.id, title: carrier.title })),
      points,
    }
  }

  private linksOf(body: string): { targetTitle: string; targetKey: string }[] {
    return parseWikiLinks(body).map(link => ({ targetTitle: link.target, targetKey: link.key }))
  }

  /**
   * 分配不冲突的文件路径。
   *
   * 冲突来源有两类：数据库里其他笔记占用的路径（含回收站中的笔记），
   * 以及磁盘上已存在但未被数据库登记的文件。
   */
  private allocateRelPath(title: string, id: string, currentRelPath?: string): string {
    const slug = noteFileSlug(title)
    const owners = new Map(
      this.db.notes
        .list({ includeDeleted: true })
        .map(note => [note.relPath, note.id] as const),
    )

    const isFree = (relPath: string) => {
      const owner = owners.get(relPath)
      if (owner && owner !== id) return false
      if (currentRelPath === relPath) return true
      return !existsSync(this.vault.resolvePath(relPath))
    }

    const base = `notes/${slug}.md`
    if (isFree(base)) return base

    const shortId = `notes/${slug}-${id.slice(0, 6)}.md`
    if (isFree(shortId)) return shortId

    return `notes/${slug}-${id.slice(0, 12)}.md`
  }

  private writeFile(note: {
    id: string
    title: string
    body: string
    relPath: string
    createdAt?: string
    updatedAt?: string
    refs: NoteRefInput[]
  }): void {
    const target = this.vault.resolvePath(note.relPath)
    mkdirSync(dirname(target), { recursive: true })

    const now = new Date().toISOString()
    const content = serializeNoteFile(
      {
        id: note.id,
        title: note.title,
        createdAt: note.createdAt ?? now,
        updatedAt: note.updatedAt ?? now,
        pointIds: note.refs.filter(ref => ref.refType === 'point').map(ref => ref.refId),
        carrierIds: note.refs.filter(ref => ref.refType === 'carrier').map(ref => ref.refId),
      },
      note.body,
    )

    writeFileSync(target, `${content}\n`, 'utf8')
  }

  private removeFile(relPath: string): void {
    try {
      rmSync(this.vault.resolvePath(relPath), { force: true })
    } catch {
      // 文件已不存在或路径非法时忽略，数据库仍以记录为准。
    }
  }
}

const IdInput = z.object({ id: z.string().min(1) })
const RefInput = z.object({
  refType: z.enum(['point', 'carrier']),
  refId: z.string().min(1),
})
const RefsInput = z.array(RefInput).max(50)

const CreateInput = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  body: z.string().max(MAX_BODY_LENGTH).optional(),
  refs: RefsInput.optional(),
})

const UpdateInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
  body: z.string().max(MAX_BODY_LENGTH).optional(),
  refs: RefsInput.optional(),
})

const ListInput = z.object({
  includeDeleted: z.boolean().optional(),
  query: z.string().max(MAX_TITLE_LENGTH).optional(),
})

const ForRefInput = z.object({
  refType: z.enum(['point', 'carrier']),
  refId: z.string().min(1),
})

function registerChannels(ctx: Context, notes: NotesService, ipc: IpcLike): void {
  const disposers: (() => void)[] = []
  const register = (channel: string, handler: (...args: any[]) => any) => {
    disposers.push(ipc.register(channel, handler))
  }

  register('note:list', (input: unknown) => notes.list(ListInput.parse(input ?? {})))
  register('note:trash', () => notes.trash())
  register('note:detail', (input: unknown) => {
    const { id } = IdInput.parse(input)
    const detail = notes.detail(id)
    if (!detail) throw new Error(`笔记不存在：${id}`)
    return detail
  })
  register('note:create', (input: unknown) => notes.create(CreateInput.parse(input)))
  register('note:update', (input: unknown) => {
    const { id, ...patch } = UpdateInput.parse(input)
    return notes.update(id, patch)
  })
  register('note:delete', (input: unknown) => {
    const { id } = IdInput.parse(input)
    notes.remove(id)
  })
  register('note:restore', (input: unknown) => {
    const { id } = IdInput.parse(input)
    return notes.restore(id)
  })
  register('note:purge', (input: unknown) => {
    const { id } = IdInput.parse(input)
    notes.purge(id)
  })
  register('note:for-ref', (input: unknown) => {
    const { refType, refId } = ForRefInput.parse(input)
    return notes.forRef(refType, refId)
  })
  register('note:ref-options', () => notes.refOptions())

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })

  ctx.logger('notes').info('笔记频道已注册')
}

export function apply(ctx: Context) {
  const db = ctx.get('db') as DbLike | undefined
  const vault = ctx.get('vault') as VaultLike | undefined
  if (!db?.notes) throw new Error('notes 需要 db.notes 服务')
  if (!vault) throw new Error('notes 需要 vault 服务')

  const service = new NotesService({ db, vault })
  ctx.provide('notes', service)

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) {
    registerChannels(ctx, service, ipc)
  } else {
    ctx.logger('notes').warn('IPC 服务不可用，笔记频道未注册')
  }
}
