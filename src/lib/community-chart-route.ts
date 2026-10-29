// L3 — GEB
// Input: locale, community chart identity and old or canonical document URL.
// Output: Cross-server chart paths, legacy redirects, shell lookup and preview metadata.
// Pos: [Map](L2-2.md); shared by browser, static rendering and request handlers.
// Effects/Dependencies: Pure URL and HTML transformations; no network or storage.
const LOCALE = "(?:ja|en|zh-TW|zh-CN|ko)";
const CHART_ID = "[0-9a-f-]{36}";
const DOCUMENT = new RegExp(`^/(${LOCALE})/community/charts/(${CHART_ID})(/chart)?/?$`, "u");
const LEGACY = new RegExp(`^/(?:(?:jp|intl)/)?(${LOCALE})/charts(?:/(${CHART_ID})(/chart)?)?/?$`, "u");

export function communityChartPath(_server: string, locale: string, id = ""): string {
  return `/${locale}/community/charts/${id ? `${encodeURIComponent(id)}/` : ""}`;
}
export function communityChartPlayerPath(server: string, locale: string, id: string): string {
  return `${communityChartPath(server, locale, id)}chart/`;
}
export function parseCommunityChartDocument(pathname: string) {
  const match = DOCUMENT.exec(pathname);
  return match ? { locale: match[1]!, id: match[2]!, player: !!match[3] } : undefined;
}
export function legacyCommunityChartRedirectTarget(pathname: string, search = ""): string | undefined {
  const match = LEGACY.exec(pathname);
  if (!match) return undefined;
  return `${communityChartPath("", match[1]!, match[2])}${match[3] ? "chart/" : ""}${search}`;
}
export function communityChartShellPath(pathname: string): string | undefined {
  const route = parseCommunityChartDocument(pathname);
  return route ? `/${route.locale}/community/charts/_/` : undefined;
}

/** The shared shell has different metadata for each chart document. */
export function communityChartDocumentEtag(etag: string, pathname: string): string {
  const route = parseCommunityChartDocument(pathname);
  return route ? etag.replace(/"$/u, `:chart-${route.locale}-${route.id}-${route.player ? "player" : "detail"}"`) : etag;
}

/** Point the entity shell's WebPage and final breadcrumb at the requested chart. */
export function rewriteCommunityChartStructuredData(body: string, pathname: string, origin: string): string {
  const route = parseCommunityChartDocument(pathname);
  if (!route) return body;
  const url = `${origin}${route.player ? communityChartPlayerPath("", route.locale, route.id) : communityChartPath("", route.locale, route.id)}`;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    console.warn("Invalid community chart structured data", error);
    return body;
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { "@graph"?: unknown })["@graph"])) return body;
  for (const entry of (data as { "@graph": Array<Record<string, unknown>> })["@graph"]) {
    if (!entry || typeof entry !== "object") continue;
    if (entry["@type"] === "WebPage") {
      entry.url = url;
      entry["@id"] = `${url}#page`;
    } else if (entry["@type"] === "BreadcrumbList") {
      entry["@id"] = `${url}#breadcrumb`;
      const items = entry.itemListElement;
      const last = Array.isArray(items) ? items.at(-1) : undefined;
      if (last && typeof last === "object") last.item = url;
    }
  }
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

/** Rewrite metadata of the shared entity shell for a concrete chart URL. */
export function rewriteCommunityChartDocument(html: string, pathname: string, origin: string): string {
  const route = parseCommunityChartDocument(pathname);
  if (!route) return html;
  const path = (locale: string) => route.player
    ? communityChartPlayerPath("", locale, route.id)
    : communityChartPath("", locale, route.id);
  const canonical = `${origin}${path(route.locale)}`;
  return html.replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
    (script, body: string) => script.replace(body, rewriteCommunityChartStructuredData(body, pathname, origin)))
    .replace(/<(?:link|meta)\b[^>]*>/giu, (tag) => {
    const attribute = (name: string) => new RegExp(`\\b${name}=["']([^"']*)["']`, "iu").exec(tag)?.[1];
    const rel = attribute("rel");
    const property = attribute("property");
    const tagLocale = attribute("hreflang");
    const locale = tagLocale === "x-default" ? "en" : tagLocale === "ja-JP" ? "ja" : tagLocale;
    const value = rel === "canonical" || property === "og:url" ? canonical
      : rel === "alternate" && locale && new RegExp(`^${LOCALE}$`, "u").test(locale) ? `${origin}${path(locale)}` : undefined;
    if (!value) return tag;
    const key = property === "og:url" ? "content" : "href";
    return tag.replace(new RegExp(`(\\b${key}=)["'][^"']*["']`, "iu"), `$1"${value}"`);
  });
}
