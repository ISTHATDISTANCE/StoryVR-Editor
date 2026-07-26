import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { saveStoryGraph, sourceGraphAllowsSourceMotionTransition } from "./engine.mjs";

function fixtureGraph() {
  const beats = ["beat-a", "beat-b", "beat-c"].map((id) => ({
    id,
    kind: "text-only",
    originalField: "text_only_parts",
    isTextOnly: true,
    title: id,
    text: `Text for ${id}.`,
    linkedAssets: [],
    atomicBeatIds: [id],
  }));
  return {
    schemaVersion: "storyvr-source-graph/v1",
    story: { slug: "transition-fixture", title: "Transition Fixture" },
    atomicBeats: structuredClone(beats),
    beats: structuredClone(beats),
    variantGroups: [{
      id: "beat-c-options",
      beatId: "beat-c",
      title: "Beat C options",
      defaultOptionId: "option-one",
      options: [
        { id: "option-one", label: "Option one", text: "First option", sourceOrder: 0 },
        { id: "option-two", label: "Option two", text: "Second option", sourceOrder: 1 },
      ],
    }],
    entities: [],
    assetInventory: [],
    textVisualEvidenceLinks: [],
  };
}

test("Source Graph saves normalize directed beat and variant transition edges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-source-transitions-"));
  try {
    const storyFolder = path.join(root, "transition-fixture");
    const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
    const decisionsRoot = path.join(analysisRoot, "decisions");
    await mkdir(decisionsRoot, { recursive: true });

    const initial = await saveStoryGraph({ storyFolder }, fixtureGraph());
    assert.equal(Object.hasOwn(initial, "edges"), false, "legacy graphs keep adjacency fallback by omitting edges");
    await writeFile(path.join(decisionsRoot, "dynamic-geometry.json"), JSON.stringify({
      schemaVersion: "storyvr-decision/v2",
      component: "dynamic-geometry",
      status: "current",
      savedAt: new Date(0).toISOString(),
      option: { optionId: "fixture", label: "No dynamics" },
    }, null, 2));

    const edited = structuredClone(initial);
    edited.edges = [
      {
        schemaVersion: "storyvr-source-transition/v1",
        id: "edge-a-to-option-one",
        kind: "transition",
        from: { cardKind: "beat", beatId: "beat-a", side: "right" },
        to: {
          cardKind: "variant",
          beatId: "beat-c",
          variantGroupId: "beat-c-options",
          variantOptionId: "option-one",
          side: "left",
        },
      },
      {
        schemaVersion: "storyvr-source-transition/v1",
        id: "edge-a-to-option-one-duplicate",
        kind: "transition",
        from: { cardKind: "beat", beatId: "beat-a", side: "bottom" },
        to: {
          cardKind: "variant",
          beatId: "beat-c",
          variantGroupId: "beat-c-options",
          variantOptionId: "option-one",
          side: "top",
        },
      },
      {
        schemaVersion: "storyvr-source-transition/v1",
        id: "edge-a-to-option-two",
        kind: "transition",
        from: { cardKind: "beat", beatId: "beat-a", side: "bottom" },
        to: {
          cardKind: "variant",
          beatId: "beat-c",
          variantGroupId: "beat-c-options",
          variantOptionId: "option-two",
          side: "top",
        },
      },
      { fromBeatId: "beat-b", toBeatId: "beat-c" },
      {
        schemaVersion: "storyvr-source-transition/v1",
        id: "invalid-target",
        kind: "transition",
        from: { cardKind: "beat", beatId: "beat-a", side: "right" },
        to: { cardKind: "beat", beatId: "missing", side: "left" },
      },
    ];

    const saved = await saveStoryGraph({ storyFolder }, edited);
    assert.equal(saved.edges.length, 3, "duplicate and invalid connections are removed");
    assert.deepEqual(saved.edges[0], edited.edges[0]);
    assert.equal(saved.edges[1].to.variantOptionId, "option-two");
    assert.deepEqual(saved.edges[2], {
      schemaVersion: "storyvr-source-transition/v1",
      id: saved.edges[2].id,
      kind: "transition",
      from: { cardKind: "beat", beatId: "beat-b", side: "right" },
      to: { cardKind: "beat", beatId: "beat-c", side: "left" },
    });
    assert.match(saved.edges[2].id, /^transition-[a-f0-9]{12}$/);
    assert.equal(saved.sourceGraphInference.changed, true);
    assert.equal(sourceGraphAllowsSourceMotionTransition(saved, "beat-a", "beat-c"), true,
      "variant-scoped parallel edges collapse to their authored beat pair");
    assert.equal(sourceGraphAllowsSourceMotionTransition(saved, {
      boundaryId: "edge-a-to-option-one",
      edgeId: "edge-a-to-option-one",
      routeId: "edge-a-to-option-one",
      fromBeatId: "beat-a",
      toBeatId: "beat-c",
      fromContext: { beatId: "beat-a", variantGroupId: null, variantOptionId: null },
      toContext: { beatId: "beat-c", variantGroupId: "beat-c-options", variantOptionId: "option-one" },
    }), true, "exact source-motion routes accept their authored edge identity");
    assert.equal(sourceGraphAllowsSourceMotionTransition(saved, {
      edgeId: "edge-a-to-option-one",
      fromBeatId: "beat-a",
      toBeatId: "beat-c",
      fromContext: { beatId: "beat-a", variantGroupId: null, variantOptionId: null },
      toContext: { beatId: "beat-c", variantGroupId: "beat-c-options", variantOptionId: "option-two" },
    }), false, "an edge id cannot be paired with a stale variant context");
    assert.equal(sourceGraphAllowsSourceMotionTransition(saved, {
      edgeId: "edge-a-to-option-two",
      fromBeatId: "beat-a",
      toBeatId: "beat-c",
    }), true, "edge identity alone is sufficient for route-aware legacy payloads");
    assert.equal(sourceGraphAllowsSourceMotionTransition(saved, "beat-c", "beat-a"), false,
      "explicit edges remain directed");
    assert.equal(sourceGraphAllowsSourceMotionTransition(saved, "beat-a", "beat-b"), false,
      "present edges replace adjacency fallback");

    const invalidated = JSON.parse(await readFile(path.join(decisionsRoot, "dynamic-geometry.json"), "utf8"));
    assert.equal(invalidated.status, "stale");
    assert.equal(invalidated.invalidatedBy, "source-graph");

    const noOp = await saveStoryGraph({ storyFolder }, structuredClone(saved));
    assert.equal(noOp.sourceGraphInference.changed, false);
    assert.deepEqual(noOp.edges, saved.edges);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source-motion validation falls back to adjacent beats only when edges are absent", () => {
  const legacy = fixtureGraph();
  assert.equal(sourceGraphAllowsSourceMotionTransition(legacy, "beat-a", "beat-b"), true);
  assert.equal(sourceGraphAllowsSourceMotionTransition(legacy, "beat-b", "beat-a"), true,
    "legacy validation preserves reverse adjacent assignments");
  assert.equal(sourceGraphAllowsSourceMotionTransition(legacy, "beat-a", "beat-c"), false);

  const explicitlyDisconnected = { ...legacy, edges: [] };
  assert.equal(sourceGraphAllowsSourceMotionTransition(explicitlyDisconnected, "beat-a", "beat-b"), false);
});

test("implicit source-motion routes distinguish every variant option while beat-pair callers remain compatible", () => {
  const graph = fixtureGraph();
  graph.beats = [graph.beats[2], graph.beats[1]];
  graph.atomicBeats = structuredClone(graph.beats);

  assert.equal(sourceGraphAllowsSourceMotionTransition(graph, "beat-c", "beat-b"), true);
  assert.equal(sourceGraphAllowsSourceMotionTransition(graph, {
    edgeId: "source-transition-variant-beat-c-beat-c-options-option-one-to-beat-beat-b",
    fromBeatId: "beat-c",
    toBeatId: "beat-b",
    fromContext: { beatId: "beat-c", variantGroupId: "beat-c-options", variantOptionId: "option-one" },
    toContext: { beatId: "beat-b", variantGroupId: null, variantOptionId: null },
  }), true);
  assert.equal(sourceGraphAllowsSourceMotionTransition(graph, {
    edgeId: "source-transition-variant-beat-c-beat-c-options-option-two-to-beat-beat-b",
    fromBeatId: "beat-c",
    toBeatId: "beat-b",
    fromContext: { beatId: "beat-c", variantGroupId: "beat-c-options", variantOptionId: "option-two" },
    toContext: { beatId: "beat-b", variantGroupId: null, variantOptionId: null },
  }), true);
  assert.equal(sourceGraphAllowsSourceMotionTransition(graph, {
    edgeId: "source-transition-variant-beat-c-beat-c-options-missing-to-beat-beat-b",
    fromBeatId: "beat-c",
    toBeatId: "beat-b",
  }), false);
});
