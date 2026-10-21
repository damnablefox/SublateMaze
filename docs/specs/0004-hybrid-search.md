# Spec-0004：向量索引与混合检索

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M2（第二阶段）

## 目标

在 FTS5 之外增加语义检索，并把两路结果融合为一条稳定的检索链路：

1. 导入完成后按页切分 chunk，写入 SQLite；
2. embedding 可用时把 chunk 向量写入 LanceDB（派生索引，可重建）；
3. 检索时并行执行 FTS5 与向量查询，用 RRF（Reciprocal Rank Fusion）融合；
4. embedding 不可用或失败时自动退化为纯 FTS5，不影响导入与阅读；
5. 提供 `reindex`、索引状态统计与失败重试入口。

## 非目标

- 知识点抽取（Spec-0005）；
- 重排模型与 LLM 查询改写；
- 多模型 collection 切换 UI（按模型名 + 维度分 collection 的约定保留）；
- 句子级细粒度 chunk 与滑动窗口调参界面。

## 关键取舍

| 取舍 | 决定 | 理由 |
|---|---|---|
| chunk 粒度 | 按页内段落切成约 900 字、重叠 120 字 | 保留页码锚点，控制 embedding 成本 |
| 索引一致性 | SQLite 是主库，LanceDB 是可重建派生索引 | 与 ADR-0004 一致；失败只标记状态 |
| 写入时机 | 导入完成后异步索引，不阻塞导入 | 导入成功率不受 AI 可用性影响 |
| 融合算法 | RRF，k=60 | 不需要两路分数可比，工业界默认 |
| 页级聚合 | 同一页多个 chunk 取最佳排名 | 检索结果定位到页码，与阅读器一致 |
| 模型变更 | 记录 `embedding_model`，模型变化时重新索引 | 避免不同模型向量混用 |

## 数据变更（迁移 004）

```sql
CREATE TABLE carrier_chunks (
  id TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  chunk_no INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding_status TEXT NOT NULL DEFAULT 'pending',  -- pending | indexed | failed
  embedding_model TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (carrier_id, page_no, chunk_no)
);

CREATE INDEX carrier_chunks_carrier_idx ON carrier_chunks (carrier_id);
CREATE INDEX carrier_chunks_status_idx ON carrier_chunks (embedding_status);
```

## 接口

### core

```ts
interface ChunkDraft {
  pageNo: number
  chunkNo: number
  text: string
}

chunkPages(pages: { pageNo: number; text: string }[], targetChars?: number, overlapChars?: number): ChunkDraft[]
```

### storage-sqlite（`ctx.db.chunks`）

```ts
replaceChunks(carrierId: string, drafts: ChunkDraft[]): Chunk[]
listChunks(carrierId: string): Chunk[]
listPendingChunks(limit?: number): Chunk[]
getChunksByIds(ids: string[]): ChunkWithTitle[]
markChunksIndexed(ids: string[], model: string): void
markChunksFailed(ids: string[], error: string): void
resetChunksForModel(model: string): number   // 模型切换后把非该模型的 chunk 置为 pending
chunkStats(): { total: number; indexed: number; pending: number; failed: number }
```

`Chunk` 字段：`id, carrierId, pageNo, chunkNo, text, status, model?, error?`。

### storage-lancedb（`ctx.vector`）

在现有 `upsert`/`query`/`stats` 基础上增加：

```ts
replaceByOwner(ownerType: string, ownerId: string, records: VectorRecord[]): Promise<void>
deleteByOwner(ownerType: string, ownerId: string): Promise<void>
```

先按 `ownerType + ownerId` 删除，再写入；保证同一载体重复索引不产生重复行。

### indexer（`ctx.indexer`）

```ts
indexCarrier(carrierId: string): Promise<IndexResult>
indexAll(): Promise<IndexResult[]>
stats(): { chunks: ChunkStats; vectorRows: number; model?: string; available: boolean }
```

`IndexResult` 包含 `carrierId, indexed, failed, skipped, error?`。

行为：

- 监听 `carrier/imported` 异步索引，不阻塞导入；
- embedding 不可用时直接返回 `skipped`，不写失败状态；
- 每批 16 条调用 `ctx.ai.embed`，成功后写入 LanceDB 并标记 `indexed`；
- 单批失败标记该批 `failed`，记录原因，不影响其他载体；
- 同模型已索引的 chunk 跳过；模型变化时 `resetChunksForModel` 后重新索引。

### search（`ctx.search`）

```ts
interface SearchHit {
  carrierId: string
  title: string
  pageNo: number
  snippet: string
  score: number
  sources: ('fts' | 'vector')[]
}
```

`query(text, options)` 的顺序：

1. FTS5 取前 30 条；
2. 若 `ctx.ai.embedding.available` 且 `ctx.vector` 可用：embed 查询文本，向量取前 30，回查 chunk 得到页码与标题；
3. 按 `carrierId + pageNo` 聚合，向量同一页取最佳排名；
4. RRF 累加：`score += 1 / (60 + rank)`；
5. 排序、截断 `limit`；
6. 任意一路失败只降级，不抛出。

## 验收标准

- 导入后 chunk 数等于各页切分结果之和，`chunkStats` 状态正确；
- 无 embedding 时导入照常完成，检索结果与 M1 的 FTS 一致，`sources` 全为 `fts`；
- mock embedding 下向量行数与 `indexed` chunk 数一致；
- 同页同时被 FTS 与向量命中时，融合结果排在该页仅单路命中的结果之前；
- 删除载体后（软删除）检索不再返回，索引向量可按 owner 清理；
- `reindex` 不产生重复向量行；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。

## 测试点

1. `chunkPages`：短页单块、长页多块、重叠与页码正确；
2. `replaceChunks`：重复写入替换旧数据，状态重置为 pending；
3. `markChunksIndexed/Failed` 与 `chunkStats`；
4. `resetChunksForModel` 只重置不同模型；
5. `VectorService.replaceByOwner` 幂等，行数不增长；
6. indexer 无 embedding 时 skipped、不写失败；
7. indexer 成功路径：批量 embed、写向量、状态 indexed；
8. search 纯 FTS 降级；
9. search RRF：双路命中优先于单路命中；
10. 软删除载体后 FTS 与向量结果都被过滤。

## 实测结果（2026-10-22）

- 插件树：15 个插件全部 `running`（新增 indexer）；
- 测试：68 passed（新增 chunk 切分 4、chunk 仓储 5、indexer 5、LanceDB 幂等 1，检索测试扩展到 8）；
- 无 embedding 时：导入正常完成，chunk 保持 `pending`，检索只返回 FTS 结果；
- mock embedding 下：向量行数与 `indexed` chunk 数一致，同页双路命中按 RRF 排在单路之前；
- 未验证：真实 embedding 服务（DeepSeek 无向量接口，需要配置兼容服务后抽样）。

## 风险与后续

- embedding 成本：按 chunk 批量、只在导入/重建时调用；后续可加缓存；
- LanceDB 向量删除依赖 predicate，id 为 UUID，无注入风险；
- 模型维度变化需要新建 collection 并重建，M2 只记录状态，切换流程在后续补。
