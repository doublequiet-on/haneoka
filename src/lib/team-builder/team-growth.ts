// L3 — GEB
// Input: Frozen engine inputs, a formation and one proposed card upgrade.
// Output: Temporary growth scenarios and constrained requests for the same native goal.
// Pos: [Map](L2-2.md); growth comparison request projection, not a scoring implementation.
// Effects/Dependencies: No Box writes; preserves the source's candidates and scoring conditions.
import type { EngineHit, EngineRequest } from "./engine/api";
import { maxMemberGrowth, maxSnapGrowth, memberGrowth, snapGrowth, type MemberInput, type SnapInput } from "./engine/box";
import type { EngineMaster } from "./engine/master";
import { memberLevelCap, snapLevelCap } from "./engine/power";
import type { GrowthAction } from "../growth-comparison";

export interface TeamGrowthChoice {
  kind: "members" | "snaps";
  key: string;
  action: GrowthAction | "full";
  target: "next" | "cap";
}
export const teamGrowthFields = {
  level: "level",
  training: "awake",
  awakening: "rank",
  live: "liveSkillLevel",
  gekisou: "gekisoSkillLevel",
  break: "rank",
} as const;
export interface TeamGrowthChange {
  status: "ready" | "missing-state" | "missing-data" | "at-cap" | "invalid-state";
  from: number | null;
  to: number | null;
  request: EngineRequest | null;
}

/** A new search must not inherit completed results, scores, floors or an expired deadline. */
export function freshGrowthRequest(source: EngineRequest): EngineRequest {
  return structuredClone({
    members: source.members,
    snaps: source.snaps,
    player: source.player,
    unknownPolicy: source.unknownPolicy,
    goal: source.goal,
    constraints: source.constraints,
    aggregation: source.aggregation,
    songRules: source.songRules,
    k: 1,
    timeLimitMs: source.timeLimitMs,
  });
}

export function teamGrowthChange(
  master: EngineMaster,
  source: EngineRequest,
  choice: TeamGrowthChoice,
): TeamGrowthChange {
  const result: TeamGrowthChange = { status: "missing-data", from: null, to: null, request: null };
  const row = source[choice.kind].find((row) => row.key === choice.key);
  if (!row) return result;
  const member = choice.kind === "members" ? master.members.get(row.cardId) : undefined;
  const snap = choice.kind === "snaps" ? master.snaps.get(row.cardId) : undefined;
  if (!member && !snap) return result;
  const maximum = member ? maxMemberGrowth(master, member) : maxSnapGrowth(master, snap!);
  const values = row as MemberInput;
  const max = maximum as Omit<MemberInput, "key" | "cardId">;
  if (choice.action === "full") {
    const fields = Object.keys(maximum) as (keyof typeof max)[];
    const effective = (member
      ? memberGrowth(master, member, values, source.unknownPolicy)
      : snapGrowth(master, snap!, row as SnapInput, source.unknownPolicy)) as typeof max;
    if (fields.every((field) => effective[field] === max[field])) return { ...result, status: "at-cap" };
    const request = freshGrowthRequest(source);
    Object.assign(
      request[choice.kind].find((row) => row.key === choice.key)!,
      maximum,
    );
    return { ...result, status: "ready", request };
  }
  if (choice.kind === "snaps" && !["level", "break"].includes(choice.action)) return result;
  if (choice.kind === "members" && choice.action === "break") return result;
  const field = teamGrowthFields[choice.action];
  const from = values[field];
  if (from == null) return { ...result, status: "missing-state" };
  let cap = max[field]!;
  if (choice.action === "level") {
    const stage = member ? values.awake : values.rank;
    if (stage === null) return { ...result, from, status: "missing-state" };
    cap = member ? memberLevelCap(master, member, stage) : snapLevelCap(master, snap!, stage);
  }
  if (!Number.isInteger(from) || from < 1 || from > cap) return { ...result, from, status: "invalid-state" };
  if (from === cap) return { ...result, from, status: "at-cap" };
  const to = choice.action === "level" && choice.target === "cap" ? cap : from + 1;
  const request = freshGrowthRequest(source);
  Object.assign(
    request[choice.kind].find((row) => row.key === choice.key)!,
    { [field]: to },
  );
  return { status: "ready", from, to, request };
}

/** All five bindings include empty slots, so a fixed comparison cannot fill or swap a Snapshot. */
export function fixedGrowthRequest(
  source: EngineRequest,
  team: Pick<EngineHit, "song" | "members" | "snaps" | "aggregate">,
): EngineRequest {
  const request = freshGrowthRequest(source);
  request.timeLimitMs = null;
  request.members = team.members.map((key) => request.members.find((row) => row.key === key)!);
  request.snaps = request.snaps.filter((row) => team.snaps.includes(row.key));
  request.constraints = {
    requiredMembers: [...team.members],
    excludedMembers: [],
    requiredSnaps: team.snaps.filter((key): key is string => key !== null),
    excludedSnaps: [],
    leader: team.members[0]!,
    bindings: team.members.map((key, index) => [key, team.snaps[index] ?? null]),
    noSnaps: team.snaps.every((key) => key === null),
    minBonusPercent: null,
  };
  if (request.goal.kind === "plan") throw new Error("growth-plan-needs-route");
  if ("songs" in request.goal)
    request.goal.songs = team.aggregate
      ? team.aggregate.songs.map((hit) => ({ ...hit.song! }))
      : team.song ? [{ ...team.song }] : [];
  if (request.goal.kind === "power") request.goal.song = team.song;
  return request;
}
