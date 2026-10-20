// L3 — GEB
// Input: Finished frozen-input capture containing verified full chart-rate records.
// Output: Immutable computed objects and receipts for each exact release and engine.
// Pos: [Map](L2-2.md); full build computation publication without recomputation.
// Effects/Dependencies: Reads capture bodies; --verify-only uses memory, otherwise conditionally creates R2 objects.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { r2PageStore } from "./catalog-page-store.mjs";
const rollout = JSON.parse(await fs.readFile("config/catalog-page-rollout.json", "utf8"));
if (!process.argv.includes("--verify-only") && !rollout.enabledKinds.includes("songs")) {
  console.log(JSON.stringify({ mode: "publish", records: 0, disabled: true }));
  process.exit(0);
}
const root = process.env.STATIC_BUILD_INPUT_ROOT;
if (!root) throw new Error("Set STATIC_BUILD_INPUT_ROOT");
const manifest = JSON.parse(await fs.readFile(path.join(root, "capture.json"), "utf8"));
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
const verifyOnly = process.argv.includes("--verify-only");
const objects = new Map();
const store = verifyOnly
  ? {
      read: async (key) => objects.get(key) ?? null,
      create: async (key, body) => {
        const previous = objects.get(key);
        if (previous && !Buffer.from(previous).equals(Buffer.from(body)))
          throw new Error("Conflicting computed object");
        objects.set(key, body);
      },
      close: () => {},
    }
  : r2PageStore();
let records = 0;
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
    records++;
  }
} finally {
  store.close();
}
console.log(JSON.stringify({ mode: verifyOnly ? "verify-only" : "publish", records }));
