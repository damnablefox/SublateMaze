# Spec-0012：专业集与研究程度

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M5（第二阶段）

## 目标

1. 用户可以创建「专业集」，把知识点与整本载体组织成一个研究领域；
2. 专业集内可标记知识点之间的前置/相关关系；
3. 给出可解释的研究程度评分：广度、深度、平均掌握与综合分；
4. 新增专业集页面：集合列表、节点管理、关系管理、研究程度仪表。

## 非目标

- 不做知识图谱的可视化画布，关系以列表管理；
- 不做跨集合自动推荐；
- 不把专业集绑定到课程或学习计划；
- 不做自动抽取专业集内容。

## 研究程度定义

设集合展开后的去重知识点为 `P`：

| 分项 | 公式 | 说明 |
|---|---|---|
| 广度 | `已确认知识点数 / P 总数` | 知识点确认即视为已覆盖 |
| 深度 | `min(1, 总复习次数 / (P 总数 × 3))` | 每个知识点复习 3 次达到满分深度 |
| 平均掌握 | `平均(masteryScore)` | `masteryScore = 0.6 × 可提取性 + 0.4 × 自评准确率`，未复习为 0 |
| 综合分 | `0.4 × 广度 + 0.3 × 深度 + 0.3 × 平均掌握` | 0–1 |

等级：`< 0.25` 入门、`< 0.5` 进阶、`< 0.75` 熟练、`>= 0.75` 精通。`P` 为空时所有分项与综合分为 0。

集合中的载体节点会展开为其下全部知识点，并与直接加入的知识点去重。

## 数据变更（迁移 010）

| 表 | 关键列 | 说明 |
|---|---|---|
| `sets` | `id`、`title`、`description`、`created_at`、`updated_at` | 专业集 |
| `set_nodes` | `id`、`set_id`、`kind`（point/carrier）、`ref_id`、`position`、`created_at` | 唯一约束 `(set_id, kind, ref_id)` |
| `set_edges` | `id`、`set_id`、`source_id`、`target_id`、`kind`（prereq/related）、`created_at` | 端点外键级联删除，禁止自环 |

## 接口

### core（`packages/core/src/sets.ts`）

```ts
researchDegree(input: {
  totalPoints: number
  confirmedPoints: number
  reviewedPoints: number
  totalReps: number
  masteryScores: number[]
}): ResearchDegree

interface ResearchDegree {
  breadth: number
  depth: number
  mastery: number
  score: number
  level: '入门' | '进阶' | '熟练' | '精通'
  totalPoints: number
  confirmedPoints: number
  reviewedPoints: number
}
```

### storage-sqlite（`ctx.db.sets`）

```ts
create({ title, description? }): SetRecord
update(id, patch: { title?; description? }): void
remove(id): void
get(id): SetRecord | undefined
list(): SetSummary[]
addNodes(setId, nodes: { kind, refId }[]): SetNodeRecord[]
removeNode(setId, nodeId): void
addEdge(setId, input: { sourceId; targetId; kind }): SetEdgeRecord
removeEdge(setId, edgeId): void
listNodes(setId): SetNodeView[]
listEdges(setId): SetEdgeRecord[]
researchStats(setId): ResearchDegree
```

`SetSummary` 含 `nodeCount`、`pointCount` 与 `degree`。`SetNodeView` 带 `title`、`subtitle`、`status` 与 `missing`，引用被删除的节点标记为缺失。

### sets 插件（`ctx.sets`）

```ts
list(): SetSummary[]
detail(id): SetDetail
create(input): SetDetail
update(id, patch): SetDetail
remove(id): void
addNodes(id, nodes): SetDetail
removeNode(id, nodeId): SetDetail
addEdge(id, input): SetDetail
removeEdge(id, edgeId): SetDetail
options(): { carriers: { id; title }[]; points: { id; title; carrierId; carrierTitle }[] }
```

IPC：

| 频道 | 入参 | 返回 |
|---|---|---|
| `set:list` | `{}` | `SetSummary[]` |
| `set:detail` | `{ id }` | `SetDetail` |
| `set:create` | `{ title, description? }` | `SetDetail` |
| `set:update` | `{ id, title?, description? }` | `SetDetail` |
| `set:delete` | `{ id }` | `void` |
| `set:add-nodes` | `{ id, nodes: [{ kind, refId }] }` | `SetDetail` |
| `set:remove-node` | `{ id, nodeId }` | `SetDetail` |
| `set:add-edge` | `{ id, sourceId, targetId, kind }` | `SetDetail` |
| `set:remove-edge` | `{ id, edgeId }` | `SetDetail` |
| `set:options` | `{}` | 可选载体与知识点 |

校验：标题 1–100 字；节点最多 500 个；边禁止自环与重复；节点必须属于该集合。

## 界面

- 侧边栏在「笔记」之后新增「专业集」；
- 左侧集合列表与新建入口，显示节点数与综合分；
- 右侧详情：标题与描述编辑、研究程度卡片（综合百分比、等级、三条分项进度条、统计）、节点列表、关系列表；
- 节点添加使用两个下拉：按载体分组的知识点、载体；
- 关系添加选择两个节点与类型（前置/相关），列表显示「A → B」并可删除；
- 缺失引用显示为「已失效」，允许移除；
- 空集合显示引导文案。

## 验收标准

- 创建专业集后列表出现，节点与关系可增删；
- 添加载体时，其下知识点自动计入统计并与直接加入的知识点去重；
- 研究程度与手算一致（广度、深度、掌握、综合与等级）；
- 删除知识点节点后边级联清理；
- 自环边、重复节点、空标题被拒绝并给出中文提示；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过；
- 浅色与深色下专业集页显示正常。

## 测试点

1. core：零集合、广度/深度/掌握上限、等级边界；
2. storage：迁移 10、集合 CRUD、节点去重、载体展开、边级联、统计与缺失标记；
3. sets 插件：CRUD、节点/边校验、options、详情结构；
4. 界面：创建、添加节点、研究程度显示与关系删除。

## 实测结果（2026-10-22）

- 插件树：Electron 内 21 个插件全部 `running`，sets 位于 notes 与 course 之间；
- 迁移：SQLite `user_version = 10`，既有版本断言同步更新；
- 测试：197 passed（新增 21 个：core 5、仓储 9、插件 7）；
- 界面：浅色与深色下专业集页正常；创建「抽象代数」，加入载体「抽象代数讲义」与知识点「群的定义」「群同态」，展开去重后统计 3 个知识点；
- 研究程度：2/3 已确认、1 个已复习，显示广度 67%、深度 33%、平均掌握 31%、综合 46%「进阶」，与手算一致；
- 关系：添加「前置」关系「群的定义 → 群同态」，列表与移除按钮正常；关系端点仅允许知识点节点，载体节点被拒绝；
- 构建：`pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建均通过；
- 未验证：大体量节点/关系下的滚动与性能；知识图谱可视化（非目标）。
