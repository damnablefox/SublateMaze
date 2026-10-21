import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createKernel } from '@sublate/kernel'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('kernel profile 加载', () => {
  it('加载默认 profile 并注册 demo 服务', async () => {
    const { ctx, plugins } = await createKernel(
      resolve(root, 'tests/fixtures/demo-profile.yml'),
    )

    expect(plugins).toEqual([
      { id: 'tools', name: '@sublate/plugin-tools', status: 'running' },
      { id: 'demo', name: '@sublate/plugin-demo', status: 'running' },
    ])

    const demo = ctx.get('demo') as { ping(message: string): string } | undefined
    expect(demo?.ping('test')).toBe('pong: test')
  })

  it('缺失插件被标记为 failed 且不抛错', async () => {
    const { plugins } = await createKernel(
      resolve(root, 'tests/fixtures/broken-profile.yml'),
    )

    expect(plugins[0]?.status).toBe('failed')
    expect(plugins[0]?.error).toContain('@sublate/plugin-does-not-exist')
  })
})
