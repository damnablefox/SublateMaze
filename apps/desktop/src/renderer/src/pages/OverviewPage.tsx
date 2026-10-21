import { useCallback, useEffect, useState } from 'react'
import type { ReviewOverview, ScopeProgress } from '../env'
import { errorText } from '../format'

function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

function ProgressRow({ item }: { item: ScopeProgress }) {
  return (
    <li className="progress-row">
      <div className="row-body">
        <div className="row-title">
          <span className="row-title-text">{item.title}</span>
          <span className="row-page">{percent(item.mastery)}</span>
        </div>
        <div className="progress-track">
          <span className="progress-fill" style={{ width: percent(item.mastery) }} />
        </div>
        <span className="row-meta">
          已复习 {item.learned} / {item.total} 个知识点
        </span>
      </div>
    </li>
  )
}

export function OverviewPage() {
  const [overview, setOverview] = useState<ReviewOverview>()
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      setOverview(await window.sublate.review.overview())
      setError(undefined)
    } catch (reason) {
      setError(`读取进度失败：${errorText(reason)}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const stats = overview?.stats
  const total = stats?.totalPoints ?? 0

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>进度</h1>
            <p className="page-subtitle">掌握度、载体消化与每日预算一览。</p>
          </div>
          <div className="actions">
            <button className="button sm ghost" type="button" onClick={refresh}>
              刷新
            </button>
          </div>
        </header>

        {stats ? (
          <div className="knowledge-stats">
            <span className="tag tone-outline">已确认 {stats.totalPoints}</span>
            <span className="tag tone-success">今日已复习 {stats.reviewedToday}</span>
            <span className="tag tone-warning">到期 {stats.dueCount}</span>
            <span className="tag tone-outline">新卡 {stats.newCount}</span>
            <span className="tag tone-outline">平均掌握 {percent(stats.averageMastery)}</span>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        {stats && stats.totalPoints === 0 ? (
          <div className="empty-state">
            <p>还没有已确认的知识点</p>
            <span>先到「知识点」页确认知识点，进度与预算会随之出现。</span>
          </div>
        ) : null}

        {overview && stats && stats.totalPoints > 0 ? (
          <>
            <section className="course-card">
              <div className="course-card-head">
                <h3>今日预算</h3>
                <span className="section-count">每日 {overview.dailyMinutes} 分钟</span>
              </div>
              <p className="page-subtitle">{overview.budget.message}</p>
              <div className="metric-grid">
                <div className="metric">
                  <span className="metric-value">{overview.budget.reviewSlots}</span>
                  <span className="metric-label">
                    建议复习 · {overview.budget.reviewMinutes} 分钟
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-value">{overview.budget.newSlots}</span>
                  <span className="metric-label">建议新学 · {overview.budget.newMinutes} 分钟</span>
                </div>
                <div className="metric">
                  <span className="metric-value">{Math.round(overview.budget.reserveMinutes)}</span>
                  <span className="metric-label">预留缓冲 · 分钟</span>
                </div>
              </div>
            </section>

            <section className="course-card">
              <div className="course-card-head">
                <h3>掌握度分布</h3>
                <span className="section-count">{total} 个知识点</span>
              </div>
              <div className="distribution">
                {overview.distribution.map((bucket) => {
                  const ratio = total > 0 ? bucket.count / total : 0
                  return (
                    <div key={bucket.label} className="distribution-row">
                      <span className="distribution-label">{bucket.label}</span>
                      <div className="progress-track">
                        <span className="progress-fill" style={{ width: `${ratio * 100}%` }} />
                      </div>
                      <span className="distribution-count">{bucket.count}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            <div className="overview-columns">
              <section className="course-card">
                <div className="course-card-head">
                  <h3>载体消化</h3>
                  <span className="section-count">{overview.byCarrier.length} 个载体</span>
                </div>
                {overview.byCarrier.length > 0 ? (
                  <ul className="list">
                    {overview.byCarrier.map(item => (
                      <ProgressRow key={item.id} item={item} />
                    ))}
                  </ul>
                ) : (
                  <p className="muted">还没有已确认知识点的载体。</p>
                )}
              </section>

              <section className="course-card">
                <div className="course-card-head">
                  <h3>课程进度</h3>
                  <span className="section-count">{overview.byCourse.length} 门课程</span>
                </div>
                {overview.byCourse.length > 0 ? (
                  <ul className="list">
                    {overview.byCourse.map(item => (
                      <ProgressRow key={item.id} item={item} />
                    ))}
                  </ul>
                ) : (
                  <p className="muted">还没有编排知识点的课程。</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
