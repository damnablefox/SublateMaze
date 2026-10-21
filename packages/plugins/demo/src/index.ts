import type { Context } from '@deepseek-ai/cordis'

export const name = 'demo'
export const inject: string[] = []

export interface DemoService {
  ping(message: string): string
}

/**
 * 最小示例插件：注册 `ctx.demo` 服务，用于验证插件树、服务注册与卸载。
 */
export function apply(ctx: Context) {
  const service: DemoService = {
    ping: (message) => `pong: ${message}`,
  }

  ctx.provide('demo', service)
  ctx.logger('demo').info('demo 插件已加载')
}
