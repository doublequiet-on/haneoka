// L3 — GEB
// Input: Exact reader revision, authoritative public vector, selector and object reads.
// Output: Small current descriptors and verified immutable page bodies.
// Pos: [Map](L2-2.md); shared page snapshot lookup for HTTP adapters.
// Effects/Dependencies: Reads only the selected index and content-addressed objects.
import {
  PAGE_CONTRACT,
  PageDataError,
  pageSnapshotId,
  pageReadyKey,
  pageIndexKey,
  pageRecord,
  validPageRef,
  validPageSelector,
  readPageObject,
  validatePageManifest,
  validatePageIndex,
  validatePageEnvelope,
  type PageContext,
  type PageSelector,
  type PageDescriptor,
  type PageSource,
} from "./catalog-page-contract";

export interface PageReader {
  read(key: string): Promise<Uint8Array | null>;
  identity: Pick<PageContext, "contract" | "scope" | "projectorRevision">;
  context(): Promise<PageContext>;
}

export async function resolvePage(
  reader: PageReader,
  context: PageContext,
  selector: PageSelector,
): Promise<PageDescriptor | null> {
  if (!validPageSelector(selector)) throw new PageDataError("contract_unsupported", 409);
  const snapshotId = await pageSnapshotId(context);
  const pin = context.resourceVector.find((source) => source.server === selector.server);
  if (pin?.state === "inactive") throw new PageDataError("resource_unavailable", 404);
  if (!pin) throw new PageDataError("source_unavailable", 503);
  const bytes = await reader.read(pageReadyKey(snapshotId));
  if (!bytes) return null;
  let ready: unknown;
  try {
    ready = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PageDataError("page_data_incomplete", 503);
  }
  if (
    !pageRecord(ready) ||
    ready.contract !== PAGE_CONTRACT ||
    ready.snapshotId !== snapshotId ||
    !validPageRef(ready.manifest)
  )
    throw new PageDataError("page_data_incomplete", 503);
  const manifest = await validatePageManifest(await readPageObject(reader.read, ready.manifest), context);
  const index = validatePageIndex(
    await readPageObject(reader.read, manifest.indexes[pageIndexKey(selector)]!),
    selector,
  );
  const ref =
    selector.id === undefined
      ? index.collection
      : Object.hasOwn(index.entities, selector.id)
        ? index.entities[selector.id]
        : undefined;
  if (!ref) throw new PageDataError("entity_absent", 404);
  const params = new URLSearchParams({
    projection: "page-data",
    contract: PAGE_CONTRACT,
    locale: selector.locale,
    release: pin.releaseId,
    snapshot: snapshotId,
  });
  const url = `/api/v1/servers/${selector.server}/${selector.resource}${selector.id === undefined ? "" : `/${encodeURIComponent(selector.id)}`}?${params}`;
  return {
    ...context,
    state: "ready",
    snapshotId,
    selector,
    page: { ...ref, url },
    computed: {
      chartRates: selector.resource === "songs" ? { state: "pending" } : { state: "unavailable", reason: "not-song" },
    },
  };
}

export async function currentPage(
  reader: PageReader,
  selector: PageSelector,
): Promise<PageDescriptor | { state: "pending"; contract: typeof PAGE_CONTRACT }> {
  return (await resolvePage(reader, await reader.context(), selector)) ?? { state: "pending", contract: PAGE_CONTRACT };
}

/** Fixed reads use the immutable ready manifest's context, never a current pointer. */
export async function fixedPage(reader: PageReader, selector: PageSelector, snapshotId: string, releaseId: string) {
  if (!/^[a-f0-9]{64}$/u.test(snapshotId)) throw new PageDataError("contract_unsupported", 409);
  const bytes = await reader.read(pageReadyKey(snapshotId));
  if (!bytes) throw new PageDataError("page_data_incomplete", 503);
  let ready: unknown;
  try {
    ready = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PageDataError("page_data_incomplete", 503);
  }
  if (
    !pageRecord(ready) ||
    ready.contract !== PAGE_CONTRACT ||
    ready.snapshotId !== snapshotId ||
    !validPageRef(ready.manifest)
  )
    throw new PageDataError("page_data_incomplete", 503);
  const manifest = await readPageObject(reader.read, ready.manifest);
  if (!pageRecord(manifest)) throw new PageDataError("page_data_incomplete", 503);
  const context = manifest as unknown as PageContext;
  await validatePageManifest(manifest, context);
  if ((await pageSnapshotId(context)) !== snapshotId) throw new PageDataError("page_data_incomplete", 503);
  const active = reader.identity;
  if (
    context.contract !== active.contract ||
    context.projectorRevision !== active.projectorRevision ||
    context.scope !== active.scope
  )
    throw new PageDataError("contract_unsupported", 409);
  const pin = context.resourceVector.find((source: PageSource) => source.server === selector.server);
  if (pin?.state !== "published" || pin.releaseId !== releaseId) throw new PageDataError("contract_unsupported", 409);
  const descriptor = await resolvePage(reader, context, selector);
  if (!descriptor) throw new PageDataError("page_data_incomplete", 503);
  return validatePageEnvelope(await readPageObject(reader.read, descriptor.page), context, selector);
}
