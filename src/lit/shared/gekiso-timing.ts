// L3 — GEB
// Input: Per-range timing opportunities and localized labels.
// Output: Compact catalogue marks and timing values in existing song stages.
// Pos: [Map](../L2-2.md); shared song timing presentation.
// Effects/Dependencies: Lit templates and existing Material direction icons.
import { html, nothing } from "lit";
import type { GekisoTimingSegment } from "../../lib/team-builder/gekiso-timing";
import { icon } from "../ui/icon";

type Label = (key: string, fallback: string) => string;

export function gekisoTimingView(timing: GekisoTimingSegment | undefined, locale: string, label: Label, segment?: number) {
  if (!timing) return nothing;
  return (["opening", "ending"] as const).flatMap((edge) => {
    const value = timing[edge];
    if (!value) return [];
    const name = edge === "opening"
      ? label("gekisouTimingOpening", "Late start")
      : label("gekisouTimingEnding", "Early end");
    const notes = label("gekisouTimingNotes", "{count} notes").replace("{count}", value.notes.toLocaleString(locale));
    const ms = (edge === "opening" ? timing.opening!.lateMs : timing.ending!.earlyMs).toLocaleString(locale, { maximumFractionDigits: 2 });
    const direction = edge === "opening" ? icon("arrow_forward", 16) : icon("arrow_back", 16);
    return [segment === undefined ? html`
      <small class="song-gekisou-timing" title=${`${name} ${notes} ${ms} ms`}>
        <span aria-hidden="true">${direction}</span><span aria-hidden="true">×${value.notes.toLocaleString(locale)}</span><span aria-hidden="true">${ms}ms</span>
        <span class="sr-only">${name} ${notes} ${ms} ms</span>
      </small>
    ` : html`
      <span class="table-entity" title=${`${name} ${notes} ${ms} ms`}>
        <span aria-hidden="true">${segment + 1}</span>${direction}<span class="sr-only">${segment + 1} ${name}</span>
      </span>
    `];
  });
}
