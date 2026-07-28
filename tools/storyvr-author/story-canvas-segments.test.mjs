import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeStoryCanvasSegments,
  STORY_CANVAS_SEGMENTS_SCHEMA_VERSION,
  storyCanvasSegmentGraphSignature,
  storyCanvasSegmentGraphStructure,
} from "./story-canvas-segments.mjs";

function fixtureGraph() {
  return {
    beats: [
      { id: "beat-a", atomicBeatIds: ["atomic-a"] },
      { id: "beat-b", atomicBeatIds: ["atomic-b", "atomic-c"] },
      { id: "beat-c", atomicBeatIds: ["atomic-d"] },
      { id: "beat-d", atomicBeatIds: ["atomic-e"] },
    ],
  };
}

function fixtureConfig(graph = fixtureGraph()) {
  return {
    schemaVersion: STORY_CANVAS_SEGMENTS_SCHEMA_VERSION,
    graphSignature: storyCanvasSegmentGraphSignature(graph),
    provenance: { source: "author-approved" },
    segments: [
      { id: "opening", label: "Opening", beatIds: ["beat-a"] },
      { id: "middle", label: "Middle", beatIds: ["beat-b", "beat-c"] },
      { id: "ending", label: "Ending", beatIds: ["beat-d"] },
    ],
  };
}

test("story canvas segments normalize contiguous authored ranges without mutating graph data", () => {
  const graph = fixtureGraph();
  const config = fixtureConfig(graph);
  const graphBefore = structuredClone(graph);
  const configBefore = structuredClone(config);
  const result = normalizeStoryCanvasSegments(config, graph);

  assert.equal(result.status, "current");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.currentGraphStructure, storyCanvasSegmentGraphStructure(graph));
  assert.deepEqual(
    result.segments.map(({ id, startIndex, endIndex, beatCount }) => ({
      id,
      startIndex,
      endIndex,
      beatCount,
    })),
    [
      { id: "opening", startIndex: 0, endIndex: 0, beatCount: 1 },
      { id: "middle", startIndex: 1, endIndex: 2, beatCount: 2 },
      { id: "ending", startIndex: 3, endIndex: 3, beatCount: 1 },
    ],
  );
  assert.deepEqual(graph, graphBefore);
  assert.deepEqual(config, configBefore);
});

test("story canvas segments become review-only when the Source Graph signature changes", () => {
  const graph = fixtureGraph();
  const config = fixtureConfig(graph);
  graph.beats[1].atomicBeatIds.push("atomic-new");
  const result = normalizeStoryCanvasSegments(config, graph);

  assert.equal(result.status, "needs-review");
  assert.deepEqual(result.errors, []);
  assert.notEqual(result.graphSignature, result.currentGraphSignature);
});

test("story canvas segments reject duplicate, missing, unknown, and noncontiguous beat ranges", () => {
  const graph = fixtureGraph();
  const config = fixtureConfig(graph);
  config.segments = [
    { id: "opening", label: "Opening", beatIds: ["beat-a", "beat-c"] },
    { id: "opening", label: "Again", beatIds: ["beat-c", "unknown-beat"] },
  ];
  const result = normalizeStoryCanvasSegments(config, graph);

  assert.equal(result.status, "invalid");
  assert.ok(result.errors.some((error) => error.includes("duplicated")));
  assert.ok(result.errors.some((error) => error.includes("unknown beat")));
  assert.ok(result.errors.some((error) => error.includes("more than one segment")));
  assert.ok(result.errors.some((error) => error.includes("contiguous beat range")));
  assert.ok(result.errors.some((error) => error.includes("cover every authored beat")));
});

test("story canvas segments preserve uneven contiguous section sizes", () => {
  const graph = {
    beats: Array.from({ length: 16 }, (_, index) => ({
      id: `beat-${index + 1}`,
      atomicBeatIds: [`atomic-${index + 1}`],
    })),
  };
  const sectionSizes = [1, 2, 2, 7, 4];
  let startIndex = 0;
  const config = {
    schemaVersion: STORY_CANVAS_SEGMENTS_SCHEMA_VERSION,
    graphSignature: storyCanvasSegmentGraphSignature(graph),
    segments: sectionSizes.map((size, index) => {
      const beatIds = graph.beats
        .slice(startIndex, startIndex + size)
        .map((beat) => beat.id);
      startIndex += size;
      return {
        id: `section-${index + 1}`,
        label: `Section ${index + 1}`,
        beatIds,
      };
    }),
  };
  const result = normalizeStoryCanvasSegments(config, graph);

  assert.equal(result.status, "current");
  assert.deepEqual(result.segments.map((segment) => segment.beatCount), sectionSizes);
  assert.deepEqual(result.segments.map((segment) => [segment.startIndex + 1, segment.endIndex + 1]), [
    [1, 1],
    [2, 3],
    [4, 5],
    [6, 12],
    [13, 16],
  ]);
});

test("the author state exposes optional story canvas metadata beside the Source Graph", async () => {
  const engine = await readFile(new URL("./engine.mjs", import.meta.url), "utf8");

  assert.match(engine, /storyCanvasSegmentsPath:\s*path\.join\(analysisRoot, "story-canvas-segments\.json"\)/);
  assert.match(engine, /normalizeStoryCanvasSegments\(\s*await readJsonIfExists\(paths\.storyCanvasSegmentsPath\),\s*graph,\s*\)/s);
  assert.match(engine, /proceduralDynamics,\s*storyCanvasSegments,\s*runtimeSummary:/s);
});
