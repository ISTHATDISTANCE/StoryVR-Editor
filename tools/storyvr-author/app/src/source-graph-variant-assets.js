export function variantOptionAssetIds(option) {
  const values = Array.isArray(option?.assetIds)
    ? option.assetIds
    : Array.isArray(option?.asset_ids)
      ? option.asset_ids
      : [];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function variantAssetIdsForBeat(graph, beat, visibleBeat = beat) {
  const beatIds = new Set([
    normalizedId(beat?.id),
    normalizedId(visibleBeat?.id),
    ...atomicBeatIds(beat),
    ...atomicBeatIds(visibleBeat),
  ].filter(Boolean));
  const variantGroupIds = new Set([
    normalizedId(beat?.variantGroupId),
    normalizedId(visibleBeat?.variantGroupId),
  ].filter(Boolean));
  const values = [];
  for (const group of Array.isArray(graph?.variantGroups) ? graph.variantGroups : []) {
    if (!beatIds.has(normalizedId(group?.beatId)) && !variantGroupIds.has(normalizedId(group?.id))) continue;
    for (const option of Array.isArray(group?.options) ? group.options : []) {
      values.push(...variantOptionAssetIds(option));
    }
  }
  return [...new Set(values)];
}

export function variantOptionForGraph(graph, groupId, optionId) {
  const group = (Array.isArray(graph?.variantGroups) ? graph.variantGroups : [])
    .find((candidate) => String(candidate?.id || "") === String(groupId || ""));
  if (!group) return null;
  return (Array.isArray(group.options) ? group.options : [])
    .find((candidate) => String(candidate?.id || "") === String(optionId || "")) || null;
}

export function addVariantOptionAsset(graph, groupId, optionId, assetId) {
  const option = variantOptionForGraph(graph, groupId, optionId);
  const normalizedAssetId = String(assetId || "").trim();
  if (!option || !normalizedAssetId) return false;
  const assetIds = variantOptionAssetIds(option);
  if (assetIds.includes(normalizedAssetId)) return false;
  option.assetIds = [...assetIds, normalizedAssetId];
  delete option.asset_ids;
  return true;
}

export function removeVariantOptionAsset(graph, groupId, optionId, assetId) {
  const option = variantOptionForGraph(graph, groupId, optionId);
  const normalizedAssetId = String(assetId || "").trim();
  if (!option || !normalizedAssetId) return false;
  const assetIds = variantOptionAssetIds(option);
  if (!assetIds.includes(normalizedAssetId)) return false;
  option.assetIds = assetIds.filter((candidate) => candidate !== normalizedAssetId);
  delete option.asset_ids;
  return true;
}

function normalizedId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value).trim() || null;
}

function atomicBeatIds(beat) {
  const values = Array.isArray(beat?.atomicBeatIds) && beat.atomicBeatIds.length
    ? beat.atomicBeatIds
    : [beat?.id];
  return values.map(normalizedId).filter(Boolean);
}
