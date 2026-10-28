// L3 — GEB
// Input: Release-pinned Arena Master rows and a server timestamp.
// Output: League schedules, shared song overrides and their next transition.
// Pos: [Map](L2-2.md); shared Arena rules for the workspace and calculation contract.
// Effects/Dependencies: Pure projection; schedules remain owned by their source server.
import { dataRows, nativeRow, objectRow, type TeamBuilderData } from "./data";
import { songMissions } from "../catalog-filters";

export const ARENA_MASTER_TABLES = {
  seasons: "MasterArenaSeason",
  leagues: "MasterArenaLeague",
  regulations: "MasterArenaLeagueRegulation",
} as const;

export interface ArenaRule {
  musicType: number;
  missions: [number, number, number];
}
export type SongRules = ArenaRule;
export const ORIGINAL_SONG_RULES: SongRules = { musicType: 0, missions: [0, 0, 0] };
export function readSongRules(value: unknown): SongRules {
  const row = objectRow(value);
  const musicType = Number(row.musicType);
  const missions = Array.isArray(row.missions) ? row.missions : [];
  return {musicType: [0,1,2,3,4,5,99].includes(musicType) ? musicType : 0,
    missions: [0,1,2].map(index => [0,1,2,3].includes(Number(missions[index])) ? Number(missions[index]) : 0) as SongRules["missions"]};
}
export function activeSongRules(rule: SongRules | undefined, gekiso: boolean): SongRules | undefined {
  if (!rule) return undefined;
  const missions: SongRules["missions"] = gekiso ? [...rule.missions] : [0, 0, 0];
  return rule.musicType || missions.some(Boolean) ? { musicType: rule.musicType, missions } : undefined;
}
export function arenaReleaseAt(row: Record<string, unknown>): number | null {
  const value = row.publishedAt ?? row.releasedAt;
  const at = Array.isArray(value) ? value.find((value) => typeof value === "number") : value;
  return typeof at === "number" ? at : null;
}
export function arenaReleased(row: Record<string, unknown>, now = Date.now()): boolean {
  const at = arenaReleaseAt(row);
  return at === null || at <= now;
}
export function arenaSongView(song: Record<string, unknown>, rule: ArenaRule): Record<string, unknown> {
  const original = songMissions(song);
  return {
    ...song,
    musicType: rule.musicType || song.musicType,
    gekisou: {
      ...objectRow(song.gekisou),
      missionTypes: rule.missions.map(
        (type, index) => type || ["", "Combo", "Luck", "JustCount"].indexOf(original[index] ?? ""),
      ),
    },
  };
}
export interface ArenaRegulation extends ArenaRule {
  id: number;
  leagueId: number;
  startAt: number;
  endAt: number;
}
export interface ArenaCatalog {
  identity: TeamBuilderData["identity"];
  timeZone: string;
  seasons: { id: number; startAt: number; endAt: number }[];
  leagues: { id: number; bandId: number; startAt: number }[];
  regulations: ArenaRegulation[];
}

function gameTime(value: unknown): number {
  if (!value) return 0;
  const parts = String(value).match(/\d+/gu)!.map(Number);
  return Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5]!) - 9 * 3_600_000;
}

export function adaptArenaCatalog(identity: TeamBuilderData["identity"], value: unknown): ArenaCatalog | null {
  const tables = objectRow(value);
  if (
    Object.values(ARENA_MASTER_TABLES).some((table) => objectRow(tables[table]).status === "missing") ||
    !Object.keys(tables).length
  )
    return null;
  const rows = (table: string) => dataRows(objectRow(tables[table]).rows).map(nativeRow);
  return {
    identity: { ...identity },
    timeZone: "Asia/Tokyo",
    seasons: rows(ARENA_MASTER_TABLES.seasons).map((row) => ({
      id: Number(row.id),
      startAt: gameTime(row.startAt),
      endAt: gameTime(row.endAt) + 1000,
    })),
    leagues: rows(ARENA_MASTER_TABLES.leagues).map((row) => ({
      id: Number(row.id),
      bandId: Number(row.bandId),
      startAt: gameTime(row.startAt),
    })),
    regulations: rows(ARENA_MASTER_TABLES.regulations).map((row) => ({
      id: Number(row.id),
      leagueId: Number(row.leagueId),
      musicType: Number(row.liveMusicType),
      missions: [Number(row.gekisouMission1), Number(row.gekisouMission2), Number(row.gekisouMission3)],
      startAt: gameTime(row.startAt),
      endAt: gameTime(row.endAt) + 1000,
    })),
  };
}

export function arenaPeriod(catalog: ArenaCatalog | null | undefined, leagueId: number, now: number) {
  const season = catalog?.seasons.find((row) => row.startAt <= now && now < row.endAt) ?? null;
  const regulation = season
    ? (catalog!.regulations
        .filter((row) => row.leagueId === leagueId && row.startAt <= now && now < row.endAt)
        .sort((a, b) => b.startAt - a.startAt)[0] ?? null)
    : null;
  const transitions = [
    ...(catalog?.seasons ?? []).flatMap((row) => [row.startAt, row.endAt]),
    ...(catalog?.regulations ?? [])
      .filter((row) => row.leagueId === leagueId)
      .flatMap((row) => [row.startAt, row.endAt]),
  ].filter((time) => time > now);
  return { season, regulation, nextAt: transitions.length ? Math.min(...transitions) : null };
}
