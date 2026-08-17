export const CUMULATIVE_PREVIEW_LAYER_ORDER = [
  "topology",
  "environment-enhancement",
  "spatial-relations",
  "dynamic-geometry",
  "inter-beat-dynamics",
  "attention-guidance",
  "interaction-control",
];

const CUMULATIVE_PREVIEW_LAYERS_BY_COMPONENT = {
  "asset-topology": ["topology"],
  "environment-enhancement": ["topology", "environment-enhancement"],
  "spatial-relations": ["topology", "environment-enhancement", "spatial-relations"],
  "text-comfort": ["topology", "environment-enhancement", "spatial-relations"],
  "dynamic-geometry": ["topology", "environment-enhancement", "spatial-relations", "dynamic-geometry"],
  "inter-beat-dynamics": ["topology", "environment-enhancement", "spatial-relations", "dynamic-geometry", "inter-beat-dynamics"],
  "attention-guidance": ["topology", "environment-enhancement", "spatial-relations", "dynamic-geometry", "inter-beat-dynamics", "attention-guidance"],
  "interaction-control": CUMULATIVE_PREVIEW_LAYER_ORDER,
  "transition-pacing": CUMULATIVE_PREVIEW_LAYER_ORDER,
};

export function cumulativePreviewLayerIds(componentId) {
  return [...(CUMULATIVE_PREVIEW_LAYERS_BY_COMPONENT[componentId] || [])];
}

export function cumulativePreviewLayerMap(componentId) {
  const ids = new Set(cumulativePreviewLayerIds(componentId));
  return Object.fromEntries(CUMULATIVE_PREVIEW_LAYER_ORDER.map((id) => [id, ids.has(id)]));
}
