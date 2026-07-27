import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { importFetchedStoryResources } from "./storyvr-adapter.mjs";

async function writeFixture({ includeEffect = false, includeStandalonePcd = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-pointcloud-adapter-"));
  const metadata = path.join(root, "metadata");
  await mkdir(metadata, { recursive: true });
  await writeFile(path.join(metadata, "source_discovery.json"), JSON.stringify({
    slug: "fixture-story",
    title: "Fixture story",
    story_url: "https://example.com/fixture-story",
  }));
  await writeFile(path.join(metadata, "asset_manifest.json"), JSON.stringify([
    {
      local_path: "models/transmission.glb",
      asset_url: "https://example.com/transmission.glb",
      asset_type: "model",
    },
    ...(includeEffect || includeStandalonePcd ? [{
      local_path: "pointclouds/cough.pcd",
      asset_url: "https://example.com/cough.pcd",
      asset_type: "pointcloud",
    }] : []),
  ]));
  await writeFile(path.join(metadata, "story_structure_candidates.json"), JSON.stringify({
    title: "Fixture story",
    headings: [],
    scroll_steps: [],
    captions: [],
    image_groups: [],
    downloaded_text_matches: [],
    slides: [{
      id: "slide-1",
      text: "A regular visual beat.",
      domOrder: 1,
      attributes: { probeAssetFiles: ["models/transmission.glb"] },
    }],
    text_only_parts: [],
    ...(includeEffect ? {
      point_cloud_effects: [{
        id: "cough-effect",
        schemaVersion: "storyvr-pointcloud-composite-effect/v1",
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
        model: { localPath: "models/transmission.glb" },
        pointCloud: {
          localPath: "pointclouds/cough.pcd",
          driverGroupColumn: { index: 4 },
        },
        reconstructionContract: {
          kind: "fixed-pointcloud-progressive-opacity-reveal",
          groupCount: 1,
          emitTimesSeconds: [{
            groupIndex: 0,
            emitTimeSeconds: 0.7,
            driverNode: "cough_driver_0",
          }],
        },
      }],
    } : {}),
  }));
  return root;
}

test("fetched adapter carries an explicitly declared PCD companion into runtime", async () => {
  const resourceFolder = await writeFixture({ includeEffect: true });
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", {
    storyFolder: path.dirname(resourceFolder),
  });

  assert.equal(runtime.pointCloudEffects.length, 1);
  assert.equal(runtime.pointCloudEffects[0].model.path, "models/transmission.glb");
  assert.equal(runtime.pointCloudEffects[0].pointCloud.path, "pointclouds/cough.pcd");
  assert.equal(runtime.pointCloudEffects[0].scope.requiredForUnrelatedStories, false);
  assert.equal(runtime.rawSummary.pointCloudEffectCount, 1);
});

test("ordinary stories keep their previous runtime shape even when a standalone PCD asset exists", async () => {
  const resourceFolder = await writeFixture({ includeStandalonePcd: true });
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", {
    storyFolder: path.dirname(resourceFolder),
  });

  assert.equal(runtime.assets.some((asset) => asset.type === "pointcloud"), true);
  assert.equal("pointCloudEffects" in runtime, false);
  assert.equal("pointCloudEffectCount" in runtime.rawSummary, false);
});
