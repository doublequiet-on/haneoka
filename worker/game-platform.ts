// L3 — GEB
// Input: 游戏区服、开放平台路由、参数和服务端数据源密钥。
// Output: 保留完整上游字段的 JSON／PNG；存档仅接受调用者自己的密钥。
// Pos: [Map](L2.md)；Moenotes 实时开放能力适配。
// Effects/Dependencies: 访问固定 Moenotes HTTPS 源、限流；无游戏凭据持久化或私有响应缓存。
import { PUBLIC_GAME_PATHS } from "./game-public";
import { GAME_PLATFORM_ROUTES, GAME_PLATFORM_SCHEMAS } from "./game-platform-contract";

const PREFIX = "/api/v1/live-capabilities";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Expose-Headers": "Retry-After, X-Request-Id, Content-Disposition",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export interface GamePlatformBindings {
  MOENOTES_OPEN_API_TOKEN?: string;
  MOENOTES_PROFILE_API_TOKEN?: string;
  GAME_API_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
type Schema = { type?: string; pattern?: string; minimum?: number; minItems?: number; maxItems?: number; enum?: readonly string[]; oneOf?: readonly Schema[]; items?: Schema };
type Parameter = { name: string; upstreamName?: string; in: string; required: boolean; schema: Schema; style?: string; explode?: boolean };
type Route = { path: string; upstreamPath: string; parameters: readonly Parameter[]; responses: object };
const routes: readonly Route[] = GAME_PLATFORM_ROUTES;
const compiled = routes.map(route => ({ route, pattern: new RegExp(`^${route.path.replaceAll(".", "\\.").replace(/\{[^}]+\}/gu, "([^/]+)")}$`, "u") }))
  .sort((a, b) => [...a.route.path.matchAll(/\{/gu)].length - [...b.route.path.matchAll(/\{/gu)].length);

const fail = (request: Request, status: number, code: string, message: string) => {
  const requestId = crypto.randomUUID();
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: { code, message, requestId } }),
    { status, headers: { ...CORS, "X-Request-Id": requestId, "Content-Type": "application/json; charset=utf-8", ...(status === 405 ? { Allow: "GET, HEAD, OPTIONS" } : {}) } });
};

function scalar(value: string, schema: Schema): boolean {
  if (schema.oneOf) return schema.oneOf.some(option => scalar(value, option));
  if (schema.enum) return schema.enum.includes(value);
  if (schema.type === "integer") return /^-?\d+$/u.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= (schema.minimum ?? -2147483648) && Number(value) <= 2147483647;
  if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) return false;
  if (schema.pattern && (/^-?\d+$/u.test(value)) && (BigInt(value) < 0n || BigInt(value) > 9223372036854775807n)) return false;
  return value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/u.test(value);
}

function values(raw: readonly string[], parameter: Parameter): string[] {
  const schema = parameter.schema;
  if (schema.type !== "array") {
    if (raw.length !== 1 || !scalar(raw[0]!, schema)) throw new Error(`Invalid ${parameter.name}`);
    return [...raw];
  }
  const result = raw.flatMap(value => value.split(","));
  if (result.length < (schema.minItems ?? 0) || result.length > (schema.maxItems ?? 100) || !result.every(value => scalar(value, schema.items ?? {}))) throw new Error(`Invalid ${parameter.name}`);
  return result;
}

export function gamePlatformOpenApi() {
  const paths: Record<string, object> = Object.fromEntries(routes.map((route, index) => [route.path, { get: { operationId: `game.${index}`, parameters: route.parameters.map(({ upstreamName: _internal, ...parameter }) => ({ ...parameter, ...(parameter.schema.type === "array" ? { style: "form", explode: true } : {}) })), responses: Object.fromEntries(Object.entries(route.responses).map(([status, response]) => [status, { ...response, description: status === "200" ? "Complete game response" : "Game API error" }])) } }]));
  const announcementPath = "/api/v1/announcements/{announcementId}/live";
  const announcementOperation = Reflect.get(paths[announcementPath]!, "get") as { parameters: object[] };
  announcementOperation.parameters.push({ name: "revision", in: "query", required: false, schema: { type: "string", pattern: "^[0-9]+$" }, description: "Announcement revision from its revisions collection; omitted selects latest." });
  paths["/api/v1/players/{profileId}/save.gz"] = { get: { operationId: "game.save", security: [{ gameApplicationKey: [] }], parameters: [
    { name: "server", in: "query", required: true, schema: { type: "string", enum: ["jp", "intl"] } },
    { name: "profileId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" }, description: "Top-level _profileId from the save file." },
  ], responses: { "200": { description: "Authorized original gzip save", content: { "application/gzip": { schema: { type: "string", format: "binary" } } } }, "401": { description: "Application key required" }, "404": { description: "Save missing or not granted" } } } };
  for (const [index, entry] of PUBLIC_GAME_PATHS.entries()) paths[entry.path] = { get: { operationId: `live.snapshot.${index}`, parameters: [
    { name: "region", in: "query", required: true, schema: { type: "string", enum: ["jp", "tw", "en", "kr"] } },
    ...[...entry.path.matchAll(/\{([^}]+)\}/gu)].map(match => ({ name: match[1]!, in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" } })),
  ], responses: { "200": { description: "Complete game snapshot", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } } } };
  return {
    openapi: "3.1.0", info: { title: "Haneoka game API", version: "1.0.0", description: "IDs are decimal strings. Resource servers jp/intl and live regions jp/tw/en/kr are distinct." },
    servers: [{ url: "https://haneoka.org" }],
    paths,
    components: { schemas: GAME_PLATFORM_SCHEMAS, securitySchemes: { gameApplicationKey: { type: "apiKey", in: "header", name: "X-Game-Application-Key" } } },
  };
}

export async function handleGamePlatform(request: Request, env: GamePlatformBindings): Promise<Response | null> {
  const url = new URL(request.url);
  const callerToken = request.headers.get("X-Game-Application-Key")?.trim();
  const openToken = callerToken || env.MOENOTES_OPEN_API_TOKEN?.trim();
  const save = /^\/api\/v1\/players\/([0-9]{1,19})\/save\.gz$/u.exec(url.pathname);
  const matched = compiled.map(entry => ({ ...entry, match: entry.pattern.exec(url.pathname) })).find(entry => entry.match);
  if (!save && url.pathname !== PREFIX && url.pathname !== `${PREFIX}/openapi.json` && !matched) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!["GET", "HEAD"].includes(request.method)) return fail(request, 405, "method_not_allowed", "Use GET or HEAD");
  if (url.pathname === `${PREFIX}/openapi.json`) return new Response(request.method === "HEAD" ? null : JSON.stringify(gamePlatformOpenApi()), { headers: { ...CORS, "Content-Type": "application/json" } });
  if (url.pathname === PREFIX) return new Response(request.method === "HEAD" ? null : JSON.stringify({
    schema: "haneoka-game-api-v1",
    regions: ["jp", "tw", "en", "kr"], openapi: `${PREFIX}/openapi.json`,
    operations: [...routes.map(route => ({ method: "GET", path: route.path, parameters: route.parameters.map(({ upstreamName: _internal, ...parameter }) => parameter) })), ...PUBLIC_GAME_PATHS.map(entry => ({ method: "GET", path: entry.path }))],
    saves: { path: "/api/v1/players/{profileId}/save.gz?server={server}", servers: ["jp", "intl"], credential: "X-Game-Application-Key", authorization: "The caller's application must have explicit access to this save." },
  }), { headers: { ...CORS, "Content-Type": "application/json" } });
  let target: URL;
  try {
    if (save) {
      if (url.searchParams.getAll("server").length !== 1 || !["jp", "intl"].includes(url.searchParams.get("server")!) || [...url.searchParams.keys()].some(key => key !== "server")) throw new Error("Supply server=jp or server=intl");
      target = new URL(`https://passport.bdon.moe/api/open/v1/saves/${url.searchParams.get("server")}/${save[1]}`);
    } else {
      const match = matched;
      if (!match) return fail(request, 404, "route_not_found", "Game API route not found");
      let index = 1;
      const pathValues: Record<string, string> = {};
      match.route.path.replace(/\{([^}]+)\}/gu, (_placeholder, name: string) => {
        const parameter = match.route.parameters.find(p => p.in === "path" && p.name === name)!;
        const decoded = decodeURIComponent(match.match![index++]!);
        const value = values([decoded], parameter).join(",");
        if (value.includes("/") || value.includes("\\") || value === "." || value === "..") throw new Error(`Invalid ${parameter.name}`);
        pathValues[parameter.upstreamName || name] = value;
        return "";
      });
      const regionParameter = match.route.parameters.find(p => p.name === "region")!;
      pathValues.region = values(url.searchParams.getAll("region"), regionParameter)[0]!;
      if (pathValues.profileId && pathValues.region !== "jp") {
        const prefix = ({ tw: "2", en: "3", kr: "4" } as Record<string, string>)[pathValues.region!];
        if (!new RegExp(`^${prefix}[0-9]{10}$`, "u").test(pathValues.profileId)) throw new Error("Invalid profileId for region");
      }
      const path = `/${pathValues.region}` + match.route.upstreamPath.replace(/\{([^}]+)\}/gu, (_placeholder, name: string) => encodeURIComponent(pathValues[name]!));
      const open = Boolean(openToken);
      target = new URL(open ? `https://passport.bdon.moe/api/open/v1/moenotes${path}` : `https://bdon-api.bdon.moe/v1${path}`);
      const query = match.route.parameters.filter(p => p.in === "query");
      for (const parameter of match.route.parameters.filter(p => p.in === "path" && p.name !== "region")) {
        const name = parameter.upstreamName || parameter.name;
        if (!match.route.upstreamPath.includes(`{${name}}`)) target.searchParams.set(name, pathValues[name]!);
      }
      for (const name of url.searchParams.keys()) if (!query.some(p => p.name === name)) throw new Error(`Unknown parameter ${name}`);
      for (const parameter of query.filter(p => p.name !== "region")) {
        const raw = url.searchParams.getAll(parameter.name);
        if (!raw.length) { if (parameter.required) throw new Error(`Missing ${parameter.name}`); else continue; }
        for (const value of values(raw, parameter)) target.searchParams.append(parameter.upstreamName || parameter.name, value);
      }
      if (url.searchParams.has("start") && (BigInt(url.searchParams.get("start")!) < 1n || BigInt(url.searchParams.get("end")!) < BigInt(url.searchParams.get("start")!))) throw new Error("Invalid ranking range");
      if (url.searchParams.getAll("rank").flatMap(value => value.split(",")).some(value => Number(value) < 1)) throw new Error("rank must be positive");
    }
  } catch (error) {
    return fail(request, 400, "invalid_request", error instanceof Error ? error.message : "Invalid parameters");
  }
  const token = save ? callerToken : openToken || env.MOENOTES_PROFILE_API_TOKEN?.trim();
  if (!token) return fail(request, save ? 401 : 503, save ? "application_key_required" : "data_unavailable", save ? "Supply your application key in X-Game-Application-Key" : "Game data is unavailable");
  if (env.GAME_API_RATE_LIMITER && !(await env.GAME_API_RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "local" })).success) {
    const response = fail(request, 429, "rate_limit_exceeded", "Retry after 60 seconds"); response.headers.set("Retry-After", "60"); return response;
  }
  try {
    const upstream = await fetch(target, { headers: { Accept: save ? "application/gzip" : "application/json, image/png", Authorization: `Bearer ${token}`, "User-Agent": "Haneoka/1.0" }, redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    if (upstream.status >= 300 && upstream.status < 400) { await upstream.body?.cancel(); return fail(request, 502, "data_unavailable", "Game data is unavailable"); }
    if (!callerToken && (upstream.status === 401 || upstream.status === 403)) { await upstream.body?.cancel(); return fail(request, 503, "data_unavailable", "Game data is unavailable"); }
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const response = fail(request, upstream.status, upstream.status === 404 ? "not_found" : upstream.status === 429 ? "rate_limit_exceeded" : upstream.status === 400 ? "invalid_request" : "data_unavailable", upstream.status === 404 ? "Game data not found" : "Game data request failed");
      const retry = upstream.headers.get("Retry-After"); if (retry) response.headers.set("Retry-After", retry);
      return response;
    }
    const headers = new Headers(CORS);
    headers.set("X-Request-Id", crypto.randomUUID());
    for (const name of ["Content-Type", "Content-Disposition", "Retry-After"]) {
      const value = upstream.headers.get(name); if (value) headers.set(name, value);
    }
    if (headers.has("Content-Disposition")) headers.set("Content-Disposition", `attachment; filename="game-${save ? "save.json.gz" : "profile-card.png"}"`);
    if (request.method === "HEAD") { await upstream.body?.cancel(); return new Response(null, { status: upstream.status, headers }); }
    if (!upstream.body) return new Response(null, { status: upstream.status, headers });
    const limit = save ? 8 * 1024 * 1024 : 16 * 1024 * 1024;
    const declared = Number(upstream.headers.get("Content-Length"));
    if (declared > limit) { await upstream.body.cancel(); return fail(request, 502, "response_too_large", "Game response exceeds the size limit"); }
    let size = 0;
    return new Response(upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { size += chunk.byteLength; if (size > limit) throw new RangeError("response_too_large"); controller.enqueue(chunk); } })), { status: upstream.status, headers });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return fail(request, 504, "data_timeout", "Game data request did not complete");
  }
}
