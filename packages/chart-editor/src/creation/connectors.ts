// L3 — GEB
// Input: 工程、端点／中间节点选区及自动节点的显示形状。
// Output: 滑条合并／拆分、路径重复和 Trace 生成事务；保留格式记录和分组／图层归属。
// Pos: [Map](../../L2-2.md)；连接器结构编辑。
// Effects/Dependencies: 纯工程变换；不兼容的类型、时间或分组速度拒绝整次合并。
import {
  createProjectId, resolveLinePointShape, structuredCloneValue,
  type JsonValue, type NoteLine, type Project, type ResolvedLinePointShape, type SingleNote,
} from "../model";
import { assertValidProject } from "../validation";
import { assertEditedChartSpans } from "./span";
import { assignAuthorSelection, COLLECTIONS_KEY, readAuthorCollections, reconcileAuthorEdit } from "./collections";
import { sampleLineSpan } from "./actions";

export function lineSplitTarget(project: Project, ids: ReadonlySet<string>) {
  if (ids.size !== 1) return;
  for (const line of project.lines) {
    const index = line.points.findIndex(point => ids.has(point.id));
    if (index > 0 && index < line.points.length - 1) return { line, index };
  }
}

export function lineJoinTargets(project: Project, ids: ReadonlySet<string>) {
  if (ids.size !== 2) return;
  const lines = project.lines.filter(line => ids.has(line.points[0]!.id) || ids.has(line.points.at(-1)!.id));
  if (lines.length !== 2) return;
  const [a, b] = lines as [NoteLine, NoteLine];
  const ordered = ids.has(a.points.at(-1)!.id) && ids.has(b.points[0]!.id)
    && a.points.at(-1)!.tick <= b.points[0]!.tick ? [a, b] :
    ids.has(b.points.at(-1)!.id) && ids.has(a.points[0]!.id)
      && b.points.at(-1)!.tick <= a.points[0]!.tick ? [b, a] : undefined;
  if (ordered && a.kind === b.kind) return ordered as [NoteLine, NoteLine];
}

function record(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function copySourceRecords(project: Project, mapping: Record<string, string>) {
  for (const source of Object.values(project.extensions)) {
    if (!record(source) || !record(source.records)) continue;
    for (const [id, from] of Object.entries(mapping))
      if (Object.hasOwn(source.records, from)) source.records[id] = structuredCloneValue(source.records[from]!);
  }
}
function clearAutoCache(line: NoteLine) {
  for (const point of line.points) {
    delete point.resolvedLane;
    delete point.resolvedSize;
  }
}

export function splitNoteLine(project: Project, ids: ReadonlySet<string>, shape?: ResolvedLinePointShape) {
  const target = lineSplitTarget(project, ids);
  if (!target) throw new Error("invalid_line_split");
  const { line: source, index } = target, result = structuredCloneValue(project);
  const line = result.lines.find(line => line.id === source.id)!;
  const boundary = line.points[index]!, startId = createProjectId("node"), lineId = createProjectId("line");
  const resolved = shape ?? resolveLinePointShape(source.points, index);
  boundary.lane = resolved.lane;
  boundary.size = resolved.size;
  boundary.type = "tap";
  boundary.direction = "none";
  boundary.critical = line.critical ?? boundary.critical;
  delete boundary.autoSize;
  const right: NoteLine = { ...line, id: lineId, points: [
    { ...structuredCloneValue(boundary), id: startId }, ...line.points.slice(index + 1),
  ] };
  line.points = line.points.slice(0, index + 1);
  clearAutoCache(line);
  clearAutoCache(right);
  result.lines.splice(result.lines.indexOf(line) + 1, 0, right);
  if (result.sourceOrder) result.sourceOrder.splice(result.sourceOrder.indexOf(line.id) + 1, 0, lineId);
  copySourceRecords(result, { [lineId]: line.id, [startId]: boundary.id });
  const state = readAuthorCollections(project);
  for (const [id, from] of [[lineId, line.id], [startId, boundary.id]]) {
    const member = state.members[from!] ?? state.members[line.id];
    if (member) state.members[id!] = structuredCloneValue(member);
  }
  if (project.extensions[COLLECTIONS_KEY] !== undefined)
    result.extensions[COLLECTIONS_KEY] = state as unknown as JsonValue;
  assertValidProject(result);
  assertEditedChartSpans(project, result);
  return { project: result, ids: [boundary.id, startId] };
}

export function joinNoteLines(project: Project, ids: ReadonlySet<string>) {
  const targets = lineJoinTargets(project, ids);
  if (!targets) throw new Error("invalid_line_join");
  const [first, second] = targets, state = readAuthorCollections(project);
  const speed = (line: NoteLine) => state.groups.find(group => group.id === state.members[line.id]?.groupId)?.forceNoteSpeed;
  if (speed(first) !== speed(second)) throw new Error("connector_speed_conflict");
  const result = structuredCloneValue(project), line = result.lines.find(line => line.id === first.id)!;
  const end = line.points.at(-1)!, start = second.points[0]!;
  const endShape = resolveLinePointShape(first.points, first.points.length - 1), startShape = resolveLinePointShape(second.points, 0);
  const coincident = end.tick === start.tick && endShape.lane === startShape.lane && endShape.size === startShape.size;
  if (coincident) line.points.pop();
  else { end.type = "tap"; end.direction = "none"; }
  line.points.push(...structuredCloneValue(second.points));
  const join = line.points.find(point => point.id === start.id)!;
  join.type = "tap";
  join.direction = "none";
  clearAutoCache(line);
  result.lines = result.lines.filter(line => line.id !== second.id);
  if (result.sourceOrder) result.sourceOrder = result.sourceOrder.filter(id => id !== second.id);
  const reconciled = reconcileAuthorEdit(project, result), member = state.members[first.id];
  const candidate = assignAuthorSelection(reconciled, new Set([first.id]), {
    groupId: member?.groupId ?? null, layerId: member?.layerId ?? null,
  });
  assertValidProject(candidate);
  assertEditedChartSpans(project, candidate);
  return { project: candidate, ids: [join.id] };
}

export function linePatternTarget(project: Project, ids: ReadonlySet<string>) {
  const lines = project.lines.filter(line => line.points.some(point => ids.has(point.id)));
  if (lines.length !== 1) return;
  const line = lines[0]!, points = line.points.filter(point => ids.has(point.id));
  if (points.length < 3 || points[0]!.tick === points.at(-1)!.tick || points.at(-1)!.tick >= line.points.at(-1)!.tick) return;
  return { line, points };
}

/** Repeat the selected path forward within its connector, preserving the authored tail. */
export function repeatLinePattern(project: Project, ids: ReadonlySet<string>) {
  const target = linePatternTarget(project, ids);
  if (!target) throw new Error("invalid_line_pattern");
  const { line: source, points } = target, first = points[0]!, last = points.at(-1)!;
  const period = last.tick - first.tick;
  if (Math.ceil((source.points.at(-1)!.tick - last.tick) / period) * (points.length - 1) > 100_000)
    throw new Error("too_many_generated_notes");
  const firstShape = resolveLinePointShape(source.points, source.points.indexOf(first));
  const lastShape = resolveLinePointShape(source.points, source.points.indexOf(last));
  const result = structuredCloneValue(project), line = result.lines.find(line => line.id === source.id)!;
  const existing = new Set(line.points.map(point => point.tick)), created: string[] = [];
  const mapping: Record<string, string> = {}, state = readAuthorCollections(project), owner = state.members[line.id];
  for (let iteration = 1; first.tick + period * iteration < source.points.at(-1)!.tick; iteration++) {
    for (const point of points.slice(1)) {
      const tick = point.tick + period * iteration;
      if (tick >= source.points.at(-1)!.tick || existing.has(tick)) continue;
      const id = createProjectId("node"), copy = structuredCloneValue(point);
      copy.id = id;
      copy.tick = tick;
      if (typeof copy.lane === "number") copy.lane += iteration * (lastShape.lane - firstShape.lane);
      if (point.id === last.id) copy.ease = { ...first.ease };
      line.points.push(copy);
      existing.add(tick);
      created.push(id);
      mapping[id] = point.id;
      if (owner) state.members[id] = { ...(owner.groupId ? { groupId: owner.groupId } : {}), ...(owner.layerId ? { layerId: owner.layerId } : {}) };
    }
  }
  if (created.length) line.points.find(point => point.id === last.id)!.ease = { ...first.ease };
  line.points.sort((a, b) => a.tick - b.tick);
  clearAutoCache(line);
  copySourceRecords(result, mapping);
  if (project.extensions[COLLECTIONS_KEY] !== undefined) result.extensions[COLLECTIONS_KEY] = state as unknown as JsonValue;
  assertValidProject(result);
  assertEditedChartSpans(project, result);
  return { project: result, ids: created };
}

export function lineTraces(
  project: Project, lineIds: ReadonlySet<string>, subdivision: number,
  options: { keepLines: boolean; sample?: (line: NoteLine, tick: number) => ResolvedLinePointShape | undefined },
) {
  if (!Number.isSafeInteger(subdivision) || subdivision < 1 || subdivision > project.resolution * 4)
    throw new Error("invalid_division");
  const count = project.lines.filter(line => lineIds.has(line.id)).reduce((count, line) =>
    count + Math.floor((line.points.at(-1)!.tick - line.points[0]!.tick) * subdivision / (project.resolution * 4)) + 1, 0);
  if (count > 100_000) throw new Error("too_many_generated_notes");
  const result = structuredCloneValue(project), state = readAuthorCollections(project), created: string[] = [];
  for (const line of project.lines) {
    if (!lineIds.has(line.id)) continue;
    const first = line.points[0]!, last = line.points.at(-1)!, ticks = new Set<number>();
    for (let unit = 0; ; unit++) {
      const tick = first.tick + Math.round(unit * project.resolution * 4 / subdivision);
      if (tick > last.tick) break;
      ticks.add(tick);
    }
    for (const tick of ticks) {
      if (options.keepLines && ((tick === first.tick && first.visible) || (tick === last.tick && last.visible))) continue;
      const shape = (options.sample ?? sampleLineSpan)(line, tick)!;
      const note: SingleNote = { id: createProjectId("trace"), tick, ...shape, type: "trace",
        critical: line.critical ?? first.critical, direction: "none", visible: true };
      result.singles.push(note);
      result.sourceOrder?.push(note.id);
      created.push(note.id);
      const owner = state.members[line.id];
      if (owner) state.members[note.id] = { ...(owner.groupId ? { groupId: owner.groupId } : {}), ...(owner.layerId ? { layerId: owner.layerId } : {}) };
    }
  }
  if (!options.keepLines) {
    result.lines = result.lines.filter(line => !lineIds.has(line.id));
    if (result.sourceOrder) result.sourceOrder = result.sourceOrder.filter(id => !lineIds.has(id));
  }
  if (project.extensions[COLLECTIONS_KEY] !== undefined) result.extensions[COLLECTIONS_KEY] = state as unknown as JsonValue;
  const candidate = reconcileAuthorEdit(project, result);
  assertValidProject(candidate);
  assertEditedChartSpans(project, candidate);
  return { project: candidate, ids: created };
}
