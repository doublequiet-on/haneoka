// L3 — GEB
// Input: Scoped page-data requests, deployed producer registration and public resource reads.
// Output: Revalidated descriptors or immutable selector-verified page envelopes.
// Pos: [Map](L2.md); page snapshot HTTP adapter.
// Effects/Dependencies: R2 and ASSETS reads are supplied by the request composition root.
import {
  PAGE_CONTRACT,
  PAGE_SCOPE,
  PAGE_MAX_BYTES,
  PAGE_KINDS,
  PageDataError,
  canonicalPageJson,
  pageDigest,
  pageRecord,
  pageHash,
  validPageSelector,
  type PageSource,
  type PageProducer,
  readPageObject,
} from "../src/lib/catalog-page-contract";
import { currentPage, fixedPage, type PageReader } from "../src/lib/catalog-page-reader";
import { readChartPage, validateChartPage } from "../src/lib/catalog-page-computed";

export interface PageDataBindings {
  read(key: string): Promise<Uint8Array | null>;
  producer(): Promise<unknown>;
  vector(): Promise<PageSource[]>;
}
export function validatePageProducer(value: unknown): PageProducer {
  if (
    !pageRecord(value) ||
    value.contract !== PAGE_CONTRACT ||
    !pageHash(value.projectorRevision) ||
    !Array.isArray(value.enabledKinds) ||
    !value.enabledKinds.every((kind) => PAGE_KINDS.includes(kind)) ||
    typeof value.engineCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.engineCommit) ||
    value.computationRecipe !== "chart-rates-v6"
  )
    throw new PageDataError("contract_unsupported", 409);
  return value as unknown as PageProducer;
}

export async function handlePageData(request: Request, bindings: PageDataBindings): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.searchParams.get("projection") !== "page-data") return null;
  const match = /^\/api\/v1\/servers\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) return null;
  try {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    if (
      url.searchParams.get("contract") !== PAGE_CONTRACT ||
      [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
    )
      throw new PageDataError("contract_unsupported", 409);
    const discover = match[2] === "release";
    if (discover && match[3]) throw new PageDataError("contract_unsupported", 409);
    if (url.searchParams.has("computed") && url.searchParams.get("computed") !== "chartRates")
      throw new PageDataError("contract_unsupported", 409);
    let id = discover ? url.searchParams.get("id") : match[3];
    if (!discover && id) {
      try {
        id = decodeURIComponent(id);
      } catch {
        throw new PageDataError("contract_unsupported", 409);
      }
    }
    const selector = {
      server: match[1],
      locale: url.searchParams.get("locale"),
      resource: discover ? url.searchParams.get("resource") : match[2],
      ...(id ? { id } : {}),
    };
    if (!validPageSelector(selector)) throw new PageDataError("contract_unsupported", 409);
    const producer = validatePageProducer(await bindings.producer());
    if (!producer.enabledKinds.includes(selector.resource)) throw new PageDataError("contract_unsupported", 409);
    const identity: PageReader["identity"] = {
      contract: PAGE_CONTRACT,
      scope: PAGE_SCOPE,
      projectorRevision: producer.projectorRevision,
    };
    const reader: PageReader = {
      read: bindings.read,
      identity,
      context: async () => ({ ...identity, resourceVector: await bindings.vector() }),
    };
    let value: unknown = discover
      ? await currentPage(reader, selector)
      : await fixedPage(
          reader,
          selector,
          url.searchParams.get("snapshot") || "",
          url.searchParams.get("release") || "",
        );
    if (selector.resource === "songs" && pageRecord(value) && Array.isArray(value.resourceVector)) {
      const source = (value.resourceVector as PageSource[]).find((row) => row.server === selector.server);
      if (source?.state !== "published") throw new PageDataError("page_data_incomplete", 503);
      const pin = { server: source.server, releaseId: source.releaseId, sourceId: source.sourceId };
      const ref = await readChartPage(bindings.read, pin, producer);
      if (url.searchParams.get("computed") === "chartRates") {
        if (discover || !ref) throw new PageDataError("page_data_incomplete", 503);
        value = validateChartPage(await readPageObject(bindings.read, ref), pin, producer);
      } else if (discover && value.state === "ready" && pageRecord(value.page)) {
        value.computed = {
          chartRates: ref
            ? {
                state: "ready",
                page: { ...ref, url: `${value.page.url}&computed=chartRates` },
                engineCommit: producer.engineCommit,
                recipe: producer.computationRecipe,
              }
            : { state: "pending" },
        };
      }
    } else if (url.searchParams.has("computed")) throw new PageDataError("contract_unsupported", 409);
    const body = new TextEncoder().encode(canonicalPageJson(value));
    if (body.length > PAGE_MAX_BYTES) throw new PageDataError("page_data_incomplete", 503);
    const etag = `"${await pageDigest(body)}"`;
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": discover ? "private, no-cache, must-revalidate" : "public, max-age=31536000, immutable",
      etag,
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : body, { headers });
  } catch (error) {
    if (!(error instanceof PageDataError)) throw error;
    return Response.json({ error: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
  }
}
