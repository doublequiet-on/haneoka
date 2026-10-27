// L3 — GEB
// Input: 游戏区服、资源 ID 和查询参数。
// Output: 羽丘游戏 API 的类型化读取与图片 URL。
// Pos: [Map](../../L2.md)；公开游戏能力客户端。
// Effects/Dependencies: 经公共 ApiClient 传输，无内置密钥。
import { createApiClient, type ApiClientOptions, type ApiQuery } from "./index.js";
import type * as Game from "./game-types.js";
export type * from "./game-types.js";
export type GameRegion = "jp" | "tw" | "en" | "kr";
export interface GameReadOptions { signal?: AbortSignal }
export interface GameClientOptions extends Omit<ApiClientOptions, "baseUrl"> { baseUrl?: string; region: GameRegion }
const id = (value: string) => {
  if (!/^[1-9][0-9]{0,18}$/u.test(value)) throw new TypeError("ID must be a positive decimal string");
  return value;
};
const accountKey = (value: string) => {
  if (!value || value.length > 256 || /[\/\\\x00-\x1f]/u.test(value)) throw new TypeError("Invalid account ID");
  return encodeURIComponent(value);
};
export function createGameClient(options: GameClientOptions) {
  if (!["jp", "tw", "en", "kr"].includes(options.region)) throw new TypeError("Invalid game region");
  const api = createApiClient({ ...options, baseUrl: options.baseUrl ?? "https://haneoka.org/api/v1/" });
  const read = <T>(path: string, query: ApiQuery = {}, scope: GameReadOptions = {}) => api.get<T>(path, { query: { region: options.region, ...query }, ...scope });
  return {
    profile: (profileId: string, scope?: GameReadOptions) => read<Game.AppFriendFindByProfileIDResponse>(`players/${id(profileId)}`, {}, scope),
    profiles: (accountIds: readonly string[], scope?: GameReadOptions) => {
      if (!accountIds.length || accountIds.length > 100) throw new RangeError("Supply 1–100 account IDs");
      return read<Game.AppPlayerextGetPlayerListResponse>("players", { accountId: accountIds.map(id) }, scope);
    },
    favorites: (accountId: string, scope?: GameReadOptions) => read<Game.AppPlayerGetPlayerFavoriteStatusResponse>("players/favorites", { accountId: decodeURIComponent(accountKey(accountId)) }, scope),
    profileCardUrl: (profileId: string, page = 1) => {
      if (!Number.isSafeInteger(page) || page < 1) throw new RangeError("page must be a positive integer");
      return api.url(`players/${id(profileId)}/cards/${page}.png`, { region: options.region });
    },
    songRanking: (songId: string, scope?: GameReadOptions) => read<Game.AppLivemusicGetRankingResponse>(`songs/${id(songId)}/ranking`, {}, scope),
    eventRanking: (eventId: string, ranks: readonly number[], scope?: GameReadOptions) => read<Game.AppEventGetRankingListResponse>(`events/${id(eventId)}/ranking`, { rank: ranks }, scope),
    challengeRanking: (challengeId: string, scope?: GameReadOptions) => read<Game.AppEventGetChallengeMusicRankingResponse>(`events/challenges/${id(challengeId)}/ranking`, {}, scope),
    eventDeck: (eventId: string, accountId: string, scope?: GameReadOptions) => read<Game.AppEventGetDeckResponse>(`events/${id(eventId)}/decks/${accountKey(accountId)}`, {}, scope),
    arenaRanking: (seasonId: string, range: { start: number; end: number; bandId?: string }, scope?: GameReadOptions) => read<Game.AppArenaArenaRankingResponse>(`arena/seasons/${id(seasonId)}/ranking`, range, scope),
    arenaDecks: (seasonId: string, songId: string, scope?: GameReadOptions) => read<Game.AppArenaDeckTrendResponse>(`arena/seasons/${id(seasonId)}/songs/${id(songId)}/decks`, {}, scope),
    circle: (circleId: string, scope?: GameReadOptions) => read<Game.AppCircleGetCircleResponse>(`circles/${id(circleId)}`, {}, scope),
    circles: (query: { name?: string; memberRange?: string | number; joinRule?: string | number; playStyle?: string | number }, scope?: GameReadOptions) => read<Game.AppCircleSearchResponse>("circles", query, scope),
    gachaRates: <T = unknown>(gachaId: string, query: { productId?: string; pickupId?: readonly string[] } = {}, scope?: GameReadOptions) => read<T>(`gacha/${id(gachaId)}/rates`, query, scope),
    announcements: <T = unknown>(query: { category?: string | number } = {}, scope?: GameReadOptions) => read<T>("announcements/views/live", query, scope),
    announcement: <T = unknown>(announcementId: string, scope?: GameReadOptions & { revision?: string }) => read<T>(`announcements/${id(announcementId)}/live`, { revision: scope?.revision }, scope),
    events: <T = unknown>(scope?: GameReadOptions) => read<T>("events/views/live", {}, scope),
    currentEvent: <T = unknown>(scope?: GameReadOptions) => read<T>("events/views/current", {}, scope),
    event: <T = unknown>(eventId: string, scope?: GameReadOptions) => read<T>(`events/${id(eventId)}/snapshots`, {}, scope),
    eventSnapshot: <T = unknown>(eventId: string, scope?: GameReadOptions) => read<T>(`events/${id(eventId)}/snapshots/latest`, {}, scope),
    eventChallenges: <T = unknown>(eventId: string, scope?: GameReadOptions) => read<T>(`events/${id(eventId)}/challenges`, {}, scope),
    eventChallengeRanking: <T = unknown>(eventId: string, challengeId: string, scope?: GameReadOptions) => read<T>(`events/${id(eventId)}/challenges/${id(challengeId)}/ranking`, {}, scope),
    announcementRevisions: <T = unknown>(announcementId: string, scope?: GameReadOptions) => read<T>(`announcements/${id(announcementId)}/revisions`, {}, scope),
  };
}
