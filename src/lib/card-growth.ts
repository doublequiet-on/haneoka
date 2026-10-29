// L3 — GEB
// Input: maximum stat and authored growth rates in basis points.
// Output: integer member contributions and Snapshot percentage basis points.
// Pos: [Map](L2-2.md); shared card growth arithmetic.
// Effects/Dependencies: pure; mirrors the engine's binary32 operation order.
const f = Math.fround;
export const levelContribution = (maximum: number, rate: number): number => Math.floor(f(f(maximum * rate) / 10000));
export const trainingContribution = (maximum: number, rate: number): number =>
  Math.floor(f(f(rate / 10000) * f(maximum)));
export const rankContribution = (maximum: number, rate: number): number =>
  Math.floor(f(f(Math.imul(maximum, rate)) / 10000));
export const memberStat = (maximum: number, level: number, training: number, rank: number): number =>
  levelContribution(maximum, level) + trainingContribution(maximum, training) + rankContribution(maximum, rank);
export const snapshotPercent = rankContribution;
