import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createHistoryCheckpointStore } from "./history-store.mjs";

test("checkpoint restore recreates and removes authored JSON and environment assets exactly", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-history-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "sample-story");
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const proposalsRoot = path.join(analysisRoot, "proposals");
  const decisionsRoot = path.join(analysisRoot, "decisions");
  const assetRoot = path.join(storyFolder, "webxr-adaptation", "public", "environment-enhancement");
  const paths = {
    storyFolder,
    analysisRoot,
    proposalsRoot,
    decisionsRoot,
    storyGraphPath: path.join(analysisRoot, "story-graph.json"),
    sourceMotionOverridesPath: path.join(analysisRoot, "source-motion-overrides.json"),
    sourceMotionPlaybackPath: path.join(analysisRoot, "source-motion-playback.json"),
    proceduralDynamicsPath: path.join(analysisRoot, "procedural-dynamics.json"),
  };
  await Promise.all([mkdir(proposalsRoot, { recursive: true }), mkdir(decisionsRoot, { recursive: true }), mkdir(path.join(assetRoot, "asset-a"), { recursive: true })]);
  await writeJson(paths.storyGraphPath, { beats: ["before"] });
  await writeJson(path.join(proposalsRoot, "asset-topology.json"), { option: "before" });
  await writeJson(path.join(decisionsRoot, "asset-topology.json"), { status: "draft", savedAt: null });
  await writeJson(path.join(analysisRoot, "environment-enhancement.json"), { asset: "asset-a" });
  await writeJson(paths.proceduralDynamicsPath, { schemaVersion: "storyvr-procedural-dynamics/v1", revision: 1, plansByScene: { "beat:one": { seed: 1 } } });
  await writeFile(path.join(assetRoot, "asset-a", "room.hdr"), Buffer.from("environment-a"));

  const store = createHistoryCheckpointStore({ paths, environmentAssetRoot: assetRoot });
  t.after(() => store.dispose());
  const session = await store.createSession();

  await writeJson(paths.storyGraphPath, { beats: ["after"] });
  await writeJson(paths.sourceMotionOverridesPath, { assignments: { track: ["after"] } });
  await writeJson(paths.proceduralDynamicsPath, { schemaVersion: "storyvr-procedural-dynamics/v1", revision: 2, plansByScene: { "beat:one": { seed: 2 } } });
  await rm(path.join(proposalsRoot, "asset-topology.json"));
  await writeJson(path.join(decisionsRoot, "asset-topology.json"), { status: "current", savedAt: "2026-07-15T00:00:00.000Z" });
  await writeJson(path.join(decisionsRoot, "interaction-control.json"), { status: "current", savedAt: "2026-07-15T00:00:00.000Z" });
  await writeJson(path.join(analysisRoot, "environment-enhancement.json"), { asset: "asset-b" });
  await rm(assetRoot, { recursive: true, force: true });
  await mkdir(path.join(assetRoot, "asset-b"), { recursive: true });
  await writeFile(path.join(assetRoot, "asset-b", "room.exr"), Buffer.from("environment-b"));
  const after = await store.captureCheckpoint(session.sessionId);

  await store.restoreCheckpoint(session.sessionId, session.checkpointId);
  assert.deepEqual(await readJson(paths.storyGraphPath), { beats: ["before"] });
  assert.deepEqual(await readJson(path.join(proposalsRoot, "asset-topology.json")), { option: "before" });
  assert.deepEqual(await readJson(path.join(decisionsRoot, "asset-topology.json")), { status: "draft", savedAt: null });
  await assert.rejects(access(paths.sourceMotionOverridesPath), { code: "ENOENT" });
  assert.equal((await readJson(paths.proceduralDynamicsPath)).revision, 1);
  await assert.rejects(access(path.join(decisionsRoot, "interaction-control.json")), { code: "ENOENT" });
  assert.equal((await readFile(path.join(assetRoot, "asset-a", "room.hdr"))).toString(), "environment-a");
  await assert.rejects(access(path.join(assetRoot, "asset-b", "room.exr")), { code: "ENOENT" });

  await store.restoreCheckpoint(session.sessionId, after.checkpointId);
  assert.deepEqual(await readJson(paths.storyGraphPath), { beats: ["after"] });
  assert.deepEqual(await readJson(paths.sourceMotionOverridesPath), { assignments: { track: ["after"] } });
  assert.equal((await readJson(paths.proceduralDynamicsPath)).revision, 2);
  await assert.rejects(access(path.join(proposalsRoot, "asset-topology.json")), { code: "ENOENT" });
  assert.deepEqual(await readJson(path.join(decisionsRoot, "interaction-control.json")), { status: "current", savedAt: "2026-07-15T00:00:00.000Z" });
  assert.equal((await readFile(path.join(assetRoot, "asset-b", "room.exr"))).toString(), "environment-b");
});

test("identical captures are deduplicated and deleted sessions reject later access", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-history-dedupe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyFolder = path.join(root, "story");
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const paths = {
    storyFolder,
    analysisRoot,
    proposalsRoot: path.join(analysisRoot, "proposals"),
    decisionsRoot: path.join(analysisRoot, "decisions"),
    storyGraphPath: path.join(analysisRoot, "story-graph.json"),
    sourceMotionOverridesPath: path.join(analysisRoot, "source-motion-overrides.json"),
    sourceMotionPlaybackPath: path.join(analysisRoot, "source-motion-playback.json"),
    proceduralDynamicsPath: path.join(analysisRoot, "procedural-dynamics.json"),
  };
  await mkdir(analysisRoot, { recursive: true });
  await writeJson(paths.storyGraphPath, { beats: [] });
  const store = createHistoryCheckpointStore({ paths });
  t.after(() => store.dispose());
  const session = await store.createSession();
  const duplicate = await store.captureCheckpoint(session.sessionId);
  assert.equal(duplicate.checkpointId, session.checkpointId);
  await store.deleteSession(session.sessionId);
  await assert.rejects(store.captureCheckpoint(session.sessionId), /session was not found/i);
});

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
