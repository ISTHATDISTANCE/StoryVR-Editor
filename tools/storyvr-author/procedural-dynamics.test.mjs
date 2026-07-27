import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMotionPlanToStore,
  createFallbackMotionPlan,
  emptyProceduralDynamicsStore,
  generateMotionPlanCandidate,
  normalizeMotionPlan,
  normalizeProceduralDynamicsStore,
  removeMotionPlanFromStore,
} from "./procedural-dynamics.mjs";
import {
  clampProceduralDynamicsPlan,
  expandProceduralDynamicsInstances,
  proceduralDynamicsPlansForScene,
  proceduralDynamicsSceneKey,
  sampleProceduralDynamicsTransform,
} from "./procedural-dynamics-runtime.js";

function sceneContext({
  beatId = "shark-beat",
  variantGroupId = null,
  variantOptionId = null,
  assets = null,
} = {}) {
  const scene = {
    beatId,
    variantGroupId,
    variantOptionId,
    text: "Sharks patrol the open water.",
  };
  return {
    scene,
    assets: assets || [{
      entityId: variantOptionId
        ? `glb:shark.glb:beat:${beatId}:variant:${variantOptionId}`
        : `glb:shark.glb:beat:${beatId}`,
      assetId: "shark.glb",
      label: "Reef shark",
      clips: [{
        trackId: "shark.glb#clip:0",
        clipIndex: 0,
        clipName: "Swim",
        durationSeconds: 3.5,
      }],
    }],
  };
}

function rawPlan(overrides = {}) {
  return {
    prompt: "Have the placed shark swim around the reader.",
    summary: "The placed shark circles the reader.",
    seed: 42,
    actors: [{
      entityId: "glb:shark.glb:beat:shark-beat",
      assetId: "shark.glb",
      clip: { trackId: "shark.glb#clip:0" },
      trajectory: {
        type: "school-orbit",
        radiusMeters: 4.5,
        heightMeters: 1.2,
        angularSpeedRadiansPerSecond: 0.16,
      },
      orientation: { mode: "tangent" },
      animation: { enabled: true, playbackRate: 1 },
    }],
    comfort: {
      minimumViewerDistanceMeters: 2.25,
      maximumSpeedMetersPerSecond: 1,
      fadeInSeconds: 0.8,
      fadeOutSeconds: 0.5,
    },
    ...overrides,
  };
}

test("normalization binds motion to an existing entity and keeps scene ownership out of the plan", () => {
  const context = sceneContext({
    beatId: "comparison",
    variantGroupId: "species",
    variantOptionId: "great-white",
  });
  const entityId = "glb:shark.glb:beat:comparison:variant:great-white";
  const plan = normalizeMotionPlan(rawPlan({
    actors: [{
      entityId,
      assetId: "shark.glb",
      clip: { trackId: "unavailable-track", clipIndex: 999 },
      trajectory: {
        type: "school-orbit",
        radiusMeters: 0.1,
        angularSpeedRadiansPerSecond: 10,
        direction: "mixed",
      },
    }],
    comfort: {
      minimumViewerDistanceMeters: 0.1,
      maximumSpeedMetersPerSecond: 99,
      fadeInSeconds: 0,
      fadeOutSeconds: 99,
    },
  }), context);

  assert.equal(plan.schemaVersion, "storyvr-motion-plan/v2");
  assert.equal(plan.sceneKey, "variant:comparison:great-white");
  assert.deepEqual(plan.scope, {
    beatId: "comparison",
    variantGroupId: "species",
    variantOptionId: "great-white",
  });
  assert.equal(plan.actors[0].entityId, entityId);
  assert.equal(plan.actors[0].assetId, "shark.glb");
  assert.equal(plan.actors[0].instanceCount, undefined);
  assert.equal(plan.actors[0].scale, undefined);
  assert.equal(plan.sceneComposition, undefined);
  assert.equal(plan.actors[0].clip.name, "Swim");
  assert.equal(plan.actors[0].trajectory.radiusMeters, 2.5);
  assert.equal(plan.actors[0].trajectory.angularSpeedRadiansPerSecond, 0.35);
  assert.equal(plan.comfort.minimumViewerDistanceMeters, 1.75);
  assert.equal(plan.comfort.maximumSpeedMetersPerSecond, 1.5);
  assert.deepEqual(plan.performance, {
    motionTargetCount: 1,
    instancePolicy: "existing-spatial-entities-only",
    castShadow: false,
  });
});

test("normalization rejects all asset, transform, suppression, population, and duplicate-target mutations", () => {
  const context = sceneContext();
  const actor = rawPlan().actors[0];
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ actors: [{ ...actor, entityId: "glb:other:beat:shark-beat" }] }), context),
    /existing linked scene model instance/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ actors: [actor, actor] }), context),
    /duplicates the existing scene instance/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ actors: [{ ...actor, instanceCount: 1 }] }), context),
    /cannot change.*instance count/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ actors: [{ ...actor, scale: 2 }] }), context),
    /cannot change.*transform/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ actors: [{ ...actor, position: [1, 2, 3] }] }), context),
    /cannot change.*transform/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ transform: { position: [1, 2, 3] } }), context),
    /motion only|locked/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ instances: [{ assetId: "shark.glb" }] }), context),
    /motion only|locked/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ sceneComposition: { suppressedAuthoredAssetIds: ["shark.glb"] } }), context),
    /motion only|locked/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ assetLinks: { assetIds: ["other.glb"] } }), context),
    /motion only|locked/i,
  );
  assert.throws(
    () => normalizeMotionPlan(rawPlan({ prompt: "Run ```javascript eval(x)```" }), context),
    /cannot contain code/i,
  );
});

test("entity identity supports every placed instance without a fixed actor limit", () => {
  const assets = Array.from({ length: 8 }, (_, offset) => offset + 1).map((index) => ({
    entityId: `glb:shark.glb:beat:shark-beat:instance:${index}`,
    assetId: "shark.glb",
    label: `Placed shark ${index}`,
    clips: [],
  }));
  const context = sceneContext({ assets });
  const plan = normalizeMotionPlan(rawPlan({
    actors: assets.map(({ entityId }) => ({
      entityId,
      trajectory: { kind: "school-orbit", radiusMeters: 3 + Number(entityId.at(-1)) },
    })),
  }), context);
  assert.deepEqual(plan.actors.map((actor) => actor.entityId), assets.map((asset) => asset.entityId));
  assert.equal(plan.performance.motionTargetCount, 8);
  assert.equal(expandProceduralDynamicsInstances(plan, { xrPresenting: false }).length, 8);
  assert.equal(expandProceduralDynamicsInstances(plan, { xrPresenting: true }).length, 8);
});

test("apply and remove use optimistic revisions and reject cross-scene candidates", () => {
  const context = sceneContext();
  const initial = emptyProceduralDynamicsStore();
  const applied = applyMotionPlanToStore(initial, {
    sceneContext: { beatId: "shark-beat" },
    expectedRevision: 0,
    plan: rawPlan(),
  }, context, new Date("2026-07-23T12:00:00.000Z"));

  assert.equal(applied.store.revision, 1);
  assert.equal(applied.store.updatedAt, "2026-07-23T12:00:00.000Z");
  assert.equal(applied.store.plansByScene["beat:shark-beat"].actors[0].entityId, "glb:shark.glb:beat:shark-beat");
  assert.throws(
    () => applyMotionPlanToStore(applied.store, {
      sceneContext: { beatId: "shark-beat" },
      expectedRevision: 0,
      plan: rawPlan(),
    }, context),
    /changed from revision 0 to 1/i,
  );
  assert.throws(
    () => applyMotionPlanToStore(initial, {
      sceneContext: { beatId: "different-beat" },
      expectedRevision: 0,
      plan: rawPlan(),
    }, context),
    /does not match the requested scene/i,
  );

  const removed = removeMotionPlanFromStore(applied.store, {
    sceneContext: { beatId: "shark-beat" },
    expectedRevision: 1,
  }, new Date("2026-07-23T12:01:00.000Z"));
  assert.equal(removed.removed, true);
  assert.equal(removed.store.revision, 2);
  assert.deepEqual(removed.store.plansByScene, {});
});

test("store loading retains valid motion-only plans and drops legacy population plans", () => {
  const context = sceneContext();
  const valid = normalizeMotionPlan(rawPlan(), context);
  const normalized = normalizeProceduralDynamicsStore({
    schemaVersion: "storyvr-procedural-dynamics/v1",
    revision: 7,
    updatedAt: "2026-07-23T12:00:00.000Z",
    plansByScene: {
      "beat:shark-beat": valid,
      "beat:deleted": { ...valid, sceneKey: "beat:deleted", beatId: "deleted" },
      "beat:legacy": { ...valid, sceneKey: "beat:legacy", instanceCount: 5 },
    },
  }, {
    "beat:shark-beat": context,
    "beat:legacy": sceneContext({ beatId: "legacy" }),
  });

  assert.equal(normalized.revision, 7);
  assert.deepEqual(Object.keys(normalized.plansByScene), ["beat:shark-beat"]);
});

test("candidate generation supplies a strict prompt and rejects forbidden generated fields", async () => {
  const context = sceneContext();
  let suppliedPrompt = "";
  const candidate = await generateMotionPlanCandidate({
    context,
    prompt: "Use a 6 meter radius at 0.08 radians per second.",
    previousPlan: normalizeMotionPlan(rawPlan({ seed: 1 }), context),
    generateJson: async (prompt) => {
      suppliedPrompt = prompt;
      return {
        schemaVersion: "storyvr-dynamics-scene-candidate/v3",
        scenePatch: {
          motionPlan: rawPlan({
            sceneKey: "invented-by-model",
            seed: 2,
            actors: [{
              entityId: "glb:shark.glb:beat:shark-beat",
              clip: { clipIndex: 0 },
              trajectory: {
                kind: "school-orbit",
                radiusMeters: 6,
                angularSpeedRadiansPerSecond: 0.08,
              },
            }],
          }),
        },
      };
    },
  });

  assert.match(suppliedPrompt, /motionTargets/);
  assert.match(suppliedPrompt, /Linked assets.*authored position.*authored rotation.*authored scale.*number of scene instances are locked/i);
  assert.match(suppliedPrompt, /Never return assetLinks, spatialScene, sceneComposition, transforms, scale, target size, suppression, or instance counts/i);
  assert.equal(candidate.sceneKey, "beat:shark-beat");
  assert.equal(candidate.seed, 2);
  assert.equal(candidate.actors[0].entityId, "glb:shark.glb:beat:shark-beat");
  assert.equal(candidate.actors[0].trajectory.radiusMeters, 6);

  await assert.rejects(
    generateMotionPlanCandidate({
      context,
      prompt: "Make five sharks.",
      generateJson: async () => ({
        scenePatch: {
          motionPlan: rawPlan({
            actors: [{ ...rawPlan().actors[0], instanceCount: 5 }],
          }),
        },
      }),
    }),
    /cannot change.*instance count/i,
  );
});

test("all-target prompts reject partial generated plans and fallback targets the complete scene", async () => {
  const assets = Array.from({ length: 5 }, (_, index) => ({
    entityId: `glb:shark-${index + 1}.glb:beat:shark-beat`,
    assetId: `shark-${index + 1}.glb`,
    label: `Placed shark ${index + 1}`,
    clips: index < 3 ? [{
      trackId: `shark-${index + 1}.glb#clip:0`,
      clipIndex: 0,
      clipName: "Swim",
      durationSeconds: 2,
    }] : [],
  }));
  const context = sceneContext({ assets });
  const prompt = "Have all sharks in the scene swim around me.";
  const partialActors = assets.slice(0, 3).map((asset) => ({
    entityId: asset.entityId,
    assetId: asset.assetId,
    trajectory: { kind: "school-orbit", radiusMeters: 4 },
  }));

  await assert.rejects(
    generateMotionPlanCandidate({
      context,
      prompt,
      generateJson: async () => ({
        scenePatch: {
          motionPlan: rawPlan({ prompt, actors: partialActors }),
        },
      }),
    }),
    /targets 3 of 5/i,
  );

  const fallback = createFallbackMotionPlan(context, prompt);
  assert.equal(fallback.actors.length, 5);
  assert.deepEqual(
    new Set(fallback.actors.map((actor) => actor.entityId)),
    new Set(assets.map((asset) => asset.entityId)),
  );
  assert.equal(fallback.actors.filter((actor) => actor.animation.enabled).length, 3);
});

test("fallback honors specific motion numbers while population language cannot create copies", () => {
  const fallback = createFallbackMotionPlan(
    sceneContext(),
    "Have twelve sharks move in a 6 meter radius at 0.09 radians per second clockwise.",
  );
  assert.equal(fallback.actors.length, 1);
  assert.equal(fallback.actors[0].instanceCount, undefined);
  assert.equal(fallback.actors[0].trajectory.radiusMeters, 6);
  assert.equal(fallback.actors[0].trajectory.angularSpeedRadiansPerSecond, 0.09);
  assert.equal(fallback.actors[0].trajectory.direction, "clockwise");
  assert.deepEqual(fallback.anchor.offsetMeters, [0, 0, 0]);

  const [instance] = expandProceduralDynamicsInstances(fallback, { xrPresenting: true });
  const sample = sampleProceduralDynamicsTransform(instance, 0);
  assert.equal(instance.entityId, "glb:shark.glb:beat:shark-beat");
  assert.equal(instance.scale, undefined);
  assert.equal(sample.scale, undefined);
});

test("waypoint comfort and runtime round-trip preserve motion values only", () => {
  const context = sceneContext();
  assert.throws(
    () => normalizeMotionPlan(rawPlan({
      actors: [{
        entityId: "glb:shark.glb:beat:shark-beat",
        trajectory: {
          kind: "waypoint-loop",
          waypoints: [[-4, 1, 0], [4, 1, 0], [4, 1, 4]],
          durationSeconds: 24,
        },
      }],
      comfort: { minimumViewerDistanceMeters: 2, maximumSpeedMetersPerSecond: 1 },
    }), context),
    /inside the 2 meter reader comfort radius/i,
  );

  const canonical = normalizeMotionPlan(rawPlan({
    actors: [{
      entityId: "glb:shark.glb:beat:shark-beat",
      clip: { clipIndex: 0 },
      trajectory: {
        kind: "waypoint-loop",
        waypoints: [[3, 1, 0], [5, 1, 0], [5, 1, 3], [3, 1, 3]],
        durationSeconds: 24,
      },
      animation: { enabled: true, timeScale: 1.35 },
    }],
    comfort: {
      minimumViewerDistanceMeters: 2,
      maximumSpeedMetersPerSecond: 0.9,
      fadeInSeconds: 1.25,
      fadeOutSeconds: 0.75,
    },
  }), context);
  const preview = clampProceduralDynamicsPlan(canonical, { xrPresenting: true });
  const applied = applyMotionPlanToStore(emptyProceduralDynamicsStore(), {
    sceneContext: { beatId: "shark-beat" },
    expectedRevision: 0,
    plan: preview,
  }, context).plan;
  assert.equal(applied.actors[0].trajectory.durationSeconds, 24);
  assert.equal(applied.actors[0].animation.timeScale, 1.35);
  assert.equal(applied.lifecycle.fadeInSeconds, 1.25);
  assert.equal(applied.lifecycle.fadeOutSeconds, 0.75);
  assert.equal(proceduralDynamicsSceneKey({ beatId: "shark-beat" }), canonical.sceneKey);

  const store = {
    schemaVersion: "storyvr-procedural-dynamics/v1",
    revision: 1,
    plansByScene: { [canonical.sceneKey]: canonical },
  };
  assert.equal(proceduralDynamicsPlansForScene(store, { beatId: "shark-beat" }).length, 1);
});
