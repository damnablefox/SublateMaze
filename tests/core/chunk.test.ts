import { describe, expect, it } from 'vitest'
import { chunkPages } from '@sublate/core'

describe('chunkPages', () => {
  it('短页生成单块', () => {
    const drafts = chunkPages([{ pageNo: 1, text: '一段短文本' }])

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ pageNo: 1, chunkNo: 1, text: '一段短文本' })
  })

  it('长页按目标长度切块并保留页码与块号', () => {
    const text = '知识'.repeat(1_200)

    const drafts = chunkPages([{ pageNo: 3, text }], 900, 120)

    expect(drafts).toHaveLength(3)
    expect(drafts.map(draft => draft.chunkNo)).toEqual([1, 2, 3])
    expect(drafts.every(draft => draft.pageNo === 3)).toBe(true)
    expect(drafts.every(draft => draft.text.length <= 900)).toBe(true)
  })

  it('相邻块保留重叠内容', () => {
    const text = '知识'.repeat(1_200)

    const drafts = chunkPages([{ pageNo: 1, text }], 900, 120)

    expect(drafts[1]?.text.startsWith(drafts[0]!.text.slice(-120))).toBe(true)
  })

  it('空页被跳过', () => {
    const drafts = chunkPages([
      { pageNo: 1, text: '   ' },
      { pageNo: 2, text: '有效内容' },
    ])

    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.pageNo).toBe(2)
  })
})
