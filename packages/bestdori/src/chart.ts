/**
 * Bestdori chart -> Our Notes SS conversion.
 *
 * This module owns knowledge of the Bestdori chart wire format. The generic
 * chart engine intentionally has no dependency on these contracts.
 */

export interface BestdoriChartNote {
  type?: string;
  beat?: number;
  bpm?: number;
  data?: string;
  lane?: number;
  width?: number;
  direction?: string;
  flick?: boolean;
  skill?: boolean;
  hidden?: boolean;
  charge?: boolean;
  connections?: BestdoriChartConnection[];
}

export interface BestdoriChartConnection {
  beat?: number;
  lane?: number;
  flick?: boolean;
  skill?: boolean;
  hidden?: boolean;
  charge?: boolean;
}

export interface BestdoriSsBpm {
  t: number;
  bpm: number;
}

export interface BestdoriSsNote {
  type?: "flick" | "trace" | "long" | "guide";
  t?: number;
  pos?: number | "auto";
  size?: number;
  crit?: boolean;
  dir?: "left" | "up" | "right";
  visible?: boolean;
  node?: BestdoriSsNote[];
}

export interface BestdoriSsDocument {
  meta: { version: number };
  score: {
    events: {
      bpm: BestdoriSsBpm[];
      sig: Array<{ t: number; sig: [number, number] }>;
      skill: number[];
      fever: Array<[number, number]>;
      call: Array<{ t: number; timing: number[] }>;
    };
    notes: BestdoriSsNote[];
  };
}

/**
 * Apply the chart repair pass used by Bestdori's published simulator.
 *
 * The simulator does this before deriving combo/skill metadata: a line with
 * no visible connection is discarded, a line with one visible connection is
 * reduced to a plain Single, and a line with multiple visible connections is
 * sorted by beat and trimmed only at its hidden ends. Hidden interior points
 * remain part of the line so they still shape the interpolation path.
 */
export function repairBestdoriChart(input: unknown): BestdoriChartNote[] {
  if (!Array.isArray(input)) return [];

  const repaired: BestdoriChartNote[] = [];
  for (const raw of input as BestdoriChartNote[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.type !== "Long" && raw.type !== "Slide") {
      repaired.push(raw);
      continue;
    }

    const connections = Array.isArray(raw.connections) ? raw.connections : [];
    const visible = connections.filter((point) => !point.hidden);
    if (visible.length === 0) continue;

    if (visible.length === 1) {
      const point = visible[0]!;
      const single: BestdoriChartNote = { type: "Single" };
      if (point.lane !== undefined) single.lane = point.lane;
      if (point.beat !== undefined) single.beat = point.beat;
      if (point.flick !== undefined) single.flick = point.flick;
      repaired.push(single);
      continue;
    }

    // The source uses a shallow copy before sorting; preserve the original
    // point objects and all of their fields, including hidden interior nodes.
    const sorted = connections.slice().sort((left, right) => {
      const leftBeat = left.beat;
      const rightBeat = right.beat;
      if (typeof leftBeat !== "number" || typeof rightBeat !== "number") return 0;
      return leftBeat - rightBeat;
    });
    while (sorted.length > 0 && sorted[0]!.hidden) sorted.shift();
    while (sorted.length > 0 && sorted[sorted.length - 1]!.hidden) sorted.pop();
    repaired.push({ type: "Slide", connections: sorted });
  }
  return repaired;
}

const PPQ = 480;
export const BESTDORI_SS_LANE_BASIS = 24;
const LANE_POS_SCALE = 3;
const NOTE_SIZE = 6;

const finiteNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const toTick = (beat: number): number => Math.round(beat * PPQ);
const laneToPos = (lane: number): number => lane * LANE_POS_SCALE;

/** Size simultaneous neighbours together; their source lane centres stay fixed. */
function fitAdjacentNoteWidths(notes: BestdoriSsNote[]): void {
  const events = new Map<number, Array<{ node: BestdoriSsNote; owner: number }>>();
  const lines: Array<{
    owner: number;
    target: BestdoriSsNote[];
    points: Array<{ tick: number; center: number; size: number }>;
    cursor: number;
  }> = [];
  for (const [owner, note] of notes.entries()) {
    const nodes = note.node ?? [note];
    if (!note.node && (note.size ?? NOTE_SIZE) > NOTE_SIZE) continue;
    for (const node of nodes) {
      const tick = node.t ?? 0,
        group = events.get(tick) ?? [];
      group.push({ node, owner });
      events.set(tick, group);
    }
    if (note.node)
      lines.push({
        owner,
        target: note.node,
        cursor: 0,
        points: note.node.map((node) => ({
          tick: node.t ?? 0,
          center: finiteNumber(node.pos) + (node.size ?? NOTE_SIZE) / 2,
          size: node.size ?? NOTE_SIZE,
        })),
      });
  }
  const starts = [...lines].sort((a, b) => a.points[0]!.tick - b.points[0]!.tick);
  const active = new Set<(typeof lines)[number]>();
  let nextLine = 0;
  for (const [tick, group] of [...events].sort(([a], [b]) => a - b)) {
    while (nextLine < starts.length && starts[nextLine]!.points[0]!.tick <= tick) active.add(starts[nextLine++]!);
    const occupants = new Map<
      number,
      { center: number; size: number; node?: BestdoriSsNote; line?: (typeof lines)[number] }
    >();
    for (const line of active) {
      if (line.points.at(-1)!.tick < tick) {
        active.delete(line);
        continue;
      }
      while (line.cursor + 1 < line.points.length && line.points[line.cursor + 1]!.tick <= tick) line.cursor++;
      const head = line.points[line.cursor]!,
        tail = line.points[line.cursor + 1] ?? head;
      const ratio = tail.tick === head.tick ? 0 : (tick - head.tick) / (tail.tick - head.tick);
      occupants.set(line.owner, {
        center: head.center + (tail.center - head.center) * ratio,
        size: head.size + (tail.size - head.size) * ratio,
        line,
      });
    }
    for (const { node, owner } of group) {
      const existing = occupants.get(owner);
      occupants.set(
        owner,
        existing
          ? { ...existing, node }
          : {
              node,
              center: finiteNumber(node.pos) + (node.size ?? NOTE_SIZE) / 2,
              size: node.size ?? NOTE_SIZE,
            },
      );
    }
    const ordered = [...occupants.values()].sort((a, b) => a.center - b.center);
    const widths = ordered.map((point) => {
      let width = point.size;
      for (const other of ordered) {
        const distance = Math.abs(other.center - point.center);
        if (distance > 1e-6) width = Math.min(width, distance);
      }
      return width;
    });
    ordered.forEach((point, index) => {
      const width = widths[index]!;
      if (width >= point.size) return;
      const node = point.node ?? { t: tick, visible: false };
      node.pos = point.center - width / 2;
      node.size = width;
      if (!point.node) point.line!.target.push(node);
    });
  }
  for (const line of lines) line.target.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

/** Hidden ornament runs have no source checkpoints between their visible ends. */
function connectHiddenWaveCorridors(connections: BestdoriChartConnection[], nodes: BestdoriSsNote[]): void {
  let begin = 0;
  for (let end = 1; end < connections.length; end++) {
    if (connections[end]!.hidden) continue;
    const points = connections.slice(begin, end + 1);
    let turns = 0;
    for (let i = 2; i < points.length - 1; i++) {
      const a = points[i - 1]!,
        b = points[i]!,
        c = points[i + 1]!;
      const left = finiteNumber(b.lane) - finiteNumber(a.lane);
      const right = finiteNumber(c.lane) - finiteNumber(b.lane);
      if (
        left * right < 0 &&
        Math.abs(left) >= 1 &&
        Math.abs(right) >= 1 &&
        finiteNumber(b.beat) - finiteNumber(a.beat) <= 1 / 8 &&
        finiteNumber(c.beat) - finiteNumber(b.beat) <= 1 / 8
      )
        turns++;
    }
    if (turns >= 6) {
      const head = connections[begin]!,
        tail = connections[end]!;
      const firstBeat = finiteNumber(head.beat),
        span = finiteNumber(tail.beat) - firstBeat;
      const headNode = nodes.find((node) => node.t === toTick(firstBeat))!;
      const tailNode = nodes.find((node) => node.t === toTick(finiteNumber(tail.beat)))!;
      const corridorWidth = Math.min(headNode.size ?? NOTE_SIZE, tailNode.size ?? NOTE_SIZE);
      if (span > 0)
        for (const node of nodes) {
          if ((node.t ?? 0) <= toTick(firstBeat) || (node.t ?? 0) >= toTick(finiteNumber(tail.beat))) continue;
          const ratio = ((node.t ?? 0) / PPQ - firstBeat) / span;
          const centerLane = finiteNumber(head.lane) + (finiteNumber(tail.lane) - finiteNumber(head.lane)) * ratio;
          const corridorLeft = laneToPos(centerLane) + (NOTE_SIZE - corridorWidth) / 2,
            originalLeft = finiteNumber(node.pos);
          const originalRight = originalLeft + (node.size ?? NOTE_SIZE);
          node.pos = Math.min(originalLeft, corridorLeft);
          node.size = Math.max(originalRight, corridorLeft + corridorWidth) - node.pos;
        }
    }
    begin = end;
  }
}

/**
 * Return the SS left edge and width for a Bestdori directional flick.
 *
 * Bestdori's published ToolChartSimulator (ToolChartSimulator.95b33d9b.js)
 * draws tile i at `lane + i * (isLeft ? -1 : 1)`. Therefore `lane` is the
 * rightmost tile centre for Left and the leftmost tile centre for Right. Its
 * arrow formula, `lane + (isLeft ? 1 - width : width - 1)`, confirms the same
 * anchor convention.
 */
export function bestdoriDirectionalGeometry(
  laneValue: unknown,
  widthValue: unknown,
  direction: unknown,
): { pos: number; size: number } {
  const anchorLane = finiteNumber(laneValue);
  const width = Math.max(1, finiteNumber(widthValue));
  const leftmostLane = direction === "Left" ? anchorLane - (width - 1) : anchorLane;
  const pos = laneToPos(leftmostLane);
  return {
    pos,
    size: laneToPos(leftmostLane + width - 1) + NOTE_SIZE - pos,
  };
}

/** Convert a parsed Bestdori chart array into an SS document object. */
export function bestdoriChartToSs(input: unknown): BestdoriSsDocument {
  const source = repairBestdoriChart(input);
  const bpm: BestdoriSsBpm[] = [];
  const skill: number[] = [];
  const feverRanges: Array<[startTick: number, endTick?: number]> = [];
  const notes: BestdoriSsNote[] = [];
  const slides: Array<{ connections: BestdoriChartConnection[]; nodes: BestdoriSsNote[] }> = [];

  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue;

    switch (raw.type) {
      case "BPM": {
        const value = finiteNumber(raw.bpm);
        if (value > 0) bpm.push({ t: toTick(finiteNumber(raw.beat)), bpm: value });
        break;
      }
      case "System": {
        // ToolChartSimulator.95b33d9b.js appends on every start and makes every
        // end mutate the latest appended range, even if that range already has
        // an end. Keep that event-order behaviour instead of treating fever as
        // one global open/closed flag. The BGM marker is an audio-host concern.
        if (raw.data === "cmd_fever_start.wav") {
          feverRanges.push([toTick(finiteNumber(raw.beat))]);
        } else if (raw.data === "cmd_fever_end.wav" && feverRanges.length > 0) {
          feverRanges[feverRanges.length - 1]![1] = toTick(finiteNumber(raw.beat));
        }
        break;
      }
      case "Single": {
        const tick = toTick(finiteNumber(raw.beat));
        if (raw.skill) skill.push(tick);
        const note: BestdoriSsNote = {
          t: tick,
          pos: laneToPos(finiteNumber(raw.lane)),
          size: NOTE_SIZE,
        };
        if (raw.flick) note.type = "flick";
        if (raw.hidden) note.visible = false;
        notes.push(note);
        break;
      }
      case "Long":
      case "Slide": {
        const connections = Array.isArray(raw.connections) ? raw.connections : [];
        if (!connections.length) break;
        const node = connections.map((point): BestdoriSsNote => {
          const tick = toTick(finiteNumber(point.beat));
          // The published simulator never derives skills from hidden
          // connections. Hidden interior points are still rendered as part of
          // the repaired line, but they cannot create a skill marker.
          if (!point.hidden && point.skill) skill.push(tick);
          const entry: BestdoriSsNote = {
            t: tick,
            pos: laneToPos(finiteNumber(point.lane)),
            size: NOTE_SIZE,
          };
          if (point.flick) entry.type = "flick";
          if (point.hidden) entry.visible = false;
          return entry;
        });
        slides.push({ connections, nodes: node });
        notes.push({ type: "long", node });
        break;
      }
      case "Directional": {
        const tick = toTick(finiteNumber(raw.beat));
        if (raw.skill) skill.push(tick);
        const direction = raw.direction === "Left" ? "left" : raw.direction === "Right" ? "right" : "up";
        notes.push({
          type: "flick",
          t: tick,
          ...bestdoriDirectionalGeometry(raw.lane, raw.width, raw.direction),
          dir: direction,
        });
        break;
      }
    }
  }

  fitAdjacentNoteWidths(notes);
  for (const slide of slides) connectHiddenWaveCorridors(slide.connections, slide.nodes);
  if (!bpm.some((entry) => entry.t === 0)) bpm.unshift({ t: 0, bpm: 120 });
  bpm.sort((left, right) => left.t - right.t);
  skill.sort((left, right) => left - right);
  // The published viewer leaves unmatched starts open with Infinity. SS is a
  // JSON format and cannot encode Infinity, so retain every faithfully closed
  // range and omit only malformed, unclosed source events.
  const fever = feverRanges
    .flatMap(([start, end]) => (end === undefined ? [] : ([[start, end]] as Array<[number, number]>)))
    .sort((left, right) => left[0] - right[0]);

  return {
    meta: { version: 1 },
    score: {
      events: {
        bpm,
        sig: [{ t: 0, sig: [4, 4] }],
        skill,
        fever,
        call: [],
      },
      notes,
    },
  };
}

/** Convert a parsed Bestdori chart array into SS JSON text. */
export const bestdoriChartToSsText = (input: unknown): string => JSON.stringify(bestdoriChartToSs(input));
