import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainUrl = new URL("./app/src/main.js", import.meta.url);
const stylesUrl = new URL("./app/src/styles.css", import.meta.url);

test("Source Graph resolves the declared default variant with a first-option fallback", async () => {
  const source = await readFile(mainUrl, "utf8");
  const helper = source.match(/function sourceGraphDefaultVariantOption\(group\) \{[\s\S]*?\n\}/)?.[0] || "";
  const resolveDefault = new Function(`${helper}; return sourceGraphDefaultVariantOption;`)();
  const options = [{ id: "california" }, { id: "florida" }, { id: "hawaii" }];

  assert.equal(resolveDefault({ defaultOptionId: "florida", options }).id, "florida");
  assert.equal(resolveDefault({ defaultOptionId: "missing", options }).id, "california");
  assert.equal(resolveDefault({ options: [] }), null);
});

test("Source Graph renders default and alternative options as parallel canvas cards without a count badge", async () => {
  const source = await readFile(mainUrl, "utf8");
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const alternatives = source.match(/function renderSourceGraphVariantAlternatives\([\s\S]*?\nfunction renderSourceGraphBeatAsset/)?.[0] || "";

  assert.doesNotMatch(timeline, /source-graph-default-variant-card/);
  assert.doesNotMatch(timeline, /data-source-graph-variant-default/);
  assert.match(timeline, /data-source-graph-variant-drop/);
  assert.match(timeline, /renderSourceGraphVariantAlternatives/);
  assert.doesNotMatch(timeline, /evidence-badge variant/);
  assert.doesNotMatch(timeline, />\$\{variantGroup\.options\.length\} variants</);
  assert.match(alternatives, /source-graph-variant-alternatives/);
  assert.match(alternatives, /source-graph-parallel-variant-card/);
  assert.match(alternatives, /data-source-graph-variant-card/);
  assert.match(alternatives, /data-source-graph-variant-drop/);
  assert.match(alternatives, /variantOptionAssetIds\(option\)/);
  assert.doesNotMatch(alternatives, /manualSceneAsset|generatedOverride/,
    "Source Graph renders only its ordinary editable variant asset links");
});

test("Source Graph beat cards render without badges or text-only color treatment", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";

  assert.doesNotMatch(timeline, /source-graph-beat-badges/);
  assert.doesNotMatch(timeline, /evidence-badge/);
  assert.doesNotMatch(timeline, /\$\{textOnly \? "text-only"/);
  assert.doesNotMatch(styles, /\.source-graph-beat-card\.text-only/);
  assert.doesNotMatch(styles, /\.evidence-badge\.text-only/);
  assert.doesNotMatch(timeline, /probe linked/);
  assert.doesNotMatch(timeline, /grouped parts/);
  assert.doesNotMatch(timeline, /weak evidence/);
  assert.doesNotMatch(timeline, /confidenceClass\(evidence\.confidence\)/);
  assert.doesNotMatch(timeline, /\$\{assetCount\} assets/);
});

test("Asset Library tiles use a delayed pointer tooltip without covering thumbnails", async () => {
  const source = await readFile(mainUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");
  const renderer = source.match(/function renderAssetCard\([\s\S]*?\nfunction renderSourceGraphAssetPreview/)?.[0] || "";
  const bindings = source.match(/function bindEvents\(\) \{[\s\S]*?\nfunction bindSourceGraphCanvasEvents/)?.[0] || "";

  assert.match(source, /SOURCE_GRAPH_ASSET_LINK_TOOLTIP = "Click to link to the selected card or choice, or drag to any card"/);
  assert.match(source, /SOURCE_GRAPH_ASSET_TOOLTIP_DELAY_MS = 2000/);
  assert.match(source, /id="source-graph-asset-link-help">\$\{escapeHtml\(SOURCE_GRAPH_ASSET_LINK_TOOLTIP\)\}/);
  assert.match(source, /data-source-graph-asset-hover-tooltip role="tooltip" aria-hidden="true"/);
  assert.match(renderer, /role="button"/);
  assert.match(renderer, /tabindex="0"/);
  assert.match(renderer, /data-link-asset-id=/);
  assert.doesNotMatch(renderer, /data-tooltip=/);
  assert.match(renderer, /aria-describedby="source-graph-asset-link-help"/);
  assert.doesNotMatch(renderer, /title=/);
  assert.doesNotMatch(renderer, /<button/);
  assert.doesNotMatch(renderer, />Link to selected beat</);
  assert.match(bindings, /linkTarget\.addEventListener\("click", linkToSelectedBeat\)/);
  assert.match(bindings, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(bindings, /event\.preventDefault\(\)/);
  assert.match(bindings, /if \(event\.repeat\) return/);
  assert.match(bindings, /card\.addEventListener\("pointerenter"/);
  assert.match(bindings, /card\.addEventListener\("pointermove"/);
  assert.match(bindings, /card\.addEventListener\("pointerleave"/);
  assert.match(bindings, /window\.setTimeout\([\s\S]*SOURCE_GRAPH_ASSET_TOOLTIP_DELAY_MS/);
  assert.match(bindings, /let left = dockRect\.right \+ gap/);
  assert.match(bindings, /point\.y - \(tooltipHeight \/ 2\)/);
  assert.match(styles, /\.source-graph-asset-hover-tooltip \{[^}]*position:\s*fixed;/s);
  assert.match(styles, /\.source-graph-asset-hover-tooltip\.is-visible \{[^}]*visibility:\s*visible;/s);
  assert.doesNotMatch(styles, /\.source-graph-asset-icon-card::after/);
  assert.match(styles, /\.source-graph-asset-icon-card \{[^}]*grid-template-rows:\s*70px minmax\(36px, auto\);[^}]*min-height:\s*132px;/s);
  assert.doesNotMatch(styles, /\.source-graph-asset-icon-card > button/);
});

test("parallel variant cards bind the same drag-in, drag-out, and move flow as beat cards", async () => {
  const source = await readFile(mainUrl, "utf8");
  const renderer = source.match(/function renderSourceGraphBeatAsset\([\s\S]*?\nfunction variantGroupForBeat/)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphCanvasEvents\([\s\S]*?\nfunction sourceGraphDragPayloadFromDataTransfer/)?.[0] || "";

  assert.match(renderer, /const draggable = Boolean\(String\(assetId \|\| ""\)\.trim\(\)\)/);
  assert.doesNotMatch(renderer, /&& !variant/);
  assert.doesNotMatch(renderer, /generatedOverride|generated-override|Generated exact/,
    "all displayed links are ordinary editable Source Graph links");
  assert.match(bindings, /sourceVariantGroupId/);
  assert.match(bindings, /sourceVariantOptionId/);
  assert.match(bindings, /\[data-source-graph-variant-drop\]/);
  assert.match(bindings, /targetVariantGroupId/);
  assert.match(bindings, /targetVariantOptionId/);
  assert.match(bindings, /payload\?\.sourceVariantGroupId/);
});

test("default and alternative variants expose the same option-level drag endpoint", async () => {
  const source = await readFile(mainUrl, "utf8");
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphCanvasEvents\([\s\S]*?\nfunction sourceGraphDragPayloadFromDataTransfer/)?.[0] || "";

  assert.match(timeline, /data-source-graph-variant-drop/);
  assert.match(timeline, /data-source-graph-beat-drop="\$\{escapeHtml\(beat\.id\)\}"/);
  assert.match(timeline, /defaultVariantIds\.map\(\(assetId\) => renderSourceGraphBeatAsset\(assetId, beat, \{\s*variant: true/s);
  assert.doesNotMatch(timeline, /Every variant/);
  assert.doesNotMatch(timeline, /primaryAssetIds/);
  assert.match(bindings, /\[data-source-graph-beat-drop\]/);
  assert.match(bindings, /event\.stopPropagation\(\)/);
  assert.match(bindings, /targetBeatId: dropTarget\.dataset\.sourceGraphBeatDrop/);
});

test("beat and variant cards expose four hover-only connection handles", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const alternatives = source.match(/function renderSourceGraphVariantAlternatives\([\s\S]*?\nfunction renderSourceGraphBeatAsset/)?.[0] || "";
  const handles = source.match(/function renderSourceGraphLinkHandles\([\s\S]*?\nfunction /)?.[0] || "";

  assert.match(timeline, /renderSourceGraphLinkHandles\(primaryCardEndpoint\)/);
  assert.match(alternatives, /renderSourceGraphLinkHandles\(cardEndpoint\)/);
  assert.match(handles, /\["top",\s*"right",\s*"bottom",\s*"left"\]/);
  assert.match(handles, /data-source-graph-link-handle/);
  assert.match(handles, /data-source-graph-link-side="\$\{side\}"/);
  assert.match(handles, /aria-label=/);

  assert.match(styles, /\.source-graph-link-handle\s*\{[^}]*position:\s*absolute;[^}]*touch-action:\s*none;/s);
  assert.match(styles, /\.source-graph-link-handle::before\s*\{[^}]*border-radius:\s*50%;[^}]*opacity:\s*0;/s);
  assert.match(
    styles,
    /\.source-graph-link-handle:hover::before,[\s\S]*\.source-graph-link-handle:focus-visible::before[\s\S]*\{[^}]*opacity:\s*1;/s,
  );
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.match(styles, new RegExp(`\\.source-graph-link-handle\\.${side}`));
  }
});

test("connection handles drive a pointer-captured preview toward a valid card target", async () => {
  const source = await readFile(mainUrl, "utf8");
  const bindings = source.match(/function bindSourceGraphLinkEvents\([\s\S]*?\nfunction /)?.[0] || "";
  const update = source.match(/function updateSourceGraphLinkDrag\([\s\S]*?\nfunction /)?.[0] || "";
  const targetAtPoint = source.match(/function sourceGraphLinkTargetAtPoint\([\s\S]*?\nfunction /)?.[0] || "";
  const finish = source.match(/function finishSourceGraphLinkDrag\([\s\S]*?\nfunction /)?.[0] || "";
  const commit = source.match(/function commitSourceGraphConnection\([\s\S]*?\nfunction /)?.[0] || "";

  assert.match(source, /data-source-graph-link-layer/);
  assert.match(source, /data-source-graph-link-draft/);
  assert.match(bindings, /querySelectorAll\("\[data-source-graph-link-handle\]"\)/);
  assert.match(bindings, /addEventListener\("pointerdown"/);
  assert.match(bindings, /setPointerCapture\(event\.pointerId\)/);
  assert.match(bindings, /addEventListener\("pointermove"/);
  assert.match(bindings, /updateSourceGraphLinkDrag\(event\)/);
  assert.match(bindings, /addEventListener\("pointerup"/);
  assert.match(bindings, /finishSourceGraphLinkDrag\(\)/);
  assert.match(bindings, /addEventListener\("pointercancel"/);
  assert.match(bindings, /event\.key === "Escape"/);
  assert.match(bindings, /preventDefault\(\)/);
  assert.match(bindings, /stopPropagation\(\)/);
  assert.match(targetAtPoint, /document\.elementsFromPoint\(clientX,\s*clientY\)/);
  assert.match(targetAtPoint, /sourceGraphCardEndpointFromElement/);
  assert.match(update, /sourceGraphLinkTargetAtPoint\(event\.clientX,\s*event\.clientY,\s*drag\.source\)/);
  assert.match(update, /canConnectSourceGraphCards\(/);
  assert.match(update, /sourceGraphNearestCardSide/);
  assert.match(update, /draft\.setAttribute\("d",\s*sourceGraphLinkPath/);
  assert.match(update, /draft\.hidden = false/);
  assert.match(finish, /commitSourceGraphConnection\(/);
  assert.match(commit, /connectSourceGraphCards\(/);
});

test("rendered connection arrows are selectable and removable without reverting to implicit order", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const linkLayer = source.match(/function renderSourceGraphLinkLayer\([\s\S]*?\nfunction /)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphLinkEvents\([\s\S]*?\nfunction /)?.[0] || "";
  const removal = source.match(/function commitSourceGraphTransitionRemoval\([\s\S]*?\nfunction /)?.[0] || "";

  assert.match(timeline, /renderSourceGraphLinkLayer\(\)/);
  assert.match(linkLayer, /sourceGraphTransitionEdges\(state\.data\?\.graph\)/);
  assert.match(linkLayer, /sourceGraphReciprocalLaneOffsets\(edges\)/);
  assert.match(linkLayer, /data-source-graph-link-layer/);
  assert.match(linkLayer, /data-source-graph-edge=/);
  assert.match(linkLayer, /markerUnits="userSpaceOnUse"/);
  assert.match(linkLayer, /markerWidth="12" markerHeight="12"/);
  assert.match(linkLayer, /source-graph-transition-halo/);
  assert.match(linkLayer, /is-variant-switch/);
  assert.match(source, /data-source-graph-remove-edge/);
  assert.match(source, /sourceGraphSelectedTransitionId/);
  assert.match(bindings, /querySelector\("\[data-source-graph-remove-edge\]"\)/);
  assert.match(removal, /removeSourceGraphTransition\(/);
  assert.match(removal, /updateGraphDraftFromState\(\{ storyFlowChanged: true \}\)/);
  assert.match(styles, /\.source-graph-link-layer\s*\{[^}]*position:\s*absolute;[^}]*max-width:\s*none;[^}]*pointer-events:\s*none;/s);
  assert.match(styles, /\.source-graph-transition-hit-path\s*\{[^}]*pointer-events:\s*stroke;/s);
  assert.match(styles, /\.source-graph-transition-halo\s*\{[^}]*stroke-width:\s*8px;/s);
  assert.match(styles, /\.source-graph-transition-path,[\s\S]*\.source-graph-link-draft\s*\{[^}]*stroke:\s*var\(--story-canvas-arrow-color\);[^}]*stroke-width:\s*var\(--story-canvas-arrow-stroke-width\);/s);
  assert.doesNotMatch(styles, /\.source-graph-transition-edge\.is-variant-switch \.source-graph-transition-path\s*\{[^}]*(?:stroke|stroke-width):/s);
  assert.match(styles, /\.source-graph-transition-edge\.is-selected/);
});

test("reciprocal arrows use separate fixed lanes at both card ports", async () => {
  const source = await readFile(mainUrl, "utf8");
  const laneStart = source.indexOf("function sourceGraphTransitionEndpointLayoutKey(");
  const laneEnd = source.indexOf("\nfunction renderSourceGraphBeatAsset(", laneStart);
  assert.notEqual(laneStart, -1);
  assert.notEqual(laneEnd, -1);
  const laneSource = source.slice(laneStart, laneEnd);
  const { sourceGraphReciprocalLaneOffsets } = new Function(`${laneSource}; return { sourceGraphReciprocalLaneOffsets };`)();
  const forward = {
    id: "a-to-b",
    from: { cardKind: "variant", beatId: "host", variantGroupId: "group", variantOptionId: "a" },
    to: { cardKind: "variant", beatId: "host", variantGroupId: "group", variantOptionId: "b" },
  };
  const reverse = { id: "b-to-a", from: forward.to, to: forward.from };
  const oneWay = {
    id: "beat-a-to-b",
    from: { cardKind: "beat", beatId: "beat-a" },
    to: { cardKind: "beat", beatId: "beat-b" },
  };
  const offsets = sourceGraphReciprocalLaneOffsets([forward, reverse, oneWay]);

  assert.deepEqual([offsets.get(forward.id), offsets.get(reverse.id)], [-12, 12]);
  assert.equal(offsets.get(oneWay.id), 0);

  const layout = source.match(/function layoutSourceGraphLinks\([\s\S]*?\nfunction /)?.[0] || "";
  const sidePoint = source.match(/function sourceGraphCardSidePoint\([\s\S]*?\nfunction /)?.[0] || "";
  assert.match(layout, /const laneOffset = laneOffsets\.get\(edge\.id\) \|\| 0/);
  assert.match(layout, /sourceGraphCardSidePoint\(sourceCard, edge\.from\.side, viewport, laneOffset\)/);
  assert.match(layout, /sourceGraphCardSidePoint\(targetCard, edge\.to\.side, viewport, laneOffset\)/);
  assert.match(sidePoint, /tangentOffset = 0/);
  assert.match(sidePoint, /rect\.width \/ 2 \+ tangentOffset/);
  assert.match(sidePoint, /rect\.height \/ 2 \+ tangentOffset/);
});

test("variant progression fans group by destination and compute the sketched branch-and-trunk geometry", async () => {
  const source = await readFile(mainUrl, "utf8");
  const groupingStart = source.indexOf("function sourceGraphIsStoryProgression(");
  const groupingEnd = source.indexOf("\nfunction renderStoryVariantCardAttributes(", groupingStart);
  assert.notEqual(groupingStart, -1, "variant progression classification exists");
  assert.notEqual(groupingEnd, -1, "fan grouping stays independently testable");
  const groupingSource = source.slice(groupingStart, groupingEnd);
  const {
    storyVariantProgressionFanKey,
    storyVariantProgressionFanGroups,
  } = new Function(`${groupingSource}; return {
    storyVariantProgressionFanKey,
    storyVariantProgressionFanGroups,
  };`)();

  const target = { cardKind: "beat", beatId: "next", side: "left" };
  const secondTarget = { cardKind: "beat", beatId: "other-next", side: "left" };
  const progression = (id, optionId, to = target, sourceSide = "right") => ({
    id,
    from: {
      cardKind: "variant",
      beatId: "variant-host",
      variantGroupId: "places",
      variantOptionId: optionId,
      side: sourceSide,
    },
    to,
  });
  const firstFan = [
    progression("california-next", "california"),
    progression("florida-next", "florida"),
    progression("hawaii-next", "hawaii"),
  ];
  const secondFan = [
    progression("california-other", "california", secondTarget),
    progression("florida-other", "florida", secondTarget),
  ];
  const manualSwitch = {
    id: "california-florida",
    from: {
      cardKind: "variant",
      beatId: "variant-host",
      variantGroupId: "places",
      variantOptionId: "california",
      side: "bottom",
    },
    to: {
      cardKind: "variant",
      beatId: "variant-host",
      variantGroupId: "places",
      variantOptionId: "florida",
      side: "top",
    },
  };
  const singletonDifferentPort = progression("hawaii-next-top", "hawaii", target, "top");
  const groups = storyVariantProgressionFanGroups([
    ...firstFan,
    ...secondFan,
    manualSwitch,
    singletonDifferentPort,
  ]);

  assert.equal(storyVariantProgressionFanKey(manualSwitch), null,
    "a same-beat manual switch never enters a shared progression bus");
  assert.equal(groups.size, 2, "each destination receives its own multi-route fan");
  assert.deepEqual(
    [...groups.values()].map((siblings) => siblings.map((edge) => edge.id)),
    [
      ["california-next", "florida-next", "hawaii-next"],
      ["california-other", "florida-other"],
    ],
  );
  assert.ok(![...groups.values()].flat().includes(manualSwitch));
  assert.ok(![...groups.values()].flat().includes(singletonDifferentPort),
    "an incompatible single route falls back to its own ordinary arrow");

  const geometryStart = source.indexOf("function storyVariantProgressionFanGeometry(");
  const geometryEnd = source.indexOf("\nfunction sourceGraphLinkRoutePoints(", geometryStart);
  assert.notEqual(geometryStart, -1, "fan geometry helper exists");
  assert.notEqual(geometryEnd, -1, "fan geometry helper has a pure extraction seam");
  const geometrySource = source.slice(geometryStart, geometryEnd);
  const storyVariantProgressionFanGeometry = new Function(
    `${geometrySource}; return storyVariantProgressionFanGeometry;`,
  )();
  const routes = [
    { id: "california-next", start: { x: 280, y: 150 }, end: { x: 640, y: 150 }, labelWidth: 144, labelHeight: 40 },
    { id: "florida-next", start: { x: 280, y: 360 }, end: { x: 640, y: 150 }, labelWidth: 144, labelHeight: 84 },
    { id: "hawaii-next", start: { x: 280, y: 570 }, end: { x: 640, y: 150 }, labelWidth: 196, labelHeight: 72 },
  ];
  const geometry = storyVariantProgressionFanGeometry(routes, {
    trunkOffset: 32,
    arrowTipClearance: 12,
    controlGap: 10,
    minimumBranchLength: 220,
  });

  assert.ok(geometry);
  assert.deepEqual(geometry.trunk, { x: 608, top: 150, bottom: 570 });
  assert.deepEqual(geometry.destination, {
    start: { x: 608, y: 150 },
    end: { x: 628, y: 150 },
  });

  const shiftedTargetRoutes = routes.map((route) => ({
    ...route,
    end: { x: route.end.x + 120, y: route.end.y },
  }));
  const clearedGeometry = storyVariantProgressionFanGeometry(shiftedTargetRoutes, {
    trunkOffset: 152,
    arrowTipClearance: 12,
    controlGap: 10,
    minimumBranchLength: 220,
  });
  assert.ok(clearedGeometry);
  assert.deepEqual(clearedGeometry.trunk, geometry.trunk,
    "extra consecutive-variant spacing does not move the shared vertical trunk");
  assert.deepEqual(clearedGeometry.destination, {
    start: { x: 608, y: 150 },
    end: { x: 748, y: 150 },
  }, "the destination segment extends across the added clearance to the shifted beat");
  assert.deepEqual(geometry.branches.map((branch) => branch.id), routes.map((route) => route.id));
  assert.equal(new Set(geometry.branches.map((branch) => branch.end.x)).size, 1,
    "every horizontal branch joins the same vertical trunk");
  for (const [index, branch] of geometry.branches.entries()) {
    const route = routes[index];
    assert.equal(branch.start.y, branch.end.y, `${route.id} stays horizontal`);
    assert.equal(branch.end.x, geometry.trunk.x, `${route.id} reaches the shared trunk`);
    assert.equal(branch.label.width, route.labelWidth);
    assert.equal(branch.label.height, route.labelHeight);
    assert.equal(branch.label.x + branch.label.width / 2, (branch.start.x + branch.end.x) / 2,
      `${route.id} control is centered over its own branch`);
    assert.equal(branch.label.y + branch.label.height + 10, branch.start.y,
      `${route.id} control uses its data height and a ten-pixel gap above the branch`);
  }
  assert.equal(storyVariantProgressionFanGeometry([routes[0]], {}), null);
  assert.equal(storyVariantProgressionFanGeometry([
    routes[0],
    { ...routes[1], end: { x: 641, y: 150 } },
  ], {}), null, "routes with different targets cannot share a trunk");
  assert.equal(storyVariantProgressionFanGeometry([
    routes[0],
    { ...routes[1], start: { x: 290, y: 360 } },
  ], {}), null, "misaligned source columns fall back to independent routing");
});

test("saved Source Graph arrows route around intervening card rectangles", async () => {
  const source = await readFile(mainUrl, "utf8");
  const routingStart = source.indexOf("function scheduleSourceGraphLinkLayout(");
  const routingEnd = source.indexOf("\nfunction markSourceGraphCardCombineCandidates(", routingStart);
  assert.notEqual(routingStart, -1, "Source Graph link layout exists");
  assert.notEqual(routingEnd, -1, "Source Graph link routing helpers stay testable as one unit");
  const routingSource = source.slice(routingStart, routingEnd);
  const {
    sourceGraphLinkPath,
    sourceGraphLinkRoutePoints,
    sourceGraphLinkSegmentBlocked,
  } = new Function(`${routingSource}; return {
    sourceGraphLinkPath,
    sourceGraphLinkRoutePoints,
    sourceGraphLinkSegmentBlocked,
  };`)();

  const start = { x: 20, y: 100 };
  const end = { x: 200, y: 100 };
  const blocker = {
    x: 90,
    y: 60,
    width: 40,
    height: 80,
    left: 90,
    top: 60,
    right: 130,
    bottom: 140,
  };
  const directPath = sourceGraphLinkPath(start, end, "right", "left", []);
  const collisionFreePath = sourceGraphLinkPath(start, end, "right", "left", [blocker]);

  assert.notEqual(
    collisionFreePath,
    directPath,
    "an intervening card changes the generated arrow route",
  );
  const coordinates = [...collisionFreePath.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]));
  const yCoordinates = coordinates.filter((_, index) => index % 2 === 1);
  assert.ok(
    yCoordinates.some((value) => value < blocker.top || value > blocker.bottom),
    "the rerouted arrow leaves the blocking card's vertical span",
  );

  const screenshotCards = [
    { left: 0, top: 0, right: 280, bottom: 372, width: 280, height: 372 },
    { left: 356, top: 0, right: 636, bottom: 408, width: 280, height: 408 },
    { left: 356, top: 430, right: 636, bottom: 760, width: 280, height: 330 },
  ];
  const screenshotRoute = sourceGraphLinkRoutePoints(
    { x: 280, y: 186 },
    { x: 356, y: 595 },
    "right",
    "left",
    screenshotCards,
  );
  assert.ok(
    356 - screenshotRoute.at(-1).x >= 10,
    "the arrowhead stops outside the destination card instead of extending beneath it",
  );
  for (let index = 1; index < screenshotRoute.length; index += 1) {
    assert.equal(
      sourceGraphLinkSegmentBlocked(
        screenshotRoute[index - 1],
        screenshotRoute[index],
        screenshotCards,
      ),
      false,
      `screenshot route segment ${index} stays outside every card`,
    );
  }

  const layout = source.match(/function layoutSourceGraphLinks\([\s\S]*?\nfunction /)?.[0] || "";
  assert.match(
    layout,
    /sourceGraphLinkPath\([^;]*,\s*(?:obstacles|cardRects|blockingRects)\s*\)/,
    "live layout supplies the current card rectangles to the router",
  );
  assert.match(
    routingSource,
    /querySelectorAll\("\[data-source-graph-card\]"\)|querySelectorAll\('\[data-source-graph-card\]'\)/,
    "the route updates from every rendered beat and variant card",
  );
  const bindings = source.match(/function bindSourceGraphLinkEvents\([\s\S]*?\nfunction updateSourceGraphLinkDrag/)?.[0] || "";
  assert.match(
    bindings,
    /for \(const card of viewport\.querySelectorAll\("\[data-source-graph-card\]"\)\) \{\s*sourceGraphLinkResizeObserver\.observe\(card\);/s,
    "every card resize schedules fresh arrow geometry",
  );
});

test("Source Graph uses a full-width canvas and an editable bottom text drawer", async () => {
  const source = await readFile(mainUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");
  const editor = source.match(/function renderGraphEditor\(\) \{[\s\S]*?\nfunction renderSourceGraphStatus/)?.[0] || "";
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const drawer = source.match(/function sourceGraphTextDetailMatches\([\s\S]*?\nfunction renderSourceGraphVariantAlternatives/)?.[0] || "";
  const bindings = source.match(/function bindEvents\(\) \{[\s\S]*?\nfunction bindSourceGraphAssetTooltipEvents/)?.[0] || "";
  const panning = source.match(/function bindSourceGraphCanvasPanning\([\s\S]*?\nfunction bindSpatialRelationsEvents/)?.[0] || "";
  const updater = source.match(/function updateSourceGraphFullText\([\s\S]*?\nfunction updateSelectedBeatField/)?.[0] || "";

  assert.match(source, /sourceGraphTextDetail: null/);
  assert.doesNotMatch(editor, /source-graph-inspector/);
  assert.doesNotMatch(editor, /renderBeatDetailPanel/);
  assert.match(timeline, /class="source-graph-canvas-stage"/);
  assert.match(timeline, /renderSourceGraphFullTextDetail\(\)/);
  assert.match(timeline, /data-source-graph-text-preview/);
  assert.match(timeline, /data-source-graph-text-variant-option/);
  assert.doesNotMatch(timeline, /source-graph-beat-summary" data-select-beat/);
  assert.match(drawer, /if \(!detail\) return ""/);
  assert.match(drawer, /textarea[\s\S]*data-source-graph-full-text-editor/);
  assert.match(drawer, /\$\{escapeHtml\(detail\.text\)\}<\/textarea>/);
  assert.match(drawer, /input[\s\S]*data-source-graph-full-title-editor/);
  assert.match(drawer, /value="\$\{escapeHtml\(detail\.titleValue\)\}"/);
  assert.doesNotMatch(drawer, /shortText\(/);
  assert.match(bindings, /querySelectorAll\("\[data-source-graph-text-preview\]"\)/);
  assert.match(bindings, /state\.sourceGraphTextDetail = \{/);
  assert.match(bindings, /querySelector\("\[data-source-graph-full-text-editor\]"\)/);
  assert.match(bindings, /updateSourceGraphFullText\(fullTextEditor\.value\)/);
  assert.match(bindings, /querySelector\("\[data-source-graph-full-title-editor\]"\)/);
  assert.match(bindings, /updateSourceGraphFullTitle\(fullTitleEditor\.value\)/);
  assert.match(bindings, /bindCoalescedAuthorTextHistory\(fullTitleEditor, "Edit story card title", "source-graph"\)/);
  assert.match(updater, /detail\.option\.text = value/);
  assert.match(updater, /detail\.beat\.text = value/);
  assert.match(updater, /detail\.option\.label = value/);
  assert.match(updater, /detail\.beat\.title = value/);
  assert.match(updater, /detail\.beat\.sectionHeading = value/);
  assert.match(updater, /syncEvidenceForBeat\(detail\.beat\.id, beatAssetIds\(detail\.beat\)\)/);
  assert.match(updater, /syncVisibleAtomicBeatsToAtomicStore\(\)/);
  assert.match(updater, /updateGraphDraftFromState\(\{ storyFlowChanged: true \}\)/);
  assert.match(panning, /Math\.hypot[\s\S]*> 5/);
  assert.match(panning, /!pan\.moved && Boolean\(state\.sourceGraphTextDetail\)/);
  assert.match(panning, /state\.sourceGraphTextDetail = null/);
  assert.match(styles, /\.source-graph-canvas-layout \{[^}]*grid-template-areas:\s*"assets canvas";[^}]*minmax\(240px, 280px\)\s*minmax\(0, 1fr\);/s);
  assert.doesNotMatch(styles, /\.source-graph-inspector/);
  assert.match(styles, /\.source-graph-canvas-stage \{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/s);
  assert.match(styles, /@media \(min-width: 861px\) \{[\s\S]*\.source-graph-canvas-layout \{[^}]*align-items:\s*stretch;[\s\S]*\.source-graph-asset-dock,\s*\.source-graph-canvas-shell \{[^}]*align-self:\s*stretch;[^}]*height:\s*max\(960px, calc\(100vh - 32px\)\);[\s\S]*\.source-graph-canvas-stage \{[^}]*min-height:\s*0;[^}]*height:\s*auto;/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.source-graph-canvas-stage,[\s\S]*height:\s*auto;[^}]*min-height:\s*0;[^}]*overflow:\s*visible;/);
  assert.match(styles, /\.source-graph-full-text-detail \{[^}]*max-height:\s*min\(34vh, 300px\);[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.source-graph-full-text-body \{[^}]*resize:\s*vertical;[^}]*white-space:\s*pre-wrap;/s);
  assert.match(styles, /\.source-graph-full-text-title-editor \{[^}]*font-weight:\s*800;/s);
  assert.match(styles, /\.source-graph-full-text-title-editor:focus,[\s\S]*\.source-graph-full-text-body:focus \{[^}]*border-color:\s*var\(--accent\);/s);
});

test("Source Graph cards hug their content at the top while variants retain the desktop story line and mobile stack", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /\.source-graph-canvas-track \{[^}]*align-items:\s*flex-start;/s);
  assert.match(styles, /\.source-graph-beat-item \{[^}]*grid-template-rows:\s*auto auto;[^}]*align-content:\s*start;/s);
  assert.match(styles, /\.source-graph-beat-card \{[^}]*grid-row:\s*1;[^}]*grid-auto-rows:\s*auto;[^}]*align-content:\s*start;[^}]*align-self:\s*start;[^}]*min-height:\s*0;/s);
  assert.match(styles, /\.source-graph-beat-excerpt \{[^}]*min-height:\s*0;/s);
  assert.match(styles, /\.source-graph-beat-assets \{[^}]*min-height:\s*0;/s);
  assert.match(styles, /\.source-graph-variant-alternatives \{[^}]*grid-row:\s*2;/s);
  assert.match(styles, /\.graph-editor \.source-graph-beat-item\.has-variants > \.source-graph-beat-card \{[^}]*margin-block-end:\s*30px;/s);
  assert.match(styles, /\.graph-editor \.source-graph-variant-option-item\.has-next-variant \{[^}]*margin-block-end:\s*30px;/s);
  assert.match(styles, /\.graph-editor \.source-graph-variant-alternatives\.has-options::before \{[^}]*top:\s*-48px;/s);
  assert.match(styles, /\.source-graph-parallel-variant-card \{[^}]*grid-template-rows:\s*repeat\(2, auto\);[^}]*align-content:\s*start;[^}]*height:\s*auto;[^}]*min-height:\s*0;/s);
  assert.match(styles, /\.source-graph-beat-connector \{[^}]*grid-row:\s*1;[^}]*align-self:\s*start;[^}]*margin-top:\s*30px;/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.source-graph-beat-connector \{[^}]*grid-row:\s*3;[^}]*margin-top:\s*0;/);
  assert.doesNotMatch(styles, /\.evidence-badge\.variant\s*\{/);
});

test("card combining exposes two text-free drop fields only while hovering a compatible destination", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const alternatives = source.match(/function renderSourceGraphVariantAlternatives\([\s\S]*?\nfunction renderSourceGraphBeatAsset/)?.[0] || "";
  const dropFields = source.match(/function renderSourceGraphCardCombineDropFields\([\s\S]*?\nfunction renderSourceGraphBeatAsset/)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphCanvasEvents\([\s\S]*?\nfunction sourceGraphDragPayloadHasSource/)?.[0] || "";

  assert.match(timeline, /draggable="true"[\s\S]*sourceGraphCardEndpointAttributes\(primaryCardEndpoint\)/);
  assert.match(alternatives, /draggable="true"[\s\S]*sourceGraphCardEndpointAttributes\(cardEndpoint\)/);
  assert.match(dropFields, /data-source-graph-card-combine-drop="up"><\/div>/);
  assert.match(dropFields, /data-source-graph-card-combine-drop="down"><\/div>/);
  assert.doesNotMatch(dropFields, />\s*(Up|Down|Dragged text)/);
  assert.match(bindings, /card\.addEventListener\("dragenter"/);
  assert.match(bindings, /card\.addEventListener\("dragenter"[\s\S]*?clearSourceGraphVariantInsertPreview\(\);[\s\S]*?card\.classList\.add\("is-card-combine-hover"\)/);
  assert.match(bindings, /card\.addEventListener\("dragover"[\s\S]*?clearSourceGraphVariantInsertPreview\(\);[\s\S]*?card\.classList\.add\("is-card-combine-hover"\)/);
  assert.match(bindings, /card\.classList\.add\("is-card-combine-hover"\)/);
  assert.match(bindings, /canCombineSourceGraphCards\(source, target\)/);
  assert.match(styles, /\.source-graph-card-combine-drop-fields \{[^}]*display:\s*none;/s);
  assert.match(styles, /\.source-graph-beat-card\.is-card-combine-candidate\.is-card-combine-hover[\s\S]*> \.source-graph-card-combine-drop-fields \{[^}]*display:\s*grid;/s);
});

test("Source Graph exposes dedicated drag handles and gap targets for beat and variant reordering", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const alternatives = source.match(/function renderSourceGraphVariantAlternatives\([\s\S]*?\nfunction renderSourceGraphBeatAsset/)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphCanvasEvents\([\s\S]*?\nfunction sourceGraphDragPayloadHasSource/)?.[0] || "";

  assert.match(timeline, /data-source-graph-reorder-kind="beat"/);
  assert.match(timeline, /class="source-graph-card-reorder-handle grip"[\s\S]*data-source-graph-reorder-kind="beat"/);
  assert.match(timeline, /<span aria-hidden="true">⠿<\/span>/);
  assert.doesNotMatch(timeline, /data-toggle-beat-selection|beat-select-control|data-beat-group-action/);
  assert.match(timeline, /renderSourceGraphBeatReorderSlot\(beat, "before"\)/);
  assert.match(timeline, /renderSourceGraphBeatReorderSlot\(beat, "after"\)/);
  assert.match(alternatives, /data-source-graph-reorder-kind="variant"/);
  assert.match(alternatives, /class="source-graph-card-reorder-handle grip"[\s\S]*data-source-graph-reorder-kind="variant"/);
  assert.match(alternatives, /data-source-graph-reorder-variant-option/);
  assert.match(bindings, /\[data-source-graph-reorder-handle\]/);
  assert.match(bindings, /application\/x-storyvr-source-graph-reorder/);
  assert.match(bindings, /\[data-source-graph-beat-reorder\]/);
  assert.match(bindings, /sourceGraphCardReorderDestination\(reorderSource, card, event\)/);
  assert.match(bindings, /card\.addEventListener\("drop"[\s\S]*commitSourceGraphReorder\(reorderSource, reorderDestination\)/);
  assert.match(bindings, /commitSourceGraphReorder\(source, \{ targetBeatId, placement \}\)/);
  assert.match(bindings, /commitSourceGraphReorder\(reorderSource, \{ afterOptionId \}\)/);
  assert.match(styles, /\.source-graph-beat-reorder-slot \{[^}]*display:\s*none;/s);
  assert.match(styles, /\.graph-editor\.is-reordering-beat \.source-graph-beat-reorder-slot\.is-beat-reorder-candidate \{[^}]*display:\s*grid;/s);
  assert.match(styles, /\.source-graph-card-reorder-handle\.grip \{[^}]*position:\s*absolute;/s);
  assert.match(styles, /\.source-graph-beat-card\.is-card-reorder-hover::after \{/);
});

test("dragging a primary beat outside the Source Graph canvas removes it through the durable removal path", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const timeline = source.match(/function renderBeatTimeline\(\) \{[\s\S]*?\nfunction sourceGraphDefaultVariantOption/)?.[0] || "";
  const removal = source.match(/function removeSourceGraphBeats\([\s\S]*?\nfunction removeVariantGroupsHostedByBeats/)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphCanvasEvents\([\s\S]*?\nfunction sourceGraphDragPayloadHasSource/)?.[0] || "";
  const outsideHelper = source.match(/function sourceGraphDragIsOutsideCanvas\([\s\S]*?\n\}/)?.[0] || "";
  const dragIsOutside = new Function(`${outsideHelper}; return sourceGraphDragIsOutsideCanvas;`)();

  assert.match(timeline, /data-source-graph-remove-drop-hint/);
  assert.match(timeline, /Release to remove card/);
  assert.equal(dragIsOutside({ clientX: 99, clientY: 150 }, {
    getBoundingClientRect: () => ({ left: 100, right: 300, top: 100, bottom: 300 }),
  }), true);
  assert.equal(dragIsOutside({ clientX: 200, clientY: 150 }, {
    getBoundingClientRect: () => ({ left: 100, right: 300, top: 100, bottom: 300 }),
  }), false);
  assert.match(bindings, /sourceGraphActiveDraggedBeatId = payload\.reorderKind === "beat"/);
  assert.match(bindings, /card\.parentElement\?\.matches\("\.source-graph-beat-item"\)/);
  assert.match(bindings, /sourceGraphDragIsOutsideCanvas\(event\)/);
  assert.match(bindings, /removeSourceGraphBeat\(beatId\)/);
  assert.match(removal, /removable\.length >= beats\.length/);
  assert.match(removal, /removeSourceGraphBeats\(\[beat\], "Remove story card"\)/);
  assert.match(styles, /\.graph-editor\.is-removing-beat \.source-graph-remove-drop-hint/);
  assert.match(styles, /\.graph-editor\.is-remove-beat-blocked \.source-graph-remove-drop-hint/);
});

test("beat dragging keeps variant proximity zones thin until the pointer enters one", async () => {
  const [source, styles] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const alternatives = source.match(/function renderSourceGraphVariantAlternatives\([\s\S]*?\nfunction renderSourceGraphBeatAsset/)?.[0] || "";
  const bindings = source.match(/function bindSourceGraphCanvasEvents\([\s\S]*?\nfunction sourceGraphDragPayloadHasSource/)?.[0] || "";
  const preview = source.match(/function showSourceGraphVariantInsertPreview\([\s\S]*?\nfunction clearSourceGraphCardDragVisualState/)?.[0] || "";

  assert.match(alternatives, /renderSourceGraphVariantInsertSlot\(beat, defaultOption\?\.id \|\| null\)/);
  assert.match(alternatives, /renderSourceGraphVariantInsertSlot\(beat, option\.id\)/);
  assert.match(alternatives, /data-source-graph-variant-insert-target-beat/);
  assert.match(bindings, /\[data-source-graph-variant-insert\]/);
  assert.match(bindings, /clearSourceGraphCardCombineHoverState\(\);[\s\S]*showSourceGraphVariantInsertPreview\(slot\)/);
  assert.match(bindings, /showSourceGraphVariantInsertPreview\(slot\)/);
  assert.match(bindings, /commitSourceGraphBeatVariantPlacement\(source, targetBeatId, afterOptionId\)/);
  assert.match(preview, /cloneNode\(true\)/);
  assert.match(preview, /source-graph-variant-insert-preview-card/);
  assert.match(preview, /clearSourceGraphVariantInsertPreview/);
  assert.match(styles, /\.source-graph-variant-insert-slot \{[^}]*display:\s*none;/s);
  assert.match(styles, /\.source-graph-variant-alternatives\.is-drop-only\.has-variant-insert-candidate \{[^}]*position:\s*absolute;[^}]*height:\s*0;/s);
  assert.match(styles, /\.source-graph-variant-alternatives\.has-options\.has-variant-insert-candidate \{[^}]*gap:\s*0;/s);
  assert.match(styles, /\.source-graph-variant-insert-slot\.is-variant-insert-candidate \{[^}]*display:\s*block;[^}]*height:\s*18px;[^}]*min-height:\s*0;/s);
  assert.match(styles, /\.source-graph-variant-insert-slot\.is-variant-insert-candidate:first-child,[\s\S]*\.source-graph-variant-insert-slot\.is-variant-insert-candidate:last-child \{[^}]*height:\s*0;/s);
  assert.match(styles, /\.source-graph-variant-insert-slot\.is-variant-insert-candidate::after \{[^}]*height:\s*18px;/s);
  assert.match(styles, /\.source-graph-variant-insert-marker \{[^}]*display:\s*none;/s);
  assert.match(styles, /\.source-graph-variant-insert-slot\.is-variant-insert-candidate\.is-variant-insert-preview \{[^}]*display:\s*grid;[^}]*height:\s*auto;/s);
  assert.doesNotMatch(styles, /\.source-graph-variant-insert-slot\.is-variant-insert-preview::after \{[^}]*display:\s*none;/s);
  assert.doesNotMatch(styles, /\.source-graph-variant-insert-slot\.is-variant-insert-candidate \{[^}]*min-height:\s*42px;/s);
  assert.match(styles, /\.source-graph-beat-card\.source-graph-variant-insert-preview-card/);
});

test("Source Graph disables Split for a combined beat that hosts variants", async () => {
  const source = await readFile(mainUrl, "utf8");
  const helper = source.match(/function beatGroupingActionState\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const groupingState = new Function(
    "state",
    "selectedGroupingBeats",
    "isCombinedBeat",
    "variantGroupForBeat",
    `${helper}; return beatGroupingActionState;`,
  );
  const combinedBeat = { id: "combined-a-b", atomicBeatIds: ["a", "b"], variantGroupId: "group-a" };
  const state = { data: { graph: { beats: [combinedBeat, { id: "other" }] } } };

  const hostedGroupingState = groupingState(
    state,
    () => [combinedBeat],
    () => true,
    () => ({ id: "group-a", beatId: combinedBeat.id }),
  );
  const ungroupedGroupingState = groupingState(
    state,
    () => [combinedBeat],
    () => true,
    () => null,
  );

  assert.equal(hostedGroupingState().canSplit, false);
  assert.equal(ungroupedGroupingState().canSplit, true);
});

test("removing a variant host prunes its group and every option-owned atomic beat", async () => {
  const source = await readFile(mainUrl, "utf8");
  const helper = source.match(/function removeVariantGroupsHostedByBeats\(graph, beats\) \{[\s\S]*?\n\}/)?.[0] || "";
  const removeHostedGroups = new Function(`${helper}; return removeVariantGroupsHostedByBeats;`)();
  const removeAction = source.match(/function removeSourceGraphBeats\([\s\S]*?\nfunction removeVariantGroupsHostedByBeats/)?.[0] || "";
  const graph = {
    variantGroups: [
      {
        id: "group-a",
        beatId: "host-a",
        options: [
          { id: "default", sourceBeatId: "host-a", atomicBeatIds: ["host-a"] },
          { id: "variant", sourceBeatId: "option-b", atomicBeatIds: ["option-b", "option-c"] },
          { id: "legacy", sourceBeatId: "legacy-option" },
        ],
      },
      {
        id: "group-b",
        beatId: "host-b",
        options: [{ id: "default", sourceBeatId: "host-b", atomicBeatIds: ["host-b"] }],
      },
    ],
  };

  const removedAtomicBeatIds = removeHostedGroups(graph, [{ id: "host-a", variantGroupId: "group-a" }]);

  assert.deepEqual([...removedAtomicBeatIds].sort(), ["host-a", "legacy-option", "option-b", "option-c"]);
  assert.deepEqual(graph.variantGroups.map((group) => group.id), ["group-b"]);
  assert.match(removeAction, /removeVariantGroupsHostedByBeats\(state\.data\.graph, removable\)/);
  assert.match(removeAction, /\.\.\.variantAtomicBeatIds/);
  assert.match(removeAction, /filter\(\(beat\) => !removedAtomicBeatIds\.has\(beat\.id\)\)/);
  assert.match(removeAction, /pruneRemovedBeatOverrides\(new Set\(\[\.\.\.selectedBeatIds, \.\.\.removedAtomicBeatIds\]\)\)/);
});
