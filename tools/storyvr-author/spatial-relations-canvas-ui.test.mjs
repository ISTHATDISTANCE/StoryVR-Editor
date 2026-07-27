import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

function evaluateFunctions(names, exportedName) {
  return new Function(`${names.map(functionSource).join("\n")}\nreturn ${exportedName};`)();
}

test("Spatial Relations is the second visible checkpoint and legacy topology UI is hidden", () => {
  const visibility = functionSource("componentIsHidden");
  const flow = functionSource("visibleFlowComponents");

  assert.match(visibility, /component\.hidden === true \|\| component\.visible === false/);
  assert.match(visibility, /component\.id === "asset-topology"/);
  assert.match(flow, /const leading = \[sourceGraph, spatialRelations\]/);
  assert.match(functionSource("checkpointComponents"), /visibleFlowComponents\(\)/);
});

test("Spatial Relations defaults to a full-width canvas without Source Graph authoring controls", () => {
  const workspace = functionSource("renderSpatialRelationsWorkspace");
  const canvasWorkspace = functionSource("renderSpatialRelationsCanvasWorkspace");
  const canvas = functionSource("renderSpatialStoryCanvas");

  assert.match(workspace, /if \(!sceneContext\) return renderSpatialRelationsCanvasWorkspace/);
  assert.doesNotMatch(canvasWorkspace, /Every beat has an independent scene|spatial-inference-summary|renderSpatialViewpointControl/);
  assert.match(canvas, /data-spatial-story-canvas-viewport/);
  assert.doesNotMatch(canvas, /renderAssetAtlas|Asset Library|data-beat-group-action|source-graph-full-text-detail/);
  assert.match(styles, /\.spatial-story-canvas-shell\s*\{[^}]*grid-area:\s*auto;[^}]*height:\s*auto;/s);
  assert.match(styles, /\.spatial-canvas-mode\s*\{[^}]*width:\s*100%/s);
});

test("beat and variant cards open their scoped editor and Close waits for a successful save", () => {
  const workspace = functionSource("renderSpatialRelationsWorkspace");
  const card = functionSource("renderSpatialStoryCard");
  const events = functionSource("bindSpatialRelationsEvents");
  const open = functionSource("openSpatialSceneEditor");
  const close = functionSource("closeSpatialSceneEditor");
  const flush = functionSource("flushSpatialRelationsAutosave");
  const viewpointControl = functionSource("renderSpatialViewpointControl");
  const updateViewpoint = functionSource("updateSpatialRelationsViewpoint");

  assert.match(workspace, /renderSpatialViewpointControl\(scene, draft\)/);
  assert.match(viewpointControl, /Scene viewpoint/);
  assert.match(viewpointControl, /spatialSceneViewpoint\(scene, draft\)/);
  assert.match(updateViewpoint, /scene\.viewpoint = viewpoint/);
  assert.doesNotMatch(updateViewpoint, /draft\.viewpoint =|spatialAllSceneRecords/);
  assert.match(card, /data-spatial-open-scene/);
  assert.match(card, /data-spatial-variant-group-id/);
  assert.match(card, /data-spatial-variant-option-id/);
  assert.doesNotMatch(card, /\$\{(?:locked|checkpointIsCurrent\([^)]*\)) \? "disabled"/, "saved cards remain editable");
  assert.match(events, /variantOptionId:\s*button\.dataset\.spatialVariantOptionId/);
  assert.match(open, /pushStoryvrBrowserNavigation/);
  assert.match(open, /parentEntryId:\s*currentEntry\?\.entryId/);
  assert.match(close, /const savedChanges = await flushSpatialRelationsAutosave\(\)/);
  assert.doesNotMatch(close, /force:\s*true/, "a clean close must not force an identical draft save");
  assert.match(flush, /hadPendingTimer \|\| state\.spatialDraftDirty/);
  assert.match(flush, /return true/);
  assert.match(flush, /return false/);
  assert.ok(close.indexOf("await flushSpatialRelationsAutosave") < close.indexOf("returnToSpatialCanvasWithBrowserHistory"));
  assert.doesNotMatch(close, /state\.spatialEditorScene = null/, "the matching canvas history entry owns editor teardown");
  assert.match(close, /catch \(error\)[\s\S]*Scene save failed/);
});

test("browser history owns checkpoint tabs and Spatial canvas/editor navigation", () => {
  const initialize = functionSource("initializeStoryvrBrowserNavigation");
  const push = functionSource("pushStoryvrBrowserNavigation");
  const apply = functionSource("applyStoryvrBrowserNavigation");
  const close = functionSource("returnToSpatialCanvasWithBrowserHistory");
  const events = functionSource("bindEvents");

  assert.match(source, /window\.addEventListener\("popstate"/);
  assert.match(initialize, /storyvrNavigationFromUrl\(window\.location\.href\)/);
  assert.match(initialize, /window\.history\.replaceState/);
  assert.match(push, /window\.history\.pushState/);
  assert.match(events, /pushStoryvrBrowserNavigation\(createStoryvrNavigationRoute\(button\.dataset\.selectComponent\)\)/);
  assert.match(apply, /state\.activeId = navigation\.componentId/);
  assert.match(apply, /state\.spatialEditorScene = navigation\.editorScene/);
  assert.match(apply, /state\.spatialEditorScene = null/);
  assert.match(close, /window\.history\.back\(\)/);
  assert.match(close, /replaceStoryvrBrowserNavigation\(canvasNavigation\)/, "a deep-linked editor closes safely without leaving StoryVR");
});

test("the Spatial editor has no generated layout options or generation actions", () => {
  const viewport = functionSource("renderSpatialRelationsViewport");
  const events = functionSource("bindSpatialRelationsEvents");

  assert.doesNotMatch(viewport, /renderSpatialLayoutOptions|Generated layouts|data-spatial-generate-layouts|data-spatial-apply-layout/);
  assert.doesNotMatch(events, /generateSpatialLayoutOptions|applySpatialLayoutOption|data-spatial-generate-layouts|data-spatial-apply-layout/);
  assert.doesNotMatch(source, /function renderSpatialLayoutOptions|function generateSpatialLayoutOptions|function applySpatialLayoutOption|spatialLayoutOptions/);
  assert.doesNotMatch(styles, /\.spatial-layout-controls|\.spatial-layout-option/);
});

test("the active editor loads scoped visual entities, including image planes", () => {
  const initializer = functionSource("initializeSpatialRelationsViewer");
  assert.match(initializer, /spatialEditorSceneEntities\(draft, sceneContext\)/);
  assert.doesNotMatch(initializer, /spatialModelAssets\(\)\.map/);
  assert.match(initializer, /loadSpatialRelationsImage/);
  assert.match(functionSource("loadSpatialRelationsGlb"), /assetLink\.entityId/);
  assert.match(functionSource("loadSpatialRelationsImage"), /new THREE\.PlaneGeometry/);
});

test("scene clicks select GLB roots with visible feedback without treating an orbit drag as a click", () => {
  const initializer = functionSource("initializeSpatialRelationsViewer");
  const selection = functionSource("selectSpatialRelationEntityInViewer");
  const helper = functionSource("syncSpatialSelectionHelper");
  const loader = functionSource("loadSpatialRelationsGlb");

  assert.match(initializer, /clickMovementThresholdSquared/);
  assert.match(initializer, /pointerMoveHandler[\s\S]*gesture\.moved = true/);
  assert.match(initializer, /spatialEntityIdAtPointer[\s\S]*raycaster\.intersectObjects\(viewer\.spatialPickTargets, true\)/);
  assert.match(initializer, /spatialObjectIsEffectivelyVisible\(hit\.object\)/);
  assert.match(initializer, /preciseVisibleSpatialBounds\(object\)/);
  assert.match(initializer, /renderable\.getVertexPosition\(index, point\)/);
  assert.match(initializer, /raycaster\.ray\.intersectBox\(bounds, new THREE\.Vector3\(\)\)/);
  assert.match(initializer, /pointerDownHandler[\s\S]*startedOnTransformGizmo = Boolean\(transformControls\.dragging \|\| transformControls\.axis\)/);
  assert.match(initializer, /const entityId = startedOnTransformGizmo \? null : spatialEntityIdAtPointer\(event\)/);
  assert.match(initializer, /selectionPointerGesture = \{[\s\S]*entityId,/);
  assert.match(initializer, /pointerUpHandler[\s\S]*gesture\.startedOnTransformGizmo[\s\S]*selectSpatialRelationEntityInViewer\(entityId\)/);
  assert.match(loader, /gltf\.scene\.traverse\(\(object\) => \{ object\.userData\.spatialEntityId = entityId; \}\)/);
  assert.match(selection, /transformControls\?\.attach\(object\)/);
  assert.match(selection, /syncSpatialSelectionHelper\(textViewer, object\)/);
  assert.match(helper, /new THREE\.BoxHelper\(object, 0x007f73\)/);
});

test("selected GLBs can be copied and pasted as explicit authored instances from buttons or shortcuts", () => {
  const viewport = functionSource("renderSpatialRelationsViewport");
  const events = functionSource("bindSpatialRelationsEvents");
  const copy = functionSource("copySelectedSpatialGlb");
  const paste = functionSource("pasteSpatialGlbInstance");
  const initializer = functionSource("initializeSpatialRelationsViewer");

  assert.match(viewport, /data-spatial-copy-model/);
  assert.match(viewport, /data-spatial-paste-model/);
  assert.match(viewport, /Copy model[\s\S]*⌘C/);
  assert.match(viewport, /Paste instance[\s\S]*⌘V/);
  assert.match(events, /copySelectedSpatialGlb/);
  assert.match(events, /pasteSpatialGlbInstance/);
  assert.match(copy, /spatialEntityType\(entity\) !== "glb"/);
  assert.match(copy, /schemaVersion:\s*"storyvr-spatial-clipboard\/v1"/);
  assert.match(paste, /authoredInstance:\s*true/);
  assert.match(paste, /instanceOfEntityId:\s*baseEntity\.id/);
  assert.match(paste, /scene\.entities\.push\(instance\)/);
  assert.match(paste, /pushSpatialUndoSnapshot\(\)/);
  assert.match(paste, /commitSpatialDraftMutation\(\)/);
  assert.match(paste, /renderPreservingScroll\(\)/);
  assert.match(initializer, /modifier[\s\S]*key === "c"[\s\S]*key === "v"/);
  assert.match(styles, /\.spatial-clipboard-status\s*\{/);
});

test("a selected GLB transform can be applied to all or selected matching beats", () => {
  const viewport = functionSource("renderSpatialRelationsViewport");
  const renderTargets = functionSource("renderSpatialPropagationTargets");
  const events = functionSource("bindSpatialRelationsEvents");
  const targetEvents = functionSource("bindSpatialPropagationTargetEvents");
  const sync = functionSource("syncSpatialPropagationControls");
  const apply = functionSource("applySelectedSpatialGlbTransformToMatchingScenes");
  const helpers = evaluateFunctions([
    "spatialRelationEntities",
    "spatialEntityType",
    "spatialAllSceneRecords",
    "spatialSceneRecordForContext",
    "spatialGlbCrossSceneMatchKey",
    "spatialMatchingGlbsInOtherScenes",
  ], "({ spatialGlbCrossSceneMatchKey, spatialMatchingGlbsInOtherScenes })");
  const base = (beatId) => ({
    id: `glb:shark.glb:beat:${beatId}`,
    type: "glb",
    assetId: "shark.glb",
    beatId,
  });
  const instance = (beatId, instanceIndex) => ({
    ...base(beatId),
    id: `glb:shark.glb:beat:${beatId}:instance:${instanceIndex}`,
    authoredInstance: true,
    instanceIndex,
  });
  const sceneA = { beatId: "beat-a", entities: [base("beat-a"), instance("beat-a", 2)] };
  const sceneB = { beatId: "beat-b", entities: [base("beat-b"), instance("beat-b", 2), instance("beat-b", 3)] };
  const contract = { resolvedByBeat: { "beat-a": sceneA, "beat-b": sceneB } };

  assert.equal(helpers.spatialGlbCrossSceneMatchKey(base("beat-a")), "shark.glb::base");
  assert.equal(helpers.spatialGlbCrossSceneMatchKey(instance("beat-a", 2)), "shark.glb::instance:2");
  assert.deepEqual(
    helpers.spatialMatchingGlbsInOtherScenes(base("beat-a"), contract, { beatId: "beat-a" })
      .map(({ entity }) => entity.id),
    ["glb:shark.glb:beat:beat-b"],
  );
  assert.deepEqual(
    helpers.spatialMatchingGlbsInOtherScenes(instance("beat-a", 2), contract, { beatId: "beat-a" })
      .map(({ entity }) => entity.id),
    ["glb:shark.glb:beat:beat-b:instance:2"],
    "authored copies propagate only to the same instance ordinal",
  );
  const sourceEntity = {
    ...base("beat-a"),
    verticalAlignment: "ground",
    inferredTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    transform: { position: [3, 1, -2], quaternion: [0, 0.707, 0, 0.707], scale: [4, 4, 4] },
  };
  const targetEntity = {
    ...base("beat-b"),
    verticalAlignment: "center",
    inferredTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    manual: false,
  };
  const skippedEntity = {
    ...base("beat-c"),
    verticalAlignment: "center",
    inferredTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    manual: false,
  };
  const sceneC = { beatId: "beat-c", entities: [skippedEntity] };
  const mutationSignals = { undo: 0, commit: 0, finalized: 0, synced: 0 };
  const flush = () => {};
  const runApply = new Function("deps", `
    const {
      state,
      selectedSpatialRelationEntity,
      spatialEntityType,
      activeSpatialSceneContext,
      syncSpatialPropagationControls,
      spatialMatchingGlbsInOtherScenes,
      normalizeSpatialTransform,
      cloneJson,
      spatialTransformsEqual,
      spatialEntityVerticalAlignment,
      pushSpatialUndoSnapshot,
      spatialRelationEntityLabel,
      commitSpatialDraftMutation,
      finalizePersistentAuthorHistory,
      flushSpatialRelationsAutosave,
    } = deps;
    ${apply}
    return applySelectedSpatialGlbTransformToMatchingScenes;
  `)({
    state: { spatialPropagationStatus: "", spatialPropagationTargetBeatIds: ["beat-b"] },
    selectedSpatialRelationEntity: () => sourceEntity,
    spatialEntityType: (entity) => entity?.type || "",
    activeSpatialSceneContext: () => ({ beatId: "beat-a" }),
    syncSpatialPropagationControls: () => { mutationSignals.synced += 1; },
    spatialMatchingGlbsInOtherScenes: () => [
      { scene: sceneB, entity: targetEntity },
      { scene: sceneC, entity: skippedEntity },
    ],
    normalizeSpatialTransform: (value) => structuredClone(value),
    cloneJson: (value) => structuredClone(value),
    spatialTransformsEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    spatialEntityVerticalAlignment: (entity) => entity?.verticalAlignment || "ground",
    pushSpatialUndoSnapshot: () => { mutationSignals.undo += 1; },
    spatialRelationEntityLabel: () => "shark.glb",
    commitSpatialDraftMutation: () => { mutationSignals.commit += 1; },
    finalizePersistentAuthorHistory: (callback) => {
      mutationSignals.finalized += 1;
      assert.equal(callback, flush);
    },
    flushSpatialRelationsAutosave: flush,
  });
  assert.equal(runApply(), true);
  assert.deepEqual(targetEntity.transform, sourceEntity.transform);
  assert.notEqual(targetEntity.transform, sourceEntity.transform, "the propagated transform is cloned");
  assert.equal(targetEntity.verticalAlignment, "ground", "the placement basis propagates with the numeric transform");
  assert.equal(targetEntity.manual, true);
  assert.deepEqual(
    skippedEntity.transform,
    { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    "unselected beats keep their transform",
  );
  assert.deepEqual(mutationSignals, { undo: 1, commit: 1, finalized: 1, synced: 1 });
  assert.match(viewport, /renderSpatialPropagationTargets/);
  assert.match(renderTargets, /data-spatial-apply-toggle/);
  assert.match(renderTargets, /Select all beats/);
  assert.match(renderTargets, /data-spatial-apply-current/);
  assert.match(renderTargets, /Current beat · Source transform/);
  assert.match(renderTargets, /data-spatial-apply-target=/);
  assert.match(renderTargets, /Apply to selected beats/);
  assert.match(events, /bindSpatialPropagationTargetEvents/);
  assert.match(targetEvents, /data-spatial-apply-select-all/);
  assert.match(targetEvents, /spatialPropagationTargetBeats\(\)\.map\(\(beat\) => beat\.id\)/);
  assert.match(targetEvents, /applySelectedSpatialGlbTransformToMatchingScenes/);
  assert.match(sync, /selectAll\.indeterminate = selectedBeatCount > 0 && selectedBeatCount < listedBeatCount/);
  assert.match(apply, /targetBeatIds\.has\(String\(scene\?\.beatId/);
  assert.match(apply, /normalizeSpatialTransform\(sourceEntity\.transform, sourceEntity\.inferredTransform\)/);
  assert.match(apply, /entity\.transform = transform/);
  assert.match(apply, /entity\.verticalAlignment = verticalAlignment/);
  assert.match(apply, /entity\.manual = manual/);
  assert.match(apply, /pushSpatialUndoSnapshot\(\)/);
  assert.match(apply, /commitSpatialDraftMutation\(\)/);
  assert.match(apply, /finalizePersistentAuthorHistory\(flushSpatialRelationsAutosave\)/);
  assert.match(styles, /\.spatial-transform-toolbar \.spatial-apply-scenes-button:not\(:disabled\)/);
  assert.match(styles, /\.spatial-apply-target-panel\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.spatial-apply-target-list\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.spatial-apply-target-row\.selected/);
});

test("numeric fields and the scale gizmo share one bounded proportional scale calculation", () => {
  const helpers = evaluateFunctions([
    "spatialLockedScaleForAxis",
    "spatialLockedScaleDriverIndex",
  ], "({ spatialLockedScaleForAxis, spatialLockedScaleDriverIndex })");

  assert.deepEqual(helpers.spatialLockedScaleForAxis([1, 2, 4], 1, 3), [1.5, 3, 6]);
  assert.deepEqual(helpers.spatialLockedScaleForAxis([80, 50, 20], 1, 100), [100, 62.5, 25]);
  assert.deepEqual(helpers.spatialLockedScaleForAxis([0.005, 1, 2], 1, 0.01), [0.001, 0.2, 0.4]);
  assert.equal(helpers.spatialLockedScaleDriverIndex([1, 2, 4], [1, 3, 4], "Y"), 1);
  assert.equal(helpers.spatialLockedScaleDriverIndex([1, 2, 4], [1.5, 3, 4], "XY", 0), 0);

  const numeric = functionSource("updateSelectedSpatialTransformField");
  const initializer = functionSource("initializeSpatialRelationsViewer");
  assert.match(numeric, /state\.spatialScaleRatioLocked[\s\S]*spatialLockedScaleForAxis\(transform\.scale, index, value\)/);
  assert.match(initializer, /transformControls\.mode === "scale"/);
  assert.match(initializer, /spatialLockedScaleDriverIndex/);
  assert.match(initializer, /spatialLockedScaleForAxis\(start, driverIndex, current\[driverIndex\]\)/);
  assert.match(initializer, /finally\s*\{\s*viewer\.transformMutationActive = false;/);
});

test("the Spatial editor omits compatibility text-panel entities and controls", () => {
  const visible = functionSource("spatialEditorSceneEntities");
  const selection = functionSource("ensureSpatialSelection");
  const hierarchy = functionSource("renderSpatialHierarchy");
  const viewport = functionSource("renderSpatialRelationsViewport");
  const initializer = functionSource("initializeSpatialRelationsViewer");

  assert.match(visible, /spatialEntityType\(entity\) !== "text-panel"/);
  assert.match(selection, /spatialEditorSceneEntities\(draft, context\)/);
  assert.doesNotMatch(selection, /text-panel/);
  assert.doesNotMatch(hierarchy, /Text panels|Panel or GLB name/);
  assert.match(viewport, /Reader text stays attached to a hand at runtime/);
  assert.doesNotMatch(initializer, /makeTextComfortPanel|makeTextAnchorMarker|makeTextPanelCallout/);
});

test("the beat-owned Reader is selectable, editable, and shared by variant scenes", () => {
  const hierarchy = functionSource("renderSpatialHierarchy");
  const viewport = functionSource("renderSpatialRelationsViewport");
  const inspector = functionSource("renderSpatialRelationsInspector");
  const sceneEntities = functionSource("spatialSceneEntities");
  const initializer = functionSource("initializeSpatialRelationsViewer");
  const createRig = functionSource("createSpatialReaderRig");
  const persist = functionSource("persistSpatialObjectTransform");

  assert.match(functionSource("spatialEntityType"), /return "reader"/);
  assert.match(hierarchy, /renderGroup\("Reader", readerEntities\)/);
  assert.match(viewport, /Reader scale is fixed/);
  assert.match(inspector, /data-spatial-scale-section[\s\S]*isReader \? "hidden"/);
  assert.match(styles, /\[data-spatial-scale-section\]\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(sceneEntities, /contract\?\.resolvedByBeat\?\.\[context\.beatId\]/, "variants inherit the beat Reader object");
  assert.match(initializer, /viewer\.spatialObjects\.set\(readerEntity\.id, readerEditorLayer\.rig\)/);
  assert.match(initializer, /viewer\.spatialPickTargets\.push\(readerEditorLayer\.proxy\)/);
  assert.match(createRig, /normalizeSpatialTransform\(readerEntity\.transform, readerEntity\.inferredTransform\)/);
  assert.match(persist, /scale: isReader \? \[1, 1, 1\]/);
  assert.match(functionSource("setSpatialTransformMode"), /mode === "scale"[\s\S]*=== "reader"/);
  assert.match(functionSource("syncSpatialReaderRigToSourceCamera"), /viewer\.readerEntity\?\.manual === true/, "a manual Reader pose overrides the live source-camera fallback");
});
