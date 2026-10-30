// L3 — GEB
// Input: Validated official catalogs, observations and region-scoped read identities.
// Output: Immutable R2 payloads, D1 indexes, numeric history cursors and board health; Arena league windows separately.
// Pos: [Map](L2.md); official ranking persistence, separate from legacy provider history.
// Effects/Dependencies: Reads and writes private R2 and D1; reads preserve original observation timestamps.
import type { GameRecordsRegion } from "../src/lib/game-records";
import type { OfficialArenaObservation, OfficialCatalog, OfficialObservation } from "../src/lib/official-ranking";

export interface OfficialRankingStoreBindings {
  DB?: D1Database;
  OFFICIAL_RANKING_DATA?: R2Bucket;
}

export interface StoredOfficialObservation extends OfficialObservation {
  cursor: number;
  payloadHash: string;
}

interface ObservationRow {
  cursor: number;
  payload_key: string;
  payload_hash: string;
}

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const OFFICIAL_RANKING_STALE_MS = 600_000;

export async function officialDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storage(env: OfficialRankingStoreBindings): { db: D1Database; bucket: R2Bucket } {
  if (!env.DB || !env.OFFICIAL_RANKING_DATA) throw new Error("official_storage_unavailable");
  return { db: env.DB, bucket: env.OFFICIAL_RANKING_DATA };
}

async function readPayload<T>(bucket: R2Bucket, key: string, expectedHash: string): Promise<T> {
  const object = await bucket.get(key);
  if (!object || object.size > MAX_PAYLOAD_BYTES) throw new Error("official_payload_unavailable");
  const body = await object.text();
  if (await officialDigest(body) !== expectedHash) throw new Error("official_payload_integrity");
  return JSON.parse(body) as T;
}

export async function saveOfficialCatalog(env: OfficialRankingStoreBindings, catalog: OfficialCatalog): Promise<void> {
  const { db, bucket } = storage(env);
  const previous = await readOfficialCatalog(env, catalog.region);
  if (previous && catalog.catalogObservedAtMs < previous.catalogObservedAtMs) throw new Error("official_catalog_regressed");
  const highest = await db.prepare("SELECT highest_event_id, event_identity FROM official_ranking_catalogs WHERE region = ?")
    .bind(catalog.region).first<{ highest_event_id: string; event_identity: string }>();
  const eventId = catalog.event?.id;
  if (eventId && highest && BigInt(eventId) < BigInt(highest.highest_event_id)) throw new Error("official_event_regressed");
  if (eventId && highest?.highest_event_id === eventId) {
    const identities = new Set(catalog.event!.challenges.map((challenge) => `${challenge.id}:${challenge.musicId}`));
    if ((JSON.parse(highest.event_identity) as string[]).some((identity) => !identities.has(identity))) {
      throw new Error("official_challenge_identity_changed");
    }
  }
  const body = JSON.stringify(catalog);
  if (new TextEncoder().encode(body).byteLength > MAX_PAYLOAD_BYTES) throw new Error("official_catalog_too_large");
  const hash = await officialDigest(body);
  const key = `official/1/${catalog.region}/catalogs/${hash}.json`;
  await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
  await db.prepare(`INSERT INTO official_ranking_catalogs
    (region, highest_event_id, event_identity, observed_at_ms, payload_key, payload_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(region) DO UPDATE SET highest_event_id = excluded.highest_event_id,
      event_identity = excluded.event_identity,
      observed_at_ms = excluded.observed_at_ms, payload_key = excluded.payload_key, payload_hash = excluded.payload_hash
    WHERE excluded.observed_at_ms >= official_ranking_catalogs.observed_at_ms`)
    .bind(catalog.region, eventId ?? highest?.highest_event_id ?? "0",
      catalog.event ? JSON.stringify(catalog.event.challenges.map((challenge) => `${challenge.id}:${challenge.musicId}`)) : highest?.event_identity ?? "[]",
      catalog.catalogObservedAtMs, key, hash).run();
}

export async function readOfficialCatalog(env: OfficialRankingStoreBindings, region: GameRecordsRegion): Promise<OfficialCatalog | null> {
  const { db, bucket } = storage(env);
  const row = await db.prepare("SELECT payload_key, payload_hash FROM official_ranking_catalogs WHERE region = ?")
    .bind(region).first<ObservationRow>();
  if (!row) return null;
  const catalog = await readPayload<OfficialCatalog>(bucket, row.payload_key, row.payload_hash);
  if (catalog.region !== region) throw new Error("official_region_mismatch");
  return catalog;
}

export async function saveOfficialObservation(env: OfficialRankingStoreBindings, observation: OfficialObservation): Promise<void> {
  const { db, bucket } = storage(env);
  const body = JSON.stringify(observation);
  if (new TextEncoder().encode(body).byteLength > MAX_PAYLOAD_BYTES) throw new Error("official_observation_too_large");
  const hash = await officialDigest(body);
  const previous = await db.prepare("SELECT payload_hash FROM official_ranking_observations WHERE region = ? AND snapshot_id = ?")
    .bind(observation.region, observation.snapshotId).first<{ payload_hash: string }>();
  if (previous) {
    if (previous.payload_hash !== hash) throw new Error("official_observation_conflict");
    return;
  }
  const key = `official/1/${observation.region}/observations/${observation.snapshotId}/${hash}.json`;
  await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
  await db.batch([
    db.prepare(`INSERT INTO official_ranking_observations
      (region, snapshot_id, event_id, board_kind, challenge_id, observed_at_ms, payload_key, payload_hash, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(region, snapshot_id) DO NOTHING`)
      .bind(observation.region, observation.snapshotId, observation.eventId, observation.kind, observation.challengeId,
        observation.observedAtMs, key, hash, observation.error ?? null),
    db.prepare(`INSERT INTO official_ranking_board_status
      (region, event_id, board_kind, challenge_id, last_attempt_ms, last_success_ms, last_success_cursor, last_cursor, consecutive_failures)
      SELECT region, event_id, board_kind, challenge_id, observed_at_ms,
        CASE WHEN error IS NULL THEN observed_at_ms ELSE NULL END, CASE WHEN error IS NULL THEN cursor ELSE NULL END,
        cursor, CASE WHEN error IS NULL THEN 0 ELSE 1 END
      FROM official_ranking_observations WHERE region = ? AND snapshot_id = ? AND payload_hash = ?
      ON CONFLICT(region, event_id, board_kind, challenge_id) DO UPDATE SET
        last_attempt_ms = MAX(official_ranking_board_status.last_attempt_ms, excluded.last_attempt_ms),
        last_success_ms = CASE WHEN excluded.last_success_ms IS NULL THEN official_ranking_board_status.last_success_ms
          ELSE MAX(COALESCE(official_ranking_board_status.last_success_ms, 0), excluded.last_success_ms) END,
        last_success_cursor = CASE WHEN excluded.last_success_ms IS NOT NULL
          AND (official_ranking_board_status.last_success_ms IS NULL OR excluded.last_success_ms >= official_ranking_board_status.last_success_ms)
          THEN excluded.last_success_cursor ELSE official_ranking_board_status.last_success_cursor END,
        last_cursor = excluded.last_cursor,
        consecutive_failures = CASE WHEN excluded.last_success_ms IS NULL THEN
          CASE WHEN official_ranking_board_status.last_success_ms IS NULL
            OR excluded.last_attempt_ms >= official_ranking_board_status.last_success_ms
            THEN official_ranking_board_status.consecutive_failures + 1 ELSE official_ranking_board_status.consecutive_failures END
          WHEN excluded.last_success_ms < COALESCE(official_ranking_board_status.last_success_ms, 0)
            THEN official_ranking_board_status.consecutive_failures
          WHEN excluded.last_attempt_ms >= official_ranking_board_status.last_attempt_ms THEN 0
          ELSE (SELECT COUNT(*) FROM official_ranking_observations AS later
            WHERE later.region = excluded.region AND later.event_id = excluded.event_id
              AND later.board_kind = excluded.board_kind AND later.challenge_id = excluded.challenge_id
              AND later.error IS NOT NULL AND (later.observed_at_ms > excluded.last_success_ms
                OR (later.observed_at_ms = excluded.last_success_ms AND later.cursor > excluded.last_success_cursor))) END
      WHERE excluded.last_cursor > official_ranking_board_status.last_cursor`).bind(observation.region, observation.snapshotId, hash),
  ]);
  const saved = await db.prepare("SELECT payload_hash FROM official_ranking_observations WHERE region = ? AND snapshot_id = ?")
    .bind(observation.region, observation.snapshotId).first<{ payload_hash: string }>();
  if (saved?.payload_hash !== hash) throw new Error("official_observation_conflict");
}

async function observationPayload(bucket: R2Bucket, row: ObservationRow, region: GameRecordsRegion, eventId: string,
  kind: OfficialObservation["kind"], challengeId: string): Promise<StoredOfficialObservation> {
  const observation = await readPayload<OfficialObservation>(bucket, row.payload_key, row.payload_hash);
  if (observation.region !== region || observation.eventId !== eventId || observation.kind !== kind || observation.challengeId !== challengeId) {
    throw new Error("official_observation_identity_mismatch");
  }
  return { ...observation, cursor: row.cursor, payloadHash: row.payload_hash };
}

export async function readOfficialLatest(env: OfficialRankingStoreBindings, region: GameRecordsRegion, eventId: string,
  kind: OfficialObservation["kind"], challengeId: string): Promise<StoredOfficialObservation | null> {
  const { db, bucket } = storage(env);
  const row = await db.prepare(`SELECT cursor, payload_key, payload_hash FROM official_ranking_observations
    WHERE region = ? AND event_id = ? AND board_kind = ? AND challenge_id = ? AND error IS NULL
    ORDER BY observed_at_ms DESC, cursor DESC LIMIT 1`).bind(region, eventId, kind, challengeId).first<ObservationRow>();
  return row ? observationPayload(bucket, row, region, eventId, kind, challengeId) : null;
}

export async function readOfficialHistory(env: OfficialRankingStoreBindings, region: GameRecordsRegion, eventId: string,
  kind: OfficialObservation["kind"], challengeId: string, after: number): Promise<{ observations: StoredOfficialObservation[]; nextCursor: number }> {
  const { db, bucket } = storage(env);
  const { results } = await db.prepare(`SELECT cursor, payload_key, payload_hash FROM official_ranking_observations
    WHERE region = ? AND event_id = ? AND board_kind = ? AND challenge_id = ? AND cursor > ?
    ORDER BY cursor LIMIT 100`).bind(region, eventId, kind, challengeId, after).all<ObservationRow>();
  const observations: StoredOfficialObservation[] = [];
  let bytes = 0;
  for (const row of results) {
    const observation = await observationPayload(bucket, row, region, eventId, kind, challengeId);
    const size = new TextEncoder().encode(JSON.stringify(observation)).byteLength;
    if (observations.length && bytes + size > MAX_PAYLOAD_BYTES / 2) break;
    observations.push(observation);
    bytes += size;
  }
  return { observations, nextCursor: observations.at(-1)?.cursor ?? after };
}

export interface OfficialBoardStatus {
  kind: OfficialObservation["kind"];
  challengeId: string;
  lastAttemptAtMs: number | null;
  lastSuccessfulObservationAtMs: number | null;
  consecutiveFailures: number;
  ageMs: number | null;
  stale: boolean;
  openGapMs: number | null;
}

export async function readOfficialBoardStatus(env: OfficialRankingStoreBindings, region: GameRecordsRegion, eventId: string): Promise<OfficialBoardStatus[]> {
  const { db } = storage(env);
  const { results } = await db.prepare(`SELECT board_kind, challenge_id, last_attempt_ms, last_success_ms, consecutive_failures
    FROM official_ranking_board_status WHERE region = ? AND event_id = ? ORDER BY board_kind, challenge_id`)
    .bind(region, eventId).all<{ board_kind: OfficialObservation["kind"]; challenge_id: string; last_attempt_ms: number;
      last_success_ms: number | null; consecutive_failures: number }>();
  const now = Date.now();
  const boards: OfficialBoardStatus[] = [];
  for (const row of results) {
    const age = row.last_success_ms === null ? null : now - row.last_success_ms;
    boards.push({ kind: row.board_kind, challengeId: row.challenge_id, lastAttemptAtMs: row.last_attempt_ms,
      lastSuccessfulObservationAtMs: row.last_success_ms, consecutiveFailures: row.consecutive_failures,
      ageMs: age, stale: age === null || age < 0 || age > OFFICIAL_RANKING_STALE_MS,
      openGapMs: age === null ? null : Math.max(0, age - 300_000) });
  }
  return boards;
}

export async function saveOfficialArenaObservation(env: OfficialRankingStoreBindings, observation: OfficialArenaObservation): Promise<void> {
  const { db, bucket } = storage(env);
  const body = JSON.stringify(observation);
  if (new TextEncoder().encode(body).byteLength > MAX_PAYLOAD_BYTES) throw new Error("official_observation_too_large");
  const hash = await officialDigest(body);
  const previous = await db.prepare("SELECT payload_hash FROM official_arena_ranking_observations WHERE region = ? AND snapshot_id = ?")
    .bind(observation.region, observation.snapshotId).first<{ payload_hash: string }>();
  if (previous) {
    if (previous.payload_hash !== hash) throw new Error("official_observation_conflict");
    return;
  }
  const key = `official/1/${observation.region}/arena/${observation.snapshotId}/${hash}.json`;
  await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
  await db.prepare(`INSERT INTO official_arena_ranking_observations
    (region, snapshot_id, season_id, band_id, start_rank, end_rank, max_rank, observed_at_ms, payload_key, payload_hash, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(region, snapshot_id) DO NOTHING`)
    .bind(observation.region, observation.snapshotId, observation.seasonId, observation.bandId, observation.startRank,
      observation.endRank, observation.maxRank ?? null, observation.observedAtMs, key, hash, observation.error ?? null).run();
}

/** The latest successful window of a league board that contains `rank`. */
export async function readOfficialArenaLatest(env: OfficialRankingStoreBindings, region: GameRecordsRegion, seasonId: string,
  bandId: string, rank: number): Promise<(OfficialArenaObservation & { cursor: number }) | null> {
  const { db, bucket } = storage(env);
  const row = await db.prepare(`SELECT cursor, payload_key, payload_hash FROM official_arena_ranking_observations
    WHERE region = ? AND season_id = ? AND band_id = ? AND start_rank <= ? AND end_rank >= ? AND error IS NULL
    ORDER BY observed_at_ms DESC, cursor DESC LIMIT 1`).bind(region, seasonId, bandId, rank, rank).first<ObservationRow>();
  if (!row) return null;
  const observation = await readPayload<OfficialArenaObservation>(bucket, row.payload_key, row.payload_hash);
  if (observation.region !== region || observation.seasonId !== seasonId || observation.bandId !== bandId) {
    throw new Error("official_observation_identity_mismatch");
  }
  return { ...observation, cursor: row.cursor };
}
