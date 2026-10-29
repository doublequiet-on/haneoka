// L3 — GEB
// Input: Staged immutable Arena Master files and the static build's pinned identity.
// Output: Verified Master JSON captured for offline locale rendering.
// Pos: [Map](L2-2.md); private build input adapter, independent of the deployed Arena API.
// Effects/Dependencies: Reads local files, verifies SHA-256, and uses the shared capture/replay store.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { staticBuildJson } from "./static-input-store";
import type { StaticCatalogRelease } from "../lib/static-catalog-source";

export function hasStagedArenaInputs(): boolean {
  return Boolean(process.env.STATIC_ARENA_MASTER_INPUTS);
}

export function stagedArenaMaster(pin: StaticCatalogRelease, table: string): Promise<unknown | null> {
  return staticBuildJson(
    `arena-master-v1:${pin.server}:${pin.releaseId}:${pin.sourceId}:${table}`,
    "native-file",
    async () => {
      const root = path.resolve(
        process.env.STATIC_ARENA_MASTER_INPUTS || "data/static-arena",
        pin.server,
        pin.releaseId,
      );
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as {
        schema: string;
        identity: StaticCatalogRelease;
        tables: Record<string, { bytes: number; sha256: string }>;
      };
      if (
        manifest.schema !== "haneoka-arena-master-inputs-v1" ||
        manifest.identity.server !== pin.server ||
        manifest.identity.releaseId !== pin.releaseId ||
        manifest.identity.sourceId !== pin.sourceId
      )
        throw new Error("Arena build input identity mismatch");
      const entry = manifest.tables[table];
      if (!entry) return null;
      const body = fs.readFileSync(path.join(root, `${table}.json`));
      if (body.length !== entry.bytes || createHash("sha256").update(body).digest("hex") !== entry.sha256)
        throw new Error(`Arena build input digest mismatch: ${table}`);
      return JSON.parse(body.toString("utf8"));
    },
  );
}
