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

test("Dynamics gets the single-workspace shell and a canvas-only landing page", () => {
  const render = sourceFunction("render");
  const workspace = sourceFunction("renderDynamicGeometryWorkspace");
  const canvas = sourceFunction("renderDynamicGeometryCanvasWorkspace");

  assert.match(render, /const isDynamicGeometry = active\.id === "dynamic-geometry"/);
  assert.match(render, /const showSidebar = [^\n]*!isDynamicGeometry/);
  assert.match(render, /showSidebar \? "authoring-layout" : "single-workspace-layout"/);
  assert.match(workspace, /const sceneContext = activeDynamicSceneContext\(\)/);
  assert.match(workspace, /if \(!sceneContext\) return renderDynamicGeometryCanvasWorkspace\(component, selectedProposal, ready\)/);
  assert.match(workspace, /renderDynamicGeometryEditorWorkspace\(component, selectedProposal, ready, sceneContext\)/);
  assert.match(canvas, /data-dynamic-workspace-mode="canvas"/);
  assert.match(canvas, /renderDynamicStoryCanvas\(proposal\)/);
  assert.match(canvas, /renderCheckpointActions\(component, state\.data\.decisions\[component\.id\], \{ canCommit: Boolean\(proposal\) \}\)/);
  assert.match(canvas, /participantBlockingDependencyLabel\(component\.id\)/);
  assert.match(canvas, /before checking object movement/);
  assert.doesNotMatch(canvas, /renderDynamicPreview|renderDynamicInspector|renderSourceMotionLinkingEditor/);
  assert.doesNotMatch(canvas, /data-dynamic-viewer|save-source-motion-links/);
  assert.match(styles, /\.dynamic-canvas-mode\s*\{[^}]*width:\s*100%/s);
});

test("the Dynamics canvas renders every authored beat and each parallel variant with an exact scene context", () => {
  const contexts = sourceFunction("dynamicStorySceneContexts");
  const canvas = sourceFunction("renderDynamicStoryCanvas");
  const beat = sourceFunction("renderDynamicStoryBeat");
  const card = sourceFunction("renderDynamicStoryCard");

  assert.match(contexts, /for \(const beat of state\.data\?\.graph\?\.beats \|\| \[\]\)/);
  assert.match(contexts, /contexts\.push\(spatialSceneContext\(beat\.id, group\?\.id, defaultOption\?\.id\)\)/);
  assert.match(contexts, /for \(const option of group\.options \|\| \[\]\)/);
  assert.match(contexts, /contexts\.push\(spatialSceneContext\(beat\.id, group\.id, option\.id\)\)/);
  assert.match(canvas, /const beats = state\.data\?\.graph\?\.beats \|\| \[\]/);
  assert.match(canvas, /beats\.map\(\(beat, index\) => renderDynamicStoryBeat\(beat, index, beats\.length, proposal\)\)/);
  assert.match(beat, /sourceGraphDefaultVariantOption\(group\)/);
  assert.match(beat, /renderDynamicStoryCard\(beat, defaultOption, primaryContext, index, proposal, true\)/);
  assert.match(beat, /renderDynamicStoryCard\(beat, option, spatialSceneContext\(beat\.id, group\.id, option\.id\), index, proposal, false\)/);
  assert.match(card, /dynamicPreviewBeatForSceneContext\(proposal, context\)/);
  assert.match(card, /data-dynamic-beat-id="\$\{escapeHtml\(context\.beatId\)\}"/);
  assert.match(card, /data-dynamic-variant-group-id="\$\{escapeHtml\(context\.variantGroupId\)\}"/);
  assert.match(card, /data-dynamic-variant-option-id="\$\{escapeHtml\(context\.variantOptionId\)\}"/);
  assert.match(card, /linkedAssetIds\.map\(\(assetId\) => renderDynamicStoryAsset\(assetId, context, proposal, mappedTracks\)\)/);
  assert.doesNotMatch(card, /linkedAssetIds\.slice\(/,
    "Dynamics cards must render every scene asset so mapped models are not hidden by earlier image assets");
  assert.match(card, /No extra movement/);
  assert.match(card, /Saved movement/);
  assert.match(card, /Scene stays still/);
  assert.match(card, /className: "no-dynamics"/);
  assert.match(card, /className: "mapped"/);
  assert.match(card, /className: "static"/);
});

test("mapped GLB thumbnails use lazy live spatial-preview renderers while static and reduced-motion cards keep snapshots", () => {
  const render = sourceFunction("render");
  const asset = sourceFunction("renderDynamicStoryAsset");
  const spec = sourceFunction("dynamicModelThumbnailAnimationSpec");
  const initialize = sourceFunction("initializeDynamicModelThumbnails");
  const createViewer = sourceFunction("dynamicModelThumbnailViewerForSpec");
  const mountViewer = sourceFunction("mountDynamicModelThumbnailViewer");
  const renderFrame = sourceFunction("requestDynamicModelThumbnailFrame");
  const disposeViewer = sourceFunction("disposeDynamicModelThumbnailViewer");
  const cleanup = sourceFunction("disposeSourceGraphModelThumbnailResources");

  assert.match(render, /initializeDynamicModelThumbnails\(active\)/);
  assert.match(asset, /dynamicModelThumbnailAnimationSpec\(asset, context, proposal, mappedTracks\)/);
  assert.match(asset, /proposal && inferDynamicGeometryKind\(proposal\) !== "none"/,
    "missing and explicit no-dynamics proposals must render the normal static thumbnail");
  assert.match(asset, /data-dynamic-model-thumbnail=/);
  assert.match(asset, /renderSourceGraphAssetPreview\(asset\)/,
    "unmapped GLBs and images keep the existing static preview path");
  assert.match(spec, /dynamicMotionTracksForSceneContext\(context\)/);
  assert.match(spec, /\.filter\(\(track\) => track\.assetId === asset\.id\)/);
  assert.match(spec, /eligibleSourceMotionTracks\("dynamic-geometry"\)\.length/);
  assert.match(spec, /sourceDynamics\?\.hasEmbeddedAnimation/,
    "legacy projects may animate embedded clips only when structured tracks are absent");
  assert.match(initialize, /const dynamicCanvas = active\?\.id === "dynamic-geometry" && !activeDynamicSceneContext\(\)/);
  assert.match(initialize, /if \(!dynamicCanvas && !transitionCanvas\) return/);
  assert.match(initialize, /prefers-reduced-motion: reduce/);
  assert.match(initialize, /new IntersectionObserver/);
  assert.match(initialize, /data-dynamic-story-canvas-viewport/);
  assert.match(initialize, /rootMargin:\s*"0px"/,
    "the same observer that starts playback must pause as soon as a card leaves the viewport");
  assert.match(initialize, /classList\.toggle\("is-visible", visible\)/);
  assert.match(initialize, /disposeDynamicModelThumbnailViewer\(node\)/,
    "offscreen thumbnails release their live WebGL context");
  assert.match(initialize, /mountDynamicModelThumbnailViewer\(node, spec, session\)/);
  assert.match(initialize, /requestDynamicModelThumbnailStaticFallback\(node, spec, session\)/);
  assert.match(createViewer, /new THREE\.Scene\(\)/);
  assert.match(createViewer, /new THREE\.PerspectiveCamera\(42,/);
  assert.match(createViewer, /new THREE\.WebGLRenderer\(\{ antialias: true, alpha: true \}\)/);
  assert.match(createViewer, /new OrbitControls\(camera, renderer\.domElement\)/);
  assert.match(createViewer, /renderer\.domElement\.className = "dynamic-model-thumbnail-canvas"/);
  assert.match(mountViewer, /attachSourceDynamicsPreviewAnimation\(viewer, entry, gltf\)/,
    "the thumbnail consumes the canonical Dynamics and Transition playback attachment");
  assert.match(mountViewer, /fitCameraToObject\(viewer\.camera, viewer\.controls, modelRoot\)/,
    "the live thumbnail uses the same spatial-preview camera framing helper");
  assert.match(renderFrame, /animateDynamicGeometry\(viewer\)/);
  assert.match(renderFrame, /animateCumulativeSourceOrderModel\(viewer, entry, viewer\.elapsed\)/);
  assert.match(renderFrame, /viewer\.renderer\.render\(viewer\.scene, viewer\.camera\)/);
  assert.match(disposeViewer, /cancelAnimationFrame/);
  assert.match(disposeViewer, /viewer\.renderer\?\.forceContextLoss/);
  assert.match(cleanup, /sourceGraphModelThumbnailRenderer\?\.forceContextLoss/);
  assert.doesNotMatch(source, /captureDynamicModelThumbnailSprite|dynamicModelThumbnailSpriteBlob|DYNAMIC_MODEL_THUMBNAIL_FRAME_COUNT/);
  assert.doesNotMatch(styles, /dynamic-model-thumbnail-frames|steps\(8, end\)|\.dynamic-model-thumbnail\.is-animated[^}]*background-position/);
  assert.match(styles, /\.dynamic-model-thumbnail-canvas\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*pointer-events:\s*none/s);
  assert.match(styles, /\.source-graph-beat-asset \.asset-icon\.dynamic-model-thumbnail\s*\{[^}]*width:\s*min\(100%, 53px\)[^}]*aspect-ratio:\s*256 \/ 222/s,
    "live canvases preserve the same contained aspect ratio as static snapshots");
});

test("explicit shared timelines hold the coordinated beat state before any legacy Dynamics playback", () => {
  const attach = sourceFunction("attachSourceDynamicsPreviewAnimation");
  const windowForAsset = sourceFunction("sourcePlaybackWindowForAsset");
  const detectsAnimation = sourceFunction("dynamicPreviewHasEmbeddedGlbAnimation");
  const thumbnail = sourceFunction("dynamicModelThumbnailAnimationSpec");
  const selectors = sourceFunction("sourcePartSelectorsForBeatAsset");
  const maskAuthority = sourceFunction("sourcePartStateCanApplyHardMask");

  assert.match(attach, /componentId === "dynamic-geometry"[\s\S]*sourcePlaybackAssetForId\(assetId\)\?\.mode === "shared-timeline"[\s\S]*attachSourceTransitionPlayback/);
  assert.ok(
    attach.indexOf("attachSourceTransitionPlayback") < attach.indexOf("dynamicSourceMotionTracksForPreview"),
    "the story-local shared contract is selected before independent source tracks",
  );
  assert.match(windowForAsset, /forceHold \|\| \["initial", "initialize", "hold"\]\.includes\(beatState\.entryMode\)/);
  assert.match(windowForAsset, /\["initial", "initialize"\]\.includes\(beatState\.entryMode\) \? "initialize" : "hold"/);
  assert.match(detectsAnimation, /hasSharedTimelineState/);
  assert.ok(
    thumbnail.indexOf("sourcePlaybackAssetForId") < thumbnail.indexOf("dynamicMotionTracksForSceneContext"),
    "Dynamics thumbnails seek the shared beat state before considering legacy tracks",
  );
  assert.match(thumbnail, /startProgress: progress,[\s\S]*endProgress: progress/);
  assert.match(maskAuthority, /playback\?\.mode !== "shared-timeline"\) return true/,
    "uncontracted stories retain their existing inferred-mask behavior");
  assert.match(maskAuthority, /partState\?\.provenance === "direct-runtime"/,
    "inference-only selectors cannot become an exclusive mask for a contracted asset");
  assert.match(selectors, /filter\(\(item\) => sourcePartStateCanApplyHardMask\(item, assetId\)\)/);
});

test("a contracted shared source camera owns only the Dynamics preview that declares it", () => {
  const cameraPolicy = sourceFunction("sourcePlaybackAssetUsesDesktopSourceCamera");
  const playbackEntry = sourceFunction("dynamicSourceCameraPlaybackEntry");
  const declaration = sourceFunction("dynamicPreviewDeclaresSharedSourceCamera");
  const sync = sourceFunction("syncSourceCameraPreview");
  const initialize = sourceFunction("initializeDynamicGeometryViewer");
  const capture = sourceFunction("captureDynamicViewerCameraState");
  const captureMounted = sourceFunction("captureMountedPreviewCameraState");

  const helpers = new Function("sourcePlaybackCameraIndex", `
    ${cameraPolicy}
    ${playbackEntry}
    return { sourcePlaybackAssetUsesDesktopSourceCamera, dynamicSourceCameraPlaybackEntry };
  `)((camera) => Number.isInteger(camera?.cameraIndex) ? camera.cameraIndex : null);
  const contractedAsset = {
    mode: "shared-timeline",
    camera: { cameraIndex: 0, desktopPolicy: "render-source-camera" },
  };
  assert.equal(helpers.sourcePlaybackAssetUsesDesktopSourceCamera(contractedAsset), true);
  assert.equal(helpers.sourcePlaybackAssetUsesDesktopSourceCamera({ ...contractedAsset, mode: "independent" }), false);
  assert.equal(helpers.sourcePlaybackAssetUsesDesktopSourceCamera({
    ...contractedAsset,
    camera: { cameraIndex: 0, desktopPolicy: "orbit" },
  }), false);
  const entry = {
    sourcePlaybackContractActive: true,
    sourcePlayback: { asset: contractedAsset, sourceCamera: { name: "authored" } },
  };
  assert.equal(helpers.dynamicSourceCameraPlaybackEntry({ componentId: "dynamic-geometry", dynamicObjects: [entry] }), entry);
  assert.equal(helpers.dynamicSourceCameraPlaybackEntry({ componentId: "inter-beat-dynamics", dynamicObjects: [entry] }), null,
    "Transition retains its existing cue behavior");
  assert.equal(helpers.dynamicSourceCameraPlaybackEntry({ componentId: "dynamic-geometry", dynamicObjects: [{
    ...entry,
    sourcePlaybackContractActive: false,
  }] }), null,
  "an inactive or absent contract cannot take over the orbit camera");

  assert.match(declaration, /componentId !== "dynamic-geometry"/);
  assert.match(declaration, /sourcePlaybackWindowForAsset[\s\S]*forceHold: true/);
  assert.match(declaration, /sourcePlaybackWindowKeepsAssetActive\(windowState\)/);
  assert.match(initialize, /const declaresSharedSourceCamera = dynamicPreviewDeclaresSharedSourceCamera\(viewer\)/);
  assert.match(initialize, /const canRestoreCameraState = !declaresSharedSourceCamera && shouldRestorePreviewCameraState/,
    "an unrelated shared orbit state is never restored before the contracted GLB finishes loading");
  assert.match(initialize, /const frameLoadedDynamicCamera = \(\) => \{\s*if \(syncSourceCameraPreview\(viewer, 0\)\) return;/,
    "the held source camera wins before bounds fitting can include contract annotations");
  assert.match(initialize, /animateDynamicGeometry\(viewer\);\s*syncSourceCameraPreview\(viewer, delta\);\s*controls\.update\(\);/,
    "the Dynamics render loop follows an explicitly contracted animated source camera");
  assert.match(sync, /componentId === "dynamic-geometry"[\s\S]*dynamicSourceCameraPlaybackEntry\(viewer\)/);
  assert.match(sync, /getWorldPosition[\s\S]*getWorldQuaternion[\s\S]*viewer\.camera\.position\.copy/);
  assert.match(sync, /source-playback-camera:/);
  assert.match(capture, /dynamicSourceCameraPlaybackEntry\(dynamicViewer\)\) return null/);
  assert.match(captureMounted, /componentId === "dynamic-geometry" && dynamicSourceCameraPlaybackEntry\(viewer\)\) return/,
    "the authored source pose is not leaked back into shared orbit-camera state");
});

test("author preview supports the opt-in textured background fade recipe", () => {
  const factory = sourceFunction("createSourcePlaybackMaterial");
  const annotations = sourceFunction("initializeSourcePlaybackAnnotations");
  const opaqueRule = sourceFunction("applySourcePlaybackMaterialOpaqueAtUniform");
  assert.match(factory, /recipe === "texture-background-fade"/);
  assert.match(factory, /originalMaterial\?\.map/);
  assert.match(factory, /parameters\.backgroundColor/);
  assert.match(factory, /uniform float fadeOpacity/);
  assert.match(factory, /mix\(backgroundColor, textureColor, fade\)/);
  assert.match(factory, /fade \* showAmt \* storyvrOpacity/);
  assert.match(factory, /storyvrOpaqueAtUniform: sourcePlaybackMaterialOpaqueAtUniform\(definition\)/);
  assert.match(opaqueRule, /storyvrBaseTransparent = nextTransparent/);
  assert.match(annotations, /const parent = runtime\.root \|\| entry\.wrapper/,
    "contract labels inherit the already-normalized GLB coordinate space");
});

test("opening a Dynamics scene mounts the preview, motion mapping, and playback controls without the classification inspector", () => {
  const editor = sourceFunction("renderDynamicGeometryEditorWorkspace");
  const preview = sourceFunction("renderDynamicPreview");

  assert.match(editor, /data-dynamic-workspace-mode="editor"/);
  assert.match(editor, /data-dynamic-close-save/);
  assert.match(editor, /Save scene and return/);
  assert.match(editor, /renderDynamicPreview\(proposal, sceneContext\)/);
  assert.doesNotMatch(editor, /renderDynamicInspector|Source classification/);
  assert.match(editor, /renderSourceMotionLinkingEditor\(component\.id\)/);
  assert.match(preview, /dynamicPreviewBeatForSceneContext\(proposal, sceneContext\)/);
  assert.match(preview, /data-dynamic-play/);
  assert.match(preview, /data-dynamic-restart/);
  assert.match(preview, /data-dynamic-speed/);
  assert.match(preview, /data-dynamic-viewer=/);
  assert.match(preview, /noDynamics && !hasProceduralMotion \?/,
    "an applied or candidate generated plan can animate an otherwise static Dynamics classification");
  assert.doesNotMatch(preview, /data-dynamic-step|Previous beat|Next beat/,
    "the story canvas, rather than an editor stepper, owns scene selection");
});

test("Dynamics scene open and close use browser history and save dirty motion links", () => {
  const bind = sourceFunction("bindDynamicGeometryCanvasEvents");
  const bindAll = sourceFunction("bindEvents");
  const open = sourceFunction("openDynamicSceneEditor");
  const close = sourceFunction("closeDynamicSceneEditor");
  const applyNavigation = sourceFunction("applyStoryvrBrowserNavigation");
  const returnToCanvas = sourceFunction("returnToDynamicCanvasWithBrowserHistory");

  assert.match(bindAll, /bindDynamicGeometryCanvasEvents\(\)/);
  assert.match(bind, /bindSourceGraphCanvasPanning\(viewport\)/);
  assert.match(bind, /\[data-dynamic-open-scene\]/);
  assert.match(bind, /openDynamicSceneEditor\(\{/);
  assert.match(bind, /\[data-dynamic-close-save\]/);
  assert.match(open, /spatialSceneContext\(context\?\.beatId, context\?\.variantGroupId, context\?\.variantOptionId\)/);
  assert.match(open, /pushStoryvrBrowserNavigation/);
  assert.match(open, /createStoryvrNavigationRoute\("dynamic-geometry", normalized\)/);
  assert.match(open, /parentEntryId:\s*currentEntry\?\.entryId/);
  assert.match(applyNavigation, /\[data-dynamic-story-canvas-viewport\]/);
  assert.match(applyNavigation, /state\.dynamicCanvasReturnScroll = \{/);
  assert.match(applyNavigation, /state\.dynamicEditorScene = navigation\.editorScene/);
  assert.match(applyNavigation, /state\.dynamicPreviewRestartToken \+= 1/);
  assert.match(close, /await historyFinalizePromise/);
  assert.match(close, /const savedChanges = sourceMotionHasUnsavedChanges\(\)/);
  assert.match(close, /withAuthorHistory\("Save Dynamics motion links", \(\) => persistSourceMotionLinks\(\), \{/);
  assert.match(close, /componentId:\s*"dynamic-geometry"/);
  assert.doesNotMatch(close, /state\.dynamicEditorScene = null/);
  assert.match(close, /returnToDynamicCanvasWithBrowserHistory\(\)/);
  assert.match(returnToCanvas, /window\.history\.back\(\)/);
  assert.match(returnToCanvas, /replaceStoryvrBrowserNavigation\(canvasNavigation\)/);
});

test("the editor viewer uses only saved scene assets and locked Spatial Relations for the chosen scene", () => {
  const sceneBeat = sourceFunction("dynamicPreviewBeatForSceneContext");
  const initialize = sourceFunction("initializeDynamicGeometryViewer");
  const spatialEntity = sourceFunction("lockedSpatialGlbEntityForViewer");
  const applySpatial = sourceFunction("applyLockedSpatialGlbTransform");
  const loadAsset = sourceFunction("loadDynamicAsset");
  const lockedEnvironment = sourceFunction("lockedEnvironmentPreviewContract");

  assert.match(sceneBeat, /spatialSceneBeat\(context\)/);
  assert.match(sceneBeat, /sourceGraphVariantOption\(context\)/);
  assert.match(sceneBeat, /spatialSceneRecordForContext\(spatialContract, context\)/);
  assert.match(sceneBeat, /spatialSceneLinkedAssetIds\(spatialScene, graphBeat, option, context\)/);
  assert.match(sceneBeat, /linkedAssetIds: uniqueStrings\(savedSceneAssetIds\)/);
  assert.doesNotMatch(sceneBeat, /proceduralDynamicsCandidate|assetLinkPatch|projectedSpatialScene/,
    "a motion candidate cannot replace the saved asset roster or Spatial scene");
  assert.match(initialize, /const sceneContext = activeDynamicSceneContext\(\)/);
  assert.match(initialize, /if \(!sceneContext\) return/);
  assert.match(initialize, /dynamicPreviewBeatForSceneContext\(proposal, sceneContext\)/);
  assert.doesNotMatch(initialize, /proceduralDynamicsCandidateProjectedSpatialScene|suppressedAuthoredAssetIds|projectedSpatialScene/);
  assert.match(initialize, /dynamicSceneAssetLinks\(proposal, \[beat\], sceneContext\)/,
    "the viewer must not pool assets from other beats or variants");
  assert.match(initialize, /spatialSceneEntities\(lockedSpatialRelationsContract\(\), sceneContext\)/,
    "the Dynamics editor resolves the Reader from the same exact saved scene");
  assert.match(initialize, /createSpatialReaderRig\(root, layers\.viewpointKind, layoutKind, readerEntity\)/,
    "the Dynamics spatial editor shows the same Reader model and pose as Spatial Relations");
  assert.match(initialize, /readerRig:\s*readerEditorLayer\.rig/);
  assert.match(initialize, /readerProxy:\s*readerEditorLayer\.proxy/);
  assert.match(initialize, /sceneContext,/);
  assert.doesNotMatch(initialize, /addInheritedTextComfortLayer/,
    "the Dynamics scene editor must not materialize the reader-hand text system surface");
  assert.match(initialize, /viewer\.inheritedTextLayer = null/);
  assert.match(initialize, /attachLockedEnvironmentToViewer\(viewer\)/);
  assert.doesNotMatch(spatialEntity, /projectedSpatialScene/,
    "generated motion cannot override a saved Spatial Relations transform");
  assert.match(spatialEntity, /viewer\?\.sceneContext\?\.beatId/);
  assert.match(spatialEntity, /spatialSceneRecordForContext\(contract, context\)/);
  assert.match(spatialEntity, /spatialSceneEntities\(contract, context\)/);
  assert.match(spatialEntity, /String\(candidate\?\.id \|\| ""\) === requestedEntityId/,
    "reused GLB assets resolve the exact placed entity instead of borrowing a sibling transform");
  assert.match(spatialEntity, /const expectedType = isImageAsset\(asset\) \? "image-plane" : "glb"/);
  assert.match(spatialEntity, /contract\?\.schemaVersion === "storyvr-spatial-relations\/v2"/,
    "a missing v2 scene cannot borrow a legacy global transform");
  assert.match(spatialEntity, /if \(entity \|\| scene \|\| contract\?\.schemaVersion[^)]*\) return entity \|\| null/,
    "an authored scene without this GLB cannot fall through to another scene's transform");
  assert.match(applySpatial, /lockedSpatialGlbEntityForViewer\(viewer, assetId\)/);
  assert.match(loadAsset, /const image = spatialEntity\?\.image \|\| \{\}/);
  assert.match(loadAsset, /authorWrapper\.visible = true/,
    "the existing authored model remains visible");
  assert.match(loadAsset, /lockedSpatialGlbEntityForViewer\(viewer, assetLink\.assetId, assetLink\.entityId\)/);
  assert.match(loadAsset, /spatialTopologyAssetPose\(viewer, index, Math\.max\(total, 1\)\)\.targetSize/);
  assert.match(
    loadAsset,
    /if \(spatialTransformApplied\)[\s\S]*?normalizeSpatialRuntimeObject\([\s\S]*?targetSize,[\s\S]*?spatialEntityVerticalAlignment\(spatialEntity\)/,
    "the Dynamics preview uses the same model normalization and grounding as the saved Spatial Relations scene",
  );
  assert.doesNotMatch(loadAsset, /authoredSourceSuppressed/);
  assert.match(loadAsset, /new THREE\.PlaneGeometry\(width, height\)/,
    "scene images preserve their saved plane dimensions as well as their transform");
  assert.match(lockedEnvironment, /viewer\?\.sceneContext\?\.beatId \|\| viewer\?\.beat\?\.id/);
  assert.match(lockedEnvironment, /environmentEnhancementContractForBeat\(decisionBundle, beatId\)/);
});

test("Dynamics keeps the existing beat-scoped source-motion endpoint and adds no environment-style assignment schema", () => {
  const persist = sourceFunction("persistSourceMotionLinks");
  const saveAction = sourceFunction("handleAction");
  const motionForBeat = sourceFunction("dynamicMotionTracksForBeat");
  const dynamicsBlocks = [
    sourceFunction("renderDynamicGeometryWorkspace"),
    sourceFunction("renderDynamicGeometryCanvasWorkspace"),
    sourceFunction("renderDynamicGeometryEditorWorkspace"),
    sourceFunction("renderDynamicStoryCanvas"),
    sourceFunction("renderDynamicStoryBeat"),
    sourceFunction("renderDynamicStoryCard"),
    sourceFunction("openDynamicSceneEditor"),
    sourceFunction("closeDynamicSceneEditor"),
    sourceFunction("persistSourceMotionLinks"),
    sourceFunction("dynamicStorySceneContexts"),
    sourceFunction("dynamicMotionTracksForBeat"),
    sourceFunction("dynamicMotionTracksForSceneContext"),
    sourceFunction("dynamicPreviewBeatForSceneContext"),
    sourceFunction("initializeDynamicGeometryViewer"),
  ].join("\n");

  assert.match(persist, /const assignments = sourceMotionAssignmentPayload\(\)/);
  assert.match(persist, /api\.post\("\/api\/source-motion-links", \{ assignments \}\)/);
  assert.doesNotMatch(persist, /\/api\/decisions|\/api\/dynamic-geometry/);
  assert.match(saveAction, /if \(action === "save-source-motion-links"\) \{\s*await persistSourceMotionLinks\(\)/s);
  assert.match(motionForBeat, /sourceMotionDraftForTrack\(track\)\?\.beatIds/);
  assert.doesNotMatch(dynamicsBlocks, /assignmentsByBeat/,
    "Dynamics continues to use source-motion tracks whose effective beatIds already provide scene scope");
});

test("generated Dynamics authoring is local-preview-first and exactly beat or variant scoped", () => {
  const editor = sourceFunction("renderDynamicGeometryEditorWorkspace");
  const scope = sourceFunction("proceduralDynamicsScope");
  const renderAuthoring = sourceFunction("renderProceduralDynamicsAuthoring");
  const promptForScene = sourceFunction("proceduralDynamicsPromptForScene");
  const bind = sourceFunction("bindProceduralDynamicsAuthoringEvents");
  const generate = sourceFunction("generateProceduralDynamicsPreview");

  assert.match(editor, /renderProceduralDynamicsAuthoring\(sceneContext, ready\)/);
  assert.match(editor, /renderSourceMotionLinkingEditor\(component\.id\)/,
    "the generated-motion panel is additive to the existing source-motion editor");
  assert.match(editor, /data-dynamic-close-save/,
    "Close & save remains the scene-editor exit");
  assert.match(scope, /proceduralDynamicsSceneKey\(context\)/);
  assert.match(scope, /beatId: context\.beatId/);
  assert.match(scope, /variantGroupId: context\.variantGroupId/);
  assert.match(scope, /variantOptionId: context\.variantOptionId/);
  assert.match(renderAuthoring, /proceduralDynamicsPromptForScene\(sceneContext\)/);
  assert.match(promptForScene, /state\.proceduralDynamicsUi\.promptsByScene\[sceneKey\]/,
    "the prompt survives rerenders independently for each exact scene key");
  assert.match(promptForScene, /proceduralDynamicsStoredPlan\(sceneContext\)\?\.prompt/,
    "a stored authored prompt is restored after reload");
  assert.match(renderAuthoring, /data-procedural-dynamics-scene-key=/);
  assert.match(renderAuthoring, /data-procedural-dynamics-prompt/);
  assert.match(renderAuthoring, /data-procedural-dynamics-generate/);
  assert.match(renderAuthoring, /data-procedural-dynamics-apply/);
  assert.match(renderAuthoring, /data-procedural-dynamics-remove/);
  assert.match(renderAuthoring, /Only objects already placed in this scene can move/);
  assert.match(renderAuthoring, /storyDynamicsPlaceholder\(state\.data\)/);
  assert.doesNotMatch(renderAuthoring, /saved position\/rotation\/scale, and model instance counts are locked/,
    "the default panel omits the long internal lock description");
  assert.match(renderAuthoring, />Apply motion</);
  assert.match(bind, /state\.proceduralDynamicsUi\.promptsByScene\[sceneKey\] = prompt\.value/);
  assert.match(bind, /delete state\.proceduralDynamicsUi\.statusByScene\[sceneKey\]/);
  assert.match(bind, /delete state\.proceduralDynamicsUi\.errorsByScene\[sceneKey\]/);
  assert.match(generate, /api\.post\("\/api\/dynamics\/generate", \{\s*sceneContext: scope,\s*prompt,/s);
  assert.match(generate, /previousPlan/);
  assert.match(generate, /previousCandidate/);
  assert.match(generate, /proceduralDynamicsCandidateFromResponse\(response\)/);
  assert.match(generate, /state\.proceduralDynamicsUi\.candidatesByScene\[sceneKey\] = candidate/,
    "generation preserves the validated canonical candidate for revision-safe Apply");
  assert.match(generate, /response\?\.engine\?\.provider === "deterministic-fallback"/,
    "the UI discloses when a safe local fallback produced the candidate");
  assert.doesNotMatch(generate, /\/api\/dynamics\/apply/,
    "generation cannot persist a candidate implicitly");
  assert.match(styles, /\.procedural-dynamics-authoring\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /\.procedural-dynamics-prompt textarea\s*\{[^}]*resize:\s*vertical/s);
  assert.match(styles, /\.procedural-dynamics-message\.error\s*\{[^}]*color:\s*var\(--danger\)/s);
});

test("generated Dynamics shows a motion-only impact preview with immutable scene inputs", () => {
  const motionPlan = sourceFunction("proceduralDynamicsCandidateMotionPlan");
  const impact = sourceFunction("renderProceduralDynamicsCandidateImpact");
  const renderAuthoring = sourceFunction("renderProceduralDynamicsAuthoring");

  assert.match(motionPlan, /candidate\.scenePatch\?\.motionPlan/,
    "the v3 motion-only candidate drives the active preview");
  assert.match(impact, /Motion-only preview/);
  assert.match(impact, /Saved scene inputs stay locked/);
  assert.match(impact, /Assets, transforms &amp; count locked/);
  assert.match(impact, /Locked scene inputs/);
  assert.match(impact, /cannot add, remove, replace, hide, resize, or rewrite any saved position, rotation, or scale/);
  assert.match(impact, /Generated motion/);
  assert.match(impact, /existing model instance/);
  assert.match(impact, /checkpointsMadeDraft/);
  assert.match(impact, /checkpointsMadeStale/);
  assert.match(impact, /not materially different/);
  assert.match(impact, /Prompt requirements not yet met/);
  assert.match(renderAuthoring, /renderProceduralDynamicsCandidateImpact\(candidate, sceneContext\)/);
  assert.match(renderAuthoring, />Apply motion</);
  assert.match(renderAuthoring, /candidateHasUnmetRequirements/);
  assert.match(renderAuthoring, /candidateLacksMaterialChange/);
  assert.match(styles, /\.procedural-dynamics-impact\s*\{[^}]*display:\s*grid/s);
});

test("generated Dynamics apply and removal are revisioned history actions", () => {
  const expectedRevision = sourceFunction("proceduralDynamicsExpectedRevision");
  const apply = sourceFunction("applyProceduralDynamicsCandidate");
  const refreshAfterApply = sourceFunction("refreshAfterProceduralDynamicsApply");
  const remove = sourceFunction("removeProceduralDynamicsPlan");

  assert.match(expectedRevision, /expectedRevisionsByScene\[sceneKey\]/);
  assert.match(expectedRevision, /state\.data\?\.proceduralDynamics\?\.revision/);
  assert.match(apply, /withAuthorHistory\("Apply generated Dynamics motion"/);
  assert.match(apply, /api\.post\("\/api\/dynamics\/apply", \{/);
  assert.match(apply, /sceneContext: scope/);
  assert.match(apply, /expectedRevision: proceduralDynamicsExpectedRevision\(sceneContext\)/);
  assert.match(apply, /\bcandidate,/);
  assert.doesNotMatch(apply, /plan: candidate/);
  assert.match(apply, /proceduralDynamicsComparablePrompt\(proceduralDynamicsCandidatePrompt\(candidate\)\)/,
    "a changed description cannot apply an older candidate");
  assert.match(apply, /refreshAfterProceduralDynamicsApply\(response\)/);
  assert.match(apply, /persistent: true/);
  assert.match(refreshAfterApply, /preservedGraphDirty/);
  assert.match(refreshAfterApply, /preservedSpatialDirty/);
  assert.match(refreshAfterApply, /preservedSourceMotionDirty/);
  assert.match(refreshAfterApply, /await api\.get\("\/api\/state"\)/);
  assert.match(refreshAfterApply, /state\.data\.graph = preservedGraph/);
  assert.match(refreshAfterApply, /state\.spatialRelationsDraft = preservedSpatialDraft/);
  assert.doesNotMatch(refreshAfterApply, /applyProceduralDynamicsAssetLinksToGraph|replaceProceduralDynamicsSpatialScene|mergeUnrelatedProceduralDynamicsSpatialDraft/,
    "motion Apply never merges generated graph or Spatial state");
  assert.match(remove, /withAuthorHistory\("Remove generated Dynamics motion"/);
  assert.match(remove, /api\.post\("\/api\/dynamics\/remove", \{/);
  assert.match(remove, /sceneContext: scope/);
  assert.match(remove, /expectedRevision: Number\(state\.data\?\.proceduralDynamics\?\.revision\) \|\| 0/);
  assert.match(remove, /state\.data\.proceduralDynamics = response\.proceduralDynamics/);
  assert.match(remove, /Source GLB animation mappings are unchanged/);
});

test("applied generated motion makes Dynamics locally draft until the canvas checkpoint is saved", () => {
  const localDraft = sourceFunction("checkpointHasLocalDraft");
  const changed = sourceFunction("proceduralDynamicsCheckpointHasUnsavedChanges");
  const close = sourceFunction("closeDynamicSceneEditor");

  assert.match(localDraft, /componentId === "dynamic-geometry" && proceduralDynamicsCheckpointHasUnsavedChanges\(\)/);
  assert.match(changed, /proceduralDynamics\?\.revision/);
  assert.match(changed, /decisions\?\.\["dynamic-geometry"\]\?\.proceduralDynamicsRevision/);
  assert.match(close, /await refresh\(false\)/,
    "closing reloads the server-side Draft and downstream-stale decision states after preserving motion-link edits");
  assert.match(close, /Save the Dynamics checkpoint on the Story Canvas/);
});

test("the author preview binds motion to existing authored entities without cloning or resizing", () => {
  const preview = sourceFunction("renderDynamicPreview");
  const initialize = sourceFunction("initializeDynamicGeometryViewer");
  const attach = sourceFunction("attachProceduralDynamicsPreviewMotion");
  const animate = sourceFunction("animateDynamicGeometry");
  const animateGenerated = sourceFunction("animateProceduralDynamicsPreview");
  const transform = sourceFunction("applyProceduralDynamicsPreviewTransform");
  const dispose = sourceFunction("disposeProceduralDynamicsPreview");

  assert.match(preview, /activeProceduralDynamicsPlan\(sceneContext\)/);
  assert.match(preview, /hasPlayback = hasSourceAnimation \|\| hasProceduralMotion/);
  assert.match(preview, /moves the existing placed models without changing their saved transform, size, or count/);
  assert.match(preview, /data-dynamic-play/);
  assert.match(initialize, /activeProceduralDynamicsPlan\(sceneContext\)/);
  assert.match(initialize, /expandProceduralDynamicsInstances\(proceduralPlan, \{ xrPresenting: true \}\)/,
    "the author preview uses the shared one-assignment-per-entity runtime");
  assert.match(initialize, /proceduralDynamicsReaderAnchorForScene\(sceneContext\)/,
    "generated paths use the saved reader pose");
  assert.match(initialize, /dynamicSceneAssetLinks\(proposal, \[beat\], sceneContext\)/,
    "generated preview instances can only originate from the selected beat or variant assets");
  assert.match(initialize, /playing: \(hasSourceAnimation \|\| hasProceduralMotion\)/);
  assert.match(attach, /proceduralDynamicsInstanceEntityId\(candidate\) === entityId/);
  assert.match(attach, /viewer\.proceduralAssignedEntityIds\.has\(entityId\)/);
  assert.match(attach, /const motionRoot = new THREE\.Group\(\)/);
  assert.match(attach, /motionRoot\.add\(authoredRoot\)/);
  assert.match(attach, /dynamicEntry\.proceduralInstance = instance/);
  assert.doesNotMatch(attach, /cloneSkinnedObject|normalizeTopologyObject|authorWrapper\.visible = false/);
  assert.doesNotMatch(source, /function createProceduralDynamicsCloneEntry/);
  assert.match(transform, /sampleProceduralDynamicsTransform\(instance, elapsedSeconds\)/);
  assert.match(transform, /motionRoot\.position\.fromArray\(position\)\.add\(entry\.proceduralAnchorPosition\)/,
    "only the temporary motion root receives path offsets");
  assert.match(transform, /motionRoot\.quaternion\.slerp\(entry\.proceduralTargetQuaternion, blend\)/,
    "the author preview applies the same smoothed path-tangent orientation as the WebXR reader");
  assert.doesNotMatch(transform, /\.scale\./);
  assert.match(animate, /item\.spatialTransformApplied \? 1/,
    "the Dynamics animation loop cannot add a preview-only scale to a saved Spatial transform");
  assert.match(animate, /animateProceduralDynamicsPreview\(viewer, time\)/);
  assert.match(animateGenerated, /applyProceduralDynamicsPreviewTransform\(item, time, deltaSeconds\)/);
  assert.match(animateGenerated, /proceduralAnimationPhase01/,
    "existing targets retain deterministic embedded-animation phases");
  assert.match(dispose, /motionRoot\.remove\(authoredRoot\)/);
  assert.match(dispose, /originalParent\.add\(authoredRoot\)/);
  assert.doesNotMatch(dispose, /disposeObject|skeleton|geometry\.dispose/);
});

test("Dynamics uses ordinary Source Graph links and has no generated asset override path", () => {
  const sceneBeat = sourceFunction("spatialSceneBeat");
  const sceneAssetIds = sourceFunction("spatialSceneLinkedAssetIds");
  const refreshAfterApply = sourceFunction("refreshAfterProceduralDynamicsApply");

  assert.match(sceneBeat, /linkedAssetIds: variantOptionAssetIds\(option\)/);
  assert.match(sceneAssetIds, /return option \? variantOptionAssetIds\(option\) : beatAssetIds\(beat\)/);
  assert.doesNotMatch(source, /manualSceneAssetLinks|manualSceneAssetIdsForContext|generated-dynamics/);
  assert.match(refreshAfterApply, /state\.data\.graph = preservedGraph/,
    "a dirty Source Graph draft is preserved verbatim because Dynamics has no graph output to merge");
});
