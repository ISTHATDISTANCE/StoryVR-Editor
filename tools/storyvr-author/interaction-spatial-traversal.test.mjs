import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSpatialTraversal } from "./engine.mjs";

function graph(beatIds = ["beat-1", "beat-2"]) {
  return {
    beats: beatIds.map((id) => ({ id, text: id })),
    sourceSpatialCues: {
      cues: beatIds.map((beatId, index) => ({
        cueId: `cue-${index + 1}`,
        beatId,
        assetId: `asset-${index + 1}`,
        sourceProgress: index ? 0.9 : 0.1,
      })),
    },
  };
}

function contract(entities) {
  return {
    schemaVersion: "storyvr-spatial-relations/v1",
    inputSignature: "spatial-input",
    entities: entities.map((entity, index) => ({
      id: `text-panel:${entity.beatId}`,
      kind: "text-panel",
      beatId: entity.beatId,
      anchor: entity.anchor,
      transform: { position: entity.position || [index * 4, 1.45, -1.2] },
      manual: entity.manual === true,
    })),
  };
}

function decisions(label) {
  return { "asset-topology": { option: { label } } };
}

test("reader-relative panels never require locomotion", () => {
  const spatialRelations = contract([
    { beatId: "beat-1", anchor: { type: "reader" }, position: [-8, 1, -1] },
    { beatId: "beat-2", anchor: { type: "reader" }, position: [9, 1, -1] },
  ]);
  const traversal = analyzeSpatialTraversal(graph(), { contentUnits: [] }, spatialRelations, decisions("Collection / constellation"));
  assert.equal(traversal.requiresLocomotion, false);
  assert.deepEqual(traversal.orderedStations.map((station) => station.readerPosition.coordinateSpace), ["reader", "reader"]);
});

test("legacy asset and source-focus panels normalize to the reader hand", () => {
  const spatialRelations = contract([
    { beatId: "beat-1", anchor: { type: "source-focus", assetId: "asset-1", cueId: "cue-1" }, position: [-9, 3, 4] },
    { beatId: "beat-2", anchor: { type: "source-focus", assetId: "asset-2", cueId: "cue-2" }, position: [12, -2, -7] },
  ]);
  const traversal = analyzeSpatialTraversal(graph(), { contentUnits: [] }, spatialRelations, decisions("Single anchor"));
  assert.equal(traversal.requiresLocomotion, false);
  assert.deepEqual(traversal.orderedStations.map((station) => station.sourceProgress), [null, null]);
  assert.deepEqual(traversal.orderedStations.map((station) => station.travelKey), ["reader-hand", "reader-hand"]);
  assert.deepEqual(traversal.orderedStations.map((station) => station.anchorType), ["reader", "reader"]);
});

test("hidden legacy panel anchors never infer reader locomotion", () => {
  const spatialRelations = contract([
    { beatId: "beat-1", anchor: { type: "asset", assetId: "asset-1" } },
    { beatId: "beat-2", anchor: { type: "source-focus", assetId: "asset-2", cueId: "cue-2" } },
  ]);
  const traversal = analyzeSpatialTraversal(graph(), { contentUnits: [] }, spatialRelations, decisions("Collection / constellation"));
  assert.equal(traversal.requiresLocomotion, false);
  assert.equal(traversal.transitions[1].requiresLocomotion, false);
  assert.deepEqual(traversal.locomotionModes, ["physical-walking", "virtual-teleport"]);
  assert.equal(traversal.defaultLocomotionMode, null);
  assert.match(traversal.transitions[1].reason, /attached hand/);
});

test("obsolete world-space panel edits do not affect traversal or its stable source signature", () => {
  const first = contract([
    { beatId: "beat-1", anchor: { type: "world" }, position: [0, 1.4, -1], manual: true },
    { beatId: "beat-2", anchor: { type: "world" }, position: [3, 1.4, -1], manual: true },
  ]);
  const second = structuredClone(first);
  second.entities[1].transform.position = [4, 1.4, -1];
  const firstTraversal = analyzeSpatialTraversal(graph(), { contentUnits: [] }, first, decisions("Single anchor"));
  const secondTraversal = analyzeSpatialTraversal(graph(), { contentUnits: [] }, second, decisions("Single anchor"));
  assert.equal(firstTraversal.requiresLocomotion, false);
  assert.equal(firstTraversal.sourceSignature, secondTraversal.sourceSignature);
  assert.equal(firstTraversal.orderedStations[1].readerPosition.coordinateSpace, "reader");
  assert.equal(firstTraversal.orderedStations[1].attachmentPolicy, "reader-hand");
});

test("beat-scoped reader poses define explicit stations while preserving authored facing in the signature", () => {
  const readerContract = {
    schemaVersion: "storyvr-spatial-relations/v2",
    inputSignature: "reader-spatial-input",
    entities: [],
    resolvedByBeat: Object.fromEntries([
      ["beat-1", [0, 1.55, 0]],
      ["beat-2", [3, 1.55, 0]],
    ].map(([beatId, position]) => [beatId, {
      beatId,
      topology: { kind: "single" },
      entities: [{
        id: `reader:beat:${beatId}`,
        kind: "reader",
        beatId,
        transform: { position, quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
        manual: true,
      }],
    }])),
  };
  const first = analyzeSpatialTraversal(graph(), { contentUnits: [] }, readerContract, decisions("Single anchor"));
  assert.equal(first.requiresLocomotion, true);
  assert.equal(first.defaultLocomotionMode, "virtual-teleport");
  assert.deepEqual(first.orderedStations.map((station) => station.readerEntityId), [
    "reader:beat:beat-1",
    "reader:beat:beat-2",
  ]);
  assert.deepEqual(first.orderedStations[1].readerPosition, {
    coordinateSpace: "world",
    position: [3, 1.55, 0],
    quaternion: [0, 0, 0, 1],
    anchorAssetId: null,
    cueId: null,
    sourceProgress: null,
  });
  assert.equal(first.transitions[1].requiresLocomotion, true);

  const rotated = structuredClone(readerContract);
  rotated.resolvedByBeat["beat-2"].entities[0].transform.quaternion = [0, 0.70710678, 0, 0.70710678];
  const second = analyzeSpatialTraversal(graph(), { contentUnits: [] }, rotated, decisions("Single anchor"));
  assert.notEqual(first.sourceSignature, second.sourceSignature, "reader facing invalidates stale Interaction Control");

  const facingOnly = structuredClone(readerContract);
  facingOnly.resolvedByBeat["beat-2"].entities[0].transform.position = [0, 1.55, 0];
  facingOnly.resolvedByBeat["beat-2"].entities[0].transform.quaternion = [0, 0.70710678, 0, 0.70710678];
  const facingTraversal = analyzeSpatialTraversal(graph(), { contentUnits: [] }, facingOnly, decisions("Single anchor"));
  assert.equal(facingTraversal.requiresLocomotion, true, "a manual facing-only change cannot become an unused saved pose");
  assert.equal(facingTraversal.transitions[1].distanceMeters, 0);
  assert.equal(facingTraversal.transitions[1].rotationDegrees, 90);

  const tinyMove = structuredClone(readerContract);
  tinyMove.resolvedByBeat["beat-2"].entities[0].transform.position = [0.01, 1.55, 0];
  const tinyTraversal = analyzeSpatialTraversal(graph(), { contentUnits: [] }, tinyMove, decisions("Single anchor"));
  assert.equal(tinyTraversal.requiresLocomotion, false, "one-centimeter authoring noise stays within the same pose");
});
