# Spec-0005：知识点与单元抽取

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M2（第三阶段）

## 目标

把载体的页文本抽取为可修订的「知识单元 / 知识点」草稿：

1. 新增 `knowledge_units`、`knowledge_points` 与 `ai_jobs` 三张表；
2. `extractor` 插件按 chunk 分批调用 `ctx.ai.chat`，要求 JSON 输出并校验结构；
3. 抽取结果一律为草稿，页码锚点受载体页数约束；
4. 每次抽取记录任务状态、进度、token 与错误；
5. 无 API Key 或模型返回非法 JSON 时任务失败且给出可读原因，不影响已有数据。

## 非目标

- 修订界面（Spec-0006）；
- Agent 工具注册（Spec-0006）；
- PDF 目录（outline）识别与按目录切单元（后续）；
- 测验生成与掌握度计算（M3/M4）。

## 数据变更（迁移 005）

```sql
CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT,
  status TEXT NOT NULL,              -- pending | running | done | failed | cancelled
  progress REAL NOT NULL DEFAULT 0,
  result_json TEXT,
  error TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE knowledge_units (
  id TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | confirmed
  source TEXT NOT NULL DEFAULT 'ai',      -- ai | manual
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE knowledge_points (
  id TEXT PRIMARY KEY,
  unit_id TEXT REFERENCES knowledge_units (id) ON DELETE SET NULL,
  carrier_id TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | confirmed | rejected
  source TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX knowledge_units_carrier_idx ON knowledge_units (carrier_id);
CREATE INDEX knowledge_points_carrier_idx ON knowledge_points (carrier_id);
CREATE INDEX knowledge_points_unit_idx ON knowledge_points (unit_id);
CREATE INDEX knowledge_points_status_idx ON knowledge_points (status);
```

## 接口

### storage-sqlite

`ctx.db.knowledge`：

```ts
replaceDraft(carrierId: string, draft: { units: UnitDraft[]; points: PointDraft[] }): void
listUnits(carrierId: string): KnowledgeUnit[]
listPoints(carrierId: string, options?: { status?: PointStatus }): KnowledgePoint[]
confirmPoints(ids: string[]): void
rejectPoints(ids: string[]): void
updatePointAnchor(id: string, pageStart: number, pageEnd: number): void
pointStats(carrierId: string): { total: number; draft: number; confirmed: number; rejected: number }
```

`replaceDraft` 只清空该载体的 `draft` 知识点与无确认点的草稿单元，已确认内容不受影响。

`ctx.db.aiJobs`：

```ts
create(input: { kind: string; refId?: string }): AiJob
update(id: string, patch: { status?: JobStatus; progress?: number; error?: string; resultJson?: string; promptTokens?: number; completionTokens?: number }): void
get(id: string): AiJob | undefined
list(limit?: number): AiJob[]
```

### extractor（`ctx.extractor`）

```ts
extract(carrierId: string): Promise<ExtractResult>

interface ExtractResult {
  jobId: string
  status: 'done' | 'failed'
  unitCount: number
  pointCount: number
  error?: string
}
```

行为：

1. 读取载体的 chunk（`ctx.db.chunks.listChunks`），按 12 个一组分批；
2. 每批构造 system + user 提示，要求返回：

```json
{
  "units": [
    {
      "title": "单元标题",
      "pageStart": 1,
      "pageEnd": 3,
      "points": [
        { "title": "知识点标题", "content": "一两句可教学的内容", "pageStart": 1, "pageEnd": 2 }
      ]
    }
  ]
}
```

3. 用 zod 校验结构，页码 clamp 到 `1..carrier.pageCount`，非法条目丢弃并计数；
4. 全部批次成功后写入草稿，任务标记 `done`，汇总 token；
5. 任一批次失败则任务 `failed`，不写入部分结果（避免半套数据）；
6. 无 AI Key 时直接失败，错误为「未配置 AI API Key」。

## 验收标准

- 有 mock AI 时一次抽取写入单元与知识点，页码在合法范围；
- 非法 JSON、缺字段、越界页码被过滤或使任务失败并给出原因；
- 无 Key 时任务 `failed`，原有确认内容与草稿不变；
- 重复抽取替换旧草稿但保留已确认知识点；
- `ai_jobs` 记录状态、token 与时间；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。

## 测试点

1. 迁移到版本 5，三张表可写；
2. `replaceDraft` 保留 confirmed、替换 draft；
3. `confirmPoints` / `rejectPoints` / `pointStats`；
4. `updatePointAnchor` 页码更新；
5. ai_jobs 创建、更新、查询；
6. extractor mock 成功：分批、页码 clamp、计数；
7. extractor 非法 JSON 失败且不写数据；
8. extractor 无 Key 失败。

## 实测结果（2026-10-22）

- 插件树：16 个插件全部 `running`（新增 extractor），无 Key 时仍正常加载；
- 测试：79 passed（新增知识仓储 4、AI 任务 3、抽取 4）；
- mock AI 覆盖：15 个 chunk 分 2 批、页码从 999 clamp 到页数上限、非法 JSON 失败且不写数据、无 Key 不调用模型、重复抽取保留已确认知识点；
- 未验证：真实 DeepSeek 抽取质量（采纳率与锚点正确率需要 Key 后人工抽样）。

## 风险与后续

- 长书分批抽取可能出现重复单元，交给 Spec-0006 的合并与人工修订；
- 提示注入：载体正文属于 `untrusted`，抽取提示明确要求忽略正文中的指令；
- 真实采纳率 ≥ 70% 与锚点正确率 ≥ 85% 需要配置 `DEEPSEEK_API_KEY` 后人工抽样。
