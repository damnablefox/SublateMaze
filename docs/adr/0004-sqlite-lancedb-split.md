# ADR-0004：SQLite 与 LanceDB 的分工

- 状态：已采纳
- 日期：2026-10-21

## 背景

项目既需要事务、关系与元数据查询，也需要向量相似检索与 RAG。只用 SQLite 需要额外扩展，只用向量库又缺少事务与关系能力。

## 决策

- **SQLite 是唯一关系写者与事务主库**：载体、知识点、课程、计划、掌握度、笔记关系、`embeddings` 指针；
- **LanceDB 是可重建的派生索引**：chunk 向量、chunk 文本与最小过滤字段；
- SQLite 事务提交后写入 `embeddings.status = pending`，再由 `storage-lancedb` 异步写入向量并回写 `indexed`；
- 向量写入失败只标记 `stale`，不回写业务数据；启动自检与 `reindex` 负责修复；
- 检索并行使用 FTS5（关键词）与 LanceDB（语义），RRF 融合。

## 后果

- 不存在跨库事务；LanceDB 损坏可以重建；
- 需要维护索引队列与自检；
- 换向量后端（如 sqlite-vec）时只需替换 `storage-lancedb` 插件，`ctx.vector` 接口不变。

## 当前实现（M0）

- `storage-sqlite` 提供 settings 表与 WAL；
- `storage-lancedb` 提供空表创建、写入、查询与统计；
- 索引队列与自检在 M1–M2 接入。
