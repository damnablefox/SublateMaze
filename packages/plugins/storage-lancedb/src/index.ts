import * as lancedb from '@lancedb/lancedb'
import { Field, FixedSizeList, Float32, Schema, Utf8 } from 'apache-arrow'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'storage-lancedb'
export const inject: string[] = []

export interface VectorConfig {
  /** 向量库目录；相对路径相对于进程工作目录。 */
  path?: string
  /** 向量维度，必须与 embedding 模型一致。 */
  dim?: number
  /** collection 名称，按“模型 + 维度”区分时可由调用方传入。 */
  collection?: string
}

export interface VectorRecord {
  id: string
  vector: number[]
  text?: string
  ownerType?: string
  ownerId?: string
}

export interface VectorStats {
  rows: number
  dim: number
  collection: string
  staleRows: number
}

/** SQL 字符串字面量转义；owner id 由主程序生成，转义只作防御。 */
function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * LanceDB 向量服务。
 *
 * 约定：这是可重建的派生索引，SQLite 才是主库；本服务不写业务实体，
 * 只负责向量与最小过滤字段。
 */
export class VectorService {
  private connection?: lancedb.Connection
  private table?: lancedb.Table
  private readonly dir: string
  private readonly dim: number
  private readonly collection: string

  constructor(dir: string, dim: number, collection: string) {
    this.dir = dir
    this.dim = dim
    this.collection = collection
  }

  async init(): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    this.connection = await lancedb.connect(this.dir)

    const tables = await this.connection.tableNames()
    this.table = tables.includes(this.collection)
      ? await this.connection.openTable(this.collection)
      : await this.connection.createEmptyTable(this.collection, this.schema())
  }

  private schema(): Schema {
    return new Schema([
      new Field('id', new Utf8(), false),
      new Field(
        'vector',
        new FixedSizeList(this.dim, new Field('item', new Float32(), true)),
        false,
      ),
      new Field('text', new Utf8(), true),
      new Field('ownerType', new Utf8(), true),
      new Field('ownerId', new Utf8(), true),
    ])
  }

  private requireTable(): lancedb.Table {
    if (!this.table) throw new Error('LanceDB 尚未初始化')
    return this.table
  }

  async stats(): Promise<VectorStats> {
    const rows = await this.requireTable().countRows()
    return {
      rows,
      dim: this.dim,
      collection: this.collection,
      staleRows: 0,
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    for (const record of records) {
      if (record.vector.length !== this.dim) {
        throw new Error(
          `向量维度不匹配：期望 ${this.dim}，收到 ${record.vector.length}（id=${record.id}）`,
        )
      }
    }
    // LanceDB 接受 Record 形状的对象；接口字段与 Arrow schema 一一对应。
    await this.requireTable().add(records as unknown as Record<string, unknown>[])
  }

  /** 删除某个 owner 下的全部向量；用于重建索引与载体清理。 */
  async deleteByOwner(ownerType: string, ownerId: string): Promise<void> {
    if (!this.table) return
    await this.requireTable().delete(
      `ownerType = '${escapeLiteral(ownerType)}' AND ownerId = '${escapeLiteral(ownerId)}'`,
    )
  }

  /** 先删后写，保证同一载体重复索引不产生重复行。 */
  async replaceByOwner(
    ownerType: string,
    ownerId: string,
    records: VectorRecord[],
  ): Promise<void> {
    await this.deleteByOwner(ownerType, ownerId)
    await this.upsert(records)
  }

  async query(vector: number[], topK = 10): Promise<(VectorRecord & { _distance: number })[]> {
    if (vector.length !== this.dim) {
      throw new Error(`查询向量维度不匹配：期望 ${this.dim}，收到 ${vector.length}`)
    }
    const rows = await this.requireTable().vectorSearch(vector).limit(topK).toArray()
    return rows as unknown as (VectorRecord & { _distance: number })[]
  }

  close(): void {
    this.connection?.close()
    this.connection = undefined
    this.table = undefined
  }
}

export async function apply(ctx: Context, config: VectorConfig = {}) {
  const dir = resolve(config.path ?? '.sublate/lance')
  const service = new VectorService(dir, config.dim ?? 1024, config.collection ?? 'points')

  await service.init()
  ctx.provide('vector', service)
  ctx.effect(() => () => service.close())
  ctx.logger('storage-lancedb').info(
    `LanceDB 已打开：${dir}（维度 ${config.dim ?? 1024}，collection ${config.collection ?? 'points'}）`,
  )
}
