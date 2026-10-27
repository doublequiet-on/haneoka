// L3 — GEB
// Input: 浏览器配队、谱面导出与当前引擎 WASM。
// Output: .generated-public/tools 的浏览器 ESM、Worker、字体和 WASM。
// Pos: [Map](L2-2.md)；可在调用者设备运行的公开工具构建。
// Effects/Dependencies: esbuild 打包并写生成目录；不执行搜索或发布。
import { build } from "esbuild";
import { readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { toolSchemas } from "./tool-schemas.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const outdir = path.join(root, ".generated-public/tools");
const workspacePackages = new Map();
for (const directory of ["packages/i18n", ".dependencies/cassiopeia", ".dependencies/cassiopeia-plugin-our-notes", ".dependencies/cassiopeia-ui-vue", ".dependencies/cassiopeia-renderer-three", ".dependencies/cassiopeia-host-web"]) {
  const manifest = JSON.parse(await readFile(path.join(root, directory, "package.json"), "utf8"));
  workspacePackages.set(manifest.name, { manifest, directory: path.join(root, directory) });
}
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    "api-client": "packages/api-client/src/browser.ts",
    "team-builder": "src/lib/public-tools/team-builder.ts",
    "chart-image": "src/lib/public-tools/chart-image.ts",
    "team-builder-worker": "src/lib/team-builder/engine/worker.ts",
    gacha: "src/lib/public-tools/gacha.ts",
    "song-puzzle": "src/lib/public-tools/song-puzzle.ts",
    stamp: "src/lib/public-tools/stamp.ts",
    fonts: "src/lib/public-tools/fonts.css",
    images: "src/lib/public-tools/images.ts",
    "team-image": "src/lib/public-tools/team-image.css",
    "image-theme": "src/lib/public-tools/images.css",
    "image-validation": "src/lib/public-tools/image-validation.ts",
  },
  outdir, bundle: true, format: "esm", splitting: true, minify: true, target: "es2022",
  assetNames: "assets/[name]-[hash]", chunkNames: "chunks/[name]-[hash]",
  loader: { ".wasm": "file", ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" },
  plugins: [{ name: "public-worker-location", setup(builder) {
    builder.onResolve({ filter: /\.svg\?raw$/u }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "public-raw-svg" }));
    builder.onLoad({ filter: /.*/u, namespace: "public-raw-svg" }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))};`, loader: "js" }));
    builder.onResolve({ filter: /^@haneoka\//u }, ({ path: name }) => {
      const packageName = name.split("/").slice(0, 2).join("/");
      const source = workspacePackages.get(packageName);
      if (!source) return;
      const key = name === packageName ? "." : `.${name.slice(packageName.length)}`;
      const entry = source.manifest.exports?.[key];
      const target = typeof entry === "string" ? entry : entry?.import || entry?.default;
      if (!target) throw new Error(`Missing workspace export ${name}`);
      return { path: path.resolve(source.directory, target) };
    });
    builder.onLoad({ filter: /team-builder\/engine\/client\.ts$/u }, async ({ path: source }) => ({
      contents: (await readFile(source, "utf8")).replace('new URL("./worker.ts", import.meta.url)', 'new URL(new URL(import.meta.url).pathname.includes("/chunks/") ? "../team-builder-worker.js" : "./team-builder-worker.js", import.meta.url)'),
      loader: "ts", resolveDir: path.dirname(source),
    }));
  } }],
});
// The plugin resolves its original note atlases relative to import.meta.url.
for (const target of [outdir, path.join(outdir, "chunks")]) {
  await cp(path.join(root, ".dependencies/cassiopeia-plugin-our-notes/dist/assets/note-skins"), path.join(target, "note-skins"), { recursive: true });
}
await writeFile(path.join(outdir, "manifest.json"), JSON.stringify({
  schema: "haneoka-public-tools-v1", teamBuilder: "./team-builder.js", chartImage: "./chart-image.js", images: "./images.js", imageStylesheet: "./image-theme.css", stylesheet: "./fonts.css",
  types: "./schema.json",
  apiClient: "./api-client.js",
  gacha: "./gacha.js", songPuzzle: "./song-puzzle.js", stamp: "./stamp.js",
  execution: "caller-device", attribution: { text: "Team-building algorithm from Haneoka", url: "https://haneoka.org" },
}));
await writeFile(path.join(outdir, "schema.json"), JSON.stringify(toolSchemas(root)));
await writeFile(path.join(outdir, "render.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="./fonts.css"><link rel="stylesheet" href="./image-theme.css"><title>Haneoka image renderer</title></head><body></body></html>');
console.log("Built public device tools");
