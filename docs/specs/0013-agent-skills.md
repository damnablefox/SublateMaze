# Spec-0013：Agent 技能库

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M5（第三阶段）

## 目标

1. 按学习目标自动选择预设技能：知识点抽取、学习计划、复习教练、研究助手；
2. 技能提供额外提示词，并把可用工具聚焦到该技能需要的工具；
3. 技能选择写入会话事件，助手页可回放；
4. 助手页展示技能库，点击填入示例目标；
5. 保持现有安全边界：写操作仍需确认、预算与步数限制不变。

## 非目标

- 不做用户自定义技能或技能编辑；
- 不做多技能组合与技能切换；
- 不改变工具的权限级别与确认流程；
- 不做真实模型效果验收（按约定使用模拟与单测）。

## 接口

### core（`packages/core/src/skills.ts`）

```ts
interface AgentSkill {
  id: string
  title: string
  description: string
  keywords: string[]
  tools: string[]
  prompt: string
  example: string
}

selectAgentSkill(goal: string): AgentSkill | undefined
```

选择规则：目标转小写后统计每个技能的关键词命中数，取最高分；同分保留定义顺序靠前者；无命中返回 `undefined`，使用通用提示与全部工具。

内置技能：

| id | 标题 | 工具 |
|---|---|---|
| `extraction` | 知识点抽取 | `search_library`、`read_carrier`、`draft_knowledge_points` |
| `planning` | 学习计划 | `analyze_mastery`、`recommend_next`、`update_plan` |
| `review` | 复习教练 | `list_due_reviews`、`get_point`、`recommend_next` |
| `research` | 研究助手 | `search_library`、`read_carrier`、`analyze_mastery` |

### agent 插件

- `start`/`run` 在创建会话后选择技能，并追加 `skill` 事件：`{ id, title, description }`；
- 决策提示追加当前技能名称、描述与提示词；
- 可用工具列表优先只列技能工具；若技能工具都未注册，则回退全部工具（保证测试与自定义工具可用）；
- 无 AI Key 时仍先记录技能事件，再以原错误终止。

IPC：

| 频道 | 入参 | 返回 |
|---|---|---|
| `agent:skills` | `{}` | `{ id, title, description, keywords, tools, example }[]` |

## 界面

- 助手页目标输入下方显示「技能」行，四个技能为可点击 chip；
- chip 的悬浮提示展示技能描述与示例；
- 点击 chip 将示例目标填入输入框；
- 会话线程中渲染 `skill` 事件：技能标签、名称与描述。

## 验收标准

- 「帮我复习今天到期的知识点」选择复习教练；
- 「根据掌握度安排学习计划」选择学习计划；
- 无命中目标不产生技能事件，助手行为与之前一致；
- 技能事件写入 SQLite，重启后回放可见；
- 技能工具未注册时仍可使用全部工具（现有 demo 测试不回归）；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过；
- 浅色与深色下技能 chip 显示正常。

## 测试点

1. core：关键词选择、无命中、同分顺序、多关键词得分；
2. agent：技能事件、无 Key 时技能事件仍记录、自定义工具回退；
3. 界面：技能行显示与示例填充。

## 实测结果（2026-10-22）

- core 测试：关键词选择、无命中、同分顺序、多关键词得分共 5 个通过；
- agent 测试：技能事件、无命中不记录、无 Key 仍记录技能事件，新增 3 个通过；
- 界面：助手页技能行显示「知识点抽取 / 学习计划 / 复习教练 / 研究助手」四个 chip；点击「学习计划」把示例目标填入输入框；
- 无 Key 场景：开始任务后先显示「技能 学习计划 评估掌握度与到期任务，调整每日学习安排」，随后显示「未配置 AI API Key，无法启动助手」与配置提示；会话状态为失败、0 tokens；
- 主题：浅色与深色下技能 chip 与技能事件显示正常；
- 构建：`pnpm typecheck`、`pnpm lint` 与 Electron 构建通过；
- 未验证：真实模型下的技能提示效果（按要求使用模拟完成）。
