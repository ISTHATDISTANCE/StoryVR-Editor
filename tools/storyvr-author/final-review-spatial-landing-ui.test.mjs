import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

function functionSource(name) {
  const plain = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = plain === -1 ? asyncStart : asyncStart === -1 ? plain : Math.min(plain, asyncStart);
  assert.notEqual(start, -1, `${name} exists`);
  const nextPlain = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextPlain, nextAsync].filter((value) => value !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("Final Review lands on a compact story canvas with nested, default-first variant scenes", () => {
  const workspace = functionSource("renderFinalReviewWorkspace");
  const storyCanvas = functionSource("renderFinalReviewStoryCanvas");
  const storyBeat = functionSource("renderFinalReviewStoryBeat");
  const sceneCard = functionSource("renderFinalReviewStorySceneCard");
  const sceneContexts = functionSource("finalReviewSceneContextsForBeat");
  const spatialEditor = functionSource("renderFinalReviewSpatialEditor");

  assert.match(workspace, /data-final-review-landing/);
  assert.match(workspace, /const sceneContext = finalReviewSelectedSceneContext\(beats, index\)/);
  assert.match(workspace, /const beat = finalReviewBeatForSceneContext\(sceneContext\) \|\| beats\[index\]/);
  assert.match(workspace, /renderFinalReviewStoryCanvas\(beats, index, sceneContext\)/);
  assert.match(workspace, /renderFinalReviewSpatialEditor\(beat, index, beats, sceneContext\)/);
  assert.ok(workspace.indexOf("renderFinalReviewStoryCanvas") < workspace.indexOf("renderFinalReviewSpatialEditor"));
  assert.doesNotMatch(workspace, /renderFinalReviewBeatRail|renderFinalReviewInspector/);

  assert.match(storyCanvas, /data-final-review-story-canvas/);
  assert.match(storyCanvas, /data-final-review-story-canvas-viewport/);
  assert.match(storyCanvas, /final-review-story-canvas-track/);
  assert.match(storyCanvas, /return count \+ Math\.max\(options\.length, 1\)/);
  assert.match(storyCanvas, /renderFinalReviewStoryBeat\(beat, index, beats\.length, selectedIndex, selectedContext\)/);

  assert.match(sceneContexts, /const defaultOption = sourceGraphDefaultVariantOption\(group\)/);
  assert.match(sceneContexts, /spatialSceneContext\(beat\.id, group\.id, defaultOption\.id\)/);
  assert.match(sceneContexts, /filter\(\(option\) => option\.id !== defaultOption\.id\)/);
  assert.ok(
    sceneContexts.indexOf("spatialSceneContext(beat.id, group.id, defaultOption.id)")
      < sceneContexts.indexOf("filter((option) => option.id !== defaultOption.id)"),
    "the default option is the first scene context for a variant beat",
  );

  assert.match(storyBeat, /const primaryContext = spatialSceneContext\(beat\.id, group\?\.id, defaultOption\?\.id\)/);
  assert.match(storyBeat, /renderFinalReviewStorySceneCard\(beat, defaultOption, primaryContext,[^\n]+true\)/);
  assert.match(storyBeat, /final-review-story-variant-branch/);
  assert.match(storyBeat, /final-review-story-variant-list/);
  assert.match(storyBeat, /spatialSceneContext\(beat\.id, group\.id, option\.id\)/);
  assert.match(storyBeat, /\$\{alternatives\.length \+ 1\} variants/);
  assert.match(storyBeat, /<span class="final-review-story-connector" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(storyBeat, /final-review-story-connector[^\n]*→/);
  assert.ok(
    storyBeat.indexOf("renderFinalReviewStorySceneCard(beat, defaultOption")
      < storyBeat.indexOf("final-review-story-variant-branch"),
    "the host beat's default variant stays above its nested alternatives",
  );

  assert.match(sceneCard, /sourceGraphTransitionContextMatches\(context, selectedContext\)/);
  assert.match(sceneCard, /data-final-review-scene-key="\$\{escapeHtml\(sceneKey\)\}"/);
  assert.match(sceneCard, /data-final-review-variant-group-id/);
  assert.match(sceneCard, /data-final-review-variant-option-id/);
  assert.match(sceneCard, /primary \? "primary-scene" : "nested-variant"/);
  assert.match(sceneCard, /Default variant ·/);
  assert.match(sceneCard, /selected \? `aria-current="step"` : ""/);

  assert.match(spatialEditor, /data-final-review-spatial-editor/);
  assert.match(spatialEditor, /<h3>Check this scene<\/h3>/);
  assert.match(spatialEditor, /spatialSceneContextLabel\(sceneContext\)/);
  assert.match(spatialEditor, /data-final-review-viewer="\$\{escapeHtml\(spatialSceneRequestKey\(sceneContext\)/);
  assert.doesNotMatch(spatialEditor, /data-final-review-step|Previous beat|Next beat/);

  assert.match(styles, /\.final-review-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.final-review-story-canvas-viewport\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.final-review-story-canvas-track\s*\{[^}]*display:\s*flex;[^}]*width:\s*max-content/s);
  assert.match(styles, /\.final-review-story-beat-cluster\s*\{[^}]*width:\s*210px/s);
  assert.match(styles, /\.final-review-story-variant-branch\s*\{[^}]*border-left:\s*2px solid/s);
  assert.match(styles, /\.final-review-story-variant-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.final-review-story-beat\.nested-variant\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*52px/s);
  assert.match(styles, /\.final-review-story-beat\.selected\s*\{[^}]*border-color:\s*var\(--accent\)/s);
  assert.match(styles, /\.final-review-story-connector::before\s*\{[^}]*height:\s*var\(--story-canvas-arrow-stroke-width\);[^}]*background:\s*var\(--story-canvas-arrow-color\);/s);
  assert.match(styles, /\.final-review-story-connector::after\s*\{[^}]*border-left:\s*var\(--story-canvas-arrowhead-length\) solid var\(--story-canvas-arrow-color\);/s);
  assert.match(styles, /\.final-review-preview-card\s*\{[^}]*width:\s*100%/s);
});

test("variant cards select and restore a full scene context, including exact-key focus", () => {
  const events = functionSource("bindEvents");
  const openScene = functionSource("openFinalReviewScene");
  const applyNavigation = functionSource("applyStoryvrBrowserNavigation");
  const selectedScene = functionSource("finalReviewSelectedSceneContext");
  const canvasInitializer = functionSource("initializeFinalReviewStoryCanvas");
  const activeProgression = functionSource("finalReviewActiveProgressionBoundary");
  const spatialEditor = functionSource("renderFinalReviewSpatialEditor");

  assert.match(events, /querySelectorAll\("\[data-final-review-beat-index\]"\)/);
  assert.match(events, /const selectedContext = spatialSceneContext\(\s*beat\.id,\s*beatButton\.dataset\.finalReviewVariantGroupId,\s*beatButton\.dataset\.finalReviewVariantOptionId,\s*\)/s);
  assert.match(events, /finalReviewSceneContextsForBeat\(beat\)\s*\.find\(\(context\) => sourceGraphTransitionContextMatches\(context, selectedContext\)\)/s);
  assert.match(events, /openFinalReviewScene\(validContext\)/);
  assert.doesNotMatch(events, /finalReviewPendingBeatFocusIndex/);
  assert.match(openScene, /pushStoryvrBrowserNavigation/);
  assert.match(openScene, /createStoryvrNavigationRoute\("transition-pacing", validContext\)/);
  assert.match(openScene, /parentEntryId:\s*currentEntry\?\.entryId/);
  assert.match(applyNavigation, /navigation\.componentId === "transition-pacing"/);
  assert.match(applyNavigation, /state\.selectedFinalReviewBeatIndex = selectedIndex/);
  assert.match(applyNavigation, /state\.selectedFinalReviewSceneContext = validContext/);
  assert.match(applyNavigation, /state\.finalReviewPendingSceneFocusKey = spatialSceneRequestKey\(validContext\)/);

  assert.match(selectedScene, /state\.selectedFinalReviewSceneContext\.variantGroupId/);
  assert.match(selectedScene, /state\.selectedFinalReviewSceneContext\.variantOptionId/);
  assert.match(selectedScene, /contexts\.find\(\(context\) => sourceGraphTransitionContextMatches\(context, stored\)\) \|\| contexts\[0\]/);
  assert.match(selectedScene, /state\.selectedFinalReviewSceneContext = selected/);

  assert.match(canvasInitializer, /querySelector\("\[data-final-review-scene-key\]\[aria-current=\\"step\\"\]"\)/);
  assert.match(canvasInitializer, /viewport\.getBoundingClientRect\(\)/);
  assert.match(canvasInitializer, /selected\.getBoundingClientRect\(\)/);
  assert.match(canvasInitializer, /state\.finalReviewPendingSceneFocusKey === selected\.dataset\.finalReviewSceneKey/);
  assert.match(canvasInitializer, /state\.finalReviewPendingSceneFocusKey = ""/);
  assert.match(canvasInitializer, /selected\.focus\(\{ preventScroll: true \}\)/);

  assert.match(activeProgression, /interactionBoundaryContext\(selectedInteractionControlBase\(\), sceneContext\)/);
  assert.match(activeProgression, /boundary\.fromBeatId === beatId/);
  assert.match(activeProgression, /sourceGraphTransitionContextMatches\(boundary\.fromContext, sceneContext/,
    "the selected variant resolves its own outgoing progression instead of the host beat's route");
  assert.doesNotMatch(
    spatialEditor,
    /data-final-review-(?:play|restart|action|xr-slot)|Pause motion|Replay |Controller button press|VR NOT SUPPORTED/,
    "the Final Review spatial editor omits playback, route-action, and XR support controls",
  );
});

test("Final Review carries the exact authored route into complete transition execution", () => {
  const initializer = functionSource("initializeFinalReviewViewer");
  const openScene = functionSource("openFinalReviewScene");
  const transitionPlayback = functionSource("finalReviewTransitionPlaybackForContext");
  const transitionExecution = functionSource("updateFinalReviewTransitionExecution");
  const attachDynamics = functionSource("attachSourceDynamicsPreviewAnimation");
  const transitionViewer = functionSource("viewerExecutesInterBeatTransition");
  const transitionEffects = functionSource("addFinalReviewTransitionEffects");

  assert.match(openScene, /authoredMotionTransitions\(\{ preserveParallel: true, includeSameBeat: true \}\)/);
  assert.match(openScene, /sourceGraphTransitionContextMatches\(candidate\.fromContext, currentContext\)/);
  assert.match(openScene, /sourceGraphTransitionContextMatches\(candidate\.toContext, validContext\)/);
  assert.match(openScene, /state\.finalReviewPendingTransition = authoredTransition/);

  assert.match(transitionPlayback, /state\.finalReviewPendingTransition = null/);
  assert.match(transitionPlayback, /transitionEdgeId: pending\.edgeId/);
  assert.match(transitionPlayback, /interBeatBoundaryPlaybackSummary/);
  assert.match(transitionPlayback, /sourceGraphTransitionContextMatches\(fromContext, pending\.fromContext\)/);
  assert.match(transitionPlayback, /sourceGraphTransitionContextMatches\(toContext, pending\.toContext\)/);

  assert.match(initializer, /const transitionPlayback = finalReviewTransitionPlaybackForContext\(sceneContext\)/);
  assert.match(initializer, /const transitionAssetLinks = finalReviewTransitionAssetLinks\(transitionPlayback\)/);
  assert.match(initializer, /sourcePlaybackSummary: transitionPlayback\?\.sourcePlaybackSummary/);
  assert.match(initializer, /legacySourceMotionTracks: transitionPlayback\?\.mappedTracks/);
  assert.match(initializer, /variantTransitionAnimationSpec: transitionPlayback\?\.variantTransitionAnimationSpec/);
  assert.match(initializer, /sourceMotionTransition: transitionBoundary\?\.fromBeatId/);
  assert.match(initializer, /sourcePartFromBeatId: transitionBoundary\?\.fromBeatId/);
  assert.match(initializer, /sourcePartToBeatId: transitionBoundary\?\.toBeatId/);
  assert.match(initializer, /transitionPlaying: false/);
  assert.match(initializer, /transitionStarted: false/);
  assert.match(initializer, /playOnce: Boolean\(transitionPlayback\)/,
    "Final Review completes every crossed transition once instead of wrapping legacy routes forever");
  assert.match(initializer, /const startFinalReviewTransition = \(\) =>/);
  assert.match(initializer, /viewer\.sourceElapsed = 0/);
  assert.match(initializer, /viewer\.transitionPlaying = true/);
  assert.match(initializer, /viewer\.transitionStarted = true/);
  assert.match(initializer, /if \(pending === 0\)[^]*startFinalReviewTransition\(\)/,
    "transition playback starts only after every exact from/to scene asset has loaded");

  assert.match(transitionViewer, /viewer\?\.componentId === "transition-pacing"/);
  assert.match(transitionViewer, /viewer\.finalReviewTransitionPlayback/);
  assert.match(attachDynamics, /viewerExecutesInterBeatTransition\(viewer\)/,
    "Final Review uses the same shared-timeline, mapped-clip, and frozen-part attachment path as Transition");
  assert.match(transitionExecution, /viewer\.sourceElapsed = Math\.min\(cycleSeconds/);
  assert.match(transitionExecution, /const completed = progress >= 1;/,
    "legacy route transitions run their complete authored cycle even though they are not scrub-enabled");
  assert.doesNotMatch(transitionExecution, /canScrub/,
    "scrub capability does not determine whether a transition has finished");
  assert.match(transitionExecution, /canvas\.dataset\.finalReviewTransitionProgress = progress\.toFixed\(4\)/);
  assert.match(transitionExecution, /canvas\.dataset\.finalReviewTransitionState = completed \? "complete" : "playing"/);
  assert.match(transitionExecution, /applyInterBeatSourcePartMasks\(viewer, completed \? "destination" : "transition"\)/);
  assert.match(transitionExecution, /updateSourceTransitionPlayback\(viewer, entry\)/);
  assert.match(transitionExecution, /entry\.mixer\.setTime\(duration \* THREE\.MathUtils\.lerp\(start, end, progress\)\)/);
  assert.match(transitionExecution, /viewer\.transitionPlaying = false/);

  assert.match(
    initializer,
    /transitionPlayback \|\| activeProgressionPlayback/,
    "decorative cues never replace the exact-route execution contract",
  );
  assert.match(
    transitionEffects,
    /if\s*\(\s*playback\?\.canScrub\s*!==\s*true\s*\|\|\s*transitionKind\s*!==\s*"discrete-pop"\s*\)\s*return;/,
    "an unmapped route cannot create Final Review transition decoration",
  );
  assert.ok(
    transitionEffects.indexOf("playback?.canScrub") < transitionEffects.indexOf("new THREE.Mesh"),
    "mapping eligibility is checked before the flash sphere or burst geometry is created",
  );
  assert.match(transitionEffects, /new THREE\.SphereGeometry\(/,
    "a mapped discrete-pop route retains its authored transition flash");

  const addTransitionEffects = new Function(`
    ${transitionEffects}
    return addFinalReviewTransitionEffects;
  `)();
  let rootMutationCount = 0;
  const viewer = {
    root: { add() { rootMutationCount += 1; } },
    regionMarkers: [],
  };
  for (const playback of [null, { canScrub: false }]) {
    assert.equal(addTransitionEffects(viewer, { color: 0xc75f1f }, "discrete-pop", playback), undefined);
  }
  assert.equal(rootMutationCount, 0, "unmapped Final Review routes add no transition geometry");
  assert.equal(viewer.flash, undefined);
  assert.deepEqual(viewer.regionMarkers, []);
});

test("the Final Review viewer loads an exact variant scene and mounts its text panel on the runtime reader hand", () => {
  const appRender = functionSource("render");
  const workspace = functionSource("renderFinalReviewWorkspace");
  const spatialEditor = functionSource("renderFinalReviewSpatialEditor");
  const initializer = functionSource("initializeFinalReviewViewer");
  const readerHand = functionSource("addFinalReviewReaderHandRig");
  const responsiveHand = functionSource("updateFinalReviewReaderHandRigViewport");
  const textPanel = functionSource("addFinalReviewTextPanel");
  const panelViewport = functionSource("updateFinalReviewTextPanelViewport");

  assert.match(appRender, /const showCompiler = isFinalReview/);
  assert.match(appRender, /showCompiler \? `<section class="preview inline-preview">\$\{renderPreviewQa\(\)\}/);
  assert.match(appRender, /initializeFinalReviewStoryCanvas\(active\)/);
  assert.match(workspace, /const decision = state\.data\.decisions\[component\.id\]/);
  assert.match(workspace, /Optional cleanup/);
  assert.match(workspace, /renderCheckpointActions\(component, decision/);
  assert.match(workspace, /label:\s*"Finish review"/);

  assert.match(initializer, /const sceneContext = finalReviewSelectedSceneContext\(beats, beatIndex\)/);
  assert.match(initializer, /const beat = finalReviewBeatForSceneContext\(sceneContext\) \|\| baseBeat/);
  assert.match(initializer, /const cumulativeContext = finalReviewCumulativeContextForBeat\(beats, beatIndex, sceneContext, beat\)/);
  assert.match(initializer, /const transitionAssetLinks = finalReviewTransitionAssetLinks\(transitionPlayback\)/);
  assert.match(initializer, /const exactSceneAssetLinks = transitionAssetLinks\.length\s*\? transitionAssetLinks/s);
  assert.match(initializer, /beat && \(proceduralPlan \|\| sceneContext\?\.variantOptionId\)\s*\? dynamicSceneAssetLinks\(null, \[beat\], sceneContext\)/s,
    "applied motion renders every exact saved Spatial entity, including repeated instances of one GLB");
  assert.match(initializer, /spatialSceneContextsByAssetId: transitionPlayback\s*\? interBeatSpatialSceneContextsByAssetId\(transitionBoundary\)\s*:\s*new Map\(exactSceneAssetLinks\.map\(\(link\) => \[link\.assetId, sceneContext\]\)\)/s);
  assert.match(initializer, /assetLinks: exactSceneAssetLinks/);
  assert.match(initializer, /scene\.add\(camera\)/);
  assert.match(initializer, /scene\.background = new THREE\.Color\(0x080a08\)/,
    "Final Review uses the compiled reader's dark world when no environment is authored");
  assert.match(initializer, /scene\.fog = null/,
    "Final Review keeps source geometry unfogged when no environment is authored");
  assert.match(initializer, /renderer\.setClearColor\(0x080a08, 1\)/,
    "Final Review clears XR and transparent framebuffers to the same neutral world");
  assert.doesNotMatch(initializer, /scene\.background = new THREE\.Color\(0xf8f7ec\)/,
    "Final Review no longer falls back to the pale authoring-canvas background");
  assert.match(initializer, /const readerHandRig = addFinalReviewReaderHandRig\(camera, camera\.aspect\)/);
  assert.match(initializer, /readerHandRig,/);
  assert.match(initializer, /controls\.enableZoom = false/,
    "Final Review keeps the reader view at the fixed VR scale");
  assert.match(initializer, /addFinalReviewTextPanel\(viewer, beat, region\)/);
  assert.match(initializer, /const renderCamera = finalReviewRenderCamera\(viewer\);\s*updateFinalReviewReaderHandRigViewport\(viewer\.readerHandRig, renderCamera\.aspect, renderCamera\.fov\)/s);
  assert.match(initializer, /if \(exactSceneAssetLinks\.length\)/);
  assert.match(initializer, /loadDynamicAsset\(viewer, assetLink, index, exactSceneAssetLinks\.length, true, \(ok\) =>/);
  assert.match(initializer, /loadNextExactSceneAsset\(index \+ 1\)/);
  assert.match(initializer, /Loading \$\{pending\} more exact-scene asset/);
  assert.match(initializer, /attachLockedEnvironmentToViewer\(viewer\)/);
  assert.match(initializer, /applyFinalReviewTuningDirectives\(viewer, finalReviewTuningDirectives\(\)\)/);

  assert.match(readerHand, /group\.userData\.attachmentPolicy = "reader-hand"/);
  assert.match(readerHand, /makeInteractionHandMesh\("left"\)/);
  assert.match(readerHand, /panelAnchor\.userData\.attachmentPolicy = "reader-hand"/);
  assert.match(readerHand, /camera\.add\(group\)/);
  assert.match(readerHand, /updateFinalReviewReaderHandRigViewport\(rig, aspect\)/);

  assert.match(responsiveHand, /const compactness = THREE\.MathUtils\.clamp/);
  assert.match(responsiveHand, /THREE\.MathUtils\.lerp\(-0\.52, -1\.28, compactness\)/);
  assert.match(responsiveHand, /const viewportScale = THREE\.MathUtils\.clamp\(renderTangent \/ referenceTangent/,
    "a contracted narrow-FOV source camera keeps the hand panel at the reader camera's apparent size");
  assert.match(responsiveHand, /\(-0\.16 \* viewportScale\) \+ offsetY/,
    "narrow source-camera FOVs keep the hand itself inside the viewport");

  assert.match(textPanel, /FINAL_REVIEW_XR_TEXT_PANEL_WIDTH, FINAL_REVIEW_XR_TEXT_PANEL_HEIGHT/);
  assert.match(textPanel, /updateFinalReviewTextPanelViewport\(viewer\)/);
  assert.match(panelViewport, /group\.position\.set\(\(0\.25 \* side\) \+ offsetX, 0\.115 \+ offsetY, -0\.32\)/,
    "the hand stays visible beside the reader-attached panel");
  assert.match(panelViewport, /group\.rotation\.set\(-0\.16, -0\.12 \* side, 0\)/);
  assert.match(textPanel, /viewer\.readerHandRig\?\.panelAnchor \|\| viewer\.camera/);
  assert.match(textPanel, /viewer\.textOrientationPolicy = "reader-hand"/);
  assert.match(textPanel, /depthTest:\s*false/, "scene objects cannot occlude the reader-attached Final Review text panel");
  assert.match(textPanel, /depthWrite:\s*false/, "the transparent panel does not write an opaque depth mask");
  assert.match(textPanel, /panel\.renderOrder = READER_UI_RENDER_ORDER/,
    "the Final Review panel renders after story geometry and attention effects");
  assert.doesNotMatch(textPanel, /lockedTextPlacementForBeat|textPlacementWorldPosition/);
  assert.match(spatialEditor, /text panel attached to the reader's left hand/);
});

test("Final Review installs and disposes the saved matching-ground cue with its panorama", () => {
  const initializer = functionSource("initializeFinalReviewViewer");
  const attachEnvironment = functionSource("attachLockedEnvironmentToViewer");
  const syncGround = functionSource("syncLockedEnvironmentGroundMovementCue");
  const disposeEnvironment = functionSource("disposeLockedEnvironmentFromViewer");

  assert.match(initializer, /attachLockedEnvironmentToViewer\(viewer\)/);
  assert.match(
    attachEnvironment,
    /viewer\.scene\.environment = texture;[\s\S]*syncLockedEnvironmentGroundMovementCue\(viewer, contract, transform\.rotationY\)/,
    "the matching ground is installed only after the saved panorama has loaded",
  );
  assert.ok(
    attachEnvironment.indexOf("if (ENVIRONMENT_MODEL_MEDIA_TYPES.has(mediaType))")
      < attachEnvironment.indexOf("syncLockedEnvironmentGroundMovementCue(viewer, contract, transform.rotationY)"),
    "model environments return before the panorama-only ground cue is installed",
  );
  assert.match(syncGround, /normalizeGroundMovementCue\(\{[\s\S]*\.\.\.contract\?\.movementCue,[\s\S]*rotationY/);
  assert.match(syncGround, /environmentGroundTextureUrl\(movementCue\.texture\)/);
  assert.match(syncGround, /createGroundMovementCue\(movementCue, \{[\s\S]*renderer: viewer\.renderer,[\s\S]*textureUrl/);
  assert.match(syncGround, /viewer\.scene\.add\(viewer\.groundMovementCue\.mesh\)/);
  assert.match(disposeEnvironment, /groundMovementCue\?\.dispose\?\.\(\)/);
  assert.match(disposeEnvironment, /viewer\.groundMovementCue = null/);
});

test("Final Review keeps an authored environment policy above source presentation metadata", () => {
  const attachEnvironment = functionSource("attachLockedEnvironmentToViewer");
  const policyExists = functionSource("authoredEnvironmentPolicyExists");
  const syncPresentation = new Function(
    "THREE",
    `
      ${functionSource("sourcePlaybackPresentationBackground")}
      ${functionSource("syncFinalReviewSourcePresentation")}
      return syncFinalReviewSourcePresentation;
    `,
  )(THREE);
  const viewer = {
    scene: new THREE.Scene(),
    renderer: { setClearColor() {} },
    lockedEnvironmentActive: false,
    authoredEnvironmentPolicyActive: true,
  };
  viewer.scene.background = new THREE.Color(0x080a08);
  const playback = { asset: { presentation: { backgroundColor: "#e8edef" } } };

  syncPresentation(viewer, playback);
  assert.equal(viewer.scene.background.getHexString(), "080a08",
    "an explicit neutral Environment Enhancement decision keeps the authored black world");

  viewer.authoredEnvironmentPolicyActive = false;
  syncPresentation(viewer, playback);
  assert.equal(viewer.scene.background.getHexString(), "e8edef",
    "legacy stories without an Environment Enhancement decision may retain source presentation metadata");

  assert.match(policyExists, /decisions\?\.\["environment-enhancement"\]\?\.option/);
  assert.match(attachEnvironment, /viewer\.authoredEnvironmentPolicyActive = authoredEnvironmentPolicyExists\(\)/);
});

test("Reader look starts from the authored pose once and preserves its position across beat changes", () => {
  const authoredTransform = functionSource("finalReviewAuthoredReaderTransform");
  const applyPose = functionSource("applyFinalReviewAuthoredReaderPose");
  const resetReaderLook = functionSource("resetFinalReviewReaderLookAnchor");
  const setMode = functionSource("setFinalReviewViewRotationMode");
  const initializer = functionSource("initializeFinalReviewViewer");
  const openScene = functionSource("openFinalReviewScene");
  const finiteCameraArray = functionSource("finiteFinalReviewCameraArray");
  const shouldRestore = functionSource("shouldRestoreFinalReviewViewerCameraState");

  assert.match(authoredTransform, /interactionReaderTransformForContext\(context\)/);
  assert.match(applyPose, /viewer\.viewRotationMode !== "reader"/);
  assert.match(applyPose, /new THREE\.Vector3\(\)\.fromArray\(transform\.position\)/);
  assert.match(applyPose, /new THREE\.Quaternion\(\)\.fromArray\(transform\.quaternion\)\.normalize\(\)/);
  assert.match(applyPose, /new THREE\.Vector3\(0, 0, -1\)\.applyQuaternion\(quaternion\)/);
  assert.match(applyPose, /viewer\.camera\.position\.copy\(position\)/);
  assert.match(applyPose, /viewer\.camera\.quaternion\.copy\(quaternion\)/);
  assert.match(applyPose, /viewer\.readerLookPosition\.copy\(position\)/);
  assert.match(applyPose, /viewer\.authoredReaderTransform = transform/);
  assert.doesNotMatch(resetReaderLook, /applyFinalReviewAuthoredReaderPose/,
    "re-anchoring Reader look must use the current camera instead of the selected beat's station");
  assert.match(resetReaderLook, /viewer\.readerLookPosition\.copy\(viewer\.camera\.position\)/);
  assert.match(initializer, /const restoredCameraState = state\.finalReviewViewerCameraState/);
  assert.match(initializer, /const canRestoreCameraState = shouldRestoreFinalReviewViewerCameraState\(viewer, restoredCameraState\)/);
  assert.match(initializer, /if \(canRestoreCameraState\) \{\s*applyFinalReviewViewerCameraState\(viewer, restoredCameraState\);\s*\} else if \(viewer\.viewRotationMode === "reader"\) \{\s*applyFinalReviewAuthoredReaderPose\(viewer\);\s*\}/s,
    "only the first reader entry uses the authored Spatial Relations pose");
  assert.match(openScene, /state\.finalReviewViewerCameraState = captureFinalReviewViewerCameraState\(\)/,
    "selecting another beat captures the current reader pose before rebuilding the scene");
  assert.match(setMode, /if \(!restoredStoredCameraState\) applyFinalReviewAuthoredReaderPose\(viewer\)/,
    "Reader look uses an authored pose only when it has no earlier reader camera to restore");
  assert.doesNotMatch(shouldRestore, /topologyKind|topologyViewpoint/,
    "beat-specific topology metadata cannot invalidate the reader's continuous position");

  const restorePredicate = new Function(`
    ${finiteCameraArray}
    ${shouldRestore}
    return shouldRestoreFinalReviewViewerCameraState;
  `)();
  assert.equal(restorePredicate(
    { disposed: false, topologyKind: "single", topologyViewpoint: "egocentric" },
    {
      position: [2.4, 1.7, -0.8],
      quaternion: [0, 0.38, 0, 0.92],
      target: [1.4, 1.6, -2.1],
      near: 0.02,
      far: 1000,
      topologyKind: "map",
      topologyViewpoint: "exocentric",
    },
  ), true, "a valid reader camera survives a beat with different topology and viewpoint metadata");

  const resetReaderAnchor = new Function("THREE", `
    ${resetReaderLook}
    return resetFinalReviewReaderLookAnchor;
  `)(THREE);
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.02, 1000);
  camera.position.set(2.4, 1.7, -0.8);
  camera.lookAt(1.4, 1.6, -2.1);
  camera.updateMatrixWorld(true);
  const preservedPosition = camera.position.clone();
  const viewer = {
    disposed: false,
    viewRotationMode: "reader",
    camera,
    controls: { target: new THREE.Vector3(1.4, 1.6, -2.1) },
    readerLookPosition: null,
    readerLookDirection: null,
    readerLookDistance: null,
  };
  assert.equal(resetReaderAnchor(viewer), true);
  assert.ok(camera.position.distanceTo(preservedPosition) < 1e-9);
  assert.ok(viewer.readerLookPosition.distanceTo(preservedPosition) < 1e-9,
    "rebuilding the beat anchors Reader look at its existing position");
});

test("Final Review activates compiled-style Attention Guidance arrows and investigation sparkles", () => {
  const initializer = functionSource("initializeFinalReviewViewer");
  const sync = functionSource("syncFinalReviewAttentionGuidance");
  const resolve = functionSource("finalReviewAttentionTargetForMarker");
  const arrow = functionSource("createFinalReviewAttentionArrow");
  const texture = functionSource("createFinalReviewInvestigationTexture");
  const sparkle = functionSource("createFinalReviewAttentionSparkle");
  const syncSparkle = functionSource("syncFinalReviewAttentionSparkle");
  const applySparkles = functionSource("applyFinalReviewAttentionSparkles");
  const disposeSparkle = functionSource("disposeFinalReviewAttentionSparkle");
  const entries = functionSource("finalReviewAttentionEntries");
  const visible = functionSource("attentionRenderableIsVisible");
  const distanceToTarget = functionSource("finalReviewAttentionTargetDistanceToPoint");
  const diagnostics = functionSource("publishFinalReviewAttentionDiagnostics");
  const smoothArrow = functionSource("smoothAttentionArrowAngle");
  const positionArrow = functionSource("positionFinalReviewAttentionArrow");
  const update = functionSource("updateFinalReviewAttentionGuidance");
  const dispose = functionSource("disposeFinalReviewViewer");
  const clear = functionSource("clearFinalReviewAttentionGuidance");

  assert.match(source, /finalReviewCompletedAttentionKeys: new Set\(\)/);
  assert.match(initializer, /syncFinalReviewAttentionGuidance\(viewer\)/,
    "attention activation waits for the scene's GLBs to finish loading");
  assert.match(sync, /attentionSceneRecordForContext\(\s*attentionGuidanceSourceContract\(\),\s*viewer\.sceneContext/s);
  assert.match(sync, /attentionScene\?\.evaluated !== true/);
  assert.match(sync, /attentionSceneMarkers\(attentionScene\)/);
  assert.match(sync, /state\.finalReviewCompletedAttentionKeys\.has\(target\.key\)/);
  assert.match(entries, /viewer\?\.proceduralPreviewEntries/,
    "visible generated Dynamics instances participate in Final Review attention resolution");
  assert.match(resolve, /candidate\?\.authorWrapper\?\.userData\?\.spatialEntityId/);
  assert.match(resolve, /const groups = entries\.flatMap/);
  assert.match(resolve, /rootsByMesh/);
  assert.match(resolve, /sourcePartSelectorMatchesNode\(selector, object, root\)/);
  assert.match(visible, /let reachedRoot = false/);
  assert.match(visible, /current\.visible === false/,
    "a suppressed authored wrapper cannot masquerade as a visible attention target");
  assert.match(distanceToTarget, /Math\.min\(\.\.\.activeBounds\.map/,
    "a school of clones completes only near an actual shark, not inside their combined box");
  assert.match(diagnostics, /storyvrAttentionVisibleSparkleCount/,
    "the live canvas exposes the visible investigation-point count for visual QA");
  assert.match(diagnostics, /delete canvas\.dataset\.storyvrAttentionGlowCount/,
    "stale full-model glow diagnostics are removed");
  assert.match(update, /publishFinalReviewAttentionDiagnostics\(viewer\)/);
  assert.match(arrow, /StoryVR attention arrow · Final Review/);
  assert.match(texture, /createRadialGradient/);
  assert.match(texture, /diamond\(3, 35/);
  assert.match(sparkle, /new THREE\.SpriteMaterial/);
  assert.match(sparkle, /THREE\.AdditiveBlending/);
  assert.match(sparkle, /THREE\.NormalBlending/);
  assert.match(sparkle, /Array\.from\(\{ length: 7 \}/);
  assert.match(sparkle, /StoryVR investigation sparkle · Final Review/);
  assert.match(syncSparkle, /Math\.sin\(time \* 5\.4\)/);
  assert.match(syncSparkle, /bounds\.max\.y/);
  assert.match(syncSparkle, /sphere\.radius \* 0\.52/);
  assert.match(syncSparkle, /mote\.position\.set/);
  assert.match(applySparkles, /group\.investigationEffect/);
  assert.match(disposeSparkle, /texture\?\.dispose/);
  assert.doesNotMatch(
    [sparkle, syncSparkle, applySparkles].join("\n"),
    /mesh\.clone\(false\)|BackSide|Attention halo/i,
    "the point effect does not wrap or tint the target model",
  );
  assert.match(update, /applyFinalReviewAttentionSparkles\(viewer, target, active, deltaSeconds\)/);
  assert.match(smoothArrow, /Math\.exp/);
  assert.match(smoothArrow, /ATTENTION_ARROW_MAX_ANGULAR_SPEED_RADIANS_PER_SECOND/);
  assert.match(positionArrow, /smoothAttentionArrowAngle/);
  assert.match(positionArrow, /storyvrAttentionArrowAngle/);
  assert.match(
    update,
    /const completionEnabled = viewer\.renderer\?\.xr\?\.isPresenting \|\| viewer\.viewRotationMode === "reader"/,
    "orbit/editor navigation cannot consume a reader attention target",
  );
  assert.match(update, /finalReviewAttentionTargetDistanceToPoint\(target, readerPosition\)/);
  assert.match(update, /target\.rootsByMesh\?\.get\(mesh\) \|\| target\.root/);
  assert.match(
    update,
    /const shouldComplete = completionEnabled\s*&& !completed\s*&& targetVisible\s*&& Number\.isFinite\(distance\)\s*&& distance <= 3/s,
    "the saved three-meter threshold only completes from Reader look or XR",
  );
  assert.match(update, /target\.arrow\.visible = active && !finalReviewAttentionTargetInView\(bounds, camera\)/);
  assert.match(
    initializer,
    /controls\.update\(\);\s*stabilizeFinalReviewReaderLook\(viewer\);\s*}\s*const renderCamera = finalReviewRenderCamera\(viewer\);\s*updateFinalReviewAttentionGuidance\(viewer, renderCamera, delta\)/s,
    "the camera finishes its current-frame update before the damped arrow samples it",
  );
  assert.match(clear, /disposeFinalReviewAttentionTarget\(target\)/);
  assert.match(dispose, /clearFinalReviewAttentionGuidance\(finalReviewViewer\)/);
});

test("Final Review preserves the saved Spatial Relations floor and framing contract", () => {
  const framingSource = functionSource("finalReviewSpatialFraming");
  const loadSwap = functionSource("loadTopologySwapAsset");
  const loadSingle = functionSource("loadFinalReviewAsset");
  const framingFor = new Function("spatialTopologyAssetPose", "spatialEntityVerticalAlignment", `
    ${framingSource}
    return finalReviewSpatialFraming;
  `)(
    () => ({ targetSize: 5.4 }),
    (entity) => entity.verticalAlignment,
  );
  const centeredEntity = { kind: "glb", verticalAlignment: "center", manual: true };

  assert.deepEqual(
    framingFor({ componentId: "transition-pacing" }, centeredEntity),
    { anchorY: 0, targetSize: 5.4, verticalAlignment: "center" },
    "Final Review uses the authored floor origin, room-scale target, and saved centered pivot",
  );
  assert.equal(
    framingFor({ componentId: "dynamic-geometry" }, centeredEntity),
    null,
    "the parity repair does not change other checkpoint preview framing",
  );
  assert.match(loadSwap, /finalReviewSpatialFraming\(viewer, spatialEntity, index, 1\)/);
  assert.match(loadSwap, /topologyWrapper\.position\.set\(0, finalReviewFraming\?\.anchorY \?\? 0\.16, 0\)/);
  assert.match(
    loadSwap,
    /if \(finalReviewFraming\)[\s\S]*?normalizeSpatialRuntimeObject\([\s\S]*?finalReviewFraming\.verticalAlignment/s,
    "cumulative Final Review assets preserve the saved vertical-alignment pivot",
  );
  assert.match(loadSingle, /finalReviewSpatialFraming\(viewer, spatialEntity\)/);
  assert.match(loadSingle, /topologyWrapper\.position\.set\(0, finalReviewFraming\?\.anchorY \?\? 0\.2, 0\)/);
  assert.match(
    loadSingle,
    /if \(finalReviewFraming\)[\s\S]*?normalizeSpatialRuntimeObject\([\s\S]*?finalReviewFraming\.verticalAlignment/s,
    "the single-asset fallback uses the same saved spatial framing",
  );
});

test("Final Review opts into exact shared-timeline holds without changing legacy asset loading", () => {
  const attach = functionSource("attachFinalReviewSourcePlayback");
  const transitionAttach = functionSource("attachSourceTransitionPlayback");
  const loadDynamic = functionSource("loadDynamicAsset");
  const loadSwap = functionSource("loadTopologySwapAsset");
  const loadSingle = functionSource("loadFinalReviewAsset");
  const animate = functionSource("animateFinalReviewViewer");

  assert.match(attach, /viewer\?\.componentId !== "transition-pacing"/);
  assert.match(attach, /asset\?\.mode !== "shared-timeline"/);
  assert.match(attach, /return attachSourceTransitionPlayback\(viewer, entry, gltf\)/);
  assert.match(transitionAttach, /viewer\.beat\?\.id/,
    "the selected Final Review beat is the destination state");
  assert.match(transitionAttach, /forceHold: viewer\.sourcePartPlaybackMode === "frozen" \|\| !viewer\.sourceMotionTransition/,
    "Final Review resolves a held beat state instead of replaying an inter-beat scrub");
  assert.match(loadDynamic, /attachSourceDynamicsPreviewAnimation\(viewer, dynamicEntry, gltf\);\s*attachProceduralDynamicsPreviewMotion\(viewer, dynamicEntry, gltf\);\s*attachFinalReviewSourcePlayback\(viewer, dynamicEntry, gltf\)/s,
    "exact variant scenes retain source playback while adding applied generated motion and the opt-in shared-timeline consumer");
  assert.match(loadSwap, /attachProceduralDynamicsPreviewMotion\(viewer, entry, gltf\)/,
    "cumulative Final Review scenes bind motion only to matching existing entities");
  assert.match(loadSwap, /lockedSpatialGlbEntityForViewer\(viewer, step\.assetId, step\.entityId\)/,
    "entity-aware transition steps cannot borrow another instance's saved transform");
  assert.match(loadSwap, /attachFinalReviewSourcePlayback\(viewer, entry, gltf\)/,
    "cumulative Final Review scenes attach the same contract");
  assert.match(loadSingle, /attachProceduralDynamicsPreviewMotion\(viewer, viewer\.finalReviewAssetEntry, gltf\)/,
    "single-asset Final Review scenes bind applied motion to the authored model");
  assert.match(loadSingle, /attachFinalReviewSourcePlayback\(viewer, viewer\.finalReviewAssetEntry, gltf\)/,
    "the single-asset Final Review path attaches the same contract");
  assert.match(animate, /updateSourceTransitionPlayback\(viewer, sourcePlaybackEntry\)/);
  assert.match(animate, /updateSourcePlaybackAnnotations\(sourcePlaybackEntry\.sourcePlayback\)/);
  assert.match(animate, /sourcePlaybackEntry !== viewer\.finalReviewAssetEntry/,
    "the exact held single-asset state is not disturbed by Final Review's synthetic idle spin");

  let contract = null;
  let attachCalls = 0;
  const attachForFinalReview = new Function("sourcePlaybackAssetForId", "attachSourceTransitionPlayback", `
    ${attach}
    return attachFinalReviewSourcePlayback;
  `)(
    () => contract,
    () => {
      attachCalls += 1;
      return true;
    },
  );
  const viewer = { componentId: "transition-pacing" };
  const entry = { assetId: "classroom.glb" };
  assert.equal(attachForFinalReview(viewer, entry, {}), false);
  assert.equal(attachCalls, 0, "an absent story-local contract preserves the legacy path");
  contract = { mode: "independent" };
  assert.equal(attachForFinalReview(viewer, entry, {}), false);
  assert.equal(attachCalls, 0, "legacy independent animation metadata is not opted in");
  contract = { mode: "shared-timeline" };
  assert.equal(attachForFinalReview(viewer, entry, {}), true);
  assert.equal(attachCalls, 1);
  assert.equal(attachForFinalReview({ componentId: "dynamic-geometry" }, entry, {}), false);
  assert.equal(attachCalls, 1, "the Final Review hook cannot alter another authoring component");
});

test("Final Review always renders the authored Reader camera", () => {
  const selectEntrySource = functionSource("finalReviewSourcePlaybackEntry");
  const renderCameraSource = functionSource("finalReviewRenderCamera");
  const syncRigSource = functionSource("syncFinalReviewReaderHandRigCamera");
  const initializer = functionSource("initializeFinalReviewViewer");
  const selectEntry = new Function(`${selectEntrySource}\nreturn finalReviewSourcePlaybackEntry;`)();
  const renderCamera = new Function(
    "finalReviewSourcePlaybackEntry",
    "syncFinalReviewSourcePresentation",
    `
    ${renderCameraSource}
    return finalReviewRenderCamera;
  `,
  )(selectEntry, () => {});
  const readerCamera = new THREE.PerspectiveCamera(42, 1.6, 0.02, 1000);
  const sourceCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 800);
  sourceCamera.position.set(4, 5, 6);
  sourceCamera.rotation.set(-0.2, 0.4, 0.1);
  sourceCamera.updateMatrixWorld(true);
  const viewer = {
    componentId: "transition-pacing",
    scene: new THREE.Scene(),
    camera: readerCamera,
    renderer: { xr: { isPresenting: false } },
    beat: { linkedAssetIds: ["classroom.glb"] },
    activeAssetId: "classroom.glb",
    activeSwapIndex: 0,
    swapGroups: [],
    dynamicObjects: [],
    finalReviewAssetEntry: null,
  };
  assert.equal(renderCamera(viewer), readerCamera,
    "an uncontracted story keeps the existing Final Review camera exactly");

  viewer.finalReviewAssetEntry = {
    assetId: "classroom.glb",
    sourcePlaybackContractActive: true,
    sourcePlayback: {
      asset: {
        mode: "shared-timeline",
        camera: {
          desktopPolicy: "render-source-camera",
          xrPolicy: "preserve-viewer-camera",
        },
      },
      sourceCamera,
    },
  };
  assert.equal(renderCamera(viewer), readerCamera,
    "a desktop source-camera policy cannot replace the Spatial Relations reader pose");
  viewer.renderer.xr.isPresenting = true;
  assert.equal(renderCamera(viewer), readerCamera,
    "XR preserves the authored, head-tracked reader camera");
  viewer.finalReviewAssetEntry.sourcePlayback.asset.camera.xrPolicy = "source-camera";
  assert.equal(renderCamera(viewer), readerCamera,
    "even a legacy XR source-camera policy cannot replace live reader tracking");
  assert.doesNotMatch(renderCameraSource, /syncFinalReviewSourceCameraRenderProxy/,
    "Final Review cannot render through a camera that OrbitControls does not own");

  let viewportUpdates = 0;
  const syncRig = new Function("finalReviewRenderCamera", "updateFinalReviewReaderHandRigViewport", `
    ${syncRigSource}
    return syncFinalReviewReaderHandRigCamera;
  `)(renderCamera, () => { viewportUpdates += 1; });
  const rigGroup = new THREE.Group();
  readerCamera.add(rigGroup);
  assert.equal(syncRig({ camera: readerCamera, readerHandRig: { group: rigGroup } }, readerCamera), true);
  assert.equal(rigGroup.parent, readerCamera,
    "desktop hand UI stays attached to the authored reader camera");
  assert.equal(viewportUpdates, 1);
  assert.match(
    initializer,
    /const renderCamera = finalReviewRenderCamera\(viewer\);\s*updateFinalReviewAttentionGuidance\(viewer, renderCamera, delta\);\s*updateFinalReviewXrTextPanelRays\(viewer\);\s*syncFinalReviewReaderHandRigCamera\(viewer, renderCamera\);\s*renderer\.render\(scene, renderCamera\)/s,
  );
});

test("Final Review keeps assetless base beats out of the global Single-anchor asset sequence", () => {
  const initializer = functionSource("initializeFinalReviewViewer");
  const updateBeat = functionSource("updateFinalReviewBeatStatus");
  const cumulativeContextForBeat = functionSource("finalReviewCumulativeContextForBeat");

  assert.match(initializer, /const cumulativeContext = finalReviewCumulativeContextForBeat\(beats, beatIndex, sceneContext, beat\)/);
  assert.match(updateBeat, /const cumulativeContext = finalReviewCumulativeContextForBeat\(beats, index, sceneContext, beat\)/);

  let cumulativeCalls = 0;
  const selectCumulativeContext = Function(
    "cumulativeSingleAnchorContext",
    `return (${cumulativeContextForBeat});`,
  )((beats, beatIndex) => {
    cumulativeCalls += 1;
    return { beats, beatIndex };
  });
  const baseContext = { beatId: "runtime-text-3", variantOptionId: null };
  assert.equal(
    selectCumulativeContext([], 1, baseContext, { id: "runtime-text-3", linkedAssetIds: [] }),
    null,
    "an assetless base beat bypasses the global Single-anchor asset sequence",
  );
  assert.equal(cumulativeCalls, 0, "the asset sequence is not consulted for a text-only scene");
  assert.deepEqual(
    selectCumulativeContext(["beat"], 1, baseContext, { id: "slide-1", linkedAssetIds: ["classroom.glb"] }),
    { beats: ["beat"], beatIndex: 1 },
    "a visual base beat still receives its cumulative Single-anchor context",
  );
  assert.equal(
    selectCumulativeContext([], 1, { ...baseContext, variantOptionId: "option-a" }, { linkedAssetIds: ["image.jpg"] }),
    null,
    "a variant continues to use its exact-scene asset path",
  );
});

test("the Final Review text panel mirrors the compiled minimize control and responds to mouse clicks", () => {
  const initializer = functionSource("initializeFinalReviewViewer");
  const textPanel = functionSource("addFinalReviewTextPanel");
  const textTexture = functionSource("makeFinalReviewTextTexture");
  const control = functionSource("makeFinalReviewTextPanelControl");
  const minimize = functionSource("setFinalReviewTextPanelMinimized");
  const updateBeat = functionSource("updateFinalReviewSceneBeat");
  const dispose = functionSource("disposeFinalReviewViewer");

  assert.match(source, /finalReviewTextPanelMinimized: false/,
    "Final Review retains the reader's panel state across beat changes");
  assert.match(textPanel, /const expandedRoot = new THREE\.Group\(\)/);
  assert.match(textPanel, /makeFinalReviewTextPanelControl\("\\u2212", "minimize", 0\.052\)/);
  assert.match(textPanel, /const minimizedRoot = new THREE\.Group\(\)/);
  assert.match(textPanel, /makeFinalReviewTextPanelControl\("Aa", "restore", 0\.105\)/);
  assert.match(textPanel, /setFinalReviewTextPanelMinimized\(viewer, state\.finalReviewTextPanelMinimized\)/);
  assert.match(textTexture, /rgba\(255,253,244,1\)/,
    "the reader-attached panel has an opaque reading surface");

  assert.match(control, /finalReviewTextPanelAction = action/,
    "the rendered control exposes a ray-castable action");
  assert.match(control, /depthTest:\s*false/);
  assert.match(control, /mesh\.renderOrder = READER_UI_RENDER_ORDER \+ 2/,
    "panel controls render above the panel texture");
  assert.match(minimize, /state\.finalReviewTextPanelMinimized = nextMinimized/);
  assert.match(minimize, /expandedRoot\.visible = !nextMinimized/);
  assert.match(minimize, /minimizedRoot\.visible = nextMinimized/);
  assert.match(updateBeat, /addFinalReviewTextPanel\(viewer, beat, region\)/,
    "beat changes rebuild the panel using the retained minimize state");

  assert.match(initializer, /const pointerCamera = finalReviewRenderCamera\(viewer\)[\s\S]*textPanelRaycaster\.setFromCamera\(textPanelPointer, pointerCamera\)/,
    "desktop pointer interaction follows the same contracted render camera as the panel");
  assert.match(initializer, /textPanelRaycaster\.intersectObject\(activeRoot, true\)/);
  assert.match(initializer, /control\.userData\?\.finalReviewTextPanelAction/);
  assert.match(initializer, /renderer\.domElement\.addEventListener\("click", viewer\.textPanelClickHandler\)/);
  assert.match(initializer, /setFinalReviewTextPanelMinimized\(viewer, action === "minimize"\)/);
  assert.match(initializer, /const textPanelControl = textPanelControlAtPointer\(event\)/);
  assert.match(initializer, /finalReviewTextPanelAction === "scroll" \? "ns-resize" : "pointer"/);
  assert.match(initializer, /addEventListener\("wheel", viewer\.textPanelWheelHandler, \{ passive: false \}\)/);
  assert.match(dispose, /removeEventListener\("click", finalReviewViewer\.textPanelClickHandler\)/);
  assert.match(dispose, /removeEventListener\("wheel", finalReviewViewer\.textPanelWheelHandler\)/);
  assert.match(dispose, /removeEventListener\("pointermove", finalReviewViewer\.textPanelPointerMoveHandler\)/);
});

test("Final Review drag and wheel scroll text while title-drag and Grip reposition the panel", () => {
  const spatialEditor = functionSource("renderFinalReviewSpatialEditor");
  const initializer = functionSource("initializeFinalReviewViewer");
  const textPanel = functionSource("addFinalReviewTextPanel");
  const configureXr = functionSource("configureFinalReviewXrTextPanel");
  const activeRoot = functionSource("finalReviewXrTextPanelActiveRoot");
  const xrHit = functionSource("finalReviewXrTextPanelHit");
  const scrollStartHit = functionSource("finalReviewXrTextPanelScrollStartHit");
  const attachToXrHand = functionSource("attachFinalReviewTextPanelToXrHand");
  const selectStart = functionSource("handleFinalReviewXrTextPanelSelectStart");
  const beginScroll = functionSource("beginFinalReviewXrTextPanelScroll");
  const updateScroll = functionSource("updateFinalReviewXrTextPanelScroll");
  const scrollLineFromDrag = functionSource("finalReviewTextPanelScrollLineFromVerticalDrag");
  const squeezeStart = functionSource("handleFinalReviewXrTextPanelSqueezeStart");
  const beginGrab = functionSource("beginFinalReviewXrTextPanelGrab");
  const endGrab = functionSource("handleFinalReviewXrTextPanelGrabEnd");
  const directHit = functionSource("finalReviewXrDirectManipulationHit");
  const beginDirectGrab = functionSource("beginFinalReviewXrDirectManipulation");
  const endDirectGrab = functionSource("endFinalReviewXrDirectManipulation");
  const squeezeEnd = functionSource("handleFinalReviewXrSqueezeEnd");
  const dispose = functionSource("disposeFinalReviewViewer");

  assert.match(source, /finalReviewTextPanelOffset: \{ x: 0, y: 0 \}/);
  assert.doesNotMatch(spatialEditor, /data-final-review-xr-slot|VR NOT SUPPORTED/);
  assert.match(spatialEditor, /Drag the panel text or use the mouse wheel to scroll/);
  assert.match(spatialEditor, /In VR, Trigger scrolls text and Grip moves the panel/);
  assert.match(textPanel, /panel\.userData\.finalReviewTextPanelAction = "scroll"/);
  assert.match(textPanel, /desktopGrabHandle\.userData\.finalReviewTextPanelAction = "grab"/);
  assert.match(initializer, /Math\.hypot\(deltaX, deltaY\) < 4/,
    "click actions are preserved until the pointer crosses the drag threshold");
  assert.match(initializer, /viewer\.textPanelPointerCandidate\.mode === "scroll"/);
  assert.match(initializer, /setFinalReviewTextPanelScrollLine\(/);
  assert.match(initializer, /viewer\.textPanelWheelHandler = \(event\) =>/);
  assert.match(initializer, /viewer\.textPanelWheelHandler = \(event\) =>[\s\S]*event\.preventDefault\(\)[\s\S]*setFinalReviewTextPanelScrollLine\(/,
    "overflow panels retain wheel ownership at their first and last lines");
  assert.match(initializer, /state\.finalReviewTextPanelOffset = \{/);
  assert.match(initializer, /updateFinalReviewTextPanelViewport\(viewer\)/);
  assert.match(initializer, /viewer\.suppressTextPanelClick = true/);
  assert.match(initializer, /window\.addEventListener\("pointercancel", viewer\.readerHandPointerUpHandler\)/);

  assert.match(initializer, /renderer\.xr\.enabled = true/);
  assert.match(initializer, /renderer\.setAnimationLoop\(animate\)/);
  assert.doesNotMatch(configureXr, /VRButton\.createButton\(viewer\.renderer\)/);
  assert.match(configureXr, /addEventListener\("squeezestart"/);
  assert.match(configureXr, /addEventListener\("squeezeend"/);
  assert.match(configureXr, /handleFinalReviewXrSqueezeEnd/);
  assert.match(configureXr, /handleFinalReviewXrTextPanelSelectEnd/);
  assert.match(activeRoot, /viewer\.textPanelMinimized \? group\.userData\.minimizedRoot : group\.userData\.expandedRoot/);
  assert.match(xrHit, /finalReviewXrTextPanelActiveRoot\(viewer\)/);
  assert.match(xrHit, /declaredAction === "grab" \? "scroll" : declaredAction/);
  assert.match(xrHit, /uv: hit\.uv\?\.clone/);
  assert.match(attachToXrHand, /syncFinalReviewReaderUiVisibility\(viewer\)/,
    "an XR controller reconnect preserves the selected view-mode visibility");
  assert.match(scrollStartHit, /entry === viewer\?\.xrAttachedEntry/,
    "the hand carrying the panel can start trigger-drag scrolling without ray-casting itself");
  assert.match(scrollStartHit, /viewer\.finalReviewTextGroup\?\.visible/,
    "the attached controller cannot scroll an Orbit-hidden panel");
  assert.match(scrollStartHit, /textPagination\?\.maxScrollLine/);
  assert.match(selectStart, /finalReviewXrTextPanelScrollStartHit\(viewer, entry\)/);
  assert.match(selectStart, /beginFinalReviewXrTextPanelScroll\(viewer, entry, hit\)/);
  assert.doesNotMatch(selectStart, /beginFinalReviewXrTextPanelGrab/);
  assert.match(beginScroll, /startControllerY/);
  assert.match(updateScroll, /finalReviewTextPanelScrollLineFromVerticalDrag/);
  assert.doesNotMatch(updateScroll, /finalReviewXrTextPanelHit/,
    "an active drag keeps scrolling after its ray leaves the finite panel mesh");
  assert.match(squeezeStart, /finalReviewXrTextPanelHit\(viewer, entry\)/);
  assert.match(squeezeStart, /beginFinalReviewXrDirectManipulation\(viewer, entry\)/,
    "Grip falls through from the text panel to authored direct-manipulation targets");
  assert.match(beginGrab, /entry\.controller\.attach\(viewer\.finalReviewTextGroup\)/);
  assert.match(endGrab, /attachFinalReviewTextPanelToXrHand\(viewer, entry\)/);
  assert.match(directHit, /viewer\?\.directManipulationTargets/);
  assert.match(directHit, /intersectObjects\(roots, true\)/);
  assert.match(beginDirectGrab, /entry\.controller\.attach\(hit\.root\)/);
  assert.match(endDirectGrab, /grab\.originalParent\?\.attach\?\.\(grab\.root\)/);
  assert.match(squeezeEnd, /endFinalReviewXrDirectManipulation\(viewer, entry\)/);
  assert.match(squeezeEnd, /handleFinalReviewXrTextPanelGrabEnd\(viewer, entry, "squeeze"\)/);
  assert.match(dispose, /setAnimationLoop\?\.\(null\)/);
  assert.match(dispose, /removeEventListener\?\.\("sessionstart"/);
  assert.match(dispose, /removeEventListener\?\.\("sessionend"/);

  const calculateLine = new Function("THREE", `${scrollLineFromDrag}\nreturn finalReviewTextPanelScrollLineFromVerticalDrag;`)({
    MathUtils: {
      clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
      },
    },
  });
  assert.equal(calculateLine(0, 1.5, 1.39, 12, 0.22), 6);
  assert.equal(calculateLine(6, 1.5, 1.28, 12, 0.22), 12);
  assert.equal(calculateLine(6, 1.5, 1.72, 12, 0.22), 0);
});

test("the Final Review text panel renders clickable UI-button variant navigation", () => {
  const variantState = functionSource("finalReviewTextPanelVariantState");
  const edgeControl = functionSource("finalReviewVariantInteractionForEdge");
  const uiAllowed = functionSource("finalReviewVariantUiButtonAllowed");
  const selection = functionSource("applyFinalReviewVariantSelection");
  const openScene = functionSource("openFinalReviewScene");
  const textPanel = functionSource("addFinalReviewTextPanel");
  const button = functionSource("makeFinalReviewTextPanelButton");
  const presentation = functionSource("finalReviewVariantButtonPresentation");
  const initializer = functionSource("initializeFinalReviewViewer");

  assert.match(variantState, /variantGroupForBeat\(beat\)/);
  assert.match(variantState, /sourceGraphDisplayedVariantOptions\(group\)/,
    "Final Review follows the same default-first variant order shown on its story canvas");
  assert.match(variantState, /sceneContext\?\.variantOptionId/);
  assert.match(variantState, /finalReviewVariantSteppedOption\(group, selectedOption, -1\)/);
  assert.match(variantState, /finalReviewVariantSteppedOption\(group, selectedOption, 1\)/);
  assert.match(variantState, /previousTargetContext:\s*previousOption\s*\? spatialSceneContext\(beatId, group\.id, previousOption\.id\)/s);
  assert.match(variantState, /nextTargetContext:\s*nextOption\s*\? spatialSceneContext\(beatId, group\.id, nextOption\.id\)/s);
  assert.match(variantState, /finalReviewVariantButtonPresentationsOverlap\(previousPresentation, nextPresentation\)/);
  assert.match(variantState, /previousPresentation = \{ \.\.\.previousPresentation, position: \[0\.2, 0\.86\] \}/);
  assert.match(variantState, /nextPresentation = \{ \.\.\.nextPresentation, position: \[0\.8, 0\.86\] \}/);

  assert.match(edgeControl, /interactionVariantSwitchEdges\(\)/);
  assert.match(edgeControl, /interactionVariantEdgeControlForEdge\(edge\)/);
  assert.match(uiAllowed, /variantInteractionPolicyKind\(record\?\.effectivePolicy\) === "ui-button-press"/);

  assert.match(textPanel, /finalReviewTextPanelVariantState\(beat, viewer\.sceneContext\)/);
  assert.match(textPanel, /makeFinalReviewTextPanelButton\(/);
  assert.match(textPanel, /variantState && !variantState\.previousDisabled/);
  assert.match(textPanel, /variantState && !variantState\.nextDisabled/);
  assert.match(textPanel, /if \(button\) variantControlRoot\.add\(button\)/);
  assert.match(textPanel, /variantControlRoot\.visible = variantControlRoot\.children\.length > 0/);
  assert.match(presentation, /record\?\.overridden === true \|\| record\?\.authored === true/);
  assert.match(presentation, /authoredLayout && Array\.isArray\(button\?\.position\) \? button\.position : fallbackPosition/);
  assert.match(button, /finalReviewTextPanelAction = action/);
  assert.match(button, /finalReviewVariantTargetContext = targetContext/);
  assert.match(button, /finalReviewTextPanelDisabled = Boolean\(disabled\)/);

  assert.match(initializer, /textPanelRaycaster\.intersectObject\(activeRoot, true\)/);
  assert.match(initializer, /control\.userData\?\.finalReviewTextPanelAction/);
  assert.match(initializer, /action === "variant-previous" \|\| action === "variant-next"/);
  assert.match(initializer, /applyFinalReviewVariantSelection\(control\.userData\.finalReviewVariantTargetContext\)/);

  assert.match(selection, /return openFinalReviewScene\(targetContext\)/);
  assert.match(openScene, /createStoryvrNavigationRoute\("transition-pacing", validContext\)/);
});

test("Final Review reserves a footer row above the default variant control band", () => {
  const layoutSource = functionSource("finalReviewTextPanelVariantLayout");
  const layout = new Function(`${layoutSource}\nreturn finalReviewTextPanelVariantLayout;`)();
  const result = layout(512);
  const defaultButtonTop = (0.86 - (0.12 / 2)) * 512;
  const texture = functionSource("makeFinalReviewTextTexture");

  assert.deepEqual(result, {
    bodyMaxLines: 4,
    statusBaseline: 379,
    controlBandTop: 399,
  });
  assert.ok(result.statusBaseline < result.controlBandTop,
    "the variant status stays above the dedicated control band");
  assert.ok(result.controlBandTop < defaultButtonTop,
    "the control band includes padding before the default button geometry begins");
  assert.ok(defaultButtonTop - result.statusBaseline > 30,
    "the status baseline clears the default button by more than its font height");
  assert.match(texture, /finalReviewTextPanelVariantLayout\(canvas\.height\)/);
  assert.match(texture, /variantLayout\.statusBaseline/);
  assert.match(texture, /variantLayout\.controlBandTop/);
  assert.match(texture, /variantLayout\?\.bodyMaxLines \|\| 6/);
  assert.match(texture, /Drag \/ wheel \/ Trigger-drag to scroll/);
  assert.match(texture, /storyvrTextPanelPagination/);
  assert.doesNotMatch(texture, /\b420\b/);

  const wrap = new Function(`
    ${functionSource("canvasWrappedTextLines")}
    ${functionSource("wrapCanvasText")}
    return wrapCanvasText;
  `)();
  const rendered = [];
  const pagination = wrap({
    measureText(value) { return { width: String(value).length }; },
    fillText(value) { rendered.push(value); },
  }, "one two three four five", 0, 0, 7, 1, 2, 1);
  assert.deepEqual(rendered, ["three", "four"]);
  assert.deepEqual(pagination, {
    lineCount: 4,
    maxLines: 2,
    maxScrollLine: 2,
    scrollLine: 1,
  });
});

test("Final Review keeps generated variant controls in semantic corner slots while preserving authored placement", () => {
  const present = new Function("THREE", `
    ${functionSource("finalReviewVariantButtonPresentation")}
    return finalReviewVariantButtonPresentation;
  `)({
    MathUtils: {
      clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
      },
    },
  });
  const generatedRecord = {
    authored: false,
    overridden: false,
    configuration: {
      buttons: [{
        id: "generated",
        label: "Generated target",
        action: "select-variant",
        position: [0.5, 0.86],
        size: [0.32, 0.12],
      }],
    },
  };

  assert.deepEqual(present(generatedRecord, "Previous", [0.2, 0.86]), {
    id: "generated",
    label: "Generated target",
    position: [0.2, 0.86],
    size: [0.32, 0.12],
  });
  assert.deepEqual(present(generatedRecord, "Next", [0.8, 0.86]), {
    id: "generated",
    label: "Generated target",
    position: [0.8, 0.86],
    size: [0.32, 0.12],
  });
  assert.deepEqual(present({
    authored: true,
    configuration: {
      buttons: [{
        id: "authored",
        label: "Custom target",
        action: "select-variant",
        position: [0.64, 0.72],
        size: [0.24, 0.14],
      }],
    },
  }, "Next", [0.8, 0.86]), {
    id: "authored",
    label: "Custom target",
    position: [0.64, 0.72],
    size: [0.24, 0.14],
  });
});

test("the Final Review reader hand is draggable without stealing ordinary scene orbiting", () => {
  const spatialEditor = functionSource("renderFinalReviewSpatialEditor");
  const initializer = functionSource("initializeFinalReviewViewer");
  const readerHand = functionSource("addFinalReviewReaderHandRig");
  const responsiveHand = functionSource("updateFinalReviewReaderHandRigViewport");
  const dispose = functionSource("disposeFinalReviewViewer");

  assert.match(source, /finalReviewReaderHandOffset: \{ x: 0, y: 0 \}/,
    "the preview retains the dragged hand placement across beat renders");
  assert.match(spatialEditor, /Drag the reader hand to reposition it/);
  assert.match(readerHand, /sleeve\.userData\.finalReviewReaderHandDrag = true/);
  assert.match(readerHand, /hand\.userData\.finalReviewReaderHandDrag = true/);
  assert.match(readerHand, /dragTargets: \[sleeve, hand\]/);
  assert.match(responsiveHand, /state\.finalReviewReaderHandOffset\?\.x/);
  assert.match(responsiveHand, /state\.finalReviewReaderHandOffset\?\.y/);

  assert.match(initializer, /readerHandRaycaster\.intersectObjects\(targets, true\)/,
    "pointer hit testing is limited to the visible hand and sleeve");
  assert.match(initializer, /const textPanelControl = textPanelControlAtPointer\(event\)/);
  assert.ok(initializer.indexOf("if (textPanelControl && !textPanelControl.userData.finalReviewTextPanelDisabled)")
    < initializer.indexOf("if (!readerHandAtPointer(event)) return"),
  "the panel and its controls keep priority over hand dragging");
  assert.match(initializer, /viewer\.draggingReaderHand = true/);
  assert.match(initializer, /controls\.enabled = false/);
  assert.match(initializer, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(initializer, /const worldPerPixel = visibleHeight \/ rect\.height/);
  assert.match(initializer, /state\.finalReviewReaderHandOffset = \{/);
  assert.match(initializer, /updateFinalReviewReaderHandRigViewport\(viewer\.readerHandRig, renderCamera\.aspect, renderCamera\.fov\)/);
  assert.match(initializer, /viewer\.draggingReaderHand = false/);
  assert.match(initializer, /controls\.enabled = !renderer\.xr\.isPresenting/);
  assert.match(initializer, /renderer\.domElement\.style\.cursor = "grabbing"/);
  assert.match(initializer, /readerHandAtPointer\(event\) \? "grab" : ""/);

  assert.match(dispose, /removeEventListener\("pointerdown", finalReviewViewer\.readerHandPointerDownHandler\)/);
  assert.match(dispose, /removeEventListener\("pointermove", finalReviewViewer\.readerHandPointerMoveHandler\)/);
  assert.match(dispose, /removeEventListener\("pointerup", finalReviewViewer\.readerHandPointerUpHandler\)/);
});

test("Final Review switches view dragging while keeping the reader UI visible", () => {
  const spatialEditor = functionSource("renderFinalReviewSpatialEditor");
  const setMode = functionSource("setFinalReviewViewRotationMode");
  const syncReaderUi = functionSource("syncFinalReviewReaderUiVisibility");
  const resetReaderLook = functionSource("resetFinalReviewReaderLookAnchor");
  const stabilizeReaderLook = functionSource("stabilizeFinalReviewReaderLook");
  const keyboardMovement = functionSource("updateTopologyKeyboardMovement");
  const initializer = functionSource("initializeFinalReviewViewer");
  const textPanel = functionSource("addFinalReviewTextPanel");
  const configureXr = functionSource("configureFinalReviewXrTextPanel");

  assert.match(source, /finalReviewViewRotationMode: "reader"/);
  assert.match(source, /finalReviewSceneOrbitCameraState: null/);
  assert.match(source, /finalReviewReaderLookCameraState: null/);
  assert.match(spatialEditor, /data-final-review-view-rotation="scene"[^>]*>Orbit scene<\/button>/);
  assert.match(spatialEditor, /data-final-review-view-rotation="reader"[^>]*>Reader look<\/button>/);
  assert.match(spatialEditor, /data-final-review-view-rotation-hint/);

  assert.match(setMode, /state\.finalReviewSceneOrbitCameraState = previewCameraState\(viewer\)/,
    "switching away from scene orbit preserves that camera");
  assert.match(setMode, /state\.finalReviewReaderLookCameraState = previewCameraState\(viewer\)/,
    "switching away from reader look preserves that camera");
  assert.match(setMode, /viewer\.controls\.enablePan = nextMode === "scene"/,
    "reader look cannot accidentally pan the reader");
  assert.match(setMode, /syncFinalReviewReaderUiVisibility\(viewer\)/);
  assert.match(textPanel, /syncFinalReviewReaderUiVisibility\(viewer\)/,
    "a rebuilt beat panel immediately follows the selected view mode");
  assert.doesNotMatch(syncReaderUi, /viewRotationMode/,
    "the drag-view mode cannot hide reader-facing UI from Final Review");
  assert.match(syncReaderUi, /readerHandRig\.group\.visible = viewer\.renderer\?\.xr\?\.isPresenting !== true/);
  assert.match(syncReaderUi, /finalReviewTextGroup\.visible = true/);
  assert.match(initializer, /if \(!panelGroup\?\.visible\) return null/,
    "pointer handling still respects runtime visibility such as disposal or XR attachment");
  assert.match(initializer, /if \(!viewer\.readerHandRig\?\.group\?\.visible\) return null/,
    "the desktop hand cannot intercept input while XR owns the reader controls");
  assert.match(configureXr, /attachFinalReviewTextPanelToPreferredXrHand\(viewer\);\s*syncFinalReviewReaderUiVisibility\(viewer\)/s);
  assert.doesNotMatch(configureXr, /readerHandRig\.group\.visible = true/,
    "XR visibility remains centralized in the shared reader UI policy");
  assert.match(resetReaderLook, /viewer\.readerLookPosition\.copy\(viewer\.camera\.position\)/);
  assert.match(stabilizeReaderLook, /viewer\.camera\.position\.copy\(viewer\.readerLookPosition\)/,
    "reader look rotates without orbiting the camera through the scene");
  assert.match(stabilizeReaderLook, /viewer\.controls\.target\.copy\(viewer\.readerLookPosition\)\.addScaledVector/);
  assert.match(keyboardMovement, /viewer\.readerLookPosition\.add\(move\)/,
    "WASD moves the reader-look anchor instead of snapping back");
  assert.match(initializer, /controls\.update\(\);\s*stabilizeFinalReviewReaderLook\(viewer\)/s);
  assert.match(styles, /\.final-review-controls\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.doesNotMatch(styles, /\.final-review-view-rotation\s*\{[^}]*flex-basis:\s*100%/s);
  assert.match(styles, /\.final-review-view-rotation > button\[aria-pressed="true"\]/);

  const syncVisibility = new Function("normalizeFinalReviewViewRotationMode", `
    ${syncReaderUi}
    return syncFinalReviewReaderUiVisibility;
  `)((value) => value === "reader" ? "reader" : "scene");
  const visibilityViewer = {
    disposed: false,
    viewRotationMode: "scene",
    renderer: { xr: { isPresenting: false } },
    readerHandRig: { group: { visible: true } },
    finalReviewTextGroup: { visible: true },
  };
  assert.equal(syncVisibility(visibilityViewer), true);
  assert.equal(visibilityViewer.readerHandRig.group.visible, true);
  assert.equal(visibilityViewer.finalReviewTextGroup.visible, true);
  visibilityViewer.viewRotationMode = "reader";
  assert.equal(syncVisibility(visibilityViewer), true);
  assert.equal(visibilityViewer.readerHandRig.group.visible, true);
  assert.equal(visibilityViewer.finalReviewTextGroup.visible, true);
  visibilityViewer.renderer.xr.isPresenting = true;
  assert.equal(syncVisibility(visibilityViewer), true);
  assert.equal(visibilityViewer.readerHandRig.group.visible, false,
    "XR hides the desktop synthetic hand while retaining reader-mode panel visibility");
  assert.equal(visibilityViewer.finalReviewTextGroup.visible, true);
});

test("reader look preserves the reader position while applying the dragged direction", () => {
  const stabilizeSource = functionSource("stabilizeFinalReviewReaderLook");
  const stabilize = new Function("THREE", "resetFinalReviewReaderLookAnchor", `
    ${stabilizeSource}
    return stabilizeFinalReviewReaderLook;
  `)(THREE, () => false);
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.02, 1000);
  camera.position.set(5.5, 2.1, 2.7);
  const draggedTarget = new THREE.Vector3(-1.2, 1.4, -3.6);
  camera.lookAt(draggedTarget);
  camera.updateMatrixWorld(true);
  const draggedDirection = camera.getWorldDirection(new THREE.Vector3());
  const readerPosition = new THREE.Vector3(3.8, 2.45, 4.8);
  const focusDistance = 6.25;
  const controls = { target: draggedTarget.clone() };
  const viewer = {
    disposed: false,
    viewRotationMode: "reader",
    camera,
    controls,
    readerLookPosition: readerPosition.clone(),
    readerLookDirection: new THREE.Vector3(),
    readerLookDistance: focusDistance,
  };

  assert.equal(stabilize(viewer), true);
  assert.ok(camera.position.distanceTo(readerPosition) < 1e-9,
    "a reader-look drag cannot orbit the camera away from the reader");
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(draggedDirection) < 1e-9,
    "the direction produced by the drag remains applied");
  assert.ok(controls.target.distanceTo(
    readerPosition.clone().addScaledVector(draggedDirection, focusDistance),
  ) < 1e-9, "OrbitControls receives a forward target from the fixed reader position");
});

test("Final Review previews Direct Manipulation with the compiled reader ghost journey", () => {
  const initializer = functionSource("initializeFinalReviewViewer");
  const configurations = functionSource("finalReviewDirectManipulationConfigurations");
  const activeProgression = functionSource("finalReviewActiveProgressionBoundary");
  const candidates = functionSource("finalReviewDirectTargetCandidates");
  const material = functionSource("createFinalReviewDirectGhostMaterial");
  const model = functionSource("createFinalReviewDirectGhostModel");
  const refresh = functionSource("refreshFinalReviewDirectManipulationCues");
  const update = functionSource("updateFinalReviewDirectManipulationCues");
  const animate = functionSource("animateFinalReviewViewer");
  const dispose = functionSource("disposeFinalReviewViewer");

  assert.match(source, /import \{ clone as cloneSkinnedObject \} from "three\/examples\/jsm\/utils\/SkeletonUtils\.js"/);
  assert.match(source, /const FINAL_REVIEW_DIRECT_GHOST_VELOCITY_METERS_PER_SECOND = 0\.75/);
  assert.match(source, /const FINAL_REVIEW_DIRECT_GHOST_DESTINATION_HOLD_SECONDS = 3/);
  assert.match(source, /const FINAL_REVIEW_DIRECT_GHOST_INACTIVITY_REPLAY_SECONDS = 5/);

  assert.match(initializer, /directManipulationCueRoot/);
  assert.match(initializer, /directManipulationCues: \[\]/);
  assert.match(initializer, /directManipulationTargets: \[\]/);
  assert.match(initializer, /viewer\.directManipulationCueElapsed \+= delta/,
    "the cue clock keeps moving even when story motion is paused");
  assert.match(initializer, /refreshFinalReviewDirectManipulationCues\(viewer\)/,
    "loaded GLBs trigger the destination journey");

  assert.match(configurations, /finalReviewActiveProgressionBoundary\(viewer\)/);
  assert.match(configurations, /outgoingBoundary/,
    "Final Review reads the same active progression boundary as the reader");
  assert.match(activeProgression, /sourceGraphTransitionContextMatches\(boundary\.fromContext, sceneContext/);
  assert.match(configurations, /recognizedInteractionPolicyKind\(outgoingBoundary\?\.effectivePolicy\) === "direct"/);
  assert.match(configurations, /interactionKindForConfiguration\(outgoingBoundary\?\.configuration\) === "direct"/);
  assert.match(configurations, /configurations\.push\(outgoingBoundary\.configuration\)/,
    "the active route's authored Direct Manipulation configuration drives its ghost journey");
  assert.match(configurations, /interactionVariantEdgeControlForEdge/,
    "a selected variant also resolves its authored direct-manipulation edge");
  assert.match(candidates, /dynamicObjects/);
  assert.match(candidates, /swapGroups/);
  assert.match(candidates, /finalReviewAssetEntry/);

  assert.match(material, /sourceMaterial\?\.clone/,
    "the ghost keeps each GLB material's source color");
  assert.match(material, /FINAL_REVIEW_DIRECT_GHOST_OPACITY/);
  assert.match(material, /THREE\.AdditiveBlending/);
  assert.match(material, /material\.emissive\.copy\(glowColor\)/);
  assert.match(model, /cloneSkinnedObject\(root\)/,
    "the preview uses the actual loaded GLB hierarchy, including skinned models");

  assert.match(refresh, /finalReviewDirectRootForTarget\(target, candidates\)/);
  assert.match(refresh, /viewer\.directManipulationTargets\.push\(\{ root: candidate\.root, target \}\)/);
  assert.match(refresh, /createFinalReviewDirectManipulationCue\(viewer, candidate\.root, target\)/);
  assert.match(update, /smootherstep/);
  assert.match(update, /cue\.phase = "hold"/);
  assert.match(update, /FINAL_REVIEW_DIRECT_GHOST_DESTINATION_HOLD_SECONDS/);
  assert.match(update, /cue\.ghost\.visible = false/);
  assert.match(update, /FINAL_REVIEW_DIRECT_GHOST_INACTIVITY_REPLAY_SECONDS/);
  assert.match(update, /startFinalReviewDirectManipulationCue\(viewer, cue, now\)/);
  assert.match(animate, /updateFinalReviewDirectManipulationCues\(viewer\)/);
  assert.match(dispose, /clearFinalReviewDirectManipulationCues\(finalReviewViewer\)/);
});

test("Final Review resolves reader-start locomotion through the exact route source reader transform", () => {
  const initializer = functionSource("initializeFinalReviewViewer");
  const embodied = functionSource("addFinalReviewEmbodiedProgression");

  assert.match(initializer, /const activeProgressionBoundary = finalReviewActiveProgressionBoundary\(\{ beat, sceneContext \}\)/);
  assert.match(initializer, /activeProgressionBoundary,/,
    "the viewer retains the exact selected progression route");
  assert.match(initializer, /addFinalReviewEmbodiedProgression\(viewer, region, activeProgressionBoundary\?\.configuration\)/,
    "Reader locomotion uses that route's saved configuration");

  assert.match(embodied, /interactionKindForConfiguration\(configuration\) === "embodied-control"/);
  assert.match(embodied, /configuration\.destination\?\.coordinateSpace === "reader-start"/);
  assert.match(embodied, /interactionReaderTransformForContext\(viewer\?\.activeProgressionBoundary\?\.fromContext\)/,
    "reader-start coordinates resolve against the exact route's source scene reader pose");
  assert.match(embodied, /new THREE\.Vector3\(\)\.fromArray\(configuredTransform\.position\)[\s\S]*\.applyQuaternion\(sourceQuaternion\)[\s\S]*\.add\(sourcePosition\)/);
  assert.match(embodied, /sourceQuaternion\.clone\(\)[\s\S]*\.multiply\(new THREE\.Quaternion\(\)\.fromArray\(configuredTransform\.quaternion\)\)/,
    "both destination position and orientation are transformed out of reader-start space");
  assert.ok(
    embodied.indexOf("interactionReaderTransformForContext") < embodied.indexOf("const configuredPosition"),
    "the route reader transform is applied before the destination is consumed as a world-space position",
  );
});
