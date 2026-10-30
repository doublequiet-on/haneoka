// L3 — GEB
// Input: Sonolus 客户端 User-Agent 与锁定的 core 协议版本。
// Output: 已支持客户端对应的 Sonolus-Version。
// Pos: [Map](../L2-2.md)；Worker 与 Node 共用的协议版本协商。
// Effects/Dependencies: 依赖 @sonolus/core；无 I/O。
import { sonolusVersion } from "@sonolus/core";

export const SONOLUS_VERSION = sonolusVersion;
export const SONOLUS_SUPPORTED_VERSIONS: readonly string[] = ["1.1.4", SONOLUS_VERSION];

export function sonolusClientVersion(userAgent: string | null | undefined): string {
  const client = /(?:^|\s)Sonolus\/(\d+\.\d+\.\d+)(?=[\s;(]|$)/iu.exec(userAgent ?? "")?.[1];
  return client && SONOLUS_SUPPORTED_VERSIONS.includes(client) ? client : SONOLUS_VERSION;
}
