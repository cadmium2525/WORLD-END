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

-- ノーセーブ区間1つ分の挑戦（80〜100, 101〜120, …, 181〜200。区間を始めるたびに1セッション）
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  segment INTEGER NOT NULL,          -- 区間の開始面（80, 101, 121, 141, 161, 181）
  run_id TEXT NOT NULL,              -- 80面から続く一連の挑戦のID（チケットで引き継ぐ。名前とは無関係）
  next_stage INTEGER NOT NULL,
  total_frames INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions (last_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions (ip_hash, created_at);

-- 200面（最終面）まで検証に成功したクリアの記録（テストモードでも残る）
CREATE TABLE IF NOT EXISTS clears (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  total_frames INTEGER NOT NULL,
  cleared_at INTEGER NOT NULL
);
