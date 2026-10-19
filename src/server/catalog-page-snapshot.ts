// L3 — GEB
// Input: Pinned public vector, shared page projectors and immutable object storage.
// Output: Complete verified snapshots; readiness is written only after a remote readback.
// Pos: [Map](L2-2.md); page snapshot production and publication.
// Effects/Dependencies: Caller supplies immutable storage and fixed-input projectors.
import {
  PAGE_CONTRACT,
  PAGE_LOCALES,
  PAGE_KINDS,
  PageDataError,
  canonicalPageJson,
  pageSnapshotId,
  pageDigest,
  pageBlobKey,
  pageReadyKey,
  pageIndexKey,
  readPageObject,
  validatePageManifest,
  validatePageIndex,
  validatePageEnvelope,
  validPageSelector,
  type PageContext,
  type PageSelector,
  type PageRef,
  type PageManifest,
  type PageReady,
} from "../lib/catalog-page-contract";
import { crossCatalogRows } from "../lib/cross-server/definitions";

export interface PageObjectStore {
  read(key: string): Promise<Uint8Array | null>;
  /** Must reject a different existing body; creating the same body is idempotent. */
  create(key: string, body: Uint8Array): Promise<void>;
}
export interface PageProjectors {
  ids(server: PageSelector["server"], resource: PageSelector["resource"]): Promise<string[]>;
  collection(selector: PageSelector): Promise<unknown>;
  entity(selector: PageSelector & { id: string }): Promise<unknown>;
}

async function putObject(store: PageObjectStore, value: unknown): Promise<PageRef> {
  const body = new TextEncoder().encode(canonicalPageJson(value));
  const ref = { sha256: await pageDigest(body), bytes: body.byteLength };
  await store.create(pageBlobKey(ref), body);
  return ref;
}

export async function verifyPageSnapshot(
  store: PageObjectStore,
  ready: PageReady,
  context: PageContext,
): Promise<PageManifest> {
  const snapshotId = await pageSnapshotId(context);
  if (ready.contract !== PAGE_CONTRACT || ready.snapshotId !== snapshotId)
    throw new PageDataError("page_data_incomplete", 503);
  const manifest = await validatePageManifest(await readPageObject(store.read.bind(store), ready.manifest), context);
  const idsByResource = new Map<string, string>();
  for (const [key, ref] of Object.entries(manifest.indexes)) {
    const [server, locale, resource] = key.split("/");
    const selector = { server, locale, resource };
    if (!validPageSelector(selector)) throw new PageDataError("page_data_incomplete", 503);
    const index = validatePageIndex(await readPageObject(store.read.bind(store), ref), selector);
    const ids = canonicalPageJson(Object.keys(index.entities).sort());
    const setKey = `${server}/${resource}`;
    if (idsByResource.has(setKey) && idsByResource.get(setKey) !== ids)
      throw new PageDataError("page_data_incomplete", 503);
    idsByResource.set(setKey, ids);
    const collection = await validatePageEnvelope(
      await readPageObject(store.read.bind(store), index.collection),
      context,
      selector,
    );
    const document = (collection.payload as { document: unknown }).document;
    if (canonicalPageJson(Object.keys(crossCatalogRows(selector.resource, document)).sort()) !== ids)
      throw new PageDataError("page_data_incomplete", 503);
    for (const [id, entity] of Object.entries(index.entities))
      await validatePageEnvelope(await readPageObject(store.read.bind(store), entity), context, { ...selector, id });
  }
  return manifest;
}

export async function buildPageSnapshot(
  store: PageObjectStore,
  context: PageContext,
  project: PageProjectors,
): Promise<PageReady> {
  const snapshotId = await pageSnapshotId(context);
  const indexes: Record<string, PageRef> = {};
  const putPage = async (selector: PageSelector, payload: unknown) => {
    const envelope = { ...context, snapshotId, selector, payload };
    await validatePageEnvelope(envelope, context, selector);
    return putObject(store, envelope);
  };
  for (const pin of context.resourceVector) {
    if (pin.state !== "published") continue;
    for (const resource of PAGE_KINDS) {
      const ids = (await project.ids(pin.server, resource)).slice().sort();
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !validPageSelector({ server: pin.server, locale: "en", resource, id }))
      )
        throw new PageDataError("page_data_incomplete", 503);
      for (const locale of PAGE_LOCALES) {
        const selector = { server: pin.server, locale, resource };
        const collection = await putPage(selector, await project.collection(selector));
        const entities: Record<string, PageRef> = Object.create(null);
        for (const id of ids)
          entities[id] = await putPage({ ...selector, id }, await project.entity({ ...selector, id }));
        indexes[pageIndexKey(selector)] = await putObject(store, { selector, collection, entities, count: ids.length });
      }
    }
  }
  const manifest = await putObject(store, {
    ...context,
    snapshotId,
    indexes,
    locales: PAGE_LOCALES,
    kinds: PAGE_KINDS,
  });
  const ready = { contract: PAGE_CONTRACT, snapshotId, manifest } as const;
  await verifyPageSnapshot(store, ready, context);
  return ready;
}

export async function publishPageSnapshot(
  source: PageObjectStore,
  target: PageObjectStore,
  ready: PageReady,
  context: PageContext,
): Promise<void> {
  const manifest = await verifyPageSnapshot(source, ready, context);
  const refs = new Map<string, PageRef>([[ready.manifest.sha256, ready.manifest]]);
  for (const [key, ref] of Object.entries(manifest.indexes)) {
    refs.set(ref.sha256, ref);
    const [server, locale, resource] = key.split("/");
    const selector = { server, locale, resource };
    if (!validPageSelector(selector)) throw new PageDataError("page_data_incomplete", 503);
    const index = validatePageIndex(await readPageObject(source.read.bind(source), ref), selector);
    for (const body of [index.collection, ...Object.values(index.entities)]) refs.set(body.sha256, body);
  }
  for (const ref of refs.values()) {
    const body = await source.read(pageBlobKey(ref));
    if (!body || body.byteLength !== ref.bytes || (await pageDigest(body)) !== ref.sha256)
      throw new PageDataError("page_data_incomplete", 503);
    await target.create(pageBlobKey(ref), body);
  }
  await verifyPageSnapshot(target, ready, context);
  await target.create(pageReadyKey(ready.snapshotId), new TextEncoder().encode(canonicalPageJson(ready)));
}
