#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.16.1";
const JUDGMENT_SCHEMA_VERSION = "storyvr-animation-judgment/v3";
const CODEX_PROMPT_VERSION = "storyvr-animation-codex/v6";
const JUDGMENT_CACHE_SCHEMA_VERSION = "storyvr-codex-judgment-cache/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOADS = 140;
const TEXT_SCAN_LIMIT_BYTES = 6 * 1024 * 1024;
const CONTEXT_RADIUS = 420;
const MAX_EVIDENCE_ITEMS = 220;
const MAX_CODEX_RUNTIME_BEATS = 400;
const MAX_AI_ASSOCIATED_BEATS = 400;
const MAX_EMBEDDED_VISUAL_CAPTURES = 1200;
const MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CODEX_IMAGE_ATTACHMENTS = 24;
const MAX_MODEL_RESOLUTION_PASSES = 3;
const MAX_MODEL_RESOLUTION_CANDIDATES = 24;
const MIN_ACCESSIBLE_CARD_MODEL_CONFIDENCE = 0.70;
const CODEX_INPUT_HARD_LIMIT_CHARS = 1_048_576;
const CODEX_PROMPT_TARGET_CHARS = 900_000;
const CODEX_PROMPT_PROFILES = [
  {
    name: "deduplicated",
    sourceEvidenceLimit: MAX_EVIDENCE_ITEMS,
    sourceContextChars: null,
    runtimeBeatLimit: MAX_CODEX_RUNTIME_BEATS,
    downloadLimit: DEFAULT_MAX_DOWNLOADS,
    activeTextExampleLimit: 6,
    activeTextChars: 480
  },
  {
    name: "balanced",
    sourceEvidenceLimit: 180,
    sourceContextChars: 720,
    runtimeBeatLimit: 300,
    downloadLimit: 120,
    activeTextExampleLimit: 4,
    activeTextChars: 360
  },
  {
    name: "compact",
    sourceEvidenceLimit: 120,
    sourceContextChars: 420,
    runtimeBeatLimit: 200,
    downloadLimit: 100,
    activeTextExampleLimit: 3,
    activeTextChars: 280
  },
  {
    name: "minimal",
    sourceEvidenceLimit: 80,
    sourceContextChars: 240,
    runtimeBeatLimit: 120,
    downloadLimit: 80,
    activeTextExampleLimit: 2,
    activeTextChars: 200
  }
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const DATA_EXTENSIONS = new Set([".json", ".csv", ".geojson", ".topojson"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const DOWNLOAD_EXTENSIONS = new Set([...MODEL_EXTENSIONS, ...SCRIPT_EXTENSIONS, ...DATA_EXTENSIONS]);

const KEYWORDS = [
  "glb",
  "gltf",
  "animation",
  "animations",
  "AnimationMixer",
  "clipAction",
  "nextAnimVals",
  "lastAnimVals",
  "activeClipIndex",
  "animDurations",
  "percentageOfWindowIsScrolled",
  "percentageOfWindowInView",
  "percentageOfSlideTextInView",
  "percentageOfSlideInView",
  "calculateVisibilityForDiv",
  "calculatePercentageOfDivScrolledPast",
  "ratioScrolledPast",
  "distanceScrolledPastTopOfWebGLWindow",
  "setWebGLWindowHeights",
  "setTime",
  "timeScale",
  "mixer",
  "clock.getDelta",
  "duration",
  "position",
  "rotateOnScroll",
  "rotationScroll",
  "scroll",
  "scrollY",
  "scrollTop",
  "ScrollTrigger",
  "scrollama",
  "WEBGL_DATA",
  "webgl",
  "webglWindow",
  "three",
  "camera",
  "models",
  "slides",
  "slideVals",
  "slideIndex",
  "slideIndeces",
  "slideIndices",
  "windowIndex",
  "g-slide-text",
  "g-slide-hotspot",
  "g-webgl-window",
  "getBoundingClientRect",
  "data-params"
];

const RUNTIME_CONTROL_KEYWORDS = [
  "AnimationMixer",
  "clipAction",
  "nextAnimVals",
  "lastAnimVals",
  "activeClipIndex",
  "animDurations",
  "percentageOfWindowIsScrolled",
  "percentageOfWindowInView",
  "percentageOfSlideTextInView",
  "percentageOfSlideInView",
  "calculateVisibilityForDiv",
  "calculatePercentageOfDivScrolledPast",
  "ratioScrolledPast",
  "distanceScrolledPastTopOfWebGLWindow",
  "setWebGLWindowHeights",
  "setTime",
  "clock.getDelta",
  "updateSlide",
  "slideVals",
  "slideIndex",
  "slideIndeces",
  "slideIndices",
  "windowIndex",
  "g-slide-text",
  "g-slide-hotspot",
  "g-webgl-window"
];

const CLASSIFICATIONS = [
  "within-beat-dynamics",
  "inter-beat-dynamics",
  "ambient-object-motion",
  "asset-topology-transition",
  "unknown/needs-review"
];

const SCROLL_DRIVERS = [
  "time-based",
  "local-scroll-window-progress",
  "slide-indexed-scroll-transition",
  "absolute-page-scroll",
  "unknown"
];

const IMAGE_RELEVANCE_POLICY = "balanced-story-images/v1";
const IMAGE_RELEVANCE_STOP_WORDS = new Set([
  "interactive",
  "story",
  "stories",
  "article",
  "augmented",
  "reality",
  "explore",
  "mission",
  "science",
  "times",
  "york",
  "news",
  "video",
  "large",
  "jumbo",
  "desktop",
  "mobile",
  "cover",
  "image",
  "images",
  "photo",
  "photos"
]);
const IMAGE_HARD_REJECTION_PATTERNS = [
  ["site_icon", /(?:^|\/)(?:icons?|appicons?|apple-touch-icon|favicon)(?:\/|[-_.])/i],
  ["site_icon", /(?:ios|iphone|ipad|homescreen|appicon|touch-icon|favicon|site-logo|sitelogo|t_logo|nyt-logo|logo)[-_.]/i],
  ["share_or_social", /(?:share|social|whatsapp|telegram|reddit|linkedin|facebook|twitter|x-logo)[-_/]/i],
  ["platform_asset", /(?:games-assets|wordle|connections|spelling-bee|sudoku|strands|tiles|letter-boxed|wirecutter|core_app|core-news-download)/i],
  ["platform_asset", /(?:subscriber|subscribe|newsletter|recirculation|comments|meter|account|privacy|cookiepolicy|ethical-journalism|social-media-guidelines|payment_method_manifest)/i],
  ["placeholder_or_default", /(?:video-default|defaultpromo|default-promo|placeholder|loading-spinner)/i]
];

function parseArgs(argv) {
  const options = {
    input: "",
    storyFolder: "",
    out: "",
    fromOutput: "",
    authorInputFolder: "",
    codexBin: process.env.CODEX_BIN || "codex",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    codexTimeoutMs: null,
    maxDownloads: DEFAULT_MAX_DOWNLOADS,
    writeAuthorInput: false,
    noAuthorInput: false,
    noCodex: false,
    refreshCodex: false,
    codexCache: true,
    selfTest: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === "--input" || arg === "-i") {
      options.input = next();
    } else if (arg === "--story-folder") {
      options.storyFolder = next();
    } else if (arg === "--out" || arg === "-o") {
      options.out = next();
    } else if (arg === "--from-output") {
      options.fromOutput = next();
    } else if (arg === "--author-input-folder") {
      options.authorInputFolder = next();
      options.writeAuthorInput = true;
    } else if (arg === "--codex-bin") {
      options.codexBin = next();
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(next(), 10);
    } else if (arg === "--codex-timeout-ms") {
      options.codexTimeoutMs = Number.parseInt(next(), 10);
    } else if (arg === "--max-downloads") {
      options.maxDownloads = Number.parseInt(next(), 10);
    } else if (arg === "--write-author-input") {
      options.writeAuthorInput = true;
    } else if (arg === "--no-author-input") {
      options.noAuthorInput = true;
    } else if (arg === "--no-codex") {
      options.noCodex = true;
    } else if (arg === "--refresh-codex") {
      options.refreshCodex = true;
    } else if (arg === "--no-codex-cache") {
      options.codexCache = false;
    } else if (arg === "--self-test") {
      options.selfTest = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.selfTest && !options.help && !options.input) {
    throw new Error("--input is required.");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }
  if (!Number.isInteger(options.maxDownloads) || options.maxDownloads < 0) {
    throw new Error("--max-downloads must be a non-negative integer.");
  }
  if (options.noAuthorInput && (options.writeAuthorInput || options.authorInputFolder)) {
    throw new Error("--no-author-input cannot be combined with --write-author-input or --author-input-folder.");
  }
  if (options.noCodex && options.refreshCodex) {
    throw new Error("--refresh-codex cannot be combined with --no-codex.");
  }
  if (!options.codexCache && options.refreshCodex) {
    throw new Error("--refresh-codex cannot be combined with --no-codex-cache.");
  }

  return options;
}

function printHelp() {
  console.log(`
NYT animation logic probe analyzer ${VERSION}

Usage:
  node tools/animation-logic-probe/analyze-animation-probe.mjs --input nyt_animation_probe_<slug>.json
  node tools/animation-logic-probe/analyze-animation-probe.mjs --input probe.json --story-folder bugs-halloween-kids-ar-ul
  node tools/animation-logic-probe/analyze-animation-probe.mjs --input probe.json --story-folder mars --from-output mars/analysis/animation-logic-probe/<timestamp>

Options:
  -i, --input <file>          JSON exported by runtime-animation-collector.js
      --story-folder <dir>    Story slug folder for output placement
  -o, --out <dir>             Explicit output directory, mostly for testing
      --from-output <dir>     Reuse an existing analysis output folder to write author input
      --codex-bin <path>      Codex executable. Default: CODEX_BIN or codex
      --timeout-ms <n>        Per-download timeout. Default: ${DEFAULT_TIMEOUT_MS}
      --codex-timeout-ms <n>  Deprecated no-op. Codex judging has no script-imposed timeout.
      --max-downloads <n>     Max model/script/data downloads. Default: ${DEFAULT_MAX_DOWNLOADS}
      --write-author-input    Force writing StoryVR author input under <story-folder>/captures/active
      --author-input-folder <dir>
                              Explicit StoryVR fetched-resource folder to write
      --no-author-input       Do not write StoryVR author input
      --no-codex              Build evidence and local heuristic summary only
      --refresh-codex         Bypass and replace the semantic Codex judgment cache
      --no-codex-cache        Run Codex without reading or writing its judgment cache
      --self-test             Run parser/evidence helper self-test
      --help                  Show this help text
`);
}

function sha1(value, length = 12) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, length);
}

function sha1Bytes(value, length = 40) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, length);
}

function safeSegment(value, fallback = "item") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return cleaned || fallback;
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function storySlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "nyt-story";
    return safeSegment(last.replace(/\.[a-z0-9]+$/i, ""), "nyt-story").toLowerCase();
  } catch {
    return "nyt-story";
  }
}

function cleanCandidateString(value) {
  return String(value || "")
    .trim()
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/^[("'`]+/, "")
    .replace(/[)"'`,;}\]]+$/g, "");
}

function normalizeUrl(rawValue, baseUrl = "") {
  if (!rawValue || typeof rawValue !== "string") return null;
  let value = cleanCandidateString(rawValue);
  if (!value) return null;
  if (/^(data|blob|javascript|mailto|tel):/i.test(value)) return null;
  if (value.startsWith("//")) {
    const baseProtocol = baseUrl ? new URL(baseUrl).protocol : "https:";
    value = `${baseProtocol}${value}`;
  }

  try {
    const parsed = new URL(value, baseUrl || undefined);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function urlExtension(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : "";
  } catch {
    return "";
  }
}

function classifyUrl(url) {
  const ext = urlExtension(url);
  if (MODEL_EXTENSIONS.has(ext)) return "model";
  if (SCRIPT_EXTENSIONS.has(ext)) return "script";
  if (DATA_EXTENSIONS.has(ext)) return "data";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

function isDownloadCandidate(url) {
  return DOWNLOAD_EXTENSIONS.has(urlExtension(url));
}

function tokenSetFromText(value) {
  const tokens = new Set();
  const normalized = safeSegment(String(value || "").toLowerCase(), "")
    .split(/[-_.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !IMAGE_RELEVANCE_STOP_WORDS.has(token));
  for (const token of normalized) tokens.add(token);
  return tokens;
}

function imageRelevanceContextForProbe(probe) {
  const storyUrl = probe?.story_url || "";
  const slug = safeSegment(probe?.slug || storySlugFromUrl(storyUrl), "nyt-story").toLowerCase();
  const title = probe?.title || "";
  const tokens = new Set([
    ...tokenSetFromText(slug),
    ...tokenSetFromText(title)
  ]);
  try {
    const parsed = new URL(storyUrl);
    for (const part of parsed.pathname.split("/")) {
      for (const token of tokenSetFromText(part.replace(/\.[a-z0-9]+$/i, ""))) tokens.add(token);
    }
  } catch {
    // Ignore malformed story URLs; slug and title tokens still provide evidence.
  }
  return {
    storyUrl,
    slug,
    title,
    tokens
  };
}

function imageUrlPath(url) {
  try {
    return decodeURIComponent(new URL(url).pathname).toLowerCase();
  } catch {
    return String(url || "").toLowerCase();
  }
}

function imageHardRejectionReason(url) {
  const text = imageUrlPath(url);
  for (const [reason, pattern] of IMAGE_HARD_REJECTION_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return "";
}

function imageUrlHasStoryEvidence(url, context) {
  const text = imageUrlPath(url);
  for (const token of context.tokens || []) {
    if (text.includes(token)) return true;
  }
  return false;
}

function imageGroupStructuralText(group) {
  return `${group?.tag || ""} ${group?.selector || ""} ${group?.idAttribute || ""} ${group?.className || ""}`.toLowerCase();
}

function isRejectedImageGroupContainer(group) {
  const tag = String(group?.tag || "").toLowerCase();
  const selector = String(group?.selector || "").toLowerCase();
  const text = imageGroupStructuralText(group);
  if (["html", "body", "head", "meta", "link", "script", "style", "nav", "header", "footer", "aside"].includes(tag)) return true;
  if (/^(html|body|head)\b/.test(selector)) return true;
  return /\b(nav|navbar|navigation|masthead|footer|share|social|subscribe|newsletter|recirculation|related|comments|advert|meter|account)\b/.test(text);
}

function isExplicitStoryImageGroup(group) {
  const tag = String(group?.tag || "").toLowerCase();
  const text = imageGroupStructuralText(group);
  if (["figure", "picture", "img"].includes(tag)) return true;
  return /\b(g-image|g-photo|story-image|story-photo|image-ready|hero|cover)\b/.test(text);
}

function imageGroupHasCaptionOrCredit(group) {
  const caption = captionRecord(group?.caption);
  if (caption?.text) return true;
  return creditRecords(group?.credits).length > 0;
}

function filterImageSrcset(srcset, acceptedUrls, storyUrl = "") {
  const accepted = new Set(acceptedUrls);
  return (Array.isArray(srcset) ? srcset : [])
    .filter((entry) => {
      const url = typeof entry === "string" ? entry : entry?.url;
      const normalized = normalizeUrl(url, storyUrl);
      return normalized && accepted.has(normalized);
    });
}

function filenameForUrl(url) {
  let basename = "asset";
  try {
    const parsed = new URL(url);
    basename = path.posix.basename(decodeURIComponent(parsed.pathname)) || "asset";
  } catch {
    basename = "asset";
  }
  const parsedName = path.parse(basename);
  const name = safeSegment(parsedName.name, "asset").slice(0, 80);
  const ext = parsedName.ext.toLowerCase() || urlExtension(url);
  return `${name}-${sha1(url, 12)}${ext}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function embeddedImagePayload(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const bytes = Buffer.from(match[3].replace(/\s+/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_EMBEDDED_IMAGE_BYTES) return null;
  return {
    mediaType: match[1].toLowerCase(),
    extension: match[2].toLowerCase() === "jpeg" ? ".jpg" : `.${match[2].toLowerCase()}`,
    bytes
  };
}

function evenlySample(items, maxCount) {
  if (items.length <= maxCount) return [...items];
  if (maxCount <= 1) return items.length ? [items[0]] : [];
  const indexes = new Set();
  for (let index = 0; index < maxCount; index += 1) {
    indexes.add(Math.round(index * (items.length - 1) / (maxCount - 1)));
  }
  return Array.from(indexes).sort((left, right) => left - right).map((index) => items[index]);
}

function normalizedVisualActiveText(value) {
  if (!value || typeof value !== "object") return null;
  return {
    text: String(value.text || "").replace(/\s+/g, " ").trim(),
    id: String(value.id || "").slice(0, 160),
    dataStep: String(value.dataStep || "").slice(0, 160),
    dataSlide: String(value.dataSlide || "").slice(0, 160),
    dataScene: String(value.dataScene || "").slice(0, 160),
    dataScrollamaIndex: String(value.dataScrollamaIndex || "").slice(0, 160)
  };
}

async function writeEmbeddedVisualImage(item, folder, fallbackId) {
  const id = safeSegment(item?.id || fallbackId, fallbackId).slice(0, 100);
  const base = {
    id,
    evidenceRef: String(item?.evidenceRef || `visual-${id}`).slice(0, 160),
    status: String(item?.status || "unavailable").slice(0, 160),
    targetIndex: Number.isInteger(Number(item?.targetIndex)) ? Number(item.targetIndex) : null,
    targetY: Number.isFinite(Number(item?.targetY)) ? Number(item.targetY) : null,
    targetKind: String(item?.targetKind || "").slice(0, 80),
    traversalPhase: String(item?.traversalPhase || item?.explorationPhase || "").slice(0, 80),
    traversalDirection: String(item?.traversalDirection || "").slice(0, 40),
    snapshotId: String(item?.snapshotId || "").slice(0, 160),
    scrollPercent: Number.isFinite(Number(item?.scrollPercent)) ? Number(item.scrollPercent) : null,
    activeText: normalizedVisualActiveText(item?.activeText),
    viewport: item?.viewport && typeof item.viewport === "object" ? {
      width: Number.isFinite(Number(item.viewport.width)) ? Number(item.viewport.width) : null,
      height: Number.isFinite(Number(item.viewport.height)) ? Number(item.viewport.height) : null,
      devicePixelRatio: Number.isFinite(Number(item.viewport.devicePixelRatio)) ? Number(item.viewport.devicePixelRatio) : null
    } : null,
    captureMethod: String(item?.captureMethod || "").slice(0, 120),
    sourceCanvasIndex: Number.isInteger(Number(item?.sourceCanvasIndex)) ? Number(item.sourceCanvasIndex) : null,
    sourceCanvasVisibleRatio: Number.isFinite(Number(item?.sourceCanvasVisibleRatio)) ? Number(item.sourceCanvasVisibleRatio) : null,
    width: Number.isFinite(Number(item?.width)) ? Number(item.width) : null,
    height: Number.isFinite(Number(item?.height)) ? Number(item.height) : null,
    perceptualHash: /^[0-9a-f]{8,64}$/i.test(String(item?.perceptualHash || "")) ? String(item.perceptualHash).toLowerCase() : ""
  };
  if (base.status !== "ok") return base;
  const payload = embeddedImagePayload(item?.dataUrl);
  if (!payload) return { ...base, status: "unavailable:invalid-or-oversized-image" };
  const filePath = path.join(folder, `${id}${payload.extension}`);
  await fs.writeFile(filePath, payload.bytes);
  return {
    ...base,
    status: "ok",
    mediaType: payload.mediaType,
    fileSize: payload.bytes.length,
    contentHash: sha1Bytes(payload.bytes, 32),
    localPath: toPosix(path.relative(REPO_ROOT, filePath))
  };
}

async function extractScrollTargetVisualObservation(probe, outputRoot) {
  const rawScreenshots = Array.isArray(probe?.scroll_target_screenshots)
    ? probe.scroll_target_screenshots.slice(0, MAX_EMBEDDED_VISUAL_CAPTURES)
    : [];
  const rawContactSheets = Array.isArray(probe?.scroll_target_contact_sheets)
    ? probe.scroll_target_contact_sheets.slice(0, MAX_EMBEDDED_VISUAL_CAPTURES)
    : [];
  if (!rawScreenshots.length && !rawContactSheets.length) return null;

  const root = path.join(outputRoot, "scroll-target-screenshots");
  const framesRoot = path.join(root, "frames");
  const canvasCropsRoot = path.join(root, "canvas-crops");
  const sheetsRoot = path.join(root, "contact-sheets");
  await fs.mkdir(framesRoot, { recursive: true });
  await fs.mkdir(canvasCropsRoot, { recursive: true });
  await fs.mkdir(sheetsRoot, { recursive: true });

  const screenshots = [];
  for (let index = 0; index < rawScreenshots.length; index += 1) {
    const raw = rawScreenshots[index];
    const screenshot = await writeEmbeddedVisualImage(
      raw,
      framesRoot,
      `scroll-target-${String(index + 1).padStart(4, "0")}`
    );
    let canvasCrop = null;
    if (raw?.canvasCrop && typeof raw.canvasCrop === "object") {
      canvasCrop = await writeEmbeddedVisualImage({
        ...raw.canvasCrop,
        id: `${raw.id || `scroll-target-${String(index + 1).padStart(4, "0")}`}-canvas`,
        evidenceRef: `${raw.evidenceRef || `visual-scroll-target-${String(index + 1).padStart(4, "0")}`}-canvas`,
        targetIndex: raw.targetIndex,
        targetY: raw.targetY,
        targetKind: raw.targetKind,
        snapshotId: raw.snapshotId,
        scrollPercent: raw.scrollPercent,
        activeText: raw.activeText,
        viewport: raw.viewport
      }, canvasCropsRoot, `scroll-target-${String(index + 1).padStart(4, "0")}-canvas`);
    }
    screenshots.push(canvasCrop ? { ...screenshot, canvasCrop } : screenshot);
  }

  const contactSheets = [];
  for (let index = 0; index < rawContactSheets.length; index += 1) {
    const raw = rawContactSheets[index];
    const written = await writeEmbeddedVisualImage({
      ...raw,
      evidenceRef: raw?.evidenceRef || `visual-contact-sheet-${String(index + 1).padStart(3, "0")}`
    }, sheetsRoot, `scroll-target-contact-sheet-${String(index + 1).padStart(3, "0")}`);
    contactSheets.push({
      ...written,
      screenshotIds: Array.isArray(raw?.screenshotIds)
        ? raw.screenshotIds.map((value) => String(value || "")).filter(Boolean).slice(0, 24)
        : []
    });
  }

  const successfulSheets = contactSheets.filter((item) => item.status === "ok" && item.localPath && item.screenshotIds.length > 0);
  const successfulFrames = screenshots.filter((item) => item.status === "ok" && item.localPath);
  const successfulCanvasCrops = screenshots.map((item) => item.canvasCrop).filter((item) => item?.status === "ok" && item.localPath);
  const attachmentSource = successfulSheets.length ? successfulSheets : successfulFrames;
  const codexAttachments = evenlySample(attachmentSource, MAX_CODEX_IMAGE_ATTACHMENTS).map((item) => ({
    id: item.id,
    evidenceRef: item.evidenceRef,
    kind: successfulSheets.length ? "contact-sheet" : "scroll-target-frame",
    localPath: item.localPath,
    contentHash: item.contentHash
  }));
  const manifestPath = path.join(root, "manifest.json");
  const observation = {
    schemaVersion: "storyvr-scroll-target-visual-observation/v1",
    captureCount: successfulFrames.length,
    failureCount: screenshots.length - successfulFrames.length,
    canvasCropCount: successfulCanvasCrops.length,
    canvasCropFailureCount: screenshots.filter((item) => item.canvasCrop && item.canvasCrop.status !== "ok").length,
    contactSheetCount: successfulSheets.length,
    manifestPath: toPosix(path.relative(REPO_ROOT, manifestPath)),
    screenshots,
    contactSheets,
    codexAttachments
  };
  await writeJson(manifestPath, observation);
  return observation;
}

async function extractVariantStateVisualObservation(probe, outputRoot) {
  const rawScreenshots = Array.isArray(probe?.variant_state_screenshots)
    ? probe.variant_state_screenshots.slice(0, MAX_EMBEDDED_VISUAL_CAPTURES)
    : [];
  if (!rawScreenshots.length) return null;

  const root = path.join(outputRoot, "variant-state-screenshots");
  const framesRoot = path.join(root, "frames");
  const canvasCropsRoot = path.join(root, "canvas-crops");
  await fs.mkdir(framesRoot, { recursive: true });
  await fs.mkdir(canvasCropsRoot, { recursive: true });

  const screenshots = [];
  for (let index = 0; index < rawScreenshots.length; index += 1) {
    const raw = rawScreenshots[index];
    const screenshot = await writeEmbeddedVisualImage(
      raw,
      framesRoot,
      `variant-state-${String(index + 1).padStart(5, "0")}`
    );
    const metadata = {
      groupId: String(raw?.groupId || "").slice(0, 200),
      groupTitle: String(raw?.groupTitle || "").slice(0, 240),
      optionId: String(raw?.optionId || "").slice(0, 200),
      optionLabel: String(raw?.optionLabel || "").slice(0, 240),
      parentGroupId: String(raw?.parentGroupId || "").slice(0, 200),
      parentOptionId: String(raw?.parentOptionId || "").slice(0, 200),
      explorationPhase: String(raw?.explorationPhase || "").slice(0, 80),
      traversalPhase: String(raw?.traversalPhase || raw?.explorationPhase || "").slice(0, 80),
      traversalDirection: String(raw?.traversalDirection || "").slice(0, 40),
      viewportAlignment: String(raw?.viewportAlignment || "").slice(0, 40),
      controlSelector: String(raw?.controlSelector || "").slice(0, 500),
      scrollY: Number.isFinite(Number(raw?.scrollY)) ? Number(raw.scrollY) : null
    };
    let canvasCrop = null;
    if (raw?.canvasCrop && typeof raw.canvasCrop === "object") {
      canvasCrop = await writeEmbeddedVisualImage({
        ...raw.canvasCrop,
        id: `${raw.id || `variant-state-${String(index + 1).padStart(5, "0")}`}-canvas`,
        evidenceRef: `${raw.evidenceRef || `visual-variant-state-${String(index + 1).padStart(5, "0")}`}-canvas`,
        snapshotId: raw.snapshotId,
        scrollPercent: raw.scrollPercent,
        activeText: raw.activeText,
        viewport: raw.viewport
      }, canvasCropsRoot, `variant-state-${String(index + 1).padStart(5, "0")}-canvas`);
    }
    screenshots.push({ ...screenshot, ...metadata, ...(canvasCrop ? { canvasCrop } : {}) });
  }

  const successfulFrames = screenshots.filter((item) => item.status === "ok" && item.localPath);
  const successfulCanvasCrops = screenshots.map((item) => item.canvasCrop).filter((item) => item?.status === "ok" && item.localPath);
  const manifestPath = path.join(root, "manifest.json");
  const observation = {
    schemaVersion: "storyvr-variant-state-visual-observation/v1",
    captureCount: successfulFrames.length,
    failureCount: screenshots.length - successfulFrames.length,
    canvasCropCount: successfulCanvasCrops.length,
    manifestPath: toPosix(path.relative(REPO_ROOT, manifestPath)),
    screenshots
  };
  await writeJson(manifestPath, observation);
  return observation;
}

function storyFolderForProbe(probe, options) {
  const slug = safeSegment(probe.slug || storySlugFromUrl(probe.story_url), "nyt-story").toLowerCase();
  return options.storyFolder
    ? path.resolve(options.storyFolder)
    : path.join(REPO_ROOT, slug);
}

function outputRootForProbe(probe, options) {
  if (options.out) return path.resolve(options.out);
  return path.join(storyFolderForProbe(probe, options), "analysis", "animation-logic-probe", timestampForPath());
}

function canonicalObjectKeys(value) {
  if (Array.isArray(value)) return value.map(canonicalObjectKeys);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = canonicalObjectKeys(value[key]);
  }
  return output;
}

function stableCompare(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function semanticUrlIdentity(value) {
  const text = String(value || "");
  try {
    const url = new URL(text);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(?:utm_.+|cache(?:bust|buster)?|cb|v|ver|version|t|ts|timestamp|_)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    const entries = Array.from(url.searchParams.entries()).sort((left, right) => stableCompare(left[0], right[0]) || stableCompare(left[1], right[1]));
    url.search = "";
    for (const [key, item] of entries) url.searchParams.append(key, item);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return text;
  }
}

function semanticSort(values) {
  return [...values].sort((left, right) => (
    stableCompare(JSON.stringify(canonicalObjectKeys(left)), JSON.stringify(canonicalObjectKeys(right)))
  ));
}

function semanticRound(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function semanticRuntimePart(part) {
  return {
    nodeIndex: Number.isInteger(part?.nodeIndex) ? part.nodeIndex : null,
    nodePath: part?.nodePath || "",
    name: part?.name || "",
    objectType: part?.objectType || "",
    changed: Boolean(part?.changed),
    motionObserved: Boolean(part?.motionObserved),
    transformChanged: Boolean(part?.transformChanged),
    visibilityChanged: Boolean(part?.visibilityChanged),
    opacityChanged: Boolean(part?.opacityChanged),
    runtimeObservationKind: part?.runtimeObservationKind || "",
    changeKind: part?.changeKind || "",
    changeKinds: [...new Set(part?.changeKinds || [])].sort(),
    opacityRange: Array.isArray(part?.opacityRange) ? part.opacityRange.map((value) => semanticRound(value, 3)) : null
  };
}

function semanticRuntimeAction(action) {
  return {
    clipIndex: Number.isInteger(action?.clipIndex) ? action.clipIndex : null,
    clipName: action?.clipName || "",
    embeddedAnimationIndex: Number.isInteger(action?.embeddedAnimationIndex) ? action.embeddedAnimationIndex : null,
    playback: {
      mode: action?.playback?.mode || "unknown",
      mechanism: action?.playback?.mechanism || "",
      confidence: semanticRound(action?.playback?.confidence, 2),
      reasoning: action?.playback?.reasoning || "",
      confounded: Boolean(action?.playback?.confounded),
      source: action?.playback?.source || ""
    },
    targetNodeNames: [...new Set(action?.targetNodeNames || [])].sort(),
    targetPaths: [...new Set(action?.targetPaths || [])].sort(),
    targetParts: semanticSort((action?.targetParts || []).map((part) => ({
      nodeIndex: Number.isInteger(part?.nodeIndex) ? part.nodeIndex : null,
      nodePath: part?.nodePath || "",
      nodeName: part?.nodeName || "",
      matchSource: part?.matchSource || "unknown"
    })))
  };
}

function semanticRuntimeModel(model) {
  return {
    relationshipId: model?.relationshipId || "",
    assetUrl: semanticUrlIdentity(model?.assetUrl),
    assetFile: model?.assetFile || "",
    rootName: model?.rootName || "",
    assetIdentitySource: model?.assetIdentitySource || "unknown",
    renderEligibility: model?.renderEligibility || "unknown",
    playbackMode: model?.playbackMode || "unknown",
    runtimeChanged: Boolean(model?.runtimeChanged),
    modelChanged: Boolean(model?.modelChanged),
    modelSwapped: Boolean(model?.modelSwapped),
    activeModelChanged: Boolean(model?.activeModelChanged),
    newlyPresent: Boolean(model?.newlyPresent),
    becameVisible: Boolean(model?.becameVisible),
    transformChanged: Boolean(model?.transformChanged),
    visibilityChanged: Boolean(model?.visibilityChanged),
    opacityChanged: Boolean(model?.opacityChanged),
    changeKinds: [...new Set(model?.changeKinds || [])].sort(),
    visibleParts: semanticSort((model?.visibleParts || []).map(semanticRuntimePart)),
    partStateChanges: semanticSort((model?.partStateChanges || []).map(semanticRuntimePart)),
    playingAnimations: semanticSort((model?.playingAnimations || []).map(semanticRuntimeAction))
  };
}

function semanticRuntimeCamera(camera) {
  return {
    name: camera?.name || "",
    type: camera?.type || "",
    renderTargetKind: camera?.renderTargetKind || "unknown"
  };
}

function semanticRuntimeBeat(beat) {
  return {
    beatId: beat?.beatId || "",
    text: normalizeActiveText(beat?.text || ""),
    beatSelectors: canonicalObjectKeys(beat?.beatSelectors || {}),
    variantGroupId: beat?.variantGroupId || "",
    variantOptionId: beat?.variantOptionId || "",
    interactionPath: canonicalObjectKeys(beat?.interactionPath || []),
    captureStatus: beat?.captureStatus || "unavailable",
    assetCoverageComplete: Boolean(beat?.assetCoverageComplete),
    truncation: canonicalObjectKeys(beat?.truncation || {}),
    visibleModels: semanticSort((beat?.visibleModels || []).map(semanticRuntimeModel)),
    renderActiveModels: semanticSort((beat?.renderActiveModels || []).map(semanticRuntimeModel)),
    hiddenModels: semanticSort((beat?.observedHiddenModels || []).map((model) => ({
      relationshipId: model?.relationshipId || "",
      assetUrl: semanticUrlIdentity(model?.assetUrl),
      assetFile: model?.assetFile || ""
    }))),
    activeCameras: semanticSort((beat?.activeCameras || []).map(semanticRuntimeCamera)),
    renderActiveCameras: semanticSort((beat?.renderActiveCameras || []).map(semanticRuntimeCamera)),
    cameraStateChanged: Boolean(beat?.cameraStateChanged),
    visualEvidence: (beat?.visualEvidence || []).map((item) => ({
      evidenceRef: item?.evidenceRef || "",
      status: item?.status || "unavailable",
      targetIndex: Number.isInteger(item?.targetIndex) ? item.targetIndex : null,
      targetKind: item?.targetKind || "",
      perceptualHash: item?.perceptualHash || item?.contentHash || "",
      canvasCrop: item?.canvasCrop ? {
        status: item.canvasCrop.status || "unavailable",
        perceptualHash: item.canvasCrop.perceptualHash || item.canvasCrop.contentHash || ""
      } : null
    }))
  };
}

function semanticVisualObservation(evidence) {
  const observation = evidence?.visualObservation;
  if (!observation || !Array.isArray(observation.screenshots)) return null;
  return {
    schemaVersion: observation.schemaVersion || "storyvr-scroll-target-visual-observation/v1",
    captureCount: Number(observation.captureCount || 0),
    failureCount: Number(observation.failureCount || 0),
    screenshots: observation.screenshots.map((item) => ({
      evidenceRef: item?.evidenceRef || "",
      status: item?.status || "unavailable",
      targetIndex: Number.isInteger(item?.targetIndex) ? item.targetIndex : null,
      targetKind: item?.targetKind || "",
      activeText: normalizeActiveText(item?.activeText?.text || ""),
      perceptualHash: item?.perceptualHash || item?.contentHash || "",
      canvasCrop: item?.canvasCrop ? {
        status: item.canvasCrop.status || "unavailable",
        perceptualHash: item.canvasCrop.perceptualHash || item.canvasCrop.contentHash || ""
      } : null
    }))
  };
}

function semanticRelationship(relationship) {
  return {
    id: relationship?.id || "",
    assetUrl: semanticUrlIdentity(relationship?.assetUrl),
    assetFile: relationship?.assetFile || "",
    parseStatus: relationship?.parseStatus || "unknown",
    parseError: relationship?.parseError || "",
    hasEmbeddedAnimation: Boolean(relationship?.hasEmbeddedAnimation),
    hasCameraAnimation: Boolean(relationship?.hasCameraAnimation),
    animations: (relationship?.animations || []).map((animation) => ({
      index: animation.index,
      name: animation.name || "",
      duration: semanticRound(animation.duration, 4),
      targetPaths: [...new Set(animation.targetPaths || [])].sort(),
      targetNodeNames: [...new Set(animation.targetNodeNames || [])].sort(),
      cameraChannelCount: Number(animation.cameraChannelCount || 0)
    })),
    hints: {
      evidenceRefIds: stableStringSet(relationship?.hints?.evidenceRefIds),
      extractedSlidePositions: semanticSort(relationship?.hints?.extractedSlidePositions || []),
      rotateOnScrollValues: semanticSort(relationship?.hints?.rotateOnScrollValues || []),
      scrollDriver: {
        type: relationship?.hints?.scrollDriver?.type || "unknown",
        classificationHint: relationship?.hints?.scrollDriver?.classificationHint || "unknown/needs-review"
      },
      scriptSignals: canonicalObjectKeys(relationship?.hints?.scriptSignals || {}),
      runtimePresence: {
        observationSource: relationship?.hints?.runtimePresence?.observationSource || "unavailable",
        activeTextSequence: (relationship?.hints?.runtimePresence?.activeTextSequence || []).map((item) => ({ text: item.text || "" })),
        activeTextExamples: stableStringSet(relationship?.hints?.runtimePresence?.activeTextExamples)
      },
      runtimePlayback: {
        mode: relationship?.hints?.runtimePlayback?.mode || "unknown",
        modes: stableStringSet(relationship?.hints?.runtimePlayback?.modes),
        source: relationship?.hints?.runtimePlayback?.source || "unavailable"
      }
    }
  };
}

function semanticGlobalSignals(evidence) {
  const signals = evidence?.globalSignals || {};
  const coverage = evidence?.sourceProbe?.captureCoverage || {};
  const coverageAvailable = Boolean(evidence?.sourceProbe?.captureCoverage);
  return {
    downloadedResourcesPresent: (evidence?.downloads || []).length > 0,
    animationApiEvidencePresent: Number(signals.animationApiEvidenceCount || 0) > 0,
    scrollEvidencePresent: Number(signals.scrollEvidenceCount || 0) > 0,
    runtimeControlEvidencePresent: Number(signals.runtimeControlEvidenceCount || 0) > 0,
    modelResourceSequenceChanged: Number(signals.modelSequenceChangeCount || 0) > 0,
    visibleModelSequenceChanged: Number(signals.visibleModelSequenceChangeCount || 0) > 0,
    directRuntime3DAvailable: Number(signals.directRuntime3DSnapshotCount || 0) > 0,
    playingAnimationObserved: Number(signals.directlyObservedPlayingAnimationCount || 0) > 0,
    canvasVisualChanged: Number(signals.canvasVisualChangeCount || 0) > 0,
    scrollTargetVisualEvidenceAvailable: Number(signals.scrollTargetScreenshotCount || 0) > 0,
    scrollTargetVisualCaptureComplete: Number(signals.scrollTargetScreenshotCount || 0) > 0
      && Number(signals.scrollTargetScreenshotFailureCount || 0) === 0,
    captureCoverageAvailable: coverageAvailable,
    captureCoverageComplete: coverageAvailable
      && !coverage.reachedSnapshotLimit
      && !coverage.stoppedEarly
      && Number(coverage.skippedScrollTargetCount || 0) === 0
      && !coverage.variantDependencyTransitionBudgetReached
      && !["stopped", "needs-repair", "incomplete"].includes(String(coverage.recoveryStatus || ""))
  };
}

function judgmentSemanticInput(evidence) {
  const downloads = semanticSort((evidence?.downloads || []).map((download) => ({
    url: semanticUrlIdentity(download.url),
    assetType: download.assetType || "",
    fileSize: Number(download.fileSize || 0),
    contentHash: download.contentHash || ""
  })));
  const failedDownloads = semanticSort((evidence?.failedDownloads || []).map((failure) => ({
    url: failure.url || "",
    assetType: failure.assetType || "",
    failureClass: String(failure.message || "").match(/HTTP\s+\d+/i)?.[0]?.toUpperCase()
      || (failure.message === "request_timeout" ? "request_timeout" : "download_error")
  })));
  const sourceEvidence = semanticSort((evidence?.sourceEvidence || []).map((item) => ({
    id: item.id || "",
    sourceType: item.sourceType || "",
    source: /^https?:/i.test(item.source || "") ? semanticUrlIdentity(item.source) : item.source || "",
    keyword: item.keyword || "",
    assetUrl: semanticUrlIdentity(item.assetUrl),
    context: item.context || ""
  })));
  const glbModels = semanticSort((evidence?.glbAnimations?.models || []).map((model) => ({
    parseStatus: model.parseStatus || "unknown",
    parseError: model.parseError || "",
    assetUrl: semanticUrlIdentity(model.assetUrl),
    fileSize: Number(model.fileSize || 0),
    sceneCount: Number(model.sceneCount || 0),
    nodeCount: Number(model.nodeCount || 0),
    meshCount: Number(model.meshCount || 0),
    cameraCount: Number(model.cameraCount || 0),
    nodes: (model.nodes || []).map((node) => ({
      index: node.index,
      name: node.name || "",
      mesh: node.mesh,
      camera: node.camera,
      children: node.children || []
    })),
    animations: (model.animations || []).map((animation) => ({
      index: animation.index,
      name: animation.name || "",
      duration: semanticRound(animation.duration, 4),
      targetPaths: [...new Set(animation.targetPaths || [])].sort(),
      targetNodeNames: [...new Set(animation.targetNodeNames || [])].sort(),
      cameraChannelCount: Number(animation.cameraChannelCount || 0)
    }))
  })));
  const relationships = (evidence?.relationships || []).map(semanticRelationship);
  const assetDiscovery = {
    schemaVersion: evidence?.assetDiscovery?.schemaVersion || "",
    resolvedModelReferences: semanticSort((evidence?.assetDiscovery?.resolvedModelReferences || []).map((reference) => ({
      rawValue: reference.rawValue || "",
      resolvedUrl: semanticUrlIdentity(reference.resolvedUrl),
      resolutionKind: reference.resolutionKind || "",
      baseUrl: semanticUrlIdentity(reference.baseUrl),
      baseModelContext: Boolean(reference.baseModelContext),
      sourceType: reference.sourceType || "",
      baseSource: /^https?:/i.test(reference.baseSource || "") ? semanticUrlIdentity(reference.baseSource) : reference.baseSource || "",
      baseSourceType: reference.baseSourceType || "",
      validation: reference.validation || ""
    }))),
    unresolvedModelReferences: semanticSort((evidence?.assetDiscovery?.unresolvedModelReferences || []).map((reference) => ({
      rawValue: reference.rawValue || "",
      sourceType: reference.sourceType || ""
    })))
  };
  return canonicalObjectKeys({
    promptVersion: CODEX_PROMPT_VERSION,
    judgmentSchemaVersion: JUDGMENT_SCHEMA_VERSION,
    analyzerVersion: VERSION,
    story: {
      url: semanticUrlIdentity(evidence?.story?.url),
      slug: evidence?.story?.slug || "",
      title: evidence?.story?.title || ""
    },
    collector: {
      tool: evidence?.sourceProbe?.collectorTool || "",
      version: evidence?.sourceProbe?.collectorVersion || "",
      visualCaptureSchemaVersion: evidence?.sourceProbe?.viewportCapture?.schemaVersion || "",
      visualCaptureDisplaySurface: evidence?.sourceProbe?.viewportCapture?.displaySurface || ""
    },
    downloads,
    failedDownloads,
    assetDiscovery,
    sourceEvidence,
    glbModels,
    relationships,
    runtimeBeats: (evidence?.runtimeObservation?.beatRuntimeStates || []).map(semanticRuntimeBeat),
    visualObservation: semanticVisualObservation(evidence),
    globalSignals: semanticGlobalSignals(evidence),
    imageAssets: semanticSort((evidence?.imageAssets || []).map((asset) => canonicalObjectKeys(asset))),
    imageRelevance: canonicalObjectKeys(evidence?.imageRelevance || {})
  });
}

function judgmentEvidenceFingerprint(evidence) {
  return sha1Bytes(Buffer.from(JSON.stringify(judgmentSemanticInput(evidence))), 32);
}

function codexJudgmentCachePath(probe, options, fingerprint) {
  const cacheRoot = options.storyFolder || !options.out
    ? path.join(storyFolderForProbe(probe, options), "analysis", "animation-logic-probe", ".codex-judgment-cache")
    : path.join(path.resolve(options.out), ".codex-judgment-cache");
  return path.join(cacheRoot, safeSegment(CODEX_PROMPT_VERSION, "prompt"), `${fingerprint}.json`);
}

function normalizedAssetTypeHint(value, url = "") {
  const hint = String(value || "").toLowerCase();
  if (/model|glb|gltf/.test(hint)) return "model";
  if (/script|javascript|\bjs\b/.test(hint)) return "script";
  if (/data|json|csv|geojson|topojson/.test(hint)) return "data";
  if (/image|texture|photo/.test(hint)) return "image";
  const classified = classifyUrl(url);
  return classified !== "other" ? classified : "";
}

function pushUrl(urls, rawUrl, baseUrl = "", assetTypeHint = "") {
  const normalized = normalizeUrl(rawUrl, baseUrl);
  const normalizedHint = normalizedAssetTypeHint(assetTypeHint, normalized);
  if (normalized && (isDownloadCandidate(normalized) || normalizedHint)) {
    const previous = urls.get(normalized);
    urls.set(normalized, previous || normalizedHint || classifyUrl(normalized));
  }
}

function pushImageUrl(urls, rawUrl, baseUrl = "") {
  const normalized = normalizeUrl(rawUrl, baseUrl);
  if (normalized && IMAGE_EXTENSIONS.has(urlExtension(normalized))) urls.set(normalized, "image");
}

function isAbsoluteWebReference(value) {
  return /^(?:https?:)?\/\//i.test(cleanCandidateString(value));
}

function extractAssetReferencesFromText(text) {
  const references = [];
  const seen = new Set();
  const source = String(text || "");
  const quotedAssetPattern = /["'`]([^"'`<>]+?\.(?:glb|gltf|js|mjs|cjs|json|csv|geojson|topojson)(?:\?[^"'`<>]*)?)["'`]/gi;
  let match;
  while ((match = quotedAssetPattern.exec(source))) {
    const rawValue = cleanCandidateString(match[1]);
    if (!rawValue || seen.has(rawValue)) continue;
    const classifiedUrl = normalizeUrl(rawValue, "https://storyvr.invalid/");
    const assetType = normalizedAssetTypeHint("", classifiedUrl || rawValue);
    if (!assetType) continue;
    seen.add(rawValue);
    references.push({ rawValue, assetType, index: match.index });
  }
  return references;
}

function extractUrlsFromText(text, baseUrl = "", options = {}) {
  const urls = new Map();
  const source = String(text || "");
  const absolutePattern = /https?:\\?\/\\?\/[^\s"'`<>\\]+/gi;
  let match;
  while ((match = absolutePattern.exec(source))) pushUrl(urls, match[0], baseUrl);
  for (const reference of extractAssetReferencesFromText(source)) {
    if (options.absoluteOnly && !isAbsoluteWebReference(reference.rawValue)) continue;
    pushUrl(urls, reference.rawValue, baseUrl, reference.assetType);
  }
  return Array.from(urls.keys());
}

function probeDiscoveryTextSources(probe) {
  const storyUrl = probe?.story_url || "";
  const sources = [];
  const seen = new Set();
  const add = (text, metadata = {}) => {
    const value = String(text || "");
    if (!value) return;
    const key = `${metadata.sourceType || ""}:${metadata.source || ""}:${sha1(value, 16)}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      text: value,
      sourceType: metadata.sourceType || "probe-text",
      source: metadata.source || "probe-text",
      sourceUrl: metadata.sourceUrl || storyUrl
    });
  };

  for (const script of Array.isArray(probe?.scripts) ? probe.scripts : []) {
    const source = script?.src || `inline_script_${script?.index ?? sources.length}`;
    add(script?.text, {
      sourceType: script?.src ? "external-script-capture" : "inline-script",
      source,
      sourceUrl: script?.src || storyUrl
    });
    for (const window of Array.isArray(script?.keywordWindows) ? script.keywordWindows : []) {
      add(window?.context, {
        sourceType: script?.src ? "external-script-window" : "inline-script-window",
        source,
        sourceUrl: script?.src || storyUrl
      });
    }
  }

  for (const item of Array.isArray(probe?.data_params) ? probe.data_params : []) {
    const source = `${item?.attribute || "data-param"}:${item?.id ?? item?.index ?? sources.length}`;
    add(item?.text, { sourceType: "dom-data-param", source, sourceUrl: storyUrl });
    for (const window of Array.isArray(item?.keywordWindows) ? item.keywordWindows : []) {
      add(window?.context, { sourceType: "dom-data-param-window", source, sourceUrl: storyUrl });
    }
  }

  for (const window of Array.isArray(probe?.page_keyword_windows) ? probe.page_keyword_windows : []) {
    add(window?.context, { sourceType: "page-html-window", source: "page_html", sourceUrl: storyUrl });
  }

  return sources;
}

function downloadedDiscoveryTextSources(downloads) {
  return (Array.isArray(downloads) ? downloads : [])
    .filter((download) => ["script", "data"].includes(download?.assetType))
    .filter((download) => Number(download?.fileSize || 0) <= TEXT_SCAN_LIMIT_BYTES)
    .map((download) => ({
      text: download.bytes.toString("utf8"),
      sourceType: `downloaded-${download.assetType}`,
      source: download.url,
      sourceUrl: download.finalUrl || download.url
    }));
}

function modelReferencesFromTextSources(sources) {
  const references = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    for (const reference of extractAssetReferencesFromText(source?.text || "")) {
      if (reference.assetType !== "model" || isAbsoluteWebReference(reference.rawValue)) continue;
      const key = reference.rawValue;
      const existing = references.get(key);
      if (existing) {
        existing.sources.push({
          sourceType: source.sourceType,
          source: source.source,
          sourceUrl: source.sourceUrl
        });
        continue;
      }
      references.set(key, {
        rawValue: reference.rawValue,
        assetType: "model",
        sourceType: source.sourceType,
        source: source.source,
        sourceUrl: source.sourceUrl,
        sources: [{
          sourceType: source.sourceType,
          source: source.source,
          sourceUrl: source.sourceUrl
        }]
      });
    }
  }
  return Array.from(references.values()).sort((a, b) => stableCompare(a.rawValue, b.rawValue));
}

function assetBaseCandidatesFromTextSources(sources, storyUrl = "") {
  const bases = new Map();
  const add = (rawUrl, kind, rank, source, context = "") => {
    const url = normalizeUrl(rawUrl, source?.sourceUrl || storyUrl);
    if (!url || !url.endsWith("/")) return;
    const modelContext = /\b(?:model|models|gltf|glb|scene|mesh|src_mobile)\b/i.test(context);
    const candidate = {
      url,
      kind,
      rank: rank + (modelContext ? -10 : 0),
      modelContext,
      sourceType: source?.sourceType || "",
      source: source?.source || "",
      sourceUrl: source?.sourceUrl || storyUrl
    };
    const existing = bases.get(url);
    if (!existing || candidate.rank < existing.rank) bases.set(url, candidate);
  };

  const patterns = [
    {
      kind: "template-prefix",
      rank: 0,
      regex: /((?:https?:)?\/\/[^\s"'`<>$\\]+\/)(?=\$\{)/gi
    },
    {
      kind: "string-concat-prefix",
      rank: 0,
      regex: /["'`]((?:https?:)?\/\/[^\s"'`<>\\]+\/)["'`]\s*\+/gi
    },
    {
      kind: "new-url-base",
      rank: 0,
      regex: /new\s+URL\s*\(\s*[^,]+,\s*["'`]((?:https?:)?\/\/[^\s"'`<>\\]+\/)["'`]\s*\)/gi
    },
    {
      kind: "directory-literal",
      rank: 4,
      regex: /["'`]((?:https?:)?\/\/[^\s"'`<>?#\\]+\/)["'`]/gi
    }
  ];

  for (const source of Array.isArray(sources) ? sources : []) {
    const text = String(source?.text || "").replace(/\\\//g, "/");
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(text))) {
        const context = text.slice(Math.max(0, match.index - 180), Math.min(text.length, pattern.regex.lastIndex + 260));
        add(match[1], pattern.kind, pattern.rank, source, context);
      }
    }
  }

  return Array.from(bases.values()).sort((a, b) => a.rank - b.rank || stableCompare(a.url, b.url));
}

function modelResolutionCandidates(reference, bases, storyUrl = "") {
  const candidates = new Map();
  const sourceUrls = new Set((reference?.sources || []).map((source) => source?.sourceUrl).filter(Boolean));
  if (reference?.sourceUrl) sourceUrls.add(reference.sourceUrl);
  const add = (rawValue, baseUrl, resolutionKind, rank, base = null) => {
    const url = normalizeUrl(rawValue, baseUrl);
    if (!url || normalizedAssetTypeHint("", url) !== "model") return;
    const candidate = {
      url,
      assetType: "model",
      rawValue: reference.rawValue,
      source: reference.source,
      sourceType: reference.sourceType,
      resolutionKind,
      resolutionRank: rank,
      baseUrl: base?.url || baseUrl,
      baseModelContext: Boolean(base?.modelContext),
      baseSource: base?.source || "",
      baseSourceType: base?.sourceType || ""
    };
    const existing = candidates.get(url);
    if (!existing || candidate.resolutionRank < existing.resolutionRank) candidates.set(url, candidate);
  };

  for (const base of Array.isArray(bases) ? bases : []) {
    const sameSource = sourceUrls.has(base.sourceUrl) || sourceUrls.has(base.source);
    add(reference.rawValue, base.url, base.kind, base.rank + (sameSource ? 0 : 1), base);
  }
  for (const sourceUrl of sourceUrls) {
    add(reference.rawValue, sourceUrl, "source-relative-fallback", 20);
  }
  if (storyUrl) add(reference.rawValue, storyUrl, "story-relative-fallback", 30);

  return Array.from(candidates.values())
    .sort((a, b) => a.resolutionRank - b.resolutionRank || stableCompare(a.url, b.url))
    .slice(0, MAX_MODEL_RESOLUTION_CANDIDATES);
}

function discoverCandidateRecords(probe) {
  const urls = new Map();
  const storyUrl = probe.story_url || "";
  const arrays = [
    probe.candidate_resources,
    probe.resource_entries,
    probe.dom_asset_references,
    probe.storyvr_author_input?.asset_candidates
  ];

  for (const entries of arrays) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      pushUrl(urls, entry?.url || entry?.name || entry?.asset_url, storyUrl, entry?.assetType || entry?.asset_type || entry?.type);
    }
  }

  for (const scriptUrl of Array.isArray(probe.script_src_urls) ? probe.script_src_urls : []) {
    pushUrl(urls, scriptUrl, storyUrl, "script");
  }

  for (const script of Array.isArray(probe.scripts) ? probe.scripts : []) {
    pushUrl(urls, script?.src, storyUrl, "script");
    for (const window of Array.isArray(script?.keywordWindows) ? script.keywordWindows : []) {
      for (const url of extractUrlsFromText(window.context, storyUrl, { absoluteOnly: true })) pushUrl(urls, url, storyUrl);
    }
    for (const url of extractUrlsFromText(script?.text || "", storyUrl, { absoluteOnly: true })) pushUrl(urls, url, storyUrl);
  }

  for (const item of Array.isArray(probe.data_params) ? probe.data_params : []) {
    for (const url of extractUrlsFromText(item.text || "", storyUrl, { absoluteOnly: true })) pushUrl(urls, url, storyUrl);
    for (const window of Array.isArray(item.keywordWindows) ? item.keywordWindows : []) {
      for (const url of extractUrlsFromText(window.context, storyUrl, { absoluteOnly: true })) pushUrl(urls, url, storyUrl);
    }
  }

  for (const window of Array.isArray(probe.page_keyword_windows) ? probe.page_keyword_windows : []) {
    for (const url of extractUrlsFromText(window.context, storyUrl, { absoluteOnly: true })) pushUrl(urls, url, storyUrl);
  }

  for (const snapshot of Array.isArray(probe.snapshots) ? probe.snapshots : []) {
    for (const key of ["modelUrls", "scriptUrls", "dataUrls"]) {
      const hint = key === "modelUrls" ? "model" : key === "scriptUrls" ? "script" : "data";
      for (const url of Array.isArray(snapshot[key]) ? snapshot[key] : []) pushUrl(urls, url, storyUrl, hint);
    }
    const runtime3D = snapshot.runtime3D || snapshot.runtime3d;
    for (const model of Array.isArray(runtime3D?.models) ? runtime3D.models : []) {
      pushUrl(urls, model?.assetUrl, storyUrl, "model");
    }
  }

  for (const group of authorInputImageGroupsFromProbe(probe)) {
    for (const url of imageGroupUrls(group)) pushImageUrl(urls, url, storyUrl);
  }

  return Array.from(urls, ([url, assetType]) => ({ url, assetType: assetType || classifyUrl(url) })).sort((a, b) => {
    const typeOrder = { model: 0, script: 1, data: 2, image: 3, other: 4 };
    const order = (typeOrder[a.assetType] ?? 4) - (typeOrder[b.assetType] ?? 4);
    return order || stableCompare(a.url, b.url);
  });
}

function discoverCandidateUrls(probe) {
  return discoverCandidateRecords(probe).map((record) => record.url);
}

async function ensureFolders(outputRoot) {
  await fs.mkdir(outputRoot, { recursive: true });
  for (const dir of ["downloads/models", "downloads/scripts", "downloads/data", "downloads/textures", "downloads/other"]) {
    await fs.mkdir(path.join(outputRoot, dir), { recursive: true });
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": `NYTAnimationLogicProbe/${VERSION} (+local research)`,
        "Accept": "*/*"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function validateDownloadedModelBytes(bytes, url) {
  if (bytes?.subarray(0, 4).toString("utf8") === "glTF") return;
  try {
    const json = JSON.parse(bytes.toString("utf8"));
    if (json && typeof json === "object" && json.asset && (Array.isArray(json.scenes) || Array.isArray(json.nodes))) return;
  } catch {
    // Fall through to the stable validation error below.
  }
  throw new Error(`Downloaded model candidate was not valid GLB or glTF content: ${url}`);
}

async function downloadCandidate(url, outputRoot, options) {
  const assetType = normalizedAssetTypeHint(options.assetTypeHint, url) || classifyUrl(url);
  const folder = assetType === "model" ? "models" : assetType === "script" ? "scripts" : assetType === "data" ? "data" : assetType === "image" ? "textures" : "other";
  const localPath = path.join(outputRoot, "downloads", folder, filenameForUrl(url));
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (assetType === "model") validateDownloadedModelBytes(bytes, url);
  await fs.writeFile(localPath, bytes);
  return {
    url,
    finalUrl: response.url || url,
    localPath,
    assetType,
    contentType: response.headers.get("content-type") || "",
    fileSize: bytes.length,
    bytes,
    discovery: options.discovery || null
  };
}

function modelReferenceBasename(value) {
  try {
    return path.posix.basename(new URL(value, "https://storyvr.invalid/").pathname).toLowerCase();
  } catch {
    return path.posix.basename(String(value || "")).toLowerCase();
  }
}

function directModelForReference(downloads, reference) {
  const basename = modelReferenceBasename(reference?.rawValue);
  if (!basename) return null;
  return (downloads || []).find((download) => (
    download.assetType === "model"
    && modelReferenceBasename(download.finalUrl || download.url) === basename
  )) || null;
}

async function downloadProbeAssets(probe, outputRoot, options) {
  const directCandidates = discoverCandidateRecords(probe);
  const priorityDirectCandidates = directCandidates.filter((candidate) => ["model", "script"].includes(candidate.assetType));
  const deferredDirectCandidates = directCandidates.filter((candidate) => !["model", "script"].includes(candidate.assetType));
  const downloads = [];
  const failedDownloads = [];
  const attemptedUrls = [];
  const visited = new Set();
  const resolvedReferences = new Map();
  let lastReferences = [];
  let lastBases = [];

  const tryCandidate = async (candidate) => {
    const url = candidate?.url;
    if (!url) return null;
    const existing = downloads.find((download) => download.url === url || download.finalUrl === url);
    if (existing) return existing;
    if (visited.has(url) || attemptedUrls.length >= options.maxDownloads) return null;
    visited.add(url);
    attemptedUrls.push(url);
    try {
      const download = await downloadCandidate(url, outputRoot, {
        ...options,
        assetTypeHint: candidate.assetType,
        discovery: candidate.rawValue ? {
          rawValue: candidate.rawValue,
          resolutionKind: candidate.resolutionKind,
          resolutionRank: candidate.resolutionRank,
          baseUrl: candidate.baseUrl,
          baseModelContext: candidate.baseModelContext,
          source: candidate.source,
          sourceType: candidate.sourceType,
          baseSource: candidate.baseSource,
          baseSourceType: candidate.baseSourceType
        } : null
      });
      downloads.push(download);
      if (candidate.rawValue) {
        resolvedReferences.set(candidate.rawValue, {
          rawValue: candidate.rawValue,
          assetType: candidate.assetType,
          resolvedUrl: download.finalUrl || download.url,
          requestedUrl: download.url,
          resolutionKind: candidate.resolutionKind,
          resolutionRank: candidate.resolutionRank,
          baseUrl: candidate.baseUrl,
          baseModelContext: candidate.baseModelContext,
          source: candidate.source,
          sourceType: candidate.sourceType,
          baseSource: candidate.baseSource,
          baseSourceType: candidate.baseSourceType,
          validation: candidate.assetType === "model" ? "glb-or-gltf-content" : "http-success"
        });
      }
      console.log(`Downloaded ${download.assetType}: ${url}`);
      return download;
    } catch (error) {
      failedDownloads.push({
        url,
        assetType: candidate.assetType || classifyUrl(url),
        message: error.name === "AbortError" ? "request_timeout" : error.message,
        ...(candidate.rawValue ? {
          rawValue: candidate.rawValue,
          resolutionKind: candidate.resolutionKind,
          resolutionRank: candidate.resolutionRank,
          baseUrl: candidate.baseUrl,
          source: candidate.source,
          baseSource: candidate.baseSource
        } : {})
      });
      console.warn(`Failed ${url}: ${error.message}`);
      return null;
    }
  };

  const downloadBatch = async (candidates, attemptLimit = options.maxDownloads) => {
    for (const candidate of candidates) {
      if (attemptedUrls.length >= Math.min(options.maxDownloads, attemptLimit)) break;
      await tryCandidate(candidate);
    }
  };

  const resolveDiscoveredModels = async () => {
    for (let pass = 0; pass < MAX_MODEL_RESOLUTION_PASSES; pass += 1) {
      if (attemptedUrls.length >= options.maxDownloads) break;
      const beforeDownloadCount = downloads.length;
      const sources = [
        ...probeDiscoveryTextSources(probe),
        ...downloadedDiscoveryTextSources(downloads)
      ];
      lastReferences = modelReferencesFromTextSources(sources);
      lastBases = assetBaseCandidatesFromTextSources(sources, probe?.story_url || "");

      const exactModelCandidates = new Map();
      for (const source of sources) {
        for (const url of extractUrlsFromText(source.text, source.sourceUrl || probe?.story_url || "", { absoluteOnly: true })) {
          if (normalizedAssetTypeHint("", url) !== "model") continue;
          exactModelCandidates.set(url, { url, assetType: "model" });
        }
      }
      await downloadBatch(Array.from(exactModelCandidates.values()).sort((a, b) => stableCompare(a.url, b.url)));

      for (const reference of lastReferences) {
        if (attemptedUrls.length >= options.maxDownloads) break;
        if (resolvedReferences.has(reference.rawValue)) continue;
        const directModel = directModelForReference(downloads, reference);
        if (directModel) {
          resolvedReferences.set(reference.rawValue, {
            rawValue: reference.rawValue,
            assetType: "model",
            resolvedUrl: directModel.finalUrl || directModel.url,
            requestedUrl: directModel.url,
            resolutionKind: "direct-model-basename-match",
            resolutionRank: -1,
            baseUrl: "",
            source: reference.source,
            sourceType: reference.sourceType,
            baseSource: "",
            baseSourceType: "",
            validation: "glb-or-gltf-content"
          });
          continue;
        }
        for (const candidate of modelResolutionCandidates(reference, lastBases, probe?.story_url || "")) {
          const download = await tryCandidate(candidate);
          if (download) break;
          if (attemptedUrls.length >= options.maxDownloads) break;
        }
      }

      if (downloads.length === beforeDownloadCount) break;
    }
  };

  const resolutionReserve = options.maxDownloads > 0
    ? Math.min(32, Math.max(4, Math.ceil(options.maxDownloads * 0.2)))
    : 0;
  await downloadBatch(priorityDirectCandidates, Math.max(0, options.maxDownloads - resolutionReserve));
  await resolveDiscoveredModels();
  await downloadBatch(deferredDirectCandidates);
  await resolveDiscoveredModels();

  return {
    downloads,
    failedDownloads,
    attemptedUrls,
    assetDiscovery: {
      schemaVersion: "storyvr-asset-discovery/v1",
      directCandidateCount: directCandidates.length,
      attemptedCandidateCount: attemptedUrls.length,
      unresolvedModelReferenceCount: lastReferences.length,
      assetBaseCandidateCount: lastBases.length,
      resolvedModelReferenceCount: resolvedReferences.size,
      resolvedModelReferences: Array.from(resolvedReferences.values()).sort((a, b) => stableCompare(a.rawValue, b.rawValue)),
      unresolvedModelReferences: lastReferences
        .filter((reference) => !resolvedReferences.has(reference.rawValue))
        .map((reference) => ({
          rawValue: reference.rawValue,
          source: reference.source,
          sourceType: reference.sourceType
        }))
    }
  };
}

function parseGlbJsonChunk(buffer, fileLabel = "GLB") {
  if (buffer.length < 20 || buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error(`${fileLabel} is not a GLB file.`);
  }
  const declaredLength = buffer.readUInt32LE(8);
  const totalLength = Math.min(declaredLength || buffer.length, buffer.length);
  let offset = 12;
  while (offset + 8 <= totalLength) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLength > buffer.length) break;
    if (chunkType === 0x4e4f534a) {
      const jsonText = buffer.toString("utf8", offset, offset + chunkLength).replace(/\0+$/g, "").trim();
      return JSON.parse(jsonText);
    }
    offset += chunkLength;
  }
  throw new Error(`No JSON chunk found in ${fileLabel}.`);
}

function parseGltfJsonFromDownload(download) {
  if (download.bytes?.subarray(0, 4).toString("utf8") === "glTF" || urlExtension(download.url) === ".glb" || download.localPath.endsWith(".glb")) {
    return parseGlbJsonChunk(download.bytes, download.localPath);
  }
  return JSON.parse(download.bytes.toString("utf8"));
}

function stableModelParseFailure(error) {
  const message = String(error?.message || "");
  if (/not a GLB file/i.test(message)) return { code: "invalid-glb-header", message: "Downloaded model did not have a valid GLB header." };
  if (/No JSON chunk/i.test(message)) return { code: "missing-glb-json-chunk", message: "Downloaded GLB did not contain a readable JSON chunk." };
  if (/JSON|Unexpected token|position \d+/i.test(message)) return { code: "invalid-gltf-json", message: "Downloaded model metadata was not valid JSON." };
  return { code: "model-parse-error", message: "Downloaded model metadata could not be parsed." };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeGltfJson(json, download) {
  const nodes = (json.nodes ?? []).map((node, index) => ({
    index,
    name: node.name ?? "",
    mesh: Number.isInteger(node.mesh) ? node.mesh : null,
    camera: Number.isInteger(node.camera) ? node.camera : null,
    children: Array.isArray(node.children) ? node.children : []
  }));

  const animations = (json.animations ?? []).map((animation, index) => {
    const channels = (animation.channels ?? []).map((channel, channelIndex) => {
      const sampler = animation.samplers?.[channel.sampler] ?? {};
      const input = json.accessors?.[sampler.input] ?? {};
      const targetNodeIndex = Number.isInteger(channel.target?.node) ? channel.target.node : null;
      const targetNode = targetNodeIndex !== null ? nodes[targetNodeIndex] : null;
      return {
        channelIndex,
        sampler: Number.isInteger(channel.sampler) ? channel.sampler : null,
        targetNodeIndex,
        targetNodeName: targetNode?.name || "",
        targetPath: channel.target?.path || "",
        targetLooksLikeCamera: Boolean(targetNode?.camera !== null && targetNode?.camera !== undefined) || /camera/i.test(targetNode?.name || ""),
        inputMin: Array.isArray(input.min) ? input.min.map(numberOrNull).filter((value) => value !== null) : [],
        inputMax: Array.isArray(input.max) ? input.max.map(numberOrNull).filter((value) => value !== null) : []
      };
    });
    const duration = Math.max(0, ...channels.map((channel) => channel.inputMax?.[0] ?? 0));
    const targetPaths = [...new Set(channels.map((channel) => channel.targetPath).filter(Boolean))].sort();
    const targetNodeNames = [...new Set(channels.map((channel) => channel.targetNodeName).filter(Boolean))].sort();
    return {
      index,
      name: animation.name ?? "",
      channelCount: animation.channels?.length ?? 0,
      samplerCount: animation.samplers?.length ?? 0,
      duration,
      targetPaths,
      targetNodeNames: targetNodeNames.slice(0, 80),
      cameraChannelCount: channels.filter((channel) => channel.targetLooksLikeCamera).length,
      channels: channels.slice(0, 120)
    };
  });

  const animatedTargetPathCounts = {};
  for (const animation of animations) {
    for (const targetPath of animation.targetPaths) {
      animatedTargetPathCounts[targetPath] = (animatedTargetPathCounts[targetPath] || 0) + 1;
    }
  }

  return {
    parseStatus: "ok",
    parseError: "",
    assetUrl: download.url,
    finalUrl: download.finalUrl,
    localPath: toPosix(path.relative(REPO_ROOT, download.localPath)),
    file: path.basename(download.localPath),
    fileSize: download.fileSize,
    contentType: download.contentType,
    sceneCount: json.scenes?.length ?? 0,
    nodeCount: nodes.length,
    meshCount: json.meshes?.length ?? 0,
    materialCount: json.materials?.length ?? 0,
    textureCount: json.textures?.length ?? 0,
    cameraCount: json.cameras?.length ?? 0,
    animationCount: animations.length,
    hasEmbeddedAnimation: animations.length > 0,
    animatedTargetPathCounts,
    hasCameraAnimation: animations.some((animation) => animation.cameraChannelCount > 0),
    nodes: nodes.slice(0, 160),
    animations
  };
}

function hasKeyword(value) {
  const lowered = String(value || "").toLowerCase();
  return KEYWORDS.some((keyword) => lowered.includes(keyword.toLowerCase()));
}

function findKeywordWindows(text, source, maxMatches = 80) {
  const original = String(text || "");
  const lowered = original.toLowerCase();
  const matches = [];
  const seen = new Set();

  for (const keyword of KEYWORDS) {
    const needle = keyword.toLowerCase();
    let offset = 0;
    while (matches.length < maxMatches) {
      const index = lowered.indexOf(needle, offset);
      if (index === -1) break;
      const start = Math.max(0, index - CONTEXT_RADIUS);
      const end = Math.min(original.length, index + needle.length + CONTEXT_RADIUS);
      const context = original.slice(start, end);
      const key = `${source}:${keyword}:${sha1(context, 8)}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({ source, keyword, index, context });
      }
      offset = index + needle.length;
    }
    if (matches.length >= maxMatches) break;
  }

  return matches;
}

function findRuntimeControlWindows(text, source, maxMatches = 24) {
  const original = String(text || "");
  const lowered = original.toLowerCase();
  const matches = [];
  const seen = new Set();

  for (const keyword of RUNTIME_CONTROL_KEYWORDS) {
    const needle = keyword.toLowerCase();
    let offset = 0;
    while (matches.length < maxMatches) {
      const index = lowered.indexOf(needle, offset);
      if (index === -1) break;
      const start = Math.max(0, index - CONTEXT_RADIUS * 2);
      const end = Math.min(original.length, index + needle.length + CONTEXT_RADIUS * 2);
      const context = original.slice(start, end);
      const key = `${source}:runtime-control:${sha1(context, 8)}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({ source, keyword, index, context });
      }
      offset = index + needle.length;
    }
    if (matches.length >= maxMatches) break;
  }

  return matches;
}

function addEvidenceItem(items, item) {
  if (!item?.context || !hasKeyword(item.context)) return;
  if (items.length >= MAX_EVIDENCE_ITEMS) return;
  const normalized = {
    sourceType: item.sourceType || "",
    source: item.source || "",
    keyword: item.keyword || "",
    assetUrl: item.assetUrl || null,
    context: String(item.context).slice(0, 1300)
  };
  normalized.id = `evidence-${sha1(JSON.stringify(canonicalObjectKeys(normalized)), 16)}`;
  if (items.some((existing) => existing.id === normalized.id)) return;
  items.push(normalized);
}

function addProbeTextEvidence(evidence, probe) {
  for (const item of Array.isArray(probe.data_params) ? probe.data_params : []) {
    for (const window of Array.isArray(item.keywordWindows) ? item.keywordWindows : []) {
      addEvidenceItem(evidence, {
        sourceType: "dom_data_param",
        source: `${item.attribute || "data-param"}:${item.id || item.index}`,
        keyword: window.keyword,
        context: window.context
      });
    }
  }

  for (const script of Array.isArray(probe.scripts) ? probe.scripts : []) {
    for (const window of Array.isArray(script.keywordWindows) ? script.keywordWindows : []) {
      addEvidenceItem(evidence, {
        sourceType: script.src ? "external_script_reference" : "inline_script",
        source: script.src || `inline_script_${script.index}`,
        keyword: window.keyword,
        context: window.context
      });
    }
  }

  for (const window of Array.isArray(probe.page_keyword_windows) ? probe.page_keyword_windows : []) {
    addEvidenceItem(evidence, {
      sourceType: "page_html_window",
      source: "page_html",
      keyword: window.keyword,
      context: window.context
    });
  }
}

function addRuntimeControlEvidenceFromProbe(evidence, probe) {
  for (const script of Array.isArray(probe.scripts) ? probe.scripts : []) {
    if (!script.text) continue;
    for (const window of findRuntimeControlWindows(script.text, script.src || `inline_script_${script.index}`, 12)) {
      addEvidenceItem(evidence, {
        sourceType: script.src ? "external_script_runtime_control" : "inline_script_runtime_control",
        source: script.src || `inline_script_${script.index}`,
        keyword: window.keyword,
        context: window.context
      });
    }
  }
}

function buildProbeTextEvidence(probe) {
  const evidence = [];
  addRuntimeControlEvidenceFromProbe(evidence, probe);
  addProbeTextEvidence(evidence, probe);
  return evidence;
}

function addDownloadedRuntimeControlEvidence(evidence, download) {
  if (!["script", "data"].includes(download.assetType)) return;
  if (download.fileSize > TEXT_SCAN_LIMIT_BYTES) return;
  const text = download.bytes.toString("utf8");
  for (const window of findRuntimeControlWindows(text, download.url, 24)) {
    addEvidenceItem(evidence, {
      sourceType: `downloaded_${download.assetType}_runtime_control`,
      source: download.url,
      assetUrl: download.url,
      keyword: window.keyword,
      context: window.context
    });
  }
}

function addDownloadedTextEvidence(evidence, download) {
  if (!["script", "data"].includes(download.assetType)) return;
  if (download.fileSize > TEXT_SCAN_LIMIT_BYTES) return;
  const text = download.bytes.toString("utf8");
  for (const window of findKeywordWindows(text, download.url, 60)) {
    addEvidenceItem(evidence, {
      sourceType: `downloaded_${download.assetType}`,
      source: download.url,
      assetUrl: download.url,
      keyword: window.keyword,
      context: window.context
    });
  }
}

function nullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizedNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRuntimeVector(value, length) {
  if (!Array.isArray(value)) return null;
  const normalized = value.slice(0, length).map((item) => normalizedNumber(item));
  return normalized.length === length && normalized.every((item) => item !== null) ? normalized : null;
}

function normalizeRuntimePart(part, index) {
  if (!part || typeof part !== "object") return null;
  const renderEligible = Boolean(part.renderEligible);
  return {
    nodeId: String(part.nodeId || part.id || `runtime-part-${index + 1}`).slice(0, 240),
    nodeIndex: part.nodeIndex !== null && part.nodeIndex !== undefined && Number.isInteger(Number(part.nodeIndex)) ? Number(part.nodeIndex) : null,
    nodePath: String(part.nodePath || "").slice(0, 800),
    name: String(part.name || "").slice(0, 240),
    objectType: String(part.objectType || part.type || "").slice(0, 120),
    isMesh: Boolean(part.isMesh),
    selfVisible: nullableBoolean(part.selfVisible),
    ancestorVisible: nullableBoolean(part.ancestorVisible),
    effectiveVisible: nullableBoolean(part.effectiveVisible),
    materialVisible: nullableBoolean(part.materialVisible),
    materialOpacity: normalizedNumber(part.materialOpacity),
    layersMatch: nullableBoolean(part.layersMatch),
    renderEligible,
    worldPosition: normalizeRuntimeVector(part.worldPosition, 3),
    worldTransformSignature: String(part.worldTransformSignature || "").slice(0, 80),
    provenance: part.provenance || "direct-runtime"
  };
}

function normalizeRuntimeAction(action, index, mixerId = "") {
  if (!action || typeof action !== "object") return null;
  const enabled = action.enabled !== false;
  const paused = Boolean(action.paused);
  const finished = Boolean(action.finished);
  const effectiveWeight = normalizedNumber(action.effectiveWeight, enabled ? 1 : 0);
  const running = nullableBoolean(action.running);
  const scheduled = nullableBoolean(action.scheduled);
  const playingSignal = running ?? scheduled ?? Boolean(action.playing);
  const playing = Boolean(playingSignal) && enabled && !paused && !finished && effectiveWeight > 0.0001;
  return {
    actionId: String(action.actionId || action.id || `${mixerId || "runtime-mixer"}-action-${index + 1}`).slice(0, 260),
    mixerId: String(action.mixerId || mixerId || "").slice(0, 180),
    clipIndex: action.clipIndex !== null && action.clipIndex !== undefined && Number.isInteger(Number(action.clipIndex)) ? Number(action.clipIndex) : null,
    clipIdentitySource: String(action.clipIdentitySource || "unknown").slice(0, 120),
    clipName: String(action.clipName || action.animationName || action.name || "").slice(0, 260),
    targetNodeNames: Array.from(new Set(Array.isArray(action.targetNodeNames) ? action.targetNodeNames.map((item) => String(item || "").slice(0, 240)).filter(Boolean) : [])).slice(0, 40),
    time: normalizedNumber(action.time),
    duration: normalizedNumber(action.duration),
    enabled,
    paused,
    running,
    scheduled,
    finished,
    playing,
    effectiveWeight,
    effectiveTimeScale: normalizedNumber(action.effectiveTimeScale),
    loop: String(action.loop || "").slice(0, 80),
    repetitions: normalizedNumber(action.repetitions),
    clampWhenFinished: Boolean(action.clampWhenFinished),
    provenance: action.provenance || "direct-runtime"
  };
}

function normalizeRuntimeDriverObservation(driver) {
  if (!driver || typeof driver !== "object") {
    return {
      mode: "unknown",
      mechanism: "unobserved",
      confidence: 0.2,
      reasoning: "No direct runtime driver observation was recorded."
    };
  }
  const allowedModes = new Set(["time-based", "scroll-based", "state-based", "mixed", "unknown"]);
  const normalizeAdvance = (advance) => advance && typeof advance === "object" ? {
    method: String(advance.method || "").slice(0, 80),
    value: normalizedNumber(advance.value),
    elapsedMs: normalizedNumber(advance.elapsedMs),
    scrollY: normalizedNumber(advance.scrollY),
    scrollPercent: normalizedNumber(advance.scrollPercent),
    nearScrollEvent: Boolean(advance.nearScrollEvent)
  } : null;
  return {
    mode: allowedModes.has(driver.mode) ? driver.mode : "unknown",
    mechanism: String(driver.mechanism || "unobserved").slice(0, 120),
    confidence: clampConfidence(driver.confidence, 0.2),
    reasoning: String(driver.reasoning || "").slice(0, 800),
    sampleCount: normalizedNumber(driver.sampleCount, 0),
    updateCallCount: normalizedNumber(driver.updateCallCount, 0),
    setTimeCallCount: normalizedNumber(driver.setTimeCallCount, 0),
    clipActionCallCount: normalizedNumber(driver.clipActionCallCount, 0),
    nearScrollSampleCount: normalizedNumber(driver.nearScrollSampleCount, 0),
    stationarySampleCount: normalizedNumber(driver.stationarySampleCount, 0),
    lastAdvance: normalizeAdvance(driver.lastAdvance),
    recentAdvances: (Array.isArray(driver.recentAdvances) ? driver.recentAdvances : [])
      .map(normalizeAdvance)
      .filter(Boolean)
      .slice(-24)
  };
}

function normalizeRuntimeMixer(mixer, index) {
  if (!mixer || typeof mixer !== "object") return null;
  const mixerId = String(mixer.mixerId || mixer.id || `runtime-mixer-${index + 1}`).slice(0, 180);
  const actionStates = (Array.isArray(mixer.actionStates) ? mixer.actionStates : [])
    .map((action, actionIndex) => normalizeRuntimeAction(action, actionIndex, mixerId))
    .filter(Boolean)
    .slice(0, 120);
  return {
    mixerId,
    rootObjectId: String(mixer.rootObjectId || "").slice(0, 240),
    time: normalizedNumber(mixer.time),
    timeScale: normalizedNumber(mixer.timeScale),
    actionCount: normalizedNumber(mixer.actionCount, actionStates.length),
    actionTruncated: Boolean(mixer.actionTruncated),
    driverObservation: normalizeRuntimeDriverObservation(mixer.driverObservation),
    actionStates,
    playingAnimations: actionStates.filter((action) => action.playing)
  };
}

function normalizeRuntimeModel(model, index) {
  if (!model || typeof model !== "object") return null;
  const mixers = (Array.isArray(model.mixers) ? model.mixers : [])
    .map(normalizeRuntimeMixer)
    .filter(Boolean)
    .slice(0, 24);
  const fallbackActions = (Array.isArray(model.activeAnimations) ? model.activeAnimations : [])
    .map((action, actionIndex) => normalizeRuntimeAction(action, actionIndex))
    .filter((action) => action?.playing);
  const playingAnimations = mixers.length
    ? mixers.flatMap((mixer) => mixer.playingAnimations)
    : fallbackActions;
  const visibleParts = (Array.isArray(model.visibleParts) ? model.visibleParts : [])
    .map(normalizeRuntimePart)
    .filter(Boolean)
    .slice(0, 160);
  const playbackModes = Array.from(new Set(mixers.map((mixer) => mixer.driverObservation.mode).filter((mode) => mode && mode !== "unknown")));
  return {
    runtimeModelId: String(model.runtimeModelId || model.modelId || `runtime-model-${index + 1}`).slice(0, 200),
    rootObjectId: String(model.rootObjectId || model.rootId || "").slice(0, 240),
    rootName: String(model.rootName || "").slice(0, 240),
    assetUrl: String(model.assetUrl || "").slice(0, 2000),
    identitySource: String(model.identitySource || "unknown").slice(0, 120),
    identityConfidence: clampConfidence(model.identityConfidence, 0.2),
    registrationSource: String(model.registrationSource || "").slice(0, 160),
    sceneId: String(model.sceneId || "").slice(0, 180),
    sceneName: String(model.sceneName || "").slice(0, 180),
    sceneObserved: nullableBoolean(model.sceneObserved),
    sceneActive: nullableBoolean(model.sceneActive),
    renderTargetKind: String(model.renderTargetKind || "unknown").slice(0, 80),
    canvasVisible: nullableBoolean(model.canvasVisible),
    canvasVisibleRatio: normalizedNumber(model.canvasVisibleRatio),
    selfVisible: nullableBoolean(model.selfVisible),
    ancestorVisible: nullableBoolean(model.ancestorVisible),
    effectiveVisible: nullableBoolean(model.effectiveVisible),
    structuralRenderEligible: nullableBoolean(model.structuralRenderEligible),
    renderActive: nullableBoolean(model.renderActive),
    visibleOnCanvas: nullableBoolean(model.visibleOnCanvas),
    renderContributionCandidate: nullableBoolean(model.renderContributionCandidate),
    renderEligibility: String(model.renderEligibility || "unknown").slice(0, 120),
    renderEligible: Boolean(model.renderEligible),
    renderablePartCount: normalizedNumber(model.renderablePartCount, 0),
    visiblePartCount: normalizedNumber(model.visiblePartCount, visibleParts.length),
    visiblePartTruncated: Boolean(model.visiblePartTruncated),
    visibleParts,
    mixerCount: normalizedNumber(model.mixerCount, mixers.length),
    mixers,
    activeAnimationCount: playingAnimations.length,
    activeAnimations: playingAnimations,
    playbackMode: model.playbackMode || (playbackModes.length > 1 ? "mixed" : playbackModes[0] || "unknown"),
    provenance: model.provenance || "direct-runtime"
  };
}

function normalizeRuntimeCamera(camera, index) {
  if (!camera || typeof camera !== "object") return null;
  return {
    cameraId: String(camera.cameraId || camera.id || `runtime-camera-${index + 1}`).slice(0, 200),
    sceneId: String(camera.sceneId || "").slice(0, 180),
    name: String(camera.name || "").slice(0, 180),
    type: String(camera.type || "").slice(0, 100),
    position: normalizeRuntimeVector(camera.position, 3),
    quaternion: normalizeRuntimeVector(camera.quaternion, 4),
    fov: normalizedNumber(camera.fov),
    near: normalizedNumber(camera.near),
    far: normalizedNumber(camera.far),
    zoom: normalizedNumber(camera.zoom),
    renderTargetKind: String(camera.renderTargetKind || "unknown").slice(0, 80),
    canvasVisible: nullableBoolean(camera.canvasVisible),
    onCanvasEligible: nullableBoolean(camera.onCanvasEligible),
    provenance: camera.provenance || "direct-runtime"
  };
}

function normalizeRuntime3D(value) {
  if (!value || typeof value !== "object") return null;
  const models = (Array.isArray(value.models) ? value.models : [])
    .map(normalizeRuntimeModel)
    .filter(Boolean)
    .slice(0, 64);
  const activeCameras = (Array.isArray(value.activeCameras) ? value.activeCameras : value.activeCamera ? [value.activeCamera] : [])
    .map(normalizeRuntimeCamera)
    .filter(Boolean)
    .slice(0, 12);
  const unassignedMixers = (Array.isArray(value.unassignedMixers) ? value.unassignedMixers : [])
    .map(normalizeRuntimeMixer)
    .filter(Boolean)
    .slice(0, 24);
  const allowedStatuses = new Set(["ok", "partial", "unavailable"]);
  const captureStatus = allowedStatuses.has(value.captureStatus) ? value.captureStatus : models.length ? "partial" : "unavailable";
  return {
    schemaVersion: String(value.schemaVersion || "storyvr-runtime-3d-observation/v1"),
    captureStatus,
    reason: String(value.reason || "").slice(0, 1000),
    source: String(value.source || "three-runtime-instrumentation").slice(0, 120),
    signature: String(value.signature || "").slice(0, 120),
    capturedAtElapsedMs: normalizedNumber(value.capturedAtElapsedMs),
    renderedFrameAgeMs: normalizedNumber(value.renderedFrameAgeMs),
    capabilities: value.capabilities && typeof value.capabilities === "object" ? value.capabilities : {},
    counts: value.counts && typeof value.counts === "object" ? value.counts : {},
    limitations: Array.isArray(value.limitations) ? value.limitations.map((item) => String(item || "").slice(0, 800)).filter(Boolean).slice(0, 20) : [],
    modelCount: normalizedNumber(value.modelCount, models.length),
    visibleModelCount: normalizedNumber(value.visibleModelCount, models.filter((model) => model.renderEligible).length),
    visiblePartCount: normalizedNumber(value.visiblePartCount, models.reduce((count, model) => count + model.visibleParts.length, 0)),
    actionStateCount: normalizedNumber(value.actionStateCount, models.reduce((count, model) => count + model.mixers.reduce((mixerCount, mixer) => mixerCount + mixer.actionStates.length, 0), 0)),
    modelResourceCount: normalizedNumber(value.modelResourceCount, 0),
    identifiedAssetCount: normalizedNumber(value.identifiedAssetCount, 0),
    directlyIdentifiedAssetCount: normalizedNumber(value.directlyIdentifiedAssetCount, 0),
    assetCoverageComplete: Boolean(value.assetCoverageComplete),
    visiblePartsTruncated: Boolean(value.visiblePartsTruncated),
    actionStatesTruncated: Boolean(value.actionStatesTruncated),
    models,
    unassignedMixers,
    activeCameras
  };
}

function normalizeSnapshot(snapshot, index) {
  const activeTexts = Array.isArray(snapshot.activeTexts)
    ? snapshot.activeTexts.map((item) => ({
      domIndex: Number.isInteger(Number(item.index ?? item.domIndex)) ? Number(item.index ?? item.domIndex) : null,
      text: String(item.text || ""),
      tag: item.tag || "",
      id: item.id || "",
      className: item.className || "",
      dataStep: item.dataStep || "",
      dataSlide: item.dataSlide || "",
      dataScene: item.dataScene || "",
      dataScrollamaIndex: item.dataScrollamaIndex || "",
      selector: item.selector || "",
      ancestorSelectors: Array.isArray(item.ancestorSelectors) ? item.ancestorSelectors.filter(Boolean) : [],
      domOrder: Number.isFinite(Number(item.domOrder)) ? Number(item.domOrder) : null,
      visibleRatio: item.visibleRatio ?? null
    })).filter((item) => item.text || item.id || item.dataStep || item.dataSlide || item.dataScene || item.dataScrollamaIndex)
    : [];

  return {
    id: snapshot.id || `snapshot-${index + 1}`,
    label: snapshot.label || "",
    timestamp: snapshot.timestamp || "",
    elapsedMs: Number.isFinite(Number(snapshot.elapsedMs)) ? Number(snapshot.elapsedMs) : null,
    scrollY: Number.isFinite(Number(snapshot.scrollY)) ? Number(snapshot.scrollY) : null,
    scrollPercent: Number.isFinite(Number(snapshot.scrollPercent)) ? Number(snapshot.scrollPercent) : null,
    scrollTarget: snapshot.scrollTarget && typeof snapshot.scrollTarget === "object" ? {
      index: Number.isInteger(Number(snapshot.scrollTarget.index)) ? Number(snapshot.scrollTarget.index) : null,
      y: Number.isFinite(Number(snapshot.scrollTarget.y)) ? Number(snapshot.scrollTarget.y) : null,
      kind: String(snapshot.scrollTarget.kind || "").slice(0, 80),
      traversalPhase: String(snapshot.scrollTarget.traversalPhase || snapshot.scrollTarget.explorationPhase || snapshot.scrollTarget.phase || "").slice(0, 80),
      traversalDirection: String(snapshot.scrollTarget.traversalDirection || snapshot.scrollTarget.direction || "").slice(0, 40)
    } : null,
    scrollTargetScreenshotId: String(snapshot.scrollTargetScreenshotId || "").slice(0, 160),
    activeTexts: activeTexts.slice(0, 5),
    modelUrls: Array.from(new Set(Array.isArray(snapshot.modelUrls) ? snapshot.modelUrls : [])).sort(),
    canvasHashes: Array.from(new Set(
      (Array.isArray(snapshot.visibleCanvases) ? snapshot.visibleCanvases : [])
        .map((canvas) => canvas.visualHash || canvas.visualHashStatus || "")
        .filter(Boolean)
    )).slice(0, 8),
    runtime3D: normalizeRuntime3D(snapshot.runtime3D || snapshot.runtime3d || null)
  };
}

function runtimeModelIdentityKey(model) {
  const relationshipKey = String(model?.relationshipId || "").toLowerCase();
  const assetKey = normalizeAssetKey(model?.assetUrl);
  const runtimeKey = String(model?.runtimeModelId || model?.rootObjectId || "").toLowerCase();
  return [relationshipKey || assetKey || "unmapped", runtimeKey || assetKey || "unknown-root"].join("|");
}

function assetPathKey(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}`;
  } catch {
    return String(value || "").trim();
  }
}

function runtimeModelMatchesRelationship(model, relationship, relationships = []) {
  if (!model || !relationship) return false;
  const modelUrlKey = normalizeAssetKey(model.assetUrl);
  const relationshipUrlKey = normalizeAssetKey(relationship.assetUrl);
  if (modelUrlKey && relationshipUrlKey && modelUrlKey === relationshipUrlKey) return true;
  if (!modelUrlKey) return false;
  const pathMatches = relationships.filter((candidate) => assetPathKey(model.assetUrl) === assetPathKey(candidate.assetUrl));
  if (pathMatches.length === 1) return pathMatches[0].id === relationship.id;
  const basename = modelBasename(model.assetUrl);
  const matches = relationships.filter((candidate) => modelBasename(candidate.assetUrl) === basename);
  return matches.length === 1 && matches[0].id === relationship.id;
}

function relationshipMatchForRuntimeModel(relationships, model) {
  const exact = relationships.find((relationship) => (
    normalizeAssetKey(model?.assetUrl)
    && normalizeAssetKey(model.assetUrl) === normalizeAssetKey(relationship.assetUrl)
  ));
  if (exact) return { relationship: exact, matchSource: "exact-url" };
  if (!model?.assetUrl) return { relationship: null, matchSource: "unmatched" };
  const pathKey = assetPathKey(model.assetUrl);
  const pathMatches = relationships.filter((relationship) => pathKey && pathKey === assetPathKey(relationship.assetUrl));
  if (pathMatches.length === 1) return { relationship: pathMatches[0], matchSource: "unique-path" };
  const basename = modelBasename(model.assetUrl);
  const matches = relationships.filter((relationship) => modelBasename(relationship.assetUrl) === basename);
  return matches.length === 1
    ? { relationship: matches[0], matchSource: "unique-basename" }
    : { relationship: null, matchSource: "unmatched" };
}

function relationshipForRuntimeModel(relationships, model) {
  return relationshipMatchForRuntimeModel(relationships, model).relationship;
}

function runtimeAssetIdentitySource(model, relationship, matchSource) {
  if (!relationship) return "runtime-root-only";
  if (matchSource === "exact-url" && ["gltf-loader-hook", "object-user-data"].includes(model?.identitySource)) return "direct-runtime";
  if (model?.identitySource === "unknown") return "runtime-root-only";
  return "inferred-runtime";
}

function normalizedVariantInteractionPath(association) {
  const path = (Array.isArray(association?.interactionPath || association?.interaction_path)
    ? (association.interactionPath || association.interaction_path)
    : [])
    .map((item) => ({
      groupId: String(item?.groupId || item?.group_id || "").trim(),
      optionId: String(item?.optionId || item?.option_id || "").trim(),
      optionLabel: cleanStoryText(item?.optionLabel || item?.option_label || "")
    }))
    .filter((item) => item.groupId && item.optionId);
  const parentGroupId = String(association?.parentGroupId || association?.parent_group_id || "").trim();
  const parentOptionId = String(association?.parentOptionId || association?.parent_option_id || "").trim();
  if (parentGroupId && parentOptionId && !path.some((item) => (
    item.groupId === parentGroupId && item.optionId === parentOptionId
  ))) {
    path.unshift({
      groupId: parentGroupId,
      optionId: parentOptionId,
      optionLabel: ""
    });
  }
  const groupId = String(association?.groupId || association?.group_id || "").trim();
  const optionId = String(association?.optionId || association?.option_id || "").trim();
  if (groupId && optionId && !path.some((item) => item.groupId === groupId && item.optionId === optionId)) {
    path.push({
      groupId,
      optionId,
      optionLabel: cleanStoryText(association?.optionLabel || association?.option_label || "")
    });
  }
  return path;
}

function variantContextForAssociation(association) {
  const variantGroupId = String(association?.groupId || association?.group_id || "").trim();
  const variantOptionId = String(association?.optionId || association?.option_id || "").trim();
  if (!variantGroupId || !variantOptionId) return null;
  return {
    variantGroupId,
    variantOptionId,
    interactionPath: normalizedVariantInteractionPath(association)
  };
}

function variantContextSignature(context) {
  const interactionPath = (context?.interactionPath || [])
    .map((item) => `${item.groupId}=${item.optionId}`)
    .join(">");
  return `${context?.variantGroupId || ""}::${context?.variantOptionId || ""}::${interactionPath}`;
}

function buildVariantContextBySnapshotId(probe) {
  const bySnapshotId = new Map();
  for (const association of collectedVariantAssetAssociations(probe)) {
    const context = variantContextForAssociation(association);
    if (!context) continue;
    const snapshotIds = Array.from(new Set([
      ...(Array.isArray(association?.snapshotIds) ? association.snapshotIds : []),
      ...(Array.isArray(association?.snapshot_ids) ? association.snapshot_ids : [])
    ].map((value) => String(value || "").trim()).filter(Boolean)));
    for (const snapshotId of snapshotIds) {
      const contexts = bySnapshotId.get(snapshotId) || [];
      if (!contexts.some((candidate) => variantContextSignature(candidate) === variantContextSignature(context))) {
        contexts.push(context);
        contexts.sort((left, right) => (
          (right.interactionPath?.length || 0) - (left.interactionPath?.length || 0)
          || stableCompare(variantContextSignature(left), variantContextSignature(right))
        ));
      }
      bySnapshotId.set(snapshotId, contexts);
    }
  }
  return bySnapshotId;
}

function primaryVariantContextForSnapshot(snapshot, variantContextsBySnapshotId) {
  if (!(variantContextsBySnapshotId instanceof Map)) return null;
  const contexts = variantContextsBySnapshotId.get(String(snapshot?.id || "")) || [];
  return contexts[0] || null;
}

function beatKeyForSnapshot(snapshot, variantContext = null) {
  const primary = snapshot?.activeTexts?.[0] || {};
  const selectors = [primary.id, primary.dataScene, primary.dataSlide, primary.dataStep, primary.dataScrollamaIndex]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const text = normalizeActiveText(primary.text || "").toLowerCase();
  const semanticFields = [...selectors, text].filter(Boolean);
  const variantSignature = variantContextSignature(variantContext);
  if (variantContext?.variantGroupId && variantContext?.variantOptionId) {
    semanticFields.push(`variant:${variantSignature}`);
  }
  if (!selectors.length && primary.domIndex !== null && primary.domIndex !== undefined) {
    semanticFields.push(`dom-index:${primary.domIndex}`);
  }
  const seed = semanticFields.length
    ? semanticFields.join("|")
    : `${snapshot?.label || snapshot?.id || "snapshot"}|${snapshot?.scrollPercent ?? ""}`;
  return `runtime-beat-${sha1(seed, 10)}`;
}

function playbackObservationForAction(mixer, action) {
  return {
    ...action,
    playback: mixer?.driverObservation || normalizeRuntimeDriverObservation(null)
  };
}

function targetPartsForRuntimeAction(action, visibleParts) {
  const targetNames = Array.from(new Set((action?.targetNodeNames || []).map((name) => String(name || "").toLowerCase()).filter(Boolean)));
  if (!targetNames.length) return [];
  const matches = new Map();
  for (const target of targetNames) {
    const exact = visibleParts.filter((part) => String(part.name || "").toLowerCase() === target);
    const candidates = exact.length
      ? exact
      : visibleParts.filter((part) => String(part.nodePath || "").toLowerCase().includes(target));
    for (const part of candidates) {
      const key = part.nodeId || part.nodePath;
      matches.set(key, {
        nodeId: part.nodeId,
        nodeIndex: part.nodeIndex,
        nodePath: part.nodePath,
        nodeName: part.name,
        objectType: part.objectType,
        visibleAtBeat: Boolean(part.renderEligible),
        matchSource: exact.length === 1
          ? "inferred-runtime-unique-track-name"
          : exact.length > 1
            ? "inferred-runtime-ambiguous-track-name"
            : "inferred-runtime-node-path"
      });
    }
  }
  return Array.from(matches.values());
}

function embeddedAnimationForRuntimeAction(action, relationship) {
  const animations = Array.isArray(relationship?.animations) ? relationship.animations : [];
  const byIndex = Number.isInteger(action?.clipIndex)
    ? animations.find((animation) => animation.index === action.clipIndex)
    : null;
  if (byIndex && action.clipIdentitySource === "gltf-loader-clip-reference") {
    return { animation: byIndex, matchSource: "direct-runtime-clip-index" };
  }
  const byName = animations.filter((animation) => action?.clipName && animation.name === action.clipName);
  if (byName.length === 1) return { animation: byName[0], matchSource: "inferred-source-unique-clip-name" };
  return { animation: null, matchSource: byName.length > 1 ? "unknown-ambiguous-clip-name" : "unknown" };
}

function compactRuntimeModelForBeat(model, relationships, snapshotId) {
  const relationshipMatch = relationshipMatchForRuntimeModel(relationships, model);
  const relationship = relationshipMatch.relationship;
  const actionStates = model.mixers.flatMap((mixer) => (
    mixer.actionStates.map((action) => playbackObservationForAction(mixer, action))
  ));
  const playingAnimations = actionStates.filter((action) => action.playing).map((action) => {
    const embedded = embeddedAnimationForRuntimeAction(action, relationship);
    const targetNodeNames = Array.from(new Set([
      ...(action.targetNodeNames || []),
      ...(embedded.animation?.targetNodeNames || [])
    ]));
    const enriched = {
      ...action,
      embeddedAnimationIndex: embedded.animation?.index ?? null,
      embeddedAnimationMatchSource: embedded.matchSource,
      targetNodeNames,
      targetPaths: embedded.animation?.targetPaths || [],
      snapshotIds: [snapshotId]
    };
    return {
      ...enriched,
      targetParts: targetPartsForRuntimeAction(enriched, model.visibleParts)
    };
  });
  return {
    relationshipId: relationship?.id || "",
    assetUrl: relationship?.assetUrl || model.assetUrl || "",
    assetFile: relationship?.assetFile || modelBasename(model.assetUrl) || "",
    runtimeModelId: model.runtimeModelId,
    rootObjectId: model.rootObjectId,
    rootName: model.rootName,
    assetIdentitySource: runtimeAssetIdentitySource(model, relationship, relationshipMatch.matchSource),
    relationshipMatchSource: relationshipMatch.matchSource,
    identitySource: model.identitySource,
    identityConfidence: model.identityConfidence,
    sceneId: model.sceneId,
    sceneName: model.sceneName,
    sceneObserved: model.sceneObserved,
    sceneActive: model.sceneActive,
    renderTargetKind: model.renderTargetKind,
    canvasVisible: model.canvasVisible,
    canvasVisibleRatio: model.canvasVisibleRatio,
    selfVisible: model.selfVisible,
    ancestorVisible: model.ancestorVisible,
    effectiveVisible: model.effectiveVisible,
    structuralRenderEligible: model.structuralRenderEligible,
    renderActive: model.renderActive,
    visibleOnCanvas: model.visibleOnCanvas,
    renderContributionCandidate: model.renderContributionCandidate,
    renderEligibility: model.renderEligibility,
    renderEligible: model.renderEligible,
    renderablePartCount: model.renderablePartCount,
    visiblePartCount: model.visiblePartCount,
    visiblePartTruncated: model.visiblePartTruncated,
    visibleParts: model.visibleParts.map((part) => ({ ...part, snapshotIds: [snapshotId], visibilitySource: "direct-runtime" })),
    mixerCount: model.mixerCount,
    actionStates,
    actionStatesTruncated: model.mixers.some((mixer) => mixer.actionTruncated),
    playingAnimations,
    playbackMode: model.playbackMode,
    snapshotIds: [snapshotId],
    visibilitySource: "direct-runtime"
  };
}

function runtimeActionSequenceKey(model, action) {
  return [
    runtimeModelIdentityKey(model),
    action.mixerId,
    action.actionId,
    action.clipIndex ?? "",
    action.clipName || ""
  ].join("|");
}

function actionTimeDelta(previous, current) {
  if (!Number.isFinite(previous?.time) || !Number.isFinite(current?.time)) return null;
  let delta = current.time - previous.time;
  const duration = Number(current.duration || previous.duration);
  if (Number.isFinite(duration) && duration > 0 && delta < -duration * 0.5) delta += duration;
  return delta;
}

function inferRuntimePlaybackMode(sequence) {
  const samples = sequence
    .filter((item) => Number.isFinite(item.elapsedMs) && Number.isFinite(item.scrollY) && Number.isFinite(item.action?.time))
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
  let stationaryPairCount = 0;
  let stationaryAdvancingPairCount = 0;
  let movingPairCount = 0;
  let movingAdvancingPairCount = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const scrollDelta = Math.abs(current.scrollY - previous.scrollY);
    const timeDelta = actionTimeDelta(previous.action, current.action);
    if (timeDelta === null) continue;
    if (scrollDelta <= 1) {
      stationaryPairCount += 1;
      if (Math.abs(timeDelta) > 0.002) stationaryAdvancingPairCount += 1;
    } else {
      movingPairCount += 1;
      if (Math.abs(timeDelta) > 0.002) movingAdvancingPairCount += 1;
    }
  }

  const directModes = Array.from(new Set(sequence.map((item) => item.action?.playback?.mode).filter((mode) => mode && mode !== "unknown")));
  const mixerCorroboratesTime = directModes.length === 1 && directModes[0] === "time-based";
  if (stationaryAdvancingPairCount >= 2 || (stationaryAdvancingPairCount >= 1 && mixerCorroboratesTime)) {
    return {
      mode: "time-based",
      confidence: stationaryAdvancingPairCount >= 2 ? 0.92 : 0.76,
      reasoning: stationaryAdvancingPairCount >= 2
        ? "Animation time repeatedly advanced while scroll position remained stationary in direct runtime samples."
        : "Animation time advanced once at stationary scroll and the mixer-level observation independently corroborates frame-time playback.",
      sampleCount: samples.length,
      stationaryPairCount,
      stationaryAdvancingPairCount,
      movingPairCount,
      movingAdvancingPairCount,
      confounded: false,
      source: "direct-runtime-sequence"
    };
  }
  if (movingAdvancingPairCount >= 1 && stationaryPairCount >= 1 && stationaryAdvancingPairCount === 0) {
    return {
      mode: "scroll-based",
      confidence: movingAdvancingPairCount >= 2 ? 0.9 : 0.8,
      reasoning: "Animation time changed across scroll movement and stayed fixed across stationary-scroll control samples.",
      sampleCount: samples.length,
      stationaryPairCount,
      stationaryAdvancingPairCount,
      movingPairCount,
      movingAdvancingPairCount,
      confounded: false,
      source: "direct-runtime-sequence"
    };
  }
  if (directModes.length === 1) {
    return {
      mode: directModes[0],
      confidence: Math.max(...sequence.map((item) => Number(item.action?.playback?.confidence || 0.2))),
      reasoning: sequence.find((item) => item.action?.playback?.mode === directModes[0])?.action?.playback?.reasoning || "Runtime mixer instrumentation supplied the playback mode.",
      sampleCount: samples.length,
      stationaryPairCount,
      stationaryAdvancingPairCount,
      movingPairCount,
      movingAdvancingPairCount,
      confounded: false,
      source: "direct-runtime-mixer"
    };
  }
  return {
    mode: directModes.length > 1 ? "mixed" : "unknown",
    confidence: directModes.length > 1 ? 0.68 : 0.3,
    reasoning: directModes.length > 1
      ? "Direct runtime samples contain more than one playback mode for this action identity."
      : "Scroll and elapsed time were not independently sampled enough to distinguish time-based from scroll-based playback.",
    sampleCount: samples.length,
    stationaryPairCount,
    stationaryAdvancingPairCount,
    movingPairCount,
    movingAdvancingPairCount,
    confounded: movingPairCount > 0 && stationaryPairCount === 0,
    source: "direct-runtime-insufficient"
  };
}

function runtimePlaybackMapForSamples(samples) {
  const sequences = new Map();
  for (const sample of samples) {
    for (const model of sample.visibleModels || []) {
      for (const action of model.playingAnimations || []) {
        const key = runtimeActionSequenceKey(model, action);
        const sequence = sequences.get(key) || [];
        sequence.push({
          snapshotId: sample.snapshotId,
          scrollY: sample.scrollY,
          scrollPercent: sample.scrollPercent,
          elapsedMs: sample.elapsedMs,
          action
        });
        sequences.set(key, sequence);
      }
    }
  }
  return new Map(Array.from(sequences.entries()).map(([key, sequence]) => [key, inferRuntimePlaybackMode(sequence)]));
}

function runtimeVectorsDiffer(left, right, epsilon = 0.0001) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.some((value, index) => Math.abs(Number(value) - Number(right[index])) > epsilon);
}

function mergedRuntimeChangeKinds(...values) {
  return Array.from(new Set(values.flatMap((value) => (
    Array.isArray(value) ? value : [value]
  )).map((value) => String(value || "").trim()).filter(Boolean)));
}

function mergeRuntimeVisibleModels(samples, globalPlayback = new Map()) {
  const models = new Map();
  const actionSequences = new Map();
  for (const sample of samples) {
    for (const model of sample.visibleModels) {
      const key = runtimeModelIdentityKey(model);
      let merged = models.get(key);
      if (!merged) {
        merged = {
          ...model,
          snapshotIds: [],
          visibleParts: [],
          actionStates: [],
          playingAnimations: []
        };
        models.set(key, merged);
      }
      for (const field of [
        "runtimeChanged", "modelChanged", "modelSwapped", "activeModelChanged", "newlyPresent",
        "becameVisible", "transformChanged", "visibilityChanged", "opacityChanged"
      ]) {
        merged[field] = merged[field] === true || model[field] === true;
      }
      merged.changeKinds = mergedRuntimeChangeKinds(merged.changeKinds, model.changeKinds, model.changeKind);
      merged.visiblePartTruncated = Boolean(merged.visiblePartTruncated || model.visiblePartTruncated);
      if (!merged.snapshotIds.includes(sample.snapshotId)) merged.snapshotIds.push(sample.snapshotId);
      const parts = new Map(merged.visibleParts.map((part) => [part.nodeId || part.nodePath, part]));
      for (const part of model.visibleParts) {
        const partKey = part.nodeId || part.nodePath;
        const current = parts.get(partKey) || {
          ...part,
          snapshotIds: [],
          worldPositionSamples: [],
          worldTransformSamples: [],
          materialOpacitySamples: []
        };
        if (!current.snapshotIds.includes(sample.snapshotId)) current.snapshotIds.push(sample.snapshotId);
        if (Array.isArray(part.worldPosition)) {
          current.worldPositionSamples.push({ snapshotId: sample.snapshotId, value: part.worldPosition });
        }
        if (part.worldTransformSignature) {
          current.worldTransformSamples.push({ snapshotId: sample.snapshotId, value: part.worldTransformSignature });
        }
        if (Number.isFinite(part.materialOpacity)) {
          current.materialOpacitySamples.push({ snapshotId: sample.snapshotId, value: part.materialOpacity });
        }
        current.changed = current.changed === true || part.changed === true;
        current.motionObserved = current.motionObserved === true || part.motionObserved === true;
        current.transformChanged = current.transformChanged === true || part.transformChanged === true;
        current.visibilityChanged = current.visibilityChanged === true || part.visibilityChanged === true;
        current.opacityChanged = current.opacityChanged === true || part.opacityChanged === true;
        current.runtimeObservationKind = current.runtimeObservationKind || part.runtimeObservationKind || "";
        current.changeKind = current.changeKind || part.changeKind || "";
        current.changeKinds = mergedRuntimeChangeKinds(current.changeKinds, part.changeKinds, part.changeKind);
        if (Array.isArray(part.opacityRange)) current.opacityRange = [...part.opacityRange];
        parts.set(partKey, current);
      }
      merged.visibleParts = Array.from(parts.values()).slice(0, 160);
      merged.actionStates = model.actionStates;

      for (const action of model.playingAnimations) {
        const sequenceKey = runtimeActionSequenceKey(model, action);
        const sequenceRecord = actionSequences.get(sequenceKey) || { modelKey: key, samples: [] };
        sequenceRecord.samples.push({
          snapshotId: sample.snapshotId,
          scrollY: sample.scrollY,
          scrollPercent: sample.scrollPercent,
          elapsedMs: sample.elapsedMs,
          action
        });
        actionSequences.set(sequenceKey, sequenceRecord);
      }
    }
  }

  for (const merged of models.values()) {
    merged.visibleParts = merged.visibleParts.map((part) => {
      const positions = part.worldPositionSamples || [];
      const transformSignatures = (part.worldTransformSamples || []).map((sample) => sample.value).filter(Boolean);
      const opacities = (part.materialOpacitySamples || []).map((sample) => sample.value);
      const sampledMotionObserved = positions.some((sample, index) => index > 0 && runtimeVectorsDiffer(positions[index - 1].value, sample.value));
      const transformChanged = part.transformChanged === true || new Set(transformSignatures).size > 1;
      const sampledOpacityRange = opacities.length ? [Math.min(...opacities), Math.max(...opacities)] : null;
      const opacityRange = Array.isArray(part.opacityRange) ? part.opacityRange : sampledOpacityRange;
      const motionObserved = part.motionObserved === true || sampledMotionObserved || transformChanged;
      const visibilityChanged = part.visibilityChanged === true
        || (!merged.visiblePartTruncated && part.snapshotIds.length < merged.snapshotIds.length);
      const opacityChanged = part.opacityChanged === true
        || Boolean(sampledOpacityRange && Math.abs(sampledOpacityRange[1] - sampledOpacityRange[0]) > 0.0001);
      const changeKinds = mergedRuntimeChangeKinds(
        part.changeKinds,
        part.changeKind,
        motionObserved ? "part-transform-change" : "",
        visibilityChanged ? "part-visibility-change" : "",
        opacityChanged ? "part-opacity-change" : ""
      );
      const changed = part.changed === true || motionObserved || visibilityChanged || opacityChanged;
      return {
        ...part,
        changed,
        motionObserved,
        transformChanged,
        visibilityChanged,
        opacityChanged,
        opacityRange,
        runtimeObservationKind: part.runtimeObservationKind || (changed ? "direct-runtime-within-beat-change" : ""),
        changeKind: part.changeKind || changeKinds[0] || "",
        changeKinds
      };
    });
    merged.partStateChanges = merged.visibleParts.filter((part) => part.motionObserved || part.opacityChanged || part.visibilityChanged).map((part) => ({
      nodeId: part.nodeId,
      nodeIndex: part.nodeIndex,
      nodePath: part.nodePath,
      name: part.name,
      objectType: part.objectType,
      changed: true,
      motionObserved: part.motionObserved,
      transformChanged: part.transformChanged,
      visibilityChanged: part.visibilityChanged,
      opacityChanged: part.opacityChanged,
      runtimeObservationKind: part.runtimeObservationKind,
      changeKind: part.changeKind,
      changeKinds: part.changeKinds,
      opacityRange: part.opacityRange,
      worldPosition: part.worldPosition,
      materialOpacity: part.materialOpacity,
      renderEligible: part.renderEligible,
      worldPositionSamples: part.worldPositionSamples,
      worldTransformSamples: part.worldTransformSamples,
      materialOpacitySamples: part.materialOpacitySamples,
      snapshotIds: part.snapshotIds,
      provenance: "direct-runtime"
    }));
    const mergedActions = [];
    const mergedKey = runtimeModelIdentityKey(merged);
    for (const sequenceRecord of actionSequences.values()) {
      if (sequenceRecord.modelKey !== mergedKey) continue;
      const sequence = sequenceRecord.samples;
      if (!sequence.length) continue;
      const latest = sequence.at(-1).action;
      const times = sequence.map((item) => item.action.time).filter(Number.isFinite);
      mergedActions.push({
        ...latest,
        snapshotIds: sequence.map((item) => item.snapshotId),
        timeRange: times.length ? [Math.min(...times), Math.max(...times)] : null,
        playback: globalPlayback.get(runtimeActionSequenceKey(merged, latest)) || inferRuntimePlaybackMode(sequence)
      });
    }
    merged.playingAnimations = mergedActions.slice(0, 120);
    const modes = Array.from(new Set(merged.playingAnimations.map((action) => action.playback?.mode).filter((mode) => mode && mode !== "unknown")));
    merged.playbackMode = modes.length > 1 ? "mixed" : modes[0] || merged.playbackMode || "unknown";
  }
  return Array.from(models.values());
}

function runtimeSampleScore(sample) {
  return (sample.captureStatus === "ok" ? 1000 : sample.captureStatus === "partial" ? 500 : 0)
    + sample.visibleModels.length * 100
    + sample.visibleModels.reduce((score, model) => score + model.visibleParts.length * 2 + model.playingAnimations.length * 3, 0);
}

function runtimeCameraStateSignature(camera) {
  return JSON.stringify({
    cameraId: camera?.cameraId || "",
    name: camera?.name || "",
    type: camera?.type || "",
    position: Array.isArray(camera?.position) ? camera.position.map((value) => semanticRound(value, 4)) : null,
    quaternion: Array.isArray(camera?.quaternion) ? camera.quaternion.map((value) => semanticRound(value, 5)) : null,
    fov: semanticRound(camera?.fov, 3),
    zoom: semanticRound(camera?.zoom, 4),
    renderTargetKind: camera?.renderTargetKind || "unknown"
  });
}

function exactRuntimeBoundaryModelIdentity(model) {
  if (model?.assetIdentitySource !== "direct-runtime") return "";
  const relationshipId = String(model?.relationshipId || "").trim();
  const rootObjectId = String(model?.rootObjectId || "").trim();
  const runtimeModelId = String(model?.runtimeModelId || "").trim();
  const stableRuntimeId = rootObjectId
    || (!/^runtime-model-\d+$/i.test(runtimeModelId) ? runtimeModelId : "");
  if (!relationshipId || !stableRuntimeId) return "";
  return `${relationshipId}::${stableRuntimeId}`;
}

function exactRuntimeBoundaryPartIdentity(part) {
  const nodeId = String(part?.nodeId || "").trim();
  if (nodeId && !/^runtime-part-\d+$/i.test(nodeId)) return `node-id:${nodeId}`;
  const nodePath = String(part?.nodePath || "").trim();
  if (nodePath) return `node-path:${nodePath}`;
  if (Number.isInteger(part?.nodeIndex)) return `node-index:${part.nodeIndex}`;
  return "";
}

function runtimeBoundaryCaptureSufficient(sample) {
  return sample?.captureStatus === "ok"
    && sample?.assetCoverageComplete === true
    && sample?.truncation?.visiblePartsTruncated !== true;
}

function runtimeBoundaryPartVisibilityChanged(previousPart, currentPart) {
  for (const field of [
    "selfVisible", "ancestorVisible", "effectiveVisible", "materialVisible", "layersMatch", "renderEligible"
  ]) {
    if (
      typeof previousPart?.[field] === "boolean"
      && typeof currentPart?.[field] === "boolean"
      && previousPart[field] !== currentPart[field]
    ) {
      return true;
    }
  }
  return false;
}

function boundaryPartStateChange(part, changeKinds, previousPart, previousSample, currentSample) {
  const transformChanged = changeKinds.includes("part-transform-change");
  const visibilityChanged = changeKinds.includes("part-visibility-change");
  const opacityChanged = changeKinds.includes("part-opacity-change");
  const opacityValues = [previousPart?.materialOpacity, part?.materialOpacity].filter(Number.isFinite);
  return {
    nodeId: part.nodeId,
    nodeIndex: part.nodeIndex,
    nodePath: part.nodePath,
    name: part.name,
    objectType: part.objectType,
    changed: true,
    motionObserved: transformChanged,
    transformChanged,
    visibilityChanged,
    opacityChanged,
    runtimeObservationKind: "direct-runtime-boundary-change",
    changeKind: changeKinds[0] || "part-state-change",
    changeKinds,
    opacityRange: opacityValues.length ? [Math.min(...opacityValues), Math.max(...opacityValues)] : null,
    worldPosition: part.worldPosition,
    materialOpacity: part.materialOpacity,
    renderEligible: part.renderEligible,
    boundarySnapshotIds: [previousSample.snapshotId, currentSample.snapshotId],
    snapshotIds: [currentSample.snapshotId],
    provenance: "direct-runtime"
  };
}

function annotateRuntimeBoundaryChanges(previousRecord, currentRecord) {
  if (!previousRecord || !currentRecord || previousRecord.beatId === currentRecord.beatId) return;
  const previousSample = previousRecord.sample;
  const currentSample = currentRecord.sample;
  if (!runtimeBoundaryCaptureSufficient(previousSample) || !runtimeBoundaryCaptureSufficient(currentSample)) return;

  const previousModels = new Map((previousSample.visibleModels || []).flatMap((model) => {
    const identity = exactRuntimeBoundaryModelIdentity(model);
    return identity ? [[identity, model]] : [];
  }));
  const currentModels = new Map((currentSample.visibleModels || []).flatMap((model) => {
    const identity = exactRuntimeBoundaryModelIdentity(model);
    return identity ? [[identity, model]] : [];
  }));
  const missingPreviousModels = [...previousModels.entries()]
    .filter(([identity]) => !currentModels.has(identity))
    .map(([, model]) => model);

  for (const [identity, currentModel] of currentModels) {
    const previousModel = previousModels.get(identity);
    if (!previousModel) {
      const modelSwapped = missingPreviousModels.some((model) => (
        model.relationshipId && model.relationshipId !== currentModel.relationshipId
      ));
      currentModel.runtimeChanged = true;
      currentModel.modelChanged = true;
      currentModel.modelSwapped = modelSwapped;
      currentModel.activeModelChanged = true;
      currentModel.newlyPresent = true;
      currentModel.becameVisible = true;
      currentModel.changeKinds = mergedRuntimeChangeKinds(
        currentModel.changeKinds,
        "newly-present",
        modelSwapped ? "model-swap" : ""
      );
      continue;
    }
    if (previousModel.visiblePartTruncated || currentModel.visiblePartTruncated) continue;

    const previousParts = new Map((previousModel.visibleParts || []).flatMap((part) => {
      const partIdentity = exactRuntimeBoundaryPartIdentity(part);
      return partIdentity ? [[partIdentity, part]] : [];
    }));
    const partComparisons = (currentModel.visibleParts || []).flatMap((part) => {
      if (part?.renderEligible !== true) return [];
      const partIdentity = exactRuntimeBoundaryPartIdentity(part);
      if (!partIdentity) return [];
      const previousPart = previousParts.get(partIdentity);
      return [{
        part,
        previousPart,
        transformChanged: Boolean(previousPart) && (
          (
            previousPart.worldTransformSignature
            && part.worldTransformSignature
            && previousPart.worldTransformSignature !== part.worldTransformSignature
          )
          || runtimeVectorsDiffer(previousPart.worldPosition, part.worldPosition)
        ),
        visibilityChanged: !previousPart
          || runtimeBoundaryPartVisibilityChanged(previousPart, part),
        opacityChanged: Boolean(previousPart)
          && Number.isFinite(previousPart.materialOpacity)
          && Number.isFinite(part.materialOpacity)
          && Math.abs(previousPart.materialOpacity - part.materialOpacity) > 0.0001
      }];
    });
    const allRenderablePartsChanged = (field) => (
      partComparisons.length > 0 && partComparisons.every((comparison) => comparison[field])
    );
    // Without an observed root transform, a coherent all-part delta is not safely
    // attributable to individual meshes. Preserve it as a whole-model change.
    const coherentModelTransform = allRenderablePartsChanged("transformChanged");
    const coherentModelVisibility = allRenderablePartsChanged("visibilityChanged");
    const coherentModelOpacity = allRenderablePartsChanged("opacityChanged");
    const modelLevelChangeKinds = mergedRuntimeChangeKinds(
      coherentModelTransform ? "model-transform-change" : "",
      coherentModelVisibility ? "model-visibility-change" : "",
      coherentModelOpacity ? "model-opacity-change" : ""
    );
    const boundaryPartChanges = [];
    for (const comparison of partComparisons) {
      const { part, previousPart } = comparison;
      const transformChanged = comparison.transformChanged && !coherentModelTransform;
      const visibilityChanged = comparison.visibilityChanged && !coherentModelVisibility;
      const opacityChanged = comparison.opacityChanged && !coherentModelOpacity;
      const changeKinds = mergedRuntimeChangeKinds(
        transformChanged ? "part-transform-change" : "",
        visibilityChanged ? "part-visibility-change" : "",
        opacityChanged ? "part-opacity-change" : ""
      );
      if (!changeKinds.length) continue;
      part.changed = true;
      part.motionObserved = transformChanged;
      part.transformChanged = transformChanged;
      part.visibilityChanged = visibilityChanged;
      part.opacityChanged = opacityChanged;
      part.runtimeObservationKind = "direct-runtime-boundary-change";
      part.changeKind = changeKinds[0];
      part.changeKinds = changeKinds;
      if (opacityChanged) {
        part.opacityRange = [
          Math.min(previousPart.materialOpacity, part.materialOpacity),
          Math.max(previousPart.materialOpacity, part.materialOpacity)
        ];
      }
      boundaryPartChanges.push(
        boundaryPartStateChange(part, changeKinds, previousPart, previousSample, currentSample)
      );
    }
    if (!boundaryPartChanges.length && !modelLevelChangeKinds.length) continue;
    currentModel.runtimeChanged = true;
    currentModel.transformChanged = coherentModelTransform
      || boundaryPartChanges.some((part) => part.transformChanged);
    currentModel.visibilityChanged = coherentModelVisibility
      || boundaryPartChanges.some((part) => part.visibilityChanged);
    currentModel.opacityChanged = coherentModelOpacity
      || boundaryPartChanges.some((part) => part.opacityChanged);
    currentModel.changeKinds = mergedRuntimeChangeKinds(
      currentModel.changeKinds,
      modelLevelChangeKinds,
      ...boundaryPartChanges.map((part) => part.changeKinds)
    );
    currentModel.partStateChanges = [
      ...(currentModel.partStateChanges || []),
      ...boundaryPartChanges
    ];
  }
}

function buildBeatRuntimeStates(snapshots, relationships, variantContextsBySnapshotId = null) {
  const groups = new Map();
  let previousBoundaryRecord = null;
  for (const snapshot of snapshots) {
    if (!snapshot.runtime3D) continue;
    const primary = snapshot.activeTexts[0] || {};
    const variantContext = primaryVariantContextForSnapshot(snapshot, variantContextsBySnapshotId);
    const beatId = beatKeyForSnapshot(snapshot, variantContext);
    const visibleModels = snapshot.runtime3D.models
      .filter((model) => model.renderEligible)
      .map((model) => compactRuntimeModelForBeat(model, relationships, snapshot.id));
    const renderActiveModels = snapshot.runtime3D.models
      .filter((model) => !model.renderEligible && model.renderContributionCandidate)
      .map((model) => compactRuntimeModelForBeat(model, relationships, snapshot.id));
    const observedHiddenModels = snapshot.runtime3D.models
      .filter((model) => !model.renderEligible && !model.renderContributionCandidate)
      .map((model) => ({
        relationshipId: relationshipForRuntimeModel(relationships, model)?.id || "",
        assetUrl: relationshipForRuntimeModel(relationships, model)?.assetUrl || model.assetUrl || "",
        assetFile: relationshipForRuntimeModel(relationships, model)?.assetFile || modelBasename(model.assetUrl) || "",
        runtimeModelId: model.runtimeModelId,
        rootObjectId: model.rootObjectId,
        effectiveVisible: model.effectiveVisible,
        renderEligible: false,
        observationSource: "direct-runtime"
      }));
    const sample = {
      snapshotId: snapshot.id,
      label: snapshot.label,
      timestamp: snapshot.timestamp,
      elapsedMs: snapshot.elapsedMs,
      scrollY: snapshot.scrollY,
      scrollPercent: snapshot.scrollPercent,
      captureStatus: snapshot.runtime3D.captureStatus,
      captureReason: snapshot.runtime3D.reason,
      assetCoverageComplete: snapshot.runtime3D.assetCoverageComplete,
      visibleModels,
      renderActiveModels,
      observedHiddenModels,
      activeCameras: snapshot.runtime3D.activeCameras.filter((camera) => camera.onCanvasEligible !== false),
      renderActiveCameras: snapshot.runtime3D.activeCameras.filter((camera) => camera.onCanvasEligible === false),
      unassignedMixers: snapshot.runtime3D.unassignedMixers,
      limitations: snapshot.runtime3D.limitations,
      truncation: {
        visiblePartsTruncated: snapshot.runtime3D.visiblePartsTruncated || visibleModels.some((model) => model.visiblePartTruncated),
        actionStatesTruncated: snapshot.runtime3D.actionStatesTruncated || visibleModels.some((model) => model.actionStatesTruncated)
      },
      provenance: snapshot.runtime3D.captureStatus === "unavailable" ? "unavailable" : "direct-runtime",
      ...(variantContext ? {
        variantGroupId: variantContext.variantGroupId,
        variantOptionId: variantContext.variantOptionId,
        interactionPath: variantContext.interactionPath.map((item) => ({ ...item }))
      } : {})
    };
    const currentBoundaryRecord = { beatId, sample };
    annotateRuntimeBoundaryChanges(previousBoundaryRecord, currentBoundaryRecord);
    previousBoundaryRecord = currentBoundaryRecord;
    let group = groups.get(beatId);
    if (!group) {
      group = {
        beatId,
        text: primary.text || "",
        domOrder: Number.isFinite(Number(primary.domOrder)) ? Number(primary.domOrder) : null,
        beatSelectors: {
          domIndex: primary.domIndex ?? null,
          id: primary.id || "",
          dataStep: primary.dataStep || "",
          dataSlide: primary.dataSlide || "",
          dataScene: primary.dataScene || "",
          dataScrollamaIndex: primary.dataScrollamaIndex || ""
        },
        ...(variantContext ? {
          variantGroupId: variantContext.variantGroupId,
          variantOptionId: variantContext.variantOptionId,
          interactionPath: variantContext.interactionPath.map((item) => ({ ...item }))
        } : {}),
        samples: []
      };
      groups.set(beatId, group);
    }
    group.samples.push(sample);
  }

  const allSamples = Array.from(groups.values()).flatMap((group) => group.samples);
  const globalPlayback = runtimePlaybackMapForSamples(allSamples.map((sample) => ({
    ...sample,
    visibleModels: [...(sample.visibleModels || []), ...(sample.renderActiveModels || [])]
  })));
  return Array.from(groups.values()).map((group) => {
    const fullSamples = group.samples;
    const samples = fullSamples.length <= 24
      ? fullSamples
      : [...fullSamples.slice(0, 12), ...fullSamples.slice(-12)];
    const representative = [...fullSamples].sort((a, b) => runtimeSampleScore(b) - runtimeSampleScore(a))[0];
    const scrollValues = fullSamples.map((sample) => sample.scrollPercent).filter(Number.isFinite);
    const statuses = new Set(fullSamples.map((sample) => sample.captureStatus));
    const captureStatus = statuses.has("ok") ? "ok" : statuses.has("partial") ? "partial" : "unavailable";
    const cameraStateChanged = new Set(fullSamples.map((sample) => JSON.stringify(
      [...(sample.activeCameras || []), ...(sample.renderActiveCameras || [])]
        .map(runtimeCameraStateSignature)
        .sort(stableCompare)
    ))).size > 1;
    return {
      beatId: group.beatId,
      text: group.text,
      domOrder: group.domOrder,
      beatSelectors: group.beatSelectors,
      ...(group.variantGroupId && group.variantOptionId ? {
        variantGroupId: group.variantGroupId,
        variantOptionId: group.variantOptionId,
        interactionPath: (group.interactionPath || []).map((item) => ({ ...item }))
      } : {}),
      snapshotIds: fullSamples.map((sample) => sample.snapshotId).slice(0, 80),
      sampleCount: fullSamples.length,
      scrollRange: scrollValues.length ? [Math.min(...scrollValues), Math.max(...scrollValues)] : null,
      captureStatus,
      assetCoverageComplete: fullSamples.length > 0 && fullSamples.every((sample) => sample.assetCoverageComplete),
      provenance: captureStatus === "unavailable" ? "unavailable" : "direct-runtime",
      representativeSnapshotId: representative?.snapshotId || "",
      visibleModels: mergeRuntimeVisibleModels(fullSamples, globalPlayback),
      renderActiveModels: mergeRuntimeVisibleModels(fullSamples.map((sample) => ({
        ...sample,
        visibleModels: sample.renderActiveModels || []
      })), globalPlayback),
      observedHiddenModels: representative?.observedHiddenModels || [],
      activeCameras: representative?.activeCameras || [],
      renderActiveCameras: representative?.renderActiveCameras || [],
      cameraStateChanged,
      limitations: Array.from(new Set(fullSamples.flatMap((sample) => sample.limitations || []))).slice(0, 20),
      truncation: {
        visiblePartsTruncated: fullSamples.some((sample) => sample.truncation?.visiblePartsTruncated),
        actionStatesTruncated: fullSamples.some((sample) => sample.truncation?.actionStatesTruncated)
      },
      samples
    };
  });
}

function attachVisualEvidenceToBeatStates(beats, visualObservation) {
  if (!visualObservation || !Array.isArray(visualObservation.screenshots)) return beats;
  const bySnapshotId = new Map();
  for (const screenshot of visualObservation.screenshots) {
    if (!screenshot.snapshotId) continue;
    const items = bySnapshotId.get(screenshot.snapshotId) || [];
    items.push({
      id: screenshot.id,
      evidenceRef: screenshot.evidenceRef,
      status: screenshot.status,
      targetIndex: screenshot.targetIndex,
      targetKind: screenshot.targetKind,
      snapshotId: screenshot.snapshotId,
      scrollPercent: screenshot.scrollPercent,
      captureMethod: screenshot.captureMethod,
      perceptualHash: screenshot.perceptualHash,
      contentHash: screenshot.contentHash,
      localPath: screenshot.localPath || "",
      canvasCrop: screenshot.canvasCrop ? {
        evidenceRef: screenshot.canvasCrop.evidenceRef,
        status: screenshot.canvasCrop.status,
        captureMethod: screenshot.canvasCrop.captureMethod,
        perceptualHash: screenshot.canvasCrop.perceptualHash,
        contentHash: screenshot.canvasCrop.contentHash,
        localPath: screenshot.canvasCrop.localPath || ""
      } : null
    });
    bySnapshotId.set(screenshot.snapshotId, items);
  }
  return beats.map((beat) => {
    const visualEvidence = (beat.snapshotIds || []).flatMap((snapshotId) => bySnapshotId.get(snapshotId) || [])
      .sort((left, right) => (left.targetIndex ?? Number.MAX_SAFE_INTEGER) - (right.targetIndex ?? Number.MAX_SAFE_INTEGER)
        || stableCompare(left.id, right.id));
    return visualEvidence.length ? { ...beat, visualEvidence } : beat;
  });
}

function modelBasename(url) {
  try {
    return path.posix.basename(decodeURIComponent(new URL(url).pathname)).toLowerCase();
  } catch {
    return path.basename(String(url || "")).toLowerCase();
  }
}

function urlPathname(value) {
  try {
    return new URL(String(value || "")).pathname;
  } catch {
    return String(value || "");
  }
}

function normalizeAssetKey(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    url.hash = "";
    const sortedParams = Array.from(url.searchParams.entries()).sort((left, right) => (
      stableCompare(left[0], right[0]) || stableCompare(left[1], right[1])
    ));
    url.search = "";
    for (const [key, item] of sortedParams) url.searchParams.append(key, item);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return text.toLowerCase();
  }
}

function contextMentionsModel(context, modelUrl) {
  const lowered = String(context || "").toLowerCase();
  const basename = modelBasename(modelUrl);
  const stem = basename.replace(/\.(glb|gltf)$/i, "");
  return lowered.includes(String(modelUrl || "").toLowerCase()) || lowered.includes(basename) || (stem && lowered.includes(stem));
}

function extractNumericMatches(pattern, text) {
  const matches = [];
  let match;
  while ((match = pattern.exec(text))) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value)) matches.push(value);
  }
  return matches;
}

function uniqueFiniteNumbers(values) {
  return Array.from(new Set(
    values
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value))
  )).sort((a, b) => a - b);
}

function extractNumberList(value) {
  return uniqueFiniteNumbers(String(value || "").match(/-?\d+(?:\.\d+)?/g) || []);
}

function extractSlideIndexValues(text) {
  const source = String(text || "");
  const values = [];
  const patterns = [
    /["']?slide(?:I|i)ndeces["']?\s*[:=]\s*\[([^\]]+)\]/gi,
    /["']?slide(?:I|i)ndices["']?\s*[:=]\s*\[([^\]]+)\]/gi,
    /["']?slide(?:I|i)ndex["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/gi,
    /\.slideIndex\b[^=]*=\s*["']?(-?\d+(?:\.\d+)?)/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      values.push(...extractNumberList(match[1]));
    }
  }

  return uniqueFiniteNumbers(values);
}

function extractWindowIndexValues(text) {
  const source = String(text || "");
  const values = [];
  const patterns = [
    /["']?window(?:I|i)ndex["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/gi,
    /\.windowIndex\b[^=]*=\s*["']?(-?\d+(?:\.\d+)?)/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      values.push(...extractNumberList(match[1]));
    }
  }

  return uniqueFiniteNumbers(values);
}

function hasCaptionStateProgression(captionState) {
  return Boolean(
    captionState
    && (
      captionState.hasCaptionStateProgression
      || Number(captionState.distinctActiveTextCount || 0) > 1
      || Number(captionState.activeTextChangeCount || 0) > 0
    )
  );
}

function scrollDriverClassificationHint(driverType, modelSummary, captionState = {}) {
  const spansCaptionStates = hasCaptionStateProgression(captionState);
  if (driverType === "time-based") {
    return "within-beat-dynamics";
  }
  if (driverType === "local-scroll-window-progress") {
    return spansCaptionStates ? "inter-beat-dynamics" : "within-beat-dynamics";
  }
  if (driverType === "slide-indexed-scroll-transition") {
    return "inter-beat-dynamics";
  }
  if (driverType === "absolute-page-scroll" && modelSummary.hasEmbeddedAnimation) {
    return spansCaptionStates ? "inter-beat-dynamics" : "within-beat-dynamics";
  }
  return "unknown/needs-review";
}

function inferScrollDriver({ combinedText, modelSummary, rotateOnScrollValues, slidePositions, captionState = {} }) {
  const text = String(combinedText || "");
  const slideIndexValues = extractSlideIndexValues(text);
  const windowIndexValues = extractWindowIndexValues(text);
  const nonZeroRotateOnScroll = rotateOnScrollValues.some((value) => {
    const normalized = String(value).trim().toLowerCase();
    return normalized && normalized !== "0" && normalized !== "false" && normalized !== "null";
  });

  const signals = {
    hasGlobalScrollValue: /\b(window\.scrollY|scrollY|scrollTop|pageYOffset|document\.documentElement\.scrollTop|\$\(document\)\.scrollTop\(\))/i.test(text),
    hasLocalVisibilityScroll: /\b(calculateVisibilityForDiv|calculatePercentageOfDivScrolledPast|percentageOfWindowIsScrolled|percentageOfWindowInView|percentageOfSlideTextInView|percentageOfSlideInView|intersectionRatio|getBoundingClientRect)\b/i.test(text),
    hasLocalWindowProgress: /\b(ratioScrolledPast|distanceScrolledPastTopOfWebGLWindow|webglWindow|webGLWindow|g-webgl-window|g-slide-text|g-slide-hotspot|slideText|slideHotspot|windowHeight|offset\(\)\.top|clientHeight)\b/i.test(text),
    hasSlideIndexedState: /\b(slideVals?|slideIndeces|slideIndices|slideIndex|updateSlide|activeClipIndex|nextAnimVals|lastAnimVals|animDurations|g-slide-hotspot)\b/i.test(text) || slideIndexValues.length > 0 || slidePositions.length > 1,
    hasAbsolutePageScrub: /(?:setTime|sourceAnimationTime|animation\.duration|duration)[^;\n]*(?:window\.scrollY|scrollY|scrollTop|pageYOffset|scrollPercent)|(?:window\.scrollY|scrollY|scrollTop|pageYOffset|scrollPercent)[^;\n]*(?:setTime|sourceAnimationTime|animation\.duration|duration)/i.test(text),
    hasAnimationMixerEvidence: /\b(AnimationMixer|clipAction|gltf\.animations|mixer|mixers)\b/i.test(text),
    hasTimeBasedMixerPlayback: /\b(clock\.getDelta|\.getDelta\(\))|\.update\(\s*delta\s*\)|\bclip\.play\(|\bclips\.map\([^)]*\.play\(/i.test(text),
    hasScrollScrubbedAnimation: /\b(percentageOfWindowIsScrolled|nextAnimVals|lastAnimVals|activeClipIndex|animDurations|setWebGLWindowHeights)\b/i.test(text)
      && (/\b(AnimationMixer|clipAction|mixer|mixers)\b/i.test(text) || /\.update\s*\(|\.setTime\s*\(/i.test(text)),
    hasSetTimeScrollScrub: /\.setTime\s*\([^)]*(?:scroll|percentage|ratio|slide|position)|setTime\s*\([^)]*(?:scroll|percentage|ratio|slide|position)/i.test(text),
    hasRotateOnScroll: nonZeroRotateOnScroll,
    hasCaptionStateProgression: hasCaptionStateProgression(captionState),
    slideIndexValues: slideIndexValues.slice(0, 24),
    windowIndexValues: windowIndexValues.slice(0, 24)
  };

  signals.hasScrollScrubbedAnimation = signals.hasScrollScrubbedAnimation || signals.hasSetTimeScrollScrub;

  let type = "unknown";
  let confidence = 0.25;
  let reason = "No strong scroll or playback driver was detected in the collected evidence.";

  if (modelSummary.hasEmbeddedAnimation && signals.hasTimeBasedMixerPlayback && !signals.hasScrollScrubbedAnimation) {
    type = "time-based";
    confidence = 0.74;
    reason = "Embedded GLB clips are advanced by mixer/frame delta after activation, not scrubbed by scroll.";
  } else if (modelSummary.hasEmbeddedAnimation && signals.hasScrollScrubbedAnimation) {
    type = signals.hasSlideIndexedState && (slideIndexValues.length > 0 || slidePositions.length > 1)
      ? "slide-indexed-scroll-transition"
      : "local-scroll-window-progress";
    confidence = signals.hasLocalVisibilityScroll || signals.hasLocalWindowProgress ? 0.78 : 0.68;
    reason = signals.hasCaptionStateProgression
      ? "An embedded GLB animation is scrubbed by local scroll/progress while runtime captions show multiple story states."
      : "An embedded GLB animation is scrubbed by local scroll/progress evidence inside the captured story window.";
  } else if (modelSummary.hasEmbeddedAnimation) {
    type = "time-based";
    confidence = signals.hasTimeBasedMixerPlayback ? 0.74 : signals.hasAnimationMixerEvidence ? 0.54 : 0.46;
    reason = signals.hasTimeBasedMixerPlayback
      ? "Embedded GLB clips are advanced by mixer/frame delta after activation, not scrubbed by scroll."
      : signals.hasAnimationMixerEvidence
        ? "The model has embedded animation and mixer/clip evidence, with no detected scroll-scrub mapping."
        : "The model has embedded animation and no detected scroll-scrub mapping; playback is treated as time-based unless runtime evidence proves otherwise.";
  } else if (signals.hasAbsolutePageScrub && !signals.hasLocalVisibilityScroll && !signals.hasLocalWindowProgress) {
    type = "absolute-page-scroll";
    confidence = 0.66;
    reason = "Animation progress appears to be mapped directly from global page scroll values.";
  } else if (!modelSummary.hasEmbeddedAnimation && signals.hasSlideIndexedState && (slideIndexValues.length > 0 || slidePositions.length > 0)) {
    type = "slide-indexed-scroll-transition";
    confidence = slideIndexValues.length > 1 || slidePositions.length > 1 ? 0.68 : 0.58;
    reason = "The asset appears in slide-indexed state/config evidence rather than as an embedded clip.";
  } else if (signals.hasLocalVisibilityScroll || signals.hasLocalWindowProgress || signals.hasRotateOnScroll) {
    type = "local-scroll-window-progress";
    confidence = signals.hasLocalVisibilityScroll || signals.hasLocalWindowProgress ? 0.62 : 0.52;
    reason = signals.hasCaptionStateProgression
      ? "Scroll behavior is based on local window/element progress and runtime captions show multiple story states."
      : "Scroll behavior is based on local window/element visibility or progress, not an absolute page checkpoint.";
  } else if (signals.hasGlobalScrollValue) {
    type = "absolute-page-scroll";
    confidence = 0.38;
    reason = "Only global scroll value evidence was found; local element mapping was not detected.";
  }

  return {
    type,
    confidence,
    classificationHint: scrollDriverClassificationHint(type, modelSummary, captionState),
    reason,
    signals
  };
}

function isRuntimeControlEvidence(item) {
  return /runtime_control/i.test(item.sourceType || "")
    || /\b(AnimationMixer|clipAction|nextAnimVals|lastAnimVals|activeClipIndex|animDurations|percentageOfWindowIsScrolled|percentageOfWindowInView|percentageOfSlideTextInView|percentageOfSlideInView|calculateVisibilityForDiv|calculatePercentageOfDivScrolledPast|ratioScrolledPast|distanceScrolledPastTopOfWebGLWindow|setWebGLWindowHeights|setTime|clock\.getDelta|updateSlide|slideVals?|slideIndeces|slideIndices|slideIndex|windowIndex|g-slide-text|g-slide-hotspot|g-webgl-window)\b/i.test(`${item.keyword} ${item.context}`);
}

function runtimeControlEvidenceScore(item) {
  const context = `${item.keyword} ${item.context}`;
  let score = 0;
  if (/nextAnimVals|lastAnimVals|activeClipIndex/i.test(context)) score += 8;
  if (/percentageOfWindowIsScrolled|calculatePercentageOfDivScrolledPast/i.test(context)) score += 7;
  if (/calculateVisibilityForDiv|percentageOfWindowInView|percentageOfSlideTextInView|percentageOfSlideInView|ratioScrolledPast|distanceScrolledPastTopOfWebGLWindow/i.test(context)) score += 7;
  if (/clock\.getDelta|\.update\(\s*delta\s*\)|clip\.play\(/i.test(context)) score += 6;
  if (/slideVals?|slideIndeces|slideIndices|slideIndex|updateSlide|g-slide-text|g-slide-hotspot|g-webgl-window/i.test(context)) score += 5;
  if (/mixers?\s*\[|\.update\s*\(|clip\.play/i.test(context)) score += 6;
  if (/gltf\.animations|clipAction|AnimationMixer/i.test(context)) score += 4;
  if (/define\('lib\/webgl-manager'|WebGLManager|updateScrollBasedValues|animate:\s*function/i.test(context)) score += 4;
  if (/function AnimationMixer|exports\.AnimationMixer|PropertyBinding|AnimationClip/i.test(context)) score -= 5;
  return score;
}

function normalizeActiveText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function summarizeCaptionStateProgression(snapshots) {
  const allTexts = [];
  const primarySequence = [];

  for (const snapshot of snapshots) {
    const snapshotTexts = snapshot.activeTexts
      .map((item) => normalizeActiveText(item.text))
      .filter(Boolean);
    allTexts.push(...snapshotTexts);

    const primaryText = snapshotTexts[0] || "";
    if (primaryText && primarySequence.at(-1)?.text !== primaryText) {
      primarySequence.push({
        text: primaryText,
        scrollPercent: snapshot.scrollPercent
      });
    }
  }

  const distinctTexts = Array.from(new Set(allTexts));
  const activeTextChangeCount = Math.max(0, primarySequence.length - 1);

  return {
    hasCaptionStateProgression: distinctTexts.length > 1 || activeTextChangeCount > 0,
    distinctActiveTextCount: distinctTexts.length,
    activeTextChangeCount,
    activeTextSequence: primarySequence.slice(0, 12),
    activeTextExamples: distinctTexts.slice(0, 8)
  };
}

function directActionPlaybackForModel(modelSummary, snapshots) {
  const sequences = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot.runtime3D) continue;
    for (const model of snapshot.runtime3D.models) {
      if (normalizeAssetKey(model.assetUrl) !== normalizeAssetKey(modelSummary.assetUrl)) continue;
      for (const mixer of model.mixers) {
        for (const action of mixer.playingAnimations) {
          const key = runtimeActionSequenceKey(model, action);
          const sequence = sequences.get(key) || [];
          sequence.push({
            snapshotId: snapshot.id,
            scrollY: snapshot.scrollY,
            scrollPercent: snapshot.scrollPercent,
            elapsedMs: snapshot.elapsedMs,
            action: playbackObservationForAction(mixer, action)
          });
          sequences.set(key, sequence);
        }
      }
    }
  }
  return Array.from(sequences.values()).map(inferRuntimePlaybackMode);
}

function relationshipHintsForModel(modelSummary, sourceEvidence, snapshots) {
  const modelRefs = sourceEvidence
    .filter((item) => contextMentionsModel(item.context, modelSummary.assetUrl))
    .slice(0, 18);
  const runtimeControlRefs = sourceEvidence
    .filter(isRuntimeControlEvidence)
    .sort((a, b) => runtimeControlEvidenceScore(b) - runtimeControlEvidenceScore(a))
    .slice(0, 14);
  const evidenceRefs = [...modelRefs];
  for (const ref of runtimeControlRefs) {
    if (evidenceRefs.length >= 25) break;
    if (!evidenceRefs.some((item) => item.id === ref.id)) evidenceRefs.push(ref);
  }
  const fallbackRefs = evidenceRefs.length
    ? []
    : sourceEvidence.filter((item) => /animation|scroll|settime|clipaction|webgl_data|rotateonscroll/i.test(`${item.keyword} ${item.context}`)).slice(0, 8);
  const refs = evidenceRefs.length ? evidenceRefs : fallbackRefs;
  const combinedText = refs.map((item) => item.context).join("\n");
  const slidePositions = extractNumericMatches(/["']?position["']?\s*[:=]\s*["']?([0-9]*\.?[0-9]+)/gi, combinedText);
  const rotateOnScrollValues = [...combinedText.matchAll(/["']?rotateOnScroll["']?\s*[:=]\s*["']?([^"',}\]\s]+)/gi)].map((match) => match[1]);
  const hasAnimationApi = /\b(AnimationMixer|clipAction|setTime|mixer|timeScale|nextAnimVals|lastAnimVals|activeClipIndex|animDurations)\b/i.test(combinedText);
  const hasScrollApi = /\b(scroll|scrollY|scrollTop|ScrollTrigger|scrollama|intersectionobserver|percentageOfWindowIsScrolled|percentageOfWindowInView|percentageOfSlideTextInView|percentageOfSlideInView|calculateVisibilityForDiv|calculatePercentageOfDivScrolledPast|ratioScrolledPast|distanceScrolledPastTopOfWebGLWindow|scrollEl|scrollPos)\b/i.test(combinedText);
  const hasScrollScrubbedAnimation = /\b(percentageOfWindowIsScrolled|nextAnimVals|lastAnimVals|activeClipIndex|animDurations|setWebGLWindowHeights)\b/i.test(combinedText)
    && (/\b(AnimationMixer|clipAction|mixer|mixers)\b/i.test(combinedText) || /\.update\s*\(/i.test(combinedText));
  const hasWebglData = /\bWEBGL_DATA\b/i.test(combinedText);
  const inventorySnapshots = snapshots.filter((snapshot) => {
    return snapshot.modelUrls.some((url) => url === modelSummary.assetUrl || modelBasename(url) === modelBasename(modelSummary.assetUrl));
  });
  const directRuntimeSnapshots = snapshots.filter((snapshot) => (
    snapshot.runtime3D
    && snapshot.runtime3D.captureStatus !== "unavailable"
    && snapshot.runtime3D.models.some((model) => normalizeAssetKey(model.assetUrl) === normalizeAssetKey(modelSummary.assetUrl))
  ));
  const directVisibleSnapshots = directRuntimeSnapshots.filter((snapshot) => (
    snapshot.runtime3D.models.some((model) => (
      normalizeAssetKey(model.assetUrl) === normalizeAssetKey(modelSummary.assetUrl)
      && model.renderEligible
    ))
  ));
  const directRenderActiveSnapshots = directRuntimeSnapshots.filter((snapshot) => (
    snapshot.runtime3D.models.some((model) => (
      normalizeAssetKey(model.assetUrl) === normalizeAssetKey(modelSummary.assetUrl)
      && model.renderContributionCandidate
    ))
  ));
  const authoritativeRuntimeSnapshots = snapshots.filter((snapshot) => (
    snapshot.runtime3D?.captureStatus === "ok" && snapshot.runtime3D.assetCoverageComplete
  ));
  const runtimeSnapshots = directRuntimeSnapshots.length
    ? directVisibleSnapshots.length
      ? directVisibleSnapshots
      : directRenderActiveSnapshots
    : authoritativeRuntimeSnapshots.length
      ? []
      : inventorySnapshots;
  const captionState = summarizeCaptionStateProgression(runtimeSnapshots);
  let scrollDriver = inferScrollDriver({
    combinedText,
    modelSummary,
    rotateOnScrollValues,
    slidePositions,
    captionState
  });
  const directPlaybackObservations = directRuntimeSnapshots.flatMap((snapshot) => (
    snapshot.runtime3D.models
      .filter((model) => normalizeAssetKey(model.assetUrl) === normalizeAssetKey(modelSummary.assetUrl))
      .flatMap((model) => model.mixers.map((mixer) => mixer.driverObservation))
  ));
  const directActionPlaybackObservations = directActionPlaybackForModel(modelSummary, directRuntimeSnapshots);
  const effectivePlaybackObservations = directActionPlaybackObservations.length
    ? directActionPlaybackObservations
    : directPlaybackObservations;
  const directPlaybackModes = Array.from(new Set(effectivePlaybackObservations.map((item) => item.mode).filter((mode) => mode && mode !== "unknown")));
  const directPlayback = {
    modes: directPlaybackModes,
    mode: directPlaybackModes.length > 1 ? "mixed" : directPlaybackModes[0] || "unknown",
    confidence: effectivePlaybackObservations.length
      ? Math.max(...effectivePlaybackObservations.map((item) => Number(item.confidence || 0.2)))
      : 0,
    observations: effectivePlaybackObservations.slice(0, 20),
    mixerObservations: directPlaybackObservations.slice(0, 20),
    source: effectivePlaybackObservations.length ? "direct-runtime" : "unavailable"
  };
  if (directPlayback.mode === "time-based" && directPlayback.confidence >= 0.7 && scrollDriver.type === "unknown") {
    scrollDriver = {
      ...scrollDriver,
      type: "time-based",
      confidence: directPlayback.confidence,
      classificationHint: "within-beat-dynamics",
      reason: "Direct runtime mixer samples show time-based advancement while source-code subtype evidence is otherwise unknown."
    };
  } else if (directPlayback.mode === "scroll-based" && directPlayback.confidence >= 0.7 && ["unknown", "time-based"].includes(scrollDriver.type)) {
    scrollDriver = {
      ...scrollDriver,
      type: "unknown",
      confidence: Math.min(0.7, directPlayback.confidence),
      classificationHint: hasCaptionStateProgression(captionState) ? "inter-beat-dynamics" : "within-beat-dynamics",
      reason: "Direct runtime samples establish scroll-based advancement, but they do not establish local-window versus absolute-page versus slide-indexed subtype."
    };
  } else if (directPlayback.mode === "mixed") {
    scrollDriver = {
      ...scrollDriver,
      type: "unknown",
      confidence: Math.min(0.68, Math.max(0.4, directPlayback.confidence)),
      classificationHint: "unknown/needs-review",
      reason: "Direct runtime actions use more than one playback mode, so no single model-wide time/scroll driver is asserted."
    };
  } else if (
    effectivePlaybackObservations.length
    && directPlayback.mode === "unknown"
    && scrollDriver.type === "time-based"
    && !scrollDriver.signals.hasTimeBasedMixerPlayback
  ) {
    scrollDriver = {
      ...scrollDriver,
      type: "unknown",
      confidence: Math.min(0.45, Math.max(0.25, directPlayback.confidence)),
      classificationHint: "unknown/needs-review",
      reason: "Direct runtime action samples were confounded or insufficient, and fetched source evidence did not independently prove a frame-time driver."
    };
  }

  const firstRuntime = runtimeSnapshots[0] || null;
  const lastRuntime = runtimeSnapshots.at(-1) || null;

  return {
    evidenceRefIds: refs.map((item) => item.id),
    extractedSlidePositions: Array.from(new Set(slidePositions)).slice(0, 20),
    rotateOnScrollValues: Array.from(new Set(rotateOnScrollValues)).slice(0, 10),
    scrollDriver,
    scriptSignals: {
      hasAnimationApi,
      hasScrollApi,
      hasScrollScrubbedAnimation: hasScrollScrubbedAnimation || scrollDriver.signals.hasScrollScrubbedAnimation,
      hasWebglData,
      hasAnimationMixerEvidence: scrollDriver.signals.hasAnimationMixerEvidence,
      hasTimeBasedMixerPlayback: scrollDriver.signals.hasTimeBasedMixerPlayback,
      hasLocalVisibilityScroll: scrollDriver.signals.hasLocalVisibilityScroll,
      hasLocalWindowProgress: scrollDriver.signals.hasLocalWindowProgress,
      hasSlideIndexedState: scrollDriver.signals.hasSlideIndexedState,
      hasAbsolutePageScrub: scrollDriver.signals.hasAbsolutePageScrub,
      hasCaptionStateProgression: scrollDriver.signals.hasCaptionStateProgression,
      mentionsModelDirectly: modelRefs.length > 0,
      runtimeControlEvidenceRefs: runtimeControlRefs.map((item) => item.id).slice(0, 12)
    },
    runtimePresence: {
      snapshotCount: runtimeSnapshots.length,
      inventorySnapshotCount: inventorySnapshots.length,
      directRuntimeObservedCount: directRuntimeSnapshots.length,
      directVisibleSnapshotCount: directVisibleSnapshots.length,
      directRenderActiveSnapshotCount: directRenderActiveSnapshots.length,
      observationSource: directRuntimeSnapshots.length
        ? directVisibleSnapshots.length
          ? "direct-runtime"
          : directRenderActiveSnapshots.length
            ? "inferred-runtime-offscreen-render"
            : "direct-runtime-observed-hidden"
        : authoritativeRuntimeSnapshots.length
          ? "direct-runtime-observed-absent"
          : inventorySnapshots.length
            ? "resource-inventory"
            : "unavailable",
      firstScrollPercent: firstRuntime?.scrollPercent ?? null,
      lastScrollPercent: lastRuntime?.scrollPercent ?? null,
      distinctActiveTextCount: captionState.distinctActiveTextCount,
      activeTextChangeCount: captionState.activeTextChangeCount,
      activeTextSequence: captionState.activeTextSequence,
      activeTextExamples: captionState.activeTextExamples,
      snapshotIds: runtimeSnapshots.map((snapshot) => snapshot.id).slice(0, 40)
    },
    runtimeVisibility: {
      directlyObserved: directRuntimeSnapshots.length > 0,
      authoritativeCaptureAvailable: authoritativeRuntimeSnapshots.length > 0,
      authoritativeSnapshotIds: authoritativeRuntimeSnapshots.map((snapshot) => snapshot.id).slice(0, 60),
      observedSnapshotCount: directRuntimeSnapshots.length,
      visibleSnapshotCount: directVisibleSnapshots.length,
      visibleSnapshotIds: directVisibleSnapshots.map((snapshot) => snapshot.id).slice(0, 60),
      renderActiveSnapshotIds: directRenderActiveSnapshots.map((snapshot) => snapshot.id).slice(0, 60),
      hiddenSnapshotIds: directRuntimeSnapshots.filter((snapshot) => !directVisibleSnapshots.includes(snapshot)).map((snapshot) => snapshot.id).slice(0, 60),
      source: directRuntimeSnapshots.length ? "direct-runtime" : "unavailable"
    },
    runtimePlayback: directPlayback
  };
}

function sequenceKey(snapshot) {
  return snapshot.modelUrls.map((url) => modelBasename(url)).sort().join("|");
}

function summarizeRuntime(snapshots) {
  const sequence = [];
  for (const snapshot of snapshots) {
    const key = sequenceKey(snapshot);
    if (!key) continue;
    if (sequence.at(-1)?.key === key) continue;
    sequence.push({
      key,
      scrollPercent: snapshot.scrollPercent,
      activeText: snapshot.activeTexts[0]?.text || "",
      modelUrls: snapshot.modelUrls
    });
  }

  const canvasSequence = [];
  for (const snapshot of snapshots) {
    const key = snapshot.canvasHashes.join("|");
    if (!key) continue;
    if (canvasSequence.at(-1)?.key === key) continue;
    canvasSequence.push({
      key,
      scrollPercent: snapshot.scrollPercent,
      activeText: snapshot.activeTexts[0]?.text || ""
    });
  }

  const visibleModelSequence = [];
  const cameraSequence = [];
  const runtime3DStatusCounts = { ok: 0, partial: 0, unavailable: 0, legacyMissing: 0 };
  let directlyObservedPlayingAnimationCount = 0;
  for (const snapshot of snapshots) {
    if (!snapshot.runtime3D) {
      runtime3DStatusCounts.legacyMissing += 1;
      continue;
    }
    const status = snapshot.runtime3D.captureStatus;
    runtime3DStatusCounts[status] = (runtime3DStatusCounts[status] || 0) + 1;
    if (status === "unavailable") continue;
    const visibleModels = snapshot.runtime3D.models.filter((model) => model.renderEligible);
    directlyObservedPlayingAnimationCount += visibleModels.reduce((count, model) => count + model.activeAnimations.length, 0);
    const key = visibleModels
      .map((model) => normalizeAssetKey(model.assetUrl) || model.runtimeModelId)
      .sort()
      .join("|") || "(observed-none)";
    if (visibleModelSequence.at(-1)?.key !== key) {
      visibleModelSequence.push({
        key,
        scrollPercent: snapshot.scrollPercent,
        activeText: snapshot.activeTexts[0]?.text || "",
        snapshotId: snapshot.id,
        visibleModels: visibleModels.map((model) => ({
          assetUrl: model.assetUrl,
          runtimeModelId: model.runtimeModelId,
          visiblePartCount: model.visiblePartCount,
          activeAnimationCount: model.activeAnimations.length
        }))
      });
    }
    const cameraKey = snapshot.runtime3D.activeCameras
      .map((camera) => `${camera.cameraId}:${camera.position?.join(",") || ""}:${camera.quaternion?.join(",") || ""}`)
      .join("|") || "(observed-none)";
    if (cameraSequence.at(-1)?.key !== cameraKey) {
      cameraSequence.push({
        key: cameraKey,
        scrollPercent: snapshot.scrollPercent,
        snapshotId: snapshot.id,
        cameras: snapshot.runtime3D.activeCameras
      });
    }
  }

  return {
    snapshotCount: snapshots.length,
    modelSequenceChangeCount: Math.max(0, sequence.length - 1),
    modelSequence: sequence.slice(0, 80),
    directRuntime3DSnapshotCount: runtime3DStatusCounts.ok + runtime3DStatusCounts.partial,
    runtime3DStatusCounts,
    visibleModelSequenceChangeCount: Math.max(0, visibleModelSequence.length - 1),
    visibleModelSequence: visibleModelSequence.slice(0, 120),
    activeCameraSequenceChangeCount: Math.max(0, cameraSequence.length - 1),
    activeCameraSequence: cameraSequence.slice(0, 120),
    directlyObservedPlayingAnimationCount,
    canvasVisualChangeCount: Math.max(0, canvasSequence.length - 1),
    canvasSequence: canvasSequence.slice(0, 80)
  };
}

function evidenceCountsBySource(sourceEvidence) {
  const counts = new Map();
  for (const item of sourceEvidence || []) {
    const source = item.source || item.assetUrl;
    if (!source) continue;
    const current = counts.get(source) || {
      evidenceCount: 0,
      runtimeControlEvidenceCount: 0
    };
    current.evidenceCount += 1;
    if (isRuntimeControlEvidence(item)) current.runtimeControlEvidenceCount += 1;
    counts.set(source, current);
  }
  return counts;
}

function investigationTargetsFromEvidence(evidence) {
  const countsBySource = evidenceCountsBySource(evidence.sourceEvidence);
  const targetFiles = (evidence.downloads || []).map((download) => {
    const counts = countsBySource.get(download.url) || countsBySource.get(download.finalUrl) || {};
    const localPath = download.localPath || "";
    return {
      assetType: download.assetType,
      localPath,
      absolutePath: localPath ? path.join(REPO_ROOT, localPath) : "",
      url: download.url,
      finalUrl: download.finalUrl,
      contentType: download.contentType,
      fileSize: download.fileSize,
      evidenceCount: counts.evidenceCount || 0,
      runtimeControlEvidenceCount: counts.runtimeControlEvidenceCount || 0
    };
  });

  const rank = (target) => {
    const typeWeight = target.assetType === "script" ? 40 : target.assetType === "data" ? 25 : target.assetType === "model" ? 15 : 0;
    return typeWeight + target.runtimeControlEvidenceCount * 10 + target.evidenceCount;
  };
  const sortedTargets = [...targetFiles].sort((a, b) => rank(b) - rank(a));
  const scriptOrData = sortedTargets.filter((target) => target.assetType === "script" || target.assetType === "data");
  const models = sortedTargets.filter((target) => target.assetType === "model");

  return {
    workingDirectory: REPO_ROOT,
    instructions: [
      "Use these fetched local resources as primary evidence, not just the compact structured hints.",
      "Prefer targeted rg/sed/node reads over opening whole minified bundles.",
      "Trace model discovery, loading/preloading, visibility or asset swap behavior, camera selection, mixer/clip setup, and scroll/time driver."
    ],
    suggestedSearches: [
      "rg -n \"AnimationMixer|GLTFLoader|clipAction|nextAnimVals|lastAnimVals|activeClipIndex|animDurations\" <script-local-path>",
      "rg -n \"model\\.visible|visible =|loadScenes|loadModel|loadFigure|windowIndex|sceneIndex|g-webgl-window|slidePositions\" <script-local-path>",
      "rg -n \"rotateOnScroll|percentageOfWindowIsScrolled|calculatePercentageOfDivScrolledPast|distanceScrolledPastTopOfWebGLWindow|ratioScrolledPast\" <script-local-path>"
    ],
    primaryScriptOrDataFiles: scriptOrData.slice(0, 16),
    modelFiles: models,
    allDownloadedFiles: sortedTargets
  };
}

async function buildEvidenceBundle(probe, inputPath, outputRoot, options) {
  await ensureFolders(outputRoot);
  const visualObservation = await extractScrollTargetVisualObservation(probe, outputRoot);
  const variantVisualObservation = await extractVariantStateVisualObservation(probe, outputRoot);
  const imageRelevance = imageRelevanceSummaryForProbe(probe);
  const imageAssets = imageAssetsForProbe(probe);
  const {
    downloads,
    failedDownloads,
    attemptedUrls,
    assetDiscovery
  } = await downloadProbeAssets(probe, outputRoot, options);

  const sourceEvidence = [];
  addRuntimeControlEvidenceFromProbe(sourceEvidence, probe);
  for (const download of downloads) addDownloadedRuntimeControlEvidence(sourceEvidence, download);
  addProbeTextEvidence(sourceEvidence, probe);
  for (const download of downloads) addDownloadedTextEvidence(sourceEvidence, download);

  const modelSummaries = [];
  const modelParseFailures = [];
  for (const download of downloads.filter((item) => item.assetType === "model")) {
    try {
      const json = parseGltfJsonFromDownload(download);
      modelSummaries.push(summarizeGltfJson(json, download));
    } catch (error) {
      const stableFailure = stableModelParseFailure(error);
      modelParseFailures.push({
        url: download.url,
        localPath: toPosix(path.relative(REPO_ROOT, download.localPath)),
        code: stableFailure.code,
        message: stableFailure.message,
        diagnostic: error.message
      });
    }
  }
  const modelRecords = downloads.filter((item) => item.assetType === "model").map((download) => {
    const parsed = modelSummaries.find((summary) => summary.assetUrl === download.url);
    if (parsed) return parsed;
    const failure = modelParseFailures.find((item) => item.url === download.url);
    return {
      parseStatus: "failed",
      parseError: failure?.message || "Model metadata could not be parsed.",
      assetUrl: download.url,
      finalUrl: download.finalUrl,
      localPath: toPosix(path.relative(REPO_ROOT, download.localPath)),
      file: path.basename(download.localPath),
      fileSize: download.fileSize,
      contentType: download.contentType,
      sceneCount: 0,
      nodeCount: 0,
      meshCount: 0,
      materialCount: 0,
      textureCount: 0,
      cameraCount: 0,
      animationCount: 0,
      hasEmbeddedAnimation: false,
      animatedTargetPathCounts: {},
      hasCameraAnimation: false,
      nodes: [],
      animations: []
    };
  });

  const runtimeSnapshots = (Array.isArray(probe.snapshots) ? probe.snapshots : []).map(normalizeSnapshot);
  const relationships = modelRecords.map((modelSummary, index) => ({
    id: `relationship-${String(index + 1).padStart(2, "0")}`,
    assetUrl: modelSummary.assetUrl,
    assetFile: modelSummary.file,
    parseStatus: modelSummary.parseStatus,
    parseError: modelSummary.parseError,
    hasEmbeddedAnimation: modelSummary.hasEmbeddedAnimation,
    animationNames: modelSummary.animations.map((animation) => animation.name || `animation-${animation.index}`),
    animationDurations: modelSummary.animations.map((animation) => animation.duration),
    animations: modelSummary.animations.map((animation) => ({
      index: animation.index,
      name: animation.name,
      duration: animation.duration,
      targetPaths: animation.targetPaths,
      targetNodeNames: animation.targetNodeNames,
      cameraChannelCount: animation.cameraChannelCount
    })),
    hasCameraAnimation: modelSummary.hasCameraAnimation,
    hints: relationshipHintsForModel(modelSummary, sourceEvidence, runtimeSnapshots)
  }));
  const variantContextsBySnapshotId = buildVariantContextBySnapshotId(probe);
  const beatRuntimeStates = attachVisualEvidenceToBeatStates(
    buildBeatRuntimeStates(runtimeSnapshots, relationships, variantContextsBySnapshotId),
    visualObservation
  );
  const runtimeSummary = summarizeRuntime(runtimeSnapshots);

  const compactDownloads = downloads.map((download) => ({
    url: download.url,
    finalUrl: download.finalUrl,
    assetType: download.assetType,
    localPath: toPosix(path.relative(REPO_ROOT, download.localPath)),
    contentType: download.contentType,
    fileSize: download.fileSize,
    contentHash: sha1Bytes(download.bytes),
    discovery: download.discovery || null
  }));

  return {
    tool: "animation-logic-probe-analyzer",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    sourceProbe: {
      inputPath: toPosix(path.relative(REPO_ROOT, path.resolve(inputPath))),
      collectorTool: probe.tool || "",
      collectorVersion: probe.version || "",
      collectorHash: probe.collector_hash || "",
      snapshotCount: runtimeSnapshots.length,
      runtime3DInstrumentation: probe.runtime_3d || probe.runtime_3d_instrumentation || null,
      viewportCapture: probe.viewport_capture || null,
      captureCoverage: probe.capture_coverage || null,
      variantGroupCount: Array.isArray(probe.variant_groups) ? probe.variant_groups.length : 0,
      variantInteractionCount: Array.isArray(probe.variant_interactions) ? probe.variant_interactions.length : 0,
      variantAssetAssociationCount: collectedVariantAssetAssociations(probe).length,
      variantHierarchyCount: collectedVariantHierarchy(probe).length,
      confirmedVariantHierarchyCount: collectedVariantHierarchy(probe).filter(collectedVariantDependencyConfirmed).length,
      variantDependencyCycleCount: Array.isArray(probe.variant_dependency_cycles) ? probe.variant_dependency_cycles.length : 0,
      scrollTraversalCount: Array.isArray(probe.scroll_traversal) ? probe.scroll_traversal.length : 0,
      variantRecovery: probe.variant_recovery && typeof probe.variant_recovery === "object" ? {
        status: String(probe.variant_recovery.status || "").slice(0, 80),
        baselineTargetCount: Number(probe.variant_recovery.baselineTargetCount || 0),
        plannedTargetCount: Number(probe.variant_recovery.plannedTargetCount || 0),
        visitedTargetCount: Number(probe.variant_recovery.visitedTargetCount || 0),
        mismatchCount: Number(probe.variant_recovery.mismatchCount || 0),
        mismatchedTargetCount: Number(probe.variant_recovery.mismatchedTargetCount || 0),
        topMismatchCount: Number(probe.variant_recovery.topMismatchCount || 0),
        repairAttemptCount: Number(probe.variant_recovery.repairAttemptCount || 0),
        repairFailureCount: Number(probe.variant_recovery.repairFailureCount || 0)
      } : null,
      visualCaptureManifestPath: visualObservation?.manifestPath || "",
      variantVisualCaptureManifestPath: variantVisualObservation?.manifestPath || ""
    },
    story: {
      url: probe.story_url || "",
      slug: safeSegment(probe.slug || storySlugFromUrl(probe.story_url), "nyt-story").toLowerCase(),
      title: probe.title || ""
    },
    runtimeObservation: {
      summary: {
        ...runtimeSummary,
        beatRuntimeStateCount: beatRuntimeStates.length,
        directlyObservedBeatCount: beatRuntimeStates.filter((beat) => beat.captureStatus !== "unavailable").length
      },
      beatRuntimeStates,
      snapshots: runtimeSnapshots
    },
    visualObservation,
    imageRelevance,
    imageAssets,
    variantObservation: {
      groups: Array.isArray(probe.variant_groups) ? probe.variant_groups : probe.storyvr_author_input?.variant_groups || [],
      interactions: Array.isArray(probe.variant_interactions) ? probe.variant_interactions : [],
      assetAssociations: collectedVariantAssetAssociations(probe),
      visualObservation: variantVisualObservation
    },
    assetDiscovery,
    downloads: compactDownloads,
    failedDownloads,
    sourceEvidence: sourceEvidence.slice(0, MAX_EVIDENCE_ITEMS),
    glbAnimations: {
      modelCount: modelRecords.length,
      animatedModelCount: modelRecords.filter((item) => item.hasEmbeddedAnimation).length,
      parseFailures: modelParseFailures,
      models: modelRecords
    },
    relationships,
    globalSignals: {
      downloadedCandidateCount: attemptedUrls.length,
      animationApiEvidenceCount: sourceEvidence.filter((item) => /AnimationMixer|clipAction|setTime|mixer|timeScale/i.test(item.context)).length,
      scrollEvidenceCount: sourceEvidence.filter((item) => /scroll|scrollY|scrollTop|ScrollTrigger|scrollama/i.test(item.context)).length,
      runtimeControlEvidenceCount: sourceEvidence.filter(isRuntimeControlEvidence).length,
      modelSequenceChangeCount: runtimeSummary.modelSequenceChangeCount,
      visibleModelSequenceChangeCount: runtimeSummary.visibleModelSequenceChangeCount,
      directRuntime3DSnapshotCount: runtimeSummary.directRuntime3DSnapshotCount,
      directlyObservedPlayingAnimationCount: runtimeSummary.directlyObservedPlayingAnimationCount,
      canvasVisualChangeCount: runtimeSummary.canvasVisualChangeCount,
      scrollTargetScreenshotCount: visualObservation?.captureCount || 0,
      scrollTargetScreenshotFailureCount: visualObservation?.failureCount || 0,
      variantStateScreenshotCount: variantVisualObservation?.captureCount || 0,
      variantStateScreenshotFailureCount: variantVisualObservation?.failureCount || 0,
      variantInteractionCount: Array.isArray(probe.variant_interactions) ? probe.variant_interactions.length : 0,
      variantAssetAssociationCount: collectedVariantAssetAssociations(probe).length
    },
    classificationVocabulary: CLASSIFICATIONS
  };
}

function truncatePromptContext(value, keyword, maxChars) {
  const text = String(value || "");
  if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) return text;
  if (maxChars < 12) return text.slice(0, maxChars);
  const marker = " … ";
  const bodyLength = maxChars - marker.length;
  const normalizedKeyword = String(keyword || "").trim().toLowerCase();
  const matchIndex = normalizedKeyword ? text.toLowerCase().indexOf(normalizedKeyword) : -1;
  const desiredStart = matchIndex >= 0 ? matchIndex - Math.floor(bodyLength / 2) : 0;
  const start = Math.max(0, Math.min(desiredStart, text.length - bodyLength));
  const end = Math.min(text.length, start + bodyLength);
  const prefix = start > 0 ? marker : "";
  const suffix = end < text.length ? marker : "";
  const bodyBudget = Math.max(0, maxChars - prefix.length - suffix.length);
  return `${prefix}${text.slice(start, start + bodyBudget)}${suffix}`;
}

function promptSourceEvidenceRank(item) {
  const text = `${item?.keyword || ""} ${item?.context || ""}`;
  let score = 0;
  if (/AnimationMixer|clipAction|setTime|mixer|timeScale|GLTFLoader/i.test(text)) score += 40;
  if (/scroll|scrollY|scrollTop|ScrollTrigger|scrollama|percentageOf|slidePositions/i.test(text)) score += 30;
  if (/visible|opacity|camera|scene|activeClip|nextAnimVals|lastAnimVals/i.test(text)) score += 20;
  if (item?.assetUrl) score += 8;
  if (/runtime/i.test(String(item?.sourceType || ""))) score += 6;
  return score;
}

function sourceEvidenceForCodexPrompt(sourceEvidence, profile) {
  const ranked = [...(sourceEvidence || [])].sort((left, right) => (
    promptSourceEvidenceRank(right) - promptSourceEvidenceRank(left)
      || String(left?.id || "").localeCompare(String(right?.id || ""))
  ));
  return ranked.slice(0, profile.sourceEvidenceLimit).map((item) => ({
    ...item,
    context: truncatePromptContext(item.context, item.keyword, profile.sourceContextChars)
  }));
}

function relationshipForCodexPrompt(relationship, rawRelationship, profile) {
  const runtimePresence = relationship?.hints?.runtimePresence || {};
  const rawPresence = rawRelationship?.hints?.runtimePresence || {};
  const examples = Array.isArray(runtimePresence.activeTextExamples) ? runtimePresence.activeTextExamples : [];
  const sequence = Array.isArray(runtimePresence.activeTextSequence) ? runtimePresence.activeTextSequence : [];
  const sampledExamples = evenlySample(examples, profile.activeTextExampleLimit)
    .map((text) => truncatePromptContext(text, "", profile.activeTextChars));
  return {
    ...relationship,
    hints: {
      ...relationship.hints,
      runtimePresence: {
        observationSource: runtimePresence.observationSource || "unavailable",
        snapshotCount: Number(rawPresence.snapshotCount || 0),
        inventorySnapshotCount: Number(rawPresence.inventorySnapshotCount || 0),
        directRuntimeObservedCount: Number(rawPresence.directRuntimeObservedCount || 0),
        directVisibleSnapshotCount: Number(rawPresence.directVisibleSnapshotCount || 0),
        directRenderActiveSnapshotCount: Number(rawPresence.directRenderActiveSnapshotCount || 0),
        distinctActiveTextCount: Number(rawPresence.distinctActiveTextCount || new Set(examples).size),
        activeTextChangeCount: Number(rawPresence.activeTextChangeCount || Math.max(0, sequence.length - 1)),
        firstScrollPercent: Number.isFinite(Number(rawPresence.firstScrollPercent)) ? Number(rawPresence.firstScrollPercent) : null,
        lastScrollPercent: Number.isFinite(Number(rawPresence.lastScrollPercent)) ? Number(rawPresence.lastScrollPercent) : null,
        activeTextExampleCount: examples.length,
        activeTextSequenceCount: sequence.length,
        activeTextExamples: sampledExamples,
        fullBeatStateReference: "runtimeObservation.beatRuntimeStates"
      }
    }
  };
}

function downloadedFilesForCodexPrompt(semanticEvidence, evidence, profile, investigationTargets) {
  const pinnedUrls = [
    ...(investigationTargets.primaryScriptOrDataFiles || []),
    ...(investigationTargets.modelFiles || [])
  ].flatMap((target) => [target.url, target.finalUrl]).map(semanticUrlIdentity).filter(Boolean);
  const byUrl = new Map((semanticEvidence.downloads || []).map((download) => [download.url, download]));
  const ordered = [];
  const seen = new Set();
  for (const url of [...pinnedUrls, ...(semanticEvidence.downloads || []).map((download) => download.url)]) {
    const download = byUrl.get(url);
    if (!download || seen.has(download.url)) continue;
    seen.add(download.url);
    ordered.push(download);
  }
  return ordered.slice(0, profile.downloadLimit).map((download) => ({
    ...download,
    localPath: evidence.downloads?.find((candidate) => semanticUrlIdentity(candidate.url) === download.url)?.localPath || ""
  }));
}

function compactEvidenceForCodexPrompt(evidence, semanticEvidence, profile) {
  const investigationTargets = investigationTargetsFromEvidence(evidence);
  const downloads = downloadedFilesForCodexPrompt(semanticEvidence, evidence, profile, investigationTargets);
  const sourceEvidence = sourceEvidenceForCodexPrompt(semanticEvidence.sourceEvidence, profile);
  const runtimeBeats = semanticEvidence.runtimeBeats.slice(0, profile.runtimeBeatLimit);
  const rawRelationshipsById = new Map((evidence.relationships || []).map((relationship) => [relationship.id, relationship]));
  const relationships = semanticEvidence.relationships.map((relationship) => (
    relationshipForCodexPrompt(relationship, rawRelationshipsById.get(relationship.id), profile)
  ));
  const compactEvidence = {
    tool: evidence.tool,
    version: evidence.version,
    judgmentInput: evidence.judgmentInput,
    promptCompaction: {
      profile: profile.name,
      sourceEvidence: { included: sourceEvidence.length, total: semanticEvidence.sourceEvidence.length },
      downloads: { included: downloads.length, total: semanticEvidence.downloads.length },
      runtimeBeats: { included: runtimeBeats.length, total: semanticEvidence.runtimeBeats.length },
      relationships: {
        included: relationships.length,
        total: semanticEvidence.relationships.length,
        repeatedRuntimeText: "deduplicated; full beat state is in runtimeObservation.beatRuntimeStates"
      },
      resourceInventory: "allDownloadedFiles omitted; downloads contains the included inventory"
    },
    story: semanticEvidence.story,
    sourceProbe: semanticEvidence.collector,
    resourceInvestigation: {
      workingDirectory: investigationTargets.workingDirectory,
      instructions: investigationTargets.instructions,
      suggestedSearches: investigationTargets.suggestedSearches,
      downloadedFileCount: investigationTargets.allDownloadedFiles.length,
      primaryScriptOrDataFiles: investigationTargets.primaryScriptOrDataFiles,
      modelFiles: investigationTargets.modelFiles
    },
    assetDiscovery: semanticEvidence.assetDiscovery,
    downloads,
    failedDownloads: semanticEvidence.failedDownloads,
    sourceEvidence,
    runtimeObservation: {
      summary: semanticEvidence.globalSignals,
      totalBeatRuntimeStateCount: semanticEvidence.runtimeBeats.length,
      omittedBeatRuntimeStateCount: Math.max(0, semanticEvidence.runtimeBeats.length - runtimeBeats.length),
      beatRuntimeStates: runtimeBeats
    },
    visualObservation: semanticEvidence.visualObservation ? {
      ...semanticEvidence.visualObservation,
      manifestPath: evidence.visualObservation?.manifestPath || "",
      screenshots: semanticEvidence.visualObservation.screenshots.map((item) => {
        const actual = evidence.visualObservation?.screenshots?.find((candidate) => candidate.evidenceRef === item.evidenceRef);
        return {
          ...item,
          localPath: actual?.localPath || "",
          canvasCropLocalPath: actual?.canvasCrop?.localPath || ""
        };
      }),
      contactSheets: (evidence.visualObservation?.contactSheets || []).filter((item) => item.status === "ok").map((item) => ({
        id: item.id,
        evidenceRef: item.evidenceRef,
        screenshotIds: item.screenshotIds,
        localPath: item.localPath
      })),
      attachedImages: evidence.visualObservation?.codexAttachments || []
    } : null,
    imageRelevance: semanticEvidence.imageRelevance,
    imageAssets: semanticEvidence.imageAssets,
    glbAnimations: {
      modelCount: semanticEvidence.glbModels.length,
      animatedModelCount: semanticEvidence.glbModels.filter((model) => model.animations.length > 0).length,
      models: semanticEvidence.glbModels
    },
    relationships,
    globalSignals: semanticEvidence.globalSignals,
    classificationVocabulary: CLASSIFICATIONS
  };

  return compactEvidence;
}

function renderCodexPrompt(compactEvidence) {

  return [
    `Prompt contract: ${CODEX_PROMPT_VERSION}. You are judging animation logic in an NYTimes visual/interactive story for a StoryVR research pipeline.`,
    "Do not edit files. You may and should run read-only shell commands such as rg, sed, nl, and node against the fetched local resources listed in resourceInvestigation. Return one JSON object and no Markdown fences.",
    "Use the structured evidence as an index, but do not rely on it alone. Investigate the fetched scripts, data files, and GLB summaries thoroughly before making the judgment. Be explicit when evidence is direct versus inferred.",
    "Do not assume one NYT implementation architecture. Follow the actual loader, scene manager, framework, data/config, and animation code present in this story, including custom bundles or nonstandard multi-model setups.",
    "Make output identity stable: refer to story URLs, asset URLs/files, relationship IDs, clip index/name, beat text/selectors, and evidence IDs instead of timestamped local analysis paths.",
    "When runtimeObservation.beatRuntimeStates is present, treat its sampled model visibility, render-eligible parts, AnimationAction state, mixer state, and active camera as authoritative for the listed stable beatId. Interpret semantics around it, but do not override direct runtime facts with preload URLs or naming guesses. The analyzer attaches the current capture's exact snapshot IDs after Codex returns.",
    "When visualObservation is present, inspect the attached scroll-target contact sheets and their manifest. The primary frame is the fully composited current-tab client area, including WebGL, DOM captions, CSS overlays, and annotations. Each optional canvasCrop is secondary diagnostic evidence only. A screenshot can support visible scene/part state and scroll-correlated visual change, but it does not by itself prove GLB asset identity, exact node identity, clip identity, hidden/offscreen state, or a time-based driver.",
    "Use visual evidenceRefs in reasoning when screenshots support a claim. Link frames through targetIndex, activeText, and the corresponding runtime beat visualEvidence. Do not call visual-only identity direct-runtime; combine direct visual visibility with direct-source-config or inferred-source identity as separate evidence.",
    "One screenshot per scroll target can show changes across scroll targets. It cannot prove fixed-time playback without a same-scroll temporal comparison, so retain driverMode unknown unless mixer/source evidence independently establishes time-based playback.",
    "Field-level provenance is mandatory: direct-runtime in your semantic interpretation requires a matching runtime beatId plus relationship/part/action identity; direct-source-config means fetched code/config explicitly maps an asset to a beat but does not prove instantaneous visibility; inferred-runtime is temporal/caption correlation; inferred-source is code structure or naming; inferred-preload-based is cumulative resource inventory; unknown means the evidence does not settle it.",
    "Keep playback API separate from playback driver. mixer-time or AnimationMixer.update only names the mechanism; it can still receive a scroll-derived delta. Prefer per-action direct stationary-scroll samples, then fetched-code formulas, when deciding time-based versus scroll-based. One GLB may contain mixed drivers.",
    "A running action never proves its model or target is visible. A visible part must be a directly observed render-eligible primitive; non-renderable driver/control nodes remain animation targets, not visible parts.",
    "Image relevance is deterministic input. Only evidence.imageAssets and evidence.imageRelevance.acceptedGroups are eligible image assets. Do not recommend rejected image groups or rejected image URLs, and do not override the rule-based image filtering.",
    `Allowed classifications: ${CLASSIFICATIONS.join(", ")}.`,
    `Scroll-driver types: ${SCROLL_DRIVERS.join(", ")}.`,
    "Mandatory fetched-resource investigation before judgment:",
    "- Inspect the highest-signal downloaded script/data files in resourceInvestigation.primaryScriptOrDataFiles, especially files with runtimeControlEvidenceCount > 0.",
    "- Trace model discovery/config parsing: where GLB URLs or model records come from, how multiple models are grouped, and whether the grouping is per scene/window/slide.",
    "- Trace model lifecycle: preloading/loading, addition to the Three.js scene graph, camera assignment, visibility toggling, unloading, replacement, or crossfade behavior.",
    "- Trace animation lifecycle: AnimationMixer creation, clipAction/play setup, mixer update/setTime driver, scroll/time inputs, active clip/window selection, and per-model versus shared mixer state.",
    "- For every animated GLB, inspect each embedded animation target and camera path if present. Describe what it animates from channel targets plus runtime code evidence, not from node names alone.",
    "- Trace runtime JS behavior that changes a GLB even when the GLB has no embedded clips: transforms, visible flags, material opacity, shader uniforms, active scene buckets, slide-indexed state, camera changes, or asset swaps.",
    "- For every animated or runtime-driven GLB, identify how the animation/state is triggered or advanced: local scroll progress, full-page scroll, slide index, time loop, click/tap/state machine, or unknown. Trigger mapping is required; use unknown with evidence gaps rather than guessing.",
    "- Compare that code path with runtimeObservation.beatRuntimeStates and glbAnimations model summaries. Treat globalSignals.modelResourceSequenceChanged as resource-observation evidence, not proof of visible model state.",
    "- Compare fetched behavior with runtimeObservation.beatRuntimeStates. When direct visibleModelSequence exists, use it instead of resource URL sequence for active/topology claims.",
    "- If the page preloads all GLBs, state that per-model visibility is indirect unless fetched code or runtime state directly exposes model.visible/currentScene/activeClipIndex behavior.",
    "- If multiple GLBs can be present in one story or one scene/window, explain whether the code handles them as a sequential asset swap, concurrent visible set, hidden/shown scene buckets, or shared/persistent models with internal animation.",
    "- For accepted image assets, do not judge animation. Link each image group to related beat content using caption, credit, nearby/source structure, accepted image relevance, and runtime/story structure evidence.",
    "Definitions:",
    "- Beat boundary rule: for this StoryVR pipeline, a beat is a caption/state unit from active text, slide, hotspot, or story-state evidence. Do not treat a whole WebGL scene/window as one beat when multiple captions or states occur inside it.",
    "- within-beat-dynamics: scroll or time changes an asset, model, object, or camera while one caption/state beat remains active and no evidence shows progression to another caption/state beat.",
    "- inter-beat-dynamics: animation state changes across caption/state beat boundaries, bridges separate captions/states, or advances as a transition between fixed story positions. A single persistent GLB can still be inter-beat when its internal timeline is scrubbed across captions/states.",
    "- ambient-object-motion: decorative or background animation loops independently of a focused story beat. If the motion is mapped to caption/state progression, classify it as inter-beat-dynamics instead.",
    "- asset-topology-transition: scroll primarily swaps/crossfades/changes active GLBs or visible object sets.",
    "- unknown/needs-review: evidence is insufficient or conflicting.",
    "Animation interpretation roles:",
    "- Use node names only as weak hints. Prove semantics through runtime code that reads scene nodes, traverses children, maps animated values to visibility/opacity/shader uniforms/DOM labels/camera state, or updates active scene state.",
    "- Allowed behavior roles: camera-path, camera-look-target, camera-lens-driver, label-anchor-or-opacity, visibility-opacity-driver, shader-progress-driver, direct-object-transform, scene-state-driver, runtime-js-transform, runtime-asset-swap, unknown-control-node, unknown-visible-transform.",
    "- If a naming convention such as driver/target pairing appears, return it only when fetched runtime code proves the mapping. Otherwise mark the role unknown and explain the gap.",
    "Scroll-driver definitions:",
    "- time-based: an embedded GLB clip advances by frame time or AnimationMixer delta after the relevant beat/window is active.",
    "- local-scroll-window-progress: scroll progress is computed from local element/window visibility, hotspot visibility, or progress through one WebGL/story window. Use caption/state evidence to decide whether that local driver is within-beat or inter-beat.",
    "- slide-indexed-scroll-transition: scroll selects or interpolates between slide/beat/window indexed states, highlights, cameras, clips, or object sets.",
    "- absolute-page-scroll: animation progress is mapped directly from global page scroll values such as scrollY/pageYOffset/scrollTop without detected local element geometry.",
    "- unknown: the driver cannot be established from the evidence.",
    "Decision rules:",
    "- Do not infer inter-beat-dynamics from a single slide position, rotateOnScroll: 0, or globalSignals.modelResourceSequenceChanged=false. Those are neutral unless paired with explicit beat-boundary transition evidence.",
    "- Treat globalSignals.modelResourceSequenceChanged=false cautiously because runtime resource observations may list preloaded model URLs rather than the currently visible model. It does not rule out inter-beat-dynamics; internal GLB animation can carry caption/state transitions without asset swaps.",
    "- Use relationship.hints.scrollDriver as the primary deterministic driver hint, but revise downward if its evidence is indirect or contradicted.",
    "- time-based playback usually implies within-beat-dynamics unless captions/states explicitly control or bracket it.",
    "- local-scroll-window-progress plus relationship.hints.runtimePresence.distinctActiveTextCount > 1 or activeTextChangeCount > 0 usually implies inter-beat-dynamics.",
    "- slide-indexed-scroll-transition usually implies inter-beat-dynamics unless the indexed state is only a local annotation inside one beat/window.",
    "- absolute-page-scroll names the driver, not necessarily the story role; classify it from the surrounding beat/window evidence.",
    "- If a relationship has hasEmbeddedAnimation, scriptSignals.hasScrollScrubbedAnimation, and multiple runtime active text states, classify that relationship as inter-beat-dynamics even when globalSignals.modelResourceSequenceChanged=false.",
    "- If embedded GLB animation targets model/body/camera nodes and runtime active text shows multiple caption/state beats, prefer inter-beat-dynamics over within-beat-dynamics.",
    "- If your fetched-resource investigation contradicts relationship.hints, prefer the fetched-resource investigation and explain the contradiction.",
    "- A GLB with no embedded animation is not automatically static. If runtime JS animates, transforms, shows/hides, swaps, or sequences it across beats, include that runtime behavior in the dynamics interpretation and classify accordingly.",
    "- If a GLB has no embedded animation, no camera path, and no runtime-driven behavior found, only return beat association for it; do not force a dynamics classification.",
    "- For each animated GLB asset, return an assetJudgments item with associatedBeats: the caption/state beat content that the GLB is associated with. For within-beat-dynamics, return one beat unless direct evidence proves more. For inter-beat-dynamics or asset-topology-transition, return multiple beats when the evidence supports a progression across beats.",
    "- For every parsed GLB relationship, animated or static, return a modelBeatAssociations item with associatedBeats. Static GLBs should not receive a dynamics classification in modelBeatAssociations; only associate them with beat content.",
    "- For every accepted image asset in evidence.imageAssets, return an imageBeatAssociations item with associatedBeats. Treat images like static source assets: association only, no dynamics classification.",
    "- For every animated or runtime-driven GLB, return a glbAnimationInterpretations item. Include per-clip interpretations when embedded clips exist, cameraPath when a camera path exists, and runtimeJsBehavior when fetched code changes model/camera/material/scene state.",
    "- For every model-associated beat that lacks an on-canvas model in runtimeObservation.beatRuntimeStates, return an inferredBeatAssetStates item. This is the AI/source fallback for per-beat model visibility, part visibility, playing/active animation, and fixed-time versus scroll-based driver. Keep it separate from authoritative beatRuntimeStates.",
    "- In inferredBeatAssetStates, use visibility/play state unknown whenever fetched code/config does not establish it. Animation target names are not automatically visible parts. direct-source-config is allowed for explicit source mappings; direct-runtime is not allowed in this inferred structure.",
    "- Each associatedBeats item should include beatId when it matches runtimeObservation.beatRuntimeStates, text, scrollPercent when known, and field-level source: direct-runtime, direct-source-config, inferred-runtime, inferred-source, inferred-preload-based, or unknown. Never use direct-runtime without a matching runtime beatId and relationship/part/action identity. A model-level association that combines differently sourced beats may use aggregate associationSource mixed, but every beat must retain its own source.",
    "- For GLBs that appear in every resource snapshot because the source page preloads all model URLs, use associationSource 'inferred-preload-based' unless direct runtime state or fetched code proves active-state ownership. Animated GLBs can also be preload-only or hidden.",
    "- Do not return beatRuntimeStates. The analyzer copies that deterministic direct-runtime structure from evidence into the final judgment so Codex cannot silently rewrite it.",
    "- summaryMarkdown must include a section titled '## Animating GLB Judgments' with one concise bullet for each animated GLB asset and its associated beat content.",
    "- summaryMarkdown must also include a section titled '## GLB Beat Associations' with one concise bullet for every detected GLB/model relationship, including parse failures and models with no embedded animation.",
    "- summaryMarkdown must also include '## Inferred Beat Asset State' when inferredBeatAssetStates contains records.",
    "- summaryMarkdown must also include '## Image Beat Associations' and '## GLB Animation Interpretation' sections when those assets exist.",
    "- Include investigationSummary in the returned JSON. It must name the resources inspected and summarize the traced model loading, visibility/swap behavior, animation driver, runtime JS behavior, and multi-GLB behavior.",
    "inferredBeatAssetStates item shape: {\"beatId\":\"runtime-beat-id-or-empty\",\"text\":\"beat text\",\"scrollPercent\":0.0,\"relationshipId\":\"relationship-id\",\"assetUrl\":\"string\",\"visibilityState\":\"visible|active|hidden|unknown\",\"parts\":[{\"name\":\"string\",\"nodePath\":\"string\",\"role\":\"string\",\"visibilityState\":\"visible|active|hidden|unknown\",\"confidence\":0.0,\"provenance\":\"direct-source-config|inferred-runtime|inferred-source|inferred-preload-based|unknown\",\"reasoning\":\"string\",\"evidenceRefs\":[\"evidence-id\"]}],\"animations\":[{\"clipIndex\":0,\"clipName\":\"string\",\"playState\":\"playing|active|paused|stopped|unknown\",\"driverMode\":\"time-based|scroll-based|state-based|mixed|unknown\",\"scrollDriverType\":\"time-based|local-scroll-window-progress|slide-indexed-scroll-transition|absolute-page-scroll|unknown\",\"triggerMechanism\":\"string\",\"targetParts\":[\"string\"],\"confidence\":0.0,\"provenance\":\"direct-source-config|inferred-runtime|inferred-source|inferred-preload-based|unknown\",\"reasoning\":\"string\",\"evidenceRefs\":[\"evidence-id\"]}],\"confidence\":0.0,\"provenance\":\"direct-source-config|inferred-runtime|inferred-source|inferred-preload-based|unknown\",\"reasoning\":\"string\",\"evidenceRefs\":[\"evidence-id\"]}",
    "The returned top-level JSON object MUST include inferredBeatAssetStates as an array of the items above. This required v3 field is a sibling of modelBeatAssociations and glbAnimationInterpretations. Every associatedBeats object may also include beatId; the compact legacy shape below does not repeat that optional stable identity field.",
    "Required top-level v3 envelope: {\"storyTitle\":\"string\",\"dominantLogic\":\"classification\",\"modelBeatAssociations\":[],\"inferredBeatAssetStates\":[{\"beatId\":\"string\",\"relationshipId\":\"string\",\"assetUrl\":\"string\",\"modelVisibility\":{\"state\":\"visible|active|hidden|unknown\"},\"parts\":[],\"animations\":[],\"provenance\":\"direct-source-config|inferred-runtime|inferred-source|inferred-preload-based|unknown\",\"confidence\":0.0,\"reasoning\":\"string\",\"evidenceRefs\":[]}],\"glbAnimationInterpretations\":[],\"relationshipJudgments\":[],\"uncertainties\":[],\"recommendedStoryVRUse\":\"string\"}",
    "Use these detailed field shapes for the complete returned JSON:",
    "{\"storyTitle\":\"string\",\"dominantLogic\":\"classification\",\"confidence\":0.0,\"overallSummary\":\"string\",\"summaryMarkdown\":\"string\",\"investigationSummary\":{\"resourcesInspected\":[\"path-or-url\"],\"behaviorTrace\":{\"modelDiscovery\":\"string\",\"modelLoading\":\"string\",\"visibilityOrSwap\":\"string\",\"animationDriver\":\"string\",\"multipleGlbHandling\":\"string\",\"runtimeJsBehavior\":\"string\"},\"directEvidence\":\"string\",\"remainingGaps\":[\"string\"]},\"assetJudgments\":[{\"assetUrl\":\"string\",\"assetFile\":\"string\",\"hasEmbeddedAnimation\":true,\"classification\":\"classification\",\"scrollDriver\":{\"type\":\"scroll-driver\",\"confidence\":0.0},\"confidence\":0.0,\"associatedBeats\":[{\"text\":\"caption/state beat text\",\"scrollPercent\":0.0,\"source\":\"provenance\"}],\"reasoning\":\"string\",\"evidenceRefs\":[\"evidence-001\"]}],\"modelBeatAssociations\":[{\"assetUrl\":\"string\",\"assetFile\":\"string\",\"hasEmbeddedAnimation\":false,\"associatedBeats\":[{\"text\":\"caption/state beat text\",\"scrollPercent\":0.0,\"source\":\"provenance\"}],\"associationConfidence\":0.0,\"associationSource\":\"direct-runtime|direct-source-config|inferred-runtime|inferred-source|inferred-preload-based|mixed|unknown\",\"reasoning\":\"string\",\"evidenceRefs\":[\"evidence-001\"]}],\"imageBeatAssociations\":[{\"imageGroupId\":\"string\",\"assetUrl\":\"string\",\"associatedBeats\":[{\"text\":\"caption/state beat text\",\"scrollPercent\":0.0,\"source\":\"direct|inferred\"}],\"associationConfidence\":0.0,\"associationSource\":\"direct|inferred|unknown\",\"reasoning\":\"string\",\"evidenceRefs\":[\"evidence-001\"]}],\"glbAnimationInterpretations\":[{\"assetUrl\":\"string\",\"assetFile\":\"string\",\"hasEmbeddedAnimation\":true,\"hasCameraPath\":false,\"classification\":\"classification\",\"triggerMapping\":{\"type\":\"time-based|local-scroll-window-progress|slide-indexed-scroll-transition|absolute-page-scroll|click-or-state-machine|unknown\",\"localFormula\":\"string|null\",\"fullPageFormula\":\"string|null\",\"confidence\":0.0,\"evidenceRefs\":[\"evidence-001\"],\"reasoning\":\"string\"},\"runtimeJsBehavior\":{\"isRuntimeDriven\":false,\"summary\":\"string\",\"evidenceRefs\":[\"evidence-001\"]},\"clips\":[{\"animationName\":\"string\",\"targetNodes\":[\"string\"],\"targetPaths\":[\"translation|rotation|scale|weights\"],\"role\":\"behavior-role\",\"triggerMechanism\":\"mixer-time|scale-threshold|shader-uniform|runtime-state|time-loop|unknown\",\"associatedBeats\":[{\"text\":\"caption/state beat text\",\"scrollPercent\":0.0,\"source\":\"provenance\"}],\"reasoning\":\"string\",\"confidence\":0.0}],\"cameraPath\":{\"hasCameraPath\":false,\"driver\":\"string\",\"summary\":\"string\",\"associatedBeats\":[{\"text\":\"caption/state beat text\",\"scrollPercent\":0.0,\"source\":\"provenance\"}],\"evidenceRefs\":[\"evidence-001\"]},\"reasoning\":\"string\",\"evidenceRefs\":[\"evidence-001\"]}],\"relationshipJudgments\":[{\"relationshipId\":\"string\",\"assetUrl\":\"string\",\"classification\":\"classification\",\"scrollDriver\":{\"type\":\"scroll-driver\",\"confidence\":0.0},\"confidence\":0.0,\"explanation\":\"string\",\"evidenceRefs\":[\"evidence-001\"]}],\"uncertainties\":[\"string\"],\"recommendedStoryVRUse\":\"string\"}",
    `Evidence JSON:\n${JSON.stringify(compactEvidence, null, 2)}`
  ].join("\n\n");
}

function createCodexPromptBundle(evidence) {
  const semanticEvidence = judgmentSemanticInput(evidence);
  let smallestAttempt = null;
  for (const profile of CODEX_PROMPT_PROFILES) {
    const compactEvidence = compactEvidenceForCodexPrompt(evidence, semanticEvidence, profile);
    const prompt = renderCodexPrompt(compactEvidence);
    const diagnostics = {
      profile: profile.name,
      actualChars: prompt.length,
      targetChars: CODEX_PROMPT_TARGET_CHARS,
      hardLimitChars: CODEX_INPUT_HARD_LIMIT_CHARS,
      sourceEvidence: compactEvidence.promptCompaction.sourceEvidence,
      downloads: compactEvidence.promptCompaction.downloads,
      runtimeBeats: compactEvidence.promptCompaction.runtimeBeats,
      relationships: compactEvidence.promptCompaction.relationships
    };
    smallestAttempt = { prompt, compactEvidence, diagnostics };
    if (prompt.length <= CODEX_PROMPT_TARGET_CHARS) return smallestAttempt;
  }
  throw new Error(
    `Codex prompt compaction could not reach the ${CODEX_PROMPT_TARGET_CHARS}-character target: `
      + `${smallestAttempt?.diagnostics?.actualChars || 0} characters remain after the `
      + `${smallestAttempt?.diagnostics?.profile || "minimal"} profile `
      + `(Codex hard limit ${CODEX_INPUT_HARD_LIMIT_CHARS}).`
  );
}

function createCodexPrompt(evidence) {
  return createCodexPromptBundle(evidence).prompt;
}

function codexExecArgs(options) {
  const imageArgs = (Array.isArray(options.imagePaths) ? options.imagePaths : [])
    .filter(Boolean)
    .slice(0, MAX_CODEX_IMAGE_ATTACHMENTS)
    .map((imagePath) => `--image=${imagePath}`);
  return [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--cd",
      options.cwd,
      "--skip-git-repo-check",
      ...imageArgs,
      "-"
  ];
}

function runCodexExec(codexBin, prompt, options) {
  return new Promise((resolve, reject) => {
    const args = codexExecArgs(options);
    const child = spawn(codexBin, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdin.end(prompt);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Codex animation judgment failed: ${stderr || stdout || `exit ${code}`}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function extractCodexFinalText(stdout) {
  let completed = "";
  let deltas = "";
  for (const line of String(stdout || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message") completed = event.item.text || completed;
      if (event.type === "item.agent_message.delta") deltas += event.delta || event.text || "";
    } catch {
      // Non-JSON progress output is ignored.
    }
  }
  return completed || deltas.trim();
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("Codex response did not contain a JSON object.");
  }
}

function stableStringSet(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)))
    .sort(stableCompare);
}

function visualResourcesForEvidence(evidence) {
  const screenshots = evidence?.visualObservation?.screenshots || [];
  return [
    ...screenshots,
    ...screenshots.map((item) => item.canvasCrop).filter(Boolean),
    ...(evidence?.visualObservation?.contactSheets || [])
  ];
}

function stableInspectedResource(value, evidence) {
  const text = String(value || "").trim();
  if (!text) return "";
  for (const download of evidence?.downloads || []) {
    const localPath = String(download.localPath || "");
    const filename = path.basename(localPath);
    if ((localPath && text.includes(localPath)) || (filename && text.includes(filename))) {
      return download.url || download.finalUrl || filename;
    }
  }
  for (const visual of visualResourcesForEvidence(evidence)) {
    const localPath = String(visual.localPath || "");
    const filename = path.basename(localPath);
    if ((localPath && text.includes(localPath)) || (filename && text.includes(filename))) {
      return visual.evidenceRef || visual.id || filename;
    }
  }
  if (/^(?:https?:)?\/\//i.test(text)) return text;
  if (text.includes("/analysis/animation-logic-probe/") || path.isAbsolute(text)) return path.basename(text);
  return text;
}

function stabilizeCodexCacheValue(value, evidence) {
  if (Array.isArray(value)) return value.map((item) => stabilizeCodexCacheValue(item, evidence));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stabilizeCodexCacheValue(item, evidence)]));
  }
  if (typeof value !== "string") return value;
  let text = value;
  const inputPath = String(evidence?.sourceProbe?.inputPath || "");
  if (inputPath) {
    const replacement = path.basename(inputPath);
    text = text.split(path.resolve(REPO_ROOT, inputPath)).join(replacement);
    text = text.split(inputPath).join(replacement);
  }
  const analysisRoots = new Set((evidence?.downloads || []).map((download) => {
    const localPath = String(download.localPath || "");
    const markerIndex = localPath.lastIndexOf("/downloads/");
    return markerIndex >= 0 ? localPath.slice(0, markerIndex) : "";
  }).filter(Boolean));
  for (const analysisRoot of analysisRoots) {
    text = text.split(path.resolve(REPO_ROOT, analysisRoot)).join("<analysis-output>");
    text = text.split(analysisRoot).join("<analysis-output>");
  }
  for (const download of evidence?.downloads || []) {
    const localPath = String(download.localPath || "");
    if (!localPath) continue;
    const replacement = download.url || download.finalUrl || path.basename(localPath);
    text = text.split(path.resolve(REPO_ROOT, localPath)).join(replacement);
    text = text.split(localPath).join(replacement);
  }
  for (const visual of visualResourcesForEvidence(evidence)) {
    const localPath = String(visual.localPath || "");
    if (!localPath) continue;
    const replacement = visual.evidenceRef || visual.id || path.basename(localPath);
    text = text.split(path.resolve(REPO_ROOT, localPath)).join(replacement);
    text = text.split(localPath).join(replacement);
  }
  return text;
}

function sanitizeCodexJudgmentForCache(judgment, evidence) {
  const source = judgment && typeof judgment === "object" ? judgment : {};
  const {
    engine: _engine,
    beatRuntimeStates: _beatRuntimeStates,
    generatedAt: _generatedAt,
    timestamp: _timestamp,
    ...rest
  } = source;
  const sanitized = stabilizeCodexCacheValue(JSON.parse(JSON.stringify(rest)), evidence);
  if (sanitized.investigationSummary && typeof sanitized.investigationSummary === "object") {
    sanitized.investigationSummary.resourcesInspected = stableStringSet(
      (Array.isArray(sanitized.investigationSummary.resourcesInspected) ? sanitized.investigationSummary.resourcesInspected : [])
        .map((value) => stableInspectedResource(value, evidence))
    );
    sanitized.investigationSummary.remainingGaps = stableStringSet(sanitized.investigationSummary.remainingGaps);
  }
  sanitized.uncertainties = stableStringSet(sanitized.uncertainties);
  return sanitized;
}

function codexEngineForEvidence(evidence, promptBudget = null) {
  return {
    provider: "codex-cli",
    promptVersion: CODEX_PROMPT_VERSION,
    evidenceFingerprint: evidence?.judgmentInput?.evidenceFingerprint || judgmentEvidenceFingerprint(evidence),
    ...(promptBudget ? { promptBudget } : {})
  };
}

async function readCachedCodexJudgment(cachePath, fingerprint) {
  const envelope = await readJsonIfExists(cachePath);
  if (
    !envelope
    || envelope.schemaVersion !== JUDGMENT_CACHE_SCHEMA_VERSION
    || envelope.promptVersion !== CODEX_PROMPT_VERSION
    || envelope.evidenceFingerprint !== fingerprint
    || !envelope.judgment
    || typeof envelope.judgment !== "object"
    || Array.isArray(envelope.judgment)
  ) return null;
  return envelope.judgment;
}

async function writeCachedCodexJudgment(cachePath, fingerprint, judgment, { replace = false } = {}) {
  const envelope = {
    schemaVersion: JUDGMENT_CACHE_SCHEMA_VERSION,
    promptVersion: CODEX_PROMPT_VERSION,
    evidenceFingerprint: fingerprint,
    judgment
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await writeJson(temporaryPath, envelope);
  try {
    if (replace) {
      await fs.rename(temporaryPath, cachePath);
      return judgment;
    }
    try {
      await fs.link(temporaryPath, cachePath);
      return judgment;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const concurrentWinner = await readCachedCodexJudgment(cachePath, fingerprint);
      if (concurrentWinner) return concurrentWinner;
      await fs.rename(temporaryPath, cachePath);
      return judgment;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function runCodexJudge(evidence, options, promptBundle = null) {
  const preparedPrompt = promptBundle || createCodexPromptBundle(evidence);
  const prompt = preparedPrompt.prompt;
  const imagePaths = (evidence?.visualObservation?.codexAttachments || [])
    .map((item) => item.localPath ? path.resolve(REPO_ROOT, item.localPath) : "")
    .filter(Boolean);
  const result = await runCodexExec(options.codexBin, prompt, {
    cwd: REPO_ROOT,
    imagePaths
  });
  const finalText = extractCodexFinalText(result.stdout) || result.stdout;
  return {
    judgment: sanitizeCodexJudgmentForCache(parseJsonObject(finalText), evidence),
    stderr: result.stderr || "",
    promptBudget: preparedPrompt.diagnostics
  };
}

function localHeuristicJudgment(evidence, reason = "Codex judging was skipped.") {
  const relationships = evidence.relationships.map((relationship) => {
    const hints = relationship.hints;
    const scrollDriver = hints.scrollDriver || {
      type: "unknown",
      confidence: 0.25,
      classificationHint: "unknown/needs-review",
      reason: "No scroll-driver evidence was generated."
    };
    let classification = scrollDriver.classificationHint || "unknown/needs-review";
    let confidence = Math.max(0.35, Math.min(0.82, Number(scrollDriver.confidence || 0.35)));

    if (classification === "unknown/needs-review") {
      if (relationship.hasEmbeddedAnimation && hints.scriptSignals.hasScrollScrubbedAnimation) {
        classification = hints.runtimePresence.distinctActiveTextCount > 1 || hints.runtimePresence.activeTextChangeCount > 0
          ? "inter-beat-dynamics"
          : "within-beat-dynamics";
        confidence = Math.max(confidence, classification === "inter-beat-dynamics" ? 0.8 : 0.76);
      } else if (hints.scriptSignals.hasScrollApi && hints.scriptSignals.hasAnimationApi) {
        classification = hints.runtimePresence.distinctActiveTextCount > 1 || hints.runtimePresence.activeTextChangeCount > 0
          ? "inter-beat-dynamics"
          : "within-beat-dynamics";
        confidence = Math.max(confidence, classification === "inter-beat-dynamics" ? 0.68 : 0.62);
      } else if (relationship.hasEmbeddedAnimation && hints.runtimePlayback?.source === "unavailable") {
        classification = "within-beat-dynamics";
        confidence = Math.max(confidence, 0.48);
      } else if (hints.extractedSlidePositions.length > 1) {
        classification = "inter-beat-dynamics";
        confidence = Math.max(confidence, 0.45);
      }
    }
    return {
      relationshipId: relationship.id,
      assetUrl: relationship.assetUrl,
      classification,
      confidence,
      scrollDriver: {
        type: scrollDriver.type,
        confidence: scrollDriver.confidence,
        reason: scrollDriver.reason
      },
      explanation: `${reason} Local heuristic used embedded animation, scroll driver, and scroll/API evidence. Driver: ${scrollDriver.type}. ${scrollDriver.reason}`,
      evidenceRefs: hints.evidenceRefIds.slice(0, 8)
    };
  });

  const hasDirectRuntimeVisibility = Number(evidence.runtimeObservation.summary.directRuntime3DSnapshotCount || 0) > 0;
  const hasTopologyChange = hasDirectRuntimeVisibility
    ? Number(evidence.runtimeObservation.summary.visibleModelSequenceChangeCount || 0) > 0
    : Number(evidence.runtimeObservation.summary.modelSequenceChangeCount || 0) > 0;
  const dominantLogic = hasTopologyChange
    ? "asset-topology-transition"
    : relationships.find((item) => item.classification !== "unknown/needs-review")?.classification || "unknown/needs-review";
  const directlyRuntimeDrivenCount = evidence.relationships.filter((relationship) => (
    !relationship.hasEmbeddedAnimation && relationshipHasDirectRuntimeAnimation(evidence, relationship)
  )).length;

  return {
    storyTitle: evidence.story.title || evidence.story.slug,
    dominantLogic,
    confidence: 0.35,
    overallSummary: `${reason} The local fallback found ${evidence.glbAnimations.animatedModelCount} GLB model(s) with embedded animation and ${directlyRuntimeDrivenCount} additional runtime-driven model(s) among ${evidence.glbAnimations.modelCount} parsed model(s).`,
    summaryMarkdown: fallbackSummaryMarkdown(evidence, dominantLogic, reason),
    assetJudgments: evidence.relationships.filter((relationship) => (
      relationship.hasEmbeddedAnimation || relationshipHasDirectRuntimeAnimation(evidence, relationship)
    )).map((relationship) => {
      const relationshipJudgment = relationships.find((item) => item.assetUrl === relationship.assetUrl);
      const classification = relationshipJudgment?.classification || "unknown/needs-review";
      const directRuntime = directRuntimeAssociationForRelationship(relationship, evidence);
      return {
        assetUrl: relationship.assetUrl,
        assetFile: relationship.assetFile,
        hasEmbeddedAnimation: relationship.hasEmbeddedAnimation,
        classification,
        confidence: relationshipJudgment?.confidence || 0.35,
        scrollDriver: relationshipJudgment?.scrollDriver || null,
        associatedBeats: directRuntime?.associatedBeats || fallbackAssociatedBeatsForRelationship(relationship, classification),
        reasoning: directRuntime?.reasoning || `${reason} This is a deterministic fallback, not a Codex interpretation.`,
        evidenceRefs: directRuntime?.evidenceRefs || relationship.hints.evidenceRefIds.slice(0, 8)
      };
    }),
    relationshipJudgments: relationships,
    investigationSummary: {
      resourcesInspected: [],
      behaviorTrace: {
        modelDiscovery: "Codex judging was not run; this fallback did not inspect fetched resources directly.",
        modelLoading: "Unavailable in local heuristic fallback.",
        visibilityOrSwap: hasDirectRuntimeVisibility
          ? "Direct beat runtime states record sampled render-eligible and hidden model roots; semantic source-code interpretation was not run."
          : "Unavailable in local heuristic fallback.",
        animationDriver: Number(evidence.runtimeObservation.summary.directlyObservedPlayingAnimationCount || 0) > 0
          ? "Direct AnimationAction and mixer observations are preserved in beatRuntimeStates; fetched-code driver semantics were not audited."
          : "Inferred from precomputed scroll/API evidence only.",
        runtimeJsBehavior: "Unavailable in local heuristic fallback.",
        multipleGlbHandling: "Unavailable in local heuristic fallback."
      },
      directEvidence: hasDirectRuntimeVisibility
        ? "Direct runtime model, part, action, mixer, and camera samples are preserved; no fetched-resource Codex audit was performed."
        : "No fetched-resource audit was performed because Codex judging was skipped or failed.",
      remainingGaps: [
        "Run without --no-codex and inspect codex-animation-judgment.json for a resource-level investigation."
      ]
    },
    uncertainties: [
      "This summary was generated without Codex interpretation.",
      "Runtime internals such as Three.js camera objects may not have been accessible from the collector."
    ],
    recommendedStoryVRUse: "Use this as a diagnostic fallback only; rerun without --no-codex for the requested judgment.",
    engine: { provider: "local-heuristic" }
  };
}

function fallbackSummaryMarkdown(evidence, dominantLogic, reason) {
  const animated = evidence.glbAnimations.models.filter((model) => model.hasEmbeddedAnimation);
  const driverCounts = evidence.relationships.reduce((counts, relationship) => {
    const type = relationship.hints?.scrollDriver?.type || "unknown";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const maxDistinctActiveTexts = Math.max(
    0,
    ...evidence.relationships.map((relationship) => Number(relationship.hints?.runtimePresence?.distinctActiveTextCount || 0))
  );
  const maxActiveTextChanges = Math.max(
    0,
    ...evidence.relationships.map((relationship) => Number(relationship.hints?.runtimePresence?.activeTextChangeCount || 0))
  );
  const lines = [
    `# Animation Logic Summary: ${evidence.story.title || evidence.story.slug}`,
    "",
    `Dominant logic: ${dominantLogic}`,
    "",
    reason,
    "",
    `Parsed ${evidence.glbAnimations.modelCount} model(s); ${animated.length} include embedded animation clips.`,
    `Runtime model sequence changes observed: ${evidence.runtimeObservation.summary.modelSequenceChangeCount}.`,
    `Caption/state progression observed: ${maxDistinctActiveTexts} distinct active text state(s), ${maxActiveTextChanges} active text transition(s).`,
    `Scroll drivers: ${Object.entries(driverCounts).map(([type, count]) => `${type}=${count}`).join(", ") || "none"}.`,
    "",
    "## Animated Assets",
    ...animated.map((model) => `- ${model.file}: ${model.animations.map((animation) => `${animation.name || `animation-${animation.index}`} (${animation.duration}s)`).join(", ")}`)
  ];
  return `${lines.join("\n")}\n`;
}

function investigationSummarySection(judgment) {
  const investigation = judgment?.investigationSummary;
  if (!investigation || typeof investigation !== "object") return "";
  const trace = investigation.behaviorTrace && typeof investigation.behaviorTrace === "object"
    ? investigation.behaviorTrace
    : {};
  const resources = Array.isArray(investigation.resourcesInspected)
    ? investigation.resourcesInspected.filter(Boolean)
    : [];
  const gaps = Array.isArray(investigation.remainingGaps)
    ? investigation.remainingGaps.filter(Boolean)
    : [];
  const lines = [
    "## Investigation Notes"
  ];
  if (resources.length) {
    lines.push(`- Resources inspected: ${resources.slice(0, 12).join(", ")}${resources.length > 12 ? `, +${resources.length - 12} more` : ""}.`);
  }
  for (const [label, value] of [
    ["Model discovery", trace.modelDiscovery],
    ["Model loading", trace.modelLoading],
    ["Visibility or swap", trace.visibilityOrSwap],
    ["Animation driver", trace.animationDriver],
    ["Runtime JS behavior", trace.runtimeJsBehavior],
    ["Multiple GLB handling", trace.multipleGlbHandling],
    ["Direct evidence", investigation.directEvidence]
  ]) {
    if (value) lines.push(`- ${label}: ${String(value).replace(/\s+/g, " ").trim()}`);
  }
  if (gaps.length) {
    lines.push(`- Remaining gaps: ${gaps.map((gap) => String(gap).replace(/\s+/g, " ").trim()).join("; ")}`);
  }
  if (lines.length === 1) return "";
  return `${lines.join("\n")}\n`;
}

function normalizedBeatText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAssociatedBeat(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = normalizedBeatText(value);
    return text ? { text, scrollPercent: null, source: "" } : null;
  }
  if (typeof value !== "object") return null;
  const rawText = value.text || value.content || value.beat || value.caption || value.activeText || value.label || "";
  const beatId = String(value.beatId || "");
  const text = normalizedBeatText(rawText) || (beatId ? `Untitled beat (${beatId})` : "");
  if (!text) return null;
  const scrollPercent = Number.isFinite(Number(value.scrollPercent)) ? Number(value.scrollPercent) : null;
  return {
    text,
    scrollPercent,
    source: value.source || value.evidence || value.evidenceType || "",
    beatId,
    snapshotIds: Array.isArray(value.snapshotIds) ? value.snapshotIds.map((item) => String(item || "")).filter(Boolean).slice(0, 80) : [],
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : null
  };
}

function maxAssociatedBeatsForClassification(classification) {
  return /^(within-beat-dynamics|ambient-object-motion)$/i.test(String(classification || "")) ? 1 : 6;
}

function uniqueAssociatedBeats(beats, maxCount) {
  const seen = new Set();
  const normalized = [];
  for (const beat of beats) {
    const item = normalizeAssociatedBeat(beat);
    if (!item) continue;
    const key = item.beatId
      ? `beat:${item.beatId}`
      : `text:${item.text.toLowerCase()}|scroll:${item.scrollPercent ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
    if (normalized.length >= maxCount) break;
  }
  return normalized;
}

function fallbackAssociatedBeatsForRelationship(relationship, classification, source = "inferred-runtime") {
  const runtime = relationship?.hints?.runtimePresence || {};
  const maxCount = maxAssociatedBeatsForClassification(classification);
  const sequence = Array.isArray(runtime.activeTextSequence)
    ? runtime.activeTextSequence.map((item) => ({
      text: item.text,
      scrollPercent: item.scrollPercent,
      source
    }))
    : [];
  const sequenceTexts = new Set(sequence.map((item) => normalizeActiveText(item.text).toLowerCase()));
  const examples = Array.isArray(runtime.activeTextExamples)
    ? runtime.activeTextExamples
      .filter((text) => !sequenceTexts.has(normalizeActiveText(text).toLowerCase()))
      .map((text) => ({ text, scrollPercent: null, source }))
    : [];
  return uniqueAssociatedBeats([...sequence, ...examples], maxCount);
}

function associatedBeatsForRelationship(item, relationship, classification) {
  const maxCount = maxAssociatedBeatsForClassification(classification);
  const returnedBeats = Array.isArray(item?.associatedBeats)
    ? uniqueAssociatedBeats(item.associatedBeats, maxCount)
    : [];
  return returnedBeats.length ? returnedBeats : fallbackAssociatedBeatsForRelationship(relationship, classification);
}

function allBeatAssociationsForRelationship(item, relationship, fallbackSource) {
  const returnedBeats = Array.isArray(item?.associatedBeats)
    ? uniqueAssociatedBeats(item.associatedBeats, 6)
    : [];
  return returnedBeats.length
    ? returnedBeats
    : fallbackAssociatedBeatsForRelationship(relationship, "inter-beat-dynamics", fallbackSource);
}

function clampConfidence(value, fallback = 0.35) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function formatAssociatedBeat(beat, index) {
  const scroll = Number.isFinite(Number(beat.scrollPercent)) ? ` @ ${beat.scrollPercent}%` : "";
  const source = beat.source ? ` [${beat.source}]` : "";
  return `  - Beat ${index + 1}${scroll}${source}: ${beat.text}`;
}

function relationshipForAssetItem(evidence, item) {
  const relationships = Array.isArray(evidence?.relationships) ? evidence.relationships : [];
  const byId = relationships.find((relationship) => relationship.id === item?.relationshipId);
  if (byId) return byId;
  const itemUrlKey = normalizeAssetKey(item?.assetUrl);
  const byUrl = itemUrlKey
    ? relationships.find((relationship) => normalizeAssetKey(relationship.assetUrl) === itemUrlKey)
    : null;
  if (byUrl) return byUrl;
  const byFile = relationships.filter((relationship) => item?.assetFile && relationship.assetFile === item.assetFile);
  return byFile.length === 1 ? byFile[0] : null;
}

function directRuntimeModelsForRelationship(evidence, relationship) {
  const beats = Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
    ? evidence.runtimeObservation.beatRuntimeStates
    : [];
  return beats.flatMap((beat) => (
    [...(beat.visibleModels || []), ...(beat.renderActiveModels || [])].filter((model) => (
      model.relationshipId === relationship?.id
      || normalizeAssetKey(model.assetUrl) === normalizeAssetKey(relationship?.assetUrl)
    ))
  ));
}

function relationshipHasDirectRuntimeAnimation(evidence, relationship) {
  return directRuntimeModelsForRelationship(evidence, relationship)
    .some((model) => (
      (Array.isArray(model.playingAnimations) && model.playingAnimations.length > 0)
      || (Array.isArray(model.partStateChanges) && model.partStateChanges.length > 0)
    ));
}

function itemForRelationship(items, relationship, evidence) {
  const byId = items.find((item) => item?.relationshipId === relationship.id);
  if (byId) return byId;
  const relationshipUrlKey = normalizeAssetKey(relationship.assetUrl);
  const byUrl = relationshipUrlKey
    ? items.find((item) => normalizeAssetKey(item?.assetUrl) === relationshipUrlKey)
    : null;
  if (byUrl) return byUrl;
  const relationships = Array.isArray(evidence?.relationships) ? evidence.relationships : [];
  const fileIsUnique = relationships.filter((candidate) => candidate.assetFile === relationship.assetFile).length === 1;
  if (!fileIsUnique) return null;
  const fileMatches = items.filter((item) => item?.assetFile === relationship.assetFile);
  return fileMatches.length === 1 ? fileMatches[0] : null;
}

function judgmentForAsset(judgment, relationship, evidence) {
  const assetJudgments = Array.isArray(judgment.assetJudgments) ? judgment.assetJudgments : [];
  const relationshipJudgments = Array.isArray(judgment.relationshipJudgments) ? judgment.relationshipJudgments : [];
  return itemForRelationship(assetJudgments, relationship, evidence)
    || itemForRelationship(relationshipJudgments, relationship, evidence)
    || null;
}

function associationInputForRelationship(judgment, relationship, evidence) {
  const associations = Array.isArray(judgment.modelBeatAssociations) ? judgment.modelBeatAssociations : [];
  return itemForRelationship(associations, relationship, evidence);
}

function imageAssociationInputForAsset(judgment, imageAsset) {
  const associations = Array.isArray(judgment.imageBeatAssociations) ? judgment.imageBeatAssociations : [];
  const urls = new Set([imageAsset.url, ...(Array.isArray(imageAsset.urls) ? imageAsset.urls : [])]
    .map((url) => normalizeUrl(url))
    .filter(Boolean));
  return associations.find((item) => (
    item.imageGroupId === imageAsset.id
    || item.id === imageAsset.id
    || (item.assetUrl && urls.has(normalizeUrl(item.assetUrl)))
    || (item.url && urls.has(normalizeUrl(item.url)))
  )) || null;
}

function fallbackAssociatedBeatsForImageAsset(imageAsset) {
  const beats = [];
  if (imageAsset?.caption) {
    beats.push({
      text: imageAsset.caption,
      scrollPercent: null,
      source: "direct"
    });
  }
  return uniqueAssociatedBeats(beats, 4);
}

function imageBeatAssociationsForJudgment(judgment, evidence) {
  const imageAssets = Array.isArray(evidence?.imageAssets) ? evidence.imageAssets : [];
  return imageAssets.map((imageAsset) => {
    const input = imageAssociationInputForAsset(judgment, imageAsset);
    const associatedBeats = Array.isArray(input?.associatedBeats) && input.associatedBeats.length
      ? uniqueAssociatedBeats(input.associatedBeats, 6)
      : fallbackAssociatedBeatsForImageAsset(imageAsset);
    const hasCaptionFallback = associatedBeats.length > 0 && !input;
    return {
      imageGroupId: imageAsset.id,
      assetUrl: input?.assetUrl || input?.url || imageAsset.url || "",
      urls: imageAsset.urls || [],
      caption: imageAsset.caption || "",
      credits: imageAsset.credits || [],
      associatedBeats,
      associationConfidence: clampConfidence(input?.associationConfidence ?? input?.confidence, hasCaptionFallback ? 0.62 : 0.25),
      associationSource: input?.associationSource || input?.source || (hasCaptionFallback ? "direct" : "unknown"),
      reasoning: input?.reasoning || (
        hasCaptionFallback
          ? "Associated by the accepted image group's own caption because no Codex image-beat association was returned."
          : "No Codex image-beat association was returned and no caption beat was available."
      ),
      evidenceRefs: Array.isArray(input?.evidenceRefs) ? input.evidenceRefs.slice(0, 8) : []
    };
  });
}

function relationshipLooksPreloaded(relationship, evidence) {
  if (relationship?.hints?.runtimeVisibility?.directlyObserved || relationship?.hints?.runtimeVisibility?.authoritativeCaptureAvailable) return false;
  const totalSnapshots = Array.isArray(evidence?.runtimeObservation?.snapshots)
    ? evidence.runtimeObservation.snapshots.length
    : Number(evidence?.runtimeObservation?.summary?.snapshotCount || 0);
  const snapshotCount = Number(
    relationship?.hints?.runtimePresence?.inventorySnapshotCount
    ?? relationship?.hints?.runtimePresence?.snapshotCount
    ?? 0
  );
  const relationshipCount = Array.isArray(evidence?.relationships) ? evidence.relationships.length : 0;
  return relationshipCount > 1 && totalSnapshots > 1 && snapshotCount >= totalSnapshots;
}

function directRuntimeAssociationForRelationship(relationship, evidence) {
  const beatStates = Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
    ? evidence.runtimeObservation.beatRuntimeStates
    : [];
  const matches = [];
  const evidenceRefs = [];
  const identitySources = [];
  for (const beat of beatStates) {
    const visibleModel = (beat.visibleModels || []).find((item) => (
      item.relationshipId === relationship.id
      || normalizeAssetKey(item.assetUrl) === normalizeAssetKey(relationship.assetUrl)
    ));
    const model = visibleModel || (beat.renderActiveModels || []).find((item) => (
      item.relationshipId === relationship.id
      || normalizeAssetKey(item.assetUrl) === normalizeAssetKey(relationship.assetUrl)
    ));
    if (!model) continue;
    const directlyVisible = Boolean(visibleModel);
    const directIdentity = directlyVisible && model.assetIdentitySource === "direct-runtime";
    matches.push({
      text: beat.text,
      scrollPercent: Array.isArray(beat.scrollRange) ? beat.scrollRange[0] : null,
      source: directIdentity ? "direct-runtime" : "inferred-runtime",
      beatId: beat.beatId,
      snapshotIds: beat.snapshotIds,
      confidence: directIdentity ? 0.96 : directlyVisible ? 0.78 : 0.68
    });
    evidenceRefs.push(...(beat.snapshotIds || []));
    identitySources.push(directIdentity ? "direct-runtime" : directlyVisible ? "inferred-runtime" : "render-active-offscreen");
  }
  if (!matches.length) return null;
  const directIdentity = identitySources.every((source) => source === "direct-runtime");
  const hasOffscreenCandidate = identitySources.includes("render-active-offscreen");
  return {
    associatedBeats: uniqueAssociatedBeats(matches, Number.MAX_SAFE_INTEGER),
    associationSource: directIdentity ? "direct-runtime" : "inferred-runtime",
    associationConfidence: directIdentity ? 0.96 : hasOffscreenCandidate ? 0.68 : 0.78,
    reasoning: directIdentity
      ? "The runtime collector directly observed this identified GLB as render-eligible in the listed beat snapshots."
      : hasOffscreenCandidate
        ? "The runtime collector observed this model in an active offscreen render pass. It may contribute through postprocessing, but on-canvas visibility requires source/compositor confirmation."
        : "The runtime collector directly observed a render-eligible model root, but its mapping to this GLB used runtime identity inference.",
    evidenceRefs: Array.from(new Set(evidenceRefs)).slice(0, 16)
  };
}

function associatedBeatKey(beat) {
  const item = normalizeAssociatedBeat(beat);
  if (!item) return "";
  return item.beatId
    ? `beat:${item.beatId}`
    : `text:${item.text.toLowerCase()}|scroll:${item.scrollPercent ?? ""}`;
}

function associatedBeatAliasKeys(beat) {
  const item = normalizeAssociatedBeat(beat);
  if (!item) return [];
  return [
    item.beatId ? `beat:${item.beatId}` : "",
    `text:${item.text.toLowerCase()}|scroll:${item.scrollPercent ?? ""}`,
    `text-only:${item.text.toLowerCase()}`
  ].filter(Boolean);
}

function sourceAssociatedBeats(input, defaultSource, maxCount = MAX_AI_ASSOCIATED_BEATS) {
  if (!Array.isArray(input?.associatedBeats)) return [];
  return uniqueAssociatedBeats(input.associatedBeats, maxCount).map((beat) => {
    const allowed = new Set(["direct-runtime", "direct-source-config", "inferred-runtime", "inferred-source", "inferred-preload-based", "unknown"]);
    let source = beat.source || defaultSource || "inferred-source";
    if (!allowed.has(source)) source = source === "direct" ? "inferred-source" : "unknown";
    // Direct runtime associations are reconstructed from current beatRuntimeStates.
    // AI/source payloads cannot independently promote a beat to direct provenance.
    if (source === "direct-runtime") source = "inferred-runtime";
    return {
      ...beat,
      source,
      confidence: beat.confidence ?? clampConfidence(input.associationConfidence ?? input.confidence, 0.45)
    };
  });
}

function fallbackAssociationMetadata(relationship, evidence) {
  const runtime = relationship?.hints?.runtimePresence || {};
  const visibility = relationship?.hints?.runtimeVisibility || {};
  const evidenceRefs = relationship?.hints?.evidenceRefIds || [];
  const directRuntime = directRuntimeAssociationForRelationship(relationship, evidence);
  if (directRuntime) return directRuntime;
  if (visibility.directlyObserved && Number(visibility.visibleSnapshotCount || 0) === 0) {
    return {
      associationSource: "unknown",
      associationConfidence: 0.88,
      reasoning: "Direct runtime capture identified this model root but observed it hidden or non-render-eligible in every sampled beat. Resource URLs are not used as a visibility fallback."
    };
  }
  if (visibility.authoritativeCaptureAvailable && !visibility.directlyObserved) {
    return {
      associationSource: "unknown",
      associationConfidence: 0.82,
      reasoning: "Authoritative runtime snapshots were captured but did not identify this GLB in the observed scene state. Resource URLs are not used as a visibility fallback."
    };
  }
  if (relationshipLooksPreloaded(relationship, evidence)) {
    return {
      associationSource: "inferred-preload-based",
      associationConfidence: 0.42,
      reasoning: "Resource snapshots include this GLB in every sampled state, so the beat mapping is treated as a preload-based inference rather than direct visible-state proof."
    };
  }
  if (Number(runtime.snapshotCount || 0) > 0) {
    return {
      associationSource: "inferred-runtime",
      associationConfidence: relationship.hasEmbeddedAnimation ? 0.62 : 0.54,
      reasoning: "Beat content was inferred from runtime snapshots that referenced this GLB relationship."
    };
  }
  if (evidenceRefs.length) {
    return {
      associationSource: "inferred-source",
      associationConfidence: 0.45,
      reasoning: "Beat content was inferred from fetched source evidence because runtime visibility could not isolate this GLB."
    };
  }
  return {
    associationSource: "unknown",
    associationConfidence: 0.25,
    reasoning: "The collected evidence did not isolate beat content for this GLB."
  };
}

function inferredAssociationConfidenceCeiling(evidence, associatedBeats) {
  const sources = new Set((associatedBeats || []).map((beat) => beat?.source).filter(Boolean));
  if (sources.size > 0 && Array.from(sources).every((source) => source === "direct-source-config")) {
    return { value: 0.95, reason: "explicit-source-config" };
  }
  const visualAvailable = Number(evidence?.globalSignals?.scrollTargetScreenshotCount || 0) > 0;
  return visualAvailable
    ? { value: 0.85, reason: "visual-without-direct-runtime-identity" }
    : { value: 0.72, reason: "no-direct-runtime-or-visual-identity" };
}

function modelBeatAssociationsForJudgment(judgment, evidence) {
  const relationships = Array.isArray(evidence?.relationships) ? evidence.relationships : [];
  return relationships.map((relationship) => {
    const directRuntime = directRuntimeAssociationForRelationship(relationship, evidence);
    const associationInput = associationInputForRelationship(judgment, relationship, evidence);
    const dynamicInput = judgmentForAsset(judgment, relationship, evidence);
    const sourceBeatInput = associationInput || (Array.isArray(dynamicInput?.associatedBeats) ? dynamicInput : null);
    const fallback = fallbackAssociationMetadata(relationship, evidence);
    const directBeats = directRuntime?.associatedBeats || [];
    const sourceDefault = associationInput?.associationSource
      || associationInput?.source
      || (sourceBeatInput === dynamicInput ? "inferred-source" : fallback.associationSource);
    const sourceBeats = sourceAssociatedBeats(sourceBeatInput, sourceDefault);
    const sourceBeatInputCount = Array.isArray(sourceBeatInput?.associatedBeats) ? sourceBeatInput.associatedBeats.length : 0;
    const directBeatKeys = new Set(directBeats.flatMap(associatedBeatAliasKeys));
    const directTextCounts = new Map();
    for (const beat of directBeats) {
      const text = normalizeAssociatedBeat(beat)?.text.toLowerCase();
      if (text) directTextCounts.set(text, (directTextCounts.get(text) || 0) + 1);
    }
    const sourceOnlyBeats = sourceBeats.filter((beat) => {
      const normalized = normalizeAssociatedBeat(beat);
      if (!normalized) return false;
      const aliases = associatedBeatAliasKeys(normalized);
      if (aliases.some((key) => directBeatKeys.has(key) && !key.startsWith("text-only:"))) return false;
      return !(
        !normalized.beatId
        && directTextCounts.get(normalized.text.toLowerCase()) === 1
        && directBeatKeys.has(`text-only:${normalized.text.toLowerCase()}`)
      );
    });
    const associatedBeats = directRuntime
      ? uniqueAssociatedBeats([...directBeats, ...sourceOnlyBeats], Number.MAX_SAFE_INTEGER)
      : sourceBeats.length
        ? uniqueAssociatedBeats(sourceBeats, MAX_AI_ASSOCIATED_BEATS)
        : fallbackAssociatedBeatsForRelationship(relationship, judgmentForAsset(judgment, relationship, evidence)?.classification, fallback.associationSource);
    const associationSources = Array.from(new Set([
      directRuntime?.associationSource,
      ...sourceOnlyBeats.map((beat) => beat.source || sourceDefault),
      !directRuntime && !sourceOnlyBeats.length ? fallback.associationSource : ""
    ].filter(Boolean)));
    const associationSource = associationSources.length > 1 ? "mixed" : associationSources[0] || fallback.associationSource;
    const sourceConfidence = clampConfidence(
      associationInput?.associationConfidence
        ?? associationInput?.confidence
        ?? (relationship.hasEmbeddedAnimation ? dynamicInput?.confidence : undefined),
      fallback.associationConfidence
    );
    const associationConfidence = directRuntime && sourceOnlyBeats.length
      ? Math.min(directRuntime.associationConfidence, sourceConfidence)
      : directRuntime?.associationConfidence ?? sourceConfidence;
    const confidenceCeiling = directRuntime
      ? { value: 1, reason: "direct-runtime" }
      : inferredAssociationConfidenceCeiling(evidence, associatedBeats);
    const normalizedAssociationConfidence = Math.min(
      clampConfidence(associationConfidence, fallback.associationConfidence),
      confidenceCeiling.value
    );
    const evidenceRefs = Array.from(new Set([
      ...(directRuntime?.evidenceRefs || []),
      ...(associationInput?.evidenceRefs || []),
      ...(dynamicInput?.evidenceRefs || []),
      ...(relationship.hints?.evidenceRefIds || [])
    ]));

    return {
      assetUrl: relationship.assetUrl,
      assetFile: relationship.assetFile,
      parseStatus: relationship.parseStatus || "unknown",
      parseError: relationship.parseError || "",
      hasEmbeddedAnimation: Boolean(relationship.hasEmbeddedAnimation),
      associatedBeats,
      associationConfidence: normalizedAssociationConfidence,
      confidenceCalibration: {
        ceiling: confidenceCeiling.value,
        reason: confidenceCeiling.reason,
        applied: normalizedAssociationConfidence < clampConfidence(associationConfidence, fallback.associationConfidence)
      },
      associationSource,
      associationSources,
      associationTruncation: {
        aiSourceBeatCount: sourceBeatInputCount,
        aiSourceBeatRetainedCount: sourceBeats.length,
        aiSourceBeatsTruncated: sourceBeatInputCount > sourceBeats.length
      },
      reasoning: directRuntime
        ? `${directRuntime.reasoning}${sourceOnlyBeats.length ? " Additional fetched-source/Codex beats are retained with their own beat-level provenance; the top-level association is mixed." : ""}`
        : associationInput?.reasoning || (
        sourceBeatInput === dynamicInput && dynamicInput?.reasoning
          ? dynamicInput.reasoning
          : fallback.reasoning
      ),
      evidenceRefs: evidenceRefs.slice(0, 24)
    };
  });
}

function interpretationInputForRelationship(judgment, relationship, evidence) {
  const interpretations = Array.isArray(judgment.glbAnimationInterpretations) ? judgment.glbAnimationInterpretations : [];
  return itemForRelationship(interpretations, relationship, evidence);
}

function normalizeTriggerMapping(triggerMapping, relationship) {
  const scrollDriver = relationship?.hints?.scrollDriver || {};
  return {
    type: triggerMapping?.type || scrollDriver.type || "unknown",
    localFormula: triggerMapping?.localFormula ?? null,
    fullPageFormula: triggerMapping?.fullPageFormula ?? null,
    confidence: clampConfidence(triggerMapping?.confidence ?? scrollDriver.confidence, 0.25),
    evidenceRefs: Array.isArray(triggerMapping?.evidenceRefs)
      ? triggerMapping.evidenceRefs.slice(0, 8)
      : relationship?.hints?.evidenceRefIds?.slice(0, 8) || [],
    reasoning: triggerMapping?.reasoning || scrollDriver.reason || "No trigger mapping interpretation was returned."
  };
}

function glbAnimationInterpretationsForJudgment(judgment, evidence) {
  const relationships = Array.isArray(evidence?.relationships) ? evidence.relationships : [];
  return relationships.flatMap((relationship) => {
    const input = interpretationInputForRelationship(judgment, relationship, evidence);
    const directlyRuntimeDriven = relationshipHasDirectRuntimeAnimation(evidence, relationship);
    const runtimeDriven = Boolean(input?.runtimeJsBehavior?.isRuntimeDriven) || directlyRuntimeDriven;
    if (!relationship.hasEmbeddedAnimation && !runtimeDriven && !input) return [];
    const assetJudgment = judgmentForAsset(judgment, relationship, evidence);
    const classification = input?.classification
      || assetJudgment?.classification
      || relationship.hints?.scrollDriver?.classificationHint
      || "unknown/needs-review";
    return [{
      assetUrl: relationship.assetUrl,
      assetFile: relationship.assetFile,
      hasEmbeddedAnimation: Boolean(relationship.hasEmbeddedAnimation),
      hasCameraPath: Boolean(input?.hasCameraPath ?? relationship.hasCameraAnimation),
      classification,
      triggerMapping: normalizeTriggerMapping(input?.triggerMapping, relationship),
      runtimeJsBehavior: {
        isRuntimeDriven: runtimeDriven,
        summary: input?.runtimeJsBehavior?.summary || (
          directlyRuntimeDriven
            ? "Direct runtime beat snapshots observed playing AnimationActions and/or sampled renderable-part motion or opacity changes for this model relationship."
            : relationship.hasEmbeddedAnimation
            ? "No detailed runtime JS behavior interpretation was returned; see trigger mapping and asset judgment."
            : "No runtime JS behavior was proven for this static GLB."
        ),
        evidenceRefs: Array.isArray(input?.runtimeJsBehavior?.evidenceRefs)
          ? input.runtimeJsBehavior.evidenceRefs.slice(0, 8)
          : []
      },
      clips: Array.isArray(input?.clips) ? [...input.clips].map((clip) => ({
        ...clip,
        associatedBeats: sourceAssociatedBeats(clip, "inferred-source")
      })).sort((left, right) => {
        const animationIndex = (clip) => {
          if (Number.isInteger(clip?.animationIndex)) return clip.animationIndex;
          const name = clip?.animationName || clip?.name || "";
          const match = relationship.animations?.find((animation) => animation.name === name);
          return match?.index ?? Number.MAX_SAFE_INTEGER;
        };
        return animationIndex(left) - animationIndex(right)
          || stableCompare(String(left?.animationName || left?.name || ""), String(right?.animationName || right?.name || ""));
      }).slice(0, 80) : [],
      cameraPath: input?.cameraPath ? {
        ...input.cameraPath,
        associatedBeats: sourceAssociatedBeats(input.cameraPath, "inferred-source")
      } : {
        hasCameraPath: Boolean(relationship.hasCameraAnimation),
        driver: relationship.hasCameraAnimation ? "embedded-animation" : "",
        summary: relationship.hasCameraAnimation
          ? "Camera animation exists in the GLB summary, but Codex did not return a detailed camera path interpretation."
          : "No camera path detected in the GLB summary.",
        associatedBeats: [],
        evidenceRefs: relationship.hints?.evidenceRefIds?.slice(0, 8) || []
      },
      reasoning: input?.reasoning || assetJudgment?.reasoning || "No detailed GLB animation interpretation was returned.",
      evidenceRefs: Array.isArray(input?.evidenceRefs) && input.evidenceRefs.length
        ? input.evidenceRefs.slice(0, 8)
        : relationship.hints?.evidenceRefIds?.slice(0, 8) || []
    }];
  });
}

function inferredStateInputForRelationship(judgment, relationship, evidence) {
  const states = Array.isArray(judgment?.inferredBeatAssetStates) ? judgment.inferredBeatAssetStates : [];
  const provenanceOrder = { "direct-source-config": 0, "inferred-runtime": 1, "inferred-source": 2, "inferred-preload-based": 3, unknown: 4 };
  return states
    .filter((state) => itemForRelationship([state], relationship, evidence) === state)
    .sort((left, right) => (
      (provenanceOrder[inferredProvenance(left?.provenance || left?.source)] ?? 4)
        - (provenanceOrder[inferredProvenance(right?.provenance || right?.source)] ?? 4)
      || clampConfidence(right?.confidence, 0) - clampConfidence(left?.confidence, 0)
      || stableCompare(JSON.stringify(canonicalObjectKeys(left)), JSON.stringify(canonicalObjectKeys(right)))
    ));
}

function inferredBeatMatches(left, right) {
  const leftBeat = normalizeAssociatedBeat(left);
  const rightBeat = normalizeAssociatedBeat(right);
  if (!leftBeat || !rightBeat) return false;
  if (leftBeat.beatId && rightBeat.beatId) return leftBeat.beatId === rightBeat.beatId;
  if (normalizeActiveText(leftBeat.text).toLowerCase() !== normalizeActiveText(rightBeat.text).toLowerCase()) return false;
  if (Number.isFinite(leftBeat.scrollPercent) && Number.isFinite(rightBeat.scrollPercent)) {
    return Math.abs(leftBeat.scrollPercent - rightBeat.scrollPercent) <= 0.5;
  }
  return true;
}

function inferredProvenance(value, fallback = "unknown") {
  const allowed = new Set(["direct-source-config", "inferred-runtime", "inferred-source", "inferred-preload-based", "unknown"]);
  const source = value === "direct-runtime" ? "inferred-runtime" : String(value || fallback);
  return allowed.has(source) ? source : fallback;
}

function normalizeInferredPart(part, fallbackProvenance) {
  if (!part || typeof part !== "object") return null;
  const name = String(part.name || part.nodeName || "").slice(0, 240);
  const nodePath = String(part.nodePath || "").slice(0, 800);
  if (!name && !nodePath) return null;
  const allowedStates = new Set(["visible", "active", "hidden", "unknown"]);
  const visibilityState = allowedStates.has(part.visibilityState) ? part.visibilityState : "unknown";
  return {
    name,
    nodePath,
    role: String(part.role || "unknown").slice(0, 240),
    visibilityState,
    confidence: clampConfidence(part.confidence, 0.35),
    provenance: inferredProvenance(part.provenance || part.source, fallbackProvenance),
    reasoning: String(part.reasoning || "").slice(0, 1200),
    evidenceRefs: stableStringSet(part.evidenceRefs).slice(0, 24)
  };
}

function normalizeInferredAnimation(animation, fallbackProvenance) {
  if (!animation || typeof animation !== "object") return null;
  const clipName = String(animation.clipName || animation.animationName || animation.name || "").slice(0, 260);
  const clipIndex = Number.isInteger(Number(animation.clipIndex ?? animation.animationIndex))
    ? Number(animation.clipIndex ?? animation.animationIndex)
    : null;
  if (!clipName && clipIndex === null) return null;
  const allowedPlayStates = new Set(["playing", "active", "paused", "stopped", "unknown"]);
  const allowedModes = new Set(["time-based", "scroll-based", "state-based", "mixed", "unknown"]);
  const driverMode = allowedModes.has(animation.driverMode || animation.playbackMode)
    ? animation.driverMode || animation.playbackMode
    : "unknown";
  return {
    clipIndex,
    clipName,
    playState: allowedPlayStates.has(animation.playState) ? animation.playState : "unknown",
    driverMode,
    scrollDriverType: SCROLL_DRIVERS.includes(animation.scrollDriverType) ? animation.scrollDriverType : "unknown",
    triggerMechanism: String(animation.triggerMechanism || "unknown").slice(0, 160),
    targetParts: stableStringSet(animation.targetParts || animation.targetNodeNames).slice(0, 40),
    confidence: clampConfidence(animation.confidence, 0.35),
    provenance: inferredProvenance(animation.provenance || animation.source, fallbackProvenance),
    reasoning: String(animation.reasoning || "").slice(0, 1200),
    evidenceRefs: stableStringSet(animation.evidenceRefs).slice(0, 24)
  };
}

function directVisibleModelForAssociationBeat(evidence, relationship, associatedBeat) {
  const beats = Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
    ? evidence.runtimeObservation.beatRuntimeStates
    : [];
  const candidates = beats.filter((beat) => inferredBeatMatches(beat, associatedBeat));
  if (candidates.length !== 1 && !associatedBeat?.beatId) return null;
  const beat = candidates.find((item) => !associatedBeat?.beatId || item.beatId === associatedBeat.beatId) || candidates[0];
  return (beat?.visibleModels || []).find((model) => (
    model.relationshipId === relationship.id
    || normalizeAssetKey(model.assetUrl) === normalizeAssetKey(relationship.assetUrl)
  )) || null;
}

function renderActiveModelForAssociationBeat(evidence, relationship, associatedBeat) {
  const beats = Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
    ? evidence.runtimeObservation.beatRuntimeStates
    : [];
  const candidates = beats.filter((beat) => inferredBeatMatches(beat, associatedBeat));
  if (candidates.length !== 1 && !associatedBeat?.beatId) return null;
  const beat = candidates.find((item) => !associatedBeat?.beatId || item.beatId === associatedBeat.beatId) || candidates[0];
  return (beat?.renderActiveModels || []).find((model) => (
    model.relationshipId === relationship.id
    || normalizeAssetKey(model.assetUrl) === normalizeAssetKey(relationship.assetUrl)
  )) || null;
}

function directHiddenOrAbsentForAssociationBeat(evidence, relationship, associatedBeat) {
  const beats = Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
    ? evidence.runtimeObservation.beatRuntimeStates
    : [];
  const candidates = beats.filter((beat) => inferredBeatMatches(beat, associatedBeat));
  if (candidates.length !== 1 && !associatedBeat?.beatId) return null;
  const beat = candidates.find((item) => !associatedBeat?.beatId || item.beatId === associatedBeat.beatId) || candidates[0];
  if (!beat) return null;
  const hiddenModel = (beat.observedHiddenModels || []).find((model) => (
    model.relationshipId === relationship.id
    || normalizeAssetKey(model.assetUrl) === normalizeAssetKey(relationship.assetUrl)
  ));
  if (hiddenModel) return { state: "hidden", beat, model: hiddenModel };
  if (beat.assetCoverageComplete) {
    const anyModel = [...(beat.visibleModels || []), ...(beat.renderActiveModels || [])].some((model) => (
      model.relationshipId === relationship.id
      || normalizeAssetKey(model.assetUrl) === normalizeAssetKey(relationship.assetUrl)
    ));
    if (!anyModel) return { state: "absent", beat, model: null };
  }
  return null;
}

function inferredAnimationsFromInterpretation(judgment, relationship, beat) {
  const interpretation = glbAnimationInterpretationsForJudgment(judgment, { relationships: [relationship] })[0];
  if (!interpretation) return [];
  const triggerType = interpretation.triggerMapping?.type || "unknown";
  const driverMode = triggerType === "time-based"
    ? "time-based"
    : ["local-scroll-window-progress", "slide-indexed-scroll-transition", "absolute-page-scroll"].includes(triggerType)
      ? "scroll-based"
      : "unknown";
  return (interpretation.clips || []).filter((clip) => (
    (clip.associatedBeats || []).some((candidate) => inferredBeatMatches(candidate, beat))
  )).map((clip) => normalizeInferredAnimation({
    clipName: clip.animationName || clip.name,
    clipIndex: clip.animationIndex,
    playState: "unknown",
    driverMode,
    scrollDriverType: triggerType,
    triggerMechanism: clip.triggerMechanism,
    targetParts: clip.targetNodes || clip.targetNodeNames,
    confidence: clip.confidence,
    provenance: (clip.associatedBeats || []).find((candidate) => inferredBeatMatches(candidate, beat))?.source || "inferred-source",
    reasoning: clip.reasoning,
    evidenceRefs: interpretation.evidenceRefs
  }, "inferred-source")).filter(Boolean);
}

function inferredBeatAssetStatesForJudgment(judgment, evidence) {
  const associations = modelBeatAssociationsForJudgment(judgment, evidence);
  const states = [];
  for (const association of associations) {
    const relationship = relationshipForAssetItem(evidence, association);
    if (!relationship) continue;
    const inputs = inferredStateInputForRelationship(judgment, relationship, evidence);
    for (const beat of association.associatedBeats || []) {
      const directVisibleModel = directVisibleModelForAssociationBeat(evidence, relationship, beat);
      const directNegativeState = directHiddenOrAbsentForAssociationBeat(evidence, relationship, beat);
      if (directNegativeState) continue;
      const input = inputs.find((candidate) => inferredBeatMatches(candidate, beat));
      const renderActiveModel = renderActiveModelForAssociationBeat(evidence, relationship, beat);
      const directPartsComplete = Boolean(
        directVisibleModel
        && !directVisibleModel.visiblePartTruncated
        && Array.isArray(directVisibleModel.visibleParts)
        && directVisibleModel.visibleParts.length > 0
      );
      const directActionsComplete = Boolean(
        directVisibleModel
        && !directVisibleModel.actionStatesTruncated
        && Number(directVisibleModel.mixerCount || 0) > 0
      );
      const inputHasAnimationState = Boolean(
        (Array.isArray(input?.animations) && input.animations.length)
        || (Array.isArray(input?.playingAnimations) && input.playingAnimations.length)
      );
      const sourceInterpretation = interpretationInputForRelationship(judgment, relationship, evidence);
      const sourceHasRuntimeBehavior = Boolean(sourceInterpretation?.runtimeJsBehavior?.isRuntimeDriven);
      const needsDirectSupplement = Boolean(directVisibleModel && (
        !directPartsComplete
        || (!directActionsComplete && (relationship.hasEmbeddedAnimation || inputHasAnimationState || sourceHasRuntimeBehavior))
      ));
      if (directVisibleModel && !needsDirectSupplement) continue;
      if (!input && beat.source === "inferred-preload-based") continue;
      const provenance = inferredProvenance(
        input?.provenance || input?.source || (renderActiveModel ? "inferred-runtime" : beat.source),
        beat.source === "direct-source-config" ? "direct-source-config" : "inferred-source"
      );
      const allowedVisibility = new Set(["visible", "active", "hidden", "unknown"]);
      const visibilityState = directVisibleModel
        ? "unknown"
        : allowedVisibility.has(input?.modelVisibility?.state || input?.visibilityState)
        ? input?.modelVisibility?.state || input?.visibilityState
        : renderActiveModel ? "active" : "unknown";
      const inputParts = directPartsComplete
        ? []
        : Array.isArray(input?.parts)
        ? input.parts
        : Array.isArray(input?.visibleParts)
          ? input.visibleParts
          : (renderActiveModel?.visibleParts || []).map((part) => ({
            name: part.name,
            nodePath: part.nodePath,
            role: "offscreen-renderable-part",
            visibilityState: "active",
            confidence: 0.68,
            provenance: "inferred-runtime",
            reasoning: "The part was render-eligible in an active offscreen pass; final compositor visibility was not directly proven.",
            evidenceRefs: part.snapshotIds
          }));
      const inferenceConfidenceCeiling = clampConfidence(association.associationConfidence, 0.35);
      const parts = semanticSort(inputParts
        .map((part) => normalizeInferredPart(part, provenance))
        .filter(Boolean)
        .map((part) => ({ ...part, confidence: Math.min(part.confidence, inferenceConfidenceCeiling) })));
      const inputAnimations = directActionsComplete
        ? []
        : Array.isArray(input?.animations)
        ? input.animations
        : Array.isArray(input?.playingAnimations)
          ? input.playingAnimations
          : (renderActiveModel?.playingAnimations || []).map((animation) => ({
            clipIndex: animation.clipIndex,
            clipName: animation.clipName,
            playState: "playing",
            driverMode: animation.playback?.mode || "unknown",
            scrollDriverType: "unknown",
            triggerMechanism: animation.playback?.mechanism || "mixer-time",
            targetParts: animation.targetParts?.map((part) => part.nodeName || part.nodePath) || animation.targetNodeNames,
            confidence: Math.min(0.75, animation.playback?.confidence || 0.68),
            provenance: "inferred-runtime",
            reasoning: "The action was playing on a render-active offscreen model; final on-canvas contribution was not directly proven.",
            evidenceRefs: animation.snapshotIds
          }));
      const returnedAnimations = inputAnimations
        .map((animation) => normalizeInferredAnimation(animation, provenance))
        .filter(Boolean);
      const animations = directActionsComplete
        ? []
        : returnedAnimations.length
          ? semanticSort(returnedAnimations.map((animation) => ({
            ...animation,
            confidence: Math.min(animation.confidence, inferenceConfidenceCeiling)
          })))
          : semanticSort(inferredAnimationsFromInterpretation(judgment, relationship, beat).map((animation) => ({
            ...animation,
            confidence: Math.min(animation.confidence, inferenceConfidenceCeiling)
          })));
      states.push({
        beatId: beat.beatId || input?.beatId || "",
        text: beat.text,
        scrollPercent: beat.scrollPercent,
        relationshipId: relationship.id,
        assetUrl: relationship.assetUrl,
        assetFile: relationship.assetFile,
        modelVisibility: {
          state: visibilityState,
          confidence: Math.min(
            clampConfidence(input?.modelVisibility?.confidence ?? input?.confidence ?? (renderActiveModel ? 0.68 : undefined), 0.35),
            inferenceConfidenceCeiling
          ),
          provenance: inferredProvenance(input?.modelVisibility?.provenance || provenance, provenance),
          reasoning: String(directVisibleModel
            ? "On-canvas model visibility is already authoritative in beatRuntimeStates; this inferred record only supplements missing or truncated part/animation fields."
            : input?.modelVisibility?.reasoning || input?.reasoning || (renderActiveModel
            ? "The model was render-active in a visible-canvas offscreen pass; final on-canvas contribution requires compositor/source confirmation."
            : "Model-to-beat association exists, but direct on-canvas runtime visibility was not captured.")).slice(0, 1400)
        },
        supplementsDirectRuntime: Boolean(directVisibleModel),
        directFieldCoverage: {
          modelVisibility: Boolean(directVisibleModel),
          partsComplete: directPartsComplete,
          actionsComplete: directActionsComplete
        },
        parts,
        animations,
        provenance,
        confidence: Math.min(
          clampConfidence(input?.confidence ?? (renderActiveModel ? 0.68 : undefined), association.associationConfidence || 0.35),
          inferenceConfidenceCeiling
        ),
        reasoning: String(input?.reasoning || association.reasoning || "").slice(0, 1600),
        evidenceRefs: stableStringSet([...(input?.evidenceRefs || []), ...(association.evidenceRefs || [])]).slice(0, 32)
      });
    }
  }
  return sortInferredBeatAssetStates(states, evidence)
    .slice(0, MAX_AI_ASSOCIATED_BEATS * Math.max(1, evidence?.relationships?.length || 1));
}

function sortInferredBeatAssetStates(states, evidence) {
  const relationships = Array.isArray(evidence?.relationships) ? evidence.relationships : [];
  const relationshipOrder = new Map(relationships.map((relationship, index) => [relationship.id, index]));
  const runtimeBeats = Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
    ? evidence.runtimeObservation.beatRuntimeStates
    : [];
  const beatIdOrder = new Map(runtimeBeats.map((beat, index) => [beat.beatId, index]));
  const uniqueTextOrder = new Map();
  const duplicateTexts = new Set();
  runtimeBeats.forEach((beat, index) => {
    const text = normalizeActiveText(beat.text || "").toLowerCase();
    if (!text) return;
    if (uniqueTextOrder.has(text)) duplicateTexts.add(text);
    else uniqueTextOrder.set(text, index);
  });
  duplicateTexts.forEach((text) => uniqueTextOrder.delete(text));
  const runtimeOrder = (state) => {
    if (state.beatId && beatIdOrder.has(state.beatId)) return beatIdOrder.get(state.beatId);
    return uniqueTextOrder.get(normalizeActiveText(state.text || "").toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  };
  return [...states].sort((left, right) => (
    (relationshipOrder.get(left.relationshipId) ?? Number.MAX_SAFE_INTEGER)
      - (relationshipOrder.get(right.relationshipId) ?? Number.MAX_SAFE_INTEGER)
    || runtimeOrder(left) - runtimeOrder(right)
    || (Number.isFinite(left.scrollPercent) ? left.scrollPercent : Number.MAX_SAFE_INTEGER)
      - (Number.isFinite(right.scrollPercent) ? right.scrollPercent : Number.MAX_SAFE_INTEGER)
    || stableCompare(left.text, right.text)
    || stableCompare(left.beatId, right.beatId)
    || stableCompare(JSON.stringify(canonicalObjectKeys(left)), JSON.stringify(canonicalObjectKeys(right)))
  ));
}

function sortJudgmentItemsByRelationship(items, evidence) {
  const relationships = Array.isArray(evidence?.relationships) ? evidence.relationships : [];
  const order = new Map(relationships.map((relationship, index) => [relationship.id, index]));
  return [...items].sort((left, right) => {
    const leftRelationship = relationshipForAssetItem(evidence, left);
    const rightRelationship = relationshipForAssetItem(evidence, right);
    const leftOrder = order.get(leftRelationship?.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(rightRelationship?.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder
      || stableCompare(JSON.stringify(canonicalObjectKeys(left)), JSON.stringify(canonicalObjectKeys(right)));
  });
}

const JUDGMENT_SET_ARRAY_KEYS = new Set([
  "evidenceRefs",
  "resourcesInspected",
  "remainingGaps",
  "uncertainties",
  "targetNodes",
  "targetNodeNames",
  "targetPaths"
]);

function normalizeJudgmentSetArrays(value, key = "") {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeJudgmentSetArrays(item));
    return JUDGMENT_SET_ARRAY_KEYS.has(key)
      ? semanticSort(Array.from(new Map(normalized.map((item) => [JSON.stringify(canonicalObjectKeys(item)), item])).values()))
      : normalized;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => (
    [childKey, normalizeJudgmentSetArrays(childValue, childKey)]
  )));
}

function sortAssociatedBeatsForEvidence(beats, evidence) {
  const runtimeBeats = Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
    ? evidence.runtimeObservation.beatRuntimeStates
    : [];
  const beatIdOrder = new Map(runtimeBeats.map((beat, index) => [beat.beatId, index]));
  const canonicalTextByBeatId = new Map(runtimeBeats
    .filter((beat) => beat?.beatId && normalizedBeatText(beat?.text))
    .map((beat) => [beat.beatId, normalizedBeatText(beat.text)]));
  const textOrders = new Map();
  runtimeBeats.forEach((beat, index) => {
    const text = normalizeActiveText(beat.text || "").toLowerCase();
    if (!text) return;
    const orders = textOrders.get(text) || [];
    orders.push(index);
    textOrders.set(text, orders);
  });
  const canonicalBeats = beats.map((beat) => (
    beat?.beatId && canonicalTextByBeatId.has(beat.beatId)
      ? { ...beat, text: canonicalTextByBeatId.get(beat.beatId) }
      : beat
  ));
  return uniqueAssociatedBeats(canonicalBeats, Number.MAX_SAFE_INTEGER).sort((left, right) => {
    const runtimeOrder = (beat) => {
      if (beat.beatId && beatIdOrder.has(beat.beatId)) return beatIdOrder.get(beat.beatId);
      const orders = textOrders.get(normalizeActiveText(beat.text || "").toLowerCase()) || [];
      return orders.length === 1 ? orders[0] : Number.MAX_SAFE_INTEGER;
    };
    const leftRuntime = runtimeOrder(left);
    const rightRuntime = runtimeOrder(right);
    return leftRuntime - rightRuntime
      || (Number.isFinite(left.scrollPercent) ? left.scrollPercent : Number.MAX_SAFE_INTEGER)
        - (Number.isFinite(right.scrollPercent) ? right.scrollPercent : Number.MAX_SAFE_INTEGER)
      || stableCompare(left.text, right.text)
      || stableCompare(left.beatId, right.beatId);
  });
}

function normalizeAssociatedBeatArrays(value, evidence, key = "") {
  if (Array.isArray(value)) {
    if (key === "associatedBeats") return sortAssociatedBeatsForEvidence(value, evidence);
    return value.map((item) => normalizeAssociatedBeatArrays(item, evidence));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => (
    [childKey, normalizeAssociatedBeatArrays(childValue, evidence, childKey)]
  )));
}

function normalizeJudgmentForEvidence(judgment, evidence) {
  const assetJudgments = Array.isArray(judgment.assetJudgments)
    ? sortJudgmentItemsByRelationship(judgment.assetJudgments.filter((item) => {
      const relationship = relationshipForAssetItem(evidence, item);
      return !relationship || relationship.hasEmbeddedAnimation || relationshipHasDirectRuntimeAnimation(evidence, relationship);
    }).map((item) => ({
      ...item,
      associatedBeats: sourceAssociatedBeats(item, "inferred-source")
    })), evidence)
    : [];
  const normalized = {
    schemaVersion: JUDGMENT_SCHEMA_VERSION,
    storyTitle: judgment.storyTitle || evidence?.story?.title || evidence?.story?.slug || "",
    dominantLogic: judgment.dominantLogic || "unknown/needs-review",
    confidence: clampConfidence(judgment.confidence, 0.25),
    overallSummary: String(judgment.overallSummary || ""),
    summaryMarkdown: String(judgment.summaryMarkdown || ""),
    investigationSummary: judgment.investigationSummary && typeof judgment.investigationSummary === "object"
      ? judgment.investigationSummary
      : { resourcesInspected: [], behaviorTrace: {}, directEvidence: "", remainingGaps: [] },
    uncertainties: Array.isArray(judgment.uncertainties) ? judgment.uncertainties : [],
    recommendedStoryVRUse: String(judgment.recommendedStoryVRUse || ""),
    engine: judgment.engine && typeof judgment.engine === "object" ? judgment.engine : { provider: "unknown" },
    assetJudgments,
    relationshipJudgments: sortJudgmentItemsByRelationship(
      Array.isArray(judgment.relationshipJudgments) ? judgment.relationshipJudgments : [],
      evidence
    ),
    modelBeatAssociations: modelBeatAssociationsForJudgment(judgment, evidence),
    imageBeatAssociations: imageBeatAssociationsForJudgment(judgment, evidence),
    glbAnimationInterpretations: glbAnimationInterpretationsForJudgment(judgment, evidence),
    inferredBeatAssetStates: inferredBeatAssetStatesForJudgment(judgment, evidence),
    beatRuntimeStates: Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
      ? evidence.runtimeObservation.beatRuntimeStates
      : []
  };
  return normalizeJudgmentSetArrays(normalizeAssociatedBeatArrays(normalized, evidence));
}

function animatingGlbJudgmentSection(judgment, evidence) {
  const animatedRelationships = evidence.relationships.filter((relationship) => (
    relationship.hasEmbeddedAnimation || relationshipHasDirectRuntimeAnimation(evidence, relationship)
  ));
  if (!animatedRelationships.length) return "";

  const lines = [
    "## Animating GLB Judgments"
  ];
  const normalizedAssociations = modelBeatAssociationsForJudgment(judgment, evidence);

  for (const relationship of animatedRelationships) {
    const item = judgmentForAsset(judgment, relationship, evidence);
    const file = relationship.assetFile || modelBasename(relationship.assetUrl) || relationship.assetUrl;
    const classification = item?.classification || relationship.hints?.scrollDriver?.classificationHint || "unknown/needs-review";
    const confidence = item?.confidence ?? relationship.hints?.scrollDriver?.confidence ?? "n/a";
    const driverType = item?.scrollDriver?.type || relationship.hints?.scrollDriver?.type || "unknown";
    const driverConfidence = item?.scrollDriver?.confidence ?? relationship.hints?.scrollDriver?.confidence ?? "n/a";
    const runtime = relationship.hints?.runtimePresence || {};
    const activeTexts = Number(runtime.distinctActiveTextCount || 0);
    const activeTextChanges = Number(runtime.activeTextChangeCount || 0);
    const reason = item?.reasoning || item?.explanation || relationship.hints?.scrollDriver?.reason || "No per-asset reasoning was returned.";
    const evidenceRefs = Array.isArray(item?.evidenceRefs) && item.evidenceRefs.length
      ? item.evidenceRefs
      : relationship.hints?.evidenceRefIds || [];
    const associatedBeats = normalizedAssociations.find((association) => association.assetUrl === relationship.assetUrl)?.associatedBeats
      || fallbackAssociatedBeatsForRelationship(relationship, classification, "inferred-runtime");

    lines.push(
      `- ${file}: ${classification} (confidence ${confidence}); driver=${driverType} (${driverConfidence}); captions/states=${activeTexts} distinct, ${activeTextChanges} transitions. ${reason} Evidence: ${evidenceRefs.slice(0, 5).join(", ") || "n/a"}.`
    );
    if (associatedBeats.length) {
      associatedBeats.forEach((beat, index) => lines.push(formatAssociatedBeat(beat, index)));
    } else {
      lines.push("  - Beat content: not isolated from fetched evidence.");
    }
  }

  return `${lines.join("\n")}\n`;
}

function glbBeatAssociationsSection(judgment, evidence) {
  const associations = modelBeatAssociationsForJudgment(judgment, evidence);
  if (!associations.length) return "";
  const lines = ["## GLB Beat Associations"];
  for (const association of associations) {
    const file = association.assetFile || modelBasename(association.assetUrl) || association.assetUrl;
    const relationship = relationshipForAssetItem(evidence, association);
    const runtimeDriven = relationship && relationshipHasDirectRuntimeAnimation(evidence, relationship);
    const kind = association.hasEmbeddedAnimation
      ? "animated GLB"
      : association.parseStatus === "failed"
        ? "GLB animation metadata unavailable (parse failed)"
      : runtimeDriven
        ? "runtime-driven/no embedded animation"
        : "no embedded animation observed";
    const confidence = association.associationConfidence ?? "n/a";
    const source = association.associationSource || "unknown";
    const evidenceRefs = Array.isArray(association.evidenceRefs) ? association.evidenceRefs : [];
    const reason = association.reasoning || "No per-model association reasoning was returned.";
    lines.push(
      `- ${file}: ${kind}; associationConfidence=${confidence}; source=${source}. ${reason} Evidence: ${evidenceRefs.slice(0, 5).join(", ") || "n/a"}.`
    );
    if (association.associationTruncation?.aiSourceBeatsTruncated) {
      lines.push(`  - AI/source beat input truncated: retained ${association.associationTruncation.aiSourceBeatRetainedCount}/${association.associationTruncation.aiSourceBeatCount}; direct runtime beats remain untruncated.`);
    }
    if (association.associatedBeats.length) {
      association.associatedBeats.slice(0, 12).forEach((beat, index) => lines.push(formatAssociatedBeat(beat, index)));
      if (association.associatedBeats.length > 12) {
        lines.push(`  - Beat details truncated in Markdown: +${association.associatedBeats.length - 12} more beat(s); JSON retains the full association.`);
      }
    } else {
      lines.push("  - Beat content: not isolated from fetched evidence.");
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatRuntimeTimeRange(value) {
  if (!Array.isArray(value) || !value.length) return "time=unknown";
  const [start, end] = value;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "time=unknown";
  return Math.abs(end - start) < 0.0005
    ? `time=${start.toFixed(3)}s`
    : `time=${start.toFixed(3)}-${end.toFixed(3)}s`;
}

function beatRuntimeStateSection(judgment, evidence) {
  const beats = Array.isArray(judgment?.beatRuntimeStates)
    ? judgment.beatRuntimeStates
    : Array.isArray(evidence?.runtimeObservation?.beatRuntimeStates)
      ? evidence.runtimeObservation.beatRuntimeStates
      : [];
  if (!beats.length) return "";
  const lines = ["## Beat Runtime State"];
  const coverage = evidence?.sourceProbe?.captureCoverage;
  if (coverage) {
    lines.push(`- Capture coverage: strategy=${coverage.strategy || "unknown"}; detectedBeatTargets=${coverage.detectedBeatTargetCount ?? "unknown"}; visitedScrollTargets=${coverage.visitedScrollTargetCount ?? "unknown"}/${coverage.plannedScrollTargetCount ?? "unknown"}; targetScreenshots=${coverage.screenshotCaptureCount ?? 0}/${coverage.screenshotPlannedCount ?? 0}; fullViewport=${coverage.viewportScreenshotCaptureCount ?? 0}; canvasFallback=${coverage.canvasFallbackCaptureCount ?? 0}; canvasCrops=${coverage.canvasCropCaptureCount ?? 0}; screenshotFailures=${coverage.screenshotFailureCount ?? 0}; snapshots=${coverage.capturedSnapshotCount ?? "unknown"}/${coverage.snapshotLimit ?? "unknown"}; skipped=${coverage.skippedScrollTargetCount ?? 0}; reachedLimit=${Boolean(coverage.reachedSnapshotLimit)}; stoppedEarly=${Boolean(coverage.stoppedEarly)}; documentGrowth=${Boolean(coverage.documentGrowthDetected)}.`);
    if (Number(coverage.activePassCount || 0) || coverage.recoveryStatus) {
      lines.push(`- Variant traversal: activePasses=${coverage.activePassCount ?? 0}; pass1=${coverage.pass1VisitedTargetCount ?? 0}/${coverage.pass1PlannedTargetCount ?? 0}; recovery=${coverage.recoveryVisitedTargetCount ?? 0}/${coverage.recoveryPlannedTargetCount ?? 0} (${coverage.recoveryStatus || "unknown"}, mismatches=${coverage.recoveryMismatchCount ?? 0}); pass2=${coverage.pass2VisitedTargetCount ?? 0}/${coverage.pass2PlannedTargetCount ?? 0}; dependencies=${coverage.variantDependencyConfirmedCount ?? 0}/${coverage.variantDependencyObservationCount ?? 0}; transitionBudget=${coverage.variantDependencyTransitionCount ?? 0}/${coverage.variantDependencyTransitionBudget ?? "unknown"}; cycleGuards=${coverage.variantDependencyCycleGuardCount ?? 0}.`);
    }
  }
  for (const beat of beats.slice(0, 80)) {
    const scroll = Array.isArray(beat.scrollRange)
      ? ` @ ${beat.scrollRange[0]}${beat.scrollRange[1] !== beat.scrollRange[0] ? `-${beat.scrollRange[1]}` : ""}%`
      : "";
    lines.push(`- ${beat.beatId}${scroll} [${beat.provenance || beat.captureStatus || "unknown"}]: ${normalizedBeatText(beat.text || "No active beat text")}`);
    lines.push(`  - Runtime capture: status=${beat.captureStatus || "unknown"}; samples=${beat.sampleCount || beat.snapshotIds?.length || 0}; snapshots=${compactList(beat.snapshotIds, 8) || "none"}.`);
    const visualEvidence = Array.isArray(beat.visualEvidence) ? beat.visualEvidence : [];
    if (visualEvidence.length) {
      lines.push(`  - Scroll-target visual evidence: ${compactList(visualEvidence.map((item) => `${item.evidenceRef || item.id} (target ${Number(item.targetIndex) + 1}, ${item.captureMethod || item.status || "unknown"})`), 6)}. The primary frame is the composited tab viewport; an optional canvas crop is secondary. Pixels can establish visible scene state, but exact GLB/node/clip identity still requires runtime or source evidence.`);
    }
    if (beat.truncation?.visiblePartsTruncated || beat.truncation?.actionStatesTruncated) {
      lines.push(`  - Runtime capture truncation: visibleParts=${Boolean(beat.truncation.visiblePartsTruncated)}; actionStates=${Boolean(beat.truncation.actionStatesTruncated)}. Empty or partial lists are not proof of absence.`);
    }
    const models = Array.isArray(beat.visibleModels) ? beat.visibleModels : [];
    if (!models.length) {
      lines.push(beat.captureStatus === "unavailable"
        ? "  - Visible GLBs: unavailable because direct Three.js state was not captured."
        : "  - Visible GLBs: none were render-eligible in the sampled runtime state.");
    }
    for (const model of models) {
      const file = model.assetFile || modelBasename(model.assetUrl) || model.rootName || model.runtimeModelId;
      const modelLabel = model.assetIdentitySource === "direct-runtime"
        ? `On-canvas render-eligible GLB ${file}`
        : `On-canvas render-eligible model root ${file}`;
      lines.push(`  - ${modelLabel}: identity=${model.assetIdentitySource || "runtime-root-only"}; runtimeModel=${model.runtimeModelId || "unknown"}; playback=${model.playbackMode || "unknown"}; snapshots=${compactList(model.snapshotIds, 6) || "none"}.`);
      const parts = Array.isArray(model.visibleParts) ? model.visibleParts : [];
      lines.push(`    - Render-eligible parts: ${parts.length ? compactList(parts.map((part) => part.name || part.nodePath || part.nodeId), 12) : "none identified"}.`);
      const partChanges = Array.isArray(model.partStateChanges) ? model.partStateChanges : [];
      if (partChanges.length) {
        lines.push(`    - Runtime part changes: ${compactList(partChanges.map((part) => `${part.name || part.nodePath || part.nodeId}${part.motionObserved ? " moved/transformed" : ""}${part.visibilityChanged ? " visibility-changed" : ""}${part.opacityChanged ? " opacity-changed" : ""}`), 12)}.`);
      }
      const actions = Array.isArray(model.playingAnimations) ? model.playingAnimations : [];
      if (!actions.length) {
        lines.push("    - Playing animations: none directly observed.");
      }
      for (const action of actions.slice(0, 12)) {
        const playback = action.playback || {};
        const targets = compactList(action.targetParts?.map((part) => part.nodeName || part.nodePath) || action.targetNodeNames, 6) || "unresolved/control-node";
        lines.push(`    - Playing ${action.clipName || `clip-${action.clipIndex ?? "unknown"}`}: ${formatRuntimeTimeRange(action.timeRange)}; driver=${playback.mode || "unknown"} (${playback.confidence ?? "n/a"}); targets=${targets}; action=${action.actionId || "unknown"}. ${playback.reasoning || ""}`.trimEnd());
      }
      if (actions.length > 12) lines.push(`    - Playing animation details truncated: +${actions.length - 12} more action(s).`);
    }
    const renderActiveModels = Array.isArray(beat.renderActiveModels) ? beat.renderActiveModels : [];
    for (const model of renderActiveModels) {
      const file = model.assetFile || modelBasename(model.assetUrl) || model.rootName || model.runtimeModelId;
      lines.push(`  - Render-active offscreen model ${file}: eligibility=${model.renderEligibility || "offscreen/unresolved"}; identity=${model.assetIdentitySource || "runtime-root-only"}; runtimeModel=${model.runtimeModelId || "unknown"}. This is not direct proof of final on-canvas visibility.`);
      const parts = Array.isArray(model.visibleParts) ? model.visibleParts : [];
      lines.push(`    - Render-eligible offscreen parts: ${parts.length ? compactList(parts.map((part) => part.name || part.nodePath || part.nodeId), 12) : "none identified"}.`);
      const actions = Array.isArray(model.playingAnimations) ? model.playingAnimations : [];
      if (!actions.length) lines.push("    - Playing animations: none directly observed.");
      for (const action of actions.slice(0, 12)) {
        const playback = action.playback || {};
        const targets = compactList(action.targetParts?.map((part) => part.nodeName || part.nodePath) || action.targetNodeNames, 6) || "unresolved/control-node";
        lines.push(`    - Playing ${action.clipName || `clip-${action.clipIndex ?? "unknown"}`}: ${formatRuntimeTimeRange(action.timeRange)}; driver=${playback.mode || "unknown"} (${playback.confidence ?? "n/a"}); targets=${targets}; action=${action.actionId || "unknown"}. ${playback.reasoning || ""}`.trimEnd());
      }
    }
    const cameras = Array.isArray(beat.activeCameras) ? beat.activeCameras : [];
    if (cameras.length) {
      lines.push(`  - Active camera(s): ${compactList(cameras.map((camera) => `${camera.name || camera.cameraId} (${camera.type || "camera"})`), 4)}.`);
    }
    const renderActiveCameras = Array.isArray(beat.renderActiveCameras) ? beat.renderActiveCameras : [];
    if (renderActiveCameras.length) {
      lines.push(`  - Offscreen render camera(s): ${compactList(renderActiveCameras.map((camera) => `${camera.name || camera.cameraId} (${camera.type || "camera"}, ${camera.renderTargetKind || "unknown target"})`), 4)}; final on-canvas contribution requires compositor/source confirmation.`);
    }
    if (beat.cameraStateChanged) lines.push("  - Camera state changed across samples in this beat.");
  }
  if (beats.length > 80) lines.push(`- Beat runtime details truncated: +${beats.length - 80} more beat(s).`);
  return `${lines.join("\n")}\n`;
}

function inferredBeatAssetStateSection(judgment, evidence) {
  const states = Array.isArray(judgment?.inferredBeatAssetStates)
    ? judgment.inferredBeatAssetStates
    : inferredBeatAssetStatesForJudgment(judgment, evidence);
  if (!states.length) return "";
  const lines = [
    "## Inferred Beat Asset State",
    "- These model/part/animation fields come from fetched source, configuration, or bounded inference when direct runtime state was unavailable or field-truncated. Records marked as supplements keep model visibility authoritative in `Beat Runtime State` and infer only missing part/animation fields."
  ];
  for (const state of states.slice(0, 240)) {
    const beat = state.beatId || normalizedBeatText(state.text || "untitled beat");
    const file = state.assetFile || modelBasename(state.assetUrl) || state.relationshipId;
    const visibility = state.modelVisibility || {};
    const modelState = state.supplementsDirectRuntime ? "covered by direct Beat Runtime State" : visibility.state || "unknown";
    lines.push(`- ${beat}: ${file}; model=${modelState} [${visibility.provenance || state.provenance || "unknown"}] confidence=${visibility.confidence ?? state.confidence ?? "n/a"}. ${visibility.reasoning || state.reasoning || ""}`.trimEnd());
    if (state.supplementsDirectRuntime) {
      lines.push(`  - Direct field coverage: partsComplete=${Boolean(state.directFieldCoverage?.partsComplete)}; actionsComplete=${Boolean(state.directFieldCoverage?.actionsComplete)}.`);
    }
    const parts = Array.isArray(state.parts) ? state.parts : [];
    lines.push(`  - Parts: ${parts.length ? compactList(parts.map((part) => `${part.name || part.nodePath}=${part.visibilityState || "unknown"} [${part.provenance || "unknown"}]`), 12) : "unknown/not isolated"}.`);
    const animations = Array.isArray(state.animations) ? state.animations : [];
    if (!animations.length) lines.push("  - Animations: unknown/not isolated.");
    for (const animation of animations.slice(0, 12)) {
      lines.push(`  - Animation ${animation.clipName || `clip-${animation.clipIndex ?? "unknown"}`}: state=${animation.playState || "unknown"}; driver=${animation.driverMode || "unknown"}; scrollDriver=${animation.scrollDriverType || "unknown"}; targets=${compactList(animation.targetParts, 6) || "unknown"}; provenance=${animation.provenance || "unknown"}; confidence=${animation.confidence ?? "n/a"}. ${animation.reasoning || ""}`.trimEnd());
    }
  }
  if (states.length > 240) lines.push(`- Inferred beat asset details truncated in Markdown: +${states.length - 240} more state(s); JSON retains them.`);
  return `${lines.join("\n")}\n`;
}

function imageBeatAssociationsSection(judgment, evidence) {
  const associations = imageBeatAssociationsForJudgment(judgment, evidence);
  if (!associations.length) return "";
  const lines = ["## Image Beat Associations"];
  for (const association of associations) {
    const confidence = association.associationConfidence ?? "n/a";
    const source = association.associationSource || "unknown";
    const caption = association.caption ? ` Caption: ${normalizedBeatText(association.caption)}` : "";
    lines.push(
      `- ${association.imageGroupId || association.assetUrl}: static image; associationConfidence=${confidence}; source=${source}.${caption} ${association.reasoning || "No image association reasoning was returned."}`.replace(/\s+/g, " ").trim()
    );
    if (association.associatedBeats.length) {
      association.associatedBeats.forEach((beat, index) => lines.push(formatAssociatedBeat(beat, index)));
    } else {
      lines.push("  - Beat content: not isolated from fetched evidence.");
    }
  }
  return `${lines.join("\n")}\n`;
}

function compactList(values, maxCount = 4) {
  const items = (Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean);
  if (!items.length) return "";
  const visible = items.slice(0, maxCount).join(", ");
  return items.length > maxCount ? `${visible}, +${items.length - maxCount} more` : visible;
}

function glbAnimationInterpretationSection(judgment, evidence) {
  const interpretations = glbAnimationInterpretationsForJudgment(judgment, evidence);
  if (!interpretations.length) return "";
  const lines = ["## GLB Animation Interpretation"];
  for (const interpretation of interpretations) {
    const file = interpretation.assetFile || modelBasename(interpretation.assetUrl) || interpretation.assetUrl;
    const trigger = interpretation.triggerMapping || {};
    const runtime = interpretation.runtimeJsBehavior || {};
    lines.push(
      `- ${file}: classification=${interpretation.classification || "unknown/needs-review"}; trigger=${trigger.type || "unknown"} (confidence ${trigger.confidence ?? "n/a"}); embeddedAnimation=${Boolean(interpretation.hasEmbeddedAnimation)}; cameraPath=${Boolean(interpretation.hasCameraPath)}. ${interpretation.reasoning || trigger.reasoning || "No GLB interpretation reasoning was returned."}`
    );
    if (trigger.localFormula || trigger.fullPageFormula) {
      lines.push(`  - Trigger mapping: local=${trigger.localFormula || "unknown"}; fullPage=${trigger.fullPageFormula || "unknown"}. ${trigger.reasoning || ""}`.trimEnd());
    } else if (trigger.reasoning) {
      lines.push(`  - Trigger mapping: ${trigger.reasoning}`);
    }
    if (runtime.summary) {
      lines.push(`  - Runtime JS behavior: ${runtime.summary}`);
    }
    if (interpretation.cameraPath?.summary) {
      lines.push(`  - Camera path: ${interpretation.cameraPath.summary}`);
    }
    const clips = Array.isArray(interpretation.clips) ? interpretation.clips : [];
    for (const clip of clips.slice(0, 12)) {
      const name = clip.animationName || clip.name || "unnamed animation";
      const targets = compactList(clip.targetNodes || clip.targetNodeNames, 3);
      const paths = compactList(clip.targetPaths, 4);
      const role = clip.role || "unknown";
      const mechanism = clip.triggerMechanism || "unknown";
      const reasoning = clip.reasoning ? ` ${String(clip.reasoning).replace(/\s+/g, " ").trim()}` : "";
      lines.push(`  - Clip ${name}: role=${role}; mechanism=${mechanism}; targets=${targets || "unknown"}; paths=${paths || "unknown"}.${reasoning}`);
      const beats = Array.isArray(clip.associatedBeats) ? uniqueAssociatedBeats(clip.associatedBeats, 3) : [];
      beats.forEach((beat, index) => lines.push(`    - Clip beat ${index + 1}${Number.isFinite(Number(beat.scrollPercent)) ? ` @ ${beat.scrollPercent}%` : ""}${beat.source ? ` [${beat.source}]` : ""}: ${beat.text}`));
    }
    if (clips.length > 12) lines.push(`  - Clip details truncated: +${clips.length - 12} more clip interpretation(s).`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOrAppendMarkdownSection(summary, sectionTitle, replacement) {
  const normalizedReplacement = String(replacement || "").trim();
  const pattern = new RegExp(`(^|\\n)## ${escapeRegExp(sectionTitle)}\\b[\\s\\S]*?(?=\\n##\\s|$)`, "g");
  const cleaned = String(summary || "")
    .replace(pattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalizedReplacement) return cleaned;
  return `${cleaned}${cleaned ? "\n\n" : ""}${normalizedReplacement}`;
}

function summaryMarkdownFromJudgment(judgment, evidence) {
  const glbSection = animatingGlbJudgmentSection(judgment, evidence);
  const beatSection = glbBeatAssociationsSection(judgment, evidence);
  const runtimeBeatSection = beatRuntimeStateSection(judgment, evidence);
  const inferredBeatSection = inferredBeatAssetStateSection(judgment, evidence);
  const imageSection = imageBeatAssociationsSection(judgment, evidence);
  const interpretationSection = glbAnimationInterpretationSection(judgment, evidence);
  const investigationSection = investigationSummarySection(judgment);
  if (typeof judgment.summaryMarkdown === "string" && judgment.summaryMarkdown.trim()) {
    let summary = judgment.summaryMarkdown.trim();
    summary = replaceOrAppendMarkdownSection(summary, "Animating GLB Judgments", glbSection);
    summary = replaceOrAppendMarkdownSection(summary, "GLB Beat Associations", beatSection);
    summary = replaceOrAppendMarkdownSection(summary, "Beat Runtime State", runtimeBeatSection);
    summary = replaceOrAppendMarkdownSection(summary, "Inferred Beat Asset State", inferredBeatSection);
    summary = replaceOrAppendMarkdownSection(summary, "Image Beat Associations", imageSection);
    summary = replaceOrAppendMarkdownSection(summary, "GLB Animation Interpretation", interpretationSection);
    summary = replaceOrAppendMarkdownSection(summary, "Investigation Notes", investigationSection);
    return `${summary}\n`;
  }
  const lines = [
    `# Animation Logic Summary: ${judgment.storyTitle || evidence.story.title || evidence.story.slug}`,
    "",
    `Dominant logic: ${judgment.dominantLogic || "unknown/needs-review"}`,
    `Confidence: ${judgment.confidence ?? "n/a"}`,
    "",
    judgment.overallSummary || "No overall summary returned.",
    "",
    "## Asset Judgments",
    ...(Array.isArray(judgment.assetJudgments) ? judgment.assetJudgments : []).map((item) => (
      `- ${item.assetFile || item.assetUrl}: ${item.classification || "unknown/needs-review"} (${item.confidence ?? "n/a"}), driver=${item.scrollDriver?.type || "unknown"}`
    )),
    "",
    glbSection.trim(),
    "",
    beatSection.trim(),
    "",
    runtimeBeatSection.trim(),
    "",
    inferredBeatSection.trim(),
    "",
    imageSection.trim(),
    "",
    interpretationSection.trim(),
    "",
    investigationSection.trim(),
    "",
    "## Uncertainties",
    ...(Array.isArray(judgment.uncertainties) && judgment.uncertainties.length ? judgment.uncertainties : ["No uncertainties listed."]).map((item) => `- ${item}`)
  ];
  return `${lines.join("\n")}\n`;
}

function authorInputRootForProbe(probe, options) {
  if (options.authorInputFolder) return path.resolve(options.authorInputFolder);
  return path.join(storyFolderForProbe(probe, options), "captures", "active");
}

async function shouldWriteAuthorInput(probe, options) {
  if (options.noAuthorInput) return false;
  const resourceFolder = authorInputRootForProbe(probe, options);
  if (options.writeAuthorInput || options.authorInputFolder) return true;
  if (!options.storyFolder) return false;

  const metadataRoot = path.join(resourceFolder, "metadata");
  const hasStoryStructure = await exists(path.join(metadataRoot, "story_structure_candidates.json"));
  const hasAssetManifest = await exists(path.join(metadataRoot, "asset_manifest.json"));
  if (!hasStoryStructure || !hasAssetManifest) return true;

  const sourceDiscovery = await readJsonIfExists(path.join(metadataRoot, "source_discovery.json"));
  return sourceDiscovery?.generated_by === "animation-logic-probe-analyzer"
    || sourceDiscovery?.generatedBy === "animation-logic-probe-analyzer"
    || await exists(path.join(metadataRoot, "animation_probe_manifest.json"));
}

function authorAssetFolderForType(assetType) {
  if (assetType === "model") return "models";
  if (assetType === "script") return "scripts";
  if (assetType === "data") return "data";
  if (assetType === "image") return "textures";
  return "other";
}

function storyVrAssetType(assetType, filePath = "") {
  if (assetType === "model") return "model";
  if (assetType === "script") return "script";
  if (assetType === "data") return "data";
  if (assetType === "image") return "texture";
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) return "texture";
  return assetType || "asset";
}

function absoluteLocalPath(localPath) {
  if (!localPath) return "";
  return path.isAbsolute(localPath) ? localPath : path.join(REPO_ROOT, localPath);
}

async function copyProbeDownloadsToAuthorInput(resourceFolder, evidence, probe) {
  const assetManifest = [];
  const copyFailures = [];
  const imageGroups = authorInputImageGroupsFromProbe(probe);
  const imageGroupIndex = imageGroupIndexByUrl(imageGroups, evidence.story?.url || probe?.story_url || "");
  for (const download of Array.isArray(evidence.downloads) ? evidence.downloads : []) {
    const imageGroup = imageGroupForDownload(download, imageGroupIndex, evidence.story?.url || probe?.story_url || "");
    if (download.assetType === "image" && !imageGroup) continue;

    const sourcePath = absoluteLocalPath(download.localPath);
    const fileName = path.basename(sourcePath || download.localPath || filenameForUrl(download.url || "asset"));
    const folder = authorAssetFolderForType(download.assetType);
    const localPath = toPosix(path.join(folder, fileName));
    const destinationPath = path.join(resourceFolder, localPath);
    try {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
    } catch (error) {
      copyFailures.push({
        url: download.url,
        localPath: download.localPath,
        message: error.message
      });
      continue;
    }

    assetManifest.push({
      story_url: evidence.story?.url || "",
      timestamp: evidence.generatedAt || new Date().toISOString(),
      asset_url: download.url,
      final_url: download.finalUrl || download.url,
      local_path: localPath,
      asset_type: storyVrAssetType(download.assetType, fileName),
      source_type: imageGroup ? "image_group" : "animation_probe_download",
      source_types: imageGroup ? ["animation_probe_download", "image_group"] : ["animation_probe_download"],
      adaptation_relevance: download.assetType === "model" || imageGroup ? "core_story" : "source_evidence",
      story_prefix_match: "",
      discovery_depth: 0,
      file_size: download.fileSize || null,
      source_image_group_id: imageGroup?.id || undefined,
      image_group_dom_order: imageGroup?.domOrder ?? undefined,
      caption: imageGroup?.caption || undefined,
      credits: imageGroup?.credits || undefined,
      notes: [
        "Copied from animation logic probe downloads for StoryVR author input",
        imageGroup ? `image_group:${imageGroup.id}` : "",
        download.contentType ? `content_type:${download.contentType}` : ""
      ].filter(Boolean)
    });
  }
  return { assetManifest, copyFailures };
}

function assetRecordIndexes(assetManifest) {
  const byFile = new Map();
  const byUrl = new Map();
  for (const record of assetManifest || []) {
    const file = path.basename(record.local_path || "");
    if (file) byFile.set(normalizeAssetKey(file), record);
    if (record.asset_url) byUrl.set(normalizeUrl(record.asset_url), record);
    if (record.final_url) byUrl.set(normalizeUrl(record.final_url), record);
  }
  return { byFile, byUrl };
}

function assetRecordForProbeAssociation(association, indexes) {
  const urlCandidates = [
    association?.assetUrl,
    association?.url,
    ...(Array.isArray(association?.urls) ? association.urls : [])
  ];
  for (const value of [
    association?.assetFile,
    path.basename(String(association?.assetFile || "")),
    ...urlCandidates.map((url) => path.basename(urlPathname(url)))
  ]) {
    const match = indexes.byFile.get(normalizeAssetKey(value));
    if (match) return match;
  }
  for (const value of urlCandidates) {
    const match = indexes.byUrl.get(normalizeUrl(value));
    if (match) return match;
  }
  return null;
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function cleanStoryText(value) {
  return decodeBasicEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function storyTextKey(value) {
  return cleanStoryText(value).toLowerCase();
}

function titleFromStoryText(text, fallback = "Story beat") {
  const clean = cleanStoryText(text);
  return clean || fallback;
}

function domOrderForScrollPercent(value, fallbackIndex) {
  const scrollPercent = Number(value);
  if (Number.isFinite(scrollPercent)) return Math.round(scrollPercent * 1000);
  return 1_000_000 + fallbackIndex;
}

function imageGroupUrls(group) {
  const values = [
    group?.image?.url,
    ...(Array.isArray(group?.image?.allUrls) ? group.image.allUrls : []),
    ...(Array.isArray(group?.image?.srcset) ? group.image.srcset.map((entry) => typeof entry === "string" ? entry : entry?.url) : [])
  ];
  return Array.from(new Set(values.map((url) => normalizeUrl(url)).filter(Boolean)));
}

function captionRecord(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = cleanStoryText(value);
    return text ? { text } : null;
  }
  if (typeof value === "object") {
    const text = cleanStoryText(value.text || value.caption || "");
    if (!text) return null;
    return {
      ...value,
      text
    };
  }
  return null;
}

function creditRecords(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(captionRecord).filter(Boolean);
}

function rawAuthorInputImageGroupsFromProbe(probe) {
  const groups = Array.isArray(probe?.storyvr_author_input?.image_groups)
    ? probe.storyvr_author_input.image_groups
    : Array.isArray(probe?.image_groups)
      ? probe.image_groups
      : [];
  return groups.map((group, index) => {
    const urls = imageGroupUrls(group);
    const id = group?.id || `image-group-${index + 1}`;
    return {
      ...group,
      id,
      category: group?.category || "image_group",
      index: Number.isFinite(Number(group?.index)) ? Number(group.index) : index,
      domOrder: Number.isFinite(Number(group?.domOrder)) ? Number(group.domOrder) : 1_000_000 + index,
      image: {
        ...(group?.image || {}),
        url: urls[0] || group?.image?.url || "",
        allUrls: urls,
        srcset: Array.isArray(group?.image?.srcset) ? group.image.srcset : []
      },
      caption: captionRecord(group?.caption),
      credits: creditRecords(group?.credits)
    };
  }).filter((group) => imageGroupUrls(group).length);
}

function evaluateImageGroupRelevance(group, context) {
  const urls = imageGroupUrls(group);
  const rejectedUrls = [];
  const acceptedUrls = [];
  const structuralText = imageGroupStructuralText(group);

  if (group?.imageRelevance?.accepted === false || group?.relevance?.accepted === false || group?.rejected === true) {
    return {
      ...group,
      imageRelevance: {
        policy: IMAGE_RELEVANCE_POLICY,
        accepted: false,
        reason: group?.imageRelevance?.reason || "pre_marked_rejected",
        acceptedUrls: [],
        rejectedUrls: urls.map((url) => ({ url, reason: "pre_marked_rejected" }))
      }
    };
  }

  if (isRejectedImageGroupContainer(group)) {
    return {
      ...group,
      imageRelevance: {
        policy: IMAGE_RELEVANCE_POLICY,
        accepted: false,
        reason: "page_or_chrome_container",
        structuralText,
        acceptedUrls: [],
        rejectedUrls: urls.map((url) => ({ url, reason: "page_or_chrome_container" }))
      }
    };
  }

  const explicitStoryGroup = isExplicitStoryImageGroup(group);
  if (!explicitStoryGroup) {
    return {
      ...group,
      imageRelevance: {
        policy: IMAGE_RELEVANCE_POLICY,
        accepted: false,
        reason: "weak_image_container",
        structuralText,
        acceptedUrls: [],
        rejectedUrls: urls.map((url) => ({ url, reason: "weak_image_container" }))
      }
    };
  }

  const captioned = imageGroupHasCaptionOrCredit(group);
  for (const url of urls) {
    const hardReason = imageHardRejectionReason(url);
    if (hardReason) {
      rejectedUrls.push({ url, reason: hardReason });
      continue;
    }
    const storyEvidence = imageUrlHasStoryEvidence(url, context);
    if (captioned || storyEvidence) {
      acceptedUrls.push(url);
      continue;
    }
    rejectedUrls.push({ url, reason: "not_story_related" });
  }

  if (!acceptedUrls.length) {
    return {
      ...group,
      imageRelevance: {
        policy: IMAGE_RELEVANCE_POLICY,
        accepted: false,
        reason: rejectedUrls[0]?.reason || "no_accepted_story_urls",
        structuralText,
        acceptedUrls: [],
        rejectedUrls
      }
    };
  }

  return {
    ...group,
    image: {
      ...(group.image || {}),
      url: acceptedUrls[0],
      allUrls: acceptedUrls,
      srcset: filterImageSrcset(group.image?.srcset, acceptedUrls, context.storyUrl)
    },
    imageRelevance: {
      policy: IMAGE_RELEVANCE_POLICY,
      accepted: true,
      reason: captioned ? "story_caption_or_credit" : "story_url_match",
      structuralText,
      acceptedUrls,
      rejectedUrls
    }
  };
}

function evaluatedImageGroupsFromProbe(probe) {
  const context = imageRelevanceContextForProbe(probe);
  return rawAuthorInputImageGroupsFromProbe(probe).map((group) => evaluateImageGroupRelevance(group, context));
}

function authorInputImageGroupsFromProbe(probe) {
  return evaluatedImageGroupsFromProbe(probe).filter((group) => group.imageRelevance?.accepted !== false);
}

function imageRelevanceSummaryForProbe(probe) {
  const evaluated = evaluatedImageGroupsFromProbe(probe);
  const acceptedGroups = evaluated.filter((group) => group.imageRelevance?.accepted !== false);
  const rejectedGroups = evaluated.filter((group) => group.imageRelevance?.accepted === false);
  const acceptedUrlCount = acceptedGroups.reduce((count, group) => count + (group.imageRelevance?.acceptedUrls?.length || 0), 0);
  const rejectedUrlCount = evaluated.reduce((count, group) => count + (group.imageRelevance?.rejectedUrls?.length || 0), 0);
  return {
    policy: IMAGE_RELEVANCE_POLICY,
    rawImageGroupCount: evaluated.length,
    acceptedImageGroupCount: acceptedGroups.length,
    rejectedImageGroupCount: rejectedGroups.length,
    acceptedImageUrlCount: acceptedUrlCount,
    rejectedImageUrlCount: rejectedUrlCount,
    acceptedGroups: acceptedGroups.map((group) => ({
      id: group.id,
      reason: group.imageRelevance?.reason || "",
      urls: group.imageRelevance?.acceptedUrls || []
    })),
    rejectedGroups: rejectedGroups.map((group) => ({
      id: group.id,
      reason: group.imageRelevance?.reason || "",
      urls: imageGroupUrls(group)
    })),
    rejectedUrls: evaluated.flatMap((group) => (
      (group.imageRelevance?.rejectedUrls || []).map((item) => ({
        groupId: group.id,
        url: item.url,
        reason: item.reason
      }))
    )).slice(0, 120)
  };
}

function imageAssetsForProbe(probe) {
  return authorInputImageGroupsFromProbe(probe).map((group) => ({
    id: group.id,
    index: group.index,
    domOrder: group.domOrder,
    category: group.category || "image_group",
    tag: group.tag || "",
    selector: group.selector || "",
    className: group.className || "",
    url: group.image?.url || "",
    urls: group.image?.allUrls || imageGroupUrls(group),
    caption: group.caption?.text || "",
    credits: (Array.isArray(group.credits) ? group.credits : []).map((credit) => credit.text).filter(Boolean),
    relevanceReason: group.imageRelevance?.reason || "",
    structuralText: group.imageRelevance?.structuralText || ""
  }));
}

function authorInputHeadingsFromProbe(probe, fallbackTitle = "") {
  const seeded = Array.isArray(probe?.storyvr_author_input?.headings)
    ? probe.storyvr_author_input.headings
    : [];
  const sourceHeadings = seeded.length ? seeded : headingLikeActiveTextsFromProbe(probe);
  const seen = new Set();
  const headings = [];
  sourceHeadings.forEach((heading, index) => {
    const text = cleanStoryText(heading?.text || heading?.title || "");
    const key = storyTextKey(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    headings.push({
      ...heading,
      category: "heading",
      index: headings.length,
      text,
      title: titleFromStoryText(text, `Heading ${headings.length + 1}`),
      domOrder: Number.isFinite(Number(heading?.domOrder)) ? Number(heading.domOrder) : 1_000_000 + index
    });
  });

  if (!headings.length && fallbackTitle) {
    headings.push({
      category: "heading",
      index: 0,
      selector: "document.title",
      tag: "title",
      id: "",
      className: "",
      text: fallbackTitle,
      title: fallbackTitle,
      domOrder: 0
    });
  }

  return headings.sort((a, b) => a.domOrder - b.domOrder);
}

function headingLikeActiveTextsFromProbe(probe) {
  const seededTextUnits = Array.isArray(probe?.storyvr_author_input?.text_units)
    ? probe.storyvr_author_input.text_units
    : [];
  const sourceUnits = seededTextUnits.length
    ? seededTextUnits
    : (Array.isArray(probe?.snapshots) ? probe.snapshots : []).flatMap((snapshot, snapshotIndex) => (
      (Array.isArray(snapshot.activeTexts) ? snapshot.activeTexts : []).map((item, textIndex) => ({
        ...item,
        scrollPercent: snapshot.scrollPercent,
        domOrder: Number.isFinite(Number(item?.domOrder))
          ? Number(item.domOrder)
          : domOrderForScrollPercent(snapshot.scrollPercent, snapshotIndex * 10 + textIndex),
        source: snapshot.id || `snapshot-${snapshotIndex + 1}`
      }))
    ));
  return sourceUnits
    .filter(isHeadingLikeTextRecord)
    .map((unit, index) => ({
      ...unit,
      category: "heading",
      index,
      domOrder: Number.isFinite(Number(unit.domOrder))
        ? Number(unit.domOrder)
        : domOrderForScrollPercent(unit.scrollPercent, index)
    }));
}

function isHeadingLikeTextRecord(unit) {
  const tag = String(unit?.tag || "").toLowerCase();
  const className = String(unit?.className || "").toLowerCase();
  const category = String(unit?.category || "").toLowerCase();
  return category === "heading"
    || ["h1", "h2", "h3"].includes(tag)
    || /\b(heading|headline|subhed|subhead)\b/.test(className);
}

function imageGroupIndexByUrl(imageGroups, storyUrl = "") {
  const index = new Map();
  for (const group of imageGroups) {
    for (const url of imageGroupUrls(group)) {
      const normalized = normalizeUrl(url, storyUrl);
      if (normalized) index.set(normalized, group);
    }
  }
  return index;
}

function imageGroupForDownload(download, index, storyUrl = "") {
  for (const value of [download?.url, download?.finalUrl]) {
    const normalized = normalizeUrl(value, storyUrl);
    if (normalized && index.has(normalized)) return index.get(normalized);
  }
  return null;
}

function storyTextExclusionKeysFromProbe(probe) {
  const keys = new Set();
  for (const group of authorInputImageGroupsFromProbe(probe)) {
    const captionKey = storyTextKey(group?.caption?.text || "");
    if (captionKey) keys.add(captionKey);
    for (const credit of Array.isArray(group?.credits) ? group.credits : []) {
      const creditKey = storyTextKey(credit?.text || "");
      if (creditKey) keys.add(creditKey);
    }
  }
  for (const heading of authorInputHeadingsFromProbe(probe)) {
    const headingKey = storyTextKey(heading?.text || "");
    if (headingKey) keys.add(headingKey);
  }
  return keys;
}

function addUniqueStoryBeat(map, key, seed) {
  if (!key) return null;
  const existing = map.get(key);
  if (existing) return existing;
  const next = {
    ...seed,
    assetFiles: new Set(seed.assetFiles || []),
    assetUrls: new Set(seed.assetUrls || []),
    associationSources: new Set(seed.associationSources || []),
    evidenceRefs: new Set(seed.evidenceRefs || [])
  };
  map.set(key, next);
  return next;
}

function associationUsableForAuthorVisuals(association) {
  const source = String(association?.associationSource || association?.source || "").toLowerCase();
  const beats = Array.isArray(association?.associatedBeats) ? association.associatedBeats : [];
  const hasNonPreloadBeat = beats.some((beat) => String(beat?.source || "").toLowerCase() !== "inferred-preload-based");
  if (source === "inferred-preload-based" && !hasNonPreloadBeat) return false;
  if (beats.length && beats.every((beat) => String(beat?.source || "").toLowerCase() === "inferred-preload-based")) return false;
  return true;
}

function visualBeatEntriesFromJudgment(judgment, assetManifest, probe = null) {
  const indexes = assetRecordIndexes(assetManifest);
  const visualBeats = new Map();
  const canonicalStateByBeatId = new Map((Array.isArray(judgment?.beatRuntimeStates) ? judgment.beatRuntimeStates : [])
    .filter((beat) => beat?.beatId && cleanStoryText(beat?.text))
    .map((beat) => [beat.beatId, beat]));
  const narrativeSectionByHeading = new Map();
  for (const unit of activeTextUnitsFromProbe(probe || {})) {
    const headingKey = storyTextKey(unit?.sectionHeading);
    if (!headingKey) continue;
    const existing = narrativeSectionByHeading.get(headingKey);
    const explicitlyPaired = unit?.observed?.structuralRole === "heading-body";
    const existingExplicitlyPaired = existing?.observed?.structuralRole === "heading-body";
    if (!existing || (explicitlyPaired && !existingExplicitlyPaired)) {
      narrativeSectionByHeading.set(headingKey, unit);
    }
  }

  const addAssociationVisualBeats = (association, associationIndex, options) => {
    if (!associationUsableForAuthorVisuals(association)) return;
    const record = assetRecordForProbeAssociation(association, indexes);
    if (!record || record.asset_type !== options.assetType) return;
    const assetFile = record.local_path || association.assetFile || "";
    const beats = Array.isArray(association.associatedBeats) ? association.associatedBeats : [];
    beats.forEach((beat, beatIndex) => {
      if (String(beat?.source || "").toLowerCase() === "inferred-preload-based") return;
      const canonicalState = canonicalStateByBeatId.get(beat?.beatId);
      const associatedText = cleanStoryText(canonicalState?.text || beat?.text);
      const narrativeSection = narrativeSectionByHeading.get(storyTextKey(associatedText));
      const text = cleanStoryText(narrativeSection?.text || associatedText);
      const sectionHeading = cleanStoryText(narrativeSection?.sectionHeading || "");
      const scrollPercent = Number.isFinite(Number(beat?.scrollPercent)) ? Number(beat.scrollPercent) : null;
      const key = beat?.beatId
        ? `beat:${beat.beatId}`
        : `${storyTextKey(text)}|scroll:${scrollPercent ?? ""}`;
      if (!key) return;
      const entry = addUniqueStoryBeat(visualBeats, key, {
        category: options.category,
        index: visualBeats.size,
        tag: options.tag,
        text,
        title: sectionHeading || titleFromStoryText(text, `Visual beat ${visualBeats.size + 1}`),
        sectionHeading,
        domOrder: Number.isFinite(Number(narrativeSection?.domOrder))
          ? Number(narrativeSection.domOrder)
          : Number.isFinite(Number(canonicalState?.domOrder))
            ? Number(canonicalState.domOrder)
            : domOrderForScrollPercent(beat?.scrollPercent, associationIndex * 10 + beatIndex),
        scrollPercent,
        beatId: beat?.beatId || "",
        source: options.source,
        assetFiles: [],
        assetUrls: [],
        associationSources: [],
        evidenceRefs: []
      });
      entry.assetFiles.add(assetFile);
      if (record.asset_url) entry.assetUrls.add(record.asset_url);
      if (beat?.source || association.associationSource) entry.associationSources.add(beat?.source || association.associationSource);
      for (const ref of association.evidenceRefs || []) entry.evidenceRefs.add(ref);
    });
  };

  const modelAssociations = Array.isArray(judgment?.modelBeatAssociations) ? judgment.modelBeatAssociations : [];
  modelAssociations.forEach((association, associationIndex) => {
    addAssociationVisualBeats(association, associationIndex, {
      assetType: "model",
      category: "animation_probe_visual_beat",
      tag: "storyvr-animation-probe",
      source: "animation_probe_model_beat_association"
    });
  });

  const imageAssociations = Array.isArray(judgment?.imageBeatAssociations) ? judgment.imageBeatAssociations : [];
  imageAssociations.forEach((association, associationIndex) => {
    addAssociationVisualBeats(association, modelAssociations.length + associationIndex, {
      assetType: "texture",
      category: "animation_probe_image_beat",
      tag: "storyvr-image-probe",
      source: "animation_probe_image_beat_association"
    });
  });

  return Array.from(visualBeats.values())
    .sort((a, b) => a.domOrder - b.domOrder)
    .map((entry, index) => {
      const assetFiles = Array.from(entry.assetFiles);
      const assetUrls = Array.from(entry.assetUrls);
      return {
        category: entry.category,
        index,
        tag: entry.tag,
        text: entry.text,
        title: entry.title,
        ...(entry.sectionHeading ? { sectionHeading: entry.sectionHeading } : {}),
        domOrder: entry.domOrder,
        url: assetUrls[0] || "",
        file: assetFiles.join(" "),
        attributes: {
          probeBeatId: entry.beatId || "",
          scrollPercent: entry.scrollPercent,
          probeAssetFiles: assetFiles,
          probeAssetUrls: assetUrls,
          probeAssociationSources: Array.from(entry.associationSources),
          probeEvidenceRefs: Array.from(entry.evidenceRefs).slice(0, 12)
        }
      };
    });
}

function sourceActiveTextUnitsFromProbe(probe) {
  const seeded = Array.isArray(probe?.storyvr_author_input?.text_units)
    ? probe.storyvr_author_input.text_units
    : [];
  return seeded.length
    ? seeded
    : (Array.isArray(probe?.snapshots) ? probe.snapshots : []).flatMap((snapshot, snapshotIndex) => (
      (Array.isArray(snapshot.activeTexts) ? snapshot.activeTexts : []).map((item, textIndex) => ({
        text: item?.text || "",
        tag: item?.tag || "",
        className: item?.className || "",
        elementId: item?.id || "",
        selector: item?.selector || "",
        ancestorSelectors: Array.isArray(item?.ancestorSelectors) ? item.ancestorSelectors : [],
        scrollPercent: snapshot.scrollPercent,
        domOrder: Number.isFinite(Number(item?.domOrder))
          ? Number(item.domOrder)
          : domOrderForScrollPercent(snapshot.scrollPercent, snapshotIndex * 10 + textIndex),
        source: snapshot.id || `snapshot-${snapshotIndex + 1}`
      }))
    ));
}

function splitTextUnitByEmbeddedHeadings(unit, headings) {
  const text = cleanStoryText(unit?.text);
  if (!text) return [];
  if (cleanStoryText(unit?.sectionHeading)) return [{ ...unit, text }];
  const lowerText = text.toLowerCase();
  const matches = [];
  let cursor = 0;
  for (const heading of headings) {
    const headingText = cleanStoryText(heading?.text);
    const headingKey = headingText.toLowerCase();
    if (!headingKey) continue;
    const matchIndex = lowerText.indexOf(headingKey, cursor);
    if (matchIndex < 0) continue;
    matches.push({ heading, headingText, index: matchIndex, end: matchIndex + headingText.length });
    cursor = matchIndex + headingText.length;
  }
  if (!matches.length || cleanStoryText(text.slice(0, matches[0].index))) return [{ ...unit, text }];

  const sections = matches.flatMap((match, index) => {
    const body = cleanStoryText(text.slice(match.end, matches[index + 1]?.index ?? text.length));
    if (!body) return [];
    const baseId = String(unit?.id || "runtime-text").trim() || "runtime-text";
    return [{
      ...unit,
      id: `${baseId}-section-${index + 1}`,
      text: body,
      title: match.headingText,
      sectionHeading: match.headingText,
      domOrder: Number.isFinite(Number(match.heading?.domOrder)) ? Number(match.heading.domOrder) : unit?.domOrder,
      observed: {
        ...(unit?.observed || {}),
        structuralRole: "heading-body",
        sourceCompositeTextUnitId: unit?.id || ""
      }
    }];
  });
  return sections.length ? sections : [{ ...unit, text }];
}

function activeTextUnitsFromProbe(probe) {
  const headings = authorInputHeadingsFromProbe(probe);
  const sourceUnits = sourceActiveTextUnitsFromProbe(probe)
    .flatMap((unit) => splitTextUnitByEmbeddedHeadings(unit, headings));

  const seen = new Set();
  const excludedKeys = storyTextExclusionKeysFromProbe(probe);
  const units = [];
  sourceUnits.forEach((unit, index) => {
    const text = cleanStoryText(unit?.text);
    const key = storyTextKey(text);
    if (!key || seen.has(key)) return;
    if (excludedKeys.has(key)) return;
    seen.add(key);
    const domOrder = Number.isFinite(Number(unit.domOrder))
      ? Number(unit.domOrder)
      : domOrderForScrollPercent(unit.scrollPercent, index);
    const precedingHeading = [...headings].reverse().find((heading) => Number(heading.domOrder) <= domOrder);
    const sectionHeading = cleanStoryText(unit.sectionHeading || precedingHeading?.text || "");
    units.push({
      id: unit.id || "",
      category: "animation_probe_active_text",
      index: units.length,
      tag: unit.tag || "runtime-text",
      className: unit.className || "",
      elementId: unit.elementId || "",
      selector: unit.selector || "",
      ancestorSelectors: Array.isArray(unit.ancestorSelectors) ? unit.ancestorSelectors.filter(Boolean) : [],
      text,
      title: sectionHeading || titleFromStoryText(text, `Narrative text ${units.length + 1}`),
      ...(sectionHeading ? { sectionHeading } : {}),
      domOrder,
      observed: {
        ...(unit.observed || {}),
        source: unit.source || "runtime-snapshot",
        scrollPercent: Number.isFinite(Number(unit.scrollPercent)) ? Number(unit.scrollPercent) : null
      }
    });
  });
  return units.sort((a, b) => a.domOrder - b.domOrder);
}

function variantSafeId(value, fallback = "variant") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function variantSourceEvidenceOrder(probe, label, fallbackIndex = 0) {
  const key = storyTextKey(label).replace(/[^a-z0-9]+/g, " ").trim();
  if (!key) return Number.MAX_SAFE_INTEGER - 1000 + fallbackIndex;
  const tokens = key.split(" ").filter((token) => token.length > 2);
  const windows = Array.isArray(probe?.page_keyword_windows) ? probe.page_keyword_windows : [];
  let earliest = Number.MAX_SAFE_INTEGER;
  let earliestStructured = Number.MAX_SAFE_INTEGER;
  for (const window of windows) {
    // Keep attribute values such as `id="forest-option-panel"` in the evidence.
    // cleanStoryText/storyTextKey intentionally strips markup, which is useful for
    // prose but would erase the strongest source-order cue for option containers.
    const context = String(window?.context || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    if (!context || !tokens.every((token) => context.includes(token))) continue;
    const index = Number(window?.index);
    if (!Number.isFinite(index)) continue;
    earliest = Math.min(earliest, index);
    if (/\b(info visual|option panel|variant|card|slide wrapper|tabpanel)\b/.test(context)) {
      earliestStructured = Math.min(earliestStructured, index);
    }
  }
  if (earliestStructured !== Number.MAX_SAFE_INTEGER) return earliestStructured;
  return earliest === Number.MAX_SAFE_INTEGER ? earliest - 1000 + fallbackIndex : earliest;
}

function variantOptionTextFromProbe(probe, labels, label, groupTitle = "") {
  const normalizedLabels = labels.map((value) => ({ value, key: storyTextKey(value) })).filter((item) => item.key);
  const target = storyTextKey(label);
  if (!target) return "";
  const units = activeTextUnitsFromProbe(probe)
    .map((unit) => ({ text: cleanStoryText(unit.text), key: storyTextKey(unit.text) }))
    .filter((unit) => unit.key.includes(target));
  let best = "";
  for (const unit of units) {
    const groupKey = storyTextKey(groupTitle);
    const groupStart = groupKey ? unit.key.lastIndexOf(groupKey) : -1;
    if (groupKey && groupStart < 0) continue;
    const start = unit.key.indexOf(target, groupStart >= 0 ? groupStart + groupKey.length : 0);
    if (start < 0) continue;
    const nextStarts = normalizedLabels
      .filter((item) => item.key !== target)
      .map((item) => unit.key.indexOf(item.key, start + target.length))
      .filter((index) => index > start);
    const end = nextStarts.length ? Math.min(...nextStarts) : unit.text.length;
    const candidate = cleanStoryText(unit.text.slice(start, end));
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

function variantAssetRecordsForValues(values, indexes, storyUrl) {
  const records = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = normalizeUrl(value, storyUrl);
    let record = normalized && indexes.byUrl.has(normalized) ? indexes.byUrl.get(normalized) : null;
    const file = path.basename(String(value || ""));
    if (!record && file && indexes.byFile.has(normalizeAssetKey(file))) record = indexes.byFile.get(normalizeAssetKey(file));
    if (!record) continue;
    const key = normalizeAssetKey(record.local_path || record.final_url || record.asset_url || file);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    records.push(record);
  }
  return records;
}

function collectedVariantAssetAssociations(probe) {
  if (Array.isArray(probe?.variant_asset_associations)) return probe.variant_asset_associations;
  if (Array.isArray(probe?.storyvr_author_input?.variant_asset_associations)) {
    return probe.storyvr_author_input.variant_asset_associations;
  }
  return [];
}

function collectedVariantHierarchy(probe) {
  if (Array.isArray(probe?.variant_hierarchy)) return probe.variant_hierarchy;
  if (Array.isArray(probe?.storyvr_author_input?.variant_hierarchy)) {
    return probe.storyvr_author_input.variant_hierarchy;
  }
  return [];
}

function collectedVariantDependencyConfirmed(record) {
  return ![
    record?.confirmed,
    record?.dependencyConfirmed,
    record?.dependency_confirmed
  ].some((value) => value === false || String(value || "").toLowerCase() === "false");
}

function collectedVariantRecoveryReliable(probe) {
  const status = String(probe?.variant_recovery?.status || "");
  if (!status) return true;
  return ["verified", "top-verified-with-mismatches", "repaired-and-verified"].includes(status);
}

function variantAssetAssociationsForOption(associations, group, groupId, option, optionId) {
  return associations.filter((association) => {
    const associationGroupId = variantSafeId(association?.groupId || association?.group_id, "");
    const associationOptionId = variantSafeId(association?.optionId || association?.option_id, "");
    const groupMatches = associationGroupId
      ? associationGroupId === groupId
      : storyTextKey(association?.groupTitle || association?.group_title || "") === storyTextKey(group?.title || "");
    const optionMatches = associationOptionId
      ? associationOptionId === optionId
      : storyTextKey(association?.optionLabel || association?.option_label || "") === storyTextKey(option?.label || option?.title || "");
    const hasParentContext = Boolean(
      variantSafeId(association?.parentGroupId || association?.parent_group_id, "")
      && variantSafeId(association?.parentOptionId || association?.parent_option_id, "")
    );
    return groupMatches
      && optionMatches
      && (!hasParentContext || collectedVariantDependencyConfirmed(association));
  });
}

function variantAssociationAssetValues(association) {
  return Array.from(new Set([
    ...(Array.isArray(association?.assetUrls) ? association.assetUrls : []),
    ...(Array.isArray(association?.asset_urls) ? association.asset_urls : []),
    ...(Array.isArray(association?.assetFiles) ? association.assetFiles : []),
    ...(Array.isArray(association?.asset_files) ? association.asset_files : []),
    ...(Array.isArray(association?.assetIds) ? association.assetIds : []),
    ...(Array.isArray(association?.asset_ids) ? association.asset_ids : []),
    ...variantAssociationChannelValues(association, "runtime"),
    ...variantAssociationChannelValues(association, "dom")
  ].filter(Boolean)));
}

function variantAssociationChannelValues(association, channel) {
  const prefix = channel === "runtime" ? "runtime" : "dom";
  return [
    ...(Array.isArray(association?.[`${prefix}AssetUrls`]) ? association[`${prefix}AssetUrls`] : []),
    ...(Array.isArray(association?.[`${prefix}_asset_urls`]) ? association[`${prefix}_asset_urls`] : []),
    ...(Array.isArray(association?.[`${prefix}AssetFiles`]) ? association[`${prefix}AssetFiles`] : []),
    ...(Array.isArray(association?.[`${prefix}_asset_files`]) ? association[`${prefix}_asset_files`] : []),
    ...(Array.isArray(association?.[`${prefix}AssetIds`]) ? association[`${prefix}AssetIds`] : []),
    ...(Array.isArray(association?.[`${prefix}_asset_ids`]) ? association[`${prefix}_asset_ids`] : [])
  ].filter(Boolean);
}

function variantAssociationChannelUrlValues(association, channel) {
  const prefix = channel === "runtime" ? "runtime" : "dom";
  return [
    ...(Array.isArray(association?.[`${prefix}AssetUrls`]) ? association[`${prefix}AssetUrls`] : []),
    ...(Array.isArray(association?.[`${prefix}_asset_urls`]) ? association[`${prefix}_asset_urls`] : [])
  ].filter(Boolean);
}

function variantAssociationCaptureStatus(association) {
  const status = String(association?.captureStatus || association?.capture_status || "").trim();
  return ["ok", "partial", "unavailable"].includes(status) ? status : "";
}

function variantAssociationSnapshotIds(association) {
  return Array.from(new Set([
    ...(Array.isArray(association?.snapshotIds) ? association.snapshotIds : []),
    ...(Array.isArray(association?.snapshot_ids) ? association.snapshot_ids : [])
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function variantAssociationAssetChannel(association, channel, indexes, storyUrl) {
  const values = variantAssociationChannelValues(association, channel);
  const records = variantAssetRecordsForValues(values, indexes, storyUrl);
  const explicitUrls = variantAssociationChannelUrlValues(association, channel)
    .map((value) => normalizeUrl(value, storyUrl))
    .filter(Boolean);
  const assetIds = Array.from(new Set(records
    .map((record) => path.basename(record.local_path || record.final_url || record.asset_url || ""))
    .filter(Boolean)));
  const assetUrls = Array.from(new Set([
    ...explicitUrls,
    ...records.map((record) => record.final_url || record.asset_url).filter(Boolean)
  ]));
  const captureStatus = variantAssociationCaptureStatus(association);
  const provenance = channel === "runtime"
    ? (captureStatus === "unavailable"
      ? "unavailable"
      : (values.length || ["ok", "partial"].includes(captureStatus) ? "direct-runtime" : "unknown"))
    : (values.length ? "dom-observed" : "unknown");
  return {
    assetIds,
    assetUrls,
    captureStatus,
    snapshotIds: variantAssociationSnapshotIds(association),
    provenance
  };
}

function variantAssociationAssetChannels(association, indexes, storyUrl) {
  return {
    runtime: variantAssociationAssetChannel(association, "runtime", indexes, storyUrl),
    dom: variantAssociationAssetChannel(association, "dom", indexes, storyUrl)
  };
}

function normalizedVariantAssetChannelFields(channels) {
  return {
    runtimeAssetIds: [...(channels?.runtime?.assetIds || [])],
    runtimeAssetUrls: [...(channels?.runtime?.assetUrls || [])],
    domAssetIds: [...(channels?.dom?.assetIds || [])],
    domAssetUrls: [...(channels?.dom?.assetUrls || [])],
    captureStatus: channels?.runtime?.captureStatus || "",
    snapshotIds: [...(channels?.runtime?.snapshotIds || channels?.dom?.snapshotIds || [])],
    runtimeAssetProvenance: channels?.runtime?.provenance || "unknown",
    domAssetProvenance: channels?.dom?.provenance || "unknown"
  };
}

function normalizeCollectedVariantGroups(probe, assetManifest) {
  const rawGroups = Array.isArray(probe?.variant_groups) && probe.variant_groups.length
    ? probe.variant_groups
    : Array.isArray(probe?.storyvr_author_input?.variant_groups) ? probe.storyvr_author_input.variant_groups : [];
  const indexes = assetRecordIndexes(assetManifest);
  const storyUrl = probe?.story_url || "";
  const associations = collectedVariantAssetAssociations(probe);
  return rawGroups.flatMap((group, groupIndex) => {
    const rawOptions = Array.isArray(group?.options) ? group.options : [];
    const groupId = variantSafeId(group?.id || group?.title, `variant-group-${groupIndex + 1}`);
    const options = rawOptions.flatMap((option, optionIndex) => {
      const optionId = variantSafeId(option?.id || option?.label || option?.title, `${groupId}-option-${optionIndex + 1}`);
      const optionAssociations = variantAssetAssociationsForOption(associations, group, groupId, option, optionId);
      const association = optionAssociations[0] || null;
      const associationValues = variantAssociationAssetValues(association);
      const associationChannels = association
        ? variantAssociationAssetChannels(association, indexes, storyUrl)
        : null;
      const channelFields = associationChannels
        ? normalizedVariantAssetChannelFields(associationChannels)
        : null;
      const optionValues = [
        ...(Array.isArray(option?.assetUrls) ? option.assetUrls : []),
        ...(Array.isArray(option?.assetFiles) ? option.assetFiles : []),
        ...(Array.isArray(option?.asset_urls) ? option.asset_urls : []),
        ...(Array.isArray(option?.asset_files) ? option.asset_files : []),
        ...(Array.isArray(option?.asset_ids) ? option.asset_ids : []),
        option?.assetUrl,
        option?.assetFile,
        option?.asset_id
      ].filter(Boolean);
      const records = variantAssetRecordsForValues(
        associationValues.length ? associationValues : optionValues,
        indexes,
        storyUrl
      );
      const label = cleanStoryText(option?.label || option?.title || `Option ${optionIndex + 1}`);
      if (!label) return [];
      const associationContexts = optionAssociations.flatMap((contextAssociation) => {
        const parentGroupId = variantSafeId(contextAssociation?.parentGroupId || contextAssociation?.parent_group_id, "");
        const parentOptionId = variantSafeId(contextAssociation?.parentOptionId || contextAssociation?.parent_option_id, "");
        if (!parentGroupId || !parentOptionId) return [];
        const contextRecords = variantAssetRecordsForValues(
          variantAssociationAssetValues(contextAssociation),
          indexes,
          storyUrl
        );
        const contextChannelFields = normalizedVariantAssetChannelFields(
          variantAssociationAssetChannels(contextAssociation, indexes, storyUrl)
        );
        return [{
          parentGroupId,
          parentOptionId,
          asset_ids: contextRecords.map((record) => path.basename(record.local_path || record.final_url || record.asset_url || "")).filter(Boolean),
          asset_files: contextRecords.map((record) => record.local_path).filter(Boolean),
          asset_urls: contextRecords.map((record) => record.final_url || record.asset_url).filter(Boolean),
          interactionPath: Array.isArray(contextAssociation?.interactionPath || contextAssociation?.interaction_path)
            ? (contextAssociation.interactionPath || contextAssociation.interaction_path).map((item) => ({
              groupId: variantSafeId(item?.groupId || item?.group_id, ""),
              optionId: variantSafeId(item?.optionId || item?.option_id, ""),
              optionLabel: cleanStoryText(item?.optionLabel || item?.option_label || "")
            })).filter((item) => item.groupId && item.optionId)
            : [],
          dependencyConfirmed: collectedVariantDependencyConfirmed(contextAssociation),
          source: contextAssociation.source || "collector-verified-nested-interaction",
          ...contextChannelFields
        }];
      });
      return [{
        id: optionId,
        label,
        text: cleanStoryText(option?.text || label),
        sourceOrder: Number.isFinite(Number(option?.sourceOrder)) ? Number(option.sourceOrder) : optionIndex,
        domOrder: Number.isFinite(Number(option?.domOrder)) ? Number(option.domOrder) : null,
        asset_ids: records.map((record) => path.basename(record.local_path || record.final_url || record.asset_url || "")).filter(Boolean),
        asset_files: records.map((record) => record.local_path).filter(Boolean),
        asset_urls: records.map((record) => record.final_url || record.asset_url).filter(Boolean),
        ...(channelFields || {}),
        evidence: association
          ? {
            ...(option?.evidence && typeof option.evidence === "object" ? option.evidence : {}),
            source: association.source || "collector-verified-variant-interaction",
            ...(channelFields || {}),
            associationContexts
          }
          : option?.evidence || null
      }];
    }).sort((left, right) => left.sourceOrder - right.sourceOrder);
    if (options.length < 2) return [];
    const requestedDefault = variantSafeId(group?.defaultOptionId || "", "");
    const defaultOptionId = options.some((option) => option.id === requestedDefault) ? requestedDefault : options[0].id;
    return [{
      schemaVersion: "storyvr-source-variant-group/v1",
      id: groupId,
      title: cleanStoryText(group?.title || "Selectable variants"),
      domOrder: Number.isFinite(Number(group?.domOrder)) ? Number(group.domOrder) : options[0].domOrder,
      selectionMode: "single",
      defaultOptionId,
      control: {
        kind: String(group?.control?.kind || "previous-next"),
        previousLabel: cleanStoryText(group?.control?.previousLabel || "Previous option"),
        nextLabel: cleanStoryText(group?.control?.nextLabel || "Next option"),
        wrap: group?.control?.wrap !== false
      },
      options,
      hierarchy: group?.hierarchy && typeof group.hierarchy === "object"
        ? { ...group.hierarchy }
        : { role: "candidate-top-level" },
      evidence: {
        source: "runtime-animation-collector",
        ...(group?.evidence && typeof group.evidence === "object" ? group.evidence : {})
      }
    }];
  });
}

function selectionAnnouncementsFromStoryText(value) {
  const text = cleanStoryText(value);
  const pattern = /\b(?:you(?:['’]ve|\s+have)?|currently)\s+selected\s+(.{1,140}?)\.\s*(?:read|learn|view|see)\s+(?:more|additional)(?:\s+information)?(?:\s+about\s+(?:it|this)(?:\s+below)?)?\.?\s*/gi;
  const matches = [];
  let match;
  while ((match = pattern.exec(text))) {
    const label = cleanStoryText(match[1]);
    if (!label || label.length > 140) continue;
    matches.push({ label, start: match.index, contentStart: pattern.lastIndex });
  }
  return { text, matches };
}

function trimNestedVariantTail(value) {
  const text = cleanStoryText(value);
  const marker = text.search(/[.!?]\s+[A-Z][^.!?]{2,180}\b(?:click|choose|select|tap|swipe)\b[^.!?]{0,100}:\s*/i);
  return marker >= 0 ? cleanStoryText(text.slice(0, marker + 1)) : text;
}

function announcementVariantTitle(probe, unit, text, firstStart) {
  const explicitHeading = cleanStoryText(unit?.sectionHeading || "");
  if (explicitHeading) return explicitHeading;
  const prefixKey = storyTextKey(text.slice(0, firstStart));
  const heading = authorInputHeadingsFromProbe(probe)
    .filter((item) => {
      const key = storyTextKey(item?.text || "");
      return key && prefixKey.includes(key);
    })
    .sort((left, right) => {
      const leftDistance = Math.abs(Number(left?.domOrder || 0) - Number(unit?.domOrder || 0));
      const rightDistance = Math.abs(Number(right?.domOrder || 0) - Number(unit?.domOrder || 0));
      return leftDistance - rightDistance || cleanStoryText(right?.text).length - cleanStoryText(left?.text).length;
    })[0];
  if (heading) return cleanStoryText(heading.text);
  const firstSentence = cleanStoryText(text.slice(0, firstStart)).match(/^(.{3,180}?[?!\.])(?:\s|$)/)?.[1];
  return cleanStoryText(firstSentence || "Selectable options");
}

function textDerivedVariantGroupsFromProbe(probe) {
  const groups = [];
  for (const unit of activeTextUnitsFromProbe(probe)) {
    const { text, matches } = selectionAnnouncementsFromStoryText(unit.text);
    const unique = [];
    const seenLabels = new Set();
    for (const match of matches) {
      const key = storyTextKey(match.label);
      if (!key || seenLabels.has(key)) continue;
      seenLabels.add(key);
      unique.push(match);
    }
    if (unique.length < 2) continue;
    const title = announcementVariantTitle(probe, unit, text, unique[0].start);
    const groupId = variantSafeId(`${title}-${unique[0].label}`, `variant-group-${groups.length + 1}`);
    const options = unique.map((item, optionIndex) => {
      const nextStart = unique[optionIndex + 1]?.start ?? text.length;
      const rawDetail = text.slice(item.contentStart, nextStart);
      const detail = optionIndex === unique.length - 1 ? trimNestedVariantTail(rawDetail) : cleanStoryText(rawDetail);
      return {
        id: variantSafeId(item.label, `${groupId}-option-${optionIndex + 1}`),
        label: item.label,
        text: detail ? `${item.label}. ${detail}` : item.label,
        sourceOrder: optionIndex,
        domOrder: Number(unit.domOrder || 0) + optionIndex,
        asset_ids: [],
        asset_files: [],
        asset_urls: [],
        evidence: {
          source: "runtime-accessibility-selection-announcement",
          textUnitId: unit.observed?.source || "",
          announcementIndex: optionIndex
        }
      };
    });
    groups.push({
      schemaVersion: "storyvr-source-variant-group/v1",
      id: groupId,
      title,
      domOrder: unit.domOrder,
      selectionMode: "single",
      defaultOptionId: options[0].id,
      control: {
        kind: "single-select",
        previousLabel: "Previous option",
        nextLabel: "Next option",
        wrap: false
      },
      options,
      evidence: {
        source: "runtime-accessibility-selection-announcements",
        textUnitId: unit.observed?.source || "",
        optionCount: options.length,
        confidence: 0.95
      }
    });
  }
  return groups;
}

function accessibleCardLabelsFromText(value) {
  const text = cleanStoryText(value);
  const pattern = /\b([A-Z][A-Za-z0-9&'’/-]*(?:\s+[A-Z][A-Za-z0-9&'’/-]*){0,4})\s+A\s+(?:3D\s+)?(?:illustration|image|model|view)\s+of\s+(?:an?\s+)?([^.!?]{1,100})[.!?]/g;
  const labels = [];
  const seen = new Set();
  let match;
  while ((match = pattern.exec(text))) {
    const label = cleanStoryText(match[1]);
    const key = storyTextKey(label);
    if (!key || label.length > 100 || seen.has(key)) continue;
    seen.add(key);
    labels.push({ label, start: match.index });
  }
  return labels;
}

const VARIANT_ASSET_GENERIC_TOKENS = new Set([
  "asset", "model", "mesh", "scene", "small", "large", "big", "low", "high", "lod",
  "animated", "animation", "swimming", "moving", "idle", "final", "copy"
]);

function variantAssetSemanticTokens(association, record) {
  const raw = path.basename(String(association?.assetFile || record?.local_path || association?.assetUrl || record?.asset_url || ""), path.extname(String(association?.assetFile || record?.local_path || association?.assetUrl || record?.asset_url || "")));
  return raw.toLowerCase()
    .replace(/[a-f0-9]{8,}$/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !/^v?\d+$/.test(token) && !VARIANT_ASSET_GENERIC_TOKENS.has(token));
}

function accessibleLabelForAssociation(accessibleLabels, association, record) {
  const tokens = variantAssetSemanticTokens(association, record);
  if (!tokens.length) return null;
  const direct = accessibleLabels
    .map((item) => ({ ...item, key: storyTextKey(item.label) }))
    .find((item) => tokens.some((token) => item.key.includes(token) || token.includes(item.key)));
  if (direct) return direct;
  const reasoningWords = String(association?.reasoning || "").match(/\b[A-Za-z][A-Za-z-]{2,}\b/g) || [];
  const inferredWord = reasoningWords.find((word) => tokens.some((token) => (
    word.toLowerCase().startsWith(token) || token.startsWith(word.toLowerCase())
  )));
  return inferredWord ? { label: inferredWord, start: Number.MAX_SAFE_INTEGER } : null;
}

function sharedAccessibleLabelSuffix(accessibleLabels) {
  const counts = new Map();
  for (const item of accessibleLabels) {
    const words = cleanStoryText(item.label).split(/\s+/).filter(Boolean);
    const suffix = words.at(-1)?.toLowerCase() || "";
    if (suffix) counts.set(suffix, (counts.get(suffix) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= Math.max(2, Math.ceil(accessibleLabels.length * 0.6)))
    .sort((left, right) => right[1] - left[1])[0]?.[0] || "";
}

function titleCaseWords(value) {
  return cleanStoryText(value).replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function optionLabelForAssociation(accessibleLabels, association, record, sharedSuffix) {
  const matched = accessibleLabelForAssociation(accessibleLabels, association, record);
  let label = cleanStoryText(matched?.label || variantAssetSemanticTokens(association, record).join(" ") || "Option");
  if (sharedSuffix && !storyTextKey(label).split(/\s+/).includes(sharedSuffix)) label = `${label} ${sharedSuffix}`;
  return { label: titleCaseWords(label), matchedAccessibleLabel: matched && matched.start !== Number.MAX_SAFE_INTEGER };
}

function normalizedRangeTokens(value) {
  const text = String(value || "").replace(/[–—]/g, "-");
  return Array.from(text.matchAll(/\b\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\b/g), (match) => ({
    token: match[0].replace(/\s+/g, ""),
    start: match.index ?? Number.MAX_SAFE_INTEGER
  }));
}

function cardOptionSourceOrder(beatText, accessibleLabels, label, association, fallbackIndex) {
  const normalizedBeat = String(beatText || "").replace(/[–—]/g, "-");
  const labelKey = storyTextKey(label);
  const labelStart = storyTextKey(normalizedBeat).indexOf(labelKey);
  const sortedLabels = accessibleLabels.slice().sort((left, right) => left.start - right.start);
  const accessible = sortedLabels.find((item) => storyTextKey(item.label) === labelKey);
  if (accessible) {
    const nextStart = sortedLabels.find((item) => item.start > accessible.start)?.start ?? normalizedBeat.length;
    const ranges = normalizedRangeTokens(normalizedBeat.slice(accessible.start, nextStart));
    if (ranges.length) {
      const prefixStart = normalizedBeat.indexOf(ranges[0].token);
      if (prefixStart >= 0) return prefixStart;
    }
  }
  const reasoningRanges = normalizedRangeTokens(association?.reasoning || "");
  for (const range of reasoningRanges) {
    const start = normalizedBeat.indexOf(range.token);
    if (start >= 0) return start;
  }
  if (labelStart >= 0) return labelStart;
  return Number.MAX_SAFE_INTEGER - 1000 + fallbackIndex;
}

function cardOptionText(beatText, accessibleLabels, label) {
  const key = storyTextKey(label);
  const matching = accessibleLabels.find((item) => storyTextKey(item.label) === key);
  if (!matching) return label;
  const nextStart = accessibleLabels.filter((item) => item.start > matching.start).sort((left, right) => left.start - right.start)[0]?.start ?? beatText.length;
  return cleanStoryText(beatText.slice(matching.start, nextStart)) || label;
}

function cardGroupTitleFromProbe(probe, beatText, sharedSuffix) {
  const beatKey = storyTextKey(beatText);
  for (const unit of activeTextUnitsFromProbe(probe)) {
    const unitKey = storyTextKey(unit.text);
    const start = unitKey.indexOf(beatKey);
    if (start <= 0) continue;
    const prefix = cleanStoryText(unit.text.slice(Math.max(0, start - 260), start));
    const match = prefix.match(/(?:^|[.!?])\s*([^.!?]{3,200}\b(?:click|choose|select|tap|swipe)\b[^.!?]{0,100}:?)\s*$/i);
    if (match) return cleanStoryText(match[1]).replace(/:\s*$/, "");
  }
  return sharedSuffix ? `${titleCaseWords(sharedSuffix)} options` : "Selectable model options";
}

function inferredAccessibleCardVariantGroups(probe, judgment, assetManifest) {
  const indexes = assetRecordIndexes(assetManifest);
  const clusters = new Map();
  for (const [associationIndex, association] of (Array.isArray(judgment?.modelBeatAssociations) ? judgment.modelBeatAssociations : []).entries()) {
    const record = assetRecordForProbeAssociation(association, indexes);
    if (!record || record.asset_type !== "model") continue;
    for (const [beatIndex, beat] of (Array.isArray(association?.associatedBeats) ? association.associatedBeats : []).entries()) {
      const confidence = Number(beat?.confidence ?? association?.associationConfidence);
      if (!Number.isFinite(confidence) || confidence < MIN_ACCESSIBLE_CARD_MODEL_CONFIDENCE) continue;
      const text = cleanStoryText(beat?.text);
      if (!text) continue;
      const scrollPercent = Number.isFinite(Number(beat?.scrollPercent)) ? Number(beat.scrollPercent) : null;
      const key = beat?.beatId || `${storyTextKey(text)}|${scrollPercent == null ? "" : scrollPercent.toFixed(1)}`;
      const cluster = clusters.get(key) || { text, scrollPercent, items: [] };
      cluster.items.push({ association, associationIndex, beatIndex, beat, confidence, record });
      clusters.set(key, cluster);
    }
  }

  return Array.from(clusters.values()).flatMap((cluster, clusterIndex) => {
    const accessibleLabels = accessibleCardLabelsFromText(cluster.text);
    if (accessibleLabels.length < 2 || cluster.items.length < 2) return [];
    const sharedSuffix = sharedAccessibleLabelSuffix(accessibleLabels);
    const candidates = cluster.items.flatMap((item) => {
      const resolved = optionLabelForAssociation(accessibleLabels, item.association, item.record, sharedSuffix);
      const cardLanguage = /\b(card|carousel|option|selected|state)\b/i.test(String(item.association?.reasoning || ""));
      if (!resolved.matchedAccessibleLabel && !cardLanguage) return [];
      return [{ ...item, ...resolved }];
    });
    const directMatchCount = candidates.filter((item) => item.matchedAccessibleLabel).length;
    if (candidates.length < 2 || directMatchCount < 2 || directMatchCount < Math.ceil(candidates.length * 0.5)) return [];
    const title = cardGroupTitleFromProbe(probe, cluster.text, sharedSuffix);
    const groupId = variantSafeId(title, `variant-card-group-${clusterIndex + 1}`);
    const sorted = candidates.sort((left, right) => (
      cardOptionSourceOrder(cluster.text, accessibleLabels, left.label, left.association, left.associationIndex * 10 + left.beatIndex)
      - cardOptionSourceOrder(cluster.text, accessibleLabels, right.label, right.association, right.associationIndex * 10 + right.beatIndex)
    ));
    const options = sorted.map((item, optionIndex) => ({
      id: variantSafeId(item.label, `${groupId}-option-${optionIndex + 1}`),
      label: item.label,
      text: cardOptionText(cluster.text, accessibleLabels, item.label),
      sourceOrder: optionIndex,
      domOrder: domOrderForScrollPercent(cluster.scrollPercent, optionIndex),
      asset_ids: [path.basename(item.record.local_path || item.record.final_url || item.record.asset_url || "")].filter(Boolean),
      asset_files: [item.record.local_path].filter(Boolean),
      asset_urls: [item.record.final_url || item.record.asset_url].filter(Boolean),
      evidence: {
        source: item.matchedAccessibleLabel ? "aggregate-accessible-card-label" : "shared-card-association",
        confidence: item.confidence,
        evidenceRefs: Array.isArray(item.association?.evidenceRefs) ? item.association.evidenceRefs.slice(0, 12) : []
      }
    }));
    return [{
      schemaVersion: "storyvr-source-variant-group/v1",
      id: groupId,
      title,
      domOrder: domOrderForScrollPercent(cluster.scrollPercent, 0),
      selectionMode: "single",
      defaultOptionId: options[0].id,
      control: {
        kind: /[←→]|\b(previous|next)\b/i.test(cluster.text) ? "previous-next" : "single-select",
        previousLabel: "Previous option",
        nextLabel: "Next option",
        wrap: true
      },
      options,
      evidence: {
        source: "aggregate-accessible-card-cluster",
        confidence: Math.min(...sorted.map((item) => item.confidence)),
        directlyLabeledOptionCount: directMatchCount
      }
    }];
  });
}

function inferredVariantGroupsFromJudgment(probe, judgment, assetManifest) {
  const indexes = assetRecordIndexes(assetManifest);
  const groups = new Map();
  for (const [associationIndex, association] of (Array.isArray(judgment?.modelBeatAssociations) ? judgment.modelBeatAssociations : []).entries()) {
    const record = assetRecordForProbeAssociation(association, indexes);
    if (!record || record.asset_type !== "model") continue;
    for (const [beatIndex, beat] of (Array.isArray(association?.associatedBeats) ? association.associatedBeats : []).entries()) {
      const confidence = Number(beat?.confidence ?? association?.associationConfidence);
      const source = String(beat?.source || association?.associationSource || "").toLowerCase();
      if (!Number.isFinite(confidence) || confidence < 0.75 || !source.includes("direct")) continue;
      const parts = cleanStoryText(beat?.text).split(/\s+[—–]\s+/).map(cleanStoryText).filter(Boolean);
      if (parts.length < 2) continue;
      const label = parts.shift();
      const title = parts.join(" — ");
      const scrollPercent = Number.isFinite(Number(beat?.scrollPercent)) ? Number(beat.scrollPercent) : null;
      const key = `${storyTextKey(title)}|${scrollPercent == null ? "" : scrollPercent.toFixed(1)}`;
      const group = groups.get(key) || { title, scrollPercent, options: [], evidenceRefs: new Set() };
      group.options.push({
        label,
        sourceOrder: variantSourceEvidenceOrder(probe, label, associationIndex * 10 + beatIndex),
        assetRecord: record,
        evidenceRefs: Array.isArray(association?.evidenceRefs) ? association.evidenceRefs : []
      });
      for (const ref of association?.evidenceRefs || []) group.evidenceRefs.add(ref);
      groups.set(key, group);
    }
  }

  return Array.from(groups.values()).flatMap((group, groupIndex) => {
    if (group.options.length < 2) return [];
    const sorted = group.options.sort((left, right) => left.sourceOrder - right.sourceOrder || left.label.localeCompare(right.label));
    const labels = sorted.map((option) => option.label);
    const groupId = variantSafeId(group.title, `variant-group-${groupIndex + 1}`);
    const options = sorted.map((option, optionIndex) => ({
      id: variantSafeId(option.label, `${groupId}-option-${optionIndex + 1}`),
      label: option.label,
      text: variantOptionTextFromProbe(probe, labels, option.label, group.title) || `${option.label} — ${group.title}`,
      sourceOrder: optionIndex,
      domOrder: domOrderForScrollPercent(group.scrollPercent, optionIndex),
      asset_ids: [path.basename(option.assetRecord.local_path || option.assetRecord.final_url || option.assetRecord.asset_url || "")].filter(Boolean),
      asset_files: [option.assetRecord.local_path].filter(Boolean),
      asset_urls: [option.assetRecord.final_url || option.assetRecord.asset_url].filter(Boolean),
      evidence: {
        source: "direct-source-config",
        evidenceRefs: option.evidenceRefs.slice(0, 12)
      }
    }));
    return [{
      schemaVersion: "storyvr-source-variant-group/v1",
      id: groupId,
      title: group.title,
      domOrder: domOrderForScrollPercent(group.scrollPercent, 0),
      selectionMode: "single",
      defaultOptionId: options[0].id,
      control: {
        kind: "previous-next",
        previousLabel: "Previous option",
        nextLabel: "Next option",
        wrap: true
      },
      options,
      evidence: {
        source: "direct-source-config-associations",
        confidence: Math.min(...sorted.map((option) => Number(option.assetRecord ? 0.9 : 0.75))),
        evidenceRefs: Array.from(group.evidenceRefs).slice(0, 12)
      }
    }];
  });
}

function variantGroupOptionSignature(group) {
  return (Array.isArray(group?.options) ? group.options : [])
    .map((option) => storyTextKey(option?.label || ""))
    .filter(Boolean)
    .sort()
    .join("|");
}

function variantGroupCandidatesCompatible(left, right) {
  const leftSignature = variantGroupOptionSignature(left);
  const rightSignature = variantGroupOptionSignature(right);
  if (!leftSignature || !rightSignature) return false;
  const leftKind = String(left?.control?.kind || "");
  const rightKind = String(right?.control?.kind || "");
  const controlKindsCompatible = !leftKind || !rightKind || leftKind === rightKind;
  const leftOrder = Number(left?.domOrder);
  const rightOrder = Number(right?.domOrder);
  const positionCompatible = Number.isFinite(leftOrder)
    && Number.isFinite(rightOrder)
    && Math.abs(leftOrder - rightOrder) <= 2500;
  const evidenceSources = [left?.evidence?.source, right?.evidence?.source]
    .map((source) => String(source || "").toLowerCase());
  const complementaryDomAccessibilityEvidence = evidenceSources.some((source) => source.includes("source-dom"))
    && evidenceSources.some((source) => source.includes("accessibility-selection-announcements"));
  const complementaryPositionCompatible = complementaryDomAccessibilityEvidence
    && Number.isFinite(leftOrder)
    && Number.isFinite(rightOrder)
    && Math.abs(leftOrder - rightOrder) <= 6000;
  const leftTitleTokens = new Set(variantLabelIdentityTokens(left?.title || ""));
  const rightTitleTokens = new Set(variantLabelIdentityTokens(right?.title || ""));
  const titleSharedCount = Array.from(leftTitleTokens).filter((token) => rightTitleTokens.has(token)).length;
  const titleCompatible = titleSharedCount >= Math.max(1, Math.ceil(Math.min(leftTitleTokens.size, rightTitleTokens.size) * 0.5));
  const identityCompatible = Boolean(
    variantSafeId(left?.id, "")
    && variantSafeId(left?.id, "") === variantSafeId(right?.id, "")
  );
  if (leftSignature === rightSignature) {
    // One source widget can be described as a concrete button cluster by the
    // collector and as a generic single-select by accessibility announcements.
    // Merge that complementary evidence only when it has the same explicit
    // identity, or when matching titles and nearby source positions confirm
    // that both observations refer to the same control.
    if (!controlKindsCompatible) {
      return identityCompatible
        || ((positionCompatible || complementaryPositionCompatible) && titleCompatible);
    }
    return identityCompatible || positionCompatible || titleCompatible;
  }
  if (!controlKindsCompatible) return false;
  const leftLabels = new Set(leftSignature.split("|").filter(Boolean));
  const rightLabels = new Set(rightSignature.split("|").filter(Boolean));
  const sharedCount = Array.from(leftLabels).filter((label) => rightLabels.has(label)).length;
  if (sharedCount < 2) return false;
  const smallerCoverage = sharedCount / Math.max(1, Math.min(leftLabels.size, rightLabels.size));
  const largerCoverage = sharedCount / Math.max(1, Math.max(leftLabels.size, rightLabels.size));
  if (smallerCoverage < 0.75 || largerCoverage < 0.6) return false;
  return identityCompatible || positionCompatible || titleCompatible;
}

function mergeVariantGroupCandidates(groups) {
  const merged = [];
  for (const group of groups) {
    const signature = variantGroupOptionSignature(group);
    if (!signature) continue;
    const existingIndex = merged.findIndex((candidate) => variantGroupCandidatesCompatible(candidate, group));
    if (existingIndex < 0) {
      merged.push(group);
      continue;
    }
    const existing = merged[existingIndex];
    const options = (existing.options || []).map((option) => {
      if ((option.asset_ids || []).length) return option;
      const fallback = (group.options || []).find((candidate) => (
        storyTextKey(candidate.label || "") === storyTextKey(option.label || "")
      ));
      if (!fallback || !(fallback.asset_ids || []).length) return option;
      return {
        ...option,
        asset_ids: [...fallback.asset_ids],
        asset_files: [...(fallback.asset_files || [])],
        asset_urls: [...(fallback.asset_urls || [])],
        evidence: {
          ...(fallback.evidence && typeof fallback.evidence === "object" ? fallback.evidence : {}),
          ...(option.evidence && typeof option.evidence === "object" ? option.evidence : {}),
          fallbackAssetSource: fallback.evidence?.source || group.evidence?.source || "variant-candidate",
          fallbackForSource: existing.evidence?.source || "collected-variant-group"
        }
      };
    });
    merged[existingIndex] = {
      ...existing,
      options,
      evidence: {
        ...(existing.evidence || {}),
        fallbackSources: Array.from(new Set([
          ...(existing.evidence?.fallbackSources || []),
          group.evidence?.source
        ].filter(Boolean)))
      }
    };
  }
  return merged.sort((left, right) => Number(left?.domOrder || 0) - Number(right?.domOrder || 0));
}

function variantLabelIdentityTokens(value) {
  const ignored = new Set(["a", "an", "and", "for", "in", "of", "or", "the", "to", "model", "option", "card", "view"]);
  return storyTextKey(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3 && !ignored.has(token));
}

function textMentionsVariantLabel(text, label) {
  const key = storyTextKey(text);
  const tokens = variantLabelIdentityTokens(label);
  if (!key || !tokens.length) return false;
  const matched = tokens.filter((token) => new RegExp(`\\b${token}(?:s)?\\b`, "i").test(key)).length;
  if (matched === tokens.length) return true;
  return tokens.length >= 3 && matched >= 2 && matched / tokens.length >= 0.6;
}

function variantAssetsFromOptions(options) {
  return {
    asset_ids: Array.from(new Set(options.flatMap((option) => option.asset_ids || []).filter(Boolean))),
    asset_files: Array.from(new Set(options.flatMap((option) => option.asset_files || []).filter(Boolean))),
    asset_urls: Array.from(new Set(options.flatMap((option) => option.asset_urls || []).filter(Boolean)))
  };
}

function optionWithNestedVisualAssets(option, childGroup, childOptions, evidence) {
  if (!childOptions.length) return option;
  const childAssets = variantAssetsFromOptions(childOptions);
  const visualChild = {
    schemaVersion: "storyvr-source-visual-child/v1",
    id: childGroup.id,
    title: childGroup.title,
    control: childGroup.control,
    options: childOptions.map((childOption) => ({
      id: childOption.id,
      label: childOption.label,
      asset_ids: [...(childOption.asset_ids || [])],
      asset_files: [...(childOption.asset_files || [])],
      asset_urls: [...(childOption.asset_urls || [])]
    })),
    evidence
  };
  return {
    ...option,
    asset_ids: Array.from(new Set([...(option.asset_ids || []), ...childAssets.asset_ids])),
    asset_files: Array.from(new Set([...(option.asset_files || []), ...childAssets.asset_files])),
    asset_urls: Array.from(new Set([...(option.asset_urls || []), ...childAssets.asset_urls])),
    visual_children: [
      ...(Array.isArray(option.visual_children) ? option.visual_children : []),
      visualChild
    ],
    evidence: {
      ...(option.evidence && typeof option.evidence === "object" ? option.evidence : {}),
      visualAssetSource: evidence.source,
      visualChildGroupId: childGroup.id
    }
  };
}

function foldNestedVisualVariantGroups(groups, probe) {
  const working = groups.map((group) => ({
    ...group,
    options: (group.options || []).map((option) => ({ ...option }))
  }));
  const foldedChildIds = new Set();
  const dependencyEvidenceAllowed = collectedVariantRecoveryReliable(probe);
  const associations = dependencyEvidenceAllowed ? collectedVariantAssetAssociations(probe) : [];
  const hierarchyRecords = dependencyEvidenceAllowed ? collectedVariantHierarchy(probe) : [];

  for (const childGroup of working) {
    const childId = variantSafeId(childGroup.id, "");
    const explicitContexts = [
      ...hierarchyRecords.filter((record) => (
        variantSafeId(record?.childGroupId || record?.child_group_id, "") === childId
        && variantSafeId(record?.parentGroupId || record?.parent_group_id, "")
        && variantSafeId(record?.parentOptionId || record?.parent_option_id, "")
        && collectedVariantDependencyConfirmed(record)
      )).map((record) => ({
        parentGroupId: record.parentGroupId || record.parent_group_id,
        parentOptionId: record.parentOptionId || record.parent_option_id,
        childOptionIds: record.childOptionIds || record.child_option_ids || [],
        childOptionLabels: record.childOptionLabels || record.child_option_labels || [],
        source: record.source || "collector-observed-interaction-dependency"
      })),
      ...associations.filter((association) => (
        variantSafeId(association?.groupId || association?.group_id, "") === childId
        && variantSafeId(association?.parentGroupId || association?.parent_group_id, "")
        && variantSafeId(association?.parentOptionId || association?.parent_option_id, "")
        && collectedVariantDependencyConfirmed(association)
      )).map((association) => ({
        parentGroupId: association.parentGroupId || association.parent_group_id,
        parentOptionId: association.parentOptionId || association.parent_option_id,
        childOptionIds: [association.optionId || association.option_id].filter(Boolean),
        childOptionLabels: [association.optionLabel || association.option_label].filter(Boolean),
        source: association.source || "collector-verified-nested-interaction"
      }))
    ];

    if (explicitContexts.length) {
      const contextKeys = Array.from(new Set(explicitContexts.map((context) => [
        variantSafeId(context.parentGroupId, ""),
        variantSafeId(context.parentOptionId, "")
      ].join("::"))));
      for (const contextKey of contextKeys) {
        const [parentId, parentOptionId] = contextKey.split("::");
        if (!parentId || !parentOptionId) continue;
        const contextRecords = explicitContexts.filter((context) => (
          variantSafeId(context.parentGroupId, "") === parentId
          && variantSafeId(context.parentOptionId, "") === parentOptionId
        ));
        const parent = working.find((group) => variantSafeId(group.id, "") === parentId);
        if (!parent || parent === childGroup) continue;
        const optionIndex = parent.options.findIndex((option) => variantSafeId(option.id, "") === parentOptionId);
        if (optionIndex < 0) continue;
        const contextOptionIds = new Set(contextRecords.flatMap((context) => context.childOptionIds || [])
          .map((value) => variantSafeId(value, ""))
          .filter(Boolean));
        const contextLabels = new Set(contextRecords.flatMap((context) => context.childOptionLabels || [])
          .map((value) => storyTextKey(value))
          .filter(Boolean));
        const childOptions = childGroup.options.filter((option) => (
          contextOptionIds.has(variantSafeId(option.id, "")) || contextLabels.has(storyTextKey(option.label))
        )).map((option) => {
          const contextualAssets = (option.evidence?.associationContexts || []).find((candidate) => (
            variantSafeId(candidate.parentGroupId, "") === parentId
            && variantSafeId(candidate.parentOptionId, "") === parentOptionId
          ));
          const contextualAssetCount = contextualAssets
            ? [
              ...(contextualAssets.asset_ids || []),
              ...(contextualAssets.asset_files || []),
              ...(contextualAssets.asset_urls || [])
            ].filter(Boolean).length
            : 0;
          if (!contextualAssets || !contextualAssetCount) return option;
          return {
            ...option,
            asset_ids: [...(contextualAssets.asset_ids || [])],
            asset_files: [...(contextualAssets.asset_files || [])],
            asset_urls: [...(contextualAssets.asset_urls || [])],
            evidence: {
              ...(option.evidence || {}),
              contextualAssetSource: contextualAssets.source
            }
          };
        });
        parent.options[optionIndex] = optionWithNestedVisualAssets(
          parent.options[optionIndex],
          childGroup,
          childOptions.length ? childOptions : childGroup.options,
          {
            source: contextRecords.some((context) => context.source === "collector-observed-interaction-dependency")
              ? "collector-observed-interaction-dependency"
              : "collector-verified-nested-interaction",
            parentGroupId: parent.id,
            parentOptionId: parent.options[optionIndex].id,
            evidenceRecordCount: contextRecords.length
          }
        );
        foldedChildIds.add(childGroup.id);
      }
      continue;
    }

    const collectorMarkedNested = ["nested", "visual-child", "unresolved-nested-control"]
      .includes(String(childGroup?.hierarchy?.role || ""));
    if (childGroup.evidence?.source !== "aggregate-accessible-card-cluster" && !collectorMarkedNested) continue;
    const childOrder = Number(childGroup.domOrder);
    const parentCandidates = working
      .filter((candidate) => candidate !== childGroup && Number(candidate.domOrder) < childOrder)
      .map((candidate) => ({
        candidate,
        titleOption: candidate.options.find((option) => textMentionsVariantLabel(childGroup.title, option.label))
      }))
      .filter((item) => item.titleOption)
      .sort((left, right) => Number(right.candidate.domOrder) - Number(left.candidate.domOrder));
    if (!collectorMarkedNested && !parentCandidates.length) continue;
    childGroup.hierarchy = {
      ...(childGroup.hierarchy && typeof childGroup.hierarchy === "object" ? childGroup.hierarchy : {}),
      role: "unresolved-nested-control",
      reason: "A dependent-looking control lacks a collector-observed parent interaction path.",
      candidateParentGroupIds: parentCandidates.map((item) => item.candidate.id)
    };
  }

  return working.filter((group) => !foldedChildIds.has(group.id));
}

function variantHierarchyForAuthorInput(probe, judgment, assetManifest) {
  const collected = normalizeCollectedVariantGroups(probe, assetManifest);
  const textDerived = textDerivedVariantGroupsFromProbe(probe);
  const directAssociations = inferredVariantGroupsFromJudgment(probe, judgment, assetManifest);
  const accessibleCards = inferredAccessibleCardVariantGroups(probe, judgment, assetManifest);
  const classified = foldNestedVisualVariantGroups(mergeVariantGroupCandidates([
    ...collected,
    ...textDerived,
    ...directAssociations,
    ...accessibleCards
  ]), probe);
  const unresolvedVariantGroups = classified.filter((group) => (
    group?.hierarchy?.role === "unresolved-nested-control"
  ));
  const unresolvedIds = new Set(unresolvedVariantGroups.map((group) => group.id));
  const variantGroups = classified
    .filter((group) => !unresolvedIds.has(group.id) && !["nested", "visual-child"].includes(group?.hierarchy?.role))
    .map((group) => ({
      ...group,
      hierarchy: {
        ...(group.hierarchy && typeof group.hierarchy === "object" ? group.hierarchy : {}),
        role: "top-level"
      }
    }));
  return { variantGroups, unresolvedVariantGroups };
}

function verifiedExistingVariantGroups(probe, existingStoryStructure, assetManifest) {
  const existingStoryUrl = normalizeUrl(existingStoryStructure?.story_url || "");
  const currentStoryUrl = normalizeUrl(probe?.story_url || "");
  if (!existingStoryUrl || !currentStoryUrl || existingStoryUrl !== currentStoryUrl) return [];
  const groups = normalizeCollectedVariantGroups({
    story_url: currentStoryUrl,
    variant_groups: existingStoryStructure?.variant_groups || []
  }, assetManifest);
  if (!groups.length) return [];
  const textKeys = activeTextUnitsFromProbe(probe).map((unit) => storyTextKey(unit.text)).filter(Boolean);
  return groups.flatMap((group) => {
    const labels = group.options.map((option) => storyTextKey(option.label)).filter(Boolean);
    const title = storyTextKey(group.title);
    const hasCurrentAssetEvidence = group.options.every((option) => option.asset_ids.length > 0);
    const hasCurrentTextEvidence = textKeys.some((text) => (
      (!title || text.includes(title))
        && labels.filter((label) => text.includes(label)).length >= Math.min(2, labels.length)
    ));
    if (!hasCurrentAssetEvidence || !hasCurrentTextEvidence) return [];
    return [{
      ...group,
      evidence: {
        ...(group.evidence || {}),
        source: "preserved-verified-author-input",
        reason: "The current capture still contains the same story, option text, and option assets."
      }
    }];
  });
}

const VARIANT_TEXT_LOCAL_DOM_ORDER_DISTANCE = 10_000;

function selectorClassTokens(value) {
  return Array.from(String(value || "").matchAll(/\.([a-z0-9_-]+)/gi), (match) => match[1].toLowerCase());
}

function selectorIdToken(value) {
  return String(value || "").match(/#([a-z0-9_-]+)/i)?.[1]?.toLowerCase() || "";
}

function selectorTagToken(value) {
  return String(value || "").trim().match(/^([a-z0-9_-]+)/i)?.[1]?.toLowerCase() || "";
}

function selectorForLegacyTextUnit(unit) {
  const tag = String(unit?.tag || "").toLowerCase();
  const id = String(unit?.elementId || "").trim();
  if (id) return `${tag || "*"}#${id}`;
  const classes = String(unit?.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 4);
  return classes.length ? `${tag || "*"}.${classes.join(".")}` : tag;
}

function textUnitSharesVariantContainer(unit, group) {
  const rootSelector = cleanStoryText(group?.evidence?.rootSelector || "");
  if (!rootSelector) return false;
  const selectors = new Set([
    unit?.selector,
    ...(Array.isArray(unit?.ancestorSelectors) ? unit.ancestorSelectors : []),
    selectorForLegacyTextUnit(unit)
  ].map((value) => String(value || "").trim()).filter(Boolean));
  if (selectors.has(rootSelector)) return true;

  const rootId = selectorIdToken(rootSelector);
  const rootTag = selectorTagToken(rootSelector);
  const rootClasses = selectorClassTokens(rootSelector);
  if (!rootId && rootClasses.length < 2) return false;
  return Array.from(selectors).some((selector) => {
    if (rootTag && selectorTagToken(selector) && selectorTagToken(selector) !== rootTag) return false;
    if (rootId && selectorIdToken(selector) !== rootId) return false;
    const classes = new Set(selectorClassTokens(selector));
    return rootClasses.every((className) => classes.has(className));
  });
}

function variantTextUnitDistance(unit, group) {
  const unitOrder = Number(unit?.domOrder);
  if (!Number.isFinite(unitOrder)) return Number.POSITIVE_INFINITY;
  const orders = [group?.domOrder, ...(group?.options || []).map((option) => option?.domOrder)]
    .map(Number)
    .filter(Number.isFinite);
  if (!orders.length) return Number.POSITIVE_INFINITY;
  const start = Math.min(...orders);
  const end = Math.max(...orders);
  if (unitOrder >= start && unitOrder <= end) return 0;
  return unitOrder < start ? start - unitOrder : unitOrder - end;
}

function orderedVariantLabelRun(value, group) {
  const text = cleanStoryText(value);
  const source = text.toLowerCase();
  const labels = (group?.options || []).map((option) => storyTextKey(option?.label)).filter(Boolean);
  if (labels.length < 2) return null;
  const first = labels[0];
  for (let start = source.indexOf(first); start >= 0; start = source.indexOf(first, start + first.length)) {
    let cursor = start + first.length;
    let valid = true;
    for (const label of labels.slice(1)) {
      const next = source.indexOf(label, cursor);
      if (next < 0) {
        valid = false;
        break;
      }
      const gap = source.slice(cursor, next);
      if (gap.length > 48 || /[\p{L}\p{N}]/u.test(gap)) {
        valid = false;
        break;
      }
      cursor = next + label.length;
    }
    if (valid) return { start, end: cursor };
  }
  return null;
}

function variantAggregateTextMatch(unit, group) {
  const key = storyTextKey(unit?.text);
  const labels = (group?.options || []).map((option) => storyTextKey(option?.label)).filter(Boolean);
  if (!key || labels.length < 2) return { group, isAggregate: false, score: 0 };
  const matchCount = labels.filter((label) => key.includes(label)).length;
  if (matchCount < 2) return { group, isAggregate: false, score: 0 };

  const explicitTextUnitId = cleanStoryText(group?.evidence?.textUnitId || "");
  const explicitMatch = Boolean(explicitTextUnitId && [unit?.id, unit?.observed?.source].includes(explicitTextUnitId));
  const containerMatch = textUnitSharesVariantContainer(unit, group);
  const distance = variantTextUnitDistance(unit, group);
  const positionMatch = distance <= VARIANT_TEXT_LOCAL_DOM_ORDER_DISTANCE;
  const strongCoverage = matchCount >= Math.max(2, Math.ceil(labels.length * 0.75));
  const controlRun = orderedVariantLabelRun(unit.text, group);
  const isAggregate = (explicitMatch || containerMatch || positionMatch)
    && (explicitMatch || Boolean(controlRun) || strongCoverage);
  const score = Number(explicitMatch) * 1_000
    + Number(containerMatch) * 500
    + Number(positionMatch) * 200
    + Number(Boolean(controlRun)) * 100
    + Math.round((matchCount / labels.length) * 50)
    - Math.min(50, Math.round(distance / 1000));
  return { group, isAggregate, score, matchCount, distance, controlRun };
}

function unresolvedVariantControlTextMatch(unit, group) {
  if (group?.hierarchy?.role !== "unresolved-nested-control") {
    return { group, isAggregate: false, score: 0 };
  }
  const distance = variantTextUnitDistance(unit, group);
  if (distance > VARIANT_TEXT_LOCAL_DOM_ORDER_DISTANCE) return { group, isAggregate: false, score: 0 };
  const text = cleanStoryText(unit?.text || "");
  const key = storyTextKey(text);
  if (!key) return { group, isAggregate: false, score: 0 };
  const matchingOption = (group.options || []).find((option) => {
    const optionKey = storyTextKey(option?.text || "");
    return optionKey.length >= 40 && key.includes(optionKey);
  });
  if (!matchingOption) return { group, isAggregate: false, score: 0 };
  const optionText = cleanStoryText(matchingOption.text || "");
  const optionNeedle = optionText.slice(0, Math.min(optionText.length, 120)).toLowerCase();
  const optionStart = optionNeedle ? text.toLowerCase().indexOf(optionNeedle) : -1;
  const directionStart = text.search(/[←→‹›«»]/u);
  const starts = [optionStart, directionStart].filter((value) => value >= 0);
  return {
    group,
    isAggregate: true,
    score: 850 - Math.min(50, Math.round(distance / 20)),
    distance,
    matchingOption,
    controlStart: starts.length ? Math.min(...starts) : 0,
    source: "same-location-option-state-text"
  };
}

function variantNarrativeTextBeforeControls(value, group) {
  const text = cleanStoryText(value);
  const run = orderedVariantLabelRun(text, group);
  if (!run) return "";
  let prefix = cleanStoryText(text.slice(0, run.start));
  const title = cleanStoryText(group?.title || "");
  if (title && prefix.toLowerCase().startsWith(title.toLowerCase())) {
    prefix = cleanStoryText(prefix.slice(title.length));
  }
  return storyTextKey(prefix) === storyTextKey(title) ? "" : prefix;
}

function textOnlyEntriesFromProbe(probe, visualEntries, variantGroups = []) {
  const visualKeys = new Set(visualEntries.map((entry) => storyTextKey(entry.text)));
  const seenTextKeys = new Set();
  return activeTextUnitsFromProbe(probe)
    .filter((unit) => !visualKeys.has(storyTextKey(unit.text)))
    .flatMap((unit) => {
      const matches = variantGroups
        .map((group) => {
          const aggregate = variantAggregateTextMatch(unit, group);
          return aggregate.isAggregate ? aggregate : unresolvedVariantControlTextMatch(unit, group);
        })
        .filter((match) => match.isAggregate)
        .sort((left, right) => right.score - left.score);
      if (!matches.length) return [unit];
      const narrativeText = variantNarrativeTextBeforeControls(unit.text, matches[0].group)
        || (Number.isFinite(matches[0].controlStart)
          ? cleanStoryText(cleanStoryText(unit.text).slice(0, matches[0].controlStart))
          : "");
      if (!narrativeText) return [];
      return [{
        ...unit,
        text: narrativeText,
        title: titleFromStoryText(narrativeText, unit.title),
        observed: {
          ...(unit.observed || {}),
          variantGroupId: matches[0].group.id || "",
          variantTextRole: "narrative-prefix"
        }
      }];
    })
    .filter((unit) => {
      const key = storyTextKey(unit.text);
      if (!key || seenTextKeys.has(key)) return false;
      seenTextKeys.add(key);
      return true;
    })
    .map((unit, index) => ({
      ...unit,
      index,
      subtype: "runtime-active-text"
    }));
}

function visualEntriesWithoutAggregateVariants(entries, variantGroups) {
  if (!variantGroups.length) return entries;
  return entries.filter((entry) => {
    const key = storyTextKey(entry?.text || "");
    if (!key) return true;
    return !variantGroups.some((group) => {
      const entryOrder = Number(entry?.domOrder);
      const groupOrder = Number(group?.domOrder);
      const nearGroup = Number.isFinite(entryOrder) && Number.isFinite(groupOrder) && Math.abs(entryOrder - groupOrder) <= 15_000;
      const sameControlLocation = Number.isFinite(entryOrder)
        && Number.isFinite(groupOrder)
        && Math.abs(entryOrder - groupOrder) <= 1_000;
      const entryAssetKeys = new Set([
        ...(Array.isArray(entry?.attributes?.probeAssetFiles) ? entry.attributes.probeAssetFiles : []),
        ...(Array.isArray(entry?.attributes?.probeAssetUrls) ? entry.attributes.probeAssetUrls : [])
      ].map((value) => normalizeAssetKey(path.basename(String(value || "")))).filter(Boolean));
      const groupAssetKeys = new Set((group.options || []).flatMap((option) => [
        ...(option.asset_ids || []),
        ...(option.asset_files || []),
        ...(option.asset_urls || [])
      ]).map((value) => normalizeAssetKey(path.basename(String(value || "")))).filter(Boolean));
      if (sameControlLocation && [...entryAssetKeys].some((assetKey) => groupAssetKeys.has(assetKey))) return true;
      if (nearGroup && key === storyTextKey(group?.title || "")) return true;
      const labels = (group.options || []).map((option) => storyTextKey(option.label)).filter(Boolean);
      if (labels.length < 2) return false;
      const matchCount = labels.filter((label) => key.includes(label)).length;
      const threshold = Math.max(2, Math.ceil(labels.length * 0.75));
      if (matchCount < threshold) return false;
      return nearGroup || matchCount === labels.length;
    });
  });
}

function buildStoryStructureForAuthorInput(probe, evidence, judgment, assetManifest) {
  const { variantGroups, unresolvedVariantGroups } = variantHierarchyForAuthorInput(probe, judgment, assetManifest);
  const nonSequentialVariantGroups = [...variantGroups, ...unresolvedVariantGroups];
  const slides = visualEntriesWithoutAggregateVariants(
    visualBeatEntriesFromJudgment(judgment, assetManifest, probe),
    nonSequentialVariantGroups
  );
  const textOnlyParts = textOnlyEntriesFromProbe(probe, slides, nonSequentialVariantGroups);
  const title = evidence.story?.title || probe.title || evidence.story?.slug || probe.slug || "NYT story";
  const headings = authorInputHeadingsFromProbe(probe, title);
  const imageGroups = authorInputImageGroupsFromProbe(probe);
  return {
    story_url: evidence.story?.url || probe.story_url || "",
    timestamp: evidence.generatedAt || new Date().toISOString(),
    title,
    headings,
    scroll_steps: [],
    slides,
    captions: [],
    image_groups: imageGroups,
    variant_groups: variantGroups,
    unresolved_variant_groups: unresolvedVariantGroups,
    text_only_parts: textOnlyParts,
    downloaded_text_matches: [],
    json_candidates: [],
    animation_probe: {
      schemaVersion: "storyvr-animation-probe-author-input/v1",
      evidencePath: evidence.sourceProbe?.inputPath || "",
      analyzedModelCount: evidence.glbAnimations?.modelCount || 0,
      animatedModelCount: evidence.glbAnimations?.animatedModelCount || 0,
      visualBeatCount: slides.length,
      textOnlyPartCount: textOnlyParts.length,
      variantGroupCount: variantGroups.length,
      unresolvedVariantGroupCount: unresolvedVariantGroups.length,
      variantAssetAssociationCount: collectedVariantAssetAssociations(probe).length
    },
    notes: [
      "Generated from animation logic probe output so StoryVR author can load this probe as a fetched-resource story.",
      "Visual beats are derived from modelBeatAssociations and imageBeatAssociations; unassociated runtime active text is retained as text_only_parts.",
      "Evidence-derived variant_groups preserve mutually exclusive states within one story beat instead of flattening them into narrative successors.",
      "Collector-observed parent interaction paths are authoritative for nesting child controls under a top-level option.",
      "Dependent-looking controls without direct parent interaction evidence are retained in unresolved_variant_groups and are not promoted to top-level beats."
    ]
  };
}

async function writeAuthorInput(probe, inputPath, outputRoot, evidence, judgment, options) {
  const resourceFolder = authorInputRootForProbe(probe, options);
  const metadataRoot = path.join(resourceFolder, "metadata");
  const storyStructurePath = path.join(metadataRoot, "story_structure_candidates.json");
  const existingStoryStructure = await readJsonIfExists(storyStructurePath);
  await fs.mkdir(metadataRoot, { recursive: true });
  for (const dir of ["models", "scripts", "data", "textures", "other"]) {
    await fs.mkdir(path.join(resourceFolder, dir), { recursive: true });
  }

  const { assetManifest, copyFailures } = await copyProbeDownloadsToAuthorInput(resourceFolder, evidence, probe);
  const storyStructure = buildStoryStructureForAuthorInput(probe, evidence, judgment, assetManifest);
  if (!storyStructure.variant_groups.length && !storyStructure.unresolved_variant_groups.length) {
    const preservedVariantGroups = verifiedExistingVariantGroups(probe, existingStoryStructure, assetManifest);
    if (preservedVariantGroups.length) {
      storyStructure.variant_groups = preservedVariantGroups;
      storyStructure.text_only_parts = textOnlyEntriesFromProbe(probe, storyStructure.slides, preservedVariantGroups);
      storyStructure.animation_probe.textOnlyPartCount = storyStructure.text_only_parts.length;
      storyStructure.animation_probe.variantGroupCount = preservedVariantGroups.length;
      storyStructure.notes.push(
        "Existing variant groups were retained only after the current capture re-verified their story URL, option text, and option assets."
      );
    }
  }
  const sourceDiscovery = {
    story_url: evidence.story?.url || probe.story_url || "",
    slug: evidence.story?.slug || safeSegment(probe.slug || storySlugFromUrl(probe.story_url), "nyt-story").toLowerCase(),
    title: evidence.story?.title || probe.title || "",
    timestamp: evidence.generatedAt || new Date().toISOString(),
    generated_by: "animation-logic-probe-analyzer",
    source_probe: {
      inputPath: toPosix(path.relative(REPO_ROOT, path.resolve(inputPath))),
      collectorTool: probe.tool || "",
      collectorVersion: probe.version || "",
      collectorHash: probe.collector_hash || ""
    }
  };
  const manifest = {
    schemaVersion: "storyvr-animation-probe-author-input/v1",
    generatedAt: new Date().toISOString(),
    resourceFolder: toPosix(path.relative(REPO_ROOT, resourceFolder)),
    analysisOutputRoot: toPosix(path.relative(REPO_ROOT, outputRoot)),
    storyStructurePath: "metadata/story_structure_candidates.json",
    assetManifestPath: "metadata/asset_manifest.json",
    copiedAssetCount: assetManifest.length,
    copyFailures,
    visualBeatCount: storyStructure.slides.length,
    textOnlyPartCount: storyStructure.text_only_parts.length,
    variantGroupCount: storyStructure.variant_groups.length,
    unresolvedVariantGroupCount: storyStructure.unresolved_variant_groups.length
  };

  const assetManifestPath = path.join(metadataRoot, "asset_manifest.json");
  const sourceDiscoveryPath = path.join(metadataRoot, "source_discovery.json");
  const probeManifestPath = path.join(metadataRoot, "animation_probe_manifest.json");
  await writeJson(storyStructurePath, storyStructure);
  await writeJson(assetManifestPath, assetManifest);
  await writeJson(sourceDiscoveryPath, sourceDiscovery);
  await writeJson(probeManifestPath, manifest);
  return {
    resourceFolder,
    storyStructurePath,
    assetManifestPath,
    sourceDiscoveryPath,
    probeManifestPath,
    copiedAssetCount: assetManifest.length,
    copyFailures: copyFailures.length
  };
}

async function writeOutputs(outputRoot, evidence, judgment) {
  const normalizedJudgment = canonicalObjectKeys(normalizeJudgmentForEvidence(judgment, evidence));
  await writeJson(path.join(outputRoot, "animation-evidence.json"), evidence);
  await writeJson(path.join(outputRoot, "codex-animation-judgment.json"), normalizedJudgment);
  await fs.writeFile(path.join(outputRoot, "animation-logic-summary.md"), summaryMarkdownFromJudgment(normalizedJudgment, evidence), "utf8");
  return normalizedJudgment;
}

async function main(options) {
  const inputPath = path.resolve(options.input);
  const probe = await readJson(inputPath);
  const outputRoot = options.fromOutput ? path.resolve(options.fromOutput) : outputRootForProbe(probe, options);
  await fs.mkdir(outputRoot, { recursive: true });
  console.log(`Output folder: ${outputRoot}`);

  if (options.fromOutput) {
    const evidence = await readJson(path.join(outputRoot, "animation-evidence.json"));
    const judgment = await writeOutputs(outputRoot, evidence, normalizeJudgmentForEvidence(
      await readJson(path.join(outputRoot, "codex-animation-judgment.json")),
      evidence
    ));
    if (await shouldWriteAuthorInput(probe, { ...options, writeAuthorInput: true })) {
      const authorInput = await writeAuthorInput(probe, inputPath, outputRoot, evidence, judgment, {
        ...options,
        writeAuthorInput: true
      });
      console.log(`StoryVR author input: ${authorInput.resourceFolder}`);
      console.log(`Author metadata: ${authorInput.storyStructurePath}`);
      return { outputRoot, evidence, judgment, authorInput };
    }
    console.log("StoryVR author input was not written.");
    return { outputRoot, evidence, judgment, authorInput: null };
  }

  const evidence = await buildEvidenceBundle(probe, inputPath, outputRoot, options);
  const evidenceFingerprint = judgmentEvidenceFingerprint(evidence);
  evidence.judgmentInput = {
    judgmentSchemaVersion: JUDGMENT_SCHEMA_VERSION,
    promptVersion: CODEX_PROMPT_VERSION,
    cacheSchemaVersion: JUDGMENT_CACHE_SCHEMA_VERSION,
    evidenceFingerprint,
    fingerprintBasis: "semantic source resources plus beat/model/part/action/driver state and scroll-target perceptual hashes; volatile capture timing, raw image bytes, and local paths excluded"
  };
  await writeJson(path.join(outputRoot, "animation-evidence.json"), evidence);
  console.log(`Evidence: ${path.join(outputRoot, "animation-evidence.json")}`);
  console.log(`Animated GLBs: ${evidence.glbAnimations.animatedModelCount}/${evidence.glbAnimations.modelCount}`);

  let judgment;
  if (options.noCodex) {
    judgment = localHeuristicJudgment(evidence, "Codex judging was skipped with --no-codex.");
  } else {
    try {
      if (options.codexTimeoutMs !== null) {
        console.warn("--codex-timeout-ms is ignored; Codex judging now runs without a script-imposed timeout.");
      }
      const promptBundle = createCodexPromptBundle(evidence);
      console.log(
        `Codex prompt preflight: ${promptBundle.diagnostics.actualChars}/${promptBundle.diagnostics.targetChars} characters `
          + `(${promptBundle.diagnostics.profile} profile; hard limit ${promptBundle.diagnostics.hardLimitChars}).`
      );
      const cachePath = codexJudgmentCachePath(probe, options, evidenceFingerprint);
      let codexPayload = null;
      if (options.codexCache && !options.refreshCodex) {
        codexPayload = await readCachedCodexJudgment(cachePath, evidenceFingerprint);
        if (codexPayload) console.log(`Codex judgment cache hit: ${evidenceFingerprint}`);
      }
      if (!codexPayload) {
        console.log(`Codex judging: ${options.refreshCodex ? "refreshing semantic cache" : "cache miss"}; no script-imposed timeout.`);
        const result = await runCodexJudge(evidence, options, promptBundle);
        codexPayload = result.judgment;
        if (options.codexCache) {
          try {
            codexPayload = await writeCachedCodexJudgment(cachePath, evidenceFingerprint, codexPayload, {
              replace: options.refreshCodex
            });
            console.log(`Codex judgment cache stored: ${evidenceFingerprint}`);
          } catch (cacheError) {
            console.warn(`Codex judgment cache unavailable; continuing with the fresh judgment: ${cacheError.message}`);
          }
        }
      }
      judgment = {
        ...codexPayload,
        engine: codexEngineForEvidence(evidence, promptBundle.diagnostics)
      };
    } catch (error) {
      judgment = localHeuristicJudgment(evidence, `Codex judging failed: ${error.message}`);
      const normalizedJudgment = await writeOutputs(outputRoot, evidence, judgment);
      if (await shouldWriteAuthorInput(probe, options)) {
        await writeAuthorInput(probe, inputPath, outputRoot, evidence, normalizedJudgment, options);
      }
      throw error;
    }
  }

  const normalizedJudgment = await writeOutputs(outputRoot, evidence, judgment);
  console.log(`Judgment: ${path.join(outputRoot, "codex-animation-judgment.json")}`);
  console.log(`Summary: ${path.join(outputRoot, "animation-logic-summary.md")}`);
  let authorInput = null;
  if (await shouldWriteAuthorInput(probe, options)) {
    authorInput = await writeAuthorInput(probe, inputPath, outputRoot, evidence, normalizedJudgment, options);
    console.log(`StoryVR author input: ${authorInput.resourceFolder}`);
    console.log(`Author metadata: ${authorInput.storyStructurePath}`);
  }
  return { outputRoot, evidence, judgment: normalizedJudgment, authorInput };
}

function padJsonBuffer(jsonText) {
  const padding = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  return Buffer.from(`${jsonText}${" ".repeat(padding)}`, "utf8");
}

function createFixtureGlb({ animated = true } = {}) {
  const json = {
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "CameraRig", camera: 0 }],
    cameras: [{ type: "perspective" }],
    accessors: [{ min: [0], max: [2.5] }]
  };
  if (animated) {
    json.animations = [
      {
        name: "Take 001",
        samplers: [{ input: 0, output: 0 }],
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }]
      }
    ];
  }
  const jsonChunk = padJsonBuffer(JSON.stringify(json));
  const totalLength = 12 + 8 + jsonChunk.length;
  const buffer = Buffer.alloc(totalLength);
  buffer.write("glTF", 0, "utf8");
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(totalLength, 8);
  buffer.writeUInt32LE(jsonChunk.length, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(buffer, 20);
  return buffer;
}

async function runSelfTest() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "animation-logic-probe-"));
  const fixturePath = path.join(tempDir, "fixture.glb");
  const staticFixturePath = path.join(tempDir, "static-fixture.glb");
  const imageFixturePath = path.join(tempDir, "mars-image.jpg");
  const marsCoverFixturePath = path.join(tempDir, "Mars_desktopCover_1600.jpg");
  const marsVikingFixturePath = path.join(tempDir, "viking1.jpg");
  const marsIconFixturePath = path.join(tempDir, "ios-ipad-144x144.png");
  const marsOlympicsFixturePath = path.join(tempDir, "05-NYT-AR-oly-ar-promo-container-master315-v4.jpg");
  await fs.writeFile(fixturePath, createFixtureGlb());
  await fs.writeFile(staticFixturePath, createFixtureGlb({ animated: false }));
  await fs.writeFile(imageFixturePath, Buffer.from("fixture image bytes"));
  await fs.writeFile(marsCoverFixturePath, Buffer.from("mars cover bytes"));
  await fs.writeFile(marsVikingFixturePath, Buffer.from("mars viking bytes"));
  await fs.writeFile(marsIconFixturePath, Buffer.from("mars icon bytes"));
  await fs.writeFile(marsOlympicsFixturePath, Buffer.from("mars unrelated promo bytes"));
  const embeddedVisualDataUrl = `data:image/webp;base64,${Buffer.from("fixture visual bytes").toString("base64")}`;
  const visualObservation = await extractScrollTargetVisualObservation({
    scroll_target_screenshots: [{
      id: "scroll-target-0001",
      evidenceRef: "visual-scroll-target-0001",
      status: "ok",
      targetIndex: 0,
      targetY: 0,
      targetKind: "dom-beat",
      snapshotId: "direct-1",
      scrollPercent: 0,
      activeText: { text: "Intro beat", dataSlide: "0" },
      viewport: { width: 800, height: 600, devicePixelRatio: 1 },
      captureMethod: "display-media-tab-viewport",
      width: 800,
      height: 600,
      perceptualHash: "0123456789abcdef",
      dataUrl: embeddedVisualDataUrl,
      canvasCrop: {
        status: "ok",
        captureMethod: "resized-canvas-copy",
        sourceCanvasIndex: 0,
        sourceCanvasVisibleRatio: 1,
        width: 640,
        height: 480,
        perceptualHash: "0011223344556677",
        dataUrl: embeddedVisualDataUrl
      }
    }],
    scroll_target_contact_sheets: [{
      id: "scroll-target-contact-sheet-001",
      status: "ok",
      screenshotIds: ["scroll-target-0001"],
      width: 1200,
      height: 660,
      dataUrl: embeddedVisualDataUrl
    }]
  }, path.join(tempDir, "visual-output"));
  assert.equal(visualObservation.captureCount, 1);
  assert.equal(visualObservation.canvasCropCount, 1);
  assert.equal(visualObservation.contactSheetCount, 1);
  assert.equal(visualObservation.codexAttachments[0].kind, "contact-sheet");
  assert.equal(await exists(path.resolve(REPO_ROOT, visualObservation.screenshots[0].localPath)), true);
  assert.equal(await exists(path.resolve(REPO_ROOT, visualObservation.screenshots[0].canvasCrop.localPath)), true);
  const variantVisualObservation = await extractVariantStateVisualObservation({
    variant_state_screenshots: [{
      id: "variant-state-00001",
      evidenceRef: "visual-variant-state-00001",
      status: "ok",
      groupId: "region-group",
      groupTitle: "Choose a region",
      optionId: "region-north",
      optionLabel: "North",
      explorationPhase: "viewport-control-top",
      viewportAlignment: "top",
      controlSelector: "div.region-buttons",
      snapshotId: "variant-snapshot-1",
      scrollY: 320,
      scrollPercent: 20,
      viewport: { width: 800, height: 600, devicePixelRatio: 1 },
      captureMethod: "display-media-tab-viewport",
      width: 800,
      height: 600,
      perceptualHash: "1122334455667788",
      dataUrl: embeddedVisualDataUrl,
      canvasCrop: {
        status: "ok",
        captureMethod: "resized-canvas-copy",
        width: 640,
        height: 480,
        perceptualHash: "8877665544332211",
        dataUrl: embeddedVisualDataUrl
      }
    }]
  }, path.join(tempDir, "variant-visual-output"));
  assert.equal(variantVisualObservation.captureCount, 1);
  assert.equal(variantVisualObservation.screenshots[0].groupId, "region-group");
  assert.equal(variantVisualObservation.screenshots[0].explorationPhase, "viewport-control-top");
  assert.equal(await exists(path.resolve(REPO_ROOT, variantVisualObservation.screenshots[0].localPath)), true);
  assert.equal(await exists(path.resolve(REPO_ROOT, variantVisualObservation.screenshots[0].canvasCrop.localPath)), true);
  const visualCodexArgs = codexExecArgs({ cwd: REPO_ROOT, imagePaths: ["/tmp/contact-sheet.webp"] });
  assert.equal(visualCodexArgs.includes("--image=/tmp/contact-sheet.webp"), true);
  assert.equal(visualCodexArgs.at(-1), "-");
  const bytes = await fs.readFile(fixturePath);
  const staticBytes = await fs.readFile(staticFixturePath);
  const imageBytes = await fs.readFile(imageFixturePath);
  const json = parseGlbJsonChunk(bytes, fixturePath);
  const staticJson = parseGlbJsonChunk(staticBytes, staticFixturePath);
  const summary = summarizeGltfJson(json, {
    url: "https://example.com/fixture.glb",
    finalUrl: "https://example.com/fixture.glb",
    localPath: fixturePath,
    fileSize: bytes.length,
    contentType: "model/gltf-binary"
  });
  const staticSummary = summarizeGltfJson(staticJson, {
    url: "https://example.com/static-fixture.glb",
    finalUrl: "https://example.com/static-fixture.glb",
    localPath: staticFixturePath,
    fileSize: staticBytes.length,
    contentType: "model/gltf-binary"
  });
  assert.equal(summary.animationCount, 1);
  assert.equal(summary.animations[0].duration, 2.5);
  assert.equal(summary.hasCameraAnimation, true);
  assert.equal(staticSummary.animationCount, 0);
  assert.equal(staticSummary.hasEmbeddedAnimation, false);
  assert.equal(parseGltfJsonFromDownload({ url: "https://example.com/model-endpoint", localPath: path.join(tempDir, "model-endpoint"), bytes }).animations.length, 1);
  const extensionlessCandidates = discoverCandidateRecords({
    story_url: "https://example.com/story",
    snapshots: [{ runtime3D: { models: [{ assetUrl: "https://example.com/model-endpoint" }] } }]
  });
  assert.deepEqual(extensionlessCandidates[0], { url: "https://example.com/model-endpoint", assetType: "model" });
  const relativeModelProbe = {
    story_url: "https://publisher.example.com/interactive/story/index.html",
    scripts: [{
      index: 0,
      src: null,
      text: 'window.STORY_CONFIG = { model: "models/fixture.glb" };',
      keywordWindows: []
    }]
  };
  assert.equal(
    discoverCandidateRecords(relativeModelProbe).some((candidate) => candidate.assetType === "model"),
    false,
    "Relative source-config model paths must not be resolved against the article URL before loader inspection."
  );
  const relativeModelSources = [
    ...probeDiscoveryTextSources(relativeModelProbe),
    {
      text: 'const analyticsUrl = `https:\\/\\/aaa-metrics.example.com/events/${event.id}`;',
      sourceType: "downloaded-script",
      source: "https://aaa-metrics.example.com/client.js",
      sourceUrl: "https://aaa-metrics.example.com/client.js"
    },
    {
      text: 'const modelPath = `https:\\/\\/cdn.example.com/projects/story/assets/${model.src}`;',
      sourceType: "downloaded-script",
      source: "https://cdn.example.com/projects/story/build/loader.js",
      sourceUrl: "https://cdn.example.com/projects/story/build/loader.js"
    }
  ];
  const relativeModelReferences = modelReferencesFromTextSources(relativeModelSources);
  const relativeModelBases = assetBaseCandidatesFromTextSources(relativeModelSources, relativeModelProbe.story_url);
  const relativeModelCandidates = modelResolutionCandidates(
    relativeModelReferences[0],
    relativeModelBases,
    relativeModelProbe.story_url
  );
  assert.equal(relativeModelReferences[0].rawValue, "models/fixture.glb");
  assert.equal(relativeModelBases[0].kind, "template-prefix");
  assert.equal(relativeModelCandidates[0].url, "https://cdn.example.com/projects/story/assets/models/fixture.glb");
  assert.equal(relativeModelCandidates[0].resolutionKind, "template-prefix");
  assert.equal(
    relativeModelCandidates.some((candidate) => candidate.url === "https://publisher.example.com/interactive/story/models/fixture.glb"),
    true,
    "Article-relative resolution remains an auditable last-resort fallback."
  );
  validateDownloadedModelBytes(bytes, "https://example.com/fixture.glb");
  assert.throws(
    () => validateDownloadedModelBytes(Buffer.from("<!doctype html>not a model"), "https://example.com/fixture.glb"),
    /not valid GLB or glTF content/
  );
  assert.deepEqual(stableModelParseFailure(new Error("/tmp/timestamped/model is not a GLB file.")), {
    code: "invalid-glb-header",
    message: "Downloaded model did not have a valid GLB header."
  });

  const windows = findKeywordWindows('const mixer = new THREE.AnimationMixer(model); mixer.setTime(scrollY * duration);', "fixture");
  assert(windows.length >= 2);

  const timeDriver = inferScrollDriver({
    combinedText: "const delta = clock.getDelta(); clip.play(); mixer.update(delta);",
    modelSummary: summary,
    rotateOnScrollValues: [],
    slidePositions: []
  });
  assert.equal(timeDriver.type, "time-based");
  assert.equal(timeDriver.classificationHint, "within-beat-dynamics");

  const localDriver = inferScrollDriver({
    combinedText: "const percentageOfSlideTextInView = this.calculateVisibilityForDiv($(textEl), height); this.updateSlide(s.slideIndex, s.windowIndex, percentageOfSlideTextInView / 100);",
    modelSummary: { ...summary, hasEmbeddedAnimation: false, animationCount: 0, animations: [] },
    rotateOnScrollValues: ["0"],
    slidePositions: []
  });
  assert.equal(localDriver.type, "local-scroll-window-progress");
  assert.equal(localDriver.classificationHint, "within-beat-dynamics");

  const captionStateDriver = inferScrollDriver({
    combinedText: "const percentageOfWindowIsScrolled = getPercentageOfDivScrolled(webGLContentEl, webGLWindowHeight, windowHeight, scrollTop); const mixer = new AnimationMixer(scene); mixer.update(percentageOfWindowIsScrolled * duration);",
    modelSummary: summary,
    rotateOnScrollValues: ["0"],
    slidePositions: [],
    captionState: {
      hasCaptionStateProgression: true,
      distinctActiveTextCount: 2,
      activeTextChangeCount: 1
    }
  });
  assert.equal(captionStateDriver.type, "local-scroll-window-progress");
  assert.equal(captionStateDriver.classificationHint, "inter-beat-dynamics");

  const slideDriver = inferScrollDriver({
    combinedText: "const highlights = [{ path: 'rover.glb', slideindeces: [2] }]; this.updateSlide(slideIndex, windowIndex, percent);",
    modelSummary: { ...summary, hasEmbeddedAnimation: false, animationCount: 0, animations: [] },
    rotateOnScrollValues: ["0"],
    slidePositions: []
  });
  assert.equal(slideDriver.type, "slide-indexed-scroll-transition");
  assert.equal(slideDriver.classificationHint, "inter-beat-dynamics");
  const probe = {
    story_url: "https://www.nytimes.com/interactive/2026/01/01/test-story.html",
    slug: "test-story",
    title: "Test Story",
    storyvr_author_input: {
      schemaVersion: "storyvr-author-input-seed/v1",
      headings: [
        {
          category: "heading",
          id: "heading-1",
          index: 0,
          text: "Section One",
          domOrder: 0
        }
      ],
      image_groups: [
        {
          id: "image-group-1",
          category: "image_group",
          index: 0,
          selector: "figure.g-image",
          tag: "figure",
          className: "g-image",
          domOrder: 25000,
          image: {
            url: "https://example.com/mars-image.jpg",
            allUrls: ["https://example.com/mars-image.jpg"],
            srcset: []
          },
          caption: {
            category: "image_caption",
            text: "Mars image caption",
            domOrder: 25001
          },
          credits: [
            {
              category: "image_credit",
              text: "NASA/JPL-Caltech",
              domOrder: 25002
            }
          ]
        }
      ],
      text_units: [
        { text: "Intro beat", domOrder: 0, source: "seed" },
        { text: "Section One", domOrder: 10, source: "seed" },
        { text: "Mars image caption", domOrder: 25001, source: "seed" },
        { text: "NASA/JPL-Caltech", domOrder: 25002, source: "seed" },
        { text: "Second beat", domOrder: 50000, source: "seed" }
      ],
      asset_candidates: [
        {
          url: "https://example.com/mars-image.jpg",
          assetType: "image",
          sourceType: "image_group",
          sourceImageGroupId: "image-group-1",
          candidate: true
        }
      ]
    },
    snapshots: [
      {
        id: "snapshot-1",
        scrollY: 0,
        scrollPercent: 0,
        activeTexts: [{ text: "Intro beat" }],
        modelUrls: ["https://example.com/fixture.glb", "https://example.com/static-fixture.glb"],
        visibleCanvases: [{ visualHash: "a" }]
      },
      {
        id: "snapshot-2",
        scrollY: 1000,
        scrollPercent: 50,
        activeTexts: [{ text: "Second beat" }],
        modelUrls: ["https://example.com/fixture.glb", "https://example.com/static-fixture.glb"],
        visibleCanvases: [{ visualHash: "b" }]
      }
    ],
    page_keyword_windows: [
      {
        keyword: "setTime",
        context: 'fixture.glb"; const mixer = new THREE.AnimationMixer(model); mixer.setTime(slide.position * duration);'
      }
    ]
  };
  const evidence = {
    sourceEvidence: buildProbeTextEvidence(probe),
    runtimeObservation: {
      summary: summarizeRuntime(probe.snapshots.map(normalizeSnapshot)),
      snapshots: probe.snapshots.map(normalizeSnapshot)
    }
  };
  const hints = relationshipHintsForModel(summary, evidence.sourceEvidence, evidence.runtimeObservation.snapshots);
  assert.equal(hints.scriptSignals.hasAnimationApi, true);
  assert.equal(hints.scrollDriver.type, "local-scroll-window-progress");
  assert.equal(hints.scrollDriver.classificationHint, "inter-beat-dynamics");
  assert.equal(hints.runtimePresence.snapshotCount, 2);
  assert.equal(hints.runtimePresence.distinctActiveTextCount, 2);
  const staticHints = relationshipHintsForModel(staticSummary, evidence.sourceEvidence, evidence.runtimeObservation.snapshots);
  assert.equal(staticHints.runtimePresence.snapshotCount, 2);
  assert.equal(staticHints.runtimePresence.distinctActiveTextCount, 2);

  const runtimeAction = ({ id, clipIndex, clipName, time, weight = 1, paused = false, targetNodeNames = [] }) => ({
    actionId: id,
    mixerId: "mixer-fixture",
    clipIndex,
    clipName,
    targetNodeNames,
    time,
    duration: 2.5,
    enabled: true,
    paused,
    running: true,
    scheduled: true,
    finished: false,
    playing: true,
    effectiveWeight: weight,
    effectiveTimeScale: 1,
    loop: "repeat"
  });
  const runtimeModelState = ({
    assetUrl,
    runtimeModelId,
    visible,
    partName,
    actions = [],
    identitySource = "gltf-loader-hook",
    transformSignature = "transform-stable"
  }) => ({
    runtimeModelId,
    rootObjectId: `${runtimeModelId}-root`,
    rootName: runtimeModelId,
    assetUrl,
    identitySource,
    identityConfidence: identitySource === "gltf-loader-hook" ? 1 : 0.6,
    registrationSource: identitySource,
    sceneId: "scene-fixture",
    selfVisible: visible,
    ancestorVisible: visible,
    effectiveVisible: visible,
    renderEligible: visible,
    renderablePartCount: 1,
    visiblePartCount: visible ? 1 : 0,
    visibleParts: visible ? [{
      nodeId: `${runtimeModelId}-${partName}`,
      nodePath: `${runtimeModelId}[0]/${partName}[0]`,
      name: partName,
      objectType: "Mesh",
      isMesh: true,
      selfVisible: true,
      ancestorVisible: true,
      effectiveVisible: true,
      materialVisible: true,
      materialOpacity: 1,
      layersMatch: true,
      renderEligible: true,
      worldPosition: [0, 0, 0],
      worldTransformSignature: transformSignature
    }] : [],
    mixers: [{
      mixerId: "mixer-fixture",
      rootObjectId: `${runtimeModelId}-root`,
      time: actions[0]?.time ?? 0,
      timeScale: 1,
      driverObservation: {
        mode: "unknown",
        mechanism: "mixer-update",
        confidence: 0.4,
        reasoning: "The fixture relies on stationary runtime pairs for final driver inference."
      },
      actionStates: actions
    }]
  });
  const fixtureRuntimeRelationships = [
    {
      id: "relationship-01",
      assetUrl: summary.assetUrl,
      assetFile: summary.file,
      hasEmbeddedAnimation: true,
      hints
    },
    {
      id: "relationship-02",
      assetUrl: staticSummary.assetUrl,
      assetFile: staticSummary.file,
      hasEmbeddedAnimation: false,
      hints: staticHints
    }
  ];
  const runtimeSnapshotSeed = ({ id, text, scrollY, scrollPercent, elapsedMs, timeActionTime, scrollActionTime, staticVisible, transformSignature = "transform-stable" }) => ({
    id,
    label: id,
    timestamp: `2026-01-01T00:00:0${id.slice(-1)}.000Z`,
    elapsedMs,
    scrollY,
    scrollPercent,
    activeTexts: [{ text, dataScene: "scene-fixture", dataSlide: text === "Intro beat" ? "0" : "1" }],
    modelUrls: [summary.assetUrl, staticSummary.assetUrl],
    visibleCanvases: [{ visualHash: id }],
    runtime3D: {
      captureStatus: "ok",
      reason: "Fixture runtime objects are directly observable.",
      source: "three-runtime-instrumentation",
      models: [
        runtimeModelState({
          assetUrl: summary.assetUrl,
          runtimeModelId: "runtime-model-animated",
          visible: true,
          partName: "highlight_target_0",
          transformSignature,
          actions: [
            runtimeAction({ id: "action-time", clipIndex: 0, clipName: "TimeClip", time: timeActionTime, weight: 0.6, targetNodeNames: ["highlight_target_0"] }),
            runtimeAction({ id: "action-scroll", clipIndex: 1, clipName: "ScrollClip", time: scrollActionTime, weight: 0.4, targetNodeNames: ["highlight_driver_0"] }),
            runtimeAction({ id: "action-paused", clipIndex: 2, clipName: "PausedClip", time: 0.5, paused: true, targetNodeNames: ["highlight_target_0"] }),
            runtimeAction({ id: "action-zero", clipIndex: 3, clipName: "ZeroWeightClip", time: 0.5, weight: 0, targetNodeNames: ["highlight_target_0"] })
          ]
        }),
        runtimeModelState({
          assetUrl: staticSummary.assetUrl,
          runtimeModelId: "runtime-model-static",
          visible: staticVisible,
          partName: "static_mesh",
          actions: [runtimeAction({ id: "hidden-running-action", clipIndex: 0, clipName: "RuntimeJsAction", time: 0.8 })]
        })
      ],
      activeCameras: [{
        cameraId: "camera-fixture",
        sceneId: "scene-fixture",
        name: "Fixture Camera",
        type: "PerspectiveCamera",
        position: [0, 1, 5],
        quaternion: [0, 0, 0, 1],
        fov: 50,
        near: 0.1,
        far: 1000,
        zoom: 1
      }]
    }
  });
  const directRuntimeSnapshots = [
    runtimeSnapshotSeed({ id: "direct-1", text: "Intro beat", scrollY: 0, scrollPercent: 0, elapsedMs: 1000, timeActionTime: 0.1, scrollActionTime: 0.2, staticVisible: false, transformSignature: "transform-a" }),
    runtimeSnapshotSeed({ id: "direct-2", text: "Intro beat", scrollY: 0, scrollPercent: 0, elapsedMs: 1300, timeActionTime: 0.4, scrollActionTime: 0.2, staticVisible: false, transformSignature: "transform-b" }),
    runtimeSnapshotSeed({ id: "direct-3", text: "Second beat", scrollY: 1000, scrollPercent: 50, elapsedMs: 2000, timeActionTime: 1.1, scrollActionTime: 1.2, staticVisible: true }),
    runtimeSnapshotSeed({ id: "direct-4", text: "Second beat", scrollY: 1000, scrollPercent: 50, elapsedMs: 2300, timeActionTime: 1.4, scrollActionTime: 1.2, staticVisible: true })
  ].map(normalizeSnapshot);
  const directBeatStates = buildBeatRuntimeStates(directRuntimeSnapshots, fixtureRuntimeRelationships);
  assert.equal(directBeatStates.length, 2);
  const introRuntimeBeat = directBeatStates.find((beat) => beat.text === "Intro beat");
  const secondRuntimeBeat = directBeatStates.find((beat) => beat.text === "Second beat");
  assert.equal(introRuntimeBeat.captureStatus, "ok");
  assert.equal(introRuntimeBeat.snapshotIds.length, 2);
  assert.equal(introRuntimeBeat.visibleModels.length, 1);
  assert.equal(introRuntimeBeat.visibleModels[0].assetFile, summary.file);
  assert.equal(introRuntimeBeat.visibleModels[0].visibleParts[0].name, "highlight_target_0");
  assert.equal(introRuntimeBeat.visibleModels[0].partStateChanges[0].transformChanged, true);
  assert.equal(introRuntimeBeat.observedHiddenModels.some((model) => model.assetFile === staticSummary.file), true);
  assert.equal(secondRuntimeBeat.visibleModels.some((model) => model.assetFile === staticSummary.file), true);
  assert.equal("variantGroupId" in introRuntimeBeat, false, "non-variant runtime beat output must stay backward compatible");
  const introPlaying = introRuntimeBeat.visibleModels[0].playingAnimations;
  assert.equal(introPlaying.length, 2);
  assert.equal(introPlaying.find((action) => action.clipName === "TimeClip")?.playback.mode, "time-based");
  assert.equal(introPlaying.find((action) => action.clipName === "ScrollClip")?.playback.mode, "scroll-based");
  assert.equal(introPlaying.find((action) => action.clipName === "ScrollClip")?.targetParts.length, 0);
  assert.equal(introRuntimeBeat.activeCameras[0].cameraId, "camera-fixture");
  assert.equal(summarizeRuntime(directRuntimeSnapshots).visibleModelSequenceChangeCount, 1);
  const visuallyAnnotatedBeats = attachVisualEvidenceToBeatStates(directBeatStates, visualObservation);
  assert.equal(visuallyAnnotatedBeats.find((beat) => beat.text === "Intro beat").visualEvidence[0].evidenceRef, "visual-scroll-target-0001");
  const directRuntimeEvidence = {
    relationships: fixtureRuntimeRelationships,
    runtimeObservation: {
      summary: summarizeRuntime(directRuntimeSnapshots),
      snapshots: directRuntimeSnapshots,
      beatRuntimeStates: directBeatStates
    }
  };
  const directFixtureAssociation = modelBeatAssociationsForJudgment({}, directRuntimeEvidence)
    .find((association) => association.assetFile === summary.file);
  assert.equal(directFixtureAssociation.associationSource, "direct-runtime");
  assert.equal(directFixtureAssociation.associatedBeats.length, 2);

  const variantRuntimeSnapshots = [
    {
      id: "variant-runtime-forest",
      text: "Shared habitat beat",
      scrollY: 500,
      scrollPercent: 25,
      elapsedMs: 3000,
      timeActionTime: 0.2,
      scrollActionTime: 0.3,
      staticVisible: true,
      transformSignature: "variant-transform-before"
    },
    {
      id: "variant-runtime-desert",
      text: "Shared habitat beat",
      scrollY: 500,
      scrollPercent: 25,
      elapsedMs: 3300,
      timeActionTime: 0.5,
      scrollActionTime: 0.3,
      staticVisible: true,
      transformSignature: "variant-transform-after"
    }
  ].map((settings, index) => {
    const snapshot = runtimeSnapshotSeed(settings);
    snapshot.runtime3D.assetCoverageComplete = true;
    const animatedModel = snapshot.runtime3D.models[0];
    animatedModel.visibleParts.push({
      ...animatedModel.visibleParts[0],
      nodeId: "runtime-model-animated-stable-part",
      nodePath: "runtime-model-animated[0]/stable_part[0]",
      name: "stable_part",
      worldTransformSignature: "variant-stable-part"
    });
    animatedModel.renderablePartCount = 2;
    animatedModel.visiblePartCount = 2;
    return normalizeSnapshot(snapshot, index);
  });
  const variantRuntimeContextProbe = {
    variant_asset_associations: [
      {
        groupId: "habitat-selector",
        optionId: "forest-option",
        optionLabel: "Forest",
        snapshotIds: ["variant-runtime-forest"],
        interactionPath: [{ groupId: "habitat-selector", optionId: "forest-option", optionLabel: "Forest" }]
      },
      {
        groupId: "habitat-selector",
        optionId: "desert-option",
        optionLabel: "Desert",
        snapshotIds: ["variant-runtime-desert"],
        interactionPath: [{ groupId: "habitat-selector", optionId: "desert-option", optionLabel: "Desert" }]
      }
    ]
  };
  const variantRuntimeBeats = buildBeatRuntimeStates(
    variantRuntimeSnapshots,
    fixtureRuntimeRelationships,
    buildVariantContextBySnapshotId(variantRuntimeContextProbe)
  );
  assert.equal(variantRuntimeBeats.length, 2, "identical active beat text must not merge snapshots from different variant options");
  assert.deepEqual(
    variantRuntimeBeats.map((beat) => beat.variantOptionId).sort(stableCompare),
    ["desert-option", "forest-option"]
  );
  const forestRuntimeBeat = variantRuntimeBeats.find((beat) => beat.variantOptionId === "forest-option");
  assert.equal(forestRuntimeBeat.variantGroupId, "habitat-selector");
  assert.deepEqual(forestRuntimeBeat.interactionPath, [
    { groupId: "habitat-selector", optionId: "forest-option", optionLabel: "Forest" }
  ]);
  assert.equal(forestRuntimeBeat.samples[0].variantOptionId, "forest-option");
  assert.notEqual(variantRuntimeBeats[0].beatId, variantRuntimeBeats[1].beatId);
  const desertRuntimeBeat = variantRuntimeBeats.find((beat) => beat.variantOptionId === "desert-option");
  const boundaryChangedModel = desertRuntimeBeat.visibleModels.find((model) => model.relationshipId === "relationship-01");
  const unchangedConcurrentModel = desertRuntimeBeat.visibleModels.find((model) => model.relationshipId === "relationship-02");
  assert.equal(boundaryChangedModel.runtimeChanged, true);
  assert.equal(boundaryChangedModel.transformChanged, true);
  assert(boundaryChangedModel.changeKinds.includes("part-transform-change"));
  assert.equal(boundaryChangedModel.partStateChanges.length, 1);
  assert.equal(boundaryChangedModel.partStateChanges[0].changed, true);
  assert.equal(boundaryChangedModel.partStateChanges[0].transformChanged, true);
  assert.equal(boundaryChangedModel.partStateChanges[0].runtimeObservationKind, "direct-runtime-boundary-change");
  assert(boundaryChangedModel.partStateChanges[0].changeKinds.includes("part-transform-change"));
  assert.equal(unchangedConcurrentModel.runtimeChanged, false);
  assert.deepEqual(unchangedConcurrentModel.changeKinds, []);
  assert.equal(unchangedConcurrentModel.partStateChanges.length, 0);

  const coherentRootMotionSnapshots = [
    { id: "root-motion-before", text: "Before root motion", signature: "root-motion-before", elapsedMs: 3600 },
    { id: "root-motion-after", text: "After root motion", signature: "root-motion-after", elapsedMs: 3900 }
  ].map((settings, index) => {
    const snapshot = runtimeSnapshotSeed({
      id: settings.id,
      text: settings.text,
      scrollY: 600 + index * 100,
      scrollPercent: 30 + index * 5,
      elapsedMs: settings.elapsedMs,
      timeActionTime: 0,
      scrollActionTime: 0,
      staticVisible: true,
      transformSignature: settings.signature
    });
    snapshot.runtime3D.assetCoverageComplete = true;
    const animatedModel = snapshot.runtime3D.models[0];
    animatedModel.visibleParts.push({
      ...animatedModel.visibleParts[0],
      nodeId: "runtime-model-animated-root-motion-peer",
      nodePath: "runtime-model-animated[0]/root_motion_peer[0]",
      name: "root_motion_peer",
      worldTransformSignature: settings.signature
    });
    animatedModel.renderablePartCount = 2;
    animatedModel.visiblePartCount = 2;
    return normalizeSnapshot(snapshot, index);
  });
  const coherentRootMotionBeats = buildBeatRuntimeStates(
    coherentRootMotionSnapshots,
    fixtureRuntimeRelationships
  );
  const coherentRootMotionModel = coherentRootMotionBeats
    .find((beat) => beat.text === "After root motion")
    .visibleModels.find((model) => model.relationshipId === "relationship-01");
  assert.equal(coherentRootMotionModel.runtimeChanged, true);
  assert.equal(coherentRootMotionModel.transformChanged, true);
  assert(coherentRootMotionModel.changeKinds.includes("model-transform-change"));
  assert.equal(
    coherentRootMotionModel.partStateChanges.length,
    0,
    "coherent all-part world motion must collapse to one whole-model delta instead of fanning out child targets"
  );

  const replacementRelationship = {
    id: "relationship-replacement",
    assetUrl: "https://example.com/replacement.glb",
    assetFile: "replacement.glb",
    hasEmbeddedAnimation: false,
    animations: []
  };
  const swapSnapshotSettings = [
    { id: "model-swap-before", text: "Before model swap", scrollY: 700, scrollPercent: 35, elapsedMs: 4000 },
    { id: "model-swap-after", text: "After model swap", scrollY: 900, scrollPercent: 45, elapsedMs: 4300 }
  ];
  const modelSwapSnapshots = swapSnapshotSettings.map((settings, index) => {
    const snapshot = runtimeSnapshotSeed({
      ...settings,
      timeActionTime: 0,
      scrollActionTime: 0,
      staticVisible: true
    });
    snapshot.runtime3D.assetCoverageComplete = true;
    snapshot.runtime3D.models = [
      runtimeModelState({
        assetUrl: index === 0 ? summary.assetUrl : replacementRelationship.assetUrl,
        runtimeModelId: index === 0 ? "runtime-model-before-swap" : "runtime-model-after-swap",
        visible: true,
        partName: index === 0 ? "before_swap_mesh" : "after_swap_mesh"
      }),
      runtimeModelState({
        assetUrl: staticSummary.assetUrl,
        runtimeModelId: "runtime-model-concurrent",
        visible: true,
        partName: "concurrent_mesh"
      })
    ];
    return normalizeSnapshot(snapshot, index);
  });
  const modelSwapBeats = buildBeatRuntimeStates(
    modelSwapSnapshots,
    [...fixtureRuntimeRelationships, replacementRelationship]
  );
  const modelSwapAfterBeat = modelSwapBeats.find((beat) => beat.text === "After model swap");
  const swappedInModel = modelSwapAfterBeat.visibleModels.find((model) => model.relationshipId === replacementRelationship.id);
  const swapConcurrentModel = modelSwapAfterBeat.visibleModels.find((model) => model.relationshipId === "relationship-02");
  assert.equal(swappedInModel.runtimeChanged, true);
  assert.equal(swappedInModel.modelChanged, true);
  assert.equal(swappedInModel.modelSwapped, true);
  assert.equal(swappedInModel.activeModelChanged, true);
  assert.equal(swappedInModel.newlyPresent, true);
  assert.equal(swappedInModel.becameVisible, true);
  assert(swappedInModel.changeKinds.includes("newly-present"));
  assert(swappedInModel.changeKinds.includes("model-swap"));
  assert.equal(swapConcurrentModel.runtimeChanged, false);
  assert.equal(swapConcurrentModel.modelSwapped, false);
  assert.deepEqual(swapConcurrentModel.changeKinds, []);

  const longBeatText = `${"A complete StoryVR beat must retain every character. ".repeat(40)}Final sentence.`;
  assert(longBeatText.length > 1600);
  assert.equal(normalizeAssociatedBeat({ beatId: "long-beat", text: longBeatText })?.text, longBeatText);
  assert.equal(normalizeSnapshot({
    id: "long-text-snapshot",
    activeTexts: [{ text: longBeatText }]
  }, 0).activeTexts[0].text, longBeatText);
  const longBeatAuthorStructure = buildStoryStructureForAuthorInput(
    {
      title: "Long beat fixture",
      storyvr_author_input: {
        text_units: [{ text: longBeatText, domOrder: 25000, source: "long-text-snapshot" }]
      }
    },
    { story: { title: "Long beat fixture" } },
    {
      modelBeatAssociations: [{
        assetUrl: summary.assetUrl,
        assetFile: summary.file,
        associatedBeats: [{
          beatId: "long-beat",
          text: longBeatText,
          scrollPercent: 25,
          source: "direct-source-config"
        }],
        associationSource: "direct-source-config",
        evidenceRefs: []
      }],
      imageBeatAssociations: []
    },
    [{
      asset_url: summary.assetUrl,
      local_path: `models/${summary.file}`,
      asset_type: "model"
    }]
  );
  assert.equal(longBeatAuthorStructure.slides.length, 1);
  assert.equal(longBeatAuthorStructure.slides[0].text, longBeatText);
  assert.equal(longBeatAuthorStructure.text_only_parts.length, 0, "full long visual text must not be repeated as a text-only beat");
  const remainingTextOnlyUnits = textOnlyEntriesFromProbe({
    storyvr_author_input: {
      text_units: [
        { text: "Opening prose", domOrder: 0 },
        { text: longBeatText, domOrder: 25000 },
        { text: "Closing prose", domOrder: 50000 }
      ]
    }
  }, longBeatAuthorStructure.slides);
  assert.deepEqual(remainingTextOnlyUnits.map((unit) => unit.text), ["Opening prose", "Closing prose"]);

  const sharkSectionHeadings = [
    ["How to avoid an attack", 47990.006],
    ["Stay in groups", 50386.008],
    ["Be cautious mornings and evenings", 51375.01],
    ["Stay away from shark food", 52798.012],
    ["Watch what you wear", 59487.014],
    ["Don’t worry about an open wound", 60911.016],
    ["Please don’t play with sharks", 62551.018],
  ].map(([text, domOrder], index) => ({ id: `heading-${index + 1}`, text, domOrder }));
  const sharkSectionBodies = new Map([
    ["How to avoid an attack", "Introductory safety context."],
    ["Stay in groups", "Sharks are skittish, and groups are more obviously not food."],
    ["Be cautious mornings and evenings", "Many sharks hunt at dawn and dusk."],
    ["Stay away from shark food", "Avoid seal colonies and schools of fish."],
    ["Watch what you wear", "Leave shiny jewelry at home because sharks see contrast."],
    ["Don’t worry about an open wound", "Sharks are not drawn to the blood of land mammals."],
    ["Please don’t play with sharks", "Do not pull sharks’ tails or try to kiss them."],
  ]);
  const sharkCompositeText = sharkSectionHeadings
    .map((heading) => `${heading.text}${sharkSectionBodies.get(heading.text)}`)
    .join("");
  const sharkSectionStructure = buildStoryStructureForAuthorInput(
    {
      title: "Shark safety fixture",
      storyvr_author_input: {
        headings: sharkSectionHeadings,
        text_units: [{ id: "runtime-text-safety", text: sharkCompositeText, domOrder: 45000 }],
      },
    },
    { story: { title: "Shark safety fixture" } },
    {
      modelBeatAssociations: [{
        assetUrl: summary.assetUrl,
        assetFile: summary.file,
        associatedBeats: [
          { text: "Watch what you wear", scrollPercent: 53.7, source: "inferred-runtime" },
          { text: "Don’t worry about an open wound", scrollPercent: 59.1, source: "inferred-runtime" },
          { text: "Please don’t play with sharks", scrollPercent: 59.8, source: "inferred-runtime" },
        ],
        associationSource: "inferred-runtime",
        evidenceRefs: [],
      }],
      imageBeatAssociations: [],
    },
    [{ asset_url: summary.assetUrl, local_path: `models/${summary.file}`, asset_type: "model" }],
  );
  assert.deepEqual(
    sharkSectionStructure.slides.map((slide) => slide.sectionHeading),
    ["Watch what you wear", "Don’t worry about an open wound", "Please don’t play with sharks"],
  );
  assert.deepEqual(
    sharkSectionStructure.slides.map((slide) => slide.text),
    [
      sharkSectionBodies.get("Watch what you wear"),
      sharkSectionBodies.get("Don’t worry about an open wound"),
      sharkSectionBodies.get("Please don’t play with sharks"),
    ],
  );
  assert.equal(
    sharkSectionStructure.text_only_parts.some((unit) => (
      unit.sectionHeading === "Stay away from shark food"
      && unit.text === sharkSectionBodies.get("Stay away from shark food")
    )),
    true,
  );
  assert.equal(sharkSectionStructure.text_only_parts.some((unit) => unit.text === sharkCompositeText), false);

  const genericVariantManifest = [
    { local_path: "models/forest.glb", asset_url: "https://example.com/forest.glb", final_url: "https://example.com/forest.glb", asset_type: "model" },
    { local_path: "models/desert.glb", asset_url: "https://example.com/desert.glb", final_url: "https://example.com/desert.glb", asset_type: "model" },
  ];
  const genericVariantProbe = {
    story_url: "https://example.com/habitats",
    slug: "habitats",
    title: "Habitats",
    page_keyword_windows: [
      { index: 100, context: "forest option panel" },
      { index: 200, context: "desert option panel" },
    ],
    storyvr_author_input: {
      text_units: [{ text: "Forest Forest details Desert Desert details", domOrder: 50000 }],
    },
  };
  const genericVariantJudgment = {
    modelBeatAssociations: [
      {
        assetFile: "desert.glb",
        assetUrl: "https://example.com/desert.glb",
        associationConfidence: 0.91,
        associationSource: "direct-source-config",
        associatedBeats: [{ text: "Desert — Choose a habitat", scrollPercent: 50, confidence: 0.91, source: "direct-source-config" }],
      },
      {
        assetFile: "forest.glb",
        assetUrl: "https://example.com/forest.glb",
        associationConfidence: 0.92,
        associationSource: "direct-source-config",
        associatedBeats: [{ text: "Forest — Choose a habitat", scrollPercent: 50, confidence: 0.92, source: "direct-source-config" }],
      },
    ],
  };
  const genericVariantStructure = buildStoryStructureForAuthorInput(
    genericVariantProbe,
    { story: { title: "Habitats", slug: "habitats", url: genericVariantProbe.story_url }, glbAnimations: {} },
    genericVariantJudgment,
    genericVariantManifest,
  );
  assert.equal(genericVariantStructure.variant_groups.length, 1);
  assert.equal(genericVariantStructure.variant_groups[0].title, "Choose a habitat");
  assert.deepEqual(genericVariantStructure.variant_groups[0].options.map((option) => option.label), ["Forest", "Desert"]);
  assert.equal(genericVariantStructure.variant_groups[0].defaultOptionId, "forest");
  assert.equal(genericVariantStructure.text_only_parts.length, 0, "aggregate variant copy must not survive as a sequential text beat");
  const locationVariantGroup = {
    schemaVersion: "storyvr-source-variant-group/v1",
    id: "risk-selector",
    title: "What’s your risk?",
    domOrder: 20000,
    options: ["California", "Florida", "Hawaii"].map((label, index) => ({
      id: label.toLowerCase(),
      label,
      domOrder: 24000 + index
    })),
    evidence: {
      source: "source-dom-button-cluster",
      rootSelector: "div.slide.slide-1.story-widget"
    }
  };
  const locationVariantTextParts = textOnlyEntriesFromProbe({
    storyvr_author_input: {
      text_units: [
        {
          id: "runtime-text-opening",
          text: "Opening prose mentions Hawaii and the Florida Museum, but it is not selector content.",
          domOrder: 5000,
          tag: "div",
          className: "slide slide-0 story-widget"
        },
        {
          id: "runtime-text-selector-a",
          text: "What’s your risk? The answer depends on where you are. California Florida Hawaii You've selected California. Read more information about it below. State details.",
          domOrder: 15500,
          tag: "div",
          className: "slide slide-1 story-widget"
        },
        {
          id: "runtime-text-selector-b",
          text: "What’s your risk? The answer depends on where you are. California Florida Hawaii You've selected Florida. Read more information about it below. Different state details.",
          domOrder: 15600,
          tag: "div",
          className: "slide slide-1 story-widget"
        }
      ]
    }
  }, [], [locationVariantGroup]);
  assert.deepEqual(
    locationVariantTextParts.map((unit) => unit.text),
    [
      "Opening prose mentions Hawaii and the Florida Museum, but it is not selector content.",
      "The answer depends on where you are."
    ],
    "variant cleanup must keep distant prose and retain one deduplicated narrative prefix from the selector container"
  );
  assert.equal(locationVariantTextParts[1].observed.variantGroupId, "risk-selector");
  assert.equal(locationVariantTextParts[1].observed.variantTextRole, "narrative-prefix");
  const interactionVariantStructure = buildStoryStructureForAuthorInput(
    {
      ...genericVariantProbe,
      variant_groups: [{
        id: "habitat-selector",
        title: "Choose a habitat",
        defaultOptionId: "forest-option",
        options: [
          { id: "forest-option", label: "Forest", assetUrls: ["https://example.com/forest.glb"] },
          { id: "desert-option", label: "Desert", assetUrls: ["https://example.com/forest.glb"] },
        ],
      }],
      variant_asset_associations: [
        {
          groupId: "habitat-selector",
          optionId: "forest-option",
          optionLabel: "Forest",
          assetUrls: ["https://example.com/forest.glb"],
          domAssetUrls: ["https://example.com/forest.glb"],
          runtimeAssetUrls: [],
          source: "collector-verified-variant-interaction",
          snapshotIds: ["snapshot-10"],
          captureStatus: "unavailable",
        },
        {
          groupId: "habitat-selector",
          optionId: "desert-option",
          optionLabel: "Desert",
          assetUrls: ["https://example.com/forest.glb", "https://example.com/desert.glb"],
          domAssetUrls: ["https://example.com/forest.glb"],
          runtimeAssetUrls: ["https://example.com/desert.glb"],
          source: "collector-verified-variant-interaction",
          snapshotIds: ["snapshot-11"],
          captureStatus: "ok",
        },
      ],
    },
    { story: { title: "Habitats", slug: "habitats", url: genericVariantProbe.story_url }, glbAnimations: {} },
    genericVariantJudgment,
    genericVariantManifest,
  );
  assert.deepEqual(
    interactionVariantStructure.variant_groups[0].options.map((option) => option.asset_ids),
    [["forest.glb"], ["forest.glb", "desert.glb"]],
    "broad authoring links must retain the DOM/runtime union without changing channel provenance",
  );
  const [forestVariantOption, desertVariantOption] = interactionVariantStructure.variant_groups[0].options;
  assert.deepEqual(forestVariantOption.runtimeAssetIds, []);
  assert.deepEqual(forestVariantOption.domAssetIds, ["forest.glb"]);
  assert.equal(forestVariantOption.runtimeAssetProvenance, "unavailable");
  assert.equal(forestVariantOption.captureStatus, "unavailable");
  assert.deepEqual(desertVariantOption.runtimeAssetIds, ["desert.glb"]);
  assert.deepEqual(desertVariantOption.runtimeAssetUrls, ["https://example.com/desert.glb"]);
  assert.deepEqual(desertVariantOption.domAssetIds, ["forest.glb"]);
  assert.deepEqual(desertVariantOption.domAssetUrls, ["https://example.com/forest.glb"]);
  assert.equal(desertVariantOption.runtimeAssetProvenance, "direct-runtime");
  assert.equal(desertVariantOption.domAssetProvenance, "dom-observed");
  assert.deepEqual(desertVariantOption.snapshotIds, ["snapshot-11"]);
  assert.deepEqual(desertVariantOption.evidence.runtimeAssetIds, ["desert.glb"]);
  assert.deepEqual(desertVariantOption.evidence.runtimeAssetUrls, ["https://example.com/desert.glb"]);
  assert.deepEqual(desertVariantOption.evidence.domAssetIds, ["forest.glb"]);
  assert.deepEqual(desertVariantOption.evidence.domAssetUrls, ["https://example.com/forest.glb"]);
  assert.equal(desertVariantOption.evidence.runtimeAssetProvenance, "direct-runtime");
  assert.equal(desertVariantOption.evidence.domAssetProvenance, "dom-observed");
  assert.equal(desertVariantOption.evidence.captureStatus, "ok");
  assert.deepEqual(desertVariantOption.evidence.snapshotIds, ["snapshot-11"]);
  assert.equal(
    interactionVariantStructure.variant_groups[0].options[1].evidence.source,
    "collector-verified-variant-interaction",
  );
  const fallbackVariantStructure = buildStoryStructureForAuthorInput(
    {
      ...genericVariantProbe,
      variant_groups: [{
        id: "habitat-selector",
        title: "Choose a habitat",
        options: [
          { id: "forest-option", label: "Forest" },
          { id: "desert-option", label: "Desert" },
        ],
      }],
    },
    { story: { title: "Habitats", slug: "habitats", url: genericVariantProbe.story_url }, glbAnimations: {} },
    genericVariantJudgment,
    genericVariantManifest,
  );
  assert.deepEqual(
    fallbackVariantStructure.variant_groups[0].options.map((option) => option.asset_ids),
    [["forest.glb"], ["desert.glb"]],
    "semantic model associations must fill options left unlinked by collector interaction",
  );
  const preservedGenericVariants = verifiedExistingVariantGroups({
    ...genericVariantProbe,
    storyvr_author_input: {
      text_units: [{ text: "Choose a habitat Forest Forest details Desert Desert details", domOrder: 500 }]
    }
  }, {
    story_url: genericVariantProbe.story_url,
    variant_groups: genericVariantStructure.variant_groups
  }, genericVariantManifest);
  assert.equal(preservedGenericVariants.length, 1);
  assert.equal(preservedGenericVariants[0].evidence.source, "preserved-verified-author-input");
  assert.equal(verifiedExistingVariantGroups(genericVariantProbe, {
    story_url: "https://example.com/different-story",
    variant_groups: genericVariantStructure.variant_groups
  }, genericVariantManifest).length, 0);
  assert.equal(verifiedExistingVariantGroups(genericVariantProbe, {
    story_url: genericVariantProbe.story_url,
    variant_groups: genericVariantStructure.variant_groups
  }, genericVariantManifest.slice(0, 1)).length, 0);

  const announcementVariantProbe = {
    story_url: "https://example.com/routes",
    title: "Route chooser",
    storyvr_author_input: {
      headings: [{ text: "Choose a route", domOrder: 1000, tag: "h2" }],
      text_units: [{
        text: "Choose a route Forest Desert Coast You've selected Forest. Read more information about it below. Tall trees. You've selected Desert. Read more information about it below. Open sand. You've selected Coast. Read more information about it below. Wind and water.",
        domOrder: 1000,
        source: "route-selector"
      }]
    }
  };
  const announcementVariantStructure = buildStoryStructureForAuthorInput(
    announcementVariantProbe,
    { story: { title: "Route chooser", url: announcementVariantProbe.story_url }, glbAnimations: {} },
    { modelBeatAssociations: [], imageBeatAssociations: [] },
    []
  );
  assert.equal(announcementVariantStructure.variant_groups.length, 1);
  assert.equal(announcementVariantStructure.variant_groups[0].title, "Choose a route");
  assert.deepEqual(announcementVariantStructure.variant_groups[0].options.map((option) => option.label), ["Forest", "Desert", "Coast"]);
  assert.equal(announcementVariantStructure.text_only_parts.length, 0, "selection-announcement aggregate copy must not remain sequential");
  assert.equal(textDerivedVariantGroupsFromProbe({
    storyvr_author_input: { text_units: [{ text: "You selected one ending. Read more information about it below.", domOrder: 1 }] }
  }).length, 0, "a single selected-state sentence is not a variant group");
  const accessibilityRouteGroup = textDerivedVariantGroupsFromProbe(announcementVariantProbe)[0];
  const collectedRouteGroup = {
    schemaVersion: "storyvr-source-variant-group/v1",
    id: "route-button-cluster",
    title: "Choose a route",
    domOrder: 6000,
    selectionMode: "single",
    defaultOptionId: "desert-button",
    control: { kind: "button-cluster" },
    options: ["Forest", "Desert", "Coast"].map((label, index) => ({
      id: `${label.toLowerCase()}-button`,
      label,
      text: `${label} details`,
      sourceOrder: index,
      domOrder: 6000 + index,
      asset_ids: [],
      asset_files: [],
      asset_urls: []
    })),
    evidence: { source: "source-dom-button-cluster" }
  };
  const mergedComplementaryRouteGroups = mergeVariantGroupCandidates([
    collectedRouteGroup,
    accessibilityRouteGroup
  ]);
  assert.equal(
    mergedComplementaryRouteGroups.length,
    1,
    "nearby DOM and accessibility observations with identical option labels must describe one selector"
  );
  assert.equal(mergedComplementaryRouteGroups[0].id, collectedRouteGroup.id);
  assert.equal(mergedComplementaryRouteGroups[0].control.kind, "button-cluster");
  assert.equal(mergedComplementaryRouteGroups[0].defaultOptionId, "desert-button");
  assert.deepEqual(
    mergedComplementaryRouteGroups[0].evidence.fallbackSources,
    ["runtime-accessibility-selection-announcements"]
  );
  assert.equal(
    mergeVariantGroupCandidates([
      collectedRouteGroup,
      { ...accessibilityRouteGroup, id: "distant-route-selector", domOrder: 14000 }
    ]).length,
    2,
    "matching labels across different control kinds must not merge distant independent selectors"
  );

  const cardVariantManifest = ["forest", "desert", "coast", "tundra"].map((name) => ({
    local_path: `models/${name}.glb`,
    asset_url: `https://example.com/${name}.glb`,
    final_url: `https://example.com/${name}.glb`,
    asset_type: "model"
  }));
  const cardBeatText = "← Forest → ← Desert → ← Coast → ← Tundra → Forest Form A 3D illustration of a Forest Form. Tall trees. Desert Form A 3D illustration of a Desert Form. Open sand. Coast Form A 3D illustration of a Coast Form. Wind and water.";
  const cardVariantJudgment = {
    modelBeatAssociations: ["forest", "desert", "coast", "tundra"].map((name) => ({
      assetFile: `${name}.glb`,
      assetUrl: `https://example.com/${name}.glb`,
      associationConfidence: name === "tundra" ? 0.71 : 0.82,
      associationSource: "inferred-source",
      associatedBeats: [{ beatId: "shared-card-beat", text: cardBeatText, scrollPercent: 40, confidence: name === "tundra" ? 0.71 : 0.82, source: "inferred-source" }],
      reasoning: name === "tundra" ? "The shared carousel includes a tundra form state." : `The ${name} card is present in the shared carousel.`
    }))
  };
  const cardVariantGroups = inferredAccessibleCardVariantGroups({
    storyvr_author_input: { text_units: [{ text: `Choose a form (click for more): ${cardBeatText}`, domOrder: 40000 }] }
  }, cardVariantJudgment, cardVariantManifest);
  assert.equal(cardVariantGroups.length, 1);
  assert.deepEqual(cardVariantGroups[0].options.map((option) => option.label), ["Forest Form", "Desert Form", "Coast Form", "Tundra Form"]);
  assert.deepEqual(cardVariantGroups[0].options.map((option) => option.asset_ids.length), [1, 1, 1, 1]);
  const nestedParentGroup = {
    schemaVersion: "storyvr-source-variant-group/v1",
    id: "region-selector",
    title: "Choose a region",
    domOrder: 1000,
    options: [
      { id: "north", label: "North", text: "North has forest and coast forms. Forms to inspect in South Desert Form Tundra Form", asset_ids: [], asset_files: [], asset_urls: [] },
      { id: "south", label: "South", text: "South has desert forms.", asset_ids: [], asset_files: [], asset_urls: [] },
    ],
    evidence: { source: "runtime-accessibility-selection-announcements" }
  };
  const nestedCardGroup = {
    ...cardVariantGroups[0],
    title: "Forms to inspect in South",
    domOrder: 2000,
  };
  const partiallyObservedCardGroup = {
    ...nestedCardGroup,
    id: "runtime-card-control",
    title: "Forms to inspect in the selected region",
    control: { ...nestedCardGroup.control },
    options: [
      ...nestedCardGroup.options.map((option) => ({
        ...option,
        asset_ids: [],
        asset_files: [],
        asset_urls: [],
        evidence: {
          source: "collector-verified-variant-interaction",
          associationContexts: [{ parentGroupId: "region-selector", parentOptionId: "south" }]
        }
      })),
      {
        id: "alpine-form",
        label: "Alpine Form",
        text: "Alpine Form",
        sourceOrder: nestedCardGroup.options.length,
        domOrder: nestedCardGroup.domOrder,
        asset_ids: [],
        asset_files: [],
        asset_urls: []
      }
    ]
  };
  const partiallyMergedCardGroups = mergeVariantGroupCandidates([partiallyObservedCardGroup, nestedCardGroup]);
  assert.equal(partiallyMergedCardGroups.length, 1, "strong partial label overlap at one control position must merge source assets into a runtime-observed group");
  assert.deepEqual(partiallyMergedCardGroups[0].options.slice(0, 4).map((option) => option.asset_ids.length), [1, 1, 1, 1]);
  assert.equal(partiallyMergedCardGroups[0].options[4].asset_ids.length, 0);
  assert.equal(partiallyMergedCardGroups[0].options[0].evidence.source, "collector-verified-variant-interaction");
  assert.equal(partiallyMergedCardGroups[0].options[0].evidence.associationContexts.length, 1);
  const distantDuplicateCardGroups = mergeVariantGroupCandidates([
    { ...nestedCardGroup, id: "first-card-control", title: "First selector", domOrder: 2000 },
    { ...nestedCardGroup, id: "second-card-control", title: "Second chooser", domOrder: 12000 }
  ]);
  assert.equal(distantDuplicateCardGroups.length, 2, "identical labels alone must not merge unrelated controls at distant source positions");
  const foldedPartialCardGroups = foldNestedVisualVariantGroups([nestedParentGroup, partiallyMergedCardGroups[0]], {
    variant_hierarchy: [{
      parentGroupId: nestedParentGroup.id,
      parentOptionId: nestedParentGroup.options[1].id,
      childGroupId: partiallyMergedCardGroups[0].id,
      childOptionIds: partiallyMergedCardGroups[0].options.slice(0, 4).map((option) => option.id),
      confirmed: true,
      source: "collector-observed-causal-interaction-dependency"
    }]
  });
  assert.equal(foldedPartialCardGroups.length, 1);
  assert.equal(foldedPartialCardGroups[0].options[1].asset_ids.length, 4, "confirmed parent contexts must inherit the source-linked assets of partially observed child options");
  assert.equal(foldedPartialCardGroups[0].options[1].visual_children[0].options.length, 4);
  const foldedFallbackGroups = foldNestedVisualVariantGroups([nestedParentGroup, nestedCardGroup], {});
  assert.equal(foldedFallbackGroups.length, 2, "text proximity alone must not invent a parent-child interaction path");
  assert.deepEqual(foldedFallbackGroups[0].options.map((option) => option.asset_ids), [[], []]);
  assert.equal(foldedFallbackGroups[0].options[0].text, nestedParentGroup.options[0].text);
  assert.equal(foldedFallbackGroups[1].hierarchy.role, "unresolved-nested-control");
  assert.deepEqual(foldedFallbackGroups[1].hierarchy.candidateParentGroupIds, [nestedParentGroup.id]);
  assert.equal(textMentionsVariantLabel("Forest forms appear along this route.", "Forest Form"), true);
  const observedSiblingGroups = foldNestedVisualVariantGroups([
    {
      ...nestedParentGroup,
      options: nestedParentGroup.options.map((option) => ({ ...option, text: option.label }))
    },
    nestedCardGroup
  ], {
    variant_asset_associations: [{
      groupId: nestedParentGroup.id,
      optionId: nestedParentGroup.options[0].id,
      optionLabel: nestedParentGroup.options[0].label,
      relationship: "variant-option",
      visualState: { labels: ["Forest Form", "Coast Form"] }
    }]
  });
  assert.equal(observedSiblingGroups.length, 2, "visual labels without parent references must remain unresolved");
  assert.deepEqual(observedSiblingGroups[0].options[0].asset_ids, []);
  assert.equal(observedSiblingGroups[1].hierarchy.role, "unresolved-nested-control");
  const foldedHierarchyGroups = foldNestedVisualVariantGroups([nestedParentGroup, nestedCardGroup], {
    variant_hierarchy: [{
      parentGroupId: nestedParentGroup.id,
      parentOptionId: nestedParentGroup.options[1].id,
      childGroupId: nestedCardGroup.id,
      childOptionIds: nestedCardGroup.options.slice(1, 3).map((option) => option.id),
      source: "collector-observed-interaction-dependency",
    }],
  });
  assert.equal(foldedHierarchyGroups.length, 1);
  assert.deepEqual(foldedHierarchyGroups[0].options[0].asset_ids, []);
  assert.deepEqual(foldedHierarchyGroups[0].options[1].asset_ids.sort(), ["coast.glb", "desert.glb"]);
  assert.equal(foldedHierarchyGroups[0].options[1].evidence.visualAssetSource, "collector-observed-interaction-dependency");
  const tentativeHierarchyGroups = foldNestedVisualVariantGroups([nestedParentGroup, nestedCardGroup], {
    variant_hierarchy: [{
      parentGroupId: nestedParentGroup.id,
      parentOptionId: nestedParentGroup.options[1].id,
      childGroupId: nestedCardGroup.id,
      childOptionIds: nestedCardGroup.options.slice(1, 3).map((option) => option.id),
      confirmed: false,
      source: "collector-observed-interaction-dependency",
    }],
  });
  assert.equal(tentativeHierarchyGroups.length, 2, "a one-off dependency observation must not fold a child control");
  const incompleteRecoveryGroups = foldNestedVisualVariantGroups([nestedParentGroup, nestedCardGroup], {
    variant_recovery: { status: "incomplete" },
    variant_hierarchy: [{
      parentGroupId: nestedParentGroup.id,
      parentOptionId: nestedParentGroup.options[1].id,
      childGroupId: nestedCardGroup.id,
      childOptionIds: nestedCardGroup.options.slice(1, 3).map((option) => option.id),
      confirmed: true,
      source: "collector-observed-causal-interaction-dependency",
    }],
  });
  assert.equal(incompleteRecoveryGroups.length, 2, "confirmed-looking dependencies from an unrecovered run must not fold Source Graph groups");
  const foldedExplicitGroups = foldNestedVisualVariantGroups([nestedParentGroup, nestedCardGroup], {
    variant_asset_associations: [{
      groupId: nestedCardGroup.id,
      optionId: nestedCardGroup.options[0].id,
      optionLabel: nestedCardGroup.options[0].label,
      parentGroupId: nestedParentGroup.id,
      parentOptionId: nestedParentGroup.options[0].id,
      assetUrls: nestedCardGroup.options[0].asset_urls,
    }]
  });
  assert.equal(foldedExplicitGroups.length, 1);
  assert.deepEqual(foldedExplicitGroups[0].options[0].asset_ids, nestedCardGroup.options[0].asset_ids);
  assert.equal(foldedExplicitGroups[0].options[1].asset_ids.length, 0);
  const tentativeAssociationGroups = foldNestedVisualVariantGroups([nestedParentGroup, nestedCardGroup], {
    variant_asset_associations: [{
      groupId: nestedCardGroup.id,
      optionId: nestedCardGroup.options[0].id,
      optionLabel: nestedCardGroup.options[0].label,
      parentGroupId: nestedParentGroup.id,
      parentOptionId: nestedParentGroup.options[0].id,
      assetUrls: nestedCardGroup.options[0].asset_urls,
      dependencyConfirmed: false,
    }]
  });
  assert.equal(tentativeAssociationGroups.length, 2, "tentative parent-context assets must not create hierarchy");
  assert.equal(visualEntriesWithoutAggregateVariants([
    { text: cardVariantGroups[0].title, domOrder: 40000 },
    { text: cardBeatText, domOrder: 40000 },
    { text: "Unrelated visual beat", domOrder: 45000 }
  ], cardVariantGroups).length, 1, "an aggregate visual card beat must be replaced by its variant group");
  assert.equal(inferredAccessibleCardVariantGroups({}, {
    modelBeatAssociations: cardVariantJudgment.modelBeatAssociations.map((association) => ({
      ...association,
      associatedBeats: [{ ...association.associatedBeats[0], text: "Ordinary narrative prose without repeated card labels." }]
    }))
  }, cardVariantManifest).length, 0, "shared inferred models without accessibility-card evidence must remain sequential");

  const twoInstanceSnapshot = JSON.parse(JSON.stringify(directRuntimeSnapshots[0]));
  twoInstanceSnapshot.id = "two-instance-snapshot";
  const secondInstance = JSON.parse(JSON.stringify(twoInstanceSnapshot.runtime3D.models[0]));
  secondInstance.runtimeModelId = "runtime-model-animated-second-instance";
  secondInstance.rootObjectId = "runtime-model-animated-second-instance-root";
  secondInstance.rootName = "animated-second-instance";
  secondInstance.visibleParts[0].nodeId = "second-instance-part";
  secondInstance.visibleParts[0].nodePath = "animated-second-instance[0]/highlight_target_0[0]";
  twoInstanceSnapshot.runtime3D.models = [twoInstanceSnapshot.runtime3D.models[0], secondInstance];
  const twoInstanceBeat = buildBeatRuntimeStates([twoInstanceSnapshot], fixtureRuntimeRelationships)[0];
  assert.equal(twoInstanceBeat.visibleModels.length, 2, "two visible roots sharing one GLB must remain separate runtime instances");

  const textlessBeatStates = buildBeatRuntimeStates([
    { ...directRuntimeSnapshots[0], id: "textless-a", label: "textless-a", activeTexts: [], scrollPercent: 10 },
    { ...directRuntimeSnapshots[0], id: "textless-b", label: "textless-b", activeTexts: [], scrollPercent: 20 }
  ], fixtureRuntimeRelationships);
  assert.equal(textlessBeatStates.length, 2, "textless snapshots must not collapse into one empty beat key");

  const confoundedPlayback = inferRuntimePlaybackMode([
    { elapsedMs: 1000, scrollY: 0, action: { time: 0.1, duration: 2.5, playback: { mode: "unknown" } } },
    { elapsedMs: 1300, scrollY: 500, action: { time: 0.5, duration: 2.5, playback: { mode: "unknown" } } }
  ]);
  assert.equal(confoundedPlayback.mode, "unknown");
  assert.equal(confoundedPlayback.confounded, true);
  const oneStationaryJump = inferRuntimePlaybackMode([
    { elapsedMs: 1000, scrollY: 0, action: { time: 0.1, duration: 2.5, playback: { mode: "unknown" } } },
    { elapsedMs: 1300, scrollY: 0, action: { time: 0.5, duration: 2.5, playback: { mode: "unknown" } } }
  ]);
  assert.equal(oneStationaryJump.mode, "unknown", "one stationary jump can be state-driven and must not prove fixed-time playback");

  const scrollOnlySnapshots = [
    runtimeSnapshotSeed({ id: "scroll-only-1", text: "Scroll beat", scrollY: 0, scrollPercent: 0, elapsedMs: 1000, timeActionTime: 0, scrollActionTime: 0.2, staticVisible: false }),
    runtimeSnapshotSeed({ id: "scroll-only-2", text: "Scroll beat", scrollY: 0, scrollPercent: 0, elapsedMs: 1300, timeActionTime: 0, scrollActionTime: 0.2, staticVisible: false }),
    runtimeSnapshotSeed({ id: "scroll-only-3", text: "Scroll beat", scrollY: 1000, scrollPercent: 50, elapsedMs: 1600, timeActionTime: 0, scrollActionTime: 1.2, staticVisible: false })
  ].map((snapshot, index) => {
    snapshot.runtime3D.models = snapshot.runtime3D.models.slice(0, 1);
    snapshot.runtime3D.models[0].mixers[0].actionStates = snapshot.runtime3D.models[0].mixers[0].actionStates
      .filter((action) => action.actionId === "action-scroll");
    return normalizeSnapshot(snapshot, index);
  });
  const scrollOnlyHints = relationshipHintsForModel(summary, [], scrollOnlySnapshots);
  assert.equal(scrollOnlyHints.runtimePlayback.mode, "scroll-based");
  assert.equal(scrollOnlyHints.scrollDriver.type, "unknown", "runtime samples prove generic scroll playback, not its local/page/slide subtype");

  const mixedAssociation = modelBeatAssociationsForJudgment({
    modelBeatAssociations: [{
      assetUrl: summary.assetUrl,
      associationSource: "direct-source-config",
      associationConfidence: 0.55,
      associatedBeats: [{ text: "Source-only beat", scrollPercent: 75, source: "direct-source-config" }],
      evidenceRefs: ["evidence-source-only"]
    }]
  }, directRuntimeEvidence).find((association) => association.assetFile === summary.file);
  assert.equal(mixedAssociation.associationSource, "mixed");
  assert.deepEqual(mixedAssociation.associationSources, ["direct-runtime", "direct-source-config"]);
  assert.equal(mixedAssociation.associationConfidence, 0.55);
  assert.equal(mixedAssociation.associatedBeats.length, 3);
  assert.equal(mixedAssociation.associatedBeats.at(-1).source, "direct-source-config");
  assert.equal(mixedAssociation.associatedBeats.at(-1).confidence, 0.55);
  assert.equal(mixedAssociation.evidenceRefs.includes("evidence-source-only"), true);

  const longBeatSnapshots = Array.from({ length: 25 }, (_, index) => {
    const snapshot = JSON.parse(JSON.stringify(directRuntimeSnapshots[0]));
    snapshot.id = `long-beat-${index}`;
    snapshot.label = snapshot.id;
    snapshot.elapsedMs = 1000 + index * 100;
    snapshot.activeTexts = [{ text: "Long beat", dataScene: "long-scene" }];
    snapshot.runtime3D.models = index === 12 ? [JSON.parse(JSON.stringify(directRuntimeSnapshots[0].runtime3D.models[0]))] : [];
    return snapshot;
  });
  const longBeatState = buildBeatRuntimeStates(longBeatSnapshots, fixtureRuntimeRelationships)[0];
  assert.equal(longBeatState.sampleCount, 25);
  assert.equal(longBeatState.samples.length, 24);
  assert.equal(longBeatState.visibleModels.length, 1, "a model visible only in a middle sample must survive raw-sample truncation");

  const persistentBeatStates = Array.from({ length: 96 }, (_, index) => ({
    ...JSON.parse(JSON.stringify(directBeatStates[0])),
    beatId: `persistent-beat-${index}`,
    text: `Persistent beat ${index}`,
    scrollRange: [index * 5, index * 5],
    snapshotIds: [`persistent-snapshot-${index}`]
  }));
  const persistentEvidence = {
    relationships: [fixtureRuntimeRelationships[0]],
    runtimeObservation: { beatRuntimeStates: persistentBeatStates, snapshots: [], summary: {} },
    imageAssets: []
  };
  const persistentAssociation = modelBeatAssociationsForJudgment({}, persistentEvidence)[0];
  assert.equal(persistentAssociation.associatedBeats.length, 96, "normalized JSON must retain all direct associations beyond AI/Markdown display limits");
  assert.match(glbBeatAssociationsSection({}, persistentEvidence), /Beat details truncated in Markdown: \+84 more beat/);

  const fingerprintEvidence = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceProbe: { inputPath: "/tmp/first/probe.json", collectorTool: "runtime-animation-collector", collectorVersion: "0.2.0" },
    story: { url: probe.story_url, slug: probe.slug, title: probe.title },
    downloads: [
      { url: summary.assetUrl, finalUrl: summary.assetUrl, assetType: "model", localPath: "/tmp/first/fixture.glb", fileSize: bytes.length, contentHash: sha1Bytes(bytes) },
      { url: staticSummary.assetUrl, finalUrl: staticSummary.assetUrl, assetType: "model", localPath: "/tmp/first/static.glb", fileSize: staticBytes.length, contentHash: sha1Bytes(staticBytes) }
    ],
    failedDownloads: [],
    sourceEvidence: evidence.sourceEvidence,
    glbAnimations: { models: [summary, staticSummary] },
    relationships: fixtureRuntimeRelationships,
    runtimeObservation: { beatRuntimeStates: visuallyAnnotatedBeats },
    visualObservation,
    globalSignals: {
      downloadedCandidateCount: 2,
      animationApiEvidenceCount: 2,
      scrollEvidenceCount: 1,
      runtimeControlEvidenceCount: 2,
      modelSequenceChangeCount: 1,
      visibleModelSequenceChangeCount: 1,
      directRuntime3DSnapshotCount: 4,
      directlyObservedPlayingAnimationCount: 8,
      canvasVisualChangeCount: 3,
      scrollTargetScreenshotCount: 1,
      scrollTargetScreenshotFailureCount: 0
    },
    imageAssets: [],
    imageRelevance: { policy: IMAGE_RELEVANCE_POLICY, acceptedGroups: [], rejectedGroups: [] }
  };
  const baselineFingerprint = judgmentEvidenceFingerprint(fingerprintEvidence);
  const volatileFingerprintEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  volatileFingerprintEvidence.generatedAt = "2030-05-05T05:05:05.000Z";
  volatileFingerprintEvidence.sourceProbe.inputPath = "/another/local/path/probe.json";
  volatileFingerprintEvidence.downloads.reverse();
  volatileFingerprintEvidence.sourceEvidence.reverse();
  volatileFingerprintEvidence.globalSignals.directRuntime3DSnapshotCount = 400;
  volatileFingerprintEvidence.globalSignals.directlyObservedPlayingAnimationCount = 800;
  volatileFingerprintEvidence.globalSignals.canvasVisualChangeCount = 300;
  volatileFingerprintEvidence.downloads.forEach((download) => { download.localPath = `/different/${path.basename(download.localPath)}`; });
  volatileFingerprintEvidence.visualObservation.screenshots[0].localPath = "/different/scroll-target-0001.webp";
  volatileFingerprintEvidence.visualObservation.screenshots[0].contentHash = "different-raw-pixel-bytes";
  volatileFingerprintEvidence.visualObservation.screenshots[0].canvasCrop.localPath = "/different/scroll-target-0001-canvas.webp";
  volatileFingerprintEvidence.visualObservation.screenshots[0].canvasCrop.contentHash = "different-raw-canvas-bytes";
  volatileFingerprintEvidence.visualObservation.contactSheets[0].localPath = "/different/contact-sheet.webp";
  volatileFingerprintEvidence.runtimeObservation.beatRuntimeStates.forEach((beat, beatIndex) => {
    beat.snapshotIds = [`changed-snapshot-${beatIndex}`];
    beat.scrollRange = [12.345 + beatIndex, 67.89 + beatIndex];
    beat.samples = (beat.samples || []).map((sample) => ({ ...sample, elapsedMs: Number(sample.elapsedMs || 0) + 9999 }));
    for (const model of beat.visibleModels || []) {
      for (const action of model.playingAnimations || []) action.timeRange = [99, 100];
    }
  });
  assert.equal(judgmentEvidenceFingerprint(volatileFingerprintEvidence), baselineFingerprint);
  const cachebusterEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  cachebusterEvidence.story.url = `${fingerprintEvidence.story.url}?utm_source=repeat-test`;
  cachebusterEvidence.downloads[0].url = `${cachebusterEvidence.downloads[0].url}?cb=12345`;
  assert.equal(judgmentEvidenceFingerprint(cachebusterEvidence), baselineFingerprint);
  const changedPartEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  changedPartEvidence.runtimeObservation.beatRuntimeStates[0].visibleModels[0].visibleParts[0].name = "different-visible-part";
  assert.notEqual(judgmentEvidenceFingerprint(changedPartEvidence), baselineFingerprint);
  const changedPlaybackEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  changedPlaybackEvidence.runtimeObservation.beatRuntimeStates[0].visibleModels[0].playingAnimations[0].playback.mode = "scroll-based";
  assert.notEqual(judgmentEvidenceFingerprint(changedPlaybackEvidence), baselineFingerprint);
  const changedContentEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  changedContentEvidence.downloads[0].contentHash = "different-content";
  assert.notEqual(judgmentEvidenceFingerprint(changedContentEvidence), baselineFingerprint);
  const changedStoryEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  changedStoryEvidence.story.url = "https://example.com/different-story";
  assert.notEqual(judgmentEvidenceFingerprint(changedStoryEvidence), baselineFingerprint);
  const changedVisualEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  changedVisualEvidence.visualObservation.screenshots[0].perceptualHash = "fedcba9876543210";
  changedVisualEvidence.runtimeObservation.beatRuntimeStates[0].visualEvidence[0].perceptualHash = "fedcba9876543210";
  assert.notEqual(judgmentEvidenceFingerprint(changedVisualEvidence), baselineFingerprint);
  const changedCanvasCropEvidence = JSON.parse(JSON.stringify(fingerprintEvidence));
  changedCanvasCropEvidence.visualObservation.screenshots[0].canvasCrop.perceptualHash = "7766554433221100";
  changedCanvasCropEvidence.runtimeObservation.beatRuntimeStates[0].visualEvidence[0].canvasCrop.perceptualHash = "7766554433221100";
  assert.notEqual(judgmentEvidenceFingerprint(changedCanvasCropEvidence), baselineFingerprint);

  const cachePath = path.join(tempDir, "cache", "judgment.json");
  const cachedPayload = { storyTitle: "Cached fixture", uncertainties: ["b", "a"] };
  await writeCachedCodexJudgment(cachePath, baselineFingerprint, cachedPayload);
  assert.deepEqual(await readCachedCodexJudgment(cachePath, baselineFingerprint), cachedPayload);
  assert.equal(await readCachedCodexJudgment(cachePath, "wrong-fingerprint"), null);
  const refreshedPayload = { storyTitle: "Refreshed fixture", uncertainties: [] };
  await writeCachedCodexJudgment(cachePath, baselineFingerprint, refreshedPayload, { replace: true });
  assert.deepEqual(await readCachedCodexJudgment(cachePath, baselineFingerprint), refreshedPayload);
  const corruptCachePath = path.join(tempDir, "cache", "corrupt.json");
  await fs.writeFile(corruptCachePath, "{not-json", "utf8");
  assert.equal(await readCachedCodexJudgment(corruptCachePath, baselineFingerprint), null);
  await writeCachedCodexJudgment(corruptCachePath, baselineFingerprint, cachedPayload);
  assert.deepEqual(await readCachedCodexJudgment(corruptCachePath, baselineFingerprint), cachedPayload);
  const sanitizedCachePayload = sanitizeCodexJudgmentForCache({
    investigationSummary: { resourcesInspected: "not-an-array", remainingGaps: [] },
    overallSummary: `Inspected ${fingerprintEvidence.downloads[0].localPath} and ${fingerprintEvidence.visualObservation.screenshots[0].localPath}`,
    beatRuntimeStates: [{ stale: true }]
  }, fingerprintEvidence);
  assert.deepEqual(sanitizedCachePayload.investigationSummary.resourcesInspected, []);
  assert.doesNotMatch(sanitizedCachePayload.overallSummary, /\/tmp\/first/);
  assert.doesNotMatch(sanitizedCachePayload.overallSummary, /scroll-target-screenshots/);
  assert.equal("beatRuntimeStates" in sanitizedCachePayload, false);

  const unorderedJudgment = {
    assetJudgments: [
      { assetUrl: staticSummary.assetUrl, assetFile: staticSummary.file, evidenceRefs: ["b", "a", "b"] },
      { assetUrl: summary.assetUrl, assetFile: summary.file, evidenceRefs: ["z", "y"] }
    ],
    relationshipJudgments: [
      { relationshipId: "relationship-02", assetUrl: staticSummary.assetUrl },
      { relationshipId: "relationship-01", assetUrl: summary.assetUrl }
    ],
    uncertainties: ["second", "first", "second"]
  };
  const reversedJudgment = {
    ...unorderedJudgment,
    assetJudgments: [...unorderedJudgment.assetJudgments].reverse().map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs].reverse() })),
    relationshipJudgments: [...unorderedJudgment.relationshipJudgments].reverse(),
    uncertainties: [...unorderedJudgment.uncertainties].reverse()
  };
  const canonicalEvidence = { ...directRuntimeEvidence, imageAssets: [], story: fingerprintEvidence.story };
  assert.equal(
    JSON.stringify(canonicalObjectKeys(normalizeJudgmentForEvidence(unorderedJudgment, canonicalEvidence))),
    JSON.stringify(canonicalObjectKeys(normalizeJudgmentForEvidence(reversedJudgment, canonicalEvidence)))
  );

  assert.equal(relationshipLooksPreloaded(fixtureRuntimeRelationships[0], {
    relationships: fixtureRuntimeRelationships,
    runtimeObservation: evidence.runtimeObservation
  }), true);
  const unavailableSnapshot = normalizeSnapshot({
    id: "unavailable-runtime",
    scrollY: 0,
    scrollPercent: 0,
    activeTexts: [{ text: "Unavailable beat" }],
    modelUrls: [summary.assetUrl],
    runtime3D: { captureStatus: "unavailable", reason: "Three.js namespace is not exposed.", models: [] }
  }, 0);
  assert.equal(unavailableSnapshot.runtime3D.captureStatus, "unavailable");
  assert.equal(normalizeSnapshot(probe.snapshots[0], 0).runtime3D, null);
  const observedEmptySnapshots = [
    normalizeSnapshot({
      id: "observed-empty-1",
      elapsedMs: 1000,
      scrollY: 0,
      scrollPercent: 0,
      activeTexts: [{ text: "Observed empty beat" }],
      modelUrls: [summary.assetUrl, staticSummary.assetUrl],
      runtime3D: { captureStatus: "ok", reason: "Scene was observed with no model roots.", assetCoverageComplete: true, models: [] }
    }, 0),
    normalizeSnapshot({
      id: "observed-empty-2",
      elapsedMs: 1200,
      scrollY: 0,
      scrollPercent: 0,
      activeTexts: [{ text: "Observed empty beat" }],
      modelUrls: [summary.assetUrl, staticSummary.assetUrl],
      runtime3D: { captureStatus: "ok", reason: "Scene was observed with no model roots.", assetCoverageComplete: true, models: [] }
    }, 1)
  ];
  const observedEmptyHints = relationshipHintsForModel(summary, evidence.sourceEvidence, observedEmptySnapshots);
  const observedEmptyRelationship = {
    id: "relationship-empty",
    assetUrl: summary.assetUrl,
    assetFile: summary.file,
    hasEmbeddedAnimation: true,
    hints: observedEmptyHints
  };
  const observedEmptyEvidence = {
    relationships: [observedEmptyRelationship, fixtureRuntimeRelationships[1]],
    runtimeObservation: {
      snapshots: observedEmptySnapshots,
      summary: summarizeRuntime(observedEmptySnapshots),
      beatRuntimeStates: buildBeatRuntimeStates(observedEmptySnapshots, [observedEmptyRelationship, fixtureRuntimeRelationships[1]])
    }
  };
  assert.equal(observedEmptyHints.runtimePresence.snapshotCount, 0);
  assert.equal(observedEmptyHints.runtimeVisibility.authoritativeCaptureAvailable, true);
  assert.equal(relationshipLooksPreloaded(observedEmptyRelationship, observedEmptyEvidence), false);
  const observedEmptyAssociation = modelBeatAssociationsForJudgment({}, observedEmptyEvidence)[0];
  assert.equal(observedEmptyAssociation.associationSource, "unknown");
  assert.equal(observedEmptyAssociation.associatedBeats.length, 0);
  const collisionRelationships = [
    { id: "collision-a", assetUrl: "https://example.com/a/model.glb", assetFile: "model-a.glb" },
    { id: "collision-b", assetUrl: "https://example.com/b/model.glb", assetFile: "model-b.glb" }
  ];
  assert.equal(relationshipForRuntimeModel(collisionRelationships, { assetUrl: "https://example.com/a/model.glb" })?.id, "collision-a");
  assert.equal(relationshipForRuntimeModel(collisionRelationships, { assetUrl: "https://example.com/c/model.glb" }), null);
  const queryVariantRelationships = [
    { id: "query-a", assetUrl: "https://example.com/model.glb?scene=1", assetFile: "model.glb" },
    { id: "query-b", assetUrl: "https://example.com/model.glb?scene=2", assetFile: "model.glb" }
  ];
  assert.equal(relationshipForRuntimeModel(queryVariantRelationships, { assetUrl: "https://example.com/model.glb?scene=2" })?.id, "query-b");
  assert.equal(relationshipForRuntimeModel(queryVariantRelationships, { assetUrl: "https://example.com/model.glb" }), null);
  assert.equal(relationshipForAssetItem({ relationships: queryVariantRelationships }, { relationshipId: "query-b", assetFile: "model.glb" })?.id, "query-b");
  assert.equal(relationshipForAssetItem({ relationships: queryVariantRelationships }, { assetFile: "model.glb" }), null);

  const directRuntimeSummary = summaryMarkdownFromJudgment(
    { storyTitle: "Runtime Fixture", beatRuntimeStates: directBeatStates },
    {
      story: { title: "Runtime Fixture", slug: "runtime-fixture" },
      relationships: fixtureRuntimeRelationships,
      runtimeObservation: directRuntimeEvidence.runtimeObservation,
      imageAssets: []
    }
  );
  assert.match(directRuntimeSummary, /## Beat Runtime State/);
  assert.match(directRuntimeSummary, /On-canvas render-eligible GLB fixture\.glb/);
  assert.match(directRuntimeSummary, /Render-eligible parts: highlight_target_0/);
  assert.match(directRuntimeSummary, /Playing TimeClip: .*driver=time-based/);
  assert.match(directRuntimeSummary, /Playing ScrollClip: .*driver=scroll-based/);
  assert.match(directRuntimeSummary, /static-fixture\.glb: runtime-driven\/no embedded animation/);
  const normalizedDirectJudgment = normalizeJudgmentForEvidence(
    {
      storyTitle: "Runtime Fixture",
      summaryMarkdown: "## Beat Runtime State\n- stale runtime text",
      assetJudgments: [{
        assetUrl: staticSummary.assetUrl,
        assetFile: staticSummary.file,
        hasEmbeddedAnimation: false,
        classification: "within-beat-dynamics",
        associatedBeats: [{ text: "Second beat", scrollPercent: 50, source: "direct-runtime" }]
      }]
    },
    {
      ...directRuntimeEvidence,
      story: { title: "Runtime Fixture", slug: "runtime-fixture" },
      imageAssets: []
    }
  );
  assert.equal(normalizedDirectJudgment.beatRuntimeStates.length, 2);
  assert.equal(normalizedDirectJudgment.assetJudgments.some((item) => item.assetFile === staticSummary.file), true);
  assert.equal(normalizedDirectJudgment.glbAnimationInterpretations.some((item) => item.assetFile === staticSummary.file), true);

  const inferredOnlyEvidence = {
    story: { title: "Inferred Fixture", slug: "inferred-fixture" },
    relationships: [fixtureRuntimeRelationships[0]],
    runtimeObservation: { summary: evidence.runtimeObservation.summary, snapshots: evidence.runtimeObservation.snapshots, beatRuntimeStates: [] },
    imageAssets: []
  };
  const inferredOnlyJudgment = normalizeJudgmentForEvidence({
    modelBeatAssociations: [{
      relationshipId: "relationship-01",
      assetUrl: summary.assetUrl,
      associatedBeats: [{ beatId: "source-beat-1", text: "Source beat", scrollPercent: 25, source: "direct-source-config" }],
      associationSource: "direct-source-config",
      associationConfidence: 0.82
    }],
    inferredBeatAssetStates: [{
      relationshipId: "relationship-01",
      beatId: "source-beat-1",
      text: "Source beat",
      visibilityState: "visible",
      provenance: "direct-source-config",
      confidence: 0.82,
      parts: [{ name: "source_part", visibilityState: "visible", provenance: "direct-source-config", confidence: 0.8 }],
      animations: [{ clipIndex: 0, clipName: "Take 001", playState: "playing", driverMode: "scroll-based", scrollDriverType: "local-scroll-window-progress", provenance: "direct-source-config", confidence: 0.78 }]
    }]
  }, inferredOnlyEvidence);
  assert.equal(inferredOnlyJudgment.inferredBeatAssetStates.length, 1);
  assert.equal(inferredOnlyJudgment.inferredBeatAssetStates[0].parts[0].name, "source_part");
  assert.equal(inferredOnlyJudgment.inferredBeatAssetStates[0].animations[0].driverMode, "scroll-based");
  const highConfidenceInferredInput = {
    modelBeatAssociations: [{
      relationshipId: "relationship-01",
      assetUrl: summary.assetUrl,
      associatedBeats: [{ beatId: "inferred-beat", text: "Inferred beat", source: "inferred-source" }],
      associationSource: "inferred-source",
      associationConfidence: 0.99
    }]
  };
  const noVisualCappedAssociation = modelBeatAssociationsForJudgment(highConfidenceInferredInput, inferredOnlyEvidence)[0];
  assert.equal(noVisualCappedAssociation.associationConfidence, 0.72);
  assert.equal(noVisualCappedAssociation.confidenceCalibration.reason, "no-direct-runtime-or-visual-identity");
  const visualCappedAssociation = modelBeatAssociationsForJudgment(highConfidenceInferredInput, {
    ...inferredOnlyEvidence,
    globalSignals: { scrollTargetScreenshotCount: 1 },
    visualObservation
  })[0];
  assert.equal(visualCappedAssociation.associationConfidence, 0.85);
  assert.equal(visualCappedAssociation.confidenceCalibration.reason, "visual-without-direct-runtime-identity");
  const canonicallySortedInferredStates = sortInferredBeatAssetStates([
    { relationshipId: "relationship-02", beatId: directBeatStates[1].beatId, text: directBeatStates[1].text },
    { relationshipId: "relationship-01", beatId: directBeatStates[1].beatId, text: directBeatStates[1].text },
    { relationshipId: "relationship-01", beatId: directBeatStates[0].beatId, text: directBeatStates[0].text }
  ], directRuntimeEvidence);
  assert.deepEqual(canonicallySortedInferredStates.map((state) => [state.relationshipId, state.beatId]), [
    ["relationship-01", directBeatStates[0].beatId],
    ["relationship-01", directBeatStates[1].beatId],
    ["relationship-02", directBeatStates[1].beatId]
  ]);

  const incompleteBeat = JSON.parse(JSON.stringify(directBeatStates[0]));
  incompleteBeat.visibleModels[0].mixerCount = 0;
  incompleteBeat.visibleModels[0].actionStates = [];
  incompleteBeat.visibleModels[0].playingAnimations = [];
  incompleteBeat.visibleModels[0].actionStatesTruncated = false;
  const incompleteEvidence = {
    story: { title: "Incomplete Runtime Fixture", slug: "incomplete-runtime" },
    relationships: [fixtureRuntimeRelationships[0]],
    runtimeObservation: { summary: {}, snapshots: [], beatRuntimeStates: [incompleteBeat] },
    imageAssets: []
  };
  const incompleteJudgment = normalizeJudgmentForEvidence({
    inferredBeatAssetStates: [{
      relationshipId: "relationship-01",
      beatId: incompleteBeat.beatId,
      text: incompleteBeat.text,
      provenance: "inferred-source",
      animations: [{ clipIndex: 0, clipName: "Take 001", playState: "playing", driverMode: "time-based", provenance: "inferred-source", confidence: 0.6 }]
    }]
  }, incompleteEvidence);
  assert.equal(incompleteJudgment.inferredBeatAssetStates.length, 1);
  assert.equal(incompleteJudgment.inferredBeatAssetStates[0].supplementsDirectRuntime, true);
  assert.equal(incompleteJudgment.inferredBeatAssetStates[0].directFieldCoverage.modelVisibility, true);
  assert.equal(incompleteJudgment.inferredBeatAssetStates[0].directFieldCoverage.actionsComplete, false);

  const partsOnlyBeat = JSON.parse(JSON.stringify(directBeatStates[0]));
  partsOnlyBeat.visibleModels[0].visibleParts = [];
  partsOnlyBeat.visibleModels[0].visiblePartTruncated = true;
  const partsOnlyEvidence = {
    story: { title: "Parts-only Supplement", slug: "parts-only-supplement" },
    relationships: [fixtureRuntimeRelationships[0]],
    runtimeObservation: { summary: {}, snapshots: [], beatRuntimeStates: [partsOnlyBeat] },
    imageAssets: []
  };
  const partsOnlyJudgment = normalizeJudgmentForEvidence({
    inferredBeatAssetStates: [{
      relationshipId: "relationship-01",
      beatId: partsOnlyBeat.beatId,
      text: partsOnlyBeat.text,
      provenance: "inferred-source",
      parts: [{ name: "inferred_missing_part", visibilityState: "visible", provenance: "inferred-source" }],
      animations: [{ clipName: "ShouldNotOverride", playState: "playing", driverMode: "scroll-based", provenance: "inferred-source" }]
    }]
  }, partsOnlyEvidence);
  assert.equal(partsOnlyJudgment.inferredBeatAssetStates[0].parts[0].name, "inferred_missing_part");
  assert.equal(partsOnlyJudgment.inferredBeatAssetStates[0].animations.length, 0, "complete direct mixer/action state must suppress inferred animations in a parts-only supplement");

  const hiddenContradictionJudgment = normalizeJudgmentForEvidence({
    modelBeatAssociations: [{
      relationshipId: "relationship-02",
      assetUrl: staticSummary.assetUrl,
      associatedBeats: [{ beatId: introRuntimeBeat.beatId, text: "Intro beat", scrollPercent: 0, source: "inferred-source" }]
    }],
    inferredBeatAssetStates: [{
      relationshipId: "relationship-02",
      beatId: introRuntimeBeat.beatId,
      text: "Intro beat",
      visibilityState: "visible",
      provenance: "inferred-source"
    }]
  }, { ...directRuntimeEvidence, story: { title: "Hidden Fixture", slug: "hidden-fixture" }, imageAssets: [] });
  assert.equal(hiddenContradictionJudgment.inferredBeatAssetStates.some((state) => state.relationshipId === "relationship-02" && state.beatId === introRuntimeBeat.beatId), false);

  const observedAbsentInference = normalizeJudgmentForEvidence({
    modelBeatAssociations: [{
      relationshipId: "relationship-empty",
      assetUrl: summary.assetUrl,
      associatedBeats: [{ beatId: observedEmptyEvidence.runtimeObservation.beatRuntimeStates[0].beatId, text: "Observed empty beat", source: "inferred-source" }]
    }],
    inferredBeatAssetStates: [{
      relationshipId: "relationship-empty",
      beatId: observedEmptyEvidence.runtimeObservation.beatRuntimeStates[0].beatId,
      text: "Observed empty beat",
      visibilityState: "visible",
      provenance: "inferred-source"
    }]
  }, { ...observedEmptyEvidence, story: { title: "Observed Empty", slug: "observed-empty" }, imageAssets: [] });
  assert.equal(observedAbsentInference.inferredBeatAssetStates.length, 0);

  const replacedDirectRuntimeSummary = summaryMarkdownFromJudgment(normalizedDirectJudgment, {
    ...directRuntimeEvidence,
    story: { title: "Runtime Fixture", slug: "runtime-fixture" },
    imageAssets: []
  });
  assert.doesNotMatch(replacedDirectRuntimeSummary, /stale runtime text/);
  assert.match(replacedDirectRuntimeSummary, /## Beat Runtime State/);
  const staleLegacySummary = summaryMarkdownFromJudgment({
    storyTitle: "Legacy Fixture",
    summaryMarkdown: "## Beat Runtime State\n- stale one\n\n## Beat Runtime State\n- stale two"
  }, {
    story: { title: "Legacy Fixture", slug: "legacy-fixture" },
    relationships: [],
    runtimeObservation: { summary: {}, snapshots: [], beatRuntimeStates: [] },
    imageAssets: []
  });
  assert.doesNotMatch(staleLegacySummary, /stale one|stale two|## Beat Runtime State/);

  const summaryWithGlbJudgment = summaryMarkdownFromJudgment(
    {
      storyTitle: "Test Story",
      dominantLogic: "inter-beat-dynamics",
      confidence: 0.8,
      overallSummary: "Test summary.",
      summaryMarkdown: "Dominant logic: inter-beat-dynamics.",
      assetJudgments: [
        {
          assetUrl: summary.assetUrl,
          assetFile: summary.file,
          hasEmbeddedAnimation: true,
          classification: "inter-beat-dynamics",
          scrollDriver: hints.scrollDriver,
          confidence: 0.8,
          reasoning: "The animated GLB crosses caption-defined beats.",
          evidenceRefs: hints.evidenceRefIds
        }
      ],
      relationshipJudgments: [],
      investigationSummary: {
        resourcesInspected: ["downloads/scripts/build.js"],
        behaviorTrace: {
          modelDiscovery: "Fixture GLB was referenced from source evidence.",
          modelLoading: "Fixture GLB was parsed as a model summary.",
          visibilityOrSwap: "No visible swap was observed.",
          animationDriver: "Scroll evidence drove the animation.",
          multipleGlbHandling: "Only one fixture GLB was present."
        },
        directEvidence: "Self-test fixture evidence.",
        remainingGaps: []
      },
      uncertainties: []
    },
    {
      story: { title: "Test Story", slug: "test-story" },
      relationships: [
        {
          id: "relationship-01",
          assetUrl: summary.assetUrl,
          assetFile: summary.file,
          hasEmbeddedAnimation: true,
          hints
        },
        {
          id: "relationship-02",
          assetUrl: staticSummary.assetUrl,
          assetFile: staticSummary.file,
          hasEmbeddedAnimation: false,
          hints: staticHints
        }
      ],
      runtimeObservation: evidence.runtimeObservation
    }
  );
  const animatingSection = summaryWithGlbJudgment.match(/## Animating GLB Judgments\n([\s\S]*?)(?:\n## |$)/)?.[1] || "";
  const staticAssociationLine = summaryWithGlbJudgment
    .split("\n")
    .find((line) => line.includes("static-fixture.glb")) || "";
  assert.match(summaryWithGlbJudgment, /## Animating GLB Judgments/);
  assert.match(summaryWithGlbJudgment, /fixture\.glb: inter-beat-dynamics/);
  assert.doesNotMatch(animatingSection, /static-fixture\.glb/);
  assert.match(summaryWithGlbJudgment, /## GLB Beat Associations/);
  assert.match(summaryWithGlbJudgment, /fixture\.glb: animated GLB/);
  assert.match(summaryWithGlbJudgment, /static-fixture\.glb: no embedded animation observed/);
  assert.match(staticAssociationLine, /source=inferred-preload-based/);
  assert.doesNotMatch(staticAssociationLine, /within-beat-dynamics|inter-beat-dynamics|ambient-object-motion|asset-topology-transition/);
  assert.match(animatingSection, /Beat 1 @ 0% \[inferred-preload-based\]: Intro beat/);
  assert.match(animatingSection, /Beat 2 @ 50% \[inferred-preload-based\]: Second beat/);
  assert.match(summaryWithGlbJudgment, /Beat 1 @ 0% \[inferred-preload-based\]: Intro beat/);
  assert.match(summaryWithGlbJudgment, /Beat 2 @ 50% \[inferred-preload-based\]: Second beat/);
  assert.match(summaryWithGlbJudgment, /## Investigation Notes/);
  assert.match(summaryWithGlbJudgment, /downloads\/scripts\/build\.js/);

  const summaryWithTerseCodexSections = summaryMarkdownFromJudgment(
    {
      storyTitle: "Test Story",
      dominantLogic: "inter-beat-dynamics",
      confidence: 0.8,
      overallSummary: "Test summary.",
      summaryMarkdown: [
        "## Animating GLB Judgments",
        "- fixture.glb: terse dynamic note.",
        "",
        "## GLB Beat Associations",
        "- static-fixture.glb: terse association note.",
        "",
        "## Investigation Notes",
        "- Existing investigation note."
      ].join("\n"),
      assetJudgments: [
        {
          assetUrl: summary.assetUrl,
          assetFile: summary.file,
          hasEmbeddedAnimation: true,
          classification: "inter-beat-dynamics",
          scrollDriver: hints.scrollDriver,
          confidence: 0.8,
          reasoning: "The animated GLB crosses caption-defined beats.",
          evidenceRefs: hints.evidenceRefIds
        }
      ],
      relationshipJudgments: [],
      modelBeatAssociations: [
        {
          assetUrl: staticSummary.assetUrl,
          assetFile: staticSummary.file,
          hasEmbeddedAnimation: false,
          associatedBeats: [{ text: "Intro beat", scrollPercent: 0, source: "direct" }],
          associationConfidence: 0.9,
          associationSource: "direct",
          reasoning: "Static fixture is directly associated with the intro beat.",
          evidenceRefs: staticHints.evidenceRefIds
        }
      ],
      investigationSummary: {
        resourcesInspected: [],
        behaviorTrace: {},
        directEvidence: "",
        remainingGaps: []
      },
      uncertainties: []
    },
    {
      story: { title: "Test Story", slug: "test-story" },
      relationships: [
        {
          id: "relationship-01",
          assetUrl: summary.assetUrl,
          assetFile: summary.file,
          hasEmbeddedAnimation: true,
          hints
        },
        {
          id: "relationship-02",
          assetUrl: staticSummary.assetUrl,
          assetFile: staticSummary.file,
          hasEmbeddedAnimation: false,
          hints: staticHints
        }
      ],
      runtimeObservation: evidence.runtimeObservation
    }
  );
  assert.doesNotMatch(summaryWithTerseCodexSections, /terse association note/);
  assert.match(summaryWithTerseCodexSections, /static-fixture\.glb: no embedded animation observed/);
  assert.match(summaryWithTerseCodexSections, /Beat 1 @ 0% \[inferred-source\]: Intro beat/);
  assert.doesNotMatch(summaryWithTerseCodexSections, /Existing investigation note|## Investigation Notes/);

  const imageAssets = imageAssetsForProbe(probe);
  assert.equal(imageAssets.length, 1);

  const normalizedJudgment = normalizeJudgmentForEvidence(
    {
      assetJudgments: [
        {
          assetUrl: summary.assetUrl,
          assetFile: summary.file,
          hasEmbeddedAnimation: true,
          classification: "inter-beat-dynamics",
          associatedBeats: [{ text: "Intro beat", scrollPercent: 0, source: "direct" }]
        },
        {
          assetUrl: staticSummary.assetUrl,
          assetFile: staticSummary.file,
          hasEmbeddedAnimation: false,
          classification: "inter-beat-dynamics",
          associatedBeats: [{ text: "Intro beat", scrollPercent: 0, source: "direct" }]
        }
      ],
      imageBeatAssociations: [
        {
          imageGroupId: "image-group-1",
          assetUrl: "https://example.com/mars-image.jpg",
          associatedBeats: [{ text: "Mars image caption", scrollPercent: null, source: "direct" }],
          associationConfidence: 0.9,
          associationSource: "direct",
          reasoning: "The accepted image group caption directly supplies its source beat.",
          evidenceRefs: ["evidence-image-1"]
        }
      ]
    },
    {
      relationships: [
        {
          id: "relationship-01",
          assetUrl: summary.assetUrl,
          assetFile: summary.file,
          hasEmbeddedAnimation: true,
          hints
        },
        {
          id: "relationship-02",
          assetUrl: staticSummary.assetUrl,
          assetFile: staticSummary.file,
          hasEmbeddedAnimation: false,
          hints: staticHints
        }
      ],
      imageAssets,
      runtimeObservation: evidence.runtimeObservation
    }
  );
  assert.equal(normalizedJudgment.assetJudgments.length, 1);
  assert.equal(normalizedJudgment.modelBeatAssociations.length, 2);
  assert.equal(normalizedJudgment.imageBeatAssociations.length, 1);
  assert.equal(normalizedJudgment.imageBeatAssociations[0].associationSource, "direct");
  assert.equal(normalizedJudgment.glbAnimationInterpretations.length, 1);
  assert.equal(normalizedJudgment.glbAnimationInterpretations[0].triggerMapping.type, "local-scroll-window-progress");
  assert.equal(normalizedJudgment.modelBeatAssociations.find((item) => item.assetFile === staticSummary.file)?.hasEmbeddedAnimation, false);

  const authorEvidence = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceProbe: {
      inputPath: "probe.json",
      collectorTool: "runtime-animation-collector",
      collectorVersion: VERSION,
      collectorHash: "fixture"
    },
    story: {
      url: probe.story_url,
      slug: probe.slug,
      title: probe.title
    },
    runtimeObservation: evidence.runtimeObservation,
    downloads: [
      {
        url: summary.assetUrl,
        finalUrl: summary.finalUrl,
        assetType: "model",
        localPath: fixturePath,
        contentType: "model/gltf-binary",
        fileSize: bytes.length
      },
      {
        url: staticSummary.assetUrl,
        finalUrl: staticSummary.finalUrl,
        assetType: "model",
        localPath: staticFixturePath,
        contentType: "model/gltf-binary",
        fileSize: staticBytes.length
      },
      {
        url: "https://example.com/mars-image.jpg",
        finalUrl: "https://example.com/mars-image.jpg",
        assetType: "image",
        localPath: imageFixturePath,
        contentType: "image/jpeg",
        fileSize: imageBytes.length
      }
    ],
    glbAnimations: {
      modelCount: 2,
      animatedModelCount: 1
    },
    imageAssets,
    relationships: [
      {
        id: "relationship-01",
        assetUrl: summary.assetUrl,
        assetFile: summary.file,
        hasEmbeddedAnimation: true,
        hints
      },
      {
        id: "relationship-02",
        assetUrl: staticSummary.assetUrl,
        assetFile: staticSummary.file,
        hasEmbeddedAnimation: false,
        hints: staticHints
      }
    ]
  };
  const authorInputRoot = path.join(tempDir, "story", "captures", "active");
  const authorInput = await writeAuthorInput(
    probe,
    path.join(tempDir, "probe.json"),
    tempDir,
    authorEvidence,
    normalizedJudgment,
    { authorInputFolder: authorInputRoot }
  );
  const authorStructure = await readJson(authorInput.storyStructurePath);
  const authorManifest = await readJson(authorInput.assetManifestPath);
  assert.equal(authorManifest.length, 3);
  assert.equal(authorStructure.slides.length, 2);
  const modelSlide = authorStructure.slides.find((item) => /models\/fixture\.glb/.test(item.file));
  const imageSlide = authorStructure.slides.find((item) => /textures\/mars-image\.jpg/.test(item.file));
  assert.match(modelSlide?.file || "", /models\/static-fixture\.glb/);
  assert.equal(imageSlide?.category, "animation_probe_image_beat");
  assert.equal(imageSlide?.text, "Mars image caption");
  assert.deepEqual(imageSlide?.attributes?.probeAssociationSources, ["direct"]);
  assert.equal(authorStructure.headings[0].text, "Section One");
  assert.equal(authorStructure.image_groups.length, 1);
  assert.equal(authorStructure.image_groups[0].caption.text, "Mars image caption");
  assert.equal(authorStructure.image_groups[0].credits[0].text, "NASA/JPL-Caltech");
  assert.equal(authorStructure.text_only_parts.some((item) => item.text === "Second beat"), true);
  assert.equal(authorStructure.text_only_parts.some((item) => item.text === "Section One"), false);
  assert.equal(authorStructure.text_only_parts.some((item) => item.text === "Mars image caption"), false);
  assert.equal(authorStructure.text_only_parts.some((item) => item.text === "NASA/JPL-Caltech"), false);
  const imageManifestRecord = authorManifest.find((item) => item.source_image_group_id === "image-group-1");
  assert.equal(imageManifestRecord?.asset_type, "texture");
  assert.equal(imageManifestRecord?.caption?.text, "Mars image caption");
  assert.equal(imageManifestRecord?.credits?.[0]?.text, "NASA/JPL-Caltech");
  assert.match(imageManifestRecord?.local_path || "", /textures\/mars-image\.jpg/);
  assert.equal(await exists(path.join(authorInputRoot, "models", "fixture.glb")), true);
  assert.equal(await exists(path.join(authorInputRoot, "textures", "mars-image.jpg")), true);
  assert.equal(await exists(path.join(authorInputRoot, "metadata", "asset_manifest.json")), true);

  const marsStoryUrl = "https://www.nytimes.com/interactive/2018/05/01/science/mars-nasa-insight-ar-3d-ul.html";
  const marsIconUrl = "https://static01.nyt.com/images/icons/ios-ipad-144x144.png";
  const marsOlympicsUrl = "https://static01.nyt.com/images/2018/02/06/sports/olympics/05-NYT-AR-oly-ar-promo-container/05-NYT-AR-oly-ar-promo-container-master315-v4.jpg";
  const marsPromoUrl = "https://static01.nyt.com/images/2018/05/01/science/exploring-mars-ar-3d-ul-1525117240747/exploring-mars-ar-3d-ul-1525117240747-facebookJumbo.jpg";
  const marsCoverUrl = "https://static01.nyt.com/newsgraphics/2018/04/16/ar-mars/ae4ff39e442c991137ff32aa96a8e4d0634145af/Mars_desktopCover_1600.jpg";
  const marsVikingUrl = "https://static01.nyt.com/newsgraphics/2018/04/16/ar-mars/ae4ff39e442c991137ff32aa96a8e4d0634145af/viking1.jpg";
  const marsProbe = {
    story_url: marsStoryUrl,
    slug: "mars-nasa-insight-ar-3d-ul",
    title: "Augmented Reality: Explore NASA's InSight Mission on Mars",
    storyvr_author_input: {
      image_groups: [
        {
          id: "image-group-root",
          category: "image_group",
          selector: "html.desktop.page-interactive.section-science",
          tag: "html",
          className: "desktop page-interactive section-science",
          domOrder: 0,
          image: {
            url: marsIconUrl,
            allUrls: [marsIconUrl, marsOlympicsUrl, marsPromoUrl],
            srcset: []
          },
          caption: { text: "Ticker tape image of Mars, colored by NASA engineers." },
          credits: [{ text: "NASA/JPL-Caltech/Dan Goods" }]
        },
        {
          id: "image-group-cover",
          category: "image_group",
          selector: "img.g-mobile.g-image-ready",
          tag: "img",
          className: "g-mobile g-image-ready",
          domOrder: 1,
          image: {
            url: marsCoverUrl,
            allUrls: [marsCoverUrl],
            srcset: []
          }
        },
        {
          id: "image-group-viking",
          category: "image_group",
          selector: "div.g-item.g-item-body.g-image",
          tag: "div",
          className: "g-item g-item-body g-image",
          domOrder: 5000,
          image: {
            url: marsVikingUrl,
            allUrls: [marsVikingUrl],
            srcset: []
          },
          caption: { text: "The first photograph taken on the surface of Mars, by Viking 1 on July 20, 1976." },
          credits: [{ text: "NASA/JPL" }]
        }
      ],
      text_units: []
    }
  };
  const marsImageSummary = imageRelevanceSummaryForProbe(marsProbe);
  assert.equal(marsImageSummary.rawImageGroupCount, 3);
  assert.equal(marsImageSummary.acceptedImageGroupCount, 2);
  assert.equal(marsImageSummary.rejectedImageGroupCount, 1);
  assert.equal(marsImageSummary.rejectedGroups[0].id, "image-group-root");
  assert(marsImageSummary.rejectedUrls.some((item) => item.url === marsIconUrl));
  assert(marsImageSummary.rejectedUrls.some((item) => item.url === marsOlympicsUrl));
  const marsAcceptedGroups = authorInputImageGroupsFromProbe(marsProbe);
  assert.deepEqual(marsAcceptedGroups.map((group) => group.id), ["image-group-cover", "image-group-viking"]);

  const marsAuthorInputRoot = path.join(tempDir, "mars-story", "captures", "active");
  const marsAuthorInput = await writeAuthorInput(
    marsProbe,
    path.join(tempDir, "mars-probe.json"),
    tempDir,
    {
      generatedAt: "2026-01-01T00:00:00.000Z",
      story: {
        url: marsStoryUrl,
        slug: "mars-nasa-insight-ar-3d-ul",
        title: marsProbe.title
      },
      downloads: [
        { url: marsIconUrl, finalUrl: marsIconUrl, assetType: "image", localPath: marsIconFixturePath, contentType: "image/png", fileSize: 10 },
        { url: marsOlympicsUrl, finalUrl: marsOlympicsUrl, assetType: "image", localPath: marsOlympicsFixturePath, contentType: "image/jpeg", fileSize: 10 },
        { url: marsCoverUrl, finalUrl: marsCoverUrl, assetType: "image", localPath: marsCoverFixturePath, contentType: "image/jpeg", fileSize: 10 },
        { url: marsVikingUrl, finalUrl: marsVikingUrl, assetType: "image", localPath: marsVikingFixturePath, contentType: "image/jpeg", fileSize: 10 }
      ],
      runtimeObservation: { summary: {}, snapshots: [] },
      glbAnimations: { modelCount: 0, animatedModelCount: 0 },
      relationships: []
    },
    { modelBeatAssociations: [] },
    { authorInputFolder: marsAuthorInputRoot }
  );
  const marsAuthorStructure = await readJson(marsAuthorInput.storyStructurePath);
  const marsAuthorManifest = await readJson(marsAuthorInput.assetManifestPath);
  assert.deepEqual(marsAuthorStructure.image_groups.map((group) => group.id), ["image-group-cover", "image-group-viking"]);
  assert.equal(marsAuthorManifest.length, 2);
  assert.equal(marsAuthorManifest.some((item) => /ios|icon|homescreen|05-NYT-AR-oly|video-default/i.test(item.local_path || "")), false);
  assert.equal(marsAuthorManifest.some((item) => item.source_image_group_id === "image-group-root"), false);
  assert.equal(marsAuthorManifest.find((item) => item.source_image_group_id === "image-group-viking")?.caption?.text, "The first photograph taken on the surface of Mars, by Viking 1 on July 20, 1976.");

  const fallbackHeadingStructure = buildStoryStructureForAuthorInput(
    {
      story_url: "https://www.nytimes.com/interactive/2026/01/01/mars.html",
      slug: "mars",
      title: "Mars Fixture",
      snapshots: [
        {
          id: "snapshot-1",
          scrollPercent: 1.6,
          activeTexts: [
            { tag: "h2", className: "g-subhed", text: "Missions to Mars" },
            { tag: "p", className: "g-body", text: "In July 1965, the Mariner 4 spacecraft flew past Mars." }
          ]
        }
      ]
    },
    { story: { title: "Mars Fixture" } },
    { modelBeatAssociations: [] },
    []
  );
  assert.equal(fallbackHeadingStructure.headings[0].text, "Missions to Mars");
  assert.equal(fallbackHeadingStructure.text_only_parts.some((item) => item.text === "Missions to Mars"), false);

  const oversizedPromptEvidence = {
    tool: "animation-logic-probe-analyzer",
    version: VERSION,
    judgmentInput: { promptVersion: CODEX_PROMPT_VERSION, evidenceFingerprint: "fixture" },
    sourceProbe: { collectorTool: "fixture", collectorVersion: "1", viewportCapture: null },
    story: { url: "https://example.com/oversized", slug: "oversized", title: "Oversized fixture" },
    downloads: [],
    failedDownloads: [],
    assetDiscovery: {},
    sourceEvidence: Array.from({ length: MAX_EVIDENCE_ITEMS }, (_, index) => ({
      id: `oversized-evidence-${String(index).padStart(3, "0")}`,
      sourceType: "downloaded-script",
      source: "https://example.com/app.js",
      keyword: "AnimationMixer",
      context: `AnimationMixer fixture ${index} ${"scroll visibility mixer context ".repeat(360)}`
    })),
    runtimeObservation: { beatRuntimeStates: [] },
    visualObservation: null,
    imageRelevance: {},
    imageAssets: [],
    glbAnimations: { models: [] },
    relationships: [],
    globalSignals: {}
  };
  const oversizedPromptBundle = createCodexPromptBundle(oversizedPromptEvidence);
  const repeatedPromptBundle = createCodexPromptBundle(oversizedPromptEvidence);
  assert.equal(oversizedPromptBundle.diagnostics.profile, "balanced");
  assert.ok(oversizedPromptBundle.diagnostics.actualChars <= CODEX_PROMPT_TARGET_CHARS);
  assert.ok(oversizedPromptBundle.diagnostics.actualChars < CODEX_INPUT_HARD_LIMIT_CHARS);
  assert.equal(oversizedPromptBundle.diagnostics.sourceEvidence.included, 180);
  assert.equal(repeatedPromptBundle.prompt, oversizedPromptBundle.prompt);
  assert.deepEqual(repeatedPromptBundle.diagnostics, oversizedPromptBundle.diagnostics);

  assert.throws(() => createCodexPromptBundle({
    ...oversizedPromptEvidence,
    sourceEvidence: [],
    imageAssets: [{ id: "uncompactable", caption: "x".repeat(CODEX_PROMPT_TARGET_CHARS) }]
  }), /Codex prompt compaction could not reach the 900000-character target/);

  await fs.rm(tempDir, { recursive: true, force: true });
  console.log("Self-test passed.");
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
} else if (options.selfTest) {
  await runSelfTest();
} else {
  try {
    await main(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
