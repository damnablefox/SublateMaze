import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'ui-shell'
export const inject: string[] = []

/**
 * 窗口插件。
 *
 * Electron 启动器只负责创建 Cordis Context；窗口的创建、加载与销毁都在这里，
 * 卸载插件即可关闭窗口。
 */
export async function apply(ctx: Context) {
  const { app, BrowserWindow } = await import('electron')
  await app.whenReady()

  const appPath = app.getAppPath()
  const preload = resolve(appPath, 'out/preload/index.mjs')
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const rendererFile = resolve(appPath, 'out/renderer/index.html')

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'SublateMaze',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  if (devUrl) {
    await window.loadURL(devUrl)
  } else {
    await window.loadFile(rendererFile)
  }

  ctx.effect(() => () => {
    if (!window.isDestroyed()) window.destroy()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
