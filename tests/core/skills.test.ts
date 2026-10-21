import { describe, expect, it } from 'vitest'
import { AGENT_SKILLS, selectAgentSkill } from '@sublate/core'

describe('core Agent 技能库', () => {
  it('按目标关键词选择技能', () => {
    expect(selectAgentSkill('帮我复习今天到期的知识点')?.id).toBe('review')
    expect(selectAgentSkill('根据掌握度安排学习计划')?.id).toBe('planning')
    expect(selectAgentSkill('拆解教材第一章的知识点')?.id).toBe('extraction')
    expect(selectAgentSkill('梳理抽象代数领域的研究脉络')?.id).toBe('research')
  })

  it('没有命中或目标为空时返回 undefined', () => {
    expect(selectAgentSkill('')).toBeUndefined()
    expect(selectAgentSkill('   ')).toBeUndefined()
    expect(selectAgentSkill('你好')).toBeUndefined()
  })

  it('命中数相同时保留定义顺序靠前的技能', () => {
    // 「复习计划」同时命中 planning 的「计划」与 review 的「复习」。
    expect(selectAgentSkill('复习计划')?.id).toBe('planning')
  })

  it('多个关键词命中时选择得分最高的技能', () => {
    expect(selectAgentSkill('安排每天的学习计划与进度')?.id).toBe('planning')
  })

  it('每个技能都有描述、示例与至少两个关键词', () => {
    for (const skill of AGENT_SKILLS) {
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.example.length).toBeGreaterThan(0)
      expect(skill.keywords.length).toBeGreaterThanOrEqual(2)
      expect(skill.tools.length).toBeGreaterThan(0)
    }
  })
})
