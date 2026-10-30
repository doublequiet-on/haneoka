// L3 — GEB
// Input: Region, Arena season, league band, rank window, tier thresholds or profile ID, and provider bindings.
// Output: Normalized Arena league rankings, per-tier populations and profile lookups.
// Pos: [Map](L2.md); Arena read adapter beside song rankings, preferring official collector windows.
// Effects/Dependencies: Reads official D1/R2 windows when enabled, else the Moenotes open API; edge cache only.
import type {
  ArenaPopulationDto,
  ArenaSearchDto,
  ArenaRankingDto,
  ArenaRankingRowDto,
  GameRecordsRegion,
  SongRankingCardDto,
} from "../src/lib/game-records";
import { officialRankingReadEnabled, type OfficialRankingReadBindings } from "./official-ranking-api";
import { readOfficialArenaLatest } from "./official-ranking-store";

export interface ArenaRankingBindings extends OfficialRankingReadBindings {
  MOENOTES_OPEN_API_TOKEN?: string;
  MOENOTES_PROFILE_API_TOKEN?: string;
}

const PREFIX = "/api/v1/game/records";
const REGIONS: readonly GameRecordsRegion[] = ["jp", "tw", "en", "kr"];
const WINDOW = 100;
const RANKING_TTL = 60;
const POPULATION_TTL = 1800;
const SEARCH_TTL = 300;
/** Ranks scanned by profile-ID search: 20 windows. */
const SEARCH_DEPTH = 2000;

class ArenaFailure extends Error {
  readonly status: number;
  readonly kind: string;
  readonly retryAfter: number | null;
  constructor(status: number, kind: string, retryAfter: number | null = null) {
    super(kind);
    this.status = status;
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const integer = (value: unknown): number | null => {
  const number =
    typeof value === "number" ? value : typeof value === "string" && /^-?[0-9]+$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) ? number : null;
};
const positive = (value: unknown): number | null => {
  const number = integer(value);
  return number !== null && number > 0 ? number : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
/** Upstream and official payloads share field meanings; the official collector keeps the game's snake_case. */
const field = (row: Record<string, unknown>, camel: string) =>
  row[camel] ?? row[camel.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)];

function card(value: unknown, index: number): SongRankingCardDto {
  const entry = object(value);
  const member = object(field(entry, "memberCard")),
    support = object(field(entry, "supportCard"));
  const memberId = positive(field(member, "cardId")),
    supportId = positive(field(support, "cardId"));
  return {
    slot: integer(field(entry, "slotIndex")) ?? index,
    memberCardId: memberId,
    memberExp: memberId ? integer(member.exp) : null,
    memberAwakeCount: memberId ? integer(field(member, "awakeCount")) : null,
    memberRank: memberId ? integer(field(member, "cardRank")) : null,
    supportCardId: supportId,
    supportExp: supportId ? integer(support.exp) : null,
    supportRank: supportId ? integer(support.rank) : null,
  };
}

export function arenaRankingRow(value: unknown, fallbackRank: number): ArenaRankingRowDto {
  const entry = object(value);
  const profile = object(entry.profile ?? field(entry, "playerData"));
  const favorite = object(field(profile, "favoriteMemberCard"));
  const deck = object(entry.deck ?? field(entry, "highScoreDeck"));
  const favoriteId = positive(field(favorite, "cardId")) ?? positive(field(profile, "favoriteMemberCardMasterId"));
  return {
    rank: positive(entry.rank) ?? fallbackRank,
    tied: false,
    playerId: text(profile.id),
    profileId: text(field(profile, "profileId")),
    name: text(profile.name) ?? "",
    rankExp: integer(field(profile, "rankExp")),
    favoriteMemberCardId: favoriteId,
    favoriteMemberExp: positive(field(favorite, "cardId")) ? integer(favorite.exp) : null,
    favoriteMemberAwakeCount: positive(field(favorite, "cardId")) ? integer(field(favorite, "awakeCount")) : null,
    favoriteMemberRank: positive(field(favorite, "cardId")) ? integer(field(favorite, "cardRank")) : null,
    score: null,
    point: integer(entry.point) ?? 0,
    deckId: positive(deck.id),
    deckName: text(deck.name),
    totalPower: positive(field(deck, "totalPower")),
    profileCard: null,
    cards: (Array.isArray(deck.cards) ? deck.cards : [])
      .slice(0, 5)
      .map(card)
      .sort((a, b) => a.slot - b.slot),
  };
}

function markTies(rows: ArenaRankingRowDto[]) {
  rows.forEach((row, index) => {
    row.tied = rows[index - 1]?.rank === row.rank || rows[index + 1]?.rank === row.rank;
  });
  return rows;
}

interface Window {
  maxRank: number | null;
  rows: ArenaRankingRowDto[];
  provider: "official" | "moenotes";
  observedAtMs: number;
}

async function moenotesWindow(
  env: ArenaRankingBindings,
  region: GameRecordsRegion,
  seasonId: string,
  bandId: string,
  start: number,
): Promise<Window> {
  const open = env.MOENOTES_OPEN_API_TOKEN?.trim(),
    token = open || env.MOENOTES_PROFILE_API_TOKEN?.trim();
  if (!token) throw new ArenaFailure(503, "pending", 60);
  const target = new URL(
    open
      ? `https://passport.bdon.moe/api/open/v1/moenotes/${region}/arena/ranking`
      : `https://bdon-api.bdon.moe/v1/${region}/arena/ranking`,
  );
  target.searchParams.set("arenaSeasonId", seasonId);
  target.searchParams.set("bandId", bandId);
  target.searchParams.set("rankingStart", String(start));
  target.searchParams.set("rankingEnd", String(start + WINDOW - 1));
  let response: Response;
  try {
    response = await fetch(target, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": "Haneoka/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ArenaFailure(504, "timeout");
  }
  if (!response.ok) {
    await response.body?.cancel();
    const retry = integer(response.headers.get("Retry-After"));
    throw response.status === 404
      ? new ArenaFailure(404, "not_found")
      : response.status === 429
        ? new ArenaFailure(429, "rate_limited", retry ?? 60)
        : new ArenaFailure(502, "upstream");
  }
  const body = object(await response.json().catch(() => null));
  if (!Array.isArray(body.ranking)) throw new ArenaFailure(502, "upstream");
  return {
    maxRank: integer(body.maxRank),
    rows: markTies(body.ranking.slice(0, WINDOW).map((row, index) => arenaRankingRow(row, start + index))),
    provider: "moenotes",
    observedAtMs: Date.now(),
  };
}

async function arenaWindow(
  env: ArenaRankingBindings,
  region: GameRecordsRegion,
  seasonId: string,
  bandId: string,
  start: number,
): Promise<Window> {
  if (officialRankingReadEnabled(env, region) && env.DB && env.OFFICIAL_RANKING_DATA) {
    const official = await readOfficialArenaLatest(env, region, seasonId, bandId, start).catch(() => null);
    if (official?.players) {
      const rows = official.players
        .map((row, index) => arenaRankingRow(row, official.startRank + index))
        .filter((row) => row.rank >= start && row.rank < start + WINDOW);
      return {
        maxRank: official.maxRank ?? null,
        rows: markTies(rows),
        provider: "official",
        observedAtMs: official.observedAtMs,
      };
    }
  }
  return moenotesWindow(env, region, seasonId, bandId, start);
}

/**
 * Players with at least `threshold` points, and the window holding the last of them. Points fall
 * with rank, so the window is found by interpolating between bracketing windows, with bisection as
 * the fallback when the estimate does not shrink the bracket. `first` must start at or above the
 * threshold and `last` bounds the search from above.
 */
export async function countAtLeast(
  load: (start: number) => Promise<Window>,
  maxRank: number,
  threshold: number,
  first = 0,
  last = Math.max(0, Math.ceil(maxRank / WINDOW) - 1),
): Promise<{ count: number; window: number }> {
  const head = async (index: number) => (await load(index * WINDOW + 1)).rows[0]?.point ?? -1;
  let low = first,
    lowPoint = await head(first),
    high = last + 1,
    highPoint = -1;
  if (lowPoint < threshold) return { count: first * WINDOW, window: first };
  if (last > first) {
    const lastPoint = await head(last);
    if (lastPoint >= threshold) {
      low = last;
      lowPoint = lastPoint;
    } else {
      high = last;
      highPoint = lastPoint;
    }
  }
  let interpolate = true;
  while (high - low > 1) {
    const estimate =
      highPoint >= 0 && interpolate
        ? low + Math.round(((lowPoint - threshold) / Math.max(1, lowPoint - highPoint)) * (high - low))
        : (low + high) >> 1;
    const middle = Math.min(high - 1, Math.max(low + 1, estimate));
    const point = await head(middle);
    const before = high - low;
    if (point >= threshold) {
      low = middle;
      lowPoint = point;
    } else {
      high = middle;
      highPoint = point;
    }
    interpolate = (high - low) * 2 < before;
  }
  const window = await load(low * WINDOW + 1);
  const below = window.rows.find((row) => row.point < threshold);
  return { count: below ? below.rank - 1 : Math.min(maxRank, low * WINDOW + window.rows.length), window: low };
}

/**
 * Counts for ascending thresholds: the middle one first, then each half searched only between the
 * windows its neighbours already found.
 */
export async function countThresholds(
  load: (start: number) => Promise<Window>,
  maxRank: number,
  thresholds: readonly number[],
): Promise<number[]> {
  const counts = new Array<number>(thresholds.length);
  const last = Math.max(0, Math.ceil(maxRank / WINDOW) - 1);
  const solve = async (from: number, to: number, first: number, upper: number): Promise<void> => {
    if (from > to) return;
    const middle = (from + to) >> 1;
    const threshold = thresholds[middle]!;
    let window = first;
    if (threshold === 0) counts[middle] = maxRank;
    else if (first === 0 && (await load(1)).rows[0]!.point < threshold) counts[middle] = 0;
    else ({ count: counts[middle], window } = await countAtLeast(load, maxRank, threshold, first, upper));
    await Promise.all([solve(from, middle - 1, window, upper), solve(middle + 1, to, first, window)]);
  };
  if ((await load(1)).rows.length) await solve(0, thresholds.length - 1, 0, last);
  else counts.fill(0);
  return counts;
}

/** At most `limit` upstream reads at a time. */
function limiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

function json(request: Request, body: unknown, status = 200, maxAge = 0, retryAfter: number | null = null): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  });
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status, headers });
}

async function cached(
  request: Request,
  ctx: ExecutionContext,
  ttl: number,
  produce: () => Promise<unknown>,
  /** Seconds to wait before answering 202 while the computation finishes into the cache. */
  patience = 0,
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return request.method === "HEAD" ? new Response(null, hit) : hit;
  const pending = produce().then(
    (body) => {
      const response = json(request, body, 200, ttl);
      if (request.method === "GET") ctx.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
      return response;
    },
    (error: unknown) => {
      const failure = error instanceof ArenaFailure ? error : new ArenaFailure(502, "upstream");
      return json(
        request,
        { error: { kind: failure.kind, retryAfter: failure.retryAfter } },
        failure.status,
        0,
        failure.retryAfter,
      );
    },
  );
  if (!patience) return pending;
  ctx.waitUntil(pending);
  const waited = await Promise.race([
    pending,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), patience * 1000)),
  ]);
  return waited ?? json(request, { error: { kind: "pending", retryAfter: 10 } }, 202, 0, 10);
}

/** The top SEARCH_DEPTH ranks of one board, shared by every profile-ID search for five minutes. */
async function searchIndex(
  ctx: ExecutionContext,
  env: ArenaRankingBindings,
  region: GameRecordsRegion,
  seasonId: string,
  bandId: string,
): Promise<{ searchedTo: number; observedAtMs: number; rows: ArenaRankingRowDto[] }> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(
    `https://haneoka.org${PREFIX}/${region}/arena/seasons/${seasonId}/leagues/${bandId}/search-index`,
  );
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit.json();
  const slot = limiter(4);
  const first = await arenaWindow(env, region, seasonId, bandId, 1);
  const maxRank = first.maxRank;
  const count = Math.min(SEARCH_DEPTH, maxRank ?? first.rows.length) / WINDOW;
  const windows = [
    first,
    ...(await Promise.all(
      Array.from({ length: Math.max(0, Math.ceil(count) - 1) }, (_, index) =>
        slot(() => arenaWindow(env, region, seasonId, bandId, (index + 1) * WINDOW + 1)),
      ),
    )),
  ];
  const rows = windows.flatMap((window) => window.rows);
  const index = {
    searchedTo: Math.min(SEARCH_DEPTH, maxRank ?? rows.length),
    observedAtMs: windows[0]?.observedAtMs ?? Date.now(),
    rows,
  };
  ctx.waitUntil(
    cache
      .put(key, new Response(JSON.stringify(index), { headers: { "Cache-Control": `public, max-age=${SEARCH_TTL}` } }))
      .catch(() => undefined),
  );
  return index;
}

/**
 * `GET /api/v1/game/records/{region}/arena/seasons/{seasonId}/leagues/{bandId}/ranking?start=1`
 * returns ranks start…start+99; `…/population?thresholds=0,10,…` returns the players at or above
 * each tier's lowest points.
 */
export async function handleArenaRankingApi(
  request: Request,
  ctx: ExecutionContext,
  url: URL,
  env: ArenaRankingBindings,
): Promise<Response | null> {
  const route = new RegExp(
    `^${PREFIX}/([a-z]+)/arena/seasons/([1-9][0-9]{0,9})/leagues/([1-9][0-9]{0,9})/(ranking|population|search)$`,
    "u",
  ).exec(url.pathname);
  if (!route) return null;
  if (request.method !== "GET" && request.method !== "HEAD")
    return json(request, { error: { kind: "method_not_allowed" } }, 405);
  const region = route[1] as GameRecordsRegion,
    seasonId = route[2]!,
    bandId = route[3]!,
    operation = route[4];
  if (!REGIONS.includes(region)) return json(request, { error: { kind: "not_found" } }, 404);
  if (operation === "search") {
    const profileId = url.searchParams.get("profileId") ?? "";
    if (!/^[1-9][0-9]{0,18}$/u.test(profileId) || [...url.searchParams.keys()].some((key) => key !== "profileId"))
      return json(request, { error: { kind: "invalid_request" } }, 400);
    return cached(request, ctx, SEARCH_TTL, async () => {
      const index = await searchIndex(ctx, env, region, seasonId, bandId);
      return {
        region,
        seasonId,
        bandId,
        profileId,
        searchedTo: index.searchedTo,
        observedAtMs: index.observedAtMs,
        row: index.rows.find((row) => row.profileId === profileId) ?? null,
      } satisfies ArenaSearchDto;
    });
  }
  if (operation === "ranking") {
    const start = url.searchParams.get("start") ?? "1";
    if (
      !/^[1-9][0-9]{0,8}$/u.test(start) ||
      [...url.searchParams.keys()].some((key) => key !== "start") ||
      url.searchParams.getAll("start").length > 1
    )
      return json(request, { error: { kind: "invalid_request" } }, 400);
    return cached(request, ctx, RANKING_TTL, async () => {
      const first = Number(start);
      const window = await arenaWindow(env, region, seasonId, bandId, first);
      return {
        region,
        seasonId,
        bandId,
        start: first,
        end: first + WINDOW - 1,
        provider: window.provider,
        observedAtMs: window.observedAtMs,
        fetchedAtMs: window.observedAtMs,
        serverTimeMs: Date.now(),
        stale: false,
        maxRank: window.maxRank,
        rows: window.rows,
      } satisfies ArenaRankingDto;
    });
  }
  const raw = url.searchParams.get("thresholds") ?? "";
  const thresholds = raw.split(",").map(Number);
  if (
    !/^(0|[1-9][0-9]{0,8})(,(0|[1-9][0-9]{0,8})){0,31}$/u.test(raw) ||
    thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1]!) ||
    [...url.searchParams.keys()].some((key) => key !== "thresholds")
  )
    return json(request, { error: { kind: "invalid_request" } }, 400);
  return cached(
    request,
    ctx,
    POPULATION_TTL,
    async () => {
      const windows = new Map<number, Promise<Window>>();
      const slot = limiter(4);
      const load = (start: number) => {
        let pending = windows.get(start);
        if (!pending) windows.set(start, (pending = slot(() => arenaWindow(env, region, seasonId, bandId, start))));
        return pending;
      };
      const top = await load(1);
      const maxRank = top.maxRank ?? top.rows.length;
      const atLeast = await countThresholds(load, maxRank, thresholds);
      return {
        region,
        seasonId,
        bandId,
        provider: top.provider,
        observedAtMs: Date.now(),
        maxRank: top.maxRank,
        tiers: thresholds.map((threshold, index) => ({
          threshold,
          count: Math.max(0, atLeast[index]! - (atLeast[index + 1] ?? 0)),
        })),
      } satisfies ArenaPopulationDto;
    },
    20,
  );
}
