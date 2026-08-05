import { createInteractionLogFileInSelectedDirectory } from "./interaction-log-file.js";

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
const DEFAULT_CHECKPOINT_EVENTS = 1_000;
const DEFAULT_CHECKPOINT_BYTES = 512 * 1024;
const DEFAULT_MAX_BUFFERED_EVENTS = 5_000;
const DEFAULT_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 30_000;
const DEFAULT_CHECKPOINT_DELAY_MS = 1_350;
const SEMANTIC_CLICK_WINDOW_MS = 1_200;
const LABEL_ACTIVATION_WINDOW_MS = 350;

export function createInteractionLogger({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  openLog = (payload) => createInteractionLogFileInSelectedDirectory(payload, { windowRef }),
  prepareCheckpoint = async () => null,
  transformCheckpoint = (payload) => payload,
  commitCheckpoint: commitPreparedCheckpoint = async () => {},
  abortCheckpoint: abortPreparedCheckpoint = async () => {},
  getContext = () => ({}),
  onCollectionStarted = () => {},
  onCollectionStopRequested = async () => ({ connected: false }),
  now = () => new Date(),
  createSessionId = defaultSessionId,
  checkpointEvents = DEFAULT_CHECKPOINT_EVENTS,
  checkpointBytes = DEFAULT_CHECKPOINT_BYTES,
  maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS,
  maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
  checkpointIntervalMs = DEFAULT_CHECKPOINT_INTERVAL_MS,
  checkpointDelayMs = DEFAULT_CHECKPOINT_DELAY_MS,
} = {}) {
  if (!documentRef?.addEventListener) throw new TypeError("A document is required for interaction logging.");
  for (const callback of [openLog, prepareCheckpoint, transformCheckpoint, commitPreparedCheckpoint, abortPreparedCheckpoint, onCollectionStarted, onCollectionStopRequested]) {
    if (typeof callback !== "function") throw new TypeError("Interaction-log lifecycle handlers must be functions.");
  }

  const listeners = new Set();
  const encoder = new TextEncoder();
  const state = {
    enabled: false,
    starting: false,
    saving: false,
    checkpointing: false,
    status: "off",
    error: "",
    session: null,
    events: [],
    deferredEvents: [],
    bufferedBytes: 0,
    nextSequence: 1,
    writer: null,
    lastSaved: null,
    limitReached: false,
    extensionSessionUsable: false,
    stopRequested: false,
    stopRequestedAt: null,
    extensionStopConfirmed: false,
    cleanupRequired: false,
  };
  let attached = false;
  let disposed = false;
  let checkpointPromise = null;
  let finalRequestPromise = null;
  let pendingFinalTransaction = null;
  let checkpointTimer = null;
  let periodicTimer = null;
  let lastCapturedClick = null;
  let recentSemanticClick = null;
  const setTimer = windowRef?.setTimeout?.bind(windowRef) || globalThis.setTimeout;
  const clearTimer = windowRef?.clearTimeout?.bind(windowRef) || globalThis.clearTimeout;
  const setPeriodicTimer = windowRef?.setInterval?.bind(windowRef) || globalThis.setInterval;
  const clearPeriodicTimer = windowRef?.clearInterval?.bind(windowRef) || globalThis.clearInterval;
  const timestamp = () => validDate(now());

  function snapshot() {
    const persisted = state.writer?.snapshot?.() || null;
    return Object.freeze({
      enabled: state.enabled,
      starting: state.starting,
      saving: state.saving,
      checkpointing: state.checkpointing,
      status: state.status,
      error: state.error,
      eventCount: state.events.length,
      deferredEventCount: state.deferredEvents.length,
      bufferedBytes: state.bufferedBytes,
      persistedEventCount: Number(persisted?.eventCount) || 0,
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
    disposed = true;
    cancelCheckpointTimer();
    stopPeriodicCheckpoints();
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

  async function beginCollection() {
    if (state.saving || state.starting || state.enabled || state.session || pendingFinalTransaction) return snapshot();
    const started = timestamp();
    const session = {
      id: String(createSessionId()),
      startedAt: started.toISOString(),
      context: context(),
      viewport: viewportSnapshot(windowRef),
    };
    const startEvent = interactionLifecycleEvent({
      sequence: 1,
      startedAt: session.startedAt,
      eventTime: started,
      type: "collection-started",
      label: "Interaction data collection enabled",
      context: session.context,
    });
    state.starting = true;
    state.status = "choosing-location";
    state.error = "";
    state.limitReached = false;
    state.stopRequested = false;
    state.stopRequestedAt = null;
    state.extensionStopConfirmed = false;
    state.cleanupRequired = false;
    notify();

    let unsafeStartCleanup = false;
    try {
      // openLog calls the folder chooser before any extension handshake so the
      // browser still has the switch click's transient user activation.
      const writer = await openLog(interactionSessionPayload(session, [startEvent], started, {}));
      if (!writer?.appendBatch || !writer?.finalize || !writer?.snapshot) {
        throw new Error("The selected folder did not provide a writable interaction-log file.");
      }
      let extensionStart = null;
      try {
        extensionStart = await Promise.resolve(onCollectionStarted({
          sessionId: session.id,
          startedAt: session.startedAt,
        }));
      } catch {
        // The optional study extension must never block StoryVR-only capture.
      }
      if (extensionStart?.startAmbiguous && !extensionStart?.cleanupConfirmed) {
        state.writer = writer;
        state.session = session;
        state.events = [];
        state.deferredEvents = [];
        state.bufferedBytes = 0;
        state.nextSequence = 2;
        state.enabled = false;
        state.starting = false;
        state.extensionSessionUsable = true;
        state.cleanupRequired = true;
        unsafeStartCleanup = true;
        await endCollection();
        return snapshot();
      }
      state.extensionSessionUsable = Boolean(extensionStart?.connected && extensionStart?.started);
      if (disposed) return snapshot();
      state.writer = writer;
      state.session = session;
      state.events = [];
      state.deferredEvents = [];
      state.bufferedBytes = 0;
      state.nextSequence = 2;
      state.enabled = true;
      state.starting = false;
      state.status = "collecting";
      state.error = "";
      startPeriodicCheckpoints();
      notify();
      return snapshot();
    } catch (error) {
      if (unsafeStartCleanup) throw error;
      const canceled = error?.name === "AbortError";
      state.enabled = false;
      state.starting = false;
      state.saving = false;
      state.checkpointing = false;
      state.session = null;
      state.writer = null;
      state.events = [];
      state.deferredEvents = [];
      state.bufferedBytes = 0;
      state.nextSequence = 1;
      state.extensionSessionUsable = false;
      state.stopRequested = false;
      state.stopRequestedAt = null;
      state.extensionStopConfirmed = false;
      state.cleanupRequired = false;
      state.status = canceled ? "location-canceled" : "error";
      state.error = canceled
        ? "Folder selection canceled; collection remains off."
        : String(error?.message || "The interaction-log location could not be opened.");
      notify();
      if (!canceled) throw error;
      return snapshot();
    }
  }

  function setEnabled(enabled) {
    if (state.stopRequested && state.session) return endCollection();
    return enabled ? beginCollection() : endCollection();
  }

  async function endCollection() {
    if (state.starting) return checkpointPromise;
    if (finalRequestPromise) return finalRequestPromise;
    if ((!state.enabled && !pendingFinalTransaction && !state.stopRequested && !state.cleanupRequired) || !state.session) return null;
    if (!state.stopRequested) {
      state.stopRequested = true;
      state.stopRequestedAt = timestamp();
      state.extensionStopConfirmed = false;
    }
    state.enabled = false;
    state.saving = true;
    state.status = "saving";
    state.error = "";
    cancelCheckpointTimer();
    stopPeriodicCheckpoints();
    notify();
    const activeCheckpoint = checkpointPromise;
    // Calling this before the first await starts the extension stop-intent
    // handshake at the same boundary that disables local capture.
    const extensionStop = requestExtensionStopAtCutoff();
    const request = (async () => {
      if (activeCheckpoint) {
        try {
          await activeCheckpoint;
        } catch {
          // A final attempt can safely follow a failed regular checkpoint.
        }
      }
      try {
        await extensionStop;
      } catch (error) {
        state.saving = false;
        state.checkpointing = false;
        state.enabled = false;
        state.status = "error";
        state.error = String(error?.message || "The cross-tab study buffer did not confirm the collection cutoff.");
        requestFinalRetry();
        notify();
        throw error;
      }
      if (!state.session) return null;
      return performCheckpoint({ final: true, reason: "collection-stopped" });
    })();
    const tracked = request.finally(() => {
      if (finalRequestPromise === tracked) finalRequestPromise = null;
    });
    finalRequestPromise = tracked;
    return tracked;
  }

  async function requestExtensionStopAtCutoff() {
    if (state.extensionStopConfirmed) return { connected: state.extensionSessionUsable, stopped: true };
    if (!state.extensionSessionUsable) {
      state.extensionStopConfirmed = true;
      return { connected: false, reason: "extension-not-active" };
    }
    const response = await onCollectionStopRequested({
      sessionId: state.session.id,
      stoppedAt: state.stopRequestedAt.toISOString(),
    });
    if (response?.connected && !response?.stopped) {
      throw new Error("The cross-tab study buffer did not confirm the requested OFF cutoff.");
    }
    state.extensionStopConfirmed = true;
    if (!response?.connected) state.extensionSessionUsable = false;
    return response;
  }

  function appendLifecycleEvent(type, label, eventTime, { force = false, dedupe = false } = {}) {
    if (!state.session) return false;
    if (dedupe && state.events.some((event) => event?.type === type)) return false;
    return appendEvent(interactionLifecycleEvent({
      sequence: state.nextSequence,
      startedAt: state.session.startedAt,
      eventTime,
      type,
      label,
      context: context(),
    }), { force });
  }

  function appendEvent(entry, { force = false } = {}) {
    if (!force && state.limitReached && (
      state.events.length >= maxBufferedEvents || state.bufferedBytes >= maxBufferedBytes
    )) return false;
    state.events.push(entry);
    state.nextSequence = Math.max(state.nextSequence, (Number(entry.sequence) || 0) + 1);
    state.bufferedBytes += interactionEventBytes(encoder, entry);
    const overHardLimit = state.events.length >= maxBufferedEvents || state.bufferedBytes >= maxBufferedBytes;
    if (overHardLimit) {
      state.limitReached = true;
      state.status = "limit-reached";
      state.error = "The interaction buffer is full. StoryVR is retrying the selected location.";
      notify();
      requestCheckpoint("buffer-limit");
      return true;
    }
    if (state.events.length >= checkpointEvents || state.bufferedBytes >= checkpointBytes) {
      requestCheckpoint("buffer-threshold");
    }
    return true;
  }

  function requestCheckpoint(reason = "requested", { delayMs = checkpointDelayMs } = {}) {
    if (pendingFinalTransaction) {
      requestFinalRetry({ delayMs });
      return snapshot();
    }
    if (!state.enabled || state.starting || state.saving || finalRequestPromise || !state.session) return snapshot();
    if (checkpointTimer != null || state.checkpointing) return snapshot();
    checkpointTimer = setTimer?.(() => {
      checkpointTimer = null;
      performCheckpoint({ final: false, reason }).catch(() => {});
    }, Math.max(0, Number(delayMs) || 0));
    checkpointTimer?.unref?.();
    return snapshot();
  }

  function requestFinalRetry({ delayMs = Math.max(5_000, checkpointDelayMs) } = {}) {
    if ((!pendingFinalTransaction && !(state.stopRequested && state.session)) || checkpointTimer != null) return snapshot();
    checkpointTimer = setTimer?.(() => {
      checkpointTimer = null;
      endCollection().catch(() => {});
    }, Math.max(0, Number(delayMs) || 0));
    checkpointTimer?.unref?.();
    return snapshot();
  }

  async function performCheckpoint({ final, reason }) {
    if (checkpointPromise) return checkpointPromise;
    if (!state.session || !state.writer || (!state.enabled && !final)) return null;
    const operation = final ? runFinalCheckpoint(reason) : runRegularCheckpoint(reason);
    const tracked = operation.finally(() => {
      if (checkpointPromise === tracked) checkpointPromise = null;
    });
    checkpointPromise = tracked;
    return tracked;
  }

  async function prepareExtensionCheckpoint({ checkpointedAt, final, reason }) {
    if (!state.extensionSessionUsable) return null;
    const preparation = await prepareCheckpoint({
      sessionId: state.session.id,
      checkpointedAt: checkpointedAt.toISOString(),
      endedAt: checkpointedAt.toISOString(),
      final,
      reason,
    });
    if (preparation?.connected && !preparation?.prepared) {
      throw new Error(final
        ? "The cross-tab study buffer did not finish preparing for finalization."
        : "The cross-tab study buffer did not finish preparing a checkpoint.");
    }
    return preparation?.prepared ? preparation : null;
  }

  async function runRegularCheckpoint(reason) {
    const checkpointedAt = timestamp();
    let preparation = null;
    let detached = [];
    let fileWritten = false;
    const deferredBeforeCheckpoint = state.deferredEvents;
    state.checkpointing = true;
    state.status = "checkpointing";
    state.error = "";
    notify();

    try {
      preparation = await prepareExtensionCheckpoint({ checkpointedAt, final: false, reason });
      detached = detachBufferedEvents();
      const basePayload = interactionSessionPayload(state.session, detached, checkpointedAt, {
        complete: false,
        limitReached: state.limitReached,
      });
      const transformedPayload = await transformCheckpoint(basePayload, preparation, { final: false, reason });
      const partition = partitionCheckpointEvents(
        [...state.deferredEvents, ...(Array.isArray(transformedPayload?.events) ? transformedPayload.events : [])],
      );
      state.deferredEvents = partition.deferred;
      const payload = {
        ...transformedPayload,
        eventCount: partition.ready.length,
        events: partition.ready,
      };
      if (payload.events.length) {
        await state.writer.appendBatch(payload, { checkpointedAt });
        fileWritten = true;
      }
      if (preparation?.prepared) {
        await commitPreparedCheckpoint(preparation, {
          sessionId: state.session.id,
          checkpointedAt: checkpointedAt.toISOString(),
          final: false,
          fileWritten,
        });
      }
      state.checkpointing = false;
      state.status = state.stopRequested ? "saving" : "collecting";
      state.error = "";
      state.limitReached = state.events.length >= maxBufferedEvents || state.bufferedBytes >= maxBufferedBytes;
      notify();
      if (!state.stopRequested && (state.events.length >= checkpointEvents || state.bufferedBytes >= checkpointBytes)) {
        requestCheckpoint("buffer-remains");
      }
      return state.writer.snapshot();
    } catch (error) {
      state.deferredEvents = deferredBeforeCheckpoint;
      restoreDetachedEvents(detached);
      await abortPreparationQuietly(preparation, { final: false, fileWritten });
      markCheckpointFailure(error, { keepSaving: state.stopRequested });
      if (!state.stopRequested) startPeriodicCheckpoints();
      notify();
      if (!state.stopRequested) {
        requestCheckpoint("write-retry", { delayMs: Math.max(5_000, checkpointDelayMs) });
      }
      throw error;
    }
  }

  async function runFinalCheckpoint(reason) {
    cancelCheckpointTimer();
    stopPeriodicCheckpoints();
    const transaction = pendingFinalTransaction || {
      checkpointedAt: state.stopRequestedAt || timestamp(),
      preparation: null,
      preparationReady: false,
      fileWritten: false,
      fileFinalized: false,
      extensionCommitted: false,
      failureMarkerRecorded: false,
      result: null,
    };
    const firstAttempt = !pendingFinalTransaction;
    pendingFinalTransaction = transaction;
    let detached = [];
    let deferredBeforeAttempt = state.deferredEvents;
    let appendedThisAttempt = false;

    if (firstAttempt) {
      appendLifecycleEvent(
        "collection-stopped",
        "Interaction data collection disabled",
        transaction.checkpointedAt,
        { force: true, dedupe: true },
      );
    }
    state.enabled = false;
    state.saving = true;
    state.status = "saving";
    state.error = "";
    notify();

    try {
      if (!transaction.preparationReady) {
        transaction.preparation = await prepareExtensionCheckpoint({
          checkpointedAt: transaction.checkpointedAt,
          final: true,
          reason,
        });
        transaction.preparationReady = true;
      }

      if (!transaction.fileFinalized && (!transaction.fileWritten || state.events.length || state.deferredEvents.length)) {
        detached = detachBufferedEvents();
        const basePayload = interactionSessionPayload(state.session, detached, transaction.checkpointedAt, {
          complete: true,
          limitReached: state.limitReached,
        });
        const preparationForAppend = transaction.fileWritten ? null : transaction.preparation;
        const transformedPayload = await transformCheckpoint(
          basePayload,
          preparationForAppend,
          { final: true, reason },
        );
        const partition = partitionCheckpointEvents(
          [...state.deferredEvents, ...(Array.isArray(transformedPayload?.events) ? transformedPayload.events : [])],
        );
        state.deferredEvents = [];
        await state.writer.appendBatch({
          ...transformedPayload,
          eventCount: partition.ready.length,
          events: partition.ready,
        }, { checkpointedAt: transaction.checkpointedAt });
        appendedThisAttempt = true;
        transaction.fileWritten = true;
      }

      if (!transaction.fileFinalized) {
        transaction.result = await state.writer.finalize({ endedAt: transaction.checkpointedAt });
        transaction.fileFinalized = true;
      }

      if (!transaction.extensionCommitted) {
        if (transaction.preparation?.prepared) {
          await commitPreparedCheckpoint(transaction.preparation, {
            sessionId: state.session.id,
            checkpointedAt: transaction.checkpointedAt.toISOString(),
            final: true,
            fileWritten: transaction.fileWritten,
          });
        }
        transaction.extensionCommitted = true;
      }

      return completeFinalTransaction(transaction.result || state.writer.snapshot());
    } catch (error) {
      if (!appendedThisAttempt) {
        state.deferredEvents = deferredBeforeAttempt;
        restoreDetachedEvents(detached);
      }
      pendingFinalTransaction = transaction;
      const addFailureMarker = !transaction.fileFinalized && !transaction.failureMarkerRecorded;
      markCheckpointFailure(error, { addMarker: addFailureMarker });
      if (addFailureMarker) transaction.failureMarkerRecorded = true;
      requestFinalRetry();
      notify();
      throw error;
    }
  }

  function restoreDetachedEvents(detached) {
    if (!detached.length) return;
    state.events = [...detached, ...state.events];
    state.bufferedBytes = interactionEventsBytes(encoder, state.events);
    if (lastCapturedClick) lastCapturedClick.index += detached.length;
  }

  async function abortPreparationQuietly(preparation, { final, fileWritten }) {
    if (!preparation?.prepared) return;
    try {
      await abortPreparedCheckpoint(preparation, {
        sessionId: state.session?.id,
        final,
        fileWritten,
      });
    } catch {
      // Preserve the original file or commit failure.
    }
  }

  function markCheckpointFailure(error, { addMarker = true, keepSaving = false } = {}) {
    state.enabled = !state.stopRequested;
    state.saving = Boolean(keepSaving);
    state.checkpointing = false;
    state.status = keepSaving ? "saving" : "error";
    state.error = String(error?.message || "The interaction log could not be written to the selected location.");
    if (addMarker) {
      appendLifecycleEvent(
        "collection-save-failed",
        "Interaction log write failed; buffered clicks retained",
        state.stopRequestedAt || timestamp(),
        { force: true, dedupe: true },
      );
    }
  }

  function completeFinalTransaction(result) {
    state.lastSaved = {
      fileName: String(result.fileName || state.writer.snapshot().fileName || "storyvr-interactions.json"),
      eventCount: Number(result.eventCount) || 0,
      savedAt: timestamp().toISOString(),
      method: String(result.method || "selected-directory"),
    };
    state.events = [];
    state.deferredEvents = [];
    state.bufferedBytes = 0;
    state.session = null;
    state.writer = null;
    state.saving = false;
    state.checkpointing = false;
    state.enabled = false;
    state.status = "saved";
    state.error = "";
    state.limitReached = false;
    state.nextSequence = 1;
    state.extensionSessionUsable = false;
    state.stopRequested = false;
    state.stopRequestedAt = null;
    state.extensionStopConfirmed = false;
    state.cleanupRequired = false;
    pendingFinalTransaction = null;
    lastCapturedClick = null;
    recentSemanticClick = null;
    notify();
    return result;
  }

  function detachBufferedEvents() {
    const count = state.events.length;
    const detached = state.events.splice(0, count);
    if (lastCapturedClick) {
      if (lastCapturedClick.index < count) lastCapturedClick = null;
      else lastCapturedClick.index -= count;
    }
    state.bufferedBytes = interactionEventsBytes(encoder, state.events);
    return detached;
  }

  function startPeriodicCheckpoints() {
    if (periodicTimer != null || !Number.isFinite(checkpointIntervalMs) || checkpointIntervalMs <= 0) return;
    periodicTimer = setPeriodicTimer?.(() => requestCheckpoint("periodic"), checkpointIntervalMs);
    periodicTimer?.unref?.();
  }

  function stopPeriodicCheckpoints() {
    if (periodicTimer != null) clearPeriodicTimer?.(periodicTimer);
    periodicTimer = null;
  }

  function cancelCheckpointTimer() {
    if (checkpointTimer != null) clearTimer?.(checkpointTimer);
    checkpointTimer = null;
  }

  function handleDocumentClick(event) {
    if (!state.enabled || state.stopRequested || state.saving || pendingFinalTransaction?.fileFinalized || !state.session) return;
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
      sequence: state.nextSequence,
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
    if (state.status !== "error" && state.status !== "limit-reached" && !state.checkpointing) {
      state.status = "collecting";
    }
  }

  function recordSemanticClick(event, semanticTarget) {
    if (!state.enabled || state.stopRequested || state.saving || pendingFinalTransaction?.fileFinalized || !state.session) return false;
    const eventTime = timestamp();
    const semantic = boundedSemanticTarget(semanticTarget);
    if (event === lastCapturedClick?.event && matchesCapturedClick(event, eventTime, lastCapturedClick)) {
      const entry = state.events[lastCapturedClick.index];
      if (entry?.type === "click") {
        entry.target = { ...entry.target, semantic };
        state.bufferedBytes = interactionEventsBytes(encoder, state.events);
        return true;
      }
    }
    const entry = createInteractionEventRecord(event, {
      sequence: state.nextSequence,
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
    return true;
  }

  return Object.freeze({
    start,
    dispose,
    subscribe,
    snapshot,
    setEnabled,
    requestCheckpoint,
    recordSemanticClick,
  });
}

function interactionLifecycleEvent({ sequence, startedAt, eventTime, type, label, context }) {
  return {
    sequence,
    timestamp: eventTime.toISOString(),
    elapsedMs: elapsedSinceStart(eventTime, startedAt),
    type,
    context: boundedSerializableObject(context),
    target: {
      kind: "system",
      tag: "system",
      label,
    },
  };
}

function interactionSessionPayload(session, events, endedAt, { complete = false, limitReached = false } = {}) {
  const started = validDate(session?.startedAt);
  const ended = validDate(endedAt);
  return {
    schemaVersion: INTERACTION_LOG_SCHEMA_VERSION,
    sessionId: session?.id,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    durationMs: Math.max(0, ended.getTime() - started.getTime()),
    sessionContext: boundedSerializableObject(session?.context),
    viewport: boundedSerializableObject(session?.viewport),
    eventCount: events.length,
    complete: Boolean(complete),
    bufferLimitReached: Boolean(limitReached),
    events: events.map((entry) => ({ ...entry })),
  };
}

function interactionEventBytes(encoder, value) {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength + 1;
  } catch {
    return 1;
  }
}

function interactionEventsBytes(encoder, events) {
  return events.reduce((total, event) => total + interactionEventBytes(encoder, event), 0);
}

function partitionCheckpointEvents(events) {
  const seen = new Set();
  const ordered = events
    .filter((event) => event && typeof event === "object" && !Array.isArray(event))
    .filter((event, index) => {
      const source = String(event.captureSource || event.surface || "storyvr");
      const sourceSequence = Number(event.sourceSequence) || Number(event.sequence) || index + 1;
      const key = `${source}:${sourceSequence}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((event, insertionIndex) => ({ event, insertionIndex }))
    .sort((left, right) => (
      validDate(left.event.timestamp).getTime() - validDate(right.event.timestamp).getTime()
      || left.insertionIndex - right.insertionIndex
    ))
    .map(({ event }) => event);
  return { ready: ordered, deferred: [] };
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

function defaultSessionId() {
  return globalThis.crypto?.randomUUID?.()
    || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
