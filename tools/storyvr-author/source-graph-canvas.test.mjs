import assert from "node:assert/strict";
import test from "node:test";

import {
  canCombineSourceGraphCards,
  canConnectSourceGraphCards,
  canPlaceSourceGraphBeatAsVariant,
  canReorderSourceGraphBeat,
  canReorderSourceGraphVariant,
  combineSourceGraphCards,
  connectSourceGraphCards,
  decodeSourceGraphAssetDragPayload,
  decodeSourceGraphCardDragPayload,
  decodeSourceGraphReorderDragPayload,
  encodeSourceGraphAssetDragPayload,
  encodeSourceGraphCardDragPayload,
  encodeSourceGraphReorderDragPayload,
  migrateSourceGraphVariantProgressionEdges,
  placeSourceGraphBeatAsVariant,
  pruneSourceGraphTransitions,
  remapSourceGraphTransitionCards,
  removeSourceGraphTransition,
  reorderSourceGraphBeat,
  reorderSourceGraphVariant,
  sourceGraphTransitionEdges,
  transferSourceGraphAsset,
} from "./app/src/source-graph-canvas.js";

const model = {
  id: "room.glb",
  type: "model",
  path: "models/room.glb",
  role: "source",
};
const image = {
  id: "window.jpg",
  type: "image",
  path: "textures/window.jpg",
  role: "source",
};

function textBeat(id, linkedAssets = []) {
  return {
    id,
    kind: "text-only",
    originalField: "text_only_parts",
    isTextOnly: linkedAssets.length === 0,
    sourceWasTextOnly: linkedAssets.length ? true : undefined,
    title: id,
    text: `Text for ${id}.`,
    linkedAssets: [...linkedAssets],
    atomicBeatIds: [id],
  };
}

function fixtureGraph(beats = [textBeat("beat-a"), textBeat("beat-b")]) {
  return {
    assetInventory: [model, image],
    beats: structuredClone(beats),
    atomicBeats: structuredClone(beats),
    variantGroups: [],
  };
}

function linkedAssetIds(beat) {
  return (beat.linkedAssets || []).map((asset) => typeof asset === "string" ? asset : asset.id || asset.assetId);
}

test("drag payloads round trip normalized inventory and beat sources", async () => {
  const encoded = encodeSourceGraphAssetDragPayload({ assetId: " room.glb ", sourceBeatId: " beat-a " });
  assert.deepEqual(decodeSourceGraphAssetDragPayload(encoded), {
    assetId: "room.glb",
    sourceBeatId: "beat-a",
  });
  assert.deepEqual(
    decodeSourceGraphAssetDragPayload(encodeSourceGraphAssetDragPayload({ assetId: "window.jpg" })),
    { assetId: "window.jpg", sourceBeatId: null },
  );
  assert.deepEqual(
    decodeSourceGraphAssetDragPayload(encodeSourceGraphAssetDragPayload({
      assetId: " room.glb ",
      sourceVariantGroupId: " group-a ",
      sourceVariantOptionId: " option-one ",
    })),
    {
      assetId: "room.glb",
      sourceBeatId: null,
      sourceVariantGroupId: "group-a",
      sourceVariantOptionId: "option-one",
    },
  );
  assert.equal(encodeSourceGraphAssetDragPayload({ assetId: "  " }), "");
  assert.equal(encodeSourceGraphAssetDragPayload({
    assetId: "room.glb",
    sourceBeatId: "beat-a",
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
  }), "");
  assert.equal(encodeSourceGraphAssetDragPayload({
    assetId: "room.glb",
    sourceVariantGroupId: "group-a",
  }), "");
  assert.equal(decodeSourceGraphAssetDragPayload("not-json"), null);
  assert.equal(decodeSourceGraphAssetDragPayload(JSON.stringify({ type: "other", assetId: "room.glb" })), null);
  assert.equal(decodeSourceGraphAssetDragPayload(JSON.stringify({ type: "storyvr-source-graph-asset" })), null);

  const exports = Object.keys(await import("./app/src/source-graph-canvas.js")).sort();
  assert.deepEqual(exports, [
    "canCombineSourceGraphCards",
    "canConnectSourceGraphCards",
    "canPlaceSourceGraphBeatAsVariant",
    "canReorderSourceGraphBeat",
    "canReorderSourceGraphVariant",
    "combineSourceGraphCards",
    "connectSourceGraphCards",
    "decodeSourceGraphAssetDragPayload",
    "decodeSourceGraphCardDragPayload",
    "decodeSourceGraphReorderDragPayload",
    "encodeSourceGraphAssetDragPayload",
    "encodeSourceGraphCardDragPayload",
    "encodeSourceGraphReorderDragPayload",
    "migrateSourceGraphVariantProgressionEdges",
    "placeSourceGraphBeatAsVariant",
    "pruneSourceGraphTransitions",
    "remapSourceGraphTransitionCards",
    "removeSourceGraphTransition",
    "reorderSourceGraphBeat",
    "reorderSourceGraphVariant",
    "sourceGraphTransitionEdges",
    "transferSourceGraphAsset",
  ]);
});

test("reorder drag payloads distinguish authored beats from variant options", () => {
  assert.deepEqual(
    decodeSourceGraphReorderDragPayload(encodeSourceGraphReorderDragPayload({
      reorderKind: "beat",
      beatId: " beat-b ",
    })),
    { reorderKind: "beat", beatId: "beat-b" },
  );
  assert.deepEqual(
    decodeSourceGraphReorderDragPayload(encodeSourceGraphReorderDragPayload({
      reorderKind: "variant",
      beatId: " beat-a ",
      variantGroupId: " group-a ",
      variantOptionId: " option-two ",
    })),
    {
      reorderKind: "variant",
      beatId: "beat-a",
      variantGroupId: "group-a",
      variantOptionId: "option-two",
    },
  );
  assert.equal(encodeSourceGraphReorderDragPayload({ reorderKind: "variant", beatId: "beat-a" }), "");
  assert.equal(decodeSourceGraphReorderDragPayload("{}"), null);
});

test("authored beats reorder before or after a destination without changing beat identity", () => {
  const graph = fixtureGraph([textBeat("beat-a"), textBeat("beat-b"), textBeat("beat-c"), textBeat("beat-d")]);
  assert.equal(canReorderSourceGraphBeat(graph, {
    sourceBeatId: "beat-d",
    targetBeatId: "beat-b",
    placement: "before",
  }), true);
  const firstMove = reorderSourceGraphBeat(graph, {
    sourceBeatId: "beat-d",
    targetBeatId: "beat-b",
    placement: "before",
  });
  assert.equal(firstMove.changed, true);
  assert.deepEqual(graph.beats.map((beat) => beat.id), ["beat-a", "beat-d", "beat-b", "beat-c"]);
  assert.deepEqual(graph.atomicBeats.map((beat) => beat.id), ["beat-a", "beat-b", "beat-c", "beat-d"]);

  reorderSourceGraphBeat(graph, {
    sourceBeatId: "beat-a",
    targetBeatId: "beat-c",
    placement: "after",
  });
  assert.deepEqual(graph.beats.map((beat) => beat.id), ["beat-d", "beat-b", "beat-c", "beat-a"]);
  assert.equal(canReorderSourceGraphBeat(graph, {
    sourceBeatId: "beat-b",
    targetBeatId: "beat-c",
    placement: "before",
  }), false);
  assert.equal(reorderSourceGraphBeat(graph, {
    sourceBeatId: "beat-b",
    targetBeatId: "beat-c",
    placement: "before",
  }).reason, "already-positioned");
});

test("alternative variants reorder within their group while the default option stays first", () => {
  const graph = fixtureGraph();
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    defaultOptionId: "option-one",
    options: [
      { id: "option-one", label: "One", sourceOrder: 0 },
      { id: "option-two", label: "Two", sourceOrder: 1 },
      { id: "option-three", label: "Three", sourceOrder: 2 },
      { id: "option-four", label: "Four", sourceOrder: 3 },
    ],
  }];
  assert.equal(canReorderSourceGraphVariant(graph, {
    variantGroupId: "group-a",
    sourceVariantOptionId: "option-four",
    afterOptionId: "option-one",
  }), true);
  const moved = reorderSourceGraphVariant(graph, {
    variantGroupId: "group-a",
    sourceVariantOptionId: "option-four",
    afterOptionId: "option-one",
  });
  assert.equal(moved.changed, true);
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.id), [
    "option-one",
    "option-four",
    "option-two",
    "option-three",
  ]);
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.sourceOrder), [0, 1, 2, 3]);
  assert.equal(graph.variantGroups[0].defaultOptionId, "option-one");

  assert.equal(reorderSourceGraphVariant(graph, {
    variantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
    afterOptionId: "option-three",
  }).reason, "default-option-pinned");
  assert.equal(reorderSourceGraphVariant(graph, {
    variantGroupId: "group-a",
    sourceVariantOptionId: "option-four",
    afterOptionId: "option-one",
  }).reason, "already-positioned");
});

test("card drag payloads only accept beats or fully identified variants", () => {
  const beat = { cardKind: "beat", beatId: " beat-a " };
  const variant = {
    cardKind: "variant",
    beatId: "variant-host",
    variantGroupId: " group-a ",
    variantOptionId: " option-one ",
  };

  assert.deepEqual(decodeSourceGraphCardDragPayload(encodeSourceGraphCardDragPayload(beat)), {
    cardKind: "beat",
    beatId: "beat-a",
  });
  assert.deepEqual(decodeSourceGraphCardDragPayload(encodeSourceGraphCardDragPayload(variant)), {
    cardKind: "variant",
    beatId: "variant-host",
    variantGroupId: "group-a",
    variantOptionId: "option-one",
  });
  assert.equal(encodeSourceGraphCardDragPayload({ cardKind: "variant", variantGroupId: "group-a" }), "");
  assert.equal(decodeSourceGraphCardDragPayload("not-json"), null);
  assert.equal(canCombineSourceGraphCards(beat, { cardKind: "beat", beatId: "beat-b" }), true);
  assert.equal(canCombineSourceGraphCards(beat, variant), true);
  assert.equal(canCombineSourceGraphCards(variant, beat), false);
  assert.equal(canCombineSourceGraphCards(variant, { ...variant, variantOptionId: "option-two" }), true);
  assert.equal(canCombineSourceGraphCards(variant, { ...variant, variantGroupId: "group-b" }), false);
});

test("legacy graphs expose implicit sequential transitions and materialize them on the first connection edit", () => {
  const graph = fixtureGraph([
    textBeat("beat-a"),
    textBeat("beat-b"),
    textBeat("beat-c"),
  ]);
  const beatA = { cardKind: "beat", beatId: "beat-a" };
  const beatC = { cardKind: "beat", beatId: "beat-c" };

  assert.equal(Object.hasOwn(graph, "edges"), false);
  assert.deepEqual(
    sourceGraphTransitionEdges(graph).map((edge) => [edge.from.beatId, edge.to.beatId]),
    [["beat-a", "beat-b"], ["beat-b", "beat-c"]],
  );
  assert.deepEqual(sourceGraphTransitionEdges(graph, { includeImplicit: false }), []);
  assert.equal(Object.hasOwn(graph, "edges"), false, "reading compatibility edges does not rewrite the draft");
  assert.equal(canConnectSourceGraphCards(graph, beatA, beatC), true);

  const result = connectSourceGraphCards(graph, {
    source: beatA,
    target: beatC,
    sourceSide: "right",
    targetSide: "left",
  });

  assert.equal(result.changed, true);
  assert.equal(result.materializedImplicitCount, 2, "the preservation count excludes the newly created arrow");
  assert.equal(Array.isArray(graph.edges), true);
  assert.deepEqual(
    graph.edges.map((edge) => [edge.from.beatId, edge.to.beatId]),
    [["beat-a", "beat-b"], ["beat-b", "beat-c"], ["beat-a", "beat-c"]],
  );
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, 3);
  for (const edge of graph.edges) {
    assert.equal(edge.schemaVersion, "storyvr-source-transition/v1");
    assert.equal(edge.kind, "transition");
    assert.ok(["top", "right", "bottom", "left"].includes(edge.from.side));
    assert.ok(["top", "right", "bottom", "left"].includes(edge.to.side));
  }
  assert.equal(graph.edges.at(-1).from.side, "right");
  assert.equal(graph.edges.at(-1).to.side, "left");
});

test("implicit graphs route every variant option to the next beat and retain reciprocal within-beat switches", () => {
  const graph = fixtureGraph([
    textBeat("before"),
    textBeat("variant-host"),
    textBeat("after"),
  ]);
  graph.beats[1].kind = "variant-group";
  graph.beats[1].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "variant-host",
    defaultOptionId: "option-two",
    options: [
      { id: "option-one", label: "One", text: "One", sourceOrder: 0, assetIds: [] },
      { id: "option-two", label: "Two", text: "Two", sourceOrder: 1, assetIds: [] },
      { id: "option-three", label: "Three", text: "Three", sourceOrder: 2, assetIds: [] },
    ],
  }];

  const edges = sourceGraphTransitionEdges(graph);
  assert.deepEqual(
    edges.slice(0, 4).map((edge) => ({
      id: edge.id,
      from: [edge.from.cardKind, edge.from.beatId, edge.from.variantOptionId || null],
      to: [edge.to.cardKind, edge.to.beatId, edge.to.variantOptionId || null],
    })),
    [
      {
        id: "source-transition-beat-before-to-variant-variant-host-group-a-option-two",
        from: ["beat", "before", null],
        to: ["variant", "variant-host", "option-two"],
      },
      {
        id: "source-transition-variant-variant-host-group-a-option-two-to-beat-after",
        from: ["variant", "variant-host", "option-two"],
        to: ["beat", "after", null],
      },
      {
        id: "source-transition-variant-variant-host-group-a-option-one-to-beat-after",
        from: ["variant", "variant-host", "option-one"],
        to: ["beat", "after", null],
      },
      {
        id: "source-transition-variant-variant-host-group-a-option-three-to-beat-after",
        from: ["variant", "variant-host", "option-three"],
        to: ["beat", "after", null],
      },
    ],
    "the incoming beat targets the default option and every displayed option has its own progression edge",
  );
  assert.deepEqual(
    edges.slice(4).map((edge) => ({
      id: edge.id,
      from: [edge.from.beatId, edge.from.variantGroupId, edge.from.variantOptionId, edge.from.side],
      to: [edge.to.beatId, edge.to.variantGroupId, edge.to.variantOptionId, edge.to.side],
    })),
    [
      {
        id: "source-transition-variant-variant-host-group-a-option-two-to-variant-variant-host-group-a-option-one",
        from: ["variant-host", "group-a", "option-two", "bottom"],
        to: ["variant-host", "group-a", "option-one", "top"],
      },
      {
        id: "source-transition-variant-variant-host-group-a-option-one-to-variant-variant-host-group-a-option-two",
        from: ["variant-host", "group-a", "option-one", "top"],
        to: ["variant-host", "group-a", "option-two", "bottom"],
      },
      {
        id: "source-transition-variant-variant-host-group-a-option-one-to-variant-variant-host-group-a-option-three",
        from: ["variant-host", "group-a", "option-one", "bottom"],
        to: ["variant-host", "group-a", "option-three", "top"],
      },
      {
        id: "source-transition-variant-variant-host-group-a-option-three-to-variant-variant-host-group-a-option-one",
        from: ["variant-host", "group-a", "option-three", "top"],
        to: ["variant-host", "group-a", "option-one", "bottom"],
      },
    ],
    "same-beat switches remain reciprocal between adjacent displayed options without wrapping",
  );
  assert.equal(new Set(edges.map((edge) => edge.id)).size, edges.length);
  assert.equal(Object.hasOwn(graph, "edges"), false, "reading defaults does not materialize them");
});

test("adjacent variant hosts route each source option to the next host default with order-stable IDs", () => {
  const graph = fixtureGraph([textBeat("source-host"), textBeat("target-host")]);
  graph.beats[0].variantGroupId = "source-group";
  graph.beats[1].variantGroupId = "target-group";
  graph.variantGroups = [
    {
      id: "source-group",
      beatId: "source-host",
      defaultOptionId: "source-two",
      options: [
        { id: "source-one", label: "One", sourceOrder: 0 },
        { id: "source-two", label: "Two", sourceOrder: 1 },
      ],
    },
    {
      id: "target-group",
      beatId: "target-host",
      defaultOptionId: "target-two",
      options: [
        { id: "target-one", label: "One", sourceOrder: 0 },
        { id: "target-two", label: "Two", sourceOrder: 1 },
      ],
    },
  ];

  const progression = sourceGraphTransitionEdges(graph)
    .filter((edge) => edge.from.beatId !== edge.to.beatId);
  assert.deepEqual(
    progression.map((edge) => [edge.from.variantOptionId, edge.to.variantOptionId]),
    [["source-two", "target-two"], ["source-one", "target-two"]],
  );

  const reordered = structuredClone(graph);
  reordered.variantGroups[0].options.reverse();
  assert.deepEqual(
    sourceGraphTransitionEdges(reordered)
      .filter((edge) => edge.from.beatId !== edge.to.beatId)
      .map((edge) => edge.id)
      .sort(),
    progression.map((edge) => edge.id).sort(),
  );
});

test("explicit legacy host arrows migrate once and deleted option progression stays deleted", () => {
  const graph = fixtureGraph([
    textBeat("before"),
    textBeat("variant-host"),
    textBeat("after"),
  ]);
  graph.beats[1].kind = "variant-group";
  graph.beats[1].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "variant-host",
    defaultOptionId: "option-two",
    options: [
      { id: "option-one", label: "One", text: "One", sourceOrder: 0, assetIds: [] },
      { id: "option-two", label: "Two", text: "Two", sourceOrder: 1, assetIds: [] },
      { id: "option-three", label: "Three", text: "Three", sourceOrder: 2, assetIds: [] },
    ],
  }];
  graph.edges = [
    {
      id: "legacy-in",
      from: { cardKind: "beat", beatId: "before", side: "right" },
      to: { cardKind: "beat", beatId: "variant-host", side: "left" },
    },
    {
      id: "legacy-out",
      from: { cardKind: "beat", beatId: "variant-host", side: "right" },
      to: { cardKind: "beat", beatId: "after", side: "left" },
    },
    {
      id: "manual-switch",
      from: {
        cardKind: "variant",
        beatId: "variant-host",
        variantGroupId: "group-a",
        variantOptionId: "option-two",
        side: "bottom",
      },
      to: {
        cardKind: "variant",
        beatId: "variant-host",
        variantGroupId: "group-a",
        variantOptionId: "option-one",
        side: "top",
      },
    },
  ];

  const derived = sourceGraphTransitionEdges(graph);
  assert.equal(derived.length, 5);
  assert.deepEqual(
    derived.slice(0, 4).map((edge) => [
      edge.from.variantOptionId || edge.from.beatId,
      edge.to.variantOptionId || edge.to.beatId,
    ]),
    [
      ["before", "option-two"],
      ["option-two", "after"],
      ["option-one", "after"],
      ["option-three", "after"],
    ],
  );
  assert.equal(derived[4].id, "manual-switch", "same-beat explicit switches are preserved verbatim");
  assert.equal(graph.edges[0].id, "legacy-in", "read-only derivation does not rewrite the explicit draft");

  const migration = migrateSourceGraphVariantProgressionEdges(graph);
  assert.equal(migration.changed, true);
  assert.deepEqual(graph.edges, derived);

  const deletedId = "source-transition-variant-variant-host-group-a-option-one-to-beat-after";
  assert.equal(removeSourceGraphTransition(graph, deletedId).changed, true);
  assert.equal(
    sourceGraphTransitionEdges(graph).some((edge) => edge.id === deletedId),
    false,
    "a canonical explicit graph does not infer a deleted option edge from beat adjacency",
  );
  assert.equal(migrateSourceGraphVariantProgressionEdges(graph).changed, false);
});

test("variant defaults materialize on edit or removal while explicit edge arrays remain authoritative", () => {
  const makeVariantGraph = () => {
    const graph = fixtureGraph([textBeat("variant-host")]);
    graph.beats[0].kind = "variant-group";
    graph.beats[0].variantGroupId = "group-a";
    graph.variantGroups = [{
      id: "group-a",
      beatId: "variant-host",
      defaultOptionId: "option-a",
      options: [
        { id: "option-a", label: "A", text: "A", sourceOrder: 0, assetIds: [] },
        { id: "option-b", label: "B", text: "B", sourceOrder: 1, assetIds: [] },
      ],
    }];
    return graph;
  };
  const optionA = {
    cardKind: "variant",
    beatId: "variant-host",
    variantGroupId: "group-a",
    variantOptionId: "option-a",
  };
  const optionB = { ...optionA, variantOptionId: "option-b" };

  const edited = makeVariantGraph();
  const materialized = connectSourceGraphCards(edited, {
    source: optionA,
    target: optionB,
    sourceSide: "bottom",
    targetSide: "top",
  });
  assert.equal(materialized.changed, true);
  assert.equal(materialized.reason, "materialized");
  assert.equal(materialized.materializedImplicitCount, 2);
  assert.equal(edited.edges.length, 2, "editing a default pair materializes both directions without a duplicate");

  const removed = makeVariantGraph();
  const reverseId = sourceGraphTransitionEdges(removed)[1].id;
  assert.equal(removeSourceGraphTransition(removed, reverseId).changed, true);
  assert.deepEqual(
    sourceGraphTransitionEdges(removed).map((edge) => [edge.from.variantOptionId, edge.to.variantOptionId]),
    [["option-a", "option-b"]],
  );
  assert.equal(Object.hasOwn(removed, "edges"), true);

  const explicit = makeVariantGraph();
  explicit.edges = [];
  assert.deepEqual(sourceGraphTransitionEdges(explicit), [], "an explicit empty array suppresses variant defaults too");
});

test("connection edits reject self links and exact duplicates without changing explicit edges", () => {
  const graph = fixtureGraph([
    textBeat("beat-a"),
    textBeat("beat-b"),
  ]);
  graph.edges = [];
  const beatA = { cardKind: "beat", beatId: "beat-a" };
  const beatB = { cardKind: "beat", beatId: "beat-b" };

  assert.equal(canConnectSourceGraphCards(graph, beatA, beatA), false);
  const self = connectSourceGraphCards(graph, {
    source: beatA,
    target: beatA,
    sourceSide: "right",
    targetSide: "left",
  });
  assert.equal(self.changed, false);
  assert.deepEqual(graph.edges, []);

  const connected = connectSourceGraphCards(graph, {
    source: beatA,
    target: beatB,
    sourceSide: "right",
    targetSide: "left",
  });
  assert.equal(connected.changed, true);
  assert.equal(canConnectSourceGraphCards(graph, beatA, beatB), true,
    "an existing pair remains a valid drag target so its handle route can be changed");

  const beforeDuplicate = structuredClone(graph.edges);
  const duplicate = connectSourceGraphCards(graph, {
    source: beatA,
    target: beatB,
    sourceSide: "right",
    targetSide: "left",
  });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.deepEqual(graph.edges, beforeDuplicate, "the exact same connection is rejected");

  const rerouted = connectSourceGraphCards(graph, {
    source: beatA,
    target: beatB,
    sourceSide: "bottom",
    targetSide: "top",
  });
  assert.equal(rerouted.changed, true);
  assert.equal(rerouted.reason, "rerouted");
  assert.equal(graph.edges.length, 1, "rerouting changes handle sides without adding a parallel duplicate");
  assert.equal(graph.edges[0].from.side, "bottom");
  assert.equal(graph.edges[0].to.side, "top");
});

test("variant connections retain exact option identity even when host beat pairs match", () => {
  const graph = fixtureGraph([
    textBeat("variant-host"),
    textBeat("destination"),
  ]);
  graph.beats[0].kind = "variant-group";
  graph.beats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "variant-host",
    defaultOptionId: "option-one",
    options: [
      { id: "option-one", label: "One", text: "One", sourceOrder: 0, assetIds: [] },
      { id: "option-two", label: "Two", text: "Two", sourceOrder: 1, assetIds: [] },
    ],
  }];
  graph.edges = [];
  const destination = { cardKind: "beat", beatId: "destination" };
  const optionOne = {
    cardKind: "variant",
    beatId: "variant-host",
    variantGroupId: "group-a",
    variantOptionId: "option-one",
  };
  const optionTwo = {
    ...optionOne,
    variantOptionId: "option-two",
  };

  assert.equal(connectSourceGraphCards(graph, {
    source: optionOne,
    target: destination,
    sourceSide: "right",
    targetSide: "top",
  }).changed, true);
  assert.equal(connectSourceGraphCards(graph, {
    source: optionTwo,
    target: destination,
    sourceSide: "bottom",
    targetSide: "left",
  }).changed, true);

  assert.equal(graph.edges.length, 2);
  assert.notEqual(graph.edges[0].id, graph.edges[1].id);
  assert.deepEqual(
    graph.edges.map((edge) => ({
      cardKind: edge.from.cardKind,
      beatId: edge.from.beatId,
      variantGroupId: edge.from.variantGroupId,
      variantOptionId: edge.from.variantOptionId,
      toBeatId: edge.to.beatId,
    })),
    [
      {
        cardKind: "variant",
        beatId: "variant-host",
        variantGroupId: "group-a",
        variantOptionId: "option-one",
        toBeatId: "destination",
      },
      {
        cardKind: "variant",
        beatId: "variant-host",
        variantGroupId: "group-a",
        variantOptionId: "option-two",
        toBeatId: "destination",
      },
    ],
  );
});

test("removing explicit transitions never resurrects implicit sequential edges", () => {
  const graph = fixtureGraph([
    textBeat("beat-a"),
    textBeat("beat-b"),
  ]);
  graph.edges = [];
  const connected = connectSourceGraphCards(graph, {
    source: { cardKind: "beat", beatId: "beat-a" },
    target: { cardKind: "beat", beatId: "beat-b" },
    sourceSide: "right",
    targetSide: "left",
  });
  const edgeId = graph.edges[0].id;

  assert.equal(connected.changed, true);
  assert.equal(removeSourceGraphTransition(graph, edgeId).changed, true);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(sourceGraphTransitionEdges(graph), []);
  assert.equal(removeSourceGraphTransition(graph, edgeId).changed, false);
  assert.deepEqual(sourceGraphTransitionEdges(graph), []);
});

test("explicit empty graphs stay empty and transition pruning removes dangling endpoints", () => {
  const legacy = fixtureGraph([
    textBeat("beat-a"),
    textBeat("beat-b"),
  ]);
  pruneSourceGraphTransitions(legacy);
  assert.equal(Object.hasOwn(legacy, "edges"), false, "pruning preserves legacy implicit mode");

  const graph = fixtureGraph([
    textBeat("beat-a"),
    textBeat("beat-b"),
  ]);
  graph.edges = [
    {
      schemaVersion: "storyvr-source-transition/v1",
      id: "valid",
      kind: "transition",
      from: { cardKind: "beat", beatId: "beat-a", side: "right" },
      to: { cardKind: "beat", beatId: "beat-b", side: "left" },
    },
    {
      schemaVersion: "storyvr-source-transition/v1",
      id: "missing-beat",
      kind: "transition",
      from: { cardKind: "beat", beatId: "beat-a", side: "right" },
      to: { cardKind: "beat", beatId: "missing", side: "left" },
    },
    {
      schemaVersion: "storyvr-source-transition/v1",
      id: "missing-variant",
      kind: "transition",
      from: {
        cardKind: "variant",
        beatId: "beat-a",
        variantGroupId: "missing-group",
        variantOptionId: "missing-option",
        side: "bottom",
      },
      to: { cardKind: "beat", beatId: "beat-b", side: "top" },
    },
  ];

  pruneSourceGraphTransitions(graph);
  assert.deepEqual(graph.edges.map((edge) => edge.id), ["valid"]);

  graph.edges = [];
  pruneSourceGraphTransitions(graph);
  assert.deepEqual(sourceGraphTransitionEdges(graph), []);
  assert.equal(Object.hasOwn(graph, "edges"), true, "an explicit empty graph is distinct from legacy implicit mode");
});

test("existing arrows follow card combine, split-style remap, and variant placement edits", () => {
  const combinedGraph = fixtureGraph([textBeat("beat-a"), textBeat("beat-b"), textBeat("beat-c")]);
  combinedGraph.edges = [];
  connectSourceGraphCards(combinedGraph, {
    source: { cardKind: "beat", beatId: "beat-a" },
    target: { cardKind: "beat", beatId: "beat-b" },
  });
  connectSourceGraphCards(combinedGraph, {
    source: { cardKind: "beat", beatId: "beat-b" },
    target: { cardKind: "beat", beatId: "beat-c" },
  });
  const combined = combineSourceGraphCards(combinedGraph, {
    source: { cardKind: "beat", beatId: "beat-a" },
    target: { cardKind: "beat", beatId: "beat-b" },
    placement: "up",
  });
  assert.equal(combined.changed, true);
  assert.deepEqual(
    combinedGraph.edges.map((edge) => [edge.from.beatId, edge.to.beatId]),
    [[combined.combinedBeatId, "beat-c"]],
    "the internal self-edge is removed and the outgoing arrow follows the retained combined card",
  );

  const splitGraph = fixtureGraph([textBeat("before"), textBeat("combined"), textBeat("after")]);
  splitGraph.edges = [];
  connectSourceGraphCards(splitGraph, {
    source: { cardKind: "beat", beatId: "before" },
    target: { cardKind: "beat", beatId: "combined" },
  });
  connectSourceGraphCards(splitGraph, {
    source: { cardKind: "beat", beatId: "combined" },
    target: { cardKind: "beat", beatId: "after" },
  });
  splitGraph.beats.splice(1, 1, textBeat("part-one"), textBeat("part-two"));
  const remapped = remapSourceGraphTransitionCards(splitGraph, [{
    card: { cardKind: "beat", beatId: "combined" },
    from: { cardKind: "beat", beatId: "part-two" },
    to: { cardKind: "beat", beatId: "part-one" },
  }]);
  assert.equal(remapped.changed, true);
  assert.deepEqual(
    splitGraph.edges.map((edge) => [edge.from.beatId, edge.to.beatId]),
    [["before", "part-one"], ["part-two", "after"]],
    "incoming and outgoing arrows can follow different split endpoints",
  );

  const variantGraph = fixtureGraph([textBeat("source"), textBeat("host"), textBeat("before")]);
  variantGraph.edges = [];
  connectSourceGraphCards(variantGraph, {
    source: { cardKind: "beat", beatId: "before" },
    target: { cardKind: "beat", beatId: "source" },
  });
  connectSourceGraphCards(variantGraph, {
    source: { cardKind: "beat", beatId: "source" },
    target: { cardKind: "beat", beatId: "host" },
  });
  const placed = placeSourceGraphBeatAsVariant(variantGraph, {
    sourceBeatId: "source",
    targetBeatId: "host",
  });
  assert.equal(placed.changed, true);
  assert.deepEqual(
    variantGraph.edges.map((edge) => ({
      fromKind: edge.from.cardKind,
      fromBeatId: edge.from.beatId,
      fromOptionId: edge.from.variantOptionId || null,
      toKind: edge.to.cardKind,
      toBeatId: edge.to.beatId,
      toOptionId: edge.to.variantOptionId || null,
    })),
    [
      {
        fromKind: "beat",
        fromBeatId: "before",
        fromOptionId: null,
        toKind: "variant",
        toBeatId: "host",
        toOptionId: placed.variantOptionId,
      },
      {
        fromKind: "variant",
        fromBeatId: "host",
        fromOptionId: placed.variantOptionId,
        toKind: "beat",
        toBeatId: "host",
        toOptionId: null,
      },
    ],
  );
});

test("placing a standalone beat under another creates an ordered variant group at the destination", () => {
  const graph = fixtureGraph([textBeat("beat-a", [model]), textBeat("beat-b"), textBeat("beat-c", [image])]);
  graph.beats[0].title = "Dragged option";
  graph.beats[0].text = "Dragged text";
  graph.beats[0].animationProbeLinks = [{ assetId: model.id, associationSource: "source-option" }];
  graph.beats[0].probePromotedVisual = true;
  graph.beats[2].title = "Destination option";
  graph.beats[2].text = "Destination text";
  graph.beats[2].animationProbeLinks = [{ assetId: image.id, associationSource: "default-option" }];
  graph.beats[2].probePromotedVisual = true;

  assert.equal(canPlaceSourceGraphBeatAsVariant(graph, {
    sourceBeatId: "beat-a",
    targetBeatId: "beat-c",
  }), true);
  const result = placeSourceGraphBeatAsVariant(graph, {
    sourceBeatId: "beat-a",
    targetBeatId: "beat-c",
  });

  assert.equal(result.changed, true);
  assert.equal(result.reason, "created-variant-group");
  assert.equal(result.sourceBeatId, "beat-a");
  assert.equal(result.targetBeatId, "beat-c");
  assert.equal(result.afterOptionId, graph.variantGroups[0].defaultOptionId);
  assert.deepEqual(graph.beats.map((beat) => beat.id), ["beat-b", "beat-c"]);
  assert.deepEqual(graph.atomicBeats.map((beat) => beat.id), ["beat-a", "beat-b", "beat-c"]);

  const host = graph.beats[1];
  const group = graph.variantGroups[0];
  assert.equal(host.kind, "variant-group");
  assert.equal(host.subtype, "single-select");
  assert.equal(host.originalField, "variant_groups");
  assert.equal(host.variantGroupId, group.id);
  assert.deepEqual(host.atomicBeatIds, ["beat-c"]);
  assert.deepEqual(linkedAssetIds(host), []);
  assert.equal(host.animationProbeLinks, undefined);
  assert.equal(host.probePromotedVisual, undefined);
  assert.equal(group.beatId, "beat-c");
  assert.equal(group.defaultOptionId, group.options[0].id);
  assert.deepEqual(group.options.map((option) => option.sourceBeatId), ["beat-c", "beat-a"]);
  assert.deepEqual(group.options.map((option) => option.atomicBeatIds), [["beat-c"], ["beat-a"]]);
  assert.deepEqual(group.options.map((option) => option.sourceOrder), [0, 1]);
  assert.deepEqual(group.options.map((option) => option.assetIds), [[image.id], [model.id]]);
  assert.deepEqual(group.options.map((option) => option.animationProbeLinks?.map((link) => link.assetId)), [
    [image.id],
    [model.id],
  ]);
  assert.equal(result.variantOptionId, group.options[1].id);

  const unlinked = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceVariantGroupId: group.id,
    sourceVariantOptionId: result.variantOptionId,
  });
  assert.equal(unlinked.changed, true);
  assert.equal(unlinked.reason, "unlinked");
  assert.deepEqual(group.options[0].assetIds, [image.id]);
  assert.deepEqual(group.options[1].assetIds, []);
  assert.equal(group.options[1].animationProbeLinks, undefined);
  assert.deepEqual(linkedAssetIds(host), []);
  assert.equal(host.animationProbeLinks, undefined);
  const sourceAtomic = graph.atomicBeats.find((beat) => beat.id === "beat-a");
  assert.deepEqual(linkedAssetIds(sourceAtomic), [model.id]);
  assert.deepEqual(sourceAtomic.animationProbeLinks.map((link) => link.assetId), [model.id]);
});

test("placing another standalone beat into a variant group inserts after the requested option", () => {
  const graph = fixtureGraph([textBeat("beat-a"), textBeat("beat-b", [model]), textBeat("beat-c", [image])]);
  graph.beats[1].animationProbeLinks = [{ assetId: model.id, associationSource: "inserted-option" }];
  graph.beats[1].probePromotedVisual = true;
  placeSourceGraphBeatAsVariant(graph, { sourceBeatId: "beat-a", targetBeatId: "beat-c" });
  const group = graph.variantGroups[0];
  const destinationOptionId = group.defaultOptionId;

  const result = placeSourceGraphBeatAsVariant(graph, {
    sourceBeatId: "beat-b",
    targetBeatId: "beat-c",
    afterOptionId: destinationOptionId,
  });

  assert.equal(result.changed, true);
  assert.equal(result.reason, "joined-variant-group");
  assert.equal(result.variantGroupId, group.id);
  assert.equal(result.afterOptionId, destinationOptionId);
  assert.deepEqual(graph.beats.map((beat) => beat.id), ["beat-c"]);
  assert.deepEqual(group.options.map((option) => option.sourceBeatId), ["beat-c", "beat-b", "beat-a"]);
  assert.deepEqual(group.options.map((option) => option.sourceOrder), [0, 1, 2]);
  assert.deepEqual(group.options[1].atomicBeatIds, ["beat-b"]);
  assert.deepEqual(group.options[1].animationProbeLinks.map((link) => link.assetId), [model.id]);
  assert.equal(result.variantOptionId, group.options[1].id);
  assert.deepEqual(linkedAssetIds(graph.beats[0]), []);
  assert.equal(graph.beats[0].animationProbeLinks, undefined);
});

test("joining a group reindexes against default-first displayed order", () => {
  const graph = fixtureGraph([textBeat("beat-a"), textBeat("beat-b")]);
  graph.beats[1].variantGroupId = "group-b";
  graph.atomicBeats[1].variantGroupId = "group-b";
  graph.variantGroups = [{
    id: "group-b",
    beatId: "beat-b",
    defaultOptionId: "option-two",
    options: [
      { id: "option-one", label: "One", text: "One", sourceOrder: 0, assetIds: [] },
      { id: "option-two", label: "Two", text: "Two", sourceOrder: 1, assetIds: [] },
      { id: "option-three", label: "Three", text: "Three", sourceOrder: 2, assetIds: [] },
    ],
  }];

  const result = placeSourceGraphBeatAsVariant(graph, {
    sourceBeatId: "beat-a",
    targetBeatId: "beat-b",
    afterOptionId: "option-two",
  });

  assert.equal(result.reason, "joined-variant-group");
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.id), [
    "option-two",
    result.variantOptionId,
    "option-one",
    "option-three",
  ]);
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.sourceOrder), [0, 1, 2, 3]);
  assert.equal(graph.variantGroups[0].defaultOptionId, "option-two");
});

test("variant placement rejects missing, same, grouped-source, and unspecified option destinations without mutation", () => {
  const graph = fixtureGraph();
  const before = structuredClone(graph);
  assert.equal(canPlaceSourceGraphBeatAsVariant(graph, { sourceBeatId: "missing", targetBeatId: "beat-b" }), false);
  assert.equal(placeSourceGraphBeatAsVariant(graph, { sourceBeatId: "missing", targetBeatId: "beat-b" }).reason, "unknown-source-beat");
  assert.equal(placeSourceGraphBeatAsVariant(graph, { sourceBeatId: "beat-a", targetBeatId: "beat-a" }).reason, "same-beat");
  assert.deepEqual(graph, before);

  placeSourceGraphBeatAsVariant(graph, { sourceBeatId: "beat-a", targetBeatId: "beat-b" });
  const grouped = structuredClone(graph);
  assert.equal(canPlaceSourceGraphBeatAsVariant(graph, { sourceBeatId: "beat-b", targetBeatId: "beat-b" }), false);
  assert.equal(placeSourceGraphBeatAsVariant(graph, { sourceBeatId: "beat-b", targetBeatId: "missing" }).reason, "unknown-target-beat");

  graph.beats.push(textBeat("beat-c"));
  graph.atomicBeats.push(textBeat("beat-c"));
  const beforeMissingOption = structuredClone(graph);
  assert.equal(placeSourceGraphBeatAsVariant(graph, {
    sourceBeatId: "beat-c",
    targetBeatId: "beat-b",
  }).reason, "target-option-required");
  assert.deepEqual(graph, beforeMissingOption);
  assert.equal(placeSourceGraphBeatAsVariant(graph, {
    sourceBeatId: "beat-c",
    targetBeatId: "beat-b",
    afterOptionId: "missing-option",
  }).reason, "unknown-target-option");
  assert.deepEqual(graph, beforeMissingOption);
  assert.notDeepEqual(graph, grouped);
});

test("beat card drops keep the destination slot and title while respecting up or down text order", () => {
  const graph = fixtureGraph([textBeat("beat-a", [model]), textBeat("beat-b"), textBeat("beat-c", [image])]);
  graph.beats[0].title = "Source A";
  graph.beats[0].text = "Text A";
  graph.beats[2].title = "Destination C";
  graph.beats[2].text = "Text C";

  const result = combineSourceGraphCards(graph, {
    source: { cardKind: "beat", beatId: "beat-a" },
    target: { cardKind: "beat", beatId: "beat-c" },
    placement: "up",
  });

  assert.equal(result.changed, true);
  assert.equal(result.destinationTitle, "Destination C");
  assert.equal(graph.beats.length, 2);
  assert.equal(graph.beats[0].id, "beat-b");
  assert.equal(graph.beats[1].id, result.combinedBeatId);
  assert.equal(graph.beats[1].title, "Destination C");
  assert.equal(graph.beats[1].sectionHeading, "Destination C");
  assert.equal(graph.beats[1].text, "Text A\n\nText C");
  assert.deepEqual(graph.beats[1].atomicBeatIds, ["beat-a", "beat-c"]);
  assert.deepEqual(linkedAssetIds(graph.beats[1]), [model.id, image.id]);
  assert.equal(graph.atomicBeats.length, 3);

  const downGraph = fixtureGraph([textBeat("beat-a"), textBeat("beat-b")]);
  downGraph.beats[0].title = "Destination A";
  downGraph.beats[0].text = "Text A";
  downGraph.beats[1].text = "Text B";
  combineSourceGraphCards(downGraph, {
    source: { cardKind: "beat", beatId: "beat-b" },
    target: { cardKind: "beat", beatId: "beat-a" },
    placement: "down",
  });
  assert.equal(downGraph.beats[0].title, "Destination A");
  assert.equal(downGraph.beats[0].text, "Text A\n\nText B");
  assert.deepEqual(downGraph.beats[0].atomicBeatIds, ["beat-a", "beat-b"]);
});

test("variant card drops retain the destination option identity and merge assets", () => {
  const graph = fixtureGraph();
  graph.beats[0].variantGroupId = "group-a";
  graph.atomicBeats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    defaultOptionId: "option-one",
    options: [
      { id: "option-one", label: "One", text: "Text One", sourceOrder: 0, assetIds: [model.id], sourceBeatId: "atom-one", atomicBeatIds: ["atom-one"] },
      { id: "option-two", label: "Two", text: "Text Two", sourceOrder: 1, assetIds: [], sourceBeatId: "atom-two", atomicBeatIds: ["atom-two"] },
      { id: "option-three", label: "Three", text: "Text Three", sourceOrder: 2, assetIds: [image.id], sourceBeatId: "atom-three", atomicBeatIds: ["atom-three"] },
    ],
  }];

  const result = combineSourceGraphCards(graph, {
    source: {
      cardKind: "variant",
      beatId: "beat-a",
      variantGroupId: "group-a",
      variantOptionId: "option-one",
    },
    target: {
      cardKind: "variant",
      beatId: "beat-a",
      variantGroupId: "group-a",
      variantOptionId: "option-three",
    },
    placement: "up",
  });

  assert.equal(result.changed, true);
  assert.equal(result.destinationTitle, "Three");
  assert.equal(result.collapsedVariantGroup, false);
  assert.equal(graph.variantGroups[0].defaultOptionId, "option-three");
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.id), ["option-two", "option-three"]);
  assert.equal(graph.variantGroups[0].options[1].label, "Three");
  assert.equal(graph.variantGroups[0].options[1].text, "Text One\n\nText Three");
  assert.deepEqual(graph.variantGroups[0].options[1].assetIds, [model.id, image.id]);
  assert.deepEqual(graph.variantGroups[0].options[1].atomicBeatIds, ["atom-one", "atom-three"]);
  assert.deepEqual(graph.variantGroups[0].options[1].sourceBeatIds, ["atom-one", "atom-three"]);
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.sourceOrder), [0, 1]);
});

test("standalone beat card drops combine into the exact variant option without changing group order", () => {
  const graph = fixtureGraph([textBeat("source-beat", [model]), textBeat("variant-host")]);
  graph.beats[0].title = "Source beat";
  graph.beats[0].text = "Source text";
  graph.beats[0].sourceIds = ["source-paragraph"];
  graph.beats[0].visualChildren = [{ id: "source-child" }];
  graph.beats[0].animationProbeLinks = [{ assetId: model.id, associationSource: "source-beat" }];
  graph.beats[0].probePromotedVisual = true;
  graph.beats[1].variantGroupId = "group-a";
  graph.atomicBeats[1].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "variant-host",
    defaultOptionId: "option-two",
    options: [
      { id: "option-one", label: "One", text: "Text One", sourceOrder: 0, assetIds: [] },
      { id: "option-two", label: "Two", text: "Text Two", sourceOrder: 1, assetIds: [] },
      {
        id: "option-three",
        label: "Three",
        text: "Target text",
        sourceOrder: 2,
        assetIds: [image.id],
        sourceBeatId: "target-atom",
        atomicBeatIds: ["target-atom"],
        sourceIds: ["target-paragraph"],
        visualChildren: [{ id: "target-child" }],
        animationProbeLinks: [{ assetId: image.id, associationSource: "target-option" }],
        probePromotedVisual: true,
      },
    ],
  }];

  const result = combineSourceGraphCards(graph, {
    source: { cardKind: "beat", beatId: "source-beat" },
    target: {
      cardKind: "variant",
      beatId: "variant-host",
      variantGroupId: "group-a",
      variantOptionId: "option-three",
    },
    placement: "up",
  });

  assert.equal(result.changed, true);
  assert.equal(result.targetVariantOptionId, "option-three");
  assert.equal(result.destinationTitle, "Three");
  assert.deepEqual(graph.beats.map((beat) => beat.id), ["variant-host"]);
  assert.deepEqual(graph.atomicBeats.map((beat) => beat.id), ["source-beat", "variant-host"]);
  assert.equal(graph.variantGroups[0].defaultOptionId, "option-two");
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.id), [
    "option-one",
    "option-two",
    "option-three",
  ]);
  assert.deepEqual(graph.variantGroups[0].options.map((option) => option.sourceOrder), [0, 1, 2]);

  const combined = graph.variantGroups[0].options[2];
  assert.equal(combined.sourceBeatId, "target-atom");
  assert.equal(combined.text, "Source text\n\nTarget text");
  assert.deepEqual(combined.assetIds, [model.id, image.id]);
  assert.deepEqual(combined.atomicBeatIds, ["source-beat", "target-atom"]);
  assert.deepEqual(combined.sourceBeatIds, ["source-beat", "target-atom"]);
  assert.deepEqual(combined.sourceIds, ["source-paragraph", "target-paragraph"]);
  assert.deepEqual(combined.visualChildren, [{ id: "source-child" }, { id: "target-child" }]);
  assert.deepEqual(combined.animationProbeLinks.map((link) => link.assetId), [model.id, image.id]);
  assert.equal(combined.sourceWasTextOnly, true);
});

test("combining the final two variants collapses the destination into the owning beat", () => {
  const graph = fixtureGraph();
  graph.beats = [graph.beats[0]];
  graph.beats[0].variantGroupId = "group-a";
  graph.atomicBeats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    defaultOptionId: "option-one",
    options: [
      { id: "option-one", label: "One", text: "Text One", assetIds: [model.id], sourceBeatId: "beat-a", atomicBeatIds: ["beat-a"] },
      { id: "option-two", label: "Two", text: "Text Two", assetIds: [image.id], sourceBeatId: "beat-b", atomicBeatIds: ["beat-b"] },
    ],
  }];

  const result = combineSourceGraphCards(graph, {
    source: { cardKind: "variant", beatId: "beat-a", variantGroupId: "group-a", variantOptionId: "option-one" },
    target: { cardKind: "variant", beatId: "beat-a", variantGroupId: "group-a", variantOptionId: "option-two" },
    placement: "down",
  });

  assert.equal(result.collapsedVariantGroup, true);
  assert.deepEqual(graph.variantGroups, []);
  assert.equal(graph.beats[0].title, "Two");
  assert.equal(graph.beats[0].sectionHeading, "Two");
  assert.equal(graph.beats[0].text, "Text Two\n\nText One");
  assert.deepEqual(linkedAssetIds(graph.beats[0]), [image.id, model.id]);
  assert.deepEqual(graph.beats[0].atomicBeatIds, ["beat-a", "beat-b"]);
  assert.equal(graph.beats[0].isCombined, true);
  assert.equal(graph.beats[0].variantGroupId, undefined);
  assert.equal(graph.atomicBeats[0].title, "Two");
});

test("inventory assets link directly to a variant option and promote its visible and atomic beat", () => {
  const graph = fixtureGraph();
  graph.beats[0].variantGroupId = "group-a";
  graph.atomicBeats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    defaultOptionId: "option-one",
    options: [
      { id: "option-one", asset_ids: [] },
      { id: "option-two", assetIds: [] },
    ],
  }];

  const result = transferSourceGraphAsset(graph, {
    assetId: model.id,
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-one",
  });

  assert.deepEqual(result, {
    changed: true,
    reason: "linked",
    affectedBeatIds: ["beat-a"],
    sourceBeatId: null,
    targetBeatId: "beat-a",
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-one",
  });
  assert.deepEqual(graph.variantGroups[0].options[0].assetIds, [model.id]);
  assert.equal("asset_ids" in graph.variantGroups[0].options[0], false);
  for (const record of [graph.beats[0], graph.atomicBeats[0]]) {
    assert.deepEqual(record.linkedAssets, []);
    assert.equal(record.sourceWasTextOnly, true);
    assert.equal(record.isTextOnly, false);
  }
});

test("variant assets move between options and duplicate targets leave the source unchanged", () => {
  const graph = fixtureGraph();
  graph.beats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    options: [
      { id: "option-one", assetIds: [model.id] },
      { id: "option-two", assetIds: [] },
    ],
  }];

  const moved = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-two",
  });
  assert.equal(moved.changed, true);
  assert.equal(moved.reason, "moved");
  assert.deepEqual(moved.affectedBeatIds, ["beat-a"]);
  assert.deepEqual(graph.variantGroups[0].options[0].assetIds, []);
  assert.deepEqual(graph.variantGroups[0].options[1].assetIds, [model.id]);
  assert.equal(graph.beats[0].isTextOnly, false);

  const beforeSame = structuredClone(graph);
  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-two",
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-two",
  }).reason, "same-variant");
  assert.deepEqual(graph, beforeSame);

  graph.variantGroups[0].options[0].assetIds = [model.id];
  const beforeDuplicate = structuredClone(graph);
  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-two",
  }).reason, "duplicate");
  assert.deepEqual(graph, beforeDuplicate);
});

test("variant assets move between different beat cards and reconcile both owners", () => {
  const graph = fixtureGraph();
  graph.beats[0].variantGroupId = "group-a";
  graph.beats[0].sourceWasTextOnly = true;
  graph.beats[0].isTextOnly = false;
  graph.atomicBeats[0].variantGroupId = "group-a";
  graph.atomicBeats[0].sourceWasTextOnly = true;
  graph.atomicBeats[0].isTextOnly = false;
  graph.beats[1].variantGroupId = "group-b";
  graph.atomicBeats[1].variantGroupId = "group-b";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    options: [{ id: "option-one", assetIds: [model.id] }],
  }, {
    id: "group-b",
    beatId: "beat-b",
    options: [{ id: "option-two", assetIds: [] }],
  }];

  const result = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
    targetVariantGroupId: "group-b",
    targetVariantOptionId: "option-two",
  });

  assert.equal(result.reason, "moved");
  assert.deepEqual(result.affectedBeatIds, ["beat-a", "beat-b"]);
  assert.deepEqual(graph.variantGroups[0].options[0].assetIds, []);
  assert.deepEqual(graph.variantGroups[1].options[0].assetIds, [model.id]);
  for (const source of [graph.beats[0], graph.atomicBeats[0]]) assert.equal(source.isTextOnly, true);
  for (const target of [graph.beats[1], graph.atomicBeats[1]]) {
    assert.equal(target.sourceWasTextOnly, true);
    assert.equal(target.isTextOnly, false);
  }
});

test("legacy host links can move to an exact variant but variants cannot move back to the host", () => {
  const graph = fixtureGraph();
  graph.beats[0].variantGroupId = "group-a";
  graph.atomicBeats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    options: [{ id: "option-one", assetIds: [] }],
  }];
  for (const record of [graph.beats[0], graph.atomicBeats[0]]) {
    record.linkedAssets = [model];
    record.animationProbeLinks = [{ assetId: model.id, associationSource: "direct" }];
    record.probePromotedVisual = true;
  }

  const toVariant = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "beat-a",
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-one",
  });
  assert.equal(toVariant.reason, "moved");
  assert.deepEqual(toVariant.affectedBeatIds, ["beat-a"]);
  assert.deepEqual(graph.variantGroups[0].options[0].assetIds, [model.id]);
  for (const record of [graph.beats[0], graph.atomicBeats[0]]) {
    assert.deepEqual(record.linkedAssets, []);
    assert.equal(record.animationProbeLinks, undefined);
    assert.equal(record.probePromotedVisual, undefined);
    assert.equal(record.isTextOnly, false);
  }

  const beforeRejectedMove = structuredClone(graph);
  const toBeat = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
    targetBeatId: "beat-a",
  });
  assert.equal(toBeat.reason, "variant-target-requires-option");
  assert.equal(toBeat.changed, false);
  assert.deepEqual(graph, beforeRejectedMove);
});

test("unlinking the final variant asset restores text-only state while other option assets preserve it", () => {
  const graph = fixtureGraph();
  graph.beats[0].variantGroupId = "group-a";
  graph.atomicBeats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    options: [
      { id: "option-one", assetIds: [] },
      { id: "option-two", assetIds: [] },
    ],
  }];
  transferSourceGraphAsset(graph, {
    assetId: model.id,
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-one",
  });
  transferSourceGraphAsset(graph, {
    assetId: image.id,
    targetVariantGroupId: "group-a",
    targetVariantOptionId: "option-two",
  });

  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
  }).reason, "unlinked");
  assert.equal(graph.beats[0].isTextOnly, false);
  assert.equal(graph.atomicBeats[0].isTextOnly, false);

  assert.equal(transferSourceGraphAsset(graph, {
    assetId: image.id,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-two",
  }).reason, "unlinked");
  for (const record of [graph.beats[0], graph.atomicBeats[0]]) {
    assert.equal(record.sourceWasTextOnly, true);
    assert.equal(record.isTextOnly, true);
  }
});

test("unknown, partial, and orphan variant endpoints are no-ops", () => {
  const graph = fixtureGraph();
  graph.beats[0].variantGroupId = "group-a";
  graph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    options: [{ id: "option-one", assetIds: [model.id] }],
  }, {
    id: "orphan",
    beatId: "missing-beat",
    options: [{ id: "option-one", assetIds: [] }],
  }];
  const before = structuredClone(graph);

  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    targetVariantGroupId: "group-a",
  }).reason, "unknown-target-variant");
  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    targetVariantGroupId: "missing",
    targetVariantOptionId: "option-one",
  }).reason, "unknown-target-variant");
  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    targetVariantGroupId: "orphan",
    targetVariantOptionId: "option-one",
  }).reason, "unknown-target-variant");
  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "beat-a",
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
  }).reason, "invalid-transfer");
  assert.deepEqual(graph, before);
});

test("inventory assets link as canonical objects and promote visible and atomic text beats", () => {
  const graph = fixtureGraph();
  const result = transferSourceGraphAsset(graph, { assetId: model.id, targetBeatId: "beat-a" });

  assert.deepEqual(result, {
    changed: true,
    reason: "linked",
    affectedBeatIds: ["beat-a"],
    sourceBeatId: null,
    targetBeatId: "beat-a",
  });
  assert.strictEqual(graph.beats[0].linkedAssets[0], graph.assetInventory[0]);
  assert.strictEqual(graph.atomicBeats[0].linkedAssets[0], graph.assetInventory[0]);
  assert.equal(graph.beats[0].sourceWasTextOnly, true);
  assert.equal(graph.beats[0].isTextOnly, false);
  assert.equal(graph.atomicBeats[0].sourceWasTextOnly, true);
  assert.equal(graph.atomicBeats[0].isTextOnly, false);
});

test("moving an asset is atomic, removes source probe evidence, and does not transfer it", () => {
  const source = textBeat("beat-a", [model, image]);
  source.animationProbeLinks = [
    { assetId: model.id, associationSource: "direct" },
    { assetId: image.id, associationSource: "direct" },
  ];
  source.probePromotedVisual = true;
  const graph = fixtureGraph([source, textBeat("beat-b")]);

  const result = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "beat-a",
    targetBeatId: "beat-b",
  });

  assert.equal(result.reason, "moved");
  assert.deepEqual(result.affectedBeatIds, ["beat-a", "beat-b"]);
  for (const sourceRecord of [graph.beats[0], graph.atomicBeats[0]]) {
    assert.deepEqual(linkedAssetIds(sourceRecord), [image.id]);
    assert.deepEqual(sourceRecord.animationProbeLinks.map((link) => link.assetId), [image.id]);
    assert.equal(sourceRecord.probePromotedVisual, true);
    assert.equal(sourceRecord.isTextOnly, false);
  }
  for (const targetRecord of [graph.beats[1], graph.atomicBeats[1]]) {
    assert.deepEqual(linkedAssetIds(targetRecord), [model.id]);
    assert.equal(targetRecord.animationProbeLinks, undefined);
    assert.equal(targetRecord.probePromotedVisual, undefined);
    assert.equal(targetRecord.isTextOnly, false);
  }
});

test("unlinking the last visual restores a source text beat and its atomic record", () => {
  const source = textBeat("authored-a", [model]);
  source.atomicBeatIds = ["atomic-a"];
  source.animationProbeLinks = [{ assetId: model.id, associationSource: "inferred" }];
  source.probePromotedVisual = true;
  const atomic = { ...structuredClone(source), id: "atomic-a", atomicBeatIds: ["atomic-a"] };
  const graph = fixtureGraph([source]);
  graph.atomicBeats = [atomic];

  const result = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "authored-a",
    targetBeatId: null,
  });

  assert.equal(result.reason, "unlinked");
  assert.deepEqual(result.affectedBeatIds, ["authored-a"]);
  for (const record of [graph.beats[0], graph.atomicBeats[0]]) {
    assert.deepEqual(record.linkedAssets, []);
    assert.equal(record.animationProbeLinks, undefined);
    assert.equal(record.probePromotedVisual, undefined);
    assert.equal(record.sourceWasTextOnly, true);
    assert.equal(record.isTextOnly, true);
  }
});

test("stale beat and variant asset references can still be dragged out to unlink", () => {
  const staleAssetId = "missing-from-inventory.glb";
  const beatGraph = fixtureGraph([textBeat("beat-a", [staleAssetId]), textBeat("beat-b")]);

  const beatResult = transferSourceGraphAsset(beatGraph, {
    assetId: staleAssetId,
    sourceBeatId: "beat-a",
  });
  assert.equal(beatResult.reason, "unlinked");
  assert.equal(beatResult.changed, true);
  for (const record of [beatGraph.beats[0], beatGraph.atomicBeats[0]]) {
    assert.deepEqual(record.linkedAssets, []);
    assert.equal(record.isTextOnly, true);
  }

  const variantGraph = fixtureGraph();
  variantGraph.beats[0].variantGroupId = "group-a";
  variantGraph.beats[0].sourceWasTextOnly = true;
  variantGraph.beats[0].isTextOnly = false;
  variantGraph.atomicBeats[0].variantGroupId = "group-a";
  variantGraph.atomicBeats[0].sourceWasTextOnly = true;
  variantGraph.atomicBeats[0].isTextOnly = false;
  variantGraph.variantGroups = [{
    id: "group-a",
    beatId: "beat-a",
    options: [{ id: "option-one", assetIds: [staleAssetId] }],
  }];

  const variantResult = transferSourceGraphAsset(variantGraph, {
    assetId: staleAssetId,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
  });
  assert.equal(variantResult.reason, "unlinked");
  assert.equal(variantResult.changed, true);
  assert.deepEqual(variantGraph.variantGroups[0].options[0].assetIds, []);
  for (const record of [variantGraph.beats[0], variantGraph.atomicBeats[0]]) {
    assert.equal(record.isTextOnly, true);
  }

  variantGraph.variantGroups[0].options[0].assetIds = [staleAssetId];
  const beforeMove = structuredClone(variantGraph);
  const rejectedMove = transferSourceGraphAsset(variantGraph, {
    assetId: staleAssetId,
    sourceVariantGroupId: "group-a",
    sourceVariantOptionId: "option-one",
    targetBeatId: "beat-b",
  });
  assert.equal(rejectedMove.reason, "unknown-asset");
  assert.deepEqual(variantGraph, beforeMove);
});

test("duplicates, same-beat drops, cancellations, and unknown endpoints are no-ops", () => {
  const graph = fixtureGraph([textBeat("beat-a", [model]), textBeat("beat-b", [model])]);
  const before = structuredClone(graph);

  assert.equal(transferSourceGraphAsset(graph, { assetId: model.id, targetBeatId: "beat-a" }).reason, "duplicate");
  assert.equal(transferSourceGraphAsset(graph, { assetId: model.id, sourceBeatId: "beat-a", targetBeatId: "beat-a" }).reason, "same-beat");
  assert.equal(transferSourceGraphAsset(graph, { assetId: model.id }).reason, "cancelled");
  assert.equal(transferSourceGraphAsset(graph, { assetId: "missing.glb", targetBeatId: "beat-a" }).reason, "unknown-asset");
  assert.equal(transferSourceGraphAsset(graph, { assetId: model.id, sourceBeatId: "missing", targetBeatId: "beat-a" }).reason, "unknown-source-beat");
  assert.equal(transferSourceGraphAsset(graph, { assetId: model.id, sourceBeatId: "beat-a", targetBeatId: "missing" }).reason, "unknown-target-beat");
  assert.deepEqual(graph, before);
});

test("a duplicate move target leaves the source linked", () => {
  const graph = fixtureGraph([textBeat("beat-a", [model]), textBeat("beat-b", [model])]);
  const before = structuredClone(graph);
  const result = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "beat-a",
    targetBeatId: "beat-b",
  });

  assert.equal(result.changed, false);
  assert.equal(result.reason, "duplicate");
  assert.deepEqual(graph, before);
});

test("combined beats support library links, moves, and unlinks across every atomic child", () => {
  const combined = {
    ...textBeat("combined-a-b"),
    isCombined: true,
    subtype: "combined",
    atomicBeatIds: ["beat-a", "beat-b"],
  };
  const graph = {
    assetInventory: [model, image],
    beats: [structuredClone(combined), textBeat("beat-c")],
    atomicBeats: [textBeat("beat-a"), textBeat("beat-b"), textBeat("beat-c")],
    variantGroups: [],
  };

  const linked = transferSourceGraphAsset(graph, {
    assetId: model.id,
    targetBeatId: "combined-a-b",
  });
  assert.equal(linked.changed, true);
  assert.equal(linked.reason, "linked");
  for (const record of [graph.beats[0], graph.atomicBeats[0], graph.atomicBeats[1]]) {
    assert.deepEqual(linkedAssetIds(record), [model.id]);
    assert.strictEqual(record.linkedAssets[0], graph.assetInventory[0]);
    assert.equal(record.isTextOnly, false);
    assert.equal(record.sourceWasTextOnly, true);
  }

  const beforeDuplicate = structuredClone(graph);
  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    targetBeatId: "combined-a-b",
  }).reason, "duplicate");
  assert.deepEqual(graph, beforeDuplicate);

  for (const record of [graph.beats[0], graph.atomicBeats[0], graph.atomicBeats[1]]) {
    record.animationProbeLinks = [{ assetId: model.id, associationSource: "direct" }];
    record.probePromotedVisual = true;
  }
  const movedFromCombined = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "combined-a-b",
    targetBeatId: "beat-c",
  });
  assert.equal(movedFromCombined.changed, true);
  assert.equal(movedFromCombined.reason, "moved");
  assert.deepEqual(movedFromCombined.affectedBeatIds, ["combined-a-b", "beat-c"]);
  for (const record of [graph.beats[0], graph.atomicBeats[0], graph.atomicBeats[1]]) {
    assert.deepEqual(record.linkedAssets, []);
    assert.equal(record.animationProbeLinks, undefined);
    assert.equal(record.probePromotedVisual, undefined);
    assert.equal(record.isTextOnly, true);
  }
  for (const record of [graph.beats[1], graph.atomicBeats[2]]) {
    assert.deepEqual(linkedAssetIds(record), [model.id]);
    assert.equal(record.animationProbeLinks, undefined);
    assert.equal(record.probePromotedVisual, undefined);
    assert.equal(record.isTextOnly, false);
  }

  const movedToCombined = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "beat-c",
    targetBeatId: "combined-a-b",
  });
  assert.equal(movedToCombined.changed, true);
  assert.equal(movedToCombined.reason, "moved");
  for (const record of [graph.beats[0], graph.atomicBeats[0], graph.atomicBeats[1]]) {
    assert.deepEqual(linkedAssetIds(record), [model.id]);
    assert.equal(record.isTextOnly, false);
  }
  for (const record of [graph.beats[1], graph.atomicBeats[2]]) {
    assert.deepEqual(record.linkedAssets, []);
    assert.equal(record.isTextOnly, true);
  }

  const unlinked = transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "combined-a-b",
  });
  assert.equal(unlinked.changed, true);
  assert.equal(unlinked.reason, "unlinked");
  for (const record of [graph.beats[0], graph.atomicBeats[0], graph.atomicBeats[1]]) {
    assert.deepEqual(record.linkedAssets, []);
    assert.equal(record.isTextOnly, true);
  }
});

test("source images and variant option assets keep an unlinked text-origin beat visual", () => {
  const sourceImageBeat = textBeat("image-beat", [image]);
  sourceImageBeat.sourceImageLinked = true;
  const variantBeat = textBeat("variant-beat", [model]);
  variantBeat.variantGroupId = "specimen-options";
  const graph = fixtureGraph([sourceImageBeat, variantBeat]);
  graph.variantGroups = [{
    id: "specimen-options",
    beatId: "variant-beat",
    options: [{ id: "one", assetIds: [image.id] }],
  }];

  assert.equal(transferSourceGraphAsset(graph, {
    assetId: image.id,
    sourceBeatId: "image-beat",
  }).changed, true);
  assert.equal(transferSourceGraphAsset(graph, {
    assetId: model.id,
    sourceBeatId: "variant-beat",
  }).changed, true);

  for (const record of [graph.beats[0], graph.atomicBeats[0], graph.beats[1], graph.atomicBeats[1]]) {
    assert.equal(record.isTextOnly, false);
    assert.equal(record.sourceWasTextOnly, true);
  }
});
