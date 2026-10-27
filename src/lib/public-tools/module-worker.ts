// L3 — GEB
// Input: Published module Worker URL and browser Worker options.
// Output: A Worker owned by the calling page, including cross-origin module imports.
// Pos: [Map](../L2-2.md); public device-computation Worker bootstrap.
// Effects/Dependencies: Caches one Blob URL per module for the page lifetime.
const bootstraps = new Map<string, string>();

export function createModuleWorker(url: URL, options: WorkerOptions): Worker {
  if (url.origin === location.origin) return new Worker(url, options);
  let bootstrap = bootstraps.get(url.href);
  if (!bootstrap) {
    bootstrap = URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: "text/javascript" }));
    bootstraps.set(url.href, bootstrap);
  }
  return new Worker(bootstrap, options);
}
