// L3 — GEB
// Input: 固定来源的无字表情清单与同 release 目录 ID。
// Output: 保留原图字节身份和尺寸的公开记录投影。
// Pos: [Map](../L2-2.md)；构建端与服务端共享的表情公开数据边界。
// Effects/Dependencies: 无 I/O；仅投影公开字段，不携带生产诊断或来源继承信息。
type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const size = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((number) => Number.isSafeInteger(number) && number > 0);

export interface PublicStampRecord {
  id: string;
  stampId: string;
  sourceServer: string;
  publishable: true;
  quality: string;
  hasArtwork?: boolean;
  effectiveSourceSize?: [number, number];
  effectiveOriginalSize?: [number, number];
  artifacts: Partial<
    Record<
      "sourceImage" | "nativeOriginal" | "exportCandidate",
      { path: string; sha256: string }
    >
  >;
  [key: string]: unknown;
}
export interface PublicStampManifest {
  schema: "haneoka-textless-stamps-v1";
  server: string;
  sourceIdentity: { server: string; sourceId: string };
  records: PublicStampRecord[];
}

export function publicStampManifest(
  value: unknown,
  options: {
    server: string;
    sourceId: string;
    stampIds: ReadonlySet<string>;
  },
): PublicStampManifest {
  const input = object(value),
    identity = object(input.sourceIdentity);
  const { server, sourceId, stampIds } = options;
  if (
    input.schema !== "haneoka-textless-stamps-v1" ||
    input.server !== server ||
    identity.server !== server ||
    identity.sourceId !== sourceId ||
    !Array.isArray(input.records)
  )
    throw new TypeError("Invalid stamp manifest identity");
  const records: PublicStampRecord[] = [];
  for (const value of input.records) {
    const row = object(value),
      stampId = row.stampId;
    const origins = [
      row.originSourceIdentity,
      row.repairSourceIdentity,
      object(row.seedOrigin).sourceIdentity,
    ];
    if (
      origins.some(
        (origin) =>
          typeof object(origin).server === "string" &&
          object(origin).server !== server,
      )
    )
      continue;
    if (
      row.publishable !== true ||
      typeof stampId !== "string" ||
      !stampIds.has(stampId) ||
      typeof row.id !== "string" ||
      !/^[A-Za-z0-9_.-]+$/u.test(row.id) ||
      typeof row.quality !== "string"
    )
      continue;
    const artifacts: PublicStampRecord["artifacts"] = {};
    for (const key of [
      "sourceImage",
      "nativeOriginal",
      "exportCandidate",
    ] as const) {
      const asset = object(object(row.artifacts)[key]);
      const prefix = `/assets/${server}/Assets/Haneoka/StampMaker/shared/sha256/`;
      if (digest(asset.sha256) && asset.path === `${prefix}${asset.sha256}.png`)
        artifacts[key] = { path: asset.path, sha256: asset.sha256 };
    }
    if (!Object.keys(artifacts).length) continue;
    const record: PublicStampRecord = {
      id: row.id,
      stampId,
      sourceServer: server,
      publishable: true,
      quality: row.quality,
      artifacts,
    };
    if (typeof row.hasArtwork === "boolean") record.hasArtwork = row.hasArtwork;
    for (const key of [
      "effectiveSourceSize",
      "effectiveOriginalSize",
      "nativeSize",
      "effectiveOriginalWidthHeight",
      "originalSourceSize",
    ])
      if (size(row[key])) record[key] = [...row[key]];
    for (const key of [
      "inputFingerprint",
      "recipeFingerprint",
      "pixelSha256",
      "sourceHash",
    ])
      if (digest(row[key])) record[key] = row[key];
    if (
      typeof row.algorithmVersion === "string" &&
      /^[A-Za-z0-9_.-]+$/u.test(row.algorithmVersion)
    )
      record.algorithmVersion = row.algorithmVersion;
    const weights = Object.entries(object(row.languageWeights)).filter(
      ([language, weight]) =>
        /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/u.test(language) &&
        typeof weight === "number" &&
        Number.isFinite(weight),
    );
    if (weights.length) record.languageWeights = Object.fromEntries(weights);
    const policy = object(row.exportPolicy),
      projected: Row = {};
    for (const key of ["allowUpscale", "preserveAspectRatio"])
      if (typeof policy[key] === "boolean") projected[key] = policy[key];
    for (const key of ["maxWidth", "maxHeight"])
      if (
        typeof policy[key] === "number" &&
        Number.isSafeInteger(policy[key]) &&
        policy[key] > 0
      )
        projected[key] = policy[key];
    if (Object.keys(projected).length) record.exportPolicy = projected;
    records.push(record);
  }
  return {
    schema: "haneoka-textless-stamps-v1",
    server,
    sourceIdentity: { server, sourceId },
    records,
  };
}
