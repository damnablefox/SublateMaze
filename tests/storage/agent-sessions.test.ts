import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteService } from '@sublate/plugin-storage-sqlite'

const tempDirs: string[] = []
const services: SqliteService[] = []

function open(path: string) {
  const sqlite = new SqliteService(path)
  services.push(sqlite)
  return sqlite
}

function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), 'sublate-agent-sessions-'))
  tempDirs.push(dir)
  return join(dir, 'sublate.db')
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

describe('storage-sqlite Agent 会话仓储', () => {
  it('迁移到版本 9，事件按 seq 追加', () => {
    const sqlite = open(tempPath())

    expect((sqlite.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9)

    const session = sqlite.agentSessions.create('学习线性代数', 1000)
    const first = sqlite.agentSessions.append(session.id, 'turn', { tool: 'demo.echo' })
    const second = sqlite.agentSessions.append(session.id, 'tool_result', { ok: true })

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(first.payload).toEqual({ tool: 'demo.echo' })

    const detail = sqlite.agentSessions.get(session.id)
    expect(detail?.events.map(event => event.seq)).toEqual([1, 2])
    expect(detail?.session).toMatchObject({
      goal: '学习线性代数',
      status: 'running',
      budgetTokens: 1000,
      usedTokens: 0,
    })
  })

  it('会话结束更新状态与用量，列表带事件计数', () => {
    const sqlite = open(tempPath())
    const session = sqlite.agentSessions.create('复习到期卡片', 500)

    sqlite.agentSessions.append(session.id, 'done', { answer: '完成' })
    sqlite.agentSessions.update(session.id, {
      status: 'done',
      usedTokens: 120,
      answer: '完成',
    })

    const summary = sqlite.agentSessions.list()[0]
    expect(summary).toMatchObject({
      id: session.id,
      status: 'done',
      usedTokens: 120,
      eventCount: 1,
    })
  })

  it('重新打开数据库后事件仍可回放', () => {
    const path = tempPath()
    const first = open(path)
    const session = first.agentSessions.create('跨进程回放', 200)
    first.agentSessions.append(session.id, 'turn', { step: 0 })
    first.agentSessions.append(session.id, 'done', { answer: '完成' })
    first.close()

    const second = open(path)
    const detail = second.agentSessions.get(session.id)

    expect(detail?.events).toHaveLength(2)
    expect(detail?.events[1]?.type).toBe('done')
  })

  it('删除会话级联清理事件', () => {
    const sqlite = open(tempPath())
    const session = sqlite.agentSessions.create('待删除', 100)
    sqlite.agentSessions.append(session.id, 'turn', {})

    sqlite.agentSessions.remove(session.id)

    expect(sqlite.agentSessions.get(session.id)).toBeUndefined()
    expect(
      sqlite.db.prepare('SELECT COUNT(*) AS count FROM agent_events WHERE session_id = ?').get(session.id),
    ).toEqual({ count: 0 })
  })
})
