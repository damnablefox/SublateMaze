# 第三方代码与依赖台账

当前仓库**未复制任何第三方源码**，只通过 npm / crates 依赖使用。若后续复制或重构第三方代码，必须在本表登记，并在文件头保留来源与 commit。

## 运行时依赖

| 依赖 | 许可证 | 用途 | 是否需要额外声明 |
|---|---|---|---|
| `@deepseek-ai/cordis` 4.0.5 | MIT | 插件内核 | 否，随依赖分发 |
| `apache-arrow` 18.1.0 | Apache-2.0 | LanceDB 向量 schema | 否 |
| `@lancedb/lancedb` 0.40.0 | Apache-2.0 | 向量索引 | 否 |
| `node:sqlite` | Node 内置 | SQLite 驱动 | 否（随 Node/Electron 分发） |
| `zod` 4.x | MIT | 参数与契约校验 | 否 |
| `yaml` 2.x | ISC | profile 解析 | 否 |
| `electron` 45.x | MIT | 桌面宿主 | 否 |
| `react` / `react-dom` 19.x | MIT | 渲染界面 | 否 |
| `pdfjs-dist` 6.4.299 | Apache-2.0 | PDF 文本提取与阅读器渲染 | 否 |
| `@mozilla/readability` 0.6.0 | Apache-2.0 | 网页正文提取 | 否 |
| `jsdom` 30.1.3 | MIT | 网页 DOM 解析（服务端） | 否 |
| `ts-fsrs` 5.4.2 | MIT | FSRS 复习调度算法 | 否，随依赖分发 |

## 复制的源码

| 来源项目 | 上游 commit | 源文件 → 目标文件 | 使用方式 | 许可证 | 修改摘要 |
|---|---|---|---|---|---|
| Montserrat | - | `montserrat-*.woff2` → `apps/desktop/src/renderer/src/theme/fonts/*.woff2` | 复制 | SIL OFL 1.1 | 原样复制字体文件，`Montserrat-OFL.txt` 随附 |
| deepseek-harness | `687f282e` | `packages/client/ui-theme/src/styles/design-platform.css` → `apps/desktop/src/renderer/src/theme/tokens.css` | 重构 | MIT | 裁剪静态色板与 alias 分层并改为语义 token；去除平台分支与设置项变量 |

## 规则

1. 复制或重构宽松许可（MIT/Apache-2.0/ISC）代码时，在文件头写明来源、commit 与修改；
2. AGPL/GPL 代码不得复制进主项目，只能阅读后独立实现；
3. 每次涉及第三方代码的 PR 必须更新本表。
