/**
 * Pure analysis helpers for StoryVR interaction-log exports.
 *
 * The authoring logger records click context during the document capture phase.
 * Consequently, a click on a workflow step still carries the source step in
 * `event.context.workspace.componentId`. A destination in
 * `event.target.data.selectComponent` becomes a corrected boundary only when
 * the next event carrying workflow context confirms that destination.
 */

const LOG_SCHEMA_VERSION = "storyvr-interaction-log/v1";
const NORMALIZATION_SCHEMA_VERSION = "storyvr-workflow-lens-normalized/v1";
const ANALYSIS_SCHEMA_VERSION = "storyvr-workflow-lens-analysis/v1";
const CODEX_EVIDENCE_SCHEMA_VERSION = "storyvr-workflow-lens-codex-evidence/v1";
const UNKNOWN_STEP_ID = "unknown";
const DEFAULT_ACTIVITY_BIN_MS = 30_000;
const DEFAULT_PAUSE_THRESHOLD_MS = 120_000;
const DEFAULT_RAGE_WINDOW_MS = 2_000;
const DEFAULT_RAGE_CLICK_COUNT = 3;
const MAX_CODEX_EVIDENCE_SESSIONS = 24;
const MAX_CODEX_TOTAL_EVIDENCE_EVENTS = 2_048;
const MAX_CODEX_EVIDENCE_EVENTS = 240;

export const STEP_DEFINITIONS = Object.freeze([
  stepDefinition("source-graph", "Story order", "#4f73c9", 0),
  stepDefinition("spatial-relations", "Place objects", "#2f9b8f", 1),
  stepDefinition("environment-enhancement", "Set the scene", "#47a65f", 2),
  stepDefinition("attention-guidance", "Guide attention", "#b19532", 3),
  stepDefinition("dynamic-geometry", "Object movement", "#d17a3f", 4),
  stepDefinition("inter-beat-dynamics", "Scene changes", "#b75b68", 5),
  stepDefinition("interaction-control", "Reader actions", "#8b63bf", 6),
  stepDefinition("transition-pacing", "Review story", "#596274", 7),
]);

const UNKNOWN_STEP = Object.freeze({
  id: UNKNOWN_STEP_ID,
  label: "Unknown step",
  color: "#8b929e",
  order: -1,
});
const STEP_BY_ID = new Map(STEP_DEFINITIONS.map((step) => [step.id, step]));
const STEP_ALIASES = new Map([
  ["asset-topology", "spatial-relations"],
  ["text-comfort", "spatial-relations"],
]);

/**
 * Parse and normalize one StoryVR v1 interaction log without mutating it.
 * Invalid individual values are retained as safe fallbacks and surfaced in
 * `warnings`; a non-v1 root is rejected because its semantics are unknown.
 */
export function normalizeInteractionLog(input, { fileName = "" } = {}) {
  const source = parseInput(input);
  if (source.schemaVersion !== LOG_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported StoryVR interaction-log schema: ${String(source.schemaVersion || "missing")}. Expected ${LOG_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(source.events)) {
    throw new TypeError("A StoryVR interaction log must contain an events array.");
  }

  const warnings = [];
  const startedAtMs = dateMilliseconds(source.startedAt);
  const endedAtMs = dateMilliseconds(source.endedAt);
  if (startedAtMs == null) {
    warnings.push(dataWarning("missing-start-time", "The session start time is missing or invalid."));
  }
  if (endedAtMs == null) {
    warnings.push(dataWarning("missing-end-time", "The session end time is missing or invalid."));
  }

  const normalizedEvents = source.events.map((entry, originalIndex) => normalizeEvent(entry, {
    originalIndex,
    startedAtMs,
    warnings,
  }));
  const arraySequence = normalizedEvents.map((event) => event.sequence);
  const uniqueSequences = new Set(arraySequence);
  if (uniqueSequences.size !== arraySequence.length) {
    warnings.push(dataWarning("duplicate-sequence", "Two or more events share the same sequence number."));
  }
  if (arraySequence.some((sequence, index) => index > 0 && sequence <= arraySequence[index - 1])) {
    warnings.push(dataWarning("nonmonotonic-sequence", "Event sequence numbers are not strictly increasing in the exported order."));
  }
  if (normalizedEvents.some((event, index) => index > 0 && event.elapsedMs < normalizedEvents[index - 1].elapsedMs)) {
    warnings.push(dataWarning("nonmonotonic-time", "Event elapsed times move backward in the exported order."));
  }

  const events = normalizedEvents
    .slice()
    .sort((left, right) => left.elapsedMs - right.elapsedMs
      || left.sequence - right.sequence
      || left.originalIndex - right.originalIndex);
  const lastElapsedMs = events.at(-1)?.elapsedMs || 0;
  const recordedDurationMs = nonnegativeFiniteNumber(source.durationMs);
  const timestampDurationMs = startedAtMs != null && endedAtMs != null
    ? Math.max(0, endedAtMs - startedAtMs)
    : null;
  const durationMs = Math.max(recordedDurationMs ?? timestampDurationMs ?? lastElapsedMs, lastElapsedMs);
  if (recordedDurationMs != null && recordedDurationMs < lastElapsedMs) {
    warnings.push(dataWarning(
      "duration-shorter-than-events",
      "The recorded duration ends before the last event; the timeline was extended to include every event.",
    ));
  }

  const reportedEventCount = finiteInteger(source.eventCount);
  if (reportedEventCount != null && reportedEventCount !== source.events.length) {
    warnings.push(dataWarning(
      "event-count-mismatch",
      `The payload reports ${reportedEventCount} events but contains ${source.events.length}.`,
    ));
  }
  if (!String(source.sessionId || "").trim()) {
    warnings.push(dataWarning("missing-session-id", "The session identifier is missing."));
  }

  const typeSet = new Set(events.map((event) => event.type));
  if (!typeSet.has("collection-started")) {
    warnings.push(dataWarning("missing-start-marker", "The collection-started lifecycle marker is missing."));
  }
  if (!typeSet.has("collection-stopped")) {
    warnings.push(dataWarning("missing-stop-marker", "The collection-stopped lifecycle marker is missing."));
  }
  if (source.events.length >= 25_000) {
    warnings.push(dataWarning(
      "possible-event-limit",
      "The log reached the logger's default 25,000-event cache limit and may be truncated.",
      "concern",
    ));
  }

  const contextlessCount = events.filter((event) => !event.stepId).length;
  if (contextlessCount) {
    warnings.push(dataWarning(
      "missing-step-context",
      `${contextlessCount} event${contextlessCount === 1 ? " has" : "s have"} no workflow-step context.`,
    ));
  }
  const conflictingInputCount = events.filter((event) => (
    event.pointer?.inputMethod === "keyboard" && Boolean(event.pointer?.pointerType)
  )).length;
  if (conflictingInputCount) {
    warnings.push(dataWarning(
      "ambiguous-input-method",
      `${conflictingInputCount} event${conflictingInputCount === 1 ? " has" : "s have"} both a keyboard inputMethod and a pointerType; pointerType is the safer modality signal.`,
      "watch",
    ));
  }

  return Object.freeze({
    normalizationSchemaVersion: NORMALIZATION_SCHEMA_VERSION,
    schemaVersion: LOG_SCHEMA_VERSION,
    fileName: String(fileName || ""),
    sessionId: String(source.sessionId || ""),
    startedAt: normalizedIsoDate(source.startedAt),
    endedAt: normalizedIsoDate(source.endedAt),
    durationMs,
    recordedDurationMs,
    reportedEventCount,
    eventCount: events.length,
    sessionContext: serializableObject(source.sessionContext),
    viewport: normalizeViewport(source.viewport),
    events: Object.freeze(events),
    warnings: Object.freeze(warnings),
  });
}

/**
 * Build timeline, behavior statistics, and cautious deterministic findings for
 * one normalized or raw v1 interaction log.
 */
export function analyzeInteractionLog(input, options = {}) {
  const normalized = input?.normalizationSchemaVersion === NORMALIZATION_SCHEMA_VERSION
    ? input
    : normalizeInteractionLog(input, { fileName: options.fileName });
  const activityBinMs = positiveFiniteNumber(options.activityBinMs) || DEFAULT_ACTIVITY_BIN_MS;
  const pauseThresholdMs = positiveFiniteNumber(options.pauseThresholdMs) || DEFAULT_PAUSE_THRESHOLD_MS;
  const rageWindowMs = positiveFiniteNumber(options.rageWindowMs) || DEFAULT_RAGE_WINDOW_MS;
  const rageClickCount = Math.max(2, finiteInteger(options.rageClickCount) || DEFAULT_RAGE_CLICK_COUNT);

  const { corrections, unconfirmedIntents } = navigationCorrections(normalized.events);
  const { boundaries, segments, events } = buildStepTimeline(normalized, corrections);
  const transitions = buildTransitions(boundaries);
  const stepDwell = buildStepDwell(segments, events, normalized.durationMs);
  const targetStats = buildTargetStats(events);
  const semanticStats = frequencyStats(
    events.filter((event) => event.type === "click" && event.semanticKind),
    (event) => event.semanticKind,
    (event) => event.semanticKind,
  );
  const actionStats = frequencyStats(
    events.filter((event) => event.type === "click" && event.action),
    (event) => event.action,
    (event) => event.action,
  );
  const modeStats = buildModeStats(events);
  const activityBins = buildActivityBins(events, segments, normalized.durationMs, activityBinMs);
  const journey = buildJourney(segments, transitions);

  const warnings = normalized.warnings.slice();
  if (unconfirmedIntents.length) {
    warnings.push(dataWarning(
      "unconfirmed-step-navigation",
      `${unconfirmedIntents.length} workflow-step selection${unconfirmedIntents.length === 1 ? " was" : "s were"} not confirmed by the next recorded context.`,
      "watch",
      unconfirmedIntents.map((intent) => intent.sequence),
    ));
  }
  const unknownStepIds = [...new Set(events.map((event) => event.rawStepId).filter((id) => id && !stepForId(id)))];
  if (unknownStepIds.length) {
    warnings.push(dataWarning(
      "unknown-step-id",
      `Unknown workflow step${unknownStepIds.length === 1 ? "" : "s"}: ${unknownStepIds.join(", ")}.`,
    ));
  }

  const moments = buildDeterministicMoments({
    normalized,
    events,
    transitions,
    corrections,
    unconfirmedIntents,
    journey,
    rageWindowMs,
    rageClickCount,
    pauseThresholdMs,
  });
  attachMomentIdsToBins(activityBins, moments);

  return Object.freeze({
    analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
    sourceSchemaVersion: LOG_SCHEMA_VERSION,
    source: Object.freeze({
      fileName: normalized.fileName,
      sessionId: normalized.sessionId,
      startedAt: normalized.startedAt,
      endedAt: normalized.endedAt,
      eventCount: normalized.eventCount,
    }),
    session: Object.freeze({
      durationMs: normalized.durationMs,
      story: serializableObject(normalized.sessionContext?.story),
      initialStepId: boundaries[0]?.stepId || UNKNOWN_STEP_ID,
      viewport: normalized.viewport,
    }),
    events: Object.freeze(events),
    timeline: Object.freeze({
      durationMs: normalized.durationMs,
      boundaries: Object.freeze(boundaries),
      segments: Object.freeze(segments),
      activityBinMs,
      activityBins: Object.freeze(activityBins),
    }),
    stepDwell: Object.freeze(stepDwell),
    transitions: Object.freeze(transitions),
    navigationCorrections: Object.freeze(corrections),
    unconfirmedNavigationIntents: Object.freeze(unconfirmedIntents),
    stats: Object.freeze({
      clickCount: events.filter((event) => event.type === "click").length,
      lifecycleEventCount: events.filter((event) => event.type !== "click").length,
      targetKinds: Object.freeze(targetStats.kinds),
      topTargets: Object.freeze(targetStats.targets),
      semanticKinds: Object.freeze(semanticStats),
      actions: Object.freeze(actionStats),
      modes: Object.freeze(modeStats),
    }),
    journey: Object.freeze(journey),
    moments: Object.freeze(moments),
    warnings: Object.freeze(warnings),
    thresholds: Object.freeze({ rageWindowMs, rageClickCount, pauseThresholdMs }),
  });
}

/**
 * Compact one or more analyses for a Codex prompt. The evidence intentionally
 * contains deterministic findings and cited event rows, not the entire raw log.
 */
export function buildCodexEvidence(analyses) {
  const list = (Array.isArray(analyses) ? analyses : [analyses])
    .filter(Boolean)
    .map((entry) => entry?.analysisSchemaVersion === ANALYSIS_SCHEMA_VERSION
      ? entry
      : analyzeInteractionLog(entry));
  const bounded = list.slice(0, MAX_CODEX_EVIDENCE_SESSIONS);
  const perSessionEventLimit = Math.min(
    MAX_CODEX_EVIDENCE_EVENTS,
    Math.max(1, Math.floor(MAX_CODEX_TOTAL_EVIDENCE_EVENTS / Math.max(1, bounded.length))),
  );
  const usedSessionIds = new Set();

  return Object.freeze({
    schemaVersion: CODEX_EVIDENCE_SCHEMA_VERSION,
    sourceSchemaVersion: LOG_SCHEMA_VERSION,
    analysisGuardrails: Object.freeze([
      "Treat each key moment as a possible explanation, not proof of what the user meant or whether the task worked.",
      "For every point, cite the session id and click numbers that support it.",
      "A long pause can mean reading, thinking, time away, or a problem. The log cannot tell which one.",
      "Do not guess typed text, drag paths, scrolling, server results, or changes the log did not record.",
    ]),
    sessions: Object.freeze(bounded.map((analysis, index) => compactAnalysisForCodex(
      analysis,
      uniqueEvidenceSessionId(analysis.source.sessionId, index, usedSessionIds),
      perSessionEventLimit,
    ))),
    omittedSessionCount: Math.max(0, list.length - bounded.length),
  });
}

function stepDefinition(id, label, color, order) {
  return Object.freeze({ id, label, color, order });
}

function parseInput(input) {
  if (typeof input === "string") {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      throw new SyntaxError(`The interaction log is not valid JSON: ${error.message}`);
    }
    return requireObject(parsed);
  }
  return requireObject(input);
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A StoryVR interaction log must be a JSON object.");
  }
  return value;
}

function normalizeEvent(entry, { originalIndex, startedAtMs, warnings }) {
  const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  if (source !== entry) {
    warnings.push(dataWarning("invalid-event", `Event ${originalIndex + 1} is not an object and was normalized.`));
  }
  const sequence = finiteInteger(source.sequence) || originalIndex + 1;
  const timestampMs = dateMilliseconds(source.timestamp);
  let elapsedMs = nonnegativeFiniteNumber(source.elapsedMs);
  if (elapsedMs == null && timestampMs != null && startedAtMs != null) {
    elapsedMs = Math.max(0, timestampMs - startedAtMs);
  }
  if (elapsedMs == null) {
    elapsedMs = originalIndex ? originalIndex : 0;
    warnings.push(dataWarning(
      "missing-event-time",
      `Event sequence ${sequence} has no usable elapsed time; exported order was used as a fallback.`,
      "watch",
      [sequence],
    ));
  }
  const context = serializableObject(source.context);
  const target = serializableObject(source.target);
  const rawStepId = cleanString(context?.workspace?.componentId);
  const stepId = canonicalStepId(rawStepId);
  const stepIntent = canonicalStepId(target?.data?.selectComponent);
  const semantic = serializableObject(target.semantic);
  const type = cleanString(source.type) || "unknown";
  const semanticKind = cleanString(semantic.kind);
  const action = eventAction(target, semantic);
  const label = eventLabel(type, target, semantic);

  return Object.freeze({
    sequence,
    originalIndex,
    timestamp: normalizedIsoDate(source.timestamp),
    elapsedMs,
    type,
    context,
    target,
    pointer: serializableObject(source.pointer),
    modifiers: serializableObject(source.modifiers),
    rawStepId,
    stepId,
    effectiveStepId: stepId,
    stepIntent,
    mode: cleanString(context?.workspace?.mode) || "unknown",
    editorScene: normalizeEditorScene(context?.workspace?.editorScene),
    semanticKind,
    action,
    label,
    targetKey: interactionTargetKey(target, semantic, label),
  });
}

function canonicalStepId(value) {
  const id = cleanString(value);
  if (!id) return "";
  return STEP_ALIASES.get(id) || id;
}

function stepForId(value) {
  return STEP_BY_ID.get(canonicalStepId(value)) || null;
}

function displayStep(value) {
  return stepForId(value) || UNKNOWN_STEP;
}

function normalizeEditorScene(value) {
  const source = serializableObject(value);
  const result = {};
  for (const key of ["kind", "type", "mode", "beatId", "variantGroupId", "variantOptionId", "sceneKey", "targetId"]) {
    const cleaned = cleanString(source[key]);
    if (cleaned) result[key] = cleaned;
  }
  return result;
}

function eventAction(target, semantic) {
  const data = target?.data || {};
  return cleanString(
    semantic?.action
    || data.action
    || data.historyAction
    || data.environmentAction
    || data.interactionAction
    || data.motionTargetAction
    || data.textPlacementAction,
  );
}

function eventLabel(type, target, semantic) {
  return cleanString(semantic?.label)
    || cleanString(target?.label)
    || lifecycleLabel(type)
    || type;
}

function lifecycleLabel(type) {
  return ({
    "collection-started": "Collection started",
    "collection-stopped": "Collection stopped",
    "collection-save-canceled": "Save canceled",
    "collection-save-failed": "Save failed",
  })[type] || "";
}

function interactionTargetKey(target, semantic, fallbackLabel) {
  const semanticKind = cleanString(semantic?.kind);
  if (semanticKind) {
    const identity = [
      semantic.id,
      semantic.entityId,
      semantic.assetId,
      semantic.markerId,
      semantic.candidateId,
      semantic.action,
      semantic.label,
    ].map(cleanString).find(Boolean);
    return `semantic:${semanticKind}:${identity || "target"}`;
  }
  const locator = cleanString(target?.locator);
  if (locator) return `locator:${locator}`;
  const id = cleanString(target?.id);
  if (id) return `id:${id}`;
  const data = serializableObject(target?.data);
  const dataKey = Object.keys(data).sort()[0];
  if (dataKey) return `data:${dataKey}:${cleanString(data[dataKey])}`;
  return `target:${cleanString(target?.kind) || cleanString(target?.tag) || "unknown"}:${cleanString(fallbackLabel)}`;
}

function navigationCorrections(events) {
  const corrections = [];
  const unconfirmedIntents = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const destination = event.stepIntent;
    if (!destination || destination === event.stepId || !stepForId(destination)) continue;
    const nextWithContext = events.slice(index + 1).find((candidate) => candidate.stepId);
    const intent = Object.freeze({
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      fromStepId: event.stepId || UNKNOWN_STEP_ID,
      toStepId: destination,
      confirmedBySequence: nextWithContext?.sequence || null,
      nextObservedStepId: nextWithContext?.stepId || null,
    });
    if (nextWithContext?.stepId === destination) corrections.push(intent);
    else unconfirmedIntents.push(intent);
  }
  return { corrections, unconfirmedIntents };
}

function buildStepTimeline(normalized, corrections) {
  const correctionBySequence = new Map(corrections.map((entry) => [entry.sequence, entry]));
  const sessionStepId = canonicalStepId(normalized.sessionContext?.workspace?.componentId);
  const firstObservedStepId = normalized.events.find((event) => event.stepId)?.stepId;
  const initialStepId = sessionStepId || firstObservedStepId || UNKNOWN_STEP_ID;
  const boundaries = [{
    index: 0,
    elapsedMs: 0,
    stepId: initialStepId,
    ...stepDisplayFields(initialStepId),
    reason: "session-start",
    sequence: normalized.events[0]?.sequence || null,
    confirmedBySequence: null,
  }];
  let currentStepId = initialStepId;

  const addBoundary = (stepId, event, reason, confirmedBySequence = null) => {
    const canonical = canonicalStepId(stepId) || UNKNOWN_STEP_ID;
    if (canonical === currentStepId) return;
    boundaries.push({
      index: boundaries.length,
      elapsedMs: Math.min(normalized.durationMs, Math.max(0, event.elapsedMs)),
      stepId: canonical,
      ...stepDisplayFields(canonical),
      reason,
      sequence: event.sequence,
      confirmedBySequence,
    });
    currentStepId = canonical;
  };

  for (const event of normalized.events) {
    if (event.stepId && event.stepId !== currentStepId) {
      addBoundary(event.stepId, event, "observed-context");
    }
    const correction = correctionBySequence.get(event.sequence);
    if (correction) {
      addBoundary(correction.toStepId, event, "confirmed-navigation-intent", correction.confirmedBySequence);
    }
  }

  const compactBoundaries = [];
  for (const boundary of boundaries) {
    const previous = compactBoundaries.at(-1);
    if (previous && previous.elapsedMs === boundary.elapsedMs) {
      compactBoundaries[compactBoundaries.length - 1] = {
        ...boundary,
        index: compactBoundaries.length - 1,
        replacedStepId: previous.stepId,
      };
    } else {
      compactBoundaries.push({ ...boundary, index: compactBoundaries.length });
    }
  }

  const segments = compactBoundaries.map((boundary, index) => {
    const next = compactBoundaries[index + 1];
    const endMs = next?.elapsedMs ?? normalized.durationMs;
    return {
      id: `segment-${index + 1}`,
      index,
      stepId: boundary.stepId,
      label: boundary.label,
      color: boundary.color,
      order: boundary.order,
      startMs: boundary.elapsedMs,
      endMs,
      durationMs: Math.max(0, endMs - boundary.elapsedMs),
      startReason: boundary.reason,
      startSequence: boundary.sequence,
      endSequence: next?.sequence || normalized.events.at(-1)?.sequence || null,
      eventCount: 0,
      clickCount: 0,
      semanticClickCount: 0,
      modeCounts: {},
    };
  });

  const correctionSequenceSet = new Set(corrections.map((entry) => entry.sequence));
  const events = normalized.events.map((event) => {
    let segment = segmentForEvent(segments, event, correctionSequenceSet);
    const effectiveStepId = event.stepId || segment?.stepId || UNKNOWN_STEP_ID;
    if (segment) {
      segment.eventCount += 1;
      if (event.type === "click") segment.clickCount += 1;
      if (event.type === "click" && event.semanticKind) segment.semanticClickCount += 1;
      segment.modeCounts[event.mode] = (segment.modeCounts[event.mode] || 0) + 1;
    }
    return Object.freeze({ ...event, effectiveStepId, segmentId: segment?.id || null });
  });
  for (const segment of segments) {
    segment.modeCounts = Object.freeze(segment.modeCounts);
    Object.freeze(segment);
  }
  return {
    boundaries: compactBoundaries.map(Object.freeze),
    segments,
    events,
  };
}

function segmentForEvent(segments, event, correctionSequenceSet) {
  const candidates = segments.filter((segment) => event.elapsedMs >= segment.startMs && event.elapsedMs <= segment.endMs);
  if (!candidates.length) return segments.at(-1) || null;
  const matchingObserved = candidates.find((segment) => segment.stepId === event.stepId);
  if (matchingObserved) return matchingObserved;
  if (correctionSequenceSet.has(event.sequence) && candidates.length > 1) return candidates[0];
  return candidates.at(-1);
}

function buildTransitions(boundaries) {
  const result = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const previous = boundaries[index - 1];
    const current = boundaries[index];
    const fromOrder = stepForId(previous.stepId)?.order;
    const toOrder = stepForId(current.stepId)?.order;
    const delta = Number.isInteger(fromOrder) && Number.isInteger(toOrder) ? toOrder - fromOrder : null;
    result.push(Object.freeze({
      index: result.length,
      fromStepId: previous.stepId,
      fromLabel: previous.label,
      toStepId: current.stepId,
      toLabel: current.label,
      elapsedMs: current.elapsedMs,
      direction: delta == null ? "unknown" : delta > 0 ? "forward" : delta < 0 ? "backward" : "same",
      stepDelta: delta,
      source: current.reason,
      sequence: current.sequence,
      confirmedBySequence: current.confirmedBySequence,
      confirmed: current.reason === "confirmed-navigation-intent",
    }));
  }
  return result;
}

function buildStepDwell(segments, events, durationMs) {
  const byStep = new Map();
  for (const segment of segments) {
    const definition = displayStep(segment.stepId);
    const row = byStep.get(segment.stepId) || {
      stepId: segment.stepId,
      label: definition.label,
      color: definition.color,
      order: definition.order,
      durationMs: 0,
      percentage: 0,
      visitCount: 0,
      eventCount: 0,
      clickCount: 0,
      semanticClickCount: 0,
      firstEnteredMs: segment.startMs,
      lastExitedMs: segment.endMs,
    };
    row.durationMs += segment.durationMs;
    row.visitCount += 1;
    row.eventCount += segment.eventCount;
    row.clickCount += segment.clickCount;
    row.semanticClickCount += segment.semanticClickCount;
    row.firstEnteredMs = Math.min(row.firstEnteredMs, segment.startMs);
    row.lastExitedMs = Math.max(row.lastExitedMs, segment.endMs);
    byStep.set(segment.stepId, row);
  }
  for (const event of events) {
    if (byStep.has(event.effectiveStepId)) continue;
    const definition = displayStep(event.effectiveStepId);
    byStep.set(event.effectiveStepId, {
      stepId: event.effectiveStepId,
      label: definition.label,
      color: definition.color,
      order: definition.order,
      durationMs: 0,
      percentage: 0,
      visitCount: 0,
      eventCount: 1,
      clickCount: event.type === "click" ? 1 : 0,
      semanticClickCount: event.semanticKind ? 1 : 0,
      firstEnteredMs: event.elapsedMs,
      lastExitedMs: event.elapsedMs,
    });
  }
  return [...byStep.values()]
    .map((row) => Object.freeze({
      ...row,
      percentage: durationMs > 0 ? round((row.durationMs / durationMs) * 100, 2) : 0,
    }))
    .sort((left, right) => (left.order < 0 ? Number.MAX_SAFE_INTEGER : left.order)
      - (right.order < 0 ? Number.MAX_SAFE_INTEGER : right.order));
}

function buildTargetStats(events) {
  const clicks = events.filter((event) => event.type === "click");
  const kinds = frequencyStats(clicks, (event) => cleanString(event.target?.kind) || "unknown", (event) => cleanString(event.target?.kind) || "Unknown");
  const targetMap = new Map();
  for (const event of clicks) {
    const row = targetMap.get(event.targetKey) || {
      key: event.targetKey,
      label: event.label,
      kind: cleanString(event.target?.kind) || "unknown",
      semanticKind: event.semanticKind || "",
      action: event.action || "",
      count: 0,
      firstSequence: event.sequence,
      lastSequence: event.sequence,
    };
    row.count += 1;
    row.lastSequence = event.sequence;
    targetMap.set(event.targetKey, row);
  }
  return {
    kinds,
    targets: [...targetMap.values()]
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 40)
      .map(Object.freeze),
  };
}

function buildModeStats(events) {
  return frequencyStats(events, (event) => event.mode || "unknown", (event) => event.mode || "unknown")
    .map((row) => Object.freeze({
      ...row,
      clickCount: events.filter((event) => event.mode === row.key && event.type === "click").length,
    }));
}

function frequencyStats(items, keyForItem, labelForItem) {
  const map = new Map();
  for (const item of items) {
    const key = cleanString(keyForItem(item)) || "unknown";
    const row = map.get(key) || { key, label: cleanString(labelForItem(item)) || key, count: 0 };
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .map(Object.freeze);
}

function buildActivityBins(events, segments, durationMs, binMs) {
  const binCount = Math.max(1, Math.ceil(Math.max(durationMs, 1) / binMs));
  const bins = Array.from({ length: binCount }, (_, index) => ({
    index,
    startMs: index * binMs,
    endMs: Math.min(durationMs, (index + 1) * binMs),
    eventCount: 0,
    clickCount: 0,
    semanticClickCount: 0,
    stepEventCounts: {},
    stepDurationMs: {},
    modeCounts: {},
    dominantStepId: UNKNOWN_STEP_ID,
    momentIds: [],
  }));
  for (const event of events) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(event.elapsedMs / binMs)));
    const bin = bins[index];
    bin.eventCount += 1;
    if (event.type === "click") bin.clickCount += 1;
    if (event.type === "click" && event.semanticKind) bin.semanticClickCount += 1;
    bin.stepEventCounts[event.effectiveStepId] = (bin.stepEventCounts[event.effectiveStepId] || 0) + 1;
    bin.modeCounts[event.mode] = (bin.modeCounts[event.mode] || 0) + 1;
  }
  for (const segment of segments) {
    for (const bin of bins) {
      const overlap = Math.max(0, Math.min(segment.endMs, bin.endMs) - Math.max(segment.startMs, bin.startMs));
      if (overlap > 0) {
        bin.stepDurationMs[segment.stepId] = (bin.stepDurationMs[segment.stepId] || 0) + overlap;
      }
    }
  }
  for (const bin of bins) {
    bin.dominantStepId = maxCountKey(bin.stepDurationMs)
      || maxCountKey(bin.stepEventCounts)
      || UNKNOWN_STEP_ID;
    bin.stepEventCounts = Object.freeze(bin.stepEventCounts);
    bin.stepDurationMs = Object.freeze(bin.stepDurationMs);
    bin.modeCounts = Object.freeze(bin.modeCounts);
  }
  return bins;
}

function buildJourney(segments, transitions) {
  const visitStepIds = segments.map((segment) => segment.stepId).filter((stepId) => stepId !== UNKNOWN_STEP_ID);
  const uniqueStepIds = [...new Set(visitStepIds)];
  const knownSteps = uniqueStepIds.map(stepForId).filter(Boolean);
  const furthest = knownSteps.slice().sort((left, right) => right.order - left.order)[0] || null;
  const forwardTransitionCount = transitions.filter((transition) => transition.direction === "forward").length;
  const backwardTransitionCount = transitions.filter((transition) => transition.direction === "backward").length;
  return {
    startStepId: visitStepIds[0] || UNKNOWN_STEP_ID,
    endStepId: visitStepIds.at(-1) || UNKNOWN_STEP_ID,
    furthestStepId: furthest?.id || UNKNOWN_STEP_ID,
    furthestStepIndex: furthest?.order ?? -1,
    uniqueStepIds: Object.freeze(uniqueStepIds),
    visitStepIds: Object.freeze(visitStepIds),
    visitedStepCount: uniqueStepIds.length,
    forwardTransitionCount,
    backwardTransitionCount,
    confirmedForwardTransitionCount: transitions.filter((transition) => transition.direction === "forward" && transition.confirmed).length,
    completedFinalReview: uniqueStepIds.includes("transition-pacing"),
    progressRatio: furthest ? round((furthest.order + 1) / STEP_DEFINITIONS.length, 4) : 0,
  };
}

function buildDeterministicMoments({
  normalized,
  events,
  transitions,
  corrections,
  unconfirmedIntents,
  journey,
  rageWindowMs,
  rageClickCount,
  pauseThresholdMs,
}) {
  const moments = [];
  const eventBySequence = new Map(events.map((event) => [event.sequence, event]));

  for (const cluster of rageClickClusters(events, rageClickCount, rageWindowMs)) {
    moments.push(moment({
      kind: "rage-clicks",
      valence: "concern",
      severity: cluster.length >= rageClickCount + 2 ? "high" : "medium",
      confidence: "high",
      title: "Rapid repeated clicks",
      summary: `${cluster.length} clicks hit “${cluster[0].label}” within ${formatDuration(cluster.at(-1).elapsedMs - cluster[0].elapsedMs)}. The control may not have responded, or it may have been hard to understand.`,
      startMs: cluster[0].elapsedMs,
      endMs: cluster.at(-1).elapsedMs,
      stepId: cluster[0].effectiveStepId,
      evidence: cluster.slice(0, 8),
      metrics: { clickCount: cluster.length, windowMs: cluster.at(-1).elapsedMs - cluster[0].elapsedMs },
    }));
  }

  for (const transition of transitions) {
    const evidenceEvents = [
      eventBySequence.get(transition.sequence),
      eventBySequence.get(transition.confirmedBySequence),
    ].filter(Boolean);
    if (transition.direction === "forward" && transition.confirmed) {
      moments.push(moment({
        kind: "confirmed-forward-progress",
        valence: "good",
        severity: "info",
        confidence: "high",
        title: "Moved to the next step",
        summary: `The next click confirms a move from ${transition.fromLabel} to ${transition.toLabel}.`,
        startMs: transition.elapsedMs,
        endMs: evidenceEvents.at(-1)?.elapsedMs ?? transition.elapsedMs,
        stepId: transition.toStepId,
        evidence: evidenceEvents,
        metrics: { stepDelta: transition.stepDelta },
      }));
    }
    if (transition.direction === "backward") {
      moments.push(moment({
        kind: "backward-navigation",
        valence: "concern",
        severity: "low",
        confidence: transition.confirmed ? "high" : "medium",
        title: "Went back to an earlier step",
        summary: `The session went back from ${transition.fromLabel} to ${transition.toLabel}. This may be a planned review, or a sign that something needed a change.`,
        startMs: transition.elapsedMs,
        endMs: evidenceEvents.at(-1)?.elapsedMs ?? transition.elapsedMs,
        stepId: transition.toStepId,
        evidence: evidenceEvents,
        metrics: { stepDelta: transition.stepDelta },
      }));
    }
  }

  for (const event of events.filter((candidate) => ["collection-save-failed", "collection-save-canceled"].includes(candidate.type))) {
    const failed = event.type === "collection-save-failed";
    moments.push(moment({
      kind: failed ? "save-failed" : "save-canceled",
      valence: "concern",
      severity: failed ? "high" : "medium",
      confidence: "high",
      title: failed ? "Log save failed" : "Log save canceled",
      summary: failed
        ? "The browser could not save the log. The clicks stayed in memory so the user could try again."
        : "The save was canceled. The clicks stayed in memory so the user could try again.",
      startMs: event.elapsedMs,
      endMs: event.elapsedMs,
      stepId: event.effectiveStepId,
      evidence: [event],
    }));
  }

  const clicks = events.filter((event) => event.type === "click");
  for (let index = 1; index < clicks.length; index += 1) {
    const before = clicks[index - 1];
    const after = clicks[index];
    const gapMs = after.elapsedMs - before.elapsedMs;
    if (gapMs < pauseThresholdMs) continue;
    moments.push(moment({
      kind: "long-pause",
      valence: "watch",
      severity: "info",
      confidence: "low",
      title: "Long pause in clicks",
      summary: `No clicks were recorded for ${formatDuration(gapMs)}. The user may have been reading, thinking, away, or doing something this log does not record.`,
      startMs: before.elapsedMs,
      endMs: after.elapsedMs,
      stepId: before.effectiveStepId,
      evidence: [before, after],
      metrics: { gapMs },
    }));
  }

  const semanticClicks = clicks.filter((event) => event.semanticKind);
  if (semanticClicks.length) {
    const semanticKinds = [...new Set(semanticClicks.map((event) => event.semanticKind))];
    moments.push(moment({
      kind: "semantic-3d-engagement",
      valence: "good",
      severity: "info",
      confidence: "high",
      title: "Used 3D controls",
      summary: `${semanticClicks.length} clicks on named 3D objects or controls were recorded.`,
      startMs: semanticClicks[0].elapsedMs,
      endMs: semanticClicks.at(-1).elapsedMs,
      stepId: semanticClicks[0].effectiveStepId,
      evidence: representativeEvents(semanticClicks, 8),
      metrics: { clickCount: semanticClicks.length, semanticKinds },
    }));
  }

  for (const intent of unconfirmedIntents) {
    const source = eventBySequence.get(intent.sequence);
    const next = eventBySequence.get(intent.confirmedBySequence);
    moments.push(moment({
      kind: "unconfirmed-step-navigation",
      valence: "watch",
      severity: "low",
      confidence: "medium",
      title: "Could not confirm the step change",
      summary: `A click chose ${displayStep(intent.toStepId).label}, but the next click did not show that step. The move may have failed, been canceled, happened later, or simply not been recorded.`,
      startMs: intent.elapsedMs,
      endMs: next?.elapsedMs ?? intent.elapsedMs,
      stepId: intent.fromStepId,
      evidence: [source, next].filter(Boolean),
    }));
  }

  const stopEvent = events.slice().reverse().find((event) => event.type === "collection-stopped");
  if (stopEvent && journey.visitedStepCount <= 1 && journey.forwardTransitionCount === 0) {
    const startEvent = events.find((event) => event.type === "collection-started") || events[0];
    moments.push(moment({
      kind: "finish-without-progress",
      valence: "watch",
      severity: "low",
      confidence: "medium",
      title: "Stayed in one step",
      summary: "The session ended without a clear move to another step. This may be a short session focused on one step, not a problem.",
      startMs: startEvent?.elapsedMs || 0,
      endMs: stopEvent.elapsedMs,
      stepId: stopEvent.effectiveStepId,
      evidence: [startEvent, stopEvent].filter(Boolean),
    }));
  }

  if (normalized.eventCount >= 25_000) {
    const finalEvent = events.at(-1);
    moments.push(moment({
      kind: "event-limit-reached",
      valence: "concern",
      severity: "high",
      confidence: "medium",
      title: "Log may be incomplete",
      summary: "The log reached its click limit, so later clicks may be missing.",
      startMs: finalEvent?.elapsedMs || normalized.durationMs,
      endMs: normalized.durationMs,
      stepId: finalEvent?.effectiveStepId || UNKNOWN_STEP_ID,
      evidence: finalEvent ? [finalEvent] : [],
    }));
  }

  return moments
    .filter((entry) => entry.evidence.length)
    .sort((left, right) => left.startMs - right.startMs || momentValenceOrder(left.valence) - momentValenceOrder(right.valence))
    .map((entry, index) => Object.freeze({ ...entry, id: `moment-${index + 1}-${entry.kind}` }));
}

function rageClickClusters(events, minimumCount, windowMs) {
  const byTarget = new Map();
  for (const event of events.filter((candidate) => candidate.type === "click")) {
    const list = byTarget.get(event.targetKey) || [];
    list.push(event);
    byTarget.set(event.targetKey, list);
  }
  const clusters = [];
  for (const targetEvents of byTarget.values()) {
    let start = 0;
    while (start <= targetEvents.length - minimumCount) {
      const requiredEnd = start + minimumCount - 1;
      if (targetEvents[requiredEnd].elapsedMs - targetEvents[start].elapsedMs <= windowMs) {
        let end = requiredEnd;
        while (end + 1 < targetEvents.length && targetEvents[end + 1].elapsedMs - targetEvents[start].elapsedMs <= windowMs) end += 1;
        clusters.push(targetEvents.slice(start, end + 1));
        start = end + 1;
      } else {
        start += 1;
      }
    }
  }
  return clusters.sort((left, right) => left[0].elapsedMs - right[0].elapsedMs);
}

function moment({ kind, valence, severity, confidence, title, summary, startMs, endMs, stepId, evidence, metrics = {} }) {
  return {
    id: "",
    kind,
    valence,
    severity,
    confidence,
    title,
    summary,
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
    stepId: stepId || UNKNOWN_STEP_ID,
    evidence: Object.freeze((evidence || []).filter(Boolean).map(eventCitation)),
    metrics: Object.freeze(metrics),
  };
}

function eventCitation(event) {
  return Object.freeze({
    sequence: event.sequence,
    elapsedMs: event.elapsedMs,
    type: event.type,
    stepId: event.effectiveStepId || event.stepId || UNKNOWN_STEP_ID,
    label: event.label,
  });
}

function representativeEvents(events, maximum) {
  if (events.length <= maximum) return events;
  const result = [];
  for (let index = 0; index < maximum; index += 1) {
    result.push(events[Math.round((index / (maximum - 1)) * (events.length - 1))]);
  }
  return [...new Map(result.map((event) => [event.sequence, event])).values()];
}

function attachMomentIdsToBins(bins, moments) {
  for (const momentEntry of moments) {
    for (const bin of bins) {
      if (momentEntry.endMs >= bin.startMs && momentEntry.startMs <= bin.endMs) {
        bin.momentIds.push(momentEntry.id);
      }
    }
  }
  for (const bin of bins) {
    bin.momentIds = Object.freeze([...new Set(bin.momentIds)]);
    Object.freeze(bin);
  }
}

function compactAnalysisForCodex(analysis, sessionId, eventLimit) {
  const prioritizedSequences = [];
  const citedSequences = new Set();
  const addSequence = (sequence) => {
    if (sequence == null || citedSequences.has(sequence)) return;
    citedSequences.add(sequence);
    prioritizedSequences.push(sequence);
  };
  for (const finding of analysis.moments) {
    for (const evidence of finding.evidence) addSequence(evidence.sequence);
  }
  for (const transition of analysis.transitions) {
    addSequence(transition.sequence);
    addSequence(transition.confirmedBySequence);
  }
  for (const event of analysis.events) {
    if (["collection-save-failed", "collection-save-canceled"].includes(event.type)) addSequence(event.sequence);
  }
  const semanticEvents = analysis.events.filter((event) => event.semanticKind).slice(0, 24);
  for (const event of semanticEvents) addSequence(event.sequence);
  for (const warning of analysis.warnings) {
    for (const sequence of warning.evidenceSequences || []) addSequence(sequence);
  }
  addSequence(analysis.events[0]?.sequence);
  addSequence(analysis.events.at(-1)?.sequence);

  const eventBySequence = new Map();
  for (const event of analysis.events) {
    if (!eventBySequence.has(event.sequence)) eventBySequence.set(event.sequence, event);
  }
  const selected = prioritizedSequences.map((sequence) => eventBySequence.get(sequence)).filter(Boolean);
  const compactEvents = selected
    .slice(0, eventLimit)
    .sort((left, right) => left.elapsedMs - right.elapsedMs || left.sequence - right.sequence)
    .map((event) => Object.freeze({
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      type: event.type,
      stepId: event.effectiveStepId,
      mode: event.mode,
      label: event.label,
      targetKind: cleanString(event.target?.kind) || "unknown",
      semanticKind: event.semanticKind || "",
      action: event.action || "",
    }));
  const suppliedSequences = new Set(compactEvents.map((event) => event.sequence));
  const deterministicMoments = analysis.moments
    .map((finding) => Object.freeze({
      ...finding,
      evidence: Object.freeze(finding.evidence.filter((entry) => suppliedSequences.has(entry.sequence))),
    }))
    .filter((finding) => finding.evidence.length);
  return Object.freeze({
    sessionId,
    ...(sessionId !== analysis.source.sessionId ? { sourceSessionId: analysis.source.sessionId || null } : {}),
    fileName: analysis.source.fileName,
    story: analysis.session.story,
    durationMs: analysis.session.durationMs,
    eventCount: analysis.source.eventCount,
    clickCount: analysis.stats.clickCount,
    journey: analysis.journey,
    stepDwell: Object.freeze(analysis.stepDwell.map((row) => Object.freeze({
      stepId: row.stepId,
      durationMs: row.durationMs,
      percentage: row.percentage,
      visitCount: row.visitCount,
      clickCount: row.clickCount,
    }))),
    transitions: analysis.transitions,
    activityBins: Object.freeze(analysis.timeline.activityBins.map((bin) => Object.freeze({
      startMs: bin.startMs,
      endMs: bin.endMs,
      clickCount: bin.clickCount,
      semanticClickCount: bin.semanticClickCount,
      dominantStepId: bin.dominantStepId,
      momentIds: bin.momentIds,
    }))),
    targetKinds: Object.freeze(analysis.stats.targetKinds.slice(0, 12)),
    topTargets: Object.freeze(analysis.stats.topTargets.slice(0, 16)),
    semanticKinds: analysis.stats.semanticKinds,
    modes: analysis.stats.modes,
    deterministicMoments: Object.freeze(deterministicMoments),
    omittedDeterministicMomentCount: Math.max(0, analysis.moments.length - deterministicMoments.length),
    dataQualityWarnings: analysis.warnings,
    evidenceEvents: Object.freeze(compactEvents),
    omittedEvidenceEventCount: Math.max(0, selected.length - compactEvents.length),
  });
}

function uniqueEvidenceSessionId(value, index, used) {
  const base = cleanString(value) || `session-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function stepDisplayFields(stepId) {
  const definition = displayStep(stepId);
  return { label: definition.label, color: definition.color, order: definition.order };
}

function dataWarning(code, message, severity = "watch", evidenceSequences = []) {
  return Object.freeze({
    code,
    severity,
    message,
    evidenceSequences: Object.freeze(evidenceSequences.filter((value) => value != null)),
  });
}

function normalizeViewport(value) {
  const source = serializableObject(value);
  const result = {};
  for (const key of ["width", "height", "devicePixelRatio"]) {
    const number = finiteNumber(source[key]);
    if (number != null) result[key] = number;
  }
  return Object.freeze(result);
}

function serializableObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizedIsoDate(value) {
  const milliseconds = dateMilliseconds(value);
  return milliseconds == null ? null : new Date(milliseconds).toISOString();
}

function dateMilliseconds(value) {
  if (value == null || value === "") return null;
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonnegativeFiniteNumber(value) {
  const number = finiteNumber(value);
  return number == null ? null : Math.max(0, number);
}

function positiveFiniteNumber(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function maxCountKey(value) {
  return Object.entries(value || {}).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || "";
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatDuration(milliseconds) {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${round(milliseconds / 1_000, 1)} s`;
  return `${round(milliseconds / 60_000, 1)} min`;
}

function momentValenceOrder(value) {
  return ({ concern: 0, watch: 1, good: 2 })[value] ?? 3;
}
