import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把 pdfjs-dist 的 cmaps 与 standard_fonts 复制到渲染端 public 目录。
 *
 * 这两份资源不进版本库，构建与开发启动前复制，避免中文 PDF 的非嵌入字体缺字形。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromDesktop = createRequire(join(root, 'apps', 'desktop', 'package.json'))
const pdfjsRoot = dirname(requireFromDesktop.resolve('pdfjs-dist/package.json'))
const target = join(root, 'apps', 'desktop', 'src', 'renderer', 'public', 'pdfjs')

for (const folder of ['cmaps', 'standard_fonts']) {
  const source = join(pdfjsRoot, folder)
  if (!existsSync(source)) {
    throw new Error(`缺少 pdfjs 资源目录：${source}`)
  }

  const destination = join(target, folder)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true })
}

console.log(`[pdfjs] 资源已复制到 ${target}`)
