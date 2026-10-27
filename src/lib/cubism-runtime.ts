// L3 — GEB
// Input: 锁定的 Cubism 运行时清单与可选素材根地址。
// Output: 按完整 URL 缓存的运行时模块及核心脚本地址。
// Pos: [Map](L2-2.md)；网页查看器与公开图片模块的运行时入口。
// Effects/Dependencies: 动态模块导入；失败重试更换查询参数。
import runtimeLock from "../../config/cubism-runtime.lock.json";

function runtimeUrl(source: string): string {
  const file = runtimeLock.files.find((entry) => entry.source === source);
  if (!file?.output) throw new Error(`Missing Cubism runtime file: ${source}`);
  return `/${file.output}?v=${file.sha256}`;
}

// Runtime URLs must change with the locked bytes: an older cached adapter
// cannot satisfy the current viewer's method contract.
export const CUBISM_WEB_RUNTIME_URL = runtimeUrl("Framework/vega-cubism-web-runtime.mjs");
const runtimeModules = new Map<string, { module?: Promise<unknown>; failedImports: number }>();

export function loadCubismWebRuntime<T = unknown>(assetsBase = document.baseURI): Promise<T> {
  const url = new URL(CUBISM_WEB_RUNTIME_URL, assetsBase);
  let entry = runtimeModules.get(url.href);
  if (!entry) { entry = { failedImports: 0 }; runtimeModules.set(url.href, entry); }
  const cached = entry;
  if (!cached.module) {
    if (cached.failedImports) url.searchParams.set("retry", String(cached.failedImports));
    cached.module = import(/* @vite-ignore */ url.href).catch((error: unknown) => {
      delete cached.module;
      cached.failedImports++;
      throw error;
    });
  }
  return cached.module as Promise<T>;
}

export const CUBISM_CORE_URLS = {
  cubismCoreUrl: runtimeUrl("Core/live2dcubismcore.js"),
  cubism2CoreUrl: runtimeUrl("Core/live2d.min.js"),
  motionSyncCoreUrl: runtimeUrl("Core/CRI/live2dcubismmotionsynccore.min.js"),
};
