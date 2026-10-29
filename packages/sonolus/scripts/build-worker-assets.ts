// Input: the TypeScript asset generator and its engine/resource prerequisites.
// Output: an executable bundle and generated Sonolus Worker resources.
// Pos: Sonolus build entry; direct map: ../L2-2.md.
// Effects: bundles source, stops esbuild, then runs the generator and propagates failures.
import * as esbuild from "esbuild";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const outfile = resolve(pkg, "dist/build-worker-assets.mjs");

try {
  await esbuild.build({
    entryPoints: [resolve(pkg, "src/server/buildWorkerAssets.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    outfile,
    logLevel: "info",
  });
} finally {
  await esbuild.stop();
}

await import(pathToFileURL(outfile).href);
