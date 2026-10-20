CREATE TABLE IF NOT EXISTS community_chart_media_asset (
  hash TEXT PRIMARY KEY NOT NULL CHECK (length(hash) = 64),
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 67108864),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_chart_revision_media (
  chart_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'cover')),
  asset_hash TEXT NOT NULL REFERENCES community_chart_media_asset(hash) ON DELETE RESTRICT,
  PRIMARY KEY (chart_id, revision, kind),
  FOREIGN KEY (chart_id, revision) REFERENCES community_chart_revision(chart_id, revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS community_chart_revision_media_asset_idx ON community_chart_revision_media(asset_hash);
CREATE TABLE IF NOT EXISTS community_chart_media_origin (
  reference_key TEXT PRIMARY KEY NOT NULL,
  asset_hash TEXT NOT NULL REFERENCES community_chart_media_asset(hash) ON DELETE CASCADE
);
