// L3 — GEB
// Input: Administrator-validated filters and content identity from admin.ts.
// Output: Chart/playlist review records and version-checked soft removal.
// Pos: [Map](L2.md); administration of community creations.
// Effects/Dependencies: D1 only; caller owns authoritative access and operation reservation.
export type CreationKind = "charts" | "playlists";
type Row = Record<string, string | number | null>;
export const creationTable = (kind: CreationKind) => kind === "charts" ? "community_chart" : "community_playlist";

export async function listAdminCreations(env: Env, kind: CreationKind, options: {
  query: string; status: string; limit: number; cursor: { sort: number; id: string } | null; id?: string;
}) {
  const chart = kind === "charts";
  const title = chart ? "COALESCE(published.title, r.title)" : "c.title", body = chart ? "COALESCE(published.summary, r.summary)" : "c.description";
  const state = `CASE WHEN c.deleted_at IS NOT NULL THEN 'deleted' WHEN ${chart ? "c.published_revision" : "c.published_at"} IS NULL THEN 'draft' ELSE 'published' END`;
  const conditions: string[] = [], values: (string | number)[] = [];
  if (options.id) { conditions.push("c.id = ?"); values.push(options.id); }
  if (options.status !== "all") { conditions.push(`${state} = ?`); values.push(options.status); }
  if (options.query) {
    conditions.push(`(${title} LIKE ? ESCAPE '\\' OR ${body} LIKE ? ESCAPE '\\' OR c.id = ?${chart ? " OR r.title LIKE ? ESCAPE '\\' OR r.summary LIKE ? ESCAPE '\\'" : ""})`);
    const pattern = `%${options.query.replace(/[\\%_]/gu, "\\$&")}%`;
    values.push(pattern, pattern, options.query);
    if (chart) values.push(pattern, pattern);
  }
  if (options.cursor) {
    conditions.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
    values.push(options.cursor.sort, options.cursor.sort, options.cursor.id);
  }
  return (await env.DB.prepare(`SELECT c.id, c.owner_id AS authorId, c.version, c.visibility,
    c.created_at AS createdAt, c.updated_at AS updatedAt, c.deleted_at AS deletedAt,
    ${title} AS title, ${body} AS body, ${state} AS status,
    p.display_name AS authorName, p.handle AS authorHandle, u.name AS authorAccountName,
    ${chart ? "c.head, c.published_revision AS publishedRevision, r.artist, r.charter, r.difficulty, r.level" : "c.track_count AS trackCount, c.published_at AS publishedAt"}
    FROM ${creationTable(kind)} c
    ${chart ? `LEFT JOIN community_chart_revision r ON r.chart_id = c.id AND r.revision = c.head
      LEFT JOIN community_chart_revision published ON published.chart_id = c.id AND published.revision = c.published_revision` : ""}
    LEFT JOIN community_profile p ON p.user_id = c.owner_id LEFT JOIN "user" u ON u.id = c.owner_id
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).bind(...values, options.limit).all<Row>()).results;
}

export async function readAdminCreation(env: Env, kind: CreationKind, id: string) {
  const current = (await listAdminCreations(env, kind, { id, query: "", status: "all", limit: 1, cursor: null }))[0];
  if (!current) return null;
  const details = kind === "charts"
    ? (await env.DB.prepare(`SELECT r.revision, r.title, r.artist, r.charter, r.difficulty, r.level, r.summary,
        r.remix, r.created_at AS createdAt, r.published_at AS publishedAt,
        CASE WHEN r.revision = c.head THEN 1 ELSE 0 END AS isHead,
        CASE WHEN r.revision = c.published_revision THEN 1 ELSE 0 END AS isPublished
        FROM community_chart_revision r JOIN community_chart c ON c.id = r.chart_id
        WHERE c.id = ? AND (r.revision = c.head OR r.revision = c.published_revision)
        ORDER BY r.revision DESC`).bind(id).all<Row>()).results
    : (await env.DB.prepare(`SELECT position, provider, server, music_id AS musicId
        FROM community_playlist_track WHERE playlist_id = ? ORDER BY position`).bind(id).all<Row>()).results;
  return { ...current, details };
}

export async function removeAdminCreation(env: Env, kind: CreationKind, id: string, version: number, operationId: string, reasonCode: string) {
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE ${creationTable(kind)} SET deleted_at = ?, updated_at = ?, version = version + 1
      ${kind === "charts" ? ", published_revision = NULL" : ""}
      WHERE id = ? AND version = ? AND deleted_at IS NULL`).bind(now, now, id, version),
    env.DB.prepare(`UPDATE admin_operation SET status = 'succeeded', external_ref = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'pending' AND changes() = 1`).bind(id, now, now, operationId),
    env.DB.prepare(`INSERT INTO admin_operation_event(id, operation_id, from_status, to_status, detail_json, created_at)
      SELECT ?, ?, 'pending', 'succeeded', ?, ? WHERE EXISTS (SELECT 1 FROM admin_operation WHERE id = ? AND status = 'succeeded')`)
      .bind(crypto.randomUUID(), operationId, JSON.stringify({ reasonCode, version: version + 1 }), now, operationId),
  ]);
  return Number(results[0]?.meta.changes || 0) > 0;
}
