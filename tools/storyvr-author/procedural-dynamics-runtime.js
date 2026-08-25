const DEFAULT_MINIMUM_VIEWER_DISTANCE_METERS = 1.5;
const DEFAULT_MAXIMUM_SPEED_METERS_PER_SECOND = 1.2;
const AUTHOR_OFFSET_POSITION_LIMIT_METERS = 1000;
const ATTACHMENT_OFFSET_POSITION_LIMIT_METERS = 100;
const AUTHOR_OFFSET_SCALE_MINIMUM = 0.001;
const AUTHOR_OFFSET_SCALE_MAXIMUM = 1000;
const TAU = Math.PI * 2;
const GENERATED_OBJECT_KINDS = new Set(["primitive", "light", "particle-emitter"]);
const TRACK_PROPERTIES = new Set([
  "transform.position",
  "transform.rotationEulerDegrees",
  "transform.quaternion",
  "transform.scale",
  "appearance.opacity",
  "appearance.visible",
  "appearance.color",
  "appearance.brightness",
  "appearance.emissiveColor",
  "appearance.emissiveIntensity",
  "light.intensity",
  "light.distance",
  "light.angle",
  "particle.rate",
  "particle.size",
]);
const EXISTING_ACTOR_TRACK_PROPERTIES = new Set([
  "transform.position",
  "transform.rotationEulerDegrees",
  "transform.quaternion",
  "transform.scale",
  "appearance.opacity",
  "appearance.visible",
  "appearance.color",
  "appearance.brightness",
]);

export function proceduralDynamicsSceneKey(scopeOrBeatId, variantOptionId = null) {
  const scope = scopeOrBeatId && typeof scopeOrBeatId === "object"
    ? scopeOrBeatId
    : { beatId: scopeOrBeatId, variantOptionId };
  const beatId = normalizedString(scope?.beatId || scope?.unitId);
  const variantId = normalizedString(scope?.variantOptionId || scope?.optionId);
  if (!beatId) return "";
  return variantId ? `variant:${beatId}:${variantId}` : `beat:${beatId}`;
}

export function normalizeProceduralDynamicsAuthorOffset(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const position = finiteVector3(source.position || source.translation, [0, 0, 0])
    .map((component) => clampedNumber(
      component,
      0,
      -AUTHOR_OFFSET_POSITION_LIMIT_METERS,
      AUTHOR_OFFSET_POSITION_LIMIT_METERS,
    ));
  const quaternion = finiteQuaternion(source.quaternion)
    || quaternionFromEulerDegrees(
      source.rotationEulerDegrees || source.rotationDegrees || source.rotation,
    )
    || [0, 0, 0, 1];
  const scale = finiteScale3(source.scale, [1, 1, 1])
    .map((component) => clampedNumber(
      component,
      1,
      AUTHOR_OFFSET_SCALE_MINIMUM,
      AUTHOR_OFFSET_SCALE_MAXIMUM,
    ));
  return { position, quaternion, scale };
}

export function normalizeProceduralDynamicsGeneratedAttachment(value) {
  if (value === undefined || value === null) return null;
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const requestedType = normalizedString(source.type).toLowerCase().replace(/[\s_]+/g, "-");
  const requestedPoint = normalizedString(source.point).toLowerCase().replace(/[\s_]+/g, "-");
  const entityId = normalizedString(source.entityId);
  const valid = requestedType === "entity"
    && Boolean(entityId)
    && requestedPoint === "bounds-center";
  return {
    type: valid ? "entity" : "invalid",
    entityId,
    point: requestedPoint || "invalid",
    follow: valid && source.follow !== false,
    offsetMeters: finiteVector3(source.offsetMeters, [0, 0, 0])
      .map((component) => clampedNumber(
        component,
        0,
        -ATTACHMENT_OFFSET_POSITION_LIMIT_METERS,
        ATTACHMENT_OFFSET_POSITION_LIMIT_METERS,
      )),
  };
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
      .filter((plan) => plan.enabled && (plan.actors.length || plan.generatedObjects.length));
  }

  const declaredPlans = [
    ...planList(store.plans),
    ...planList(store.recipes),
  ];
  return declaredPlans
    .filter((plan) => proceduralDynamicsPlanMatchesScope(plan, scope))
    .map((plan, index) => normalizeProceduralDynamicsPlan(plan, { sceneKey: requestedKey || beatKey, index }))
    .filter((plan) => plan.enabled && (plan.actors.length || plan.generatedObjects.length));
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
  const generatedObjects = uniqueGeneratedObjects(
    normalizeGeneratedObjectSources(source)
      .map((object, index) => normalizeProceduralDynamicsGeneratedObject(object, index)),
  );
  const metadata = withoutKeys(source, [
    "actors",
    "generatedObjects",
    "effects",
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
    generatedObjects,
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
      maxActiveAnimationMixers: actors.filter((actor) => (
        actor.targetKind === "glb" && actor.animation.enabled
      )).length,
      generatedObjectCount: generatedObjects.length,
      totalAnimatedElementCount: actors.length + generatedObjects.length,
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
    generatedObjectCount: normalized.generatedObjects.length,
    totalAnimatedElementCount: normalized.actors.length + normalized.generatedObjects.length,
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
    const timeline = expandTimeline(actor.timeline, assignmentCount, actorIndex, random);
    return {
      instanceId: actor.entityId || `${actor.actorId}:1`,
      instanceIndex: 0,
      planId: normalizedPlan.id,
      sceneKey: normalizedPlan.sceneKey,
      actorId: actor.actorId,
      actorIndex,
      entityId: actor.entityId,
      assetId: actor.assetId,
      targetKind: actor.targetKind,
      clip: actor.clip,
      clipIndex: actor.clip.index,
      clipIndexes: actor.clip.indexes,
      clipName: actor.clip.name,
      trajectory,
      ...(timeline ? { timeline } : {}),
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

export function expandProceduralDynamicsGeneratedObjects(plan, options = {}) {
  const normalizedPlan = clampProceduralDynamicsPlan(plan, options);
  const objectCount = normalizedPlan.generatedObjects.length;
  return normalizedPlan.generatedObjects.map((object, objectIndex) => {
    const random = seededRandom(`${normalizedPlan.seed}|${normalizedPlan.id}|generated:${object.id}`);
    const timeline = expandTimeline(object.timeline, objectCount, objectIndex, random);
    return {
      instanceId: object.id,
      objectId: object.id,
      planId: normalizedPlan.id,
      sceneKey: normalizedPlan.sceneKey,
      elementKind: "generated-object",
      kind: object.kind,
      object: object.object,
      transform: object.transform,
      authorOffset: object.authorOffset,
      ...(object.attachment ? { attachment: object.attachment } : {}),
      appearance: object.appearance,
      ...(timeline ? { timeline } : {}),
      entryFadeSeconds: normalizedPlan.lifecycle.fadeInSeconds,
      exitBlendSeconds: normalizedPlan.lifecycle.fadeOutSeconds,
      anchor: normalizedPlan.anchor,
    };
  });
}

export function expandProceduralDynamicsElements(plan, options = {}) {
  return [
    ...expandProceduralDynamicsInstances(plan, options).map((instance) => ({
      ...instance,
      elementKind: "existing-actor",
    })),
    ...expandProceduralDynamicsGeneratedObjects(plan, options),
  ];
}

export function sampleProceduralDynamicsTransform(instance, elapsedSeconds) {
  const elapsed = Math.max(0, finiteNumber(elapsedSeconds, 0));
  const trajectory = instance?.trajectory || {};
  const sampled = trajectory.kind === "waypoint-loop"
    ? sampleWaypointLoop(trajectory, elapsed)
    : trajectory.kind === "keyframe-path"
      ? sampleKeyframePath(trajectory, elapsed)
      : trajectory.kind === "stationary" || !instance?.trajectory
        ? { position: [...(instance?.transform?.position || [0, 0, 0])], tangent: [0, 0, 1], progress: 0 }
        : sampleSchoolOrbit(trajectory, elapsed);
  const timelineSample = sampleTimeline(instance?.timeline, elapsed);
  const timelinePosition = finiteVector3(timelineSample.properties["transform.position"], null);
  const position = timelinePosition || sampled.position;
  const tangent = timelinePosition
    ? timelinePositionTangent(instance?.timeline, elapsed)
    : sampled.tangent;
  const fadeSeconds = Math.max(0, finiteNumber(instance?.entryFadeSeconds, 0));
  const fadeOpacity = fadeSeconds > 0 ? clamp01(elapsed / fadeSeconds) : 1;
  const trackedOpacity = timelineSample.properties["appearance.opacity"];
  const opacity = fadeOpacity * (Number.isFinite(Number(trackedOpacity)) ? clamp01(trackedOpacity) : 1);
  const sample = {
    position,
    tangent: normalizedVector3(tangent, [0, 0, 1]),
    opacity,
    progress: timelineSample.active ? timelineSample.progress : sampled.progress,
    quaternion: finiteQuaternion(timelineSample.properties["transform.quaternion"]),
    rotationEulerDegrees: finiteVector3(timelineSample.properties["transform.rotationEulerDegrees"], null) || undefined,
    scale: finiteVector3(timelineSample.properties["transform.scale"], null) || undefined,
    visible: timelineSample.properties["appearance.visible"],
    color: timelineSample.properties["appearance.color"],
    brightness: finiteOrUndefined(timelineSample.properties["appearance.brightness"]),
    emissiveColor: timelineSample.properties["appearance.emissiveColor"],
    emissiveIntensity: finiteOrUndefined(timelineSample.properties["appearance.emissiveIntensity"]),
    lightIntensity: finiteOrUndefined(timelineSample.properties["light.intensity"]),
    lightDistance: finiteOrUndefined(timelineSample.properties["light.distance"]),
    lightAngle: finiteOrUndefined(timelineSample.properties["light.angle"]),
    particleRate: finiteOrUndefined(timelineSample.properties["particle.rate"]),
    particleSize: finiteOrUndefined(timelineSample.properties["particle.size"]),
    properties: timelineSample.properties,
  };
  return applyProceduralDynamicsAuthorOffset(sample, instance?.authorOffset, instance?.transform);
}

export function applyProceduralDynamicsAuthorOffset(sample, authorOffset, baseTransform = null) {
  const source = sample && typeof sample === "object" ? sample : {};
  const offset = normalizeProceduralDynamicsAuthorOffset(authorOffset);
  const hasPositionOffset = offset.position.some((component) => Math.abs(component) > 1e-12);
  const hasRotationOffset = Math.abs(offset.quaternion[0]) > 1e-12
    || Math.abs(offset.quaternion[1]) > 1e-12
    || Math.abs(offset.quaternion[2]) > 1e-12
    || Math.abs(offset.quaternion[3] - 1) > 1e-12;
  const hasScaleOffset = offset.scale.some((component) => Math.abs(component - 1) > 1e-12);
  if (!hasPositionOffset && !hasRotationOffset && !hasScaleOffset) return source;

  const composed = { ...source };
  if (hasPositionOffset) {
    const sampledPosition = finiteVector3(source.position, finiteVector3(baseTransform?.position, [0, 0, 0]));
    composed.position = sampledPosition.map((component, index) => component + offset.position[index]);
  }
  if (hasRotationOffset) {
    const sampledQuaternion = finiteQuaternion(source.quaternion)
      || quaternionFromEulerDegrees(source.rotationEulerDegrees)
      || finiteQuaternion(baseTransform?.quaternion)
      || quaternionFromEulerDegrees(
        baseTransform?.rotationEulerDegrees || baseTransform?.rotationDegrees || baseTransform?.rotation,
      )
      || [0, 0, 0, 1];
    composed.quaternion = multiplyQuaternions(sampledQuaternion, offset.quaternion);
    composed.rotationEulerDegrees = undefined;
  }
  if (hasScaleOffset) {
    const sampledScale = finiteScale3(source.scale, finiteScale3(baseTransform?.scale, [1, 1, 1]));
    composed.scale = sampledScale.map((component, index) => component * offset.scale[index]);
  }
  return composed;
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
  const targetKind = normalizedExistingTargetKind(
    source.targetKind || source.entityKind || source.actorKind || source.kind,
    source.entityId || source.targetEntityId || source.spatialEntityId,
  );
  const orientationKind = normalizedOrientationKind(
    orientationSource.kind || orientationSource.mode,
    targetKind === "image-plane" ? "fixed" : "path-tangent",
  );
  const animationMode = targetKind === "image-plane" || animationSource.enabled === false
    ? "none"
    : normalizedString(animationSource.mode) || "loop";
  return {
    id: actorId,
    actorId,
    entityId: normalizedString(source.entityId || source.targetEntityId || source.spatialEntityId),
    assetId: normalizedString(source.assetId || source.sourceAssetId),
    targetKind,
    clip: normalizeActorClip(source.clip || source.animationClip || source.clipIndexes),
    trajectory: normalizeTrajectory(trajectorySource),
    timeline: normalizeExistingActorTimeline(
      normalizeTimeline(source.timeline || source.motionTimeline),
    ),
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

function normalizeExistingActorTimeline(timeline) {
  if (!timeline) return null;
  const explicitProperties = new Set(timeline.tracks.map((track) => track.property));
  const tracks = timeline.tracks.map((track) => {
    if (track.property === "appearance.emissiveIntensity") {
      if (explicitProperties.has("appearance.brightness")) return null;
      return {
        ...track,
        property: "appearance.brightness",
        keyframes: track.keyframes.map((keyframe) => ({
          ...keyframe,
          value: clampedNumber(1 + Number(keyframe.value || 0), 1, 0, 4),
        })),
      };
    }
    if (track.property === "appearance.emissiveColor") {
      if (explicitProperties.has("appearance.color")) return null;
      return { ...track, property: "appearance.color" };
    }
    return EXISTING_ACTOR_TRACK_PROPERTIES.has(track.property) ? track : null;
  }).filter(Boolean);
  return tracks.length ? { ...timeline, tracks } : null;
}

function normalizedExistingTargetKind(value, entityId = "") {
  const requested = normalizedString(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (["image", "image-plane", "picture", "photo"].includes(requested)) return "image-plane";
  if (["glb", "gltf", "model", "3d-model"].includes(requested)) return "glb";
  return /^image:/i.test(normalizedString(entityId)) ? "image-plane" : "glb";
}

function normalizedOrientationKind(value, fallback = "path-tangent") {
  const requested = normalizedString(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (["fixed", "authored", "none"].includes(requested)) return "fixed";
  if (["path-tangent", "tangent", "face-path", "follow-path"].includes(requested)) return "path-tangent";
  return fallback;
}

function normalizeGeneratedObjectSources(plan) {
  return Array.isArray(plan.generatedObjects)
    ? plan.generatedObjects
    : Array.isArray(plan.effects)
      ? plan.effects
      : [];
}

function normalizeProceduralDynamicsGeneratedObject(value, index) {
  const source = value && typeof value === "object" ? value : {};
  const objectSource = source.object && typeof source.object === "object" ? source.object : source;
  const requestedKind = normalizedString(source.kind || objectSource.kind || source.type)
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  const kind = requestedKind === "particles" || requestedKind === "particle-system"
    ? "particle-emitter"
    : GENERATED_OBJECT_KINDS.has(requestedKind)
      ? requestedKind
      : "primitive";
  const id = normalizedString(source.id || source.objectId) || `generated-object-${index + 1}`;
  const transformSource = source.transform && typeof source.transform === "object" ? source.transform : {};
  const appearanceSource = source.appearance && typeof source.appearance === "object" ? source.appearance : {};
  const attachment = normalizeProceduralDynamicsGeneratedAttachment(source.attachment);
  return {
    id,
    objectId: id,
    kind,
    object: normalizeGeneratedObjectDefinition(objectSource, kind, appearanceSource),
    transform: {
      position: finiteVector3(transformSource.position, [0, 0, 0]),
      ...(finiteQuaternion(transformSource.quaternion)
        ? { quaternion: finiteQuaternion(transformSource.quaternion) }
        : finiteVector3(transformSource.rotationEulerDegrees || transformSource.rotationDegrees, null)
          ? { rotationEulerDegrees: finiteVector3(transformSource.rotationEulerDegrees || transformSource.rotationDegrees, null) }
          : {}),
      scale: finiteScale3(transformSource.scale, [1, 1, 1]),
    },
    authorOffset: normalizeProceduralDynamicsAuthorOffset(source.authorOffset),
    ...(attachment ? { attachment } : {}),
    appearance: {
      visible: appearanceSource.visible !== false,
      color: normalizedColor(appearanceSource.color, "#ffffff"),
      opacity: clampedNumber(appearanceSource.opacity, 1, 0, 1),
      emissiveColor: normalizedColor(appearanceSource.emissiveColor, normalizedColor(appearanceSource.color, "#ffffff")),
      emissiveIntensity: nonNegativeNumber(appearanceSource.emissiveIntensity, 0),
      transparent: appearanceSource.transparent === true || Number(appearanceSource.opacity) < 1,
    },
    timeline: normalizeTimeline(source.timeline || source.animationTimeline || source.animation?.timeline),
  };
}

function normalizeGeneratedObjectDefinition(value, kind, appearance) {
  const source = value && typeof value === "object" ? value : {};
  if (kind === "light") {
    const type = normalizedString(source.type || source.lightType).toLowerCase();
    return {
      kind,
      type: new Set(["point", "spot", "directional", "ambient", "hemisphere"]).has(type) ? type : "point",
      color: normalizedColor(source.color, normalizedColor(appearance.color, "#ffffff")),
      groundColor: normalizedColor(source.groundColor, "#202040"),
      intensity: nonNegativeNumber(source.intensity, 1),
      distance: nonNegativeNumber(source.distance, 0),
      decay: nonNegativeNumber(source.decay, 2),
      angle: clampedNumber(source.angle, Math.PI / 3, 0, Math.PI / 2),
      penumbra: clampedNumber(source.penumbra, 0, 0, 1),
      visualSource: source.visualSource !== false,
      visualRadiusMeters: positiveNumber(source.visualRadiusMeters, 0.06),
    };
  }
  if (kind === "particle-emitter") {
    return {
      kind,
      shape: new Set(["point", "sphere", "box", "cone", "ring"]).has(source.shape) ? source.shape : "point",
      rate: nonNegativeNumber(source.rate ?? source.particlesPerSecond, 12),
      lifetimeSeconds: positiveNumber(source.lifetimeSeconds, 2),
      sizeMeters: positiveNumber(source.sizeMeters || source.particleSizeMeters, 0.03),
      initialVelocityMetersPerSecond: finiteVector3(source.initialVelocityMetersPerSecond || source.velocity, [0, 0.25, 0]),
      spreadMetersPerSecond: finiteScale3(source.spreadMetersPerSecond || source.spread, [0.15, 0.15, 0.15]),
      gravityMetersPerSecondSquared: finiteVector3(source.gravityMetersPerSecondSquared, [0, 0, 0]),
      color: normalizedColor(source.color, normalizedColor(appearance.color, "#ffffff")),
      endColor: normalizedColor(source.endColor, normalizedColor(source.color, "#ffffff")),
      opacity: clampedNumber(source.opacity ?? appearance.opacity, 1, 0, 1),
    };
  }
  const shape = normalizedString(source.shape || source.primitive).toLowerCase();
  return {
    kind: "primitive",
    shape: new Set(["sphere", "box", "plane", "circle", "ring", "cone", "cylinder", "torus"]).has(shape) ? shape : "sphere",
    dimensionsMeters: finiteScale3(source.dimensionsMeters || source.dimensions || source.sizeMeters || source.size, [0.2, 0.2, 0.2]),
    innerRadiusRatio: clampedNumber(source.innerRadiusRatio, 0.65, 0, 1),
    segments: positiveIntegerOrNull(source.segments),
    material: source.material && typeof source.material === "object" ? { ...source.material } : {},
  };
}

function uniqueGeneratedObjects(objects) {
  const seen = new Set();
  return objects.filter((object) => {
    if (!object.id || seen.has(object.id)) return false;
    seen.add(object.id);
    return true;
  });
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
  if (kind === "stationary") return { ...source, kind };
  if (kind === "keyframe-path") {
    const keyframes = normalizePathKeyframes(source.keyframes || source.points);
    return {
      ...source,
      kind,
      keyframes,
      durationSeconds: positiveNumber(source.durationSeconds, keyframes.at(-1)?.timeSeconds || 8),
      loopMode: normalizedLoopMode(source.loopMode || source.loop, "repeat"),
      interpolation: normalizedInterpolation(source.interpolation, "catmull-rom"),
      phase: source.phase ?? 0,
    };
  }
  if (kind === "waypoint-loop") {
    return {
      ...source,
      kind,
      waypoints: normalizeWaypoints(source.waypoints || source.points),
      durationSeconds: finiteRange(source.durationSeconds, [8, 12], 0.001, 1e9),
      direction: normalizedDirection(source.direction),
      phase: source.phase ?? "staggered",
      closed: source.closed !== false,
      loopMode: normalizedLoopMode(source.loopMode || source.loop, source.closed === false ? "once" : "repeat"),
      interpolation: normalizedInterpolation(source.interpolation, "linear"),
    };
  }
  const radius = finiteRange(source.radiusMeters ?? source.radius, [2.4, 3.8], 0, 1e6);
  return {
    ...source,
    kind: "school-orbit",
    radiusMeters: radius,
    radiusXMeters: finiteRange(source.radiusXMeters, radius, 0, 1e6),
    radiusZMeters: finiteRange(source.radiusZMeters, radius, 0, 1e6),
    heightMeters: finiteRange(
      source.heightMeters ?? source.verticalOffsetMeters,
      [-0.55, 0.55],
      -1e6,
      1e6,
    ),
    angularSpeedRadiansPerSecond: finiteRange(
      source.angularSpeedRadiansPerSecond ?? source.angularSpeed,
      [0.12, 0.26],
      0.001,
      1e6,
    ),
    direction: normalizedDirection(source.direction),
    phase: source.phase ?? "staggered",
    verticalSwayMeters: finiteRange(source.verticalSwayMeters, [0.08, 0.28], 0, 1e6),
    verticalSwayFrequencyHz: finiteRange(source.verticalSwayFrequencyHz, [0.08, 0.18], 0, 1e6),
  };
}

function normalizeTimeline(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tracks = (Array.isArray(value.tracks) ? value.tracks : [])
    .map(normalizeTimelineTrack)
    .filter(Boolean);
  if (!tracks.length) return null;
  const inferredDuration = tracks.reduce((maximum, track) => Math.max(
    maximum,
    track.keyframes.at(-1)?.timeSeconds || 0,
  ), 0);
  return {
    durationSeconds: positiveNumber(value.durationSeconds, inferredDuration || 1),
    delaySeconds: nonNegativeNumber(value.delaySeconds, 0),
    playbackRate: positiveNumber(value.playbackRate || value.timeScale, 1),
    loopMode: normalizedLoopMode(value.loopMode || value.loop, "repeat"),
    phase: clamp01(value.phase),
    tracks,
  };
}

function normalizeTimelineTrack(value) {
  if (!value || typeof value !== "object") return null;
  const property = normalizedTrackProperty(value.property || value.path);
  if (!TRACK_PROPERTIES.has(property)) return null;
  const keyframes = (Array.isArray(value.keyframes) ? value.keyframes : [])
    .map((keyframe, index) => normalizeTimelineKeyframe(keyframe, property, index))
    .filter(Boolean)
    .sort((left, right) => left.timeSeconds - right.timeSeconds);
  const deduplicated = [];
  for (const keyframe of keyframes) {
    if (deduplicated.at(-1)?.timeSeconds === keyframe.timeSeconds) deduplicated[deduplicated.length - 1] = keyframe;
    else deduplicated.push(keyframe);
  }
  if (!deduplicated.length) return null;
  return {
    property,
    interpolation: normalizedInterpolation(value.interpolation, property === "appearance.visible" ? "step" : "linear"),
    keyframes: deduplicated,
  };
}

function normalizeTimelineKeyframe(value, property, index) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { value, timeSeconds: index };
  const normalizedValue = normalizedTrackValue(property, source.value ?? source.to);
  if (normalizedValue === null) return null;
  return {
    timeSeconds: nonNegativeNumber(source.timeSeconds ?? source.time, index),
    value: normalizedValue,
    easing: normalizedEasing(source.easing || source.ease),
  };
}

function normalizedTrackValue(property, value) {
  if (property === "transform.position" || property === "transform.rotationEulerDegrees") {
    return finiteVector3(value, null);
  }
  if (property === "transform.quaternion") return finiteQuaternion(value);
  if (property === "transform.scale") return finiteScale3(value, null);
  if (property === "appearance.color" || property === "appearance.emissiveColor") {
    return normalizedColor(value, null);
  }
  if (property === "appearance.visible") return Boolean(value);
  if (property === "appearance.opacity") return clampedNumber(value, 1, 0, 1);
  if (property === "appearance.brightness") return clampedNumber(value, 1, 0, 4);
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
}

function normalizePathKeyframes(value) {
  return planList(value).map((item, index) => {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : { position: item };
    const position = finiteVector3(source.position || source.value || item, null);
    if (!position) return null;
    return {
      timeSeconds: nonNegativeNumber(source.timeSeconds ?? source.time, index),
      position,
      easing: normalizedEasing(source.easing),
    };
  }).filter(Boolean).sort((left, right) => left.timeSeconds - right.timeSeconds);
}

function expandTrajectory(trajectory, count, index, random, comfort) {
  if (trajectory.kind === "stationary") return { ...trajectory };
  if (trajectory.kind === "keyframe-path") {
    const phase = expandedUnitPhase(trajectory.phase, count, index, random);
    const pathLength = keyframePathLength(trajectory.keyframes, trajectory.loopMode !== "once");
    const minimumDuration = pathLength / Math.max(comfort.maximumSpeedMetersPerSecond, 0.001);
    return {
      ...trajectory,
      durationSeconds: Math.max(positiveNumber(trajectory.durationSeconds, 8), minimumDuration),
      phase,
    };
  }
  const direction = expandedDirection(trajectory.direction, index, random);
  if (trajectory.kind === "waypoint-loop") {
    const phase = expandedUnitPhase(trajectory.phase, count, index, random);
    const minimumDuration = waypointPathLength(trajectory.waypoints, trajectory.closed !== false)
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

function expandTimeline(timeline, count, index, random) {
  if (!timeline) return null;
  return {
    ...timeline,
    phase: Number.isFinite(Number(timeline.phase))
      ? positiveModulo(Number(timeline.phase), 1)
      : expandedUnitPhase(timeline.phase, count, index, random),
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
  const closed = trajectory.closed !== false;
  const segmentCount = closed ? waypoints.length : waypoints.length - 1;
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const point = waypoints[index];
    const next = waypoints[(index + 1) % waypoints.length];
    return {
      index,
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
  const progress = playbackProgress(
    elapsed,
    durationSeconds,
    trajectory.loopMode || (closed ? "repeat" : "once"),
    phase,
    direction,
  );
  const targetDistance = progress * totalLength;
  let traversed = 0;
  for (const segment of segments) {
    const end = traversed + segment.length;
    if (targetDistance <= end) {
      const rawLocalProgress = clamp01((targetDistance - traversed) / segment.length);
      const localProgress = applyInterpolationProgress(rawLocalProgress, trajectory.interpolation);
      const position = trajectory.interpolation === "catmull-rom"
        ? catmullRomVector(
          waypointAt(waypoints, segment.index - 1, closed),
          segment.from,
          segment.to,
          waypointAt(waypoints, segment.index + 2, closed),
          localProgress,
        )
        : vectorLerp(segment.from, segment.to, localProgress);
      return {
        position,
        tangent: direction > 0
          ? sampledPathTangent(waypoints, segment.index, localProgress, closed, trajectory.interpolation)
          : vectorScale(sampledPathTangent(waypoints, segment.index, localProgress, closed, trajectory.interpolation), -1),
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

function sampleKeyframePath(trajectory, elapsed) {
  const keyframes = normalizePathKeyframes(trajectory.keyframes);
  if (!keyframes.length) return { position: [0, 0, 0], tangent: [0, 0, 1], progress: 0 };
  if (keyframes.length === 1) return { position: [...keyframes[0].position], tangent: [0, 0, 1], progress: 0 };
  const durationSeconds = positiveNumber(trajectory.durationSeconds, keyframes.at(-1).timeSeconds || 1);
  const progress = playbackProgress(elapsed, durationSeconds, trajectory.loopMode, trajectory.phase, 1);
  const localTime = progress * durationSeconds;
  const track = {
    property: "transform.position",
    interpolation: trajectory.interpolation,
    keyframes: keyframes.map((keyframe) => ({
      timeSeconds: keyframe.timeSeconds,
      value: keyframe.position,
      easing: keyframe.easing,
    })),
  };
  const position = sampleTimelineTrack(track, localTime);
  const epsilon = Math.max(0.001, durationSeconds / 10000);
  const previous = sampleTimelineTrack(track, Math.max(0, localTime - epsilon));
  const next = sampleTimelineTrack(track, Math.min(durationSeconds, localTime + epsilon));
  return {
    position: finiteVector3(position, keyframes[0].position),
    tangent: vectorSubtract(finiteVector3(next, position), finiteVector3(previous, position)),
    progress,
  };
}

function sampleTimeline(timeline, elapsed) {
  if (!timeline?.tracks?.length) return { active: false, progress: 0, properties: {} };
  const durationSeconds = positiveNumber(timeline.durationSeconds, 1);
  const delaySeconds = nonNegativeNumber(timeline.delaySeconds, 0);
  const playbackRate = positiveNumber(timeline.playbackRate, 1);
  const adjustedElapsed = Math.max(0, elapsed - delaySeconds) * playbackRate;
  const progress = playbackProgress(adjustedElapsed, durationSeconds, timeline.loopMode, timeline.phase, 1);
  const localTime = progress * durationSeconds;
  const properties = {};
  for (const track of timeline.tracks) {
    properties[track.property] = sampleTimelineTrack(track, localTime);
  }
  return { active: elapsed >= delaySeconds, progress, localTime, properties };
}

function sampleTimelineTrack(track, localTime) {
  const keyframes = track?.keyframes || [];
  if (!keyframes.length) return undefined;
  if (keyframes.length === 1 || localTime <= keyframes[0].timeSeconds) return cloneTrackValue(keyframes[0].value);
  if (localTime >= keyframes.at(-1).timeSeconds) return cloneTrackValue(keyframes.at(-1).value);
  let upperIndex = keyframes.findIndex((keyframe) => keyframe.timeSeconds >= localTime);
  if (upperIndex <= 0) upperIndex = 1;
  const left = keyframes[upperIndex - 1];
  const right = keyframes[upperIndex];
  const span = Math.max(1e-9, right.timeSeconds - left.timeSeconds);
  const rawProgress = clamp01((localTime - left.timeSeconds) / span);
  const eased = applyEasing(rawProgress, right.easing || left.easing);
  const interpolation = track.interpolation || "linear";
  if (interpolation === "step" || typeof left.value === "boolean" || typeof left.value === "string") {
    if (typeof left.value === "string" && isHexColor(left.value) && isHexColor(right.value) && interpolation !== "step") {
      return interpolateColor(left.value, right.value, eased);
    }
    return cloneTrackValue(eased < 1 ? left.value : right.value);
  }
  const progress = applyInterpolationProgress(eased, interpolation);
  if (interpolation === "catmull-rom" && Array.isArray(left.value) && left.value.length === 3) {
    const previous = keyframes[Math.max(0, upperIndex - 2)].value;
    const next = keyframes[Math.min(keyframes.length - 1, upperIndex + 1)].value;
    return catmullRomVector(previous, left.value, right.value, next, progress);
  }
  return interpolateTrackValue(left.value, right.value, progress, track.property);
}

function timelinePositionTangent(timeline, elapsed) {
  if (!timeline) return [0, 0, 1];
  const duration = positiveNumber(timeline.durationSeconds, 1);
  const epsilon = Math.max(0.001, duration / 10000);
  const before = sampleTimeline(timeline, Math.max(0, elapsed - epsilon)).properties["transform.position"];
  const after = sampleTimeline(timeline, elapsed + epsilon).properties["transform.position"];
  return before && after ? vectorSubtract(after, before) : [0, 0, 1];
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

function finiteQuaternion(value) {
  const quaternion = finiteVectorN(value, 4);
  if (!quaternion) return undefined;
  const length = Math.hypot(...quaternion);
  return length > 1e-9 ? quaternion.map((component) => component / length) : undefined;
}

function quaternionFromEulerDegrees(value) {
  const euler = finiteVector3(value, null);
  if (!euler) return undefined;
  const [x, y, z] = euler.map((degrees) => degrees * Math.PI / 360);
  const [sx, sy, sz] = [Math.sin(x), Math.sin(y), Math.sin(z)];
  const [cx, cy, cz] = [Math.cos(x), Math.cos(y), Math.cos(z)];
  return finiteQuaternion([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
}

function multiplyQuaternions(left, right) {
  const [lx, ly, lz, lw] = finiteQuaternion(left) || [0, 0, 0, 1];
  const [rx, ry, rz, rw] = finiteQuaternion(right) || [0, 0, 0, 1];
  return finiteQuaternion([
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ]) || [0, 0, 0, 1];
}

function finiteScale3(value, fallback) {
  if (Number.isFinite(Number(value)) && value !== "") {
    const scalar = Number(value);
    return [scalar, scalar, scalar];
  }
  return finiteVector3(value, fallback);
}

function finiteVectorN(value, length) {
  if (!Array.isArray(value) || value.length < length) return null;
  const vector = value.slice(0, length).map(Number);
  return vector.every(Number.isFinite) ? vector : null;
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
  if (text === "stationary" || text === "none" || text === "static") return "stationary";
  if (text.includes("keyframe") || text === "timeline" || text === "custom-path") return "keyframe-path";
  return text.includes("waypoint") ? "waypoint-loop" : "school-orbit";
}

function normalizedLoopMode(value, fallback = "repeat") {
  const text = normalizedString(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (value === false || text === "none" || text === "hold") return "once";
  if (text === "pingpong") return "ping-pong";
  return new Set(["once", "repeat", "ping-pong"]).has(text) ? text : fallback;
}

function normalizedInterpolation(value, fallback = "linear") {
  const text = normalizedString(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (text === "spline" || text === "curve" || text === "catmullrom") return "catmull-rom";
  return new Set(["step", "linear", "smooth", "catmull-rom"]).has(text) ? text : fallback;
}

function normalizedEasing(value) {
  const text = normalizedString(value || "linear").toLowerCase().replace(/[\s_]+/g, "-");
  return new Set(["linear", "ease-in", "ease-out", "ease-in-out", "smoothstep", "smootherstep"]).has(text)
    ? text
    : "linear";
}

function normalizedTrackProperty(value) {
  const text = normalizedString(value).toLowerCase();
  return ({
    position: "transform.position",
    "transform.position": "transform.position",
    rotation: "transform.rotationEulerDegrees",
    rotationeulerdegrees: "transform.rotationEulerDegrees",
    "transform.rotation": "transform.rotationEulerDegrees",
    "transform.rotationeulerdegrees": "transform.rotationEulerDegrees",
    quaternion: "transform.quaternion",
    "transform.quaternion": "transform.quaternion",
    scale: "transform.scale",
    "transform.scale": "transform.scale",
    opacity: "appearance.opacity",
    "material.opacity": "appearance.opacity",
    "appearance.opacity": "appearance.opacity",
    color: "appearance.color",
    "material.color": "appearance.color",
    "appearance.color": "appearance.color",
    brightness: "appearance.brightness",
    "material.brightness": "appearance.brightness",
    "appearance.brightness": "appearance.brightness",
    highlight: "appearance.brightness",
    highlightintensity: "appearance.brightness",
    "appearance.highlightintensity": "appearance.brightness",
    emissivecolor: "appearance.emissiveColor",
    "material.emissivecolor": "appearance.emissiveColor",
    "appearance.emissivecolor": "appearance.emissiveColor",
    emissiveintensity: "appearance.emissiveIntensity",
    "material.emissiveintensity": "appearance.emissiveIntensity",
    "appearance.emissiveintensity": "appearance.emissiveIntensity",
    visible: "appearance.visible",
    visibility: "appearance.visible",
    "appearance.visible": "appearance.visible",
    intensity: "light.intensity",
    "light.intensity": "light.intensity",
    "light.distance": "light.distance",
    "light.angle": "light.angle",
    "particle.rate": "particle.rate",
    "particle.size": "particle.size",
  })[text] || "";
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

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function finiteOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizedColor(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    const components = value.slice(0, 3).map(Number);
    if (components.every(Number.isFinite)) {
      const divisor = components.some((component) => component > 1) ? 255 : 1;
      return `#${components.map((component) => (
        Math.round(Math.max(0, Math.min(1, component / divisor)) * 255).toString(16).padStart(2, "0")
      )).join("")}`;
    }
  }
  const text = normalizedString(value).toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((item) => item.repeat(2)).join("")}`;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  return fallback;
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

function waypointPathLength(waypoints, closed = true) {
  const points = normalizeWaypoints(waypoints);
  if (points.length < 2) return 0;
  const segmentCount = closed ? points.length : points.length - 1;
  return Array.from({ length: segmentCount }, (_, index) => (
    vectorDistance(points[index], points[(index + 1) % points.length])
  )).reduce((sum, length) => sum + length, 0);
}

function keyframePathLength(keyframes, closed = false) {
  return waypointPathLength((keyframes || []).map((keyframe) => keyframe.position), closed);
}

function vectorSubtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function vectorScale(value, scalar) {
  return value.map((item) => item * scalar);
}

function vectorLerp(left, right, progress) {
  return [
    left[0] + (right[0] - left[0]) * progress,
    left[1] + (right[1] - left[1]) * progress,
    left[2] + (right[2] - left[2]) * progress,
  ];
}

function playbackProgress(elapsed, duration, loopMode = "repeat", phase = 0, direction = 1) {
  const raw = finiteNumber(phase, 0) + (direction < 0 ? -1 : 1) * (finiteNumber(elapsed, 0) / Math.max(0.001, duration));
  if (normalizedLoopMode(loopMode) === "once") return clamp01(raw);
  if (normalizedLoopMode(loopMode) === "ping-pong") {
    const cycle = positiveModulo(raw, 2);
    return cycle <= 1 ? cycle : 2 - cycle;
  }
  return positiveModulo(raw, 1);
}

function applyInterpolationProgress(progress, interpolation) {
  const value = clamp01(progress);
  if (interpolation === "step") return value < 1 ? 0 : 1;
  if (interpolation === "smooth" || interpolation === "catmull-rom") return value * value * (3 - 2 * value);
  return value;
}

function applyEasing(progress, easing) {
  const value = clamp01(progress);
  if (easing === "ease-in") return value * value;
  if (easing === "ease-out") return 1 - (1 - value) * (1 - value);
  if (easing === "ease-in-out") return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
  if (easing === "smoothstep") return value * value * (3 - 2 * value);
  if (easing === "smootherstep") return value ** 3 * (value * (value * 6 - 15) + 10);
  return value;
}

function waypointAt(points, index, closed) {
  if (closed) return points[positiveModulo(index, points.length)];
  return points[Math.max(0, Math.min(points.length - 1, index))];
}

function sampledPathTangent(points, segmentIndex, progress, closed, interpolation) {
  if (interpolation !== "catmull-rom") {
    return vectorSubtract(
      waypointAt(points, segmentIndex + 1, closed),
      waypointAt(points, segmentIndex, closed),
    );
  }
  const epsilon = 0.001;
  const before = catmullRomVector(
    waypointAt(points, segmentIndex - 1, closed),
    waypointAt(points, segmentIndex, closed),
    waypointAt(points, segmentIndex + 1, closed),
    waypointAt(points, segmentIndex + 2, closed),
    Math.max(0, progress - epsilon),
  );
  const after = catmullRomVector(
    waypointAt(points, segmentIndex - 1, closed),
    waypointAt(points, segmentIndex, closed),
    waypointAt(points, segmentIndex + 1, closed),
    waypointAt(points, segmentIndex + 2, closed),
    Math.min(1, progress + epsilon),
  );
  return vectorSubtract(after, before);
}

function catmullRomVector(p0, p1, p2, p3, progress) {
  const t = clamp01(progress);
  const t2 = t * t;
  const t3 = t2 * t;
  return p1.map((_, index) => 0.5 * (
    (2 * p1[index])
    + (-p0[index] + p2[index]) * t
    + (2 * p0[index] - 5 * p1[index] + 4 * p2[index] - p3[index]) * t2
    + (-p0[index] + 3 * p1[index] - 3 * p2[index] + p3[index]) * t3
  ));
}

function interpolateTrackValue(left, right, progress, property) {
  if (Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return Number(left) + (Number(right) - Number(left)) * progress;
  }
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
    const value = left.map((item, index) => Number(item) + (Number(right[index]) - Number(item)) * progress);
    if (property === "transform.quaternion") {
      const length = Math.hypot(...value);
      return length > 1e-9 ? value.map((component) => component / length) : [0, 0, 0, 1];
    }
    return value;
  }
  if (isHexColor(left) && isHexColor(right)) return interpolateColor(left, right, progress);
  return cloneTrackValue(progress < 1 ? left : right);
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function interpolateColor(left, right, progress) {
  const channels = (color) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const from = channels(left);
  const to = channels(right);
  return `#${from.map((channel, index) => (
    Math.round(channel + (to[index] - channel) * progress).toString(16).padStart(2, "0")
  )).join("")}`;
}

function cloneTrackValue(value) {
  return Array.isArray(value) ? [...value] : value;
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
