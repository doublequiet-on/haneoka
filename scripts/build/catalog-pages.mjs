// L3 — GEB
// Input: Locked source, explicit release roots and optional configured R2 bridge.
// Output: Producer registration and verified immutable core snapshots.
// Pos: [Map](L2-2.md); independent page-data build and publish entry.
// Effects/Dependencies: Bundles Node projectors; writes isolated output and optionally immutable R2 objects.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { r2PageStore } from "./catalog-page-store.mjs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sourceSha = git("rev-parse", "HEAD");
const tree = git(
  "ls-tree",
  "-r",
  "HEAD",
  "src",
  "packages",
  "public/i18n",
  "config",
  "scripts",
  "pnpm-lock.yaml",
  ".dependencies",
);
const projectorRevision = createHash("sha256").update(tree).digest("hex");
const engineCommit = git("rev-parse", "HEAD:.dependencies/ournotes-team-builder");
const rollout = JSON.parse(await fs.readFile("config/catalog-page-rollout.json", "utf8"));
if (
  rollout.contract !== "catalog-page-v1" ||
  !Array.isArray(rollout.enabledKinds) ||
  !rollout.enabledKinds.every((kind) => ["cards", "support-cards", "events", "songs"].includes(kind))
)
  throw new Error("Invalid page rollout registration");
const producer = {
  contract: "catalog-page-v1",
  projectorRevision,
  sourceSha,
  engineCommit,
  computationRecipe: "chart-rates-v6",
  enabledKinds: rollout.enabledKinds,
};
if (git("status", "--porcelain", "--untracked-files=all", "--ignore-submodules"))
  throw new Error("Page production requires a clean committed checkout");
const output = path.resolve(process.env.CATALOG_PAGE_OUTPUT || ".output/catalog-pages");
await fs.mkdir(output, { recursive: true });
if (process.argv.includes("--register")) {
  await fs.mkdir(".generated-public", { recursive: true });
  await fs.writeFile(".generated-public/catalog-page-producer.json", JSON.stringify(producer));
} else {
  if (!process.env.CATALOG_PAGE_RELEASE_ROOTS)
    throw new Error("Set CATALOG_PAGE_RELEASE_ROOTS to immutable jp/intl release directories");
  const bundle = path.join(output, "producer.mjs");
  await build({
    stdin: {
      contents:
        'export { produceCatalogPages } from "./src/server/catalog-page-producer"; export { publishPageSnapshot } from "./src/server/catalog-page-snapshot";',
      resolveDir: root,
    },
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    define: { "import.meta.env": JSON.stringify({ PROD: true, DEV: false, SSR: true, BASE_URL: "/" }) },
    logLevel: "warning",
  });
  const { produceCatalogPages, publishPageSnapshot } = await import(pathToFileURL(bundle).href);
  const local = {
    read: async (key) => {
      try {
        return new Uint8Array(await fs.readFile(path.join(output, key)));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    create: async (key, body) => {
      if (!/^catalog-pages\/v1\/(?:objects|ready)\/[a-f0-9]{64}\.json$/u.test(key))
        throw new Error("Invalid page object key");
      const target = path.join(output, key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.writeFile(target, body, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST" || !Buffer.from(await fs.readFile(target)).equals(Buffer.from(body))) throw error;
      }
    },
  };
  const started = performance.now();
  const { ready, context } = await produceCatalogPages(local, producer);
  await fs.writeFile(path.join(output, "snapshot.json"), JSON.stringify({ producer, context, ready }));
  if (process.argv.includes("--publish")) {
    const remote = r2PageStore();
    try {
      await publishPageSnapshot(local, remote, ready, context);
    } finally {
      remote.close();
    }
  }
  console.log(
    JSON.stringify({
      stage: "catalog-pages",
      elapsedMs: performance.now() - started,
      peakRssKb: process.resourceUsage().maxRSS,
      snapshotId: ready.snapshotId,
      published: process.argv.includes("--publish"),
    }),
  );
}
