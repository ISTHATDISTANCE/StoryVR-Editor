import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

const source = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function evaluateFunctions(names, exportedName) {
  const body = names.map(functionSource).join("\n");
  return new Function(`${body}\nreturn ${exportedName};`)();
}

const routeHelperFunctions = [
  "runtimeProgressionContext",
  "runtimeProgressionContextForRecord",
  "normalizeRuntimeProgressionRoute",
  "runtimeProgressionRouteIsScoped",
  "runtimeProgressionRouteKey",
  "runtimeProgressionRoutesMatch",
];

function routeHelperSource() {
  return routeHelperFunctions.map(functionSource).join("\n");
}

test("reader supports the generic layered texture-atlas material contract", () => {
  const factory = functionSource("createSharedTimelineMaterial");
  assert.match(factory, /recipe === "texture-background-fade"/);
  assert.match(factory, /backgroundColor:\s*\{ value: new THREE\.Color\(\)\.setRGB\(\.\.\.backgroundColor\) \}/);
  assert.match(factory, /fadeOpacity:\s*\{ value: finiteSharedTimelineNumber\(parameters\.fadeOpacity, 1\)/);
  assert.match(factory, /mix\(backgroundColor, textureColor, fade\)/);
  assert.match(factory, /fade \* showAmt \* storyvrOpacity/,
    "texture fades keep transparent blending while composing with reader opacity");
  assert.match(factory, /storyvrOpaqueAtUniform: sharedTimelineMaterialOpaqueAtUniform\(definition\)/);
  assert.match(functionSource("applySharedTimelineMaterialOpaqueAtUniform"), /storyvrBaseTransparent = nextTransparent/,
    "a story-local fade uniform may switch the source surface back to opaque at its declared threshold");
  assert.match(factory, /recipe === "layered-texture-atlas-scalar-field"/);
  assert.match(factory, /atlasColumns[\s\S]*atlasRows[\s\S]*sampleCount/);
  assert.match(factory, /sharedTimelineScalarFieldColorShader\(parameters\.colorRamp\)/);
  assert.match(factory, /uniform float sliceY;[\s\S]*uniform float showAmt;/);
  assert.doesNotMatch(
    factory,
    /slice_target_|slice_driver_|concentration-slice|classroom/,
    "the reader recipe is independent of any story's node names and atlas values",
  );
});

test("normalizes inline targets and assignment-array overrides", () => {
  const normalizeSourceMotionTracks = evaluateFunctions([
    ...routeHelperFunctions,
    "normalizeSourceMotionTracks",
    "uniqueStrings",
    "uniqueMotionTransitions",
    "normalizeMotionTransition",
  ], "normalizeSourceMotionTracks");

  const tracks = normalizeSourceMotionTracks({
    tracks: [
      {
        id: "clip-0",
        assetId: "model.glb",
        kind: "clip",
        componentId: "dynamic-geometry",
        clipIndex: 0,
        effective: { beatIds: ["inferred-beat"], transitions: [] },
      },
      {
        id: "camera-0",
        assetId: "model.glb",
        kind: "camera",
        componentId: "inter-beat-dynamics",
        effective: { transitions: ["beat-a->beat-b"] },
      },
    ],
    assignments: [
      {
        trackId: "clip-0",
        assetId: "model.glb",
        kind: "clip",
        componentId: "dynamic-geometry",
        beatIds: [],
      },
      {
        trackId: "camera-0",
        assetId: "model.glb",
        kind: "camera",
        componentId: "inter-beat-dynamics",
        transitions: [{ fromUnitId: "beat-b", toUnitId: "beat-c" }],
      },
    ],
  });

  assert.deepEqual(tracks[0].effective.beatIds, [], "an explicit empty assignment disables the inferred beat link");
  assert.deepEqual(tracks[1].effective.transitions, [{
    fromUnitId: "beat-b",
    toUnitId: "beat-c",
    fromBeatId: "beat-b",
    toBeatId: "beat-c",
  }]);
});

test("route-scoped source transitions sharing a beat pair remain distinct", () => {
  const uniqueMotionTransitions = evaluateFunctions([
    ...routeHelperFunctions,
    "uniqueMotionTransitions",
    "normalizeMotionTransition",
  ], "uniqueMotionTransitions");
  const transitions = uniqueMotionTransitions([
    {
      edgeId: "white-next",
      fromBeatId: "variants",
      toBeatId: "ending",
      fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
      toContext: { beatId: "ending" },
    },
    {
      edgeId: "tiger-next",
      fromBeatId: "variants",
      toBeatId: "ending",
      fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "tiger" },
      toContext: { beatId: "ending" },
    },
    { fromBeatId: "variants", toBeatId: "ending" },
  ]);

  assert.deepEqual(transitions.map((transition) => transition.edgeId || "legacy"), [
    "white-next",
    "tiger-next",
    "legacy",
  ]);
});

test("selects only assigned clip indexes with name fallback", () => {
  const clipIndexesForTrack = evaluateFunctions(["clipIndexesForTrack"], "clipIndexesForTrack");
  const clips = [{ name: "Idle" }, { name: "Open" }, { name: "Open" }];

  assert.deepEqual(clipIndexesForTrack({ clipIndexes: [2, 0, 99] }, clips), [2, 0]);
  assert.deepEqual(clipIndexesForTrack({ animationName: "Open" }, clips), [1, 2]);
  assert.deepEqual(clipIndexesForTrack({}, clips), []);
});

test("matches source transitions in authored direction only", () => {
  const motionTransitionMatches = evaluateFunctions([
    ...routeHelperFunctions,
    "motionTransitionMatches",
    "beatIdentitySet",
    "uniqueStrings",
  ], "motionTransitionMatches");
  const from = { id: "combined-a", atomicBeatIds: ["beat-a-1", "beat-a-2"] };
  const to = { id: "beat-b" };

  assert.equal(motionTransitionMatches({ fromBeatId: "beat-a-2", toBeatId: "beat-b" }, from, to), true);
  assert.equal(motionTransitionMatches({ fromBeatId: "beat-b", toBeatId: "beat-a-2" }, from, to), false);
});

test("source transition lookup selects the active route before the legacy pair fallback", () => {
  const select = evaluateFunctions([
    ...routeHelperFunctions,
    "motionTransitionMatches",
    "motionTransitionForBeatChange",
    "beatIdentitySet",
    "uniqueStrings",
  ], "motionTransitionForBeatChange");
  const from = { id: "variants" };
  const to = { id: "ending" };
  const legacy = { fromBeatId: "variants", toBeatId: "ending", clipIndex: 0 };
  const white = {
    edgeId: "white-next",
    fromBeatId: "variants",
    toBeatId: "ending",
    fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
    toContext: { beatId: "ending" },
    clipIndex: 1,
  };
  const tiger = {
    edgeId: "tiger-next",
    fromBeatId: "variants",
    toBeatId: "ending",
    fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "tiger" },
    toContext: { beatId: "ending" },
    clipIndex: 2,
  };
  const transitions = [legacy, white, tiger];

  assert.equal(select(transitions, from, to, white), white);
  assert.equal(select(transitions, from, to, tiger), tiger);
  assert.equal(select(transitions, from, to, {
    edgeId: "nurse-next",
    fromBeatId: "variants",
    toBeatId: "ending",
    fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "nurse" },
    toContext: { beatId: "ending" },
  }), legacy);
});

test("shared-timeline playback selects the boundary for the crossed variant route", () => {
  const resolve = new Function(`
    ${routeHelperSource()}
    ${functionSource("uniqueStrings")}
    ${functionSource("beatIdentitySet")}
    ${functionSource("motionTransitionMatches")}
    ${functionSource("motionTransitionForBeatChange")}
    ${functionSource("sharedTimelineStateForBeat")}
    ${functionSource("reverseSharedTimelineBoundaryMode")}
    ${functionSource("hasExplicitSharedTimelineNumber")}
    ${functionSource("normalizedProgress")}
    ${functionSource("sharedTimelineBoundaryForBeatChange")}
    ${functionSource("resolveSharedTimelineBeatChange")}
    return resolveSharedTimelineBeatChange;
  `)();
  const beat = (id) => ({ id, atomicBeatIds: [id] });
  const whiteRoute = {
    edgeId: "white-next",
    fromBeatId: "variants",
    toBeatId: "ending",
    fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
    toContext: { beatId: "ending" },
  };
  const tigerRoute = {
    edgeId: "tiger-next",
    fromBeatId: "variants",
    toBeatId: "ending",
    fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "tiger" },
    toContext: { beatId: "ending" },
  };
  const contract = {
    mode: "shared-timeline",
    assetId: "sharks.glb",
    beatStates: [
      { beatId: "variants", presence: "active", localProgress: 0.1 },
      { beatId: "ending", presence: "active", localProgress: 0.9 },
    ],
    boundaries: [
      { ...whiteRoute, mode: "scrub", startProgress: 0.1, endProgress: 0.35 },
      { ...tigerRoute, mode: "scrub", startProgress: 0.6, endProgress: 0.9 },
    ],
  };

  assert.deepEqual(
    [whiteRoute, tigerRoute].map((route) => {
      const playback = resolve(contract, beat("variants"), beat("ending"), { route });
      return [playback.boundary.edgeId, playback.startProgress, playback.endProgress];
    }),
    [["white-next", 0.1, 0.35], ["tiger-next", 0.6, 0.9]],
  );
});

test("reader keeps legacy playback and guards source cameras in WebXR", () => {
  assert.match(functionSource("createSourceAnimationPlayback"), /if \(hasSourceMotionLinking\)/);
  assert.match(functionSource("createSourceAnimationPlayback"), /createLegacySourceAnimationPlayback/);
  assert.match(functionSource("createLegacySourceAnimationPlayback"), /clips\.map\(\(clip\) => mixer\.clipAction\(clip\)\)/);
  assert.match(functionSource("sourceMotionTracksForBeat"), /track\.kind === "clip"/);
  assert.match(functionSource("sourceMotionTracksForBeat"), /sourceMotionTrackAppliesToComponent\(track, "dynamic-geometry"\)/);
  assert.match(functionSource("sourceTransitionForBeatChange"), /track\.kind !== "clip" && track\.kind !== "camera"/);
  assert.match(functionSource("sourceTransitionForBeatChange"), /sourceMotionTrackAppliesToComponent\(track, "inter-beat-dynamics"\)/);
  assert.match(functionSource("activeRenderCamera"), /renderCameraForPlayback\(activeSourceAnimation, camera, renderer\.xr\.isPresenting\)/);
  assert.match(functionSource("renderCameraForPlayback"), /preserve-viewer-camera/);
  assert.match(functionSource("sourceAnimationStatusText"), /source camera transition skipped in WebXR to preserve headset tracking/);
  assert.match(functionSource("loadModel"), /cameras/);
  assert.match(functionSource("clonedSourceCameras"), /storyvrSourceCameraIndex/);
  assert.match(functionSource("showModel"), /transitionPartSelectors/, "reader uses the union of boundary states during a transition");
  assert.match(functionSource("showModel"), /createFrozenSourcePartPlayback/, "reader renders inherited text-beat states as frozen poses");
  assert.match(functionSource("modelAssetForBeat"), /sourcePartAssetIds/, "text-only beats can load the model inherited by their resolved state");
  assert.match(functionSource("updateSourceAnimation"), /destinationPartSelectors/, "reader settles on the destination beat part mask");
  assert.match(functionSource("updateSourceAnimation"), /mode === "frozen"/, "reader never advances a frozen text-beat animation");
});

test("reader keeps legacy Path metadata readable while the XR panel follows a hand", () => {
  assert.match(functionSource("runtimeTextPlacementForBeat"), /Path \/ object-attached text/);
  assert.match(functionSource("runtimeTextPlacementForBeat"), /coordinateSpace: "source-focus"/);
  assert.match(functionSource("updateSpatialTextPanelPose"), /preferredXrTextPanelEntry\(\)/);
  assert.match(functionSource("updateSpatialTextPanelPose"), /attachSpatialTextPanelToEntry\(preferred\)/);
  assert.doesNotMatch(functionSource("updateSpatialTextPanelPose"), /runtimeSourceCameraFocus|runtimeActiveModelFocus|spatialTextPlacement\.position/);
  assert.match(functionSource("runtimeSourceCameraFocus"), /activeSourceAnimation\?\.sourceCamera/);
  assert.match(functionSource("runtimeSourceCameraFocus"), /spatialTextFocusCache/);
  assert.match(functionSource("runtimeSourceCameraFocus"), /SOURCE_FOCUS_DYNAMIC_REFRESH_MS/);
  assert.match(functionSource("runtimeSourceCameraFocus"), /runtimeVisibleTextCollisionProxy\(activeModel, now\)/);
  assert.match(functionSource("runtimeSourceCameraFocus"), /intersectObjects\(spatialTextFocusCandidates, false, spatialTextFocusHits\)/);
  assert.doesNotMatch(functionSource("runtimeSourceCameraFocus"), /intersectObject\(activeModel, true\)/);
  assert.match(functionSource("render"), /updateSpatialTextPanelPose\(frameTime\)/);
  assert.match(functionSource("renderCameraForPlayback"), /if \(xrPresenting\) return usesSourceCamera\(xrPolicy\) \? playback\.sourceCamera : readerCamera/);
});

test("reader consumes Spatial Relations visual transforms while text uses the hand surface", () => {
  const helpers = evaluateFunctions([
    "spatialEntityIndex",
    "finiteSpatialArray",
    "normalizedSpatialQuaternion",
    "normalizedSpatialTransform",
    "effectiveSpatialEntityTransform",
  ], "({ spatialEntityIndex, normalizedSpatialTransform, effectiveSpatialEntityTransform })");
  assert.equal(helpers.spatialEntityIndex([{ id: "glb:fixture", transform: {} }])["glb:fixture"].id, "glb:fixture");
  assert.deepEqual(helpers.normalizedSpatialTransform({
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    scale: [2, 2, 2],
  }), {
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    scale: [2, 2, 2],
  });
  assert.deepEqual(helpers.effectiveSpatialEntityTransform({
    inferredTransform: { position: [0.5, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
  }).position, [0.5, 0, 0]);
  assert.match(functionSource("showModel"), /applyRuntimeGlbSpatialTransform\(asset, beat\)/);
  assert.match(functionSource("showModel"), /modelAuthorTransformRoot\.add\(activeModel\)/);
  assert.match(functionSource("spatialTextPlacementFromEntity"), /orientationPolicy/);
  assert.match(functionSource("modelAssetForBeat"), /spatialTextEntityForBeat\(beat\)\?\.anchor\?\.assetId/);
  assert.match(functionSource("attachSpatialTextPanelToEntry"), /entry\.anchor \|\| entry\.grip \|\| entry\.controller/);
  assert.doesNotMatch(functionSource("render"), /applySpatialTextOrientation|applySpatialTextCollisionClearance/);
  assert.match(functionSource("renderCameraForPlayback"), /if \(xrPresenting\)/, "Spatial Relations does not take ownership of the headset camera");
});

test("initial model selection resolves text entities without reading activeIndex during initialization", () => {
  const spatialTextLookup = functionSource("spatialTextEntityForBeat");
  assert.match(spatialTextLookup, /index = beats\.findIndex\(/);
  assert.doesNotMatch(spatialTextLookup, /index = activeIndex/);
});

test("reader hand panel bypasses obsolete authored clearance and focus placement", () => {
  const update = functionSource("updateSpatialTextPanelPose");
  const render = functionSource("render");
  const attach = functionSource("attachSpatialTextPanelToEntry");

  assert.match(update, /renderer\.xr\.isPresenting/);
  assert.match(update, /preferredXrTextPanelEntry\(\)/);
  assert.doesNotMatch(update, /applyRuntimeTextPanelClearanceLock|runtimeSourceCameraFocus|runtimeActiveModelFocus/);
  assert.match(attach, /spatialTextPanel\.position\.set/);
  assert.match(attach, /spatialTextPanel\.rotation\.set/);
  assert.doesNotMatch(render, /applySpatialTextOrientation|applySpatialTextCollisionClearance/);
});

test("reader enables the lightweight immersive-XR rendering profile", () => {
  assert.match(source, /preserveDrawingBuffer: false/);
  assert.match(source, /powerPreference: "high-performance"/);
  assert.match(source, /setFramebufferScaleFactor\(XR_FRAMEBUFFER_SCALE_FACTOR\)/);
  assert.match(source, /setFoveation\(XR_FIXED_FOVEATION\)/);
  assert.match(source, /sessionstart[\s\S]*renderer\.shadowMap\.enabled = false/);
  assert.match(functionSource("render"), /if \(!renderer\.xr\.isPresenting\) controls\.update\(\)/);
  assert.match(functionSource("updateSharedTimelineAnnotations"), /renderer\.xr\.isPresenting[\s\S]*setSharedTimelineAnnotationsHidden/);
});

test("reader updates only wall-clock bindings outside timeline transitions", () => {
  assert.match(functionSource("sharedTimelineBindingUsesWallClock"), /wall-clock-time/);
  assert.match(functionSource("applySharedTimelineClockBindings"), /wallClockBindings/);
  const update = functionSource("updateSourceAnimation");
  assert.match(update, /applySharedTimelineClockBindings/);
  assert.doesNotMatch(update, /applySharedTimelineBindings/);
});

test("reader transition scrub progress uses wall-clock time", () => {
  assert.match(functionSource("createSharedTimelinePlayback"), /transitionStartedAtMs/);
  const update = functionSource("updateSourceAnimation");
  assert.match(update, /frameTime - Number\(activeSourceAnimation\.transitionStartedAtMs\)/);
  assert.match(update, /activeSourceAnimation\.elapsed \+ delta/, "legacy playback still has a safe delta fallback");
});

test("reader renders mapped GLB animation without synthetic dynamic motion", () => {
  assert.doesNotMatch(source, /function updateParticles\(|\bparticleField\b/);
  assert.doesNotMatch(functionSource("render"), /activeModel\.rotation\.y|Math\.sin/);
  assert.match(functionSource("render"), /updateSourceAnimation\(delta, frameTime\)/);
  assert.doesNotMatch(functionSource("runtimeSpatialTextSceneChanging"), /dynamicGeometryEnabled/);
  assert.match(functionSource("runtimeSpatialTextMotionMode"), /return "static";/);
  const directives = functionSource("finalTuningDirectivesForPrompt");
  assert.match(directives, /hideDecorativeParticles: suppress && particles/);
  assert.match(directives, /hideGroundCircles: suppress && ground && circles/);
});

test("reader part masks expand generic selectors and fall back safely", () => {
  const helpers = evaluateFunctions([
    "uniqueStrings",
    "expandSourcePartSelectors",
    "sourcePartSelectorRegex",
    "sourcePartNodePath",
    "sourcePartSelectorMatchesNode",
    "applySourcePartMask",
  ], "({ expandSourcePartSelectors, applySourcePartMask })");
  assert.deepEqual(helpers.expandSourcePartSelectors(["root/{part_a,part_b}", "slice_01..03"]), [
    "root/part_a", "root/part_b", "slice_01", "slice_02", "slice_03",
  ]);
  const root = { name: "root", userData: {}, children: [], traverse(callback) { callback(this); this.children.forEach(callback); } };
  const active = { name: "part_a", parent: root, userData: {}, visible: true, isMesh: true };
  const inactive = { name: "part_b", parent: root, userData: {}, visible: true, isMesh: true };
  root.children.push(active, inactive);
  assert.equal(helpers.applySourcePartMask(root, ["part_a"]).matched, 1);
  assert.equal(active.visible, true);
  assert.equal(inactive.visible, false);
  assert.equal(helpers.applySourcePartMask(root, ["missing"]).fallback, true);
  assert.equal(inactive.visible, true);
});

test("reader keeps legacy inferred masks but rejects them as shared-timeline visibility authority", () => {
  const selectParts = new Function("sourcePartStates", "sourceMotionPlaybackAssets", `
    ${functionSource("uniqueStrings")}
    ${functionSource("sharedTimelineContractForAsset")}
    ${functionSource("sourcePartStateCanApplyHardMask")}
    ${functionSource("sourcePartSelectorsForBeatAsset")}
    return sourcePartSelectorsForBeatAsset;
  `);
  const states = [
    {
      beatId: "beat-mask",
      assetId: "timeline.glb",
      provenance: "inferred-runtime",
      partSelectors: ["inferred_part"],
      animationTargetSelectors: [],
    },
    {
      beatId: "beat-mask",
      assetId: "timeline.glb",
      provenance: "direct-runtime",
      partSelectors: ["direct_part"],
      animationTargetSelectors: [],
    },
  ];

  assert.deepEqual(
    selectParts(states, [])("beat-mask", "timeline.glb"),
    ["inferred_part", "direct_part"],
    "a shark-like story without a playback contract keeps the established mask behavior",
  );
  assert.deepEqual(
    selectParts(states, [{ assetId: "timeline.glb", mode: "shared-timeline" }])("beat-mask", "timeline.glb"),
    ["direct_part"],
    "only directly observed visibility may supplement a coordinated shared timeline",
  );
});

test("inactive shared contracts suppress only their own asset and preserve unrelated linked models", () => {
  const inactiveModel = { id: "timeline-a.glb", type: "model", path: "models/timeline-a.glb" };
  const unrelatedModel = { id: "artifact-b.glb", type: "model", path: "models/artifact-b.glb" };
  const sourceMotionPlaybackAssets = [{
    assetId: inactiveModel.id,
    mode: "shared-timeline",
    beatStates: [{ beatId: "beat-x", presence: "inactive", localProgress: null, entryMode: "inactive" }],
  }];
  const runtime = { assets: [inactiveModel, unrelatedModel] };
  const selectModel = new Function("sourceMotionPlaybackAssets", "runtime", "graphBeats", "sourcePartStates", `
    const hasSourceMotionLinking = false;
    const dynamicGeometryEnabled = false;
    function sourceMotionAssetIdsForBeat() { return new Set(); }
    function sourceDynamicsLinksForBeat() { return []; }
    function spatialTextEntityForBeat() { return null; }
    ${functionSource("uniqueStrings")}
    ${functionSource("beatIdentitySet")}
    ${functionSource("isModelAsset")}
    ${functionSource("sharedTimelineStateForBeat")}
    ${functionSource("sourceMotionPlaybackModelAsset")}
    ${functionSource("modelAssetForBeat")}
    return modelAssetForBeat;
  `)(sourceMotionPlaybackAssets, runtime, new Map(), []);
  const beat = { id: "beat-x", atomicBeatIds: ["beat-x"], linkedAssets: [inactiveModel, unrelatedModel] };

  assert.equal(selectModel(beat), unrelatedModel);
  assert.equal(selectModel({ ...beat, linkedAssets: [inactiveModel] }), undefined);
  const beats = [
    { id: "beat-w", atomicBeatIds: ["beat-w"] },
    beat,
  ];
  const sourceMotionTracks = [{
    assetId: inactiveModel.id,
    componentId: "inter-beat-dynamics",
    kind: "clip",
    effective: { transitions: [{ fromBeatId: "beat-w", toBeatId: "beat-x" }] },
  }];
  const legacyTransitionModel = new Function(
    "sourceMotionPlaybackAssets",
    "runtime",
    "beats",
    "sourceMotionTracks",
    `
      const hasSourceMotionLinking = true;
      function sourceMotionTrackAppliesToComponent(track, componentId) { return track.componentId === componentId; }
      ${functionSource("uniqueStrings")}
      ${functionSource("beatIdentitySet")}
      ${routeHelperSource()}
      ${functionSource("motionTransitionMatches")}
      ${functionSource("motionTransitionForBeatChange")}
      ${functionSource("isModelAsset")}
      ${functionSource("sharedTimelineContractForAsset")}
      ${functionSource("sourceMotionModelAssetForBeatChange")}
      return sourceMotionModelAssetForBeatChange;
    `,
  )(sourceMotionPlaybackAssets, runtime, beats, sourceMotionTracks);
  assert.equal(
    legacyTransitionModel(0, 1),
    null,
    "legacy transition matching cannot re-select an inactive asset owned by a shared contract",
  );
  sourceMotionTracks[0].assetId = unrelatedModel.id;
  assert.equal(legacyTransitionModel(0, 1), unrelatedModel, "uncontracted transition models remain eligible");
  const ownsDestinationModel = evaluateFunctions(
    ["sharedTimelineOwnsDestinationModel"],
    "sharedTimelineOwnsDestinationModel",
  );
  assert.equal(ownsDestinationModel({ mode: "clear", toPresence: "inactive" }), false);
  assert.equal(ownsDestinationModel({ mode: "initialize", toPresence: "active" }), true);
  sourceMotionTracks[0].assetId = inactiveModel.id;
  const clearDestinationModel = ownsDestinationModel({ mode: "clear", toPresence: "inactive" })
    ? inactiveModel
    : legacyTransitionModel(0, 1) || selectModel(beat);
  assert.equal(
    clearDestinationModel,
    unrelatedModel,
    "clear deactivates the outgoing contract without suppressing an unrelated destination model",
  );
  sourceMotionPlaybackAssets[0].beatStates[0] = {
    beatId: "beat-x", presence: "active", localProgress: 0.4, entryMode: "hold",
  };
  assert.equal(selectModel(beat), inactiveModel, "an active shared contract still owns its declared model");
});

test("shared contracts veto same-asset legacy playback while uncontracted assets retain it", () => {
  const contract = {
    assetId: "timeline-owner.glb",
    mode: "shared-timeline",
    beatStates: [{ beatId: "beat-y", presence: "active", localProgress: 0.45, entryMode: "animate" }],
  };
  const helpers = new Function("sourceMotionPlaybackAssets", `
    ${functionSource("uniqueStrings")}
    ${functionSource("beatIdentitySet")}
    ${functionSource("sharedTimelineStateForBeat")}
    ${functionSource("hasExplicitSharedTimelineNumber")}
    ${functionSource("normalizedProgress")}
    ${functionSource("sharedTimelineContractForAsset")}
    ${functionSource("staticSharedTimelinePlaybackForBeat")}
    return { sharedTimelineContractForAsset, staticSharedTimelinePlaybackForBeat };
  `)([contract]);
  const beat = { id: "beat-y", atomicBeatIds: ["beat-y"] };
  const staticPlayback = helpers.staticSharedTimelinePlaybackForBeat(contract, beat);

  assert.equal(helpers.sharedTimelineContractForAsset("timeline-owner.glb"), contract);
  assert.equal(helpers.sharedTimelineContractForAsset("unrelated.glb"), null);
  assert.equal(staticPlayback.mode, "hold");
  assert.deepEqual([staticPlayback.startProgress, staticPlayback.endProgress], [0.45, 0.45]);
  assert.match(staticPlayback.diagnostic, /No exact shared-timeline boundary/);
  const sharedPlaybackSource = functionSource("createSharedTimelinePlayback");
  assert.match(sharedPlaybackSource, /notice: transitionPlayback\.diagnostic/);
  assert.match(sharedPlaybackSource, /diagnostics: \[\.\.\.materialState\.diagnostics\]/);
  assert.doesNotMatch(
    sharedPlaybackSource,
    /diagnostics:[\s\S]{0,120}transitionPlayback\.diagnostic/,
    "direct beat selection is an expected timeline notice, not a source-binding diagnostic",
  );
  const createSource = functionSource("createSourceAnimationPlayback");
  assert.ok(
    createSource.indexOf("sharedTimelineContractForAsset") < createSource.indexOf("createLegacySourceAnimationPlayback"),
    "the per-asset shared-contract veto runs before either legacy path",
  );
  assert.match(createSource, /return staticPlayback \? createSharedTimelinePlayback[\s\S]*: null/);
  assert.match(functionSource("showModel"), /if \(!contractedTimeline\) applySourcePartMask/, "contracted assets skip legacy selector masks even without an exact boundary");
});

test("reader ground-aligns only contracted shared-timeline GLBs above its neutral floor", () => {
  const sharedTimelineGroundAligned = new Function(`
    ${functionSource("sharedTimelineGroundAligned")}
    return sharedTimelineGroundAligned;
  `)();
  const frameModel = new Function("THREE", "modelFrameTarget", `
    ${functionSource("frameModel")}
    return frameModel;
  `)(THREE, () => 4);
  const createOffsetModel = () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.position.set(3, 4, -2);
    root.add(mesh);
    return root;
  };
  const contracted = createOffsetModel();
  const legacy = createOffsetModel();

  assert.equal(sharedTimelineGroundAligned({ framing: { verticalAlignment: "ground" } }), true);
  assert.equal(sharedTimelineGroundAligned({ framing: { verticalAlignment: "center" } }), false);
  assert.equal(sharedTimelineGroundAligned({ mode: "shared-timeline" }), false, "shared timelines must explicitly opt into grounding");
  frameModel(contracted, { groundAligned: sharedTimelineGroundAligned({ framing: { verticalAlignment: "ground" } }) });
  frameModel(legacy, { groundAligned: sharedTimelineGroundAligned(null) });

  const contractedBounds = new THREE.Box3().setFromObject(contracted);
  const legacyBounds = new THREE.Box3().setFromObject(legacy);
  assert.ok(Math.abs(contractedBounds.min.y) < 1e-9, "contracted source surfaces remain above the reader floor");
  assert.ok(Math.abs(legacyBounds.getCenter(new THREE.Vector3()).y) < 1e-9, "legacy readers keep their existing center alignment");
  assert.ok(legacyBounds.min.y < 0, "the no-contract path remains vertically centered rather than grounded");

  const primaryLoader = functionSource("showModel");
  const supplementalLoader = functionSource("showSupplementalModel");
  assert.match(primaryLoader, /groundAligned: sharedTimelineGroundAligned\(sharedTimelineContract\)/);
  assert.match(supplementalLoader, /groundAligned: sharedTimelineGroundAligned\(sharedTimelineContract\)/);
});

test("resolves neutral shared-timeline initial, scrub, hold, reverse, and clear states", () => {
  const helpers = new Function(`
    ${routeHelperSource()}
    ${functionSource("uniqueStrings")}
    ${functionSource("uniqueIntegers")}
    ${functionSource("uniqueMotionTransitions")}
    ${functionSource("normalizeMotionTransition")}
    ${functionSource("hasExplicitSharedTimelineNumber")}
    ${functionSource("normalizedProgress")}
    ${functionSource("normalizeSourceMotionPlayback")}
    ${functionSource("beatIdentitySet")}
    ${functionSource("motionTransitionMatches")}
    ${functionSource("motionTransitionForBeatChange")}
    ${functionSource("sharedTimelineStateForBeat")}
    ${functionSource("reverseSharedTimelineBoundaryMode")}
    ${functionSource("sharedTimelineBoundaryForBeatChange")}
    ${functionSource("resolveSharedTimelineBeatChange")}
    return { normalizeSourceMotionPlayback, resolveSharedTimelineBeatChange, reverseSharedTimelineBoundaryMode };
  `)();
  const [contract] = helpers.normalizeSourceMotionPlayback({
    assets: [{
      assetId: "orbital-gallery.glb",
      mode: "shared-timeline",
      timeline: { durationSeconds: 10, timeMapping: "shared-absolute", defaultLoopMode: "repeat" },
      coordinatedClips: [{ clipIndex: 0 }, { clipIndex: 1 }, { clipIndex: 2 }],
      beatStates: [
        { beatId: "intro-a", presence: "inactive", entryMode: "inactive" },
        { beatId: "scene-alpha", presence: "active", localProgress: 0.12, entryMode: "initial" },
        { beatId: "scene-beta", presence: "active", localProgress: 0.4, entryMode: "animate" },
        { beatId: "duplicate-prose", presence: "active", localProgress: 0.4, entryMode: "hold" },
        { beatId: "scene-gamma", presence: "active", localProgress: 0.76, entryMode: "animate" },
        { beatId: "epilogue", presence: "active", localProgress: 0.76, entryMode: "hold" },
        { beatId: "outro", presence: "inactive", entryMode: "inactive" },
      ],
      boundaries: [
        { fromBeatId: "intro-a", toBeatId: "scene-alpha", mode: "initialize", startProgress: 0.12, endProgress: 0.12 },
        { fromBeatId: "scene-alpha", toBeatId: "scene-beta", mode: "scrub", startProgress: 0.12, endProgress: 0.4 },
        { fromBeatId: "scene-beta", toBeatId: "duplicate-prose", mode: "hold", startProgress: 0.4, endProgress: 0.4 },
        { fromBeatId: "scene-gamma", toBeatId: "epilogue", mode: "hold", startProgress: 0.76, endProgress: 0.76 },
        { fromBeatId: "epilogue", toBeatId: "outro", mode: "clear", startProgress: 0.76, endProgress: null },
      ],
    }],
  });
  const beat = (id) => ({ id, atomicBeatIds: [id] });
  assert.deepEqual(
    ["scrub", "hold", "initialize", "clear", "none"].map(helpers.reverseSharedTimelineBoundaryMode),
    ["scrub", "hold", "clear", "initialize", "none"],
  );
  assert.equal(contract.boundaries.find((boundary) => boundary.mode === "clear").endProgress, null, "a clear boundary's null endpoint is not coerced to zero");
  assert.equal(contract.beatStates.find((state) => state.beatId === "outro").localProgress, null);

  const initial = helpers.resolveSharedTimelineBeatChange(contract, beat("intro-a"), beat("scene-alpha"));
  assert.equal(initial.mode, "initialize");
  assert.equal(initial.startProgress, 0.12);
  assert.equal(initial.endProgress, 0.12);

  const firstLoad = helpers.resolveSharedTimelineBeatChange(contract, beat("scene-alpha"), beat("scene-alpha"), { initial: true });
  assert.equal(firstLoad.mode, "initialize");
  assert.equal(firstLoad.endProgress, 0.12);

  const scrub = helpers.resolveSharedTimelineBeatChange(contract, beat("scene-alpha"), beat("scene-beta"));
  assert.equal(scrub.mode, "scrub");
  assert.deepEqual([scrub.startProgress, scrub.endProgress], [0.12, 0.4]);

  const duplicateHold = helpers.resolveSharedTimelineBeatChange(contract, beat("scene-beta"), beat("duplicate-prose"));
  assert.equal(duplicateHold.mode, "hold");
  assert.deepEqual([duplicateHold.startProgress, duplicateHold.endProgress], [0.4, 0.4]);

  const derivedWithoutExactBoundary = helpers.resolveSharedTimelineBeatChange(contract, beat("duplicate-prose"), beat("scene-gamma"));
  assert.equal(derivedWithoutExactBoundary, null, "unmapped beat-state deltas do not invent a scrub boundary");

  const trailingHold = helpers.resolveSharedTimelineBeatChange(contract, beat("scene-gamma"), beat("epilogue"));
  assert.equal(trailingHold.mode, "hold");
  assert.equal(trailingHold.endProgress, 0.76);

  const reverse = helpers.resolveSharedTimelineBeatChange(contract, beat("scene-beta"), beat("scene-alpha"));
  assert.equal(reverse.mode, "scrub");
  assert.equal(reverse.reverse, true);
  assert.deepEqual([reverse.startProgress, reverse.endProgress], [0.4, 0.12]);

  const contractWithScrubAfterForwardHold = {
    ...contract,
    boundaries: [
      ...contract.boundaries,
      { fromBeatId: "duplicate-prose", toBeatId: "scene-gamma", mode: "scrub", startProgress: 0.4, endProgress: 0.76 },
    ],
  };
  const reverseIntoForwardHold = helpers.resolveSharedTimelineBeatChange(
    contractWithScrubAfterForwardHold,
    beat("scene-gamma"),
    beat("duplicate-prose"),
  );
  assert.equal(reverseIntoForwardHold.mode, "scrub", "a reversed explicit scrub owns direction semantics over the destination's forward hold entry");
  assert.equal(reverseIntoForwardHold.reverse, true);
  assert.deepEqual([reverseIntoForwardHold.startProgress, reverseIntoForwardHold.endProgress], [0.76, 0.4]);

  const clear = helpers.resolveSharedTimelineBeatChange(contract, beat("scene-alpha"), beat("intro-a"));
  assert.equal(clear.mode, "clear");
  assert.equal(clear.toPresence, "inactive");

  const declaredClear = helpers.resolveSharedTimelineBeatChange(contract, beat("epilogue"), beat("outro"));
  assert.equal(declaredClear.mode, "clear", "engine-declared clear boundaries are authoritative");
  const reverseClear = helpers.resolveSharedTimelineBeatChange(contract, beat("outro"), beat("epilogue"));
  assert.equal(reverseClear.mode, "initialize", "reversing clear initializes the source state");
  assert.equal(reverseClear.reverse, true);
  assert.equal(reverseClear.endProgress, 0.76);
});

test("later active shared contracts own sequential asset changes while clear remains a fallback", () => {
  const selectPlayback = new Function(`
    ${routeHelperSource()}
    ${functionSource("uniqueStrings")}
    ${functionSource("beatIdentitySet")}
    ${functionSource("motionTransitionMatches")}
    ${functionSource("motionTransitionForBeatChange")}
    ${functionSource("hasExplicitSharedTimelineNumber")}
    ${functionSource("normalizedProgress")}
    ${functionSource("sharedTimelineStateForBeat")}
    ${functionSource("reverseSharedTimelineBoundaryMode")}
    ${functionSource("sharedTimelineBoundaryForBeatChange")}
    ${functionSource("resolveSharedTimelineBeatChange")}
    ${functionSource("sharedTimelinePlaybackForBeatChange")}
    return sharedTimelinePlaybackForBeatChange;
  `)();
  const beat = (id) => ({ id, atomicBeatIds: [id] });
  const outgoing = {
    assetId: "chapter-a.glb",
    mode: "shared-timeline",
    beatStates: [
      { beatId: "chapter-a", presence: "active", localProgress: 0.9, entryMode: "hold" },
      { beatId: "chapter-b", presence: "inactive", localProgress: null, entryMode: "inactive" },
    ],
    boundaries: [{ fromBeatId: "chapter-a", toBeatId: "chapter-b", mode: "clear", startProgress: 0.9, endProgress: null }],
  };
  const incoming = {
    assetId: "chapter-b.glb",
    mode: "shared-timeline",
    beatStates: [
      { beatId: "chapter-a", presence: "inactive", localProgress: null, entryMode: "inactive" },
      { beatId: "chapter-b", presence: "active", localProgress: 0.1, entryMode: "initial" },
    ],
    boundaries: [{ fromBeatId: "chapter-a", toBeatId: "chapter-b", mode: "initialize", startProgress: 0.1, endProgress: 0.1 }],
  };

  const selected = selectPlayback([outgoing, incoming], beat("chapter-a"), beat("chapter-b"));
  assert.equal(selected.assetId, "chapter-b.glb");
  assert.equal(selected.mode, "initialize");
  const clearOnly = selectPlayback([outgoing], beat("chapter-a"), beat("chapter-b"));
  assert.equal(clearOnly.assetId, "chapter-a.glb");
  assert.equal(clearOnly.mode, "clear");
});

test("shared timeline selects every coordinated clip and seeks one master mixer clock", () => {
  const coordinated = evaluateFunctions([
    "uniqueIntegers",
    "sharedTimelineCoordinatedClipEntries",
  ], "sharedTimelineCoordinatedClipEntries");
  const clips = [
    { name: "motion-a", duration: 10 },
    { name: "camera-motion", duration: 7 },
    { name: "motion-b", duration: 6 },
  ];
  const entries = coordinated({
    timeline: { defaultLoopMode: "repeat" },
    coordinatedClips: [{ clipIndex: 0 }, { clipIndex: 2, loopMode: "once" }],
    camera: { clipIndexes: [1] },
    boundaries: [{ contributorClipIndexes: [2] }],
  }, clips);
  assert.deepEqual(entries.map((entry) => entry.clipIndex), [0, 1, 2], "semantic contributors do not limit coordinated playback");

  const seek = new Function(`
    ${functionSource("hasExplicitSharedTimelineNumber")}
    ${functionSource("normalizedProgress")}
    ${functionSource("sharedTimelineTimeSeconds")}
    function applySharedTimelineBindings(playback, progress) { playback.bindingSeeks.push(progress); }
    ${functionSource("seekSharedTimelinePlayback")}
    return seekSharedTimelinePlayback;
  `)();
  const mixerTimes = [];
  const playback = {
    mixer: { setTime(value) { mixerTimes.push(value); } },
    timelineDurationSeconds: 10,
    currentProgress: 0,
    bindingSeeks: [],
  };
  seek(playback, 0.8);
  seek(playback, 0.4);
  assert.deepEqual(mixerTimes, [8, 4]);
  assert.deepEqual(playback.bindingSeeks, [0.8, 0.4], "bindings run after every absolute seek");
  assert.match(functionSource("seekSharedTimelinePlayback"), /mixer\.setTime/);
  assert.doesNotMatch(functionSource("seekSharedTimelinePlayback"), /clip.*duration/i, "shared seek never normalizes each clip independently");
});

test("camera-only clip coordination preserves an explicit null source-camera index", () => {
  const helpers = new Function(`
    ${functionSource("uniqueIntegers")}
    ${functionSource("normalizeMotionTransition")}
    ${functionSource("hasExplicitSharedTimelineNumber")}
    ${functionSource("normalizedProgress")}
    ${functionSource("normalizeSourceMotionPlayback")}
    ${functionSource("sharedTimelineCoordinatedClipEntries")}
    ${functionSource("sharedTimelineSourceCamera")}
    return { normalizeSourceMotionPlayback, sharedTimelineCoordinatedClipEntries, sharedTimelineSourceCamera };
  `)();
  const [contract] = helpers.normalizeSourceMotionPlayback({
    assets: [{
      assetId: "camera-driver.glb",
      mode: "shared-timeline",
      timeline: { defaultLoopMode: "repeat" },
      camera: { cameraIndex: null, clipIndexes: [null, 1] },
    }],
  });
  const sourceCamera = { id: "camera-zero" };
  const clips = [{ name: "mesh-motion" }, { name: "camera-driver-motion" }];

  assert.equal(contract.camera.cameraIndex, null);
  assert.deepEqual(
    helpers.sharedTimelineCoordinatedClipEntries(contract, clips).map((entry) => entry.clipIndex),
    [1],
    "camera clips remain on the shared mixer even without a render camera",
  );
  assert.equal(helpers.sharedTimelineSourceCamera([sourceCamera], contract.camera), null, "null never falls back to camera zero");
  assert.equal(helpers.sharedTimelineSourceCamera([sourceCamera], { cameraIndex: 0 }), sourceCamera);
});

test("shared source camera persists across desktop states while XR preserves the viewer", () => {
  const renderCameraForPlayback = evaluateFunctions(["renderCameraForPlayback"], "renderCameraForPlayback");
  const readerCamera = { id: "viewer" };
  const sourceCamera = { id: "source" };
  const shared = {
    sharedTimeline: true,
    sourceCamera,
    cameraPolicy: {
      desktopPolicy: "render-source-camera",
      xrPolicy: "preserve-viewer-camera",
    },
  };
  for (const mode of ["frozen", "segment", "segment-complete"]) {
    assert.equal(renderCameraForPlayback({ ...shared, mode }, readerCamera, false), sourceCamera);
    assert.equal(renderCameraForPlayback({ ...shared, mode }, readerCamera, true), readerCamera);
  }
  assert.equal(renderCameraForPlayback({ sourceCamera, mode: "segment-complete" }, readerCamera, false), readerCamera, "legacy camera behavior remains unchanged");
});

test("applies declared generic bindings and reports unsupported operations without guessing", () => {
  const helpers = new Function(`
    ${functionSource("sharedTimelineBindingNode")}
    ${functionSource("sharedTimelinePropertyValue")}
    ${functionSource("sharedTimelineBindingValue")}
    ${functionSource("sharedTimelineBindingParameters")}
    ${functionSource("transformedSharedTimelineBindingValue")}
    ${functionSource("hasExplicitSharedTimelineNumber")}
    ${functionSource("normalizedProgress")}
    ${functionSource("addSharedTimelineDiagnostic")}
    ${functionSource("sharedTimelineBindingTarget")}
    ${functionSource("forEachSharedTimelineMaterial")}
    ${functionSource("finiteSharedTimelineNumber")}
    ${functionSource("prepareSharedTimelineMaterial")}
    ${functionSource("snapVisibilityOpacityEndpoint")}
    ${functionSource("updateSharedTimelineMaterialOpacity")}
    ${functionSource("updateSharedTimelineRenderableVisibility")}
    ${functionSource("sharedTimelineBindingTargets")}
    ${functionSource("sharedTimelineBindingMaterials")}
    ${functionSource("applySharedTimelineMaterialOpaqueAtUniform")}
    ${functionSource("applySharedTimelineMaterialUniform")}
    ${functionSource("sharedTimelineAnnotationTarget")}
    ${functionSource("applySharedTimelineBinding")}
    ${functionSource("applySharedTimelineBindings")}
    return { applySharedTimelineBindings, sharedTimelineBindingValue, transformedSharedTimelineBindingValue };
  `)();
  const sourceNode = { name: "control-alpha", scale: { x: 0.6 } };
  const opacityTarget = {
    name: "surface-beta",
    visible: true,
    userData: { storyvrSourcePartMaskVisible: false },
    material: { opacity: 0.8, transparent: false, depthWrite: true, userData: {} },
  };
  const drawTarget = {
    name: "line-gamma",
    geometry: {
      index: { count: 100 },
      drawRange: { start: 5, count: 7 },
      userData: {},
      setDrawRange(start, count) { this.drawRange = { start, count }; },
    },
  };
  const sourceCamera = {
    focalLength: 0,
    setFocalLength(value) { this.focalLength = value; },
    updateProjectionMatrix() { this.updated = true; },
  };
  const annotationElement = { style: { opacity: "0" }, visible: false };
  const recipeMaterial = { uniforms: { time: { value: 0 }, progress: { value: 0 } } };
  const nodes = new Map([
    [sourceNode.name, sourceNode],
    [opacityTarget.name, opacityTarget],
    [drawTarget.name, drawTarget],
  ]);
  const playback = {
    root: { getObjectByName(name) { return nodes.get(name) || null; } },
    sourceCamera,
    initialSourceCameraFocalLength: 50,
    clockSeconds: 1.25,
    materialRecipes: new Map([["flow-beta", { materials: [recipeMaterial] }]]),
    annotations: [{
      id: "note-delta",
      element: annotationElement,
      opacitySource: { node: "control-alpha", path: "scale.x" },
      visibleThreshold: 0.6,
    }],
    diagnostics: [],
    bindings: [
      {
        operation: "visibility-opacity",
        source: { node: "control-alpha", path: "scale.x" },
        target: { node: "surface-beta" },
        parameters: { visibleThreshold: 0.01, maxOpacity: 0.2 },
      },
      { operation: "draw-range", value: 0.5, target: { node: "line-gamma" } },
      { operation: "camera-focal-length", value: 0.5, parameters: { base: "initial", multiplier: -20 } },
      {
        operation: "material-uniform",
        source: { type: "wall-clock-time" },
        target: { material: "flow-beta", uniform: "time" },
        parameters: { multiplier: 60 },
      },
      {
        operation: "material-uniform",
        source: { type: "timeline-progress" },
        target: { material: "flow-beta", uniform: "progress" },
      },
      { operation: "unknown-effect", value: 1 },
    ],
  };
  assert.equal(helpers.transformedSharedTimelineBindingValue(0.4, {
    parameters: { multiplier: 2, offset: 0.1, invert: true, clamp: [0.2, 0.8] },
  }), 0.2, "binding transforms multiply and offset before invert and clamp");
  assert.equal(helpers.transformedSharedTimelineBindingValue(0.4, {
    factor: 2, offset: 0.1, invert: true, clamp: [0.2, 0.8],
  }), 0.2, "top-level author aliases remain supported");
  assert.equal(helpers.transformedSharedTimelineBindingValue(0.4, {
    parameters: { scale: 2 },
  }), 0.8, "the previous scale alias remains compatible");
  assert.equal(Number.isNaN(helpers.sharedTimelineBindingValue(playback, { value: null }, 0.5)), true);
  helpers.applySharedTimelineBindings(playback, 0.5);
  assert.equal(opacityTarget.visible, false, "binding visibility composes with the existing part mask");
  assert.equal(opacityTarget.material.userData.storyvrBaseOpacity, 0.8);
  assert.ok(Math.abs(opacityTarget.material.opacity - 0.16) < 1e-9);
  assert.equal(opacityTarget.material.transparent, true);
  assert.equal(opacityTarget.material.depthWrite, false);
  assert.deepEqual(drawTarget.geometry.drawRange, { start: 5, count: 4 }, "draw count rounds against the cached original range");
  assert.equal(sourceCamera.focalLength, 40);
  assert.equal(sourceCamera.updated, true);
  assert.equal(recipeMaterial.uniforms.time.value, 75, "wall-clock bindings drive reusable shader uniforms");
  assert.equal(recipeMaterial.uniforms.progress.value, 0.5, "shared timeline progress can drive reusable shader uniforms");
  assert.equal(annotationElement.style.opacity, "0.6");
  assert.equal(annotationElement.visible, true, "annotation visibility includes opacity exactly at the threshold");
  assert.deepEqual(playback.diagnostics, ["Unsupported source binding operation: unknown-effect"]);

  opacityTarget.userData.storyvrSourcePartMaskVisible = true;
  sourceNode.scale.x = 0.997827;
  playback.bindings[0].parameters.maxOpacity = 1;
  helpers.applySharedTimelineBindings(playback, 0.8);
  assert.equal(opacityTarget.visible, true);
  assert.equal(opacityTarget.material.userData.storyvrSourceBindingOpacity, 1, "near-complete reader bindings snap to the full-opacity endpoint");
  assert.equal(opacityTarget.material.opacity, 0.8, "endpoint snapping preserves the authored base opacity");
  assert.equal(opacityTarget.material.transparent, true, "authored base translucency remains authoritative");
  assert.equal(opacityTarget.material.depthWrite, true, "the endpoint restores authored depth writing in the reader");

  sourceNode.scale.x = 0.5;
  helpers.applySharedTimelineBindings(playback, 0.8);
  assert.equal(opacityTarget.material.opacity, 0.4, "reader mid-fades remain unsnapped");
  assert.equal(opacityTarget.material.depthWrite, false);

  sourceNode.scale.x = 0.997827;
  playback.bindings[0].parameters.maxOpacity = 0.2;
  helpers.applySharedTimelineBindings(playback, 0.8);
  assert.ok(Math.abs(opacityTarget.material.opacity - 0.16) < 1e-9, "capped reader opacity remains deliberately translucent");
  assert.equal(opacityTarget.material.depthWrite, false);

  sourceNode.scale.x = 1;
  playback.bindings[0].parameters.maxOpacity = 1;
  playback.bindings[1].value = 0.8;
  helpers.applySharedTimelineBindings(playback, 0.8);
  assert.equal(opacityTarget.visible, true);
  assert.equal(opacityTarget.material.opacity, 0.8, "base opacity is composed once instead of drifting after repeated seeks");
  assert.equal(opacityTarget.material.transparent, true);
  assert.equal(opacityTarget.material.depthWrite, true, "full binding opacity restores the material's base depth-write mode");
  assert.deepEqual(drawTarget.geometry.drawRange, { start: 5, count: 6 }, "subsequent seeks reuse the original seven-element range");
});

test("shared reader path stays data-driven and preserves the legacy fallback", () => {
  assert.match(functionSource("setBeat"), /sourceMotionSharedPlaybackForBeatChange/);
  assert.match(functionSource("setBeat"), /sharedTimelineOwnsDestinationModel/);
  assert.match(functionSource("showModel"), /createSharedTimelinePlayback/);
  assert.match(functionSource("createSharedTimelinePlayback"), /prepareSharedTimelineBindingState/);
  assert.match(functionSource("showModel"), /if \(!contractedTimeline\) applySourcePartMask/, "shared contracts do not use inferred selectors as exclusive masks");
  assert.match(functionSource("createSourceAnimationPlayback"), /createLegacySourceAnimationPlayback/);
  assert.doesNotMatch(source, /["']classroom|["']Action\.|["']slide-\d+|driver_|target_/i);
});
