# Spec-0008：学习卡片与 FSRS 复习

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M4（第一阶段）

## 目标

建立最小学习闭环：从已确认知识点生成学习卡片，按 FSRS 安排复习，1–4 自评后更新到期时间与掌握度：

1. 复习队列：到期卡片优先，未复习的已确认知识点作为新卡；
2. 学习卡片：标题、来源页码、正文翻面、计时；
3. 1–4 自评：重来、困难、良好、容易；
4. FSRS 排程：每次自评写入 `mastery` 与 `reviews`，得到下一次到期时间；
5. 掌握度：`0.6 × 可提取概率 + 0.4 × 自评准确率`；
6. 今日页显示待复习数量，可一键进入复习。

## 非目标

- 进度面板与载体消化（M4 第二阶段）；
- Agent 对话面板与学习工具扩展（M4 第三阶段）；
- 计划与复习的预算融合（M4 第二阶段）；
- 题目生成、错题本与 BKT 认知诊断。

## 依赖

新增运行时依赖 `ts-fsrs@5.4.2`（MIT），用于 FSRS 调度；登记到 `docs/third-party-notices.md`。参数固定为 `request_retention = 0.9`、`enable_fuzz = false`、`enable_short_term = false`，保证结果可复现。

## 数据变更（迁移 007）

| 表 | 关键列 | 说明 |
|---|---|---|
| `mastery` | `point_id` 主键、`stability`、`difficulty`、`due_at`、`reps`、`lapses`、`state`、`scheduled_days`、`learning_steps`、`last_reviewed_at`、`last_rating`、`accuracy_ewma`、`updated_at` | 每个知识点一行，外键级联删除 |
| `reviews` | `id`、`point_id`、`rating`(1–4)、`reviewed_at`、`retrievability_before`、`interval_days`、`stability_after`、`difficulty_after` | 只追加，算法与统计依据 |

索引：`mastery(due_at)`、`reviews(point_id, reviewed_at)`、`reviews(reviewed_at)`。

## 接口

### core（`@sublate/core`）

```ts
type ReviewRating = 1 | 2 | 3 | 4

interface ReviewState {
  stability: number; difficulty: number; dueAt: string; reps: number; lapses: number
  cardState: number; scheduledDays: number; learningSteps: number
  lastReviewedAt?: string; lastRating?: ReviewRating; accuracyEwma: number
}

scheduleReview(state: ReviewState | undefined, rating: ReviewRating, now: Date): ReviewOutcome
retrievability(state: ReviewState | undefined, now: Date): number
masteryScore(state: ReviewState | undefined, now: Date): number
updateAccuracy(previous: number, rating: ReviewRating): number
```

规则：

- 未复习过（无状态或 `reps = 0`）按新卡处理；
- 自评准确率映射：重来 0、困难 0.4、良好 0.8、容易 1，EWMA 系数 0.4，冷启动 0.5；
- 掌握度：无复习记录为 0；否则 `0.6 × R + 0.4 × A`，R 为 FSRS 预测可提取概率；
- `dueAt` 为 ISO 时间戳，调度结果保留 FSRS 的 `state/scheduled_days/learning_steps`。

### storage-sqlite（`ctx.db.scheduler`）

```ts
get(pointId): MasteryState | undefined
save(pointId, state): void
recordReview(input): void
dueQueue(nowIso, limit): ReviewCard[]
newQueue(limit): ReviewCard[]
history(pointId): ReviewRecord[]
reviewedBetween(fromIso, toIso): number
listMastry(): MasteryRow[]        // 面板与统计使用
```

`dueQueue` 只返回已确认且 `due_at <= now` 的知识点，按到期时间升序；`newQueue` 返回已确认但无复习记录的知识点，按载体与页码排序。

### scheduler 插件

服务 `ctx.scheduler`：

```ts
queue(options?: { limit?: number }): ReviewQueue
review(input: { pointId: string; rating: ReviewRating }): ReviewOutcomeView
stats(): ReviewStats
```

IPC：

| 频道 | 入参 | 返回 |
|---|---|---|
| `review:queue` | `{ limit? }` | `{ due, newCards, stats }` |
| `review:submit` | `{ pointId, rating }` | `{ dueAt, intervalDays, mastery, accuracy }` |
| `review:stats` | `{}` | `{ dueCount, newCount, reviewedToday, averageMastery, totalPoints }` |
| `review:history` | `{ pointId }` | `ReviewRecord[]` |

校验：`rating` 必须是 1–4 的整数；知识点必须存在且为 `confirmed`；非复习状态不得直接提交。

## 界面

- 侧边栏新增「复习」，顺序为：今日、复习、知识库、知识点、课程、回收站；
- 复习页：
  - 顶部统计：待复习、新卡、今日已复习；
  - 卡片区：标题、载体与页码、「先回忆再翻面」提示；点击「显示内容」后开始计时并显示正文；
  - 1–4 自评按钮显示对应下次间隔文案；提交后自动进入下一张；
  - 「打开原文」跳转阅读器对应页码；
  - 队列清空后显示本轮完成与今日统计；
- 今日页新增「今日复习」区块：显示到期数与新卡数，按钮跳转复习页；
- 全部沿用现有 token，浅色与深色均需检查。

## 验收标准

- 同一知识点按 1–4 自评后 `due_at` 随评分单调变化：重来最早、容易最晚；
- 连续 7 天模拟复习，到期队列按逾期天数降序排列；
- 掌握度随良好/容易评分上升，重来后下降；
- 复习提交写入 `reviews`，`mastery` 只有一行且幂等更新；
- 今日页与复习页可完成「进入复习 → 翻面 → 自评 → 下一张」闭环；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过。

## 测试点

1. `scheduleReview` 首次与再次评分的间隔关系；
2. `retrievability` 随时间下降；
3. `masteryScore` 冷启动、良好、重来的差异；
4. `updateAccuracy` EWMA；
5. 仓储：到期队列、新卡队列、复习记录、7 天排序、级联删除；
6. scheduler 服务：队列合并、评分校验、统计。

## 实测结果（2026-10-22）

- 插件树：20 个插件全部 `running`（新增 scheduler；内核 profile 为 17 个）；
- 迁移：SQLite `user_version = 7`，既有测试版本断言同步更新；
- 测试：128 passed（新增 13 个：core FSRS 5、复习仓储 4、scheduler 服务 4）；
- 排程：重来比容易更早到期，连续良好间隔递增；可提取概率随时间下降；7 天模拟队列按到期时间升序；
- 界面（Electron）：今日页显示「到期 1 张 · 新卡 2 张、平均掌握 27%」；
- 交互：复习页翻面后计时启动，提交「良好」后待复习归零、今日已复习 1、平均掌握 30%，提示「上一张已安排到 16 天后」，自动进入下一张；
- 主题：浅色与深色下复习页对比度、评分按钮与卡片布局正常；
- 未验证：真实学习节奏下的多日复习体验；「打开原文」跳转沿用阅读器既有能力，未人工点验。

## 风险与后续

- 掌握度没有作答正确率数据，初期完全依赖自评；
- 未处理「同一知识点在多门课程中重复出现」的课程归属展示；
- 通知与提醒、计划预算融合放到 M4 后两个阶段。
