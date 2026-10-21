# SublateMaze

本地优先的个人学习平台与知识库管理系统。

把书籍、论文、课程、网页等“知识载体”沉淀为可检索、可定位的知识库，拆解为知识点与知识单元，组织成课程与学习目标，再用记忆模型生成每日计划并持续量化掌握程度。

> 当前状态：**M1 知识库、导入与阅读已完成**；**M2 进行中**，AI Provider、混合检索（FTS5 + LanceDB，RRF 融合）与知识点抽取（草稿态）已接入。16 个插件在应用中全部 running。

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
- 知识点抽取：按 chunk 分批调用 AI，输出知识单元与知识点草稿，页码锚定到载体页，失败不写入半套数据。

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
