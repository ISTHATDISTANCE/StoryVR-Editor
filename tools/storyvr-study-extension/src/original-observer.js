(() => {
  const INSTALLATION_KEY = "__storyvrOriginalStudyObserverInstalled";
  if (globalThis[INSTALLATION_KEY]) return;
  globalThis[INSTALLATION_KEY] = true;

  const CLICKABLE_SELECTOR = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "label",
    "summary",
    "[role]",
    "[tabindex]",
  ].join(",");
  const SAFE_INTERACTIVE_ROLES = new Set([
    "button",
    "checkbox",
    "combobox",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "scrollbar",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "textbox",
    "treeitem",
  ]);
  let active = false;
  let approved = false;
  let grantToken = "";
  let pageConfig = null;
  let lastScrollBucket = null;
  let scrollTimer = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "study-page-identify") {
      sendResponse({
        approved,
        surface: "original",
        pageKey: pageConfig?.pageKey || "",
      });
      return;
    }
    if (message?.type === "study-consent-granted") {
      const nextToken = cleanToken(message.grantToken, 160);
      if (!nextToken) {
        sendResponse({ accepted: false });
        return;
      }
      approved = true;
      grantToken = nextToken;
      sendResponse({ accepted: true });
      announcePresence().then(() => {
        if (!active) return;
        recordEvent({ type: "page-lifecycle", state: "observer-attached" });
        scheduleScrollDepth();
      }).catch(() => {});
      return;
    }
    if (message?.type === "study-consent-revoked") {
      approved = false;
      active = false;
      grantToken = "";
      pageConfig = null;
      clearScrollTimer();
      sendResponse({ revoked: true });
      return;
    }
    if (message?.type === "study-session-started") {
      if (!approved || !grantToken) return;
      announcePresence().then(() => {
        if (!active) return;
        recordEvent({ type: "page-lifecycle", state: "observer-attached" });
        scheduleScrollDepth();
      }).catch(() => {});
      return;
    }
    if (message?.type === "study-session-paused" || message?.type === "study-session-stopped") {
      active = false;
      clearScrollTimer();
    }
  });

  document.addEventListener("click", (event) => {
    if (!active || !event.isTrusted) return;
    const element = event.composedPath().find((entry) => entry instanceof Element);
    if (!element) return;
    recordEvent({
      type: "click",
      target: describeClickTarget(element),
      pointer: describePointer(event),
    });
  }, { capture: true });

  document.addEventListener("visibilitychange", () => {
    recordEvent({ type: "visibility-change", state: document.visibilityState });
  }, { capture: true });
  window.addEventListener("focus", () => recordEvent({ type: "focus-change", state: "focused" }));
  window.addEventListener("blur", () => recordEvent({ type: "focus-change", state: "unfocused" }));
  window.addEventListener("pageshow", (event) => {
    recordEvent({ type: "page-lifecycle", state: event.persisted ? "restored" : "shown" });
  }, true);
  window.addEventListener("pagehide", (event) => {
    recordEvent({ type: "page-lifecycle", state: event.persisted ? "cached" : "hidden" });
  }, true);
  window.addEventListener("scroll", scheduleScrollDepth, { passive: true });
  window.addEventListener("popstate", refreshPresence);

  function announcePresence() {
    if (!approved || !grantToken) return Promise.resolve({ active: false });
    return chrome.runtime.sendMessage({
      type: "study-page-presence",
      surface: "original",
      grantToken,
    })
      .then((response) => {
        active = Boolean(response?.active);
        pageConfig = response?.page && typeof response.page === "object" ? response.page : pageConfig;
        return response;
      });
  }

  function refreshPresence() {
    active = false;
    clearScrollTimer();
    if (approved) announcePresence().catch(() => {});
  }

  function recordEvent(event) {
    if (!active) return Promise.resolve({ recorded: false });
    return chrome.runtime.sendMessage({
      type: "study-observer-event",
      grantToken,
      event: { ...event, timestamp: new Date().toISOString() },
    }).then((response) => {
      active = response?.active === true
        || response?.status === "collecting"
        || response?.status === "checkpoint-prepared";
      return response;
    }).catch(() => ({ recorded: false }));
  }

  function describeClickTarget(clickedElement) {
    const mapped = mappedTarget(clickedElement);
    if (mapped) return mapped;
    const element = clickedElement.closest(CLICKABLE_SELECTOR) || clickedElement;
    const tag = String(element.localName || "element").toLowerCase();
    const role = safeInteractiveRole(element.getAttribute?.("role"));
    return removeEmpty({
      kind: targetKind(element, tag, role),
      tag,
      role,
      label: safeElementLabel(element),
    });
  }

  function mappedTarget(clickedElement) {
    for (const target of Array.isArray(pageConfig?.semanticTargets) ? pageConfig.semanticTargets : []) {
      try {
        if (!clickedElement.closest(String(target.selector || ""))) continue;
        return removeEmpty({
          kind: cleanToken(target.kind, 80) || "mapped-control",
          semanticKey: cleanToken(target.semanticKey, 160),
          label: safeLabel(target.label, 180),
        });
      } catch {
        // A malformed researcher-authored selector is ignored for this click.
      }
    }
    return null;
  }

  function targetKind(element, tag, role) {
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "input") {
      const type = String(element.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) return "button";
      if (["checkbox", "radio", "range"].includes(type)) return `${type}-control`;
      return "input-control";
    }
    if (["select", "textarea"].includes(tag)) return "input-control";
    if (tag === "label") return "label";
    if (role) return `${role}-control`;
    return "click-area";
  }

  function safeInteractiveRole(value) {
    for (const candidate of String(value || "").toLowerCase().split(/\s+/)) {
      if (SAFE_INTERACTIVE_ROLES.has(candidate)) return candidate;
    }
    return "";
  }

  function safeElementLabel(element) {
    if (!pageConfig?.captureControlLabels) return "";
    const attributeLabel = element.getAttribute?.("aria-label")
      || element.getAttribute?.("title")
      || element.getAttribute?.("alt");
    if (attributeLabel) return safeLabel(attributeLabel, 180);
    if (element.matches?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
      || element.closest?.("[contenteditable]:not([contenteditable='false'])")) {
      return "Text entry area";
    }
    const associatedLabel = Array.from(element.labels || [])
      .map((label) => label.textContent)
      .find((value) => String(value || "").trim());
    if (associatedLabel) return safeLabel(associatedLabel, 180);
    const staticInteractiveText = element.matches?.("a, button, label, summary, [role], [tabindex]");
    if (!staticInteractiveText) return "";
    return safeLabel(element.textContent, 180);
  }

  function describePointer(event) {
    const width = Math.max(1, window.innerWidth || 1);
    const height = Math.max(1, window.innerHeight || 1);
    const hasCoordinates = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && event.detail !== 0;
    return removeEmpty({
      xBucket: hasCoordinates ? Math.min(19, Math.max(0, Math.floor((event.clientX / width) * 20))) : null,
      yBucket: hasCoordinates ? Math.min(19, Math.max(0, Math.floor((event.clientY / height) * 20))) : null,
      button: Number.isFinite(event.button) ? Math.min(5, Math.max(0, Math.round(event.button))) : null,
      inputMethod: event.detail === 0 ? "keyboard-or-assistive" : cleanToken(event.pointerType, 40) || "pointer",
    });
  }

  function scheduleScrollDepth() {
    if (!active || !pageConfig?.captureScrollDepth || scrollTimer != null) return;
    scrollTimer = window.setTimeout(() => {
      scrollTimer = null;
      const root = document.scrollingElement || document.documentElement;
      const total = Math.max(1, Number(root?.scrollHeight) || 1);
      const visibleBottom = Math.max(0, Number(window.scrollY) || 0) + Math.max(0, Number(window.innerHeight) || 0);
      const bucket = Math.min(100, Math.max(0, Math.floor((visibleBottom / total) * 10) * 10));
      if (bucket === lastScrollBucket) return;
      lastScrollBucket = bucket;
      recordEvent({ type: "scroll-depth", scroll: { depthBucket: bucket } });
    }, 120);
  }

  function clearScrollTimer() {
    if (scrollTimer != null) window.clearTimeout(scrollTimer);
    scrollTimer = null;
  }

  function safeLabel(value, maximumLength) {
    const text = String(value ?? "")
      .replace(/\bhttps?:\/\/\S+/gi, "[url]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
      .replace(/\b\d{6,}\b/g, "[number]")
      .replace(/(^|[\s(])\/(?:[^/\s)]+\/){2,}[^\s)]*/g, "$1[local path]")
      .replace(/\s+/g, " ")
      .trim();
    return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 1).trimEnd()}…`;
  }

  function cleanToken(value, maximumLength) {
    return String(value ?? "")
      .replace(/[^a-zA-Z0-9_.:-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maximumLength);
  }

  function removeEmpty(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ""));
  }
})();
