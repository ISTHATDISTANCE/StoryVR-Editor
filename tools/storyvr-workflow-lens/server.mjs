#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  analyzeWorkflowEvidence,
  codexStatus,
  MAX_CODEX_OUTPUT_CHARS,
  WorkflowAnalysisError,
} from "./lib/codex-analysis.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(TOOL_ROOT, "app");
const LIB_ROOT = path.join(TOOL_ROOT, "lib");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5197;
const STATUS_CACHE_MS = 30_000;

export const MAX_ANALYSIS_BODY_BYTES = 1024 * 1024;

export function createStoryvrWorkflowLens(options = {}) {
  const host = cleanHost(options.host || DEFAULT_HOST);
  const port = validPort(options.port == null ? DEFAULT_PORT : options.port);
  const codexBin = options.codexBin || process.env.CODEX_BIN || "codex";
  const runCodex = options.runCodex;
  const statusProvider = options.getCodexStatus
    || (runCodex
      ? async () => ({
        codexAvailable: true,
        authenticated: true,
        version: "injected-test-runner",
        authMethod: "injected",
        message: "Codex analysis runner is available.",
      })
      : () => codexStatus({ codexBin, runCommand: options.runCodexCommand }));
  const analysisTimeoutMs = positiveInteger(options.analysisTimeoutMs, undefined);
  const maxAnalysisOutputChars = positiveInteger(options.maxAnalysisOutputChars, MAX_CODEX_OUTPUT_CHARS);
  let cachedStatus = null;
  let cachedStatusExpiresAt = 0;
  let statusInFlight = null;

  async function getStatus({ force = false } = {}) {
    const now = Date.now();
    if (!force && cachedStatus && now < cachedStatusExpiresAt) return cachedStatus;
    if (statusInFlight) return statusInFlight;
    statusInFlight = Promise.resolve()
      .then(() => statusProvider())
      .then(normalizeStatus)
      .catch((error) => normalizeStatus({
        codexAvailable: false,
        authenticated: false,
        message: `Codex status could not be checked: ${safeErrorMessage(error)}`,
      }))
      .then((status) => {
        cachedStatus = Object.freeze(status);
        cachedStatusExpiresAt = Date.now() + STATUS_CACHE_MS;
        return cachedStatus;
      })
      .finally(() => {
        statusInFlight = null;
      });
    return statusInFlight;
  }

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    try {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
      const route = `${req.method} ${requestUrl.pathname}`;

      if (route === "GET /api/status" || route === "HEAD /api/status") {
        const status = await getStatus();
        writeJson(res, 200, status, req.method === "HEAD");
        return;
      }

      if (requestUrl.pathname === "/api/status") {
        methodNotAllowed(res, ["GET", "HEAD"]);
        return;
      }

      if (route === "POST /api/analyze") {
        assertSameOriginJsonRequest(req);
        const body = await readBoundedJsonBody(req, MAX_ANALYSIS_BODY_BYTES);
        const digest = isPlainObject(body.digest) ? body.digest : body;
        const status = await getStatus({ force: options.forceStatusBeforeAnalysis === true });
        if (!status.codexAvailable) {
          throw httpError(503, "Codex CLI is not available for workflow analysis.", "CODEX_UNAVAILABLE");
        }
        if (!status.authenticated) {
          throw httpError(409, "Sign in to Codex CLI before analyzing this workflow.", "CODEX_NOT_AUTHENTICATED");
        }
        const analysis = await analyzeWorkflowEvidence(digest, {
          ...(runCodex ? { runCodex } : {}),
          codexBin,
          codexVersion: status.version,
          ...(analysisTimeoutMs ? { timeoutMs: analysisTimeoutMs } : {}),
          maxOutputChars: maxAnalysisOutputChars,
        });
        writeJson(res, 200, { analysis });
        return;
      }

      if (requestUrl.pathname === "/api/analyze") {
        methodNotAllowed(res, ["POST"]);
        return;
      }

      if (requestUrl.pathname.startsWith("/api/")) {
        writeJson(res, 404, { error: "Unknown StoryVR Workflow Lens API route.", code: "NOT_FOUND" });
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, ["GET", "HEAD"]);
        return;
      }

      const staticFile = await resolveStaticFile(requestUrl.pathname);
      if (!staticFile) {
        writeJson(res, 404, { error: "StoryVR Workflow Lens asset not found.", code: "NOT_FOUND" });
        return;
      }
      await serveStaticFile(req, res, staticFile);
    } catch (error) {
      const statusCode = responseStatus(error);
      writeJson(res, statusCode, {
        error: publicErrorMessage(error, statusCode),
        ...(error?.code ? { code: String(error.code) } : {}),
      });
    }
  });

  return Object.freeze({
    server,
    host,
    port,
    getStatus,
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
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  });
}

async function resolveStaticFile(requestPath) {
  let root;
  let relativePath;
  if (requestPath === "/" || requestPath === "") {
    root = APP_ROOT;
    relativePath = "index.html";
  } else if (requestPath.startsWith("/lib/")) {
    root = LIB_ROOT;
    relativePath = requestPath.slice("/lib/".length);
  } else {
    root = APP_ROOT;
    relativePath = requestPath.replace(/^\/+/, "");
  }
  const filePath = safeStaticPath(root, relativePath);
  if (!filePath) return null;
  const info = await stat(filePath).catch(() => null);
  return info?.isFile() ? { filePath, size: info.size } : null;
}

function safeStaticPath(root, relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(relativePath || ""));
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return null;
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  return candidate.startsWith(`${resolvedRoot}${path.sep}`) ? candidate : null;
}

async function serveStaticFile(req, res, file) {
  res.statusCode = 200;
  res.setHeader("content-type", mediaType(file.filePath));
  res.setHeader("content-length", file.size);
  res.setHeader("cache-control", "no-store");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  await pipeline(createReadStream(file.filePath), res);
}

function assertSameOriginJsonRequest(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw httpError(415, "Workflow analysis requests must use application/json.", "UNSUPPORTED_MEDIA_TYPE");
  }
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw httpError(403, "The workflow analysis request origin is invalid.", "INVALID_ORIGIN");
  }
  if (originHost !== String(req.headers.host || "")) {
    throw httpError(403, "Cross-origin workflow analysis requests are not allowed.", "CROSS_ORIGIN_REQUEST");
  }
}

async function readBoundedJsonBody(req, maximumBytes) {
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    req.resume();
    throw httpError(413, `The evidence digest exceeds the ${formatBytes(maximumBytes)} request limit.`, "REQUEST_TOO_LARGE");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maximumBytes) {
      throw httpError(413, `The evidence digest exceeds the ${formatBytes(maximumBytes)} request limit.`, "REQUEST_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw httpError(400, "The workflow evidence digest is empty.", "EMPTY_REQUEST");
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) throw new TypeError("request root must be an object");
    return parsed;
  } catch (error) {
    throw httpError(400, `The workflow evidence digest is not valid JSON: ${safeErrorMessage(error)}`, "INVALID_JSON");
  }
}

function setSecurityHeaders(res) {
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
}

function writeJson(res, statusCode, payload, headOnly = false) {
  if (res.headersSent || res.writableEnded) return;
  const body = `${JSON.stringify(payload)}\n`;
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(headOnly ? "" : body);
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader("allow", allowedMethods.join(", "));
  writeJson(res, 405, { error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" });
}

function normalizeStatus(value) {
  const source = isPlainObject(value) ? value : {};
  const codexAvailable = source.codexAvailable === true;
  const authenticated = codexAvailable && source.authenticated === true;
  return {
    codexAvailable,
    authenticated,
    version: source.version == null ? null : String(source.version).replace(/\s+/g, " ").trim().slice(0, 160) || null,
    authMethod: String(source.authMethod || "codex-cli-device-auth").slice(0, 120),
    message: String(source.message || (
      !codexAvailable
        ? "Codex CLI is not available on this computer."
        : authenticated
          ? "Codex CLI is ready for workflow analysis."
          : "Sign in to Codex CLI before analyzing this workflow."
    )).replace(/\s+/g, " ").trim().slice(0, 500),
  };
}

function mediaType(filePath) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function responseStatus(error) {
  const supplied = Number(error?.statusCode);
  if (Number.isInteger(supplied) && supplied >= 400 && supplied <= 599) return supplied;
  if (error instanceof WorkflowAnalysisError) return error.statusCode;
  return 500;
}

function publicErrorMessage(error, statusCode) {
  if (statusCode >= 500 && !error?.statusCode && !(error instanceof WorkflowAnalysisError)) {
    return "StoryVR Workflow Lens could not complete the request.";
  }
  return safeErrorMessage(error) || "StoryVR Workflow Lens request failed.";
}

function safeErrorMessage(error) {
  return String(error?.message || error || "").replace(/\s+/g, " ").trim().slice(0, 1_000);
}

function cleanHost(value) {
  const host = String(value || "").trim();
  if (!host || /[\s/\\]/.test(host)) throw new Error("--host must be a hostname or IP address.");
  return host;
}

function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer from 0 through 65535.");
  }
  return port;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function formatBytes(value) {
  return value % (1024 * 1024) === 0 ? `${value / (1024 * 1024)} MiB` : `${value.toLocaleString("en-US")} bytes`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runFromCommandLine() {
  const args = parseArgs({
    allowPositionals: false,
    options: {
      host: { type: "string", default: DEFAULT_HOST },
      port: { type: "string", default: String(DEFAULT_PORT) },
    },
  });
  const lens = createStoryvrWorkflowLens({
    host: args.values.host,
    port: args.values.port,
  });
  const address = await lens.listen();
  const actualHost = typeof address === "object" && address ? address.address : lens.host;
  const actualPort = typeof address === "object" && address ? address.port : lens.port;
  console.log(`StoryVR Workflow Lens: http://${formatAddressHost(actualHost)}:${actualPort}/`);

  const close = async () => {
    await lens.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

function formatAddressHost(host) {
  return String(host).includes(":") ? `[${host}]` : host;
}

const commandPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === commandPath) {
  runFromCommandLine().catch((error) => {
    console.error(`StoryVR Workflow Lens failed to start: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
