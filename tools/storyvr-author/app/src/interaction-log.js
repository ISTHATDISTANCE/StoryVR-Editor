export const INTERACTION_LOG_SCHEMA_VERSION = "storyvr-interaction-log/v1";

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "label",
  "select",
  "summary",
  "textarea",
]);
const INTERACTIVE_ROLES = new Set([
  "application",
  "button",
  "checkbox",
  "link",
  "menuitem",
  "option",
  "radio",
  "slider",
  "switch",
  "tab",
]);
const SENSITIVE_DATA_KEY = /(?:password|secret|token|prompt|content|participant|email|user)|^(?:text|value)$/i;
const MAX_LABEL_LENGTH = 180;
const MAX_DATA_ATTRIBUTES = 12;
const MAX_DATA_VALUE_LENGTH = 160;
const DEFAULT_MAX_EVENTS = 25_000;
const SEMANTIC_CLICK_WINDOW_MS = 1_200;
const LABEL_ACTIVATION_WINDOW_MS = 350;

export function createInteractionLogger({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  saveLog = (payload) => requestInteractionLogDownload(payload, { documentRef, windowRef }),
  getContext = () => ({}),
  now = () => new Date(),
  createSessionId = defaultSessionId,
  maxEvents = DEFAULT_MAX_EVENTS,
} = {}) {
  if (!documentRef?.addEventListener) throw new TypeError("A document is required for interaction logging.");
  if (typeof saveLog !== "function") throw new TypeError("A save handler is required for interaction logging.");

  const listeners = new Set();
  const state = {
    enabled: false,
    saving: false,
    status: "off",
    error: "",
    session: null,
    events: [],
    lastSaved: null,
    limitReached: false,
  };
  let attached = false;
  let savePromise = null;
  let lastCapturedClick = null;
  let recentSemanticClick = null;

  const timestamp = () => validDate(now());

  function snapshot() {
    return Object.freeze({
      enabled: state.enabled,
      saving: state.saving,
      status: state.status,
      error: state.error,
      eventCount: state.events.length,
      startedAt: state.session?.startedAt || null,
      limitReached: state.limitReached,
      lastSaved: state.lastSaved ? { ...state.lastSaved } : null,
    });
  }

  function notify() {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function start() {
    if (attached) return;
    documentRef.addEventListener("click", handleDocumentClick, { capture: true });
    attached = true;
  }

  function dispose() {
    if (attached) documentRef.removeEventListener("click", handleDocumentClick, { capture: true });
    attached = false;
    listeners.clear();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("An interaction-log listener must be a function.");
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function context() {
    try {
      return boundedSerializableObject(getContext());
    } catch {
      return {};
    }
  }

  function beginCollection() {
    if (state.saving || state.enabled) return snapshot();
    const started = timestamp();
    state.enabled = true;
    state.status = "collecting";
    state.error = "";
    state.limitReached = false;
    state.session = {
      id: String(createSessionId()),
      startedAt: started.toISOString(),
      context: context(),
      viewport: viewportSnapshot(windowRef),
    };
    state.events = [];
    appendLifecycleEvent("collection-started", "Interaction data collection enabled", started);
    notify();
    return snapshot();
  }

  async function endCollection() {
    if (state.saving) return savePromise;
    if (!state.enabled || !state.session) return null;
    const ended = timestamp();
    appendLifecycleEvent("collection-stopped", "Interaction data collection disabled", ended);
    state.enabled = false;
    state.saving = true;
    state.status = "saving";
    state.error = "";
    notify();

    const payload = {
      schemaVersion: INTERACTION_LOG_SCHEMA_VERSION,
      sessionId: state.session.id,
      startedAt: state.session.startedAt,
      endedAt: ended.toISOString(),
      durationMs: Math.max(0, ended.getTime() - new Date(state.session.startedAt).getTime()),
      sessionContext: state.session.context,
      viewport: state.session.viewport,
      eventCount: state.events.length,
      events: state.events.map((entry) => ({ ...entry })),
    };

    savePromise = (async () => {
      try {
        const result = await saveLog(payload);
        if (!result?.saved) throw new Error("The interaction log download was not completed.");
        state.lastSaved = {
          fileName: String(result.fileName || interactionLogFileName(payload)),
          eventCount: Number(result.eventCount) || payload.eventCount,
          savedAt: String(result.savedAt || timestamp().toISOString()),
          method: String(result.method || "download"),
        };
        state.events = [];
        state.session = null;
        state.saving = false;
        state.status = "saved";
        state.error = "";
        state.limitReached = false;
        lastCapturedClick = null;
        recentSemanticClick = null;
        notify();
        return result;
      } catch (error) {
        const canceled = error?.name === "AbortError";
        state.enabled = true;
        state.saving = false;
        state.status = canceled ? "canceled" : "error";
        state.error = canceled
          ? "Save canceled; cached clicks retained."
          : String(error?.message || "Interaction logs could not be saved.");
        appendLifecycleEvent(
          canceled ? "collection-save-canceled" : "collection-save-failed",
          canceled
            ? "Interaction log save canceled; cached clicks retained"
            : "Interaction log save failed; cached clicks retained",
          timestamp(),
        );
        notify();
        throw error;
      } finally {
        savePromise = null;
      }
    })();
    return savePromise;
  }

  function setEnabled(enabled) {
    return enabled ? Promise.resolve(beginCollection()) : endCollection();
  }

  function appendLifecycleEvent(type, label, eventTime) {
    return appendEvent({
      sequence: state.events.length + 1,
      timestamp: eventTime.toISOString(),
      elapsedMs: elapsedSinceStart(eventTime, state.session?.startedAt),
      type,
      context: context(),
      target: {
        kind: "system",
        tag: "system",
        label,
      },
    });
  }

  function appendEvent(entry) {
    if (state.events.length >= maxEvents) {
      state.limitReached = true;
      state.status = "limit-reached";
      state.error = "The interaction cache is full. Turn collection off to save it.";
      notify();
      return false;
    }
    state.events.push(entry);
    return true;
  }

  function handleDocumentClick(event) {
    if (!state.enabled || state.saving || !state.session) return;
    const eventTime = timestamp();
    if (matchesRecentSemanticClick(event, eventTime, recentSemanticClick)) {
      recentSemanticClick = null;
      return;
    }
    const targetElement = interactionElementForEvent(event);
    if (isLabelActivationDuplicate(targetElement, event, eventTime, lastCapturedClick)) {
      lastCapturedClick = null;
      return;
    }
    const entry = createInteractionEventRecord(event, {
      sequence: state.events.length + 1,
      startedAt: state.session.startedAt,
      eventTime,
      context: context(),
      targetElement,
    });
    if (!appendEvent(entry)) return;
    lastCapturedClick = {
      event,
      element: targetElement,
      index: state.events.length - 1,
      target: event.target,
      clientX: finiteNumber(event.clientX),
      clientY: finiteNumber(event.clientY),
      button: finiteNumber(event.button),
      capturedAt: eventTime.getTime(),
    };
    if (state.status !== "error" && state.status !== "limit-reached") state.status = "collecting";
    notify();
  }

  function recordSemanticClick(event, semanticTarget) {
    if (!state.enabled || state.saving || !state.session) return false;
    const eventTime = timestamp();
    const semantic = boundedSemanticTarget(semanticTarget);
    if (event === lastCapturedClick?.event && matchesCapturedClick(event, eventTime, lastCapturedClick)) {
      const entry = state.events[lastCapturedClick.index];
      if (entry?.type === "click") {
        entry.target = { ...entry.target, semantic };
        notify();
        return true;
      }
    }
    const entry = createInteractionEventRecord(event, {
      sequence: state.events.length + 1,
      startedAt: state.session.startedAt,
      eventTime,
      context: context(),
      semanticTarget: semantic,
    });
    if (!appendEvent(entry)) return false;
    recentSemanticClick = {
      target: event.target,
      clientX: finiteNumber(event.clientX),
      clientY: finiteNumber(event.clientY),
      button: finiteNumber(event.button),
      capturedAt: eventTime.getTime(),
    };
    notify();
    return true;
  }

  return Object.freeze({
    start,
    dispose,
    subscribe,
    snapshot,
    setEnabled,
    recordSemanticClick,
  });
}

export async function requestInteractionLogDownload(payload, {
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  const fileName = interactionLogFileName(payload);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const BlobConstructor = windowRef?.Blob || globalThis.Blob;
  if (typeof BlobConstructor !== "function") {
    throw new Error("This browser cannot prepare the interaction log download.");
  }
  const blob = new BlobConstructor([serialized], { type: "application/json" });

  if (typeof windowRef?.showSaveFilePicker === "function") {
    const handle = await windowRef.showSaveFilePicker({
      suggestedName: fileName,
      types: [{
        description: "StoryVR interaction log",
        accept: { "application/json": [".json"] },
      }],
    });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort?.();
      } catch {
        // Preserve the original write failure.
      }
      throw error;
    }
    return {
      saved: true,
      fileName: downloadFileName(handle?.name || fileName),
      eventCount: Number(payload?.eventCount) || 0,
      method: "file-picker",
    };
  }

  const urlApi = windowRef?.URL || globalThis.URL;
  if (!documentRef?.createElement || !urlApi?.createObjectURL) {
    throw new Error("This browser cannot open an interaction log download.");
  }
  const objectUrl = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;
  const parent = documentRef.body || documentRef.documentElement;
  parent?.appendChild?.(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove?.();
    const defer = windowRef?.setTimeout || globalThis.setTimeout;
    defer?.(() => urlApi.revokeObjectURL(objectUrl), 0);
  }
  return {
    saved: true,
    fileName,
    eventCount: Number(payload?.eventCount) || 0,
    method: "browser-download",
  };
}

export function interactionLogFileName(payload) {
  const endedAt = validDate(payload?.endedAt).toISOString().replace(/[:.]/g, "-");
  const sessionId = safeFileToken(payload?.sessionId).slice(0, 32) || "session";
  return `storyvr-interactions-${endedAt}-${sessionId}.json`;
}

export function createInteractionEventRecord(event, {
  sequence,
  startedAt,
  eventTime = new Date(),
  context = {},
  semanticTarget = null,
  targetElement = interactionElementForEvent(event),
} = {}) {
  const target = interactionTargetSnapshot(targetElement);
  if (semanticTarget) target.semantic = boundedSemanticTarget(semanticTarget);
  return {
    sequence: Number(sequence) || 1,
    timestamp: validDate(eventTime).toISOString(),
    elapsedMs: elapsedSinceStart(validDate(eventTime), startedAt),
    type: "click",
    context: boundedSerializableObject(context),
    target,
    pointer: pointerSnapshot(event, targetElement),
    modifiers: modifierSnapshot(event),
  };
}

export function interactionElementForEvent(event) {
  const path = typeof event?.composedPath === "function"
    ? event.composedPath()
    : eventAncestry(event?.target);
  const elements = path.filter(isElementLike);
  return elements.find(isPrimaryActionableElement)
    || elements.find((element) => Object.keys(element.dataset || {}).length > 0)
    || elements.find(isActionableElement)
    || elements[0]
    || null;
}

export function interactionTargetSnapshot(element) {
  if (!isElementLike(element)) {
    return { kind: "unknown", tag: "unknown", label: "Unknown click target" };
  }
  const tag = String(element.tagName || "unknown").toLowerCase();
  const role = normalizedAttribute(element, "role");
  const type = tag === "input" ? normalizedAttribute(element, "type") || "text" : null;
  const data = boundedDataset(element.dataset);
  return removeEmptyValues({
    kind: role || (tag === "input" ? `input:${type}` : tag),
    tag,
    role,
    type,
    id: cleanText(element.id, MAX_DATA_VALUE_LENGTH),
    name: cleanText(normalizedAttribute(element, "name"), MAX_DATA_VALUE_LENGTH),
    label: accessibleElementLabel(element, tag),
    locator: interactionLocator(element, tag, data),
    data: Object.keys(data).length ? data : null,
  });
}

function isActionableElement(element) {
  if (isPrimaryActionableElement(element)) return true;
  const role = normalizedAttribute(element, "role").toLowerCase();
  if (role === "application") return true;
  const tabIndexAttribute = normalizedAttribute(element, "tabindex");
  if (!tabIndexAttribute) return false;
  const tabIndex = Number(tabIndexAttribute);
  return Number.isInteger(tabIndex) && tabIndex >= 0;
}

function isPrimaryActionableElement(element) {
  const tag = String(element.tagName || "").toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = normalizedAttribute(element, "role").toLowerCase();
  return role !== "application" && INTERACTIVE_ROLES.has(role);
}

function accessibleElementLabel(element, tag) {
  const labelledBy = normalizedAttribute(element, "aria-labelledby")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => cleanText(element.ownerDocument?.getElementById?.(id)?.textContent, MAX_LABEL_LENGTH))
    .filter(Boolean)
    .join(" ");
  const associatedLabel = Array.from(element.labels || [])
    .map((label) => cleanText(label?.textContent, MAX_LABEL_LENGTH))
    .find(Boolean);
  const safeTextContent = ["input", "select", "textarea"].includes(tag) || element.isContentEditable
    ? ""
    : cleanText(element.textContent, MAX_LABEL_LENGTH);
  const buttonValue = tag === "input" && /^(?:button|reset|submit)$/i.test(normalizedAttribute(element, "type"))
    ? cleanText(element.value, MAX_LABEL_LENGTH)
    : "";
  return normalizedAttribute(element, "aria-label")
    || labelledBy
    || normalizedAttribute(element, "title")
    || normalizedAttribute(element, "alt")
    || associatedLabel
    || buttonValue
    || safeTextContent
    || `${tag} control`;
}

function interactionLocator(element, tag, data) {
  const id = cleanText(element.id, MAX_DATA_VALUE_LENGTH);
  if (id) return `#${cssIdentifier(id)}`;
  const [dataKey, dataValue] = Object.entries(data)[0] || [];
  if (dataKey) return `${tag}[data-${camelToKebab(dataKey)}="${cssAttributeValue(dataValue)}"]`;
  const role = normalizedAttribute(element, "role");
  if (role) return `${tag}[role="${cssAttributeValue(role)}"]`;
  const classes = Array.from(element.classList || [])
    .filter((value) => value && !/^(?:active|disabled|hidden|is-|selected)/.test(value))
    .slice(0, 3)
    .map(cssIdentifier);
  return `${tag}${classes.map((value) => `.${value}`).join("")}`;
}

function boundedDataset(dataset) {
  const entries = Object.entries(dataset || {})
    .filter(([key]) => !SENSITIVE_DATA_KEY.test(key))
    .slice(0, MAX_DATA_ATTRIBUTES)
    .map(([key, value]) => [key, cleanText(value, MAX_DATA_VALUE_LENGTH)]);
  return Object.fromEntries(entries.filter(([, value]) => value));
}

function pointerSnapshot(event, element) {
  const clientX = finiteNumber(event?.clientX);
  const clientY = finiteNumber(event?.clientY);
  const pointer = removeEmptyValues({
    inputMethod: Number(event?.detail) === 0 ? "keyboard" : cleanText(event?.pointerType, 24) || "pointer",
    pointerType: cleanText(event?.pointerType, 24),
    button: finiteNumber(event?.button),
    clientX: clientX == null ? null : Math.round(clientX),
    clientY: clientY == null ? null : Math.round(clientY),
  });
  if (clientX == null || clientY == null || typeof element?.getBoundingClientRect !== "function") return pointer;
  const rect = element.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return pointer;
  const relativeX = clientX - rect.left;
  const relativeY = clientY - rect.top;
  return {
    ...pointer,
    relativeX: round(relativeX, 2),
    relativeY: round(relativeY, 2),
    normalizedX: round(relativeX / rect.width, 4),
    normalizedY: round(relativeY / rect.height, 4),
  };
}

function modifierSnapshot(event) {
  return {
    alt: Boolean(event?.altKey),
    control: Boolean(event?.ctrlKey),
    meta: Boolean(event?.metaKey),
    shift: Boolean(event?.shiftKey),
  };
}

function viewportSnapshot(windowRef) {
  return removeEmptyValues({
    width: finiteNumber(windowRef?.innerWidth),
    height: finiteNumber(windowRef?.innerHeight),
    devicePixelRatio: finiteNumber(windowRef?.devicePixelRatio),
  });
}

function isLabelActivationDuplicate(element, event, eventTime, captured) {
  if (!captured?.element || String(captured.element.tagName || "").toLowerCase() !== "label") return false;
  if (!element || String(element.tagName || "").toLowerCase() !== "input") return false;
  if (eventTime.getTime() - captured.capturedAt > LABEL_ACTIVATION_WINDOW_MS) return false;
  if (!labelActivatesControl(captured.element, element)) return false;
  return coordinateMatches(finiteNumber(event?.clientX), captured.clientX)
    && coordinateMatches(finiteNumber(event?.clientY), captured.clientY)
    && coordinateMatches(finiteNumber(event?.button), captured.button);
}

function labelActivatesControl(label, control) {
  if (label?.control === control) return true;
  if (Array.from(control?.labels || []).includes(label)) return true;
  const targetId = normalizedAttribute(label, "for");
  return Boolean(targetId && cleanText(control?.id, MAX_DATA_VALUE_LENGTH) === targetId);
}

function matchesCapturedClick(event, eventTime, captured) {
  return Boolean(captured)
    && eventTime.getTime() - captured.capturedAt <= SEMANTIC_CLICK_WINDOW_MS
    && samePointerTarget(event, captured);
}

function matchesRecentSemanticClick(event, eventTime, semantic) {
  return Boolean(semantic)
    && eventTime.getTime() - semantic.capturedAt <= SEMANTIC_CLICK_WINDOW_MS
    && samePointerTarget(event, semantic);
}

function samePointerTarget(event, record) {
  return event?.target === record.target
    && coordinateMatches(finiteNumber(event?.clientX), record.clientX)
    && coordinateMatches(finiteNumber(event?.clientY), record.clientY)
    && coordinateMatches(finiteNumber(event?.button), record.button);
}

function coordinateMatches(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(left - right) <= 1;
}

function boundedSemanticTarget(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return removeEmptyValues({
    kind: cleanText(source.kind, 80) || "canvas-object",
    label: cleanText(source.label, MAX_LABEL_LENGTH) || "Canvas object",
    id: cleanText(source.id, MAX_DATA_VALUE_LENGTH),
    assetId: cleanText(source.assetId, MAX_DATA_VALUE_LENGTH),
    entityId: cleanText(source.entityId, MAX_DATA_VALUE_LENGTH),
    markerId: cleanText(source.markerId, MAX_DATA_VALUE_LENGTH),
    candidateId: cleanText(source.candidateId, MAX_DATA_VALUE_LENGTH),
    action: cleanText(source.action, MAX_DATA_VALUE_LENGTH),
  });
}

function boundedSerializableObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length > 8_192) return {};
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function eventAncestry(target) {
  const path = [];
  let current = target;
  while (current) {
    path.push(current);
    current = current.parentElement;
  }
  return path;
}

function isElementLike(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.tagName === "string"
    && typeof value.getAttribute === "function";
}

function normalizedAttribute(element, name) {
  return cleanText(element?.getAttribute?.(name), MAX_DATA_VALUE_LENGTH);
}

function cleanText(value, maximumLength) {
  const text = String(value ?? "")
    .replace(/\bhttps?:\/\/\S+/gi, "[url]")
    .replace(/(^|[\s(])\/(?:[^/\s)]+\/){2,}[^\s)]*/g, "$1[local path]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= maximumLength ? text : `${text.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`;
}

function elapsedSinceStart(eventTime, startedAt) {
  const startedMs = new Date(startedAt || eventTime).getTime();
  return Math.max(0, eventTime.getTime() - (Number.isFinite(startedMs) ? startedMs : eventTime.getTime()));
}

function validDate(value) {
  const result = value instanceof Date ? value : new Date(value);
  return Number.isFinite(result.getTime()) ? result : new Date();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function removeEmptyValues(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ""));
}

function camelToKebab(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function cssIdentifier(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0).toString(16)} `);
}

function cssAttributeValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function safeFileToken(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function downloadFileName(value) {
  const fileName = String(value ?? "").replace(/[\\/]/g, "-").trim();
  return fileName || "storyvr-interactions.json";
}

function defaultSessionId() {
  return globalThis.crypto?.randomUUID?.()
    || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
