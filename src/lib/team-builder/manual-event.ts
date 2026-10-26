// L3 — GEB
// Input: Complete event rules, recorded cards and a manual event draft.
// Output: Validated templates, request-local bonus effects and result condition snapshots.
// Pos: [Map](L2-2.md); manual event setup for ordinary single-live rewards.
// Effects/Dependencies: Pure; never changes catalogue events or candidate cards.
import type { EngineMaster, EventEffectRow, GameEvent } from "./engine/master";

export interface ManualEventDraft {
  templateId: number | null;
  attributes: number[] | null;
  targetKind: "band" | "character" | "none";
  targets: number[];
  members: { cardId: number; tier: string }[];
  snaps: { cardId: number; tier: string }[];
}
export const emptyManualEvent = (): ManualEventDraft => ({
  templateId: null,
  attributes: null,
  targetKind: "band",
  targets: [],
  members: [],
  snaps: [],
});
type Category = "attribute" | "target" | "member" | "snap";
export interface BonusTier {
  key: string;
  effects: EventEffectRow[];
}
export interface ManualEventTemplate {
  event: GameEvent;
  attribute: EventEffectRow[];
  target: EventEffectRow[];
  members: BonusTier[];
  snaps: BonusTier[];
}
const clearTarget = (row: EventEffectRow): EventEffectRow => ({
  ...row,
  characterId: 0,
  bandId: 0,
  cardType: 0,
  tagId: 0,
  memberCardId: 0,
  supportCardId: 0,
  perRank: [...row.perRank],
});
const unique = (rows: EventEffectRow[]) => [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()];
const tier = (effects: EventEffectRow[]): BonusTier => {
  const rows = unique(effects).sort((a, b) => a.resourceType - b.resourceType || a.bonusType - b.bonusType);
  return { key: JSON.stringify(rows.map((row) => [row.bonusType, row.perRank])), effects: rows };
};
export function manualEventFromEffects(templateId: number, effects: readonly EventEffectRow[]): ManualEventDraft {
  const targetKind = effects.some((row) => row.bandId)
    ? "band"
    : effects.some((row) => row.characterId)
      ? "character"
      : "none";
  const cards = (field: "memberCardId" | "supportCardId") =>
    [...new Set(effects.map((row) => row[field]).filter(Boolean))].map((cardId) => ({
      cardId,
      tier: tier(effects.filter((row) => row[field] === cardId).map(clearTarget)).key,
    }));
  return {
    templateId,
    attributes: [...new Set(effects.map((row) => row.cardType).filter(Boolean))],
    targetKind,
    targets:
      targetKind === "none"
        ? []
        : [...new Set(effects.map((row) => (targetKind === "band" ? row.bandId : row.characterId)).filter(Boolean))],
    members: cards("memberCardId"),
    snaps: cards("supportCardId"),
  };
}
export function manualEventTemplate(event: GameEvent, master: EngineMaster): ManualEventTemplate | null {
  if (!event.livePoints.size || !event.liveRewards.length || !event.itemId || !event.effects.length) return null;
  const ranks = new Set([
    master.params.skipRank,
    ...[...master.scoreRanks.values()].flatMap((rows) => rows.map((row) => row.rank)),
  ]);
  if (
    [...ranks].some(
      (rank) =>
        !event.livePoints.has(rank) ||
        !event.liveRewards.some((row) => row.scoreRank === rank && row.resourceId === event.itemId),
    )
  )
    return null;
  if (
    [...event.livePoints.values()].some((value) => !Number.isSafeInteger(value) || value < 0) ||
    event.liveRewards.some(
      (row) =>
        !Number.isSafeInteger(row.count) ||
        row.count < 0 ||
        !Number.isSafeInteger(row.probability) ||
        row.probability < 0 ||
        row.probability > 10000,
    )
  )
    return null;
  const groups: Record<Category, Map<number, EventEffectRow[]>> = {
    attribute: new Map(),
    target: new Map(),
    member: new Map(),
    snap: new Map(),
  };
  for (const row of event.effects) {
    if (
      ![2, 3].includes(row.resourceType) ||
      ![0, 1, 2].includes(row.bonusType) ||
      row.tagId ||
      row.perRank.length !== 5 ||
      row.perRank.some((value) => !Number.isSafeInteger(value) || value < 0)
    )
      return null;
    const selectors = [row.cardType, row.bandId, row.characterId, row.memberCardId, row.supportCardId].filter(Boolean);
    if (
      selectors.length !== 1 ||
      (row.memberCardId && row.resourceType !== 2) ||
      (row.supportCardId && row.resourceType !== 3)
    )
      return null;
    const category: Category = row.memberCardId
      ? "member"
      : row.supportCardId
        ? "snap"
        : row.cardType
          ? "attribute"
          : "target";
    const id = row.memberCardId || row.supportCardId || row.cardType || row.bandId || -row.characterId;
    const rows = groups[category].get(id) ?? [];
    rows.push(clearTarget(row));
    groups[category].set(id, rows);
  }
  const profiles = (category: Category) => [
    ...new Map(
      [...groups[category].values()].map((rows) => {
        const profile = tier(rows);
        return [profile.key + JSON.stringify(profile.effects.map((row) => row.resourceType)), profile] as const;
      }),
    ).values(),
  ];
  const attributes = profiles("attribute"),
    targets = profiles("target");
  if (attributes.length !== 1 || targets.length !== 1) return null;
  return {
    event,
    attribute: attributes[0]!.effects,
    target: targets[0]!.effects,
    members: profiles("member"),
    snaps: profiles("snap"),
  };
}
export function resolveManualEvent(
  master: EngineMaster,
  draft: ManualEventDraft,
): { effects: EventEffectRow[]; issue: null } | { effects: null; issue: "rules" | "attribute" | "targets" | "cards" } {
  const event = draft.templateId === null ? undefined : master.events.get(draft.templateId);
  const template = event && manualEventTemplate(event, master);
  if (!template) return { effects: null, issue: "rules" };
  if (draft.attributes === null || draft.attributes.some((id) => ![1, 2, 3, 4, 5].includes(id)))
    return { effects: null, issue: "attribute" };
  if (
    !["none", "band", "character"].includes(draft.targetKind) ||
    (draft.targetKind !== "none" &&
      (!draft.targets.length ||
        draft.targets.some((id) =>
          draft.targetKind === "character"
            ? !master.characters.has(id)
            : ![...master.members.values()].some((card) => card.bandId === id),
        )))
  )
    return { effects: null, issue: "targets" };
  const effects = [...new Set(draft.attributes)].flatMap((cardType) =>
    template.attribute.map((row) => ({ ...row, cardType })),
  );
  if (draft.targetKind !== "none")
    for (const id of new Set(draft.targets))
      effects.push(
        ...template.target.map((row) => ({ ...row, [draft.targetKind === "band" ? "bandId" : "characterId"]: id })),
      );
  for (const kind of ["members", "snaps"] as const) {
    const seen = new Set<number>();
    for (const selection of draft[kind]) {
      const profile = template[kind].find((row) => row.key === selection.tier);
      if (!master[kind].has(selection.cardId) || !profile || seen.has(selection.cardId))
        return { effects: null, issue: "cards" };
      seen.add(selection.cardId);
      effects.push(
        ...profile.effects.map((row) => ({
          ...row,
          [kind === "members" ? "memberCardId" : "supportCardId"]: selection.cardId,
        })),
      );
    }
  }
  return { effects, issue: null };
}
