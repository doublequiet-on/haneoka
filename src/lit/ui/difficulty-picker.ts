import { html, nothing } from "lit";
import { uiText } from "../shared/catalog";
import { rovingKeydown } from "./controls";
import { difficultyEstimateCaption } from "../shared/difficulty-caption";
import "../../styles/difficulty-picker.css";

type Row = Record<string, unknown>;
const NAMES = ["easy", "normal", "hard", "expert", "master"];
/** Sixth charts: BanG Dream's SPECIAL and Project Sekai's APPEND share MASTER's colour. */
const EXTRA = ["special", "append"];
export function difficultyKey(row: Row, index = 0): string {
  const value = String(row.difficultyName || row.difficulty || "").toLowerCase();
  return NAMES.includes(value) || EXTRA.includes(value) ? value : NAMES[Number(value) || index] || "master";
}
/** The non-interactive badge used by per-chart tables and community charts. */
export function difficultyBadge(row: Row, caption: unknown = difficultyEstimateCaption(row)) {
  const key = difficultyKey(row);
  const name = String(row.difficultyName || row.difficulty || key);
  return html`
    <span
      class="difficulty-picker"
      style=${`--chart-color:var(--md-extended-color-difficulty-${EXTRA.includes(key) ? "master" : key})`}
    >
      <span class="difficulty-picker__value">
        <small class="truncate">${name.toUpperCase()}</small>
        <b class="truncate">${row.displayLevel ?? row.playLevel ?? row.level ?? "—"}</b>
        ${caption ?? nothing}
      </span>
    </span>
  `;
}
export function difficultyPicker(options: {
  rows: Row[];
  selected: string;
  locale: string;
  compact?: boolean;
  onSelect(key: string, index: number): void;
}) {
  const keys = options.rows.map(difficultyKey);
  const select = (key: string) => options.onSelect(key, keys.indexOf(key));
  return html`
    <span
      class=${`difficulty-picker${options.compact ? " difficulty-picker--compact" : ""}`}
      role="radiogroup"
      aria-label=${uiText(options.locale, "catalog.songs.fields.difficulty")}
      @click=${(event: Event) => event.stopPropagation()}
      @keydown=${rovingKeydown(keys, options.selected, select)}
    >
      ${options.rows.map((row, index) => {
        const key = keys[index]!;
        const level = row.displayLevel ?? row.playLevel ?? row.level ?? "—";
        const selected = key === options.selected;
        return html`
          <button
            type="button"
            role="radio"
            aria-checked=${selected}
            tabindex=${selected || (!keys.includes(options.selected) && index === 0) ? 0 : -1}
            aria-label=${`${key.toUpperCase()} ${level}`}
            title=${`${key.toUpperCase()} ${level}`}
            style=${`--chart-color:var(--md-extended-color-difficulty-${EXTRA.includes(key) ? "master" : key})`}
            @click=${() => select(key)}
          >
            <small>${key.toUpperCase()}</small>
            <b>${level}</b>
            ${difficultyEstimateCaption(row)}
          </button>
        `;
      })}
    </span>
  `;
}
