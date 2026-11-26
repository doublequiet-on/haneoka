// L3 — GEB
// Input: 歌曲详情或激奏配队当前选择的谱面及固定发行版本。
// Output: 五人房 SS 线、基础参考分和三段固定名次的个人参考分。
// Pos: [Map](L2-2.md)；两个入口共用的只读参考表。
// Effects/Dependencies: 展开后读取固定发行资料、启动独立 Worker、缓存默认场景结果；换服或离页时释放 Worker。
import { LitElement, html, nothing } from "lit";
import { clientText } from "../i18n/client";
import type { CurrentTeamBuilderIdentity } from "../lib/team-builder/data/fetch";
import type { EngineClient } from "../lib/team-builder/engine/client";
import type { SongRef } from "../lib/team-builder/engine/api";
import type { RoomSsReference } from "../lib/team-builder/engine/protocol";
import { accordion } from "./ui/accordion";
import { choiceField } from "./team-builder/choice-field";

interface ReferenceChart {
  song: SongRef;
  identity: CurrentTeamBuilderIdentity;
  label: string;
}

const results = new Map<string, RoomSsReference>();
const resultLimit = 128;
const releaseKey = ({ server, releaseId, sourceId }: CurrentTeamBuilderIdentity) =>
  JSON.stringify([server, releaseId, sourceId]);
const referenceKey = ({ identity, song }: ReferenceChart) =>
  JSON.stringify([releaseKey(identity), song.songId, song.difficulty]);
const defaultRanks = [[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4], [5, 5, 5]];
const errorLabels = {
  chart: "Chart unavailable",
  thresholdMissing: "Target threshold unavailable",
  failed: "Could not load reference scores",
};
type Query = {
  key: string;
  controller: AbortController;
  result?: RoomSsReference;
  error?: keyof typeof errorLabels;
};

class RoomSsReferenceElement extends LitElement {
  static properties = {
    charts: { attribute: false },
    locale: { type: String },
    panelId: { type: String, attribute: "panel-id" },
    expanded: { state: true },
    choice: { state: true },
  };
  declare charts: ReferenceChart[];
  declare locale: string;
  declare panelId: string;
  private declare expanded: boolean;
  private declare choice: string;
  private query?: Query;
  private session?: { key: string; controller: AbortController; client: Promise<EngineClient> };

  constructor() {
    super();
    this.charts = [];
    this.locale = "ja";
    this.panelId = "room-ss-reference";
    this.expanded = false;
    this.choice = "";
  }
  createRenderRoot() { return this; }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearQuery();
    this.releaseSession();
  }
  connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }

  private get selectedChart() {
    return this.charts.find(chart => referenceKey(chart) === this.choice) ?? this.charts[0];
  }
  private clearQuery() {
    this.query?.controller.abort();
    this.query = undefined;
  }
  private releaseSession() {
    this.session?.controller.abort();
    if (this.session) void this.session.client.then(client => client.dispose(), () => {});
    this.session = undefined;
  }
  private engine(identity: CurrentTeamBuilderIdentity) {
    const key = releaseKey(identity);
    if (this.session?.key === key) return this.session.client;
    this.releaseSession();
    const controller = new AbortController();
    const client = Promise.all([
      import("../lib/team-builder/engine/client"),
      import("../lib/team-builder/data/fetch").then(({ fetchTeamBuilderData }) =>
        fetchTeamBuilderData(identity.server, controller.signal, fetch, identity),
      ),
    ]).then(([{ EngineClient }, data]) => {
      controller.signal.throwIfAborted();
      const actual = data.identity;
      if (actual.server !== identity.server || actual.releaseId !== identity.releaseId || actual.sourceId !== identity.sourceId)
        throw new Error("room-reference-release-mismatch");
      return new EngineClient(data, undefined, { maxWorkers: 1 });
    });
    this.session = { key, controller, client };
    return client;
  }
  protected updated() {
    const chart = this.selectedChart;
    const key = chart && referenceKey(chart);
    if (this.query?.key !== key) this.clearQuery();
    if (this.session && (!chart || this.session.key !== releaseKey(chart.identity))) this.releaseSession();
    if (!this.isConnected || !this.expanded || !chart || !key) return;
    if (key === this.query?.key || results.has(key)) return;
    const query: Query = { key, controller: new AbortController() };
    this.query = query;
    void this.load(chart, query);
  }
  private async load(chart: ReferenceChart, query: Query) {
    try {
      const engine = await this.engine(chart.identity);
      query.controller.signal.throwIfAborted();
      const result = await engine.roomSsReference(chart.song, query.controller.signal);
      if (!results.has(query.key) && results.size >= resultLimit) results.delete(results.keys().next().value!);
      results.set(query.key, result);
      query.result = result;
    } catch (error) {
      if (this.query !== query) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/^(chart-file-missing|chart-http:(404|410)|missing-chart:)/u.test(message)) query.error = "chart";
      else if (message.startsWith("missing battle SS grade for song ")) query.error = "thresholdMissing";
      else query.error = "failed";
    }
    if (this.query === query) this.requestUpdate();
  }

  private text(key: string, fallback: string, params?: Record<string, string | number>) {
    return clientText(this.locale, key, fallback, params);
  }
  private referenceText(key: string, fallback: string) {
    return this.text(`catalog.analysis.roomSsReference.${key}`, fallback);
  }
  private renderResult(result: RoomSsReference | undefined) {
    const number = new Intl.NumberFormat(this.locale);
    const crossing = result?.neutralCrossing;
    const format = (score?: number) => score === undefined ? "—" : number.format(score);
    return html`
      <div class="stack stack--tight" aria-busy=${String(!result)}>
        <dl class="spec-list spec-list--trailing spec-list--numeric">
          <div><dt>${this.referenceText("threshold", "Five-player SS threshold")}</dt>
            <dd>${result ? format(result.reference.roomThreshold) : this.text("common.states.loading", "Loading")}</dd></div>
          ${!result || crossing ? html`<div><dt>${this.referenceText("base", "Base per player · similar teams")}</dt>
            <dd>${format(crossing?.baseScore)}</dd></div>` : nothing}
        </dl>
        ${result && !crossing ? html`<span role="status">${this.text("common.states.unavailable", "Unavailable")}</span>` : html`
          <table class="data-table data-table--numeric">
            <thead><tr>
              <th scope="col">${this.referenceText("placements", "Places by section")}</th>
              <th scope="col" class="is-numeric">${this.referenceText("personal", "Personal reference")}</th>
            </tr></thead>
            <tbody>
              ${(result?.reference.seats.map(seat => seat.ranks) ?? defaultRanks).map((ranks, index) => html`
                <tr><th scope="row" class="tabular">${ranks.join(" / ")}</th>
                  <td class="is-numeric tabular">${format(crossing?.scores[index])}</td></tr>
              `)}
            </tbody>
          </table>
          <div>${this.referenceText("offset", "A surplus can cover another player’s shortfall.")}</div>
        `}
      </div>
      ${!result ? html`<span class="sr-only" role="status">${this.text("common.states.loading", "Loading")}</span>` : nothing}
    `;
  }
  render() {
    const chart = this.selectedChart;
    if (!chart) return nothing;
    const key = referenceKey(chart);
    const query = this.query?.key === key ? this.query : undefined;
    const result = query?.result ?? results.get(key);
    const error = query?.error;
    return accordion({
      id: this.panelId,
      label: this.referenceText("title", "Five-player SS reference"),
      headingLevel: 4,
      supportingText: this.charts.length === 1 ? chart.label : undefined,
      expanded: this.expanded,
      onExpandedChange: expanded => { this.expanded = expanded; },
      content: this.expanded ? html`
        <div class="stack stack--tight">
          ${this.charts.length > 1 ? choiceField({
            type: "select",
            label: this.text("tools.teamBuilder.sc.choose", "Playable charts"),
            value: key,
            options: this.charts.map(entry => ({ value: referenceKey(entry), label: entry.label })),
            onSelect: value => { this.choice = value; },
          }) : nothing}
          ${error ? html`
            <div class="row row--wrap">
              <span role="status">${this.referenceText(error, errorLabels[error])}</span>
              ${error === "failed" ? html`
                <button type="button" class="button button--text" @click=${() => {
                  this.releaseSession();
                  this.clearQuery();
                  this.requestUpdate();
                }}>${this.text("common.actions.retry", "Retry")}</button>` : nothing}
            </div>` : this.renderResult(result)}
        </div>` : nothing,
    });
  }
}

if (!customElements.get("room-ss-reference")) customElements.define("room-ss-reference", RoomSsReferenceElement);
