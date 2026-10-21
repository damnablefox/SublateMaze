import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ParserService } from '@sublate/plugin-parser'
import { SqliteService } from '@sublate/plugin-storage-sqlite'
import { ImporterService, type ImporterDeps } from '@sublate/plugin-importer'
import { createMinimalPdf } from '../fixtures/pdf.ts'

const tempDirs: string[] = []
const closables: { close(): void }[] = []

function setup(options: { fetchWeb?: ImporterDeps['parser']['fetchWeb'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sublate-importer-'))
  tempDirs.push(root)

  const sqlite = new SqliteService(join(root, '.sublate', 'sublate.db'))
  closables.push(sqlite)

  const parser = new ParserService(root)
  const events: { event: string; payload: unknown }[] = []

  const vault = {
    resolvePath(relativePath: string) {
      const target = resolve(root, relativePath)
      if (!target.startsWith(resolve(root))) throw new Error(`路径越界：${relativePath}`)
      return target
    },
  }

  const importer = new ImporterService({
    native: {
      hashFile: async (path) =>
        createHash('sha256').update(readFileSync(path)).digest('hex'),
    },
    vault,
    db: sqlite,
    parser: {
      parsePdf: (path, sha256) => parser.parsePdf(path, sha256),
      parseWebHtml: (html, sha256, fallback) => parser.parseWebHtml(html, sha256, fallback),
      fetchWeb: options.fetchWeb ?? ((url) => parser.fetchWeb(url)),
    },
    emit: (event, payload) => events.push({ event, payload }),
  })

  return { root, sqlite, parser, importer, events }
}

function writePdf(root: string, name: string, text: string): string {
  const path = join(root, name)
  writeFileSync(path, createMinimalPdf(text))
  return path
}

afterEach(() => {
  for (const item of closables.splice(0)) item.close()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('importer', () => {
  it('导入 PDF 后按内容寻址落盘、写入页文本并发出事件', async () => {
    const { root, sqlite, importer, events } = setup()
    const pdfPath = writePdf(root, 'sample.pdf', 'Imported Page')

    const [result] = await importer.importFiles([pdfPath])

    expect(result?.status).toBe('ready')
    expect(result?.carrierId).toBeTruthy()

    const carrier = sqlite.carriers.get(result!.carrierId!)
    expect(carrier?.status).toBe('ready')
    expect(carrier?.kind).toBe('pdf')
    expect(carrier?.pageCount).toBe(1)
    expect(carrier?.file.relPath).toMatch(/^library\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/)
    expect(existsSync(join(root, carrier!.file.relPath))).toBe(true)
    expect(events).toEqual([
      { event: 'carrier/imported', payload: { carrierId: result!.carrierId } },
    ])
  }, 15_000)

  it('同一内容重复导入只保留一份副本', async () => {
    const { root, sqlite, importer } = setup()
    const first = writePdf(root, 'first.pdf', 'Same Content')
    const second = writePdf(root, 'second.pdf', 'Same Content')

    const firstResult = await importer.importFile(first)
    const secondResult = await importer.importFile(second)

    expect(firstResult.status).toBe('ready')
    expect(secondResult.duplicated).toBe(true)
    expect(secondResult.carrierId).toBe(firstResult.carrierId)
    expect(sqlite.carriers.list()).toHaveLength(1)
  })

  it('不支持的扩展名给出明确失败原因', async () => {
    const { root, importer } = setup()
    const textPath = join(root, 'note.txt')
    writeFileSync(textPath, '纯文本')

    const result = await importer.importFile(textPath)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('暂不支持该文件类型')
  })

  it('损坏的 PDF 入库后标记失败并保留可读原因', async () => {
    const { root, sqlite, importer } = setup()
    const brokenPath = join(root, 'broken.pdf')
    writeFileSync(brokenPath, '这不是一个有效的 PDF')

    const result = await importer.importFile(brokenPath)

    expect(result.status).toBe('failed')
    expect(result.carrierId).toBeTruthy()
    expect(sqlite.carriers.get(result.carrierId!)?.status).toBe('failed')
    expect(sqlite.carriers.get(result.carrierId!)?.error).toBeTruthy()
  })

  it('回收站中的载体再次导入时自动恢复', async () => {
    const { root, sqlite, importer } = setup()
    const pdfPath = writePdf(root, 'restore.pdf', 'Restore Me')

    const first = await importer.importFile(pdfPath)
    sqlite.carriers.softDelete(first.carrierId!)

    const second = await importer.importFile(pdfPath)

    expect(second.duplicated).toBe(true)
    expect(second.carrierId).toBe(first.carrierId)
    expect(sqlite.carriers.list()).toHaveLength(1)
  })

  it('网页导入以 HTML 哈希寻址并写入正文页', async () => {
    const article = `<!doctype html><html><head><title>网页导入测试</title></head><body>
      <nav>导航</nav>
      <article><p>${'网页正文用于验证导入链路。'.repeat(80)}</p></article>
    </body></html>`

    const { sqlite, importer } = setup({
      fetchWeb: async () => ({ html: article, finalUrl: 'https://example.com/post' }),
    })

    const result = await importer.importUrl('https://example.com/post')

    expect(result.status).toBe('ready')
    const carrier = sqlite.carriers.get(result.carrierId!)
    expect(carrier?.kind).toBe('web')
    expect(carrier?.sourceUrl).toBe('https://example.com/post')
    expect(carrier?.file.relPath.endsWith('.html')).toBe(true)
    expect(carrier?.pageCount).toBeGreaterThan(0)
  }, 15_000)
})
