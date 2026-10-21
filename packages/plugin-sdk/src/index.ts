import { z } from 'zod'

/** 工具/插件权限级别，与方案 9.6 的四级权限一致。 */
export const PermissionSchema = z.enum([
  'read',
  'write-draft',
  'write-commit',
  'dangerous',
])

export type Permission = z.infer<typeof PermissionSchema>

/** 插件清单：宿主用它做预检、权限展示与依赖检查。 */
export const PluginManifestSchema = z.object({
  apiVersion: z.literal(1),
  provides: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  inject: z.array(z.string()).default([]),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

/** Cordis 插件模块的最小形状。 */
export interface PluginModule {
  name: string
  inject?: string[]
  apply: (ctx: any, config?: any) => unknown
}

/** 仅用于类型收窄，不改变运行时行为。 */
export function definePlugin<T extends PluginModule>(plugin: T): T {
  return plugin
}

/** 工具注册信息：插件通过 ctx.tools.register 提供能力。 */
export interface ToolRegistration<I = unknown> {
  name: string
  description: string
  permission: Permission
  input: { parse(value: unknown): I }
  execute(input: I, context: { sessionId?: string }): unknown | Promise<unknown>
}

export interface ToolInfo {
  name: string
  description: string
  permission: Permission
}

export interface ToolsApi {
  register(tool: ToolRegistration<any>): () => void
  invoke(
    name: string,
    input: unknown,
    options?: { sessionId?: string; confirmed?: boolean },
  ): Promise<unknown>
  list(): ToolInfo[]
}

export interface AgentEvent {
  seq: number
  type: string
  payload: unknown
  createdAt: string
}

export interface SessionApi {
  start(goal: string): { id: string; goal: string; createdAt: string }
  append(sessionId: string, type: string, payload: unknown): AgentEvent
  get(sessionId: string): { id: string; goal: string; events: AgentEvent[] } | undefined
  list(): { id: string; goal: string; createdAt: string; eventCount: number }[]
}

export type AgentDecision =
  | { type: 'done'; answer: string }
  | { type: 'tool'; tool: string; args: unknown }

export interface AgentRunOptions {
  goal: string
  decide: (state: { step: number; history: AgentEvent[] }) => AgentDecision | Promise<AgentDecision>
  maxSteps?: number
  confirm?: (tool: string, args: unknown) => boolean | Promise<boolean>
}

export interface AgentRunResult {
  sessionId: string
  ok: boolean
  answer?: string
  error?: string
  events: AgentEvent[]
}

export interface AgentApi {
  run(options: AgentRunOptions): Promise<AgentRunResult>
}
