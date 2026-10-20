// L3 — GEB
// Input: 正式／社区谱面的详情内容、难度展示和统计项。
// Output: 共用歌曲详情分节与谱面统计网格。
// Pos: [Map](L2-2.md)；歌曲与社区谱面摘要模板。
// Effects/Dependencies: Lit、既有分节标题与共享歌曲样式，无数据读取。
import { html, nothing } from "lit";
import { renderDetailSectionHeading, type DetailSectionKind } from "../shared/detail-section-heading";
import "../../styles/patterns/song.css";

export function songDetailSection(title: unknown, kind: DetailSectionKind, body: unknown) {
  return html`
    <section class="detail-section song-detail-section">${renderDetailSectionHeading(title, kind)}${body}</section>
  `;
}

export function songChartSummary(options: {
  title: string;
  difficulty: unknown;
  metrics: readonly { label: string; value: unknown; lang?: string }[];
}) {
  return songDetailSection(
    options.title,
    "difficulty",
    html`
      ${options.difficulty}
      <dl class="song-data-grid song-meta-strip">
        ${options.metrics.map(
        (metric) => html`
          <div>
            <dt>${metric.label}</dt>
            <dd lang=${metric.lang || nothing}>${metric.value}</dd>
          </div>
        `,
      )}
      </dl>
    `,
  );
}
