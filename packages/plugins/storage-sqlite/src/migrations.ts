/** 迁移 001：settings 表。迁移只增不改，历史迁移不得重写。 */
export const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

/**
 * 迁移 002：知识载体、文件、页文本、阅读位置与全文索引。
 *
 * carrier_pages_fts 存的是逐字切分后的正文（见 core 的 segmentCjk），
 * 原文以 carrier_pages.text 为准。
 */
export const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS carriers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  language TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_carriers_deleted ON carriers (deleted_at);
CREATE INDEX IF NOT EXISTS idx_carriers_source_url ON carriers (source_url);

CREATE TABLE IF NOT EXISTS carrier_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier_id TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (sha256)
);

CREATE INDEX IF NOT EXISTS idx_carrier_files_carrier ON carrier_files (carrier_id);

CREATE TABLE IF NOT EXISTS carrier_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier_id TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (carrier_id, page_no)
);

CREATE TABLE IF NOT EXISTS carrier_read_state (
  carrier_id TEXT PRIMARY KEY REFERENCES carriers (id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL DEFAULT 1,
  scroll_ratio REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS carrier_pages_fts USING fts5(
  body,
  carrier_id UNINDEXED,
  page_no UNINDEXED,
  tokenize = 'unicode61'
);
`

/** 迁移 003：AI 调用记录，用于成本统计与故障排查。 */
export const MIGRATION_003 = `
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_calls_created ON ai_calls (created_at);
`

/** 迁移 004：载体 chunk 与 embedding 状态。 */
export const MIGRATION_004 = `
CREATE TABLE IF NOT EXISTS carrier_chunks (
  id TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  chunk_no INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  embedding_model TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (carrier_id, page_no, chunk_no)
);

CREATE INDEX IF NOT EXISTS idx_carrier_chunks_carrier ON carrier_chunks (carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_chunks_status ON carrier_chunks (embedding_status);
`

/** 迁移 005：AI 任务、知识单元与知识点。 */
export const MIGRATION_005 = `
CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  result_json TEXT,
  error TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_units (
  id TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY,
  unit_id TEXT REFERENCES knowledge_units (id) ON DELETE SET NULL,
  carrier_id TEXT NOT NULL REFERENCES carriers (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_units_carrier ON knowledge_units (carrier_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_points_carrier ON knowledge_points (carrier_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_points_unit ON knowledge_points (unit_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_points_status ON knowledge_points (status);
`

/** 迁移 006：课程、单元、课程内编排、目标、计划与每日计划项。 */
export const MIGRATION_006 = `
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  daily_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_units (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_units_course ON course_units (course_id);

CREATE TABLE IF NOT EXISTS course_points (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES course_units (id) ON DELETE SET NULL,
  point_id TEXT NOT NULL REFERENCES knowledge_points (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (course_id, point_id)
);

CREATE INDEX IF NOT EXISTS idx_course_points_course ON course_points (course_id);
CREATE INDEX IF NOT EXISTS idx_course_points_unit ON course_points (unit_id);
CREATE INDEX IF NOT EXISTS idx_course_points_point ON course_points (point_id);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_date TEXT,
  daily_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goals_course ON goals (course_id);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  goal_id TEXT REFERENCES goals (id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  daily_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_course ON plans (course_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans (status);

CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  course_point_id TEXT NOT NULL REFERENCES course_points (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (plan_id, course_point_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items (plan_id, date, position);
CREATE INDEX IF NOT EXISTS idx_plan_items_date ON plan_items (date, status);
`

/** 迁移 007：FSRS 掌握状态与复习记录。 */
export const MIGRATION_007 = `
CREATE TABLE IF NOT EXISTS mastery (
  point_id TEXT PRIMARY KEY REFERENCES knowledge_points (id) ON DELETE CASCADE,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  due_at TEXT,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  card_state INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  last_rating INTEGER,
  accuracy_ewma REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mastery_due ON mastery (due_at);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES knowledge_points (id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  retrievability_before REAL NOT NULL DEFAULT 0,
  interval_days REAL NOT NULL DEFAULT 0,
  stability_after REAL NOT NULL DEFAULT 0,
  difficulty_after REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reviews_point ON reviews (point_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_reviews_time ON reviews (reviewed_at);
`

/** 迁移 008：Agent 会话与事件日志。 */
export const MIGRATION_008 = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  budget_tokens INTEGER NOT NULL DEFAULT 0,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  answer TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions (updated_at);

CREATE TABLE IF NOT EXISTS agent_events (
  session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
`

/** 迁移 009：笔记、wiki 出链与关联记录。 */
export const MIGRATION_009 = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  rel_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_active_title
  ON notes (title_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes (deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at);

CREATE TABLE IF NOT EXISTS note_links (
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  target_title TEXT NOT NULL,
  target_key TEXT NOT NULL,
  target_note_id TEXT,
  PRIMARY KEY (note_id, target_key)
);

CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links (target_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_key ON note_links (target_key);

CREATE TABLE IF NOT EXISTS note_refs (
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  PRIMARY KEY (note_id, ref_type, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_note_refs_ref ON note_refs (ref_type, ref_id);
`
