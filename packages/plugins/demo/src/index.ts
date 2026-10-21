import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsApi } from '@sublate/plugin-sdk'

export const name = 'demo'
export const inject = ['tools']

export interface DemoService {
  ping(message: string): string
}

/**
 * 最小示例插件：注册 `ctx.demo` 服务与 `demo.echo` 工具，
 * 用于验证插件树、服务注册、工具权限与卸载。
 */
export function apply(ctx: Context) {
  const service: DemoService = {
    ping: message => `pong: ${message}`,
  }

  ctx.provide('demo', service)

  const tools = ctx.get('tools') as ToolsApi
  tools.register({
    name: 'demo.echo',
    description: '回显输入文本，用于验证 Agent 工具调用链路',
    permission: 'read',
    input: z.object({ text: z.string().min(1) }),
    execute: ({ text }) => `回声：${text}`,
  })

  ctx.logger('demo').info('demo 插件已加载')
}
