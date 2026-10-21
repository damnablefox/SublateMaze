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

## 复制的源码

| 来源项目 | 上游 commit | 源文件 → 目标文件 | 使用方式 | 许可证 | 修改摘要 |
|---|---|---|---|---|---|
| 暂无 | - | - | - | - | - |

## 规则

1. 复制或重构宽松许可（MIT/Apache-2.0/ISC）代码时，在文件头写明来源、commit 与修改；
2. AGPL/GPL 代码不得复制进主项目，只能阅读后独立实现；
3. 每次涉及第三方代码的 PR 必须更新本表。
