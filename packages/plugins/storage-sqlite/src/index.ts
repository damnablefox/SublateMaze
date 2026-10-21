import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AiCallStore } from './ai-calls.ts'
import { CarrierStore } from './carriers.ts'
import { ChunkStore } from './chunks.ts'
import { MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004 } from './migrations.ts'

export * from './ai-calls.ts'
export * from './carriers.ts'
export * from './chunks.ts'

export const name = 'storage-sqlite'
export const inject: string[] = []

export interface StorageConfig {
  /** 数据库文件路径；相对路径相对于进程工作目录。 */
  path?: string
}

/**
 * SQLite 关系存储服务。
 *
 * 使用 Node / Electron 内置的 `node:sqlite`，避免原生模块编译与 ABI 问题。
 * 约定：只有本插件持有连接；其他插件通过 `ctx.db` 调用领域方法。
 */
export class SqliteService {
  readonly db: DatabaseSync
  readonly carriers: CarrierStore
  readonly chunks: ChunkStore
  readonly aiCalls: AiCallStore

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.carriers = new CarrierStore(this.db)
    this.chunks = new ChunkStore(this.db)
    this.aiCalls = new AiCallStore(this.db)
    this.migrate()
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as
      | { user_version: number }
      | undefined
    const version = row?.user_version ?? 0

    if (version < 1) this.runMigration(MIGRATION_001, 1)
    if (version < 2) this.runMigration(MIGRATION_002, 2)
    if (version < 3) this.runMigration(MIGRATION_003, 3)
    if (version < 4) this.runMigration(MIGRATION_004, 4)
  }

  private runMigration(sql: string, targetVersion: number): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec(sql)
      this.db.exec(`PRAGMA user_version = ${targetVersion}`)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getSetting<T = unknown>(key: string): T | undefined {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(key) as { value_json: string } | undefined

    return row ? (JSON.parse(row.value_json) as T) : undefined
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString())
  }

  close(): void {
    this.db.close()
  }
}

export function apply(ctx: Context, config: StorageConfig = {}) {
  const dbPath = resolve(config.path ?? '.sublate/sublate.db')
  const service = new SqliteService(dbPath)

  ctx.provide('db', service)
  ctx.effect(() => () => service.close())
  ctx.logger('storage-sqlite').info(`数据库已打开：${dbPath}`)
}
