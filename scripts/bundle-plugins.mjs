import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = resolve(root, 'packages/plugins')
const outDir = resolve(root, 'apps/desktop/out/plugins')
const profile = resolve(root, 'profiles/default/cordis.yml')

const EXTERNAL = [
  'electron',
  '@deepseek-ai/cordis',
  'zod',
  'yaml',
  'ts-fsrs',
  '@lancedb/lancedb',
  'apache-arrow',
]

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const entries = readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => ({
    dir: entry.name,
    entry: join(pluginsDir, entry.name, 'src/index.ts'),
    outfile: join(outDir, `plugin-${entry.name}.mjs`),
  }))
  .filter(item => {
    try {
      return readFileSync(item.entry, 'utf8').length > 0
    } catch {
      return false
    }
  })

for (const item of entries) {
  await build({
    entryPoints: [item.entry],
    outfile: item.outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    external: EXTERNAL,
    logLevel: 'warning',
  })
}

const bundledProfile = readFileSync(profile, 'utf8').replaceAll(
  "name: '@sublate/plugin-",
  "name: '@bundled/plugin-",
)

writeFileSync(join(outDir, 'cordis.yml'), bundledProfile, 'utf8')

console.log(`插件 bundle 完成：${entries.length} 个，输出 ${outDir}`)
