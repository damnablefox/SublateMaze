import { describe, expect, it } from 'vitest'
import { layoutSetNodes } from '@sublate/core'

describe('core 专业集画布布局', () => {
  it('按前置关系分层', () => {
    const nodes = [
      { id: 'a', kind: 'point' as const, position: 0 },
      { id: 'b', kind: 'point' as const, position: 1 },
      { id: 'c', kind: 'point' as const, position: 2 },
    ]
    const edges = [
      { sourceId: 'a', targetId: 'b', kind: 'prereq' as const },
      { sourceId: 'b', targetId: 'c', kind: 'prereq' as const },
    ]

    expect(layoutSetNodes(nodes, edges)).toEqual([
      { nodeId: 'a', x: 0, y: 0 },
      { nodeId: 'b', x: 360, y: 0 },
      { nodeId: 'c', x: 720, y: 0 },
    ])
  })

  it('同层按 position 排列并使用行间距', () => {
    const nodes = [
      { id: 'a', kind: 'point' as const, position: 0 },
      { id: 'b', kind: 'point' as const, position: 2 },
      { id: 'c', kind: 'point' as const, position: 1 },
    ]

    expect(layoutSetNodes(nodes, [])).toEqual([
      { nodeId: 'a', x: 0, y: 0 },
      { nodeId: 'c', x: 0, y: 132 },
      { nodeId: 'b', x: 0, y: 264 },
    ])
  })

  it('相关关系不影响分层', () => {
    const nodes = [
      { id: 'a', kind: 'point' as const, position: 0 },
      { id: 'b', kind: 'point' as const, position: 1 },
    ]

    expect(
      layoutSetNodes(nodes, [{ sourceId: 'a', targetId: 'b', kind: 'related' }]),
    ).toEqual([
      { nodeId: 'a', x: 0, y: 0 },
      { nodeId: 'b', x: 0, y: 132 },
    ])
  })

  it('环中的节点仍有坐标且不丢失节点', () => {
    const nodes = [
      { id: 'a', kind: 'point' as const, position: 0 },
      { id: 'b', kind: 'point' as const, position: 1 },
      { id: 'c', kind: 'point' as const, position: 2 },
    ]
    const edges = [
      { sourceId: 'a', targetId: 'b', kind: 'prereq' as const },
      { sourceId: 'b', targetId: 'a', kind: 'prereq' as const },
    ]

    const positions = layoutSetNodes(nodes, edges)
    expect(positions).toHaveLength(3)
    expect(positions.every(position => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true)
  })

  it('空输入返回空数组', () => {
    expect(layoutSetNodes([], [])).toEqual([])
  })

  it('载体与知识点一起排布，忽略不存在的边端点', () => {
    const nodes = [
      { id: 'a', kind: 'carrier' as const, position: 0 },
      { id: 'b', kind: 'point' as const, position: 1 },
    ]

    const positions = layoutSetNodes(nodes, [
      { sourceId: 'a', targetId: 'missing', kind: 'prereq' },
    ])

    expect(positions).toEqual([
      { nodeId: 'a', x: 0, y: 0 },
      { nodeId: 'b', x: 0, y: 132 },
    ])
  })

  it('支持自定义间距与原点', () => {
    const nodes = [
      { id: 'a', kind: 'point' as const, position: 0 },
      { id: 'b', kind: 'point' as const, position: 1 },
    ]

    expect(
      layoutSetNodes(
        nodes,
        [{ sourceId: 'a', targetId: 'b', kind: 'prereq' }],
        { columnGap: 200, rowGap: 80, originX: 40, originY: 20 },
      ),
    ).toEqual([
      { nodeId: 'a', x: 40, y: 20 },
      { nodeId: 'b', x: 240, y: 20 },
    ])
  })
})
