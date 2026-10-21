/** 迁移 001：settings 表。迁移只增不改，历史迁移不得重写。 */
export const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
