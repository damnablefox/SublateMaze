# ADR-0003：Electron 而不是 Tauri

- 状态：已采纳
- 日期：2026-10-21

## 背景

项目需要与 DeepSeek Harness 相同的“一切皆插件”架构，并希望 Rust 提供性能。候选宿主是 Electron 与 Tauri。

## 决策

选择 Electron + Cordis + napi-rs：

- Cordis 是 Node 运行时库，Electron 主进程可直接承载运行时插件树；
- Tauri 的插件是编译期 Rust crate 与 JS 绑定，无法实现运行时加载、卸载与依赖解析；
- 若用 Tauri 保留 Cordis，需要在 sidecar 中再跑一个 Node 进程，形成双运行时。

## 后果

- 安装包体积大于 Tauri，但插件能力与 Harness 范式一致；
- 原生能力通过 napi-rs 获取，性能瓶颈仍可下沉到 Rust；
- 渲染进程继续使用 React + Vite，开发体验稳定。

## 备选方案

- Tauri 2 + 自研运行时插件层：需要重写 Cordis 语义，放弃。
- 纯 Web + 本地服务：不符合本地优先与桌面知识库定位，放弃。
