# AGENTS.md

面向 AI 编码助手的工程约定。任何实现前先读本文件、`README.md` 与相关的 `docs/specs`、`docs/adr`。

## 项目定位

SublateMaze 是本地优先的个人学习平台与知识库。M1 的导入、阅读、FTS5 检索与回收站已完成；M2 的 AI Provider、混合检索、知识点抽取与修订界面、Agent 学习工具已接入；M3 新增课程编排、学习目标、学习计划与今日视图；M4 接入学习卡片、1–4 自评与 FSRS 复习排程、进度面板与每日预算；M5 新增 Markdown 笔记、wiki 双向链接、知识点/载体关联与笔记回收站，专业集与研究程度，按目标自动选择的 Agent 技能库，以及 10 万级向量基准；M6 完成 Windows x64 便携版打包、BUILD_INFO 与 Release 工作流；专业集新增对齐 UE5.8 蓝图的画布视图，知识点节点区分执行引脚与数据引脚，载体作为数据来源，节点坐标持久化并支持引脚拖线。PDF 目录识别与更细的锚点留待后续。

完整方案见工作区 `../分析文档/SublateMaze-项目工程方案.md`（不在本仓库内）。

## 目录与职责

| 路径 | 职责 |
|---|---|
| `packages/core` | 平台无关领域逻辑（实体、用例、FSRS、计划算法、Agent 工具定义） |
| `packages/kernel` | profile 解析、插件装载、故障隔离 |
| `packages/plugin-sdk` | 插件类型、manifest、权限常量 |
| `packages/shared` | 领域 DTO 与跨进程契约（zod） |
| `packages/plugins/*` | 官方插件，每个是独立 workspace 包 |
| `apps/desktop` | Windows Electron 壳（M0 后续接入） |
| `profiles/` | Cordis 插件组合（`cordis.yml`，`- insert:` 行） |
| `crates/` | Rust workspace |
| `docs/adr` | 架构决策记录 |
| `docs/specs` | 功能规格与验收标准 |
| `tests/` | kernel、插件契约、后续 e2e |

## 常用命令

```powershell
pnpm install
pnpm dev:kernel     # 加载默认 profile，打印插件树
pnpm typecheck
pnpm test
cargo test
```

## 硬性边界

1. `packages/core` 不得 import `electron`、`node:fs`、`node:path`、`node:child_process`；文件与数据库能力通过接口注入。
2. `packages/plugins/*` 之间不得互相 import；只能通过 `ctx` 服务与事件协作。
3. SQLite 只允许 `storage-sqlite` 插件写入；LanceDB 只允许 `storage-lancedb` 插件写入。
4. Agent 工具必须声明权限级别（read / write-draft / write-commit / dangerous），写操作必须经用户确认并写审计事件。
5. 渲染进程不得直接访问 Node；所有能力经 `preload` 白名单与 IPC 契约。
6. `packages/shared` 的契约变更必须同步更新调用方与测试。
7. 插件源码由 Electron 直接以 TypeScript strip-only 模式执行：**禁止参数属性**（`constructor(private x: T)`），相对导入必须带 `.ts` 后缀。

## 视觉与代码规范

界面视觉与交互参考 deepseek-harness（MIT），代码风格与其保持一致：

- 设计 token 集中在 `apps/desktop/src/renderer/src/theme/tokens.css`；组件只消费 alias token（`--bg-*`、`--label-*`、`--border-*`、`--state-*`），不写死颜色。
- 浅色为默认主题，深色通过 `body[data-ds-dark-theme]` 整体切换；新增界面必须同时检查两种主题。
- 主按钮使用黑白反转（浅色黑底白字、深色白底黑字）；描边统一 0.5px 发丝线；圆角走 `--radius-*` 阶梯。
- 品牌字使用 Montserrat（SIL OFL 1.1，许可证随仓库分发）；正文用系统字体栈，代码用显式等宽字体栈。
- 代码格式：2 空格缩进、单引号、无分号、尾逗号、行宽 ≤ 140；提交前运行 `pnpm lint`，CI 执行同一命令。

## 实现流程

1. 在 `docs/specs/` 写规格：目标、非目标、接口、数据变更、验收标准、测试点；
2. 一次只改一个包或一个用例；
3. 先接口、再实现、再测试、最后接线；
4. 运行 `pnpm typecheck` 与 `pnpm test`，涉及 Rust 时运行 `cargo test`；
5. 提交前确认没有新增未登记来源的第三方代码。

## 测试要求

- 新增逻辑必须有单元测试；跨插件行为用 `tests/` 下的契约测试。
- 测试必须断言可观察行为，不依赖内部实现细节。
- 不提交被跳过的测试（`.skip`）或空断言。

## 版本号与构建产物

版本号使用三层数字 `主版本.次版本.修订号`，当前为 `0.1.1`；构建产物目录名取自 `apps/desktop/package.json` 的版本。

| 改动类型 | 版本变化 | 示例 |
|---|---|---|
| 修改现有功能、修复缺陷、美化 UI/UX | 修订号 +1 | `0.1.0 → 0.1.1` |
| 增加模块、加入插件、调整架构 | 次版本 +1，修订号归零 | `0.1.1 → 0.2.0` |
| 底层或对工程有重大影响的改动 | 主版本 +1，次版本保持，修订号归零 | `0.1.0 → 1.1.0` |

每次改动项目后运行 `pnpm package:dir`，更新工作区 `构建产物/SublateMaze-<版本>-windows-x64-portable/` 供本地运行测试；该命令不生成发布 zip。只有需要发布时才运行 `pnpm package:portable`。

## 提交与注释语言

- **提交信息、代码注释、日志、测试描述、文档正文一律使用中文**；
- 变量名、函数名、类型名、包名、命令、API 名称保持英文；
- Conventional Commits 的类型前缀保留英文（`feat` / `fix` / `docs` / `chore` 等），类型后的描述使用中文。

示例：

```
feat(内核): 支持 profile 分层加载
fix(核心): 拒绝空实体 id
docs(记录): 记录 Cordis 选型
chore: 初始化工作区
```

一次提交只做一件事。不要提交 `node_modules`、`dist`、`target`、`*.db`、`.env`、原生 `.node` 文件。

## 禁止事项

- 不修改 `Cargo.lock` / `pnpm-lock.yaml` 之外的依赖版本来源；升级依赖需单独提交并说明理由。
- 不删除或重写已有数据库迁移；迁移只增不改。
- 不把密钥、API Key、个人路径写入代码或测试夹具。
- 不引入 GPL/AGPL 代码；第三方代码按方案 2.5 登记到 `docs/third-party-notices.md`。
- 不在未写规格的情况下实现跨包的大型功能。
