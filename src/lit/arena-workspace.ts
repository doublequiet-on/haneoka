// L3 — GEB
// Input: Pinned arena seasons, league rules, rewards and UI marks.
// Output: A season pager with every league and period, in the viewer's timezone.
// Pos: [Map](L2-2.md); standalone arena workspace using shared page/table/accordion components.
// Effects/Dependencies: Uses embedded static data, preserves season/period anchors, owns app-bar links and the boundary timer.
import { LitElement, html, nothing } from "lit";
import { clientText } from "../i18n/client";
import type { Locale } from "../i18n/locales";
import {
  ARENA_PROJECTION,
  arenaBoundaries,
  arenaContains,
  arenaCurrentRule,
  arenaPeriods,
  arenaSongRule,
  type ArenaCatalog,
  type ArenaReward,
  type ArenaRule,
  type ArenaSeason,
} from "../lib/arena";
import type { CatalogSystemPayload } from "../lib/catalog-system-data";
import { readPageData } from "../lib/page-data";
import { adoptPrerenderedWorkspace } from "../lib/workspace-page-data";
import { clearAppBarActions, setAppBarActions } from "../lib/app-bar";
import { resourcePath, releaseServerFromPath } from "../lib/resource-route";
import { gekisouMission } from "../lib/gekisou";
import { catalogUrl, fetchJson, gameDateTime, localizedText, preferredLocale } from "./shared/catalog";
import { renderDetailSectionHeading as heading } from "./shared/detail-section-heading";
import { accordion } from "./ui/accordion";
import { collectionList, collectionTable } from "./ui/collection-view";
import { emptyState, errorState, loadingState } from "./ui/state";
import { LazyImages } from "./ui/lazy-images";
import { icon, gameGlyph } from "./ui/icon";
import { iconButton } from "./ui/controls";
import { navigationDocumentUrl } from "../lib/document-url";
import "../styles/arena.css";

let sequence = 0;
export class ArenaWorkspace extends LitElement {
  static properties = {
    locale: { type: String },
    phase: { state: true },
    now: { state: true },
    selectedSeasonId: { state: true },
  };
  declare locale: Locale;
  declare phase: "loading" | "ready" | "error";
  declare now: number;
  declare selectedSeasonId: string;
  private catalog?: ArenaCatalog;
  private marks: Record<string, string> = {};
  private server = "jp";
  private owner = `arena-${++sequence}`;
  private timer = 0;
  private request?: AbortController;
  private expanded = new Set<string>();
  private images = new LazyImages();
  private localeReady = () => {
    this.locale = preferredLocale(this.locale) as Locale;
  };
  private visibility = () => {
    if (!document.hidden) {
      this.now = Date.now();
      this.schedule();
    }
  };
  constructor() {
    super();
    this.locale = "ja";
    this.phase = "loading";
    this.now = Date.now();
    this.selectedSeasonId = "";
  }
  createRenderRoot() {
    return this;
  }
  preparePage(payload: CatalogSystemPayload, locale: string) {
    adoptPrerenderedWorkspace(this);
    this.locale = locale as Locale;
    this.server = payload.server;
    this.now = Date.now();
    this.catalog = payload.arena;
    this.marks = payload.marks || {};
    this.phase = "ready";
  }
  connectedCallback() {
    super.connectedCallback();
    this.locale = preferredLocale(this.locale) as Locale;
    this.server = releaseServerFromPath(location.pathname) || "jp";
    addEventListener("haneoka:locale-ready", this.localeReady);
    document.addEventListener("visibilitychange", this.visibility);
    addEventListener("hashchange", this.restoreSeason);
    document.addEventListener("astro:page-load", this.restoreSeason);
    void this.load();
  }
  disconnectedCallback() {
    this.request?.abort();
    clearTimeout(this.timer);
    this.images.disconnect();
    clearAppBarActions(this.owner);
    removeEventListener("haneoka:locale-ready", this.localeReady);
    document.removeEventListener("visibilitychange", this.visibility);
    removeEventListener("hashchange", this.restoreSeason);
    document.removeEventListener("astro:page-load", this.restoreSeason);
    super.disconnectedCallback();
  }
  private async load() {
    const payload = readPageData<CatalogSystemPayload>(this);
    if (payload?.kind === "arena" && payload.arena) this.preparePage(payload, this.locale);
    else {
      this.request?.abort();
      const request = (this.request = new AbortController());
      this.phase = "loading";
      try {
        const catalog = await fetchJson<ArenaCatalog>(
          `${catalogUrl("arena", "", this.server)}?projection=${ARENA_PROJECTION}`,
          { signal: request.signal },
        );
        const marksUrl = new URL(catalogUrl("ui-marks", "", this.server), location.origin);
        marksUrl.searchParams.set("release", catalog.identity.releaseId);
        const marks = await fetchJson<Record<string, string>>(marksUrl.toString(), { signal: request.signal });
        if (request.signal.aborted) return;
        this.catalog = catalog;
        this.marks = marks;
        this.phase = "ready";
      } catch {
        if (!request.signal.aborted) this.phase = "error";
      }
    }
    this.now = Date.now();
    if (this.isConnected) {
      this.restoreSeason();
      this.schedule();
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    const now = Date.now();
    const next = this.seasons()
      .flatMap(arenaBoundaries)
      .filter((at) => at > now)
      .sort((a, b) => a - b)[0];
    if (next)
      this.timer = window.setTimeout(
        () => {
          this.now = Date.now();
          this.schedule();
        },
        Math.min(2_147_483_647, next - now),
      );
  }
  private seasons() {
    return Object.values(this.catalog?.entries || {}).sort((a, b) => a.startAt - b.startAt);
  }
  private selectedSeason() {
    const seasons = this.seasons();
    return (
      seasons.find((season) => season.id === this.selectedSeasonId) ||
      seasons.find((season) => arenaContains(season, this.now)) ||
      seasons[0]
    );
  }
  private selectSeason(season: ArenaSeason) {
    this.selectedSeasonId = season.id;
    this.expanded.clear();
    const url = navigationDocumentUrl();
    url.hash = season.id;
    history.replaceState(history.state, "", url);
    void this.updateComplete.then(() => {
      for (const region of this.querySelectorAll<HTMLElement>(".table-scroll")) region.scrollLeft = 0;
    });
  }
  private restoreSeason = () => {
    const hash = navigationDocumentUrl().hash.slice(1);
    const target = this.seasons().find(
      (season) =>
        season.id === hash || arenaPeriods(season).some((period) => `arena-period-${period.startAt}` === hash),
    );
    if (!target) return;
    if (this.selectedSeasonId !== target.id) this.expanded.clear();
    this.selectedSeasonId = target.id;
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>(`[id="${hash}"]`)?.scrollIntoView({
        block: hash.startsWith("arena-period-") ? "center" : "start",
      }),
    );
  };
  private t(key: string, params?: Record<string, string | number>) {
    return clientText(this.locale, `catalog.arena.${key}`, key, params);
  }
  private name(value: unknown) {
    return localizedText(value, this.locale);
  }
  private time(at: number) {
    return html`
      <time datetime=${new Date(at).toISOString()}>${gameDateTime(this.locale, at)}</time>
    `;
  }
  private href(kind: "songs" | "items" | "events" | "exchange", id: string) {
    return resourcePath({ server: this.server, locale: this.locale, kind, id });
  }
  private disclosure(
    key: string,
    title: unknown,
    content: unknown,
    metadata?: unknown,
    image?: string,
    supportingText?: string,
  ) {
    return accordion({
      id: `arena-${key}`,
      label: title,
      metadata,
      supportingText,
      leading: image
        ? html`
            <img src=${image} alt="" width="24" height="24" loading="lazy" />
          `
        : undefined,
      expanded: this.expanded.has(key),
      onExpandedChange: (expanded) => {
        if (expanded) this.expanded.add(key);
        else this.expanded.delete(key);
        this.requestUpdate();
      },
      content: html`
        <div class="detail-fold__body">${content}</div>
      `,
      className: "detail-fold",
    });
  }
  private attribute(value: number) {
    const key = ["", "red", "blue", "green", "yellow", "purple"][value];
    const label =
      value === 99
        ? "ALL"
        : value === 0
          ? this.t("originalRule")
          : clientText(this.locale, `catalog.songs.liveTypes.${key}`);
    const source = this.marks[`sp_icon_live_music_type_${value}.png`];
    const image =
      source &&
      `/runtime/${this.server}/${source.replace(/^runtime\//u, "")}?release=${this.catalog!.identity.releaseId}`;
    return html`
      <span class="arena-rule-mark">
        ${
          image
            ? html`
                <img src=${image} width="24" height="24" alt=${label} />
              `
            : label
        }
      </span>
    `;
  }
  private missions(values: readonly number[]) {
    const names = values.map((value) => gekisouMission(value)?.fallback || this.t("originalRule"));
    return names.every((name) => name === names[0]) ? `${names[0]} ×3` : names.join(" / ");
  }
  private rule(rule: ArenaRule | undefined) {
    return rule
      ? html`
          <span class="arena-rule-mark">
            ${this.attribute(rule.musicType)}
            <span class="stack stack--flush">
              ${(rule.missions.every((value) => value === rule.missions[0]) ? [rule.missions[0]] : rule.missions).map(
                (value) => {
                  const label = gekisouMission(value)?.fallback || this.t("originalRule");
                  const image = this.catalog?.images?.missions[value];
                  const repeated = rule.missions.every((entry) => entry === value);
                  return html`
                    <span class="stack stack--flush">
                      <span class="row">
                        ${image ? gameGlyph(image, 24) : nothing}${
                          repeated
                            ? html`
                                <small>×3</small>
                              `
                            : nothing
                        }
                      </span>
                      <small>${label}</small>
                    </span>
                  `;
                },
              )}
            </span>
          </span>
        `
      : "—";
  }
  private rewards(rewards: ArenaReward[]) {
    return collectionList(
      rewards.map((reward) => ({
        id: String(reward.id),
        title: this.name(reward.name),
        subtitle: "",
        image: reward.image,
        trailing: `×${reward.count.toLocaleString(this.locale)}`,
        href: reward.resourceType === 1 ? this.href("items", String(reward.resourceId)) : undefined,
      })),
    );
  }
  private season(season: ArenaSeason) {
    const periods = arenaPeriods(season);
    const seasons = this.seasons();
    const index = seasons.indexOf(season);
    return html`
      <section class="surface stack arena-season" id=${season.id}>
        <div class="row row--between" role="group" aria-label=${this.name(season.title)}>
          ${iconButton({
            icon: "chevron_left",
            label: this.t("previousSeason"),
            disabled: index === 0,
            onClick: () => this.selectSeason(seasons[index - 1]!),
          })}
          <h2 class="detail-section-title" aria-live="polite">${this.name(season.title)}</h2>
          ${iconButton({
            icon: "chevron_right",
            label: this.t("nextSeason"),
            disabled: index === seasons.length - 1,
            onClick: () => this.selectSeason(seasons[index + 1]!),
          })}
        </div>
        <dl class="spec-list spec-list--split">
          <div>
            <dt>${clientText(this.locale, "catalog.systems.common.starts")}</dt>
            <dd>${this.time(season.startAt)}</dd>
          </div>
          <div>
            <dt>${clientText(this.locale, "catalog.systems.common.ends")}</dt>
            <dd>${this.time(season.endAt)}</dd>
          </div>
        </dl>
        ${
          periods.length
            ? collectionTable(
                this.t("schedule"),
                [
                  this.t("period"),
                  ...season.leagues.map(
                    (league) => html`
                      <span class="stack stack--tight">
                        ${
                          league.image
                            ? html`
                                <img src=${league.image} alt="" width="24" height="24" loading="lazy" />
                              `
                            : nothing
                        }
                        <span>${this.name(league.name)}</span>
                      </span>
                    `,
                  ),
                ],
                periods.map((period) => {
                  const current = period.startAt <= this.now && this.now < period.endAt;
                  return [
                    html`
                      <div
                        class="arena-period"
                        id=${`arena-period-${period.startAt}`}
                        aria-current=${current ? "time" : nothing}
                      >
                        ${this.time(period.startAt)}
                        <span>– ${this.time(period.endAt)}</span>
                        <span class="chip chip--static arena-current-label" aria-hidden=${String(!current)}>
                          <span class="chip__label">${this.t("currentRule")}</span>
                        </span>
                      </div>
                    `,
                    ...period.rules.map((rule) => this.rule(rule)),
                  ];
                }),
              )
            : html`
                <div class="md-body-medium">${this.t("noSchedule")}</div>
              `
        }
      </section>
    `;
  }
  private related(season: ArenaSeason) {
    const groups = new Map<string, ArenaReward[]>();
    for (const reward of season.seasonRewards) {
      const range = `${reward.from}–${reward.to}`;
      groups.set(range, [...(groups.get(range) || []), reward]);
    }
    return html`
      ${
        season.events.length
          ? html`
              <section class="surface stack">
                ${heading(this.t("events"), "content")}
                ${collectionList(
                  season.events.map((event) => ({
                    id: String(event.id),
                    title: this.name(event.title),
                    image: String(event.image || ""),
                    subtitle: `${gameDateTime(this.locale, Number((event.startAt as number[])[0]))} – ${gameDateTime(this.locale, Number((event.endAt as number[])[0]))}`,
                    href: this.href("events", String(event.id)),
                  })),
                )}
              </section>
            `
          : nothing
      }
      <section class="surface stack">
        ${heading(this.t("songs"), "songs")}
        ${season.leagues.map((league) => {
          const rule = arenaCurrentRule(season, league, this.now);
          const songs = league.songs.filter((song) => Number(song.arenaPublishedAt) <= this.now);
          return this.disclosure(
            `songs-${league.id}`,
            this.name(league.name),
            collectionList(
              songs.map((song) => ({
                id: String(song.musicId),
                title: this.name(song.musicTitle),
                image: String(song.jacketThumbUrl || song.jacketUrl || ""),
                subtitle: rule ? this.missions(arenaSongRule(song, rule).missions) : "",
                href: this.href("songs", String(song.musicId)),
              })),
            ),
            songs.length,
            league.image,
          );
        })}
      </section>
      <section class="surface stack">
        ${heading(this.t("rewards"), "rewards")}
        ${this.disclosure("daily", this.t("dailyRewards"), this.rewards(season.dailyRewards), this.t("plays", { count: season.dailyRewards.length }))}
        ${this.disclosure(
          "promotion",
          this.t("promotionRewards"),
          html`
            <div class="stack">
              ${season.leagues.map((league) =>
                this.disclosure(
                  `ranks-${league.id}`,
                  this.name(league.name),
                  html`
                    <div class="stack">
                      ${league.ranks.map((rank) =>
                        this.disclosure(
                          `rank-${rank.id}`,
                          this.name(rank.name),
                          this.rewards(league.promotionRewards.filter((reward) => reward.rankId === rank.id)),
                          undefined,
                          this.catalog?.images?.ranks[rank.rank],
                          `${rank.points.toLocaleString(this.locale)} ${this.t("points")}`,
                        ),
                      )}
                    </div>
                  `,
                  league.ranks.length,
                  league.image,
                ),
              )}
            </div>
          `,
        )}
        ${this.disclosure(
          "season-rewards",
          this.t("seasonRewards"),
          html`
            <div class="stack">
              ${[...groups].map(([range, rewards]) => this.disclosure(`reward-${range}`, `${range} ${this.t("points")}`, this.rewards(rewards)))}
            </div>
          `,
        )}
        ${collectionList(season.exchanges.map((exchange) => ({ id: String(exchange.id), title: this.name(exchange.title), image: String(exchange.image || ""), subtitle: this.t("exchange"), href: this.href("exchange", String(exchange.id)) })))}
      </section>
    `;
  }
  renderStaticChrome() {
    const current = this.seasons()
      .flatMap(arenaPeriods)
      .find((period) => period.startAt <= this.now && this.now < period.endAt);
    setAppBarActions(
      this.owner,
      html`
        ${
          current
            ? html`
                <a
                  class="button button--text"
                  href=${`#arena-period-${current.startAt}`}
                  @click=${(event: MouseEvent) => {
                    event.preventDefault();
                    const url = navigationDocumentUrl();
                    url.hash = `arena-period-${current.startAt}`;
                    history.replaceState(history.state, "", url);
                    this.selectedSeasonId = this.seasons().find((season) => arenaContains(season, this.now))?.id || "";
                    this.expanded.clear();
                    void this.updateComplete.then(() =>
                      this.querySelector<HTMLElement>(`#arena-period-${current.startAt}`)?.scrollIntoView({
                        block: "center",
                      }),
                    );
                  }}
                >
                  ${this.t("currentRule")}
                </a>
              `
            : nothing
        }
        <a
          class="icon-button"
          href=${`/${this.server}/${this.locale}/calendar/?kinds=arena,arena-rotation,event&view=agenda`}
          aria-label=${this.t("calendar")}
        >
          ${icon("calendar_month")}
        </a>
      `,
    );
  }
  updated() {
    this.images.observe(this);
    this.renderStaticChrome();
  }
  render() {
    if (this.phase === "loading") return loadingState(clientText(this.locale, "common.states.loading"));
    if (this.phase === "error")
      return errorState(
        clientText(this.locale, "common.states.unavailable"),
        clientText(this.locale, "common.actions.retry"),
        () => void this.load(),
      );
    const selected = this.selectedSeason();
    if (!selected) return emptyState({ title: this.t("noSchedule") });
    return html`
      <div class="page arena-page stack stack--loose">${this.season(selected)}${this.related(selected)}</div>
    `;
  }
}
if (!customElements.get("arena-workspace")) customElements.define("arena-workspace", ArenaWorkspace);
