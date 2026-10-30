CREATE TABLE IF NOT EXISTS official_arena_ranking_observations (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL CHECK (region IN ('jp', 'tw', 'en', 'kr')),
  snapshot_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  band_id TEXT NOT NULL,
  start_rank INTEGER NOT NULL CHECK (start_rank >= 1),
  end_rank INTEGER NOT NULL,
  max_rank INTEGER,
  observed_at_ms INTEGER NOT NULL,
  payload_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  error TEXT,
  UNIQUE (region, snapshot_id),
  CHECK (end_rank >= start_rank AND end_rank - start_rank < 100)
);

CREATE INDEX IF NOT EXISTS official_arena_ranking_latest
  ON official_arena_ranking_observations (region, season_id, band_id, start_rank, observed_at_ms DESC, cursor DESC)
  WHERE error IS NULL;
