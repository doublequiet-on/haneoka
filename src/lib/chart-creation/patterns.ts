// L3 — GEB
// Input: 已选谱面的完整剪贴板与图案名称。
// Output: 跨工程图案保存／重命名、列表、删除及可移植 JSON 导入导出。
// Pos: [Map](../L2-2.md)；编辑器图案库持久化。
// Effects/Dependencies: 独立 IndexedDB；不升级工程数据库，不保存音频或账户凭据。
import { assertAuthorClipboard, type AuthorClipboard } from "../../../packages/chart-editor/src/creation/collections";

export interface ChartPattern {
  id: string;
  name: string;
  updatedAt: number;
  clipboard: AuthorClipboard;
}
export function parseChartPattern(text: string): ChartPattern {
  const value = JSON.parse(text);
  if (value?.schema !== "haneoka.chart-pattern" || value.version !== 1
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80)
    throw new Error("invalid_chart_pattern");
  assertAuthorClipboard(value.clipboard);
  return { id: crypto.randomUUID(), name: value.name.trim(), updatedAt: Date.now(), clipboard: value.clipboard };
}
export function serializeChartPattern(pattern: ChartPattern): string {
  return JSON.stringify({ schema: "haneoka.chart-pattern", version: 1, name: pattern.name, clipboard: pattern.clipboard }, null, 2);
}
export class ChartPatternStore {
  private database?: Promise<IDBDatabase>;
  private db() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("haneoka-chart-patterns", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("patterns", { keyPath: "id" });
      open.onsuccess = () => {
        const db = open.result;
        const active = this.database;
        const clear = () => { if (this.database === active) this.database = undefined; };
        db.onclose = clear;
        db.onversionchange = () => { clear(); db.close(); };
        resolve(db);
      };
      open.onerror = () => { this.database = undefined; reject(open.error); };
      open.onblocked = () => { this.database = undefined; reject(new Error("storage_blocked")); };
    });
  }
  private async transaction(mode: IDBTransactionMode) {
    const pending = this.db(), db = await pending;
    try { return db.transaction("patterns", mode); }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
      if (this.database === pending) this.database = undefined;
      db.close();
      return (await this.db()).transaction("patterns", mode);
    }
  }
  async list(): Promise<ChartPattern[]> {
    const tx = await this.transaction("readonly");
    return new Promise((resolve, reject) => {
      const request = tx.objectStore("patterns").getAll();
      tx.oncomplete = () => resolve((request.result as ChartPattern[]).sort((a, b) => b.updatedAt - a.updatedAt));
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  async save(pattern: ChartPattern) {
    const tx = await this.transaction("readwrite");
    tx.objectStore("patterns").put(pattern);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  async delete(id: string) {
    const tx = await this.transaction("readwrite");
    tx.objectStore("patterns").delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  async close() {
    const pending = this.database;
    this.database = undefined;
    (await pending)?.close();
  }
}
