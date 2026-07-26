import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inferSpatialRelationsContract,
  loadAuthorProject,
  mergeSpatialRelationsWithExisting,
  saveCheckpointDecision,
  saveSpatialRelationsDecisionDraft,
  validateSpatialRelationsContract,
} from "./engine.mjs";

function fixture() {
  const assets = [
    { id: "focus.glb", type: "model", path: "models/focus.glb" },
    { id: "context.glb", type: "model", path: "models/context.glb" },
    { id: "photo.jpg", type: "texture", path: "images/photo.jpg" },
  ];
  const graph = {
    beats: [
      { id: "focus-beat", title: "Focus", text: "A focused beat.", linkedAssets: [assets[0]] },
      { id: "asset-beat", title: "Object", text: "A longer object-linked explanation that should remain adjacent to its saved GLB.", linkedAssets: [assets[0], assets[1], assets[2]] },
      { id: "text-beat", title: "Text", text: "A text-only beat.", linkedAssets: [] },
    ],
    sourceSpatialCues: {
      schemaVersion: "storyvr-source-spatial-cues/v1",
      inferredPath: true,
      cues: [{
        cueId: "focus.glb#camera:0:focus-beat",
        beatId: "focus-beat",
        assetId: "focus.glb",
        sourceProgress: 0.35,
        cameraIndex: 0,
        cameraClipIndexes: [2],
        focusMethod: "camera-forward-raycast",
        activePartSelectors: ["FocusMesh"],
        confidence: 0.91,
      }],
    },
    sourceMotionLinking: {
      schemaVersion: "storyvr-source-motion-linking/v1",
      tracks: [{
        trackId: "focus.glb#clip:0",
        assetId: "focus.glb",
        kind: "clip",
        animationIndex: 0,
        animationName: "FocusReveal",
        applicableComponents: ["dynamic-geometry", "inter-beat-dynamics"],
        effective: {
          beatIds: ["focus-beat"],
          transitions: [{ fromBeatId: "focus-beat", toBeatId: "asset-beat", startProgress: 0.35, endProgress: 0.7 }],
        },
      }],
    },
    sourceMotionPlayback: {
      schemaVersion: "storyvr-source-motion-playback/v1",
      assets: [{
        assetId: "focus.glb",
        mode: "shared-timeline",
        timeline: { durationSeconds: 8, timeMapping: "shared-absolute", defaultLoopMode: "once" },
        trackIds: ["focus.glb#clip:0"],
        coordinatedClips: [{ clipIndex: 0, loopMode: "once" }],
        camera: { cameraIndex: 0, clipIndexes: [2], desktopPolicy: "source-camera", xrPolicy: "preserve-viewer-camera" },
        anchors: [{ beatId: "focus-beat", localProgress: 0.35, contributorClipIndexes: [0] }],
        beatStates: [
          { beatId: "focus-beat", presence: "active", entryMode: "initial", stateMode: "anchor", localProgress: 0.35 },
          { beatId: "asset-beat", presence: "active", entryMode: "animate", stateMode: "anchor", localProgress: 0.7 },
        ],
        boundaries: [{ fromBeatId: "focus-beat", toBeatId: "asset-beat", mode: "scrub", startProgress: 0.35, endProgress: 0.7 }],
        bindings: [{ source: { node: "FocusDriver", property: "scale.x" }, target: { node: "FocusMesh", property: "opacity" }, operation: "copy" }],
        annotations: [],
      }],
    },
    sourcePartStates: {
      schemaVersion: "storyvr-source-part-states/v1",
      resolvedStates: [{
        beatId: "focus-beat",
        assetId: "focus.glb",
        partSelectors: ["FocusMesh"],
        animationTargetSelectors: ["FocusDriver"],
        parts: [{ name: "FocusMesh", visibilityState: "visible" }],
        animations: [{ clipIndex: 0, clipName: "FocusReveal", playState: "active" }],
        activeTrackIds: ["focus.glb#clip:0"],
        stateMode: "anchor",
        playbackMode: "frozen",
        freezeProgress: 0.35,
      }],
    },
  };
  const runtime = { assets };
  const decisions = {
    "asset-topology": {
      option: { label: "Single anchor", viewpoint: "egocentric" },
    },
    "dynamic-geometry": {
      status: "current",
      savedAt: new Date(0).toISOString(),
      option: { optionId: "dynamic-geometry-source-dynamics-preview", label: "Dynamics", sourceDynamicsPreview: true },
    },
    "inter-beat-dynamics": {
      status: "current",
      savedAt: new Date(0).toISOString(),
      option: { optionId: "inter-beat-dynamics-source-transition-preview", label: "Transition", sourceDynamicsPreview: true },
    },
    "environment-enhancement": {
      status: "current",
      savedAt: new Date(0).toISOString(),
      option: {
        optionId: "environment-enhancement-uploaded-environment",
        label: "Neutral studio",
        environmentEnhancement: {
          schemaVersion: "storyvr-environment-enhancement/v1",
          asset: { publicPath: "environment-enhancement/studio.glb", format: "glb", sha256: "fixture-sha", dependencies: [] },
          transform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
          rendering: { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
        },
      },
    },
  };
  return { graph, runtime, decisions };
}

test("an identical Spatial Relations draft preserves current checkpoints while a real edit invalidates downstream", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-spatial-noop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const decisionsRoot = path.join(storyFolder, "analysis", "storyvr", "decisions");
  await mkdir(metadataRoot, { recursive: true });
  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), JSON.stringify({
    story_url: "https://example.test/spatial-noop",
    title: "Spatial no-op",
    text_only_parts: [{ id: "beat-1", text: "A reader reviews one spatial scene." }],
  }, null, 2));
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), "[]\n");

  const options = { storyFolder, resourceFolder };
  const initial = await loadAuthorProject(options);
  const optionId = initial.proposals["spatial-relations"].defaultOptionId;
  const savedSpatial = await saveCheckpointDecision(options, "spatial-relations", {
    optionId,
    spatialRelations: initial.spatialRelations,
  });
  const savedAt = savedSpatial.savedAt;
  const downstreamIds = [
    "environment-enhancement",
    "attention-guidance",
    "dynamic-geometry",
    "inter-beat-dynamics",
    "interaction-control",
    "transition-pacing",
  ];
  for (const component of downstreamIds) {
    await writeFile(path.join(decisionsRoot, `${component}.json`), JSON.stringify({
      schemaVersion: "storyvr-decision/v2",
      component,
      label: component,
      status: "current",
      savedAt,
      option: { optionId: `${component}-fixture`, label: component },
    }, null, 2));
  }

  const unchanged = await saveSpatialRelationsDecisionDraft(options, {
    optionId,
    spatialRelations: structuredClone(savedSpatial.spatialRelations),
  });
  assert.equal(unchanged.status, "current");
  assert.equal(unchanged.savedAt, savedAt);
  const storedSpatialAfterNoop = JSON.parse(await readFile(
    path.join(decisionsRoot, "spatial-relations.json"),
    "utf8",
  ));
  assert.equal(storedSpatialAfterNoop.status, "current");
  assert.equal(storedSpatialAfterNoop.savedAt, savedAt);
  for (const component of downstreamIds) {
    const decision = JSON.parse(await readFile(path.join(decisionsRoot, `${component}.json`), "utf8"));
    assert.equal(decision.status, "current", `${component} remains current after an identical draft`);
    assert.equal(Object.hasOwn(decision, "invalidatedBy"), false);
  }

  const editedContract = structuredClone(savedSpatial.spatialRelations);
  const editedReader = editedContract.entities.find((entity) => entity.kind === "reader");
  assert.ok(editedReader);
  editedReader.transform.position[0] += 0.25;
  editedReader.manual = true;
  for (const scene of Object.values(editedContract.resolvedByBeat || {})) {
    const sceneReader = scene.entities?.find((entity) => entity.id === editedReader.id);
    if (sceneReader) Object.assign(sceneReader, structuredClone(editedReader));
  }
  const changed = await saveSpatialRelationsDecisionDraft(options, {
    optionId,
    spatialRelations: editedContract,
  });
  assert.equal(changed.status, "draft");
  assert.equal(changed.savedAt, null);
  for (const component of downstreamIds) {
    const decision = JSON.parse(await readFile(path.join(decisionsRoot, `${component}.json`), "utf8"));
    assert.equal(decision.status, "stale", `${component} becomes stale after a real spatial edit`);
    assert.equal(decision.invalidatedBy, "spatial-relations");
  }
});

test("infers stable reader, text-panel, and root-visual Spatial Relations entities", () => {
  const { graph, runtime, decisions } = fixture();
  const contract = inferSpatialRelationsContract(graph, runtime, decisions);
  assert.equal(contract.schemaVersion, "storyvr-spatial-relations/v2");
  assert.equal(contract.viewpoint, "egocentric");
  assert.equal(contract.entities.length, 10);
  assert.deepEqual(contract.entities.map((entity) => entity.id), [
    "reader:beat:focus-beat",
    "text-panel:focus-beat",
    "glb:focus.glb:beat:focus-beat",
    "reader:beat:asset-beat",
    "text-panel:asset-beat",
    "glb:focus.glb:beat:asset-beat",
    "glb:context.glb:beat:asset-beat",
    "image:photo.jpg:beat:asset-beat",
    "reader:beat:text-beat",
    "text-panel:text-beat",
  ]);
  assert.deepEqual(Object.keys(contract.resolvedByBeat), ["focus-beat", "asset-beat", "text-beat"]);
  assert.ok(Object.values(contract.resolvedByBeat).every((scene) => scene.viewpoint === "egocentric"));
  assert.equal(contract.resolvedByBeat["asset-beat"].linkedAssetIds.length, 3);
  assert.equal(contract.entities.find((entity) => entity.id === "text-panel:focus-beat").anchor.type, "source-focus");
  assert.equal(contract.entities.find((entity) => entity.id === "text-panel:asset-beat").anchor.type, "asset");
  assert.equal(contract.entities.find((entity) => entity.id === "text-panel:text-beat").anchor.type, "reader");
  assert.deepEqual(contract.entities.find((entity) => entity.id === "reader:beat:focus-beat").transform, {
    position: [0, 1.35, 0.24],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  assert.deepEqual(contract.entities.find((entity) => entity.id === "glb:focus.glb:beat:focus-beat").transform, {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  const focusPanel = contract.entities.find((entity) => entity.id === "text-panel:focus-beat");
  assert.deepEqual(focusPanel.clearance, {
    enabled: true,
    strategy: "visible-bounds-push-v2",
    minSurfaceDistance: 0.14,
    maxPushDistance: 5,
    sampleGrid: 5,
    recheckIntervalMs: 250,
  });
  assert.ok(focusPanel.transform.position[0] > focusPanel.panel.width / 2, "the source focus stays outside the panel footprint");
  assert.ok(focusPanel.transform.position[1] > focusPanel.panel.height / 2, "the panel clears the focus vertically before live raycast resolution");
  assert.equal(contract.entities.find((entity) => entity.id === "text-panel:text-beat").clearance.enabled, false);
  assert.equal(inferSpatialRelationsContract(graph, runtime, decisions).inputSignature, contract.inputSignature);
});

test("invalidates Spatial Relations inference when effective upstream scene playback changes", () => {
  const { graph, runtime, decisions } = fixture();
  const signature = () => inferSpatialRelationsContract(graph, runtime, decisions).inputSignature;
  const initial = signature();

  graph.sourceMotionPlayback.assets[0].beatStates[0].localProgress = 0.42;
  assert.notEqual(signature(), initial, "a changed per-beat source timeline state invalidates inference");
  const afterBeatState = signature();

  graph.sourceMotionPlayback.assets[0].boundaries[0].endProgress = 0.82;
  assert.notEqual(signature(), afterBeatState, "a changed transition boundary invalidates inference");
  const afterBoundary = signature();

  graph.sourcePartStates.resolvedStates[0].partSelectors = ["AlternateFocusMesh"];
  assert.notEqual(signature(), afterBoundary, "a changed visible-part state invalidates inference");
  const afterPartState = signature();

  graph.sourceSpatialCues.cues[0].sourceProgress = 0.61;
  assert.notEqual(signature(), afterPartState, "a changed source-camera cue progress invalidates inference");
  const afterCueProgress = signature();

  graph.sourceSpatialCues.cues[0].activePartSelectors.push("ContextMesh");
  assert.notEqual(signature(), afterCueProgress, "a changed source-focus selector invalidates inference");
});

test("Spatial Relations inference excludes Environment and downstream story behavior", () => {
  const { graph, runtime, decisions } = fixture();
  const signature = () => inferSpatialRelationsContract(graph, runtime, decisions).inputSignature;
  const initial = signature();

  decisions["dynamic-geometry"].option.label = "No dynamics";
  assert.equal(signature(), initial, "the downstream Dynamics review does not invalidate spatial composition");
  const afterDynamics = signature();

  decisions["inter-beat-dynamics"].option.label = "No transition";
  assert.equal(signature(), afterDynamics, "the downstream Transition review does not invalidate spatial composition");
  const afterTransition = signature();

  decisions["environment-enhancement"].option.environmentEnhancement.transform.position[0] = 1.25;
  assert.equal(signature(), afterTransition, "the later Environment checkpoint does not invalidate Spatial Relations");
  const afterEnvironment = signature();

  decisions["environment-enhancement"].savedAt = "2099-01-01T00:00:00.000Z";
  assert.equal(signature(), afterEnvironment, "non-rendering decision timestamps do not invalidate inference");
});

test("validates manual transforms without allowing stale or unknown entities", () => {
  const { graph, runtime, decisions } = fixture();
  const inferred = inferSpatialRelationsContract(graph, runtime, decisions);
  const edited = structuredClone(inferred);
  const entity = edited.entities.find((item) => item.id === "glb:focus.glb:beat:focus-beat");
  entity.transform.position = [1.25, 0.2, -0.4];
  entity.transform.quaternion = [0, 2, 0, 2];
  entity.transform.scale = [1.5, 1.5, 1.5];
  entity.manual = true;
  Object.assign(
    edited.resolvedByBeat["focus-beat"].entities.find((item) => item.id === entity.id),
    structuredClone(entity),
  );
  const validated = validateSpatialRelationsContract(edited, inferred);
  const validatedEntity = validated.entities.find((item) => item.id === entity.id);
  assert.deepEqual(validatedEntity.transform.position, [1.25, 0.2, -0.4]);
  assert.deepEqual(validatedEntity.transform.quaternion, [0, 0.70710678, 0, 0.70710678]);
  assert.equal(validatedEntity.manual, true);

  const readerEdited = structuredClone(inferred);
  const reader = readerEdited.entities.find((item) => item.id === "reader:beat:focus-beat");
  reader.transform.position = [0.75, 1.6, 2.1];
  reader.transform.quaternion = [0, 2, 0, 2];
  reader.transform.scale = [4, 4, 4];
  reader.manual = true;
  Object.assign(
    readerEdited.resolvedByBeat["focus-beat"].entities.find((item) => item.id === reader.id),
    structuredClone(reader),
  );
  const validatedReader = validateSpatialRelationsContract(readerEdited, inferred)
    .entities.find((item) => item.id === reader.id);
  assert.deepEqual(validatedReader.transform.position, [0.75, 1.6, 2.1]);
  assert.deepEqual(validatedReader.transform.quaternion, [0, 0.70710678, 0, 0.70710678]);
  assert.deepEqual(validatedReader.transform.scale, [1, 1, 1], "reader scale remains fixed");
  assert.equal(validatedReader.manual, true);

  const stale = structuredClone(edited);
  stale.inputSignature = "stale";
  assert.throws(() => validateSpatialRelationsContract(stale, inferred), /stale/);

  const unknown = structuredClone(edited);
  unknown.entities.push({ id: "glb:unknown", kind: "glb", assetId: "unknown", transform: entity.transform });
  assert.throws(() => validateSpatialRelationsContract(unknown, inferred), /unresolved entity/);

  const unknownAnchor = structuredClone(inferred);
  const textEntity = unknownAnchor.entities.find((item) => item.id === "text-panel:asset-beat");
  textEntity.anchor = { type: "asset", assetId: "unknown.glb", cueId: null };
  unknownAnchor.resolvedByBeat["asset-beat"].entities.find((item) => item.id === textEntity.id).anchor = structuredClone(textEntity.anchor);
  assert.throws(() => validateSpatialRelationsContract(unknownAnchor, inferred), /unknown GLB anchor/);

  const changedAnchor = structuredClone(inferred);
  const changedTextEntity = changedAnchor.entities.find((item) => item.id === "text-panel:text-beat");
  changedTextEntity.anchor = { type: "world", assetId: null, cueId: null };
  changedTextEntity.manual = false;
  Object.assign(changedAnchor.resolvedByBeat["text-beat"].entities.find((item) => item.id === changedTextEntity.id), structuredClone(changedTextEntity));
  const validatedAnchor = validateSpatialRelationsContract(changedAnchor, inferred)
    .entities.find((item) => item.id === changedTextEntity.id);
  assert.equal(validatedAnchor.manual, true);

  const changedClearance = structuredClone(inferred);
  const changedClearanceEntity = changedClearance.entities.find((item) => item.id === "text-panel:focus-beat");
  changedClearanceEntity.clearance.minSurfaceDistance = 0.24;
  changedClearance.resolvedByBeat["focus-beat"].entities.find((item) => item.id === changedClearanceEntity.id).clearance.minSurfaceDistance = 0.24;
  const validatedClearance = validateSpatialRelationsContract(changedClearance, inferred)
    .entities.find((item) => item.id === changedClearanceEntity.id);
  assert.equal(validatedClearance.clearance.minSurfaceDistance, 0.24);
  assert.equal(validatedClearance.manual, true);
});

test("validates explicit authored GLB instances while rejecting forged instance lineage", () => {
  const { graph, runtime, decisions } = fixture();
  const inferred = inferSpatialRelationsContract(graph, runtime, decisions);
  const edited = structuredClone(inferred);
  const baseId = "glb:focus.glb:beat:focus-beat";
  const instance = appendAuthoredGlbInstance(edited, baseId, 2, {
    position: [0.8, 0.15, -0.6],
    scale: [1.4, 1.4, 1.4],
  });

  const validated = validateSpatialRelationsContract(edited, inferred);
  const canonical = validated.entities.find((entity) => entity.id === instance.id);
  const sceneCopy = validated.resolvedByBeat["focus-beat"].entities.find((entity) => entity.id === instance.id);
  assert.ok(canonical);
  assert.deepEqual(sceneCopy, canonical);
  assert.equal(canonical.kind, "glb");
  assert.equal(canonical.assetId, "focus.glb");
  assert.equal(canonical.authoredInstance, true);
  assert.equal(canonical.instanceOfEntityId, baseId);
  assert.equal(canonical.instanceIndex, 2);
  assert.equal(canonical.manual, true);
  assert.deepEqual(canonical.transform.position, [0.8, 0.15, -0.6]);
  assert.deepEqual(canonical.transform.scale, [1.4, 1.4, 1.4]);

  const wrongAsset = structuredClone(edited);
  editSpatialEntityCopies(wrongAsset, instance.id, (entity) => {
    entity.assetId = "context.glb";
  });
  assert.throws(
    () => validateSpatialRelationsContract(wrongAsset, inferred),
    /source GLB's scene and asset scope/,
  );

  const wrongScene = structuredClone(edited);
  const moved = wrongScene.resolvedByBeat["focus-beat"].entities
    .find((entity) => entity.id === instance.id);
  wrongScene.resolvedByBeat["focus-beat"].entities = wrongScene.resolvedByBeat["focus-beat"].entities
    .filter((entity) => entity.id !== instance.id);
  wrongScene.resolvedByBeat["asset-beat"].entities.push(moved);
  assert.throws(
    () => validateSpatialRelationsContract(wrongScene, inferred),
    /must appear exactly once in scene/,
  );

  const spoofedSceneKey = structuredClone(edited);
  const spoofedInstance = spoofedSceneKey.resolvedByBeat["focus-beat"].entities
    .find((entity) => entity.id === instance.id);
  spoofedSceneKey.resolvedByBeat["focus-beat"].entities = spoofedSceneKey.resolvedByBeat["focus-beat"].entities
    .filter((entity) => entity.id !== instance.id);
  const wrongContainer = spoofedSceneKey.resolvedByBeat["asset-beat"];
  wrongContainer.entities.push(spoofedInstance);
  wrongContainer.sceneKey = inferred.resolvedByBeat["focus-beat"].sceneKey;
  spoofedSceneKey.resolvedByBeat = Object.fromEntries([
    ...Object.entries(spoofedSceneKey.resolvedByBeat).filter(([beatId]) => beatId !== "asset-beat"),
    ["asset-beat", wrongContainer],
  ]);
  assert.throws(
    () => validateSpatialRelationsContract(spoofedSceneKey, inferred),
    /must appear exactly once in scene/,
  );

  const missingMarker = structuredClone(edited);
  editSpatialEntityCopies(missingMarker, instance.id, (entity) => {
    entity.authoredInstance = false;
  });
  assert.throws(
    () => validateSpatialRelationsContract(missingMarker, inferred),
    /lineage without authoredInstance/,
  );

  const invalidId = structuredClone(edited);
  editSpatialEntityCopies(invalidId, instance.id, (entity) => {
    entity.id = `${baseId}:copy:1`;
  });
  assert.throws(
    () => validateSpatialRelationsContract(invalidId, inferred),
    /authored instance id must use/,
  );

  const unsafeOrdinal = structuredClone(edited);
  editSpatialEntityCopies(unsafeOrdinal, instance.id, (entity) => {
    entity.id = `${baseId}:instance:${"9".repeat(400)}`;
  });
  assert.throws(
    () => validateSpatialRelationsContract(unsafeOrdinal, inferred),
    /positive safe integer/,
  );
});

test("re-inference preserves canonical manual transforms for retained and unrelated scene entities", () => {
  const { graph, runtime, decisions } = fixture();
  const inferred = inferSpatialRelationsContract(graph, runtime, decisions);
  const edited = structuredClone(inferred);
  const focusEntityId = "glb:focus.glb:beat:focus-beat";
  const unrelatedEntityId = "glb:context.glb:beat:asset-beat";
  editSpatialEntityCopies(edited, focusEntityId, (entity) => {
    entity.transform.position = [1.25, 0.4, -0.6];
    entity.transform.scale = [5, 5, 5];
    entity.manual = true;
  });
  editSpatialEntityCopies(edited, unrelatedEntityId, (entity) => {
    entity.transform.position = [-0.75, 0.2, -1.1];
    entity.transform.scale = [2, 2, 2];
    entity.manual = true;
  });

  const merged = mergeSpatialRelationsWithExisting(
    inferSpatialRelationsContract(graph, runtime, decisions),
    edited,
  );
  for (const [entityId, beatId, expectedScale] of [
    [focusEntityId, "focus-beat", [5, 5, 5]],
    [unrelatedEntityId, "asset-beat", [2, 2, 2]],
  ]) {
    const canonical = merged.entities.find((entity) => entity.id === entityId);
    const scene = merged.resolvedByBeat[beatId].entities.find((entity) => entity.id === entityId);
    assert.deepEqual(canonical.transform.scale, expectedScale);
    assert.equal(canonical.manual, true);
    assert.deepEqual(scene, canonical, "canonical and scene entity copies stay synchronized");
  }
});

test("re-inference preserves authored instances while their source GLB remains linked and drops them with it", () => {
  const { graph, runtime, decisions } = fixture();
  const existing = inferSpatialRelationsContract(graph, runtime, decisions);
  const baseId = "glb:focus.glb:beat:focus-beat";
  const instance = appendAuthoredGlbInstance(existing, baseId, 2, {
    position: [0.6, 0, -0.45],
  });

  const changedGraph = structuredClone(graph);
  changedGraph.beats.find((beat) => beat.id === "asset-beat").text = "An unrelated text refresh.";
  const preserved = mergeSpatialRelationsWithExisting(
    inferSpatialRelationsContract(changedGraph, runtime, decisions),
    existing,
  );
  const preservedCanonical = preserved.entities.find((entity) => entity.id === instance.id);
  const preservedScene = preserved.resolvedByBeat["focus-beat"].entities
    .find((entity) => entity.id === instance.id);
  assert.ok(preservedCanonical);
  assert.deepEqual(preservedScene, preservedCanonical);
  assert.equal(preservedCanonical.instanceOfEntityId, baseId);
  assert.deepEqual(preservedCanonical.transform.position, [0.6, 0, -0.45]);

  changedGraph.beats.find((beat) => beat.id === "focus-beat").linkedAssets = [runtime.assets[1]];
  const removed = mergeSpatialRelationsWithExisting(
    inferSpatialRelationsContract(changedGraph, runtime, decisions),
    preserved,
  );
  assert.equal(removed.entities.some((entity) => entity.id === instance.id), false);
  assert.equal(
    removed.resolvedByBeat["focus-beat"].entities.some((entity) => entity.id === instance.id),
    false,
  );
});

test("re-inference drops removed manual entities and keeps newly linked entities automatic", () => {
  const { graph, runtime, decisions } = fixture();
  const existing = inferSpatialRelationsContract(graph, runtime, decisions);
  const removedEntityId = "glb:focus.glb:beat:focus-beat";
  editSpatialEntityCopies(existing, removedEntityId, (entity) => {
    entity.transform.scale = [5, 5, 5];
    entity.manual = true;
  });

  const changedGraph = structuredClone(graph);
  changedGraph.beats.find((beat) => beat.id === "focus-beat").linkedAssets = [runtime.assets[1]];
  const merged = mergeSpatialRelationsWithExisting(
    inferSpatialRelationsContract(changedGraph, runtime, decisions),
    existing,
  );
  const addedEntityId = "glb:context.glb:beat:focus-beat";
  assert.equal(merged.entities.some((entity) => entity.id === removedEntityId), false);
  assert.equal(
    merged.resolvedByBeat["focus-beat"].entities.some((entity) => entity.id === removedEntityId),
    false,
  );
  const added = merged.entities.find((entity) => entity.id === addedEntityId);
  assert.ok(added);
  assert.deepEqual(added.transform.scale, [1, 1, 1]);
  assert.equal(added.manual, false);
  assert.deepEqual(
    merged.resolvedByBeat["focus-beat"].entities.find((entity) => entity.id === addedEntityId),
    added,
  );
  const refreshedPanel = merged.entities.find((entity) => entity.id === "text-panel:focus-beat");
  assert.equal(refreshedPanel.anchor.assetId, "context.glb");
  assert.equal(refreshedPanel.manual, false);
  assert.deepEqual(
    merged.resolvedByBeat["focus-beat"].entities.find((entity) => entity.id === refreshedPanel.id),
    refreshedPanel,
  );
});

test("conflicting authored copies fail instead of silently choosing insertion order", () => {
  const { graph, runtime, decisions } = fixture();
  const conflicting = inferSpatialRelationsContract(graph, runtime, decisions);
  const entityId = "glb:focus.glb:beat:focus-beat";
  const sceneEntities = conflicting.resolvedByBeat["focus-beat"].entities;
  const sceneIndex = sceneEntities.findIndex((entity) => entity.id === entityId);
  sceneEntities[sceneIndex] = structuredClone(sceneEntities[sceneIndex]);
  const canonical = conflicting.entities.find((entity) => entity.id === entityId);
  canonical.transform.scale = [5, 5, 5];
  canonical.manual = true;
  const scene = sceneEntities[sceneIndex];
  scene.transform.scale = [4, 4, 4];
  scene.manual = true;

  assert.throws(
    () => mergeSpatialRelationsWithExisting(
      inferSpatialRelationsContract(graph, runtime, decisions),
      conflicting,
    ),
    (error) => error?.statusCode === 409 && /conflicting authored copies/i.test(error.message),
  );
});

test("validates viewpoint changes independently for each beat scene", () => {
  const { graph, runtime, decisions } = fixture();
  const inferred = inferSpatialRelationsContract(graph, runtime, decisions);
  const edited = structuredClone(inferred);
  const scene = edited.resolvedByBeat["focus-beat"];
  const reader = scene.entities.find((entity) => entity.kind === "reader");
  const exocentricTransform = {
    position: [0, 1.55, 5.2],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  };
  scene.viewpoint = "exocentric";
  reader.inferredTransform = structuredClone(exocentricTransform);
  reader.transform = structuredClone(exocentricTransform);
  reader.manual = false;
  Object.assign(
    edited.entities.find((entity) => entity.id === reader.id),
    structuredClone(reader),
  );

  const validated = validateSpatialRelationsContract(edited, inferred);
  assert.equal(validated.viewpoint, "egocentric", "the top-level viewpoint remains a legacy fallback");
  assert.equal(validated.resolvedByBeat["focus-beat"].viewpoint, "exocentric");
  assert.equal(validated.resolvedByBeat["asset-beat"].viewpoint, "egocentric");
  const validatedReader = validated.resolvedByBeat["focus-beat"].entities.find((entity) => entity.kind === "reader");
  assert.deepEqual(validatedReader.inferredTransform, exocentricTransform);
  assert.deepEqual(validatedReader.transform, exocentricTransform);
  assert.equal(validatedReader.manual, false);
});

test("migrates one v1 global GLB transform into every linked beat without coupling later edits", () => {
  const { graph, runtime, decisions } = fixture();
  const inferred = inferSpatialRelationsContract(graph, runtime, decisions);
  const legacyTransform = {
    position: [2.4, 0.3, -0.8],
    quaternion: [0, 0, 0, 1],
    scale: [1.6, 1.6, 1.6],
  };
  const migrated = validateSpatialRelationsContract({
    schemaVersion: "storyvr-spatial-relations/v1",
    inputSignature: "legacy-global-layout",
    viewpoint: "egocentric",
    entities: [{
      id: "glb:focus.glb",
      kind: "glb",
      assetId: "focus.glb",
      anchor: { type: "topology", assetId: "focus.glb" },
      inferredTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      transform: legacyTransform,
      orientationPolicy: "fixed",
      manual: true,
    }],
  }, inferred);
  const focusEntities = migrated.entities.filter((entity) => entity.kind === "glb" && entity.assetId === "focus.glb");
  assert.deepEqual(focusEntities.map((entity) => entity.id), [
    "glb:focus.glb:beat:focus-beat",
    "glb:focus.glb:beat:asset-beat",
  ]);
  assert.ok(focusEntities.every((entity) => JSON.stringify(entity.transform) === JSON.stringify(legacyTransform)));

  const edited = structuredClone(migrated);
  const first = edited.resolvedByBeat["focus-beat"].entities.find((entity) => entity.kind === "glb" && entity.assetId === "focus.glb");
  first.transform.position = [8, 0, 0];
  edited.entities.find((entity) => entity.id === first.id).transform.position = [8, 0, 0];
  const validated = validateSpatialRelationsContract(edited, inferred);
  assert.deepEqual(validated.resolvedByBeat["focus-beat"].entities.find((entity) => entity.kind === "glb" && entity.assetId === "focus.glb").transform.position, [8, 0, 0]);
  assert.deepEqual(validated.resolvedByBeat["asset-beat"].entities.find((entity) => entity.kind === "glb" && entity.assetId === "focus.glb").transform.position, legacyTransform.position);
});

test("v1 migration drops an obsolete automatic GLB anchor for a now text-only beat", () => {
  const { graph, runtime, decisions } = fixture();
  const inferred = inferSpatialRelationsContract(graph, runtime, decisions);
  const base = inferred.entities.find((entity) => entity.id === "text-panel:text-beat");
  const migrated = validateSpatialRelationsContract({
    schemaVersion: "storyvr-spatial-relations/v1",
    inputSignature: "legacy-classroom-layout",
    viewpoint: "egocentric",
    entities: [{
      ...structuredClone(base),
      assetId: "classroom.glb",
      anchor: {
        type: "source-focus",
        assetId: "classroom.glb",
        cueId: "classroom.glb#camera:0:text-beat",
      },
      manual: false,
    }],
  }, inferred);
  const textPanel = migrated.entities.find((entity) => entity.id === "text-panel:text-beat");
  assert.equal(textPanel.anchor.type, "reader");
  assert.equal(textPanel.anchor.assetId, null);
  assert.equal(textPanel.manual, false);

  const manualLegacy = structuredClone(base);
  manualLegacy.assetId = "classroom.glb";
  manualLegacy.anchor = { type: "source-focus", assetId: "classroom.glb", cueId: null };
  manualLegacy.manual = true;
  assert.throws(() => validateSpatialRelationsContract({
    schemaVersion: "storyvr-spatial-relations/v1",
    viewpoint: "egocentric",
    entities: [manualLegacy],
  }, inferred), /unknown GLB anchor/);
});

test("variants receive independent scenes using only option-specific links", () => {
  const { graph, runtime, decisions } = fixture();
  graph.beats.find((beat) => beat.id === "asset-beat").linkedAssets = [runtime.assets[0]];
  graph.variantGroups = [{
    id: "asset-variants",
    beatId: "asset-beat",
    defaultOptionId: "photo-option",
    options: [
      { id: "photo-option", label: "Photo", text: "Show the photo.", assetIds: ["photo.jpg"] },
      { id: "context-option", label: "Context", text: "Show context.", assetIds: ["context.glb"] },
    ],
  }];
  const contract = inferSpatialRelationsContract(graph, runtime, decisions);
  const photoScene = contract.resolvedByVariant["beat:asset-beat:variant:photo-option"];
  const contextScene = contract.resolvedByVariant["beat:asset-beat:variant:context-option"];
  const baseReader = contract.resolvedByBeat["asset-beat"].entities.filter((entity) => entity.kind === "reader");
  assert.equal(baseReader.length, 1, "the beat owns one reader pose shared by all variants");
  assert.equal(photoScene.entities.some((entity) => entity.kind === "reader"), false);
  assert.equal(contextScene.entities.some((entity) => entity.kind === "reader"), false);
  assert.deepEqual(photoScene.linkedAssetIds, ["photo.jpg"]);
  assert.deepEqual(contextScene.linkedAssetIds, ["context.glb"]);
  assert.ok(photoScene.entities.every((entity) => entity.sceneKey === photoScene.sceneKey));
  assert.ok(contextScene.entities.every((entity) => entity.sceneKey === contextScene.sceneKey));
  assert.notEqual(
    photoScene.entities.find((entity) => entity.assetId === "photo.jpg").id,
    contextScene.entities.find((entity) => entity.assetId === "context.glb").id,
  );
});

test("variant re-inference preserves each option's independent manual transform", () => {
  const { graph, runtime, decisions } = fixture();
  graph.beats.find((beat) => beat.id === "asset-beat").linkedAssets = [];
  graph.variantGroups = [{
    id: "asset-variants",
    beatId: "asset-beat",
    defaultOptionId: "photo-option",
    options: [
      { id: "photo-option", label: "Photo", text: "Show the photo.", assetIds: ["photo.jpg"] },
      { id: "context-option", label: "Context", text: "Show context.", assetIds: ["context.glb"] },
    ],
  }];
  const existing = inferSpatialRelationsContract(graph, runtime, decisions);
  const photoId = "image:photo.jpg:beat:asset-beat:variant:photo-option";
  const contextId = "glb:context.glb:beat:asset-beat:variant:context-option";
  editSpatialEntityCopies(existing, photoId, (entity) => {
    entity.transform.scale = [2, 2, 2];
    entity.manual = true;
  });
  editSpatialEntityCopies(existing, contextId, (entity) => {
    entity.transform.scale = [5, 5, 5];
    entity.manual = true;
  });
  const contextInstance = appendAuthoredGlbInstance(existing, contextId, 2, {
    position: [0.7, 0, -0.35],
  });

  const merged = mergeSpatialRelationsWithExisting(
    inferSpatialRelationsContract(graph, runtime, decisions),
    existing,
  );
  const photo = merged.resolvedByVariant["beat:asset-beat:variant:photo-option"]
    .entities.find((entity) => entity.id === photoId);
  const context = merged.resolvedByVariant["beat:asset-beat:variant:context-option"]
    .entities.find((entity) => entity.id === contextId);
  const instance = merged.resolvedByVariant["beat:asset-beat:variant:context-option"]
    .entities.find((entity) => entity.id === contextInstance.id);
  assert.deepEqual(photo.transform.scale, [2, 2, 2]);
  assert.deepEqual(context.transform.scale, [5, 5, 5]);
  assert.deepEqual(instance.transform.position, [0.7, 0, -0.35]);
  assert.equal(photo.manual, true);
  assert.equal(context.manual, true);
  assert.equal(instance.authoredInstance, true);
  assert.equal(instance.instanceOfEntityId, contextId);
});

function editSpatialEntityCopies(contract, entityId, edit) {
  const copies = [
    ...(contract.entities || []).filter((entity) => entity.id === entityId),
    ...Object.values(contract.resolvedByBeat || {})
      .flatMap((scene) => scene.entities || [])
      .filter((entity) => entity.id === entityId),
    ...Object.values(contract.resolvedByVariant || {})
      .flatMap((scene) => scene.entities || [])
      .filter((entity) => entity.id === entityId),
  ];
  assert.ok(copies.length >= 2, `expected canonical and scene copies for ${entityId}`);
  for (const entity of copies) edit(entity);
}

function appendAuthoredGlbInstance(contract, baseId, ordinal, transform = {}) {
  const base = contract.entities.find((entity) => entity.id === baseId);
  assert.ok(base, `expected source entity ${baseId}`);
  const instance = {
    ...structuredClone(base),
    id: `${baseId}:instance:${ordinal}`,
    authoredInstance: true,
    instanceOfEntityId: baseId,
    inferredTransform: structuredClone(base.transform),
    transform: {
      ...structuredClone(base.transform),
      ...structuredClone(transform),
    },
    manual: true,
  };
  contract.entities.push(structuredClone(instance));
  const scene = base.variantOptionId
    ? contract.resolvedByVariant[base.sceneKey]
    : contract.resolvedByBeat[base.beatId];
  assert.ok(scene, `expected source scene ${base.sceneKey}`);
  scene.entities.push(structuredClone(instance));
  return instance;
}
