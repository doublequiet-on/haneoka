// L3 — GEB
// Input: Region configuration, container callbacks and scheduled collection work.
// Output: Durable regional jobs/observations and read-only current collection availability.
// Pos: [Map](L2.md); official collector coordination and recovery.
// Effects/Dependencies: Starts isolated containers, persists DO state and writes D1/R2; credentials stay server-side.
import { Container } from "@cloudflare/containers";
import type { GameRecordsRegion } from "../src/lib/game-records";
import type { OfficialArenaObservation, OfficialCatalog, OfficialCollectorFailure, OfficialCollectorJob, OfficialCollectorUpdate, OfficialObservation } from "../src/lib/official-ranking";
import { officialDigest, saveOfficialArenaObservation, saveOfficialCatalog, saveOfficialObservation } from "./official-ranking-store";

export const OFFICIAL_RANKING_REGIONS = ["jp", "tw", "en", "kr"] as const;
export type OfficialCollectorConfigurationBindings = Partial<Pick<Env,
  "OFFICIAL_RANKING_JP_CONFIG" | "OFFICIAL_RANKING_TW_CONFIG" | "OFFICIAL_RANKING_EN_CONFIG" | "OFFICIAL_RANKING_KR_CONFIG"
>> & { OFFICIAL_RANKING_ENABLED_REGIONS?: string };
const INTERVAL_MS = 300_000;
const JOB_MS = 120_000;
const MAX_UPDATE_BYTES = 8 * 1024 * 1024;
const CALLBACK_ORIGIN = "https://haneoka.org";
const REGION_ORIGINS: Record<GameRecordsRegion, readonly string[]> = {
  jp: ["https://api.bang-dream-on.jp"],
  tw: ["https://l12-prod-hk-all-gs-sirius.gamerfusiontech.com", "https://l14-prod-hk-all-gs-sirius.gamerfusiontech.com"],
  en: ["https://l14-prod-va-all-gs-sirius.bilibiligame.net", "https://l17-prod-va-all-gs-sirius.bilibiligame.net"],
  kr: ["https://l14-prod-kr-all-gs-sirius.bilibiligame.net", "https://l17-prod-kr-all-gs-sirius.bilibiligame.net"],
};

type JsonObject = Record<string, unknown>;
interface CollectorConfig {
  clientVersion: string;
  credentials: JsonObject;
  masterConfig: JsonObject;
  generation: string;
}
interface CollectorRun {
  id: string;
  token: string;
  generation: string;
  startedAtMs: number;
  deadlineMs: number;
  pendingAttempt: string | null;
  resolvedAttempt: boolean;
  complete: boolean;
  catalog: OfficialCatalog | null;
  checkpoints: Record<string, string>;
}
interface CollectorState {
  region: GameRecordsRegion;
  status: string;
  nextAtMs: number;
  lastSuccessfulObservationAtMs: number | null;
  lastRunAtMs: number | null;
  failures: number;
  blockedGeneration: string | null;
  callbackProtocolVersion?: number;
  lastFailure?: OfficialCollectorFailure | null;
  run: CollectorRun | null;
}

export function officialRegionEnabled(value: string | undefined, region: GameRecordsRegion): boolean {
  return (value ?? "").split(",").map((entry) => entry.trim()).includes(region);
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_collector_document");
  return value as JsonObject;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as JsonObject)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function validRegion(value: unknown): value is GameRecordsRegion {
  return OFFICIAL_RANKING_REGIONS.some((region) => region === value);
}
function decimal(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]{0,18}$/u.test(value); }
function millis(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function retryMs(value: unknown): number {
  if (typeof value !== "number" || value <= 0 || Number.isNaN(value)) return INTERVAL_MS;
  const maximum = 8_640_000_000_000_000 - Date.now();
  return Math.max(INTERVAL_MS, Math.min(maximum, value * 1000));
}
function authRejected(observation: Pick<OfficialObservation, "httpStatus" | "grpcStatus" | "error">): boolean {
  return observation.httpStatus === 401 || observation.httpStatus === 403 || observation.grpcStatus === "7" || observation.grpcStatus === "16"
    || observation.grpcStatus === "2" && observation.error === "authentication_failed";
}
function limited(observation: Pick<OfficialObservation, "httpStatus" | "grpcStatus">): boolean { return observation.httpStatus === 429 || observation.grpcStatus === "8"; }
function validateFailure(value: unknown): asserts value is OfficialCollectorFailure {
  const failure = object(value);
  if (!["container", "catalog", "catalog_version", "catalog_server_list", "catalog_manifest", "catalog_event", "catalog_challenges", "catalog_parameters",
    "catalog_callback", "version", "board", "attempt_callback", "observation_callback", "complete_callback"].includes(String(failure.stage))
    || !["Error", "TimeoutError", "SSLError", "SSLCertVerificationError", "OSError", "URLError", "gaierror", "ValueError", "RuntimeError", "VersionError",
      "CatalogRequestError", "CallbackError", "ImportError", "ModuleNotFoundError", "FileNotFoundError", "PermissionError", "JSONDecodeError",
      "ConnectionError", "ConnectionRefusedError", "ConnectionResetError", "ProtocolError", "H2Error", "http_error", "container_fetch_failed"].includes(String(failure.code))
    || failure.httpStatus !== undefined && (typeof failure.httpStatus !== "number" || !Number.isInteger(failure.httpStatus) || failure.httpStatus < 100 || failure.httpStatus > 599)
    || failure.grpcStatus !== undefined && (typeof failure.grpcStatus !== "string" || !/^[0-9]{1,3}$/u.test(failure.grpcStatus))) throw new Error("invalid_failure");
}
async function responseFailure(response: Response): Promise<OfficialCollectorFailure | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) return null;
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const failure: unknown = object(JSON.parse(new TextDecoder().decode(bytes))).failure;
    validateFailure(failure);
    return { stage: failure.stage, code: failure.code,
      ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      ...(failure.grpcStatus !== undefined ? { grpcStatus: failure.grpcStatus } : {}) };
  } catch { return null; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
async function sameToken(actual: string, expected: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(actual));
}

async function configFor(env: OfficialCollectorConfigurationBindings, region: GameRecordsRegion): Promise<CollectorConfig | null> {
  const secret = env[`OFFICIAL_RANKING_${region.toUpperCase()}_CONFIG` as "OFFICIAL_RANKING_JP_CONFIG"];
  if (!secret?.trim()) return null;
  if (secret.length > 131_072) throw new Error("invalid_collector_config");
  const config = object(JSON.parse(secret));
  const credentials = object(config.credentials);
  const auth = object(credentials.credentials);
  const expectedRegion = region === "tw" ? "hk" : region;
  if (credentials.region !== expectedRegion || typeof credentials.origin !== "string" || !REGION_ORIGINS[region].includes(credentials.origin)
    || typeof auth.player_id !== "string" || !auth.player_id || typeof auth.credential !== "string" || !auth.credential
    || typeof config.clientVersion !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(config.clientVersion)) {
    throw new Error("invalid_collector_config");
  }
  const deviceId = auth.device_id || null;
  const bid = region === "jp" ? undefined : auth.bid || undefined;
  if (deviceId !== null && typeof deviceId !== "string" || bid !== undefined && typeof bid !== "string" || region === "jp" && auth.bid) {
    throw new Error("invalid_collector_config");
  }
  const authentication = { player_id: auth.player_id, credential: auth.credential, device_id: deviceId, ...(bid ? { bid } : {}) };
  return { clientVersion: config.clientVersion, credentials, masterConfig: object(config.masterConfig),
    generation: await officialDigest(canonical({ region, origin: credentials.origin, auth: authentication })) };
}

export async function officialCollectorAvailability(
  env: OfficialCollectorConfigurationBindings,
  region: GameRecordsRegion,
): Promise<"disabled" | "not_configured" | "invalid_config" | null> {
  if (!officialRegionEnabled(env.OFFICIAL_RANKING_ENABLED_REGIONS, region)) return "disabled";
  try { return await configFor(env, region) ? null : "not_configured"; }
  catch { return "invalid_config"; }
}

function validateCatalog(value: unknown, region: GameRecordsRegion): asserts value is OfficialCatalog {
  const catalog = object(value);
  if (catalog.region !== region || catalog.catalogSource !== "official-master" || !millis(catalog.catalogObservedAtMs)
    || catalog.catalogObservedAtMs > Date.now() + 60_000 || typeof catalog.masterVersion !== "string" || !catalog.masterVersion
    || !(catalog.resourceVersion === null || typeof catalog.resourceVersion === "string")
    || typeof catalog.apiOrigin !== "string" || !REGION_ORIGINS[region].includes(catalog.apiOrigin)) throw new Error("invalid_catalog");
  if (catalog.arena != null) {
    const arena = object(catalog.arena);
    if (!decimal(arena.seasonId) || !millis(arena.startAtMs) || !millis(arena.endAtMs) || !millis(arena.rankingEndAtMs)
      || arena.endAtMs <= arena.startAtMs || arena.rankingEndAtMs < arena.endAtMs || !Array.isArray(arena.bandIds)
      || arena.bandIds.length > 20 || !arena.bandIds.every(decimal) || new Set(arena.bandIds).size !== arena.bandIds.length) {
      throw new Error("invalid_catalog");
    }
  }
  if (catalog.event === null) return;
  const event = object(catalog.event);
  if (!decimal(event.id) || !millis(event.startAtMs) || !millis(event.endAtMs) || event.endAtMs <= event.startAtMs
    || typeof event.aggregationSeconds !== "number" || !Number.isSafeInteger(event.aggregationSeconds)
    || event.aggregationSeconds < 0 || event.aggregationSeconds > 604_800 || typeof event.totalRankingEnabled !== "boolean"
    || event.pointRankingEnabled !== false || !Array.isArray(event.challenges) || event.challenges.length > 100) throw new Error("invalid_catalog");
  const ids = new Set<string>();
  for (const value of event.challenges) {
    const challenge = object(value);
    if (!decimal(challenge.id) || ids.has(challenge.id) || !decimal(challenge.musicId) || typeof challenge.enabled !== "boolean"
      || !millis(challenge.startAtMs) || !millis(challenge.endAtMs) || challenge.startAtMs < event.startAtMs
      || challenge.endAtMs > event.endAtMs || challenge.endAtMs <= challenge.startAtMs) throw new Error("invalid_catalog");
    ids.add(challenge.id);
  }
}

function validateObservation(value: unknown, region: GameRecordsRegion): asserts value is OfficialObservation {
  const observation = object(value);
  if (observation.region !== region || typeof observation.snapshotId !== "string" || !/^[a-f0-9]{32}$/u.test(observation.snapshotId)
    || !decimal(observation.eventId) || !millis(observation.observedAtMs) || observation.observedAtMs > Date.now() + 60_000
    || !(observation.kind === "total" && observation.challengeId === "" || observation.kind === "challenge" && decimal(observation.challengeId))) {
    throw new Error("invalid_observation");
  }
  if (observation.error !== undefined) {
    if (typeof observation.error !== "string" || !/^[A-Za-z0-9_]{1,80}$/u.test(observation.error) || observation.players !== undefined) throw new Error("invalid_observation");
  } else {
    if (!Array.isArray(observation.players) || observation.players.length > 100) throw new Error("invalid_observation");
    for (const value of observation.players) {
      const player = object(value);
      if (!(typeof player.score === "string" && /^[0-9]+$/u.test(player.score) || typeof player.score === "number" && Number.isSafeInteger(player.score) && player.score >= 0)) {
        throw new Error("invalid_observation_score");
      }
    }
  }
}

function validateArenaObservation(value: unknown, region: GameRecordsRegion): asserts value is OfficialArenaObservation {
  const observation = object(value);
  const start = observation.startRank, end = observation.endRank;
  if (observation.region !== region || typeof observation.snapshotId !== "string" || !/^[a-f0-9]{32}$/u.test(observation.snapshotId)
    || !decimal(observation.seasonId) || !decimal(observation.bandId) || !millis(observation.observedAtMs)
    || observation.observedAtMs > Date.now() + 60_000 || typeof start !== "number" || !Number.isSafeInteger(start) || start < 1
    || typeof end !== "number" || !Number.isSafeInteger(end) || end < start || end - start >= 100
    || !(observation.maxRank == null || typeof observation.maxRank === "number" && Number.isSafeInteger(observation.maxRank) && observation.maxRank >= 0)) {
    throw new Error("invalid_observation");
  }
  if (observation.error !== undefined) {
    if (typeof observation.error !== "string" || !/^[A-Za-z0-9_]{1,80}$/u.test(observation.error) || observation.players !== undefined) throw new Error("invalid_observation");
    return;
  }
  if (!Array.isArray(observation.players) || observation.players.length > end - start + 1) throw new Error("invalid_observation");
  for (const value of observation.players) {
    const player = object(value);
    if (!(typeof player.point === "string" && /^[0-9]+$/u.test(player.point) || typeof player.point === "number" && Number.isSafeInteger(player.point) && player.point >= 0)) {
      throw new Error("invalid_observation_point");
    }
  }
}

async function boundedUpdate(request: Request): Promise<OfficialCollectorUpdate> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_update");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_UPDATE_BYTES) { await reader.cancel(); throw new Error("update_too_large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return object(JSON.parse(new TextDecoder().decode(bytes))) as OfficialCollectorUpdate;
}

export class OfficialRankingCollector extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "15s";
  override enableInternet = true;
  override pingEndpoint = "container/health";
  private mutations: Promise<void> = Promise.resolve();

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation);
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }

  private async stateFor(region: GameRecordsRegion): Promise<CollectorState> {
    if (!validRegion(region)) throw new Error("invalid_region");
    const previous = await this.ctx.storage.get<CollectorState>("collectorState");
    if (previous && previous.region !== region) throw new Error("collector_region_changed");
    return previous ?? { region, status: "not_started", nextAtMs: 0, lastSuccessfulObservationAtMs: null,
      lastRunAtMs: null, failures: 0, blockedGeneration: null, run: null };
  }

  private async persist(state: CollectorState, schedule = true): Promise<void> {
    await this.ctx.storage.put("collectorState", state);
    this.deleteSchedules("collectDue");
    if (schedule) await this.schedule(new Date(Math.max(Date.now() + 1_000, state.nextAtMs)), "collectDue", state.region);
    else await this.scheduleNextAlarm();
  }

  async ensureScheduled(region: GameRecordsRegion): Promise<void> {
    await this.serialized(async () => {
      const state = await this.stateFor(region);
      if (!officialRegionEnabled(this.env.OFFICIAL_RANKING_ENABLED_REGIONS, region)) {
        state.status = "disabled";
        await this.persist(state, false);
        return;
      }
      let config: CollectorConfig | null;
      try { config = await configFor(this.env, region); }
      catch { state.status = "invalid_config"; await this.persist(state, false); return; }
      if (!config) { state.status = "not_configured"; await this.persist(state, false); return; }
      if (state.blockedGeneration === config.generation) {
        if (!["auth_paused", "auth_uncertain"].includes(state.status)) state.status = "auth_paused";
        await this.persist(state, false); return;
      }
      if (state.callbackProtocolVersion !== 1 && state.status === "failed" && state.run?.complete
        && !state.run.catalog && !state.run.pendingAttempt && !state.blockedGeneration
        && state.lastFailure?.stage === "catalog_callback" && state.lastFailure.code === "CallbackError"
        && state.lastFailure.httpStatus === 403) {
        state.callbackProtocolVersion = 1;
        state.failures = 0;
        state.nextAtMs = Date.now();
      }
      if (state.status === "failed" && state.lastFailure === undefined && state.run?.complete
        && !state.run.catalog && !state.run.pendingAttempt && !state.blockedGeneration) {
        state.lastFailure = null;
        state.failures = 0;
        state.nextAtMs = Date.now();
      }
      if (state.run && !state.run.complete && Date.now() <= state.run.deadlineMs + 15_000) return;
      if (state.run && !state.run.complete && state.run.pendingAttempt && !state.run.resolvedAttempt) {
        state.blockedGeneration = state.run.generation;
        state.status = "auth_uncertain";
        if (state.blockedGeneration === config.generation) { await this.persist(state, false); return; }
      }
      state.blockedGeneration = null;
      if (state.run && !state.run.complete) state.run.complete = true;
      await this.persist(state);
    });
  }

  async status(region: GameRecordsRegion): Promise<Record<string, unknown>> {
    const state = await this.stateFor(region);
    const unavailable = await officialCollectorAvailability(this.env, region);
    const now = Date.now();
    const age = state.lastSuccessfulObservationAtMs === null ? null : now - state.lastSuccessfulObservationAtMs;
    return { contract: "haneoka:ranking-status/1", region, serverTimeMs: now, collectorStatus: unavailable ?? state.status,
      collectionEnabled: officialRegionEnabled(this.env.OFFICIAL_RANKING_ENABLED_REGIONS, region),
      readEnabled: officialRegionEnabled(this.env.OFFICIAL_RANKING_READ_REGIONS, region),
      samplingIntervalSeconds: INTERVAL_MS / 1000, lastSuccessfulObservationAtMs: state.lastSuccessfulObservationAtMs,
      ageMs: age, stale: age === null || age < 0 || age > 600_000, pollAfterSeconds: unavailable ? 300 : 30,
      lastFailure: state.lastFailure ?? null,
      nextAttemptAtMs: unavailable || state.blockedGeneration ? null : state.nextAtMs || null, catalogProvider: "official-master" };
  }

  async collectDue(region: GameRecordsRegion): Promise<void> {
    const job = await this.serialized(async (): Promise<OfficialCollectorJob | null> => {
      const state = await this.stateFor(region);
      if (!officialRegionEnabled(this.env.OFFICIAL_RANKING_ENABLED_REGIONS, region)) { state.status = "disabled"; await this.persist(state, false); return null; }
      let config: CollectorConfig | null;
      try { config = await configFor(this.env, region); }
      catch { state.status = "invalid_config"; await this.persist(state, false); return null; }
      if (!config) { state.status = "not_configured"; await this.persist(state, false); return null; }
      if (state.blockedGeneration === config.generation) { await this.persist(state, false); return null; }
      if (state.run && !state.run.complete) {
        if (Date.now() <= state.run.deadlineMs + 15_000) { state.nextAtMs = state.run.deadlineMs + 15_000; await this.persist(state); return null; }
        if (state.run.pendingAttempt && !state.run.resolvedAttempt) { state.status = "auth_uncertain"; state.blockedGeneration = state.run.generation;
          if (state.blockedGeneration === config.generation) { await this.persist(state, false); return null; }
        }
      }
      if (state.nextAtMs > Date.now() + 1000) { await this.persist(state); return null; }
      const now = Date.now();
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const runId = crypto.randomUUID().replaceAll("-", "");
      state.run = { id: runId, token, generation: config.generation, startedAtMs: now, deadlineMs: now + JOB_MS,
        pendingAttempt: null, resolvedAttempt: false, complete: false, catalog: null, checkpoints: {} };
      state.status = "collecting";
      state.lastFailure = null;
      state.blockedGeneration = null;
      state.lastRunAtMs = now;
      state.nextAtMs = now + INTERVAL_MS;
      let serviceToken = await this.ctx.storage.get<string>("containerToken");
      if (!serviceToken) { serviceToken = token; await this.ctx.storage.put("containerToken", serviceToken); }
      this.envVars = { OFFICIAL_COLLECTOR_TOKEN: serviceToken, OFFICIAL_CALLBACK_ORIGIN: CALLBACK_ORIGIN };
      await this.persist(state);
      return { contract: "haneoka:official-ranking-job/1", region, runId, credentialGeneration: config.generation,
        clientVersion: config.clientVersion, credentials: config.credentials, masterConfig: config.masterConfig,
        callbackUrl: `${CALLBACK_ORIGIN}/api/internal/official-rankings/${region}/${runId}`, callbackToken: token, deadlineMs: now + JOB_MS };
    });
    if (!job) return;
    let failure: OfficialCollectorFailure | null = null;
    try {
      const serviceToken = await this.ctx.storage.get<string>("containerToken");
      const response = await this.containerFetch("http://container/collect", { method: "POST",
        headers: { Authorization: `Bearer ${serviceToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(job), signal: AbortSignal.timeout(JOB_MS + 15_000) });
      if (!response.ok) failure = await responseFailure(response) ?? { stage: "container", code: "http_error", httpStatus: response.status };
      else await response.body?.cancel();
    } catch (error) {
      failure = { stage: "container", code: error instanceof Error && error.name === "TimeoutError" ? "TimeoutError" : "container_fetch_failed" };
    }
    if (failure) console.warn(JSON.stringify({ event: "official_ranking_container_failed", region, ...failure }));
    await this.serialized(async () => {
      const state = await this.stateFor(region);
      if (!state.run || state.run.id !== job.runId || state.run.complete) return;
      state.run.complete = true;
      state.lastFailure = failure ?? { stage: "container", code: "container_fetch_failed" };
      state.failures += 1;
      state.nextAtMs = Math.max(state.nextAtMs, Date.now() + Math.min(3_600_000, INTERVAL_MS * 2 ** Math.min(4, state.failures - 1)));
      if (state.run.pendingAttempt && !state.run.resolvedAttempt && !state.blockedGeneration) {
        state.status = "auth_uncertain"; state.blockedGeneration = job.credentialGeneration;
      }
      else if (!state.blockedGeneration && state.status !== "rate_limited") state.status = "failed";
      await this.persist(state, !state.blockedGeneration);
    });
  }

  async callback(request: Request, region: GameRecordsRegion, runId: string): Promise<Response> {
    if (request.method !== "POST" || !/^[a-f0-9]{32}$/u.test(runId)) return json({ error: "invalid_request" }, 400);
    const state = await this.stateFor(region);
    const authorization = request.headers.get("Authorization") ?? "";
    if (!state.run || state.run.id !== runId || !authorization.startsWith("Bearer ")
      || !await sameToken(authorization.slice(7), state.run.token)) return json({ error: "unauthorized" }, 401);
    let update: OfficialCollectorUpdate;
    try { update = await boundedUpdate(request); }
    catch { return json({ error: "invalid_update" }, 400); }
    return this.serialized(async () => {
      const state = await this.stateFor(region);
      const run = state.run;
      if (!run || run.id !== runId || update.contract !== "haneoka:official-ranking-update/1"
        || update.region !== region || update.runId !== runId || update.credentialGeneration !== run.generation) return json({ error: "run_mismatch" }, 409);
      let checkpoint: string;
      if (update.type === "catalog" || update.type === "complete") checkpoint = update.type;
      else if (update.type === "attempt") checkpoint = `attempt:${update.snapshotId}`;
      else if (update.type === "observation") checkpoint = `observation:${update.observation?.snapshotId}`;
      else if (update.type === "arena-observation") checkpoint = `arena:${update.observation?.snapshotId}`;
      else return json({ error: "invalid_update" }, 400);
      const updateHash = await officialDigest(canonical(update));
      if (run.checkpoints[checkpoint]) {
        if (run.checkpoints[checkpoint] !== updateHash) return json({ error: "checkpoint_conflict" }, 409);
        if (update.type === "attempt" && (run.complete || run.pendingAttempt !== update.snapshotId || state.blockedGeneration)) {
          return json({ error: "attempt_finished" }, 409);
        }
        return json({ ok: true });
      }
      if (run.complete) return json({ error: "run_finished" }, 409);
      if (Date.now() > run.deadlineMs + 10_000) return json({ error: "run_expired" }, 409);
      try {
        if (update.type === "catalog") {
          validateCatalog(update.catalog, region);
          if (run.pendingAttempt) return json({ error: "attempt_pending" }, 409);
          await saveOfficialCatalog(this.env, update.catalog);
          run.catalog = update.catalog;
          run.checkpoints[checkpoint] = updateHash;
          await this.ctx.storage.put("collectorState", state);
        } else if (update.type === "attempt") {
          if (!/^[a-f0-9]{32}$/u.test(update.snapshotId) || run.pendingAttempt || state.blockedGeneration || !(run.catalog?.event || run.catalog?.arena)) return json({ error: "attempt_pending" }, 409);
          run.pendingAttempt = update.snapshotId;
          run.resolvedAttempt = false;
          run.checkpoints[checkpoint] = updateHash;
          await this.ctx.storage.put("collectorState", state);
        } else if (update.type === "observation") {
          validateObservation(update.observation, region);
          if (run.pendingAttempt !== update.observation.snapshotId) return json({ error: "attempt_mismatch" }, 409);
          const event = run.catalog?.event;
          if (!event || update.observation.eventId !== event.id || update.observation.observedAtMs < run.startedAtMs
            || (update.observation.kind === "total" ? !event.totalRankingEnabled
              : !event.challenges.some((challenge) => challenge.id === update.observation.challengeId && challenge.enabled))) {
            return json({ error: "board_mismatch" }, 409);
          }
          run.resolvedAttempt = true;
          if (authRejected(update.observation)) { state.blockedGeneration = run.generation; state.status = "auth_paused"; }
          if (limited(update.observation)) { state.status = "rate_limited"; state.nextAtMs = Math.max(state.nextAtMs, Date.now() + retryMs(update.observation.retryAfterSeconds)); }
          await this.ctx.storage.put("collectorState", state);
          await saveOfficialObservation(this.env, update.observation);
          run.pendingAttempt = null;
          run.checkpoints[checkpoint] = updateHash;
          if (!update.observation.error) state.lastSuccessfulObservationAtMs = Math.max(state.lastSuccessfulObservationAtMs ?? 0, update.observation.observedAtMs);
          await this.ctx.storage.put("collectorState", state);
        } else if (update.type === "arena-observation") {
          validateArenaObservation(update.observation, region);
          if (run.pendingAttempt !== update.observation.snapshotId) return json({ error: "attempt_mismatch" }, 409);
          const arena = run.catalog?.arena;
          if (!arena || update.observation.seasonId !== arena.seasonId || !arena.bandIds.includes(update.observation.bandId)
            || update.observation.observedAtMs < run.startedAtMs) {
            return json({ error: "board_mismatch" }, 409);
          }
          run.resolvedAttempt = true;
          if (authRejected(update.observation)) { state.blockedGeneration = run.generation; state.status = "auth_paused"; }
          if (limited(update.observation)) { state.status = "rate_limited"; state.nextAtMs = Math.max(state.nextAtMs, Date.now() + retryMs(update.observation.retryAfterSeconds)); }
          await this.ctx.storage.put("collectorState", state);
          await saveOfficialArenaObservation(this.env, update.observation);
          run.pendingAttempt = null;
          run.checkpoints[checkpoint] = updateHash;
          if (!update.observation.error) state.lastSuccessfulObservationAtMs = Math.max(state.lastSuccessfulObservationAtMs ?? 0, update.observation.observedAtMs);
          await this.ctx.storage.put("collectorState", state);
        } else if (update.type === "complete") {
          if (run.pendingAttempt || !["ok", "failed", "auth_paused", "rate_limited"].includes(update.status)) return json({ error: "attempt_pending" }, 409);
          if (update.failure !== undefined) validateFailure(update.failure);
          run.complete = true;
          state.lastFailure = update.failure ? { stage: update.failure.stage, code: update.failure.code,
            ...(update.failure.httpStatus !== undefined ? { httpStatus: update.failure.httpStatus } : {}),
            ...(update.failure.grpcStatus !== undefined ? { grpcStatus: update.failure.grpcStatus } : {}) } : null;
          state.status = state.blockedGeneration ? state.status : state.status === "rate_limited" ? "rate_limited" : update.status;
          state.failures = update.status === "ok" ? 0 : state.failures + 1;
          if (update.status === "auth_paused") state.blockedGeneration = run.generation;
          if (update.status === "rate_limited") state.nextAtMs = Math.max(state.nextAtMs, Date.now() + retryMs(update.retryAfterSeconds));
          if (update.status === "failed") state.nextAtMs = Math.max(state.nextAtMs, Date.now() + Math.min(3_600_000, INTERVAL_MS * 2 ** Math.min(4, state.failures - 1)));
          run.checkpoints[checkpoint] = updateHash;
          await this.persist(state, !state.blockedGeneration);
        } else return json({ error: "invalid_update" }, 400);
      } catch (error) {
        console.warn(JSON.stringify({ event: "official_ranking_checkpoint_failed", region, error: error instanceof Error ? error.name : "Error" }));
        return json({ error: "checkpoint_failed" }, 503);
      }
      return json({ ok: true });
    });
  }

  override async fetch(): Promise<Response> { return json({ error: "not_found" }, 404); }
}
