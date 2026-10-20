// L3 — GEB
// Input: Existing R2 environment and immutable page object operations.
// Output: Awaited JSON RPC reads and conditional creates through the Python R2 adapter.
// Pos: [Map](L2-2.md); page publication storage bridge.
// Effects/Dependencies: Starts one hidden Python child; inherits configured credentials.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
export function r2PageStore() {
  const bridge = spawn(process.env.PYTHON || "python", ["scripts/publish/catalog_pages.py", "bridge"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  const lines = createInterface({ input: bridge.stdout })[Symbol.asyncIterator]();
  let tail = Promise.resolve();
  const rpc = (value) => {
    const pending = tail.then(async () => {
      bridge.stdin.write(JSON.stringify(value) + "\n");
      const line = await lines.next();
      if (line.done) throw new Error("Page object bridge stopped");
      const result = JSON.parse(line.value);
      if (result.error) throw new Error(result.error);
      return result;
    });
    tail = pending.catch(() => {});
    return pending;
  };
  return {
    read: async (key) => {
      const value = await rpc({ operation: "read", key });
      return value.body === null ? null : new Uint8Array(Buffer.from(value.body, "base64"));
    },
    create: async (key, body) => {
      await rpc({ operation: "create", key, body: Buffer.from(body).toString("base64") });
    },
    close: () => bridge.stdin.end(),
  };
}
