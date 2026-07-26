import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createEnvironmentStore,
  ENVIRONMENT_STORE_SCHEMA_VERSION,
  MAX_ENVIRONMENT_UPLOAD_BYTES,
} from "./lib/environment-store.mjs";

const execFile = promisify(execFileCallback);

test("user upload persists selected-result provenance and the local GLB", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "environment-store-upload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "repo");
  const labRoot = path.join(root, "lab");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(labRoot, { recursive: true });

  const payload = minimalGlb();
  const store = createEnvironmentStore({ repoRoot, labRoot });
  const imported = await store.importUpload({
    candidate: {
      id: "sketchfab:underwater-room",
      provider: "sketchfab",
      sourceId: "underwater-room",
      title: "Underwater room",
      sourceUrl: "https://sketchfab.com/3d-models/underwater-room",
      license: { name: "CC BY 4.0" },
      provenance: { author: "Example Artist" },
    },
    filename: "underwater-room.glb",
    expectedBytes: payload.byteLength,
    body: payload,
    sourceMetadata: {
      selectedCandidateId: "sketchfab:underwater-room",
      selectionMode: "search-result",
    },
  });

  assert.equal(imported.provider, "sketchfab");
  assert.equal(imported.sourceUrl, "https://sketchfab.com/3d-models/underwater-room");
  assert.equal(imported.provenance.author, "Example Artist");
  assert.equal(imported.provenance.sourceMetadata.importMethod, "user-upload");
  assert.equal(imported.provenance.sourceMetadata.selectionMode, "search-result");
  assert.equal(imported.asset.sourceUpload.filename, "underwater-room.glb");
  assert.equal(imported.asset.sourceUpload.bytes, payload.byteLength);
  assert.equal(imported.asset.sourceUpload.sha256, createHash("sha256").update(payload).digest("hex"));
  assert.equal(imported.asset.sourceDownload, undefined);
  assert.equal(imported.performance.uploadBytes, payload.byteLength);
  assert.deepEqual(await readFile(store.assetPathFromUrl(imported.asset.localPath)), payload);
});

test("story mode uploads an asset, persists provenance, and enforces locking", async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "environment-store-story-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));

  const storyFolder = "sample-story";
  const labRoot = path.join(repoRoot, "tools", "environment-enhancement-lab");
  await mkdir(path.join(repoRoot, storyFolder), { recursive: true });

  const payload = minimalGlb();
  const store = createEnvironmentStore({ repoRoot, labRoot, storyFolder });
  const initial = await store.getState();
  assert.equal(initial.schemaVersion, ENVIRONMENT_STORE_SCHEMA_VERSION);
  assert.equal(initial.asset, null);
  assert.equal(initial.locked, false);

  const imported = await store.importUpload({
    candidate: {
      provider: "poly-haven",
      providerAssetId: "ArmChair_01",
      title: "Arm Chair 01",
      sourceUrl: "https://polyhaven.com/a/ArmChair_01",
      license: { id: "CC0-1.0", attributionRequired: false },
      provenance: { author: "Poly Haven" },
      transform: { position: [0, 0.25, 0], rotationY: 0, scale: 0.8 },
      rendering: { receiveShadow: false },
      metrics: { triangles: 5626 },
    },
    filename: "ArmChair_01.glb",
    expectedBytes: payload.byteLength,
    body: payload,
  });

  assert.equal(imported.schemaVersion, ENVIRONMENT_STORE_SCHEMA_VERSION);
  assert.equal(imported.candidate.title, "Arm Chair 01");
  assert.deepEqual(imported.license, { id: "CC0-1.0", attributionRequired: false });
  assert.equal(imported.provenance.provider, "poly-haven");
  assert.equal(imported.provenance.providerAssetId, "ArmChair_01");
  assert.equal(imported.provenance.author, "Poly Haven");
  assert.equal(imported.asset.localPath, "/environment-assets/poly-haven-armchair-01/ArmChair_01.glb");
  assert.equal(imported.asset.entryPath, "poly-haven-armchair-01/ArmChair_01.glb");
  assert.equal(imported.asset.sourceUpload.filename, "ArmChair_01.glb");
  assert.equal(imported.asset.sha256, createHash("sha256").update(payload).digest("hex"));
  assert.equal(imported.transform.position[0], 0);
  assert.equal(imported.transform.position[1], 0.25);
  assert.equal(imported.transform.scale, 0.8);
  assert.equal(imported.rendering.castShadow, false);
  assert.equal(imported.rendering.receiveShadow, false);
  assert.equal(imported.performance.triangles, 5626);
  assert.equal(imported.performance.uploadBytes, payload.byteLength);

  const expectedAssetPath = path.join(
    repoRoot,
    storyFolder,
    "webxr-adaptation",
    "public",
    "environment-lab",
    "poly-haven-armchair-01",
    "ArmChair_01.glb",
  );
  assert.deepEqual(await readFile(expectedAssetPath), payload);
  assert.equal(store.assetPathFromUrl(imported.asset.localPath), expectedAssetPath);
  assert.equal(store.assetPathFromUrl("/environment-assets/poly-haven-armchair-01/%2e%2e/secret"), null);
  assert.equal(store.assetPathFromUrl("/other/ArmChair_01.glb"), null);

  const edited = await store.updateDraft({
    transform: { position: [1.5, 0.25, 0] },
    rendering: { castShadow: true },
  });
  assert.deepEqual(edited.transform.position, [1.5, 0.25, 0]);
  assert.equal(edited.rendering.castShadow, true);

  const locked = await store.lockSelection();
  assert.equal(locked.locked, true);
  assert.match(locked.lockedAt, /^\d{4}-\d{2}-\d{2}T/);
  await assert.rejects(
    store.updateDraft({ transform: { scale: 2 } }),
    /Unlock the environment selection/,
  );

  const unlocked = await store.unlockSelection();
  assert.equal(unlocked.locked, false);
  const reedited = await store.updateDraft({ transform: { scale: 1.1 } });
  assert.equal(reedited.transform.scale, 1.1);

  const manifestPath = path.join(
    repoRoot,
    storyFolder,
    "analysis",
    "storyvr",
    "environment-enhancement-lab.json",
  );
  const persisted = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(persisted.schemaVersion, ENVIRONMENT_STORE_SCHEMA_VERSION);
  assert.equal(persisted.transform.scale, 1.1);
  assert.equal(persisted.asset.localPath, imported.asset.localPath);
});

test("standalone mode safely uploads a ZIP and preserves glTF dependencies", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "environment-store-standalone-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const repoRoot = path.join(root, "repo");
  const labRoot = path.join(root, "lab");
  const packageRoot = path.join(root, "zip-source", "room-package");
  await mkdir(path.join(packageRoot, "models", "textures"), { recursive: true });
  await mkdir(repoRoot, { recursive: true });
  await mkdir(labRoot, { recursive: true });

  await writeFile(path.join(packageRoot, "models", "room.gltf"), JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: "room.bin", byteLength: 4 }],
    images: [{ uri: "textures/albedo.jpg" }],
  }));
  await writeFile(path.join(packageRoot, "models", "room.bin"), Buffer.from([1, 2, 3, 4]));
  await writeFile(path.join(packageRoot, "models", "textures", "albedo.jpg"), Buffer.from("image"));
  await writeFile(path.join(packageRoot, "fallback.hdr"), Buffer.from("hdr"));

  const archivePath = path.join(root, "room.zip");
  await execFile("/usr/bin/zip", ["-q", "-r", archivePath, "room-package"], {
    cwd: path.join(root, "zip-source"),
  });
  const archive = await readFile(archivePath);

  const store = createEnvironmentStore({ repoRoot, labRoot });
  const imported = await store.importUpload({
    candidate: {
      provider: "curated",
      id: "living-room",
      title: "Living room",
      license: "CC0-1.0",
    },
    filename: "room.zip",
    expectedBytes: archive.byteLength,
    body: archive,
  });

  assert.equal(imported.asset.format, "gltf");
  assert.equal(imported.asset.entryPath, "curated-living-room/room-package/models/room.gltf");
  assert.equal(imported.performance.fileCount, 4);
  assert.equal(imported.performance.dependencyCount, 3);

  const mainPath = store.assetPathFromUrl(imported.asset.localPath);
  assert.equal(
    mainPath,
    path.join(labRoot, ".lab-data", "environment-lab", "curated-living-room", "room-package", "models", "room.gltf"),
  );
  assert.equal(JSON.parse(await readFile(mainPath, "utf8")).asset.version, "2.0");
  assert.deepEqual(await readFile(path.join(path.dirname(mainPath), "room.bin")), Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(
    await readFile(path.join(path.dirname(mainPath), "textures", "albedo.jpg")),
    Buffer.from("image"),
  );

  const manifest = JSON.parse(await readFile(
    path.join(labRoot, ".lab-data", "environment-enhancement-lab.json"),
    "utf8",
  ));
  assert.equal(manifest.schemaVersion, ENVIRONMENT_STORE_SCHEMA_VERSION);
  assert.equal(manifest.asset.sha256, createHash("sha256").update(await readFile(mainPath)).digest("hex"));
});

test("ZIP uploads reject traversal paths and symbolic links before extraction", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "environment-store-unsafe-zip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "repo");
  const labRoot = path.join(root, "lab");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(labRoot, { recursive: true });
  const store = createEnvironmentStore({ repoRoot, labRoot });

  const traversalRoot = path.join(root, "traversal");
  await mkdir(path.join(traversalRoot, "child"), { recursive: true });
  await writeFile(path.join(traversalRoot, "escape.glb"), "escape");
  const traversalZip = path.join(root, "traversal.zip");
  await execFile("/usr/bin/zip", ["-q", traversalZip, "../escape.glb"], {
    cwd: path.join(traversalRoot, "child"),
  });
  const traversalPayload = await readFile(traversalZip);

  await assert.rejects(
    store.importUpload({
      candidate: { provider: "manual-upload", id: "traversal", license: "CC0-1.0" },
      filename: "traversal.zip",
      expectedBytes: traversalPayload.byteLength,
      body: traversalPayload,
    }),
    /Unsafe path/,
  );
  await assert.rejects(readFile(path.join(root, "escape.glb.imported")), /ENOENT/);

  const symlinkRoot = path.join(root, "symlink-source");
  await mkdir(symlinkRoot, { recursive: true });
  await writeFile(path.join(symlinkRoot, "target.glb"), "target");
  await symlink("target.glb", path.join(symlinkRoot, "linked.glb"));
  const symlinkZip = path.join(root, "symlink.zip");
  await execFile("/usr/bin/zip", ["-q", "-y", "-r", symlinkZip, "."], { cwd: symlinkRoot });
  const symlinkPayload = await readFile(symlinkZip);

  await assert.rejects(
    store.importUpload({
      candidate: { provider: "manual-upload", id: "symlink", license: "CC0-1.0" },
      filename: "symlink.zip",
      expectedBytes: symlinkPayload.byteLength,
      body: symlinkPayload,
    }),
    /symbolic link/,
  );
});

test("main asset validation rejects malformed GLB, unsafe glTF URIs, HDR, and EXR", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "environment-store-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "repo");
  const labRoot = path.join(root, "lab");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(labRoot, { recursive: true });
  const store = createEnvironmentStore({ repoRoot, labRoot });

  const cases = [
    {
      id: "bad-glb",
      filename: "bad.glb",
      payload: Buffer.from("not a glb"),
      message: /invalid magic header/,
    },
    {
      id: "remote-gltf",
      filename: "remote.gltf",
      payload: Buffer.from(JSON.stringify({
        asset: { version: "2.0" },
        buffers: [{ uri: "https://remote.example.test/scene.bin", byteLength: 1 }],
      })),
      message: /unsafe dependency URI/,
    },
    {
      id: "bad-hdr",
      filename: "bad.hdr",
      payload: Buffer.from("not radiance"),
      message: /Radiance\/RGBE header/,
    },
    {
      id: "bad-exr",
      filename: "bad.exr",
      payload: Buffer.from([0, 1, 2, 3]),
      message: /invalid magic number/,
    },
  ];

  for (const fixture of cases) {
    await assert.rejects(
      store.importUpload({
        candidate: { provider: "test", id: fixture.id, license: "CC0-1.0" },
        filename: fixture.filename,
        expectedBytes: fixture.payload.byteLength,
        body: fixture.payload,
      }),
      fixture.message,
    );
  }

  assert.equal((await store.getState()).asset, null);
});

test("upload limits and unsafe filenames are rejected before writing assets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "environment-store-limits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "repo");
  const labRoot = path.join(root, "lab");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(labRoot, { recursive: true });
  const store = createEnvironmentStore({ repoRoot, labRoot });
  await assert.rejects(
    store.importUpload({
      candidate: { provider: "manual-upload", id: "too-large-upload" },
      filename: "large.glb",
      expectedBytes: MAX_ENVIRONMENT_UPLOAD_BYTES + 1,
      body: minimalGlb(),
    }),
    /upload exceeds/,
  );

  await assert.rejects(
    store.importUpload({
      candidate: { provider: "manual-upload", id: "bad-upload-name" },
      filename: "../model.glb",
      body: minimalGlb(),
    }),
    /upload\.filename must be a safe base filename/,
  );
});

function minimalGlb() {
  const source = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{}], scene: 0 }), "utf8");
  const paddedLength = Math.ceil(source.byteLength / 4) * 4;
  const json = Buffer.alloc(paddedLength, 0x20);
  source.copy(json);
  const totalLength = 12 + 8 + json.byteLength;
  const glb = Buffer.alloc(totalLength);
  glb.write("glTF", 0, 4, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(json.byteLength, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  return glb;
}
