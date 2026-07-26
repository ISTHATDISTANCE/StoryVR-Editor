import assert from "node:assert/strict";
import test from "node:test";

import {
  STORYVR_NAVIGATION_STATE_KEY,
  createStoryvrNavigationHistoryState,
  createStoryvrNavigationRoute,
  storyvrNavigationFromHistoryState,
  storyvrNavigationFromUrl,
  storyvrNavigationRoutesEqual,
  storyvrNavigationUrl,
} from "./app/src/storyvr-browser-navigation.js";

test("tab routes round-trip through the URL without disturbing unrelated parameters or hashes", () => {
  const href = storyvrNavigationUrl(
    "http://127.0.0.1:5188/author?resource=shark#workspace",
    createStoryvrNavigationRoute("dynamic-geometry"),
  );

  assert.equal(href, "/author?resource=shark&storyvr-tab=dynamic-geometry#workspace");
  assert.deepEqual(
    storyvrNavigationFromUrl(`http://127.0.0.1:5188${href}`),
    createStoryvrNavigationRoute("dynamic-geometry"),
  );
});

test("canvas-editor beat and variant routes serialize and canvas routes remove stale scene parameters", () => {
  const sceneRoute = createStoryvrNavigationRoute("spatial-relations", {
    beatId: "beat-07",
    variantGroupId: "risk-level",
    variantOptionId: "florida",
  });
  const sceneHref = storyvrNavigationUrl("http://127.0.0.1:5188/", sceneRoute);

  assert.deepEqual(storyvrNavigationFromUrl(`http://127.0.0.1:5188${sceneHref}`), sceneRoute);
  assert.equal(
    storyvrNavigationUrl(`http://127.0.0.1:5188${sceneHref}`, createStoryvrNavigationRoute("spatial-relations")),
    "/?storyvr-tab=spatial-relations",
  );

  const attentionRoute = createStoryvrNavigationRoute("attention-guidance", { beatId: "beat-11" });
  const attentionHref = storyvrNavigationUrl("http://127.0.0.1:5188/", attentionRoute);
  assert.deepEqual(storyvrNavigationFromUrl(`http://127.0.0.1:5188${attentionHref}`), attentionRoute);
});

test("Environment, Dynamics, Transition, and Final Review scene routes round-trip exactly", () => {
  for (const componentId of ["environment-enhancement", "dynamic-geometry", "transition-pacing"]) {
    const route = createStoryvrNavigationRoute(componentId, {
      beatId: "beat-09",
      variantGroupId: "risk-level",
      variantOptionId: "florida",
    });
    const href = storyvrNavigationUrl("http://127.0.0.1:5188/", route);
    assert.deepEqual(storyvrNavigationFromUrl(`http://127.0.0.1:5188${href}`), route);
  }

  const transitionRoute = createStoryvrNavigationRoute("inter-beat-dynamics", {
    beatId: "beat-09",
    variantGroupId: "risk-level",
    variantOptionId: "florida",
    transitionEdgeId: "edge:baseline-to-florida",
  });
  const transitionHref = storyvrNavigationUrl("http://127.0.0.1:5188/", transitionRoute);
  assert.match(transitionHref, /storyvr-transition-edge=edge%3Abaseline-to-florida/);
  assert.deepEqual(
    storyvrNavigationFromUrl(`http://127.0.0.1:5188${transitionHref}`),
    transitionRoute,
  );
  assert.equal(
    storyvrNavigationUrl(
      `http://127.0.0.1:5188${transitionHref}`,
      createStoryvrNavigationRoute("inter-beat-dynamics"),
    ),
    "/?storyvr-tab=inter-beat-dynamics",
  );
  assert.equal(
    storyvrNavigationRoutesEqual(
      transitionRoute,
      createStoryvrNavigationRoute("inter-beat-dynamics", {
        ...transitionRoute.editorScene,
        transitionEdgeId: "edge:other",
      }),
    ),
    false,
  );
});

test("Interaction option editors round-trip their exact transition target and policy kind", () => {
  const route = createStoryvrNavigationRoute("interaction-control", {
    beatId: "beat-before",
    variantGroupId: "risk-level",
    variantOptionId: "baseline",
    interactionTargetType: "variant-edge",
    interactionTargetId: "edge:baseline-to-florida",
    interactionKind: "ui-button-press",
  });
  const href = storyvrNavigationUrl("http://127.0.0.1:5188/", route);

  assert.match(href, /storyvr-interaction-target=variant-edge/);
  assert.match(href, /storyvr-interaction-id=edge%3Abaseline-to-florida/);
  assert.match(href, /storyvr-interaction-kind=ui-button-press/);
  assert.deepEqual(storyvrNavigationFromUrl(`http://127.0.0.1:5188${href}`), route);

  const canvasHref = storyvrNavigationUrl(
    `http://127.0.0.1:5188${href}`,
    createStoryvrNavigationRoute("interaction-control"),
  );
  assert.equal(canvasHref, "/?storyvr-tab=interaction-control");
});

test("history entries preserve foreign state and carry parent metadata for editor close", () => {
  const route = createStoryvrNavigationRoute("spatial-relations", { beatId: "beat-02" });
  const historyState = createStoryvrNavigationHistoryState(
    { vite: "preserved" },
    route,
    { entryId: "entry-2", parentEntryId: "entry-1", index: 2 },
  );

  assert.equal(historyState.vite, "preserved");
  assert.deepEqual(historyState[STORYVR_NAVIGATION_STATE_KEY].editorScene, {
    beatId: "beat-02",
    variantGroupId: null,
    variantOptionId: null,
  });
  assert.deepEqual(storyvrNavigationFromHistoryState(historyState), {
    ...route,
    entryId: "entry-2",
    parentEntryId: "entry-1",
    index: 2,
  });
  assert.equal(storyvrNavigationRoutesEqual(route, storyvrNavigationFromHistoryState(historyState)), true);
});

test("history reads Spatial entries written before the editor scene field became generic", () => {
  const legacyState = {
    [STORYVR_NAVIGATION_STATE_KEY]: {
      componentId: "spatial-relations",
      spatialScene: { beatId: "beat-legacy" },
      entryId: "legacy-entry",
    },
  };

  assert.deepEqual(storyvrNavigationFromHistoryState(legacyState), {
    componentId: "spatial-relations",
    editorScene: { beatId: "beat-legacy", variantGroupId: null, variantOptionId: null },
    entryId: "legacy-entry",
    parentEntryId: null,
    index: 0,
  });
});
