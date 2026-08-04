const LOG_FILE_PICKER_ID = "storyvr-interaction-logs";
const CAPTURE_SOURCE_STORYVR = "storyvr";
const CAPTURE_SOURCE_EXTENSION = "study-extension";
const MAX_PENDING_SEQUENCE_RANGES = 256;

export async function createInteractionLogFileInSelectedDirectory(payload, {
  windowRef = globalThis.window,
} = {}) {
  if (typeof windowRef?.showDirectoryPicker !== "function") {
    throw new Error("This browser cannot select a folder for the interaction log. Use a current Chrome browser.");
  }

  // Keep this as the first asynchronous browser operation. The folder chooser
  // requires the transient user activation from the Data Collection click.
  const directoryHandle = await windowRef.showDirectoryPicker({
    id: LOG_FILE_PICKER_ID,
    mode: "readwrite",
  });
  const fileName = interactionLogFileName(payload);
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writer = createInteractionLogFileWriter({ fileHandle, fileName });
  await writer.initialize(payload);
  return writer;
}

export function createInteractionLogFileWriter({ fileHandle, fileName = fileHandle?.name } = {}) {
  if (!fileHandle?.createWritable) throw new TypeError("A writable interaction-log file handle is required.");
  const encoder = new TextEncoder();
  const state = {
    initialized: false,
    fileName: safeFileName(fileName) || "storyvr-interactions.json",
    staticPayload: null,
    startedAt: null,
    tailOffset: 0,
    eventCount: 0,
    checkpointCount: 0,
    complete: false,
    bufferLimitReached: false,
    captureSources: new Set(),
    extensionConnected: false,
    extensionEventCount: 0,
    studyExtension: null,
    sourceSequences: new Map(),
    endedAt: null,
  };
  let writeQueue = Promise.resolve();

  function enqueue(operation) {
    const task = writeQueue.then(operation);
    writeQueue = task.catch(() => {});
    return task;
  }

  async function initialize(payload) {
    return enqueue(async () => {
      if (state.initialized) throw new Error("The interaction-log file is already initialized.");
      const startedAt = validDate(payload?.startedAt);
      const staticPayload = {
        schemaVersion: String(payload?.schemaVersion || "storyvr-interaction-log/v1"),
        sessionId: String(payload?.sessionId || ""),
        startedAt: startedAt.toISOString(),
        sessionContext: serializableObject(payload?.sessionContext),
        viewport: serializableObject(payload?.viewport),
      };
      const prefix = interactionLogPrefix(staticPayload);
      const prepared = prepareAppendState(state, payload, {
        startedAt,
        checkpointedAt: startedAt,
        existingEventCount: 0,
      });
      const insertion = interactionEventChunk(prepared.events, false);
      const tailOffset = byteLength(encoder, prefix) + byteLength(encoder, insertion);
      const tail = interactionLogTail(prepared.next, startedAt, false);
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(`${prefix}${insertion}${tail}`);
        await writable.close();
      } catch (error) {
        try {
          await writable.abort?.();
        } catch {
          // Preserve the original write error.
        }
        throw error;
      }
      state.initialized = true;
      state.staticPayload = staticPayload;
      state.startedAt = startedAt;
      commitPreparedState(state, prepared.next, { tailOffset, complete: false });
      return snapshot();
    });
  }

  async function appendBatch(payload, { checkpointedAt = new Date() } = {}) {
    return enqueue(async () => {
      ensureInitialized(state);
      const at = validDate(checkpointedAt);
      const prepared = prepareAppendState(state, payload, {
        startedAt: state.startedAt,
        checkpointedAt: at,
        existingEventCount: state.eventCount,
      });
      const insertion = interactionEventChunk(prepared.events, state.eventCount > 0);
      const nextTailOffset = state.tailOffset + byteLength(encoder, insertion);
      const tail = interactionLogTail(prepared.next, at, false);
      await replaceInteractionLogTail(fileHandle, {
        tailOffset: state.tailOffset,
        content: `${insertion}${tail}`,
        finalSize: nextTailOffset + byteLength(encoder, tail),
      });
      commitPreparedState(state, prepared.next, { tailOffset: nextTailOffset, complete: false });
      return {
        ...snapshot(),
        appendedEventCount: prepared.events.length,
      };
    });
  }

  async function finalize({ endedAt = new Date() } = {}) {
    return enqueue(async () => {
      ensureInitialized(state);
      const at = validDate(endedAt);
      const next = cloneWriterState(state);
      next.complete = true;
      next.endedAt = at;
      const tail = interactionLogTail(next, at, true);
      await replaceInteractionLogTail(fileHandle, {
        tailOffset: state.tailOffset,
        content: tail,
        finalSize: state.tailOffset + byteLength(encoder, tail),
      });
      state.complete = true;
      state.endedAt = at;
      return snapshot();
    });
  }

  function snapshot() {
    return Object.freeze({
      saved: state.initialized,
      fileName: state.fileName,
      eventCount: state.eventCount,
      checkpointCount: state.checkpointCount,
      complete: state.complete,
      endedAt: state.endedAt?.toISOString?.() || null,
      method: "selected-directory",
    });
  }

  return Object.freeze({ initialize, appendBatch, finalize, snapshot });
}

async function replaceInteractionLogTail(fileHandle, { tailOffset, content, finalSize }) {
  const writable = await fileHandle.createWritable({ keepExistingData: true });
  try {
    await writable.seek(tailOffset);
    await writable.write(content);
    await writable.truncate(finalSize);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

function prepareAppendState(current, payload, { startedAt, checkpointedAt, existingEventCount }) {
  const next = cloneWriterState(current);
  next.startedAt = startedAt;
  next.complete = false;
  next.endedAt = checkpointedAt;
  next.checkpointCount = current.checkpointCount + 1;
  next.bufferLimitReached = Boolean(
    current.bufferLimitReached
    || payload?.bufferLimitReached
    || payload?.limitReached,
  );

  const sourceSequences = next.sourceSequences;
  const fallbackSequences = new Map();
  const seenInBatch = new Set();
  const uniqueEvents = [];
  for (const [insertionIndex, value] of (Array.isArray(payload?.events) ? payload.events : []).entries()) {
    const event = normalizeInteractionEvent(value, sourceSequences, fallbackSequences);
    if (!event) continue;
    const key = `${event.captureSource}:${event.sourceSequence}`;
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    uniqueEvents.push({ event, insertionIndex, key });
  }
  const acceptedKeys = new Set();
  const sequenceOrderedEvents = [...uniqueEvents].sort((left, right) => (
    left.event.captureSource.localeCompare(right.event.captureSource)
    || left.event.sourceSequence - right.event.sourceSequence
    || left.insertionIndex - right.insertionIndex
  ));
  for (const { event, key } of sequenceOrderedEvents) {
    const tracker = sourceSequenceTracker(sourceSequences, event.captureSource);
    if (recordSourceSequence(tracker, event.sourceSequence)) {
      acceptedKeys.add(key);
      assertBoundedSequenceState(tracker, event.captureSource);
    }
  }
  const candidates = uniqueEvents
    .filter(({ key }) => acceptedKeys.has(key))
    .sort((left, right) => (
      validDate(left.event.timestamp).getTime() - validDate(right.event.timestamp).getTime()
      || left.insertionIndex - right.insertionIndex
    ))
    .map(({ event }, index) => ({
      ...event,
      sequence: existingEventCount + index + 1,
      elapsedMs: Math.max(0, validDate(event.timestamp).getTime() - startedAt.getTime()),
    }));

  for (const event of candidates) {
    next.captureSources.add(event.surface || CAPTURE_SOURCE_STORYVR);
    if (event.captureSource === CAPTURE_SOURCE_EXTENSION) next.extensionEventCount += 1;
    if (event.type === "buffer-limit-reached") next.bufferLimitReached = true;
  }
  next.eventCount = existingEventCount + candidates.length;
  applyStudyExtensionMetadata(next, payload?.studyExtension);
  if (!next.captureSources.size) next.captureSources.add(CAPTURE_SOURCE_STORYVR);
  return { events: candidates, next };
}

function normalizeInteractionEvent(value, sourceSequences, fallbackSequences) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const surface = ["browser", "original", "storyvr"].includes(value.surface)
    ? value.surface
    : CAPTURE_SOURCE_STORYVR;
  const captureSource = value.captureSource === CAPTURE_SOURCE_EXTENSION
    || (["browser", "original"].includes(surface) && value.captureSource !== CAPTURE_SOURCE_STORYVR)
    ? CAPTURE_SOURCE_EXTENSION
    : CAPTURE_SOURCE_STORYVR;
  const explicitSequence = positiveInteger(value.sourceSequence) || positiveInteger(value.sequence);
  const fallbackSequence = fallbackSequences.get(captureSource)
    || maximumTrackedSequence(sourceSequenceTracker(sourceSequences, captureSource)) + 1;
  const sourceSequence = explicitSequence || fallbackSequence;
  fallbackSequences.set(captureSource, Math.max(fallbackSequence, sourceSequence + 1));
  return {
    ...value,
    captureSource,
    sourceSequence,
    surface,
    timestamp: validDate(value.timestamp).toISOString(),
  };
}

function applyStudyExtensionMetadata(state, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (value.connected) {
    state.extensionConnected = true;
    state.studyExtension = {
      schemaVersion: String(value.schemaVersion || state.studyExtension?.schemaVersion || "storyvr-cross-tab-study/v1"),
      connected: true,
      studyConfigId: String(value.studyConfigId || state.studyExtension?.studyConfigId || ""),
      approvalMode: String(value.approvalMode || state.studyExtension?.approvalMode || ""),
    };
  }
}

function interactionLogPrefix(staticPayload) {
  const properties = Object.entries(staticPayload).map(([key, value]) => formatJsonProperty(key, value));
  return `{\n${properties.join(",\n")},\n  "events": [`;
}

function interactionEventChunk(events, hasExistingEvents) {
  if (!events.length) return "";
  const serialized = events.map((event) => indentJson(JSON.stringify(event, null, 2), 4)).join(",\n");
  return `${hasExistingEvents ? "," : ""}\n${serialized}`;
}

function interactionLogTail(state, endedAt, complete) {
  const extension = state.extensionConnected ? {
    ...(state.studyExtension || {}),
    connected: true,
    externalEventCount: state.extensionEventCount,
  } : {
    connected: false,
    externalEventCount: 0,
  };
  const properties = {
    endedAt: validDate(endedAt).toISOString(),
    durationMs: Math.max(0, validDate(endedAt).getTime() - validDate(state.startedAt).getTime()),
    eventCount: state.eventCount,
    complete: Boolean(complete),
    collectionState: complete ? "complete" : "collecting",
    checkpointCount: state.checkpointCount,
    bufferLimitReached: Boolean(state.bufferLimitReached),
    captureScope: state.extensionConnected ? "storyvr-and-approved-study-tabs" : "storyvr-only",
    captureSources: [...state.captureSources],
    studyExtension: extension,
  };
  return `\n  ],\n${Object.entries(properties).map(([key, value]) => formatJsonProperty(key, value)).join(",\n")}\n}\n`;
}

function formatJsonProperty(key, value) {
  return `  ${JSON.stringify(key)}: ${indentContinuation(JSON.stringify(value, null, 2), 2)}`;
}

function indentContinuation(value, spaces) {
  return String(value).replace(/\n/g, `\n${" ".repeat(spaces)}`);
}

function indentJson(value, spaces) {
  const indentation = " ".repeat(spaces);
  return `${indentation}${String(value).replace(/\n/g, `\n${indentation}`)}`;
}

function cloneWriterState(value) {
  return {
    ...value,
    captureSources: new Set(value.captureSources || []),
    sourceSequences: cloneSourceSequences(value.sourceSequences),
    studyExtension: value.studyExtension ? { ...value.studyExtension } : null,
  };
}

function commitPreparedState(target, next, { tailOffset, complete }) {
  target.tailOffset = tailOffset;
  target.eventCount = next.eventCount;
  target.checkpointCount = next.checkpointCount;
  target.complete = complete;
  target.bufferLimitReached = next.bufferLimitReached;
  target.captureSources = new Set(next.captureSources);
  target.extensionConnected = next.extensionConnected;
  target.extensionEventCount = next.extensionEventCount;
  target.studyExtension = next.studyExtension ? { ...next.studyExtension } : null;
  target.sourceSequences = cloneSourceSequences(next.sourceSequences);
  target.endedAt = next.endedAt;
}

function cloneSourceSequences(value) {
  return new Map([...(value || [])].map(([source, tracker]) => [source, {
    contiguousThrough: positiveInteger(tracker?.contiguousThrough) || 0,
    pendingRanges: (Array.isArray(tracker?.pendingRanges) ? tracker.pendingRanges : [])
      .map((range) => ({ start: range.start, end: range.end })),
  }]));
}

function sourceSequenceTracker(trackers, source) {
  let tracker = trackers.get(source);
  if (!tracker) {
    tracker = { contiguousThrough: 0, pendingRanges: [] };
    trackers.set(source, tracker);
  }
  return tracker;
}

function maximumTrackedSequence(tracker) {
  const lastRange = tracker.pendingRanges[tracker.pendingRanges.length - 1];
  return Math.max(tracker.contiguousThrough, lastRange?.end || 0);
}

function recordSourceSequence(tracker, sequence) {
  if (sequence <= tracker.contiguousThrough) return false;
  if (tracker.pendingRanges.some((range) => sequence >= range.start && sequence <= range.end)) {
    return false;
  }

  let rangeStart = sequence;
  let rangeEnd = sequence;
  let insertionIndex = 0;
  while (
    insertionIndex < tracker.pendingRanges.length
    && tracker.pendingRanges[insertionIndex].end < rangeStart - 1
  ) {
    insertionIndex += 1;
  }
  let replacementEnd = insertionIndex;
  while (
    replacementEnd < tracker.pendingRanges.length
    && tracker.pendingRanges[replacementEnd].start <= rangeEnd + 1
  ) {
    rangeStart = Math.min(rangeStart, tracker.pendingRanges[replacementEnd].start);
    rangeEnd = Math.max(rangeEnd, tracker.pendingRanges[replacementEnd].end);
    replacementEnd += 1;
  }
  tracker.pendingRanges.splice(
    insertionIndex,
    replacementEnd - insertionIndex,
    { start: rangeStart, end: rangeEnd },
  );

  while (tracker.pendingRanges[0]?.start === tracker.contiguousThrough + 1) {
    tracker.contiguousThrough = tracker.pendingRanges.shift().end;
  }
  return true;
}

function assertBoundedSequenceState(tracker, source) {
  if (tracker.pendingRanges.length > MAX_PENDING_SEQUENCE_RANGES) {
    throw new Error(
      `Too many out-of-order interaction event ranges for ${source}; checkpoint was not written.`,
    );
  }
}

function serializableObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function ensureInitialized(state) {
  if (!state.initialized) throw new Error("The interaction-log file has not been initialized.");
}

function byteLength(encoder, value) {
  return encoder.encode(String(value)).byteLength;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date?.getTime?.()) ? new Date(date) : new Date(0);
}

function safeFileName(value) {
  return String(value || "").replace(/[\\/:*?"<>|]/g, "-").slice(0, 240);
}

function safeFileToken(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function interactionLogFileName(payload) {
  const timestamp = validDate(payload?.startedAt || payload?.endedAt)
    .toISOString()
    .replace(/[:.]/g, "-");
  const sessionId = safeFileToken(payload?.sessionId).slice(0, 32) || "session";
  return `storyvr-interactions-${timestamp}-${sessionId}.json`;
}
