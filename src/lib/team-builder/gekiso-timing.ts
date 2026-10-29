// L3 — GEB
// Input: Native chart enumeration, Gekiso ranges and base Perfect timing windows.
// Output: Legal opening-chord delivery frames and per-range boundary inputs.
// Pos: [Map](L2-2.md); shared by normal replay, catalogue projection and detail views.
// Effects/Dependencies: Pure; preserves nominal note times and range membership.
import type { ChartSource } from "./engine/chart";
import { isJudgementNote } from "./engine/runtime-chart.ts";

interface TimingNote {
  timeMs: number;
  op: number;
  judgementType: number;
}
export interface PerfectTiming {
  beforeMs: number;
  afterMs: number;
}
export interface GekisoTimingSegment {
  opening?: { timeMs: number; notes: number; lateMs: number };
  ending?: { timeMs: number; notes: number; earlyMs: number };
}
export interface JudgementTimingRow extends PerfectTiming {
  assistLevel: number;
  noteSimulateJudgement: number;
  noteJudgementType: number;
}

export function perfectTimings(rows: readonly JudgementTimingRow[]): ReadonlyMap<number, PerfectTiming> {
  return new Map(rows.filter(row => row.assistLevel === 0 && row.noteSimulateJudgement === 5)
    .map(row => [row.noteJudgementType, { beforeMs: row.beforeMs, afterMs: row.afterMs }]));
}

export function comboOpening(notes: readonly TimingNote[], start: number, end: number, afterMs: ReadonlyMap<number, number>) {
  let first = 0, high = notes.length;
  while (first < high) {
    const middle = (first + high) >> 1;
    if (notes[middle]!.timeMs < start) first = middle + 1;
    else high = middle;
  }
  const note = notes[first];
  if (!note || note.timeMs > end) return null;
  const frame = Math.ceil(note.timeMs * 60 / 1000);
  const nextTimeMs = Math.floor((frame + 1) * 1000 / 60);
  if (nextTimeMs >= end) return null;
  let after = first;
  while (after < notes.length && Math.ceil(notes[after]!.timeMs * 60 / 1000) === frame && notes[after]!.timeMs <= end) after++;
  if (after - first < 2) return null;
  for (let index = first; index < after; index++) {
    const current = notes[index]!;
    if (current.timeMs !== note.timeMs || (current.op !== 1 && current.op !== 40)
      || nextTimeMs - current.timeMs > (afterMs.get(current.judgementType) ?? -1)) return null;
  }
  return { first, after, frame, nextTimeMs };
}

export function gekisoTiming(source: ChartSource, windows: ReadonlyMap<number, PerfectTiming>): GekisoTimingSegment[] {
  const notes = (source.enumeration ?? []).filter(note => isJudgementNote(note.op))
    .map(note => ({ ...note, judgementType: note.judgementType ?? 0 }))
    .sort((a, b) => a.timeMs - b.timeMs);
  const afterMs = new Map([...windows].map(([type, window]) => [type, window.afterMs]));
  return source.feverMs.map(([start, end]) => {
    const result: GekisoTimingSegment = {};
    const opening = comboOpening(notes, start, end, afterMs);
    if (opening) result.opening = {
      timeMs: notes[opening.first]!.timeMs,
      notes: opening.after - opening.first,
      lateMs: opening.nextTimeMs - notes[opening.first]!.timeMs,
    };
    const ending = notes.filter(note => note.timeMs === end && (note.op === 1 || note.op === 40)
      && (windows.get(note.judgementType)?.beforeMs ?? 0) > 0);
    if (ending.length) result.ending = {
      timeMs: end,
      notes: ending.length,
      earlyMs: Math.min(end - start, ...ending.map(note => windows.get(note.judgementType)!.beforeMs)),
    };
    return result;
  });
}
