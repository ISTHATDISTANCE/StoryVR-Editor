import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const collectorPath = fileURLToPath(new URL("./runtime-animation-collector.js", import.meta.url));
const collectorSource = fs.readFileSync(collectorPath, "utf8");

test("collector includes generic article paragraphs and preserves their DOM order", () => {
  assert.match(collectorSource, /"article p"/);
  assert.match(collectorSource, /"\.g-text"/);
  assert.match(collectorSource, /domOrder: summary\.domOrder/);
  assert.match(collectorSource, /Number\.isFinite\(Number\(activeText\.domOrder\)\)/);
});

function createCollectorFixture({
  exposeThree = true,
  initialDocumentHeight = 2000,
  grownDocumentHeight = null,
  viewportCapture = false,
  includeVariantGroup = false,
  includeSemanticVariantGroup = false,
  includeAnnouncementVariantGroup = false,
  includeButtonClusterVariantGroup = false,
  includeNestedVariantGroup = false,
  includeConditionalNestedVariantGroup = false,
  includeStatefulButtonClusterVariantGroup = false,
  includeSiblingNestedVariantGroup = false,
  dynamicVariantOptions = false,
  directionalOutputOnlyState = false,
  directionalRuntimeOnlyState = false,
  directionalControlsNoop = false,
  directionalExternalScrollState = false,
  directionalAsyncExternalScrollState = false,
  includeThirdDirectionalOption = false,
  includeContinuousUnrelatedDomChurn = false,
  includeVariantCanvas = false,
  regionDocumentTop = 320,
  includeIndependentButtonGroups = false,
  includeUnrelatedSectionMutation = false,
  buttonClusterExternalOutputOnlyState = false,
  variantNavIsGlobal = false,
  wrapButtonClusterControls = false,
  unrecoverableRegionOnReverse = false,
  initialResourceEntries = [],
} = {}) {
  const resourceEntries = [...initialResourceEntries];
  const consoleMessages = [];
  let now = 1000;
  let currentDocumentHeight = initialDocumentHeight;
  let createdCanvasSerial = 0;
  let currentScrollY = 0;
  let recoveryBroken = false;
  const variantClickEvents = [];
  const collectorTimeline = [];
  const windowEventListeners = new Map();
  const activeMutationObservers = new Set();
  const addFixtureEventListener = (type, listener) => {
    if (typeof listener !== "function") return;
    const listeners = windowEventListeners.get(type) || new Set();
    listeners.add(listener);
    windowEventListeners.set(type, listeners);
  };
  const removeFixtureEventListener = (type, listener) => {
    windowEventListeners.get(type)?.delete(listener);
  };
  const emitFixtureEvent = (type, event) => {
    for (const listener of windowEventListeners.get(type) || []) listener(event);
  };
  const emitFixtureMutation = (record) => {
    for (const observer of activeMutationObservers) observer.callback([record], observer);
  };
  class FixtureMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {
      activeMutationObservers.add(this);
    }

    disconnect() {
      activeMutationObservers.delete(this);
    }

    takeRecords() {
      return [];
    }
  }
  const performance = {
    now: () => (now += 16),
    getEntriesByType: () => resourceEntries
  };
  const canvas = {
    tagName: "CANVAS",
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 }),
    toDataURL: () => "data:image/png;base64,fixture"
  };
  const beatNode = {
    tagName: "DIV",
    id: "beat-1",
    className: "g-slide-text",
    textContent: includeAnnouncementVariantGroup
      ? "Choose a route Forest Desert Coast You've selected Forest. Read more information about it below. Tall trees and shade. You've selected Desert. Read more information about it below. Open sand and sun. You've selected Coast. Read more information about it below. Wind and water."
      : "Fixture beat",
    getAttribute: (name) => name === "data-slide" ? "1" : "",
    getBoundingClientRect: () => ({ top: 100, bottom: 300, left: 0, right: 800, width: 800, height: 200 })
  };
  const variantTitle = { textContent: "Choose a habitat" };
  const variantName = (text) => ({ textContent: text, getAttribute: () => "" });
  let activeVariantIndex = 0;
  let activeRegionIndex = includeStatefulButtonClusterVariantGroup ? 1 : 0;
  let externalCarouselScrollLeft = 0;
  let externalRegionOutputIndex = activeRegionIndex;
  let unrelatedDomTick = 0;
  let childMountGeneration = includeConditionalNestedVariantGroup && activeRegionIndex === 1 ? 1 : 0;
  let unrelatedSectionRevision = 0;
  let variantIndexChangeHandler = () => {};
  const childVariantMounted = () => !includeConditionalNestedVariantGroup || activeRegionIndex === 1;
  const recordVariantClick = (event) => {
    const record = { ...event, sequence: collectorTimeline.length };
    variantClickEvents.push(record);
    collectorTimeline.push({ type: "click", ...record });
  };
  let unrelatedDomTicker = null;
  const startUnrelatedDomChurn = () => {
    if (!includeContinuousUnrelatedDomChurn || !unrelatedDomTicker) return;
    let remaining = 24;
    const advance = () => {
      unrelatedDomTick += 1;
      emitFixtureMutation({
        type: "characterData",
        target: unrelatedDomTicker,
        attributeName: ""
      });
      remaining -= 1;
      if (remaining > 0) setTimeout(advance, 5);
    };
    advance();
  };
  let variantRoot;
  const variantOption = (id, label, modelUrl, index, top) => {
    const option = {
      tagName: "LI",
      id,
      textContent: `${label} details`,
      hidden: false,
      parentElement: null,
      closest: () => null,
      click: () => { activeVariantIndex = index; },
      getAttribute: (name) => {
        if (name === "data-model") {
          if (directionalRuntimeOnlyState) return "";
          return !directionalOutputOnlyState || activeVariantIndex === index ? modelUrl : "";
        }
        if (name === "role" && includeSemanticVariantGroup) return "tab";
        if (name === "aria-selected" && includeSemanticVariantGroup) return activeVariantIndex === index ? "true" : "false";
        return "";
      },
      querySelector: () => variantName(label),
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({
        top: top - currentScrollY,
        bottom: top + 120 - currentScrollY,
        left: 0,
        right: 500,
        width: childVariantMounted() && (directionalOutputOnlyState || directionalRuntimeOnlyState || includeSemanticVariantGroup || activeVariantIndex === index) ? 500 : 0,
        height: childVariantMounted() && (directionalOutputOnlyState || directionalRuntimeOnlyState || includeSemanticVariantGroup || activeVariantIndex === index) ? 120 : 0
      }),
    };
    Object.defineProperty(option, "className", {
      get: () => directionalOutputOnlyState || directionalRuntimeOnlyState
        ? "variant-card translated"
        : (activeVariantIndex === index ? "variant-card active" : "variant-card")
    });
    return option;
  };
  const hasNestedVariantGroup = includeNestedVariantGroup
    || includeConditionalNestedVariantGroup
    || includeSiblingNestedVariantGroup;
  const variantOptions = includeVariantGroup || includeSemanticVariantGroup || hasNestedVariantGroup ? [
    variantOption("forest-option", "Forest", "https://example.com/forest.glb", 0, 400),
    variantOption("desert-option", "Desert", "https://example.com/desert.glb", 1, 520),
    ...(includeThirdDirectionalOption
      ? [variantOption("coast-option", "Coast", "https://example.com/coast.glb", 2, 640)]
      : []),
  ] : [];
  variantRoot = {
    tagName: "DIV",
    id: "habitat-selector",
    className: "simple-slider",
    textContent: "Choose a habitat Forest details Desert details",
    parentElement: null,
    contains: (node) => childVariantMounted() && (
      (includeVariantCanvas && node === canvas)
      ||
      node === variantNext || node === variantPrevious || node === variantNav || (
        dynamicVariantOptions ? node === variantOptions[activeVariantIndex] : variantOptions.includes(node)
      )
    ),
    getAttribute: (name) => {
      if (name === "role" && includeSemanticVariantGroup) return "tablist";
      if (name === "data-mount-generation" && includeConditionalNestedVariantGroup) return String(childMountGeneration);
      return "";
    },
    querySelector: () => variantTitle,
    querySelectorAll: (selector) => {
      if (!childVariantMounted()) return [];
      if (selector === "*") return includeVariantCanvas ? [canvas] : [];
      if (selector.includes("canvas")) return includeVariantCanvas ? [canvas] : [];
      if (selector.includes("button") || selector.includes("[role='button']")) return [variantPrevious, variantNext];
      return dynamicVariantOptions ? [variantOptions[activeVariantIndex]].filter(Boolean) : variantOptions;
    },
    getBoundingClientRect: () => ({
      top: 350 - currentScrollY,
      bottom: 700 - currentScrollY,
      left: 0,
      right: childVariantMounted() ? 600 : 0,
      width: childVariantMounted() ? 600 : 0,
      height: childVariantMounted() ? 350 : 0
    }),
  };
  Object.defineProperty(variantRoot, "hidden", { get: () => !childVariantMounted() });
  if (includeConditionalNestedVariantGroup) {
    Object.defineProperty(variantRoot, "className", {
      get: () => `simple-slider mount-${childMountGeneration}`
    });
  }
  if (dynamicVariantOptions || directionalOutputOnlyState) {
    Object.defineProperty(variantRoot, "textContent", {
      get: () => `Choose a habitat ${variantOptions[activeVariantIndex]?.textContent || ""}`
    });
  }
  variantOptions.forEach((option) => { option.parentElement = variantRoot; });
  const globalHeader = { tagName: "HEADER", id: "site-masthead", className: "masthead", parentElement: null, getAttribute: () => "" };
  const variantNav = {
    tagName: "NAV",
    id: "",
    className: "variant-navigation",
    textContent: "Previous Next",
    parentElement: variantRoot,
    contains: (node) => node === variantPrevious || node === variantNext,
    getAttribute: () => "",
    querySelectorAll: (selector) => selector.includes("button") || selector.includes("[role='button']") ? [variantPrevious, variantNext] : [],
    closest: (selector) => variantNavIsGlobal && /header/i.test(selector)
      ? globalHeader
      : (/nav|\[role=['"]navigation/i.test(selector) ? variantNav : null),
    getBoundingClientRect: () => ({
      top: 680 - currentScrollY,
      bottom: 720 - currentScrollY,
      left: 0,
      right: childVariantMounted() ? 600 : 0,
      width: childVariantMounted() ? 600 : 0,
      height: childVariantMounted() ? 40 : 0
    }),
  };
  const variantButton = (label) => ({
    tagName: "BUTTON",
    id: "",
    className: "variant-button",
    textContent: "",
    parentElement: variantNav,
    hidden: false,
    closest: (selector) => variantNavIsGlobal && /header/i.test(selector)
      ? globalHeader
      : (/nav|\[role=['"]navigation/i.test(selector) ? variantNav : null),
    click: () => {
      startUnrelatedDomChurn();
      if (!directionalControlsNoop) {
        if (/next/i.test(label)) activeVariantIndex = (activeVariantIndex + 1) % variantOptions.length;
        else activeVariantIndex = (activeVariantIndex - 1 + variantOptions.length) % variantOptions.length;
      }
      if (directionalAsyncExternalScrollState) {
        const start = externalCarouselViewport.scrollLeft;
        const target = activeVariantIndex * 500;
        for (let step = 1; step <= 4; step += 1) {
          setTimeout(() => {
            externalCarouselViewport.scrollLeft = start + ((target - start) * step) / 4;
          }, step * 10);
        }
      } else if (directionalExternalScrollState) {
        externalCarouselViewport.scrollLeft = activeVariantIndex * 500;
      }
      variantIndexChangeHandler(activeVariantIndex);
      recordVariantClick({
        kind: "carousel",
        label,
        scrollY: currentScrollY,
        controlTop: 680 - currentScrollY,
        parentRegionIndex: activeRegionIndex,
        childMountGeneration,
        externalCarouselScrollLeft
      });
    },
    getAttribute: (name) => name === "aria-label" ? label : "",
    getBoundingClientRect: () => ({
      top: 680 - currentScrollY,
      bottom: 720 - currentScrollY,
      left: 0,
      right: childVariantMounted() ? 120 : 0,
      width: childVariantMounted() ? 120 : 0,
      height: childVariantMounted() ? 40 : 0
    }),
  });
  const variantPrevious = variantButton("Previous habitat");
  const variantNext = variantButton("Next habitat");
  if (includeVariantCanvas) canvas.parentElement = variantRoot;
  const regionTitle = { textContent: "Choose a region" };
  let regionStateRoot;
  let regionButtonWrappers = [];
  const regionControlRoot = {
    tagName: "DIV",
    id: "region-controls",
    className: "region-buttons",
    textContent: "North South",
    parentElement: null,
    contains: (node) => regionButtons.includes(node) || regionButtonWrappers.includes(node),
    getAttribute: () => "",
    querySelector: () => null,
    querySelectorAll: () => regionButtons,
    getBoundingClientRect: () => ({
      top: regionDocumentTop - currentScrollY,
      bottom: regionDocumentTop + 50 - currentScrollY,
      left: 0,
      right: 500,
      width: 500,
      height: 50
    }),
  };
  const regionButton = (label, index) => {
    const button = {
      tagName: "BUTTON",
      id: `${label.toLowerCase()}-region`,
      textContent: label,
      parentElement: regionControlRoot,
      hidden: false,
      closest: () => null,
      click: () => {
        const childWasMounted = childVariantMounted();
        if (buttonClusterExternalOutputOnlyState) {
          const oldRegion = externalRegionOutputIndex === 1 ? "South" : "North";
          externalRegionOutputIndex = index;
          emitFixtureMutation({
            type: "attributes",
            target: externalRegionOutput,
            attributeName: "data-region",
            oldValue: oldRegion
          });
        } else if (!(unrecoverableRegionOnReverse && recoveryBroken && index === 0)) {
          activeRegionIndex = index;
        }
        if (includeConditionalNestedVariantGroup && !childWasMounted && childVariantMounted()) {
          childMountGeneration += 1;
        }
        if (includeUnrelatedSectionMutation) unrelatedSectionRevision += 1;
        recordVariantClick({
          kind: "region",
          label,
          scrollY: currentScrollY,
          controlTop: regionDocumentTop - currentScrollY,
          activeRegionIndex,
          externalRegionOutputIndex,
          childMountGeneration
        });
      },
      getAttribute: (name) => {
        if (name === "aria-label" && includeStatefulButtonClusterVariantGroup) {
          return `${label}, ${activeRegionIndex === index ? "selected" : "not selected"}`;
        }
        if (name === "aria-pressed" && !includeStatefulButtonClusterVariantGroup) return activeRegionIndex === index ? "true" : "false";
        return "";
      },
      getBoundingClientRect: () => ({
        top: regionDocumentTop - currentScrollY,
        bottom: regionDocumentTop + 50 - currentScrollY,
        left: index * 130,
        right: index * 130 + 120,
        width: 120,
        height: 50
      }),
    };
    Object.defineProperty(button, "className", {
      get: () => includeStatefulButtonClusterVariantGroup
        ? (activeRegionIndex === index ? "pushable checked not-checked" : "pushable not-checked circle-shape")
        : (activeRegionIndex === index ? "region active" : "region")
    });
    return button;
  };
  const regionButtons = includeButtonClusterVariantGroup || hasNestedVariantGroup || includeStatefulButtonClusterVariantGroup
    ? [regionButton("North", 0), regionButton("South", 1)]
    : [];
  if (wrapButtonClusterControls) {
    regionButtonWrappers = regionButtons.map((button, index) => ({
      tagName: "DIV",
      id: `region-button-wrapper-${index + 1}`,
      className: "region-button-wrapper",
      textContent: button.textContent,
      parentElement: regionControlRoot,
      contains: (node) => node === button,
      getAttribute: () => "",
      querySelectorAll: (selector) => selector.includes("button") || selector.includes("[role='button']") ? [button] : [],
      getBoundingClientRect: () => button.getBoundingClientRect(),
    }));
    regionButtons.forEach((button, index) => { button.parentElement = regionButtonWrappers[index]; });
  }
  regionStateRoot = {
    tagName: "SECTION",
    id: "region-selector",
    className: "story-interactive",
    textContent: "Choose a region North South Region details and nested selectable visual cards for this story section.",
    parentElement: null,
    contains: (node) => node === regionControlRoot || regionButtons.includes(node) || (
      (includeNestedVariantGroup || includeConditionalNestedVariantGroup)
        && childVariantMounted()
        && (node === variantRoot || variantRoot.contains(node))
    ),
    getAttribute: () => "",
    querySelector: (selector) => selector.includes("h1") || selector.includes("h2") || selector.includes("title") ? regionTitle : (
      (includeNestedVariantGroup || includeConditionalNestedVariantGroup)
        && childVariantMounted()
        && /canvas|svg|model-viewer|illustration|card|slide/.test(selector) ? variantRoot : null
    ),
    querySelectorAll: (selector) => {
      if (selector.includes("button") || selector.includes("[role='button']")) {
        return [
          ...regionButtons,
          ...((includeNestedVariantGroup || includeConditionalNestedVariantGroup) && childVariantMounted()
            ? [variantPrevious, variantNext]
            : [])
        ];
      }
      return (includeNestedVariantGroup || includeConditionalNestedVariantGroup) && childVariantMounted()
        ? [variantRoot, ...variantOptions]
        : [];
    },
    getBoundingClientRect: () => ({
      top: regionDocumentTop - 40 - currentScrollY,
      bottom: regionDocumentTop + 440 - currentScrollY,
      left: 0,
      right: 700,
      width: 700,
      height: 480
    }),
  };
  regionControlRoot.parentElement = regionStateRoot;
  let activeActivityIndex = 0;
  const activityTitle = { textContent: "Choose an activity" };
  const activityControlRoot = {
    tagName: "DIV",
    id: "activity-controls",
    className: "activity-buttons",
    textContent: "Surf Swim",
    parentElement: null,
    contains: (node) => activityButtons.includes(node),
    getAttribute: () => "",
    querySelector: () => null,
    querySelectorAll: () => activityButtons,
    getBoundingClientRect: () => ({ top: 1020 - currentScrollY, bottom: 1070 - currentScrollY, left: 0, right: 500, width: 500, height: 50 }),
  };
  const activityButton = (label, index) => {
    const button = {
      tagName: "BUTTON",
      id: `${label.toLowerCase()}-activity`,
      textContent: label,
      parentElement: activityControlRoot,
      hidden: false,
      closest: () => null,
      click: () => {
        activeActivityIndex = index;
        recordVariantClick({
          kind: "activity",
          label,
          scrollY: currentScrollY,
          controlTop: 1020 - currentScrollY,
          activeActivityIndex
        });
      },
      getAttribute: (name) => name === "aria-pressed" ? (activeActivityIndex === index ? "true" : "false") : "",
      getBoundingClientRect: () => ({ top: 1020 - currentScrollY, bottom: 1070 - currentScrollY, left: index * 130, right: index * 130 + 120, width: 120, height: 50 }),
    };
    Object.defineProperty(button, "className", {
      get: () => activeActivityIndex === index ? "activity active" : "activity"
    });
    return button;
  };
  const activityButtons = includeIndependentButtonGroups
    ? [activityButton("Surf", 0), activityButton("Swim", 1)]
    : [];
  const activityStateRoot = {
    tagName: "SECTION",
    id: "activity-selector",
    className: "story-interactive activity-section",
    textContent: "Choose an activity Surf Swim. Activity-specific explanatory content changes here.",
    parentElement: null,
    contains: (node) => node === activityControlRoot || activityButtons.includes(node),
    getAttribute: () => "",
    querySelector: (selector) => selector.includes("h1") || selector.includes("h2") || selector.includes("title") ? activityTitle : null,
    querySelectorAll: (selector) => selector.includes("button") || selector.includes("[role='button']") ? activityButtons : [],
    getBoundingClientRect: () => ({ top: 980 - currentScrollY, bottom: 1320 - currentScrollY, left: 0, right: 700, width: 700, height: 340 }),
  };
  activityControlRoot.parentElement = activityStateRoot;
  const independentStoryVisual = { tagName: "DIV", parentElement: null, getAttribute: () => "" };
  Object.defineProperties(independentStoryVisual, {
    className: { get: () => `story-card revision-${unrelatedSectionRevision}` },
    textContent: { get: () => `Unrelated visual revision ${unrelatedSectionRevision}` }
  });
  const independentStoryRoot = includeIndependentButtonGroups ? {
    tagName: includeUnrelatedSectionMutation ? "SECTION" : "DIV",
    id: "story-shell",
    className: "story-shell",
    textContent: `${regionStateRoot.textContent} ${activityStateRoot.textContent}`,
    parentElement: null,
    contains: (node) => node === regionStateRoot || regionStateRoot.contains(node) || node === activityStateRoot || activityStateRoot.contains(node) || node === independentStoryVisual,
    getAttribute: () => "",
    querySelector: () => independentStoryVisual,
    querySelectorAll: (selector) => selector.includes("button") || selector.includes("[role='button']")
      ? [...regionButtons, ...activityButtons]
      : (includeUnrelatedSectionMutation ? [] : [independentStoryVisual]),
    getBoundingClientRect: () => ({ top: 260 - currentScrollY, bottom: 1400 - currentScrollY, left: 0, right: 760, width: 760, height: 1140 }),
  } : null;
  if (independentStoryRoot) {
    regionStateRoot.parentElement = independentStoryRoot;
    activityStateRoot.parentElement = independentStoryRoot;
    independentStoryVisual.parentElement = independentStoryRoot;
  }
  const regionStoryRoot = includeSiblingNestedVariantGroup ? {
    tagName: "SECTION",
    id: "region-story-section",
    className: "story-section",
    textContent: "Choose a region North South Region details followed by a sibling visualization containing several selectable visual cards.",
    parentElement: null,
    contains: (node) => node === regionStateRoot || regionStateRoot.contains(node) || node === variantRoot || variantRoot.contains(node),
    getAttribute: () => "",
    querySelector: (selector) => selector.includes("h1") || selector.includes("h2") || selector.includes("title") ? regionTitle : (
      /canvas|svg|model-viewer|illustration|card|slide/.test(selector) ? variantRoot : null
    ),
    querySelectorAll: (selector) => {
      if (selector.includes("button") || selector.includes("[role='button']")) return [...regionButtons, variantPrevious, variantNext];
      return [variantRoot, ...variantOptions];
    },
    getBoundingClientRect: () => ({ top: 260, bottom: 780, left: 0, right: 720, width: 720, height: 520 }),
  } : null;
  if (regionStoryRoot) {
    regionStateRoot.parentElement = regionStoryRoot;
    variantRoot.parentElement = regionStoryRoot;
  } else if (includeNestedVariantGroup || includeConditionalNestedVariantGroup) {
    variantRoot.parentElement = regionStateRoot;
  }
  const documentElement = {
    tagName: "HTML",
    id: "",
    className: "",
    clientHeight: 600,
    getAttribute: () => "",
    appendChild: () => {}
  };
  Object.defineProperties(documentElement, {
    scrollHeight: { get: () => currentDocumentHeight },
    offsetHeight: { get: () => currentDocumentHeight }
  });
  const body = { tagName: "BODY", id: "", className: "", getAttribute: () => "" };
  Object.defineProperties(body, {
    scrollHeight: { get: () => currentDocumentHeight },
    offsetHeight: { get: () => currentDocumentHeight }
  });
  const externalCarouselViewport = {
    tagName: "DIV",
    id: "external-carousel-viewport",
    className: "external-carousel-viewport",
    textContent: "Carousel output viewport",
    parentElement: body,
    clientWidth: 500,
    clientHeight: 200,
    scrollHeight: 200,
    scrollTop: 0,
    contains: (node) => node === externalCarouselViewport,
    getAttribute: (name) => name === "id" ? "external-carousel-viewport" : "",
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 760, bottom: 960, left: 0, right: 500, width: 500, height: 200 })
  };
  Object.defineProperties(externalCarouselViewport, {
    scrollWidth: { get: () => includeThirdDirectionalOption ? 1500 : 1000 },
    scrollLeft: {
      get: () => externalCarouselScrollLeft,
      set: (value) => {
        const next = Number(value || 0);
        if (next === externalCarouselScrollLeft) return;
        externalCarouselScrollLeft = next;
        emitFixtureEvent("scroll", { type: "scroll", target: externalCarouselViewport });
      }
    },
    attributes: {
      get: () => [
        { name: "id", value: "external-carousel-viewport" },
        { name: "class", value: "external-carousel-viewport" }
      ]
    }
  });
  const externalRegionOutput = {
    tagName: "DIV",
    id: "external-region-output",
    parentElement: body,
    contains: (node) => node === externalRegionOutput,
    getAttribute: (name) => {
      if (name === "id") return "external-region-output";
      if (name === "data-region") return externalRegionOutputIndex === 1 ? "South" : "North";
      return "";
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 980, bottom: 1180, left: 0, right: 700, width: 700, height: 200 })
  };
  Object.defineProperties(externalRegionOutput, {
    className: { get: () => `external-region-output region-${externalRegionOutputIndex}` },
    textContent: { get: () => `Region output: ${externalRegionOutputIndex === 1 ? "South" : "North"}` },
    attributes: {
      get: () => [
        { name: "id", value: "external-region-output" },
        { name: "class", value: `external-region-output region-${externalRegionOutputIndex}` },
        { name: "data-region", value: externalRegionOutputIndex === 1 ? "South" : "North" }
      ]
    }
  });
  unrelatedDomTicker = {
    tagName: "DIV",
    id: "unrelated-dom-ticker",
    parentElement: body,
    contains: (node) => node === unrelatedDomTicker,
    getAttribute: (name) => name === "id" ? "unrelated-dom-ticker" : "",
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 1200, bottom: 1240, left: 0, right: 300, width: 300, height: 40 })
  };
  Object.defineProperties(unrelatedDomTicker, {
    className: { get: () => `unrelated-dom-ticker tick-${unrelatedDomTick}` },
    textContent: { get: () => `Unrelated document tick ${unrelatedDomTick}` },
    attributes: {
      get: () => [
        { name: "id", value: "unrelated-dom-ticker" },
        { name: "class", value: `unrelated-dom-ticker tick-${unrelatedDomTick}` }
      ]
    }
  });
  const documentStateNodes = () => Array.from(new Set([
    beatNode,
    canvas,
    ...((includeVariantGroup || includeSemanticVariantGroup || hasNestedVariantGroup) && childVariantMounted()
      ? [variantRoot, variantNav, variantPrevious, variantNext, ...variantOptions]
      : []),
    ...(regionButtons.length ? [regionStateRoot, regionControlRoot, ...regionButtonWrappers, ...regionButtons] : []),
    ...(activityButtons.length ? [activityStateRoot, activityControlRoot, ...activityButtons] : []),
    ...(independentStoryRoot ? [independentStoryRoot, independentStoryVisual] : []),
    ...(regionStoryRoot ? [regionStoryRoot] : []),
    ...(directionalExternalScrollState || directionalAsyncExternalScrollState ? [externalCarouselViewport] : []),
    ...(buttonClusterExternalOutputOnlyState ? [externalRegionOutput] : []),
    ...(includeContinuousUnrelatedDomChurn ? [unrelatedDomTicker] : [])
  ].filter(Boolean)));
  const documentRootQuerySelectorAll = (selector) => {
    if (selector === "*") return documentStateNodes();
    if (selector.includes("canvas")) return [canvas];
    return [];
  };
  documentElement.querySelectorAll = documentRootQuerySelectorAll;
  body.querySelectorAll = documentRootQuerySelectorAll;
  Object.defineProperty(documentElement, "outerHTML", {
    get: () => [
      "<html><body>",
      directionalExternalScrollState || directionalAsyncExternalScrollState
        ? '<div id="external-carousel-viewport" class="external-carousel-viewport">Carousel output viewport</div>'
        : "",
      buttonClusterExternalOutputOnlyState
        ? `<div id="external-region-output" class="external-region-output region-${externalRegionOutputIndex}" data-region="${externalRegionOutputIndex === 1 ? "South" : "North"}">Region output: ${externalRegionOutputIndex === 1 ? "South" : "North"}</div>`
        : "",
      "</body></html>"
    ].join("")
  });
  const createDrawingCanvas = () => {
    const serial = ++createdCanvasSerial;
    const context2d = {
      drawImage: () => {},
      fillRect: () => {},
      fillText: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(Array.from({ length: 8 * 8 * 4 }, (_, index) => (index + serial) % 255)) })
    };
    return {
      tagName: "CANVAS",
      width: 1,
      height: 1,
      getContext: () => context2d,
      toDataURL: (mediaType = "image/png") => `data:${mediaType};base64,fixture-${serial}`
    };
  };
  const viewportTrack = {
    stopped: false,
    getSettings: () => ({ displaySurface: "browser" }),
    addEventListener: () => {},
    stop() { this.stopped = true; }
  };
  const viewportStream = {
    getVideoTracks: () => [viewportTrack],
    getTracks: () => [viewportTrack]
  };
  const viewportVideo = {
    readyState: 2,
    videoWidth: 975,
    videoHeight: 861,
    muted: false,
    autoplay: false,
    playsInline: false,
    srcObject: null,
    play: async () => {},
    addEventListener: () => {},
    requestVideoFrameCallback: (callback) => setTimeout(() => callback(now, {}), 0)
  };
  const document = {
    title: "Fixture Story",
    readyState: "complete",
    body,
    documentElement,
    scripts: [],
    addEventListener: addFixtureEventListener,
    removeEventListener: removeFixtureEventListener,
    querySelectorAll: (selector) => {
      if (selector === "*") return documentStateNodes();
      if (selector === "canvas") return [canvas];
      if (selector.includes("[data-step]")) return [beatNode];
      if (selector === "button,[role='button']") {
        return [
          ...((includeVariantGroup || hasNestedVariantGroup) && childVariantMounted() ? [variantPrevious, variantNext] : []),
          ...regionButtons,
          ...activityButtons,
        ];
      }
      if (selector === "[role='tablist'],[role='radiogroup'],[role='listbox'],[data-variant-group]" && includeSemanticVariantGroup) return [variantRoot];
      return [];
    },
    createElement: (tagName) => {
      const tag = String(tagName || "").toLowerCase();
      if (tag === "canvas") return createDrawingCanvas();
      if (tag === "video") return viewportVideo;
      return { click: () => {}, remove: () => {} };
    }
  };
  const windowObject = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    scrollY: 0,
    pageYOffset: 0,
    NYTAnimationProbe_DISABLE_AUTORUN: true,
    MutationObserver: FixtureMutationObserver,
    addEventListener: addFixtureEventListener,
    removeEventListener: removeFixtureEventListener,
    scrollTo: ({ top }) => {
      if (unrecoverableRegionOnReverse && currentScrollY > 0 && top < currentScrollY - 1) {
        recoveryBroken = true;
        activeRegionIndex = 1;
      }
      currentScrollY = top;
      windowObject.scrollY = top;
      windowObject.pageYOffset = top;
      collectorTimeline.push({
        type: "scroll",
        top,
        clickCount: variantClickEvents.length,
        sequence: collectorTimeline.length
      });
      if (grownDocumentHeight && top > 0) currentDocumentHeight = Math.max(currentDocumentHeight, grownDocumentHeight);
    }
  };
  windowObject.window = windowObject;
  windowObject.self = windowObject;

  let serial = 0;
  class Object3D {
    constructor(name = "") {
      this.isObject3D = true;
      this.uuid = `uuid-${++serial}`;
      this.id = serial;
      this.name = name;
      this.type = "Object3D";
      this.visible = true;
      this.children = [];
      this.parent = null;
      this.userData = {};
      this.layers = { test: () => true };
      this.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    }

    add(child) {
      child.parent = this;
      this.children.push(child);
    }

    traverse(callback) {
      callback(this);
      for (const child of this.children) child.traverse(callback);
    }
  }

  class Scene extends Object3D {
    constructor() {
      super("scene");
      this.isScene = true;
      this.type = "Scene";
    }
  }

  class Mesh extends Object3D {
    constructor(name) {
      super(name);
      this.isMesh = true;
      this.type = "Mesh";
      this.geometry = {};
      this.material = { visible: true, opacity: 1 };
    }
  }

  class Camera extends Object3D {
    constructor() {
      super("camera");
      this.type = "PerspectiveCamera";
      this.position = { x: 0, y: 1, z: 5 };
      this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
      this.fov = 50;
      this.near = 0.1;
      this.far = 1000;
      this.zoom = 1;
    }
  }

  class WebGLRenderer {
    constructor() {
      this.isWebGLRenderer = true;
      this.domElement = canvas;
    }

    render() {
      return "rendered";
    }
  }

  class GLTFLoader {
    load(url, onLoad) {
      const root = new Object3D("fixture-root");
      root.add(new Mesh("window_1"));
      onLoad({ scene: root, animations: [] });
      return root;
    }
  }

  class AnimationMixer {
    constructor(root, actions) {
      this._root = root;
      this._actions = actions;
      this.time = 0;
      this.timeScale = 1;
    }

    getRoot() {
      return this._root;
    }

    update(delta) {
      this.time += delta;
      for (const action of this._actions) action.time += delta;
      return this;
    }

    setTime(time) {
      this.time = time;
      for (const action of this._actions) action.time = time;
    }

    clipAction() {
      return this._actions[0];
    }
  }

  if (exposeThree) {
    windowObject.THREE = {
      REVISION: "fixture",
      Object3D,
      Scene,
      Mesh,
      WebGLRenderer,
      GLTFLoader,
      AnimationMixer
    };
  }

  const context = vm.createContext({
    window: windowObject,
    document,
    location: { href: "https://example.com/story.html", protocol: "https:" },
    performance,
    navigator: viewportCapture ? { mediaDevices: { getDisplayMedia: async () => viewportStream } } : {},
    console: {
      info: (...values) => consoleMessages.push(values.join(" ")),
      warn: (...values) => consoleMessages.push(values.join(" ")),
      error: (...values) => consoleMessages.push(values.join(" ")),
    },
    URL,
    Blob,
    MutationObserver: FixtureMutationObserver,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Set,
    Map,
    WeakSet,
    RegExp,
    String,
    Number,
    Boolean
  });
  vm.runInContext(collectorSource, context);
  return {
    window: windowObject,
    context,
    classes: { Scene, Camera, WebGLRenderer, GLTFLoader, AnimationMixer },
    viewportTrack,
    consoleMessages,
    variantClickEvents,
    collectorTimeline,
    canvas,
    variantRoot,
    regionStateRoot,
    externalCarouselViewport,
    externalRegionOutput,
    setVariantIndexChangeHandler(handler) {
      variantIndexChangeHandler = typeof handler === "function" ? handler : () => {};
    },
    fixtureState: () => ({
      activeVariantIndex,
      activeRegionIndex,
      activeActivityIndex,
      externalCarouselScrollLeft,
      externalRegionOutputIndex,
      unrelatedDomTick,
      activeMutationObserverCount: activeMutationObservers.size,
      activeScrollListenerCount: windowEventListeners.get("scroll")?.size || 0,
      childMounted: childVariantMounted(),
      childMountGeneration,
      unrelatedSectionRevision,
      recoveryBroken,
      scrollY: currentScrollY
    }),
  };
}

function createAction({ id, clipName, weight = 1, paused = false }) {
  return {
    uuid: id,
    _clipIndex: 0,
    time: 0.2,
    enabled: true,
    paused,
    weight,
    timeScale: 1,
    loop: 2201,
    repetitions: Infinity,
    clampWhenFinished: false,
    getClip: () => ({ name: clipName, duration: 2.5, tracks: [{ name: "window_1.rotation" }] }),
    isRunning: () => true,
    isScheduled: () => true,
    getEffectiveWeight: () => weight,
    getEffectiveTimeScale: () => 1
  };
}

test("collector records direct visible model, part, action, camera, and changing runtime state", () => {
  const fixture = createCollectorFixture();
  const loader = new fixture.classes.GLTFLoader();
  let modelRoot;
  loader.load("https://example.com/fixture.glb", (gltf) => {
    modelRoot = gltf.scene;
  });
  const playing = createAction({ id: "action-playing", clipName: "OpenWindow" });
  const paused = createAction({ id: "action-paused", clipName: "Paused", paused: true });
  const zeroWeight = createAction({ id: "action-zero", clipName: "ZeroWeight", weight: 0 });
  const mixer = new fixture.classes.AnimationMixer(modelRoot, [playing, paused, zeroWeight]);
  mixer.update(0.016);
  const scene = new fixture.classes.Scene();
  scene.add(modelRoot);
  const camera = new fixture.classes.Camera();
  scene.add(camera);
  const renderer = new fixture.classes.WebGLRenderer();
  renderer.render(scene, camera);

  const first = fixture.window.NYTAnimationProbe.snapshot();
  assert.equal(first.runtime3D.captureStatus, "ok");
  assert.match(first.runtime3D.signature, /^[0-9a-f]{8}$/);
  assert.equal(first.runtime3D.visibleModelCount, 1);
  assert.equal(first.runtime3D.models[0].assetUrl, "https://example.com/fixture.glb");
  assert.equal(first.runtime3D.models[0].sceneObserved, true);
  assert.equal(first.runtime3D.models[0].visibleParts[0].name, "window_1");
  assert.match(first.runtime3D.models[0].visibleParts[0].worldTransformSignature, /^[0-9a-f]{8}$/);
  assert.deepEqual(first.runtime3D.models[0].activeAnimations.map((action) => action.clipName), ["OpenWindow"]);
  assert.equal(first.runtime3D.models[0].mixers[0].driverObservation.recentAdvances.length, 1);
  assert.equal(first.runtime3D.activeCameras[0].name, "camera");

  modelRoot.children[0].matrixWorld.elements[0] = 2;
  fixture.window.NYTAnimationProbe.snapshot();
  assert.equal(fixture.window.NYTAnimationProbe.collect().snapshots.length, 2, "manual transform changes must survive snapshot deduplication");

  mixer.update(0.2);
  fixture.window.NYTAnimationProbe.snapshot();
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(collected.snapshots.length, 3, "changed action time must survive snapshot deduplication");

  modelRoot.visible = false;
  const hidden = fixture.window.NYTAnimationProbe.snapshot();
  assert.equal(hidden.runtime3D.visibleModelCount, 0);
  assert.equal(hidden.runtime3D.models[0].activeAnimations[0].clipName, "OpenWindow", "running action remains state, not visibility proof");
});

test("collector runtime bridge captures closure-owned state and instance-bound mixer methods", () => {
  const fixture = createCollectorFixture({ exposeThree: false });
  const loader = new fixture.classes.GLTFLoader();
  let modelRoot;
  loader.load("https://example.com/closure-owned.glb", (gltf) => { modelRoot = gltf.scene; });
  const mixer = new fixture.classes.AnimationMixer(modelRoot, [
    createAction({ id: "closure-action", clipName: "SharedTimeline" })
  ]);
  const scene = new fixture.classes.Scene();
  const camera = new fixture.classes.Camera();
  const renderer = new fixture.classes.WebGLRenderer();
  scene.add(modelRoot);
  scene.add(camera);

  mixer.update = mixer.update.bind(mixer);
  renderer.render = renderer.render.bind(renderer);
  fixture.window.NYTAnimationProbe.registerRuntime3D({
    renderer,
    scene,
    camera,
    mixer,
    models: [{ root: modelRoot, assetUrl: "https://example.com/closure-owned.glb" }]
  }, { source: "fixture-closure-runtime" });
  mixer.update(0.125);
  renderer.render(scene, camera);

  const snapshot = fixture.window.NYTAnimationProbe.snapshot();
  assert.equal(snapshot.runtime3D.captureStatus, "ok");
  assert.equal(snapshot.runtime3D.models[0].assetUrl, "https://example.com/closure-owned.glb");
  assert.deepEqual(snapshot.runtime3D.models[0].activeAnimations.map((action) => action.clipName), ["SharedTimeline"]);
  assert.equal(snapshot.runtime3D.models[0].mixers[0].driverObservation.recentAdvances.length, 1);
  assert.equal(snapshot.runtime3D.activeCameras[0].name, "camera");
  assert.equal(snapshot.runtime3D.capabilities.runtimeBridgeFound, true);
  assert.equal(snapshot.runtime3D.capabilities.instanceMixerHooked, true);
  assert.equal(snapshot.runtime3D.counts.runtimeBridges, 1);
});

test("collector discovers a late runtime bridge attached to the renderer canvas", () => {
  const fixture = createCollectorFixture({ exposeThree: false });
  const loader = new fixture.classes.GLTFLoader();
  let modelRoot;
  loader.load("https://example.com/canvas-owned.glb", (gltf) => { modelRoot = gltf.scene; });
  const mixer = new fixture.classes.AnimationMixer(modelRoot, [
    createAction({ id: "canvas-action", clipName: "CanvasTimeline" })
  ]);
  const scene = new fixture.classes.Scene();
  const camera = new fixture.classes.Camera();
  const renderer = new fixture.classes.WebGLRenderer();
  scene.add(modelRoot);
  scene.add(camera);
  fixture.canvas.__storyvrAnimationProbeRuntime = {
    renderer,
    scene,
    camera,
    mixer,
    models: [{ root: modelRoot, assetUrl: "https://example.com/canvas-owned.glb" }]
  };

  fixture.window.NYTAnimationProbe.refreshRuntimeHooks();
  mixer.update(0.25);
  renderer.render(scene, camera);
  const snapshot = fixture.window.NYTAnimationProbe.snapshot();

  assert.equal(snapshot.runtime3D.captureStatus, "ok");
  assert.equal(snapshot.runtime3D.models[0].assetUrl, "https://example.com/canvas-owned.glb");
  assert.equal(snapshot.runtime3D.capabilities.domRuntimeHandlesInspected, true);
  assert.equal(snapshot.runtime3D.counts.domRuntimeHandles, 1);
});

test("collector seeds preexisting Performance resource entries during startup", () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    initialResourceEntries: [{
      name: "https://example.com/preloaded-model.glb",
      initiatorType: "fetch",
      startTime: 12,
      duration: 4,
      transferSize: 128
    }]
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(collected.candidate_resources.length, 1);
  assert.equal(collected.candidate_resources[0].url, "https://example.com/preloaded-model.glb");
});

test("collector can be pasted again without leaving runtime hooks attached only to stale state", () => {
  const fixture = createCollectorFixture();
  vm.runInContext(collectorSource, fixture.context);

  const loader = new fixture.classes.GLTFLoader();
  let modelRoot;
  loader.load("https://example.com/reinstalled.glb", (gltf) => {
    modelRoot = gltf.scene;
  });
  const mixer = new fixture.classes.AnimationMixer(modelRoot, [createAction({ id: "reinstalled-action", clipName: "Reinstalled" })]);
  mixer.update(0.016);
  const scene = new fixture.classes.Scene();
  const camera = new fixture.classes.Camera();
  scene.add(modelRoot);
  scene.add(camera);
  new fixture.classes.WebGLRenderer().render(scene, camera);

  const snapshot = fixture.window.NYTAnimationProbe.snapshot();
  assert.equal(snapshot.runtime3D.captureStatus, "ok");
  assert.equal(snapshot.runtime3D.models[0].assetUrl, "https://example.com/reinstalled.glb");
  assert.deepEqual(snapshot.runtime3D.models[0].activeAnimations.map((action) => action.clipName), ["Reinstalled"]);
});

test("collector distinguishes unavailable runtime instrumentation from observed empty state", () => {
  const fixture = createCollectorFixture({ exposeThree: false });
  const snapshot = fixture.window.NYTAnimationProbe.snapshot();
  assert.equal(snapshot.runtime3D.captureStatus, "unavailable");
  assert.match(snapshot.runtime3D.reason, /No reachable Three\.js/);
  assert.equal(snapshot.runtime3D.models.length, 0);
});

test("collector captures the composited tab viewport as primary evidence and keeps the canvas crop secondary", async () => {
  const fixture = createCollectorFixture({ exposeThree: false, initialDocumentHeight: 900, viewportCapture: true });
  await fixture.window.NYTAnimationProbe.enableViewportCapture({ autoStart: false });
  assert.equal(fixture.window.NYTAnimationProbe.viewportCapture().status, "ready");
  await fixture.window.NYTAnimationProbe.autoScroll({
    minStepPx: 100,
    maxStepPx: 100,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 1000,
    driverSampleGapMs: 0,
    maxSteps: 2
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(collected.capture_coverage.viewportScreenshotCaptureCount, collected.capture_coverage.visitedScrollTargetCount);
  assert.equal(collected.capture_coverage.canvasFallbackCaptureCount, 0);
  assert.equal(collected.scroll_target_screenshots.every((item) => (
    item.captureMethod === "display-media-tab-viewport"
    && item.canvasCrop.status === "ok"
    && item.canvasCrop.captureMethod === "resized-canvas-copy"
  )), true);
  fixture.window.NYTAnimationProbe.stop();
  assert.equal(fixture.viewportTrack.stopped, true);
});

test("collector captures separate composited screenshots for viewport-aligned variant states", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    initialDocumentHeight: 900,
    viewportCapture: true,
    includeButtonClusterVariantGroup: true,
  });
  await fixture.window.NYTAnimationProbe.enableViewportCapture({ autoStart: false });
  await fixture.window.NYTAnimationProbe.autoScroll({
    minStepPx: 100,
    maxStepPx: 100,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 100,
    driverSampleGapMs: 0,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();

  assert.equal(collected.variant_state_screenshots.length > 0, true);
  assert.equal(collected.variant_state_screenshots.every((item) => item.status === "ok" && item.captureMethod === "display-media-tab-viewport"), true);
  assert.equal(collected.variant_state_screenshots.every((item) => (
    ["pass-1-discovery", "pass-2-capture"].includes(item.explorationPhase)
    && ["bottom", "top"].includes(item.viewportAlignment)
  )), true);
  assert.equal(collected.capture_coverage.variantStateScreenshotCaptureCount, collected.variant_state_screenshots.length);
  assert.equal(collected.variant_asset_associations.every((association) => association.visualEvidenceRefs.length > 0), true);
});

test("auto-scroll appends targets when lazy layout growth extends the document", async () => {
  const fixture = createCollectorFixture({ exposeThree: false, initialDocumentHeight: 700, grownDocumentHeight: 1000 });
  await fixture.window.NYTAnimationProbe.autoScroll({
    minStepPx: 100,
    maxStepPx: 100,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 1000,
    driverSampleGapMs: 0,
    allowCanvasFallback: true
  });
  const coverage = fixture.window.NYTAnimationProbe.collect().capture_coverage;
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(coverage.documentGrowthDetected, true);
  assert.equal(coverage.stoppedEarly, false);
  assert.equal(coverage.skippedScrollTargetCount, 0);
  assert(coverage.visitedScrollTargetCount >= 4);
  assert.equal(coverage.screenshotCaptureCount, coverage.visitedScrollTargetCount);
  assert.equal(coverage.viewportScreenshotCaptureCount, 0);
  assert.equal(coverage.canvasFallbackCaptureCount, coverage.visitedScrollTargetCount);
  assert.equal(coverage.canvasCropCaptureCount, coverage.visitedScrollTargetCount);
  assert.equal(collected.scroll_target_screenshots.length, coverage.visitedScrollTargetCount);
  assert.equal(collected.scroll_target_screenshots.every((item, index) => (
    item.targetIndex === index
    && item.status === "ok"
    && item.captureMethod === "canvas-only-fallback"
    && item.canvasCrop.status === "ok"
  )), true);
  assert.equal(collected.scroll_target_contact_sheets.length >= 1, true);
});

test("collector records a generic previous-next within-beat variant group without story-specific labels", () => {
  const fixture = createCollectorFixture({ exposeThree: false, includeVariantGroup: true });
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(collected.variant_groups.length, 1);
  assert.equal(collected.variant_groups[0].title, "Choose a habitat");
  assert.equal(collected.variant_groups[0].control.kind, "previous-next");
  assert.equal(collected.variant_groups[0].defaultOptionId, "forest-option");
  assert.deepEqual(
    JSON.parse(JSON.stringify(collected.variant_groups[0].options.map((option) => [option.label, option.assetUrls[0]]))),
    [
      ["Forest", "https://example.com/forest.glb"],
      ["Desert", "https://example.com/desert.glb"],
    ],
  );
  assert.equal(JSON.stringify(collected.storyvr_author_input.variant_groups), JSON.stringify(collected.variant_groups));
});

test("collector records a generic semantic single-choice control group", () => {
  const fixture = createCollectorFixture({ exposeThree: false, includeSemanticVariantGroup: true });
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(collected.variant_groups.length, 1);
  assert.equal(collected.variant_groups[0].control.kind, "tabs");
  assert.equal(collected.variant_groups[0].defaultOptionId, "forest-option");
  assert.deepEqual(
    JSON.parse(JSON.stringify(collected.variant_groups[0].options.map((option) => option.label))),
    ["Forest", "Desert"],
  );
});

test("collector safely explores previous-next variants, captures distinct assets, and restores the initial state", async () => {
  const fixture = createCollectorFixture({ exposeThree: false, includeVariantGroup: true });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();

  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].restored, true);
  assert.deepEqual(JSON.parse(JSON.stringify(interactions[0].capturedOptionIds)), ["forest-option", "desert-option"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(collected.variant_asset_associations.map((association) => [association.optionLabel, association.assetUrls]))),
    [
      ["Forest", ["https://example.com/forest.glb"]],
      ["Desert", ["https://example.com/desert.glb"]],
    ],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(collected.variant_groups[0].options.map((option) => [option.label, option.assetUrls]))),
    [
      ["Forest", ["https://example.com/forest.glb"]],
      ["Desert", ["https://example.com/desert.glb"]],
    ],
  );
  assert.equal(collected.variant_interactions[0].restored, true);
  assert.equal(collected.capture_coverage.variantGroupExploredCount, 1);
  assert.equal(collected.capture_coverage.variantOptionStateCaptureCount, 2);
});

test("collector explores a story-local nav whose option node is dynamically replaced", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    dynamicVariantOptions: true,
  });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const group = collected.variant_groups.find((candidate) => candidate.control.kind === "previous-next");

  assert(group);
  assert.deepEqual(JSON.parse(JSON.stringify(group.options.map((option) => option.label))), ["Forest", "Desert"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(collected.variant_asset_associations.map((association) => [association.optionLabel, association.assetUrls]))),
    [
      ["Forest", ["https://example.com/forest.glb"]],
      ["Desert", ["https://example.com/desert.glb"]],
    ],
  );
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].capturedOptionIds.length, 2);
  assert.equal(interactions[0].restored, true);
  assert.equal(fixture.variantClickEvents.some((event) => event.kind === "carousel" && /next/i.test(event.label)), true);
});

test("directional exploration follows bounded output changes when laid-out slides have no selected state", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    directionalOutputOnlyState: true,
  });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    explorationPhase: "pass-1-discovery",
    viewportAlignment: "bottom",
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const group = collected.variant_groups.find((candidate) => candidate.control.kind === "previous-next");
  const interaction = interactions.find((candidate) => candidate.groupId === group?.id);
  const associations = collected.variant_asset_associations.filter((association) => association.groupId === group?.id);

  assert(group);
  assert(interaction);
  assert.deepEqual(JSON.parse(JSON.stringify(group.options.map((option) => option.label))), ["Forest", "Desert"]);
  assert.equal(new Set(interaction.capturedOptionIds).size, 2, "output signatures, not the first laid-out slide, identify directional states");
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.failures)), []);
  assert.equal(interaction.restored, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(associations.map((association) => [association.optionLabel, association.assetUrls]))),
    [
      ["Forest", ["https://example.com/forest.glb"]],
      ["Desert", ["https://example.com/desert.glb"]],
    ],
  );
  assert.equal(fixture.variantClickEvents.some((event) => event.kind === "carousel" && /next/i.test(event.label)), true);
  assert.equal(fixture.variantClickEvents.some((event) => event.kind === "carousel" && /previous/i.test(event.label)), true);
});

test("directional exploration accepts horizontal scroll state outside the local root and restores it", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    directionalRuntimeOnlyState: true,
    directionalExternalScrollState: true,
  });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 2,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
    variantDocumentQuietMs: 0,
    variantVisualStabilitySampleMs: 0,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const interaction = interactions.find((candidate) => candidate.controlKind === "previous-next");

  assert(interaction);
  assert.equal(fixture.variantRoot.contains(fixture.externalCarouselViewport), false, "the horizontal output is outside the dependency root");
  assert.deepEqual(
    JSON.parse(JSON.stringify(interaction.capturedOptionIds)),
    ["forest-option", "desert-option"],
    "a document-wide horizontal scroll delta identifies the next option even when local state is unchanged",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.failures)), []);
  assert.equal(
    fixture.variantClickEvents.some((event) => (
      event.kind === "carousel"
      && /next/i.test(event.label)
      && event.externalCarouselScrollLeft === 500
    )),
    true,
    "the directional click must actually move the external viewport",
  );
  assert.equal(interaction.restored, true);
  assert.equal(fixture.fixtureState().externalCarouselScrollLeft, 0, "restoration must return the document-wide scroll state to baseline");
  assert.equal(interaction.outcomeObservationScope, "document");
  assert.equal(
    interaction.outcomeObservations.some((observation) => observation.direction === "next" && observation.scrollChanged),
    true,
    "the exported click outcome must identify the document-wide scroll channel",
  );
  assert.equal(collected.capture_coverage.variantDocumentWideObservationCount >= 1, true);
  assert.equal(collected.capture_coverage.variantClickSuccessCount >= 1, true);
});

test("document-wide monitoring waits for asynchronous smooth-scroll output to settle", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    directionalRuntimeOnlyState: true,
    directionalAsyncExternalScrollState: true,
  });
  const baselineScrollListenerCount = fixture.fixtureState().activeScrollListenerCount;
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 2,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 150,
    variantDocumentQuietMs: 20,
    variantVisualStabilitySampleMs: 0,
  });
  const interaction = interactions.find((candidate) => candidate.controlKind === "previous-next");
  const nextOutcome = interaction?.outcomeObservations.find((observation) => observation.direction === "next");

  assert(interaction);
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.capturedOptionIds)), ["forest-option", "desert-option"]);
  assert(nextOutcome);
  assert.equal(nextOutcome.scrollChanged, true);
  assert.equal(nextOutcome.scrollSettled, true);
  assert.equal(nextOutcome.scrollEventCount >= 4, true, "the monitor must remain attached for the smooth-scroll sequence");
  assert.equal(interaction.restored, true);
  assert.equal(fixture.fixtureState().externalCarouselScrollLeft, 0);
  assert.equal(fixture.fixtureState().activeMutationObserverCount, 0);
  assert.equal(fixture.fixtureState().activeScrollListenerCount, baselineScrollListenerCount);
});

test("document-wide scroll evidence advances a multi-option carousel when its local selection stays stale", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    includeThirdDirectionalOption: true,
    directionalRuntimeOnlyState: true,
    directionalExternalScrollState: true,
  });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 3,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
    variantDocumentQuietMs: 0,
    variantVisualStabilitySampleMs: 0,
  });
  const interaction = interactions.find((candidate) => candidate.controlKind === "previous-next");

  assert(interaction);
  assert.deepEqual(
    JSON.parse(JSON.stringify(interaction.capturedOptionIds)),
    ["forest-option", "desert-option", "coast-option"],
    "the logical directional cursor must advance beyond the locally stale first option",
  );
  assert.equal(
    fixture.variantClickEvents.some((event) => /next/i.test(event.label) && event.externalCarouselScrollLeft === 1000),
    true,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.failures)), []);
  assert.equal(interaction.restored, true);
  assert.equal(fixture.fixtureState().externalCarouselScrollLeft, 0);
});

test("continuous canvas and transform motion does not turn a no-op arrow into directional advancement", async () => {
  const fixture = createCollectorFixture({
    exposeThree: true,
    includeVariantGroup: true,
    includeVariantCanvas: true,
    directionalRuntimeOnlyState: true,
    directionalControlsNoop: true,
  });
  const loader = new fixture.classes.GLTFLoader();
  let modelRoot;
  loader.load("https://example.com/continuously-moving.glb", (gltf) => { modelRoot = gltf.scene; });
  let transformFrame = 0;
  Object.defineProperty(modelRoot.children[0].matrixWorld, "elements", {
    configurable: true,
    get: () => {
      transformFrame += 1;
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, transformFrame / 100, 0, 0, 1];
    },
  });
  let canvasFrame = 0;
  fixture.canvas.toDataURL = () => `data:image/png;base64,continuous-${++canvasFrame}`;
  const scene = new fixture.classes.Scene();
  const camera = new fixture.classes.Camera();
  scene.add(modelRoot);
  scene.add(camera);
  new fixture.classes.WebGLRenderer().render(scene, camera);

  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 3,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const interaction = interactions.find((candidate) => candidate.controlKind === "previous-next");

  assert(interaction);
  assert.deepEqual(
    JSON.parse(JSON.stringify(interaction.capturedOptionIds)),
    ["forest-option"],
    "time-based pixels and transforms must not fabricate a second option",
  );
  assert.equal(interaction.failures.some((failure) => failure.reason === "output-state-did-not-change"), true);
  assert.equal(interaction.restored, true, "a no-op control must leave the initial discrete state restored");
  assert.equal(fixture.fixtureState().activeVariantIndex, 0);
});

test("continuous unrelated document churn does not turn a no-op arrow into advancement or a restoration failure", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    directionalRuntimeOnlyState: true,
    directionalControlsNoop: true,
    includeContinuousUnrelatedDomChurn: true,
  });

  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 3,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 60,
    variantDocumentQuietMs: 20,
    variantVisualStabilitySampleMs: 0,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const interaction = interactions.find((candidate) => candidate.controlKind === "previous-next");

  assert(interaction);
  assert.equal(fixture.fixtureState().unrelatedDomTick > 0, true, "the unrelated document state must actually churn");
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.capturedOptionIds)), ["forest-option"]);
  assert.equal(interaction.failures.some((failure) => failure.reason === "output-state-did-not-change"), true);
  assert.equal(interaction.outputChangeKinds.length, 0, "unsettled ambient DOM churn is not a persistent click outcome");
  assert.equal(interaction.outcomeObservations.some((observation) => observation.rawDomChanged && !observation.domChanged), true);
  assert.equal(interaction.restored, true, "ambient document churn must not strand a no-op control in recovery");
  assert.equal(collected.capture_coverage.variantDocumentWideUnsettledCount >= 1, true);
  assert.equal(fixture.fixtureState().activeVariantIndex, 0);
});

test("continuous runtime visibility and opacity do not turn a no-op arrow into advancement", async () => {
  const fixture = createCollectorFixture({
    exposeThree: true,
    includeVariantGroup: true,
    includeVariantCanvas: true,
    directionalRuntimeOnlyState: true,
    directionalControlsNoop: true,
  });
  const loader = new fixture.classes.GLTFLoader();
  let modelRoot;
  loader.load("https://example.com/visibility-loop.glb", (gltf) => { modelRoot = gltf.scene; });
  let visibilityFrame = 0;
  Object.defineProperty(modelRoot, "visible", {
    configurable: true,
    get: () => (++visibilityFrame % 2) === 0,
    set: () => {},
  });
  let opacityFrame = 0;
  Object.defineProperty(modelRoot.children[0].material, "opacity", {
    configurable: true,
    get: () => (++opacityFrame % 2) === 0 ? 1 : 0,
    set: () => {},
  });
  const scene = new fixture.classes.Scene();
  const camera = new fixture.classes.Camera();
  scene.add(modelRoot);
  scene.add(camera);
  new fixture.classes.WebGLRenderer().render(scene, camera);

  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 3,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const interaction = interactions.find((candidate) => candidate.controlKind === "previous-next");

  assert(interaction);
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.capturedOptionIds)), ["forest-option"]);
  assert.equal(interaction.failures.some((failure) => failure.reason === "output-state-did-not-change"), true);
  assert.equal(interaction.restored, true);
  assert.equal(fixture.fixtureState().activeVariantIndex, 0);
});

test("a WebGL-only discrete asset swap still counts as directional advancement", async () => {
  const fixture = createCollectorFixture({
    exposeThree: true,
    includeVariantGroup: true,
    includeVariantCanvas: true,
    directionalRuntimeOnlyState: true,
  });
  const loader = new fixture.classes.GLTFLoader();
  const roots = [];
  loader.load("https://example.com/forest-runtime.glb", (gltf) => roots.push(gltf.scene));
  loader.load("https://example.com/desert-runtime.glb", (gltf) => roots.push(gltf.scene));
  roots[0].visible = true;
  roots[1].visible = false;
  const scene = new fixture.classes.Scene();
  const camera = new fixture.classes.Camera();
  scene.add(roots[0]);
  scene.add(roots[1]);
  scene.add(camera);
  const renderer = new fixture.classes.WebGLRenderer();
  const renderVariant = (index) => {
    roots.forEach((root, rootIndex) => { root.visible = rootIndex === index; });
    renderer.render(scene, camera);
  };
  fixture.setVariantIndexChangeHandler(renderVariant);
  renderVariant(0);

  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 3,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const interaction = interactions.find((candidate) => candidate.controlKind === "previous-next");
  const associations = collected.variant_asset_associations.filter((association) => association.groupId === interaction?.groupId);

  assert(interaction);
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.capturedOptionIds)), ["forest-option", "desert-option"]);
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.failures)), []);
  assert.equal(interaction.restored, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(associations.map((association) => [association.optionLabel, association.runtimeAssetUrls]))),
    [
      ["Forest", ["https://example.com/forest-runtime.glb"]],
      ["Desert", ["https://example.com/desert-runtime.glb"]],
    ],
  );
});

test("continuous child-canvas motion does not create parent-child hierarchy causality", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    includeNestedVariantGroup: true,
    includeVariantCanvas: true,
  });
  let canvasFrame = 0;
  fixture.canvas.toDataURL = () => `data:image/png;base64,continuous-child-${++canvasFrame}`;

  await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 2,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();

  assert.deepEqual(
    JSON.parse(JSON.stringify(collected.variant_hierarchy)),
    [],
    "independent temporal canvas motion is not a causal response to a parent click",
  );
  assert.equal(collected.capture_coverage.variantDependencyObservationCount, 0);
});

test("continuous visual motion does not create recovery mismatches or suppress Pass 2", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    includeVariantCanvas: true,
    initialDocumentHeight: 1200,
  });
  let canvasFrame = 0;
  fixture.canvas.toDataURL = () => `data:image/png;base64,recovery-motion-${++canvasFrame}`;

  await fixture.window.NYTAnimationProbe.autoScroll({
    captureScreenshots: false,
    exploreVariants: false,
    minStepPx: 300,
    maxStepPx: 300,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 100,
    driverSampleGapMs: 0,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();

  assert.equal(collected.variant_recovery.mismatchCount, 0);
  assert.equal(collected.variant_recovery.status, "verified");
  assert.equal(collected.capture_coverage.pass2VisitedTargetCount > 0, true);
  assert.equal(collected.capture_coverage.pass2SkippedReason || "", "");
});

test("collector continues to exclude directional buttons in global page navigation", () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeVariantGroup: true,
    variantNavIsGlobal: true,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(collected.variant_groups.length, 0);
});

test("dependency transition budget stops new exploration but still permits restoration", async () => {
  const fixture = createCollectorFixture({ exposeThree: false, includeVariantGroup: true });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantDependencyTransitions: 1,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();

  assert.equal(collected.capture_coverage.variantDependencyTransitionCount, 1);
  assert.equal(collected.capture_coverage.variantDependencyTransitionBudgetReached, true);
  assert.equal(collected.capture_coverage.variantRecoveryTransitionCount >= 1, true);
  assert.equal(interactions[0].restored, true);
  assert.equal(fixture.fixtureState().activeVariantIndex, 0);
});

test("auto-scroll eagerly explores offscreen story buttons before regular scrolling", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    initialDocumentHeight: 1900,
    regionDocumentTop: 1200,
  });
  await fixture.window.NYTAnimationProbe.autoScroll({
    captureScreenshots: false,
    minStepPx: 100,
    maxStepPx: 100,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 100,
    driverSampleGapMs: 0,
    maxSteps: 1,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const regionInteraction = collected.variant_interactions.find((interaction) => interaction.controlKind === "button-cluster");

  assert(regionInteraction);
  assert.equal(regionInteraction.explorationPhase, "pass-1-discovery-eager");
  assert.equal(regionInteraction.restored, true);
  assert.equal(fixture.variantClickEvents.some((event) => event.kind === "region" && event.label === "South" && event.scrollY === 0), true);
});

test("collector groups story option buttons even when each button has its own wrapper", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    wrapButtonClusterControls: true,
  });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const region = collected.variant_groups.find((group) => group.control.kind === "button-cluster");

  assert(region);
  assert.deepEqual(JSON.parse(JSON.stringify(region.options.map((option) => option.label))), ["North", "South"]);
  assert.equal(interactions.some((interaction) => interaction.groupId === region.id && interaction.restored), true);
  assert.equal(fixture.variantClickEvents.some((event) => event.kind === "region" && event.label === "South"), true);
});

test("button-cluster exploration accepts DOM output outside the local root and restores it", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    buttonClusterExternalOutputOnlyState: true,
  });
  const interactions = await fixture.window.NYTAnimationProbe.exploreVariants({
    maxVariantOptions: 2,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
    variantDocumentQuietMs: 0,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const interaction = interactions.find((candidate) => candidate.controlKind === "button-cluster");
  const southClick = fixture.variantClickEvents.find((event) => event.kind === "region" && event.label === "South");

  assert(interaction);
  assert.equal(fixture.regionStateRoot.contains(fixture.externalRegionOutput), false, "the changed DOM output is outside the dependency root");
  assert.deepEqual(
    JSON.parse(JSON.stringify(interaction.capturedOptionIds)),
    ["north-region", "south-region"],
    "the external DOM delta verifies South even though the local controls continue to report North",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(interaction.failures)), []);
  assert(southClick);
  assert.equal(southClick.activeRegionIndex, 0, "the scoped control state remains unchanged during the click");
  assert.equal(southClick.externalRegionOutputIndex, 1, "the click must change the outside-root output");
  assert.equal(interaction.restored, true);
  assert.equal(fixture.fixtureState().activeRegionIndex, 0);
  assert.equal(fixture.fixtureState().externalRegionOutputIndex, 0, "restoration must reset the outside-root DOM output");
  assert.equal(interaction.outcomeObservationScope, "document");
  assert.equal(
    interaction.outcomeObservations.some((observation) => observation.optionId === "south-region" && observation.domChanged),
    true,
    "the exported click outcome must identify the document-wide DOM channel",
  );
  assert.equal(collected.capture_coverage.variantDocumentWideChangeCount >= 1, true);
  assert.equal(collected.capture_coverage.variantClickSuccessCount >= 1, true);
});

test("variant options do not inherit render-eligible models from an unrelated page canvas", async () => {
  const fixture = createCollectorFixture({ exposeThree: true, includeButtonClusterVariantGroup: true });
  const loader = new fixture.classes.GLTFLoader();
  let modelRoot;
  loader.load("https://example.com/unrelated.glb", (gltf) => { modelRoot = gltf.scene; });
  const scene = new fixture.classes.Scene();
  const camera = new fixture.classes.Camera();
  scene.add(modelRoot);
  scene.add(camera);
  new fixture.classes.WebGLRenderer().render(scene, camera);

  await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const regionAssociations = collected.variant_asset_associations.filter((association) => association.groupTitle === "Choose a region");

  assert.equal(regionAssociations.length, 2);
  assert.equal(regionAssociations.every((association) => association.runtimeAssetUrls.length === 0), true);
  assert.equal(regionAssociations.every((association) => association.assetUrls.length === 0), true);
});

test("auto-scroll repeats story-button exploration with the controls aligned to the viewport", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    initialDocumentHeight: 1800,
    regionDocumentTop: 910,
  });
  await fixture.window.NYTAnimationProbe.autoScroll({
    captureScreenshots: false,
    minStepPx: 100,
    maxStepPx: 100,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 100,
    driverSampleGapMs: 0,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const southEvents = fixture.variantClickEvents.filter((event) => event.kind === "region" && event.label === "South");
  const phases = collected.variant_interactions.map((interaction) => interaction.explorationPhase);

  assert.equal(southEvents.some((event) => event.scrollY === 0), true);
  assert.equal(southEvents.some((event) => Math.abs(event.controlTop - 12) <= 1), true);
  assert.equal(phases.includes("pass-1-discovery-eager"), true);
  assert.equal(phases.includes("pass-1-discovery"), true);
  assert.equal(phases.includes("pass-2-capture"), true);
  assert.equal(collected.variant_asset_associations.length, 2, "repeat passes must merge evidence for the same two options");
  assert.equal(collected.variant_interactions.every((interaction) => interaction.restored), true);
});

test("auto-scroll orders discovery, passive recovery, and capture as three distinct sweeps", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    includeIndependentButtonGroups: true,
    initialDocumentHeight: 1800,
    regionDocumentTop: 320,
  });
  await fixture.window.NYTAnimationProbe.autoScroll({
    captureScreenshots: false,
    minStepPx: 300,
    maxStepPx: 300,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 100,
    driverSampleGapMs: 0,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const topLevelInteractions = collected.variant_interactions.filter((interaction) => !interaction.parentGroupId);
  const discoveryInteractions = topLevelInteractions.filter((interaction) => interaction.explorationPhase === "pass-1-discovery");
  const captureInteractions = topLevelInteractions.filter((interaction) => interaction.explorationPhase === "pass-2-capture");
  const recoverySnapshots = collected.snapshots.filter((snapshot) => /^recovery-sweep(?:-|$)/.test(snapshot.label));
  const phaseOrder = topLevelInteractions.map((interaction) => interaction.explorationPhase);
  const firstCaptureIndex = phaseOrder.indexOf("pass-2-capture");
  const lastDiscoveryIndex = phaseOrder.lastIndexOf("pass-1-discovery");

  assert.deepEqual(
    JSON.parse(JSON.stringify(discoveryInteractions.map((interaction) => interaction.groupTitle))),
    ["Choose a region", "Choose an activity"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(captureInteractions.map((interaction) => interaction.groupTitle))),
    ["Choose a region", "Choose an activity"],
  );
  assert.equal(discoveryInteractions.every((interaction) => interaction.viewportAlignment === "bottom"), true);
  assert.equal(captureInteractions.every((interaction) => interaction.viewportAlignment === "top"), true);
  assert.equal(firstCaptureIndex > lastDiscoveryIndex, true);
  assert.equal(recoverySnapshots.length >= 2, true, "recovery must advance through more than one passive station");
  assert.equal(
    recoverySnapshots.slice(1).every((snapshot, index) => snapshot.scrollY <= recoverySnapshots[index].scrollY),
    true,
    "recovery must move progressively from the bottom toward the top",
  );
  assert.equal(
    recoverySnapshots.some((snapshot, index) => index > 0 && snapshot.scrollY < recoverySnapshots[index - 1].scrollY),
    true,
  );
  assert.equal(topLevelInteractions.some((interaction) => interaction.explorationPhase === "recovery-sweep"), false);
  assert.deepEqual(
    Array.from(new Set(collected.scroll_traversal.map((record) => `${record.phase}:${record.direction}`))),
    [
      "pass-1-discovery:top-to-bottom",
      "recovery-sweep:bottom-to-top",
      "pass-2-capture:top-to-bottom",
    ],
  );
  assert.equal(collected.variant_recovery.status !== "not-run", true);
  assert.equal(collected.variant_recovery.visitedTargetCount, recoverySnapshots.length);
  assert.equal(
    collected.variant_asset_associations.every((association) => (
      association.capturePhases.includes("pass-1-discovery")
      && association.capturePhases.includes("pass-2-capture")
      && !association.capturePhases.includes("recovery-sweep")
    )),
    true,
    "the recovery sweep must not click or record option-state captures",
  );
});

test("an incomplete recovery exports a partial run without executing Pass 2", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    initialDocumentHeight: 1500,
    regionDocumentTop: 320,
    unrecoverableRegionOnReverse: true,
  });
  const completed = await fixture.window.NYTAnimationProbe.autoScroll({
    captureScreenshots: false,
    minStepPx: 300,
    maxStepPx: 300,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 100,
    driverSampleGapMs: 0,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();

  assert.equal(completed, true, "the partial evidence remains exportable");
  assert.equal(collected.variant_recovery.status, "incomplete");
  assert.equal(collected.capture_coverage.pass2VisitedTargetCount, 0);
  assert.match(collected.capture_coverage.pass2SkippedReason, /^recovery-incomplete$/);
  assert.equal(collected.capture_coverage.activePassCount, 1);
  assert.equal(collected.capture_coverage.stoppedEarly, true);
  assert.equal(collected.variant_interactions.some((interaction) => interaction.explorationPhase === "pass-2-capture"), false);
});

test("an unrelated mutation inside a shared story section does not create variant hierarchy", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    includeIndependentButtonGroups: true,
    includeUnrelatedSectionMutation: true,
  });
  await fixture.window.NYTAnimationProbe.exploreVariants({
    explorationPhase: "pass-1-discovery",
    viewportAlignment: "bottom",
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const buttonGroups = collected.variant_groups.filter((group) => group.control.kind === "button-cluster");

  assert.equal(fixture.fixtureState().unrelatedSectionRevision > 0, true, "the shared-section visual must actually mutate");
  assert.deepEqual(
    JSON.parse(JSON.stringify(buttonGroups.map((group) => group.options.map((option) => option.label)))),
    [["North", "South"], ["Surf", "Swim"]],
  );
  assert.equal(buttonGroups.every((group) => group.hierarchy.role === "candidate-top-level"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(collected.variant_hierarchy)), []);
  assert.equal(collected.capture_coverage.variantDependencyObservationCount, 0, "whole-document click monitoring must not widen dependency fingerprints");
  assert.equal(collected.variant_interactions.filter((interaction) => !interaction.parentGroupId).length, 2);
});

test("a conditional child is explored depth-first while its parent is active and survives remounts", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    includeConditionalNestedVariantGroup: true,
    initialDocumentHeight: 1500,
    regionDocumentTop: 320,
  });
  await fixture.window.NYTAnimationProbe.autoScroll({
    captureScreenshots: false,
    minStepPx: 240,
    maxStepPx: 240,
    settleMs: 0,
    networkQuietMs: 0,
    maxWaitMs: 100,
    driverSampleGapMs: 0,
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const parentGroup = collected.variant_groups.find((group) => (
    group.control.kind === "button-cluster"
    && group.options.some((option) => option.id === "south-region")
  ));
  const childInteractions = collected.variant_interactions.filter((interaction) => interaction.parentGroupId === parentGroup?.id);
  const childAssociations = collected.variant_asset_associations.filter((association) => association.parentGroupId === parentGroup?.id);
  const childEdges = collected.variant_hierarchy.filter((edge) => edge.parentGroupId === parentGroup?.id);
  const carouselClicks = fixture.variantClickEvents.filter((event) => event.kind === "carousel");
  const southActivations = fixture.variantClickEvents.filter((event) => event.kind === "region" && event.label === "South");

  assert(parentGroup);
  assert.equal(childInteractions.length >= 2, true, "the remounted child must be rediscovered in discovery and capture");
  assert.equal(new Set(childInteractions.map((interaction) => interaction.groupId)).size, 1, "remounts retain one semantic child id");
  assert.equal(childInteractions.every((interaction) => interaction.parentOptionId === "south-region"), true);
  assert.equal(childInteractions.some((interaction) => interaction.explorationPhase.startsWith("pass-1-discovery")), true);
  assert.equal(childInteractions.some((interaction) => interaction.explorationPhase === "pass-2-capture"), true);
  assert.equal(childAssociations.length, 2);
  assert.equal(childAssociations.every((association) => association.parentOptionId === "south-region"), true);
  assert.equal(childAssociations.every((association) => association.dependencyConfirmed === true), true);
  assert.equal(childEdges.length >= 1, true);
  assert.equal(childEdges.every((edge) => edge.parentOptionId === "south-region"), true);
  assert.equal(childEdges.every((edge) => edge.confirmed === true && edge.observationCount >= 2), true);
  assert.equal(carouselClicks.length > 0, true);
  assert.equal(carouselClicks.every((event) => event.parentRegionIndex === 1), true, "DFS must finish before restoring the parent");
  assert.equal(new Set(carouselClicks.map((event) => event.childMountGeneration)).size >= 2, true, "the child must be used after more than one mount");
  assert.equal(southActivations.length >= 2, true);
  for (const activation of southActivations) {
    const restoration = fixture.variantClickEvents.find((event) => (
      event.sequence > activation.sequence
      && event.kind === "region"
      && event.label === "North"
    ));
    assert(restoration);
    assert.equal(fixture.variantClickEvents.some((event) => (
      event.sequence > activation.sequence
      && event.sequence < restoration.sequence
      && event.kind === "carousel"
      && event.parentRegionIndex === 1
    )), true);
  }
  const finalState = fixture.fixtureState();
  assert.equal(finalState.activeVariantIndex, 0);
  assert.equal(finalState.activeRegionIndex, 0);
  assert.equal(finalState.childMounted, false, "final restoration must return to the parent baseline and unmount the conditional child");
  assert.equal(finalState.childMountGeneration >= 2, true);
});

test("independent button groups under one story shell remain top-level and are both explored", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeButtonClusterVariantGroup: true,
    includeIndependentButtonGroups: true,
  });
  await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const buttonGroups = collected.variant_groups.filter((group) => group.control.kind === "button-cluster");

  assert.deepEqual(
    JSON.parse(JSON.stringify(buttonGroups.map((group) => group.options.map((option) => option.label)))),
    [["North", "South"], ["Surf", "Swim"]],
  );
  assert.equal(buttonGroups.every((group) => group.hierarchy.role === "candidate-top-level"), true);
  assert.equal(collected.variant_hierarchy.length, 0);
  assert.equal(collected.variant_interactions.filter((interaction) => !interaction.parentGroupId).length, 2);
});

test("collector explores semantic variant options through their explicit selectable controls", async () => {
  const fixture = createCollectorFixture({ exposeThree: false, includeSemanticVariantGroup: true });
  await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();

  assert.equal(collected.variant_asset_associations.length, 2);
  assert.equal(collected.variant_interactions[0].controlKind, "tabs");
  assert.equal(collected.variant_interactions[0].restored, true);
  assert.equal(collected.variant_groups[0].defaultOptionId, "forest-option");
});

test("container proximity alone does not make an unchanged visual control a child", async () => {
  const fixture = createCollectorFixture({ exposeThree: false, includeNestedVariantGroup: true });
  await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const parentGroup = collected.variant_groups.find((group) => group.control.kind === "button-cluster");
  const childGroup = collected.variant_groups.find((group) => group.control.kind === "previous-next");
  const nestedAssociations = collected.variant_asset_associations.filter((association) => association.relationship === "visual-child");

  assert(parentGroup);
  assert(childGroup);
  assert.deepEqual(JSON.parse(JSON.stringify(parentGroup.options.map((option) => option.label))), ["North", "South"]);
  assert.equal(nestedAssociations.length, 0);
  assert.equal(collected.variant_hierarchy.length, 0);
  assert.equal(collected.capture_coverage.nestedVariantGroupCount, 0);
  assert.equal(collected.variant_interactions.some((interaction) => interaction.groupId === childGroup.id && !interaction.parentGroupId), true);
});

test("collector canonicalizes NYT-style labels without inventing sibling hierarchy", async () => {
  const fixture = createCollectorFixture({
    exposeThree: false,
    includeStatefulButtonClusterVariantGroup: true,
    includeSiblingNestedVariantGroup: true,
  });
  await fixture.window.NYTAnimationProbe.exploreVariants({
    variantSettleMs: 0,
    variantNetworkQuietMs: 0,
    variantMaxWaitMs: 100,
  });
  const collected = fixture.window.NYTAnimationProbe.collect();
  const parentGroup = collected.variant_groups.find((group) => group.control.kind === "button-cluster");
  const parentInteraction = collected.variant_interactions.find((interaction) => interaction.groupId === parentGroup.id && !interaction.parentGroupId);
  const nestedAssociations = collected.variant_asset_associations.filter((association) => association.relationship === "visual-child");

  assert.deepEqual(JSON.parse(JSON.stringify(parentGroup.options.map((option) => option.label))), ["North", "South"]);
  assert.equal(parentGroup.defaultOptionId, "south-region");
  assert.deepEqual(JSON.parse(JSON.stringify(parentInteraction.capturedOptionIds)), ["south-region", "north-region"]);
  assert.deepEqual(JSON.parse(JSON.stringify(parentInteraction.failures)), []);
  assert.equal(parentInteraction.restored, true);
  assert.equal(nestedAssociations.length, 0);
  assert.equal(collected.variant_hierarchy.length, 0);
  assert.equal(collected.capture_coverage.nestedVariantGroupCount, 0);
  assert.equal(collected.capture_coverage.variantClickAttemptCount, collected.capture_coverage.variantClickSuccessCount);
  assert.equal(collected.capture_coverage.variantClickSuccessCount >= 3, true);
  assert.equal(fixture.consoleMessages.some((message) => message.includes("variant click captured: Choose a region -> North")), true);
});

test("collector recovers repeated accessibility selection announcements as one choice group", () => {
  const fixture = createCollectorFixture({ exposeThree: false, includeAnnouncementVariantGroup: true });
  const collected = fixture.window.NYTAnimationProbe.collect();
  assert.equal(collected.variant_groups.length, 1);
  assert.equal(collected.variant_groups[0].control.kind, "single-select");
  assert.deepEqual(
    JSON.parse(JSON.stringify(collected.variant_groups[0].options.map((option) => option.label))),
    ["Forest", "Desert", "Coast"],
  );
  assert.match(collected.variant_groups[0].options[1].text, /Open sand and sun/);
});
