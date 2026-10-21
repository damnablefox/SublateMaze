import { describe, expect, it } from 'vitest'
import { registerStudyTools, type StudyToolDeps } from '@sublate/plugin-study-tools'
import { ToolsService } from '@sublate/plugin-tools'

const stats = {
  dueCount: 1,
  newCount: 1,
  reviewedToday: 2,
  averageMastery: 0.4,
  totalPoints: 3,
}

const dueCard = {
  pointId: 'p1',
  title: '知识点一',
  content: '知识点一的正文',
  carrierId: 'c1',
  carrierTitle: '线性代数讲义',
  pageStart: 1,
  pageEnd: 2,
  dueAt: '2026-10-21T00:00:00.000Z',
  reps: 1,
  masteryScore: 0.3,
  retrievability: 0.5,
}

const newCard = {
  ...dueCard,
  pointId: 'p2',
  title: '知识点二',
  dueAt: undefined,
  reps: 0,
  masteryScore: 0,
  retrievability: 0,
}

function setup(options: { due?: boolean } = {}) {
  const tools = new ToolsService()
  const calls: string[] = []
  const hasDue = options.due !== false

  const deps: StudyToolDeps = {
    tools,
    search: { query: async () => [] },
    db: {
      carriers: {
        get: () => undefined,
        getPages: () => [],
      },
    },
    extractor: { extract: async () => ({ status: 'done' }) },
    scheduler: {
      queue: () => ({
        due: hasDue ? [dueCard] : [],
        newCards: [newCard],
        stats,
      }),
      overview: () => ({
        stats,
        dailyMinutes: 30,
        budget: { reviewSlots: 1, newSlots: 2, message: '建议复习 1 张' },
        byCarrier: [{ id: 'c1', title: '线性代数讲义', total: 2, learned: 1, mastery: 0.3 }],
        byCourse: [{ id: 'course1', title: '线性代数', total: 2, learned: 1, mastery: 0.3 }],
        distribution: [
          { label: '0–25%', count: 2 },
          { label: '25–50%', count: 0 },
          { label: '50–75%', count: 1 },
          { label: '75–100%', count: 0 },
        ],
      }),
      card: id => (id === 'p1' ? dueCard : id === 'p2' ? newCard : undefined),
      mastery: id =>
        id === 'p1' ? { reps: 1, dueAt: dueCard.dueAt, mastery: 0.3 } : undefined,
    },
    planner: {
      setItemStatus: (id, status) => {
        calls.push(`status:${id}:${status}`)
        return { conflicts: [] }
      },
      moveItem: (id, date) => {
        calls.push(`move:${id}:${date}`)
        return { conflicts: [{ message: '前置在后' }] }
      },
    },
    course: {
      list: () => [{ id: 'course1', title: '线性代数' }],
      listPoints: () => [
        { pointId: 'p1', title: '知识点一', dependsOn: [] },
        { pointId: 'p2', title: '知识点二', dependsOn: ['p1'] },
      ],
    },
  }

  registerStudyTools(deps)
  return { tools, calls }
}

describe('study-tools 学习与复习工具', () => {
  it('注册八个工具并声明权限', () => {
    const { tools } = setup()

    expect(tools.list().map(tool => tool.name).sort()).toEqual([
      'analyze_mastery',
      'draft_knowledge_points',
      'get_point',
      'list_due_reviews',
      'read_carrier',
      'recommend_next',
      'search_library',
      'update_plan',
    ])
    expect(tools.list().find(tool => tool.name === 'list_due_reviews')?.permission).toBe('read')
    expect(tools.list().find(tool => tool.name === 'update_plan')?.permission).toBe('write-commit')
  })

  it('list_due_reviews 返回到期与新卡摘要', async () => {
    const { tools } = setup()

    const result = (await tools.invoke('list_due_reviews', { limit: 5 })) as {
      due: { pointId: string; mastery: number }[]
      newCards: { pointId: string }[]
      stats: { dueCount: number }
    }

    expect(result.due[0]).toMatchObject({ pointId: 'p1', mastery: 0.3 })
    expect(result.newCards[0]?.pointId).toBe('p2')
    expect(result.stats.dueCount).toBe(1)
  })

  it('get_point 返回正文与掌握度，未知 id 报错', async () => {
    const { tools } = setup()

    const point = (await tools.invoke('get_point', { pointId: 'p1' })) as {
      content: string
      mastery: number
    }

    expect(point.content).toContain('正文')
    expect(point.mastery).toBe(0.3)
    await expect(tools.invoke('get_point', { pointId: 'missing' })).rejects.toThrow('知识点不存在')
  })

  it('analyze_mastery 返回分布与载体进度', async () => {
    const { tools } = setup()

    const result = (await tools.invoke('analyze_mastery', {})) as {
      distribution: { label: string; count: number }[]
      byCarrier: { title: string; total: number }[]
    }

    expect(result.distribution).toHaveLength(4)
    expect(result.byCarrier[0]).toMatchObject({ title: '线性代数讲义', total: 2 })
  })

  it('recommend_next 优先到期卡，其次按课程与前置条件推荐', async () => {
    const withDue = setup()
    const dueResult = (await withDue.tools.invoke('recommend_next', {})) as {
      pointId: string
      reason: string
    }

    expect(dueResult.pointId).toBe('p1')
    expect(dueResult.reason).toContain('复习')

    const noDue = setup({ due: false })
    const courseResult = (await noDue.tools.invoke('recommend_next', {})) as {
      pointId: string
      reason: string
    }

    expect(courseResult.pointId).toBe('p2')
    expect(courseResult.reason).toContain('线性代数')
  })

  it('update_plan 未经确认不执行，确认后调用计划服务', async () => {
    const { tools, calls } = setup()

    await expect(tools.invoke('update_plan', { itemId: 'i1', status: 'done' })).rejects.toThrow(
      '需要用户确认',
    )
    expect(calls).toEqual([])

    const result = (await tools.invoke(
      'update_plan',
      { itemId: 'i1', date: '2026-10-25' },
      { confirmed: true },
    )) as { conflicts: string[] }

    expect(calls).toEqual(['move:i1:2026-10-25'])
    expect(result.conflicts).toEqual(['前置在后'])
  })

  it('update_plan 至少需要一个字段', async () => {
    const { tools } = setup()

    await expect(
      tools.invoke('update_plan', { itemId: 'i1' }, { confirmed: true }),
    ).rejects.toThrow('至少提供日期或状态')
  })
})
