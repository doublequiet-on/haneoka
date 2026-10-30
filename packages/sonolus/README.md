# Haneoka Sonolus service adapter

The website keeps release-backed catalog, level-template and runtime chart-data
providers here. Chart conversion is re-exported from
`@haneoka/cassiopeia-plugin-sonolus`; the four engine targets are published by
the independent `@haneoka/sonolus-our-notes` package. No engine or
chart-normalization copy is retained in this website package.

Use `pnpm sonolus:build` to build the locked native engine and assemble the
host's assets. Production HTTP routes and release storage remain website-owned.

The asset entry accepts the current materialized release through
`RESOURCE_BUILD_ROOT` or the selected local release pointer. It validates the
formal effect projection and reuses a content-addressed particle bake when those
inputs are unchanged. `pnpm sonolus:payload` assembles assets around an existing
complete engine build; `pnpm sonolus:build` also compiles the engine. FFmpeg and
ZIP are required by the sound pack builder.

Generated resources include the native engine's Haneoka MPL-2.0 license and
the preserved upstream Project SEKAI MIT notice.

Song previews use the game's MusicScoreShort audio, resolved from
`MasterLiveMusic._jingleSoundID` through its exact sound and cue-sheet records.
Rebuild the resource catalog to publish `previewUrl`; levels without an available
preview retain Sonolus's BGM preview behavior.

Long-note frame effects retain one authored animation cycle when every cycle in
the baked timeline matches. The engine loops that short effect while the legacy
timeline remains available to older engines. Sprites, particle channels, and
draw order are preserved; the final particle cache includes this producer and
its engine contract. Loop endpoints exclude the next cycle to prevent double
drawing at the seam.

## Client versions

The Worker and Node preview share `sonolusClientVersion`. Requests from
Sonolus 1.1.4 retain their version header; Sonolus 1.1.5 and requests without
a recognized client use the version declared by the adapter's `@sonolus/core`.
Both clients consume the existing engine v13 and resource schemas. The Worker
sets the negotiated header after reading its shared payload cache and returns
`Vary: User-Agent`.

Add older clients to `SONOLUS_SUPPORTED_VERSIONS` only after checking their
server and asset schemas. A client requiring different engine or item formats
needs its own payload and route projection.
