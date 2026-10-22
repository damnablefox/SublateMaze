import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { libraryRelPath } from '@sublate/core'
import { SetsService } from '@sublate/plugin-sets'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-sets-plugin-'))
  tempDirs.push(dir)
  const sqlite = new SqliteService(join(dir, 'sublate.db'))
  services.push(sqlite)

  const sha256 = 'c'.repeat(64)
  const carrier = sqlite.carriers.create({
    kind: 'pdf',
    title: '群论教材',
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
          { title: '群的定义', content: '内容 A', pageStart: 1, pageEnd: 1 },
          { title: '同态', content: '内容 B', pageStart: 2, pageEnd: 2 },
        ],
      },
    ],
  })

  const points = sqlite.knowledge.listPoints(carrier.id)
  sqlite.knowledge.confirmPoints(points.map(point => point.id))

  return { sqlite, carrier, points, sets: new SetsService({ db: sqlite }) }
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

describe('sets 插件', () => {
  it('创建、更新、删除专业集并返回详情', () => {
    const { sets } = setup()

    const created = sets.create({ title: ' 抽象代数 ', description: '本科' })
    expect(created.set).toMatchObject({ title: '抽象代数', description: '本科' })
    expect(created).toMatchObject({ nodes: [], edges: [] })
    expect(created.degree.totalPoints).toBe(0)

    const updated = sets.update(created.set.id, { title: '近世代数' })
    expect(updated.set.title).toBe('近世代数')
    expect(sets.list()).toMatchObject([{ id: created.set.id, title: '近世代数' }])

    sets.remove(created.set.id)
    expect(sets.list()).toEqual([])
  })

  it('拒绝空标题与超长标题', () => {
    const { sets } = setup()

    expect(() => sets.create({ title: '   ' })).toThrow('专业集标题不能为空')
    expect(() => sets.create({ title: '标'.repeat(101) })).toThrow('不能超过 100 字')
  })

  it('添加知识点与载体，节点去重且可移除', () => {
    const { sets, carrier, points } = setup()
    const set = sets.create({ title: '群论' })

    const detail = sets.addNodes(set.set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'carrier', refId: carrier.id },
    ])

    expect(detail.nodes).toHaveLength(2)
    expect(detail.degree.totalPoints).toBe(2)
    expect(detail.degree.confirmedPoints).toBe(2)
    expect(detail.degree.breadth).toBe(1)

    const again = sets.addNodes(set.set.id, [{ kind: 'point', refId: points[0]!.id }])
    expect(again.nodes).toHaveLength(2)

    const removed = sets.removeNode(set.set.id, detail.nodes[0]!.id)
    expect(removed.nodes).toHaveLength(1)
  })

  it('添加与删除关系，拒绝自环与重复', () => {
    const { sets, points } = setup()
    const set = sets.create({ title: '群论' })
    const detail = sets.addNodes(set.set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'point', refId: points[1]!.id },
    ])
    const [first, second] = detail.nodes

    const withEdge = sets.addEdge(set.set.id, {
      sourceId: first!.id,
      targetId: second!.id,
      kind: 'prereq',
    })
    expect(withEdge.edges).toHaveLength(1)
    expect(withEdge.edges[0]!.kind).toBe('prereq')

    expect(() =>
      sets.addEdge(set.set.id, { sourceId: first!.id, targetId: first!.id, kind: 'related' }),
    ).toThrow('不能让节点指向自己')
    expect(() =>
      sets.addEdge(set.set.id, {
        sourceId: first!.id,
        targetId: second!.id,
        kind: 'prereq',
      }),
    ).toThrow('相同关系已存在')

    const removed = sets.removeEdge(set.set.id, withEdge.edges[0]!.id)
    expect(removed.edges).toEqual([])
  })

  it('载体可以作为相关关系的来源指向知识点', () => {
    const { sets, carrier, points } = setup()
    const set = sets.create({ title: '群论' })
    const detail = sets.addNodes(set.set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'carrier', refId: carrier.id },
    ])

    const point = detail.nodes.find(node => node.kind === 'point')!
    const carrierNode = detail.nodes.find(node => node.kind === 'carrier')!

    const withEdge = sets.addEdge(set.set.id, {
      sourceId: carrierNode.id,
      targetId: point.id,
      kind: 'related',
    })

    expect(withEdge.edges).toHaveLength(1)
    expect(withEdge.edges[0]!.sourceId).toBe(carrierNode.id)
    expect(withEdge.edges[0]!.targetId).toBe(point.id)
  })

  it('前置关系只能从知识点出发，目标必须是知识点', () => {
    const { sets, carrier, points } = setup()
    const set = sets.create({ title: '群论' })
    const detail = sets.addNodes(set.set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'carrier', refId: carrier.id },
    ])

    const point = detail.nodes.find(node => node.kind === 'point')!
    const carrierNode = detail.nodes.find(node => node.kind === 'carrier')!

    expect(() =>
      sets.addEdge(set.set.id, {
        sourceId: carrierNode.id,
        targetId: point.id,
        kind: 'prereq',
      }),
    ).toThrow('前置关系的起点必须是知识点')

    expect(() =>
      sets.addEdge(set.set.id, {
        sourceId: point.id,
        targetId: carrierNode.id,
        kind: 'related',
      }),
    ).toThrow('关系目标必须是知识点')
  })

  it('批量保存画布坐标并返回详情', () => {
    const { sets, points } = setup()
    const set = sets.create({ title: '群论' })
    const detail = sets.addNodes(set.set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'point', refId: points[1]!.id },
    ])

    const updated = sets.updatePositions(
      set.set.id,
      detail.nodes.map((node, index) => ({ nodeId: node.id, x: index * 300, y: index * 120 })),
    )

    expect(updated.nodes.map(node => [node.x, node.y])).toEqual([
      [0, 0],
      [300, 120],
    ])
  })

  it('画布坐标超出范围时拒绝', () => {
    const { sets, points } = setup()
    const set = sets.create({ title: '群论' })
    const detail = sets.addNodes(set.set.id, [{ kind: 'point', refId: points[0]!.id }])

    expect(() =>
      sets.updatePositions(set.set.id, [{ nodeId: detail.nodes[0]!.id, x: 2_000_000, y: 0 }]),
    ).toThrow()
  })

  it('选项返回未删除载体与其知识点', () => {
    const { sets, carrier, points } = setup()

    expect(sets.options()).toEqual({
      carriers: [{ id: carrier.id, title: '群论教材' }],
      points: points.map(point => ({
        id: point.id,
        title: point.title,
        carrierId: carrier.id,
        carrierTitle: '群论教材',
      })),
    })
  })

  it('详情中的研究程度与统计一致', () => {
    const { sets, points } = setup()
    const set = sets.create({ title: '群论' })
    sets.addNodes(set.set.id, points.map(point => ({ kind: 'point' as const, refId: point.id })))

    const detail = sets.detail(set.set.id)
    expect(detail.degree).toMatchObject({
      totalPoints: 2,
      confirmedPoints: 2,
      breadth: 1,
      reviewedPoints: 0,
      mastery: 0,
    })
    expect(detail.degree.score).toBeCloseTo(0.4)
    expect(detail.degree.level).toBe('进阶')
  })

  it('编辑节点别名与备注并校验长度', () => {
    const { sets, points } = setup()
    const set = sets.create({ title: '群论' })
    const detail = sets.addNodes(set.set.id, [{ kind: 'point', refId: points[0]!.id }])
    const node = detail.nodes[0]!

    const updated = sets.updateNode(set.set.id, node.id, {
      alias: ' 群的定义（别名） ',
      note: '备注',
    })
    expect(updated.nodes[0]!.alias).toBe('群的定义（别名）')
    expect(updated.nodes[0]!.note).toBe('备注')

    const cleared = sets.updateNode(set.set.id, node.id, { alias: '', note: '' })
    expect(cleared.nodes[0]!.alias).toBeUndefined()

    expect(() => sets.updateNode(set.set.id, node.id, { alias: 'x'.repeat(101) }))
      .toThrow('节点别名不能超过 100 字')
  })

  it('新增注释并校验坐标与尺寸', () => {
    const { sets } = setup()
    const set = sets.create({ title: '群论' })

    const added = sets.addComment(set.set.id, { x: 10, y: 20, text: '第一章' })
    expect(added.comments).toHaveLength(1)

    const updated = sets.updateComment(set.set.id, added.comments[0]!.id, {
      x: 30,
      width: 420,
      color: 'green',
    })
    expect(updated.comments[0]!.width).toBe(420)
    expect(updated.comments[0]!.color).toBe('green')

    expect(() => sets.addComment(set.set.id, { x: 0, y: 0, width: 20 }))
      .toThrow('注释宽度必须在 80–1200 之间')

    const removed = sets.removeComment(set.set.id, added.comments[0]!.id)
    expect(removed.comments).toEqual([])
  })

  it('切换关系类型并校验端点规则', () => {
    const { sets, carrier, points } = setup()
    const set = sets.create({ title: '群论' })
    const detail = sets.addNodes(set.set.id, [
      { kind: 'point', refId: points[0]!.id },
      { kind: 'point', refId: points[1]!.id },
      { kind: 'carrier', refId: carrier.id },
    ])
    const first = detail.nodes.find(node => node.kind === 'point' && node.refId === points[0]!.id)!
    const second = detail.nodes.find(node => node.kind === 'point' && node.refId === points[1]!.id)!
    const carrierNode = detail.nodes.find(node => node.kind === 'carrier')!

    const withEdge = sets.addEdge(set.set.id, {
      sourceId: first.id,
      targetId: second.id,
      kind: 'prereq',
    })
    const updated = sets.updateEdge(set.set.id, withEdge.edges[0]!.id, 'related')
    expect(updated.edges[0]!.kind).toBe('related')

    const withCarrierEdge = sets.addEdge(set.set.id, {
      sourceId: carrierNode.id,
      targetId: first.id,
      kind: 'related',
    })
    const carrierEdge = withCarrierEdge.edges.find(
      item => item.sourceId === carrierNode.id,
    )!

    expect(() => sets.updateEdge(set.set.id, carrierEdge.id, 'prereq'))
      .toThrow('前置关系的起点必须是知识点')
  })
})
