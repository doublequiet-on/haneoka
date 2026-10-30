// L3 — GEB
// Input: Canonical voice categories and legacy Master voice records.
// Output: Game collection order, fine-grained kinds, display labels and audio lines.
// Pos: [Map](../L2-2.md); shared character voice presentation.
// Effects/Dependencies: Resolves interface labels through the locale catalogue.
import { clientText } from "../../i18n/client";
import type { JsonRecord } from "./catalog";
import { formatDate } from "../../lib/date-format";

export function voiceText(locale: string, key: string, ...values: Array<string | number>): string {
  return clientText(locale, `media.voice.${key}`, key, values);
}

// The first fifteen groups follow the game's collection presenter VoiceType.
export const VOICE_GROUPS = [
  "normal",
  "realLive",
  "feature",
  "seasonal",
  "birthday",
  "growth",
  "gacha",
  "liveStart",
  "gekisouStart",
  "gekisouEnd",
  "liveEnd",
  "liveDialogue",
  "livePairDialogue",
  "liveResult",
  "liveBattleResult",
  "location",
  "title",
  "other",
] as const;
export type VoiceGroup = (typeof VOICE_GROUPS)[number];
export const VOICE_TABS = ["comment", "growth", "gacha", "live", "location", "title", "other"] as const;
export type VoiceTab = (typeof VOICE_TABS)[number];
const TALK_KINDS = [
  "normal",
  "characterRankUp",
  "seasonal",
  "birthday",
  "login",
  "exchange",
  "realLiveDay",
  "levelUp",
  "realLiveBefore",
];
const CHARACTER_KINDS = [
  "levelUp",
  "awaken",
  "skillUp",
  "rankUp",
  "clear",
  "fullCombo",
  "allPerfect",
  "result",
  "battleFirst",
  "battleHigh",
  "battleLow",
];
export const VOICE_KINDS = [
  "normal",
  "login",
  "characterRankUp",
  "exchange",
  "realLiveBefore",
  "realLiveDay",
  "feature",
  "spring",
  "summer",
  "autumn",
  "winter",
  "christmas",
  "newYear",
  "valentine",
  "seasonal",
  "birthday",
  "levelUp",
  "awaken",
  "skillUp",
  "rankUp",
  "gacha",
  "start",
  "gekisouCombo",
  "gekisouJust",
  "gekisouLuck",
  "gekisouTop",
  "clear",
  "fullCombo",
  "allPerfect",
  "combo",
  "skill",
  "result",
  "resultSolo",
  "resultPair",
  "battleFirst",
  "battleHigh",
  "battleLow",
  "spotEnter",
  "spotConversation",
  "spotTap",
  "spotAfter",
  "locationConversation",
  "titleBushiroad",
  "titleBushimo",
  "titleBushiroadGames",
  "titleFromTokyo",
  "titleBilibili",
  "titleApp",
  "titleOtherCompany",
  "other",
] as const;

export function voiceKind(entry: JsonRecord): string {
  if (typeof entry.voiceKind === "string") return entry.voiceKind;
  switch (Number(entry.masterType)) {
    case 0:
      if (Number(entry.birthdayCharacterId) > 0) return "birthday";
      if (entry.seasonStartAt || entry.seasonEndAt) {
        return (
          (
            {
              "4/1": "spring",
              "7/1": "summer",
              "9/1": "autumn",
              "12/1": "winter",
              "12/24": "christmas",
              "1/1": "newYear",
              "2/14": "valentine",
            } as Record<string, string>
          )[String(entry.seasonStartAt)] || "seasonal"
        );
      }
      return TALK_KINDS[Number(entry.talkCategory)] || "feature";
    case 1:
      return CHARACTER_KINDS[Number(entry.characterVoiceType)] || "other";
    case 2:
      return "gacha";
    case 3:
      return "skill";
    case 4:
      return ["gekisouCombo", "gekisouJust", "gekisouLuck", "gekisouTop"][Number(entry.gekisouVoiceType)] || "other";
    case 5:
    case 6:
      return Number(entry.dialogueType) === 2 ? "skill" : "combo";
    case 7:
      return "start";
    default:
      return "other";
  }
}
export function voiceGroup(entry: JsonRecord): VoiceGroup {
  if (VOICE_GROUPS.includes(entry.voiceGroup as VoiceGroup)) return entry.voiceGroup as VoiceGroup;
  const kind = voiceKind(entry);
  if (Number(entry.masterType) === 0 && [1, 4, 5, 7].includes(Number(entry.talkCategory))) return "feature";
  if (["normal", "login", "exchange"].includes(kind)) return "normal";
  if (kind.startsWith("realLive")) return "realLive";
  if (["spring", "summer", "autumn", "winter", "christmas", "newYear", "valentine", "seasonal"].includes(kind))
    return "seasonal";
  if (kind === "birthday") return "birthday";
  if (["characterRankUp", "levelUp", "awaken", "skillUp", "rankUp"].includes(kind)) return "growth";
  if (kind === "gacha") return "gacha";
  if (kind === "start") return "liveStart";
  if (kind === "gekisouTop") return "gekisouEnd";
  if (kind.startsWith("gekisou")) return "gekisouStart";
  if (["clear", "fullCombo", "allPerfect"].includes(kind)) return "liveEnd";
  if (Number(entry.masterType) === 6) return "livePairDialogue";
  if (["combo", "skill"].includes(kind)) return "liveDialogue";
  if (kind === "result") return "liveResult";
  if (kind.startsWith("battle")) return "liveBattleResult";
  return kind === "feature" ? "feature" : "other";
}
export function voiceTab(entry: JsonRecord): VoiceTab {
  if (entry.collectionTab !== undefined) return VOICE_TABS[Number(entry.collectionTab)] || "other";
  const group = voiceGroup(entry);
  if (["normal", "realLive", "feature", "seasonal", "birthday"].includes(group)) return "comment";
  if (["growth", "gacha", "location", "title", "other"].includes(group)) return group as VoiceTab;
  return "live";
}
export function voiceGroupLabelKey(group: VoiceGroup | VoiceTab): string {
  return "groups." + group;
}
export const voiceTitleKey = voiceKind;
export interface VoiceLine {
  characterId: number;
  text: unknown;
  url: string;
  duration: number;
}
export function voiceLines(entry: JsonRecord): VoiceLine[] {
  const rows = Array.isArray(entry.lines) ? (entry.lines as JsonRecord[]) : [entry];
  return rows.map((line) => {
    const sound = line.sound && typeof line.sound === "object" ? (line.sound as JsonRecord) : {};
    return {
      characterId: Number(
        line.characterId ||
          ((entry.characterIds as unknown[] | undefined)?.length === 1 ? (entry.characterIds as unknown[])[0] : 0),
      ),
      text: line.text,
      url: String(sound.playableUrl || line.playableUrl || ""),
      duration: Math.max(0, Number(sound.durationMs || 0) / 1000),
    };
  });
}
export function voiceKey(entry: JsonRecord): string {
  return String(entry.voiceKey || [entry.masterType, entry.masterId].join(":"));
}
export function compareVoices(a: JsonRecord, b: JsonRecord, characterId = 0) {
  const kindIndex = (entry: JsonRecord) => VOICE_KINDS.indexOf(voiceKind(entry) as (typeof VOICE_KINDS)[number]);
  const birthdayOrder = (entry: JsonRecord) =>
    Number(entry.birthdayCharacterId) === characterId ? -1 : Number(entry.birthdayCharacterId) || 0;
  const pairOrder = (entry: JsonRecord) => ((entry.characterIds as number[]) || []).join(",");
  return (
    VOICE_GROUPS.indexOf(voiceGroup(a)) - VOICE_GROUPS.indexOf(voiceGroup(b)) ||
    kindIndex(a) - kindIndex(b) ||
    birthdayOrder(a) - birthdayOrder(b) ||
    Number(a.spotId || 0) - Number(b.spotId || 0) ||
    Number(a.unlockCharacterRank || a.unlockFriendshipRank || 0) -
      Number(b.unlockCharacterRank || b.unlockFriendshipRank || 0) ||
    Number(b.scoreRank || 0) - Number(a.scoreRank || 0) ||
    pairOrder(a).localeCompare(pairOrder(b), "en", { numeric: true }) ||
    Number(a.masterId || 0) - Number(b.masterId || 0) ||
    Number(a.variantNumber || 0) - Number(b.variantNumber || 0) ||
    voiceKey(a).localeCompare(voiceKey(b), "en", { numeric: true })
  );
}
export function voiceCalendarDate(locale: string, value: unknown, year = 0): string {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(String(value || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(year > 0 ? year : 2000, Number(match[1]) - 1, Number(match[2])));
  return formatDate(locale, date, { timeZone: "UTC", year: year > 0 ? "always" : "never" });
}
export function voiceSeasonRange(entry: JsonRecord, locale: string): string {
  const year = Number(entry.year) || 0;
  const start = voiceCalendarDate(locale, entry.seasonStartAt, year);
  const end = voiceCalendarDate(locale, entry.seasonEndAt, year);
  return start && end && start !== end ? [start, end].join(" – ") : start || end;
}
