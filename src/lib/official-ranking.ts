// L3 — GEB
// Input: Official catalog identities, game protobuf observations and collector checkpoints.
// Output: Shared job/update contracts for Python, container controller and public reads.
// Pos: [Map](L2-2.md); official ranking wire types alongside game-records DTOs.
// Effects/Dependencies: Types only; distinguishes region, board kind and observation identity.
import type { GameRecordsRegion } from "./game-records";

export interface OfficialCatalog {
  region: GameRecordsRegion;
  catalogSource: "official-master";
  catalogObservedAtMs: number;
  masterVersion: string;
  resourceVersion: string | null;
  apiOrigin: string;
  tableHashes?: Record<string, string>;
  event: {
    id: string;
    startAtMs: number;
    endAtMs: number;
    aggregationSeconds: number;
    status: string;
    totalRankingEnabled: boolean;
    pointRankingEnabled: false;
    challenges: Array<{ id: string; musicId: string; enabled: boolean; startAtMs: number; endAtMs: number; status: string }>;
  } | null;
}

export interface OfficialObservation {
  snapshotId: string;
  region: GameRecordsRegion;
  eventId: string;
  kind: "challenge" | "total";
  challengeId: string;
  observedAtMs: number;
  players?: Array<Record<string, unknown>>;
  provenance?: Record<string, unknown>;
  error?: string;
  httpStatus?: number | null;
  grpcStatus?: string | null;
  retryAfterSeconds?: number;
}

export interface OfficialCollectorJob {
  contract: "haneoka:official-ranking-job/1";
  region: GameRecordsRegion;
  runId: string;
  credentialGeneration: string;
  clientVersion: string;
  credentials: Record<string, unknown>;
  masterConfig: Record<string, unknown>;
  callbackUrl: string;
  callbackToken: string;
  deadlineMs: number;
}

export type OfficialCollectorUpdate = {
  contract: "haneoka:official-ranking-update/1";
  region: GameRecordsRegion;
  runId: string;
  credentialGeneration: string;
} & (
  | { type: "catalog"; catalog: OfficialCatalog }
  | { type: "attempt"; snapshotId: string }
  | { type: "observation"; observation: OfficialObservation }
  | { type: "complete"; status: "ok" | "failed" | "auth_paused" | "rate_limited"; retryAfterSeconds?: number }
);
