# `@haneoka/chart-editor`

Framework-neutral chart-authoring core with project models, timing, validation,
undo history, waveform analysis, viewport helpers, and format adapters.

Supported formats:

| Format | Import | Export |
| --- | --- | --- |
| Haneoka Project JSON | Yes | Yes |
| SS JSON | Yes | Yes |
| Universal Sekai Chart | Yes | Yes |
| SUS | Yes | No |
| Sonolus `LevelData` | Detect only | No |

```ts
import { importChart, serializeProjectJson } from "@haneoka/chart-editor/formats";
import { validateProject } from "@haneoka/chart-editor/validation";

const { project, warnings } = importChart(sourceText);
if (validateProject(project).valid) {
  const saved = serializeProjectJson(project);
}
```

Timing uses 480 integer ticks per quarter-note beat. `parseBeatTick` accepts
beat decimals and sums of fractions such as `75+1/480`, rejecting positions
between ticks. The site names subdivisions per whole note: `1/1920` is one
tick, while the authoring helpers retain per-beat defaults and accept
`4` as their final `beatsPerUnit` argument for whole-note grids. Snapping,
selection nudging, and generated line points share the same grid basis.

The host provides the user interface, files, storage, and audio decoding.
Conversion warnings must be shown to the user.

Authoring keeps single notes and line endpoints entirely within the stage.
Interior line points may extend outside it while retaining positive overlap;
zero-width markers stay within the closed stage boundaries. Group movement
preserves relative spacing. Imported geometry is retained until its span or
endpoint role changes.

```sh
pnpm --filter @haneoka/chart-editor typecheck
pnpm --filter @haneoka/chart-editor build
```

Licensed under [MPL-2.0](LICENSE). Preserve the included Next-SEKAI license
notices when redistributing adapted files.
