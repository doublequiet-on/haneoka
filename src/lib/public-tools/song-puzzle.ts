// L3 — GEB
// Input: 歌曲拼图状态、搜索预算与进度回调。
// Output: 拼图解及搜索进度。
// Pos: [Map](../L2-2.md)；网页拼图求解器的公开设备入口。
// Effects/Dependencies: 在调用设备计算并复用原有取消／预算约定。
export { solvePuzzle } from "../song-puzzle/solver";
export type { SolveProgress, SolveResult } from "../song-puzzle/solver";
