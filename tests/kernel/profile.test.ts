import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createKernel } from '@sublate/kernel'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('kernel profile loading', () => {
  it('loads the default profile and registers the demo service', async () => {
    const { ctx, plugins } = await createKernel(resolve(root, 'profiles/default/cordis.yml'))

    expect(plugins).toEqual([
      { id: 'demo', name: '@sublate/plugin-demo', status: 'running' },
    ])

    const demo = ctx.get('demo') as { ping(message: string): string } | undefined
    expect(demo?.ping('test')).toBe('pong: test')
  })

  it('marks a missing plugin as failed without throwing', async () => {
    const { plugins } = await createKernel(
      resolve(root, 'tests/fixtures/broken-profile.yml'),
    )

    expect(plugins[0]?.status).toBe('failed')
    expect(plugins[0]?.error).toContain('@sublate/plugin-does-not-exist')
  })
})
