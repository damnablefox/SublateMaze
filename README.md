# SublateMaze

本地优先的个人学习平台与知识库管理系统。

把书籍、论文、课程、网页等“知识载体”沉淀为可检索、可定位的知识库，拆解为知识点与知识单元，组织成课程与学习目标，再用记忆模型生成每日计划并持续量化掌握程度。

> 当前状态：**M0 工程骨架已完成**。pnpm / Cargo 工作区、Cordis 插件内核、Electron 窗口、SQLite / LanceDB、Rust 原生哈希、vault 与 Agent 三件套（工具、会话、循环）均已跑通，10 个插件在应用中全部 running。业务插件从 M1 开始接入。

## 核心设计

- **一切皆插件**：与 DeepSeek Harness 同源，使用 Cordis 4 作为内核，存储、解析、AI、排程、课程、计划、笔记、检索、Agent 均为插件。
- **一主一辅存储**：SQLite 是唯一关系写者与事务主库；LanceDB 作为可重建的派生向量索引，负责语义检索与 RAG。
- **Rust 原生层**：通过 napi-rs 提供哈希、PDF 文本、全文索引等 CPU 密集能力。
- **学习辅助 Agent**：复用 Harness 的循环、工具、技能与会话机制，工具集替换为学习域能力，写操作需确认并可审计。
- **平台无关 core**：业务逻辑放在 `packages/core`，不依赖 Electron 与 Node 文件 API，便于测试与未来换壳。

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
- 所有提交须通过 `pnpm typecheck` 与 `pnpm test`。

AI 协作约定见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
