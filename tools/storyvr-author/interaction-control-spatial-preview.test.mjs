import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const readerSource = await readFile(new URL("./reader-template/src/main.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function readerFunctionSource(name) {
  const start = readerSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists in the reader`);
  const next = readerSource.indexOf("\nfunction ", start + 1);
  return readerSource.slice(start, next === -1 ? readerSource.length : next);
}

function transitionContext(endpoint) {
  return {
    beatId: endpoint.beatId,
    ...(endpoint.cardKind === "variant" ? {
      variantGroupId: endpoint.variantGroupId,
      variantOptionId: endpoint.variantOptionId,
    } : {}),
  };
}

function progressionEdge(id, fromContext, toContext) {
  const endpoint = (context) => ({
    cardKind: context.variantOptionId ? "variant" : "beat",
    beatId: context.beatId,
    ...(context.variantOptionId ? {
      variantGroupId: context.variantGroupId,
      variantOptionId: context.variantOptionId,
    } : {}),
  });
  return { id, from: endpoint(fromContext), to: endpoint(toContext) };
}

function boundaryRecordForEdge(edge, values) {
  return {
    boundaryId: edge.id,
    edgeId: edge.id,
    fromBeatId: edge.from.beatId,
    toBeatId: edge.to.beatId,
    fromContext: transitionContext(edge.from),
    toContext: transitionContext(edge.to),
    ...values,
  };
}

function boundaryContextForTest(beats, records, overrides = {}, resetBoundaryIds = [], edges = null, sceneContext = null) {
  const recordValidator = source.includes("function interactionBoundaryRecordIsCurrent(")
    ? "interactionBoundaryRecordIsCurrent"
    : "interactionBoundaryRecordHasValidInference";
  const progressionEdges = edges || [...records.values()].map((record) => progressionEdge(
    record.edgeId || record.boundaryId,
    record.fromContext || { beatId: record.fromBeatId },
    record.toContext || { beatId: record.toBeatId },
  ));
  return Function("beats", "records", "overrides", "resetBoundaryIds", "progressionEdges", "sceneContext", `
    const state = {
      interactionBoundaryOverrideResets: new Set(resetBoundaryIds),
      selectedInteractionBeatIndex: 1,
    };
    function interactionPreviewBeats() { return beats; }
    function interactionProgressionEdges() { return progressionEdges; }
    function interactionControlBoundaryRecords() { return records; }
    function interactionVariantControlRecords() { return new Map(); }
    function interactionVariantControlForBeat() { return null; }
    function interactionVariantSwitchEdges() { return []; }
    function interactionVariantEdgeControlForEdge() { return null; }
    function ensureInteractionBoundaryOverrides() { return overrides; }
    function clampInteractionBeatIndex() { return beats.length > 1 ? 1 : 0; }
    function interactionSceneContextForBeat(beatId) { return { beatId }; }
    function interactionPreviewBeatForSceneContext(proposal, context) {
      return beats.find((beat) => beat.id === context?.beatId) || null;
    }
    function interBeatDefaultSceneContextForBeat(beatId) { return { beatId }; }
    function sourceGraphTransitionSceneContext(endpoint) {
      return endpoint?.cardKind === "variant"
        ? {
            beatId: endpoint.beatId,
            variantGroupId: endpoint.variantGroupId,
            variantOptionId: endpoint.variantOptionId,
          }
        : { beatId: endpoint?.beatId };
    }
    function sourceGraphTransitionContextMatches(left, right) {
      return Boolean(
        left?.beatId
        && right?.beatId
        && left.beatId === right.beatId
        && (left.variantGroupId || null) === (right.variantGroupId || null)
        && (left.variantOptionId || null) === (right.variantOptionId || null)
      );
    }
    function interactionConfigurationContext() { return {}; }
    function normalizeInteractionConfiguration(value, kind) { return value || { type: kind }; }
    ${functionSource("interactionBoundaryId")}
    ${functionSource("interactionControlKindLabel")}
    ${functionSource("recognizedInteractionPolicyKind")}
    ${functionSource(recordValidator)}
    ${functionSource("interactionBoundaryContext")}
    return interactionBoundaryContext(null, sceneContext);
  `)(beats, records, overrides, resetBoundaryIds, progressionEdges, sceneContext);
}

test("Interaction Control surfaces the saved spatial route without constraining assignment", () => {
  const constraint = functionSource("renderInteractionTraversalConstraint");
  assert.match(constraint, /Spatial route available/);
  assert.match(constraint, /assign Reader locomotion to any boundary/);
  assert.doesNotMatch(constraint, /boundaries require reader locomotion/i);
  assert.match(functionSource("renderInteractionActionControls"), /physical-walking/);
  assert.match(functionSource("renderInteractionActionControls"), /virtual-teleport/);
  assert.match(source, /payload\.boundaryOverrides = interactionBoundaryOverridesPayload/);
});

test("Interaction Control routes through canonical panel stations and preserves continuity", () => {
  const stops = functionSource("embodiedProgressionRouteStops");
  const route = functionSource("embodiedProgressionRouteForBeat");
  assert.match(stops, /interactionTraversalStationForBeat/);
  assert.match(stops, /hasCanonicalSpatialRelations/);
  assert.match(stops, /interactionSourceFocus|sourceFocus/);
  assert.match(route, /stops\[index - 1\]/, "beat N starts at beat N-1's destination");
  assert.match(route, /requiresLocomotion/);
});

test("Interaction Control resolves source-focus stations from loaded GLB camera cues", () => {
  const resolve = functionSource("applySourceSpatialCuesToInteractionViewer");
  assert.match(resolve, /sourceSpatialCueForBeat/);
  assert.match(resolve, /seekGltfToSourceSpatialCue/);
  assert.match(resolve, /sourceCameraSceneEvaluation/);
  assert.match(resolve, /interactionSourceFocus\.set/);
});

test("Interaction preview reuses the locked Spatial Relations scene from an outside editor camera", () => {
  const initializer = functionSource("initializeInteractionControlViewer");
  const sceneLoader = functionSource("loadSpatialRelationsGlb");
  const destinationGizmo = functionSource("initializeInteractionConfigurationGizmo");
  const cameraState = functionSource("previewCameraState");
  const cameraRestore = functionSource("shouldRestorePreviewCameraState");
  const interactionFraming = functionSource("fitInteractionControlPreviewCamera");
  const interactionContract = functionSource("interactionPreviewCameraFramingContract");

  assert.match(initializer, /lockedSpatialRelationsContract\(\)/, "Interaction reads the saved Spatial Relations contract");
  assert.match(initializer, /spatialSceneRecordForContext\([^,]+, editorContext\.sceneContext\)/, "the exact previous beat or variant scene is resolved");
  assert.match(initializer, /spatialSceneEntities\([^,]+, editorContext\.sceneContext\)/, "the exact previous-scene entities are resolved");
  assert.match(initializer, /spatialEntityType\([^)]*\) === "reader"/, "the saved Reader entity is selected");
  assert.match(initializer, /makeSpatialEditorFloorGuide\(/, "Interaction reuses the Spatial editor floor");
  assert.match(initializer, /createSpatialReaderRig\(root,[\s\S]*readerEntity\)/, "Interaction reuses the saved Reader pose");
  assert.match(
    initializer,
    /spatialTopologyAssetPose\(\{[\s\S]*?topologyKind:\s*layoutKind,[\s\S]*?topologyViewpoint:\s*layers\.viewpointKind/,
    "non-swap assets use the locked topology and viewpoint pose",
  );
  assert.match(initializer, /loadSpatialRelationsGlb\(/,
    "GLBs use the Spatial Relations loader and saved entity transforms");
  assert.match(initializer, /loadSpatialRelationsImage\(/,
    "image planes use the Spatial Relations loader and saved entity transforms");
  assert.match(initializer, /if \(!canRestoreCameraState\) fitInteractionControlPreviewCamera\(viewer, root\)/, "Interaction uses its camera-ready framing entrypoint after assets settle");
  assert.match(
    interactionFraming,
    /if \(viewer\?\.spatialEditorCamera\) \{[\s\S]*?frameSpatialSceneOverview\(viewer\)[\s\S]*?return;[\s\S]*?\}[\s\S]*?fitInheritedTopologyPreviewCamera/,
    "the reader and scene open in Spatial Relations' outside overview before inherited egocentric framing can run",
  );
  assert.match(
    sceneLoader,
    /normalizeSpatialRuntimeObject\([\s\S]*?topologyPose\.targetSize,[\s\S]*?spatialEntityVerticalAlignment\(entity\)/,
  );
  assert.match(sceneLoader, /viewer\.spatialContract \|\| state\.spatialRelationsDraft/,
    "the shared loader resolves the locked authoring scene outside Spatial Relations");
  assert.match(destinationGizmo, /makeInteractionLocomotionDestination/);
  assert.match(destinationGizmo, /makeInteractionDirectDestination/);
  assert.match(destinationGizmo, /new TransformControls/,
    "destination transforms use the same gizmo interaction as the Spatial editor");
  assert.match(
    initializer,
    /previewCameraFramingContract:\s*interactionPreviewCameraFramingContract\(beat, editorContext\.sceneContext\),[\s\S]*?previewCameraFramingReady:\s*false/,
    "Interaction starts with a viewer-specific unframed camera contract",
  );
  assert.match(interactionContract, /beat\?\.id/, "camera restoration is scoped to the selected beat's spatial focus");
  assert.match(source, /const INTERACTION_PREVIEW_CAMERA_FRAMING_CONTRACT = "interaction-spatial-editor\/v\d+"/, "old hidden-reader camera states cannot restore into the spatial editor");
  assert.match(
    cameraState,
    /previewCameraFramingContract:\s*viewer\.previewCameraFramingReady[\s\S]*?viewer\.previewCameraFramingContract/,
    "a camera captured before asset framing cannot claim the Interaction contract",
  );
  assert.match(
    cameraRestore,
    /expectedFramingContract[\s\S]*?cameraState\.previewCameraFramingContract !== expectedFramingContract[\s\S]*?return false/,
    "pre-fix and pre-load camera states cannot suppress canonical framing",
  );
  assert.match(functionSource("applyReaderViewerCameraState"), /viewer\.previewCameraFramingReady = true/, "a valid restored Interaction camera remains restorable within the same beat");
});

test("Interaction spatial editor always shows both reader hands with a panel on the left hand", () => {
  const initializer = functionSource("initializeInteractionControlViewer");
  const cumulativeUpdate = functionSource("updateInteractionControlCumulativeScene");
  const handRig = functionSource("addInteractionSpatialReaderHands");

  assert.match(initializer, /addInteractionSpatialReaderHands\(readerEditorLayer\.rig, beat\)/, "the persistent hand rig mounts for every interaction policy");
  assert.match(handRig, /makeInteractionHandMesh\("left"\)/);
  assert.match(handRig, /makeInteractionHandMesh\("right"\)/);
  assert.match(handRig, /leftHand\.add\(panelAnchor\)/, "the text-panel anchor is parented to the left hand");
  assert.match(handRig, /makeFinalReviewTextTexture\(beat/, "the preview panel renders the selected beat text");
  assert.match(handRig, /new THREE\.PlaneGeometry\(/, "the hand anchor owns a visible panel surface");
  assert.match(handRig, /depthTest:\s*false/, "scene objects cannot occlude the reader-attached preview text panel");
  assert.match(handRig, /depthWrite:\s*false/, "the transparent panel does not write an opaque depth mask");
  assert.match(handRig, /panel\.renderOrder = READER_UI_RENDER_ORDER/,
    "the preview panel renders after story geometry");
  assert.match(handRig, /group,[\s\S]*panelAnchor,[\s\S]*textPanel/, "the persistent hand rig exposes its panel objects");
  assert.doesNotMatch(handRig, /viewer\.kind !== "direct"/, "the baseline reader is not limited to Direct manipulation");
  assert.match(initializer, /(?:readerRig|spatialReaderRig|interactionReaderRig)/, "the spatial reader is stored separately from policy overlays");
  assert.doesNotMatch(initializer, /addInheritedTextComfortLayer\(/, "no detached world-space text panel remains in the initial scene");
  assert.doesNotMatch(cumulativeUpdate, /addInheritedTextComfortLayer\(/, "beat updates keep using the hand-attached panel");
});

test("in-beat interaction records stay exact for base and variant scenes", () => {
  const normalizeSpatialTransform = (value = {}, fallback = {}) => ({
    position: [...(value?.position || fallback?.position || [0, 0, 0])],
    quaternion: [...(value?.quaternion || fallback?.quaternion || [0, 0, 0, 1])],
    scale: [...(value?.scale || fallback?.scale || [1, 1, 1])],
  });
  const interactionFiniteNumber = (value, fallback, min, max) => {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  };
  const interactionTransformEulerDegrees = () => [0, 0, 0];
  const model = Function(
    "normalizeSpatialTransform",
    "interactionFiniteNumber",
    "interactionTransformEulerDegrees",
    `
      ${functionSource("interactionInBeatSceneKey")}
      ${functionSource("interactionInBeatSceneMatches")}
      ${functionSource("interactionInBeatTargetKey")}
      ${functionSource("interactionInBeatFiniteArray")}
      ${functionSource("interactionInBeatOrderedRange")}
      ${functionSource("normalizeInteractionInBeatConstraints")}
      ${functionSource("normalizeInteractionInBeatTarget")}
      ${functionSource("interactionInBeatTargetsWithoutOverlap")}
      ${functionSource("normalizeInteractionInBeatRecord")}
      ${functionSource("normalizeInteractionInBeatInteractions")}
      return {
        normalize: normalizeInteractionInBeatInteractions,
        sceneKey: interactionInBeatSceneKey,
        matches: interactionInBeatSceneMatches,
        targetKey: interactionInBeatTargetKey,
      };
    `,
  )(normalizeSpatialTransform, interactionFiniteNumber, interactionTransformEulerDegrees);
  const identity = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
  const records = model.normalize([
    {
      beatId: "beat-1",
      targets: [
        {
          entityId: "whole-entity",
          assetId: "whole.glb",
          oneHandGrabbable: true,
          twoHandScalable: false,
          initialTransform: identity,
        },
        {
          entityId: "invalid-entity",
          assetId: "invalid.glb",
          oneHandGrabbable: false,
          twoHandScalable: false,
          initialTransform: identity,
        },
      ],
    },
    {
      beatId: "beat-1",
      variantGroupId: "beat-1-variants",
      variantOptionId: "variant-a",
      targets: [
        {
          entityId: "path-entity",
          assetId: "parts.glb",
          nodePath: "Root/Handle",
          oneHandGrabbable: true,
          twoHandScalable: false,
          initialTransform: identity,
          constraints: { position: { min: [-1, 0, 0], max: [1, 0, 0] } },
        },
        {
          entityId: "index-entity",
          assetId: "indexed.glb",
          nodeIndex: 7,
          oneHandGrabbable: false,
          twoHandScalable: true,
          initialTransform: identity,
          constraints: { scale: { min: [0.5, 0.5, 0.5], max: [2, 2, 2] } },
        },
      ],
    },
  ]);

  assert.deepEqual(records.map(({ sceneKey, beatId, variantGroupId, variantOptionId }) => ({
    sceneKey,
    beatId,
    ...(variantOptionId ? { variantGroupId, variantOptionId } : {}),
  })), [
    { sceneKey: "beat:beat-1", beatId: "beat-1" },
    {
      sceneKey: "beat:beat-1:group:beat-1-variants:variant:variant-a",
      beatId: "beat-1",
      variantGroupId: "beat-1-variants",
      variantOptionId: "variant-a",
    },
  ]);
  assert.equal(records[0].targets.length, 1, "targets with no affordance are not persisted");
  assert.deepEqual(records[1].targets.map(model.targetKey), ["path-entity|path:Root/Handle", "index-entity|node:7"]);
  assert.equal(model.matches(records[0], { beatId: "beat-1" }), true);
  assert.equal(model.matches(records[0], { beatId: "beat-1", variantOptionId: "variant-a" }), false);
  assert.equal(model.matches(records[1], {
    beatId: "beat-1",
    variantGroupId: "beat-1-variants",
    variantOptionId: "variant-a",
  }), true);
  assert.equal(model.sceneKey({ beatId: "beat-1" }), "beat:beat-1");
  assert.equal(
    model.sceneKey({ beatId: "beat-1", variantGroupId: "beat-1-variants", variantOptionId: "variant-a" }),
    "beat:beat-1:group:beat-1-variants:variant:variant-a",
  );
  assert.equal(model.targetKey({ entityId: "whole-entity" }), "whole-entity|whole");
  assert.equal(model.targetKey({ entityId: "path-entity", nodePath: "Root/Handle" }), "path-entity|path:Root/Handle");
  assert.equal(model.targetKey({ entityId: "index-entity", nodePath: "Root/Mesh", nodeIndex: 7 }), "index-entity|node:7");
});

test("the exact GLB hierarchy exposes whole-object, node-path, and node-index candidates", () => {
  const loader = functionSource("loadSpatialRelationsGlb");
  const register = functionSource("registerInteractionInBeatTargetCandidate");
  const registerParts = functionSource("registerInteractionInBeatGltfParts");
  const nodeIndex = functionSource("interactionGltfNodeIndex");
  const groups = functionSource("interactionInBeatCandidateGroups");
  const rows = functionSource("interactionInBeatCandidateRows");
  const expandGroup = functionSource("expandInteractionInBeatCandidateGroup");
  const picker = functionSource("refreshInteractionInBeatTargetPicker");
  const add = functionSource("addInteractionInBeatCandidate");

  assert.match(loader, /registerInteractionInBeatTargetCandidate\(viewer, \{[\s\S]*entityId,[\s\S]*assetId: assetLink\.assetId,[\s\S]*object: authorWrapper/,
    "the Spatial Relations GLB wrapper is available as a whole-object target");
  assert.match(loader, /registerInteractionInBeatGltfParts\(viewer, \{[\s\S]*sceneRoot: gltf\.scene,[\s\S]*parser: gltf\.parser/,
    "loaded GLB nodes are registered against their parser associations");
  assert.ok(
    loader.indexOf("attachSpatialUpstreamPlayback(viewer, entry, gltf);")
      < loader.indexOf("registerInteractionInBeatGltfParts(viewer, {"),
    "animated GLB parts capture their initial transform after the exact beat hold pose is applied",
  );
  assert.match(register, /candidate\.nodePath \? \{ nodePath: String\(candidate\.nodePath\) \} : \{\}/);
  assert.match(register, /candidate\.nodeIndex != null \? \{ nodeIndex: Number\(candidate\.nodeIndex\) \} : \{\}/);
  assert.match(register, /viewer\.interactionTargetCandidates\.set\(key, normalized\)/);
  assert.match(nodeIndex, /parser\?\.associations\?\.get\?\.\(object\)/);
  assert.match(nodeIndex, /association\?\.nodes/);
  assert.match(registerParts, /sourcePartNodePath\(object, sceneRoot\)/);
  assert.match(registerParts, /if \(!nodePath && nodeIndex == null\) return/);
  assert.match(registerParts, /nodePath,[\s\S]*nodeIndex != null \? \{ nodeIndex \} : \{\}/);
  assert.match(groups, /groupsByEntity/);
  assert.match(groups, /leftPart - rightPart/, "each whole GLB is listed before its own parts");
  assert.match(rows, /interactionInBeatCandidateGroups\(viewer\)\.flatMap/);
  const groupCandidates = Function(`${groups}\nreturn interactionInBeatCandidateGroups;`)();
  const grouped = groupCandidates({
    interactionTargetCandidates: new Map([
      ["bull-part", { entityId: "bull", assetId: "bull.glb", nodePath: "Shark", label: "bull.glb · Shark" }],
      ["blacktip-eye", { entityId: "blacktip", assetId: "blacktip.glb", nodePath: "Eye", label: "blacktip.glb · Eye" }],
      ["bull-whole", { entityId: "bull", assetId: "bull.glb", label: "bull.glb" }],
      ["blacktip-whole", { entityId: "blacktip", assetId: "blacktip.glb", label: "blacktip.glb" }],
      ["blacktip-body", { entityId: "blacktip", assetId: "blacktip.glb", nodePath: "Body", label: "blacktip.glb · Body" }],
    ]),
  });
  assert.deepEqual(
    grouped.map((group) => group.candidates.map((candidate) => candidate.label)),
    [
      ["blacktip.glb", "blacktip.glb · Body", "blacktip.glb · Eye"],
      ["bull.glb", "bull.glb · Shark"],
    ],
    "parts remain directly beneath the corresponding whole GLB instead of collecting in a global part list",
  );
  assert.match(picker, /part \? "GLB part" : "Whole GLB"/);
  assert.match(picker, /interaction-inbeat-candidate-children/);
  assert.match(source, /interactionExpandedInBeatCandidateGroups: new Set\(\)/);
  assert.match(source, /state\.interactionExpandedInBeatCandidateGroups\.clear\(\)/,
    "opening an Interaction scene starts with every GLB group folded");
  assert.match(picker, /<details class="interaction-inbeat-candidate-parts"[\s\S]*\$\{expanded \? "open" : ""\}/);
  assert.match(picker, /<summary>\$\{partRows\.length\} GLB part/);
  assert.match(picker, /details\.addEventListener\("toggle"/);
  assert.match(expandGroup, /state\.interactionExpandedInBeatCandidateGroups\.add\(key\)/,
    "selecting a part from the viewport reveals its folded parent group");
  assert.match(picker, /candidate\.nodePath \|\| `Node \$\{candidate\.nodeIndex\}`/,
    "nested rows use the part path without repeating the parent GLB label");
  assert.match(picker, /state\.interactionSelectedInBeatTargetKey[\s\S]*scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/,
    "the synchronized target list reveals the target selected from the viewport");
  assert.match(add, /candidate\.nodePath \? \{ nodePath: candidate\.nodePath \} : \{\}/);
  assert.match(add, /candidate\.nodeIndex != null \? \{ nodeIndex: candidate\.nodeIndex \} : \{\}/);
  assert.match(add, /coordinateSpace: "local"/);
});

test("in-beat viewport clicks resolve the deepest visible candidate and select without duplication", () => {
  const candidateForObjectSource = functionSource("interactionInBeatCandidateForObject");
  const visibleSource = functionSource("interactionInBeatHitObjectIsVisible");
  const selectSource = functionSource("selectInteractionInBeatCandidateFromViewer");
  const picking = functionSource("initializeInteractionInBeatViewportPicking");
  const initializer = functionSource("initializeInteractionControlViewer");
  const dispose = functionSource("disposeInteractionControlViewer");
  const candidateForObject = (configuredTargets, viewer, object) => Function("configuredTargets", "viewer", "object", `
    function interactionInBeatTargetKey(target) {
      return target ? String(target.entityId) + "|" + (target.nodePath ? "path:" + target.nodePath : "whole") : "";
    }
    function interactionInBeatTargetsForContext() { return configuredTargets; }
    ${candidateForObjectSource}
    return interactionInBeatCandidateForObject(viewer, object);
  `)(configuredTargets, viewer, object);
  const hitObjectIsVisible = Function(`${visibleSource}\nreturn interactionInBeatHitObjectIsVisible;`)();

  const scene = { visible: true, parent: null };
  const whole = { visible: true, parent: scene };
  const part = { visible: true, parent: whole };
  const leaf = { visible: true, parent: part };
  const unregistered = { visible: true, parent: scene };
  const hiddenParent = { visible: false, parent: scene };
  const hiddenLeaf = { visible: true, parent: hiddenParent };
  const wholeCandidate = { entityId: "model", assetId: "model.glb" };
  const partCandidate = { entityId: "model", assetId: "model.glb", nodePath: "Root/Handle" };
  const resolverViewer = {
    scene,
    interactionTargetCandidateByObject: new WeakMap([
      [whole, wholeCandidate],
      [part, partCandidate],
    ]),
  };

  assert.equal(candidateForObject([], resolverViewer, leaf), partCandidate,
    "without a configured ancestor, walking outward from the hit leaf chooses the deepest registered GLB part");
  assert.equal(candidateForObject([wholeCandidate], resolverViewer, leaf), wholeCandidate,
    "a configured whole-object ancestor remains selected instead of being silently replaced by its child part");
  assert.equal(candidateForObject([partCandidate], resolverViewer, leaf), partCandidate);
  assert.equal(candidateForObject([], resolverViewer, whole), wholeCandidate);
  assert.equal(candidateForObject([], resolverViewer, unregistered), null);
  assert.equal(candidateForObject([], resolverViewer, null), null);
  assert.equal(hitObjectIsVisible(resolverViewer, leaf), true);
  assert.equal(hitObjectIsVisible(resolverViewer, hiddenLeaf), false,
    "a hidden hit or hidden ancestor is not selectable");
  assert.equal(hitObjectIsVisible(resolverViewer, null), false);

  const configured = [];
  const state = { interactionSelectedInBeatTargetKey: null, interactionViewerCameraState: null };
  const calls = { add: 0, render: 0, capture: 0, events: [] };
  const selectCandidate = Function("state", "configured", "calls", `
    function interactionInBeatTargetKey(target) {
      return target ? String(target.entityId) + "|" + (target.nodePath ? "path:" + target.nodePath : "whole") : "";
    }
    function interactionInBeatTargetsForContext() { return configured; }
    function addInteractionInBeatCandidate(candidate) {
      calls.add += 1;
      calls.events.push("add");
      configured.push(candidate);
      state.interactionSelectedInBeatTargetKey = interactionInBeatTargetKey(candidate);
      return true;
    }
    function captureInteractionViewerCameraState() {
      calls.capture += 1;
      calls.events.push("capture");
      return { camera: calls.capture };
    }
    function expandInteractionInBeatCandidateGroup() {}
    function renderPreservingScroll() { calls.render += 1; calls.events.push("render"); }
    ${selectSource}
    return selectInteractionInBeatCandidateFromViewer;
  `)(state, configured, calls);
  const inBeatViewer = { editorContext: { targetType: "in-beat", sceneContext: { beatId: "beat-1" } } };

  assert.equal(selectCandidate(inBeatViewer, partCandidate), true);
  assert.equal(calls.add, 1);
  assert.equal(configured.length, 1);
  assert.equal(state.interactionSelectedInBeatTargetKey, "model|path:Root/Handle");
  assert.deepEqual(calls.events, ["capture", "add"],
    "camera state is captured before adding a target triggers rerender");
  assert.deepEqual(state.interactionViewerCameraState, { camera: 1 });
  state.interactionSelectedInBeatTargetKey = "other|whole";
  calls.events.length = 0;
  assert.equal(selectCandidate(inBeatViewer, partCandidate), true);
  assert.equal(calls.add, 1, "an already configured target is selected without being added twice");
  assert.equal(configured.length, 1);
  assert.equal(calls.render, 1);
  assert.equal(state.interactionSelectedInBeatTargetKey, "model|path:Root/Handle");
  assert.deepEqual(calls.events, ["capture", "render"],
    "camera state is captured before selecting an existing target rerenders");
  assert.deepEqual(state.interactionViewerCameraState, { camera: 2 });
  calls.events.length = 0;
  assert.equal(selectCandidate(inBeatViewer, partCandidate), true);
  assert.equal(calls.render, 1, "selecting the active target is a no-op");
  assert.deepEqual(calls.events, []);
  assert.equal(selectCandidate({ editorContext: { targetType: "boundary" } }, wholeCandidate), false);
  assert.equal(calls.add, 1);

  assert.match(candidateForObjectSource, /const configuredKeys = new Set\(interactionInBeatTargetsForContext\(viewer\?\.editorContext\?\.sceneContext\)/);
  assert.match(candidateForObjectSource, /let deepestCandidate = null;[\s\S]*let current = object \|\| null/);
  assert.match(candidateForObjectSource, /interactionTargetCandidateByObject\?\.get\?\.\(current\)[\s\S]*deepestCandidate \|\|= candidate;[\s\S]*configuredKeys\.has\(interactionInBeatTargetKey\(candidate\)\)[\s\S]*return candidate/);
  assert.match(candidateForObjectSource, /current = current\.parent \|\| null;[\s\S]*return deepestCandidate/);
  assert.match(visibleSource, /while \(current && current !== viewer\?\.scene\)[\s\S]*current\.visible === false[\s\S]*return false/);
  assert.match(selectSource, /viewer\?\.editorContext\?\.targetType !== "in-beat"/);
  assert.match(selectSource, /interactionInBeatTargetsForContext\(viewer\.editorContext\.sceneContext\)[\s\S]*\.some\(\(target\) => interactionInBeatTargetKey\(target\) === key\)/);
  assert.match(selectSource, /if \(!configured\) \{[\s\S]*state\.interactionViewerCameraState = captureInteractionViewerCameraState\(\);[\s\S]*return addInteractionInBeatCandidate\(candidate\)/);
  assert.match(selectSource, /state\.interactionSelectedInBeatTargetKey = key;[\s\S]*state\.interactionViewerCameraState = captureInteractionViewerCameraState\(\);[\s\S]*renderPreservingScroll\(\)/);

  assert.match(initializer, /initializeInteractionInBeatViewportPicking\(viewer\)/,
    "the picker is installed after the exact scene assets settle");
  assert.match(picking, /viewer\?\.editorContext\?\.targetType !== "in-beat"[\s\S]*viewer\.interactionInBeatPickPointerDownHandler/);
  assert.match(picking, /const clickMovementThresholdSquared = 36/);
  assert.match(picking, /event\.button !== 0[\s\S]*event\.isPrimary === false/);
  assert.match(picking, /viewer\.draggingInteraction[\s\S]*viewer\.transformControls\?\.dragging[\s\S]*viewer\.transformControls\?\.axis[\s\S]*viewer\.controls\?\.enabled === false/);
  assert.match(picking, /pointerId: event\.pointerId,[\s\S]*clientX: event\.clientX,[\s\S]*clientY: event\.clientY/);
  assert.match(picking, /gesture\.pointerId !== event\.pointerId/,
    "move and release handling stays scoped to the pointer that began the click");
  assert.match(picking, /deltaX \* deltaX \+ deltaY \* deltaY > clickMovementThresholdSquared/);
  assert.match(picking, /const moved = gesture\.moved \|\| deltaX \* deltaX \+ deltaY \* deltaY > clickMovementThresholdSquared/);
  assert.match(picking, /raycaster\.intersectObjects\(viewer\.spatialPickTargets \|\| \[\], true\)/,
    "raycasting traverses the exact loaded scene hierarchy recursively");
  assert.match(picking, /interactionInBeatHitObjectIsVisible\(viewer, candidateHit\.object\)/);
  assert.match(picking, /interactionInBeatCandidateForObject\(viewer, hit\?\.object\)/);
  assert.match(picking, /selectInteractionInBeatCandidateFromViewer\(viewer, candidate\)/);
  assert.match(picking, /canvas\.addEventListener\("pointerdown", viewer\.interactionInBeatPickPointerDownHandler\)/);
  assert.match(picking, /window\.addEventListener\("pointermove", viewer\.interactionInBeatPickPointerMoveHandler\)/);
  assert.match(picking, /window\.addEventListener\("pointerup", viewer\.interactionInBeatPickPointerUpHandler\)/);
  assert.match(picking, /window\.addEventListener\("pointercancel", viewer\.interactionInBeatPickPointerCancelHandler\)/);

  assert.match(dispose, /removeEventListener\("pointermove", interactionViewer\.interactionInBeatPickPointerMoveHandler\)/);
  assert.match(dispose, /removeEventListener\("pointerup", interactionViewer\.interactionInBeatPickPointerUpHandler\)/);
  assert.match(dispose, /removeEventListener\("pointercancel", interactionViewer\.interactionInBeatPickPointerCancelHandler\)/);
  assert.match(dispose, /removeEventListener\("pointerdown", interactionViewer\.interactionInBeatPickPointerDownHandler\)/);
  assert.match(dispose, /interactionViewer\.interactionInBeatPickGesture = null/);
});

test("authors can toggle grab and scale affordances and enable only compatible transform ranges", () => {
  const controls = functionSource("renderInteractionInBeatTargetControls");
  const modes = functionSource("interactionInBeatConstraintModes");
  const binder = functionSource("bindInteractionInBeatEditorEvents");

  assert.match(controls, /data-interaction-inbeat-capability="oneHandGrabbable"/);
  assert.match(controls, /data-interaction-inbeat-capability="twoHandScalable"/);
  assert.match(controls, /data-interaction-inbeat-constraint-toggle="position"[\s\S]*target\.oneHandGrabbable/);
  assert.match(controls, /data-interaction-inbeat-constraint-toggle="rotation"[\s\S]*target\.oneHandGrabbable/);
  assert.match(controls, /data-interaction-inbeat-constraint-toggle="scale"[\s\S]*target\.twoHandScalable/);
  assert.match(modes, /target\.oneHandGrabbable && constraints\.position \? \{ mode: "translate"/);
  assert.match(modes, /target\.oneHandGrabbable && constraints\.rotation \? \{ mode: "rotate"/);
  assert.match(modes, /target\.twoHandScalable && constraints\.scale \? \{ mode: "scale"/);
  assert.match(binder, /\[data-interaction-inbeat-capability\]/);
  assert.match(binder, /\["oneHandGrabbable", "twoHandScalable"\]\.includes\(capability\)/);
  assert.match(binder, /target\[capability\] = input\.checked/);
  assert.match(binder, /!target\.oneHandGrabbable[\s\S]*delete target\.constraints\.position[\s\S]*delete target\.constraints\.rotation/);
  assert.match(binder, /!target\.twoHandScalable[\s\S]*delete target\.constraints\.scale/);
  assert.match(binder, /An interactable needs one-hand grab, two-hand scale, or both/,
    "the final enabled affordance cannot be unchecked accidentally");
});

test("min and max interaction constraints render two cloned GLB ghosts with local transforms", () => {
  const editor = functionSource("renderInteractionInBeatEditor");
  const ranges = functionSource("renderInteractionInBeatRangeInputs");
  const endpointTransform = functionSource("interactionConstraintEndpointLocalTransform");
  const endpointColor = functionSource("interactionConstraintEndpointColor");
  const ghostMaterial = functionSource("makeInteractionConstraintGhostMaterial");
  const ghost = functionSource("makeInteractionConstraintGhost");
  const gizmo = functionSource("initializeInteractionInBeatConstraintGizmo");
  const initializeGizmo = functionSource("initializeInteractionConfigurationGizmo");
  const binder = functionSource("bindInteractionInBeatEditorEvents");

  const transformForEndpoint = Function("THREE", `
    function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
    ${functionSource("normalizeSpatialTransform")}
    ${endpointTransform}
    return interactionConstraintEndpointLocalTransform;
  `)(THREE);
  const target = {
    initialTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    constraints: {
      position: { min: [-2, -1, 0], max: [3, 4, 5] },
      rotation: { minDegrees: [-20, -10, 0], maxDegrees: [30, 40, 50] },
      scale: { min: [0.5, 0.75, 1], max: [2, 2.5, 3] },
    },
  };
  const minimum = transformForEndpoint(target, "min");
  const maximum = transformForEndpoint(target, "max");

  assert.match(editor, /\["min", "max"\]\.map\(\(endpoint\)/);
  assert.match(editor, /data-interaction-constraint-endpoint="\$\{endpoint\}"/);
  assert.match(editor, /data-interaction-constraint-transform-mode/);
  assert.match(editor, /minimum limit, teal ghost/);
  assert.match(editor, /maximum limit, orange ghost/);
  assert.match(editor, /Teal Minimum and orange Maximum ghosts stay visible together/);
  assert.match(ranges, /\[\["min", "Min", minValues\], \["max", "Max", maxValues\]\]/);
  assert.match(ranges, /data-interaction-inbeat-range-endpoint="\$\{endpoint\}"/);
  assert.match(endpointTransform, /requestedEndpoint === "max" \? "max" : "min"/);
  assert.match(endpointTransform, /target\?\.constraints\?\.position[\s\S]*\[endpoint\]/);
  assert.match(endpointTransform, /target\.constraints\.rotation\[`\$\{endpoint\}Degrees`\]/);
  assert.match(endpointTransform, /target\.constraints\.scale\[endpoint\]/);
  assert.deepEqual(minimum.position, [-2, -1, 0]);
  assert.deepEqual(maximum.position, [3, 4, 5]);
  assert.deepEqual(minimum.scale, [0.5, 0.75, 1]);
  assert.deepEqual(maximum.scale, [2, 2.5, 3]);
  assert.deepEqual(
    new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...minimum.quaternion), "XYZ").toArray().slice(0, 3)
      .map((value) => Math.round(THREE.MathUtils.radToDeg(value))),
    [-20, -10, 0],
  );
  assert.deepEqual(
    new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...maximum.quaternion), "XYZ").toArray().slice(0, 3)
      .map((value) => Math.round(THREE.MathUtils.radToDeg(value))),
    [30, 40, 50],
  );

  assert.match(endpointColor, /endpoint === "max" \? 0xc75f1f : 0x007f73/,
    "maximum is orange and minimum is teal");
  assert.match(ghostMaterial, /interactionConstraintEndpointColor\(endpoint\)/);
  assert.match(ghostMaterial, /sourceMaterial\?\.clone\?\.\(\)/,
    "ghost materials are cloned instead of mutating the loaded GLB");
  assert.match(ghost, /cloneSkinnedObject\(candidate\.object\)/,
    "the visible handle is the actual GLB or selected GLB part");
  assert.match(ghost, /StoryVR \$\{endpoint\} interaction constraint ghost/);
  assert.match(ghost, /endpoint === "max" \? "Maximum" : "Minimum"/);
  assert.match(ghost, /interactionConstraintEndpoint:\s*endpoint/);
  assert.match(ghost, /pickTargets:\s*\[handle\]/,
    "hidden helper labels do not remain as interaction targets");
  assert.match(initializeGizmo, /viewer\.editorContext\?\.targetType === "in-beat"[\s\S]*initializeInteractionInBeatConstraintGizmo\(viewer\)/);
  assert.match(gizmo, /for \(const endpoint of \["min", "max"\]\)/);
  assert.match(gizmo, /viewer\.interactionConstraintGhosts\.set\(endpoint, ghost\)/);
  assert.match(gizmo, /viewer\.interactionConstraintGhostPickTargets\.push\(\.\.\.ghost\.pickTargets\)/);
  assert.match(gizmo, /viewer\.interactionConstraintGhosts\.size !== 2/);
  assert.match(gizmo, /new TransformControls\(viewer\.camera, viewer\.renderer\.domElement\)/);
  assert.match(gizmo, /transformControls\.setMode\(state\.interactionConstraintTransformMode\)/);
  assert.match(gizmo, /transformControls\.setSpace\("local"\)/,
    "part constraints remain in their parent-local coordinate system");
  assert.match(gizmo, /activateInteractionConstraintEndpoint\(viewer, state\.interactionConstraintEndpoint\)/,
    "only the active endpoint receives the transform handles");
  assert.match(binder, /state\.interactionConstraintEndpoint = "max"/,
    "a newly enabled, coincident range starts with the maximum ghost active");
});

test("viewport ghost picking switches endpoints before ordinary GLB selection", () => {
  const picking = functionSource("initializeInteractionInBeatViewportPicking");
  const endpointForObject = functionSource("interactionConstraintEndpointForObject");
  const endpointFromHits = functionSource("interactionConstraintEndpointFromHits");
  const activate = functionSource("activateInteractionConstraintEndpoint");
  const binder = functionSource("bindInteractionInBeatEditorEvents");
  const stateForTest = { interactionConstraintEndpoint: "min" };
  const resolveEndpoint = Function("state", `
    ${endpointForObject}
    ${endpointFromHits}
    return interactionConstraintEndpointFromHits;
  `)(stateForTest);
  const scene = { parent: null };
  const minRoot = { userData: { interactionConstraintEndpoint: "min" }, parent: scene };
  const maxRoot = { userData: { interactionConstraintEndpoint: "max" }, parent: scene };
  const minMesh = { userData: {}, parent: minRoot };
  const maxMesh = { userData: {}, parent: maxRoot };
  const viewer = {
    scene,
    interactionConstraintGhosts: new Map([["min", {}], ["max", {}]]),
  };

  assert.equal(resolveEndpoint(viewer, [{ object: minMesh }]), "min");
  assert.equal(resolveEndpoint(viewer, [{ object: maxMesh }]), "max");
  assert.equal(resolveEndpoint(viewer, [{ object: minMesh, distance: 1 }, { object: maxMesh, distance: 1 }]), "max",
    "when coincident ghosts are both hit, the inactive endpoint wins");
  stateForTest.interactionConstraintEndpoint = "max";
  assert.equal(resolveEndpoint(viewer, [{ object: minMesh, distance: 1 }, { object: maxMesh, distance: 1 }]), "min");
  assert.equal(resolveEndpoint(viewer, [{ object: maxMesh, distance: 1 }, { object: minMesh, distance: 1.2 }]), "max",
    "a visibly nearer endpoint wins even when it is already active");
  assert.equal(resolveEndpoint(viewer, [{ object: { userData: {}, parent: scene } }]), null);

  const ghostRaycast = picking.indexOf("viewer.interactionConstraintGhostPickTargets");
  const sceneRaycast = picking.indexOf("viewer.spatialPickTargets");
  assert.ok(ghostRaycast >= 0 && sceneRaycast > ghostRaycast,
    "ghosts are raycast before scene candidates so a ghost click cannot select underlying geometry");
  assert.match(picking, /if \(ghostEndpoint\)[\s\S]*activateInteractionConstraintEndpoint\(viewer, ghostEndpoint\);[\s\S]*return;/);
  assert.match(endpointFromHits, /Math\.abs\(inactive\[1\] - ordered\[0\]\[1\]\) <= 1e-4/,
    "inactive preference is limited to effectively coincident endpoint hits");
  assert.match(endpointFromHits, /return ordered\[0\]\[0\]/, "otherwise the nearest ghost keeps priority");
  assert.match(activate, /state\.interactionConstraintEndpoint = endpoint/);
  assert.match(activate, /viewer\.transformControls\.attach\(ghost\.handle\)/);
  assert.match(activate, /syncInteractionConstraintEndpointControls\(endpoint\)/,
    "the toolbar and numeric rows follow a viewport-picked ghost without a rerender");
  assert.match(binder, /if \(!activateInteractionConstraintEndpoint\(interactionViewer, endpoint\)\)/,
    "toolbar endpoint buttons use the same switching path as viewport picking");
});

test("GLB part ghosts exclude external skeletons and dispose only cloned skeleton resources", () => {
  const externalSkeleton = functionSource("interactionGltfPartHasExternalSkeleton");
  const registerParts = functionSource("registerInteractionInBeatGltfParts");
  const ghost = functionSource("makeInteractionConstraintGhost");
  const clear = functionSource("clearInteractionConstraintGhosts");
  const hasExternalSkeleton = Function(`${externalSkeleton}\nreturn interactionGltfPartHasExternalSkeleton;`)();
  const externalBone = { name: "ExternalBone" };
  const unsafeMesh = { isSkinnedMesh: true, skeleton: { bones: [externalBone] } };
  const unsafeGroup = {
    traverse(callback) {
      callback(this);
      callback(unsafeMesh);
    },
  };
  const internalBone = { name: "InternalBone" };
  const safeMesh = { isSkinnedMesh: true, skeleton: { bones: [internalBone] } };
  const safeGroup = {
    traverse(callback) {
      callback(this);
      callback(internalBone);
      callback(safeMesh);
    },
  };

  assert.equal(hasExternalSkeleton(unsafeGroup), true);
  assert.equal(hasExternalSkeleton(safeGroup), false);
  assert.match(registerParts, /if \(interactionGltfPartHasExternalSkeleton\(object\)\) return/,
    "a named group cannot be offered when cloning it would leave skinned meshes bound to bones outside the part");
  assert.match(ghost, /const skeletons = new Set\(\)/);
  assert.match(ghost, /node\.isSkinnedMesh && node\.skeleton[\s\S]*skeletons\.add\(node\.skeleton\)/);
  assert.match(ghost, /skeletons,/);
  assert.match(clear, /for \(const skeleton of record\.skeletons \|\| \[\]\) skeleton\.dispose\?\.\(\)/,
    "SkeletonUtils-created skeletons are released with their ghost handles");
});

test("dual ghost dragging refreshes the movement volume and cleans up owned resources safely", () => {
  const rangeVisual = functionSource("makeInteractionConstraintRangeVisual");
  const refreshRange = functionSource("refreshInteractionConstraintRangeVisual");
  const gizmo = functionSource("initializeInteractionInBeatConstraintGizmo");
  const syncInputs = functionSource("syncInteractionInBeatRangeInputsFromViewer");
  const clear = functionSource("clearInteractionConstraintGhosts");
  const dispose = functionSource("disposeInteractionControlViewer");

  assert.match(rangeVisual, /new THREE\.BoxGeometry\(1, 1, 1\)/);
  assert.match(rangeVisual, /new THREE\.EdgesGeometry\(geometry\)/);
  assert.match(rangeVisual, /new THREE\.LineBasicMaterial\(\{[^}]*depthWrite:\s*false/s,
    "range edges do not occlude the actual GLB or either ghost");
  assert.match(rangeVisual, /object\.raycast = \(\) => \{\}/,
    "the movement volume never steals ghost or GLB picking");
  assert.match(refreshRange, /target\.constraints\?\.position[\s\S]*state\.interactionConstraintTransformMode === "translate"/);
  assert.match(refreshRange, /interactionInBeatOrderedRange\(minLocal, maxLocal\)/);
  assert.match(refreshRange, /\(value \+ ordered\.max\[index\]\) \/ 2/);
  assert.match(refreshRange, /Math\.max\(0\.012, ordered\.max\[index\] - value\)/,
    "reversed or zero-width endpoints still produce a visible non-negative box");
  assert.match(refreshRange, /visual\.group\.matrix\.copy\(candidate\.object\.parent\?\.matrixWorld \|\| new THREE\.Matrix4\(\)\)/,
    "the range box follows the target parent's local axes");

  assert.match(gizmo, /transformControls\.addEventListener\("mouseDown"[\s\S]*beginAuthorHistory\("Edit in-beat interaction range", "interaction-control"\)/);
  assert.match(gizmo, /transformControls\.addEventListener\("objectChange"[\s\S]*syncInteractionInBeatRangeInputsFromViewer\(viewer\);[\s\S]*refreshInteractionConstraintRangeVisual\(viewer\)/,
    "numeric fields and the range volume update continuously while a ghost moves");
  assert.match(gizmo, /const activeGhost = transformControls\.object/);
  assert.match(gizmo, /activeGhost\?\.userData\?\.interactionConstraintEndpoint === "max" \? "max" : "min"/,
    "mouse-up persists the endpoint belonging to the dragged ghost");
  assert.match(gizmo, /nextTarget\.constraints\.position\[endpoint\] = local\.position\.map/);
  assert.match(gizmo, /nextTarget\.constraints\.rotation\[`\$\{endpoint\}Degrees`\]/);
  assert.match(gizmo, /nextTarget\.constraints\.scale\[endpoint\]/);
  assert.match(gizmo, /if \(viewer\.destinationHistoryStarted && changed\) commitAuthorHistory\(\)/);
  assert.match(syncInputs, /const endpoint = proxy\.userData\?\.interactionConstraintEndpoint === "max" \? "max" : "min"/);

  assert.match(clear, /record\.handle\?\.removeFromParent\(\)/);
  assert.match(clear, /for \(const material of record\.materials \|\| \[\]\) material\.dispose\?\.\(\)/);
  assert.match(clear, /for \(const geometry of record\.ownedGeometries \|\| \[\]\) geometry\.dispose\?\.\(\)/);
  assert.doesNotMatch(clear, /disposeObject\(record\.handle\)|record\.handle\?\.traverse[\s\S]*geometry\.dispose/,
    "SkeletonUtils clones share source geometry, so clearing handles must not dispose the loaded GLB geometry");
  assert.match(clear, /viewer\.interactionConstraintGhosts\?\.clear\?\.\(\)/);
  assert.match(clear, /viewer\.interactionConstraintGhostPickTargets = \[\]/);
  assert.match(clear, /viewer\.interactionConstraintRangeVisual = null/);
  assert.match(dispose, /clearInteractionConstraintGhosts\(interactionViewer\)/,
    "viewer disposal clears cloned materials and owned range resources before scene teardown");
});

test("numeric Min and Max edits clamp at the opposite endpoint instead of swapping ghost roles", () => {
  const binder = functionSource("bindInteractionInBeatEditorEvents");
  assert.match(binder, /const oppositeProperty = channel === "rotation"[\s\S]*endpoint === "min" \? "max" : "min"/);
  assert.match(binder, /const requested = Number\(input\.value\)/);
  assert.match(binder, /const opposite = Number\(range\[oppositeProperty\]\[axis\]\)/);
  assert.match(binder, /range\[property\]\[axis\] = endpoint === "min"[\s\S]*Math\.min\(requested, opposite\)[\s\S]*Math\.max\(requested, opposite\)/,
    "a Min typed above Max clamps to Max, while a Max typed below Min clamps to Min");
  assert.doesNotMatch(binder, /\[range\[property\],\s*range\[oppositeProperty\]\]\s*=/,
    "the endpoint records are never exchanged behind the user's back");
});

test("Interaction Control uses a story canvas with incoming-boundary connectors and per-boundary overrides", () => {
  const connector = functionSource("renderInteractionBoundaryConnector");
  const preview = functionSource("renderInteractionPreview");
  assert.match(functionSource("renderInteractionStoryCanvas"), /data-interaction-story-canvas-viewport/);
  assert.match(functionSource("renderInteractionStoryCard"), /data-interaction-open-scene/);
  assert.match(connector, /data-interaction-boundary-id/);
  assert.match(connector, /<select/);
  assert.match(connector, /data-interaction-boundary-policy/);
  assert.match(
    connector,
    /const options = \["button-step", "direct", "embodied-control"\];[\s\S]*options\.map\(\(kind\)[\s\S]*interactionControlKindLabel\(kind\)/,
    "the arrow dropdown exposes the requested three authorable choices",
  );
  assert.doesNotMatch(connector, /\["branching-control",/, "legacy Branching is not authorable from the new dropdown");
  assert.match(connector, /<option value="" selected disabled>/, "unassigned and legacy records remain readable as disabled status placeholders");
  assert.match(connector, /Branching selection \(legacy\)/, "a saved legacy Branching policy is preserved without making it a new choice");
  const boundaryContext = functionSource("interactionBoundaryContext");
  assert.match(boundaryContext, /interactionProgressionEdges\(\)\.flatMap\(\(edge\)/, "boundaries come from authored graph routes");
  assert.match(boundaryContext, /const boundaryId = edge\.id;/, "each progression route keeps its exact edge identity");
  assert.match(boundaryContext, /fromContext = sourceGraphTransitionSceneContext\(edge\.from\)/);
  assert.match(boundaryContext, /toContext = sourceGraphTransitionSceneContext\(edge\.to\)/);
  assert.doesNotMatch(preview, /renderInteractionBoundaryEditor\(boundary\)|interaction-policy-options/, "the spatial preview no longer owns policy selection");
  assert.match(functionSource("interactionBoundaryOverridesPayload"), /policy: canonicalInteractionPolicy/);
});

test("Direct destinations enumerate only authored in-beat targets and are incomplete until placed", () => {
  const directTargetsSource = functionSource("interactionDirectSceneTargets");
  const normalize = functionSource("normalizeInteractionConfiguration");
  const directEditor = functionSource("renderInteractionDirectEditor");
  const rangeViolationsSource = functionSource("interactionDirectDestinationRangeViolations");
  const scaleReachabilitySource = functionSource("interactionDirectScaleDestinationIsReachable");
  const destinationReachabilitySource = functionSource("interactionDirectDestinationIsReachable");
  const rangeMessage = functionSource("interactionDirectDestinationRangeMessage");
  const directDestination = functionSource("makeInteractionDirectDestination");
  const editorBinder = functionSource("bindInteractionOptionEditorEvents");
  const gizmo = functionSource("initializeInteractionConfigurationGizmo");
  const completeness = functionSource("interactionConfigurationIsComplete");
  const configuredTargets = [{
    entityId: "marked-glb",
    assetId: "marked.glb",
    nodePath: "Root/Handle",
    oneHandGrabbable: true,
    twoHandScalable: false,
    constraints: { position: { min: [-1, 0, 0], max: [1, 0, 0] } },
    initialTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
  }];
  const directTargets = Function("configuredTargets", `
    function lockedSpatialRelationsContract() { return {}; }
    function spatialEditorSceneEntities() {
      return [
        { id: "marked-glb", type: "glb", label: "Marked GLB" },
        { id: "unmarked-glb", type: "glb", label: "Unmarked GLB" },
        { id: "image", type: "image-plane", label: "Image" },
      ];
    }
    function spatialEntityType(entity) { return entity.type; }
    function interactionInBeatTargetsForContext() { return configuredTargets; }
    function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
    function spatialRelationEntityLabel(entity) { return entity.label; }
    ${directTargetsSource}
    return interactionDirectSceneTargets({ beatId: "beat-1" });
  `)(configuredTargets);
  const directReachability = Function("THREE", `
    ${functionSource("normalizeSpatialTransform")}
    ${functionSource("interactionEulerDegreesNearReference")}
    ${functionSource("interactionRotationRangeReference")}
    ${functionSource("interactionTransformEulerDegrees")}
    ${rangeViolationsSource}
    ${scaleReachabilitySource}
    ${destinationReachabilitySource}
    return {
      directRangeViolations: interactionDirectDestinationRangeViolations,
      directScaleDestinationIsReachable: interactionDirectScaleDestinationIsReachable,
      directDestinationIsReachable: interactionDirectDestinationIsReachable,
    };
  `)(THREE);
  const {
    directRangeViolations,
    directScaleDestinationIsReachable,
    directDestinationIsReachable,
  } = directReachability;
  const configurationIsComplete = Function("THREE", `
    function interactionKindForConfiguration(configuration) {
      return configuration?.type === "direct-manipulation" ? "direct" : null;
    }
    ${functionSource("normalizeSpatialTransform")}
    ${functionSource("interactionEulerDegreesNearReference")}
    ${functionSource("interactionRotationRangeReference")}
    ${functionSource("interactionTransformEulerDegrees")}
    ${rangeViolationsSource}
    ${scaleReachabilitySource}
    ${destinationReachabilitySource}
    ${completeness}
    return interactionConfigurationIsComplete;
  `)(THREE);
  const readerEulerNearRange = Function("THREE", `
    ${readerFunctionSource("runtimeInteractionEulerDegreesNearRange")}
    return runtimeInteractionEulerDegreesNearRange;
  `)(THREE);
  const constrainedTarget = {
    entityId: "marked-glb",
    assetId: "marked.glb",
    oneHandGrabbable: true,
    twoHandScalable: true,
    destinationAuthored: true,
    destinationTransform: {
      position: [1, -1, 0],
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(20),
        THREE.MathUtils.degToRad(-10),
        THREE.MathUtils.degToRad(30),
        "XYZ",
      )).toArray(),
      scale: [2, 0.5, 1],
    },
    constraints: {
      position: { min: [-1, -1, -1], max: [1, 1, 1] },
      rotation: { minDegrees: [-20, -10, -30], maxDegrees: [20, 10, 30] },
      scale: { min: [0.5, 0.5, 0.5], max: [2, 2, 2] },
    },
  };

  assert.match(directTargetsSource, /interactionInBeatTargetsForContext\(context\)\.map\(\(target\) =>/,
    "the destination source is the exact in-beat contract, not every GLB in Spatial Relations");
  assert.match(directTargetsSource, /target\.nodePath \? \{ nodePath: target\.nodePath \} : \{\}/);
  assert.match(directTargetsSource, /target\.nodeIndex != null \? \{ nodeIndex: target\.nodeIndex \} : \{\}/);
  assert.deepEqual(directTargets.map((target) => ({
    entityId: target.entityId,
    nodePath: target.nodePath,
    oneHandGrabbable: target.oneHandGrabbable,
    twoHandScalable: target.twoHandScalable,
  })), [{
    entityId: "marked-glb",
    nodePath: "Root/Handle",
    oneHandGrabbable: true,
    twoHandScalable: false,
  }]);
  assert.equal(directTargets.some((target) => target.entityId === "unmarked-glb"), false);

  assert.match(normalize, /const available = new Map\(interactionDirectSceneTargets\(context\.sceneContext\)/);
  assert.match(normalize, /const sceneTarget = available\.get\(interactionDirectTargetKey\(target\)\)/);
  assert.match(normalize, /if \(!sceneTarget\) return \[\]/,
    "stale or non-interactable destination records are removed during normalization");
  assert.match(directEditor, /const available = interactionDirectSceneTargets\(editorContext\.sceneContext\)/);
  assert.match(directEditor, /data-interaction-direct-target="\$\{escapeHtml\(targetKey\)\}"/);
  assert.match(directEditor, /selectedTarget\.destinationAuthored === false/);
  assert.match(directEditor, /!interactionDirectDestinationIsReachable\(configuredTarget\)/);
  assert.match(directEditor, /outside-range/);
  assert.match(directEditor, /interaction-direct-range-warning/);
  assert.match(rangeMessage, /outside the authored/);
  assert.match(rangeMessage, /Minimum and Maximum ghosts/);
  assert.match(rangeMessage, /reader scales evenly in every direction/);
  assert.match(directDestination, /const outsideRange = !interactionDirectDestinationIsReachable\(target\)/);
  assert.match(directDestination, /outsideRange \? 0xb12e4b/,
    "an unreachable destination is visibly red in the spatial editor");
  assert.match(editorBinder, /destinationTransform: cloneJson\(sceneTarget\.sourceTransform\),[\s\S]*destinationAuthored: false/,
    "adding a destination requires a deliberate placement edit");
  assert.match(editorBinder, /if \(directTarget\) directTarget\.destinationAuthored = true/);
  assert.match(gizmo, /target\.destinationTransform = transform;[\s\S]*target\.destinationAuthored = true/);
  assert.match(completeness, /kind === "direct"[\s\S]*configuration\.targets\.length > 0[\s\S]*destinationAuthored !== false[\s\S]*interactionDirectDestinationIsReachable\(target\)/);

  assert.deepEqual(directRangeViolations(constrainedTarget), [],
    "values exactly on each authored endpoint remain reachable");
  assert.deepEqual(directRangeViolations({
    ...constrainedTarget,
    destinationTransform: { ...constrainedTarget.destinationTransform, position: [1.01, 0, 0] },
  }), [{ channel: "movement", axis: 0 }]);
  assert.deepEqual(directRangeViolations({
    ...constrainedTarget,
    destinationTransform: {
      ...constrainedTarget.destinationTransform,
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(45), 0, "XYZ")).toArray(),
    },
  }), [{ channel: "rotation", axis: 1 }]);
  assert.deepEqual(directRangeViolations({
    ...constrainedTarget,
    destinationTransform: { ...constrainedTarget.destinationTransform, scale: [2.01, 1, 1] },
  }), [{ channel: "scale", axis: 0 }]);
  assert.deepEqual(directRangeViolations({
    ...constrainedTarget,
    oneHandGrabbable: false,
    destinationTransform: {
      ...constrainedTarget.destinationTransform,
      position: [99, 99, 99],
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, "XYZ")).toArray(),
    },
  }), [], "channels without a reader capability do not make the destination unreachable");
  assert.deepEqual(directRangeViolations({
    ...constrainedTarget,
    twoHandScalable: false,
    destinationTransform: { ...constrainedTarget.destinationTransform, scale: [99, 99, 99] },
  }), [], "scale is ignored when two-hand scaling is disabled");

  const y170Quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    0,
    THREE.MathUtils.degToRad(170),
    0,
    "XYZ",
  ));
  const y170Target = {
    oneHandGrabbable: true,
    twoHandScalable: false,
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: y170Quaternion.toArray(),
      scale: [1, 1, 1],
    },
    constraints: {
      rotation: { minDegrees: [-5, 165, -5], maxDegrees: [5, 175, 5] },
    },
  };
  assert.deepEqual(directRangeViolations(y170Target), [],
    "the editor unwraps an equivalent XYZ Euler representation near the authored 170-degree range");
  assert.deepEqual(
    readerEulerNearRange(y170Quaternion, { min: [-5, 165, -5], max: [5, 175, 5] })
      .map((value) => Math.round(value)),
    [0, 170, 0],
    "the reader clamps against the same nearby Euler representation instead of snapping Y=170 to Y=10",
  );
  assert.match(readerFunctionSource("clampRuntimeInteractionLogicalTransform"), /runtimeInteractionEulerDegreesNearRange\(quaternion, constraints\.rotation\)/);

  const scaleTarget = {
    oneHandGrabbable: false,
    twoHandScalable: true,
    initialTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 2, 4],
    },
    constraints: {
      scale: {
        min: [0.5, 1.4, 3.6],
        max: [2, 5, 12],
      },
    },
  };
  const atScale = (scale) => ({
    ...scaleTarget,
    destinationAuthored: true,
    destinationTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale,
    },
  });
  assert.equal(directScaleDestinationIsReachable(atScale([1.5, 3, 6])), true,
    "one common ratio from the initial nonuniform scale is reachable");
  assert.equal(directScaleDestinationIsReachable(atScale(scaleTarget.constraints.scale.min)), true,
    "the exact Minimum ghost remains an accepted endpoint");
  assert.equal(directScaleDestinationIsReachable(atScale(scaleTarget.constraints.scale.max)), true,
    "the exact Maximum ghost remains an accepted endpoint");
  const insideBoxButNonuniform = atScale([1.5, 3.2, 6]);
  assert.deepEqual(directRangeViolations(insideBoxButNonuniform), [],
    "the nonuniform destination is numerically inside every per-axis box limit");
  assert.equal(directScaleDestinationIsReachable(insideBoxButNonuniform), false,
    "but one two-hand gesture cannot produce different X, Y, and Z ratios");
  assert.equal(directDestinationIsReachable(insideBoxButNonuniform), false);
  assert.match(readerFunctionSource("updateRuntimeDirectManipulation"), /scale\.startLogical\.scale\.clone\(\)\.multiplyScalar\(ratio\)/,
    "reader two-hand scaling applies one uniform ratio on every frame");

  assert.equal(configurationIsComplete("direct", { type: "direct-manipulation", targets: [] }), false);
  assert.equal(configurationIsComplete("direct", {
    type: "direct-manipulation",
    targets: [{ destinationAuthored: false }],
  }), false);
  assert.equal(configurationIsComplete("direct", {
    type: "direct-manipulation",
    targets: [{ destinationAuthored: true }],
  }), true);
  assert.equal(configurationIsComplete("direct", {
    type: "direct-manipulation",
    targets: [{
      ...constrainedTarget,
      destinationTransform: { ...constrainedTarget.destinationTransform, position: [5, 0, 0] },
    }],
  }), false, "an authored destination outside its movement range is still incomplete");
  assert.equal(configurationIsComplete("direct", {
    type: "direct-manipulation",
    targets: [insideBoxButNonuniform],
  }), false, "an inside-box destination remains incomplete when no common two-hand ratio can reach it");
  assert.equal(configurationIsComplete("direct", {
    type: "direct-manipulation",
    targets: [{}],
  }), true, "legacy destinations without the new flag remain authored");
});

test("Controller button press leaves the 3D preview scene unchanged", () => {
  assert.match(functionSource("interactionControlKindLabel"), /Controller button press/);
  assert.doesNotMatch(functionSource("renderInteractionActionControls"), /data-interaction-action="next"|data-interaction-action="previous"/);
  assert.doesNotMatch(functionSource("addInteractionControlOverlays"), /makeInteractionButton\("Back"|makeInteractionButton\("Next"/);
  assert.match(functionSource("previewDescriptionCueSpecs"), /if \(componentId === "interaction-control"\)[\s\S]*return \[\];/);
});

test("Interaction Control preserves upstream playback without adding interaction idle motion", () => {
  const initializer = functionSource("initializeInteractionControlViewer");
  const updater = functionSource("animateInteractionControlViewer");
  const sourceAttach = functionSource("attachInteractionUpstreamPlayback");
  const sourceUpdate = functionSource("updateInteractionUpstreamPlayback");
  const embodiedRig = functionSource("addEmbodiedProgressionReaderRig");
  const embodiedStart = functionSource("startEmbodiedProgressionReader");
  const embodiedUpdate = functionSource("updateEmbodiedProgressionReader");

  assert.match(initializer, /usesInheritedSourcePlayback\) updateInteractionUpstreamPlayback\(viewer, delta\)[\s\S]*else if \(animateNarrativeSingleAnchorViewer\(viewer, delta\)\) return/, "real source playback takes precedence over the synthetic fallback");
  assert.match(sourceAttach, /attachSourceTransitionPlayback/, "the selected boundary reuses the canonical source Transition contract");
  assert.match(sourceAttach, /mode === "shared-timeline"[\s\S]*applySourcePartMask\(gltf\.scene, \[\]\)/, "shared-timeline playback retains contract-owned scene visibility");
  assert.match(sourceUpdate, /seekSourceTransitionPlayback/, "the inherited source transition advances in the Interaction preview");
  assert.match(updater, /!viewer\.usesInheritedSourcePlayback && geometryKind/, "synthetic Dynamics are used only when no source playback contract exists");
  assert.doesNotMatch(updater, /Math\.sin|manipulationProxy/, "direct assets and action targets have no idle animation");
  assert.match(embodiedRig, /playing:\s*false[\s\S]*progress:\s*0[\s\S]*startedAt:\s*null/, "locomotion begins in a static state");
  assert.match(embodiedStart, /rig\.playing = rig\.requiresLocomotion/, "locomotion starts only through the explicit control");
  assert.match(embodiedUpdate, /const moving = rig\.playing && rawProgress < 1/, "walking motion stops after the requested traversal");
  assert.match(source, /Saved Dynamics and Transition playback remain visible\./);
});

test("Locomotion mode is stored on the selected boundary override", () => {
  assert.match(source, /ensureInteractionBoundaryOverrides\(\)\[boundaryId\] = \{/);
  assert.match(functionSource("interactionLocomotionMode"), /boundary \|\| proposal\?\.interactionBoundary/);
});

test("mapped boundaries begin unassigned while unmapped boundaries use controller button press by default", () => {
  const beats = [
    { id: "beat-1", title: "First" },
    { id: "beat-2", title: "Second" },
    { id: "beat-3", title: "Third" },
  ];
  const mappedEdge = progressionEdge(
    "progression:beat-1:variant-a->beat-2",
    { beatId: "beat-1", variantGroupId: "beat-1-variants", variantOptionId: "variant-a" },
    { beatId: "beat-2" },
  );
  const unmappedEdge = progressionEdge(
    "progression:beat-2->beat-3",
    { beatId: "beat-2" },
    { beatId: "beat-3" },
  );
  const mapped = boundaryRecordForEdge(mappedEdge, {
    mappedTransition: true,
    assignmentRequired: true,
    defaultPolicy: null,
    inferredPolicy: null,
    effectivePolicy: null,
    overridden: false,
    reason: "This boundary has a mapped Transition. Assign its reader interaction.",
  });
  const unmapped = boundaryRecordForEdge(unmappedEdge, {
    mappedTransition: false,
    assignmentRequired: false,
    defaultPolicy: "Controller button press",
    inferredPolicy: "Controller button press",
    effectivePolicy: "Controller button press",
    overridden: false,
    reason: "No mapped Transition is available.",
  });
  const context = boundaryContextForTest(beats, new Map([
    [mapped.boundaryId, mapped],
    [unmapped.boundaryId, unmapped],
  ]), {}, [], [mappedEdge, unmappedEdge]);

  assert.equal(context.boundaries[0].boundaryId, mappedEdge.id);
  assert.equal(context.boundaries[0].edgeId, mappedEdge.id);
  assert.deepEqual(context.boundaries[0].fromContext, {
    beatId: "beat-1",
    variantGroupId: "beat-1-variants",
    variantOptionId: "variant-a",
  });
  assert.deepEqual(context.boundaries[0].toContext, { beatId: "beat-2" });
  assert.equal(context.boundaries[0].mappedTransition, true);
  assert.equal(context.boundaries[0].assignmentRequired, true);
  assert.equal(context.boundaries[0].effectivePolicy, null);
  assert.equal(context.boundaries[0].overridden, false);
  assert.equal(context.boundaries[1].mappedTransition, false);
  assert.equal(context.boundaries[1].assignmentRequired, false);
  assert.equal(context.boundaries[1].defaultPolicy, "Controller button press");
  assert.equal(context.boundaries[1].effectivePolicy, "Controller button press");
});

test("all four policies are valid explicit assignments on mapped and unmapped boundaries", () => {
  const beats = [
    { id: "beat-1", title: "First" },
    { id: "beat-2", title: "Second" },
  ];
  const edge = progressionEdge(
    "progression:beat-1:variant-a->beat-2",
    { beatId: "beat-1", variantGroupId: "beat-1-variants", variantOptionId: "variant-a" },
    { beatId: "beat-2" },
  );
  const mapped = boundaryRecordForEdge(edge, {
    mappedTransition: true,
    assignmentRequired: true,
    defaultPolicy: null,
    inferredPolicy: null,
    effectivePolicy: null,
    overridden: false,
    reason: "Assign an interaction.",
  });
  const unmapped = {
    ...mapped,
    mappedTransition: false,
    assignmentRequired: false,
    defaultPolicy: "Controller button press",
    inferredPolicy: "Controller button press",
    effectivePolicy: "Controller button press",
    reason: "No mapped Transition is available.",
  };
  for (const policy of [
    "Controller button press",
    "Direct manipulation",
    "Reader locomotion",
    "Branching selection",
  ]) {
    for (const record of [mapped, unmapped]) {
      const context = boundaryContextForTest(
        beats,
        new Map([[record.boundaryId, record]]),
        { [record.boundaryId]: { policy } },
        [],
        [edge],
      );
      assert.equal(context.boundaries[0].effectivePolicy, policy);
      assert.equal(context.boundaries[0].overridden, true);
    }
  }
});

test("reset clears mapped assignments and restores unmapped controller button press", () => {
  const beats = [
    { id: "beat-1", title: "First" },
    { id: "beat-2", title: "Second" },
    { id: "beat-3", title: "Third" },
  ];
  const mappedEdge = progressionEdge(
    "progression:beat-1:variant-a->beat-2",
    { beatId: "beat-1", variantGroupId: "beat-1-variants", variantOptionId: "variant-a" },
    { beatId: "beat-2" },
  );
  const unmappedEdge = progressionEdge(
    "progression:beat-2->beat-3",
    { beatId: "beat-2" },
    { beatId: "beat-3" },
  );
  const mapped = boundaryRecordForEdge(mappedEdge, {
    mappedTransition: true,
    assignmentRequired: true,
    defaultPolicy: null,
    inferredPolicy: null,
    effectivePolicy: null,
    overridden: false,
  });
  const unmapped = boundaryRecordForEdge(unmappedEdge, {
    mappedTransition: false,
    assignmentRequired: false,
    defaultPolicy: "Controller button press",
    inferredPolicy: "Controller button press",
    effectivePolicy: "Controller button press",
    overridden: false,
  });
  const overrides = {
    [mapped.boundaryId]: { policy: "Direct manipulation" },
    [unmapped.boundaryId]: { policy: "Branching selection" },
  };
  const context = boundaryContextForTest(
    beats,
    new Map([[mapped.boundaryId, mapped], [unmapped.boundaryId, unmapped]]),
    overrides,
    [mapped.boundaryId, unmapped.boundaryId],
    [mappedEdge, unmappedEdge],
  );

  assert.equal(context.boundaries[0].effectivePolicy, null);
  assert.equal(context.boundaries[0].overridden, false);
  assert.equal(context.boundaries[1].effectivePolicy, "Controller button press");
  assert.equal(context.boundaries[1].overridden, false);
});

test("parallel variant progression routes keep independent interaction assignments", () => {
  const beats = [
    { id: "beat-1", title: "Variant beat" },
    { id: "beat-2", title: "Next beat" },
  ];
  const alphaEdge = progressionEdge(
    "progression:beat-1:alpha->beat-2",
    { beatId: "beat-1", variantGroupId: "beat-1-variants", variantOptionId: "alpha" },
    { beatId: "beat-2" },
  );
  const betaEdge = progressionEdge(
    "progression:beat-1:beta->beat-2",
    { beatId: "beat-1", variantGroupId: "beat-1-variants", variantOptionId: "beta" },
    { beatId: "beat-2" },
  );
  const alpha = boundaryRecordForEdge(alphaEdge, {
    mappedTransition: true,
    assignmentRequired: true,
    defaultPolicy: null,
    inferredPolicy: null,
    effectivePolicy: null,
    overridden: false,
  });
  const beta = boundaryRecordForEdge(betaEdge, {
    mappedTransition: false,
    assignmentRequired: false,
    defaultPolicy: "Controller button press",
    inferredPolicy: "Controller button press",
    effectivePolicy: "Controller button press",
    overridden: false,
  });
  const context = boundaryContextForTest(
    beats,
    new Map([[alpha.edgeId, alpha], [beta.edgeId, beta]]),
    { [alpha.edgeId]: { policy: "Direct manipulation" } },
    [],
    [alphaEdge, betaEdge],
    {
      beatId: "beat-2",
      interactionTargetType: "boundary",
      interactionTargetId: betaEdge.id,
    },
  );

  assert.equal(context.boundaries.length, 2);
  assert.equal(context.boundaries[0].effectivePolicy, "Direct manipulation");
  assert.equal(context.boundaries[1].effectivePolicy, "Controller button press");
  assert.equal(context.boundaries[0].fromContext.variantOptionId, "alpha");
  assert.equal(context.boundaries[1].fromContext.variantOptionId, "beta");
  assert.equal(context.boundary.boundaryId, betaEdge.id, "the requested parallel route remains selected by edge ID");
});

test("within-beat variants always resolve to deterministic previous and next UI buttons", () => {
  const group = {
    id: "sharks",
    beatId: "beat-1",
    control: {
      kind: "previous-next",
      previousLabel: "Previous shark",
      nextLabel: "Next shark",
      wrap: false,
    },
    options: [{ id: "white" }, { id: "tiger" }],
  };
  const resolve = Function("group", `
    function variantGroupForBeat() { return group; }
    ${functionSource("interactionVariantControlForBeat")}
    return interactionVariantControlForBeat({ id: "beat-1" }, new Map());
  `);
  const record = resolve(group);

  assert.equal(record.beatId, "beat-1");
  assert.equal(record.variantGroupId, "sharks");
  assert.equal(record.effectivePolicy, "UI button press");
  assert.equal(record.surface, "text-panel");
  assert.equal(record.selectionMode, "previous-next");
  assert.equal(record.previousLabel, "Previous shark");
  assert.equal(record.nextLabel, "Next shark");
  assert.equal(record.wrap, false);
  assert.deepEqual(record.optionIds, ["white", "tiger"]);
});

test("legacy text-panel selection records display as canonical UI button press", () => {
  const group = {
    id: "sharks",
    beatId: "beat-1",
    control: { kind: "previous-next", wrap: true },
    options: [{ id: "white" }, { id: "tiger" }],
  };
  const resolve = Function("group", `
    function variantGroupForBeat() { return group; }
    ${functionSource("interactionVariantControlForBeat")}
    return interactionVariantControlForBeat({ id: "beat-1" }, new Map([[group.id, {
      beatId: "beat-1",
      variantGroupId: group.id,
      effectivePolicy: "Text panel selection",
      surface: "text-panel",
      selectionMode: "single",
    }]]));
  `);
  const record = resolve(group);

  assert.equal(record.effectivePolicy, "UI button press");
  assert.equal(record.selectionMode, "previous-next");
  assert.match(record.reason, /ray-click backward or forward/i);
});

test("Interaction Control saves only complete manual assignments and never asks for regeneration", () => {
  const canvas = functionSource("renderInteractionControlCanvasWorkspace");
  const complete = functionSource("interactionBoundaryContextIsComplete");
  const variant = functionSource("interactionVariantControlForBeat");

  assert.match(complete, /boundary\.effectivePolicy/);
  assert.match(canvas, /interactionBoundaryContextIsComplete/);
  assert.doesNotMatch(`${canvas}\n${complete}\n${variant}`, /Generate options|Regenerate|stale inference|inference unavailable/i);
  assert.match(variant, /UI button press/);
  assert.match(variant, /Text panel selection/, "legacy records remain readable");
  assert.match(variant, /text-panel/);
  assert.doesNotMatch(source, /function renderInteractionInferenceStaleNotice\(/);
});
