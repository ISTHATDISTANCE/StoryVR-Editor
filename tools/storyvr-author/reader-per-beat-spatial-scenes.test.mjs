import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function evaluateFunctions(names, exportedName) {
  return new Function(`${names.map(functionSource).join("\n")}\nreturn ${exportedName};`)();
}

test("reader resolves timeline variants, scene-key variants, base beats, and legacy timeline entities", () => {
  const { spatialSceneForRuntime } = evaluateFunctions([
    "uniqueStrings",
    "spatialSceneRecord",
    "spatialSceneMatches",
    "spatialVariantSceneFromMap",
    "spatialVariantSceneFromRecord",
    "spatialSceneForRuntime",
  ], "({ spatialSceneForRuntime })");
  const beat = { id: "beat-a" };
  const baseScene = {
    sceneKey: "beat:beat-a",
    beatId: "beat-a",
    linkedAssetIds: ["base.glb"],
    entities: [{ id: "glb:base.glb:beat:beat-a", assetId: "base.glb", kind: "glb" }],
  };
  const resolvedVariant = {
    sceneKey: "beat:beat-a:variant:blue",
    beatId: "beat-a",
    variantOptionId: "blue",
    linkedAssetIds: ["resolved.glb"],
    entities: [{ id: "glb:resolved.glb:beat:beat-a:variant:blue", assetId: "resolved.glb", kind: "glb" }],
  };
  const timelineVariant = {
    ...resolvedVariant,
    linkedAssetIds: ["timeline.glb"],
    entities: [{ id: "glb:timeline.glb:beat:beat-a:variant:blue", assetId: "timeline.glb", kind: "glb" }],
  };
  const relations = {
    resolvedByBeat: { "beat-a": baseScene },
    resolvedByVariant: { [resolvedVariant.sceneKey]: resolvedVariant },
    timeline: [{ beatId: "beat-a", variantOptionId: "blue", sceneKey: resolvedVariant.sceneKey }],
  };

  const timeline = [{
    spatialRelations: {
      ...baseScene,
      variantsByOptionId: { blue: timelineVariant },
    },
  }];
  assert.equal(spatialSceneForRuntime(relations, timeline, beat, 0, { id: "blue" }), timelineVariant);

  const baseOnlyTimeline = [{ spatialRelations: baseScene }];
  assert.equal(spatialSceneForRuntime(relations, baseOnlyTimeline, beat, 0, { id: "blue" }), resolvedVariant);
  assert.equal(spatialSceneForRuntime(relations, baseOnlyTimeline, beat, 0, null), baseScene);
  assert.equal(spatialSceneForRuntime(relations, [], beat, 0, null), baseScene);

  const legacyEntities = [{ id: "glb:legacy.glb", assetId: "legacy.glb", kind: "glb" }];
  assert.deepEqual(
    spatialSceneForRuntime({}, [{ spatialEntities: legacyEntities }], beat, 0, null).entities,
    legacyEntities,
  );
});

test("reader takes each viewpoint from the active scene with a legacy contract fallback", () => {
  const helpers = evaluateFunctions([
    "spatialEntityIndex",
    "normalizeRuntimeSpatialRelations",
    "topologyViewpointKind",
  ], "({ normalizeRuntimeSpatialRelations, topologyViewpointKind })");
  const relations = helpers.normalizeRuntimeSpatialRelations({
    schemaVersion: "storyvr-spatial-relations/v2",
    viewpoint: "egocentric",
    entities: [],
  });
  assert.equal(relations.viewpoint, "egocentric");
  assert.equal(helpers.topologyViewpointKind({ viewpoint: relations.viewpoint }), "egocentric");
  const activeRuntimeViewpointKind = new Function(`
    ${functionSource("topologyViewpointKind")}
    const fallbackReaderViewpoint = "exocentric";
    ${functionSource("activeRuntimeViewpointKind")}
    return activeRuntimeViewpointKind;
  `)();
  assert.equal(activeRuntimeViewpointKind({ viewpoint: "egocentric" }), "egocentric");
  assert.equal(activeRuntimeViewpointKind({ viewpoint: "exocentric" }), "exocentric");
  assert.equal(activeRuntimeViewpointKind({}), "exocentric");
  assert.match(
    source,
    /const fallbackReaderViewpoint = topologyViewpointKind/,
  );
});

test("reader identifies beat-scoped GLB and image-plane entities without story-specific ids", () => {
  const helpers = evaluateFunctions([
    "spatialAssetIdFromEntity",
    "spatialRenderableEntityKind",
    "isImageAsset",
  ], "({ spatialAssetIdFromEntity, spatialRenderableEntityKind, isImageAsset })");
  assert.equal(helpers.spatialAssetIdFromEntity({ id: "glb:alpha.glb:beat:beat-a:variant:blue" }), "alpha.glb");
  assert.equal(helpers.spatialAssetIdFromEntity({ id: "image:photo.webp:beat:beat-a" }), "photo.webp");
  assert.equal(helpers.spatialRenderableEntityKind({ kind: "glb" }), "model");
  assert.equal(helpers.spatialRenderableEntityKind({ kind: "image-plane" }), "image");
  assert.equal(helpers.isImageAsset({ type: "texture", path: "textures/photo.webp" }), true);
  assert.equal(helpers.isImageAsset({ type: "model", path: "models/object.glb" }), false);
});

test("reader selects every exact linked renderable entity and excludes unrelated scene assets", () => {
  const { spatialAssetEntriesForScene } = evaluateFunctions([
    "uniqueStrings",
    "spatialEntityIndex",
    "spatialAssetIdFromEntity",
    "spatialRenderableEntityKind",
    "isModelAsset",
    "isImageAsset",
    "spatialAssetEntriesForScene",
  ], "({ spatialAssetEntriesForScene })");
  const scene = {
    linkedAssetIds: ["alpha.glb", "beta.glb", "photo.png"],
    entities: [
      { id: "glb:alpha.glb:beat:beat-a", kind: "glb", assetId: "alpha.glb" },
      {
        id: "glb:alpha.glb:beat:beat-a:instance:1",
        kind: "glb",
        assetId: "alpha.glb",
        authoredInstance: true,
        instanceOfEntityId: "glb:alpha.glb:beat:beat-a",
      },
      { id: "glb:beta.glb:beat:beat-a", kind: "glb", assetId: "beta.glb" },
      { id: "image:photo.png:beat:beat-a", kind: "image-plane", assetId: "photo.png" },
      { id: "glb:unrelated.glb:beat:beat-a", kind: "glb", assetId: "unrelated.glb" },
    ],
  };
  const assets = new Map([
    ["alpha.glb", { id: "alpha.glb", type: "model", path: "models/alpha.glb" }],
    ["beta.glb", { id: "beta.glb", type: "model", path: "models/beta.glb" }],
    ["photo.png", { id: "photo.png", type: "texture", path: "textures/photo.png" }],
    ["unrelated.glb", { id: "unrelated.glb", type: "model", path: "models/unrelated.glb" }],
  ]);
  assert.deepEqual(
    spatialAssetEntriesForScene(scene, assets).map((entry) => [entry.kind, entry.asset.id, entry.entity.id]),
    [
      ["model", "alpha.glb", "glb:alpha.glb:beat:beat-a"],
      ["model", "alpha.glb", "glb:alpha.glb:beat:beat-a:instance:1"],
      ["model", "beta.glb", "glb:beta.glb:beat:beat-a"],
      ["image", "photo.png", "image:photo.png:beat:beat-a"],
    ],
  );
});

test("reader renders every v2 scene entity through independent author-transform roots", () => {
  const sceneLoader = functionSource("showSpatialSceneAssets");
  assert.match(sceneLoader, /entries\.map/);
  assert.match(sceneLoader, /const primaryModelEntry = options\.primaryModelEntry/);
  assert.match(sceneLoader, /entry === primaryModelEntry/);
  assert.doesNotMatch(sceneLoader, /entry\.asset\.id === primaryAssetId/);
  assert.match(sceneLoader, /showSupplementalModel/);
  assert.match(sceneLoader, /showSpatialImage/);
  assert.match(sceneLoader, /Promise\.allSettled/);
  assert.match(functionSource("showModel"), /directSpatialPlacement[\s\S]*modelRoot\.position\.set\(0, 0, 0\)/);
  assert.match(functionSource("showSupplementalModel"), /new THREE\.Group\(\)/);
  assert.match(functionSource("showSupplementalModel"), /applyRuntimeSpatialEntityTransform\(authorTransformRoot, entry\.entity/);
  assert.match(functionSource("showSpatialImage"), /new THREE\.PlaneGeometry\(width, height\)/);
  assert.match(functionSource("loadImageTexture"), /new THREE\.TextureLoader\(\)\.loadAsync/);
  assert.match(functionSource("showSpatialImage"), /applyRuntimeSpatialEntityTransform\(authorTransformRoot, entry\.entity/);
  assert.match(functionSource("clearModel"), /activeSupplementalModelEntries\.splice\(0\)/);
  assert.match(functionSource("clearModel"), /activeSpatialImageEntries\.splice\(0\)/);
  assert.match(functionSource("setBeat"), /primaryModelEntry:\s*primarySpatialModelEntry/);
});

test("reader keeps the legacy single-model path when no v2 beat scene is present", () => {
  const setBeat = functionSource("setBeat");
  assert.match(setBeat, /runtimeSceneUsesBeatSpatialAssets\(spatialScene\)/);
  assert.match(setBeat, /else if \(modelAsset\)[\s\S]*showModel\(modelAsset, beat, transitionPlayback/);
  assert.match(functionSource("runtimeSpatialEntity"), /runtimeSpatialRelations\.entities\?\.\[entityId\]/);
  assert.match(functionSource("applyRuntimeGlbSpatialTransform"), /runtimeGlbSpatialEntity\(asset, beat\)/);
  assert.match(functionSource("modelRootPositionForBeat"), /runtimeTopologyKind/);
});

test("reader keeps primary and supplemental source-motion playback independent", () => {
  assert.match(functionSource("showSupplementalModel"), /sourceTransitionForBeatChange\(previousIndex, activeIndex, entry\.asset\.id, options\.route\)/);
  assert.match(functionSource("showSupplementalModel"), /createFrozenSourcePartPlayback/);
  assert.match(functionSource("updateSourceAnimation"), /updateSupplementalSourceAnimations\(delta, frameTime\)/);
  assert.match(functionSource("updateSupplementalSourceAnimations"), /applySourceAnimationSegment\(playback, progress\)/);
});

test("same-asset authored copies reuse a shared-timeline boundary with independent playback", () => {
  const { supplementalSpatialTransitionPlayback } = evaluateFunctions(
    ["supplementalSpatialTransitionPlayback"],
    "({ supplementalSpatialTransitionPlayback })",
  );
  const primary = { asset: { id: "alpha.glb" }, entity: { id: "glb:alpha.glb:beat:a" } };
  const copy = { asset: primary.asset, entity: { id: `${primary.entity.id}:instance:2` } };
  const other = { asset: { id: "beta.glb" }, entity: { id: "glb:beta.glb:beat:a" } };
  const boundary = {
    sharedTimeline: true,
    contract: { assetId: "alpha.glb" },
    mode: "scrub",
    startProgress: 0.2,
    endProgress: 0.7,
  };

  assert.equal(supplementalSpatialTransitionPlayback(copy, primary, boundary), boundary);
  assert.equal(supplementalSpatialTransitionPlayback(other, primary, boundary), null);
  assert.equal(supplementalSpatialTransitionPlayback(copy, primary, null), null);
  assert.match(functionSource("showSpatialSceneAssets"), /transitionPlayback: supplementalSpatialTransitionPlayback/);
  assert.match(functionSource("showSupplementalModel"), /options\.transitionPlayback[\s\S]*transitionPlayback\?\.sharedTimeline === true/);
  assert.match(functionSource("showSupplementalModel"), /createSharedTimelinePlayback\([\s\S]*transitionPlayback/);
  assert.match(functionSource("createSharedTimelinePlayback"), /const mixer = new THREE\.AnimationMixer\(root\)/);
});
