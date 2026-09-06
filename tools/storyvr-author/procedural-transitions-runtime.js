export const PROCEDURAL_TRANSITIONS_SCHEMA_VERSION = "storyvr-procedural-transitions/v1";
export const PROCEDURAL_TRANSITION_PLAN_SCHEMA_VERSION = "storyvr-procedural-transition-plan/v1";
export const PROCEDURAL_TRANSITION_MIDDLE_SCHEMA_VERSION = "storyvr-procedural-transition-middle/v1";

export const PROCEDURAL_TRANSITION_ENDPOINT_POLICY = Object.freeze({
  from: "exact-saved-scene",
  to: "exact-saved-scene",
  middle: "transient-only",
  completion: "restore-exact-destination-scene",
});

const TRANSITION_STYLES = new Set(["generated", "interpolate", "crossfade", "cut"]);
const TRANSITION_EASINGS = new Set(["linear", "ease-in", "ease-out", "ease-in-out"]);
const TRANSITION_TRACK_PROPERTIES = new Set([
  "opacity", "positionOffset", "rotationOffsetDegrees", "scaleMultiplier",
  "color", "emissiveColor", "emissiveIntensity",
]);
const TRANSITION_TRACK_INTERPOLATIONS = new Set(["linear", "step", "smooth"]);
const UNSAFE_TEXT_PATTERN = /(?:\b(?:https?|file|data|javascript):|```|<\/?[a-z][^>]*>|\beval\s*\(|\bfunction\s*\(|=>)/i;
const EXECUTABLE_DECLARATIVE_KEYS = new Set([
  "code",
  "script",
  "javascript",
  "shader",
  "shaderSource",
  "vertexShader",
  "fragmentShader",
  "executable",
  "callback",
]);

export function emptyProceduralTransitionsStore() {
  return {
    schemaVersion: PROCEDURAL_TRANSITIONS_SCHEMA_VERSION,
    revision: 0,
    updatedAt: null,
    plansByBoundary: {},
  };
}

export function proceduralTransitionBoundaryKey(boundaryContext) {
  const boundary = normalizeBoundaryContext(boundaryContext);
  if (!boundary) return "";
  return [
    `edge:${encodeURIComponent(boundary.edgeId)}`,
    `from:${transitionSceneContextToken(boundary.fromContext)}`,
    `to:${transitionSceneContextToken(boundary.toContext)}`,
  ].join("|");
}

export function normalizeProceduralTransitionPlan(value, boundaryContext = null) {
  const source = objectValue(value);
  if (!source) throw transitionContractError("A procedural transition plan must be an object.");
  if (source.schemaVersion !== undefined
    && source.schemaVersion !== PROCEDURAL_TRANSITION_PLAN_SCHEMA_VERSION) {
    throw transitionContractError("The procedural transition plan uses an unsupported schema version.");
  }

  const expectedBoundary = boundaryContext ? requireBoundaryContext(boundaryContext) : null;
  const planBoundary = requireBoundaryContext({
    edgeId: source.edgeId || expectedBoundary?.edgeId,
    fromContext: source.fromContext || source.fromSceneContext || expectedBoundary?.fromContext,
    toContext: source.toContext || source.toSceneContext || expectedBoundary?.toContext,
  });
  const boundaryKey = proceduralTransitionBoundaryKey(planBoundary);
  if (expectedBoundary && boundaryKey !== proceduralTransitionBoundaryKey(expectedBoundary)) {
    throw transitionContractError("The procedural transition plan belongs to a different directed boundary.");
  }
  const suppliedBoundaryKey = cleanText(source.boundaryKey, 1600);
  if (suppliedBoundaryKey && suppliedBoundaryKey !== boundaryKey) {
    throw transitionContractError("The procedural transition boundary key does not match its edge and endpoint contexts.");
  }

  const style = normalizePlanEnum(source.style, TRANSITION_STYLES, "interpolate", "style");
  const defaultDuration = style === "generated" ? 2 : style === "cut" ? 0.4 : style === "crossfade" ? 1.2 : 1.6;
  const durationSeconds = positiveFiniteNumber(source.durationSeconds, defaultDuration);
  const easing = normalizePlanEnum(
    source.easing,
    TRANSITION_EASINGS,
    style === "cut" ? "linear" : "ease-in-out",
    "easing",
  );
  const arcHeightMeters = style === "interpolate"
    ? nonNegativeFiniteNumber(source.arcHeightMeters, 0)
    : 0;
  const prompt = requiredSafeText(source.prompt, 2000, "The procedural transition plan requires its author prompt.");
  const subjectEntityIds = normalizeProceduralTransitionSubjectEntityIds(source.subjectEntityIds);
  const summary = safeGeneratedText(
    source.summary,
    defaultTransitionSummary(style, durationSeconds),
    600,
  );
  const endpointPolicy = normalizeTransitionEndpointPolicy(source.endpointPolicy);
  const middle = normalizeProceduralTransitionMiddle(
    source.middle || source.middleSequence || source.transientMiddle,
  );
  if (style === "generated" && !middle.actions.some((action) => action.tracks?.length)) {
    throw transitionContractError("A generated procedural transition requires explicit property tracks.");
  }
  assertSelectedTransitionSubjectScope(subjectEntityIds, middle);

  return {
    schemaVersion: PROCEDURAL_TRANSITION_PLAN_SCHEMA_VERSION,
    boundaryKey,
    edgeId: planBoundary.edgeId,
    fromContext: planBoundary.fromContext,
    toContext: planBoundary.toContext,
    prompt,
    ...(subjectEntityIds.length ? { subjectEntityIds } : {}),
    summary,
    style,
    durationSeconds,
    easing,
    arcHeightMeters,
    endpointPolicy,
    middle,
  };
}

export function normalizeProceduralTransitionSubjectEntityIds(value) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) {
    throw transitionContractError("Procedural transition subjectEntityIds must be an array of exact destination scene entity IDs.");
  }
  const subjectEntityIds = [];
  const seen = new Set();
  for (const entityId of value) {
    if (typeof entityId !== "string"
      || !entityId
      || entityId !== entityId.trim()
      || entityId.length > 240
      || /[\u0000-\u001f\u007f]/.test(entityId)) {
      throw transitionContractError("Every procedural transition subject must be an exact destination scene entity ID string.");
    }
    if (seen.has(entityId)) continue;
    seen.add(entityId);
    subjectEntityIds.push(entityId);
  }
  return subjectEntityIds;
}

export function normalizeProceduralTransitionMiddle(value) {
  if (value === null || value === undefined) return emptyProceduralTransitionMiddle();
  const source = objectValue(value);
  if (!source) throw transitionContractError("A procedural transition middle must be an object.");
  if (source.schemaVersion !== undefined
    && source.schemaVersion !== PROCEDURAL_TRANSITION_MIDDLE_SCHEMA_VERSION) {
    throw transitionContractError("The procedural transition middle uses an unsupported schema version.");
  }
  assertCompatibleEndpointPolicy(source.endpointPolicy);
  const rawActions = Array.isArray(source.actions)
    ? source.actions
    : Array.isArray(source.effects)
      ? source.effects
      : [];
  const actions = rawActions.map((action, index) => normalizeTransientMiddleAction(action, index));
  return {
    schemaVersion: PROCEDURAL_TRANSITION_MIDDLE_SCHEMA_VERSION,
    description: safeGeneratedText(source.description || source.summary, "", 2000),
    endpointPolicy: { ...PROCEDURAL_TRANSITION_ENDPOINT_POLICY },
    actions,
  };
}

export function proceduralTransitionMiddleSample(planOrMiddle, progress) {
  const rawProgress = Number(progress);
  const normalizedProgress = clampUnitInterval(rawProgress);
  const middle = isTransitionMiddle(planOrMiddle)
    ? normalizeProceduralTransitionMiddle(planOrMiddle)
    : normalizeProceduralTransitionMiddle(objectValue(planOrMiddle)?.middle);
  if (!Number.isFinite(rawProgress) || normalizedProgress <= 0) {
    return {
      progress: 0,
      endpoint: "from",
      endpointPolicy: { ...PROCEDURAL_TRANSITION_ENDPOINT_POLICY },
      actions: [],
    };
  }
  if (normalizedProgress >= 1) {
    return {
      progress: 1,
      endpoint: "to",
      endpointPolicy: { ...PROCEDURAL_TRANSITION_ENDPOINT_POLICY },
      actions: [],
    };
  }
  const actions = middle.actions.flatMap((action) => {
    if (normalizedProgress < action.startProgress
      || (normalizedProgress > action.endProgress && !action.tracks?.length)) return [];
    const span = action.endProgress - action.startProgress;
    const localProgress = span > 0
      ? clampUnitInterval((normalizedProgress - action.startProgress) / span)
      : 1;
    return [{ ...action, localProgress }];
  });
  return {
    progress: normalizedProgress,
    endpoint: null,
    endpointPolicy: { ...PROCEDURAL_TRANSITION_ENDPOINT_POLICY },
    actions,
  };
}

export function proceduralTransitionHasTracks(plan) {
  const actions = plan?.middle?.actions;
  return Array.isArray(actions) && actions.some((action) => Array.isArray(action?.tracks) && action.tracks.length > 0);
}

export function normalizeProceduralTransitionTracks(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw transitionContractError("Procedural transition tracks must be an array.");
  const properties = new Set();
  return value.map((rawTrack) => {
    const track = objectValue(rawTrack);
    if (!track || Object.keys(track).some((key) => !["property", "interpolation", "keyframes"].includes(key))) {
      throw transitionContractError("A procedural transition track must contain only property, interpolation, and keyframes.");
    }
    const property = track.property;
    if (!TRANSITION_TRACK_PROPERTIES.has(property)) {
      throw transitionContractError("The procedural transition track property is not supported.");
    }
    if (properties.has(property)) throw transitionContractError("A procedural transition action cannot repeat a track property.");
    properties.add(property);
    const interpolation = track.interpolation ?? "linear";
    if (!TRANSITION_TRACK_INTERPOLATIONS.has(interpolation)) {
      throw transitionContractError("The procedural transition track interpolation is not supported.");
    }
    if (!Array.isArray(track.keyframes) || !track.keyframes.length) {
      throw transitionContractError("A procedural transition track requires at least one keyframe.");
    }
    const progressValues = new Set();
    const keyframes = track.keyframes.map((rawKeyframe) => {
      const keyframe = objectValue(rawKeyframe);
      if (!keyframe || Object.keys(keyframe).some((key) => !["progress", "value"].includes(key))
        || typeof keyframe.progress !== "number" || !Number.isFinite(keyframe.progress)
        || keyframe.progress < 0 || keyframe.progress > 1) {
        throw transitionContractError("A procedural transition keyframe requires progress from 0 to 1 and a value.");
      }
      if (progressValues.has(keyframe.progress)) throw transitionContractError("A procedural transition track cannot repeat keyframe progress.");
      progressValues.add(keyframe.progress);
      return { progress: keyframe.progress, value: normalizeTransitionTrackValue(property, keyframe.value) };
    }).sort((left, right) => left.progress - right.progress);
    const vectorValues = keyframes.filter((keyframe) => Array.isArray(keyframe.value));
    if (vectorValues.length && vectorValues.length !== keyframes.length) {
      throw transitionContractError("A procedural transition track must use the same value shape for every keyframe.");
    }
    return { property, interpolation, keyframes };
  });
}

export function proceduralTransitionTrackSample(action, localProgress) {
  const tracks = normalizeProceduralTransitionTracks(action?.tracks);
  const progress = clampUnitInterval(localProgress);
  return Object.fromEntries(tracks.map((track) => [track.property, sampleTransitionTrack(track, progress)]));
}

function normalizeTransitionTrackValue(property, value) {
  if (property === "color" || property === "emissiveColor") {
    if (typeof value !== "string" || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) {
      throw transitionContractError("Procedural transition color tracks require hex colors.");
    }
    return value.length === 4
      ? `#${[...value.slice(1)].map((channel) => channel.repeat(2)).join("")}`.toLowerCase()
      : value.toLowerCase();
  }
  const vector = property === "positionOffset" || property === "rotationOffsetDegrees"
    || (property === "scaleMultiplier" && Array.isArray(value));
  const values = vector ? value : [value];
  if (!Array.isArray(values) || (vector && values.length !== 3)
    || !values.every((item) => typeof item === "number" && Number.isFinite(item))
    || (["opacity", "scaleMultiplier", "emissiveIntensity"].includes(property) && values.some((item) => item < 0))
    || (property === "opacity" && values.some((item) => item > 1))) {
    throw transitionContractError(`The procedural transition ${property} track has an invalid value.`);
  }
  return vector ? [...values] : value;
}

function sampleTransitionTrack(track, progress) {
  const keyframes = track.keyframes;
  const copyValue = (value) => Array.isArray(value) ? [...value] : value;
  if (progress <= keyframes[0].progress) return copyValue(keyframes[0].value);
  if (progress >= keyframes.at(-1).progress) return copyValue(keyframes.at(-1).value);
  const upperIndex = keyframes.findIndex((keyframe) => keyframe.progress > progress);
  const left = keyframes[upperIndex - 1];
  const right = keyframes[upperIndex];
  if (track.interpolation === "step") return copyValue(left.value);
  const ratio = (progress - left.progress) / (right.progress - left.progress);
  const blend = track.interpolation === "smooth" ? ratio * ratio * (3 - 2 * ratio) : ratio;
  const lerp = (from, to) => from * (1 - blend) + to * blend;
  if (Array.isArray(left.value)) return left.value.map((value, index) => lerp(value, right.value[index]));
  if (typeof left.value === "string") {
    return `#${[1, 3, 5].map((offset) => Math.round(lerp(
      Number.parseInt(left.value.slice(offset, offset + 2), 16),
      Number.parseInt(right.value.slice(offset, offset + 2), 16),
    )).toString(16).padStart(2, "0")).join("")}`;
  }
  return lerp(left.value, right.value);
}

export function normalizeProceduralTransitionsStore(value) {
  const source = objectValue(value);
  if (!source || source.schemaVersion !== PROCEDURAL_TRANSITIONS_SCHEMA_VERSION) {
    return emptyProceduralTransitionsStore();
  }
  const plansByBoundary = {};
  const rawPlans = objectValue(source.plansByBoundary) || {};
  for (const [storedBoundaryKey, rawPlan] of Object.entries(rawPlans)) {
    try {
      const plan = normalizeProceduralTransitionPlan(rawPlan);
      if (storedBoundaryKey !== plan.boundaryKey) continue;
      plansByBoundary[plan.boundaryKey] = plan;
    } catch {
      // Malformed or stale plans remain inert instead of reaching a Reader.
    }
  }
  return {
    schemaVersion: PROCEDURAL_TRANSITIONS_SCHEMA_VERSION,
    revision: nonNegativeInteger(source.revision, 0),
    updatedAt: validTimestamp(source.updatedAt),
    plansByBoundary,
  };
}

export function proceduralTransitionPlanForBoundary(store, boundaryContext) {
  const boundaryKey = proceduralTransitionBoundaryKey(boundaryContext);
  if (!boundaryKey) return null;
  const normalizedStore = normalizeProceduralTransitionsStore(store);
  const rawPlan = normalizedStore.plansByBoundary[boundaryKey];
  if (!rawPlan) return null;
  try {
    return normalizeProceduralTransitionPlan(rawPlan, boundaryContext);
  } catch {
    return null;
  }
}

export function proceduralTransitionEasedProgress(planOrEasing, progressOrEasing) {
  const progressFirst = typeof planOrEasing === "number";
  const progress = clampUnitInterval(progressFirst ? planOrEasing : progressOrEasing);
  const easingSource = progressFirst ? progressOrEasing : planOrEasing;
  const easing = typeof easingSource === "string"
    ? easingSource
    : String(easingSource?.easing || "linear");
  if (easing === "ease-in") return progress * progress;
  if (easing === "ease-out") return 1 - ((1 - progress) * (1 - progress));
  if (easing === "ease-in-out") {
    return progress < 0.5
      ? 2 * progress * progress
      : 1 - (((-2 * progress) + 2) ** 2) / 2;
  }
  return progress;
}

function normalizeBoundaryContext(value) {
  const wrapper = objectValue(value);
  const source = objectValue(wrapper?.boundaryContext)
    || objectValue(wrapper?.boundary)
    || wrapper;
  if (!source) return null;
  const authored = objectValue(source.authoredTransition);
  const edgeId = normalizedIdentity(
    source.edgeId
    || source.transitionEdgeId
    || source.routeId
    || authored?.edgeId
    || authored?.id,
  );
  const fromContext = normalizeTransitionSceneContext(
    source.fromContext
    || source.fromSceneContext
    || authored?.fromContext
    || source.from,
  );
  const toContext = normalizeTransitionSceneContext(
    source.toContext
    || source.toSceneContext
    || authored?.toContext
    || source.to,
  );
  if (!edgeId || !fromContext || !toContext) return null;
  return { edgeId, fromContext, toContext };
}

function requireBoundaryContext(value) {
  const boundary = normalizeBoundaryContext(value);
  if (!boundary) {
    throw transitionContractError("boundaryContext must include edgeId and full fromContext/toContext endpoints.");
  }
  return boundary;
}

function normalizeTransitionSceneContext(value) {
  const source = objectValue(value);
  if (!source) return null;
  const beatId = normalizedIdentity(source.beatId || source.id);
  if (!beatId) return null;
  return {
    beatId,
    variantGroupId: normalizedOptionalIdentity(source.variantGroupId || source.groupId),
    variantOptionId: normalizedOptionalIdentity(source.variantOptionId || source.optionId),
  };
}

function transitionSceneContextToken(context) {
  return [
    context.beatId,
    context.variantGroupId || "",
    context.variantOptionId || "",
  ].map((value) => encodeURIComponent(value)).join("~");
}

function normalizePlanEnum(value, allowed, fallback, label) {
  const text = String(value ?? "").trim();
  // Providers may spell the same base easing as easeInOut or ease_in_out.
  // Canonicalize spelling while keeping the supported easing set unchanged.
  const normalized = (label === "easing"
    ? text.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-")
    : text).toLowerCase();
  if (!normalized) return fallback;
  if (!allowed.has(normalized)) {
    throw transitionContractError(`The procedural transition ${label} is not supported.`);
  }
  return normalized;
}

function emptyProceduralTransitionMiddle() {
  return {
    schemaVersion: PROCEDURAL_TRANSITION_MIDDLE_SCHEMA_VERSION,
    description: "",
    endpointPolicy: { ...PROCEDURAL_TRANSITION_ENDPOINT_POLICY },
    actions: [],
  };
}

function isTransitionMiddle(value) {
  const source = objectValue(value);
  return Boolean(source && (
    source.schemaVersion === PROCEDURAL_TRANSITION_MIDDLE_SCHEMA_VERSION
    || Array.isArray(source.actions)
    || Array.isArray(source.effects)
  ));
}

function normalizeTransitionEndpointPolicy(value) {
  assertCompatibleEndpointPolicy(value);
  return { ...PROCEDURAL_TRANSITION_ENDPOINT_POLICY };
}

function assertCompatibleEndpointPolicy(value) {
  if (value === null || value === undefined) return;
  const source = objectValue(value);
  if (!source) throw transitionContractError("The procedural transition endpoint policy must be an object.");
  for (const [key, expected] of Object.entries(PROCEDURAL_TRANSITION_ENDPOINT_POLICY)) {
    if (source[key] !== undefined && source[key] !== expected) {
      throw transitionContractError("Procedural transitions cannot override their exact saved scene endpoints.");
    }
  }
  const unknownKeys = Object.keys(source).filter((key) => !Object.hasOwn(PROCEDURAL_TRANSITION_ENDPOINT_POLICY, key));
  if (unknownKeys.length) {
    throw transitionContractError("Procedural transitions cannot add endpoint-state overrides.");
  }
}

function normalizeTransientMiddleAction(value, index) {
  const source = objectValue(value);
  if (!source) throw transitionContractError(`Procedural transition middle action ${index + 1} must be an object.`);
  const kind = requiredSafeText(
    source.kind || source.type || source.action,
    240,
    `Procedural transition middle action ${index + 1} requires a kind.`,
  );
  const startProgress = clampUnitInterval(
    finiteNumber(source.startProgress ?? source.start ?? source.fromProgress, 0),
  );
  const endProgress = clampUnitInterval(
    finiteNumber(source.endProgress ?? source.end ?? source.toProgress, 1),
  );
  const firstProgress = Math.min(startProgress, endProgress);
  const lastProgress = Math.max(startProgress, endProgress);
  const id = safeGeneratedText(source.id, `middle-action-${index + 1}`, 240);
  const target = source.target === undefined
    ? null
    : safeDeclarativeTransitionValue(source.target, `middle action ${index + 1} target`);
  const parametersSource = source.parameters ?? source.params ?? source.payload ?? transientActionParameters(source);
  const parameters = safeDeclarativeTransitionValue(
    parametersSource,
    `middle action ${index + 1} parameters`,
  );
  const tracks = source.tracks === undefined ? null : normalizeProceduralTransitionTracks(source.tracks);
  if (tracks?.length && (!objectValue(target) || !["from", "to", "both"].includes(target.scope))) {
    throw transitionContractError("A procedural transition track action requires an explicit from, to, or both target scope.");
  }
  return {
    id,
    kind,
    startProgress: firstProgress,
    endProgress: lastProgress,
    easing: safeGeneratedText(source.easing, "linear", 240),
    target,
    parameters,
    ...(tracks ? { tracks } : {}),
    cleanup: "restore-endpoint",
  };
}

function assertSelectedTransitionSubjectScope(subjectEntityIds, middle) {
  if (!subjectEntityIds.length || !middle.actions.length) return;
  const subjectSet = new Set(subjectEntityIds);
  const coveredSubjects = new Set();
  for (const action of middle.actions) {
    const target = objectValue(action.target);
    const scope = String(target?.scope || "").trim().toLowerCase();
    const entityId = typeof target?.entityId === "string" ? target.entityId : "";
    if (scope !== "to" || !subjectSet.has(entityId)) {
      throw transitionContractError(
        "Every selected-subject transition middle action must target one selected destination object with {scope:'to', entityId}.",
      );
    }
    coveredSubjects.add(entityId);
  }
  const missingEntityId = subjectEntityIds.find((entityId) => !coveredSubjects.has(entityId));
  if (missingEntityId) {
    throw transitionContractError(
      `The procedural transition middle does not affect the selected destination subject: ${missingEntityId}.`,
    );
  }
}

function transientActionParameters(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => ![
    "id",
    "kind",
    "type",
    "action",
    "startProgress",
    "start",
    "fromProgress",
    "endProgress",
    "end",
    "toProgress",
    "easing",
    "target",
    "parameters",
    "params",
    "payload",
    "cleanup",
    "tracks",
  ].includes(key)));
}

function safeDeclarativeTransitionValue(value, label, seen = new Set(), depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw transitionContractError(`The procedural transition ${label} must use finite numbers.`);
    return value;
  }
  if (typeof value === "string") {
    const text = cleanText(value, 8000);
    if (UNSAFE_TEXT_PATTERN.test(text)) {
      throw transitionContractError(`The procedural transition ${label} cannot contain code, URLs, or executable content.`);
    }
    return text;
  }
  if (typeof value !== "object") {
    throw transitionContractError(`The procedural transition ${label} must be declarative JSON data.`);
  }
  if (depth > 32) throw transitionContractError(`The procedural transition ${label} is nested too deeply.`);
  if (seen.has(value)) throw transitionContractError(`The procedural transition ${label} cannot contain circular data.`);
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => safeDeclarativeTransitionValue(item, label, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [rawKey, nested] of Object.entries(value)) {
    const key = requiredSafeText(rawKey, 240, `The procedural transition ${label} contains an invalid key.`);
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw transitionContractError(`The procedural transition ${label} contains an unsafe key.`);
    }
    if (EXECUTABLE_DECLARATIVE_KEYS.has(key)) {
      throw transitionContractError(`The procedural transition ${label} cannot contain executable instructions.`);
    }
    result[key] = safeDeclarativeTransitionValue(nested, `${label}.${key}`, seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveFiniteNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Number(number.toFixed(4));
}

function nonNegativeFiniteNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Number(number.toFixed(4));
}

function defaultTransitionSummary(style, durationSeconds) {
  const label = style === "generated"
    ? "Runs generated property tracks between the saved scenes"
    : style === "crossfade"
    ? "Crossfades between the saved scenes"
    : style === "cut"
      ? "Cuts directly to the next saved scene"
      : "Interpolates between the saved scenes";
  return `${label} over ${formatNumber(durationSeconds)} seconds.`;
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizedIdentity(value) {
  const identity = cleanText(value, 240);
  return identity || "";
}

function normalizedOptionalIdentity(value) {
  if (value === null || value === undefined || value === "") return null;
  return normalizedIdentity(value) || null;
}

function requiredSafeText(value, maximumLength, errorMessage) {
  const text = cleanText(value, maximumLength);
  if (!text) throw transitionContractError(errorMessage);
  if (UNSAFE_TEXT_PATTERN.test(text)) {
    throw transitionContractError("Procedural transition text cannot contain code, URLs, or executable content.");
  }
  return text;
}

function safeGeneratedText(value, fallback, maximumLength) {
  const text = cleanText(value, maximumLength);
  return text && !UNSAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function cleanText(value, maximumLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function clampUnitInterval(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function validTimestamp(value) {
  const timestamp = String(value || "").trim();
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function transitionContractError(message) {
  return Object.assign(new TypeError(message), { statusCode: 400 });
}
