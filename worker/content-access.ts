// L3 — GEB
// Input: 当前请求、账户会话与站点能力策略。
// Output: 当前会话的内容访问能力和策略版本。
// Pos: [Map](L2.md)；账号能力的私有只读接口。
// Effects/Dependencies: 复用会话和权限读取；响应禁止共享缓存。
import { contentSourceScope, readSiteSettings, testContentAllowed } from "./site-settings";

export async function handleContentAccessRequest(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/v1/account/content-access") return null;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Cookie, Authorization, Accept-Encoding",
  });
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Allow", "GET, HEAD");
    return new Response(JSON.stringify({ error: { code: "method_not_allowed" } }), { status: 405, headers });
  }
  const settings = await readSiteSettings(env);
  const allowed = await testContentAllowed(request, env, settings);
  const scope = allowed ? await contentSourceScope(env) : undefined;
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({ allowed, version: settings.version, ...scope }),
    { headers },
  );
}
