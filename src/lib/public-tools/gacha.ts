// L3 — GEB
// Input: 招募实体、商品、次数与可选随机数生成器。
// Output: 招募模拟、保底和汇总。
// Pos: [Map](../L2-2.md)；招募工具的公开设备接口。
// Effects/Dependencies: 复用网页模拟器；不调用游戏抽取接口。
export { simulateGacha, canSimulate, gachaGuarantee, tallyGacha, kindRarityCounts, drawCountOf, useLimitOf } from "../gacha-simulation";
export type { GachaRun, GachaPrize, GachaTally } from "../gacha-simulation";
