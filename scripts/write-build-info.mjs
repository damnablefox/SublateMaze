import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = resolve(root, 'apps/desktop')
const pkg = JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8'))

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const info = {
  product: 'SublateMaze',
  version: pkg.version,
  commit: gitCommit(),
  builtAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  electron: pkg.devDependencies?.electron ?? 'unknown',
  node: process.versions.node,
}

writeFileSync(
  resolve(desktop, 'build-info.json'),
  `${JSON.stringify(info, null, 2)}\n`,
  'utf8',
)

console.log(`BUILD_INFO.json 已写入：${info.version} (${info.commit})`)
