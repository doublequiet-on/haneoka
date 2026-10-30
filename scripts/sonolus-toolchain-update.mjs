#!/usr/bin/env node
// Keeps the Sonolus server toolchain on the @sonolus/* release that matches
// the current Sonolus app. The declared app version (Sonolus-Version response
// header) is baked into @sonolus/core, so trailing npm releases means clients
// see the server as an old-version server.
//
//   check  print available updates, exit 1 when any exist (CI gate)
//   apply  rewrite workspace, adapter and optional engine package pins
// SONOLUS_NPM_TAG=beta selects preview releases; SONOLUS_SERVER_ONLY=true
// keeps engine manifests and compiler patches unchanged.
//
// The engine's package.json lives in the externally locked
// sonolus-our-notes repository; committing, pushing, and updating
// the Git submodule pin is the caller's job (the scheduled
// sonolus-toolchain-update workflow does exactly that).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceFile = join(repositoryRoot, "pnpm-workspace.yaml");
const adapterPackageFile = join(repositoryRoot, "packages", "sonolus", "package.json");
const tag = process.env.SONOLUS_NPM_TAG ?? "latest";
if (!["latest", "beta"].includes(tag)) throw new Error("SONOLUS_NPM_TAG must be latest or beta");
const serverOnly = process.env.SONOLUS_SERVER_ONLY === "true";
const enginePackageFile = join(repositoryRoot, ".dependencies", "sonolus-our-notes", "package.json");
const engineWorkspaceFile = join(repositoryRoot, ".dependencies", "sonolus-our-notes", "pnpm-workspace.yaml");

// package -> where the pin lives. free-pack has no app-version coupling but
// is kept in lockstep so the engine and server never mix release generations.
const catalogPackages = ["@sonolus/core", "@sonolus/express", "@sonolus/free-pack"];
const enginePackages = [
  "@sonolus/core",
  "@sonolus/express",
  "@sonolus/free-pack",
  "@sonolus/sonolus.js",
  "@sonolus/sonolus.js-compiler",
];

const mode = process.argv[2] ?? "check";
if (mode !== "check" && mode !== "apply") {
  console.error(`Unknown mode "${mode}". Use "check" or "apply".`);
  process.exitCode = 2;
} else {
  await main();
}

async function main() {
  const targets = [
    ...(serverOnly ? [] : [{ target: "workspace", pins: readCatalogPins(), packages: catalogPackages }]),
    { target: "adapter", pins: readPackagePins(adapterPackageFile), packages: ["@sonolus/core"] },
    ...(serverOnly ? [] : [{ target: "engine", pins: readPackagePins(enginePackageFile), packages: enginePackages }]),
  ];
  const updates = [];
  for (const pkg of [...new Set(targets.flatMap((entry) => entry.packages))]) {
    const latest = await latestVersion(pkg);
    for (const { target, pins, packages } of targets) {
      if (!packages.includes(pkg)) continue;
      const pinned = pins[pkg];
      if (pinned === undefined) throw new Error(`${pkg} is not pinned in ${target}`);
      if (compareVersions(latest, pinned) > 0) updates.push({ target, pkg, from: pinned, to: latest });
    }
  }
  if (updates.length === 0) {
    console.log(`Sonolus toolchain is up to date for npm tag ${tag}${serverOnly ? " (server only)" : ""}.`);
    return;
  }
  for (const { target, pkg, from, to } of updates) console.log(`${target} ${pkg}: ${from} -> ${to}`);
  const compilerUpdate = updates.find(
    ({ target, pkg }) => target === "engine" && pkg === "@sonolus/sonolus.js-compiler",
  );
  const compilerPatches = [workspaceFile, engineWorkspaceFile].flatMap(readCompilerPatches);
  if (compilerUpdate && compilerPatches.length) {
    throw new Error(
      `Sonolus compiler ${compilerUpdate.from} -> ${compilerUpdate.to} requires patch migration review ` +
        `before any toolchain manifest update or push. Active exact patches: ` +
        compilerPatches.map(({ version, file }) => `${version} (${file})`).join(", "),
    );
  }
  if (mode === "check") {
    process.exitCode = 1;
    return;
  }
  const updatesFor = (target) =>
    new Map(updates.filter((entry) => entry.target === target).map((entry) => [entry.pkg, entry.to]));
  const catalogUpdates = updatesFor("workspace");
  const adapterUpdates = updatesFor("adapter");
  const engineUpdates = updatesFor("engine");
  if (catalogUpdates.size) rewriteCatalog(catalogUpdates);
  if (adapterUpdates.size) rewritePackage(adapterPackageFile, adapterUpdates);
  if (engineUpdates.size) rewritePackage(enginePackageFile, engineUpdates);
  console.log("Updated toolchain manifests; refresh lockfiles and pin any updated engine commit.");
}

async function latestVersion(pkg) {
  const response = await fetch(`https://registry.npmjs.org/${pkg}`);
  if (!response.ok) throw new Error(`npm registry lookup failed for ${pkg}: HTTP ${response.status}`);
  const tags = (await response.json())["dist-tags"];
  const latest = tags?.[tag];
  if (typeof latest !== "string") throw new Error(`npm registry has no ${tag} tag for ${pkg}`);
  if (tag === "latest" && typeof tags.beta === "string" && compareVersions(tags.beta, latest) > 0)
    console.log(`${pkg}: preview ${tags.beta} is available under npm tag beta`);
  return latest;
}

function compareVersions(left, right) {
  const parts = (value) => {
    if (!/^\d+\.\d+\.\d+$/u.test(value)) throw new Error(`Expected an exact release version: ${value}`);
    return value.split(".").map(Number);
  };
  const a = parts(left);
  const b = parts(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function readCatalogPins() {
  const pins = {};
  for (const line of readLines(workspaceFile)) {
    for (const pkg of catalogPackages) {
      const match = new RegExp(`^\\s*"${pkg}":\\s*(\\d+\\.\\d+\\.\\d+)\\s*$`).exec(line);
      if (match) pins[pkg] = match[1];
    }
  }
  return pins;
}

function readPackagePins(file) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const pins = {};
  for (const section of ["dependencies", "devDependencies"]) {
    for (const pkg of enginePackages) {
      const value = manifest[section]?.[pkg];
      if (typeof value === "string") pins[pkg] = value.replace(/^\^/u, "");
    }
  }
  return pins;
}

function rewriteCatalog(updates) {
  const lines = readLines(workspaceFile);
  const rewritten = lines.map((line) => {
    for (const [pkg, version] of updates) {
      line = line.replace(new RegExp(`(\\s*"${pkg}":\\s*)\\d+\\.\\d+\\.\\d+\\s*$`), `$1${version}`);
    }
    return line;
  });
  writeFileSync(workspaceFile, rewritten.join("\n"));
}

function rewritePackage(file, updates) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [pkg, version] of updates) {
      if (manifest[section]?.[pkg] !== undefined)
        manifest[section][pkg] = manifest[section][pkg].startsWith("^") ? `^${version}` : version;
    }
  }
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readLines(path) {
  return readFileSync(path, "utf8").split("\n");
}

function readCompilerPatches(file) {
  if (!existsSync(file)) return [];
  const lines = readLines(file);
  const body = [];
  let indentation;
  for (const line of lines) {
    const header = /^(\s*)patchedDependencies:\s*(.*)$/u.exec(line);
    if (header) {
      indentation = header[1].length;
      body.push(header[2]);
      continue;
    }
    if (indentation === undefined || !line.trim() || line.trimStart().startsWith("#")) continue;
    const leading = /^\s*/u.exec(line)[0].length;
    if (leading <= indentation) break;
    body.push(line);
  }
  return [...body.join("\n").matchAll(/(["']?)@sonolus\/sonolus\.js-compiler@(\d+\.\d+\.\d+)\1\s*:\s*\S/gu)].map(
    (match) => ({ version: match[2], file }),
  );
}
