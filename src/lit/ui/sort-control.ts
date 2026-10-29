// L3 — GEB
// Input: Catalogue sort options, direction and selection callbacks.
// Output: Shared Material sort field and direction action.
// Pos: [Map](L2-2.md); collection and resource chooser sorting.
// Effects/Dependencies: Emits changes through the supplied callbacks.
import { html } from "lit";
import { iconButton } from "./controls";

export function sortControl(options: {
  label: string;
  sort: string;
  order: "asc" | "desc";
  options: readonly { value: string; label: string }[];
  ascendingLabel: string;
  descendingLabel: string;
  changeSort: (value: string) => void;
  changeOrder: (value: "asc" | "desc") => void;
}) {
  return html`<div class="row" data-catalog-sort>
    <md-outlined-select class="grow" label=${options.label} .value=${options.sort}
      @change=${(event: Event) => options.changeSort((event.currentTarget as HTMLElement & { value: string }).value)}>
      ${options.options.map(option => html`<md-select-option value=${option.value} ?selected=${options.sort === option.value}>
        <div slot="headline">${option.label}</div>
      </md-select-option>`)}
    </md-outlined-select>
    ${iconButton({
      label: options.order === "asc" ? options.ascendingLabel : options.descendingLabel,
      icon: options.order === "asc" ? "arrow_upward" : "arrow_downward",
      variant: "outlined",
      onClick: () => options.changeOrder(options.order === "asc" ? "desc" : "asc"),
    })}
  </div>`;
}
