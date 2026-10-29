import { html } from "lit";
import { segmented } from "./controls";

/** Stored stages stay one-based; training and rank are displayed as counts. */
export function growthSteps(
  label: string,
  value: number | null,
  stages: readonly number[],
  counts: boolean,
  onSelect: (value: number) => void,
) {
  return html`
    <div class="stack stack--tight">
      <span>${label}</span>
      ${segmented({
        label,
        value: value === null ? "" : String(value),
        grow: false,
        options: stages.map((stage) => ({ value: String(stage), label: String(counts ? stage - 1 : stage) })),
        onSelect: (value) => onSelect(Number(value)),
      })}
    </div>
  `;
}
