CREATE TABLE IF NOT EXISTS community_chart_analysis (
  chart_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  analysis_json TEXT NOT NULL CHECK (json_valid(analysis_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chart_id, revision, model_version),
  FOREIGN KEY (chart_id, revision) REFERENCES community_chart_revision(chart_id, revision) ON DELETE CASCADE
);
