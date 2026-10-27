# Local computation API

The service runs Haneoka's public browser modules in Chromium. Team search,
evaluation, growth analysis and timelines use the website's Rust/WASM engine.
Chart images use the same native atlas, canvas renderer and export layout.
One job runs at a time; inventory inputs stay on the host running this service.

From the repository root:

```sh
pnpm install --frozen-lockfile
node scripts/build/team-builder-engine.mjs
node scripts/build/public-tools.mjs
pnpm --filter @haneoka/tools-service exec playwright install chromium
pnpm --filter @haneoka/tools-service start
```

The default address is `http://127.0.0.1:8765/v1`. Startup creates a private
`~/.cache/haneoka/tools-8765.headers` file with the request's Bearer header.
The token changes on restart. Set `HANEOKA_TOOLS_TOKEN` for a stable token.

```sh
curl -H @"$HOME/.cache/haneoka/tools-8765.headers" http://127.0.0.1:8765/v1
curl -H @"$HOME/.cache/haneoka/tools-8765.headers" \
  -H 'Content-Type: application/json' --data-binary @job.json \
  http://127.0.0.1:8765/v1/jobs
```

| Operation | Input | Result |
| --- | --- | --- |
| `search` | `request: EngineRequest` | `EngineResponse` |
| `evaluate` | `request: EvaluateRequest` | `TeamEvaluation[]` |
| `growth` | `request: EngineRequest` | `GrowthResult` |
| `timeline` | `request: ExplainRequest` | `Timeline` |
| `chart-image` | `songId`, `difficulty`, `locale`, `height` | PNG URL and dimensions |

Every job accepts `server` (`intl` or `jp`) and an optional `release`. A chart
image request is:

```json
{"operation":"chart-image","server":"intl","songId":"100001","difficulty":"expert","locale":"en","height":720}
```

`POST /v1/jobs` returns 202 and `Location: /v1/jobs/{id}`. Poll that location
until `state` is `completed` or `failed`. `progress` contains the latest engine
snapshot; `result` contains the calculation result. Images are read from the
returned `image` URL using the same Authorization header. `DELETE` cancels and
removes the job. Completed results expire after ten minutes; restarting clears
the queue and results. There are at most eight pending jobs and sixteen retained
jobs. Bodies are limited to 2 MiB; execution is limited to five minutes.

The browser contract is generated at `/tools/schema.json` from the actual
TypeScript interfaces. `$defs` contains `EngineRequest`, `EngineResponse`,
`EvaluateRequest`, `ExplainRequest`, `GrowthResult`, `TeamEvaluation`, `Timeline`.
The browser modules can also be called directly, without this HTTP service.

Set `HANEOKA_API_BASE` to another Haneoka API root, such as
`http://127.0.0.1:8781/api/v1/`, to use a local release preview. `PORT`, `HOST`
and `CHROMIUM_EXECUTABLE` configure hosting. The default binds loopback.

For a hosted native image renderer, put this service behind HTTPS with a fixed
`HANEOKA_TOOLS_TOKEN`. Set the website Worker's `TOOLS_SERVICE_URL` to the service
root and `TOOLS_SERVICE_TOKEN` to that token. The Worker uses authenticated
`GET /v1/chart-image`, pins the resource release and caches successful PNGs.
The website uses its Browser binding by default; these settings select a private renderer instead. Device-side image export
uses `/tools/chart-image.js` directly.

Resource image export uses `POST /v1/resource-image` with the same private header:

```json
{"kind":"live2d","id":"001_casual_spring_01","data":{"server":"intl","time":0}}
```

Kinds are `team`, `gacha`, `gacha-history`, `stamp`, `chart`, `live2d` and `spine`.
The `data` types and complete recipes are in `/tools/schema.json` and the
[image export guide](https://docs.haneoka.org/guides/image-exports/). Run
`pnpm runtime:cubism:provision` before Live2D export. The renderer serves the
locked local runtime and tool modules, and reads media from `HANEOKA_API_BASE`.
PNG is returned directly; `gacha-history` with `archive: true` returns every
report page in a ZIP. Input is limited to 8 MiB and output to 16 MiB; synchronous
image execution has a 50-second deadline. Resources remain on the configured
API origin. For queued images use `operation: "resource-image"` and put the
image object in `request`; `/v1/jobs` retains its 2 MiB body limit. Use the
returned image URL (`image.png` or `images.zip`).

The public website exposes these operations on resource paths such as
`/api/v1/team-builder/image.png`, `/api/v1/stamps/image.png` and
`/api/v1/live2d/{id}/image.png`. Browser callers use `/tools/images.js` with
`fonts.css` and `image-theme.css`, either rendering on the device or sending
the same recipe with `requestResourceImage`.
