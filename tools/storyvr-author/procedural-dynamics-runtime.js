const DEFAULT_MINIMUM_VIEWER_DISTANCE_METERS = 1.5;
const DEFAULT_MAXIMUM_SPEED_METERS_PER_SECOND = 1.2;
const TAU = Math.PI * 2;

export function proceduralDynamicsSceneKey(scopeOrBeatId, variantOptionId = null) {
  const scope = scopeOrBeatId && typeof scopeOrBeatId === "object"
    ? scopeOrBeatId
    : { beatId: scopeOrBeatId, variantOptionId };
  const beatId = normalizedString(scope?.beatId || scope?.unitId);
  const variantId = normalizedString(scope?.variantOptionId || scope?.optionId);
  if (!beatId) return "";
  return variantId ? `variant:${beatId}:${variantId}` : `beat:${beatId}`;
}

export function proceduralDynamicsPlansForScene(store, scope = {}) {
  if (!store || typeof store !== "object") return [];
  const requestedKey = proceduralDynamicsSceneKey(scope);
  const beatKey = proceduralDynamicsSceneKey({ beatId: scope?.beatId || scope?.unitId });
  const plansByScene = store.plansByScene && typeof store.plansByScene === "object"
    ? store.plansByScene
    : {};
  const keyedValue = requestedKey && Object.prototype.hasOwnProperty.call(plansByScene, requestedKey)
    ? plansByScene[requestedKey]
    : beatKey && Object.prototype.hasOwnProperty.call(plansByScene, beatKey)
      ? plansByScene[beatKey]
      : null;
  const keyedPlans = planList(keyedValue);
  if (keyedPlans.length) {
    return keyedPlans
      .map((plan, index) => normalizeProceduralDynamicsPlan(plan, { sceneKey: requestedKey || beatKey, index }))
      .filter((plan) => plan.enabled && plan.actors.length);
  }

  const declaredPlans = [
    ...planList(store.plans),
    ...planList(store.recipes),
  ];
  return declaredPlans
    .filter((plan) => proceduralDynamicsPlanMatchesScope(plan, scope))
    .map((plan, index) => normalizeProceduralDynamicsPlan(plan, { sceneKey: requestedKey || beatKey, index }))
    .filter((plan) => plan.enabled && plan.actors.length);
}

export function normalizeProceduralDynamicsPlan(plan, options = {}) {
  const source = plan && typeof plan === "object" ? plan : {};
  const sceneKey = normalizedString(source.sceneKey || options.sceneKey || proceduralDynamicsSceneKey(source.scope));
  const id = normalizedString(source.id || source.planId) || `${sceneKey || "scene"}:procedural-dynamics:${(options.index || 0) + 1}`;
  const actorSources = normalizePlanActors(source);
  const anchorSource = source.anchor && typeof source.anchor === "object" ? source.anchor : {};
  const comfortSource = source.comfort && typeof source.comfort === "object" ? source.comfort : {};
  const lifecycleSource = source.lifecycle && typeof source.lifecycle === "object" ? source.lifecycle : {};
  const actors = uniqueMotionTargetActors(
    actorSources.map((actor, index) => normalizeProceduralDynamicsActor(actor, source, index)),
  );
  const metadata = withoutKeys(source, [
    "actors",
    "sceneComposition",
    "assetVisibility",
    "suppressedAuthoredAssetIds",
    "hiddenAssetIds",
    "suppressedAssetIds",
    "visibleAuthoredAssetIds",
    "targets",
    "sources",
    "population",
    "instanceCount",
    "count",
    "scale",
    "scaleRange",
    "targetSizeMeters",
    "performance",
    "anchor",
    "comfort",
    "lifecycle",
  ]);
  return {
    ...metadata,
    id,
    planId: id,
    sceneKey,
    scope: normalizePlanScope(source.scope, sceneKey),
    enabled: source.enabled !== false,
    seed: source.seed ?? id,
    anchor: {
      ...anchorSource,
      space: normalizedAnchorSpace(anchorSource.space || anchorSource.coordinateSpace),
      offsetMeters: finiteVector3(anchorSource.offsetMeters || anchorSource.offset || anchorSource.position, [0, 0, 0]),
      follow: false,
    },
    actors,
    comfort: {
      ...comfortSource,
      minimumViewerDistanceMeters: clampedNumber(
        comfortSource.minimumViewerDistanceMeters ?? comfortSource.minViewerDistanceMeters,
        DEFAULT_MINIMUM_VIEWER_DISTANCE_METERS,
        0.75,
        8,
      ),
      maximumSpeedMetersPerSecond: clampedNumber(
        comfortSource.maximumSpeedMetersPerSecond ?? comfortSource.maxSpeedMetersPerSecond,
        DEFAULT_MAXIMUM_SPEED_METERS_PER_SECOND,
        0.1,
        4,
      ),
      worldLocked: true,
    },
    lifecycle: {
      ...lifecycleSource,
      fadeInSeconds: clampedNumber(lifecycleSource.fadeInSeconds, 0.45, 0, 5),
      fadeOutSeconds: clampedNumber(lifecycleSource.fadeOutSeconds, 0, 0, 5),
    },
    performance: {
      totalMotionAssignments: actors.length,
      maxActiveAnimationMixers: actors.length,
      castShadow: false,
    },
  };
}

export function proceduralDynamicsInstanceLimit(plan, _options = {}) {
  const normalized = normalizeProceduralDynamicsPlan(plan);
  return normalized.actors.length;
}

export function clampProceduralDynamicsPlan(plan, _options = {}) {
  const normalized = normalizeProceduralDynamicsPlan(plan);
  return {
    ...normalized,
    motionTargetCount: normalized.actors.length,
  };
}

export function expandProceduralDynamicsInstances(plan, options = {}) {
  const normalizedPlan = clampProceduralDynamicsPlan(plan, options);
  const assignmentCount = normalizedPlan.actors.length;
  return normalizedPlan.actors.map((actor, actorIndex) => {
    const targetKey = actor.entityId || actor.assetId || actor.actorId;
    const random = seededRandom(`${normalizedPlan.seed}|${normalizedPlan.id}|${targetKey}`);
    const trajectory = expandTrajectory(
      actor.trajectory,
      assignmentCount,
      actorIndex,
      random,
      normalizedPlan.comfort,
    );
    const animation = expandAnimation(actor.animation, assignmentCount, actorIndex, random);
    return {
      instanceId: actor.entityId || `${actor.actorId}:1`,
      instanceIndex: 0,
      planId: normalizedPlan.id,
      sceneKey: normalizedPlan.sceneKey,
      actorId: actor.actorId,
      actorIndex,
      entityId: actor.entityId,
      assetId: actor.assetId,
      clip: actor.clip,
      clipIndex: actor.clip.index,
      clipIndexes: actor.clip.indexes,
      clipName: actor.clip.name,
      trajectory,
      orientation: actor.orientation,
      animation,
      animationMode: animation.mode,
      animationTimeScale: animation.timeScale,
      animationPhase01: animation.phase,
      modelForwardAxis: actor.orientation.modelForwardAxis,
      orientationKind: actor.orientation.kind,
      orientationSmoothingSeconds: clampedNumber(actor.orientation.smoothingSeconds, 0.18, 0, 2),
      yawOffsetRadians: clampedNumber(
        actor.orientation.yawOffsetRadians,
        actor.orientation.yawOffsetDegrees * Math.PI / 180,
        -Math.PI * 2,
        Math.PI * 2,
      ),
      yawOffsetDegrees: actor.orientation.yawOffsetDegrees,
      radiusMeters: trajectory.radiusX,
      heightMeters: trajectory.height,
      angularSpeedRadiansPerSecond: trajectory.angularSpeed,
      verticalSwayMeters: trajectory.verticalSway,
      entryFadeSeconds: normalizedPlan.lifecycle.fadeInSeconds,
      exitBlendSeconds: normalizedPlan.lifecycle.fadeOutSeconds,
      anchor: normalizedPlan.anchor,
    };
  });
}

export function sampleProceduralDynamicsTransform(instance, elapsedSeconds) {
  const elapsed = Math.max(0, finiteNumber(elapsedSeconds, 0));
  const trajectory = instance?.trajectory || {};
  const sampled = trajectory.kind === "waypoint-loop"
    ? sampleWaypointLoop(trajectory, elapsed)
    : sampleSchoolOrbit(trajectory, elapsed);
  const fadeSeconds = Math.max(0, finiteNumber(instance?.entryFadeSeconds, 0));
  const opacity = fadeSeconds > 0 ? clamp01(elapsed / fadeSeconds) : 1;
  return {
    position: sampled.position,
    tangent: normalizedVector3(sampled.tangent, [0, 0, 1]),
    opacity,
    progress: sampled.progress,
  };
}

function normalizePlanActors(plan) {
  return Array.isArray(plan.actors) ? plan.actors : [];
}

function normalizeProceduralDynamicsActor(actor, plan, index) {
  const source = actor && typeof actor === "object" ? actor : {};
  const trajectorySource = source.trajectory || source.motion || plan.trajectory || plan.motion || {};
  const orientationSource = source.orientation || plan.orientation || {};
  const animationSource = source.animation || plan.animation || {};
  const actorId = normalizedString(source.actorId || source.id) || `actor-${index + 1}`;
  const orientationKind = normalizedString(orientationSource.kind || orientationSource.mode) || "path-tangent";
  const animationMode = animationSource.enabled === false
    ? "none"
    : normalizedString(animationSource.mode) || "loop";
  return {
    id: actorId,
    actorId,
    entityId: normalizedString(source.entityId || source.targetEntityId || source.spatialEntityId),
    assetId: normalizedString(source.assetId || source.sourceAssetId),
    clip: normalizeActorClip(source.clip || source.animationClip || source.clipIndexes),
    trajectory: normalizeTrajectory(trajectorySource),
    orientation: {
      kind: orientationKind,
      mode: orientationKind,
      modelForwardAxis: normalizedForwardAxis(orientationSource.modelForwardAxis || orientationSource.forwardAxis),
      yawOffsetDegrees: clampedNumber(orientationSource.yawOffsetDegrees, 0, -360, 360),
      yawOffsetRadians: clampedNumber(
        orientationSource.yawOffsetRadians,
        clampedNumber(orientationSource.yawOffsetDegrees, 0, -360, 360) * Math.PI / 180,
        -Math.PI * 2,
        Math.PI * 2,
      ),
      smoothingSeconds: clampedNumber(orientationSource.smoothingSeconds, 0.18, 0, 2),
    },
    animation: {
      enabled: animationMode !== "none",
      mode: animationMode,
      phase: animationSource.phase ?? "staggered",
      timeScale: finiteRange(
        animationSource.timeScale ?? animationSource.playbackRate,
        [0.9, 1.1],
        0.05,
        4,
      ),
    },
  };
}

function uniqueMotionTargetActors(actors) {
  const targets = new Set();
  return actors.filter((actor) => {
    const key = actor.entityId
      ? `entity:${actor.entityId}`
      : actor.assetId
        ? `asset:${actor.assetId}`
        : "";
    if (!key || targets.has(key)) return false;
    targets.add(key);
    return true;
  });
}

function normalizeTrajectory(value) {
  const source = value && typeof value === "object" ? value : {};
  const kind = normalizedTrajectoryKind(source.kind || source.type);
  if (kind === "waypoint-loop") {
    return {
      ...source,
      kind,
      waypoints: normalizeWaypoints(source.waypoints || source.points),
      durationSeconds: finiteRange(source.durationSeconds, [8, 12], 0.25, 300),
      direction: normalizedDirection(source.direction),
      phase: source.phase ?? "staggered",
    };
  }
  const radius = finiteRange(source.radiusMeters ?? source.radius, [2.4, 3.8], 0.1, 20);
  return {
    ...source,
    kind: "school-orbit",
    radiusMeters: radius,
    radiusXMeters: finiteRange(source.radiusXMeters, radius, 0.1, 20),
    radiusZMeters: finiteRange(source.radiusZMeters, radius, 0.1, 20),
    heightMeters: finiteRange(
      source.heightMeters ?? source.verticalOffsetMeters,
      [-0.55, 0.55],
      -10,
      10,
    ),
    angularSpeedRadiansPerSecond: finiteRange(
      source.angularSpeedRadiansPerSecond ?? source.angularSpeed,
      [0.12, 0.26],
      0.001,
      4,
    ),
    direction: normalizedDirection(source.direction),
    phase: source.phase ?? "staggered",
    verticalSwayMeters: finiteRange(source.verticalSwayMeters, [0.08, 0.28], 0, 3),
    verticalSwayFrequencyHz: finiteRange(source.verticalSwayFrequencyHz, [0.08, 0.18], 0, 4),
  };
}

function expandTrajectory(trajectory, count, index, random, comfort) {
  const direction = expandedDirection(trajectory.direction, index, random);
  if (trajectory.kind === "waypoint-loop") {
    const phase = expandedUnitPhase(trajectory.phase, count, index, random);
    const minimumDuration = waypointLoopLength(trajectory.waypoints)
      / Math.max(comfort.maximumSpeedMetersPerSecond, 0.001);
    return {
      ...trajectory,
      waypoints: trajectory.waypoints,
      durationSeconds: Math.max(randomInRange(trajectory.durationSeconds, random), minimumDuration),
      phase,
      direction,
    };
  }
  const phase = expandedPhase(trajectory.phase, count, index, random);
  const minimumDistance = comfort.minimumViewerDistanceMeters;
  const radiusX = Math.max(minimumDistance, randomInRange(trajectory.radiusXMeters, random));
  const radiusZ = Math.max(minimumDistance, randomInRange(trajectory.radiusZMeters, random));
  const radiusForSpeed = Math.max(radiusX, radiusZ, 0.001);
  const requestedAngularSpeed = randomInRange(trajectory.angularSpeedRadiansPerSecond, random);
  const angularSpeed = Math.min(requestedAngularSpeed, comfort.maximumSpeedMetersPerSecond / radiusForSpeed);
  return {
    ...trajectory,
    radiusX,
    radiusZ,
    height: randomInRange(trajectory.heightMeters, random),
    angularSpeed,
    direction,
    phase,
    verticalSway: randomInRange(trajectory.verticalSwayMeters, random),
    verticalSwayFrequency: randomInRange(trajectory.verticalSwayFrequencyHz, random),
    verticalSwayPhase: random() * TAU,
  };
}

function expandAnimation(animation, count, index, random) {
  return {
    ...animation,
    phase: expandedUnitPhase(animation.phase, count, index, random),
    timeScale: randomInRange(animation.timeScale, random),
  };
}

function sampleSchoolOrbit(trajectory, elapsed) {
  const radiusX = Math.max(0.001, finiteNumber(trajectory.radiusX, 2.8));
  const radiusZ = Math.max(0.001, finiteNumber(trajectory.radiusZ, radiusX));
  const height = finiteNumber(trajectory.height, 0);
  const angularSpeed = Math.max(0, finiteNumber(trajectory.angularSpeed, 0.18));
  const direction = finiteNumber(trajectory.direction, 1) < 0 ? -1 : 1;
  const phase = finiteNumber(trajectory.phase, 0);
  const angle = phase + direction * angularSpeed * elapsed;
  const sway = Math.max(0, finiteNumber(trajectory.verticalSway, 0));
  const swayFrequency = Math.max(0, finiteNumber(trajectory.verticalSwayFrequency, 0));
  const swayPhase = finiteNumber(trajectory.verticalSwayPhase, 0);
  const swayAngle = TAU * swayFrequency * elapsed + swayPhase;
  const position = [
    Math.cos(angle) * radiusX,
    height + Math.sin(swayAngle) * sway,
    Math.sin(angle) * radiusZ,
  ];
  const tangent = [
    -Math.sin(angle) * radiusX * direction,
    sway * TAU * swayFrequency * Math.cos(swayAngle),
    Math.cos(angle) * radiusZ * direction,
  ];
  return {
    position,
    tangent,
    progress: positiveModulo(angle, TAU) / TAU,
  };
}

function sampleWaypointLoop(trajectory, elapsed) {
  const waypoints = normalizeWaypoints(trajectory.waypoints);
  if (waypoints.length < 2) {
    return { position: [0, 0, 0], tangent: [0, 0, 1], progress: 0 };
  }
  const segments = waypoints.map((point, index) => {
    const next = waypoints[(index + 1) % waypoints.length];
    return {
      from: point,
      to: next,
      length: vectorDistance(point, next),
    };
  }).filter((segment) => segment.length > 1e-6);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!segments.length || totalLength <= 1e-6) {
    return { position: [...waypoints[0]], tangent: [0, 0, 1], progress: 0 };
  }
  const durationSeconds = Math.max(0.001, finiteNumber(trajectory.durationSeconds, 10));
  const direction = finiteNumber(trajectory.direction, 1) < 0 ? -1 : 1;
  const phase = clamp01(finiteNumber(trajectory.phase, 0));
  const progress = positiveModulo(phase + direction * (elapsed / durationSeconds), 1);
  const targetDistance = progress * totalLength;
  let traversed = 0;
  for (const segment of segments) {
    const end = traversed + segment.length;
    if (targetDistance <= end) {
      const localProgress = clamp01((targetDistance - traversed) / segment.length);
      return {
        position: vectorLerp(segment.from, segment.to, localProgress),
        tangent: direction > 0
          ? vectorSubtract(segment.to, segment.from)
          : vectorSubtract(segment.from, segment.to),
        progress,
      };
    }
    traversed = end;
  }
  const final = segments[segments.length - 1];
  return {
    position: [...final.to],
    tangent: vectorSubtract(final.to, final.from),
    progress,
  };
}

function normalizeActorClip(value) {
  if (Number.isInteger(Number(value)) && value !== "") {
    const index = Math.max(0, Number(value));
    return { index, indexes: [index], name: "" };
  }
  if (typeof value === "string") return { index: null, indexes: [], name: value.trim() };
  if (Array.isArray(value)) {
    const indexes = uniqueIntegers(value);
    return { index: indexes[0] ?? null, indexes, name: "" };
  }
  const source = value && typeof value === "object" ? value : {};
  const indexes = uniqueIntegers([
    ...(source.indexes || source.clipIndexes || []),
    source.index,
    source.clipIndex,
  ]);
  return {
    ...source,
    index: indexes[0] ?? null,
    indexes,
    name: normalizedString(source.name || source.clipName || source.animationName),
  };
}

function normalizePlanScope(scope, sceneKey) {
  const source = scope && typeof scope === "object" ? scope : {};
  const fromKey = scopeFromSceneKey(sceneKey);
  return {
    ...source,
    beatId: normalizedString(source.beatId || source.unitId || fromKey.beatId),
    ...(normalizedString(source.variantOptionId || source.optionId || fromKey.variantOptionId)
      ? { variantOptionId: normalizedString(source.variantOptionId || source.optionId || fromKey.variantOptionId) }
      : {}),
  };
}

function proceduralDynamicsPlanMatchesScope(plan, scope) {
  const requestedBeatId = normalizedString(scope?.beatId || scope?.unitId);
  const requestedVariantId = normalizedString(scope?.variantOptionId || scope?.optionId);
  const planScope = normalizePlanScope(plan?.scope, plan?.sceneKey);
  if (requestedBeatId && planScope.beatId !== requestedBeatId) return false;
  if (planScope.variantOptionId) return planScope.variantOptionId === requestedVariantId;
  return true;
}

function scopeFromSceneKey(sceneKey) {
  const value = normalizedString(sceneKey);
  if (value.startsWith("beat:")) return { beatId: value.slice(5), variantOptionId: "" };
  if (value.startsWith("variant:")) {
    const [beatId, ...variantParts] = value.slice(8).split(":");
    return { beatId, variantOptionId: variantParts.join(":") };
  }
  return { beatId: "", variantOptionId: "" };
}

function normalizeWaypoints(value) {
  return planList(value).map((point) => finiteVector3(point, null)).filter(Boolean);
}

function finiteVector3(value, fallback) {
  const array = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value.x, value.y, value.z]
      : null;
  if (!array || array.length < 3 || array.slice(0, 3).some((item) => !Number.isFinite(Number(item)))) {
    return fallback ? [...fallback] : null;
  }
  return array.slice(0, 3).map(Number);
}

function normalizedVector3(value, fallback) {
  const vector = finiteVector3(value, fallback);
  const length = Math.hypot(...vector);
  return length > 1e-9
    ? vector.map((item) => {
      const normalized = item / length;
      return Math.abs(normalized) < 1e-15 ? 0 : normalized;
    })
    : [...fallback];
}

function finiteRange(value, fallback, minimum, maximum) {
  const pair = Array.isArray(value)
    ? [value[0], value[value.length > 1 ? 1 : 0]]
    : value && typeof value === "object"
      ? [value.min ?? value.minimum ?? value.from, value.max ?? value.maximum ?? value.to]
      : value !== null && value !== undefined
        ? [value, value]
        : fallback;
  let low = clampedNumber(pair?.[0], fallback[0], minimum, maximum);
  let high = clampedNumber(pair?.[1], fallback[1], minimum, maximum);
  if (low > high) [low, high] = [high, low];
  return [low, high];
}

function randomInRange(range, random) {
  const [low, high] = finiteRange(range, [1, 1], -1e6, 1e6);
  return low + (high - low) * random();
}

function expandedPhase(value, count, index, random) {
  if (Number.isFinite(Number(value))) return positiveModulo(Number(value), TAU);
  const base = count > 0 ? (TAU * index) / count : 0;
  return positiveModulo(base + (random() - 0.5) * (TAU / Math.max(4, count * 2)), TAU);
}

function expandedUnitPhase(value, count, index, random) {
  if (Number.isFinite(Number(value))) return positiveModulo(Number(value), 1);
  if (normalizedString(value).toLowerCase() === "synchronized") return 0;
  const base = count > 0 ? index / count : 0;
  return positiveModulo(base + (random() - 0.5) / Math.max(4, count * 2), 1);
}

function expandedDirection(value, index, random) {
  const text = normalizedString(value).toLowerCase();
  if (value === 1 || text.includes("counter")) return 1;
  if (value === -1 || text.includes("clockwise") || text === "reverse") return -1;
  return index % 2 === 0 ? (random() < 0.5 ? -1 : 1) : (random() < 0.5 ? 1 : -1);
}

function normalizedDirection(value) {
  if (value === -1 || value === 1) return value;
  const text = normalizedString(value).toLowerCase();
  if (text.includes("counter")) return 1;
  if (text.includes("clockwise") || text === "reverse") return -1;
  return "mixed";
}

function normalizedTrajectoryKind(value) {
  const text = normalizedString(value).toLowerCase().replace(/[\s_]+/g, "-");
  return text.includes("waypoint") ? "waypoint-loop" : "school-orbit";
}

function normalizedAnchorSpace(value) {
  const text = normalizedString(value).toLowerCase().replace(/[\s_]+/g, "-");
  return text === "world" || text === "scene" ? text : "reader-start";
}

function normalizedForwardAxis(value) {
  const text = normalizedString(value).toUpperCase().replace(/\s+/g, "");
  return new Set(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]).has(text) ? text : "+Z";
}

function planList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (Array.isArray(value.plans)) return value.plans.filter(Boolean);
  return typeof value === "object" ? [value] : [];
}

function withoutKeys(value, keys) {
  const copy = { ...(value && typeof value === "object" ? value : {}) };
  for (const key of keys) delete copy[key];
  return copy;
}

function uniqueIntegers(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .map(Number)
    .filter((item) => Number.isInteger(item) && item >= 0))];
}

function clampedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedString(value) {
  return String(value ?? "").trim();
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finiteNumber(value, 0)));
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function vectorDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function waypointLoopLength(waypoints) {
  const points = normalizeWaypoints(waypoints);
  if (points.length < 2) return 0;
  return points.reduce((sum, point, index) => (
    sum + vectorDistance(point, points[(index + 1) % points.length])
  ), 0);
}

function vectorSubtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function vectorLerp(left, right, progress) {
  return [
    left[0] + (right[0] - left[0]) * progress,
    left[1] + (right[1] - left[1]) * progress,
    left[2] + (right[2] - left[2]) * progress,
  ];
}

function seededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value) {
  const text = normalizedString(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
