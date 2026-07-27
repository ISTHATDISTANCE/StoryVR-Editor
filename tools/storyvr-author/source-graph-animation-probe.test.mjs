import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyAnimationProbeLinksToGraph,
  compileAuthorRuntime,
  loadAuthorProject,
  saveAttentionGuidanceDecisionDraft,
  saveCheckpointDecision,
  saveEnvironmentEnhancementCheckpoint,
  saveNoEnvironmentEnhancementCheckpoint,
  saveSpatialRelationsDecisionDraft,
  saveStoryGraph,
  saveSourceMotionLinks,
  sourceDynamicsPreviewIndex,
  textComfortDefaultOptionLabelForGraph,
} from "./engine.mjs";

const bedbugAsset = {
  id: "bedbug_static-eed5e7307bac.glb",
  type: "model",
  path: "models/bedbug_static-eed5e7307bac.glb",
  url: "https://static01.nyt.com/newsgraphics/2018/09/27/little-monsters/assets/fb/models/bedbug_static.glb",
  role: "core_story",
};

const bedbugImageAsset = {
  id: "bedbug-photo.jpg",
  type: "texture",
  path: "textures/bedbug-photo.jpg",
  url: "https://static01.nyt.com/newsgraphics/2018/09/27/little-monsters/assets/images/bedbug-photo.jpg",
  role: "core_story",
};

const runtime = {
  slug: "bugs-halloween-kids-ar-ul",
  title: "Monsters That Live On You",
  sourceUrl: "https://www.nytimes.com/interactive/2018/10/25/multimedia/bugs-halloween-kids-ar-ul.html",
  assets: [bedbugAsset],
};

const runtimeWithImage = {
  ...runtime,
  assets: [bedbugAsset, bedbugImageAsset],
};

async function saveAttentionGuidanceForTest(options) {
  const state = await loadAuthorProject(options);
  const attentionGuidance = structuredClone(state.attentionGuidance);
  for (const scene of [
    ...Object.values(attentionGuidance.resolvedByBeat || {}),
    ...Object.values(attentionGuidance.resolvedByVariant || {}),
  ]) {
    scene.markers = [];
    scene.evaluated = true;
    scene.evaluation = {
      status: "evaluated",
      resolvedCandidateCount: 0,
      rejectedCandidateCount: scene.candidates.length,
    };
    if (scene.reconciliation?.reviewRequired) {
      scene.reconciliation.reviewed = true;
      scene.reconciliation.reviewedAt = new Date(0).toISOString();
    }
  }
  await saveAttentionGuidanceDecisionDraft(options, { attentionGuidance });
  await saveCheckpointDecision(options, "attention-guidance");
}

function fixtureGraph() {
  return {
    schemaVersion: "storyvr-source-graph/v1",
    story: {
      slug: runtime.slug,
      title: runtime.title,
      sourceUrl: runtime.sourceUrl,
    },
    atomicBeats: [
      {
        id: "text-only-17",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Bedbug",
        text: "Bedbug",
        linkedAssets: [],
        atomicBeatIds: ["text-only-17"],
      },
      {
        id: "text-only-18",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Bedbugs are monsters of the vampire variety",
        text: "Bedbugs are monsters of the vampire variety: They live to suck your blood. A bedbug likes to hang out where humans sleep, hiding in crevices during the day.",
        linkedAssets: [],
        atomicBeatIds: ["text-only-18"],
      },
      {
        id: "slide-5",
        kind: "slide",
        originalField: "slide",
        isTextOnly: false,
        title: "Bedbugs can enter your home",
        text: "Bedbugs can enter your home through clothing, furniture, luggage, or via plumbing or wires.",
        linkedAssets: [bedbugAsset],
        atomicBeatIds: ["slide-5"],
      },
    ],
    beats: [
      {
        id: "combined-text-only-17-to-text-only-18",
        kind: "text-only",
        subtype: "combined",
        originalField: "authored_beat_group",
        isTextOnly: true,
        isCombined: true,
        title: "Bedbug to Bedbugs are monsters",
        text: "Bedbug\n\nBedbugs are monsters of the vampire variety: They live to suck your blood.",
        linkedAssets: [],
        atomicBeatIds: ["text-only-17", "text-only-18"],
      },
      {
        id: "slide-5",
        kind: "slide",
        originalField: "slide",
        isTextOnly: false,
        title: "Bedbugs can enter your home",
        text: "Bedbugs can enter your home through clothing, furniture, luggage, or via plumbing or wires.",
        linkedAssets: [bedbugAsset],
        atomicBeatIds: ["slide-5"],
      },
    ],
    assetInventory: [bedbugAsset],
    textVisualEvidenceLinks: [],
  };
}

function bugsStyleArtifact() {
  return {
    trustedStoryFolder: true,
    preferred: true,
    mtimeMs: 10,
    artifactPath: "animation_capture_experiement/bugs/analysis/animation-logic-probe/latest/codex-animation-judgment.json",
    judgment: {
      assetJudgments: [
        {
          assetUrl: "https://static01.nyt.com/newsgraphics/2018/09/27/little-monsters/assets/fb/models/bedbug_static.glb",
          assetFile: "bedbug_static-eed5e7307bac.glb",
          classification: "inter-beat-dynamics",
          confidence: 0.83,
          associatedBeats: [
            {
              text: "Bedbugs are monsters of the vampire variety: They live to suck your blood. A bedbug likes to hang out where humans sleep, hiding in crevices during the day.",
              scrollPercent: 45.3,
              source: "inferred",
            },
          ],
          evidenceRefs: ["evidence-117"],
        },
      ],
    },
    evidence: {
      story: {
        slug: runtime.slug,
        url: runtime.sourceUrl,
      },
    },
  };
}

test("promotes bugs-style assetJudgments into text beat links and authored rollups", () => {
  const enriched = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, [bugsStyleArtifact()]);
  const atomic = enriched.atomicBeats.find((beat) => beat.id === "text-only-18");
  const combined = enriched.beats.find((beat) => beat.id === "combined-text-only-17-to-text-only-18");
  const evidence = enriched.textVisualEvidenceLinks.find((link) => link.beatId === combined.id);

  assert.equal(atomic.probePromotedVisual, true);
  assert.equal(atomic.isTextOnly, false);
  assert.equal(atomic.kind, "text-only");
  assert.equal(atomic.linkedAssets[0].id, bedbugAsset.id);
  assert.equal(combined.probePromotedVisual, true);
  assert.equal(combined.isTextOnly, false);
  assert.deepEqual(combined.linkedAssets.map((asset) => asset.id), [bedbugAsset.id]);
  assert.deepEqual(evidence.assetLinks, [bedbugAsset.id]);
  assert.equal(evidence.evidenceSource, "animation-probe");
  assert.equal(enriched.animationProbeLinking.promotedLinkCount, 1);

  const previews = sourceDynamicsPreviewIndex(enriched);
  assert.equal(previews["inter-beat-dynamics"].label, "Transition");
  assert.equal(previews["inter-beat-dynamics"].sourceDynamics.assets[0].classification, "inter-beat-dynamics");
});

test("source graph preserves optional within-beat variant groups without creating narrative branches", () => {
  const graph = fixtureGraph();
  graph.variantGroups = [{
    id: "specimen-selector",
    beatId: "slide-5",
    title: "Choose specimen",
    defaultOptionId: "bedbug",
    control: { kind: "previous-next", wrap: true },
    options: [
      { id: "bedbug", label: "Bedbug", text: "Bedbug details", sourceOrder: 0, assetIds: [bedbugAsset.id] },
      { id: "photo", label: "Photo", text: "Photo details", sourceOrder: 1, asset_ids: [bedbugImageAsset.id] },
    ],
  }];

  const normalized = applyAnimationProbeLinksToGraph(graph, runtimeWithImage, []);
  assert.equal(normalized.variantGroups.length, 1);
  assert.equal(normalized.variantGroups[0].beatId, "slide-5");
  assert.deepEqual(normalized.variantGroups[0].options.map((option) => option.assetIds), [[bedbugAsset.id], [bedbugImageAsset.id]]);
  assert.equal("branches" in normalized.variantGroups[0], false);

  const unchanged = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, []);
  assert.equal("variantGroups" in unchanged, false);
});

test("merges assetJudgments into modelBeatAssociations for source dynamics defaults", () => {
  const artifact = {
    trustedStoryFolder: true,
    preferred: true,
    mtimeMs: 10,
    artifactPath: "animation_capture_experiement/bugs/analysis/animation-logic-probe/latest/codex-animation-judgment.json",
    judgment: {
      modelBeatAssociations: [
        {
          assetUrl: bedbugAsset.url,
          assetFile: bedbugAsset.id,
          hasEmbeddedAnimation: true,
          associationSource: "direct",
          associationConfidence: 0.76,
          associatedBeats: [
            {
              text: "Bedbugs are monsters of the vampire variety: They live to suck your blood. A bedbug likes to hang out where humans sleep, hiding in crevices during the day.",
              source: "direct",
            },
          ],
          reasoning: "The model is directly associated with the bedbug beat.",
        },
      ],
      assetJudgments: [
        {
          assetUrl: bedbugAsset.url,
          assetFile: bedbugAsset.id,
          hasEmbeddedAnimation: true,
          classification: "within-beat-dynamics",
          scrollDriver: { type: "time-based", confidence: 0.78 },
          confidence: 0.81,
          associatedBeats: [
            {
              text: "Bedbugs are monsters of the vampire variety: They live to suck your blood. A bedbug likes to hang out where humans sleep, hiding in crevices during the day.",
              source: "direct",
            },
          ],
          reasoning: "AnimationMixer.update(delta) plays the embedded clip during the active beat.",
          evidenceRefs: ["glbAnimations:bedbug_static-eed5e7307bac.glb"],
        },
      ],
    },
    evidence: {
      story: {
        slug: runtime.slug,
        url: runtime.sourceUrl,
      },
    },
  };

  const enriched = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, [artifact]);
  const atomic = enriched.atomicBeats.find((beat) => beat.id === "text-only-18");
  const link = atomic.animationProbeLinks.find((item) => item.assetId === bedbugAsset.id);

  assert.equal(link.classification, "within-beat-dynamics");
  assert.equal(link.hasEmbeddedAnimation, true);
  assert.equal(link.scrollDriver.type, "time-based");
  assert.equal(link.playbackMode, "loop-within-beat");
  assert.equal(enriched.sourceDynamics.counts.withinBeat, 1);
  assert.equal(enriched.sourceDynamics.defaultOptions["dynamic-geometry"].label, "Simple geometric motion");
  assert.equal(enriched.animationProbeLinking.sourceDynamicsAssetCount, 1);

  const previews = sourceDynamicsPreviewIndex(enriched);
  assert.equal(previews["dynamic-geometry"].label, "Dynamics");
  assert.equal(previews["dynamic-geometry"].sourceDynamics.assets[0].classification, "within-beat-dynamics");
});

test("builds generic per-beat GLB part states and prefers direct runtime capture", () => {
  const artifact = bugsStyleArtifact();
  artifact.judgment.beatRuntimeStates = [{
    beatId: "slide-5",
    text: "Bedbugs can enter your home through clothing, furniture, luggage, or via plumbing or wires.",
    captureStatus: "captured",
    visibleModels: [{
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      visibleParts: [{ name: "DirectBug", nodePath: "bug/DirectBug" }],
      playingAnimations: [{ clipIndex: 0, clipName: "Direct motion", targetParts: ["bug/DirectBug"] }],
    }],
  }];
  artifact.judgment.inferredBeatAssetStates = [{
    beatId: "slide-5",
    text: "Bedbugs can enter your home through clothing, furniture, luggage, or via plumbing or wires.",
    assetFile: bedbugAsset.id,
    assetUrl: bedbugAsset.url,
    parts: [{ name: "InferredBug", nodePath: "bug/InferredBug" }],
    animations: [{ clipIndex: 1, clipName: "Inferred motion", targetParts: ["bug/InferredBug"] }],
  }];

  const graph = fixtureGraph();
  graph.beats.push({
    id: "text-only-after-slide",
    kind: "text-only",
    originalField: "text_only_parts",
    isTextOnly: true,
    title: "After the visual",
    text: "The prior model state remains visible.",
    linkedAssets: [],
    atomicBeatIds: ["text-only-after-slide"],
  });
  const enriched = applyAnimationProbeLinksToGraph(graph, runtime, [artifact]);
  assert.equal(enriched.sourcePartStates.schemaVersion, "storyvr-source-part-states/v1");
  assert.equal(enriched.sourcePartStates.counts.states, 1);
  assert.equal(enriched.sourcePartStates.counts.direct, 1);
  const partState = enriched.sourcePartStates.states[0];
  assert.equal(partState.beatId, "slide-5");
  assert.equal(partState.assetId, bedbugAsset.id);
  assert.equal(partState.provenance, "direct-runtime");
  assert.deepEqual(partState.partSelectors, ["bug/DirectBug", "DirectBug"]);
  assert.deepEqual(partState.animationTargetSelectors, ["bug/DirectBug"]);
  assert.equal(partState.animations[0].clipName, "Direct motion");
  const before = enriched.sourcePartStates.resolvedStates.find((state) => state.beatId === "combined-text-only-17-to-text-only-18");
  const after = enriched.sourcePartStates.resolvedStates.find((state) => state.beatId === "text-only-after-slide");
  assert.equal(before.stateMode, "pre-animation");
  assert.equal(before.playbackMode, "frozen");
  assert.equal(before.freezeProgress, 0);
  assert.equal(before.inheritedFromBeatId, "slide-5");
  assert.equal(after.stateMode, "carry-forward");
  assert.equal(after.playbackMode, "frozen");
  assert.equal(after.freezeProgress, 1);
  assert.equal(after.inheritedFromBeatId, "slide-5");
  assert.deepEqual(after.partSelectors, partState.partSelectors);
});

test("preserves analyzer variant identity and keys runtime part states by option context", () => {
  const graph = fixtureGraph();
  graph.variantGroups = [{
    id: "bedbug-variants",
    beatId: "text-only-17",
    options: [
      { id: "bedbug-still", label: "Still", text: "Still bedbug", assetIds: [bedbugAsset.id] },
      { id: "bedbug-moving", label: "Moving", text: "Moving bedbug", assetIds: [bedbugAsset.id] },
    ],
  }];
  const artifact = bugsStyleArtifact();
  artifact.judgment.beatRuntimeStates = [{
    beatId: "runtime-variant-state",
    text: "Runtime variant state",
    captureStatus: "ok",
    variantGroupId: "bedbug-variants",
    variantOptionId: "bedbug-moving",
    interactionPath: ["bedbug-variants", "bedbug-moving"],
    visibleModels: [{
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      assetIdentitySource: "exact-runtime-asset",
      visibleParts: [{ name: "DirectBug", nodePath: "bug/DirectBug" }],
      partStateChanges: [{ name: "DirectBug", nodePath: "bug/DirectBug", transformChanged: true }],
    }],
  }];
  const enriched = applyAnimationProbeLinksToGraph(graph, runtime, [artifact]);
  const state = enriched.sourcePartStates.states.find((item) => item.variantOptionId === "bedbug-moving");
  assert.ok(state);
  assert.equal(state.beatId, "combined-text-only-17-to-text-only-18");
  assert.equal(state.variantGroupId, "bedbug-variants");
  assert.equal(state.variantOptionId, "bedbug-moving");
  assert.deepEqual(state.interactionPath, ["bedbug-variants", "bedbug-moving"]);
  assert.equal(state.assetIdentitySource, "exact-runtime-asset");
  assert.equal(state.parts.find((part) => part.nodePath === "bug/DirectBug").changed, true);
});

test("saving the spatial prerequisites prepares derived Dynamics and Transition drafts for explicit checkpoint saves", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "storyvr-source-dynamics-"));
  const storyFolder = path.join(tempRoot, "story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const modelsRoot = path.join(resourceFolder, "models");
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const decisionsRoot = path.join(analysisRoot, "decisions");
  const proposalsRoot = path.join(analysisRoot, "proposals");
  await mkdir(metadataRoot, { recursive: true });
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(decisionsRoot, { recursive: true });
  await mkdir(proposalsRoot, { recursive: true });

  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), JSON.stringify({
    story_url: runtime.sourceUrl,
    title: runtime.title,
    slides: [
      { index: 0, text: "Bedbugs are monsters of the vampire variety." },
      { index: 1, text: "Bedbugs can enter your home through clothing and furniture." },
    ],
  }, null, 2));
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), JSON.stringify([
    {
      story_url: runtime.sourceUrl,
      asset_url: bedbugAsset.url,
      final_url: bedbugAsset.url,
      local_path: path.join(modelsRoot, bedbugAsset.id),
      asset_type: "model",
      adaptation_relevance: "core_story",
      source_type: "network_request",
    },
  ], null, 2));

  const graph = fixtureGraph();
  const slide = graph.beats.find((beat) => beat.id === "slide-5");
  slide.animationProbeLinks = [
    {
      assetId: bedbugAsset.id,
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      classification: "within-beat-dynamics",
      hasEmbeddedAnimation: true,
      scrollDriver: { type: "time-based", confidence: 0.78 },
      playbackMode: "loop-within-beat",
      confidence: 0.81,
      reasoning: "AnimationMixer.update(delta) plays the embedded clip during the active beat.",
      evidenceRefs: ["evidence-within"],
    },
    {
      assetId: bedbugAsset.id,
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      classification: "inter-beat-dynamics",
      hasEmbeddedAnimation: true,
      scrollDriver: { type: "local-scroll-window-progress", confidence: 0.8 },
      playbackMode: "segment-at-beat-transition",
      confidence: 0.83,
      reasoning: "Runtime state spans multiple caption beats, so playback belongs at beat boundaries.",
      evidenceRefs: ["evidence-transition"],
    },
  ];
  await writeFile(path.join(analysisRoot, "story-graph.json"), JSON.stringify(graph, null, 2));
  await writeFile(path.join(proposalsRoot, "asset-topology.json"), JSON.stringify({
    schemaVersion: "storyvr-proposal-bundle/v1",
    component: "asset-topology",
    generatedAt: new Date().toISOString(),
    proposals: [{
      component: "asset-topology",
      optionId: "asset-topology-single-anchor",
      label: "Single anchor",
      designDimension: 1,
      description: "Use one active model anchor at a time.",
      sourceEvidence: [],
      assetLinks: [{ assetId: bedbugAsset.id, role: "single anchor" }],
      readerImpact: "The reader sees one anchored source model at a time.",
      risks: [],
      implementationHints: [],
      confidence: 0.9,
    }],
  }, null, 2));

  const options = { storyFolder, resourceFolder };
  let loaded = await loadAuthorProject(options);
  assert.equal(loaded.readiness["spatial-relations"].canGenerate, true);
  assert.equal(loaded.readiness["environment-enhancement"].canGenerate, false);
  assert.equal(loaded.readiness["dynamic-geometry"].canGenerate, false);
  await saveCheckpointDecision(options, "spatial-relations", {
    optionId: loaded.proposals["spatial-relations"].defaultOptionId,
    spatialRelations: loaded.spatialRelations,
  });
  loaded = await loadAuthorProject(options);
  assert.equal(loaded.readiness["environment-enhancement"].canGenerate, true);
  assert.equal(loaded.readiness["dynamic-geometry"].current, false, "Dynamics waits until Environment is saved");
  await saveNoEnvironmentEnhancementCheckpoint(options);
  await saveAttentionGuidanceForTest(options);

  const dynamics = JSON.parse(await readFile(path.join(decisionsRoot, "dynamic-geometry.json"), "utf8"));
  assert.equal(dynamics.schemaVersion, "storyvr-decision/v2");
  assert.equal(dynamics.status, "draft");
  assert.equal(dynamics.savedAt, null);
  assert.equal(Object.hasOwn(dynamics, "locked"), false);
  assert.equal(Object.hasOwn(dynamics, "approvedAt"), false);
  assert.equal(Object.hasOwn(dynamics, "lockUpdatedAt"), false);
  assert.equal(dynamics.option.optionId, "dynamic-geometry-source-dynamics-preview");
  assert.equal(dynamics.option.label, "Dynamics");
  assert.equal(dynamics.option.sourceDynamicsPreview, true);
  assert.equal(Object.hasOwn(dynamics, "autoSavedBy"), false);
  assert.equal(dynamics.inferredBy, "animation-probe");

  const transition = JSON.parse(await readFile(path.join(decisionsRoot, "inter-beat-dynamics.json"), "utf8"));
  assert.equal(transition.schemaVersion, "storyvr-decision/v2");
  assert.equal(transition.status, "draft");
  assert.equal(transition.savedAt, null);
  assert.equal(Object.hasOwn(transition, "locked"), false);
  assert.equal(transition.option.optionId, "inter-beat-dynamics-source-transition-preview");
  assert.equal(transition.option.label, "Transition");
  assert.equal(transition.option.sourceDynamicsPreview, true);
  assert.equal(Object.hasOwn(transition, "autoSavedBy"), false);
  assert.equal(transition.inferredBy, "animation-probe");

  loaded = await loadAuthorProject(options);
  assert.deepEqual(
    pickReadinessState(loaded.readiness["dynamic-geometry"]),
    { status: "draft", current: false, saved: false, stale: false },
  );
  assert.deepEqual(
    pickReadinessState(loaded.readiness["inter-beat-dynamics"]),
    { status: "draft", current: false, saved: false, stale: false },
  );
  assert.equal(loaded.readiness["inter-beat-dynamics"].canGenerate, false);
  assert.equal(loaded.readiness["interaction-control"].unlocked, false);
  assert.equal("canGenerate" in loaded.readiness["interaction-control"], false);
  assert.equal(transition.proposalGeneratedAt, null);

  const savedDynamics = await saveCheckpointDecision(options, "dynamic-geometry", {
    authorEdits: "Reviewed source dynamics.",
  });
  assert.equal(savedDynamics.status, "current");
  assert.match(savedDynamics.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(savedDynamics.authorEdits, "Reviewed source dynamics.");

  loaded = await loadAuthorProject(options);
  assert.equal(loaded.readiness["dynamic-geometry"].current, true);
  assert.equal(loaded.readiness["inter-beat-dynamics"].canGenerate, true);
  assert.equal(loaded.readiness["inter-beat-dynamics"].current, false);
  assert.equal(loaded.readiness["interaction-control"].unlocked, false);
  assert.equal("canGenerate" in loaded.readiness["interaction-control"], false);

  const savedTransition = await saveCheckpointDecision(options, "inter-beat-dynamics");
  assert.equal(savedTransition.status, "current");
  assert.match(savedTransition.savedAt, /^\d{4}-\d{2}-\d{2}T/);

  loaded = await loadAuthorProject(options);
  assert.deepEqual(
    pickReadinessState(loaded.readiness["dynamic-geometry"]),
    { status: "current", current: true, saved: true, stale: false },
  );
  assert.deepEqual(
    pickReadinessState(loaded.readiness["inter-beat-dynamics"]),
    { status: "current", current: true, saved: true, stale: false },
  );
  assert.equal(loaded.readiness["interaction-control"].unlocked, true);
  assert.equal("canGenerate" in loaded.readiness["interaction-control"], false);
});

test("skips preload-based modelBeatAssociations", () => {
  const preloadArtifact = {
    trustedStoryFolder: true,
    preferred: true,
    mtimeMs: 10,
    judgment: {
      modelBeatAssociations: [
        {
          assetFile: bedbugAsset.id,
          assetUrl: bedbugAsset.url,
          associationSource: "inferred-preload-based",
          associationConfidence: 0.42,
          associatedBeats: [{ text: "Bedbugs are monsters of the vampire variety: They live to suck your blood.", source: "inferred-preload-based" }],
        },
      ],
    },
  };

  const enriched = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, [preloadArtifact]);
  const atomic = enriched.atomicBeats.find((beat) => beat.id === "text-only-18");
  assert.equal(atomic.linkedAssets.length, 0);
  assert.equal(enriched.animationProbeLinking, undefined);
});

test("promotes imageBeatAssociations alongside modelBeatAssociations", () => {
  const mixedArtifact = {
    trustedStoryFolder: true,
    preferred: true,
    mtimeMs: 10,
    judgment: {
      modelBeatAssociations: [
        {
          assetFile: bedbugAsset.id,
          assetUrl: bedbugAsset.url,
          associationSource: "inferred-preload-based",
          associationConfidence: 0.42,
          associatedBeats: [{ text: "Bedbugs are monsters of the vampire variety: They live to suck your blood.", source: "inferred-preload-based" }],
        },
      ],
      imageBeatAssociations: [
        {
          imageGroupId: "image-group-1",
          assetUrl: bedbugImageAsset.url,
          urls: [bedbugImageAsset.url],
          associationSource: "direct",
          associationConfidence: 0.91,
          associatedBeats: [
            {
              text: "Bedbugs are monsters of the vampire variety: They live to suck your blood. A bedbug likes to hang out where humans sleep, hiding in crevices during the day.",
              source: "direct",
            },
          ],
          reasoning: "The accepted image caption directly matches the text-only beat.",
          evidenceRefs: ["evidence-image-1"],
        },
      ],
    },
    evidence: {
      story: {
        slug: runtime.slug,
        url: runtime.sourceUrl,
      },
    },
  };

  const enriched = applyAnimationProbeLinksToGraph(fixtureGraph(), runtimeWithImage, [mixedArtifact]);
  const atomic = enriched.atomicBeats.find((beat) => beat.id === "text-only-18");
  const imageLink = atomic.animationProbeLinks.find((link) => link.assetId === bedbugImageAsset.id);
  assert.equal(atomic.probePromotedVisual, true);
  assert.equal(atomic.linkedAssets.some((asset) => asset.id === bedbugImageAsset.id), true);
  assert.equal(imageLink.associationSource, "direct");
  assert.equal(imageLink.classification, "");
  assert.equal(enriched.animationProbeLinking.promotedLinkCount, 1);
});

test("ignores mismatched fallback artifacts without story or asset overlap", () => {
  const mismatched = {
    preferred: false,
    trustedStoryFolder: false,
    mtimeMs: 10,
    judgment: {
      storySlug: "other-story",
      assetJudgments: [
        {
          assetFile: "other.glb",
          assetUrl: "https://example.com/other.glb",
          confidence: 0.9,
          associatedBeats: [{ text: "Unrelated text", source: "direct" }],
        },
      ],
    },
    evidence: { story: { slug: "other-story", url: "https://example.com/other" } },
  };

  const enriched = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, [mismatched]);
  const atomic = enriched.atomicBeats.find((beat) => beat.id === "text-only-18");
  assert.equal(atomic.linkedAssets.length, 0);
  assert.equal(enriched.animationProbeLinking, undefined);
});

test("preserves graph behavior when no matching probe exists", () => {
  const enriched = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, []);
  const combined = enriched.beats.find((beat) => beat.id === "combined-text-only-17-to-text-only-18");
  assert.equal(combined.isTextOnly, true);
  assert.equal(combined.linkedAssets.length, 0);
});

test("normalizes clip and animated-camera tracks with adjacent inferred boundaries", () => {
  const artifact = {
    trustedStoryFolder: true,
    preferred: true,
    artifactPath: "story/analysis/animation-logic-probe/run/codex-animation-judgment.json",
    judgment: {
      engine: { provider: "codex-cli" },
      assetJudgments: [{
        assetFile: bedbugAsset.id,
        assetUrl: bedbugAsset.url,
        hasEmbeddedAnimation: true,
        classification: "inter-beat-dynamics",
        confidence: 0.8,
        associatedBeats: [
          { text: "Bedbugs are monsters of the vampire variety", source: "direct" },
          { text: "Bedbugs can enter your home through clothing", source: "direct" },
        ],
      }],
      modelBeatAssociations: [{
        assetFile: bedbugAsset.id,
        assetUrl: bedbugAsset.url,
        associationSource: "direct",
        associationConfidence: 0.8,
        associatedBeats: [
          { text: "Bedbugs are monsters of the vampire variety", source: "direct" },
          { text: "Bedbugs can enter your home through clothing", source: "direct" },
        ],
      }],
      glbAnimationInterpretations: [{
        assetFile: bedbugAsset.id,
        assetUrl: bedbugAsset.url,
        hasCameraPath: true,
        triggerMapping: { type: "local-scroll-window-progress", confidence: 0.9 },
        clips: [
          {
            animationIndex: 0,
            animationName: "Within",
            role: "direct-object-transform",
            associatedBeats: [{ text: "Bedbugs are monsters of the vampire variety", source: "inferred" }],
            confidence: 0.7,
          },
          {
            animationIndex: 1,
            animationName: "Across",
            role: "direct-object-transform",
            associatedBeats: [
              { text: "Bedbugs are monsters of the vampire variety", source: "inferred" },
              { text: "Bedbugs can enter your home through clothing", source: "inferred" },
            ],
            confidence: 0.75,
          },
          { animationIndex: 2, animationName: "Camera move", role: "camera-path", associatedBeats: [] },
          { animationIndex: 3, animationName: "camera_lookatAction", role: "unknown-control-node", associatedBeats: [] },
        ],
        cameraPath: {
          hasCameraPath: true,
          associatedBeats: [
            { text: "Bedbugs are monsters of the vampire variety", source: "inferred" },
            { text: "Bedbugs can enter your home through clothing", source: "inferred" },
          ],
        },
      }],
    },
    evidence: {
      story: { slug: runtime.slug, url: runtime.sourceUrl },
      glbAnimations: {
        models: [{
          file: bedbugAsset.id,
          assetUrl: bedbugAsset.url,
          cameraCount: 1,
          hasCameraAnimation: true,
          nodes: [{ index: 7, name: "CameraRig", camera: 0 }],
          animations: [
            { index: 0, name: "Within", duration: 1, targetNodeNames: ["Bug"], targetPaths: ["rotation"], cameraChannelCount: 0 },
            { index: 1, name: "Across", duration: 2, targetNodeNames: ["Bug"], targetPaths: ["translation"], cameraChannelCount: 0 },
            { index: 2, name: "Camera move", duration: 3, targetNodeNames: ["CameraRig"], targetPaths: ["translation"], cameraChannelCount: 1 },
            { index: 3, name: "camera_lookatAction", duration: 3, targetNodeNames: ["camera_lookat"], targetPaths: ["translation"], cameraChannelCount: 1 },
          ],
        }],
      },
    },
  };

  const enriched = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, [artifact]);
  const linking = enriched.sourceMotionLinking;
  assert.equal(linking.provider, "codex-cli");
  assert.equal(linking.assignments.length, 4);
  const within = linking.tracks.find((track) => track.id === `${bedbugAsset.id}#clip:0`);
  const across = linking.tracks.find((track) => track.id === `${bedbugAsset.id}#clip:1`);
  const camera = linking.tracks.find((track) => track.id === `${bedbugAsset.id}#camera:0`);
  assert.equal(linking.tracks.some((track) => track.id === `${bedbugAsset.id}#clip:2`), false);
  assert.equal(linking.tracks.some((track) => track.id === `${bedbugAsset.id}#clip:3`), true);
  assert.equal(within.componentId, "dynamic-geometry");
  assert.deepEqual(within.inferred.beatIds, ["combined-text-only-17-to-text-only-18"]);
  assert.equal(across.componentId, "inter-beat-dynamics");
  assert.equal(across.inferred.transitions.length, 1);
  assert.equal(across.inferred.transitions[0].fromBeatId, "combined-text-only-17-to-text-only-18");
  assert.equal(across.inferred.transitions[0].toBeatId, "slide-5");
  assert.equal(across.inferred.transitions[0].matchMethod, "semantic-text");
  assert.equal(across.semanticLabel, "Bug");
  assert.match(across.semanticBehavior, /animate bug/i);
  assert.equal(camera.componentId, "inter-beat-dynamics");
  assert.deepEqual(camera.clipIndexes, [2]);
  assert.equal(camera.inferred.transitions[0].fromBeatId, across.inferred.transitions[0].fromBeatId);
  assert.equal(camera.inferred.transitions[0].toBeatId, across.inferred.transitions[0].toBeatId);

  const explicitlyUnlinked = applyAnimationProbeLinksToGraph(fixtureGraph(), runtime, [artifact], {
    assignments: {
      [within.trackId]: { beatIds: [], transitions: [], provider: "author" },
    },
  });
  const unlinkedTrack = explicitlyUnlinked.sourceMotionLinking.tracks.find((track) => track.trackId === within.trackId);
  assert.equal(unlinkedTrack.overridden, true);
  assert.deepEqual(unlinkedTrack.effective, { beatIds: [], transitions: [] });
  assert.equal(explicitlyUnlinked.sourceDynamics.assets.some((asset) => asset.classification === "within-beat-dynamics"), false);
});

test("maps semantic clip and camera state anchors to incoming screenshot-timeline boundaries", () => {
  const asset = {
    id: "scene-model.glb",
    type: "model",
    path: "models/scene-model.glb",
    url: "https://example.com/assets/scene-model.glb",
    role: "core_story",
  };
  const genericRuntime = {
    slug: "semantic-transition-fixture",
    title: "Semantic Transition Fixture",
    sourceUrl: "https://example.com/semantic-transition-fixture",
    assets: [asset],
  };
  const graph = {
    schemaVersion: "storyvr-source-graph/v1",
    story: { slug: genericRuntime.slug, title: genericRuntime.title, sourceUrl: genericRuntime.sourceUrl },
    atomicBeats: [
      { id: "beat-a", title: "Initial", text: "The scene begins in its initial arrangement.", atomicBeatIds: ["beat-a"], linkedAssets: [asset] },
      { id: "beat-b", title: "Panel opens", text: "The central panel opens to reveal the interior.", atomicBeatIds: ["beat-b"], linkedAssets: [asset] },
      { id: "beat-c", title: "Overview", text: "The view moves to an elevated overview.", atomicBeatIds: ["beat-c"], linkedAssets: [asset] },
    ],
    beats: [
      { id: "beat-a", title: "Initial", text: "The scene begins in its initial arrangement.", atomicBeatIds: ["beat-a"], linkedAssets: [asset] },
      { id: "beat-b", title: "Panel opens", text: "The central panel opens to reveal the interior.", atomicBeatIds: ["beat-b"], linkedAssets: [asset] },
      { id: "beat-c", title: "Overview", text: "The view moves to an elevated overview.", atomicBeatIds: ["beat-c"], linkedAssets: [asset] },
    ],
    assetInventory: [asset],
    textVisualEvidenceLinks: [],
  };
  const artifact = {
    trustedStoryFolder: true,
    preferred: true,
    artifactPath: "semantic-transition-fixture/codex-animation-judgment.json",
    judgment: {
      engine: { provider: "codex-cli" },
      modelBeatAssociations: [{
        assetFile: asset.id,
        assetUrl: asset.url,
        associationSource: "inferred-runtime",
        associationConfidence: 0.9,
        associatedBeats: [
          { text: "The scene begins in its initial arrangement.", scrollPercent: 10, source: "inferred-runtime" },
          { text: "The central panel opens to reveal the interior.", scrollPercent: 20, source: "inferred-runtime" },
          { text: "The view moves to an elevated overview.", scrollPercent: 30, source: "inferred-runtime" },
        ],
      }],
      assetJudgments: [{
        assetFile: asset.id,
        assetUrl: asset.url,
        hasEmbeddedAnimation: true,
        classification: "inter-beat-dynamics",
        confidence: 0.9,
      }],
      glbAnimationInterpretations: [{
        assetFile: asset.id,
        assetUrl: asset.url,
        hasCameraPath: true,
        evidenceRefs: ["visual-contact-sheet-001"],
        clips: [
          {
            animationIndex: 0,
            animationName: "PanelAction",
            targetNodes: ["central_panel"],
            targetPaths: ["translation"],
            role: "direct-object-transform",
            reasoning: "Moves the visible panel into its open state.",
            associatedBeats: [{
              text: "The central panel opens to reveal the interior.",
              scrollPercent: 20,
              confidence: 0.94,
              source: "inferred-runtime",
              snapshotIds: ["snapshot-panel-open"],
            }],
          },
          {
            animationIndex: 1,
            animationName: "OverviewState",
            targetNodes: ["overview_driver"],
            targetPaths: ["translation"],
            role: "unknown-control-node",
            reasoning: "Selects the overview state.",
            associatedBeats: [{
              text: "Elevated final state",
              scrollPercent: 30,
              confidence: 0.82,
              source: "inferred-runtime",
              snapshotIds: ["snapshot-overview"],
            }],
          },
          { animationIndex: 2, animationName: "CameraPath", role: "camera-path", associatedBeats: [] },
        ],
        cameraPath: {
          hasCameraPath: true,
          summary: "Moves from the initial view to an elevated overview.",
          evidenceRefs: ["visual-contact-sheet-002"],
          associatedBeats: [{
            text: "Elevated final state",
            scrollPercent: 30,
            confidence: 0.88,
            source: "inferred-runtime",
          }],
        },
        triggerMapping: { type: "local-scroll-window-progress", confidence: 0.95 },
      }],
    },
    evidence: {
      story: { slug: genericRuntime.slug, url: genericRuntime.sourceUrl },
      glbAnimations: { models: [{
        file: asset.id,
        assetUrl: asset.url,
        cameraCount: 1,
        hasCameraAnimation: true,
        nodes: [{ index: 8, name: "CameraRig", camera: 0 }],
        animations: [
          { index: 0, name: "PanelAction", duration: 4, targetNodeNames: ["central_panel"], targetPaths: ["translation"], cameraChannelCount: 0 },
          { index: 1, name: "OverviewState", duration: 4, targetNodeNames: ["overview_driver"], targetPaths: ["translation"], cameraChannelCount: 0 },
          { index: 2, name: "CameraPath", duration: 4, targetNodeNames: ["CameraRig"], targetPaths: ["translation"], cameraChannelCount: 1 },
        ],
      }] },
    },
  };

  const enriched = applyAnimationProbeLinksToGraph(graph, genericRuntime, [artifact]);
  const panel = enriched.sourceMotionLinking.tracks.find((track) => track.animationName === "PanelAction");
  const overview = enriched.sourceMotionLinking.tracks.find((track) => track.animationName === "OverviewState");
  const camera = enriched.sourceMotionLinking.tracks.find((track) => track.kind === "camera");

  assert.deepEqual(panel.applicableComponents, ["dynamic-geometry", "inter-beat-dynamics"]);
  assert.deepEqual(panel.inferred.beatIds, ["beat-b"]);
  assert.equal(panel.inferred.transitions[0].fromBeatId, "beat-a");
  assert.equal(panel.inferred.transitions[0].toBeatId, "beat-b");
  assert.equal(panel.inferred.transitions[0].startProgress, 0);
  assert.equal(panel.inferred.transitions[0].endProgress, 0.5);
  assert.equal(panel.inferred.transitions[0].matchMethod, "semantic-text");
  assert.equal(panel.semanticLabel, "Central panel");
  assert.equal(panel.semanticBehavior, "Moves the visible panel into its open state.");
  assert.deepEqual(panel.visualEvidenceRefs, ["snapshot-panel-open", "visual-contact-sheet-001"]);

  assert.equal(overview.inferred.transitions[0].fromBeatId, "beat-b");
  assert.equal(overview.inferred.transitions[0].toBeatId, "beat-c");
  assert.equal(overview.inferred.transitions[0].matchMethod, "visual-scroll-progress");
  assert.equal(overview.inferred.transitions[0].startProgress, 0.5);
  assert.equal(overview.inferred.transitions[0].endProgress, 1);

  assert.equal(camera.inferred.transitions[0].fromBeatId, "beat-b");
  assert.equal(camera.inferred.transitions[0].toBeatId, "beat-c");
  assert.equal(camera.inferred.transitions[0].matchMethod, "visual-scroll-progress");
  assert.deepEqual(camera.clipIndexes, [2]);
  assert.equal(camera.semanticLabel, "Source camera path");
  assert.deepEqual(camera.visualEvidenceRefs, ["visual-contact-sheet-002", "visual-contact-sheet-001"]);

  const transitionAsset = enriched.sourceDynamics.assets.find((item) => item.classification === "inter-beat-dynamics");
  assert.ok(transitionAsset.tracks.some((track) => track.trackId === panel.trackId));
  assert.ok(transitionAsset.tracks.some((track) => track.trackId === overview.trackId));
  assert.ok(transitionAsset.tracks.some((track) => track.trackId === camera.trackId));
});

test("builds a generic shared timeline with inactive, initialize, hold, scrub, and carried states", () => {
  const asset = {
    id: "kinetic-orchard.glb",
    type: "model",
    path: "models/kinetic-orchard.glb",
    url: "https://example.com/assets/kinetic-orchard.glb",
    role: "core_story",
  };
  const genericRuntime = {
    slug: "kinetic-orchard-story",
    title: "Kinetic Orchard",
    sourceUrl: "https://example.com/kinetic-orchard-story",
    assets: [asset],
  };
  const atomicBeats = [
    { id: "prelude", title: "Prelude", text: "A quiet introduction precedes the visual sequence.", linkedAssets: [], atomicBeatIds: ["prelude"] },
    { id: "introduction", title: "Introduction", text: "The visual sequence is about to begin.", linkedAssets: [], atomicBeatIds: ["introduction"] },
    { id: "atom-a", title: "First state", text: "The silver canopy becomes visible above the path.", linkedAssets: [asset], atomicBeatIds: ["atom-a"] },
    { id: "atom-b", title: "Explanation", text: "The same arrangement remains while its purpose is explained.", linkedAssets: [asset], atomicBeatIds: ["atom-b"] },
    { id: "atom-c", title: "Second state", text: "The canopy shifts toward the open clearing.", linkedAssets: [asset], atomicBeatIds: ["atom-c"] },
    { id: "beat-d", title: "Third state", text: "The view settles beside the final marker.", linkedAssets: [asset], atomicBeatIds: ["beat-d"] },
    { id: "tail", title: "Conclusion", text: "The final arrangement remains visible for the conclusion.", linkedAssets: [asset], atomicBeatIds: ["tail"] },
  ];
  const graph = {
    schemaVersion: "storyvr-source-graph/v1",
    story: { slug: genericRuntime.slug, title: genericRuntime.title, sourceUrl: genericRuntime.sourceUrl },
    atomicBeats,
    beats: [
      atomicBeats[0],
      atomicBeats[1],
      { ...atomicBeats[2], id: "beat-a", atomicBeatIds: ["atom-a"] },
      { ...atomicBeats[3], id: "beat-b", atomicBeatIds: ["atom-b"] },
      { ...atomicBeats[4], id: "beat-c", atomicBeatIds: ["atom-c"] },
      atomicBeats[5],
      atomicBeats[6],
    ],
    assetInventory: [asset],
    textVisualEvidenceLinks: [],
  };
  const artifact = {
    trustedStoryFolder: true,
    preferred: true,
    artifactPath: "kinetic-orchard-story/codex-animation-judgment.json",
    judgment: {
      engine: { provider: "codex-cli" },
      assetJudgments: [{
        assetFile: asset.id,
        assetUrl: asset.url,
        hasEmbeddedAnimation: true,
        classification: "inter-beat-dynamics",
        confidence: 0.91,
      }],
      modelBeatAssociations: [{
        assetFile: asset.id,
        assetUrl: asset.url,
        associationSource: "direct",
        associationConfidence: 0.91,
        associatedBeats: [
          { text: atomicBeats[2].text, source: "direct" },
          { text: atomicBeats[4].text, source: "direct" },
          { text: atomicBeats[5].text, source: "direct" },
        ],
      }],
      glbAnimationInterpretations: [{
        assetFile: asset.id,
        assetUrl: asset.url,
        hasCameraPath: true,
        clips: [
          { animationIndex: 0, animationName: "Canopy reveal", role: "direct-object-transform", associatedBeats: [{ text: atomicBeats[2].text, source: "direct" }] },
          { animationIndex: 1, animationName: "Canopy shift", role: "direct-object-transform", associatedBeats: [{ text: atomicBeats[4].text, source: "direct" }] },
          { animationIndex: 2, animationName: "View path", role: "camera-path", associatedBeats: [] },
        ],
        cameraPath: { hasCameraPath: true, associatedBeats: [{ text: atomicBeats[5].text, source: "direct" }] },
        triggerMapping: { type: "local-scroll-window-progress", confidence: 0.95 },
      }],
    },
    evidence: {
      story: { slug: genericRuntime.slug, url: genericRuntime.sourceUrl },
      glbAnimations: { models: [{
        file: asset.id,
        assetUrl: asset.url,
        cameraCount: 1,
        hasCameraAnimation: true,
        nodes: [{ index: 11, name: "ViewRig", camera: 0 }],
        animations: [
          { index: 0, name: "Canopy reveal", duration: 4, targetNodeNames: ["Canopy"], targetPaths: ["scale"], cameraChannelCount: 0 },
          { index: 1, name: "Canopy shift", duration: 6, targetNodeNames: ["Canopy"], targetPaths: ["translation"], cameraChannelCount: 0 },
          { index: 2, name: "View path", duration: 5, targetNodeNames: ["ViewRig"], targetPaths: ["translation"], cameraChannelCount: 1 },
        ],
      }] },
    },
  };
  const playbackInput = {
    schemaVersion: "storyvr-source-motion-playback/v1",
    assets: [{
      assetRef: { path: asset.path },
      mode: "shared-timeline",
      framing: { verticalAlignment: "grounded" },
      presentation: {
        backgroundColor: "#e8edef",
        authoredGround: true,
        annotations: { background: "transparent" },
      },
      timeline: { timeMapping: "shared-absolute", defaultLoopMode: "repeat" },
      anchors: [
        { sourceText: atomicBeats[2].text, localProgress: 0.2, contributorClipIndexes: [0] },
        { atomicBeatIds: ["atom-c"], localProgress: 0.6, contributorClipIndexes: [1, 2] },
        { beatIds: ["beat-d"], localProgress: 0.8, contributorClipIndexes: [2] },
      ],
      bindings: [{ source: { node: "VisibilityControl", property: "scale.x" }, target: { node: "Canopy", property: "opacity" }, operation: "copy" }],
      annotations: [{ label: "Neutral fictional fixture" }],
    }],
  };

  const legacy = applyAnimationProbeLinksToGraph(structuredClone(graph), genericRuntime, [artifact]);
  const legacyAssetEntries = legacy.sourceDynamics.assets.filter((item) => item.assetId === asset.id);
  assert.deepEqual(
    new Set(legacyAssetEntries.map((item) => item.classification)),
    new Set(["within-beat-dynamics", "inter-beat-dynamics"]),
    "without an explicit contract the existing independent-track classification remains unchanged",
  );
  const emptyContract = applyAnimationProbeLinksToGraph(structuredClone(graph), genericRuntime, [artifact], null, {
    schemaVersion: "storyvr-source-motion-playback/v1",
    assets: [],
  });
  assert.deepEqual(
    emptyContract.sourceDynamics,
    legacy.sourceDynamics,
    "an empty story-local contract preserves legacy story behavior exactly",
  );

  const enriched = applyAnimationProbeLinksToGraph(graph, genericRuntime, [artifact], null, playbackInput);
  const playback = enriched.sourceMotionPlayback;
  assert.equal(playback.schemaVersion, "storyvr-source-motion-playback/v1");
  assert.equal(playback.counts.assets, 1);
  const contract = playback.assets[0];
  assert.equal(contract.assetId, asset.id);
  assert.equal(contract.timeline.durationSeconds, 6);
  assert.equal(contract.timeline.timeMapping, "shared-absolute");
  assert.deepEqual(contract.framing, { verticalAlignment: "ground" });
  assert.deepEqual(contract.presentation, {
    backgroundColor: "#e8edef",
    authoredGround: true,
    annotations: { background: "transparent" },
  });
  assert.deepEqual(contract.coordinatedClips, [
    { clipIndex: 0, loopMode: "repeat" },
    { clipIndex: 1, loopMode: "repeat" },
    { clipIndex: 2, loopMode: "repeat" },
  ]);
  assert.deepEqual(contract.camera, {
    cameraIndex: 0,
    clipIndexes: [2],
    desktopPolicy: "source-camera",
    xrPolicy: "preserve-viewer-camera",
  });
  assert.deepEqual(contract.anchors.map((anchor) => [anchor.beatId, anchor.localProgress, anchor.matchMethod]), [
    ["beat-a", 0.2, "source-text"],
    ["beat-c", 0.6, "explicit-atomic-beat-id"],
    ["beat-d", 0.8, "explicit-beat-id"],
  ]);
  assert.deepEqual(contract.beatStates.map((state) => state.status), ["inactive", "inactive", "active", "active", "active", "active", "active"]);
  assert.deepEqual(contract.beatStates.map((state) => state.presence), ["inactive", "inactive", "active", "active", "active", "active", "active"]);
  assert.deepEqual(contract.beatStates.map((state) => state.entryMode), ["inactive", "inactive", "initial", "hold", "animate", "animate", "hold"]);
  assert.deepEqual(contract.beatStates.map((state) => state.stateMode), ["inactive", "inactive", "anchor", "carry", "anchor", "anchor", "carry"]);
  assert.deepEqual(contract.beatStates.map((state) => state.localProgress), [null, null, 0.2, 0.2, 0.6, 0.8, 0.8]);
  assert.deepEqual(contract.boundaries.map((boundary) => boundary.mode), ["none", "initialize", "hold", "scrub", "scrub", "hold"]);
  assert.deepEqual(contract.boundaries.map((boundary) => [boundary.startProgress, boundary.endProgress]), [
    [null, null], [0.2, 0.2], [0.2, 0.2], [0.2, 0.6], [0.6, 0.8], [0.8, 0.8],
  ]);
  assert.equal(contract.bindings[0].operation, "copy");
  assert.equal(contract.annotations[0].label, "Neutral fictional fixture");
  assert.equal(enriched.sourceSpatialCues.schemaVersion, "storyvr-source-spatial-cues/v1");
  assert.equal(enriched.sourceSpatialCues.inferredPath, true);
  assert.equal(enriched.sourceSpatialCues.defaultTextComfortOptionLabel, "Path / object-attached text");
  assert.equal(textComfortDefaultOptionLabelForGraph(enriched), "Path / object-attached text");
  assert.deepEqual(enriched.sourceSpatialCues.cues.map((cue) => [cue.beatId, cue.sourceProgress]), [
    ["beat-a", 0.2], ["beat-b", 0.2], ["beat-c", 0.6], ["beat-d", 0.8], ["tail", 0.8],
  ]);
  const transitionAsset = enriched.sourceDynamics.assets.find((item) => item.assetId === asset.id && item.classification === "inter-beat-dynamics");
  assert.equal(transitionAsset.playbackMode, "shared-timeline");
  assert.equal(transitionAsset.sourceMotionPlayback.assetId, asset.id);
  assert.equal(
    enriched.sourceDynamics.assets.filter((item) => item.assetId === asset.id).length,
    1,
    "an explicit shared timeline replaces same-asset legacy primary groups",
  );
  assert.equal(
    contract.trackIds.every((trackId) => enriched.sourceDynamics.tracks.some((track) => track.trackId === trackId)),
    true,
    "individual tracks remain available as contributor metadata",
  );
  const previews = sourceDynamicsPreviewIndex(enriched);
  assert.equal(previews["dynamic-geometry"].sourceDynamics.assets[0].assetId, asset.id);
  assert.equal(previews["dynamic-geometry"].sourceDynamics.assets[0].playbackMode, "shared-timeline");
  assert.equal(previews["inter-beat-dynamics"].sourceDynamics.assets[0].assetId, asset.id);
});

function multiPhasePlaybackFixture() {
  const asset = {
    id: "phase-atlas.glb",
    type: "model",
    path: "models/phase-atlas.glb",
    url: "https://example.com/assets/phase-atlas.glb",
    role: "core_story",
  };
  const beats = Array.from({ length: 9 }, (_, index) => ({
    id: `phase-${index}`,
    title: `Phase ${index}`,
    text: `Neutral shared-timeline phase ${index}.`,
    linkedAssets: index === 0 ? [] : [asset],
    atomicBeatIds: [`phase-${index}`],
  }));
  return {
    asset,
    runtime: {
      slug: "phase-atlas-story",
      title: "Phase Atlas",
      sourceUrl: "https://example.com/phase-atlas-story",
      assets: [asset],
    },
    graph: {
      schemaVersion: "storyvr-source-graph/v1",
      story: {
        slug: "phase-atlas-story",
        title: "Phase Atlas",
        sourceUrl: "https://example.com/phase-atlas-story",
      },
      atomicBeats: beats,
      beats,
      assetInventory: [asset],
      textVisualEvidenceLinks: [],
    },
  };
}

test("supports neutral multi-phase activation, explicit deactivation, inactive carry, and re-initialization", () => {
  const { asset, runtime: neutralRuntime, graph } = multiPhasePlaybackFixture();
  const playbackInput = {
    schemaVersion: "storyvr-source-motion-playback/v1",
    assets: [{
      assetRef: asset.path,
      mode: "shared-timeline",
      timeline: { durationSeconds: 10, timeMapping: "shared_absolute", defaultLoopMode: "infinite" },
      coordinatedClips: [
        { clipIndex: 0, loopMode: "loop" },
        { clipIndex: 1, loopMode: "ping_pong" },
        { clipIndex: 2, loopMode: "single" },
        { clipIndex: 3, loopMode: "hold-last" },
        { clipIndex: 4, loopMode: "mystery-mode" },
      ],
      anchors: [
        { beatIds: ["phase-1"], localProgress: 0.1 },
        { beatIds: ["phase-3"], presence: "inactive" },
        { beatIds: ["phase-5"], localProgress: 0.55 },
        { beatIds: ["phase-7"], entryMode: "inactive" },
        { beatIds: ["phase-8"], localProgress: 0.9 },
      ],
    }],
  };

  const playback = applyAnimationProbeLinksToGraph(graph, neutralRuntime, [], null, playbackInput).sourceMotionPlayback;
  assert.equal(playback.counts.assets, 1);
  assert.equal(playback.counts.anchors, 5);
  assert.equal(playback.counts.activeBeatStates, 5);
  const contract = playback.assets[0];
  assert.equal(contract.timeline.timeMapping, "shared-absolute");
  assert.equal(contract.timeline.defaultLoopMode, "repeat");
  assert.deepEqual(contract.coordinatedClips, [
    { clipIndex: 0, loopMode: "repeat" },
    { clipIndex: 1, loopMode: "ping-pong" },
    { clipIndex: 2, loopMode: "once" },
    { clipIndex: 3, loopMode: "clamp" },
    { clipIndex: 4, loopMode: "repeat" },
  ]);
  assert.deepEqual(contract.anchors.map((anchor) => [anchor.beatId, anchor.presence, anchor.localProgress]), [
    ["phase-1", "active", 0.1],
    ["phase-3", "inactive", null],
    ["phase-5", "active", 0.55],
    ["phase-7", "inactive", null],
    ["phase-8", "active", 0.9],
  ]);
  assert.deepEqual(contract.beatStates.map((state) => state.presence), [
    "inactive", "active", "active", "inactive", "inactive", "active", "active", "inactive", "active",
  ]);
  assert.deepEqual(contract.beatStates.map((state) => state.entryMode), [
    "inactive", "initial", "hold", "inactive", "inactive", "initial", "hold", "inactive", "initial",
  ]);
  assert.deepEqual(contract.beatStates.map((state) => state.stateMode), [
    "inactive", "anchor", "carry", "inactive", "inactive", "anchor", "carry", "inactive", "anchor",
  ]);
  assert.deepEqual(contract.beatStates.map((state) => state.localProgress), [
    null, 0.1, 0.1, null, null, 0.55, 0.55, null, 0.9,
  ]);
  assert.deepEqual(contract.boundaries.map((boundary) => boundary.mode), [
    "initialize", "hold", "clear", "none", "initialize", "hold", "clear", "initialize",
  ]);
  assert.deepEqual(contract.boundaries.map((boundary) => [boundary.startProgress, boundary.endProgress]), [
    [0.1, 0.1], [0.1, 0.1], [0.1, null], [null, null],
    [0.55, 0.55], [0.55, 0.55], [0.55, null], [0.9, 0.9],
  ]);
  assert.equal(playback.diagnostics.filter((item) => item.code === "SOURCE_MOTION_PLAYBACK_UNSUPPORTED_LOOP_MODE").length, 1);
  assert.equal(playback.diagnostics[0].fallbackLoopMode, "repeat");
});

test("reports nonfatal shared-timeline schema, mode, asset, anchor, timeline, and clip diagnostics", () => {
  const { asset, runtime: neutralRuntime, graph } = multiPhasePlaybackFixture();
  const unsupportedSchema = applyAnimationProbeLinksToGraph(graph, neutralRuntime, [], null, {
    schemaVersion: "storyvr-source-motion-playback/v0",
    assets: [],
  }).sourceMotionPlayback;
  assert.equal(unsupportedSchema.counts.assets, 0);
  assert.equal(unsupportedSchema.diagnostics[0].code, "SOURCE_MOTION_PLAYBACK_UNSUPPORTED_SCHEMA");

  const playback = applyAnimationProbeLinksToGraph(graph, neutralRuntime, [], null, {
    schemaVersion: "storyvr-source-motion-playback/v1",
    assets: [
      { assetRef: asset.path, mode: "independent" },
      { assetRef: "models/not-present.glb", mode: "shared-timeline" },
      {
        assetRef: asset.path,
        mode: "shared-timeline",
        timeline: { durationSeconds: 4, timeMapping: "shared-absolute", defaultLoopMode: "once" },
        coordinatedClips: [{ clipIndex: 0, loopMode: "once" }],
        anchors: [
          { beatIds: ["missing-phase"], localProgress: 0.2 },
          { beatIds: ["phase-1"], localProgress: 0.3 },
        ],
      },
      {
        assetRef: asset.path,
        mode: "shared-timeline",
        timeline: { durationSeconds: 0, timeMapping: "per-clip", defaultLoopMode: "not-a-loop" },
        coordinatedClips: [{ clipIndex: "not-an-index" }],
        anchors: [{ beatIds: ["phase-2"], localProgress: 0.4 }],
      },
    ],
  }).sourceMotionPlayback;

  assert.equal(playback.counts.assets, 1, "a valid contract remains available beside malformed entries");
  assert.equal(playback.assets[0].assetId, asset.id);
  const diagnosticCodes = new Set(playback.diagnostics.map((item) => item.code));
  assert.equal(diagnosticCodes.has("SOURCE_MOTION_PLAYBACK_UNSUPPORTED_MODE"), true);
  assert.equal(diagnosticCodes.has("SOURCE_MOTION_PLAYBACK_ASSET_NOT_FOUND"), true);
  assert.equal(diagnosticCodes.has("SOURCE_MOTION_PLAYBACK_UNRESOLVED_ANCHOR"), true);
  assert.equal(diagnosticCodes.has("SOURCE_MOTION_PLAYBACK_UNUSABLE_TIMELINE"), true);
  assert.equal(diagnosticCodes.has("SOURCE_MOTION_PLAYBACK_UNUSABLE_CLIPS"), true);
  assert.equal(diagnosticCodes.has("SOURCE_MOTION_PLAYBACK_UNSUPPORTED_LOOP_MODE"), true);
  assert.equal(playback.diagnostics.every((item) => item.severity === "warning" && item.message), true);
});

test("persists explicit overrides and compiles exact source motion assignments", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "storyvr-source-motion-"));
  const storyFolder = path.join(tempRoot, "motion-story");
  const resourceFolder = path.join(storyFolder, "captures", "active");
  const metadataRoot = path.join(resourceFolder, "metadata");
  const modelsRoot = path.join(resourceFolder, "models");
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const probeRoot = path.join(storyFolder, "analysis", "animation-logic-probe", "run");
  const decisionsRoot = path.join(analysisRoot, "decisions");
  await mkdir(metadataRoot, { recursive: true });
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(probeRoot, { recursive: true });
  await mkdir(decisionsRoot, { recursive: true });
  const modelPath = path.join(modelsRoot, bedbugAsset.id);
  await writeFile(modelPath, "test-model");
  await writeFile(path.join(metadataRoot, "story_structure_candidates.json"), JSON.stringify({
    story_url: runtime.sourceUrl,
    title: runtime.title,
    slides: [
      { index: 0, text: "Bedbugs are monsters of the vampire variety." },
      { index: 1, text: "Bedbugs can enter your home through clothing and furniture." },
      { index: 2, text: "Bedbugs settle into a final inspected state." },
    ],
  }, null, 2));
  await writeFile(path.join(metadataRoot, "asset_manifest.json"), JSON.stringify([{
    story_url: runtime.sourceUrl,
    asset_url: bedbugAsset.url,
    final_url: bedbugAsset.url,
    local_path: modelPath,
    asset_type: "model",
    adaptation_relevance: "core_story",
    source_type: "network_request",
  }], null, 2));
  await writeFile(path.join(probeRoot, "animation-evidence.json"), JSON.stringify({
    story: { slug: runtime.slug, url: runtime.sourceUrl },
    glbAnimations: {
      models: [{
        file: bedbugAsset.id,
        assetUrl: bedbugAsset.url,
        cameraCount: 1,
        hasCameraAnimation: true,
        nodes: [{ index: 4, name: "CameraRig", camera: 0 }],
        animations: [
          { index: 0, name: "Bug motion", duration: 2, targetNodeNames: ["Bug"], targetPaths: ["rotation"], cameraChannelCount: 0 },
          { index: 1, name: "Camera motion", duration: 3, targetNodeNames: ["CameraRig"], targetPaths: ["translation"], cameraChannelCount: 1 },
        ],
      }],
    },
  }, null, 2));
  await writeFile(path.join(probeRoot, "codex-animation-judgment.json"), JSON.stringify({
    engine: { provider: "codex-cli" },
    storySlug: runtime.slug,
    storyUrl: runtime.sourceUrl,
    assetJudgments: [{
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      hasEmbeddedAnimation: true,
      classification: "within-beat-dynamics",
      confidence: 0.84,
      associatedBeats: [{ text: "Bedbugs are monsters of the vampire variety", scrollPercent: 20, source: "direct" }],
    }],
    modelBeatAssociations: [{
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      hasEmbeddedAnimation: true,
      associationSource: "direct",
      associationConfidence: 0.84,
      associatedBeats: [
        { text: "Bedbugs are monsters of the vampire variety", scrollPercent: 20, source: "direct" },
        { text: "Bedbugs can enter your home through clothing", scrollPercent: 40, source: "direct" },
        { text: "Bedbugs settle into a final inspected state", scrollPercent: 60, source: "direct" },
      ],
    }],
    glbAnimationInterpretations: [{
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      hasCameraPath: true,
      clips: [
        {
          animationIndex: 0,
          animationName: "Bug motion",
          role: "direct-object-transform",
          associatedBeats: [{ text: "Bedbugs are monsters of the vampire variety", scrollPercent: 20, source: "inferred" }],
        },
        { animationIndex: 1, animationName: "Camera motion", role: "camera-path", associatedBeats: [] },
      ],
      cameraPath: {
        hasCameraPath: true,
        associatedBeats: [
          { text: "Bedbugs are monsters of the vampire variety", scrollPercent: 20, source: "inferred" },
          { text: "Bedbugs can enter your home through clothing", scrollPercent: 40, source: "inferred" },
          { text: "Bedbugs settle into a final inspected state", scrollPercent: 60, source: "inferred" },
        ],
      },
    }],
    inferredBeatAssetStates: [{
      beatId: "slide-2",
      text: "Bedbugs can enter your home through clothing and furniture.",
      assetFile: bedbugAsset.id,
      assetUrl: bedbugAsset.url,
      parts: [{ name: "Bug", nodePath: "bedbug/Bug" }],
      animations: [{ clipIndex: 0, clipName: "Bug motion", targetParts: ["bedbug/Bug"] }],
      confidence: 0.82,
    }],
  }, null, 2));
  await writeFile(path.join(analysisRoot, "source-motion-playback.json"), JSON.stringify({
    schemaVersion: "storyvr-source-motion-playback/v1",
    assets: [{
      assetId: bedbugAsset.id,
      mode: "shared-timeline",
      timeline: { timeMapping: "shared-absolute", defaultLoopMode: "repeat" },
      anchors: [{ beatIds: ["slide-2"], localProgress: 0.4, contributorClipIndexes: [0, 1] }],
      materials: [{ id: "fixture-flow", recipe: "uv-stripe-flow", target: { node: "Bug" } }],
      bindings: [{ operation: "material-uniform", source: { type: "wall-clock-time" }, target: { material: "fixture-flow", uniform: "time" } }],
      annotations: [{ label: "Compile fixture" }],
    }],
  }, null, 2));

  const options = { storyFolder, resourceFolder };
  const initial = await loadAuthorProject(options);
  const clip = initial.sourceMotionLinking.tracks.find((track) => track.kind === "clip" && track.animationIndex === 0);
  const camera = initial.sourceMotionLinking.tracks.find((track) => track.kind === "camera");
  assert.ok(clip);
  assert.ok(camera);
  assert.ok(Object.hasOwn(initial.paths, "sourceMotionPlaybackPath"));
  const initialPlayback = initial.sourceMotionPlayback.assets[0];
  assert.equal(initialPlayback.timeline.durationSeconds, 3);
  assert.deepEqual(initialPlayback.coordinatedClips.map((item) => item.clipIndex), [0, 1]);
  assert.deepEqual(initialPlayback.camera.clipIndexes, [1]);
  assert.deepEqual(initialPlayback.beatStates.map((state) => state.stateMode), ["inactive", "anchor", "carry"]);
  assert.deepEqual(initialPlayback.boundaries.map((boundary) => boundary.mode), ["initialize", "hold"]);
  assert.equal(initialPlayback.materials[0].recipe, "uv-stripe-flow");
  assert.equal(initialPlayback.bindings[0].operation, "material-uniform");
  await assert.rejects(
    () => saveSourceMotionLinks(options, {
      assignments: [{
        trackId: camera.trackId,
        assetId: camera.assetId,
        componentId: "dynamic-geometry",
        kind: "camera",
        beatIds: ["slide-1"],
        transitions: [],
      }],
    }),
    /Camera track|belongs to inter-beat-dynamics/,
  );

  const unlinked = await saveSourceMotionLinks(options, {
    assignments: [{
      trackId: clip.trackId,
      assetId: clip.assetId,
      componentId: clip.componentId,
      kind: clip.kind,
      beatIds: [],
      transitions: [],
    }],
  });
  const unlinkedClip = unlinked.tracks.find((track) => track.trackId === clip.trackId);
  assert.equal(unlinkedClip.overridden, true);
  assert.deepEqual(unlinkedClip.effective, { beatIds: [], transitions: [] });
  const storedOverrides = JSON.parse(await readFile(path.join(analysisRoot, "source-motion-overrides.json"), "utf8"));
  assert.deepEqual(storedOverrides.assignments[clip.trackId].beatIds, []);
  const reloaded = await loadAuthorProject(options);
  assert.deepEqual(reloaded.sourceMotionLinking.tracks.find((track) => track.trackId === clip.trackId).effective.beatIds, []);

  const reassigned = await saveSourceMotionLinks(options, {
    assignments: [{
      trackId: clip.trackId,
      assetId: clip.assetId,
      componentId: clip.componentId,
      kind: clip.kind,
      beatIds: ["slide-2"],
      transitions: [],
    }],
  });
  assert.deepEqual(reassigned.tracks.find((track) => track.trackId === clip.trackId).effective.beatIds, ["slide-2"]);

  const environmentPublicPath = "environment-enhancement/test-room/test-room.glb";
  const environmentAssetPath = path.join(storyFolder, "webxr-adaptation", "public", environmentPublicPath);
  await mkdir(path.dirname(environmentAssetPath), { recursive: true });
  await writeFile(environmentAssetPath, "test-environment");

  const decisions = [
    ["asset-topology", {
      component: "asset-topology",
      status: "current",
      savedAt: new Date(0).toISOString(),
      option: { optionId: "asset-topology-single-anchor", label: "Single anchor", viewpoint: "exocentric", viewpointLabel: "Exocentric viewpoint" },
    }],
  ];
  for (const [component, decision] of decisions) {
    await writeFile(path.join(decisionsRoot, `${component}.json`), JSON.stringify({ schemaVersion: "storyvr-decision/v2", ...decision }, null, 2));
  }
  const spatialState = await loadAuthorProject(options);
  const spatialBundle = spatialState.proposals["spatial-relations"];
  assert.equal(spatialBundle.defaultOptionId, "spatial-relations-inferred-layout");
  const spatialDraftContract = structuredClone(spatialState.spatialRelations);
  const spatialDraftGlb = spatialDraftContract.entities.find((entity) => entity.kind === "glb" && entity.assetId === bedbugAsset.id);
  assert.ok(spatialDraftGlb);
  spatialDraftGlb.transform.position = [0.25, 0, 0];
  spatialDraftGlb.manual = true;
  const spatialDraftScene = spatialDraftContract.resolvedByBeat[spatialDraftGlb.beatId];
  Object.assign(spatialDraftScene.entities.find((entity) => entity.id === spatialDraftGlb.id), structuredClone(spatialDraftGlb));
  const spatialDraftInstance = {
    ...structuredClone(spatialDraftGlb),
    id: `${spatialDraftGlb.id}:instance:2`,
    authoredInstance: true,
    instanceOfEntityId: spatialDraftGlb.id,
    instanceIndex: 2,
    transform: {
      ...structuredClone(spatialDraftGlb.transform),
      position: [0.6, 0, -0.25],
    },
    manual: true,
  };
  spatialDraftContract.entities.push(structuredClone(spatialDraftInstance));
  spatialDraftScene.entities.push(structuredClone(spatialDraftInstance));
  const spatialDraft = await saveSpatialRelationsDecisionDraft(options, {
    optionId: spatialBundle.defaultOptionId,
    spatialRelations: spatialDraftContract,
  });
  assert.equal(spatialDraft.schemaVersion, "storyvr-decision/v2");
  assert.equal(spatialDraft.status, "draft");
  assert.equal(spatialDraft.savedAt, null);
  assert.equal(Object.hasOwn(spatialDraft, "approvedAt"), false);
  assert.equal(Object.hasOwn(spatialDraft, "locked"), false);
  assert.equal(Object.hasOwn(spatialDraft, "lockUpdatedAt"), false);
  assert.deepEqual(spatialDraft.spatialRelations.entities.find((entity) => entity.id === spatialDraftGlb.id).transform.position, [0.25, 0, 0]);
  assert.equal(spatialDraft.spatialRelations.entities.find((entity) => entity.id === spatialDraftInstance.id).authoredInstance, true);
  await saveCheckpointDecision(options, "spatial-relations", {
    optionId: spatialBundle.defaultOptionId,
    spatialRelations: spatialDraft.spatialRelations,
  });
  await saveEnvironmentEnhancementCheckpoint(options, {
    schemaVersion: "storyvr-environment-enhancement/v1",
    selectedSource: { candidate: { title: "Test room", provider: "manual-upload" } },
    asset: { publicPath: environmentPublicPath, format: "glb", sourceUpload: { filename: "test-room.glb" } },
    transform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
    rendering: { exposure: 1, fogColor: "#dce8e2", fogDensity: 0, backgroundMode: "asset" },
    performance: {},
    provenance: { selectionMode: "manual-upload" },
  });
  await saveAttentionGuidanceForTest(options);
  await saveCheckpointDecision(options, "dynamic-geometry");
  await saveCheckpointDecision(options, "inter-beat-dynamics");
  await writeFile(path.join(decisionsRoot, "interaction-control.json"), JSON.stringify({
    schemaVersion: "storyvr-decision/v2",
    component: "interaction-control",
    status: "current",
    savedAt: new Date(0).toISOString(),
    option: { optionId: "interaction-button", label: "Button stepping" },
  }, null, 2));
  await writeFile(path.join(decisionsRoot, "transition-pacing.json"), JSON.stringify({
    schemaVersion: "storyvr-decision/v2",
    component: "transition-pacing",
    status: "current",
    savedAt: new Date(0).toISOString(),
    option: { optionId: "transition-pacing-final-review-saved", label: "Final review saved" },
  }, null, 2));
  const compiled = await compileAuthorRuntime(options);
  const compiledClip = compiled.sourceMotionLinking.tracks.find((track) => track.trackId === clip.trackId);
  const compiledCamera = compiled.sourceMotionLinking.tracks.find((track) => track.trackId === camera.trackId);
  const compiledPlayback = compiled.sourceMotionPlayback.assets[0];
  assert.deepEqual(compiledClip.effective.beatIds, ["slide-2"]);
  assert.equal(compiledCamera.effective.transitions[0].fromBeatId, "slide-1");
  assert.equal(compiledCamera.effective.transitions[0].toBeatId, "slide-2");
  assert.equal(compiledCamera.semanticLabel, "Source camera path");
  assert.equal(compiled.sourceDynamics.tracks.some((track) => track.trackId === clip.trackId), true);
  const compiledTransition = compiled.sourceDynamics.assets.find((asset) => asset.classification === "inter-beat-dynamics");
  assert.ok(compiledTransition.tracks.some((track) => track.trackId === camera.trackId));
  assert.deepEqual(compiledPlayback.boundaries.map((boundary) => boundary.mode), ["initialize", "hold"]);
  assert.equal(compiledPlayback.materials[0].id, "fixture-flow");
  assert.deepEqual(compiledTransition.transitionSegments.map((segment) => segment.mode), ["initialize", "hold"]);
  assert.deepEqual(compiledTransition.transitionSegments[0].clipIndexes, [0, 1]);
  assert.deepEqual(compiledTransition.transitionSegments[0].cameraIndexes, [0]);
  assert.equal(compiledTransition.transitionSegments[0].durationSeconds, 3);
  const unit = compiled.contentUnits.find((item) => item.id === "slide-2");
  assert.equal(unit.sourceMotionAssignments.some((track) => track.trackId === clip.trackId && track.withinBeat), true);
  assert.equal(compiled.sourcePartStates.schemaVersion, "storyvr-source-part-states/v1");
  assert.equal(compiled.sourcePartStates.states[0].beatId, "slide-2");
  assert.equal(unit.sourcePartStates[0].assetId, bedbugAsset.id);
  assert.equal(compiled.spatialRelations.schemaVersion, "storyvr-spatial-relations/v2");
  assert.equal(compiled.spatialRelations.entities.some((entity) => entity.kind === "glb" && entity.assetId === bedbugAsset.id && entity.id.includes(":beat:")), true);
  assert.equal(compiled.spatialRelations.entities.some((entity) => entity.id === spatialDraftInstance.id && entity.authoredInstance === true), true);
  assert.equal(
    compiled.timeline.find((item) => item.unitId === spatialDraftGlb.beatId).spatialRelations.entities
      .some((entity) => entity.id === spatialDraftInstance.id && entity.authoredInstance === true),
    true,
  );
  const compiledTextEntity = compiled.timeline.find((item) => item.unitId === "slide-2").spatialRelations.entities
    .find((entity) => entity.id === "text-panel:slide-2");
  assert.equal(compiledTextEntity.anchor.type, "source-focus");
  assert.equal(compiledTextEntity.anchor.assetId, bedbugAsset.id);
  const generatedReaderSource = await readFile(path.join(storyFolder, "webxr-adaptation", "src", "main.js"), "utf8");
  assert.match(generatedReaderSource, /runtimeSpatialRelations/);
  assert.match(generatedReaderSource, /modelAuthorTransformRoot/);
  assert.match(generatedReaderSource, /supplementalSpatialTransitionPlayback/);
  assert.equal(
    compiled.environmentEnhancement.schemaVersion,
    "storyvr-environment-enhancement-assignments/v2",
  );
  assert.equal(compiled.environmentEnhancement.defaultEnvironment.asset.publicPath, environmentPublicPath);
  assert.deepEqual(
    Object.keys(compiled.environmentEnhancement.defaultEnvironment)
      .filter((key) => key.endsWith("Confirmation")),
    [],
  );
  await writeFile(environmentAssetPath, "tampered-environment");
  await assert.rejects(
    () => compileAuthorRuntime(options),
    /checksum no longer matches/,
  );
  await writeFile(environmentAssetPath, "test-environment");

  const graphBeforeManualEdit = (await loadAuthorProject(options)).graph;
  const manuallyRelinkedGraph = structuredClone(graphBeforeManualEdit);
  for (const beat of [...manuallyRelinkedGraph.atomicBeats, ...manuallyRelinkedGraph.beats]) {
    beat.linkedAssets = beat.id === "slide-3" ? [bedbugAsset] : [];
  }
  const savedGraph = await saveStoryGraph(options, manuallyRelinkedGraph);
  assert.equal(savedGraph.sourceGraphInference.changed, true);
  assert.deepEqual(savedGraph.beats.filter((beat) => beatAssetIdsForTest(beat, bedbugAsset.id)).map((beat) => beat.id), ["slide-3"]);

  const refreshedClip = savedGraph.sourceMotionLinking.tracks.find((track) => track.trackId === clip.trackId);
  const refreshedCamera = savedGraph.sourceMotionLinking.tracks.find((track) => track.trackId === camera.trackId);
  assert.equal(refreshedClip.overridden, false);
  assert.deepEqual(refreshedClip.effective.beatIds, ["slide-3"]);
  assert.equal(savedGraph.sourceMotionLinking.staleOverrides.graphSignatureMismatch, true);
  assert.equal(savedGraph.sourceMotionLinking.staleOverrides.ignoredAssignmentCount, 1);
  assert.deepEqual(refreshedCamera.effective.transitions.map((transition) => [transition.fromBeatId, transition.toBeatId]), [["slide-2", "slide-3"]]);

  const refreshedDynamicsDecision = JSON.parse(await readFile(path.join(decisionsRoot, "dynamic-geometry.json"), "utf8"));
  const refreshedTransitionDecision = JSON.parse(await readFile(path.join(decisionsRoot, "inter-beat-dynamics.json"), "utf8"));
  const invalidatedEnvironment = JSON.parse(await readFile(path.join(decisionsRoot, "environment-enhancement.json"), "utf8"));
  assert.equal(refreshedDynamicsDecision.status, "stale");
  assert.equal(refreshedTransitionDecision.status, "stale");
  assert.equal(refreshedDynamicsDecision.invalidatedBy, "source-graph-links");
  assert.equal(refreshedTransitionDecision.invalidatedBy, "source-graph-links");
  assert.equal(invalidatedEnvironment.status, "stale");
  assert.equal(invalidatedEnvironment.invalidatedBy, "source-motion-links");
  assert.equal(Object.hasOwn(refreshedDynamicsDecision, "locked"), false);
  assert.equal(Object.hasOwn(invalidatedEnvironment, "lockUpdatedAt"), false);

  const reopenedReadiness = (await loadAuthorProject(options)).readiness;
  assert.deepEqual(
    pickReadinessState(reopenedReadiness["environment-enhancement"]),
    { status: "stale", current: false, saved: true, stale: true },
  );

  const reopenedAfterManualEdit = await loadAuthorProject(options);
  assert.deepEqual(reopenedAfterManualEdit.graph.beats.filter((beat) => beatAssetIdsForTest(beat, bedbugAsset.id)).map((beat) => beat.id), ["slide-3"]);
  assert.deepEqual(reopenedAfterManualEdit.sourceMotionLinking.tracks.find((track) => track.trackId === clip.trackId).effective.beatIds, ["slide-3"]);
  const dynamicsBeforeNoOpSave = JSON.parse(await readFile(path.join(decisionsRoot, "dynamic-geometry.json"), "utf8"));
  const noOpSave = await saveStoryGraph(options, structuredClone(reopenedAfterManualEdit.graph));
  const dynamicsAfterNoOpSave = JSON.parse(await readFile(path.join(decisionsRoot, "dynamic-geometry.json"), "utf8"));
  assert.equal(noOpSave.sourceGraphInference.changed, false);
  assert.equal(dynamicsAfterNoOpSave.savedAt, dynamicsBeforeNoOpSave.savedAt);
  assert.equal(dynamicsAfterNoOpSave.status, dynamicsBeforeNoOpSave.status);
});

function pickReadinessState(readiness) {
  return {
    status: readiness.status,
    current: readiness.current,
    saved: readiness.saved,
    stale: readiness.stale,
  };
}

function beatAssetIdsForTest(beat, assetId) {
  return (beat?.linkedAssets || []).some((asset) => (typeof asset === "string" ? asset : asset?.id || asset?.assetId) === assetId);
}
