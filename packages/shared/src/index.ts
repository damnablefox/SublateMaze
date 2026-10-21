import { z } from 'zod'

/** 跨进程共享的 vault 信息契约。 */
export const VaultInfoSchema = z.object({
  path: z.string(),
  formatVersion: z.number().int().positive(),
  createdAt: z.string(),
})

export type VaultInfo = z.infer<typeof VaultInfoSchema>

/** IPC 频道命名约定：domain:action。 */
export const IpcChannels = {
  vaultInfo: 'vault:info',
} as const
