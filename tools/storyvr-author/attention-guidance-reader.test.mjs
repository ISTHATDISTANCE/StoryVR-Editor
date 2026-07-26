import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

const source = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

const readerGuidancePolicy = {
  schemaVersion: "storyvr-attention-reader-guidance/v1",
  completion: {
    distanceMeters: 3,
    distanceMetric: "viewer-to-target-bounds",
    once: true,
    persistence: "story-session",
  },
  arrow: {
    enabled: true,
    visibility: "outside-view-frustum",
    placement: "camera-edge",
  },
  glow: {
    enabled: true,
    mode: "subtle-additive-overlay",
    opacity: 0.14,
  },
};

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function evaluateFunctions(names, exportedName) {
  return new Function(`
    const ATTENTION_COMPLETION_DISTANCE_METERS = 3;
    const ATTENTION_GLOW_OPACITY = 0.14;
    ${names.map(functionSource).join("\n")}
    return ${exportedName};
  `)();
}

const normalizationFunctions = [
  "finiteAttentionPoint",
  "normalizeRuntimeAttentionMarker",
  "attentionSceneRecord",
  "normalizeRuntimeAttentionScene",
  "normalizeRuntimeAttentionSceneMap",
  "normalizeRuntimeAttentionReaderGuidance",
  "normalizeRuntimeAttentionGuidance",
];

const resolverFunctions = [
  "uniqueStrings",
  ...normalizationFunctions,
  "attentionSceneMatches",
  "attentionVariantSceneFromMap",
  "attentionVariantSceneFromRecord",
  "attentionSceneForRuntime",
];

test("reader normalizes only finite compiled attention markers and strips authoring candidates", () => {
  const normalize = evaluateFunctions(normalizationFunctions, "normalizeRuntimeAttentionGuidance");
  const normalizePolicy = evaluateFunctions(
    ["normalizeRuntimeAttentionReaderGuidance"],
    "normalizeRuntimeAttentionReaderGuidance",
  );
  assert.equal(normalizePolicy(null), null, "old metadata-only payloads do not opt into runtime cues");
  const guidance = normalize({
    schemaVersion: "storyvr-attention-guidance/v1",
    inferenceVersion: "clear-visible-renderables-v1",
    coordinateSpace: "spatial-scene",
    inputSignature: "classroom-signature",
    readerGuidance: readerGuidancePolicy,
    resolvedByBeat: {
      "slide-10": {
        beatId: "slide-10",
        evaluated: true,
        evaluation: {
          status: "resolved",
          resolvedCandidateCount: 1,
          rejectedCandidateCount: 3,
        },
        candidates: [{ id: "whole-room-fallback", confidence: 0.2 }],
        markers: [
          {
            id: "window-1",
            assetId: "classroom.glb",
            coordinateSpace: "spatial-scene",
            entityId: "glb:classroom.glb:beat:slide-10",
            partSelector: "window_1",
            targetKind: "named-renderable-part",
            renderableName: "window_1",
            inferredPosition: { x: 7.433, y: 1.572, z: 6.906 },
            position: { x: 7.5, y: 1.6, z: 6.9 },
            manual: true,
            confidence: 1.4,
            provenance: { kind: "visible-renderable-part" },
          },
          {
            id: "invalid-position",
            assetId: "classroom.glb",
            position: { x: 0, y: Number.NaN, z: 0 },
          },
          {
            id: "missing-visible-asset",
            position: { x: 0, y: 1, z: 0 },
          },
          {
            id: "null-is-not-a-coordinate",
            assetId: "classroom.glb",
            position: { x: null, y: 1, z: 0 },
          },
          {
            id: "unsupported-coordinate-space",
            assetId: "classroom.glb",
            coordinateSpace: "world",
            position: { x: 0, y: 1, z: 0 },
          },
        ],
      },
    },
    resolvedByVariant: {
      "beat:slide-10:variant:open": {
        beatId: "slide-10",
        variantOptionId: "open",
        markers: [{ id: "window-2", assetId: "classroom.glb", position: [7.353, 1.422, 6.924] }],
      },
    },
    candidates: [{ id: "authoring-only-root-candidate" }],
  });

  assert.equal(guidance.inputSignature, "classroom-signature");
  assert.equal(guidance.coordinateSpace, "spatial-scene");
  assert.deepEqual(guidance.readerGuidance, readerGuidancePolicy);
  assert.equal(guidance.resolvedByBeat["slide-10"].markers.length, 1);
  assert.equal(guidance.resolvedByBeat["slide-10"].evaluated, true);
  assert.deepEqual(guidance.resolvedByBeat["slide-10"].evaluation, {
    status: "resolved",
    resolvedCandidateCount: 1,
    rejectedCandidateCount: 3,
  });
  assert.equal(guidance.resolvedByBeat["slide-10"].markers[0].coordinateSpace, "spatial-scene");
  assert.deepEqual(guidance.resolvedByBeat["slide-10"].markers[0].position, { x: 7.5, y: 1.6, z: 6.9 });
  assert.equal(guidance.resolvedByBeat["slide-10"].markers[0].targetKind, "named-renderable-part");
  assert.equal(guidance.resolvedByBeat["slide-10"].markers[0].renderableName, "window_1");
  assert.equal(guidance.resolvedByBeat["slide-10"].markers[0].confidence, 1, "confidence is finite and clamped");
  assert.deepEqual(guidance.resolvedByVariant["beat:slide-10:variant:open"].markers[0].position, {
    x: 7.353,
    y: 1.422,
    z: 6.924,
  });
  assert.equal("candidates" in guidance, false);
  assert.equal("candidates" in guidance.resolvedByBeat["slide-10"], false);
  assert.equal("candidates" in guidance.resolvedByVariant["beat:slide-10:variant:open"], false);
});

test("reader resolves attention metadata independently for base beats and within-beat variants", () => {
  const helpers = evaluateFunctions(
    resolverFunctions,
    "({ normalizeRuntimeAttentionGuidance, attentionSceneForRuntime })",
  );
  const guidance = helpers.normalizeRuntimeAttentionGuidance({
    resolvedByBeat: {
      opening: {
        beatId: "opening",
        evaluated: true,
        evaluation: {
          status: "no-clear-visible-renderables",
          resolvedCandidateCount: 0,
          rejectedCandidateCount: 2,
        },
        markers: [],
      },
    },
    resolvedByVariant: {
      "beat:opening:variant:windows": {
        beatId: "opening",
        variantOptionId: "windows",
        markers: [{ id: "windows", assetId: "classroom.glb", position: { x: 7.4, y: 1.5, z: 6.9 } }],
      },
    },
  });
  const beat = { id: "opening" };

  assert.deepEqual(
    helpers.attentionSceneForRuntime(guidance, [], beat, 0, null).markers,
    [],
    "a zero-marker base scene remains a valid explicit no-attention state",
  );
  assert.equal(
    helpers.attentionSceneForRuntime(guidance, [], beat, 0, null).evaluation.status,
    "no-clear-visible-renderables",
  );
  assert.equal(
    helpers.attentionSceneForRuntime(guidance, [], beat, 0, { id: "windows" }).markers[0].partSelector,
    undefined,
  );
  assert.equal(
    helpers.attentionSceneForRuntime(guidance, [], beat, 0, { id: "windows" }).markers[0].id,
    "windows",
  );

  const timeline = [{
    attentionGuidance: {
      beatId: "opening",
      variantsByOptionId: {
        windows: {
          beatId: "opening",
          variantOptionId: "windows",
          markers: [{ id: "timeline-window", assetId: "classroom.glb", position: { x: 1, y: 2, z: 3 } }],
        },
      },
    },
  }];
  assert.equal(
    helpers.attentionSceneForRuntime(guidance, timeline, beat, 0, { id: "windows" }).markers[0].id,
    "timeline-window",
    "unit-scoped compiled metadata takes precedence when present",
  );
});

test("reader requires the versioned cue policy and leaves old attention payloads metadata-only", () => {
  const normalize = evaluateFunctions(normalizationFunctions, "normalizeRuntimeAttentionGuidance");
  const legacy = normalize({
    schemaVersion: "storyvr-attention-guidance/v1",
    resolvedByBeat: {
      opening: {
        beatId: "opening",
        evaluated: true,
        markers: [{ id: "legacy", assetId: "classroom.glb", position: { x: 1, y: 2, z: 3 } }],
      },
    },
  });
  assert.equal(legacy.readerGuidance, null);
  const normalizePolicy = functionSource("normalizeRuntimeAttentionReaderGuidance");
  const activate = functionSource("activateRuntimeAttentionGuidance");
  assert.match(normalizePolicy, /schemaVersion\s*!==\s*"storyvr-attention-reader-guidance\/v1"/);
  assert.match(activate, /readerGuidance/);
});

test("attention cue decisions enforce an exact 3 meter one-shot threshold", () => {
  const decide = evaluateFunctions(["attentionCueFrameDecision"], "attentionCueFrameDecision");

  assert.deepEqual(decide({
    completed: false,
    targetVisible: true,
    distanceToBounds: 3.01,
    completionDistanceMeters: 3,
    inFieldOfView: false,
  }), {
    shouldComplete: false,
    showArrow: true,
    showGlow: true,
  });
  assert.deepEqual(decide({
    completed: false,
    targetVisible: true,
    distanceToBounds: 3,
    completionDistanceMeters: 3,
    inFieldOfView: false,
  }), {
    shouldComplete: true,
    showArrow: false,
    showGlow: false,
  }, "the boundary itself completes without a cue flash");
  assert.deepEqual(decide({
    completed: true,
    targetVisible: true,
    distanceToBounds: 8,
    completionDistanceMeters: 3,
    inFieldOfView: false,
  }), {
    shouldComplete: false,
    showArrow: false,
    showGlow: false,
  }, "moving away cannot revive a completed cue");
  assert.deepEqual(decide({
    completed: false,
    targetVisible: false,
    distanceToBounds: 1,
    completionDistanceMeters: 3,
    inFieldOfView: false,
  }), {
    shouldComplete: false,
    showArrow: false,
    showGlow: false,
  }, "an unresolved or hidden target never receives fallback guidance");
  assert.deepEqual(decide({
    completed: false,
    targetVisible: true,
    distanceToBounds: 8,
    completionDistanceMeters: 3,
    inFieldOfView: true,
  }), {
    shouldComplete: false,
    showArrow: false,
    showGlow: true,
  }, "a distant target in view keeps only its subtle glow");
});

test("completion identity is stable per authored attention cue and persists for the story session", () => {
  const keyFor = evaluateFunctions(["attentionCompletionKey"], "attentionCompletionKey");
  const scene = { sceneKey: "beat:slide-10:variant:open", beatId: "slide-10", variantOptionId: "open" };
  const marker = { id: "window-1", assetId: "classroom.glb", partSelector: "window_1" };
  assert.equal(keyFor(scene, marker), keyFor({ ...scene }, { ...marker }));
  assert.notEqual(keyFor(scene, marker), keyFor(scene, { ...marker, id: "window-2" }));
  assert.notEqual(keyFor(scene, marker), keyFor({ ...scene, sceneKey: "beat:slide-11" }, marker));

  const activate = functionSource("activateRuntimeAttentionGuidance");
  const complete = functionSource("completeRuntimeAttentionTarget");
  const update = functionSource("updateRuntimeAttentionGuidance");
  const clear = functionSource("clearRuntimeAttentionCues");
  assert.match(`${activate}\n${update}`, /completedRuntimeAttentionKeys\.has\(/);
  assert.match(complete, /completedRuntimeAttentionKeys\.add\(/);
  assert.doesNotMatch(source, /completedRuntimeAttentionKeys\.(?:clear|delete)\(/, "beat, variant, and XR lifecycle cleanup never clears completion");
  assert.match(clear, /restoreRuntimeAttentionEffect/);
  assert.doesNotMatch(clear, /completedRuntimeAttentionKeys/, "visual cleanup is separate from the session completion latch");
});

test("reader renders camera-edge arrows and animated investigation-point sparkles, never model glows or authoring spheres", () => {
  const arrow = functionSource("createRuntimeAttentionArrow");
  const texture = functionSource("createRuntimeInvestigationTexture");
  const create = functionSource("createRuntimeAttentionSparkle");
  const sync = functionSource("syncRuntimeAttentionSparkle");
  const apply = functionSource("applyRuntimeAttentionSparkles");
  const restore = functionSource("restoreRuntimeAttentionEffect");
  assert.match(arrow, /new THREE\.(?:ShapeGeometry|BufferGeometry|ConeGeometry)/);
  assert.match(arrow, /depthTest:\s*false/);
  assert.match(arrow, /depthWrite:\s*false/);
  assert.match(arrow, /renderOrder/);
  assert.match(arrow, /frustumCulled\s*=\s*false/);
  assert.doesNotMatch(arrow, /SphereGeometry|CircleGeometry/);
  assert.match(texture, /createRadialGradient/);
  assert.match(texture, /diamond\(3, 35/);
  assert.match(create, /new THREE\.SpriteMaterial/);
  assert.match(create, /THREE\.AdditiveBlending/);
  assert.match(create, /THREE\.NormalBlending/);
  assert.match(create, /Array\.from\(\{ length: 7 \}/);
  assert.match(create, /StoryVR investigation sparkle/);
  assert.match(sync, /Math\.sin\(time \* 5\.4\)/);
  assert.match(sync, /bounds\.max\.y/);
  assert.match(sync, /sphere\.radius \* 0\.52/);
  assert.match(sync, /mote\.position\.set/);
  assert.match(sync, /mote\.material\.opacity/);
  assert.match(apply, /readerGuidance\?\.glow\?\.opacity/);
  assert.match(apply, /group\.investigationEffect/);
  const disposeSparkle = functionSource("disposeRuntimeAttentionSparkle");
  assert.match(restore, /disposeRuntimeAttentionSparkle/);
  assert.match(disposeSparkle, /removeFromParent|\.remove\(/);
  assert.match(disposeSparkle, /texture\?\.dispose/);
  assert.doesNotMatch(
    [texture, create, sync, apply, restore].join("\n"),
    /mesh\.clone\(false\)|BackSide|Attention halo|Attention sphere/i,
    "the new cue never wraps or tints the source model",
  );
});

test("reader uses the active desktop or XR viewer and shows arrows only outside its field of view", () => {
  const viewerCamera = functionSource("runtimeAttentionViewerCamera");
  const inFieldOfView = functionSource("runtimeAttentionTargetInFieldOfView");
  const smoothArrow = functionSource("smoothAttentionArrowAngle");
  const positionArrow = functionSource("positionRuntimeAttentionArrow");
  const update = functionSource("updateRuntimeAttentionGuidance");
  assert.match(viewerCamera, /renderer\.xr\.isPresenting/);
  assert.match(viewerCamera, /renderCamera\.updateWorldMatrix\(true, false\)/);
  assert.match(viewerCamera, /renderer\.xr\.updateCamera\(renderCamera\)/);
  assert.match(viewerCamera, /renderer\.xr\.getCamera\((?:camera)?\)/);
  assert.match(viewerCamera, /activeRenderCamera\(\)/);
  assert.match(inFieldOfView, /Frustum|\.project\(/);
  assert.match(positionArrow, /camera-edge|clamp|Math\.(?:min|max)/i);
  assert.match(positionArrow, /targetIndex/);
  assert.match(positionArrow, /smoothAttentionArrowAngle/);
  assert.match(smoothArrow, /Math\.exp/);
  assert.match(smoothArrow, /ATTENTION_ARROW_MAX_ANGULAR_SPEED_RADIANS_PER_SECOND/);
  assert.match(update, /attentionCueFrameDecision/);
  assert.match(update, /runtimeAttentionTargetInFieldOfView/);
  assert.match(update, /positionRuntimeAttentionArrow/);
  assert.match(update, /inFieldOfView/);
  assert.match(update, /showArrow/);
  assert.match(update, /showGlow/);
  assert.match(update, /runtimeAttentionViewerCamera/);
  assert.match(update, /indicatorCamera\s*=\s*viewerCamera/);
  assert.match(update, /distanceToBounds/);
  assert.match(update, /readerGuidance/);
  assert.match(functionSource("render"), /updateRuntimeAttentionGuidance/);
});

test("attention arrow direction damping follows the shortest turn with a bounded per-frame step", () => {
  const smooth = new Function(`
    const ATTENTION_ARROW_DIRECTION_RESPONSE = 10;
    const ATTENTION_ARROW_MAX_ANGULAR_SPEED_RADIANS_PER_SECOND = Math.PI * 3;
    ${functionSource("smoothAttentionArrowAngle")}
    return smoothAttentionArrowAngle;
  `)();
  const frameSeconds = 1 / 60;
  const wrapStart = Math.PI - 0.04;
  const wrapEnd = -Math.PI + 0.04;
  const wrapped = smooth(wrapStart, wrapEnd, frameSeconds);
  const wrappedStep = Math.atan2(
    Math.sin(wrapped - wrapStart),
    Math.cos(wrapped - wrapStart),
  );
  assert.ok(wrappedStep > 0 && wrappedStep < 0.04, "the arrow crosses the angle wrap without reversing or snapping");

  const halfTurn = smooth(0, Math.PI, frameSeconds);
  assert.ok(
    Math.abs(halfTurn) <= ATTENTION_ARROW_TEST_MAX_STEP(frameSeconds) + 1e-9,
    "a sudden behind-view flip is limited to a smooth per-frame turn",
  );
});

function ATTENTION_ARROW_TEST_MAX_STEP(deltaSeconds) {
  return Math.PI * 3 * deltaSeconds;
}

test("XR attention refreshes and uses the current active render camera", () => {
  let updatedCamera = null;
  const xrCamera = {};
  const renderer = {
    xr: {
      isPresenting: true,
      updateCamera(value) { updatedCamera = value; },
      getCamera() { return xrCamera; },
    },
  };
  const resolveCamera = new Function("renderer", "activeRenderCamera", `
    ${functionSource("runtimeAttentionViewerCamera")}
    return runtimeAttentionViewerCamera;
  `)(renderer, () => null);
  const activeRenderCamera = {
    updatedWorldMatrix: null,
    updateWorldMatrix(updateParents, updateChildren) {
      this.updatedWorldMatrix = [updateParents, updateChildren];
    },
  };

  assert.equal(resolveCamera(activeRenderCamera), xrCamera);
  assert.deepEqual(activeRenderCamera.updatedWorldMatrix, [true, false]);
  assert.equal(updatedCamera, activeRenderCamera);
  renderer.xr.isPresenting = false;
  assert.equal(resolveCamera(activeRenderCamera), activeRenderCamera);
});

test("field-of-view math distinguishes visible, offscreen, and behind-viewer bounds", () => {
  const inFieldOfView = new Function("THREE", `
    const runtimeAttentionProjectionMatrix = new THREE.Matrix4();
    const runtimeAttentionFrustum = new THREE.Frustum();
    ${functionSource("runtimeAttentionTargetInFieldOfView")}
    return runtimeAttentionTargetInFieldOfView;
  `)(THREE);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const boxAt = (x, y, z) => new THREE.Box3(
    new THREE.Vector3(x - 0.25, y - 0.25, z - 0.25),
    new THREE.Vector3(x + 0.25, y + 0.25, z + 0.25),
  );
  assert.equal(inFieldOfView(boxAt(0, 0, -5), camera), true);
  assert.equal(inFieldOfView(boxAt(8, 0, -5), camera), false);
  assert.equal(inFieldOfView(boxAt(0, 0, 5), camera), false);
});

test("an offscreen target produces an arrow that projects inside the camera edge", () => {
  const helpers = new Function("THREE", `
    const ATTENTION_ARROW_EDGE_NDC = 0.72;
    const ATTENTION_ARROW_DISTANCE_METERS = 0.86;
    const ATTENTION_ARROW_RADIUS_METERS = 0.12;
    const ATTENTION_ARROW_RADIUS_NDC = 0.09;
    const ATTENTION_ARROW_DIRECTION_RESPONSE = 10;
    const ATTENTION_ARROW_MAX_ANGULAR_SPEED_RADIANS_PER_SECOND = Math.PI * 3;
    const runtimeAttentionArrowTarget = new THREE.Vector3();
    const runtimeAttentionArrowLocalTarget = new THREE.Vector3();
    const runtimeAttentionArrowNdc = new THREE.Vector3();
    const runtimeAttentionArrowWorld = new THREE.Vector3();
    const runtimeAttentionArrowCameraPosition = new THREE.Vector3();
    const runtimeAttentionArrowCameraQuaternion = new THREE.Quaternion();
    const scene = new THREE.Scene();
    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    ${functionSource("finiteAttentionPoint")}
    ${functionSource("createRuntimeAttentionArrow")}
    ${functionSource("smoothAttentionArrowAngle")}
    ${functionSource("positionRuntimeAttentionArrow")}
    return { createRuntimeAttentionArrow, positionRuntimeAttentionArrow, scene };
  `)(THREE);
  const camera = new THREE.PerspectiveCamera(24, 0.55, 0.1, 100);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const arrow = helpers.createRuntimeAttentionArrow({ id: "offscreen-target" });
  const target = {
    arrow,
    marker: { manual: false },
    bounds: new THREE.Box3(
      new THREE.Vector3(7.75, 5.35, -5.25),
      new THREE.Vector3(8.25, 5.85, -4.75),
    ),
  };

  assert.equal(helpers.positionRuntimeAttentionArrow(target, camera, camera, 0), true);
  assert.equal(arrow.parent, helpers.scene);
  const projected = arrow.position.clone().project(camera);
  assert.ok(Math.abs(projected.x) <= 0.8 && Math.abs(projected.y) <= 0.8);
  assert.ok(Math.abs(projected.x) >= 0.65, "the arrow stays near the edge rather than covering the story center");
  assert.ok(arrow.scale.x < 1, "narrow cameras shrink the arrow to preserve a safe edge margin");
  helpers.scene.updateMatrixWorld(true);
  const arrowMesh = arrow.children[0];
  const positions = arrowMesh.geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) {
    const vertex = new THREE.Vector3()
      .fromBufferAttribute(positions, index)
      .applyMatrix4(arrowMesh.matrixWorld)
      .project(camera);
    assert.ok(Math.abs(vertex.x) <= 0.98 && Math.abs(vertex.y) <= 0.98, "the full arrow stays visible");
  }
  arrowMesh.geometry.dispose();
  arrowMesh.material.dispose();
});

test("animated instanced targets refresh both bounds and compact sparkle anchors", () => {
  const helpers = new Function("THREE", `
    const ATTENTION_GLOW_OPACITY = 0.14;
    const runtimeAttentionMeshBounds = new THREE.Box3();
    ${functionSource("runtimeAttentionTargetBounds")}
    ${functionSource("syncRuntimeAttentionSparkle")}
    return { runtimeAttentionTargetBounds, syncRuntimeAttentionSparkle };
  `)(THREE);
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const sourceMaterial = new THREE.MeshBasicMaterial({ color: 0x335577 });
  const mesh = new THREE.InstancedMesh(geometry, sourceMaterial, 1);
  root.add(mesh);
  root.updateMatrixWorld(true);
  const target = { bounds: new THREE.Box3() };
  const initialCenter = helpers.runtimeAttentionTargetBounds(target, [mesh])
    .getCenter(new THREE.Vector3())
    .clone();

  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(5, 0, 0));
  mesh.instanceMatrix.needsUpdate = true;
  const movedCenter = helpers.runtimeAttentionTargetBounds(target, [mesh])
    .getCenter(new THREE.Vector3())
    .clone();
  assert.ok(Math.abs(initialCenter.x) < 0.001);
  assert.ok(Math.abs(movedCenter.x - 5) < 0.001, "completion distance follows live instance matrices");

  const sprite = () => ({
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    material: { opacity: 0, rotation: 0 },
  });
  const effect = {
    root: new THREE.Group(),
    bloom: sprite(),
    shaft: sprite(),
    flare: sprite(),
    flareSecondary: sprite(),
    motes: Array.from({ length: 7 }, sprite),
    elapsedSeconds: 0,
    phase: 0,
  };
  const bounds = helpers.runtimeAttentionTargetBounds(target, [mesh]);
  helpers.syncRuntimeAttentionSparkle(effect, bounds, true, 1 / 60, 0.14);
  assert.ok(Math.abs(effect.root.position.x - 5) < 0.001, "the sparkle follows the live target bounds");
  assert.ok(effect.root.position.y > bounds.max.y, "the point floats compactly above the target");
  assert.ok(effect.root.scale.x <= 0.48, "the cue stays a point instead of covering the whole model");
  const firstMoteY = effect.motes[0].position.y;
  helpers.syncRuntimeAttentionSparkle(effect, bounds, true, 1 / 30, 0.14);
  assert.notEqual(effect.motes[0].position.y, firstMoteY, "spark motes continue rising between frames");

  geometry.dispose();
  sourceMaterial.dispose();
});

test("a motion-bound authored model keeps its existing attention cue identity", () => {
  const scene = new THREE.Scene();
  const motionRoot = new THREE.Group();
  const authorTransformRoot = new THREE.Group();
  authorTransformRoot.userData.spatialEntityId = "glb:hammer.glb:beat:florida";
  const model = new THREE.Group();
  model.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x335577 }),
  ));
  authorTransformRoot.add(model);
  motionRoot.add(authorTransformRoot);
  motionRoot.position.x = 5;
  scene.add(motionRoot);
  const resolveMotionBound = new Function(
    "THREE",
    "activeModel",
    "activeModelAsset",
    "activeSourceAnimation",
    "modelAuthorTransformRoot",
    "activeSupplementalModelEntries",
    `
      ${functionSource("attentionCompletionKey")}
      ${functionSource("runtimeAttentionSelectorIsExact")}
      ${functionSource("resolveRuntimeAttentionTarget")}
      return resolveRuntimeAttentionTarget;
    `,
  )(THREE, model, { id: "hammer.glb" }, null, authorTransformRoot, []);
  const target = resolveMotionBound(
    { sceneKey: "beat:florida", beatId: "florida" },
    {
      id: "hammer",
      assetId: "hammer.glb",
      entityId: "glb:hammer.glb:beat:florida",
      coordinateSpace: "spatial-scene",
      targetKind: "standalone-glb",
    },
  );

  assert.ok(target);
  assert.equal(target.groups.length, 1);
  assert.equal(target.meshes.length, 1);
  assert.equal(target.modelEntry.authorTransformRoot, authorTransformRoot);
  model.traverse((object) => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
});

test("hidden authored ancestors are rejected and multi-target proximity uses the nearest instance", () => {
  const isVisible = new Function("THREE", `
    ${functionSource("runtimeAttentionMeshHasVisibleMaterial")}
    ${functionSource("runtimeAttentionMeshIsVisible")}
    return runtimeAttentionMeshIsVisible;
  `)(THREE);
  const wrapper = new THREE.Group();
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x335577 }),
  );
  root.add(mesh);
  wrapper.add(root);
  wrapper.visible = false;
  assert.equal(isVisible(mesh, root), false, "a hidden authored wrapper is not a rendered target");
  wrapper.visible = true;
  assert.equal(isVisible(mesh, root), true);

  const helpers = new Function("THREE", `
    const runtimeAttentionMeshBounds = new THREE.Box3();
    ${functionSource("runtimeAttentionTargetBounds")}
    ${functionSource("runtimeAttentionTargetDistanceToPoint")}
    return { runtimeAttentionTargetBounds, runtimeAttentionTargetDistanceToPoint };
  `)(THREE);
  const scene = new THREE.Scene();
  const groups = [-5, 5].map((x) => {
    const groupRoot = new THREE.Group();
    const groupMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x335577 }),
    );
    groupRoot.position.x = x;
    groupRoot.add(groupMesh);
    scene.add(groupRoot);
    return { root: groupRoot, meshes: [groupMesh], bounds: new THREE.Box3() };
  });
  scene.updateMatrixWorld(true);
  const target = {
    bounds: new THREE.Box3(),
    groups,
    meshes: groups.flatMap((group) => group.meshes),
  };
  const bounds = helpers.runtimeAttentionTargetBounds(target, target.meshes);
  assert.equal(bounds.distanceToPoint(new THREE.Vector3()), 0,
    "the combined school box surrounds the reader");
  assert.ok(Math.abs(
    helpers.runtimeAttentionTargetDistanceToPoint(target, new THREE.Vector3()) - 4.5,
  ) < 0.001, "completion uses the nearest real authored target instead of the combined bounds");

  mesh.geometry.dispose();
  mesh.material.dispose();
  for (const group of groups) {
    group.meshes[0].geometry.dispose();
    group.meshes[0].material.dispose();
  }
});

test("reader resolves only visible loaded GLB targets and cleans cues across asynchronous scene changes", () => {
  const resolve = functionSource("resolveRuntimeAttentionTarget");
  const visibleMaterial = functionSource("runtimeAttentionMeshHasVisibleMaterial");
  const visible = functionSource("runtimeAttentionMeshIsVisible");
  const bounds = functionSource("runtimeAttentionTargetBounds");
  const activate = functionSource("activateRuntimeAttentionGuidance");
  const clear = functionSource("clearRuntimeAttentionCues");
  const disposeArrow = functionSource("disposeRuntimeAttentionArrow");
  const update = functionSource("updateRuntimeAttentionGuidance");
  const setBeat = functionSource("setBeat");
  assert.match(resolve, /activeModel/);
  assert.match(resolve, /activeSupplementalModelEntries/);
  assert.doesNotMatch(resolve, /activeProceduralDynamicsEntries|proceduralDynamicsEntry/,
    "motion reuses authored targets instead of adding duplicate attention roots");
  assert.match(resolve, /authorTransformRoot\?\.userData\?\.spatialEntityId/);
  assert.match(resolve, /entityId/);
  assert.match(resolve, /partSelector/);
  assert.match(resolve, /sourcePartSelectorMatchesNode/);
  assert.match(update, /runtimeAttentionMeshIsVisible/);
  assert.match(update, /runtimeAttentionTargetDistanceToPoint/);
  assert.match(update, /target\.rootsByMesh\?\.get\(mesh\) \|\| target\.root/);
  assert.match(visible, /visible\s*===\s*false/);
  assert.match(visible, /runtimeAttentionMeshHasVisibleMaterial/);
  assert.match(visibleMaterial, /opacity/);
  assert.match(`${resolve}\n${bounds}`, /new THREE\.Box3/);
  assert.match(bounds, /boundingBox|setFromObject/);
  assert.match(activate, /resolveRuntimeAttentionTarget/);
  assert.match(activate, /if \(!target\s*\|\|/);
  assert.match(clear, /disposeRuntimeAttentionArrow/);
  assert.match(disposeArrow, /removeFromParent|\.remove\(/);
  assert.match(disposeArrow, /dispose/);
  assert.match(setBeat, /clearRuntimeAttentionCues/);
  assert.match(setBeat, /activateRuntimeAttentionGuidance/);
  assert.match(setBeat, /loadRevision/);
  assert.ok(
    setBeat.indexOf("clearRuntimeAttentionCues") < setBeat.indexOf("activateRuntimeAttentionGuidance"),
    "the previous cue is cleared before the newly loaded scene is activated",
  );
  assert.match(functionSource("clearModel"), /clearRuntimeAttentionCues/);
});
