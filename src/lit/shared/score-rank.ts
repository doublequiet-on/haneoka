import { html, nothing, type TemplateResult } from "lit";
import { scoreRankIconUrl, scoreRankName } from "../../lib/chart-rates";

/** The game's score-rank emblem. Every song ladder renders its ranks through this one mark. */
export function scoreRankIcon(server: string, rank: number, size = 32): TemplateResult | typeof nothing {
  const source = scoreRankIconUrl(server, rank);
  if (!source) return nothing;
  const name = scoreRankName(rank);
  return html`
    <img
      class="score-rank-icon"
      src=${source}
      alt=${name}
      title=${name}
      width=${size}
      height=${size}
      decoding="async"
      loading="lazy"
    />
  `;
}
