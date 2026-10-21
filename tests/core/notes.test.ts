import { describe, expect, it } from 'vitest'
import {
  noteExcerpt,
  noteFileSlug,
  normalizeNoteTitle,
  parseWikiLinks,
  serializeNoteFile,
} from '@sublate/core'
import { parse as parseYaml } from 'yaml'

describe('core 笔记工具', () => {
  it('解析 wiki 链接时取目标、别名并去重', () => {
    const links = parseWikiLinks(
      '见 [[线性代数]]、[[线性代数|代数]] 与 [[群论#定义|群]]；忽略 [[ ]] 与 [[|别名]]',
    )

    expect(links).toEqual([
      { target: '线性代数', key: '线性代数', label: '线性代数' },
      { target: '群论', key: '群论', label: '群' },
    ])
  })

  it('标题规范化忽略大小写与多余空白', () => {
    expect(normalizeNoteTitle('  Linear   Algebra ')).toBe('linear algebra')
    expect(normalizeNoteTitle('线性代数')).toBe('线性代数')
  })

  it('文件名保留中文并替换非法字符', () => {
    expect(noteFileSlug('线性代数 / 第一章')).toBe('线性代数-第一章')
    expect(noteFileSlug('  ')).toBe('note')
    expect(noteFileSlug('CON')).toBe('CON-note')
  })

  it('序列化 frontmatter 可被 YAML 解析且正文完整', () => {
    const content = serializeNoteFile(
      {
        id: 'note-1',
        title: '线性代数',
        createdAt: '2026-10-22T08:00:00.000Z',
        updatedAt: '2026-10-22T09:00:00.000Z',
        pointIds: ['point-1'],
        carrierIds: ['carrier-1'],
      },
      '## 要点\n\n向量空间',
    )

    const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
    expect(match).toBeTruthy()

    const frontmatter = parseYaml(match![1]!) as Record<string, unknown>
    expect(frontmatter).toMatchObject({
      sublate_id: 'note-1',
      title: '线性代数',
      points: ['point-1'],
      carriers: ['carrier-1'],
    })
    expect(match![2]).toBe('## 要点\n\n向量空间')
  })

  it('摘要去掉 Markdown 与链接语法并截断', () => {
    expect(noteExcerpt('# 标题\n\n请看 [[线性代数|代数]] 与 **重点**')).toBe('标题 请看 线性代数 与 重点')
    expect(noteExcerpt('一二三四五六', 4)).toBe('一二三四…')
  })
})
