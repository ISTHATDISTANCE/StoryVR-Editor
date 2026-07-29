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
  return new Function(`${names.map(functionSource).join("\n")}\nreturn ${exportedName};`)();
}

test("reader normalizes structured reader stations and timeline fallbacks", () => {
  const normalize = evaluateFunctions([
    "finiteSpatialArray",
    "normalizedSpatialQuaternion",
    "normalizeRuntimeSpatialTraversal",
  ], "normalizeRuntimeSpatialTraversal");
  const traversal = normalize({
    schemaVersion: "storyvr-spatial-traversal/v1",
    requiresLocomotion: true,
    defaultLocomotionMode: "virtual-teleport",
    orderedStations: [{
      stationId: "station-b",
      order: 2,
      beatId: "beat-b",
      position: [9, 9, 9],
      readerPosition: {
        coordinateSpace: "asset",
        position: [1, 0, -1],
        quaternion: [0, 2, 0, 2],
        anchorAssetId: "model.glb",
        cueId: "cue-b",
      },
    }],
  });
  assert.equal(traversal.requiresLocomotion, true);
  assert.equal(traversal.locomotionMode, "virtual-teleport");
  assert.deepEqual(traversal.orderedStations[0].readerPosition, [1, 0, -1]);
  assert.equal(traversal.orderedStations[0].coordinateSpace, "asset");
  assert.equal(traversal.orderedStations[0].anchorAssetId, "model.glb");
  assert.deepEqual(traversal.orderedStations[0].readerQuaternion.map((value) => Number(value.toFixed(8))), [0, 0.70710678, 0, 0.70710678]);

  const fallback = normalize({}, [{ readerStation: { beatId: "beat-a", position: [2, 0, 3] } }]);
  assert.equal(fallback.requiresLocomotion, false);
  assert.deepEqual(fallback.orderedStations[0].readerPosition, [2, 0, 3]);
  assert.equal(fallback.orderedStations[0].readerQuaternion, undefined, "legacy stations keep their current facing");
});

test("virtual traversal moves the reader without replacing headset tracking", () => {
  assert.match(source, /readerRig\.add\(camera\)/);
  assert.doesNotMatch(source, /scene\.add\(camera\)/);
  assert.match(functionSource("applySpatialTraversalForBeat"), /virtual-teleport/);
  assert.match(functionSource("applySpatialTraversalForBeat"), /runtimeReaderPoseInitialized/);
  assert.match(functionSource("applySpatialTraversalForBeat"), /teleportReaderTo\(entryDestination, entryStation\)/);
  assert.match(functionSource("teleportReaderTo"), /renderer\.xr\.isPresenting/);
  assert.match(functionSource("teleportReaderTo"), /renderer\.xr\.getCamera\(camera\)/);
  assert.match(functionSource("teleportReaderTo"), /readerRig\.position\.add\(destination\.clone\(\)\.sub\(viewerPosition\)\)/);
  assert.doesNotMatch(functionSource("teleportReaderTo"), /readerRig\.position\.copy\(destination\)/);
  assert.match(functionSource("teleportReaderTo"), /camera\.position\.copy\(readerRig\.worldToLocal\(destination\.clone\(\)\)\)/);
  assert.match(functionSource("teleportReaderTo"), /controls\.target\.copy\(destination\)\.addScaledVector\(forward, targetDistance\)/);
  assert.match(functionSource("captureXrEntryPose"), /authoredReaderStationForBeat/);
  assert.match(functionSource("captureXrEntryPose"), /xrEntryWorldQuaternion\.copy\(stationQuaternion\)/);
});

test("physical traversal exposes an authored station zone and never forces camera movement", () => {
  const apply = functionSource("applySpatialTraversalForBeat");
  assert.match(apply, /traversalDestinationRoot\.userData\.readerStation/);
  assert.match(apply, /new THREE\.TorusGeometry/);
  assert.match(apply, /traversalDestinationRoot\.position\.set\(destination\.x, 0, destination\.z\)/);
  assert.match(functionSource("updatePhysicalTraversal"), /traversalDestinationRoot\.position\.set\(destination\.x, 0, destination\.z\)/);
  assert.doesNotMatch(functionSource("updatePhysicalTraversal"), /teleportReaderTo|camera\.position|readerRig\.position/);
  assert.match(functionSource("configureTraversalControls"), /prevButton\.hidden = false/);
  assert.match(functionSource("configureTraversalControls"), /nextButton\.hidden = false/);
  assert.match(functionSource("configureTraversalControls"), /prevButton\.disabled = activeIndex === 0 \|\| isPhysicalLocomotionBoundary\(incoming\)/);
  assert.match(functionSource("configureTraversalControls"), /nextButton\.disabled = !atEnd && isPhysicalLocomotionBoundary\(outgoing\)/);
  assert.match(functionSource("navigateInteraction"), /isPhysicalLocomotionBoundary\(boundary\)/);
  assert.match(functionSource("updatePhysicalTraversal"), /runtimeInteractionForBoundary\(activeIndex, activeIndex \+ 1\)/);
});

test("anchor-relative stations resolve against live source and asset focus", () => {
  const resolve = functionSource("worldReaderPositionForStation");
  assert.match(resolve, /runtimeSourceCameraFocus\(station\.anchorAssetId\)/);
  assert.match(resolve, /runtimeActiveModelFocus\(station\.anchorAssetId\)/);
  assert.match(resolve, /station\.coordinateSpace === "reader"/);
  assert.match(functionSource("applySpatialTraversalForBeat"), /destinationStation\.coordinateSpace !== "reader"/);
  assert.match(functionSource("setBeat"), /applySpatialTraversalForBeat\(beat, previousIndex, progressionRoute\)/);
});

test("configured reader-start destinations stay anchored to the authored source pose", () => {
  const resolve = new Function("THREE", `
    ${functionSource("finiteInteractionArray")}
    ${functionSource("worldReaderPositionForStation")}
    return worldReaderPositionForStation;
  `)(THREE);
  const halfTurn = Math.sin(Math.PI / 4);
  const position = resolve({
    coordinateSpace: "reader-start",
    readerPosition: [0, 0, -2],
    readerStartWorldPosition: [1, 0, 1],
    readerStartWorldQuaternion: [0, halfTurn, 0, halfTurn],
  });
  assert.deepEqual(position.toArray().map((value) => Number(value.toFixed(6))), [-1, 0, 1]);

  const apply = functionSource("applySpatialTraversalForBeat");
  assert.match(apply, /runtimeLocomotionStationForBoundary\(crossedBoundary, previousIndex, activeIndex\)/);
  assert.match(apply, /runtimeLocomotionTolerance\(outgoingBoundary\)/);
  assert.match(functionSource("updatePhysicalTraversal"), /zone\.tolerance\.distanceMeters/);
  assert.match(functionSource("updatePhysicalTraversal"), /zone\.tolerance\.dwellSeconds/);
});
