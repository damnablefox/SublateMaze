# ADR-0001：使用 Cordis 4 作为插件内核

- 状态：已采纳
- 日期：2026-10-21

## 背景

SublateMaze 要求“一切皆插件”：存储、解析、AI、排程、课程、计划、笔记、检索、Agent、IPC、窗口都由可替换的插件提供。自研加载器与依赖解析会重复造轮子，且难以获得运行时卸载、依赖注入与故障隔离能力。

## 决策

采用 `@deepseek-ai/cordis` 4.0.5 作为内核，锁定精确版本：

- 插件是导出 `name`、`apply(ctx, config)`、可选 `inject` 的模块；
- 服务通过 `ctx.provide(name, value)` 注册，随插件卸载自动撤销；
- profile 使用与 DeepSeek Harness 一致的 `cordis.patch.yml` 风格（`- insert: - id/name/config`）；
- 业务插件不直接依赖 Cordis 的内部类型，统一经 `packages/plugin-sdk` 暴露的类型与辅助函数接入。

## 后果

- 获得成熟的插件生命周期、依赖解析与可逆注册；
- Cordis 仍处于 4.x 早期，升级需跑插件契约测试；
- 内核层（`packages/kernel`）承担 profile 解析与故障隔离，保持 Cordis 可替换。

## 备选方案

- 自研插件框架：可控但重复实现生命周期与依赖注入，放弃。
- 直接依赖 DeepSeek Harness：其领域是编码 Agent，耦合过重，放弃。

## 参考

- <https://cordis.moe/>
- <https://www.deepseek.com/harness/en/>
