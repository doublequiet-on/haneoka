import {
  createProjectId,
  structuredCloneValue,
  resolveLinePointShape,
  type Project,
  type SingleNote,
  type NoteType,
  type NoteDirection,
} from "../model";
import { assertValidProject } from "../validation";
import {
  assertAuthoredSpanOverlap,
  assertEditedChartSpans,
  authoredSpanInBounds,
  authoredSpanNodes,
  authoredWidthBounds,
  constrainLaneValue,
  type AuthoredPlacement,
  type LaneBounds,
  type LaneGrid,
} from "./span";

export interface AuthoredNoteInput {
  tick: number;
  /** Authored left edge, in the project's laneBasis units. */
  lane: number;
  /** Required authored span; this is independent from renderer noteSize. Zero-width markers remain valid. */
  size: number;
  type?: NoteType;
  direction?: NoteDirection;
  critical?: boolean;
  visible?: boolean;
  /** Clamp only the new placement, never alter imported source geometry. */
  placement?: AuthoredPlacement;
}
export type WidthAnchor = "left" | "center" | "right";

function width(project: Project, value: number, placement: AuthoredPlacement) {
  if (!Number.isFinite(value) || value < 0 || (placement === "stage" && value > project.laneBasis))
    throw new RangeError("invalid_note_width");
  return value;
}
/** Each call receives a configurable width. No fixed laneBasis/6 is hidden in the constructor. */
export function createAuthoredNote(project: Project, input: AuthoredNoteInput): SingleNote {
  const placement = input.placement ?? "stage",
    size = width(project, input.size, placement),
    type = input.type ?? "tap";
  if (!Number.isSafeInteger(input.tick) || input.tick < 0 || !Number.isFinite(input.lane))
    throw new RangeError("invalid_note_position");
  if (placement === "overlap") assertAuthoredSpanOverlap(input.lane, size, project.laneBasis);
  const note: SingleNote = {
    id: createProjectId("note"),
    tick: input.tick,
    lane: placement === "stage" ? Math.max(0, Math.min(project.laneBasis - size, input.lane)) : input.lane,
    size,
    type,
    direction: type === "flick" ? (input.direction ?? "up") : "none",
    critical: input.critical ?? false,
    visible: input.visible ?? true,
  };
  const candidate = structuredCloneValue(project);
  candidate.singles.push(note);
  assertValidProject(candidate);
  return note;
}
export function addAuthoredNote(project: Project, input: AuthoredNoteInput): Project {
  const result = structuredCloneValue(project);
  result.singles.push(createAuthoredNote(project, input));
  return result;
}
/** Set widths atomically. Center/right anchors retain the chosen edge; source IDs and semantic fields survive. */
export function resizeChartSelection(
  project: Project,
  ids: ReadonlySet<string>,
  size: number,
  options: { anchor?: WidthAnchor; placement?: AuthoredPlacement; resolveAutoLane?: boolean } = {},
): Project {
  const placement = options.placement ?? "stage",
    anchor = options.anchor ?? "left",
    newSize = width(project, size, placement),
    result = structuredCloneValue(project);
  // Resolve every selected automatic point from the unchanged source, before any group edits.
  const automaticShapes = new Map<string, ReturnType<typeof resolveLinePointShape>>();
  if (options.resolveAutoLane)
    for (const line of project.lines)
      line.points.forEach((point, index) => {
        if (point.lane === "auto" && ids.has(point.id))
          automaticShapes.set(point.id, resolveLinePointShape(line.points, index));
      });
  const change = (note: SingleNote | Project["lines"][number]["points"][number]) => {
    if (!ids.has(note.id)) return;
    const shape = automaticShapes.get(note.id);
    if (shape && "ease" in note) {
      note.lane = shape.lane;
      note.size = shape.size;
      delete note.autoSize;
      delete note.resolvedLane;
      delete note.resolvedSize;
    }
    if (typeof note.lane === "number") {
      const lane =
        note.lane + (anchor === "center" ? (note.size - newSize) / 2 : anchor === "right" ? note.size - newSize : 0);
      note.lane = placement === "stage" ? Math.max(0, Math.min(result.laneBasis - newSize, lane)) : lane;
    } else if ("ease" in note) note.autoSize = false;
    note.size = newSize;
  };
  result.singles.forEach(change);
  for (const line of result.lines) {
    if (!line.points.some((point) => ids.has(point.id))) continue;
    line.points.forEach(change);
    for (const point of line.points)
      if (point.lane === "auto") {
        delete point.resolvedLane;
        delete point.resolvedSize;
      }
  }
  if (placement === "overlap") assertEditedChartSpans(project, result);
  assertValidProject(result);
  return result;
}

/** Resize by one common width delta, keeping each note's opposite edge and width differences. */
export function resizeChartSelectionByDelta(
  project: Project,
  ids: ReadonlySet<string>,
  delta: number,
  options: { anchor?: WidthAnchor; grid?: LaneGrid } = {},
): Project {
  if (!Number.isFinite(delta)) throw new RangeError("invalid_note_width");
  const selected = authoredSpanNodes(project).filter(({ note }) => ids.has(note.id));
  if (!selected.length || !delta) return structuredCloneValue(project);
  const anchor = options.anchor ?? "left";
  let change = delta;
  if (selected.every(({ lane, size, placement }) => authoredSpanInBounds(lane, size, project.laneBasis, placement))) {
    const common: LaneBounds = { min: -Infinity, max: Infinity, minInclusive: false, maxInclusive: false };
    for (const { lane, size, placement } of selected) {
      const bounds = authoredWidthBounds(lane, size, project.laneBasis, anchor, placement)!;
      const min = bounds.min - size, max = bounds.max - size;
      if (min > common.min) { common.min = min; common.minInclusive = bounds.minInclusive; }
      else if (min === common.min) common.minInclusive &&= bounds.minInclusive;
      if (max < common.max) { common.max = max; common.maxInclusive = bounds.maxInclusive; }
      else if (max === common.max) common.maxInclusive &&= bounds.maxInclusive;
    }
    change = constrainLaneValue(delta, common, options.grid);
  }
  if (!change) return structuredCloneValue(project);
  const shapes = new Map(selected.map(entry => [entry.note.id, entry]));
  const result = structuredCloneValue(project);
  const resize = (note: SingleNote | Project["lines"][number]["points"][number]) => {
    const shape = shapes.get(note.id);
    if (!shape) return;
    const size = width(project, shape.size + change, "overlap");
    if (note.lane === "auto" && "ease" in note) {
      delete note.autoSize;
      delete note.resolvedLane;
      delete note.resolvedSize;
    }
    note.lane = shape.lane + (anchor === "right" ? -change : anchor === "center" ? -change / 2 : 0);
    note.size = size;
  };
  result.singles.forEach(resize);
  for (const line of result.lines) {
    if (!line.points.some(point => ids.has(point.id))) continue;
    line.points.forEach(resize);
    for (const point of line.points) if (point.lane === "auto") {
      delete point.resolvedLane;
      delete point.resolvedSize;
    }
  }
  assertValidProject(result);
  assertEditedChartSpans(project, result);
  return result;
}
