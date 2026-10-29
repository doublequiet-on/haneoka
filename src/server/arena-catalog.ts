// L3 — GEB
// Input: Selected server and immutable release identity.
// Output: Arena schedule data for the standalone page and calendar.
// Pos: [Map](L2-2.md); Node adapter for the shared native arena projection.
// Effects/Dependencies: Verified local release files or the pinned arena API; caches per release.
import { staticBuildJson } from "./static-input-store";
import { readArenaCatalog } from "../lib/arena-catalog";
import { hasStagedArenaInputs, stagedArenaMaster } from "./arena-master-inputs";
import { ARENA_PROJECTION, type ArenaCatalog } from "../lib/arena";
import {
  fetchStaticCatalog,
  fetchOptionalStaticCatalog,
  fetchStaticReleaseEntry,
  fetchStaticReleaseJson,
  hasLocalStaticCatalog,
  staticCatalogRelease,
  type StaticCatalogRelease,
} from "../lib/static-catalog-source";

const catalogs = new Map<string, Promise<ArenaCatalog>>();
export async function arenaCatalog(server: string, identity?: StaticCatalogRelease): Promise<ArenaCatalog> {
  const pin = identity || (await staticCatalogRelease(server));
  const key = `${server}:${pin.releaseId}:${pin.sourceId}`;
  let pending = catalogs.get(key);
  if (!pending) {
    pending = staticBuildJson(`arena-catalog-v${ARENA_PROJECTION}:${key}`, "native-catalog", async () => {
      const local = hasLocalStaticCatalog(server);
      return local || hasStagedArenaInputs()
        ? readArenaCatalog(pin, {
            master: async (table) => {
              if (!local) return stagedArenaMaster(pin, table);
              const path = `objects/master/${table}.json`;
              return (await fetchStaticReleaseEntry(path, server, pin))
                ? fetchStaticReleaseJson(path, server, pin)
                : null;
            },
            catalog: (resource) => fetchStaticCatalog(resource, server, pin),
            source: async (path) => (await fetchOptionalStaticCatalog(`sources/${path}`, server, pin)).value,
          })
        : fetchStaticCatalog(`arena?projection=${ARENA_PROJECTION}`, server, pin).then(
            (value) => value as ArenaCatalog,
          );
    });
    catalogs.set(key, pending);
    pending.catch(() => catalogs.delete(key));
  }
  return pending;
}
