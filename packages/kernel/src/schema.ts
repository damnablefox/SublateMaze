import { z } from 'zod'

/**
 * profile/patch 的行格式，与 DeepSeek Harness 的 cordis.patch.yml 保持一致：
 *
 * - insert:
 *     - id: demo
 *       name: '@sublate/plugin-demo'
 */
export const PluginRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  disabled: z.boolean().optional(),
})

export type PluginRow = z.infer<typeof PluginRowSchema>

export const PatchLayerSchema = z.object({
  insert: z.array(PluginRowSchema).optional(),
})

export const PluginPatchSchema = z.array(PatchLayerSchema)

export type PluginPatch = z.infer<typeof PluginPatchSchema>
