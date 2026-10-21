import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-sets-store-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const sha256 = 'b'.repeat(64)
  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '线性代数教材',
    sha256,
    relPath: libraryRelPath(sha256, 'pdf'),
    mime: 'application/pdf',
    size: 10,
  })

  sqlite.knowledge.replaceDraft(carrier.id, {
    units: [
      {
        title: '第一章',
        points: [
          { title: '向量空间', content: '内容 A', pageStart: 1, pageEnd: 1 },
          { title: '线性映射', content: '内容 B', pageStart: 2, pageEnd: 2 },
          { title: '特征值', content: '内容 C', pageStart: 3, pageEnd: 3 },
        ],
      },
    ],
  })

  const points = sqlite.knowledge.listPoints(carrier.id)
  sqlite.knowledge.confirmPoints(points.slice(0, 2).map(point => point.id))
  const masteryPoint = points[0]!
  sqlite.scheduler.save(masteryPoint.id, {
    stability: 10,
    difficulty: 5,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    reps: 3,
    lapses: 0,
    cardState: 2,
    scheduledDays: 5,
    learningSteps: 0,
    lastReviewedAt: new Date().toISOString(),
    lastRating: 3,
    accuracyEwma: 0.8,
  })

  return { sqlite, carrier, points }
}

afterEach(() => {
  for (const service of services.splice(0)) {
    try {
      service.close()
    } catch {
      // 已关闭
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('storage-sqlite 专业集仓储', () => {
  it('迁移到版本 10，创建、更新与删除集合', () => {
    const { sqlite } = setup()

    expect((sqlite.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(10)

    const set = sqlite.sets.create({ title: '线性代数', description: '本科课程' })
    expect(sqlite.sets.get(set.id)?.title).toBe('线性代数')

    sqlite.sets.update(set.id, { title: '高等线性代数' })
    expect(sqlite.sets.list()).toMatchObject([{ id: set.id, title: '高等线性代数', nodeCount: 0 }])

    sqlite.sets.remove(set.id)
    expect(sqlite.sets.get(set.id)).toBeUndefined()
  })

  it('节点去重并展示知识点与载体信息', () => {
    const { sqlite, carrier, points } = setup()
    const set = sqlite.sets.create({ title: '代数' })

    sqlite.sets.addNodes(set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'point', refId: points[0]!.id },
      { kind: 'carrier', refId: carrier.id },
    ])

    const nodes = sqlite.sets.listNodes(set.id)
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      kind: 'point',
      title: '向量空间',
      subtitle: '知识点 · 线性代数教材',
      status: 'confirmed',
      missing: false,
    })
    expect(nodes[1]).toMatchObject({
      kind: 'carrier',
      title: '线性代数教材',
      subtitle: 'PDF · 0 页',
      missing: false,
    })
  })

  it('统计时载体展开知识点并与直接节点去重', () => {
    const { sqlite, carrier, points } = setup()
    const set = sqlite.sets.create({ title: '代数' })

    sqlite.sets.addNodes(set.id, [
      { kind: 'carrier', refId: carrier.id },
      { kind: 'point', refId: points[2]!.id },
    ])

    const degree = sqlite.sets.researchStats(set.id)
    expect(degree.totalPoints).toBe(3)
    expect(degree.confirmedPoints).toBe(2)
    expect(degree.reviewedPoints).toBe(1)
    expect(degree.breadth).toBeCloseTo(2 / 3)
    expect(degree.depth).toBeCloseTo(1 / 3)
    expect(degree.mastery).toBeCloseTo(0.92 / 3, 2)
  })

  it('集合列表带节点数与综合分', () => {
    const { sqlite, carrier } = setup()
    const set = sqlite.sets.create({ title: '代数' })
    sqlite.sets.addNodes(set.id, [{ kind: 'carrier', refId: carrier.id }])

    const [summary] = sqlite.sets.list()
    expect(summary).toMatchObject({ id: set.id, nodeCount: 1, pointCount: 3 })
    expect(summary!.degree.score).toBeGreaterThan(0)
  })

  it('关系增删、自环与重复被拒绝', () => {
    const { sqlite, points } = setup()
    const set = sqlite.sets.create({ title: '代数' })
    const [first, second] = sqlite.sets.addNodes(set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'point', refId: points[1]!.id },
    ])

    const edge = sqlite.sets.addEdge(set.id, {
      sourceId: first!.id,
      targetId: second!.id,
      kind: 'prereq',
    })
    expect(sqlite.sets.listEdges(set.id)).toMatchObject([{ id: edge.id, kind: 'prereq' }])

    expect(() =>
      sqlite.sets.addEdge(set.id, { sourceId: first!.id, targetId: first!.id, kind: 'related' }),
    ).toThrow('不能让节点指向自己')
    expect(() =>
      sqlite.sets.addEdge(set.id, {
        sourceId: first!.id,
        targetId: second!.id,
        kind: 'prereq',
      }),
    ).toThrow('相同关系已存在')

    sqlite.sets.removeEdge(set.id, edge.id)
    expect(sqlite.sets.listEdges(set.id)).toEqual([])
  })

  it('关系端点必须属于当前集合', () => {
    const { sqlite, points } = setup()
    const first = sqlite.sets.create({ title: '集合 A' })
    const second = sqlite.sets.create({ title: '集合 B' })
    const [node] = sqlite.sets.addNodes(first.id, [{ kind: 'point', refId: points[0]!.id }])
    const [other] = sqlite.sets.addNodes(second.id, [{ kind: 'point', refId: points[1]!.id }])

    expect(() =>
      sqlite.sets.addEdge(first.id, {
        sourceId: node!.id,
        targetId: other!.id,
        kind: 'related',
      }),
    ).toThrow('关系端点必须属于当前专业集')
  })

  it('删除节点时关系级联清理', () => {
    const { sqlite, points } = setup()
    const set = sqlite.sets.create({ title: '代数' })
    const [first, second] = sqlite.sets.addNodes(set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'point', refId: points[1]!.id },
    ])

    sqlite.sets.addEdge(set.id, {
      sourceId: first!.id,
      targetId: second!.id,
      kind: 'related',
    })
    sqlite.sets.removeNode(set.id, first!.id)

    expect(sqlite.sets.listEdges(set.id)).toEqual([])
    expect(sqlite.sets.countNodes(set.id)).toBe(1)
  })

  it('知识点被删除后节点标记缺失且不计入统计', () => {
    const { sqlite, points } = setup()
    const set = sqlite.sets.create({ title: '代数' })
    sqlite.sets.addNodes(set.id, [{ kind: 'point', refId: points[0]!.id }])

    sqlite.db.prepare('DELETE FROM knowledge_points WHERE id = ?').run(points[0]!.id)

    expect(sqlite.sets.listNodes(set.id)[0]).toMatchObject({
      title: '已失效的知识点',
      missing: true,
    })
    expect(sqlite.sets.researchStats(set.id).totalPoints).toBe(0)
  })

  it('载体软删除后标记缺失且其知识点不计入统计', () => {
    const { sqlite, carrier } = setup()
    const set = sqlite.sets.create({ title: '代数' })
    sqlite.sets.addNodes(set.id, [{ kind: 'carrier', refId: carrier.id }])

    sqlite.carriers.softDelete(carrier.id)

    expect(sqlite.sets.listNodes(set.id)[0]).toMatchObject({
      title: '线性代数教材',
      missing: true,
    })
    expect(sqlite.sets.researchStats(set.id).totalPoints).toBe(0)
  })
})
