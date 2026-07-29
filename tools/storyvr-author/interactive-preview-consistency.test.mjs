import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

async function readOptionalSiblingPlayback(storySlug) {
  try {
    return JSON.parse(await readFile(
      new URL(`../../../${storySlug}/analysis/storyvr/source-motion-playback.json`, import.meta.url),
      "utf8",
    ));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const classroomPlayback = await readOptionalSiblingPlayback("classroom");
const transmissionPlayback = await readOptionalSiblingPlayback("transmission");
const sharkPlayback = await readOptionalSiblingPlayback("shark");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const viewerInitializers = [
  "initializeTopologyViewer",
  "initializeDynamicGeometryViewer",
  "initializeInterBeatDynamicsViewer",
  "initializeReaderViewpointViewer",
  "initializeTextComfortViewer",
  "initializeInteractionControlViewer",
  "initializeFinalReviewViewer",
];

if (classroomPlayback) {
  const classroomCameraPlaybackAsset = classroomPlayback.assets[0];
  assert.equal(classroomCameraPlaybackAsset.camera.desktopPolicy, "render-source-camera",
    "the classroom keeps its authored embedded camera on desktop");
  assert.equal(classroomCameraPlaybackAsset.camera.xrPolicy, "preserve-viewer-camera",
    "the classroom source camera cannot replace the head-tracked XR reader camera");
}
if (transmissionPlayback) {
  const transmissionPlaybackAsset = transmissionPlayback.assets[0];
  assert.equal(transmissionPlaybackAsset.mode, "shared-timeline",
    "the transmission story keeps its original cough spread on one coordinated timeline");
  assert.equal(transmissionPlaybackAsset.anchors.length, 13,
    "the transmission story retains one saved source pose for every visual beat");
  assert.equal(transmissionPlaybackAsset.camera.desktopPolicy, "preserve-viewer-camera",
    "the transmission source camera cannot replace the draggable desktop reader camera");
  assert.equal(transmissionPlaybackAsset.camera.xrPolicy, "preserve-viewer-camera",
    "the transmission source camera cannot replace the head-tracked XR reader camera");
}

for (const name of viewerInitializers) {
  const block = functionSource(name);
  assert.match(block, /addPreviewMetadataOverlay\(/, `${name} mounts the shared DOM metadata overlay`);
  assert.match(block, /suppressSceneLabels:\s*true/, `${name} keeps metadata out of Three.js`);
}

const spatialTextSprite = functionSource("makeTextSprite");
assert.match(spatialTextSprite, /options\.authoredSceneText === true/, "Three.js text requires an explicit source-authored content contract");
assert.match(spatialTextSprite, /fog:\s*false/, "source-authored labels remain legible independently of environment fog");
assert.match(spatialTextSprite, /depthTest: options\.depthTest !== false/, "source-authored labels can use the source overlay depth policy");
assert.match(spatialTextSprite, /toneMapped: options\.toneMapped !== false/, "source-authored labels can preserve their authored screen color");
assert.match(spatialTextSprite, /sprite\.visible = authoredSceneText/, "system-generated spatial text cards remain hidden");
assert.match(spatialTextSprite, /sprite\.raycast = \(\) => \{\}/, "hidden text cards cannot leave invisible interaction targets");
const sourcePlaybackAnnotationIsReaderVisible = new Function(
  `${functionSource("sourcePlaybackAnnotationIsReaderVisible")}\nreturn sourcePlaybackAnnotationIsReaderVisible;`,
)();
if (transmissionPlayback) {
  assert.equal(sourcePlaybackAnnotationIsReaderVisible(transmissionPlayback.assets[0].annotations[0]), false,
    "the transmission provenance label is not rendered as a Final Review card");
}
if (sharkPlayback) {
  assert.equal(sourcePlaybackAnnotationIsReaderVisible(sharkPlayback.assets[0].annotations[0]), false,
    "the shark timeline summary is not rendered as a Final Review card");
}
if (classroomPlayback) {
  for (const annotation of classroomPlayback.assets[0].annotations) {
    assert.equal(sourcePlaybackAnnotationIsReaderVisible(annotation), true,
      `the source-authored classroom annotation ${annotation.id} remains visible`);
  }
  if (classroomPlayback.assets[0].presentation) {
    assert.deepEqual(classroomPlayback.assets[0].presentation, {
      backgroundColor: "#e8edef",
      authoredGround: true,
      annotations: {
        background: "transparent",
        color: "#111614",
        fontWeight: 600,
        maxLineCharacters: 44,
        viewportMargin: 12,
      },
    }, "the classroom source contract preserves its all-beat background, authored floor, and label treatment");
  }
}
assert.equal(sourcePlaybackAnnotationIsReaderVisible({ label: "Intentional label", readerVisible: true }), true,
  "an unanchored authored annotation can explicitly opt into reader visibility");
assert.match(functionSource("normalizeSourcePlaybackAsset"), /filter\(sourcePlaybackAnnotationIsReaderVisible\)/,
  "Final Review removes metadata-only annotations during playback normalization");
assert.match(functionSource("initializeSourcePlaybackAnnotations"), /sourcePlaybackAnnotationIsReaderVisible\(definition\)[^]*authoredSceneText:\s*true/s,
  "only reader-visible source annotations opt into Three.js scene text");
assert.match(functionSource("initializeSourcePlaybackAnnotations"), /sourcePlaybackAnnotationLayout\(text, definition, presentation\)/,
  "every source annotation uses content-aware dimensions instead of a fixed card size");
assert.match(functionSource("initializeSourcePlaybackAnnotations"), /background: definition\.background \?\? presentation\.background/,
  "the source contract can restore bare labels without per-beat overrides");
assert.match(functionSource("initializeSourcePlaybackAnnotations"), /initializeFinalReviewSourcePlaybackAnnotationElement/,
  "Final Review projects source annotations into the same constant-size DOM treatment as the reader");
assert.match(functionSource("updateSourcePlaybackAnnotations"), /THREE\.MathUtils\.clamp\(x, minimumLeft, maximumLeft\)/,
  "Final Review keeps source labels inside the preview viewport across the whole timeline");
assert.match(functionSource("updateSourcePlaybackAnnotations"), /annotation\.sprite\.visible = annotationVisible && \(!annotation\.element \|\| xrPresenting\)/,
  "desktop Final Review uses crisp projected labels while XR retains world-space sprites");
assert.equal((source.match(/authoredSceneText:\s*true/g) || []).length, 1, "only source-declared annotations can opt back into spatial text rendering");
assert.match(functionSource("makeTopologyPlaceholder"), /mesh\.visible = false[\s\S]*mesh\.raycast = \(\) => \{\}/, "asset placeholders are neither rendered nor pickable");
assert.match(functionSource("makeTextComfortPlaceholder"), /group\.visible = false[\s\S]*object\.raycast = \(\) => \{\}/, "loading placeholders stay out of spatial editors and picking");

assert.doesNotMatch(source, /renderCumulativeSourceOrderControls|data-cumulative-source|Complete authored scene|cumulative layer|cumulative source-order/, "revised checkpoints have no inherited source-order control or status bar");
const narrativeSingleAnchorAnimation = functionSource("animateNarrativeSingleAnchorViewer");
assert.doesNotMatch(narrativeSingleAnchorAnimation, /selectedTopologySwapIndex|syncCumulativeSelectionForSourceIndex|setCumulativeViewerActiveSourceIndex|state\.topologySwapPlaying/, "later previews never advance beats or models on an independent topology clock");
assert.match(functionSource("viewerDynamicGeometryKind"), /viewer\?\.layers\?\.dynamicKind/, "cumulative previews honor the current saved Dynamics layer");
assert.match(functionSource("animateCumulativeSourceOrderModel"), /!transitionPlaybackActive && kind === "none"\) return/, "No dynamics suppresses inherited idle and within-beat source motion without blocking a real Transition");
assert.doesNotMatch(
  functionSource("animateCumulativeSourceOrderModel"),
  /Math\.sin|modelRoot\.rotation\.y\s*=|modelRoot\.position\.[xy]\s*\+=/,
  "cumulative previews never synthesize rotation, bobbing, or scale pulses for Dynamics",
);
assert.match(functionSource("addDynamicEffectOverlays"), /return null;/, "Dynamics adds no synthetic rings, particles, halos, or focus markers");
const dynamicAnimation = functionSource("animateDynamicGeometry");
assert.match(dynamicAnimation, /item\.mixer\.setTime\(sourceTime\)/, "Dynamics advances mapped GLB animation mixers");
assert.match(dynamicAnimation, /animateProceduralDynamicsPreview\(viewer, time\)/,
  "Dynamics evaluates only an explicit generated plan after source GLB playback");
assert.match(functionSource("animateProceduralDynamicsPreview"), /applyProceduralDynamicsPreviewTransform\(item, time, deltaSeconds\)/,
  "generated preview motion is isolated from source-animation entries");
assert.doesNotMatch(dynamicAnimation, /Math\.sin|animateDynamicEffectOverlays|wrapper\.rotation\.y\s*=/,
  "Dynamics has no unrequested procedural fallback motion");
assert.match(functionSource("dynamicSourceMotionTracksForPreview"), /sourceMotionDraftForTrack\(track\)[^]*beatIds\.has/s, "Dynamics resolves embedded clips from the active beat mapping");
assert.match(functionSource("attachSourceDynamicsPreviewAnimation"), /dynamicSourceMotionTracksForPreview\(viewer, assetId\)/, "Dynamics playback is driven by mapped GLB tracks rather than the advanced-editor selection");
assert.match(functionSource("dynamicPreviewHasEmbeddedGlbAnimation"), /hasEmbeddedAnimation/, "Dynamics only exposes playback controls when the active GLB has mapped animation evidence");
assert.match(functionSource("renderDynamicPreview"), /hasSourceAnimation \? "Saved \+ added movement" : "Added movement"/,
  "Dynamics distinguishes added movement from movement already saved with the story");
assert.match(functionSource("renderDynamicPreview"), /\? "Saved movement"\s*:\s*"Still"/,
  "Dynamics keeps saved movement distinct from scenes that stay still");
assert.match(functionSource("initializeDynamicGeometryViewer"), /attachLockedEnvironmentToViewer\(viewer\)/, "Dynamics inherits the current saved Environment Enhancement");
assert.match(functionSource("initializeDynamicGeometryViewer"), /createSpatialReaderRig\(root, layers\.viewpointKind, layoutKind, readerEntity\)/, "Dynamics shows the saved Reader model in its spatial editor");
assert.doesNotMatch(functionSource("initializeDynamicGeometryViewer"), /addInheritedTextComfortLayer/, "Dynamics does not materialize the reader-hand text system surface");
assert.match(functionSource("initializeInterBeatDynamicsViewer"), /attachLockedEnvironmentToViewer\(viewer\)/, "Transition inherits the current saved Environment Enhancement");
assert.match(functionSource("initializeInterBeatDynamicsViewer"), /thumbnailMode[\s\S]*createSpatialReaderRig\(root, layers\.viewpointKind, layoutKind, readerEntity\)/, "Transition shows the saved Reader model only in the full spatial editor");
assert.doesNotMatch(functionSource("initializeInterBeatDynamicsViewer"), /addInheritedTextComfortLayer/, "Transition does not materialize a detached prose panel");
const interactionInitializer = functionSource("initializeInteractionControlViewer");
const interactionCumulativeUpdate = functionSource("updateInteractionControlCumulativeScene");
const interactionFraming = functionSource("fitInteractionControlPreviewCamera");
assert.match(interactionInitializer, /lockedSpatialRelationsContract\(\)/, "Interaction resolves its exact saved Spatial Relations scene");
assert.match(interactionInitializer, /spatialSceneEntities\([^,]+, editorContext\.sceneContext\)/, "Interaction resolves the saved Reader entity for the exact opened beat or variant route");
assert.match(interactionInitializer, /makeSpatialEditorFloorGuide\(/, "Interaction reuses the Spatial editor floor");
assert.match(interactionInitializer, /createSpatialReaderRig\(root,[\s\S]*readerEntity\)/, "Interaction reuses the saved Reader pose");
assert.match(interactionInitializer, /fitInteractionControlPreviewCamera\(viewer, root\)/, "Interaction frames only after its scene assets settle");
assert.match(interactionFraming, /if \(viewer\?\.spatialEditorCamera\)[\s\S]*frameSpatialSceneOverview\(viewer\)[\s\S]*return;/, "Interaction opens on an outside overview that includes the Reader");
assert.doesNotMatch(interactionInitializer, /addInheritedTextComfortLayer\(/, "Interaction intentionally replaces the detached text layer with its reader-hand panel");
assert.doesNotMatch(interactionCumulativeUpdate, /addInheritedTextComfortLayer\(/, "Interaction beat updates keep the panel on the reader hand");
assert.match(functionSource("applyLockedSpatialGlbTransform"), /layers\?\.enabled\?\.\[SPATIAL_RELATIONS_COMPONENT_ID\]/, "later previews apply GLB transforms only when Spatial Relations is in their cumulative layer chain");
assert.match(functionSource("loadDynamicAsset"), /authorWrapper[\s\S]*applyLockedSpatialGlbTransform/, "Dynamics and Transition compose authored GLB transforms outside animated content");

const environmentInitializer = functionSource("initializeEnvironmentEnhancementViewer");
assert.match(environmentInitializer, /environment-enhancement-root/, "Environment Enhancement owns a persistent surrounding root");
assert.match(environmentInitializer, /loadEnvironmentPreviewStoryAssets/, "Environment Enhancement keeps the active saved Spatial Relations scene visible");
assert.match(environmentInitializer, /loadEnvironmentPreviewAsset/, "Environment Enhancement loads the author-uploaded surrounding directly");
assert.match(environmentInitializer, /setAnimationLoop/, "Environment Enhancement keeps one live preview instead of rebuilding on every tuning input");
assert.match(functionSource("lockedEnvironmentPreviewContract"), /checkpointIsCurrent/, "downstream previews consume only the current saved environment decision");
assert.match(functionSource("attachLockedEnvironmentToViewer"), /lockedEnvironmentPreviewContract/, "downstream viewers attach the canonical environment contract");
assert.match(functionSource("environmentEnhancementSkipped"), /environment-enhancement-no-added-environment/, "the author UI recognizes the canonical skipped environment decision");
assert.match(functionSource("inferContextLayerKind"), /environmentEnhancementSkipped[^\n]+return "none"/, "skipping does not masquerade as an uploaded or synthetic environment");
assert.match(functionSource("previewDescriptionCueSpecs"), /componentId === "environment-enhancement"[\s\S]*?kind === "none"\) return \[\]/, "skipping adds no environment cue geometry");
assert.match(source, /data-environment-action="save"/, "Environment Enhancement exposes its current native Save checkpoint action");
assert.match(source, /data-action="save-checkpoint"/, "ordinary checkpoints expose one Save checkpoint action");
assert.doesNotMatch(source, /data-action="(?:approve-lock|unlock)"/, "checkpoint cards expose no approve, lock, or unlock actions");
assert.match(source, /accept="\.hdr,\.exr,image\/vnd\.radiance,image\/x-hdr,image\/x-exr"/, "Environment Enhancement only offers 360-degree image formats for upload");
assert.doesNotMatch(functionSource("validateEnvironmentUploadFile"), /\.glb|\.gltf|\.zip/, "client upload validation rejects model packages");
assert.match(functionSource("validateEnvironmentUploadFile"), /\["\.hdr", "\.exr"\]/, "client upload validation accepts only HDR and EXR panoramas");

const spatialInitializer = functionSource("initializeSpatialRelationsViewer");
assert.doesNotMatch(spatialInitializer, /transformControls\.enabled = !locked|if \(!locked\) scene\.add\(transformHelper\)/, "saving Spatial Relations never disables editing");
assert.match(spatialInitializer, /scene\.add\(transformHelper\)/, "the draggable gizmo remains mounted for a saved Spatial Relations checkpoint");
assert.match(spatialInitializer, /createSpatialReaderRig\(root, layers\.viewpointKind, layoutKind, readerEntity\)/, "Spatial Relations mounts the saved Reader pose on its editor proxy");
assert.match(spatialInitializer, /viewer\.spatialObjects\.set\(readerEntity\.id, readerEditorLayer\.rig\)/, "the Reader participates in generic selection and transforms");
assert.match(spatialInitializer, /if \(!canRestoreCameraState\) frameSpatialSceneOverview\(viewer\)/, "Spatial Relations opens on an outside overview after assets settle");
assert.match(spatialInitializer, /spatialEditorSceneEntities\(draft, sceneContext\)/, "Spatial Relations loads only editor-visible scene assets");
assert.doesNotMatch(spatialInitializer, /makeTextComfortPanel|makeTextAnchorMarker|makeTextPanelCallout/, "the Spatial editor never materializes the runtime text panel");
assert.doesNotMatch(spatialInitializer, /applySpatialTextOrientationInEditor|applySpatialTextCollisionClearanceInEditor/, "the Spatial render loop contains no hidden text-panel placement work");
assert.match(functionSource("spatialEditorSceneEntities"), /spatialEntityType\(entity\) !== "text-panel"/, "the editor-only filter excludes compatibility text entities");
assert.match(functionSource("frameSpatialSceneOverview"), /viewer\.spatialObjects/, "Overview frames editable scene objects");
assert.match(functionSource("frameSpatialSceneOverview"), /viewer\.readerProxy/, "Overview includes the simulated reader");
assert.match(functionSource("frameSpatialSceneOverview"), /readerPosition[\s\S]*sphere\.center[\s\S]*readerBack/, "Overview stays on the reader side of the scene");
assert.match(source, /data-spatial-frame-overview>Overview</, "Spatial Relations exposes an explicit Overview action");
assert.match(styles, /\.spatial-relations-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(210px, 280px\) minmax\(0, 1fr\)/s, "the workbench uses a bounded hierarchy and flexible editor column");
assert.match(styles, /\.spatial-preview-card\s*\{[^}]*grid-column:\s*2 \/ -1/s, "the editor consumes all space to the right of the hierarchy");
assert.match(styles, /@media \(max-width: 780px\)[\s\S]*?\.spatial-preview-card,[\s\S]*?grid-column:\s*1;/, "the editor returns to one column on small screens");
assert.doesNotMatch(functionSource("spatialRelationsForSave"), /readerRig|readerProxy|spatialEditorCamera/, "the outside editor camera and proxy implementation never enter the saved Spatial Relations contract");

assert.equal(
  (source.match(/addPreviewDescriptionCues\(/g) || []).length,
  1,
  "automatic description-cue geometry has no live call sites",
);
assert.match(
  functionSource("addPreviewDescriptionCues"),
  /componentId === "inter-beat-dynamics" && options\.playback\?\.canScrub !== true/,
  "the dormant generic Transition cue renderer also requires an exact mapped playback window",
);

for (const name of [
  "addTopologyStage",
  "addReaderStage",
  "addContextStage",
  "addInteractionControlStage",
  "addFullEnvironmentContext",
  "addPreviewDescriptionCues",
]) {
  assert.match(
    functionSource(name),
    /allowSyntheticGeometry[^\n]+true/,
    `${name} requires an explicit synthetic-geometry opt-in`,
  );
}

for (const name of [
  "loadTopologySwapAsset",
  "loadTopologyAsset",
  "loadDynamicAsset",
  "loadTextComfortSceneAsset",
  "loadFinalReviewAsset",
]) {
  assert.match(functionSource(name), /suppressSceneLabels/, `${name} honors scene-label suppression`);
}

assert.doesNotMatch(
  functionSource("addFinalReviewStage"),
  /CircleGeometry|GridHelper|RingGeometry|makeTextSprite/,
  "Final Review has no generic stage geometry or metadata sprites",
);

assert.doesNotMatch(
  functionSource("microhabitatForBeat"),
  /eyelash|bedbug|housefly|cockroach|cabinet|influenza/,
  "generic previews do not infer story-specific geometry from keywords",
);

assert.match(
  functionSource("topologySwapDuplicateCount"),
  /return 0;/,
  "source models are not duplicated unless the selected option explicitly requests duplicates",
);
assert.match(
  functionSource("addTopologySwapDuplicateModels"),
  /viewerTopologyViewpointKind\(viewer\) === "egocentric"/,
  "egocentric previews never add duplicate source models",
);

const interBeatOverlays = functionSource("addInterBeatTransitionOverlays");
const interBeatOverlayInitializer = functionSource("initializeInterBeatDynamicsViewer");
assert.match(
  interBeatOverlays,
  /if\s*\(\s*playback\?\.canScrub\s*!==\s*true\s*\|\|\s*kind\s*===\s*"none"\s*\)\s*return null;/,
  "an unmapped or unscrubbable boundary creates no Transition overlay group",
);
assert.ok(
  interBeatOverlays.indexOf("playback?.canScrub") < interBeatOverlays.indexOf("new THREE.Group"),
  "mapping eligibility is checked before any line, ring, or marker can be created",
);
assert.match(
  interBeatOverlayInitializer,
  /transitionEffects:\s*addInterBeatTransitionOverlays\(root,\s*kind,\s*fromPosition,\s*toPosition,\s*playback\)/,
  "the Transition viewer passes the exact boundary playback summary into its overlay renderer",
);
for (const geometry of [
  /new THREE\.Line\(/,
  /new THREE\.RingGeometry\(/,
  /new THREE\.SphereGeometry\(/,
]) {
  assert.match(
    interBeatOverlays,
    geometry,
    "a mapped, spatially distinct Transition retains its route line, endpoint rings, and moving marker",
  );
}
assert.doesNotMatch(
  interBeatOverlays,
  /makeTextSprite|Beat A:|Beat B:|reader travels/,
  "Transition keeps its route geometry without floating synthetic text cards",
);
assert.match(
  interBeatOverlays,
  /coincidentAnchors:\s*from\.distanceToSquared\(to\)/,
  "transition previews detect when both beats use the same spatial anchor",
);
assert.match(
  interBeatOverlays,
  /if \(effects\.coincidentAnchors\) return effects;/,
  "same-anchor transitions do not add decorative endpoint rings or balls",
);
assert.match(
  functionSource("renderInterBeatPreview"),
  /interBeatBoundaryPlaybackSummary\(proposal, sceneContext\)/,
  "transition preview is driven by the opened story scene and its incoming boundary",
);
assert.match(functionSource("renderInterBeatDynamicsWorkspace"), /renderInterBeatDynamicsCanvasWorkspace/, "Transition starts from its story canvas");
assert.match(functionSource("renderInterBeatDynamicsWorkspace"), /renderInterBeatDynamicsEditorWorkspace/, "an opened scene replaces the Transition canvas with its editor");
assert.match(functionSource("renderInterBeatDynamicsEditorWorkspace"), /renderSourceMotionLinkingEditor/, "advanced source-motion mapping stays in the opened scene editor");
assert.match(styles, /\.inter-beat-canvas-mode\s*\{[^}]*width:\s*100%/s, "the Transition canvas owns the flexible workspace column");
assert.match(functionSource("interBeatStoryBeats"), /graph\?\.beats/, "Transition includes every authored beat rather than only model-linked slides");
assert.match(functionSource("interBeatStoryBeats"), /sourcePartStatesForPreviewBeat/, "text-only beats receive their resolved GLB state");
assert.match(functionSource("interBeatBoundaryForSceneContext"), /beatSourcePartPlaybackMode\(beat\) !== "frozen"/, "frozen text beats do not start a transition animation");
assert.match(functionSource("attachSourceTransitionPlayback"), /forceHold:[^\n]+sourcePartPlaybackMode === "frozen"/, "frozen text beats resolve an absolute source-timeline hold");
assert.match(functionSource("attachSourceTransitionPlayback"), /entry\.sourcePartFrozen = windowState\.mode !== "scrub"/, "initialize and hold windows never autoplay");
assert.match(functionSource("animateNarrativeSingleAnchorViewer"), /advanceInterBeatSourcePlaybackClock/, "single-anchor Transition playback advances its own source clock");
assert.match(source, /interBeatViewer\.elapsed = 0;\s*resetPreviewCycle\(interBeatViewer\);/, "replaying a completed Transition resets both preview clocks");

const advanceInterBeatSourcePlaybackClock = new Function(`
  ${functionSource("advanceInterBeatSourcePlaybackClock")}
  return advanceInterBeatSourcePlaybackClock;
`)();
const neutralInterBeatClock = {
  componentId: "inter-beat-dynamics",
  playOnce: true,
  sourceMotionTransition: { fromBeatId: "beat-alpha", toBeatId: "beat-beta" },
  swapReady: true,
};
assert.equal(advanceInterBeatSourcePlaybackClock(neutralInterBeatClock, 0.4, 2), true);
assert.equal(neutralInterBeatClock.sourceElapsed, 0.4, "a one-source Transition advances from its initial timeline position");
assert.equal(advanceInterBeatSourcePlaybackClock(neutralInterBeatClock, 3, 2), true);
assert.equal(neutralInterBeatClock.sourceElapsed, 2, "the Transition source clock clamps at its play-once cycle boundary");
const neutralNonTransitionClock = { componentId: "dynamic-geometry", sourceElapsed: 0 };
assert.equal(advanceInterBeatSourcePlaybackClock(neutralNonTransitionClock, 0.4, 2), false);
assert.equal(neutralNonTransitionClock.sourceElapsed, 0, "non-Transition source-order playback keeps its existing clock ownership");

const selectorHelpers = new Function(`
  ${functionSource("uniqueStrings")}
  ${functionSource("expandSourcePartSelectors")}
  ${functionSource("sourcePartSelectorRegex")}
  ${functionSource("sourcePartNodePath")}
  ${functionSource("sourcePartSelectorMatchesNode")}
  ${functionSource("updateSourceRenderableVisibility")}
  ${functionSource("applySourcePartMask")}
  return { expandSourcePartSelectors, applySourcePartMask };
`)();
assert.deepEqual(
  selectorHelpers.expandSourcePartSelectors(["environment/{fixture_*,shell}", "layers/layer_00..02 plus paths/*"]),
  ["environment/fixture_*", "environment/shell", "layers/layer_00", "layers/layer_01", "layers/layer_02", "paths/*"],
  "part selectors expand alternatives, numeric ranges, and unions without story-specific code",
);
const root = { name: "Scene", userData: {}, children: [], traverse(callback) { callback(this); for (const child of this.children) callback(child); } };
const desk = { name: "desk_01", parent: root, userData: {}, visible: true, isMesh: true };
const wall = { name: "wall", parent: root, userData: {}, visible: true, isMesh: true };
root.children.push(desk, wall);
assert.deepEqual(selectorHelpers.applySourcePartMask(root, ["desk_*"]), { applied: true, matched: 1, renderables: 2 });
assert.equal(desk.visible, true);
assert.equal(wall.visible, false);
assert.equal(selectorHelpers.applySourcePartMask(root, ["does-not-exist"]).fallback, true, "unmatched metadata restores the full model");
assert.equal(wall.visible, true);

assert.match(styles, /\.preview-metadata-overlay\s*\{[^}]*position:\s*absolute;[^}]*top:\s*1rem;[^}]*right:\s*1rem;/s);

const metadataOverlay = functionSource("addPreviewMetadataOverlay");
assert.match(metadataOverlay, /document\.createElement\("details"\)/, "preview metadata is a foldable disclosure");
assert.match(metadataOverlay, /document\.createElement\("summary"\)/, "preview metadata keeps a visible disclosure control");
assert.doesNotMatch(metadataOverlay, /\.open\s*=\s*true|setAttribute\("open"/, "preview metadata is folded by default");
assert.match(styles, /\.preview-metadata-toggle\s*\{[^}]*pointer-events:\s*auto;/s, "the metadata disclosure remains clickable over the preview");
assert.match(styles, /\.preview-metadata-overlay:not\(\[open\]\)\s*>\s*\.preview-metadata-row\s*\{[^}]*display:\s*none;/s, "folded preview metadata hides its rows");

assert.doesNotMatch(
  source,
  /\bcloneValue\s*\(/,
  "source-motion editing uses the application's existing JSON clone helper",
);
assert.match(
  functionSource("renderSourceMotionLinkingEditor"),
  /data-action="save-source-motion-links"/,
  "Dynamics and Transition expose an explicit source-motion save action",
);
const sourceMotionLinkingEditor = functionSource("renderSourceMotionLinkingEditor");
assert.match(
  sourceMotionLinkingEditor,
  /<details class="motion-linking-card[^"]*"[^>]*data-motion-linking-fold=/,
  "manual source mapping is rendered as a disclosure",
);
assert.match(
  source,
  /sourceMotionLinkingOpen:\s*\{\s*"dynamic-geometry": false,\s*"inter-beat-dynamics": false,\s*\}/,
  "manual source mapping starts folded in both Dynamics and Transition",
);
assert.match(
  sourceMotionLinkingEditor,
  /state\.sourceMotionLinkingOpen\[componentId\] \? "open" : ""/,
  "the disclosure restores the author's session-local open state after rerenders",
);
assert.match(
  source,
  /fold\.addEventListener\("toggle", \(\) => \{\s*state\.sourceMotionLinkingOpen\[fold\.dataset\.motionLinkingFold\] = fold\.open;/,
  "opening or closing manual source mapping updates its session state",
);
assert.match(
  styles,
  /\.motion-linking-card:not\(\[open\]\) > \.motion-linking-content\s*\{\s*display:\s*none;/,
  "the collapsed disclosure hides the mapping controls",
);
assert.match(
  functionSource("renderSourceMotionTransitionTargets"),
  /authoredMotionTransitions\(\)/,
  "Transition motion linking is limited to authored adjacent beat boundaries",
);
assert.match(
  functionSource("renderSourceMotionTrackEditor"),
  /Semantic behavior/,
  "Transition motion linking explains the semantic behavior behind each source track",
);
assert.match(
  functionSource("renderSourceMotionTransitionTargets"),
  /timeline/,
  "Transition assignments expose their inferred source-timeline segment",
);
const sourceAttachment = functionSource("attachSourceDynamicsPreviewAnimation");
assert.match(sourceAttachment, /viewerExecutesInterBeatTransition\(viewer\)[^]*attachSourceTransitionPlayback/s, "Transition and Final Review branch to the contract consumer before legacy selected-track playback");
assert.ok(
  sourceAttachment.indexOf("attachSourceTransitionPlayback") < sourceAttachment.indexOf("selectedSourceMotionTrack"),
  "the selected track is inspector-only for Transition",
);
assert.doesNotMatch(functionSource("syncMotionPreviewSelectionToTrack"), /inter-beat-dynamics/, "advanced Transition track selection does not change the primary preview boundary");

const transitionAttachment = functionSource("attachSourceTransitionPlayback");
assert.match(transitionAttachment, /sourcePlaybackWindowForAsset/, "Transition resolves the exact asset boundary contract");
assert.doesNotMatch(transitionAttachment, /selectedSourceMotionTrack|sourceMotionTransitionAssignmentForPreview/, "Transition playback is independent of the advanced editor selection");
assert.match(transitionAttachment, /sourcePlaybackDiagnostic\(runtime, "no-mapped-source-window"/, "an unmapped boundary stays static instead of playing a full clip");
assert.doesNotMatch(
  transitionAttachment,
  /state\.interBeatPreviewPlaying = false|viewer\.playing = false/,
  "a held companion asset cannot stop another asset's mapped scrub window",
);
assert.doesNotMatch(transitionAttachment, /controls\.enabled\s*=\s*false/, "a declared GLB camera never disables Transition orbit controls");
assert.match(transitionAttachment, /requestSourceCameraCue\(viewer\)/, "a declared GLB camera becomes an action-triggered cue");
const interBeatInitializer = functionSource("initializeInterBeatDynamicsViewer");
assert.match(interBeatInitializer, /controls\.addEventListener\("start", viewer\.sourceCameraControlStartHandler\)/, "dragging the Transition preview takes camera control back from the source cue");
assert.match(
  interBeatInitializer,
  /syncSourceCameraPreview\(viewer, thumbnailMode \? playbackDelta : delta\);\s*controls\.update\(\);/,
  "source-camera cues share the render loop while a paused compact preview receives no clock delta",
);
assert.match(functionSource("cancelSourceCameraCue"), /viewer\.sourceCameraCue = null/, "manual orbit cancels source-camera ownership");
assert.match(functionSource("requestSourceCameraCue"), /!viewer\.thumbnailMode && !state\.sourceCameraPreviewEnabled\) return false/,
  "the full Transition editor keeps its Reader overview until the author explicitly previews the source camera");
assert.match(functionSource("syncSourceCameraPreview"), /lerpVectors\(cue\.startPosition, targetPosition, smooth\)/, "camera cues move smoothly from the current user view");
assert.match(source, /if \(state\.interBeatPreviewPlaying\) \{[^]*requestSourceCameraCue\(interBeatViewer\)/s, "Play re-cues the authored camera from the current orbit view");
assert.match(functionSource("renderInterBeatPreview"), /renderSourceCameraEvidence\(beat\)/, "Transition exposes camera-path linking evidence per beat");
assert.match(functionSource("renderSourceCameraEvidence"), /Correctness[^]*Comprehensiveness[^]*headset camera remains viewer-controlled/s, "camera evidence separates linking review from WebXR camera ownership");
assert.match(functionSource("defaultTextPlacementForKind"), /coordinateSpace[^]*source-focus|textPlacementEntry\("source-focus"/s, "the Path text option derives its placement from source camera focus");
assert.match(functionSource("sanitizeTextPlacement"), /storyvr-text-placement\/v2/, "Text Comfort persists source-focus placement with the v2 contract");
assert.match(functionSource("applySourceSpatialCueToTextViewer"), /sourceCameraSceneEvaluation[^]*textPlacementWorldPosition/s, "Text Comfort evaluates the source camera cue before placing the panel");
assert.match(functionSource("sourcePlaybackClipDescriptors"), /asset\.mode === "shared-timeline"\) return descriptors/, "shared timelines activate their full coordinated clip set");
const seekSource = functionSource("seekSourceTransitionPlayback");
assert.match(seekSource, /mixer\.setTime\(runtime\.masterDuration \* normalizedProgress\)/, "all coordinated clips seek one master timeline");
assert.ok(seekSource.indexOf("mixer.setTime") < seekSource.indexOf("applySourcePlaybackBindings"), "declared bindings run after every timeline seek");
assert.ok(seekSource.indexOf("applySourcePlaybackBindings") < seekSource.indexOf("updateSourcePlaybackAnnotations"), "annotations update after driver bindings");
assert.match(functionSource("renderInterBeatPreview"), /timelineLabel[^]*windowLabel[^]*contributorCount/s, "Transition shows timeline mode, exact window, and contributor count");
assert.match(functionSource("initializeSourcePlaybackBindings"), /visibility-opacity[^]*draw-range-progress[^]*camera-focal-length[^]*annotation-opacity/s, "the frontend supports each declared generic binding operation");
assert.match(functionSource("initializeSourcePlaybackBindings"), /unsupported-binding-operation/, "unsupported binding operations are diagnostic no-ops");
assert.match(functionSource("updateSourcePlaybackAnnotations"), /definition\.visibleThreshold/, "annotation visibility uses the normalized contract threshold");
assert.match(functionSource("attachSourceTransitionPlayback"), /gltf\.scene\.visible = sourcePlaybackSceneVisibleForViewer/, "each preview resolves loaded source-scene visibility through its ownership boundary");
assert.match(functionSource("applyInterBeatSourcePartMaskToEntry"), /sourcePlaybackContractOwnsEntryVisibility/, "shared-timeline entries bypass legacy source-part masks");
for (const loaderName of ["loadTopologySwapAsset", "loadDynamicAsset"]) {
  const loader = functionSource(loaderName);
  assert.ok(loader.indexOf("attachSourceDynamicsPreviewAnimation") < loader.indexOf("applyInterBeatSourcePartMaskToEntry"), `${loaderName} establishes contract ownership before considering a legacy mask`);
}
assert.match(functionSource("initializeInterBeatDynamicsViewer"), /previewCycleSeconds: INTER_BEAT_TRANSITION_CYCLE_SECONDS/, "legacy Transition playback retains its fixed preview duration");

const normalizeMotionTransitions = new Function(`
  ${functionSource("uniqueMotionBeatIds")}
  ${functionSource("normalizeMotionSceneContext")}
  ${functionSource("motionTransitionIdentity")}
  ${functionSource("normalizeMotionTransitions")}
  return normalizeMotionTransitions;
`)();
assert.deepEqual(
  normalizeMotionTransitions([{
    edgeId: "progression:beat-a:variant-1->beat-b",
    fromBeatId: "beat-a",
    toBeatId: "beat-b",
    fromContext: {
      beatId: "beat-a",
      variantGroupId: "beat-a-variants",
      variantOptionId: "variant-1",
    },
    toContext: { beatId: "beat-b" },
    startProgress: -0.25,
    endProgress: 1.4,
  }]),
  [{
    fromBeatId: "beat-a",
    toBeatId: "beat-b",
    edgeId: "progression:beat-a:variant-1->beat-b",
    fromContext: {
      beatId: "beat-a",
      variantGroupId: "beat-a-variants",
      variantOptionId: "variant-1",
    },
    toContext: { beatId: "beat-b" },
    startProgress: 0,
    endProgress: 1,
  }],
  "Transition normalization preserves the exact graph route and clamps timing",
);
assert.equal(
  normalizeMotionTransitions([
    {
      edgeId: "progression:beat-a:variant-1->beat-b",
      fromBeatId: "beat-a",
      toBeatId: "beat-b",
      fromContext: { beatId: "beat-a", variantGroupId: "beat-a-variants", variantOptionId: "variant-1" },
      toContext: { beatId: "beat-b" },
    },
    {
      edgeId: "progression:beat-a:variant-2->beat-b",
      fromBeatId: "beat-a",
      toBeatId: "beat-b",
      fromContext: { beatId: "beat-a", variantGroupId: "beat-a-variants", variantOptionId: "variant-2" },
      toContext: { beatId: "beat-b" },
    },
  ]).length,
  2,
  "parallel variant routes are not collapsed into one beat-pair assignment",
);

const sourcePlaybackHelpers = new Function(`
  ${functionSource("finiteSourcePlaybackNumber")}
  ${functionSource("clampSourcePlaybackProgress")}
  ${functionSource("normalizeSourcePlaybackClip")}
  ${functionSource("normalizeSourcePlaybackBeatState")}
  ${functionSource("normalizeSourcePlaybackBoundary")}
  ${functionSource("normalizeSourcePlaybackAsset")}
  ${functionSource("sourcePlaybackBoundaryForAsset")}
  ${functionSource("sourcePlaybackBoundaryForAssetChange")}
  ${functionSource("sourcePlaybackBeatStateForAsset")}
  ${functionSource("sourcePlaybackContributorCount")}
  ${functionSource("sourcePlaybackWindowForAsset")}
  ${functionSource("sourcePlaybackWindowKeepsAssetActive")}
  ${functionSource("sourcePlaybackScrubCycleSeconds")}
  ${functionSource("sourcePlaybackCameraIndex")}
  return { normalizeSourcePlaybackAsset, sourcePlaybackWindowForAsset, sourcePlaybackWindowKeepsAssetActive, sourcePlaybackScrubCycleSeconds, sourcePlaybackCameraIndex };
`)();

const neutralPlaybackAsset = sourcePlaybackHelpers.normalizeSourcePlaybackAsset({
  assetId: "neutral-environment.glb",
  mode: "shared-timeline",
  timeline: { durationSeconds: 12, timeMapping: "normalized", defaultLoopMode: "once" },
  coordinatedClips: [{ clipIndex: 2 }, { clipIndex: 5 }],
  beatStates: [
    { beatId: "beat-alpha", presence: "active", localProgress: 0.15, entryMode: "initial" },
    { beatId: "beat-beta", presence: "active", localProgress: 0.4, entryMode: "animate" },
    { beatId: "beat-gamma", presence: "active", localProgress: 0.72, entryMode: "hold", inheritedFromBeatId: "beat-beta" },
  ],
  boundaries: [
    { fromBeatId: "beat-alpha", toBeatId: "beat-beta", mode: "scrub", startProgress: 0.15, endProgress: 0.4, contributorClipIndexes: [2, 5] },
    { fromBeatId: "beat-beta", toBeatId: "beat-gamma", mode: "hold", endProgress: 0.72, contributorClipIndexes: [5] },
    { fromBeatId: "beat-gamma", toBeatId: "beat-delta", mode: "none" },
  ],
});
assert.equal(neutralPlaybackAsset.timeline.durationSeconds, 12);
assert.equal(neutralPlaybackAsset.coordinatedClips.length, 2);
assert.deepEqual(
  sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "beat-alpha", "beat-beta"),
  {
    mode: "scrub",
    startProgress: 0.15,
    endProgress: 0.4,
    contributorCount: 2,
    boundary: neutralPlaybackAsset.boundaries[0],
    beatState: neutralPlaybackAsset.beatStates[1],
  },
  "a neutral shared-timeline fixture resolves its exact scrub window",
);
assert.equal(
  sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "beat-beta", "beat-gamma").holdProgress,
  0.72,
  "hold boundaries resolve an absolute source progress",
);
assert.equal(
  sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "beat-gamma", "beat-delta").mode,
  "none",
  "an explicit none boundary never falls back to 0-1 playback",
);
const neutralReverseWindow = sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "beat-beta", "beat-alpha");
assert.deepEqual(
  {
    mode: neutralReverseWindow.mode,
    startProgress: neutralReverseWindow.startProgress,
    endProgress: neutralReverseWindow.endProgress,
    reverse: neutralReverseWindow.boundary?.reverse,
    fromBeatId: neutralReverseWindow.boundary?.fromBeatId,
    toBeatId: neutralReverseWindow.boundary?.toBeatId,
  },
  {
    mode: "scrub",
    startProgress: 0.4,
    endProgress: 0.15,
    reverse: true,
    fromBeatId: "beat-beta",
    toBeatId: "beat-alpha",
  },
  "reverse playback is derived only by reversing an explicitly authored opposite boundary",
);
const neutralReverseInitializeAsset = sourcePlaybackHelpers.normalizeSourcePlaybackAsset({
  assetId: "neutral-reverse-initialize.glb",
  mode: "shared-timeline",
  timeline: { durationSeconds: 4 },
  beatStates: [{ beatId: "beat-left", presence: "active", localProgress: 0.25, entryMode: "initial" }],
  boundaries: [{ fromBeatId: "beat-left", toBeatId: "beat-right", mode: "initialize", endProgress: 0.25 }],
});
const neutralReverseClearWindow = sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralReverseInitializeAsset, "beat-right", "beat-left");
assert.equal(neutralReverseClearWindow.reason, "boundary-clear", "reversing initialize produces an authoritative clear boundary");
assert.equal(sourcePlaybackHelpers.sourcePlaybackWindowKeepsAssetActive(neutralReverseClearWindow), false);
const neutralReverseClearAsset = sourcePlaybackHelpers.normalizeSourcePlaybackAsset({
  assetId: "neutral-reverse-clear.glb",
  mode: "shared-timeline",
  timeline: { durationSeconds: 4 },
  beatStates: [{ beatId: "beat-left", presence: "active", localProgress: 0.25, entryMode: "initial" }],
  boundaries: [{ fromBeatId: "beat-left", toBeatId: "beat-right", mode: "clear", startProgress: 0.25 }],
});
const neutralReverseEntryWindow = sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralReverseClearAsset, "beat-right", "beat-left");
assert.equal(neutralReverseEntryWindow.mode, "initialize", "reversing clear produces an initialize boundary");
assert.equal(neutralReverseEntryWindow.holdProgress, 0.25, "reverse initialize seeks the swapped authored endpoint");
assert.deepEqual(
  sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "", "beat-alpha", { beatId: "beat-alpha", forceHold: true }),
  {
    mode: "initialize",
    holdProgress: 0.15,
    contributorCount: 0,
    boundary: null,
    beatState: neutralPlaybackAsset.beatStates[0],
  },
  "an initial beat seeks once to its declared nonzero anchor",
);
assert.equal(
  sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "beat-alpha", "unmapped-animated-beat").mode,
  "none",
  "an unmapped animated beat remains static",
);
assert.equal(
  "startProgress" in sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "beat-alpha", "unmapped-animated-beat"),
  false,
  "an unmapped boundary never invents a full 0-1 scrub",
);

const neutralInactiveAsset = sourcePlaybackHelpers.normalizeSourcePlaybackAsset({
  assetId: "neutral-inactive.glb",
  mode: "shared-timeline",
  timeline: { durationSeconds: 8 },
  beatStates: [
    { beatId: "beat-one", presence: "inactive", entryMode: "inactive" },
    { beatId: "beat-two", presence: "inactive", entryMode: "inactive" },
  ],
  boundaries: [{ fromBeatId: "beat-one", toBeatId: "beat-two", mode: "none" }],
});
const neutralInactiveWindow = sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralInactiveAsset, "beat-one", "beat-two");
assert.equal(neutralInactiveWindow.mode, "none");
assert.equal(neutralInactiveAsset.beatStates[1].localProgress, null, "an absent contract progress is preserved rather than coerced to zero");
assert.equal(sourcePlaybackHelpers.sourcePlaybackWindowKeepsAssetActive(neutralInactiveWindow), false, "an inactive contracted destination is hidden after its model loads");
assert.equal(
  sourcePlaybackHelpers.sourcePlaybackWindowKeepsAssetActive({ mode: "none", boundary: { mode: "none" }, beatState: { presence: "active" } }),
  true,
  "an explicit active destination is not hidden merely because its boundary is static",
);
const neutralClearAsset = sourcePlaybackHelpers.normalizeSourcePlaybackAsset({
  assetId: "neutral-clear.glb",
  mode: "shared-timeline",
  timeline: { durationSeconds: 8 },
  beatStates: [{ beatId: "beat-two", presence: "active", localProgress: 0.5, entryMode: "hold" }],
  boundaries: [{ fromBeatId: "beat-one", toBeatId: "beat-two", mode: "clear" }],
});
const neutralClearWindow = sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralClearAsset, "beat-one", "beat-two");
assert.equal(neutralClearWindow.reason, "boundary-clear");
assert.equal(sourcePlaybackHelpers.sourcePlaybackWindowKeepsAssetActive(neutralClearWindow), false, "a clear boundary authoritatively removes the contracted model even if stale state says active");
assert.equal(
  sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralClearAsset, "beat-one", "beat-two", { forceHold: true }).reason,
  "boundary-clear",
  "forced hold cannot override an authored clear lifecycle boundary",
);

const neutralScrubWindow = sourcePlaybackHelpers.sourcePlaybackWindowForAsset(neutralPlaybackAsset, "beat-alpha", "beat-beta");
assert.equal(sourcePlaybackHelpers.sourcePlaybackScrubCycleSeconds(neutralPlaybackAsset, neutralScrubWindow, 2.63), 2.4, "shared-timeline scrub duration clamps long source spans to 2.4 seconds");
assert.equal(
  sourcePlaybackHelpers.sourcePlaybackScrubCycleSeconds({ ...neutralPlaybackAsset, timeline: { ...neutralPlaybackAsset.timeline, durationSeconds: 2 } }, neutralScrubWindow, 2.63),
  0.9,
  "shared-timeline scrub duration clamps short source spans to 0.9 seconds",
);
assert.equal(
  sourcePlaybackHelpers.sourcePlaybackScrubCycleSeconds({ ...neutralPlaybackAsset, mode: "independent" }, neutralScrubWindow, 2.63),
  2.63,
  "non-shared legacy playback preserves its fixed Transition duration",
);
assert.equal(sourcePlaybackHelpers.sourcePlaybackCameraIndex({ cameraIndex: null }), null, "an explicitly absent source camera is not coerced to camera zero");
assert.equal(sourcePlaybackHelpers.sourcePlaybackCameraIndex({ cameraIndex: 0 }), 0, "an explicitly declared camera zero remains valid");

const contractVisibilityHelpers = new Function(`
  function sourcePlaybackAssetForId() { return null; }
  ${functionSource("sourcePlaybackContractOwnsEntryVisibility")}
  return { sourcePlaybackContractOwnsEntryVisibility };
`)();
assert.equal(
  contractVisibilityHelpers.sourcePlaybackContractOwnsEntryVisibility({ sourcePlayback: { asset: { mode: "shared-timeline" } } }),
  true,
  "shared-timeline runtime ownership suppresses legacy part masks",
);

const configureSourcePlaybackAction = new Function(`
  const THREE = { LoopRepeat: "repeat", LoopPingPong: "ping-pong", LoopOnce: "once" };
  ${functionSource("configureSourcePlaybackAction")}
  return configureSourcePlaybackAction;
`)();
function neutralAction() {
  return {
    clampWhenFinished: false,
    reset() { this.resetCalled = true; },
    setLoop(mode, repetitions) { this.loop = { mode, repetitions }; },
    play() { this.playCalled = true; },
  };
}
const repeatPlayback = neutralAction();
configureSourcePlaybackAction(repeatPlayback, "repeat");
assert.deepEqual(repeatPlayback.loop, { mode: "repeat", repetitions: Infinity });
const pingPongPlayback = neutralAction();
configureSourcePlaybackAction(pingPongPlayback, "ping-pong");
assert.deepEqual(pingPongPlayback.loop, { mode: "ping-pong", repetitions: Infinity }, "canonical ping-pong playback remains coordinated on the shared timeline");
const oncePlayback = neutralAction();
configureSourcePlaybackAction(oncePlayback, "once");
assert.deepEqual(oncePlayback.loop, { mode: "once", repetitions: 1 });
assert.equal(oncePlayback.clampWhenFinished, true);

const genericBindingHelpers = new Function(`
  ${functionSource("finiteSourcePlaybackNumber")}
  ${functionSource("clampSourcePlaybackProgress")}
  ${functionSource("sourcePlaybackReadPath")}
  ${functionSource("sourcePlaybackBindingValue")}
  ${functionSource("sourcePlaybackRenderableNodes")}
  ${functionSource("snapVisibilityOpacityEndpoint")}
  ${functionSource("updatePreviewMaterialOpacity")}
  ${functionSource("updateSourceRenderableVisibility")}
  ${functionSource("sourcePlaybackDiagnostic")}
  ${functionSource("sourcePlaybackBindingMaterials")}
  ${functionSource("applySourcePlaybackMaterialOpaqueAtUniform")}
  ${functionSource("applySourcePlaybackMaterialUniform")}
  ${functionSource("applySourcePlaybackVisibility")}
  ${functionSource("applySourcePlaybackVisibilityOpacity")}
  ${functionSource("applySourcePlaybackDrawRange")}
  ${functionSource("applySourcePlaybackCameraFocalLength")}
  ${functionSource("applySourcePlaybackAnnotationOpacity")}
  return {
    applySourcePlaybackVisibilityOpacity,
    applySourcePlaybackMaterialUniform,
    applySourcePlaybackVisibility,
    applySourcePlaybackDrawRange,
    applySourcePlaybackCameraFocalLength,
    applySourcePlaybackAnnotationOpacity,
  };
`)();
const neutralDriver = { scale: { x: 0.5, z: 0.25 } };
const neutralMaterial = { opacity: 1, transparent: false, depthWrite: true, needsUpdate: false, userData: { storyvrBaseOpacity: 1, storyvrBaseTransparent: false, storyvrBaseDepthWrite: true, storyvrPreviewOpacity: 1 } };
const neutralMesh = { isMesh: true, visible: true, userData: {}, material: neutralMaterial };
const neutralTarget = { traverse(callback) { callback(neutralMesh); } };
const neutralRecipeMaterial = { uniforms: { time: { value: 0 }, showAmt: { value: 0 } } };
const neutralFadeMaterial = {
  uniforms: { fadeOpacity: { value: 0 } },
  opacity: 1,
  transparent: true,
  depthWrite: true,
  needsUpdate: false,
  userData: {
    storyvrBaseOpacity: 1,
    storyvrBaseTransparent: true,
    storyvrBaseDepthWrite: true,
    storyvrPreviewOpacity: 1,
    storyvrSourceBindingOpacity: 1,
    storyvrOpaqueAtUniform: { uniform: "fadeOpacity", threshold: 0.99 },
  },
};
const neutralRuntime = {
  diagnostics: [],
  diagnosticKeys: new Set(),
  annotations: new Map(),
  sourceCamera: null,
  clockSeconds: 1.25,
  materialRecipes: new Map([
    ["neutral-flow", { materials: [neutralRecipeMaterial] }],
    ["neutral-fade", { materials: [neutralFadeMaterial] }],
  ]),
};
genericBindingHelpers.applySourcePlaybackMaterialUniform({
  id: "neutral-wall-clock",
  binding: {
    operation: "material-uniform",
    source: { type: "wall-clock-time" },
    target: { material: "neutral-flow", uniform: "time" },
    parameters: { multiplier: 60 },
  },
  sourceNode: null,
  targetNode: null,
}, neutralRuntime);
assert.equal(neutralRecipeMaterial.uniforms.time.value, 75, "wall-clock material uniforms apply the declared numeric transform");
genericBindingHelpers.applySourcePlaybackMaterialUniform({
  id: "neutral-node-uniform",
  binding: {
    operation: "material-uniform",
    source: { path: "scale.x" },
    target: { material: "neutral-flow", uniform: "showAmt" },
  },
  sourceNode: neutralDriver,
  targetNode: null,
}, neutralRuntime);
assert.equal(neutralRecipeMaterial.uniforms.showAmt.value, 0.5, "node properties can drive recipe uniforms without story-specific code");
genericBindingHelpers.applySourcePlaybackMaterialUniform({
  id: "neutral-fade-transparency",
  binding: {
    operation: "material-uniform",
    source: { path: "scale.x" },
    target: { material: "neutral-fade", uniform: "fadeOpacity" },
  },
  sourceNode: neutralDriver,
  targetNode: null,
}, neutralRuntime);
assert.equal(neutralFadeMaterial.transparent, true, "the declared source fade remains transparent below its opaque threshold");
neutralDriver.scale.x = 1;
genericBindingHelpers.applySourcePlaybackMaterialUniform({
  id: "neutral-fade-opaque",
  binding: {
    operation: "material-uniform",
    source: { path: "scale.x" },
    target: { material: "neutral-fade", uniform: "fadeOpacity" },
  },
  sourceNode: neutralDriver,
  targetNode: null,
}, neutralRuntime);
assert.equal(neutralFadeMaterial.transparent, false, "the same generic rule restores opaque source rendering at the declared threshold");
assert.equal(neutralFadeMaterial.depthWrite, true, "opaque source rendering retains its declared depth-write policy");
neutralDriver.scale.x = 0.5;
genericBindingHelpers.applySourcePlaybackVisibilityOpacity({
  id: "neutral-opacity",
  binding: {
    sourcePath: "scale.x",
    operation: "visibility-opacity",
    parameters: { visibleThreshold: 0.01, maxOpacity: 0.3, recursive: true, min: 0, max: 1 },
  },
  sourceNode: neutralDriver,
  targetNode: neutralTarget,
}, neutralRuntime);
assert.equal(neutralMesh.visible, true);
assert.equal(neutralMaterial.opacity, 0.3, "nested visibility-opacity parameters compose into recursive materials");

neutralDriver.scale.x = 0.997827;
genericBindingHelpers.applySourcePlaybackVisibilityOpacity({
  id: "near-opaque-endpoint",
  binding: {
    sourcePath: "scale.x",
    operation: "visibility-opacity",
    parameters: { visibleThreshold: 0.01, maxOpacity: 1, recursive: true },
  },
  sourceNode: neutralDriver,
  targetNode: neutralTarget,
}, neutralRuntime);
assert.equal(neutralMaterial.userData.storyvrSourceBindingOpacity, 1, "near-complete full-opacity bindings snap to their endpoint");
assert.equal(neutralMaterial.opacity, 1);
assert.equal(neutralMaterial.transparent, false);
assert.equal(neutralMaterial.depthWrite, true, "the opaque endpoint restores authored depth writing");

genericBindingHelpers.applySourcePlaybackVisibilityOpacity({
  id: "configured-opacity-endpoint",
  binding: {
    sourcePath: "scale.x",
    operation: "visibility-opacity",
    parameters: { visibleThreshold: 0.01, maxOpacity: 1, fullOpacityThreshold: 0.999, recursive: true },
  },
  sourceNode: neutralDriver,
  targetNode: neutralTarget,
}, neutralRuntime);
assert.equal(neutralMaterial.opacity, 0.997827, "bindings can request a stricter full-opacity threshold");
assert.equal(neutralMaterial.transparent, true);
assert.equal(neutralMaterial.depthWrite, false);

neutralDriver.scale.x = 0.5;
genericBindingHelpers.applySourcePlaybackVisibilityOpacity({
  id: "genuine-opacity-fade",
  binding: {
    sourcePath: "scale.x",
    operation: "visibility-opacity",
    parameters: { visibleThreshold: 0.01, maxOpacity: 1, recursive: true },
  },
  sourceNode: neutralDriver,
  targetNode: neutralTarget,
}, neutralRuntime);
assert.equal(neutralMaterial.opacity, 0.5, "intermediate opacity remains a genuine fade");
assert.equal(neutralMaterial.transparent, true);
assert.equal(neutralMaterial.depthWrite, false);

neutralDriver.scale.x = 0.997827;
genericBindingHelpers.applySourcePlaybackVisibilityOpacity({
  id: "capped-translucency",
  binding: {
    sourcePath: "scale.x",
    operation: "visibility-opacity",
    parameters: { visibleThreshold: 0.01, maxOpacity: 0.3, recursive: true },
  },
  sourceNode: neutralDriver,
  targetNode: neutralTarget,
}, neutralRuntime);
assert.equal(neutralMaterial.opacity, 0.3, "near-one sources do not defeat deliberately capped translucency");
assert.equal(neutralMaterial.transparent, true);
assert.equal(neutralMaterial.depthWrite, false);

neutralDriver.scale.x = 0.5;

const neutralGeometry = {
  drawRange: { start: 0, count: Infinity },
  index: { count: 100 },
  attributes: {},
  userData: {},
  setDrawRange(start, count) { this.drawRange = { start, count }; },
};
genericBindingHelpers.applySourcePlaybackDrawRange({
  id: "neutral-range",
  binding: { sourcePath: "scale.z", operation: "draw-range", parameters: { min: 0, max: 1 } },
  sourceNode: neutralDriver,
  targetNode: { traverse(callback) { callback({ isLine: true, geometry: neutralGeometry }); } },
}, neutralRuntime);
assert.deepEqual(neutralGeometry.drawRange, { start: 0, count: 25 }, "draw-range progress is data-driven and geometry-neutral");

const neutralCamera = {
  isCamera: true,
  userData: {},
  getFocalLength() { return 35; },
  setFocalLength(value) { this.focalLength = value; },
  updateProjectionMatrix() {},
};
genericBindingHelpers.applySourcePlaybackCameraFocalLength({
  id: "neutral-focal",
  binding: { sourcePath: "scale.x", operation: "camera-focal-length", parameters: { base: "initial", multiplier: -10 } },
  sourceNode: neutralDriver,
  targetNode: neutralCamera,
}, neutralRuntime);
assert.equal(neutralCamera.focalLength, 30, "camera focal length follows its declared numeric mapping");

const neutralAnnotation = { sprite: { visible: false, material: { opacity: 0, transparent: true, depthWrite: false, userData: { storyvrBaseOpacity: 1, storyvrBaseTransparent: true, storyvrBaseDepthWrite: false, storyvrPreviewOpacity: 1 } } } };
neutralRuntime.annotations.set("neutral-note", neutralAnnotation);
genericBindingHelpers.applySourcePlaybackAnnotationOpacity({
  id: "neutral-annotation-opacity",
  binding: { sourcePath: "scale.x", operation: "annotation-opacity", annotationId: "neutral-note" },
  sourceNode: neutralDriver,
  targetNode: null,
}, neutralRuntime);
assert.equal(neutralAnnotation.sprite.material.opacity, 0.5, "annotation opacity follows the declared source without story-specific labels");

const classroomPlaybackAsset = classroomPlayback.assets[0];
assert.deepEqual(
  classroomPlaybackAsset.materials.slice(0, 6).map((material) => material.recipe),
  [
    "texture-background-fade",
    "texture-background-fade",
    "uv-stripe-flow",
    "texture-atlas-scalar-field",
    "texture-atlas-scalar-field",
    "texture-atlas-scalar-field",
  ],
  "classroom surfaces and airflow use reusable story-local material recipes",
);
const classroomFadeMaterials = classroomPlaybackAsset.materials.filter(
  (material) => material.recipe === "texture-background-fade",
);
assert.equal(classroomFadeMaterials.length, 2, "both classroom texture surfaces declare background fades");
assert.equal(classroomFadeMaterials.every((material) => Array.isArray(material.parameters?.backgroundColor)), true);
assert.deepEqual(classroomFadeMaterials.map((material) => material.render?.renderOrder), [1000, 1001]);
assert.equal(classroomFadeMaterials.every((material) => material.render?.depthWrite === true), true);
assert.equal(classroomFadeMaterials.every((material) => material.render?.opaqueAtUniform?.uniform === "fadeOpacity"), true);
assert.equal(
  classroomPlaybackAsset.bindings.filter((binding) => binding.operation === "material-uniform" && binding.target?.uniform === "fadeOpacity").length,
  2,
  "classroom drivers feed both surface fade uniforms",
);
const layeredSliceMaterials = classroomPlaybackAsset.materials.filter(
  (material) => material.recipe === "layered-texture-atlas-scalar-field",
);
assert.equal(layeredSliceMaterials.length, 10, "each source slice declares the reusable layered-atlas recipe");
assert.equal(layeredSliceMaterials.every((material) => material.parameters?.atlasColumns && material.parameters?.atlasRows), true);
assert.equal(layeredSliceMaterials.every((material) => Array.isArray(material.parameters?.colorRamp)), true);
assert.equal(
  classroomPlaybackAsset.bindings.filter((binding) => binding.operation === "visibility-opacity" && /^slice_target_/.test(binding.target?.node || "")).length,
  0,
  "slice layers do not route their intrinsically translucent shader through generic opacity state",
);
assert.equal(
  classroomPlaybackAsset.bindings.filter((binding) => binding.operation === "visibility" && /^slice_target_/.test(binding.target?.node || "")).length,
  10,
  "slice visibility remains a declarative driver gate",
);
assert.equal(
  classroomPlaybackAsset.bindings.some((binding) => binding.operation === "draw-range" && /tracer_target/.test(binding.target?.node || "")),
  false,
  "classroom tracer progress no longer truncates triangle index buffers",
);
assert.equal(
  classroomPlaybackAsset.bindings.filter((binding) => binding.operation === "material-uniform").length,
  30,
  "classroom driver nodes feed shader uniforms declaratively",
);

const layeredMaterialFactory = functionSource("createSourcePlaybackMaterial");
assert.match(layeredMaterialFactory, /recipe === "layered-texture-atlas-scalar-field"/);
assert.match(layeredMaterialFactory, /atlasColumns[\s\S]*atlasRows[\s\S]*sampleCount/);
assert.match(layeredMaterialFactory, /sourcePlaybackScalarFieldColorShader\(parameters\.colorRamp\)/);
assert.match(layeredMaterialFactory, /uniform float sliceY;[\s\S]*uniform float showAmt;/);
assert.doesNotMatch(
  layeredMaterialFactory,
  /slice_target_|slice_driver_|concentration-slice|classroom/,
  "the layered-atlas renderer contains no story-specific selectors or values",
);

console.log("interactive preview consistency checks passed");
