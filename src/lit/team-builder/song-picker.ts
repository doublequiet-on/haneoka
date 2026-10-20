// L3 — GEB
// Input: Scene-specific chart choices, catalogue and browse preferences.
// Output: Explicit apply/cancel selection transaction with per-chart filters.
// Pos: [Map](../L2-2.md); shared team workspace chart chooser.
// Effects/Dependencies: Lit modal, page-local preferences, lazy metadata reads.
import { matchesSongMissions, matchesSelections } from "../../lib/catalog-filters";
import { catalogQueryNames, parseCatalogQuery } from "../../lib/catalog-query";
import { html, nothing, type TemplateResult } from "lit";
import type { SongRef } from "../../lib/team-builder/engine/api";
import { chooserFacet } from "../ui/chooser-filters";
import { filterChip, segmented } from "../ui/controls";
import { selectionPane } from "../ui/selection-pane";
import { chartKey, uniqueCharts } from "./workspace-state";
import type { TeamBuilder } from "../team-builder";

export interface SongPickerState {
  songs: SongRef[];
  single: boolean;
  query: string;
  filtersOpen: boolean;
  bands: number[];
  attributes: number[];
  gekisouTypes: string[];
  gekisouMatch?: "only" | "contains";
  difficulty: number;
  difficulties?: number[];
  minLevel?: number | null;
  maxLevel?: number | null;
  maxSeconds?: number | null;
  allowedSongIds?: number[];
  title?: string;
  context?: string;
  initialized?: boolean;
  view?: "all" | "outside" | "unavailable";
  undo?: SongRef[];
  opener?: HTMLElement;
  change: (songs: SongRef[]) => void;
}
const DIFFICULTIES = ["EASY", "NORMAL", "HARD", "EXPERT", "SPECIAL"];
export function renderSongPicker(host: TeamBuilder): TemplateResult {
  let state = host.songPicker!;
  const catalog = host.catalog!;
  const context = state.context ?? `${host.tab}:${state.single ? "single" : "charts"}`;
  if (!state.initialized) {
    state = host.songPicker = { ...state, ...host.songPickerPreferences.get(context), initialized: true,
      opener: typeof document === "undefined" ? undefined : document.activeElement as HTMLElement };
  }
  const update = (patch: Partial<SongPickerState>) => {
    const next = host.songPicker = { ...host.songPicker!, ...patch };
    const { query, bands, attributes, gekisouTypes, gekisouMatch, difficulties, minLevel, maxLevel, maxSeconds } = next;
    host.songPickerPreferences.set(context, { query, bands, attributes, gekisouTypes, gekisouMatch, difficulties, minLevel, maxLevel, maxSeconds });
    host.requestUpdate();
  };
  const close = () => {
    host.songPicker = null;
    host.requestUpdate();
    void host.updateComplete.then(() => state.opener?.isConnected && state.opener.focus());
  };
  const plan = parseCatalogQuery(state.query, {
    game: "our-notes", kind: "song",
    aliases: [
      ...Object.entries(catalog.data.characters).map(([id, row]) => ({ key: "character", value: id, names: catalogQueryNames(row, "character") })),
      ...Object.entries(catalog.data.bands).map(([id, row]) => ({ key: "collectionBand", value: id, names: catalogQueryNames({ ...row, bandName: row.bandName ?? row.name }, "band") })),
    ],
  });
  const query = plan.text.normalize("NFKC").toLocaleLowerCase(host.locale);
  const facets = plan.facets;
  const minLevel = state.minLevel === undefined ? (facets.minLevel?.length ? Number(facets.minLevel[0]) : null) : state.minLevel;
  const maxLevel = state.maxLevel === undefined ? (facets.maxLevel?.length ? Number(facets.maxLevel[0]) : null) : state.maxLevel;
  const missionMode = facets.gekisouMatch?.[0] ?? state.gekisouMatch;
  const difficulties = state.difficulties ?? [state.difficulty];
  const legal = (song: SongRef) => (!state.allowedSongIds || state.allowedSongIds.includes(song.songId)) &&
    catalog.difficultyRows(song.songId).some(row => Number(row.difficulty) === song.difficulty);
  const allCharts = Object.keys(catalog.data.songs).map(Number).sort((a,b) => b-a).flatMap(songId =>
    catalog.difficultyRows(songId).map(row => ({ songId, difficulty: Number(row.difficulty) })).filter(legal));
  if (state.maxSeconds != null) catalog.loadSongMetadata(allCharts.map(song => song.songId));
  const visible = allCharts.filter(ref => {
    const id = ref.songId, song = catalog.song(id);
    if (!difficulties.includes(ref.difficulty)) return false;
    if (state.bands.length && !catalog.songBands(id).some(band => state.bands.includes(band))) return false;
    if (state.attributes.length && !state.attributes.includes(Number(song.musicType))) return false;
    if (!matchesSongMissions(song, state.gekisouTypes, missionMode)) return false;
    if (!matchesSelections(catalog.songBands(id).map(String), facets.collectionBand || []) ||
      !matchesSelections((Array.isArray(song.vocalCharacterIds) ? song.vocalCharacterIds : []).map(String), facets.character || []) ||
      !matchesSelections([String(song.musicType)], facets.type || []) ||
      !matchesSongMissions(song, facets.gekisouType || [], missionMode)) return false;
    const row = catalog.difficultyRows(id).find(row => Number(row.difficulty) === ref.difficulty)!;
    const level = Number(row.displayLevel ?? row.playLevel ?? row.sortLevel);
    if ((minLevel !== null || maxLevel !== null) && !Number.isFinite(level)) return false;
    if (minLevel !== null && level < minLevel || maxLevel !== null && level > maxLevel) return false;
    if (state.maxSeconds != null) {
      const time = catalog.chartMetadata(ref)?.time;
      if (typeof time !== "number" || !Number.isFinite(time) || time > state.maxSeconds) return false;
    }
    return !query || `${catalog.songTitle(id)} ${catalog.songArtist(id)}`.normalize("NFKC").toLocaleLowerCase(host.locale).includes(query);
  });
  const visibleKeys = new Set(visible.map(chartKey));
  const validSelected = state.songs.filter(legal);
  const unavailable = state.songs.filter(song => !legal(song));
  const outside = validSelected.filter(song => !visibleKeys.has(chartKey(song)));
  const shown = state.view === "outside" ? outside : state.view === "unavailable" ? unavailable : visible;
  const selected = new Set(state.songs.map(chartKey));
  const replace = (songs: SongRef[]) => update({ songs: uniqueCharts(songs), undo: state.songs });
  const toggle = (key: string) => {
    const song = shown.find(song => chartKey(song) === key)!;
    update({ songs: selected.has(key) ? state.songs.filter(song => chartKey(song) !== key) : state.single ? [song] : [...state.songs, song] });
  };
  const gekiso = host.tab === "song-comparison" || host.searchSettings.goal === "gekiso" || host.tab === "pt" && host.settings.rewardMode === "recommendation" && host.searchSettings.ptMode === "gekiso";
  const missionFilters = html`<div class="cluster">
    ${["Combo", "Luck", "JustCount", "Mix"].map((value, i) => filterChip({ label: ["COMBO", "LUCK", "JUST", host.common("catalog.songs.gekisou.mixed", "Mixed")][i]!, selected: state.gekisouTypes.includes(value),
      onToggle: () => update({ gekisouTypes: state.gekisouTypes.includes(value) ? state.gekisouTypes.filter(type => type !== value) : [...state.gekisouTypes, value] }) }))}
    </div>${segmented({ label: host.common("catalog.songs.gekisou.matchMode", "Match mode"), value: state.gekisouMatch ?? "only",
      options: [{ value: "only", label: host.common("catalog.songs.gekisou.only", "Only selected types") }, { value: "contains", label: host.common("catalog.songs.gekisou.contains", "Contains a selected type") }], onSelect: gekisouMatch => update({ gekisouMatch }) })}`;
  const levelField = (key: "minLevel" | "maxLevel", value: number | null, label: string) => html`<md-outlined-text-field type="number" min="1" label=${label}
    .value=${value == null ? "" : String(value)} @input=${(event: Event) => { const raw = (event.target as HTMLInputElement).value; update({ [key]: raw === "" ? null : Number(raw) }); }}></md-outlined-text-field>`;
  const all = host.common("common.states.all", "All");
  return selectionPane({
    id: "tb-song-picker", title: state.title ?? host.t("chooseSongs", "Choose songs"),
    closeLabel: host.common("common.actions.close", "Close"), close,
    searchLabel: host.common("common.actions.search", "Search"), query: state.query,
    search: query => update({ query }),
    filterLabel: host.t("filters", "Filters"), filtersOpen: state.filtersOpen,
    toggleFilters: () => update({ filtersOpen: !state.filtersOpen }), filterLayout: "facets",
    quickFilters: html`<div class="stack tb-picker-quick">
      <div class="cluster" role="group" aria-label=${host.t("difficulty", "Difficulty")}>${DIFFICULTIES.map((label, value) => filterChip({ label, selected: difficulties.includes(value),
        onToggle: () => update({ difficulties: difficulties.includes(value) ? difficulties.filter(d => d !== value) : [...difficulties, value] }) }))}</div>
      ${levelField("maxLevel", maxLevel, host.t("sc.maxLevel", "Maximum level"))}${gekiso ? missionFilters : nothing}
    </div>`,
    filters: html`<div class="stack">
      ${gekiso ? nothing : missionFilters}
      ${levelField("minLevel", minLevel, host.t("sc.minLevel", "Minimum level"))}
      <md-outlined-text-field type="number" min="1" label=${host.t("maxDuration", "Maximum chart duration (seconds)")}
        .value=${state.maxSeconds == null ? "" : String(state.maxSeconds)} @input=${(event: Event) => { const raw = (event.target as HTMLInputElement).value; update({ maxSeconds: raw === "" ? null : Number(raw) }); }}></md-outlined-text-field>
      ${chooserFacet({ label: host.common("catalog.fields.band", "Band"), value: state.bands[0] == null ? "" : String(state.bands[0]), allLabel: all,
        options: Object.keys(catalog.data.bands).map(Number).filter(id => catalog.bandName(id)).map(id => ({ value: String(id), label: catalog.bandName(id) })), change: value => update({ bands: value ? [Number(value)] : [] }) })}
      ${chooserFacet({ label: host.common("catalog.fields.attribute", "Attribute"), value: state.attributes[0] == null ? "" : String(state.attributes[0]), allLabel: all,
        options: [1,2,3,4,5].map(id => ({ value: String(id), label: catalog.attributeName(id) })), change: value => update({ attributes: value ? [Number(value)] : [] }) })}
    </div>`,
    kind: "song", items: shown.map(song => ({ ...catalog.songOptions(song.songId, song.difficulty), value: chartKey(song) })),
    selected: "", selectedValues: selected, select: toggle,
    countLabel: host.t("chartCount", "{count} charts", { count: shown.length }), emptyLabel: host.t("noSongs", "No songs match"),
    preview: html`<div class="stack tb-picker-footer">
      <div class="cluster" role="status">
        <span>${host.t("selectedCharts", "Selected {count}", { count: validSelected.length })}</span>
        <button class="button button--text" @click=${() => update({ view: state.view === "outside" ? "all" : "outside" })} aria-pressed=${String(state.view === "outside")}>${host.t("outsideCharts", "Outside filters {count}", { count: outside.length })}</button>
        <button class="button button--text" @click=${() => update({ view: state.view === "unavailable" ? "all" : "unavailable" })} aria-pressed=${String(state.view === "unavailable")}>${host.t("unavailableCharts", "Unavailable {count}", { count: unavailable.length })}</button>
      </div>
      ${state.maxSeconds == null ? nothing : html`<span role="status">${host.t("unknownDuration", "Unknown duration {count}", { count: allCharts.filter(song => typeof catalog.chartMetadata(song)?.time !== "number").length })}${allCharts.some(song => catalog.metadataStatus(song.songId) === "loading") ? ` · ${host.t("metadataLoading", "Loading metadata")}` : ""}</span>`}
      <div class="row row--wrap">
        ${state.single ? nothing : html`<button class="button button--text" @click=${() => update({ songs: uniqueCharts([...state.songs, ...visible]) })}>${host.t("selectMatchingSongs", "Select all shown songs")}</button>`}
        <details class="tb-action-menu"><summary class="button button--text">${host.t("selectionActions", "Selection actions")}</summary><div class="surface stack">
          ${state.single ? nothing : html`<button class="button button--text" @click=${() => replace(visible)}>${host.t("replaceSelection", "Use only filtered charts")}</button>`}
          <button class="button button--text" @click=${() => replace([])}>${host.t("clearSelection", "Clear selection")}</button>
        </div></details>
        <button class="button button--text" ?disabled=${!state.undo} @click=${() => update({ songs: state.undo!, undo: undefined })}>${host.t("undoSelection", "Undo")}</button>
        <button class="button" @click=${() => { state.change(uniqueCharts(state.songs)); close(); }}>${host.t("applyCharts", "Use {count} charts", { count: validSelected.length })}</button>
      </div>
    </div>`,
  });
}
