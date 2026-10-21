# Spec-0011：笔记与双向链接

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M5（第一阶段）

## 目标

1. 提供 Markdown 笔记：新建、编辑、预览、删除与恢复；
2. 笔记正文支持 `[[标题]]`、`[[标题|别名]]`、`[[标题#锚点]]` 形式的 wiki 链接，保存时重建出链，并可查询反链；
3. 笔记可关联知识点与载体，知识点页可一键创建关联笔记；
4. 笔记以 `notes/<标题>.md` 落在 vault 内，带 YAML frontmatter，Obsidian 可直接打开阅读；
5. 删除的笔记进入回收站（`.sublate/trash/notes/`），可恢复或彻底删除。

## 非目标

- 不做外部编辑器（含 Obsidian）修改文件后的反向同步，数据库仍是权威来源；
- 不做所见即所得富文本；
- 不对笔记做 FTS 索引（留给 M5 检索阶段统一处理）；
- 不做 AI 自动生成笔记。

## 数据变更（迁移 009）

| 表 | 关键列 | 说明 |
|---|---|---|
| `notes` | `id`、`title`、`title_key`、`body`、`rel_path`、`created_at`、`updated_at`、`deleted_at` | `title_key` 为规范化标题，用于链接定位；活跃笔记标题唯一 |
| `note_links` | `note_id`、`target_title`、`target_key`、`target_note_id` | 出链；保存时整体重建，主键 `(note_id, target_key)` |
| `note_refs` | `note_id`、`ref_type`、`ref_id` | 关联知识点（`point`）或载体（`carrier`），主键三元组 |

约束：

- `notes` 上的部分唯一索引 `(title_key) WHERE deleted_at IS NULL`，防止活跃笔记同名；
- `note_links.target_note_id` 不加外键，允许悬空链接；目标创建后由 `resolveLinks()` 回填；
- 关联记录随笔记级联删除。

## 接口

### core（`packages/core/src/notes.ts`）

```ts
normalizeNoteTitle(title: string): string      // trim、折叠空白、小写
parseWikiLinks(markdown: string): WikiLink[]   // 去重，保留首次顺序
noteFileSlug(title: string): string            // 生成安全文件名
serializeNoteFile(note, body): string          // frontmatter + 正文
noteExcerpt(body: string, length?: number): string
```

### storage-sqlite（`ctx.db.notes`）

```ts
create({ title, body, relPath }): NoteRecord
update(id, patch: { title?, body?, relPath? }): void
get(id): NoteRecord | undefined
getByTitleKey(key: string): NoteRecord | undefined
list(options?: { includeDeleted?: boolean; query?: string }): NoteRecord[]
remove(id): void                 // 软删除
restore(id): void
purge(id): void                  // 物理删除
replaceLinks(noteId, links: { targetTitle: string; targetKey: string }[]): void
replaceRefs(noteId, refs: { refType: NoteRefType; refId: string }[]): void
links(noteId): NoteLinkRecord[]
backlinks(noteId): NoteBacklink[]
refs(noteId): NoteRefRecord[]
notesForRef(refType, refId): NoteRecord[]
resolveLinks(): number           // 按 title_key 回填 target_note_id，返回更新行数
```

### notes 插件（`ctx.notes`）

```ts
list(options?: { includeDeleted?: boolean; query?: string }): NoteSummary[]
detail(id): NoteDetail | undefined
create(input: { title; body?; refs? }): NoteDetail
update(id, patch: { title?; body?; refs? }): NoteDetail
remove(id): void
restore(id): void
purge(id): void
trash(): NoteSummary[]
forRef(refType, refId): NoteSummary[]
refOptions(): { carriers: { id; title }[]; points: { id; title; carrierId; carrierTitle }[] }
```

文件规则：

- 路径为 `notes/<slug>.md`；slug 为空时回退 `note`，与其他笔记冲突时追加 `-<id 前 6 位>`；
- frontmatter 字段：`sublate_id`、`title`、`created`、`updated`、`points`、`carriers`；
- 标题变化时写新文件并删除旧文件；
- 软删除将文件移动到 `.sublate/trash/notes/<id>.md`；恢复时写回原路径，路径被占用则重新分配；
- `purge` 删除文件与数据库记录；
- 保存后调用 `resolveLinks()`，保证悬空链接在目标出现后自动接上。

IPC：

| 频道 | 入参 | 返回 |
|---|---|---|
| `note:list` | `{ includeDeleted?, query? }` | `NoteSummary[]` |
| `note:trash` | `{}` | `NoteSummary[]` |
| `note:detail` | `{ id }` | `NoteDetail` |
| `note:create` | `{ title, body?, refs? }` | `NoteDetail` |
| `note:update` | `{ id, title?, body?, refs? }` | `NoteDetail` |
| `note:delete` | `{ id }` | `void` |
| `note:restore` | `{ id }` | `NoteDetail` |
| `note:purge` | `{ id }` | `void` |
| `note:for-ref` | `{ refType, refId }` | `NoteSummary[]` |
| `note:ref-options` | `{}` | `{ carriers, points }` |

`refs` 中 `refType` 仅允许 `point` 与 `carrier`，`refId` 非空；正文上限 1 MB，标题上限 200 字。

## 界面

- 侧边栏在「知识点」之后新增「笔记」；
- 笔记页为三栏：左侧列表（搜索、新建、已删除筛选）、中间编辑区（标题、正文、编辑/预览切换）、右侧信息栏（关联、出链、反链）；
- 支持 `Ctrl/Cmd + S` 保存；切换笔记、切换模式或新建时若有未保存修改先确认；
- 预览用 React 渲染轻量 Markdown（标题、列表、引用、代码、粗体、斜体、链接、wiki 链接），不使用 `innerHTML`；
- wiki 链接若指向已存在笔记可点击跳转，悬空链接提供「创建同名笔记」；
- 知识点每行新增「笔记」按钮，跳转到笔记页并预关联该知识点；
- 回收站页增加笔记区块，支持恢复与彻底删除。

## 验收标准

- 新建笔记生成 `notes/*.md`，frontmatter 可被标准 YAML 解析；
- `[[A]]`、`[[A|别名]]`、`[[A#锚点]]` 均能建立指向 A 的链接，A 的反链出现来源笔记；
- 先写链接后建目标：目标创建后出链自动解析、反链出现；
- 活跃笔记同名被拒绝并给出中文提示；
- 重命名后新文件存在、旧文件不存在，标题键同步更新；
- 删除后笔记从列表消失、文件位于 `.sublate/trash/notes/`，恢复后回到 `notes/`；
- 关联知识点后可从知识点侧查到关联笔记；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建通过；
- 浅色与深色主题下笔记页显示正常。

## 测试点

1. core：链接解析（别名、锚点、去重、大小写）与文件名、frontmatter 序列化；
2. storage：迁移 9、CRUD、同名拒绝、链接重建、反链、关联查询、悬空链接回填、软删除与恢复、级联清理；
3. notes 插件：文件创建与命名冲突、重命名文件迁移、删除/恢复文件位置、refs、`refOptions`；
4. IPC 入参校验：空标题、超长正文、非法 refType 被拒绝。

## 实测结果（2026-10-22）

- 插件树：Electron 内 20 个插件全部 `running`，notes 位于 search 与 course 之间；
- 迁移：SQLite `user_version = 9`，既有版本断言同步更新；
- 测试：176 passed（新增 23 个：core 5、笔记仓储 8、笔记插件 10）；
- 真实界面：默认深色与浅色主题下三栏布局正常；新建「群论」「线性代数」两篇笔记，`[[群论]]` 出链解析成功，群论反链显示线性代数与摘要；预览把 wiki 链接渲染为可点击按钮；点击出链可跳转；
- 文件：`apps/desktop/.vault/notes/群论.md` 等生成成功，frontmatter 为合法 YAML（`sublate_id`、`title`、`created`、`updated`、`points`、`carriers`），Obsidian 可直接打开；
- 回收站：删除群论后列表隐藏、回收站计数为 1、线性代数的出链悬空且反链归零；回收站页恢复后文件写回、反链恢复为 1；
- 构建：`pnpm typecheck`、`pnpm lint`、`pnpm test` 与 Electron 构建均通过；
- 未验证：Obsidian 中手动修改文件后的反向同步（非目标）；更大规模笔记列表的滚动性能。
