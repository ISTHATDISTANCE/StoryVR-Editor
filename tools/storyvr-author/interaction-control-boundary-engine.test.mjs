import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateComponentProposals,
  inferInteractionControlByBoundary,
  inferVariantInteractionControlByBeat,
  inferVariantInteractionControlByEdge,
  sanitizeInBeatInteractions,
  sanitizeInteractionControlConfiguration,
} from "./engine.mjs";

const MODEL = { id: "model-a", type: "model", path: "models/a.glb" };
const engineSource = await readFile(new URL("./engine.mjs", import.meta.url), "utf8");

function engineFunctionSource(name) {
  const plain = engineSource.indexOf(`function ${name}(`);
  const asyncStart = engineSource.indexOf(`async function ${name}(`);
  const start = plain === -1 ? asyncStart : asyncStart === -1 ? plain : Math.min(plain, asyncStart);
  assert.notEqual(start, -1, `${name} exists`);
  const nextPlain = engineSource.indexOf("\nfunction ", start + 1);
  const nextAsync = engineSource.indexOf("\nasync function ", start + 1);
  const nextExport = engineSource.indexOf("\nexport function ", start + 1);
  const nextAsyncExport = engineSource.indexOf("\nexport async function ", start + 1);
  const candidates = [nextPlain, nextAsync, nextExport, nextAsyncExport].filter((value) => value !== -1);
  return engineSource.slice(start, candidates.length ? Math.min(...candidates) : engineSource.length);
}

function fixture(beats, extraGraph = {}, assets = [MODEL]) {
  return {
    graph: {
      beats,
      ...extraGraph,
    },
    runtime: {
      assets,
      contentUnits: beats.map((beat, index) => ({ ...beat, index })),
    },
  };
}

test("text-only boundaries use controller button press by default", () => {
  const { graph, runtime } = fixture([
    { id: "beat-1", text: "First", isTextOnly: true, linkedAssets: [] },
    { id: "beat-2", text: "Second", isTextOnly: true, linkedAssets: [] },
  ]);
  const [boundary] = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });
  assert.equal(boundary.boundaryId, "source-transition-beat-beat-1-to-beat-beat-2");
  assert.equal(boundary.edgeId, boundary.boundaryId);
  assert.equal(boundary.routeId, boundary.boundaryId);
  assert.deepEqual(boundary.fromContext, {
    beatId: "beat-1",
    variantGroupId: null,
    variantOptionId: null,
  });
  assert.deepEqual(boundary.toContext, {
    beatId: "beat-2",
    variantGroupId: null,
    variantOptionId: null,
  });
  assert.equal(boundary.mappedTransition, false);
  assert.equal(boundary.assignmentRequired, false);
  assert.equal(boundary.defaultPolicy, "Controller button press");
  assert.equal(boundary.inferredPolicy, "Controller button press");
  assert.equal(boundary.effectivePolicy, "Controller button press");
  assert.equal(boundary.overridden, false);
  assert.deepEqual(boundary.configuration, {
    schemaVersion: "storyvr-interaction-configuration/v1",
    type: "controller-button-press",
    profile: "meta-quest-touch-plus",
    bindings: [
      { hand: "right", input: "a", action: "next-beat" },
      { hand: "left", input: "x", action: "previous-beat" },
    ],
  });
});

test("spatial traversal does not auto-assign reader locomotion", () => {
  const { graph, runtime } = fixture([
    { id: "beat-1", text: "First", isTextOnly: true, linkedAssets: [] },
    { id: "beat-2", text: "Second", isTextOnly: true, linkedAssets: [] },
    { id: "beat-3", text: "Third", isTextOnly: true, linkedAssets: [] },
  ]);
  const records = inferInteractionControlByBoundary(graph, runtime, {
    defaultLocomotionMode: "physical-walking",
    transitions: [{
      fromBeatId: "beat-1",
      toBeatId: "beat-2",
      fromStationId: "station-1",
      toStationId: "station-2",
      requiresLocomotion: true,
      reason: "The panels occupy separated reading stations.",
    }],
  });
  assert.equal(records[0].mappedTransition, false);
  assert.equal(records[0].inferredPolicy, "Controller button press");
  assert.equal(records[0].locomotionMode, null);
  assert.equal(records[1].inferredPolicy, "Controller button press");
});

test("an exact mapped camera transition is unassigned for the author", () => {
  const beats = [
    { id: "beat-1", linkedAssets: [MODEL] },
    { id: "beat-2", linkedAssets: [MODEL] },
  ];
  const { graph, runtime } = fixture(beats, {
    sourceMotionLinking: {
      tracks: [{
        trackId: "camera-track",
        kind: "camera",
        componentId: "inter-beat-dynamics",
        assetId: MODEL.id,
        effective: {
          beatIds: [],
          transitions: [{ fromBeatId: "beat-1", toBeatId: "beat-2" }],
        },
      }],
    },
  });
  const [boundary] = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });
  assert.equal(boundary.mappedTransition, true);
  assert.equal(boundary.assignmentRequired, true);
  assert.equal(boundary.defaultPolicy, null);
  assert.equal(boundary.inferredPolicy, null);
  assert.equal(boundary.effectivePolicy, null);
  assert.equal(boundary.overridden, false);
  assert.match(boundary.reason, /mapped (?:Transition|animation)/i);
});

test("a model part-state delta without a mapped transition defaults to controller button press", () => {
  const beats = [
    { id: "beat-1", linkedAssets: [MODEL] },
    { id: "beat-2", linkedAssets: [MODEL] },
  ];
  const { graph, runtime } = fixture(beats, {
    sourcePartStates: {
      states: [
        { beatId: "beat-1", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: false }] },
        { beatId: "beat-2", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: true }] },
      ],
    },
  });
  const [boundary] = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });
  assert.equal(boundary.inferredPolicy, "Controller button press");
  assert.equal(boundary.effectivePolicy, "Controller button press");
  assert.deepEqual(boundary.evidence.map((item) => item.type), ["button-fallback"]);
  assert.match(boundary.reason, /No mapped Transition/);
});

test("an exact mapped non-camera transition is unassigned instead of inferred as direct manipulation", () => {
  const beats = [
    { id: "beat-1", linkedAssets: [MODEL] },
    { id: "beat-2", linkedAssets: [MODEL] },
  ];
  const { graph, runtime } = fixture(beats, {
    sourcePartStates: {
      states: [
        { beatId: "beat-1", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: false }] },
        { beatId: "beat-2", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: true }] },
      ],
    },
    sourceMotionLinking: {
      tracks: [{
        trackId: "model-transition",
        kind: "clip",
        componentId: "inter-beat-dynamics",
        assetId: MODEL.id,
        effective: {
          beatIds: [],
          transitions: [{ fromBeatId: "beat-1", toBeatId: "beat-2" }],
        },
      }],
    },
  });
  const [boundary] = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });
  assert.equal(boundary.mappedTransition, true);
  assert.equal(boundary.assignmentRequired, true);
  assert.equal(boundary.defaultPolicy, null);
  assert.equal(boundary.inferredPolicy, null);
  assert.equal(boundary.effectivePolicy, null);
  assert.equal(boundary.evidence.some((item) => item.type === "mapped-transition"), true);
});

test("a shared-timeline hold remains unmapped even when a legacy track targets the boundary", () => {
  const beats = [
    { id: "beat-1", linkedAssets: [MODEL] },
    { id: "beat-2", linkedAssets: [MODEL] },
  ];
  const { graph, runtime } = fixture(beats, {
    sourcePartStates: {
      states: [
        { beatId: "beat-1", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: false }] },
        { beatId: "beat-2", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: true }] },
      ],
    },
    sourceMotionLinking: {
      tracks: [{
        trackId: "legacy-transition",
        kind: "clip",
        componentId: "inter-beat-dynamics",
        assetId: MODEL.id,
        effective: {
          beatIds: [],
          transitions: [{ fromBeatId: "beat-1", toBeatId: "beat-2" }],
        },
      }],
    },
    sourceMotionPlayback: {
      assets: [{
        assetId: MODEL.id,
        mode: "shared-timeline",
        coordinatedClips: [{ clipIndex: 0 }],
        boundaries: [{
          fromBeatId: "beat-1",
          toBeatId: "beat-2",
          mode: "hold",
          startProgress: 0.4,
          endProgress: 0.4,
        }],
      }],
    },
  });
  const [boundary] = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });
  assert.equal(boundary.mappedTransition, false);
  assert.equal(boundary.assignmentRequired, false);
  assert.equal(boundary.defaultPolicy, "Controller button press");
  assert.equal(boundary.inferredPolicy, "Controller button press");
  assert.deepEqual(boundary.evidence.map((item) => item.type), ["button-fallback"]);
});

test("a shared-timeline scrub is mapped and therefore starts unassigned", () => {
  const beats = [
    { id: "beat-1", linkedAssets: [MODEL] },
    { id: "beat-2", linkedAssets: [MODEL] },
  ];
  const { graph, runtime } = fixture(beats, {
    sourcePartStates: {
      states: [
        { beatId: "beat-1", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: false }] },
        { beatId: "beat-2", assetId: MODEL.id, parts: [{ selector: "mesh-a", visible: true }] },
      ],
    },
    sourceMotionPlayback: {
      assets: [{
        assetId: MODEL.id,
        mode: "shared-timeline",
        coordinatedClips: [{ clipIndex: 0 }],
        boundaries: [{
          fromBeatId: "beat-1",
          toBeatId: "beat-2",
          mode: "scrub",
          startProgress: 0.2,
          endProgress: 0.6,
        }],
      }],
    },
  });
  const [boundary] = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });
  assert.equal(boundary.mappedTransition, true);
  assert.equal(boundary.assignmentRequired, true);
  assert.equal(boundary.defaultPolicy, null);
  assert.equal(boundary.inferredPolicy, null);
  assert.equal(boundary.effectivePolicy, null);
  assert.equal(boundary.evidence.some((item) => item.type === "mapped-transition"), true);
});

test("a graph branch does not auto-assign branching selection", () => {
  const beats = [
    { id: "beat-1", linkedAssets: [MODEL] },
    { id: "beat-2", linkedAssets: [MODEL] },
    { id: "beat-3", linkedAssets: [] },
  ];
  const { graph, runtime } = fixture(beats, {
    edges: [
      { fromBeatId: "beat-1", toBeatId: "beat-2" },
      { fromBeatId: "beat-1", toBeatId: "beat-3" },
    ],
  });
  const records = inferInteractionControlByBoundary(graph, runtime, {
    transitions: [{
      fromBeatId: "beat-1",
      toBeatId: "beat-2",
      requiresLocomotion: true,
      reason: "Separated stations",
    }],
  });
  assert.equal(records[0].mappedTransition, false);
  assert.equal(records[0].defaultPolicy, "Controller button press");
  assert.equal(records[0].effectivePolicy, "Controller button press");
  assert.equal(records[0].evidence[0].type, "button-fallback");
});

test("variant beats use previous and next UI button presses without becoming narrative branches", () => {
  const beats = [
    { id: "shark-cards", text: "Choose a shark", variantGroupId: "sharks" },
    { id: "ending", text: "Continue" },
  ];
  const { graph, runtime } = fixture(beats, {
    variantGroups: [{
      id: "sharks",
      beatId: "shark-cards",
      control: {
        kind: "previous-next",
        previousLabel: "Previous shark",
        nextLabel: "Next shark",
        wrap: false,
      },
      options: [
        { id: "white", label: "White shark" },
        { id: "tiger", label: "Tiger shark" },
      ],
    }],
    edges: [
      {
        id: "white-to-tiger",
        kind: "transition",
        from: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "white", side: "bottom" },
        to: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "tiger", side: "top" },
      },
      {
        id: "tiger-to-white",
        kind: "transition",
        from: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "tiger", side: "top" },
        to: { cardKind: "variant", beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "white", side: "bottom" },
      },
      {
        id: "legacy-sharks-to-ending",
        kind: "transition",
        from: { cardKind: "beat", beatId: "shark-cards", side: "right" },
        to: { cardKind: "beat", beatId: "ending", side: "left" },
      },
    ],
  });

  const [variantControl] = inferVariantInteractionControlByBeat(graph, runtime);
  const variantEdges = inferVariantInteractionControlByEdge(graph, runtime);
  const boundaries = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });

  assert.equal(variantControl.beatId, "shark-cards");
  assert.equal(variantControl.variantGroupId, "sharks");
  assert.equal(variantControl.inferredPolicy, "UI button press");
  assert.equal(variantControl.effectivePolicy, "UI button press");
  assert.equal(variantControl.surface, "text-panel");
  assert.equal(variantControl.selectionMode, "previous-next");
  assert.equal(variantControl.previousLabel, "Previous shark");
  assert.equal(variantControl.nextLabel, "Next shark");
  assert.equal(variantControl.wrap, false);
  assert.deepEqual(variantControl.optionIds, ["white", "tiger"]);
  assert.match(variantControl.reason, /ray-click backward or forward/i);
  assert.deepEqual(variantEdges.map((record) => record.edgeId), ["white-to-tiger", "tiger-to-white"]);
  assert.deepEqual(variantEdges.map((record) => [
    record.fromVariantOptionId,
    record.toVariantOptionId,
    record.defaultPolicy,
    record.effectivePolicy,
  ]), [
    ["white", "tiger", "UI button press", "UI button press"],
    ["tiger", "white", "UI button press", "UI button press"],
  ]);
  assert.ok(variantEdges.every((record) => record.selectionMode === "directed-edge"));
  assert.deepEqual(
    variantEdges.map((record) => record.configuration.buttons[0].position),
    [[0.8, 0.86], [0.2, 0.86]],
    "default Next and Previous controls occupy the bottom-right and bottom-left slots",
  );
  assert.deepEqual(variantEdges.map((record) => record.variantDirection), ["next", "previous"]);
  assert.deepEqual(variantEdges[0].configuration, {
    schemaVersion: "storyvr-interaction-configuration/v1",
    type: "ui-button-press",
    buttons: [{
      id: "white-to-tiger",
      label: "Tiger shark",
      action: "select-variant",
      position: [0.8, 0.86],
      size: [0.32, 0.12],
    }],
  });
  assert.deepEqual(boundaries.map((boundary) => [
    boundary.fromContext.variantOptionId,
    boundary.toContext.variantOptionId,
    boundary.effectivePolicy,
  ]), [
    ["white", null, "Controller button press"],
    ["tiger", null, "Controller button press"],
  ]);
  assert.ok(boundaries.every((boundary) => boundary.edgeId === boundary.boundaryId));
});

test("Interaction Control sanitizes policy-specific editor configurations", () => {
  assert.deepEqual(sanitizeInteractionControlConfiguration("Controller button press", {
    profile: "  Quest custom profile  ",
    bindings: [
      { hand: "RIGHT", button: "A", mapping: "advance" },
      { handedness: "left", control: "X", action: "back" },
      { handedness: "left", control: "A", action: "next-beat" },
      { handedness: "right", control: "thumbstick", action: "none" },
      { handedness: "right", control: "trigger", action: "next-beat" },
      { handedness: "left", control: "primary-trigger", action: "none" },
      { hand: "left", input: "grip", action: "previous-beat" },
      { hand: "right", input: "squeeze", action: "unmapped" },
      { handedness: "other", control: "trigger", action: "next-beat" },
    ],
  }), {
    schemaVersion: "storyvr-interaction-configuration/v1",
    type: "controller-button-press",
    profile: "Quest custom profile",
    bindings: [
      { hand: "right", input: "a", action: "next-beat" },
      { hand: "left", input: "x", action: "previous-beat" },
      { hand: "right", input: "thumbstick-press", action: "unmapped" },
    ],
  });

  const configurationValidation = Function("sanitizeInteractionControlConfiguration", `
    const INTERACTION_CONTROLLER_HANDS = new Set(["left", "right"]);
    const INTERACTION_CONTROLLER_RESERVED_CONTROLS = new Set(["trigger", "squeeze"]);
    const INTERACTION_CONTROLLER_ACTIONS = new Set(["next-beat", "previous-beat", "unmapped"]);
    ${engineFunctionSource("interactionConfigurationNumber")}
    ${engineFunctionSource("interactionConfigurationArray")}
    ${engineFunctionSource("interactionConfigurationQuaternion")}
    ${engineFunctionSource("interactionConfigurationTransform")}
    ${engineFunctionSource("interactionConfigurationEulerDegrees")}
    ${engineFunctionSource("interactionConfigurationRotationRangeReference")}
    ${engineFunctionSource("directManipulationScaleDestinationIsReachable")}
    ${engineFunctionSource("directManipulationDestinationWithinConstraints")}
    ${engineFunctionSource("normalizeInteractionControllerControl")}
    ${engineFunctionSource("normalizeInteractionControllerAction")}
    ${engineFunctionSource("interactionControllerControlAvailable")}
    ${engineFunctionSource("legacyReservedInteractionControllerBinding")}
    ${engineFunctionSource("interactionControlConfigurationWithoutLegacyReservedBindings")}
    ${engineFunctionSource("validInteractionControlConfiguration")}
    return {
      validateConfiguration: validInteractionControlConfiguration,
      destinationWithinConstraints: directManipulationDestinationWithinConstraints,
      scaleDestinationIsReachable: directManipulationScaleDestinationIsReachable,
    };
  `)(sanitizeInteractionControlConfiguration);
  const {
    validateConfiguration,
    destinationWithinConstraints,
    scaleDestinationIsReachable,
  } = configurationValidation;
  const legacyReservedBindings = {
    schemaVersion: "storyvr-interaction-configuration/v1",
    type: "controller-button-press",
    profile: "meta-quest-touch-plus",
    bindings: [
      { hand: "right", input: "a", action: "next-beat" },
      { hand: "left", input: "x", action: "previous-beat" },
      { hand: "right", input: "trigger", action: "next-beat" },
      { hand: "left", input: "grip", action: "unmapped" },
    ],
  };
  assert.equal(
    validateConfiguration("Controller button press", legacyReservedBindings),
    true,
    "an otherwise-canonical v3 configuration remains compilable while reserved legacy bindings are stripped",
  );
  assert.equal(validateConfiguration("Controller button press", {
    ...legacyReservedBindings,
    bindings: [
      ...legacyReservedBindings.bindings,
      { hand: "other", input: "trigger", action: "next-beat" },
    ],
  }), false, "invalid-handed mappings are not hidden by legacy compatibility");

  const legacyDirectDestination = sanitizeInteractionControlConfiguration("Direct manipulation", {
    targets: [{
      entityId: "legacy-entity",
      assetId: "legacy-glb",
      destinationTransform: { position: [1, 2, 3] },
    }],
  });
  assert.equal(validateConfiguration("Direct manipulation", legacyDirectDestination), true,
    "legacy Direct destinations without destinationAuthored remain accepted");
  assert.equal(validateConfiguration("Direct manipulation", {
    ...legacyDirectDestination,
    targets: legacyDirectDestination.targets.map((target) => ({ ...target, destinationAuthored: false })),
  }), false, "an explicitly unauthored Direct destination is incomplete");
  assert.equal(validateConfiguration(
    "Direct manipulation",
    sanitizeInteractionControlConfiguration("Direct manipulation", { targets: [] }),
  ), false, "Direct manipulation with no remaining target is incomplete");
  assert.equal(validateConfiguration("Direct manipulation", null), false);

  const directWithDestination = (overrides = {}) => sanitizeInteractionControlConfiguration("Direct manipulation", {
    targets: [{
      entityId: "constrained-entity",
      assetId: "constrained-glb",
      oneHandGrabbable: true,
      twoHandScalable: true,
      initialTransform: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      constraints: {
        position: { min: [-1, -1, -1], max: [1, 1, 1] },
        rotation: { minDegrees: [-30, -30, -30], maxDegrees: [30, 30, 30] },
        scale: { min: [0.5, 0.5, 0.5], max: [2, 2, 2] },
      },
      destinationAuthored: true,
      destinationTransform: {
        position: [1, -1, 0],
        quaternion: [0, 0, 0, 1],
        scale: [2, 2, 2],
      },
      ...overrides,
    }],
  });
  const endpointDestination = directWithDestination();
  assert.equal(validateConfiguration("Direct manipulation", endpointDestination), true,
    "a destination exactly on the Maximum scale endpoint is saveable");
  assert.equal(validateConfiguration("Direct manipulation", directWithDestination({
    destinationTransform: {
      position: [-1, 1, 0],
      quaternion: [0, 0, 0, 1],
      scale: [0.5, 0.5, 0.5],
    },
  })), true, "a destination exactly on the Minimum scale endpoint is saveable");
  assert.equal(validateConfiguration("Direct manipulation", directWithDestination({
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1.5, 1.5, 1.5],
    },
  })), true, "a common two-hand scale ratio inside the range is saveable");
  assert.equal(validateConfiguration("Direct manipulation", directWithDestination({
    destinationTransform: {
      position: [1.01, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  })), false, "server validation rejects a destination outside movement constraints");
  assert.equal(validateConfiguration("Direct manipulation", directWithDestination({
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0.3826834324, 0, 0.9238795325],
      scale: [1, 1, 1],
    },
  })), false, "server validation rejects a destination outside rotation constraints");
  assert.equal(validateConfiguration("Direct manipulation", directWithDestination({
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [2.01, 1, 1],
    },
  })), false, "server validation rejects a destination outside scale constraints");
  assert.equal(validateConfiguration("Direct manipulation", directWithDestination({
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1.2, 1.4, 1.6],
    },
  })), false, "server validation rejects an inside-box scale that no single two-hand ratio can reach");
  assert.equal(validateConfiguration("Direct manipulation", directWithDestination({
    constraints: {
      rotation: { minDegrees: [-5, 165, -5], maxDegrees: [5, 175, 5] },
    },
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0.9961946981, 0, 0.0871557427],
      scale: [1, 1, 1],
    },
  })), true, "server validation unwraps the quaternion for Y=170 near its narrow authored range");

  const nonuniformScaleTarget = {
    twoHandScalable: true,
    initialTransform: { scale: [1, 2, 4] },
    constraints: {
      scale: {
        min: [0.5, 1.4, 3.6],
        max: [2, 5, 12],
      },
    },
  };
  const scaleTransform = (scale) => ({
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale,
  });
  assert.equal(scaleDestinationIsReachable(nonuniformScaleTarget, scaleTransform([1.5, 3, 6])), true);
  assert.equal(scaleDestinationIsReachable(nonuniformScaleTarget, scaleTransform(nonuniformScaleTarget.constraints.scale.min)), true,
    "the exact nonuniform Minimum ghost is an allowed endpoint");
  assert.equal(scaleDestinationIsReachable(nonuniformScaleTarget, scaleTransform(nonuniformScaleTarget.constraints.scale.max)), true,
    "the exact nonuniform Maximum ghost is an allowed endpoint");
  assert.equal(scaleDestinationIsReachable(nonuniformScaleTarget, scaleTransform([1.5, 3.2, 6])), false);

  assert.equal(destinationWithinConstraints({
    oneHandGrabbable: false,
    twoHandScalable: true,
    constraints: {
      position: { min: [-1, -1, -1], max: [1, 1, 1] },
      rotation: { minDegrees: [-30, -30, -30], maxDegrees: [30, 30, 30] },
      scale: { min: [0.5, 0.5, 0.5], max: [2, 2, 2] },
    },
    destinationTransform: {
      position: [99, 99, 99],
      quaternion: [0.70710678, 0, 0, 0.70710678],
      scale: [1, 1, 1],
    },
  }), true, "server reachability ignores move and rotation when one-hand grab is unavailable");
  assert.equal(destinationWithinConstraints({
    oneHandGrabbable: true,
    twoHandScalable: false,
    constraints: { scale: { min: [0.5, 0.5, 0.5], max: [2, 2, 2] } },
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [99, 99, 99],
    },
  }), true, "server reachability ignores scale when two-hand scaling is unavailable");
  assert.match(engineFunctionSource("validInteractionControlConfiguration"), /directManipulationDestinationWithinConstraints\(target\)/,
    "save validation cannot bypass the same constraint reachability contract as the editor");
  assert.match(engineFunctionSource("directManipulationDestinationWithinConstraints"), /interactionConfigurationEulerDegrees\(transform, interactionConfigurationRotationRangeReference\(constraints\.rotation\)\)/);
  assert.match(engineFunctionSource("directManipulationDestinationWithinConstraints"), /directManipulationScaleDestinationIsReachable\(target, transform\)/);

  assert.deepEqual(sanitizeInteractionControlConfiguration("UI button press", {
    button: {
      label: "  See tiger  ",
      position: { x: 1.4, y: -0.2 },
      size: [0, 2],
    },
  }, { toLabel: "Tiger shark" }), {
    schemaVersion: "storyvr-interaction-configuration/v1",
    type: "ui-button-press",
    buttons: [{
      id: "ui-button",
      label: "See tiger",
      action: "select-variant",
      position: [1, 0],
      size: [0.04, 1],
    }],
  });

  assert.deepEqual(
    sanitizeInteractionControlConfiguration("UI button press", null, {
      edgeId: "middle-to-previous",
      toLabel: "Previous option",
      variantDirection: "previous",
    }).buttons[0].position,
    [0.2, 0.86],
  );
  assert.deepEqual(
    sanitizeInteractionControlConfiguration("UI button press", null, {
      edgeId: "middle-to-next",
      toLabel: "Next option",
      variantDirection: "next",
    }).buttons[0].position,
    [0.8, 0.86],
  );

  assert.deepEqual(sanitizeInteractionControlConfiguration("Reader locomotion", {
    destination: {
      coordinateSpace: "world",
      transform: {
        position: [1, 2, 3],
        quaternion: [0, 0, 0, 0],
        scale: [1, 1, 1],
      },
    },
    tolerance: { distanceMeters: 99, dwellSeconds: -2 },
  }), {
    schemaVersion: "storyvr-interaction-configuration/v1",
    type: "reader-locomotion",
    destination: {
      coordinateSpace: "world",
      transform: {
        position: [1, 2, 3],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    tolerance: { distanceMeters: 5, dwellSeconds: 0 },
  });

  assert.deepEqual(sanitizeInteractionControlConfiguration("Direct manipulation", {
    targets: [{
      entityId: "glb:model-a:beat:opening",
      assetId: "model-a",
      nodePath: "Root/Fin",
      destinationTransform: {
        position: [1, 2, 3],
        quaternion: [0, 0, 0, 2],
        scale: [-2, 2, 999],
      },
      tolerance: { positionMeters: 0, rotationDegrees: 999, scaleRatio: 0 },
    }],
    tolerance: { positionMeters: 0.2, rotationDegrees: 15, scaleRatio: 0.25 },
    completion: "any",
  }), {
    schemaVersion: "storyvr-interaction-configuration/v1",
    type: "direct-manipulation",
    targets: [{
      entityId: "glb:model-a:beat:opening",
      assetId: "model-a",
      nodePath: "Root/Fin",
      destinationTransform: {
        position: [1, 2, 3],
        quaternion: [0, 0, 0, 1],
        scale: [0.001, 2, 100],
      },
      suggested: false,
      source: "author",
      tolerance: { positionMeters: 0.01, rotationDegrees: 180, scaleRatio: 0.005 },
    }],
    tolerance: { positionMeters: 0.2, rotationDegrees: 15, scaleRatio: 0.25 },
    completion: "all",
  });

  const nonOverlapping = sanitizeInteractionControlConfiguration("Direct manipulation", {
    targets: [
      { entityId: "glb:model-a:beat:opening", assetId: "model-a", destinationTransform: {} },
      { entityId: "glb:model-a:beat:opening", assetId: "model-a", nodePath: "Root/Fin", destinationTransform: {} },
    ],
  });
  assert.deepEqual(nonOverlapping.targets.map((target) => target.nodePath || "whole-object"), ["Root/Fin"]);

  const mixedIdentityTargets = sanitizeInteractionControlConfiguration("Direct manipulation", {
    targets: [
      { entityId: "glb:model-a:beat:opening", assetId: "model-a", destinationTransform: {} },
      { assetId: "model-a", nodePath: "Root/Tail", destinationTransform: {} },
    ],
  });
  assert.deepEqual(mixedIdentityTargets.targets.map((target) => target.nodePath || "whole-object"), ["Root/Tail"]);
});

test("in-beat interaction scenes canonicalize capabilities, constraints, and overlapping GLB parts", () => {
  const scenes = sanitizeInBeatInteractions([
    {
      beatId: "opening",
      sceneKey: "ignored-stale-key",
      targets: [
        {
          entityId: "shark-entity",
          assetId: "shark-glb",
          oneHandGrabbable: true,
          initialTransform: { position: [0, 0, 0], scale: [1, 1, 1] },
        },
        {
          entityId: "shark-entity",
          assetId: "shark-glb",
          nodePath: "Root/Arm",
          oneHandGrabbable: true,
        },
        {
          entityId: "shark-entity",
          assetId: "shark-glb",
          nodePath: "Root/Arm/Hand",
          twoHandScalable: true,
          initialTransform: { position: [1, 2, 3], scale: [1, 2, 3] },
          constraints: {
            position: { min: [-99, -99, -99], max: [99, 99, 99] },
            scale: { min: [4, -1, Number.NaN], max: [2, 5, Number.POSITIVE_INFINITY] },
          },
        },
        {
          entityId: "disabled",
          assetId: "disabled-glb",
          oneHandGrabbable: false,
          twoHandScalable: false,
        },
      ],
    },
    {
      beatId: "opening",
      targets: [{
        entityId: "shark-entity",
        assetId: "shark-glb",
        nodeIndex: 7,
        oneHandGrabbable: true,
        elasticDragging: true,
        constraints: {
          position: { min: [5, 0, 0], max: [-5, 1, 0] },
          rotation: { minDegrees: [100, 0, 0], maxDegrees: [-100, 20, 0] },
        },
      }],
    },
    {
      beatId: "choice",
      variantGroupId: "species",
      variantOptionId: "tiger",
      targets: [{
        entityId: "tiger-entity",
        assetId: "tiger-glb",
        oneHandGrabbable: true,
      }],
    },
    {
      beatId: "choice",
      variantOptionId: "missing-group",
      targets: [{ entityId: "invalid", assetId: "invalid", oneHandGrabbable: true }],
    },
  ]);

  assert.deepEqual(scenes.map((scene) => scene.sceneKey), [
    "beat:opening",
    "beat:choice:group:species:variant:tiger",
  ]);
  assert.equal(scenes[0].targets.length, 2, "a selected part replaces its whole-object and ancestor overlaps");
  assert.deepEqual(scenes[0].targets[0], {
    entityId: "shark-entity",
    assetId: "shark-glb",
    nodePath: "Root/Arm/Hand",
    coordinateSpace: "local",
    oneHandGrabbable: false,
    twoHandScalable: true,
    initialTransform: {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [1, 2, 3],
    },
    constraints: {
      scale: {
        min: [2, 0.001, 3],
        max: [4, 5, 3],
      },
    },
  });
  assert.deepEqual(scenes[0].targets[1].constraints, {
    position: { min: [-5, 0, 0], max: [5, 1, 0] },
    rotation: { minDegrees: [-100, 0, 0], maxDegrees: [100, 20, 0] },
  });
  assert.equal(scenes[0].targets[1].elasticDragging, true);
  assert.ok(JSON.stringify(scenes).includes('"coordinateSpace":"local"'));
  assert.equal(JSON.stringify(scenes).includes("NaN"), false);
});

test("Direct manipulation keeps only exact-scene interactables and enforces capability reachability", () => {
  const inBeatInteractions = sanitizeInBeatInteractions([
    {
      beatId: "opening",
      targets: [
        {
          entityId: "grab-entity",
          assetId: "grab-glb",
          oneHandGrabbable: true,
          elasticDragging: true,
          initialTransform: {
            position: [0, 1, 2],
            quaternion: [0, 0, 0, 1],
            scale: [1, 2, 3],
          },
          constraints: { position: { min: [-1, 0, 1], max: [1, 2, 3] } },
        },
        {
          entityId: "scale-entity",
          assetId: "scale-glb",
          twoHandScalable: true,
          initialTransform: {
            position: [4, 5, 6],
            quaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          constraints: { scale: { min: 0.5, max: 3 } },
        },
      ],
    },
    {
      beatId: "choice",
      variantGroupId: "species",
      variantOptionId: "white",
      targets: [{
        entityId: "variant-entity",
        assetId: "variant-glb",
        nodePath: "Root/WhiteFin",
        oneHandGrabbable: true,
      }],
    },
    {
      beatId: "choice",
      variantGroupId: "species",
      variantOptionId: "tiger",
      targets: [{
        entityId: "variant-entity",
        assetId: "variant-glb",
        nodePath: "Root/TigerFin",
        oneHandGrabbable: true,
      }],
    },
  ]);

  const direct = sanitizeInteractionControlConfiguration("Direct manipulation", {
    targets: [
      {
        entityId: "grab-entity",
        assetId: "grab-glb",
        destinationAuthored: true,
        destinationTransform: {
          position: [8, 9, 10],
          quaternion: [0, 1, 0, 0],
          scale: [9, 9, 9],
        },
      },
      {
        entityId: "scale-entity",
        assetId: "scale-glb",
        destinationTransform: {
          position: [9, 9, 9],
          quaternion: [0, 1, 0, 0],
          scale: [2, 3, 4],
        },
      },
      {
        entityId: "not-interactable",
        assetId: "other-glb",
        destinationTransform: { position: [1, 1, 1] },
      },
    ],
  }, {
    inBeatInteractions,
    sceneContext: { beatId: "opening" },
  });

  assert.deepEqual(direct.targets.map((target) => target.entityId), ["grab-entity", "scale-entity"]);
  assert.deepEqual(direct.targets[0].destinationTransform, {
    position: [8, 9, 10],
    quaternion: [0, 1, 0, 0],
    scale: [1, 2, 3],
  }, "grab-only targets cannot acquire a scale destination");
  assert.equal(direct.targets[0].destinationAuthored, true);
  assert.equal(direct.targets[0].elasticDragging, true);
  assert.deepEqual(direct.targets[0].constraints.position, { min: [-1, 0, 1], max: [1, 2, 3] });
  assert.deepEqual(direct.targets[1].destinationTransform, {
    position: [4, 5, 6],
    quaternion: [0, 0, 0, 1],
    scale: [2, 3, 4],
  }, "scale-only targets cannot acquire position or rotation destinations");
  assert.deepEqual(direct.targets[1].constraints.scale, {
    min: [0.5, 0.5, 0.5],
    max: [3, 3, 3],
  });

  const exactVariant = sanitizeInteractionControlConfiguration("Direct manipulation", {
    targets: [
      { entityId: "variant-entity", assetId: "variant-glb", nodePath: "Root/WhiteFin" },
      { entityId: "variant-entity", assetId: "variant-glb", nodePath: "Root/TigerFin" },
    ],
  }, {
    inBeatInteractions,
    sceneContext: { beatId: "choice", variantGroupId: "species", variantOptionId: "white" },
  });
  assert.deepEqual(exactVariant.targets.map((target) => target.nodePath), ["Root/WhiteFin"]);
});

test("variant edge inference mirrors implicit reciprocal canvas arrows when graph edges are absent", () => {
  const beats = [{
    id: "shark-cards",
    text: "Choose a shark",
    atomicBeatIds: ["source-shark-cards"],
  }];
  const { graph, runtime } = fixture(beats, {
    variantGroups: [{
      id: "sharks",
      beatId: "source-shark-cards",
      defaultOptionId: "tiger",
      options: [
        { id: "white", label: "White shark", sourceOrder: 0 },
        { id: "tiger", label: "Tiger shark", sourceOrder: 1 },
        { id: "nurse", label: "Nurse shark", sourceOrder: 2 },
      ],
    }],
  });

  assert.equal(Object.hasOwn(graph, "edges"), false);
  const records = inferVariantInteractionControlByEdge(graph, runtime);

  assert.deepEqual(records.map((record) => record.edgeId), [
    "source-transition-variant-shark-cards-sharks-tiger-to-variant-shark-cards-sharks-white",
    "source-transition-variant-shark-cards-sharks-white-to-variant-shark-cards-sharks-tiger",
    "source-transition-variant-shark-cards-sharks-white-to-variant-shark-cards-sharks-nurse",
    "source-transition-variant-shark-cards-sharks-nurse-to-variant-shark-cards-sharks-white",
  ]);
  assert.deepEqual(records.map((record) => [
    record.beatId,
    record.fromVariantOptionId,
    record.toVariantOptionId,
    record.effectivePolicy,
  ]), [
    ["shark-cards", "tiger", "white", "UI button press"],
    ["shark-cards", "white", "tiger", "UI button press"],
    ["shark-cards", "white", "nurse", "UI button press"],
    ["shark-cards", "nurse", "white", "UI button press"],
  ]);
});

test("implicit progression emits one exact outgoing route for every variant option", () => {
  const beats = [
    { id: "shark-cards", text: "Choose a shark", variantGroupId: "sharks", linkedAssets: [MODEL] },
    { id: "ending", text: "Continue", linkedAssets: [MODEL] },
  ];
  const { graph, runtime } = fixture(beats, {
    variantGroups: [{
      id: "sharks",
      beatId: "shark-cards",
      defaultOptionId: "tiger",
      options: [
        { id: "white", label: "White shark", sourceOrder: 0 },
        { id: "tiger", label: "Tiger shark", sourceOrder: 1 },
        { id: "nurse", label: "Nurse shark", sourceOrder: 2 },
      ],
    }],
  });

  const records = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });

  assert.deepEqual(records.map((record) => record.boundaryId), [
    "source-transition-variant-shark-cards-sharks-tiger-to-beat-ending",
    "source-transition-variant-shark-cards-sharks-white-to-beat-ending",
    "source-transition-variant-shark-cards-sharks-nurse-to-beat-ending",
  ]);
  assert.deepEqual(records.map((record) => record.fromContext.variantOptionId), ["tiger", "white", "nurse"]);
  assert.ok(records.every((record) => record.edgeId === record.boundaryId && record.routeId === record.boundaryId));
  assert.ok(records.every((record) => record.toContext.variantOptionId === null));
});

test("route-specific source motion only marks its exact variant progression route", () => {
  const beats = [
    { id: "shark-cards", text: "Choose a shark", variantGroupId: "sharks", linkedAssets: [MODEL] },
    { id: "ending", text: "Continue", linkedAssets: [MODEL] },
  ];
  const edge = (optionId) => ({
    id: `${optionId}-to-ending`,
    kind: "transition",
    from: {
      cardKind: "variant",
      beatId: "shark-cards",
      variantGroupId: "sharks",
      variantOptionId: optionId,
      side: "right",
    },
    to: { cardKind: "beat", beatId: "ending", side: "left" },
  });
  const { graph, runtime } = fixture(beats, {
    variantGroups: [{
      id: "sharks",
      beatId: "shark-cards",
      defaultOptionId: "white",
      options: [
        { id: "white", label: "White shark", assetIds: [MODEL.id] },
        { id: "tiger", label: "Tiger shark", assetIds: [MODEL.id] },
      ],
    }],
    edges: [edge("white"), edge("tiger")],
    sourceMotionLinking: {
      tracks: [{
        trackId: "white-route-motion",
        kind: "clip",
        componentId: "inter-beat-dynamics",
        assetId: MODEL.id,
        effective: {
          beatIds: [],
          transitions: [{
            boundaryId: "white-to-ending",
            edgeId: "white-to-ending",
            routeId: "white-to-ending",
            fromBeatId: "shark-cards",
            toBeatId: "ending",
            fromContext: { beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: "white" },
            toContext: { beatId: "ending", variantGroupId: null, variantOptionId: null },
          }],
        },
      }],
    },
  });

  const records = inferInteractionControlByBoundary(graph, runtime, { transitions: [] });

  assert.deepEqual(records.map((record) => [
    record.boundaryId,
    record.mappedTransition,
    record.effectivePolicy,
  ]), [
    ["white-to-ending", true, null],
    ["tiger-to-ending", false, "Controller button press"],
  ]);
});

test("the v3 source signature includes group controls and directed variant edges", () => {
  const signature = engineFunctionSource("interactionControlBoundarySourceSignature");
  assert.match(engineSource, /storyvr-interaction-control-boundaries\/v3/);
  assert.match(signature, /inferredPolicy:\s*VARIANT_UI_BUTTON_PRESS_POLICY/);
  assert.match(signature, /previousLabel/);
  assert.match(signature, /nextLabel/);
  assert.match(signature, /wrap/);
  assert.match(signature, /variantEdges/);
  assert.match(signature, /edgeId:\s*record\.edgeId/);
  assert.match(signature, /fromVariantOptionId/);
  assert.match(signature, /toVariantOptionId/);
});

test("Interaction Control has no generic option-generation endpoint", async () => {
  await assert.rejects(
    generateComponentProposals({}, "interaction-control"),
    (error) => error?.statusCode === 409
      && /does not generate options/i.test(error.message)
      && /Assign a control directly/i.test(error.message),
  );
});

test("generic proposal generation has no Interaction Control branches", () => {
  for (const functionName of [
    "fallbackProposals",
    "normalizeProposalBundle",
    "proposalCountInstruction",
    "requiredLabelsInstruction",
    "componentSpecificInstruction",
    "fallbackDescription",
    "fallbackReaderImpact",
    "fallbackRisks",
    "fallbackImplementationHints",
  ]) {
    const body = engineFunctionSource(functionName);
    assert.doesNotMatch(body, /interaction-control/, `${functionName} is independent of Interaction Control`);
  }
  assert.doesNotMatch(engineSource, /Interaction Control proposals|Regenerate Interaction Control/);
});

test("Interaction Control save is direct and does not require an optionId or proposal bundle", () => {
  const save = engineFunctionSource("saveCheckpointDecision");
  const interactionBranch = save.indexOf('component.id === "interaction-control"');
  const genericProposalRead = save.indexOf("const bundle =");
  assert.notEqual(interactionBranch, -1);
  assert.notEqual(genericProposalRead, -1);
  assert.ok(interactionBranch < genericProposalRead, "the direct Interaction branch precedes generic proposal loading");
  assert.match(save.slice(interactionBranch, genericProposalRead), /payload\.boundaryOverrides/);
  assert.match(save.slice(interactionBranch, genericProposalRead), /payload\.variantOverrides/);
  assert.match(save.slice(interactionBranch, genericProposalRead), /applyVariantInteractionControlEdgeOverrides/);
  assert.match(save.slice(interactionBranch, genericProposalRead), /assertInteractionControlAssignmentsComplete/);
  assert.match(save.slice(interactionBranch, genericProposalRead), /assertVariantInteractionControlEdgeAssignmentsComplete/);
  assert.doesNotMatch(save.slice(interactionBranch, genericProposalRead), /payload\.optionId|proposalsRoot|proposalBundle/);
});

test("variant edge overrides are separate from narrative boundary overrides and allow three policies", () => {
  const apply = engineFunctionSource("applyVariantInteractionControlEdgeOverrides");
  const normalize = engineFunctionSource("normalizeVariantInteractionControlEdgeOverrides");
  const serialize = engineFunctionSource("variantInteractionControlEdgeOverridesFromRecords");

  assert.match(apply, /record\.edgeId/);
  assert.match(apply, /variantInteractionPolicySurface/);
  assert.match(apply, /Unknown Interaction Control variant edge/);
  assert.match(apply, /fromVariantOptionId/);
  assert.match(apply, /toVariantOptionId/);
  assert.doesNotMatch(`${apply}\n${normalize}\n${serialize}`, /boundaryId|interactionControlByBoundary/);
  assert.match(engineFunctionSource("variantInteractionPolicySurface"), /VARIANT_UI_BUTTON_PRESS_POLICY/);
  assert.match(engineFunctionSource("variantInteractionPolicySurface"), /DIRECT_MANIPULATION_LABEL/);
  assert.match(engineFunctionSource("variantInteractionPolicySurface"), /READER_LOCOMOTION_LABEL/);
  assert.match(serialize, /edgeId:\s*record\.edgeId/);
  assert.match(serialize, /variantGroupId/);
  assert.match(serialize, /fromVariantOptionId/);
  assert.match(serialize, /toVariantOptionId/);
});

test("policy-specific configurations persist through decisions and compiled per-unit records", () => {
  const applyBoundary = engineFunctionSource("applyInteractionControlBoundaryOverrides");
  const normalizeBoundary = engineFunctionSource("normalizeInteractionControlBoundaryOverrides");
  const serializeBoundary = engineFunctionSource("interactionControlBoundaryOverridesFromRecords");
  const applyVariant = engineFunctionSource("applyVariantInteractionControlEdgeOverrides");
  const normalizeVariant = engineFunctionSource("normalizeVariantInteractionControlEdgeOverrides");
  const serializeVariant = engineFunctionSource("variantInteractionControlEdgeOverridesFromRecords");
  const effectiveByUnit = engineFunctionSource("effectiveInteractionPoliciesForUnits");
  const effectiveByRoute = engineFunctionSource("effectiveInteractionPolicyForRoute");

  assert.match(applyBoundary, /interactionBoundaryConfigurationContext\(record, inBeatInteractions\)/);
  assert.match(normalizeBoundary, /configuration:\s*item\.configuration/);
  assert.match(serializeBoundary, /configuration:\s*cloneJson\(record\.configuration\)/);
  assert.match(applyVariant, /interactionVariantEdgeConfigurationContext\(record, inBeatInteractions\)/);
  assert.match(normalizeVariant, /configuration:\s*item\.configuration/);
  assert.match(serializeVariant, /configuration:\s*cloneJson\(record\.configuration\)/);
  assert.match(effectiveByUnit, /effectiveInteractionPolicyForRoute\(record\)/);
  assert.match(effectiveByRoute, /configuration:\s*cloneInteractionControlConfiguration\(record\.configuration\)/);
  assert.match(engineSource, /interactionControlByBoundary,/);
  assert.match(engineSource, /variantInteractionControlByEdge/);
});

test("in-beat interactions persist through save, material signatures, and compiled output", () => {
  const save = engineFunctionSource("saveCheckpointDecision");
  const compile = engineFunctionSource("compileAuthorRuntime");
  const signature = engineFunctionSource("decisionMaterialSignature");
  const validate = engineFunctionSource("isValidDecisionContent");

  assert.match(save, /sanitizeInBeatInteractions/);
  assert.match(save, /inBeatInteractionsSchemaVersion:\s*IN_BEAT_INTERACTIONS_SCHEMA_VERSION/);
  assert.match(save, /assertDirectManipulationConfigurationsComplete\(interactionControlByBoundary\)/);
  assert.match(compile, /inBeatInteractionsSchemaVersion:\s*IN_BEAT_INTERACTIONS_SCHEMA_VERSION/);
  assert.match(compile, /inBeatInteractions:\s*inBeatInteractions\.filter\(\(record\) => record\.beatId === unit\.id\)/);
  assert.match(signature, /inBeatInteractionsSchemaVersion/);
  assert.match(signature, /inBeatInteractions:\s*decision\.inBeatInteractions/);
  assert.match(validate, /validInteractionDecisionInBeatContract/);
});

test("compiled interactions declare Trigger and Grip as reserved system inputs", () => {
  const fallback = engineFunctionSource("controllerButtonFallbackOption");
  assert.doesNotMatch(fallback, /primary (?:controller )?action|WebXR select/i);
  assert.match(fallback, /face, menu, or thumbstick/);
  assert.match(fallback, /Trigger reserved for UI ray click and scroll/);
  assert.match(fallback, /Grip reserved for grab/);
  const reservations = Function(`
    const INTERACTION_CONTROLLER_INPUT_RESERVATIONS_SCHEMA_VERSION = "storyvr-controller-input-reservations/v1";
    const META_QUEST_CONTROLLER_PROFILE = "meta-quest-touch-plus";
    ${engineFunctionSource("interactionControllerInputReservations")}
    return interactionControllerInputReservations();
  `)();
  assert.deepEqual(reservations, {
    schemaVersion: "storyvr-controller-input-reservations/v1",
    profile: "meta-quest-touch-plus",
    inputs: [
      {
        input: "trigger",
        label: "Trigger",
        aliases: ["primary-trigger"],
        assignable: false,
        reservedFor: "ui-ray-interactor",
        actions: ["click", "scroll"],
      },
      {
        input: "squeeze",
        label: "Grip",
        aliases: ["grip"],
        assignable: false,
        reservedFor: "grab-interactor",
        actions: ["grab"],
      },
    ],
  });
  const compile = engineFunctionSource("compileAuthorRuntime");
  assert.match(compile, /controllerInputReservations:\s*interactionControllerInputReservations\(\)/);
});

test("compiled interaction maps retain parallel route identity instead of overwriting by destination beat", () => {
  const effectiveByRoute = Function(`
    ${engineFunctionSource("cloneJson")}
    ${engineFunctionSource("cloneInteractionControlConfiguration")}
    ${engineFunctionSource("effectiveInteractionPolicyForRoute")}
    ${engineFunctionSource("effectiveInteractionPoliciesForRoutes")}
    return effectiveInteractionPoliciesForRoutes;
  `)();
  const records = ["white", "tiger"].map((optionId) => ({
    boundaryId: `${optionId}-to-ending`,
    edgeId: `${optionId}-to-ending`,
    routeId: `${optionId}-to-ending`,
    fromBeatId: "shark-cards",
    toBeatId: "ending",
    fromContext: { beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: optionId },
    toContext: { beatId: "ending", variantGroupId: null, variantOptionId: null },
    effectivePolicy: optionId === "white" ? "Direct manipulation" : "Controller button press",
    inferredPolicy: "Controller button press",
    overridden: optionId === "white",
    reason: `${optionId} route`,
    evidence: [],
    locomotionMode: null,
    configuration: null,
  }));

  const result = effectiveByRoute(records);
  assert.deepEqual(Object.keys(result), ["white-to-ending", "tiger-to-ending"]);
  assert.equal(result["white-to-ending"].fromContext.variantOptionId, "white");
  assert.equal(result["white-to-ending"].policy, "Direct manipulation");
  assert.equal(result["tiger-to-ending"].fromContext.variantOptionId, "tiger");
  assert.equal(result["tiger-to-ending"].policy, "Controller button press");

  const compile = engineFunctionSource("compileAuthorRuntime");
  assert.match(compile, /interactionControlByRoute:\s*interactionControlByBoundary/);
  assert.match(compile, /effectiveInteractionPolicyByRoute/);
  assert.match(compile, /incomingInteractionControls/);
  assert.match(compile, /outgoingInteractionControls/);
});

test("backend accepts every supported policy on mapped and unmapped boundaries", () => {
  const policies = [
    "Controller button press",
    "Direct manipulation",
    "Reader locomotion",
    "Branching selection",
  ];
  const applyOverrides = Function("policies", "sanitizeInteractionControlConfiguration", `
    const CONTROLLER_BUTTON_PRESS_LABEL = "Controller button press";
    const READER_LOCOMOTION_LABEL = "Reader locomotion";
    const LEGACY_READER_LOCOMOTION_LABEL = "Embodied progression";
    const LEGACY_BUTTON_STEPPING_LABEL = "Button stepping";
    const READER_LOCOMOTION_MODES = ["physical-walking", "virtual-teleport"];
    const DEFAULT_READER_LOCOMOTION_MODE = "virtual-teleport";
    const COMPONENT_BY_ID = new Map([["interaction-control", { optionLabels: policies }]]);
    ${engineFunctionSource("cloneJson")}
    ${engineFunctionSource("cloneInteractionControlConfiguration")}
    ${engineFunctionSource("interactionBoundaryId")}
    ${engineFunctionSource("sourceMotionTransitionContext")}
    ${engineFunctionSource("interactionBoundaryConfigurationContext")}
    ${engineFunctionSource("normalizeLocomotionMode")}
    ${engineFunctionSource("normalizeInteractionControlLabel")}
    ${engineFunctionSource("normalizeInteractionControlBoundaryOverrides")}
    ${engineFunctionSource("applyInteractionControlBoundaryOverrides")}
    return applyInteractionControlBoundaryOverrides;
  `)(policies, sanitizeInteractionControlConfiguration);
  const records = [
    {
      boundaryId: "mapped",
      fromBeatId: "beat-1",
      toBeatId: "beat-2",
      mappedTransition: true,
      assignmentRequired: true,
      defaultPolicy: null,
      inferredPolicy: null,
      effectivePolicy: null,
      evidence: [],
    },
    {
      boundaryId: "unmapped",
      fromBeatId: "beat-2",
      toBeatId: "beat-3",
      mappedTransition: false,
      assignmentRequired: false,
      defaultPolicy: "Controller button press",
      inferredPolicy: "Controller button press",
      effectivePolicy: "Controller button press",
      evidence: [],
    },
  ];

  for (const policy of policies) {
    for (const boundaryId of ["mapped", "unmapped"]) {
      const result = applyOverrides(records, { [boundaryId]: { policy } });
      const assigned = result.find((record) => record.boundaryId === boundaryId);
      assert.equal(assigned.effectivePolicy, policy);
      assert.equal(assigned.overridden, true);
      assert.equal(assigned.authored, true);
    }
  }
});

test("legacy v3 beat-pair overrides project onto exact routes while exact overrides take precedence", () => {
  const policies = [
    "Controller button press",
    "Direct manipulation",
    "Reader locomotion",
    "Branching selection",
  ];
  const applyOverrides = Function("policies", "sanitizeInteractionControlConfiguration", `
    const CONTROLLER_BUTTON_PRESS_LABEL = "Controller button press";
    const READER_LOCOMOTION_LABEL = "Reader locomotion";
    const LEGACY_READER_LOCOMOTION_LABEL = "Embodied progression";
    const LEGACY_BUTTON_STEPPING_LABEL = "Button stepping";
    const READER_LOCOMOTION_MODES = ["physical-walking", "virtual-teleport"];
    const DEFAULT_READER_LOCOMOTION_MODE = "virtual-teleport";
    const COMPONENT_BY_ID = new Map([["interaction-control", { optionLabels: policies }]]);
    ${engineFunctionSource("cloneJson")}
    ${engineFunctionSource("cloneInteractionControlConfiguration")}
    ${engineFunctionSource("interactionBoundaryId")}
    ${engineFunctionSource("sourceMotionTransitionContext")}
    ${engineFunctionSource("interactionBoundaryConfigurationContext")}
    ${engineFunctionSource("normalizeLocomotionMode")}
    ${engineFunctionSource("normalizeInteractionControlLabel")}
    ${engineFunctionSource("normalizeInteractionControlBoundaryOverrides")}
    ${engineFunctionSource("applyInteractionControlBoundaryOverrides")}
    return applyInteractionControlBoundaryOverrides;
  `)(policies, sanitizeInteractionControlConfiguration);
  const records = ["white", "tiger"].map((optionId) => ({
    boundaryId: `${optionId}-to-ending`,
    edgeId: `${optionId}-to-ending`,
    routeId: `${optionId}-to-ending`,
    fromBeatId: "shark-cards",
    toBeatId: "ending",
    fromContext: { beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: optionId },
    toContext: { beatId: "ending", variantGroupId: null, variantOptionId: null },
    mappedTransition: false,
    defaultPolicy: "Controller button press",
    inferredPolicy: "Controller button press",
    effectivePolicy: "Controller button press",
    overridden: false,
    authored: false,
    reason: "Implicit route",
    evidence: [],
    configuration: null,
  }));

  const projected = applyOverrides(records, {
    "shark-cards->ending": { policy: "Reader locomotion" },
    "white-to-ending": { policy: "Direct manipulation" },
  });
  assert.equal(projected[0].effectivePolicy, "Direct manipulation");
  assert.equal(projected[0].legacyBoundaryOverride, false);
  assert.equal(projected[1].effectivePolicy, "Reader locomotion");
  assert.equal(projected[1].legacyBoundaryOverride, true);
});
