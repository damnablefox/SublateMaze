# Spec-0017：专业集蓝图编辑器

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M6 后增强
- 版本：0.2.1

## 目标

1. 画布成为专业集默认主模式，列表视图保留为辅助视图；
2. 提供类似 UE 蓝图的右键上下文菜单：空白、节点、连线、注释分别有不同的操作；
3. 节点支持增、删、改：新增知识点/载体、删除节点、编辑别名与备注；
4. 连线支持增、删、改：引脚拖线新建、右键删除、切换前置/相关；
5. 支持注释框：新建、拖动、缩放、编辑文本、切换颜色、删除；
6. 连线改为芯片电路板式正交走线，引脚改为焊盘样式，降低节点增多时的视觉杂乱；
7. 连线支持 90° 曼哈顿与 45° 地铁两种走线风格，由用户切换并记住选择；
8. UI 交互与菜单视觉参考 shadcn/ui，但不引入 Tailwind 与 Radix 依赖。

## 非目标

- 不做连线自动避障与大规模图布局优化；
- 不做框选、多选、复制粘贴、撤销重做；
- 不做画布缩放比例与视图位置持久化；
- 不做注释富文本、图片与 Markdown 渲染；
- 不做节点自由绘制与自定义节点类型。

## 数据变更（迁移 012）

`set_nodes` 新增可空列：

| 列 | 类型 | 说明 |
|---|---|---|
| `alias` | TEXT | 节点显示别名；空表示使用原始标题 |
| `note` | TEXT | 节点备注；显示在节点副标题位置 |

新增注释表：

```sql
CREATE TABLE set_comments (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES sets (id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL DEFAULT 360,
  height REAL NOT NULL DEFAULT 200,
  color TEXT NOT NULL DEFAULT 'amber',
  created_at TEXT NOT NULL
);
```

迁移只增不改，`user_version` 更新为 12。

## 接口

### storage-sqlite（`ctx.db.sets`）

```ts
updateNode(setId: string, nodeId: string, patch: { alias?: string | null; note?: string | null }): void
updateEdge(setId: string, edgeId: string, kind: SetEdgeKind): void
listComments(setId: string): SetCommentRecord[]
addComment(setId: string, input: SetCommentInput): SetCommentRecord
updateComment(setId: string, commentId: string, patch: SetCommentPatch): void
removeComment(setId: string, commentId: string): void
```

### sets 插件与 IPC

| 频道 | 入参 | 返回 |
|---|---|---|
| `set:update-node` | `{ id, nodeId, alias?, note? }` | `SetDetail` |
| `set:update-edge` | `{ id, edgeId, kind }` | `SetDetail` |
| `set:add-comment` | `{ id, x, y, width?, height?, text?, color? }` | `SetDetail` |
| `set:update-comment` | `{ id, commentId, text?, x?, y?, width?, height?, color? }` | `SetDetail` |
| `set:remove-comment` | `{ id, commentId }` | `SetDetail` |

校验：

- 别名 ≤ 100 字，备注 ≤ 1000 字；空白字符串保存为 `null`；
- 注释文本 ≤ 2000 字；坐标 ±1,000,000；宽 80–1200；高 60–1000；
- 注释颜色限定 `amber | blue | green | red`；
- 切换连线类型后仍需满足端点规则：`prereq` 两端必须为知识点，载体只能 `related`。

`SetDetail` 增加 `comments: SetComment[]`。

## 画布主模式

- 进入专业集默认显示画布；列表/画布切换保留；
- 画布高度随窗口自适应，最小 560 px；
- 顶部工具栏提供「添加节点」「添加注释」「自动布局」「适应视图」。

## 右键菜单

| 位置 | 菜单项 |
|---|---|
| 空白 | 添加知识点、添加载体、添加注释、自动布局、适应视图 |
| 节点 | 编辑节点、删除节点 |
| 连线 | 切换为前置/相关、删除关系 |
| 注释 | 编辑文本、颜色（琥珀/蓝/绿/红）、删除注释 |

菜单行为参考 shadcn/ui：分组、分隔线、危险项红色、点击外部或 Esc 关闭、键盘焦点可见。

## 节点编辑

- 编辑弹层包含：原始名称（只读）、别名输入、备注文本域；
- 保存后节点标题显示别名，副标题优先显示备注；
- 删除节点同时删除其关系，已有规则不变。

## 连线编辑

- 引脚拖线创建关系，类型由引脚决定；
- 右键连线可在 `prereq` 与 `related` 之间切换；
- 若切换后与已有关系重复，返回「相同关系已存在」。

## 注释

- 注释框位于节点下层，半透明底色，顶部标题条显示「注释」；
- 拖动标题条移动，右下角手柄缩放；
- 双击正文进入编辑，失焦保存；
- 右键菜单可改颜色或删除；
- 注释不参与研究程度计算，不阻挡节点点击。

## 芯片电路板式连线

- 引脚改为焊盘：执行引脚为白色小方块，数据引脚为蓝/绿小圆点，并带一段短引线；
- 连线支持两种走线风格，由工具栏「90° / 45°」切换，选择保存在 localStorage：
  - 90° 曼哈顿：输出引脚先水平引出，再垂直走线，再水平进入输入引脚；
  - 45° 地铁：水平引出后用 45° 斜线完成主要高差，再水平进入输入引脚；
- 拐点使用 4–5 px 圆角；
- 同一对节点之间的多条连线按索引错开 6 px，减少重叠；
- 执行线白色 2.5 px 带箭头，数据线 1.5 px 无箭头，颜色沿用知识点蓝 / 载体绿；
- 连线 hover 加亮，右键可编辑。

## 验收标准

- 进入专业集默认显示画布，列表可切换；
- 空白右键可添加知识点、载体、注释，并执行自动布局/适应视图；
- 节点右键可编辑别名与备注、删除节点；
- 连线右键可切换类型与删除；
- 注释可新建、拖动、缩放、编辑、改色、删除，重启后保留；
- 迁移 012 在既有数据库上顺利执行；
- 正交连线在 50 个节点、100 条边的样例中不出现明显重叠与遮挡；
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、Electron 构建与 `pnpm package:dir` 通过。

## 测试点

1. storage：迁移 12、节点别名/备注、注释 CRUD、连线类型更新；
2. sets 插件：节点编辑校验、注释校验、连线类型切换与唯一冲突；
3. 界面：默认画布、右键菜单、节点编辑、注释拖动缩放、正交走线与右键连线操作。

## 实测结果（2026-10-22）

- 迁移：既有开发库从 `user_version = 11` 升级到 12，别名/备注列与 `set_comments` 表创建成功；
- 右键菜单：空白显示添加知识点、添加载体、添加注释、自动布局、适应视图；节点显示编辑/删除；连线显示切换类型/删除；菜单使用固定定位，不再被画布裁剪；
- 节点编辑：右键「群的定义」→ 编辑节点 → 别名保存为「群的定义·别名」，节点标题即时更新，提示「已更新节点」；
- 连线切换：前置↔相关切换成功，提示「已更新关系」；载体来源边不显示「改为前置关系」；
- 注释：工具栏与右键均可添加；拖动标题条后坐标写入 SQLite；标题条与右下角缩放手柄可交互，注释主体不阻挡节点点击；
- 添加节点：选择器列出未加入集合的「子群与陪集」，可搜索并添加；
- 视觉：执行线白色正交折线带箭头，数据线 1.5 px 蓝色/绿色正交折线，拐点 8 px 圆角；引脚为方形/圆形焊盘并带短引线；
- 构建产物：0.2.0 由 `pnpm package:dir` 生成，见工作区 `构建产物/SublateMaze-0.2.0-windows-x64-portable/`；
- 测试：222 passed（新增 storage 3 个、sets 插件 3 个；迁移版本断言更新为 12）。

### 0.2.1：视觉精修与双走线模式（2026-10-22）

- 节点更接近 UE：标题栏改为蓝色/青绿渐变，高度 22 px；节点高度 92 px，字体改为系统无衬线，阴影减淡；
- 引脚焊盘缩小到 8 px，引线 4 px；
- 工具栏新增「90° / 45°」分段切换，选择写入 `localStorage`（键 `sublate-canvas-routing`）；
- 实测：90° 模式下连线路径只含水平/垂直段；45° 模式下出现 45° 斜线段；切换后按钮态与存储值同步；
- 版本升级为 0.2.1。
