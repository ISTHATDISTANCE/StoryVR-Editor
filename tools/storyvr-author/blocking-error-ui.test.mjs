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

test("initial state failures replace the endless loading screen with concise recovery guidance", () => {
  const render = sourceFunction("render");
  const errorPanel = sourceFunction("renderInitialLoadError");
  const guidance = sourceFunction("initialLoadErrorGuidance");
  const retry = sourceFunction("bindInitialLoadErrorEvents");

  assert.match(render, /state\.output\?\.error/);
  assert.match(render, /renderInitialLoadError\(loadError\)/);
  assert.match(render, /bindInitialLoadErrorEvents\(\)/);
  assert.match(errorPanel, /role="alert"/);
  assert.match(errorPanel, /StoryVR could not load this story/);
  assert.match(errorPanel, /data-retry-initial-load/);
  assert.match(errorPanel, /study facilitator/);
  assert.doesNotMatch(errorPanel, /\$\{error\}|escapeHtml\(error\)/,
    "raw server and parser details are not dumped into the participant-facing error");
  assert.match(guidance, /authoring server is not responding/);
  assert.match(guidance, /captures\/active folder/);
  assert.match(guidance, /could not read one of this project's saved files/);
  assert.match(retry, /state\.output = null/);
  assert.match(retry, /load\(\)/);
  assert.match(styles, /\.boot-blocking-error\s*\{[^}]*border:\s*2px solid/s);
});

test("blocked stages open a safe, prominent page naming the earliest stage and exact save action", () => {
  const render = sourceFunction("render");
  const flowButton = sourceFunction("renderFlowButton");
  const dependency = sourceFunction("checkpointBlockingDependency");
  const guidance = sourceFunction("checkpointBlockingGuidance");
  const blockedPanel = sourceFunction("renderBlockedStageWorkspace");

  assert.match(render, /const activeBlocked = [^;]+checkpointFlowStatus\(active\.id\) === "blocked"/);
  assert.match(render, /activeBlocked[\s\S]*renderBlockedStageWorkspace\(active\)/);
  assert.match(render, /if \(!activeBlocked\) \{[\s\S]*initializeFinalReviewViewer\(active\)/,
    "unsafe stage-specific viewers are not initialized behind the blocking page");
  assert.match(flowButton, /checkpointBlockingGuidance\(component\.id\)/);
  assert.match(flowButton, /Open for details/);
  assert.doesNotMatch(flowButton, /\bdisabled\b/,
    "a blocked flow step remains openable so its reason is available");
  assert.doesNotMatch(dependency, /\.reverse\(\)/,
    "the guidance points to the earliest actionable prerequisite, not the last blocked stage");
  assert.match(dependency, /earlier\.find/);
  assert.match(dependency, /checkpointHasLocalDraft\(component\.id\)/);
  assert.match(guidance, /checkpointSaveActionLabel\(dependency\.id\)/);
  assert.match(guidance, /review what needs attention, then select/);
  assert.match(blockedPanel, /role="alert"/);
  assert.match(blockedPanel, /data-select-component="\$\{escapeHtml\(blocking\.componentId\)\}"/);
  assert.match(blockedPanel, /will open after that earlier step is finished/);
  assert.match(styles, /\.flow-step\.blocked\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px/s);
  assert.match(styles, /\.blocking-stage-panel\s*\{[^}]*border:\s*2px solid/s);
});

test("a disabled compiler control names the exact stage that must be saved", () => {
  const preview = sourceFunction("renderPreviewQa");
  const guidance = sourceFunction("compileBlockingGuidance");
  const notice = sourceFunction("renderCompileBlockingNotice");

  assert.match(preview, /const blocking = canCompile \? null : compileBlockingGuidance\(\)/);
  assert.match(preview, /renderCompileBlockingNotice\(blocking\)/);
  assert.match(preview, /data-action="compile" \$\{canCompile && !state\.busy \? "" : "disabled"\}/);
  assert.match(guidance, /componentId: "source-graph"/);
  assert.match(guidance, /checkpointComponents\(\)\.find/);
  assert.match(guidance, /checkpointSaveActionLabel\(component\.id\)/);
  assert.match(guidance, /participantComponentLabel\(component\.id, component\.label\)/);
  assert.match(guidance, /Finish \$\{label\} before building the reader/);
  assert.match(notice, /role="alert"/);
  assert.match(notice, /data-compile-blocked/);
  assert.match(notice, /data-select-component="\$\{escapeHtml\(blocking\.componentId\)\}"/);
  assert.match(styles, /\.blocking-control-notice\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
});
