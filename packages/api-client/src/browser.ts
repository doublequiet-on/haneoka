/** Native ESM entry for public API consumers; importing it performs no requests. */
export { ApiClientError, createApiClient } from "./index.js";
export { createHaneokaClient } from "./haneoka.js";
export { createGameClient } from "./game.js";
export type { GameClientOptions, GameReadOptions, GameRegion } from "./game.js";
export type { HaneokaClient, HaneokaClientOptions, HaneokaJson, HaneokaPage } from "./haneoka.js";
