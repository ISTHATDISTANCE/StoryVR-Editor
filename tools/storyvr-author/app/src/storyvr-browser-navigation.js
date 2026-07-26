export const STORYVR_NAVIGATION_STATE_KEY = "storyvrNavigation";

const TAB_PARAM = "storyvr-tab";
const BEAT_PARAM = "storyvr-beat";
const VARIANT_GROUP_PARAM = "storyvr-variant-group";
const VARIANT_PARAM = "storyvr-variant";
const TRANSITION_EDGE_PARAM = "storyvr-transition-edge";
const INTERACTION_TARGET_TYPE_PARAM = "storyvr-interaction-target";
const INTERACTION_TARGET_ID_PARAM = "storyvr-interaction-id";
const INTERACTION_KIND_PARAM = "storyvr-interaction-kind";

function clean(value) {
  return String(value || "").trim();
}

export function normalizeStoryvrNavigationScene(value) {
  const beatId = clean(value?.beatId);
  if (!beatId) return null;
  const variantOptionId = clean(value?.variantOptionId) || null;
  const transitionEdgeId = clean(value?.transitionEdgeId) || null;
  const interactionTargetType = ["boundary", "variant-edge"].includes(clean(value?.interactionTargetType))
    ? clean(value.interactionTargetType)
    : null;
  const interactionTargetId = interactionTargetType ? clean(value?.interactionTargetId) || null : null;
  const interactionKind = interactionTargetId ? clean(value?.interactionKind) || null : null;
  return {
    beatId,
    variantGroupId: variantOptionId ? clean(value?.variantGroupId) || null : null,
    variantOptionId,
    ...(transitionEdgeId ? { transitionEdgeId } : {}),
    ...(interactionTargetType && interactionTargetId && interactionKind ? {
      interactionTargetType,
      interactionTargetId,
      interactionKind,
    } : {}),
  };
}

export function createStoryvrNavigationRoute(componentId, editorScene = null) {
  return {
    componentId: clean(componentId) || "source-graph",
    editorScene: normalizeStoryvrNavigationScene(editorScene),
  };
}

export function storyvrNavigationFromHistoryState(historyState) {
  const value = historyState?.[STORYVR_NAVIGATION_STATE_KEY];
  if (!value || typeof value !== "object") return null;
  return {
    ...createStoryvrNavigationRoute(value.componentId, value.editorScene || value.spatialScene),
    entryId: clean(value.entryId) || null,
    parentEntryId: clean(value.parentEntryId) || null,
    index: Number.isFinite(value.index) ? value.index : 0,
  };
}

export function storyvrNavigationFromUrl(href) {
  const url = new URL(String(href));
  const componentId = clean(url.searchParams.get(TAB_PARAM));
  const beatId = clean(url.searchParams.get(BEAT_PARAM));
  if (!componentId && !beatId) return null;
  return createStoryvrNavigationRoute(
    componentId || "spatial-relations",
    beatId ? {
      beatId,
      variantGroupId: url.searchParams.get(VARIANT_GROUP_PARAM),
      variantOptionId: url.searchParams.get(VARIANT_PARAM),
      transitionEdgeId: url.searchParams.get(TRANSITION_EDGE_PARAM),
      interactionTargetType: url.searchParams.get(INTERACTION_TARGET_TYPE_PARAM),
      interactionTargetId: url.searchParams.get(INTERACTION_TARGET_ID_PARAM),
      interactionKind: url.searchParams.get(INTERACTION_KIND_PARAM),
    } : null,
  );
}

export function storyvrNavigationUrl(href, route) {
  const url = new URL(String(href));
  const normalized = createStoryvrNavigationRoute(route?.componentId, route?.editorScene);
  url.searchParams.set(TAB_PARAM, normalized.componentId);
  if (normalized.editorScene) {
    url.searchParams.set(BEAT_PARAM, normalized.editorScene.beatId);
    if (normalized.editorScene.variantGroupId) {
      url.searchParams.set(VARIANT_GROUP_PARAM, normalized.editorScene.variantGroupId);
    } else {
      url.searchParams.delete(VARIANT_GROUP_PARAM);
    }
    if (normalized.editorScene.variantOptionId) {
      url.searchParams.set(VARIANT_PARAM, normalized.editorScene.variantOptionId);
    } else {
      url.searchParams.delete(VARIANT_PARAM);
    }
    if (normalized.editorScene.transitionEdgeId) {
      url.searchParams.set(TRANSITION_EDGE_PARAM, normalized.editorScene.transitionEdgeId);
    } else {
      url.searchParams.delete(TRANSITION_EDGE_PARAM);
    }
    if (normalized.editorScene.interactionTargetType) {
      url.searchParams.set(INTERACTION_TARGET_TYPE_PARAM, normalized.editorScene.interactionTargetType);
      url.searchParams.set(INTERACTION_TARGET_ID_PARAM, normalized.editorScene.interactionTargetId);
      url.searchParams.set(INTERACTION_KIND_PARAM, normalized.editorScene.interactionKind);
    } else {
      url.searchParams.delete(INTERACTION_TARGET_TYPE_PARAM);
      url.searchParams.delete(INTERACTION_TARGET_ID_PARAM);
      url.searchParams.delete(INTERACTION_KIND_PARAM);
    }
  } else {
    url.searchParams.delete(BEAT_PARAM);
    url.searchParams.delete(VARIANT_GROUP_PARAM);
    url.searchParams.delete(VARIANT_PARAM);
    url.searchParams.delete(TRANSITION_EDGE_PARAM);
    url.searchParams.delete(INTERACTION_TARGET_TYPE_PARAM);
    url.searchParams.delete(INTERACTION_TARGET_ID_PARAM);
    url.searchParams.delete(INTERACTION_KIND_PARAM);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function createStoryvrNavigationHistoryState(historyState, route, metadata = {}) {
  return {
    ...(historyState && typeof historyState === "object" ? historyState : {}),
    [STORYVR_NAVIGATION_STATE_KEY]: {
      ...createStoryvrNavigationRoute(route?.componentId, route?.editorScene),
      entryId: clean(metadata.entryId) || null,
      parentEntryId: clean(metadata.parentEntryId) || null,
      index: Number.isFinite(metadata.index) ? metadata.index : 0,
    },
  };
}

export function storyvrNavigationRoutesEqual(left, right) {
  const a = createStoryvrNavigationRoute(left?.componentId, left?.editorScene);
  const b = createStoryvrNavigationRoute(right?.componentId, right?.editorScene);
  return a.componentId === b.componentId
    && a.editorScene?.beatId === b.editorScene?.beatId
    && a.editorScene?.variantGroupId === b.editorScene?.variantGroupId
    && a.editorScene?.variantOptionId === b.editorScene?.variantOptionId
    && a.editorScene?.transitionEdgeId === b.editorScene?.transitionEdgeId
    && a.editorScene?.interactionTargetType === b.editorScene?.interactionTargetType
    && a.editorScene?.interactionTargetId === b.editorScene?.interactionTargetId
    && a.editorScene?.interactionKind === b.editorScene?.interactionKind;
}
