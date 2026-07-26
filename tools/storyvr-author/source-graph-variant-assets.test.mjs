import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addVariantOptionAsset,
  removeVariantOptionAsset,
  variantAssetIdsForBeat,
  variantOptionAssetIds,
  variantOptionForGraph,
} from "./app/src/source-graph-variant-assets.js";

function fixtureGraph() {
  return {
    variantGroups: [{
      id: "specimen-selector",
      beatId: "slide-5",
      options: [
        { id: "bedbug", label: "Bedbug", assetIds: ["bedbug.glb"] },
        { id: "mosquito", label: "Mosquito", asset_ids: ["mosquito.glb", "mosquito.glb"] },
      ],
    }],
  };
}

test("variant option asset edits target only the selected option and normalize asset_ids", () => {
  const graph = fixtureGraph();

  assert.deepEqual(variantOptionAssetIds(graph.variantGroups[0].options[1]), ["mosquito.glb"]);
  assert.equal(addVariantOptionAsset(graph, "specimen-selector", "mosquito", "mosquito-closeup.png"), true);
  assert.deepEqual(graph.variantGroups[0].options[1].assetIds, ["mosquito.glb", "mosquito-closeup.png"]);
  assert.equal("asset_ids" in graph.variantGroups[0].options[1], false);
  assert.deepEqual(graph.variantGroups[0].options[0].assetIds, ["bedbug.glb"]);

  assert.equal(removeVariantOptionAsset(graph, "specimen-selector", "mosquito", "mosquito.glb"), true);
  assert.deepEqual(graph.variantGroups[0].options[1].assetIds, ["mosquito-closeup.png"]);
  assert.equal(addVariantOptionAsset(graph, "specimen-selector", "mosquito", "mosquito-closeup.png"), false);
});

test("variant option asset edits reject missing groups, options, and empty asset ids", () => {
  const graph = fixtureGraph();

  assert.equal(variantOptionForGraph(graph, "missing", "bedbug"), null);
  assert.equal(addVariantOptionAsset(graph, "missing", "bedbug", "new.glb"), false);
  assert.equal(addVariantOptionAsset(graph, "specimen-selector", "missing", "new.glb"), false);
  assert.equal(addVariantOptionAsset(graph, "specimen-selector", "bedbug", "  "), false);
  assert.equal(removeVariantOptionAsset(graph, "specimen-selector", "bedbug", "missing.glb"), false);
  assert.deepEqual(graph, fixtureGraph());
});

test("variant assets resolve for visible, grouped, and combined host beats", () => {
  const graph = fixtureGraph();

  assert.deepEqual(
    variantAssetIdsForBeat(graph, { id: "slide-5" }),
    ["bedbug.glb", "mosquito.glb"],
  );
  assert.deepEqual(
    variantAssetIdsForBeat(graph, { id: "authored-host", variantGroupId: "specimen-selector" }),
    ["bedbug.glb", "mosquito.glb"],
  );
  assert.deepEqual(
    variantAssetIdsForBeat(graph, { id: "combined-host", atomicBeatIds: ["slide-4", "slide-5"] }),
    ["bedbug.glb", "mosquito.glb"],
  );
  assert.deepEqual(variantAssetIdsForBeat(graph, { id: "unrelated" }), []);
});

test("Source Graph renders only per-option assignment endpoints for variant beats", async () => {
  const [source, canvasSource] = await Promise.all([
    readFile(new URL("./app/src/main.js", import.meta.url), "utf8"),
    readFile(new URL("./app/src/source-graph-canvas.js", import.meta.url), "utf8"),
  ]);
  const editor = source.match(/function renderGraphEditor\(\) \{[\s\S]*?\nfunction renderSourceGraphStatus/)?.[0] || "";
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphCanvasEvents\([\s\S]*?\nfunction sourceGraphDragPayloadFromDataTransfer/)?.[0] || "";

  assert.doesNotMatch(editor, /source-graph-inspector/);
  assert.doesNotMatch(editor, /renderBeatDetailPanel/);
  assert.doesNotMatch(timeline, /data-variant-option-editor/);
  assert.doesNotMatch(timeline, /data-variant-asset-select/);
  assert.doesNotMatch(timeline, /data-add-variant-asset/);
  assert.doesNotMatch(timeline, /data-remove-variant-asset/);
  assert.match(timeline, /data-source-graph-variant-drop/);
  assert.match(timeline, /data-source-graph-beat-drop/);
  assert.doesNotMatch(timeline, /Every variant/);
  assert.doesNotMatch(timeline, /show in every variant/);
  assert.match(canvasSource, /beat\.linkedAssets =/);
  assert.match(source, /transferSourceGraphAsset/);
  assert.match(bindings, /targetVariantGroupId/);
  assert.match(bindings, /sourceVariantGroupId/);
  assert.match(bindings, /targetBeatId: dropTarget\.dataset\.sourceGraphBeatDrop/);
  assert.match(source, /targetVariantGroupId: group\.id/);
  assert.match(source, /targetVariantOptionId: option\.id/);
  assert.match(canvasSource, /addVariantOptionAsset\(graph/);
  assert.match(canvasSource, /removeVariantOptionAsset\(graph/);
});
