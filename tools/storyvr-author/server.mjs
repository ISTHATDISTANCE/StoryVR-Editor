#!/usr/bin/env node

import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { createServer as createViteServer } from "vite";
import { hostingRootForPath } from "../storyvr-adapter/storyvr-adapter.mjs";
import {
  applyProceduralDynamicsPlan,
  applyAnimationProbeLinks,
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
import { createHistoryCheckpointStore } from "./history-store.mjs";

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
const pendingEnvironmentGenerations = new Map();
const PENDING_ENVIRONMENT_GENERATION_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_ENVIRONMENT_GENERATIONS = 4;
const historySweepTimer = setInterval(() => {
  historyStore.sweepExpiredSessions().catch(() => {});
  sweepPendingEnvironmentGenerations();
}, 15 * 60 * 1000);
historySweepTimer.unref();
let environmentGenerationBusy = false;
const MAX_ENVIRONMENT_JSON_BYTES = 64 * 1024;
const MAX_ENVIRONMENT_GENERATION_JSON_BYTES = 32 * 1024 * 1024;
const MAX_DYNAMICS_JSON_BYTES = 512 * 1024;
const MAX_STORY_CANVAS_SEGMENTS_JSON_BYTES = 16 * 1024;

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

const vite = await createViteServer({
  root: appRoot,
  server: {
    middlewareMode: true,
    hmr: { server: null },
  },
  appType: "spa",
});

const server = http.createServer(async (req, res) => {
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

server.on("close", () => {
  clearInterval(historySweepTimer);
  pendingEnvironmentGenerations.clear();
  historyStore.dispose().catch(() => {});
});

server.listen(port, host, async () => {
  const state = await loadAuthorProject(authorOptions());
  console.log(`StoryVR authoring UI: http://${host}:${port}/`);
  console.log(`Story: ${state.project.story.title || state.project.story.slug}`);
  console.log(`Resource folder: ${state.paths.resourceFolder}`);
  console.log(`Project state: ${state.paths.projectPath}`);
});

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
        throw httpError(409, "An environment panorama and matching ground are already being prepared.");
      }

      environmentGenerationBusy = true;
      try {
        const codexStatus = await getCodexStatus({ force: true });
        if (!codexStatus.codexAvailable) {
          throw httpError(503, "Codex CLI is not available on this authoring server.");
        }
        if (!codexStatus.authenticated) {
          throw httpError(409, "Sign in to Codex CLI before generating an environment image.");
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
        throw httpError(404, "The generated environment is no longer available. Generate it again.");
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
          "Environment Enhancement changed while the image was generating. Generate again from the current draft.",
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
        throw httpError(400, "targetBeatIds must be an array of authored beat ids.");
      }
      const targetBeatIds = [...new Set(body.targetBeatIds.map((beatId) => (
        requireAuthoredEnvironmentBeat(projectState, beatId, "targetBeatIds")
      )))];
      if (!targetBeatIds.length) {
        throw httpError(400, "Select at least one other beat.");
      }
      if (targetBeatIds.includes(sourceBeatId)) {
        throw httpError(400, "The source beat cannot also be an apply target.");
      }
      const expectedRevision = Number(body.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw httpError(400, "expectedRevision must be a non-negative integer.");
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

    if (route === "POST /api/compile") {
      const codexStatus = await getCodexStatus({ force: true }).catch(() => ({
        authenticated: false,
        codexAvailable: false,
        version: null,
      }));
      writeJsonResponse(res, 200, await compileAuthorRuntime({
        ...authorOptions(),
        performanceOptimizationEnabled: true,
        readerDistBuildEnabled: true,
        codexAuthenticated: Boolean(codexStatus.codexAvailable && codexStatus.authenticated),
        codexVersion: codexStatus.version || null,
      }));
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
    writeJsonResponse(res, 405, { error: "Environment assets support GET and HEAD only." });
    return;
  }
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const assetPath = environmentStore.assetPathFromUrl(requestUrl.pathname);
  if (!assetPath) {
    writeJsonResponse(res, 404, { error: "Environment asset not found." });
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
    if (!res.headersSent) writeJsonResponse(res, 404, { error: "Environment asset not found." });
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
    throw httpError(409, "Save Spatial Relations before editing Environment Enhancement.");
  }
  return projectState;
}

function requireAuthoredEnvironmentBeat(projectState, value, label = "beatId") {
  const beatId = String(value || "").trim();
  if (!beatId) throw httpError(400, `${label} is required.`);
  const authoredBeatIds = new Set(
    (projectState?.graph?.beats || [])
      .map((beat) => String(beat?.id || "").trim())
      .filter(Boolean),
  );
  if (!authoredBeatIds.has(beatId)) {
    throw httpError(400, `${label} must identify an authored Source Graph beat.`);
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
    title: shortTitle || "Generated environment",
    description: `AI-generated 360° environment: ${prompt}`,
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
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximumBytes) throw httpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
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
      authMethod: "codex-cli-device-auth",
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
        line: "Codex is already signed in. No device code is needed.",
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
  loginProcess = spawn(CODEX_BIN, ["login", "--device-auth"], {
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
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function writeJsonResponse(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", String(Buffer.byteLength(body)));
  res.end(body);
}
