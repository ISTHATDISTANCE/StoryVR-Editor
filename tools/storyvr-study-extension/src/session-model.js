export const STUDY_SESSION_SCHEMA_VERSION = "storyvr-cross-tab-study/v1";
export const STUDY_SESSION_STORAGE_KEY = "storyvrStudySession";
export const CHECKPOINT_STUDY_EVENTS = 1_000;
export const CHECKPOINT_STUDY_BYTES = 512 * 1024;
export const MAX_STUDY_EVENTS = 10_000;
export const MAX_STUDY_BYTES = 6 * 1024 * 1024;

const EVENT_TYPES = new Set([
  "browser-focus-change",
  "buffer-limit-reached",
  "click",
  "focus-change",
  "page-lifecycle",
  "scroll-depth",
  "tab-activated",
  "visibility-change",
]);
const SURFACES = new Set(["browser", "original", "storyvr"]);
const MAX_LABEL_LENGTH = 180;
const MAX_TOKEN_LENGTH = 160;
const MAX_TRACKED_TABS = 256;
const STATE_RESERVE_BYTES = 2_048;

export function matchConfiguredPage(config, urlValue, surface) {
  let url;
  try {
    url = new URL(String(urlValue || ""));
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const pages = surface === "storyvr" ? config?.controllerPages : config?.originalPages;
  for (const page of Array.isArray(pages) ? pages : []) {
    if (url.origin !== page.origin || !matchesPathPrefix(url.pathname, page.pathPrefix)) continue;
    return {
      surface,
      pageKey: safeToken(page.pageKey, MAX_TOKEN_LENGTH),
      captureScrollDepth: Boolean(page.captureScrollDepth),
      captureUnmappedTextLabels: Boolean(page.captureUnmappedTextLabels),
      semanticTargets: Array.isArray(page.semanticTargets) ? page.semanticTargets : [],
    };
  }
  return null;
}

function matchesPathPrefix(pathname, pathPrefix) {
  if (pathPrefix === "/") return true;
  if (pathPrefix.endsWith("/")) return pathname.startsWith(pathPrefix);
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

export function senderStudyPage(config, sender, surface) {
  if (!sender || sender.frameId !== 0 || !sender.tab || !Number.isInteger(sender.tab.id)) return null;
  return matchConfiguredPage(config, sender.url || sender.tab.url, surface);
}

export function reduceStudySession(state, action, {
  studyConfigId = "study",
  now = () => new Date(),
  createExportToken = defaultExportToken,
  createCheckpointToken = defaultCheckpointToken,
  checkpointEventThreshold = CHECKPOINT_STUDY_EVENTS,
  checkpointByteThreshold = CHECKPOINT_STUDY_BYTES,
  maximumEvents = MAX_STUDY_EVENTS,
  maximumBytes = MAX_STUDY_BYTES,
} = {}) {
  let current = validState(state);
  const type = safeToken(action?.type, 80);

  if (type === "status") return { state: current, response: publicStatus(current) };

  if (type === "cancel") {
    const sessionId = safeToken(action.sessionId, MAX_TOKEN_LENGTH);
    if (!sessionId) return { state: current, response: { canceled: false, error: "invalid-session" } };
    if (!current) {
      return { state: null, response: { canceled: true, alreadyCanceled: true, status: "off" } };
    }
    if (current.sessionId !== sessionId) {
      return { state: current, response: { canceled: false, error: "session-mismatch", status: current.status } };
    }
    return {
      state: null,
      response: {
        canceled: true,
        status: "off",
        discardedEventCount: current.events.length,
      },
    };
  }

  if (type === "commit-export" && committedIdentityMatches(current, action)) {
    return { state: current, response: { committed: true, alreadyCommitted: true, status: "saved" } };
  }

  if (type === "prepare-export" && committedSessionMatches(current, action)) {
    return {
      state: current,
      response: {
        prepared: true,
        alreadyCommitted: true,
        schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
        studyConfigId: current.studyConfigId,
        sessionId: current.sessionId,
        startedAt: current.startedAt,
        endedAt: current.endedAt,
        exportToken: current.committedExportToken,
        throughSequence: 0,
        eventCount: 0,
        events: [],
      },
    };
  }

  if (type === "commit-checkpoint" && committedCheckpointIdentityMatches(current, action)) {
    return {
      state: current,
      response: { committed: true, alreadyCommitted: true, status: current.status },
    };
  }

  if (type === "abort-checkpoint" && abortedCheckpointIdentityMatches(current, action)) {
    return {
      state: current,
      response: { aborted: true, alreadyAborted: true, status: current.status },
    };
  }

  if (type === "abort-export" && abortedExportIdentityMatches(current, action)) {
    return {
      state: current,
      response: { aborted: true, alreadyAborted: true, status: current.status },
    };
  }

  if (type === "start") {
    if (current?.status === "saved") current = null;
    const sessionId = safeToken(action.sessionId, MAX_TOKEN_LENGTH);
    const startedAt = validIsoDate(action.startedAt, now);
    if (!sessionId) return { state: current, response: { started: false, error: "invalid-session" } };
    const replacedSessionId = current && current.sessionId !== sessionId ? current.sessionId : "";
    const discardedEventCount = replacedSessionId ? current.events.length : 0;
    const next = current && !replacedSessionId ? cloneState(current) : {
      schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
      studyConfigId: safeToken(studyConfigId, MAX_TOKEN_LENGTH),
      sessionId,
      startedAt,
      status: "collecting",
      nextSequence: 1,
      events: [],
      tabContexts: replacedSessionId ? cloneState(current.tabContexts) : {},
      exportToken: "",
      exportThroughSequence: 0,
      checkpointToken: "",
      checkpointedAt: "",
      checkpointThroughSequence: 0,
      checkpointNeeded: false,
      endedAt: "",
      limitReached: false,
      stopRequested: false,
      stoppedAt: "",
      stopThroughSequence: 0,
    };
    next.tabContexts = registerTabContext(next.tabContexts, action.tabId, {
      surface: "storyvr",
      pageKey: action.pageKey,
    });
    if (serializedBytes(next) > maximumBytes) {
      return { state: current, response: { started: false, error: "buffer-quota", status: current?.status || "off" } };
    }
    return {
      state: next,
      response: {
        started: true,
        active: isCapturing(next),
        status: next.status,
        sessionId,
        ...(!replacedSessionId ? { alreadyStarted: Boolean(current) } : {
          restarted: true,
          replaced: true,
          replacedSessionId,
          discardedEventCount,
        }),
      },
    };
  }

  if (type === "request-stop") {
    const sessionId = safeToken(action.sessionId, MAX_TOKEN_LENGTH);
    if (!sessionId || current?.sessionId !== sessionId) {
      return {
        state: current,
        response: {
          stopped: false,
          error: current ? "session-mismatch" : "session-not-collecting",
          status: current?.status || "off",
        },
      };
    }
    if (current.status === "saved") {
      return {
        state: current,
        response: {
          stopped: true,
          alreadyStopped: true,
          status: "saved",
          stoppedAt: current.endedAt,
          stopThroughSequence: 0,
        },
      };
    }
    if (current.stopRequested) {
      return { state: current, response: stopIntentSnapshot(current, { alreadyStopped: true }) };
    }
    const next = cloneState(current);
    next.stopRequested = true;
    next.stoppedAt = next.exportToken
      ? next.endedAt
      : monotonicIsoDate(action.stoppedAt, next.startedAt, now);
    next.stopThroughSequence = next.exportToken
      ? next.exportThroughSequence
      : eventBoundarySequence(next.events);
    if (!next.checkpointToken && !next.exportToken) next.status = "stop-requested";
    next.checkpointNeeded = false;
    if (serializedBytes(next) > maximumBytes) {
      return { state: current, response: { stopped: false, error: "buffer-quota", status: current.status } };
    }
    return { state: next, response: stopIntentSnapshot(next) };
  }

  if (!current) {
    if (type === "commit-export") {
      return {
        state: null,
        response: {
          committed: false,
          error: "session-not-collecting",
          status: "off",
        },
      };
    }
    return { state: null, response: { active: false, status: "off" } };
  }

  if (type === "register-tab") {
    const next = cloneState(current);
    next.tabContexts = registerTabContext(next.tabContexts, action.tabId, action.context);
    if (serializedBytes(next) > maximumBytes) {
      return { state: current, response: { active: isCapturing(current), registered: false, status: current.status } };
    }
    return { state: next, response: { active: isCapturing(next), status: next.status } };
  }

  if (type === "remove-tab") {
    const next = cloneState(current);
    if (Number.isInteger(action.tabId)) delete next.tabContexts[String(action.tabId)];
    return { state: next, response: { active: isCapturing(next), status: next.status } };
  }

  if (type === "record") {
    if (!isCapturing(current)) {
      return { state: current, response: { recorded: false, active: false, status: current.status } };
    }
    const context = normalizedContext(action.context);
    const next = cloneState(current);
    const registeredContexts = registerTabContext(next.tabContexts, action.tabId, context);
    if (serializedBytes({ ...next, tabContexts: registeredContexts }) <= maximumBytes) {
      next.tabContexts = registeredContexts;
    }
    const event = sanitizeStudyEvent(action.event, {
      surface: context.surface,
      pageKey: context.pageKey,
      sequence: next.nextSequence,
      startedAt: next.startedAt,
      now,
    });
    if (!event) {
      return { state: current, response: { recorded: false, active: isCapturing(current), status: current.status } };
    }
    return appendBoundedEvent(next, event, {
      maximumEvents,
      maximumBytes,
      checkpointEventThreshold,
      checkpointByteThreshold,
      now,
    });
  }

  if (type === "tab-activated") {
    if (!isCapturing(current)) {
      return { state: current, response: { recorded: false, active: false, status: current.status } };
    }
    const context = current.tabContexts?.[String(action.tabId)] || {
      surface: "browser",
      pageKey: "outside-approved-study-pages",
    };
    const next = cloneState(current);
    const event = sanitizeStudyEvent({
      type: "tab-activated",
      state: context.surface === "browser" ? "outside-approved-study-pages" : "approved-study-page",
      timestamp: validIsoDate(action.timestamp, now),
    }, {
      ...normalizedContext(context),
      sequence: next.nextSequence,
      startedAt: next.startedAt,
      now,
    });
    return appendBoundedEvent(next, event, {
      maximumEvents,
      maximumBytes,
      checkpointEventThreshold,
      checkpointByteThreshold,
      now,
    });
  }

  if (type === "browser-focus-change") {
    if (!isCapturing(current)) {
      return { state: current, response: { recorded: false, active: false, status: current.status } };
    }
    const next = cloneState(current);
    const event = sanitizeStudyEvent({
      type: "browser-focus-change",
      state: action.focused ? "focused" : "unfocused",
      timestamp: validIsoDate(action.timestamp, now),
    }, {
      surface: "browser",
      pageKey: "chrome-window",
      sequence: next.nextSequence,
      startedAt: next.startedAt,
      now,
    });
    return appendBoundedEvent(next, event, {
      maximumEvents,
      maximumBytes,
      checkpointEventThreshold,
      checkpointByteThreshold,
      now,
    });
  }

  if (type === "prepare-checkpoint") {
    if (current.sessionId !== safeToken(action.sessionId, MAX_TOKEN_LENGTH)) {
      return { state: current, response: { prepared: false, error: "session-mismatch", status: current.status } };
    }
    if (current.checkpointToken) {
      return { state: current, response: checkpointSnapshot(current) };
    }
    if (current.exportToken) {
      return { state: current, response: { prepared: false, error: "export-in-progress", status: current.status } };
    }
    if (!isCapturing(current) && current.status !== "limit-reached") {
      return { state: current, response: { prepared: false, error: "session-not-collecting", status: current.status } };
    }
    const next = cloneState(current);
    next.statusBeforeCheckpoint = next.status;
    next.status = "checkpoint-prepared";
    next.checkpointToken = safeToken(createCheckpointToken(), MAX_TOKEN_LENGTH) || defaultCheckpointToken();
    next.checkpointedAt = monotonicIsoDate(action.checkpointedAt, next.startedAt, now);
    next.checkpointThroughSequence = eventBoundarySequence(next.events);
    if (serializedBytes(next) > maximumBytes) {
      return { state: current, response: { prepared: false, error: "buffer-quota", status: current.status } };
    }
    return { state: next, response: checkpointSnapshot(next) };
  }

  if (type === "abort-checkpoint") {
    if (!checkpointIdentityMatches(current, action)) {
      return { state: current, response: { aborted: false, error: "checkpoint-mismatch", status: current.status } };
    }
    const next = cloneState(current);
    next.status = next.stopRequested
      ? "stop-requested"
      : (next.limitReached ? "limit-reached" : "collecting");
    next.statusBeforeCheckpoint = "";
    next.lastAbortedCheckpointSessionId = current.sessionId;
    next.lastAbortedCheckpointToken = current.checkpointToken;
    next.checkpointToken = "";
    next.checkpointedAt = "";
    next.checkpointThroughSequence = 0;
    return { state: next, response: { aborted: true, active: isCapturing(next), status: next.status } };
  }

  if (type === "commit-checkpoint") {
    if (!checkpointIdentityMatches(current, action)) {
      return { state: current, response: { committed: false, error: "checkpoint-mismatch", status: current.status } };
    }
    const next = cloneState(current);
    const wasLimitReached = next.limitReached;
    next.events = eventsAfterBoundary(next.events, next.checkpointThroughSequence);
    next.statusBeforeCheckpoint = "";
    next.lastCommittedCheckpointSessionId = current.sessionId;
    next.lastCommittedCheckpointToken = current.checkpointToken;
    next.checkpointToken = "";
    next.checkpointedAt = "";
    next.checkpointThroughSequence = 0;
    next.limitReached = isAtBufferLimit(next, { maximumEvents, maximumBytes });
    next.status = next.stopRequested
      ? "stop-requested"
      : (next.limitReached ? "limit-reached" : "collecting");
    next.checkpointNeeded = false;
    if (!next.stopRequested) {
      next.checkpointNeeded = checkpointThresholdReached(next, {
        checkpointEventThreshold,
        checkpointByteThreshold,
      });
    }
    return {
      state: next,
      response: {
        committed: true,
        active: isCapturing(next),
        status: next.status,
        remainingEventCount: next.events.length,
        ...(wasLimitReached && !next.limitReached && !next.stopRequested ? { resumedFromLimit: true } : {}),
        ...(next.checkpointNeeded ? { checkpointNeeded: true } : {}),
      },
    };
  }

  if (type === "prepare-export") {
    if (current.sessionId !== safeToken(action.sessionId, MAX_TOKEN_LENGTH)) {
      return { state: current, response: { prepared: false, error: "session-mismatch", status: current.status } };
    }
    if (current.exportToken) {
      return { state: current, response: exportSnapshot(current) };
    }
    if (current.checkpointToken) {
      return { state: current, response: { prepared: false, error: "checkpoint-in-progress", status: current.status } };
    }
    if (!isCapturing(current) && current.status !== "limit-reached" && !current.stopRequested) {
      return { state: current, response: { prepared: false, error: "session-not-collecting", status: current.status } };
    }
    const next = cloneState(current);
    next.statusBeforePrepare = next.status;
    next.status = "prepared";
    next.exportToken = safeToken(createExportToken(), MAX_TOKEN_LENGTH) || defaultExportToken();
    next.endedAt = next.stopRequested
      ? next.stoppedAt
      : monotonicIsoDate(action.endedAt, next.startedAt, now);
    next.exportThroughSequence = next.stopRequested
      ? next.stopThroughSequence
      : eventBoundarySequence(next.events);
    if (serializedBytes(next) > maximumBytes) {
      return { state: current, response: { prepared: false, error: "buffer-quota", status: current.status } };
    }
    return { state: next, response: exportSnapshot(next) };
  }

  if (type === "abort-export") {
    if (!exportIdentityMatches(current, action)) {
      return { state: current, response: { aborted: false, error: "export-mismatch", status: current.status } };
    }
    const next = cloneState(current);
    next.status = next.stopRequested
      ? "stop-requested"
      : (next.limitReached ? "limit-reached" : "collecting");
    next.statusBeforePrepare = "";
    next.lastAbortedExportSessionId = current.sessionId;
    next.lastAbortedExportToken = current.exportToken;
    next.exportToken = "";
    next.exportThroughSequence = 0;
    next.endedAt = "";
    return { state: next, response: { aborted: true, active: isCapturing(next), status: next.status } };
  }

  if (type === "commit-export") {
    if (current.sessionId !== safeToken(action.sessionId, MAX_TOKEN_LENGTH)) {
      return { state: current, response: { committed: false, error: "session-mismatch", status: current.status } };
    }
    if (!exportIdentityMatches(current, action)) {
      return { state: current, response: { committed: false, error: "export-mismatch", status: current.status } };
    }
    const tombstone = {
      schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
      studyConfigId: current.studyConfigId,
      sessionId: current.sessionId,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
      status: "saved",
      nextSequence: 1,
      events: [],
      tabContexts: {},
      exportToken: "",
      exportThroughSequence: 0,
      limitReached: false,
      committedSessionId: current.sessionId,
      committedExportToken: current.exportToken,
    };
    return { state: tombstone, response: { committed: true, status: "saved" } };
  }

  return { state: current, response: { error: "unsupported-action", status: current.status } };
}

export function sanitizeStudyEvent(value, {
  surface,
  pageKey,
  sequence,
  startedAt,
  now = () => new Date(),
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = safeToken(value.type, 80);
  if (!EVENT_TYPES.has(type)) return null;
  const timestamp = validIsoDate(value.timestamp, now);
  const timestampMs = new Date(timestamp).getTime();
  const startedMs = new Date(startedAt).getTime();
  const event = removeEmpty({
    sourceSequence: positiveInteger(sequence) || 1,
    timestamp,
    elapsedMs: Math.max(0, timestampMs - (Number.isFinite(startedMs) ? startedMs : timestampMs)),
    surface: SURFACES.has(surface) ? surface : "browser",
    pageKey: safeToken(pageKey, MAX_TOKEN_LENGTH),
    type,
    state: safeToken(value.state, 80),
  });
  const target = sanitizeTarget(value.target);
  const pointer = sanitizePointer(value.pointer);
  const scroll = sanitizeScroll(value.scroll);
  if (Object.keys(target).length) event.target = target;
  if (Object.keys(pointer).length) event.pointer = pointer;
  if (Object.keys(scroll).length) event.scroll = scroll;
  return event;
}

function appendBoundedEvent(state, event, {
  maximumEvents,
  maximumBytes,
  checkpointEventThreshold,
  checkpointByteThreshold,
  now,
}) {
  const next = cloneState(state);
  if (next.events.length >= maximumEvents) {
    return reachLimit(next, { maximumEvents, maximumBytes, now });
  }
  next.events.push(event);
  next.nextSequence += 1;
  const reservedBytes = Math.min(STATE_RESERVE_BYTES, Math.max(32, Math.floor(maximumBytes * 0.1)));
  if (serializedBytes(next) > Math.max(0, maximumBytes - reservedBytes)) {
    next.events.pop();
    next.nextSequence -= 1;
    return reachLimit(next, { maximumEvents, maximumBytes, now });
  }
  const crossedCheckpointThreshold = !next.checkpointNeeded && (
    next.events.length >= positiveThreshold(checkpointEventThreshold)
    || serializedBytes(next) >= positiveThreshold(checkpointByteThreshold)
  );
  if (crossedCheckpointThreshold) next.checkpointNeeded = true;
  return {
    state: next,
    response: {
      recorded: true,
      active: isCapturing(next),
      status: next.status,
      ...(crossedCheckpointThreshold ? { checkpointNeeded: true } : {}),
    },
  };
}

function reachLimit(state, { maximumEvents, maximumBytes, now }) {
  const next = cloneState(state);
  const wasLimitReached = next.limitReached;
  next.limitReached = true;
  next.status = "limit-reached";
  if (!wasLimitReached) {
    const event = sanitizeStudyEvent({
      type: "buffer-limit-reached",
      state: "capture-paused",
      timestamp: validIsoDate(undefined, now),
    }, {
      surface: "browser",
      pageKey: "extension-buffer",
      sequence: next.nextSequence,
      startedAt: next.startedAt,
      now,
    });
    if (event
      && next.events.length < maximumEvents
      && serializedBytes({ ...next, events: [...next.events, event] }) <= maximumBytes) {
      next.events.push(event);
      next.nextSequence += 1;
    }
  }
  while (serializedBytes(next) > maximumBytes && Object.keys(next.tabContexts).length) {
    delete next.tabContexts[Object.keys(next.tabContexts)[0]];
  }
  return {
    state: next,
    response: { recorded: false, active: false, limitReached: true, status: next.status },
  };
}

function sanitizeTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return removeEmpty({
    kind: safeToken(value.kind, 80),
    semanticKey: safeToken(value.semanticKey, MAX_TOKEN_LENGTH),
    tag: safeToken(value.tag, 40),
    role: safeToken(value.role, 80),
    label: safeLabel(value.label, MAX_LABEL_LENGTH),
  });
}

function sanitizePointer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return removeEmpty({
    xBucket: boundedInteger(value.xBucket, 0, 19),
    yBucket: boundedInteger(value.yBucket, 0, 19),
    button: boundedInteger(value.button, 0, 5),
    inputMethod: safeToken(value.inputMethod, 40),
  });
}

function sanitizeScroll(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const depth = boundedInteger(value.depthBucket, 0, 100);
  return depth == null ? {} : { depthBucket: Math.round(depth / 10) * 10 };
}

function exportSnapshot(state) {
  const events = eventsThroughBoundary(state.events, state.exportThroughSequence);
  return {
    prepared: true,
    schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
    studyConfigId: state.studyConfigId,
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    exportToken: state.exportToken,
    throughSequence: state.exportThroughSequence,
    eventCount: events.length,
    events,
  };
}

function checkpointSnapshot(state) {
  const events = eventsThroughBoundary(state.events, state.checkpointThroughSequence);
  return {
    prepared: true,
    schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
    studyConfigId: state.studyConfigId,
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    checkpointedAt: state.checkpointedAt,
    checkpointToken: state.checkpointToken,
    throughSequence: state.checkpointThroughSequence,
    eventCount: events.length,
    events,
  };
}

function stopIntentSnapshot(state, { alreadyStopped = false } = {}) {
  return {
    stopped: true,
    ...(alreadyStopped ? { alreadyStopped: true } : {}),
    sessionId: state.sessionId,
    status: state.status,
    stoppedAt: state.stoppedAt,
    stopThroughSequence: state.stopThroughSequence,
    checkpointPending: Boolean(state.checkpointToken),
    exportPending: Boolean(state.exportToken),
  };
}

function exportIdentityMatches(state, action) {
  return Boolean(state?.exportToken)
    && state.sessionId === safeToken(action.sessionId, MAX_TOKEN_LENGTH)
    && state.exportToken === safeToken(action.exportToken, MAX_TOKEN_LENGTH);
}

function committedIdentityMatches(state, action) {
  return state?.status === "saved"
    && state.committedSessionId === safeToken(action.sessionId, MAX_TOKEN_LENGTH)
    && state.committedExportToken === safeToken(action.exportToken, MAX_TOKEN_LENGTH);
}

function committedSessionMatches(state, action) {
  return state?.status === "saved"
    && state.committedSessionId === safeToken(action.sessionId, MAX_TOKEN_LENGTH);
}

function checkpointIdentityMatches(state, action) {
  return Boolean(state?.checkpointToken)
    && state.sessionId === safeToken(action.sessionId, MAX_TOKEN_LENGTH)
    && state.checkpointToken === safeToken(action.checkpointToken, MAX_TOKEN_LENGTH);
}

function committedCheckpointIdentityMatches(state, action) {
  return state?.lastCommittedCheckpointSessionId === safeToken(action.sessionId, MAX_TOKEN_LENGTH)
    && state.lastCommittedCheckpointToken === safeToken(action.checkpointToken, MAX_TOKEN_LENGTH);
}

function abortedCheckpointIdentityMatches(state, action) {
  return state?.lastAbortedCheckpointSessionId === safeToken(action.sessionId, MAX_TOKEN_LENGTH)
    && state.lastAbortedCheckpointToken === safeToken(action.checkpointToken, MAX_TOKEN_LENGTH);
}

function abortedExportIdentityMatches(state, action) {
  return state?.lastAbortedExportSessionId === safeToken(action.sessionId, MAX_TOKEN_LENGTH)
    && state.lastAbortedExportToken === safeToken(action.exportToken, MAX_TOKEN_LENGTH);
}

function publicStatus(state) {
  if (!state) return { active: false, status: "off" };
  return {
    active: isCapturing(state),
    status: state.status === "saved" ? "off" : state.status,
    studyConfigId: state.studyConfigId,
    checkpointNeeded: Boolean(state.checkpointNeeded),
  };
}

function registerTabContext(contexts, tabId, value) {
  const result = { ...(contexts || {}) };
  if (!Number.isInteger(tabId)) return result;
  const key = String(tabId);
  if (!(key in result) && Object.keys(result).length >= MAX_TRACKED_TABS) {
    delete result[Object.keys(result)[0]];
  }
  result[key] = normalizedContext(value);
  return result;
}

function normalizedContext(value) {
  const surface = SURFACES.has(value?.surface) ? value.surface : "browser";
  return {
    surface,
    pageKey: safeToken(value?.pageKey, MAX_TOKEN_LENGTH) || (surface === "browser" ? "outside-approved-study-pages" : "approved-study-page"),
  };
}

function validState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== STUDY_SESSION_SCHEMA_VERSION || !Array.isArray(value.events)) return null;
  const sessionId = safeToken(value.sessionId, MAX_TOKEN_LENGTH);
  const startedAt = storedIsoDate(value.startedAt);
  const allowedStatuses = new Set([
    "collecting",
    "limit-reached",
    "checkpoint-prepared",
    "prepared",
    "stop-requested",
    "saved",
  ]);
  const status = allowedStatuses.has(value.status) ? value.status : "collecting";
  if (!sessionId || !startedAt) return null;
  if (status === "saved") {
    const committedSessionId = safeToken(value.committedSessionId, MAX_TOKEN_LENGTH);
    const committedExportToken = safeToken(value.committedExportToken, MAX_TOKEN_LENGTH);
    if (!committedSessionId || !committedExportToken) return null;
    return {
      schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
      studyConfigId: safeToken(value.studyConfigId, MAX_TOKEN_LENGTH),
      sessionId,
      startedAt,
      endedAt: storedIsoDate(value.endedAt) || startedAt,
      status,
      nextSequence: 1,
      events: [],
      tabContexts: {},
      exportToken: "",
      exportThroughSequence: 0,
      limitReached: false,
      committedSessionId,
      committedExportToken,
    };
  }
  const storedNextSequence = positiveInteger(value.nextSequence);
  let lastEventSequence = 0;
  const events = value.events.slice(0, MAX_STUDY_EVENTS).map((entry, index) => {
    const timestamp = storedIsoDate(entry?.timestamp);
    if (!timestamp) return null;
    const candidateSequence = positiveInteger(entry?.sourceSequence);
    const sequence = storedNextSequence
      && candidateSequence
      && candidateSequence > lastEventSequence
      && candidateSequence < storedNextSequence
      ? candidateSequence
      : lastEventSequence + 1;
    const event = sanitizeStudyEvent({ ...entry, timestamp }, {
      surface: entry?.surface,
      pageKey: entry?.pageKey,
      sequence: storedNextSequence ? sequence : index + 1,
      startedAt,
      now: () => new Date(timestamp),
    });
    if (event) lastEventSequence = event.sourceSequence;
    return event;
  }).filter(Boolean);
  const tabContexts = {};
  for (const [tabId, context] of Object.entries(value.tabContexts || {}).slice(0, MAX_TRACKED_TABS)) {
    if (!Number.isInteger(Number(tabId))) continue;
    tabContexts[tabId] = normalizedContext(context);
  }
  const storedLimitReached = status === "limit-reached" || Boolean(value.limitReached);
  const stopRequested = status === "stop-requested" || Boolean(value.stopRequested);
  let exportToken = ["prepared", "limit-reached"].includes(status)
    ? safeToken(value.exportToken, MAX_TOKEN_LENGTH)
    : "";
  let checkpointToken = ["checkpoint-prepared", "limit-reached"].includes(status)
    ? safeToken(value.checkpointToken, MAX_TOKEN_LENGTH)
    : "";
  if (exportToken && checkpointToken) {
    if (status === "prepared") checkpointToken = "";
    else exportToken = "";
  }
  let normalizedStatus = status;
  if ((status === "prepared" && !exportToken) || (status === "checkpoint-prepared" && !checkpointToken)) {
    normalizedStatus = storedLimitReached ? "limit-reached" : "collecting";
  }
  if (normalizedStatus === "stop-requested" && !stopRequested) normalizedStatus = "collecting";
  if (stopRequested && normalizedStatus === "collecting") normalizedStatus = "stop-requested";
  const exportThroughSequence = exportToken
    ? (nonnegativeInteger(value.exportThroughSequence) ?? eventBoundarySequence(events))
    : 0;
  const checkpointThroughSequence = checkpointToken
    ? (nonnegativeInteger(value.checkpointThroughSequence) ?? eventBoundarySequence(events))
    : 0;
  const lastCommittedCheckpointSessionId = safeToken(value.lastCommittedCheckpointSessionId, MAX_TOKEN_LENGTH);
  const lastCommittedCheckpointToken = safeToken(value.lastCommittedCheckpointToken, MAX_TOKEN_LENGTH);
  const lastAbortedCheckpointSessionId = safeToken(value.lastAbortedCheckpointSessionId, MAX_TOKEN_LENGTH);
  const lastAbortedCheckpointToken = safeToken(value.lastAbortedCheckpointToken, MAX_TOKEN_LENGTH);
  const lastAbortedExportSessionId = safeToken(value.lastAbortedExportSessionId, MAX_TOKEN_LENGTH);
  const lastAbortedExportToken = safeToken(value.lastAbortedExportToken, MAX_TOKEN_LENGTH);
  return {
    schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
    studyConfigId: safeToken(value.studyConfigId, MAX_TOKEN_LENGTH),
    sessionId,
    startedAt,
    status: normalizedStatus,
    nextSequence: Math.max(storedNextSequence || 1, lastEventSequence + 1),
    events,
    tabContexts,
    exportToken,
    exportThroughSequence,
    checkpointToken,
    checkpointedAt: storedIsoDate(value.checkpointedAt) || "",
    checkpointThroughSequence,
    statusBeforeCheckpoint: status === "checkpoint-prepared" && value.statusBeforeCheckpoint === "limit-reached"
      ? "limit-reached"
      : "collecting",
    checkpointNeeded: Boolean(value.checkpointNeeded),
    ...(lastCommittedCheckpointSessionId && lastCommittedCheckpointToken ? {
      lastCommittedCheckpointSessionId,
      lastCommittedCheckpointToken,
    } : {}),
    ...(lastAbortedCheckpointSessionId && lastAbortedCheckpointToken ? {
      lastAbortedCheckpointSessionId,
      lastAbortedCheckpointToken,
    } : {}),
    ...(lastAbortedExportSessionId && lastAbortedExportToken ? {
      lastAbortedExportSessionId,
      lastAbortedExportToken,
    } : {}),
    endedAt: exportToken ? (storedIsoDate(value.endedAt) || startedAt) : "",
    statusBeforePrepare: status === "prepared" && value.statusBeforePrepare === "limit-reached" ? "limit-reached" : "collecting",
    limitReached: storedLimitReached,
    stopRequested,
    stoppedAt: stopRequested ? (storedIsoDate(value.stoppedAt) || startedAt) : "",
    stopThroughSequence: stopRequested
      ? (nonnegativeInteger(value.stopThroughSequence) ?? eventBoundarySequence(events))
      : 0,
  };
}

function eventBoundarySequence(events) {
  let boundary = 0;
  for (const event of Array.isArray(events) ? events : []) {
    boundary = Math.max(boundary, positiveInteger(event?.sourceSequence) || 0);
  }
  return boundary;
}

function eventsThroughBoundary(events, boundaryValue) {
  const boundary = nonnegativeInteger(boundaryValue) ?? 0;
  return (Array.isArray(events) ? events : [])
    .filter((event) => (positiveInteger(event?.sourceSequence) || 0) <= boundary)
    .map((event) => ({ ...event }));
}

function eventsAfterBoundary(events, boundaryValue) {
  const boundary = nonnegativeInteger(boundaryValue) ?? 0;
  return (Array.isArray(events) ? events : [])
    .filter((event) => (positiveInteger(event?.sourceSequence) || 0) > boundary)
    .map((event) => ({ ...event }));
}

function checkpointThresholdReached(state, {
  checkpointEventThreshold,
  checkpointByteThreshold,
}) {
  return state.events.length >= positiveThreshold(checkpointEventThreshold)
    || serializedBytes(state) >= positiveThreshold(checkpointByteThreshold);
}

function isAtBufferLimit(state, { maximumEvents, maximumBytes }) {
  if (state.events.length >= positiveThreshold(maximumEvents)) return true;
  const byteLimit = positiveThreshold(maximumBytes);
  const reservedBytes = Math.min(STATE_RESERVE_BYTES, Math.max(32, Math.floor(byteLimit * 0.1)));
  return serializedBytes(state) > Math.max(0, byteLimit - reservedBytes);
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function isCapturing(state) {
  return !state?.limitReached
    && !state?.stopRequested
    && ["collecting", "checkpoint-prepared"].includes(state?.status);
}

function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function safeLabel(value, maximumLength) {
  const result = String(value ?? "")
    .replace(/\bhttps?:\/\/\S+/gi, "[url]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .replace(/(^|[\s(])\/(?:[^/\s)]+\/){2,}[^\s)]*/g, "$1[local path]")
    .replace(/\s+/g, " ")
    .trim();
  return result.length <= maximumLength ? result : `${result.slice(0, maximumLength - 1).trimEnd()}…`;
}

function safeToken(value, maximumLength) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maximumLength);
}

function validIsoDate(value, now) {
  const fallback = typeof now === "function" ? now() : new Date();
  const date = value == null ? fallback : new Date(value);
  const result = Number.isFinite(date?.getTime?.()) ? date : fallback;
  return new Date(result).toISOString();
}

function monotonicIsoDate(value, minimumValue, now) {
  const candidate = validIsoDate(value, now);
  const minimum = new Date(minimumValue);
  return new Date(candidate).getTime() < minimum.getTime() ? minimum.toISOString() : candidate;
}

function storedIsoDate(value) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonnegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function positiveThreshold(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Number.POSITIVE_INFINITY;
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function removeEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ""));
}

function defaultExportToken() {
  return globalThis.crypto?.randomUUID?.()
    || `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCheckpointToken() {
  return globalThis.crypto?.randomUUID?.()
    || `checkpoint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
