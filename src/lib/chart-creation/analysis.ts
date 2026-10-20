// L3 — GEB
// Input: 不可变社区工程与版本身份。
// Output: 原生谱面统计及共用 FC 操作负荷模型的推荐等级。
// Pos: [Map](../L2-2.md)；社区谱面分析适配。
// Effects/Dependencies: 两个现有转换器交叉核对 combo，复用现有校准；纯计算，无 HTTP 或存储。
import { buildChart, parseScore } from "@haneoka/cassiopeia-plugin-our-notes";
import { convertChartAsync } from "@haneoka/sonolus";
import { serializeSsForTarget } from "../../../packages/chart-editor/src/formats/diagnostics";
import { readAuthorCollections } from "../../../packages/chart-editor/src/creation/collections";
import { TempoMap } from "../../../packages/chart-editor/src/timing";
import type { Project } from "../../../packages/chart-editor/src/model";
import { estimateChartDifficulty, CHART_DIFFICULTY_VERSION } from "../chart-difficulty";
import { OUR_NOTES_FC_CALIBRATION } from "../chart-difficulty-calibration";
import type { CommunityChartAnalysis } from "./community-types";

export const COMMUNITY_CHART_ANALYSIS_VERSION = `${CHART_DIFFICULTY_VERSION}:community-native-v1`;

export async function analyzeCommunityChart(project: Project, sourceId: string): Promise<CommunityChartAnalysis> {
  const ss = serializeSsForTarget({ ...project, extensions: {} }, false);
  const chart = buildChart(parseScore(ss));
  const playback = await convertChartAsync(ss);
  const tempo = new TempoMap(project.tempos, { resolution: project.resolution });
  chart.timeScaleChanges = project.timeScales
    .map((event) => ({ timeMs: tempo.tickToSeconds(event.tick) * 1000, scale: event.scale }))
    .sort((a, b) => a.timeMs - b.timeMs);
  const warnings: string[] = [];
  if (project.timeScales.some((event) => event.scale <= 0)) warnings.push("canonical-nonpositive-time-scale");
  if (readAuthorCollections(project).groups.some((group) => group.forceNoteSpeed !== undefined))
    warnings.push("canonical-author-speed-profile");
  const count = chart.notes.filter((note) => note.judged).length;
  const bpms = chart.bpmChanges.map((event) => event.bpm);
  return {
    version: COMMUNITY_CHART_ANALYSIS_VERSION,
    n: count,
    time: chart.durationMs / 1000,
    nps: chart.durationMs > 0 ? count / (chart.durationMs / 1000) : 0,
    firstBpm: bpms[0] ?? 0,
    minBpm: bpms.length ? Math.min(...bpms) : 0,
    maxBpm: bpms.length ? Math.max(...bpms) : 0,
    difficultyEstimate: estimateChartDifficulty(
      {
        chart,
        difficulty: ["easy", "normal", "hard", "expert"].indexOf(project.meta.difficulty.trim().toLowerCase()),
        masterJudgedCount: null,
        authoredJudgedCount: playback.notes.filter((note) => note.judged).length,
        sourceId,
        canonicalWarnings: warnings,
      },
      OUR_NOTES_FC_CALIBRATION,
    ),
  };
}
