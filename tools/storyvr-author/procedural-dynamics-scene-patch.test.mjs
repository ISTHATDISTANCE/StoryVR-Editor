import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyProceduralDynamicsPlan,
  dynamicsSceneCandidateVisibleSignature,
  generateProceduralDynamicsPlan,
  loadAuthorProject,
  recoverAuthorJsonTransactions,
  saveCheckpointDecision,
  saveNoEnvironmentEnhancementCheckpoint,
  saveStoryGraph,
  writeAuthorJsonTransaction,
} from "./engine.mjs";
import {
  createFallbackMotionPlan,
  normalizeDynamicsSceneIntent,
} from "./procedural-dynamics.mjs";

test("motion-only Generate and Apply preserve graph, linked assets, Spatial Relations, and attention", async (t) => {
  const fixture = await createDynamicsFixture(t);
  const { options, modelA, modelB, beatId, modelAEntityId } = fixture;
  const original = await loadAuthorProject(options);
  const legacyGraph = structuredClone(original.graph);
  legacyGraph.manualSceneAssetLinks = {
    schemaVersion: "storyvr-manual-scene-asset-links/v1",
    byScope: {
      [`beat:${beatId}`]: {
        mode: "exact",
        assetIds: [modelB.id],
        beatId,
        source: "generated-dynamics",
      },
    },
  };
  await saveStoryGraph(options, legacyGraph);
  const before = await loadAuthorProject(options);
  assert.equal(Object.prototype.hasOwnProperty.call(before.graph, "manualSceneAssetLinks"), false);
  assert.deepEqual(
    before.graph.beats.find((beat) => beat.id === beatId).linkedAssets
      .map((asset) => typeof asset === "string" ? asset : asset.id),
    original.graph.beats.find((beat) => beat.id === beatId).linkedAssets
      .map((asset) => typeof asset === "string" ? asset : asset.id),
    "legacy Dynamics asset overrides are discarded instead of changing ordinary Source Graph links",
  );
  const graphBefore = structuredClone(before.graph);
  const spatialBefore = structuredClone(before.spatialRelations);
  const attentionBefore = structuredClone(before.attentionGuidance);

  const generated = await generateProceduralDynamicsPlan({
    ...options,
    proceduralDynamicsGenerateJson: async () => ({
      schemaVersion: "storyvr-dynamics-scene-candidate/v3",
      assetIds: [modelB.id],
      scenePatch: {
        assetLinks: { mode: "exact", assetIds: [modelB.id] },
        motionPlan: {
          actors: [{
            assetId: modelB.id,
            instanceCount: 10,
            trajectory: { kind: "school-orbit", radiusMeters: 5 },
          }],
        },
      },
    }),
  }, {
    sceneContext: { beatId },
    prompt: "Have ten sharks swim in a 6 meter radius at 0.09 radians per second.",
  });

  const { candidate } = generated;
  assert.equal(candidate.schemaVersion, "storyvr-dynamics-scene-candidate/v3");
  assert.deepEqual(Object.keys(candidate.scenePatch).sort(), ["motionPlan", "schemaVersion"]);
  assert.equal(candidate.scenePatch.schemaVersion, "storyvr-motion-only-scene-patch/v1");
  assert.equal(candidate.scenePatch.motionPlan.actors.length, 1);
  assert.equal(candidate.scenePatch.motionPlan.actors[0].entityId, modelAEntityId);
  assert.equal(candidate.scenePatch.motionPlan.actors[0].assetId, modelA.id);
  assert.equal(candidate.scenePatch.motionPlan.actors[0].instanceCount, undefined);
  assert.equal(candidate.scenePatch.motionPlan.actors[0].trajectory.radiusMeters, 6);
  assert.equal(candidate.scenePatch.motionPlan.actors[0].trajectory.angularSpeedRadiansPerSecond, 0.09);
  assert.equal(candidate.impact.sourceGraphChanged, false);
  assert.equal(candidate.impact.spatialRelationsChanged, false);
  assert.equal(candidate.impact.attentionGuidanceChanged, false);

  const afterGenerate = await loadAuthorProject(options);
  assert.deepEqual(afterGenerate.graph, graphBefore, "Generate must not mutate Source Graph");
  assert.deepEqual(afterGenerate.spatialRelations, spatialBefore, "Generate must not mutate Spatial Relations");
  assert.deepEqual(afterGenerate.attentionGuidance, attentionBefore, "Generate must not mutate Attention Guidance");

  await applyProceduralDynamicsPlan(options, {
    sceneContext: { beatId },
    expectedRevision: generated.expectedRevision,
    candidate,
  });
  const fresh = await loadAuthorProject(options);
  assert.deepEqual(fresh.graph, graphBefore, "Apply must not mutate linked assets or graph state");
  assert.deepEqual(fresh.spatialRelations, spatialBefore, "Apply must not mutate any saved transform");
  assert.deepEqual(fresh.attentionGuidance, attentionBefore, "Apply must not re-infer attention");
  assert.equal(fresh.proceduralDynamics.revision, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(fresh.graph, "manualSceneAssetLinks"), false);
  assert.equal(fresh.decisions["spatial-relations"].status, "current");
  assert.equal(fresh.decisions["asset-topology"].status, "current");
  assert.equal(fresh.decisions["attention-guidance"].status, "current");
  assert.equal(fresh.decisions["dynamic-geometry"].status, "draft");
  assert.equal(fresh.decisions["inter-beat-dynamics"].status, "stale");
  assert.deepEqual(
    Object.keys(fresh.decisions["dynamic-geometry"].appliedScenePatch).sort(),
    ["motionPlan", "schemaVersion"],
  );
});

test("motion generation preserves the complete manually edited Spatial contract", async (t) => {
  const fixture = await createDynamicsFixture(t);
  const { options, modelA, beatId, modelAEntityId } = fixture;
  let state = await loadAuthorProject(options);
  const editedSpatial = structuredClone(state.spatialRelations);
  editSpatialEntityCopies(editedSpatial, modelAEntityId, (entity) => {
    entity.transform.position = [0.8, 0.25, -0.6];
    entity.transform.quaternion = [0, 0.382683, 0, 0.92388];
    entity.transform.scale = [5, 5, 5];
    entity.manual = true;
  });
  await saveCheckpointDecision(options, "spatial-relations", {
    optionId: state.proposals["spatial-relations"].defaultOptionId,
    spatialRelations: editedSpatial,
  });
  await saveNoEnvironmentEnhancementCheckpoint(options);
  state = await loadAuthorProject(options);
  await saveCheckpointDecision(options, "attention-guidance", {
    optionId: state.proposals["attention-guidance"].defaultOptionId,
    attentionGuidance: state.attentionGuidance,
  });
  const lockedSpatial = structuredClone((await loadAuthorProject(options)).spatialRelations);

  const prompt = "Move the placed shark in a slow 5 meter clockwise orbit.";
  const generated = await generateProceduralDynamicsPlan({
    ...options,
    proceduralDynamicsGenerateJson: async () => generatedMotionJson(modelA.id, modelAEntityId, prompt),
  }, {
    sceneContext: { beatId },
    prompt,
  });
  assert.equal(generated.candidate.scenePatch.spatialScene, undefined);
  assert.equal(generated.candidate.scenePatch.motionPlan.actors[0].scale, undefined);
  assert.deepEqual((await loadAuthorProject(options)).spatialRelations, lockedSpatial);

  await applyProceduralDynamicsPlan(options, {
    sceneContext: { beatId },
    expectedRevision: generated.expectedRevision,
    candidate: generated.candidate,
  });
  const fresh = await loadAuthorProject(options);
  assert.deepEqual(fresh.spatialRelations, lockedSpatial);
  const entity = fresh.spatialRelations.entities.find((item) => item.id === modelAEntityId);
  const lockedEntity = lockedSpatial.entities.find((item) => item.id === modelAEntityId);
  assert.deepEqual(entity.transform.position, [0.8, 0.25, -0.6]);
  assert.deepEqual(entity.transform.quaternion, lockedEntity.transform.quaternion);
  assert.deepEqual(entity.transform.scale, [5, 5, 5]);
  assert.equal(entity.manual, true);
});

test("motion targeting an authored copy survives refresh with its exact Spatial entity identity", async (t) => {
  const fixture = await createDynamicsFixture(t);
  let state = await loadAuthorProject(fixture.options);
  const editedSpatial = structuredClone(state.spatialRelations);
  const copy = appendAuthoredGlbInstance(
    editedSpatial,
    fixture.modelAEntityId,
    2,
    { position: [1.4, 0.3, -0.8], scale: [2.5, 2.5, 2.5] },
  );
  await saveCheckpointDecision(fixture.options, "spatial-relations", {
    optionId: state.proposals["spatial-relations"].defaultOptionId,
    spatialRelations: editedSpatial,
  });
  await saveNoEnvironmentEnhancementCheckpoint(fixture.options);
  state = await loadAuthorProject(fixture.options);
  await saveCheckpointDecision(fixture.options, "attention-guidance", {
    optionId: state.proposals["attention-guidance"].defaultOptionId,
    attentionGuidance: state.attentionGuidance,
  });

  const prompt = "Move only the second placed shark in a slow orbit.";
  const generated = await generateProceduralDynamicsPlan({
    ...fixture.options,
    proceduralDynamicsGenerateJson: async () => generatedMotionJson(
      fixture.modelA.id,
      copy.id,
      prompt,
    ),
  }, {
    sceneContext: { beatId: fixture.beatId },
    prompt,
  });
  await applyProceduralDynamicsPlan(fixture.options, {
    sceneContext: { beatId: fixture.beatId },
    expectedRevision: generated.expectedRevision,
    candidate: generated.candidate,
  });

  const fresh = await loadAuthorProject(fixture.options);
  const plan = fresh.proceduralDynamics.plansByScene[`beat:${fixture.beatId}`];
  assert.equal(plan.actors.length, 1);
  assert.equal(plan.actors[0].entityId, copy.id);
  assert.equal(plan.actors[0].assetId, fixture.modelA.id);
  const savedCopy = fresh.spatialRelations.resolvedByBeat[fixture.beatId].entities
    .find((entity) => entity.id === copy.id);
  assert.deepEqual(savedCopy.transform, copy.transform);
});

test("regeneration changes motion only and preserves the target entity roster", async (t) => {
  const fixture = await createDynamicsFixture(t);
  const prompt = "Move the placed shark around the reader.";
  const generator = async () => generatedMotionJson(
    fixture.modelA.id,
    fixture.modelAEntityId,
    prompt,
  );
  const first = await generateProceduralDynamicsPlan({
    ...fixture.options,
    proceduralDynamicsGenerateJson: generator,
  }, {
    sceneContext: { beatId: fixture.beatId },
    prompt,
  });
  const second = await generateProceduralDynamicsPlan({
    ...fixture.options,
    proceduralDynamicsGenerateJson: generator,
  }, {
    sceneContext: { beatId: fixture.beatId },
    prompt,
    previousCandidate: first.candidate,
  });

  assert.notEqual(
    dynamicsSceneCandidateVisibleSignature(first.candidate),
    dynamicsSceneCandidateVisibleSignature(second.candidate),
  );
  assert.equal(second.engine.provider, "deterministic-visible-variation");
  assert.deepEqual(
    second.candidate.scenePatch.motionPlan.actors.map(({ entityId, assetId }) => ({ entityId, assetId })),
    first.candidate.scenePatch.motionPlan.actors.map(({ entityId, assetId }) => ({ entityId, assetId })),
  );
  assert.equal(second.candidate.scenePatch.motionPlan.actors[0].instanceCount, undefined);
  assert.equal(second.candidate.scenePatch.spatialScene, undefined);
  assert.equal(second.candidate.scenePatch.assetLinks, undefined);
});

test("Apply rejects added asset, Spatial, transform, scale, and population fields without persistence", async (t) => {
  const fixture = await createDynamicsFixture(t);
  const prompt = "Move the placed shark around the reader.";
  const generated = await generateProceduralDynamicsPlan({
    ...fixture.options,
    proceduralDynamicsGenerateJson: async () => generatedMotionJson(
      fixture.modelA.id,
      fixture.modelAEntityId,
      prompt,
    ),
  }, {
    sceneContext: { beatId: fixture.beatId },
    prompt,
  });
  const before = await loadAuthorProject(fixture.options);
  const tampered = structuredClone(generated.candidate);
  tampered.scenePatch.assetLinks = { assetIds: [fixture.modelB.id] };
  tampered.scenePatch.spatialScene = { entities: [] };
  tampered.scenePatch.motionPlan.actors[0].instanceCount = 4;
  tampered.scenePatch.motionPlan.actors[0].scale = 0.5;

  await assert.rejects(
    applyProceduralDynamicsPlan(fixture.options, {
      sceneContext: { beatId: fixture.beatId },
      expectedRevision: generated.expectedRevision,
      candidate: tampered,
    }),
    (error) => error?.statusCode === 400 && /cannot change|motion only|locked/i.test(error.message),
  );
  const rootTampered = structuredClone(generated.candidate);
  rootTampered.graph = { beats: [] };
  const versionTampered = structuredClone(generated.candidate);
  versionTampered.scenePatch.schemaVersion = "storyvr-motion-only-scene-patch/v999";
  const impactTampered = structuredClone(generated.candidate);
  impactTampered.impact.sourceGraphChanged = true;
  for (const candidate of [rootTampered, versionTampered, impactTampered]) {
    await assert.rejects(
      applyProceduralDynamicsPlan(fixture.options, {
        sceneContext: { beatId: fixture.beatId },
        expectedRevision: generated.expectedRevision,
        candidate,
      }),
      (error) => error?.statusCode === 400 && /unmodified|cannot modify|motion-only/i.test(error.message),
    );
  }
  const fresh = await loadAuthorProject(fixture.options);
  assert.equal(fresh.proceduralDynamics.revision, 0);
  assert.deepEqual(fresh.graph, before.graph);
  assert.deepEqual(fresh.spatialRelations, before.spatialRelations);
});

test("visible regeneration proof includes motion but excludes prose and forbidden upstream fields", () => {
  const candidate = visibleCandidate();
  const summaryOnly = structuredClone(candidate);
  summaryOnly.scenePatch.motionPlan.summary = "Different words only.";
  summaryOnly.scenePatch.motionPlan.seed = 999;
  assert.equal(
    dynamicsSceneCandidateVisibleSignature(candidate),
    dynamicsSceneCandidateVisibleSignature(summaryOnly),
  );

  const changedMotion = structuredClone(candidate);
  changedMotion.scenePatch.motionPlan.actors[0].trajectory.radiusMeters += 1;
  assert.notEqual(
    dynamicsSceneCandidateVisibleSignature(candidate),
    dynamicsSceneCandidateVisibleSignature(changedMotion),
  );

  const forbiddenUpstream = structuredClone(candidate);
  forbiddenUpstream.scenePatch.assetLinks = { assetIds: ["other.glb"] };
  forbiddenUpstream.scenePatch.spatialScene = { entities: [] };
  assert.equal(
    dynamicsSceneCandidateVisibleSignature(candidate),
    dynamicsSceneCandidateVisibleSignature(forbiddenUpstream),
  );
});

test("intent rejects scene mutations while fallback honors motion numbers and ignores copy counts", () => {
  const context = {
    scene: { beatId: "beat-one" },
    assets: [{
      entityId: "glb:static-shark:beat:beat-one",
      assetId: "static-shark",
      label: "Placed static shark",
      clips: [],
    }],
  };
  assert.throws(
    () => normalizeDynamicsSceneIntent({
      scenePatch: {
        assetLinks: { assetIds: ["invented.glb"] },
        spatialScene: { entities: [] },
        motionPlan: {
          actors: [{
            entityId: "glb:static-shark:beat:beat-one",
            instanceCount: 10,
            scale: 2,
          }],
        },
      },
    }, context, { prompt: "Ten sharks." }),
    /cannot change linked assets/i,
  );

  const fallback = createFallbackMotionPlan(
    context,
    "Have ten sharks swim in a 6 meter radius at 0.09 radians per second.",
  );
  assert.throws(
    () => normalizeDynamicsSceneIntent({
      scenePatch: {
        motionPlan: fallback,
        transform: { position: [9, 9, 9] },
      },
    }, context, { prompt: "Move the existing shark." }),
    /cannot change Spatial Relations transforms/i,
  );
  assert.equal(fallback.actors.length, 1);
  assert.equal(fallback.actors[0].entityId, "glb:static-shark:beat:beat-one");
  assert.equal(fallback.actors[0].instanceCount, undefined);
  assert.equal(fallback.actors[0].trajectory.radiusMeters, 6);
  assert.equal(fallback.actors[0].trajectory.angularSpeedRadiansPerSecond, 0.09);
});

test("JSON transactions still commit and recover atomically", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-json-transaction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const analysisRoot = path.join(root, "analysis", "storyvr");
  await mkdir(analysisRoot, { recursive: true });
  const firstPath = path.join(analysisRoot, "first.json");
  const secondPath = path.join(analysisRoot, "second.json");
  await Promise.all([
    writeFile(firstPath, JSON.stringify({ revision: 0 })),
    writeFile(secondPath, JSON.stringify({ status: "current" })),
  ]);

  await writeAuthorJsonTransaction({ analysisRoot }, [
    [firstPath, { revision: 1 }],
    [secondPath, { status: "draft" }],
  ]);
  assert.deepEqual(JSON.parse(await readFile(firstPath, "utf8")), { revision: 1 });
  assert.deepEqual(JSON.parse(await readFile(secondPath, "utf8")), { status: "draft" });
  assert.deepEqual(
    (await readdir(analysisRoot)).filter((name) => name.startsWith(".storyvr-json-transaction-")),
    [],
  );

  const transactionRoot = path.join(analysisRoot, ".storyvr-json-transaction-interrupted");
  await mkdir(transactionRoot, { recursive: true });
  const firstBackup = path.join(transactionRoot, "0.previous.json");
  const secondBackup = path.join(transactionRoot, "1.previous.json");
  await Promise.all([
    writeFile(firstBackup, JSON.stringify({ revision: 1 })),
    writeFile(secondBackup, JSON.stringify({ status: "draft" })),
    writeFile(firstPath, JSON.stringify({ revision: 2 })),
    writeFile(secondPath, JSON.stringify({ status: "stale" })),
  ]);
  await writeFile(path.join(transactionRoot, "journal.json"), JSON.stringify({
    schemaVersion: "storyvr-json-transaction/v1",
    transactionId: "interrupted",
    state: "prepared",
    records: [
      { destination: firstPath, backupPath: firstBackup, existed: true },
      { destination: secondPath, backupPath: secondBackup, existed: true },
    ],
  }));

  await recoverAuthorJsonTransactions({ analysisRoot });
  assert.deepEqual(JSON.parse(await readFile(firstPath, "utf8")), { revision: 1 });
  assert.deepEqual(JSON.parse(await readFile(secondPath, "utf8")), { status: "draft" });
  assert.deepEqual(
    (await readdir(analysisRoot)).filter((name) => name.startsWith(".storyvr-json-transaction-")),
    [],
  );
});

async function createDynamicsFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-dynamics-scene-patch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "dynamics-story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const modelsRoot = path.join(resourceFolder, "models");
  const imagesRoot = path.join(resourceFolder, "images");
  await Promise.all([
    mkdir(metadataRoot, { recursive: true }),
    mkdir(modelsRoot, { recursive: true }),
    mkdir(imagesRoot, { recursive: true }),
  ]);
  const modelAPath = path.join(modelsRoot, "static-shark.glb");
  const modelBPath = path.join(modelsRoot, "swimming-shark.glb");
  const imagePath = path.join(imagesRoot, "water.jpg");
  await Promise.all([
    writeFile(modelAPath, "static-shark"),
    writeFile(modelBPath, "swimming-shark"),
    writeFile(imagePath, "water"),
  ]);
  const storyUrl = "https://example.test/dynamics-story";
  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), JSON.stringify({
    story_url: storyUrl,
    title: "Dynamics Story",
    slides: [{ index: 0, text: "Sharks patrol the reef." }],
  }, null, 2));
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), JSON.stringify([
    manifestEntry(storyUrl, modelAPath, "https://assets.test/static-shark.glb", "model"),
    manifestEntry(storyUrl, modelBPath, "https://assets.test/swimming-shark.glb", "model"),
    manifestEntry(storyUrl, imagePath, "https://assets.test/water.jpg", "texture"),
  ], null, 2));

  const options = { storyFolder, resourceFolder };
  const initial = await loadAuthorProject(options);
  const models = initial.graph.assetInventory.filter((asset) => asset.type === "model");
  const image = initial.graph.assetInventory.find((asset) => ["texture", "image"].includes(asset.type));
  const modelA = models.find((asset) => /static-shark/i.test(asset.path || asset.id));
  const modelB = models.find((asset) => /swimming-shark/i.test(asset.path || asset.id));
  assert.ok(modelA && modelB && image);
  const graph = structuredClone(initial.graph);
  graph.beats[0].linkedAssets = [modelA, image];
  await saveStoryGraph(options, graph);

  let state = await loadAuthorProject(options);
  await saveCheckpointDecision(options, "spatial-relations", {
    optionId: state.proposals["spatial-relations"].defaultOptionId,
    spatialRelations: state.spatialRelations,
  });
  await saveNoEnvironmentEnhancementCheckpoint(options);
  state = await loadAuthorProject(options);
  await saveCheckpointDecision(options, "attention-guidance", {
    optionId: state.proposals["attention-guidance"].defaultOptionId,
    attentionGuidance: state.attentionGuidance,
  });
  state = await loadAuthorProject(options);
  const beatId = state.graph.beats[0].id;
  const modelAEntityId = state.spatialRelations.resolvedByBeat[beatId].entities
    .find((entity) => entity.kind === "glb" && entity.assetId === modelA.id)?.id;
  assert.ok(modelAEntityId);
  return { options, modelA, modelB, image, beatId, modelAEntityId };
}

function generatedMotionJson(assetId, entityId, prompt) {
  return {
    schemaVersion: "storyvr-dynamics-scene-candidate/v3",
    scenePatch: {
      motionPlan: {
        prompt,
        summary: "The placed model circles the reader.",
        actors: [{
          entityId,
          assetId,
          trajectory: {
            kind: "school-orbit",
            radiusMeters: 5,
            heightMeters: 0,
            angularSpeedRadiansPerSecond: 0.12,
          },
        }],
        comfort: {
          minimumViewerDistanceMeters: 2.25,
          maximumSpeedMetersPerSecond: 1,
        },
      },
    },
  };
}

function manifestEntry(storyUrl, localPath, assetUrl, assetType) {
  return {
    story_url: storyUrl,
    asset_url: assetUrl,
    final_url: assetUrl,
    local_path: localPath,
    asset_type: assetType,
    adaptation_relevance: "core_story",
    source_type: "network_request",
  };
}

function editSpatialEntityCopies(contract, entityId, edit) {
  const copies = [
    ...(contract.entities || []).filter((entity) => entity.id === entityId),
    ...Object.values(contract.resolvedByBeat || {})
      .flatMap((scene) => scene.entities || [])
      .filter((entity) => entity.id === entityId),
    ...Object.values(contract.resolvedByVariant || {})
      .flatMap((scene) => scene.entities || [])
      .filter((entity) => entity.id === entityId),
  ];
  assert.ok(copies.length >= 2, `expected canonical and scene copies for ${entityId}`);
  for (const entity of copies) edit(entity);
}

function appendAuthoredGlbInstance(contract, baseId, ordinal, transform = {}) {
  const base = contract.entities.find((entity) => entity.id === baseId);
  assert.ok(base, `expected source entity ${baseId}`);
  const instance = {
    ...structuredClone(base),
    id: `${baseId}:instance:${ordinal}`,
    authoredInstance: true,
    instanceOfEntityId: baseId,
    inferredTransform: structuredClone(base.transform),
    transform: {
      ...structuredClone(base.transform),
      ...structuredClone(transform),
    },
    manual: true,
  };
  contract.entities.push(structuredClone(instance));
  const scene = base.variantOptionId
    ? contract.resolvedByVariant[base.sceneKey]
    : contract.resolvedByBeat[base.beatId];
  assert.ok(scene, `expected source scene ${base.sceneKey}`);
  scene.entities.push(structuredClone(instance));
  return instance;
}

function visibleCandidate() {
  return {
    scenePatch: {
      motionPlan: {
        summary: "One summary.",
        seed: 1,
        actors: [{
          entityId: "glb:shark.glb:beat:one",
          assetId: "shark.glb",
          clip: { clipIndex: 0 },
          trajectory: { kind: "school-orbit", radiusMeters: 4 },
          orientation: { kind: "path-tangent" },
          animation: { mode: "loop" },
        }],
      },
    },
  };
}
