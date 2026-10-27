// L3 — GEB
// Input: 资源类型与图片请求。
// Output: 不依赖 DOM 的资源图片路由和传输信封。
// Pos: [Map](../L2-2.md)；Worker 与设备模块共享路由。
// Effects/Dependencies: 纯数据。
export interface ImageRenderRequest {
  kind: "team" | "gacha" | "gacha-history" | "stamp" | "chart" | "live2d" | "spine";
  data: Record<string, unknown>;
  id?: string;
  locale?: string;
  theme?: string;
  seed?: string;
  page?: number;
  archive?: boolean;
}
export const RESOURCE_IMAGE_ROUTES = [
  { path: "/api/v1/team-builder/image.png", kind: "team", schema: "TeamImageOptions", methods: ["POST"] },
  { path: "/api/v1/gacha/simulation/image.png", kind: "gacha", schema: "GachaImageInput", methods: ["POST"] },
  { path: "/api/v1/gacha-history/image.png", kind: "gacha-history", schema: "GachaHistoryReport", methods: ["POST"] },
  { path: "/api/v1/gacha-history/images.zip", kind: "gacha-history", schema: "GachaHistoryReport", methods: ["POST"] },
  { path: "/api/v1/stamps/image.png", kind: "stamp", schema: "StampImageOptions", methods: ["POST"] },
  { path: "/api/v1/charts/image.png", kind: "chart", schema: "CustomChartImageOptions", methods: ["POST"] },
  { path: "/api/v1/live2d/{id}/image.png", kind: "live2d", schema: "Live2DImageOptions", methods: ["GET", "HEAD", "POST"] },
  { path: "/api/v1/spine/{id}/image.png", kind: "spine", schema: "SpineImageOptions", methods: ["GET", "HEAD", "POST"] },
] as const;
