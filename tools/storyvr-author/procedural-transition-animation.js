import { normalizeProceduralTransitionAnimation } from "./procedural-transitions-runtime.js";

// Shared by Author and Reader. The caller owns competing mixers and transition
// timing; this player owns only the selected clip's model property bindings.
export function createProceduralTransitionAnimationPlayer({ THREE, root, animations = [] }) {
  let mixer = null;
  let action = null;
  let selectedIndex = null;
  let duration = 0;
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
    const time = animation.startTimeSeconds + elapsed * animation.playbackRate;
    let clipTime = 0;
    if (duration > 0) {
      if (animation.loopMode === "once") clipTime = Math.min(time, duration);
      else if (animation.loopMode === "ping-pong") {
        const phase = time % (duration * 2);
        clipTime = phase <= duration ? phase : duration * 2 - phase;
      } else clipTime = time % duration;
    }
    // Setting action time directly allows backwards scrubbing and avoids loop
    // counters or frame deltas changing the result of a sampled transition.
    action.time = clipTime;
    action.enabled = true;
    mixer.update(0);
    return true;
  }

  return { sample, dispose };
}
