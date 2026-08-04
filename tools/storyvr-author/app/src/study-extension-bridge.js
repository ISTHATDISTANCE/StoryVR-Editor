export const STORYVR_STUDY_EXTENSION_CHANNEL = "storyvr-study-extension/v1";

const RESPONSE_DIRECTION = "extension-to-storyvr";
const REQUEST_DIRECTION = "storyvr-to-extension";
const DEFAULT_TIMEOUT_MS = 1_200;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const MAX_EXTERNAL_EVENTS = 10_000;
const MAX_LABEL_LENGTH = 180;
const MAX_TOKEN_LENGTH = 160;

const EXTERNAL_EVENT_TYPES = new Set([
  "browser-focus-change",
  "buffer-limit-reached",
  "click",
  "focus-change",
  "page-lifecycle",
  "scroll-depth",
  "tab-activated",
  "visibility-change",
]);

export function createStoryvrStudyExtensionBridge({
  windowRef = globalThis.window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  createRequestId = defaultRequestId,
} = {}) {
  const pending = new Map();
  const readyWaiters = new Set();
  const checkpointRequestListeners = new Set();
  let nonce = "";
  let disposed = false;

  const setTimer = windowRef?.setTimeout?.bind(windowRef) || globalThis.setTimeout;
  const clearTimer = windowRef?.clearTimeout?.bind(windowRef) || globalThis.clearTimeout;

  function handleMessage(event) {
    if (disposed || !isMessageFromWindow(event, windowRef)) return;
    const message = event.data;
    if (!message || message.channel !== STORYVR_STUDY_EXTENSION_CHANNEL) return;
    if (message.direction !== RESPONSE_DIRECTION) return;

    if (message.type === "ready" && safeToken(message.nonce, MAX_TOKEN_LENGTH)) {
      nonce = safeToken(message.nonce, MAX_TOKEN_LENGTH);
      for (const resolve of readyWaiters) resolve(nonce);
      readyWaiters.clear();
      return;
    }

    if (message.type === "checkpoint-requested" && message.nonce === nonce && nonce) {
      const reason = safeToken(message.reason, 80);
      if (!reason) return;
      for (const listener of [...checkpointRequestListeners]) {
        try {
          listener({ reason });
        } catch {
          // A page listener must not prevent other checkpoint listeners from running.
        }
      }
      return;
    }

    if (message.type !== "response" || message.nonce !== nonce) return;
    const requestId = safeToken(message.requestId, MAX_TOKEN_LENGTH);
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    clearTimer?.(request.timer);
    request.resolve({
      ...boundedObject(message.response),
      connected: true,
    });
  }

  windowRef?.addEventListener?.("message", handleMessage);

  function discover() {
    if (disposed || !windowRef?.postMessage) return;
    windowRef.postMessage({
      channel: STORYVR_STUDY_EXTENSION_CHANNEL,
      direction: REQUEST_DIRECTION,
      type: "discover",
    }, messageOrigin(windowRef));
  }

  async function ready() {
    if (nonce) return nonce;
    if (disposed || !windowRef?.postMessage) return "";
    return new Promise((resolve) => {
      const timer = setTimer?.(() => {
        readyWaiters.delete(onReady);
        resolve("");
      }, timeoutMs);
      const onReady = (value) => {
        clearTimer?.(timer);
        resolve(value);
      };
      readyWaiters.add(onReady);
      discover();
    });
  }

  async function command(commandName, payload = {}) {
    const bridgeNonce = await ready();
    if (!bridgeNonce || disposed) return { connected: false, reason: "extension-unavailable" };
    const requestId = safeToken(createRequestId(), MAX_TOKEN_LENGTH) || defaultRequestId();
    return new Promise((resolve) => {
      const timer = setTimer?.(() => {
        pending.delete(requestId);
        resolve({ connected: Boolean(nonce), reason: "extension-timeout" });
      }, commandTimeoutMs);
      pending.set(requestId, { resolve, timer });
      windowRef.postMessage({
        channel: STORYVR_STUDY_EXTENSION_CHANNEL,
        direction: REQUEST_DIRECTION,
        type: "command",
        nonce: bridgeNonce,
        requestId,
        command: safeToken(commandName, 80),
        payload: boundedObject(payload),
      }, messageOrigin(windowRef));
    });
  }

  function startSession({ sessionId, startedAt } = {}) {
    return command("start-session", {
      sessionId: safeToken(sessionId, MAX_TOKEN_LENGTH),
      startedAt: validIsoDate(startedAt),
    });
  }

  function prepareExport({ sessionId, endedAt } = {}) {
    return command("prepare-export", {
      sessionId: safeToken(sessionId, MAX_TOKEN_LENGTH),
      endedAt: validIsoDate(endedAt),
    });
  }

  function prepareCheckpoint({ sessionId, checkpointedAt } = {}) {
    return command("prepare-checkpoint", {
      sessionId: safeToken(sessionId, MAX_TOKEN_LENGTH),
      checkpointedAt: validIsoDate(checkpointedAt),
    });
  }

  function commitCheckpoint({ sessionId, checkpointToken } = {}) {
    return command("commit-checkpoint", {
      sessionId: safeToken(sessionId, MAX_TOKEN_LENGTH),
      checkpointToken: safeToken(checkpointToken, MAX_TOKEN_LENGTH),
    });
  }

  function abortCheckpoint({ sessionId, checkpointToken } = {}) {
    return command("abort-checkpoint", {
      sessionId: safeToken(sessionId, MAX_TOKEN_LENGTH),
      checkpointToken: safeToken(checkpointToken, MAX_TOKEN_LENGTH),
    });
  }

  function commitExport({ sessionId, exportToken } = {}) {
    return command("commit-export", {
      sessionId: safeToken(sessionId, MAX_TOKEN_LENGTH),
      exportToken: safeToken(exportToken, MAX_TOKEN_LENGTH),
    });
  }

  function abortExport({ sessionId, exportToken } = {}) {
    return command("abort-export", {
      sessionId: safeToken(sessionId, MAX_TOKEN_LENGTH),
      exportToken: safeToken(exportToken, MAX_TOKEN_LENGTH),
    });
  }

  function subscribeCheckpointRequests(listener) {
    if (disposed || typeof listener !== "function") return () => {};
    checkpointRequestListeners.add(listener);
    return () => checkpointRequestListeners.delete(listener);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    windowRef?.removeEventListener?.("message", handleMessage);
    for (const request of pending.values()) {
      clearTimer?.(request.timer);
      request.resolve({ connected: false, reason: "bridge-disposed" });
    }
    pending.clear();
    for (const resolve of readyWaiters) resolve("");
    readyWaiters.clear();
    checkpointRequestListeners.clear();
  }

  discover();

  return Object.freeze({
    startSession,
    prepareCheckpoint,
    commitCheckpoint,
    abortCheckpoint,
    prepareExport,
    commitExport,
    abortExport,
    subscribeCheckpointRequests,
    dispose,
  });
}

export function mergeStoryvrStudyExtensionEvents(payload, extensionSnapshot) {
  const startedAt = validDate(payload?.startedAt);
  const sessionId = safeToken(payload?.sessionId, MAX_TOKEN_LENGTH);
  const extensionMatches = Boolean(
    extensionSnapshot?.connected
    && extensionSnapshot?.prepared
    && safeToken(extensionSnapshot?.sessionId, MAX_TOKEN_LENGTH) === sessionId,
  );
  const storyvrEvents = Array.isArray(payload?.events)
    ? payload.events.map((event, index) => ({
      ...boundedObject(event),
      captureSource: "storyvr",
      sourceSequence: Number(event?.sequence) || index + 1,
      surface: "storyvr",
    }))
    : [];
  const extensionEvents = extensionMatches
    ? (Array.isArray(extensionSnapshot.events) ? extensionSnapshot.events : [])
      .slice(0, MAX_EXTERNAL_EVENTS)
      .map(sanitizeExternalEvent)
      .filter(Boolean)
    : [];
  const events = [...storyvrEvents, ...extensionEvents]
    .map((event, insertionIndex) => ({ event, insertionIndex }))
    .sort((left, right) => {
      const timeDifference = validDate(left.event.timestamp).getTime() - validDate(right.event.timestamp).getTime();
      return timeDifference || left.insertionIndex - right.insertionIndex;
    })
    .map(({ event }, index) => ({
      ...event,
      sequence: index + 1,
      elapsedMs: Math.max(0, validDate(event.timestamp).getTime() - startedAt.getTime()),
    }));

  const surfaces = [...new Set(events.map((event) => event.surface).filter(Boolean))];
  return {
    ...payload,
    captureScope: extensionMatches ? "storyvr-and-approved-study-tabs" : "storyvr-only",
    captureSources: surfaces.length ? surfaces : ["storyvr"],
    studyExtension: extensionMatches ? {
      schemaVersion: safeSchemaVersion(extensionSnapshot.schemaVersion) || STORYVR_STUDY_EXTENSION_CHANNEL,
      connected: true,
      studyConfigId: safeToken(extensionSnapshot.studyConfigId, MAX_TOKEN_LENGTH),
      approvalMode: safeToken(extensionSnapshot.approvalMode, MAX_TOKEN_LENGTH),
      externalEventCount: extensionEvents.length,
    } : {
      connected: false,
      externalEventCount: 0,
    },
    eventCount: events.length,
    events,
  };
}

function sanitizeExternalEvent(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = safeToken(value.type, 80);
  if (!EXTERNAL_EVENT_TYPES.has(type)) return null;
  const timestamp = validIsoDate(value.timestamp);
  const surface = ["browser", "original", "storyvr"].includes(value.surface) ? value.surface : "browser";
  const target = sanitizeExternalTarget(value.target);
  const pointer = sanitizeExternalPointer(value.pointer);
  const scroll = sanitizeExternalScroll(value.scroll);
  return removeEmpty({
    captureSource: "study-extension",
    sourceSequence: positiveInteger(value.sourceSequence) || index + 1,
    timestamp,
    type,
    surface,
    pageKey: safeToken(value.pageKey, MAX_TOKEN_LENGTH),
    state: safeToken(value.state, 80),
    target: Object.keys(target).length ? target : null,
    pointer: Object.keys(pointer).length ? pointer : null,
    scroll: Object.keys(scroll).length ? scroll : null,
  });
}

function sanitizeExternalTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return removeEmpty({
    kind: safeToken(value.kind, 80),
    semanticKey: safeToken(value.semanticKey, MAX_TOKEN_LENGTH),
    tag: safeToken(value.tag, 40),
    role: safeToken(value.role, 80),
    label: safeLabel(value.label, MAX_LABEL_LENGTH),
  });
}

function sanitizeExternalPointer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return removeEmpty({
    xBucket: boundedInteger(value.xBucket, 0, 19),
    yBucket: boundedInteger(value.yBucket, 0, 19),
    button: boundedInteger(value.button, 0, 5),
    inputMethod: safeToken(value.inputMethod, 40),
  });
}

function sanitizeExternalScroll(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return removeEmpty({
    depthBucket: boundedInteger(value.depthBucket, 0, 100),
  });
}

function isMessageFromWindow(event, windowRef) {
  if (event?.source && event.source !== windowRef) return false;
  const expectedOrigin = messageOrigin(windowRef);
  return !event?.origin || event.origin === expectedOrigin;
}

function messageOrigin(windowRef) {
  return String(windowRef?.location?.origin || "*");
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

function safeLabel(value, maximumLength) {
  const text = String(value ?? "")
    .replace(/\bhttps?:\/\/\S+/gi, "[url]")
    .replace(/(^|[\s(])\/(?:[^/\s)]+\/){2,}[^\s)]*/g, "$1[local path]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function safeToken(value, maximumLength) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, maximumLength);
}

function safeSchemaVersion(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_.:/-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_TOKEN_LENGTH);
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function validIsoDate(value) {
  return validDate(value).toISOString();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function removeEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ""));
}

function defaultRequestId() {
  return globalThis.crypto?.randomUUID?.()
    || `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
