# Spec-0010：Agent 对话面板与会话审计

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M4（第三阶段）

## 目标

把学习助手变成可用、可审计、可回放的界面能力：

1. Agent 会话与事件写入 SQLite，重启后仍可回放；
2. Agent 使用真实 AI 做决策，输出「工具调用」或「完成」；
3. 交互式步骤：渲染端逐步驱动，write-commit 工具必须经用户确认；
4. 预算与终止：单次任务最多 12 步、token 超预算停止、连续相同工具与参数停止、可取消；
5. 学习工具扩展：读取知识点、到期复习、掌握度分析、推荐下一知识点、调整计划；
6. 新增「助手」页面：目标输入、预算、对话与工具卡片、确认按钮、历史会话回放。

## 非目标

- 按用户要求，本阶段不配置 `DEEPSEEK_API_KEY`，不做真实模型对话验收；
- 不实现联网搜索、终端或代码执行工具；
- 不做多轮自由聊天（每次以「目标 → 完成」为一次任务）；
- M5 的研究类技能与笔记工具。

## 数据变更（迁移 008）

| 表 | 关键列 | 说明 |
|---|---|---|
| `agent_sessions` | `id`、`goal`、`title`、`status`、`budget_tokens`、`used_tokens`、`answer`、`created_at`、`updated_at` | 一次任务一行；`status` 为 running/done/failed/cancelled |
| `agent_events` | `session_id`、`seq`、`type`、`payload_json`、`created_at` | 只追加，主键 `(session_id, seq)`；外键级联删除 |

## 接口

### storage-sqlite（`ctx.db.agentSessions`）

```ts
create(goal, budgetTokens): AgentSessionRecord
append(sessionId, type, payload): AgentEventRecord
get(sessionId): { session, events } | undefined
list(limit?): AgentSessionSummary[]
update(sessionId, patch): void
remove(sessionId): void
```

`append` 的 `seq` 取当前最大值 + 1；事件不可修改。

### session 插件

有 `db.agentSessions` 时写 SQLite，否则回退内存（保持测试 fixture 可用）。`SessionApi` 扩展：

```ts
start(goal, options?: { budgetTokens?: number })
get(sessionId): SessionDetail | undefined   // 含 status、budgetTokens、usedTokens、events
list(limit?): SessionSummary[]
finish(sessionId, patch: { status?, usedTokens?, answer? }): void
```

### agent 插件

服务新增交互式接口，同时保留 `run(options)` 供脚本与测试使用：

```ts
start(input: { goal: string; budgetTokens?: number }): Promise<AgentStep>
step(input: { sessionId: string; approved?: boolean }): Promise<AgentStep>
cancel(sessionId: string): void

interface AgentStep {
  sessionId: string
  status: 'running' | 'confirm' | 'done' | 'error'
  events: AgentEvent[]        // 本次调用新增的事件
  pending?: { tool: string; args: unknown; permission: Permission }
  answer?: string
  error?: string
  usedTokens: number
  budgetTokens: number
}
```

行为：

- 无 AI Key 时 `start` 记录 error 并返回 `status = 'error'`，错误文案为「未配置 AI API Key，无法启动助手」；
- 每次 `start`/`step` 最多推进「一次 AI 决策 + 一次工具调用」；
- `write-commit` 与 `dangerous` 工具返回 `status = 'confirm'` 并保存 pending；`step({ approved: false })` 记录错误并终止，`approved: true` 才执行；
- 预算默认 8000 tokens，累计 usage 超出即停止；
- 连续两次相同「工具 + 参数」停止并说明无进展；
- 步数上限 12；`cancel` 后下一次调用返回错误；
- 所有事件实时写入 `agent_events`，会话结束时更新 `status`、`used_tokens`、`answer`。

IPC：

| 频道 | 入参 | 返回 |
|---|---|---|
| `agent:start` | `{ goal, budgetTokens? }` | `AgentStep` |
| `agent:step` | `{ sessionId, approved? }` | `AgentStep` |
| `agent:cancel` | `{ sessionId }` | `void` |
| `agent:sessions` | `{}` | `SessionSummary[]` |
| `agent:session` | `{ id }` | `SessionDetail` |

### study-tools 扩展

| 工具 | 权限 | 作用 |
|---|---|---|
| `list_due_reviews` | read | 返回到期卡与新卡摘要，含掌握度 |
| `get_point` | read | 读取知识点正文、页码与掌握度 |
| `analyze_mastery` | read | 返回统计、掌握度分布与载体/课程掌握度 |
| `recommend_next` | read | 优先到期卡，其次按课程顺序与前置条件推荐，附理由 |
| `update_plan` | write-commit | 调整计划项日期或完成状态，必须确认 |

## 界面

- 侧边栏新增「助手」，放在「进度」之后；
- 页面为两栏：左侧会话列表（可回放），右侧当前任务；
- 顶部输入学习目标、token 预算与「开始」按钮；
- 对话区按事件渲染：用户目标、工具卡片（工具名、参数、结果摘要）、确认卡片（允许/拒绝）、回答与错误；
- 运行中状态显示「处理中」，可取消；无 Key 时显示明确错误与配置提示；
- 历史会话只读回放，显示状态、token 用量与事件时间线。

## 验收标准

- 无 Key 时开始任务立即显示「未配置 AI API Key」，不产生工具调用；
- 假 AI 场景下可完成多步任务，事件顺序为 turn → tool_call → tool_result → done；
- write-commit 工具在未确认前不执行，拒绝后会话以错误结束；
- 累计 usage 超预算时停止并提示；
- 连续相同工具与参数停止并提示无进展；
- 会话关闭应用后重新打开仍可回放；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过。

## 测试点

1. 迁移 008 与会话仓储：事件自增、只追加、重开数据库可读、级联删除；
2. 交互式循环：多步完成、确认拒绝、确认执行；
3. 预算超限、无进展、取消；
4. 无 Key 错误；
5. study-tools 新工具注册、权限与返回结构；
6. `recommend_next` 的到期优先与课程顺序。

## 实测结果（2026-10-22）

- 插件树：20 个插件全部 `running`；调整 profile 顺序，agent 位于 ipc-bridge 与 ai-provider 之后；
- 迁移：SQLite `user_version = 8`，既有测试版本断言同步更新；
- 测试：153 passed（新增 18 个：Agent 交互 7、会话仓储 4、学习工具 7）；
- 无 Key：助手页开始任务后显示「未配置 AI API Key，无法启动助手」，会话状态置为失败、0 tokens，并提示配置环境变量后重启；
- 持久化：重启 Electron 后会话列表仍显示上次任务，事件可从 SQLite 回放；
- 界面：浅色与深色下助手页的目标输入、预算、会话卡片、事件卡片与错误提示正常；
- 安全边界（单测覆盖）：write-commit 未确认不执行、拒绝后终止、超预算停止、连续相同工具与参数停止、取消会话；
- 未验证：真实模型对话与 `recommend_next` 的推荐质量——按要求未配置 `DEEPSEEK_API_KEY`，待后续抽样。

## 风险与后续

- AI 决策质量依赖模型，本阶段只验证状态机与安全边界；
- 事件 payload 未做脱敏，后续需要过滤密钥与超长正文；
- 真实模型对话与推荐质量待配置 Key 后抽样验收。
