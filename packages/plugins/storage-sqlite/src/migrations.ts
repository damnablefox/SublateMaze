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
