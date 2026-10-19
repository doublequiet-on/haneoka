INSERT OR IGNORE INTO resource_server
  (slug, display_name, region, status, resource_prefix, version, created_at, updated_at, created_by, updated_by)
VALUES
  ('jp-test-01', 'JP Test 01', 'jp', 'draft', 'servers/jp-test-01', 1, 0, 0, NULL, NULL),
  ('jp-test-02', 'JP Test 02', 'jp', 'draft', 'servers/jp-test-02', 1, 0, 0, NULL, NULL),
  ('jp-test-03', 'JP Test 03', 'jp', 'draft', 'servers/jp-test-03', 1, 0, 0, NULL, NULL);
