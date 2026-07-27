import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

function sourceFunction(name, text = source) {
  const plain = text.indexOf(`function ${name}(`);
  const asyncStart = text.indexOf(`async function ${name}(`);
  const start = plain === -1 ? asyncStart : asyncStart === -1 ? plain : Math.min(plain, asyncStart);
  assert.notEqual(start, -1, `${name} exists`);
  const nextPlain = text.indexOf("\nfunction ", start + 1);
  const nextAsync = text.indexOf("\nasync function ", start + 1);
  const candidates = [nextPlain, nextAsync].filter((value) => value !== -1);
  const end = candidates.length ? Math.min(...candidates) : text.length;
  return text.slice(start, end);
}

test("Transition gets the single-workspace shell and a canvas-only landing page", () => {
  const render = sourceFunction("render");
  const workspace = sourceFunction("renderInterBeatDynamicsWorkspace");
  const canvas = sourceFunction("renderInterBeatDynamicsCanvasWorkspace");
  const editor = sourceFunction("renderInterBeatDynamicsEditorWorkspace");

  assert.match(render, /const isInterBeatDynamics = active\.id === "inter-beat-dynamics"/);
  assert.match(render, /const showSidebar = [^\n]*!isInterBeatDynamics/);
  assert.match(render, /showSidebar \? "authoring-layout" : "single-workspace-layout"/);
  assert.match(workspace, /const sceneContext = activeInterBeatSceneContext\(\)/);
  assert.match(workspace, /if \(!sceneContext\) return renderInterBeatDynamicsCanvasWorkspace\(/);
  assert.match(workspace, /renderInterBeatDynamicsEditorWorkspace\([^)]*sceneContext/);

  assert.match(canvas, /data-inter-beat-workspace-mode="canvas"/);
  assert.match(canvas, /renderInterBeatStoryCanvas\(/);
  assert.match(canvas, /renderCheckpointActions\(component, state\.data\.decisions\[component\.id\], \{ canCommit: Boolean\(proposal\) \}\)/);
  assert.match(canvas, /checkpointBlockingDependency\(component\.id\)/);
  assert.match(canvas, /before reviewing or saving Transition/);
  assert.doesNotMatch(canvas, /renderInterBeatPreview|renderInterBeatInspector|renderSourceMotionLinkingEditor/);
  assert.doesNotMatch(canvas, /renderInterBeatBeatRail|data-inter-beat-viewer|advanced-motion-mapping/);

  assert.match(editor, /data-inter-beat-workspace-mode="editor"/);
  assert.match(editor, /data-inter-beat-close-save/);
  assert.match(editor, /Close &amp; save/);
  assert.match(editor, /renderInterBeatPreview\([^)]*sceneContext/);
  assert.match(editor, /renderInterBeatInspector\(/);
  assert.match(editor, /renderSourceMotionLinkingEditor\(component\.id\)/);
  assert.doesNotMatch(editor, /renderInterBeatBeatRail|data-inter-beat-beat-index/,
    "the canvas, rather than a second beat rail, owns Transition scene selection");
  assert.match(styles, /\.inter-beat-canvas-mode\s*\{[^}]*width:\s*100%/s);
});

test("the Transition canvas keeps every original variant card and restores Source Graph boundary arrows", () => {
  const contexts = sourceFunction("interBeatStorySceneContexts");
  const sharedContexts = sourceFunction("dynamicStorySceneContexts");
  const workspace = sourceFunction("renderInterBeatDynamicsCanvasWorkspace");
  const canvas = sourceFunction("renderInterBeatStoryCanvas");
  const beat = sourceFunction("renderInterBeatStoryBeat");
  const connector = sourceFunction("renderInterBeatBoundaryConnector");
  const unmappedButton = sourceFunction("renderInterBeatUnmappedTransitionButton");
  const thumbnail = sourceFunction("renderInterBeatBoundaryThumbnail");
  const variantPreview = sourceFunction("renderInterBeatVariantTransitionPreview");
  const variantLayer = sourceFunction("renderStoryVariantLinkLayer");
  const variantLayout = sourceFunction("layoutStoryVariantLinks");
  const card = sourceFunction("renderInterBeatStoryCard");
  const authoredTransitions = sourceFunction("authoredMotionTransitions");
  const bindCanvas = sourceFunction("bindInterBeatDynamicsCanvasEvents");
  const boundary = sourceFunction("interBeatBoundaryForSceneContext");

  assert.match(contexts, /return dynamicStorySceneContexts\(\)/);
  assert.match(sharedContexts, /for \(const beat of state\.data\?\.graph\?\.beats \|\| \[\]\)/);
  assert.match(sharedContexts, /contexts\.push\(spatialSceneContext\(beat\.id, group\?\.id, defaultOption\?\.id\)\)/);
  assert.match(sharedContexts, /for \(const option of group\.options \|\| \[\]\)/);
  assert.match(sharedContexts, /contexts\.push\(spatialSceneContext\(beat\.id, group\.id, option\.id\)\)/);

  assert.match(canvas, /const beats = state\.data\?\.graph\?\.beats \|\| \[\]/);
  assert.match(workspace, /Every saved variant stays visible as its original read-only card/);
  assert.match(workspace, /Beat and variant arrows use the same mapped GLB thumbnails/);
  assert.match(workspace, /select one to open the full spatial preview/);
  assert.doesNotMatch(workspace, /one option at a time/);
  assert.doesNotMatch(workspace, /dynamic-canvas-summary|No scrubbed beat boundaries|held or initialized/,
    "Transition removes the aggregate state summary in favor of the binary arrow and thumbnail treatment");
  assert.match(canvas, /const boundaryTransitions = authoredMotionTransitions\(\{ preserveParallel: true \}\)/);
  assert.match(canvas, /data-story-variant-canvas-viewport/);
  assert.match(canvas, /renderStoryVariantLinkLayer\("transition", proposal\)/);
  assert.match(canvas, /beats\.map\(\(beat, index\) => renderInterBeatStoryBeat\(beat, index, proposal, boundaryTransitions\)/);

  assert.match(beat, /sourceGraphDefaultVariantOption\(group\)/);
  assert.match(beat, /\(group\.options \|\| \[\]\)\.filter\(\(option\) => option\.id !== defaultOption\.id\)/);
  assert.match(beat, /renderInterBeatStoryCard\(beat, defaultOption, primaryContext/);
  assert.match(beat, /alternatives\.map\(\(option\) =>/,
    "Transition renders the original default and alternative variant cards");
  assert.match(beat, /outgoingTransitions = \(boundaryTransitions \|\| \[\]\)\.filter/);
  assert.match(beat, /transition\.from\.id === beat\.id/);
  assert.match(beat, /!transition\.fromContext\?\.variantOptionId/,
    "variant-source progressions are drawn on their exact cards by the shared route layer");
  assert.match(beat, /renderInterBeatBoundaryConnector\(proposal, transition\)/);
  assert.match(beat, /transition-boundary-stack/);
  assert.doesNotMatch(source, /transition-story-variant-switcher|data-inter-beat-variant-switch/,
    "the manual Previous and Next switch panel is removed");
  assert.doesNotMatch(bindCanvas, /stepInterBeatVariantOption|data-inter-beat-variant-switch/);
  assert.doesNotMatch(beat, /const nextBeat = beats\[index \+ 1\] \|\| null/,
    "array adjacency is not the authored Transition boundary model");

  assert.match(authoredTransitions, /sourceGraphTransitionEdges\(state\.data\?\.graph/);
  assert.match(authoredTransitions, /edge\.from\.beatId/);
  assert.match(authoredTransitions, /edge\.to\.beatId/);
  assert.match(authoredTransitions, /edgeId:\s*edge\.id|id:\s*edge\.id/);
  assert.match(authoredTransitions, /sourceGraphTransitionSceneContext\(edge\.from\)/);
  assert.match(authoredTransitions, /sourceGraphTransitionSceneContext\(edge\.to\)/);
  assert.match(authoredTransitions, /manualVariantSwitch/);
  assert.match(authoredTransitions, /key:\s*edge\.id/);
  assert.match(authoredTransitions, /beatPairKey:\s*`\$\{from\.id\}->\$\{to\.id\}`/);
  assert.match(authoredTransitions, /if \(preserveParallel\) return transitions/,
    "parallel variant routes retain separate Transition identities");
  assert.doesNotMatch(authoredTransitions, /beats\.slice\(0,\s*-1\)|beats\[index \+ 1\]/);

  assert.match(connector, /interBeatBoundaryPlaybackSummary\(proposal, context\)/);
  assert.match(connector, /transitionModelThumbnailAnimationSpec\(playback\)/);
  assert.match(connector, /thumbnailSpec \? renderInterBeatBoundaryThumbnail/);
  assert.match(connector, /!thumbnailSpec \? renderInterBeatUnmappedTransitionButton\(context, fromTitle, toTitle\) : ""/,
    "every unmatched authored boundary remains an openable route");
  assert.match(unmappedButton, /data-inter-beat-open-transition/);
  assert.match(unmappedButton, /data-inter-beat-edge-id="\$\{escapeHtml\(context\.transitionEdgeId\)\}"/);
  assert.match(unmappedButton, /<span class="transition-boundary-status">No mapped transition<\/span>/,
    "the shared helper owns the single visible unmapped label");
  assert.doesNotMatch(connector, /transition-boundary-route|padStart/,
    "boundary arrows do not repeat the beat numbers already shown on their cards");
  assert.doesNotMatch(card, /interBeatBoundaryStatus|interBeatBoundaryForSceneContext|status\.label/,
    "scene cards remain neutral because boundary meaning lives on the arrow");
  assert.match(card, /<article/);
  assert.doesNotMatch(card, /data-inter-beat-open-scene|Open scene/,
    "beat and variant cards no longer open the Transition spatial editor");
  assert.match(card, /renderStoryVariantCardAttributes\(context\)/);
  assert.match(thumbnail, /data-inter-beat-edge-id="\$\{escapeHtml\(context\.transitionEdgeId\)\}"/);
  assert.match(thumbnail, /data-inter-beat-open-transition/);
  assert.match(variantLayer, /interactiveTransitions \? renderInterBeatVariantTransitionPreview\(proposal, edge\)/);
  assert.match(variantLayer, /has-transition-previews/);
  assert.match(variantLayer, /storyVariantProgressionFanGroups\(edges\)/);
  assert.match(variantLayer, /data-story-variant-progression-bus="\$\{escapeHtml\(key\)\}"/,
    "parallel Transition routes render one candidate fan bus for their shared destination");
  assert.match(variantLayer, /story-variant-progression-bus-trunk/);
  assert.match(variantLayer, /story-variant-progression-bus-arrow" marker-end=/,
    "only the final segment of a Transition fan owns the shared arrowhead");
  assert.match(variantLayer, /progressionFanKey \? "data-story-variant-progression-branch" : `marker-end=/,
    "the exact per-route branches are markerless while manual switches retain their arrowheads");
  assert.match(variantPreview, /sourceGraphTransitionSceneContext\(edge\?\.from\)/);
  assert.match(variantPreview, /sourceGraphTransitionSceneContext\(edge\?\.to\)/);
  assert.match(variantPreview, /transitionEdgeId:\s*edge\?\.id/);
  assert.match(variantPreview, /interBeatBoundaryPlaybackSummary\(proposal, toContext\)/);
  assert.match(variantPreview, /transitionModelThumbnailAnimationSpec\(playback\)/);
  assert.match(variantPreview, /const width = 144/);
  assert.match(variantPreview, /const height = thumbnailSpec \? 84 : 40/);
  assert.match(variantPreview, /data-story-variant-preview-width="\$\{width\}"/);
  assert.match(variantPreview, /data-story-variant-preview-height="\$\{height\}"/);
  assert.match(variantPreview, /renderInterBeatBoundaryThumbnail\(playback, toContext/);
  assert.match(variantPreview, /renderInterBeatUnmappedTransitionButton\(toContext, fromTitle, toTitle\)/,
    "an unmapped variant route is still an exact openable Transition route");
  assert.match(variantLayout, /data-story-variant-transition-preview/);
  assert.match(variantLayout, /dataset\.storyVariantPreviewWidth/);
  assert.match(variantLayout, /dataset\.storyVariantPreviewHeight/);
  assert.match(variantLayout, /storyVariantProgressionFanGeometry\(fanRoutes, \{/);
  assert.match(variantLayout, /const fanBranch = fanBranches\.get\(edge\.id\) \|\| null/);
  assert.match(variantLayout, /preview\.setAttribute\("x", String\(fanBranch\.label\.x\)\)/);
  assert.match(variantLayout, /preview\.setAttribute\("y", String\(fanBranch\.label\.y\)\)/,
    "each Transition preview uses its own data-sized position above its horizontal branch");
  assert.match(variantLayout, /if \(fanBranch\) routePath\?\.removeAttribute\("marker-end"\)/);
  assert.match(variantLayout, /else routePath\?\.setAttribute\([\s\S]*"marker-end",[\s\S]*problemMarkerReference : markerReference/,
    "a manual switch or ineligible fan candidate keeps an individual arrowhead");
  assert.match(variantLayout, /getPointAtLength\(pathLength \/ 2\)/);
  assert.match(variantLayout, /reciprocalOffset/);
  assert.match(bindCanvas, /button\.dataset\.interBeatEdgeId/);
  assert.match(bindCanvas, /context\.transitionEdgeId = button\.dataset\.interBeatEdgeId/);

  assert.match(boundary, /const beats = interBeatStoryBeats\(proposal\)/);
  assert.match(boundary, /findIndex\(\(beat\) => beat\.id === toSceneContext\.beatId\)/);
  assert.match(boundary, /authoredMotionTransitions\(\)/);
  assert.match(boundary, /candidate\.edgeId === toSceneContext\.transitionEdgeId/);
  assert.match(boundary, /sourceGraphTransitionContextMatches\(candidate\.toContext, toSceneContext\)/);
  assert.doesNotMatch(boundary, /\[beatIndex - 1\]|beats\[beatIndex - 1\]/);
  assert.match(boundary, /fromBeatId:\s*fromBeat\?\.id \|\| null/);
  assert.match(boundary, /toBeatId:\s*beat\?\.id \|\| null/);
  assert.match(boundary, /const toSceneContext = spatialSceneContext\(context\?\.beatId, context\?\.variantGroupId, context\?\.variantOptionId\)/);
});

test("a Transition editor resolves the exact previous-default and selected destination scenes", () => {
  const sceneBeat = sourceFunction("interBeatPreviewBeatForSceneContext");
  const sharedSceneBeat = sourceFunction("dynamicPreviewBeatForSceneContext");
  const boundary = sourceFunction("interBeatBoundaryForSceneContext");
  const initialize = sourceFunction("initializeInterBeatDynamicsViewer");
  const lockedEnvironment = sourceFunction("lockedEnvironmentPreviewContract");

  assert.match(sceneBeat, /dynamicPreviewBeatForSceneContext\(proposal, context\)/);
  assert.match(sceneBeat, /sceneAssetIds\.has\(item\.assetId\)/,
    "a variant only inherits source state for assets in that exact scene");
  assert.match(sceneBeat, /isTextOnly && item\.playbackMode === "frozen"/,
    "an authored text-only scene can still hold the previous visual state");
  assert.match(sharedSceneBeat, /spatialSceneBeat\(context\)/);
  assert.match(sharedSceneBeat, /sourceGraphVariantOption\(context\)/);
  assert.match(sharedSceneBeat, /spatialSceneRecordForContext\(spatialContract, context\)/);
  assert.match(sharedSceneBeat, /spatialSceneLinkedAssetIds\(spatialScene, graphBeat, option, context\)/,
    "shared scene resolution includes the exact base or variant context so accepted scene-link overrides remain scoped");
  assert.match(sharedSceneBeat, /linkedAssetIds:\s*uniqueStrings\(savedSceneAssetIds\)/);
  assert.doesNotMatch(sharedSceneBeat, /sourceMotion|motionAssetIds/,
    "motion metadata cannot inject another beat or variant's visual asset");

  assert.match(boundary, /interBeatPreviewBeatForSceneContext\(proposal, fromSceneContext\)/);
  assert.match(boundary, /interBeatPreviewBeatForSceneContext\(proposal, toSceneContext\)/);
  assert.match(boundary, /fromSceneContext/);
  assert.match(boundary, /toSceneContext/);

  assert.match(initialize, /const editorSceneContext = activeInterBeatSceneContext\(\)/);
  assert.match(initialize, /const canvasSceneContext = activeInterBeatCanvasPreviewContext\(\)/);
  assert.match(initialize, /const sceneContext = editorSceneContext \|\| canvasSceneContext/);
  assert.match(initialize, /if \(!sceneContext\) return/);
  assert.match(initialize, /interBeatBoundaryPlaybackSummary\(proposal, sceneContext\)/);
  assert.match(initialize, /beatContext\.from\?\.linkedAssetIds/);
  assert.match(initialize, /beatContext\.to\?\.linkedAssetIds/);
  assert.doesNotMatch(initialize, /interBeatStoryBeats\(proposal\)|selectedInterBeatBeatContext\(proposal\)/,
    "the opened editor must not pool its scene from the old story-wide beat selection");
  assert.match(initialize, /sceneContext:\s*beatContext\.toSceneContext/);
  assert.match(initialize, /beat:\s*beatContext\.to/);
  assert.match(initialize, /thumbnailMode\s*\?\s*null\s*:\s*spatialSceneEntities\(lockedSpatialRelationsContract\(\), beatContext\.toSceneContext \|\| sceneContext\)/,
    "the full Transition editor resolves the Reader from its exact destination scene");
  assert.match(initialize, /thumbnailMode\s*\?\s*null\s*:\s*createSpatialReaderRig\(root, layers\.viewpointKind, layoutKind, readerEntity\)/,
    "the Transition spatial editor shows the saved Reader without adding it to Story Canvas thumbnails");
  assert.match(initialize, /readerRig:\s*readerEditorLayer\?\.rig \|\| null/);
  assert.match(initialize, /readerProxy:\s*readerEditorLayer\?\.proxy \|\| null/);
  assert.match(sourceFunction("frameInterBeatSourcePlaybackAsset"), /!viewer\.thumbnailMode && viewer\.readerRig \? viewer\.root : object/,
    "the full Transition editor frames the Reader with the destination scene while thumbnails retain their focused framing");
  assert.match(sourceFunction("requestSourceCameraCue"), /!viewer\.thumbnailMode && !state\.sourceCameraPreviewEnabled/,
    "a declared source camera cannot hide the Reader unless the author explicitly previews that camera");
  assert.doesNotMatch(initialize, /addInheritedTextComfortLayer/,
    "the Transition spatial editor does not add a detached prose panel");
  assert.doesNotMatch(sourceFunction("addInterBeatTransitionOverlays"), /makeTextSprite|Beat A:|Beat B:|reader travels/,
    "Transition route geometry has no floating endpoint or reader labels");
  assert.match(initialize, /transition && !sceneContext\.variantOptionId/,
    "variant destinations bypass the host-only single-anchor source order");
  assert.match(initialize, /attachLockedEnvironmentToViewer\(viewer\)/);
  assert.match(lockedEnvironment, /viewer\?\.sceneContext\?\.beatId \|\| viewer\?\.beat\?\.id/);
  assert.match(lockedEnvironment, /environmentEnhancementContractForBeat\(decisionBundle, beatId\)/,
    "Transition uses the destination beat's environment, including an explicit neutral assignment");
});

test("shared-timeline playback stays authoritative for host routes while variant progressions use exact route assignments", () => {
  const summary = sourceFunction("interBeatBoundaryPlaybackSummary");
  const preview = sourceFunction("renderInterBeatPreview");
  const initialize = sourceFunction("initializeInterBeatDynamicsViewer");
  const attach = sourceFunction("attachSourceDynamicsPreviewAnimation");
  const animation = sourceFunction("animateCumulativeSourceOrderModel");
  const previewAssetId = sourceFunction("interBeatSourcePlaybackPreviewAssetId");
  const framePreviewAsset = sourceFunction("frameInterBeatSourcePlaybackAsset");
  const thumbnailSpec = sourceFunction("transitionModelThumbnailAnimationSpec");
  const thumbnailViewer = sourceFunction("mountDynamicModelThumbnailViewer");

  assert.match(summary, /boundary\.from\?\.linkedAssetIds/);
  assert.match(summary, /boundary\.to\?\.linkedAssetIds/);
  assert.match(summary, /sourcePlaybackPreviewSummary\(/);
  assert.match(summary, /boundary\.fromBeatId \|\| ""/);
  assert.match(summary, /boundary\.toBeatId/);
  assert.match(summary, /const forceHold = !boundary\.fromBeatId \|\| sourcePartPlaybackMode === "frozen"/);
  assert.match(summary, /manualVariantSwitch[\s\S]*dynamicMotionTracksForSceneContext\(boundary\.toSceneContext\)/);
  assert.match(summary, /manualVariantSwitch[\s\S]*interBeatVariantTransitionAnimationSpec\(proposal, boundary, mappedTracks\)/);
  assert.match(summary, /manualVariantSwitch[\s\S]*Boolean\(variantTransitionAnimationSpec\)/);
  assert.match(summary, /const routeScopedProgression = Boolean\(/);
  assert.match(summary, /interBeatMappedTracksForBoundary\(boundary\)/);
  assert.match(summary, /!routeScopedProgression && sourcePlaybackSummary\.contractAvailable/,
    "a variant-source progression does not inherit a beat-pair timeline from a sibling route");
  assert.match(summary, /Boolean\(boundary\.fromBeatId\)[\s\S]*mappedTracks\.length > 0/,
    "opening and unmapped legacy boundaries stay inert");

  assert.match(preview, /interBeatBoundaryPlaybackSummary\(/);
  assert.match(preview, /sourcePlaybackSummary\.contractAvailable/);
  assert.match(preview, /sourcePlaybackSummary\.windowState\.mode === "scrub"/);
  assert.match(initialize, /interBeatBoundaryPlaybackSummary\(/);
  assert.match(initialize, /canScrub:\s*hasScrubWindow/);
  assert.match(initialize, /if \(!hasScrubWindow\) state\.interBeatPreviewPlaying = false/);
  assert.doesNotMatch(initialize, /selectedSourceMotionTrack|sourceMotionTransitionAssignmentForPreview/,
    "the advanced inspector selection must not choose primary Transition playback");

  assert.match(attach, /!viewer\.manualVariantSwitch && !viewer\.routeScopedTransition && attachSourceTransitionPlayback\(viewer, entry, gltf\)/);
  assert.ok(
    attach.indexOf("attachSourceTransitionPlayback") < attach.indexOf("selectedSourceMotionTrack"),
    "the shared boundary contract is consulted before the legacy selected-track fallback",
  );
  assert.match(animation, /const transitionPlaybackActive = updateSourceTransitionPlayback\(viewer, entry\)/);
  assert.match(animation, /if \(!transitionPlaybackActive && kind === "none"\) return/,
    "a saved No dynamics layer stays inert without suppressing a real Transition");

  assert.match(previewAssetId, /contractAvailable !== true/);
  assert.match(previewAssetId, /windowState\?\.mode !== "scrub"/);
  assert.match(initialize, /sourcePlaybackPreviewAssetIndex[\s\S]*assetLink\.assetId === sourcePlaybackPreviewAssetId/);
  assert.match(initialize, /activeSwapIndex:\s*previewActiveSwapIndex/,
    "an explicit source window makes its contracted model the visible single-anchor slot");
  assert.match(initialize, /!sourcePlaybackPreviewAssetId[\s\S]*shouldRestorePreviewCameraState/,
    "stale editor camera state cannot override explicit source-window framing");
  assert.match(initialize, /frameInterBeatSourcePlaybackAsset\(viewer\)/);
  assert.match(framePreviewAsset, /candidate\?\.assetId === assetId/);
  assert.match(framePreviewAsset, /fitCameraToObject\([\s\S]*!viewer\.thumbnailMode && viewer\.readerRig \? viewer\.root : object/,
    "the full editor frames the Reader with the coordinated asset while thumbnails remain asset-only");
  assert.match(thumbnailSpec, /previewFraming:\s*"source-playback-focus"/);
  assert.match(thumbnailSpec, /startProgress:\s*windowState\.startProgress/);
  assert.match(thumbnailSpec, /endProgress:\s*windowState\.endProgress/);
  assert.match(thumbnailViewer, /attachSourceDynamicsPreviewAnimation\(viewer, entry, gltf\)/,
    "the thumbnail and editor attach the same explicit source playback contract");
  assert.match(thumbnailViewer, /fitCameraToObject\(viewer\.camera, viewer\.controls, modelRoot\)/,
    "the thumbnail and editor use the same spatial-preview focus-camera helper");
});

test("mapped thumbnails and unmapped route buttons open URL-backed Transition editors", () => {
  const bind = sourceFunction("bindInterBeatDynamicsCanvasEvents");
  const bindAll = sourceFunction("bindEvents");
  const unmappedButton = sourceFunction("renderInterBeatUnmappedTransitionButton");
  const thumbnail = sourceFunction("renderInterBeatBoundaryThumbnail");
  const open = sourceFunction("openInterBeatSceneEditor");
  const close = sourceFunction("closeInterBeatSceneEditor");
  const normalizeNavigation = sourceFunction("normalizeStoryvrBrowserNavigation");
  const applyNavigation = sourceFunction("applyStoryvrBrowserNavigation");
  const returnToCanvas = sourceFunction("returnToInterBeatCanvasWithBrowserHistory");

  assert.match(bindAll, /bindInterBeatDynamicsCanvasEvents\(\)/);
  assert.match(bind, /bindSourceGraphCanvasPanning\(viewport\)/);
  assert.doesNotMatch(bind, /\[data-inter-beat-open-scene\]/);
  assert.match(bind, /\[data-inter-beat-open-transition\]/);
  assert.match(bind, /openInterBeatSceneEditor\(context\)/);
  assert.match(bind, /\[data-inter-beat-close-save\]/);
  assert.match(unmappedButton, /data-inter-beat-open-transition/);
  assert.match(thumbnail, /data-inter-beat-open-transition/);
  assert.match(unmappedButton, /data-inter-beat-beat-id="\$\{escapeHtml\(context\.beatId\)\}"/);
  assert.match(unmappedButton, /data-inter-beat-edge-id="\$\{escapeHtml\(context\.transitionEdgeId\)\}"/);

  assert.match(open, /spatialSceneContext\(context\?\.beatId, context\?\.variantGroupId, context\?\.variantOptionId\)/);
  assert.match(open, /normalized\.transitionEdgeId = context\.transitionEdgeId/);
  assert.match(open, /pushStoryvrBrowserNavigation/);
  assert.match(open, /createStoryvrNavigationRoute\("inter-beat-dynamics", normalized\)/);
  assert.match(open, /parentEntryId:\s*currentEntry\?\.entryId/);
  assert.match(normalizeNavigation, /requestedScene\.transitionEdgeId/);
  assert.match(applyNavigation, /\[data-inter-beat-story-canvas-viewport\]/);
  assert.match(applyNavigation, /state\.interBeatCanvasReturnScroll = \{/);
  assert.match(applyNavigation, /state\.interBeatEditorScene = navigation\.editorScene/);
  assert.match(applyNavigation, /state\.interBeatPreviewPlaying = playback\.canScrub/,
    "mapped routes start playing while an unmapped route still opens with playback paused");
  assert.doesNotMatch(open, /fromBeatId|toBeatId/,
    "boundary IDs are derived from current graph order rather than cached in editor state");

  assert.match(close, /await historyFinalizePromise/);
  assert.match(close, /const savedChanges = sourceMotionHasUnsavedChanges\(\)/);
  assert.match(close, /withAuthorHistory\("Save Transition motion links", \(\) => persistSourceMotionLinks\(\), \{/);
  assert.match(close, /componentId:\s*"inter-beat-dynamics"/);
  assert.ok(
    close.indexOf("persistSourceMotionLinks()") < close.indexOf("returnToInterBeatCanvasWithBrowserHistory()"),
    "a failed source-motion save leaves the Transition editor open",
  );
  assert.doesNotMatch(close, /state\.interBeatEditorScene = null/);
  assert.match(close, /returnToInterBeatCanvasWithBrowserHistory\(\)/);
  assert.match(returnToCanvas, /window\.history\.back\(\)/);
  assert.match(returnToCanvas, /replaceStoryvrBrowserNavigation\(canvasNavigation\)/);
  assert.match(close, /catch \(error\)[\s\S]*Transition save failed/);
});

test("Transition persists exact Source Graph edge and scene-context assignments on the existing source-motion endpoint", () => {
  const persist = sourceFunction("persistSourceMotionLinks");
  const payload = sourceFunction("sourceMotionAssignmentPayload");
  const authoredTransitions = sourceFunction("authoredMotionTransitions");
  const normalizeTransitions = sourceFunction("normalizeMotionTransitions");
  const transitionIdentity = sourceFunction("motionTransitionIdentity");
  const transitionRecord = sourceFunction("motionTransitionRecordForAuthoredTransition");
  const materializeTransitions = sourceFunction("materializeMotionTransitionAssignments");
  const transitionTargets = sourceFunction("renderSourceMotionTransitionTargets");
  const transitionBlocks = [
    sourceFunction("renderInterBeatDynamicsWorkspace"),
    sourceFunction("renderInterBeatDynamicsCanvasWorkspace"),
    sourceFunction("renderInterBeatDynamicsEditorWorkspace"),
    sourceFunction("renderInterBeatStoryCanvas"),
    sourceFunction("renderInterBeatStoryBeat"),
    sourceFunction("renderInterBeatBoundaryConnector"),
    sourceFunction("renderInterBeatBoundaryThumbnail"),
    sourceFunction("renderInterBeatStoryCard"),
    sourceFunction("activeInterBeatSceneContext"),
    sourceFunction("interBeatStorySceneContexts"),
    sourceFunction("interBeatPreviewBeatForSceneContext"),
    sourceFunction("interBeatBoundaryForSceneContext"),
    sourceFunction("interBeatBoundaryPlaybackSummary"),
    sourceFunction("openInterBeatSceneEditor"),
    sourceFunction("closeInterBeatSceneEditor"),
  ].join("\n");

  assert.match(persist, /const assignments = sourceMotionAssignmentPayload\(\)/);
  assert.match(persist, /api\.post\("\/api\/source-motion-links", \{ assignments \}\)/);
  assert.doesNotMatch(persist, /\/api\/decisions|\/api\/inter-beat-dynamics/);
  assert.match(payload, /const transitionOrder = new Map\(authoredMotionTransitions\(\)/);
  assert.match(payload, /motionTransitionIdentity\(left\)/);
  assert.match(payload, /motionTransitionIdentity\(right\)/);
  assert.match(payload, /assignment\.transitions = materializeMotionTransitionAssignments\(assignment\.transitions\)/,
    "saving upgrades legacy beat-pair assignments into durable route records");
  assert.match(normalizeTransitions, /edgeId/);
  assert.match(normalizeTransitions, /fromContext/);
  assert.match(normalizeTransitions, /toContext/);
  assert.match(transitionIdentity, /value\?\.edgeId \|\| value\?\.routeId/);
  assert.match(transitionRecord, /edgeId:\s*transition\.edgeId/);
  assert.match(transitionRecord, /fromContext:\s*normalizeMotionSceneContext\(transition\.fromContext/);
  assert.match(transitionRecord, /toContext:\s*normalizeMotionSceneContext\(transition\.toContext/);
  assert.match(materializeTransitions, /const legacy = \[\]/);
  assert.match(materializeTransitions, /authored\.filter\(\(transition\) => legacyMotionTransitionCanSeedRoute\(assignment, transition\)\)/);
  assert.match(materializeTransitions, /motionTransitionRecordForAuthoredTransition\(transition, assignment\)/,
    "one legacy beat pair materializes every currently authored parallel route while retaining its metadata");
  assert.match(materializeTransitions, /if \(!materialized\.has\(transition\.key\)\)/,
    "an existing exact route assignment wins over a legacy seed");
  assert.match(transitionTargets, /motionTransitionAssignmentForAuthoredTransition\(draft\?\.transitions, transition\)/);
  assert.match(transitionTargets, /data-motion-transition-edge="\$\{escapeHtml\(transition\.edgeId\)\}"/);
  assert.match(source, /querySelectorAll\("\[data-motion-transition-edge\]"\)/);
  assert.match(source, /motionTransitionRecordForAuthoredTransition\(authored\)/,
    "checking a route writes its exact edge and endpoint contexts");
  assert.match(authoredTransitions, /sourceGraphTransitionEdges\(state\.data\?\.graph/);
  assert.match(authoredTransitions, /edge\.from\.beatId/);
  assert.match(authoredTransitions, /edge\.to\.beatId/);
  assert.doesNotMatch(authoredTransitions, /beats\.slice\(0,\s*-1\)|beats\[index \+ 1\]/);
  assert.doesNotMatch(transitionBlocks, /assignmentsByBeat/,
    "Transition does not adopt Environment Enhancement's beat-assignment persistence model");
});

test("variant-scoped arrows use exact mapped GLB clips without borrowing a sibling beat-pair route", () => {
  const preview = sourceFunction("renderInterBeatVariantTransitionPreview");
  const variantSpec = sourceFunction("interBeatVariantTransitionAnimationSpec");
  const summary = sourceFunction("interBeatBoundaryPlaybackSummary");
  const status = sourceFunction("interBeatBoundaryStatus");
  const spec = sourceFunction("transitionModelThumbnailAnimationSpec");
  const editor = sourceFunction("renderInterBeatDynamicsEditorWorkspace");
  const initialize = sourceFunction("initializeInterBeatDynamicsViewer");
  const attach = sourceFunction("attachSourceDynamicsPreviewAnimation");

  assert.match(preview, /transitionEdgeId:\s*edge\?\.id/,
    "reciprocal variant arrows retain their exact directed edge identity");
  assert.match(variantSpec, /boundary\.to\?\.linkedAssetIds/);
  assert.match(variantSpec, /dynamicModelThumbnailAnimationSpec\(asset, boundary\.toSceneContext, proposal, mappedTracks\)/,
    "variant transitions use the same exact clip and embedded-animation matching as Dynamics thumbnails");
  assert.match(summary, /manualVariantSwitch[\s\S]*dynamicMotionTracksForSceneContext\(boundary\.toSceneContext\)/,
    "same-beat variant transitions reuse only clips mapped to the destination variant scene");
  assert.match(summary, /interBeatVariantTransitionAnimationSpec\(proposal, boundary, mappedTracks\)/);
  assert.match(summary, /Boolean\(variantTransitionAnimationSpec\)/);
  assert.match(summary, /routeScopedProgression/);
  assert.match(summary, /interBeatMappedTracksForBoundary\(boundary\)/);
  assert.match(status, /if \(manualVariantSwitch\)[\s\S]*canScrub[\s\S]*Mapped transition[\s\S]*No mapped transition/);
  assert.doesNotMatch(spec, /canScrub \|\| playback\.manualVariantSwitch/,
    "a mapped variant edge is no longer excluded from thumbnail capture");
  assert.match(editor, /Variant transition from/);
  assert.match(editor, /plays its matched GLB animation when one is mapped/);
  assert.match(initialize, /manualVariantSwitch:\s*playback\.manualVariantSwitch/);
  assert.match(initialize, /variantTransitionAnimationSpec:\s*playback\.variantTransitionAnimationSpec/);
  assert.match(attach, /!viewer\.manualVariantSwitch && !viewer\.routeScopedTransition && attachSourceTransitionPlayback/,
    "same-beat switches and variant-source progressions bypass an unrelated host beat timeline");
  assert.match(attach, /variantAnimationSpec\.useAllEmbeddedClips/,
    "the full editor preserves Dynamics' embedded-animation fallback for older stories");
});

test("unmatched Transition boundaries show one openable No mapped transition route button", () => {
  const canvas = sourceFunction("renderInterBeatStoryCanvas");
  const connector = sourceFunction("renderInterBeatBoundaryConnector");
  const unmappedButton = sourceFunction("renderInterBeatUnmappedTransitionButton");
  const thumbnail = sourceFunction("renderInterBeatBoundaryThumbnail");
  const summary = sourceFunction("interBeatBoundaryPlaybackSummary");

  assert.match(canvas, /if \(!beats\.length\)/);
  assert.match(canvas, /No Source Graph beats are available/);
  assert.match(connector, /renderInterBeatUnmappedTransitionButton\(context, fromTitle, toTitle\)/);
  assert.match(connector, /!thumbnailSpec/);
  assert.doesNotMatch(connector, /<span class="transition-boundary-status">/,
    "the connector delegates the visible status instead of duplicating it");
  assert.match(unmappedButton, /data-inter-beat-open-transition/);
  assert.match(unmappedButton, /aria-label="\$\{escapeHtml\(`Open transition from \$\{fromTitle\} to \$\{toTitle\}: No mapped transition`\)\}"/);
  assert.match(unmappedButton, /<span class="transition-boundary-status">No mapped transition<\/span>/);
  assert.doesNotMatch(connector, /Held state|Initial state|Opening state|Mapped transition|mapped motion/,
    "the canvas exposes no multi-state Transition taxonomy");
  assert.match(thumbnail, /if \(!thumbnailSpec\) return ""/,
    "boundaries without a matched GLB animation render no thumbnail");
  assert.match(summary, /const forceHold = !boundary\.fromBeatId \|\| sourcePartPlaybackMode === "frozen"/);
  assert.doesNotMatch(thumbnail, /data-inter-beat-play|>Play<|>Pause<|>Hide</,
    "the compact canvas thumbnail has no visible playback text");
});

test("matched GLB boundaries show text-free looping thumbnails that open the playing spatial editor", () => {
  const connector = sourceFunction("renderInterBeatBoundaryConnector");
  const thumbnail = sourceFunction("renderInterBeatBoundaryThumbnail");
  const card = sourceFunction("renderInterBeatStoryCard");
  const spec = sourceFunction("transitionModelThumbnailAnimationSpec");
  const initialize = sourceFunction("initializeDynamicModelThumbnails");
  const createViewer = sourceFunction("dynamicModelThumbnailViewerForSpec");
  const mountViewer = sourceFunction("mountDynamicModelThumbnailViewer");
  const renderFrame = sourceFunction("requestDynamicModelThumbnailFrame");
  const bind = sourceFunction("bindInterBeatDynamicsCanvasEvents");
  const applyNavigation = sourceFunction("applyStoryvrBrowserNavigation");

  assert.match(connector, /class="transition-boundary-connector \$\{className\}"/);
  assert.match(connector, /role="group"/);
  assert.match(connector, /transition-boundary-arrow/);
  assert.match(connector, /thumbnailSpec \? "mapped" : "no-dynamics"/);
  assert.match(connector, /thumbnailSpec \? renderInterBeatBoundaryThumbnail/);
  assert.match(thumbnail, /data-inter-beat-open-transition/);
  assert.match(thumbnail, /data-transition-model-thumbnail="\$\{escapeHtml\(thumbnailSpec\.assetId\)\}"/);
  assert.match(thumbnail, /dynamic-model-thumbnail is-loading/);
  assert.doesNotMatch(thumbnail, /data-inter-beat-play|data-inter-beat-boundary-preview|transition-boundary-thumbnail-play/);
  assert.doesNotMatch(card, /data-inter-beat-open-scene|<button/,
    "beat cards are display-only; the mapped thumbnail is the sole editor entry point");

  assert.match(spec, /if \(!playback\?\.canScrub\) return null/);
  assert.match(spec, /if \(playback\.manualVariantSwitch\)[\s\S]*variantTransitionAnimationSpec/);
  assert.match(spec, /sourcePlaybackClipDescriptors\(contractedAsset, windowState\)/);
  assert.match(spec, /playback\.mappedTracks \|\| \[\]/);
  assert.match(spec, /sourceMotionTrackIsCamera\(track\)/);
  assert.match(spec, /timelineWindow:/);
  assert.match(initialize, /const transitionCanvas = active\?\.id === "inter-beat-dynamics" && !activeInterBeatSceneContext\(\)/);
  assert.match(initialize, /\[data-transition-model-thumbnail\]/);
  assert.match(initialize, /interBeatBoundaryPlaybackSummary\(proposal, context\)/);
  assert.match(initialize, /new IntersectionObserver/);
  assert.match(initialize, /prefers-reduced-motion: reduce/);
  assert.match(createViewer, /componentId:\s*spec\.componentId/);
  assert.match(createViewer, /new THREE\.WebGLRenderer\(\{ antialias: true, alpha: true \}\)/);
  assert.match(mountViewer, /attachSourceDynamicsPreviewAnimation\(viewer, entry, gltf\)/);
  assert.match(renderFrame, /animateCumulativeSourceOrderModel\(viewer, entry, viewer\.elapsed\)/);
  assert.match(renderFrame, /viewer\.renderer\.render\(viewer\.scene, viewer\.camera\)/);
  assert.match(bind, /\[data-inter-beat-open-transition\]/);
  assert.match(bind, /openInterBeatSceneEditor\(context\)/);
  assert.match(applyNavigation, /state\.interBeatPreviewPlaying = playback\.canScrub/);

  assert.match(styles, /\.transition-story-beat-item\.has-connector\s*\{[^}]*grid-template-columns:\s*280px 240px/s);
  assert.match(styles, /\.transition-boundary-stack\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1 \/ span 2;[^}]*width:\s*240px/s);
  assert.match(styles, /\.transition-boundary-stack > \.transition-boundary-connector\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*auto/s);
  assert.match(styles, /\.transition-boundary-connector\s*\{[^}]*width:\s*240px/s,
    "Transition reserves enough horizontal space for a branch label before the shared trunk");
  assert.doesNotMatch(styles, /\.transition-story-variant-switcher/);
  assert.match(styles, /\.story-variant-link-layer\.has-transition-previews \.story-variant-transition-preview\s*\{[^}]*pointer-events:\s*all/s);
  assert.match(
    styles,
    /\.story-variant-link-layer\.has-transition-previews \.story-variant-transition-preview\.no-dynamics\s*\{[^}]*--transition-boundary-color:\s*#b85e20;/s,
    "unmapped variant routes use the same orange transition color as ordinary boundaries",
  );
  assert.match(styles, /\.story-variant-transition-preview \.transition-boundary-thumbnail\s*\{[^}]*width:\s*144px/s);
  assert.match(styles, /\.story-variant-transition-preview \.transition-boundary-thumbnail-stage\s*\{[^}]*height:\s*80px/s);
  assert.match(
    styles,
    /\.transition-boundary-status\s*\{[^}]*max-width:\s*160px;[^}]*border:\s*2px solid[^}]*border-radius:\s*999px;[^}]*font-size:\s*0\.68rem;[^}]*font-weight:\s*950;/s,
    "ordinary and variant routes share the same emphasized unmapped-transition pill",
  );
  assert.match(
    styles,
    /\.story-variant-transition-preview\.no-dynamics \.transition-boundary-status\s*\{[^}]*position:\s*static;[^}]*transform:\s*none;/s,
    "variant-route badges only override placement, not visual styling",
  );
  assert.match(styles, /\.transition-story-canvas-viewport \.source-graph-variant-alternatives > li:not\(:last-child\)\s*\{[^}]*margin-block-end:\s*96px/s);
  assert.match(styles, /\.transition-boundary-arrow::before\s*\{[^}]*height:\s*var\(--story-canvas-arrow-stroke-width\);[^}]*background:\s*var\(--story-canvas-arrow-color\);/s);
  assert.match(styles, /\.transition-boundary-arrow::after\s*\{[^}]*border-left:\s*var\(--story-canvas-arrowhead-length\) solid var\(--story-canvas-arrow-color\);/s);
  assert.match(styles, /\.transition-boundary-thumbnail\s*\{[^}]*cursor:\s*pointer/s);
  assert.match(styles, /\.transition-boundary-thumbnail-stage\s*\{[^}]*height:\s*104px/s);
  assert.match(styles, /\.dynamic-model-thumbnail-canvas\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*pointer-events:\s*none/s);
  assert.doesNotMatch(styles, /dynamic-model-thumbnail-frames|steps\(8, end\)|\.dynamic-model-thumbnail\.is-animated[^}]*background-position/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.transition-boundary-stack\s*\{[^}]*grid-row:\s*3/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.transition-boundary-connector\s*\{[^}]*grid-row:\s*auto/s);
});
