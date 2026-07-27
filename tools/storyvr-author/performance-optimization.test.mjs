import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizePerformanceOptimizationPlan,
  optimizeCompiledRuntimePerformance,
} from "./engine.mjs";

test("Codex performance settings are clamped to the bounded reader contract", () => {
  const normalized = normalizePerformanceOptimizationPlan({
    profile: "performance",
    settings: {
      desktopPixelRatioCap: 9,
      antialias: false,
      desktopShadows: false,
      xrFramebufferScaleFactor: 0.2,
      xrFixedFoveation: 4,
    },
    summary: "  Favor headset stability.  ",
    bottlenecks: ["Large model", "", "High fill rate"],
    appliedOptimizations: ["Lower render resolution"],
    risks: ["Softer edges"],
  }, {
    generatedAt: "2026-07-26T00:00:00.000Z",
    engine: { provider: "codex-cli", version: "test" },
  });

  assert.equal(normalized.status, "applied");
  assert.equal(normalized.profile, "performance");
  assert.deepEqual(normalized.settings, {
    desktopPixelRatioCap: 2,
    antialias: false,
    desktopShadows: false,
    xrFramebufferScaleFactor: 0.65,
    xrFixedFoveation: 1,
  });
  assert.equal(normalized.summary, "Favor headset stability.");
  assert.deepEqual(normalized.bottlenecks, ["Large model", "High fill rate"]);
});

test("the post-compile optimizer records Codex evidence and an applied audit artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-performance-"));
  const storyFolder = path.join(root, "classroom");
  const performanceOptimizationPath = path.join(storyFolder, "analysis", "storyvr", "performance-optimization.json");
  let receivedContext = null;
  try {
    const result = await optimizeCompiledRuntimePerformance({
      storyFolder,
      performanceOptimizationPath,
    }, {
      slug: "classroom",
      title: "Classroom",
      contentUnits: [{ id: "beat-1" }, { id: "beat-2" }],
      assets: [
        { id: "room.glb", type: "model", path: "models/room.glb", bytes: 4_500_000 },
        { id: "capture.js", type: "script", path: "scripts/capture.js", bytes: 9_000_000 },
      ],
      sourceMotionLinking: { tracks: [{ trackId: "clip-1" }] },
      interactions: { inBeatInteractions: [] },
    }, {
      codexAuthenticated: true,
      codexVersion: "codex-test",
      performanceOptimizationGenerator: async (context) => {
        receivedContext = context;
        return {
          profile: "balanced",
          settings: {
            desktopPixelRatioCap: 1.5,
            antialias: true,
            desktopShadows: false,
            xrFramebufferScaleFactor: 0.78,
            xrFixedFoveation: 0.9,
          },
          summary: "Use a balanced standalone-headset profile.",
          bottlenecks: ["The primary GLB is the dominant renderable payload."],
          appliedOptimizations: ["Reduced desktop and XR fill rate."],
          risks: ["Desktop shadows are disabled."],
        };
      },
    });

    assert.equal(receivedContext.evidence.workload.capturedAssetCount, 2);
    assert.equal(receivedContext.evidence.workload.renderableAssetCount, 1);
    assert.equal(receivedContext.evidence.workload.renderableBytes, 4_500_000);
    assert.equal(result.optimization.status, "applied");
    assert.equal(result.optimization.settings.desktopPixelRatioCap, 1.5);
    assert.equal(result.diagnostics.length, 0);

    const artifact = JSON.parse(await readFile(performanceOptimizationPath, "utf8"));
    assert.equal(artifact.schemaVersion, "storyvr-performance-optimization/v1");
    assert.equal(artifact.engine.provider, "codex-cli");
    assert.equal(artifact.evidence.workload.largestAssets[0].id, "room.glb");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unsigned Codex CLI leaves reader defaults active without failing compilation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-performance-skip-"));
  const storyFolder = path.join(root, "classroom");
  const performanceOptimizationPath = path.join(storyFolder, "analysis", "storyvr", "performance-optimization.json");
  try {
    const result = await optimizeCompiledRuntimePerformance({
      storyFolder,
      performanceOptimizationPath,
    }, {
      slug: "classroom",
      title: "Classroom",
      contentUnits: [],
      assets: [],
    }, {
      codexAuthenticated: false,
    });

    assert.equal(result.optimization.status, "skipped");
    assert.equal(result.optimization.profile, "unchanged");
    assert.equal(result.optimization.settings.xrFramebufferScaleFactor, 0.8);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "CODEX_PERFORMANCE_OPTIMIZATION_SKIPPED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
