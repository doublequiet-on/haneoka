CREATE TABLE IF NOT EXISTS official_arena_population_observations (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL CHECK (region IN ('jp', 'tw', 'en', 'kr')),
  snapshot_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  band_id TEXT NOT NULL,
  max_rank INTEGER NOT NULL CHECK (max_rank >= 0),
  observed_at_ms INTEGER NOT NULL,
  payload_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  UNIQUE (region, snapshot_id)
);

CREATE INDEX IF NOT EXISTS official_arena_population_latest
  ON official_arena_population_observations (region, season_id, band_id, observed_at_ms DESC, cursor DESC);

CREATE INDEX IF NOT EXISTS official_arena_board_latest
  ON official_arena_ranking_observations (region, season_id, band_id, observed_at_ms DESC, cursor DESC)
  WHERE error IS NULL;

CREATE TABLE IF NOT EXISTS official_arena_window_metadata (
  region TEXT NOT NULL CHECK (region IN ('jp', 'tw', 'en', 'kr')),
  season_id TEXT NOT NULL,
  band_id TEXT NOT NULL,
  start_rank INTEGER NOT NULL,
  end_rank INTEGER NOT NULL,
  max_rank INTEGER,
  player_count INTEGER NOT NULL CHECK (player_count BETWEEN 0 AND 100),
  profile_index TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  payload_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (region, season_id, band_id, start_rank)
);
