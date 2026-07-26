import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readerSource = await readFile(
  new URL("./reader-template/src/main.js", import.meta.url),
  "utf8",
);

function functionSource(name) {
  const start = readerSource.indexOf(`function ${name}(`);
  const nextAsyncStart = readerSource.indexOf(`async function ${name}(`);
  const actualStart = start === -1 ? nextAsyncStart : nextAsyncStart === -1 ? start : Math.min(start, nextAsyncStart);
  assert.notEqual(actualStart, -1, `${name} exists`);
  const nextPlain = readerSource.indexOf("\nfunction ", actualStart + 1);
  const nextAsync = readerSource.indexOf("\nasync function ", actualStart + 1);
  const candidates = [nextPlain, nextAsync].filter((value) => value !== -1);
  return readerSource.slice(actualStart, candidates.length ? Math.min(...candidates) : readerSource.length);
}

test("compiled reader loads scene-scoped motion plans through the shared sampler", () => {
  assert.match(readerSource, /from "\.\/procedural-dynamics-runtime\.js"/);
  assert.match(readerSource, /proceduralDynamicsPlansForScene\(runtimeProceduralDynamics/);
  assert.match(readerSource, /expandProceduralDynamicsInstances\(plan/);
  assert.match(readerSource, /sampleProceduralDynamicsTransform\(entry\.instance, localTime\)/);
});

test("procedural motion binds one-to-one to already loaded authored Spatial entities", () => {
  const show = functionSource("showProceduralDynamicsForBeat");
  const targets = functionSource("activeProceduralDynamicsModelTargets");
  const select = functionSource("proceduralDynamicsTargetForInstance");
  const bind = functionSource("bindProceduralDynamicsToAuthoredTarget");

  assert.match(show, /const targets = activeProceduralDynamicsModelTargets\(\)/);
  assert.match(show, /assignedTargetRoots = new Set\(\)/);
  assert.match(show, /proceduralDynamicsTargetForInstance\(targets, instance, assignedTargetRoots\)/);
  assert.match(show, /bindProceduralDynamicsToAuthoredTarget\(target, instance, anchorPosition\)/);
  assert.doesNotMatch(show, /loadModel|cloneSkinnedObject|frameModel/);
  assert.match(targets, /authorTransformRoot: modelAuthorTransformRoot/);
  assert.match(targets, /activeSupplementalModelEntries/);
  assert.match(select, /proceduralDynamicsTargetEntityId\(target\) === entityId/);
  assert.match(select, /return available\.length === 1 \? available\[0\] : null/,
    "legacy asset-only plans are accepted only for an unambiguous existing instance");
  assert.match(bind, /new THREE\.AnimationMixer\(target\.model\)/);
  assert.match(bind, /proceduralDynamicsClipForInstance\(instance, target\.animations\)/);
});

test("motion uses a temporary outer root and never modifies authored transform or scale", () => {
  const bind = functionSource("bindProceduralDynamicsToAuthoredTarget");
  const update = functionSource("updateProceduralDynamics");

  assert.match(bind, /const motionRoot = new THREE\.Group\(\)/);
  assert.match(bind, /insertObjectAtChildIndex\(originalParent, motionRoot, originalChildIndex\)/);
  assert.match(bind, /motionRoot\.add\(authorTransformRoot\)/);
  assert.match(bind, /authorTransformRoot,/);
  assert.doesNotMatch(bind, /authorTransformRoot\.(?:position|quaternion|scale)\./);
  assert.match(update, /entry\.wrapper\.position\.copy\(entry\.motionLocalPosition\)/);
  assert.match(update, /entry\.wrapper\.quaternion\.slerp\(entry\.localTargetQuaternion, blend\)/);
  assert.doesNotMatch(update, /\.scale\./);
  assert.doesNotMatch(readerSource, /frameProceduralDynamicsModel|targetSizeMeters/);
});

test("cleanup restores authored roots without disposing authored models", () => {
  const clear = functionSource("clearProceduralDynamics");
  const dispose = functionSource("disposeProceduralDynamicsEntry");

  assert.match(readerSource, /clearProceduralDynamics\(\);\n  if \(activeSourceAnimation\)/);
  assert.match(clear, /disposeProceduralDynamicsEntry\(entry\)/);
  assert.match(dispose, /entry\.mixer\.stopAllAction\(\)/);
  assert.match(dispose, /restoreProceduralDynamicsSourcePlayback/);
  assert.match(dispose, /entry\.wrapper\.remove\(authorTransformRoot\)/);
  assert.match(dispose, /insertObjectAtChildIndex\(entry\.originalParent, authorTransformRoot, entry\.originalChildIndex\)/);
  assert.match(dispose, /entry\.wrapper\.removeFromParent\(\)/);
  assert.doesNotMatch(dispose, /geometry\.dispose|material.*dispose|skeleton.*dispose|model\.traverse/);
});

test("legacy suppression is ignored and clip selection stays on the bound authored model", () => {
  const authoredAssetVisible = new Function(`
    ${functionSource("proceduralDynamicsAuthoredAssetVisible")}
    return proceduralDynamicsAuthoredAssetVisible;
  `)();
  assert.equal(authoredAssetVisible("source.glb", [{
    sceneComposition: { suppressedAuthoredAssetIds: ["source.glb"] },
  }]), true);

  const clips = functionSource("proceduralDynamicsClipForInstance");
  assert.match(clips, /clipSpec\.indexes/);
  assert.match(clips, /available\.find\(\(clip\) => clip\.name === requestedName\)/);
  assert.match(readerSource, /proceduralDynamicsClipForInstance\(instance, target\.animations\)/);
  assert.match(readerSource, /authoredSpatialAssetEntries\.filter\(\(entry\) => \(\s*proceduralDynamicsAuthoredAssetVisible/s);
});
