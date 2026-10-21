# Spec-0007：课程、目标与学习计划

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M3（第一阶段）

## 目标

把已确认的知识点组织成可执行的学习安排：

1. 课程：课程基本信息、单元树、单元内的知识点编排顺序；
2. 前置关系：课程内知识点可声明依赖，生成计划时保证前置在前；
3. 学习目标：课程目标、目标日期、每日可用时长；
4. 计划：按每日时长把课程知识点分配到具体日期；
5. 手动调整：完成任务、跳过、移动日期、按新时长重排；
6. 今日视图：当天任务与逾期任务。

## 非目标

- 学习卡片、自评与 FSRS（M4）；
- AI 自动排课与 Agent 对话界面（M4）；
- 字符级页码锚点；
- 跨设备同步。

## 数据变更（迁移 006）

迁移只增不改，新增六张表：

| 表 | 关键列 | 说明 |
|---|---|---|
| `courses` | `title`、`description`、`status`、`daily_minutes` | 课程，`status` 为 `active/archived` |
| `course_units` | `course_id`、`title`、`position` | 单元树，同一课程内按 `position` 排序 |
| `course_points` | `course_id`、`unit_id`、`point_id`、`position`、`depends_on_json` | 课程内编排；`point_id` 引用已确认知识点，`depends_on_json` 存前置知识点 id 数组 |
| `goals` | `course_id`、`title`、`target_date`、`daily_minutes`、`status` | 学习目标；`daily_minutes` 为空时继承课程 |
| `plans` | `course_id`、`goal_id`、`start_date`、`days`、`daily_minutes`、`status` | 一次生成的计划 |
| `plan_items` | `plan_id`、`course_point_id`、`date`、`position`、`status`、`completed_at` | 每日计划项；`status` 为 `pending/done/skipped` |

约束与规则：

- `course_points` 对 `(course_id, point_id)` 唯一，同一知识点在一门课程里只出现一次；
- `course_points.point_id` 外键到 `knowledge_points`，载体或知识点被删除时级联移除编排与计划项；
- `plan_items` 对 `(plan_id, course_point_id)` 唯一；
- 依赖只允许引用同一课程内已编排的知识点 id，且不得成环。

## 接口

### 仓储（`ctx.db.course` / `ctx.db.goals` / `ctx.db.plans`）

```ts
course.create({ title, description?, dailyMinutes? }): Course
course.list(): CourseSummary[]
course.get(id): Course | undefined
course.update(id, { title?, description?, dailyMinutes?, status? }): void
course.remove(id): void

course.createUnit({ courseId, title }): CourseUnit
course.updateUnit(id, { title?, position? }): void
course.removeUnit(id): void

course.addPoints(courseId, unitId | null, pointIds): CoursePoint[]
course.removePoints(ids): void
course.movePoint(id, { unitId?, position? }): void
course.setDepends(id, dependsOn: string[]): void
course.listAvailablePoints(courseId): AvailablePoint[]

goals.create/listByCourse/update/remove
plans.create/get/listByCourse/remove/update
plans.replaceItems(planId, days: { date, pointIds }[]): void
plans.listItems(planId): PlanItemView[]
plans.setItemStatus(id, status): void
plans.moveItems(updates: { id, date, position }[]): void
plans.today(date): { due, overdue, stats }
```

`addPoints` 只接受 `status = 'confirmed'` 的知识点；`setDepends` 写入前校验引用与环，非法时抛中文错误。

### core 计划算法（`@sublate/core`）

```ts
schedulePoints(points, { startDate, days, dailyMinutes, minutesPerPoint? }): PlanSchedule
replanPending(items, { startDate, dailyMinutes, minutesPerPoint? }): { days, conflicts }
detectConflicts(items): PlanConflict[]
addDays(date, offset): string
```

规则：

- 每日容量 = `max(1, floor(dailyMinutes / minutesPerPoint))`，`minutesPerPoint` 默认 6；
- 知识点按课程单元与编排顺序排列，依赖通过拓扑排序前移，同层保持输入顺序；
- 期望天数装不下时自动延长，`extended = true`，实际天数写入 `plans.days`；
- 依赖成环时不生成计划，返回环中的知识点 id；
- 重排只重新分配 `pending` 项，`done/skipped` 的日期与顺序保持不动；已有固定项的日期计入容量。

### IPC

course 插件：

| 频道 | 入参 | 返回 |
|---|---|---|
| `course:list` | `{}` | `CourseSummary[]` |
| `course:create` | `{ title, description?, dailyMinutes? }` | `Course` |
| `course:update` | `{ id, title?, description?, dailyMinutes?, status? }` | `void` |
| `course:delete` | `{ id }` | `void` |
| `course:detail` | `{ id }` | `{ course, units, points }` |
| `course:unit-create` | `{ courseId, title }` | `CourseUnit` |
| `course:unit-update` | `{ id, title?, position? }` | `void` |
| `course:unit-delete` | `{ id }` | `void` |
| `course:points-add` | `{ courseId, unitId?, pointIds }` | `CoursePoint[]` |
| `course:points-remove` | `{ ids }` | `void` |
| `course:point-move` | `{ id, unitId?, position }` | `void` |
| `course:depends` | `{ id, dependsOn }` | `void` |
| `course:available-points` | `{ courseId }` | `AvailablePoint[]` |

planner 插件：

| 频道 | 入参 | 返回 |
|---|---|---|
| `goal:list` | `{ courseId }` | `Goal[]` |
| `goal:create` | `{ courseId, title, targetDate?, dailyMinutes? }` | `Goal` |
| `goal:update` | `{ id, title?, targetDate?, dailyMinutes?, status? }` | `void` |
| `goal:delete` | `{ id }` | `void` |
| `plan:list` | `{ courseId }` | `Plan[]` |
| `plan:detail` | `{ id }` | `{ plan, items, conflicts }` |
| `plan:generate` | `{ courseId, goalId?, startDate?, days?, dailyMinutes? }` | `GenerateResult` |
| `plan:replan` | `{ id, dailyMinutes, startDate? }` | `{ plan, items, conflicts }` |
| `plan:delete` | `{ id }` | `void` |
| `plan:item-status` | `{ id, status }` | `{ conflicts }` |
| `plan:item-move` | `{ id, date, position? }` | `{ conflicts }` |
| `plan:today` | `{ date? }` | `{ date, due, overdue, stats }` |

`GenerateResult = { plan, items, conflicts, extended, message? }`；无编排知识点或依赖成环时抛中文错误。

## 界面

- 侧边栏新增「今日」「课程」入口，原有顺序为：今日、知识库、知识点、课程、回收站；
- 今日页：日期标题、今日任务与逾期任务，任务支持完成与跳过，显示课程名与页码；
- 课程页：左侧课程列表与新建；右侧课程详情，包含每日时长、学习目标、单元树编排、可用知识点添加、前置设置、生成计划；
- 计划区按日期分组，支持逐项完成/跳过、移动日期、按新时长重排；存在前置冲突时显示警告；
- 沿用现有 token 与紧凑列表样式，浅色与深色都必须可读。

## 验收标准

- 500 个知识点生成 30 天计划耗时不超过 2 秒，装不下时自动延长并提示；
- 课程内依赖成环时拒绝生成，并指出环中的知识点；
- 手动移动计划项导致前置在后时返回冲突提示；
- 修改每日时长重排后，`done/skipped` 项的日期与顺序不变；
- 课程只能编排已确认知识点，未确认知识点不出现在可选列表；
- 今日页能显示当天任务与逾期任务，完成后统计即时更新；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过。

## 测试点

1. `schedulePoints`：顺序、容量、自动延长、拓扑排序；
2. 依赖成环返回环成员；
3. `detectConflicts` 识别前置在后；
4. `replanPending` 保留已完成与跳过项；
5. 500 知识点性能断言；
6. 课程仓储：CRUD、单元、只接受已确认点、依赖校验、可选列表；
7. 计划仓储：生成、状态更新、今日/逾期、移动；
8. planner 服务：生成结果、重排、冲突返回。

## 实测结果（2026-10-22）

- 插件树：19 个插件全部 `running`（新增 course、planner；内核 profile 为 17 个）；
- 迁移：SQLite `user_version = 6`，既有测试的版本断言同步更新；
- 测试：115 passed（新增 27 个：core 计划算法 11、课程仓储 5、计划仓储 5、planner 服务 6）；
- 性能：500 个知识点生成 30 天计划约 3 ms，远低于 2 秒上限；
- 界面：Electron 浅色与深色下检查今日页与课程页；课程页左侧列表、目标、计划按日期分组、单元编排、前置下拉、可用知识点均正常；
- 交互：今日页勾选任务后统计从「待完成 1 / 已完成 1」变为「待完成 0 / 已完成 2」，行样式同步置灰划线；
- 覆盖：自动延长、依赖环拒绝、冲突提示、重排保留已完成项、课程级联删除；
- 未验证：生成计划与重排按钮的真实点击流程由测试覆盖，未做人工点验；真实教材知识点规模下的滚动与长列表体验待抽样。

## 风险与后续

- 计划以知识点为最小单位，未考虑单点难度差异；
- 周末与休息日不特殊处理，后续可在目标里增加排除规则；
- 今日视图暂不做通知与提醒（M4）。
