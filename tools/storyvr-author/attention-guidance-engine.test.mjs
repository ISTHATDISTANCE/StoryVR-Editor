import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attentionGuidanceRuntimeContract,
  inferAttentionGuidanceContract,
  inferSpatialRelationsContract,
  validateAttentionGuidanceContract,
} from "./engine.mjs";

const engineSource = await readFile(new URL("./engine.mjs", import.meta.url), "utf8");

function engineFunctionSource(name) {
  const start = engineSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = engineSource.indexOf("\nfunction ", start + 1);
  return engineSource.slice(start, next === -1 ? engineSource.length : next);
}

function classroomFixture() {
  const classroom = { id: "classroom.glb", type: "model", path: "models/classroom.glb" };
  const standalone = { id: "globe.glb", type: "model", path: "models/globe.glb" };
  const graph = {
    beats: [
      { id: "text-only-1", text: "Introductory text before the model.", isTextOnly: true, linkedAssets: [] },
      { id: "slide-1", text: "The full classroom composition appears.", linkedAssets: [classroom] },
      { id: "slide-10", text: "Open both classroom windows.", linkedAssets: [classroom] },
      { id: "standalone", text: "Inspect the globe.", linkedAssets: [standalone] },
    ],
    sourcePartStates: {
      schemaVersion: "storyvr-source-part-states/v1",
      resolvedStates: [
        {
          beatId: "slide-1",
          assetId: classroom.id,
          provenance: "inferred-runtime",
          confidence: 0.85,
          parts: [{
            name: "classroom render set",
            nodePath: "classroom/{classroom_target_*,walls,window_1,window_2}",
            role: "unknown-visible-transform",
            visibilityState: "visible",
            confidence: 0.85,
          }],
          animationTargetSelectors: ["label_scene_fullclass"],
        },
        {
          beatId: "slide-10",
          assetId: classroom.id,
          provenance: "inferred-runtime",
          confidence: 0.85,
          parts: [{
            name: "window_1 and window_2",
            nodePath: "classroom/{window_1,window_2}",
            role: "direct-object-transform",
            visibilityState: "visible",
            confidence: 0.85,
          }],
          animationTargetSelectors: ["label_scene_fullclass"],
          animations: [{ targetParts: ["window_1", "window_2"] }],
        },
      ],
    },
    sourceMotionPlayback: {
      schemaVersion: "storyvr-source-motion-playback/v1",
      assets: [{
        assetId: classroom.id,
        mode: "shared-timeline",
        beatStates: [
          { beatId: "slide-1", presence: "active", localProgress: 0.1 },
          { beatId: "slide-10", presence: "active", localProgress: 0.39 },
        ],
      }],
    },
  };
  const runtime = { assets: [classroom, standalone] };
  const spatialRelations = inferSpatialRelationsContract(graph, runtime, {});
  const decisions = {
    "spatial-relations": { status: "current", savedAt: new Date(0).toISOString(), spatialRelations },
    "environment-enhancement": {
      status: "current",
      savedAt: new Date(0).toISOString(),
      option: {
        optionId: "environment-enhancement-no-added-environment",
        label: "No added environment",
        environmentEnhancementSkipped: true,
        environmentEnhancement: null,
        assetLinks: [],
      },
    },
  };
  return { graph, runtime, decisions };
}

test("classroom inference emits only the two narrow window candidates", () => {
  const { graph, runtime, decisions } = classroomFixture();
  const inferred = inferAttentionGuidanceContract(graph, runtime, decisions);
  assert.equal(inferred.schemaVersion, "storyvr-attention-guidance/v1");
  assert.equal(inferred.coordinateSpace, "spatial-scene");
  assert.deepEqual(inferred.resolvedByBeat["slide-10"].candidates.map((candidate) => candidate.partSelector), [
    "classroom/window_1",
    "classroom/window_2",
  ]);
  assert.ok(inferred.resolvedByBeat["slide-10"].candidates.every((candidate) => (
    candidate.targetKind === "named-renderable-part"
      && candidate.assetId === "classroom.glb"
      && !Object.hasOwn(candidate, "position")
      && !Object.hasOwn(candidate, "inferredPosition")
  )));
  assert.deepEqual(inferred.resolvedByBeat["slide-1"].candidates, [], "the broad classroom selector has no default attention");
  assert.equal(inferred.resolvedByBeat["slide-1"].evaluated, true);
  assert.equal(inferred.resolvedByBeat["slide-1"].reconciliation.status, "unresolved");
  assert.equal(inferred.resolvedByBeat["slide-1"].reconciliation.reviewRequired, false);
  assert.deepEqual(inferred.resolvedByBeat["text-only-1"].candidates, [], "a text-only beat has no default attention");
  assert.equal(inferred.resolvedByBeat["text-only-1"].evaluation.reason, "no-clear-visible-candidates");
  assert.deepEqual(inferred.resolvedByBeat.standalone.candidates.map((candidate) => candidate.targetKind), ["standalone-glb"]);
  assert.deepEqual(inferred.resolvedByBeat["slide-10"].runtimeCandidates, [], "inferred part metadata is not JS runtime evidence");
  assert.equal(inferred.resolvedByBeat["slide-10"].semanticCandidates.length, 2);
  assert.equal(inferred.resolvedByBeat["slide-10"].reconciliation.status, "semantic-only");
  assert.equal(inferred.resolvedByBeat.standalone.reconciliation.status, "semantic-only");

  const repeated = inferAttentionGuidanceContract(graph, runtime, decisions);
  assert.deepEqual(
    repeated.resolvedByBeat["slide-10"].candidates.map((candidate) => candidate.id),
    inferred.resolvedByBeat["slide-10"].candidates.map((candidate) => candidate.id),
    "candidate ids remain stable across inference runs",
  );
});

test("manual standalone targets are limited to GLBs in the saved spatial scene", () => {
  const { graph, runtime, decisions } = classroomFixture();
  const inferred = inferAttentionGuidanceContract(graph, runtime, decisions);
  const slide = inferred.resolvedByBeat["slide-1"];
  assert.deepEqual(slide.candidates, []);
  assert.deepEqual(slide.manualTargetOptions.map((candidate) => [candidate.assetId, candidate.entityId, candidate.targetKind]), [
    ["classroom.glb", "glb:classroom.glb:beat:slide-1", "standalone-glb"],
  ]);

  const manualTarget = structuredClone(slide.manualTargetOptions[0]);
  const edited = structuredClone(inferred);
  edited.resolvedByBeat["slide-1"].candidates = [manualTarget];
  edited.resolvedByBeat["slide-1"].markers = [{
    ...manualTarget,
    inferredPosition: { x: 0, y: 1.5, z: -1 },
    position: { x: 0.25, y: 1.5, z: -1 },
    manual: true,
    provenance: { source: "author-manual-attention-target" },
  }];
  edited.resolvedByBeat["slide-1"].evaluated = true;
  edited.resolvedByBeat["slide-1"].evaluation = { status: "evaluated" };
  const validated = validateAttentionGuidanceContract(edited, inferred);
  assert.deepEqual(validated.resolvedByBeat["slide-1"].candidates.map((candidate) => candidate.id), [manualTarget.id]);
  assert.equal(validated.resolvedByBeat["slide-1"].markers[0].assetId, "classroom.glb");
  assert.equal(validated.resolvedByBeat["slide-1"].markers[0].manual, true);
  const compiled = attentionGuidanceRuntimeContract(validated);
  assert.equal(compiled.resolvedByBeat["slide-1"].markers[0].id, manualTarget.id);
  assert.equal(Object.hasOwn(compiled.resolvedByBeat["slide-1"], "manualTargetOptions"), false);

  const fabricated = structuredClone(edited);
  fabricated.resolvedByBeat["slide-1"].markers[0].id = "attention:out-of-scene";
  fabricated.resolvedByBeat["slide-1"].markers[0].assetId = "outside.glb";
  assert.throws(
    () => validateAttentionGuidanceContract(fabricated, inferred),
    /references an unresolved marker candidate/,
  );
});

function inferredContractFor(graph, runtime) {
  const spatialRelations = inferSpatialRelationsContract(graph, runtime, {});
  return inferAttentionGuidanceContract(graph, runtime, {
    "spatial-relations": { status: "current", spatialRelations },
  });
}

test("Florida-shaped variant keeps an exact semantic GLB when runtime evidence is unscoped and unavailable", () => {
  const blacktip = { id: "blacktip-v2-deadbeef.glb", type: "model", path: "models/blacktip-v2-deadbeef.glb" };
  const bull = { id: "bull-v2-feedface.glb", type: "model", path: "models/bull-v2-feedface.glb" };
  const graph = {
    beats: [
      { id: "species-slide", text: "Blacktip Shark illustration", linkedAssets: [blacktip] },
      { id: "risk-options", text: "Choose a region", linkedAssets: [], variantGroupId: "risk-group" },
    ],
    variantGroups: [{
      id: "risk-group",
      beatId: "risk-options",
      defaultOptionId: "california",
      options: [
        { id: "california", label: "California", text: "California white sharks.", assetIds: [bull.id] },
        {
          id: "florida",
          label: "Florida",
          text: "Florida bites often come from smaller sharks like blacktips; bull sharks cause the worst injuries.",
          assetIds: [blacktip.id],
          evidence: { captureStatus: "unavailable", runtimeAssetIds: [blacktip.id], snapshotIds: ["variant-shot"] },
        },
      ],
    }],
    sourcePartStates: {
      states: [{
        beatId: "species-slide",
        assetId: blacktip.id,
        provenance: "inferred-runtime",
        confidence: 0.55,
        parts: [
          { nodePath: "/Bignose_shark_Eye_L", name: "Bignose_shark_Eye_L", visibilityState: "unknown", confidence: 0.5 },
          { nodePath: "/Bignose_shark", name: "Bignose_shark", visibilityState: "unknown", confidence: 0.52 },
        ],
      }],
      resolvedStates: [{
        beatId: "species-slide",
        assetId: blacktip.id,
        provenance: "inferred-runtime",
        confidence: 0.55,
        parts: [{ nodePath: "/Bignose_shark", name: "Bignose_shark", visibilityState: "unknown", confidence: 0.52 }],
      }],
    },
    sourceMotionPlayback: { assets: [] },
  };
  const inferred = inferredContractFor(graph, { assets: [blacktip, bull] });
  const florida = inferred.resolvedByVariant["beat:risk-options:variant:florida"];
  assert.deepEqual(florida.runtimeCandidates, [], "unavailable and beat-only evidence cannot claim variant runtime focus");
  assert.deepEqual(florida.semanticCandidates.map((candidate) => [candidate.assetId, candidate.partSelector]), [[blacktip.id, null]]);
  assert.equal(florida.reconciliation.status, "semantic-only");
  assert.equal(florida.reconciliation.reviewRequired, true);
  assert.equal(florida.reconciliation.reviewed, true, "suggested targets are accepted without a separate author action");
  assert.equal(florida.evaluation.intentionallyEmpty, false);
});

test("explicit captured variant runtime identity confirms the exact option-linked GLB", () => {
  const alpha = { id: "alpha.glb", type: "model", path: "models/alpha.glb" };
  const beta = { id: "beta.glb", type: "model", path: "models/beta.glb" };
  const graph = {
    beats: [{ id: "choice", text: "Choose", linkedAssets: [], variantGroupId: "choices" }],
    variantGroups: [{
      id: "choices",
      beatId: "choice",
      options: [
        { id: "alpha-option", label: "Alpha", text: "Alpha", assetIds: [alpha.id] },
        {
          id: "beta-option",
          label: "Beta",
          text: "Beta",
          assetIds: [beta.id],
          evidence: { captureStatus: "ok", runtimeAssetIds: [beta.id], runtimeSnapshotIds: ["runtime-beta"] },
        },
      ],
    }],
    sourceMotionPlayback: { assets: [] },
  };
  const inferred = inferredContractFor(graph, { assets: [alpha, beta] });
  const betaScene = inferred.resolvedByVariant["beat:choice:variant:beta-option"];
  assert.deepEqual(betaScene.runtimeCandidates.map((candidate) => candidate.assetId), [beta.id]);
  assert.deepEqual(betaScene.semanticCandidates.map((candidate) => candidate.assetId), [beta.id]);
  assert.equal(betaScene.reconciliation.status, "confirmed");
  assert.equal(betaScene.reconciliation.reviewRequired, false);
});

test("multiple GLBs reconcile a runtime-semantic disagreement as a conflict", () => {
  const bull = { id: "bull.glb", type: "model", path: "models/bull.glb" };
  const tiger = { id: "tiger.glb", type: "model", path: "models/tiger.glb" };
  const graph = {
    beats: [{ id: "compare", text: "Focus on the bull shark.", linkedAssets: [bull, tiger] }],
    sourcePartStates: { resolvedStates: [{
      beatId: "compare",
      assetId: tiger.id,
      provenance: "direct-runtime",
      runtimeVisible: true,
      modelChanged: true,
      confidence: 0.96,
      parts: [],
    }] },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [bull, tiger] }).resolvedByBeat.compare;
  assert.deepEqual(scene.runtimeCandidates.map((candidate) => candidate.assetId), [tiger.id]);
  assert.deepEqual(scene.semanticCandidates.map((candidate) => candidate.assetId), [bull.id]);
  assert.deepEqual(new Set(scene.candidates.map((candidate) => candidate.assetId)), new Set([bull.id, tiger.id]));
  assert.equal(scene.reconciliation.status, "conflict");
  assert.equal(scene.reconciliation.conflicts.length, 1);
});

test("multiple concurrently visible unchanged GLBs do not all become runtime focus targets", () => {
  const bull = { id: "bull.glb", type: "model", path: "models/bull.glb" };
  const tiger = { id: "tiger.glb", type: "model", path: "models/tiger.glb" };
  const graph = {
    beats: [{ id: "many", text: "Focus on the bull shark.", linkedAssets: [bull, tiger] }],
    sourcePartStates: { resolvedStates: [bull, tiger].map((asset) => ({
      beatId: "many", assetId: asset.id, provenance: "direct-runtime", runtimeVisible: true, parts: [],
    })) },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [bull, tiger] }).resolvedByBeat.many;
  assert.deepEqual(scene.runtimeCandidates, []);
  assert.deepEqual(scene.semanticCandidates.map((candidate) => candidate.assetId), [bull.id]);
  assert.equal(scene.reconciliation.status, "semantic-only");
});

test("runtime part changes are narrow and exact part semantics confirm only the changed part", () => {
  const room = { id: "room.glb", type: "model", path: "models/room.glb" };
  const graph = {
    beats: [{ id: "left", text: "Focus on the left window.", linkedAssets: [room] }],
    sourcePartStates: {
      states: [{
        beatId: "metadata",
        assetId: room.id,
        provenance: "inferred-runtime",
        parts: [{ nodePath: "Room/Left_Window", name: "Left_Window", visibilityState: "unknown", confidence: 0.9 }],
      }],
      resolvedStates: [{
      beatId: "left",
      assetId: room.id,
      provenance: "direct-runtime",
      runtimeVisible: true,
      parts: [
        { nodePath: "/Room/Left_Window", name: "Left_Window", visibilityState: "visible", changed: true, runtimeObservationKind: "part-state-change", confidence: 0.96 },
        { nodePath: "/Room/Right_Window", name: "Right_Window", visibilityState: "visible", changed: false, runtimeObservationKind: "visible-part", confidence: 0.96 },
      ],
      }],
    },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [room] }).resolvedByBeat.left;
  assert.deepEqual(scene.runtimeCandidates.map((candidate) => candidate.renderableName), ["Left_Window"]);
  assert.deepEqual(scene.semanticCandidates.map((candidate) => candidate.renderableName), ["Left_Window"]);
  assert.notEqual(scene.runtimeCandidates[0].partSelector, scene.semanticCandidates[0].partSelector, "the channel selectors exercise leading-slash canonicalization");
  assert.equal(scene.reconciliation.status, "confirmed");
});

test("one runtime parent and multiple semantic children reconcile as compatible without an extra-target conflict", () => {
  const house = { id: "house.glb", type: "model", path: "models/house.glb" };
  const graph = {
    beats: [{ id: "windows", text: "Open both windows.", linkedAssets: [house] }],
    sourcePartStates: { resolvedStates: [{
      beatId: "windows",
      assetId: house.id,
      provenance: "direct-runtime",
      runtimeVisible: true,
      modelChanged: true,
      parts: [
        { nodePath: "/House/Window_Left", name: "Window_Left", visibilityState: "visible", confidence: 0.9 },
        { nodePath: "/House/Window_Right", name: "Window_Right", visibilityState: "visible", confidence: 0.9 },
      ],
    }] },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [house] }).resolvedByBeat.windows;
  assert.deepEqual(scene.runtimeCandidates.map((candidate) => candidate.targetKind), ["standalone-glb"]);
  assert.deepEqual(scene.semanticCandidates.map((candidate) => candidate.renderableName).sort(), ["Window_Left", "Window_Right"]);
  assert.equal(scene.candidates.length, 2);
  assert.ok(scene.candidates.every((candidate) => candidate.reconciliationStatus === "compatible"));
  assert.equal(scene.reconciliation.status, "compatible");
  assert.deepEqual(scene.reconciliation.conflicts, []);
});

test("same-named parts under different parents retain full identity for singular and plural semantics", () => {
  const house = { id: "house.glb", type: "model", path: "models/house.glb" };
  const graph = {
    beats: [
      { id: "right-window", text: "Focus on the right window.", linkedAssets: [house] },
      { id: "both-windows", text: "Open both windows.", linkedAssets: [house] },
    ],
    sourcePartStates: { states: [{
      beatId: "part-metadata",
      assetId: house.id,
      provenance: "inferred-runtime",
      parts: [
        { nodePath: "/House/Left/Window", name: "Window", visibilityState: "unknown", confidence: 0.9 },
        { nodePath: "/House/Right/Window", name: "Window", visibilityState: "unknown", confidence: 0.9 },
      ],
      partSelectors: ["Window"],
    }] },
    sourceMotionPlayback: { assets: [] },
  };
  const inferred = inferredContractFor(graph, { assets: [house] });
  assert.deepEqual(
    inferred.resolvedByBeat["right-window"].semanticCandidates.map((candidate) => candidate.partSelector),
    ["/House/Right/Window"],
  );
  assert.deepEqual(
    inferred.resolvedByBeat["both-windows"].semanticCandidates.map((candidate) => candidate.partSelector).sort(),
    ["/House/Left/Window", "/House/Right/Window"],
  );
});

test("semantic named-part metadata remains independent while shared timelines block unsafe whole-GLB fallback", () => {
  const machine = { id: "machine.glb", type: "model", path: "models/machine.glb" };
  const graph = {
    beats: [
      { id: "eye", text: "Inspect the status light.", linkedAssets: [machine] },
      { id: "whole", text: "Inspect the machine.", linkedAssets: [machine] },
    ],
    sourcePartStates: { states: [{
      beatId: "unrelated",
      assetId: machine.id,
      provenance: "inferred-runtime",
      parts: [{ nodePath: "/Machine/Status_Light", name: "Status_Light", visibilityState: "unknown", confidence: 0.8 }],
    }] },
    sourceMotionPlayback: { assets: [{ assetId: machine.id, mode: "shared-timeline", beatStates: [{ beatId: "eye" }, { beatId: "whole" }] }] },
  };
  const inferred = inferredContractFor(graph, { assets: [machine] });
  assert.deepEqual(inferred.resolvedByBeat.eye.runtimeCandidates, []);
  assert.deepEqual(inferred.resolvedByBeat.eye.semanticCandidates.map((candidate) => candidate.renderableName), ["Status_Light"]);
  assert.equal(inferred.resolvedByBeat.eye.reconciliation.status, "semantic-only");
  assert.deepEqual(inferred.resolvedByBeat.whole.candidates, []);
  assert.equal(inferred.resolvedByBeat.whole.reconciliation.status, "unresolved");
  assert.equal(inferred.resolvedByBeat.whole.reconciliation.reviewRequired, false);
  assert.ok(inferred.resolvedByBeat.whole.diagnostics.some((diagnostic) => diagnostic.code === "semantic-standalone-fallback-blocked"));
});

test("runtime focus outside the saved spatial GLBs remains a conflict instead of silently appearing semantic-only", () => {
  const runtimeAsset = { id: "runtime-a.glb", type: "model", path: "models/runtime-a.glb" };
  const semanticAsset = { id: "semantic-b.glb", type: "model", path: "models/semantic-b.glb" };
  const graph = {
    beats: [{ id: "mismatch", text: "Focus on semantic B.", linkedAssets: [semanticAsset] }],
    sourcePartStates: { resolvedStates: [{
      beatId: "mismatch",
      assetId: runtimeAsset.id,
      provenance: "direct-runtime",
      runtimeVisible: true,
      modelChanged: true,
      parts: [],
    }] },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [runtimeAsset, semanticAsset] }).resolvedByBeat.mismatch;
  assert.equal(scene.reconciliation.status, "conflict");
  assert.deepEqual(scene.reconciliation.outOfSceneRuntimeAssetIds, [runtimeAsset.id]);
  assert.equal(scene.reconciliation.reviewRequired, true);
});

test("variant runtime identity survives a text-only host and ignores resolved states from another option", () => {
  const alpha = { id: "alpha.glb", type: "model", path: "models/alpha.glb" };
  const beta = { id: "beta.glb", type: "model", path: "models/beta.glb" };
  const graph = {
    beats: [{ id: "host", kind: "text-only", isTextOnly: true, text: "Choose", linkedAssets: [], variantGroupId: "group" }],
    variantGroups: [{ id: "group", beatId: "host", options: [
      { id: "alpha", label: "Alpha", text: "Alpha", assetIds: [alpha.id] },
      { id: "beta", label: "Beta", text: "Beta", assetIds: [beta.id] },
    ] }],
    sourcePartStates: {
      states: [{
        beatId: "host", variantGroupId: "group", variantOptionId: "beta", assetId: beta.id,
        provenance: "direct-runtime", assetIdentitySource: "exact-runtime-asset", runtimeVisible: true, parts: [],
      }],
      resolvedStates: [{
        beatId: "host", variantGroupId: "group", variantOptionId: "alpha", assetId: alpha.id,
        provenance: "direct-runtime", assetIdentitySource: "exact-runtime-asset", runtimeVisible: true, parts: [],
      }],
    },
    sourceMotionPlayback: { assets: [] },
  };
  const betaScene = inferredContractFor(graph, { assets: [alpha, beta] }).resolvedByVariant["beat:host:variant:beta"];
  assert.deepEqual(betaScene.runtimeCandidates.map((candidate) => candidate.assetId), [beta.id]);
  assert.equal(betaScene.reconciliation.status, "confirmed");
});

test("inferred runtime-root-only identity never claims an exact runtime asset target", () => {
  const shark = { id: "shark.glb", type: "model", path: "models/shark.glb" };
  const graph = {
    beats: [{ id: "shark", text: "Inspect the shark.", linkedAssets: [shark] }],
    sourcePartStates: { resolvedStates: [{
      beatId: "shark",
      assetId: shark.id,
      provenance: "direct-runtime",
      assetIdentitySource: "runtime-root-only",
      runtimeVisible: true,
      modelChanged: true,
      parts: [],
    }] },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [shark] }).resolvedByBeat.shark;
  assert.deepEqual(scene.runtimeCandidates, []);
  assert.equal(scene.reconciliation.status, "semantic-only");
});

test("a render-active-only offscreen GLB cannot confirm a semantic attention target", () => {
  const globe = { id: "globe.glb", type: "model", path: "models/globe.glb" };
  const graph = {
    beats: [{ id: "globe", text: "Inspect the globe.", linkedAssets: [globe] }],
    sourcePartStates: { resolvedStates: [{
      beatId: "globe",
      assetId: globe.id,
      provenance: "direct-runtime",
      assetIdentitySource: "exact-runtime-asset",
      renderActive: true,
      runtimeVisible: false,
      visibilityState: "render-active",
      modelChanged: true,
      parts: [],
    }] },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [globe] }).resolvedByBeat.globe;
  assert.deepEqual(scene.runtimeCandidates, []);
  assert.deepEqual(scene.semanticCandidates.map((candidate) => candidate.assetId), [globe.id]);
  assert.equal(scene.reconciliation.status, "semantic-only");
  assert.equal(scene.reconciliation.reviewRequired, true);
});

test("a sole root renderable falls back to the whole safe GLB instead of false part specificity", () => {
  const nurse = { id: "nurse-v2.glb", type: "model", path: "models/nurse-v2.glb" };
  const graph = {
    beats: [{ id: "nurse", text: "Nurse sharks rest during the day.", linkedAssets: [nurse] }],
    sourcePartStates: { states: [{
      beatId: "other",
      assetId: nurse.id,
      provenance: "inferred-runtime",
      parts: [{ nodePath: "/NurseShark", name: "NurseShark", visibilityState: "unknown", confidence: 0.8 }],
    }] },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [nurse] }).resolvedByBeat.nurse;
  assert.deepEqual(scene.semanticCandidates.map((candidate) => [candidate.targetKind, candidate.partSelector]), [["standalone-glb", null]]);
});

test("captured option runtime assets outside the spatial scene force a conflict", () => {
  const alpha = { id: "alpha.glb", type: "model", path: "models/alpha.glb" };
  const beta = { id: "beta.glb", type: "model", path: "models/beta.glb" };
  const graph = {
    beats: [{ id: "host", text: "Choose", linkedAssets: [], variantGroupId: "group" }],
    variantGroups: [{ id: "group", beatId: "host", options: [
      { id: "one", label: "One", text: "One", assetIds: [alpha.id] },
      {
        id: "two", label: "Two", text: "Two", assetIds: [beta.id],
        evidence: { captureStatus: "ok", runtimeAssetIds: [alpha.id], runtimeSnapshotIds: ["swap"] },
      },
    ] }],
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [alpha, beta] }).resolvedByVariant["beat:host:variant:two"];
  assert.equal(scene.reconciliation.status, "conflict");
  assert.deepEqual(scene.reconciliation.outOfSceneRuntimeAssetIds, [alpha.id]);
});

test("two unchanged direct runtime assets do not become an unambiguous out-of-scene focus", () => {
  const alpha = { id: "alpha.glb", type: "model", path: "models/alpha.glb" };
  const beta = { id: "beta.glb", type: "model", path: "models/beta.glb" };
  const graph = {
    beats: [{ id: "beta", text: "Focus on beta.", linkedAssets: [beta] }],
    sourcePartStates: { resolvedStates: [alpha, beta].map((asset) => ({
      beatId: "beta", assetId: asset.id, provenance: "direct-runtime", runtimeVisible: true, parts: [],
    })) },
    sourceMotionPlayback: { assets: [] },
  };
  const scene = inferredContractFor(graph, { assets: [alpha, beta] }).resolvedByBeat.beta;
  assert.deepEqual(scene.runtimeCandidates, []);
  assert.deepEqual(scene.reconciliation.outOfSceneRuntimeAssetIds, []);
  assert.equal(scene.reconciliation.status, "semantic-only");
});

test("a sole unchanged direct-visible GLB is initial runtime focus only on its first observed beat", () => {
  const globe = { id: "globe.glb", type: "model", path: "models/globe.glb" };
  const graph = {
    beats: [
      { id: "first", text: "Inspect the globe.", linkedAssets: [globe] },
      { id: "later", text: "The globe remains beside the text.", linkedAssets: [globe] },
    ],
    sourcePartStates: { resolvedStates: ["first", "later"].map((beatId) => ({
      beatId,
      assetId: globe.id,
      provenance: "direct-runtime",
      assetIdentitySource: "exact-runtime-asset",
      runtimeVisible: true,
      parts: [],
    })) },
    sourceMotionPlayback: { assets: [] },
  };
  const inferred = inferredContractFor(graph, { assets: [globe] });
  assert.deepEqual(inferred.resolvedByBeat.first.runtimeCandidates.map((candidate) => candidate.assetId), [globe.id]);
  assert.equal(inferred.resolvedByBeat.first.reconciliation.status, "confirmed");
  assert.deepEqual(inferred.resolvedByBeat.later.runtimeCandidates, []);
  assert.equal(inferred.resolvedByBeat.later.reconciliation.status, "semantic-only");
});

test("validation accepts only finite evaluated marker positions and derives exact counts", () => {
  const { graph, runtime, decisions } = classroomFixture();
  const inferred = inferAttentionGuidanceContract(graph, runtime, decisions);
  const edited = structuredClone(inferred);
  const candidateScenes = Object.values(edited.resolvedByBeat).filter((scene) => scene.candidates.length);
  for (const scene of candidateScenes) {
    scene.markers = scene.candidates.map((candidate, index) => ({
      ...candidate,
      inferredPosition: { x: index + 1, y: 1.5, z: -0.25 },
      position: { x: index + 1.25, y: 1.5, z: -0.25 },
      manual: true,
      provenance: { resolver: "posed-visible-bounds" },
    }));
    scene.evaluated = true;
    scene.evaluation = { status: "evaluated", resolvedCandidateCount: 99, rejectedCandidateCount: 99 };
    if (scene.reconciliation.reviewRequired) {
      scene.reconciliation.reviewed = false;
      scene.reconciliation.reviewedAt = null;
    }
  }
  const validated = validateAttentionGuidanceContract(edited, inferred);
  const windows = validated.resolvedByBeat["slide-10"];
  assert.equal(windows.evaluated, true);
  assert.equal(windows.evaluation.resolvedCandidateCount, 2);
  assert.equal(windows.evaluation.rejectedCandidateCount, 0);
  assert.equal(windows.markers[0].coordinateSpace, "spatial-scene");
  assert.equal(windows.markers[0].manual, true);
  assert.equal(windows.reconciliation.reviewed, true);
  assert.equal(windows.reconciliation.reviewedAt, null);

  const invalid = structuredClone(edited);
  invalid.resolvedByBeat["slide-10"].markers[0].inferredPosition.x = null;
  assert.throws(() => validateAttentionGuidanceContract(invalid, inferred), /finite x, y, and z/);
});

test("unevaluated Attention Guidance scenes remain valid optional no-cue runtime scenes", () => {
  const { graph, runtime, decisions } = classroomFixture();
  const inferred = inferAttentionGuidanceContract(graph, runtime, decisions);
  const validated = validateAttentionGuidanceContract(inferred, inferred);
  const scene = validated.resolvedByBeat["slide-10"];

  assert.equal(scene.evaluated, false);
  assert.equal(scene.evaluation.status, "not-evaluated");
  assert.deepEqual(scene.markers, []);

  const compiled = attentionGuidanceRuntimeContract(validated);
  assert.equal(compiled.resolvedByBeat["slide-10"].evaluated, false);
  assert.equal(compiled.resolvedByBeat["slide-10"].evaluation.status, "not-evaluated");
  assert.deepEqual(compiled.resolvedByBeat["slide-10"].markers, []);
});

test("checkpoint readiness accepts optional unevaluated Attention Guidance scenes", () => {
  const { graph, runtime, decisions } = classroomFixture();
  const inferred = inferAttentionGuidanceContract(graph, runtime, decisions);
  const validated = validateAttentionGuidanceContract(inferred, inferred);
  const contractShapeSource = engineFunctionSource("isAttentionGuidanceContractShape");
  const finitePositionShapeSource = engineFunctionSource("finiteAttentionPositionShape");
  const isContractShape = new Function(
    "ATTENTION_GUIDANCE_SCHEMA_VERSION",
    `${finitePositionShapeSource}; ${contractShapeSource}; return isAttentionGuidanceContractShape;`,
  )("storyvr-attention-guidance/v1");

  assert.equal(isContractShape(validated), true);

  const inconsistent = structuredClone(validated);
  inconsistent.resolvedByBeat["slide-10"].evaluation.status = "evaluated";
  assert.equal(isContractShape(inconsistent), false);
});

test("runtime projection strips authoring candidates while preserving evaluated point metadata", () => {
  const { graph, runtime, decisions } = classroomFixture();
  const inferred = inferAttentionGuidanceContract(graph, runtime, decisions);
  const edited = structuredClone(inferred);
  for (const scene of Object.values(edited.resolvedByBeat)) {
    if (!scene.candidates.length) continue;
    scene.markers = scene.candidates.map((candidate, index) => ({
      id: candidate.id,
      inferredPosition: { x: index, y: 1, z: -1 },
      position: { x: index, y: 1, z: -1 },
      manual: false,
    }));
    scene.evaluated = true;
    scene.evaluation = { status: "evaluated" };
  }
  const validated = validateAttentionGuidanceContract(edited, inferred);
  const compiled = attentionGuidanceRuntimeContract(validated);
  assert.equal(compiled.coordinateSpace, "spatial-scene");
  assert.deepEqual(compiled.readerGuidance, {
    schemaVersion: "storyvr-attention-reader-guidance/v1",
    completion: {
      distanceMeters: 3,
      distanceMetric: "viewer-to-target-bounds",
      once: true,
      persistence: "story-session",
    },
    arrow: {
      enabled: true,
      visibility: "outside-view-frustum",
      placement: "camera-edge",
    },
    glow: {
      enabled: true,
      mode: "subtle-additive-overlay",
      opacity: 0.14,
    },
  });
  assert.equal(compiled.resolvedByBeat["slide-10"].evaluated, true);
  assert.equal(compiled.resolvedByBeat["slide-10"].markers[0].coordinateSpace, "spatial-scene");
  assert.equal(compiled.resolvedByBeat["slide-10"].markers[0].targetKind, "named-renderable-part");
  assert.equal(compiled.resolvedByBeat["slide-10"].markers[0].entityId, "glb:classroom.glb:beat:slide-10");
  assert.equal(compiled.resolvedByBeat["slide-10"].markers[0].partSelector, "classroom/window_1");
  assert.equal(JSON.stringify(compiled).includes('"candidates"'), false);
});
