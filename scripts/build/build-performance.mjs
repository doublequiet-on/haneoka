// L3 — GEB
// Input: Stage callback, fixed input identity and explicit cache conditions.
// Output: Separate timing and physical artifact reports; no publication mutation.
// Pos: [Map](L2-2.md); controlled build comparisons.
// Effects/Dependencies: Reads output files and writes only the requested report.
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileDigest, listFiles, sha256 } from "./static-build-inputs.mjs";

export async function outputInventory(root) {
  const files = [];
  for (const name of listFiles(root)) files.push({ path: name, ...(await fileDigest(path.join(root, name))) });
  return files;
}

export async function measureStage(identity, operation) {
  for (const key of ["inputSha256", "resources", "recipe", "initialCache"])
    if (identity[key] === undefined) throw new Error(`Missing measurement identity: ${key}`);
  const cpu = process.cpuUsage(),
    started = performance.now();
  const result = await operation();
  const elapsedMs = performance.now() - started,
    used = process.cpuUsage(cpu);
  return {
    schema: "haneoka-build-measurement-v1",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    run: process.env.GITHUB_RUN_ID || "local",
    attempt: process.env.GITHUB_RUN_ATTEMPT || "1",
    ...identity,
    elapsedMs,
    cpuMicros: used.user + used.system,
    peakRssKb: process.resourceUsage().maxRSS,
    result,
  };
}

export function compressedFixtureBytes(root) {
  // This is a deterministic fixture encoding, not GitHub's artifact ZIP format.
  return gzipSync(
    Buffer.concat(
      listFiles(root).flatMap((name) => [Buffer.from(`${name}\0`), fs.readFileSync(path.join(root, name))]),
    ),
    { level: 6 },
  ).length;
}

export function compareInventories(before, after) {
  const left = new Map(before.map((row) => [row.path, row]));
  const right = new Map(after.map((row) => [row.path, row]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().filter((key) => {
    const a = left.get(key),
      b = right.get(key);
    return !a || !b || a.sha256 !== b.sha256 || a.bytes !== b.bytes;
  });
}

export const fixtureIdentity = (input) => ({
  inputSha256: sha256(JSON.stringify(input)),
  resources: input.resources,
  recipe: "static-render-transport-v2",
  initialCache: "empty isolated output; identical read-only frozen input",
  osPageCache: "uncontrolled; timings do not establish a speedup",
});
