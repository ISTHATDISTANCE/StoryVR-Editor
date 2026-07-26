import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createEnvironmentStore,
  DEFAULT_ENVIRONMENT_MOVEMENT_CUE,
  effectiveEnvironmentAssignment,
  ENVIRONMENT_STORE_SCHEMA_VERSION,
  MAX_ENVIRONMENT_UPLOAD_BYTES,
} from "./store.mjs";

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "storyvr-environment-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const storyFolder = path.join(repoRoot, "sample-story");
  await mkdir(storyFolder, { recursive: true });
  return {
    repoRoot,
    storyFolder,
    store: createEnvironmentStore({ repoRoot, storyFolder }),
  };
}

test("source selection survives reload and a 360-degree HDR upload writes a reader-public asset", async (t) => {
  const { repoRoot, storyFolder, store } = await fixture(t);
  const candidate = {
    id: "polyhaven:test-room",
    provider: "polyhaven",
    sourceId: "test-room",
    title: "Test room",
    sourceUrl: "https://polyhaven.com/a/test-room",
    license: { name: "CC0 1.0" },
    attribution: "Test room on Poly Haven, CC0 1.0",
  };
  const selected = await store.selectSource(candidate);
  assert.equal(selected.pendingSource.sourceId, "test-room");
  assert.equal(selected.asset, null);

  const reloadedStore = createEnvironmentStore({ repoRoot, storyFolder });
  assert.equal((await reloadedStore.getState()).pendingSource.sourceUrl, candidate.sourceUrl);

  const hdr = minimalHdr(4, 2);
  const uploaded = await reloadedStore.importUpload({
    filename: "room.hdr",
    expectedBytes: hdr.byteLength,
    body: hdr,
    sourceMetadata: { selectionMode: "search-result" },
    generateGround: matchingGroundGenerator(),
  });
  assert.equal(uploaded.schemaVersion, ENVIRONMENT_STORE_SCHEMA_VERSION);
  assert.equal(uploaded.candidate.id, candidate.id);
  assert.equal(uploaded.pendingSource, null);
  assert.equal(uploaded.selectedSource.sourceUrl, candidate.sourceUrl);
  assert.equal(uploaded.asset.localPath, "/environment-assets/polyhaven-test-room/room.hdr");
  assert.equal(uploaded.asset.publicPath, "environment-enhancement/polyhaven-test-room/room.hdr");
  assert.equal(uploaded.movementCue.enabled, true);
  assert.equal(uploaded.movementCue.style, "generated");
  assert.equal(uploaded.movementCue.texture.role, "ground-texture");
  assert.equal(
    uploaded.movementCue.texture.publicPath,
    "environment-enhancement/polyhaven-test-room/ground.png",
  );
  assert.deepEqual(uploaded.asset.dependencies, [uploaded.movementCue.texture]);
  assert.equal(uploaded.performance.fileCount, 2);
  const expectedPath = path.join(
    storyFolder,
    "webxr-adaptation",
    "public",
    "environment-enhancement",
    "polyhaven-test-room",
    "room.hdr",
  );
  assert.deepEqual(await readFile(expectedPath), hdr);
  assert.equal(reloadedStore.assetPathFromUrl(uploaded.asset.localPath), expectedPath);
  assert.equal(reloadedStore.assetPathFromUrl("/environment-assets/polyhaven-test-room/%2e%2e/secret"), null);

  const edited = await reloadedStore.updateDraft({
    transform: { position: [1, 0.25, -2], scale: 1.2 },
    rendering: { exposure: 0.9, fogDensity: 0.01 },
    movementCue: {
      enabled: true,
      style: "sand",
      position: [0.25, 0.004, -0.5],
      widthMeters: 2.4,
      depthMeters: 1.6,
      thicknessMeters: 0.01,
      textureScaleMeters: 0.2,
      opacity: 0.7,
    },
  });
  assert.deepEqual(edited.transform.position, [1, 0.25, -2]);
  assert.equal(edited.rendering.exposure, 0.9);
  assert.deepEqual(edited.movementCue, {
    enabled: true,
    style: "generated",
    texture: uploaded.movementCue.texture,
    position: [0.25, 0.004, -0.5],
    widthMeters: 2.4,
    depthMeters: 1.6,
    thicknessMeters: 0.01,
    textureScaleMeters: 0.2,
    opacity: 0.7,
  });
  const partialMovementCueEdit = await reloadedStore.updateDraft({
    movementCue: { widthMeters: 3 },
  });
  assert.equal(partialMovementCueEdit.movementCue.widthMeters, 3);
  assert.equal(partialMovementCueEdit.movementCue.opacity, 0.7, "partial cue edits preserve opacity");
  const editedAgain = await reloadedStore.updateDraft({
    transform: { scale: 2 },
    movementCue: {
      style: "unsupported",
      position: [-500, Number.NaN, 500],
      widthMeters: 500,
      depthMeters: null,
      thicknessMeters: 0,
      textureScaleMeters: Number.POSITIVE_INFINITY,
      opacity: 2,
    },
  });
  assert.equal(editedAgain.transform.scale, 2, "a saved environment remains editable");
  assert.deepEqual(editedAgain.movementCue, {
    enabled: true,
    style: "generated",
    texture: uploaded.movementCue.texture,
    position: [-100, 0.004, 100],
    widthMeters: 200,
    depthMeters: 1.6,
    thicknessMeters: 0.001,
    textureScaleMeters: 0.2,
    opacity: 1,
  });
  await assert.rejects(
    () => reloadedStore.updateDraft({ movementCue: null }),
    /movementCue must be an object/,
  );
  const replacement = await reloadedStore.importUpload({
    candidate: { provider: "manual-upload", providerAssetId: "replacement", title: "Replacement" },
    filename: "replacement.hdr",
    body: hdr,
    sourceMetadata: { selectionMode: "manual-upload" },
    generateGround: matchingGroundGenerator({ originalArtifactName: "replacement-ground.png" }),
  });
  assert.deepEqual(Object.keys(replacement).filter((key) => key.endsWith("Confirmation")), []);
  assert.equal(replacement.asset.publicPath, "environment-enhancement/manual-upload-replacement/replacement.hdr");
  assert.deepEqual(
    {
      ...replacement.movementCue,
      texture: null,
    },
    {
      ...editedAgain.movementCue,
      texture: null,
    },
    "a replacement panorama preserves the authored ground geometry and visibility",
  );
  assert.equal(
    replacement.movementCue.texture.publicPath,
    "environment-enhancement/manual-upload-replacement/ground.png",
    "a replacement panorama receives its own matching ground",
  );
  assert.equal(
    (await stat(path.dirname(expectedPath))).isDirectory(),
    true,
    "replaced bundles are retained because another beat or saved checkpoint may still reference them",
  );

  const manifest = JSON.parse(await readFile(
    path.join(storyFolder, "analysis", "storyvr", "environment-enhancement.json"),
    "utf8",
  ));
  assert.equal(manifest.asset.publicPath, replacement.asset.publicPath);
  assert.equal(Object.hasOwn(manifest, "locked"), false);
  assert.equal(Object.hasOwn(manifest, "lockedAt"), false);
});

test("upload accepts only valid 2:1 HDR or EXR panoramas", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.importUpload({
    candidate: { provider: "manual-upload", providerAssetId: "too-large" },
    filename: "large.hdr",
    expectedBytes: MAX_ENVIRONMENT_UPLOAD_BYTES + 1,
    body: minimalHdr(4, 2),
  }), /upload exceeds/);
  await assert.rejects(store.importUpload({
    candidate: { provider: "manual-upload", providerAssetId: "model" },
    filename: "room.glb",
    body: Buffer.from("glTF"),
  }), /must end in \.hdr or \.exr/);
  await assert.rejects(store.importUpload({
    candidate: { provider: "manual-upload", providerAssetId: "manual-png" },
    filename: "room.png",
    body: minimalPng(2048, 1024),
  }), /must end in \.hdr or \.exr/);
  await assert.rejects(store.importUpload({
    candidate: { provider: "manual-upload", providerAssetId: "flat-hdr" },
    filename: "flat.hdr",
    body: minimalHdr(4, 4),
  }), /2:1 equirectangular aspect ratio/);
  await assert.rejects(store.importUpload({
    candidate: { provider: "manual-upload", providerAssetId: "bad-hdr" },
    filename: "bad.hdr",
    body: Buffer.from("not an HDR image"),
  }), /Radiance\/RGBE header/);
  assert.equal((await store.getState()).asset, null, "rejected uploads do not change the environment state");

  const exr = minimalExr(4, 2);
  const uploaded = await store.importUpload({
    candidate: { provider: "manual-upload", providerAssetId: "valid-exr" },
    filename: "valid.exr",
    expectedBytes: exr.byteLength,
    body: exr,
    generateGround: matchingGroundGenerator(),
  });
  assert.equal(uploaded.asset.format, "exr");
  assert.equal(uploaded.movementCue.texture.format, "png");
});

test("trusted Codex CLI generation imports a 2:1 PNG without broadening manual uploads", async (t) => {
  const { storyFolder, store } = await fixture(t);
  const png = minimalPng(2048, 1024);
  const candidate = {
    id: "codex-cli:generated-test",
    provider: "codex-cli",
    providerAssetId: "generated-test",
    title: "Sunny ocean beach",
    sourceUrl: null,
    provenance: {
      source: "codex-cli-image-generation",
      generated: true,
      prompt: "sunny ocean beach",
      tool: "image_generation",
    },
  };
  const generated = await store.importGenerated({
    candidate,
    filename: "environment.png",
    body: png,
    expectedBytes: png.byteLength,
    sourceMetadata: {
      selectionMode: "codex-cli-generation",
      dimensions: { width: 2048, height: 1024 },
    },
    ground: matchingGround(),
  });

  assert.equal(generated.asset.format, "png");
  assert.equal(generated.asset.mediaType, "image/png");
  assert.equal(generated.asset.sourceUpload.kind, "generated");
  assert.equal(generated.provenance.sourceMetadata.importMethod, "codex-cli-generation");
  assert.equal(generated.provenance.generated, true);
  assert.deepEqual(Object.keys(generated).filter((key) => key.endsWith("Confirmation")), []);
  assert.equal(generated.movementCue.enabled, true);
  assert.equal(generated.movementCue.texture.publicPath, "environment-enhancement/codex-cli-generated-test/ground.png");
  assert.equal(generated.asset.dependencies[0].sha256, generated.movementCue.texture.sha256);
  const expectedPath = path.join(
    storyFolder,
    "webxr-adaptation",
    "public",
    "environment-enhancement",
    "codex-cli-generated-test",
    "environment.png",
  );
  assert.deepEqual(await readFile(expectedPath), png);
  assert.deepEqual(
    await readFile(path.join(path.dirname(expectedPath), "ground.png")),
    matchingGround().body,
  );

  await assert.rejects(store.importGenerated({
    candidate: {
      ...candidate,
      providerAssetId: "wrong-ratio",
    },
    filename: "environment.png",
    body: minimalPng(1024, 1024),
  }), /2:1 equirectangular aspect ratio/);
  await assert.rejects(store.importGenerated({
    candidate: {
      provider: "manual-upload",
      providerAssetId: "untrusted",
      provenance: { generated: true, source: "user-upload" },
    },
    filename: "environment.png",
    body: png,
  }), /must come from Codex CLI image generation/);
  assert.equal(
    (await store.getState()).asset.providerAssetId,
    "generated-test",
    "rejected generated imports do not replace the installed asset",
  );
});

test("matching-ground failure leaves the previous panorama bundle and manifest untouched", async (t) => {
  const { storyFolder, store } = await fixture(t);
  const panorama = minimalPng(2048, 1024);
  await store.importGenerated({
    candidate: {
      provider: "codex-cli",
      providerAssetId: "stable",
      provenance: {
        source: "codex-cli-image-generation",
        generated: true,
      },
    },
    filename: "environment.png",
    body: panorama,
    ground: matchingGround(),
  });
  const before = await store.getState();
  const beforeManifest = await readFile(
    path.join(storyFolder, "analysis", "storyvr", "environment-enhancement.json"),
    "utf8",
  );
  const stableAssetPath = path.join(
    storyFolder,
    "webxr-adaptation",
    "public",
    "environment-enhancement",
    "codex-cli-stable",
    "environment.png",
  );

  await assert.rejects(
    store.importUpload({
      candidate: { provider: "manual-upload", providerAssetId: "failed-replacement" },
      filename: "replacement.hdr",
      body: minimalHdr(4, 2),
      generateGround: async () => {
        throw new Error("ground generation unavailable");
      },
    }),
    /ground generation unavailable/,
  );

  assert.deepEqual(await store.getState(), before);
  assert.equal(
    await readFile(path.join(storyFolder, "analysis", "storyvr", "environment-enhancement.json"), "utf8"),
    beforeManifest,
  );
  assert.deepEqual(await readFile(stableAssetPath), panorama);
  await assert.rejects(
    stat(path.join(path.dirname(path.dirname(stableAssetPath)), "manual-upload-failed-replacement")),
    /ENOENT/,
  );
});

test("beat-scoped assignments reuse one bundle, isolate edits, and retain shared assets", async (t) => {
  const { storyFolder, store } = await fixture(t);
  const first = await store.importGenerated({
    beatId: "beat-a",
    candidate: generatedCandidate("beat-scope-one"),
    filename: "environment.png",
    body: minimalPng(2048, 1024),
    ground: matchingGround(),
  });

  assert.equal(first.defaultAssignment, null);
  assert.equal(first.assignmentsByBeat["beat-a"].asset.providerAssetId, "beat-scope-one");
  assert.equal(effectiveEnvironmentAssignment(first, "beat-b"), null);
  const firstBundle = path.join(
    storyFolder,
    "webxr-adaptation",
    "public",
    "environment-enhancement",
    "codex-cli-beat-scope-one",
  );

  const applied = await store.applyAssignment({
    sourceBeatId: "beat-a",
    targetBeatIds: ["beat-b", "beat-c", "beat-b"],
    expectedRevision: first.revision,
  });
  assert.equal(
    applied.assignmentsByBeat["beat-b"].asset.publicPath,
    applied.assignmentsByBeat["beat-a"].asset.publicPath,
  );
  assert.equal(
    applied.assignmentsByBeat["beat-c"].movementCue.texture.sha256,
    applied.assignmentsByBeat["beat-a"].movementCue.texture.sha256,
  );
  assert.deepEqual(
    (await readdir(path.dirname(firstBundle))).filter((name) => !name.startsWith(".")),
    ["codex-cli-beat-scope-one"],
    "applying to beats does not duplicate the panorama bundle",
  );

  const edited = await store.updateDraft({
    beatId: "beat-b",
    transform: { position: [2, 0, -1] },
  });
  assert.deepEqual(edited.assignmentsByBeat["beat-b"].transform.position, [2, 0, -1]);
  assert.deepEqual(edited.assignmentsByBeat["beat-a"].transform.position, [0, 0, 0]);

  const skipped = await store.updateDraft({ beatId: "beat-b", skipped: true });
  assert.equal(skipped.assignmentsByBeat["beat-b"].skipped, true);
  assert.equal(
    skipped.assignmentsByBeat["beat-b"].asset.publicPath,
    edited.assignmentsByBeat["beat-b"].asset.publicPath,
    "a neutral selection retains its asset for a reversible switch",
  );

  const replacement = await store.importGenerated({
    beatId: "beat-a",
    candidate: generatedCandidate("beat-scope-two"),
    filename: "environment.png",
    body: minimalPng(2048, 1024),
    ground: matchingGround(),
  });
  assert.equal(replacement.assignmentsByBeat["beat-a"].asset.providerAssetId, "beat-scope-two");
  assert.equal(replacement.assignmentsByBeat["beat-c"].asset.providerAssetId, "beat-scope-one");
  assert.equal((await stat(path.join(firstBundle, "environment.png"))).isFile(), true);

  await assert.rejects(
    store.applyAssignment({
      sourceBeatId: "beat-a",
      targetBeatIds: ["beat-c"],
      expectedRevision: replacement.revision - 1,
    }),
    (error) => error?.statusCode === 409,
  );
  assert.equal(
    (await store.getState()).assignmentsByBeat["beat-c"].asset.providerAssetId,
    "beat-scope-one",
  );
});

test("legacy top-level assets become the default assignment while a new store stays neutral", async (t) => {
  const { repoRoot, storyFolder, store } = await fixture(t);
  assert.equal((await store.getState()).defaultAssignment, null);

  const manifestPath = path.join(storyFolder, "analysis", "storyvr", "environment-enhancement.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: ENVIRONMENT_STORE_SCHEMA_VERSION,
    revision: 7,
    asset: {
      providerAssetId: "legacy",
      publicPath: "environment-enhancement/legacy/environment.hdr",
    },
    transform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
    rendering: { exposure: 1 },
    movementCue: DEFAULT_ENVIRONMENT_MOVEMENT_CUE,
    [["rights", "Confirmation"].join("")]: { confirmed: true },
  }, null, 2)}\n`);
  const legacy = await createEnvironmentStore({
    repoRoot,
    storyFolder: path.relative(repoRoot, storyFolder),
  }).getState();
  assert.equal(legacy.defaultAssignment.asset.providerAssetId, "legacy");
  assert.equal(
    effectiveEnvironmentAssignment(legacy, "any-authored-beat").asset.providerAssetId,
    "legacy",
  );
  assert.deepEqual(Object.keys(legacy).filter((key) => key.endsWith("Confirmation")), []);
  assert.deepEqual(Object.keys(legacy.defaultAssignment).filter((key) => key.endsWith("Confirmation")), []);
});

test("retired consent metadata is removed recursively from scoped manifests", async (t) => {
  const { repoRoot, storyFolder } = await fixture(t);
  const manifestPath = path.join(storyFolder, "analysis", "storyvr", "environment-enhancement.json");
  const retiredKey = ["rights", "Confirmation"].join("");
  const assignment = {
    asset: {
      providerAssetId: "scoped-legacy",
      publicPath: "environment-enhancement/scoped-legacy/environment.hdr",
      [retiredKey]: { confirmed: true },
    },
    transform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
    rendering: { exposure: 1 },
    movementCue: DEFAULT_ENVIRONMENT_MOVEMENT_CUE,
    [retiredKey]: { confirmed: true },
  };
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: ENVIRONMENT_STORE_SCHEMA_VERSION,
    revision: 2,
    defaultAssignment: assignment,
    assignmentsByBeat: {
      "beat-a": assignment,
    },
  }, null, 2)}\n`);

  const store = createEnvironmentStore({
    repoRoot,
    storyFolder: path.relative(repoRoot, storyFolder),
  });
  const loaded = await store.getState();
  assert.equal(JSON.stringify(loaded).includes(retiredKey), false);

  await store.updateDraft({
    transform: { rotationY: 0.25 },
  });
  assert.equal((await readFile(manifestPath, "utf8")).includes(retiredKey), false);
});

function matchingGround(metadata = {}) {
  const body = minimalPng(1024, 1024);
  return {
    filename: "ground.png",
    body,
    expectedBytes: body.byteLength,
    metadata: {
      provider: "codex-cli",
      tool: "image_generation",
      generationRole: "matching-ground",
      dimensions: { width: 1024, height: 1024 },
      ...metadata,
    },
  };
}

function matchingGroundGenerator(metadata = {}) {
  return async () => matchingGround(metadata);
}

function generatedCandidate(providerAssetId) {
  return {
    provider: "codex-cli",
    providerAssetId,
    provenance: {
      source: "codex-cli-image-generation",
      generated: true,
    },
  };
}

function minimalHdr(width, height) {
  return Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, "ascii");
}

function minimalPng(width, height) {
  const result = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(result, 0);
  result.writeUInt32BE(13, 8);
  result.write("IHDR", 12, "ascii");
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

function minimalExr(width, height) {
  const name = Buffer.from("dataWindow\0", "ascii");
  const type = Buffer.from("box2i\0", "ascii");
  const value = Buffer.alloc(16);
  value.writeInt32LE(0, 0);
  value.writeInt32LE(0, 4);
  value.writeInt32LE(width - 1, 8);
  value.writeInt32LE(height - 1, 12);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x01312f76, 0);
  header.writeUInt32LE(2, 4);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(value.byteLength, 0);
  return Buffer.concat([header, name, type, size, value, Buffer.from([0])]);
}
