// L3 — GEB
// Input: Official catalog identities, game protobuf observations and collector checkpoints.
// Output: Shared job/update contracts for Python, container controller and public reads, including Arena boards.
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
  /** The Arena season whose league boards the collector samples; absent while Arena collection is off. */
  arena?: {
    seasonId: string;
    startAtMs: number;
    endAtMs: number;
    rankingEndAtMs: number;
    bandIds: string[];
  } | null;
}

/** One rank window of one Arena league board, in the game's snake_case player fields. */
export interface OfficialArenaObservation {
  snapshotId: string;
  region: GameRecordsRegion;
  seasonId: string;
  bandId: string;
  startRank: number;
  endRank: number;
  maxRank?: number | null;
  observedAtMs: number;
  players?: Array<Record<string, unknown>>;
  provenance?: Record<string, unknown>;
  error?: string;
  httpStatus?: number | null;
  grpcStatus?: string | null;
  retryAfterSeconds?: number;
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

export interface OfficialCollectorFailure {
  stage: string;
  code: string;
  httpStatus?: number;
  grpcStatus?: string;
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
  | { type: "arena-observation"; observation: OfficialArenaObservation }
  | { type: "complete"; status: "ok" | "failed" | "auth_paused" | "rate_limited"; retryAfterSeconds?: number; failure?: OfficialCollectorFailure }
);
