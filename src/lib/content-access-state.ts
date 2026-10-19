// L3 — GEB
// Input: 授权文档元数据或账号能力接口提供的来源 ID。
// Output: 默认仅正式来源、按当前授权更新的动态来源表。
// Pos: [Map](L2-2.md)；浏览器与通用路由共享的来源状态。
// Effects/Dependencies: 无请求；读取授权文档属性，在文档交换前更新来源表。
const formalSources = ["jp", "intl"];
const sourceIds = [...formalSources];
export const CONTENT_SOURCE_IDS: readonly string[] = sourceIds;
export type ContentSourceFamily = "jp" | "intl";
const sourceFamilies = new Map<string, ContentSourceFamily>();
export const contentSourceFamily = (server: string): ContentSourceFamily | undefined =>
  server === "jp" || server === "intl" ? server : sourceFamilies.get(server);
export const isContentSourceFamily = (value: unknown): value is ContentSourceFamily => value === "jp" || value === "intl";

export const isContentSourceId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);

export function clearContentSources(): void {
  sourceIds.splice(0, sourceIds.length, ...formalSources);
  sourceFamilies.clear();
}

export function replaceContentSources(sources: readonly string[], families: Readonly<Record<string, ContentSourceFamily>> = {}): void {
  const next = sources.every(isContentSourceId) ? [...new Set([...formalSources, ...sources])] : formalSources;
  sourceIds.splice(0, sourceIds.length, ...next);
  sourceFamilies.clear();
  for (const source of next) if (isContentSourceFamily(families[source])) sourceFamilies.set(source, families[source]);
}

interface ContentDocument {
  documentElement: { dataset: Record<string, string | undefined> };
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

function adoptDocument(document: ContentDocument): void {
  clearContentSources();
  const { contentAccess, contentSources, contentSourceFamilies } = document.documentElement.dataset;
  if (contentAccess !== "1" || !contentSources) return;
  try {
    const sources: unknown = JSON.parse(contentSources);
    const families: unknown = JSON.parse(contentSourceFamilies || "{}");
    if (Array.isArray(sources) && sources.every(isContentSourceId) && families && typeof families === "object" &&
      !Array.isArray(families) && Object.entries(families).every(([source, family]) => sources.includes(source) && isContentSourceFamily(family)))
      replaceContentSources(sources, families as Record<string, ContentSourceFamily>);
  } catch {
    /* The document keeps the formal source scope. */
  }
}

const browserDocument = (globalThis as unknown as { document?: ContentDocument }).document;
if (browserDocument && (globalThis as unknown as { window?: unknown }).window === globalThis) {
  adoptDocument(browserDocument);
  browserDocument.addEventListener("astro:before-swap", (event) => {
    const next = (event as { newDocument?: ContentDocument }).newDocument;
    if (next) adoptDocument(next);
  });
}
