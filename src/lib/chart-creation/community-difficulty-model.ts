// L3 — GEB
// Input: canonical community chart, independent combo count and source identity.
// Output: slot-independent integer recommendation for every playable community chart.
// Pos: [Map](../L2-2.md); community-only calibration and operation-load fallback.
// Effects/Dependencies: Fixed intl release r-c5db1ee6d91ea5942a83, 93 songs / 372 charts;
// Source: v86-1e5e2dca8254-a188149cd277-mccd16fd5a666-n9ee9059e.
// Official displayed levels calibrate v6 FC strain; endpoint slopes extend the level scale.
// Multi-contact and unusual long-note geometry use a nonnegative ridge operation-load projection.
// Five song-grouped folds: FC-skill MAE 0.114, 90th-percentile absolute error 0.237.
import { CHART_DIFFICULTY_VERSION, chartDifficultyFeatures } from "../chart-difficulty";
import type { ChartDifficultyEstimate, ChartDifficultyInput } from "../chart-difficulty";

const FEATURE_VERSION = "ournotes-fc-threshold-v6";
export const COMMUNITY_DIFFICULTY_VERSION = `${FEATURE_VERSION}:community-slotless-v2`;
const DOWNS = new Set([1, 20, 101]);
const FLICKS = new Set([40, 41, 42, 102]);
const TRACES = new Set([21, 60, 61, 62, 63, 103, 104, 105]);
const TAILS = new Set([22]);
const LOAD_INTERCEPT = 1.65836164592;
const LOAD_WEIGHTS = [
  1.00796192822, 0.146523008988, 0.464749816376, 0.518699091057, 0.369460560823, 0, 0.9421922044, 0,
];

export function communityOperationLoad(input: ChartDifficultyInput) {
  const duration = Math.max(1, input.chart.durationMs / 1000);
  const events = input.chart.notes
    .filter(
      (note) =>
        note.judged &&
        (DOWNS.has(note.operateType) ||
          FLICKS.has(note.operateType) ||
          TRACES.has(note.operateType) ||
          TAILS.has(note.operateType)),
    )
    .map((note) => ({
      note,
      time: note.timeMs / 1000,
      weight: DOWNS.has(note.operateType)
        ? 1
        : FLICKS.has(note.operateType)
          ? 1.25
          : TAILS.has(note.operateType)
            ? 0.15
            : 0.35,
    }))
    .sort((a, b) => a.time - b.time || a.note.id - b.note.id);
  const peak = (seconds: number) => {
    let left = 0,
      sum = 0,
      maximum = 0;
    for (let right = 0; right < events.length; right++) {
      sum += events[right]!.weight;
      while (events[right]!.time - events[left]!.time >= seconds) sum -= events[left++]!.weight;
      maximum = Math.max(maximum, sum / seconds);
    }
    return maximum;
  };
  let total = 0,
    chord = 0,
    previous = -Infinity;
  const positions = new Map<number, [number, number]>();
  let downCount = 0,
    flickCount = 0,
    traceCheckCount = 0,
    tailCheckCount = 0;
  for (const event of events) {
    total += event.weight;
    if (event.time === previous) chord += event.weight;
    const centre = (event.note.pos + event.note.size / 2) / 24;
    const bounds = positions.get(event.time);
    positions.set(event.time, bounds ? [Math.min(bounds[0], centre), Math.max(bounds[1], centre)] : [centre, centre]);
    previous = event.time;
    if (DOWNS.has(event.note.operateType)) downCount++;
    if (FLICKS.has(event.note.operateType)) flickCount++;
    if (TRACES.has(event.note.operateType)) traceCheckCount++;
    if (TAILS.has(event.note.operateType)) tailCheckCount++;
  }
  const notes = new Map(input.chart.notes.map((note) => [note.id, note]));
  let heldSeconds = 0;
  for (const line of input.chart.lines) {
    if (line.kind !== "long") continue;
    let start = Infinity,
      end = -Infinity;
    for (const id of line.noteIds) {
      const note = notes.get(id);
      if (!note || note.operateType === 120 || note.operateType === 121) continue;
      start = Math.min(start, note.timeMs / 1000);
      end = Math.max(end, note.timeMs / 1000);
    }
    heldSeconds += Math.max(0, end - start);
  }
  let movement = 0,
    before: [number, number] | undefined;
  for (const bounds of positions.values()) {
    if (before) movement += Math.abs(bounds[0] - before[0]) + Math.abs(bounds[1] - before[1]);
    before = bounds;
  }
  const density = total / duration,
    peak1 = peak(1),
    peak4 = peak(4);
  return {
    values: [
      density,
      peak1,
      peak4,
      flickCount / duration,
      chord / duration,
      heldSeconds / duration,
      duration / 60,
      movement / duration,
    ].map(Math.log1p),
    components: {
      density,
      chords: chord / duration,
      handMovement: movement / duration,
      flick: flickCount / duration,
      holdConstraints: heldSeconds / duration,
      rhythm: peak1 / Math.max(1, density),
      reading: Math.log1p(input.chart.timeScaleChanges?.length ?? 0),
      stamina: peak4,
    },
    operationCount: events.length,
    downCount,
    flickCount,
    traceCheckCount,
    tailCheckCount,
  };
}
const CURVE = [
  [3.417225612010215, 5.0],
  [3.614686507001449, 5.333333333333333],
  [3.740435652683453, 6.0],
  [3.762519682847543, 6.0],
  [3.7879425541413134, 6.0],
  [3.803835848670074, 6.0],
  [3.8153384686861678, 6.0],
  [3.8587182878319517, 6.0],
  [3.890310238219115, 6.666666666666667],
  [3.982937382350196, 7.016666666666667],
  [4.096542636778031, 7.6],
  [4.144142475995992, 7.615384615384615],
  [4.2269341326647005, 7.714285714285714],
  [4.251873295537954, 8.333333333333334],
  [4.296522043597525, 8.375],
  [4.351544454637915, 9.125],
  [4.37974868904646, 11.0],
  [4.428290374682819, 11.4],
  [4.478849049389924, 11.7],
  [4.532952182592072, 12.4],
  [4.582260700272238, 12.916666666666666],
  [4.6121115502461, 13.0],
  [4.712155449160424, 13.030303030303031],
  [4.850302153815545, 13.2],
  [4.957796395299014, 13.857142857142858],
  [5.037327441227331, 15.125],
  [5.183942799902873, 16.666666666666668],
  [5.361795139866639, 18.470588235294116],
  [5.475134157697362, 18.72222222222222],
  [5.545749462796, 18.863636363636363],
  [5.624498487876836, 18.964285714285715],
  [5.690119750981488, 20.0],
  [5.711798754410954, 20.375],
  [5.8051694648738925, 20.88888888888889],
  [5.9499024467987205, 21.318181818181817],
  [6.067235368388916, 21.4],
  [6.143061572934625, 22.0],
  [6.150334593296169, 23.0],
  [6.190164345793542, 23.5],
  [6.242139354812663, 24.0],
  [6.282843736682052, 24.7],
  [6.360011889186153, 25.0],
  [6.4358127506305465, 25.060000000000002],
  [6.541475286325189, 25.322222222222223],
  [6.628745341629985, 25.375],
  [6.689370213416289, 25.75],
  [6.8066061611378155, 25.88181818181818],
  [6.917853429262806, 26.5],
  [6.939228300035733, 26.5],
  [6.953928374615155, 27.099999999999998],
  [7.033287185305906, 27.142857142857142],
  [7.164697153719016, 27.7],
  [7.38273713140635, 27.7],
  [7.689609551514696, 29.0],
];

function levelForSkill(skill: number): number {
  let first = CURVE[0]!,
    last = CURVE[1]!;
  if (skill >= CURVE.at(-1)![0]!) {
    last = CURVE.at(-1)!;
    for (let i = CURVE.length - 2; i >= 0; i--) {
      if (CURVE[i]![1]! < last[1]!) {
        first = CURVE[i]!;
        break;
      }
    }
  } else {
    for (let i = 1; i < CURVE.length; i++) {
      last = CURVE[i]!;
      first = CURVE[i - 1]!;
      if (skill <= last[0]!) break;
    }
  }
  const value = first[1]! + ((last[1]! - first[1]!) * (skill - first[0]!)) / (last[0]! - first[0]!);
  return Math.max(1, Math.round(value));
}

export function estimateCommunityDifficulty(input: ChartDifficultyInput): ChartDifficultyEstimate {
  const feature = chartDifficultyFeatures(input);
  const quality = { ...feature.quality, warnings: [...feature.quality.warnings] };
  let skill = feature.raw.fcSkill ?? Number.NaN;
  let components = feature.components;
  if (CHART_DIFFICULTY_VERSION !== FEATURE_VERSION || quality.status === "unavailable" || !Number.isFinite(skill)) {
    const load = communityOperationLoad(input);
    skill = LOAD_INTERCEPT + load.values.reduce((sum, value, i) => sum + value * LOAD_WEIGHTS[i]!, 0);
    components = load.components;
    quality.operationCount = load.operationCount;
    quality.downCount = load.downCount;
    quality.flickCount = load.flickCount;
    quality.traceCheckCount = load.traceCheckCount;
    quality.tailCheckCount = load.tailCheckCount;
    quality.warnings.push("community-operation-load-fallback");
    if (!load.operationCount) skill = CURVE[0]![0]! - 2;
  }
  if (skill < CURVE[0]![0]! || skill > CURVE.at(-1)![0]!) quality.warnings.push("community-calibration-extrapolated");
  quality.status = "low-confidence";
  quality.confidence = "low";
  return {
    version: COMMUNITY_DIFFICULTY_VERSION,
    target: "fc-operation-load",
    estimatedConstant: levelForSkill(skill),
    components,
    quality,
    units: "relative-strain",
    sourceId: input.sourceId,
  };
}
