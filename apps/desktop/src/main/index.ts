import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernel } from '@sublate/kernel'

const currentDir = dirname(fileURLToPath(import.meta.url))

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
  const { ctx, plugins } = await createKernel(resolveProfilePath())
  console.log(
    '[插件树]',
    plugins.map((plugin) => `${plugin.id}:${plugin.status}`).join(', '),
  )
  for (const plugin of plugins) {
    if (plugin.status === 'failed') {
      console.error(`[插件失败] ${plugin.id}: ${plugin.error}`)
    }
  }

  ipcMain.handle('kernel:plugins', () => plugins)
  ipcMain.handle('kernel:demo-ping', () => {
    const demo = ctx.get('demo') as { ping(message: string): string } | undefined
    return demo?.ping('渲染进程') ?? 'demo 服务不可用'
  })

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'SublateMaze',
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(join(currentDir, '../renderer/index.html'))
  }
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[启动失败]', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
