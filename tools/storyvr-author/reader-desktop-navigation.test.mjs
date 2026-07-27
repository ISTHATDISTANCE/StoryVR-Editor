import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

const source = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test("compiled desktop readers use fixed-position Reader look with focused WASD movement", () => {
  const reset = functionSource("resetDesktopReaderLookAnchor");
  const stabilize = functionSource("stabilizeDesktopReaderLook");
  const movement = functionSource("updateDesktopKeyboardMovement");
  const render = functionSource("render");

  assert.match(source, /controls\.enablePan = false/);
  assert.match(source, /controls\.enableZoom = false/);
  assert.match(source, /renderer\.domElement\.tabIndex = 0/);
  assert.match(source, /document\.activeElement === renderer\.domElement/);
  assert.match(source, /\["w", "a", "s", "d"\]\.includes\(key\)/);
  assert.match(reset, /desktopReaderLookPosition\.copy\(camera\.position\)/);
  assert.match(stabilize, /camera\.position\.copy\(desktopReaderLookPosition\)/,
    "drag rotation must not orbit the camera away from the reader");
  assert.match(stabilize, /controls\.target\.copy\(desktopReaderLookPosition\)\.addScaledVector/);
  assert.match(movement, /desktopReaderLookPosition\.add\(desktopReaderMovement\)/,
    "WASD must translate the fixed reader anchor");
  assert.match(render, /if \(!renderer\.xr\.isPresenting\) \{\s*updateDesktopKeyboardMovement\(delta\);\s*controls\.update\(\);\s*stabilizeDesktopReaderLook\(\);\s*\}/s);
});

test("desktop Reader look does not replace or rewrite immersive XR camera handling", () => {
  const captureXrEntryPose = functionSource("captureXrEntryPose");
  const alignXrEntryPose = functionSource("alignXrEntryPose");
  const renderCameraForPlayback = functionSource("renderCameraForPlayback");

  assert.match(source, /sessionstart[\s\S]*captureXrEntryPose\(\)[\s\S]*controls\.enabled = false/);
  assert.match(source, /sessionend[\s\S]*controls\.enabled = true/);
  assert.match(captureXrEntryPose, /authoredReaderStationForBeat/);
  assert.match(alignXrEntryPose, /renderer\.xr\.getReferenceSpace\(\)/);
  assert.match(alignXrEntryPose, /readerRig\.position\.copy\(xrEntryWorldPosition\)\.sub\(xrEntryLocalPosition\)/);
  assert.match(renderCameraForPlayback, /return readerCamera/);
  assert.doesNotMatch(renderCameraForPlayback, /return playback\.sourceCamera/);
});

test("desktop movement translates the reader anchor along the current horizontal look direction", () => {
  const createMovement = new Function(
    "renderer",
    "desktopReaderMovementKeys",
    "camera",
    "desktopReaderForward",
    "desktopReaderRight",
    "desktopReaderMovement",
    "controls",
    "desktopReaderLookPosition",
    "DESKTOP_READER_MOVE_SPEED_METERS_PER_SECOND",
    `${functionSource("updateDesktopKeyboardMovement")}
    return updateDesktopKeyboardMovement;`,
  );
  const camera = new THREE.PerspectiveCamera(58, 1.6, 0.01, 100);
  camera.position.set(0, 1.6, 5);
  camera.lookAt(0, 1.6, 0);
  camera.updateMatrixWorld(true);
  const controls = { target: new THREE.Vector3(0, 1.6, 0) };
  const readerPosition = camera.position.clone();
  const move = createMovement(
    { xr: { isPresenting: false } },
    new Set(["w"]),
    camera,
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    controls,
    readerPosition,
    2.8,
  );

  assert.equal(move(0.5), true);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(0, 1.6, 3.6)) < 1e-9);
  assert.ok(readerPosition.distanceTo(camera.position) < 1e-9);
  assert.ok(controls.target.distanceTo(new THREE.Vector3(0, 1.6, -1.4)) < 1e-9);
});
