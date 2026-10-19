// L3 — GEB
// Input: Finished frozen-input capture containing verified full chart-rate records.
// Output: Immutable computed objects and receipts for each exact release and engine.
// Pos: [Map](L2-2.md); full build computation publication without recomputation.
// Effects/Dependencies: Reads capture bodies and conditionally creates R2 objects.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { r2PageStore } from "./catalog-page-store.mjs";
const root = process.env.STATIC_BUILD_INPUT_ROOT;
if (!root) throw new Error("Set STATIC_BUILD_INPUT_ROOT");
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
if (manifest.schema !== "haneoka-static-captured-inputs-v1") throw new Error("Not a completed input capture");
const output = path.resolve(".output/catalog-pages/computed.mjs");
await build({
  entryPoints: ["src/lib/catalog-page-computed.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { publishChartPage } = await import(pathToFileURL(output).href);
const store = r2PageStore();
try {
  for (const record of manifest.records.filter((row) => row.role === "chart-rates")) {
    const match = /^chart-rates-v6:(jp|intl):(r-[a-f0-9]{20}):([a-f0-9]{40})$/u.exec(record.key);
    if (!match) continue;
    if (record.format !== "json" || !/^[a-f0-9]{64}$/u.test(record.sha256))
      throw new Error("Invalid chart capture record");
    const body = await fs.readFile(path.join(root, "content", record.sha256));
    if (body.length !== record.bytes || createHash("sha256").update(body).digest("hex") !== record.sha256)
      throw new Error("Chart capture content differs");
    const table = JSON.parse(body);
    await publishChartPage(
      store,
      { server: match[1], releaseId: match[2], sourceId: table.sourceId },
      { engineCommit: match[3], computationRecipe: "chart-rates-v6" },
      table,
    );
  }
} finally {
  store.close();
}
