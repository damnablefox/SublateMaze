import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReviewCard, ReviewQueue, ReviewResult } from '../env'
import { errorText } from '../format'

const RATINGS: { rating: 1 | 2 | 3 | 4; label: string; hint: string }[] = [
  { rating: 1, label: '重来', hint: '没想起来' },
  { rating: 2, label: '困难', hint: '勉强想起' },
  { rating: 3, label: '良好', hint: '顺利想起' },
  { rating: 4, label: '容易', hint: '非常熟练' },
]

function pageRange(card: ReviewCard): string {
  return card.pageEnd > card.pageStart
    ? `第 ${card.pageStart}–${card.pageEnd} 页`
    : `第 ${card.pageStart} 页`
}

function formatInterval(days: number): string {
  if (days < 1) return '今天稍后'
  if (days < 30) return `${Math.max(1, Math.round(days))} 天后`
  return `${(days / 30).toFixed(1)} 个月后`
}

interface ReviewPageProps {
  onOpenCarrier(carrierId: string, page: number): void
}

export function ReviewPage({ onOpenCarrier }: ReviewPageProps) {
  const [queue, setQueue] = useState<ReviewQueue>()
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [lastResult, setLastResult] = useState<ReviewResult>()

  const cards = useMemo(
    () => [...(queue?.due ?? []), ...(queue?.newCards ?? [])],
    [queue],
  )
  const current: ReviewCard | undefined = cards[index]

  const refresh = useCallback(async () => {
    try {
      setQueue(await window.sublate.review.queue(50))
      setIndex(0)
      setRevealed(false)
      setElapsed(0)
      setError(undefined)
    } catch (reason) {
      setError(`读取复习队列失败：${errorText(reason)}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!revealed || !current) return

    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [revealed, current])

  async function submit(rating: 1 | 2 | 3 | 4) {
    if (!current) return

    try {
      setBusy(true)
      setError(undefined)
      const result = await window.sublate.review.submit(current.pointId, rating)
      setLastResult(result)
      setIndex(value => value + 1)
      setRevealed(false)
      setElapsed(0)

      const stats = await window.sublate.review.stats()
      setQueue(value => (value ? { ...value, stats } : value))
    } catch (reason) {
      setError(`提交自评失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const stats = queue?.stats

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>复习</h1>
            <p className="page-subtitle">先回忆，再翻面自评；FSRS 会根据评分安排下一次复习。</p>
          </div>
          <div className="actions">
            <button className="button sm ghost" type="button" onClick={refresh} disabled={busy}>
              刷新队列
            </button>
          </div>
        </header>

        {stats ? (
          <div className="knowledge-stats">
            <span className="tag tone-warning">待复习 {stats.dueCount}</span>
            <span className="tag tone-outline">新卡 {stats.newCount}</span>
            <span className="tag tone-success">今日已复习 {stats.reviewedToday}</span>
            {stats.totalPoints > 0 ? (
              <span className="tag tone-outline">
                平均掌握 {Math.round(stats.averageMastery * 100)}%
              </span>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        {stats && stats.totalPoints === 0 ? (
          <div className="empty-state">
            <p>还没有已确认的知识点</p>
            <span>先到「知识点」页抽取并确认，复习队列才会出现卡片。</span>
          </div>
        ) : null}

        {stats && stats.totalPoints > 0 && cards.length === 0 ? (
          <div className="review-card review-done">
            <h2>今天的复习已完成</h2>
            <p className="muted">
              已复习 {stats.reviewedToday} 张，平均掌握度 {Math.round(stats.averageMastery * 100)}%。
            </p>
            <button className="button primary" type="button" onClick={refresh} disabled={busy}>
              再检查一次
            </button>
          </div>
        ) : null}

        {current ? (
          <section className="review-stage">
            <span className="review-progress">
              第 {index + 1} / {cards.length} 张 · {current.reps > 0 ? `已复习 ${current.reps} 次` : '新卡'}
            </span>

            <div className="review-card">
              <div className="review-card-head">
                <div className="review-heading">
                  <h2>{current.title}</h2>
                  <span className="row-meta">
                    {current.carrierTitle} · {pageRange(current)}
                  </span>
                </div>
                <button
                  className="button sm ghost"
                  type="button"
                  onClick={() => onOpenCarrier(current.carrierId, current.pageStart)}
                >
                  打开原文
                </button>
              </div>

              {revealed ? (
                <div className="review-body">
                  <p className="review-answer">{current.content}</p>
                  <span className="review-timer">已用时 {elapsed} 秒</span>
                </div>
              ) : (
                <div className="review-hint">
                  <p>先在心里回忆这张卡的内容，再翻面自评。</p>
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => setRevealed(true)}
                    disabled={busy}
                  >
                    显示内容
                  </button>
                </div>
              )}

              {revealed ? (
                <div className="review-ratings">
                  {RATINGS.map(item => (
                    <button
                      key={item.rating}
                      className="rating-button"
                      type="button"
                      disabled={busy}
                      onClick={() => submit(item.rating)}
                    >
                      <span className="rating-label">{item.label}</span>
                      <span className="rating-hint">{item.hint}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {lastResult ? (
              <p className="notice">
                上一张已安排到 {formatInterval(lastResult.intervalDays)}（掌握度{' '}
                {Math.round(lastResult.mastery * 100)}%）。
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
