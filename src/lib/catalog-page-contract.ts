// L3 — GEB
// Input: Public resource vector, selectors and immutable page object references.
// Output: Shared producer, Worker and browser page-data contract validation.
// Pos: [Map](L2-2.md); version-pinned catalogue page transport.
// Effects/Dependencies: Web Crypto only; storage and HTTP are supplied by callers.
export const PAGE_CONTRACT = "catalog-page-v1";
export const PAGE_SCOPE = "public-jp-intl";
export const PAGE_SERVERS = ["jp", "intl"] as const;
export const PAGE_LOCALES = ["en", "ja", "ko", "zh-CN", "zh-TW"] as const;
export const PAGE_KINDS = ["cards", "support-cards", "events", "songs"] as const;
export const PAGE_MAX_BYTES = 64 * 1024 * 1024;
export const PAGE_PREFIX = "catalog-pages/v1";
export type PageServer = (typeof PAGE_SERVERS)[number];
export type PageKind = (typeof PAGE_KINDS)[number];
export type PageLocale = (typeof PAGE_LOCALES)[number];
export type PageSource =
  | { state: "published"; server: PageServer; sourceId: string; releaseId: string }
  | { state: "inactive"; server: PageServer };
export interface PageSelector {
  server: PageServer;
  locale: PageLocale;
  resource: PageKind;
  id?: string;
}
export interface PageRef {
  sha256: string;
  bytes: number;
}
export interface PageContext {
  contract: typeof PAGE_CONTRACT;
  scope: typeof PAGE_SCOPE;
  projectorRevision: string;
  resourceVector: PageSource[];
}
export interface PageEnvelope extends PageContext {
  snapshotId: string;
  selector: PageSelector;
  payload: unknown;
}
export interface PageIndex {
  selector: Omit<PageSelector, "id">;
  collection: PageRef;
  entities: Record<string, PageRef>;
  count: number;
}
export interface PageManifest extends PageContext {
  snapshotId: string;
  indexes: Record<string, PageRef>;
  locales: readonly string[];
  kinds: readonly string[];
}
export interface PageReady {
  contract: typeof PAGE_CONTRACT;
  snapshotId: string;
  manifest: PageRef;
}
export interface PageProducer {
  contract: typeof PAGE_CONTRACT;
  projectorRevision: string;
  sourceSha: string;
  engineCommit: string;
  computationRecipe: string;
  enabledKinds: PageKind[];
}
export type PageComputed =
  | { state: "pending" }
  | { state: "unavailable"; reason: "not-song" }
  | { state: "ready"; page: PageRef & { url?: string }; engineCommit: string; recipe: string };
export interface PageDescriptor extends PageContext {
  state: "ready";
  snapshotId: string;
  selector: PageSelector;
  page: PageRef & { url: string };
  computed: { chartRates: PageComputed };
}
export class PageDataError extends Error {
  readonly code:
    "contract_unsupported" | "entity_absent" | "resource_unavailable" | "source_unavailable" | "page_data_incomplete";
  readonly status: number;
  constructor(code: PageDataError["code"], status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const pageRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
export const pageHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export function canonicalPageJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPageJson).join(",")}]`;
  if (pageRecord(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalPageJson(value[key])}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Unsupported page JSON value");
  return encoded;
}
export async function pageDigest(body: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(body)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function validatePageVector(value: unknown): asserts value is PageSource[] {
  if (!Array.isArray(value) || value.length !== 2) throw new PageDataError("source_unavailable", 503);
  for (let i = 0; i < 2; i++) {
    const row = value[i];
    if (!pageRecord(row) || row.server !== PAGE_SERVERS[i] || !["published", "inactive"].includes(String(row.state)))
      throw new PageDataError("source_unavailable", 503);
    if (
      row.state === "published" &&
      (typeof row.releaseId !== "string" ||
        !/^r-[a-f0-9]{20}$/u.test(row.releaseId) ||
        typeof row.sourceId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(row.sourceId))
    )
      throw new PageDataError("source_unavailable", 503);
    if (
      Object.keys(row).sort().join() !==
      (row.state === "published" ? "releaseId,server,sourceId,state" : "server,state")
    )
      throw new PageDataError("source_unavailable", 503);
  }
}
export function validPageSelector(value: unknown): value is PageSelector {
  return (
    pageRecord(value) &&
    PAGE_SERVERS.includes(value.server as PageServer) &&
    PAGE_LOCALES.includes(value.locale as PageLocale) &&
    PAGE_KINDS.includes(value.resource as PageKind) &&
    (value.id === undefined || (typeof value.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,255}$/u.test(value.id)))
  );
}
export function validPageRef(value: unknown): value is PageRef {
  return (
    pageRecord(value) &&
    pageHash(value.sha256) &&
    Number.isSafeInteger(value.bytes) &&
    Number(value.bytes) > 0 &&
    Number(value.bytes) <= PAGE_MAX_BYTES
  );
}
export function validatePageContext(value: unknown): asserts value is PageContext {
  if (
    !pageRecord(value) ||
    value.contract !== PAGE_CONTRACT ||
    value.scope !== PAGE_SCOPE ||
    !pageHash(value.projectorRevision)
  )
    throw new PageDataError("page_data_incomplete", 503);
  validatePageVector(value.resourceVector);
}
export async function pageSnapshotId(context: PageContext): Promise<string> {
  validatePageContext(context);
  return pageDigest(
    new TextEncoder().encode(
      canonicalPageJson({
        contract: context.contract,
        scope: context.scope,
        projectorRevision: context.projectorRevision,
        resourceVector: context.resourceVector,
      }),
    ),
  );
}
export const pageIndexKey = (selector: PageSelector) => `${selector.server}/${selector.locale}/${selector.resource}`;
export const pageBlobKey = (ref: PageRef) => `${PAGE_PREFIX}/objects/${ref.sha256}.json`;
export const pageReadyKey = (snapshotId: string) => `${PAGE_PREFIX}/ready/${snapshotId}.json`;
export function pageExpectedIndexes(vector: PageSource[]): string[] {
  return vector
    .filter((row) => row.state === "published")
    .flatMap((row) =>
      PAGE_LOCALES.flatMap((locale) =>
        PAGE_KINDS.map((resource) => pageIndexKey({ server: row.server, locale, resource })),
      ),
    )
    .sort();
}
export async function readPageObject(
  read: (key: string) => Promise<Uint8Array | null>,
  ref: PageRef,
): Promise<unknown> {
  if (!validPageRef(ref)) throw new PageDataError("page_data_incomplete", 503);
  const body = await read(pageBlobKey(ref));
  if (!body || body.byteLength !== ref.bytes || (await pageDigest(body)) !== ref.sha256)
    throw new PageDataError("page_data_incomplete", 503);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new PageDataError("page_data_incomplete", 503);
  }
}
export async function validatePageManifest(value: unknown, context: PageContext): Promise<PageManifest> {
  validatePageContext(value);
  const row = value as PageManifest;
  if (
    (await pageSnapshotId(row)) !== (await pageSnapshotId(context)) ||
    row.snapshotId !== (await pageSnapshotId(context)) ||
    !pageRecord(row.indexes) ||
    canonicalPageJson(row.locales) !== canonicalPageJson(PAGE_LOCALES) ||
    canonicalPageJson(row.kinds) !== canonicalPageJson(PAGE_KINDS) ||
    canonicalPageJson(Object.keys(row.indexes).sort()) !==
      canonicalPageJson(pageExpectedIndexes(context.resourceVector)) ||
    !Object.values(row.indexes).every(validPageRef)
  )
    throw new PageDataError("page_data_incomplete", 503);
  return row;
}
export function validatePageIndex(value: unknown, selector: PageSelector): PageIndex {
  if (
    !pageRecord(value) ||
    !validPageSelector(value.selector) ||
    value.selector.id !== undefined ||
    pageIndexKey(value.selector) !== pageIndexKey(selector) ||
    !validPageRef(value.collection) ||
    !pageRecord(value.entities) ||
    value.count !== Object.keys(value.entities).length ||
    !Object.entries(value.entities).every(([id, ref]) => validPageSelector({ ...selector, id }) && validPageRef(ref))
  )
    throw new PageDataError("page_data_incomplete", 503);
  return value as unknown as PageIndex;
}
export async function validatePageEnvelope(
  value: unknown,
  context: PageContext,
  selector: PageSelector,
): Promise<PageEnvelope> {
  validatePageContext(value);
  const row = value as PageEnvelope;
  const pin = context.resourceVector.find((source) => source.server === selector.server);
  if (
    row.snapshotId !== (await pageSnapshotId(context)) ||
    (await pageSnapshotId(row)) !== row.snapshotId ||
    canonicalPageJson(row.selector) !== canonicalPageJson(selector) ||
    pin?.state !== "published" ||
    !pageRecord(row.payload)
  )
    throw new PageDataError("page_data_incomplete", 503);
  const own = selector.id === undefined ? row.payload.identity : row.payload;
  if (
    !pageRecord(own) ||
    own.server !== pin.server ||
    own.releaseId !== pin.releaseId ||
    own.sourceId !== pin.sourceId ||
    row.payload.resource !== selector.resource ||
    (selector.id !== undefined &&
      (row.payload.id !== selector.id || row.payload.schema !== "haneoka-entity-payload-v1")) ||
    (selector.id === undefined && row.payload.schema !== "haneoka-collection-payload-v1")
  )
    throw new PageDataError("page_data_incomplete", 503);
  return row;
}
export const chartPageReadyKey = (
  pin: { server: string; releaseId: string; sourceId: string },
  producer: Pick<PageProducer, "engineCommit" | "computationRecipe">,
) =>
  `${PAGE_PREFIX}/computed/${pin.server}/${pin.releaseId}/${pin.sourceId}/${producer.engineCommit}/${producer.computationRecipe}.json`;
