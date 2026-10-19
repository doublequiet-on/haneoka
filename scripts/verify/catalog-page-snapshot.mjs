// L3 — GEB
// Input: Declared complete public vectors and in-memory immutable stores.
// Output: Publication, corruption, rollback and fixed-selector acceptance assertions.
// Pos: [Map](L2-2.md); offline page snapshot boundary checks.
// Effects/Dependencies: Executes production TypeScript with Node hooks; no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts") && !specifier.endsWith(".ts"))
      specifier += ".ts";
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts"))
      return {
        format: "module",
        source: stripTypeScriptTypes(fs.readFileSync(new URL(url), "utf8"), { mode: "transform" }),
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const contract = await import("../../src/lib/catalog-page-contract.ts");
const { buildPageSnapshot, publishPageSnapshot } = await import("../../src/server/catalog-page-snapshot.ts");
const { currentPage, fixedPage } = await import("../../src/lib/catalog-page-reader.ts");
const { handlePageData } = await import("../../worker/catalog-page-data.ts");
const { CatalogPageRefresh } = await import("../../src/lib/catalog-page-refresh.ts");
const { publishChartPage } = await import("../../src/lib/catalog-page-computed.ts");
class Store {
  objects = new Map();
  read = async (key) => this.objects.get(key)?.slice() ?? null;
  create = async (key, bytes) => {
    if (this.objects.has(key)) assert.deepEqual(this.objects.get(key), bytes, "immutable overwrite");
    this.objects.set(key, bytes.slice());
  };
}
const context = (revision) => ({
  contract: contract.PAGE_CONTRACT,
  scope: contract.PAGE_SCOPE,
  projectorRevision: "1".repeat(64),
  resourceVector: contract.PAGE_SERVERS.map((server) => ({
    state: "published",
    server,
    sourceId: revision,
    releaseId: `r-${(revision === "A" ? "a" : "b").repeat(20)}`,
  })),
});
const ids = (revision) => (revision === "A" ? ["1", "2"] : ["1", "3"]);
const project = (ctx) => {
  const pin = (selector) => {
    const source = ctx.resourceVector.find((source) => source.server === selector.server);
    return { server: source.server, sourceId: source.sourceId, releaseId: source.releaseId };
  };
  return {
    ids: async () => ids(ctx.resourceVector[0].sourceId),
    collection: async (selector) => ({
      schema: "haneoka-collection-payload-v1",
      identity: pin(selector),
      resource: selector.resource,
      document:
        selector.resource === "events"
          ? { entries: Object.fromEntries(ids(ctx.resourceVector[0].sourceId).map((id) => [id, { id }])) }
          : Object.fromEntries(ids(ctx.resourceVector[0].sourceId).map((id) => [id, { id }])),
    }),
    entity: async (selector) => ({
      schema: "haneoka-entity-payload-v1",
      ...pin(selector),
      resource: selector.resource,
      id: selector.id,
      item: { revision: ctx.resourceVector[0].sourceId },
    }),
  };
};
const remote = new Store();
let active = context("A");
const reader = { read: remote.read, identity: context("A"), context: async () => active };
const selector = { server: "jp", locale: "en", resource: "cards", id: "2" };
assert.equal((await currentPage(reader, selector)).state, "pending");
const sourceA = new Store();
const readyA = await buildPageSnapshot(sourceA, active, project(active));
assert.equal(sourceA.objects.has(contract.pageReadyKey(readyA.snapshotId)), false);
await publishPageSnapshot(sourceA, remote, readyA, active);
const a = await currentPage(reader, selector);
assert.equal(a.state, "ready");
active = context("B");
assert.equal((await currentPage(reader, selector)).state, "pending");
assert.equal(
  (await fixedPage(reader, selector, a.snapshotId, context("A").resourceVector[0].releaseId)).payload.item.revision,
  "A",
);
assert.equal(
  (
    await fixedPage(
      {
        ...reader,
        context: async () => {
          throw new Error("Current source unavailable");
        },
      },
      selector,
      a.snapshotId,
      context("A").resourceVector[0].releaseId,
    )
  ).payload.item.revision,
  "A",
);
const sourceB = new Store();
const readyB = await buildPageSnapshot(sourceB, active, project(active));
const broken = new Store();
let writes = 0;
await assert.rejects(
  publishPageSnapshot(
    sourceB,
    {
      read: broken.read,
      create: async (key, body) => {
        if (++writes === 12) throw new Error("half upload");
        await broken.create(key, body);
      },
    },
    readyB,
    active,
  ),
);
assert.equal(broken.objects.has(contract.pageReadyKey(readyB.snapshotId)), false);
await publishPageSnapshot(sourceB, remote, readyB, active);
await assert.rejects(currentPage(reader, selector), (error) => error.code === "entity_absent");
assert.equal((await currentPage(reader, { ...selector, id: "3" })).state, "ready");
for (const server of contract.PAGE_SERVERS)
  for (const locale of contract.PAGE_LOCALES)
    for (const resource of contract.PAGE_KINDS) {
      const row = await currentPage(reader, { server, locale, resource, id: "1" });
      assert.equal(
        (
          await fixedPage(
            reader,
            row.selector,
            row.snapshotId,
            active.resourceVector.find((pin) => pin.server === server).releaseId,
          )
        ).payload.item.revision,
        "B",
      );
    }
await assert.rejects(
  fixedPage(reader, selector, readyB.snapshotId, context("A").resourceVector[0].releaseId),
  (error) => error.code === "contract_unsupported",
);
active = context("A");
assert.equal((await currentPage(reader, selector)).snapshotId, readyA.snapshotId);
const corrupt = new Store();
await assert.rejects(
  publishPageSnapshot(
    sourceA,
    { read: corrupt.read, create: async (key, body) => corrupt.create(key, new Uint8Array(body.length)) },
    readyA,
    active,
  ),
  (error) => error.code === "page_data_incomplete",
);
assert.equal(corrupt.objects.has(contract.pageReadyKey(readyA.snapshotId)), false);
const bad = project(active);
bad.entity = async (selector) => ({
  schema: "haneoka-entity-payload-v1",
  server: selector.server,
  sourceId: "wrong",
  releaseId: active.resourceVector[0].releaseId,
  resource: selector.resource,
  id: selector.id,
});
await assert.rejects(buildPageSnapshot(new Store(), active, bad), (error) => error.code === "page_data_incomplete");
const producer = {
  contract: contract.PAGE_CONTRACT,
  projectorRevision: active.projectorRevision,
  enabledKinds: contract.PAGE_KINDS,
  engineCommit: "c".repeat(40),
  computationRecipe: "chart-rates-v6",
  sourceSha: "d".repeat(40),
};
const bindings = { read: remote.read, vector: async () => active.resourceVector, producer: async () => producer };
const descriptorUrl =
  "https://fixture.invalid/api/v1/servers/jp/release?projection=page-data&contract=catalog-page-v1&locale=en&resource=cards&id=1";
const response = await handlePageData(new Request(descriptorUrl), bindings);
assert.equal(response.status, 200);
assert.equal(
  (
    await handlePageData(
      new Request(descriptorUrl, { headers: { "if-none-match": response.headers.get("etag") } }),
      bindings,
    )
  ).status,
  304,
);
assert.equal(
  (await handlePageData(new Request(descriptorUrl.replace("catalog-page-v1", "unknown")), bindings)).status,
  409,
);
let requests = 0,
  commits = 0,
  displayed,
  present = true,
  visible = true;
let afterPrepare;
const reports = [];
const client = new CatalogPageRefresh({
  selector: () => ({ ...selector, id: "1" }),
  active: () => visible,
  fetch: async (url, init) => {
    requests++;
    return handlePageData(new Request(new URL(url, "https://fixture.invalid"), init), bindings);
  },
  prepare: async (page) => {
    await afterPrepare?.();
    return () => {
      commits++;
      displayed = page.payload.item.revision;
    };
  },
  absent: () => {
    present = false;
  },
  report: (state) => reports.push(state),
});
await client.check();
assert.equal(displayed, "A");
assert.equal(commits, 1);
assert.equal(requests, 3);
requests = 0;
await client.check();
assert.equal(requests, 1);
assert.equal(commits, 1);
active = context("B");
afterPrepare = async () => {
  active = context("A");
};
await client.check();
assert.equal(commits, 1);
assert.equal(displayed, "A");
active = context("B");
afterPrepare = async () => {
  client.cancel();
};
await client.check();
assert.equal(commits, 1);
afterPrepare = undefined;
await client.check();
assert.equal(displayed, "B");
assert.equal(commits, 2);
active = context("A");
await client.check();
assert.equal(displayed, "A");
assert.equal(commits, 3);
visible = false;
requests = 0;
await client.check();
assert.equal(requests, 0);
assert.equal(present, true);
visible = true;
let deletionCommits = 0,
  deleted = false;
const deletedClient = new CatalogPageRefresh({
  selector: () => selector,
  active: () => true,
  fetch: async (url, init) => handlePageData(new Request(new URL(url, "https://fixture.invalid"), init), bindings),
  prepare: async () => () => {
    deletionCommits++;
    deleted = false;
  },
  absent: () => {
    deleted = true;
  },
  report: () => {},
});
await deletedClient.check();
assert.equal(deletionCommits, 1);
active = context("B");
await deletedClient.check();
assert.equal(deleted, true);
active = context("A");
await deletedClient.check();
assert.equal(deleted, false);
assert.equal(deletionCommits, 2);
assert.equal(
  (await handlePageData(new Request(descriptorUrl.replace("/release?", "/release/extra?")), bindings)).status,
  409,
);
assert.equal(
  (await handlePageData(new Request(descriptorUrl.replace("/release?", "/cards/%ZZ?")), bindings)).status,
  409,
);
let chartState,
  chartCommits = 0;
const songClient = new CatalogPageRefresh({
  selector: () => ({ ...selector, resource: "songs", id: "1" }),
  active: () => true,
  fetch: async (url, init) => {
    requests++;
    return handlePageData(new Request(new URL(url, "https://fixture.invalid"), init), bindings);
  },
  prepare: async () => () => {
    chartCommits++;
  },
  absent: () => assert.fail("Unexpected deletion"),
  report: () => {},
  computed: (state) => {
    chartState = state;
  },
});
await songClient.check();
assert.equal(chartState, "pending");
const chartPin = { server: "jp", releaseId: active.resourceVector[0].releaseId, sourceId: "A" };
const table = {
  schema: "haneoka-chart-rates-v6",
  sourceId: "A",
  releaseId: chartPin.releaseId,
  engineCommit: producer.engineCommit,
  charts: {},
};
await publishChartPage(remote, chartPin, producer, table);
requests = 0;
await songClient.check();
assert.equal(chartState, "ready");
assert.equal(chartCommits, 1);
assert.equal(requests, 3);
requests = 0;
await songClient.check();
assert.equal(requests, 1);
await assert.rejects(
  publishChartPage(remote, { ...chartPin, sourceId: "B" }, producer, table),
  (error) => error.code === "page_data_incomplete",
);
console.log(
  JSON.stringify({
    scenarios: [
      "complete-40-indexes",
      "pending",
      "fixed-old-release",
      "fixed-read-current-source-unavailable",
      "half-upload",
      "modified",
      "added",
      "deleted",
      "rollback",
      "wrong-release",
      "corrupt-readback",
      "wrong-source",
      "etag-and-unsupported-route",
      "client-prepare-race-and-cancellation",
      "client-hidden-no-fetch",
      "client-delete-rollback",
      "computed-pending-ready-without-core-recommit",
      "unchanged-single-descriptor-request",
    ],
    objects: remote.objects.size,
  }),
);
