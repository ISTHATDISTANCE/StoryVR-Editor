import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createEnvironmentStore,
  MAX_ENVIRONMENT_UPLOAD_BYTES,
} from "./lib/environment-store.mjs";
import { createEnvironmentEnhancementLab } from "./server.mjs";

function manifest(overrides = {}) {
  return {
    schemaVersion: "storyvr-environment-enhancement-lab/v1",
    locked: false,
    candidate: {
      id: "polyhaven:test-room",
      provider: "polyhaven",
      sourceId: "test_room",
      title: "Test Room",
      license: { name: "CC0 1.0" },
    },
    asset: {
      entryPath: "polyhaven-test-room/test_room.glb",
      format: "glb",
      sha256: "abc123",
    },
    transform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
    rendering: { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
    ...overrides,
  };
}

test("server exposes the lab shell and preserves the draft API contract", async () => {
  let state = manifest();
  let receivedDraft = null;
  const store = {
    async getState() {
      return state;
    },
    async updateDraft(update) {
      if (state.locked) throw new Error("Unlock the environment selection before attempting to edit the environment draft.");
      receivedDraft = update;
      state = { ...state, transform: { ...state.transform, ...update.transform }, rendering: { ...state.rendering, ...update.rendering } };
      return state;
    },
    async lockSelection() {
      state = { ...state, locked: true, lockedAt: "2026-07-12T00:00:00.000Z" };
      return state;
    },
    async unlockSelection() {
      state = { ...state, locked: false, lockedAt: null };
      return state;
    },
    assetPathFromUrl() {
      return null;
    },
  };

  const lab = createEnvironmentEnhancementLab({ port: 0, store });
  const address = await lab.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const shell = await fetch(`${baseUrl}/`);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get("content-type"), /^text\/html/);
    assert.match(shell.headers.get("permissions-policy"), /xr-spatial-tracking/);
    assert.match(await shell.text(), /Environment Enhancement/);

    const three = await fetch(`${baseUrl}/vendor/three.module.js`, { method: "HEAD" });
    assert.equal(three.status, 200);
    assert.match(three.headers.get("content-type"), /^text\/javascript/);

    const threeCore = await fetch(`${baseUrl}/vendor/three.core.js`, { method: "HEAD" });
    assert.equal(threeCore.status, 200);
    assert.match(threeCore.headers.get("content-type"), /^text\/javascript/);

    const initial = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert.equal(initial.selection.title, "Test Room");
    assert.equal(initial.selection.asset.mediaType, "model/gltf-binary");
    assert.equal(initial.selection.asset.localUrl, "/environment-assets/polyhaven-test-room/test_room.glb");

    const draftResponse = await fetch(`${baseUrl}/api/draft`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transform: { position: [1, 1.5, -2], rotationY: 0.75, scale: 1.25 },
        rendering: { exposure: 0.8, fogDensity: 0.01 },
      }),
    });
    assert.equal(draftResponse.status, 200);
    assert.deepEqual(receivedDraft, {
      transform: { position: [1, 1.5, -2], rotationY: 0.75, scale: 1.25 },
      rendering: { exposure: 0.8, fogDensity: 0.01 },
    });
    const draft = await draftResponse.json();
    assert.deepEqual(draft.selection.transform, { position: [1, 1.5, -2], rotationY: 0.75, scale: 1.25 });

    const locked = await fetch(`${baseUrl}/api/lock`, { method: "POST", body: "{}" });
    assert.equal(locked.status, 200);
    assert.equal((await locked.json()).locked, true);
    const lockedEdit = await fetch(`${baseUrl}/api/draft`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transform: { scale: 2 } }),
    });
    assert.equal(lockedEdit.status, 409);
    assert.match((await lockedEdit.json()).error, /Unlock the environment selection/);
    const unlocked = await fetch(`${baseUrl}/api/unlock`, { method: "POST", body: "{}" });
    assert.equal(unlocked.status, 200);
    assert.equal((await unlocked.json()).locked, false);

    const missingAsset = await fetch(`${baseUrl}/environment-assets/not/allowed.glb`);
    assert.equal(missingAsset.status, 404);
  } finally {
    await lab.close();
  }
});

test("raw upload preserves a selected search result and serves the local asset", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "environment-server-upload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "repo");
  const labRoot = path.join(root, "lab");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(labRoot, { recursive: true });

  const candidate = {
    id: "sketchfab:reef-room",
    provider: "sketchfab",
    sourceId: "reef-room",
    title: "Reef room",
    sourceUrl: "https://sketchfab.com/3d-models/reef-room",
    license: { name: "CC BY 4.0" },
    provenance: { author: "Example Artist" },
  };
  const store = createEnvironmentStore({ repoRoot, labRoot });
  const lab = createEnvironmentEnhancementLab({
    port: 0,
    store,
    searchEnvironmentCandidates: async () => ({
      candidates: [candidate],
      providerStatus: { sketchfab: { status: "ok", count: 1 } },
    }),
  });
  const address = await lab.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const search = await fetch(`${baseUrl}/api/search?q=underwater`).then((response) => response.json());
    assert.equal(search.candidates[0].sourceUrl, candidate.sourceUrl);

    const payload = minimalGlb();
    const uploadUrl = new URL("/api/upload", baseUrl);
    uploadUrl.searchParams.set("filename", "reef-room.glb");
    uploadUrl.searchParams.set("candidateId", candidate.id);
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { "content-type": "model/gltf-binary" },
      body: payload,
    });
    assert.equal(uploadResponse.status, 200);
    const uploaded = await uploadResponse.json();
    assert.equal(uploaded.selection.candidate.id, candidate.id);
    assert.equal(uploaded.selection.sourceUrl, candidate.sourceUrl);
    assert.equal(uploaded.selection.provenance.author, "Example Artist");
    assert.equal(uploaded.selection.provenance.sourceMetadata.selectionMode, "search-result");
    assert.equal(uploaded.selection.asset.sourceUpload.filename, "reef-room.glb");
    assert.equal(uploaded.selection.asset.sourceUpload.bytes, payload.byteLength);
    assert.equal(uploaded.selection.asset.mediaType, "model/gltf-binary");

    const localAssetResponse = await fetch(`${baseUrl}${uploaded.selection.asset.localUrl}`);
    assert.equal(localAssetResponse.status, 200);
    assert.deepEqual(Buffer.from(await localAssetResponse.arrayBuffer()), payload);

    const persisted = await store.getState();
    assert.equal(persisted.candidate.id, candidate.id);
    assert.deepEqual(await readFile(store.assetPathFromUrl(persisted.asset.localPath)), payload);

    const manualUpload = await fetch(`${baseUrl}/api/upload?filename=manual-room.glb`, {
      method: "POST",
      headers: { "content-type": "model/gltf-binary" },
      body: payload,
    });
    assert.equal(manualUpload.status, 200);
    const manualState = await manualUpload.json();
    assert.equal(manualState.selection.provider, "manual-upload");
    assert.equal(manualState.selection.provenance.sourceMetadata.selectionMode, "manual-upload");
    assert.equal(manualState.selection.asset.sourceUpload.filename, "manual-room.glb");

    const unsafeName = await fetch(`${baseUrl}/api/upload?filename=..%2Fescape.glb`, {
      method: "POST",
      body: payload,
    });
    assert.equal(unsafeName.status, 400);
    assert.match((await unsafeName.json()).error, /safe base filename/);

    const oversized = await rawRequest(`${baseUrl}/api/upload?filename=large.glb`, {
      method: "POST",
      headers: {
        "content-length": String(MAX_ENVIRONMENT_UPLOAD_BYTES + 1),
        connection: "close",
      },
    });
    assert.equal(oversized.statusCode, 413);
    assert.match(JSON.parse(oversized.body).error, /upload exceeds/);
  } finally {
    await lab.close();
  }
});

function rawRequest(url, options) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

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
