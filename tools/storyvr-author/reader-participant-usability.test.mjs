import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readers = [
  ["reader template", new URL("./reader-template/", import.meta.url)],
];

function functionSource(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} in Reader source`);
  return match[0];
}

function standaloneFunction(source, name) {
  const declaration = functionSource(source, name);
  return Function(`"use strict"; ${declaration}; return ${name};`)();
}

for (const [name, root] of readers) {
  const [html, source, styles] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/main.js", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
  ]);

  test(`${name} starts at the introduction and uses participant-facing language`, () => {
    assert.match(source, /let activeIndex = 0;/);
    assert.doesNotMatch(source, /let activeIndex = firstTraversalBeatIndex\(\);/);
    assert.match(html, />Interactive story</);
    assert.match(html, /<title>[\s\S]* - Interactive Story<\/title>/);
    assert.doesNotMatch(html, /Compiled StoryVR runtime/);
    assert.match(source, /decisionRow\.replaceChildren\(\);/);
    assert.doesNotMatch(source, /loaded from compiled Spatial Relations/);
    assert.doesNotMatch(source, /Text-only beat from compiled runtime/);
    assert.doesNotMatch(source, />UI button press<\/p>/);
    assert.doesNotMatch(source, /Variant interactions assigned/);
    assert.match(source, /xrButton\.textContent = "Headset unavailable"/);
  });

  test(`${name} keeps navigation visible and separate from scrolling story text`, () => {
    assert.ok(
      html.indexOf('class="reader-content"') < html.indexOf('class="reader-actions"'),
      "scrolling content must come before the fixed action row",
    );
    assert.ok(
      html.indexOf('id="reader-guidance"') < html.indexOf('id="beat-title"'),
      "first-use guidance must appear before long story text",
    );
    assert.match(styles, /\.reader-panel\s*\{[\s\S]*?display:\s*flex;[\s\S]*?max-height:\s*calc\(100vh - 112px\);[\s\S]*?overflow:\s*hidden;/);
    assert.match(styles, /\.reader-content\s*\{[\s\S]*?overflow-y:\s*auto;/);
    assert.match(styles, /\.reader-actions\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    assert.match(source, /prevButton\.hidden = false;/);
    assert.match(source, /nextButton\.hidden = false;/);
  });

  test(`${name} exposes current-part, guidance, finish, and restart semantics`, () => {
    assert.match(html, /id="reader-guidance-text"/);
    assert.match(html, /id="story-complete"[\s\S]*?id="restart-story"/);
    assert.match(source, /button\.setAttribute\("aria-current", "step"\)/);
    assert.match(source, /aria-label="Go to part \$\{index \+ 1\}:/);
    assert.match(source, /function updateReaderGuidance\(\)/);
    assert.match(source, /function completeStory\(\)/);
    assert.match(source, /nextButton\.textContent = atEnd[\s\S]*?"Finish"/);
    assert.match(source, /restartStoryButton\?\.addEventListener\("click"/);
    assert.match(styles, /\.beat-strip button\.active\s*\{[\s\S]*?outline:\s*3px solid var\(--warm\);/);
  });

  test(`${name} keeps the full part list inside a compact, accessible picker`, () => {
    assert.match(source, /<details id="part-picker" class="part-picker">/);
    assert.match(source, /<summary id="part-picker-summary" aria-controls="part-picker-list">/);
    assert.match(source, /id="part-picker-progress">Part 1 of \$\{beats\.length\}/);
    assert.match(source, /beats\.map\(\(beat, index\) =>/);
    assert.match(source, /aria-label="Go to part \$\{index \+ 1\}:/);
    assert.match(source, /requiresPhysicalLocomotionBetween\(activeIndex, destinationIndex\)/);
    assert.match(source, /partPicker\.open = false;/);
    assert.match(source, /function updatePartPickerSummary\(completed = false\)/);
    assert.match(source, /button\.setAttribute\("aria-current", "step"\)/);
    assert.match(styles, /\.beat-strip\s*\{[\s\S]*?display:\s*block;[\s\S]*?width:\s*min\(460px,/);
    assert.match(styles, /\.part-picker-list\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto;/);
    assert.match(styles, /\.part-picker:not\(\[open\]\) \.part-picker-list\s*\{\s*display:\s*none;/);
    assert.doesNotMatch(styles, /\.beat-strip\s*\{[^}]*overflow-x:\s*auto;/);
  });

  test(`${name} uses exact story identity for concise participant guidance`, () => {
    assert.match(source, /"shark-season-attacks-survival-tips": Object\.freeze\(/);
    assert.match(source, /"reopen-schools-safety-ventilation": Object\.freeze\(/);
    assert.match(source, /"coronavirus-transmission-cough-6-feet-ar-ul": Object\.freeze\(/);
    assert.match(
      source,
      /"reopen-schools-safety-ventilation"[\s\S]*?next: "Follow how fresh air moves through the classroom\.[^"]*use A for next and X for back\."/,
    );
    assert.match(
      source,
      /"coronavirus-transmission-cough-6-feet-ar-ul"[\s\S]*?next: "Watch how cough droplets spread at different distances\.[^"]*use A for next and X for back\."/,
    );
    assert.match(source, /variant: "[^"]*In a headset, use Trigger to choose\."/);

    const resolver = functionSource(source, "resolveReaderStoryGuidanceProfile");
    assert.ok(
      resolver.indexOf("runtimeValue?.slug") < resolver.indexOf("pathSegments"),
      "exact runtime slug must be checked before the path fallback",
    );
    assert.match(resolver, /Object\.prototype\.hasOwnProperty\.call\(READER_STORY_GUIDANCE_PROFILES, runtimeSlug\)/);
    assert.match(resolver, /READER_STORY_SLUG_BY_PATH_SEGMENT/);
    assert.match(resolver, /GENERIC_READER_STORY_GUIDANCE_PROFILE/);
    assert.doesNotMatch(resolver, /title/i);
  });

  test(`${name} shows a blocking, sanitized startup alert with recovery`, () => {
    assert.match(html, /id="reader-startup-alert"[\s\S]*?role="alert"/);
    assert.match(html, /id="reader-startup-alert-location">Reader start</);
    assert.match(html, /id="reader-startup-alert-file" hidden/);
    assert.match(html, /id="reload-reader"[^>]*>Reload story</);
    assert.match(source, /showReaderStartupFailure\("runtime-data", error\);/);
    assert.match(source, /throw new Error\("Story could not start\."\);/);
    assert.match(source, /readerPanel\?\.classList\.add\("startup-failed"\)/);
    assert.match(source, /status\.classList\.add\("error"\)/);
    assert.match(source, /reloadReaderButton\?\.addEventListener\("click", \(\) => window\.location\.reload\(\)\)/);
    assert.match(styles, /\.reader-panel\.startup-failed \.reader-actions\s*\{\s*display:\s*none;/);
    assert.match(styles, /\.reader-panel\.startup-failed \.reader-panel-toggle\s*\{\s*display:\s*none;/);
    assert.match(styles, /\.runtime-status\.error\s*\{/);

    const safeLocation = standaloneFunction(source, "safeReaderRuntimeFileLocation");
    assert.equal(
      safeLocation("https://example.test/private/discovery/storyvr-runtime.json?token=do-not-show"),
      "discovery/storyvr-runtime.json",
    );
    assert.equal(safeLocation("../../<secret>?token=do-not-show"), "storyvr-runtime.json");

    const failureMessage = standaloneFunction(source, "readerStartupFailureMessage");
    assert.equal(
      failureMessage("runtime-data", new Error("private-host.example token=do-not-show")),
      "The story data file could not be loaded.",
    );
    assert.equal(
      failureMessage("runtime-data", new SyntaxError("Unexpected token: private payload")),
      "The story data file could not be read.",
    );
    assert.equal(failureMessage("reader-start"), "No story parts are available.");
  });

  test(`${name} retains the authored interaction runtime`, () => {
    assert.match(source, /configureRuntimeDirectManipulation\(\);/);
    assert.match(source, /applySpatialTraversalForBeat\(/);
    assert.match(source, /updateConfiguredControllerInteractions\(\);/);
    assert.match(source, /renderRuntimeVariantControls\(/);
  });
}
