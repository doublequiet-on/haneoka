CREATE TABLE IF NOT EXISTS community_chart (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  head INTEGER NOT NULL DEFAULT 0 CHECK (head >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  published_revision INTEGER,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS community_chart_owner_idx ON community_chart(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS community_chart_public_idx ON community_chart(visibility, updated_at DESC) WHERE deleted_at IS NULL AND published_revision IS NOT NULL;
CREATE TABLE IF NOT EXISTS community_chart_audio (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 44 AND 67108864),
  duration REAL NOT NULL CHECK (duration > 0 AND duration <= 600),
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id, sha256)
);
CREATE TABLE IF NOT EXISTS community_chart_revision (
  chart_id TEXT NOT NULL REFERENCES community_chart(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  artist TEXT NOT NULL,
  charter TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  level TEXT NOT NULL,
  summary TEXT NOT NULL,
  audio_json TEXT NOT NULL,
  cover_json TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  audio_upload_id TEXT REFERENCES community_chart_audio(id) ON DELETE RESTRICT,
  cover_attachment_id TEXT REFERENCES community_attachment(id) ON DELETE RESTRICT,
  remix INTEGER NOT NULL CHECK (remix IN (0, 1)),
  upstream_id TEXT REFERENCES community_chart(id) ON DELETE RESTRICT,
  data_key TEXT,
  data_hash TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  PRIMARY KEY(chart_id, revision),
  UNIQUE(chart_id, request_id)
);
CREATE INDEX IF NOT EXISTS community_chart_revision_audio_idx ON community_chart_revision(audio_upload_id);
CREATE INDEX IF NOT EXISTS community_chart_revision_cover_idx ON community_chart_revision(cover_attachment_id);
CREATE TABLE IF NOT EXISTS community_chart_like (
  chart_id TEXT NOT NULL REFERENCES community_chart(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(chart_id, user_id)
);
CREATE TABLE IF NOT EXISTS community_chart_gc (
  object_key TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_chart_discussion_state (
  chart_id TEXT PRIMARY KEY NOT NULL REFERENCES community_chart(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES community_post(id) ON DELETE RESTRICT,
  hidden_version INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS community_chart_discussion_visibility
AFTER UPDATE OF published_revision, deleted_at ON community_chart
BEGIN
  INSERT OR IGNORE INTO community_chart_discussion_state(chart_id,post_id,hidden_version)
  SELECT NEW.id,p.id,p.version + 1 FROM community_entity_thread et JOIN community_post p ON p.id = et.post_id
  WHERE et.entity_type = 'community-charts' AND et.original_id = NEW.id AND p.status = 'published'
    AND (NEW.published_revision IS NULL OR NEW.deleted_at IS NOT NULL);
  UPDATE community_post SET status = 'hidden', version = version + 1
  WHERE id IN (SELECT post_id FROM community_chart_discussion_state WHERE chart_id = NEW.id)
    AND status = 'published' AND (NEW.published_revision IS NULL OR NEW.deleted_at IS NOT NULL);
  UPDATE community_post SET status = 'published', version = version + 1
  WHERE id IN (SELECT post_id FROM community_chart_discussion_state WHERE chart_id = NEW.id AND hidden_version = community_post.version)
    AND status = 'hidden' AND moderation_status = 'allow' AND deleted_at IS NULL AND archived_at IS NULL
    AND NEW.published_revision IS NOT NULL AND NEW.deleted_at IS NULL;
  DELETE FROM community_chart_discussion_state WHERE chart_id = NEW.id AND NEW.published_revision IS NOT NULL AND NEW.deleted_at IS NULL;
END;
