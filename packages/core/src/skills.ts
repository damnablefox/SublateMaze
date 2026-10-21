/**
 * Agent 技能库：按学习目标选择预设能力，并收窄可用工具与提示词。
 *
 * 技能只做「建议与聚焦」，不替代 Agent 的安全边界；
 * 所有写操作工具仍需用户确认。
 */

export interface AgentSkill {
  id: string
  title: string
  description: string
  keywords: string[]
  tools: string[]
  prompt: string
  example: string
}

export const AGENT_SKILLS: AgentSkill[] = [
  {
    id: 'extraction',
    title: '知识点抽取',
    description: '读取教材页范围，拆解为知识单元与知识点草稿',
    keywords: ['知识点', '抽取', '拆解', '教材', '整理', 'extract'],
    tools: ['search_library', 'read_carrier', 'draft_knowledge_points'],
    prompt:
      '优先读取指定载体的页范围，再按每批不超过 12 个知识点生成草稿；不得覆盖已确认的知识点，生成后提醒用户人工确认。',
    example: '拆解《线性代数》第一章的知识点并生成草稿',
  },
  {
    id: 'planning',
    title: '学习计划',
    description: '评估掌握度与到期任务，调整每日学习安排',
    keywords: ['计划', '安排', '每天', '进度', '期限', '备考', 'plan'],
    tools: ['analyze_mastery', 'recommend_next', 'update_plan'],
    prompt:
      '先查看掌握度与到期任务，再调整计划；只移动未完成的计划项，任何写入前必须请用户确认。',
    example: '根据我的掌握度安排未来两周的学习计划',
  },
  {
    id: 'review',
    title: '复习教练',
    description: '处理到期卡，解释薄弱知识点并给出自评建议',
    keywords: ['复习', '记忆', '忘记', '自评', '薄弱', '到期', 'review'],
    tools: ['list_due_reviews', 'get_point', 'recommend_next'],
    prompt:
      '优先处理到期卡；解释答案时先给简短提示，再给完整说明，并建议 1–4 的自评等级。',
    example: '帮我复习今天到期的知识点，并解释薄弱的地方',
  },
  {
    id: 'research',
    title: '研究助手',
    description: '检索与阅读知识库，梳理领域脉络并比较资料',
    keywords: ['研究', '专业集', '领域', '综述', '文献', '脉络', 'research'],
    tools: ['search_library', 'read_carrier', 'analyze_mastery'],
    prompt:
      '优先检索与阅读知识库原文，区分资料中的事实与推断，并在回答中给出来源载体与页码。',
    example: '梳理「抽象代数」领域的研究脉络，并比较不同教材的覆盖',
  },
]

/**
 * 按关键词命中数选择技能；无命中或空目标返回 undefined。
 *
 * 命中数相同时保留定义顺序靠前的技能，保证结果确定。
 */
export function selectAgentSkill(goal: string): AgentSkill | undefined {
  const text = goal.trim().toLowerCase()
  if (!text) return undefined

  let best: AgentSkill | undefined
  let bestScore = 0

  for (const skill of AGENT_SKILLS) {
    const score = skill.keywords.reduce(
      (count, keyword) => (text.includes(keyword.toLowerCase()) ? count + 1 : count),
      0,
    )

    if (score > bestScore) {
      best = skill
      bestScore = score
    }
  }

  return best
}
