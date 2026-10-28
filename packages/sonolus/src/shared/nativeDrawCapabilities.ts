import { NATIVE_PARTICLE_PACKS } from "./particlePacks.ts";
import { LOOP_FRAME_EFFECTS } from "../../../../.dependencies/sonolus-our-notes/shared/src/engine/data/loopFrameContract.ts";

export const NATIVE_PARTICLE_OPTIONAL_DRAW_CAPABILITIES: readonly string[] = NATIVE_PARTICLE_PACKS.flatMap(
  ({ key }) => [`Our Notes Source Connect Draw ${key}`, `Our Notes Source Connect Frame Draw ${key}`],
);

export const NATIVE_PARTICLE_OPTIONAL_EFFECTS: readonly string[] = [
  ...NATIVE_PARTICLE_OPTIONAL_DRAW_CAPABILITIES,
  ...Object.values(LOOP_FRAME_EFFECTS),
];
