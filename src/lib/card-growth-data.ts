// L3 — GEB
// Input: same-release progression, skill references and resource resolver.
// Output: the card growth and cost projection shared by details and comparison.
// Pos: [Map](L2-2.md); build-time card associations.
// Effects/Dependencies: pure projection; no catalog loading.
import { skillDisplay, upgradeSteps, associationRows as rows, type ReferenceResolver } from "./entity-associations";
import { asRecord, type RecordValue } from "./static-catalog-source";
export interface CardGrowthSource {
  views: Record<string, RecordValue[]>;
  progression: RecordValue;
  skillReference: RecordValue;
  resolve: ReferenceResolver;
}
const numbers = (values: unknown[]): number[] =>
  values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
const progressionSubset = (graph: CardGrowthSource, key: string, keep: (row: RecordValue) => boolean) =>
  rows(graph.progression[key]).filter((row) => keep(asRecord(row.raw) || row));
export function projectCardGrowth(graph: CardGrowthSource, item: RecordValue, support: boolean): RecordValue {
  const levelView = support ? "support-card-levels" : "member-card-levels";
  const levelGroup = Number(support ? item.supportCardLevelGroup : item.memberCardLevelGroup);
  const skillGroups = new Set(
    numbers([item.liveSkillLevelResourceGroup, item.gekisouSkillLevelResourceGroup, item.linkSkillLevelResourceGroup]),
  );
  const aux: RecordValue = {
    [levelView]: (graph.views[levelView] || []).filter((row) => Number(row.group) === levelGroup),
    "skill-level-resources": (graph.views["skill-level-resources"] || []).filter((row) =>
      skillGroups.has(Number(row.group)),
    ),
    "skill-reference": graph.skillReference,
  };
  if (support) {
    const rankGroup = Number(item.supportCardRankGroup || item.supportCardLevelGroup);
    aux.progression = {
      supportCardRanks: progressionSubset(graph, "supportCardRanks", (raw) => Number(raw._group) === rankGroup),
    };
  } else {
    const awakeGroup = Number(item.memberCardAwakeGroup || 1);
    const rankGroup = Number(item.memberCardRankGroup || 1);
    const resourceGroup = Number(item.memberCardAwakeResourceGroup);
    aux["member-card-awake-resources"] = (graph.views["member-card-awake-resources"] || []).filter(
      (row) => Number(row.group) === resourceGroup,
    );
    aux.progression = {
      memberCardAwake: progressionSubset(graph, "memberCardAwake", (raw) => Number(raw._group) === awakeGroup),
      memberCardRanks: progressionSubset(graph, "memberCardRanks", (raw) => Number(raw._group) === rankGroup),
      memberCardLevelLimits: progressionSubset(
        graph,
        "memberCardLevelLimits",
        (raw) => Number(raw._rarity) === Number(item.rarity),
      ),
    };
  }
  const resolve = graph.resolve;
  const progression = asRecord(aux.progression) || {};
  aux.associations = {
    skills: skillDisplay(item, asRecord(aux["skill-reference"]) || {}),
    upgrades: [
      ...upgradeSteps(
        "live",
        rows(aux["skill-level-resources"]).filter(
          (row) => Number(row.group) === Number(item.liveSkillLevelResourceGroup),
        ),
        "level",
        resolve,
      ),
      ...upgradeSteps(
        "gekisou",
        rows(aux["skill-level-resources"]).filter(
          (row) => Number(row.group) === Number(item.gekisouSkillLevelResourceGroup),
        ),
        "level",
        resolve,
      ),
      ...upgradeSteps(
        "link",
        rows(aux["skill-level-resources"]).filter(
          (row) => Number(row.group) === Number(item.linkSkillLevelResourceGroup),
        ),
        "level",
        resolve,
      ),
      ...upgradeSteps("training", rows(aux["member-card-awake-resources"]), "awakeCount", resolve),
      ...upgradeSteps(
        support ? "rank" : "awakening",
        rows(progression[support ? "supportCardRanks" : "memberCardRanks"]),
        "rank",
        resolve,
        support
          ? { resource: "support-cards", id: String(item.supportCardId) }
          : { resource: "items", id: String(item.rankUpItemId) },
      ),
    ],
  };
  return aux;
}
