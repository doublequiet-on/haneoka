// L3 — GEB
// Input: Region, Arena season, league band, rank thresholds and card catalogues.
// Output: The league ranking in song-ranking rows plus rank tiers, with rank jumps and windows of 100.
// Pos: [Map](L2-2.md); Arena page leaderboard sharing the song-ranking row parts.
// Effects/Dependencies: Reads /api/v1/game/records/{region}/arena/…/ranking; reports loaded rows to the page.
import { html, nothing, type PropertyValues } from "lit";
import { GameRecordsCardsElement } from "./shared/game-records-cards";
import { fetchJson, JsonResponseError } from "./shared/catalog";
import { clientText } from "../i18n/client";
import { playerProfileHref } from "../lib/player-profile-route";
import { navigationDocumentUrl } from "../lib/document-url";
import { RequestScope } from "../lib/request-scope";
import type { ArenaRank } from "../lib/arena";
import type { ArenaRankingDto, ArenaRankingRowDto, GameRecordsErrorDto, GameRecordsRegion } from "../lib/game-records";
import { iconButton } from "./ui/controls";
import { icon } from "./ui/icon";
import { emptyState, errorState } from "./ui/state";
import "@material/web/progress/linear-progress.js";
import "../styles/song-ranking.css";

const WINDOW = 100;

/** The highest open rank whose threshold the points reach. */
export function arenaTier(ranks: readonly ArenaRank[], point: number, at = Date.now()): ArenaRank | undefined {
  let best: ArenaRank | undefined;
  for (const rank of ranks)
    if ((!rank.startAt || rank.startAt <= at) && rank.points <= point && (!best || rank.points >= best.points))
      best = rank;
  return best;
}

export class ArenaRanking extends GameRecordsCardsElement {
  static properties = {
    locale: { type: String },
    region: { type: String },
    seasonId: { type: Number },
    bandId: { type: Number },
    ranks: { attribute: false },
    rankIcons: { attribute: false },
    rankName: { attribute: false },
    limit: { type: Number },
    start: { state: true },
    phase: { state: true },
    data: { state: true },
    failure: { state: true },
  };
  declare seasonId: number;
  declare bandId: number;
  declare ranks: readonly ArenaRank[];
  declare rankIcons: Record<number, string>;
  declare rankName: (rank: ArenaRank) => string;
  /** Rows shown; 0 shows the whole window with its controls. */
  declare limit: number;
  declare private start: number;
  declare private phase: "loading" | "ready" | "error";
  declare private data: ArenaRankingDto | null;
  declare private failure: GameRecordsErrorDto["error"] | null;
  private requests = new RequestScope();

  constructor() {
    super();
    this.locale = "en";
    this.region = "tw";
    this.seasonId = 0;
    this.bandId = 0;
    this.ranks = [];
    this.rankIcons = {};
    this.rankName = (rank) => String(rank.id);
    this.limit = 0;
    this.start = 1;
    this.phase = "loading";
    this.data = null;
    this.failure = null;
  }

  set catalogs(value: GameRecordsCardsElement["cardCatalogs"]) {
    this.cardCatalogs = value;
    this.requestUpdate();
  }

  disconnectedCallback() {
    this.requests.cancel();
    super.disconnectedCallback();
  }

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("region") || changed.has("seasonId") || changed.has("bandId")) this.start = 1;
  }

  protected updated(changed: PropertyValues) {
    if (["region", "seasonId", "bandId", "start"].some((key) => changed.has(key)) && this.seasonId && this.bandId)
      void this.load();
  }

  private t(key: string, fallback: string, values: Record<string, string | number> = {}) {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      clientText(this.locale, `catalog.arena.ranking.${key}`, fallback),
    );
  }

  private endpoint() {
    return `/api/v1/game/records/${this.region}/arena/seasons/${this.seasonId}/leagues/${this.bandId}/ranking?start=${this.start}`;
  }

  private async load() {
    const signal = this.requests.begin();
    this.phase = "loading";
    this.failure = null;
    try {
      const data = await fetchJson<ArenaRankingDto>(this.endpoint(), {
        signal,
        headers: { accept: "application/json" },
      });
      if (!this.requests.current(signal)) return;
      this.data = data;
      this.phase = "ready";
    } catch (error) {
      if (!this.requests.current(signal)) return;
      this.failure =
        error instanceof JsonResponseError ? ((error.body as GameRecordsErrorDto | null)?.error ?? null) : null;
      this.data = null;
      this.phase = "error";
    }
    this.dispatchEvent(new CustomEvent("arena-ranking-rows", { detail: this.data, bubbles: true }));
  }

  refresh() {
    void this.load();
  }

  private jump(rank: number) {
    const maximum = this.data?.maxRank ?? Number.MAX_SAFE_INTEGER;
    this.start = Math.max(
      1,
      Math.min(Math.floor((Math.max(1, Math.min(rank, maximum)) - 1) / WINDOW) * WINDOW + 1, maximum),
    );
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>(`[data-rank="${rank}"]`)?.scrollIntoView({ block: "center" }),
    );
  }

  private renderRow(row: ArenaRankingRowDto, observedAt: number) {
    const name = row.name || this.label("privatePlayer", "Unknown player");
    const favorite = this.cardArtwork(row.favoriteMemberCardId, false);
    const level = this.levelFromExp(this.sourceCatalog()?.playerLevels, row.rankExp);
    const tier = arenaTier(this.ranks, row.point, observedAt);
    const identity = html`
      <strong>${name}</strong>
      <small class="song-ranking__player-stats">
        ${
          level != null
            ? html`
                <span>${this.label("cardLevel", "Lv. {level}").replace("{level}", String(level))}</span>
              `
            : nothing
        }
      </small>
    `;
    return html`
      <li class="song-ranking__entry" data-rank=${row.rank}>
        <div class="song-ranking__row arena-ranking__row">
          <span class="song-ranking__rank" aria-label=${`${this.label("rank", "Rank")} ${row.rank}`}>${row.rank}</span>
          <span class="song-ranking__avatar">
            ${
              favorite?.avatar
                ? this.profileMedia(name, favorite.avatar)
                : html`
                    <span class="song-ranking__initial" aria-hidden="true">${this.initials(name)}</span>
                  `
            }
          </span>
          ${
            row.profileId
              ? html`
                  <a
                    class="song-ranking__player-copy state-layer"
                    href=${playerProfileHref(this.locale, this.region as GameRecordsRegion, row.profileId, this.endpoint(), navigationDocumentUrl())}
                  >
                    ${identity}
                  </a>
                `
              : html`
                  <span class="song-ranking__player-copy">${identity}</span>
                `
          }
          <span class="arena-ranking__tier">
            ${
              tier && this.rankIcons[tier.rank]
                ? html`
                    <img src=${this.rankIcons[tier.rank]} alt="" width="28" height="28" loading="lazy" />
                  `
                : nothing
            }
            <span>${tier ? this.rankName(tier) : "—"}</span>
          </span>
          <span class="song-ranking__score" aria-label=${`${this.t("points", "Points")} ${row.point}`}>
            <strong>${row.point.toLocaleString(this.locale)}</strong>
            ${
              row.tied
                ? html`
                    <small>${this.label("tied", "Tied rank")}</small>
                  `
                : nothing
            }
          </span>
          ${
            this.limit
              ? nothing
              : html`
                  <span class="song-ranking__deck-preview" aria-label=${this.label("cards", "Cards")}>
                    ${row.cards.map(
                      (card) => html`
                        <span class="song-ranking__deck-slot">
                          ${this.renderCard(card)}${
                            card.supportCardId != null
                              ? this.renderCard(card, true)
                              : html`
                                  <span
                                    class="song-ranking__card-media song-ranking__card-media--support song-ranking__card-empty"
                                  ></span>
                                `
                          }
                        </span>
                      `,
                    )}
                  </span>
                `
          }
        </div>
      </li>
    `;
  }

  private renderControls() {
    const data = this.data;
    const maximum = data?.maxRank ?? null;
    return html`
      <div class="arena-ranking__controls">
        <form
          class="arena-ranking__jump"
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            const value = Number(new FormData(event.currentTarget as HTMLFormElement).get("rank"));
            if (Number.isSafeInteger(value) && value > 0) this.jump(value);
          }}
        >
          <label class="field field--compact">
            <span>${this.t("jump", "Go to rank")}</span>
            <input name="rank" type="number" inputmode="numeric" min="1" max=${maximum ?? nothing} step="1" required />
          </label>
          <button class="button button--tonal" type="submit">${icon("arrow_forward")}${this.t("go", "Go")}</button>
        </form>
        <span class="arena-ranking__window md-body-medium">
          ${this.t("window", "{start}–{end}", { start: this.start.toLocaleString(this.locale), end: Math.min(this.start + WINDOW - 1, maximum ?? Infinity).toLocaleString(this.locale) })}
          ${
            maximum != null
              ? html`
                  / ${maximum.toLocaleString(this.locale)}
                `
              : nothing
          }
        </span>
        <span class="cluster">
          ${iconButton({ icon: "first_page", label: this.t("top", "Top"), disabled: this.start === 1, onClick: () => (this.start = 1) })}
          ${iconButton({ icon: "chevron_left", label: this.t("previous", "Previous 100"), disabled: this.start === 1, onClick: () => (this.start = Math.max(1, this.start - WINDOW)) })}
          ${iconButton({ icon: "chevron_right", label: this.t("next", "Next 100"), disabled: maximum != null && this.start + WINDOW > maximum, onClick: () => (this.start += WINDOW) })}
          ${iconButton({ icon: "refresh", label: this.label("refresh", "Refresh ranking"), disabled: this.phase === "loading", onClick: () => this.refresh() })}
        </span>
      </div>
    `;
  }

  render() {
    const data = this.data;
    const rows = this.limit ? (data?.rows ?? []).slice(0, this.limit) : (data?.rows ?? []);
    const observedAt = data?.observedAtMs ?? Date.now();
    return html`
      <section class="song-ranking-page arena-ranking" aria-busy=${String(this.phase === "loading")}>
        ${this.limit ? nothing : this.renderControls()}
        <div class="song-ranking__progress">
          ${
            this.phase === "loading"
              ? html`
                  <md-linear-progress indeterminate></md-linear-progress>
                `
              : nothing
          }
        </div>
        ${
          this.phase === "error"
            ? this.failure?.kind === "not_found"
              ? emptyState({ title: this.label("empty", "No scores yet"), icon: "leaderboard" })
              : errorState(this.label("error", "Ranking unavailable"), this.label("retry", "Retry"), () =>
                  this.refresh(),
                )
            : !rows.length && this.phase === "ready"
              ? emptyState({ title: this.label("empty", "No scores yet"), icon: "leaderboard" })
              : html`
                  <ol class=${`song-ranking__list${this.limit ? " arena-ranking__list--compact" : ""}`}>
                    ${rows.map((row) => this.renderRow(row, observedAt))}
                  </ol>
                `
        }
        ${
          data
            ? html`
                <p class="song-ranking__fetched">
                  ${data.provider === "official" ? this.label("officialSource", "Official game rankings") : this.label("updated", "Updated")}
                  ${new Intl.DateTimeFormat(this.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(observedAt))}
                </p>
              `
            : nothing
        }
      </section>
    `;
  }
}
if (!customElements.get("arena-ranking")) customElements.define("arena-ranking", ArenaRanking);
