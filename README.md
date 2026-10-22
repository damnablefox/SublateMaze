# SublateMaze

本地优先的个人学习平台与知识库管理系统。

把书籍、论文、课程、网页等“知识载体”沉淀为可检索、可定位的知识库，拆解为知识点与知识单元，组织成课程与学习目标，再用记忆模型生成每日计划并持续量化掌握程度。

> 当前状态：**M6 已完成**。导入、阅读、混合检索、知识点、课程计划、FSRS 复习、Agent 助手、笔记、专业集与技能库均已接入；22 个插件在应用中全部 running，Windows x64 便携版已打包；专业集以蓝图编辑器为主模式，支持右键菜单、节点/连线/注释编辑与电路板式走线。

## 核心设计

- **一切皆插件**：与 DeepSeek Harness 同源，使用 Cordis 4 作为内核，存储、解析、AI、排程、课程、计划、笔记、检索、Agent 均为插件。
- **一主一辅存储**：SQLite 是唯一关系写者与事务主库；LanceDB 作为可重建的派生向量索引，负责语义检索与 RAG。
- **Rust 原生层**：通过 napi-rs 提供哈希、PDF 文本、全文索引等 CPU 密集能力。
- **学习辅助 Agent**：复用 Harness 的循环、工具、技能与会话机制，工具集替换为学习域能力，写操作需确认并可审计。
- **平台无关 core**：业务逻辑放在 `packages/core`，不依赖 Electron 与 Node 文件 API，便于测试与未来换壳。

## M1 能力

- 导入本地 PDF 与网页链接，内容寻址存放于 `vault/library/`，同内容自动去重；
- PDF 逐页文本提取与网页正文提取，缓存于 `vault/.sublate/cache/`；
- 应用内 PDF 阅读器：翻页、页码跳转、缩放、当前页文本面板；
- SQLite FTS5 全文检索，中文按短语匹配并定位到页码；
- 阅读位置持久化，重启后回到上次页码；
- 回收站：软删除与恢复；
- 混合检索：FTS5 与 LanceDB 向量两路召回，RRF 融合；没有向量模型时自动退化为 FTS5；
- 知识点抽取：按 chunk 分批调用 AI，输出知识单元与知识点草稿，页码锚定到载体页，失败不写入半套数据；
- 知识点修订：按单元分组，批量确认/拒绝、合并、按页拆分、重设页码锚点；
- Agent 学习工具：`search_library`、`read_carrier`、`draft_knowledge_points`（草稿，需人工确认）。

## 后续里程碑能力

- **M3**：课程与单元编排、学习目标、按每日时长生成学习计划、今日任务视图；
- **M4**：学习卡片与 1–4 自评、FSRS 复习排程、进度面板与每日预算、可确认可回放的 Agent 助手；
- **M5**：Markdown 笔记存放在 `vault/notes/`（带 YAML frontmatter，Obsidian 可直接打开）、`[[标题]]` wiki 双向链接、关联知识点与载体、笔记回收站；专业集把知识点与载体组织成研究领域，并以「广度 0.4 + 深度 0.3 + 平均掌握 0.3」给出研究程度；助手按目标自动选择知识点抽取、学习计划、复习教练或研究技能；提供 10 万级向量写入与查询基准。
- **专业集画布**：专业集默认进入 UE5.8 风格的蓝图编辑器；知识点节点带执行引脚（前置/后续）与数据引脚（相关），载体节点作为数据来源；支持右键上下文菜单、节点别名/备注、连线类型切换、注释框（移动/缩放/改色），连线支持 90° 曼哈顿与 45° 地铁两种走线风格并可切换。

## 打包便携版

```powershell
pnpm package:dir        # 仅更新便携目录，供本地运行测试（不生成 zip）
pnpm package:portable   # 生成便携目录与发布 zip
```

产物位于工作区 `构建产物/`：目录 `SublateMaze-<版本>-windows-x64-portable/` 与发布压缩包 `项目发布产物/SublateMaze-<版本>-windows-x64-portable.zip`。解压后运行 `SublateMaze.exe`，数据保存在 exe 同级的 `.vault` 与 `.electron-data`。打 `v*` 标签会触发 `.github/workflows/release.yml` 上传 Release。

## AI 配置（M2）

通过环境变量配置，未设置 Key 时 AI 能力自动降级，不影响其它功能：

```powershell
$env:DEEPSEEK_API_KEY = '...'                     # 或 SUBLATE_AI_API_KEY
$env:SUBLATE_AI_CHAT_MODEL = 'deepseek-chat'      # 可选
$env:SUBLATE_AI_EMBEDDING_MODEL = '...'           # 可选，OpenAI 兼容的向量模型
$env:SUBLATE_AI_EMBEDDING_DIM = '1024'
```

详细方案见工作区 `分析文档/SublateMaze-项目工程方案.md`。

## 环境要求

- Node.js >= 22.19（当前验证：24.20）
- pnpm 10（`npm install -g pnpm@10`）
- Rust stable（当前验证：1.99）

## 快速开始

```powershell
pnpm install
pnpm build:native                      # 构建 Rust 哈希模块
pnpm dev:kernel                        # 加载核心 profile，打印插件树
pnpm --filter @sublate/desktop dev     # 启动 Electron 窗口（含窗口/IPC 插件）
pnpm typecheck
pnpm lint
pnpm test
cargo test
```

## 目录

```
apps/desktop/         Windows Electron 壳（主进程、preload、React 渲染端）
packages/core/        平台无关领域逻辑
packages/kernel/      profile 合并、插件发现、故障隔离
packages/plugin-sdk/  插件类型、manifest、权限常量
packages/shared/      领域 DTO 与 IPC 契约
packages/plugins/     官方插件（每个独立 npm 包）
crates/               Rust workspace
profiles/             Cordis 插件组合
docs/                 ADR、规格与开发文档
scripts/              开发与发布脚本
tests/                kernel / 插件 / 后续 e2e 测试
```

## 开发约定

- 先写规格（`docs/specs/`），再实现；架构取舍写入 `docs/adr/`。
- `packages/core` 禁止 import Electron、`node:fs`、`node:path`、`node:child_process`。
- 插件之间不得互相 import，只能通过 `ctx` 服务与事件协作。
- 界面视觉与代码风格参考 deepseek-harness：设计 token 集中在 `apps/desktop/src/renderer/src/theme/`，格式由 `pnpm lint` 约束。
- 所有提交须通过 `pnpm typecheck`、`pnpm lint` 与 `pnpm test`。

AI 协作约定见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
