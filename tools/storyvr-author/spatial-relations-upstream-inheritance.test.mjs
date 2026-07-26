import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const readerSource = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function readerFunctionSource(name) {
  const start = readerSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `reader ${name} exists`);
  const next = readerSource.indexOf("\nfunction ", start + 1);
  return readerSource.slice(start, next === -1 ? readerSource.length : next);
}

test("Spatial Relations inherits topology scale instead of applying an editor-only size", () => {
  const loader = functionSource("loadSpatialRelationsGlb");
  const applyTransform = functionSource("applySpatialEntityTransformToObject");

  assert.doesNotMatch(
    loader,
    /normalizeTopologyObject\(gltf\.scene,\s*0\.76\)/,
    "Spatial Relations must not replace the locked Asset Topology scale with a fixed editor size",
  );
  assert.match(
    loader,
    /spatialTopologyAssetPose\(|topologyAssetTargetSize\(/,
    "Spatial Relations resolves model size through the same generic topology contract as upstream previews",
  );
  assert.match(
    applyTransform,
    /if \(!isText\)[\s\S]*?object\.position\.copy\(position\)[\s\S]*?return;/,
    "the GLB author layer stays local to its locked topology wrapper",
  );
});

test("Spatial Relations uses the final reader base size, pivot, and a grounded editor-only reader", () => {
  const pose = functionSource("spatialTopologyAssetPose");
  const normalize = functionSource("normalizeSpatialRuntimeObject");
  const loader = functionSource("loadSpatialRelationsGlb");
  const proxy = functionSource("makeSpatialReaderProxy");
  const readerTopologyKind = readerFunctionSource("activeRuntimeTopologyKind");
  const readerFrameTarget = readerFunctionSource("modelFrameTarget");

  assert.match(readerFrameTarget, /egocentric" && activeRuntimeTopologyKind\(\) === "single"\) return 5\.4;/, "reader runtime declares the room-scale target for the active beat scene");
  assert.match(readerTopologyKind, /sceneRecord\?\.topology[\s\S]*topologyKindFromLabel/, "reader resolves each v2 beat's topology before choosing its frame target");
  assert.match(pose, /targetSize:\s*5\.4/, "Spatial Relations uses the same egocentric single-anchor target");
  assert.match(pose, /position:\s*new THREE\.Vector3\(0, 1\.18, -0\.18\)/, "Spatial Relations uses the same reader model-root pose");
  assert.match(normalize, /object\.position\.sub\(center\.multiplyScalar\(scale\)\)/, "the editor shares the reader's centered author-transform pivot");
  assert.match(loader, /normalizeSpatialRuntimeObject\(gltf\.scene, topologyPose\.targetSize\)/, "GLB loading uses final-reader normalization");
  assert.match(proxy, /bodyHeight[\s\S]*eyeHeight[\s\S]*RingGeometry/, "the reader proxy extends from eye height to a visible floor contact");
  assert.match(source, /makeSpatialEditorFloorGuide\(layoutKind, layers\.viewpointKind\)/, "the editor displays a non-authored floor reference");
});

test("egocentric GLBs preserve authored depth materials in previews and the final reader", () => {
  const loader = functionSource("loadSpatialRelationsGlb");
  const readerShowModel = (() => {
    const start = readerSource.indexOf("function showModel(");
    assert.notEqual(start, -1, "reader showModel exists");
    const next = readerSource.indexOf("\nfunction ", start + 1);
    return readerSource.slice(start, next === -1 ? readerSource.length : next);
  })();

  assert.doesNotMatch(source, /function prepareEgocentricEnclosurePreview\(/, "previews must not make every source GLB material translucent");
  assert.doesNotMatch(readerSource, /function prepareEgocentricRuntimeMaterial\(/, "the final reader must preserve source GLB depth behavior");
  assert.doesNotMatch(loader, /transparent\s*=\s*true|depthWrite\s*=\s*false/, "Spatial loading leaves authored materials intact");
  assert.doesNotMatch(readerShowModel, /transparent\s*=\s*true|depthWrite\s*=\s*false/, "runtime model loading leaves authored materials intact");
});

test("the outside Spatial camera cannot orbit beneath the scene floor", () => {
  const initializer = functionSource("initializeSpatialRelationsViewer");

  assert.match(initializer, /controls\.enablePan\s*=\s*false/, "free panning cannot move the orbit target beneath the floor");
  assert.match(initializer, /controls\.maxPolarAngle\s*=\s*Math\.PI\s*\/\s*2\s*-\s*0\.02/, "orbiting stays in the upper hemisphere");
  assert.ok(
    initializer.indexOf("controls.maxPolarAngle") < initializer.indexOf("applyReaderViewerCameraState"),
    "the orbit limit is active before any saved camera position is restored",
  );
  assert.match(functionSource("applyReaderViewerCameraState"), /viewer\.controls\.update\(\)/, "restored positions are clamped by OrbitControls");
});

test("Spatial Relations consumes the per-beat source playback contract", () => {
  const initializer = functionSource("initializeSpatialRelationsViewer");
  const loader = functionSource("loadSpatialRelationsGlb");
  const attachment = functionSource("attachSpatialUpstreamPlayback");
  const update = functionSource("updateSpatialUpstreamPlayback");

  assert.match(initializer, /sourceMotionTransition/, "the viewer carries the selected beat boundary into playback");
  assert.match(initializer, /sourcePartToBeatId/, "the viewer identifies the destination beat for resolved part state");
  assert.match(initializer, /sourcePartPlaybackMode/, "the viewer preserves frozen versus animated destination state");
  assert.match(loader, /attachSpatialUpstreamPlayback\(viewer,\s*entry,\s*gltf\)/, "each GLB is attached to the canonical source playback consumer");
  assert.match(attachment, /sourcePlaybackWindowForAsset|attachSourceTransitionPlayback/, "playback is selected from the saved beat and boundary windows");
  assert.match(attachment, /applySourcePartMask|applyInterBeatSourcePartMaskToEntry/, "beat-specific source part visibility is applied");
  assert.match(attachment, /initializeSourcePlaybackMaterials|attachSourceTransitionPlayback/, "source material recipes and bindings remain active");
  assert.match(update, /updateSourceTransitionPlayback|seekSourceTransitionPlayback/, "Spatial Relations updates or settles the canonical source timeline");

  assert.doesNotMatch(
    loader,
    /for \(const clip of gltf\.animations\)[\s\S]*?setLoop\(THREE\.LoopRepeat,\s*Infinity\)/,
    "the editor cannot start every embedded clip in an infinite loop",
  );
  assert.doesNotMatch(
    loader,
    /stopAllAction/,
    "the loader cannot discard the resolved source playback immediately after using it as a placement hint",
  );
  assert.match(initializer, /updateSpatialUpstreamPlayback\(viewer,\s*delta\)/, "the render loop advances and settles inherited playback");
  assert.doesNotMatch(initializer, /applySpatialTextCollisionClearanceInEditor|applySpatialTextOrientationInEditor/, "the visual-asset editor does not own the runtime hand panel");
});

test("Spatial Relations editor excludes the reader-hand text system surface", () => {
  const initializer = functionSource("initializeSpatialRelationsViewer");
  const visibleEntities = functionSource("spatialEditorSceneEntities");
  const hierarchy = functionSource("renderSpatialHierarchy");

  assert.match(initializer, /spatialEditorSceneEntities\(draft, sceneContext\)/);
  assert.doesNotMatch(initializer, /makeTextComfortPanel|makeTextAnchorMarker|makeTextPanelCallout/);
  assert.doesNotMatch(initializer, /updateSpatialAnchoredTextPanel|applySpatialTextCollisionClearanceInEditor/);
  assert.match(visibleEntities, /spatialEntityType\(entity\) !== "text-panel"/);
  assert.doesNotMatch(hierarchy, /Text panels|Panel or GLB name/);
});

test("Spatial beat navigation preserves the authored boundary before settling at its destination", () => {
  const events = functionSource("bindSpatialRelationsEvents");
  const context = functionSource("resolveSpatialUpstreamBeatState");

  assert.match(events, /fromBeatId/, "navigation records the beat being left");
  assert.match(events, /toBeatId/, "navigation records the destination beat");
  assert.match(events, /resolveSpatialUpstreamBeatState|spatialPendingTransition/, "navigation transfers the boundary into the rebuilt viewer");
  assert.match(events, /spatialBeatScenePresence/, "navigation reframes when inherited scene presence changes");
  assert.match(context, /sourcePlaybackBoundaryForAsset|sourcePlaybackWindowForAsset|sourceMotionTransition/, "the beat context resolves saved transition state rather than inventing editor motion");
  assert.match(context, /beatSourcePartPlaybackMode/, "text-only and frozen beats settle using upstream destination semantics");
});

test("the reader proxy follows a resolved source camera with a locked-viewpoint fallback", () => {
  const initializer = functionSource("initializeSpatialRelationsViewer");
  const rig = functionSource("createSpatialReaderRig");
  const sync = functionSource("syncSpatialReaderRigToSourceCamera");

  assert.match(initializer, /syncSpatialReaderRigToSourceCamera|sourceCamera/, "the Spatial viewer connects the reader proxy to resolved source-camera state");
  assert.match(rig, /spatialReaderRigPose/, "the locked viewpoint remains the fallback when a beat has no source camera");
  assert.match(sync, /sourceCamera/, "the resolved GLB camera is the per-beat reader pose source");
  assert.match(sync, /getWorldPosition|matrixWorld/, "source-camera position is copied in world space");
  assert.match(sync, /getWorldQuaternion|quaternion/, "source-camera orientation is copied as well as position");
  assert.doesNotMatch(sync, /viewer\.camera/, "the outside author camera never becomes the reader pose");
  assert.match(functionSource("updateSpatialUpstreamPlayback"), /syncSpatialReaderRigToSourceCamera/, "reader pose stays synchronized while the source timeline changes");
});
