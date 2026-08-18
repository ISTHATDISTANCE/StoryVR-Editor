#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import spawn from "cross-spawn";
import sharp from "sharp";
import {
  loadAuthorProject,
  resolveAuthorPaths,
  saveAttentionGuidanceDecisionDraft,
  saveCheckpointDecision,
  saveNoEnvironmentEnhancementCheckpoint,
} from "./storyvr-author/engine.mjs";
import {
  directoryLinkType,
  readerRunCommands,
} from "./storyvr-author/platform-commands.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const temporaryParent = path.dirname(repositoryRoot) || os.tmpdir();
const temporaryRoot = await mkdtemp(path.join(temporaryParent, ".storyvr-native-runtime-"));

try {
  await verifyDirectoryLink();
  await verifySharpPngResize();
  verifyReaderCommands();
  verifyPythonLauncher();
  if (process.platform === "win32") await verifyWindowsCommandShim();
  await verifyStoryBuildPipeline();
  console.log(`StoryVR native runtime verified on ${process.platform}/${process.arch}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function verifyDirectoryLink() {
  const source = path.join(temporaryRoot, "dependency-source");
  const destination = path.join(temporaryRoot, "dependency-link");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "marker.txt"), "storyvr-native-link\n", "utf8");
  await symlink(source, destination, directoryLinkType());
  assert.equal(await readFile(path.join(destination, "marker.txt"), "utf8"), "storyvr-native-link\n");
  assert.equal(directoryLinkType(), process.platform === "win32" ? "junction" : "dir");
}

async function verifySharpPngResize() {
  const source = path.join(temporaryRoot, "source.png");
  const destination = path.join(temporaryRoot, "resized.png");
  await sharp({
    create: {
      width: 13,
      height: 7,
      channels: 4,
      background: { r: 20, g: 90, b: 160, alpha: 1 },
    },
  }).png().toFile(source);
  await sharp(source, { failOn: "error" })
    .resize({ width: 64, height: 32, fit: "fill" })
    .png()
    .toFile(destination);
  const metadata = await sharp(destination).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 32);
}

function verifyReaderCommands() {
  const windows = process.platform === "win32";
  const workspaceRoot = windows ? "C:\\StoryVR" : "/tmp/StoryVR";
  const editorRoot = path.join(workspaceRoot, "StoryVR-Editor");
  const storyRoot = path.join(workspaceRoot, "study-story");
  const readerSource = path.join(storyRoot, "webxr-adaptation");
  const commands = readerRunCommands({
    repositoryRoot: editorRoot,
    readerDistBuildScript: path.join(editorRoot, "tools", "storyvr-author", "build-reader-dist.mjs"),
    readerSource,
    distFolder: path.join(storyRoot, "dist-webxr-adaptation"),
    buildBase: "/study-story/dist-webxr-adaptation/",
    hostingRoot: workspaceRoot,
    distPath: "study-story/dist-webxr-adaptation",
    viteRoot: readerSource,
  });
  for (const key of ["devCommand", "buildCommand", "serveCommand", "headsetCommand"]) {
    assert.equal(typeof commands[key], "string");
    assert.ok(commands[key].length > 0);
  }
  if (windows) {
    assert.match(commands.devCommand, /^Set-Location -LiteralPath /);
    assert.match(commands.devCommand, /\bnpx\.cmd vite\b/);
    assert.match(commands.serveCommand, /run-python\.mjs/);
    assert.doesNotMatch(commands.headsetCommand, /\bpython3\b|^cd\s/);
  } else {
    assert.match(commands.devCommand, /^cd /);
    assert.match(commands.devCommand, /\bnpx vite\b/);
    assert.match(commands.serveCommand, /run-python\.mjs/);
  }
}

function verifyPythonLauncher() {
  const result = spawn.sync(process.execPath, [path.join(repositoryRoot, "tools", "run-python.mjs"), "--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`.trim());
  assert.match(`${result.stdout || ""}${result.stderr || ""}`, /Python\s+3\./i);
}

async function verifyWindowsCommandShim() {
  const shim = path.join(temporaryRoot, "storyvr-command-smoke.cmd");
  await writeFile(shim, "@echo off\r\necho storyvr-cmd-ok\r\n", "utf8");
  const result = spawn.sync(shim, [], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`.trim());
  assert.match(result.stdout || "", /storyvr-cmd-ok/i);
}

async function verifyStoryBuildPipeline() {
  const storyFolder = path.join(temporaryRoot, "native-build-story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const unavailableCodex = path.join(temporaryRoot, "codex-unavailable");
  await mkdir(metadataRoot, { recursive: true });
  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), `${JSON.stringify({
    story_url: "https://example.test/native-build-story",
    title: "Native build story",
    text_only_parts: [
      { id: "opening", text: "The reader enters the opening scene." },
      { id: "ending", text: "The reader reaches the ending scene." },
    ],
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), "[]\n", "utf8");

  const options = { storyFolder, resourceFolder, codexBin: unavailableCodex };
  const initial = await loadAuthorProject(options);
  await saveCheckpointDecision(options, "spatial-relations", {
    optionId: initial.proposals["spatial-relations"].defaultOptionId,
    spatialRelations: initial.spatialRelations,
    authorEdits: "Keep the inferred scene layout.",
  });
  await saveNoEnvironmentEnhancementCheckpoint(options);
  await saveCheckpointDecision(options, "dynamic-geometry", {
    authorEdits: "Keep the inferred object movement.",
  });
  await saveCheckpointDecision(options, "inter-beat-dynamics", {
    authorEdits: "Keep the inferred scene changes.",
  });
  const attentionState = await loadAuthorProject(options);
  await saveAttentionGuidanceDecisionDraft(options, {
    attentionGuidance: attentionState.attentionGuidance,
  });
  await saveCheckpointDecision(options, "attention-guidance");
  const interactionState = await loadAuthorProject(options);
  await saveCheckpointDecision(options, "interaction-control", {
    authorEdits: "Keep the default reader actions.",
    controllerConfiguration: interactionState.interactionControlDraft.controllerConfiguration,
  });
  await saveCheckpointDecision(options, "transition-pacing", {
    finalTuningPrompt: "Keep the reviewed story.",
  });

  const port = await availablePort();
  const serverPath = path.join(repositoryRoot, "tools", "storyvr-author", "server.mjs");
  const processState = spawn(process.execPath, [
    serverPath,
    "--story-folder", storyFolder,
    "--host", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, CODEX_BIN: unavailableCodex, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  processState.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  processState.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForAuthorServer(processState, () => ({ stdout, stderr }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const startResponse = await fetch(`${baseUrl}/api/story-build`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const started = await startResponse.json();
    assert.equal(startResponse.status, 202, JSON.stringify(started));
    assert.equal(started.status, "running");
    const finished = await waitForStoryBuild(baseUrl, started.jobId);
    assert.equal(finished.status, "built", JSON.stringify(finished));
    assert.equal(finished.result?.readerBuild?.status, "built");
    assert.equal(finished.result?.stale, false);
    const paths = resolveAuthorPaths(options);
    await access(paths.compiledRuntimePath);
    await access(path.join(storyFolder, "webxr-adaptation", "index.html"));
    await access(path.join(storyFolder, "dist-webxr-adaptation", "index.html"));
    if (process.platform === "win32") {
      assert.match(finished.result.readerRun.headsetCommand, /^Set-Location -LiteralPath /);
      assert.doesNotMatch(finished.result.readerRun.headsetCommand, /\bpython3\b|^cd\s/);
    }
  } finally {
    if (processState.exitCode === null) processState.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => processState.once("close", resolve)),
      delay(2_000),
    ]);
  }
}

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return address.port;
}

function waitForAuthorServer(child, readLogs, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(
      `StoryVR author server did not become ready.\n${readLogs().stdout}\n${readLogs().stderr}`,
    )), timeoutMs);
    const check = () => {
      if (readLogs().stdout.includes("StoryVR authoring UI:")) finish();
    };
    const onClose = (code) => finish(new Error(
      `StoryVR author server exited ${code} before ready.\n${readLogs().stdout}\n${readLogs().stderr}`,
    ));
    const finish = (error) => {
      clearTimeout(timer);
      child.stdout.off("data", check);
      child.off("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    child.stdout.on("data", check);
    child.once("close", onClose);
    check();
  });
}

async function waitForStoryBuild(baseUrl, jobId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/story-build/${encodeURIComponent(jobId)}`);
    const job = await response.json();
    assert.equal(response.status, 200, JSON.stringify(job));
    if (job.status !== "running") return job;
    await delay(75);
  }
  throw new Error(`StoryVR native build ${jobId} did not finish within ${timeoutMs}ms.`);
}
