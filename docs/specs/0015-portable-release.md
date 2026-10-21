# Spec-0015：Windows 便携版打包与发布

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M6

## 目标

1. 生成 Windows x64 便携版：解压即用，不写注册表、不需要安装；
2. 产物放到工作区根 `构建产物/`，发布 zip 放到 `构建产物/项目发布产物/`；
3. 生成 `BUILD_INFO.json`（版本、提交、构建时间、平台、Electron/Node 版本）；
4. 提供 `release.yml`：打 `v*` 标签时自动构建并上传 GitHub Release；
5. 保证打包后插件树、原生模块、LanceDB、SQLite 与 PDF 阅读器正常；
6. 便携版数据目录位于 exe 同级 `.vault` 与 `.electron-data`。

## 非目标

- 不做安装器（NSIS/MSI）、自动更新、代码签名；
- 不做 macOS/Linux 打包；
- 不把开发库 `.vault` 打进产物。

## 实现

### 应用路径适配

- 打包后以 exe 所在目录作为工作目录，`userData` 指向 `.electron-data`；
- 原生模块优先从 `process.resourcesPath/native/` 加载，找不到再回退开发路径；
- profile 从 `resources/profiles/default/cordis.yml` 读取（已有逻辑）。

### 打包配置

`apps/desktop/electron-builder.yml`：

- `appId: com.sublate.maze`、`productName: SublateMaze`；
- `asar: true`，`asarUnpack` 原生 `.node`；
- `files` 只包含 `out/**`、`package.json` 与生产依赖，排除 `.vault`、`.electron-data`、`src`；
- `extraResources` 复制原生模块、默认 profile 与 `BUILD_INFO.json`；
- `win.target: zip`、`artifactName: SublateMaze-${version}-windows-x64-portable.${ext}`。

### 构建脚本

`scripts/package-portable.mjs`：

1. 生成 `BUILD_INFO.json`；
2. 运行 electron-builder 输出到 `dist/`；
3. 将 `dist/win-unpacked` 复制为 `构建产物/SublateMaze-<version>-windows-x64-portable/`；
4. 将 zip 复制为 `构建产物/项目发布产物/SublateMaze-<version>-windows-x64-portable.zip`；
5. 删除同名旧目录与旧 zip，只保留最新版。

命令：

```powershell
pnpm package:portable
```

### 发布工作流

`.github/workflows/release.yml`：

- 触发：`push` 标签 `v*` 或手动；
- 步骤：安装依赖、构建原生模块、构建 Electron、打包 zip、创建 Release 并上传 zip。

## 验收标准

- `pnpm package:portable` 产出目录与 zip，命名符合规范；
- 解压后运行 `SublateMaze.exe`，21 个插件全部 running；
- 导入 PDF、阅读、检索、笔记、专业集、助手页面均可打开；
- 原生哈希后端为 `rust`；
- SQLite 与 LanceDB 数据写入 exe 同级 `.vault`；
- `BUILD_INFO.json` 字段完整；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 与 CI 通过。

## 测试点

1. 构建信息脚本字段与提交号；
2. 打包目录结构：`resources/app.asar`、`resources/native`、`resources/profiles`；
3. 解压运行与插件树截图；
4. 数据目录位置与重启后数据保留。

## 实测结果（2026-10-22）

- 产物：
  - 目录 `构建产物/SublateMaze-0.1.0-windows-x64-portable/`；
  - 压缩包 `构建产物/项目发布产物/SublateMaze-0.1.0-windows-x64-portable.zip`；
- 结构：`SublateMaze.exe`、`resources/app.asar`、`resources/native/sublate-native.win32-x64-msvc.node`、`resources/profiles/default/cordis.yml`、`resources/build-info.json`；
- `BUILD_INFO.json`：版本 0.1.0、提交短号、构建时间、win32/x64、Electron 45.0.0、Node 24.20.0；
- 插件：便携版启动后 22 个插件全部 `running`，原生后端为 `rust`（0.1.0）；
- 数据：`.vault` 与 `.electron-data` 创建在 exe 同级；在便携版创建「便携版验收」笔记后重启，笔记仍在，SQLite 位于 `.vault/.sublate/sublate.db`；
- 界面：便携版首页、笔记、专业集与助手页面均可打开，助手技能库正常显示；
- 关键适配：Electron 不允许对 `node_modules` 下的 TypeScript 做类型剥离，打包时用 esbuild 把 22 个插件打成 `out/plugins/*.mjs`，profile 改写为 `@bundled/*` 并由 kernel 从 `SUBLATE_PLUGIN_DIR` 加载；
- 依赖：用 `pnpm deploy --prod --legacy` 生成隔离生产目录，再用 electron-builder 打包；LanceDB 原生模块与 `.node` 通过 `asarUnpack` 解包；
- 清理：验证后已删除便携目录中的 `.vault` 与 `.electron-data`，发布 zip 不含测试数据；
- 未验证：代码签名与自动更新（非目标）；Release 工作流仅在 tag 推送时触发，尚未打标签实测。
