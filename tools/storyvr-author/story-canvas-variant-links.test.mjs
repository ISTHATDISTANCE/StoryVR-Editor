import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

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

test("downstream story canvases render variant switches and per-variant progression arrows, with scoped controls", () => {
  const layer = functionSource("renderStoryVariantLinkLayer");

  assert.match(layer, /sourceGraphTransitionEdges\(state\.data\?\.graph\)/);
  assert.match(layer, /\.filter\(\(edge\) => sourceGraphIsDownstreamVariantEdge\(edge\)\)/);
  assert.match(layer, /sourceGraphIsManualVariantSwitch\(edge\) \? "is-variant-switch" : "is-variant-progression"/);
  assert.match(layer, /sourceGraphReciprocalLaneOffsets\(edges\)/);
  assert.match(layer, /data-story-variant-link-layer=/);
  assert.match(layer, /aria-hidden="true"/);
  assert.match(layer, /focusable="false"/);
  assert.match(layer, /markerWidth="12" markerHeight="12"/);
  assert.match(layer, /markerUnits="userSpaceOnUse"/);
  assert.match(layer, /const progressionFanGroups = \["transition", "interaction"\]\.includes\(scope\)/,
    "only the two authoring canvases in the sketch render candidate progression buses");
  assert.match(layer, /storyVariantProgressionFanGroups\(edges\)/);
  assert.match(layer, /data-story-variant-progression-bus="\$\{escapeHtml\(key\)\}"/);
  assert.match(layer, /class="source-graph-transition-path story-variant-progression-bus-trunk"/);
  assert.match(layer, /class="source-graph-transition-path story-variant-progression-bus-arrow" marker-end=/);
  const busStart = layer.indexOf('class="story-variant-progression-bus ');
  const busEnd = layer.indexOf("${edges.map", busStart);
  assert.ok(busStart >= 0 && busEnd > busStart, "candidate bus markup precedes its per-route branches");
  const busMarkup = layer.slice(busStart, busEnd);
  assert.equal((busMarkup.match(/marker-end=/g) || []).length, 1,
    "one shared fan has exactly one arrowhead, on its final destination segment");
  assert.match(layer, /class="source-graph-transition-path \$\{progressionFanKey \? "story-variant-progression-branch" : ""\}"/);
  assert.match(layer, /\$\{progressionFanKey \? "data-story-variant-progression-branch" : `marker-end=/,
    "fan branches are markerless while non-fan and manual-switch routes retain their own arrowhead");
  assert.match(layer, /source-graph-transition-halo/);
  assert.match(layer, /source-graph-transition-path/);
  assert.match(layer, /interactiveTransitions/);
  assert.match(layer, /renderInterBeatVariantTransitionPreview\(proposal, edge\)/);
  assert.match(layer, /const interactionLabels = scope === "interaction"/);
  assert.match(layer, /const interactionLabelEdges = interactionLabels \? edges : \[\]/);
  assert.match(layer, /const progression = sourceGraphIsVariantProgression\(edge\)/);
  assert.match(layer, /interactionBoundaryControlForEdge\(edge, interactionContext\)/);
  assert.match(layer, /const targetType = progression \? "boundary" : "variant-edge"/);
  assert.match(layer, /data-interaction-boundary-policy-select data-interaction-boundary-id/,
    "variant-to-next-beat arrows use independently addressable boundary controls");
  assert.doesNotMatch(layer, /storyVariantInteractionLabelEdges\(/,
    "each directed arrow keeps its own Interaction control");
  assert.match(layer, /aria-label="Variant interaction assignments"/);
  assert.match(layer, /data-story-variant-interaction-label="\$\{escapeHtml\(edge\.id\)\}"/);
  assert.match(layer, /<select[^>]*data-story-variant-interaction-policy-select/);
  assert.match(layer, /data-interaction-variant-edge-id="\$\{escapeHtml\(edge\.id\)\}"/);
  for (const label of ["UI button press", "Direct manipulation", "Reader locomotion"]) {
    assert.match(layer, new RegExp(label));
  }
  assert.ok(
    layer.indexOf("interactionLabelEdges.map") > layer.indexOf("edges.map"),
    "dropdowns paint after all arrow paths so their text and hit targets stay unobstructed",
  );
  assert.doesNotMatch(layer, /data-source-graph-edge=/);
  assert.doesNotMatch(layer, /source-graph-transition-hit-path/);
  assert.doesNotMatch(layer, /tabindex=/);
  assert.doesNotMatch(layer, /role="button"/);
});

test("every multi-card checkpoint story canvas mounts the same route-arrow layer", () => {
  const canvases = [
    ["renderDynamicStoryCanvas", "dynamic"],
    ["renderEnvironmentStoryCanvas", "environment"],
    ["renderSpatialStoryCanvas", "spatial"],
    ["renderAttentionStoryCanvas", "attention"],
    ["renderInteractionStoryCanvas", "interaction"],
    ["renderInterBeatStoryCanvas", "transition"],
  ];

  for (const [name, scope] of canvases) {
    const canvas = functionSource(name);
    assert.match(canvas, /data-story-variant-canvas-viewport/);
    assert.match(canvas, /story-variant-links-canvas/);
    const call = scope === "transition"
      ? `renderStoryVariantLinkLayer\\("${scope}", proposal\\)`
      : scope === "interaction"
        ? `renderStoryVariantLinkLayer\\("${scope}", proposal, boundaryContext\\)`
        : `renderStoryVariantLinkLayer\\("${scope}"\\)`;
    assert.match(canvas, new RegExp(call));
  }

  const transitionCanvas = functionSource("renderInterBeatStoryCanvas");
  assert.match(transitionCanvas, /Select a scene change to preview it/);
  assert.doesNotMatch(transitionCanvas, /transition-connection-list|one saved scene at a time/);
});

test("Interaction renders one independently addressable dropdown for every directed variant arrow", () => {
  const layer = functionSource("renderStoryVariantLinkLayer");

  assert.match(layer, /const interactionLabelEdges = interactionLabels \? edges : \[\]/);
  assert.match(layer, /interactionLabelEdges\.map\(\(edge\) =>/);
  assert.match(layer, /data-story-variant-interaction-label="\$\{escapeHtml\(edge\.id\)\}"/);
  assert.match(layer, /data-interaction-variant-edge-id="\$\{escapeHtml\(edge\.id\)\}"/);
  assert.doesNotMatch(source, /function storyVariantInteractionLabelEdges\(/,
    "reciprocal directions must not collapse into one shared assignment");
});

test("variant cards expose checkpoint-neutral endpoint identities without replacing their existing actions", () => {
  const attributes = functionSource("renderStoryVariantCardAttributes");
  assert.match(attributes, /if \(!context\?\.beatId\) return ""/);
  assert.match(attributes, /data-story-route-card/);
  assert.match(attributes, /data-story-route-beat-id=/);
  assert.match(attributes, /data-story-variant-card/);
  assert.match(attributes, /data-story-variant-beat-id=/);
  assert.match(attributes, /data-story-variant-group-id=/);
  assert.match(attributes, /data-story-variant-option-id=/);
  assert.match(attributes, /const variant = Boolean\(context\.variantGroupId && context\.variantOptionId\)/);

  const cards = [
    ["renderDynamicStoryCard", "data-dynamic-open-scene"],
    ["renderEnvironmentStoryCard", "data-environment-open-scene"],
    ["renderSpatialStoryCard", "data-spatial-open-scene"],
    ["renderAttentionStoryCard", "data-attention-open-scene"],
    ["renderInteractionStoryCard", "data-interaction-open-scene"],
  ];
  for (const [name, existingAction] of cards) {
    const card = functionSource(name);
    assert.match(card, /renderStoryVariantCardAttributes\(context\)/);
    assert.match(card, new RegExp(existingAction));
  }
  const transitionCard = functionSource("renderInterBeatStoryCard");
  assert.match(transitionCard, /renderStoryVariantCardAttributes\(context\)/);
  assert.doesNotMatch(transitionCard, /data-inter-beat-open-scene|<button/,
    "Transition cards remain endpoints for the shared arrows without opening the spatial editor");
});

test("the shared layout follows card resizing and reuses reciprocal lanes and collision-aware routing", () => {
  const render = functionSource("render");
  const initialize = functionSource("initializeStoryVariantLinkLayout");
  const layout = functionSource("layoutStoryVariantLinks");
  const endpoint = functionSource("storyVariantCardElementForEndpoint");
  const cardRects = functionSource("storyVariantLinkCardRects");

  assert.ok(
    render.indexOf("disposeStoryVariantLinkLayout();") < render.indexOf("if (!state.data)"),
    "detached overlays are disposed before the loading early return",
  );
  assert.ok(
    render.indexOf("bindEvents();") < render.indexOf("initializeStoryVariantLinkLayout();"),
    "the overlay initializes after checkpoint interactions are bound",
  );
  assert.match(initialize, /new ResizeObserver\(scheduleStoryVariantLinkLayout\)/);
  assert.match(initialize, /observe\(viewport\)/);
  assert.match(initialize, /source-graph-canvas-track/);
  assert.match(initialize, /querySelectorAll\("\.source-graph-beat-card"\)/);
  assert.match(layout, /\.filter\(\(edge\) => sourceGraphIsDownstreamVariantEdge\(edge\)\)/);
  assert.match(layout, /sourceGraphReciprocalLaneOffsets\(renderedEdges\)/);
  assert.match(layout, /storyVariantLinkCardRects\(viewport\)/);
  assert.match(layout, /sourceGraphCardSidePoint\(sourceCard, edge\.from\.side, viewport, laneOffset\)/);
  assert.match(layout, /sourceGraphCardSidePoint\(targetCard, edge\.to\.side, viewport, laneOffset\)/);
  assert.match(layout, /sourceGraphLinkPath\(start, end, edge\.from\.side, edge\.to\.side, cardRects\)/);
  assert.match(layout, /data-story-variant-transition-preview/);
  assert.match(layout, /data-story-variant-interaction-label/);
  assert.match(layout, /interactionLabels\.get\(edge\.id\)/);
  assert.match(layout, /querySelectorAll\("\[data-story-variant-progression-bus\]"\)/);
  assert.match(layout, /layout\.group\.dataset\.storyVariantProgressionFanKey === key/);
  assert.match(layout, /layout\.edge\.from\.side !== "right"/);
  assert.match(layout, /layout\.edge\.to\.side !== "left"/);
  assert.match(layout, /const control = layout\.preview \|\| layout\.interactionLabel/);
  assert.match(layout, /dataset\.storyVariantPreviewWidth/);
  assert.match(layout, /dataset\.storyVariantPreviewHeight/);
  assert.match(layout, /dataset\.storyVariantInteractionLabelWidth/);
  assert.match(layout, /dataset\.storyVariantInteractionLabelHeight/);
  assert.match(layout, /storyVariantProgressionFanGeometry\(fanRoutes, \{/);
  assert.match(layout, /controlGap:\s*10/);
  assert.match(layout, /minimumBranchLength:\s*maximumControlWidth \+ 24/);
  assert.match(layout, /const fanBranch = fanBranches\.get\(edge\.id\) \|\| null/);
  assert.match(layout, /const path = fanBranch[\s\S]*sourceGraphLinkPath\(start, end, edge\.from\.side, edge\.to\.side, cardRects\)/,
    "a manual switch or rejected fan candidate keeps the collision-aware per-edge route");
  assert.match(layout, /if \(fanBranch\) routePath\?\.removeAttribute\("marker-end"\)/);
  assert.match(layout, /else routePath\?\.setAttribute\([\s\S]*"marker-end",[\s\S]*problemMarkerReference : markerReference/,
    "manual-switch fallback restores its individual arrowhead");
  assert.match(layout, /preview\.setAttribute\("x", String\(fanBranch\.label\.x\)\)/);
  assert.match(layout, /preview\.setAttribute\("y", String\(fanBranch\.label\.y\)\)/);
  assert.match(layout, /interactionLabel\.setAttribute\("x", String\(fanBranch\.label\.x\)\)/);
  assert.match(layout, /interactionLabel\.setAttribute\("y", String\(fanBranch\.label\.y\)\)/,
    "both canvases apply the pure helper's data-sized label position above the branch");
  assert.match(layout, /getPointAtLength\(pathLength \/ 2\)/);
  assert.match(layout, /reciprocalOffset/);
  assert.match(layout, /verticalPorts/);
  assert.match(layout, /horizontalPorts/);
  assert.match(layout, /const reciprocalDirection = laneOffset \? Math\.sign\(laneOffset\) : 0/);
  assert.match(layout, /const reciprocalX = reciprocalDirection && verticalPorts/);
  assert.match(layout, /const reciprocalY = reciprocalDirection && horizontalPorts/);
  assert.match(layout, /labelWidth \/ 2 \+ 16/);
  assert.match(layout, /labelHeight \/ 2 \+ 14/);
  assert.match(endpoint, /querySelectorAll\("\[data-story-route-card\]"\)/);
  assert.match(endpoint, /if \(endpoint\.cardKind === "variant"\)/);
  assert.match(endpoint, /storyVariantBeatId === endpoint\.beatId/);
  assert.match(endpoint, /storyVariantGroupId === endpoint\.variantGroupId/);
  assert.match(endpoint, /storyVariantOptionId === endpoint\.variantOptionId/);
  assert.match(endpoint, /storyRouteBeatId === endpoint\.beatId/);
  assert.match(endpoint, /!card\.dataset\.storyVariantOptionId/,
    "a variant progression arrow can terminate at a non-variant next-beat card");
  assert.match(cardRects, /querySelectorAll\("\.source-graph-beat-card"\)/);
});

test("downstream arrows keep Source Graph clearance while Transition previews and Interaction dropdowns accept pointer input", () => {
  assert.match(
    styles,
    /\.story-variant-links-canvas \.source-graph-beat-item\.has-variants > \.source-graph-beat-card\s*\{[^}]*margin-block-end:\s*30px;/s,
  );
  assert.match(
    styles,
    /\.story-variant-links-canvas \.source-graph-variant-alternatives > li:not\(:last-child\)\s*\{[^}]*margin-block-end:\s*30px;/s,
  );
  assert.match(
    styles,
    /\.story-variant-link-layer,[\s\S]*\.story-variant-transition-edge\s*\{[^}]*pointer-events:\s*none;/s,
  );
  assert.match(
    styles,
    /\.story-variant-link-layer\.has-transition-previews \.story-variant-transition-preview\s*\{[^}]*pointer-events:\s*all;/s,
  );
  assert.match(styles, /\.story-variant-interaction-label\s*\{[^}]*pointer-events:\s*(?:all|auto);/s);
  assert.match(styles, /\.story-variant-interaction-label-content\s*\{[^}]*display:\s*grid;[^}]*justify-content:\s*center;/s);
  assert.match(
    styles,
    /\.story-variant-interaction-policy-select\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*34px;[^}]*pointer-events:\s*auto;/s,
  );
  const layer = functionSource("renderStoryVariantLinkLayer");
  const width = Number(layer.match(/data-story-variant-interaction-label-width="(\d+)"/)?.[1] || 0);
  const height = Number(layer.match(/data-story-variant-interaction-label-height="(\d+)"/)?.[1] || 0);
  assert.equal(width, 196, "Interaction route controls use the compact grouped-card width");
  assert.equal(height, 72, "Interaction route controls use the compact grouped-card height");
  assert.match(
    styles,
    /\.story-variant-interaction-label-content\s*\{[^}]*grid-template-columns:\s*50px minmax\(0, 1fr\);[^}]*gap:\s*8px;[^}]*border-radius:\s*14px;[^}]*padding:\s*6px;/s,
    "the icon and policy selector share one horizontal grouped card",
  );
  assert.match(
    styles,
    /\.story-variant-interaction-label \.interaction-option-thumbnails\s*\{[^}]*grid-template-columns:\s*minmax\(0, 44px\);/s,
  );
  assert.match(
    styles,
    /\.transition-story-canvas-viewport \.source-graph-variant-alternatives > li:not\(:last-child\)\s*\{[^}]*margin-block-end:\s*96px;/s,
  );
  assert.match(
    styles,
    /\.interaction-story-canvas-viewport \.source-graph-variant-alternatives > li:not\(:last-child\)\s*\{[^}]*margin-block-end:\s*84px;/s,
  );
  assert.match(styles, /\.source-graph-transition-path,[\s\S]*\.source-graph-link-draft\s*\{[^}]*stroke:\s*var\(--story-canvas-arrow-color\);[^}]*stroke-width:\s*var\(--story-canvas-arrow-stroke-width\);/s);
  assert.doesNotMatch(styles, /\.source-graph-transition-edge\.is-variant-switch \.source-graph-transition-path\s*\{[^}]*(?:stroke|stroke-width):/s);
  assert.match(styles, /\.source-graph-transition-halo\s*\{[^}]*stroke-width:\s*8px;/s);
});
