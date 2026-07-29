import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

function sourceFunction(name, text = source) {
  const plain = text.indexOf(`function ${name}(`);
  const asyncStart = text.indexOf(`async function ${name}(`);
  const start = plain === -1 ? asyncStart : asyncStart === -1 ? plain : Math.min(plain, asyncStart);
  assert.notEqual(start, -1, `${name} exists`);
  const nextPlain = text.indexOf("\nfunction ", start + 1);
  const nextAsync = text.indexOf("\nasync function ", start + 1);
  const candidates = [nextPlain, nextAsync].filter((value) => value !== -1);
  const end = candidates.length ? Math.min(...candidates) : text.length;
  return text.slice(start, end);
}

test("signed-out participants see one short sign-in request while technical details stay collapsed", () => {
  const auth = sourceFunction("renderCodexAuth");
  const defaultView = auth.slice(auth.indexOf("return `"), auth.indexOf('<details class="facilitator-details">'));
  const facilitatorView = auth.slice(auth.indexOf('<details class="facilitator-details">'));

  assert.match(defaultView, /Sign in to continue/);
  assert.match(defaultView, /Sign in before asking StoryVR to make or refresh suggestions/);
  assert.match(defaultView, /Sign-in did not finish\. Ask the study facilitator for help/);
  assert.doesNotMatch(defaultView, /\btoken\b|\bCLI\b|command-line|codex exec|authMethod|authText|terminal/i);
  assert.match(facilitatorView, /Sign-in details for the facilitator/);
  assert.match(facilitatorView, /Authentication method/);
  assert.match(facilitatorView, /does not receive the token/);
  assert.match(facilitatorView, /codex login --device-auth/);
  assert.match(facilitatorView, /class="terminal"/);
  assert.match(styles, /\.facilitator-details\s*\{/);
});

test("the default Story order view uses card and choice language without changing graph contracts", () => {
  const timeline = sourceFunction("renderBeatTimeline");
  const progressRange = sourceFunction("sourceGraphProgressRangeLabel");
  const progressButton = sourceFunction("sourceGraphProgressButtonLabel");
  const fullText = sourceFunction("renderSourceGraphFullTextDetail");
  const alternatives = sourceFunction("renderSourceGraphVariantAlternatives");
  const insertSlot = sourceFunction("renderSourceGraphVariantInsertSlot");
  const atlas = sourceFunction("renderAssetAtlas");
  const advanced = sourceFunction("renderAdvancedGraphEditor");

  assert.match(timeline, /\$\{beats\.length\} card/);
  assert.match(timeline, /with visuals/);
  assert.match(timeline, /text card/);
  assert.match(timeline, /Release to remove card/);
  assert.match(timeline, /aria-label="Story order canvas"/);
  assert.doesNotMatch(timeline, /authored ·|fine-grained|text-only|aria-label="Beat |Release to remove beat/);
  assert.match(progressRange, /Card \$\{start\}|Cards \$\{start\}/);
  assert.match(progressButton, /`card \$\{start\}`|`cards \$\{start\} through \$\{end\}`/);
  assert.match(fullText, /Choice · Card/);
  assert.match(fullText, /Full card text/);
  assert.match(alternatives, /choice for/);
  assert.match(alternatives, /Drag to reorder this choice/);
  assert.match(insertSlot, /Drop as choice/);
  assert.match(atlas, /onto a card or choice/);
  assert.match(advanced, /Facilitator tools/);
  assert.doesNotMatch(advanced, />[^<]*Advanced JSON/);

  assert.match(timeline, /data-source-graph-variant-group=/);
  assert.match(timeline, /data-source-graph-variant-option=/);
  assert.match(alternatives, /data-source-graph-variant-card/);
  assert.match(sourceFunction("renderSourceGraphLinkLayer"), /sourceGraphTransitionEdges/);
});

test("default story canvases count story parts without exposing beat jargon", () => {
  for (const name of [
    "renderDynamicStoryCanvas",
    "renderInterBeatStoryCanvas",
    "renderEnvironmentStoryCanvas",
    "renderSpatialStoryCanvas",
    "renderAttentionStoryCanvas",
    "renderInteractionStoryCanvas",
  ]) {
    const canvas = sourceFunction(name);
    assert.match(canvas, /\$\{beats\.length\} story part/);
    assert.doesNotMatch(canvas, /\$\{beats\.length\} authored beat/);
  }
});

test("blocking stage errors show a plain alert, exact available location, and recovery", () => {
  const notice = sourceFunction("renderStageErrorNotice");
  const location = sourceFunction("stageErrorLocation");
  const recovery = sourceFunction("stageErrorRecovery");
  const participantMessage = sourceFunction("participantStageErrorMessage");
  const initialError = sourceFunction("renderInitialLoadError");

  assert.match(notice, /role="alert"/);
  assert.match(notice, /Needs attention/);
  assert.match(notice, /blocking-error-location/);
  assert.match(notice, /<strong>Where:<\/strong>/);
  assert.match(notice, /<strong>Next:<\/strong>/);
  assert.match(location, /diagnostic\?\.beatId/);
  assert.match(location, /activeStageSceneContext/);
  assert.match(location, /selectedBeat\(\)/);
  assert.match(location, /diagnostic\?\.field/);
  assert.match(location, /diagnostic\?\.path/);
  assert.match(location, /relativeProjectFileFromError/);
  assert.match(recovery, /Save story order/);
  assert.match(recovery, /Save scene and return/);
  assert.match(recovery, /Build reader/);
  assert.match(participantMessage, /StoryVR could not complete this action/);
  assert.doesNotMatch(notice, /escapeHtml\(output\.error\)/);
  assert.match(initialError, /relativeProjectFileFromError\(error\)/);
  assert.doesNotMatch(initialError, /escapeHtml\(error\)/);

  for (const name of [
    "renderSourceGraphStatus",
    "renderDynamicGeometryStatus",
    "renderInterBeatDynamicsStatus",
    "renderSpatialStatus",
    "renderAttentionGuidanceStatus",
    "renderInteractionControlStatus",
  ]) {
    assert.match(sourceFunction(name), /renderStageErrorNotice/);
  }
  assert.match(styles, /\.stage-blocking-error\s*\{[^}]*border:\s*2px solid/s);
});

test("project file locations are relative and absolute local paths are never returned", () => {
  const sanitizeSource = sourceFunction("sanitizeRelativeProjectPath");
  const extractSource = sourceFunction("relativeProjectFileFromError");
  const helpers = new Function(`
    ${sanitizeSource}
    ${extractSource}
    return { sanitizeRelativeProjectPath, relativeProjectFileFromError };
  `)();

  assert.equal(
    helpers.relativeProjectFileFromError(
      "Unexpected token in /Users/person/work/story/captures/active/project.json:12",
    ),
    "captures/active/project.json",
  );
  assert.equal(
    helpers.relativeProjectFileFromError("Missing webxr-adaptation/public/environment-assets/reef.hdr"),
    "webxr-adaptation/public/environment-assets/reef.hdr",
  );
  assert.equal(helpers.sanitizeRelativeProjectPath("/Users/person/private/project.json"), "");
  assert.equal(helpers.sanitizeRelativeProjectPath("../outside.json"), "");
  assert.equal(helpers.sanitizeRelativeProjectPath("discovery/storyvr-runtime.json"), "discovery/storyvr-runtime.json");
});
