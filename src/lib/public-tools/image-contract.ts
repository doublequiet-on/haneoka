// L3 — GEB
// Input: 网页图片导出的数据模型和查看器状态。
// Output: 资源图片请求与公开路由。
// Pos: [Map](../L2-2.md)；HTTP 和设备图片渲染共用契约。
// Effects/Dependencies: 仅类型和静态路由，不绘图或读取用户资料。
import type { ChartDocument } from "@haneoka/cassiopeia";
import type { EngineRequest, EngineHit } from "../team-builder/engine/api";
import type { BuildSettings } from "../../lit/team-builder/types";
import type { TeamBuilderData } from "../team-builder/data";
import type { GachaImageInput } from "../gacha-simulation-image";
import type { GachaHistoryReport } from "../gacha-history-image";
import type { StampLayer } from "../stamp-maker/layers";
import type { ChartOverviewExportMeta } from "../../lit/runtime/chart-image-export";

export interface TeamImageOptions {
  request: EngineRequest;
  hit: EngineHit;
  settings?: BuildSettings;
  catalog?: TeamBuilderData;
  server?: "jp" | "intl";
  release?: string;
  width?: number;
}
export interface ImageAppearance {
  locale?: "en" | "ja" | "ko" | "zh-CN" | "zh-TW";
  theme?: "light" | "dark";
  seed?: string;
}
export interface ModelImageOptions {
  server?: "jp" | "intl";
  release?: string;
  width?: number;
  height?: number;
  time?: number;
  background?: { r: number; g: number; b: number } | null;
  transform?: { offsetX: number; offsetY: number; scale: number };
}
export interface Live2DImageOptions extends ModelImageOptions {
  motion?: string;
  loop?: boolean;
  expression?: string;
  breath?: boolean;
  blink?: boolean;
  parameters?: Record<string, number>;
  parts?: Record<string, number>;
  look?: { x: number; y: number };
}
export interface SpineImageOptions extends ModelImageOptions { animation?: string; skin?: string; loop?: boolean; playbackRate?: number }
export interface StampImageOptions {
  image: string;
  layers: StampLayer[];
  sourceSize: { width: number; height: number };
  size?: number;
  fonts?: { family: string; source: string }[];
}
export interface CustomChartImageOptions {
  server?: "jp" | "intl";
  release?: string;
  height?: number;
  chart: ChartDocument;
  meta: ChartOverviewExportMeta;
}
export type ResourceImageRequest = ImageAppearance & (
  | { kind: "team"; data: TeamImageOptions }
  | { kind: "gacha"; data: GachaImageInput }
  | { kind: "gacha-history"; data: GachaHistoryReport; page?: number; archive?: boolean }
  | { kind: "stamp"; data: StampImageOptions }
  | { kind: "chart"; data: CustomChartImageOptions }
  | { kind: "live2d"; id: string; data: Live2DImageOptions }
  | { kind: "spine"; id: string; data: SpineImageOptions }
);
export { RESOURCE_IMAGE_ROUTES } from "./image-routes";

export type { GachaImageInput, GachaHistoryReport };
