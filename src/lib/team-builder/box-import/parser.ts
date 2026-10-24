// L3 — GEB
// Input: 用户选择的库存文本／文件、取消信号与进度回调。
// Output: BoxParseResult；MoeNotes 当前库存与既有存档／备份使用同一预览契约。
// Pos: [Map](../L2-2.md)；Box Worker 的格式适配入口。
// Effects/Dependencies: 本地读取文件；将 MoeNotes 无历史库存投影到 exporter 的当前事实解析器，不跟随存档链接。
import {
  BOX_LIMITS,
  BoxImportError,
  parseBoxFiles as parseFiles,
  parseBoxText as parseText,
  type BoxParseOptions,
  type BoxParseResult,
} from "@haneoka/game-data-exporter";

function inventoryText(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return text;
  const root = value as Record<string, unknown>;
  if (root.format !== "moenotes.card-inventory/1") return text;
  // The exporter already validates these current facts, statuses and region aliases for card-box/1.
  return JSON.stringify({ format: "moenotes.card-box/1", server: root.server, cards: root.cards, player: root.player });
}

export async function parseBoxText(text: string, options: BoxParseOptions = {}): Promise<BoxParseResult> {
  options.signal?.throwIfAborted();
  if (text.length > BOX_LIMITS.textBytes) throw new BoxImportError("box_text_budget");
  return parseText(inventoryText(text), options);
}

export async function parseBoxFiles(files: readonly Blob[], options: BoxParseOptions = {}): Promise<BoxParseResult> {
  options.signal?.throwIfAborted();
  if (
    !files.length ||
    files.length > BOX_LIMITS.entries ||
    files.reduce((size, file) => size + file.size, 0) > BOX_LIMITS.inputBytes
  )
    throw new BoxImportError("box_input_budget");
  const adapted: Blob[] = [];
  for (const file of files) {
    options.signal?.throwIfAborted();
    const prefix = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (prefix[0] === 0x50 && prefix[1] === 0x4b) {
      adapted.push(file);
      continue;
    }
    if (file.size > BOX_LIMITS.fileBytes) throw new BoxImportError("box_file_budget");
    if (new TextDecoder().decode(prefix).trimStart().startsWith("{")) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new BoxImportError("box_invalid_utf8");
      } finally {
        bytes.fill(0);
      }
      const next = inventoryText(text);
      adapted.push(next === text ? file : new Blob([next], { type: "application/json" }));
    } else adapted.push(file);
  }
  options.signal?.throwIfAborted();
  return parseFiles(adapted, options);
}
