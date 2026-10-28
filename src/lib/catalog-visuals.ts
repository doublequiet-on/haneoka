// L3 — GEB
// Input: 固定目录身份与可选 API 根地址。
// Output: 卡片、角色、歌曲、乐队和图标的显示资料。
// Pos: [Map](L2-2.md)；网页和公开图片模块的目录显示数据读取。
// Effects/Dependencies: 并行公开 GET，核对每个响应的同一 release 与 source 身份。
import { withUiMarksProjection } from "./ui-marks";
import { objectRow } from "./team-builder/data";

/** The catalogue's presentation records, read under the caller's existing pin. */
export async function fetchCatalogVisuals(
  identity: { server: string; releaseId: string; sourceId?: string },
  signal: AbortSignal,
  cardMetadata = false,
  bandItemMetadata = false,
  apiBase?: string,
) {
  const read = async (resource: string) => {
    const path = withUiMarksProjection(
        `/api/v1/servers/${encodeURIComponent(identity.server)}/${resource}?release=${encodeURIComponent(identity.releaseId)}`,
    );
    const response = await fetch(apiBase ? new URL(path, apiBase) : path, { signal });
    if (
      !response.ok ||
      response.headers.get("x-haneoka-release-id") !== identity.releaseId ||
      response.headers.get("x-haneoka-source-id") !== identity.sourceId
    )
      throw new Error("catalog-visuals-unavailable");
    const value = objectRow(await response.json());
    return objectRow(value.entries ?? value.items ?? value[resource] ?? value);
  };
  const [marks, characters, bands, songs, cards, supportCards, bandItems] = await Promise.all([
    read("ui-marks"),
    read("characters"),
    read("bands"),
    read("songs"),
    cardMetadata ? read("cards") : Promise.resolve({} as Record<string, unknown>),
    cardMetadata ? read("support-cards") : Promise.resolve({} as Record<string, unknown>),
    bandItemMetadata ? read("band-items") : Promise.resolve({} as Record<string, unknown>),
  ]);
  return {
    cards,
    supportCards,
    bands: Object.fromEntries(Object.entries(bands).map(([id, row]) => [id, objectRow(row)])),
    bandItems: Object.fromEntries(
      Object.entries(bandItems)
        .filter(([, row]) => row && typeof row === "object")
        .map(([id, row]) => [id, objectRow(row)]),
    ),
    marks: new Map(
      Object.entries(marks)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([name, path]) => [name, `/runtime/${identity.server}/${path.replace(/^runtime\//u, "")}?release=${encodeURIComponent(identity.releaseId)}`]),
    ),
    characters: Object.fromEntries(
      Object.entries(characters)
        .filter(([, row]) => row && typeof row === "object")
        .map(([id, row]) => [id, objectRow(row)]),
    ),
    songs: Object.fromEntries(
      Object.entries(songs)
        .filter(([, row]) => row && typeof row === "object")
        .map(([id, row]) => [id, objectRow(row)]),
    ),
  };
}
