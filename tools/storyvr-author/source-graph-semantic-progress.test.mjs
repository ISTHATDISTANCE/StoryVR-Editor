import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  sourceGraphProgressSegmentIndexForPosition,
  sourceGraphProgressStatusForBeats,
  sourceGraphProgressStructureMatches,
  sourceGraphProgressTargetScrollLeft,
} from "./app/src/source-graph-progress.js";

const mainUrl = new URL("./app/src/main.js", import.meta.url);
const stylesUrl = new URL("./app/src/styles.css", import.meta.url);

test("progress navigation computes an inset and clamped horizontal canvas target", () => {
  assert.equal(sourceGraphProgressTargetScrollLeft({
    viewportScrollLeft: 300,
    viewportClientWidth: 600,
    viewportScrollWidth: 2400,
    viewportLeft: 100,
    targetLeft: 550,
    inset: 28,
  }), 722);
  assert.equal(sourceGraphProgressTargetScrollLeft({
    viewportScrollLeft: 0,
    viewportClientWidth: 600,
    viewportScrollWidth: 2400,
    viewportLeft: 100,
    targetLeft: 110,
    inset: 28,
  }), 0);
  assert.equal(sourceGraphProgressTargetScrollLeft({
    viewportScrollLeft: 1700,
    viewportClientWidth: 600,
    viewportScrollWidth: 2400,
    viewportLeft: 100,
    targetLeft: 900,
    inset: 28,
  }), 1800);
});

test("progress navigation follows its leading reading line at exact segment boundaries", () => {
  const starts = [0, 320, 640, 960, 1280];
  assert.equal(sourceGraphProgressSegmentIndexForPosition(starts, 0), 0);
  assert.equal(sourceGraphProgressSegmentIndexForPosition(starts, 319), 0);
  assert.equal(sourceGraphProgressSegmentIndexForPosition(starts, 320), 1);
  assert.equal(sourceGraphProgressSegmentIndexForPosition(starts, 1280), 4);
  assert.equal(sourceGraphProgressSegmentIndexForPosition([0, Number.NaN, 640], 800), 2);
  assert.equal(sourceGraphProgressSegmentIndexForPosition([], 0), -1);
});

test("progress navigation becomes review-only immediately after an in-memory structural edit", () => {
  const beats = [
    { id: "beat-a", atomicBeatIds: ["atomic-a"] },
    { id: "beat-b", atomicBeatIds: ["atomic-b", "atomic-c"] },
  ];
  const navigation = {
    status: "current",
    currentGraphStructure: structuredClone(beats),
  };

  assert.equal(sourceGraphProgressStructureMatches(navigation.currentGraphStructure, beats), true);
  assert.equal(sourceGraphProgressStatusForBeats(navigation, beats), "current");
  assert.equal(sourceGraphProgressStatusForBeats(navigation, [...beats].reverse()), "needs-review");
  assert.equal(sourceGraphProgressStatusForBeats(navigation, [
    beats[0],
    { ...beats[1], atomicBeatIds: ["atomic-c", "atomic-b"] },
  ]), "needs-review");
  assert.equal(sourceGraphProgressStatusForBeats({ status: "needs-review" }, beats), "needs-review");
});

test("the semantic strip renders above one unchanged continuous beat canvas", async () => {
  const source = await readFile(mainUrl, "utf8");
  const timelineStart = source.indexOf("function renderBeatTimeline()");
  const timelineEnd = source.indexOf("function sourceGraphDefaultVariantOption", timelineStart);
  const timeline = source.slice(timelineStart, timelineEnd);
  const headIndex = timeline.indexOf('<div class="visual-card-head">');
  const progressIndex = timeline.indexOf("${progressStrip}");
  const toolbarIndex = timeline.indexOf('class="source-graph-canvas-toolbar source-graph-arrow-toolbar"');
  const viewportIndex = timeline.indexOf('id="source-graph-canvas-viewport"');

  assert.ok(headIndex >= 0 && headIndex < progressIndex);
  assert.ok(progressIndex < toolbarIndex);
  assert.ok(toolbarIndex < viewportIndex);
  assert.equal(timeline.match(/beats\.map\(/g)?.length, 1);
  assert.match(timeline, /<ol class="source-graph-canvas-track">/);
  assert.doesNotMatch(timeline, /filter\([^)]*segment|collapsedSegment|groupedSegment/);
});

test("the strip is accessible navigation with semantic colors and a visible current marker", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(source, /<nav class="source-graph-progress"[^>]*aria-label="Story sections">/);
  assert.match(source, /class="source-graph-progress-segment/);
  assert.match(source, /aria-controls="source-graph-canvas-viewport"/);
  assert.match(source, /aria-current="location"/);
  assert.match(source, /const range = start === end \? `beat \$\{start\}` : `beats \$\{start\} through \$\{end\}`;/);
  assert.match(source, /return `Jump to \$\{segment\?\.label \|\| "story section"\}, \$\{range\}`;/);
  assert.match(styles, /\.source-graph-canvas-shell\.has-story-progress\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(0, 1fr\);/s);
  assert.match(styles, /\.source-graph-progress-segment\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.source-graph-progress-segment\s*\{[^}]*min-width:\s*44px;/s);
  assert.match(styles, /\.source-graph-progress-segment\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--source-graph-progress-color\) 48%, transparent\);/s);
  assert.match(styles, /\.source-graph-progress-segment\.is-complete\s*\{[^}]*46%, transparent/);
  assert.match(styles, /\.source-graph-progress-segment\.is-upcoming\s*\{[^}]*28%, transparent[^}]*opacity:\s*1;/s);
  assert.match(styles, /\.source-graph-progress-segment\.is-current,[\s\S]*58%, transparent[^}]*box-shadow:\s*0 0 0 3px var\(--ink\);/s);
  assert.match(styles, /\.source-graph-progress-segment\.is-current::after,[\s\S]*border-top:\s*8px solid var\(--ink\);/s);
  assert.match(styles, /\.source-graph-progress-track\s*\{[^}]*overflow-x:\s*auto;[^}]*padding:\s*3px 3px 12px;/s);
  assert.match(styles, /\.source-graph-progress-legend\s*\{[^}]*repeat\(auto-fit, minmax\(128px, 1fr\)\);/s);
  assert.match(styles, /--source-graph-progress-color-1:\s*oklch\(83% 0\.035 178\);/);
  assert.match(styles, /--source-graph-progress-color-2:\s*oklch\(82% 0\.032 230\);/);
  assert.match(styles, /--source-graph-progress-color-3:\s*oklch\(85% 0\.042 100\);/);
  assert.match(styles, /--source-graph-progress-color-4:\s*oklch\(83% 0\.05 60\);/);
  assert.match(styles, /--source-graph-progress-color-5:\s*oklch\(82% 0\.035 325\);/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.source-graph-progress-legend\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
});

test("segment activation scrolls only and never changes Source Graph authoring state", async () => {
  const source = await readFile(mainUrl, "utf8");
  const bindingStart = source.indexOf("function bindSourceGraphProgressNavigation");
  const bindingEnd = source.indexOf("function sourceGraphProgressTargetCard", bindingStart);
  const binding = source.slice(bindingStart, bindingEnd);

  assert.match(binding, /viewport\.scrollTo\(\{\s*left,\s*top: viewport\.scrollTop,\s*behavior,/s);
  assert.match(binding, /targetCard\.scrollIntoView\(\{ behavior, block: "start", inline: "nearest" \}\)/);
  assert.match(binding, /prefers-reduced-motion: reduce/);
  assert.match(binding, /viewport\.scrollLeft \+ 28/);
  assert.match(binding, /window\.scrollY \+ Math\.min\(96, window\.innerHeight \* 0\.2\)/);
  assert.match(binding, /hasVerticalScrollRange[\s\S]*pageBottom >= document\.documentElement\.scrollHeight - 1/);
  assert.match(binding, /maxScrollLeft > 1 && viewport\.scrollLeft >= maxScrollLeft - 1/);
  assert.match(binding, /if \(signal\.aborted \|\| updateFrame !== null\) return/);
  assert.match(source, /sourceGraphProgressStatusForBeats\(navigation, beats\) !== "current"/);
  assert.doesNotMatch(binding, /selectedBeatId|selectedBeatIds/);
  assert.doesNotMatch(
    binding,
    /renderPreservingScroll|updateGraphDraftFromState|markGraphDirty|beginAuthorHistory|commitAuthorHistory|history\.|pushState|replaceState/,
  );
});
