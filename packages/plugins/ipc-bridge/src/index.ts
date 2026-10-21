import type { Context } from '@deepseek-ai/cordis'
import type { IpcMain } from 'electron'

export const name = 'ipc-bridge'
export const inject = ['kernelInfo']

export interface IpcService {
  register(channel: string, handler: (...args: any[]) => any): () => void
}

class IpcServiceImpl implements IpcService {
  private readonly ipcMain: IpcMain
  private readonly channels = new Set<string>()

  constructor(ipcMain: IpcMain) {
    this.ipcMain = ipcMain
  }

  register(channel: string, handler: (...args: any[]) => any): () => void {
    if (this.channels.has(channel)) {
      throw new Error(`IPC 频道已注册：${channel}`)
    }

    this.ipcMain.handle(channel, (_event, ...args) => handler(...args))
    this.channels.add(channel)

    return () => {
      this.ipcMain.removeHandler(channel)
      this.channels.delete(channel)
    }
  }

  dispose(): void {
    for (const channel of this.channels) {
      this.ipcMain.removeHandler(channel)
    }
    this.channels.clear()
  }
}

/**
 * IPC 桥。
 *
 * 只注册显式白名单频道；渲染进程无法调用未注册的服务。
 */
export async function apply(ctx: Context) {
  const { ipcMain } = await import('electron')
  const service = new IpcServiceImpl(ipcMain)

  ctx.provide('ipc', service)
  ctx.effect(() => () => service.dispose())

  const kernelInfo = ctx.get('kernelInfo') as { plugins: unknown[] }
  service.register('kernel:plugins', () => kernelInfo.plugins)
  service.register('kernel:demo-ping', () => {
    const demo = ctx.get('demo') as { ping(message: string): string } | undefined
    return demo?.ping('渲染进程') ?? 'demo 服务不可用'
  })
}
