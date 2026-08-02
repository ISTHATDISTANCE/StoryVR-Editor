# NYT Animation Logic Probe

Experimental pipeline for collecting and judging animation behavior in live NYTimes visual/interactive stories.

## 1. Collect runtime evidence

Open the source NYT story in Chrome, then paste `runtime-animation-collector.js` into DevTools Console. The page shows a small StoryVR capture panel. Click **Enable full-page capture**, choose **This Tab** in Chrome's share dialog, and approve. Auto-scroll starts after approval and downloads:

```text
nyt_animation_probe_<story-slug>.json
```

Manual controls are available after pasting:

```js
NYTAnimationProbe.enableViewportCapture()
NYTAnimationProbe.autoRun()
NYTAnimationProbe.autoScroll()
NYTAnimationProbe.exploreVariants()
NYTAnimationProbe.snapshot()
NYTAnimationProbe.export()
NYTAnimationProbe.stop()
NYTAnimationProbe.runtime3D()
NYTAnimationProbe.runtime3DCatalog()
NYTAnimationProbe.registerRuntime3D({ renderer, scene, camera, mixer, models })
NYTAnimationProbe.refreshRuntimeHooks()
```

The collector does not read cookies, localStorage, sessionStorage, credentials, or private browser state. It does capture the pixels visibly displayed in the shared tab, so close account menus, notifications, or other visible personal overlays before enabling capture.

The collector now installs best-effort Three.js runtime instrumentation. When the page exposes a reachable Three namespace, renderer, scene, GLTF loader, or animation mixer, every snapshot includes `runtime3D` with:

- `captureStatus`: `ok`, `partial`, or `unavailable`, plus a reason and explicit limitations.
- All observed model roots, including hidden/preloaded roots, with stable runtime IDs and asset-identity provenance.
- On-canvas `renderEligible` GLBs and renderable parts after checking self/ancestor visibility, a recent screen render, renderer-canvas CSS/viewport visibility, camera layers, material visibility, and material opacity.
- Separate `renderContributionCandidate` roots, parts, actions, and cameras for active offscreen render targets that may reach the visible canvas through a compositor/postprocessing pass.
- All bounded `AnimationAction` states, while `playingAnimations` excludes paused, finished, disabled, and zero-weight actions.
- Mixer time and `update`/`setTime` driver observations, active camera state, and exact snapshot IDs.
- A bounded `recentAdvances` sequence for each mixer, so the analyzer can audit the observed method/value/scroll relationship instead of relying only on a one-line driver label.
- Stable part paths plus world-transform signatures, so rotation, translation, scale, visibility, and opacity changes can be compared within a beat even without an embedded GLB clip.
- Additive `storyvr-runtime-3d-observation/v2` spatial state: stable instance/container/parent/root-path identity; numeric local/world matrices and decomposed TRS; transformed model/part bounds; and hidden-loaded part states. Existing v1 model, visible-part, action, and camera fields remain present.
- A one-time `runtime_3d_catalog` with cached geometry-local AABBs, centers, bounding spheres, fingerprints, and model/part/source/frame references. Snapshots carry catalog IDs and changing poses rather than repeating static vertex-derived metadata.
- Bounded `spatialRelationshipClues` only when composition is corroborated by explicit bridge/source/config/frame/container identity, or by a shared direct non-scene parent plus direct asset identity. Co-loading, scene membership, and beat co-occurrence never create a clue.

For module- or closure-owned Three.js objects that are not reachable from `window`, the source runtime can register its live handles explicitly with `NYTAnimationProbe.registerRuntime3D(...)`. Registration is additive: it does not replace the collector's existing global discovery, and stories that do not opt in keep the previous collection path unchanged. The same bridge can be exposed as `window.__STORYVR_ANIMATION_RUNTIME__`, `Symbol.for("storyvr.animationProbe.runtime")`, or a runtime handle attached to the renderer canvas. A source module can also listen for `storyvr-animation-probe:request-runtime` and call the event's supplied `register` function.

The bridge may optionally provide explicit composition evidence without changing the scene:

```js
NYTAnimationProbe.registerRuntime3D({
  renderer,
  scene,
  camera,
  models: [
    {
      root: mars,
      assetUrl: "/mars.glb",
      instanceId: "mars",
      container,
      containerId: "mars-composition",
      compositionId: "mars-story",
      frameId: "mars-fixed-frame",
      frameRoot: mars,
      sourceId: "WEBGL_DATA",
      sourceConfigId: "mars-model-config",
      activeStateId: "mission-active",
      sourceConfig: { position: [0, -200, 0], scale: [20000, 20000, 20000] },
      anchorKind: "geometry-bounds-center"
    },
    {
      root: landerPin,
      assetUrl: "/lander.glb",
      instanceId: "lander-pin",
      container,
      containerId: "mars-composition",
      compositionId: "mars-story",
      frameId: "mars-fixed-frame",
      sourceId: "WEBGL_DATA",
      sourceConfigId: "mars-model-config",
      activeStateId: "mission-active"
    }
  ],
  compositions: [{ id: "mars-story", container, frameId: "mars-fixed-frame", members: [mars, landerPin] }],
  frames: [{ id: "mars-fixed-frame", root: mars }],
  spatialRelationships: [{
    subject: landerPin,
    reference: mars,
    relationshipType: "surface-placement-hint"
  }]
})
```

These values are hints and evidence boundaries, not collector-inferred semantics. `sourceConfig` is serialized through a small transform/config allowlist. Relationship rows preserve the explicit type but remain `candidateOnly`; the offline analyzer decides whether geometry and repeated relative transforms support a spatial relationship.

`renderEligible` means the sampled scene/material state allowed the primitive to render in a recent on-canvas screen pass. It does not prove that the object was inside the camera frustum, unoccluded, unaffected by shader clipping, or responsible for visible pixels. `renderContributionCandidate` is weaker: it means an active offscreen pass may feed the visible canvas, not that the final compositor displayed it. Non-renderable animation driver nodes remain action targets; they are never labeled as visible model parts.

The auto-scroll collector takes a second forced stationary snapshot about 220 ms after every settled scroll snapshot. These paired samples let the analyzer test whether action time advances while scroll is fixed. Override the interval with `NYTAnimationProbe.autoScroll({ driverSampleGapMs: 300 })`, or set it to `0` to disable paired samples.

Version 0.15 auto-scroll uses three ordered traversal phases. Pass 1 moves top to bottom over a page-height grid, DOM-derived story-beat targets, and dynamically discovered controls; it performs dependency discovery/capture with each control near the bottom of the viewport so changing content above the control remains visible. A passive recovery sweep then visits the same positions progressively from bottom to top without exploring variants or clicking controls. It compares each location with the Pass 1 discrete variant-state baseline and reports mismatches or bounded top-state repair; live canvas pixels, animated transforms, and animated opacity are excluded from exact recovery equality. Pass 2 starts only after recovery reaches the top and verifies or repairs the top baseline, then moves top to bottom again with controls top-aligned to capture and reconcile changing content below them. If recovery remains incomplete, the collector exports the Pass 1/recovery evidence as a partial run and skips Pass 2 so unrecovered state cannot confirm dependencies. Lazy document growth can append targets during Pass 1. `capture_coverage` retains the original detected/planned/visited/skipped and snapshot-limit fields and adds separate Pass 1, recovery, Pass 2, dependency, cycle-guard, and document-wide button-outcome counters.

By default, the collector captures one fully composited current-tab client-area image after settling at every planned scroll target. The primary image includes the WebGL canvas, HTML captions, CSS overlays, labels, and other visible page content. Each `scroll_target_screenshots` record carries a stable target index, target kind, scroll position, active text, snapshot ID, capture status, perceptual hash, and embedded WebP/JPEG/PNG data. It also builds larger labeled six-frame viewport contact sheets so captions remain readable during Codex inspection.

Full viewport capture uses the browser's display-media permission and requires a click/user gesture. The collector rejects window or monitor sharing because those surfaces do not match the browser client-area contract; choose **This Tab**. The shared video is kept local, sampled into the downloaded JSON, and stopped after auto-run exports. Disable screenshots only for debugging with `NYTAnimationProbe.autoScroll({ captureScreenshots: false })`. The explicit `allowCanvasFallback: true` option keeps the old canvas-only behavior when full-tab capture cannot be used.

The largest visible WebGL canvas is still copied and hashed at each target, but only as `canvasCrop` secondary diagnostic evidence. Viewport pixels directly support visible scene-state claims; neither the viewport nor canvas crop alone identifies the exact GLB, node, clip, hidden/offscreen state, or playback driver.

Pasting the collector again stops the previous run and replaces its renderer/loader/mixer wrappers with hooks owned by the new collector state. This keeps a repeated capture from silently writing runtime events only into an older in-page probe instance.

Calling `autoScroll()` again resets run-specific coverage, screenshots, variant registries, interactions, associations, hierarchy, recovery baselines, and traversal records while retaining prior snapshots as cumulative evidence. Use `stop()` to cancel timers/listeners, then export the partial run with its coverage status.

`snapshot.modelUrls` remains cumulative resource/preload inventory. It is never treated as direct visibility when `runtime3D` is unavailable. A late install or a module-scoped/cross-origin Three.js runtime may produce `partial` or `unavailable`; that is different from `ok` with an observed empty visible-model set.

The collector also exports optional `variant_groups` for source widgets that expose multiple mutually exclusive states. Detection covers Previous/Next controls, semantic tab/radio/listbox controls, bounded clusters of short story-option buttons, repeated option/panel structure, and repeated accessibility selection announcements. Story-local button-only `<nav>` elements are accepted while masthead, menu, share, footer, form, link, and other page-chrome controls remain excluded. Direction can come from accessible text, stable attributes/classes, or the horizontal order of an otherwise unlabeled two-icon control pair. A directional carousel may initially expose only one option node. Version 0.15 observes every safe probe-driven button click across the whole current document tree instead of using the candidate group's local root to decide whether the click worked. It assigns persistent node identities plus parent child-order records across the main document and open shadow roots, snapshots window and every element's `scrollLeft`/`scrollTop`, rediscovers open shadow roots attached during the click, and observes subtree mutations and scroll events until quiet. A click outcome is accepted only after both DOM and scroll channels are quiet and at least one has a persistent before/after change. Closed shadow roots and iframe document trees remain outside the current-document observation. The collector-owned prompt is excluded. `variantDocumentQuietMs` controls the post-activity quiet interval and defaults to 180 ms. Each v2 `variant_interactions` record exposes `outcomeObservationScope: "document"`, `outputChangeKinds`, and per-exploratory-click `outcomeObservations`; recovery-click observations remain summarized in `capture_coverage`. Coverage totals document-wide observations, changes, mutations, scroll events, and unsettled outcomes. Cycle and restoration checks project the whole-document snapshots onto the DOM elements and scroll containers that settled clicks actually changed, so later unrelated page changes and unsettled churn do not define a variant or strand restoration. A settled unrelated page change that happens in the same click window is inherently indistinguishable from causal output, but it is never used to widen dependency scope. Relationship scope is used only to determine candidate button dependencies. Separately, group-local discrete fingerprints support passive recovery baselines; neither is a click-outcome gate. For Previous/Next groups, a stable WebGL-only visual change can supplement the document state; its sampling is also document-wide and is rejected while runtime animation or changing samples make it time-dependent. The interval is configurable with `variantVisualStabilitySampleMs`. Detection uses control labels, selected/visible state, source order, bounded text/state, and model URL attributes; it does not depend on story names or asset filenames. Group identity excludes changing option labels and instead uses explicit control IDs where available plus control kind, bounded semantic control/story lineage, and a structural sibling position when no explicit ID exists. Previous/Next, button-cluster, and semantic runtime references are rediscovered by that identity after reactive remounts. The same groups are copied into `storyvr_author_input.variant_groups`. They describe within-beat state selection, not narrative successor branches.

During either active pass, the collector treats every safely selectable variant as one normal beat-like observation: it activates the option, waits for settled page/runtime state, captures a snapshot, records option-local DOM model references plus directly render-eligible runtime models on canvases owned by that variant root, explores any causal child while the parent option remains active, and restores the widget's initial state. Page-global or unrelated renderer canvases are never attributed to every option. Pass 1 may also perform DOM/runtime-only eager probing of already mounted controls, while its bottom-aligned control visits capture changing content above. Pass 2 repeats the verified control visits top-aligned and reconciles changing content below. Full composited per-option frames are stored in `variant_state_screenshots` when tab capture is enabled, with canvas fallback only when explicitly allowed; the analyzer extracts these under `variantObservation.visualObservation`. `explorationPhase`, association `capturePhases`, and `visualEvidenceRefs` make the active passes auditable without duplicating option associations. The recovery sweep never invokes variant exploration or clicks. Exploration is bounded to 12 options per group and rejects links, submit controls, form controls, hidden/disabled controls, or any click that changes the page URL. Button identity is canonicalized independently from changing accessibility phrases such as `selected` or `not selected`, and selected state uses explicit ARIA state or exact class tokens so a class such as `not-checked` cannot be mistaken for `checked`. The console reports every `variant click`, success, skip, and failure; `capture_coverage.variantClickAttemptCount` and `variantClickSuccessCount` provide the exported totals.

While each parent option is active, the collector rediscovers reactive controls and explores causal children immediately by depth-first search, preserving the exact parent-option interaction path. Candidate comparison uses the union of controls before and after the parent click, so appearance, disappearance, option-set/selection changes, stable owned DOM state, discrete owned-runtime model/root/asset identity, and reactive remounts are observable. Continuously changing child-canvas pixels, world transforms, visibility, and opacity remain captured visual evidence but cannot by themselves establish causality. A shared section, container, or localized sibling relationship only limits the search scope; it never proves hierarchy. Except for an explicit control target, an edge is confirmed only after the same parent-option/child change reproduces across both active passes; repeated eager/aligned clicks inside Pass 1 alone leave candidate evidence tentative. `variant_hierarchy` keeps the change kinds, observation count, phases, pass families, `confirmed` flag, and confirmation reason; only confirmed edges mark a group as nested. DFS depth, a 600 exploratory-transition run budget, and graph-cycle guards prevent recursive control networks from looping, with rejected cycles exported in `variant_dependency_cycles` and budget use exported in `capture_coverage`. Bounded restoration clicks remain allowed after that exploratory budget is reached and are counted separately so a safety limit cannot strand the story in a changed state. Each association stores a bounded `visualState` containing visible visual labels and directly referenced model URLs. Confirmed nested associations include `parentGroupId`, `parentOptionId`, `interactionPath`, `dependencyConfirmed: true`, and `relationship: "visual-child"`; unconfirmed observations remain `candidate-visual-child` audit evidence rather than establishing nesting. `variant_interactions` audits attempted states and restoration, while `variant_asset_associations` remains the explicit per-option asset contract. `snapshot.modelUrls` remains preload inventory and is never used as variant identity. Set `exploreVariants: false` to disable active probing during auto-scroll, or call `NYTAnimationProbe.exploreVariants()` for an immediate document-wide safe-control pass.

The raw probe also exports `scroll_traversal`, with ordered phase, direction, target index/position, target kind, and recovery mismatch IDs for each visited location. `variant_recovery` summarizes recovery status, baseline/planned/visited target counts, mismatches, and repair attempts/failures. Dependency totals and cycle-guard totals are duplicated in `capture_coverage` for quick completeness checks, while `variant_dependency_cycles` preserves the parent group, parent option, proposed child, phase, and rejection reason for each guarded edge.

The analyzer gives a non-empty collector-verified option association precedence over generic option attributes and preserves multiple assets when the manifest contains them. Only confirmed collector child dependencies from a verified/repaired recovery run are folded into the corresponding parent option and allowed to suppress the child control as an independent group; candidate or unrecovered child evidence remains auditable without creating Source Graph nesting. When runtime collection and source/accessibility evidence describe the same positioned control with strong partial option-label overlap, source-linked assets fill the matching runtime options without requiring both observations to expose an identical option set. Complementary DOM and accessibility observations with an exact option-label signature, compatible title, and nearby source position are merged even when one classifies the control as a `button-cluster` and the other as a generic `single-select`; the collected DOM group remains canonical and accessibility evidence is retained as fallback provenance. Empty contextual runtime asset lists never erase a non-empty label-matched source association. For older captures without interaction paths, an aggregate accessibility card cluster is folded only when its title names an option in the nearest preceding selector; the named option receives the cluster assets and sibling options receive only semantic label matches from their own text. If safe interaction could not establish an option asset, the analyzer otherwise falls back conservatively to source attributes, repeated selected-state announcements, multiple high-confidence `direct-source-config` model associations that share one source position and group label, or a shared model beat with repeated accessibility card labels and independently associated assets.

## 2. Analyze and judge

Run the analyzer from the repo root:

```sh
node tools/animation-logic-probe/analyze-animation-probe.mjs \
  --input /path/to/nyt_animation_probe_<story-slug>.json \
  --story-folder <story-slug>
```

The analyzer writes:

```text
<story-slug>/analysis/animation-logic-probe/<timestamp>/animation-evidence.json
<story-slug>/analysis/animation-logic-probe/<timestamp>/codex-animation-judgment.json
<story-slug>/analysis/animation-logic-probe/<timestamp>/animation-logic-summary.md
<story-slug>/analysis/animation-logic-probe/<timestamp>/scroll-target-screenshots/manifest.json
<story-slug>/analysis/animation-logic-probe/<timestamp>/scroll-target-screenshots/frames/*
<story-slug>/analysis/animation-logic-probe/<timestamp>/scroll-target-screenshots/canvas-crops/*
<story-slug>/analysis/animation-logic-probe/<timestamp>/scroll-target-screenshots/contact-sheets/*
<story-slug>/captures/active/metadata/story_structure_candidates.json
<story-slug>/captures/active/metadata/asset_manifest.json
```

Model URL discovery is provenance-aware and staged. Absolute browser/runtime resources and captured loader scripts are downloaded first. A quoted source-config value such as `models/scene.glb` remains unresolved until the analyzer inspects those loader scripts for statically observable URL construction through template prefixes, string concatenation, `new URL(...)` bases, or directory literals. Derived candidates are tried in evidence order and accepted only when the response contains valid GLB or glTF bytes; article-relative resolution is retained only as a last-resort, auditable fallback. `animation-evidence.json.assetDiscovery` records the raw reference, chosen base, resolution kind, validated URL, and any unresolved references. This avoids story- or CDN-specific URL hardcoding.

Static GLBs remain independent by default. The analyzer emits a `storyvr-source-spatial-composition/v1` composition only when numeric placement is bounded by an explicit bridge/source configuration, frame, composition, or non-generic container. A complete bounded source configuration may establish its own virtual coordinate frame when every declared member has a direct unambiguous asset identity, an invertible source matrix, explicit active-state membership, parsed intrinsic GLB bounds, and a known loader-transform policy. The entire configuration is normalized once from content framing bounds while every member retains its full source-frame matrix, including relative position, rotation, and scale. Enclosing environment members are excluded from content framing when story screenshots support that semantic role or transformed geometry clearly contains the anchor; their captured size is never replaced by screenshot estimation. Same beat, preload membership, broad scene membership, proximity, filenames, and Codex prose never establish composition.

The analyzer parses scene roots, node matrix/TRS values, and every primitive's `POSITION` accessor bounds. It computes scene-transformed bounds rather than treating raw accessor bounds as loaded geometry. A raw bound is eligible only when mesh-node transforms are proven identity. When fetched loader code proves the exact operation `reset-immediate-child-scale` on `first-scene-child-children` (`gltf.scene.children[0].children`), it also computes bounds with scale reset at that exact depth and records both the operation and target. This preserves source placement while avoiding an unsafe assumption for unrelated loaders.

Source-only acceptance is allowed without repeated runtime samples when one bounded `models` plus `highlights` configuration supplies direct identities, exact transforms, active-state membership, and safe parsed GLB bounds for every declared member. Specific surface-marker and state-counterpart geometry remains useful semantic evidence, but is not required merely to preserve a complete source configuration's coordinate frame. Runtime-only acceptance still requires direct asset identity, an explicit meaningful frame/bridge basis, stable repeated relative matrices, and corroborating geometry. Ambiguous runtime reference candidates remain candidate-only. Plausible surface anchors must be bounded, roughly isotropic, centered after their source transform, and topologically small enough to exclude broad multi-part overlays.

`animation-evidence.json` includes `runtime3DCatalog`, canonical `spatialCompositionCandidates`, accepted `sourceSpatialCompositions`, and `spatialCompositionSignature`. Each accepted member has an immutable numeric `resolvedLocalMatrix`, a `transformRef`, intrinsic bounds, source active-state IDs, role, and any exact loader-transform policy. Source-configuration compositions declare `framing.coordinateSpace: "source-config-local"` and `framing.compositionBounds`; the author envelope adds `framing.contentBounds`, enclosing `environmentInstanceIds`, and size-inference provenance. Other accepted compositions retain reference-local matrices. Accepted compositions also include `framing.anchorInstanceId`, framing exclusions, typed relations with `predicate`, provenance, confidence, and runtime-validation state. `codex-animation-judgment.json.spatialCompositionJudgments` contains one row per candidate, but Codex may add only semantic labels, visual framing roles, confidence, and reasoning; normalization restores deterministic acceptance and transform fields.

When author input contains accepted compositions, `story_structure_candidates.json` adds:

```text
source_spatial_compositions:
  schemaVersion: storyvr-source-spatial-composition/v1
  signature: <semantic placement signature>
  compositions: [...]
```

This envelope is omitted entirely when nothing is accepted. Every accepted composition uses `placementPolicy: "source-locked"`, includes all declared persistent base/context models, and maps final author slides to `activeSetsByBeat`. Canonical beat keys use an explicit slide `id`/`beatId` when present and otherwise `slide-1`, `slide-2`, and so on; raw probe beat IDs are retained only as aliases. Each active set contains the matched state-specific model plus the declared persistent framing anchor and context.

Point-cloud composite effects are an optional specialization, not a new requirement for normal stories. The analyzer activates this path only when captured source configuration explicitly pairs a GLB model with a PCD asset through a key such as `models[].ptcloud`. It then matches that declared PCD against the collector's raw `resource_entries`, even when the collector classified the request as `other`, and uses a separate allowance of at most four PCD downloads with a 64 MiB per-file limit. This allowance never reduces the existing model/script/data download budget. A page that merely requests a `.pcd` without an explicit source link does not activate the specialization.

For the transmission-cough setup, the optional specialization validates and summarizes the PCD, preserves undeclared extra data columns, identifies a complete zero-based point-group column, and decodes the embedded GLB binary samplers for the `cough_driver_N` translation channels. The resulting threshold-crossing schedule is stored under `pointCloudEffects` in analysis/judgment output and rendered under `## Explicit Point-Cloud Composite Effects`. When author input is written, the PCD is copied to `captures/active/pointclouds/` and the optional `point_cloud_effects` contract links it to the existing model. It is not promoted into a normal GLB beat, and stories without an explicit point-cloud link do not gain an empty field, folder, warning, or missing-data requirement.

When `--story-folder` is passed, the analyzer also writes a StoryVR author-compatible fetched-resource folder at `<story-slug>/captures/active` if that folder is missing author metadata or was previously generated by this probe. Force that output with `--write-author-input`, choose another fetched-resource folder with `--author-input-folder`, or disable it with `--no-author-input`.

When variant evidence exists, `story_structure_candidates.json.variant_groups` preserves only top-level groups, including their title, source order, default option, control kind, per-option text, and linked asset IDs. Each option keeps its own assets and can therefore be edited as one normal beat-like state in Source Graph, while the enclosing group still remains a single narrative beat rather than becoming successor branches. A child group is folded into the exact parent option as `visual_children` only when a confirmed `variant_hierarchy` record or confirmed child asset association carries matching `parentGroupId` and `parentOptionId` evidence. Proximity, prose mentions, accessible card names, asset filenames, and container membership never create a hierarchy. Dependent-looking groups without confirmed interaction-path evidence are retained separately in `unresolved_variant_groups` for audit and are not promoted to Source Graph beats. Aggregate accessibility text and aggregate visual beats are removed only when a verified top-level group accounts for enough option labels in the same DOM container or within a bounded source-position neighborhood. Future text units include their element selector and bounded ancestor selectors; older captures fall back to tag/class identity plus DOM order. Narrative copy before a verified option-label control run is split out and retained instead of deleting the whole selector container. StoryVR adapters collapse top-level option records into one `variant-group` beat and preserve nested audit data as `visualChildren`; stories without `variant_groups` keep the existing sequential import path. If a later Codex judgment phrases the same option evidence differently and yields no new group, an existing group is retained only when the current capture independently re-verifies the same story URL, at least two option labels in one current text unit, and every linked option asset. This prevents AI wording variation from erasing verified source structure without carrying stale groups into another story or changed asset set.

To convert an existing full analysis run into author input without re-downloading resources or re-running Codex:

```sh
node tools/animation-logic-probe/analyze-animation-probe.mjs \
  --input /path/to/nyt_animation_probe_<story-slug>.json \
  --story-folder <story-slug> \
  --from-output <story-slug>/analysis/animation-logic-probe/<timestamp>
```

`--from-output` first performs a deterministic offline refresh from the raw probe plus the existing output's local model/script downloads. It reparses current GLB scene/bounds metadata, re-detects exact loader-transform policy, rebuilds the spatial catalog/candidates/compositions and semantic fingerprint, then rewrites judgment normalization and author input. It never fetches or invokes Codex. This lets an older retained analysis gain spatial evidence without changing the original capture or relying on network availability.

After analyzing a probe into a story folder, open it in the authoring UI:

```sh
npm run storyvr:author -- --story-folder <story-slug>
```

`codex-animation-judgment.json` includes `modelBeatAssociations` with one normalized beat-association entry for every detected model relationship, animated or static. A failed or unavailable GLB parse remains represented with `parseStatus: "failed"` and stable diagnostic codes instead of silently disappearing. Extensionless resources are recognized from model hints and glTF magic bytes. Each association includes `assetUrl`, `assetFile`, `hasEmbeddedAnimation`, `associatedBeats`, `associationConfidence`, `associationSource`, `reasoning`, and `evidenceRefs`.

Both `animation-evidence.json` and the normalized `codex-animation-judgment.json` include deterministic `beatRuntimeStates` when the new collector state is available. Each ordinary beat is keyed by primary active text plus scene/slide/step identifiers. A snapshot captured while a variant option is active also contributes its `variantGroupId`, `variantOptionId`, and full `interactionPath` to that key, so two options with identical visible text cannot be merged into one runtime state. Each state contains:

- The contributing snapshot IDs and scroll range.
- Directly observed on-canvas render-eligible GLBs, separately observed offscreen contribution candidates, and hidden/preloaded GLBs.
- Visible renderable parts with node ID/path, visibility/material state, and provenance.
- Directly sampled part motion or material-opacity changes across the beat, even when the GLB has no embedded animation clip.
- All action states plus the actions that were actually playing.
- Per-action playback mode (`time-based`, `scroll-based`, `state-based`, `mixed`, or `unknown`), action-time range, target-node names, directly matched visible targets, and confidence/reasoning.
- On-canvas and offscreen active camera state.
- Per-beat field truncation metadata, so omitted sampled details are not treated as a negative observation. Global capture coverage is retained under the source-probe/runtime summary metadata.

Normalized variant options keep runtime and structural asset evidence separate. `runtimeAssetIds` / `runtimeAssetUrls` preserve the runtime-identity channel and count as direct evidence only when its capture status is `ok` or `partial`; `domAssetIds` / `domAssetUrls` record visible DOM/resource links. The broad `asset_ids` / `asset_urls` union remains available for Source Graph authoring, but it is not direct-runtime proof. Each channel retains its provenance, capture status, and snapshot IDs so later Attention Guidance inference can compare runtime changes with semantic links without relabeling preload or DOM evidence.

The analyzer copies this structure into the final judgment deterministically; Codex interprets semantics but cannot replace direct runtime observations. `animation-logic-summary.md` renders it under `## Beat Runtime State`.

The analyzer extracts embedded viewport screenshots and secondary canvas crops from the probe JSON, removes the base64 payloads from `animation-evidence.json`, and links each successful or failed visual record back to its beat as `visualEvidence`. It attaches up to 24 deterministic viewport contact sheets to local Codex using `--image`; if contact sheets are unavailable, it evenly samples the individual viewport frames instead. Canvas crops remain inspectable on disk but are not substituted for the primary viewport sequence.

Visual evidence has a deliberately narrow meaning: it directly shows pixels at a scroll target. Exact asset/node/clip identity still comes from runtime instrumentation or fetched source/config. Changes across target images support scroll-correlated visual change, while fixed-time playback still needs same-scroll temporal samples or source/mixer evidence.

Model/beat confidence is calibrated accordingly. Without direct runtime identity, inferred associations are capped at `0.85` when target screenshots exist and `0.72` when neither direct runtime nor visual identity evidence exists. An association based entirely on explicit source configuration may reach `0.95`. The output records the applied ceiling and reason in `confidenceCalibration`.

When direct runtime state is unavailable or a directly observed beat has truncated/missing part or action fields, the v3 judgment adds a separate `inferredBeatAssetStates` array. Each record can supply, for one model-associated beat:

- model state (`visible`, `active`, `hidden`, or `unknown`);
- named/path-addressed parts and their state;
- animation/clip state plus `time-based`, `scroll-based`, `state-based`, `mixed`, or `unknown` driver mode;
- the granular scroll driver when known;
- field-level provenance, confidence, reasoning, and evidence references.

These inferred records never overwrite `beatRuntimeStates`. A directly hidden model or an authoritative observed-absent model suppresses contradictory inference. A complete direct part/action field suppresses the matching inferred field; an incomplete direct record can be supplemented and is marked `supplementsDirectRuntime`. Offscreen-render candidates remain inferred and carry the compositor caveat. Unknown is preserved whenever source/runtime evidence cannot establish visibility or playback.

Model/beat provenance is field-specific:

- `direct-runtime`: exact snapshot plus runtime model/node/action identity.
- `direct-source-config`: fetched code or configuration explicitly maps the asset to a beat but does not prove instantaneous visibility.
- `inferred-runtime`: temporal/caption correlation or an inferred runtime-root-to-asset identity.
- `inferred-source`: code structure or naming evidence.
- `inferred-preload-based`: cumulative resource inventory only.
- `unknown`: evidence did not settle the relationship.

When sampled runtime beats and fetched source/config add different valid beats for one GLB, the normalized association uses aggregate source `mixed`; each `associatedBeats` item still carries its own source and confidence. The JSON retains all current direct-runtime beat links. Source/Codex associations are bounded at 400 beats per model and report truncation metadata when that bound is reached. Markdown shows the first 12 and reports how many additional beats remain in JSON.

It also includes `imageBeatAssociations` for every accepted deterministic image group. Images are treated like static source assets: they receive beat links only, not within/inter dynamics classifications. The author-input `story_structure_candidates.json` uses both GLB and accepted-image beat associations when creating visual beats for the Source Graph step.

For animated or runtime-driven GLBs, `codex-animation-judgment.json` includes `glbAnimationInterpretations`. This is required to include trigger mapping and should explain embedded clip targets, camera paths, and fetched runtime JavaScript behavior that drives model transforms, visibility, material opacity, shader uniforms, scene state, camera state, or asset swaps. A GLB with no embedded animation is not automatically static; if runtime JavaScript animates or sequences it, the judgment should classify that behavior and link it to related beats. A GLB with no embedded animation, no camera path, and no runtime-driven behavior only needs beat association.

`animation-logic-summary.md` includes an `Animating GLB Judgments` section with one judgment bullet for every animated GLB model found in the story, including classification, scroll driver, confidence, caption/state counts, and associated beat content. Within-beat models should list one associated beat; inter-beat models should list the multiple caption/state beats they span when the evidence supports that mapping.

The summary also includes `GLB Beat Associations` with one entry for every detected model, `Inferred Beat Asset State` for the separate source/AI fallback, `Image Beat Associations` with one entry for every accepted image group, and `GLB Animation Interpretation` for animated or runtime-driven GLBs. Models without embedded clips are labeled `runtime-driven/no embedded animation` when direct runtime actions or sampled part motion/opacity changes are observed; otherwise they are labeled `no embedded animation observed` and receive beat associations without a forced dynamics classification. If all models appear in resource snapshots because the source page preloads GLB URLs, their associations are marked as `inferred-preload-based` unless fetched code or direct runtime state proves active ownership. When Codex judging is enabled, the summary also includes `Investigation Notes` tracing the fetched-resource behavior that led to the judgment.

Each model relationship in `animation-evidence.json` includes `hints.scrollDriver`:

- `time-based`: embedded GLB clips advance by mixer/frame time after activation.
- `local-scroll-window-progress`: scroll progress comes from local element/window visibility or progress through one story window.
- `slide-indexed-scroll-transition`: scroll changes slide/beat/window indexed states, highlights, cameras, clips, or object sets.
- `absolute-page-scroll`: progress is mapped directly from global page scroll values such as `scrollY`, `pageYOffset`, or `scrollTop`.
- `unknown`: the available evidence does not establish the driver.

Playback API and playback driver are deliberately separate. `mixer-time` or `AnimationMixer.update()` names an API mechanism, not necessarily fixed/time-based playback: a scroll handler can feed a scroll-derived delta into `update()`. The analyzer determines each action's playback mode in this order:

1. Direct paired runtime samples: repeated action-time advancement while scroll stays fixed is time-based; action time changing across scroll but staying fixed in stationary pairs is scroll-based.
2. Direct mixer observations such as `setTime` calls correlated with scroll.
3. Fetched-code formulas and the existing granular `scrollDriver` taxonomy.
4. `unknown` when elapsed time and scroll remain confounded.

The result stays per action/effect because one GLB can combine scroll-scrubbed clips with time-driven shader or ambient behavior. A running action on a hidden model never makes that model beat-active.

A single action-time jump at stationary scroll is not enough to prove fixed-time playback because a click or state update can also call `setTime()`. The analyzer requires repeated stationary advancement or an independently corroborating mixer-level time observation; otherwise it reports `unknown` or the directly observed state-based mode.

For StoryVR classification, a beat means a caption/state unit, not the whole WebGL scene/window. The deterministic fallback and Codex judge treat `local-scroll-window-progress` plus multiple runtime active-text states as `inter-beat-dynamics`, even when `modelSequenceChangeCount` is 0 and one persistent GLB carries the internal animation timeline. `time-based` playback remains within-beat by default unless caption/state evidence controls or brackets it.

By default it calls local Codex CLI with read-only sandboxing. The Codex step is expected to run read-only inspection commands over fetched scripts/data/models, trace GLB discovery, loading, visibility/swap behavior, runtime JavaScript behavior, mixer updates, camera paths, trigger mapping, and multi-GLB handling, then return a JSON judgment with `investigationSummary`. Use `--no-codex` to build evidence and a deterministic fallback summary without invoking Codex.

Before starting Codex, the analyzer serializes the complete prompt and enforces a 900,000-character target beneath the repository's 1,048,576-character input guardrail. It always removes duplicate prompt material first: relationship-level active-text arrays become counts plus representative samples because the full records already exist in `runtimeObservation.beatRuntimeStates`, and `resourceInvestigation` points to the same files listed in `downloads` instead of repeating the complete inventory. Static runtime model/part identity is emitted once in a compact `runtime3DCatalog`; beat states retain root transforms/bounds, visibility, changed parts, and playing animations, while repeated `spatialState.partStates` matrices stay only in the full evidence artifact and semantic cache fingerprint. The prompt evidence JSON is compactly serialized.

If the deduplicated prompt is still too large, deterministic `balanced`, `compact`, and `minimal` profiles progressively rank and reduce source-evidence contexts, per-beat part detail, runtime beats, and lower-priority downloads. After the minimal profile, a measured character-budget pass preserves the first/last and highest-signal model/animation/camera/change beats, then fills remaining capacity with even temporal coverage. The chosen profile, exact character count, included/total beat and part counts, target, and guardrail are logged and stored in `codex-animation-judgment.json.engine.promptBudget`. If even the minimal semantic core cannot retain safe headroom, the analyzer fails locally with a prompt-compaction diagnostic instead of sending an oversized Codex request.

Codex remains the implementation-adaptation layer: on an unseen NYT setup it follows that story's actual loader, scene manager, bundles, configuration, and animation code instead of assuming one standard architecture. Repeatability is handled separately by a semantic judgment cache:

```text
<story-slug>/analysis/animation-logic-probe/.codex-judgment-cache/
  storyvr-animation-codex-v9/<evidence-fingerprint>.json
```

The fingerprint includes downloaded resource byte hashes, source-evidence windows, GLB clip/target structure, deterministic source spatial placement and geometry, deterministic image inputs, scroll-target perceptual hashes, and beat-level visible model/part/action/driver semantics. It excludes raw screenshot bytes, generated timestamps, local/timestamped output paths, snapshot IDs, exact action times/scroll positions, spatial sample-count jitter, and other capture-timing jitter. Therefore:

- A new story, changed resource, changed visible GLB/part/clip, or changed playback mode causes a fresh Codex investigation.
- Semantically identical evidence reuses the first successful Codex judgment.
- Current `beatRuntimeStates` and normalized direct-runtime associations are always rebuilt from the current evidence; they are not read from the AI cache.
- Fresh and cached AI payloads receive the same stable engine metadata, and set-like judgment fields are deduplicated/sorted before output.

Use `--refresh-codex` to deliberately run Codex again and atomically replace the matching cache entry. Use `--no-codex-cache` to invoke Codex without reading or writing the cache. Failed Codex runs and `--no-codex` local-heuristic results are never cached.

Codex judging now runs without a script-imposed wall-clock timeout. The legacy `--codex-timeout-ms` flag is accepted for old command snippets, but it is ignored.
