import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'ui-shell'
export const inject: string[] = []

interface IpcLike {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

/**
 * 窗口插件。
 *
 * Electron 启动器只负责创建 Cordis Context；窗口的创建、加载与销毁都在这里，
 * 卸载插件即可关闭窗口。
 */
export async function apply(ctx: Context) {
  const { app, BrowserWindow, dialog } = await import('electron')
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
      // preload 以 ESM 构建（electron-vite 输出 .mjs），沙箱模式只接受 CJS preload。
      // 仍保留 contextIsolation 与 nodeIntegration=false，渲染进程无法直接访问 Node。
      sandbox: false,
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

  const ipc = ctx.get('ipc') as IpcLike | undefined
  if (ipc) {
    const dispose = ipc.register('library:pick-files', async () => {
      const result = await dialog.showOpenDialog(window, {
        title: '导入知识载体',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      })

      return result.canceled ? [] : result.filePaths
    })

    ctx.effect(() => dispose)
  } else {
    ctx.logger('ui-shell').warn('IPC 服务不可用，文件选择频道未注册')
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
