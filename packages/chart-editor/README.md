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
`compressChartSelection` packs distinct selected times into consecutive ticks,
preserving simultaneous notes and rejecting connector reordering across
unselected points. `pasteAuthorSelection` accepts an optional horizontal
lane shift; the host can stage its returned project before committing it.
`mirrorAuthorClipboard` reflects lanes, flick directions and both easing edges
while retaining automatic controls and clipboard provenance.
`splitNoteLine` creates two connectors at one interior control; `joinNoteLines`
joins selected tail/head pairs of the same kind, merging coincident boundaries.
`repeatLinePattern` repeats a selected path of at least three controls forward
inside its connector while keeping the authored tail. `lineTraces` samples a
connector at the requested whole-note division, optionally keeping the source.
The host may provide its native curve sampler. Both generators retain ownership
and limit each transaction to 100,000 generated notes.
`interpolateChartTimeScales` fills intervals between selected speed events on
the whole-note grid, updating existing events at generated ticks.
Structural edits retain group/layer ownership and source records. Different forced note
speeds reject the join. The host may supply native resolved geometry for a split.
`resizeChartSelectionByDelta` applies one width delta to the selection while
keeping each note's opposite edge fixed and retaining width differences.
Stage bounds limit the whole group; automatic points resolve from the unchanged
source before resizing. The host provides its lane grid for boundary clamping.
`insertLinePoint` inserts a single visible, hidden or automatic middle control,
preserving endpoints, same-tick controls and connector group/layer ownership.
`setLinePointMode` changes selected interior controls using their resolved source
geometry. Automatic controls keep the authored interpolation marker.

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
