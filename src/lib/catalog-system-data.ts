import type { ArenaCatalog } from "./arena";
import type { CrossCatalogDTO } from "./cross-server/catalog";
import type { ReleaseServer } from "./release-server";

export type CatalogSystemKind = "arena" | "missions" | "studio" | "tgw-card" | "anon-tokyo";
export interface CatalogSystemPayload {
  schema: "haneoka-catalog-system-v1";
  kind: CatalogSystemKind;
  server: ReleaseServer;
  entityId?: string;
  arena?: ArenaCatalog;
  marks?: Record<string, string>;
  pointName?: unknown;
  release?: { releaseId: string; sourceId: string };
  mode?: string;
  catalog?: CrossCatalogDTO;
  document?: Record<string, unknown>;
  tierDetails?: Record<string, Record<string, unknown>>;
  bands?: Record<string, unknown>[];
}
