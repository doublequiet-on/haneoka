// L3 — GEB
// Input: 公共 API 根地址、固定版本与 Engine 请求。
// Output: 在调用者设备运行的配队引擎句柄。
// Pos: [Map](../L2-2.md)；公开浏览器计算入口。
// Effects/Dependencies: 读取 release DTO，创建本地 Worker；库存只在调用者设备内传递。
import { EngineClient } from "../team-builder/engine/client";
import type { TeamBuilderData } from "../team-builder/data";
export type { EngineRequest, EngineResponse, GrowthResult, TeamEvaluation, Timeline } from "../team-builder/engine/api";
export type { EvaluateRequest, ExplainRequest, EngineSnapshot } from "../team-builder/engine/protocol";
export type { MemberInput, SnapInput } from "../team-builder/engine/box";

export interface LocalTeamBuilderOptions {
  apiBase?: string;
  server?: "jp" | "intl";
  release?: string;
  maxWorkers?: number;
  signal?: AbortSignal;
}

export async function createTeamBuilder(options: LocalTeamBuilderOptions = {}) {
  const apiBase = new URL(options.apiBase ?? "https://haneoka.org/api/v1/");
  apiBase.pathname = apiBase.pathname.replace(/\/?$/u, "/");
  const server = options.server ?? "intl";
  if (server !== "jp" && server !== "intl") throw new TypeError("server must be jp or intl");
  const url = new URL(`team-builder/${server}`, apiBase);
  if (options.release) url.searchParams.set("release", options.release);
  const response = await fetch(url, { signal: options.signal, credentials: "omit" });
  if (!response.ok) throw new Error(`team-data-http:${response.status}`);
  const data = await response.json() as TeamBuilderData;
  if (data.schema !== "haneoka-team-builder-data-v1" || data.identity.server !== server ||
      response.headers.get("x-haneoka-release-id") !== data.identity.releaseId ||
      response.headers.get("x-haneoka-source-id") !== data.identity.sourceId ||
      (options.release && options.release !== data.identity.releaseId)) throw new Error("team-data-release-mismatch");
  options.signal?.throwIfAborted();
  const engine = new EngineClient(data, () => {}, { maxWorkers: options.maxWorkers ?? 1, apiBase: apiBase.href });
  const abort = () => engine.cancel();
  options.signal?.addEventListener("abort", abort, { once: true });
  return {
    identity: structuredClone(data.identity),
    attribution: { text: "Team-building algorithm from Haneoka", url: "https://haneoka.org" },
    run: engine.run.bind(engine),
    growth: engine.growth.bind(engine),
    evaluate: engine.evaluate.bind(engine),
    explain: engine.explain.bind(engine),
    cancel: engine.cancel.bind(engine),
    dispose() {
      options.signal?.removeEventListener("abort", abort);
      engine.cancel();
    },
  };
}
