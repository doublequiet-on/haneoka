// L3 — GEB
// Input: 受信服务器素材响应、谱面来源引用和既有版本。
// Output: 按内容去重、独立于资源 release 的社区素材快照。
// Pos: [Map](L2.md)；社区复用素材的流式持久化与版本引用。
// Effects/Dependencies: D1、上传 R2、DigestStream／FixedLengthStream；失败对象进入既有 GC，发布引用由调用者原子提交。
import type { ChartMediaRef } from "../src/lib/chart-creation/community-types";

type ServerRef = Extract<ChartMediaRef, { kind: "server" }>;
export type ChartMediaResolver = (ref: ServerRef, kind: "audio" | "cover") => Promise<Response | null>;
export interface ChartMediaSnapshot {
  hash: string;
  key: string;
  type: string;
  size: number;
}
const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function chartMediaSnapshot(env: Env, id: string, revision: number, kind: string) {
  return env.DB.prepare(
    `SELECT a.hash, a.object_key AS key, a.media_type AS type, a.byte_size AS size
    FROM community_chart_revision_media r JOIN community_chart_media_asset a ON a.hash = r.asset_hash
    WHERE r.chart_id = ? AND r.revision = ? AND r.kind = ?`,
  )
    .bind(id, revision, kind)
    .first<ChartMediaSnapshot>();
}

export async function preserveChartMedia(
  env: Env,
  ref: ServerRef,
  kind: "audio" | "cover",
  reuse: readonly string[],
  resolve: ChartMediaResolver,
): Promise<string> {
  const reference = JSON.stringify(ref);
  for (const id of reuse) {
    const previous = await env.DB.prepare(
      `SELECT a.hash FROM community_chart c
      JOIN community_chart_revision r ON r.chart_id = c.id AND r.revision = ${id === reuse[0] ? "c.head" : "c.published_revision"}
      JOIN community_chart_revision_media m ON m.chart_id = r.chart_id AND m.revision = r.revision AND m.kind = ?
      JOIN community_chart_media_asset a ON a.hash = m.asset_hash
      WHERE c.id = ? AND r.${kind}_json = ?`,
    )
      .bind(kind, id, reference)
      .first<{ hash: string }>();
    if (previous) return previous.hash;
  }
  const { sha256: selectedHash, ...identity } = ref;
  const originReference = ref.provider === "our-notes" ? JSON.stringify(identity) : reference;
  const referenceKey = hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${originReference}`)),
  );
  if (ref.provider === "our-notes" || selectedHash) {
    const previous = await env.DB.prepare(
      "SELECT asset_hash AS hash FROM community_chart_media_origin WHERE reference_key = ?",
    )
      .bind(referenceKey)
      .first<{ hash: string }>();
    if (previous && (!selectedHash || previous.hash === selectedHash)) return previous.hash;
  }
  const response = await resolve(ref, kind);
  const size = Number(response?.headers.get("Content-Length"));
  const type = response?.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const maximum = kind === "audio" ? 64 * 1024 * 1024 : 15 * 1024 * 1024;
  if (
    !response?.ok ||
    !response.body ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !(kind === "audio" ? type.startsWith("audio/") : ["image/png", "image/jpeg", "image/webp"].includes(type))
  ) {
    await response?.body?.cancel();
    throw new Error("media_missing");
  }
  if (size > maximum) {
    await response.body.cancel();
    throw new Error("file_size");
  }
  const key = `charts/media/${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO community_chart_gc(object_key,created_at) VALUES(?,?)").bind(key, Date.now()).run();
  const digest = new crypto.DigestStream("SHA-256"),
    hashWriter = digest.getWriter();
  const fixed = new FixedLengthStream(size),
    controller = new AbortController();
  const forwarding = response.body
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        async transform(chunk, output) {
          await hashWriter.write(chunk);
          output.enqueue(chunk);
        },
        async flush() {
          await hashWriter.close();
        },
      }),
    )
    .pipeTo(fixed.writable, { signal: controller.signal });
  const storing = env.COMMUNITY_UPLOADS.put(key, fixed.readable, { httpMetadata: { contentType: type } });
  let hash: string;
  try {
    const result = await Promise.all([forwarding, storing, digest.digest]);
    hash = hex(result[2]);
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled([hashWriter.abort(error), forwarding, storing, digest.digest]);
    throw error;
  }
  if (selectedHash && hash !== selectedHash) {
    await env.COMMUNITY_UPLOADS.delete(key);
    await env.DB.prepare("DELETE FROM community_chart_gc WHERE object_key = ?").bind(key).run();
    throw new Error("media_changed");
  }
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO community_chart_media_asset(hash,object_key,media_type,byte_size,created_at)
    VALUES(?,?,?,?,?)`,
  )
    .bind(hash, key, type, size, Date.now())
    .run();
  if (!inserted.meta.changes) {
    await env.COMMUNITY_UPLOADS.delete(key);
    await env.DB.prepare("DELETE FROM community_chart_gc WHERE object_key = ?").bind(key).run();
  }
  if (ref.provider === "our-notes" || selectedHash)
    await env.DB.prepare("INSERT OR IGNORE INTO community_chart_media_origin(reference_key,asset_hash) VALUES(?,?)")
      .bind(referenceKey, hash)
      .run();
  return hash;
}
