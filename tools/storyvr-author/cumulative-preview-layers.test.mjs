import assert from "node:assert/strict";

import {
  CUMULATIVE_PREVIEW_LAYER_ORDER,
  cumulativePreviewLayerIds,
  cumulativePreviewLayerMap,
} from "./app/src/cumulative-preview-layers.js";

const expected = {
  "asset-topology": ["topology", "topology-viewpoint"],
  "environment-enhancement": ["topology", "topology-viewpoint", "environment-enhancement"],
  "spatial-relations": ["topology", "topology-viewpoint", "environment-enhancement", "spatial-relations"],
  "attention-guidance": ["topology", "topology-viewpoint", "environment-enhancement", "spatial-relations", "attention-guidance"],
  "dynamic-geometry": ["topology", "topology-viewpoint", "environment-enhancement", "spatial-relations", "attention-guidance", "dynamic-geometry"],
  "inter-beat-dynamics": ["topology", "topology-viewpoint", "environment-enhancement", "spatial-relations", "attention-guidance", "dynamic-geometry", "inter-beat-dynamics"],
  "interaction-control": [
    "topology",
    "topology-viewpoint",
    "environment-enhancement",
    "spatial-relations",
    "attention-guidance",
    "dynamic-geometry",
    "inter-beat-dynamics",
    "interaction-control",
  ],
  "transition-pacing": CUMULATIVE_PREVIEW_LAYER_ORDER,
};

for (const [componentId, layerIds] of Object.entries(expected)) {
  assert.deepEqual(cumulativePreviewLayerIds(componentId), layerIds, `${componentId} layer order`);

  const map = cumulativePreviewLayerMap(componentId);
  for (const id of CUMULATIVE_PREVIEW_LAYER_ORDER) {
    assert.equal(map[id], layerIds.includes(id), `${componentId} ${id} enabled`);
  }
}

assert.deepEqual(cumulativePreviewLayerIds("reader-viewpoint"), [], "Reader Viewpoint is not part of the current generic pipeline");
assert.deepEqual(cumulativePreviewLayerIds("text-comfort"), expected["spatial-relations"], "legacy Text Comfort resolves to Spatial Relations layers");
assert.deepEqual(cumulativePreviewLayerMap("unknown-component"), Object.fromEntries(CUMULATIVE_PREVIEW_LAYER_ORDER.map((id) => [id, false])));

console.log("cumulative preview layer helper checks passed");
