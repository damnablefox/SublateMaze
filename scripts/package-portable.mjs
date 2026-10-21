import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = resolve(root, 'apps/desktop')
const workspace = resolve(root, '..')
const buildRoot = resolve(workspace, '构建产物')
const releaseRoot = resolve(buildRoot, '项目发布产物')
const cacheRoot = resolve(root, '.cache/electron-builder')

process.env.ELECTRON_BUILDER_CACHE = cacheRoot

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

function readVersion() {
  const pkg = JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8'))
  return pkg.version
}

function removeOldEntries(directory, keepName) {
  if (!existsSync(directory)) return

  for (const name of readdirSync(directory)) {
    if (name === keepName) continue
    if (!name.startsWith('SublateMaze-') || !name.includes('-windows-x64-portable')) continue
    rmSync(resolve(directory, name), { recursive: true, force: true })
  }
}

const version = readVersion()
const folderName = `SublateMaze-${version}-windows-x64-portable`
const zipName = `${folderName}.zip`
const packRoot = resolve(root, '.pack/app')

run('node', ['scripts/write-build-info.mjs'], root)
run('pnpm', ['--filter', '@sublate/desktop', 'build'], root)
run('node', ['scripts/bundle-plugins.mjs'], root)

rmSync(resolve(root, '.pack'), { recursive: true, force: true })
run('pnpm', ['--filter', '@sublate/desktop', 'deploy', '--prod', '--legacy', '.pack/app'], root)

for (const name of ['.vault', '.sublate', '.electron-data', 'dist', 'src', 'electron.vite.config.ts', 'electron-builder.yml']) {
  rmSync(resolve(packRoot, name), { recursive: true, force: true })
}

const desktopOut = resolve(desktop, 'out')
const packedOut = resolve(packRoot, 'out')
if (!existsSync(resolve(packedOut, 'main/index.js'))) {
  rmSync(packedOut, { recursive: true, force: true })
  cpSync(desktopOut, packedOut, { recursive: true })
}

run(
  'pnpm',
  [
    '--filter',
    '@sublate/desktop',
    'exec',
    'electron-builder',
    '--win',
    'zip',
    '--publish',
    'never',
    '--config',
    'electron-builder.yml',
  ],
  root,
)

const unpacked = resolve(root, '.pack/dist/win-unpacked')
const zip = resolve(root, '.pack/dist', zipName)

if (!existsSync(unpacked)) throw new Error(`未找到打包目录：${unpacked}`)
if (!existsSync(zip)) throw new Error(`未找到打包产物：${zip}`)

mkdirSync(buildRoot, { recursive: true })
mkdirSync(releaseRoot, { recursive: true })

const targetFolder = resolve(buildRoot, folderName)
const targetZip = resolve(releaseRoot, zipName)

removeOldEntries(buildRoot, folderName)
removeOldEntries(releaseRoot, zipName)

rmSync(targetFolder, { recursive: true, force: true })
cpSync(unpacked, targetFolder, { recursive: true })
cpSync(zip, targetZip)

console.log(`便携目录：${targetFolder}`)
console.log(`发布压缩包：${targetZip}`)
