import { normalizeProceduralTransitionAnimation, proceduralTransitionTrackSample } from "./procedural-transitions-runtime.js";

// Shared by Author and Reader. The caller owns competing mixers and transition
// timing; this player owns only the selected clip's model property bindings.
export function createProceduralTransitionAnimationPlayer({ THREE, root, animations = [], initialAnimation = null }) {
  let mixer = null;
  let action = null;
  let selectedIndex = null;
  let duration = 0;
  let playbackState = null;
  const clips = Array.isArray(animations) ? animations : [];
  const cameraAncestors = new Set();
  root?.traverse?.((node) => {
    if (!node.isCamera) return;
    for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
      cameraAncestors.add(ancestor);
      if (ancestor === root) break;
    }
  });

  function modelTrack(track) {
    try {
      const binding = THREE.PropertyBinding.parseTrackName(track.name);
      const target = THREE.PropertyBinding.findNode(root, binding.nodeName);
      return target && !cameraAncestors.has(target);
    } catch {
      return false;
    }
  }

  function dispose() {
    // stopAllAction restores the original values captured by PropertyMixer,
    // including morph weights, bones, and model-root transforms.
    mixer?.stopAllAction();
    if (mixer && root) mixer.uncacheRoot(root);
    mixer = null;
    action = null;
    selectedIndex = null;
    duration = 0;
    playbackState = null;
  }

  function sample(value, elapsedSeconds) {
    const animation = normalizeProceduralTransitionAnimation(value);
    const clip = animation && clips[animation.clipIndex];
    if (!root || !clip || (animation.clipName !== undefined && animation.clipName !== clip.name)) {
      dispose();
      return false;
    }
    if (selectedIndex !== animation.clipIndex || !action) {
      dispose();
      const tracks = (clip.tracks || []).filter(modelTrack);
      if (!tracks.length) return false;
      const modelClip = new THREE.AnimationClip(clip.name, clip.duration,
        tracks.map((track) => track.clone()), clip.blendMode);
      duration = Math.max(0, Number(modelClip.duration) || 0);
      mixer = new THREE.AnimationMixer(root);
      action = mixer.clipAction(modelClip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true;
      selectedIndex = animation.clipIndex;
    }
    const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    // A zero offset means continue a compatible live Dynamics clip. A supplied
    // nonzero offset deliberately selects a particular point in the clip.
    const canContinue = initialAnimation?.clipIndex === animation.clipIndex
      && animation.startTimeSeconds === 0
      && Number.isFinite(initialAnimation.timeSeconds);
    let startTime = canContinue ? Math.max(0, initialAnimation.timeSeconds) : animation.startTimeSeconds;
    if (canContinue && animation.loopMode === "ping-pong" && initialAnimation.direction === -1) {
      startTime = duration * 2 - Math.min(startTime, duration);
    }
    const time = startTime + elapsed * animation.playbackRate;
    let clipTime = 0;
    let direction = 1;
    if (duration > 0) {
      if (animation.loopMode === "once") clipTime = Math.min(time, duration);
      else if (animation.loopMode === "ping-pong") {
        const phase = time % (duration * 2);
        clipTime = phase <= duration ? phase : duration * 2 - phase;
        direction = phase < duration ? 1 : -1;
      } else clipTime = time % duration;
    }
    // Setting action time directly allows backwards scrubbing and avoids loop
    // counters or frame deltas changing the result of a sampled transition.
    action.time = clipTime;
    action.enabled = true;
    mixer.update(0);
    playbackState = { clipIndex: animation.clipIndex, timeSeconds: clipTime, direction,
      loopMode: animation.loopMode, playbackRate: animation.playbackRate };
    return true;
  }

  return { sample, dispose, getPlaybackState: () => playbackState ? { ...playbackState } : null };
}

// Generated offsets are relative to the live Dynamics pose. A brief neutral
// blend keeps a nonzero first/last authored keyframe from snapping at handoff.
function proceduralTransitionHandoffWeight({ progress, durationSeconds, role } = {}) {
  const duration = Math.max(0.001, Number(durationSeconds) || 1);
  const windowSeconds = Math.min(0.15, duration / 4);
  const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
  const distanceSeconds = (role === "from" ? normalized : role === "to" ? 1 - normalized : 1) * duration;
  const phase = Math.max(0, Math.min(1, distanceSeconds / windowSeconds));
  return phase * phase * (3 - 2 * phase);
}

export function blendProceduralTransitionHandoffTransform(values, options = {}) {
  const weight = proceduralTransitionHandoffWeight(options);
  if (weight === 1) return values;
  const blended = { ...values };
  for (const property of ["positionOffset", "rotationOffsetDegrees", "scaleMultiplier"]) {
    if (values[property] === undefined) continue;
    const neutral = property === "scaleMultiplier" ? 1 : 0;
    const blend = (value) => neutral + (Number(value) - neutral) * weight;
    blended[property] = Array.isArray(values[property]) ? values[property].map(blend) : blend(values[property]);
  }
  return blended;
}


// The offset track is expressed in the object's parent space. Using the same
// space for its head direction also works beneath rotated/scaled Dynamics roots.
export function proceduralTransitionPathTangent(action, localProgress = action?.localProgress) {
  const track = (action?.tracks || []).find((candidate) => candidate.property === "positionOffset");
  if (!track?.keyframes?.length) return null;
  const progress = Math.max(0, Math.min(1, Number(localProgress) || 0));
  const before = proceduralTransitionTrackSample(action, Math.max(0, progress - 0.001)).positionOffset;
  const after = proceduralTransitionTrackSample(action, Math.min(1, progress + 0.001)).positionOffset;
  const difference = (from, to) => Array.isArray(from) && Array.isArray(to)
    ? to.map((value, index) => value - from[index]) : null;
  const nonzero = (value) => value?.length === 3 && value.every(Number.isFinite)
    && value.reduce((sum, component) => sum + component * component, 0) > 1e-12;
  const adjacent = difference(before, after);
  if (nonzero(adjacent)) return adjacent;
  // Hold the previous travel heading on stationary/step sections; before the
  // first movement, face the first usable segment. A wholly stationary path
  // has no travel direction and must not invent a heading.
  const segments = track.keyframes.slice(1).map((frame, index) => ({
    start: track.keyframes[index].progress, end: frame.progress,
    tangent: difference(track.keyframes[index].value, frame.value),
  })).filter((segment) => nonzero(segment.tangent));
  const segment = segments.find((candidate) => candidate.start <= progress && candidate.end >= progress)
    || segments.filter((candidate) => candidate.end <= progress).at(-1)
    || segments[0];
  return segment?.tangent || null;
}

export function applyProceduralTransitionPathOrientation({
  THREE, target, action, baseQuaternion, progress, durationSeconds, role,
} = {}) {
  const orientation = action?.parameters?.orientation;
  if (orientation?.kind !== "path-tangent" || !target?.quaternion || !baseQuaternion) return false;
  const axes = { "+Z": [0, 0, 1], "-Z": [0, 0, -1], "+X": [1, 0, 0], "-X": [-1, 0, 0] };
  const axis = axes[orientation.modelForwardAxis || "+Z"];
  const tangent = proceduralTransitionPathTangent(action);
  if (!axis || !tangent) return false;
  const desiredForward = new THREE.Vector3().fromArray(tangent).normalize();
  const yawOffset = Number(orientation.yawOffsetDegrees);
  if (Number.isFinite(yawOffset) && yawOffset !== 0) {
    desiredForward.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawOffset));
  }
  const baseForward = new THREE.Vector3().fromArray(axis).applyQuaternion(baseQuaternion).normalize();
  // Swing the existing authored orientation onto the travel vector. This
  // retains its roll/twist as far as alignment permits and supports elevation.
  const desiredQuaternion = new THREE.Quaternion().setFromUnitVectors(baseForward, desiredForward)
    .multiply(baseQuaternion).normalize();
  target.quaternion.slerpQuaternions(baseQuaternion, desiredQuaternion,
    proceduralTransitionHandoffWeight({ progress, durationSeconds, role }));
  return true;
}
