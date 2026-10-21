import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AvailablePoint,
  CourseDetail,
  CoursePoint,
  CourseSummary,
  Goal,
  PlanDetail,
  PlanItem,
  PlanSummary,
} from '../env'
import { errorText, formatDayLabel } from '../format'

function pageRange(point: { pageStart: number; pageEnd: number }): string {
  return point.pageEnd > point.pageStart
    ? `第 ${point.pageStart}–${point.pageEnd} 页`
    : `第 ${point.pageStart} 页`
}

function sortPoints(points: CoursePoint[]): CoursePoint[] {
  return [...points].sort((left, right) => left.position - right.position)
}

interface UnitGroup {
  unitId: string
  title: string
  points: CoursePoint[]
}

function groupPoints(detail: CourseDetail): UnitGroup[] {
  const groups: UnitGroup[] = detail.units.map(unit => ({
    unitId: unit.id,
    title: unit.title,
    points: sortPoints(detail.points.filter(point => point.unitId === unit.id)),
  }))
  const ungrouped = sortPoints(detail.points.filter(point => !point.unitId))

  if (ungrouped.length > 0) {
    groups.push({ unitId: 'ungrouped', title: '未分组', points: ungrouped })
  }

  return groups
}

interface PlanDay {
  date: string
  items: PlanItem[]
}

function groupPlanItems(items: PlanItem[]): PlanDay[] {
  const grouped = new Map<string, PlanItem[]>()

  for (const item of items) {
    const list = grouped.get(item.date) ?? []
    list.push(item)
    grouped.set(item.date, list)
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, list]) => ({
      date,
      items: [...list].sort((left, right) => left.position - right.position),
    }))
}

interface PointRowProps {
  point: CoursePoint
  candidates: CoursePoint[]
  busy: boolean
  first: boolean
  last: boolean
  onRemove(): void
  onDepends(dependsOn: string[]): void
  onMove(direction: -1 | 1): void
}

function PointRow({ point, candidates, busy, first, last, onRemove, onDepends, onMove }: PointRowProps) {
  return (
    <li className="course-point-row">
      <div className="row-body">
        <div className="row-title">
          <span className="row-title-text">{point.title}</span>
          <span className="row-page">{pageRange(point)}</span>
        </div>
        <div className="field-row inline">
          <span className="muted">前置</span>
          <select
            className="select sm"
            value={point.dependsOn[0] ?? ''}
            disabled={busy}
            onChange={event => onDepends(event.target.value ? [event.target.value] : [])}
            aria-label={`${point.title} 的前置知识点`}
          >
            <option value="">无</option>
            {candidates.map(candidate => (
              <option key={candidate.pointId} value={candidate.pointId}>
                {candidate.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="point-actions">
        <button
          className="button sm ghost"
          type="button"
          disabled={busy || first}
          onClick={() => onMove(-1)}
        >
          上移
        </button>
        <button
          className="button sm ghost"
          type="button"
          disabled={busy || last}
          onClick={() => onMove(1)}
        >
          下移
        </button>
        <button className="button sm ghost" type="button" disabled={busy} onClick={onRemove}>
          移除
        </button>
      </div>
    </li>
  )
}

export function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<CourseDetail>()
  const [goals, setGoals] = useState<Goal[]>([])
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [planId, setPlanId] = useState('')
  const [planDetail, setPlanDetail] = useState<PlanDetail>()
  const [available, setAvailable] = useState<AvailablePoint[]>([])

  const [newCourseTitle, setNewCourseTitle] = useState('')
  const [newUnitTitle, setNewUnitTitle] = useState('')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [goalMinutes, setGoalMinutes] = useState('')
  const [generateDays, setGenerateDays] = useState('30')
  const [replanText, setReplanText] = useState('')
  const [dailyText, setDailyText] = useState('30')
  const [addUnitId, setAddUnitId] = useState('')
  const [selectedPoints, setSelectedPoints] = useState<Set<string>>(new Set())

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()

  const loadCourses = useCallback(async (preferredId?: string) => {
    const list = await window.sublate.course.list()
    setCourses(list)
    setSelectedId((current) => {
      if (preferredId && list.some(course => course.id === preferredId)) return preferredId
      if (list.some(course => course.id === current)) return current
      return list[0]?.id ?? ''
    })
  }, [])

  const loadCourse = useCallback(async (id: string, preferredPlanId?: string) => {
    if (!id) {
      setDetail(undefined)
      setGoals([])
      setPlans([])
      setPlanId('')
      setPlanDetail(undefined)
      setAvailable([])
      return
    }

    const [courseDetail, goalList, planList, availableList] = await Promise.all([
      window.sublate.course.detail(id),
      window.sublate.planner.goals(id),
      window.sublate.planner.plans(id),
      window.sublate.course.availablePoints(id),
    ])

    const nextPlanId =
      preferredPlanId && planList.some(plan => plan.id === preferredPlanId)
        ? preferredPlanId
        : (planList[0]?.id ?? '')

    setDetail(courseDetail)
    setGoals(goalList)
    setPlans(planList)
    setAvailable(availableList)
    setSelectedPoints(new Set())
    setPlanId(nextPlanId)
    setPlanDetail(nextPlanId ? await window.sublate.planner.planDetail(nextPlanId) : undefined)
    setDailyText(String(courseDetail.course.dailyMinutes))
    setReplanText(
      nextPlanId
        ? String(planList.find(plan => plan.id === nextPlanId)?.dailyMinutes ?? courseDetail.course.dailyMinutes)
        : '',
    )
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await loadCourses()
      } catch (reason) {
        setError(`读取课程失败：${errorText(reason)}`)
      }
    })()
  }, [loadCourses])

  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined)
      setPlans([])
      setPlanDetail(undefined)
      return
    }

    void (async () => {
      try {
        await loadCourse(selectedId)
        setError(undefined)
      } catch (reason) {
        setError(`读取课程详情失败：${errorText(reason)}`)
      }
    })()
  }, [selectedId, loadCourse])

  const unitGroups = useMemo(() => (detail ? groupPoints(detail) : []), [detail])
  const planDays = useMemo(() => (planDetail ? groupPlanItems(planDetail.items) : []), [planDetail])

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      await action()
      setMessage(done)
      await loadCourses(selectedId)
      await loadCourse(selectedId, planId)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  async function createCourse() {
    const title = newCourseTitle.trim()
    if (!title) return

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      const course = await window.sublate.course.create(title)
      setNewCourseTitle('')
      setMessage('课程已创建')
      await loadCourses(course.id)
    } catch (reason) {
      setError(`创建课程失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeCourse(id: string) {
    if (!window.confirm('删除课程会一并删除它的单元、计划与目标，确定继续？')) return

    try {
      setBusy(true)
      setError(undefined)
      await window.sublate.course.remove(id)
      setMessage('课程已删除')
      await loadCourses()
    } catch (reason) {
      setError(`删除课程失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function saveDailyMinutes() {
    if (!detail) return

    const minutes = Number.parseInt(dailyText, 10)
    if (Number.isNaN(minutes) || minutes <= 0) {
      setDailyText(String(detail.course.dailyMinutes))
      setError('每日学习分钟必须是正整数')
      return
    }

    if (minutes === detail.course.dailyMinutes) return

    await run(() => window.sublate.course.update(detail.course.id, { dailyMinutes: minutes }), '每日时长已保存')
  }

  async function createUnit() {
    const title = newUnitTitle.trim()
    if (!title || !detail) return

    setNewUnitTitle('')
    await run(() => window.sublate.course.createUnit(detail.course.id, title), '单元已添加')
  }

  async function removeUnit(unitId: string) {
    if (!window.confirm('删除单元后，其中的知识点会变成未分组，确定继续？')) return
    await run(() => window.sublate.course.removeUnit(unitId), '单元已删除')
  }

  async function createGoal() {
    if (!detail) return

    const title = goalTitle.trim()
    if (!title) {
      setError('目标标题不能为空')
      return
    }

    const minutes = Number.parseInt(goalMinutes, 10)

    try {
      setBusy(true)
      setError(undefined)
      await window.sublate.planner.createGoal(
        detail.course.id,
        title,
        goalDate || undefined,
        Number.isNaN(minutes) ? undefined : minutes,
      )
      setGoalTitle('')
      setGoalDate('')
      setGoalMinutes('')
      setMessage('目标已添加')
      await loadCourse(detail.course.id, planId)
    } catch (reason) {
      setError(`添加目标失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeGoal(id: string) {
    if (!detail) return
    await run(() => window.sublate.planner.deleteGoal(id), '目标已删除')
  }

  async function generatePlan() {
    if (!detail || detail.points.length === 0) {
      setError('课程还没有编排知识点，先添加已确认的知识点')
      return
    }

    const days = Number.parseInt(generateDays, 10)

    try {
      setBusy(true)
      setError(undefined)
      setMessage(undefined)
      const result = await window.sublate.planner.generatePlan({
        courseId: detail.course.id,
        goalId: goals[0]?.id,
        days: Number.isNaN(days) || days <= 0 ? 30 : days,
      })
      setMessage(result.message ?? `计划已生成：${result.plan.days} 天，${result.items.length} 项`)
      await loadCourses(selectedId)
      await loadCourse(detail.course.id, result.plan.id)
    } catch (reason) {
      setError(`生成计划失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function selectPlan(id: string) {
    setPlanId(id)

    if (!id) {
      setPlanDetail(undefined)
      return
    }

    try {
      const next = await window.sublate.planner.planDetail(id)
      setPlanDetail(next)
      setReplanText(String(next.plan.dailyMinutes))
    } catch (reason) {
      setError(`读取计划失败：${errorText(reason)}`)
    }
  }

  async function replanPlan() {
    if (!planDetail) return

    const minutes = Number.parseInt(replanText, 10)
    if (Number.isNaN(minutes) || minutes <= 0) {
      setError('每日分钟必须是正整数')
      return
    }

    try {
      setBusy(true)
      setError(undefined)
      const next = await window.sublate.planner.replan(planDetail.plan.id, minutes)
      setPlanDetail(next)
      setPlans(await window.sublate.planner.plans(selectedId))
      setMessage('已按新时长重排，已完成与已跳过的记录保持不动')
    } catch (reason) {
      setError(`重排失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function removePlan() {
    if (!planDetail) return
    if (!window.confirm('删除计划不会删除课程与知识点，确定继续？')) return

    try {
      setBusy(true)
      const id = planDetail.plan.id
      await window.sublate.planner.deletePlan(id)
      setMessage('计划已删除')
      await loadCourse(selectedId)
    } catch (reason) {
      setError(`删除计划失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function updateItem(id: string, status: 'pending' | 'done' | 'skipped') {
    try {
      setBusy(true)
      setError(undefined)
      const next = await window.sublate.planner.setItemStatus(id, status)
      setPlanDetail(next)
      setPlans(await window.sublate.planner.plans(selectedId))
    } catch (reason) {
      setError(`更新任务失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function moveItem(id: string, date: string) {
    if (!date) return

    try {
      setBusy(true)
      setError(undefined)
      const next = await window.sublate.planner.moveItem(id, date)
      setPlanDetail(next)
      setPlans(await window.sublate.planner.plans(selectedId))
    } catch (reason) {
      setError(`调整日期失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  async function addPoints() {
    if (!detail || selectedPoints.size === 0) return

    const ids = [...selectedPoints]
    await run(
      () => window.sublate.course.addPoints(detail.course.id, addUnitId || null, ids),
      `已添加 ${ids.length} 个知识点`,
    )
  }

  async function movePoint(group: UnitGroup, index: number, direction: -1 | 1) {
    const current = group.points[index]
    const target = group.points[index + direction]
    if (!current || !target) return

    await run(async () => {
      await window.sublate.course.movePoint(current.id, { position: target.position })
      await window.sublate.course.movePoint(target.id, { position: current.position })
    }, '顺序已调整')
  }

  function togglePoint(id: string) {
    setSelectedPoints((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1>课程</h1>
            <p className="page-subtitle">把已确认的知识点编排成课程，设定目标并生成每日计划。</p>
          </div>
        </header>

        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="split-layout">
          <aside className="course-rail">
            <div className="course-rail-form">
              <input
                className="text-input"
                placeholder="新课程标题"
                value={newCourseTitle}
                onChange={event => setNewCourseTitle(event.target.value)}
              />
              <button
                className="button sm"
                type="button"
                disabled={!newCourseTitle.trim() || busy}
                onClick={createCourse}
              >
                新建
              </button>
            </div>

            {courses.length > 0 ? (
              <ul className="list">
                {courses.map(course => (
                  <li key={course.id}>
                    <button
                      type="button"
                      className={`course-chip${course.id === selectedId ? ' active' : ''}`}
                      onClick={() => setSelectedId(course.id)}
                    >
                      <span className="course-chip-title">{course.title}</span>
                      <span className="course-chip-meta">
                        {course.unitCount} 单元 · {course.pointCount} 知识点
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">还没有课程，先创建一个。</p>
            )}
          </aside>

          <div className="course-panel">
            {!detail ? (
              <div className="empty-state">
                <p>还没有选中课程</p>
                <span>在左侧新建课程，或从「知识点」页确认知识点后再来编排。</span>
              </div>
            ) : (
              <>
                <div className="course-head">
                  <div>
                    <h2 className="course-title">{detail.course.title}</h2>
                    {detail.course.description ? (
                      <p className="muted">{detail.course.description}</p>
                    ) : null}
                  </div>
                  <div className="actions">
                    <label className="inline-field">
                      <span className="muted">每日</span>
                      <input
                        className="page-input"
                        value={dailyText}
                        onChange={event => setDailyText(event.target.value)}
                        onBlur={saveDailyMinutes}
                        aria-label="每日学习分钟"
                      />
                      <span className="muted">分钟</span>
                    </label>
                    <button
                      className="button sm ghost danger-text"
                      type="button"
                      disabled={busy}
                      onClick={() => removeCourse(detail.course.id)}
                    >
                      删除课程
                    </button>
                  </div>
                </div>

                <section className="course-card">
                  <div className="course-card-head">
                    <h3>学习目标</h3>
                    <span className="section-count">{goals.length} 个</span>
                  </div>

                  {goals.length > 0 ? (
                    <ul className="list">
                      {goals.map(goal => (
                        <li key={goal.id} className="goal-row">
                          <div className="row-body">
                            <div className="row-title">
                              <span className="row-title-text">{goal.title}</span>
                              {goal.targetDate ? (
                                <span className="row-page">截止 {goal.targetDate}</span>
                              ) : null}
                            </div>
                            <span className="row-meta">
                              {goal.dailyMinutes
                                ? `每日 ${goal.dailyMinutes} 分钟`
                                : '继承课程每日时长'}
                            </span>
                          </div>
                          <button
                            className="button sm ghost"
                            type="button"
                            disabled={busy}
                            onClick={() => removeGoal(goal.id)}
                          >
                            删除
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">还没有目标，可以直接用课程默认时长生成计划。</p>
                  )}

                  <div className="field-row goal-form">
                    <input
                      className="text-input"
                      placeholder="目标标题"
                      value={goalTitle}
                      onChange={event => setGoalTitle(event.target.value)}
                    />
                    <input
                      className="text-input"
                      type="date"
                      value={goalDate}
                      onChange={event => setGoalDate(event.target.value)}
                      aria-label="目标日期"
                    />
                    <input
                      className="page-input"
                      placeholder="分钟"
                      value={goalMinutes}
                      onChange={event => setGoalMinutes(event.target.value)}
                      aria-label="目标每日分钟"
                    />
                    <button
                      className="button sm outline"
                      type="button"
                      disabled={!goalTitle.trim() || busy}
                      onClick={createGoal}
                    >
                      添加目标
                    </button>
                  </div>
                </section>

                <section className="course-card">
                  <div className="course-card-head">
                    <h3>学习计划</h3>
                    <div className="actions">
                      <input
                        className="page-input"
                        value={generateDays}
                        onChange={event => setGenerateDays(event.target.value)}
                        aria-label="计划天数"
                      />
                      <span className="muted">天</span>
                      <button
                        className="button sm primary"
                        type="button"
                        disabled={busy || detail.points.length === 0}
                        onClick={generatePlan}
                      >
                        生成计划
                      </button>
                    </div>
                  </div>

                  {plans.length > 0 ? (
                    <>
                      <div className="field-row">
                        <select
                          className="select"
                          value={planId}
                          onChange={event => selectPlan(event.target.value)}
                          aria-label="选择计划"
                        >
                          {plans.map(plan => (
                            <option key={plan.id} value={plan.id}>
                              {plan.startDate} · {plan.days} 天 · 已完成 {plan.doneCount}/{plan.itemCount}
                            </option>
                          ))}
                        </select>
                        <input
                          className="page-input"
                          value={replanText}
                          onChange={event => setReplanText(event.target.value)}
                          aria-label="重排每日分钟"
                        />
                        <span className="muted">分钟/天</span>
                        <button
                          className="button sm outline"
                          type="button"
                          disabled={busy || !planDetail}
                          onClick={replanPlan}
                        >
                          重排未完成
                        </button>
                        <button
                          className="button sm ghost"
                          type="button"
                          disabled={busy || !planDetail}
                          onClick={removePlan}
                        >
                          删除计划
                        </button>
                      </div>

                      {planDetail && planDetail.conflicts.length > 0 ? (
                        <div className="conflict-box">
                          {planDetail.conflicts.map((conflict, index) => (
                            <p key={`${conflict.pointId}-${index}`} className="conflict">
                              {conflict.message}
                            </p>
                          ))}
                        </div>
                      ) : null}

                      {planDetail && planDays.length > 0 ? (
                        <div className="plan-days">
                          {planDays.map(day => (
                            <div key={day.date} className="plan-day">
                              <div className="plan-day-head">
                                <h4>{formatDayLabel(day.date)}</h4>
                                <span className="section-count">{day.items.length} 项</span>
                              </div>

                              <ul className="list">
                                {day.items.map(item => (
                                  <li key={item.id} className="plan-item">
                                    <input
                                      type="checkbox"
                                      className="checkbox"
                                      checked={item.status === 'done'}
                                      disabled={busy}
                                      onChange={() =>
                                        updateItem(
                                          item.id,
                                          item.status === 'done' ? 'pending' : 'done',
                                        )
                                      }
                                      aria-label={`完成 ${item.title}`}
                                    />

                                    <div className="row-body">
                                      <div className="row-title">
                                        <span
                                          className={`row-title-text${item.status === 'done' ? ' is-done' : ''}`}
                                        >
                                          {item.title}
                                        </span>
                                        <span className="row-page">{pageRange(item)}</span>
                                      </div>
                                      <span className="row-meta">{item.unitTitle ?? '未分组'}</span>
                                    </div>

                                    <input
                                      type="date"
                                      className="date-input"
                                      value={item.date}
                                      disabled={busy}
                                      onChange={event => moveItem(item.id, event.target.value)}
                                      aria-label="调整日期"
                                    />

                                    {item.status === 'skipped' ? (
                                      <span className="tag tone-outline">已跳过</span>
                                    ) : (
                                      <button
                                        className="button sm ghost"
                                        type="button"
                                        disabled={busy}
                                        onClick={() => updateItem(item.id, 'skipped')}
                                      >
                                        跳过
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">这个计划还没有任务项。</p>
                      )}
                    </>
                  ) : (
                    <p className="muted">还没有计划。生成后到「今日」页查看当天任务。</p>
                  )}
                </section>

                <section className="course-card">
                  <div className="course-card-head">
                    <h3>单元与知识点</h3>
                    <div className="actions">
                      <input
                        className="text-input"
                        placeholder="新单元标题"
                        value={newUnitTitle}
                        onChange={event => setNewUnitTitle(event.target.value)}
                      />
                      <button
                        className="button sm outline"
                        type="button"
                        disabled={!newUnitTitle.trim() || busy}
                        onClick={createUnit}
                      >
                        添加单元
                      </button>
                    </div>
                  </div>

                  {unitGroups.length === 0 ? (
                    <p className="muted">还没有单元，也可以在下方把知识点添加到「未分组」。</p>
                  ) : (
                    unitGroups.map(group => (
                      <div key={group.unitId} className="unit-block">
                        <div className="unit-head">
                          <h2>{group.title}</h2>
                          {group.unitId === 'ungrouped' ? (
                            <span className="unit-range">{group.points.length} 个</span>
                          ) : (
                            <button
                              className="button sm ghost"
                              type="button"
                              disabled={busy}
                              onClick={() => removeUnit(group.unitId)}
                            >
                              删除单元
                            </button>
                          )}
                        </div>

                        {group.points.length > 0 ? (
                          <ul className="list">
                            {group.points.map((point, index) => (
                              <PointRow
                                key={point.id}
                                point={point}
                                candidates={detail.points.filter(
                                  candidate => candidate.pointId !== point.pointId,
                                )}
                                busy={busy}
                                first={index === 0}
                                last={index === group.points.length - 1}
                                onRemove={() =>
                                  run(
                                    () => window.sublate.course.removePoints([point.id]),
                                    `已移除「${point.title}」`,
                                  )
                                }
                                onDepends={dependsOn =>
                                  run(
                                    () => window.sublate.course.setDepends(point.id, dependsOn),
                                    '前置关系已更新',
                                  )
                                }
                                onMove={direction => movePoint(group, index, direction)}
                              />
                            ))}
                          </ul>
                        ) : (
                          <p className="muted empty-hint">单元还没有知识点</p>
                        )}
                      </div>
                    ))
                  )}

                  <div className="available-box">
                    <div className="field-row">
                      <span className="muted">添加到</span>
                      <select
                        className="select sm"
                        value={addUnitId}
                        onChange={event => setAddUnitId(event.target.value)}
                        aria-label="选择目标单元"
                      >
                        <option value="">未分组</option>
                        {detail.units.map(unit => (
                          <option key={unit.id} value={unit.id}>
                            {unit.title}
                          </option>
                        ))}
                      </select>
                      <button
                        className="button sm"
                        type="button"
                        disabled={selectedPoints.size === 0 || busy}
                        onClick={addPoints}
                      >
                        添加所选
                      </button>
                      <span className="muted">可选 {available.length} 个已确认知识点</span>
                    </div>

                    {available.length > 0 ? (
                      <div className="available-list">
                        {available.map(point => (
                          <label key={point.id} className="available-row">
                            <input
                              type="checkbox"
                              className="checkbox"
                              checked={selectedPoints.has(point.id)}
                              onChange={() => togglePoint(point.id)}
                            />
                            <span className="row-title-text">{point.title}</span>
                            <span className="row-meta">
                              {point.carrierTitle} · {pageRange(point)}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="muted empty-hint">没有可添加的知识点，先到「知识点」页确认。</p>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
