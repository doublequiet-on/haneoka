// L3 — GEB
// Input: Declared A/B entity fixtures and the pre-extraction Astro implementation.
// Output: Full projector equivalence, immutable bases and core computation isolation.
// Pos: [Map](L2-2.md); offline final page projection acceptance.
// Effects/Dependencies: Evaluates real projector code with explicit data-reader fixtures; no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

const calls = { charts: 0 };
let revision = "A";
const bases = new Map();
const pin = (server) => ({ server, sourceId: `source-${revision}`, releaseId: `release-${revision}` });
function base(server, resource, id) {
  const key = JSON.stringify([revision, server, resource, id]);
  if (!bases.has(key))
    bases.set(key, {
      schema: "haneoka-entity-payload-v1",
      ...pin(server),
      resource,
      id,
      item: { id, musicId: Number(id), power: revision === "A" ? 100 : 120 },
      aux: {},
      characters: [],
      bands: [],
      marks: {},
      gameItems: [],
    });
  return bases.get(key);
}
const readers = {
  catalogEntityData: async (server, resource, id) => base(server, resource, id),
  staticCatalogRelease: async (server) => pin(server),
  fetchStaticCatalog: async (route, server, identity) => {
    assert.deepEqual(identity, pin(server));
    return { route, server };
  },
  loadStaticCrossServerEntry: async (resource, server, locale, id) => ({
    sourceAvailability: { jp: "loaded", intl: "loaded" },
    entries: [{ perServer: { [server]: { id, identity: pin(server) } }, exclusive: null, locale }],
  }),
  loadCrossServerDetail: async (entry, server) => ({
    failures: [],
    identity: pin(server),
    locale: entry.locale,
    value: revision,
  }),
  isCrossCatalogResource: (resource) => ["cards", "support-cards", "events", "songs", "characters"].includes(resource),
  chartRates: async (server) => {
    calls.charts++;
    return { ...pin(server), greatFactor: 0.8, charts: { "1:3": { base: 12 }, "2:3": { base: 13 } } };
  },
};
globalThis.__projectorFixture = readers;
const modules = {
  "static-catalog-source": ["staticCatalogRelease", "fetchStaticCatalog"],
  "entity-graph": ["catalogEntityData"],
  "chart-rates": ["chartRates"],
  "cross-server/static": ["loadStaticCrossServerEntry"],
  "cross-server/detail": ["loadCrossServerDetail"],
  "cross-server/definitions": ["isCrossCatalogResource"],
};
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/catalog-page-projector.ts")) {
      const entry = Object.entries(modules).find(([suffix]) => specifier.endsWith(suffix));
      if (entry)
        return {
          url: `data:text/javascript,${encodeURIComponent(entry[1].map((name) => `export const ${name}=globalThis.__projectorFixture.${name};`).join("\n"))}`,
          shortCircuit: true,
        };
    }
    return next(specifier, context);
  },
});
const { catalogPageData } = await import("../../src/server/catalog-page-projector.ts");
const { source: block } = JSON.parse(
  fs.readFileSync(new URL("./fixtures/catalog-page-legacy.json", import.meta.url), "utf8"),
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const legacy = new AsyncFunction(
  ...Object.keys(readers),
  "server",
  "page",
  "locale",
  stripTypeScriptTypes(block) + "\nreturn payload;",
);
let comparisons = 0;
for (const selected of ["A", "B", "A"]) {
  revision = selected;
  for (const server of ["jp", "intl"])
    for (const resource of ["cards", "support-cards", "events", "songs", "characters"]) {
      for (const locale of ["en", "ja", "ko", "zh-CN", "zh-TW"]) {
        const isolated = { ...readers, catalogEntityData: async (...args) => structuredClone(base(...args)) };
        const expected = await legacy(...Object.values(isolated), server, { resource, id: "1" }, locale);
        const actual = await catalogPageData(server, resource, "1", locale, "full");
        assert.deepEqual(actual, expected);
        assert.deepEqual(base(server, resource, "1").aux, {});
        comparisons++;
      }
    }
}
const before = calls.charts;
await catalogPageData("jp", "songs", "1", "ja", "core", base("jp", "songs", "1"));
assert.equal(calls.charts, before);
console.log(
  JSON.stringify({
    comparisons,
    fullPayloadEquivalent: true,
    baseUnchanged: true,
    coreChartCalls: 0,
    inputs: "declared reader fixtures; not real release equivalence",
  }),
);
