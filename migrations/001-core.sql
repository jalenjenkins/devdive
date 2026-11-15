CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_puzzles (
  puzzle_date TEXT PRIMARY KEY,
  catalog_version TEXT NOT NULL,
  prompts TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  puzzle_date TEXT NOT NULL REFERENCES daily_puzzles(puzzle_date),
  state TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  UNIQUE(player_id, puzzle_date)
);
CREATE INDEX IF NOT EXISTS rounds_retention ON rounds(updated_at);
CREATE TABLE IF NOT EXISTS submissions (
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(round_id, question_index)
);
CREATE TABLE IF NOT EXISTS results (
  round_id TEXT PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  puzzle_date TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  tiers TEXT NOT NULL,
  completed_at BIGINT NOT NULL,
  UNIQUE(player_id, puzzle_date)
);
CREATE INDEX IF NOT EXISTS results_leaderboard ON results(puzzle_date, score DESC, depth DESC, completed_at, round_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY(bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_retention ON rate_limits(window_start);
CREATE TABLE IF NOT EXISTS answer_reports (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  question_index INTEGER NOT NULL,
  input TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(round_id, question_index)
);
