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
