import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createKernel } from '@sublate/kernel'

// 便携版把数据与工作目录放在 exe 同级，避免写入安装目录之外的位置。
const exeDir = dirname(app.getPath('exe'))

if (app.isPackaged) {
  app.setPath('userData', join(exeDir, '.electron-data'))
  // 插件在打包时由 esbuild 输出为 JS，避免 Electron 对 node_modules 内 TS 的类型剥离限制。
  process.env.SUBLATE_PLUGIN_DIR = join(app.getAppPath(), 'out/plugins')
} else {
  // 开发时把用户数据放到项目目录内，避免受限环境写入 %APPDATA% 失败。
  app.setPath('userData', join(app.getAppPath(), '.electron-data'))
}
app.disableHardwareAcceleration()

/** 开发时 profile 在仓库根；打包后由 extraResources 提供。 */
function resolveProfilePath() {
  const candidates = [
    resolve(app.getAppPath(), '../../profiles/default/cordis.yml'),
    resolve(app.getAppPath(), 'profiles/default/cordis.yml'),
    resolve(process.resourcesPath, 'profiles/default/cordis.yml'),
  ]
  return candidates.find(path => existsSync(path)) ?? candidates[0]!
}

async function bootstrap() {
  const { plugins } = await createKernel(resolveProfilePath())

  console.log(
    '[插件树]',
    plugins.map(plugin => `${plugin.id}:${plugin.status}`).join(', '),
  )
  for (const plugin of plugins) {
    if (plugin.status === 'failed') {
      console.error(`[插件失败] ${plugin.id}: ${plugin.error}`)
    }
  }
}

app.whenReady().then(async () => {
  if (app.isPackaged) process.chdir(exeDir)
  await bootstrap()
}).catch((error) => {
  console.error('[启动失败]', error)
  app.quit()
})
