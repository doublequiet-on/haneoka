// L3 — GEB
// Input: 已校验的创作工程与整数 Tick、拍号和轨道几何。
// Output: SUS 文本、可表示性错误和转换提示；时间不做网格量化。
// Pos: [Map](../../L2-2.md)；SUS 写入适配器。
// Effects/Dependencies: 纯转换；不写文件、不加载媒体。
import { resolveLinePointShape, type Project } from "../model";
import { assertValidProject } from "../validation";
import { ChartFormatError, type FormatWarning } from "./shared";

/** SUS/MMWS meters name measures; canonical projects name absolute ticks. */
export function projectMeasureMap(project: Project) {
  let measure = 0, previousTick = 0, length = project.resolution * 4;
  const segments = [...project.meters].sort((a, b) => a.tick - b.tick).map(meter => {
    const advance = (meter.tick - previousTick) / length;
    if (!Number.isInteger(advance)) throw new ChartFormatError("sus", "Meter change must be on a measure boundary", "$.meters");
    measure += advance;
    length = project.resolution * 4 * meter.numerator / meter.denominator;
    if (!Number.isSafeInteger(length)) throw new ChartFormatError("sus", "Measure length must use integer ticks", "$.meters");
    previousTick = meter.tick;
    return { tick: meter.tick, measure, length, numerator: meter.numerator, denominator: meter.denominator };
  });
  return {
    segments,
    position(tick: number) {
      let segment = segments[0]!;
      for (const next of segments) { if (next.tick > tick) break; segment = next; }
      const advance = Math.floor((tick - segment.tick) / segment.length);
      return { measure: segment.measure + advance, offset: tick - segment.tick - advance * segment.length, length: segment.length };
    },
  };
}
const issue = (code: string, path: string, message: string): FormatWarning => ({ code: `sus.export.${code}`, path, message });
const shape = (project: Project, lane: number, size: number) => ({ lane: lane * 12 / project.laneBasis + 2, width: size * 12 / project.laneBasis });
export function susExportDiagnostics(project: Project) {
  const errors: FormatWarning[] = [], warnings: FormatWarning[] = [];
  try { projectMeasureMap(project); }
  catch { errors.push(issue("measureBoundary", "$.meters", "SUS requires meter changes on measure boundaries")); }
  if (new Set(project.tempos.map(event => event.bpm)).size > 1295)
    errors.push(issue("bpmLimit", "$.tempos", "SUS supports at most 1295 distinct BPM values"));
  for (const kind of ["long", "guide"] as const) {
    const ends: number[] = [];
    for (const line of project.lines.filter(line => line.kind === kind).sort((a, b) => a.points[0]!.tick - b.points[0]!.tick)) {
      const channel = ends.findIndex(end => end < line.points[0]!.tick);
      if (channel >= 0) ends[channel] = line.points.at(-1)!.tick;
      else ends.push(line.points.at(-1)!.tick);
    }
    if (ends.length > 36) errors.push(issue("channelLimit", "$.lines", "SUS supports at most 36 overlapping slides of one kind"));
  }
  const geometries = [...project.singles, ...project.lines.flatMap(line => line.points.map((point, index) => ({ ...point, ...resolveLinePointShape(line.points, index) })))];
  if (geometries.some(note => { const value = shape(project, note.lane, note.size); return !Number.isInteger(value.lane) || !Number.isInteger(value.width) || value.lane < 2 || value.lane >= 14 || value.width < 0 || value.width > 35; }))
    errors.push(issue("integerLanes", "$.lines", "SUS requires integer positions and widths on its 12-lane stage"));
  if (project.lines.some(line => line.points.slice(0, -1).some(point => point.ease.left !== point.ease.right)))
    errors.push(issue("edgeEase", "$.lines", "SUS cannot carry different left and right easing"));
  if (project.meters.some(meter => meter.denominator !== 4))
    warnings.push(issue("meterRatioNormalized", "$.meters", "SUS retains measure duration, but not the original meter ratio"));
  const keys = project.singles.map(note => `${note.tick}:${note.lane}`);
  const keySet = new Set(keys);
  if (keySet.size < keys.length || project.lines.some(line => line.kind === "long" && line.points.some(point => typeof point.lane === "number" && keySet.has(`${point.tick}:${point.lane}`))))
    warnings.push(issue("coincidentNotesMerged", "$.singles", "SUS merges simultaneous notes at the same lane"));
  if (project.waypoints?.length) warnings.push(issue("waypointsUnsupported", "$.waypoints", "SUS does not carry author waypoints"));
  if (project.markers.call.length) warnings.push(issue("callUnsupported", "$.markers.call", "SUS does not carry CALL rhythms"));
  if (Object.keys(project.extensions).length) warnings.push(issue("extensionsUnsupported", "$.extensions", "Source extensions are omitted"));
  if (project.lines.some(line => line.points.some(point => point.lane === "auto")))
    warnings.push(issue("autoGeometryResolved", "$.lines", "Automatic points become resolved coordinates"));
  if (project.lines.some(line => line.kind === "guide" && line.points.some(point => point.visible || point.lane === "auto")))
    warnings.push(issue("guideJudgementsUnsupported", "$.lines", "SUS guide nodes are not judged"));
  if (project.lines.some(line => line.kind === "long" && line.points.slice(0, -1).some(point => point.type === "flick")))
    warnings.push(issue("nonEndFlickUnsupported", "$.lines", "SUS holds carry flick direction only at their tail"));
  if (project.lines.some(line => (line.critical || line.points[0]?.critical) && line.points.some(point => !point.critical)))
    warnings.push(issue("criticalNormalized", "$.lines", "SUS propagates a critical head to the whole slide"));
  if (project.singles.some(note => !note.visible)) warnings.push(issue("singleVisibilityIgnored", "$.singles", "SUS standalone notes remain visible"));
  return { errors, warnings };
}
const b36 = (value: number) => value.toString(36).toUpperCase();
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const decimal = (value: number): string => {
  const text = String(value), match = text.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/u);
  if (!match) return text;
  const digits = match[2]! + (match[3] ?? ""), point = match[2]!.length + Number(match[4]);
  return match[1] + (point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`);
};

export function serializeSus(project: Project): string {
  assertValidProject(project);
  const diagnostics = susExportDiagnostics(project);
  if (diagnostics.errors.length) throw new ChartFormatError("sus", diagnostics.errors.map(issue => issue.message).join("; "));
  const map = projectMeasureMap(project);
  const quote = (value: string) => `"${value.replace(/[\r\n]/gu, " ")}"`;
  const output = ["#REQUEST \"ticks_per_beat 480\"", "#REQUEST \"side_lane true\"", `#LANECOUNT ${project.laneBasis}`,
    `#TITLE ${quote(project.meta.title)}`, `#ARTIST ${quote(project.meta.artist)}`, `#DESIGNER ${quote(project.meta.charter)}`,
    `#DIFFICULTY ${quote(project.meta.difficulty)}`, `#PLAYLEVEL ${quote(project.meta.level)}`, `#WAVEOFFSET ${decimal(-project.audioOffset)}`];
  let measureBase = 0;
  const header = (measure: number, channel: string) => {
    const base = Math.floor(measure / 1000) * 1000;
    if (base !== measureBase) { output.push(`#MEASUREBS ${base}`); measureBase = base; }
    return `#${String(measure - base).padStart(3, "0")}${channel}`;
  };
  for (const meter of map.segments) output.push(`${header(meter.measure, "02")}: ${decimal(meter.length / project.resolution)}`);
  const bpms = [...new Set(project.tempos.map(event => event.bpm))];
  bpms.forEach((bpm, index) => output.push(`#BPM${b36(index + 1).padStart(2, "0")}: ${decimal(bpm)}`));
  const rows = new Map<string, { measure: number; length: number; channel: string; values: Map<number, string>[] }>();
  const add = (tick: number, channel: string, value: string) => {
    const position = map.position(tick), key = `${position.measure}:${channel}`;
    let row = rows.get(key);
    if (!row) { row = { ...position, channel, values: [] }; rows.set(key, row); }
    let values = row.values.find(values => !values.has(position.offset));
    if (!values) { values = new Map(); row.values.push(values); }
    values.set(position.offset, value);
  };
  project.tempos.forEach(event => add(event.tick, "08", b36(bpms.indexOf(event.bpm) + 1).padStart(2, "0")));
  const modifier = (tick: number, lane: number, width: number, type: number, channel = "1") => add(tick, channel + b36(lane), b36(type) + b36(width));
  const direction = (tick: number, lane: number, width: number, value: string) => {
    modifier(tick, lane, width, value === "left" ? 3 : value === "right" ? 4 : 1, "5");
  };
  for (const note of project.singles) {
    const { lane, width } = shape(project, note.lane, note.size);
    modifier(note.tick, lane, width, note.type === "trace" ? note.critical ? 6 : 5 : note.critical ? 2 : 1);
    if (note.type === "flick") direction(note.tick, lane, width, note.direction);
  }
  const channels = { long: Array<number>(36).fill(-1), guide: Array<number>(36).fill(-1) };
  for (const line of [...project.lines].sort((a, b) => a.points[0]!.tick - b.points[0]!.tick)) {
    const pool = channels[line.kind], first = line.points[0]!, last = line.points.at(-1)!;
    const channel = pool.findIndex(end => end < first.tick);
    if (channel < 0) throw new ChartFormatError("sus", "SUS supports at most 36 overlapping slides of one kind");
    pool[channel] = last.tick;
    line.points.forEach((point, index) => {
      const resolved = resolveLinePointShape(line.points, index), { lane, width } = shape(project, resolved.lane, resolved.size);
      const endpoint = index === 0 || index === line.points.length - 1;
      add(point.tick, `${line.kind === "long" ? "3" : "9"}${b36(lane)}${b36(channel)}`, `${index === 0 ? "1" : index === line.points.length - 1 ? "2" : point.visible ? "3" : "5"}${b36(width)}`);
      if (endpoint && (!point.visible || line.kind === "guide")) modifier(point.tick, lane, width, point.critical || line.critical ? 8 : 7);
      else if (line.kind === "long" && (point.critical || point.type === "trace")) modifier(point.tick, lane, width, point.type === "trace" ? point.critical ? 6 : 5 : 2);
      if (line.kind === "long" && index === line.points.length - 1 && point.type === "flick") direction(point.tick, lane, width, point.direction);
      if (index < line.points.length - 1 && point.ease.left !== "linear") modifier(point.tick, lane, width, point.ease.left === "in" ? 2 : 5, "5");
    });
  }
  project.markers.skill.forEach(tick => modifier(tick, 0, 1, 4));
  project.markers.fever.forEach(([start, end]) => { modifier(start, 15, 1, 1); modifier(end, 15, 1, 2); });
  let outputSize = output.reduce((sum, line) => sum + line.length + 1, 0);
  for (const row of [...rows.values()].sort((a, b) => a.measure - b.measure)) {
    for (const values of row.values) {
      const unit = [...values.keys()].reduce(gcd, row.length), cells = row.length / unit;
      outputSize += cells * 2 + 24;
      if (outputSize > 2 * 1024 * 1024) throw new ChartFormatError("sus", "sus_size");
      const tokens = Array<string>(cells).fill("00");
      for (const [offset, value] of values) tokens[offset / unit] = value;
      output.push(`${header(row.measure, row.channel)}: ${tokens.join("")}`);
    }
  }
  if (project.timeScales.length) {
    output.push(`#TIL00: "${project.timeScales.map(event => { const pos = map.position(event.tick); return `${pos.measure}'${pos.offset}:${decimal(event.scale)}`; }).join(",")}"`, "#HISPEED 00");
  }
  return output.join("\n") + "\n";
}
