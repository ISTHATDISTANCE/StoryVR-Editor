import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COMPONENTS,
  compileAuthorRuntime,
  environmentEnhancementContractFromDecision,
  generateComponentProposals,
  loadAuthorProject,
  loadEnvironmentEnhancementDecision,
  saveAttentionGuidanceDecisionDraft,
  saveCheckpointDecision,
  saveEnvironmentEnhancementCheckpoint,
  saveEnvironmentEnhancementDecisionDraft,
  saveNoEnvironmentEnhancementCheckpoint,
} from "./engine.mjs";

const authorClientSource = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");

function authorClientFunctionSource(name) {
  const start = authorClientSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = authorClientSource.indexOf("\nfunction ", start + 1);
  return authorClientSource.slice(start, next === -1 ? authorClientSource.length : next);
}

test("pipeline keeps Source Graph first and follows the spatial-to-behavior sequence", () => {
  assert.deepEqual(COMPONENTS.map((component) => component.id), [
    "source-graph",
    "spatial-relations",
    "environment-enhancement",
    "attention-guidance",
    "dynamic-geometry",
    "inter-beat-dynamics",
    "interaction-control",
    "transition-pacing",
  ]);
  assert.deepEqual(COMPONENTS.map((component) => component.label), [
    "Source Graph",
    "Spatial Relations",
    "Environment Enhancement",
    "Attention Guidance",
    "Dynamics",
    "Transition",
    "Interaction Control",
    "Final Review",
  ]);
  assert.deepEqual(COMPONENTS.map((component) => component.stage), [0, 1, 1, 1, 2, 2, 3, 3]);
});

test("Environment Enhancement reports its current visible blocking checkpoint", () => {
  const dependencySource = authorClientFunctionSource("checkpointBlockingDependency");
  const resolveDependency = new Function(
    "visibleFlowComponents",
    "checkpointState",
    `${dependencySource}; return checkpointBlockingDependency;`,
  )(
    () => COMPONENTS,
    (componentId) => ({ current: componentId === "spatial-relations" ? false : true }),
  );
  assert.equal(resolveDependency("environment-enhancement")?.label, "Spatial Relations");

  const canvasSource = authorClientFunctionSource("renderEnvironmentEnhancementCanvasWorkspace");
  const editorSource = authorClientFunctionSource("renderEnvironmentEnhancementEditorWorkspace");
  assert.match(canvasSource, /checkpointBlockingDependency\(component\.id\)/);
  assert.match(editorSource, /checkpointBlockingDependency\(component\.id\)/);
  assert.doesNotMatch(`${canvasSource}\n${editorSource}`, /Save Asset Topology/);
});

test("checkpoint navigation treats explicit readiness as authoritative", () => {
  const checkpointSource = authorClientFunctionSource("checkpointState");
  const checkpointState = new Function(
    "state",
    `${checkpointSource}; return checkpointState;`,
  )({
    data: {
      readiness: {
        "attention-guidance": {
          status: "current",
          current: false,
          saved: true,
          stale: false,
          canGenerate: true,
        },
      },
      decisions: {
        "attention-guidance": {
          status: "current",
          savedAt: new Date(0).toISOString(),
        },
      },
    },
  });
  const flowStatusSource = authorClientFunctionSource("checkpointFlowStatus");
  const checkpointFlowStatus = new Function(
    "state",
    "checkpointState",
    "checkpointHasLocalDraft",
    `${flowStatusSource}; return checkpointFlowStatus;`,
  )(
    { graphDirty: false },
    checkpointState,
    () => false,
  );

  const checkpoint = checkpointState("attention-guidance");
  assert.equal(checkpoint.current, false);
  assert.equal(checkpoint.saved, true);
  assert.equal(checkpointFlowStatus("attention-guidance"), "draft");
});

test("environment enhancement saves an uploaded story-local asset without a legal acknowledgement", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-environment-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "story");
  const decisionsRoot = path.join(storyFolder, "analysis", "storyvr", "decisions");
  const publicPath = "environment-enhancement/room/room.glb";
  const assetPath = path.join(storyFolder, "webxr-adaptation", "public", publicPath);
  await mkdir(decisionsRoot, { recursive: true });
  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, "environment-v1");

  await writeCurrentSpatialDecision(decisionsRoot);
  await writeDecision(decisionsRoot, "dynamic-geometry", {
    optionId: "dynamic-geometry-source-dynamics-preview",
    label: "No dynamics",
    sourceDynamicsPreview: true,
  });
  await writeDecision(decisionsRoot, "inter-beat-dynamics", {
    optionId: "inter-beat-dynamics-source-transition-preview",
    label: "No transition",
    sourceDynamicsPreview: true,
  });

  const options = { storyFolder };
  const environmentState = {
    schemaVersion: "storyvr-environment-enhancement/v1",
    revision: 3,
    selectedSource: { candidate: { title: "Furnished room", provider: "polyhaven" } },
    asset: {
      publicPath,
      entryPath: "room/room.glb",
      format: "glb",
      sourceUpload: { filename: "room.glb", bytes: 14 },
      localUrl: "/api/environment-assets/room/room.glb",
    },
    transform: { position: [1, 0, -2], rotationY: 0.5, scale: 1.25 },
    rendering: { exposure: 0.9, fogColor: "#dce8e2", fogDensity: 0.01, backgroundMode: "asset" },
    performance: { triangles: 1000, warnings: [] },
    provenance: { provider: "polyhaven" },
  };

  const draft = await saveEnvironmentEnhancementDecisionDraft(options, environmentState);
  assertDecisionState(draft, "draft", { saved: false });
  assert.equal(draft.option.environmentEnhancement.asset.publicPath, publicPath);
  assert.equal(Object.hasOwn(draft.option.environmentEnhancement.asset, "localUrl"), false);
  assert.match(draft.option.environmentEnhancement.asset.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    Object.keys(draft.option.environmentEnhancement).filter((key) => key.endsWith("Confirmation")),
    [],
  );
  assert.deepEqual(draft.option.environmentEnhancement.movementCue, {
    enabled: false,
    style: "sand",
    position: [0, 0.004, -0.4],
    widthMeters: 2,
    depthMeters: 1.5,
    thicknessMeters: 0.008,
    textureScaleMeters: 0.2,
    opacity: 0.55,
    texture: null,
  });

  const saved = await saveEnvironmentEnhancementCheckpoint(options, environmentState);
  assertDecisionState(saved, "current");
  assert.deepEqual(
    Object.keys(saved.option.environmentEnhancement).filter((key) => key.endsWith("Confirmation")),
    [],
  );
  assert.equal(environmentEnhancementContractFromDecision(saved).asset.publicPath, publicPath);
  assert.deepEqual(await loadEnvironmentEnhancementDecision(options), saved);

  const retiredKey = ["rights", "Confirmation"].join("");
  const legacySaved = structuredClone(saved);
  legacySaved.option.environmentEnhancement[retiredKey] = { confirmed: true };
  legacySaved.option.environmentEnhancement.asset[retiredKey] = { confirmed: true };
  const decisionPath = path.join(decisionsRoot, "environment-enhancement.json");
  await writeFile(decisionPath, `${JSON.stringify(legacySaved, null, 2)}\n`);
  const migrated = await loadEnvironmentEnhancementDecision(options);
  assert.equal(JSON.stringify(migrated).includes(retiredKey), false);
  assert.equal((await readFile(decisionPath, "utf8")).includes(retiredKey), false);

  const editedDraft = await saveEnvironmentEnhancementDecisionDraft(options, {
    ...saved.option.environmentEnhancement,
    transform: {
      ...saved.option.environmentEnhancement.transform,
      position: [2, 0.5, -3],
    },
    movementCue: {
      enabled: true,
      style: "unsupported",
      position: [250, 0.004, -250],
      widthMeters: 500,
      depthMeters: 0,
      thicknessMeters: 0,
      textureScaleMeters: 50,
      opacity: -1,
    },
  });
  assertDecisionState(editedDraft, "draft", { saved: false });
  assert.deepEqual(editedDraft.option.environmentEnhancement.transform.position, [2, 0.5, -3]);
  assert.deepEqual(editedDraft.option.environmentEnhancement.movementCue, {
    enabled: true,
    style: "sand",
    position: [100, 0.004, -100],
    widthMeters: 200,
    depthMeters: 0.1,
    thicknessMeters: 0.001,
    textureScaleMeters: 5,
    opacity: 0,
    texture: null,
  });
  const downstreamAfterDraft = JSON.parse(await readFile(path.join(decisionsRoot, "dynamic-geometry.json"), "utf8"));
  assertDecisionState(downstreamAfterDraft, "stale");
  assert.equal(downstreamAfterDraft.invalidatedBy, "environment-enhancement");

  const editedAndResaved = await saveEnvironmentEnhancementCheckpoint(options, editedDraft.option.environmentEnhancement);
  assertDecisionState(editedAndResaved, "current");
  assert.deepEqual(
    editedAndResaved.option.environmentEnhancement.transform.position,
    [2, 0.5, -3],
    "a saved environment checkpoint remains editable",
  );
  assert.deepEqual(
    environmentEnhancementContractFromDecision(editedAndResaved).movementCue,
    editedDraft.option.environmentEnhancement.movementCue,
    "the normalized movement cue survives checkpoint save",
  );
  const downstream = JSON.parse(await readFile(path.join(decisionsRoot, "dynamic-geometry.json"), "utf8"));
  assertDecisionState(downstream, "stale");
  assert.equal(downstream.invalidatedBy, "environment-enhancement");

  await writeFile(assetPath, "environment-v2-tampered");
  await assert.rejects(
    () => saveEnvironmentEnhancementCheckpoint(options, editedAndResaved.option.environmentEnhancement),
    (error) => error.statusCode === 409 && /checksum/i.test(error.message),
  );

  await assert.rejects(
    () => generateComponentProposals(options, "environment-enhancement"),
    (error) => error.statusCode === 409 && /does not generate AI options/i.test(error.message),
  );
});

test("generated PNG panoramas validate as story-local environment assets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-generated-environment-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "story");
  const decisionsRoot = path.join(storyFolder, "analysis", "storyvr", "decisions");
  const publicPath = "environment-enhancement/codex-generated-sunny-beach/sunny-beach.png";
  const assetPath = path.join(storyFolder, "webxr-adaptation", "public", publicPath);
  await mkdir(decisionsRoot, { recursive: true });
  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]));
  await writeCurrentSpatialDecision(decisionsRoot);

  const saved = await saveEnvironmentEnhancementCheckpoint({ storyFolder }, {
    schemaVersion: "storyvr-environment-enhancement/v1",
    selectedSource: {
      candidate: {
        title: "Sunny beach",
        provider: "codex-cli",
        generationMode: "generated",
      },
    },
    asset: {
      publicPath,
      entryPath: "codex-generated-sunny-beach/sunny-beach.png",
      format: "png",
    },
    transform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
    rendering: { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
    provenance: { provider: "codex-cli", generationMode: "generated" },
  });

  assertDecisionState(saved, "current");
  assert.equal(saved.option.environmentEnhancement.asset.publicPath, publicPath);
  assert.equal(saved.option.environmentEnhancement.asset.format, "png");
  assert.equal(saved.option.environmentEnhancement.asset.mediaType, "image/png");
  assert.match(saved.option.environmentEnhancement.asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(saved.option.environmentEnhancement.provenance.generationMode, "generated");
});

test("beat-scoped environment assignments validate authored beat ids and preserve explicit neutral beats", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-beat-environment-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "story");
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const decisionsRoot = path.join(analysisRoot, "decisions");
  const publicPath = "environment-enhancement/generated-beach/environment.png";
  const assetPath = path.join(storyFolder, "webxr-adaptation", "public", publicPath);
  await mkdir(decisionsRoot, { recursive: true });
  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]));
  await writeFile(path.join(analysisRoot, "story-graph.json"), JSON.stringify({
    schemaVersion: "storyvr-source-graph/v1",
    beats: [
      { id: "beat-beach", title: "Beach" },
      { id: "beat-city", title: "City" },
    ],
  }, null, 2));
  await writeCurrentSpatialDecision(decisionsRoot);

  const beach = {
    schemaVersion: "storyvr-environment-enhancement/v1",
    selectedSource: { candidate: { title: "Sunny beach", provider: "codex-cli" } },
    asset: {
      publicPath,
      entryPath: "generated-beach/environment.png",
      format: "png",
    },
    transform: { position: [0, 0, 0], rotationY: 0.4, scale: 1 },
    rendering: { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
    provenance: { provider: "codex-cli" },
  };
  const scopedState = {
    schemaVersion: "storyvr-environment-enhancement-store/v2",
    defaultAssignment: null,
    assignmentsByBeat: {
      "beat-beach": beach,
      "beat-city": null,
    },
  };

  const saved = await saveEnvironmentEnhancementCheckpoint({ storyFolder }, scopedState);
  assertDecisionState(saved, "current");
  assert.equal(
    saved.option.environmentEnhancement.schemaVersion,
    "storyvr-environment-enhancement-assignments/v2",
  );
  assert.equal(saved.option.environmentEnhancement.defaultEnvironment, null);
  assert.equal(
    saved.option.environmentEnhancement.assignmentsByBeat["beat-beach"].asset.publicPath,
    publicPath,
  );
  assert.equal(saved.option.environmentEnhancement.assignmentsByBeat["beat-city"], null);
  assert.equal(environmentEnhancementContractFromDecision(saved).assignmentsByBeat["beat-beach"].transform.rotationY, 0.4);

  await assert.rejects(
    () => saveEnvironmentEnhancementDecisionDraft({ storyFolder }, {
      ...scopedState,
      assignmentsByBeat: { "missing-beat": beach },
    }),
    (error) => (
      error.statusCode === 409
      && error.diagnostics?.[0]?.code === "UNKNOWN_ENVIRONMENT_ASSIGNMENT_BEAT"
    ),
  );
});

test("generated ground texture descriptors are normalized and checksum-validated with the panorama", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-generated-ground-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "story");
  const decisionsRoot = path.join(storyFolder, "analysis", "storyvr", "decisions");
  const publicRoot = path.join(storyFolder, "webxr-adaptation", "public");
  const panoramaPublicPath = "environment-enhancement/codex-generated-underwater/environment.png";
  const groundPublicPath = "environment-enhancement/codex-generated-underwater/ground texture.png";
  const panoramaPath = path.join(publicRoot, panoramaPublicPath);
  const groundPath = path.join(publicRoot, groundPublicPath);
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const groundBytes = Buffer.concat([pngSignature, Buffer.from("generated-ground-v1")]);
  await mkdir(decisionsRoot, { recursive: true });
  await mkdir(path.dirname(panoramaPath), { recursive: true });
  await writeFile(panoramaPath, pngSignature);
  await writeFile(groundPath, groundBytes);
  await writeCurrentSpatialDecision(decisionsRoot);

  const draft = await saveEnvironmentEnhancementDecisionDraft({ storyFolder }, {
    schemaVersion: "storyvr-environment-enhancement/v1",
    selectedSource: { candidate: { title: "Underwater ocean", provider: "codex-cli" } },
    asset: {
      publicPath: panoramaPublicPath,
      entryPath: "codex-generated-underwater/environment.png",
      format: "png",
    },
    transform: { position: [0, 0, 0], rotationY: 0.25, scale: 1 },
    rendering: { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
    movementCue: {
      enabled: true,
      style: "sand",
      position: [0, 0.004, -0.4],
      widthMeters: 4,
      depthMeters: 4,
      thicknessMeters: 0.008,
      textureScaleMeters: 1,
      opacity: 0.7,
      texture: {
        role: "ground-texture",
        localPath: "/untrusted/local/path.png",
        publicPath: groundPublicPath,
        entryPath: "codex-generated-underwater/ground texture.png",
        format: "png",
        mediaType: "image/png",
        sha256: "",
        bytes: 1,
        generation: {
          provider: "codex-cli",
          generationId: "ground-generation-1",
          sourcePanoramaSha256: "panorama-input-sha",
        },
      },
    },
    provenance: { provider: "codex-cli" },
  });

  const texture = draft.option.environmentEnhancement.movementCue.texture;
  assert.deepEqual(texture, {
    role: "ground-texture",
    localPath: "/environment-assets/codex-generated-underwater/ground%20texture.png",
    publicPath: groundPublicPath,
    entryPath: "codex-generated-underwater/ground texture.png",
    format: "png",
    mediaType: "image/png",
    sha256: texture.sha256,
    bytes: groundBytes.byteLength,
    generation: {
      provider: "codex-cli",
      generationId: "ground-generation-1",
      sourcePanoramaSha256: "panorama-input-sha",
    },
  });
  assert.match(texture.sha256, /^[a-f0-9]{64}$/);
  assert.equal(draft.option.environmentEnhancement.asset.publicPath, panoramaPublicPath);
  assert.equal(draft.option.environmentEnhancement.transform.rotationY, 0.25);

  await writeFile(groundPath, Buffer.concat([pngSignature, Buffer.from("generated-ground-v2")]));
  await assert.rejects(
    () => saveEnvironmentEnhancementCheckpoint(
      { storyFolder },
      draft.option.environmentEnhancement,
    ),
    (error) => (
      error.statusCode === 409
      && /ground movement-cue texture checksum/i.test(error.message)
      && error.diagnostics?.[0]?.code === "ENVIRONMENT_GROUND_TEXTURE_CHECKSUM_MISMATCH"
    ),
  );
});

test("ground texture validation rejects unsafe, missing, non-PNG, and escaping assets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-ground-validation-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "story");
  const decisionsRoot = path.join(storyFolder, "analysis", "storyvr", "decisions");
  const publicRoot = path.join(storyFolder, "webxr-adaptation", "public");
  const panoramaPublicPath = "environment-enhancement/generated/environment.png";
  const panoramaPath = path.join(publicRoot, panoramaPublicPath);
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  await mkdir(decisionsRoot, { recursive: true });
  await mkdir(path.dirname(panoramaPath), { recursive: true });
  await writeFile(panoramaPath, pngSignature);
  await writeCurrentSpatialDecision(decisionsRoot);

  const environmentState = (texture) => ({
    schemaVersion: "storyvr-environment-enhancement/v1",
    selectedSource: { candidate: { title: "Generated environment", provider: "codex-cli" } },
    asset: {
      publicPath: panoramaPublicPath,
      entryPath: "generated/environment.png",
      format: "png",
    },
    transform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
    rendering: { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
    movementCue: {
      enabled: true,
      texture,
    },
  });
  const descriptor = (publicPath, overrides = {}) => ({
    role: "ground-texture",
    publicPath,
    format: "png",
    mediaType: "image/png",
    generation: null,
    ...overrides,
  });

  await assert.rejects(
    () => saveEnvironmentEnhancementDecisionDraft(
      { storyFolder },
      environmentState(descriptor("environment-enhancement/generated/../outside.png")),
    ),
    (error) => error.statusCode === 409 && /safe path/i.test(error.message),
  );
  await assert.rejects(
    () => saveEnvironmentEnhancementDecisionDraft(
      { storyFolder },
      environmentState(descriptor("environment-enhancement/generated/ground.png", { format: "jpg" })),
    ),
    (error) => error.statusCode === 409 && /must be a PNG/i.test(error.message),
  );
  await assert.rejects(
    () => saveEnvironmentEnhancementDecisionDraft(
      { storyFolder },
      environmentState(descriptor("environment-enhancement/generated/ground.png", { role: "panorama" })),
    ),
    (error) => error.statusCode === 409 && /role must be ground-texture/i.test(error.message),
  );
  await assert.rejects(
    () => saveEnvironmentEnhancementDecisionDraft(
      { storyFolder },
      environmentState(descriptor("environment-enhancement/generated/missing.png")),
    ),
    (error) => error.statusCode === 409 && /missing from the story folder/i.test(error.message),
  );

  const directoryPath = path.join(publicRoot, "environment-enhancement", "generated", "directory.png");
  await mkdir(directoryPath, { recursive: true });
  await assert.rejects(
    () => saveEnvironmentEnhancementDecisionDraft(
      { storyFolder },
      environmentState(descriptor("environment-enhancement/generated/directory.png")),
    ),
    (error) => error.statusCode === 409 && /not a regular file/i.test(error.message),
  );

  const outsideGroundPath = path.join(root, "outside-ground.png");
  const linkedGroundPath = path.join(publicRoot, "environment-enhancement", "generated", "linked-ground.png");
  await writeFile(outsideGroundPath, pngSignature);
  await symlink(outsideGroundPath, linkedGroundPath);
  await assert.rejects(
    () => saveEnvironmentEnhancementDecisionDraft(
      { storyFolder },
      environmentState(descriptor("environment-enhancement/generated/linked-ground.png")),
    ),
    (error) => error.statusCode === 409 && /must resolve inside/i.test(error.message),
  );
});

test("load migrates legacy Context Layering workflow state without accepting its decision", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-environment-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "legacy-story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const decisionsRoot = path.join(analysisRoot, "decisions");
  const proposalsRoot = path.join(analysisRoot, "proposals");
  await mkdir(metadataRoot, { recursive: true });
  await mkdir(decisionsRoot, { recursive: true });
  await mkdir(proposalsRoot, { recursive: true });

  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), JSON.stringify({
    story_url: "https://example.com/legacy-story",
    title: "Legacy Story",
    text_only_parts: [{ id: "beat-1", text: "A room surrounds the story object." }],
  }, null, 2));
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), "[]\n");
  await writeFile(path.join(analysisRoot, "project.json"), JSON.stringify({
    schemaVersion: "storyvr-author/v1",
    componentOrder: [
      "source-graph",
      "asset-topology",
      "dynamic-geometry",
      "inter-beat-dynamics",
      "context-layering",
      "text-comfort",
      "interaction-control",
      "transition-pacing",
    ],
    activeComponent: "context-layering",
  }, null, 2));
  await writeFile(path.join(decisionsRoot, "context-layering.json"), JSON.stringify({
    schemaVersion: "storyvr-decision/v2",
    component: "context-layering",
    label: "Context Layering",
    option: { optionId: "context-object", label: "Object only" },
    status: "current",
    savedAt: new Date(0).toISOString(),
  }, null, 2));
  await writeDecision(decisionsRoot, "text-comfort", { optionId: "text-fixed", label: "Fixed panel" });
  await writeFile(path.join(proposalsRoot, "context-layering.json"), JSON.stringify({ proposals: [] }));

  const loaded = await loadAuthorProject({ storyFolder, resourceFolder });
  assert.deepEqual(loaded.project.componentOrder, COMPONENTS.map((component) => component.id));
  assert.equal(loaded.project.componentOrder.includes("context-layering"), false);
  assert.equal(loaded.project.activeComponent, "environment-enhancement");
  assert.equal(loaded.decisions["context-layering"], undefined);
  assert.equal(loaded.decisions["environment-enhancement"], undefined);
  assert.deepEqual(
    pickReadinessState(loaded.readiness["environment-enhancement"]),
    { status: "draft", current: false, saved: false, stale: false },
  );

  const legacyDecision = JSON.parse(await readFile(path.join(decisionsRoot, "context-layering.json"), "utf8"));
  const downstream = JSON.parse(await readFile(path.join(decisionsRoot, "spatial-relations.json"), "utf8"));
  assertDecisionState(legacyDecision, "stale");
  assert.equal(legacyDecision.migratedTo, "environment-enhancement");
  assertDecisionState(downstream, "draft", { saved: false });
  assert.equal(downstream.invalidatedBy, undefined);
  assert.equal(downstream.migratedFrom, "text-comfort");
  assert.ok(loaded.project.workflowMigrations["context-layering-to-environment-enhancement-v1"]);
  assert.ok(loaded.project.workflowMigrations["insert-attention-guidance-v1"]);

  await loadAuthorProject({ storyFolder, resourceFolder });
  const legacyAfterReload = JSON.parse(await readFile(path.join(decisionsRoot, "context-layering.json"), "utf8"));
  assert.deepEqual(legacyAfterReload, legacyDecision, "migration does not churn legacy decision state on reload");
});

test("legacy Asset Topology becomes a draft Spatial v2 decision and marks downstream state stale", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-topology-spatial-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "legacy-topology-story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const decisionsRoot = path.join(analysisRoot, "decisions");
  await mkdir(metadataRoot, { recursive: true });
  await mkdir(decisionsRoot, { recursive: true });
  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), JSON.stringify({
    story_url: "https://example.test/legacy-topology-story",
    title: "Legacy Topology Story",
    text_only_parts: [{ id: "beat-1", text: "A legacy scene needs review." }],
  }, null, 2));
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), "[]\n");
  await writeFile(path.join(analysisRoot, "project.json"), JSON.stringify({
    schemaVersion: "storyvr-author/v1",
    componentOrder: [
      "source-graph",
      "asset-topology",
      "environment-enhancement",
      "spatial-relations",
      "dynamic-geometry",
      "inter-beat-dynamics",
      "interaction-control",
      "transition-pacing",
    ],
    activeComponent: "asset-topology",
  }, null, 2));
  await writeDecision(decisionsRoot, "asset-topology", {
    optionId: "asset-topology-single-anchor",
    label: "Single anchor",
    viewpoint: "exocentric",
    viewpointLabel: "Exocentric viewpoint",
  });
  await writeDecision(decisionsRoot, "environment-enhancement", {
    optionId: "environment-enhancement-no-added-environment",
    label: "No added environment",
    environmentEnhancementSkipped: true,
    environmentEnhancement: null,
    assetLinks: [],
  });
  await writeDecision(decisionsRoot, "dynamic-geometry", {
    optionId: "dynamic-geometry-source-dynamics-preview",
    label: "No dynamics",
    sourceDynamicsPreview: true,
  });

  const loaded = await loadAuthorProject({ storyFolder, resourceFolder });
  assert.equal(loaded.project.activeComponent, "spatial-relations");
  assert.ok(loaded.project.workflowMigrations["asset-topology-into-spatial-relations-v2"]);
  assert.equal(loaded.spatialRelations.schemaVersion, "storyvr-spatial-relations/v2");
  assert.equal(loaded.spatialRelations.viewpoint, "exocentric");
  assert.equal(Object.values(loaded.spatialRelations.resolvedByBeat)[0].topology.label, "Single anchor");
  assertDecisionState(loaded.decisions["spatial-relations"], "draft", { saved: false });
  assert.equal(loaded.decisions["spatial-relations"].requiresReview, true);
  assert.equal(loaded.decisions["spatial-relations"].migratedFrom, "asset-topology");
  assert.equal(loaded.decisions["asset-topology"].autoDerived, true);
  assert.equal(loaded.decisions["asset-topology"].option.viewpoint, "exocentric");
  assert.equal(loaded.decisions["asset-topology"].option.label, "Single anchor");
  assertDecisionState(loaded.decisions["environment-enhancement"], "stale");
  assert.equal(loaded.decisions["environment-enhancement"].invalidatedBy, "spatial-relations");
  assertDecisionState(loaded.decisions["dynamic-geometry"], "stale");
  assert.equal(loaded.decisions["dynamic-geometry"].invalidatedBy, "attention-guidance");
});

test("No added environment can be saved and still enables downstream authoring and compile", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-environment-skip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "classroom-story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const decisionsRoot = path.join(storyFolder, "analysis", "storyvr", "decisions");
  await mkdir(metadataRoot, { recursive: true });
  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), JSON.stringify({
    story_url: "https://example.test/classroom-story",
    title: "Classroom Story",
    text_only_parts: [
      { id: "beat-1", text: "Students compare a sequence of classroom demonstrations." },
      { id: "beat-2", text: "The same teaching space remains implicit throughout the lesson." },
    ],
  }, null, 2));
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), "[]\n");
  const options = { storyFolder, resourceFolder };
  const initial = await loadAuthorProject(options);
  assert.equal(initial.readiness["spatial-relations"].canGenerate, true);
  assert.equal(initial.readiness["environment-enhancement"].canGenerate, false);

  await writeDecision(decisionsRoot, "asset-topology", {
    optionId: "asset-topology-single-anchor",
    label: "Single anchor",
    viewpoint: "exocentric",
  });
  const afterTopology = await loadAuthorProject(options);
  assert.equal(afterTopology.readiness["spatial-relations"].canGenerate, true);
  assert.equal(afterTopology.readiness["spatial-relations"].current, false);
  assert.equal(afterTopology.spatialRelations.viewpoint, "exocentric");
  assert.equal(afterTopology.readiness["dynamic-geometry"].canGenerate, false);

  await saveCheckpointDecision(options, "spatial-relations", {
    optionId: afterTopology.proposals["spatial-relations"].defaultOptionId,
    spatialRelations: afterTopology.spatialRelations,
  });
  const afterSpatial = await loadAuthorProject(options);
  assert.deepEqual(
    pickReadinessState(afterSpatial.readiness["spatial-relations"]),
    { status: "current", current: true, saved: true, stale: false },
  );
  assert.equal(afterSpatial.readiness["environment-enhancement"].canGenerate, true);
  assert.equal(afterSpatial.readiness["dynamic-geometry"].current, false, "Dynamics waits for Environment Enhancement");

  const skipped = await saveNoEnvironmentEnhancementCheckpoint(options);
  assertDecisionState(skipped, "current");
  assert.equal(skipped.option.optionId, "environment-enhancement-no-added-environment");
  assert.equal(skipped.option.label, "No added environment");
  assert.equal(skipped.option.environmentEnhancementSkipped, true);
  assert.equal(skipped.option.environmentEnhancement, null);
  assert.deepEqual(skipped.option.assetLinks, []);
  assert.equal(environmentEnhancementContractFromDecision(skipped), null);

  const loaded = await loadAuthorProject(options);
  assert.equal(loaded.readiness["environment-enhancement"].current, true);
  assert.equal(loaded.readiness["spatial-relations"].current, true);
  assert.equal(loaded.readiness["attention-guidance"].canGenerate, true);
  assert.equal(loaded.readiness["attention-guidance"].current, false);
  assert.equal(loaded.readiness["dynamic-geometry"].current, false, "Dynamics waits for Attention Guidance");
  assert.ok(loaded.proposals["attention-guidance"].attentionGuidance);

  const attentionDraft = await saveAttentionGuidanceDecisionDraft(options, {
    attentionGuidance: loaded.attentionGuidance,
  });
  assertDecisionState(attentionDraft, "draft", { saved: false });
  assert.ok(Object.values(attentionDraft.attentionGuidance.resolvedByBeat).every((scene) => scene.evaluated));
  await saveCheckpointDecision(options, "attention-guidance");
  const afterAttention = await loadAuthorProject(options);
  assert.equal(afterAttention.readiness["attention-guidance"].current, true);
  assert.equal(afterAttention.readiness["dynamic-geometry"].current, false);
  assert.equal(afterAttention.readiness["dynamic-geometry"].status, "draft");
  assert.equal(afterAttention.readiness["inter-beat-dynamics"].current, false);
  assert.equal(afterAttention.readiness["interaction-control"].unlocked, false);
  assert.equal("canGenerate" in afterAttention.readiness["interaction-control"], false);
  assert.equal(afterAttention.spatialRelations.schemaVersion, "storyvr-spatial-relations/v2");
  await saveCheckpointDecision(options, "dynamic-geometry");
  const afterDynamics = await loadAuthorProject(options);
  assert.equal(afterDynamics.readiness["inter-beat-dynamics"].canGenerate, true);
  assert.equal(afterDynamics.readiness["interaction-control"].unlocked, false);
  assert.equal("canGenerate" in afterDynamics.readiness["interaction-control"], false);
  await saveCheckpointDecision(options, "inter-beat-dynamics");
  const afterTransition = await loadAuthorProject(options);
  assert.equal(afterTransition.readiness["interaction-control"].unlocked, true);
  assert.equal("canGenerate" in afterTransition.readiness["interaction-control"], false);
  await writeDecision(decisionsRoot, "interaction-control", {
    optionId: "interaction-control-button-stepping",
    label: "Button stepping",
  });
  await writeDecision(decisionsRoot, "transition-pacing", {
    optionId: "transition-pacing-final-review-saved",
    label: "Final review saved",
  });

  const compiled = await compileAuthorRuntime(options);
  assert.equal(compiled.environmentEnhancement, null);
  assert.equal(compiled.interactions.interactionControlByBoundary.length, 1);
  assert.deepEqual(
    compiled.interactions.interactionControlByRoute,
    compiled.interactions.interactionControlByBoundary,
  );
  const [compiledRoute] = compiled.interactions.interactionControlByBoundary;
  assert.equal(compiledRoute.boundaryId, compiledRoute.edgeId);
  assert.equal(compiledRoute.routeId, compiledRoute.edgeId);
  assert.deepEqual(
    compiled.interactions.effectiveInteractionPolicyByRoute[compiledRoute.routeId].fromContext,
    compiledRoute.fromContext,
  );
  assert.deepEqual(compiled.timeline[0].outgoingInteractionControls.map((record) => record.routeId), [compiledRoute.routeId]);
  assert.deepEqual(compiled.timeline[1].incomingInteractionControls.map((record) => record.routeId), [compiledRoute.routeId]);
  assert.equal(compiled.attentionGuidance.coordinateSpace, "spatial-scene");
  assert.deepEqual(compiled.attentionGuidance.readerGuidance, {
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
  });
  assert.ok(Object.values(compiled.attentionGuidance.resolvedByBeat).every((scene) => (
    scene.evaluated === true && scene.coordinateSpace === "spatial-scene" && !Object.hasOwn(scene, "candidates")
  )));
  assert.equal(JSON.stringify(compiled.provenance.decisions["attention-guidance"]).includes('"candidates"'), false);
  assert.equal(JSON.stringify(compiled.sceneTopology.storyDesign["attention-guidance"]).includes('"candidates"'), false);
  assert.ok(compiled.timeline.every((entry) => (
    entry.attentionGuidance?.coordinateSpace === "spatial-scene"
    && entry.attentionGuidance.readerGuidance?.schemaVersion === "storyvr-attention-reader-guidance/v1"
  )));
  assert.equal(
    compiled.provenance.attentionGuidance.readerGuidanceSchemaVersion,
    "storyvr-attention-reader-guidance/v1",
  );
  assert.equal(compiled.provenance.decisions["environment-enhancement"].option.environmentEnhancementSkipped, true);
  assert.equal(compiled.sceneTopology.storyDesign["environment-enhancement"].environmentEnhancement, null);

  const savedAgain = await saveNoEnvironmentEnhancementCheckpoint(options);
  assertDecisionState(savedAgain, "current");
  assert.equal(savedAgain.option.environmentEnhancementSkipped, true);
});

async function writeDecision(decisionsRoot, component, option) {
  await writeFile(path.join(decisionsRoot, `${component}.json`), JSON.stringify({
    schemaVersion: "storyvr-decision/v2",
    component,
    label: component,
    option,
    status: "current",
    savedAt: new Date(0).toISOString(),
  }, null, 2));
}

async function writeCurrentSpatialDecision(decisionsRoot) {
  const spatialRelations = {
    schemaVersion: "storyvr-spatial-relations/v2",
    inferenceVersion: "per-beat-scenes-v1",
    inputSignature: "fixture-spatial-signature",
    inferredAt: new Date(0).toISOString(),
    viewpoint: "egocentric",
    entities: [],
    resolvedByBeat: {},
    resolvedByVariant: {},
    timeline: [],
  };
  await writeFile(path.join(decisionsRoot, "spatial-relations.json"), JSON.stringify({
    schemaVersion: "storyvr-decision/v2",
    component: "spatial-relations",
    label: "Spatial Relations",
    option: { optionId: "spatial-relations-inferred-layout", label: "Inferred layout" },
    spatialRelations,
    status: "current",
    savedAt: new Date(0).toISOString(),
  }, null, 2));
}

function assertDecisionState(decision, status, { saved = status !== "draft" } = {}) {
  assert.equal(decision.schemaVersion, "storyvr-decision/v2");
  assert.equal(decision.status, status);
  if (saved) assert.match(decision.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  else assert.equal(decision.savedAt, null);
  assert.equal(Object.hasOwn(decision, "approvedAt"), false);
  assert.equal(Object.hasOwn(decision, "locked"), false);
  assert.equal(Object.hasOwn(decision, "lockUpdatedAt"), false);
}

function pickReadinessState(readiness) {
  return {
    status: readiness.status,
    current: readiness.current,
    saved: readiness.saved,
    stale: readiness.stale,
  };
}
