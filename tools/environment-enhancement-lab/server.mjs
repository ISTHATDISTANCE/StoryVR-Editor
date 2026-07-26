import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createEnvironmentStore,
  MAX_ENVIRONMENT_UPLOAD_BYTES,
} from "./lib/environment-store.mjs";
import { searchEnvironmentCandidates } from "./lib/providers.mjs";

const LAB_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(LAB_ROOT, "../..");
const APP_ROOT = path.join(LAB_ROOT, "app");
const THREE_ROOT = path.join(REPO_ROOT, "node_modules", "three");
const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5196;

export function createEnvironmentEnhancementLab(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port == null ? DEFAULT_PORT : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer from 0 through 65535.");
  }
  const storyFolder = resolveOptionalStoryFolder(options.storyFolder);
  const store = options.store || createEnvironmentStore({ repoRoot: REPO_ROOT, labRoot: LAB_ROOT, storyFolder });
  const searchCandidates = options.searchEnvironmentCandidates || searchEnvironmentCandidates;
  const candidateCache = new Map();
  let manualUploadCounter = 0;
  let providerStatus = initialProviderStatus();
  let storyContextPromise = loadStoryContext(storyFolder);

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
      setCommonHeaders(res);

      if (req.method === "GET" && requestUrl.pathname === "/api/state") {
        const [story, state] = await Promise.all([storyContextPromise, store.getState()]);
        writeJson(res, 200, decorateState(state, story, providerStatus));
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/search") {
        const query = sanitizeQuery(requestUrl.searchParams.get("q"));
        if (!query) throw httpError(400, "Enter an environment search phrase first.");
        const providers = sanitizeProviders(requestUrl.searchParams.get("providers"));
        const result = await searchCandidates({ query, providers });
        candidateCache.clear();
        for (const candidate of result.candidates || []) candidateCache.set(candidate.id, candidate);
        providerStatus = result.providerStatus || initialProviderStatus();
        writeJson(res, 200, { query, candidates: result.candidates || [], providerStatus });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/upload") {
        const filename = requestUrl.searchParams.get("filename") || "";
        const candidateId = String(requestUrl.searchParams.get("candidateId") || "").trim();
        const candidate = candidateId
          ? candidateCache.get(candidateId)
          : createManualUploadCandidate(filename, ++manualUploadCounter);
        if (!candidate) throw httpError(409, "Search again before uploading a file for this environment result.");
        const expectedBytes = parseUploadContentLength(req.headers["content-length"]);
        const state = await store.importUpload({
          candidate,
          filename,
          body: req,
          expectedBytes,
          sourceMetadata: {
            selectedCandidateId: candidateId || null,
            selectionMode: candidateId ? "search-result" : "manual-upload",
          },
        });
        const story = await storyContextPromise;
        writeJson(res, 200, decorateState(state, story, providerStatus));
        return;
      }

      if (req.method === "PATCH" && requestUrl.pathname === "/api/draft") {
        const body = await readJsonBody(req);
        const state = await store.updateDraft(normalizeDraftUpdate(body));
        writeJson(res, 200, decorateState(state, await storyContextPromise, providerStatus));
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/lock") {
        const state = await store.lockSelection();
        writeJson(res, 200, decorateState(state, await storyContextPromise, providerStatus));
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/unlock") {
        const state = await store.unlockSelection();
        writeJson(res, 200, decorateState(state, await storyContextPromise, providerStatus));
        return;
      }

      if ((req.method === "GET" || req.method === "HEAD") && requestUrl.pathname.startsWith("/environment-assets/")) {
        const assetPath = store.assetPathFromUrl(requestUrl.pathname);
        if (!assetPath) throw httpError(404, "Environment asset not found.");
        await serveFile(res, assetPath, req.method === "HEAD");
        return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        const staticPath = resolveStaticPath(requestUrl.pathname);
        if (staticPath) {
          await serveFile(res, staticPath, req.method === "HEAD");
          return;
        }
      }

      writeJson(res, 404, { error: "Unknown Environment Enhancement Lab route." });
    } catch (error) {
      writeJson(res, responseStatusFor(error), { error: error.message || "Environment lab request failed." });
    }
  });

  return {
    server,
    host,
    port,
    storyFolder,
    refreshStoryContext() {
      storyContextPromise = loadStoryContext(storyFolder);
      return storyContextPromise;
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function resolveOptionalStoryFolder(value) {
  if (!value) return null;
  const resolved = path.resolve(REPO_ROOT, value);
  if (resolved !== REPO_ROOT && !resolved.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw new Error("--story-folder must stay inside the workspace.");
  }
  return resolved;
}

async function loadStoryContext(storyFolder) {
  if (!storyFolder) {
    return {
      slug: null,
      title: "Standalone environment experiment",
      folder: null,
      mode: "standalone",
      brief: {
        query: "",
        suggestions: ["realistic underwater ocean reef", "furnished house interior living room", "forest clearing natural habitat"],
        source: "manual",
      },
    };
  }

  const [project, graph] = await Promise.all([
    readJsonIfExists(path.join(storyFolder, "analysis", "storyvr", "project.json")),
    readJsonIfExists(path.join(storyFolder, "analysis", "storyvr", "story-graph.json")),
  ]);
  const slug = project?.story?.slug || graph?.story?.slug || path.basename(storyFolder);
  const title = project?.story?.title || graph?.story?.title || slug;
  const brief = deriveEnvironmentBrief({ title, graph });
  return {
    slug,
    title,
    folder: path.relative(REPO_ROOT, storyFolder),
    mode: "story",
    brief,
  };
}

function deriveEnvironmentBrief({ title, graph }) {
  const beats = Array.isArray(graph?.beats) ? graph.beats : [];
  const corpus = [title, ...beats.slice(0, 80).flatMap((beat) => [beat?.title, beat?.section, beat?.text])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const rules = [
    { pattern: /\b(shark|ocean|underwater|reef|seabed|marine|sea)\b/, query: "realistic underwater ocean reef seabed" },
    { pattern: /\b(bug|insect|bedbug|cockroach|housefly|home|house|room|furniture)\b/, query: "furnished house interior living room bedroom" },
    { pattern: /\b(forest|tree|wildlife|woodland|jungle)\b/, query: "realistic forest clearing natural habitat" },
    { pattern: /\b(space|planet|astronaut|orbit|spacecraft)\b/, query: "realistic space station interior deep space" },
    { pattern: /\b(city|urban|street|building|downtown)\b/, query: "realistic urban street environment" },
  ];
  const matched = rules.find((rule) => rule.pattern.test(corpus));
  return {
    query: matched?.query || "",
    suggestions: rules.map((rule) => rule.query),
    source: matched ? "deterministic-story-keywords" : "manual",
  };
}

function decorateState(state, story, currentProviderStatus) {
  const selection = state?.selection || state?.manifest || state || null;
  const asset = selection?.asset || null;
  const entryPath = asset?.entryPath || asset?.localPath || null;
  const localUrl = entryPath ? `/environment-assets/${entryPath.split(path.sep).map(encodeURIComponent).join("/")}` : null;
  const candidate = selection?.candidate && typeof selection.candidate === "object" ? selection.candidate : {};
  const position = selection?.transform?.position;
  const rotation = selection?.transform?.rotation;
  const format = String(asset?.format || path.extname(entryPath || "").slice(1)).toLowerCase();
  return {
    story: { slug: story.slug, title: story.title, folder: story.folder, mode: story.mode },
    brief: story.brief,
    selection: selection?.asset ? {
      ...candidate,
      ...selection,
      candidate,
      transform: {
        position: Array.isArray(position)
          ? position.slice(0, 3)
          : [position?.x ?? 0, position?.y ?? 0, position?.z ?? 0],
        rotationY: selection?.transform?.rotationY ?? rotation?.y ?? 0,
        scale: selection?.transform?.scale ?? 1,
      },
      asset: asset ? { ...asset, localUrl, mediaType: mediaTypeForFormat(format) } : null,
    } : null,
    locked: Boolean(selection?.locked),
    providerStatus: currentProviderStatus,
    storageMode: story.mode,
  };
}

function normalizeDraftUpdate(body) {
  const result = {};
  if (body?.transform && typeof body.transform === "object" && !Array.isArray(body.transform)) {
    const input = body.transform;
    const position = input.position;
    result.transform = {
      ...(Array.isArray(position)
        ? { position: position.slice(0, 3) }
        : position && typeof position === "object"
          ? { position: [position.x, position.y, position.z] }
          : {}),
      ...(input.rotationY !== undefined
        ? { rotationY: input.rotationY }
        : input.rotation?.y !== undefined ? { rotationY: input.rotation.y } : {}),
      ...(input.scale !== undefined ? { scale: input.scale } : {}),
    };
  }
  if (body?.rendering && typeof body.rendering === "object" && !Array.isArray(body.rendering)) {
    result.rendering = body.rendering;
  }
  return result;
}

function mediaTypeForFormat(format) {
  if (format === "glb") return "model/gltf-binary";
  if (format === "gltf") return "model/gltf+json";
  if (format === "hdr") return "image/vnd.radiance";
  if (format === "exr") return "image/x-exr";
  return "application/octet-stream";
}

function initialProviderStatus() {
  return Object.fromEntries(["polyhaven", "ambientcg", "sketchfab"].map((provider) => [provider, {
    status: "idle",
    count: 0,
  }]));
}

function sanitizeQuery(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

function sanitizeProviders(value) {
  if (!value) return undefined;
  const allowed = new Set(["polyhaven", "ambientcg", "sketchfab"]);
  return String(value).split(",").map((item) => item.trim().toLowerCase()).filter((item) => allowed.has(item));
}

function resolveStaticPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return path.join(APP_ROOT, "index.html");
  if (pathname === "/main.js") return path.join(APP_ROOT, "main.js");
  if (pathname === "/styles.css") return path.join(APP_ROOT, "styles.css");
  if (pathname === "/vendor/three.module.js") return path.join(THREE_ROOT, "build", "three.module.js");
  if (pathname === "/vendor/three.core.js") return path.join(THREE_ROOT, "build", "three.core.js");
  if (pathname.startsWith("/vendor/addons/")) {
    return safeChildPath(path.join(THREE_ROOT, "examples", "jsm"), pathname.slice("/vendor/addons/".length));
  }
  if (pathname.startsWith("/vendor/draco/")) {
    return safeChildPath(path.join(THREE_ROOT, "examples", "jsm", "libs", "draco", "gltf"), pathname.slice("/vendor/draco/".length));
  }
  return null;
}

function safeChildPath(root, relativePath) {
  const decoded = decodeURIComponent(relativePath);
  const resolved = path.resolve(root, decoded);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw httpError(403, "Forbidden path.");
  return resolved;
}

async function serveFile(res, filePath, headOnly = false) {
  const info = await stat(filePath);
  if (!info.isFile()) throw httpError(404, "File not found.");
  res.statusCode = 200;
  res.setHeader("content-type", mimeTypeFor(filePath));
  res.setHeader("content-length", String(info.size));
  res.setHeader("cache-control", "no-store");
  if (headOnly) {
    res.end();
    return;
  }
  await pipeline(createReadStream(filePath), res);
}

function createManualUploadCandidate(filename, sequence) {
  const basename = path.basename(String(filename || "environment"));
  const title = path.basename(basename, path.extname(basename)) || "Uploaded environment";
  const providerAssetId = `${title}-${Date.now().toString(36)}-${sequence}`;
  return {
    id: `manual-upload:${providerAssetId}`,
    provider: "manual-upload",
    providerAssetId,
    title,
    sourceUrl: null,
    license: null,
    provenance: { source: "user-upload" },
  };
}

function parseUploadContentLength(value) {
  if (value === undefined) return null;
  const contentLength = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw httpError(400, "Upload Content-Length must be a non-negative integer.");
  }
  if (contentLength > MAX_ENVIRONMENT_UPLOAD_BYTES) {
    throw httpError(413, `Environment upload exceeds the ${MAX_ENVIRONMENT_UPLOAD_BYTES}-byte limit.`);
  }
  return contentLength;
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json" || ext === ".gltf") return ext === ".gltf" ? "model/gltf+json" : "application/json; charset=utf-8";
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".hdr") return "image/vnd.radiance";
  if (ext === ".exr") return "image/x-exr";
  if (ext === ".wasm") return "application/wasm";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bin") return "application/octet-stream";
  return "application/octet-stream";
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw httpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function writeJson(res, statusCode, value) {
  if (res.writableEnded) return;
  const body = JSON.stringify(value, null, 2);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(Buffer.byteLength(body)));
  res.end(body);
}

function setCommonHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "xr-spatial-tracking=(self)");
  res.setHeader("content-security-policy", "default-src 'self'; img-src 'self' https: data:; connect-src 'self'; style-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function responseStatusFor(error) {
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  const message = String(error?.message || "");
  if (/^Unlock the environment selection|^Upload an environment asset before/.test(message)) return 409;
  if (/^Environment upload exceeds/.test(message)) return 413;
  if (error instanceof TypeError || /must be|does not contain|unsupported|invalid|exceeds|too large/i.test(message)) return 400;
  return 500;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") options.host = argv[++index];
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--story-folder") options.storyFolder = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Environment Enhancement Lab",
    "",
    "Usage:",
    "  node tools/environment-enhancement-lab/server.mjs [--story-folder <story-slug>] [--port 5196]",
    "",
    "Without --story-folder, uploads stay in the lab's ignored standalone scratch directory.",
    "With --story-folder, experiment assets and its manifest stay inside that story container.",
  ].join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const lab = createEnvironmentEnhancementLab(options);
    const address = await lab.listen();
    const actualPort = typeof address === "object" && address ? address.port : lab.port;
    process.stdout.write(`Environment Enhancement Lab: http://${lab.host}:${actualPort}/\n`);
    process.stdout.write(lab.storyFolder
      ? `Story experiment: ${path.relative(REPO_ROOT, lab.storyFolder)}\n`
      : "Mode: standalone scratch experiment\n");
    const close = async () => {
      await lab.close();
      process.exit(0);
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exit(1);
  }
}
