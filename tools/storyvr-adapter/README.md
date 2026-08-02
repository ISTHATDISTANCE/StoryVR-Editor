# StoryVR Adapter

This folder implements the canonical StoryVR ingestion boundary. The primary
workflow normalizes one prepared story resource folder at a time into a StoryVR
runtime payload.

## Boundary

The adapter entry point is:

```js
import { importStoryAssets } from "./tools/storyvr-adapter/storyvr-adapter.mjs";

const runtime = await importStoryAssets("/absolute/path/to/story-folder", "dev");
```

It returns a `StoryVRRuntimeInstance` payload with:

- `contentUnits`: normalized beat-like story units from `beats`, `pages`, `sourceBeats`, `regions`, or Louise `data/beats.json`.
- `sceneTopology`: normalized route stops, regions, countries, markers, model groups, sections and camera presets.
- `assets`: normalized model, texture, data, media and remote asset references.
- `pointCloudEffects` (optional): explicit model-plus-PCD composite effects reconstructed from analyzer evidence.
- `sourceSpatialPlacements` (optional): independent per-object transforms flattened from captured source layout evidence.
- `assetRoot`: centralized original/dev/hosted/build/filesystem path conventions.
- `interactions`: controls, lifecycle, trigger and hotspot metadata.
- `diagnostics`: non-fatal compatibility findings.

## Commands

```sh
npm run storyvr:story -- --resource-folder ../<story-slug>/captures/active
npm run storyvr:scan
npm run storyvr:migrate
npm run storyvr:migrate:build
```

## Single Story Workflow

### Normalize a prepared folder

Run the single-story command from the standalone StoryVR repository after the
story's prepared resource folder exists:

```sh
npm run storyvr:story -- \
  --resource-folder ../<story-slug>/captures/active \
  --out ../<story-slug>/discovery/storyvr-runtime.json
```

This normalizes only the supplied resource folder and keeps the resulting
runtime inside the sibling story container.

## Repository Compatibility Commands

`storyvr:scan` is a compatibility helper for the existing multi-story workspace. It writes `tools/storyvr-adapter/out/migration-report.json` without writing per-story runtime files.

`storyvr:migrate` writes dev-mode canonical runtime JSON to:

```text
tools/storyvr-adapter/out/<family>/<story-slug>/storyvr-runtime.json
```

`storyvr:migrate:build` writes build-mode canonical runtime JSON to:

```text
tools/storyvr-adapter/out-build/<family>/<story-slug>/storyvr-runtime.json
```

## Included Families

- `global-migration`
- `web2VR-Initial-Adaptations/*`
- `louise-10-stories/*`
- `Jingchen-10-stories/Story_*/*`

## Exclusions

Virtual walk stories and sports stories are skipped before parsing. The current scan-time convention uses folder/path names:

- Virtual walk: `virtual-walk`, `walk-tour`, `walking-tour`
- Sports: `world-cup`, `super-bowl`, `usmnt`, `pulisic`, `kadarius`, `toney`, `richarlison`, `messi`, `mckennie`, `batshuayi`, `spain-germany`, `canada-belgium`

Skipped stories are listed in the migration report with an explicit reason and never enter the adaptation pipeline unless `--include-excluded` is passed manually.

## Structural Conflicts Normalized

- Instance schema divergence: `beats`, `pages`, `sourceBeats`, `regions`, and `data/beats.json` become `contentUnits`.
- Runtime import divergence: JSON is parsed directly; generated JS is imported only from known story-instance files.
- Asset-root divergence: original, app-relative, repo-hosted, filesystem and build-base paths are emitted together.
- Topology divergence: route stops, regions, countries, model groups, markers and object lineups are carried into `sceneTopology`.
- Interaction divergence: reader actions, transitions, hotspots, controller and keyboard metadata are carried into `interactions`.

PCD files remain ordinary captured assets unless `story_structure_candidates.json` also declares a valid `storyvr-pointcloud-composite-effect/v1` record with `scope.activation: "explicit-source-ptcloud-link-only"`. The adapter never infers a point-cloud effect from a `.pcd` file or from missing story data. Unsupported, incomplete, or unrelated records leave `pointCloudEffects` absent, preserving the existing runtime shape for other stories.

GLBs remain independent spatial assets. When captured source layout evidence is available, the adapter bakes its shared framing into each object's position, rotation, and scale; it never emits an authoring or runtime assembly.

Existing per-story runtimes remain untouched. This adapter creates the normalized StoryVR payload that a shared `createScene(...)` renderer can consume next.
