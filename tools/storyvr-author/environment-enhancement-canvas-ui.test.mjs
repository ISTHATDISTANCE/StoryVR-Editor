import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");
const readerSource = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

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

test("Environment Enhancement gets the single-workspace shell and a canvas-only landing page", () => {
  const render = sourceFunction("render");
  const canvas = sourceFunction("renderEnvironmentEnhancementCanvasWorkspace");

  assert.match(render, /const isEnvironmentEnhancement = active\.id === "environment-enhancement"/);
  assert.match(render, /const showSidebar = [^\n]*!isEnvironmentEnhancement/);
  assert.match(render, /showSidebar \? "authoring-layout" : "single-workspace-layout"/);
  assert.match(canvas, /data-environment-workspace-mode="canvas"/);
  assert.match(canvas, /renderEnvironmentStoryCanvas\(\)/);
  assert.doesNotMatch(canvas, /environment-enhancement-workbench|environment-catalog|environment-preview-card|environment-inspector/);
  assert.doesNotMatch(canvas, /Find a real setting|Public 360° images|data-environment-search-form/);
  assert.match(styles, /\.environment-canvas-mode\s*\{[^}]*width:\s*100%/s);
});

test("Environment Enhancement branches from the story canvas into the existing setting editor", () => {
  const workspace = sourceFunction("renderEnvironmentEnhancementWorkspace");
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");

  assert.match(workspace, /const sceneContext = activeEnvironmentSceneContext\(\)/);
  assert.match(workspace, /if \(!sceneContext\) return renderEnvironmentEnhancementCanvasWorkspace\(component\)/);
  assert.match(workspace, /renderEnvironmentEnhancementEditorWorkspace\(component, sceneContext\)/);
  assert.match(editor, /data-environment-workspace-mode="editor"/);
  assert.match(editor, /Find or create a setting/);
  assert.match(editor, /data-environment-search-form/);
  assert.match(editor, /data-environment-generation-form/);
  assert.match(editor, /data-environment-upload-form/);
  assert.match(editor, /data-environment-viewer/);
});

test("the setting catalog switches between mounted Search and Generate panels without rebuilding the viewer", () => {
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");
  const events = sourceFunction("bindEnvironmentEnhancementEvents");
  const bindTabs = sourceFunction("bindEnvironmentAcquisitionTabs");
  const setMode = sourceFunction("setEnvironmentAcquisitionMode");

  assert.match(editor, /role="tablist"/);
  assert.match(editor, /data-environment-acquisition-tab="search"/);
  assert.match(editor, /data-environment-acquisition-tab="generate"/);
  assert.match(editor, /aria-controls="environment-search-panel"/);
  assert.match(editor, /aria-controls="environment-generate-panel"/);
  assert.match(editor, /role="tabpanel"/);
  assert.match(editor, /data-environment-acquisition-panel="search"/);
  assert.match(editor, /data-environment-acquisition-panel="generate"/);
  assert.match(editor, /acquisitionMode === "search" \? "" : "hidden"/);
  assert.match(editor, /acquisitionMode === "generate" \? "" : "hidden"/);
  assert.match(events, /bindEnvironmentAcquisitionTabs\(\)/);
  assert.match(bindTabs, /ArrowRight/);
  assert.match(bindTabs, /ArrowLeft/);
  assert.match(bindTabs, /Home/);
  assert.match(bindTabs, /End/);
  assert.match(setMode, /panel\.hidden = panel\.dataset\.environmentAcquisitionPanel !== mode/);
  assert.match(setMode, /aria-selected/);
  assert.doesNotMatch(setMode, /\brender\s*\(/, "tab changes preserve the mounted viewer and file input");
  assert.match(styles, /\.environment-acquisition-panel\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.environment-acquisition-tabs \[role="tab"\]\[aria-selected="true"\]/);
});

test("Generate creates a panorama and matching ground through Codex for only the active beat", () => {
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");
  const generate = sourceFunction("generateEnvironmentFromUi");
  const prompt = sourceFunction("environmentGenerationPrompt");
  const recommendation = sourceFunction("adoptEnvironmentGenerationRecommendation");
  const availability = sourceFunction("updateEnvironmentActionAvailability");

  assert.match(editor, /signed-in Codex CLI session/);
  assert.match(editor, /built-in image generation tool/);
  assert.match(editor, /360° surrounding and matching ground/);
  assert.match(editor, /2:1 equirectangular LDR PNG plus its matching ground texture/);
  assert.match(editor, /Generated PNG · 360° \+ ground/);
  assert.match(editor, /id="environment-generation-prompt"/);
  assert.match(editor, /data-environment-generate-button/);
  assert.match(editor, /data-environment-generation-status/);
  assert.match(editor, /aria-live="polite"/);
  assert.match(editor, /2:1 equirectangular LDR PNG/);
  assert.match(prompt, /environmentManifest\(\)\.brief\?\.query/);
  assert.match(recommendation, /generationPromptOrigin === "author"/);
  assert.match(recommendation, /state\.environmentUi\.generationPrompt = prompt/);
  assert.match(generate, /withAuthorHistory\("Generate environment image"/);
  assert.match(generate, /persistent:\s*true/);
  assert.match(generate, /componentId:\s*"environment-enhancement"/);
  assert.match(generate, /const sceneContext = activeEnvironmentSceneContext\(\)/);
  assert.match(generate, /api\.post\("\/api\/environment-enhancement\/generate", \{[\s\S]*prompt,[\s\S]*beatId: sceneContext\.beatId/);
  assert.match(generate, /applyEnvironmentEnhancementPayload\(response, \{ resetDraft: true \}\)/);
  assert.match(generate, /state\.environmentUi\.selectionMode = "asset"/);
  assert.match(generate, /generationStatus = "Codex is generating/);
  assert.match(availability, /\[data-environment-generate-button\]/);
  assert.match(availability, /!String\(generationInput\?\.value \?\? environmentGenerationPrompt\(\)\)\.trim\(\)/);
  assert.match(styles, /\.environment-generation-form textarea\s*\{[^}]*resize:\s*vertical;/s);
  assert.match(styles, /\.environment-generation-status\.error/);
});

test("upload reports automatic matching-ground generation before installing the paired draft", () => {
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");
  const selection = sourceFunction("updateEnvironmentUploadSelection");
  const upload = sourceFunction("uploadEnvironmentFromUi");

  assert.match(editor, /Upload, generate ground &amp; preview/);
  assert.match(editor, /sends the uploaded panorama to your signed-in Codex CLI as a visual reference for its matching near-ground texture/);
  assert.match(selection, /ready to upload and generate its matching ground/);
  assert.match(upload, /Uploading \$\{file\.name\} and generating its matching ground/);
  assert.match(upload, /beatId: sceneContext\.beatId/);
  assert.match(upload, /api\.upload\(`\/api\/environment-enhancement\/upload\?\$\{params\}`, file\)/);
  assert.match(upload, /applyEnvironmentEnhancementPayload\(response, \{ resetDraft: true \}\)/);
  assert.match(upload, /matching generated ground are ready for inspection/);
});

test("beat-scoped manifests prefer an explicit assignment, then the default, otherwise neutral", () => {
  const assignment = sourceFunction("environmentAssignmentForContext");
  const skipped = sourceFunction("environmentEnhancementSkipped");
  const manifest = sourceFunction("environmentManifest");
  const card = sourceFunction("renderEnvironmentStoryCard");
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");
  const applyNavigation = sourceFunction("applyStoryvrBrowserNavigation");

  assert.match(assignment, /raw\.assignmentsByBeat/);
  assert.match(assignment, /Object\.prototype\.hasOwnProperty\.call\(assignments, beatId\)/,
    "an explicit null beat assignment overrides a legacy default with neutral");
  assert.match(assignment, /raw\.defaultAssignment/);
  assert.match(skipped, /if \(!assignment\) return true/);
  assert.match(manifest, /environmentAssignmentForContext\(context\)/);
  assert.match(manifest, /assigned: Boolean\(assignment\)/);
  assert.match(card, /environmentManifest\(context\)/);
  assert.match(editor, /environmentManifest\(sceneContext\)/);
  assert.match(applyNavigation, /state\.environmentUi\.selectionMode = null/);
  assert.match(applyNavigation, /state\.environmentUi\.draft = null/);
  assert.match(applyNavigation, /syncEnvironmentUiFromState\(\{ resetDraft: true \}\)/);
});

test("checkpoint saving has no legal acknowledgement gate", () => {
  const inspector = sourceFunction("renderEnvironmentInspector");
  const readiness = sourceFunction("environmentCheckpointAssignmentsReady");
  const draft = sourceFunction("saveEnvironmentDraft");
  const save = sourceFunction("handleEnvironmentCheckpointAction");

  assert.doesNotMatch(inspector, /data-environment-[^"]*confirmation|I confirm that this asset/i);
  assert.doesNotMatch(styles, /\.environment-[^{]*confirmation/i);
  assert.doesNotMatch(readiness, /confirm/i);
  assert.doesNotMatch(draft, /confirmation/i);
  assert.doesNotMatch(save, /confirm/i);
  const retiredClientTokens = new RegExp([
    ["rights", "Confirmation"].join(""),
    ["rights", "Confirmed"].join(""),
    ["environment-rights", "confirmation"].join("-"),
    ["Confirm that you have the", "rights to use this environment asset"].join(" "),
  ].join("|"), "i");
  assert.doesNotMatch(source, retiredClientTokens);
  assert.doesNotMatch(styles, retiredClientTokens);
  assert.match(readiness, /Boolean\(manifest\.asset\)/);
  assert.match(readiness, /environmentSourceAwaitingUpload\(manifest\)/);
});

test("downstream checkpoint previews resolve the locked environment for their current beat", () => {
  const resolve = sourceFunction("environmentEnhancementContractForBeat");
  const locked = sourceFunction("lockedEnvironmentPreviewContract");
  const attach = sourceFunction("attachLockedEnvironmentToViewer");

  assert.match(resolve, /ENVIRONMENT_ENHANCEMENT_ASSIGNMENTS_SCHEMA_VERSION/);
  assert.match(resolve, /Object\.prototype\.hasOwnProperty\.call\(assignments, normalizedBeatId\)/,
    "an explicit null assignment keeps that downstream beat neutral");
  assert.match(resolve, /contract\.defaultEnvironment/,
    "unassigned legacy beats still inherit the saved default environment");
  assert.match(locked, /viewer\?\.sceneContext\?\.beatId \|\| viewer\?\.beat\?\.id/,
    "each preview identifies the beat it is currently rendering");
  assert.match(locked, /environmentManifest\(beatId \? spatialSceneContext\(beatId\) : null\)/,
    "decorated local asset URLs are resolved for the same beat");
  assert.match(locked, /environmentEnhancementContractForBeat\(decisionBundle, beatId\)/);
  assert.match(locked, /if \(decisionBundle && !decisionContract\) return null/,
    "an explicit neutral assignment cannot fall through to another beat's image");
  assert.match(attach, /lockedEnvironmentPreviewContract\(viewer\)/);
  assert.doesNotMatch(attach, /environmentManifest\(\)\.asset/,
    "the loader does not fall back to the Environment editor's active or default beat");
});

test("environment mutations carry the active beat and neutral selection persists through draft PATCH", () => {
  const sourceSelection = sourceFunction("selectEnvironmentSource");
  const upload = sourceFunction("uploadEnvironmentFromUi");
  const draft = sourceFunction("saveEnvironmentDraft");
  const selectionMode = sourceFunction("selectEnvironmentMode");
  const save = sourceFunction("handleEnvironmentCheckpointAction");
  const canvas = sourceFunction("renderEnvironmentEnhancementCanvasWorkspace");

  assert.match(sourceSelection, /candidateId,[\s\S]*beatId: sceneContext\.beatId/);
  assert.match(upload, /new URLSearchParams\(\{[\s\S]*filename: file\.name,[\s\S]*beatId: sceneContext\.beatId/);
  assert.match(draft, /beatId: sceneContext\.beatId/);
  assert.match(draft, /skipped: state\.environmentUi\.selectionMode === "none"/);
  assert.doesNotMatch(draft, /!environmentManifest\(\)\.asset/,
    "neutral selection can still persist after the visible manifest hides its retained asset");
  assert.match(selectionMode, /markEnvironmentDraftDirty\(\)/);
  assert.match(save, /api\.post\("\/api\/environment-enhancement\/save"\)/);
  assert.doesNotMatch(save, /save-none/);
  assert.match(canvas, /environmentCheckpointAssignmentsReady\(\)/);
});

test("the current environment can be reused on selected other beats without regenerating", () => {
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");
  const renderTargets = sourceFunction("renderEnvironmentApplyTargets");
  const targetBeats = sourceFunction("environmentApplyTargetBeats");
  const events = sourceFunction("bindEnvironmentApplyTargetEvents");
  const sync = sourceFunction("syncEnvironmentApplyTargetControls");
  const apply = sourceFunction("applyEnvironmentToSelectedBeats");

  assert.match(editor, /renderEnvironmentApplyTargets\(sceneContext, manifest, controlsDisabled\)/);
  assert.match(renderTargets, /Apply to other beats…/);
  assert.match(renderTargets, /Select all other beats/);
  assert.match(renderTargets, /data-environment-apply-target=/);
  assert.match(renderTargets, /Apply to selected beats/);
  assert.match(renderTargets, /without generating new images/);
  assert.match(targetBeats, /spatialPreviewBeats\(\)/);
  assert.match(targetBeats, /\.filter\(\(beat\) => beat\.id !== activeBeatId\)/);
  assert.doesNotMatch(targetBeats, /variantGroupForBeat|variantOptionId/,
    "the reuse list contains authored beats rather than variant rows");
  assert.match(events, /data-environment-apply-select-all/);
  assert.match(events, /environmentApplyTargetBeats\(\)\.map\(\(beat\) => beat\.id\)/);
  assert.match(sync, /selectAll\.indeterminate = selectedIds\.size > 0 && selectedIds\.size < otherBeats\.length/);
  assert.match(apply, /await flushEnvironmentDraft\(\)/);
  assert.match(apply, /api\.post\("\/api\/environment-enhancement\/apply", \{/);
  assert.match(apply, /sourceBeatId: sceneContext\.beatId/);
  assert.match(apply, /targetBeatIds/);
  assert.match(apply, /expectedRevision: Number\(environmentRawState\(\)\.revision\) \|\| 0/);
  assert.match(styles, /\.environment-apply-target-panel\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.environment-apply-target-list\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.environment-apply-target-row\.selected/);
});

test("the setting editor saves and previews the generated world-fixed matching ground", () => {
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");
  const manifest = sourceFunction("environmentManifest");
  const draftFromManifest = sourceFunction("environmentDraftFromManifest");
  const draftFromControls = sourceFunction("environmentDraftFromControls");
  const updateOutputs = sourceFunction("updateEnvironmentTuningOutputs");
  const apply = sourceFunction("applyEnvironmentDraftToViewer");
  const syncCue = sourceFunction("syncEnvironmentGroundMovementCue");
  const textureUrl = sourceFunction("environmentGroundTextureUrl");
  const dispose = sourceFunction("disposeContextLayeringViewer");

  assert.match(source, /createGroundMovementCue,[\s\S]*normalizeGroundMovementCue,[\s\S]*from "\.\.\/\.\.\/ground-movement-cue\.js"/);
  assert.match(editor, /Matching ground/);
  assert.match(editor, /Auto-generated near-ground geometry/);
  assert.match(editor, /matchingGroundReady/);
  assert.match(editor, /<details class="environment-adjustment-panel environment-surrounding-tuning-panel">/);
  assert.match(editor, /<details class="environment-adjustment-panel environment-ground-cue-controls"/);
  assert.match(editor, /data-environment-draft-control="movement-cue-enabled"/);
  assert.match(editor, /renderEnvironmentRangeControl\("movement-cue-opacity"/);
  assert.match(editor, /data-environment-ground-cue-summary/);
  assert.match(editor, /renderEnvironmentRangeControl\("movement-cue-position-x"/);
  assert.match(editor, /renderEnvironmentRangeControl\("movement-cue-position-z"/);
  assert.match(editor, /renderEnvironmentRangeControl\("movement-cue-width"/);
  assert.match(editor, /renderEnvironmentRangeControl\("movement-cue-depth"/);
  assert.match(editor, /renderEnvironmentRangeControl\("movement-cue-width", "Width", draft\.movementCue\.widthMeters, 0\.1, 200/);
  assert.match(editor, /renderEnvironmentRangeControl\("movement-cue-depth", "Depth", draft\.movementCue\.depthMeters, 0\.1, 200/);
  assert.match(manifest, /movementCue:\s*skipped \? null : draft\.movementCue \|\| selection\.movementCue \|\| source\.movementCue/);
  assert.match(draftFromManifest, /movementCue:\s*normalizeGroundMovementCue\(manifest\?\.movementCue\)/);
  assert.match(draftFromControls, /const currentMovementCue = normalizeGroundMovementCue\(environmentDraft\(\)\.movementCue\)/);
  assert.match(draftFromControls, /\.\.\.currentMovementCue/);
  assert.match(draftFromControls, /opacity:\s*value\("movement-cue-opacity", currentMovementCue\.opacity\)/);
  assert.match(updateOutputs, /groundCueSummary\.textContent = controls\.movementCue\.texture/);
  assert.match(draftFromControls, /currentMovementCue\.position\[1\]/,
    "controls preserve normalized Y and the non-visible movement-cue values");
  assert.match(apply, /environmentEnhancementSkipped\(\) \? null : draft\.movementCue,[\s\S]*draft\.transform\.rotationY/);
  assert.match(syncCue, /normalizeGroundMovementCue\(\{ \.\.\.movementCue, rotationY \}\)/);
  assert.match(syncCue, /viewer\.groundMovementCue\.update\(normalized, \{ textureUrl \}\)/);
  assert.match(syncCue, /createGroundMovementCue\(normalized, \{[\s\S]*renderer: viewer\.renderer,[\s\S]*textureUrl/);
  assert.match(textureUrl, /texture\.localUrl \|\| texture\.localPath/);
  assert.match(syncCue, /viewer\.scene\.add\(viewer\.groundMovementCue\.mesh\)/,
    "the cue belongs to the scene, not the panorama or XR camera hierarchy");
  assert.match(dispose, /contextViewer\.groundMovementCue\?\.dispose\?\.\(\)/);
  assert.match(styles, /\.environment-adjustment-panel\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.environment-ground-cue-content\s*\{[^}]*display:\s*grid;/s);
});

test("the spatial editor consumes the flexible desktop column", () => {
  const workbench = styles.match(/\.environment-enhancement-workbench\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(
    workbench,
    /grid-template-columns:\s*minmax\(280px,\s*340px\)\s+minmax\(520px,\s*1fr\)/,
    "the editor gets every desktop column to the right of the setting catalog",
  );
  assert.doesNotMatch(
    workbench,
    /minmax\(270px,\s*320px\)/,
    "no separate inspector column reserves blank space beside the editor",
  );
  assert.match(
    styles,
    /\.environment-inspector\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*max-height:\s*none/s,
    "supporting evidence moves below the full-width editor row",
  );
});

test("beat and variant cards open the editor with their complete scene context", () => {
  const beat = sourceFunction("renderEnvironmentStoryBeat");
  const card = sourceFunction("renderEnvironmentStoryCard");
  const events = sourceFunction("bindEnvironmentEnhancementEvents");

  assert.match(beat, /sourceGraphDefaultVariantOption\(group\)/);
  assert.match(beat, /renderEnvironmentStoryCard\(beat, defaultOption, primaryContext/);
  assert.match(beat, /spatialSceneContext\(beat\.id, group\.id, option\.id\)/);
  assert.match(card, /data-environment-open-scene/);
  assert.match(card, /data-environment-beat-id=/);
  assert.match(card, /data-environment-variant-group-id=/);
  assert.match(card, /data-environment-variant-option-id=/);
  assert.match(card, /environmentSpatialScenePreview\(context\)/);
  assert.match(card, /environmentSourceLinkedFallbackAssetIds\(context\)/,
    "card counts use the same source-linked fallback as the editor");
  assert.match(events, /openEnvironmentSceneEditor\(\{/);
  assert.match(events, /beatId:\s*button\.dataset\.environmentBeatId/);
  assert.match(events, /variantGroupId:\s*button\.dataset\.environmentVariantGroupId/);
  assert.match(events, /variantOptionId:\s*button\.dataset\.environmentVariantOptionId/);
});

test("Environment editors use URL-backed history and Close flushes before returning to the canvas", () => {
  const open = sourceFunction("openEnvironmentSceneEditor");
  const close = sourceFunction("closeEnvironmentSceneEditor");
  const applyNavigation = sourceFunction("applyStoryvrBrowserNavigation");
  const popNavigation = sourceFunction("applyStoryvrPopNavigation");
  const returnToCanvas = sourceFunction("returnToEnvironmentCanvasWithBrowserHistory");

  assert.match(open, /pushStoryvrBrowserNavigation/);
  assert.match(open, /createStoryvrNavigationRoute\("environment-enhancement", normalized\)/);
  assert.match(open, /parentEntryId:\s*currentEntry\?\.entryId/);
  assert.match(applyNavigation, /navigation\.componentId === "environment-enhancement"/);
  assert.match(applyNavigation, /\[data-environment-story-canvas-viewport\]/);
  assert.match(applyNavigation, /state\.environmentCanvasReturnScroll = \{/);
  assert.match(applyNavigation, /state\.environmentEditorScene = navigation\.editorScene/);
  assert.match(popNavigation, /previousNavigation\.componentId === "environment-enhancement"/);
  assert.match(popNavigation, /state\.environmentUi\.draftDirty/);
  assert.match(popNavigation, /await flushEnvironmentDraft\(\)/);

  assert.match(close, /await historyFinalizePromise/);
  assert.match(close, /await flushEnvironmentDraft\(\)/);
  assert.ok(close.indexOf("await flushEnvironmentDraft()") < close.indexOf("returnToEnvironmentCanvasWithBrowserHistory()"));
  assert.doesNotMatch(close, /state\.environmentEditorScene = null/);
  assert.match(returnToCanvas, /window\.history\.back\(\)/);
  assert.match(returnToCanvas, /replaceStoryvrBrowserNavigation\(canvasNavigation\)/);
  assert.match(close, /catch \(error\)[\s\S]*Environment save failed/);
});

test("the environment editor loads only the active Spatial Relations scene", () => {
  const previewContract = sourceFunction("environmentSpatialRelationsPreview");
  const renderableEntities = sourceFunction("environmentSpatialRenderableEntities");
  const scenePreview = sourceFunction("environmentSpatialScenePreview");
  const assets = sourceFunction("environmentPreviewStoryAssets");
  const loader = sourceFunction("loadEnvironmentPreviewStoryAssets");
  const initializer = sourceFunction("initializeEnvironmentEnhancementViewer");

  assert.match(previewContract, /lockedSpatialRelationsContract\(\)/);
  assert.match(previewContract, /decision\?\.option\?\.spatialRelations/);
  assert.match(assets, /activeEnvironmentSceneContext\(\)/);
  assert.match(assets, /environmentSpatialScenePreview\(context\)/);
  assert.match(scenePreview, /spatialSceneRecordForContext\(relations\.contract, context\)/);
  assert.match(scenePreview, /usesSourceFallback = !scene && !entities\.length/,
    "an explicitly empty saved scene remains empty instead of falling back to source assets");
  assert.match(assets, /spatialPreview\.state !== "source-linked fallback"/);
  assert.match(assets, /environmentSourceLinkedFallbackAssetIds\(context\)/);
  assert.match(renderableEntities, /spatialEditorSceneEntities\(contract, context\)/);
  assert.match(renderableEntities, /!linkedAssetIds\.size \|\| linkedAssetIds\.has\(entity\.assetId\)/,
    "scene-linked asset ids filter orphaned scene entities like the reader");
  assert.doesNotMatch(assets, /state\.data\.decisions\?\.\["asset-topology"\]/);
  assert.doesNotMatch(assets, /for \(const beat of state\.data\.graph\?\.beats/);
  assert.match(loader, /environmentPreviewStoryAssets\(\)/);
  assert.match(loader, /environmentSpatialScenePreview\(context\)/);
  assert.match(loader, /const spatialScene = spatialPreview\.scene/);
  assert.match(loader, /spatialEditorSceneEntities\(spatialContract, context\)/);
  assert.match(loader, /applySpatialEntityTransformToObject\(viewer, entry\.entity, wrapper\)/);
  assert.match(loader, /toneMapped:\s*false/,
    "image-plane exposure matches the compiled reader");
  assert.doesNotMatch(loader, /makeSpatialEditorFloorGuide/,
    "the reader-faithful environment preview does not add editor-only floor geometry");
  assert.match(initializer, /loadEnvironmentPreviewStoryAssets\(viewer, status\)/);
});

test("Environment Enhancement WebXR starts at the authored reader station", () => {
  const initializer = sourceFunction("initializeEnvironmentEnhancementViewer");
  const capture = sourceFunction("captureEnvironmentXrEntryPose");
  const align = sourceFunction("alignEnvironmentXrEntryPose");

  assert.match(initializer, /xrViewerRig\.add\(camera\)/);
  assert.match(initializer, /renderer\.xr\.addEventListener\("sessionstart", viewer\.xrSessionStartHandler\)/);
  assert.match(initializer, /alignEnvironmentXrEntryPose\(viewer, xrFrame\)/);
  assert.match(capture, /viewer\.readerRig\.getWorldPosition\(viewer\.xrEntryWorldPosition\)/);
  assert.match(capture, /viewer\.readerRig\.getWorldQuaternion\(viewer\.xrEntryWorldQuaternion\)/);
  assert.match(align, /xrFrame\.getViewerPose\(referenceSpace\)/);
  assert.match(align, /viewer\.xrViewerRig\.position\.copy\(viewer\.xrEntryWorldPosition\)\.sub\(viewer\.xrEntryLocalPosition\)/);
});

test("HDR, EXR, and generated PNG card backdrops and editor backgrounds follow the reader rendering contract", () => {
  const card = sourceFunction("renderEnvironmentStoryCard");
  const previews = sourceFunction("initializeEnvironmentStoryCanvasPreviews");
  const editorLoader = sourceFunction("loadEnvironmentPreviewAsset");
  const editorApply = sourceFunction("applyEnvironmentDraftToViewer");
  const readerLoader = sourceFunction("loadRuntimeEnvironmentEnhancement", readerSource);
  const readerApply = sourceFunction("applyRuntimeEnvironmentEnhancement", readerSource);

  assert.match(card, /data-environment-card-backdrop/);
  assert.doesNotMatch(card, /background-image|asset\?\.localUrl|asset\.localUrl/,
    "HDR and EXR files are not assigned directly to CSS backgrounds");
  assert.match(previews, /const manifest = environmentManifest\(context\)/);
  assert.match(previews, /manifest\.asset\.localUrl/);
  assert.match(previews, /new EXRLoader\(\)/);
  assert.match(previews, /new HDRLoader\(\)/);
  assert.match(previews, /new THREE\.TextureLoader\(\)/);
  assert.match(previews, /ENVIRONMENT_PNG_MEDIA_TYPES\.has\(pending\.mediaType\)/);
  assert.match(previews, /texture\.colorSpace = THREE\.SRGBColorSpace/);
  assert.match(previews, /THREE\.EquirectangularReflectionMapping/);
  assert.match(previews, /scene\.background = texture/);
  assert.match(previews, /toneMappingExposure/);
  assert.match(previews, /backgroundRotation/);
  assert.match(previews, /renderer\.domElement\.toDataURL\(/);
  assert.match(previews, /data-environment-card-backdrop/);
  assert.match(styles, /\.environment-story-beat-card\s*\{[^}]*position:\s*relative;/s);
  assert.match(styles, /\.environment-story-beat-card\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.environment-story-card-backdrop\s*\{[^}]*position:\s*absolute;/s);
  assert.match(styles, /\.environment-story-card-backdrop\s*\{[^}]*inset:\s*0;/s);
  assert.match(styles, /\.environment-story-card-backdrop\s*\{[^}]*background-size:\s*cover;/s);
  assert.match(styles, /\.environment-story-card-content\s*\{[^}]*position:\s*relative;/s);
  assert.match(styles, /\.environment-story-card-content\s*\{[^}]*z-index:\s*[1-9]/s);

  assert.match(editorLoader, /ENVIRONMENT_PNG_MEDIA_TYPES\.has\(mediaType\)/);
  assert.match(editorLoader, /\? viewer\.textureLoader/);
  assert.match(editorLoader, /texture\.colorSpace = THREE\.SRGBColorSpace/);
  assert.match(editorLoader, /texture\.mapping = THREE\.EquirectangularReflectionMapping/);
  assert.match(editorApply, /viewer\.renderer\.toneMappingExposure = draft\.rendering\.exposure/);
  assert.match(editorApply, /viewer\.scene\.backgroundRotation/);
  assert.match(editorApply, /backgroundMode === "asset" && viewer\.environmentTexture/);
  assert.match(editorApply, /viewer\.scene\.background = viewer\.environmentTexture/);

  assert.match(readerLoader, /format === "exr"/);
  assert.match(readerLoader, /format === "png"/);
  assert.match(readerLoader, /new THREE\.TextureLoader\(\)/);
  assert.match(readerLoader, /loadedTexture\.colorSpace = THREE\.SRGBColorSpace/);
  assert.match(readerLoader, /loadedTexture\.mapping = THREE\.EquirectangularReflectionMapping/);
  assert.match(readerApply, /renderer\.toneMappingExposure = rendering\.exposure/);
  assert.match(readerApply, /scene\.backgroundRotation\.y = transform\.rotationY/);
  assert.match(readerApply, /rendering\.backgroundMode === "asset" && environmentTexture/);
  assert.match(readerApply, /scene\.background = environmentTexture/);
});
