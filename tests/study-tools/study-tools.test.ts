import { describe, expect, it } from 'vitest'
import { registerStudyTools, type StudyToolDeps } from '@sublate/plugin-study-tools'
import { ToolsService } from '@sublate/plugin-tools'

function setup() {
  const tools = new ToolsService()
  const calls: string[] = []

  const deps: StudyToolDeps = {
    tools,
    search: {
      query: async (text, options) => [
        {
          carrierId: 'c1',
          title: '载体',
          pageNo: 2,
          snippet: `${text} 的摘要`,
          score: 0.5,
          sources: options?.limit ? ['fts'] : ['fts', 'vector'],
        },
      ],
    },
    db: {
      carriers: {
        get: id =>
          id === 'c1'
            ? { id: 'c1', title: '载体', pageCount: 3 }
            : undefined,
        getPages: (carrierId, from, to) =>
          Array.from({ length: to - from + 1 }, (_, index) => ({
            pageNo: from + index,
            text: `${carrierId} 第 ${from + index} 页`,
          })),
      },
    },
    extractor: {
      extract: async (carrierId) => {
        calls.push(carrierId)
        return { status: 'done', unitCount: 1, pointCount: 2 }
      },
    },
  }

  registerStudyTools(deps)
  return { tools, calls }
}

describe('study-tools', () => {
  it('注册三个工具并声明权限', () => {
    const { tools } = setup()

    const list = tools.list()
    expect(list.map(tool => tool.name).sort()).toEqual([
      'draft_knowledge_points',
      'read_carrier',
      'search_library',
    ])
    expect(list.find(tool => tool.name === 'search_library')?.permission).toBe('read')
    expect(list.find(tool => tool.name === 'read_carrier')?.permission).toBe('read')
    expect(list.find(tool => tool.name === 'draft_knowledge_points')?.permission).toBe('write-draft')
  })

  it('search_library 返回检索结果', async () => {
    const { tools } = setup()

    const hits = (await tools.invoke('search_library', { query: '学习', limit: 5 })) as {
      snippet: string
    }[]

    expect(hits[0]?.snippet).toContain('学习')
  })

  it('read_carrier 返回指定页范围', async () => {
    const { tools } = setup()

    const result = (await tools.invoke('read_carrier', {
      carrierId: 'c1',
      from: 2,
      to: 3,
    })) as { title: string; pages: { pageNo: number; text: string }[] }

    expect(result.title).toBe('载体')
    expect(result.pages.map(page => page.pageNo)).toEqual([2, 3])
  })

  it('draft_knowledge_points 调用抽取且不需要确认', async () => {
    const { tools, calls } = setup()

    const result = await tools.invoke('draft_knowledge_points', { carrierId: 'c1' })

    expect(result).toMatchObject({ status: 'done', pointCount: 2 })
    expect(calls).toEqual(['c1'])
  })

  it('输入校验拒绝空查询', async () => {
    const { tools } = setup()

    await expect(tools.invoke('search_library', { query: '   ' })).rejects.toThrow()
  })
})
