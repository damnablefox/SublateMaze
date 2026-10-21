import { useCallback, useEffect, useState } from 'react'
import type {
  AgentEvent,
  AgentStep,
  SessionDetail,
  SessionSummary,
} from '../env'
import { errorText, formatDate } from '../format'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function payloadText(value: unknown): string {
  if (value === undefined) return ''

  try {
    return truncate(JSON.stringify(value, null, 2), 1600)
  } catch {
    return String(value)
  }
}

function statusLabel(status: string): string {
  if (status === 'done') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '进行中'
  return status
}

function statusTone(status: string): string {
  if (status === 'done') return 'tone-success'
  if (status === 'failed') return 'tone-danger'
  if (status === 'running') return 'tone-warning'
  return 'tone-outline'
}

function EventLine({ event }: { event: AgentEvent }) {
  const payload = isRecord(event.payload) ? event.payload : {}

  if (event.type === 'turn') {
    return (
      <div className="agent-line">
        <span className="muted">选择工具</span>
        <span className="agent-tool-name">{String(payload.tool ?? '')}</span>
      </div>
    )
  }

  if (event.type === 'tool_call') {
    return (
      <div className="tool-card">
        <div className="tool-card-head">
          <span className="tag tone-outline">调用工具</span>
          <span className="agent-tool-name">{String(payload.tool ?? '')}</span>
          {payload.confirmed === true ? <span className="tag tone-warning">已确认</span> : null}
        </div>
        <pre className="tool-json">{payloadText(payload.args)}</pre>
      </div>
    )
  }

  if (event.type === 'tool_result') {
    return (
      <div className="tool-result">
        <span className="muted">{String(payload.tool ?? '')} 返回</span>
        <pre className="tool-json">{payloadText(payload.result)}</pre>
      </div>
    )
  }

  if (event.type === 'confirm') {
    return (
      <div className="agent-line">
        <span className="tag tone-warning">等待确认</span>
        <span className="agent-tool-name">{String(payload.tool ?? '')}</span>
      </div>
    )
  }

  if (event.type === 'done') {
    return <div className="agent-answer">{String(payload.answer ?? '')}</div>
  }

  if (event.type === 'error') {
    return <p className="error">{String(payload.message ?? '未知错误')}</p>
  }

  return null
}

export function AgentPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [detail, setDetail] = useState<SessionDetail>()
  const [liveEvents, setLiveEvents] = useState<AgentEvent[]>([])
  const [step, setStep] = useState<AgentStep>()
  const [activeId, setActiveId] = useState('')
  const [activeGoal, setActiveGoal] = useState('')
  const [goal, setGoal] = useState('')
  const [budget, setBudget] = useState('8000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await window.sublate.agent.sessions())
    } catch (reason) {
      setError(`读取会话失败：${errorText(reason)}`)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  function appendEvents(events: AgentEvent[]) {
    if (events.length === 0) return
    setLiveEvents(current => [...current, ...events])
  }

  async function refreshDetail(id: string) {
    try {
      setDetail(await window.sublate.agent.session(id))
    } catch {
      // 历史详情加载失败不阻塞当前对话
    }
  }

  async function drive(initial: AgentStep) {
    let current = initial
    let guard = 0

    try {
      while (current.status === 'running' && guard < 30) {
        current = await window.sublate.agent.step(current.sessionId)
        appendEvents(current.events)
        setStep(current)
        guard += 1
      }
    } catch (reason) {
      setError(`继续执行失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
      await loadSessions()
      await refreshDetail(current.sessionId)
    }
  }

  async function startTask() {
    const text = goal.trim()
    if (!text) return

    try {
      setBusy(true)
      setError(undefined)
      setLiveEvents([])
      setDetail(undefined)
      setStep(undefined)

      const tokens = Number.parseInt(budget, 10)
      const result = await window.sublate.agent.start(
        text,
        Number.isNaN(tokens) || tokens <= 0 ? undefined : tokens,
      )

      setActiveId(result.sessionId)
      setActiveGoal(text)
      appendEvents(result.events)
      setStep(result)
      setGoal('')

      if (result.status === 'running') {
        await drive(result)
      } else {
        setBusy(false)
        await loadSessions()
        await refreshDetail(result.sessionId)
      }
    } catch (reason) {
      setError(`启动助手失败：${errorText(reason)}`)
      setBusy(false)
    }
  }

  async function resolveConfirm(approved: boolean) {
    if (!step?.pending) return

    try {
      setBusy(true)
      setError(undefined)
      const result = await window.sublate.agent.step(step.sessionId, approved)
      appendEvents(result.events)
      setStep(result)

      if (result.status === 'running') {
        await drive(result)
      } else {
        setBusy(false)
        await loadSessions()
        await refreshDetail(result.sessionId)
      }
    } catch (reason) {
      setError(`确认失败：${errorText(reason)}`)
      setBusy(false)
    }
  }

  async function cancelTask() {
    if (!step) return

    try {
      await window.sublate.agent.cancel(step.sessionId)
      setBusy(false)
      await loadSessions()
      await refreshDetail(step.sessionId)
      setStep(undefined)
    } catch (reason) {
      setError(`取消失败：${errorText(reason)}`)
    }
  }

  async function openSession(id: string) {
    try {
      const session = await window.sublate.agent.session(id)
      setActiveId(id)
      setActiveGoal(session.goal)
      setDetail(session)
      setLiveEvents(session.events)
      setStep(undefined)
      setError(undefined)
    } catch (reason) {
      setError(`读取会话失败：${errorText(reason)}`)
    }
  }

  const events = step ? liveEvents : (detail?.events ?? [])
  const status = step?.status === 'confirm' ? '等待确认' : detail?.status

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>助手</h1>
            <p className="page-subtitle">
              用自然语言下达学习任务，助手会调用知识库、复习与计划工具完成任务。
            </p>
          </div>
          {step && step.status !== 'done' && step.status !== 'error' ? (
            <div className="actions">
              <button className="button sm ghost" type="button" onClick={cancelTask}>
                取消任务
              </button>
            </div>
          ) : null}
        </header>

        <div className="agent-composer">
          <input
            className="text-input"
            placeholder="例如：总结今天到期的复习，并推荐下一个要学的知识点"
            value={goal}
            onChange={event => setGoal(event.target.value)}
            aria-label="学习目标"
          />
          <input
            className="page-input"
            value={budget}
            onChange={event => setBudget(event.target.value)}
            aria-label="token 预算"
          />
          <span className="muted">tokens</span>
          <button
            className="button sm primary"
            type="button"
            disabled={busy || !goal.trim()}
            onClick={startTask}
          >
            {busy ? '处理中…' : '开始'}
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="split-layout">
          <aside className="course-rail">
            <button className="button sm ghost" type="button" onClick={loadSessions}>
              刷新会话
            </button>

            {sessions.length > 0 ? (
              <ul className="list">
                {sessions.map(session => (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`course-chip${session.id === activeId ? ' active' : ''}`}
                      onClick={() => openSession(session.id)}
                    >
                      <span className="course-chip-title">{session.title || session.goal}</span>
                      <span className="course-chip-meta">
                        {statusLabel(session.status)} · {session.usedTokens} tokens
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">还没有会话记录</p>
            )}
          </aside>

          <div className="agent-panel">
            {!activeId && !step ? (
              <div className="empty-state">
                <p>还没有进行中的任务</p>
                <span>输入一个学习目标开始；未配置 AI Key 时会给出明确提示。</span>
              </div>
            ) : (
              <>
                <div className="agent-meta">
                  <span className={`tag ${statusTone(status ?? 'running')}`}>
                    {statusLabel(status ?? 'running')}
                  </span>
                  {detail ? (
                    <span className="muted">
                      {formatDate(detail.createdAt)} · {detail.usedTokens}/{detail.budgetTokens} tokens
                    </span>
                  ) : null}
                </div>

                <div className="agent-thread">
                  <div className="agent-message">
                    <span className="muted">目标</span>
                    <p>{detail?.goal || activeGoal}</p>
                  </div>

                  {events.map(event => (
                    <EventLine key={`${event.seq}-${event.type}`} event={event} />
                  ))}

                  {step?.status === 'confirm' && step.pending ? (
                    <div className="confirm-box">
                      <div className="tool-card-head">
                        <span className="tag tone-warning">需要确认</span>
                        <span className="agent-tool-name">{step.pending.tool}</span>
                      </div>
                      <pre className="tool-json">{payloadText(step.pending.args)}</pre>
                      <div className="actions">
                        <button
                          className="button sm primary"
                          type="button"
                          disabled={busy}
                          onClick={() => resolveConfirm(true)}
                        >
                          允许执行
                        </button>
                        <button
                          className="button sm ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => resolveConfirm(false)}
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {step?.error?.includes('AI API Key') ? (
                    <div className="notice">
                      未检测到 AI Key。配置 DEEPSEEK_API_KEY 环境变量后重启应用，再重新开始任务。
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
