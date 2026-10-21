import type { Context } from '@deepseek-ai/cordis'
import type { ToolInfo, ToolRegistration, ToolsApi } from '@sublate/plugin-sdk'

export const name = 'tools'
export const inject: string[] = []

/**
 * 工具注册表。
 *
 * 权限约定：write-commit 与 dangerous 必须在调用时显式 `confirmed: true`，
 * 确认动作由 Agent 层负责询问用户并记录审计事件。
 */
export class ToolsService implements ToolsApi {
  private readonly registry = new Map<string, ToolRegistration<any>>()

  register(tool: ToolRegistration<any>): () => void {
    if (this.registry.has(tool.name)) {
      throw new Error(`工具已注册：${tool.name}`)
    }

    this.registry.set(tool.name, tool)
    return () => {
      this.registry.delete(tool.name)
    }
  }

  list(): ToolInfo[] {
    return [...this.registry.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      permission: tool.permission,
    }))
  }

  async invoke(
    toolName: string,
    input: unknown,
    options: { sessionId?: string; confirmed?: boolean } = {},
  ): Promise<unknown> {
    const tool = this.registry.get(toolName)
    if (!tool) throw new Error(`未知工具：${toolName}`)

    const requiresConfirm =
      tool.permission === 'write-commit' || tool.permission === 'dangerous'
    if (requiresConfirm && options.confirmed !== true) {
      throw new Error(`工具 ${toolName} 需要用户确认`)
    }

    const parsed = tool.input.parse(input)
    return tool.execute(parsed, { sessionId: options.sessionId })
  }
}

export function apply(ctx: Context) {
  ctx.provide('tools', new ToolsService())
  ctx.logger('tools').info('工具注册表已就绪')
}
