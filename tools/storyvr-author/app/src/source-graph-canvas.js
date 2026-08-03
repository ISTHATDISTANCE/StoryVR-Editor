import {
  addVariantOptionAsset,
  removeVariantOptionAsset,
  variantAssetIdsForBeat,
  variantOptionAssetIds,
} from "./source-graph-variant-assets.js";

const SOURCE_GRAPH_ASSET_DRAG_TYPE = "storyvr-source-graph-asset";
const SOURCE_GRAPH_CARD_DRAG_TYPE = "storyvr-source-graph-card";
const SOURCE_GRAPH_REORDER_DRAG_TYPE = "storyvr-source-graph-reorder";
const SOURCE_GRAPH_TRANSITION_SCHEMA_VERSION = "storyvr-source-transition/v1";
const SOURCE_GRAPH_CARD_SIDES = new Set(["top", "right", "bottom", "left"]);

export function sourceGraphTransitionEdges(graph, { includeImplicit = true } = {}) {
  const explicit = Array.isArray(graph?.edges);
  const rawEdges = explicit
    ? graph.edges
    : includeImplicit
      ? implicitSourceGraphTransitions(graph)
      : [];
  const normalizedEdges = normalizeSourceGraphTransitionEdges(graph, rawEdges);
  return explicit
    ? normalizeSourceGraphTransitionEdges(
      graph,
      expandLegacyVariantProgressionEdges(graph, normalizedEdges),
    )
    : normalizedEdges;
}

export function migrateSourceGraphVariantProgressionEdges(graph) {
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.edges)) {
    return {
      changed: false,
      reason: "implicit-transitions",
      edges: Array.isArray(graph?.edges) ? graph.edges : [],
    };
  }
  const before = JSON.stringify(graph.edges);
  graph.edges = sourceGraphTransitionEdges(graph);
  const changed = before !== JSON.stringify(graph.edges);
  return {
    changed,
    reason: changed ? "migrated" : "already-canonical",
    edges: graph.edges,
  };
}

function normalizeSourceGraphTransitionEdges(graph, rawEdges) {
  const seen = new Set();
  return rawEdges.flatMap((edge, index) => {
    const normalized = normalizeSourceGraphTransition(edge, index);
    if (!normalized || !sourceGraphTransitionEndpointExists(graph, normalized.from)
      || !sourceGraphTransitionEndpointExists(graph, normalized.to)
      || sameCardEndpoint(normalized.from, normalized.to)) {
      return [];
    }
    const key = sourceGraphTransitionEndpointPairKey(normalized.from, normalized.to);
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

export function canConnectSourceGraphCards(graph, source, target) {
  const from = normalizeCardEndpoint(source);
  const to = normalizeCardEndpoint(target);
  return Boolean(
    from
    && to
    && !sameCardEndpoint(from, to)
    && sourceGraphTransitionEndpointExists(graph, from)
    && sourceGraphTransitionEndpointExists(graph, to),
  );
}

export function connectSourceGraphCards(graph, {
  source,
  target,
  sourceSide: rawSourceSide = "right",
  targetSide: rawTargetSide = "left",
} = {}) {
  const from = normalizeCardEndpoint(source);
  const to = normalizeCardEndpoint(target);
  const sourceSide = normalizeSourceGraphCardSide(rawSourceSide, "right");
  const targetSide = normalizeSourceGraphCardSide(rawTargetSide, "left");
  const unchanged = (reason, edge = null, extra = {}) => ({
    changed: false,
    reason,
    edge,
    materializedImplicitCount: 0,
    ...extra,
  });
  if (!graph || typeof graph !== "object" || !from || !to) return unchanged("invalid-connection");
  if (sameCardEndpoint(from, to)) return unchanged("same-card");
  if (!sourceGraphTransitionEndpointExists(graph, from)) return unchanged("unknown-source-card");
  if (!sourceGraphTransitionEndpointExists(graph, to)) return unchanged("unknown-target-card");

  const hadExplicitEdges = Array.isArray(graph.edges);
  const materialized = hadExplicitEdges ? sourceGraphTransitionEdges(graph) : implicitSourceGraphTransitions(graph);
  const materializedImplicitCount = hadExplicitEdges ? 0 : materialized.length;
  graph.edges = materialized;
  const pairKey = sourceGraphTransitionEndpointPairKey(from, to);
  const existingIndex = graph.edges.findIndex((edge) => {
    const normalized = normalizeSourceGraphTransition(edge);
    return normalized && sourceGraphTransitionEndpointPairKey(normalized.from, normalized.to) === pairKey;
  });
  if (existingIndex >= 0) {
    const existing = normalizeSourceGraphTransition(graph.edges[existingIndex], existingIndex);
    const sameSides = existing.from.side === sourceSide && existing.to.side === targetSide;
    if (sameSides) {
      return {
        changed: !hadExplicitEdges,
        reason: hadExplicitEdges ? "duplicate" : "materialized",
        edge: existing,
        materializedImplicitCount,
      };
    }
    const rerouted = {
      ...existing,
      from: { ...existing.from, side: sourceSide },
      to: { ...existing.to, side: targetSide },
    };
    graph.edges[existingIndex] = rerouted;
    return {
      changed: true,
      reason: "rerouted",
      edge: rerouted,
      materializedImplicitCount,
    };
  }

  const edge = {
    schemaVersion: SOURCE_GRAPH_TRANSITION_SCHEMA_VERSION,
    id: uniqueSourceGraphTransitionId(graph.edges, from, to),
    kind: "transition",
    from: { ...from, side: sourceSide },
    to: { ...to, side: targetSide },
  };
  graph.edges.push(edge);
  return {
    changed: true,
    reason: "connected",
    edge,
    materializedImplicitCount,
  };
}

export function removeSourceGraphTransition(graph, edgeId) {
  const normalizedEdgeId = normalizedId(edgeId);
  if (!graph || typeof graph !== "object" || !normalizedEdgeId) {
    return { changed: false, reason: "unknown-edge", edgeId: normalizedEdgeId };
  }
  if (!Array.isArray(graph.edges)) graph.edges = implicitSourceGraphTransitions(graph);
  else migrateSourceGraphVariantProgressionEdges(graph);
  const index = graph.edges.findIndex((edge) => normalizedId(edge?.id) === normalizedEdgeId);
  if (index < 0) return { changed: false, reason: "unknown-edge", edgeId: normalizedEdgeId };
  const [removed] = graph.edges.splice(index, 1);
  return {
    changed: true,
    reason: "removed",
    edgeId: normalizedEdgeId,
    edge: normalizeSourceGraphTransition(removed, index),
  };
}

export function pruneSourceGraphTransitions(graph) {
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.edges)) {
    return { changed: false, removedCount: 0, edges: [] };
  }
  const before = JSON.stringify(graph.edges);
  const previousCount = graph.edges.length;
  graph.edges = sourceGraphTransitionEdges(graph);
  return {
    changed: before !== JSON.stringify(graph.edges),
    removedCount: Math.max(0, previousCount - graph.edges.length),
    edges: graph.edges,
  };
}

export function remapSourceGraphTransitionCards(graph, replacements = []) {
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.edges)) {
    return { changed: false, remappedCount: 0, removedCount: 0, edges: [] };
  }
  const replacementByCard = new Map((Array.isArray(replacements) ? replacements : []).flatMap((replacement) => {
    const card = normalizeCardEndpoint(replacement?.card || replacement?.endpoint || replacement?.fromCard);
    if (!card) return [];
    const shared = normalizeCardEndpoint(replacement?.replacement || replacement?.toCard);
    const from = normalizeCardEndpoint(replacement?.from || replacement?.outgoing) || shared;
    const to = normalizeCardEndpoint(replacement?.to || replacement?.incoming) || shared;
    if (!from && !to) return [];
    return [[sourceGraphTransitionEndpointKey(card), { from, to }]];
  }));
  if (!replacementByCard.size) return { changed: false, remappedCount: 0, removedCount: 0, edges: graph.edges };

  const before = JSON.stringify(graph.edges);
  const previousCount = graph.edges.length;
  let remappedCount = 0;
  graph.edges = graph.edges.flatMap((edge, index) => {
    const normalized = normalizeSourceGraphTransition(edge, index);
    if (!normalized) return [];
    const fromReplacement = replacementByCard.get(sourceGraphTransitionEndpointKey(normalized.from))?.from;
    const toReplacement = replacementByCard.get(sourceGraphTransitionEndpointKey(normalized.to))?.to;
    if (fromReplacement) {
      normalized.from = { ...fromReplacement, side: normalized.from.side };
      remappedCount += 1;
    }
    if (toReplacement) {
      normalized.to = { ...toReplacement, side: normalized.to.side };
      remappedCount += 1;
    }
    return [normalized];
  });
  graph.edges = sourceGraphTransitionEdges(graph);
  return {
    changed: before !== JSON.stringify(graph.edges),
    remappedCount,
    removedCount: Math.max(0, previousCount - graph.edges.length),
    edges: graph.edges,
  };
}

export function encodeSourceGraphCardDragPayload(payload) {
  const endpoint = normalizeCardEndpoint(payload);
  return endpoint ? JSON.stringify({ type: SOURCE_GRAPH_CARD_DRAG_TYPE, ...endpoint }) : "";
}

export function decodeSourceGraphCardDragPayload(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type !== SOURCE_GRAPH_CARD_DRAG_TYPE) return null;
    return normalizeCardEndpoint(parsed);
  } catch {
    return null;
  }
}

export function encodeSourceGraphReorderDragPayload(payload) {
  const reorderKind = String(payload?.reorderKind || "").trim();
  const beatId = normalizedId(payload?.beatId);
  if (reorderKind === "beat" && beatId) {
    return JSON.stringify({ type: SOURCE_GRAPH_REORDER_DRAG_TYPE, reorderKind, beatId });
  }
  const variantGroupId = normalizedId(payload?.variantGroupId);
  const variantOptionId = normalizedId(payload?.variantOptionId);
  if (reorderKind === "variant" && beatId && variantGroupId && variantOptionId) {
    return JSON.stringify({
      type: SOURCE_GRAPH_REORDER_DRAG_TYPE,
      reorderKind,
      beatId,
      variantGroupId,
      variantOptionId,
    });
  }
  return "";
}

export function decodeSourceGraphReorderDragPayload(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type !== SOURCE_GRAPH_REORDER_DRAG_TYPE) return null;
    const encoded = encodeSourceGraphReorderDragPayload(parsed);
    if (!encoded) return null;
    const normalized = JSON.parse(encoded);
    delete normalized.type;
    return normalized;
  } catch {
    return null;
  }
}

export function canReorderSourceGraphBeat(graph, options = {}) {
  return reorderSourceGraphBeatResult(graph, options).changed;
}

export function reorderSourceGraphBeat(graph, options = {}) {
  const result = reorderSourceGraphBeatResult(graph, options);
  if (!result.changed) return result;
  graph.beats = result.beats;
  delete result.beats;
  return result;
}

function reorderSourceGraphBeatResult(graph, {
  sourceBeatId: rawSourceBeatId,
  targetBeatId: rawTargetBeatId,
  placement: rawPlacement = "before",
} = {}) {
  const sourceBeatId = normalizedId(rawSourceBeatId);
  const targetBeatId = normalizedId(rawTargetBeatId);
  const placement = rawPlacement === "before" || rawPlacement === "after" ? rawPlacement : null;
  const unchanged = (reason) => ({
    changed: false,
    reason,
    reorderKind: "beat",
    sourceBeatId,
    targetBeatId,
    placement,
  });
  if (!graph || typeof graph !== "object" || !sourceBeatId || !targetBeatId || !placement) {
    return unchanged("invalid-reorder");
  }
  const beats = Array.isArray(graph.beats) ? graph.beats : [];
  const sourceIndex = beats.findIndex((beat) => normalizedId(beat?.id) === sourceBeatId);
  const targetIndex = beats.findIndex((beat) => normalizedId(beat?.id) === targetBeatId);
  if (sourceIndex < 0) return unchanged("unknown-source-beat");
  if (targetIndex < 0) return unchanged("unknown-target-beat");

  let insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
  if (sourceIndex < insertionIndex) insertionIndex -= 1;
  if (insertionIndex === sourceIndex) return unchanged("already-positioned");

  const next = [...beats];
  const [sourceBeat] = next.splice(sourceIndex, 1);
  next.splice(insertionIndex, 0, sourceBeat);
  return {
    ...unchanged("reordered"),
    changed: true,
    previousIndex: sourceIndex,
    nextIndex: insertionIndex,
    beats: next,
  };
}

export function canReorderSourceGraphVariant(graph, options = {}) {
  return reorderSourceGraphVariantResult(graph, options).changed;
}

export function reorderSourceGraphVariant(graph, options = {}) {
  const result = reorderSourceGraphVariantResult(graph, options);
  if (!result.changed) return result;
  result.group.options = result.options;
  delete result.group;
  delete result.options;
  return result;
}

function reorderSourceGraphVariantResult(graph, {
  variantGroupId: rawVariantGroupId,
  sourceVariantOptionId: rawSourceVariantOptionId,
  afterOptionId: rawAfterOptionId,
} = {}) {
  const variantGroupId = normalizedId(rawVariantGroupId);
  const sourceVariantOptionId = normalizedId(rawSourceVariantOptionId);
  const afterOptionId = normalizedId(rawAfterOptionId);
  const unchanged = (reason) => ({
    changed: false,
    reason,
    reorderKind: "variant",
    variantGroupId,
    sourceVariantOptionId,
    afterOptionId,
  });
  if (!graph || typeof graph !== "object" || !variantGroupId || !sourceVariantOptionId || !afterOptionId) {
    return unchanged("invalid-reorder");
  }
  const group = (Array.isArray(graph.variantGroups) ? graph.variantGroups : [])
    .find((candidate) => normalizedId(candidate?.id) === variantGroupId);
  if (!group) return unchanged("unknown-variant-group");
  const options = displayedVariantOptions(group);
  const sourceIndex = options.findIndex((option) => normalizedId(option?.id) === sourceVariantOptionId);
  const anchorIndex = options.findIndex((option) => normalizedId(option?.id) === afterOptionId);
  if (sourceIndex < 0) return unchanged("unknown-source-variant");
  if (anchorIndex < 0) return unchanged("unknown-target-variant");
  if (sourceVariantOptionId === normalizedId(group.defaultOptionId)) {
    return unchanged("default-option-pinned");
  }

  let insertionIndex = anchorIndex + 1;
  if (sourceIndex < insertionIndex) insertionIndex -= 1;
  if (insertionIndex === sourceIndex) return unchanged("already-positioned");

  const next = [...options];
  const [sourceOption] = next.splice(sourceIndex, 1);
  next.splice(insertionIndex, 0, sourceOption);
  const anchorOption = options[anchorIndex];
  return {
    ...unchanged("reordered"),
    changed: true,
    beatId: normalizedId(group.beatId),
    sourceLabel: String(sourceOption?.label || sourceOption?.id || "variant").trim(),
    afterLabel: String(anchorOption?.label || anchorOption?.id || "variant").trim(),
    previousIndex: sourceIndex,
    nextIndex: insertionIndex,
    group,
    options: reindexVariantOptions(next),
  };
}

export function canCombineSourceGraphCards(source, target) {
  const from = normalizeCardEndpoint(source);
  const to = normalizeCardEndpoint(target);
  if (!from || !to) return false;
  if (from.cardKind === "beat" && to.cardKind === "variant") {
    return from.beatId !== to.beatId;
  }
  if (from.cardKind !== to.cardKind) return false;
  if (from.cardKind === "beat") return from.beatId !== to.beatId;
  return from.variantGroupId === to.variantGroupId
    && from.variantOptionId !== to.variantOptionId;
}

export function canPlaceSourceGraphBeatAsVariant(graph, {
  sourceBeatId: rawSourceBeatId,
  targetBeatId: rawTargetBeatId,
} = {}) {
  const sourceBeatId = normalizedId(rawSourceBeatId);
  const targetBeatId = normalizedId(rawTargetBeatId);
  if (!graph || typeof graph !== "object" || !sourceBeatId || !targetBeatId || sourceBeatId === targetBeatId) {
    return false;
  }
  const sourceBeat = visibleBeatById(graph, sourceBeatId);
  const targetBeat = visibleBeatById(graph, targetBeatId);
  return Boolean(
    sourceBeat
    && targetBeat
    && !variantGroupForVisibleBeat(graph, sourceBeat)
  );
}

export function placeSourceGraphBeatAsVariant(graph, {
  sourceBeatId: rawSourceBeatId,
  targetBeatId: rawTargetBeatId,
  afterOptionId: rawAfterOptionId = null,
} = {}) {
  const sourceBeatId = normalizedId(rawSourceBeatId);
  const targetBeatId = normalizedId(rawTargetBeatId);
  const afterOptionId = normalizedId(rawAfterOptionId);
  const unchanged = (reason) => variantPlacementResult(false, reason, {
    sourceBeatId,
    targetBeatId,
    afterOptionId,
  });
  if (!graph || typeof graph !== "object" || !sourceBeatId || !targetBeatId) {
    return unchanged("invalid-placement");
  }
  if (sourceBeatId === targetBeatId) return unchanged("same-beat");

  const sourceBeat = visibleBeatById(graph, sourceBeatId);
  if (!sourceBeat) return unchanged("unknown-source-beat");
  const targetBeat = visibleBeatById(graph, targetBeatId);
  if (!targetBeat) return unchanged("unknown-target-beat");
  if (variantGroupForVisibleBeat(graph, sourceBeat)) return unchanged("source-already-variant");

  const targetGroup = variantGroupForVisibleBeat(graph, targetBeat);
  let anchorOption = null;
  if (targetGroup) {
    if (!afterOptionId) return unchanged("target-option-required");
    anchorOption = (Array.isArray(targetGroup.options) ? targetGroup.options : [])
      .find((option) => normalizedId(option?.id) === afterOptionId) || null;
    if (!anchorOption) return unchanged("unknown-target-option");
  } else if (afterOptionId) {
    return unchanged("target-is-not-variant-group");
  }

  syncVisibleAtomicBeatStore(graph);
  const beats = Array.isArray(graph.beats) ? graph.beats : [];
  if (targetGroup) {
    const sourceOption = variantOptionFromBeat(sourceBeat, targetGroup);
    const options = displayedVariantOptions(targetGroup);
    const anchorIndex = options.indexOf(anchorOption);
    targetGroup.options = reindexVariantOptions([
      ...options.slice(0, anchorIndex + 1),
      sourceOption,
      ...options.slice(anchorIndex + 1),
    ]);
    mergeBeatIntoVariantHost(targetBeat, sourceBeat, targetGroup);
    graph.beats = beats.filter((beat) => beat !== sourceBeat);
    const result = variantPlacementResult(true, "joined-variant-group", {
      sourceBeatId,
      targetBeatId,
      variantGroupId: targetGroup.id,
      variantOptionId: sourceOption.id,
      afterOptionId: anchorOption.id,
    });
    result.transitionChanges = remapSourceGraphTransitionCards(graph, [{
      card: { cardKind: "beat", beatId: sourceBeatId },
      replacement: {
        cardKind: "variant",
        beatId: targetBeatId,
        variantGroupId: targetGroup.id,
        variantOptionId: sourceOption.id,
      },
    }]);
    return result;
  }

  const groupId = uniqueVariantGroupId(graph, targetBeat.id);
  const groupShell = { id: groupId, options: [] };
  const targetOption = variantOptionFromBeat(targetBeat, groupShell);
  const sourceOptionForGroup = variantOptionFromBeat(sourceBeat, {
    ...groupShell,
    options: [targetOption],
  });
  const group = {
    schemaVersion: "storyvr-source-variant-group/v1",
    id: groupId,
    title: String(targetBeat.title || targetBeat.sectionHeading || targetBeat.id).trim(),
    beatId: targetBeat.id,
    selectionMode: "single",
    defaultOptionId: targetOption.id,
    control: {
      kind: "previous-next",
      previousLabel: "Previous choice",
      nextLabel: "Next choice",
      wrap: true,
    },
    options: reindexVariantOptions([targetOption, sourceOptionForGroup]),
  };
  const hostBeat = variantHostBeat(targetBeat, sourceBeat, group, targetOption);
  graph.beats = beats
    .filter((beat) => beat !== sourceBeat)
    .map((beat) => beat === targetBeat ? hostBeat : beat);
  graph.variantGroups = [...(Array.isArray(graph.variantGroups) ? graph.variantGroups : []), group];
  const result = variantPlacementResult(true, "created-variant-group", {
    sourceBeatId,
    targetBeatId,
    variantGroupId: group.id,
    variantOptionId: sourceOptionForGroup.id,
    afterOptionId: targetOption.id,
  });
  result.transitionChanges = remapSourceGraphTransitionCards(graph, [{
    card: { cardKind: "beat", beatId: sourceBeatId },
    replacement: {
      cardKind: "variant",
      beatId: targetBeatId,
      variantGroupId: group.id,
      variantOptionId: sourceOptionForGroup.id,
    },
  }]);
  return result;
}

export function combineSourceGraphCards(graph, {
  source,
  target,
  placement,
} = {}) {
  const from = normalizeCardEndpoint(source);
  const to = normalizeCardEndpoint(target);
  const order = placement === "up" || placement === "down" ? placement : null;
  if (!graph || typeof graph !== "object" || !from || !to || !order) {
    return cardCombinationResult(false, "invalid-combination", from, to, order);
  }
  if (!canCombineSourceGraphCards(from, to)) {
    const reason = sameCardEndpoint(from, to) ? "same-card" : "incompatible-cards";
    return cardCombinationResult(false, reason, from, to, order);
  }
  let result;
  if (from.cardKind === "beat" && to.cardKind === "variant") {
    result = combineBeatIntoVariantCard(graph, from, to, order);
  } else {
    result = from.cardKind === "beat"
      ? combineBeatCards(graph, from, to, order)
      : combineVariantCards(graph, from, to, order);
  }
  if (!result.changed) return result;

  let replacements;
  if (from.cardKind === "beat" && to.cardKind === "beat") {
    const combinedCard = { cardKind: "beat", beatId: result.combinedBeatId || result.targetBeatId };
    replacements = [
      { card: from, replacement: combinedCard },
      { card: to, replacement: combinedCard },
    ];
  } else if (from.cardKind === "beat") {
    replacements = [{ card: from, replacement: to }];
  } else if (result.collapsedVariantGroup) {
    const collapsedCard = { cardKind: "beat", beatId: result.targetBeatId };
    replacements = [
      { card: from, replacement: collapsedCard },
      { card: to, replacement: collapsedCard },
    ];
  } else {
    replacements = [{ card: from, replacement: to }];
  }
  result.transitionChanges = remapSourceGraphTransitionCards(graph, replacements);
  return result;
}

export function encodeSourceGraphAssetDragPayload(payload) {
  const assetId = normalizedId(payload?.assetId);
  if (!assetId) return "";
  const sourceBeatId = normalizedId(payload?.sourceBeatId);
  const sourceVariantGroupId = normalizedId(payload?.sourceVariantGroupId);
  const sourceVariantOptionId = normalizedId(payload?.sourceVariantOptionId);
  const hasVariantSource = Boolean(sourceVariantGroupId || sourceVariantOptionId);
  if (sourceBeatId && hasVariantSource) return "";
  if (hasVariantSource && (!sourceVariantGroupId || !sourceVariantOptionId)) return "";
  const encoded = {
    type: SOURCE_GRAPH_ASSET_DRAG_TYPE,
    assetId,
    sourceBeatId,
  };
  if (hasVariantSource) {
    delete encoded.sourceBeatId;
    encoded.sourceVariantGroupId = sourceVariantGroupId;
    encoded.sourceVariantOptionId = sourceVariantOptionId;
  }
  return JSON.stringify(encoded);
}

export function decodeSourceGraphAssetDragPayload(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    const assetId = normalizedId(parsed?.assetId);
    if (parsed?.type !== SOURCE_GRAPH_ASSET_DRAG_TYPE || !assetId) return null;
    const sourceBeatId = normalizedId(parsed.sourceBeatId);
    const sourceVariantGroupId = normalizedId(parsed.sourceVariantGroupId);
    const sourceVariantOptionId = normalizedId(parsed.sourceVariantOptionId);
    const hasVariantSource = Boolean(sourceVariantGroupId || sourceVariantOptionId);
    if (sourceBeatId && hasVariantSource) return null;
    if (hasVariantSource && (!sourceVariantGroupId || !sourceVariantOptionId)) return null;
    if (hasVariantSource) {
      return {
        assetId,
        sourceBeatId: null,
        sourceVariantGroupId,
        sourceVariantOptionId,
      };
    }
    return {
      assetId,
      sourceBeatId,
    };
  } catch {
    return null;
  }
}

function normalizeCardEndpoint(value) {
  const cardKind = String(value?.cardKind || "").trim();
  const beatId = normalizedId(value?.beatId);
  const variantGroupId = normalizedId(value?.variantGroupId);
  const variantOptionId = normalizedId(value?.variantOptionId);
  if (cardKind === "beat" && beatId && !variantGroupId && !variantOptionId) {
    return { cardKind, beatId };
  }
  if (cardKind === "variant" && variantGroupId && variantOptionId) {
    return {
      cardKind,
      beatId,
      variantGroupId,
      variantOptionId,
    };
  }
  return null;
}

function normalizeSourceGraphTransition(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const from = normalizeCardEndpoint(
    value.from
    || value.source
    || (value.fromBeatId || value.sourceBeatId
      ? { cardKind: "beat", beatId: value.fromBeatId || value.sourceBeatId }
      : null),
  );
  const to = normalizeCardEndpoint(
    value.to
    || value.target
    || (value.toBeatId || value.targetBeatId
      ? { cardKind: "beat", beatId: value.toBeatId || value.targetBeatId }
      : null),
  );
  if (!from || !to) return null;
  const normalizedFrom = {
    ...from,
    side: normalizeSourceGraphCardSide(value.from?.side || value.source?.side || value.sourceSide, "right"),
  };
  const normalizedTo = {
    ...to,
    side: normalizeSourceGraphCardSide(value.to?.side || value.target?.side || value.targetSide, "left"),
  };
  return {
    schemaVersion: SOURCE_GRAPH_TRANSITION_SCHEMA_VERSION,
    id: normalizedId(value.id)
      || sourceGraphStableTransitionId(normalizedFrom, normalizedTo),
    kind: "transition",
    from: normalizedFrom,
    to: normalizedTo,
  };
}

function implicitSourceGraphTransitions(graph) {
  const beats = (Array.isArray(graph?.beats) ? graph.beats : [])
    .filter((beat) => normalizedId(beat?.id));
  const beatTransitions = beats.slice(0, -1).flatMap((beat, index) => {
    const fromEndpoints = sourceGraphProgressionSourceEndpoints(graph, beat, "right");
    const to = sourceGraphProgressionTargetEndpoint(graph, beats[index + 1], "left");
    return fromEndpoints.map((from) => sourceGraphProgressionEdge(from, to));
  });
  const variantTransitions = (Array.isArray(graph?.variantGroups) ? graph.variantGroups : [])
    .flatMap((group) => {
      const variantGroupId = normalizedId(group?.id);
      const hostBeatId = normalizedId(visibleBeatForVariantGroup(graph, group)?.id);
      if (!variantGroupId || !hostBeatId) return [];
      const seenOptionIds = new Set();
      const optionIds = displayedVariantOptions(group).flatMap((option) => {
        const optionId = normalizedId(option?.id);
        if (!optionId || seenOptionIds.has(optionId)) return [];
        seenOptionIds.add(optionId);
        return [optionId];
      });
      return optionIds.slice(0, -1).flatMap((variantOptionId, index) => {
        const nextVariantOptionId = optionIds[index + 1];
        const current = {
          cardKind: "variant",
          beatId: hostBeatId,
          variantGroupId,
          variantOptionId,
        };
        const next = {
          cardKind: "variant",
          beatId: hostBeatId,
          variantGroupId,
          variantOptionId: nextVariantOptionId,
        };
        const forwardFrom = { ...current, side: "bottom" };
        const forwardTo = { ...next, side: "top" };
        const reverseFrom = { ...next, side: "top" };
        const reverseTo = { ...current, side: "bottom" };
        return [
          {
            schemaVersion: SOURCE_GRAPH_TRANSITION_SCHEMA_VERSION,
            id: `source-transition-${sourceGraphTransitionEndpointSlug(forwardFrom)}-to-${sourceGraphTransitionEndpointSlug(forwardTo)}`,
            kind: "transition",
            from: forwardFrom,
            to: forwardTo,
          },
          {
            schemaVersion: SOURCE_GRAPH_TRANSITION_SCHEMA_VERSION,
            id: `source-transition-${sourceGraphTransitionEndpointSlug(reverseFrom)}-to-${sourceGraphTransitionEndpointSlug(reverseTo)}`,
            kind: "transition",
            from: reverseFrom,
            to: reverseTo,
          },
        ];
      });
    });
  return [...beatTransitions, ...variantTransitions];
}

function sourceGraphProgressionSourceEndpoints(graph, beat, side) {
  const beatId = normalizedId(beat?.id);
  const group = variantGroupForVisibleBeat(graph, beat);
  const variantGroupId = normalizedId(group?.id);
  const options = displayedVariantOptions(group);
  if (beatId && variantGroupId && options.length) {
    return options.flatMap((option) => {
      const variantOptionId = normalizedId(option?.id);
      return variantOptionId ? [{
        cardKind: "variant",
        beatId,
        variantGroupId,
        variantOptionId,
        side,
      }] : [];
    });
  }
  return beatId ? [{ cardKind: "beat", beatId, side }] : [];
}

function sourceGraphProgressionTargetEndpoint(graph, beat, side) {
  const beatId = normalizedId(beat?.id);
  const group = variantGroupForVisibleBeat(graph, beat);
  const variantGroupId = normalizedId(group?.id);
  const defaultOption = displayedVariantOptions(group)[0] || null;
  const variantOptionId = normalizedId(defaultOption?.id);
  if (beatId && variantGroupId && variantOptionId) {
    return {
      cardKind: "variant",
      beatId,
      variantGroupId,
      variantOptionId,
      side,
    };
  }
  return beatId ? { cardKind: "beat", beatId, side } : null;
}

function sourceGraphProgressionEdge(from, to) {
  return {
    schemaVersion: SOURCE_GRAPH_TRANSITION_SCHEMA_VERSION,
    id: sourceGraphStableTransitionId(from, to),
    kind: "transition",
    from,
    to,
  };
}

function expandLegacyVariantProgressionEdges(graph, edges) {
  return (edges || []).flatMap((edge) => {
    if (!edge?.from?.beatId || !edge?.to?.beatId || edge.from.beatId === edge.to.beatId) return [edge];
    const fromBeat = visibleBeatById(graph, edge.from.beatId);
    const toBeat = visibleBeatById(graph, edge.to.beatId);
    if (!fromBeat || !toBeat) return [edge];

    const legacyVariantSource = edge.from.cardKind === "beat"
      && Boolean(variantGroupForVisibleBeat(graph, fromBeat));
    const legacyVariantTarget = edge.to.cardKind === "beat"
      && Boolean(variantGroupForVisibleBeat(graph, toBeat));
    if (!legacyVariantSource && !legacyVariantTarget) return [edge];

    const fromEndpoints = legacyVariantSource
      ? sourceGraphProgressionSourceEndpoints(graph, fromBeat, edge.from.side)
      : [edge.from];
    const to = legacyVariantTarget
      ? sourceGraphProgressionTargetEndpoint(graph, toBeat, edge.to.side)
      : edge.to;
    if (!fromEndpoints.length || !to) return [edge];
    return fromEndpoints.map((from) => ({
      ...edge,
      id: sourceGraphStableTransitionId(from, to),
      from,
      to,
    }));
  });
}

function sourceGraphTransitionEndpointExists(graph, endpoint) {
  const normalized = normalizeCardEndpoint(endpoint);
  if (!normalized) return false;
  if (normalized.cardKind === "beat") return Boolean(visibleBeatById(graph, normalized.beatId));
  const variant = variantEndpointById(graph, normalized.variantGroupId, normalized.variantOptionId);
  return Boolean(variant && normalizedId(variant.beat?.id) === normalized.beatId);
}

function sourceGraphTransitionEndpointPairKey(from, to) {
  return `${sourceGraphTransitionEndpointKey(from)}->${sourceGraphTransitionEndpointKey(to)}`;
}

function sourceGraphTransitionEndpointKey(endpoint) {
  const normalized = normalizeCardEndpoint(endpoint);
  if (!normalized) return "";
  if (normalized.cardKind === "beat") return `beat:${normalized.beatId}`;
  return `variant:${normalized.beatId}:${normalized.variantGroupId}:${normalized.variantOptionId}`;
}

function sourceGraphTransitionEndpointSlug(endpoint) {
  return sourceGraphTransitionEndpointKey(endpoint)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "card";
}

function sourceGraphStableTransitionId(from, to) {
  return `source-transition-${sourceGraphTransitionEndpointSlug(from)}-to-${sourceGraphTransitionEndpointSlug(to)}`;
}

function normalizeSourceGraphCardSide(value, fallback) {
  const side = String(value || "").trim().toLowerCase();
  return SOURCE_GRAPH_CARD_SIDES.has(side) ? side : fallback;
}

function uniqueSourceGraphTransitionId(edges, from, to) {
  const base = sourceGraphStableTransitionId(from, to);
  const used = new Set((edges || []).map((edge) => normalizedId(edge?.id)).filter(Boolean));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function sameCardEndpoint(source, target) {
  if (!source || !target || source.cardKind !== target.cardKind) return false;
  if (source.cardKind === "beat") return source.beatId === target.beatId;
  return source.variantGroupId === target.variantGroupId
    && source.variantOptionId === target.variantOptionId;
}

function combineBeatCards(graph, source, target, placement) {
  const beats = Array.isArray(graph.beats) ? graph.beats : [];
  const sourceBeat = visibleBeatById(graph, source.beatId);
  const targetBeat = visibleBeatById(graph, target.beatId);
  if (!sourceBeat) return cardCombinationResult(false, "unknown-source-beat", source, target, placement);
  if (!targetBeat) return cardCombinationResult(false, "unknown-target-beat", source, target, placement);
  if (variantGroupForVisibleBeat(graph, sourceBeat) || variantGroupForVisibleBeat(graph, targetBeat)) {
    return cardCombinationResult(false, "incompatible-cards", source, target, placement);
  }

  syncVisibleAtomicBeatStore(graph);
  const orderedBeats = placement === "up"
    ? [sourceBeat, targetBeat]
    : [targetBeat, sourceBeat];
  const combined = combinedBeatForCardDrop(orderedBeats, targetBeat);
  const remaining = beats.filter((beat) => beat !== sourceBeat);
  const targetIndex = remaining.indexOf(targetBeat);
  if (targetIndex < 0) return cardCombinationResult(false, "unknown-target-beat", source, target, placement);
  remaining[targetIndex] = combined;
  graph.beats = remaining;
  return {
    ...cardCombinationResult(true, "combined", source, target, placement),
    targetBeatId: combined.id,
    originalTargetBeatId: targetBeat.id,
    combinedBeatId: combined.id,
    destinationTitle: combined.title,
  };
}

function combineVariantCards(graph, source, target, placement) {
  const sourceEndpoint = variantEndpointById(graph, source.variantGroupId, source.variantOptionId);
  const targetEndpoint = variantEndpointById(graph, target.variantGroupId, target.variantOptionId);
  if (!sourceEndpoint) return cardCombinationResult(false, "unknown-source-variant", source, target, placement);
  if (!targetEndpoint) return cardCombinationResult(false, "unknown-target-variant", source, target, placement);
  if (sourceEndpoint.group !== targetEndpoint.group) {
    return cardCombinationResult(false, "incompatible-cards", source, target, placement);
  }

  const group = targetEndpoint.group;
  const sourceOption = sourceEndpoint.option;
  const targetOption = targetEndpoint.option;
  const orderedOptions = placement === "up"
    ? [sourceOption, targetOption]
    : [targetOption, sourceOption];
  const combinedOption = {
    ...targetOption,
    id: targetOption.id,
    label: targetOption.label || targetOption.title || targetOption.id,
    text: joinedCardText(orderedOptions),
    assetIds: uniqueIds(orderedOptions.flatMap((option) => variantOptionAssetIds(option))),
    combinedVariantOptionIds: uniqueIds(orderedOptions.flatMap((option) => (
      Array.isArray(option.combinedVariantOptionIds) && option.combinedVariantOptionIds.length
        ? option.combinedVariantOptionIds
        : [option.id]
    ))),
    visualChildren: dedupeJsonValues(orderedOptions.flatMap((option) => (
      Array.isArray(option.visualChildren) ? option.visualChildren : []
    ))),
    atomicBeatIds: uniqueIds(orderedOptions.flatMap(variantOptionAtomicBeatIds)),
    sourceBeatIds: uniqueIds(orderedOptions.flatMap(variantOptionSourceBeatIds)),
  };
  delete combinedOption.asset_ids;
  group.options = reindexVariantOptions((Array.isArray(group.options) ? group.options : [])
    .filter((option) => option !== sourceOption)
    .map((option) => option === targetOption ? combinedOption : option));
  if (group.defaultOptionId === sourceOption.id) group.defaultOptionId = targetOption.id;

  let collapsedVariantGroup = false;
  if (group.options.length === 1) {
    collapseVariantGroupIntoBeat(graph, group, combinedOption, targetEndpoint.beat);
    collapsedVariantGroup = true;
  } else {
    for (const record of authoredBeatRecords(graph, targetEndpoint.beat)) {
      reconcileBeatVisualState(graph, record, targetEndpoint.beat);
    }
  }

  return {
    ...cardCombinationResult(true, "combined", source, target, placement),
    targetBeatId: targetEndpoint.beat.id,
    destinationTitle: combinedOption.label,
    collapsedVariantGroup,
  };
}

function combineBeatIntoVariantCard(graph, source, target, placement) {
  const sourceBeat = visibleBeatById(graph, source.beatId);
  if (!sourceBeat) return cardCombinationResult(false, "unknown-source-beat", source, target, placement);
  if (variantGroupForVisibleBeat(graph, sourceBeat)) {
    return cardCombinationResult(false, "incompatible-cards", source, target, placement);
  }
  const targetEndpoint = variantEndpointById(graph, target.variantGroupId, target.variantOptionId);
  if (!targetEndpoint) {
    return cardCombinationResult(false, "unknown-target-variant", source, target, placement);
  }
  if (sourceBeat === targetEndpoint.beat) {
    return cardCombinationResult(false, "incompatible-cards", source, target, placement);
  }

  syncVisibleAtomicBeatStore(graph);
  const group = targetEndpoint.group;
  const targetOption = targetEndpoint.option;
  const orderedRecords = placement === "up"
    ? [sourceBeat, targetOption]
    : [targetOption, sourceBeat];
  const sourceAtomIds = atomicBeatIds(sourceBeat);
  const targetAtomIds = variantOptionAtomicBeatIds(targetOption);
  const combinedAnimationProbeLinks = dedupeAnimationProbeLinks(orderedRecords.flatMap((record) => (
    Array.isArray(record?.animationProbeLinks) ? record.animationProbeLinks : []
  )));
  const combinedOption = {
    ...targetOption,
    id: targetOption.id,
    label: targetOption.label || targetOption.title || targetOption.id,
    text: joinedCardText(orderedRecords),
    assetIds: uniqueIds([
      ...orderedRecords.flatMap((record) => record === targetOption
        ? variantOptionAssetIds(targetOption)
        : (Array.isArray(sourceBeat.linkedAssets) ? sourceBeat.linkedAssets : []).map(assetReferenceId)),
      ...combinedAnimationProbeLinks.map((link) => link?.assetId),
    ]),
    atomicBeatIds: placement === "up"
      ? uniqueIds([...sourceAtomIds, ...targetAtomIds])
      : uniqueIds([...targetAtomIds, ...sourceAtomIds]),
    sourceBeatIds: uniqueIds(placement === "up"
      ? [...sourceAtomIds, ...variantOptionSourceBeatIds(targetOption)]
      : [...variantOptionSourceBeatIds(targetOption), ...sourceAtomIds]),
    sourceIds: uniqueIds(orderedRecords.flatMap((record) => (
      Array.isArray(record?.sourceIds) ? record.sourceIds : []
    ))),
    visualChildren: dedupeJsonValues(orderedRecords.flatMap((record) => (
      Array.isArray(record?.visualChildren) ? record.visualChildren : []
    ))),
  };
  delete combinedOption.asset_ids;
  if (!combinedOption.sourceIds.length) delete combinedOption.sourceIds;
  if (!combinedOption.visualChildren.length) delete combinedOption.visualChildren;
  if (combinedAnimationProbeLinks.length) {
    combinedOption.animationProbeLinks = combinedAnimationProbeLinks;
    combinedOption.probePromotedVisual = true;
  } else {
    delete combinedOption.animationProbeLinks;
    delete combinedOption.probePromotedVisual;
  }
  if (orderedRecords.some((record) => record?.sourceImageLinked === true)) {
    combinedOption.sourceImageLinked = true;
  } else {
    delete combinedOption.sourceImageLinked;
  }
  if (orderedRecords.some((record) => (
    record?.sourceWasTextOnly === true || isTextOnlyBeatRecord(record)
  ))) {
    combinedOption.sourceWasTextOnly = true;
  }

  group.options = (Array.isArray(group.options) ? group.options : [])
    .map((option) => option === targetOption ? combinedOption : option);
  graph.beats = (Array.isArray(graph.beats) ? graph.beats : [])
    .filter((beat) => beat !== sourceBeat);
  mergeBeatIntoVariantHost(targetEndpoint.beat, sourceBeat, group);
  for (const record of authoredBeatRecords(graph, targetEndpoint.beat)) {
    reconcileBeatVisualState(graph, record, targetEndpoint.beat);
  }

  return {
    ...cardCombinationResult(true, "combined", source, target, placement),
    targetBeatId: targetEndpoint.beat.id,
    destinationTitle: combinedOption.label,
    collapsedVariantGroup: false,
  };
}

function combinedBeatForCardDrop(orderedBeats, destinationBeat) {
  const combinedAtomicBeatIds = uniqueIds(orderedBeats.flatMap((beat) => atomicBeatIds(beat)));
  const textOnly = orderedBeats.every(isTextOnlyBeatRecord);
  const linkedAssets = dedupeAssetReferences(orderedBeats.flatMap((beat) => (
    Array.isArray(beat.linkedAssets) ? beat.linkedAssets : []
  )));
  const animationProbeLinks = dedupeAnimationProbeLinks(orderedBeats.flatMap((beat) => (
    Array.isArray(beat.animationProbeLinks) ? beat.animationProbeLinks : []
  )));
  const combined = {
    ...structuredClone(destinationBeat),
    id: combinedBeatId(combinedAtomicBeatIds),
    kind: textOnly ? "text-only" : "combined",
    subtype: "combined",
    originalField: "authored_beat_group",
    isTextOnly: textOnly,
    isCombined: true,
    title: destinationBeat.title || destinationBeat.id,
    sectionHeading: destinationBeat.title || destinationBeat.sectionHeading || destinationBeat.id,
    text: joinedCardText(orderedBeats),
    sourceIds: uniqueIds(orderedBeats.flatMap((beat) => Array.isArray(beat.sourceIds) ? beat.sourceIds : [])),
    linkedAssets,
    atomicBeatIds: combinedAtomicBeatIds,
  };
  delete combined.variantGroupId;
  if (animationProbeLinks.length) {
    combined.animationProbeLinks = animationProbeLinks;
    combined.probePromotedVisual = true;
  } else {
    delete combined.animationProbeLinks;
    delete combined.probePromotedVisual;
  }
  if (orderedBeats.some((beat) => beat.sourceImageLinked)) combined.sourceImageLinked = true;
  else delete combined.sourceImageLinked;
  if (animationProbeLinks.length && orderedBeats.some((beat) => (
    beat.sourceWasTextOnly || beat.isTextOnly || beat.kind === "text-only"
  ))) {
    combined.sourceWasTextOnly = true;
    combined.isTextOnly = false;
  }
  return combined;
}

function collapseVariantGroupIntoBeat(graph, group, option, visibleBeat) {
  const inventoryById = new Map((Array.isArray(graph.assetInventory) ? graph.assetInventory : [])
    .map((asset) => [assetReferenceId(asset), asset])
    .filter(([id]) => id));
  const optionAssets = variantOptionAssetIds(option).map((assetId) => inventoryById.get(assetId) || assetId);
  graph.variantGroups = (Array.isArray(graph.variantGroups) ? graph.variantGroups : [])
    .filter((candidate) => candidate !== group);
  const existingAuthoredRecords = authoredBeatRecords(graph, visibleBeat);
  const collapsedAtomicBeatIds = uniqueIds([
    ...atomicBeatIds(visibleBeat),
    ...variantOptionAtomicBeatIds(option),
  ]);
  visibleBeat.atomicBeatIds = collapsedAtomicBeatIds;
  if (collapsedAtomicBeatIds.length > 1) visibleBeat.isCombined = true;
  else delete visibleBeat.isCombined;
  for (const beat of existingAuthoredRecords) {
    beat.title = option.label || option.id;
    beat.sectionHeading = option.label || option.id;
    beat.text = option.text || option.label || "";
    beat.linkedAssets = dedupeAssetReferences([
      ...(Array.isArray(beat.linkedAssets) ? beat.linkedAssets : []),
      ...optionAssets,
    ]);
    delete beat.variantGroupId;
    if (beat.kind === "variant-group") beat.kind = beat.linkedAssets.length ? "beat" : "text-only";
    if (beat.subtype === "single-select") delete beat.subtype;
    reconcileBeatVisualState(graph, beat, visibleBeat);
  }
}

function cardCombinationResult(changed, reason, source, target, placement) {
  return {
    changed,
    reason,
    placement: placement || null,
    cardKind: source?.cardKind || target?.cardKind || null,
    sourceBeatId: source?.beatId || null,
    targetBeatId: target?.beatId || null,
    sourceVariantGroupId: source?.variantGroupId || null,
    sourceVariantOptionId: source?.variantOptionId || null,
    targetVariantGroupId: target?.variantGroupId || null,
    targetVariantOptionId: target?.variantOptionId || null,
  };
}

function variantGroupForVisibleBeat(graph, beat) {
  return (Array.isArray(graph?.variantGroups) ? graph.variantGroups : [])
    .find((group) => visibleBeatForVariantGroup(graph, group) === beat) || null;
}

function syncVisibleAtomicBeatStore(graph) {
  if (!Array.isArray(graph.atomicBeats)) graph.atomicBeats = [];
  const atomicById = new Map(graph.atomicBeats.map((beat) => [normalizedId(beat?.id), beat]));
  for (const beat of Array.isArray(graph.beats) ? graph.beats : []) {
    const ids = atomicBeatIds(beat);
    if (ids.length !== 1 || beat.isCombined === true) continue;
    const atomic = structuredClone(beat);
    atomic.atomicBeatIds = [atomic.id];
    delete atomic.isCombined;
    const existing = atomicById.get(atomic.id);
    if (existing) Object.assign(existing, atomic);
    else {
      graph.atomicBeats.push(atomic);
      atomicById.set(atomic.id, atomic);
    }
  }
}

function variantPlacementResult(changed, reason, {
  sourceBeatId = null,
  targetBeatId = null,
  variantGroupId = null,
  variantOptionId = null,
  afterOptionId = null,
} = {}) {
  return {
    changed,
    reason,
    sourceBeatId,
    targetBeatId,
    variantGroupId,
    variantOptionId,
    afterOptionId,
  };
}

function uniqueVariantGroupId(graph, targetBeatId) {
  const used = new Set((Array.isArray(graph?.variantGroups) ? graph.variantGroups : [])
    .map((group) => normalizedId(group?.id))
    .filter(Boolean));
  return uniqueVariantId(`authored-variant-group-${variantIdSlug(targetBeatId)}`, used);
}

function variantOptionFromBeat(beat, group) {
  const used = new Set((Array.isArray(group?.options) ? group.options : [])
    .map((option) => normalizedId(option?.id))
    .filter(Boolean));
  const groupId = normalizedId(group?.id) || "authored-variant-group";
  const beatId = normalizedId(beat?.id) || "beat";
  const label = String(beat?.title || beat?.sectionHeading || beatId).trim() || beatId;
  const text = String(beat?.text || beat?.section || label).trim() || label;
  const animationProbeLinks = dedupeAnimationProbeLinks(
    Array.isArray(beat?.animationProbeLinks) ? beat.animationProbeLinks : [],
  );
  const option = {
    id: uniqueVariantId(`${groupId}-option-${variantIdSlug(beatId)}`, used),
    label,
    text,
    sourceOrder: Array.isArray(group?.options) ? group.options.length : 0,
    assetIds: uniqueIds([
      ...(Array.isArray(beat?.linkedAssets) ? beat.linkedAssets : []).map(assetReferenceId),
      ...animationProbeLinks.map((link) => link?.assetId),
    ]),
    sourceBeatId: beatId,
    atomicBeatIds: atomicBeatIds(beat),
  };
  if (animationProbeLinks.length) {
    option.animationProbeLinks = structuredClone(animationProbeLinks);
    option.probePromotedVisual = true;
  }
  if (Array.isArray(beat?.sourceIds) && beat.sourceIds.length) {
    option.sourceIds = uniqueIds(beat.sourceIds);
  }
  if (beat?.sourceImageLinked === true) option.sourceImageLinked = true;
  if (beat?.sourceWasTextOnly === true || isTextOnlyBeatRecord(beat)) option.sourceWasTextOnly = true;
  return option;
}

function uniqueVariantId(base, used) {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function variantIdSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "beat";
}

function reindexVariantOptions(options) {
  return (options || []).map((option, sourceOrder) => ({
    ...option,
    sourceOrder,
  }));
}

function displayedVariantOptions(group) {
  const options = Array.isArray(group?.options) ? group.options : [];
  const defaultOption = options.find((option) => option?.id === group?.defaultOptionId) || options[0] || null;
  return defaultOption
    ? [defaultOption, ...options.filter((option) => option !== defaultOption)]
    : [];
}

function variantOptionAtomicBeatIds(option) {
  const values = Array.isArray(option?.atomicBeatIds) && option.atomicBeatIds.length
    ? option.atomicBeatIds
    : [option?.sourceBeatId];
  return uniqueIds(values);
}

function variantOptionSourceBeatIds(option) {
  return uniqueIds([
    option?.sourceBeatId,
    ...(Array.isArray(option?.sourceBeatIds) ? option.sourceBeatIds : []),
  ]);
}

function variantHostBeat(targetBeat, sourceBeat, group, targetOption) {
  const host = structuredClone(targetBeat);
  host.kind = "variant-group";
  host.subtype = "single-select";
  host.originalField = "variant_groups";
  host.variantGroupId = group.id;
  host.title = group.title || host.title || host.id;
  host.sectionHeading = group.title || host.sectionHeading || host.title || host.id;
  host.text = targetOption.text || targetOption.label || host.text || "";
  host.linkedAssets = [];
  delete host.animationProbeLinks;
  delete host.probePromotedVisual;
  delete host.sourceImageLinked;
  mergeBeatIntoVariantHost(host, sourceBeat, group);
  return host;
}

function mergeBeatIntoVariantHost(hostBeat, sourceBeat, group) {
  hostBeat.variantGroupId = group.id;
  hostBeat.sourceIds = uniqueIds([
    ...(Array.isArray(hostBeat.sourceIds) ? hostBeat.sourceIds : []),
    ...(Array.isArray(sourceBeat.sourceIds) ? sourceBeat.sourceIds : []),
  ]);

  const hasVisual = (Array.isArray(hostBeat.linkedAssets) ? hostBeat.linkedAssets : [])
    .some((asset) => assetReferenceId(asset))
    || (Array.isArray(hostBeat.animationProbeLinks) && hostBeat.animationProbeLinks.length > 0)
    || hostBeat.sourceImageLinked === true
    || (Array.isArray(group?.options) ? group.options : [])
      .some((option) => (
        variantOptionAssetIds(option).length > 0
        || (Array.isArray(option?.animationProbeLinks) && option.animationProbeLinks.length > 0)
        || option?.sourceImageLinked === true
      ));
  const originatedAsTextOnly = hostBeat.sourceWasTextOnly === true
    || isTextOnlyBeatRecord(hostBeat);
  if (hasVisual) {
    if (originatedAsTextOnly) hostBeat.sourceWasTextOnly = true;
    hostBeat.isTextOnly = false;
  } else if (originatedAsTextOnly) {
    hostBeat.isTextOnly = true;
  }
}

function joinedCardText(records) {
  return records
    .map((record) => String(record?.text || record?.section || record?.label || record?.title || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function uniqueIds(values) {
  return [...new Set((values || []).map(normalizedId).filter(Boolean))];
}

function dedupeAssetReferences(values) {
  const seen = new Set();
  return (values || []).filter((asset) => {
    const id = assetReferenceId(asset);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function dedupeAnimationProbeLinks(values) {
  const seen = new Set();
  return (values || []).filter((link) => {
    const key = JSON.stringify([
      normalizedId(link?.assetId),
      String(link?.classification || ""),
      Number.isFinite(Number(link?.scrollPercent)) ? Number(link.scrollPercent) : null,
    ]);
    if (!normalizedId(link?.assetId) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeJsonValues(values) {
  const seen = new Set();
  return (values || []).filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isTextOnlyBeatRecord(beat) {
  return beat?.isTextOnly === true
    || String(beat?.kind || "").toLowerCase() === "text-only"
    || String(beat?.originalField || "").toLowerCase() === "text_only_parts";
}

function combinedBeatId(atomicBeatIds) {
  const slug = (value, fallback) => String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || fallback;
  return `combined-${slug(atomicBeatIds[0], "start")}-to-${slug(atomicBeatIds.at(-1), "end")}`;
}

export function transferSourceGraphAsset(graph, {
  assetId: rawAssetId,
  sourceBeatId: rawSourceBeatId = null,
  sourceVariantGroupId: rawSourceVariantGroupId = null,
  sourceVariantOptionId: rawSourceVariantOptionId = null,
  targetBeatId: rawTargetBeatId = null,
  targetVariantGroupId: rawTargetVariantGroupId = null,
  targetVariantOptionId: rawTargetVariantOptionId = null,
} = {}) {
  const assetId = normalizedId(rawAssetId);
  const sourceBeatId = normalizedId(rawSourceBeatId);
  const sourceVariantGroupId = normalizedId(rawSourceVariantGroupId);
  const sourceVariantOptionId = normalizedId(rawSourceVariantOptionId);
  const targetBeatId = normalizedId(rawTargetBeatId);
  const targetVariantGroupId = normalizedId(rawTargetVariantGroupId);
  const targetVariantOptionId = normalizedId(rawTargetVariantOptionId);
  const hasSourceVariant = Boolean(sourceVariantGroupId || sourceVariantOptionId);
  const hasTargetVariant = Boolean(targetVariantGroupId || targetVariantOptionId);
  let sourceEndpoint = null;
  let targetEndpoint = null;
  const resultFor = (changed, reason, affectedBeatIds = []) => transferResult(
    changed,
    reason,
    affectedBeatIds,
    sourceEndpoint?.beat?.id || sourceBeatId,
    targetEndpoint?.beat?.id || targetBeatId,
    {
      sourceVariantGroupId: hasSourceVariant && sourceVariantGroupId && sourceVariantOptionId
        ? sourceVariantGroupId
        : null,
      sourceVariantOptionId: hasSourceVariant && sourceVariantGroupId && sourceVariantOptionId
        ? sourceVariantOptionId
        : null,
      targetVariantGroupId: hasTargetVariant && targetVariantGroupId && targetVariantOptionId
        ? targetVariantGroupId
        : null,
      targetVariantOptionId: hasTargetVariant && targetVariantGroupId && targetVariantOptionId
        ? targetVariantOptionId
        : null,
    },
  );
  const unchanged = (reason) => resultFor(false, reason);

  if (!graph || typeof graph !== "object" || !assetId) return unchanged("invalid-transfer");
  if (sourceBeatId && hasSourceVariant) return unchanged("invalid-transfer");
  if (targetBeatId && hasTargetVariant) return unchanged("invalid-transfer");
  if (hasSourceVariant && (!sourceVariantGroupId || !sourceVariantOptionId)) return unchanged("unknown-source-variant");
  if (hasTargetVariant && (!targetVariantGroupId || !targetVariantOptionId)) return unchanged("unknown-target-variant");

  const canonicalAsset = (Array.isArray(graph.assetInventory) ? graph.assetInventory : [])
    .find((asset) => assetReferenceId(asset) === assetId);

  if (sourceBeatId) {
    const beat = visibleBeatById(graph, sourceBeatId);
    if (!beat) return unchanged("unknown-source-beat");
    sourceEndpoint = { kind: "beat", beat };
  } else if (hasSourceVariant) {
    sourceEndpoint = variantEndpointById(graph, sourceVariantGroupId, sourceVariantOptionId);
    if (!sourceEndpoint) return unchanged("unknown-source-variant");
  }
  if (targetBeatId) {
    const beat = visibleBeatById(graph, targetBeatId);
    if (!beat) return unchanged("unknown-target-beat");
    targetEndpoint = { kind: "beat", beat };
  } else if (hasTargetVariant) {
    targetEndpoint = variantEndpointById(graph, targetVariantGroupId, targetVariantOptionId);
    if (!targetEndpoint) return unchanged("unknown-target-variant");
  }

  if (!sourceEndpoint && !targetEndpoint) return unchanged("cancelled");
  if (targetEndpoint?.kind === "beat" && variantGroupForVisibleBeat(graph, targetEndpoint.beat)) {
    return unchanged("variant-target-requires-option");
  }
  if (sameTransferEndpoint(sourceEndpoint, targetEndpoint)) {
    return unchanged(sourceEndpoint?.kind === "variant" ? "same-variant" : "same-beat");
  }
  if (sourceEndpoint && !endpointHasAsset(sourceEndpoint, assetId)) return unchanged("unknown-source-link");
  if (targetEndpoint && !canonicalAsset) return unchanged("unknown-asset");
  if (targetEndpoint && endpointHasAsset(targetEndpoint, assetId)) return unchanged("duplicate");

  if (sourceEndpoint?.kind === "beat") {
    for (const beat of authoredBeatRecords(graph, sourceEndpoint.beat)) {
      removeAssetFromBeat(beat, assetId);
      removeAssetProbeLinksFromBeat(beat, assetId);
    }
  } else if (sourceEndpoint?.kind === "variant") {
    removeVariantOptionAsset(graph, sourceEndpoint.group.id, sourceEndpoint.option.id, assetId);
    removeAssetProbeLinksFromBeat(sourceEndpoint.option, assetId);
  }

  if (targetEndpoint?.kind === "beat") {
    for (const beat of authoredBeatRecords(graph, targetEndpoint.beat)) {
      addCanonicalAssetToBeat(beat, canonicalAsset);
    }
  } else if (targetEndpoint?.kind === "variant") {
    addVariantOptionAsset(graph, targetEndpoint.group.id, targetEndpoint.option.id, assetId);
  }

  const affectedBeats = [sourceEndpoint?.beat, targetEndpoint?.beat]
    .filter((beat, index, beats) => beat && beats.indexOf(beat) === index);
  for (const visibleBeat of affectedBeats) {
    for (const beat of authoredBeatRecords(graph, visibleBeat)) {
      reconcileBeatVisualState(graph, beat, visibleBeat);
    }
    reconcileCombinedTextOnlyState(graph, visibleBeat);
  }

  const affectedBeatIds = affectedBeats.map((beat) => normalizedId(beat.id)).filter(Boolean);
  const reason = sourceEndpoint ? (targetEndpoint ? "moved" : "unlinked") : "linked";
  return resultFor(true, reason, affectedBeatIds);
}

function transferResult(changed, reason, affectedBeatIds, sourceBeatId, targetBeatId, variantEndpoints = {}) {
  const result = {
    changed,
    reason,
    affectedBeatIds,
    sourceBeatId,
    targetBeatId,
  };
  for (const key of [
    "sourceVariantGroupId",
    "sourceVariantOptionId",
    "targetVariantGroupId",
    "targetVariantOptionId",
  ]) {
    if (variantEndpoints[key]) result[key] = variantEndpoints[key];
  }
  return result;
}

function normalizedId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value).trim() || null;
}

function assetReferenceId(asset) {
  if (typeof asset === "string" || typeof asset === "number") return normalizedId(asset);
  return normalizedId(asset?.id ?? asset?.assetId);
}

function visibleBeatById(graph, beatId) {
  return (Array.isArray(graph?.beats) ? graph.beats : [])
    .find((beat) => normalizedId(beat?.id) === beatId) || null;
}

function variantEndpointById(graph, groupId, optionId) {
  const group = (Array.isArray(graph?.variantGroups) ? graph.variantGroups : [])
    .find((candidate) => normalizedId(candidate?.id) === groupId);
  if (!group) return null;
  const option = (Array.isArray(group.options) ? group.options : [])
    .find((candidate) => normalizedId(candidate?.id) === optionId);
  if (!option) return null;
  const beat = visibleBeatForVariantGroup(graph, group);
  return beat ? { kind: "variant", beat, group, option } : null;
}

function visibleBeatForVariantGroup(graph, group) {
  const beats = Array.isArray(graph?.beats) ? graph.beats : [];
  const groupId = normalizedId(group?.id);
  const groupBeatId = normalizedId(group?.beatId);
  return (groupBeatId ? beats.find((beat) => normalizedId(beat?.id) === groupBeatId) : null)
    || (groupId ? beats.find((beat) => normalizedId(beat?.variantGroupId) === groupId) : null)
    || (groupBeatId ? beats.find((beat) => atomicBeatIds(beat).includes(groupBeatId)) : null)
    || null;
}

function sameTransferEndpoint(sourceEndpoint, targetEndpoint) {
  if (!sourceEndpoint || !targetEndpoint || sourceEndpoint.kind !== targetEndpoint.kind) return false;
  if (sourceEndpoint.kind === "beat") return sourceEndpoint.beat === targetEndpoint.beat;
  return sourceEndpoint.group === targetEndpoint.group && sourceEndpoint.option === targetEndpoint.option;
}

function endpointHasAsset(endpoint, assetId) {
  if (endpoint.kind === "beat") return beatHasAsset(endpoint.beat, assetId);
  return variantOptionAssetIds(endpoint.option).includes(assetId);
}

function atomicBeatIds(beat) {
  const values = Array.isArray(beat?.atomicBeatIds) && beat.atomicBeatIds.length
    ? beat.atomicBeatIds
    : [beat?.id];
  return [...new Set(values.map(normalizedId).filter(Boolean))];
}

function authoredBeatRecords(graph, visibleBeat) {
  const records = [visibleBeat];
  const atomicById = new Map((Array.isArray(graph?.atomicBeats) ? graph.atomicBeats : [])
    .map((beat) => [normalizedId(beat?.id), beat])
    .filter(([id]) => id));
  for (const atomicBeatId of atomicBeatIds(visibleBeat)) {
    const atomicBeat = atomicById.get(atomicBeatId);
    if (atomicBeat && !records.includes(atomicBeat)) records.push(atomicBeat);
  }
  return records;
}

function reconcileCombinedTextOnlyState(graph, visibleBeat) {
  const childIds = atomicBeatIds(visibleBeat);
  if (childIds.length < 2) return;
  const atomicById = new Map((Array.isArray(graph?.atomicBeats) ? graph.atomicBeats : [])
    .map((beat) => [normalizedId(beat?.id), beat])
    .filter(([id]) => id));
  const children = childIds.map((id) => atomicById.get(id)).filter(Boolean);
  if (children.length !== childIds.length) return;
  visibleBeat.isTextOnly = children.every((child) => child.isTextOnly === true);
  if (!visibleBeat.isTextOnly && children.some((child) => child.sourceWasTextOnly === true)) {
    visibleBeat.sourceWasTextOnly = true;
  }
}

function beatHasAsset(beat, assetId) {
  return (Array.isArray(beat?.linkedAssets) ? beat.linkedAssets : [])
    .some((asset) => assetReferenceId(asset) === assetId);
}

function removeAssetFromBeat(beat, assetId) {
  beat.linkedAssets = (Array.isArray(beat.linkedAssets) ? beat.linkedAssets : [])
    .filter((asset) => assetReferenceId(asset) !== assetId);
}

function addCanonicalAssetToBeat(beat, canonicalAsset) {
  const assetId = assetReferenceId(canonicalAsset);
  const linkedAssets = Array.isArray(beat.linkedAssets) ? beat.linkedAssets : [];
  if (!linkedAssets.some((asset) => assetReferenceId(asset) === assetId)) {
    beat.linkedAssets = [...linkedAssets, canonicalAsset];
  }
}

function removeAssetProbeLinksFromBeat(beat, assetId) {
  if (!Array.isArray(beat.animationProbeLinks)) return;
  const remaining = beat.animationProbeLinks.filter((link) => normalizedId(link?.assetId) !== assetId);
  if (remaining.length) beat.animationProbeLinks = remaining;
  else {
    delete beat.animationProbeLinks;
    delete beat.probePromotedVisual;
  }
}

function reconcileBeatVisualState(graph, beat, visibleBeat) {
  const probeLinks = Array.isArray(beat.animationProbeLinks)
    ? beat.animationProbeLinks.filter((link) => normalizedId(link?.assetId))
    : [];
  if (probeLinks.length) {
    beat.animationProbeLinks = probeLinks;
    beat.probePromotedVisual = true;
  } else {
    delete beat.animationProbeLinks;
    delete beat.probePromotedVisual;
  }

  const originatedAsTextOnly = beat.sourceWasTextOnly === true
    || beat.isTextOnly === true
    || String(beat.kind || "").toLowerCase() === "text-only"
    || String(beat.originalField || "").toLowerCase() === "text_only_parts";
  const hasVisual = (Array.isArray(beat.linkedAssets) && beat.linkedAssets.some((asset) => assetReferenceId(asset)))
    || beat.sourceImageLinked === true
    || probeLinks.length > 0
    || variantAssetIdsForBeat(graph, beat, visibleBeat).length > 0;

  if (originatedAsTextOnly) {
    if (hasVisual) {
      beat.sourceWasTextOnly = true;
      beat.isTextOnly = false;
    } else {
      beat.isTextOnly = true;
    }
  } else if (hasVisual) {
    beat.isTextOnly = false;
  }
}
