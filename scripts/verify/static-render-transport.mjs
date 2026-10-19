// L3 — GEB
// Input: Deterministic local render fixture; no game or production storage.
// Output: Equivalence, corruption rejection and separate transport measurements.
// Pos: [Map](L2-2.md); static render transport acceptance.
// Effects/Dependencies: Creates isolated temporary outputs; reads real locale source offline.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
// The tested modules need only these real, dependency-free locale exports.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@haneoka/i18n")
      return { url: new URL("../../packages/i18n/src/locales.ts", import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { sealRenderPartition, mergeRenderPartitions } = await import("../build/static-build-shards.mjs");
const { staticRenderPartitionForPath } = await import("../../src/server/static-build.ts");
const { sha256, INPUT_SCHEMA, listFiles } = await import("../build/static-build-inputs.mjs");
const { outputInventory, compareInventories, measureStage, fixtureIdentity, compressedFixtureBytes } =
  await import("../build/build-performance.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "haneoka-transport-"));
const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const json = (file, value) => write(file, JSON.stringify(value));
const locales = ["en", "ja", "ko", "zh-CN", "zh-TW"];
const common = Buffer.from(Array.from({ length: 16384 }, (_, i) => sha256(String(i))).join(""));
const inputsManifest = path.join(root, "frozen/manifest.json");
json(inputsManifest, {
  schema: INPUT_SCHEMA,
  entries: [
    { role: "common-assets", path: ".generated-public/fonts/common.bin", sha256: sha256(common), bytes: common.length },
    { role: "common-assets", path: ".generated-public/same-size.bin", sha256: sha256("old"), bytes: 3 },
  ],
});
write(path.join(root, "frozen/content", sha256(common)), common);
write(path.join(root, "frozen/content", sha256("old")), "old");
const routes = locales.flatMap((locale) =>
  Array.from({ length: 8 }, (_, id) => ({ locale, astroPathname: `/jp/${locale}/cards/${id}/index.html` })),
);
const planFile = path.join(root, "plan.json");
json(planFile, {
  schema: "haneoka-static-shard-plan-v1",
  locales,
  generation: { kind: "frozen-inputs", sha256: sha256(fs.readFileSync(inputsManifest)) },
  routes,
  expected: routes.map((row) => ({ pathname: row.astroPathname, locale: row.locale })),
});
const source = path.join(root, "source");
const reports = [];
for (const transport of ["legacy", "sparse"]) {
  const report = await measureStage(
    fixtureIdentity({ resources: { jp: "fixture-A", intl: "fixture-A" }, routes }),
    async () => {
      const seals = [];
      for (const locale of locales) {
        for (let index = 0; index < 4; index++) {
          const renderRoot = path.join(source, transport, `${locale}-${index}`);
          write(path.join(renderRoot, ".output/public/fonts/common.bin"), common);
          write(path.join(renderRoot, ".output/public/same-size.bin"), "new");
          write(path.join(renderRoot, ".output/public/_astro/client.js"), "export const value=1;");
          write(path.join(renderRoot, ".output/static-documents/documents.jsonl"), "");
          for (const row of routes.filter(
            (row) => row.locale === locale && staticRenderPartitionForPath(row.astroPathname, 4) === index,
          ))
            write(path.join(renderRoot, ".output/public", row.astroPathname.slice(1)), `<h1>${row.astroPathname}</h1>`);
          seals.push(
            await sealRenderPartition({
              root: renderRoot,
              locale,
              partition: `${index}/4`,
              planFile,
              output: path.join(root, transport, locale, String(index)),
              ...(transport === "sparse" ? { inputsManifest } : {}),
            }),
          );
        }
        await mergeRenderPartitions({
          planFile,
          locale,
          partsRoot: path.join(root, transport, locale),
          output: path.join(root, `${transport}-merged`, locale),
          ...(transport === "sparse" ? { inputsManifest } : {}),
        });
      }
      return { seals, gzipFixtureBytes: compressedFixtureBytes(path.join(root, transport)) };
    },
  );
  reports.push({ transport, ...report });
}
assert.deepEqual(
  compareInventories(
    await outputInventory(path.join(root, "legacy-merged")),
    await outputInventory(path.join(root, "sparse-merged")),
  ),
  [],
);
assert.equal(listFiles(path.join(root, "sparse")).filter((file) => file.endsWith("fonts/common.bin")).length, 0);
assert.equal(listFiles(path.join(root, "sparse")).filter((file) => file.endsWith("same-size.bin")).length, 20);
assert.equal(
  reports[1].result.seals.reduce((n, row) => n + row.omittedCommonBytes, 0),
  20 * common.length,
);
let rejected = 0;
async function rejectMutation(mutate, pattern, selectedInputs = inputsManifest) {
  const partsRoot = path.join(root, `invalid-${rejected}`);
  fs.cpSync(path.join(root, "sparse/en"), partsRoot, { recursive: true });
  const manifest = path.join(partsRoot, "0/render.json"),
    part = JSON.parse(fs.readFileSync(manifest));
  mutate(part, partsRoot);
  json(manifest, part);
  await assert.rejects(
    mergeRenderPartitions({
      planFile,
      inputsManifest: selectedInputs,
      locale: "en",
      partsRoot,
      output: path.join(root, `rejected-${rejected}`),
    }),
    pattern,
  );
  rejected++;
}
await rejectMutation((part) => {
  part.locale = "ja";
}, /identity/);
await rejectMutation((part) => {
  part.planSha256 = "0".repeat(64);
}, /identity/);
await rejectMutation((part) => {
  part.generation.sha256 = "0".repeat(64);
}, /Expected/);
await rejectMutation((part) => {
  part.files.find((f) => f.storage === "frozen-common").sha256 = "0".repeat(64);
}, /reference/);
await rejectMutation((part) => {
  part.files.find((f) => f.path.includes("/cards/")).storage = "frozen-common";
}, /reference/);
await rejectMutation((part, parts) => {
  write(path.join(parts, "0/extra"), "x");
}, /Unverified/);
await rejectMutation((part, parts) => {
  fs.rmSync(path.join(parts, "3"), { recursive: true });
}, /Incomplete/);
await rejectMutation((part, parts) => {
  fs.cpSync(path.join(parts, "1"), path.join(parts, "duplicate"), { recursive: true });
}, /identity/);
await rejectMutation((part, parts) => {
  fs.unlinkSync(path.join(parts, "0/public/_astro/client.js"));
}, /ENOENT/);
await rejectMutation((part, parts) => {
  part.files = part.files.filter((file) => file.path !== "public/_astro/client.js");
  fs.unlinkSync(path.join(parts, "0/public/_astro/client.js"));
}, /client asset sets/);
await rejectMutation((part, parts) => {
  const other = path.join(parts, "1/render.json"),
    row = JSON.parse(fs.readFileSync(other));
  row.schema = "haneoka-static-render-part-v1";
  json(other, row);
}, /Mixed/);
const brokenInputs = path.join(root, "broken-inputs");
fs.cpSync(path.join(root, "frozen"), brokenInputs, { recursive: true });
write(path.join(brokenInputs, "content", sha256(common)), Buffer.alloc(common.length));
await rejectMutation(() => {}, /Rendered file differs/, path.join(brokenInputs, "manifest.json"));
fs.unlinkSync(path.join(brokenInputs, "content", sha256(common)));
await rejectMutation(() => {}, /ENOENT/, path.join(brokenInputs, "manifest.json"));
assert.deepEqual(
  compareInventories(
    await outputInventory(path.join(root, "legacy-merged")),
    await outputInventory(path.join(root, "sparse-merged")),
  ),
  [],
);
const result = {
  root,
  equivalent: true,
  rejected,
  reports,
  compressedFormat: "deterministic concatenation + gzip; not CI tar.zst or GitHub transport",
  realInputEquivalence: "pending",
};
const output = process.argv[2];
if (output) json(path.resolve(output), result);
console.log(JSON.stringify(result, null, 2));
