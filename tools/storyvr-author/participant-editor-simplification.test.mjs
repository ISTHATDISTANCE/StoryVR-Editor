import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

function sourceFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test("neutral-setting stories keep optional environment acquisition out of the default view", () => {
  const editor = sourceFunction("renderEnvironmentEnhancementEditorWorkspace");
  assert.match(editor, /storyProfileId\(state\.data\)/);
  assert.match(editor, /profileId === "classroom" \|\| profileId === "transmission"/);
  assert.match(editor, /Recommended for this story/);
  assert.match(editor, /<details class="facilitator-details environment-change-details">/);
  assert.match(editor, /Optional: change the neutral setting/);
  assert.match(editor, /<details class="facilitator-details environment-diagnostics">/);
  assert.ok(
    editor.indexOf("environment-change-details") < editor.indexOf("equirectangular HDRIs"),
    "advanced image acquisition remains available only after the optional details summary",
  );
});

test("Transmission explains that Object movement is unnecessary without removing motion tools", () => {
  const editor = sourceFunction("renderDynamicGeometryEditorWorkspace");
  assert.match(editor, /storyProfileId\(state\.data\) === "transmission"/);
  assert.match(editor, /needs no extra object movement here/);
  assert.match(editor, /Optional movement tools — not needed for this story/);
  assert.match(editor, /renderProceduralDynamicsAuthoring\(sceneContext, ready\)/);
  assert.match(editor, /renderSourceMotionLinkingEditor\(component\.id\)/);
});

test("advanced placement and scene-change diagnostics are collapsed but preserved", () => {
  const spatialViewport = sourceFunction("renderSpatialRelationsViewport");
  const spatialInspector = sourceFunction("renderSpatialRelationsInspector");
  const transitionEditor = sourceFunction("renderInterBeatDynamicsEditorWorkspace");
  const transitionPreview = sourceFunction("renderInterBeatPreview");

  assert.match(spatialViewport, /<summary>More placement tools<\/summary>/);
  assert.match(spatialViewport, /data-spatial-copy-model/);
  assert.match(spatialInspector, /<summary>Placement details for facilitator<\/summary>/);
  assert.match(transitionEditor, /<summary>Scene-change details for facilitator<\/summary>/);
  assert.match(transitionEditor, /<summary>Advanced: change source animation links<\/summary>/);
  assert.match(transitionPreview, /<summary>Playback details for facilitator<\/summary>/);
  assert.ok(
    transitionPreview.indexOf("Playback details for facilitator") < transitionPreview.indexOf("material contributor"),
    "technical playback evidence stays behind the facilitator summary",
  );
});

test("reader-action editors use student-facing labels and collapse tolerances", () => {
  const inBeat = sourceFunction("renderInteractionInBeatEditor");
  const targetControls = sourceFunction("renderInteractionInBeatTargetControls");
  const direct = sourceFunction("renderInteractionDirectEditor");
  const locomotion = sourceFunction("renderInteractionLocomotionEditor");

  assert.match(inBeat, /Objects readers can move/);
  assert.match(inBeat, /Edit limits/);
  assert.match(targetControls, /Allowed actions/);
  assert.match(targetControls, /Grab with one hand/);
  assert.match(targetControls, /Resize with two hands/);
  assert.match(direct, /<strong>Object goal<\/strong>/);
  assert.match(direct, /<summary>Match tolerance for facilitator<\/summary>/);
  assert.match(locomotion, /<strong>Reader destination<\/strong>/);
  assert.match(locomotion, /<summary>Arrival timing for facilitator<\/summary>/);
});

test("facilitator details are visibly compact and closed by default", () => {
  assert.match(styles, /\.facilitator-details\s*\{/);
  assert.match(styles, /\.facilitator-details > summary\s*\{/);
  assert.match(styles, /\.environment-change-details,[\s\S]*\.environment-preview-card\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.doesNotMatch(source, /<details class="facilitator-details[^"]*" open>/);
});
