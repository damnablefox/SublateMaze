import { useCallback, useEffect, useState } from 'react'
import type { PlanItem, ReviewStats, TodaySnapshot } from '../env'
import { errorText, formatDayLabel } from '../format'

function pageRange(item: PlanItem): string {
  return item.pageEnd > item.pageStart
    ? `第 ${item.pageStart}–${item.pageEnd} 页`
    : `第 ${item.pageStart} 页`
}

interface TaskListProps {
  items: PlanItem[]
  busy: boolean
  onStatus(id: string, status: 'pending' | 'done' | 'skipped'): void
}

function TaskList({ items, busy, onStatus }: TaskListProps) {
  return (
    <ul className="list">
      {items.map(item => (
        <li key={item.id} className="today-item">
          <input
            type="checkbox"
            className="checkbox"
            checked={item.status === 'done'}
            disabled={busy}
            onChange={() => onStatus(item.id, item.status === 'done' ? 'pending' : 'done')}
            aria-label={`完成 ${item.title}`}
          />

          <div className="row-body">
            <div className="row-title">
              <span className={`row-title-text${item.status === 'done' ? ' is-done' : ''}`}>
                {item.title}
              </span>
              <span className="row-page">{pageRange(item)}</span>
            </div>
            <span className="row-meta">
              {item.courseTitle}
              {item.unitTitle ? ` · ${item.unitTitle}` : ''}
            </span>
          </div>

          {item.status === 'skipped' ? (
            <span className="tag tone-outline">已跳过</span>
          ) : (
            <button
              className="button sm ghost"
              type="button"
              disabled={busy}
              onClick={() => onStatus(item.id, 'skipped')}
            >
              跳过
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function TodayPage({ onOpenReviews }: { onOpenReviews(): void }) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot>()
  const [reviewStats, setReviewStats] = useState<ReviewStats>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const [today, reviews] = await Promise.all([
        window.sublate.planner.today(),
        window.sublate.review.stats(),
      ])
      setSnapshot(today)
      setReviewStats(reviews)
      setError(undefined)
    } catch (reason) {
      setError(`读取今日计划失败：${errorText(reason)}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function updateStatus(id: string, status: 'pending' | 'done' | 'skipped') {
    try {
      setBusy(true)
      setError(undefined)
      await window.sublate.planner.setItemStatus(id, status)
      await refresh()
    } catch (reason) {
      setError(`更新任务失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const due = snapshot?.due ?? []
  const overdue = snapshot?.overdue ?? []

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>今日</h1>
            <p className="page-subtitle">
              {snapshot ? formatDayLabel(snapshot.date) : '按计划推进当天的知识点。'}
            </p>
          </div>
          <div className="actions">
            <button className="button sm ghost" type="button" onClick={refresh} disabled={busy}>
              刷新
            </button>
          </div>
        </header>

        {snapshot ? (
          <div className="knowledge-stats">
            <span className="tag tone-warning">待完成 {snapshot.stats.pending}</span>
            <span className="tag tone-success">已完成 {snapshot.stats.done}</span>
            <span className="tag tone-outline">已跳过 {snapshot.stats.skipped}</span>
            {overdue.length > 0 ? (
              <span className="tag tone-danger">逾期 {overdue.length}</span>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <section className="section">
          <div className="section-head">
            <h2>今日复习</h2>
            <span className="section-count">
              {reviewStats ? `${reviewStats.dueCount + reviewStats.newCount} 张待复习` : ''}
            </span>
          </div>

          {reviewStats && reviewStats.totalPoints > 0 ? (
            <div className="review-banner">
              <div className="row-body">
                <span className="row-title-text">
                  到期 {reviewStats.dueCount} 张 · 新卡 {reviewStats.newCount} 张
                </span>
                <span className="row-meta">
                  今日已复习 {reviewStats.reviewedToday} 张 · 平均掌握{' '}
                  {Math.round(reviewStats.averageMastery * 100)}%
                </span>
              </div>
              <button className="button sm primary" type="button" onClick={onOpenReviews}>
                开始复习
              </button>
            </div>
          ) : (
            <p className="muted empty-hint">确认知识点后，这里会出现复习入口。</p>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>今日任务</h2>
            <span className="section-count">{due.length} 项</span>
          </div>

          {due.length > 0 ? (
            <TaskList items={due} busy={busy} onStatus={updateStatus} />
          ) : (
            <div className="empty-state">
              <p>今天没有安排</p>
              <span>到「课程」页生成学习计划，或享受空闲。</span>
            </div>
          )}
        </section>

        {overdue.length > 0 ? (
          <section className="section">
            <div className="section-head">
              <h2>逾期任务</h2>
              <span className="section-count">{overdue.length} 项</span>
            </div>
            <TaskList items={overdue} busy={busy} onStatus={updateStatus} />
          </section>
        ) : null}
      </div>
    </div>
  )
}
