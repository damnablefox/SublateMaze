import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { MIGRATION_001 } from './migrations.ts'

export const name = 'storage-sqlite'
export const inject: string[] = []

export interface StorageConfig {
  /** 数据库文件路径；相对路径相对于进程工作目录。 */
  path?: string
}

/**
 * SQLite 关系存储服务。
 *
 * 约定：只有本插件持有连接；其他插件通过 `ctx.db` 调用领域方法，
 * 不直接执行 SQL，也不在别处打开同一个数据库文件。
 */
export class SqliteService {
  readonly db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number

    if (version < 1) {
      this.db.transaction(() => {
        this.db.exec(MIGRATION_001)
        this.db.pragma('user_version = 1')
      })()
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
