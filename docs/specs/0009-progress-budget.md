# Spec-0009：进度面板与每日预算

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M4（第二阶段）

## 目标

把复习与学习进度变得可见、可解释：

1. 每日预算：到期复习优先，复习最多占可用时间 40%，总时间预留 20% 缓冲，单日新学不超过 5 个；
2. 掌握度分布：按 0–25%、25–50%、50–75%、75–100% 四档统计已确认知识点；
3. 载体消化：每个载体的已确认知识点数、已复习数与平均掌握度；
4. 课程进度：每门课程的已确认知识点数、已复习数与平均掌握度；
5. 新增「进度」页面展示上述指标。

## 非目标

- Agent 对话面板（M4 第三阶段）；
- 学习计划自动按预算重写（仍在 M4 后续评估）；
- 笔记证据与专业集研究程度（M5）。

## 接口

### core（`@sublate/core`）

```ts
interface BudgetInput {
  dailyMinutes: number
  dueCount: number
  newCount: number
  minutesPerReview?: number   // 默认 3
  minutesPerNew?: number      // 默认 10
  maxNewPerDay?: number       // 默认 5
}

interface BudgetResult {
  totalMinutes: number
  reserveMinutes: number
  availableMinutes: number
  reviewSlots: number
  newSlots: number
  reviewMinutes: number
  newMinutes: number
  message: string
}

planDailyBudget(input: BudgetInput): BudgetResult
```

规则：`reserve = total × 0.2`，`available = total - reserve`，复习上限 = `available × 0.4`；复习张数不超过 `dueCount`，新学数量不超过 `newCount` 与 5；分钟数按默认 3 分钟/复习、10 分钟/新学估算。

### storage-sqlite（`ctx.db.scheduler`）

```ts
listConfirmedByCarrier(): { scopeId, scopeTitle, pointId, mastery? }[]
listConfirmedByCourse(): { scopeId, scopeTitle, pointId, mastery? }[]
activeDailyMinutes(): number   // 活跃计划的最大每日分钟，缺省 30
```

### scheduler 插件

`ctx.scheduler.overview(now?: Date): ReviewOverview`

```ts
interface ScopeProgress {
  id: string
  title: string
  total: number
  learned: number
  mastery: number
}

interface ReviewOverview {
  stats: ReviewStats
  dailyMinutes: number
  budget: BudgetResult
  byCarrier: ScopeProgress[]
  byCourse: ScopeProgress[]
  distribution: { label: string; count: number }[]
}
```

IPC 新增 `review:overview`，返回上述结构。

聚合规则：

- 只统计 `confirmed` 且载体未删除的知识点；
- 课程维度按 `course_points` 去重后统计，同一知识点出现在多门课程时分别计入；
- 平均掌握度 = 该范围内知识点掌握度之和 / 知识点数，未复习知识点按 0 计。

## 界面

- 侧边栏新增「进度」，顺序为：今日、复习、知识库、知识点、课程、进度、回收站；
- 进度页：
  - 顶部统计：已确认知识点、已复习、平均掌握、到期与新卡；
  - 今日预算卡片：按活跃计划的每日分钟给出复习张数、新学个数与缓冲时间；
  - 掌握度分布：四档横向条形；
  - 载体消化列表：标题、已确认/已复习数量、掌握度进度条；
  - 课程进度列表：同上；
  - 空状态：没有已确认知识点时提示去「知识点」页确认。

## 验收标准

- 30 分钟预算、到期 10 张、新学 10 个时，建议复习 3 张、新学 1 个、预留 6 分钟；
- 到期为 0 时全部预算给新学，且单日新学不超过 5 个；
- 载体与课程的平均掌握度与各知识点掌握度一致；
- 进度页在浅色与深色下可读，空状态明确；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过。

## 测试点

1. `planDailyBudget` 的预留、复习上限、新学上限；
2. 预算为 0 与到期为 0 的边界；
3. 仓储聚合按载体与课程分组、排除已删除载体；
4. overview 的掌握度分布与平均掌握；
5. 活跃计划每日分钟缺省值。

## 实测结果（2026-10-22）

- 测试：135 passed（新增 7 个：预算算法 5、聚合 1、总览 1）；
- 预算：45 分钟、到期 1 张、新卡 3 个时给出「复习 1 张、新学 3 个、预留 9 分钟」；
- 界面：进度页在浅色与深色下检查通过，统计标签、预算指标卡、掌握度分布、载体消化与课程进度布局正常；
- 数据：2 个载体 5 个知识点、1 门课程 3 个知识点、2 条掌握记录，页面显示载体 47% / 0%、课程 47%、平均掌握 28%；
- 未验证：真实数百知识点规模下的聚合性能与长列表滚动；预算建议目前只展示，未限制复习页实际张数。

## 风险与后续

- 复习与新学的分钟估算是固定值，未按知识点难度调整；
- 课程进度只统计已确认知识点，未纳入计划完成率；
- 预算只做展示与建议，不强制限制复习数量。
