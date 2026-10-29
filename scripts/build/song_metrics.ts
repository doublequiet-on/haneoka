import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { gunzipSync } from "node:zlib";
import { luckCategory, tickToTimeMs } from "../../src/lib/team-builder/song-metrics.ts";
import { gekisoTiming, perfectTimings, type GekisoTimingSegment, type JudgementTimingRow } from "../../src/lib/team-builder/gekiso-timing.ts";
import { runtimeChart } from "../../src/lib/team-builder/engine/runtime-chart.ts";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ScoreEvent {
  tick: number;
  timeMs: number;
  operateType: number;
  judgementType: number;
  luckCategory: 0 | 1 | null;
}

interface MetricBpmChange {
  bpm: number;
  tick: number;
  timeMs: number;
}

interface MetricChart {
  bpmChanges: readonly MetricBpmChange[];
  notes: readonly {
    judged: boolean;
    operateType: number;
    judgementType: number;
    tick: number;
    timeMs: number;
  }[];
  passthrough: {
    fever: readonly (readonly [number, number])[];
    skill: readonly number[];
  };
}

interface ScoreMetrics {
  events: ScoreEvent[];
  canonicalNoteCount: number;
  durationMs: number;
  bpmChanges: MetricBpmChange[];
  skillTimesMs: number[];
  feverRanges: { startTick: number; endTick: number }[];
  gekisoTiming?: GekisoTimingSegment[];
}

interface ConverterExports {
  convertChart(input: string | Uint8Array): MetricChart;
}

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The converter lives in the locked cassiopeia-plugin-sonolus workspace, which
// materializes packages/sonolus/src/convert on full installs; fall back to the
// locked checkout when only the external repositories are materialized.
const converterEntry = [
  path.join(repositoryRoot, "packages/sonolus/src/convert/index.ts"),
  path.join(repositoryRoot, ".dependencies/cassiopeia-plugin-sonolus/src/convert/index.ts"),
].find((candidate) => fs.existsSync(candidate));
if (!converterEntry) {
  throw new Error("sonolus convert entry is missing: run the external repository checkout");
}

// API generation and the chart player must consume the same native-backed
// conversion model. Bundle that TypeScript entry in memory instead of keeping
// a second, subtly different chart resolver in Python.
const bundle = buildSync({
  stdin: {
    contents: `export { convertChart } from ${JSON.stringify(converterEntry)};`,
    resolveDir: repositoryRoot,
    sourcefile: "haneoka-song-metrics-entry.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "silent",
  // The converter composes locked workspace packages; map them to their
  // materialized checkouts so bundling works without a linked node_modules.
  alias: {
    "@haneoka/cassiopeia": path.join(repositoryRoot, ".dependencies/cassiopeia/src"),
    "@haneoka/cassiopeia-plugin-our-notes": path.join(repositoryRoot, ".dependencies/cassiopeia-plugin-our-notes/src"),
  },
});
const source = bundle.outputFiles?.[0]?.text;
if (!source) throw new Error("canonical chart converter bundle is empty");
const compiled: { exports: Partial<ConverterExports> } = { exports: {} };
new Function("module", "exports", "require", source)(compiled, compiled.exports, require);
const convertChart = compiled.exports.convertChart;
if (typeof convertChart !== "function") throw new Error("canonical convertChart export is missing");

function parseFiles(sourceText: string): Record<string, string> {
  const value = JSON.parse(sourceText) as JsonValue;
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("song metric input must be an object of file paths");
  }
  const files: Record<string, string> = {};
  for (const [key, file] of Object.entries(value)) {
    if (typeof file !== "string") throw new TypeError(`song metric path for ${key} must be a string`);
    files[key] = file;
  }
  return files;
}

const input = JSON.parse(fs.readFileSync(0, "utf8")) as Record<string, unknown>;
const files = parseFiles(JSON.stringify(input.files ?? input));
const timings = perfectTimings((input.judgementTimings ?? []) as JudgementTimingRow[]);
const output: Record<string, ScoreMetrics> = {};
for (const [key, file] of Object.entries(files)) {
  const bytes = fs.readFileSync(String(file));
  const chart = convertChart(bytes);
  const events = chart.notes
    .filter((note) => note.judged)
    .map((note) => ({
      tick: Number(note.tick),
      timeMs: Number(note.timeMs),
      operateType: Number(note.operateType),
      judgementType: Number(note.judgementType ?? 0),
      luckCategory: luckCategory(Number(note.operateType)),
    }));
  const bpmChanges = chart.bpmChanges.map((change) => ({
    tick: Number(change.tick),
    timeMs: Number(change.timeMs),
    bpm: Number(change.bpm),
  }));
  output[key] = {
    events,
    canonicalNoteCount: events.length,
    durationMs: events.reduce((maximum, note) => Math.max(maximum, note.timeMs), 0),
    bpmChanges,
    skillTimesMs: chart.passthrough.skill.map((tick) => tickToTimeMs(bpmChanges, tick)),
    feverRanges: chart.passthrough.fever.map(([startTick, endTick]) => ({
      startTick: Number(startTick),
      endTick: Number(endTick),
    })),
    ...(timings.size ? { gekisoTiming: gekisoTiming(runtimeChart(JSON.parse(
      (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8"),
    )), timings) } : {}),
  };
}

process.stdout.write(JSON.stringify(output));
