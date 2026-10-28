// L3 — GEB
// Input: Song-rule drafts and the current calculation mode.
// Output: Shared attribute and three-range overrides for every team-building task.
// Pos: [Map](../L2-2.md); common controls used by Arena, automatic and manual builders.
// Effects/Dependencies: Saves through the owning controller; uses shared Material selects and accordion.
import { html, nothing } from "lit";
import type { TeamBuilder } from "../team-builder";
import { ORIGINAL_SONG_RULES, type SongRules } from "../../lib/team-builder/arena";
import { accordion } from "../ui/accordion";

export function songRuleFields(
  host: TeamBuilder,
  rule: SongRules,
  change: (patch: Partial<SongRules>) => void,
  gekiso = true,
) {
  const catalog = host.catalog!;
  const option = (value: number, label: string, image?: string) => html`
    <md-select-option value=${String(value)}>
      ${
      image
        ? html`
            <img slot="start" src=${image} width="20" height="20" alt="" />
          `
        : nothing
    }
      <div slot="headline">${label}</div>
    </md-select-option>
  `;
  return html`
    <md-outlined-select
      label=${host.t("arena.attribute", "Song attribute")}
      .value=${String(rule.musicType)}
      @change=${(e: Event) => change({ musicType: Number((e.target as HTMLInputElement).value) })}
    >
      ${option(0, host.t("arena.original", "Original song"))}${[1, 2, 3, 4, 5, 99].map((value) => option(value, catalog.attributeName(value), catalog.attributeIcon(value)))}
    </md-outlined-select>
    ${
      gekiso
        ? html`
            <div class="stack">
              ${rule.missions.map(
                (mission, index) => html`
                  <md-outlined-select
                    label=${host.t("arena.range", "Range {count}", { count: index + 1 })}
                    .value=${String(mission)}
                    @change=${(e: Event) => {
        const missions: SongRules["missions"] = [...rule.missions];
        missions[index] = Number((e.target as HTMLInputElement).value);
        change({ missions });
      }}
                  >
                    ${[0, 1, 2, 3].map((value) => option(value, value === 0 ? host.t("arena.original", "Original song") : ["", "COMBO", "LUCK", "JUST"][value]!))}
                  </md-outlined-select>
                `,
              )}
            </div>
          `
        : nothing
    }
  `;
}
export function songRulesControl(
  host: TeamBuilder,
  draft = host.searchSettings.songRules,
  save: (rule: SongRules) => void = (songRules) => host.updateSettings({ songRules }),
  mode?: boolean,
) {
  const s = host.searchSettings;
  const gekiso = mode ?? (s.goal === "gekiso" || (s.goal === "event" && s.ptMode === "gekiso" && s.route === "live"));
  const rule = draft ?? ORIGINAL_SONG_RULES;
  return accordion({
    id: "tb-song-rules",
    label: host.t("songRules", "Song rules"),
    expanded: host.expanded.has("song-rules"),
    onExpandedChange: (open) => {
      if (open) host.expanded.add("song-rules");
      else host.expanded.delete("song-rules");
      host.requestUpdate();
    },
    content: html`
      <div class="stack">${songRuleFields(host, rule, (patch) => save({ ...rule, ...patch }), gekiso)}</div>
    `,
  });
}
