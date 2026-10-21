# Spec-0006：知识点修订与 Agent 学习工具

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M2（收尾阶段）

## 目标

让抽取出的知识点可以被人工修订，并把学习能力挂到 Agent 上：

1. 知识点支持批量确认、拒绝、合并、拆分与重设页码锚点；
2. 渲染端新增「知识点」页面，按单元分组展示草稿与状态；
3. 抽取按钮在页面内触发，显示进行中与失败原因；
4. 新增 `study-tools` 插件，注册三个 Agent 工具：检索、读取载体、生成知识点草稿；
5. 所有写操作经过工具权限声明，生成草稿为 `write-draft`。

## 非目标

- 课程、目标与计划（M3）；
- 学习卡片、自评与 FSRS（M4）；
- Agent 对话界面（M4）；
- 知识点内容富文本编辑（M2 只做标题/锚点级修订）。

## 数据与接口

### storage-sqlite（`ctx.db.knowledge`）

```ts
mergePoints(ids: string[]): string        // 返合并后的知识点 id
splitPoint(id: string, splitPage: number): { firstId: string; secondId: string }
```

规则：

- 合并只允许草稿状态，按页排序后取第一条的标题与最小页范围，内容用空行连接；
- 拆分只允许草稿状态，`splitPage` 必须落在 `(pageStart, pageEnd]` 内；
- 拆分后第一条结束于 `splitPage - 1`，第二条从 `splitPage` 开始，标题追加「（续）」，内容相同。

### IPC（extractor 注册）

| 频道 | 入参 | 返回 |
|---|---|---|
| `knowledge:list` | `{ carrierId }` | `{ units, points, stats, jobs }` |
| `knowledge:extract` | `{ carrierId }` | `ExtractResult` |
| `knowledge:confirm` | `{ ids }` | `void` |
| `knowledge:reject` | `{ ids }` | `void` |
| `knowledge:anchor` | `{ id, pageStart, pageEnd }` | `void` |
| `knowledge:merge` | `{ ids }` | `{ id }` |
| `knowledge:split` | `{ id, splitPage }` | `{ firstId, secondId }` |

### study-tools（`ctx.tools` 注册）

| 工具 | 权限 | 行为 |
|---|---|---|
| `search_library` | read | 调用 `ctx.search.query`，返回命中 |
| `read_carrier` | read | 按载体 id 与页范围读取文本 |
| `draft_knowledge_points` | write-draft | 调用 `ctx.extractor.extract`，只产生草稿 |

工具输入用 zod 校验；`draft_knowledge_points` 不直接改确认数据。

## 界面

- 侧边栏新增「知识点」入口；
- 页面顶部：载体选择、抽取按钮、统计（草稿/已确认/已拒绝）；
- 内容：按单元分组的行列表，每行含复选框、标题、页码、状态；
- 操作：批量确认、批量拒绝、合并选中、单条锚点编辑、按页拆分；
- 抽取中禁用按钮并显示进度文案；失败显示任务错误。

## 验收标准

- 合并后只剩一条，标题与内容符合规则，已确认点不能被合并；
- 拆分页码越界时给出明确错误，合法拆分产生两条相邻知识点；
- 知识点页面可完成「抽取 → 选中 → 确认」闭环；
- 无 Key 时页面显示明确错误，不产生草稿；
- Agent 能调用三个工具，`draft_knowledge_points` 权限为 `write-draft`；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过。

## 测试点

1. `mergePoints` 合并顺序、内容与页范围；
2. 已确认点合并被拒绝；
3. `splitPoint` 合法与越界；
4. study-tools 注册三个工具与权限；
5. `search_library` / `read_carrier` 返回结构；
6. `draft_knowledge_points` 调用 extractor 且不改确认数据。

## 实测结果（2026-10-22）

- 插件树：17 个插件全部 `running`（新增 study-tools）；
- 测试：88 passed（知识仓储扩展到 8、study-tools 5）；
- 界面：Electron 截图确认浅色/深色下知识点页的载体选择、统计、空状态与按钮布局正常；
- 覆盖：合并/拆分规则、批量确认/拒绝、锚点更新、三个 Agent 工具的注册与调用；
- 未验证：真实 AI 抽取与 Agent 多步任务需要 `DEEPSEEK_API_KEY`；合并/拆分交互需人工点验。

## 风险与后续

- 合并/拆分是页级简化，字符级锚点留到 M3；
- Agent 对话 UI 在 M4，本阶段只保证工具可被调用与审计。
