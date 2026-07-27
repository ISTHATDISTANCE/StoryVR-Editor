import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  attachStoryVrPointCloudCompanion,
  augmentGltfLoaderWithStoryVrPointClouds,
  normalizeStoryVrPointCloudEffects,
  parseStoryVrAsciiPcd,
  pointCloudEffectForModelSource,
  updateStoryVrPointCloudEffects,
} from "./point-cloud-runtime.js";

function rawEffect(id = "cough-effect") {
  return {
    id,
    schemaVersion: "storyvr-pointcloud-composite-effect/v1",
    captureStatus: "complete",
    scope: {
      activation: "explicit-source-ptcloud-link-only",
      specialization: "transmission-cough-story",
      requiredForUnrelatedStories: false,
    },
    sourceLink: {
      transform: {
        position: "0, 0, 0",
        rotation: "0, 0, 0",
        scale: "100, 100, 100",
      },
    },
    model: {
      localPath: "models/transmission.glb",
      file: "transmission.glb",
    },
    pointCloud: {
      localPath: "pointclouds/cough.pcd",
      file: "cough.pcd",
      driverGroupColumn: { index: 4 },
    },
    reconstructionContract: {
      kind: "fixed-pointcloud-progressive-opacity-reveal",
      sourcePointMotion: "fixed",
      revealMechanism: "group opacity gates",
      groupCount: 2,
      fadeDurationSeconds: 0.1,
      emitTimesSeconds: [
        { groupIndex: 0, emitTimeSeconds: 0.5, driverNode: "cough_driver_0" },
        { groupIndex: 1, emitTimeSeconds: 1, driverNode: "cough_driver_1" },
      ],
    },
  };
}

function fixturePcd() {
  return [
    "# .PCD v.7",
    "VERSION .7",
    "FIELDS x y z rgb",
    "SIZE 4 4 4 4",
    "TYPE F F F F",
    "COUNT 1 1 1 1",
    "WIDTH 3",
    "HEIGHT 1",
    "VIEWPOINT 0 0 0 1 0 0 0",
    "POINTS 3",
    "DATA ascii",
    "1 2 3 4 0",
    "4 5 6 8 1",
    "7 8 9 6 1",
    "",
  ].join("\n");
}

function normalizedEffect(id = "cough-effect") {
  const effects = normalizeStoryVrPointCloudEffects([rawEffect(id)], [
    { id: "transmission-model", type: "model", path: "models/transmission.glb" },
    { id: "cough-points", type: "pointcloud", path: "pointclouds/cough.pcd" },
  ]);
  assert.equal(effects.length, 1);
  return effects[0];
}

function responseFor(text) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => text,
  };
}

test("normalization accepts only the explicit optional composite-effect contract", () => {
  const effect = normalizedEffect();
  assert.equal(effect.scope.activation, "explicit-source-ptcloud-link-only");
  assert.equal(effect.scope.requiredForUnrelatedStories, false);
  assert.equal(effect.modelAssetId, "transmission-model");
  assert.equal(effect.pointCloudAssetId, "cough-points");
  assert.deepEqual(effect.modelTransform.scale, [100, 100, 100]);

  assert.deepEqual(normalizeStoryVrPointCloudEffects([]), []);
  assert.deepEqual(normalizeStoryVrPointCloudEffects([{
    ...rawEffect(),
    scope: { activation: "inferred-from-missing-data" },
  }]), []);
  assert.deepEqual(normalizeStoryVrPointCloudEffects([{
    ...rawEffect(),
    reconstructionContract: { kind: "generic-particle-spray" },
  }]), []);
});

test("ASCII PCD decoding preserves the source coordinate, color, size, and group mapping", () => {
  const parsed = parseStoryVrAsciiPcd(fixturePcd(), normalizedEffect());
  assert.equal(parsed.pointCount, 3);
  assert.equal(parsed.groupCount, 2);
  assert.deepEqual(Array.from(parsed.layers[0].positions), [1, 3, -2]);
  assert.deepEqual(Array.from(parsed.layers[0].colors), [1, 1, 1]);
  assert.ok(Math.abs(parsed.layers[0].sizes[0] - 0.9) < 1e-6);
  assert.deepEqual(Array.from(parsed.layers[1].positions), [4, 6, -5, 7, 9, -8]);
  assert.equal(parsed.layers[1].sizes[0], 2);
  assert.ok(Math.abs(parsed.layers[1].sizes[1] - 0.9) < 1e-6);
  assert.ok(Math.abs(parsed.layers[1].colors[0] - (48 / 255)) < 1e-6);
  assert.ok(Math.abs(parsed.layers[1].colors[1] - (164 / 255)) < 1e-6);
  assert.ok(Math.abs(parsed.layers[1].colors[2] - (228 / 255)) < 1e-6);
});

test("the companion applies the captured model transform and follows live driver opacity", async () => {
  const effect = normalizedEffect("driver-effect");
  const avatar = new THREE.Group();
  avatar.name = "avatar";
  const driver0 = new THREE.Object3D();
  driver0.name = "cough_driver_0";
  const driver1 = new THREE.Object3D();
  driver1.name = "cough_driver_1";
  avatar.add(driver0, driver1);
  const scene = new THREE.Group();
  scene.add(avatar);
  const gltf = { scene };

  const companion = await attachStoryVrPointCloudCompanion({
    THREE,
    gltf,
    effect,
    pointCloudUrl: "/pointclouds/cough.pcd",
    fetchImpl: async () => responseFor(fixturePcd()),
  });

  assert.equal(companion.parent, scene);
  assert.deepEqual(avatar.scale.toArray(), [100, 100, 100]);
  assert.equal(scene.children.length, 2, "the PCD remains a sibling of the source-scaled model");
  const layer0 = scene.getObjectByName("cough_layer_0");
  const layer1 = scene.getObjectByName("cough_layer_1");
  assert.equal(layer0.visible, false, "the companion starts at the source timeline origin");
  assert.equal(layer0.material.uniforms.globalOpacity.value, 0);
  assert.equal(layer1.visible, false);
  assert.equal(layer1.material.uniforms.globalOpacity.value, 0);

  driver0.position.x = 0;
  driver1.position.x = 0.0075;
  assert.equal(updateStoryVrPointCloudEffects(scene, 99), 2);
  assert.equal(layer0.visible, false);
  assert.equal(layer0.material.uniforms.globalOpacity.value, 0);
  assert.equal(layer1.visible, true);
  assert.equal(layer1.material.uniforms.globalOpacity.value, 0.75);

  updateStoryVrPointCloudEffects(scene, 0.55, { preferDrivers: false });
  assert.ok(Math.abs(layer0.material.uniforms.globalOpacity.value - 0.5) < 1e-9);
  assert.equal(layer1.visible, false);
});

test("GLTF loader augmentation is a no-op for unrelated models and nonfatal for missing companions", async () => {
  const effect = normalizedEffect("loader-effect");
  let fetchCount = 0;
  const createLoader = () => ({
    userData: {},
    load(url, onLoad) {
      const scene = new THREE.Group();
      scene.add(new THREE.Group());
      onLoad({ scene, sourceUrl: url });
      return { sourceUrl: url };
    },
  });

  const unrelatedLoader = augmentGltfLoaderWithStoryVrPointClouds(createLoader(), {
    THREE,
    effects: [effect],
    pointCloudUrlForEffect: () => "/pointclouds/cough.pcd",
    fetchImpl: async () => {
      fetchCount += 1;
      return responseFor(fixturePcd());
    },
  });
  const unrelated = await new Promise((resolve) => unrelatedLoader.load("/models/ordinary.glb", resolve));
  assert.equal(unrelated.sourceUrl, "/models/ordinary.glb");
  assert.equal(fetchCount, 0);

  let diagnostic = "";
  const matchingLoader = augmentGltfLoaderWithStoryVrPointClouds(createLoader(), {
    THREE,
    effects: [effect],
    pointCloudUrlForEffect: () => "/pointclouds/missing.pcd",
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: false, status: 404, headers: { get: () => null } };
    },
    onDiagnostic: (error) => {
      diagnostic = error.message;
    },
  });
  const matched = await new Promise((resolve) => matchingLoader.load("/models/transmission.glb", resolve));
  assert.equal(fetchCount, 1);
  assert.match(diagnostic, /HTTP 404/);
  assert.match(matched.userData.storyvrPointCloudError, /HTTP 404/);
  assert.equal(matched.scene.children.length, 1, "the GLB still loads when its optional PCD fails");
  assert.equal(pointCloudEffectForModelSource([effect], "/models/ordinary.glb"), null);

  const retryGltf = { scene: new THREE.Group() };
  retryGltf.scene.add(new THREE.Group());
  await attachStoryVrPointCloudCompanion({
    THREE,
    gltf: retryGltf,
    effect,
    pointCloudUrl: "/pointclouds/missing.pcd",
    fetchImpl: async () => {
      fetchCount += 1;
      return responseFor(fixturePcd());
    },
  });
  assert.equal(fetchCount, 2, "a transient companion failure is not retained in the parse cache");
  assert.ok(retryGltf.scene.getObjectByName("storyvr-pointcloud-effect:loader-effect"));
});
