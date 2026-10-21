# Spec-0001：M0 工程骨架

- 状态：已完成
- 日期：2026-10-21

## 目标

建立可运行、可测试、可提交的最小工程骨架，证明以下链路成立：

1. pnpm workspace 与 Cargo workspace 可用；
2. Cordis 能按 profile 装载插件，并注册服务；
3. 插件失败被隔离为 `failed` 状态，不影响其他插件；
4. TypeScript 类型检查与单元测试通过；
5. 仓库可推送到 GitHub 远程。

## 非目标

- Electron 窗口与渲染进程；
- SQLite / LanceDB 实际连接；
- Rust napi 原生模块；
- 任何业务功能（导入、抽取、课程、计划、Agent 工具）。

## 接口

### profile 格式

```yaml
- insert:
    - id: demo
      name: '@sublate/plugin-demo'
      config: {}
      disabled: false
```

### kernel

```ts
createKernel(profilePath: string): Promise<{
  ctx: Context
  plugins: { id: string; name: string; status: 'running' | 'disabled' | 'failed'; error?: string }[]
}>
```

行为：

- 按行解析 profile；
- 动态 import 插件包；
- 单插件失败只标记 `failed`，继续加载后续插件；
- 成功插件注册的服务可通过 `ctx.get(name)` 读取。

### demo 插件

- 注册 `ctx.demo`，提供 `ping(message): string`；
- 用于验证服务注册与卸载。

## 验收标准

- `pnpm dev:kernel` 输出 8 个核心插件 `running`，并打印 `pong: SublateMaze`；
- `pnpm typecheck` 无错误；
- `pnpm test` 17 个用例通过：kernel、SQLite、LanceDB、Agent、vault、native；
- `cargo test` 通过；
- `pnpm build:native` 产出 `.node`；
- `pnpm --filter @sublate/desktop build` 通过，Electron 开发模式窗口启动，10 个插件全部 running；
- 远程仓库收到提交。

## 实际结果（2026-10-21）

- Electron 内插件树：native-bridge、storage-sqlite、storage-lancedb、vault、tools、session、agent、demo、ipc-bridge、ui-shell 全部 running；
- 原生哈希后端：rust（0.1.0），缺失时自动降级 TypeScript；
- 测试：17 passed（kernel 2、SQLite 3、LanceDB 4、Agent 3、vault 4、native 1）；
- 窗口与 IPC 已插件化：启动器只创建 Cordis Context，`ui-shell` 创建窗口，`ipc-bridge` 注册白名单频道；
- 受限环境下将 `userData` 指向项目内 `.electron-data`，避免写入 `%APPDATA%` 失败。

## 后续

- Agent 决策函数仍由调用方注入，M2 接入 `ai-provider`；
- `session` 当前为内存实现，M1 接入 SQLite 审计表；
- Rust napi 原生模块与打包流程在 M0 后续补完。

## 测试点

- profile 解析：合法行、缺字段、缺失插件；
- 故障隔离：一个插件失败不影响后续插件；
- 服务读取：`ctx.get('demo')` 在插件加载后可用。
