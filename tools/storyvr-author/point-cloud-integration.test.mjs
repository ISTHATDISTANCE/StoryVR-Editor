import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyAnimationProbeLinksToGraph,
  ensureReaderApp,
} from "./engine.mjs";

const effect = {
  id: "cough-effect",
  schemaVersion: "storyvr-pointcloud-composite-effect/v1",
  scope: {
    activation: "explicit-source-ptcloud-link-only",
    requiredForUnrelatedStories: false,
  },
  model: { path: "models/transmission.glb" },
  pointCloud: { path: "pointclouds/cough.pcd" },
  reconstruction: {
    kind: "fixed-pointcloud-progressive-opacity-reveal",
    groupCount: 1,
    emitTimes: [{ groupIndex: 0, emitTimeSeconds: 0.7, driverNode: "cough_driver_0" }],
  },
};

function graph() {
  return {
    schemaVersion: "storyvr-source-graph/v1",
    story: { slug: "fixture-story", title: "Fixture story" },
    atomicBeats: [],
    beats: [],
    assetInventory: [],
    textVisualEvidenceLinks: [],
  };
}

test("Source Graph synchronization is conditional and does not turn a missing effect into a requirement", () => {
  const withEffect = applyAnimationProbeLinksToGraph(graph(), {
    slug: "fixture-story",
    assets: [],
    contentUnits: [],
    pointCloudEffects: [effect],
  });
  assert.deepEqual(withEffect.pointCloudEffects, [effect]);

  const staleGraph = { ...graph(), pointCloudEffects: [effect] };
  const ordinary = applyAnimationProbeLinksToGraph(staleGraph, {
    slug: "fixture-story",
    assets: [],
    contentUnits: [],
  });
  assert.equal("pointCloudEffects" in ordinary, false);
  assert.deepEqual(staleGraph.pointCloudEffects, [effect], "synchronization does not mutate the caller's graph");
});

test("generated readers receive the shared optional point-cloud runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-pointcloud-reader-"));
  const storyFolder = path.join(root, "fixture-story");
  const result = await ensureReaderApp({ storyFolder }, {
    slug: "fixture-story",
    title: "Fixture story",
  });
  const outputPath = path.join(storyFolder, "webxr-adaptation", "src", "point-cloud-runtime.js");

  assert.ok(result.provenance.createdFiles.includes("src/point-cloud-runtime.js"));
  assert.match(await readFile(outputPath, "utf8"), /explicit-source-ptcloud-link-only/);
});

test("author previews and the compiled reader both use the shared loader and timeline updater", async () => {
  const authorSource = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
  const readerSource = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

  assert.match(authorSource, /augmentGltfLoaderWithStoryVrPointClouds/);
  assert.match(authorSource, /updateStoryVrPointCloudEffects\(runtime\.root, runtime\.masterDuration \* normalizedProgress\)/);
  assert.match(readerSource, /augmentGltfLoaderWithStoryVrPointClouds/);
  assert.match(readerSource, /updateActivePointCloudEffects\(\)/);
});
