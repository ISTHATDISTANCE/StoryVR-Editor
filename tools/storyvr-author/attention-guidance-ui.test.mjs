import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");
const engineSource = await readFile(new URL("./engine.mjs", import.meta.url), "utf8");

function functionSource(name) {
  const plain = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = plain === -1 ? asyncStart : asyncStart === -1 ? plain : Math.min(plain, asyncStart);
  assert.notEqual(start, -1, `${name} exists`);
  const nextPlain = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextPlain, nextAsync].filter((value) => value !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("Attention Guidance uses a full-width beat and variant story canvas", () => {
  const dispatch = functionSource("renderComponentWorkspace");
  const workspace = functionSource("renderAttentionGuidanceWorkspace");
  const canvas = functionSource("renderAttentionStoryCanvas");
  const card = functionSource("renderAttentionStoryCard");
  const events = functionSource("bindAttentionGuidanceEvents");

  assert.match(dispatch, /ATTENTION_GUIDANCE_COMPONENT_ID\) return renderAttentionGuidanceWorkspace/);
  assert.match(workspace, /if \(!sceneContext\) return renderAttentionGuidanceCanvasWorkspace/);
  assert.match(canvas, /data-attention-story-canvas-viewport/);
  assert.match(card, /data-attention-open-scene/);
  assert.match(card, /data-attention-variant-group-id/);
  assert.match(card, /data-attention-variant-option-id/);
  assert.match(events, /variantOptionId:\s*button\.dataset\.attentionVariantOptionId/);
  assert.match(styles, /\.attention-canvas-mode\s*\{[^}]*width:\s*100%/s);
});

test("Attention beat editors create browser entries that return to the Attention canvas", () => {
  const open = functionSource("openAttentionSceneEditor");
  const close = functionSource("closeAttentionSceneEditor");
  const apply = functionSource("applyStoryvrBrowserNavigation");
  const returnToCanvas = functionSource("returnToAttentionCanvasWithBrowserHistory");

  assert.match(open, /pushStoryvrBrowserNavigation/);
  assert.match(open, /createStoryvrNavigationRoute\(ATTENTION_GUIDANCE_COMPONENT_ID, normalized\)/);
  assert.match(open, /parentEntryId:\s*currentEntry\?\.entryId/);
  assert.match(apply, /navigation\.componentId === ATTENTION_GUIDANCE_COMPONENT_ID/);
  assert.match(apply, /state\.attentionEditorScene = navigation\.editorScene/);
  assert.match(apply, /data-attention-story-canvas-viewport/);
  assert.match(returnToCanvas, /window\.history\.back\(\)/);
  assert.match(returnToCanvas, /replaceStoryvrBrowserNavigation\(canvasNavigation\)/);
  assert.ok(close.indexOf("flushAttentionGuidanceAutosave") < close.indexOf("returnToAttentionCanvasWithBrowserHistory"));
});

test("Attention Guidance canvas omits the explanatory header and summary banners", () => {
  const canvasWorkspace = functionSource("renderAttentionGuidanceCanvasWorkspace");

  assert.doesNotMatch(canvasWorkspace, /Spheres are never rendered in the story/i);
  assert.doesNotMatch(canvasWorkspace, /Dual-channel attention guidance/i);
  assert.doesNotMatch(canvasWorkspace, /attention-inference-summary/);
});

test("Attention Guidance story cards do not expose scene-opening progress", () => {
  const card = functionSource("renderAttentionStoryCard");

  assert.doesNotMatch(card, /evaluated|markerCount|clear target|status\.className|needs-review|inferred|edited|attention-empty/i);
  assert.doesNotMatch(card, /attention-scene-card-footer/);
  assert.doesNotMatch(styles, /\.attention-story-beat-card\.(?:needs-review|inferred|edited|attention-empty)/);
});

test("the editor inherits current saved Spatial Relations and Environment while exposing translate only", () => {
  const initializer = functionSource("initializeAttentionGuidanceViewer");
  const viewport = functionSource("renderAttentionGuidanceViewport");

  assert.match(initializer, /lockedSpatialRelationsContract\(\)/);
  assert.match(functionSource("lockedSpatialRelationsContract"), /checkpointIsCurrent/);
  assert.match(initializer, /spatialSceneEntities\(spatialContract, sceneContext\)/);
  assert.match(initializer, /attachLockedEnvironmentToViewer\(viewer\)/);
  assert.doesNotMatch(initializer, /spatialEntityType\(entity\) === "text-panel"/);
  assert.doesNotMatch(initializer, /makeTextComfortPanel/);
  assert.match(initializer, /transformControls\.setMode\("translate"\)/);
  assert.match(initializer, /transformControls\.setSpace\("world"\)/);
  assert.doesNotMatch(initializer, /transformControls\.setMode\("rotate"\)|transformControls\.setMode\("scale"\)/);
  assert.match(viewport, /Move only/);
  assert.match(viewport, /no controls to rotate, scale, add, delete, or move story objects/i);
  assert.doesNotMatch(viewport, /data-spatial-transform-mode="rotate"|data-spatial-transform-mode="scale"|data-attention-delete/);
});

test("authors can add one validated standalone target sphere for a visible scene GLB", () => {
  const hierarchy = functionSource("renderAttentionMarkerHierarchy");
  const options = functionSource("attentionManualTargetOptions");
  const available = functionSource("attentionAvailableManualTargetOptions");
  const sync = functionSource("syncAttentionManualTargetControls");
  const add = functionSource("addManualAttentionTarget");
  const events = functionSource("bindAttentionGuidanceEvents");
  const candidatePosition = functionSource("attentionCandidatePosition");
  const mutation = functionSource("mutateSelectedAttentionMarker");

  assert.match(hierarchy, /data-attention-manual-target/);
  assert.match(hierarchy, /data-attention-add-manual/);
  assert.match(hierarchy, /Add target sphere/);
  assert.match(options, /manualTargetOptions/);
  assert.match(options, /targetKind === "standalone-glb"/);
  assert.match(available, /!markerIds\.has\(candidate\.id\)/);
  assert.match(sync, /attentionCandidatePosition\(viewer, candidate\)/);
  assert.match(candidatePosition, /candidate\?\.entityId/);
  assert.match(functionSource("attentionCandidateMeshes"), /mode === "shared-timeline" && !manuallySelected/);
  assert.match(add, /source: "author-manual-attention-target"/);
  assert.match(add, /scene\.candidates = dedupeAttentionCandidates/);
  assert.match(add, /scene\.markers =/);
  assert.match(add, /commitAttentionDraftMutation\(\{ immediate: true \}\)/);
  assert.match(mutation, /authorCreated \|\|/);
  assert.match(events, /addManualAttentionTarget/);
  assert.match(styles, /\.attention-manual-target-controls/);
});

test("markers materialize only from narrow visible rendered GLB geometry", () => {
  const selector = functionSource("attentionSelectorIsNarrow");
  const material = functionSource("attentionRenderableHasVisibleMaterial");
  const visible = functionSource("attentionRenderableIsVisible");
  const meshes = functionSource("attentionCandidateMeshes");
  const position = functionSource("attentionCandidatePosition");
  const evaluate = functionSource("evaluateAttentionGuidanceScene");

  assert.match(selector, /\\\*\{\}|\\\.\\\.|plus/);
  assert.match(material, /material\?\.visible !== false/);
  assert.match(material, /material\?\.colorWrite !== false/);
  assert.match(material, /opacity[\s\S]*0\.02/);
  assert.match(visible, /!object\?\.isMesh/);
  assert.match(visible, /while \(current\)[\s\S]*current\.visible === false/);
  assert.match(meshes, /mode === "shared-timeline" && !manuallySelected \? \[\] : visibleMeshes/);
  assert.match(meshes, /sourcePartSelectorMatchesNode\(candidate\.partSelector, object, root\)/);
  assert.match(position, /new THREE\.Box3\(\)\.setFromObject\(mesh, true\)/);
  assert.match(position, /viewer\.root\.worldToLocal\(center\)/);
  assert.match(evaluate, /attentionCandidatePosition\(viewer, candidate\)/);
  assert.ok(evaluate.indexOf("attentionCandidatePosition") < evaluate.indexOf("mountAttentionMarkerObject"));
});

test("exact part candidates stay independent and ambiguous selectors cannot become spheres", () => {
  const meshes = functionSource("attentionCandidateMeshes");
  const selector = functionSource("attentionSelectorIsNarrow");
  const selectorPredicate = new Function(`${selector}; return attentionSelectorIsNarrow;`)();

  assert.match(meshes, /candidate\.partSelector/);
  assert.doesNotMatch(meshes, /expandSourcePartSelectors/);
  assert.match(selector, /!\/\[\\\*\{\}\]\|\\\.\\\.|\\s\+plus/);
  assert.equal(selectorPredicate("classroom/window_1"), true);
  assert.equal(selectorPredicate("classroom/window_2"), true);
  assert.equal(selectorPredicate("classroom/{window_1,window_2}"), false);
  assert.equal(selectorPredicate("classroom/{classroom_target_*,walls,window_1,window_2}"), false);
  assert.match(source, /named-renderable-part/);
  assert.match(functionSource("renderAttentionEmptyTargets"), /No focus marker needed/);
  assert.doesNotMatch(functionSource("renderAttentionEmptyTargets"), /runtime changes|beat semantics/i);
});

test("evaluated-empty scenes and finite scene-space markers persist through the draft route", () => {
  const normalizePosition = functionSource("attentionPosition");
  const evaluate = functionSource("evaluateAttentionGuidanceScene");
  const savedContract = functionSource("attentionGuidanceForSave");
  const persist = functionSource("persistAttentionGuidanceDraft");
  const close = functionSource("closeAttentionSceneEditor");
  const parsePosition = new Function(`${normalizePosition}; return attentionPosition;`)();

  assert.match(normalizePosition, /typeof coordinate === "number" && Number\.isFinite\(coordinate\)/);
  assert.deepEqual(parsePosition({ x: 0, y: -1.25, z: 3 }), { x: 0, y: -1.25, z: 3 });
  assert.deepEqual(parsePosition([0, 1, 2]), { x: 0, y: 1, z: 2 });
  assert.equal(parsePosition({ x: null, y: 1, z: 2 }), null);
  assert.equal(parsePosition({ x: "", y: 1, z: 2 }), null);
  assert.equal(parsePosition({ x: "0", y: 1, z: 2 }), null);
  assert.equal(parsePosition({ x: Number.POSITIVE_INFINITY, y: 1, z: 2 }), null);
  assert.match(evaluate, /scene\.markers = markers/);
  assert.match(evaluate, /scene\.evaluated = true/);
  assert.match(evaluate, /status: "evaluated"/);
  assert.match(savedContract, /clean\.coordinateSpace = "spatial-scene"/);
  assert.match(persist, /\/api\/decisions\/\$\{ATTENTION_GUIDANCE_COMPONENT_ID\}\/draft/);
  assert.match(persist, /attentionGuidance: attentionGuidanceForSave\(\)/);
  assert.match(close, /await flushAttentionGuidanceAutosave\(\{ force: true \}\)/);
  assert.ok(close.indexOf("flushAttentionGuidanceAutosave") < close.indexOf("returnToAttentionCanvasWithBrowserHistory"));
  assert.doesNotMatch(close, /state\.attentionEditorScene = null/, "the matching Attention canvas history entry owns editor teardown");
});

test("saving does not require authors to open every Attention Guidance scene", () => {
  const workspace = functionSource("renderAttentionGuidanceWorkspace");
  const canvas = functionSource("renderAttentionGuidanceCanvasWorkspace");
  const storyCanvas = functionSource("renderAttentionStoryCanvas");
  const action = functionSource("handleAction");

  assert.match(workspace, /renderCheckpointActions\(component, decision, \{ canCommit: ready \}\)/);
  assert.match(canvas, /renderCheckpointActions\(component, decision, \{ canCommit: ready \}\)/);
  assert.doesNotMatch(canvas, /remaining|evaluated scene|zero spheres|evaluationSummary/i);
  assert.doesNotMatch(storyCanvas, /click any beat|validate visible targets|evaluated|opened|not evaluated/i);
  assert.doesNotMatch(action, /Open and evaluate the remaining|evaluationSummary\.pending/i);
  assert.doesNotMatch(source, /function attentionGuidanceEvaluationSummary|function attentionSceneCardStatus/);
  assert.doesNotMatch(engineSource, /assertAttentionGuidanceEvaluated|ATTENTION_SCENE_NOT_EVALUATED|Evaluate every Attention Guidance/i);
});

test("suggested target sets are accepted automatically without a review banner or save gate", () => {
  const normalize = functionSource("attentionSceneReconciliation");
  const draft = functionSource("ensureAttentionGuidanceDraft");
  const savedContract = functionSource("attentionGuidanceForSave");
  const evaluate = functionSource("evaluateAttentionGuidanceScene");
  const events = functionSource("bindAttentionGuidanceEvents");
  const canvas = functionSource("renderAttentionGuidanceCanvasWorkspace");
  const action = functionSource("handleAction");

  assert.match(normalize, /reviewed:\s*true/);
  assert.match(draft, /reconciliation:\s*attentionSceneReconciliation\(sourceScene\)/);
  assert.match(savedContract, /scene\.reconciliation = attentionSceneReconciliation\(scene\)/);
  assert.match(evaluate, /scene\.reconciliation = attentionSceneReconciliation\(scene\)/);
  assert.doesNotMatch(events, /data-attention-mark-reviewed/);
  assert.doesNotMatch(canvas, /unreviewed|review and accept/i);
  assert.doesNotMatch(action, /unreviewed|review and accept/i);
  assert.doesNotMatch(source, /Accept suggested targets|Check suggested attention targets|Review required|Suggested targets reviewed/);
  assert.doesNotMatch(styles, /\.attention-review-panel|\.attention-review-action|\.attention-reviewed-badge|\.attention-review-required/);
  assert.match(engineSource, /reviewed:\s*true/);
  assert.doesNotMatch(engineSource, /ATTENTION_TARGET_REVIEW_REQUIRED|Review and accept every suggested Attention Guidance target set/);
});

test("attention spheres are explicit authoring-only overlays", () => {
  const sphere = functionSource("makeAttentionMarkerObject");
  const workspace = functionSource("renderAttentionGuidanceWorkspace");

  assert.match(sphere, /SphereGeometry/);
  assert.match(sphere, /attentionMarkerId/);
  assert.match(workspace, /Setup marker only/);
  assert.match(styles, /\.attention-authoring-only-badge/);
});

test("the UI consumes engine-provided runtime and semantic candidates without deriving text matches", () => {
  const normalize = functionSource("normalizeAttentionCandidate");
  const channels = functionSource("attentionSceneChannelCandidates");
  const draft = functionSource("ensureAttentionGuidanceDraft");
  const evaluate = functionSource("evaluateAttentionGuidanceScene");

  assert.match(normalize, /value\.channels/);
  assert.match(normalize, /value\.reconciliationStatus/);
  assert.match(normalize, /value\.reviewRequired/);
  assert.match(channels, /"runtimeCandidates"/);
  assert.match(channels, /"semanticCandidates"/);
  assert.match(channels, /attentionSceneCandidates\(scene\)\.filter/);
  assert.doesNotMatch(channels, /beat|text|caption|token|similar|match/i);
  assert.match(draft, /candidates:\s*attentionSceneCandidates\(sourceScene\)/);
  assert.doesNotMatch(draft, /runtimeCandidates\s*=|semanticCandidates\s*=/);
  assert.match(evaluate, /const candidates = attentionSceneCandidates\(scene\)/);
  assert.match(evaluate, /channels: candidate\.channels/);
  assert.match(evaluate, /reconciliationStatus: candidate\.reconciliationStatus/);
  assert.match(evaluate, /reviewRequired: candidate\.reviewRequired/);
});

test("dual-channel reconciliation stays internal while suggestions are directly accepted", () => {
  const status = functionSource("attentionReconciliationStatus");
  const presentation = functionSource("attentionReconciliationPresentation");
  const inspector = functionSource("renderAttentionGuidanceInspector");
  const workspace = functionSource("renderAttentionGuidanceWorkspace");
  const canvas = functionSource("renderAttentionGuidanceCanvasWorkspace");
  const card = functionSource("renderAttentionStoryCard");

  for (const value of ["confirmed", "compatible", "runtime-only", "semantic-only", "conflict", "unresolved"]) {
    assert.match(source, new RegExp(`"${value}"`));
  }
  assert.match(status, /ATTENTION_RECONCILIATION_STATUSES\.has/);
  assert.match(presentation, /provisional:\s*status === "runtime-only" \|\| status === "semantic-only"/);
  assert.doesNotMatch(inspector, /data-attention-inference-copy|candidate\?\.channels|Runtime \+ semantic|JS runtime|Semantic evidence|Provisional/);
  assert.doesNotMatch(workspace, /reconciled runtime and semantic|Both inference channels|Runtime and semantic targets disagree/);
  assert.doesNotMatch(canvas, /compare JS runtime changes with semantic targets|one-sided or conflicting inference/);
  assert.doesNotMatch(card, /attention-reconciliation-badge|reconciliationPresentation/);
  assert.doesNotMatch(source, /attention-target-reconciliation|class="[^"]*is-conflict/);
  assert.doesNotMatch(styles, /\.attention-reconciliation-panel|\.attention-evidence-channel|\.attention-target-evidence-columns/);
  assert.doesNotMatch(styles, /\.attention-target-reconciliation|\.attention-empty-targets\.is-conflict/);
  assert.doesNotMatch(source, /renderAttentionSceneReconciliation|markAttentionSceneReviewed|data-attention-mark-reviewed/);
  assert.doesNotMatch(styles, /\.attention-review-panel|\.attention-review-required/);
  assert.doesNotMatch(engineSource, /runtime\/semantic mismatch|unreviewed runtime\/semantic/);
  assert.match(engineSource, /reviewed:\s*true/);
});

test("empty target copy distinguishes no inference, live rejection, pending validation, and conflict", () => {
  const empty = functionSource("renderAttentionEmptyTargets");
  const diagnostics = functionSource("attentionSceneDiagnostics");
  const workspace = functionSource("renderAttentionGuidanceWorkspace");

  assert.match(empty, /reconciliation\.status === "conflict"/);
  assert.match(empty, /No focus marker was added/);
  assert.match(empty, /suggestions did not match a visible object/);
  assert.match(empty, /rejectedCandidateCount/);
  assert.match(empty, /Suggested focus is not visible/);
  assert.match(empty, /Checking suggested focus/);
  assert.match(empty, /No focus marker needed/);
  assert.doesNotMatch(empty, /Runtime changes|beat semantics|evidence channels|engine-provided/);
  assert.doesNotMatch(empty, /No default sphere|no clearly resolved visible GLB/i);
  assert.match(diagnostics, /code: "live-geometry-rejected"/);
  assert.match(diagnostics, /channel: "validation"/);
  assert.doesNotMatch(diagnostics, /code: "live-geometry-rejected",\s*channel: "runtime"/);
  assert.match(workspace, /suggestion does not match a visible object/);
  assert.match(workspace, /suggestion could not be placed on a visible object/);
  assert.doesNotMatch(workspace, /Runtime and semantic|inference channels|engine inferred/);
});
