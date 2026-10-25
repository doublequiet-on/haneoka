// L3 — GEB
// Input: 工程、端点／中间节点选区及自动节点的显示形状。
// Output: 滑条合并与拆分事务；保留未替换节点、格式记录和分组／图层归属。
// Pos: [Map](../../L2-2.md)；连接器结构编辑。
// Effects/Dependencies: 纯工程变换；不兼容的类型、时间或分组速度拒绝整次合并。
import {
  createProjectId, resolveLinePointShape, structuredCloneValue,
  type JsonValue, type NoteLine, type Project, type ResolvedLinePointShape,
} from "../model";
import { assertValidProject } from "../validation";
import { assertEditedChartSpans } from "./span";
import { assignAuthorSelection, COLLECTIONS_KEY, readAuthorCollections, reconcileAuthorEdit } from "./collections";

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
