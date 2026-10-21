import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ParserService } from '@sublate/plugin-parser'
import { createMinimalPdf } from '../fixtures/pdf.ts'

const tempDirs: string[] = []

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-parser-'))
  tempDirs.push(dir)
  return { dir, service: new ParserService(dir) }
}

function buildArticleHtml(): string {
  const paragraphs = [
    '知识载体是学习平台的基础对象。每一个载体都对应一份原始文件，并带有稳定的内容哈希，用于去重与内容寻址。',
    '解析阶段会把 PDF 的每一页文本提取出来，网页则先抓取 HTML，再用正文提取算法去掉导航、广告与脚本，只保留文章主体。',
    '检索阶段使用 SQLite 的全文索引。为了让中文可以按短语匹配，写入索引前会把汉字逐字分开，查询时也做同样的处理。',
    '阅读阶段记录当前页码与页内滚动比例，关闭应用后再次打开仍然回到上次的位置。',
  ]
  const body = paragraphs
    .map(paragraph => `<p>${paragraph.repeat(8)}</p>`)
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
  <head><title>知识库导入与阅读</title></head>
  <body>
    <nav>首页 / 产品 / 关于我们</nav>
    <article>
      <h1>知识库导入与阅读</h1>
      ${body}
    </article>
    <footer>版权所有</footer>
  </body>
</html>`
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('parser', () => {
  it('提取 PDF 逐页文本', async () => {
    const { dir, service } = createService()
    const pdfPath = join(dir, 'sample.pdf')
    writeFileSync(pdfPath, createMinimalPdf('SublateMaze Test Page'))

    const parsed = await service.parsePdf(pdfPath, 'a'.repeat(64))

    expect(parsed.pageCount).toBe(1)
    expect(parsed.pages[0]?.pageNo).toBe(1)
    expect(parsed.pages[0]?.text).toContain('SublateMaze Test Page')
  }, 15_000)

  it('同一哈希命中缓存，原文件删除后仍可返回结果', async () => {
    const { dir, service } = createService()
    const pdfPath = join(dir, 'cached.pdf')
    const sha256 = 'b'.repeat(64)
    writeFileSync(pdfPath, createMinimalPdf('Cache Me'))

    const first = await service.parsePdf(pdfPath, sha256)
    unlinkSync(pdfPath)
    const second = await service.parsePdf(pdfPath, sha256)

    expect(second.pageCount).toBe(first.pageCount)
    expect(second.pages[0]?.text).toBe(first.pages[0]?.text)
  })

  it('网页正文去掉导航与页脚并按长度分页', async () => {
    const { service } = createService()

    const parsed = await service.parseWebHtml(buildArticleHtml(), 'c'.repeat(64))

    expect(parsed.title).toBe('知识库导入与阅读')
    expect(parsed.pageCount).toBeGreaterThan(1)

    const fullText = parsed.pages.map(page => page.text).join('\n')
    expect(fullText).toContain('内容哈希')
    expect(fullText).not.toContain('关于我们')
    expect(fullText).not.toContain('版权所有')
  }, 30_000)

  it('无正文的网页给出明确错误', async () => {
    const { service } = createService()

    await expect(
      service.parseWebHtml('<html><body></body></html>', 'd'.repeat(64)),
    ).rejects.toThrow('未能从网页中提取正文')
  })
})
