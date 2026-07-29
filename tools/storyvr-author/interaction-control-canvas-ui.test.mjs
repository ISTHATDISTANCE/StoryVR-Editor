import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

function sourceFunction(name, text = source) {
  const plain = text.indexOf(`function ${name}(`);
  const asyncStart = text.indexOf(`async function ${name}(`);
  const start = plain === -1 ? asyncStart : asyncStart === -1 ? plain : Math.min(plain, asyncStart);
  assert.notEqual(start, -1, `${name} exists`);
  const nextPlain = text.indexOf("\nfunction ", start + 1);
  const nextAsync = text.indexOf("\nasync function ", start + 1);
  const candidates = [nextPlain, nextAsync].filter((value) => value !== -1);
  const end = candidates.length ? Math.min(...candidates) : text.length;
  return text.slice(start, end);
}

test("Interaction Control gets the single-workspace shell and a canvas-first landing page", () => {
  const render = sourceFunction("render");
  const workspace = sourceFunction("renderInteractionControlWorkspace");
  const canvas = sourceFunction("renderInteractionControlCanvasWorkspace");

  assert.match(render, /const isInteractionControl = active\.id === "interaction-control"/);
  assert.match(render, /const showSidebar = [^\n]*!isInteractionControl/);
  assert.match(render, /showSidebar \? "authoring-layout" : "single-workspace-layout"/);
  assert.match(workspace, /const sceneContext = activeInteractionSceneContext\(\)/);
  assert.match(workspace, /interactionControlDraft/);
  assert.match(workspace, /canEdit|unlocked/);
  assert.doesNotMatch(workspace, /canGenerate/);
  assert.match(workspace, /if \(!sceneContext\) return renderInteractionControlCanvasWorkspace\(/);
  assert.match(workspace, /renderInteractionControlEditorWorkspace\([^)]*sceneContext/);
  assert.doesNotMatch(workspace, /state\.data\?\.proposals\?\.\[component\.id\]/);

  assert.match(canvas, /data-interaction-workspace-mode="canvas"/);
  assert.doesNotMatch(canvas, /renderGenerateOptionsButton|Generate options|Regenerate/);
  assert.match(canvas, /renderInteractionStoryCanvas\(baseProposal, boundaryContext\)/);
  assert.match(canvas, /interactionBoundaryContextIsComplete\(boundaryContext\)/);
  assert.match(canvas, /participantBlockingDependencyLabel\(component\.id\)/);
  assert.doesNotMatch(canvas, /renderInteractionPreview|renderInteractionInspector|data-interaction-viewer/);
});

test("plain beat and variant card clicks open the exact in-beat interaction editor", () => {
  const card = sourceFunction("renderInteractionStoryCard");
  const binder = sourceFunction("bindInteractionControlCanvasEvents");
  const open = sourceFunction("openInteractionSceneEditor");
  const editorContext = sourceFunction("interactionOptionEditorContext");
  const editor = sourceFunction("renderInteractionControlEditorWorkspace");
  const beatBindingStart = binder.indexOf('for (const button of document.querySelectorAll("[data-interaction-open-scene]"))');
  const beatBindingEnd = binder.indexOf('document.querySelector("[data-interaction-close-editor]")', beatBindingStart);
  const beatBinding = binder.slice(beatBindingStart, beatBindingEnd);

  assert.ok(beatBindingStart >= 0 && beatBindingEnd > beatBindingStart, "plain beat-card click binding exists");
  assert.match(card, /data-interaction-open-scene/);
  assert.match(card, /data-interaction-beat-id="\$\{escapeHtml\(context\.beatId\)\}"/);
  assert.match(card, /context\.variantGroupId \? `data-interaction-variant-group-id=/);
  assert.match(card, /context\.variantOptionId \? `data-interaction-variant-option-id=/);
  assert.match(beatBinding, /openInteractionSceneEditor\(\{[\s\S]*beatId:[\s\S]*variantGroupId:[\s\S]*variantOptionId:[\s\S]*\}\)/);
  assert.doesNotMatch(beatBinding, /interactionTargetType|interactionTargetId|interactionKind/,
    "a card click carries only the exact base or variant scene context");
  assert.match(open, /const normalized = spatialSceneContext\(context\?\.beatId, context\?\.variantGroupId, context\?\.variantOptionId\)/);
  assert.match(open, /createStoryvrNavigationRoute\("interaction-control", normalized\)/);
  assert.match(editorContext, /if \(sceneContext\.interactionTargetType !== "boundary"\) \{[\s\S]*targetType: "in-beat"/);
  assert.match(editorContext, /targetId: interactionInBeatSceneKey\(sceneContext\)/);
  assert.match(editorContext, /record: interactionInBeatRecordForContext\(sceneContext\)/);
  assert.match(editorContext, /sceneContext,[\s\S]*targetSceneContext: sceneContext/);
  assert.match(editor, /const inBeatEditor = editorContext\?\.targetType === "in-beat"/);
  assert.match(editor, /inBeatEditor[\s\S]*renderInteractionInBeatEditor\(editorContext\)/);
});

test("the Interaction canvas renders every beat and parallel variant while boundary arrows own policy status", () => {
  const canvas = sourceFunction("renderInteractionStoryCanvas");
  const variantLinks = sourceFunction("renderStoryVariantLinkLayer");
  const beat = sourceFunction("renderInteractionStoryBeat");
  const card = sourceFunction("renderInteractionStoryCard");
  const connector = sourceFunction("renderInteractionBoundaryConnector");
  const status = sourceFunction("interactionBoundaryVisualStatus");
  const boundaryContext = sourceFunction("interactionBoundaryContext");
  const progressionEdges = sourceFunction("interactionProgressionEdges");
  const variantLayout = sourceFunction("layoutStoryVariantLinks");

  assert.match(canvas, /const beats = state\.data\?\.graph\?\.beats \|\| \[\]/);
  assert.match(canvas, /renderStoryVariantLinkLayer\("interaction", proposal, boundaryContext\)/);
  assert.match(canvas, /data-story-variant-canvas-viewport/);
  assert.match(variantLinks, /data-story-variant-interaction-label/);
  assert.match(variantLinks, /class="story-variant-interaction-label \$\{escapeHtml\(effectiveKind \|\| "unassigned"\)\} \$\{needsAssignment \? "needs-interaction-assignment" : ""\}"/);
  assert.match(variantLinks, /data-story-variant-interaction-label-width="196"/);
  assert.match(variantLinks, /data-story-variant-interaction-label-height="72"/);
  assert.match(variantLinks, /width="196"/);
  assert.match(variantLinks, /height="72"/);
  assert.match(variantLinks, /<select[^>]*data-story-variant-interaction-policy-select/);
  assert.match(variantLinks, /data-interaction-variant-edge-id="\$\{escapeHtml\(edge\.id\)\}"/);
  assert.match(variantLinks, /const interactionLabelEdges = interactionLabels \? edges : \[\]/);
  assert.match(variantLinks, /const progression = sourceGraphIsVariantProgression\(edge\)/);
  assert.match(variantLinks, /interactionBoundaryControlForEdge\(edge, interactionContext\)/);
  assert.match(variantLinks, /data-interaction-boundary-policy-select data-interaction-boundary-id/);
  assert.doesNotMatch(variantLinks, /storyVariantInteractionLabelEdges\(/);
  assert.match(variantLinks, /storyVariantProgressionFanGroups\(edges\)/);
  assert.match(variantLinks, /data-story-variant-progression-bus="\$\{escapeHtml\(key\)\}"/,
    "parallel Interaction routes render one candidate fan bus for their shared destination");
  assert.match(variantLinks, /story-variant-progression-bus-trunk/);
  assert.match(variantLinks, /story-variant-progression-bus-arrow" marker-end=/,
    "the shared destination segment owns the fan's only arrowhead");
  assert.match(variantLinks, /progressionFanKey \? "data-story-variant-progression-branch" : `marker-end=/,
    "per-route fan branches are markerless while manual switches remain ordinary arrows");
  assert.match(variantLayout, /dataset\.storyVariantInteractionLabelWidth/);
  assert.match(variantLayout, /dataset\.storyVariantInteractionLabelHeight/);
  assert.match(variantLayout, /getPropertyValue\("--interaction-variant-pair-clearance"\)/);
  assert.match(variantLayout, /trunkOffset:\s*32 \+ variantPairClearance/,
    "the shared progression trunk stays put while consecutive variant columns gain label clearance");
  assert.match(variantLayout, /storyVariantProgressionFanGeometry\(fanRoutes, \{/);
  assert.match(variantLayout, /const fanBranch = fanBranches\.get\(edge\.id\) \|\| null/);
  assert.match(variantLayout, /interactionLabel\.setAttribute\("x", String\(fanBranch\.label\.x\)\)/);
  assert.match(variantLayout, /interactionLabel\.setAttribute\("y", String\(fanBranch\.label\.y\)\)/,
    "each exact Interaction control uses its data-sized position above its own horizontal branch");
  assert.match(variantLayout, /if \(fanBranch\) routePath\?\.removeAttribute\("marker-end"\)/);
  assert.match(variantLayout, /else routePath\?\.setAttribute\([\s\S]*"marker-end",[\s\S]*problemMarkerReference : markerReference/,
    "a manual switch or rejected fan candidate keeps its individual arrowhead");
  for (const label of ["Controller button press", "UI button press", "Direct manipulation", "Reader locomotion"]) {
    assert.match(variantLinks, new RegExp(label));
  }
  assert.match(canvas, /beats\.map\(\(beat, index\) => renderInteractionStoryBeat\([\s\S]*beats\[index \+ 1\] \|\| null/);
  assert.match(beat, /sourceGraphDefaultVariantOption\(group\)/);
  assert.match(beat, /const nextGroup = nextBeat \? variantGroupForBeat\(nextBeat\) : null/);
  assert.match(beat, /\$\{group && nextGroup \? "has-variant-successor" : ""\}/);
  assert.match(beat, /const alternatives = group && defaultOption/);
  assert.match(beat, /interaction-story-variant-alternatives/);
  assert.match(beat, /Parallel Interaction Control scenes/);
  assert.match(beat, /alternatives\.map\(\(option\) =>/);
  assert.match(beat, /outgoingBoundaries = boundaryContext\.boundaries\.filter/);
  assert.match(beat, /boundary\.fromBeatId === beat\.id && !boundary\.fromContext\?\.variantOptionId/,
    "only non-variant routes use the legacy connector column; each variant route stays on its source card");
  assert.match(beat, /renderInteractionStoryCard\(beat, defaultOption, primaryContext/);
  assert.match(beat, /spatialSceneContext\(beat\.id, group\.id, option\.id\)/);
  assert.match(beat, /renderInteractionBoundaryConnector\(boundary, boundary\.from, boundary\.to\)/);
  assert.match(
    styles,
    /\.interaction-story-beat-item\.has-connector\.has-variant-successor\s*\{[^}]*--interaction-variant-pair-clearance:\s*120px;/s,
    "only consecutive variant-bearing Interaction beat columns receive the extra horizontal span",
  );
  assert.match(
    styles,
    /\.interaction-story-beat-item\.has-connector\s*\{[^}]*--interaction-transition-span:\s*calc\(340px \+ var\(--interaction-variant-pair-clearance\)\);/s,
    "the desktop connector column consumes the conditional clearance without overriding the narrow stack",
  );

  assert.match(progressionEdges, /sourceGraphTransitionEdges\(state\.data\?\.graph\)/);
  assert.match(progressionEdges, /sourceGraphIsStoryProgression\(edge\)/);
  assert.match(boundaryContext, /interactionProgressionEdges\(\)\.flatMap\(\(edge\) =>/);
  assert.match(boundaryContext, /const fromContext = sourceGraphTransitionSceneContext\(edge\.from\)/);
  assert.match(boundaryContext, /const toContext = sourceGraphTransitionSceneContext\(edge\.to\)/);
  assert.match(boundaryContext, /const exactRecord = records\.get\(edge\.id\)/);
  assert.match(boundaryContext, /const boundaryId = edge\.id/);
  assert.match(boundaryContext, /edgeId:\s*edge\.id/);
  assert.match(boundaryContext, /fromContext,/);
  assert.match(boundaryContext, /toContext,/);
  assert.match(boundaryContext, /boundaries\.find\(\(candidate\) => candidate\.boundaryId === sceneContext\.interactionTargetId\)/,
    "opening a progression control restores the exact directed route");

  assert.match(card, /interactionPreviewBeatForSceneContext\(proposal, context\)/);
  assert.match(card, /data-interaction-open-scene/);
  assert.match(card, /data-interaction-beat-id="\$\{escapeHtml\(context\.beatId\)\}"/);
  assert.match(card, /data-interaction-variant-group-id="\$\{escapeHtml\(context\.variantGroupId\)\}"/);
  assert.match(card, /data-interaction-variant-option-id="\$\{escapeHtml\(context\.variantOptionId\)\}"/);
  assert.match(card, /renderStoryVariantCardAttributes\(context\)/);
  assert.match(card, /renderSpatialStoryAsset\(assetId\)/);
  assert.match(card, /linkedAssetIds\.map\(\(assetId\) => renderSpatialStoryAsset\(assetId\)\)/);
  assert.doesNotMatch(card, /linkedAssetIds\.slice\(/, "every linked scene asset gets a thumbnail");
  assert.match(card, /<span class="topology-kind-pill variant-selection">Variant interactions<\/span>/);
  assert.match(card, /const variantArrowCount = variantControl/);
  assert.match(card, /interactionVariantSwitchEdges\(\)\.filter\(\(edge\) => edge\.from\?\.variantGroupId === variantControl\.variantGroupId\)\.length/);
  assert.match(card, /\$\{variantArrowCount\} directed arrow\$\{variantArrowCount === 1 \? "" : "s"\}/);
  assert.doesNotMatch(card, /variantControl\.effectivePolicy/,
    "a group card cannot truthfully summarize independently assigned directed arrows with one policy");
  assert.doesNotMatch(card, /boundary\.effectivePolicy/, "beat cards remain neutral scene selectors");

  assert.match(connector, /interactionBoundaryVisualStatus\(boundary\)/);
  assert.match(connector, /data-interaction-boundary-id/);
  assert.match(connector, /boundary\?\.overridden/);
  assert.match(connector, /<select[^>]*data-interaction-boundary-policy-select/);
  assert.match(connector, /data-interaction-boundary-id="\$\{escapeHtml\(boundary\??\.boundaryId \|\| ""\)\}"/);
  assert.match(connector, /const options = \["button-step", "direct", "embodied-control"\]/);
  assert.match(connector, /displayLabel\(kind\)/);
  assert.match(connector, /<option(?=[^>]*value="branching-control")(?=[^>]*disabled)[^>]*>[^<]*Branching selection[^<]*<\/option>/);
  assert.match(connector, /<span class="interaction-boundary-arrow" aria-hidden="true">\s*<\/span>/);
  const hiddenArrow = connector.indexOf('<span class="interaction-boundary-arrow" aria-hidden="true">');
  const hiddenArrowClose = connector.indexOf("</span>", hiddenArrow);
  const policySelect = connector.indexOf("<select", hiddenArrow);
  assert.ok(hiddenArrow >= 0 && hiddenArrowClose > hiddenArrow && policySelect > hiddenArrowClose,
    "the decorative arrow closes before the accessible policy select begins");
  assert.match(status, /Controller|boundary\.effectivePolicy/);
  assert.match(status, /Author assignment/);
  assert.match(status, /Assign interaction/);
  assert.doesNotMatch(status, /fallback/i);
  assert.doesNotMatch(status, /Inference unavailable|stale/i);
});

test("unassigned mapped transitions are highlighted and can be located from the blocking warning", () => {
  const workspace = sourceFunction("renderInteractionControlCanvasWorkspace");
  const needsAssignment = sourceFunction("interactionBoundaryNeedsAssignment");
  const connector = sourceFunction("renderInteractionBoundaryConnector");
  const variantLinks = sourceFunction("renderStoryVariantLinkLayer");
  const layout = sourceFunction("layoutStoryVariantLinks");
  const focus = sourceFunction("focusInteractionProblemBoundary");
  const binder = sourceFunction("bindInteractionControlCanvasEvents");

  assert.match(needsAssignment, /boundary\?\.mappedTransition && !boundary\?\.effectivePolicy/);
  assert.match(workspace, /const unassignedBoundaries = boundaryContext\.boundaries\.filter\(interactionBoundaryNeedsAssignment\)/);
  assert.match(workspace, /data-interaction-show-problem="\$\{escapeHtml\(firstUnassignedBoundaryId\)\}"/);
  assert.match(workspace, /problems are|problem is/);
  assert.match(workspace, /highlighted below/);
  assert.match(connector, /needsAssignment \? "needs-interaction-assignment"/);
  assert.match(connector, /data-interaction-needs-assignment data-interaction-problem-boundary-id/);
  assert.match(connector, /class="interaction-assignment-flag"/);
  assert.match(variantLinks, /story-variant-problem-arrowhead/);
  assert.match(variantLinks, /story-variant-transition-edge[^\n]*needs-interaction-assignment/);
  assert.match(variantLinks, /story-variant-progression-bus \$\{needsAssignment \? "needs-interaction-assignment"/);
  assert.match(variantLinks, /data-interaction-needs-assignment data-interaction-problem-boundary-id/);
  assert.match(layout, /problemMarkerReference/);
  assert.match(layout, /group\.classList\.contains\("needs-interaction-assignment"\)/);
  assert.match(binder, /\[data-interaction-show-problem\]/);
  assert.match(binder, /focusInteractionProblemBoundary/);
  assert.match(focus, /\[data-interaction-boundary-policy-select\]/);
  assert.match(focus, /closest\("\[data-interaction-needs-assignment\]"\)/);
  assert.match(focus, /viewport\.scrollTo\(/);
  assert.match(focus, /select\.focus\(\{ preventScroll: true \}\)/);

  assert.match(styles, /\.interaction-boundary-connector\.needs-interaction-assignment \.interaction-boundary-arrow::before\s*\{[^}]*background:\s*var\(--danger\)/s);
  assert.match(styles, /\.interaction-boundary-connector\.needs-interaction-assignment \.interaction-boundary-status\s*\{[^}]*border:\s*3px solid var\(--danger\)/s);
  assert.match(styles, /\.story-variant-transition-edge\.needs-interaction-assignment \.source-graph-transition-path,[^}]*stroke:\s*var\(--danger\)/s);
  assert.match(styles, /\.story-variant-interaction-label\.needs-interaction-assignment \.story-variant-interaction-label-content\s*\{[^}]*border:\s*3px solid var\(--danger\)/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[^]*needs-interaction-assignment[^]*animation:\s*none/s);
});

test("the scoped editor keeps the spatial preview and inspector without duplicating policy selection", () => {
  const editor = sourceFunction("renderInteractionControlEditorWorkspace");
  const preview = sourceFunction("renderInteractionPreview");

  assert.match(editor, /interactionBoundaryContext\(baseProposal, sceneContext\)/);
  assert.match(editor, /data-interaction-workspace-mode="editor"/);
  assert.match(editor, /data-interaction-close-editor/);
  assert.match(editor, /Back to story canvas/);
  assert.match(editor, /renderInteractionPreview\(selectedProposal, boundaryContext\)/);
  assert.match(editor, /renderInteractionInspector\(selectedProposal, boundaryContext\.boundary\)/);
  assert.doesNotMatch(editor, /renderCheckpointActions/, "the story canvas remains the checkpoint persistence surface");
  assert.doesNotMatch(editor, /renderInteractionBeatRail|data-interaction-beat-index/);
  assert.doesNotMatch(preview, /renderInteractionBoundaryEditor\(boundary\)/);
  assert.doesNotMatch(preview, /interaction-policy-options|data-interaction-boundary-policy/);
  assert.match(preview, /renderInteractionVariantControl\(variantControl\)/);
  assert.match(preview, /Return to the story canvas to inspect another boundary/);
});

test("Interaction Control has no client dependency on generated proposal options", () => {
  const workspace = sourceFunction("renderInteractionControlWorkspace");
  const canvas = sourceFunction("renderInteractionControlCanvasWorkspace");
  const editor = sourceFunction("renderInteractionControlEditorWorkspace");
  const selectedOption = sourceFunction("selectedOptionIdForComponent");
  const records = sourceFunction("interactionControlBoundaryRecords");
  const variantRecords = sourceFunction("interactionVariantControlRecords");
  const variantControl = sourceFunction("interactionVariantControlForBeat");

  assert.doesNotMatch(`${workspace}\n${canvas}\n${editor}`, /renderGenerateOptionsButton|Generate options|Regenerate/);
  assert.doesNotMatch(records, /proposals\?\.\[|bundle|defaultOptionId/);
  assert.match(variantRecords, /interactionControlDraft/);
  assert.doesNotMatch(variantRecords, /proposals\?\.\[|bundle|defaultOptionId/);
  assert.match(variantControl, /record\?\.effectivePolicy === "Text panel selection"/);
  assert.match(variantControl, /effectivePolicy:\s*"UI button press"/);
  assert.match(variantControl, /selectionMode:\s*"previous-next"/);
  assert.match(variantControl, /previousLabel/);
  assert.match(variantControl, /nextLabel/);
  assert.match(variantControl, /ray-click backward or forward/);
  assert.match(variantControl, /text-panel/);
  assert.doesNotMatch(variantControl, /Regenerate|stale|inference unavailable/i);
  assert.doesNotMatch(selectedOption, /interactionRepresentativeOptionId|interaction-control/);
  assert.doesNotMatch(source, /function interactionRepresentativeOptionId\(/);
  assert.doesNotMatch(source, /interactionRepresentativeOptionId/);
  const saveStart = source.indexOf('if (action === "save-checkpoint")');
  const saveEnd = source.indexOf('if (action === "compile")', saveStart);
  const saveHandler = source.slice(saveStart, saveEnd);
  const interactionSave = saveHandler.indexOf('component.id === "interaction-control"');
  const genericSelectedOption = saveHandler.indexOf("selectedOptionIdForComponent(component)");
  assert.ok(saveStart >= 0 && saveEnd > saveStart, "checkpoint save handler exists");
  assert.ok(interactionSave >= 0 && interactionSave < genericSelectedOption, "Interaction is handled before generic option selection");
  assert.match(saveHandler, /payload\.boundaryOverrides = interactionBoundaryOverridesPayload\(\)/);
  assert.match(saveHandler, /payload\.variantOverrides = interactionVariantOverridesPayload\(\)/);
  assert.match(saveHandler, /payload\.inBeatInteractionsSchemaVersion = IN_BEAT_INTERACTIONS_SCHEMA/);
  assert.match(saveHandler, /payload\.inBeatInteractions = interactionInBeatInteractionsPayload\(\)/);
  assert.doesNotMatch(
    saveHandler,
    /payload\.boundaryOverrides\s*=\s*interactionVariantOverridesPayload\(\)/,
    "variant-arrow choices never reuse narrative boundary overrides",
  );
  assert.match(saveHandler, /interactionBoundaryContextIsComplete/);
});

test("same-beat variant-switch assignments stay separate from route-specific progression boundary assignments", () => {
  const binder = sourceFunction("bindInteractionControlCanvasEvents");
  const variantSetter = sourceFunction("setInteractionVariantPolicy");
  const variantPayload = sourceFunction("interactionVariantOverridesPayload");
  const variantState = sourceFunction("ensureInteractionVariantOverrides");
  const variantControl = sourceFunction("interactionVariantEdgeControlForEdge");
  const boundaryPayload = sourceFunction("interactionBoundaryOverridesPayload");
  const boundaryState = sourceFunction("ensureInteractionBoundaryOverrides");

  assert.match(binder, /\[data-story-variant-interaction-policy-select\]/);
  assert.match(binder, /dataset\.interactionVariantEdgeId/);
  assert.match(binder, /setInteractionVariantPolicy\(edgeId, policyKind\)/);
  assert.match(binder, /beginAuthorHistory\("[^"]*variant interaction[^"]*", "interaction-control"\)/i);
  assert.match(variantSetter, /ensureInteractionVariantOverrides\(\)/);
  assert.match(variantSetter, /edgeId/);
  assert.match(variantSetter, /policy === "UI button press" && !options\.retainConfiguration && !existing\?\.configuration/,
    "an untouched UI default stays implicit while an edited default retains its configuration");
  assert.match(variantSetter, /overrides\[edgeId\] = \{ policy, configuration \}/);
  assert.match(variantState, /state\.interactionVariantEdgeOverrides/);
  assert.match(variantState, /state\.interactionVariantEdgeOverridesInitialized/);
  assert.match(variantPayload, /ensureInteractionVariantOverrides\(\)/);
  assert.match(variantControl, /ensureInteractionVariantOverrides\(\)\[edge\?\.id\]/);
  assert.match(variantControl, /effectivePolicy = override\?\.policy \|\| "UI button press"/);
  assert.doesNotMatch(variantPayload, /interactionBoundaryOverrides/);
  assert.match(boundaryPayload, /ensureInteractionBoundaryOverrides\(\)/);
  assert.match(boundaryState, /state\.interactionBoundaryOverrides/);
  assert.doesNotMatch(boundaryPayload, /interactionVariantOverrides/);
});

test("the boundary-arrow dropdown exposes exactly the three current authoring choices", () => {
  const connector = sourceFunction("renderInteractionBoundaryConnector");
  const setter = sourceFunction("setInteractionBoundaryPolicy");

  for (const label of [
    "Controller button press",
    "Direct manipulation",
    "Reader locomotion",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(connector, /const options = \["button-step", "direct", "embodied-control"\]/);
  assert.match(connector, /options\.map/);
  assert.match(connector, /displayLabel\(kind\)/);
  assert.doesNotMatch(connector, /UI button press/);
  assert.match(connector, /<option(?=[^>]*value="branching-control")(?=[^>]*disabled)[^>]*>[^<]*Branching selection[^<]*<\/option>/,
    "legacy Branching assignments remain legible but cannot be newly selected");
  assert.doesNotMatch(setter, /interactionPolicyOverrideAllowed|requires Reader locomotion|no explicit Source Graph branch/);
  assert.doesNotMatch(source, /function interactionPolicyOverrideAllowed\(|function interactionPolicyOverrideBlockedReason\(/);
});

test("Direct manipulation is disabled on transition controls until the exact source scene has an interactable", () => {
  const connector = sourceFunction("renderInteractionBoundaryConnector");
  const variants = sourceFunction("renderStoryVariantLinkLayer");
  const renderForAvailability = (directAvailable) => Function("directAvailable", `
    let thumbnailOptions = [];
    function interactionBoundaryVisualStatus() { return { className: "unassigned", label: "Assign interaction", detail: "" }; }
    function interBeatTransitionEndpointTitle(beat) { return beat.title; }
    function inferInteractionControlKind() { return ""; }
    function normalizeMotionSceneContext() { return { beatId: "beat-1" }; }
    function interactionSceneContextForBeat() { return { beatId: "beat-1" }; }
    function interactionSceneHasInteractables() { return directAvailable; }
    function renderInteractionOptionThumbnails(value) { thumbnailOptions = value.options; return ""; }
    function escapeHtml(value) { return String(value ?? ""); }
    function interactionControlKindLabel(kind) {
      return kind === "button-step" ? "Controller button press"
        : kind === "direct" ? "Direct manipulation"
        : "Reader locomotion";
    }
    ${connector}
    const html = renderInteractionBoundaryConnector({
      boundaryId: "route-1",
      fromBeatId: "beat-1",
      toBeatId: "beat-2",
      fromContext: { beatId: "beat-1" },
      configurationAvailable: true,
      effectivePolicy: null,
    }, { title: "One" }, { title: "Two" });
    return { html, thumbnailOptions };
  `)(directAvailable);

  assert.match(connector, /const directAvailable = interactionSceneHasInteractables\(sceneContext\)/);
  assert.match(connector, /options: directAvailable \? options : options\.filter\(\(kind\) => kind !== "direct"\)/);
  assert.match(connector, /kind === "direct" && !directAvailable \? "disabled" : ""/);
  assert.match(variants, /const sceneContext = spatialSceneContext\(edge\.from\.beatId, edge\.from\.variantGroupId, edge\.from\.variantOptionId\)/);
  assert.match(variants, /const directAvailable = interactionSceneHasInteractables\(sceneContext\)/);
  assert.match(variants, /<option value="direct"[^\n]*\$\{directAvailable \? "" : "disabled"\}/);

  const unavailable = renderForAvailability(false);
  const disabledDirect = unavailable.html.match(/<option value="direct"[^>]*>[^<]*<\/option>/)?.[0] || "";
  assert.deepEqual(unavailable.thumbnailOptions, ["button-step", "embodied-control"]);
  assert.match(disabledDirect, /\sdisabled(?:\s|>)/);
  assert.match(disabledDirect, /choose a grabbable object first/);

  const available = renderForAvailability(true);
  const enabledDirect = available.html.match(/<option value="direct"[^>]*>[^<]*<\/option>/)?.[0] || "";
  assert.deepEqual(available.thumbnailOptions, ["button-step", "direct", "embodied-control"]);
  assert.doesNotMatch(enabledDirect, /\sdisabled(?:\s|>)/);
  assert.match(enabledDirect, />Move an object<\/option>/);
});

test("Reader locomotion uses the approved generated travel artwork exactly", () => {
  const icon = sourceFunction("interactionOptionIcon");
  const thumbnails = sourceFunction("renderInteractionOptionThumbnails");

  assert.match(source, /INTERACTION_READER_LOCOMOTION_ARTWORK_PATH[\s\S]*icons\/reader-locomotion-travel\.png/);
  assert.match(thumbnails, /kind === "embodied-control"[\s\S]*interaction-option-artwork/);
  assert.match(thumbnails, /uses-generated-artwork/);
  assert.match(thumbnails, /alt=""/,
    "the button's existing accessible name describes the decorative artwork");
  assert.doesNotMatch(icon, /data-icon-part="traveler"|data-icon-part="travel-destination"/,
    "no approximate SVG traveler remains in the renderer");
  assert.match(styles, /\.interaction-option-thumbnail\.uses-generated-artwork[\s\S]*aspect-ratio:\s*1/);
  assert.match(styles, /\.interaction-option-artwork\s*\{[^}]*object-fit:\s*contain/s);
});

test("each transition shows only its selected icon thumbnail and opens one of four general-purpose editors", () => {
  const thumbnails = sourceFunction("renderInteractionOptionThumbnails");
  const narrative = sourceFunction("renderInteractionBoundaryConnector");
  const variants = sourceFunction("renderStoryVariantLinkLayer");
  const binder = sourceFunction("bindInteractionControlCanvasEvents");
  const optionBinder = sourceFunction("bindInteractionOptionEditorEvents");
  const router = sourceFunction("openInteractionOptionEditor");
  const controller = sourceFunction("renderInteractionControllerEditor");
  const controllerSelect = sourceFunction("renderInteractionControllerBindingSelect");
  const controllerDiagram = sourceFunction("renderInteractionControllerDiagram");
  const controllerPopulateTargets = sourceFunction("interactionControllerPopulateTargets");
  const applyControllerMapping = sourceFunction("applyInteractionControllerMappingToOtherTransitions");
  const controllerModels = sourceFunction("initializeInteractionControllerModels");
  const controllerCamera = sourceFunction("fitInteractionControllerCamera");
  const controllerProfiles = source.slice(
    source.indexOf("const INTERACTION_CONTROLLER_PROFILES"),
    source.indexOf("const INTERACTION_ACTION_OPTIONS"),
  );
  const uiPanel = sourceFunction("renderInteractionUiPanelEditor");
  const locomotion = sourceFunction("renderInteractionLocomotionEditor");
  const direct = sourceFunction("renderInteractionDirectEditor");

  assert.match(thumbnails, /data-interaction-option-thumbnail/);
  assert.match(thumbnails, /availableKinds\.includes\(effectiveKind\)/);
  assert.doesNotMatch(thumbnails, /options\.map/);
  assert.match(thumbnails, /interactionOptionIcon\(kind\)/);
  assert.match(thumbnails, /class="interaction-option-thumbnail[^\n]*selected"/);
  assert.match(narrative, /renderInteractionOptionThumbnails\(\{/);
  assert.match(narrative, /options = \["button-step", "direct", "embodied-control"\]/);
  assert.match(variants, /const options = progression[\s\S]*\["button-step", "direct", "embodied-control"\][\s\S]*\["ui-button-press", "direct", "embodied-control"\]/,
    "progression arrows expose controller controls while same-beat switches retain text-panel UI controls");
  assert.match(
    variants,
    /renderInteractionOptionThumbnails\(\{[\s\S]*targetType,[\s\S]*targetId,[\s\S]*sceneContext,[\s\S]*effectiveKind,[\s\S]*options: directAvailable \? options : options\.filter\(\(kind\) => kind !== "direct"\),/,
    "variant thumbnails receive only choices that are valid for the exact source scene",
  );
  assert.match(binder, /\[data-interaction-option-thumbnail\]/);
  assert.match(binder, /openInteractionOptionEditor\(\{/);
  assert.match(router, /interactionTargetType/);
  assert.match(router, /interactionTargetId/);
  assert.match(router, /interactionKind/);

  assert.match(controller, /Meta Quest 3|profile\.label/);
  assert.match(controller, /renderInteractionControllerDiagram/);
  assert.doesNotMatch(controller, /Button mappings|interaction-mapping-grid/);
  assert.match(controller, /data-interaction-controller-apply-all/);
  assert.match(controller, /populateTargetCount/);
  assert.match(controllerSelect, /data-interaction-controller-binding/);
  assert.match(controllerDiagram, /data-interaction-controller-model/);
  assert.match(controllerDiagram, /controller-model-mapping/);
  assert.match(controllerDiagram, /data-controller-model-connector/);
  assert.match(controllerDiagram, /controller-model-hotspot/);
  assert.doesNotMatch(controllerProfiles, /id: "(?:trigger|squeeze)"/,
    "Trigger and Grip are not assignable profile inputs");
  assert.doesNotMatch(controllerDiagram, /\{ input: "(?:trigger|squeeze)"/,
    "Trigger and Grip do not enter the binding-select branch");
  assert.doesNotMatch(controllerDiagram, /reservedControl|controller-model-reserved-control|Reserved ·/,
    "Trigger and Grip do not produce reserved callouts, text, connectors, or hotspots");
  assert.doesNotMatch(source, /INTERACTION_CONTROLLER_RESERVED_CONTROLS/);
  assert.match(controllerModels, /initializeInteractionControllerModel/);
  assert.match(controllerPopulateTargets, /boundary\.boundaryId !== editorContext\.targetId/);
  assert.match(controllerPopulateTargets, /recognizedInteractionPolicyKind\(boundary\.effectivePolicy\) === "button-step"/);
  assert.match(applyControllerMapping, /ensureInteractionBoundaryOverrides/);
  assert.match(applyControllerMapping, /beginAuthorHistory/);
  assert.match(applyControllerMapping, /commitAuthorHistory/);
  assert.match(applyControllerMapping, /cloneJson\(sourceConfiguration\)/);
  assert.match(optionBinder, /\[data-interaction-controller-apply-all\]/);
  assert.match(controllerCamera, /2\.35, -1\.4/);
  assert.match(controllerCamera, /camera\.up\.set\(0, 0, -1\)/);
  assert.match(source, /controllers\/meta-quest-touch-plus/);
  assert.doesNotMatch(controller, /Trigger stays reserved|Grip stays reserved|system interaction controls stay reserved/,
    "Interaction Control does not display reservation guidance text");
  assert.doesNotMatch(`${sourceFunction("interactionControlOptionSummary")}\n${sourceFunction("interactionControlKindHelp")}`, /controller primary action/i,
    "controller guidance cannot imply that WebXR Trigger advances the story");
  assert.match(sourceFunction("interactionControlKindHelp"), /assigned controller button/);
  assert.match(uiPanel, /Final reader text panel/);
  assert.match(uiPanel, /option\?\.text \|\| beat\?\.text/);
  assert.match(uiPanel, /data-interaction-ui-button-preview/);
  assert.match(locomotion, /renderInteractionSpatialScene/);
  assert.match(locomotion, /distanceMeters/);
  assert.match(locomotion, /dwellSeconds/);
  assert.match(direct, /interactionDirectSceneTargets\(editorContext\.sceneContext\)/);
  assert.match(direct, /interactionDirectTargetKey/);
  assert.match(direct, /target\.nodePath \? `\$\{target\.label\} · \$\{target\.nodePath\}`/);
  assert.match(direct, /destinationTransform/);
  assert.match(direct, /interactionMappedTransformSuggestions/);

  assert.match(styles, /\.interaction-option-thumbnail\.selected/);
  assert.match(styles, /\.interaction-option-thumbnails\s*\{[^}]*grid-template-columns:\s*minmax\(0, 68px\)/s);
  assert.match(styles, /\.story-variant-interaction-label-content\s*\{[^}]*grid-template-columns:\s*50px minmax\(0, 1fr\);[^}]*gap:\s*8px;[^}]*border-radius:\s*14px;[^}]*padding:\s*6px;/s,
    "variant icon and policy selector are organized as one horizontal grouped card");
  assert.match(styles, /\.story-variant-interaction-label \.interaction-option-thumbnails\s*\{[^}]*grid-template-columns:\s*minmax\(0, 44px\)/s);
  assert.match(styles, /\.story-variant-interaction-label \.interaction-option-thumbnail\s*\{[^}]*min-height:\s*58px;[^}]*border-radius:\s*10px;[^}]*box-shadow:\s*none/s);
  assert.match(styles, /\.story-variant-interaction-policy-select\s*\{[^}]*min-height:\s*34px;[^}]*font-size:\s*0\.6rem;[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /\.interaction-story-beat-item\.has-connector\s*\{[^}]*--interaction-transition-span:\s*calc\(340px \+ var\(--interaction-variant-pair-clearance\)\)[^}]*grid-template-columns:\s*280px var\(--interaction-transition-span\)/s);
  assert.match(styles, /\.interaction-boundary-connector\s*\{[^}]*width:\s*var\(--interaction-transition-span, 340px\)/s);
  assert.match(styles, /\.interaction-story-canvas-viewport \.source-graph-beat-item\.has-variants > \.source-graph-beat-card,[^}]*\.interaction-story-canvas-viewport \.source-graph-variant-alternatives > li:not\(:last-child\)\s*\{[^}]*margin-block-end:\s*84px/s);
  assert.match(styles, /\.interaction-controller-pair/);
  assert.match(styles, /\.interaction-controller-model-canvas/);
  assert.match(styles, /\.controller-model-mapping/);
  assert.match(styles, /\.interaction-controller-connectors/);
  assert.match(styles, /\.interaction-apply-mapping-button/);
  assert.doesNotMatch(styles, /controller-model-reserved-control|controller-model-hotspot\.reserved|connectors line\.reserved/);
  assert.match(styles, /\.interaction-ui-panel-preview/);
  assert.match(styles, /button\.interaction-ui-button-preview:hover:not\(:disabled\)\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)/s,
    "UI button hover preserves the centering transform used by its normalized position");
  assert.match(styles, /\.interaction-transform-grid/);
});

test("configuration is transition-local, versioned, and derived from loaded scene and graph data", () => {
  const defaults = sourceFunction("interactionDefaultConfiguration");
  const normalize = sourceFunction("normalizeInteractionConfiguration");
  const reservedInput = sourceFunction("interactionControllerInputIsReserved");
  const context = sourceFunction("interactionConfigurationContext");
  const boundaryPayload = sourceFunction("interactionBoundaryOverridesPayload");
  const variantPayload = sourceFunction("interactionVariantOverridesPayload");

  assert.match(defaults, /INTERACTION_CONFIGURATION_SCHEMA/);
  assert.match(defaults, /interactionControllerProfile/);
  assert.match(reservedInput, /input === "trigger" \|\| input === "squeeze" \|\| input === "grip"/);
  assert.match(normalize, /filter\(\(binding\) => !interactionControllerInputIsReserved\(binding\?\.input \|\| binding\?\.control \|\| binding\?\.button\)\)/,
    "legacy Trigger, Grip, and squeeze bindings are omitted before rebuilding assignable controls");
  const profileDeclaration = source.slice(
    source.indexOf("const INTERACTION_CONTROLLER_PROFILES"),
    source.indexOf("const INTERACTION_ACTION_OPTIONS"),
  );
  const profiles = Function(`${profileDeclaration}\nreturn INTERACTION_CONTROLLER_PROFILES;`)();
  const normalizeController = Function(
    "INTERACTION_CONTROLLER_PROFILES",
    "INTERACTION_ACTION_OPTIONS",
    "INTERACTION_CONFIGURATION_SCHEMA",
    `${sourceFunction("interactionKindForConfiguration")}
     ${sourceFunction("interactionControllerProfile")}
     ${reservedInput}
     ${defaults}
     ${normalize}
     return normalizeInteractionConfiguration;`,
  )(
    profiles,
    [{ id: "unmapped" }, { id: "next-beat" }, { id: "previous-beat" }],
    "storyvr-interaction-configuration/v1",
  );
  const normalizedController = normalizeController({
    type: "controller-button-press",
    profile: "meta-quest-touch-plus",
    bindings: [
      { hand: "right", input: "a", action: "next-beat" },
      { hand: "left", input: "trigger", action: "next-beat" },
      { hand: "left", input: "squeeze", action: "previous-beat" },
      { hand: "right", input: "grip", action: "previous-beat" },
    ],
  }, "button-step");
  assert.equal(
    normalizedController.bindings.some((binding) => ["trigger", "squeeze", "grip"].includes(binding.input)),
    false,
    "legacy reserved bindings are absent from the normalized authoring payload",
  );
  assert.match(defaults, /storyVariantEndpointLabel\(edge\.to\)/);
  assert.match(defaults, /context\.variantDirection === "previous"[\s\S]*\[0\.2, 0\.86\][\s\S]*context\.variantDirection === "next"[\s\S]*\[0\.8, 0\.86\]/);
  assert.match(defaults, /interactionReaderTransformForContext\(targetContext\)/);
  assert.match(normalize, /interactionDirectSceneTargets\(context\.sceneContext\)/);
  assert.match(context, /boundary\.fromBeatId/);
  assert.match(context, /edge\.from\.beatId/);
  assert.match(context, /sourceGraphDisplayedVariantOptions\(group\)/);
  assert.match(context, /variantDirection/);
  assert.match(normalize, /interactionFiniteNumber/);
  assert.match(boundaryPayload, /configuration:/);
  assert.match(boundaryPayload, /const boundaryId = boundary\.boundaryId/);
  assert.match(boundaryPayload, /const legacyId = interactionBoundaryId\(boundary\.fromBeatId, boundary\.toBeatId\)/);
  assert.match(boundaryPayload, /const value = overrides\[boundaryId\] \|\| \(legacyApplies \? legacyValue : null\)/);
  assert.match(boundaryPayload, /return \[\[boundaryId, \{/,
    "an applicable legacy beat-pair override is saved under each exact route boundary ID");
  assert.match(boundaryPayload, /sourceGraphTransitionContextMatches\(boundary\.fromContext, defaultFromContext\)/);
  assert.match(boundaryPayload, /legacyKind === "button-step"/,
    "legacy controller progression can safely materialize across parallel variant routes");
  assert.match(variantPayload, /configuration/);
  assert.match(styles, /\.interaction-ui-button-preview\s*\{[^}]*transform:\s*translate\(-50%, -50%\)/s,
    "the author preview interprets normalized positions as button centers, matching Final Review and the reader");
  assert.doesNotMatch(`${defaults}\n${context}`, /slide-\d+|shark|classroom/i,
    "no story-specific IDs or asset names are embedded in editor defaults");
});

test("Interaction presents authored route controls while Final Review omits its route action strip", () => {
  const presentation = [
    "renderInteractionControlCanvasWorkspace",
    "interactionBoundaryVisualStatus",
    "renderInteractionStoryCanvas",
    "renderInteractionBoundaryConnector",
    "renderInteractionVariantControl",
    "renderInteractionInspector",
  ].map((name) => sourceFunction(name)).join("\n");
  const finalReview = sourceFunction("renderFinalReviewSpatialEditor");

  assert.doesNotMatch(presentation, /fallback/i);
  assert.doesNotMatch(
    finalReview,
    /data-final-review-(?:play|restart|action|xr-slot)|Pause motion|Replay |Controller button press|VR NOT SUPPORTED|fallback/i,
  );
});

test("opening and closing an Interaction editor uses browser history and keeps overrides local until checkpoint save", () => {
  const bindAll = sourceFunction("bindEvents");
  const bind = sourceFunction("bindInteractionControlCanvasEvents");
  const open = sourceFunction("openInteractionSceneEditor");
  const openOption = sourceFunction("openInteractionOptionEditor");
  const close = sourceFunction("closeInteractionSceneEditor");
  const applyNavigation = sourceFunction("applyStoryvrBrowserNavigation");
  const normalizeNavigation = sourceFunction("normalizeStoryvrBrowserNavigation");

  assert.match(bindAll, /bindInteractionControlCanvasEvents\(\)/);
  assert.match(bind, /bindSourceGraphCanvasPanning\(viewport\)/);
  assert.match(bind, /\[data-interaction-open-scene\]/);
  assert.match(bind, /openInteractionSceneEditor\(\{/);
  assert.match(bind, /\[data-interaction-close-editor\]/);
  assert.match(bind, /\[data-interaction-boundary-policy-select\]/);
  assert.match(bind, /\[data-story-variant-interaction-policy-select\]/);
  assert.match(bind, /addEventListener\("change"/);
  assert.match(bind, /const policyKind = [^;]*\.value/);
  assert.match(bind, /beginAuthorHistory\("Edit Interaction Control boundary", "interaction-control"\)/);
  assert.match(bind, /setInteractionBoundaryPolicy\(boundaryId, policyKind\)/);
  assert.match(bind, /const edgeId = [^;]*dataset\.interactionVariantEdgeId/);
  assert.match(bind, /setInteractionVariantPolicy\(edgeId, policyKind\)/);
  assert.match(bind, /state\.interactionManipulationOffset = \{ x: 0, y: 0, z: 0 \}/);
  assert.match(bind, /state\.interactionEmbodiedRestartToken \+= 1/);
  assert.match(bind, /renderPreservingScroll\(\)/);
  assert.match(bind, /\.focus\(\)/);
  assert.doesNotMatch(bind, /captureInteractionViewerCameraState\(\)/,
    "changing a canvas dropdown cannot erase the scoped editor camera");
  assert.doesNotMatch(bindAll, /querySelectorAll\("\[data-interaction-boundary-policy\]"\)/,
    "the removed preview policy-card click binding does not survive globally");
  assert.match(open, /spatialSceneContext\(context\?\.beatId, context\?\.variantGroupId, context\?\.variantOptionId\)/);
  assert.match(open, /pushStoryvrBrowserNavigation/);
  assert.match(open, /createStoryvrNavigationRoute\("interaction-control", normalized\)/);
  assert.match(openOption, /interactionTargetType/);
  assert.match(openOption, /interactionTargetId/);
  assert.match(openOption, /interactionKind/);
  assert.match(openOption, /pushStoryvrBrowserNavigation/);
  assert.match(normalizeNavigation, /requestedScene\.interactionTargetType/);
  assert.match(normalizeNavigation, /requestedScene\.interactionTargetId/);
  assert.match(normalizeNavigation, /requestedScene\.interactionKind/);
  assert.match(applyNavigation, /state\.interactionCanvasReturnScroll = \{/);
  assert.match(applyNavigation, /state\.interactionEditorScene = navigation\.editorScene/);
  assert.match(close, /await historyFinalizePromise/);
  assert.match(close, /Interaction draft kept/);
  assert.match(close, /returnToInteractionCanvasWithBrowserHistory\(\)/);
  assert.doesNotMatch(close, /api\.post|save-checkpoint/, "closing an editor cannot imply checkpoint persistence");
});

test("in-beat interaction edits participate in local draft, history, and checkpoint persistence", () => {
  const capture = sourceFunction("captureAuthorHistoryUi");
  const restore = sourceFunction("restoreAuthorHistoryUi");
  const localDraft = sourceFunction("checkpointHasLocalDraft");
  const mutation = sourceFunction("commitInteractionInBeatMutation");
  const reset = sourceFunction("resetInteractionControlDraftCaches");
  const saveStart = source.indexOf('if (action === "save-checkpoint")');
  const saveEnd = source.indexOf('if (action === "compile")', saveStart);
  const saveHandler = source.slice(saveStart, saveEnd);

  assert.match(capture, /interactionInBeatInteractions: historyClone\(state\.interactionInBeatInteractions\)/);
  assert.match(capture, /interactionInBeatInteractionsInitialized: Boolean\(state\.interactionInBeatInteractionsInitialized\)/);
  assert.match(capture, /interactionSelectedInBeatTargetKey/);
  assert.match(capture, /interactionConstraintEndpoint/);
  assert.match(capture, /interactionConstraintTransformMode/);
  assert.match(restore, /state\.interactionInBeatInteractions = historyClone\(snapshot\.interactionInBeatInteractions\) \|\| \[\]/);
  assert.match(restore, /state\.interactionInBeatInteractionsInitialized = Boolean\(snapshot\.interactionInBeatInteractionsInitialized\)/);
  assert.match(localDraft, /state\.interactionInBeatInteractionsInitialized/);
  assert.match(localDraft, /interactionInBeatInteractionsSignature\(interactionInBeatInteractionsPayload\(\)\)[\s\S]*interactionInBeatInteractionsSignature\(savedInteractionInBeatInteractions\(decision\)\)/);
  assert.match(mutation, /editorContext\?\.targetType !== "in-beat"/);
  assert.match(mutation, /beginAuthorHistory\(label, "interaction-control"\)/);
  assert.match(mutation, /mutateInteractionInBeatRecord\(editorContext\.sceneContext, mutate\)/);
  assert.match(mutation, /if \(historyStarted && changed\) commitAuthorHistory\(\)/);
  assert.doesNotMatch(mutation, /api\.post|save-checkpoint/,
    "in-editor mutations remain local until the canvas checkpoint action");
  assert.match(saveHandler, /payload\.inBeatInteractionsSchemaVersion = IN_BEAT_INTERACTIONS_SCHEMA/);
  assert.match(saveHandler, /payload\.inBeatInteractions = interactionInBeatInteractionsPayload\(\)/);
  assert.match(saveHandler, /resetInteractionControlDraftCaches\(\)/);
  assert.match(reset, /state\.interactionInBeatInteractions = \[\]/);
  assert.match(reset, /state\.interactionInBeatInteractionsInitialized = false/);
});

test("the Interaction preview is scoped to the exact previous-beat scene", () => {
  const context = sourceFunction("interactionBoundaryContext");
  const assets = sourceFunction("interactionSceneAssetLinks");
  const initialize = sourceFunction("initializeInteractionControlViewer");
  const framing = sourceFunction("interactionPreviewCameraFramingContract");

  assert.match(context, /sceneContext\?\.beatId/);
  assert.match(context, /interactionPreviewBeatForSceneContext\(proposal, sceneContext\)/);
  assert.match(context, /beat\.id === sceneContext\.beatId/);
  assert.match(assets, /narrativeSceneAssetLinks\(proposal, beats\)/);
  assert.doesNotMatch(assets, /textSceneAssetLinks/);
  assert.match(initialize, /const sceneContext = activeInteractionSceneContext\(\)/);
  assert.match(initialize, /if \(!sceneContext\) return/);
  assert.match(initialize, /interactionBoundaryContext\(baseProposal, sceneContext\)/);
  assert.match(initialize, /interactionOptionEditorContext\(baseProposal, sceneContext\)/);
  assert.match(initialize, /spatialSceneEntities\(spatialContract, editorContext\.sceneContext\)/);
  assert.match(initialize, /interactionSceneAssetLinks\(proposal, \[beat\]\)/);
  assert.doesNotMatch(initialize, /interactionSceneAssetLinks\(proposal, beats\)/);
  assert.match(initialize, /sceneContext: editorContext\.sceneContext/);
  assert.match(initialize, /interactionPreviewCameraFramingContract\(beat, editorContext\.sceneContext\)/);
  assert.match(framing, /spatialSceneRequestKey\(sceneContext\)/);

  assert.match(styles, /\.interaction-canvas-mode\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.interaction-story-beat-item\.has-connector\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.interaction-boundary-arrow::before\s*\{[^}]*height:\s*var\(--story-canvas-arrow-stroke-width\);[^}]*background:\s*var\(--story-canvas-arrow-color\);/s);
  assert.match(styles, /\.interaction-boundary-arrow::after\s*\{[^}]*border-left:\s*var\(--story-canvas-arrowhead-length\) solid var\(--story-canvas-arrow-color\);/s);
  assert.match(styles, /(?:\.interaction-boundary-policy-select|\[data-interaction-boundary-policy-select\])[^{]*\{[^}]*pointer-events:\s*auto/s);
  assert.match(styles, /@media \(max-width: 680px\)[^]*\.interaction-boundary-connector\s*\{[^}]*grid-column:\s*1/s);
});
