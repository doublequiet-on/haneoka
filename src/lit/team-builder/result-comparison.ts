// L3 — GEB
// Input: Accepted result sessions with explicit task, scoring and growth sources.
// Output: At most three retained candidates, compatible deltas and formation differences.
// Pos: [Map](../L2-2.md); page-local comparison, never persisted in Box or PtJob.
// Effects/Dependencies: Native dialog; no engine requests or changes to ranking.
import { html, nothing } from "lit";
import type { EngineHit, EngineRequest, SongResult } from "../../lib/team-builder/engine/api";
import { canonical } from "../../lib/team-builder/pt-recommendation";
import { cardIdOf } from "../../lib/team-builder/sync/box-view";
import { snackbar } from "../../lib/snackbar";
import { modal } from "../ui/modal";
import { iconButton, inputChip } from "../ui/controls";
import type { TeamBuilder } from "../team-builder";
import type { BuildSettings } from "./types";
import { resultSettings, usesPtResults } from "./score-goal";
import { resultMetric, type ResultMetric } from "./result-metric";

export interface ComparisonEntry {
  id: string;
  source: string;
  hit: EngineHit;
  settings: BuildSettings;
  input: EngineRequest;
  conditions: string;
  metric: ResultMetric;
  listed: boolean;
  proven: boolean;
  placements?: number[];
}
export function formationDifference(base: ComparisonEntry, candidate: ComparisonEntry) {
  const a = base.hit,
    b = candidate.hit;
  const replacements = (before: (string | null)[], after: (string | null)[]) =>
    after.filter((key) => key && !before.includes(key)).length;
  const binding = new Map(a.members.map((key, index) => [key, a.snaps[index] ?? null]));
  const growth = (entry: ComparisonEntry, kind: "members" | "snaps", key: string) =>
    entry.input[kind].find((row) => row.key === key);
  return {
    members: replacements(a.members, b.members),
    snaps: replacements(a.snaps, b.snaps),
    bindings: b.members.filter((key, index) => binding.has(key) && binding.get(key) !== (b.snaps[index] ?? null))
      .length,
    leader: a.members[0] !== b.members[0],
    growth: (["members", "snaps"] as const).reduce(
      (count, kind) =>
        count +
        b[kind].filter(
          (key) =>
            key &&
            a[kind].includes(key) &&
            canonical(growth(base, kind, key)) !== canonical(growth(candidate, kind, key)),
        ).length,
      0,
    ),
  };
}
export function metricDelta(base: ComparisonEntry, candidate: ComparisonEntry) {
  if (
    base.conditions !== candidate.conditions ||
    base.metric.id !== candidate.metric.id ||
    base.metric.unit !== candidate.metric.unit
  )
    return null;
  const absolute = candidate.metric.value - base.metric.value;
  return {
    absolute,
    relative: base.metric.value > 0 && candidate.metric.relative ? (absolute / base.metric.value) * 100 : null,
  };
}
function entry(
  host: TeamBuilder,
  hit: EngineHit,
  source: string,
  result: SongResult,
  input: EngineRequest,
  session: string,
  settings = resultSettings(host, hit),
): ComparisonEntry {
  const goal = { ...input.goal } as Record<string, unknown>;
  delete goal.songs;
  const growth = [
    hit.members.map((key) => input.members.find((row) => row.key === key)),
    hit.snaps.map((key) => input.snaps.find((row) => row.key === key)),
  ];
  const identity = hit.song ? host.catalog!.songIdentity(hit.song.songId) : host.data!.identity;
  const id = canonical([session, source, settings.route, settings.measure, hit.song, hit.members, hit.snaps, growth]);
  return {
    id,
    source,
    hit: structuredClone(hit),
    settings: structuredClone(settings),
    input,
    conditions: canonical([
      identity,
      hit.song,
      goal,
      input.player,
      input.unknownPolicy,
      result.placements,
      settings.route,
      settings.measure,
      settings.boosts,
      settings.challengePoints,
      usesPtResults(host) ? host.pt.job?.cycle : settings.ptCycle,
    ]),
    metric: resultMetric(host, hit, settings),
    listed: true,
    proven: result.proven,
    placements: result.placements?.slice(),
  };
}
export class ResultComparison {
  session = "";
  items: ComparisonEntry[] = [];
  baseline = "";
  open = false;
  sync(host: TeamBuilder) {
    const pt = usesPtResults(host),
      session = pt ? (host.pt.job?.id ?? "") : host.resultSession;
    if (session !== this.session) {
      this.session = session;
      this.items = [];
      this.baseline = "";
      this.open = false;
    }
    if (!this.items.length) return;
    const all = this.sources(host);
    this.items = this.items.map((item) => all.find((next) => next.id === item.id) ?? { ...item, listed: false });
  }
  private sources(host: TeamBuilder): ComparisonEntry[] {
    const identity = (source: string, hit: EngineHit) => canonical([source, hit.song, hit.members, hit.snaps]);
    const selected = new Set(this.items.map((item) => identity(item.source, item.hit)));
    if (usesPtResults(host)) {
      const job = host.pt.job;
      return job
        ? job.tasks.flatMap(
            (task) =>
              task.result?.hits
                .filter((hit) => selected.has(identity(`${task.route}:${task.measure}`, hit)))
                .map((hit) =>
                  entry(
                    host,
                    hit,
                    `${task.route}:${task.measure}`,
                    task.result!,
                    job.request,
                    job.id,
                    resultSettings(host, hit, task),
                  ),
                ) ?? [],
          )
        : [];
    }
    return host.resultInputs
      ? (host.results?.results.flatMap((result) =>
          result.hits
            .filter((hit) => selected.has(identity("build", hit)))
            .map((hit) => entry(host, hit, "build", result, host.resultInputs!, host.resultSession)),
        ) ?? [])
      : [];
  }
  find(host: TeamBuilder, hit: EngineHit) {
    const pt = usesPtResults(host),
      task = pt ? host.pt.job?.tasks.find((task) => task.result?.hits.includes(hit)) : undefined;
    const result = pt ? task?.result : host.results?.results.find((result) => result.hits.includes(hit));
    const input = pt ? host.pt.job?.request : host.resultInputs;
    return result && input
      ? entry(
          host,
          hit,
          task ? `${task.route}:${task.measure}` : "build",
          result,
          input,
          this.session,
          resultSettings(host, hit, task),
        )
      : null;
  }
  toggle(host: TeamBuilder, hit: EngineHit) {
    this.sync(host);
    const candidate = this.find(host, hit);
    if (!candidate) return;
    if (this.items.some((item) => item.id === candidate.id)) this.remove(candidate.id);
    else if (this.items.length === 3) snackbar(host.t("compareLimit", "Compare up to 3 teams"));
    else {
      this.items.push(candidate);
      this.baseline ||= candidate.id;
    }
    host.requestUpdate();
  }
  remove(id: string) {
    this.items = this.items.filter((item) => item.id !== id);
    if (this.baseline === id) this.baseline = this.items[0]?.id ?? "";
    if (this.items.length < 2) this.open = false;
  }
  title(host: TeamBuilder, item: ComparisonEntry) {
    return item.hit.song
      ? `${host.catalog!.songTitle(item.hit.song.songId)} · ${host.catalog!.difficultyLabel(item.hit.song.songId, item.hit.song.difficulty)}`
      : item.metric.label;
  }
  tray(host: TeamBuilder) {
    this.sync(host);
    return this.items.length
      ? html`
          <div class="tb-compare-tray" aria-label=${host.t("comparison", "Comparison")}>
            <div class="cluster">
              ${this.items.map((item) =>
                inputChip(this.title(host, item), host.common("common.actions.remove", "Remove"), () => {
                  this.remove(item.id);
                  host.requestUpdate();
                }),
              )}
            </div>
            <button
              class="button button--tonal"
              ?disabled=${this.items.length < 2}
              @click=${() => {
                this.open = true;
                host.requestUpdate();
              }}
            >
              ${host.t("compareTeams", "Compare teams")} · ${this.items.length}/3
            </button>
          </div>
        `
      : nothing;
  }
  dialog(host: TeamBuilder) {
    this.sync(host);
    if (!this.open || this.items.length < 2) return nothing;
    const base = this.items.find((item) => item.id === this.baseline)!;
    const format = (v: number, digits = 0) =>
      new Intl.NumberFormat(host.locale, { maximumFractionDigits: digits }).format(v);
    const close = () => {
      this.open = false;
      host.requestUpdate();
    };
    return html`
      <dialog
        class="dialog tb-comparison"
        data-managed-modal
        ${modal(close)}
        aria-label=${host.t("compareTeams", "Compare teams")}
      >
        <header class="row row--between">
          <strong>${host.t("compareTeams", "Compare teams")}</strong>
          ${iconButton({ icon: "close", label: host.common("common.actions.close", "Close"), onClick: close })}
        </header>
        ${
          (usesPtResults(host) ? host.pt.stale : host.stale)
            ? html`
                <span role="status">${host.t("stale", "Conditions changed")}</span>
              `
            : nothing
        }
        <div class="tb-comparison-grid">
          ${this.items.map((item) => {
            const delta = metricDelta(base, item),
              diff = formationDifference(base, item);
            return html`
              <section class="surface stack">
                <strong>${this.title(host, item)}</strong>
                <span>
                  ${item.settings.route === "challenge" ? host.t("routeChallenge", "Challenge live") : item.settings.route === "skip" ? host.t("routeSkip", "Skip") : host.t("routeLive", "Normal live")}
                </span>
                <button
                  class="button button--tonal"
                  aria-pressed=${item.id === base.id}
                  @click=${() => {
                    this.baseline = item.id;
                    host.requestUpdate();
                  }}
                >
                  ${host.t(item.id === base.id ? "comparisonBaseline" : "setBaseline", item.id === base.id ? "Baseline" : "Set as baseline")}
                </button>
                ${
                  item.input.goal.kind === "gekiso"
                    ? html`
                        <span>
                          ${host.t("gekisoPlacements", "Scoring placements")}:
                          ${item.input.goal.opponents ? (item.placements?.join(" / ") ?? "—") : item.input.goal.rank}
                        </span>
                        <span>
                          GREAT ${format(item.input.goal.accuracy.great * 100, 2)}% · JUST
                          ${format(item.input.goal.accuracy.just * 100, 2)}%
                        </span>
                      `
                    : item.input.goal.kind === "event" && item.input.goal.gekiso && item.settings.route !== "challenge"
                      ? html`
                          <span>
                            ${host.t("gekisoPlacements", "Scoring placements")}: 1 · JUST
                            ${format(item.input.goal.gekiso.just * 100, 2)}%
                          </span>
                        `
                      : nothing
                }
                ${
                  item.settings.goal === "event" || item.settings.goal === "plan"
                    ? html`
                        <span>
                          ${item.settings.route === "challenge" ? `${item.settings.challengePoints} CP` : `${item.settings.boosts} Boost`}
                        </span>
                      `
                    : nothing
                }
                <span>${item.metric.label}</span>
                <span class="tb-results__meta">
                  ${host.t(item.proven ? "proven" : "recommendation", item.proven ? "Proven optimal" : "Recommendation")}
                </span>
                <strong class="tb-hit__value">
                  ${format(item.metric.value, item.metric.digits)} ${item.metric.unit}
                </strong>
                <dl class="spec-list">
                  <dt>${host.t("difference", "Difference")}</dt>
                  <dd>
                    ${delta ? `${delta.absolute > 0 ? "+" : ""}${format(delta.absolute, item.metric.digits)} ${item.metric.unit === "%" ? host.t("percentagePoints", "percentage points") : item.metric.unit}` : "—"}
                  </dd>
                  <dt>${host.t("relativeDifference", "Relative change")}</dt>
                  <dd>
                    ${delta?.relative != null ? `${delta.relative > 0 ? "+" : ""}${format(delta.relative, 2)}%` : "—"}
                  </dd>
                  <dt>${host.t("power", "Power")}</dt>
                  <dd>${format(item.hit.power)}</dd>
                  ${
                    item.hit.comboBonus != null
                      ? html`
                          <dt>${host.t("comboBonus", "Base COMBO BONUS")}</dt>
                          <dd>
                            ×${item.hit.comboBonus}${delta && base.hit.comboBonus != null ? ` (Δ ${format(item.hit.comboBonus - base.hit.comboBonus, 2)})` : ""}
                          </dd>
                        `
                      : nothing
                  }
                  ${(["members", "snaps", "bindings", "growth"] as const).map(
                    (key) => html`
                      <dt>${host.t(`diff${key}`, key)}</dt>
                      <dd>${diff[key]}</dd>
                    `,
                  )}
                  <dt>${host.t("leader", "Leader")}</dt>
                  <dd>
                    ${host.catalog!.cardName("members", cardIdOf(item.hit.members[0]!))}${diff.leader ? ` · ${host.t("changed", "Changed")}` : ""}
                  </dd>
                </dl>
                <ul class="list">
                  ${item.hit.members.map(
                    (key, i) => html`
                      <li class="list-item">
                        <span class="list-item__body">
                          <strong>${host.catalog!.cardName("members", cardIdOf(key))}</strong>
                          <small>
                            ${item.hit.snaps[i] ? host.catalog!.cardName("snaps", cardIdOf(item.hit.snaps[i]!)) : host.t("noSnap", "No Snapshot")}
                          </small>
                        </span>
                      </li>
                    `,
                  )}
                </ul>
                ${
                  !item.listed
                    ? html`
                        <span>${host.t("outsideRanking", "Outside current ranking")}</span>
                      `
                    : nothing
                }
              </section>
            `;
          })}
        </div>
      </dialog>
    `;
  }
}
