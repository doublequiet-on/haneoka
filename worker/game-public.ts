// L3 — GEB
// Input: 公开榜线、活动、公告与资料卡路径。
// Output: 原始快照、版本及采集标头。
// Pos: [Map](L2.md)；免密钥 Moenotes 快照代理。
// Effects/Dependencies: 仅访问 api.bdon.moe 的已登记 GET 路由；传递条件读取。
export const PUBLIC_GAME_PATHS = [
  { path: "/api/v1/events/views/live", source: "events" },
  { path: "/api/v1/events/views/current", source: "events/current" },
  { path: "/api/v1/events/{eventId}/snapshots", source: "events/{eventId}" },
  { path: "/api/v1/events/{eventId}/snapshots/latest", source: "events/{eventId}/latest" },
  { path: "/api/v1/events/{eventId}/challenges", source: "events/{eventId}/challenges" },
  { path: "/api/v1/events/{eventId}/challenges/{challengeId}/ranking", source: "events/{eventId}/challenges/{challengeId}/ranking" },
  { path: "/api/v1/announcements/{announcementId}/revisions", source: "announcements/{announcementId}/revisions" },
] as const;
const publicRoutes = [
  ...PUBLIC_GAME_PATHS,
  { path: "/api/v1/songs/{songId}/ranking", source: "music/{songId}/ranking" },
  { path: "/api/v1/players/{profileId}/cards/{page}.png", source: "ranking/profile/{profileId}/card/{page}" },
  { path: "/api/v1/announcements/{announcementId}/live", source: "announcements/{announcementId}" },
  { path: "/api/v1/announcements/views/live", source: "announcements" },
].map(entry => ({ ...entry, pattern: new RegExp(`^${entry.path.replaceAll(".", "\\.").replace(/\{[^}]+\}/gu, "([0-9]{1,19})")}$`, "u") }));
export async function handlePublicGameApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const entry = publicRoutes.find(route => route.pattern.test(url.pathname));
  if (!entry) return null;
  const announcement = entry.path === "/api/v1/announcements/{announcementId}/live";
  const announcementList = entry.source === "announcements";
  if (announcementList && url.searchParams.has("category") && url.searchParams.get("category") !== "ALL") return null;
  const canFallback = !PUBLIC_GAME_PATHS.some(route => route.path === entry.path) && !(announcement && url.searchParams.has("revision"));
  let index = 1;
  const captures = entry.pattern.exec(url.pathname)!;
  const sourcePath = entry.source.replace(/\{[^}]+\}/gu, () => captures[index++]!);
  const headers = new Headers({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Accept, If-None-Match",
    "Access-Control-Expose-Headers": "ETag, Retry-After, X-Fetched-At, X-Server-Time, X-Stale, X-Refreshing, X-Revision, X-Listed, X-Final-Quality, X-Collect-Status, X-Request-Id",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  const fail = (status: number, code: string) => {
    const requestId = crypto.randomUUID();
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: { code, message: status === 404 ? "Game data not found" : status === 400 ? "Invalid request" : status === 405 ? "Use GET or HEAD" : "Game data is unavailable", requestId } }), { status, headers: new Headers([...headers, ["Content-Type", "application/json"], ["X-Request-Id", requestId]]) });
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!["GET", "HEAD"].includes(request.method)) { headers.set("Allow", "GET, HEAD, OPTIONS"); return fail(405, "method_not_allowed"); }
  for (const [name, value] of url.searchParams) {
    if (url.searchParams.getAll(name).length !== 1 || !(name === "region" && ["jp", "tw", "en", "kr"].includes(value)) && !(announcementList && name === "category" && value === "ALL") && !(announcement && name === "revision" && /^[0-9]{1,19}$/u.test(value))) return fail(400, "invalid_request");
  }
  const region = url.searchParams.get("region");
  if (!region || !["jp", "tw", "en", "kr"].includes(region)) return fail(400, "invalid_request");
  const target = new URL(`https://api.bdon.moe/api/v1/${region}/${sourcePath}`);
  if (url.searchParams.has("revision")) target.searchParams.set("rev", url.searchParams.get("revision")!);
  try {
    const upstream = await fetch(target, { redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      headers: { Accept: request.headers.get("Accept") || "application/json", ...(request.headers.has("If-None-Match") ? { "If-None-Match": request.headers.get("If-None-Match")! } : {}) } });
    if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) { await upstream.body?.cancel(); return fail(502, "data_unavailable"); }
    for (const name of ["Content-Type", "ETag", "Retry-After", "X-Fetched-At", "X-Server-Time", "X-Stale", "X-Refreshing", "X-Revision", "X-Listed", "X-Final-Quality", "X-Collect-Status"]) {
      const value = upstream.headers.get(name); if (value) headers.set(name, value);
    }
    if (!upstream.ok && upstream.status !== 304) { await upstream.body?.cancel(); if (canFallback && ([401, 403, 404].includes(upstream.status) || upstream.status >= 500)) return null; return fail(upstream.status, upstream.status === 404 ? "not_found" : upstream.status === 400 ? "invalid_request" : upstream.status === 429 ? "rate_limit_exceeded" : "data_unavailable"); }
    headers.set("Cache-Control", upstream.headers.get("Cache-Control") || "public, max-age=60, must-revalidate");
    if (request.method === "HEAD") { await upstream.body?.cancel(); return new Response(null, { status: upstream.status, headers }); }
    if (!upstream.body || upstream.status === 304) return new Response(null, { status: upstream.status, headers });
    let size = 0;
    return new Response(upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(bytes, controller) { size += bytes.byteLength; if (size > 16 * 1024 * 1024) throw new RangeError("response_too_large"); controller.enqueue(bytes); } })), { status: upstream.status, headers });
  } catch (error) {
    if (request.signal.aborted) throw error;
    if (canFallback) return null;
    return fail(504, "data_timeout");
  }
}
