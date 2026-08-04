(() => {
  const CHANNEL = "storyvr-study-extension/v1";
  const REQUEST_DIRECTION = "storyvr-to-extension";
  const RESPONSE_DIRECTION = "extension-to-storyvr";
  const INSTALLATION_KEY = "__storyvrStudyControllerInstalled";
  if (globalThis[INSTALLATION_KEY]) return;
  globalThis[INSTALLATION_KEY] = true;

  const nonce = globalThis.crypto?.randomUUID?.()
    || `storyvr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let active = false;
  let pageKey = "";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.direction !== REQUEST_DIRECTION) return;

    if (message.type === "discover") {
      postToStoryvr({ type: "ready", nonce });
      return;
    }

    if (message.type !== "command" || message.nonce !== nonce) return;
    const requestId = safeToken(message.requestId, 160);
    if (!requestId) return;
    chrome.runtime.sendMessage({
      type: "storyvr-controller",
      command: safeToken(message.command, 80),
      payload: boundedObject(message.payload),
    }).then((response) => {
      postToStoryvr({ type: "response", nonce, requestId, response: boundedObject(response) });
    }).catch((error) => {
      postToStoryvr({
        type: "response",
        nonce,
        requestId,
        response: { connected: false, error: String(error?.message || "extension-unavailable") },
      });
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "study-page-identify") {
      sendResponse({ approved: true, surface: "storyvr", pageKey });
      return;
    }
    if (message?.type === "study-checkpoint-needed") {
      const reason = safeToken(message.reason, 80);
      if (!reason) {
        sendResponse({ requested: false, error: "invalid-checkpoint-reason" });
        return;
      }
      postToStoryvr({ type: "checkpoint-requested", nonce, reason });
      sendResponse({ requested: true });
      return;
    }
    if (message?.type === "study-session-started") {
      active = true;
      announcePresence().then(() => recordLifecycle("observer-attached")).catch(() => {});
      return;
    }
    if (message?.type === "study-session-paused" || message?.type === "study-session-stopped") {
      active = false;
    }
  });

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

  announcePresence().then(() => {
    if (active) recordLifecycle("observer-attached");
  }).catch(() => {});

  function announcePresence() {
    return chrome.runtime.sendMessage({ type: "study-page-presence", surface: "storyvr" })
      .then((response) => {
        active = Boolean(response?.active);
        pageKey = safeToken(response?.page?.pageKey, 160);
        return response;
      });
  }

  function recordLifecycle(state) {
    if (!active) return Promise.resolve();
    return recordEvent({ type: "page-lifecycle", state });
  }

  function recordEvent(event) {
    if (!active) return Promise.resolve({ recorded: false });
    return chrome.runtime.sendMessage({
      type: "study-controller-event",
      event: { ...event, timestamp: new Date().toISOString() },
    }).then((response) => {
      active = response?.active === true
        || response?.status === "collecting"
        || response?.status === "checkpoint-prepared";
      return response;
    }).catch(() => ({ recorded: false }));
  }

  function postToStoryvr(message) {
    window.postMessage({
      channel: CHANNEL,
      direction: RESPONSE_DIRECTION,
      ...message,
    }, location.origin);
  }

  function boundedObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > 8_000_000) return {};
      return JSON.parse(serialized);
    } catch {
      return {};
    }
  }

  function safeToken(value, maximumLength) {
    return String(value ?? "")
      .replace(/[^a-zA-Z0-9_.:-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, maximumLength);
  }
})();
