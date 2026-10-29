// L3 — GEB
// Input: Regional, owner-scoped recommendation jobs and frozen event results.
// Output: Device-only resumable jobs and latest complete farming results.
// Pos: [Map](L2-2.md); IndexedDB persistence shared by both farming search paths.
// Effects/Dependencies: Upgrades the local checkpoint database; preserves existing jobs and never writes BoxStore or cloud state.
import { PT_VERSION, type PtJob, type PtJobStore } from "./pt-recommendation";
import type { EngineRequest, EngineResponse } from "./engine/api";

export interface PtResultCheckpoint<Settings> {
  version: "reward-cycle-result-v1";
  server: string;
  owner: string;
  dataFingerprint: string;
  contextKey: string;
  request: EngineRequest;
  response: EngineResponse;
  settings: Settings;
  session: string;
  updatedAt: number;
}

export class PtCheckpoint implements PtJobStore {
  private db: Promise<IDBDatabase> | undefined;
  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("haneoka-pt-trial", 2);
      let rejected = false;
      const fail = (error: Error | DOMException | null) => {
        rejected = true;
        if (this.db === opening) this.db = undefined;
        reject(error);
      };
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("jobs")) {
          const store = request.result.createObjectStore("jobs", { keyPath: "id" });
          store.createIndex("by-owner-server", ["owner", "server"]);
        }
        if (!request.result.objectStoreNames.contains("results"))
          request.result.createObjectStore("results");
      };
      request.onsuccess = () => {
        if (rejected) { request.result.close(); return; }
        request.result.onversionchange = () => {
          request.result.close();
          if (this.db === opening) this.db = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("pt-storage-blocked"));
    });
    return (this.db = opening);
  }
  async save(job: PtJob): Promise<void> {
    const snapshot = structuredClone(job);
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("jobs", "readwrite");
      tx.objectStore("jobs").put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("pt-storage-aborted"));
    });
  }
  async latest(server: string, owner: string): Promise<PtJob | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("jobs", "readonly");
      const request = tx
        .objectStore("jobs")
        .index("by-owner-server")
        .getAll(IDBKeyRange.only([owner, server]));
      request.onsuccess = () => {
        const rows = (request.result as PtJob[]).filter((job) => job.version === PT_VERSION);
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(rows[0] ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async saveResult<Settings>(value: Omit<PtResultCheckpoint<Settings>, "version">): Promise<void> {
    const snapshot = { ...structuredClone(value), version: "reward-cycle-result-v1" as const };
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("results", "readwrite");
      tx.objectStore("results").put(snapshot, JSON.stringify([snapshot.owner, snapshot.server]));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("pt-storage-aborted"));
    });
  }
  async latestResult<Settings>(server: string, owner: string): Promise<PtResultCheckpoint<Settings> | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("results", "readonly");
      const request = tx.objectStore("results").get(JSON.stringify([owner, server]));
      request.onsuccess = () => {
        const value = request.result as PtResultCheckpoint<Settings> | undefined;
        resolve(value?.version === "reward-cycle-result-v1" ? value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }
}
