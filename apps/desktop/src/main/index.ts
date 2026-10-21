import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createKernel } from '@sublate/kernel'

// 把用户数据放到项目目录内，避免受限环境写入 %APPDATA% 失败。
app.setPath('userData', join(app.getAppPath(), '.electron-data'))
app.disableHardwareAcceleration()

/** 开发时 profile 在仓库根；打包后由 extraResources 提供。 */
function resolveProfilePath() {
  const candidates = [
    resolve(app.getAppPath(), '../../profiles/default/cordis.yml'),
    resolve(app.getAppPath(), 'profiles/default/cordis.yml'),
    resolve(process.resourcesPath, 'profiles/default/cordis.yml'),
  ]
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!
}

async function bootstrap() {
  const { plugins } = await createKernel(resolveProfilePath())

  console.log(
    '[插件树]',
    plugins.map((plugin) => `${plugin.id}:${plugin.status}`).join(', '),
  )
  for (const plugin of plugins) {
    if (plugin.status === 'failed') {
      console.error(`[插件失败] ${plugin.id}: ${plugin.error}`)
    }
  }
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[启动失败]', error)
  app.quit()
})
