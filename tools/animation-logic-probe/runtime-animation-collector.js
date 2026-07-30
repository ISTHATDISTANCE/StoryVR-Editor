/*
 * NYTimes runtime animation evidence collector.
 *
 * Usage:
 * 1. Open an NYTimes visual/interactive story in the browser.
 * 2. Paste this entire file into DevTools console.
 * 3. The collector auto-scrolls the live page and downloads:
 *      nyt_animation_probe_<slug>.json
 *
 * Manual controls:
 *   NYTAnimationProbe.enableViewportCapture()
 *   NYTAnimationProbe.autoRun()
 *   NYTAnimationProbe.autoScroll()
 *   NYTAnimationProbe.exploreVariants()
 *   NYTAnimationProbe.registerRuntime3D({ renderer, scene, camera, mixer, models })
 *   NYTAnimationProbe.export()
 *   NYTAnimationProbe.stop()
 *
 * This snippet does not read cookies, localStorage, sessionStorage,
 * credentials, or private browser state. It records page-observable
 * resources, DOM references, inline/script evidence windows, scroll
 * snapshots, and one best-effort primary-canvas image per scroll target.
 */
(() => {
  "use strict";

  try {
    window.NYTAnimationProbe?.stop?.();
  } catch {
    // A previous collector may be partially installed. The new probe can still continue.
  }

  const VERSION = "0.17.0";
  const CONTEXT_RADIUS = 260;
  const MAX_INLINE_TEXT = 160_000;
  const MAX_KEYWORD_WINDOWS = 260;
  const MAX_ACTIVE_TEXTS = 8;
  const MAX_ATTR_VALUE = 5000;
  const MAX_SNAPSHOTS = 520;
  const ABSOLUTE_MAX_SNAPSHOTS = 2400;
  const MAX_RUNTIME_MODELS = 48;
  const MAX_RUNTIME_PARTS_PER_MODEL = 120;
  const MAX_RUNTIME_ACTIONS_PER_MODEL = 80;
  const MAX_RUNTIME_PARTS_PER_SNAPSHOT = 240;
  const MAX_RUNTIME_SPATIAL_PARTS_PER_SNAPSHOT = 320;
  const MAX_RUNTIME_ACTIONS_PER_SNAPSHOT = 320;
  const MAX_RUNTIME_SPATIAL_RELATION_CLUES = 96;
  const MAX_RUNTIME_BRIDGE_RELATION_HINTS = 120;
  const MAX_RUNTIME_GEOMETRY_FINGERPRINT_SAMPLES = 96;
  const MAX_RUNTIME_DISCOVERY_OBJECTS = 900;
  const MAX_RUNTIME_DISCOVERY_DEPTH = 3;
  const MAX_RUNTIME_BRIDGE_OBJECTS = 480;
  const MAX_RUNTIME_BRIDGE_DEPTH = 5;
  const MAX_RUNTIME_ADVANCE_SAMPLES = 180;
  const MAX_SCROLL_TARGET_SCREENSHOTS = 800;
  const MAX_VARIANT_STATE_SCREENSHOTS = 800;
  const MAX_VARIANT_OPTIONS_PER_GROUP = 12;
  const MAX_VARIANT_DEPENDENCY_DEPTH = 8;
  const MAX_VARIANT_DEPENDENCY_TRANSITIONS = 600;
  const SCREENSHOT_MAX_WIDTH = 960;
  const SCREENSHOT_MAX_HEIGHT = 720;
  const CONTACT_SHEET_FRAME_COUNT = 6;
  const CONTACT_SHEET_COLUMNS = 3;
  const CONTACT_SHEET_TILE_WIDTH = 400;
  const CONTACT_SHEET_TILE_HEIGHT = 360;
  const RUNTIME_HOOK_MARKER = "__storyvrAnimationProbeHook";
  const RUNTIME_HOOK_ORIGINAL = "__storyvrAnimationProbeOriginal";
  const RUNTIME_HOOK_OWNER = `storyvr-animation-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const RUNTIME_BRIDGE_EVENT = "storyvr-animation-probe:request-runtime";
  const RUNTIME_BRIDGE_GLOBAL_KEYS = [
    "__STORYVR_ANIMATION_PROBE_RUNTIME__",
    "__STORYVR_ANIMATION_PROBE_RUNTIMES__",
    "NYTAnimationProbeRuntime",
    "g_webgl"
  ];
  const RUNTIME_HANDLE_KEY_PATTERN = /(?:storyvr.*runtime|animation.*probe|three|webgl|renderer|scene|camera|mixer|gltf|model|r3f|fiber)/i;

  const EXTENSIONS = [
    ".glb",
    ".gltf",
    ".bin",
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".csv",
    ".geojson",
    ".topojson"
  ];

  const MODEL_EXTENSIONS = [".glb", ".gltf"];
  const SCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs"];
  const DATA_EXTENSIONS = [".json", ".csv", ".geojson", ".topojson"];
  const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

  const KEYWORDS = [
    "glb",
    "gltf",
    "animation",
    "animations",
    "AnimationMixer",
    "clipAction",
    "setTime",
    "timeScale",
    "mixer",
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
    "three",
    "camera",
    "models",
    "slides",
    "data-params"
  ];

  const resourceMap = new Map();
  const snapshots = [];
  const snapshotKeys = new Set();
  const scrollTargetScreenshots = [];
  const scrollTargetContactSheets = [];
  const variantStateScreenshots = [];
  const variantGroupRuntimeRefs = new Map();
  const variantGroupRegistry = new Map();
  const exploredVariantGroupIds = new Set();
  const nestedVariantGroupIds = new Set();
  const variantInteractionRecords = [];
  const variantAssetAssociationMap = new Map();
  const variantHierarchyMap = new Map();
  const variantDependencyCycles = [];
  const variantRecoveryBaselines = new Map();
  const scrollTraversalRecords = [];
  const documentOutcomeElementKeyMap = new WeakMap();
  const documentOutcomeStructuralKeyMap = new Map();
  let documentOutcomeElementKeySerial = 0;
  let viewportCapturePrompt = null;
  const viewportCaptureState = {
    status: "not-enabled",
    stream: null,
    track: null,
    video: null,
    displaySurface: "",
    enabledAt: "",
    error: ""
  };
  let observer = null;
  let lastResourceAt = performance.now();
  let stopRequested = false;
  let autoRunPromise = null;
  let autoRunTimer = null;
  let lastScrollEventAt = -Infinity;
  let runtimeScrollHandler = null;
  let beatChangeTimer = null;
  let lastObservedBeatKey = "";
  let snapshotLimit = MAX_SNAPSHOTS;
  let variantDependencyTransitionCount = 0;
  const captureCoverage = {
    strategy: "two-top-to-bottom-passes-with-progressive-recovery/v3",
    detectedBeatTargetCount: 0,
    plannedScrollTargetCount: 0,
    visitedScrollTargetCount: 0,
    screenshotPlannedCount: 0,
    screenshotCaptureCount: 0,
    screenshotFailureCount: 0,
    viewportScreenshotCaptureCount: 0,
    canvasFallbackCaptureCount: 0,
    canvasCropCaptureCount: 0,
    beatChangeSnapshotCount: 0,
    snapshotLimit,
    reachedSnapshotLimit: false,
    skippedScrollTargetCount: 0,
    stoppedEarly: false,
    documentGrowthDetected: false,
    variantGroupDetectedCount: 0,
    variantGroupExploredCount: 0,
    nestedVariantGroupCount: 0,
    variantHierarchyCount: 0,
    variantOptionStateCaptureCount: 0,
    variantClickAttemptCount: 0,
    variantClickSuccessCount: 0,
    variantDocumentWideObservationCount: 0,
    variantDocumentWideChangeCount: 0,
    variantDocumentWideMutationCount: 0,
    variantDocumentWideScrollEventCount: 0,
    variantDocumentWideUnsettledCount: 0,
    variantExplorationFailureCount: 0,
    variantRestorationFailureCount: 0,
    variantUniqueGroupExploredCount: 0,
    variantExplorationPassCount: 0,
    variantEagerPassCount: 0,
    variantViewportAlignedPassCount: 0,
    variantControlTargetCount: 0,
    variantStateScreenshotPlannedCount: 0,
    variantStateScreenshotCaptureCount: 0,
    variantStateScreenshotFailureCount: 0,
    activePassCount: 0,
    pass1PlannedTargetCount: 0,
    pass1VisitedTargetCount: 0,
    recoveryPlannedTargetCount: 0,
    recoveryVisitedTargetCount: 0,
    recoveryMismatchCount: 0,
    recoveryMismatchedTargetCount: 0,
    recoveryTopMismatchCount: 0,
    recoveryStatus: "not-run",
    recoveryRepairAttemptCount: 0,
    recoveryRepairFailureCount: 0,
    pass2PlannedTargetCount: 0,
    pass2VisitedTargetCount: 0,
    pass2SkippedReason: "",
    variantDependencyObservationCount: 0,
    variantDependencyConfirmedCount: 0,
    variantDependencyRejectedCount: 0,
    variantDependencyCycleGuardCount: 0,
    variantDependencyTransitionBudget: MAX_VARIANT_DEPENDENCY_TRANSITIONS,
    variantDependencyTransitionCount: 0,
    variantRecoveryTransitionCount: 0,
    variantDependencyTransitionBudgetReached: false
  };

  const runtime3dState = {
    installedAt: null,
    lastDiscoveryAt: null,
    lastDiscoveryElapsedMs: -Infinity,
    renderCount: 0,
    modelLoadCount: 0,
    discoveredObjectCount: 0,
    bridgeRegistrationCount: 0,
    bridgeRequestCount: 0,
    domRuntimeHandleCount: 0,
    modelSerial: 0,
    sceneSerial: 0,
    mixerSerial: 0,
    objectSerial: 0,
    geometrySerial: 0,
    partCatalogSerial: 0,
    containerSerial: 0,
    catalogRevision: 0,
    renderers: new Set(),
    scenes: new Map(),
    models: new Map(),
    mixers: new Map(),
    objectIds: new WeakMap(),
    geometryRecords: new Map(),
    geometryCache: new WeakMap(),
    partCatalogRecords: new Map(),
    containerRecords: new Map(),
    compositionRecords: new Map(),
    frameRecords: new Map(),
    sourceRecords: new Map(),
    explicitSpatialRelationships: [],
    explicitSpatialRelationshipKeys: new Set(),
    relationshipHistory: new Map(),
    patchedNamespaces: new Set(),
    patchedRendererPrototypes: new Set(),
    patchedLoaderPrototypes: new Set(),
    patchedMixerPrototypes: new Set(),
    registeredBridgeRoots: new WeakSet(),
    capabilities: {
      globalThreeNamespaceFound: false,
      rendererHooked: false,
      gltfLoaderHooked: false,
      animationMixerHooked: false,
      requireJsModulesInspected: false,
      existingRuntimeObjectsDiscovered: false,
      runtimeBridgeFound: false,
      domRuntimeHandlesInspected: false,
      instanceMixerHooked: false
    },
    limitations: new Set([
      "Direct Three.js state is best-effort: bundled runtimes that expose neither a Three namespace nor reachable renderer/scene/mixer objects cannot be instrumented after page load.",
      "Because the collector is installed after page load, earlier GLTFLoader callbacks may be missed; reachable scene children and mixer roots are retained with weaker asset identity when possible.",
      "Methods bound before installation are captured only when their owning renderer or mixer is reachable or explicitly registered through the runtime bridge.",
      "A runtime kept entirely inside a module closure still requires pre-load instrumentation or an explicit runtime bridge registration.",
      "Model renderEligible requires structural eligibility plus a recent screen render on a CSS/viewport-visible renderer canvas; it still does not prove frustum inclusion, lack of occlusion, or pixel contribution. Offscreen passes are retained separately as renderContributionCandidate.",
      "A running AnimationAction does not by itself make its model or target part visible.",
      "Spatial relationship clues are bounded geometric candidates only. They require an explicit bridge/source/frame/container hint or a shared non-scene parent corroborated by direct asset identity; co-loading and beat co-occurrence never establish composition.",
      "Geometry bounds derived from static position attributes are approximate for skinned, morphed, displaced, instanced, or otherwise deformed renderables."
    ])
  };

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hashString(value) {
    let hash = 5381;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function safeSlug(value) {
    const cleaned = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90);
    return cleaned || `nyt-story-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }

  function getStorySlug() {
    try {
      const url = new URL(location.href);
      const pathParts = url.pathname.split("/").filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || document.title || "nyt-story";
      return safeSlug(lastPart.replace(/\.[a-z0-9]+$/i, ""));
    } catch {
      return safeSlug(document.title || "nyt-story");
    }
  }

  function normalizeUrl(rawValue, base = location.href) {
    if (!rawValue || typeof rawValue !== "string") return null;

    let value = rawValue
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/\\\//g, "/")
      .replace(/^[("'`]+/, "")
      .replace(/[)"'`,;}\]]+$/g, "");

    if (!value) return null;
    if (/^(data|blob|javascript|mailto|tel):/i.test(value)) return null;
    if (value.startsWith("//")) value = `${location.protocol}${value}`;

    try {
      const url = new URL(value, base);
      if (!/^https?:$/i.test(url.protocol)) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  function urlExtension(url) {
    try {
      const parsed = new URL(url, location.href);
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

  function classifyUrl(url) {
    const ext = urlExtension(url);
    if (MODEL_EXTENSIONS.includes(ext)) return "model";
    if (SCRIPT_EXTENSIONS.includes(ext)) return "script";
    if (DATA_EXTENSIONS.includes(ext)) return "data";
    if (IMAGE_EXTENSIONS.includes(ext)) return "image";
    if (ext === ".bin") return "model-binary";
    return hasKeyword(url) ? "candidate" : "other";
  }

  function isCandidateUrl(url, extraText = "") {
    const ext = urlExtension(url);
    return EXTENSIONS.includes(ext) || hasKeyword(`${url} ${extraText}`);
  }

  function addResourceEntry(entry, observed = false) {
    if (!entry || !entry.name) return;
    const url = normalizeUrl(entry.name);
    if (!url) return;
    if (observed) lastResourceAt = performance.now();

    const previous = resourceMap.get(url);
    const record = {
      url,
      name: entry.name,
      assetType: classifyUrl(url),
      initiatorType: entry.initiatorType || "",
      startTime: Number.isFinite(entry.startTime) ? Number(entry.startTime.toFixed(3)) : null,
      duration: Number.isFinite(entry.duration) ? Number(entry.duration.toFixed(3)) : null,
      transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
      encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
      decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
      nextHopProtocol: entry.nextHopProtocol || "",
      candidate: isCandidateUrl(url, entry.initiatorType || "")
    };

    if (!previous || (record.startTime ?? 0) < (previous.startTime ?? Infinity)) {
      resourceMap.set(url, record);
    }
  }

  function seedPerformanceEntries() {
    for (const entry of performance.getEntriesByType("resource")) {
      addResourceEntry(entry);
    }
  }

  function startObserver() {
    seedPerformanceEntries();
    if (!("PerformanceObserver" in window)) return;
    if (observer) observer.disconnect();

    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        addResourceEntry(entry, true);
      }
    });

    try {
      observer.observe({ type: "resource", buffered: true });
    } catch {
      observer.observe({ entryTypes: ["resource"] });
    }
  }

  function extractCssUrls(value) {
    const urls = [];
    const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let match;
    while ((match = pattern.exec(String(value || "")))) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
  }

  function parseSrcset(value) {
    return String(value || "")
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function parseSrcsetEntries(value) {
    return String(value || "")
      .split(",")
      .map((part) => {
        const pieces = part.trim().split(/\s+/).filter(Boolean);
        const url = normalizeUrl(pieces[0] || "");
        if (!url) return null;
        return {
          url,
          descriptor: pieces.slice(1).join(" ")
        };
      })
      .filter(Boolean);
  }

  function sourceAttributesForElement(element) {
    const attributes = {};
    for (const attribute of Array.from(element?.attributes || [])) {
      if (!attribute.name) continue;
      if (attribute.name === "style") {
        attributes.style = String(attribute.value || "").slice(0, 1200);
      } else if (
        ["src", "srcset", "href", "alt", "title", "aria-label", "role"].includes(attribute.name)
        || attribute.name.startsWith("data-")
      ) {
        attributes[attribute.name] = String(attribute.value || "").slice(0, 1200);
      }
    }
    return attributes;
  }

  function elementClassName(element) {
    return typeof element?.className === "string" ? element.className : "";
  }

  function isRootOrChromeElement(element) {
    if (!element?.tagName) return true;
    const tag = element.tagName.toLowerCase();
    if (["html", "body", "head", "meta", "link", "script", "style", "nav", "header", "footer", "aside"].includes(tag)) {
      return true;
    }
    const text = `${tag} ${element.id || ""} ${elementClassName(element)} ${element.getAttribute?.("role") || ""}`.toLowerCase();
    if (/\b(navigation|navbar|masthead|menu|footer|share|social|subscribe|newsletter|recirculation|related|comments|ad-|ad_|advert|meter|login|account)\b/.test(text)) {
      return true;
    }
    return Boolean(element.closest?.("nav, header, footer, aside, [role='navigation']"));
  }

  function variantControlIsStoryContent(element) {
    if (!element?.tagName) return false;
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "a" || cleanText(element.getAttribute?.("href"))) return false;
    try {
      if (element.closest?.("[data-storyvr-probe-ui],header,footer,aside")) return false;
    } catch {
      return false;
    }
    const identity = [
      tag,
      cleanText(element.id),
      elementClassName(element),
      cleanText(element.getAttribute?.("role")),
      cleanText(element.getAttribute?.("data-testid")),
      cleanText(element.getAttribute?.("aria-label")),
      cleanText(element.getAttribute?.("title")),
      cleanText(element.textContent)
    ].join(" ").toLowerCase();
    if (/\b(masthead|menu|footer|share|social|subscribe|newsletter|recirculation|related|comments?|advert|meter|login|account|search)\b|\b(?:next|previous)\s+(?:story|article|page)\b/.test(identity)) {
      return false;
    }
    for (let current = element.parentElement, depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const ancestorIdentity = [
        cleanText(current.id),
        elementClassName(current),
        cleanText(current.getAttribute?.("role")),
        cleanText(current.getAttribute?.("data-testid"))
      ].join(" ").toLowerCase();
      if (/\b(masthead|sharetools?|actionbar|subscribe|newsletter|recirculation|related-content|comments?|advert|meter|login|account|site-index)\b/.test(ancestorIdentity)) {
        return false;
      }
      if (["main", "article"].includes(String(current.tagName || "").toLowerCase())) break;
    }

    let localNav = null;
    try {
      localNav = element.closest?.("nav,[role='navigation']") || null;
    } catch {
      return false;
    }
    if (!localNav) return !isRootOrChromeElement(element);
    const navIdentity = [
      cleanText(localNav.id),
      elementClassName(localNav),
      cleanText(localNav.getAttribute?.("aria-label")),
      cleanText(localNav.getAttribute?.("data-testid"))
    ].join(" ").toLowerCase();
    if (/\b(masthead|menu|footer|share|social|subscribe|newsletter|recirculation|related|comments?|advert|meter|login|account|search)\b/.test(navIdentity)) {
      return false;
    }
    try {
      const links = Array.from(localNav.querySelectorAll?.("a[href]") || []);
      const buttons = Array.from(localNav.querySelectorAll?.("button,[role='button']") || []);
      if (links.length || buttons.length > MAX_VARIANT_OPTIONS_PER_GROUP + 2) return false;
    } catch {
      return false;
    }
    return true;
  }

  function hasBackgroundImage(element) {
    const inline = element?.getAttribute?.("style") || "";
    if (/background-image\s*:/i.test(inline)) return true;
    try {
      return /\burl\(/i.test(window.getComputedStyle(element).backgroundImage || "");
    } catch {
      return false;
    }
  }

  function isAcceptedImageContainer(element) {
    if (!element || isRootOrChromeElement(element)) return false;
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    const className = elementClassName(element).toLowerCase();
    if (["figure", "picture"].includes(tag)) return true;
    if (tag === "img") return true;
    if (/\bg-image\b|\bg-photo\b|\bimage-ready\b|\bstory-image\b|\bstory-photo\b/.test(className)) return true;
    if (hasBackgroundImage(element) && /\b(g-image|g-photo|story-image|story-photo|media|hero|cover|photo)\b/.test(className)) return true;
    return false;
  }

  function elementSummary(element, fallbackIndex = 0) {
    if (!element) {
      return {
        selector: "",
        tag: "",
        idAttribute: "",
        className: "",
        attributes: {},
        domOrder: 1_000_000 + fallbackIndex
      };
    }
    const rect = element.getBoundingClientRect();
    const absoluteTop = (window.scrollY || window.pageYOffset || 0) + (Number.isFinite(rect.top) ? rect.top : 0);
    const maxY = Math.max(1, documentHeight() - window.innerHeight);
    const scrollPercent = Math.max(0, Math.min(100, (absoluteTop / maxY) * 100));
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    const id = element.id || "";
    const className = typeof element.className === "string" ? element.className.trim().slice(0, 500) : "";
    const selector = id
      ? `${tag}#${id}`
      : className
        ? `${tag}.${className.split(/\s+/).filter(Boolean).slice(0, 4).join(".")}`
        : tag;
    return {
      selector,
      tag,
      idAttribute: id,
      className,
      attributes: sourceAttributesForElement(element),
      domOrder: Math.round(scrollPercent * 1000) + fallbackIndex / 1000
    };
  }

  function textRecordForElement(element, category, fallbackIndex = 0) {
    if (!element) return null;
    const text = cleanText(element.textContent);
    if (!text) return null;
    const summary = elementSummary(element, fallbackIndex);
    return {
      category,
      selector: summary.selector,
      tag: summary.tag,
      idAttribute: summary.idAttribute,
      className: summary.className,
      attributes: summary.attributes,
      text,
      domOrder: summary.domOrder
    };
  }

  function imageUrlsForElement(element, options = {}) {
    const includeDescendants = options.includeDescendants !== false;
    const urls = [];
    const srcset = [];
    const nodes = [
      element,
      ...(includeDescendants ? Array.from(element?.querySelectorAll?.("*") || []) : [])
    ].filter(Boolean);

    for (const node of nodes) {
      for (const attributeName of ["src", "data-src", "href", "poster"]) {
        const url = normalizeUrl(node.getAttribute?.(attributeName) || "");
        if (url && IMAGE_EXTENSIONS.includes(urlExtension(url))) urls.push(url);
      }
      for (const attributeName of ["srcset", "data-srcset"]) {
        const entries = parseSrcsetEntries(node.getAttribute?.(attributeName) || "");
        srcset.push(...entries);
        for (const entry of entries) {
          if (IMAGE_EXTENSIONS.includes(urlExtension(entry.url))) urls.push(entry.url);
        }
      }
      for (const rawUrl of extractCssUrls(node.getAttribute?.("style") || "")) {
        const url = normalizeUrl(rawUrl);
        if (url && IMAGE_EXTENSIONS.includes(urlExtension(url))) urls.push(url);
      }
      let backgroundImage = "";
      try {
        backgroundImage = window.getComputedStyle(node).backgroundImage || "";
      } catch {
        backgroundImage = "";
      }
      for (const rawUrl of extractCssUrls(backgroundImage)) {
        const url = normalizeUrl(rawUrl);
        if (url && IMAGE_EXTENSIONS.includes(urlExtension(url))) urls.push(url);
      }
    }

    return {
      urls: Array.from(new Set(urls)),
      srcset
    };
  }

  function nearestTextElement(container, selectors) {
    if (!container) return null;
    const own = Array.from(container.querySelectorAll?.(selectors) || [])
      .find((node) => cleanText(node.textContent, 2000));
    if (own) return own;

    const candidates = [];
    for (const sibling of [container.previousElementSibling, container.nextElementSibling]) {
      if (sibling) {
        candidates.push(sibling, ...Array.from(sibling.querySelectorAll?.(selectors) || []));
      }
    }
    return candidates.find((node) => node.matches?.(selectors) && cleanText(node.textContent, 2000))
      || candidates.find((node) => cleanText(node.textContent, 2000))
      || null;
  }

  function imageGroupContainer(element) {
    if (!element || isRootOrChromeElement(element)) return null;
    const explicit = element.closest?.(".g-image, figure, picture");
    if (explicit && isAcceptedImageContainer(explicit)) return explicit;
    return isAcceptedImageContainer(element) ? element : null;
  }

  function imageGroupUrls(group) {
    const values = [
      group?.image?.url,
      ...(Array.isArray(group?.image?.allUrls) ? group.image.allUrls : []),
      ...(Array.isArray(group?.image?.srcset) ? group.image.srcset.map((entry) => entry?.url) : [])
    ];
    return Array.from(new Set(values.map((url) => normalizeUrl(url)).filter(Boolean)));
  }

  function collectStoryVrImageGroups() {
    const selector = [
      ".g-image",
      ".g-photo",
      "figure",
      "picture",
      "img",
      "[style*='background-image']",
      "[class*='story-image']",
      "[class*='story-photo']",
      "[class*='hero'][style*='background-image']",
      "[class*='cover'][style*='background-image']",
      "[class*='photo'][style*='background-image']",
      "[class*='media'][style*='background-image']"
    ].join(",");
    const containers = [];
    const seenContainers = new Set();
    try {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const container = imageGroupContainer(element);
        if (!container || seenContainers.has(container)) continue;
        seenContainers.add(container);
        containers.push(container);
      }
    } catch {
      return [];
    }

    const seenGroups = new Set();
    const groups = [];
    containers.forEach((container, index) => {
      if (!isAcceptedImageContainer(container)) return;
      const image = imageUrlsForElement(container, { includeDescendants: container.tagName?.toLowerCase() !== "img" });
      if (!image.urls.length) return;
      const caption = textRecordForElement(
        nearestTextElement(container, ".g-caption, figcaption, [class*='caption']"),
        "image_caption",
        index
      );
      const creditNodes = Array.from(container.querySelectorAll?.(".g-credit, .g-credits, [class*='credit']") || []);
      const externalCredit = nearestTextElement(container, ".g-credit, .g-credits, [class*='credit']");
      if (externalCredit && !creditNodes.includes(externalCredit)) creditNodes.push(externalCredit);
      const credits = creditNodes
        .map((node, creditIndex) => textRecordForElement(node, "image_credit", index * 10 + creditIndex))
        .filter(Boolean);
      const summary = elementSummary(container, index);
      const key = `${image.urls[0]}:${caption?.text || ""}:${credits.map((item) => item.text).join("|")}`;
      if (seenGroups.has(key)) return;
      seenGroups.add(key);
      groups.push({
        id: `image-group-${groups.length + 1}`,
        category: "image_group",
        index: groups.length,
        selector: summary.selector,
        tag: summary.tag,
        idAttribute: summary.idAttribute,
        className: summary.className,
        attributes: summary.attributes,
        domOrder: summary.domOrder,
        image: {
          url: image.urls[0],
          srcset: image.srcset,
          allUrls: image.urls
        },
        caption,
        credits
      });
    });
    return groups.sort((a, b) => a.domOrder - b.domOrder);
  }

  function collectStoryVrHeadings() {
    const seen = new Set();
    const headings = [];
    const selector = [
      "article h1",
      "article h2",
      "article h3",
      ".g-heading",
      ".g-subhed h2",
      ".g-subhed",
      ".subhed",
      "[class*='heading']",
      "[class*='headline']",
      "[class*='subhed']"
    ].join(",");
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
    nodes.forEach((node, index) => {
      const text = cleanText(node.textContent);
      const key = storyTextKey(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const record = textRecordForElement(node, "heading", index);
      if (!record) return;
      headings.push({
        ...record,
        id: `heading-${headings.length + 1}`,
        index: headings.length
      });
    });
    return headings.sort((a, b) => a.domOrder - b.domOrder);
  }

  function findKeywordWindows(text, source, maxMatches = MAX_KEYWORD_WINDOWS) {
    const windows = [];
    const original = String(text || "");
    const lowered = original.toLowerCase();
    const seen = new Set();

    for (const keyword of KEYWORDS) {
      const needle = keyword.toLowerCase();
      let offset = 0;
      while (windows.length < maxMatches) {
        const index = lowered.indexOf(needle, offset);
        if (index === -1) break;
        const start = Math.max(0, index - CONTEXT_RADIUS);
        const end = Math.min(original.length, index + needle.length + CONTEXT_RADIUS);
        const context = original.slice(start, end);
        const key = `${source}:${keyword}:${hashString(context)}`;
        if (!seen.has(key)) {
          seen.add(key);
          windows.push({
            id: `${source}:${windows.length + 1}`,
            source,
            keyword,
            index,
            context
          });
        }
        offset = index + needle.length;
      }
      if (windows.length >= maxMatches) break;
    }

    return windows;
  }

  function collectDomAssetReferences() {
    const references = new Map();
    const urlAttributes = new Set([
      "src",
      "href",
      "poster",
      "content",
      "data-src",
      "data-url",
      "data-href",
      "data-model",
      "data-asset",
      "data-texture",
      "data-json",
      "data-file"
    ]);
    const srcsetAttributes = new Set(["srcset", "data-srcset"]);

    Array.from(document.querySelectorAll("*")).forEach((element, elementIndex) => {
      for (const attribute of Array.from(element.attributes || [])) {
        const rawValues = [];
        if (urlAttributes.has(attribute.name) || /^data-/i.test(attribute.name)) {
          rawValues.push(attribute.value || "");
        }
        if (srcsetAttributes.has(attribute.name)) {
          rawValues.push(...parseSrcset(attribute.value));
        }
        if (attribute.name === "style") {
          rawValues.push(...extractCssUrls(attribute.value));
        }

        for (const rawValue of rawValues) {
          const url = normalizeUrl(rawValue);
          if (!url || !isCandidateUrl(url, `${attribute.name} ${rawValue}`)) continue;
          const existing = references.get(url) || {
            url,
            assetType: classifyUrl(url),
            sourceType: "dom_attribute",
            elementCount: 0,
            examples: []
          };
          existing.elementCount += 1;
          if (existing.examples.length < 5) {
            existing.examples.push({
              tag: element.tagName.toLowerCase(),
              attribute: attribute.name,
              elementIndex,
              value: String(rawValue).slice(0, 600)
            });
          }
          references.set(url, existing);
        }
      }
    });

    return Array.from(references.values()).sort((a, b) => a.url.localeCompare(b.url));
  }

  function collectDataParams() {
    const records = [];
    const seen = new Set();
    const nodes = Array.from(document.querySelectorAll("[data-params], [data-config], [data-props], [data-state]"));
    nodes.forEach((node, index) => {
      for (const name of ["data-params", "data-config", "data-props", "data-state"]) {
        const value = node.getAttribute(name);
        if (!value || !hasKeyword(value)) continue;
        const key = `${name}:${hashString(value)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push({
          id: `data-param-${records.length + 1}`,
          index,
          tag: node.tagName.toLowerCase(),
          attribute: name,
          className: typeof node.className === "string" ? node.className.slice(0, 500) : "",
          idAttribute: node.id || "",
          text: value.slice(0, MAX_ATTR_VALUE),
          keywordWindows: findKeywordWindows(value, `data_param_${records.length + 1}`, 40)
        });
      }
    });
    return records;
  }

  function compactInlineText(text) {
    const value = String(text || "");
    if (value.length <= MAX_INLINE_TEXT) return value;
    return `${value.slice(0, MAX_INLINE_TEXT - 20_000)}\n/* truncated by animation probe */\n${value.slice(-20_000)}`;
  }

  function collectScripts() {
    const scripts = [];
    const scriptSrcUrls = [];

    Array.from(document.scripts).forEach((script, index) => {
      const src = normalizeUrl(script.src || "");
      if (src) scriptSrcUrls.push(src);
      const type = script.type || "";
      const inlineText = script.src ? "" : script.textContent || "";
      const inlineCandidate = !src && inlineText && (/json/i.test(type) || hasKeyword(inlineText));
      scripts.push({
        index,
        src,
        type,
        id: script.id || "",
        async: Boolean(script.async),
        defer: Boolean(script.defer),
        textLength: inlineText.length,
        keywordWindows: inlineCandidate ? findKeywordWindows(compactInlineText(inlineText), `inline_script_${index}`, 80) : [],
        text: inlineCandidate ? compactInlineText(inlineText) : undefined
      });
    });

    return {
      scripts,
      scriptSrcUrls: Array.from(new Set(scriptSrcUrls)).sort()
    };
  }

  function collectPageKeywordWindows() {
    const html = document.documentElement.outerHTML || "";
    return findKeywordWindows(html, "page_html", 160);
  }

  function documentHeight() {
    return Math.max(
      document.body?.scrollHeight || 0,
      document.body?.offsetHeight || 0,
      document.documentElement?.clientHeight || 0,
      document.documentElement?.scrollHeight || 0,
      document.documentElement?.offsetHeight || 0
    );
  }

  function scrollProgressPercent() {
    const maxY = Math.max(0, documentHeight() - window.innerHeight);
    return maxY > 0 ? Math.min(100, Math.round((window.scrollY / maxY) * 1000) / 10) : 100;
  }

  function intersectionRatio(rect) {
    const left = Math.max(0, rect.left);
    const right = Math.min(window.innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const visibleArea = width * height;
    const totalArea = Math.max(1, rect.width * rect.height);
    return visibleArea / totalArea;
  }

  function activeTextAncestorSelectors(node, fallbackIndex = 0) {
    const selectors = [];
    let current = node;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      const selector = elementSummary(current, fallbackIndex + depth).selector;
      if (selector && !selectors.includes(selector)) selectors.push(selector);
    }
    return selectors;
  }

  function collectActiveTexts() {
    const selector = [
      "[data-step]",
      "[data-scrollama-index]",
      "[data-slide]",
      "[data-scene]",
      "[class*='step']",
      "[class*='slide']",
      "[class*='scroll']",
      "article h1",
      "article h2",
      "article h3",
      ".g-heading",
      ".g-subhed h2",
      ".g-subhed",
      ".subhed",
      "[class*='subhed']",
      "figcaption",
      "[class*='caption']",
      "article#story p",
      "article p",
      ".g-text",
      ".g-body",
      ".g-slide-text"
    ].join(",");

    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }

    const seen = new Set();
    return nodes
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        const ratio = intersectionRatio(rect);
        const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
        const text = cleanText(node.textContent);
        const id = node.id || "";
        const className = typeof node.className === "string" ? node.className.slice(0, 260) : "";
        const dataStep = node.getAttribute?.("data-step") || "";
        const dataSlide = node.getAttribute?.("data-slide") || "";
        const dataScene = node.getAttribute?.("data-scene") || "";
        const dataScrollamaIndex = node.getAttribute?.("data-scrollama-index") || "";
        const summary = elementSummary(node, index);
        const selector = summary.selector;
        const ancestorSelectors = activeTextAncestorSelectors(node, index);
        let cssVisible = node.hidden !== true;
        let current = node;
        while (cssVisible && current && current.nodeType !== 9) {
          const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(current) : null;
          if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.0001)) cssVisible = false;
          current = current.parentElement || null;
        }
        const semanticIdentityScore = (id ? 100 : 0)
          + ([dataStep, dataSlide, dataScene, dataScrollamaIndex].some(Boolean) ? 320 : 0)
          + (/\b(?:g-slide-text|step|slide|scrollama|hotspot)\b/i.test(className) ? 140 : 0);
        return {
          index,
          tag: node.tagName ? node.tagName.toLowerCase() : "",
          id,
          className,
          dataStep,
          dataSlide,
          dataScene,
          dataScrollamaIndex,
          selector,
          ancestorSelectors,
          domOrder: summary.domOrder,
          text,
          rect: {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            width: Math.round(rect.width)
          },
          visibleRatio: Number(ratio.toFixed(3)),
          centerDistance: Math.round(centerDistance),
          cssVisible,
          semanticIdentityScore,
          score: ratio * 1000 - centerDistance / 10 + (text ? 50 : 0) + semanticIdentityScore
        };
      })
      .filter((item) => item.cssVisible && item.visibleRatio > 0.05 && (item.text || item.semanticIdentityScore > 0))
      .sort((a, b) => b.score - a.score)
      .filter((item) => {
        const key = item.text
          ? `text:${item.text.toLowerCase()}`
          : `semantic:${item.id}|${item.dataScene}|${item.dataSlide}|${item.dataStep}|${item.dataScrollamaIndex}|${item.index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_ACTIVE_TEXTS)
      .map(({ score, semanticIdentityScore, cssVisible, ...item }) => item);
  }

  function activeBeatObservationKey(item) {
    if (!item) return "";
    return [item.id, item.dataScene, item.dataSlide, item.dataStep, item.dataScrollamaIndex, item.index, item.text]
      .map((value) => cleanText(value, 300).toLowerCase())
      .join("|");
  }

  function storyBeatScrollTargets(maxY) {
    const selector = [
      "[data-step]",
      "[data-scrollama-index]",
      "[data-slide]",
      "[data-scene]",
      ".g-slide-text",
      ".g-slide-hotspot",
      "[class*='step']",
      "[class*='slide']",
      "[class*='scroll']"
    ].join(",");
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
    const values = [];
    for (const node of nodes.slice(0, 3000)) {
      try {
        const rect = node.getBoundingClientRect();
        if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height)) continue;
        const absoluteCenter = (window.scrollY || 0) + rect.top + rect.height / 2;
        values.push(Math.max(0, Math.min(maxY, Math.round(absoluteCenter - window.innerHeight / 2))));
      } catch {
        // Ignore detached or cross-context nodes.
      }
    }
    const sorted = Array.from(new Set(values)).sort((a, b) => a - b);
    return sorted.filter((value, index) => index === 0 || value - sorted[index - 1] >= 12);
  }

  function variantControlElementsForRef(ref) {
    if (ref?.kind === "previous-next") return [ref.previous, ref.next].filter(Boolean);
    return [ref?.controlRoot || ref?.root].filter(Boolean);
  }

  function storyVariantControlScrollTargets(maxY, alignment = "both") {
    const groups = collectStoryVrVariantGroups(collectStoryVrHeadings());
    const targets = [];
    const currentScrollY = Number(window.scrollY || 0);
    const viewportHeight = Math.max(1, Number(window.innerHeight || 0));
    for (const group of groups) {
      const ref = variantGroupRuntimeRefs.get(group.id);
      const controls = variantControlElementsForRef(ref);
      if (!controls.length) continue;
      const rects = controls.map((control) => control.getBoundingClientRect?.()).filter(Boolean);
      if (!rects.length) continue;
      const top = Math.min(...rects.map((rect) => Number(rect.top)).filter(Number.isFinite));
      const bottom = Math.max(...rects.map((rect) => Number(rect.bottom)).filter(Number.isFinite));
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      const absoluteTop = currentScrollY + top;
      const absoluteBottom = currentScrollY + bottom;
      if (["both", "top"].includes(alignment)) {
        targets.push({
          y: Math.max(0, Math.min(maxY, Math.round(absoluteTop - 12))),
          alignment: "top",
          groupId: group.id
        });
      }
      if (["both", "bottom"].includes(alignment)) {
        targets.push({
          y: Math.max(0, Math.min(maxY, Math.round(absoluteBottom - viewportHeight + 12))),
          alignment: "bottom",
          groupId: group.id
        });
      }
    }
    const merged = new Map();
    for (const target of targets) {
      const key = `${target.y}:${target.alignment}`;
      const existing = merged.get(key) || { y: target.y, alignment: target.alignment, groupIds: [] };
      existing.groupIds = Array.from(new Set([...existing.groupIds, target.groupId]));
      merged.set(key, existing);
    }
    return Array.from(merged.values()).sort((left, right) => left.y - right.y || left.alignment.localeCompare(right.alignment));
  }

  function scheduleBeatChangeSnapshot() {
    if (beatChangeTimer || stopRequested || snapshots.length >= snapshotLimit) return;
    beatChangeTimer = setTimeout(() => {
      beatChangeTimer = null;
      if (stopRequested || snapshots.length >= snapshotLimit) return;
      const active = collectActiveTexts()[0] || null;
      const key = activeBeatObservationKey(active);
      if (!key || key === lastObservedBeatKey) return;
      lastObservedBeatKey = key;
      collectSnapshot("active-beat-change", { force: true });
      captureCoverage.beatChangeSnapshotCount += 1;
    }, 70);
  }

  function collectVisibleCanvases() {
    return Array.from(document.querySelectorAll("canvas")).map((canvas, index) => {
      const rect = canvas.getBoundingClientRect();
      const record = {
        index,
        width: canvas.width || 0,
        height: canvas.height || 0,
        clientWidth: canvas.clientWidth || 0,
        clientHeight: canvas.clientHeight || 0,
        rect: {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
          right: Math.round(rect.right)
        },
        visibleRatio: Number(intersectionRatio(rect).toFixed(3)),
        visualHash: null,
        visualHashStatus: "not_attempted"
      };

      if (record.visibleRatio > 0.01 && canvas.width && canvas.height) {
        try {
          const dataUrl = canvas.toDataURL("image/png", 0.2);
          record.visualHash = hashString(dataUrl);
          record.visualHashStatus = "ok";
        } catch (error) {
          record.visualHashStatus = `unavailable:${error.name || "error"}`;
        }
      }
      return record;
    });
  }

  function canvasDataUrl(canvas, quality = 0.76) {
    for (const mediaType of ["image/webp", "image/jpeg", "image/png"]) {
      try {
        const dataUrl = canvas.toDataURL(mediaType, quality);
        if (/^data:image\/(?:webp|jpeg|png);base64,/i.test(dataUrl)) return dataUrl;
      } catch {
        // Try the next browser-supported format.
      }
    }
    return "";
  }

  function mediaTypeForDataUrl(dataUrl) {
    return String(dataUrl || "").match(/^data:(image\/(?:webp|jpeg|png));base64,/i)?.[1]?.toLowerCase() || "";
  }

  function drawingCanvas(width, height) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const context = canvas.getContext?.("2d", { willReadFrequently: true });
      return context ? { canvas, context } : null;
    } catch {
      return null;
    }
  }

  function viewportCaptureMetadata() {
    return {
      schemaVersion: "storyvr-tab-viewport-capture/v1",
      status: viewportCaptureState.status,
      displaySurface: viewportCaptureState.displaySurface,
      enabledAt: viewportCaptureState.enabledAt,
      error: viewportCaptureState.error,
      videoWidth: Number(viewportCaptureState.video?.videoWidth || 0),
      videoHeight: Number(viewportCaptureState.video?.videoHeight || 0),
      instructions: "The user must approve sharing the current browser tab. Window or monitor capture is rejected because it is not the browser client-area contract."
    };
  }

  function removeViewportCapturePrompt() {
    try {
      viewportCapturePrompt?.remove?.();
    } catch {
      // The page may have removed the prompt during navigation.
    }
    viewportCapturePrompt = null;
  }

  function releaseViewportCapture(status = "ended") {
    const stream = viewportCaptureState.stream;
    viewportCaptureState.stream = null;
    viewportCaptureState.track = null;
    viewportCaptureState.video = null;
    viewportCaptureState.status = status;
    try {
      for (const track of stream?.getTracks?.() || []) track.stop();
    } catch {
      // A browser-ended track is already stopped.
    }
  }

  async function waitForViewportVideoReady(video, timeoutMs = 5000) {
    if (video?.readyState >= 2 && video.videoWidth && video.videoHeight) return true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        video.addEventListener?.("loadeddata", () => finish(Boolean(video.videoWidth && video.videoHeight)), { once: true });
        video.addEventListener?.("canplay", () => finish(Boolean(video.videoWidth && video.videoHeight)), { once: true });
      } catch {
        // The timeout remains the fallback.
      }
    });
  }

  async function waitForFreshViewportFrame(timeoutMs = 500) {
    const video = viewportCaptureState.video;
    if (!video || viewportCaptureState.status !== "ready") return false;
    if (typeof video.requestVideoFrameCallback !== "function") {
      await sleep(120);
      return true;
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        video.requestVideoFrameCallback(() => finish(true));
      } catch {
        finish(false);
      }
    });
  }

  async function enableViewportCapture(options = {}) {
    if (viewportCaptureState.status === "ready" && viewportCaptureState.video) return true;
    if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      viewportCaptureState.status = "unavailable";
      viewportCaptureState.error = "This browser does not expose getDisplayMedia().";
      throw new Error(viewportCaptureState.error);
    }
    viewportCaptureState.status = "requesting";
    viewportCaptureState.error = "";
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", frameRate: { ideal: 15, max: 30 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        monitorTypeSurfaces: "exclude",
        systemAudio: "exclude"
      });
      const track = stream.getVideoTracks?.()[0] || null;
      if (!track) throw new Error("The selected display surface did not provide a video track.");
      const displaySurface = String(track.getSettings?.().displaySurface || "");
      if (displaySurface && displaySurface !== "browser") {
        for (const item of stream.getTracks?.() || []) item.stop();
        throw new Error("Select the current Chrome tab, not a window or entire screen.");
      }
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play?.();
      const ready = await waitForViewportVideoReady(video);
      if (!ready) {
        for (const item of stream.getTracks?.() || []) item.stop();
        throw new Error("Chrome shared the tab, but no composited video frame became available.");
      }
      viewportCaptureState.status = "ready";
      viewportCaptureState.stream = stream;
      viewportCaptureState.track = track;
      viewportCaptureState.video = video;
      viewportCaptureState.displaySurface = displaySurface || "browser";
      viewportCaptureState.enabledAt = new Date().toISOString();
      viewportCaptureState.error = "";
      track.addEventListener?.("ended", () => {
        if (viewportCaptureState.track !== track) return;
        viewportCaptureState.status = "ended";
        viewportCaptureState.stream = null;
        viewportCaptureState.track = null;
        viewportCaptureState.video = null;
      }, { once: true });
      removeViewportCapturePrompt();
      await waitForFreshViewportFrame();
      console.info("[NYTAnimationProbe] Full tab viewport capture enabled.");
      if (options.autoStart !== false && !window.NYTAnimationProbe_DISABLE_AUTORUN) {
        await window.NYTAnimationProbe.autoRun();
      }
      return true;
    } catch (error) {
      if (stream) {
        try {
          for (const track of stream.getTracks?.() || []) track.stop();
        } catch {
          // Ignore cleanup errors from a rejected picker selection.
        }
      }
      viewportCaptureState.status = error?.name === "NotAllowedError" ? "permission-denied" : "error";
      viewportCaptureState.error = String(error?.message || error || "Viewport capture failed.").slice(0, 800);
      throw error;
    }
  }

  function installViewportCapturePrompt() {
    if (viewportCapturePrompt || window.NYTAnimationProbe_DISABLE_AUTORUN) return;
    const host = document.createElement("div");
    host.setAttribute?.("data-storyvr-probe-ui", "viewport-capture");
    host.style.cssText = "position:fixed;z-index:2147483647;right:18px;bottom:18px;width:340px;padding:16px;background:#111;color:#fff;border:1px solid #555;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.4);font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;";
    const title = document.createElement("div");
    title.textContent = "StoryVR visual capture";
    title.style.cssText = "font-weight:700;margin-bottom:6px;";
    const message = document.createElement("div");
    message.textContent = "Enable full-page screenshots, then choose This Tab in Chrome. Auto-scroll starts after approval.";
    message.style.cssText = "margin-bottom:12px;color:#ddd;";
    const enableButton = document.createElement("button");
    enableButton.textContent = "Enable full-page capture";
    enableButton.style.cssText = "display:block;width:100%;padding:9px 10px;border:0;border-radius:5px;background:#fff;color:#111;font-weight:700;cursor:pointer;";
    const fallbackButton = document.createElement("button");
    fallbackButton.textContent = "Use canvas-only fallback";
    fallbackButton.style.cssText = "display:block;width:100%;margin-top:8px;padding:7px 10px;border:1px solid #777;border-radius:5px;background:#222;color:#ddd;cursor:pointer;";
    enableButton.addEventListener?.("click", async () => {
      enableButton.disabled = true;
      enableButton.textContent = "Waiting for Chrome…";
      try {
        await enableViewportCapture({ autoStart: true });
      } catch (error) {
        enableButton.disabled = false;
        enableButton.textContent = "Try full-page capture again";
        message.textContent = `${viewportCaptureState.error} Choose This Tab when Chrome asks.`;
        console.warn("[NYTAnimationProbe] Full-page capture was not enabled:", error);
      }
    });
    fallbackButton.addEventListener?.("click", () => {
      removeViewportCapturePrompt();
      window.NYTAnimationProbe.autoRun({ allowCanvasFallback: true }).catch(() => {});
    });
    host.append?.(title, message, enableButton, fallbackButton);
    document.documentElement.appendChild(host);
    viewportCapturePrompt = host;
  }

  async function screenshotImageForViewport() {
    if (viewportCaptureState.status !== "ready" || !viewportCaptureState.video) {
      return { status: "unavailable:viewport-capture-not-enabled" };
    }
    await waitForFreshViewportFrame();
    const video = viewportCaptureState.video;
    const sourceWidth = Number(video.videoWidth || 0);
    const sourceHeight = Number(video.videoHeight || 0);
    if (!sourceWidth || !sourceHeight) return { status: "unavailable:empty-viewport-frame" };
    const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / sourceWidth, SCREENSHOT_MAX_HEIGHT / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const drawing = drawingCanvas(width, height);
    if (!drawing || typeof drawing.context.drawImage !== "function") return { status: "unavailable:viewport-drawing-context" };
    try {
      drawing.context.drawImage(video, 0, 0, width, height);
      const dataUrl = canvasDataUrl(drawing.canvas);
      return dataUrl ? {
        status: "ok",
        captureMethod: "display-media-tab-viewport",
        dataUrl,
        mediaType: mediaTypeForDataUrl(dataUrl),
        width,
        height,
        perceptualHash: perceptualHashForCanvas(drawing.canvas),
        contactSheetSource: drawing.canvas
      } : { status: "unavailable:viewport-serialization-failed" };
    } catch (error) {
      return { status: `unavailable:viewport-frame-${error?.name || "error"}` };
    }
  }

  function perceptualHashForCanvas(sourceCanvas) {
    const drawing = drawingCanvas(8, 8);
    if (!drawing || typeof drawing.context.drawImage !== "function" || typeof drawing.context.getImageData !== "function") return "";
    try {
      drawing.context.drawImage(sourceCanvas, 0, 0, 8, 8);
      const pixels = drawing.context.getImageData(0, 0, 8, 8).data;
      const luminance = [];
      for (let index = 0; index < pixels.length; index += 4) {
        luminance.push(Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114));
      }
      const average = luminance.reduce((sum, value) => sum + value, 0) / Math.max(1, luminance.length);
      let hex = "";
      for (let index = 0; index < luminance.length; index += 4) {
        let nibble = 0;
        for (let offset = 0; offset < 4; offset += 1) {
          if (luminance[index + offset] >= average) nibble |= 1 << (3 - offset);
        }
        hex += nibble.toString(16);
      }
      return hex;
    } catch {
      return "";
    }
  }

  function primaryVisibleCanvas() {
    let canvases = [];
    try {
      canvases = Array.from(document.querySelectorAll("canvas"));
    } catch {
      return null;
    }
    return canvases.map((canvas, index) => {
      try {
        const rect = canvas.getBoundingClientRect();
        const ratio = intersectionRatio(rect);
        const width = Math.max(0, Number(rect.width) || Number(rect.right) - Number(rect.left));
        const height = Math.max(0, Number(rect.height) || Number(rect.bottom) - Number(rect.top));
        return { canvas, index, ratio, score: ratio * width * height };
      } catch {
        return { canvas, index, ratio: 0, score: 0 };
      }
    }).filter((item) => item.ratio > 0.01 && item.canvas.width && item.canvas.height)
      .sort((left, right) => right.score - left.score || left.index - right.index)[0] || null;
  }

  function screenshotImageForCanvas(sourceCanvas) {
    const sourceWidth = Number(sourceCanvas.width || sourceCanvas.clientWidth || 0);
    const sourceHeight = Number(sourceCanvas.height || sourceCanvas.clientHeight || 0);
    if (!sourceWidth || !sourceHeight) return { status: "unavailable:empty-canvas" };
    const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / sourceWidth, SCREENSHOT_MAX_HEIGHT / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const drawing = drawingCanvas(width, height);
    if (drawing && typeof drawing.context.drawImage === "function") {
      try {
        drawing.context.drawImage(sourceCanvas, 0, 0, width, height);
        const dataUrl = canvasDataUrl(drawing.canvas);
        if (dataUrl) {
          return {
            status: "ok",
            captureMethod: "resized-canvas-copy",
            dataUrl,
            mediaType: mediaTypeForDataUrl(dataUrl),
            width,
            height,
            perceptualHash: perceptualHashForCanvas(drawing.canvas),
            contactSheetSource: drawing.canvas
          };
        }
      } catch {
        // Fall back to reading the source canvas directly.
      }
    }
    const dataUrl = canvasDataUrl(sourceCanvas);
    return dataUrl ? {
      status: "ok",
      captureMethod: "canvas-to-data-url",
      dataUrl,
      mediaType: mediaTypeForDataUrl(dataUrl),
      width: sourceWidth,
      height: sourceHeight,
      perceptualHash: perceptualHashForCanvas(sourceCanvas),
      contactSheetSource: sourceCanvas
    } : { status: "unavailable:tainted-or-unsupported-canvas" };
  }

  function addScreenshotToContactSheet(sourceCanvas, screenshot) {
    if (!sourceCanvas) return;
    const captureIndex = Math.max(0, scrollTargetScreenshots.length - 1);
    const sheetIndex = Math.floor(captureIndex / CONTACT_SHEET_FRAME_COUNT);
    const frameIndex = captureIndex % CONTACT_SHEET_FRAME_COUNT;
    let sheet = scrollTargetContactSheets[sheetIndex];
    if (!sheet) {
      const rows = Math.ceil(CONTACT_SHEET_FRAME_COUNT / CONTACT_SHEET_COLUMNS);
      const drawing = drawingCanvas(CONTACT_SHEET_TILE_WIDTH * CONTACT_SHEET_COLUMNS, CONTACT_SHEET_TILE_HEIGHT * rows);
      if (!drawing) return;
      try {
        drawing.context.fillStyle = "#111111";
        drawing.context.fillRect(0, 0, drawing.canvas.width, drawing.canvas.height);
      } catch {
        return;
      }
      sheet = { ...drawing, screenshotIds: [] };
      scrollTargetContactSheets[sheetIndex] = sheet;
    }
    const column = frameIndex % CONTACT_SHEET_COLUMNS;
    const row = Math.floor(frameIndex / CONTACT_SHEET_COLUMNS);
    const x = column * CONTACT_SHEET_TILE_WIDTH;
    const y = row * CONTACT_SHEET_TILE_HEIGHT;
    const imageHeight = CONTACT_SHEET_TILE_HEIGHT - 48;
    try {
      const sourceWidth = Number(sourceCanvas.width || 1);
      const sourceHeight = Number(sourceCanvas.height || 1);
      const scale = Math.min(CONTACT_SHEET_TILE_WIDTH / sourceWidth, imageHeight / sourceHeight);
      const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
      const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
      const drawX = x + Math.round((CONTACT_SHEET_TILE_WIDTH - drawWidth) / 2);
      const drawY = y + Math.round((imageHeight - drawHeight) / 2);
      sheet.context.fillStyle = "#000000";
      sheet.context.fillRect(x, y, CONTACT_SHEET_TILE_WIDTH, imageHeight);
      sheet.context.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight);
      sheet.context.fillStyle = "#f5f5f5";
      sheet.context.font = "13px sans-serif";
      const percent = Number.isFinite(screenshot.scrollPercent) ? `${screenshot.scrollPercent}%` : "scroll ?";
      sheet.context.fillText(`Target ${screenshot.targetIndex + 1} · ${percent}`, x + 8, y + imageHeight + 18, CONTACT_SHEET_TILE_WIDTH - 16);
      sheet.context.fillStyle = "#bdbdbd";
      sheet.context.font = "11px sans-serif";
      sheet.context.fillText(cleanText(screenshot.activeText?.text || "No active beat text", 100), x + 8, y + imageHeight + 37, CONTACT_SHEET_TILE_WIDTH - 16);
      sheet.screenshotIds.push(screenshot.id);
    } catch {
      // The individual screenshot remains usable when contact-sheet drawing fails.
    }
  }

  function captureScrollTargetScreenshot(scrollTarget, snapshot, options = {}) {
    const id = `scroll-target-${String(Number(scrollTarget.index || 0) + 1).padStart(4, "0")}`;
    const base = {
      id,
      evidenceRef: `visual-${id}`,
      targetIndex: Number(scrollTarget.index || 0),
      targetY: Math.round(Number(scrollTarget.y ?? snapshot.scrollY) || 0),
      targetKind: scrollTarget.kind || "grid",
      traversalPhase: cleanText(scrollTarget.phase),
      traversalDirection: cleanText(scrollTarget.direction),
      snapshotId: snapshot.id,
      scrollPercent: snapshot.scrollPercent,
      activeText: snapshot.activeTexts[0] || null,
      viewport: snapshot.viewport
    };
    if (scrollTargetScreenshots.length >= MAX_SCROLL_TARGET_SCREENSHOTS) {
      const failed = { ...base, status: "unavailable:screenshot-limit" };
      scrollTargetScreenshots.push(failed);
      captureCoverage.screenshotFailureCount += 1;
      return failed;
    }
    const selected = primaryVisibleCanvas();
    const canvasImage = selected ? screenshotImageForCanvas(selected.canvas) : { status: "unavailable:no-visible-canvas" };
    const viewportImage = options.viewportImage || { status: "unavailable:viewport-capture-not-enabled" };
    const useCanvasFallback = viewportImage.status !== "ok" && options.allowCanvasFallback && canvasImage.status === "ok";
    const image = useCanvasFallback ? {
      ...canvasImage,
      captureMethod: "canvas-only-fallback"
    } : viewportImage;
    const canvasCrop = selected ? {
      status: canvasImage.status,
      captureMethod: canvasImage.captureMethod || "",
      sourceCanvasIndex: selected.index,
      sourceCanvasVisibleRatio: Number(selected.ratio.toFixed(3)),
      mediaType: canvasImage.mediaType || "",
      width: canvasImage.width || null,
      height: canvasImage.height || null,
      perceptualHash: canvasImage.perceptualHash || "",
      contentHash: canvasImage.dataUrl ? hashString(canvasImage.dataUrl) : "",
      dataUrl: canvasImage.dataUrl || ""
    } : { status: "unavailable:no-visible-canvas" };
    const screenshot = {
      ...base,
      status: image.status,
      captureMethod: image.captureMethod || "",
      mediaType: image.mediaType || "",
      width: image.width || null,
      height: image.height || null,
      perceptualHash: image.perceptualHash || "",
      contentHash: image.dataUrl ? hashString(image.dataUrl) : "",
      dataUrl: image.dataUrl || "",
      canvasCrop
    };
    scrollTargetScreenshots.push(screenshot);
    if (canvasCrop.status === "ok") captureCoverage.canvasCropCaptureCount += 1;
    if (image.status === "ok") {
      captureCoverage.screenshotCaptureCount += 1;
      if (image.captureMethod === "display-media-tab-viewport") captureCoverage.viewportScreenshotCaptureCount += 1;
      if (image.captureMethod === "canvas-only-fallback") captureCoverage.canvasFallbackCaptureCount += 1;
      addScreenshotToContactSheet(image.contactSheetSource, screenshot);
    } else {
      captureCoverage.screenshotFailureCount += 1;
    }
    return screenshot;
  }

  function captureVariantStateScreenshot(group, state, ref, context, snapshot, options = {}) {
    const serial = variantStateScreenshots.length + 1;
    const id = `variant-state-${String(serial).padStart(5, "0")}`;
    const base = {
      id,
      evidenceRef: `visual-${id}`,
      groupId: cleanText(group?.id),
      groupTitle: cleanText(group?.title),
      optionId: cleanText(state?.option?.id),
      optionLabel: cleanText(state?.option?.label),
      parentGroupId: cleanText(context?.parentGroupId),
      parentOptionId: cleanText(context?.parentOptionId),
      explorationPhase: cleanText(context?.explorationPhase) || "manual-visible",
      viewportAlignment: cleanText(context?.viewportAlignment),
      controlSelector: elementSummary(ref?.controlRoot || ref?.next || ref?.root).selector,
      snapshotId: snapshot.id,
      scrollY: snapshot.scrollY,
      scrollPercent: snapshot.scrollPercent,
      activeText: snapshot.activeTexts[0] || null,
      viewport: snapshot.viewport
    };
    const selected = primaryVisibleCanvas();
    const canvasImage = selected ? screenshotImageForCanvas(selected.canvas) : { status: "unavailable:no-visible-canvas" };
    const viewportImage = options.viewportImage || { status: "unavailable:viewport-capture-not-enabled" };
    const useCanvasFallback = viewportImage.status !== "ok" && options.allowCanvasFallback && canvasImage.status === "ok";
    const image = useCanvasFallback ? { ...canvasImage, captureMethod: "canvas-only-fallback" } : viewportImage;
    const screenshot = {
      ...base,
      status: image.status,
      captureMethod: image.captureMethod || "",
      mediaType: image.mediaType || "",
      width: image.width || null,
      height: image.height || null,
      perceptualHash: image.perceptualHash || "",
      contentHash: image.dataUrl ? hashString(image.dataUrl) : "",
      dataUrl: image.dataUrl || "",
      canvasCrop: selected ? {
        status: canvasImage.status,
        captureMethod: canvasImage.captureMethod || "",
        sourceCanvasIndex: selected.index,
        sourceCanvasVisibleRatio: Number(selected.ratio.toFixed(3)),
        mediaType: canvasImage.mediaType || "",
        width: canvasImage.width || null,
        height: canvasImage.height || null,
        perceptualHash: canvasImage.perceptualHash || "",
        contentHash: canvasImage.dataUrl ? hashString(canvasImage.dataUrl) : "",
        dataUrl: canvasImage.dataUrl || ""
      } : { status: "unavailable:no-visible-canvas" }
    };
    variantStateScreenshots.push(screenshot);
    if (image.status === "ok") captureCoverage.variantStateScreenshotCaptureCount += 1;
    else captureCoverage.variantStateScreenshotFailureCount += 1;
    return screenshot;
  }

  function serializedScrollTargetContactSheets() {
    return scrollTargetContactSheets.map((sheet, index) => {
      const dataUrl = canvasDataUrl(sheet.canvas, 0.82);
      return {
        id: `scroll-target-contact-sheet-${String(index + 1).padStart(3, "0")}`,
        screenshotIds: [...sheet.screenshotIds],
        status: dataUrl ? "ok" : "unavailable:serialization-failed",
        mediaType: mediaTypeForDataUrl(dataUrl),
        width: sheet.canvas.width,
        height: sheet.canvas.height,
        contentHash: dataUrl ? hashString(dataUrl) : "",
        dataUrl
      };
    });
  }

  function finiteRuntimeNumber(value, digits = 5) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Number(number.toFixed(digits));
  }

  function runtimeObjectId(object, fallback = "object") {
    if (!object || (typeof object !== "object" && typeof object !== "function")) return fallback;
    const explicitId = cleanText(object.uuid || object.id || "", 180);
    if (explicitId) return explicitId;
    const existing = runtime3dState.objectIds.get(object);
    if (existing) return existing;
    runtime3dState.objectSerial += 1;
    const generated = `runtime-object-${runtime3dState.objectSerial}-${hashString(cleanText(object.name || object.type || fallback, 80)).slice(0, 6)}`;
    runtime3dState.objectIds.set(object, generated);
    return generated;
  }

  function isRuntimeObject3D(value) {
    return Boolean(value && typeof value === "object" && (
      value.isObject3D === true
      || (Array.isArray(value.children) && typeof value.traverse === "function" && "visible" in value)
    ));
  }

  function isRuntimeScene(value) {
    return Boolean(isRuntimeObject3D(value) && (value.isScene === true || value.type === "Scene"));
  }

  function isRuntimeRenderer(value) {
    return Boolean(value && typeof value === "object" && typeof value.render === "function" && (
      value.isWebGLRenderer === true
      || value.domElement?.tagName?.toLowerCase?.() === "canvas"
    ));
  }

  function isRuntimeMixer(value) {
    return Boolean(value && typeof value === "object" && typeof value.update === "function" && typeof value.clipAction === "function" && (
      typeof value.getRoot === "function"
      || value._root
      || Array.isArray(value._actions)
    ));
  }

  function safeRuntimeValue(object, key) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : undefined;
    } catch {
      return undefined;
    }
  }

  function boundedRuntimeTraverse(root, callback, maxNodes = 600) {
    if (!isRuntimeObject3D(root)) return 0;
    const queue = [root];
    const seen = new Set();
    let visited = 0;
    while (queue.length && visited < maxNodes) {
      const object = queue.shift();
      if (!object || seen.has(object)) continue;
      seen.add(object);
      visited += 1;
      callback(object, visited - 1);
      const children = Array.isArray(object.children) ? object.children : [];
      for (const child of children.slice(0, 240)) queue.push(child);
    }
    return visited;
  }

  function modelUrlFromRuntimeValue(value) {
    if (typeof value !== "string") return null;
    const normalized = normalizeUrl(value);
    return normalized && MODEL_EXTENSIONS.includes(urlExtension(normalized)) ? normalized : null;
  }

  function explicitModelUrlFromObject(root) {
    let discovered = null;
    boundedRuntimeTraverse(root, (object) => {
      if (discovered) return;
      for (const container of [object.userData, object]) {
        if (!container || typeof container !== "object") continue;
        for (const key of ["assetUrl", "modelUrl", "gltfUrl", "glbUrl", "sourceUrl", "src", "url", "path", "file"]) {
          const value = safeRuntimeValue(container, key) ?? container[key];
          const url = modelUrlFromRuntimeValue(value);
          if (url) {
            discovered = url;
            return;
          }
        }
      }
    }, 80);
    return discovered;
  }

  function runtimeModelResourceUrls() {
    seedPerformanceEntries();
    return Array.from(resourceMap.values())
      .filter((entry) => entry.assetType === "model")
      .map((entry) => entry.url);
  }

  function runtimeObjectNameText(root) {
    const names = [];
    boundedRuntimeTraverse(root, (object) => {
      const name = cleanText(object.name || "", 180).toLowerCase();
      if (name) names.push(name);
    }, 180);
    return names.join(" ");
  }

  function inferRuntimeModelIdentity(root) {
    const explicitUrl = explicitModelUrlFromObject(root);
    if (explicitUrl) {
      return { assetUrl: explicitUrl, identitySource: "object-user-data", identityConfidence: 0.96 };
    }

    const resources = runtimeModelResourceUrls();
    const names = runtimeObjectNameText(root);
    const compactNames = names.replace(/[^a-z0-9]+/g, "");
    const matches = resources.filter((url) => {
      let basename = "";
      try {
        basename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "").toLowerCase();
      } catch {
        basename = String(url || "").split("/").pop().toLowerCase();
      }
      const stem = basename.replace(/\.(?:glb|gltf)$/i, "").replace(/[-_]+/g, " ").trim();
      if (!stem) return false;
      const compactStem = stem.replace(/[^a-z0-9]+/g, "");
      return names.includes(stem)
        || names.includes(basename.replace(/\.(?:glb|gltf)$/i, ""))
        || (compactStem.length >= 5 && compactNames.includes(compactStem));
    });
    if (matches.length === 1) {
      return { assetUrl: matches[0], identitySource: "resource-name-match", identityConfidence: 0.72 };
    }
    const singleResourceAlreadyAssigned = resources.length === 1 && Array.from(runtime3dState.models.values()).some((model) => model.assetUrl === resources[0]);
    if (resources.length === 1 && runtime3dState.models.size === 0 && !singleResourceAlreadyAssigned) {
      return { assetUrl: resources[0], identitySource: "single-model-resource", identityConfidence: 0.58 };
    }
    return { assetUrl: "", identitySource: "unknown", identityConfidence: 0.2 };
  }

  function touchRuntime3DCatalog() {
    runtime3dState.catalogRevision += 1;
  }

  function runtimeHintId(value) {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return cleanText(value, 180);
    return cleanText(value.id || value.name || value.key || "", 180);
  }

  function boundedRuntimeBridgeConfig(value, depth = 0, seen = new WeakSet()) {
    if (value == null) return null;
    if (typeof value === "string") return cleanText(value, 400);
    if (typeof value === "number") return finiteRuntimeNumber(value);
    if (typeof value === "boolean") return value;
    if (isRuntimeObject3D(value)) return { objectId: runtimeObjectId(value, "bridge-object") };
    if (typeof value !== "object" || depth >= 3 || seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => boundedRuntimeBridgeConfig(item, depth + 1, seen));
    }
    const allowedKeys = [
      "id",
      "name",
      "role",
      "kind",
      "type",
      "position",
      "rotation",
      "quaternion",
      "scale",
      "matrix",
      "transform",
      "anchor",
      "containerId",
      "compositionId",
      "frameId",
      "sourceId",
      "sourceConfigId",
      "activeStateId"
    ];
    const result = {};
    for (const key of allowedKeys) {
      const child = safeRuntimeValue(value, key) ?? value[key];
      if (child == null || typeof child === "function") continue;
      const serialized = boundedRuntimeBridgeConfig(child, depth + 1, seen);
      if (serialized != null) result[key] = serialized;
    }
    return Object.keys(result).length ? result : null;
  }

  function runtimeBoundaryMetadata(registrationSource, options = {}) {
    const explicitSource = cleanText(options.instanceBoundarySource, 180);
    const source = explicitSource || (
      registrationSource === "gltf-loader-hook"
        ? "gltf-loader-scene"
        : registrationSource === "gltf-loader-moved-child"
          ? "gltf-loader-moved-child"
          : /runtime-bridge/.test(registrationSource)
            ? "runtime-bridge-explicit"
            : registrationSource === "scene-child-discovery"
              ? "scene-child-aggregate"
              : registrationSource === "animation-mixer-root"
                ? "animation-mixer-root"
                : "runtime-discovery"
    );
    const defaultConfidence = source === "runtime-bridge-explicit" || source.startsWith("gltf-loader")
      ? 1
      : source === "scene-child-aggregate"
        ? 0.55
        : 0.7;
    return {
      instanceBoundarySource: source,
      instanceBoundaryConfidence: Number.isFinite(Number(options.instanceBoundaryConfidence))
        ? Math.max(0, Math.min(1, Number(options.instanceBoundaryConfidence)))
        : defaultConfidence,
      instanceBoundaryExplicit: options.instanceBoundaryExplicit === true
        || source === "runtime-bridge-explicit"
        || source.startsWith("gltf-loader")
    };
  }

  function applyRuntimeModelHints(record, options = {}) {
    let changed = false;
    const assignText = (key, value) => {
      const next = runtimeHintId(value);
      if (!next || record[key] === next) return;
      record[key] = next;
      changed = true;
    };
    assignText("instanceId", options.instanceId);
    assignText("containerIdHint", options.containerId);
    assignText("compositionId", options.compositionId || options.composition);
    assignText("frameId", options.frameId || options.referenceFrameId || options.frame);
    assignText("sourceId", options.sourceId || options.sourceIdentity);
    assignText("sourceConfigId", options.sourceConfigId || options.configId);
    assignText("activeStateId", options.activeStateId || options.stateId);
    assignText("compositionRole", options.compositionRole || options.role);
    assignText("anchorKind", options.anchorKind);
    if (isRuntimeObject3D(options.container) && record.explicitContainer !== options.container) {
      record.explicitContainer = options.container;
      changed = true;
    }
    if (isRuntimeObject3D(options.frameRoot) && record.frameRoot !== options.frameRoot) {
      record.frameRoot = options.frameRoot;
      changed = true;
    }
    const anchorObject = isRuntimeObject3D(options.anchor)
      ? options.anchor
      : isRuntimeObject3D(options.anchorObject)
        ? options.anchorObject
        : null;
    if (anchorObject && record.anchorObject !== anchorObject) {
      record.anchorObject = anchorObject;
      changed = true;
    }
    const sourceConfig = boundedRuntimeBridgeConfig(options.sourceConfig || options.config);
    if (sourceConfig && JSON.stringify(record.sourceConfig || null) !== JSON.stringify(sourceConfig)) {
      record.sourceConfig = sourceConfig;
      changed = true;
    }
    if (changed) touchRuntime3DCatalog();
    return changed;
  }

  function registerRuntimeModel(root, options = {}) {
    if (!isRuntimeObject3D(root)) return null;
    const existing = runtime3dState.models.get(root);
    const identity = options.assetUrl
      ? {
          assetUrl: normalizeUrl(options.assetUrl) || String(options.assetUrl),
          identitySource: options.identitySource || "gltf-loader-hook",
          identityConfidence: Number.isFinite(Number(options.identityConfidence)) ? Number(options.identityConfidence) : 0.99
        }
      : inferRuntimeModelIdentity(root);
    if (existing) {
      if (
        identity.assetUrl
        && (!existing.assetUrl || Number(identity.identityConfidence || 0) > Number(existing.identityConfidence || 0))
      ) {
        Object.assign(existing, identity);
        touchRuntime3DCatalog();
      }
      if (Array.isArray(options.animations) && options.animations.length) existing.animations = options.animations;
      const boundary = runtimeBoundaryMetadata(options.registrationSource || existing.registrationSource, options);
      if (boundary.instanceBoundaryConfidence > Number(existing.instanceBoundaryConfidence || 0)) {
        Object.assign(existing, boundary);
        touchRuntime3DCatalog();
      }
      applyRuntimeModelHints(existing, options);
      return existing;
    }
    if (runtime3dState.models.size >= MAX_RUNTIME_MODELS) return null;
    runtime3dState.modelSerial += 1;
    const record = {
      id: `runtime-model-${runtime3dState.modelSerial}`,
      catalogModelId: `runtime-model-catalog-${runtime3dState.modelSerial}`,
      instanceId: cleanText(options.instanceId, 180) || `runtime-instance-${runtime3dState.modelSerial}`,
      root,
      rootObjectId: runtimeObjectId(root, `model-root-${runtime3dState.modelSerial}`),
      rootName: cleanText(root.name || "", 240),
      assetUrl: identity.assetUrl,
      identitySource: identity.identitySource,
      identityConfidence: identity.identityConfidence,
      animations: Array.isArray(options.animations) ? options.animations : [],
      registeredAt: Math.round(performance.now()),
      registrationSource: options.registrationSource || identity.identitySource,
      explicitContainer: null,
      containerIdHint: "",
      compositionId: "",
      frameId: "",
      frameRoot: null,
      sourceId: "",
      sourceConfigId: "",
      activeStateId: "",
      sourceConfig: null,
      compositionRole: "",
      anchorObject: null,
      anchorKind: "",
      partCatalogByObject: new Map(),
      initialLocalBounds: null,
      ...runtimeBoundaryMetadata(options.registrationSource || identity.identitySource, options)
    };
    runtime3dState.models.set(root, record);
    applyRuntimeModelHints(record, options);
    touchRuntime3DCatalog();
    if (options.registrationSource === "gltf-loader-hook") runtime3dState.modelLoadCount += 1;
    return record;
  }

  function registerRuntimeScene(scene, camera = null, source = "runtime-discovery") {
    if (!isRuntimeScene(scene)) return null;
    let record = runtime3dState.scenes.get(scene);
    if (!record) {
      runtime3dState.sceneSerial += 1;
      record = {
        id: `runtime-scene-${runtime3dState.sceneSerial}`,
        scene,
        sceneObjectId: runtimeObjectId(scene, `scene-${runtime3dState.sceneSerial}`),
        name: cleanText(scene.name || "", 180),
        camera: null,
        renderer: null,
        lastRenderTargetKind: "unknown",
        source,
        firstSeenAt: Math.round(performance.now()),
        lastRenderedAt: null,
        renderCount: 0
      };
      runtime3dState.scenes.set(scene, record);
    }
    if (camera && isRuntimeObject3D(camera)) record.camera = camera;
    return record;
  }

  function runtimeMixerRoot(mixer) {
    try {
      return typeof mixer?.getRoot === "function" ? mixer.getRoot() : mixer?._root || null;
    } catch {
      return mixer?._root || null;
    }
  }

  function registerRuntimeMixer(mixer, source = "runtime-discovery") {
    if (!isRuntimeMixer(mixer)) return null;
    let record = runtime3dState.mixers.get(mixer);
    if (!record) {
      if (runtime3dState.mixers.size >= MAX_RUNTIME_MODELS * 3) return null;
      runtime3dState.mixerSerial += 1;
      record = {
        id: `runtime-mixer-${runtime3dState.mixerSerial}`,
        mixer,
        root: runtimeMixerRoot(mixer),
        source,
        updateCallCount: 0,
        setTimeCallCount: 0,
        clipActionCallCount: 0,
        recentAdvances: [],
        lastAdvance: null,
        lastSampleAt: -Infinity
      };
      runtime3dState.mixers.set(mixer, record);
      const containsRegisteredModel = isRuntimeObject3D(record.root) && Array.from(runtime3dState.models.keys()).some((modelRoot) => (
        modelRoot !== record.root && isDescendantRuntimeObject(modelRoot, record.root)
      ));
      if (isRuntimeObject3D(record.root) && !isRuntimeScene(record.root) && !containsRegisteredModel) {
        registerRuntimeModel(record.root, { registrationSource: "animation-mixer-root" });
      }
    }
    return record;
  }

  function recordRuntimeMixerAdvance(mixer, method, value) {
    const record = registerRuntimeMixer(mixer, "animation-mixer-hook");
    if (!record) return;
    if (method === "setTime") record.setTimeCallCount += 1;
    else record.updateCallCount += 1;
    const now = performance.now();
    const sample = {
      method,
      value: finiteRuntimeNumber(value),
      elapsedMs: Math.round(now),
      scrollY: Math.round(window.scrollY || 0),
      scrollPercent: scrollProgressPercent(),
      nearScrollEvent: now - lastScrollEventAt <= 220
    };
    record.lastAdvance = sample;
    if (now - record.lastSampleAt >= 40 || record.recentAdvances.at(-1)?.method !== method) {
      record.lastSampleAt = now;
      record.recentAdvances.push(sample);
      if (record.recentAdvances.length > MAX_RUNTIME_ADVANCE_SAMPLES) record.recentAdvances.shift();
    }
  }

  function runtimeHookBaseFunction(value) {
    let current = value;
    const seen = new Set();
    while (
      typeof current === "function"
      && current[RUNTIME_HOOK_ORIGINAL]
      && !seen.has(current)
    ) {
      seen.add(current);
      current = current[RUNTIME_HOOK_ORIGINAL];
    }
    return current;
  }

  function markRuntimeHook(wrapped, original) {
    Object.defineProperty(wrapped, RUNTIME_HOOK_MARKER, { value: RUNTIME_HOOK_OWNER });
    Object.defineProperty(wrapped, RUNTIME_HOOK_ORIGINAL, { value: original });
  }

  function markRuntimeClipAction(mixer) {
    const record = registerRuntimeMixer(mixer, "animation-mixer-hook");
    if (record) record.clipActionCallCount += 1;
  }

  function instrumentRuntimeMixerPrototype(prototype) {
    if (!prototype || runtime3dState.patchedMixerPrototypes.has(prototype)) return false;
    const isMixerInstance = isRuntimeMixer(prototype);
    let patched = false;
    for (const method of ["update", "setTime", "clipAction", "existingAction"]) {
      const installed = prototype[method];
      if (typeof installed !== "function" || installed[RUNTIME_HOOK_MARKER] === RUNTIME_HOOK_OWNER) continue;
      const original = runtimeHookBaseFunction(installed);
      if (typeof original !== "function") continue;
      const wrapped = function runtimeAnimationProbeMixerMethod(...args) {
        if (method === "update" || method === "setTime") recordRuntimeMixerAdvance(this, method, args[0]);
        else markRuntimeClipAction(this);
        return original.apply(this, args);
      };
      try {
        markRuntimeHook(wrapped, original);
        prototype[method] = wrapped;
        patched = true;
      } catch {
        // Some bundled prototypes are frozen. Discovery still reads their public/internal state.
      }
    }
    runtime3dState.patchedMixerPrototypes.add(prototype);
    if (patched) {
      runtime3dState.capabilities.animationMixerHooked = true;
      if (isMixerInstance) runtime3dState.capabilities.instanceMixerHooked = true;
    }
    return patched;
  }

  function observeRuntimeRender(renderer, scene, camera, explicitRenderTarget = undefined) {
    runtime3dState.renderCount += 1;
    runtime3dState.renderers.add(renderer);
    const sceneRecord = registerRuntimeScene(scene, camera, "renderer-hook");
    if (sceneRecord) {
      sceneRecord.renderer = renderer;
      try {
        if (explicitRenderTarget !== undefined) {
          sceneRecord.lastRenderTargetKind = explicitRenderTarget ? "render-target" : "screen";
        } else {
          sceneRecord.lastRenderTargetKind = typeof renderer?.getRenderTarget === "function" && renderer.getRenderTarget()
            ? "render-target"
            : "screen";
        }
      } catch {
        sceneRecord.lastRenderTargetKind = "unknown";
      }
      sceneRecord.lastRenderedAt = Math.round(performance.now());
      sceneRecord.renderCount += 1;
    }
  }

  function instrumentRuntimeRendererTarget(target) {
    if (!target || runtime3dState.patchedRendererPrototypes.has(target)) return false;
    const installed = target.render;
    if (typeof installed !== "function" || installed[RUNTIME_HOOK_MARKER] === RUNTIME_HOOK_OWNER) return false;
    const original = runtimeHookBaseFunction(installed);
    if (typeof original !== "function") return false;
    const wrapped = function runtimeAnimationProbeRender(scene, camera, ...args) {
      observeRuntimeRender(this, scene, camera, args[0]);
      return original.call(this, scene, camera, ...args);
    };
    try {
      markRuntimeHook(wrapped, original);
      target.render = wrapped;
      runtime3dState.patchedRendererPrototypes.add(target);
      runtime3dState.capabilities.rendererHooked = true;
      return true;
    } catch {
      return false;
    }
  }

  function instrumentRuntimeLoaderPrototype(prototype) {
    if (!prototype || runtime3dState.patchedLoaderPrototypes.has(prototype)) return false;
    const installed = prototype.load;
    if (typeof installed !== "function" || installed[RUNTIME_HOOK_MARKER] === RUNTIME_HOOK_OWNER) return false;
    const original = runtimeHookBaseFunction(installed);
    if (typeof original !== "function") return false;
    const wrapped = function runtimeAnimationProbeGltfLoad(url, onLoad, onProgress, onError) {
      const assetUrl = normalizeUrl(String(url || "")) || String(url || "");
      const wrappedOnLoad = typeof onLoad === "function"
        ? function runtimeAnimationProbeGltfLoaded(gltf, ...args) {
            const loadedScene = isRuntimeObject3D(gltf?.scene) ? gltf.scene : null;
            const initialSceneChildren = loadedScene && Array.isArray(loadedScene.children)
              ? loadedScene.children.filter(isRuntimeObject3D)
              : [];
            if (gltf?.scene) {
              registerRuntimeModel(gltf.scene, {
                assetUrl,
                identitySource: "gltf-loader-hook",
                identityConfidence: 1,
                animations: Array.isArray(gltf.animations) ? gltf.animations : [],
                registrationSource: "gltf-loader-hook"
              });
            }
            const result = onLoad.call(this, gltf, ...args);
            if (loadedScene && initialSceneChildren.length === 1) {
              const movedRoot = initialSceneChildren[0];
              let renderableCount = 0;
              boundedRuntimeTraverse(movedRoot, (object) => {
                if (isRuntimeRenderablePart(object)) renderableCount += 1;
              }, 320);
              if (renderableCount && movedRoot.parent !== loadedScene) {
                runtime3dState.models.delete(loadedScene);
                registerRuntimeModel(movedRoot, {
                  assetUrl,
                  identitySource: "gltf-loader-hook",
                  identityConfidence: 1,
                  animations: Array.isArray(gltf.animations) ? gltf.animations : [],
                  registrationSource: "gltf-loader-moved-child",
                  instanceBoundarySource: "gltf-loader-moved-child",
                  instanceBoundaryConfidence: 1,
                  instanceBoundaryExplicit: true
                });
              }
            }
            return result;
          }
        : onLoad;
      return original.call(this, url, wrappedOnLoad, onProgress, onError);
    };
    try {
      markRuntimeHook(wrapped, original);
      prototype.load = wrapped;
      runtime3dState.patchedLoaderPrototypes.add(prototype);
      runtime3dState.capabilities.gltfLoaderHooked = true;
      return true;
    } catch {
      return false;
    }
  }

  function instrumentThreeNamespace(namespace) {
    if (!namespace || (typeof namespace !== "object" && typeof namespace !== "function")) return false;
    const looksLikeThree = Boolean(namespace.REVISION || namespace.WebGLRenderer || namespace.Object3D || namespace.AnimationMixer || namespace.GLTFLoader);
    if (!looksLikeThree) return false;
    runtime3dState.capabilities.globalThreeNamespaceFound = true;
    runtime3dState.patchedNamespaces.add(namespace);
    // Re-check constructors on refresh because some NYT bundles attach loaders or
    // animation classes to an existing namespace after the collector is installed.
    instrumentRuntimeRendererTarget(namespace.WebGLRenderer?.prototype);
    instrumentRuntimeLoaderPrototype(namespace.GLTFLoader?.prototype);
    instrumentRuntimeMixerPrototype(namespace.AnimationMixer?.prototype);
    return true;
  }

  function inspectReachableRuntimeValue(value, sourcePath) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return;
    if (typeof value === "function" && value.prototype) {
      const loaderIdentity = `${sourcePath} ${value.name || ""} ${value.prototype?.constructor?.name || ""}`;
      if (/gltf/i.test(loaderIdentity) && typeof value.prototype.load === "function") instrumentRuntimeLoaderPrototype(value.prototype);
      if (typeof value.prototype.render === "function" && /(three|webgl|renderer)/i.test(sourcePath)) instrumentRuntimeRendererTarget(value.prototype);
      if (typeof value.prototype.update === "function" && typeof value.prototype.clipAction === "function") instrumentRuntimeMixerPrototype(value.prototype);
    }
    const instanceLoaderIdentity = `${sourcePath} ${value?.name || ""} ${value?.constructor?.name || ""}`;
    if (
      typeof value.load === "function"
      && (typeof value.parse === "function" || /gltf/i.test(instanceLoaderIdentity))
      && !isRuntimeRenderer(value)
    ) {
      instrumentRuntimeLoaderPrototype(value);
      instrumentRuntimeLoaderPrototype(Object.getPrototypeOf(value));
    }
    if (isRuntimeRenderer(value)) {
      runtime3dState.renderers.add(value);
      instrumentRuntimeRendererTarget(value);
      instrumentRuntimeRendererTarget(Object.getPrototypeOf(value));
    }
    if (isRuntimeScene(value)) registerRuntimeScene(value, null, sourcePath);
    if (isRuntimeMixer(value)) {
      registerRuntimeMixer(value, sourcePath);
      // Patch the instance as well as its prototype. Some story bundles bind or
      // replace mixer methods before the collector is installed.
      instrumentRuntimeMixerPrototype(value);
      instrumentRuntimeMixerPrototype(Object.getPrototypeOf(value));
    }
    if (value.scene && isRuntimeObject3D(value.scene) && Array.isArray(value.animations)) {
      registerRuntimeModel(value.scene, {
        animations: value.animations,
        registrationSource: "reachable-gltf-result"
      });
    }
    instrumentThreeNamespace(value);
  }

  function runtimeBridgeValues(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function registerRuntimeBridgeModelEntry(entry, sourcePath) {
    if (!entry) return null;
    const root = isRuntimeObject3D(entry)
      ? entry
      : [entry.root, entry.scene, entry.model, entry.object3D].find(isRuntimeObject3D);
    if (!root) return null;
    const record = registerRuntimeModel(root, {
      assetUrl: cleanText(entry.assetUrl || entry.modelUrl || entry.gltfUrl || entry.glbUrl),
      identitySource: cleanText(entry.identitySource) || "runtime-bridge",
      identityConfidence: Number.isFinite(Number(entry.identityConfidence)) ? Number(entry.identityConfidence) : 1,
      animations: Array.isArray(entry.animations) ? entry.animations : [],
      registrationSource: sourcePath || "runtime-bridge",
      instanceId: entry.instanceId,
      container: entry.container,
      containerId: entry.containerId,
      compositionId: entry.compositionId || entry.composition,
      frameId: entry.frameId || entry.referenceFrameId || entry.frame,
      frameRoot: entry.frameRoot,
      sourceId: entry.sourceId || entry.sourceIdentity,
      sourceConfigId: entry.sourceConfigId || entry.configId,
      activeStateId: entry.activeStateId || entry.stateId,
      sourceConfig: entry.sourceConfig || entry.config,
      compositionRole: entry.compositionRole || entry.role,
      anchor: entry.anchor || entry.anchorObject,
      anchorKind: entry.anchorKind,
      instanceBoundarySource: "runtime-bridge-explicit",
      instanceBoundaryConfidence: 1,
      instanceBoundaryExplicit: true
    });
    for (const relationship of runtimeBridgeValues(entry.spatialRelationships || entry.relationships)) {
      registerRuntimeBridgeRelationship({
        ...relationship,
        subject: relationship?.subject || relationship?.from || root
      }, sourcePath);
    }
    return record;
  }

  function runtimeBridgeRelationshipEndpoint(value) {
    if (isRuntimeObject3D(value)) {
      return { root: value, instanceId: "", objectId: runtimeObjectId(value, "relationship-endpoint") };
    }
    if (value && typeof value === "object") {
      const root = [value.root, value.scene, value.model, value.object3D].find(isRuntimeObject3D) || null;
      return {
        root,
        instanceId: runtimeHintId(value.instanceId || value.id),
        objectId: root ? runtimeObjectId(root, "relationship-endpoint") : ""
      };
    }
    return { root: null, instanceId: runtimeHintId(value), objectId: "" };
  }

  function registerRuntimeBridgeRelationship(entry, sourcePath) {
    if (!entry || typeof entry !== "object") return null;
    const subject = runtimeBridgeRelationshipEndpoint(entry.subject || entry.from || entry.child);
    const reference = runtimeBridgeRelationshipEndpoint(entry.reference || entry.to || entry.parent || entry.frameRoot);
    if ((!subject.root && !subject.instanceId) || (!reference.root && !reference.instanceId)) return null;
    if (subject.root) {
      registerRuntimeModel(subject.root, {
        registrationSource: sourcePath || "runtime-bridge",
        instanceBoundarySource: "runtime-bridge-explicit",
        instanceBoundaryConfidence: 1,
        instanceBoundaryExplicit: true
      });
    }
    if (reference.root) {
      registerRuntimeModel(reference.root, {
        registrationSource: sourcePath || "runtime-bridge",
        instanceBoundarySource: "runtime-bridge-explicit",
        instanceBoundaryConfidence: 1,
        instanceBoundaryExplicit: true
      });
    }
    const relationshipType = cleanText(entry.relationshipType || entry.type || entry.kind || "", 120);
    const key = [
      subject.objectId || subject.instanceId,
      reference.objectId || reference.instanceId,
      relationshipType,
      runtimeHintId(entry.compositionId),
      runtimeHintId(entry.frameId),
      runtimeHintId(entry.sourceId)
    ].join("|");
    if (
      runtime3dState.explicitSpatialRelationshipKeys.has(key)
      || runtime3dState.explicitSpatialRelationships.length >= MAX_RUNTIME_BRIDGE_RELATION_HINTS
    ) {
      return runtime3dState.explicitSpatialRelationships.find((item) => item.key === key) || null;
    }
    const relationship = {
      key,
      relationshipHintId: `runtime-bridge-relationship-${runtime3dState.explicitSpatialRelationships.length + 1}`,
      subjectRoot: subject.root,
      subjectInstanceId: subject.instanceId,
      referenceRoot: reference.root,
      referenceInstanceId: reference.instanceId,
      relationshipType,
      compositionId: runtimeHintId(entry.compositionId),
      frameId: runtimeHintId(entry.frameId),
      sourceId: runtimeHintId(entry.sourceId),
      confidence: Number.isFinite(Number(entry.confidence))
        ? Math.max(0, Math.min(1, Number(entry.confidence)))
        : 1,
      source: cleanText(sourcePath || "runtime-bridge", 240)
    };
    runtime3dState.explicitSpatialRelationships.push(relationship);
    runtime3dState.explicitSpatialRelationshipKeys.add(key);
    touchRuntime3DCatalog();
    return relationship;
  }

  function registerRuntimeBridgeComposition(entry, sourcePath) {
    if (!entry || typeof entry !== "object") return null;
    const compositionId = runtimeHintId(entry.compositionId || entry.id || entry.name);
    if (!compositionId) return null;
    const container = [entry.container, entry.root].find(isRuntimeObject3D) || null;
    const frameRoot = isRuntimeObject3D(entry.frameRoot) ? entry.frameRoot : null;
    const memberRecords = [];
    for (const member of runtimeBridgeValues(entry.members || entry.models)) {
      const record = registerRuntimeBridgeModelEntry(member, sourcePath);
      if (!record) continue;
      applyRuntimeModelHints(record, {
        compositionId,
        container,
        containerId: entry.containerId,
        frameId: entry.frameId || entry.referenceFrameId,
        frameRoot,
        sourceId: entry.sourceId,
        sourceConfigId: entry.sourceConfigId || entry.configId,
        activeStateId: entry.activeStateId || entry.stateId
      });
      memberRecords.push(record);
    }
    const next = {
      compositionId,
      container,
      containerIdHint: runtimeHintId(entry.containerId),
      frameId: runtimeHintId(entry.frameId || entry.referenceFrameId),
      frameRoot,
      sourceId: runtimeHintId(entry.sourceId),
      sourceConfigId: runtimeHintId(entry.sourceConfigId || entry.configId),
      activeStateId: runtimeHintId(entry.activeStateId || entry.stateId),
      memberInstanceIds: memberRecords.map((record) => record.instanceId),
      source: cleanText(sourcePath || "runtime-bridge", 240)
    };
    const previous = runtime3dState.compositionRecords.get(compositionId);
    runtime3dState.compositionRecords.set(compositionId, next);
    if (JSON.stringify(previous?.memberInstanceIds || []) !== JSON.stringify(next.memberInstanceIds)) touchRuntime3DCatalog();
    return next;
  }

  function registerRuntimeBridgeFrame(entry, sourcePath) {
    if (!entry || typeof entry !== "object") return null;
    const frameId = runtimeHintId(entry.frameId || entry.id || entry.name);
    if (!frameId) return null;
    const root = [entry.frameRoot, entry.root, entry.object3D].find(isRuntimeObject3D) || null;
    const next = {
      frameId,
      root,
      compositionId: runtimeHintId(entry.compositionId),
      sourceId: runtimeHintId(entry.sourceId),
      sourceConfigId: runtimeHintId(entry.sourceConfigId || entry.configId),
      source: cleanText(sourcePath || "runtime-bridge", 240)
    };
    if (!runtime3dState.frameRecords.has(frameId)) touchRuntime3DCatalog();
    runtime3dState.frameRecords.set(frameId, next);
    return next;
  }

  function registerRuntime3DBridge(runtime, options = {}) {
    if (!runtime || (typeof runtime !== "object" && typeof runtime !== "function")) return runtime3dMetadata();
    const source = cleanText(options.source) || "runtime-bridge";
    const queue = [{ value: runtime, depth: 0, path: source }];
    const seen = new WeakSet();
    let inspected = 0;
    let recognized = 0;

    while (queue.length && inspected < MAX_RUNTIME_BRIDGE_OBJECTS) {
      const current = queue.shift();
      const value = current.value;
      if (!value || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) continue;
      seen.add(value);
      inspected += 1;

      try {
        inspectReachableRuntimeValue(value, current.path);
      } catch {
        // A partial bridge must not prevent the remaining runtime handles from registering.
      }

      if (instrumentThreeNamespace(value)) recognized += 1;
      if (isRuntimeRenderer(value)) recognized += 1;
      if (isRuntimeScene(value)) recognized += 1;
      if (isRuntimeMixer(value)) recognized += 1;

      const renderer = safeRuntimeValue(value, "renderer");
      const camera = safeRuntimeValue(value, "camera");
      const scenes = runtimeBridgeValues(safeRuntimeValue(value, "scene"))
        .concat(runtimeBridgeValues(safeRuntimeValue(value, "scenes")))
        .filter(isRuntimeScene);
      if (isRuntimeRenderer(renderer)) {
        recognized += 1;
        runtime3dState.renderers.add(renderer);
        instrumentRuntimeRendererTarget(renderer);
        instrumentRuntimeRendererTarget(Object.getPrototypeOf(renderer));
      }
      for (const scene of scenes) {
        recognized += 1;
        const sceneRecord = registerRuntimeScene(scene, isRuntimeObject3D(camera) ? camera : null, source);
        if (sceneRecord && isRuntimeRenderer(renderer)) sceneRecord.renderer = renderer;
      }

      const mixers = runtimeBridgeValues(safeRuntimeValue(value, "mixer"))
        .concat(runtimeBridgeValues(safeRuntimeValue(value, "mixers")));
      for (const mixer of mixers) {
        if (!isRuntimeMixer(mixer)) continue;
        recognized += 1;
        registerRuntimeMixer(mixer, source);
        instrumentRuntimeMixerPrototype(mixer);
        instrumentRuntimeMixerPrototype(Object.getPrototypeOf(mixer));
      }

      const modelEntries = runtimeBridgeValues(safeRuntimeValue(value, "model"))
        .concat(runtimeBridgeValues(safeRuntimeValue(value, "models")))
        .concat(runtimeBridgeValues(safeRuntimeValue(value, "gltf")));
      for (const entry of modelEntries) {
        if (registerRuntimeBridgeModelEntry(entry, source)) recognized += 1;
      }
      if (/models?(?:\[|\.|$)|gltf|root/i.test(current.path) && registerRuntimeBridgeModelEntry(value, source)) {
        recognized += 1;
      }
      for (const entry of runtimeBridgeValues(safeRuntimeValue(value, "compositions"))) {
        if (registerRuntimeBridgeComposition(entry, source)) recognized += 1;
      }
      for (const entry of runtimeBridgeValues(safeRuntimeValue(value, "frames"))) {
        if (registerRuntimeBridgeFrame(entry, source)) recognized += 1;
      }
      const relationshipEntries = runtimeBridgeValues(safeRuntimeValue(value, "spatialRelationships"))
        .concat(runtimeBridgeValues(safeRuntimeValue(value, "relationships")));
      for (const entry of relationshipEntries) {
        if (registerRuntimeBridgeRelationship(entry, source)) recognized += 1;
      }

      if (current.depth >= MAX_RUNTIME_BRIDGE_DEPTH || isRuntimeObject3D(value)) continue;
      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(value);
      } catch {
        keys = [];
      }
      const selectedKeys = Array.isArray(value)
        ? keys.filter((key) => /^\d+$/.test(key)).slice(0, 160)
        : keys.filter((key) => (
            RUNTIME_HANDLE_KEY_PATTERN.test(key)
            || [
              "root",
              "object3D",
              "animations",
              "clips",
              "webGL",
              "compositions",
              "frames",
              "relationships",
              "spatialRelationships"
            ].includes(key)
          )).slice(0, 120);
      for (const key of selectedKeys) {
        const child = safeRuntimeValue(value, key);
        if (!child || (typeof child !== "object" && typeof child !== "function")) continue;
        queue.push({ value: child, depth: current.depth + 1, path: `${current.path}.${key}` });
      }
    }

    if (recognized) {
      if (!runtime3dState.registeredBridgeRoots.has(runtime)) {
        runtime3dState.registeredBridgeRoots.add(runtime);
        runtime3dState.bridgeRegistrationCount += 1;
      }
      runtime3dState.capabilities.runtimeBridgeFound = true;
      runtime3dState.capabilities.existingRuntimeObjectsDiscovered = true;
    }
    return runtime3dMetadata();
  }

  function discoverRegisteredRuntimeBridges() {
    let discovered = 0;
    for (const key of RUNTIME_BRIDGE_GLOBAL_KEYS) {
      const candidate = safeRuntimeValue(window, key);
      for (const runtime of runtimeBridgeValues(candidate)) {
        if (!runtime || runtime === window.NYTAnimationProbe) continue;
        const before = runtime3dState.bridgeRegistrationCount;
        registerRuntime3DBridge(runtime, { source: `window.${key}` });
        if (runtime3dState.bridgeRegistrationCount > before) discovered += 1;
      }
    }
    try {
      const symbol = typeof Symbol === "function" ? Symbol.for("storyvr.animationProbe.runtime") : null;
      const candidate = symbol ? safeRuntimeValue(window, symbol) : null;
      if (candidate) {
        const before = runtime3dState.bridgeRegistrationCount;
        registerRuntime3DBridge(candidate, { source: "window.Symbol(storyvr.animationProbe.runtime)" });
        if (runtime3dState.bridgeRegistrationCount > before) discovered += 1;
      }
    } catch {
      // Symbol-based bridges are optional.
    }
    return discovered;
  }

  function discoverDomRuntimeHandles() {
    const nodes = [];
    try {
      nodes.push(...Array.from(document.querySelectorAll?.("canvas") || []));
      nodes.push(...Array.from(document.querySelectorAll?.("[data-storyvr-animation-runtime]") || []));
    } catch {
      return 0;
    }
    const inspectedNodes = new Set();
    let discovered = 0;
    for (const initialNode of nodes.slice(0, 48)) {
      let node = initialNode;
      for (let ancestorDepth = 0; node && ancestorDepth <= 3; ancestorDepth += 1, node = node.parentElement || null) {
        if (inspectedNodes.has(node)) continue;
        inspectedNodes.add(node);
        let keys = [];
        try {
          keys = Object.getOwnPropertyNames(node).filter((key) => RUNTIME_HANDLE_KEY_PATTERN.test(key)).slice(0, 80);
        } catch {
          keys = [];
        }
        for (const key of keys) {
          const candidate = safeRuntimeValue(node, key);
          if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) continue;
          const before = runtime3dState.bridgeRegistrationCount;
          registerRuntime3DBridge(candidate, { source: `dom-runtime-handle:${key}` });
          if (runtime3dState.bridgeRegistrationCount > before) discovered += 1;
        }
      }
    }
    runtime3dState.domRuntimeHandleCount = Math.max(runtime3dState.domRuntimeHandleCount, discovered);
    if (discovered) runtime3dState.capabilities.domRuntimeHandlesInspected = true;
    return discovered;
  }

  function requestRuntime3DBridge() {
    if (typeof window.dispatchEvent !== "function" || typeof window.CustomEvent !== "function") return false;
    try {
      const event = new window.CustomEvent(RUNTIME_BRIDGE_EVENT, {
        detail: {
          schemaVersion: "storyvr-runtime-bridge/v1",
          register: (runtime, bridgeOptions = {}) => registerRuntime3DBridge(runtime, {
            ...bridgeOptions,
            source: cleanText(bridgeOptions.source) || "runtime-bridge-event"
          })
        }
      });
      window.dispatchEvent(event);
      runtime3dState.bridgeRequestCount += 1;
      return true;
    } catch {
      return false;
    }
  }

  function discoverReachableRuntimeObjects() {
    discoverRegisteredRuntimeBridges();
    discoverDomRuntimeHandles();
    const discoveryStartedAt = performance.now();
    if (discoveryStartedAt - runtime3dState.lastDiscoveryElapsedMs < 900) return 0;
    runtime3dState.lastDiscoveryElapsedMs = discoveryStartedAt;
    discoverRequireJsRuntimeModules();
    const queue = [{ value: window, depth: 0, path: "window" }];
    const seen = new WeakSet();
    let inspected = 0;
    while (queue.length && inspected < MAX_RUNTIME_DISCOVERY_OBJECTS) {
      const current = queue.shift();
      const value = current.value;
      if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      inspected += 1;
      try {
        inspectReachableRuntimeValue(value, current.path);
      } catch {
        continue;
      }
      if (current.depth >= MAX_RUNTIME_DISCOVERY_DEPTH) continue;
      if (value !== window && (isRuntimeObject3D(value) || isRuntimeRenderer(value) || value.nodeType || value === document)) continue;

      let keys = [];
      try {
        keys = Object.getOwnPropertyNames(value);
      } catch {
        continue;
      }
      const prioritizedKeys = value === window
        ? [
            ...keys.filter((key) => RUNTIME_HANDLE_KEY_PATTERN.test(key)),
            ...keys.filter((key) => !RUNTIME_HANDLE_KEY_PATTERN.test(key)).slice(0, 700)
          ]
        : keys;
      const limit = value === window ? 900 : Array.isArray(value) ? 60 : 100;
      for (const key of prioritizedKeys.slice(0, limit)) {
        if (["window", "self", "top", "parent", "frames", "document", "localStorage", "sessionStorage", "indexedDB", "cookieStore"].includes(key)) continue;
        const child = safeRuntimeValue(value, key);
        if (!child || (typeof child !== "object" && typeof child !== "function")) continue;
        queue.push({ value: child, depth: current.depth + 1, path: `${current.path}.${key}` });
      }
    }
    runtime3dState.discoveredObjectCount = Math.max(runtime3dState.discoveredObjectCount, inspected);
    runtime3dState.lastDiscoveryAt = new Date().toISOString();
    if (runtime3dState.scenes.size || runtime3dState.mixers.size || runtime3dState.renderers.size || runtime3dState.models.size) {
      runtime3dState.capabilities.existingRuntimeObjectsDiscovered = true;
    }
    return inspected;
  }

  function discoverRequireJsRuntimeModules() {
    try {
      const requireJs = window.requirejs || window.require;
      const contexts = requireJs?.s?.contexts;
      if (!contexts || typeof contexts !== "object") return 0;
      let inspected = 0;
      for (const contextName of Object.keys(contexts).slice(0, 12)) {
        const defined = contexts[contextName]?.defined;
        if (!defined || typeof defined !== "object") continue;
        for (const moduleName of Object.keys(defined).slice(0, 600)) {
          if (!/(three|webgl|gltf|animation|scene|model)/i.test(moduleName)) continue;
          const moduleValue = safeRuntimeValue(defined, moduleName);
          if (!moduleValue) continue;
          inspected += 1;
          inspectReachableRuntimeValue(moduleValue, `requirejs:${contextName}:${moduleName}`);
          const defaultValue = safeRuntimeValue(moduleValue, "default");
          if (defaultValue) inspectReachableRuntimeValue(defaultValue, `requirejs:${contextName}:${moduleName}:default`);
        }
      }
      if (inspected) runtime3dState.capabilities.requireJsModulesInspected = true;
      return inspected;
    } catch {
      return 0;
    }
  }

  function installRuntime3DInstrumentation(forceDiscovery = false) {
    if (!runtime3dState.installedAt) {
      runtime3dState.installedAt = new Date().toISOString();
    }
    if (!runtimeScrollHandler) {
      runtimeScrollHandler = () => {
        lastScrollEventAt = performance.now();
        scheduleBeatChangeSnapshot();
      };
      window.addEventListener("scroll", runtimeScrollHandler, { passive: true });
    }
    for (const key of ["THREE", "three", "Three"]) {
      try {
        instrumentThreeNamespace(window[key]);
      } catch {
        // Ignore inaccessible global namespace candidates.
      }
    }
    requestRuntime3DBridge();
    discoverRegisteredRuntimeBridges();
    discoverDomRuntimeHandles();
    if (forceDiscovery) runtime3dState.lastDiscoveryElapsedMs = -Infinity;
    discoverReachableRuntimeObjects();
    return runtime3dMetadata();
  }

  function isDescendantRuntimeObject(object, ancestor) {
    if (!object || !ancestor) return false;
    let current = object;
    const seen = new Set();
    while (current && !seen.has(current)) {
      if (current === ancestor) return true;
      seen.add(current);
      current = current.parent || null;
    }
    return false;
  }

  function runtimeObjectPath(object, root) {
    const parts = [];
    let current = object;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const siblings = Array.isArray(current.parent?.children) ? current.parent.children : [];
      const siblingIndex = siblings.indexOf(current);
      const label = cleanText(current.name || current.type || "node", 100).replace(/[\/]+/g, "_") || "node";
      parts.unshift(`${label}[${Math.max(0, siblingIndex)}]`);
      if (current === root) break;
      current = current.parent || null;
    }
    return parts.join("/");
  }

  function runtimeAncestorVisible(object, stopAt = null) {
    let current = object?.parent || null;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current.visible === false) return false;
      if (current === stopAt) break;
      current = current.parent || null;
    }
    return true;
  }

  function runtimeMaterialState(material) {
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    if (!materials.length) {
      return { materialVisible: true, materialOpacity: 1, materialCount: 0 };
    }
    const visibleMaterials = materials.filter((item) => item && item.visible !== false);
    const opacityValues = visibleMaterials
      .map((item) => Number(item.opacity))
      .filter((value) => Number.isFinite(value));
    return {
      materialVisible: visibleMaterials.length > 0,
      materialOpacity: opacityValues.length ? finiteRuntimeNumber(Math.max(...opacityValues)) : 1,
      materialCount: materials.length
    };
  }

  function runtimeLayersMatch(object, camera) {
    try {
      if (!object?.layers || !camera?.layers || typeof object.layers.test !== "function") return true;
      return Boolean(object.layers.test(camera.layers));
    } catch {
      return true;
    }
  }

  function runtimeWorldPosition(object) {
    const elements = object?.matrixWorld?.elements;
    if (!elements || elements.length < 16) return null;
    return [finiteRuntimeNumber(elements[12]), finiteRuntimeNumber(elements[13]), finiteRuntimeNumber(elements[14])];
  }

  function runtimeWorldTransformSignature(object) {
    const elements = object?.matrixWorld?.elements;
    if (!elements || elements.length < 16) return "";
    return hashString(Array.from(elements).slice(0, 16).map((value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(4) : "null";
    }).join(","));
  }

  function runtimeMatrixArray(matrixLike) {
    const elements = matrixLike?.elements || matrixLike;
    if (!elements || elements.length < 16) return null;
    const matrix = Array.from(elements).slice(0, 16).map((value) => finiteRuntimeNumber(value, 8));
    return matrix.every((value) => value != null) ? matrix : null;
  }

  function runtimeIdentityMatrix() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function runtimeVector3(value, fallback) {
    const vector = Array.isArray(value)
      ? value.slice(0, 3)
      : [value?.x, value?.y, value?.z];
    const normalized = vector.map((item, index) => {
      const number = finiteRuntimeNumber(item, 8);
      return number == null ? fallback[index] : number;
    });
    return normalized;
  }

  function runtimeQuaternion(value) {
    const quaternion = Array.isArray(value)
      ? value.slice(0, 4)
      : [value?.x, value?.y, value?.z, value?.w];
    const normalized = quaternion.map((item, index) => {
      const number = finiteRuntimeNumber(item, 8);
      return number == null ? [0, 0, 0, 1][index] : number;
    });
    const length = Math.hypot(...normalized);
    return length > 1e-12 ? normalized.map((item) => finiteRuntimeNumber(item / length, 8)) : [0, 0, 0, 1];
  }

  function runtimeComposeMatrix(position, quaternion, scale) {
    const [x, y, z, w] = quaternion;
    const [sx, sy, sz] = scale;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    return [
      (1 - (yy + zz)) * sx,
      (xy + wz) * sx,
      (xz - wy) * sx,
      0,
      (xy - wz) * sy,
      (1 - (xx + zz)) * sy,
      (yz + wx) * sy,
      0,
      (xz + wy) * sz,
      (yz - wx) * sz,
      (1 - (xx + yy)) * sz,
      0,
      position[0],
      position[1],
      position[2],
      1
    ].map((value) => finiteRuntimeNumber(value, 8));
  }

  function runtimeLocalMatrix(object) {
    const matrix = runtimeMatrixArray(object?.matrix);
    if (matrix) return matrix;
    if (object?.position || object?.quaternion || object?.scale) {
      return runtimeComposeMatrix(
        runtimeVector3(object.position, [0, 0, 0]),
        runtimeQuaternion(object.quaternion),
        runtimeVector3(object.scale, [1, 1, 1])
      );
    }
    return runtimeIdentityMatrix();
  }

  function runtimeWorldMatrix(object) {
    return runtimeMatrixArray(object?.matrixWorld) || runtimeLocalMatrix(object);
  }

  function runtimeMultiplyMatrices(left, right) {
    if (!left || !right) return null;
    const output = new Array(16).fill(0);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let value = 0;
        for (let index = 0; index < 4; index += 1) {
          value += left[index * 4 + row] * right[column * 4 + index];
        }
        output[column * 4 + row] = finiteRuntimeNumber(value, 8);
      }
    }
    return output;
  }

  function runtimeInvertMatrix(matrix) {
    if (!matrix) return null;
    const rows = Array.from({ length: 4 }, (_, row) => (
      Array.from({ length: 8 }, (_, column) => (
        column < 4 ? Number(matrix[column * 4 + row]) : Number(column - 4 === row)
      ))
    ));
    for (let pivotColumn = 0; pivotColumn < 4; pivotColumn += 1) {
      let pivotRow = pivotColumn;
      for (let row = pivotColumn + 1; row < 4; row += 1) {
        if (Math.abs(rows[row][pivotColumn]) > Math.abs(rows[pivotRow][pivotColumn])) pivotRow = row;
      }
      if (Math.abs(rows[pivotRow][pivotColumn]) < 1e-12) return null;
      [rows[pivotColumn], rows[pivotRow]] = [rows[pivotRow], rows[pivotColumn]];
      const pivot = rows[pivotColumn][pivotColumn];
      rows[pivotColumn] = rows[pivotColumn].map((value) => value / pivot);
      for (let row = 0; row < 4; row += 1) {
        if (row === pivotColumn) continue;
        const factor = rows[row][pivotColumn];
        rows[row] = rows[row].map((value, column) => value - factor * rows[pivotColumn][column]);
      }
    }
    const inverse = new Array(16);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        inverse[column * 4 + row] = finiteRuntimeNumber(rows[row][column + 4], 8);
      }
    }
    return inverse;
  }

  function runtimeTransformPoint(matrix, point) {
    if (!matrix || !point) return null;
    const [x, y, z] = point;
    const denominator = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    const divisor = Math.abs(denominator) > 1e-12 ? denominator : 1;
    return [
      (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / divisor,
      (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / divisor,
      (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / divisor
    ].map((value) => finiteRuntimeNumber(value, 8));
  }

  function runtimeQuaternionFromMatrix(matrix, scale) {
    if (!matrix || !scale || scale.some((value) => Math.abs(value) < 1e-12)) return [0, 0, 0, 1];
    const m11 = matrix[0] / scale[0];
    const m12 = matrix[4] / scale[1];
    const m13 = matrix[8] / scale[2];
    const m21 = matrix[1] / scale[0];
    const m22 = matrix[5] / scale[1];
    const m23 = matrix[9] / scale[2];
    const m31 = matrix[2] / scale[0];
    const m32 = matrix[6] / scale[1];
    const m33 = matrix[10] / scale[2];
    const trace = m11 + m22 + m33;
    let x;
    let y;
    let z;
    let w;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      w = 0.25 / s;
      x = (m32 - m23) * s;
      y = (m13 - m31) * s;
      z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(Math.max(0, 1 + m11 - m22 - m33));
      w = (m32 - m23) / s;
      x = 0.25 * s;
      y = (m12 + m21) / s;
      z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(Math.max(0, 1 + m22 - m11 - m33));
      w = (m13 - m31) / s;
      x = (m12 + m21) / s;
      y = 0.25 * s;
      z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(Math.max(0, 1 + m33 - m11 - m22));
      w = (m21 - m12) / s;
      x = (m13 + m31) / s;
      y = (m23 + m32) / s;
      z = 0.25 * s;
    }
    return runtimeQuaternion([x, y, z, w]);
  }

  function runtimeMatrixTrs(matrix) {
    if (!matrix) return null;
    let scale = [
      Math.hypot(matrix[0], matrix[1], matrix[2]),
      Math.hypot(matrix[4], matrix[5], matrix[6]),
      Math.hypot(matrix[8], matrix[9], matrix[10])
    ];
    const determinant = (
      matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
      - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
      + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2])
    );
    if (determinant < 0) scale[0] *= -1;
    scale = scale.map((value) => finiteRuntimeNumber(value, 8));
    return {
      position: [matrix[12], matrix[13], matrix[14]].map((value) => finiteRuntimeNumber(value, 8)),
      quaternion: runtimeQuaternionFromMatrix(matrix, scale),
      scale
    };
  }

  function runtimeTransformState(object) {
    const localMatrix = runtimeLocalMatrix(object);
    const worldMatrix = runtimeWorldMatrix(object);
    return {
      localTransform: {
        matrix: localMatrix,
        trs: {
          position: runtimeVector3(object?.position, [localMatrix[12], localMatrix[13], localMatrix[14]]),
          quaternion: object?.quaternion ? runtimeQuaternion(object.quaternion) : runtimeMatrixTrs(localMatrix)?.quaternion || [0, 0, 0, 1],
          scale: object?.scale ? runtimeVector3(object.scale, [1, 1, 1]) : runtimeMatrixTrs(localMatrix)?.scale || [1, 1, 1]
        }
      },
      worldTransform: {
        matrix: worldMatrix,
        trs: runtimeMatrixTrs(worldMatrix)
      }
    };
  }

  function runtimeAabb(min, max) {
    if (!min || !max || min.length < 3 || max.length < 3) return null;
    const normalizedMin = min.slice(0, 3).map((value) => finiteRuntimeNumber(value, 8));
    const normalizedMax = max.slice(0, 3).map((value) => finiteRuntimeNumber(value, 8));
    if (normalizedMin.some((value) => value == null) || normalizedMax.some((value) => value == null)) return null;
    return { min: normalizedMin, max: normalizedMax };
  }

  function runtimeBoundsFromAabb(aabb, options = {}) {
    if (!aabb) return null;
    const center = aabb.min.map((value, index) => finiteRuntimeNumber((value + aabb.max[index]) / 2, 8));
    const radius = Math.hypot(
      aabb.max[0] - center[0],
      aabb.max[1] - center[1],
      aabb.max[2] - center[2]
    );
    return {
      aabb,
      center,
      boundingSphere: {
        center: [...center],
        radius: finiteRuntimeNumber(radius, 8)
      },
      approximate: Boolean(options.approximate),
      source: cleanText(options.source || "", 100)
    };
  }

  function runtimeMergeAabbs(left, right) {
    if (!left) return right ? runtimeAabb(right.min, right.max) : null;
    if (!right) return runtimeAabb(left.min, left.max);
    return runtimeAabb(
      left.min.map((value, index) => Math.min(value, right.min[index])),
      left.max.map((value, index) => Math.max(value, right.max[index]))
    );
  }

  function runtimeAggregateBoundingSphere(center, spheres) {
    if (!center || !spheres.length) return null;
    let radius = 0;
    for (const sphere of spheres) {
      if (!sphere?.center || !Number.isFinite(Number(sphere.radius))) continue;
      radius = Math.max(
        radius,
        Math.hypot(
          sphere.center[0] - center[0],
          sphere.center[1] - center[1],
          sphere.center[2] - center[2]
        ) + Number(sphere.radius)
      );
    }
    return {
      center: [...center],
      radius: finiteRuntimeNumber(radius, 8)
    };
  }

  function runtimeTransformAabb(aabb, matrix, options = {}) {
    if (!aabb || !matrix) return null;
    let transformed = null;
    for (const x of [aabb.min[0], aabb.max[0]]) {
      for (const y of [aabb.min[1], aabb.max[1]]) {
        for (const z of [aabb.min[2], aabb.max[2]]) {
          const point = runtimeTransformPoint(matrix, [x, y, z]);
          const pointAabb = runtimeAabb(point, point);
          transformed = runtimeMergeAabbs(transformed, pointAabb);
        }
      }
    }
    return runtimeBoundsFromAabb(transformed, options);
  }

  function runtimeTransformGeometryBounds(geometryRecord, matrix, options = {}) {
    if (!geometryRecord?.localAabb || !matrix) return null;
    const bounds = runtimeTransformAabb(geometryRecord.localAabb, matrix, options);
    if (!bounds || !geometryRecord.localBoundingSphere) return bounds;
    const scale = [
      Math.hypot(matrix[0], matrix[1], matrix[2]),
      Math.hypot(matrix[4], matrix[5], matrix[6]),
      Math.hypot(matrix[8], matrix[9], matrix[10])
    ];
    bounds.boundingSphere = {
      center: runtimeTransformPoint(matrix, geometryRecord.localBoundingSphere.center),
      radius: finiteRuntimeNumber(
        geometryRecord.localBoundingSphere.radius * Math.max(...scale),
        8
      )
    };
    return bounds;
  }

  function runtimeGeometryPositionAttribute(geometry) {
    try {
      return geometry?.attributes?.position
        || (typeof geometry?.getAttribute === "function" ? geometry.getAttribute("position") : null)
        || null;
    } catch {
      return null;
    }
  }

  function runtimeAttributeCount(attribute) {
    const explicit = Number(attribute?.count);
    if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
    const itemSize = Math.max(1, Number(attribute?.itemSize) || 3);
    return Math.floor(Number(attribute?.array?.length || 0) / itemSize);
  }

  function runtimeAttributePoint(attribute, index) {
    try {
      if (typeof attribute?.getX === "function") {
        return [
          attribute.getX(index),
          typeof attribute.getY === "function" ? attribute.getY(index) : 0,
          typeof attribute.getZ === "function" ? attribute.getZ(index) : 0
        ].map((value) => finiteRuntimeNumber(value, 8));
      }
      const itemSize = Math.max(1, Number(attribute?.itemSize) || 3);
      const offset = index * itemSize;
      return [
        attribute?.array?.[offset],
        attribute?.array?.[offset + 1] ?? 0,
        attribute?.array?.[offset + 2] ?? 0
      ].map((value) => finiteRuntimeNumber(value, 8));
    } catch {
      return null;
    }
  }

  function runtimeGeometryCacheKey(geometry, position, vertexCount, indexCount) {
    return [
      geometry?.version ?? "",
      position?.version ?? "",
      vertexCount,
      Number(position?.itemSize) || 3,
      Number(position?.array?.length) || 0,
      indexCount
    ].join(":");
  }

  function ensureRuntimeGeometryRecord(geometry, object = null) {
    if (!geometry || (typeof geometry !== "object" && typeof geometry !== "function")) return null;
    const position = runtimeGeometryPositionAttribute(geometry);
    const vertexCount = runtimeAttributeCount(position);
    const indexAttribute = geometry.index || null;
    const indexCount = Number.isFinite(Number(indexAttribute?.count))
      ? Math.max(0, Math.floor(Number(indexAttribute.count)))
      : Math.max(0, Number(indexAttribute?.array?.length || 0));
    const cacheKey = runtimeGeometryCacheKey(geometry, position, vertexCount, indexCount);
    const cached = runtime3dState.geometryCache.get(geometry);
    if (cached?.cacheKey === cacheKey) return cached.record;

    let aabb = null;
    let measuredBoundingSphere = null;
    const fingerprintValues = [
      cleanText(geometry.type || object?.type || "geometry", 80),
      vertexCount,
      indexCount,
      Number(position?.itemSize) || 3,
      position?.normalized === true ? 1 : 0
    ];
    if (position && vertexCount > 0) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < vertexCount; index += 1) {
        const point = runtimeAttributePoint(position, index);
        if (!point || point.some((value) => value == null)) continue;
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
      if (min.every(Number.isFinite) && max.every(Number.isFinite)) aabb = runtimeAabb(min, max);
      if (aabb) {
        const center = aabb.min.map((value, axis) => (value + aabb.max[axis]) / 2);
        let radius = 0;
        for (let index = 0; index < vertexCount; index += 1) {
          const point = runtimeAttributePoint(position, index);
          if (!point || point.some((value) => value == null)) continue;
          radius = Math.max(
            radius,
            Math.hypot(
              point[0] - center[0],
              point[1] - center[1],
              point[2] - center[2]
            )
          );
        }
        measuredBoundingSphere = {
          center: center.map((value) => finiteRuntimeNumber(value, 8)),
          radius: finiteRuntimeNumber(radius, 8)
        };
      }
      const sampleCount = Math.min(vertexCount, MAX_RUNTIME_GEOMETRY_FINGERPRINT_SAMPLES);
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const vertexIndex = sampleCount <= 1
          ? 0
          : Math.round((sampleIndex * (vertexCount - 1)) / (sampleCount - 1));
        const point = runtimeAttributePoint(position, vertexIndex);
        if (point) fingerprintValues.push(...point.map((value) => value == null ? "null" : value.toFixed(5)));
      }
    }
    if (indexCount > 0) {
      const sampleCount = Math.min(indexCount, MAX_RUNTIME_GEOMETRY_FINGERPRINT_SAMPLES);
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const index = sampleCount <= 1
          ? 0
          : Math.round((sampleIndex * (indexCount - 1)) / (sampleCount - 1));
        let value = null;
        try {
          value = typeof indexAttribute?.getX === "function"
            ? indexAttribute.getX(index)
            : indexAttribute?.array?.[index];
        } catch {
          value = null;
        }
        fingerprintValues.push(Number.isFinite(Number(value)) ? Number(value) : "null");
      }
    }
    if (!aabb) {
      const box = geometry.boundingBox;
      const min = runtimeVector3(box?.min, [NaN, NaN, NaN]);
      const max = runtimeVector3(box?.max, [NaN, NaN, NaN]);
      if (min.every(Number.isFinite) && max.every(Number.isFinite)) aabb = runtimeAabb(min, max);
    }
    if (!aabb && geometry.boundingSphere) {
      const center = runtimeVector3(geometry.boundingSphere.center, [NaN, NaN, NaN]);
      const radius = finiteRuntimeNumber(geometry.boundingSphere.radius, 8);
      if (center.every(Number.isFinite) && radius != null) {
        measuredBoundingSphere = { center, radius };
        aabb = runtimeAabb(
          center.map((value) => value - radius),
          center.map((value) => value + radius)
        );
      }
    }
    if (aabb) fingerprintValues.push(...aabb.min, ...aabb.max);
    const fingerprint = `geometry-fp-${hashString(fingerprintValues.join("|"))}`;
    let record = cached?.record;
    if (!record) {
      runtime3dState.geometrySerial += 1;
      record = {
        geometryCatalogId: `runtime-geometry-${runtime3dState.geometrySerial}`,
        geometryObjectId: runtimeObjectId(geometry, `geometry-${runtime3dState.geometrySerial}`)
      };
      runtime3dState.geometryRecords.set(record.geometryCatalogId, record);
    }
    const bounds = runtimeBoundsFromAabb(aabb, {
      approximate: Boolean(object?.isSkinnedMesh || object?.isInstancedMesh || object?.morphTargetInfluences?.length),
      source: position && vertexCount > 0 ? "position-attribute" : aabb ? "geometry-bounds" : "unavailable"
    });
    if (bounds && measuredBoundingSphere) bounds.boundingSphere = measuredBoundingSphere;
    Object.assign(record, {
      fingerprint,
      geometryType: cleanText(geometry.type || "", 100),
      vertexCount,
      indexCount,
      positionItemSize: Number(position?.itemSize) || (position ? 3 : null),
      positionNormalized: Boolean(position?.normalized),
      localAabb: bounds?.aabb || null,
      localCenter: bounds?.center || null,
      localBoundingSphere: bounds?.boundingSphere || null,
      approximate: bounds?.approximate || false,
      boundsSource: bounds?.source || "unavailable"
    });
    runtime3dState.geometryCache.set(geometry, { cacheKey, record });
    touchRuntime3DCatalog();
    return record;
  }

  function isRuntimeRenderablePart(object) {
    return Boolean(object && (
      object.isMesh === true
      || object.isPoints === true
      || object.isLine === true
      || object.isSprite === true
      || (object.geometry && object.material)
    ));
  }

  function ensureRuntimePartCatalog(modelRecord, object, geometryRecord) {
    let record = modelRecord.partCatalogByObject.get(object);
    if (!record) {
      runtime3dState.partCatalogSerial += 1;
      record = {
        catalogPartId: `runtime-part-${runtime3dState.partCatalogSerial}`,
        catalogModelId: modelRecord.catalogModelId,
        instanceId: modelRecord.instanceId,
        nodeId: runtimeObjectId(object, runtimeObjectPath(object, modelRecord.root)),
        parentObjectId: runtimeObjectId(object.parent, "model-root"),
        nodeIndex: Number.isInteger(object.userData?.gltfNodeIndex) ? object.userData.gltfNodeIndex : null,
        nodePath: runtimeObjectPath(object, modelRecord.root),
        name: cleanText(object.name || "", 240),
        objectType: cleanText(object.type || "", 100),
        isMesh: Boolean(object.isMesh || (object.geometry && object.material)),
        isSkinnedMesh: Boolean(object.isSkinnedMesh),
        isInstancedMesh: Boolean(object.isInstancedMesh),
        morphTargetCount: Array.isArray(object.morphTargetInfluences) ? object.morphTargetInfluences.length : 0,
        geometryCatalogId: geometryRecord?.geometryCatalogId || "",
        geometryFingerprint: geometryRecord?.fingerprint || ""
      };
      modelRecord.partCatalogByObject.set(object, record);
      runtime3dState.partCatalogRecords.set(record.catalogPartId, record);
      touchRuntime3DCatalog();
    } else if (geometryRecord && record.geometryFingerprint !== geometryRecord.fingerprint) {
      record.geometryCatalogId = geometryRecord.geometryCatalogId;
      record.geometryFingerprint = geometryRecord.fingerprint;
      touchRuntime3DCatalog();
    }
    return record;
  }

  function sampleRuntimePart(object, modelRecord, camera, rootInverseWorld = null) {
    const root = modelRecord.root;
    const selfVisible = object.visible !== false;
    const ancestorVisible = runtimeAncestorVisible(object, root);
    const effectiveVisible = selfVisible && ancestorVisible && root.visible !== false;
    const material = runtimeMaterialState(object.material);
    const layersMatch = runtimeLayersMatch(object, camera);
    const renderEligible = effectiveVisible && material.materialVisible && Number(material.materialOpacity ?? 1) > 0.0001 && layersMatch;
    const geometryRecord = ensureRuntimeGeometryRecord(object.geometry, object);
    const catalogPart = ensureRuntimePartCatalog(modelRecord, object, geometryRecord);
    const transform = runtimeTransformState(object);
    const approximateBounds = Boolean(
      geometryRecord?.approximate
      || object.isSkinnedMesh
      || object.isInstancedMesh
      || object.morphTargetInfluences?.length
    );
    const worldBounds = geometryRecord?.localAabb
      ? runtimeTransformGeometryBounds(geometryRecord, transform.worldTransform.matrix, {
          approximate: approximateBounds,
          source: "cached-local-geometry-transformed"
        })
      : null;
    const relativeMatrix = rootInverseWorld
      ? runtimeMultiplyMatrices(rootInverseWorld, transform.worldTransform.matrix)
      : null;
    const rootLocalBounds = geometryRecord?.localAabb && relativeMatrix
      ? runtimeTransformGeometryBounds(geometryRecord, relativeMatrix, {
          approximate: approximateBounds,
          source: "cached-local-geometry-in-model-root-frame"
        })
      : null;
    const legacy = {
      nodeId: runtimeObjectId(object, runtimeObjectPath(object, root)),
      nodeIndex: Number.isInteger(object.userData?.gltfNodeIndex) ? object.userData.gltfNodeIndex : null,
      nodePath: runtimeObjectPath(object, root),
      name: cleanText(object.name || "", 240),
      objectType: cleanText(object.type || "", 100),
      isMesh: Boolean(object.isMesh || (object.geometry && object.material)),
      selfVisible,
      ancestorVisible,
      effectiveVisible,
      materialVisible: material.materialVisible,
      materialOpacity: material.materialOpacity,
      materialCount: material.materialCount,
      layersMatch,
      renderEligible,
      catalogPartId: catalogPart.catalogPartId,
      geometryCatalogId: geometryRecord?.geometryCatalogId || "",
      geometryFingerprint: geometryRecord?.fingerprint || "",
      worldPosition: runtimeWorldPosition(object),
      worldTransformSignature: runtimeWorldTransformSignature(object)
    };
    return {
      legacy,
      spatialState: {
        catalogPartId: catalogPart.catalogPartId,
        nodeId: legacy.nodeId,
        loadedStatus: renderEligible ? "loaded-visible" : "loaded-hidden",
        hiddenLoaded: !renderEligible,
        selfVisible,
        ancestorVisible,
        effectiveVisible,
        materialVisible: material.materialVisible,
        materialOpacity: material.materialOpacity,
        layersMatch,
        localTransform: transform.localTransform,
        worldTransform: transform.worldTransform,
        rootRelativeMatrix: relativeMatrix,
        rootLocalBounds,
        worldBounds
      },
      rootLocalBounds,
      worldBounds
    };
  }

  function actionClip(action) {
    try {
      return typeof action?.getClip === "function" ? action.getClip() : action?._clip || null;
    } catch {
      return action?._clip || null;
    }
  }

  function actionTargetNames(clip) {
    const names = [];
    for (const track of Array.isArray(clip?.tracks) ? clip.tracks : []) {
      const trackName = String(track?.name || "");
      const cleaned = trackName
        .replace(/^\./, "")
        .replace(/\.(?:position|quaternion|rotation|scale|morphTargetInfluences|material\.[^.]+)$/i, "")
        .replace(/\.bones\[([^\]]+)\].*$/i, ".$1")
        .trim();
      if (cleaned) names.push(cleaned);
    }
    return Array.from(new Set(names)).slice(0, 40);
  }

  function actionLoopLabel(loop) {
    const value = Number(loop);
    if (value === 2200) return "once";
    if (value === 2201) return "repeat";
    if (value === 2202) return "pingpong";
    return Number.isFinite(value) ? String(value) : cleanText(loop || "", 60);
  }

  function sampleRuntimeAction(action, mixerRecord, index) {
    const clip = actionClip(action);
    const modelRecord = Array.from(runtime3dState.models.values()).find((model) => {
      const mixerRoot = mixerRecord.root || runtimeMixerRoot(mixerRecord.mixer);
      return mixerRoot && (isDescendantRuntimeObject(mixerRoot, model.root) || isDescendantRuntimeObject(model.root, mixerRoot));
    });
    const registeredClipIndex = Array.isArray(modelRecord?.animations) ? modelRecord.animations.indexOf(clip) : -1;
    let running = null;
    let scheduled = null;
    try {
      if (typeof action?.isRunning === "function") running = Boolean(action.isRunning());
      if (typeof action?.isScheduled === "function") scheduled = Boolean(action.isScheduled());
    } catch {
      // Retain nullable state when the runtime method cannot be queried safely.
    }
    let effectiveWeight = Number(action?.weight);
    let effectiveTimeScale = Number(action?.timeScale);
    try {
      if (typeof action?.getEffectiveWeight === "function") effectiveWeight = Number(action.getEffectiveWeight());
      if (typeof action?.getEffectiveTimeScale === "function") effectiveTimeScale = Number(action.getEffectiveTimeScale());
    } catch {
      // Fall back to public fields.
    }
    if (!Number.isFinite(effectiveWeight)) effectiveWeight = action?.enabled === false ? 0 : 1;
    const enabled = action?.enabled !== false;
    const paused = Boolean(action?.paused);
    const finished = Boolean(action?._ended || (action?.clampWhenFinished && running === false && Number(action?.time) >= Number(clip?.duration || Infinity)));
    const playing = Boolean(running ?? scheduled ?? enabled)
      && enabled
      && !paused
      && !finished
      && effectiveWeight > 0.0001;
    return {
      actionId: runtimeObjectId(action, `${mixerRecord.id}-action-${index}`),
      mixerId: mixerRecord.id,
      clipIndex: registeredClipIndex >= 0 ? registeredClipIndex : Number.isInteger(action?._clipIndex) ? action._clipIndex : index,
      clipIdentitySource: registeredClipIndex >= 0 ? "gltf-loader-clip-reference" : Number.isInteger(action?._clipIndex) ? "runtime-action-index" : "mixer-action-order",
      clipName: cleanText(clip?.name || "", 240),
      targetNodeNames: actionTargetNames(clip),
      time: finiteRuntimeNumber(action?.time),
      duration: finiteRuntimeNumber(clip?.duration),
      enabled,
      paused,
      running,
      scheduled,
      finished,
      playing,
      effectiveWeight: finiteRuntimeNumber(effectiveWeight),
      effectiveTimeScale: finiteRuntimeNumber(effectiveTimeScale),
      loop: actionLoopLabel(action?.loop),
      repetitions: Number.isFinite(Number(action?.repetitions)) ? Number(action.repetitions) : null,
      clampWhenFinished: Boolean(action?.clampWhenFinished)
    };
  }

  function runtimeMixerDriverObservation(record) {
    const samples = record.recentAdvances.slice(-MAX_RUNTIME_ADVANCE_SAMPLES);
    const updates = samples.filter((item) => item.method === "update");
    const seeks = samples.filter((item) => item.method === "setTime");
    const nearScroll = samples.filter((item) => item.nearScrollEvent);
    const stationary = samples.filter((item) => !item.nearScrollEvent);
    const smallDeltaUpdates = updates.filter((item) => Math.abs(Number(item.value)) <= 0.12 && Number(item.value) >= 0);
    let mode = "unknown";
    let mechanism = "unobserved";
    let confidence = 0.2;
    let reasoning = "No mixer advance calls were observed by the runtime hook.";

    if (seeks.length) {
      mechanism = "mixer-setTime";
      if (nearScroll.length >= Math.max(2, stationary.length)) {
        mode = "scroll-based";
        confidence = 0.84;
        reasoning = "AnimationMixer.setTime calls were observed predominantly during recent scroll activity.";
      } else {
        mode = "unknown";
        confidence = 0.48;
        reasoning = "AnimationMixer.setTime calls prove externally positioned playback, but the sampled calls do not isolate scroll versus another state input.";
      }
    } else if (updates.length) {
      mechanism = "mixer-update";
      const nearScrollRatio = nearScroll.length / Math.max(1, samples.length);
      const smallDeltaRatio = smallDeltaUpdates.length / Math.max(1, updates.length);
      if (updates.length >= 8 && smallDeltaRatio >= 0.8 && stationary.length >= 4 && nearScrollRatio < 0.75) {
        mode = "time-based";
        confidence = 0.72;
        reasoning = "Frequent small nonnegative mixer.update deltas continued outside the recent-scroll window, consistent with frame-time playback.";
      } else if (updates.length >= 4 && nearScrollRatio >= 0.75) {
        mode = "scroll-based";
        confidence = 0.64;
        reasoning = "Mixer updates were strongly clustered around scroll events; fetched-code analysis should confirm whether the delta itself comes from scroll progress.";
      } else {
        mode = "unknown";
        confidence = 0.4;
        reasoning = "Mixer.update calls were observed, but runtime timing alone cannot distinguish frame delta from a scroll-derived delta.";
      }
    }

    return {
      mode,
      mechanism,
      confidence,
      reasoning,
      sampleCount: samples.length,
      updateCallCount: record.updateCallCount,
      setTimeCallCount: record.setTimeCallCount,
      clipActionCallCount: record.clipActionCallCount,
      nearScrollSampleCount: nearScroll.length,
      stationarySampleCount: stationary.length,
      lastAdvance: record.lastAdvance,
      recentAdvances: record.recentAdvances.slice(-24)
    };
  }

  function sampleRuntimeMixer(record) {
    const mixer = record.mixer;
    const actions = Array.isArray(mixer?._actions) ? mixer._actions : [];
    const actionStates = actions
      .slice(0, MAX_RUNTIME_ACTIONS_PER_MODEL)
      .map((action, index) => sampleRuntimeAction(action, record, index));
    return {
      mixerId: record.id,
      rootObjectId: runtimeObjectId(record.root, "mixer-root"),
      time: finiteRuntimeNumber(mixer?.time),
      timeScale: finiteRuntimeNumber(mixer?.timeScale),
      actionCount: actions.length,
      actionTruncated: actions.length > MAX_RUNTIME_ACTIONS_PER_MODEL,
      driverObservation: runtimeMixerDriverObservation(record),
      actionStates,
      playingAnimations: actionStates.filter((action) => action.playing)
    };
  }

  function runtimeSceneForRoot(root) {
    for (const record of runtime3dState.scenes.values()) {
      if (isDescendantRuntimeObject(root, record.scene)) return record;
    }
    let current = root;
    while (current) {
      if (isRuntimeScene(current)) return registerRuntimeScene(current, null, "model-parent-chain");
      current = current.parent || null;
    }
    return null;
  }

  function activeRuntimeSceneRecords() {
    const records = Array.from(runtime3dState.scenes.values());
    const rendered = records.filter((record) => Number.isFinite(record.lastRenderedAt));
    if (!rendered.length) return new Set(records);
    const newest = Math.max(...rendered.map((record) => record.lastRenderedAt));
    return new Set(rendered.filter((record) => newest - record.lastRenderedAt <= 750));
  }

  function runtimeRendererCanvasVisibility(renderer) {
    const canvas = renderer?.domElement;
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") {
      return { canvasVisible: null, canvasVisibleRatio: null };
    }
    try {
      let domStyleVisible = canvas.hidden !== true;
      let current = canvas;
      while (domStyleVisible && current && current.nodeType !== 9) {
        const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(current) : null;
        if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.0001)) {
          domStyleVisible = false;
        }
        current = current.parentElement || null;
      }
      const ratio = intersectionRatio(canvas.getBoundingClientRect());
      return {
        canvasVisible: domStyleVisible && ratio > 0.01,
        canvasVisibleRatio: finiteRuntimeNumber(ratio, 4)
      };
    } catch {
      return { canvasVisible: null, canvasVisibleRatio: null };
    }
  }

  function runtimeRendererCanvasIdentity(renderer) {
    const canvas = renderer?.domElement;
    if (!canvas) return { canvasIndex: null, canvasSelector: "" };
    let canvasIndex = null;
    try {
      const canvases = Array.from(document.querySelectorAll?.("canvas") || []);
      const index = canvases.indexOf(canvas);
      if (index >= 0) canvasIndex = index;
    } catch {
      canvasIndex = null;
    }
    return {
      canvasIndex,
      canvasSelector: elementSummary(canvas, canvasIndex ?? 0).selector
    };
  }

  function runtimeContainerForModel(record, sceneRecord) {
    const rootParent = isRuntimeObject3D(record.root?.parent) ? record.root.parent : null;
    const object = record.explicitContainer || rootParent || sceneRecord?.scene || null;
    const hintedId = cleanText(record.containerIdHint || "", 180);
    const containerId = hintedId || runtimeObjectId(object, sceneRecord?.sceneObjectId || "unparented-runtime-container");
    const evidenceSource = record.explicitContainer || hintedId
      ? "explicit-bridge-container"
      : rootParent && !isRuntimeScene(rootParent)
        ? "direct-nonscene-parent"
        : rootParent
          ? "scene-root"
          : "unparented";
    const mapKey = hintedId ? `hint:${hintedId}` : object || `hint:${containerId}`;
    let containerRecord = runtime3dState.containerRecords.get(mapKey);
    if (!containerRecord) {
      runtime3dState.containerSerial += 1;
      containerRecord = {
        containerCatalogId: `runtime-container-${runtime3dState.containerSerial}`,
        containerId,
        object,
        objectId: runtimeObjectId(object, containerId),
        name: cleanText(object?.name || "", 180),
        objectType: cleanText(object?.type || "", 100),
        parentObjectId: runtimeObjectId(object?.parent, ""),
        sceneId: sceneRecord?.id || "",
        path: object && sceneRecord?.scene ? runtimeObjectPath(object, sceneRecord.scene) : "",
        evidenceSource,
        explicit: evidenceSource === "explicit-bridge-container",
        isScene: isRuntimeScene(object)
      };
      runtime3dState.containerRecords.set(mapKey, containerRecord);
      touchRuntime3DCatalog();
    }
    return containerRecord;
  }

  function runtimeModelRootPath(record, sceneRecord) {
    if (sceneRecord?.scene && isDescendantRuntimeObject(record.root, sceneRecord.scene)) {
      return runtimeObjectPath(record.root, sceneRecord.scene);
    }
    return runtimeObjectPath(record.root, record.root);
  }

  function directRuntimeAssetIdentity(record) {
    return Boolean(
      record?.assetUrl
      && Number(record.identityConfidence || 0) >= 0.9
      && (
        ["gltf-loader-hook", "object-user-data", "runtime-bridge"].includes(record.identitySource)
        || record.instanceBoundarySource === "runtime-bridge-explicit"
      )
    );
  }

  function discoverSceneModelRoots() {
    for (const sceneRecord of runtime3dState.scenes.values()) {
      const scene = sceneRecord.scene;
      const registeredRoots = Array.from(runtime3dState.models.keys()).filter((root) => isDescendantRuntimeObject(root, scene));
      for (const child of Array.isArray(scene.children) ? scene.children.slice(0, 120) : []) {
        if (!isRuntimeObject3D(child) || child.isCamera || child.isLight || child.type?.includes?.("Light")) continue;
        if (registeredRoots.some((root) => isDescendantRuntimeObject(root, child) || isDescendantRuntimeObject(child, root))) continue;
        let renderableCount = 0;
        boundedRuntimeTraverse(child, (object) => {
          if (isRuntimeRenderablePart(object)) renderableCount += 1;
        }, 280);
        if (renderableCount) registerRuntimeModel(child, { registrationSource: "scene-child-discovery" });
      }
    }
  }

  function sampleRuntimeModel(record, options = {}) {
    const root = record.root;
    const sceneRecord = runtimeSceneForRoot(root);
    const camera = sceneRecord?.camera || null;
    const parts = [];
    const spatialPartStates = [];
    let renderablePartCount = 0;
    let visiblePartCount = 0;
    const partLimit = Math.max(0, Math.min(MAX_RUNTIME_PARTS_PER_MODEL, Number.isFinite(options.partLimit) ? options.partLimit : MAX_RUNTIME_PARTS_PER_MODEL));
    const spatialPartLimit = Math.max(
      0,
      Math.min(
        MAX_RUNTIME_PARTS_PER_MODEL,
        Number.isFinite(options.spatialPartLimit) ? options.spatialPartLimit : MAX_RUNTIME_PARTS_PER_MODEL
      )
    );
    const rootTransform = runtimeTransformState(root);
    const rootInverseWorld = runtimeInvertMatrix(rootTransform.worldTransform.matrix);
    let rootLocalAabb = null;
    let worldAabb = null;
    const rootLocalSpheres = [];
    const worldSpheres = [];
    let boundsApproximate = false;
    boundedRuntimeTraverse(root, (object) => {
      if (!isRuntimeRenderablePart(object)) return;
      renderablePartCount += 1;
      const part = sampleRuntimePart(object, record, camera, rootInverseWorld);
      if (part.legacy.renderEligible) visiblePartCount += 1;
      if (part.legacy.renderEligible && parts.length < partLimit) parts.push(part.legacy);
      if (spatialPartStates.length < spatialPartLimit) spatialPartStates.push(part.spatialState);
      rootLocalAabb = runtimeMergeAabbs(rootLocalAabb, part.rootLocalBounds?.aabb);
      worldAabb = runtimeMergeAabbs(worldAabb, part.worldBounds?.aabb);
      if (part.rootLocalBounds?.boundingSphere) rootLocalSpheres.push(part.rootLocalBounds.boundingSphere);
      if (part.worldBounds?.boundingSphere) worldSpheres.push(part.worldBounds.boundingSphere);
      boundsApproximate = boundsApproximate
        || Boolean(part.rootLocalBounds?.approximate)
        || Boolean(part.worldBounds?.approximate);
    }, 1600);
    const rootLocalBounds = runtimeBoundsFromAabb(rootLocalAabb, {
      approximate: boundsApproximate,
      source: "aggregate-cached-part-geometry-in-model-root-frame"
    });
    const worldBounds = runtimeBoundsFromAabb(worldAabb, {
      approximate: boundsApproximate,
      source: "aggregate-cached-part-geometry-in-world-frame"
    });
    if (rootLocalBounds) {
      rootLocalBounds.boundingSphere = runtimeAggregateBoundingSphere(
        rootLocalBounds.center,
        rootLocalSpheres
      ) || rootLocalBounds.boundingSphere;
    }
    if (worldBounds) {
      worldBounds.boundingSphere = runtimeAggregateBoundingSphere(
        worldBounds.center,
        worldSpheres
      ) || worldBounds.boundingSphere;
    }
    if (!record.initialLocalBounds && rootLocalBounds) {
      record.initialLocalBounds = rootLocalBounds;
      touchRuntime3DCatalog();
    }

    const mixers = Array.from(runtime3dState.mixers.values())
      .filter((mixerRecord) => {
        const mixerRoot = mixerRecord.root || runtimeMixerRoot(mixerRecord.mixer);
        return mixerRoot && (mixerRoot === root || isDescendantRuntimeObject(mixerRoot, root));
      })
      .map(sampleRuntimeMixer);
    const selfVisible = root.visible !== false;
    const ancestorVisible = runtimeAncestorVisible(root, sceneRecord?.scene || null);
    const effectiveVisible = selfVisible && ancestorVisible;
    const playingAnimations = mixers.flatMap((mixer) => mixer.playingAnimations);
    const modes = Array.from(new Set(mixers.map((mixer) => mixer.driverObservation.mode).filter((mode) => mode && mode !== "unknown")));
    const canvasVisibility = runtimeRendererCanvasVisibility(sceneRecord?.renderer);
    const canvasIdentity = runtimeRendererCanvasIdentity(sceneRecord?.renderer);
    const sceneActive = !sceneRecord || options.activeScenes?.has(sceneRecord) !== false;
    const sceneObserved = Boolean(sceneRecord && Number.isFinite(sceneRecord.lastRenderedAt));
    const structuralRenderEligible = effectiveVisible && visiblePartCount > 0;
    const renderActive = structuralRenderEligible && sceneObserved && sceneActive;
    const visibleOnCanvas = renderActive
      && canvasVisibility.canvasVisible === true
      && sceneRecord?.lastRenderTargetKind === "screen";
    const renderContributionCandidate = renderActive
      && canvasVisibility.canvasVisible === true
      && sceneRecord?.lastRenderTargetKind === "render-target";
    const renderEligibility = visibleOnCanvas
      ? "screen-render-eligible"
      : renderContributionCandidate
        ? "offscreen-render-candidate"
        : renderActive
          ? "render-active-unresolved-target"
          : structuralRenderEligible
            ? "structural-only"
            : "hidden-or-nonrenderable";
    const container = runtimeContainerForModel(record, sceneRecord);
    const rootPath = runtimeModelRootPath(record, sceneRecord);
    const parentObjectId = runtimeObjectId(root.parent, sceneRecord?.sceneObjectId || "");
    if (!record.initialSpatialIdentity) {
      record.initialSpatialIdentity = {
        parentObjectId,
        containerId: container.containerId,
        containerCatalogId: container.containerCatalogId,
        rootPath
      };
      touchRuntime3DCatalog();
    }
    const explicitAnchorWorld = record.anchorObject
      ? runtimeWorldPosition(record.anchorObject)
      : null;
    const anchorWorld = explicitAnchorWorld || worldBounds?.center || runtimeWorldPosition(root);
    const anchorInRootFrame = anchorWorld && rootInverseWorld
      ? runtimeTransformPoint(rootInverseWorld, anchorWorld)
      : null;
    const loadedStatus = visibleOnCanvas
      ? "loaded-visible"
      : effectiveVisible
        ? "loaded-offscreen-or-unobserved"
        : "loaded-hidden";
    const hiddenLoaded = !effectiveVisible;
    return {
      runtimeModelId: record.id,
      catalogModelId: record.catalogModelId,
      instanceId: record.instanceId,
      rootObjectId: record.rootObjectId,
      rootName: record.rootName,
      parentObjectId,
      containerId: container.containerId,
      containerCatalogId: container.containerCatalogId,
      rootPath,
      instanceBoundarySource: record.instanceBoundarySource,
      instanceBoundaryConfidence: record.instanceBoundaryConfidence,
      instanceBoundaryExplicit: record.instanceBoundaryExplicit,
      assetUrl: record.assetUrl,
      identitySource: record.identitySource,
      identityConfidence: record.identityConfidence,
      registrationSource: record.registrationSource,
      sceneId: sceneRecord?.id || "",
      sceneName: sceneRecord?.name || "",
      sceneObserved,
      sceneActive,
      renderTargetKind: sceneRecord?.lastRenderTargetKind || "unknown",
      canvasVisible: canvasVisibility.canvasVisible,
      canvasVisibleRatio: canvasVisibility.canvasVisibleRatio,
      canvasIndex: canvasIdentity.canvasIndex,
      canvasSelector: canvasIdentity.canvasSelector,
      selfVisible,
      ancestorVisible,
      effectiveVisible,
      structuralRenderEligible,
      renderActive,
      visibleOnCanvas,
      renderContributionCandidate,
      renderEligibility,
      renderEligible: visibleOnCanvas,
      loadedStatus,
      hiddenLoaded,
      renderablePartCount,
      visiblePartCount,
      visiblePartTruncated: visiblePartCount > partLimit,
      visibleParts: parts,
      spatialState: {
        catalogModelId: record.catalogModelId,
        instanceId: record.instanceId,
        loadedStatus,
        hiddenLoaded,
        parentObjectId,
        containerId: container.containerId,
        containerCatalogId: container.containerCatalogId,
        rootPath,
        instanceBoundarySource: record.instanceBoundarySource,
        instanceBoundaryConfidence: record.instanceBoundaryConfidence,
        compositionId: record.compositionId,
        frameId: record.frameId,
        sourceId: record.sourceId,
        sourceConfigId: record.sourceConfigId,
        activeStateId: record.activeStateId,
        localTransform: rootTransform.localTransform,
        worldTransform: rootTransform.worldTransform,
        rootLocalBounds,
        worldBounds,
        anchorKind: record.anchorKind || (worldBounds ? "geometry-bounds-center" : "root-pivot"),
        anchorWorld,
        anchorInRootFrame,
        partStateCount: spatialPartStates.length,
        partStatesTruncated: renderablePartCount > spatialPartLimit,
        partStates: spatialPartStates
      },
      mixerCount: mixers.length,
      mixers,
      activeAnimationCount: playingAnimations.length,
      activeAnimations: playingAnimations,
      playbackMode: modes.length > 1 ? "mixed" : modes[0] || "unknown",
      provenance: "direct-runtime"
    };
  }

  function runtimeModelRecordForRelationshipEndpoint(root, instanceId) {
    if (root && runtime3dState.models.has(root)) return runtime3dState.models.get(root);
    const normalizedId = cleanText(instanceId || "", 180);
    if (!normalizedId) return null;
    return Array.from(runtime3dState.models.values()).find((record) => (
      record.instanceId === normalizedId
      || record.id === normalizedId
      || record.rootObjectId === normalizedId
    )) || null;
  }

  function runtimeExplicitRelationshipForPair(firstRecord, secondRecord) {
    for (const relationship of runtime3dState.explicitSpatialRelationships) {
      const subject = runtimeModelRecordForRelationshipEndpoint(
        relationship.subjectRoot,
        relationship.subjectInstanceId
      );
      const reference = runtimeModelRecordForRelationshipEndpoint(
        relationship.referenceRoot,
        relationship.referenceInstanceId
      );
      if (
        (subject === firstRecord && reference === secondRecord)
        || (subject === secondRecord && reference === firstRecord)
      ) {
        return { relationship, subject, reference };
      }
    }
    return null;
  }

  function runtimePairEvidence(firstRecord, secondRecord) {
    const evidenceBasis = [];
    const explicitRelationship = runtimeExplicitRelationshipForPair(firstRecord, secondRecord);
    if (explicitRelationship) evidenceBasis.push("explicit-bridge-relationship");
    if (firstRecord.compositionId && firstRecord.compositionId === secondRecord.compositionId) {
      evidenceBasis.push("shared-explicit-composition");
    }
    if (firstRecord.frameId && firstRecord.frameId === secondRecord.frameId) {
      evidenceBasis.push("shared-explicit-frame");
    }
    if (firstRecord.sourceId && firstRecord.sourceId === secondRecord.sourceId) {
      evidenceBasis.push("shared-explicit-source");
    }
    if (firstRecord.sourceConfigId && firstRecord.sourceConfigId === secondRecord.sourceConfigId) {
      evidenceBasis.push("shared-explicit-source-config");
    }
    const sharedExplicitContainer = (
      firstRecord.explicitContainer
      && firstRecord.explicitContainer === secondRecord.explicitContainer
    ) || (
      firstRecord.containerIdHint
      && firstRecord.containerIdHint === secondRecord.containerIdHint
    );
    if (sharedExplicitContainer) evidenceBasis.push("shared-explicit-container");
    const sharedRuntimeContainer = (
      firstRecord.root?.parent
      && firstRecord.root.parent === secondRecord.root?.parent
      && !isRuntimeScene(firstRecord.root.parent)
      && directRuntimeAssetIdentity(firstRecord)
      && directRuntimeAssetIdentity(secondRecord)
    );
    if (sharedRuntimeContainer) evidenceBasis.push("shared-runtime-container-with-direct-asset-identity");
    const qualifies = evidenceBasis.length > 0;
    if (
      qualifies
      && firstRecord.activeStateId
      && firstRecord.activeStateId === secondRecord.activeStateId
    ) {
      evidenceBasis.push("shared-explicit-active-state");
    }
    return { evidenceBasis, explicitRelationship, qualifies };
  }

  function runtimeVectorOffset(subject, reference) {
    if (!subject || !reference) return null;
    return subject.slice(0, 3).map((value, index) => finiteRuntimeNumber(value - reference[index], 8));
  }

  function runtimeNormalizedDirection(offset) {
    if (!offset) return null;
    const length = Math.hypot(...offset);
    if (length < 1e-12) return [0, 0, 0];
    return offset.map((value) => finiteRuntimeNumber(value / length, 8));
  }

  function runtimeRelationshipStability(key, values) {
    const normalizedValues = values.map((value) => Number(value));
    let history = runtime3dState.relationshipHistory.get(key);
    if (!history) {
      history = {
        sampleCount: 0,
        stableSampleCount: 0,
        maxObservedDelta: 0,
        previousValues: null
      };
      runtime3dState.relationshipHistory.set(key, history);
    }
    let delta = null;
    if (history.previousValues && history.previousValues.length === normalizedValues.length) {
      delta = normalizedValues.reduce((maximum, value, index) => (
        Math.max(maximum, Math.abs(value - history.previousValues[index]))
      ), 0);
      if (delta <= 0.0001) history.stableSampleCount += 1;
      history.maxObservedDelta = Math.max(history.maxObservedDelta, delta);
    }
    history.sampleCount += 1;
    history.previousValues = normalizedValues;
    const stableAcrossSamples = history.sampleCount >= 2
      && history.stableSampleCount === history.sampleCount - 1;
    return {
      sampleCount: history.sampleCount,
      stableSampleCount: history.stableSampleCount,
      status: history.sampleCount < 2 ? "unobserved" : stableAcrossSamples ? "stable" : "changed",
      stableAcrossSamples,
      lastDelta: delta == null ? null : finiteRuntimeNumber(delta, 8),
      maxObservedDelta: finiteRuntimeNumber(history.maxObservedDelta, 8)
    };
  }

  function runtimeSpatialRelationshipClue(subjectRecord, referenceRecord, subjectModel, referenceModel, pairEvidence) {
    const subjectState = subjectModel.spatialState;
    const referenceState = referenceModel.spatialState;
    const subjectWorldMatrix = subjectState?.worldTransform?.matrix;
    const referenceWorldMatrix = referenceState?.worldTransform?.matrix;
    const referenceInverseWorld = runtimeInvertMatrix(referenceWorldMatrix);
    if (!subjectWorldMatrix || !referenceWorldMatrix || !referenceInverseWorld) return null;
    const subjectAnchorWorld = subjectState.anchorWorld
      || subjectState.worldBounds?.center
      || subjectState.worldTransform?.trs?.position;
    const referenceAnchorWorld = referenceState.anchorWorld
      || referenceState.worldBounds?.center
      || referenceState.worldTransform?.trs?.position;
    if (!subjectAnchorWorld || !referenceAnchorWorld) return null;
    const subjectAnchorInReferenceFrame = runtimeTransformPoint(referenceInverseWorld, subjectAnchorWorld);
    const referenceAnchorInReferenceFrame = runtimeTransformPoint(referenceInverseWorld, referenceAnchorWorld);
    const referenceLocalOffset = runtimeVectorOffset(
      subjectAnchorInReferenceFrame,
      referenceAnchorInReferenceFrame
    );
    const radialDistance = referenceLocalOffset ? Math.hypot(...referenceLocalOffset) : null;
    const referenceRadius = referenceState.rootLocalBounds?.boundingSphere?.radius ?? null;
    const radialDistanceRatio = Number.isFinite(radialDistance) && Number(referenceRadius) > 1e-12
      ? radialDistance / Number(referenceRadius)
      : null;
    const signedSurfaceOffset = Number.isFinite(radialDistance) && Number.isFinite(Number(referenceRadius))
      ? radialDistance - Number(referenceRadius)
      : null;
    const relativeMatrix = runtimeMultiplyMatrices(referenceInverseWorld, subjectWorldMatrix);
    const relationship = pairEvidence.explicitRelationship?.relationship || null;
    const relationshipKey = [
      subjectRecord.instanceId,
      referenceRecord.instanceId,
      pairEvidence.evidenceBasis.join(","),
      relationship?.relationshipType || ""
    ].join("|");
    const stabilityValues = [
      ...(relativeMatrix || []),
      ...(referenceLocalOffset || []),
      Number.isFinite(radialDistanceRatio) ? radialDistanceRatio : 0
    ];
    const stability = runtimeRelationshipStability(relationshipKey, stabilityValues);
    const transformEvidence = subjectState.worldBounds && referenceState.worldBounds
      ? "numeric-runtime-matrix-and-geometry-bounds"
      : "numeric-runtime-matrix";
    return {
      clueId: `runtime-spatial-clue-${hashString(relationshipKey)}`,
      evidenceType: "runtime-spatial-placement-candidate",
      candidateOnly: true,
      semanticInference: "none",
      subjectInstanceId: subjectRecord.instanceId,
      subjectCatalogModelId: subjectRecord.catalogModelId,
      subjectAssetUrl: subjectRecord.assetUrl,
      subjectIdentitySource: subjectRecord.identitySource,
      referenceInstanceId: referenceRecord.instanceId,
      referenceCatalogModelId: referenceRecord.catalogModelId,
      referenceAssetUrl: referenceRecord.assetUrl,
      referenceIdentitySource: referenceRecord.identitySource,
      evidenceBasis: pairEvidence.evidenceBasis,
      transformEvidence,
      explicitRelationshipHintId: relationship?.relationshipHintId || "",
      explicitRelationshipType: relationship?.relationshipType || "",
      relativeMatrix,
      subjectAnchorWorld,
      referenceAnchorWorld,
      subjectAnchorInReferenceFrame,
      referenceAnchorInReferenceFrame,
      referenceLocalOffset,
      referenceLocalDirection: runtimeNormalizedDirection(referenceLocalOffset),
      radialDistance: Number.isFinite(radialDistance) ? finiteRuntimeNumber(radialDistance, 8) : null,
      referenceRadius: referenceRadius != null && Number.isFinite(Number(referenceRadius))
        ? finiteRuntimeNumber(referenceRadius, 8)
        : null,
      radialDistanceRatio: Number.isFinite(radialDistanceRatio) ? finiteRuntimeNumber(radialDistanceRatio, 8) : null,
      signedSurfaceOffset: Number.isFinite(signedSurfaceOffset) ? finiteRuntimeNumber(signedSurfaceOffset, 8) : null,
      stability,
      provenance: "direct-runtime-geometry-candidate"
    };
  }

  function collectRuntimeSpatialRelationshipClues(models) {
    const recordById = new Map(Array.from(runtime3dState.models.values()).map((record) => [record.id, record]));
    const candidates = [];
    for (let firstIndex = 0; firstIndex < models.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < models.length; secondIndex += 1) {
        const firstModel = models[firstIndex];
        const secondModel = models[secondIndex];
        const firstRecord = recordById.get(firstModel.runtimeModelId);
        const secondRecord = recordById.get(secondModel.runtimeModelId);
        if (!firstRecord || !secondRecord) continue;
        const pairEvidence = runtimePairEvidence(firstRecord, secondRecord);
        if (!pairEvidence.qualifies) continue;
        let subjectRecord = firstRecord;
        let referenceRecord = secondRecord;
        let subjectModel = firstModel;
        let referenceModel = secondModel;
        if (pairEvidence.explicitRelationship) {
          subjectRecord = pairEvidence.explicitRelationship.subject;
          referenceRecord = pairEvidence.explicitRelationship.reference;
          subjectModel = subjectRecord === firstRecord ? firstModel : secondModel;
          referenceModel = referenceRecord === firstRecord ? firstModel : secondModel;
        } else {
          const firstRadius = Number(firstModel.spatialState?.rootLocalBounds?.boundingSphere?.radius);
          const secondRadius = Number(secondModel.spatialState?.rootLocalBounds?.boundingSphere?.radius);
          const firstIsReference = (
            Number.isFinite(firstRadius)
            && (!Number.isFinite(secondRadius) || firstRadius > secondRadius)
          ) || (
            firstRadius === secondRadius
            && firstRecord.instanceId.localeCompare(secondRecord.instanceId) < 0
          );
          if (firstIsReference) {
            subjectRecord = secondRecord;
            referenceRecord = firstRecord;
            subjectModel = secondModel;
            referenceModel = firstModel;
          }
        }
        const clue = runtimeSpatialRelationshipClue(
          subjectRecord,
          referenceRecord,
          subjectModel,
          referenceModel,
          pairEvidence
        );
        if (!clue) continue;
        const basisScore = pairEvidence.evidenceBasis.reduce((score, basis) => score + ({
          "explicit-bridge-relationship": 100,
          "shared-explicit-composition": 80,
          "shared-explicit-source-config": 76,
          "shared-explicit-source": 72,
          "shared-explicit-frame": 68,
          "shared-explicit-container": 64,
          "shared-runtime-container-with-direct-asset-identity": 50,
          "shared-explicit-active-state": 4
        }[basis] || 0), 0);
        const subjectRadius = Number(subjectModel.spatialState?.rootLocalBounds?.boundingSphere?.radius);
        const referenceRadius = Number(referenceModel.spatialState?.rootLocalBounds?.boundingSphere?.radius);
        const scaleContrast = Number.isFinite(subjectRadius) && subjectRadius > 1e-12 && Number.isFinite(referenceRadius)
          ? Math.min(20, referenceRadius / subjectRadius)
          : 0;
        candidates.push({ clue, score: basisScore + scaleContrast });
      }
    }
    candidates.sort((left, right) => (
      right.score - left.score
      || left.clue.clueId.localeCompare(right.clue.clueId)
    ));
    return {
      clues: candidates.slice(0, MAX_RUNTIME_SPATIAL_RELATION_CLUES).map((item) => item.clue),
      candidateCount: candidates.length,
      truncated: candidates.length > MAX_RUNTIME_SPATIAL_RELATION_CLUES
    };
  }

  function runtime3dStaticCatalog() {
    const modelRecords = Array.from(runtime3dState.models.values());
    const models = modelRecords.map((record) => {
      const sceneRecord = runtimeSceneForRoot(record.root);
      const container = runtimeContainerForModel(record, sceneRecord);
      const rootPath = runtimeModelRootPath(record, sceneRecord);
      return {
        catalogModelId: record.catalogModelId,
        runtimeModelId: record.id,
        instanceId: record.instanceId,
        rootObjectId: record.rootObjectId,
        rootName: record.rootName,
        parentObjectId: runtimeObjectId(record.root?.parent, sceneRecord?.sceneObjectId || ""),
        containerId: container.containerId,
        containerCatalogId: container.containerCatalogId,
        rootPath,
        initialParentObjectId: record.initialSpatialIdentity?.parentObjectId || "",
        initialContainerId: record.initialSpatialIdentity?.containerId || "",
        initialRootPath: record.initialSpatialIdentity?.rootPath || "",
        instanceBoundarySource: record.instanceBoundarySource,
        instanceBoundaryConfidence: record.instanceBoundaryConfidence,
        instanceBoundaryExplicit: record.instanceBoundaryExplicit,
        assetUrl: record.assetUrl,
        identitySource: record.identitySource,
        identityConfidence: record.identityConfidence,
        registrationSource: record.registrationSource,
        compositionId: record.compositionId,
        compositionRole: record.compositionRole,
        frameId: record.frameId,
        frameRootObjectId: runtimeObjectId(record.frameRoot, ""),
        sourceId: record.sourceId,
        sourceConfigId: record.sourceConfigId,
        sourceConfig: record.sourceConfig,
        activeStateId: record.activeStateId,
        anchorObjectId: runtimeObjectId(record.anchorObject, ""),
        anchorKind: record.anchorKind,
        initialLocalAabb: record.initialLocalBounds?.aabb || null,
        initialLocalCenter: record.initialLocalBounds?.center || null,
        initialLocalBoundingSphere: record.initialLocalBounds?.boundingSphere || null,
        partCatalogIds: Array.from(record.partCatalogByObject.values()).map((part) => part.catalogPartId)
      };
    });
    const sourceMap = new Map();
    for (const model of models) {
      const key = [
        model.sourceId,
        model.sourceConfigId,
        model.assetUrl,
        model.identitySource
      ].join("|");
      let source = sourceMap.get(key);
      if (!source) {
        source = {
          sourceCatalogId: `runtime-source-${hashString(key)}`,
          sourceId: model.sourceId,
          sourceConfigId: model.sourceConfigId,
          assetUrl: model.assetUrl,
          identitySource: model.identitySource,
          identityConfidence: model.identityConfidence,
          sourceConfig: model.sourceConfig,
          instanceIds: []
        };
        sourceMap.set(key, source);
      }
      source.instanceIds.push(model.instanceId);
    }
    const compositions = new Map();
    for (const record of runtime3dState.compositionRecords.values()) {
      compositions.set(record.compositionId, {
        compositionId: record.compositionId,
        containerId: record.containerIdHint || runtimeObjectId(record.container, ""),
        containerObjectId: runtimeObjectId(record.container, ""),
        frameId: record.frameId,
        frameRootObjectId: runtimeObjectId(record.frameRoot, ""),
        sourceId: record.sourceId,
        sourceConfigId: record.sourceConfigId,
        activeStateId: record.activeStateId || "",
        memberInstanceIds: [...record.memberInstanceIds],
        source: record.source
      });
    }
    for (const model of models) {
      if (!model.compositionId) continue;
      let composition = compositions.get(model.compositionId);
      if (!composition) {
        composition = {
          compositionId: model.compositionId,
          containerId: model.containerId,
          containerObjectId: "",
          frameId: model.frameId,
          frameRootObjectId: model.frameRootObjectId,
          sourceId: model.sourceId,
          sourceConfigId: model.sourceConfigId,
          activeStateId: model.activeStateId,
          memberInstanceIds: [],
          source: "runtime-bridge-model-hint"
        };
        compositions.set(model.compositionId, composition);
      }
      if (!composition.memberInstanceIds.includes(model.instanceId)) {
        composition.memberInstanceIds.push(model.instanceId);
      }
    }
    const frames = Array.from(runtime3dState.frameRecords.values()).map((record) => ({
      frameId: record.frameId,
      rootObjectId: runtimeObjectId(record.root, ""),
      compositionId: record.compositionId,
      sourceId: record.sourceId,
      sourceConfigId: record.sourceConfigId,
      source: record.source
    }));
    const explicitRelationships = runtime3dState.explicitSpatialRelationships.map((relationship) => {
      const subject = runtimeModelRecordForRelationshipEndpoint(
        relationship.subjectRoot,
        relationship.subjectInstanceId
      );
      const reference = runtimeModelRecordForRelationshipEndpoint(
        relationship.referenceRoot,
        relationship.referenceInstanceId
      );
      return {
        relationshipHintId: relationship.relationshipHintId,
        subjectInstanceId: subject?.instanceId || relationship.subjectInstanceId,
        referenceInstanceId: reference?.instanceId || relationship.referenceInstanceId,
        relationshipType: relationship.relationshipType,
        compositionId: relationship.compositionId,
        frameId: relationship.frameId,
        sourceId: relationship.sourceId,
        confidence: relationship.confidence,
        source: relationship.source
      };
    });
    return {
      schemaVersion: "storyvr-runtime-3d-catalog/v1",
      revision: runtime3dState.catalogRevision,
      models,
      parts: Array.from(runtime3dState.partCatalogRecords.values()).map((record) => ({ ...record })),
      geometries: Array.from(runtime3dState.geometryRecords.values()).map((record) => ({ ...record })),
      containers: Array.from(runtime3dState.containerRecords.values()).map((record) => ({
        containerCatalogId: record.containerCatalogId,
        containerId: record.containerId,
        objectId: record.objectId,
        name: record.name,
        objectType: record.objectType,
        parentObjectId: record.parentObjectId,
        sceneId: record.sceneId,
        path: record.path,
        evidenceSource: record.evidenceSource,
        explicit: record.explicit,
        isScene: record.isScene
      })),
      compositions: Array.from(compositions.values()),
      frames,
      sources: Array.from(sourceMap.values()),
      explicitRelationships
    };
  }

  function sampleRuntimeCamera(camera, sceneRecord) {
    if (!camera || !isRuntimeObject3D(camera)) return null;
    const canvasVisibility = runtimeRendererCanvasVisibility(sceneRecord?.renderer);
    return {
      cameraId: runtimeObjectId(camera, "camera"),
      sceneId: sceneRecord?.id || "",
      name: cleanText(camera.name || "", 180),
      type: cleanText(camera.type || "", 100),
      position: [camera.position?.x, camera.position?.y, camera.position?.z].map((value) => finiteRuntimeNumber(value)),
      quaternion: [camera.quaternion?.x, camera.quaternion?.y, camera.quaternion?.z, camera.quaternion?.w].map((value) => finiteRuntimeNumber(value)),
      fov: finiteRuntimeNumber(camera.fov),
      near: finiteRuntimeNumber(camera.near),
      far: finiteRuntimeNumber(camera.far),
      zoom: finiteRuntimeNumber(camera.zoom),
      renderTargetKind: sceneRecord?.lastRenderTargetKind || "unknown",
      canvasVisible: canvasVisibility.canvasVisible,
      onCanvasEligible: sceneRecord?.lastRenderTargetKind === "screen" && canvasVisibility.canvasVisible === true,
      provenance: "direct-runtime"
    };
  }

  function runtime3dMetadata() {
    const capabilities = { ...runtime3dState.capabilities };
    let captureStatus = "unavailable";
    let reason = "No reachable Three.js renderer, scene, model, or mixer has been observed.";
    if (runtime3dState.scenes.size && runtime3dState.renderCount > 0) {
      captureStatus = runtime3dState.models.size ? "ok" : "partial";
      reason = runtime3dState.models.size
        ? "Rendered Three.js scenes and model roots are directly observable."
        : "Rendered Three.js scenes are observable, but model roots have not been identified.";
    } else if (runtime3dState.scenes.size || runtime3dState.models.size || runtime3dState.mixers.size) {
      captureStatus = "partial";
      reason = "Some Three.js objects are reachable, but rendered scene/model coverage is incomplete.";
    }
    return {
      schemaVersion: "storyvr-runtime-3d-observation/v2",
      backwardCompatibleWith: ["storyvr-runtime-3d-observation/v1"],
      catalogSchemaVersion: "storyvr-runtime-3d-catalog/v1",
      catalogRevision: runtime3dState.catalogRevision,
      captureStatus,
      reason,
      installedAt: runtime3dState.installedAt,
      lastDiscoveryAt: runtime3dState.lastDiscoveryAt,
      capabilities,
      counts: {
        renderers: runtime3dState.renderers.size,
        scenes: runtime3dState.scenes.size,
        models: runtime3dState.models.size,
        mixers: runtime3dState.mixers.size,
        renderedFrames: runtime3dState.renderCount,
        hookedModelLoads: runtime3dState.modelLoadCount,
        discoveredObjects: runtime3dState.discoveredObjectCount,
        runtimeBridges: runtime3dState.bridgeRegistrationCount,
        runtimeBridgeRequests: runtime3dState.bridgeRequestCount,
        domRuntimeHandles: runtime3dState.domRuntimeHandleCount,
        catalogModels: runtime3dState.models.size,
        catalogParts: runtime3dState.partCatalogRecords.size,
        catalogGeometries: runtime3dState.geometryRecords.size,
        explicitSpatialRelationships: runtime3dState.explicitSpatialRelationships.length
      },
      limitations: Array.from(runtime3dState.limitations)
    };
  }

  function collectRuntime3DObservation() {
    discoverReachableRuntimeObjects();
    discoverSceneModelRoots();
    const metadata = runtime3dMetadata();
    let remainingPartBudget = MAX_RUNTIME_PARTS_PER_SNAPSHOT;
    let remainingSpatialPartBudget = MAX_RUNTIME_SPATIAL_PARTS_PER_SNAPSHOT;
    let remainingActionBudget = MAX_RUNTIME_ACTIONS_PER_SNAPSHOT;
    const activeScenes = activeRuntimeSceneRecords();
    const models = Array.from(runtime3dState.models.values())
      .slice(0, MAX_RUNTIME_MODELS)
      .map((record) => {
        const model = sampleRuntimeModel(record, {
          partLimit: remainingPartBudget,
          spatialPartLimit: remainingSpatialPartBudget,
          activeScenes
        });
        remainingPartBudget = Math.max(0, remainingPartBudget - model.visibleParts.length);
        remainingSpatialPartBudget = Math.max(
          0,
          remainingSpatialPartBudget - model.spatialState.partStates.length
        );
        for (const mixer of model.mixers) {
          const originalActions = mixer.actionStates;
          mixer.actionStates = originalActions.slice(0, remainingActionBudget);
          if (mixer.actionStates.length < originalActions.length) mixer.actionTruncated = true;
          remainingActionBudget = Math.max(0, remainingActionBudget - mixer.actionStates.length);
          mixer.playingAnimations = mixer.actionStates.filter((action) => action.playing);
        }
        model.activeAnimations = model.mixers.flatMap((mixer) => mixer.playingAnimations);
        model.activeAnimationCount = model.activeAnimations.length;
        return model;
      });
    const relationshipClues = collectRuntimeSpatialRelationshipClues(models);
    const cameras = Array.from(activeScenes)
      .map((sceneRecord) => sampleRuntimeCamera(sceneRecord.camera, sceneRecord))
      .filter(Boolean);
    const assignedMixerIds = new Set(models.flatMap((model) => model.mixers.map((mixer) => mixer.mixerId)));
    const unassignedMixers = Array.from(runtime3dState.mixers.values())
      .filter((record) => !assignedMixerIds.has(record.id))
      .slice(0, 24)
      .map(sampleRuntimeMixer);
    const modelResources = runtimeModelResourceUrls();
    const directlyIdentifiedAssetUrls = new Set(models
      .filter((model) => ["gltf-loader-hook", "object-user-data"].includes(model.identitySource) && model.assetUrl)
      .map((model) => model.assetUrl));
    const identifiedAssetUrls = new Set(models.filter((model) => model.assetUrl).map((model) => model.assetUrl));
    const assetCoverageComplete = modelResources.length > 0
      && modelResources.every((url) => directlyIdentifiedAssetUrls.has(url));
    const observation = {
      ...metadata,
      catalogRevision: runtime3dState.catalogRevision,
      catalogModelRefs: models.map((model) => model.catalogModelId),
      counts: {
        ...metadata.counts,
        catalogModels: runtime3dState.models.size,
        catalogParts: runtime3dState.partCatalogRecords.size,
        catalogGeometries: runtime3dState.geometryRecords.size,
        explicitSpatialRelationships: runtime3dState.explicitSpatialRelationships.length
      },
      source: "three-runtime-instrumentation",
      capturedAtElapsedMs: Math.round(performance.now()),
      renderedFrameAgeMs: runtime3dState.scenes.size
        ? Math.max(0, Math.round(performance.now() - Math.max(...Array.from(runtime3dState.scenes.values()).map((scene) => scene.lastRenderedAt || 0))))
        : null,
      modelCount: models.length,
      visibleModelCount: models.filter((model) => model.renderEligible).length,
      visiblePartCount: models.reduce((count, model) => count + model.visibleParts.length, 0),
      spatialPartStateCount: models.reduce((count, model) => count + model.spatialState.partStates.length, 0),
      actionStateCount: models.reduce((count, model) => count + model.mixers.reduce((mixerCount, mixer) => mixerCount + mixer.actionStates.length, 0), 0),
      modelResourceCount: modelResources.length,
      identifiedAssetCount: identifiedAssetUrls.size,
      directlyIdentifiedAssetCount: directlyIdentifiedAssetUrls.size,
      assetCoverageComplete,
      visiblePartsTruncated: remainingPartBudget === 0 && models.some((model) => model.visiblePartTruncated),
      spatialPartStatesTruncated: remainingSpatialPartBudget === 0
        && models.some((model) => model.spatialState.partStatesTruncated),
      actionStatesTruncated: remainingActionBudget === 0 && models.some((model) => model.mixers.some((mixer) => mixer.actionTruncated)),
      models,
      spatialRelationshipClueCount: relationshipClues.clues.length,
      spatialRelationshipCandidateCount: relationshipClues.candidateCount,
      spatialRelationshipCluesTruncated: relationshipClues.truncated,
      spatialRelationshipClues: relationshipClues.clues,
      unassignedMixers,
      activeCameras: cameras
    };
    observation.signature = runtime3dSnapshotKey(observation);
    return observation;
  }

  function runtime3dSnapshotKey(observation) {
    if (!observation || observation.captureStatus === "unavailable") return observation?.captureStatus || "unavailable";
    const models = (observation.models || []).map((model) => {
      const parts = (model.visibleParts || []).map((part) => `${part.nodeId}:${part.renderEligible ? 1 : 0}:${part.materialOpacity}:${part.worldTransformSignature || ""}`).join(",");
      const spatialParts = (model.spatialState?.partStates || []).map((part) => (
        `${part.catalogPartId}:${part.loadedStatus}:${part.worldTransform?.matrix?.join(",") || ""}:${part.worldBounds?.center?.join(",") || ""}`
      )).join(",");
      const actions = (model.activeAnimations || []).map((action) => `${action.mixerId}:${action.actionId}:${action.clipIndex}:${action.time}:${action.playing ? 1 : 0}`).join(",");
      const rootSpatial = `${model.spatialState?.loadedStatus || ""}:${model.spatialState?.worldTransform?.matrix?.join(",") || ""}:${model.spatialState?.worldBounds?.center?.join(",") || ""}`;
      return `${model.runtimeModelId}:${model.assetUrl}:${model.renderEligible ? 1 : 0}:${parts}:${spatialParts}:${rootSpatial}:${actions}:${model.playbackMode}`;
    }).join("|");
    const relations = (observation.spatialRelationshipClues || []).map((clue) => (
      `${clue.clueId}:${clue.relativeMatrix?.join(",") || ""}:${clue.referenceLocalOffset?.join(",") || ""}:${clue.stability?.status || ""}`
    )).join("|");
    return hashString(`${observation.captureStatus}:${models}:${relations}:${(observation.activeCameras || []).map((camera) => `${camera.cameraId}:${camera.position?.join(",")}:${camera.quaternion?.join(",")}`).join("|")}`);
  }

  function currentCandidateUrls() {
    seedPerformanceEntries();
    return Array.from(resourceMap.values())
      .filter((entry) => entry.candidate)
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  }

  function collectSnapshot(label = "snapshot", options = {}) {
    const candidateResources = currentCandidateUrls();
    const modelUrls = candidateResources.filter((entry) => entry.assetType === "model").map((entry) => entry.url);
    const scriptUrls = candidateResources.filter((entry) => entry.assetType === "script").map((entry) => entry.url);
    const dataUrls = candidateResources.filter((entry) => entry.assetType === "data").map((entry) => entry.url);
    const runtime3D = collectRuntime3DObservation();

    const snapshot = {
      id: `snapshot-${snapshots.length + 1}`,
      label,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round(performance.now()),
      scrollY: Math.round(window.scrollY || 0),
      scrollPercent: scrollProgressPercent(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      },
      documentHeight: documentHeight(),
      activeTexts: collectActiveTexts(),
      modelUrls: Array.from(new Set(modelUrls)),
      scriptUrls: Array.from(new Set(scriptUrls)).slice(0, 80),
      dataUrls: Array.from(new Set(dataUrls)).slice(0, 80),
      visibleCanvases: collectVisibleCanvases(),
      runtime3D
    };

    if (options.scrollTarget) {
      snapshot.scrollTarget = {
        index: Number(options.scrollTarget.index || 0),
        y: Math.round(Number(options.scrollTarget.y ?? snapshot.scrollY) || 0),
        kind: options.scrollTarget.kind || "grid",
        phase: cleanText(options.scrollTarget.phase),
        direction: cleanText(options.scrollTarget.direction)
      };
      const screenshot = captureScrollTargetScreenshot(snapshot.scrollTarget, snapshot, {
        viewportImage: options.viewportImage,
        allowCanvasFallback: Boolean(options.allowCanvasFallback)
      });
      snapshot.scrollTargetScreenshotId = screenshot?.id || "";
    }

    const key = `${snapshot.scrollY}:${snapshot.activeTexts.map((item) => item.text).join("|")}:${snapshot.modelUrls.join("|")}:${snapshot.visibleCanvases.map((item) => item.visualHash || item.visualHashStatus).join("|")}:${runtime3dSnapshotKey(snapshot.runtime3D)}`;
    if ((options.force || !snapshotKeys.has(key)) && snapshots.length < snapshotLimit) {
      snapshotKeys.add(key);
      snapshots.push(snapshot);
      const activeKey = activeBeatObservationKey(snapshot.activeTexts[0]);
      if (activeKey) lastObservedBeatKey = activeKey;
    } else if (snapshots.length >= snapshotLimit) {
      captureCoverage.reachedSnapshotLimit = true;
    }
    return snapshot;
  }

  function progressSummary() {
    seedPerformanceEntries();
    const resources = Array.from(resourceMap.values());
    return {
      resources: resources.length,
      candidates: resources.filter((entry) => entry.candidate).length,
      models: resources.filter((entry) => entry.assetType === "model").length,
      snapshots: snapshots.length
    };
  }

  function storyTextKey(value) {
    return cleanText(value).toLowerCase();
  }

  function storyDomOrder(snapshot, fallbackIndex) {
    const percent = Number(snapshot?.scrollPercent);
    if (Number.isFinite(percent)) return Math.round(percent * 1000);
    return 1_000_000 + fallbackIndex;
  }

  function imageGroupTextKeys(imageGroups) {
    const keys = new Set();
    for (const group of Array.isArray(imageGroups) ? imageGroups : []) {
      const captionKey = storyTextKey(group?.caption?.text || "");
      if (captionKey) keys.add(captionKey);
      for (const credit of Array.isArray(group?.credits) ? group.credits : []) {
        const creditKey = storyTextKey(credit?.text || "");
        if (creditKey) keys.add(creditKey);
      }
    }
    return keys;
  }

  function collectStoryVrTextUnits(imageGroups = []) {
    const seen = new Set();
    const excludedTextKeys = imageGroupTextKeys(imageGroups);
    const units = [];
    snapshots.forEach((snapshot, snapshotIndex) => {
      const activeTexts = Array.isArray(snapshot.activeTexts) ? snapshot.activeTexts : [];
      activeTexts.forEach((activeText, textIndex) => {
        const text = cleanText(activeText.text);
        const key = storyTextKey(text);
        if (!key || seen.has(key)) return;
        if (excludedTextKeys.has(key)) return;
        seen.add(key);
        units.push({
          id: `runtime-text-${units.length + 1}`,
          kind: "runtime-active-text",
          source: snapshot.id || `snapshot-${snapshotIndex + 1}`,
          text,
          scrollPercent: Number.isFinite(Number(snapshot.scrollPercent)) ? Number(snapshot.scrollPercent) : null,
          domOrder: Number.isFinite(Number(activeText.domOrder))
            ? Number(activeText.domOrder)
            : storyDomOrder(snapshot, snapshotIndex * 10 + textIndex),
          tag: activeText.tag || "",
          className: activeText.className || "",
          elementId: activeText.id || "",
          selector: activeText.selector || "",
          ancestorSelectors: Array.isArray(activeText.ancestorSelectors) ? activeText.ancestorSelectors : [],
          dataStep: activeText.dataStep || "",
          dataSlide: activeText.dataSlide || "",
          dataScene: activeText.dataScene || "",
          visibleRatio: activeText.visibleRatio ?? null
        });
      });
    });
    return units.sort((a, b) => a.domOrder - b.domOrder);
  }

  function variantControlText(element) {
    return cleanText([
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("title"),
      element?.textContent
    ].filter(Boolean).join(" "));
  }

  function variantControlDirectionText(element) {
    let descendantLabel = "";
    try {
      const labelled = element?.querySelector?.("[aria-label],[title]");
      descendantLabel = cleanText(labelled?.getAttribute?.("aria-label") || labelled?.getAttribute?.("title"));
    } catch {
      descendantLabel = "";
    }
    return cleanText([
      variantControlText(element),
      element?.id,
      elementClassName(element),
      element?.getAttribute?.("data-direction"),
      element?.getAttribute?.("data-action"),
      element?.getAttribute?.("data-testid"),
      element?.getAttribute?.("name"),
      element?.getAttribute?.("value"),
      descendantLabel
    ].filter(Boolean).join(" "));
  }

  function variantLabelWithoutState(value) {
    return cleanText(String(value || "")
      .replace(/(?:[,;:]\s*)?\bnot\s+(?:selected|checked|pressed|active|current)\b/gi, " ")
      .replace(/(?:[,;:]\s*)?\b(?:selected|checked|pressed|active|current)\b/gi, " ")
      .replace(/\s*[,;:]\s*$/g, " "));
  }

  function variantButtonOptionLabel(element) {
    const visibleText = variantLabelWithoutState(element?.textContent);
    if (visibleText && visibleText.length <= 90) return visibleText;
    for (const value of [element?.getAttribute?.("aria-label"), element?.getAttribute?.("title")]) {
      const label = variantLabelWithoutState(value);
      if (label && label.length <= 90) return label;
    }
    return variantLabelFromId(element?.id || element?.getAttribute?.("data-option") || element?.getAttribute?.("data-value"));
  }

  function variantClassTokens(element) {
    return elementClassName(element)
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function variantDirectionForControl(element) {
    const text = variantControlDirectionText(element).toLowerCase();
    if (/\b(previous|prev|back|left)\b|^[\s\u2190\u2039\u00ab]+$/.test(text)) return "previous";
    if (/\b(next|forward|right)\b|^[\s\u2192\u203a\u00bb]+$/.test(text)) return "next";
    return "";
  }

  function variantElementVisible(element) {
    if (!element) return false;
    if (element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    const classTokens = variantClassTokens(element);
    if (classTokens.some((token) => ["hidden", "is-hidden", "not-visible"].includes(token))) return false;
    if (classTokens.some((token) => ["active", "is-active", "selected", "is-selected", "checked", "is-checked", "show", "visible", "current", "is-current"].includes(token))) return true;
    try {
      const style = window.getComputedStyle?.(element);
      if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) return false;
    } catch {
      // Layout state remains best-effort when a page blocks computed-style access.
    }
    try {
      const rect = element.getBoundingClientRect?.();
      if (rect && (Number(rect.width) > 1 || Number(rect.height) > 1)) return true;
    } catch {
      // Fall through to semantic state.
    }
    return element.getAttribute?.("aria-selected") === "true" || element.getAttribute?.("aria-checked") === "true";
  }

  function variantLabelFromId(value) {
    return cleanText(String(value || "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(info|visual|slide|card|panel|item|option|content|wrapper|container)\b/gi, " ")
      .replace(/\s+/g, " "));
  }

  function variantOptionLabel(element, index = 0) {
    const named = element?.querySelector?.([
      "[data-option-label]",
      "[data-label]",
      "[class*='name']",
      "[class*='title']",
      "h1", "h2", "h3", "h4", "h5", "legend"
    ].join(","));
    const namedText = cleanText(named?.getAttribute?.("data-option-label") || named?.getAttribute?.("data-label") || named?.textContent);
    if (namedText && namedText.length <= 160) return namedText;
    const aria = cleanText(element?.getAttribute?.("aria-label"));
    if (aria && aria.length <= 160) {
      return aria
        .replace(/^an?\s+(?:3d\s+)?(?:illustration|image|model|view)\s+of\s+/i, "")
        .replace(/[.\s]+$/, "");
    }
    const idLabel = variantLabelFromId(element?.id || element?.getAttribute?.("data-option") || element?.getAttribute?.("data-slide"));
    if (idLabel) return idLabel;
    const text = cleanText(element?.textContent);
    if (text && text.length <= 160) return text;
    return `Option ${index + 1}`;
  }

  function variantOptionKey(value) {
    return variantLabelWithoutState(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function variantSemanticClassTokens(element) {
    const stateTokens = new Set([
      "active", "inactive", "selected", "unselected", "checked", "unchecked",
      "current", "hidden", "visible", "open", "closed", "disabled", "enabled",
      "is-active", "is-selected", "is-checked", "is-current", "not-active",
      "not-selected", "not-checked", "not-current"
    ]);
    return variantClassTokens(element).filter((token) => !stateTokens.has(token)).slice(0, 6);
  }

  function variantSemanticElementIdentity(element) {
    if (!element?.tagName) return "";
    const tag = String(element.tagName).toLowerCase();
    const id = cleanText(element.id);
    const role = cleanText(element.getAttribute?.("role"));
    const dataIdentity = ["data-variant-group", "data-scene", "data-slide", "data-step", "data-option"]
      .map((name) => cleanText(element.getAttribute?.(name)))
      .filter(Boolean);
    const classes = id ? [] : variantSemanticClassTokens(element);
    return [tag, id ? `#${id}` : "", role ? `role=${role}` : "", ...dataIdentity.map((value) => `data=${value}`), ...classes.map((value) => `.${value}`)]
      .filter(Boolean)
      .join("");
  }

  function variantRootLineageSignature(root, controlRoot = root) {
    const lineage = [];
    let current = controlRoot || root;
    let reachedRoot = false;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      const identity = variantSemanticElementIdentity(current);
      if (identity) lineage.push(identity);
      if (current === root) {
        reachedRoot = true;
        break;
      }
    }
    if (!reachedRoot && root) {
      const rootIdentity = variantSemanticElementIdentity(root);
      if (rootIdentity) lineage.push(rootIdentity);
    }
    return lineage.join(">");
  }

  function variantStructuralPositionIdentity(element, boundary = null) {
    if (!element) return "";
    const parent = element.parentElement;
    if (parent) {
      try {
        const siblings = Array.from(parent.children || []);
        const index = siblings.indexOf(element);
        if (index >= 0) return `sibling-${index + 1}`;
      } catch {
        // Use the relative layout position when child enumeration is unavailable.
      }
    }
    try {
      const rect = element.getBoundingClientRect?.();
      const boundaryRect = boundary?.getBoundingClientRect?.();
      if (!rect) return "";
      const relativeTop = Number(rect.top || 0) - Number(boundaryRect?.top || 0);
      const relativeLeft = Number(rect.left || 0) - Number(boundaryRect?.left || 0);
      return `position-${Math.round(relativeTop / 12)}-${Math.round(relativeLeft / 12)}`;
    } catch {
      return "";
    }
  }

  function stableVariantGroupIdentity({ root, controlRoot = root, kind }) {
    const explicitId = cleanText(
      controlRoot?.getAttribute?.("data-variant-group")
      || root?.getAttribute?.("data-variant-group")
      || controlRoot?.id
    );
    const lineage = variantRootLineageSignature(root, controlRoot);
    const boundary = variantStoryBoundary(controlRoot || root);
    const boundaryIdentity = variantSemanticElementIdentity(boundary);
    const controlIdentity = variantSemanticElementIdentity(controlRoot);
    const rootIdentity = variantSemanticElementIdentity(root);
    const controlPositionIdentity = explicitId ? "" : variantStructuralPositionIdentity(controlRoot, boundary);
    const rootPositionIdentity = explicitId ? "" : variantStructuralPositionIdentity(root, boundary);
    const directionLabels = kind === "previous-next"
      ? Array.from(controlRoot?.querySelectorAll?.("button,[role='button']") || [])
        .map((control) => `${variantDirectionForControl(control)}:${variantControlText(control)}`)
        .filter(Boolean)
        .sort()
        .join("|")
      : "";
    // Option labels are deliberately excluded. A parent selection may replace a
    // child's complete option set, but the child must retain one canonical ID.
    const signature = [
      kind || "single-select",
      controlIdentity,
      rootIdentity,
      boundaryIdentity,
      lineage,
      controlPositionIdentity,
      rootPositionIdentity,
      directionLabels
    ].join("|");
    return {
      id: explicitId || `variant-group-${hashString(signature)}`,
      signature,
      lineage
    };
  }

  function variantLabelsMatch(left, right) {
    const a = variantOptionKey(left);
    const b = variantOptionKey(right);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const ignored = new Set(["not", "selected", "checked", "pressed", "active", "current", "option", "button"]);
    const aTokens = new Set(a.split(" ").filter((token) => token.length > 2 && !ignored.has(token)));
    const bTokens = new Set(b.split(" ").filter((token) => token.length > 2 && !ignored.has(token)));
    const overlap = [...aTokens].filter((token) => bTokens.has(token));
    return overlap.length >= Math.min(2, aTokens.size, bTokens.size);
  }

  function variantAssetUrlsForElement(element) {
    const urls = [];
    for (const node of [element, ...Array.from(element?.querySelectorAll?.("*") || [])].filter(Boolean)) {
      for (const name of ["src", "href", "data-src", "data-model", "data-model-url", "data-asset", "data-asset-url"]) {
        const raw = node.getAttribute?.(name);
        const url = normalizeUrl(raw || "");
        if (url && MODEL_EXTENSIONS.includes(urlExtension(url))) urls.push(url);
      }
    }
    return Array.from(new Set(urls));
  }

  function variantOptionCandidates(root) {
    const selectors = [
      "[role='tabpanel']",
      "[role='tab']",
      "[role='radio']",
      "[role='option']",
      "[data-option]",
      "[data-slide]",
      "ol > li",
      "ul > li",
      "[aria-label*='illustration' i]",
      "[aria-label*='3d' i]",
      "[class*='card']",
      "[class*='slide']",
      "figure[id][role='group']",
      "[role='group'][id]"
    ];
    const elements = Array.from(root?.querySelectorAll?.(selectors.join(",")) || []);
    const descriptors = [];
    const seenElements = new Set();
    const seenIds = new Set();
    for (const [index, element] of elements.entries()) {
      if (!element || seenElements.has(element)) continue;
      seenElements.add(element);
      const id = cleanText(element.id || element.getAttribute?.("data-option") || element.getAttribute?.("data-slide"));
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      const label = variantOptionLabel(element, descriptors.length);
      const text = cleanText(element.textContent);
      const assetUrls = variantAssetUrlsForElement(element);
      if (!label || (!text && !id && !assetUrls.length)) continue;
      descriptors.push({
        element,
        id,
        label,
        text,
        assetUrls,
        visible: variantElementVisible(element),
        sourceOrder: index,
        domOrder: elementSummary(element, index).domOrder
      });
    }

    const merged = [];
    for (const descriptor of descriptors) {
      const existing = merged.find((item) => variantLabelsMatch(item.label, descriptor.label));
      if (!existing) {
        merged.push({ ...descriptor });
        continue;
      }
      if (descriptor.text.length > existing.text.length) existing.text = descriptor.text;
      existing.assetUrls = Array.from(new Set([...existing.assetUrls, ...descriptor.assetUrls]));
      existing.visible ||= descriptor.visible;
      existing.sourceOrder = Math.min(existing.sourceOrder, descriptor.sourceOrder);
      existing.domOrder = Math.min(existing.domOrder, descriptor.domOrder);
      existing.id ||= descriptor.id;
    }
    return merged.sort((left, right) => left.sourceOrder - right.sourceOrder);
  }

  function variantButtonLabelAllowed(element) {
    const label = variantButtonOptionLabel(element);
    if (!label || label.length > 90 || variantDirectionForControl(element)) return false;
    if (/\b(subscribe|sign in|log in|share|save|gift|comment|search|menu|close|dismiss|download|print|play|pause|mute|advertis|privacy|cookie|accept|reject|next story|previous story)\b/i.test(label)) return false;
    return label.split(/\s+/).length <= 12;
  }

  function variantButtonOptionCandidates(controlRoot, suppliedButtons = null) {
    let buttons = Array.isArray(suppliedButtons) ? suppliedButtons : [];
    if (!Array.isArray(suppliedButtons)) {
      try {
        buttons = Array.from(controlRoot?.querySelectorAll?.("button,[role='button']") || []);
      } catch {
        buttons = [];
      }
    }
    return buttons
      .filter((button) => variantControlIsStoryContent(button) && variantButtonLabelAllowed(button))
      .map((element, index) => ({
        element,
        id: cleanText(element.id || element.getAttribute?.("data-option") || element.getAttribute?.("data-value")),
        label: variantButtonOptionLabel(element),
        text: variantButtonOptionLabel(element),
        assetUrls: variantAssetUrlsForElement(element),
        visible: variantElementVisible(element),
        sourceOrder: index,
        domOrder: elementSummary(element, index).domOrder
      }));
  }

  function variantButtonGroupStateRoot(controlRoot) {
    let fallback = null;
    let root = controlRoot;
    for (let depth = 0; root && depth < 8; depth += 1, root = root.parentElement) {
      if (root !== controlRoot && isRootOrChromeElement(root)) break;
      const text = cleanText(root.textContent);
      const hasHeading = Boolean(root.querySelector?.("h1,h2,h3,h4,legend,[class*='title'],[class*='heading']"));
      const hasVisual = Boolean(root.querySelector?.("canvas,svg,model-viewer,[aria-label*='illustration' i],[class*='card'],[class*='slide']"));
      const isLocalStoryBoundary = variantStoryBoundary(root) === root;
      if (text.length < 80 && !(isLocalStoryBoundary && hasHeading && text.length >= 20)) continue;
      if ((hasHeading || hasVisual) && !fallback) fallback = root;
      let visualNodes = [];
      try {
        visualNodes = Array.from(root.querySelectorAll?.("canvas,model-viewer,[data-model],[data-model-url],[aria-label*='illustration' i],[class*='card'],[class*='slide']") || []);
      } catch {
        visualNodes = [];
      }
      if (visualNodes.some((node) => !controlRoot.contains?.(node))) return fallback || root;
    }
    return fallback || controlRoot?.parentElement || controlRoot;
  }

  function variantButtonControlClusters(controls) {
    const clusters = new Map();
    for (const control of controls) {
      let controlRoot = null;
      for (let ancestor = control.parentElement, depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
        if (isRootOrChromeElement(ancestor)) break;
        const contained = controls.filter((candidate) => ancestor.contains?.(candidate));
        if (contained.length >= 2 && contained.length <= MAX_VARIANT_OPTIONS_PER_GROUP) {
          controlRoot = ancestor;
          break;
        }
      }
      if (!controlRoot) continue;
      clusters.set(controlRoot, controls.filter((candidate) => controlRoot.contains?.(candidate)));
    }
    return clusters;
  }

  function collectButtonClusterVariantGroups(existingRoots = new Set()) {
    let controls = [];
    try {
      controls = Array.from(document.querySelectorAll?.("button,[role='button']") || [])
        .filter((element) => variantControlIsStoryContent(element) && variantButtonLabelAllowed(element));
    } catch {
      controls = [];
    }
    const byParent = variantButtonControlClusters(controls);
    const groups = [];
    for (const [controlRoot, buttons] of byParent) {
      if (buttons.length < 2 || buttons.length > MAX_VARIANT_OPTIONS_PER_GROUP) continue;
      const labels = buttons.map(variantButtonOptionLabel);
      if (new Set(labels.map(variantOptionKey)).size < 2) continue;
      const stateRoot = variantButtonGroupStateRoot(controlRoot);
      if (!stateRoot || existingRoots.has(stateRoot) || isRootOrChromeElement(stateRoot)) continue;
      const candidates = variantButtonOptionCandidates(controlRoot, buttons);
      if (candidates.length < 2) continue;
      const rootSummary = elementSummary(stateRoot, groups.length);
      const identity = stableVariantGroupIdentity({
        root: stateRoot,
        controlRoot,
        kind: "button-cluster",
        candidates
      });
      const groupId = identity.id;
      const options = candidates.map((candidate, index) => ({
        id: cleanText(candidate.id) || `${groupId}-option-${index + 1}`,
        label: candidate.label,
        text: candidate.text,
        sourceOrder: index,
        domOrder: candidate.domOrder,
        assetUrls: candidate.assetUrls,
        selected: variantElementSelected(candidate.element),
        evidence: {
          selector: elementSummary(candidate.element, index).selector,
          source: "source-dom-button-cluster"
        }
      }));
      const selected = options.find((option) => option.selected) || options[0];
      const group = {
        schemaVersion: "storyvr-source-variant-group/v1",
        id: groupId,
        title: variantGroupTitle(stateRoot),
        domOrder: rootSummary.domOrder,
        selectionMode: "single",
        defaultOptionId: selected.id,
        control: {
          kind: "button-cluster",
          previousLabel: "Previous option",
          nextLabel: "Next option",
          wrap: false
        },
        options,
        evidence: {
          source: "source-dom-button-cluster",
          rootSelector: rootSummary.selector,
          controlRootSelector: elementSummary(controlRoot).selector,
          groupSignature: identity.signature,
          rootLineage: identity.lineage
        },
        hierarchy: { role: "candidate-top-level" }
      };
      variantGroupRuntimeRefs.set(groupId, {
        root: stateRoot,
        controlRoot,
        previous: null,
        next: null,
        kind: "button-cluster"
      });
      existingRoots.add(stateRoot);
      groups.push(group);
    }
    return groups;
  }

  function variantElementSelected(element) {
    if (!element) return false;
    const explicitStates = ["aria-selected", "aria-checked", "aria-pressed"]
      .map((name) => String(element.getAttribute?.(name) || "").toLowerCase())
      .filter(Boolean);
    if (explicitStates.some((value) => ["true", "1"].includes(value))) return true;
    if (explicitStates.some((value) => ["false", "0"].includes(value))) return false;
    const accessibleState = cleanText([element.getAttribute?.("aria-label"), element.getAttribute?.("title")].filter(Boolean).join(" ")).toLowerCase();
    if (/\bnot\s+(?:selected|checked|pressed|active|current)\b/.test(accessibleState)) return false;
    if (/\b(?:selected|checked|pressed|active|current)\b/.test(accessibleState)) return true;
    if (element.selected === true || element.checked === true) return true;
    const classTokens = variantClassTokens(element);
    if (classTokens.some((token) => ["not-selected", "unselected", "not-checked", "unchecked", "not-active", "inactive", "not-current"].includes(token))) return false;
    return classTokens.some((token) => ["active", "is-active", "selected", "is-selected", "checked", "is-checked", "current", "is-current"].includes(token));
  }

  function semanticVariantControlKind(root) {
    const role = String(root?.getAttribute?.("role") || "").toLowerCase();
    if (role === "tablist") return "tabs";
    if (role === "radiogroup") return "radio";
    if (role === "listbox") return "listbox";
    return "single-select";
  }

  function selectionAnnouncementsFromText(value) {
    const text = cleanText(value);
    const pattern = /\b(?:you(?:['’]ve|\s+have)?|currently)\s+selected\s+(.{1,140}?)\.\s*(?:read|learn|view|see)\s+(?:more|additional)(?:\s+information)?(?:\s+about\s+(?:it|this)(?:\s+below)?)?\.?\s*/gi;
    const matches = [];
    let match;
    while ((match = pattern.exec(text))) {
      const label = cleanText(match[1]);
      if (!label || label.length > 140) continue;
      matches.push({ label, start: match.index, contentStart: pattern.lastIndex });
    }
    return { text, matches };
  }

  function announcementVariantTitle(unit, text, firstStart, headings) {
    const prefixKey = storyTextKey(text.slice(0, firstStart));
    const matchingHeading = (Array.isArray(headings) ? headings : [])
      .filter((heading) => {
        const key = storyTextKey(heading?.text || "");
        return key && prefixKey.includes(key);
      })
      .sort((left, right) => {
        const leftDistance = Math.abs(Number(left?.domOrder || 0) - Number(unit?.domOrder || 0));
        const rightDistance = Math.abs(Number(right?.domOrder || 0) - Number(unit?.domOrder || 0));
        return leftDistance - rightDistance || cleanText(right?.text).length - cleanText(left?.text).length;
      })[0];
    if (matchingHeading) return cleanText(matchingHeading.text);
    const firstSentence = cleanText(text.slice(0, firstStart)).match(/^(.{3,180}?[?!\.])(?:\s|$)/)?.[1];
    return cleanText(firstSentence || "Selectable options");
  }

  function collectAnnouncementVariantGroups(headings = []) {
    const groups = [];
    for (const unit of collectStoryVrTextUnits()) {
      const { text, matches } = selectionAnnouncementsFromText(unit.text);
      const unique = [];
      const seenLabels = new Set();
      for (const match of matches) {
        const key = variantOptionKey(match.label);
        if (!key || seenLabels.has(key)) continue;
        seenLabels.add(key);
        unique.push(match);
      }
      if (unique.length < 2) continue;
      const title = announcementVariantTitle(unit, text, unique[0].start, headings);
      const rootId = `variant-group-${hashString(`${unit.id}:${title}:${unique.map((item) => item.label).join("|")}`)}`;
      const options = unique.map((item, index) => {
        const nextStart = unique[index + 1]?.start ?? text.length;
        const detail = cleanText(text.slice(item.contentStart, nextStart));
        return {
          id: `${rootId}-option-${index + 1}`,
          label: item.label,
          text: detail ? `${item.label}. ${detail}` : item.label,
          sourceOrder: index,
          domOrder: Number(unit.domOrder || 0) + index,
          assetUrls: [],
          selected: index === 0,
          evidence: {
            source: "runtime-accessibility-selection-announcement",
            textUnitId: unit.id,
            announcementIndex: index
          }
        };
      });
      const group = {
        schemaVersion: "storyvr-source-variant-group/v1",
        id: rootId,
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
          textUnitId: unit.id,
          optionCount: options.length
        },
        hierarchy: { role: "candidate-top-level" }
      };
      groups.push(group);
    }
    return groups;
  }

  function variantGroupRootForControls(previous, next) {
    let root = previous?.parentElement || null;
    for (let depth = 0; root && depth < 7; depth += 1, root = root.parentElement) {
      if (next && !root.contains?.(next)) continue;
      if (variantOptionCandidates(root).length >= 1) return root;
    }
    return null;
  }

  function variantDirectionalControlPairs(controls) {
    const pairs = [];
    const used = new Set();
    const previousControls = controls.filter((element) => variantDirectionForControl(element) === "previous");
    for (const previous of previousControls) {
      const next = controls.find((candidate) => !used.has(candidate) && variantDirectionForControl(candidate) === "next" && (
        candidate.parentElement === previous.parentElement
        || previous.parentElement?.contains?.(candidate)
        || candidate.parentElement?.contains?.(previous)
      ));
      if (!next) continue;
      used.add(previous);
      used.add(next);
      pairs.push({ previous, next, directionSource: "semantic-metadata" });
    }

    const byParent = new Map();
    for (const control of controls.filter((element) => !used.has(element))) {
      const parent = control.parentElement;
      if (!parent) continue;
      const list = byParent.get(parent) || [];
      list.push(control);
      byParent.set(parent, list);
    }
    for (const buttons of byParent.values()) {
      if (buttons.length !== 2) continue;
      const directions = buttons.map(variantDirectionForControl);
      const optionLabels = buttons.map(variantButtonOptionLabel).filter(Boolean);
      if (!directions.some(Boolean) && optionLabels.length) continue;
      let previous = buttons[directions.indexOf("previous")] || null;
      let next = buttons[directions.indexOf("next")] || null;
      if (!previous || !next) {
        const ordered = [...buttons].sort((left, right) => {
          const leftRect = left.getBoundingClientRect?.() || {};
          const rightRect = right.getBoundingClientRect?.() || {};
          const leftCenter = (Number(leftRect.left) || 0) + (Number(leftRect.width) || 0) / 2;
          const rightCenter = (Number(rightRect.left) || 0) + (Number(rightRect.width) || 0) / 2;
          return leftCenter - rightCenter;
        });
        previous ||= ordered[0];
        next ||= ordered[1];
      }
      if (!previous || !next || previous === next || !variantGroupRootForControls(previous, next)) continue;
      used.add(previous);
      used.add(next);
      pairs.push({ previous, next, directionSource: directions.some(Boolean) ? "partial-semantic-plus-geometry" : "paired-icon-geometry" });
    }
    return pairs;
  }

  function variantGroupTitle(root) {
    const selectors = "[data-variant-title],legend,[class*='prompt'],h2,h3,h4";
    let current = root;
    for (let depth = 0; current && depth < 3; depth += 1, current = current.parentElement) {
      const candidate = current.querySelector?.(selectors);
      const text = cleanText(candidate?.textContent);
      if (text && text.length <= 240) return text;
    }
    return "Selectable variants";
  }

  function registerVariantGroups(groups) {
    for (const group of groups || []) {
      if (!group?.id) continue;
      const existing = variantGroupRegistry.get(group.id);
      if (!existing) {
        variantGroupRegistry.set(group.id, {
          ...group,
          options: (group.options || []).map((option) => ({ ...option }))
        });
        continue;
      }
      const options = (existing.options || []).map((option) => ({ ...option }));
      for (const option of group.options || []) {
        const index = options.findIndex((candidate) => (
          cleanText(candidate.id) === cleanText(option.id)
          || variantOptionKey(candidate.label) === variantOptionKey(option.label)
        ));
        if (index < 0) {
          options.push({ ...option });
          continue;
        }
        const previous = options[index];
        options[index] = {
          ...previous,
          ...option,
          text: cleanText(option.text).length >= cleanText(previous.text).length ? option.text : previous.text,
          assetUrls: Array.from(new Set([...(previous.assetUrls || []), ...(option.assetUrls || [])])),
          evidence: {
            ...(previous.evidence && typeof previous.evidence === "object" ? previous.evidence : {}),
            ...(option.evidence && typeof option.evidence === "object" ? option.evidence : {})
          }
        };
      }
      variantGroupRegistry.set(group.id, {
        ...existing,
        ...group,
        options: options.sort((left, right) => Number(left.sourceOrder || 0) - Number(right.sourceOrder || 0)),
        hierarchy: {
          ...(existing.hierarchy && typeof existing.hierarchy === "object" ? existing.hierarchy : {}),
          ...(group.hierarchy && typeof group.hierarchy === "object" ? group.hierarchy : {}),
          ...(["nested", "visual-child"].includes(existing.hierarchy?.role)
            ? { role: existing.hierarchy.role, parentReferences: [...(existing.hierarchy.parentReferences || [])] }
            : {})
        },
        evidence: {
          ...(existing.evidence && typeof existing.evidence === "object" ? existing.evidence : {}),
          ...(group.evidence && typeof group.evidence === "object" ? group.evidence : {})
        }
      });
    }
    captureCoverage.variantGroupDetectedCount = Math.max(
      captureCoverage.variantGroupDetectedCount,
      variantGroupRegistry.size
    );
  }

  function registeredVariantGroups() {
    return Array.from(variantGroupRegistry.values())
      .map((group) => variantGroupWithInteractionAssociations({
        ...group,
        options: (group.options || []).map((option) => ({ ...option }))
      }))
      .sort((left, right) => Number(left.domOrder || 0) - Number(right.domOrder || 0));
  }

  function collectStoryVrVariantGroups(headings = []) {
    const controls = Array.from(document.querySelectorAll?.("button,[role='button']") || [])
      .filter((element) => variantControlIsStoryContent(element));
    const groups = [];
    const seenRoots = new Set();
    for (const { previous, next, directionSource } of variantDirectionalControlPairs(controls)) {
      const root = variantGroupRootForControls(previous, next);
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      const candidates = variantOptionCandidates(root);
      if (candidates.length < 1) continue;
      const rootSummary = elementSummary(root, groups.length);
      const identity = stableVariantGroupIdentity({
        root,
        controlRoot: previous.parentElement || root,
        kind: "previous-next",
        candidates,
        dynamicOptions: true
      });
      const groupId = identity.id;
      const options = candidates.map((candidate, index) => ({
        id: cleanText(candidate.id) || `${groupId}-option-${hashString(variantOptionKey(candidate.label) || `source-${index + 1}`)}`,
        label: candidate.label,
        text: candidate.text || candidate.label,
        sourceOrder: index,
        domOrder: candidate.domOrder,
        assetUrls: candidate.assetUrls,
        selected: candidate.visible,
        evidence: {
          selector: elementSummary(candidate.element, index).selector,
          source: "source-dom"
        }
      }));
      const selected = options.find((option) => option.selected) || options[0];
      const group = {
        schemaVersion: "storyvr-source-variant-group/v1",
        id: groupId,
        title: variantGroupTitle(root),
        domOrder: rootSummary.domOrder,
        selectionMode: "single",
        defaultOptionId: selected.id,
        control: {
          kind: "previous-next",
          previousLabel: variantControlText(previous) || "Previous option",
          nextLabel: variantControlText(next) || "Next option",
          wrap: true
        },
        options,
        evidence: {
          source: "source-dom",
          rootSelector: rootSummary.selector,
          controlSelectors: [elementSummary(previous).selector, elementSummary(next).selector],
          directionSource,
          groupSignature: identity.signature,
          rootLineage: identity.lineage
        },
        hierarchy: { role: "candidate-top-level" }
      };
      variantGroupRuntimeRefs.set(groupId, { root, controlRoot: previous.parentElement || root, previous, next, kind: "previous-next" });
      groups.push(group);
    }

    let semanticRoots = [];
    try {
      semanticRoots = Array.from(document.querySelectorAll?.("[role='tablist'],[role='radiogroup'],[role='listbox'],[data-variant-group]") || []);
    } catch {
      semanticRoots = [];
    }
    for (const root of semanticRoots) {
      if (!root || seenRoots.has(root) || isRootOrChromeElement(root)) continue;
      const candidates = variantOptionCandidates(root);
      if (candidates.length < 2) continue;
      seenRoots.add(root);
      const rootSummary = elementSummary(root, groups.length);
      const identity = stableVariantGroupIdentity({ root, controlRoot: root, kind: semanticVariantControlKind(root), candidates });
      const groupId = identity.id;
      const options = candidates.map((candidate, index) => ({
        id: cleanText(candidate.id) || `${groupId}-option-${index + 1}`,
        label: candidate.label,
        text: candidate.text || candidate.label,
        sourceOrder: index,
        domOrder: candidate.domOrder,
        assetUrls: candidate.assetUrls,
        selected: variantElementSelected(candidate.element),
        evidence: {
          selector: elementSummary(candidate.element, index).selector,
          source: "source-dom-semantic-control"
        }
      }));
      const selected = options.find((option) => option.selected) || options[0];
      const group = {
        schemaVersion: "storyvr-source-variant-group/v1",
        id: groupId,
        title: variantGroupTitle(root),
        domOrder: rootSummary.domOrder,
        selectionMode: "single",
        defaultOptionId: selected.id,
        control: {
          kind: semanticVariantControlKind(root),
          previousLabel: "Previous option",
          nextLabel: "Next option",
          wrap: false
        },
        options,
        evidence: {
          source: "source-dom-semantic-control",
          rootSelector: rootSummary.selector,
          groupSignature: identity.signature,
          rootLineage: identity.lineage
        },
        hierarchy: { role: "candidate-top-level" }
      };
      variantGroupRuntimeRefs.set(groupId, { root, previous: null, next: null, kind: "semantic" });
      groups.push(group);
    }

    groups.push(...collectButtonClusterVariantGroups(seenRoots));

    const signatures = new Set(groups.map((group) => (
      group.options.map((option) => variantOptionKey(option.label)).filter(Boolean).sort().join("|")
    )));
    for (const group of collectAnnouncementVariantGroups(headings)) {
      const signature = group.options.map((option) => variantOptionKey(option.label)).filter(Boolean).sort().join("|");
      if (!signature) continue;
      if (signatures.has(signature)) {
        const existing = groups.find((candidate) => (
          candidate.options.map((option) => variantOptionKey(option.label)).filter(Boolean).sort().join("|") === signature
        ));
        if (existing) {
          existing.options = existing.options.map((option) => {
            const announcement = group.options.find((candidate) => variantLabelsMatch(candidate.label, option.label));
            return announcement && cleanText(announcement.text).length > cleanText(option.text).length
              ? { ...option, text: announcement.text, announcementEvidence: announcement.evidence }
              : option;
          });
        }
        continue;
      }
      signatures.add(signature);
      groups.push(group);
    }
    const observedGroups = groups
      .map((group) => variantGroupWithInteractionAssociations(group))
      .sort((left, right) => Number(left.domOrder || 0) - Number(right.domOrder || 0));
    registerVariantGroups(observedGroups);
    return observedGroups;
  }

  function variantAssociationKey(groupId, optionId, context = null) {
    const pathSignature = (Array.isArray(context?.interactionPath) ? context.interactionPath : [])
      .map((item) => `${cleanText(item?.groupId)}=${cleanText(item?.optionId)}`)
      .filter((value) => value !== "=")
      .join(">");
    return [
      cleanText(groupId),
      cleanText(optionId),
      cleanText(context?.parentGroupId),
      cleanText(context?.parentOptionId),
      pathSignature
    ].join("::");
  }

  function variantAssetAssociations() {
    return Array.from(variantAssetAssociationMap.values())
      .map((association) => ({
        ...association,
        assetUrls: [...association.assetUrls],
        domAssetUrls: [...association.domAssetUrls],
        runtimeAssetUrls: [...association.runtimeAssetUrls],
        snapshotIds: [...association.snapshotIds],
        capturePhases: [...(association.capturePhases || [])],
        visualEvidenceRefs: [...(association.visualEvidenceRefs || [])],
        visualState: association.visualState ? {
          ...association.visualState,
          labels: [...(association.visualState.labels || [])],
          assetUrls: [...(association.visualState.assetUrls || [])]
        } : null
      }))
      .sort((left, right) => (
        Number(left.groupDomOrder || 0) - Number(right.groupDomOrder || 0)
        || Number(left.sourceOrder || 0) - Number(right.sourceOrder || 0)
      ));
  }

  function variantGroupWithInteractionAssociations(group) {
    const options = (group.options || []).map((option) => {
      const direct = variantAssetAssociationMap.get(variantAssociationKey(group.id, option.id));
      const byLabel = direct || variantAssetAssociations().find((association) => (
        !association.parentGroupId
        && association.groupId === group.id
        && variantLabelsMatch(association.optionLabel, option.label)
      ));
      if (!byLabel) return option;
      return {
        ...option,
        assetUrls: [...byLabel.assetUrls],
        evidence: {
          ...(option.evidence || {}),
          variantAssetAssociationSource: byLabel.source,
          variantAssetAssociationSnapshotIds: [...byLabel.snapshotIds]
        }
      };
    });
    return { ...group, options };
  }

  function variantRootVisibleInViewport(root) {
    if (!variantElementVisible(root)) return false;
    try {
      const rect = root.getBoundingClientRect?.();
      if (!rect) return false;
      return Number(rect.width) > 1
        && Number(rect.height) > 1
        && Number(rect.bottom) > 0
        && Number(rect.top) < Number(window.innerHeight || 0);
    } catch {
      return false;
    }
  }

  function variantControlRefVisibleInViewport(ref) {
    const controls = ref?.kind === "previous-next"
      ? [ref.previous, ref.next]
      : [ref?.controlRoot || ref?.root];
    return controls.filter(Boolean).some((control) => variantRootVisibleInViewport(control));
  }

  function variantControlIsSafe(element, root) {
    if (!element || !root || !root.contains?.(element)) return false;
    if (!variantControlIsStoryContent(element)) return false;
    const tag = String(element.tagName || "").toUpperCase();
    if (tag === "A" || cleanText(element.getAttribute?.("href"))) return false;
    if (element.disabled || element.getAttribute?.("aria-disabled") === "true") return false;
    if (tag === "BUTTON" && String(element.getAttribute?.("type") || "").toLowerCase() === "submit") return false;
    try {
      if (element.closest?.("form")) return false;
    } catch {
      return false;
    }
    return typeof element.click === "function" && variantElementVisible(element);
  }

  function semanticVariantCandidateIsSafe(candidate, root) {
    const element = candidate?.element;
    const tag = String(element?.tagName || "").toUpperCase();
    const role = String(element?.getAttribute?.("role") || "").toLowerCase();
    const explicitlySelectable = tag === "BUTTON"
      || ["tab", "radio", "option"].includes(role)
      || Boolean(element?.getAttribute?.("data-option"))
      || Boolean(element?.getAttribute?.("data-slide"));
    return explicitlySelectable && variantControlIsSafe(element, root);
  }

  function variantCandidateIntersectionScore(candidate, ref) {
    try {
      const rect = candidate?.element?.getBoundingClientRect?.();
      const rootRect = ref?.root?.getBoundingClientRect?.();
      if (!rect || !rootRect) return 0;
      const width = Math.max(0, Math.min(Number(rect.right), Number(rootRect.right)) - Math.max(Number(rect.left), Number(rootRect.left)));
      const height = Math.max(0, Math.min(Number(rect.bottom), Number(rootRect.bottom)) - Math.max(Number(rect.top), Number(rootRect.top)));
      const area = Math.max(1, Number(rect.width || 0) * Number(rect.height || 0));
      return Math.max(0, Math.min(1, (width * height) / area));
    } catch {
      return 0;
    }
  }

  function variantCandidateStateScore(candidate, ref) {
    if (!candidate?.element) return -Infinity;
    const element = candidate.element;
    if (element.hidden || element.getAttribute?.("aria-hidden") === "true") return -10_000;
    let score = 0;
    if (variantElementSelected(element)) score += 10_000;
    if (candidate.assetUrls?.length) score += 800;
    if (candidate.visible) score += 120;
    score += Math.round(variantCandidateIntersectionScore(candidate, ref) * 600);
    const rootText = variantOptionKey(ref?.root?.textContent || "");
    const label = variantOptionKey(candidate.label);
    if (label && rootText && rootText.includes(label)) score += 80;
    return score - Number(candidate.sourceOrder || 0) / 1000;
  }

  function selectedVariantCandidate(candidates, ref = null) {
    return [...(candidates || [])]
      .sort((left, right) => variantCandidateStateScore(right, ref) - variantCandidateStateScore(left, ref))[0]
      || null;
  }

  function optionForVariantCandidate(group, candidate) {
    if (!candidate) return null;
    return (group.options || []).find((option) => cleanText(option.id) === cleanText(candidate.id))
      || (group.options || []).find((option) => variantOptionKey(option.label) === variantOptionKey(candidate.label))
      || (group.options || []).find((option) => variantLabelsMatch(option.label, candidate.label))
      || null;
  }

  function registerDynamicPreviousNextOption(group, candidate) {
    if (!group || !candidate) return null;
    const existing = optionForVariantCandidate(group, candidate);
    if (existing) return existing;
    const label = cleanText(candidate.label) || `Option ${(group.options || []).length + 1}`;
    const option = {
      id: cleanText(candidate.id) || `${group.id}-option-${hashString(variantOptionKey(label) || `dynamic-${(group.options || []).length + 1}`)}`,
      label,
      text: cleanText(candidate.text) || label,
      sourceOrder: (group.options || []).length,
      domOrder: candidate.domOrder,
      assetUrls: [...(candidate.assetUrls || [])],
      selected: true,
      evidence: {
        selector: elementSummary(candidate.element).selector,
        source: "collector-observed-directional-state"
      }
    };
    group.options = [...(group.options || []), option];
    registerVariantGroups([group]);
    return option;
  }

  function variantOptionSignature(options) {
    return (Array.isArray(options) ? options : [])
      .map((option) => variantOptionKey(option?.label || ""))
      .filter(Boolean)
      .join("|");
  }

  function variantRootAncestors(root, limit = 8) {
    const ancestors = [];
    let current = root;
    for (let depth = 0; current && depth < limit; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      ancestors.push(current);
    }
    return ancestors;
  }

  function variantStoryBoundary(element) {
    let current = element;
    for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      const tag = String(current.tagName || "").toLowerCase();
      const classes = elementClassName(current).toLowerCase();
      if (
        cleanText(current.getAttribute?.("data-slide"))
        || cleanText(current.getAttribute?.("data-step"))
        || cleanText(current.getAttribute?.("data-scene"))
        || /(^|\s)(?:slide|step|scene)(?:\s|$|-)/.test(classes)
        || tag === "section"
      ) return current;
    }
    return null;
  }

  function variantOptionExplicitlyTargetsChild(parentState, childRef) {
    const control = parentState?.candidate?.element;
    const childRoot = childRef?.root;
    if (!control || !childRoot) return false;
    const childIds = new Set([
      cleanText(childRoot.id),
      cleanText(childRef.controlRoot?.id)
    ].filter(Boolean));
    if (!childIds.size) return false;
    const references = ["aria-controls", "data-target", "data-controls", "href"]
      .flatMap((name) => cleanText(control.getAttribute?.(name)).split(/\s+/))
      .map((value) => value.replace(/^#/, ""))
      .filter(Boolean);
    return references.some((value) => childIds.has(value));
  }

  function variantRootRelationship(parentRoot, childRoot, parentRef = null, childRef = null) {
    if (!parentRoot || !childRoot || parentRoot === childRoot) return null;
    const parentBoundary = variantStoryBoundary(parentRoot) || variantStoryBoundary(parentRef?.controlRoot);
    const childBoundary = variantStoryBoundary(childRoot) || variantStoryBoundary(childRef?.controlRoot);
    const sameStoryBoundary = Boolean(parentBoundary && childBoundary && parentBoundary === childBoundary);
    if (parentRoot.contains?.(childRoot)) {
      return { kind: "descendant-control", scopeRoot: parentRoot, sameStoryBoundary };
    }
    const parentAncestors = variantRootAncestors(parentRoot);
    const childAncestors = variantRootAncestors(childRoot);
    const childSet = new Set(childAncestors);
    const scopeRoot = parentAncestors.find((ancestor) => childSet.has(ancestor));
    if (!scopeRoot || isRootOrChromeElement(scopeRoot)) return null;
    const parentDepth = parentAncestors.indexOf(scopeRoot);
    const childDepth = childAncestors.indexOf(scopeRoot);
    if (parentDepth > 4 || childDepth > 5) return null;
    const scopedBoundary = variantStoryBoundary(scopeRoot);
    return {
      kind: "localized-sibling-control",
      scopeRoot,
      parentDepth,
      childDepth,
      sameStoryBoundary: sameStoryBoundary || scopedBoundary === scopeRoot
    };
  }

  function variantControlObservations(excludedGroupId = "") {
    const groups = collectStoryVrVariantGroups(collectStoryVrHeadings());
    // These local fingerprints exist only to attribute control dependencies,
    // hierarchy, and passive recovery baselines. Button outcome detection is
    // document-wide and never consults this scoped fingerprint.
    // Sample runtime state once for the whole control inventory; fingerprints
    // contain only discrete identity/visibility state, never live transforms
    // or canvas pixels.
    const runtime3D = collectRuntime3DObservation();
    const observations = new Map();
    for (const group of groups) {
      if (group.id === excludedGroupId) continue;
      const ref = variantGroupRuntimeRefs.get(group.id);
      if (!ref?.root) continue;
      const state = currentVariantState(group, ref);
      observations.set(group.id, {
        group,
        ref,
        fingerprint: variantStateFingerprint(ref, runtime3D),
        optionSignature: variantOptionSignature(group.options),
        selectedOptionId: cleanText(state?.option?.id),
        selectedOptionLabel: cleanText(state?.option?.label),
        rootSelector: elementSummary(ref.root).selector,
        controlSelector: elementSummary(ref.controlRoot || ref.next || ref.root).selector,
        visible: variantControlRefVisibleInViewport(ref)
      });
    }
    return observations;
  }

  function variantObservationSignature(observation) {
    if (!observation) return "absent";
    return [
      observation.fingerprint,
      observation.optionSignature,
      observation.selectedOptionId,
      observation.rootSelector,
      observation.controlSelector
    ].map(cleanText).join("|");
  }

  function variantObservationChangeKinds(before, after) {
    if (!before && after) return ["appeared"];
    if (before && !after) return ["disappeared"];
    if (!before || !after) return [];
    const kinds = [];
    if (before.fingerprint !== after.fingerprint) kinds.push("owned-state");
    if (before.optionSignature !== after.optionSignature) kinds.push("option-set");
    if (before.selectedOptionId !== after.selectedOptionId) kinds.push("selection");
    if (before.rootSelector !== after.rootSelector || before.controlSelector !== after.controlSelector) kinds.push("remounted-control");
    return kinds;
  }

  function serializableVariantObservationMap(observations) {
    const records = {};
    for (const [groupId, observation] of observations || []) {
      records[groupId] = {
        signature: variantObservationSignature(observation),
        selectedOptionId: observation.selectedOptionId,
        optionSignature: observation.optionSignature,
        visible: Boolean(observation.visible)
      };
    }
    return records;
  }

  function variantHierarchyKey(parentGroupId, parentOptionId, childGroupId, interactionPath = []) {
    const pathSignature = (Array.isArray(interactionPath) ? interactionPath : [])
      .map((item) => `${cleanText(item?.groupId)}=${cleanText(item?.optionId)}`)
      .filter((value) => value !== "=")
      .join(">");
    return [parentGroupId, parentOptionId, childGroupId, pathSignature].map(cleanText).join("::");
  }

  function variantHierarchyWouldCycle(parentGroupId, childGroupId, context = null) {
    if (!parentGroupId || !childGroupId || parentGroupId === childGroupId) return true;
    const ancestors = new Set((context?.interactionPath || []).map((item) => cleanText(item?.groupId)).filter(Boolean));
    if (ancestors.has(childGroupId)) return true;
    const adjacency = new Map();
    for (const edge of variantHierarchyMap.values()) {
      const children = adjacency.get(edge.parentGroupId) || new Set();
      children.add(edge.childGroupId);
      adjacency.set(edge.parentGroupId, children);
    }
    const pending = [childGroupId];
    const seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === parentGroupId) return true;
      if (!current || seen.has(current)) continue;
      seen.add(current);
      pending.push(...(adjacency.get(current) || []));
    }
    return false;
  }

  function recordVariantHierarchy(parentGroup, parentState, childGroup, childRef, context, relationship, evidence = {}) {
    const interactionPath = [
      ...(Array.isArray(context?.interactionPath) ? context.interactionPath.map((item) => ({ ...item })) : []),
      { groupId: parentGroup.id, optionId: parentState.option.id, optionLabel: parentState.option.label }
    ];
    const key = variantHierarchyKey(parentGroup.id, parentState.option.id, childGroup.id, interactionPath);
    const existing = variantHierarchyMap.get(key);
    const observationCount = Number(existing?.observationCount || 0) + 1;
    const explorationPhase = cleanText(context?.explorationPhase);
    const passFamily = explorationPhase.startsWith("pass-1-")
      ? "pass-1-discovery"
      : (explorationPhase.startsWith("pass-2-") ? "pass-2-capture" : explorationPhase);
    const observedPhases = Array.from(new Set([
      ...(existing?.observedPhases || []),
      explorationPhase
    ].filter(Boolean)));
    const observedPasses = Array.from(new Set([
      ...(existing?.observedPasses || []),
      passFamily
    ].filter(Boolean)));
    const confirmed = Boolean(evidence.explicitlyTargeted || observedPasses.length >= 2);
    const record = {
      schemaVersion: "storyvr-variant-hierarchy/v1",
      parentGroupId: parentGroup.id,
      parentOptionId: parentState.option.id,
      parentOptionLabel: parentState.option.label,
      childGroupId: childGroup.id,
      childGroupTitle: childGroup.title,
      childOptionIds: Array.from(new Set([
        ...(existing?.childOptionIds || []),
        ...(childGroup.options || []).map((option) => option.id).filter(Boolean)
      ])),
      childOptionLabels: Array.from(new Set([
        ...(existing?.childOptionLabels || []),
        ...(childGroup.options || []).map((option) => option.label).filter(Boolean)
      ])),
      interactionPath,
      relationship: "visual-child",
      scopeRelationship: relationship?.kind || "",
      scopeRootSelector: elementSummary(relationship?.scopeRoot).selector,
      childRootSelector: elementSummary(childRef?.root).selector,
      stateChanged: Boolean(existing?.stateChanged || evidence.stateChanged),
      explicitlyTargeted: Boolean(existing?.explicitlyTargeted || evidence.explicitlyTargeted),
      changeKinds: Array.from(new Set([...(existing?.changeKinds || []), ...(evidence.changeKinds || [])])),
      observationCount,
      observedPhases,
      observedPasses,
      confirmed,
      confirmation: evidence.explicitlyTargeted
        ? "explicit-control-target"
        : (confirmed ? "cross-pass-causal-state-change" : "tentative-causal-state-change"),
      source: "collector-observed-causal-interaction-dependency"
    };
    variantHierarchyMap.set(key, record);
    if (confirmed) nestedVariantGroupIds.add(childGroup.id);
    const registeredChild = variantGroupRegistry.get(childGroup.id);
    if (registeredChild && confirmed) {
      const parentReferences = Array.from(new Set([
        ...(registeredChild.hierarchy?.parentReferences || []),
        `${parentGroup.id}::${parentState.option.id}`
      ]));
      variantGroupRegistry.set(childGroup.id, {
        ...registeredChild,
        hierarchy: {
          ...(registeredChild.hierarchy || {}),
          role: "nested",
          parentReferences
        }
      });
    }
    captureCoverage.nestedVariantGroupCount = nestedVariantGroupIds.size;
    captureCoverage.variantHierarchyCount = variantHierarchyMap.size;
    captureCoverage.variantDependencyConfirmedCount = Array.from(variantHierarchyMap.values())
      .filter((item) => item.confirmed).length;
    return record;
  }

  function variantHierarchyRecords() {
    return Array.from(variantHierarchyMap.values()).sort((left, right) => (
      cleanText(left.parentGroupId).localeCompare(cleanText(right.parentGroupId))
      || cleanText(left.parentOptionId).localeCompare(cleanText(right.parentOptionId))
      || cleanText(left.childGroupId).localeCompare(cleanText(right.childGroupId))
    ));
  }

  function refreshButtonClusterRef(group, ref) {
    const expectedSignature = variantOptionSignature(group?.options);
    let controls = [];
    try {
      controls = Array.from(document.querySelectorAll?.("button,[role='button']") || [])
        .filter((element) => variantControlIsStoryContent(element) && variantButtonLabelAllowed(element));
    } catch {
      return ref;
    }
    const byParent = variantButtonControlClusters(controls);
    const matches = [];
    for (const [controlRoot, buttons] of byParent) {
      const candidates = variantButtonOptionCandidates(controlRoot, buttons);
      const root = variantButtonGroupStateRoot(controlRoot);
      if (!root) continue;
      const identity = stableVariantGroupIdentity({ root, controlRoot, kind: "button-cluster" });
      const optionSignature = variantOptionSignature(candidates);
      if (identity.id !== group?.id && (!expectedSignature || optionSignature !== expectedSignature)) continue;
      const domOrder = elementSummary(root).domOrder;
      matches.push({
        root,
        controlRoot,
        identityMatch: identity.id === group?.id,
        visible: variantRootVisibleInViewport(controlRoot),
        distance: Math.abs(Number(domOrder || 0) - Number(group?.domOrder || 0))
      });
    }
    const match = matches.sort((left, right) => (
      Number(right.identityMatch) - Number(left.identityMatch)
      || Number(right.visible) - Number(left.visible)
      || left.distance - right.distance
    ))[0];
    if (!match) return ref;
    ref.root = match.root;
    ref.controlRoot = match.controlRoot;
    variantGroupRuntimeRefs.set(group.id, ref);
    return ref;
  }

  function refreshPreviousNextRef(group, ref) {
    let controls = [];
    try {
      controls = Array.from(document.querySelectorAll?.("button,[role='button']") || [])
        .filter((element) => variantControlIsStoryContent(element));
    } catch {
      return ref;
    }
    const matches = [];
    for (const pair of variantDirectionalControlPairs(controls)) {
      const root = variantGroupRootForControls(pair.previous, pair.next);
      if (!root) continue;
      const controlRoot = pair.previous.parentElement || root;
      const identity = stableVariantGroupIdentity({ root, controlRoot, kind: "previous-next" });
      if (identity.id !== group?.id) continue;
      matches.push({
        root,
        controlRoot,
        previous: pair.previous,
        next: pair.next,
        visible: variantControlRefVisibleInViewport({ root, controlRoot, previous: pair.previous, next: pair.next, kind: "previous-next" })
      });
    }
    const match = matches.sort((left, right) => Number(right.visible) - Number(left.visible))[0];
    if (!match) return ref;
    Object.assign(ref, match, { kind: "previous-next" });
    variantGroupRuntimeRefs.set(group.id, ref);
    return ref;
  }

  function refreshSemanticVariantRef(group, ref) {
    let roots = [];
    try {
      roots = Array.from(document.querySelectorAll?.("[role='tablist'],[role='radiogroup'],[role='listbox'],[data-variant-group]") || []);
    } catch {
      return ref;
    }
    const match = roots.find((root) => {
      if (!root || isRootOrChromeElement(root)) return false;
      const identity = stableVariantGroupIdentity({ root, controlRoot: root, kind: semanticVariantControlKind(root) });
      return identity.id === group?.id;
    });
    if (!match) return ref;
    Object.assign(ref, { root: match, controlRoot: match, kind: "semantic" });
    variantGroupRuntimeRefs.set(group.id, ref);
    return ref;
  }

  function refreshVariantGroupRef(group, ref) {
    if (!ref) return ref;
    if (ref.kind === "button-cluster") return refreshButtonClusterRef(group, ref);
    if (ref.kind === "previous-next") return refreshPreviousNextRef(group, ref);
    if (ref.kind === "semantic") return refreshSemanticVariantRef(group, ref);
    return ref;
  }

  function currentVariantState(group, ref) {
    refreshVariantGroupRef(group, ref);
    const candidates = ref.kind === "button-cluster"
      ? variantButtonOptionCandidates(ref.controlRoot)
      : variantOptionCandidates(ref.root);
    const candidate = selectedVariantCandidate(candidates, ref);
    const option = optionForVariantCandidate(group, candidate)
      || (ref.kind === "previous-next" ? registerDynamicPreviousNextOption(group, candidate) : null);
    return option && candidate ? { option, candidate, candidates } : null;
  }

  function variantOwnedCanvases(ref) {
    const root = ref?.root;
    if (!root) return [];
    try {
      return [
        ...(String(root.tagName || "").toLowerCase() === "canvas" ? [root] : []),
        ...Array.from(root.querySelectorAll?.("canvas") || [])
      ].filter((canvas, index, values) => (
        String(canvas?.tagName || "").toLowerCase() === "canvas"
        && values.indexOf(canvas) === index
      )).slice(0, 12);
    } catch {
      return [];
    }
  }

  function stableVariantInlineStyle(node) {
    const style = node?.style;
    return [
      cleanText(style?.display),
      cleanText(style?.visibility),
      cleanText(style?.contentVisibility),
      cleanText(style?.pointerEvents)
    ].join(":");
  }

  function variantStateFingerprint(ref, runtime3D = null) {
    const root = ref?.root;
    if (!root) return "";
    const records = [];
    let nodes = [];
    try {
      nodes = [root, ...Array.from(root.querySelectorAll?.("button,[role='button'],[aria-selected],[aria-checked],[aria-hidden],[class],[style]") || [])].slice(0, 120);
    } catch {
      nodes = [root];
    }
    for (const node of nodes) {
      records.push([
        cleanText(node.id),
        elementClassName(node),
        cleanText(node.getAttribute?.("data-option")),
        cleanText(node.getAttribute?.("data-slide")),
        cleanText(node.getAttribute?.("data-model")),
        cleanText(node.getAttribute?.("data-model-url")),
        cleanText(node.getAttribute?.("aria-selected")),
        cleanText(node.getAttribute?.("aria-checked")),
        cleanText(node.getAttribute?.("aria-pressed")),
        cleanText(node.getAttribute?.("aria-disabled")),
        cleanText(node.getAttribute?.("aria-hidden")),
        // Exact fingerprints must exclude continuously animated values such as
        // transform, opacity, position, and CSS custom properties. Keep only
        // layout/interaction visibility switches that commonly encode a
        // discrete selected state.
        stableVariantInlineStyle(node),
        node.disabled ? "disabled" : "",
        node.hidden ? "hidden" : ""
      ].join(":"));
    }
    const canvasStructure = variantOwnedCanvases(ref).slice(0, 6).map((canvas) => [
      cleanText(canvas.id),
      elementClassName(canvas),
      Number(canvas.width || 0),
      Number(canvas.height || 0)
    ].join(":"));
    const discreteRuntime = variantRuntimeDiscreteSignature(
      ref,
      runtime3D || collectRuntime3DObservation()
    );
    return hashString([
      cleanText(root.textContent),
      variantAssetUrlsForElement(root).join("|"),
      records.join("|"),
      canvasStructure.join("|"),
      discreteRuntime
    ].join("|"));
  }

  function directionalNeighborState(group, ref, before, direction) {
    const options = group?.options || [];
    if (!options.length || !before?.option) return currentVariantState(group, ref);
    const beforeIndex = Math.max(0, options.findIndex((option) => option.id === before.option.id));
    const delta = direction === "previous" ? -1 : 1;
    let targetIndex = beforeIndex + delta;
    if (group.control?.wrap !== false) targetIndex = (targetIndex + options.length) % options.length;
    if (targetIndex < 0 || targetIndex >= options.length) return currentVariantState(group, ref);
    const option = options[targetIndex];
    return expectedVariantState(group, ref, option);
  }

  function expectedVariantState(group, ref, option, preferredCandidate = null) {
    const state = currentVariantState(group, ref);
    if (state?.option.id === option.id) return state;
    const candidates = state?.candidates || variantOptionCandidates(ref?.root);
    const candidate = candidates.find((item) => optionForVariantCandidate(group, item)?.id === option.id)
      || preferredCandidate
      || {
        element: ref?.root,
        label: option.label,
        assetUrls: [],
        selected: true,
        sourceIndex: Number(option.sourceOrder || 0)
      };
    return { option, candidate, candidates };
  }

  function activeRuntimeVariantAssetUrls(runtime3D, ref) {
    return Array.from(new Set(variantRuntimeModelsForRef(runtime3D, ref)
      .map((model) => normalizeUrl(model.assetUrl))
      .filter(Boolean)));
  }

  function variantRuntimeModelsForRef(runtime3D, ref, options = {}) {
    if (!runtime3D || !["ok", "partial"].includes(runtime3D.captureStatus)) return [];
    const ownedCanvases = variantOwnedCanvases(ref);
    if (!ownedCanvases.length) return [];
    let documentCanvases = [];
    try {
      documentCanvases = Array.from(document.querySelectorAll?.("canvas") || []);
    } catch {
      documentCanvases = [];
    }
    const ownedIndexes = new Set(ownedCanvases.map((canvas) => documentCanvases.indexOf(canvas)).filter((index) => index >= 0));
    const ownedSelectors = new Set(ownedCanvases.map((canvas) => elementSummary(canvas).selector).filter(Boolean));
    return (runtime3D.models || [])
      .filter((model) => (
        (options.renderEligibleOnly === false || model?.renderEligible === true)
        && (
          (Number.isInteger(model.canvasIndex) && ownedIndexes.has(model.canvasIndex))
          || (cleanText(model.canvasSelector) && ownedSelectors.has(cleanText(model.canvasSelector)))
        )
      ));
  }

  function variantRuntimeDiscreteSignature(ref, runtime3D = null) {
    const observation = runtime3D || collectRuntime3DObservation();
    const records = variantRuntimeModelsForRef(observation, ref, { renderEligibleOnly: false }).map((model) => [
      cleanText(model.runtimeModelId),
      cleanText(model.assetUrl),
      cleanText(model.rootName),
      cleanText(model.sceneId)
    ].join("|"));
    return records.length ? hashString(records.sort().join("||")) : "";
  }

  function variantVolatileVisualObservation(ref) {
    const canvasSignatures = [];
    for (const canvas of variantOwnedCanvases(ref).slice(0, 6)) {
      try {
        canvasSignatures.push(`${Number(canvas.width || 0)}x${Number(canvas.height || 0)}:${hashString(canvas.toDataURL("image/png", 0.2))}`);
      } catch {
        // A tainted or unreadable canvas is not visual state evidence.
      }
    }
    const runtime3D = collectRuntime3DObservation();
    const runtimeModels = variantRuntimeModelsForRef(runtime3D, ref, { renderEligibleOnly: false });
    const activeRuntimeAnimation = runtimeModels.some((model) => Number(model.activeAnimationCount || 0) > 0);
    const runtimeRecords = runtimeModels.map((model) => [
      cleanText(model.runtimeModelId),
      cleanText(model.assetUrl),
      cleanText(model.rootName),
      ...(model.visibleParts || []).slice(0, 24).map((part) => [
        cleanText(part.nodeId),
        cleanText(part.nodePath),
        cleanText(part.worldTransformSignature),
        Number(part.materialOpacity ?? 1)
      ].join(":"))
    ].join("|"));
    const evidence = [...canvasSignatures, ...runtimeRecords.sort()];
    return {
      signature: evidence.length ? hashString(evidence.join("||")) : "",
      activeRuntimeAnimation
    };
  }

  async function stableVariantVisualEvidenceSignature(ref, sampleGapMs = 80) {
    const signatures = [];
    for (let index = 0; index < 3 && !stopRequested; index += 1) {
      if (index > 0) {
        if (sampleGapMs > 0) await sleep(sampleGapMs);
        await waitForPaint(1);
      }
      const observation = variantVolatileVisualObservation(ref);
      // Instrumented playback is direct evidence that transforms/pixels are
      // time-dependent, so they cannot define an exact variant state.
      if (observation.activeRuntimeAnimation) return "";
      if (!observation.signature) return "";
      signatures.push(observation.signature);
    }
    return signatures.length === 3 && signatures.every((signature) => signature === signatures[0])
      ? signatures[0]
      : "";
  }

  async function stableDocumentVisualEvidenceSignature(sampleGapMs = 80) {
    return stableVariantVisualEvidenceSignature(
      { root: document.documentElement },
      sampleGapMs
    );
  }

  function documentOutcomeElementIsProbeOwned(element) {
    const target = element?.nodeType === 1 ? element : element?.parentElement;
    if (!target) return false;
    try {
      return Boolean(
        target.matches?.("[data-storyvr-probe-ui]")
        || target.closest?.("[data-storyvr-probe-ui]")
      );
    } catch {
      return false;
    }
  }

  function documentWideOutcomeElements() {
    const elements = [];
    const seenElements = new Set();
    const seenRoots = new Set();
    const visitRoot = (root, rootElement = null) => {
      if (!root || seenRoots.has(root)) return;
      seenRoots.add(root);
      let candidates = [];
      try {
        candidates = [
          ...(rootElement ? [rootElement] : []),
          ...Array.from(root.querySelectorAll?.("*") || [])
        ];
      } catch {
        candidates = rootElement ? [rootElement] : [];
      }
      for (const element of candidates) {
        if (!element || seenElements.has(element) || documentOutcomeElementIsProbeOwned(element)) continue;
        seenElements.add(element);
        elements.push(element);
        try {
          if (element.shadowRoot) visitRoot(element.shadowRoot);
        } catch {
          // Closed or inaccessible shadow roots are outside the observable DOM.
        }
      }
    };
    visitRoot(document, document.documentElement);
    return elements;
  }

  const DOCUMENT_OUTCOME_FALLBACK_ATTRIBUTES = [
    "role",
    "aria-selected",
    "aria-checked",
    "aria-pressed",
    "aria-expanded",
    "aria-hidden",
    "aria-disabled",
    "data-option",
    "data-slide",
    "data-step",
    "data-scene",
    "data-model",
    "data-model-url"
  ];

  function documentOutcomeParentStateKey(element, elementStateKeys) {
    let parentKey = elementStateKeys.get(element?.parentElement) || "document";
    if (parentKey !== "document") return parentKey;
    try {
      const host = element?.getRootNode?.()?.host;
      if (host && elementStateKeys.has(host)) parentKey = `${elementStateKeys.get(host)}::shadow`;
    } catch {
      // The document root remains the stable fallback.
    }
    return parentKey;
  }

  function documentOutcomeElementStateKeys(elements) {
    const keys = new Map();
    const usedKeys = new Set();
    const siblingCounts = new Map();
    const duplicateCounts = new Map();

    // Preserve the identity of nodes that survived a reactive update before
    // assigning keys to new nodes. This prevents an inserted sibling from
    // stealing the key of a tracked output element.
    for (const element of elements) {
      const existingKey = documentOutcomeElementKeyMap.get(element);
      if (!existingKey || usedKeys.has(existingKey)) continue;
      keys.set(element, existingKey);
      usedKeys.add(existingKey);
    }

    for (const element of elements) {
      const tag = String(element?.tagName || "element").toLowerCase();
      const id = cleanText(element?.id);
      const parentKey = documentOutcomeParentStateKey(element, keys);
      let structuralKey = "";
      if (id) {
        const baseKey = `id:${tag}:${hashString(id)}`;
        const duplicate = Number(duplicateCounts.get(baseKey) || 0) + 1;
        duplicateCounts.set(baseKey, duplicate);
        structuralKey = duplicate === 1 ? baseKey : `${baseKey}:duplicate-${duplicate}`;
      } else {
        const siblingKey = `${parentKey}/${tag}`;
        const ordinal = Number(siblingCounts.get(siblingKey) || 0) + 1;
        siblingCounts.set(siblingKey, ordinal);
        structuralKey = `${siblingKey}:${ordinal}`;
      }

      let stateKey = keys.get(element);
      if (!stateKey) {
        const reusableKey = documentOutcomeStructuralKeyMap.get(structuralKey);
        if (reusableKey && !usedKeys.has(reusableKey)) {
          stateKey = reusableKey;
        } else {
          documentOutcomeElementKeySerial += 1;
          stateKey = `node:${documentOutcomeElementKeySerial}:${hashString(structuralKey)}`;
        }
        keys.set(element, stateKey);
        documentOutcomeElementKeyMap.set(element, stateKey);
        usedKeys.add(stateKey);
      }

      // Refresh the structural route even for surviving nodes. A later
      // remount at the same route can then reuse the tracked state key.
      documentOutcomeStructuralKeyMap.set(structuralKey, stateKey);
    }
    return keys;
  }

  function documentWideDomState(elements = documentWideOutcomeElements(), elementStateKeys = documentOutcomeElementStateKeys(elements)) {
    const records = [];
    const stateRecords = new Map();
    const childOrderByParent = new Map();
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      const attributes = new Map();
      try {
        for (const attribute of Array.from(element.attributes || [])) {
          const name = cleanText(attribute?.name).toLowerCase();
          if (!name) continue;
          attributes.set(name, hashString(String(attribute?.value || "")));
        }
      } catch {
        // Synthetic DOMs may not expose an attributes collection.
      }
      for (const name of DOCUMENT_OUTCOME_FALLBACK_ATTRIBUTES) {
        if (attributes.has(name)) continue;
        try {
          const value = element.getAttribute?.(name);
          if (value !== null && value !== undefined && String(value) !== "") {
            attributes.set(name, hashString(String(value)));
          }
        } catch {
          // An inaccessible attribute cannot contribute to page-observable state.
        }
      }
      let directText = "";
      try {
        const childNodes = Array.from(element.childNodes || []);
        directText = childNodes.length
          ? childNodes.filter((node) => node?.nodeType === 3).map((node) => String(node.nodeValue || "")).join(" ")
          : String(element.textContent || "");
      } catch {
        directText = "";
      }
      const stateKey = elementStateKeys.get(element) || `element:${index}`;
      const parentKey = documentOutcomeParentStateKey(element, elementStateKeys);
      const tagName = String(element.tagName || "").toLowerCase();
      const orderedChildren = childOrderByParent.get(parentKey) || [];
      orderedChildren.push(stateKey);
      childOrderByParent.set(parentKey, orderedChildren);
      const propertyState = [
        element.hidden ? "hidden" : "",
        element.disabled ? "disabled" : "",
        element.checked ? "checked" : "",
        element.selected ? "selected" : "",
        element.open ? "open" : ""
      ].join(":");
      const record = [
        stateKey,
        parentKey,
        tagName,
        cleanText(element.id),
        hashString(elementClassName(element)),
        Array.from(attributes.entries()).sort(([left], [right]) => left.localeCompare(right))
          .map(([name, value]) => `${name}=${value}`).join(";"),
        hashString(directText),
        propertyState
      ].join("|");
      records.push(record);
      stateRecords.set(stateKey, hashString(record));
    }
    for (const [parentKey, childKeys] of childOrderByParent) {
      const stateKey = `children:${parentKey}`;
      const record = `${stateKey}|${childKeys.join(",")}`;
      records.push(record);
      stateRecords.set(stateKey, hashString(record));
    }
    return {
      signature: hashString(records.join("||")),
      stateRecords
    };
  }

  function documentWideScrollSignature(elements = documentWideOutcomeElements(), elementStateKeys = documentOutcomeElementStateKeys(elements)) {
    const windowRecord = `${Math.round(Number(window.scrollX || window.pageXOffset || 0))}:${Math.round(Number(window.scrollY || window.pageYOffset || 0))}`;
    const records = [`window:${windowRecord}`];
    const stateRecords = new Map([["window", windowRecord]]);
    let scrollableElementCount = 0;
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      const scrollLeft = Math.round(Number(element?.scrollLeft || 0));
      const scrollTop = Math.round(Number(element?.scrollTop || 0));
      const scrollWidth = Math.round(Number(element?.scrollWidth || 0));
      const scrollHeight = Math.round(Number(element?.scrollHeight || 0));
      const clientWidth = Math.round(Number(element?.clientWidth || 0));
      const clientHeight = Math.round(Number(element?.clientHeight || 0));
      if (scrollLeft !== 0 || scrollTop !== 0 || scrollWidth > clientWidth || scrollHeight > clientHeight) {
        scrollableElementCount += 1;
      }
      const record = `${scrollLeft}:${scrollTop}`;
      const stateKey = elementStateKeys.get(element) || `element:${index}`;
      records.push(`${stateKey}:${record}`);
      stateRecords.set(stateKey, record);
    }
    return {
      signature: hashString(records.join("|")),
      scrollableElementCount,
      stateRecords
    };
  }

  function documentOutcomeChangedStateKeys(beforeRecords, afterRecords) {
    const keys = new Set([
      ...(beforeRecords?.keys?.() || []),
      ...(afterRecords?.keys?.() || [])
    ]);
    return Array.from(keys).filter((key) => beforeRecords?.get(key) !== afterRecords?.get(key));
  }

  function documentOutcomeChangedScrollStateKeys(beforeRecords, afterRecords) {
    const keys = new Set([
      ...(beforeRecords?.keys?.() || []),
      ...(afterRecords?.keys?.() || [])
    ]);
    return Array.from(keys).filter((key) => (
      (beforeRecords?.get(key) || "0:0") !== (afterRecords?.get(key) || "0:0")
    ));
  }

  function documentOutcomeProjectionSignature(snapshot, trackedState) {
    const dom = Array.from(trackedState?.domKeys || []).sort()
      .map((key) => `${key}=${snapshot?.domStateRecords?.get(key) || "absent"}`);
    const scroll = Array.from(trackedState?.scrollKeys || []).sort()
      .map((key) => `${key}=${snapshot?.scrollStateRecords?.get(key) || "absent"}`);
    return hashString(`dom:${dom.join("|")}||scroll:${scroll.join("|")}`);
  }

  function documentOutcomeTrackedStateRestored(current, initial, trackedState) {
    for (const key of trackedState?.domKeys || []) {
      if (current?.domStateRecords?.get(key) !== initial?.domStateRecords?.get(key)) return false;
    }
    for (const key of trackedState?.scrollKeys || []) {
      if (current?.scrollStateRecords?.get(key) !== initial?.scrollStateRecords?.get(key)) return false;
    }
    return true;
  }

  function documentWideOutcomeSnapshot() {
    const elements = documentWideOutcomeElements();
    const elementStateKeys = documentOutcomeElementStateKeys(elements);
    const dom = documentWideDomState(elements, elementStateKeys);
    const scroll = documentWideScrollSignature(elements, elementStateKeys);
    return {
      domSignature: dom.signature,
      scrollSignature: scroll.signature,
      signature: hashString(`${dom.signature}|${scroll.signature}`),
      elementCount: elements.length,
      scrollableElementCount: scroll.scrollableElementCount,
      domStateRecords: dom.stateRecords,
      scrollStateRecords: scroll.stateRecords
    };
  }

  function variantVisualState(ref) {
    const root = ref?.root;
    if (!root) return { rootSelector: "", labels: [], assetUrls: [] };
    let elements = [];
    try {
      elements = Array.from(root.querySelectorAll?.([
        "canvas",
        "model-viewer",
        "[data-model]",
        "[data-model-url]",
        "[aria-label*='illustration' i]",
        "[class*='card']",
        "[class*='slide']"
      ].join(",")) || []);
    } catch {
      elements = [];
    }
    const labels = [];
    const assetUrls = [];
    for (const element of elements.slice(0, 80)) {
      if (!variantElementVisible(element)) continue;
      const label = cleanText(element.getAttribute?.("aria-label") || element.getAttribute?.("title") || element.textContent);
      if (label && label.length <= 240) labels.push(label);
      assetUrls.push(...variantAssetUrlsForElement(element));
    }
    return {
      rootSelector: elementSummary(root).selector,
      labels: Array.from(new Set(labels)).slice(0, 40),
      assetUrls: Array.from(new Set(assetUrls)).slice(0, 80)
    };
  }

  async function recordVariantState(group, state, ref, context = null) {
    if (!state) return null;
    const shouldCaptureVisual = Boolean(context?.captureVariantScreenshots)
      && context?.requireViewport !== false
      && variantControlRefVisibleInViewport(ref);
    let viewportImage = null;
    if (shouldCaptureVisual && viewportCaptureState.status === "ready") {
      viewportImage = await screenshotImageForViewport();
    }
    const snapshot = collectSnapshot(`variant-${group.id}-${state.option.id}`, { force: true });
    let visualScreenshot = null;
    if (shouldCaptureVisual) {
      captureCoverage.variantStateScreenshotPlannedCount += 1;
      visualScreenshot = captureVariantStateScreenshot(group, state, ref, context, snapshot, {
        viewportImage,
        allowCanvasFallback: Boolean(context?.allowCanvasFallback)
      });
    }
    const visualState = variantVisualState(ref);
    const domAssetUrls = Array.from(new Set([
      ...(state.candidate.assetUrls || []),
      ...variantAssetUrlsForElement(state.candidate.element),
      ...visualState.assetUrls
    ].map((url) => normalizeUrl(url)).filter(Boolean)));
    const runtimeAssetUrls = activeRuntimeVariantAssetUrls(snapshot.runtime3D, ref);
    const assetUrls = Array.from(new Set([...domAssetUrls, ...runtimeAssetUrls]));
    const key = variantAssociationKey(group.id, state.option.id, context);
    const existing = variantAssetAssociationMap.get(key);
    const dependencyEdge = context?.parentGroupId && context?.parentOptionId
      ? variantHierarchyMap.get(variantHierarchyKey(
        context.parentGroupId,
        context.parentOptionId,
        group.id,
        context.interactionPath
      ))
      : null;
    const dependencyConfirmed = Boolean(existing?.dependencyConfirmed || dependencyEdge?.confirmed);
    const association = {
      schemaVersion: "storyvr-variant-asset-association/v1",
      groupId: group.id,
      groupTitle: group.title,
      groupDomOrder: group.domOrder,
      optionId: state.option.id,
      optionLabel: state.option.label,
      sourceOrder: state.option.sourceOrder,
      assetUrls: Array.from(new Set([...(existing?.assetUrls || []), ...assetUrls])),
      domAssetUrls: Array.from(new Set([...(existing?.domAssetUrls || []), ...domAssetUrls])),
      runtimeAssetUrls: Array.from(new Set([...(existing?.runtimeAssetUrls || []), ...runtimeAssetUrls])),
      snapshotIds: Array.from(new Set([...(existing?.snapshotIds || []), snapshot.id])),
      capturePhases: Array.from(new Set([
        ...(existing?.capturePhases || []),
        cleanText(context?.explorationPhase) || "manual-visible"
      ])),
      visualEvidenceRefs: Array.from(new Set([
        ...(existing?.visualEvidenceRefs || []),
        visualScreenshot?.evidenceRef || ""
      ].filter(Boolean))),
      source: "collector-verified-variant-interaction",
      interactionKind: ref?.kind || group.control?.kind || "",
      captureStatus: snapshot.runtime3D?.captureStatus || "unavailable",
      activeTexts: (snapshot.activeTexts || []).map((item) => cleanText(item.text)).filter(Boolean),
      visualState: {
        rootSelector: visualState.rootSelector,
        labels: Array.from(new Set([...(existing?.visualState?.labels || []), ...visualState.labels])).slice(0, 40),
        assetUrls: Array.from(new Set([...(existing?.visualState?.assetUrls || []), ...visualState.assetUrls])).slice(0, 80)
      },
      parentGroupId: cleanText(context?.parentGroupId),
      parentOptionId: cleanText(context?.parentOptionId),
      dependencyConfirmed: context?.parentGroupId ? dependencyConfirmed : true,
      interactionPath: [
        ...(Array.isArray(context?.interactionPath) ? context.interactionPath.map((item) => ({ ...item })) : []),
        { groupId: group.id, optionId: state.option.id, optionLabel: state.option.label }
      ],
      relationship: context?.parentGroupId
        ? (dependencyConfirmed ? "visual-child" : "candidate-visual-child")
        : "variant-option"
    };
    variantAssetAssociationMap.set(key, association);
    captureCoverage.variantOptionStateCaptureCount += 1;
    return association;
  }

  async function settleAfterVariantInteraction(settings) {
    await sleep(settings.variantSettleMs);
    await waitForNetworkQuiet({
      networkQuietMs: settings.variantNetworkQuietMs,
      maxWaitMs: settings.variantMaxWaitMs
    });
    await waitForPaint(2);
  }

  function startDocumentWideButtonOutcomeMonitor(settings) {
    const before = documentWideOutcomeSnapshot();
    const attributeNames = new Set();
    const maxWaitMs = Math.max(0, Number(settings.variantMaxWaitMs || 0));
    const quietMs = Math.min(
      maxWaitMs,
      Math.max(0, Number(settings.variantDocumentQuietMs || 0))
    );
    const shadowRootScanIntervalMs = Math.max(10, Math.min(100, quietMs || 100));
    const observationStartedAt = Date.now();
    let mutationCount = 0;
    let scrollEventCount = 0;
    let lastMutationAt = -Infinity;
    let lastScrollAt = -Infinity;
    let mutationObserver = null;
    const scrollEventTargets = [];
    const observedShadowRoots = new Set();
    let lastShadowRootScanAt = -Infinity;
    const observeOptions = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    };
    let finished = false;

    const onScroll = (event) => {
      if (documentOutcomeElementIsProbeOwned(event?.target)) return;
      scrollEventCount += 1;
      lastScrollAt = Date.now();
    };
    const installScrollTarget = (target) => {
      if (scrollEventTargets.includes(target) || typeof target?.addEventListener !== "function") return;
      try {
        target.addEventListener("scroll", onScroll, true);
        scrollEventTargets.push(target);
      } catch {
        // Other observable roots can still be monitored and snapshotted.
      }
    };
    const installShadowRootObservation = (shadowRoot) => {
      if (!shadowRoot || observedShadowRoots.has(shadowRoot)) return false;
      observedShadowRoots.add(shadowRoot);
      try {
        mutationObserver?.observe?.(shadowRoot, observeOptions);
      } catch {
        // Continue observing the main document and other accessible roots.
      }
      installScrollTarget(shadowRoot);
      return true;
    };
    const installOpenShadowRootsFromNode = (node) => {
      let elements = [];
      try {
        elements = [
          ...(node?.nodeType === 1 ? [node] : []),
          ...Array.from(node?.querySelectorAll?.("*") || [])
        ];
      } catch {
        elements = node?.nodeType === 1 ? [node] : [];
      }
      for (const element of elements) {
        try {
          installShadowRootObservation(element.shadowRoot || null);
        } catch {
          // Closed roots remain unavailable to page script.
        }
      }
    };
    const installCurrentOpenShadowRoots = (markActivity = false, force = false) => {
      const now = Date.now();
      if (!force && now - lastShadowRootScanAt < shadowRootScanIntervalMs) return 0;
      lastShadowRootScanAt = now;
      let installedCount = 0;
      for (const element of documentWideOutcomeElements()) {
        try {
          if (installShadowRootObservation(element.shadowRoot || null)) installedCount += 1;
        } catch {
          // Closed roots remain unavailable to page script.
        }
      }
      if (markActivity && installedCount > 0) {
        // attachShadow() on an existing host does not emit a mutation in the
        // light DOM, so discovery itself is observable document activity.
        mutationCount += 1;
        lastMutationAt = now;
      }
      return installedCount;
    };

    const processMutationRecords = (records) => {
      let accepted = 0;
      for (const record of Array.from(records || [])) {
        if (documentOutcomeElementIsProbeOwned(record?.target)) continue;
        accepted += 1;
        if (record?.attributeName) attributeNames.add(cleanText(record.attributeName));
        for (const addedNode of Array.from(record?.addedNodes || [])) installOpenShadowRootsFromNode(addedNode);
      }
      if (!accepted) return;
      mutationCount += accepted;
      lastMutationAt = Date.now();
    };
    const drainMutationRecords = () => {
      try {
        processMutationRecords(mutationObserver?.takeRecords?.() || []);
      } catch {
        // The final state snapshot still provides a safe fallback.
      }
    };
    try {
      const MutationObserverConstructor = window.MutationObserver;
      if (typeof MutationObserverConstructor === "function" && document.documentElement) {
        mutationObserver = new MutationObserverConstructor(processMutationRecords);
        mutationObserver.observe(document.documentElement, observeOptions);
      }
    } catch {
      try {
        mutationObserver?.disconnect?.();
      } catch {
        // The observer was not fully installed.
      }
      mutationObserver = null;
    }
    installScrollTarget(document);
    installScrollTarget(window);
    installCurrentOpenShadowRoots(false, true);

    const channelSettled = (lastActivityAt, activityCount, now) => (
      quietMs === 0
      || now - (activityCount > 0 ? lastActivityAt : observationStartedAt) >= quietMs
    );
    const waitForQuiet = async () => {
      if (quietMs === 0) {
        installCurrentOpenShadowRoots(true, true);
        drainMutationRecords();
        return;
      }
      const deadline = Date.now() + maxWaitMs;
      while (!stopRequested) {
        installCurrentOpenShadowRoots(true);
        drainMutationRecords();
        const now = Date.now();
        const domSettled = channelSettled(lastMutationAt, mutationCount, now);
        const scrollSettled = channelSettled(lastScrollAt, scrollEventCount, now);
        if (domSettled && scrollSettled) return;
        if (now >= deadline) return;
        const remaining = Math.max(1, deadline - now);
        await sleep(Math.min(50, quietMs, remaining));
      }
    };
    const finish = () => {
      if (finished) return null;
      finished = true;
      installCurrentOpenShadowRoots(true, true);
      drainMutationRecords();
      const after = documentWideOutcomeSnapshot();
      // Keep observers attached through the potentially expensive final scan.
      // Any activity during that scan makes the relevant channel unsettled.
      installCurrentOpenShadowRoots(true, true);
      drainMutationRecords();
      try {
        mutationObserver?.disconnect?.();
      } catch {
        // Nothing else is required after the final snapshot.
      }
      if (scrollEventTargets.length) {
        for (const target of scrollEventTargets) {
          try {
            target.removeEventListener?.("scroll", onScroll, true);
          } catch {
            // Continue removing listeners from every other observable root.
          }
        }
      }
      const now = Date.now();
      const domSettled = channelSettled(lastMutationAt, mutationCount, now);
      const scrollSettled = channelSettled(lastScrollAt, scrollEventCount, now);
      const rawDomChanged = before.domSignature !== after.domSignature;
      const rawScrollChanged = before.scrollSignature !== after.scrollSignature;
      const candidateDomStateKeys = rawDomChanged
        ? documentOutcomeChangedStateKeys(before.domStateRecords, after.domStateRecords)
        : [];
      const candidateScrollStateKeys = rawScrollChanged
        ? documentOutcomeChangedScrollStateKeys(before.scrollStateRecords, after.scrollStateRecords)
        : [];
      const outputSettled = domSettled && scrollSettled;
      const domChanged = outputSettled && candidateDomStateKeys.length > 0;
      const scrollChanged = outputSettled && candidateScrollStateKeys.length > 0;
      const changedDomStateKeys = domChanged ? candidateDomStateKeys : [];
      const changedScrollStateKeys = scrollChanged ? candidateScrollStateKeys : [];
      const observation = {
        schemaVersion: "storyvr-document-button-outcome/v1",
        scope: "document",
        changed: domChanged || scrollChanged,
        settled: outputSettled,
        domChanged,
        scrollChanged,
        rawDomChanged,
        rawScrollChanged,
        domSettled,
        scrollSettled,
        beforeSignature: before.signature,
        afterSignature: after.signature,
        beforeDomSignature: before.domSignature,
        afterDomSignature: after.domSignature,
        beforeScrollSignature: before.scrollSignature,
        afterScrollSignature: after.scrollSignature,
        elementCountBefore: before.elementCount,
        elementCountAfter: after.elementCount,
        scrollableElementCountBefore: before.scrollableElementCount,
        scrollableElementCountAfter: after.scrollableElementCount,
        changedDomStateCount: changedDomStateKeys.length,
        changedScrollStateCount: changedScrollStateKeys.length,
        mutationCount,
        scrollEventCount,
        mutatedAttributeNames: Array.from(attributeNames).sort().slice(0, 40)
      };
      Object.defineProperty(observation, "_stateDelta", {
        value: {
          before,
          after,
          changedDomStateKeys,
          changedScrollStateKeys
        },
        enumerable: false
      });
      captureCoverage.variantDocumentWideObservationCount += 1;
      if (observation.changed) captureCoverage.variantDocumentWideChangeCount += 1;
      if (!observation.settled) captureCoverage.variantDocumentWideUnsettledCount += 1;
      captureCoverage.variantDocumentWideMutationCount += mutationCount;
      captureCoverage.variantDocumentWideScrollEventCount += scrollEventCount;
      return observation;
    };
    return { before, waitForQuiet, finish };
  }

  function recordDocumentWideButtonOutcome(interaction, click, details = {}, trackedOutputState = null) {
    if (!interaction || !click?.documentObservation) return;
    if (click.documentObservation.domChanged && !interaction.outputChangeKinds.includes("dom")) {
      interaction.outputChangeKinds.push("dom");
    }
    if (click.documentObservation.scrollChanged && !interaction.outputChangeKinds.includes("scroll")) {
      interaction.outputChangeKinds.push("scroll");
    }
    const stateDelta = click.documentObservation._stateDelta;
    if (trackedOutputState && stateDelta) {
      for (const key of stateDelta.changedDomStateKeys || []) trackedOutputState.domKeys.add(key);
      for (const key of stateDelta.changedScrollStateKeys || []) trackedOutputState.scrollKeys.add(key);
    }
    interaction.outcomeObservations.push({
      ...click.documentObservation,
      optionId: cleanText(details.optionId),
      controlLabel: cleanText(details.controlLabel),
      direction: cleanText(details.direction)
    });
  }

  async function clickVariantControl(control, root, settings, options = {}) {
    if (!variantControlIsSafe(control, root)) return { ok: false, reason: "unsafe-control" };
    if (!options.recovery) {
      if (variantDependencyTransitionCount >= settings.maxVariantDependencyTransitions) {
        captureCoverage.variantDependencyTransitionBudgetReached = true;
        return { ok: false, reason: "transition-budget-reached" };
      }
      variantDependencyTransitionCount += 1;
      captureCoverage.variantDependencyTransitionCount = variantDependencyTransitionCount;
    } else {
      captureCoverage.variantRecoveryTransitionCount += 1;
    }
    const hrefBefore = String(location.href || "");
    const documentMonitor = startDocumentWideButtonOutcomeMonitor(settings);
    let documentObservation = null;
    try {
      control.click();
      await settleAfterVariantInteraction(settings);
      await documentMonitor.waitForQuiet();
    } catch (error) {
      documentObservation = documentMonitor.finish();
      return {
        ok: false,
        reason: `click-failed: ${cleanText(error?.message || error)}`,
        documentObservation
      };
    }
    documentObservation = documentMonitor.finish();
    if (String(location.href || "") !== hrefBefore) {
      return { ok: false, reason: "navigation-detected", documentObservation };
    }
    return { ok: true, reason: "", documentObservation };
  }

  async function restoreVariantState(
    group,
    ref,
    initialOptionId,
    settings,
    initialOutputState = null,
    trackedOutputState = null,
    initialVisualEvidenceSignature = ""
  ) {
    let state = currentVariantState(group, ref);
    const hasTrackedDocumentOutput = Boolean(
      trackedOutputState?.domKeys?.size
      || trackedOutputState?.scrollKeys?.size
    );
    const restored = async () => {
      const current = currentVariantState(group, ref);
      if (!hasTrackedDocumentOutput && !initialVisualEvidenceSignature && current?.option.id !== initialOptionId) return false;
      if (initialOutputState && trackedOutputState) {
        const currentOutputState = documentWideOutcomeSnapshot();
        if (!documentOutcomeTrackedStateRestored(currentOutputState, initialOutputState, trackedOutputState)) return false;
      }
      if (initialVisualEvidenceSignature) {
        const currentVisualEvidence = await stableDocumentVisualEvidenceSignature(settings.variantVisualStabilitySampleMs);
        if (currentVisualEvidence !== initialVisualEvidenceSignature) return false;
      }
      return true;
    };
    if (await restored()) return true;
    const restorationCandidates = state?.candidates || (
      ref.kind === "button-cluster"
        ? variantButtonOptionCandidates(ref.controlRoot)
        : variantOptionCandidates(ref.root)
    );
    const initialCandidate = restorationCandidates.find((candidate) => (
      optionForVariantCandidate(group, candidate)?.id === initialOptionId
    ));
    if (["semantic", "button-cluster"].includes(ref.kind) && semanticVariantCandidateIsSafe(initialCandidate, ref.root)) {
      await clickVariantControl(initialCandidate.element, ref.root, settings, { recovery: true });
      return restored();
    }
    if (ref.kind === "previous-next" && variantControlIsSafe(ref.previous, ref.root)) {
      for (let index = 0; index < settings.maxVariantOptions && !stopRequested; index += 1) {
        const result = await clickVariantControl(ref.previous, ref.root, settings, { recovery: true });
        if (!result.ok) return false;
        refreshVariantGroupRef(group, ref);
        if (await restored()) return true;
      }
      if (variantControlIsSafe(ref.next, ref.root)) {
        for (let index = 0; index < settings.maxVariantOptions && !stopRequested; index += 1) {
          const result = await clickVariantControl(ref.next, ref.root, settings, { recovery: true });
          if (!result.ok) return false;
          refreshVariantGroupRef(group, ref);
          if (await restored()) return true;
        }
      }
    }
    return false;
  }

  function variantExplorationKey(group, context) {
    const pathSignature = (Array.isArray(context?.interactionPath) ? context.interactionPath : [])
      .map((item) => `${cleanText(item?.groupId)}=${cleanText(item?.optionId)}`)
      .filter((value) => value !== "=")
      .join(">");
    return [
      group.id,
      cleanText(context?.parentGroupId),
      cleanText(context?.parentOptionId),
      pathSignature,
      cleanText(context?.explorationPhase) || "manual-visible",
      cleanText(context?.viewportAlignment)
    ].join("::");
  }

  async function exploreNestedVariantGroups(
    parentGroup,
    parentState,
    parentRef,
    settings,
    context,
    baselineObservations = null
  ) {
    if (!parentRef?.root || !parentState) return [];
    const depth = Number(context?.dependencyDepth || 0);
    if (depth >= MAX_VARIANT_DEPENDENCY_DEPTH) {
      captureCoverage.variantDependencyCycleGuardCount += 1;
      return [];
    }
    const observations = variantControlObservations(parentGroup.id);
    const interactions = [];
    const candidateGroupIds = new Set([
      ...(baselineObservations?.keys?.() || []),
      ...observations.keys()
    ]);
    for (const childGroupId of candidateGroupIds) {
      const previous = baselineObservations?.get(childGroupId) || null;
      const observation = observations.get(childGroupId) || null;
      const childGroup = observation?.group || previous?.group;
      const childRef = observation?.ref || previous?.ref;
      if (stopRequested || childGroup.id === parentGroup.id) continue;
      if (!childRef?.root || childRef.root === parentRef.root) continue;
      const relationship = variantRootRelationship(parentRef.root, childRef.root, parentRef, childRef);
      const changeKinds = baselineObservations
        ? variantObservationChangeKinds(previous, observation)
        : [];
      const stateChanged = changeKinds.length > 0;
      const explicitlyTargeted = variantOptionExplicitlyTargetsChild(parentState, childRef);
      // Container/sibling proximity only scopes a candidate. It never proves
      // hierarchy without a causal delta or an explicit control target.
      if (!stateChanged && !explicitlyTargeted) continue;
      if (!relationship && !explicitlyTargeted) continue;
      captureCoverage.variantDependencyObservationCount += 1;
      // A control that disappears under this option is evidence about the
      // transition, not a child that belongs to the resulting option state.
      if (!observation && !explicitlyTargeted) {
        captureCoverage.variantDependencyRejectedCount += 1;
        continue;
      }
      if (variantHierarchyWouldCycle(parentGroup.id, childGroup.id, context)) {
        captureCoverage.variantDependencyCycleGuardCount += 1;
        variantDependencyCycles.push({
          parentGroupId: parentGroup.id,
          parentOptionId: parentState.option.id,
          childGroupId: childGroup.id,
          explorationPhase: cleanText(context?.explorationPhase),
          reason: "dfs-cycle-guard"
        });
        continue;
      }
      recordVariantHierarchy(
        parentGroup,
        parentState,
        childGroup,
        childRef,
        context,
        relationship,
        { stateChanged, explicitlyTargeted, changeKinds }
      );
      if (!observation) continue;
      const interactionPath = [
        ...(Array.isArray(context?.interactionPath) ? context.interactionPath : []),
        { groupId: parentGroup.id, optionId: parentState.option.id, optionLabel: parentState.option.label }
      ];
      const interaction = await exploreVariantGroup(childGroup, childRef, settings, {
        parentGroupId: parentGroup.id,
        parentOptionId: parentState.option.id,
        interactionPath,
        explorationPhase: cleanText(context?.explorationPhase),
        viewportAlignment: cleanText(context?.viewportAlignment),
        // A changed child is explored immediately while its parent context is
        // active, even when the child's controls are just outside the viewport.
        // Screenshot capture remains viewport-gated inside recordVariantState.
        requireViewport: false,
        captureVariantScreenshots: Boolean(context?.captureVariantScreenshots),
        allowCanvasFallback: Boolean(context?.allowCanvasFallback),
        dependencyDepth: depth + 1
      });
      if (interaction) interactions.push(interaction);
    }
    return interactions;
  }

  async function exploreVariantGroup(group, ref, settings, context = null) {
    const explorationKey = variantExplorationKey(group, context);
    const requireViewport = context?.requireViewport !== false;
    if (!ref || exploredVariantGroupIds.has(explorationKey)) return null;
    if (requireViewport && !variantControlRefVisibleInViewport(ref)) return null;
    if (!variantElementVisible(ref.root)) return null;
    const initialState = currentVariantState(group, ref);
    if (!initialState) return null;
    const initialVisualEvidenceSignature = ref.kind === "previous-next"
      ? await stableDocumentVisualEvidenceSignature(settings.variantVisualStabilitySampleMs)
      : "";
    const initialOutputState = documentWideOutcomeSnapshot();
    const trackedOutputState = { domKeys: new Set(), scrollKeys: new Set() };
    const interaction = {
      schemaVersion: "storyvr-variant-interaction/v2",
      groupId: group.id,
      groupTitle: group.title,
      controlKind: group.control?.kind || ref.kind,
      parentGroupId: cleanText(context?.parentGroupId),
      parentOptionId: cleanText(context?.parentOptionId),
      explorationPhase: cleanText(context?.explorationPhase) || "manual-visible",
      viewportAlignment: cleanText(context?.viewportAlignment),
      interactionPath: Array.isArray(context?.interactionPath) ? context.interactionPath.map((item) => ({ ...item })) : [],
      initialOptionId: initialState.option.id,
      outcomeObservationScope: "document",
      initialOutputSignature: initialOutputState.signature,
      initialDomSignature: initialOutputState.domSignature,
      initialScrollSignature: initialOutputState.scrollSignature,
      initialVisualEvidenceSignature,
      attemptedOptionIds: [],
      capturedOptionIds: [],
      outputChangeKinds: [],
      outcomeObservations: [],
      restored: false,
      failures: []
    };
    exploredVariantGroupIds.add(explorationKey);
    snapshotLimit = Math.min(ABSOLUTE_MAX_SNAPSHOTS, Math.max(
      snapshotLimit,
      snapshots.length + Math.min(settings.maxVariantOptions, group.options.length) + 4
    ));
    captureCoverage.snapshotLimit = snapshotLimit;

    await recordVariantState(group, initialState, ref, context);
    interaction.capturedOptionIds.push(initialState.option.id);
    const seen = new Set(interaction.capturedOptionIds);
    if (["semantic", "button-cluster"].includes(ref.kind)) {
      await exploreNestedVariantGroups(group, initialState, ref, settings, context);
    }

    if (["semantic", "button-cluster"].includes(ref.kind)) {
      for (const option of group.options.slice(0, settings.maxVariantOptions)) {
        if (stopRequested || seen.has(option.id)) continue;
        const state = currentVariantState(group, ref);
        const candidate = state?.candidates.find((item) => optionForVariantCandidate(group, item)?.id === option.id);
        interaction.attemptedOptionIds.push(option.id);
        captureCoverage.variantClickAttemptCount += 1;
        console.info(`[NYTAnimationProbe] variant click: ${group.title} -> ${option.label}`);
        if (!semanticVariantCandidateIsSafe(candidate, ref.root)) {
          interaction.failures.push({ optionId: option.id, reason: "unsafe-or-noninteractive-option" });
          console.warn(`[NYTAnimationProbe] variant click skipped: ${group.title} -> ${option.label} (unsafe-or-noninteractive-option)`);
          continue;
        }
        const nestedBefore = variantControlObservations(group.id);
        const click = await clickVariantControl(candidate.element, ref.root, settings);
        recordDocumentWideButtonOutcome(interaction, click, {
          optionId: option.id,
          controlLabel: option.label
        }, trackedOutputState);
        let active = currentVariantState(group, ref);
        const outputChanged = Boolean(click.documentObservation?.changed);
        if (active?.option.id !== option.id && outputChanged) {
          active = expectedVariantState(group, ref, option, candidate);
        }
        const failureReason = click.reason || "output-state-did-not-change";
        if (!click.ok || !outputChanged) {
          interaction.failures.push({ optionId: option.id, reason: failureReason });
          console.warn(`[NYTAnimationProbe] variant click failed: ${group.title} -> ${option.label} (${failureReason})`);
          continue;
        }
        captureCoverage.variantClickSuccessCount += 1;
        console.info(`[NYTAnimationProbe] variant click captured: ${group.title} -> ${option.label}`);
        await recordVariantState(group, active, ref, context);
        seen.add(active.option.id);
        interaction.capturedOptionIds.push(active.option.id);
        await exploreNestedVariantGroups(group, active, ref, settings, context, nestedBefore);
      }
    } else if (ref.kind === "previous-next") {
      if (!variantControlIsSafe(ref.next, ref.root) || !variantControlIsSafe(ref.previous, ref.root)) {
        interaction.failures.push({ optionId: "", reason: "unsafe-previous-next-controls" });
      } else {
        const directionalSignatureKey = (discreteSignature, visualSignature) => (
          `${cleanText(discreteSignature)}|visual:${cleanText(visualSignature)}`
        );
        const seenOutputStates = [{
          snapshot: initialOutputState,
          visualSignature: interaction.initialVisualEvidenceSignature
        }];
        const exploreDirection = async (direction, label) => {
          let logicalState = currentVariantState(group, ref);
          for (let index = 1; index < settings.maxVariantOptions && !stopRequested; index += 1) {
            refreshVariantGroupRef(group, ref);
            const control = direction === "previous" ? ref.previous : ref.next;
            if (!variantControlIsSafe(control, ref.root)) break;
            const observedBefore = currentVariantState(group, ref);
            const before = logicalState || observedBefore;
            const localStateWasAligned = Boolean(
              observedBefore?.option?.id
              && observedBefore.option.id === before?.option?.id
            );
            const beforeVisualEvidence = await stableDocumentVisualEvidenceSignature(settings.variantVisualStabilitySampleMs);
            const nestedBefore = variantControlObservations(group.id);
            captureCoverage.variantClickAttemptCount += 1;
            console.info(`[NYTAnimationProbe] variant click: ${group.title} -> ${label}`);
            const click = await clickVariantControl(control, ref.root, settings);
            refreshVariantGroupRef(group, ref);
            let active = currentVariantState(group, ref);
            const afterOutputState = click.documentObservation?._stateDelta?.after || documentWideOutcomeSnapshot();
            const afterVisualEvidence = await stableDocumentVisualEvidenceSignature(settings.variantVisualStabilitySampleMs);
            const documentOutputChanged = Boolean(click.documentObservation?.changed);
            const stableVisualOutputChanged = Boolean(
              beforeVisualEvidence
              && afterVisualEvidence
              && beforeVisualEvidence !== afterVisualEvidence
            );
            const outputChanged = documentOutputChanged || stableVisualOutputChanged;
            if (outputChanged && (!active || !localStateWasAligned || active?.option.id === before?.option.id)) {
              active = directionalNeighborState(group, ref, before, direction);
            }
            if (outputChanged && !active) active = before;
            recordDocumentWideButtonOutcome(interaction, click, {
              optionId: active?.option?.id || "",
              controlLabel: label,
              direction
            }, trackedOutputState);
            interaction.attemptedOptionIds.push(active?.option.id || "");
            if (!click.ok || !outputChanged) {
              interaction.failures.push({ optionId: active?.option.id || "", reason: click.reason || "output-state-did-not-change" });
              console.warn(`[NYTAnimationProbe] variant click failed: ${group.title} -> ${label} (${click.reason || "output-state-did-not-change"})`);
              break;
            }
            logicalState = active;
            captureCoverage.variantClickSuccessCount += 1;
            const afterSignatureKey = directionalSignatureKey(
              documentOutcomeProjectionSignature(afterOutputState, trackedOutputState),
              afterVisualEvidence
            );
            const cycleDetected = seenOutputStates.some((state) => directionalSignatureKey(
              documentOutcomeProjectionSignature(state.snapshot, trackedOutputState),
              state.visualSignature
            ) === afterSignatureKey);
            if (cycleDetected) {
              console.info(`[NYTAnimationProbe] variant cycle detected: ${group.title} -> ${active.option.label}`);
              break;
            }
            seenOutputStates.push({ snapshot: afterOutputState, visualSignature: afterVisualEvidence });
            console.info(`[NYTAnimationProbe] variant click captured: ${group.title} -> ${active.option.label}`);
            await recordVariantState(group, active, ref, context);
            if (!seen.has(active.option.id)) {
              seen.add(active.option.id);
              interaction.capturedOptionIds.push(active.option.id);
            }
            await exploreNestedVariantGroups(group, active, ref, settings, context, nestedBefore);
            if (seen.size >= settings.maxVariantOptions) break;
          }
        };

        await exploreDirection("next", group.control?.nextLabel || "Next option");
        await restoreVariantState(
          group,
          ref,
          interaction.initialOptionId,
          settings,
          initialOutputState,
          trackedOutputState,
          interaction.initialVisualEvidenceSignature
        );
        await exploreDirection("previous", group.control?.previousLabel || "Previous option");
      }
    }

    const nestedBeforeRestore = ["semantic", "button-cluster"].includes(ref.kind)
      ? variantControlObservations(group.id)
      : null;
    interaction.restored = await restoreVariantState(
      group,
      ref,
      interaction.initialOptionId,
      settings,
      initialOutputState,
      trackedOutputState,
      interaction.initialVisualEvidenceSignature
    );
    if (!interaction.restored) {
      interaction.failures.push({ optionId: interaction.initialOptionId, reason: "initial-selection-not-restored" });
      captureCoverage.variantRestorationFailureCount += 1;
    } else if (nestedBeforeRestore) {
      const restoredState = currentVariantState(group, ref);
      if (restoredState) {
        await exploreNestedVariantGroups(group, restoredState, ref, settings, context, nestedBeforeRestore);
      }
    }
    if (interaction.failures.length) captureCoverage.variantExplorationFailureCount += interaction.failures.length;
    captureCoverage.variantGroupExploredCount += 1;
    captureCoverage.variantExplorationPassCount += 1;
    captureCoverage.variantUniqueGroupExploredCount = new Set(variantInteractionRecords.map((item) => item.groupId).concat(group.id)).size;
    if (interaction.explorationPhase.endsWith("-eager")) captureCoverage.variantEagerPassCount += 1;
    if (interaction.viewportAlignment) captureCoverage.variantViewportAlignedPassCount += 1;
    variantInteractionRecords.push(interaction);
    return interaction;
  }

  async function exploreVisibleVariantGroups(options = {}) {
    const groups = collectStoryVrVariantGroups(collectStoryVrHeadings());
    const orderedGroups = [...groups].sort((left, right) => {
      const leftRoot = variantGroupRuntimeRefs.get(left.id)?.root;
      const rightRoot = variantGroupRuntimeRefs.get(right.id)?.root;
      if (leftRoot && rightRoot && leftRoot !== rightRoot) {
        if (leftRoot.contains?.(rightRoot)) return -1;
        if (rightRoot.contains?.(leftRoot)) return 1;
      }
      return Number(left.domOrder || 0) - Number(right.domOrder || 0);
    });
    const settings = {
      maxVariantOptions: Number.isInteger(options.maxVariantOptions) && options.maxVariantOptions > 0
        ? Math.min(MAX_VARIANT_OPTIONS_PER_GROUP, options.maxVariantOptions)
        : MAX_VARIANT_OPTIONS_PER_GROUP,
      maxVariantDependencyTransitions: Number.isInteger(options.maxVariantDependencyTransitions)
        ? Math.max(1, Math.min(MAX_VARIANT_DEPENDENCY_TRANSITIONS, options.maxVariantDependencyTransitions))
        : MAX_VARIANT_DEPENDENCY_TRANSITIONS,
      variantSettleMs: Number.isFinite(options.variantSettleMs) ? Math.max(0, options.variantSettleMs) : 350,
      variantNetworkQuietMs: Number.isFinite(options.variantNetworkQuietMs) ? Math.max(0, options.variantNetworkQuietMs) : 350,
      variantMaxWaitMs: Number.isFinite(options.variantMaxWaitMs) ? Math.max(0, options.variantMaxWaitMs) : 2500,
      variantDocumentQuietMs: Number.isFinite(options.variantDocumentQuietMs)
        ? Math.max(0, Math.min(1000, options.variantDocumentQuietMs))
        : 180,
      variantVisualStabilitySampleMs: Number.isFinite(options.variantVisualStabilitySampleMs)
        ? Math.max(0, Math.min(500, options.variantVisualStabilitySampleMs))
        : 80
    };
    captureCoverage.variantDependencyTransitionBudget = settings.maxVariantDependencyTransitions;
    const targetGroupIds = new Set(Array.isArray(options.targetGroupIds) ? options.targetGroupIds.map(cleanText).filter(Boolean) : []);
    const context = {
      explorationPhase: cleanText(options.explorationPhase) || "manual-visible",
      viewportAlignment: cleanText(options.viewportAlignment),
      requireViewport: options.requireViewport !== false,
      captureVariantScreenshots: Boolean(options.captureVariantScreenshots),
      allowCanvasFallback: Boolean(options.allowCanvasFallback),
      dependencyDepth: Number(options.dependencyDepth || 0)
    };
    const interactions = [];
    for (const group of orderedGroups) {
      if (stopRequested) break;
      if (targetGroupIds.size && !targetGroupIds.has(group.id)) continue;
      const interaction = await exploreVariantGroup(group, variantGroupRuntimeRefs.get(group.id), settings, context);
      if (interaction) interactions.push(interaction);
    }
    return interactions;
  }

  async function exploreVariants(options = {}) {
    stopRequested = false;
    return exploreVisibleVariantGroups({
      ...options,
      explorationPhase: cleanText(options.explorationPhase) || "manual-visible",
      requireViewport: options.requireViewport === true
    });
  }

  function collectStoryVrAuthorInputSeed(candidateResources, domAssetReferences, imageGroups = [], headings = []) {
    const imageAssets = imageGroups.flatMap((group) => (
      imageGroupUrls(group).map((url) => ({
        url,
        assetType: "image",
        sourceType: "image_group",
        sourceImageGroupId: group.id,
        candidate: true
      }))
    ));
    const assets = [...candidateResources, ...domAssetReferences]
      .filter((entry) => ["model", "script", "data", "model-binary"].includes(entry.assetType))
      .map((entry) => ({
        url: entry.url,
        assetType: entry.assetType,
        sourceType: entry.sourceType || entry.initiatorType || "",
        candidate: entry.candidate !== false
      }))
      .concat(imageAssets);
    return {
      schemaVersion: "storyvr-author-input-seed/v1",
      story: {
        url: location.href,
        slug: getStorySlug(),
        title: document.title || ""
      },
      headings,
      image_groups: imageGroups,
      text_units: collectStoryVrTextUnits(imageGroups),
      asset_candidates: assets
    };
  }

  function logProgress(phase, extra = {}) {
    const summary = progressSummary();
    const details = [
      `scroll=${scrollProgressPercent()}%`,
      `resources=${summary.resources}`,
      `candidates=${summary.candidates}`,
      `models=${summary.models}`,
      `snapshots=${summary.snapshots}`
    ];
    if (Number.isInteger(extra.step)) {
      details.unshift(Number.isInteger(extra.maxSteps) ? `step=${extra.step}/${extra.maxSteps}` : `step=${extra.step}`);
    }
    console.info(`[NYTAnimationProbe] ${phase}: ${details.join(" ")}`);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForPaint(frameCount = 2) {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => {
        if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
      });
    }
  }

  async function waitForNetworkQuiet(options = {}) {
    const networkQuietMs = Number.isFinite(options.networkQuietMs) ? options.networkQuietMs : 1200;
    const maxWaitMs = Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 8000;
    const startedAt = performance.now();

    while (!stopRequested) {
      seedPerformanceEntries();
      const quietFor = performance.now() - lastResourceAt;
      if (quietFor >= networkQuietMs && document.readyState === "complete") return true;
      if (performance.now() - startedAt >= maxWaitMs) return false;
      await sleep(250);
    }
    return false;
  }

  function resetVariantTraversalState() {
    variantGroupRuntimeRefs.clear();
    variantGroupRegistry.clear();
    exploredVariantGroupIds.clear();
    nestedVariantGroupIds.clear();
    variantInteractionRecords.length = 0;
    variantAssetAssociationMap.clear();
    variantHierarchyMap.clear();
    variantDependencyCycles.length = 0;
    variantRecoveryBaselines.clear();
    scrollTraversalRecords.length = 0;
    variantDependencyTransitionCount = 0;
  }

  function traversalRecord(phase, direction, targetIndex, targetY, targetKind, extra = {}) {
    const record = {
      phase,
      direction,
      targetIndex,
      targetY: Math.round(Number(targetY || 0)),
      targetKind,
      ...extra
    };
    if (scrollTraversalRecords.length < 6000) scrollTraversalRecords.push(record);
    return record;
  }

  function recoveryBaselineForTarget(targetY) {
    const observations = variantControlObservations();
    const serialized = serializableVariantObservationMap(observations);
    variantRecoveryBaselines.set(Math.round(Number(targetY || 0)), serialized);
    return serialized;
  }

  function recoveryMismatchGroupIds(baseline, current) {
    // Controls mounted by lazy loading after an earlier baseline are not a
    // recovery failure by themselves. At each station, verify every control
    // that existed in that station's forward baseline and ignore new extras.
    return Object.keys(baseline || {}).filter((groupId) => (
      cleanText(baseline?.[groupId]?.signature) !== cleanText(current?.[groupId]?.signature)
    ));
  }

  async function autoScroll(options = {}) {
    stopRequested = false;
    scrollTargetScreenshots.length = 0;
    scrollTargetContactSheets.length = 0;
    variantStateScreenshots.length = 0;
    resetVariantTraversalState();
    snapshotLimit = Math.max(MAX_SNAPSHOTS, snapshots.length + 24);
    Object.assign(captureCoverage, {
      strategy: "two-top-to-bottom-passes-with-progressive-recovery/v3",
      detectedBeatTargetCount: 0,
      plannedScrollTargetCount: 0,
      visitedScrollTargetCount: 0,
      beatChangeSnapshotCount: 0,
      screenshotPlannedCount: 0,
      screenshotCaptureCount: 0,
      screenshotFailureCount: 0,
      viewportScreenshotCaptureCount: 0,
      canvasFallbackCaptureCount: 0,
      canvasCropCaptureCount: 0,
      startingSnapshotCount: snapshots.length,
      snapshotLimit,
      reachedSnapshotLimit: false,
      skippedScrollTargetCount: 0,
      stoppedEarly: false,
      documentGrowthDetected: false,
      variantGroupDetectedCount: 0,
      variantGroupExploredCount: 0,
      nestedVariantGroupCount: 0,
      variantHierarchyCount: 0,
      variantOptionStateCaptureCount: 0,
      variantClickAttemptCount: 0,
      variantClickSuccessCount: 0,
      variantDocumentWideObservationCount: 0,
      variantDocumentWideChangeCount: 0,
      variantDocumentWideMutationCount: 0,
      variantDocumentWideScrollEventCount: 0,
      variantDocumentWideUnsettledCount: 0,
      variantExplorationFailureCount: 0,
      variantRestorationFailureCount: 0,
      variantUniqueGroupExploredCount: 0,
      variantExplorationPassCount: 0,
      variantEagerPassCount: 0,
      variantViewportAlignedPassCount: 0,
      variantControlTargetCount: 0,
      variantStateScreenshotPlannedCount: 0,
      variantStateScreenshotCaptureCount: 0,
      variantStateScreenshotFailureCount: 0,
      activePassCount: 0,
      pass1PlannedTargetCount: 0,
      pass1VisitedTargetCount: 0,
      recoveryPlannedTargetCount: 0,
      recoveryVisitedTargetCount: 0,
      recoveryMismatchCount: 0,
      recoveryMismatchedTargetCount: 0,
      recoveryTopMismatchCount: 0,
      recoveryStatus: "not-run",
      recoveryRepairAttemptCount: 0,
      recoveryRepairFailureCount: 0,
      pass2PlannedTargetCount: 0,
      pass2VisitedTargetCount: 0,
      pass2SkippedReason: "",
      variantDependencyObservationCount: 0,
      variantDependencyConfirmedCount: 0,
      variantDependencyRejectedCount: 0,
      variantDependencyCycleGuardCount: 0,
      variantDependencyTransitionBudget: MAX_VARIANT_DEPENDENCY_TRANSITIONS,
      variantDependencyTransitionCount: 0,
      variantRecoveryTransitionCount: 0,
      variantDependencyTransitionBudgetReached: false
    });
    startObserver();
    installRuntime3DInstrumentation();

    const settings = {
      stepRatio: Number.isFinite(options.stepRatio) ? options.stepRatio : 0.55,
      minStepPx: Number.isFinite(options.minStepPx) ? options.minStepPx : 360,
      maxStepPx: Number.isFinite(options.maxStepPx) ? options.maxStepPx : 900,
      settleMs: Number.isFinite(options.settleMs) ? options.settleMs : 950,
      networkQuietMs: Number.isFinite(options.networkQuietMs) ? options.networkQuietMs : 1200,
      maxWaitMs: Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 9000,
      driverSampleGapMs: Number.isFinite(options.driverSampleGapMs) ? Math.max(0, options.driverSampleGapMs) : 220,
      maxSteps: Number.isInteger(options.maxSteps) && options.maxSteps > 0 ? options.maxSteps : null,
      returnToTop: Boolean(options.returnToTop),
      captureScreenshots: options.captureScreenshots !== false,
      allowCanvasFallback: Boolean(options.allowCanvasFallback),
      exploreVariants: options.exploreVariants !== false,
      maxVariantOptions: Number.isInteger(options.maxVariantOptions) ? options.maxVariantOptions : MAX_VARIANT_OPTIONS_PER_GROUP,
      maxVariantDependencyTransitions: Number.isInteger(options.maxVariantDependencyTransitions)
        ? Math.max(1, Math.min(MAX_VARIANT_DEPENDENCY_TRANSITIONS, options.maxVariantDependencyTransitions))
        : MAX_VARIANT_DEPENDENCY_TRANSITIONS,
      variantSettleMs: Number.isFinite(options.variantSettleMs) ? options.variantSettleMs : 350,
      variantNetworkQuietMs: Number.isFinite(options.variantNetworkQuietMs) ? options.variantNetworkQuietMs : 350,
      variantMaxWaitMs: Number.isFinite(options.variantMaxWaitMs) ? options.variantMaxWaitMs : 2500,
      variantDocumentQuietMs: Number.isFinite(options.variantDocumentQuietMs)
        ? Math.max(0, Math.min(1000, options.variantDocumentQuietMs))
        : 180,
      variantVisualStabilitySampleMs: Number.isFinite(options.variantVisualStabilitySampleMs)
        ? Math.max(0, Math.min(500, options.variantVisualStabilitySampleMs))
        : 80
    };
    captureCoverage.variantDependencyTransitionBudget = settings.maxVariantDependencyTransitions;

    if (settings.captureScreenshots && viewportCaptureState.status !== "ready" && !settings.allowCanvasFallback) {
      installViewportCapturePrompt();
      throw new Error("Full-page capture is not enabled. Click the StoryVR capture button and choose This Tab, or explicitly use allowCanvasFallback: true.");
    }

    console.info("[NYTAnimationProbe] Two-pass auto-scroll started. Run NYTAnimationProbe.stop() to cancel.");
    window.scrollTo({ top: 0, behavior: "auto" });
    await sleep(settings.settleMs);
    await waitForNetworkQuiet(settings);
    collectStoryVrVariantGroups(collectStoryVrHeadings());

    let maxY = Math.max(0, documentHeight() - window.innerHeight);
    const stepPx = Math.max(
      settings.minStepPx,
      Math.min(settings.maxStepPx, Math.floor(window.innerHeight * settings.stepRatio))
    );

    const buildPassPlan = (alignment) => {
      const controlTargetMap = new Map();
      const knownControlKeys = new Set();
      const addControlTargets = (records) => {
        const addedYs = [];
        for (const record of records || []) {
          const unseenGroupIds = (record.groupIds || []).filter((groupId) => {
            const key = `${groupId}:${record.alignment}:${Math.round(Number(record.y || 0) / 12)}`;
            if (knownControlKeys.has(key)) return false;
            knownControlKeys.add(key);
            return true;
          });
          if (!unseenGroupIds.length) continue;
          const target = controlTargetMap.get(record.y) || { y: record.y, passes: [] };
          target.passes.push({ alignment: record.alignment, groupIds: unseenGroupIds });
          controlTargetMap.set(record.y, target);
          captureCoverage.variantControlTargetCount += 1;
          addedYs.push(record.y);
        }
        return addedYs;
      };
      const domTargetSet = new Set(storyBeatScrollTargets(maxY));
      addControlTargets(storyVariantControlScrollTargets(maxY, alignment));
      const gridTargets = [0];
      for (let value = stepPx; value < maxY; value += stepPx) gridTargets.push(Math.round(value));
      if (maxY > 0) gridTargets.push(maxY);
      let plannedTargets = Array.from(new Set([
        ...gridTargets,
        ...domTargetSet,
        ...controlTargetMap.keys()
      ])).sort((left, right) => left - right);
      const unlimitedCount = plannedTargets.length;
      if (Number.isInteger(settings.maxSteps) && plannedTargets.length > settings.maxSteps) {
        plannedTargets = plannedTargets.slice(0, settings.maxSteps);
      }
      return { alignment, controlTargetMap, domTargetSet, addControlTargets, plannedTargets, unlimitedCount };
    };

    const targetKindForPlan = (plan, targetY) => {
      const controlTarget = plan.controlTargetMap.get(targetY) || null;
      if (controlTarget) return `variant-control-${plan.alignment}`;
      return plan.domTargetSet.has(targetY) ? "dom-beat" : "grid";
    };

    const pass1 = buildPassPlan("bottom");
    captureCoverage.activePassCount = 1;
    captureCoverage.detectedBeatTargetCount = pass1.domTargetSet.size;
    captureCoverage.plannedScrollTargetCount = pass1.plannedTargets.length;
    captureCoverage.pass1PlannedTargetCount = pass1.plannedTargets.length;
    captureCoverage.screenshotPlannedCount = settings.captureScreenshots ? pass1.plannedTargets.length : 0;
    if (pass1.unlimitedCount > pass1.plannedTargets.length) {
      captureCoverage.skippedScrollTargetCount += pass1.unlimitedCount - pass1.plannedTargets.length;
      captureCoverage.stoppedEarly = true;
    }
    snapshotLimit = Math.min(
      ABSOLUTE_MAX_SNAPSHOTS,
      Math.max(MAX_SNAPSHOTS, snapshots.length + pass1.plannedTargets.length * 6 + 48)
    );
    captureCoverage.snapshotLimit = snapshotLimit;

    for (let targetIndex = 0; targetIndex < pass1.plannedTargets.length && !stopRequested; targetIndex += 1) {
      if (snapshots.length >= snapshotLimit) {
        captureCoverage.reachedSnapshotLimit = true;
        captureCoverage.skippedScrollTargetCount += pass1.plannedTargets.length - targetIndex;
        break;
      }
      const targetY = pass1.plannedTargets[targetIndex];
      const targetKind = targetKindForPlan(pass1, targetY);
      window.scrollTo({ top: targetY, behavior: "auto" });
      await sleep(settings.settleMs);
      await waitForNetworkQuiet(settings);
      await waitForPaint(2);
      collectStoryVrVariantGroups(collectStoryVrHeadings());
      recoveryBaselineForTarget(targetY);
      const viewportImage = settings.captureScreenshots ? await screenshotImageForViewport() : null;
      collectSnapshot(`pass-1-discovery-${String(targetIndex + 1).padStart(4, "0")}`, {
        force: true,
        scrollTarget: settings.captureScreenshots ? {
          index: targetIndex,
          y: targetY,
          kind: targetKind,
          phase: "pass-1-discovery",
          direction: "top-to-bottom"
        } : null,
        viewportImage,
        allowCanvasFallback: settings.allowCanvasFallback
      });
      traversalRecord("pass-1-discovery", "top-to-bottom", targetIndex, targetY, targetKind);

      if (settings.exploreVariants) {
        // Document-wide safe probing remains part of Pass 1 so already-mounted
        // offscreen controls can reveal dependencies before their aligned visit.
        await exploreVisibleVariantGroups({
          ...settings,
          explorationPhase: "pass-1-discovery-eager",
          requireViewport: false,
          captureVariantScreenshots: false
        });
        const controlTarget = pass1.controlTargetMap.get(targetY) || null;
        for (const controlPass of controlTarget?.passes || []) {
          await exploreVisibleVariantGroups({
            ...settings,
            targetGroupIds: controlPass.groupIds,
            includeNestedTargets: true,
            explorationPhase: "pass-1-discovery",
            viewportAlignment: "bottom",
            requireViewport: true,
            captureVariantScreenshots: settings.captureScreenshots || settings.allowCanvasFallback
          });
        }
      }
      captureCoverage.visitedScrollTargetCount += 1;
      captureCoverage.pass1VisitedTargetCount += 1;
      if (settings.driverSampleGapMs > 0) {
        await sleep(settings.driverSampleGapMs);
        collectSnapshot(`pass-1-discovery-${String(targetIndex + 1).padStart(4, "0")}-stationary`, { force: true });
      }
      logProgress("pass-1-discovery", { step: targetIndex + 1, maxSteps: pass1.plannedTargets.length });

      const discoveredControlYs = pass1.addControlTargets(storyVariantControlScrollTargets(maxY, "bottom"));
      const newControlTargets = Array.from(new Set(discoveredControlYs))
        .filter((value) => value > targetY + 2 && !pass1.plannedTargets.includes(value));
      if (!Number.isInteger(settings.maxSteps) && newControlTargets.length) {
        pass1.plannedTargets.push(...newControlTargets);
        pass1.plannedTargets.sort((left, right) => left - right);
        captureCoverage.plannedScrollTargetCount = pass1.plannedTargets.length;
        captureCoverage.pass1PlannedTargetCount = pass1.plannedTargets.length;
        if (settings.captureScreenshots) captureCoverage.screenshotPlannedCount = pass1.plannedTargets.length;
      }

      const grownMaxY = Math.max(0, documentHeight() - window.innerHeight);
      if (grownMaxY > maxY + Math.max(120, stepPx / 2)) {
        captureCoverage.documentGrowthDetected = true;
        const previousMaxY = maxY;
        maxY = grownMaxY;
        const grownDomTargets = storyBeatScrollTargets(maxY).filter((value) => value > previousMaxY - 12);
        grownDomTargets.forEach((value) => pass1.domTargetSet.add(value));
        const grownGridTargets = [];
        for (let value = previousMaxY + stepPx; value < maxY; value += stepPx) grownGridTargets.push(Math.round(value));
        grownGridTargets.push(maxY);
        const grownControls = pass1.addControlTargets(storyVariantControlScrollTargets(maxY, "bottom"));
        const newTargets = Array.from(new Set([...grownDomTargets, ...grownGridTargets, ...grownControls]))
          .filter((value) => value > targetY + 2 && !pass1.plannedTargets.includes(value));
        if (!Number.isInteger(settings.maxSteps) && newTargets.length) {
          pass1.plannedTargets.push(...newTargets);
          pass1.plannedTargets.sort((left, right) => left - right);
          captureCoverage.plannedScrollTargetCount = pass1.plannedTargets.length;
          captureCoverage.pass1PlannedTargetCount = pass1.plannedTargets.length;
          if (settings.captureScreenshots) captureCoverage.screenshotPlannedCount = pass1.plannedTargets.length;
        }
        captureCoverage.detectedBeatTargetCount = pass1.domTargetSet.size;
      }
    }

    // Passive progressive recovery: no variant exploration or control clicks.
    const visitedPass1Targets = pass1.plannedTargets.slice(0, captureCoverage.pass1VisitedTargetCount);
    const recoveryTargets = Array.from(new Set([...visitedPass1Targets].reverse().concat(0)));
    captureCoverage.recoveryPlannedTargetCount = recoveryTargets.length;
    captureCoverage.recoveryStatus = "running";
    let recoveryTopMismatchGroupIds = [];
    for (let index = 0; index < recoveryTargets.length && !stopRequested; index += 1) {
      const targetY = recoveryTargets[index];
      window.scrollTo({ top: targetY, behavior: "auto" });
      await sleep(settings.settleMs);
      await waitForNetworkQuiet(settings);
      await waitForPaint(2);
      collectStoryVrVariantGroups(collectStoryVrHeadings());
      const current = serializableVariantObservationMap(variantControlObservations());
      const baseline = variantRecoveryBaselines.get(Math.round(targetY)) || {};
      const mismatchedGroupIds = recoveryMismatchGroupIds(baseline, current);
      if (targetY <= 2) recoveryTopMismatchGroupIds = mismatchedGroupIds;
      captureCoverage.recoveryMismatchCount += mismatchedGroupIds.length;
      if (mismatchedGroupIds.length) captureCoverage.recoveryMismatchedTargetCount += 1;
      collectSnapshot(`recovery-sweep-${String(index + 1).padStart(4, "0")}`, { force: true });
      traversalRecord("recovery-sweep", "bottom-to-top", index, targetY, "recovery", { mismatchedGroupIds });
      captureCoverage.recoveryVisitedTargetCount += 1;
      logProgress("recovery-sweep", { step: index + 1, maxSteps: recoveryTargets.length });
    }
    captureCoverage.recoveryTopMismatchCount = recoveryTopMismatchGroupIds.length;
    captureCoverage.recoveryStatus = stopRequested
      ? "stopped"
      : (recoveryTopMismatchGroupIds.length
        ? "needs-repair"
        : (captureCoverage.recoveryMismatchCount ? "top-verified-with-mismatches" : "verified"));

    if (!stopRequested && recoveryTopMismatchGroupIds.length) {
      const topBaseline = variantRecoveryBaselines.get(0) || {};
      const current = variantControlObservations();
      for (const groupId of recoveryTopMismatchGroupIds) {
        const observation = current.get(groupId);
        const targetOptionId = cleanText(topBaseline[groupId]?.selectedOptionId);
        if (!observation || !targetOptionId) continue;
        captureCoverage.recoveryRepairAttemptCount += 1;
        const restored = await restoreVariantState(
          observation.group,
          observation.ref,
          targetOptionId,
          settings
        );
        if (!restored) captureCoverage.recoveryRepairFailureCount += 1;
      }
      const repaired = serializableVariantObservationMap(variantControlObservations());
      const remaining = recoveryMismatchGroupIds(topBaseline, repaired);
      captureCoverage.recoveryStatus = remaining.length ? "incomplete" : "repaired-and-verified";
    }

    // Pass 2 starts only after the progressive sweep has naturally reached top
    // and the forward baseline is restored. An incomplete recovery remains a
    // useful exported partial probe, but it must not confirm dependencies.
    const recoveryReadyForPass2 = ["verified", "top-verified-with-mismatches", "repaired-and-verified"]
      .includes(captureCoverage.recoveryStatus);
    const pass2 = recoveryReadyForPass2 ? buildPassPlan("top") : { plannedTargets: [] };
    captureCoverage.activePassCount = recoveryReadyForPass2 && !stopRequested ? 2 : 1;
    captureCoverage.pass2PlannedTargetCount = pass2.plannedTargets.length;
    if (!stopRequested && !recoveryReadyForPass2) {
      captureCoverage.pass2SkippedReason = `recovery-${captureCoverage.recoveryStatus || "not-verified"}`;
      captureCoverage.stoppedEarly = true;
      console.warn(`[NYTAnimationProbe] Pass 2 skipped because recovery status is ${captureCoverage.recoveryStatus}.`);
    }
    for (let targetIndex = 0; targetIndex < pass2.plannedTargets.length && !stopRequested; targetIndex += 1) {
      const targetY = pass2.plannedTargets[targetIndex];
      const targetKind = targetKindForPlan(pass2, targetY);
      window.scrollTo({ top: targetY, behavior: "auto" });
      await sleep(settings.settleMs);
      await waitForNetworkQuiet(settings);
      await waitForPaint(2);
      collectStoryVrVariantGroups(collectStoryVrHeadings());
      collectSnapshot(`pass-2-capture-${String(targetIndex + 1).padStart(4, "0")}`, { force: true });
      traversalRecord("pass-2-capture", "top-to-bottom", targetIndex, targetY, targetKind);
      if (settings.exploreVariants) {
        const controlTarget = pass2.controlTargetMap.get(targetY) || null;
        for (const controlPass of controlTarget?.passes || []) {
          await exploreVisibleVariantGroups({
            ...settings,
            targetGroupIds: controlPass.groupIds,
            includeNestedTargets: true,
            explorationPhase: "pass-2-capture",
            viewportAlignment: "top",
            requireViewport: true,
            captureVariantScreenshots: settings.captureScreenshots || settings.allowCanvasFallback
          });
        }
      }
      captureCoverage.pass2VisitedTargetCount += 1;
      if (settings.driverSampleGapMs > 0) {
        await sleep(settings.driverSampleGapMs);
        collectSnapshot(`pass-2-capture-${String(targetIndex + 1).padStart(4, "0")}-stationary`, { force: true });
      }
      logProgress("pass-2-capture", { step: targetIndex + 1, maxSteps: pass2.plannedTargets.length });
    }

    if (stopRequested) captureCoverage.stoppedEarly = true;
    await waitForNetworkQuiet({ ...settings, maxWaitMs: Math.max(settings.maxWaitMs, 12_000) });
    collectSnapshot(stopRequested ? "auto-scroll-stopped" : "auto-scroll-complete", { force: true });

    if (settings.returnToTop && !stopRequested) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      await sleep(settings.settleMs);
      collectSnapshot("return-to-top", { force: true });
    }

    logProgress(stopRequested ? "auto-scroll-stopped" : "auto-scroll-complete");
    return !stopRequested;
  }

  function collect() {
    seedPerformanceEntries();
    const { scripts, scriptSrcUrls } = collectScripts();
    const resourceEntries = Array.from(resourceMap.values()).sort((a, b) => a.url.localeCompare(b.url));
    const candidateResources = resourceEntries.filter((entry) => entry.candidate);
    const domAssetReferences = collectDomAssetReferences();
    const dataParams = collectDataParams();
    const imageGroups = collectStoryVrImageGroups();
    const headings = collectStoryVrHeadings();
    if (!snapshots.length) collectSnapshot("manual-collect");
    collectStoryVrVariantGroups(headings);
    const variantGroups = registeredVariantGroups();

    return {
      tool: "runtime-animation-collector",
      version: VERSION,
      story_url: location.href,
      timestamp: new Date().toISOString(),
      slug: getStorySlug(),
      title: document.title || "",
      resource_entries: resourceEntries,
      candidate_resources: candidateResources,
      dom_asset_references: domAssetReferences,
      image_groups: imageGroups,
      variant_groups: variantGroups,
      variant_hierarchy: variantHierarchyRecords(),
      variant_dependency_cycles: variantDependencyCycles.map((item) => ({ ...item })),
      variant_interactions: variantInteractionRecords.map((item) => ({
        ...item,
        attemptedOptionIds: [...item.attemptedOptionIds],
        capturedOptionIds: [...item.capturedOptionIds],
        outputChangeKinds: [...(item.outputChangeKinds || [])],
        outcomeObservations: (item.outcomeObservations || []).map((observation) => ({
          ...observation,
          mutatedAttributeNames: [...(observation.mutatedAttributeNames || [])]
        })),
        failures: item.failures.map((failure) => ({ ...failure }))
      })),
      variant_asset_associations: variantAssetAssociations(),
      variant_state_screenshots: variantStateScreenshots.map((item) => ({
        ...item,
        canvasCrop: item.canvasCrop ? { ...item.canvasCrop } : null
      })),
      scroll_traversal: scrollTraversalRecords.map((item) => ({
        ...item,
        mismatchedGroupIds: [...(item.mismatchedGroupIds || [])]
      })),
      variant_recovery: {
        status: captureCoverage.recoveryStatus,
        baselineTargetCount: variantRecoveryBaselines.size,
        plannedTargetCount: captureCoverage.recoveryPlannedTargetCount,
        visitedTargetCount: captureCoverage.recoveryVisitedTargetCount,
        mismatchCount: captureCoverage.recoveryMismatchCount,
        mismatchedTargetCount: captureCoverage.recoveryMismatchedTargetCount,
        topMismatchCount: captureCoverage.recoveryTopMismatchCount,
        repairAttemptCount: captureCoverage.recoveryRepairAttemptCount,
        repairFailureCount: captureCoverage.recoveryRepairFailureCount
      },
      script_src_urls: scriptSrcUrls,
      scripts,
      data_params: dataParams,
      runtime_3d: runtime3dMetadata(),
      runtime_3d_catalog: runtime3dStaticCatalog(),
      viewport_capture: viewportCaptureMetadata(),
      scroll_target_screenshots: scrollTargetScreenshots.map((item) => ({ ...item })),
      scroll_target_contact_sheets: serializedScrollTargetContactSheets(),
      capture_coverage: {
        ...captureCoverage,
        capturedSnapshotCount: snapshots.length
      },
      storyvr_author_input: {
        ...collectStoryVrAuthorInputSeed(candidateResources, domAssetReferences, imageGroups, headings),
        variant_groups: variantGroups,
        variant_hierarchy: variantHierarchyRecords(),
        variant_asset_associations: variantAssetAssociations()
      },
      page_keyword_windows: collectPageKeywordWindows(),
      snapshots: [...snapshots],
      notes: [
        "Collected from browser page context without reading cookies, localStorage, sessionStorage, credentials, or private browser state.",
        "Canvas visual hashes are best-effort and may be unavailable for tainted canvases or WebGL contexts.",
        "After one user-approved current-tab share, one full composited browser-client screenshot is captured at every planned scroll target. The primary-canvas crop/hash is retained separately as secondary diagnostic evidence.",
        "Full-page capture uses getDisplayMedia and requires the user to choose This Tab. Window/monitor selection is rejected. Canvas-only capture is available only through the explicit allowCanvasFallback option.",
        "runtime3D snapshot state is direct only when captureStatus is ok or partial and each record carries a runtime model/node/action identity; modelUrls remains cumulative resource inventory.",
        "runtime_3d_catalog stores static model/part/geometry/source/frame identity once. runtime3D snapshots reference catalog IDs and retain numeric transforms, visibility, transformed bounds, and only bounded placement candidates.",
        "Spatial placement clues never infer semantic composition from co-loading or beat co-occurrence. A clue requires an explicit bridge/source/config/frame/container hint or a shared direct non-scene parent corroborated by direct asset identity.",
        "Closure-owned Three.js state can opt into direct capture through NYTAnimationProbe.registerRuntime3D(...), a supported bridge global, a canvas/runtime DOM handle, or the storyvr-animation-probe:request-runtime event. Existing global Three.js discovery remains unchanged.",
        "capture_coverage reports DOM-derived beat targets, grid targets, dynamic snapshot limits, and any skipped targets; a reached limit means missing beat state must not be interpreted as absence.",
        "Model renderEligible means structurally eligible in a recent screen pass on a visible canvas; renderContributionCandidate preserves active offscreen passes for postprocessing analysis. Neither proves lack of occlusion or actual pixel contribution.",
        "storyvr_author_input is a seed for the offline analyzer; the analyzer writes the final captures/active metadata.",
        "variant_groups records evidence-derived, mutually exclusive within-beat states and their source controls; it is not a narrative successor branch.",
        "variant_hierarchy records only causal parent-option to child-control changes or explicit control targets. Container and sibling proximity only bound a candidate; they never prove nesting.",
        "Auto-scroll uses Pass 1 top-to-bottom dependency discovery with controls bottom-aligned, a progressive passive bottom-to-top recovery sweep, and Pass 2 top-to-bottom capture with controls top-aligned. Site chrome, links, forms, submit buttons, disabled controls, and navigation-producing clicks remain excluded.",
        "Story-local button-only navigation and paired icon arrows are eligible. Previous/Next carousels may reveal options dynamically; collection stops at a repeated state or the bounded option limit, then restores the initial state.",
        "variant_state_screenshots stores per-option composited viewport evidence only for aligned passes; eager passes remain DOM/runtime evidence. Canvas fallback remains explicit.",
        "variant_asset_associations uses option-local DOM asset references and directly render-eligible runtime models. Cumulative modelUrls preload inventory is never used as option identity.",
        "Every safe probe-driven button click is evaluated against settled whole-document DOM and scroll state. Previous/Next groups may additionally use a document-wide stable visual fallback. Local control scope is used for dependency and hierarchy attribution, not click-outcome detection.",
        "Directional groups exercise both previous and next controls, detect cycles from the changed-element projection of whole-document snapshots, and restore those changed DOM/scroll records to their initial state.",
        "variant_interactions, scroll_traversal, variant_recovery, and capture_coverage report phase order, document-wide button outcomes, skipped controls, recovery mismatches, failed state changes, cycle guards, and restoration failures; manual interaction remains appropriate for controls that fail the safety checks."
      ],
      collector_hash: hashString(`${location.href}:${document.title}:${resourceEntries.length}:${snapshots.length}:${scrollTargetScreenshots.length}:${variantStateScreenshots.length}:${captureCoverage.viewportScreenshotCaptureCount}`)
    };
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportProbe() {
    const data = collect();
    const filename = `nyt_animation_probe_${data.slug}.json`;
    downloadJson(data, filename);
    console.info(
      `[NYTAnimationProbe] Exported ${filename}: ${data.snapshots.length} snapshots, ${data.candidate_resources.length} candidate resources, ${data.dom_asset_references.length} DOM references.`
    );
    return data;
  }

  async function autoRun(options = {}) {
    if (autoRunPromise) {
      console.info("[NYTAnimationProbe] autoRun is already running.");
      return autoRunPromise;
    }

    autoRunPromise = (async () => {
      try {
        const completed = await autoScroll(options);
        if (!completed) {
          console.warn("[NYTAnimationProbe] Auto-run stopped before export.");
          return null;
        }
        const data = exportProbe();
        console.info(`[NYTAnimationProbe] Auto-run complete. Exported animation probe JSON for ${data.story_url}.`);
        return data;
      } catch (error) {
        console.error("[NYTAnimationProbe] Auto-run failed:", error);
        throw error;
      } finally {
        if (viewportCaptureState.status === "ready") releaseViewportCapture("completed");
        autoRunPromise = null;
      }
    })();

    return autoRunPromise;
  }

  function stop() {
    stopRequested = true;
    if (autoRunTimer) {
      clearTimeout(autoRunTimer);
      autoRunTimer = null;
    }
    if (beatChangeTimer) {
      clearTimeout(beatChangeTimer);
      beatChangeTimer = null;
    }
    if (observer) observer.disconnect();
    observer = null;
    if (runtimeScrollHandler) {
      window.removeEventListener?.("scroll", runtimeScrollHandler);
      runtimeScrollHandler = null;
    }
    removeViewportCapturePrompt();
    if (viewportCaptureState.stream) releaseViewportCapture("stopped");
    console.info("[NYTAnimationProbe] Stopped.");
  }

  startObserver();
  installRuntime3DInstrumentation();

  window.NYTAnimationProbe = {
    version: VERSION,
    collect,
    autoRun,
    autoScroll,
    exploreVariants,
    export: exportProbe,
    stop,
    snapshot: () => collectSnapshot("manual-snapshot"),
    resourceCount: () => resourceMap.size,
    runtime3D: () => collectRuntime3DObservation(),
    runtime3DCatalog: () => runtime3dStaticCatalog(),
    registerRuntime3D: (runtime, options = {}) => registerRuntime3DBridge(runtime, options),
    refreshRuntimeHooks: () => installRuntime3DInstrumentation(true),
    enableViewportCapture,
    viewportCapture: viewportCaptureMetadata
  };

  console.info(
    "[NYTAnimationProbe] Installed. Click Enable full-page capture and choose This Tab. Auto-run starts after approval."
  );

  if (!window.NYTAnimationProbe_DISABLE_AUTORUN) {
    installViewportCapturePrompt();
  }
})();
