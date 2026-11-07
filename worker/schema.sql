-- WORLD END データベース（Cloudflare D1 / SQLite）

-- 世界の状態（1行だけ）
CREATE TABLE IF NOT EXISTS world (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ended INTEGER NOT NULL DEFAULT 0,
  winner_name TEXT,
  winner_session TEXT,
  ended_at INTEGER
);
INSERT OR IGNORE INTO world (id, ended) VALUES (1, 0);

-- 80〜100面の連続チャレンジ（1回の挑戦 = 1セッション）
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  next_stage INTEGER NOT NULL,
  total_frames INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions (last_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions (ip_hash, created_at);

-- 検証に成功したクリアの記録（テストモードでも残る）
CREATE TABLE IF NOT EXISTS clears (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  total_frames INTEGER NOT NULL,
  cleared_at INTEGER NOT NULL
);
