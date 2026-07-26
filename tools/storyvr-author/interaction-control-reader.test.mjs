import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { EventDispatcher } from "three";

const source = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");
const html = await readFile(new URL("./reader-template/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("./reader-template/src/styles.css", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function evaluateFunctions(names, exportedName) {
  return new Function(`${names.map(functionSource).join("\n")}\nreturn ${exportedName};`)();
}

function evaluateFunctionsWithThree(names, exportedName, prelude = "") {
  return new Function("THREE", `${prelude}\n${names.map(functionSource).join("\n")}\nreturn ${exportedName};`)(THREE);
}

const interactionDefaultsPrelude = `
  const DEFAULT_LOCOMOTION_DISTANCE_METERS = 0.68;
  const DEFAULT_LOCOMOTION_DWELL_SECONDS = 1.25;
  const DEFAULT_DIRECT_POSITION_TOLERANCE_METERS = 0.12;
  const DEFAULT_DIRECT_ROTATION_TOLERANCE_DEGREES = 12;
  const DEFAULT_DIRECT_SCALE_TOLERANCE_RATIO = 0.12;
`;

const normalizerFunctions = [
  "finiteInteractionArray",
  "finiteInteractionNumber",
  "normalizeRuntimeControllerControl",
  "normalizeRuntimeControllerAction",
  "normalizeRuntimeTransform",
  "normalizeRuntimeInteractionConfiguration",
  "runtimeProgressionContext",
  "runtimeProgressionContextForRecord",
  "normalizeRuntimeProgressionRoute",
  "runtimeProgressionRouteIsScoped",
  "runtimeProgressionRouteKey",
  "runtimeInteractionRecordIsRouteAware",
  "normalizeRuntimeInteractionControl",
  "runtimeInteractionBoundaryEntries",
  "runtimeInteractionBoundaryEntry",
  "runtimeInteractionBoundaryMatches",
  "runtimeBeatIdentityValues",
  "runtimeInteractionPolicyForUnit",
  "runtimeInteractionTimelineEntry",
  "runtimeInteractionPolicyValue",
  "normalizeRuntimeInteractionPolicy",
  "normalizeRuntimeLocomotionMode",
];

test("reader consumes canonical per-boundary interaction assignments", () => {
  const normalize = evaluateFunctions(normalizerFunctions, "normalizeRuntimeInteractionControl");
  const result = normalize({
    interactionPolicy: "Direct manipulation",
    interactionControlByBoundary: [
      {
        boundaryId: "opening->middle",
        fromBeatId: "opening",
        toBeatId: "middle",
        inferredPolicy: "Button stepping",
        effectivePolicy: "Controller button press",
        reason: "No visual state changes.",
      },
      {
        boundaryId: "middle->ending",
        fromBeatId: "middle",
        toBeatId: "ending",
        inferredPolicy: "Reader locomotion",
        effectivePolicy: "Reader locomotion",
        locomotionMode: "virtual-teleport",
      },
    ],
  }, [], [{ id: "opening" }, { id: "middle" }, { id: "ending" }]);

  assert.equal(result.boundaries.length, 2);
  assert.equal(result.boundaries[0].effectivePolicy, "Controller button press");
  assert.equal(result.boundaries[0].inferredPolicy, "Controller button press");
  assert.equal(result.boundaries[0].reason, "No visual state changes.");
  assert.equal(result.boundaries[1].effectivePolicy, "Reader locomotion");
  assert.equal(result.boundaries[1].locomotionMode, "virtual-teleport");
});

test("reader preserves route-scoped interaction records beside the legacy beat boundary", () => {
  const normalize = evaluateFunctionsWithThree(
    normalizerFunctions,
    "normalizeRuntimeInteractionControl",
    interactionDefaultsPrelude,
  );
  const result = normalize({
    interactionControlByBoundary: [
      {
        boundaryId: "variants->ending",
        fromBeatId: "variants",
        toBeatId: "ending",
        effectivePolicy: "Controller button press",
        configuration: { bindings: [{ hand: "right", input: "a", action: "next-beat" }] },
      },
      {
        boundaryId: "tiger-to-ending",
        fromBeatId: "variants",
        toBeatId: "ending",
        fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "tiger" },
        toContext: { beatId: "ending" },
        effectivePolicy: "Reader locomotion",
        locomotionMode: "virtual-teleport",
      },
    ],
    interactionControlByRoute: [{
        edgeId: "white-to-ending",
        fromBeatId: "variants",
        toBeatId: "ending",
        fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
        toContext: { beatId: "ending" },
        effectivePolicy: "Direct manipulation",
        configuration: { targets: [{ entityId: "glb:white", destinationTransform: {} }] },
      }],
  }, [], [{ id: "variants" }, { id: "ending" }]);

  assert.equal(result.boundaries.length, 1);
  assert.equal(result.boundaries[0].boundaryId, "variants->ending");
  assert.equal(result.boundaries[0].effectivePolicy, "Controller button press");
  assert.deepEqual(result.routes.map((route) => ({
    edgeId: route.edgeId,
    optionId: route.fromContext.variantOptionId,
    policy: route.effectivePolicy,
  })), [
    { edgeId: "white-to-ending", optionId: "white", policy: "Direct manipulation" },
    { edgeId: "tiger-to-ending", optionId: "tiger", policy: "Reader locomotion" },
  ]);
});

test("reader chooses a progression route from the active variant without crossing option identities", () => {
  const resolve = evaluateFunctions([
    "runtimeProgressionContext",
    "runtimeProgressionContextForRecord",
    "normalizeRuntimeProgressionRoute",
    "runtimeBeatIdentityValues",
    "runtimeProgressionRouteMatchesBeatChange",
    "runtimeProgressionRouteFromCandidates",
  ], "runtimeProgressionRouteFromCandidates");
  const routes = [
    {
      edgeId: "white-next",
      fromBeatId: "variants",
      toBeatId: "ending",
      fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
      toContext: { beatId: "ending" },
    },
    {
      edgeId: "tiger-next",
      fromBeatId: "variants",
      toBeatId: "ending",
      fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "tiger" },
      toContext: { beatId: "ending" },
    },
  ];
  const fromBeat = { id: "variants" };
  const toBeat = { id: "ending" };
  const group = { id: "sharks" };

  assert.equal(resolve(routes, fromBeat, toBeat, group, { id: "white" }).edgeId, "white-next");
  assert.equal(resolve(routes, fromBeat, toBeat, group, { id: "tiger" }).edgeId, "tiger-next");
  assert.equal(resolve(routes, fromBeat, toBeat, group, { id: "nurse" }), null);
});

test("reader resolves a route interaction before the adjacent-boundary fallback", () => {
  const resolve = new Function(`
    const runtimeInteractionControl = {
      routes: [{
        edgeId: "white-next",
        fromBeatId: "variants",
        toBeatId: "ending",
        fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
        toContext: { beatId: "ending" },
        effectivePolicy: "Direct manipulation",
      }],
      boundaries: [{
        boundaryId: "variants->ending",
        fromBeatId: "variants",
        toBeatId: "ending",
        effectivePolicy: "Controller button press",
      }],
    };
    function runtimeProgressionRouteForNavigation() { return null; }
    ${functionSource("runtimeProgressionContext")}
    ${functionSource("runtimeProgressionContextForRecord")}
    ${functionSource("normalizeRuntimeProgressionRoute")}
    ${functionSource("runtimeProgressionRouteIsScoped")}
    ${functionSource("runtimeProgressionRoutesMatch")}
    ${functionSource("runtimeInteractionForProgressionRoute")}
    ${functionSource("runtimeInteractionForBoundary")}
    return runtimeInteractionForBoundary;
  `)();
  const whiteRoute = {
    edgeId: "white-next",
    fromBeatId: "variants",
    toBeatId: "ending",
    fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
    toContext: { beatId: "ending" },
  };
  const unknownRoute = { ...whiteRoute, edgeId: "nurse-next" };

  assert.equal(resolve(0, 1, whiteRoute).effectivePolicy, "Direct manipulation");
  assert.equal(resolve(0, 1, unknownRoute).effectivePolicy, "Controller button press");
});

test("reader reuses the crossed progression route when navigating to the previous beat", () => {
  const helpers = new Function(`
    const beats = [{ id: "variants" }, { id: "ending" }];
    const runtimeProgressionRoutes = [{
      edgeId: "white-next",
      fromBeatId: "variants",
      toBeatId: "ending",
      fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "white" },
      toContext: { beatId: "ending" },
    }, {
      edgeId: "tiger-next",
      fromBeatId: "variants",
      toBeatId: "ending",
      fromContext: { beatId: "variants", variantGroupId: "sharks", variantOptionId: "tiger" },
      toContext: { beatId: "ending" },
    }];
    const runtimeProgressionRouteHistory = new Map();
    const group = { id: "sharks" };
    let selectedOptionId = "white";
    function runtimeVariantGroupForBeat(beat) { return beat?.id === "variants" ? group : null; }
    function runtimeVariantOptionForGroup(value) { return value ? { id: selectedOptionId } : null; }
    ${functionSource("runtimeProgressionContext")}
    ${functionSource("runtimeProgressionContextForRecord")}
    ${functionSource("normalizeRuntimeProgressionRoute")}
    ${functionSource("runtimeBeatIdentityValues")}
    ${functionSource("runtimeProgressionRouteMatchesBeatChange")}
    ${functionSource("runtimeProgressionRouteFromCandidates")}
    ${functionSource("runtimeProgressionRouteHistoryKey")}
    ${functionSource("runtimeProgressionRouteForBeatChange")}
    ${functionSource("runtimeProgressionRouteForNavigation")}
    ${functionSource("rememberRuntimeProgressionRoute")}
    return {
      forward() { return runtimeProgressionRouteForNavigation(0, 1); },
      remember(route) { return rememberRuntimeProgressionRoute(route, 0, 1); },
      reverse() { return runtimeProgressionRouteForNavigation(1, 0); },
      select(optionId) { selectedOptionId = optionId; },
    };
  `)();

  const crossed = helpers.forward();
  assert.equal(crossed.edgeId, "white-next");
  helpers.remember(crossed);
  helpers.select("tiger");
  assert.equal(helpers.reverse().edgeId, "white-next");
});

test("reader applies a route's exact destination option when the next beat is also a variant group", () => {
  const apply = new Function(`
    const beats = [{ id: "materials" }, { id: "finishes" }];
    const targetGroup = { id: "finishes-group", options: [{ id: "matte" }, { id: "gloss" }] };
    const activeVariantOptionByGroupId = new Map();
    function runtimeVariantGroupForBeat(beat) { return beat?.id === "finishes" ? targetGroup : null; }
    ${functionSource("runtimeProgressionContext")}
    ${functionSource("runtimeProgressionContextForRecord")}
    ${functionSource("normalizeRuntimeProgressionRoute")}
    ${functionSource("runtimeBeatIdentityValues")}
    ${functionSource("runtimeProgressionRouteMatchesBeatChange")}
    ${functionSource("applyRuntimeProgressionDestination")}
    applyRuntimeProgressionDestination({
      edgeId: "wood-to-gloss",
      fromBeatId: "materials",
      toBeatId: "finishes",
      fromContext: { beatId: "materials", variantGroupId: "materials-group", variantOptionId: "wood" },
      toContext: { beatId: "finishes", variantGroupId: "finishes-group", variantOptionId: "gloss" },
    }, 0, 1);
    return activeVariantOptionByGroupId;
  `)();

  assert.equal(apply.get("finishes-group"), "gloss");
});

test("reader carries one progression route through interaction, playback, and traversal", () => {
  const navigate = functionSource("navigateInteraction");
  const setBeat = functionSource("setBeat");
  const direct = functionSource("configureRuntimeDirectManipulation");
  const variantSelect = functionSource("selectRuntimeVariantOption");

  assert.match(navigate, /runtimeProgressionRouteForNavigation\(activeIndex, destinationIndex\)/);
  assert.match(navigate, /runtimeInteractionForBoundary\(activeIndex, destinationIndex, route\)/);
  assert.match(navigate, /setBeat\(destinationIndex, \{ route \}\)/);
  assert.match(setBeat, /options\.route \|\| runtimeProgressionRouteForNavigation\(previousIndex, destinationIndex\)/);
  assert.match(setBeat, /rememberRuntimeProgressionRoute\(progressionRoute, previousIndex, destinationIndex\)/);
  assert.match(setBeat, /applyRuntimeProgressionDestination\(progressionRoute, previousIndex, destinationIndex\)/);
  assert.match(setBeat, /route: progressionRoute/);
  assert.match(setBeat, /sourceMotionModelAssetForBeatChange\(previousIndex, activeIndex, progressionRoute\)/);
  assert.match(setBeat, /sourceTransitionForBeatChange\(previousIndex, activeIndex, modelAsset\.id, progressionRoute\)/);
  assert.match(setBeat, /applySpatialTraversalForBeat\(beat, previousIndex, progressionRoute\)/);
  assert.match(direct, /runtimeInteractionForBoundary\(activeIndex, activeIndex \+ 1, outgoingRoute\)/);
  assert.match(direct, /route: outgoingRoute/);
  assert.match(variantSelect, /setBeat\(activeIndex\)/, "within-beat variant selection remains a same-index refresh");
});

test("reader normalizes policy-specific interaction configurations without dropping authored fields", () => {
  const normalize = evaluateFunctionsWithThree([
    "runtimeInteractionPolicyValue",
    "normalizeRuntimeInteractionPolicy",
    "finiteInteractionArray",
    "finiteInteractionNumber",
    "normalizeRuntimeControllerControl",
    "normalizeRuntimeControllerAction",
    "normalizeRuntimeTransform",
    "normalizeRuntimeInteractionConfiguration",
  ], "normalizeRuntimeInteractionConfiguration", interactionDefaultsPrelude);

  const controller = normalize({
    type: "controller-button-press",
    profile: "meta-quest-touch-plus",
    bindings: [
      { hand: "right", input: "a", action: "next-beat" },
      { hand: "left", input: "thumbstick_up", action: "previous-beat" },
    ],
  }, "Controller button press");
  assert.deepEqual(controller.bindings, [
    { hand: "right", input: "a", action: "next-beat" },
    { hand: "left", input: "thumbstick-up", action: "previous-beat" },
  ]);

  const ui = normalize({
    type: "ui-button-press",
    buttons: [{ id: "choose-tiger", label: "Meet tiger shark", action: "select-variant", position: [0.7, 0.8], size: [0.28, 0.14] }],
  }, "UI button press");
  assert.deepEqual(ui.buttons[0], {
    id: "choose-tiger",
    label: "Meet tiger shark",
    action: "select-variant",
    position: [0.7, 0.8],
    size: [0.28, 0.14],
  });

  const locomotion = normalize({
    type: "reader-locomotion",
    destination: { coordinateSpace: "reader-start", transform: { position: [0, 0, -2] } },
    tolerance: { distanceMeters: 0.5, dwellSeconds: 0.75 },
  }, "Reader locomotion");
  assert.deepEqual(locomotion.destination.transform, {
    position: [0, 0, -2],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  assert.deepEqual(locomotion.tolerance, { distanceMeters: 0.5, dwellSeconds: 0.75 });
  assert.equal(normalize({
    destination: { transform: { position: [0, 0, -1] } },
    tolerance: { dwellSeconds: 0 },
  }, "Reader locomotion").tolerance.dwellSeconds, 0);

  const direct = normalize({
    type: "direct-manipulation",
    targets: [{
      entityId: "glb:shark",
      assetId: "shark.glb",
      destinationTransform: { position: [1, 0, 0], quaternion: [0, 0, 0, 1], scale: [1.2, 1.2, 1.2] },
      suggested: true,
      source: "transform-only-animation",
    }],
    completion: "all",
  }, "Direct manipulation");
  assert.equal(direct.targets[0].entityId, "glb:shark");
  assert.equal(direct.targets[0].suggested, true);
  assert.equal(direct.targets[0].source, "transform-only-animation");
  assert.equal(direct.completion, "all");

  const nonOverlapping = normalize({
    type: "direct-manipulation",
    targets: [
      { entityId: "glb:model", destinationTransform: {} },
      { entityId: "glb:model", nodePath: "Root/Fin", destinationTransform: {} },
    ],
  }, "Direct manipulation");
  assert.deepEqual(nonOverlapping.targets.map((target) => target.nodePath || "whole-object"), ["Root/Fin"]);

  const mixedIdentityTargets = normalize({
    type: "direct-manipulation",
    targets: [
      { entityId: "glb:model", assetId: "model", destinationTransform: {} },
      { assetId: "model", nodePath: "Root/Tail", destinationTransform: {} },
    ],
  }, "Direct manipulation");
  assert.deepEqual(mixedIdentityTargets.targets.map((target) => target.nodePath || "whole-object"), ["Root/Tail"]);
});

test("reader selects only the exact beat or group-qualified variant interaction record", () => {
  const helpers = evaluateFunctions([
    "finiteInteractionArray",
    "normalizeRuntimeTransform",
    "runtimeInBeatSceneKey",
    "runtimeInteractionRangeArray",
    "normalizeRuntimeInteractionRange",
    "normalizeRuntimeInteractionConstraints",
    "normalizeRuntimeInBeatInteractionTarget",
    "normalizeRuntimeInBeatInteractions",
    "runtimeInBeatInteractionForScene",
  ], "({ normalizeRuntimeInBeatInteractions, runtimeInBeatInteractionForScene })");
  const records = helpers.normalizeRuntimeInBeatInteractions([
    {
      beatId: "beat-a",
      targets: [{ entityId: "glb:a", assetId: "a.glb", oneHandGrabbable: true }],
    },
    {
      beatId: "beat-a",
      variantGroupId: "colors",
      variantOptionId: "blue",
      targets: [{
        entityId: "glb:blue",
        assetId: "blue.glb",
        nodePath: "Root/Handle",
        nodeIndex: 7,
        oneHandGrabbable: true,
        twoHandScalable: true,
        initialTransform: { position: [0, 1, 0], scale: [1, 1, 1] },
        constraints: {
          position: { min: [2, 0, 0], max: [-2, 3, 4] },
          rotation: { minDegrees: [-20, -30, -40], maxDegrees: [20, 30, 40] },
          scale: { min: 0.5, max: 2 },
        },
      }],
    },
    {
      beatId: "beat-a",
      variantGroupId: "colors",
      variantOptionId: "red",
      targets: [{ entityId: "glb:red", assetId: "red.glb", twoHandScalable: true }],
    },
  ]);

  assert.deepEqual(records.map((record) => record.sceneKey), [
    "beat:beat-a",
    "beat:beat-a:group:colors:variant:blue",
    "beat:beat-a:group:colors:variant:red",
  ]);
  const blue = helpers.runtimeInBeatInteractionForScene(
    records,
    { sceneKey: "beat:beat-a:variant:blue", beatId: "beat-a", variantOptionId: "blue" },
    { id: "beat-a" },
    { id: "colors" },
    { id: "blue" },
  );
  assert.equal(blue.targets[0].nodeIndex, 7);
  assert.deepEqual(blue.targets[0].constraints.position.min, [-2, 0, 0]);
  assert.deepEqual(blue.targets[0].constraints.position.max, [2, 3, 4]);
  assert.deepEqual(blue.targets[0].constraints.scale, {
    enabled: true,
    min: [0.5, 0.5, 0.5],
    max: [2, 2, 2],
  });
  assert.equal(helpers.runtimeInBeatInteractionForScene(
    records,
    null,
    { id: "beat-a" },
    { id: "colors" },
    { id: "green" },
  ), null, "an unknown variant never falls back to the base beat record");
  assert.equal(helpers.runtimeInBeatInteractionForScene(
    records,
    { sceneKey: "beat:beat-a" },
    { id: "beat-a" },
  ).sceneKey, "beat:beat-a");
});

test("reader drops ancestor part targets even when both paths carry stable node indices", () => {
  const normalize = evaluateFunctions([
    "finiteInteractionArray",
    "normalizeRuntimeTransform",
    "runtimeInBeatSceneKey",
    "runtimeInteractionRangeArray",
    "normalizeRuntimeInteractionRange",
    "normalizeRuntimeInteractionConstraints",
    "normalizeRuntimeInBeatInteractionTarget",
    "normalizeRuntimeInBeatInteractions",
  ], "normalizeRuntimeInBeatInteractions");
  const [record] = normalize([{
    beatId: "beat-a",
    targets: [
      { entityId: "glb:model", assetId: "model.glb", oneHandGrabbable: true },
      { entityId: "glb:model", assetId: "model.glb", nodePath: "Root/Arm", nodeIndex: 3, oneHandGrabbable: true },
      { entityId: "glb:model", assetId: "model.glb", nodePath: "Root/Arm/Hand", nodeIndex: 4, oneHandGrabbable: true },
      { entityId: "glb:model", assetId: "model.glb", nodePath: "Root/Head", nodeIndex: 5, twoHandScalable: true },
      { entityId: "glb:other", assetId: "other.glb", nodePath: "Root/Arm", nodeIndex: 3, oneHandGrabbable: true },
    ],
  }]);

  assert.deepEqual(record.targets.map((target) => `${target.entityId}:${target.nodePath || "whole"}`), [
    "glb:model:Root/Arm/Hand",
    "glb:model:Root/Head",
    "glb:other:Root/Arm",
  ]);
});

test("reader resolves destination-unit and timeline fallbacks without story-specific ids", () => {
  const normalize = evaluateFunctions(normalizerFunctions, "normalizeRuntimeInteractionControl");
  const result = normalize({
    interactionPolicy: "Button stepping",
    effectiveInteractionPolicyByUnit: {
      beta: { policy: "Direct manipulation" },
    },
  }, [
    { unitId: "alpha", interactionPolicy: "Button stepping" },
    { unitId: "beta", interactionPolicy: "Branching selection" },
    { unitId: "gamma", interactionPolicy: "Reader locomotion", locomotionMode: "virtual-teleport" },
  ], [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }]);

  assert.equal(result.boundaries[0].effectivePolicy, "Direct manipulation");
  assert.equal(result.boundaries[1].effectivePolicy, "Reader locomotion");
  assert.equal(result.boundaries[1].locomotionMode, "virtual-teleport");
});

test("WebXR Trigger is reserved for UI-ray interactions and never advances a beat", () => {
  const configure = functionSource("configureXrInteractionControllers");
  const handler = functionSource("handleXrControllerSelect");
  const selectStart = functionSource("handleXrTextPanelSelectStart");

  assert.match(configure, /renderer\.xr\.getController\(index\)/);
  assert.match(configure, /renderer\.xr\.getControllerGrip\(index\)/);
  assert.match(configure, /addEventListener\("select", handleXrControllerSelect\)/);
  assert.match(configure, /addEventListener\("selectstart"/);
  assert.match(configure, /addEventListener\("selectend"/);
  assert.match(handler, /xrTextPanelConsumedSelect\.has\(controller\)/);
  assert.doesNotMatch(handler, /runtimeInteractionForBoundary|handleConfiguredControllerInput|setBeat/);
  assert.match(selectStart, /xrTextPanelScrollStartHit\(entry\)/);
  assert.match(selectStart, /beginXrTextPanelScroll\(entry, hit\)/);
  assert.doesNotMatch(selectStart, /beginXrDirectManipulation|beginXrTextPanelGrab/);
  assert.doesNotMatch(`${configure}\n${handler}`, /BoxGeometry|makeInteractionButton|new THREE\.Mesh/);
});

test("Quest gamepad decoding identifies reserved Trigger/Grip and assignable navigation controls", () => {
  const controls = evaluateFunctionsWithThree([
    "normalizeRuntimeControllerControl",
    "questGamepadButtonIndex",
    "runtimeThumbstickAxes",
    "runtimeControllerControlPressed",
  ], `({ questGamepadButtonIndex, runtimeControllerControlPressed })`, `
    const XR_GAMEPAD_BUTTON_PRESS_THRESHOLD = 0.72;
    const XR_GAMEPAD_BUTTON_RELEASE_THRESHOLD = 0.45;
    const XR_THUMBSTICK_PRESS_THRESHOLD = 0.72;
    const XR_THUMBSTICK_RELEASE_THRESHOLD = 0.45;
  `);
  const buttons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }));
  buttons[0] = { pressed: true, value: 1 };
  buttons[1] = { pressed: true, value: 1 };
  buttons[3] = { pressed: true, value: 1 };
  buttons[4] = { pressed: true, value: 1 };
  const gamepad = { buttons, axes: [0, 0, 0.82, -0.86] };

  assert.equal(controls.questGamepadButtonIndex("a", "right"), 4);
  assert.equal(controls.questGamepadButtonIndex("x", "left"), 4);
  assert.equal(controls.questGamepadButtonIndex("a", "left"), -1);
  assert.equal(controls.runtimeControllerControlPressed(gamepad, "trigger", "right"), true);
  assert.equal(controls.runtimeControllerControlPressed(gamepad, "grip", "right"), true);
  assert.equal(controls.runtimeControllerControlPressed(gamepad, "thumbstick-press", "right"), true);
  assert.equal(controls.runtimeControllerControlPressed(gamepad, "a", "right"), true);
  assert.equal(controls.runtimeControllerControlPressed(gamepad, "thumbstick-right", "right"), true);
  assert.equal(controls.runtimeControllerControlPressed(gamepad, "thumbstick-up", "right"), true);
  assert.equal(controls.runtimeControllerControlPressed(gamepad, "thumbstick-left", "right"), false);
});

test("configured controller navigation ignores legacy Trigger and Grip mappings", () => {
  const handler = functionSource("handleXrControllerSelect");
  const binding = functionSource("runtimeControllerBindingForInput");
  const update = functionSource("updateConfiguredControllerInteractions");
  const render = functionSource("render");
  assert.match(source, /const XR_RESERVED_CONTROLLER_CONTROLS = new Set\(\["trigger", "grip"\]\)/);
  assert.match(binding, /XR_RESERVED_CONTROLLER_CONTROLS\.has\(normalizedControl\)/);
  assert.match(binding, /XR_RESERVED_CONTROLLER_CONTROLS\.has\(bindingInput\)/);
  assert.doesNotMatch(handler, /handleConfiguredControllerInput|setBeat/);
  assert.doesNotMatch(update, /"trigger"|"grip"/);
  assert.match(update, /"thumbstick-press"/);
  assert.match(update, /"thumbstick-up"/);
  assert.match(update, /"thumbstick-down"/);
  assert.match(update, /"thumbstick-left"/);
  assert.match(update, /"thumbstick-right"/);
  assert.match(render, /updateConfiguredControllerInteractions\(\)/);
});

test("legacy runtime bindings cannot route reserved controls into beat actions", () => {
  const bindingForInput = Function(`
    const XR_RESERVED_CONTROLLER_CONTROLS = new Set(["trigger", "grip"]);
    function isControllerButtonInteraction() { return true; }
    function runtimeInteractionConfiguration(boundary) { return boundary.configuration; }
    ${functionSource("normalizeRuntimeControllerControl")}
    ${functionSource("runtimeControllerBindingForInput")}
    return runtimeControllerBindingForInput;
  `)();
  const boundary = {
    configuration: {
      bindings: [
        { hand: "right", input: "trigger", action: "next-beat" },
        { hand: "left", input: "squeeze", action: "previous-beat" },
        { hand: "right", input: "a", action: "next-beat" },
      ],
    },
  };

  assert.equal(bindingForInput(boundary, "right", "trigger"), null);
  assert.equal(bindingForInput(boundary, "left", "grip"), null);
  assert.deepEqual(bindingForInput(boundary, "right", "a"), {
    hand: "right",
    input: "a",
    action: "next-beat",
  });
});

test("Three.js controller events consume a text-panel select before beat advancement", () => {
  const result = Function("EventDispatcher", `
    const controller = new EventDispatcher();
    const xrTextPanelConsumedSelect = new WeakSet([controller]);
    const beats = [{ id: "opening" }, { id: "ending" }];
    const activeIndex = 0;
    let controllerAdvancePending = false;
    let boundaryReads = 0;
    let setBeatCalls = 0;
    function runtimeInteractionForBoundary() {
      boundaryReads += 1;
      return { effectivePolicy: "Controller button press" };
    }
    function runtimeProgressionRouteForNavigation() { return null; }
    function isControllerButtonInteraction() { return true; }
    function setBeat() { setBeatCalls += 1; }
    ${functionSource("handleXrControllerSelect")}
    controller.addEventListener("select", handleXrControllerSelect);
    controller.dispatchEvent({ type: "select" });
    return {
      boundaryReads,
      setBeatCalls,
      consumed: !xrTextPanelConsumedSelect.has(controller),
    };
  `)(EventDispatcher);

  assert.deepEqual(result, { boundaryReads: 0, setBeatCalls: 0, consumed: true });
});

test("WebXR text-panel Previous and Next actions step variants and consume disabled presses", () => {
  const results = Function("EventDispatcher", `
    function exercise(action, disabled = false) {
      const controller = new EventDispatcher();
      let grabCalls = 0;
      controller.attach = () => { grabCalls += 1; };
      const entry = { controller };
      const xrTextPanelConsumedSelect = new WeakSet();
      const beats = [{ id: "variants" }, { id: "ending" }];
      const activeIndex = 0;
      const spatialTextPanel = {};
      let xrTextPanelGrabEntry = null;
      let stepDirection = null;
      let boundaryReads = 0;
      let setBeatCalls = 0;
      function xrTextPanelHit() { return { action, disabled }; }
      function xrTextPanelScrollStartHit() { return xrTextPanelHit(); }
      function setTextPanelMinimized() {}
      function setXrTextPanelRayState() {}
      function runtimeVariantGroupForBeat() { return { id: "variant-group" }; }
      function stepRuntimeVariantOption(group, direction) { stepDirection = direction; }
      function runtimeInteractionForBoundary() {
        boundaryReads += 1;
        return { effectivePolicy: "Controller button press" };
      }
      function runtimeProgressionRouteForNavigation() { return null; }
      function isControllerButtonInteraction() { return true; }
      function setBeat() { setBeatCalls += 1; }
      let controllerAdvancePending = false;
      ${functionSource("handleXrTextPanelSelectStart")}
      ${functionSource("handleXrControllerSelect")}
      controller.addEventListener("selectstart", () => handleXrTextPanelSelectStart(entry));
      controller.addEventListener("select", handleXrControllerSelect);
      controller.dispatchEvent({ type: "selectstart" });
      const consumedAtStart = xrTextPanelConsumedSelect.has(controller);
      controller.dispatchEvent({ type: "select" });
      return {
        stepDirection,
        boundaryReads,
        setBeatCalls,
        grabCalls,
        consumedAtStart,
        consumedAfterSelect: xrTextPanelConsumedSelect.has(controller),
      };
    }
    return [
      exercise("variant-previous"),
      exercise("variant-next"),
      exercise("variant-next", true),
    ];
  `)(EventDispatcher);

  assert.deepEqual(results, [
    {
      stepDirection: -1,
      boundaryReads: 0,
      setBeatCalls: 0,
      grabCalls: 0,
      consumedAtStart: true,
      consumedAfterSelect: false,
    },
    {
      stepDirection: 1,
      boundaryReads: 0,
      setBeatCalls: 0,
      grabCalls: 0,
      consumedAtStart: true,
      consumedAfterSelect: false,
    },
    {
      stepDirection: null,
      boundaryReads: 0,
      setBeatCalls: 0,
      grabCalls: 0,
      consumedAtStart: true,
      consumedAfterSelect: false,
    },
  ]);
});

test("reader text panel defaults to the left hand and transfers only after Grip release", () => {
  const configure = functionSource("configureXrInteractionControllers");
  const connected = functionSource("handleXrTextPanelControllerConnected");
  const preferred = functionSource("preferredXrTextPanelEntry");
  const triggerStart = functionSource("handleXrTextPanelSelectStart");
  const start = functionSource("handleXrTextPanelSqueezeStart");
  const begin = functionSource("beginXrTextPanelGrab");
  const end = functionSource("handleXrTextPanelSqueezeEnd");
  const release = functionSource("endXrTextPanelGrab");
  const attach = functionSource("attachSpatialTextPanelToEntry");

  assert.match(source, /const XR_TEXT_PANEL_DEFAULT_HAND = "left"/);
  assert.match(configure, /getControllerGrip\(index\)/);
  assert.match(connected, /event\?\.data\?\.handedness/);
  assert.match(connected, /event\?\.data\?\.gripSpace \? entry\.grip : entry\.controller/);
  assert.match(preferred, /xrTextPanelControllersByHand\.get\(xrTextPanelPreferredHand\)/);
  assert.ok(preferred.indexOf('get("left")') < preferred.indexOf('get("right")'));
  assert.doesNotMatch(triggerStart, /beginXrTextPanelGrab/);
  assert.match(start, /beginXrTextPanelGrab\(entry, "squeeze"\)/);
  assert.match(begin, /entry\.controller\.attach\(spatialTextPanel\)/);
  assert.match(end, /endXrTextPanelGrab\(entry\)/);
  assert.match(release, /xrTextPanelPreferredHand = entry\.handedness/);
  assert.match(release, /attachSpatialTextPanelToEntry\(entry\)/);
  assert.match(attach, /entry\.anchor \|\| entry\.grip \|\| entry\.controller/);
  assert.match(attach, /entry\.handedness === "right" \? -1 : 1/);
});

test("compiled reader Grip grabs the panel or a direct-manipulation target", () => {
  const configure = functionSource("configureXrInteractionControllers");
  const activeRoot = functionSource("xrTextPanelActiveHitRoot");
  const squeezeStart = functionSource("handleXrTextPanelSqueezeStart");
  const squeezeEnd = functionSource("handleXrTextPanelSqueezeEnd");
  const begin = functionSource("beginXrTextPanelGrab");
  const end = functionSource("endXrTextPanelGrab");
  const mouse = functionSource("configureReaderPanelMouseDragging");
  const resize = functionSource("resize");

  assert.match(configure, /addEventListener\("squeezestart"/);
  assert.match(configure, /addEventListener\("squeezeend"/);
  assert.match(activeRoot, /textPanelMinimized[\s\S]*minimizedRoot[\s\S]*expandedRoot/);
  assert.match(squeezeStart, /xrTextPanelHit\(entry\)/,
    "grip hit testing uses whichever panel state is currently visible");
  assert.match(squeezeStart, /gamepadInputState\?\.set\?\.\("grip", true\)/,
    "Grip is tracked only by the reserved grab interactor");
  assert.match(squeezeStart, /if \(xrTextPanelHit\(entry\)\) return beginXrTextPanelGrab\(entry, "squeeze"\)/);
  assert.match(squeezeStart, /beginXrDirectManipulation\(entry\)/);
  assert.match(squeezeEnd, /xrDirectManipulationEntryIsActive\(entry\)/);
  assert.match(squeezeEnd, /endXrDirectManipulation\(entry\)/);
  assert.match(squeezeEnd, /xrTextPanelGrabInput !== "squeeze"/);
  assert.match(begin, /entry\.controller\.attach\(spatialTextPanel\)/);
  assert.match(end, /attachSpatialTextPanelToEntry\(entry\)/);

  assert.match(source, /configureReaderPanelMouseDragging\(\)/);
  assert.match(mouse, /readerPanelToggle\?\.contains\?\.\(event\.target\)/);
  assert.match(mouse, /interactive && !toggleTarget/);
  assert.match(mouse, /Math\.hypot\(deltaX, deltaY\) < 4/);
  assert.ok(
    mouse.indexOf("Math.hypot(deltaX, deltaY) < 4") < mouse.indexOf("readerPanel.setPointerCapture?.(event.pointerId)"),
    "ordinary Aa clicks are not retargeted before a drag begins",
  );
  assert.match(mouse, /readerPanel\.style\.left/);
  assert.match(mouse, /readerPanel\.style\.top/);
  assert.match(mouse, /suppressReaderPanelToggleClick = true/,
    "dragging Aa does not also restore the panel");
  assert.match(resize, /clampReaderPanelToViewport\(\)/);
  assert.match(styles, /\.reader-panel\.dragging/);
});

test("reader text panel uses normal scene occlusion without becoming a manipulation collider", () => {
  const create = functionSource("createRuntimeHandTextPanel");
  const control = functionSource("makeRuntimeTextPanelControl");
  const button = functionSource("makeRuntimeTextPanelButton");
  const directRoots = functionSource("activeRuntimeDirectTargetRoots");

  for (const panelPart of [create, control, button]) {
    assert.match(panelPart, /depthTest:\s*true/, "panel surfaces respect the scene depth buffer");
    assert.match(panelPart, /depthWrite:\s*false/, "transparent panel surfaces do not write an opaque depth mask");
    assert.doesNotMatch(panelPart, /renderOrder/, "panel surfaces use normal scene render ordering");
  }
  assert.doesNotMatch(directRoots, /spatialTextPanel|storyvrTextPanel/, "the panel is not a Direct manipulation target");
});

test("reader text panel minimizes to one active restore target and keeps state across beats", () => {
  const create = functionSource("createRuntimeHandTextPanel");
  const activeRoot = functionSource("xrTextPanelActiveHitRoot");
  const hit = functionSource("xrTextPanelHit");
  const minimize = functionSource("setTextPanelMinimized");
  const update = functionSource("updateSpatialTextPanel");
  const render = functionSource("render");

  assert.match(create, /storyvrTextPanelAction = "scroll"/);
  assert.match(create, /makeRuntimeTextPanelControl\("\\u2212", "minimize"/);
  assert.match(create, /makeRuntimeTextPanelControl\("Aa", "restore"/);
  assert.match(create, /makeRuntimeTextPanelButton\("Previous", "variant-previous"\)/);
  assert.match(create, /makeRuntimeTextPanelButton\("Next", "variant-next"\)/);
  assert.match(activeRoot, /textPanelMinimized[\s\S]*minimizedRoot[\s\S]*expandedRoot/);
  assert.match(hit, /const target = xrTextPanelActiveHitRoot\(\)/);
  assert.doesNotMatch(hit, /intersectObject\(spatialTextPanel/);
  assert.match(hit, /entry === xrTextPanelAttachedEntry/);
  assert.match(minimize, /expandedRoot\.visible = !textPanelMinimized/);
  assert.match(minimize, /minimizedRoot\.visible = textPanelMinimized/);
  assert.match(minimize, /aria-expanded/);
  assert.doesNotMatch(update, /clearSpatialTextPanel\(\)/);
  assert.match(update, /setTextPanelMinimized\(textPanelMinimized\)/);
  assert.match(render, /updateXrTextPanelInteractionRays\(\)/);
  assert.doesNotMatch(render, /applySpatialTextCollisionClearance|applySpatialTextOrientation/);
  assert.match(html, /id="reader-panel-toggle"/);
  assert.match(styles, /\.reader-panel\.minimized/);
  assert.match(styles, /> :not\(\.reader-panel-toggle\)/);
});

test("locomotion UI and movement are selected per active boundary", () => {
  const controls = functionSource("configureTraversalControls");
  const apply = functionSource("applySpatialTraversalForBeat");
  const physical = functionSource("updatePhysicalTraversal");

  assert.match(controls, /runtimeInteractionForBoundary\(activeIndex - 1, activeIndex\)/);
  assert.match(controls, /runtimeInteractionForBoundary\(activeIndex, activeIndex \+ 1\)/);
  assert.doesNotMatch(controls, /runtimeSpatialTraversal\.requiresLocomotion/);
  assert.match(apply, /isReaderLocomotionInteraction\(crossedBoundary\)/);
  assert.match(apply, /isPhysicalLocomotionBoundary\(outgoingBoundary\)/);
  assert.match(physical, /isPhysicalLocomotionBoundary\(outgoingBoundary\)/);
});

test("reader normalizes generic within-beat variants without treating them as successor branches", () => {
  const normalize = evaluateFunctions(["normalizeRuntimeVariantGroups", "uniqueStrings"], "normalizeRuntimeVariantGroups");
  const groups = normalize([{
    id: "material-selector",
    title: "Choose material",
    beatId: "materials",
    defaultOptionId: "wood",
    control: { kind: "previous-next", wrap: true },
    options: [
      { id: "metal", label: "Metal", sourceOrder: 0, asset_ids: ["metal.glb"] },
      { id: "wood", label: "Wood", text: "Warm wood", sourceOrder: 1, assetIds: ["wood.glb"] },
    ],
  }]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].beatId, "materials");
  assert.equal(groups[0].defaultOptionId, "wood");
  assert.deepEqual(groups[0].options.map((option) => option.id), ["wood", "metal"],
    "the reader follows the same default-first adjacency shown in Source Graph and Transition");
  assert.deepEqual(groups[0].options[1].assetIds, ["metal.glb"]);
  assert.equal("branches" in groups[0], false);
});

test("reader canonicalizes legacy and new variant records to UI button press on the text panel", () => {
  const normalize = evaluateFunctions(["normalizeRuntimeVariantInteractionControl"], "normalizeRuntimeVariantInteractionControl");
  const groups = [{
    id: "material-selector",
    beatId: "materials",
    control: { kind: "single-select" },
    options: [{ id: "wood" }, { id: "metal" }],
  }];
  for (const policy of [null, "Text panel selection", "UI button press"]) {
    const declared = policy ? [{
      beatId: "materials",
      variantGroupId: "material-selector",
      inferredPolicy: policy,
      effectivePolicy: policy,
      surface: "text-panel",
    }] : [];
    const [record] = normalize(declared, groups);
    assert.equal(record.beatId, "materials");
    assert.equal(record.variantGroupId, "material-selector");
    assert.equal(record.inferredPolicy, "UI button press");
    assert.equal(record.effectivePolicy, "UI button press");
    assert.equal(record.surface, "text-panel");
    assert.deepEqual(record.optionIds, ["wood", "metal"]);
  }
});

test("reader preserves separate directed-edge variant policies and defaults missing records to UI button press", () => {
  const normalize = evaluateFunctions([
    "finiteInteractionArray",
    "finiteInteractionNumber",
    "normalizeRuntimeControllerControl",
    "normalizeRuntimeControllerAction",
    "normalizeRuntimeTransform",
    "normalizeRuntimeInteractionConfiguration",
    "runtimeInteractionPolicyValue",
    "normalizeRuntimeLocomotionMode",
    "normalizeRuntimeVariantInteractionPolicy",
    "runtimeVariantInteractionSurface",
    "normalizeRuntimeVariantInteractionControlByEdge",
  ], "normalizeRuntimeVariantInteractionControlByEdge");
  const groups = [{
    id: "sharks",
    beatId: "shark-cards",
    control: { kind: "previous-next" },
    options: [{ id: "white" }, { id: "tiger" }, { id: "nurse" }],
  }];
  const edges = [
    {
      id: "white-to-tiger",
      from: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "white" },
      to: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "tiger" },
    },
    {
      id: "tiger-to-white",
      from: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "tiger" },
      to: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "white" },
    },
    {
      id: "tiger-to-nurse",
      from: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "tiger" },
      to: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "nurse" },
    },
  ];
  const records = normalize([
    { edgeId: "white-to-tiger", effectivePolicy: "Direct manipulation" },
    { edgeId: "tiger-to-white", effectivePolicy: "Reader locomotion", locomotionMode: "virtual-teleport" },
  ], edges, groups, []);

  assert.deepEqual(records.map((record) => [record.edgeId, record.effectivePolicy, record.surface]), [
    ["white-to-tiger", "Direct manipulation", "scene-object"],
    ["tiger-to-white", "Reader locomotion", "reader-route"],
    ["tiger-to-nurse", "UI button press", "text-panel"],
  ]);
  assert.equal(records[1].locomotionMode, "virtual-teleport");
  assert.ok(records.every((record) => record.selectionMode === "directed-edge"));
  assert.ok(records.every((record) => record.fromVariantOptionId && record.toVariantOptionId));

  const objectMapRecords = normalize({
    "white-to-tiger": "Direct manipulation",
  }, edges, groups, []);
  assert.equal(objectMapRecords[0].effectivePolicy, "Direct manipulation");
  assert.equal(objectMapRecords[0].surface, "scene-object");
});

test("reader never treats Direct manipulation or Reader locomotion edges as UI-button fallbacks", () => {
  const result = Function(`
    const runtimeVariantInteractionControlByEdge = [
      { edgeId: "a-to-b", variantGroupId: "group", fromVariantOptionId: "a", toVariantOptionId: "b", effectivePolicy: "Direct manipulation" },
      { edgeId: "a-to-c", variantGroupId: "group", fromVariantOptionId: "a", toVariantOptionId: "c", effectivePolicy: "UI button press" },
      { edgeId: "b-to-a", variantGroupId: "group", fromVariantOptionId: "b", toVariantOptionId: "a", effectivePolicy: "Reader locomotion" },
    ];
    ${functionSource("runtimeVariantInteractionForEdge")}
    ${functionSource("runtimeVariantHasEdgeContract")}
    ${functionSource("runtimeVariantUiButtonAllowed")}
    const group = { id: "group" };
    return {
      direct: runtimeVariantUiButtonAllowed(group, "a", "b"),
      ui: runtimeVariantUiButtonAllowed(group, "a", "c"),
      locomotion: runtimeVariantUiButtonAllowed(group, "b", "a"),
      legacy: runtimeVariantUiButtonAllowed({ id: "legacy-group" }, "a", "b"),
    };
  `)();

  assert.deepEqual(result, { direct: false, ui: true, locomotion: false, legacy: true });
});

test("WebXR variant buttons mirror visible, wrapping, and endpoint-disabled state", () => {
  const result = Function("THREE", `
    const makeButton = () => ({
      visible: true,
      userData: {},
      material: {
        color: { value: null, setHex(value) { this.value = value; } },
        opacity: 1,
      },
    });
    const root = { visible: false };
    const previousButton = makeButton();
    const nextButton = makeButton();
    const spatialTextPanel = { userData: {
      variantControlRoot: root,
      variantPreviousButton: previousButton,
      variantNextButton: nextButton,
    } };
    let group = {
      id: "materials",
      control: { wrap: false },
      options: [{ id: "wood" }, { id: "metal" }, { id: "glass" }],
    };
    let selectedOption = group.options[0];
    let interactionControl = { effectivePolicy: "UI button press", surface: "text-panel" };
    const runtimeVariantInteractionControlByEdge = [];
    function runtimeVariantGroupForBeat() { return group; }
    function runtimeVariantInteractionForBeat() { return interactionControl; }
    function runtimeVariantOptionForGroup() { return selectedOption; }
    function applyRuntimeTextPanelButtonPresentation() {}
    ${functionSource("runtimeInteractionConfiguration")}
    ${functionSource("finiteInteractionArray")}
    ${functionSource("runtimeVariantInteractionForEdge")}
    ${functionSource("runtimeVariantHasEdgeContract")}
    ${functionSource("runtimeVariantUiButtonAllowed")}
    ${functionSource("runtimeVariantSteppedOption")}
    ${functionSource("runtimeTextPanelVariantState")}
    ${functionSource("runtimeTextPanelButtonPresentation")}
    ${functionSource("syncRuntimeTextPanelVariantControls")}
    ${functionSource("setRuntimeTextPanelControlDisabled")}
    const capture = () => ({
      visible: root.visible,
      previousVisible: previousButton.visible,
      nextVisible: nextButton.visible,
      previousDisabled: previousButton.userData.storyvrTextPanelDisabled,
      nextDisabled: nextButton.userData.storyvrTextPanelDisabled,
      previousGroup: previousButton.userData.storyvrVariantGroupId,
      nextGroup: nextButton.userData.storyvrVariantGroupId,
    });
    const first = runtimeTextPanelVariantState({ id: "materials" });
    syncRuntimeTextPanelVariantControls(first);
    const atStart = capture();
    selectedOption = group.options[1];
    const middle = runtimeTextPanelVariantState({ id: "materials" });
    syncRuntimeTextPanelVariantControls(middle);
    const inMiddle = capture();
    selectedOption = group.options[2];
    const last = runtimeTextPanelVariantState({ id: "materials" });
    syncRuntimeTextPanelVariantControls(last);
    const atEnd = capture();
    group.control.wrap = true;
    const wrapped = runtimeTextPanelVariantState({ id: "materials" });
    syncRuntimeTextPanelVariantControls(wrapped);
    const wrapping = capture();
    interactionControl = null;
    syncRuntimeTextPanelVariantControls(runtimeTextPanelVariantState({ id: "plain" }));
    const hidden = capture();
    return { atStart, inMiddle, atEnd, wrapping, hidden };
  `)(THREE);

  assert.deepEqual(result.atStart, {
    visible: true,
    previousVisible: false,
    nextVisible: true,
    previousDisabled: true,
    nextDisabled: false,
    previousGroup: "materials",
    nextGroup: "materials",
  });
  assert.deepEqual(result.inMiddle, {
    visible: true,
    previousVisible: true,
    nextVisible: true,
    previousDisabled: false,
    nextDisabled: false,
    previousGroup: "materials",
    nextGroup: "materials",
  });
  assert.deepEqual(result.atEnd, {
    visible: true,
    previousVisible: true,
    nextVisible: false,
    previousDisabled: false,
    nextDisabled: true,
    previousGroup: "materials",
    nextGroup: "materials",
  });
  assert.deepEqual(result.wrapping, {
    visible: true,
    previousVisible: true,
    nextVisible: true,
    previousDisabled: false,
    nextDisabled: false,
    previousGroup: "materials",
    nextGroup: "materials",
  });
  assert.deepEqual(result.hidden, {
    visible: false,
    previousVisible: false,
    nextVisible: false,
    previousDisabled: true,
    nextDisabled: true,
    previousGroup: null,
    nextGroup: null,
  });
});

test("reader applies authored UI button labels and normalized panel placement", () => {
  const presentation = evaluateFunctionsWithThree([
    "runtimeInteractionConfiguration",
    "finiteInteractionArray",
    "normalizeRuntimeControllerAction",
    "runtimeTextPanelButtonPresentation",
  ], "runtimeTextPanelButtonPresentation");
  const result = presentation({
    authored: true,
    configuration: {
      type: "ui-button-press",
      buttons: [{
        id: "next-shark",
        label: "Follow this shark",
        action: "select-variant",
        position: [0.72, 0.78],
        size: [0.3, 0.16],
      }],
    },
  }, "Next", [0.8, 0.86]);
  assert.deepEqual(result, {
    id: "next-shark",
    label: "Follow this shark",
    action: "select-variant",
    position: [0.72, 0.78],
    size: [0.3, 0.16],
  });
  const generated = presentation({
    authored: false,
    overridden: false,
    configuration: {
      type: "ui-button-press",
      buttons: [{
        id: "legacy-generated-next",
        label: "Next generated option",
        action: "select-variant",
        position: [0.5, 0.86],
        size: [0.32, 0.12],
      }],
    },
  }, "Next", [0.8, 0.86]);
  assert.deepEqual(generated, {
    id: "legacy-generated-next",
    label: "Next generated option",
    action: "select-variant",
    position: [0.8, 0.86],
    size: [0.32, 0.12],
  });
  assert.match(functionSource("applyRuntimeTextPanelButtonPresentation"), /XR_TEXT_PANEL_WIDTH \* widthRatio/);
  assert.match(functionSource("applyRuntimeTextPanelButtonPresentation"), /\(0\.5 - y\) \* XR_TEXT_PANEL_HEIGHT/);
  assert.match(functionSource("renderRuntimeVariantControls"), /previousPresentation\.label/);
  assert.match(functionSource("renderRuntimeVariantControls"), /nextPresentation\.label/);
});

test("reader reserves a footer row above the default XR variant control band", () => {
  const layout = evaluateFunctions(["runtimeTextPanelVariantLayout"], "runtimeTextPanelVariantLayout");
  const result = layout(560);
  const defaultButtonTop = (0.86 - (0.12 / 2)) * 560;
  const texture = functionSource("makeRuntimeTextPanelTexture");

  assert.deepEqual(result, {
    bodyMaxLines: 5,
    statusBaseline: 414,
    controlBandTop: 437,
  });
  assert.ok(result.statusBaseline < result.controlBandTop,
    "the variant status stays above the dedicated control band");
  assert.ok(result.controlBandTop < defaultButtonTop,
    "the control band includes padding before the default button geometry begins");
  assert.ok(defaultButtonTop - result.statusBaseline > 30,
    "the status baseline clears the default button by more than its font height");
  assert.match(texture, /runtimeTextPanelVariantLayout\(canvas\.height\)/);
  assert.match(texture, /variantLayout\.statusBaseline/);
  assert.match(texture, /variantLayout\.controlBandTop/);
  assert.match(texture, /variantLayout\?\.bodyMaxLines \|\| 8/);
  assert.doesNotMatch(texture, /\b444\b/);
});

test("Trigger drag scrolls overflow text from either the attached hand or a controller ray", () => {
  const draw = evaluateFunctions([
    "runtimeWrappedTextLines",
    "drawRuntimeWrappedText",
  ], "drawRuntimeWrappedText");
  const rendered = [];
  const context = {
    measureText(value) { return { width: String(value).length }; },
    fillText(value) { rendered.push(value); },
  };
  const pagination = draw(
    context,
    "one two three four five",
    0,
    0,
    7,
    1,
    2,
    1,
  );

  assert.deepEqual(rendered, ["three", "four"]);
  assert.deepEqual(pagination, {
    lineCount: 4,
    maxLines: 2,
    maxScrollLine: 2,
    scrollLine: 1,
  });
  assert.match(functionSource("xrTextPanelHit"), /uv: hit\.uv\?\.clone/);
  assert.match(functionSource("xrTextPanelScrollStartHit"), /entry === xrTextPanelAttachedEntry/,
    "the controller carrying the panel can initiate scrolling directly");
  assert.match(functionSource("xrTextPanelScrollStartHit"), /textPagination\?\.maxScrollLine/);
  assert.match(functionSource("handleXrTextPanelSelectStart"), /xrTextPanelScrollStartHit\(entry\)/);
  assert.match(functionSource("handleXrTextPanelSelectStart"), /beginXrTextPanelScroll\(entry, hit\)/);
  assert.match(functionSource("beginXrTextPanelScroll"), /startControllerY/);
  assert.match(functionSource("updateXrTextPanelScroll"), /runtimeTextPanelScrollLineFromVerticalDrag/);
  assert.doesNotMatch(functionSource("updateXrTextPanelScroll"), /xrTextPanelHit/,
    "scrolling continues even if the pointer ray leaves the panel bounds");
  assert.match(functionSource("makeRuntimeTextPanelTexture"), /Hold Trigger and move vertically to scroll/);
  assert.match(functionSource("renderRuntimeTextPanelContent"), /storyvrTextPanelPagination/);

  const calculateLine = evaluateFunctionsWithThree(
    ["runtimeTextPanelScrollLineFromVerticalDrag"],
    "runtimeTextPanelScrollLineFromVerticalDrag",
  );
  assert.equal(calculateLine(0, 1.5, 1.39, 12, 0.22), 6);
  assert.equal(calculateLine(6, 1.5, 1.28, 12, 0.22), 12);
  assert.equal(calculateLine(6, 1.5, 1.72, 12, 0.22), 0);
});

test("reader resolves a stable glTF node index before path fallback and wraps safe animated parts", () => {
  const resolve = evaluateFunctionsWithThree([
    "uniqueStrings",
    "sourcePartSelectorRegex",
    "sourcePartNodePath",
    "sourcePartSelectorMatchesNode",
    "runtimeInteractionTargetsMatch",
    "activeRuntimeDirectTargetRoots",
    "runtimeDirectRootForTarget",
  ], "runtimeDirectRootForTarget", `
    let activeModel = null;
    let activeModelAsset = null;
    let activeModelSpatialEntity = null;
    const modelAuthorTransformRoot = new THREE.Group();
    const activeSupplementalModelEntries = [];
  `);
  const sceneRoot = new THREE.Group();
  const indexed = new THREE.Group();
  indexed.name = "IndexedHandle";
  indexed.userData.storyvrGltfNodeIndex = 7;
  const pathFallback = new THREE.Group();
  pathFallback.name = "FallbackHandle";
  sceneRoot.add(indexed, pathFallback);
  const candidate = { entityId: "glb:model", assetId: "model.glb", root: sceneRoot, sceneRoot };

  assert.equal(resolve({
    entityId: "glb:model",
    assetId: "model.glb",
    nodeIndex: 7,
    nodePath: "FallbackHandle",
  }, [candidate]).root, indexed, "the stable glTF index wins when both selectors are present");

  const unsafe = new THREE.Bone();
  unsafe.name = "UnsafeBone";
  unsafe.userData.storyvrGltfNodeIndex = 8;
  sceneRoot.add(unsafe);
  assert.equal(resolve({
    entityId: "glb:model",
    assetId: "model.glb",
    nodeIndex: 8,
    nodePath: "FallbackHandle",
  }, [candidate]).root, pathFallback, "Bone indices are rejected before the safe path fallback");

  const wrap = evaluateFunctionsWithThree([
    "runtimeInteractionPivotForCandidate",
  ], "runtimeInteractionPivotForCandidate");
  indexed.position.set(1, 2, 3);
  const wrapped = wrap({ ...candidate, root: indexed }, { targetKind: "node", nodeIndex: 7 });
  assert.equal(wrapped.usesInteractionPivot, true);
  assert.equal(wrapped.root.parent, sceneRoot);
  assert.equal(indexed.parent, wrapped.root);
  assert.deepEqual(wrapped.root.position.toArray(), [0, 0, 0]);
  assert.deepEqual(indexed.position.toArray(), [1, 2, 3], "animation-owned node transforms remain inside the pivot");
  assert.match(functionSource("loadModel"), /gltf\.parser\?\.associations/);
  assert.match(functionSource("loadModel"), /storyvrGltfNodeIndex/);
});

test("reader clamps local position, XYZ rotation, and scale without disturbing an animated child", () => {
  const helpers = evaluateFunctionsWithThree([
    "finiteInteractionArray",
    "normalizeRuntimeTransform",
    "runtimeInteractionEntryFor",
    "runtimeInteractionInitialMatrix",
    "runtimeInteractionRootMatrixRelativeTo",
    "runtimeInteractionLogicalTransform",
    "applyRuntimeInteractionLogicalTransform",
    "runtimeInteractionEulerDegreesNearRange",
    "clampRuntimeInteractionLogicalTransform",
    "clampRuntimeInteractionTarget",
  ], "({ runtimeInteractionLogicalTransform, clampRuntimeInteractionTarget })");
  const parent = new THREE.Group();
  const pivot = new THREE.Group();
  const animatedChild = new THREE.Group();
  animatedChild.position.set(4, 5, 6);
  parent.add(pivot);
  pivot.add(animatedChild);
  const entry = {
    root: pivot,
    originalParent: parent,
    usesInteractionPivot: true,
    target: {
      initialTransform: {
        position: [3, 0, 0],
        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(80), 0)).toArray(),
        scale: [3, 3, 3],
      },
      constraints: {
        position: { enabled: true, min: [-1, -1, -1], max: [1, 1, 1] },
        rotation: { enabled: true, min: [-30, -30, -30], max: [30, 30, 30] },
        scale: { enabled: true, min: [0.5, 0.5, 0.5], max: [2, 2, 2] },
      },
    },
  };
  assert.equal(helpers.clampRuntimeInteractionTarget(entry), true);
  const logical = helpers.runtimeInteractionLogicalTransform(pivot, entry);
  assert.deepEqual(logical.position.toArray().map((value) => Number(value.toFixed(6))), [1, 0, 0]);
  assert.deepEqual(logical.scale.toArray().map((value) => Number(value.toFixed(6))), [2, 2, 2]);
  const eulerDegrees = new THREE.Euler().setFromQuaternion(logical.quaternion, "XYZ").toArray().slice(0, 3)
    .map((value) => Math.abs(Math.round(THREE.MathUtils.radToDeg(value))));
  assert.deepEqual(eulerDegrees, [0, 30, 0]);
  assert.deepEqual(animatedChild.position.toArray(), [4, 5, 6]);
});

test("reader uses only capability-reachable channels for Direct completion", () => {
  const targetMatches = evaluateFunctionsWithThree([
    "runtimeInteractionReachableChannels",
    "runtimeDirectTransformError",
    "runtimeDirectTargetMatches",
  ], "runtimeDirectTargetMatches", interactionDefaultsPrelude);
  const root = new THREE.Group();
  root.position.set(8, 0, 0);
  root.scale.set(2, 2, 2);
  const destination = {
    coordinateSpace: "scene",
    destinationTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] },
    tolerance: { positionMeters: 0.01, rotationDegrees: 1, scaleRatio: 0.01 },
  };
  assert.equal(targetMatches(root, destination, {
    target: { oneHandGrabbable: false, twoHandScalable: true },
  }), true, "a scalable-only target ignores unreachable translation");
  root.scale.setScalar(1);
  assert.equal(targetMatches(root, destination, {
    target: { oneHandGrabbable: false, twoHandScalable: true },
  }), false);
  assert.equal(targetMatches(root, {
    ...destination,
    destinationTransform: { ...destination.destinationTransform, position: [8, 0, 0], scale: [4, 4, 4] },
  }, {
    target: { oneHandGrabbable: true, twoHandScalable: false },
  }), true, "a grabbable-only target ignores unreachable scale");
});

test("reader keeps beat manipulation independent of transition policy and updates two-hand scale every frame", () => {
  const configure = functionSource("configureRuntimeDirectManipulation");
  const hit = functionSource("xrDirectManipulationHit");
  const begin = functionSource("beginXrDirectManipulation");
  const beginScale = functionSource("beginXrDirectManipulationScale");
  const disconnect = functionSource("handleXrTextPanelControllerDisconnected");
  const render = functionSource("render");
  assert.match(configure, /configureRuntimeInBeatInteractionTargets\(\)/);
  assert.match(configure, /isDirectManipulationInteraction\(outgoingBoundary\)/);
  assert.match(configure, /runtimeDirectRootForTarget\(target, activeRuntimeInBeatTargets\)/,
    "transition destinations are intersected with current beat interactables");
  assert.match(hit, /activeRuntimeInBeatTargets\.map/);
  assert.doesNotMatch(hit, /activeRuntimeDirectInteractions/,
    "beat targets remain usable under button-controlled transitions");
  assert.match(begin, /target\.oneHandGrabbable \? "grab" : "armed-scale"/);
  assert.match(begin, /if \(target\.oneHandGrabbable\) \{[\s\S]*entry\.controller\.attach\(hit\.root\)/,
    "a scalable-only first grip arms without moving the object");
  assert.match(beginScale, /hit\?\.root !== grab\.root/);
  assert.match(beginScale, /twoHandScalable !== true/);
  assert.match(disconnect, /endXrDirectManipulation\(entry, \{ evaluate: false \}\)/);
  assert.ok(render.indexOf("updateSourceAnimation(delta, frameTime)") < render.indexOf("updateRuntimeDirectManipulation()"),
    "interaction pivots are applied after animation updates");

  const updateScale = new Function("THREE", `
    let applied = null;
    const primary = { position: new THREE.Vector3(0, 0, 0) };
    const secondary = { position: new THREE.Vector3(2, 0, 0) };
    const targetEntry = { target: { constraints: {
      scale: { enabled: true, min: [0.5, 0.5, 0.5], max: [3, 3, 3] },
    } } };
    let xrDirectManipulationGrab = { mode: "scale" };
    let xrDirectManipulationScale = {
      primaryEntry: primary,
      secondaryEntry: secondary,
      targetEntry,
      startDistance: 1,
      startLogical: {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 2, 1),
      },
    };
    function runtimeControllerWorldPosition(entry) { return entry.position.clone(); }
    ${functionSource("runtimeBimanualScaleRatio")}
    ${functionSource("clampRuntimeInteractionLogicalTransform")}
    function applyRuntimeInteractionLogicalTransform(entry, transform) { applied = transform; return true; }
    ${functionSource("updateRuntimeDirectManipulation")}
    updateRuntimeDirectManipulation();
    return applied.scale.toArray();
  `)(THREE);
  assert.deepEqual(updateScale, [2, 3, 2], "controller distance scales uniformly before authored range clamping");
});

test("reader accepts configured locomotion tolerances and whole-GLB or safe named-node completion targets", () => {
  const tolerance = evaluateFunctionsWithThree([
    "runtimeInteractionConfiguration",
    "runtimeLocomotionTolerance",
  ], "runtimeLocomotionTolerance", interactionDefaultsPrelude);
  assert.deepEqual(tolerance({ configuration: { tolerance: { distanceMeters: 0.42, dwellSeconds: 0.6 } } }), {
    distanceMeters: 0.42,
    dwellSeconds: 0.6,
  });

  const targetMatches = evaluateFunctionsWithThree([
    "runtimeInteractionReachableChannels",
    "runtimeDirectTransformError",
    "runtimeDirectTargetMatches",
  ], "runtimeDirectTargetMatches", interactionDefaultsPrelude);
  const root = new THREE.Object3D();
  root.position.set(1.05, 0, 0);
  root.scale.setScalar(1.05);
  assert.equal(targetMatches(root, {
    destinationTransform: { position: [1, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    tolerance: { positionMeters: 0.1, rotationDegrees: 5, scaleRatio: 0.1 },
  }), true);
  root.position.x = 1.2;
  assert.equal(targetMatches(root, {
    destinationTransform: { position: [1, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    tolerance: { positionMeters: 0.1, rotationDegrees: 5, scaleRatio: 0.1 },
  }), false);

  assert.match(functionSource("runtimeDirectRootForTarget"), /sourcePartNodePath/);
  assert.match(functionSource("runtimeDirectRootForTarget"), /sourcePartSelectorMatchesNode/);
  assert.match(functionSource("runtimeDirectRootForTarget"), /object\.isBone \|\| object\.isSkinnedMesh/);
  assert.match(functionSource("xrDirectManipulationHit"), /while \(root && !targetRoots\.has\(root\)\) root = root\.parent/);
  assert.match(functionSource("runtimeDirectInteractionComplete"), /targetEntries\.length !== interaction\.targetCount/);
  assert.match(functionSource("beginXrDirectManipulation"), /entry\.controller\.attach\(hit\.root\)/);
  assert.match(functionSource("endXrDirectManipulation"), /grab\.originalParent\.attach\(grab\.root\)/);
});

test("reader demonstrates Direct manipulation destinations with replaying ghost GLB cues", () => {
  assert.match(source, /clone as cloneSkinnedObject/);
  assert.match(source, /const DIRECT_GHOST_VELOCITY_METERS_PER_SECOND = 0\.75/);
  assert.match(source, /const DIRECT_GHOST_DESTINATION_HOLD_SECONDS = 3/);
  assert.match(source, /const DIRECT_GHOST_INACTIVITY_REPLAY_SECONDS = 5/);

  const travelSeconds = evaluateFunctionsWithThree([
    "runtimeDirectGhostTravelSeconds",
  ], "runtimeDirectGhostTravelSeconds", `
    const DIRECT_GHOST_VELOCITY_METERS_PER_SECOND = 0.75;
    const DIRECT_GHOST_MIN_TRAVEL_SECONDS = 0.75;
    const DIRECT_GHOST_MAX_TRAVEL_SECONDS = 4.5;
  `);
  assert.equal(travelSeconds(1.5), 2);
  assert.equal(travelSeconds(0), 0.75);
  assert.equal(travelSeconds(30), 4.5);

  const destinationWorldTransform = evaluateFunctionsWithThree([
    "finiteInteractionArray",
    "normalizeRuntimeTransform",
    "runtimeInteractionEntryFor",
    "runtimeInteractionInitialMatrix",
    "runtimeInteractionRootMatrixRelativeTo",
    "runtimeInteractionLogicalTransform",
    "runtimeInteractionReachableChannels",
    "runtimeObjectWorldTransform",
    "runtimeDirectDestinationWorldTransform",
  ], "runtimeDirectDestinationWorldTransform");
  const parent = new THREE.Group();
  parent.position.set(4, 0, 0);
  const root = new THREE.Group();
  parent.add(root);
  const destinationTransform = {
    position: [2, 0, -1],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  };
  assert.deepEqual(
    destinationWorldTransform(root, { coordinateSpace: "local", destinationTransform }).position.toArray(),
    [6, 0, -1],
  );
  assert.deepEqual(
    destinationWorldTransform(root, { coordinateSpace: "scene", destinationTransform }).position.toArray(),
    [2, 0, -1],
  );

  const createGhostMaterial = evaluateFunctionsWithThree([
    "createRuntimeDirectGhostMaterial",
  ], "createRuntimeDirectGhostMaterial", "const DIRECT_GHOST_OPACITY = 0.32;");
  const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0x2266aa, opacity: 0.8 });
  const ghostMaterial = createGhostMaterial(sourceMaterial);
  assert.notEqual(ghostMaterial, sourceMaterial);
  assert.equal(sourceMaterial.transparent, false, "the actual GLB material remains unchanged");
  assert.equal(ghostMaterial.transparent, true);
  assert.equal(ghostMaterial.depthWrite, false);
  assert.equal(ghostMaterial.blending, THREE.AdditiveBlending);
  assert.equal(Number(ghostMaterial.opacity.toFixed(3)), 0.256);
  ghostMaterial.dispose();
  sourceMaterial.dispose();

  const cueLifecycle = new Function("THREE", `
    const DIRECT_GHOST_DESTINATION_HOLD_SECONDS = 3;
    const DIRECT_GHOST_INACTIVITY_REPLAY_SECONDS = 5;
    const activeRuntimeDirectCues = [];
    let xrDirectManipulationGrab = null;
    let elapsedSeconds = 0;
    function startRuntimeDirectManipulationCue(cue, startedAt) {
      cue.replays = (cue.replays || 0) + 1;
      cue.phase = "travel";
      cue.phaseStartedAt = startedAt;
      cue.ghost.visible = true;
      return true;
    }
    ${functionSource("applyRuntimeDirectGhostTransform")}
    ${functionSource("suspendRuntimeDirectManipulationCue")}
    ${functionSource("updateRuntimeDirectManipulationCues")}
    const cue = {
      root: new THREE.Group(),
      ghost: new THREE.Group(),
      phase: "travel",
      phaseStartedAt: 0,
      lastReaderInteractionAt: 0,
      travelSeconds: 2,
      start: {
        position: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
      },
      destination: {
        position: new THREE.Vector3(2, 0, 0),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
      },
    };
    activeRuntimeDirectCues.push(cue);
    return { cue, suspendRuntimeDirectManipulationCue, updateRuntimeDirectManipulationCues };
  `)(THREE);
  cueLifecycle.updateRuntimeDirectManipulationCues(1);
  assert.equal(Number(cueLifecycle.cue.ghost.position.x.toFixed(3)), 1);
  cueLifecycle.updateRuntimeDirectManipulationCues(2);
  assert.equal(cueLifecycle.cue.phase, "hold");
  cueLifecycle.updateRuntimeDirectManipulationCues(4.99);
  assert.equal(cueLifecycle.cue.ghost.visible, true, "the destination ghost stays for the full three seconds");
  cueLifecycle.updateRuntimeDirectManipulationCues(5);
  assert.equal(cueLifecycle.cue.phase, "idle");
  assert.equal(cueLifecycle.cue.ghost.visible, false);
  cueLifecycle.updateRuntimeDirectManipulationCues(9.99);
  assert.equal(cueLifecycle.cue.replays, undefined);
  cueLifecycle.updateRuntimeDirectManipulationCues(10);
  assert.equal(cueLifecycle.cue.replays, 1, "the cue replays after five inactive seconds");
  cueLifecycle.suspendRuntimeDirectManipulationCue(cueLifecycle.cue, 10.5);
  cueLifecycle.updateRuntimeDirectManipulationCues(15.49);
  assert.equal(cueLifecycle.cue.replays, 1, "reader activity postpones the next replay");
  cueLifecycle.updateRuntimeDirectManipulationCues(15.5);
  assert.equal(cueLifecycle.cue.replays, 2);

  assert.match(functionSource("configureRuntimeDirectManipulation"), /createRuntimeDirectManipulationCue/);
  assert.match(functionSource("beginXrDirectManipulation"), /markRuntimeDirectManipulationActivity\(hit\.root\)/);
  assert.match(functionSource("endXrDirectManipulation"), /markRuntimeDirectManipulationActivity\(grab\.root\)/);
  assert.match(functionSource("clearRuntimeDirectManipulation"), /disposeRuntimeDirectManipulationCue/);
  assert.match(functionSource("render"), /updateRuntimeDirectManipulationCues\(\)/);
});

test("reader switches variant text and assets within the active beat", () => {
  const setBeat = functionSource("setBeat");
  const controls = functionSource("renderRuntimeVariantControls");
  const select = functionSource("selectRuntimeVariantOption");
  const step = functionSource("stepRuntimeVariantOption");

  assert.match(setBeat, /runtimeVariantGroupForBeat\(beat\)/);
  assert.match(setBeat, /runtimeVariantInteractionForBeat\(beat, variantGroup\)/);
  assert.match(setBeat, /runtimeVariantAssetForOption\(variantOption\)/);
  assert.match(setBeat, /variantOption\?\.text/);
  assert.match(controls, /data-variant-option/);
  assert.match(controls, /data-variant-direction/);
  assert.match(controls, /previousDisabled \? "" : `<button type="button" data-variant-direction="-1"/);
  assert.match(controls, /nextDisabled \? "" : `<button type="button" data-variant-direction="1"/);
  assert.match(controls, /ui-button-press/);
  assert.match(controls, /UI button press/);
  assert.match(controls, /interactionControl\?\.surface !== "text-panel"/);
  assert.match(select, /setBeat\(activeIndex\)/);
  assert.match(select, /runtimeVariantUiButtonAllowed/);
  assert.match(step, /runtimeVariantSteppedOption/);
  assert.match(styles, /\.variant-direction-controls\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /button\[data-variant-direction="-1"\]\s*\{[^}]*grid-column:\s*1/s);
  assert.match(styles, /button\[data-variant-direction="1"\]\s*\{[^}]*grid-column:\s*2/s);
  assert.doesNotMatch(`${setBeat}\n${controls}\n${select}\n${step}`, /activeIndex\s*[+\-]=/);
});
