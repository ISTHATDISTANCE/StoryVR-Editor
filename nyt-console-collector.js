/*
 * NYTimes visual story asset collector.
 *
 * Usage:
 * 1. Open the NYTimes story in your browser using your own authorized session.
 * 2. Paste this entire file into the DevTools console.
 * 3. The collector automatically scrolls through the story and exports JSON.
 *
 * Manual controls:
 *   NYTAssetCollector.autoRun()
 *   NYTAssetCollector.autoScroll()
 *   NYTAssetCollector.export()
 *   NYTAssetCollector.stop()
 *
 * This snippet does not read cookies, localStorage, sessionStorage, credentials,
 * or private browser state. It only records page HTML, DOM references, script
 * tags, visible structure candidates, and Performance API resource entries.
 */
(() => {
  "use strict";

  const VERSION = "1.0.0";
  const MAX_INLINE_TEXT = 500_000;
  const MAX_TEXT_ITEMS = 250;
  const CONTEXT_RADIUS = 180;

  const EXTENSIONS = [
    ".glb",
    ".gltf",
    ".bin",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".ktx",
    ".ktx2",
    ".basis",
    ".json",
    ".csv",
    ".geojson",
    ".topojson",
    ".js",
    ".mjs"
  ];

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

  const resourceMap = new Map();
  const structureAccumulator = {
    h1: new Map(),
    captions: new Map(),
    scroll_steps: new Map(),
    slides: new Map(),
    text_only_parts: new Map()
  };
  let domOrderCache = null;
  let observer = null;
  let lastResourceAt = performance.now();
  let stopRequested = false;
  let autoRunPromise = null;
  let autoRunTimer = null;

  function cleanText(value, maxLength = 2000) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function textFingerprint(value) {
    return cleanText(value, 10_000).toLowerCase();
  }

  function isUsableText(value) {
    const key = textFingerprint(value);
    return Boolean(key) && !["undefined", "null", "nan"].includes(key);
  }

  function stableStringify(value) {
    if (!value || typeof value !== "object") return "";
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .reduce((result, key) => {
          result[key] = value[key];
          return result;
        }, {})
    );
  }

  function resetDomOrderCache() {
    domOrderCache = null;
  }

  function domOrderMap() {
    if (!domOrderCache) {
      domOrderCache = new WeakMap();
      Array.from(document.querySelectorAll("*")).forEach((node, index) => {
        domOrderCache.set(node, index);
      });
    }
    return domOrderCache;
  }

  function domOrderForNode(node) {
    return domOrderMap().get(node) ?? -1;
  }

  function collectNodeAttributes(node) {
    const attributes = {};
    for (const attribute of Array.from(node?.attributes || [])) {
      if (/^(data-|id$|class$|aria-label$)/i.test(attribute.name)) {
        attributes[attribute.name] = attribute.value.slice(0, 1000);
      }
    }
    return attributes;
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
      .slice(0, 80);
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
      .replace(/\\\//g, "/");

    if (!value) return null;
    if (/^(data|blob|javascript|mailto|tel):/i.test(value)) return null;

    if (value.startsWith("//")) {
      value = `${location.protocol}${value}`;
    }

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

  function isCandidateUrl(url) {
    const lowered = String(url || "").toLowerCase();
    const ext = urlExtension(lowered);
    return EXTENSIONS.includes(ext) || hasKeyword(lowered);
  }

  function addResourceEntry(entry, observed = false) {
    if (!entry || !entry.name) return;
    const url = normalizeUrl(entry.name);
    if (!url) return;
    if (observed) {
      lastResourceAt = performance.now();
    }

    const previous = resourceMap.get(url);
    const record = {
      url,
      name: entry.name,
      initiatorType: entry.initiatorType || "",
      startTime: Number.isFinite(entry.startTime) ? entry.startTime : null,
      duration: Number.isFinite(entry.duration) ? entry.duration : null,
      transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
      encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
      decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
      nextHopProtocol: entry.nextHopProtocol || "",
      candidate: isCandidateUrl(url)
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

  function parseSrcset(value) {
    return String(value || "")
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function extractCssUrls(value) {
    const urls = [];
    const text = String(value || "");
    const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let match;
    while ((match = pattern.exec(text))) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
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

    const elements = Array.from(document.querySelectorAll("*"));
    elements.forEach((element, elementIndex) => {
      for (const attribute of Array.from(element.attributes || [])) {
        const name = attribute.name;
        const value = attribute.value || "";
        const rawValues = [];

        if (urlAttributes.has(name) || /^data-/i.test(name)) {
          rawValues.push(value);
        }
        if (srcsetAttributes.has(name)) {
          rawValues.push(...parseSrcset(value));
        }
        if (name === "style") {
          rawValues.push(...extractCssUrls(value));
        }

        for (const rawValue of rawValues) {
          const url = normalizeUrl(rawValue);
          if (!url || !isCandidateUrl(url)) continue;

          const existing = references.get(url) || {
            url,
            source_type: "html_reference",
            element_count: 0,
            examples: []
          };
          existing.element_count += 1;
          if (existing.examples.length < 5) {
            existing.examples.push({
              tag: element.tagName.toLowerCase(),
              attribute: name,
              elementIndex,
              value: rawValue.slice(0, 500)
            });
          }
          references.set(url, existing);
        }
      }
    });

    return Array.from(references.values()).sort((a, b) => a.url.localeCompare(b.url));
  }

  function findKeywordMatches(text, source, maxMatches = 80) {
    const matches = [];
    const original = String(text || "");
    const lowered = original.toLowerCase();
    const seen = new Set();

    for (const keyword of KEYWORDS) {
      const needle = keyword.toLowerCase();
      let offset = 0;
      while (matches.length < maxMatches) {
        const index = lowered.indexOf(needle, offset);
        if (index === -1) break;
        const start = Math.max(0, index - CONTEXT_RADIUS);
        const end = Math.min(original.length, index + needle.length + CONTEXT_RADIUS);
        const key = `${keyword}:${start}:${end}`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            source,
            keyword,
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

  function compactInlineText(text) {
    const value = String(text || "");
    if (value.length <= MAX_INLINE_TEXT) {
      return {
        text: value,
        truncated: false
      };
    }

    return {
      text: `${value.slice(0, MAX_INLINE_TEXT - 25_000)}\n/* truncated by collector */\n${value.slice(-25_000)}`,
      truncated: true
    };
  }

  function collectScripts() {
    const scripts = [];
    const scriptSrcUrls = [];

    Array.from(document.scripts).forEach((script, index) => {
      const src = normalizeUrl(script.src || "");
      if (src) scriptSrcUrls.push(src);

      const type = script.type || "";
      const text = script.src ? "" : script.textContent || "";
      const inlineCandidate = !src && text && (/json/i.test(type) || hasKeyword(text));
      const record = {
        index,
        src,
        type,
        id: script.id || "",
        async: Boolean(script.async),
        defer: Boolean(script.defer),
        textLength: text.length,
        keywordMatches: inlineCandidate ? findKeywordMatches(text, `inline_script_${index}`, 40) : []
      };

      if (inlineCandidate) {
        Object.assign(record, compactInlineText(text));
      }

      scripts.push(record);
    });

    return {
      scripts,
      script_src_urls: Array.from(new Set(scriptSrcUrls)).sort()
    };
  }

  function collectTextNodes(selector, category, limit = MAX_TEXT_ITEMS) {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }

    const seenText = new Set();
    const results = [];
    for (const item of nodes
      .map((node, index) => ({
        category,
        index,
        selector,
        tag: node.tagName ? node.tagName.toLowerCase() : "",
        id: node.id || "",
        className: typeof node.className === "string" ? node.className : "",
        domOrder: domOrderForNode(node),
        text: cleanText(node.textContent, 4000)
      }))
      .filter((item) => isUsableText(item.text))) {
      const key = textFingerprint(item.text);
      if (seenText.has(key)) continue;
      seenText.add(key);
      results.push(item);
      if (results.length >= limit) break;
    }
    return results;
  }

  function slideCandidateQuality(item) {
    const attributes = item.attributes || {};
    const className = String(attributes.class || "");
    const id = String(attributes.id || "");
    const haystack = `${item.tag || ""} ${id} ${className}`.toLowerCase();
    let score = 0;

    if (/annotation|caption|copy|text|dek|body/.test(haystack)) score += 8;
    if (/data-step|scrollama|step/.test(haystack)) score += 6;
    if (/slide/.test(haystack)) score += 4;
    if (/container|wrapper|wrap|scene|canvas|hotspot|pin/.test(haystack)) score -= 6;
    if (attributes["data-scrollama-index"] || attributes["data-step"] || attributes["data-slide"]) score += 4;
    if (item.text) score += Math.max(0, 5 - Math.floor(item.text.length / 1000));

    return score;
  }

  function shouldDropCompositeSlideCandidate(item, childKeys) {
    if (!item.text || !childKeys.length) return false;
    const key = textFingerprint(item.text);
    const meaningfulChildKeys = Array.from(new Set(childKeys))
      .filter((childKey) => childKey && childKey.length >= 40 && childKey.length < key.length - 20);
    if (meaningfulChildKeys.length >= 2 && meaningfulChildKeys.every((childKey) => key.includes(childKey))) {
      return true;
    }

    const className = String(item.attributes?.class || "").toLowerCase();
    return (
      /container|wrapper|wrap|scene/.test(className) &&
      meaningfulChildKeys.length === 1 &&
      key.includes(meaningfulChildKeys[0]) &&
      key.length > meaningfulChildKeys[0].length + 80
    );
  }

  function collectSlideLikeNodes() {
    const selector = [
      "[data-step]",
      "[data-scrollama-index]",
      "[data-slide]",
      "[data-scene]",
      "[class*='step']",
      "[class*='slide']",
      "[class*='scene']",
      "[class*='scroll']"
    ].join(",");

    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }

    const candidates = nodes.map((node, index) => {
      const attributes = collectNodeAttributes(node);
      const text = cleanText(node.textContent, 5000);
      return {
        node,
        category: "slide_or_scroll_candidate",
        index,
        tag: node.tagName ? node.tagName.toLowerCase() : "",
        attributes,
        domOrder: domOrderForNode(node),
        text: isUsableText(text) ? text : ""
      };
    }).filter((item) => item.text || Object.keys(item.attributes).length > 0);

    const textCandidates = candidates.filter((item) => item.text);
    const droppedCompositeNodes = new Set();
    for (const item of textCandidates) {
      const childKeys = textCandidates
        .filter((child) => child !== item && item.node.contains(child.node))
        .map((child) => textFingerprint(child.text));
      if (shouldDropCompositeSlideCandidate(item, childKeys)) {
        droppedCompositeNodes.add(item.node);
      }
    }

    const bestByText = new Map();
    const attributeOnly = [];
    for (const item of candidates) {
      if (droppedCompositeNodes.has(item.node)) continue;
      if (!item.text) {
        attributeOnly.push(item);
        continue;
      }

      const key = textFingerprint(item.text);
      const previous = bestByText.get(key);
      if (!previous || slideCandidateQuality(item) > slideCandidateQuality(previous)) {
        bestByText.set(key, item);
      }
    }

    return [...Array.from(bestByText.values()), ...attributeOnly]
      .sort((a, b) => a.index - b.index)
      .slice(0, MAX_TEXT_ITEMS)
      .map(({ node, ...item }) => item);
  }

  function textOnlySubtype(node) {
    if (node.matches("article#story .story-heading.interactive-headline")) return "headline";
    if (node.matches("article#story .interactive-leadin .summary-text")) return "dek";
    if (node.matches(".g-subhed h2, .subhed")) return "subhead";
    return "body";
  }

  function hasAncestorClass(node, pattern) {
    for (let current = node; current && current !== document.documentElement; current = current.parentElement) {
      const className = typeof current.className === "string" ? current.className : "";
      if (pattern.test(className)) return true;
    }
    return false;
  }

  function isExcludedTextOnlyNode(node, subtype) {
    if (subtype === "headline" || subtype === "dek") return false;
    if (node.closest("footer, nav, aside")) return true;
    return hasAncestorClass(
      node,
      /\b(g-credits|g-note|g-custom-related|nocontent|robots-nocontent|story-footer|page-footer|interactive-credit|newsletter|recirculation|site-index|comments|meter|subscribe|share)\b/i
    );
  }

  function collectTextOnlyParts() {
    const selector = [
      "article#story .story-heading.interactive-headline",
      "article#story .interactive-leadin .summary-text",
      ".g-text p.g-body",
      ".g-subhed h2",
      ".fullbody p.g-text",
      ".subhed"
    ].join(",");

    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }

    const seenText = new Set();
    const results = [];
    for (const [index, node] of nodes.entries()) {
      const text = cleanText(node.textContent, 5000);
      if (!isUsableText(text)) continue;

      const subtype = textOnlySubtype(node);
      if (isExcludedTextOnlyNode(node, subtype)) continue;

      const key = textFingerprint(text);
      if (seenText.has(key)) continue;
      seenText.add(key);

      results.push({
        category: "text_only_part",
        subtype,
        index,
        selector,
        tag: node.tagName ? node.tagName.toLowerCase() : "",
        id: node.id || "",
        className: typeof node.className === "string" ? node.className : "",
        attributes: collectNodeAttributes(node),
        domOrder: domOrderForNode(node),
        text
      });

      if (results.length >= MAX_TEXT_ITEMS) break;
    }

    return results;
  }

  function collectStoryStructureCandidatesFromDom() {
    resetDomOrderCache();
    return {
      title: document.title || "",
      h1: collectTextNodes("h1", "heading", 20),
      captions: collectTextNodes(
        "figcaption, [class*='caption'], [data-testid*='caption'], [aria-label*='caption']",
        "caption",
        MAX_TEXT_ITEMS
      ),
      scroll_steps: collectTextNodes(
        "[data-step], [data-scrollama-index], [class*='step'], [class*='scroll-step']",
        "scroll_step",
        MAX_TEXT_ITEMS
      ),
      slides: collectSlideLikeNodes(),
      text_only_parts: collectTextOnlyParts()
    };
  }

  function storyStructureItemKey(item) {
    const textKey = textFingerprint(item?.text || item?.caption || item?.content || "");
    if (textKey) return `text:${textKey}`;
    const attrKey = stableStringify(item?.attributes || {
      id: item?.id || "",
      class: item?.className || ""
    });
    if (attrKey) return `attr:${item?.tag || ""}:${attrKey}`;
    return "";
  }

  function structureObservation() {
    return {
      scrollY: Math.round(window.scrollY || 0),
      scrollPercent: scrollProgressPercent(),
      timestamp: new Date().toISOString()
    };
  }

  function rememberStructureItems(field, items) {
    const bucket = structureAccumulator[field];
    if (!bucket) return;
    const observed = structureObservation();
    for (const item of items || []) {
      const key = storyStructureItemKey(item);
      if (!key || bucket.has(key)) continue;
      bucket.set(key, {
        ...item,
        observed
      });
    }
  }

  function rememberStoryStructureCandidates() {
    const structure = collectStoryStructureCandidatesFromDom();
    rememberStructureItems("h1", structure.h1);
    rememberStructureItems("captions", structure.captions);
    rememberStructureItems("scroll_steps", structure.scroll_steps);
    rememberStructureItems("slides", structure.slides);
    rememberStructureItems("text_only_parts", structure.text_only_parts);
    return structure;
  }

  function sortByDomOrder(items) {
    return [...items].sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.domOrder)) ? Number(a.domOrder) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.domOrder)) ? Number(b.domOrder) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (Number(a.index) || 0) - (Number(b.index) || 0);
    });
  }

  function mergedStructureItems(field) {
    return sortByDomOrder(Array.from(structureAccumulator[field]?.values() || []));
  }

  function resetStoryStructureAccumulator() {
    for (const bucket of Object.values(structureAccumulator)) {
      bucket.clear();
    }
  }

  function collectStoryStructureCandidates() {
    const current = rememberStoryStructureCandidates();
    return {
      title: current.title,
      h1: mergedStructureItems("h1"),
      captions: mergedStructureItems("captions"),
      scroll_steps: mergedStructureItems("scroll_steps"),
      slides: mergedStructureItems("slides"),
      text_only_parts: mergedStructureItems("text_only_parts")
    };
  }

  function collectKeywordMatchesFromPage(html, scripts) {
    const matches = [
      ...findKeywordMatches(html, "page_html", 120)
    ];

    for (const script of scripts) {
      if (matches.length >= 350) break;
      if (!script.text) continue;
      matches.push(...findKeywordMatches(script.text, `inline_script_${script.index}`, 40));
    }

    return matches.slice(0, 350);
  }

  function collect() {
    seedPerformanceEntries();

    const html = document.documentElement.outerHTML;
    const { scripts, script_src_urls: scriptSrcUrls } = collectScripts();
    const networkEntries = Array.from(resourceMap.values()).sort((a, b) => a.url.localeCompare(b.url));
    const filteredRequests = networkEntries.filter((entry) => entry.candidate);
    const domAssetReferences = collectDomAssetReferences();

    return {
      tool: "nyt-console-collector",
      version: VERSION,
      story_url: location.href,
      timestamp: new Date().toISOString(),
      slug: getStorySlug(),
      title: document.title || "",
      html,
      scripts,
      script_src_urls: scriptSrcUrls,
      dom_asset_references: domAssetReferences,
      network_entries: networkEntries,
      filtered_requests: filteredRequests,
      story_structure_candidates: collectStoryStructureCandidates(),
      keyword_matches: collectKeywordMatchesFromPage(html, scripts),
      notes: [
        "Collected from the browser page context without reading cookies, localStorage, sessionStorage, credentials, or private browser state.",
        "Run NYTAssetCollector.export() again after scrolling if the story lazy-loads more assets."
      ],
      collector_hash: hashString(`${location.href}:${document.title}:${html.length}:${networkEntries.length}`)
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    return maxY > 0 ? Math.min(100, Math.round((window.scrollY / maxY) * 100)) : 100;
  }

  function progressSummary() {
    seedPerformanceEntries();
    const networkEntries = Array.from(resourceMap.values());
    const filteredRequests = networkEntries.filter((entry) => entry.candidate);
    let domRefs = 0;
    try {
      domRefs = collectDomAssetReferences().length;
    } catch {
      domRefs = 0;
    }
    return {
      resources: networkEntries.length,
      filteredRequests: filteredRequests.length,
      domRefs
    };
  }

  function logProgress(phase, extra = {}) {
    const summary = progressSummary();
    const details = [
      `scroll=${scrollProgressPercent()}%`,
      `resources=${summary.resources}`,
      `filtered=${summary.filteredRequests}`,
      `domRefs=${summary.domRefs}`
    ];

    if (Number.isInteger(extra.step) && Number.isInteger(extra.maxSteps)) {
      details.unshift(`step=${extra.step}/${extra.maxSteps}`);
    }

    console.info(`[NYTAssetCollector] ${phase}: ${details.join(" ")}`);
  }

  async function waitForNetworkQuiet(options = {}) {
    const networkQuietMs = Number.isFinite(options.networkQuietMs) ? options.networkQuietMs : 1500;
    const maxWaitMs = Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 10_000;
    const startedAt = performance.now();

    while (!stopRequested) {
      seedPerformanceEntries();
      const now = performance.now();
      const quietFor = now - lastResourceAt;
      if (quietFor >= networkQuietMs && document.readyState === "complete") {
        return true;
      }
      if (now - startedAt >= maxWaitMs) {
        return false;
      }
      await sleep(250);
    }

    return false;
  }

  async function autoScroll(options = {}) {
    stopRequested = false;
    startObserver();

    const settings = {
      stepRatio: Number.isFinite(options.stepRatio) ? options.stepRatio : 0.75,
      minStepPx: Number.isFinite(options.minStepPx) ? options.minStepPx : 500,
      maxStepPx: Number.isFinite(options.maxStepPx) ? options.maxStepPx : 1200,
      settleMs: Number.isFinite(options.settleMs) ? options.settleMs : 900,
      networkQuietMs: Number.isFinite(options.networkQuietMs) ? options.networkQuietMs : 1500,
      maxWaitMs: Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 10_000,
      maxSteps: Number.isInteger(options.maxSteps) ? options.maxSteps : 240,
      accumulateStructure: options.accumulateStructure !== false,
      returnToTop: Boolean(options.returnToTop)
    };

    console.info("[NYTAssetCollector] Auto-scroll started. Run NYTAssetCollector.stop() to cancel.");
    if (settings.accumulateStructure) resetStoryStructureAccumulator();
    window.scrollTo({ top: 0, behavior: "auto" });
    await sleep(settings.settleMs);
    await waitForNetworkQuiet(settings);
    if (settings.accumulateStructure) rememberStoryStructureCandidates();
    logProgress("auto-scroll-start", { step: 0, maxSteps: settings.maxSteps });

    for (let step = 1; step <= settings.maxSteps && !stopRequested; step += 1) {
      const maxY = Math.max(0, documentHeight() - window.innerHeight);
      const currentY = window.scrollY;
      if (currentY >= maxY - 2) {
        break;
      }

      const stepPx = Math.max(
        settings.minStepPx,
        Math.min(settings.maxStepPx, Math.floor(window.innerHeight * settings.stepRatio))
      );
      const targetY = Math.min(maxY, currentY + stepPx);
      window.scrollTo({ top: targetY, behavior: "smooth" });

      await sleep(settings.settleMs);
      await waitForNetworkQuiet(settings);
      if (settings.accumulateStructure) rememberStoryStructureCandidates();
      logProgress("auto-scroll", { step, maxSteps: settings.maxSteps });
    }

    await waitForNetworkQuiet({
      ...settings,
      maxWaitMs: Math.max(settings.maxWaitMs, 12_000)
    });
    if (settings.accumulateStructure) rememberStoryStructureCandidates();

    if (settings.returnToTop && !stopRequested) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      await sleep(settings.settleMs);
      if (settings.accumulateStructure) rememberStoryStructureCandidates();
    }

    logProgress(stopRequested ? "auto-scroll-stopped" : "auto-scroll-complete");
    return !stopRequested;
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportDiscovery() {
    const data = collect();
    const filename = `nyt_asset_discovery_${data.slug}.json`;
    downloadJson(data, filename);
    console.info(
      `[NYTAssetCollector] Exported ${filename}: ${data.filtered_requests.length} filtered network requests, ${data.dom_asset_references.length} DOM references, ${data.script_src_urls.length} external scripts.`
    );
    return data;
  }

  async function autoRun(options = {}) {
    if (autoRunPromise) {
      console.info("[NYTAssetCollector] autoRun is already running.");
      return autoRunPromise;
    }

    autoRunPromise = (async () => {
      try {
        const completed = await autoScroll(options);
        if (!completed) {
          console.warn("[NYTAssetCollector] Auto-run stopped before export.");
          return null;
        }
        const data = exportDiscovery();
        console.info(`[NYTAssetCollector] Auto-run complete. Exported discovery JSON for ${data.story_url}.`);
        return data;
      } catch (error) {
        console.error("[NYTAssetCollector] Auto-run failed:", error);
        throw error;
      } finally {
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
    if (observer) observer.disconnect();
    observer = null;
    console.info("[NYTAssetCollector] Stopped.");
  }

  startObserver();

  window.NYTAssetCollector = {
    version: VERSION,
    collect,
    autoRun,
    autoScroll,
    export: exportDiscovery,
    stop,
    resourceCount: () => resourceMap.size
  };

  console.info(
    "[NYTAssetCollector] Installed. Auto-run will scroll and export shortly. Run NYTAssetCollector.stop() to cancel."
  );

  if (!window.NYTAssetCollector_DISABLE_AUTORUN) {
    autoRunTimer = setTimeout(() => {
      autoRunTimer = null;
      if (stopRequested) return;
      window.NYTAssetCollector.autoRun().catch(() => {});
    }, 500);
  }
})();
