ALTER TABLE community_profile ADD COLUMN member_tier TEXT NOT NULL DEFAULT 'member'
  CHECK (member_tier IN ('member', 'regular', 'trusted', 'contributor'));
ALTER TABLE site_setting ADD COLUMN test_content_roles TEXT NOT NULL DEFAULT '["admin"]'
  CHECK (json_valid(test_content_roles) AND json_type(test_content_roles) = 'array');
CREATE TABLE community_group_event (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  from_group TEXT NOT NULL CHECK (from_group IN ('member', 'regular', 'trusted', 'contributor', 'moderator', 'admin')),
  to_group TEXT NOT NULL CHECK (to_group IN ('member', 'regular', 'trusted', 'contributor', 'moderator', 'admin')),
  actor_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (from_group <> to_group)
);
CREATE INDEX community_group_event_user_idx ON community_group_event(user_id, created_at);
