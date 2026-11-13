-- 200面拡張（区間単位のセッション・チケット）への移行用。
-- 既存の D1（100面版）に対して1回だけ実行する:
--   npm run db:migrate:remote    （ローカルは db:migrate:local）
-- sessions は数時間で消える一時データなので、作り直す（進行中の挑戦だけが無効になる）。
-- world（世界の状態）と clears（クリア記録）はそのまま残る。
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  segment INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  next_stage INTEGER NOT NULL,
  total_frames INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions (last_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON sessions (ip_hash, created_at);
