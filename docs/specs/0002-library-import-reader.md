# Spec-0002：M1 知识库、导入与阅读

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M1

## 目标

把「文件与网页」变成知识库中可检索、可定位、可继续阅读的载体，打通第一条业务链路：

1. 导入本地 PDF 与网页链接，按 SHA-256 内容寻址存放，重复导入自动去重；
2. 提取 PDF 逐页文本与网页正文，缓存为页级文本；
3. 在应用内阅读 PDF（渲染、翻页、页码跳转）并记住阅读位置；
4. 用 SQLite FTS5 检索正文，命中到具体页码；
5. 删除进入回收站（软删除），可恢复。

## 非目标

- OCR、扫描件识别、音视频转写；
- Office 高保真渲染；
- 语义检索与向量索引（M2 起用 LanceDB）；
- 刻度批注、高亮、笔记（M3 起）；
- 多知识库切换（当前只有单一 vault）。

## 关键取舍

| 取舍 | 决定 | 理由 |
|---|---|---|
| PDF 文本提取 | M1 用 `pdfjs-dist` 在 Node 侧提取 | 零额外原生依赖，先打通链路；Rust/pdfium 作为后续性能升级，接口不变 |
| 网页抓取 | 主进程 `fetch` + jsdom + `@mozilla/readability` | 不引入浏览器引擎；正文去导航栏与广告 |
| 网页分页 | 按约 1200 字切分为虚拟页 | 与 PDF 统一为「页码 + 文本」模型，便于锚点与检索 |
| 中文检索 | 索引与查询前把 CJK 字符逐字空格切分 | FTS5 默认分词把连续汉字当单 token，逐字切分后可做中文短语匹配 |
| 阅读位置 | 存于 SQLite，按载体记录页码与页内滚动比例 | 满足「重启保留」验收，且不依赖浏览器本地存储 |
| 阅读器取文件 | 渲染进程经 IPC 读取原始字节后交给 pdf.js | 实测 `file://` 页面下 `fetch` 自定义协议会被 Chromium 拦截；IPC 结构化克隆可直接传 `Uint8Array`，M1 文件规模下开销可接受 |

## 数据变更（迁移 002）

迁移只增不改。

```sql
CREATE TABLE carriers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- pdf | web
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  language TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,            -- pending | parsing | ready | failed
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT                  -- 非空表示在回收站
);

CREATE TABLE carrier_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier_id TEXT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  rel_path TEXT NOT NULL,          -- 相对 vault 根，library/ab/cd/<sha256>.<ext>
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (sha256)
);

CREATE TABLE carrier_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier_id TEXT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (carrier_id, page_no)
);

CREATE TABLE carrier_read_state (
  carrier_id TEXT PRIMARY KEY REFERENCES carriers(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL DEFAULT 1,
  scroll_ratio REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE carrier_pages_fts USING fts5(
  body,
  carrier_id UNINDEXED,
  page_no UNINDEXED,
  tokenize = 'unicode61'
);
```

FTS 表只存分词后的正文与定位字段，原文以 `carrier_pages.text` 为准；软删除不删除索引，检索时按 `deleted_at IS NULL` 过滤，恢复后自动重新命中。

## 接口

### storage-sqlite（`ctx.db.carriers`）

```ts
create(input: { kind: 'pdf' | 'web'; title: string; sourceUrl?: string; sha256: string; relPath: string; mime: string; size: number }): Carrier
get(id: string): Carrier | undefined
findBySha256(sha256: string): Carrier | undefined
list(options?: { includeDeleted?: boolean }): Carrier[]
setStatus(id, status: 'pending' | 'parsing' | 'ready' | 'failed', error?: string): void
rename(id: string, title: string): void
replacePages(carrierId: string, pages: { pageNo: number; text: string }[]): void
getPageCount(carrierId: string): number
getPages(carrierId: string, from: number, to: number): { pageNo: number; text: string }[]
getReadState(carrierId: string): { pageNo: number; scrollRatio: number } | undefined
saveReadState(carrierId: string, pageNo: number, scrollRatio: number): void
softDelete(id: string): void
restore(id: string): void
listTrash(): Carrier[]
searchPages(match: string, limit?: number): { carrierId: string; title: string; pageNo: number; text: string }[]
```

### parser（`ctx.parser`）

```ts
parsePdf(filePath: string, sha256: string): Promise<{ title?: string; pageCount: number; pages: PageText[] }>
fetchWeb(url: string): Promise<{ html: string; finalUrl: string }>
parseWebHtml(html: string, sha256: string, fallbackTitle?: string): Promise<ParsedDocument>
```

PDF 解析结果缓存到 `.vault/.sublate/cache/<sha256>/pages.json`；重复导入同一文件不再提取。

### importer（`ctx.importer`）

```ts
importFiles(paths: string[]): Promise<ImportResult[]>
importUrl(url: string): Promise<ImportResult>

interface ImportResult {
  carrierId?: string
  title: string
  duplicated: boolean
  status: 'ready' | 'failed'
  error?: string
}
```

流程：计算 SHA-256 → 查重（命中回收站则恢复）→ 复制到 `library/<前2位>/<次2位>/<sha256>.<ext>` → 写 carriers 与 carrier_files → 解析页文本 → 写 carrier_pages 与 FTS → 事件 `carrier/imported`。

### search（`ctx.search`）

```ts
query(text: string, options?: { limit?: number }): SearchHit[]
// SearchHit: { carrierId: string; title: string; pageNo: number; snippet: string }

indexCarrier(carrierId: string): void
removeCarrier(carrierId: string): void
```

### IPC（经 `ipc-bridge` 白名单注册）

| 频道 | 入参 | 返回 |
|---|---|---|
| `library:list` | `{ includeDeleted?: boolean }` | `CarrierSummary[]` |
| `library:pick-files` | 无 | `string[]` |
| `library:import-files` | `string[]` | `ImportResult[]` |
| `library:import-url` | `{ url: string }` | `ImportResult` |
| `carrier:detail` | `{ id: string }` | 载体详情 + 阅读位置 |
| `carrier:file` | `{ id: string }` | `Uint8Array`（原始文件字节） |
| `carrier:pages` | `{ id, from, to }` | `PageText[]` |
| `carrier:read-position` | `{ id, pageNo, scrollRatio }` | `void` |
| `carrier:delete` | `{ id }` | `void` |
| `carrier:restore` | `{ id }` | `void` |
| `trash:list` | 无 | `CarrierSummary[]` |
| `search:query` | `{ text }` | `SearchHit[]` |

### 阅读器取文件

`ui-shell` 只负责窗口与文件选择对话框；PDF 字节由 `importer` 的 `carrier:file` 频道读取：

- 主进程按载体 id 找到 `carrier_files.rel_path`；
- 经 vault 的 `resolvePath` 做越界校验后读取文件；
- 返回 `Uint8Array`，渲染进程交给 pdf.js 渲染。

`cMapUrl` 与 `standardFontDataUrl` 指向构建时复制到 `public/pdfjs/` 的静态资源，保证中文 PDF 的非嵌入字体可正常显示。

## 验收标准

- 导入 20 个文本型 PDF/网页：成功率 ≥ 90%，失败结果带 `error` 文案；
- 同一文件重复导入返回 `duplicated: true`，`carrier_files` 不产生第二份副本；
- 关闭并重启应用后，书目、页数与上次阅读页码仍在；
- 1000 页文本型 PDF 首次解析 + 入库 ≤ 3 秒（本机实测，缓存命中后不再解析）；
- 插件停用（profile 中 `disabled: true`）后，相应入口与 IPC 频道消失，主界面仍可用；
- `pnpm typecheck`、`pnpm test`、`cargo test`、`pnpm --filter @sublate/desktop build` 全部通过。

## 测试点

1. 迁移：新库 `user_version = 2`，旧库从 1 升级不丢 settings；
2. 去重：同一内容两次导入只产生一个 carrier 与一个文件；
3. 内容寻址：`rel_path` 为 `library/ab/cd/<sha256>.<ext>`；
4. 页写入：替换页文本后可查询页码数与指定页；
5. FTS：中文短语与英文单词均可命中，返回正确页码；
6. 软删除：列表默认不包含，回收站可见，恢复后重新出现在列表；
7. 阅读位置：保存后重新读取一致；
8. 解析：Mini PDF 夹具提取到文本，网页夹具提取到正文并分页；
9. IPC：频道注册可见，去重导入返回既有 id。

## 实际结果（2026-10-22）

- 插件树：13 个插件全部 `running`（新增 parser、importer、search），IPC 与自定义事件正常工作；
- 测试：40 passed（新增载体仓储 7、解析 4、导入 6、检索 6）；
- Electron 端到端冒烟：导入 PDF → `ready`，页文本、检索命中、阅读位置保存均正确，阅读页 canvas 成功渲染（734×950）；
- 1000 页文本型 PDF（330 KB）解析耗时约 2.6 秒（本机，含 pdfjs 首次加载），满足 ≤3 秒指标；
- 约定调整一：preload 以 ESM 构建，窗口改为 `sandbox: false`，仍保留 `contextIsolation: true` 与 `nodeIntegration: false`；沙箱模式下 ESM preload 不执行，`window.sublate` 会缺失；
- 约定调整二：自定义协议在 `file://` 页面下被 Chromium 拦截，改为 IPC 传字节；
- 待验证：网页抓取目前按 UTF-8 解码；真实教材 PDF 的字体与排版兼容性需人工抽样。

## 风险与后续

- `pdfjs-dist` 在 Node 下对加密或纯扫描 PDF 会得到空文本，M1 以 `failed` + 原因提示，M4 再评估 OCR；
- 网页抓取受反爬限制，失败需给出可读原因；
- 阅读器暂不渲染批注层，选区高亮与锚点在 M3 接入；
- Rust 侧 `file_sha256` 已是唯一性能敏感入口，PDF 文本提取后续迁移到 `sublate-native` 的 `pdf_extract`。
