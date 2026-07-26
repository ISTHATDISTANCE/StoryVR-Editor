import assert from "node:assert/strict";
import test from "node:test";

import {
  clampProceduralDynamicsPlan,
  expandProceduralDynamicsInstances,
  normalizeProceduralDynamicsPlan,
  proceduralDynamicsInstanceLimit,
  proceduralDynamicsPlansForScene,
  proceduralDynamicsSceneKey,
  sampleProceduralDynamicsTransform,
} from "./procedural-dynamics-runtime.js";

function canonicalPlan(overrides = {}) {
  return {
    id: "shark-motion",
    scope: { beatId: "slide-1" },
    seed: 42,
    anchor: { space: "reader-start", offsetMeters: [0, 0, 0] },
    actors: [
      {
        actorId: "hammerhead-motion",
        entityId: "glb:hammer.glb:beat:slide-1",
        assetId: "hammer.glb",
        clip: { index: 0, name: "Swim" },
        trajectory: {
          kind: "school-orbit",
          radiusMeters: [2.4, 3.4],
          heightMeters: [-0.4, 0.5],
          angularSpeedRadiansPerSecond: [0.12, 0.24],
          direction: "mixed",
          verticalSwayMeters: [0.1, 0.2],
        },
        orientation: { kind: "path-tangent", modelForwardAxis: "+Z" },
        animation: { mode: "loop", phase: "staggered", timeScale: [0.9, 1.1] },
      },
      {
        actorId: "white-shark-motion",
        entityId: "glb:white.glb:beat:slide-1",
        assetId: "white.glb",
        clip: { indexes: [1] },
        trajectory: {
          kind: "waypoint-loop",
          waypoints: [[-2, 0, -2], [0, 0.5, -3], [2, 0, -2], [0, -0.25, 2]],
          durationSeconds: [9, 12],
        },
      },
    ],
    comfort: {
      minimumViewerDistanceMeters: 1.5,
      maximumSpeedMetersPerSecond: 1.2,
    },
    lifecycle: { fadeInSeconds: 0.5 },
    ...overrides,
  };
}

test("creates stable beat and variant scene keys", () => {
  assert.equal(proceduralDynamicsSceneKey({ beatId: "slide-1" }), "beat:slide-1");
  assert.equal(
    proceduralDynamicsSceneKey({ beatId: "slide-1", variantOptionId: "white shark" }),
    "variant:slide-1:white shark",
  );
  assert.equal(proceduralDynamicsSceneKey({}), "");
});

test("looks up canonical plansByScene with variant override and beat fallback", () => {
  const beatPlan = canonicalPlan();
  const variantPlan = canonicalPlan({
    id: "variant-motion",
    scope: { beatId: "slide-1", variantOptionId: "white" },
  });
  const store = {
    schemaVersion: "storyvr-procedural-dynamics/v1",
    revision: 3,
    plansByScene: {
      "beat:slide-1": beatPlan,
      "variant:slide-1:white": variantPlan,
    },
  };

  assert.deepEqual(
    proceduralDynamicsPlansForScene(store, { beatId: "slide-1", variantOptionId: "white" }).map((plan) => plan.id),
    ["variant-motion"],
  );
  assert.deepEqual(
    proceduralDynamicsPlansForScene(store, { beatId: "slide-1", variantOptionId: "hammer" }).map((plan) => plan.id),
    ["shark-motion"],
  );
  assert.deepEqual(proceduralDynamicsPlansForScene(store, { beatId: "slide-2" }), []);
});

test("runtime normalization strips suppression, population, scaling, and clone aliases", () => {
  const normalized = normalizeProceduralDynamicsPlan(canonicalPlan({
    instanceCount: 20,
    population: { count: 20 },
    sceneComposition: { suppressedAuthoredAssetIds: ["hammer.glb"] },
    suppressedAuthoredAssetIds: ["white.glb"],
    scale: 3,
    targetSizeMeters: 1.2,
    performance: { maxInstancesXR: 1, maxInstancesDesktop: 20 },
    actors: canonicalPlan().actors.map((actor) => ({
      ...actor,
      instanceCount: 10,
      scale: [0.5, 2],
      targetSizeMeters: 0.25,
    })),
  }));

  assert.equal(normalized.actors.length, 2);
  assert.equal(normalized.sceneComposition, undefined);
  assert.equal(normalized.suppressedAuthoredAssetIds, undefined);
  assert.equal(normalized.instanceCount, undefined);
  assert.equal(normalized.population, undefined);
  assert.equal(normalized.scale, undefined);
  assert.equal(normalized.targetSizeMeters, undefined);
  assert.equal(normalized.actors[0].instanceCount, undefined);
  assert.equal(normalized.actors[0].scale, undefined);
  assert.equal(normalized.actors[0].targetSizeMeters, undefined);
  assert.equal(normalized.performance.totalMotionAssignments, 2);
  assert.equal(normalized.performance.maxInstancesXR, undefined);
});

test("desktop and XR preserve the same authored population with one motion assignment per entity", () => {
  const xr = clampProceduralDynamicsPlan(canonicalPlan(), { xrPresenting: true });
  const desktop = clampProceduralDynamicsPlan(canonicalPlan(), { xrPresenting: false });
  assert.equal(xr.motionTargetCount, 2);
  assert.equal(desktop.motionTargetCount, 2);
  assert.equal(proceduralDynamicsInstanceLimit(canonicalPlan(), { xrPresenting: true }), 2);
  assert.deepEqual(xr.actors, desktop.actors);

  const xrAssignments = expandProceduralDynamicsInstances(canonicalPlan(), { xrPresenting: true });
  const desktopAssignments = expandProceduralDynamicsInstances(canonicalPlan(), { xrPresenting: false });
  assert.equal(xrAssignments.length, 2);
  assert.equal(desktopAssignments.length, 2);
  assert.deepEqual(
    xrAssignments.map(({ entityId, assetId }) => ({ entityId, assetId })),
    desktopAssignments.map(({ entityId, assetId }) => ({ entityId, assetId })),
  );
});

test("duplicate entity targets cannot create additional runtime instances", () => {
  const firstActor = canonicalPlan().actors[0];
  const normalized = normalizeProceduralDynamicsPlan(canonicalPlan({
    actors: [
      firstActor,
      { ...firstActor, actorId: "duplicate", assetId: "invented-metadata.glb" },
    ],
  }));
  assert.equal(normalized.actors.length, 1);
  assert.equal(expandProceduralDynamicsInstances(normalized).length, 1);
  assert.equal(expandProceduralDynamicsInstances(normalized)[0].entityId, firstActor.entityId);
});

test("expansion is stable and contains motion only", () => {
  const first = expandProceduralDynamicsInstances(canonicalPlan(), { xrPresenting: true });
  const second = expandProceduralDynamicsInstances(canonicalPlan(), { xrPresenting: true });
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first[0].entityId, "glb:hammer.glb:beat:slide-1");
  assert.equal(first[0].assetId, "hammer.glb");
  assert.equal(first[0].scale, undefined);
  assert.equal(first[0].targetSizeMeters, undefined);
  assert.ok(first[0].trajectory.radiusX >= 2.4);
  assert.ok(
    first[0].trajectory.angularSpeed * Math.max(first[0].trajectory.radiusX, first[0].trajectory.radiusZ) <= 1.2 + 1e-9,
    "expanded orbit respects the configured comfort speed",
  );
  assert.equal(first[1].entityId, "glb:white.glb:beat:slide-1");
});

test("samples orbit position and fade without producing a scale override", () => {
  const instance = {
    scale: 0.01,
    entryFadeSeconds: 0.5,
    trajectory: {
      kind: "school-orbit",
      radiusX: 2,
      radiusZ: 3,
      height: 0.25,
      angularSpeed: Math.PI / 2,
      direction: 1,
      phase: 0,
      verticalSway: 0,
      verticalSwayFrequency: 0,
    },
  };

  const start = sampleProceduralDynamicsTransform(instance, 0);
  assert.deepEqual(start.position, [2, 0.25, 0]);
  assert.deepEqual(start.tangent, [0, 0, 1]);
  assert.equal(start.opacity, 0);
  assert.equal(start.scale, undefined);

  const quarter = sampleProceduralDynamicsTransform(instance, 1);
  assert.ok(Math.abs(quarter.position[0]) < 1e-12);
  assert.deepEqual(quarter.position.slice(1), [0.25, 3]);
  assert.ok(quarter.tangent[0] < -0.999);
  assert.equal(quarter.opacity, 1);
});

test("samples waypoint loops by path length and reports the active tangent", () => {
  const instance = {
    entryFadeSeconds: 0,
    trajectory: {
      kind: "waypoint-loop",
      waypoints: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]],
      durationSeconds: 4,
      phase: 0,
      direction: 1,
    },
  };

  const firstEdge = sampleProceduralDynamicsTransform(instance, 0.5);
  assert.deepEqual(firstEdge.position, [1, 0, 0]);
  assert.deepEqual(firstEdge.tangent, [1, 0, 0]);
  assert.equal(firstEdge.progress, 0.125);

  const secondEdge = sampleProceduralDynamicsTransform(instance, 1.5);
  assert.deepEqual(secondEdge.position, [2, 0, 1]);
  assert.deepEqual(secondEdge.tangent, [0, 0, 1]);
  assert.equal(secondEdge.progress, 0.375);
});

test("legacy source/population recipes are not converted into clone populations", () => {
  const store = {
    recipes: [{
      id: "legacy-sharks",
      scope: { beatId: "slide-3" },
      population: { count: 4 },
      targets: {
        sources: [
          { assetId: "one.glb", weight: 1, clipIndexes: [0] },
          { assetId: "two.glb", weight: 1, clipIndexes: [1] },
        ],
      },
      motion: { kind: "school-orbit", radiusMeters: 2.5 },
    }],
  };
  assert.deepEqual(proceduralDynamicsPlansForScene(store, { beatId: "slide-3" }), []);
});
