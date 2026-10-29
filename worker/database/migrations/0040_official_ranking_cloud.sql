CREATE TABLE IF NOT EXISTS official_ranking_catalogs (
  region TEXT PRIMARY KEY CHECK (region IN ('jp', 'tw', 'en', 'kr')),
  highest_event_id TEXT NOT NULL,
  event_identity TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  payload_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS official_ranking_observations (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL CHECK (region IN ('jp', 'tw', 'en', 'kr')),
  snapshot_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  board_kind TEXT NOT NULL CHECK (board_kind IN ('challenge', 'total')),
  challenge_id TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  payload_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  error TEXT,
  UNIQUE (region, snapshot_id),
  CHECK ((board_kind = 'total' AND challenge_id = '') OR (board_kind = 'challenge' AND challenge_id <> ''))
);

CREATE INDEX IF NOT EXISTS official_ranking_latest
  ON official_ranking_observations (region, event_id, board_kind, challenge_id, observed_at_ms DESC, cursor DESC)
  WHERE error IS NULL;
CREATE INDEX IF NOT EXISTS official_ranking_history
  ON official_ranking_observations (region, event_id, board_kind, challenge_id, cursor);
CREATE INDEX IF NOT EXISTS official_ranking_failures
  ON official_ranking_observations (region, event_id, board_kind, challenge_id, observed_at_ms, cursor)
  WHERE error IS NOT NULL;

CREATE TABLE IF NOT EXISTS official_ranking_board_status (
  region TEXT NOT NULL CHECK (region IN ('jp', 'tw', 'en', 'kr')),
  event_id TEXT NOT NULL,
  board_kind TEXT NOT NULL CHECK (board_kind IN ('challenge', 'total')),
  challenge_id TEXT NOT NULL,
  last_attempt_ms INTEGER NOT NULL,
  last_success_ms INTEGER,
  last_success_cursor INTEGER,
  last_cursor INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL,
  PRIMARY KEY (region, event_id, board_kind, challenge_id)
);
