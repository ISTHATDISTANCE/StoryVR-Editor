#!/usr/bin/env node

import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import spawn from "cross-spawn";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { createServer as createViteServer } from "vite";
import { hostingRootForPath } from "../storyvr-adapter/storyvr-adapter.mjs";
import {
  applyProceduralDynamicsPlan,
  applyAnimationProbeLinks,
  buildReaderDist,
  compileAuthorRuntime,
  generateComponentProposals,
  generateProceduralDynamicsPlan,
  generateStoryCanvasSegments,
  generateStoryCanvasSegmentsWithCodex,
  loadAuthorProject,
  regenerateStoryGraph,
  removeProceduralDynamicsPlan,
  resolveAuthorPaths,
  saveCheckpointDecision,
  saveCheckpointDecisionDraft,
  saveEnvironmentEnhancementCheckpoint,
  saveEnvironmentEnhancementDecisionDraft,
  saveNoEnvironmentEnhancementCheckpoint,
  saveAttentionGuidanceDecisionDraft,
  saveSpatialRelationsDecisionDraft,
  saveStoryGraph,
  saveSourceMotionLinks,
} from "./engine.mjs";
import {
  decodeEnvironmentGenerationReferenceImages,
  generateEnvironmentImageWithCodex,
  generateMatchingGroundTextureWithCodex,
  sanitizeEnvironmentGenerationPrompt,
} from "./environment/generator.mjs";
import {
  createEnvironmentStore,
  DEFAULT_ENVIRONMENT_MOVEMENT_CUE,
  normalizeEnvironmentMovementCue,
} from "./environment/store.mjs";
import {
  createHistoryCheckpointStore,
  createStoryBuildInputSignatureReader,
} from "./history-store.mjs";
import {
  directoryLinkType,
  readerRunCommands,
} from "./platform-commands.mjs";

const args = parseArgs({
  allowPositionals: false,
  options: {
    "resource-folder": { type: "string" },
    "story-folder": { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "5188" },
  },
});

const options = {
  resourceFolder: args.values["resource-folder"],
  storyFolder: args.values["story-folder"],
};

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const READER_DIST_BUILD_SCRIPT = path.join(REPO_ROOT, "tools", "storyvr-author", "build-reader-dist.mjs");
const environmentPaths = resolveAuthorPaths(options);
const environmentRepoRoot = hostingRootForPath(environmentPaths.storyFolder, REPO_ROOT);
const environmentStore = createEnvironmentStore({
  repoRoot: environmentRepoRoot,
  storyFolder: environmentPaths.storyFolder,
});
const historyStore = createHistoryCheckpointStore({
  paths: environmentPaths,
  environmentAssetRoot: environmentStore.paths.assetRoot,
});
const readStoryBuildInputSignature = createStoryBuildInputSignatureReader({
  paths: environmentPaths,
  environmentAssetRoot: environmentStore.paths.assetRoot,
  repositoryRoot: REPO_ROOT,
});
const pendingEnvironmentGenerations = new Map();
const PENDING_ENVIRONMENT_GENERATION_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_ENVIRONMENT_GENERATIONS = 4;
const historySweepTimer = setInterval(() => {
  historyStore.sweepExpiredSessions().catch(() => {});
  sweepPendingEnvironmentGenerations();
  sweepStoryBuildJobs();
}, 15 * 60 * 1000);
historySweepTimer.unref();
let environmentGenerationBusy = false;
const MAX_ENVIRONMENT_JSON_BYTES = 64 * 1024;
const MAX_ENVIRONMENT_GENERATION_JSON_BYTES = 32 * 1024 * 1024;
const MAX_DYNAMICS_JSON_BYTES = 512 * 1024;
const MAX_STORY_CANVAS_SEGMENTS_JSON_BYTES = 16 * 1024;
const MAX_JSON_BODY_BYTES = 32 * 1024 * 1024;
const REQUEST_BODY_TIMEOUT_MS = requestBodyTimeoutFromEnvironment(
  process.env.STORYVR_REQUEST_BODY_TIMEOUT_MS,
);

if (!options.resourceFolder && !options.storyFolder) {
  console.error("Usage: npm run storyvr:author -- --resource-folder <story-slug>/captures/active");
  console.error("Alternative: npm run storyvr:author -- --story-folder <story-slug>");
  process.exit(1);
}

const host = args.values.host;
const port = Number(args.values.port);
const appRoot = path.join(import.meta.dirname, "app");
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_STATUS_TTL_MS = 30_000;

let cachedCodexVersion = null;
let cachedCodexStatus = null;
let cachedCodexStatusExpiresAt = 0;
let codexStatusInFlight = null;
let loginProcess = null;
let loginState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  loginUrl: null,
  loginCode: null,
  output: [],
};
const loginClients = new Set();
let spatialDecisionMutation = Promise.resolve();
let authorMutation = Promise.resolve();
const STORY_BUILD_JOB_TTL_MS = 30 * 60 * 1000;
const MAX_STORY_BUILD_JOBS = 12;
const storyBuildJobs = new Map();
let activeStoryBuildJobId = null;

let vite;
const server = http.createServer(async (req, res) => {
  if (
    ["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase())
    && req.url?.split("?", 1)[0] === "/favicon.ico"
  ) {
    res.statusCode = 204;
    res.setHeader("cache-control", "public, max-age=86400");
    res.end();
    return;
  }
  if (req.url?.startsWith("/api/")) {
    if (serializedAuthorRequest(req)) await serializeAuthorMutation(() => handleApi(req, res));
    else await handleApi(req, res);
    return;
  }
  if (req.url?.startsWith("/environment-assets/")) {
    await serveEnvironmentAsset(req, res);
    return;
  }
  vite.middlewares(req, res, (error) => {
    if (error) {
      vite.ssrFixStacktrace(error);
      writeJsonResponse(res, 500, { error: error.message });
    } else {
      writeJsonResponse(res, 404, { error: "Not found" });
    }
  });
});

vite = await createViteServer({
  root: appRoot,
  server: {
    middlewareMode: { server },
    hmr: { server },
  },
  appType: "spa",
});

server.on("close", () => {
  clearInterval(historySweepTimer);
  pendingEnvironmentGenerations.clear();
  historyStore.dispose().catch(() => {});
});

await startAuthorServer();

async function startAuthorServer() {
  try {
    const state = await loadAuthorProject(authorOptions());
    await listenHttpServer(server, port, host);
    const address = server.address();
    const listeningPort = address && typeof address === "object" ? address.port : port;
    console.log(`StoryVR authoring UI: http://${host}:${listeningPort}/`);
    console.log(`Story: ${state.project.story.title || state.project.story.slug}`);
    console.log(`Resource folder: ${state.paths.resourceFolder}`);
    console.log(`Project state: ${state.paths.projectPath}`);
  } catch (error) {
    clearInterval(historySweepTimer);
    pendingEnvironmentGenerations.clear();
    await Promise.allSettled([
      historyStore.dispose(),
      vite.close(),
    ]);
    console.error(`StoryVR authoring server failed to start: ${error.message}`);
    for (const diagnostic of Array.isArray(error.diagnostics) ? error.diagnostics : []) {
      if (diagnostic?.message) console.error(`- ${diagnostic.message}`);
    }
    process.exitCode = 1;
  }
}

function listenHttpServer(httpServer, requestedPort, requestedHost) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(requestedPort, requestedHost);
  });
}

async function handleApi(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const route = `${req.method} ${url.pathname}`;

    if (route === "POST /api/history/session") {
      writeJsonResponse(res, 201, await historyStore.createSession());
      return;
    }

    const historyCheckpointMatch = route.match(/^POST \/api\/history\/session\/([^/]+)\/checkpoint$/);
    if (historyCheckpointMatch) {
      writeJsonResponse(res, 201, await historyStore.captureCheckpoint(historyCheckpointMatch[1]));
      return;
    }

    const historyRestoreMatch = route.match(/^POST \/api\/history\/session\/([^/]+)\/restore$/);
    if (historyRestoreMatch) {
      const body = await readLimitedJsonBody(req, MAX_ENVIRONMENT_JSON_BYTES);
      const restored = await historyStore.restoreCheckpoint(historyRestoreMatch[1], body.checkpointId);
      writeJsonResponse(res, 200, restored);
      return;
    }

    const historyDeleteMatch = route.match(/^DELETE \/api\/history\/session\/([^/]+)$/);
    if (historyDeleteMatch) {
      await historyStore.deleteSession(historyDeleteMatch[1]);
      writeJsonResponse(res, 200, { deleted: true });
      return;
    }

    if (route === "GET /api/state") {
      const projectState = await loadAuthorProject(authorOptions());
      const { state: environmentState } = await environmentStore.reconcileBeatAssignments(
        (projectState.graph?.beats || []).map((beat) => beat.id),
      );
      const environmentEnhancement = decorateEnvironmentState(environmentState);
      writeJsonResponse(res, 200, { ...projectState, environmentEnhancement });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
      await serveStoryAsset(req, res, url);
      return;
    }

    if (route === "POST /api/environment-enhancement/generate") {
      const projectState = await assertEnvironmentEnhancementReady();
      const body = await readLimitedJsonBody(req, MAX_ENVIRONMENT_GENERATION_JSON_BYTES);
      const beatId = requireAuthoredEnvironmentBeat(projectState, body.beatId);
      const prompt = sanitizeEnvironmentGenerationPrompt(body.prompt);
      const referenceImages = decodeEnvironmentGenerationReferenceImages(body.referenceImages);
      sweepPendingEnvironmentGenerations();
      if (environmentGenerationBusy) {
        throw httpError(409, "A setting panorama and matching ground are already being prepared.");
      }

      environmentGenerationBusy = true;
      try {
        const codexStatus = await getCodexStatus({ force: true });
        if (!codexStatus.codexAvailable) {
          throw httpError(503, "Codex CLI is not available on this authoring server.");
        }
        if (!codexStatus.authenticated) {
          throw httpError(409, "Sign in to Codex CLI before generating a setting image.");
        }
        const baselineEnvironment = await environmentStore.getState();
        const generated = await generateEnvironmentImageWithCodex({
          prompt,
          referenceImages,
          codexBin: CODEX_BIN,
          codexVersion: codexStatus.version,
        });
        const ground = await generateMatchingGroundTextureWithCodex({
          prompt,
          referenceImage: generated.image,
          codexBin: CODEX_BIN,
          codexVersion: codexStatus.version,
        });
        const generationToken = stageEnvironmentGeneration({
          beatId,
          baselineRevision: baselineEnvironment.revision,
          baselineSignature: environmentStateSignature(baselineEnvironment),
          generated,
          ground,
        });
        writeJsonResponse(res, 202, {
          generationToken,
          beatId,
          generation: environmentGenerationMetadata(generated, ground),
        });
      } finally {
        environmentGenerationBusy = false;
      }
      return;
    }

    if (route === "POST /api/environment-enhancement/install-generated") {
      const body = await readLimitedJsonBody(req, MAX_ENVIRONMENT_JSON_BYTES);
      const generationToken = String(body.generationToken || "").trim();
      sweepPendingEnvironmentGenerations();
      const pending = pendingEnvironmentGenerations.get(generationToken);
      if (!pending) {
        throw httpError(404, "The generated setting is no longer available. Generate it again.");
      }
      pendingEnvironmentGenerations.delete(generationToken);

      const projectState = await assertEnvironmentEnhancementReady();
      const beatId = requireAuthoredEnvironmentBeat(projectState, pending.beatId);
      const currentEnvironment = await environmentStore.getState();
      if (
        currentEnvironment.revision !== pending.baselineRevision
        || environmentStateSignature(currentEnvironment) !== pending.baselineSignature
      ) {
        throw httpError(
          409,
          "The setting changed while the image was generating. Generate again from the current changes.",
        );
      }

      const { generated, ground } = pending;
      const candidate = createGeneratedEnvironmentCandidate(generated);
      const installed = await withAuthorArtifactRollback(async () => {
        const environmentState = await environmentStore.importGenerated({
          beatId,
          candidate,
          filename: generated.filename,
          body: generated.image,
          expectedBytes: generated.image.byteLength,
          sourceMetadata: {
            selectionMode: "codex-cli-generation",
            ...generated.metadata,
          },
          ground: {
            filename: ground.filename,
            body: ground.image,
            expectedBytes: ground.image.byteLength,
            metadata: {
              generationId: ground.generationId,
              prompt: ground.prompt,
              ...ground.metadata,
            },
          },
        });
        const decision = await saveEnvironmentEnhancementDecisionDraft(authorOptions(), environmentState);
        const refreshedProject = await loadAuthorProject(authorOptions());
        return {
          environmentEnhancement: await decorateEnvironmentStateFromDisk(environmentState),
          decision,
          decisions: refreshedProject.decisions,
          readiness: refreshedProject.readiness,
        };
      });
      writeJsonResponse(res, 200, {
        ...installed,
        generation: environmentGenerationMetadata(generated, ground),
      });
      return;
    }

    if (route === "PATCH /api/environment-enhancement/draft") {
      const projectState = await assertEnvironmentEnhancementReady();
      const body = await readLimitedJsonBody(req, MAX_ENVIRONMENT_JSON_BYTES);
      const beatId = requireAuthoredEnvironmentBeat(projectState, body.beatId);
      const environmentState = await environmentStore.updateDraft({
        beatId,
        skipped: body.skipped,
        ...normalizeEnvironmentDraft(body),
      });
      const decision = await saveEnvironmentEnhancementDecisionDraft(authorOptions(), environmentState);
      const environmentEnhancement = await decorateEnvironmentStateFromDisk(environmentState);
      writeJsonResponse(res, 200, { environmentEnhancement, decision });
      return;
    }

    if (route === "POST /api/environment-enhancement/apply") {
      const projectState = await assertEnvironmentEnhancementReady();
      const body = await readLimitedJsonBody(req, MAX_ENVIRONMENT_JSON_BYTES);
      const sourceBeatId = requireAuthoredEnvironmentBeat(projectState, body.sourceBeatId, "sourceBeatId");
      if (!Array.isArray(body.targetBeatIds)) {
        throw httpError(400, "Choose one or more target story parts.");
      }
      const targetBeatIds = [...new Set(body.targetBeatIds.map((beatId) => (
        requireAuthoredEnvironmentBeat(projectState, beatId, "targetBeatIds")
      )))];
      if (!targetBeatIds.length) {
        throw httpError(400, "Select at least one other story part.");
      }
      if (targetBeatIds.includes(sourceBeatId)) {
        throw httpError(400, "The source story part cannot also be a target.");
      }
      const expectedRevision = Number(body.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw httpError(400, "The saved setting version is invalid. Reload this step and try again.");
      }
      const environmentState = await environmentStore.applyAssignment({
        sourceBeatId,
        targetBeatIds,
        expectedRevision,
      });
      const decision = await saveEnvironmentEnhancementDecisionDraft(authorOptions(), environmentState);
      const environmentEnhancement = await decorateEnvironmentStateFromDisk(environmentState);
      writeJsonResponse(res, 200, { environmentEnhancement, decision });
      return;
    }

    if (route === "POST /api/environment-enhancement/save") {
      await assertEnvironmentEnhancementReady();
      await readLimitedJsonBody(req, MAX_ENVIRONMENT_JSON_BYTES);
      const current = await environmentStore.getState();
      const decision = await saveEnvironmentEnhancementCheckpoint(authorOptions(), current);
      const environmentEnhancement = await decorateEnvironmentStateFromDisk(current);
      writeJsonResponse(res, 200, { environmentEnhancement, decision });
      return;
    }

    if (route === "POST /api/environment-enhancement/save-none") {
      await assertEnvironmentEnhancementReady();
      const decision = await saveNoEnvironmentEnhancementCheckpoint(authorOptions());
      const environmentEnhancement = await decorateEnvironmentStateFromDisk(await environmentStore.getState());
      writeJsonResponse(res, 200, { environmentEnhancement, decision });
      return;
    }

    if (route === "GET /api/codex/status") {
      writeJsonResponse(res, 200, await getCodexStatus());
      return;
    }

    if (route === "POST /api/codex/login/start") {
      writeJsonResponse(res, 202, await startCodexLogin());
      return;
    }

    if (route === "GET /api/codex/login/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      loginClients.add(res);
      writeSse(res, "state", loginState);
      for (const entry of loginState.output) writeSse(res, "line", entry);
      req.on("close", () => loginClients.delete(res));
      return;
    }

    if (route === "POST /api/story-graph/regenerate") {
      writeJsonResponse(res, 200, await regenerateStoryGraph(authorOptions()));
      return;
    }

    if (route === "POST /api/story-graph/apply-animation-probe") {
      writeJsonResponse(res, 200, await applyAnimationProbeLinks(authorOptions(), await readJsonBody(req)));
      return;
    }

    if (route === "POST /api/story-graph") {
      const graph = await saveStoryGraph(authorOptions(), await readJsonBody(req));
      await environmentStore.reconcileBeatAssignments((graph.beats || []).map((beat) => beat.id));
      writeJsonResponse(res, 200, graph);
      return;
    }

    if (route === "POST /api/story-canvas-segments/generate") {
      assertSameOriginJsonRequest(req);
      const body = await readLimitedJsonBody(req, MAX_STORY_CANVAS_SEGMENTS_JSON_BYTES);
      if (body.force === true) {
        throw httpError(400, "Forced story progress regeneration is not available from this endpoint.");
      }
      const storyCanvasSegments = await generateStoryCanvasSegments({
        ...authorOptions(),
        storyCanvasSegmentsSnapshot: serializeAuthorMutation,
        storyCanvasSegmentsFinalize: serializeAuthorMutation,
        storyCanvasSegmentsGenerator: async (context, generationOptions) => {
          const codexStatus = await getCodexStatus({ force: true });
          if (!codexStatus.codexAvailable) {
            throw httpError(503, "Codex CLI is not available on this authoring server.");
          }
          if (!codexStatus.authenticated) {
            throw httpError(409, "Sign in to Codex CLI before generating story progress.");
          }
          return generateStoryCanvasSegmentsWithCodex(context, {
            ...generationOptions,
            codexBin: CODEX_BIN,
            codexVersion: codexStatus.version,
          });
        },
      }, body);
      writeJsonResponse(res, 200, { storyCanvasSegments });
      return;
    }

    if (route === "POST /api/source-motion-links") {
      writeJsonResponse(res, 200, await saveSourceMotionLinks(authorOptions(), await readJsonBody(req)));
      return;
    }

    if (route === "POST /api/dynamics/generate") {
      const payload = await readLimitedJsonBody(req, MAX_DYNAMICS_JSON_BYTES);
      writeJsonResponse(res, 200, await generateProceduralDynamicsPlan(await proposalAuthorOptions(), payload));
      return;
    }

    if (route === "POST /api/dynamics/apply") {
      const payload = await readLimitedJsonBody(req, MAX_DYNAMICS_JSON_BYTES);
      writeJsonResponse(res, 200, await applyProceduralDynamicsPlan(authorOptions(), payload));
      return;
    }

    if (route === "POST /api/dynamics/remove") {
      const payload = await readLimitedJsonBody(req, MAX_DYNAMICS_JSON_BYTES);
      writeJsonResponse(res, 200, await removeProceduralDynamicsPlan(authorOptions(), payload));
      return;
    }

    if (route === "POST /api/story-build") {
      assertSameOriginJsonRequest(req);
      writeJsonResponse(res, 202, await startStoryBuildJob());
      return;
    }

    const storyBuildMatch = route.match(/^GET \/api\/story-build\/([^/]+)$/);
    if (storyBuildMatch) {
      sweepStoryBuildJobs();
      const job = storyBuildJobs.get(storyBuildMatch[1]) || null;
      if (!job) throw httpError(404, "This story build is no longer available.");
      writeJsonResponse(res, 200, publicStoryBuildJob(job));
      return;
    }

    if (route === "POST /api/compile") {
      assertSameOriginJsonRequest(req);
      writeJsonResponse(res, 202, {
        ...await startStoryBuildJob(),
        deprecatedEndpoint: "/api/compile",
      });
      return;
    }

    const proposalMatch = route.match(/^POST \/api\/proposals\/([^/]+)$/);
    if (proposalMatch) {
      writeJsonResponse(res, 200, await generateComponentProposals(await proposalAuthorOptions(), proposalMatch[1], await readJsonBody(req)));
      return;
    }

    if (route === "POST /api/decisions/spatial-relations/draft") {
      const payload = await readJsonBody(req);
      writeJsonResponse(res, 200, await serializeSpatialDecisionMutation(
        () => saveSpatialRelationsDecisionDraft(authorOptions(), payload),
      ));
      return;
    }

    if (route === "POST /api/decisions/attention-guidance/draft") {
      const payload = await readJsonBody(req);
      writeJsonResponse(res, 200, await saveAttentionGuidanceDecisionDraft(authorOptions(), payload));
      return;
    }

    const draftDecisionMatch = route.match(/^POST \/api\/decisions\/([^/]+)\/draft$/);
    if (draftDecisionMatch) {
      const payload = await readJsonBody(req);
      writeJsonResponse(res, 200, await saveCheckpointDecisionDraft(authorOptions(), draftDecisionMatch[1], payload));
      return;
    }

    const saveDecisionMatch = route.match(/^POST \/api\/decisions\/([^/]+)\/save$/);
    if (saveDecisionMatch) {
      const payload = await readJsonBody(req);
      const operation = () => saveCheckpointDecision(authorOptions(), saveDecisionMatch[1], payload);
      writeJsonResponse(res, 200, saveDecisionMatch[1] === "spatial-relations"
        ? await serializeSpatialDecisionMutation(operation)
        : await operation());
      return;
    }

    writeJsonResponse(res, 404, { error: "Unknown API route." });
  } catch (error) {
    writeJsonResponse(res, error.statusCode || environmentErrorStatus(error), {
      error: error.message,
      diagnostics: error.diagnostics || [],
    });
  }
}

function serializeSpatialDecisionMutation(operation) {
  const result = spatialDecisionMutation.then(operation, operation);
  spatialDecisionMutation = result.catch(() => {});
  return result;
}

function serializedAuthorRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/api/state" || pathname.startsWith("/api/history/")) return true;
  if (method === "GET") return false;
  if (pathname === "/api/dynamics/generate") return false;
  return pathname === "/api/compile"
    || pathname === "/api/story-build"
    || pathname === "/api/source-motion-links"
    || pathname.startsWith("/api/dynamics/")
    || pathname.startsWith("/api/spatial-relations/")
    || pathname.startsWith("/api/story-graph")
    || pathname.startsWith("/api/proposals/")
    || pathname.startsWith("/api/decisions/")
    || (
      pathname.startsWith("/api/environment-enhancement/")
      && pathname !== "/api/environment-enhancement/generate"
    );
}

function serializeAuthorMutation(operation) {
  const result = authorMutation.then(operation, operation);
  authorMutation = result.catch(() => {});
  return result;
}

async function startStoryBuildJob() {
  sweepStoryBuildJobs();
  const activeJob = activeStoryBuildJob();
  if (activeJob) return { ...publicStoryBuildJob(activeJob), reused: true };

  // Revalidate and capture an immutable story copy while this short start
  // request owns the author mutation turn. Codex and Vite only see that copy.
  await loadAuthorProject(authorOptions());
  const snapshot = await createStoryBuildSnapshot();
  const job = {
    id: randomUUID(),
    status: "running",
    inputSignature: snapshot.inputSignature,
    currentInputSignature: snapshot.inputSignature,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finishedAtMs: null,
    result: null,
    error: null,
    promise: null,
    snapshot,
    publishRoot: null,
  };
  storyBuildJobs.set(job.id, job);
  activeStoryBuildJobId = job.id;
  trimStoryBuildJobs();
  job.promise = runStoryBuildJob(job);
  return publicStoryBuildJob(job);
}

async function runStoryBuildJob(job) {
  let terminalStatus = "failed";
  let terminalResult = null;
  let terminalError = null;
  try {
    const codexStatus = await getCodexStatus({ force: true }).catch(() => ({
      authenticated: false,
      codexAvailable: false,
      version: null,
    }));
    let runtime = await compileAuthorRuntime({
      ...authorOptions(),
      storyFolder: job.snapshot.storyFolder,
      resourceFolder: job.snapshot.resourceFolder,
      readerBuildRepoRoot: job.snapshot.repoRoot,
      codexWorkspace: job.snapshot.repoRoot,
      performanceOptimizationEnabled: true,
      readerDistBuildEnabled: false,
      codexAuthenticated: Boolean(codexStatus.codexAvailable && codexStatus.authenticated),
      codexVersion: codexStatus.version || null,
    });
    runtime = await normalizeSnapshotBuildOutputs(runtime, job.snapshot);
    runtime = await buildNormalizedSnapshotReader(runtime, job.snapshot);
    const publication = await stageStoryBuildPublication(job);
    const finalized = await serializeAuthorMutation(async () => {
      const currentInputSignature = await readStoryBuildInputSignature();
      if (currentInputSignature !== job.inputSignature) {
        return { status: "stale", currentInputSignature, readerRun: null };
      }
      await publishStoryBuildOutputs(publication.entries, publication.root);
      return {
        status: "built",
        currentInputSignature,
        readerRun: await storyBuildReaderRun(),
      };
    });
    job.currentInputSignature = finalized.currentInputSignature;
    terminalStatus = finalized.status;
    terminalResult = summarizeStoryBuildRuntime(runtime, {
      stale: finalized.status === "stale",
      readerRun: finalized.readerRun,
    });
  } catch (error) {
    terminalError = {
      message: error?.message || String(error),
      diagnostics: Array.isArray(error?.diagnostics) ? error.diagnostics : [],
      ...(error?.code ? { code: error.code } : {}),
    };
  } finally {
    const cleanupError = await cleanupStoryBuildArtifacts(job).catch((error) => error);
    if (cleanupError && !terminalError) {
      terminalResult = {
        ...terminalResult,
        warnings: [
          ...(Array.isArray(terminalResult?.warnings) ? terminalResult.warnings : []),
          {
            code: cleanupError.code || "STORY_BUILD_CLEANUP_FAILED",
            message: `The story build finished, but StoryVR could not clean up temporary files: ${cleanupError.message}`,
          },
        ],
      };
    }
    job.status = terminalError ? "failed" : terminalStatus;
    job.result = terminalError ? null : terminalResult;
    job.error = terminalError;
    job.finishedAt = new Date().toISOString();
    job.finishedAtMs = Date.now();
    if (activeStoryBuildJobId === job.id) activeStoryBuildJobId = null;
    sweepStoryBuildJobs();
  }
}

function activeStoryBuildJob() {
  if (!activeStoryBuildJobId) return null;
  const job = storyBuildJobs.get(activeStoryBuildJobId) || null;
  if (!job || job.status !== "running") {
    activeStoryBuildJobId = null;
    return null;
  }
  return job;
}

function sweepStoryBuildJobs(now = Date.now()) {
  for (const [jobId, job] of storyBuildJobs) {
    if (job.status === "running") continue;
    if (Number.isFinite(job.finishedAtMs) && now - job.finishedAtMs >= STORY_BUILD_JOB_TTL_MS) {
      storyBuildJobs.delete(jobId);
    }
  }
  trimStoryBuildJobs();
}

function trimStoryBuildJobs() {
  if (storyBuildJobs.size <= MAX_STORY_BUILD_JOBS) return;
  const completed = [...storyBuildJobs.values()]
    .filter((job) => job.status !== "running")
    .sort((left, right) => (left.finishedAtMs || 0) - (right.finishedAtMs || 0));
  while (storyBuildJobs.size > MAX_STORY_BUILD_JOBS && completed.length) {
    storyBuildJobs.delete(completed.shift().id);
  }
}

async function createStoryBuildSnapshot() {
  const initialSignature = await readStoryBuildInputSignature();
  const root = await mkdtemp(path.join(tmpdir(), "storyvr-build-"));
  try {
    const layout = storyBuildSnapshotLayout(root, environmentPaths.storyFolder);
    const resourceRelativePath = relativePathInside(
      environmentPaths.storyFolder,
      environmentPaths.resourceFolder,
      "resourceFolder",
    );
    const environmentAssetRelativePath = relativePathInside(
      environmentPaths.storyFolder,
      environmentStore.paths.assetRoot,
      "environmentAssetRoot",
    );
    const snapshot = {
      root,
      repoRoot: layout.repoRoot,
      hostingRoot: layout.hostingRoot,
      storyFolder: layout.storyFolder,
      resourceFolder: path.join(layout.storyFolder, resourceRelativePath),
      environmentAssetRoot: path.join(layout.storyFolder, environmentAssetRelativePath),
      inputSignature: initialSignature,
    };
    await Promise.all([
      copyPathIfPresent(environmentPaths.resourceFolder, snapshot.resourceFolder),
      copyPathIfPresent(environmentPaths.analysisRoot, path.join(snapshot.storyFolder, "analysis", "storyvr")),
      copySnapshotAnimationProbe(snapshot),
      copyPathIfPresent(
        path.join(environmentPaths.storyFolder, "webxr-adaptation"),
        path.join(snapshot.storyFolder, "webxr-adaptation"),
      ),
      linkSnapshotDependencies(layout.repoRoot, layout.hostingRoot),
    ]);
    const snapshotPaths = resolveAuthorPaths({
      storyFolder: snapshot.storyFolder,
      resourceFolder: snapshot.resourceFolder,
    });
    snapshot.paths = snapshotPaths;
    const readSnapshotSignature = createStoryBuildInputSignatureReader({
      paths: snapshotPaths,
      environmentAssetRoot: snapshot.environmentAssetRoot,
      repositoryRoot: REPO_ROOT,
      referenceStoryFolder: environmentPaths.storyFolder,
    });
    const [snapshotSignature, finalLiveSignature] = await Promise.all([
      readSnapshotSignature(),
      readStoryBuildInputSignature(),
    ]);
    if (snapshotSignature !== initialSignature || finalLiveSignature !== initialSignature) {
      throw httpError(409, "The story changed while StoryVR was preparing its build snapshot. Select Build story again.");
    }
    return snapshot;
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function storyBuildSnapshotLayout(root, storyFolder) {
  const repoRelativeStory = path.relative(REPO_ROOT, storyFolder);
  if (pathIsContainedRelative(repoRelativeStory)) {
    const repoRoot = path.join(root, "repo");
    return {
      repoRoot,
      hostingRoot: repoRoot,
      storyFolder: path.join(repoRoot, repoRelativeStory),
    };
  }
  const liveHostingRoot = path.dirname(REPO_ROOT);
  const siblingRelativeStory = path.relative(liveHostingRoot, storyFolder);
  if (pathIsContainedRelative(siblingRelativeStory)) {
    const repoRoot = path.join(root, path.basename(REPO_ROOT));
    return {
      repoRoot,
      hostingRoot: root,
      storyFolder: path.join(root, siblingRelativeStory),
    };
  }
  const repoRoot = path.join(root, "repo");
  return {
    repoRoot,
    hostingRoot: root,
    storyFolder: path.join(root, path.basename(storyFolder)),
  };
}

function pathIsContainedRelative(value) {
  return value !== ""
    && value !== ".."
    && !value.startsWith(`..${path.sep}`)
    && !path.isAbsolute(value);
}

function relativePathInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!pathIsContainedRelative(relative)) {
    throw httpError(500, `StoryVR ${label} must stay inside the active story folder.`);
  }
  return relative;
}

async function linkSnapshotDependencies(repoRoot, hostingRoot) {
  const source = path.join(REPO_ROOT, "node_modules");
  if (!await pathExists(source)) return;
  const destinations = new Set([
    path.join(repoRoot, "node_modules"),
    path.join(hostingRoot, "node_modules"),
  ]);
  for (const destination of destinations) {
    await mkdir(path.dirname(destination), { recursive: true });
    if (!await pathExists(destination)) await symlink(source, destination, directoryLinkType());
  }
}

async function copyPathIfPresent(source, destination) {
  if (!await pathExists(source)) return false;
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    force: true,
    preserveTimestamps: true,
    mode: fsConstants.COPYFILE_FICLONE,
  });
  return true;
}

async function copySnapshotAnimationProbe(snapshot) {
  const liveProbeRoot = path.join(environmentPaths.storyFolder, "analysis", "animation-logic-probe");
  const snapshotProbeRoot = path.join(snapshot.storyFolder, "analysis", "animation-logic-probe");
  await copyPathIfPresent(liveProbeRoot, snapshotProbeRoot);

  // loadAuthorProject has already selected and recorded any repository fallback
  // probe while the start request owns the author mutation turn. Copy that exact
  // artifact into the snapshot's authoritative story-local probe root so the
  // detached compiler never consults a changing live fallback tree.
  const graph = JSON.parse(await readFile(environmentPaths.storyGraphPath, "utf8"));
  const candidates = [];
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (
        (key === "artifactPath" || key === "path")
        && value.split(/[\\/]/).at(-1) === "codex-animation-judgment.json"
      ) candidates.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    }
  };
  visit(graph);
  let sourceJudgment = null;
  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(REPO_ROOT, candidate);
    if (resolved.startsWith(`${REPO_ROOT}${path.sep}`) && await pathExists(resolved)) {
      sourceJudgment = resolved;
      break;
    }
  }
  if (!sourceJudgment || sourceJudgment.startsWith(`${liveProbeRoot}${path.sep}`)) return;
  const destinationRoot = path.join(snapshotProbeRoot, ".storyvr-build-fallback");
  const sourceEvidence = path.join(path.dirname(sourceJudgment), "animation-evidence.json");
  const destinationJudgment = path.join(destinationRoot, "codex-animation-judgment.json");
  const destinationEvidence = path.join(destinationRoot, "animation-evidence.json");
  await Promise.all([
    copyPathIfPresent(sourceJudgment, destinationJudgment),
    copyPathIfPresent(sourceEvidence, destinationEvidence),
  ]);
  snapshot.probePathReplacements = [
    [destinationJudgment, sourceJudgment],
    [destinationEvidence, sourceEvidence],
    [toPosix(path.relative(REPO_ROOT, destinationJudgment)), toPosix(path.relative(REPO_ROOT, sourceJudgment))],
    [toPosix(path.relative(REPO_ROOT, destinationEvidence)), toPosix(path.relative(REPO_ROOT, sourceEvidence))],
  ];
}

async function normalizeSnapshotBuildOutputs(runtime, snapshot) {
  const liveReader = liveReaderBuildPaths();
  const replacements = snapshotPathReplacements(snapshot);
  rewriteSnapshotPathStrings(runtime, replacements);
  runtime.provenance = runtime.provenance || {};
  runtime.provenance.resourceFolder = environmentPaths.resourceFolder;
  runtime.provenance.projectPath = environmentPaths.projectPath;
  if (runtime.performanceOptimization) {
    runtime.performanceOptimization.artifactPath = liveReader.performanceArtifactPath;
  }
  if (runtime.provenance.performanceOptimization) {
    runtime.provenance.performanceOptimization.artifactPath = liveReader.performanceArtifactPath;
  }
  if (runtime.readerBuild) {
    runtime.readerBuild.readerSourcePath = liveReader.readerSourcePath;
    runtime.readerBuild.distPath = liveReader.distPath;
    runtime.readerBuild.buildBase = liveReader.buildBase;
  }
  if (runtime.provenance.readerBuild) {
    runtime.provenance.readerBuild.distPath = liveReader.distPath;
    runtime.provenance.readerBuild.buildBase = liveReader.buildBase;
  }
  await mkdir(path.dirname(snapshot.paths.compiledRuntimePath), { recursive: true });
  await writeFile(snapshot.paths.compiledRuntimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

  if (await pathExists(snapshot.paths.performanceOptimizationPath)) {
    const optimization = JSON.parse(await readFile(snapshot.paths.performanceOptimizationPath, "utf8"));
    rewriteSnapshotPathStrings(optimization, replacements);
    optimization.artifactPath = liveReader.performanceArtifactPath;
    await writeFile(
      snapshot.paths.performanceOptimizationPath,
      `${JSON.stringify(optimization, null, 2)}\n`,
      "utf8",
    );
  }
  return runtime;
}

async function buildNormalizedSnapshotReader(runtime, snapshot) {
  const readerBuild = await buildReaderDist(snapshot.paths, {
    readerBuildRepoRoot: snapshot.repoRoot,
    readerBuildLogLevel: "warn",
  });
  const liveReader = liveReaderBuildPaths();
  runtime.readerBuild = {
    ...readerBuild,
    readerSourcePath: liveReader.readerSourcePath,
    distPath: liveReader.distPath,
    buildBase: liveReader.buildBase,
  };
  runtime.provenance = runtime.provenance || {};
  runtime.provenance.readerBuild = {
    schemaVersion: runtime.readerBuild.schemaVersion,
    status: runtime.readerBuild.status,
    distPath: runtime.readerBuild.distPath,
    buildBase: runtime.readerBuild.buildBase,
    builtAt: runtime.readerBuild.builtAt,
  };
  await writeFile(snapshot.paths.compiledRuntimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  return runtime;
}

function snapshotPathReplacements(snapshot) {
  const liveHostingRoot = readerHostingLayout(environmentPaths.storyFolder).hostingRoot;
  const values = [
    ...(Array.isArray(snapshot.probePathReplacements) ? snapshot.probePathReplacements : []),
    [snapshot.resourceFolder, environmentPaths.resourceFolder],
    [snapshot.storyFolder, environmentPaths.storyFolder],
    [snapshot.repoRoot, REPO_ROOT],
    [snapshot.hostingRoot, liveHostingRoot],
    [toPosix(path.relative(REPO_ROOT, snapshot.storyFolder)), toPosix(path.relative(REPO_ROOT, environmentPaths.storyFolder))],
    [toPosix(path.relative(REPO_ROOT, snapshot.repoRoot)), "."],
  ];
  return values
    .flatMap(([from, to]) => [[String(from), String(to)], [toPosix(from), toPosix(to)]])
    .filter(([from]) => from && from !== ".")
    .sort((left, right) => right[0].length - left[0].length);
}

function rewriteSnapshotPathStrings(value, replacements) {
  if (typeof value === "string") {
    let next = value;
    for (const [from, to] of replacements) next = next.replaceAll(from, to);
    return next;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = rewriteSnapshotPathStrings(value[index], replacements);
    }
    return value;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      value[key] = rewriteSnapshotPathStrings(child, replacements);
    }
  }
  return value;
}

async function stageStoryBuildPublication(job) {
  const root = await mkdtemp(path.join(environmentPaths.storyFolder, ".storyvr-build-publish-"));
  job.publishRoot = root;
  const entries = [
    {
      source: job.snapshot.paths.compiledRuntimePath,
      staged: path.join(root, "next", "discovery", "storyvr-runtime.json"),
      target: environmentPaths.compiledRuntimePath,
      backup: path.join(root, "previous", "discovery", "storyvr-runtime.json"),
    },
    {
      source: job.snapshot.paths.performanceOptimizationPath,
      staged: path.join(root, "next", "analysis", "storyvr", "performance-optimization.json"),
      target: environmentPaths.performanceOptimizationPath,
      backup: path.join(root, "previous", "analysis", "storyvr", "performance-optimization.json"),
    },
    {
      source: path.join(job.snapshot.storyFolder, "webxr-adaptation"),
      staged: path.join(root, "next", "webxr-adaptation"),
      target: path.join(environmentPaths.storyFolder, "webxr-adaptation"),
      backup: path.join(root, "previous", "webxr-adaptation"),
    },
    {
      source: path.join(job.snapshot.storyFolder, "dist-webxr-adaptation"),
      staged: path.join(root, "next", "dist-webxr-adaptation"),
      target: path.join(environmentPaths.storyFolder, "dist-webxr-adaptation"),
      backup: path.join(root, "previous", "dist-webxr-adaptation"),
    },
  ];
  try {
    for (const entry of entries) {
      if (!await pathExists(entry.source)) {
        throw new Error(`StoryVR snapshot build did not create ${toPosix(path.relative(job.snapshot.storyFolder, entry.source))}.`);
      }
      await copyPathIfPresent(entry.source, entry.staged);
    }
    return { root, entries };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    job.publishRoot = null;
    throw error;
  }
}

async function publishStoryBuildOutputs(entries, publishRoot) {
  const applied = [];
  try {
    // Publish the reader runtime last so a served reader never observes a new
    // runtime before its matching source and production bundle are in place.
    const ordered = [...entries].sort((left, right) => (
      Number(left.target === environmentPaths.compiledRuntimePath)
      - Number(right.target === environmentPaths.compiledRuntimePath)
    ));
    for (const entry of ordered) {
      await mkdir(path.dirname(entry.target), { recursive: true });
      await mkdir(path.dirname(entry.backup), { recursive: true });
      const hadPrevious = await pathExists(entry.target);
      if (hadPrevious) await rename(entry.target, entry.backup);
      try {
        await rename(entry.staged, entry.target);
      } catch (error) {
        if (hadPrevious) {
          try {
            await rename(entry.backup, entry.target);
          } catch (restoreError) {
            error.message = `${error.message} StoryVR could not restore ${entry.target}: ${restoreError.message}`;
            error.diagnostics = [
              ...(Array.isArray(error.diagnostics) ? error.diagnostics : []),
              {
                code: "STORY_BUILD_PUBLISH_ROLLBACK_FAILED",
                message: restoreError.message,
              },
            ];
          }
        }
        throw error;
      }
      applied.push({ ...entry, hadPrevious });
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of applied.reverse()) {
      try {
        await rm(entry.target, { recursive: true, force: true });
        if (entry.hadPrevious) await rename(entry.backup, entry.target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      error.message = `${error.message} StoryVR could not fully restore the previous reader outputs.`;
      error.diagnostics = [
        ...(Array.isArray(error.diagnostics) ? error.diagnostics : []),
        {
          code: "STORY_BUILD_PUBLISH_ROLLBACK_FAILED",
          message: rollbackErrors.map((rollbackError) => rollbackError.message).join("; "),
        },
      ];
    }
    throw error;
  }
  return publishRoot;
}

async function cleanupStoryBuildArtifacts(job) {
  const roots = [job.publishRoot, job.snapshot?.root].filter(Boolean);
  job.publishRoot = null;
  if (job.snapshot) job.snapshot.root = null;
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}

function liveReaderBuildPaths() {
  const layout = readerHostingLayout(environmentPaths.storyFolder);
  const readerSource = path.join(environmentPaths.storyFolder, "webxr-adaptation");
  const distPath = `${layout.readerStoryPath}/dist-webxr-adaptation`;
  return {
    readerSource,
    readerSourcePath: toPosix(path.relative(REPO_ROOT, readerSource)),
    distPath,
    buildBase: `/${distPath}/`,
    performanceArtifactPath: toPosix(path.relative(REPO_ROOT, environmentPaths.performanceOptimizationPath)),
  };
}

function readerHostingLayout(storyFolder) {
  const resolvedStoryFolder = path.resolve(storyFolder);
  const repoRelativeStory = path.relative(REPO_ROOT, resolvedStoryFolder);
  if (pathIsContainedRelative(repoRelativeStory)) {
    return { hostingRoot: REPO_ROOT, readerStoryPath: toPosix(repoRelativeStory) };
  }
  const siblingHostingRoot = path.dirname(REPO_ROOT);
  const siblingRelativeStory = path.relative(siblingHostingRoot, resolvedStoryFolder);
  if (pathIsContainedRelative(siblingRelativeStory)) {
    return { hostingRoot: siblingHostingRoot, readerStoryPath: toPosix(siblingRelativeStory) };
  }
  return { hostingRoot: path.dirname(resolvedStoryFolder), readerStoryPath: path.basename(resolvedStoryFolder) };
}

async function storyBuildReaderRun() {
  const live = liveReaderBuildPaths();
  const layout = readerHostingLayout(environmentPaths.storyFolder);
  const runtimePath = toPosix(path.relative(REPO_ROOT, environmentPaths.compiledRuntimePath));
  const storyFolder = toPosix(path.relative(REPO_ROOT, environmentPaths.storyFolder));
  const distReady = await pathExists(path.join(environmentPaths.storyFolder, "dist-webxr-adaptation", "index.html"));
  const devPort = 5177;
  const instanceBuildScript = path.join(live.readerSource, "tools", "build-story-instance.mjs");
  const distFolder = path.join(environmentPaths.storyFolder, "dist-webxr-adaptation");
  const storyIsOutsideRepo = layout.hostingRoot !== REPO_ROOT;
  const commands = readerRunCommands({
    repositoryRoot: REPO_ROOT,
    readerDistBuildScript: READER_DIST_BUILD_SCRIPT,
    readerSource: live.readerSource,
    distFolder,
    buildBase: live.buildBase,
    hostingRoot: layout.hostingRoot,
    distPath: live.distPath,
    instanceBuildScript: await pathExists(instanceBuildScript) ? instanceBuildScript : null,
    viteRoot: storyIsOutsideRepo ? live.readerSource : null,
    devPort,
  });
  return {
    status: "ready",
    source: "story-container",
    distReady,
    runtimePath,
    storyFolder,
    commandRoot: REPO_ROOT,
    readerSourcePath: live.readerSourcePath,
    distPath: live.distPath,
    ...commands,
    devUrl: storyIsOutsideRepo
      ? `http://127.0.0.1:${devPort}/`
      : `http://127.0.0.1:${devPort}/${live.readerSourcePath}/`,
    staticUrl: `https://<PREFERRED-LAN-IP>:8443/${live.distPath}/`,
    message: distReady
      ? "Reader source and production dist are ready. The HTTPS host advertises the active Wi-Fi address before Ethernet."
      : "Reader source is ready. Build the reader to generate the production files before serving it.",
  };
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function publicStoryBuildJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    inputSignature: job.inputSignature,
    currentInputSignature: job.currentInputSignature,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  };
}

function summarizeStoryBuildRuntime(runtime, options) {
  const stale = options?.stale === true;
  const graph = runtime?.sceneTopology?.storyGraph || {};
  const authoredBeatCount = Number.isFinite(Number(runtime?.provenance?.authoredBeatCount))
    ? Number(runtime.provenance.authoredBeatCount)
    : Array.isArray(graph.beats)
      ? graph.beats.length
      : Array.isArray(runtime?.contentUnits)
        ? runtime.contentUnits.length
        : runtime?.contentUnitCount;
  const fineGrainedBeatCount = Number.isFinite(Number(runtime?.provenance?.fineGrainedBeatCount))
    ? Number(runtime.provenance.fineGrainedBeatCount)
    : Array.isArray(graph.atomicBeats)
      ? graph.atomicBeats.length
      : authoredBeatCount;
  const diagnostics = Array.isArray(runtime?.diagnostics) ? runtime.diagnostics : [];
  return {
    kind: "compile",
    slug: runtime?.slug,
    title: runtime?.title,
    contentUnitCount: authoredBeatCount,
    authoredBeatCount,
    fineGrainedBeatCount,
    authoredBeatSignature: runtime?.provenance?.authoredBeatSignature || null,
    assetCount: Array.isArray(runtime?.assets) ? runtime.assets.length : runtime?.assetCount,
    diagnosticCount: diagnostics.length,
    diagnostics,
    performanceOptimization: runtime?.performanceOptimization || null,
    readerBuild: runtime?.readerBuild || null,
    readerRun: options?.readerRun || null,
    compiledAt: runtime?.provenance?.compiledAt || null,
    stale,
  };
}

async function withAuthorArtifactRollback(operation) {
  const rollback = await historyStore.createSession();
  try {
    return await operation();
  } catch (error) {
    try {
      await historyStore.restoreCheckpoint(rollback.sessionId, rollback.checkpointId);
    } catch (rollbackError) {
      error.statusCode = 500;
      error.diagnostics = [
        ...(Array.isArray(error.diagnostics) ? error.diagnostics : []),
        {
          code: "ENVIRONMENT_INSTALL_ROLLBACK_FAILED",
          message: `Automatic rollback failed: ${rollbackError.message}`,
        },
      ];
      error.message = `${error.message} Automatic rollback also failed; reload StoryVR before continuing.`;
    }
    throw error;
  } finally {
    await historyStore.deleteSession(rollback.sessionId).catch(() => {});
  }
}

async function serveStoryAsset(req, res, url) {
  const relativeAssetPath = decodeURIComponent(url.pathname.replace(/^\/api\/assets\/?/, ""));
  const { resourceFolder } = resolveAuthorPaths(authorOptions());
  const assetPath = path.resolve(resourceFolder, relativeAssetPath);
  if (!assetPath.startsWith(`${resourceFolder}${path.sep}`)) {
    writeJsonResponse(res, 403, { error: "Forbidden asset path." });
    return;
  }
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) throw new Error("not a file");
    res.setHeader("cache-control", "private, no-cache");
    res.setHeader("etag", fileEntityTag(info));
    res.setHeader("last-modified", info.mtime.toUTCString());
    if (requestHasCurrentEntity(req, res)) return;
    const data = await readFile(assetPath);
    res.statusCode = 200;
    res.setHeader("content-type", mimeTypeFor(assetPath));
    res.setHeader("content-length", String(data.byteLength));
    res.end(data);
  } catch {
    writeJsonResponse(res, 404, { error: "Asset not found." });
  }
}

async function serveEnvironmentAsset(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    writeJsonResponse(res, 405, { error: "Setting assets support GET and HEAD only." });
    return;
  }
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const assetPath = environmentStore.assetPathFromUrl(requestUrl.pathname);
  if (!assetPath) {
    writeJsonResponse(res, 404, { error: "Setting asset not found." });
    return;
  }
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) throw new Error("not a file");
    res.statusCode = 200;
    res.setHeader("content-type", mimeTypeFor(assetPath));
    res.setHeader("cache-control", "private, no-cache");
    res.setHeader("etag", fileEntityTag(info));
    res.setHeader("last-modified", info.mtime.toUTCString());
    res.setHeader("x-content-type-options", "nosniff");
    if (requestHasCurrentEntity(req, res)) return;
    res.setHeader("content-length", String(info.size));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    await pipeline(createReadStream(assetPath), res);
  } catch {
    if (!res.headersSent) writeJsonResponse(res, 404, { error: "Setting asset not found." });
    else res.destroy();
  }
}

function fileEntityTag(info) {
  const parts = [
    info.dev,
    info.ino,
    info.size,
    Number(info.mtimeMs) * 1000,
    Number(info.ctimeMs) * 1000,
  ].map((value) => Math.trunc(Number(value) || 0).toString(16));
  return `W/"${parts.join("-")}"`;
}

function requestHasCurrentEntity(req, res) {
  const supplied = String(req.headers["if-none-match"] || "").trim();
  const current = String(res.getHeader("etag") || "");
  if (!supplied || !current || !supplied.split(",").map((value) => value.trim()).includes(current)) return false;
  res.statusCode = 304;
  res.end();
  return true;
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".gltf") return "model/gltf+json";
  if (ext === ".hdr") return "image/vnd.radiance";
  if (ext === ".exr") return "image/x-exr";
  if (ext === ".bin") return "application/octet-stream";
  if (ext === ".wasm") return "application/wasm";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function decorateEnvironmentAssignment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value;
  const asset = source.asset && typeof source.asset === "object"
    ? { ...source.asset, localUrl: source.asset.localPath || null }
    : null;
  const selection = asset ? {
    ...source,
    candidate: source.candidate || source.selectedSource || null,
    asset,
  } : null;
  const movementCue = normalizeEnvironmentMovementCue(
    source.movementCue,
    DEFAULT_ENVIRONMENT_MOVEMENT_CUE,
  );
  if (movementCue.texture) {
    movementCue.texture = {
      ...movementCue.texture,
      localUrl: movementCue.texture.localPath || null,
    };
  }
  return {
    ...source,
    asset,
    selection,
    draft: {
      transform: source.transform || { position: [0, 0, 0], rotationY: 0, scale: 1 },
      rendering: source.rendering || { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
      movementCue,
    },
    selectedSource: source.selectedSource || null,
    skipped: source.skipped === true,
  };
}

function decorateEnvironmentState(state) {
  const source = state && typeof state === "object" ? state : {};
  const projection = decorateEnvironmentAssignment(source) || {};
  const defaultAssignment = decorateEnvironmentAssignment(source.defaultAssignment);
  const assignmentsByBeat = Object.fromEntries(
    Object.entries(source.assignmentsByBeat || {}).map(([beatId, assignment]) => [
      beatId,
      decorateEnvironmentAssignment(assignment),
    ]),
  );
  return {
    schemaVersion: source.schemaVersion || "storyvr-environment-enhancement/v1",
    revision: Number(source.revision) || 0,
    selection: projection.selection || null,
    draft: projection.draft || decorateEnvironmentAssignment({}).draft,
    selectedSource: projection.selectedSource || null,
    skipped: projection.skipped === true,
    defaultAssignment,
    assignmentsByBeat,
  };
}

function decorateEnvironmentStateFromDisk(state) {
  return decorateEnvironmentState(state);
}

async function assertEnvironmentEnhancementReady() {
  const projectState = await loadAuthorProject(authorOptions());
  if (!projectState.readiness?.["environment-enhancement"]?.canGenerate) {
    throw httpError(409, "Finish Place objects before editing Set the scene.");
  }
  return projectState;
}

function requireAuthoredEnvironmentBeat(projectState, value, label = "beatId") {
  const beatId = String(value || "").trim();
  if (!beatId) throw httpError(400, "A story part is required.");
  const authoredBeatIds = new Set(
    (projectState?.graph?.beats || [])
      .map((beat) => String(beat?.id || "").trim())
      .filter(Boolean),
  );
  if (!authoredBeatIds.has(beatId)) {
    throw httpError(400, "Choose a story part from Story order.");
  }
  return beatId;
}

function stageEnvironmentGeneration({ beatId, baselineRevision, baselineSignature, generated, ground }) {
  sweepPendingEnvironmentGenerations();
  while (pendingEnvironmentGenerations.size >= MAX_PENDING_ENVIRONMENT_GENERATIONS) {
    const oldestToken = pendingEnvironmentGenerations.keys().next().value;
    if (!oldestToken) break;
    pendingEnvironmentGenerations.delete(oldestToken);
  }
  const generationToken = randomUUID();
  pendingEnvironmentGenerations.set(generationToken, {
    createdAt: Date.now(),
    beatId,
    baselineRevision,
    baselineSignature,
    generated,
    ground,
  });
  return generationToken;
}

function environmentStateSignature(value) {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function sweepPendingEnvironmentGenerations(now = Date.now()) {
  for (const [generationToken, pending] of pendingEnvironmentGenerations) {
    if (now - pending.createdAt >= PENDING_ENVIRONMENT_GENERATION_TTL_MS) {
      pendingEnvironmentGenerations.delete(generationToken);
    }
  }
}

function environmentGenerationMetadata(generated, ground) {
  return {
    generationId: generated.generationId,
    prompt: generated.prompt,
    ...generated.metadata,
    ground: {
      generationId: ground.generationId,
      prompt: ground.prompt,
      ...ground.metadata,
    },
  };
}

function createGeneratedEnvironmentCandidate(generated) {
  const prompt = generated.prompt;
  const shortTitle = prompt.length > 80 ? `${prompt.slice(0, 77).trimEnd()}...` : prompt;
  return {
    id: `codex-cli:${generated.generationId}`,
    provider: "codex-cli",
    providerAssetId: generated.generationId,
    sourceId: generated.generationId,
    title: shortTitle || "Generated setting",
    description: `AI-generated 360° setting: ${prompt}`,
    sourceUrl: null,
    license: null,
    provenance: {
      source: "codex-cli-image-generation",
      generated: true,
      prompt,
      ...generated.metadata,
    },
  };
}

function normalizeEnvironmentDraft(body) {
  const transform = body?.transform && typeof body.transform === "object" && !Array.isArray(body.transform)
    ? body.transform
    : {};
  const rendering = body?.rendering && typeof body.rendering === "object" && !Array.isArray(body.rendering)
    ? body.rendering
    : {};
  const movementCue = body?.movementCue && typeof body.movementCue === "object" && !Array.isArray(body.movementCue)
    ? body.movementCue
    : null;
  const position = Array.isArray(transform.position) ? transform.position.slice(0, 3) : null;
  const finite = (value, fallback, minimum, maximum) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  };
  const normalizedMovementCue = movementCue
    ? normalizeEnvironmentMovementCue(movementCue, DEFAULT_ENVIRONMENT_MOVEMENT_CUE)
    : null;
  const result = {
    transform: {
      ...(position ? { position: [
        finite(position[0], 0, -10_000, 10_000),
        finite(position[1], 0, -10_000, 10_000),
        finite(position[2], 0, -10_000, 10_000),
      ] } : {}),
      ...(transform.rotationY !== undefined ? { rotationY: finite(transform.rotationY, 0, -Math.PI * 2, Math.PI * 2) } : {}),
      ...(transform.scale !== undefined ? { scale: finite(transform.scale, 1, 0.001, 1_000) } : {}),
    },
    rendering: {
      ...(rendering.exposure !== undefined ? { exposure: finite(rendering.exposure, 1, 0.01, 20) } : {}),
      ...(rendering.fogDensity !== undefined ? { fogDensity: finite(rendering.fogDensity, 0, 0, 2) } : {}),
      ...(typeof rendering.fogColor === "string" && /^#[0-9a-f]{6}$/i.test(rendering.fogColor) ? { fogColor: rendering.fogColor } : {}),
      ...(typeof rendering.backgroundMode === "string" && ["asset", "fog-color", "transparent"].includes(rendering.backgroundMode)
        ? { backgroundMode: rendering.backgroundMode }
        : {}),
    },
    ...(normalizedMovementCue ? {
      movementCue: {
        ...(movementCue.enabled !== undefined ? { enabled: normalizedMovementCue.enabled } : {}),
        ...(movementCue.style !== undefined ? { style: normalizedMovementCue.style } : {}),
        ...(movementCue.coverage !== undefined ? { coverage: normalizedMovementCue.coverage } : {}),
        ...(movementCue.position !== undefined ? { position: normalizedMovementCue.position } : {}),
        ...(movementCue.widthMeters !== undefined ? { widthMeters: normalizedMovementCue.widthMeters } : {}),
        ...(movementCue.depthMeters !== undefined ? { depthMeters: normalizedMovementCue.depthMeters } : {}),
        ...(movementCue.thicknessMeters !== undefined ? { thicknessMeters: normalizedMovementCue.thicknessMeters } : {}),
        ...(movementCue.textureScaleMeters !== undefined ? { textureScaleMeters: normalizedMovementCue.textureScaleMeters } : {}),
        ...(movementCue.opacity !== undefined ? { opacity: normalizedMovementCue.opacity } : {}),
      },
    } : {}),
  };
  return result;
}

async function readLimitedJsonBody(req, maximumBytes) {
  const declaredLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    discardRequestBody(req);
    throw httpError(413, "Request body is too large.");
  }

  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      fail(httpError(408, "Request body timed out before it was completely received."));
    }, REQUEST_BODY_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAborted);
      req.off("error", onError);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      discardRequestBody(req);
      reject(error);
    };
    function onData(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maximumBytes) {
        fail(httpError(413, "Request body is too large."));
        return;
      }
      chunks.push(buffer);
    }
    function onEnd() {
      finish(Buffer.concat(chunks));
    }
    function onAborted() {
      fail(httpError(400, "Request body was interrupted before it was completely received."));
    }
    function onError(error) {
      fail(httpError(400, `Request body could not be read: ${error.message}`));
    }

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("aborted", onAborted);
    req.once("error", onError);
  });

  const text = body.toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function requestBodyTimeoutFromEnvironment(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 30_000;
  return Math.min(parsed, 5 * 60 * 1000);
}

function discardRequestBody(req) {
  if (!req.destroyed && !req.readableEnded) {
    req.once("error", () => {});
    req.resume();
  }
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function assertSameOriginJsonRequest(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw httpError(415, "Story progress generation requires application/json.");
  }
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw httpError(403, "Story progress generation requires a same-origin request.");
  }
  if (originHost !== String(req.headers.host || "").trim()) {
    throw httpError(403, "Story progress generation requires a same-origin request.");
  }
}

function environmentErrorStatus(error) {
  const message = String(error?.message || "");
  if (/^Generated environment asset exceeds/.test(message)) return 413;
  if (error instanceof TypeError || /must|invalid|unsafe|does not contain|missing dependency|empty|exceeds|unsupported/i.test(message)) return 400;
  return 500;
}

function authorOptions() {
  return {
    ...options,
    aiProvider: "codex",
    codexBin: CODEX_BIN,
    codexWorkspace: process.cwd(),
  };
}

async function proposalAuthorOptions() {
  const status = await getCodexStatus({ force: true }).catch(() => ({ authenticated: false }));
  return {
    ...authorOptions(),
    aiProvider: status.authenticated ? "codex" : "openai",
  };
}

function runCodexCommand(commandArgs, commandOptions = {}) {
  return new Promise((resolve) => {
    const child = spawn(CODEX_BIN, commandArgs, {
      cwd: commandOptions.cwd || process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), commandOptions.timeoutMs || 10_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function getCodexStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedCodexStatus && now < cachedCodexStatusExpiresAt) {
    return cachedCodexStatus;
  }
  if (codexStatusInFlight) return codexStatusInFlight;

  const request = (async () => {
    const [versionResult, loginResult] = await Promise.all([
      runCodexCommand(["--version"], { timeoutMs: 5000 }),
      runCodexCommand(["login", "status"], { timeoutMs: 8000 }),
    ]);
    if (versionResult.ok && versionResult.stdout.trim()) cachedCodexVersion = versionResult.stdout.trim();
    const loginText = `${loginResult.stdout}${loginResult.stderr}`.trim();
    const status = {
      codexAvailable: versionResult.ok,
      version: cachedCodexVersion,
      authenticated: loginResult.ok && /logged in/i.test(loginText),
      authText: loginText || loginResult.error || "Not logged in",
      authMethod: "codex-cli",
    };
    cachedCodexStatus = Object.freeze(status);
    cachedCodexStatusExpiresAt = Date.now() + CODEX_STATUS_TTL_MS;
    return cachedCodexStatus;
  })();
  codexStatusInFlight = request;
  try {
    return await request;
  } finally {
    if (codexStatusInFlight === request) codexStatusInFlight = null;
  }
}

function invalidateCodexStatusCache() {
  cachedCodexStatus = null;
  cachedCodexStatusExpiresAt = 0;
}

async function startCodexLogin() {
  if (loginProcess) return loginState;
  const status = await getCodexStatus({ force: true }).catch(() => ({ authenticated: false }));
  if (status.authenticated) {
    loginState = {
      running: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      loginUrl: null,
      loginCode: null,
      authenticated: true,
      authText: status.authText,
      output: [{
        source: "status",
        line: "Codex is already signed in. No new browser login is needed.",
        at: new Date().toISOString(),
      }],
    };
    broadcastLogin("state", loginState);
    return loginState;
  }
  loginState = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    loginUrl: null,
    loginCode: null,
    output: [],
  };
  loginProcess = spawn(CODEX_BIN, ["login"], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  broadcastLogin("state", loginState);
  loginProcess.stdout.on("data", (chunk) => appendLoginOutput("stdout", chunk.toString("utf8")));
  loginProcess.stderr.on("data", (chunk) => appendLoginOutput("stderr", chunk.toString("utf8")));
  loginProcess.on("error", (error) => appendLoginOutput("error", error.message));
  loginProcess.on("close", (code) => {
    loginState.running = false;
    loginState.finishedAt = new Date().toISOString();
    loginState.exitCode = code;
    loginProcess = null;
    invalidateCodexStatusCache();
    getCodexStatus({ force: true })
      .then((nextStatus) => {
        loginState.authenticated = nextStatus.authenticated;
        loginState.authText = nextStatus.authText;
        broadcastLogin("state", loginState);
      })
      .catch(() => broadcastLogin("state", loginState));
  });
  return loginState;
}

function appendLoginOutput(source, text) {
  const lines = stripAnsi(text)
    .replace(/\r/g, "")
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ source, line, at: new Date().toISOString() }));
  loginState.output.push(...lines);

  let foundDetails = false;
  for (const entry of lines) {
    const url = entry.line.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "");
    const code = extractDeviceCode(entry.line);
    if (url && loginState.loginUrl !== url) {
      loginState.loginUrl = url;
      foundDetails = true;
    }
    if (code && loginState.loginCode !== code) {
      loginState.loginCode = code;
      foundDetails = true;
    }
  }

  for (const entry of lines) {
    broadcastLogin("line", {
      ...entry,
      loginUrl: loginState.loginUrl,
      loginCode: loginState.loginCode,
    });
  }
  if (foundDetails) broadcastLogin("state", loginState);
}

function extractDeviceCode(line) {
  const text = String(line || "");
  const explicit = text.match(/(?:code|device code|user code)[:\s]+([A-Z0-9][A-Z0-9-]{5,20})/i)?.[1];
  if (explicit) return explicit.toUpperCase();
  return text.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/)?.[0]
    || text.match(/\b[A-Z0-9]{8,12}\b/)?.[0]
    || null;
}

function broadcastLogin(type, payload) {
  for (const res of loginClients) writeSse(res, type, payload);
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function stripAnsi(value) {
  return value.replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

async function readJsonBody(req) {
  return readLimitedJsonBody(req, MAX_JSON_BODY_BYTES);
}

function writeJsonResponse(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", String(Buffer.byteLength(body)));
  res.end(body);
}
