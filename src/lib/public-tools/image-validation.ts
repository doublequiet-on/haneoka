// L3 — GEB
// Input: 公开图片请求和允许读取的本站 origin。
// Output: 绘图预算与媒体地址的参数检查。
// Pos: [Map](../L2-2.md)；Worker 和私有渲染服务共用输入边界。
// Effects/Dependencies: 纯校验，不发出网络请求。
const MAX_BODY = 8 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function validateResourceImage(input: unknown, origin: string) {
  if (!object(input) || !object(input.data) || !["team", "gacha", "gacha-history", "stamp", "chart", "live2d", "spine"].includes(String(input.kind))) throw new TypeError("Supply an image data object");
  if (input.locale && !["en", "ja", "ko", "zh-CN", "zh-TW"].includes(String(input.locale))) throw new TypeError("Invalid locale");
  if (input.theme && !["light", "dark"].includes(String(input.theme))) throw new TypeError("Invalid theme");
  if (input.seed && !/^(default|band-[1-5])$/u.test(String(input.seed))) throw new TypeError("Invalid seed");
  const required: Record<string, string[]> = {
    team: ["request", "hit"],
    gacha: ["mode", "title", "subtitle", "summary", "batches", "groups", "brand"],
    "gacha-history": ["title", "scope", "metrics", "charts", "groups"],
    stamp: ["image", "layers", "sourceSize"], chart: ["chart", "meta"],
  };
  for (const name of required[String(input.kind)] ?? []) if (input.data[name] === undefined) throw new TypeError(`Missing data.${name}`);
  if (input.data.release !== undefined && (typeof input.data.release !== "string" || !/^r-[a-f0-9]{20}$/u.test(input.data.release))) throw new TypeError("Invalid release");
  let count = 0;
  const visit = (value: unknown, depth: number) => {
    if (++count > 150000 || depth > 32) throw new RangeError("Image data is too complex");
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Image numbers must be finite");
    if (typeof value === "string") {
      if (value.length > MAX_BODY) throw new RangeError("Image value is too large");
      if (/^(?:https?:|\/\/|\/|data:|blob:|file:)/iu.test(value)) {
        if (/^data:(?:image\/(?:png|jpeg|webp)|font\/(?:woff2?|otf|ttf)|application\/(?:font-woff|octet-stream));base64,[A-Za-z0-9+/=]+$/u.test(value)) return;
        const url = new URL(value, origin);
        if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Images and fonts must use this site's URLs or base64 data");
      }
    } else if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); }
    else if (object(value)) { for (const item of Object.values(value)) visit(item, depth + 1); }
  };
  visit(input, 0);
  const numeric = (value: unknown, min: number, max: number, name: string) => { if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)) throw new TypeError(`Invalid ${name}`); };
  if (input.kind === "live2d" || input.kind === "spine") {
    if (!/^[A-Za-z0-9_.-]{1,160}$/u.test(String(input.id))) throw new TypeError("Invalid model ID");
    for (const name of ["width", "height"]) if (input.data[name] !== undefined && !Number.isInteger(input.data[name])) throw new TypeError(`Invalid ${name}`);
    if (input.data.server && !["jp", "intl"].includes(String(input.data.server))) throw new TypeError("Invalid server");
    numeric(input.data.width, 64, 2048, "width"); numeric(input.data.height, 64, 2048, "height"); numeric(input.data.time, 0, 120, "time");
    if (input.kind === "spine") numeric(input.data.playbackRate, .25, 2, "playbackRate");
    if (Number(input.data.width ?? 1024) * Number(input.data.height ?? 1024) > 4_000_000) throw new RangeError("Model image exceeds 4 million pixels");
  }
  if (input.kind === "team") {
    if (!object(input.data.request) || !object(input.data.hit) || !Array.isArray(input.data.hit.members) || input.data.hit.members.length > 5 || !Array.isArray(input.data.hit.snaps) || input.data.hit.snaps.length > 5) throw new TypeError("Supply request and hit with up to 5 members and Snapshots");
    numeric(input.data.width, 360, 1280, "width");
    if (input.data.width !== undefined && !Number.isInteger(input.data.width)) throw new TypeError("Invalid width");
  }

  if (input.kind === "stamp") {
    if (!Array.isArray(input.data.layers) || input.data.layers.length > 32 || typeof input.data.image !== "string" || !object(input.data.sourceSize)) throw new TypeError("Supply image, sourceSize and up to 32 layers");
    numeric(input.data.size, 1, 512, "size");
    if (input.data.size !== undefined && !Number.isInteger(input.data.size)) throw new TypeError("Invalid size");
  }
  if (input.kind === "gacha-history") {
    numeric(input.page, 1, 100, "page");
    if (input.page !== undefined && !Number.isInteger(input.page)) throw new TypeError("Invalid page");
    if (!Array.isArray(input.data.groups) || input.data.groups.reduce((sum, group) => sum + (group.cards?.length ?? 0), 0) > 3600) throw new RangeError("Report exceeds 3600 cards");
  }
  if (input.kind === "chart") {
    if (input.data.server && !["jp", "intl"].includes(String(input.data.server))) throw new TypeError("Invalid server");
    numeric(input.data.height, 360, 1440, "height");
    if (!object(input.data.chart) || !Array.isArray(input.data.chart.notes) || input.data.chart.notes.length > 25000 || typeof input.data.chart.durationMs !== "number" || !Number.isFinite(input.data.chart.durationMs) || input.data.chart.durationMs > 30 * 60 * 1000) throw new RangeError("Invalid chart size");
  }
}
