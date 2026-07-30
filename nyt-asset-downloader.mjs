#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import robotsParser from "robots-parser";

const VERSION = "1.0.0";
const DEFAULT_USER_AGENT = `NYTAssetDiscovery/${VERSION} (+local research; no credentials)`;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_CANDIDATES = 2000;
const DEFAULT_PROGRESS_INTERVAL_MS = 1000;
const DEFAULT_PROFILE = "adaptation";
const TEXT_SCAN_LIMIT_BYTES = 25 * 1024 * 1024;

const MODEL_EXTENSIONS = new Set([".glb", ".gltf", ".bin"]);
const TEXTURE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".ktx", ".ktx2", ".basis"]);
const DATA_EXTENSIONS = new Set([".json", ".csv", ".geojson", ".topojson"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const STYLE_EXTENSIONS = new Set([".css"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m3u8", ".mpd"]);
const ALL_EXTENSIONS = new Set([
  ...MODEL_EXTENSIONS,
  ...TEXTURE_EXTENSIONS,
  ...DATA_EXTENSIONS,
  ...SCRIPT_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...STYLE_EXTENSIONS,
  ...VIDEO_EXTENSIONS
]);

const KEYWORDS = [
  "glb",
  "gltf",
  "model",
  "webgl",
  "three",
  "scene",
  "asset",
  "texture",
  "geometry",
  "mesh",
  "animation",
  "slide",
  "caption",
  "nytg",
  "WEBGL_DATA",
  "models",
  "slides",
  "position",
  "layers",
  "camera"
];

const STRUCTURE_TERMS = [
  "WEBGL_DATA",
  "models",
  "slides",
  "caption",
  "position",
  "layers",
  "animation",
  "camera",
  "scene",
  "scroll",
  "transition"
];

const TYPE_DIR = {
  model: "models",
  texture: "textures",
  data: "data",
  script: "scripts",
  html: "html",
  style: "metadata",
  video: "media",
  unknown: "metadata"
};

const TRACKING_EXCLUSION_PATTERNS = [
  /(^|[./-])doubleclick\.net/i,
  /googletagmanager\.com/i,
  /chartbeat/i,
  /datadog/i,
  /comscore/i,
  /scorecardresearch/i,
  /rubiconproject/i,
  /amazon-adsystem/i,
  /criteo/i,
  /pubmatic/i,
  /openx/i,
  /media\.net/i,
  /brandmetrics/i,
  /geoedge/i,
  /adnxs/i,
  /bidswitch/i,
  /casalemedia/i,
  /3lift/i,
  /turn\.com/i,
  /blismedia/i,
  /rtbwise/i,
  /admanmedia/i,
  /(^|[/?&_.-])(gpt|pubads|adslot|apstag|aps_csm|show-ads|grumi|partnerpixels|tqsmartpixel|gtm|rum|err_rep|uwt)([/?&_.=-]|$)/i,
  /pixel/i,
  /bidder|prebid|fastlane/i,
  /survey-prod|iteratehq/i,
  /fides|iab-gpp|purr/i
];

const PLATFORM_EXCLUSION_PATTERNS = [
  /\/comments/i,
  /commentsPanel/i,
  /\/account|account-/i,
  /\/meter|meter-/i,
  /\/pay|pay-/i,
  /\/swg|swg-/i,
  /newsletter|emailsignup|subscriber/i,
  /recirculation/i,
  /games-assets|wordle|connections|spelling-bee|sudoku|strands|tiles|letter-boxed|crossplay/i,
  /share-button|use-share|icon-share|whatsapp|telegram|reddit|linkedin/i,
  /video-static\/vhs|vhs\.min|video-player/i,
  /favicon|apple-touch-icon|homescreen|appicon|siteLogo|t_logo|icon-t-logo/i,
  /video-default/i,
  /privacy|cookiepolicy|ethical-journalism|social-media-guidelines|tpc-check|payment_method_manifest/i,
  /defaultSiteIndexData|siteIndexContent|weather-hp-modules|home-[a-f0-9]/i,
  /core-news-download|core_app|wirecutter/i
];

function parseArgs(argv) {
  const options = {
    input: "",
    out: "./nyt-assets",
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: DEFAULT_RETRIES,
    maxDepth: DEFAULT_MAX_DEPTH,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    progressIntervalMs: DEFAULT_PROGRESS_INTERVAL_MS,
    profile: DEFAULT_PROFILE,
    storyPrefixes: [],
    userAgent: DEFAULT_USER_AGENT,
    selfTest: false,
    quiet: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    if (arg === "--input" || arg === "-i") {
      options.input = next();
    } else if (arg === "--out" || arg === "-o") {
      options.out = next();
    } else if (arg === "--concurrency") {
      options.concurrency = Number.parseInt(next(), 10);
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(next(), 10);
    } else if (arg === "--retries") {
      options.retries = Number.parseInt(next(), 10);
    } else if (arg === "--max-depth") {
      options.maxDepth = Number.parseInt(next(), 10);
    } else if (arg === "--max-candidates") {
      options.maxCandidates = Number.parseInt(next(), 10);
    } else if (arg === "--progress-interval-ms") {
      options.progressIntervalMs = Number.parseInt(next(), 10);
    } else if (arg === "--profile") {
      options.profile = next();
    } else if (arg === "--story-prefix") {
      options.storyPrefixes.push(next());
    } else if (arg === "--user-agent") {
      options.userAgent = next();
    } else if (arg === "--self-test") {
      options.selfTest = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000");
  }
  if (!Number.isInteger(options.retries) || options.retries < 0) {
    throw new Error("--retries must be a non-negative integer");
  }
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < -1) {
    throw new Error("--max-depth must be -1 or a non-negative integer");
  }
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 0) {
    throw new Error("--max-candidates must be a non-negative integer");
  }
  if (!Number.isInteger(options.progressIntervalMs) || options.progressIntervalMs < 250) {
    throw new Error("--progress-interval-ms must be an integer >= 250");
  }
  if (!["adaptation", "archive"].includes(options.profile)) {
    throw new Error("--profile must be either adaptation or archive");
  }

  return options;
}

function printHelp() {
  console.log(`
NYTimes asset downloader ${VERSION}

Usage:
  node nyt-asset-downloader.mjs --input nyt_asset_discovery_<slug>.json --out ./nyt-assets

Options:
  -i, --input <file>       Discovery JSON exported by NYTAssetCollector.export()
  -o, --out <dir>          Output directory. Default: ./nyt-assets
      --concurrency <n>    Low download concurrency. Default: ${DEFAULT_CONCURRENCY}
      --timeout-ms <n>     Per-request timeout. Default: ${DEFAULT_TIMEOUT_MS}
      --retries <n>        Retries for transient failures. Default: ${DEFAULT_RETRIES}
      --max-depth <n>      Recursive discovery depth. -1 disables. Default: ${DEFAULT_MAX_DEPTH}
      --max-candidates <n> Maximum discovered URLs. 0 disables. Default: ${DEFAULT_MAX_CANDIDATES}
      --progress-interval-ms <n>
                            Live progress and progress.json interval. Default: ${DEFAULT_PROGRESS_INTERVAL_MS}
      --profile <name>     Filtering profile: adaptation or archive. Default: ${DEFAULT_PROFILE}
      --story-prefix <url> Story asset prefix to include. Repeatable. Auto-detected when omitted.
      --user-agent <ua>    Transparent user agent for public requests.
      --quiet              Disable live progress output.
      --self-test          Run local helper tests without network access.
      --help               Show this help text.

Notes:
  - This script does not use cookies, credentials, proxies, stealth plugins, or bot-bypass logic.
  - robots.txt is checked before downloading from each origin.
  - Blocked or unavailable URLs are written to metadata/failed_downloads.json.
`);
}

function sha1(value, length = 12) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, length);
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

function storySlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "nyt-story";
    return safeSegment(last.replace(/\.[a-z0-9]+$/i, ""), "nyt-story").toLowerCase();
  } catch {
    return "nyt-story";
  }
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function cleanCandidateString(value) {
  return String(value || "")
    .trim()
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/^[("'`]+/, "")
    .replace(/[)"'`,;}\]]+$/g, "");
}

function normalizeUrl(rawValue, baseUrl) {
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

function hasKeyword(value) {
  const lowered = String(value || "").toLowerCase();
  return KEYWORDS.some((keyword) => lowered.includes(keyword.toLowerCase()));
}

function shouldKeepCandidate(url, extraText = "") {
  const ext = urlExtension(url);
  return ALL_EXTENSIONS.has(ext) || hasKeyword(`${url} ${extraText}`);
}

function classifyUrl(url, contentType = "") {
  const ext = urlExtension(url);
  const type = String(contentType || "").toLowerCase();

  if (MODEL_EXTENSIONS.has(ext)) return "model";
  if (TEXTURE_EXTENSIONS.has(ext)) return "texture";
  if (DATA_EXTENSIONS.has(ext)) return "data";
  if (SCRIPT_EXTENSIONS.has(ext)) return "script";
  if (HTML_EXTENSIONS.has(ext)) return "html";
  if (STYLE_EXTENSIONS.has(ext)) return "style";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";

  if (type.includes("model/gltf-binary")) return "model";
  if (type.includes("model/gltf+json")) return "model";
  if (type.startsWith("image/")) return "texture";
  if (type.includes("json") || type.includes("csv")) return "data";
  if (type.includes("javascript") || type.includes("ecmascript")) return "script";
  if (type.includes("html")) return "html";
  if (type.includes("css")) return "style";
  if (type.startsWith("video/") || type.includes("mpegurl") || type.includes("dash+xml")) return "video";
  return "unknown";
}

function extensionFromContentType(contentType) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const map = new Map([
    ["model/gltf-binary", ".glb"],
    ["model/gltf+json", ".gltf"],
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/webp", ".webp"],
    ["image/ktx", ".ktx"],
    ["image/ktx2", ".ktx"],
    ["application/json", ".json"],
    ["application/geo+json", ".geojson"],
    ["text/csv", ".csv"],
    ["application/javascript", ".js"],
    ["text/javascript", ".js"],
    ["application/x-javascript", ".js"],
    ["text/html", ".html"],
    ["text/css", ".css"],
    ["video/mp4", ".mp4"],
    ["video/webm", ".webm"],
    ["application/vnd.apple.mpegurl", ".m3u8"],
    ["application/dash+xml", ".mpd"]
  ]);
  return map.get(type) || "";
}

function getDiscoveryUrls(discovery) {
  const urls = [];
  const push = (value) => {
    if (typeof value === "string" && value.trim()) urls.push(value);
  };

  for (const key of ["filtered_requests", "network_entries", "dom_asset_references"]) {
    for (const entry of getArray(discovery[key])) {
      push(entry.url || entry.name || entry.asset_url);
    }
  }
  for (const url of getArray(discovery.script_src_urls)) push(url);
  for (const script of getArray(discovery.scripts)) push(script.src);

  if (discovery.html) {
    for (const ref of extractAssetReferences(discovery.html, discovery.story_url || "")) {
      push(ref.url);
    }
  }

  return urls;
}

function detectStoryPrefixes(discovery, explicitPrefixes = []) {
  const prefixes = new Set();
  const storyUrl = discovery.story_url || "";

  for (const prefix of explicitPrefixes) {
    const normalized = normalizeUrl(prefix, storyUrl);
    if (normalized) prefixes.add(normalized.endsWith("/") ? normalized : `${normalized}/`);
  }

  for (const rawUrl of getDiscoveryUrls(discovery)) {
    const normalized = normalizeUrl(rawUrl, storyUrl);
    if (!normalized) continue;
    try {
      const parsed = new URL(normalized);
      const newsgraphicsMatch = parsed.pathname.match(/^(\/newsgraphics\/[^/]+\/[^/]+\/_assets\/)/);
      if (newsgraphicsMatch) {
        prefixes.add(`${parsed.origin}${newsgraphicsMatch[1]}`);
        continue;
      }

      const interactiveAssetMatch = parsed.pathname.match(/^(\/interactive\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/[^/]+\/(?:_assets|assets)\/)/);
      if (interactiveAssetMatch) {
        prefixes.add(`${parsed.origin}${interactiveAssetMatch[1]}`);
      }
    } catch {
      // Ignore malformed discovery URLs.
    }
  }

  return Array.from(prefixes).sort((a, b) => b.length - a.length);
}

function storyPrefixMatch(url, storyPrefixes = []) {
  return storyPrefixes.find((prefix) => url.startsWith(prefix)) || "";
}

function storyTokens(storyUrl, fallbackSlug = "") {
  const rawSlug = fallbackSlug || storySlugFromUrl(storyUrl);
  return rawSlug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !new Set(["html", "data", "story", "interactive", "opinion", "article", "index"]).has(token));
}

function hasStoryToken(url, tokens) {
  const lowered = String(url || "").toLowerCase();
  return tokens.some((token) => {
    if (lowered.includes(token)) return true;
    if (token.endsWith("s") && lowered.includes(token.slice(0, -1))) return true;
    return lowered.includes(`${token}s`);
  });
}

function matchPattern(patterns, value) {
  return patterns.find((pattern) => pattern.test(value)) || null;
}

function isStoryAssetType(assetType) {
  return ["model", "texture", "data", "script", "style", "video"].includes(assetType);
}

function isSupportingStoryType(assetType) {
  return ["texture", "data", "html", "video"].includes(assetType);
}

function classifyAdaptationRelevance(url, context = {}) {
  const profile = context.profile || "adaptation";
  const assetType = classifyUrl(url);
  const prefix = storyPrefixMatch(url, context.storyPrefixes || []);
  const basePrefix = context.baseUrl ? storyPrefixMatch(context.baseUrl, context.storyPrefixes || []) : "";
  const tokens = context.storyTokens || [];
  const combined = `${url} ${context.notes || ""}`;

  if (profile === "archive") {
    return {
      include: true,
      adaptation_relevance: "archive",
      story_prefix_match: prefix,
      matched_rule: "archive_profile"
    };
  }

  if (prefix && isStoryAssetType(assetType)) {
    return {
      include: true,
      adaptation_relevance: "core_story",
      story_prefix_match: prefix,
      matched_rule: "story_asset_prefix"
    };
  }

  const trackingMatch = matchPattern(TRACKING_EXCLUSION_PATTERNS, combined);
  if (trackingMatch) {
    return {
      include: false,
      adaptation_relevance: "tracking_excluded",
      story_prefix_match: prefix,
      exclusion_reason: "tracking_or_adtech",
      matched_rule: trackingMatch.toString()
    };
  }

  const platformMatch = matchPattern(PLATFORM_EXCLUSION_PATTERNS, combined);
  if (platformMatch) {
    return {
      include: false,
      adaptation_relevance: "platform_excluded",
      story_prefix_match: prefix,
      exclusion_reason: "platform_or_non_story_feature",
      matched_rule: platformMatch.toString()
    };
  }

  if (MODEL_EXTENSIONS.has(urlExtension(url)) && urlExtension(url) !== ".bin") {
    return {
      include: true,
      adaptation_relevance: "core_story",
      story_prefix_match: prefix,
      matched_rule: "model_asset_extension"
    };
  }

  if (basePrefix && isStoryAssetType(assetType)) {
    return {
      include: true,
      adaptation_relevance: "core_story",
      story_prefix_match: prefix || basePrefix,
      matched_rule: "referenced_by_story_local_resource"
    };
  }

  if (hasStoryToken(url, tokens) && isSupportingStoryType(assetType)) {
    return {
      include: true,
      adaptation_relevance: "supporting_story",
      story_prefix_match: prefix,
      matched_rule: "story_slug_token"
    };
  }

  if (context.storyUrl && normalizeUrl(url, context.storyUrl) === normalizeUrl(context.storyUrl, context.storyUrl)) {
    return {
      include: false,
      adaptation_relevance: "platform_excluded",
      story_prefix_match: prefix,
      exclusion_reason: "story_page_html_already_saved",
      matched_rule: "story_url_html"
    };
  }

  return {
    include: false,
    adaptation_relevance: "platform_excluded",
    story_prefix_match: prefix,
    exclusion_reason: "not_adaptation_relevant",
    matched_rule: "no_story_prefix_or_story_token"
  };
}

function filenameForUrl(url, contentType = "") {
  let basename = "asset";
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname);
    basename = path.posix.basename(decodedPath) || "asset";
  } catch {
    basename = "asset";
  }

  let parsedName = path.parse(basename);
  let name = safeSegment(parsedName.name, "asset").slice(0, 80);
  let ext = parsedName.ext.toLowerCase();
  if (!ext) {
    ext = extensionFromContentType(contentType);
  }
  if (!ext && urlExtension(url)) {
    ext = urlExtension(url);
  }

  return `${name}-${sha1(url, 12)}${ext}`;
}

function createAddOptions(context, discoveryDepth) {
  return {
    discoveryDepth,
    maxDepth: context.options.maxDepth,
    maxCandidates: context.options.maxCandidates,
    profile: context.options.profile,
    storyUrl: context.storyUrl,
    storySlug: context.storySlug,
    storyPrefixes: context.storyPrefixes,
    storyTokens: context.storyTokens,
    excludedAssets: context.excludedAssets,
    onExclude: (exclusion) => recordExcludedCandidate(context, exclusion),
    onSkip: (skip) => recordSkippedCandidate(context, skip)
  };
}

function recordExcludedCandidate(context, exclusion) {
  if (!context || typeof context !== "object") return;
  const existing = context.excludedAssets.get(exclusion.url);
  if (existing) {
    existing.source_types = Array.from(new Set([...existing.source_types, exclusion.sourceType].filter(Boolean))).sort();
    if (exclusion.baseUrl && !existing.base_urls.includes(exclusion.baseUrl)) {
      existing.base_urls.push(exclusion.baseUrl);
      existing.base_urls.sort();
    }
    return;
  }

  context.stats.skippedByRelevance += 1;
  context.excludedAssets.set(exclusion.url, {
    asset_url: exclusion.url,
    source_types: [exclusion.sourceType].filter(Boolean),
    base_urls: exclusion.baseUrl ? [exclusion.baseUrl] : [],
    adaptation_relevance: exclusion.adaptation_relevance,
    exclusion_reason: exclusion.exclusion_reason,
    matched_rule: exclusion.matched_rule,
    story_prefix_match: exclusion.story_prefix_match || "",
    discovery_depth: exclusion.discoveryDepth,
    notes: exclusion.notes ? [exclusion.notes] : []
  });
}

function recordSkippedCandidate(context, skip) {
  if (!context || typeof context !== "object") return;
  const key = `${skip.reason}:${skip.url}`;
  if (context.limitSkipKeys.has(key)) return;

  context.limitSkipKeys.add(key);
  context.stats.skippedByLimits += 1;
  context.failedDownloads.push({
    asset_url: skip.url,
    source_types: [skip.sourceType].filter(Boolean),
    reason: skip.reason,
    discovery_depth: skip.discoveryDepth,
    max_depth: skip.maxDepth,
    max_candidates: skip.maxCandidates,
    base_url: skip.baseUrl || "",
    notes: skip.notes ? [skip.notes] : []
  });
}

function addCandidate(candidates, rawUrl, baseUrl, sourceType, notes = "", addOptions = {}) {
  const normalized = normalizeUrl(rawUrl, baseUrl);
  if (!normalized || !shouldKeepCandidate(normalized, notes)) return null;

  const discoveryDepth = Number.isInteger(addOptions.discoveryDepth) ? addOptions.discoveryDepth : 0;
  const maxDepth = Number.isInteger(addOptions.maxDepth) ? addOptions.maxDepth : -1;
  const maxCandidates = Number.isInteger(addOptions.maxCandidates) ? addOptions.maxCandidates : 0;
  const existing = candidates.get(normalized);
  if (existing) {
    existing.sourceTypes.add(sourceType);
    if (baseUrl) existing.baseUrls.add(baseUrl);
    if (notes) existing.notes.add(notes.slice(0, 500));
    existing.discoveryDepth = Number.isInteger(existing.discoveryDepth)
      ? Math.min(existing.discoveryDepth, discoveryDepth)
      : discoveryDepth;
    return existing;
  }

  const relevance = classifyAdaptationRelevance(normalized, {
    profile: addOptions.profile,
    storyUrl: addOptions.storyUrl,
    storySlug: addOptions.storySlug,
    storyPrefixes: addOptions.storyPrefixes,
    storyTokens: addOptions.storyTokens,
    baseUrl,
    notes
  });

  if (!relevance.include) {
    addOptions.onExclude?.({
      url: normalized,
      sourceType,
      baseUrl,
      discoveryDepth,
      notes: notes.slice(0, 500),
      ...relevance
    });
    return null;
  }

  if (maxDepth >= 0 && discoveryDepth > maxDepth) {
    addOptions.onSkip?.({
      url: normalized,
      reason: "max_depth_exceeded",
      sourceType,
      discoveryDepth,
      maxDepth,
      maxCandidates,
      baseUrl,
      notes: notes.slice(0, 500)
    });
    return null;
  }

  if (maxCandidates > 0 && candidates.size >= maxCandidates) {
    addOptions.onSkip?.({
      url: normalized,
      reason: "max_candidates_exceeded",
      sourceType,
      discoveryDepth,
      maxDepth,
      maxCandidates,
      baseUrl,
      notes: notes.slice(0, 500)
    });
    return null;
  }

  const candidate = {
    url: normalized,
    sourceTypes: new Set([sourceType]),
    baseUrls: new Set(baseUrl ? [baseUrl] : []),
    notes: new Set(notes ? [notes.slice(0, 500)] : []),
    adaptationRelevance: relevance.adaptation_relevance,
    storyPrefixMatch: relevance.story_prefix_match || "",
    relevanceRule: relevance.matched_rule || "",
    discoveryDepth,
    discoveredAt: new Date().toISOString()
  };
  candidates.set(normalized, candidate);
  addOptions.excludedAssets?.delete?.(normalized);
  return candidate;
}

function extractAssetReferences(text, baseUrl) {
  const source = String(text || "");
  const found = new Map();

  function add(rawUrl, sourceType, notes = "") {
    const normalized = normalizeUrl(rawUrl, baseUrl);
    if (!normalized || !shouldKeepCandidate(normalized, notes)) return;
    if (!found.has(normalized)) {
      found.set(normalized, {
        url: normalized,
        sourceType,
        notes
      });
    }
  }

  const absolutePattern = /https?:\\?\/\\?\/[^\s"'`<>\\]+/gi;
  let match;
  while ((match = absolutePattern.exec(source))) {
    add(match[0], "absolute_reference", "absolute URL in text");
  }

  const protocolRelativePattern = /(^|[\s"'`(])\/\/[^\s"'`<>\\]+/gi;
  while ((match = protocolRelativePattern.exec(source))) {
    add(match[0].trim(), "protocol_relative_reference", "protocol-relative URL in text");
  }

  const quotedAssetPattern = /["'`]([^"'`<>]+?\.(?:glb|gltf|bin|jpg|jpeg|png|webp|ktx|ktx2|basis|json|csv|geojson|topojson|js|mjs|cjs|css|html|htm|mp4|webm|mov|m3u8|mpd)(?:\?[^"'`<>]*)?)["'`]/gi;
  while ((match = quotedAssetPattern.exec(source))) {
    add(match[1], "quoted_asset_reference", "quoted asset-like path");
  }

  const cssUrlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  while ((match = cssUrlPattern.exec(source))) {
    add(match[2], "css_url_reference", "CSS url() reference");
  }

  return Array.from(found.values());
}

function getArray(value) {
  return Array.isArray(value) ? value : [];
}

function seedCandidates(discovery, candidates, context) {
  const storyUrl = discovery.story_url || discovery.url || "";
  const addOptions = createAddOptions(context, 0);

  for (const entry of getArray(discovery.filtered_requests)) {
    addCandidate(candidates, entry.url || entry.name || entry.asset_url, storyUrl, "network_request", entry.initiatorType || "", addOptions);
  }

  if (context.options.profile === "archive") {
    for (const entry of getArray(discovery.network_entries)) {
      addCandidate(candidates, entry.url || entry.name || entry.asset_url, storyUrl, "network_request", entry.initiatorType || "", addOptions);
    }
  }

  for (const entry of getArray(discovery.dom_asset_references)) {
    addCandidate(candidates, entry.url || entry.asset_url, storyUrl, "html_reference", "DOM asset reference", addOptions);
  }

  for (const scriptUrl of getArray(discovery.script_src_urls)) {
    addCandidate(candidates, scriptUrl, storyUrl, "html_reference", "script src", addOptions);
  }

  for (const script of getArray(discovery.scripts)) {
    if (script.src) {
      addCandidate(candidates, script.src, storyUrl, "html_reference", "script src", addOptions);
    }
    if (script.text) {
      for (const ref of extractAssetReferences(script.text, storyUrl)) {
        addCandidate(candidates, ref.url, storyUrl, "inline_script_reference", ref.notes, addOptions);
      }
    }
  }

  if (discovery.html) {
    for (const ref of extractAssetReferences(discovery.html, storyUrl)) {
      addCandidate(candidates, ref.url, storyUrl, "html_reference", ref.notes, addOptions);
    }
  }
}

async function ensureOutputFolders(rootDir) {
  await fs.mkdir(rootDir, { recursive: true });
  for (const dir of Object.values(TYPE_DIR)) {
    await fs.mkdir(path.join(rootDir, dir), { recursive: true });
  }
  await fs.mkdir(path.join(rootDir, "metadata"), { recursive: true });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

function pushLimited(array, item, limit) {
  if (array.length < limit) array.push(item);
}

function createStats() {
  return {
    startedAt: Date.now(),
    processed: 0,
    downloaded: 0,
    failed: 0,
    skippedByRobots: 0,
    skippedByLimits: 0,
    skippedByRelevance: 0,
    bytesDownloaded: 0,
    active: 0
  };
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ${seconds}s`;
}

function progressSnapshot(context) {
  const elapsedMs = Date.now() - context.stats.startedAt;
  const queued = Math.max(0, context.queue.length - context.queueIndex);
  return {
    timestamp: new Date().toISOString(),
    phase: context.phase,
    elapsed_ms: elapsedMs,
    elapsed: formatElapsed(elapsedMs),
    discovered: context.candidates.size,
    queued,
    active: context.stats.active,
    processed: context.stats.processed,
    downloaded: context.stats.downloaded,
    failed: context.stats.failed,
    skipped: context.stats.skippedByRobots + context.stats.skippedByLimits + context.stats.skippedByRelevance,
    skipped_by_robots: context.stats.skippedByRobots,
    skipped_by_limits: context.stats.skippedByLimits,
    skipped_by_relevance: context.stats.skippedByRelevance,
    bytes_downloaded: context.stats.bytesDownloaded,
    bytes_downloaded_human: formatBytes(context.stats.bytesDownloaded),
    max_depth: context.options.maxDepth,
    max_candidates: context.options.maxCandidates,
    output_root: context.rootDir
  };
}

async function writeProgressSnapshot(context) {
  if (!context.metadataDir) return;
  await writeJson(path.join(context.metadataDir, "progress.json"), progressSnapshot(context));
}

function renderProgress(context, force = false) {
  if (context.options.quiet) return;
  const now = Date.now();
  if (!force && now - context.lastProgressRender < context.options.progressIntervalMs) return;
  context.lastProgressRender = now;

  const snapshot = progressSnapshot(context);
  const line = [
    `[${snapshot.phase}]`,
    `discovered=${snapshot.discovered}`,
    `queued=${snapshot.queued}`,
    `active=${snapshot.active}`,
    `processed=${snapshot.processed}`,
    `downloaded=${snapshot.downloaded}`,
    `failed=${snapshot.failed}`,
    `skipped=${snapshot.skipped}`,
    `bytes=${snapshot.bytes_downloaded_human}`,
    `elapsed=${snapshot.elapsed}`
  ].join(" ");

  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line.slice(0, Math.max(20, process.stdout.columns || 120)).padEnd(process.stdout.columns || 120)}`);
  } else {
    console.log(line);
  }
}

function setPhase(context, phase) {
  context.phase = phase;
  if (!context.options.quiet) {
    if (process.stdout.isTTY) process.stdout.write("\n");
    console.log(`Phase: ${phase}`);
  }
  renderProgress(context, true);
}

function startProgress(context) {
  if (context.progressTimer) return;
  context.progressTimer = setInterval(() => {
    renderProgress(context);
    void writeProgressSnapshot(context).catch((error) => {
      context.warnings.push(`progress snapshot write failed: ${error.message}`);
    });
  }, context.options.progressIntervalMs);
  context.progressTimer.unref?.();
  renderProgress(context, true);
}

async function stopProgress(context) {
  if (context.progressTimer) {
    clearInterval(context.progressTimer);
    context.progressTimer = null;
  }
  renderProgress(context, true);
  if (!context.options.quiet && process.stdout.isTTY) {
    process.stdout.write("\n");
  }
  await writeProgressSnapshot(context);
}

function keywordMatches(text, source, maxMatches = 100) {
  const original = String(text || "");
  const lowered = original.toLowerCase();
  const matches = [];
  const seen = new Set();

  for (const term of STRUCTURE_TERMS) {
    const needle = term.toLowerCase();
    let offset = 0;
    while (matches.length < maxMatches) {
      const index = lowered.indexOf(needle, offset);
      if (index === -1) break;
      const start = Math.max(0, index - 180);
      const end = Math.min(original.length, index + needle.length + 180);
      const key = `${term}:${start}:${end}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          source,
          keyword: term,
          index,
          context: original.slice(start, end)
        });
      }
      offset = index + needle.length;
    }
    if (matches.length >= maxMatches) break;
  }

  return matches;
}

function valuePreview(value) {
  if (value === null || typeof value !== "object") {
    return String(value).slice(0, 500);
  }
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function structureItemText(item) {
  if (!item || typeof item !== "object") return "";
  for (const key of ["text", "caption", "content", "match", "value"]) {
    if (typeof item[key] === "string" && isUsableStructureText(item[key])) return item[key];
  }
  return "";
}

function textFingerprint(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isUsableStructureText(value) {
  const key = textFingerprint(value);
  return Boolean(key) && !["undefined", "null", "nan"].includes(key);
}

function stripPlaceholderTextFields(item) {
  if (!item || typeof item !== "object") return item;
  const cleaned = { ...item };
  for (const key of ["text", "caption", "content", "match", "value"]) {
    if (typeof cleaned[key] === "string" && !isUsableStructureText(cleaned[key])) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

function isCompositeStructureItem(itemKey, allKeys, itemIndex) {
  if (!itemKey) return false;
  let containedChildren = 0;
  for (let index = 0; index < allKeys.length; index += 1) {
    if (index === itemIndex) continue;
    const childKey = allKeys[index];
    if (!childKey || childKey.length < 40 || childKey.length >= itemKey.length - 20) continue;
    if (!itemKey.includes(childKey)) continue;
    containedChildren += 1;
    if (containedChildren >= 2) return true;
  }
  return false;
}

function dedupeStructureItems(values, options = {}) {
  const items = getArray(values);
  const keys = items.map((item) => textFingerprint(structureItemText(item)));
  const seen = new Set();
  const deduped = [];

  items.forEach((item, index) => {
    const key = keys[index];
    if (isCompositeStructureItem(key, keys, index)) return;
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    const cleaned = stripPlaceholderTextFields(item);
    if (options.requireUsableText && !structureItemText(cleaned)) return;
    deduped.push(cleaned);
  });

  return deduped;
}

function scanJsonForStructure(value, source, output, pathParts = [], state = { count: 0 }) {
  if (state.count >= 250 || value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && state.count < 250; index += 1) {
      scanJsonForStructure(value[index], source, output, [...pathParts, String(index)], state);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (state.count >= 250) return;
    const matched = STRUCTURE_TERMS.some((term) => key.toLowerCase().includes(term.toLowerCase()));
    if (matched) {
      output.json_candidates.push({
        source,
        path: [...pathParts, key].join("."),
        key,
        value_preview: valuePreview(child)
      });
      state.count += 1;
    }
    scanJsonForStructure(child, source, output, [...pathParts, key], state);
  }
}

function createStoryStructure(discovery) {
  const inputStructure = discovery.story_structure_candidates || {};
  return {
    story_url: discovery.story_url || "",
    timestamp: new Date().toISOString(),
    title: discovery.title || inputStructure.title || "",
    captions: dedupeStructureItems(inputStructure.captions),
    scroll_steps: dedupeStructureItems(inputStructure.scroll_steps),
    slides: dedupeStructureItems(inputStructure.slides),
    headings: dedupeStructureItems(inputStructure.h1),
    text_only_parts: dedupeStructureItems(inputStructure.text_only_parts, { requireUsableText: true }),
    keyword_matches: getArray(discovery.keyword_matches).slice(0, 350),
    downloaded_text_matches: [],
    json_candidates: [],
    notes: [
      "These are candidates for research review, not a guaranteed complete story schema."
    ]
  };
}

function isTextScannable(assetType, contentType, byteLength) {
  if (byteLength > TEXT_SCAN_LIMIT_BYTES) return false;
  const type = String(contentType || "").toLowerCase();
  return (
    assetType === "script" ||
    assetType === "html" ||
    assetType === "data" ||
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("xml")
  );
}

function looksLikeBlockedHtml(bytes, contentType, originalType) {
  const type = String(contentType || "").toLowerCase();
  if (!type.includes("html")) {
    return false;
  }

  const head = Buffer.from(bytes).subarray(0, 8192).toString("utf8").toLowerCase();
  const hasBlockSignal = (
    head.includes("captcha") ||
    head.includes("access denied") ||
    head.includes("verify you are") ||
    head.includes("blocked") ||
    head.includes("bot")
  );

  if (hasBlockSignal) return true;
  if (originalType === "html" || originalType === "unknown") return false;

  return (
    head.includes("<html") ||
    head.includes("<!doctype html")
  );
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
        "User-Agent": options.userAgent,
        "Accept": "*/*"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function downloadBytes(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.statusText = response.statusText;
        if (isTransientStatus(response.status) && attempt < options.retries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
        throw error;
      }
      const arrayBuffer = await response.arrayBuffer();
      return {
        bytes: Buffer.from(arrayBuffer),
        finalUrl: response.url || url,
        contentType: response.headers.get("content-type") || "",
        contentLength: response.headers.get("content-length") || "",
        status: response.status
      };
    } catch (error) {
      lastError = error;
      if (attempt < options.retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError;
}

async function getRobotsRules(origin, options, cache, warnings) {
  if (cache.has(origin)) return cache.get(origin);

  const robotsUrl = `${origin}/robots.txt`;
  try {
    const response = await fetchWithTimeout(robotsUrl, {
      ...options,
      timeoutMs: Math.min(options.timeoutMs, 10_000),
      retries: 0
    });
    if (response.status === 404) {
      cache.set(origin, null);
      return null;
    }
    if (!response.ok) {
      warnings.push(`robots.txt unavailable for ${origin}: HTTP ${response.status}; downloads from this origin will be attempted as public requests.`);
      cache.set(origin, null);
      return null;
    }
    const text = await response.text();
    const parser = robotsParser(robotsUrl, text);
    cache.set(origin, parser);
    return parser;
  } catch (error) {
    warnings.push(`robots.txt check failed for ${origin}: ${error.message}; downloads from this origin will be attempted as public requests.`);
    cache.set(origin, null);
    return null;
  }
}

async function isAllowedByRobots(url, options, cache, warnings) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  const rules = await getRobotsRules(origin, options, cache, warnings);
  if (!rules) return true;
  return rules.isAllowed(url, options.userAgent) !== false;
}

function candidateToJson(candidate) {
  return {
    url: candidate.url,
    source_types: Array.from(candidate.sourceTypes).sort(),
    base_urls: Array.from(candidate.baseUrls).sort(),
    notes: Array.from(candidate.notes).sort(),
    adaptation_relevance: candidate.adaptationRelevance || "",
    story_prefix_match: candidate.storyPrefixMatch || "",
    matched_rule: candidate.relevanceRule || "",
    discovery_depth: candidate.discoveryDepth,
    discovered_at: candidate.discoveredAt
  };
}

function candidateSourceType(candidate) {
  const preferred = [
    "network_request",
    "html_reference",
    "script_reference",
    "inline_script_reference",
    "data_reference",
    "inferred"
  ];
  for (const sourceType of preferred) {
    if (candidate.sourceTypes.has(sourceType)) return sourceType;
  }
  return Array.from(candidate.sourceTypes)[0] || "inferred";
}

async function processCandidate(candidate, context) {
  if (context.processed.has(candidate.url)) return;
  context.processed.add(candidate.url);
  context.stats.active += 1;
  renderProgress(context);

  try {
    const sourceTypes = Array.from(candidate.sourceTypes).sort();
    const sourceType = candidateSourceType(candidate);
    const initialType = classifyUrl(candidate.url);

    const allowed = await isAllowedByRobots(candidate.url, context.options, context.robotsCache, context.warnings);
    if (!allowed) {
      context.stats.skippedByRobots += 1;
      context.failedDownloads.push({
        asset_url: candidate.url,
        source_types: sourceTypes,
        reason: "robots_txt_disallowed",
        discovery_depth: candidate.discoveryDepth,
        notes: Array.from(candidate.notes).sort()
      });
      return;
    }

    let result;
    try {
      result = await downloadBytes(candidate.url, context.options);
    } catch (error) {
      context.stats.failed += 1;
      context.failedDownloads.push({
        asset_url: candidate.url,
        source_types: sourceTypes,
        reason: error.name === "AbortError" ? "request_timeout" : "download_failed",
        discovery_depth: candidate.discoveryDepth,
        status: error.status || null,
        message: error.message,
        notes: Array.from(candidate.notes).sort()
      });
      return;
    }

    if (looksLikeBlockedHtml(result.bytes, result.contentType, initialType)) {
      context.stats.failed += 1;
      context.failedDownloads.push({
        asset_url: candidate.url,
        source_types: sourceTypes,
        reason: "unexpected_html_or_block_page",
        discovery_depth: candidate.discoveryDepth,
        status: result.status,
        content_type: result.contentType,
        notes: Array.from(candidate.notes).sort()
      });
      return;
    }

    const assetType = classifyUrl(candidate.url, result.contentType);
    const folder = TYPE_DIR[assetType] || TYPE_DIR.unknown;
    const filename = filenameForUrl(candidate.url, result.contentType);
    const localPath = path.join(context.rootDir, folder, filename);
    await fs.writeFile(localPath, result.bytes);
    context.stats.downloaded += 1;
    context.stats.bytesDownloaded += result.bytes.length;

    const notes = Array.from(candidate.notes).sort();
    if (result.finalUrl && result.finalUrl !== candidate.url) {
      notes.push(`redirected_to:${result.finalUrl}`);
    }
    if (result.contentType) {
      notes.push(`content_type:${result.contentType}`);
    }

    context.manifest.push({
      story_url: context.storyUrl,
      timestamp: new Date().toISOString(),
      asset_url: candidate.url,
      final_url: result.finalUrl,
      local_path: localPath,
      asset_type: assetType,
      source_type: sourceType,
      source_types: sourceTypes,
      adaptation_relevance: candidate.adaptationRelevance || "",
      story_prefix_match: candidate.storyPrefixMatch || "",
      discovery_depth: candidate.discoveryDepth,
      file_size: result.bytes.length,
      notes
    });

    if (!isTextScannable(assetType, result.contentType, result.bytes.length)) return;

    const text = result.bytes.toString("utf8");
    for (const match of keywordMatches(text, candidate.url, 80)) {
      pushLimited(context.storyStructure.downloaded_text_matches, match, 600);
    }

    if (
      assetType === "data" &&
      (
        /(?:json|geojson|topojson)$/i.test(urlExtension(candidate.url).replace(".", "")) ||
        result.contentType.toLowerCase().includes("json")
      )
    ) {
      try {
        const jsonValue = JSON.parse(text);
        scanJsonForStructure(jsonValue, candidate.url, context.storyStructure);
      } catch {
        // Non-JSON data files are still useful assets; parsing is best effort only.
      }
    }

    const nextSourceType =
      assetType === "script"
        ? "script_reference"
        : assetType === "data"
          ? "data_reference"
          : assetType === "html"
            ? "html_reference"
            : "inferred";

    for (const ref of extractAssetReferences(text, result.finalUrl || candidate.url)) {
      addCandidate(
        context.candidates,
        ref.url,
        result.finalUrl || candidate.url,
        nextSourceType,
        ref.notes,
        createAddOptions(context, (candidate.discoveryDepth || 0) + 1)
      );
    }
  } finally {
    context.stats.active -= 1;
    context.stats.processed += 1;
    renderProgress(context);
  }
}

async function processQueue(context) {
  let index = 0;
  context.queueIndex = 0;
  while (index < context.queue.length) {
    const batch = [];
    while (batch.length < context.options.concurrency && index < context.queue.length) {
      const candidate = context.queue[index];
      index += 1;
      context.queueIndex = index;
      if (candidate && !context.processed.has(candidate.url)) {
        batch.push(candidate);
      }
    }

    if (batch.length === 0) continue;
    await Promise.all(batch.map((candidate) => processCandidate(candidate, context)));

    for (const candidate of context.candidates.values()) {
      if (!context.enqueued.has(candidate.url)) {
        context.enqueued.add(candidate.url);
        context.queue.push(candidate);
      }
    }
    renderProgress(context);
    await writeProgressSnapshot(context);
  }
  context.queueIndex = context.queue.length;
}

function createFilteredRequests(discovery, candidates, context) {
  const output = [];
  const seen = new Set();

  for (const entry of [...getArray(discovery.filtered_requests), ...getArray(discovery.network_entries)]) {
    const url = entry.url || entry.name || entry.asset_url;
    const normalized = normalizeUrl(url, discovery.story_url || "");
    if (!normalized || !shouldKeepCandidate(normalized, entry.initiatorType || "")) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const relevance = classifyAdaptationRelevance(normalized, {
      profile: context.options.profile,
      storyUrl: discovery.story_url || "",
      storyPrefixes: context.storyPrefixes || [],
      storyTokens: context.storyTokens || [],
      notes: entry.initiatorType || ""
    });
    output.push({
      url: normalized,
      source_type: "network_request",
      initiatorType: entry.initiatorType || "",
      transferSize: entry.transferSize ?? null,
      encodedBodySize: entry.encodedBodySize ?? null,
      decodedBodySize: entry.decodedBodySize ?? null,
      asset_type: classifyUrl(normalized),
      adaptation_relevance: relevance.adaptation_relevance,
      story_prefix_match: relevance.story_prefix_match || "",
      exclusion_reason: relevance.exclusion_reason || "",
      matched_rule: relevance.matched_rule || ""
    });
  }

  for (const candidate of candidates.values()) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    output.push({
      url: candidate.url,
      source_type: candidateSourceType(candidate),
      source_types: Array.from(candidate.sourceTypes).sort(),
      asset_type: classifyUrl(candidate.url),
      adaptation_relevance: candidate.adaptationRelevance || "",
      story_prefix_match: candidate.storyPrefixMatch || "",
      notes: Array.from(candidate.notes).sort()
    });
  }

  return output.sort((a, b) => a.url.localeCompare(b.url));
}

async function main(options) {
  const inputPath = path.resolve(options.input);
  const discovery = await readJson(inputPath);
  const storyUrl = discovery.story_url || "";
  const slug = safeSegment(discovery.slug || storySlugFromUrl(storyUrl), "nyt-story").toLowerCase();
  const detectedStoryPrefixes = detectStoryPrefixes(discovery, options.storyPrefixes);
  const detectedStoryTokens = storyTokens(storyUrl, discovery.slug || slug);
  const rootDir = path.resolve(options.out, `${slug}_${timestampForPath()}`);
  const metadataDir = path.join(rootDir, "metadata");
  const htmlDir = path.join(rootDir, "html");

  await ensureOutputFolders(rootDir);
  if (!options.quiet) {
    console.log(`Output folder: ${rootDir}`);
    console.log(`Profile: ${options.profile}`);
    if (detectedStoryPrefixes.length) {
      console.log("Story prefixes:");
      for (const prefix of detectedStoryPrefixes) console.log(`- ${prefix}`);
    }
  }

  const candidates = new Map();
  const storyStructure = createStoryStructure(discovery);
  const context = {
    options,
    rootDir,
    metadataDir,
    storyUrl,
    storySlug: slug,
    storyPrefixes: detectedStoryPrefixes,
    storyTokens: detectedStoryTokens,
    candidates,
    queue: [],
    queueIndex: 0,
    enqueued: new Set(),
    processed: new Set(),
    robotsCache: new Map(),
    manifest: [],
    failedDownloads: [],
    excludedAssets: new Map(),
    warnings: [],
    storyStructure,
    stats: createStats(),
    phase: "seed candidates",
    progressTimer: null,
    lastProgressRender: 0,
    limitSkipKeys: new Set()
  };

  setPhase(context, "seed candidates");
  seedCandidates(discovery, candidates, context);

  if (discovery.html) {
    await fs.writeFile(path.join(htmlDir, "page.html"), discovery.html, "utf8");
    for (const match of keywordMatches(discovery.html, "page_html", 120)) {
      pushLimited(storyStructure.downloaded_text_matches, match, 600);
    }
  }

  context.queue = Array.from(candidates.values());
  context.enqueued = new Set(candidates.keys());
  await writeProgressSnapshot(context);

  startProgress(context);
  setPhase(context, "download/scan queue");
  try {
    await processQueue(context);
    setPhase(context, "write manifests");

    const filteredRequests = createFilteredRequests(discovery, candidates, context);
    const sourceDiscovery = {
      input_file: inputPath,
      output_root: rootDir,
      story_url: storyUrl,
      filter_profile: options.profile,
      story_prefixes: detectedStoryPrefixes,
      timestamp: new Date().toISOString(),
      collector_tool: discovery.tool || "",
      collector_version: discovery.version || "",
      candidates: Array.from(candidates.values()).map(candidateToJson).sort((a, b) => a.url.localeCompare(b.url)),
      notes: discovery.notes || []
    };

    await writeJson(path.join(metadataDir, "source_discovery.json"), sourceDiscovery);
    await writeJson(path.join(metadataDir, "filtered_requests.json"), filteredRequests);
    await writeJson(path.join(metadataDir, "asset_manifest.json"), context.manifest.sort((a, b) => a.asset_url.localeCompare(b.asset_url)));
    await writeJson(path.join(metadataDir, "story_structure_candidates.json"), storyStructure);
    await writeJson(path.join(metadataDir, "failed_downloads.json"), context.failedDownloads.sort((a, b) => a.asset_url.localeCompare(b.asset_url)));
    await writeJson(path.join(metadataDir, "excluded_assets.json"), Array.from(context.excludedAssets.values()).sort((a, b) => a.asset_url.localeCompare(b.asset_url)));
    setPhase(context, "done");
  } finally {
    await stopProgress(context);
  }

  const countByType = context.manifest.reduce((acc, item) => {
    acc[item.asset_type] = (acc[item.asset_type] || 0) + 1;
    return acc;
  }, {});

  const output = {
    models: countByType.model || 0,
    textures: countByType.texture || 0,
    data_files: countByType.data || 0,
    scripts_inspected: countByType.script || 0,
    manifest_path: path.join(metadataDir, "asset_manifest.json"),
    output_root: rootDir,
    total_discovered: candidates.size,
    filter_profile: options.profile,
    story_prefixes: detectedStoryPrefixes,
    failed_downloads: context.failedDownloads.length,
    excluded_assets: context.excludedAssets.size,
    skipped_by_robots: context.stats.skippedByRobots,
    skipped_by_limits: context.stats.skippedByLimits,
    skipped_by_relevance: context.stats.skippedByRelevance,
    bytes_downloaded: context.stats.bytesDownloaded,
    warnings: context.warnings
  };

  console.log(`Output folder: ${output.output_root}`);
  console.log(`Filter profile: ${output.filter_profile}`);
  console.log(`Total discovered URLs: ${output.total_discovered}`);
  console.log(`Model assets found: ${output.models}`);
  console.log(`Texture assets found: ${output.textures}`);
  console.log(`Data files found: ${output.data_files}`);
  console.log(`Scripts inspected: ${output.scripts_inspected}`);
  console.log(`Bytes downloaded: ${formatBytes(output.bytes_downloaded)}`);
  console.log(`Manifest: ${output.manifest_path}`);
  if (output.failed_downloads) {
    console.log(`Failed downloads logged: ${output.failed_downloads}`);
  }
  console.log(`Excluded as not adaptation-relevant: ${output.excluded_assets}`);
  console.log(`Skipped by robots.txt: ${output.skipped_by_robots}`);
  console.log(`Skipped by limits: ${output.skipped_by_limits}`);
  console.log(`Skipped by relevance filter: ${output.skipped_by_relevance}`);
  if (output.warnings.length) {
    console.log("Warnings:");
    for (const warning of output.warnings) {
      console.log(`- ${warning}`);
    }
  }

  return output;
}

async function runSelfTest() {
  assert.equal(classifyUrl("https://example.com/a/model.glb"), "model");
  assert.equal(classifyUrl("https://example.com/a/mesh.bin?x=1"), "model");
  assert.equal(classifyUrl("https://example.com/a/texture.webp"), "texture");
  assert.equal(classifyUrl("https://example.com/a/data.geojson"), "data");
  assert.equal(classifyUrl("https://example.com/a/app.mjs"), "script");
  assert.equal(classifyUrl("https://example.com/a/no-extension", "application/json"), "data");

  assert.equal(
    normalizeUrl("/assets/model.glb?x=1#frag", "https://www.nytimes.com/interactive/story.html"),
    "https://www.nytimes.com/assets/model.glb?x=1"
  );

  const name = filenameForUrl("https://static01.nyt.com/newsgraphics/story/assets/model.glb?cache=1");
  assert.match(name, /^model-[a-f0-9]{12}\.glb$/);

  const refs = extractAssetReferences(
    `const a = "/assets/model.glb"; const b = "https:\\/\\/static01.nyt.com/foo/texture.webp";`,
    "https://www.nytimes.com/interactive/story.html"
  );
  assert.equal(refs.length, 2);
  assert(refs.some((ref) => ref.url === "https://www.nytimes.com/assets/model.glb"));
  assert(refs.some((ref) => ref.url === "https://static01.nyt.com/foo/texture.webp"));

  const candidates = new Map();
  addCandidate(candidates, "/assets/model.glb", "https://www.nytimes.com/interactive/story.html", "html_reference");
  addCandidate(candidates, "https://www.nytimes.com/assets/model.glb", "https://www.nytimes.com/interactive/story.html", "network_request");
  assert.equal(candidates.size, 1);
  assert.deepEqual(Array.from(candidates.values())[0].sourceTypes, new Set(["html_reference", "network_request"]));
  assert.equal(Array.from(candidates.values())[0].discoveryDepth, 0);

  const limitContext = {
    options: {
      maxDepth: 0,
      maxCandidates: 1
    },
    failedDownloads: [],
    stats: createStats(),
    limitSkipKeys: new Set()
  };
  const depthLimitedCandidates = new Map();
  addCandidate(
    depthLimitedCandidates,
    "/assets/deep-model.glb",
    "https://www.nytimes.com/interactive/story.html",
    "script_reference",
    "deep ref",
    createAddOptions(limitContext, 1)
  );
  assert.equal(depthLimitedCandidates.size, 0);
  assert.equal(limitContext.failedDownloads[0].reason, "max_depth_exceeded");
  assert.equal(limitContext.stats.skippedByLimits, 1);

  const countLimitedCandidates = new Map();
  addCandidate(
    countLimitedCandidates,
    "/assets/one.glb",
    "https://www.nytimes.com/interactive/story.html",
    "html_reference",
    "",
    createAddOptions(limitContext, 0)
  );
  addCandidate(
    countLimitedCandidates,
    "/assets/two.glb",
    "https://www.nytimes.com/interactive/story.html",
    "html_reference",
    "",
    createAddOptions(limitContext, 0)
  );
  assert.equal(countLimitedCandidates.size, 1);
  assert.equal(limitContext.failedDownloads.at(-1).reason, "max_candidates_exceeded");

  const progressContext = {
    options: {
      maxDepth: 3,
      maxCandidates: 2000,
      profile: "adaptation"
    },
    stats: {
      ...createStats(),
      processed: 2,
      downloaded: 1,
      failed: 1,
      skippedByRobots: 1,
      skippedByLimits: 2,
      bytesDownloaded: 2048,
      active: 1
    },
    phase: "self-test",
    candidates: countLimitedCandidates,
    queue: Array.from(countLimitedCandidates.values()),
    queueIndex: 0,
    rootDir: "/tmp/out"
  };
  const snapshot = progressSnapshot(progressContext);
  assert.equal(snapshot.phase, "self-test");
  assert.equal(snapshot.downloaded, 1);
  assert.equal(snapshot.skipped, 3);
  assert.equal(snapshot.bytes_downloaded_human, "2.00 KB");

  const fixtureDiscovery = {
    story_url: "https://www.nytimes.com/interactive/2025/04/17/opinion/global-migration-facebook-data.html",
    slug: "global-migration-facebook-data",
    filtered_requests: [
      {
        url: "https://static01.nytimes.com/newsgraphics/2024-03-08-fb-migration/abc123/_assets/world/gltf/earth.glb",
        initiatorType: "fetch"
      },
      {
        url: "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
        initiatorType: "script"
      }
    ],
    script_src_urls: [
      "https://static01.nytimes.com/newsgraphics/2024-03-08-fb-migration/abc123/_assets/_app/immutable/chunks/world.L3ycZvZ6.js"
    ],
    dom_asset_references: [
      {
        url: "https://static01.nyt.com/images/2025/04/17/opinion/17migrations-still-facebookJumbo-v2.jpg"
      }
    ],
    network_entries: []
  };
  const detectedPrefixes = detectStoryPrefixes(fixtureDiscovery, []);
  assert.deepEqual(detectedPrefixes, [
    "https://static01.nytimes.com/newsgraphics/2024-03-08-fb-migration/abc123/_assets/"
  ]);
  const fixtureTokens = storyTokens(fixtureDiscovery.story_url, fixtureDiscovery.slug);
  assert(fixtureTokens.includes("migration"));

  const alphaSlide = "Alpha slide text that is long enough to be treated as a real narrative beat.";
  const betaSlide = "Beta slide text that is also long enough to be treated as a real narrative beat.";
  const headlineText = "A fixture headline that also appears in the legacy heading bucket.";
  const bodyText = "This fixture body paragraph should be preserved as narrative text only.";
  const subheadText = "Fixture subhead text for narrative context.";
  const cleanedStructure = createStoryStructure({
    title: "Fixture",
    story_structure_candidates: {
      h1: [
        { text: headlineText, category: "heading", domOrder: 1 }
      ],
      text_only_parts: [
        { text: headlineText, category: "text_only_part", subtype: "headline", domOrder: 1 },
        { text: bodyText, category: "text_only_part", subtype: "body", domOrder: 3 },
        { text: bodyText, category: "text_only_part", subtype: "body", domOrder: 3 },
        { text: subheadText, category: "text_only_part", subtype: "subhead", domOrder: 4 },
        { text: "undefined", category: "text_only_part", subtype: "body", domOrder: 5 }
      ],
      slides: [
        { text: `${alphaSlide} ${betaSlide}`, attributes: { class: "g-slide-container" }, domOrder: 10 },
        { text: alphaSlide, attributes: { class: "g-slide-text" }, domOrder: 11 },
        { text: alphaSlide, attributes: { class: "g-slide-text-annotation" }, domOrder: 11 },
        { text: betaSlide, attributes: { class: "g-slide-text" }, domOrder: 12 },
        { text: "undefined", attributes: { class: "g-slide-text-athlete-name" }, domOrder: 13 }
      ],
      captions: [
        { text: "The New York Times" },
        { text: "The New York Times" }
      ]
    }
  });
  assert.equal(cleanedStructure.slides.length, 3);
  assert.deepEqual(cleanedStructure.slides.filter((item) => item.text).map((item) => item.text), [alphaSlide, betaSlide]);
  assert.equal(cleanedStructure.slides.at(-1).text, undefined);
  assert.equal(cleanedStructure.captions.length, 1);
  assert.deepEqual(cleanedStructure.text_only_parts.map((item) => item.text), [headlineText, bodyText, subheadText]);
  assert.equal(cleanedStructure.text_only_parts[0].subtype, "headline");
  assert.equal(cleanedStructure.text_only_parts.at(-1).domOrder, 4);

  const storyRelevance = classifyAdaptationRelevance(
    "https://static01.nytimes.com/newsgraphics/2024-03-08-fb-migration/abc123/_assets/world/gltf/earth.glb",
    {
      profile: "adaptation",
      storyUrl: fixtureDiscovery.story_url,
      storyPrefixes: detectedPrefixes,
      storyTokens: fixtureTokens
    }
  );
  assert.equal(storyRelevance.include, true);
  assert.equal(storyRelevance.adaptation_relevance, "core_story");

  const adRelevance = classifyAdaptationRelevance("https://securepubads.g.doubleclick.net/tag/js/gpt.js", {
    profile: "adaptation",
    storyUrl: fixtureDiscovery.story_url,
    storyPrefixes: detectedPrefixes,
    storyTokens: fixtureTokens
  });
  assert.equal(adRelevance.include, false);
  assert.equal(adRelevance.adaptation_relevance, "tracking_excluded");

  const gameRelevance = classifyAdaptationRelevance("https://www.nytimes.com/games-assets/v2/assets/icons/wordle.svg", {
    profile: "adaptation",
    storyUrl: fixtureDiscovery.story_url,
    storyPrefixes: detectedPrefixes,
    storyTokens: fixtureTokens
  });
  assert.equal(gameRelevance.include, false);
  assert.equal(gameRelevance.adaptation_relevance, "platform_excluded");

  const videoLibraryRelevance = classifyAdaptationRelevance("https://static01.nyt.com/video-static/vhs3/vhs.min.js", {
    profile: "adaptation",
    storyUrl: fixtureDiscovery.story_url,
    storyPrefixes: detectedPrefixes,
    storyTokens: fixtureTokens,
    baseUrl: "https://static01.nytimes.com/newsgraphics/2024-03-08-fb-migration/abc123/_assets/world.js"
  });
  assert.equal(videoLibraryRelevance.include, false);
  assert.equal(videoLibraryRelevance.adaptation_relevance, "platform_excluded");

  const stillRelevance = classifyAdaptationRelevance("https://static01.nyt.com/images/2025/04/17/opinion/17migrations-still-facebookJumbo-v2.jpg", {
    profile: "adaptation",
    storyUrl: fixtureDiscovery.story_url,
    storyPrefixes: detectedPrefixes,
    storyTokens: fixtureTokens
  });
  assert.equal(stillRelevance.include, true);
  assert.equal(stillRelevance.adaptation_relevance, "supporting_story");

  const archiveRelevance = classifyAdaptationRelevance("https://securepubads.g.doubleclick.net/tag/js/gpt.js", {
    profile: "archive",
    storyUrl: fixtureDiscovery.story_url,
    storyPrefixes: detectedPrefixes,
    storyTokens: fixtureTokens
  });
  assert.equal(archiveRelevance.include, true);
  assert.equal(archiveRelevance.adaptation_relevance, "archive");

  const filterContext = {
    options: {
      maxDepth: 3,
      maxCandidates: 2000,
      profile: "adaptation"
    },
    storyUrl: fixtureDiscovery.story_url,
    storySlug: fixtureDiscovery.slug,
    storyPrefixes: detectedPrefixes,
    storyTokens: fixtureTokens,
    excludedAssets: new Map(),
    failedDownloads: [],
    stats: createStats(),
    limitSkipKeys: new Set()
  };
  const filteredCandidates = new Map();
  addCandidate(
    filteredCandidates,
    "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
    fixtureDiscovery.story_url,
    "network_request",
    "script",
    createAddOptions(filterContext, 0)
  );
  assert.equal(filteredCandidates.size, 0);
  assert.equal(filterContext.excludedAssets.size, 1);
  assert.equal(Array.from(filterContext.excludedAssets.values())[0].exclusion_reason, "tracking_or_adtech");

  addCandidate(
    filteredCandidates,
    "https://static01.nytimes.com/newsgraphics/2024-03-08-fb-migration/abc123/_assets/world.K37dL5T.css",
    fixtureDiscovery.story_url,
    "html_reference",
    "story css",
    createAddOptions(filterContext, 0)
  );
  assert.equal(filteredCandidates.size, 1);
  assert.equal(Array.from(filteredCandidates.values())[0].adaptationRelevance, "core_story");

  console.log("Self-test passed.");
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
} else if (options.selfTest) {
  await runSelfTest();
} else {
  if (!options.input) {
    printHelp();
    process.exitCode = 1;
  } else {
    try {
      await main(options);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
