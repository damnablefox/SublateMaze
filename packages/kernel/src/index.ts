import { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { PluginPatchSchema, type PluginRow } from './schema.ts'

export type PluginStatus = 'running' | 'disabled' | 'failed'

export interface PluginState {
  id: string
  name: string
  status: PluginStatus
  error?: string
}

export interface Kernel {
  ctx: Context
  plugins: PluginState[]
}

/**
 * 读取一个 profile，按行装载插件。
 *
 * 单个插件失败只标记 failed，不影响其余插件；这与方案 6.5 的故障隔离一致。
 */
export async function createKernel(profilePath: string): Promise<Kernel> {
  const raw = await readFile(profilePath, 'utf8')
  const layers = PluginPatchSchema.parse(parse(raw))
  const rows: PluginRow[] = layers.flatMap(layer => layer.insert ?? [])

  const ctx = new Context()
  const plugins: PluginState[] = []

  // 供 ipc-bridge 等宿主插件读取的只读视图。
  ctx.provide('kernelInfo', { plugins })

  for (const row of rows) {
    if (row.disabled) {
      plugins.push({ id: row.id, name: row.name, status: 'disabled' })
      continue
    }

    try {
      const mod = await import(row.name)
      if (typeof mod.apply !== 'function') {
        throw new Error(`插件 ${row.name} 未导出 apply(ctx, config)`)
      }

      await ctx.plugin(
        {
          name: mod.name ?? row.id,
          inject: mod.inject,
          apply: mod.apply,
        },
        row.config,
      )

      plugins.push({ id: row.id, name: row.name, status: 'running' })
    } catch (error) {
      plugins.push({
        id: row.id,
        name: row.name,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { ctx, plugins }
}
