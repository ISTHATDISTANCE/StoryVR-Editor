import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFetchedStoryResources } from "./storyvr-adapter.mjs";

async function writeFetchedFixture({
  variantGroups = [],
  unresolvedVariantGroups = [],
  additionalAssets = [],
  additionalSlides = [],
  textOnlyParts = null,
  headings = [],
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-variants-"));
  const metadata = path.join(root, "metadata");
  await mkdir(metadata, { recursive: true });
  await writeFile(path.join(metadata, "source_discovery.json"), JSON.stringify({
    slug: "generic-habitats",
    title: "Generic habitats",
    story_url: "https://example.com/habitats",
  }));
  await writeFile(path.join(metadata, "asset_manifest.json"), JSON.stringify([
    { local_path: "models/forest.glb", asset_url: "https://example.com/forest.glb", asset_type: "model" },
    { local_path: "models/desert.glb", asset_url: "https://example.com/desert.glb", asset_type: "model" },
    ...additionalAssets,
  ]));
  await writeFile(path.join(metadata, "story_structure_candidates.json"), JSON.stringify({
    title: "Generic habitats",
    headings,
    scroll_steps: [],
    captions: [],
    image_groups: [],
    downloaded_text_matches: [],
    slides: [
      {
        text: "Forest — Choose a habitat",
        domOrder: 200,
        attributes: { probeAssetFiles: ["models/forest.glb"] },
      },
      {
        text: "Desert — Choose a habitat",
        domOrder: 200,
        attributes: { probeAssetFiles: ["models/desert.glb"] },
      },
      ...additionalSlides,
    ],
    text_only_parts: textOnlyParts || [
      { text: "Opening context", domOrder: 100 },
      { text: "Forest details Desert details", domOrder: 200 },
    ],
    ...(variantGroups.length ? { variant_groups: variantGroups } : {}),
    ...(unresolvedVariantGroups.length ? { unresolved_variant_groups: unresolvedVariantGroups } : {}),
  }));
  return root;
}

const variantGroups = [{
  id: "habitat-selector",
  title: "Choose a habitat",
  domOrder: 200,
  defaultOptionId: "forest",
  control: { kind: "previous-next", previousLabel: "Previous habitat", nextLabel: "Next habitat", wrap: true },
  options: [
    { id: "forest", label: "Forest", text: "Forest details", sourceOrder: 0, asset_ids: ["forest.glb"] },
    { id: "desert", label: "Desert", text: "Desert details", sourceOrder: 1, asset_ids: ["desert.glb"] },
  ],
}];

test("fetched adapter collapses evidence-declared variants into one within-beat group", async () => {
  const resourceFolder = await writeFetchedFixture({ variantGroups });
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", { storyFolder: path.dirname(resourceFolder) });

  assert.equal(runtime.variantGroups.length, 1);
  assert.equal(runtime.interactions.variantGroups.length, 1);
  assert.deepEqual(runtime.variantGroups[0].options.map((option) => option.assetIds), [["forest.glb"], ["desert.glb"]]);
  assert.deepEqual(runtime.contentUnits.map((unit) => unit.id), ["text-only-1", "habitat-selector"]);
  const groupBeat = runtime.contentUnits[1];
  assert.equal(groupBeat.kind, "variant-group");
  assert.equal(groupBeat.title, "Choose a habitat");
  assert.equal(groupBeat.sectionHeading, "Choose a habitat");
  assert.equal(groupBeat.text, "Forest details");
  assert.deepEqual(groupBeat.linkedAssets.map((asset) => asset.id), ["forest.glb", "desert.glb"]);
});

test("fetched adapter leaves stories without variant_groups on the existing path", async () => {
  const resourceFolder = await writeFetchedFixture();
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", { storyFolder: path.dirname(resourceFolder) });

  assert.equal("variantGroups" in runtime, false);
  assert.equal("variantGroups" in runtime.interactions, false);
  assert.equal(runtime.contentUnits.some((unit) => unit.kind === "variant-group"), false);
  assert.equal(runtime.contentUnits.length, 4);
});

test("fetched adapter preserves analyzer-paired section titles across mixed legacy order values", async () => {
  const resourceFolder = await writeFetchedFixture({
    headings: [
      { text: "Stay away from shark food", domOrder: 52798.012 },
      { text: "Watch what you wear", domOrder: 59487.014 },
    ],
    additionalSlides: [{
      id: "watch-what-you-wear",
      text: "Leave shiny jewelry at home because sharks see contrast.",
      title: "Watch what you wear",
      sectionHeading: "Watch what you wear",
      domOrder: 53700,
      attributes: { probeAssetFiles: ["models/forest.glb"] },
    }],
  });
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", { storyFolder: path.dirname(resourceFolder) });
  const beat = runtime.contentUnits.find((unit) => unit.id === "watch-what-you-wear");

  assert.equal(beat.sectionHeading, "Watch what you wear");
  assert.equal(beat.title, "Watch what you wear");
  assert.equal(beat.text, "Leave shiny jewelry at home because sharks see contrast.");
});

test("fetched adapter keeps distant prose and analyzer-preserved selector introductions", async () => {
  const locationVariants = [{
    id: "risk-selector",
    title: "What’s your risk?",
    domOrder: 20000,
    defaultOptionId: "california",
    evidence: { rootSelector: "div.slide.slide-1.story-widget" },
    options: ["California", "Florida", "Hawaii"].map((label, index) => ({
      id: label.toLowerCase(),
      label,
      text: `${label} details`,
      sourceOrder: index,
      domOrder: 24000 + index,
    })),
  }];
  const resourceFolder = await writeFetchedFixture({
    variantGroups: locationVariants,
    textOnlyParts: [
      {
        id: "opening",
        text: "Opening prose mentions Hawaii and the Florida Museum, but it is not selector content.",
        domOrder: 5000,
        tag: "div",
        className: "slide slide-0 story-widget",
      },
      {
        id: "selector-intro",
        text: "The answer depends on where you are. Hawaii and Florida are examples.",
        domOrder: 15500,
        tag: "div",
        className: "slide slide-1 story-widget",
        observed: { variantGroupId: "risk-selector", variantTextRole: "narrative-prefix" },
      },
      {
        id: "selector-aggregate",
        text: "What’s your risk? California Florida Hawaii California details Florida details Hawaii details",
        domOrder: 15600,
        tag: "div",
        className: "slide slide-1 story-widget",
      },
      {
        id: "credits",
        text: "Special thanks to researchers in Florida, Hawaii and California.",
        domOrder: 73000,
        tag: "div",
        className: "slide slide-6 story-widget",
      },
    ],
  });
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", { storyFolder: path.dirname(resourceFolder) });
  const ids = runtime.contentUnits.map((unit) => unit.id);

  assert.equal(ids.includes("opening"), true);
  assert.equal(ids.includes("selector-intro"), true);
  assert.equal(ids.includes("credits"), true);
  assert.equal(ids.includes("selector-aggregate"), false);
  assert.equal(ids.includes("risk-selector"), true);
});

test("fetched adapter keeps nested visual children inside the parent selector beat", async () => {
  const nestedVariantGroups = [{
    id: "region-selector",
    title: "Choose a region",
    domOrder: 200,
    defaultOptionId: "north",
    control: { kind: "button-cluster", wrap: false },
    options: [
      {
        id: "north",
        label: "North",
        text: "Northern forest and desert habitats",
        sourceOrder: 0,
        asset_ids: ["forest.glb", "desert.glb"],
        visual_children: [{
          id: "habitats-north",
          title: "Habitats in the North",
          options: [
            { id: "forest", label: "Forest", asset_ids: ["forest.glb"] },
            { id: "desert", label: "Desert", asset_ids: ["desert.glb"] },
          ],
          evidence: { source: "collector-verified-nested-interaction" },
        }],
      },
      {
        id: "south",
        label: "South",
        text: "Southern coast and reef habitats",
        sourceOrder: 1,
        asset_ids: ["coast.glb", "reef.glb"],
        visual_children: [{
          id: "habitats-south",
          title: "Habitats in the South",
          options: [
            { id: "coast", label: "Coast", asset_ids: ["coast.glb"] },
            { id: "reef", label: "Reef", asset_ids: ["reef.glb"] },
          ],
          evidence: { source: "collector-verified-nested-interaction" },
        }],
      },
    ],
  }];
  const resourceFolder = await writeFetchedFixture({
    variantGroups: nestedVariantGroups,
    additionalAssets: [
      { local_path: "models/coast.glb", asset_url: "https://example.com/coast.glb", asset_type: "model" },
      { local_path: "models/reef.glb", asset_url: "https://example.com/reef.glb", asset_type: "model" },
    ],
    additionalSlides: [
      {
        text: "Coast — Choose a habitat",
        domOrder: 200,
        attributes: { probeAssetFiles: ["models/coast.glb"] },
      },
      {
        text: "Reef — Choose a habitat",
        domOrder: 200,
        attributes: { probeAssetFiles: ["models/reef.glb"] },
      },
    ],
  });
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", { storyFolder: path.dirname(resourceFolder) });

  assert.equal(runtime.variantGroups.length, 1);
  assert.equal(runtime.contentUnits.filter((unit) => unit.kind === "variant-group").length, 1);
  assert.equal(runtime.contentUnits.some((unit) => unit.id === "habitats-north" || unit.id === "habitats-south"), false);
  assert.deepEqual(runtime.variantGroups[0].options.map((option) => option.assetIds), [
    ["forest.glb", "desert.glb"],
    ["coast.glb", "reef.glb"],
  ]);
  assert.deepEqual(runtime.variantGroups[0].options.map((option) => option.visualChildren[0].options.map((child) => child.assetIds)), [
    [["forest.glb"], ["desert.glb"]],
    [["coast.glb"], ["reef.glb"]],
  ]);
  assert.deepEqual(runtime.contentUnits.find((unit) => unit.id === "region-selector").linkedAssets.map((asset) => asset.id), [
    "forest.glb",
    "desert.glb",
    "coast.glb",
    "reef.glb",
  ]);
});

test("fetched adapter never promotes unresolved dependent controls to top-level variant beats", async () => {
  const unresolvedChild = {
    id: "forms-for-north",
    title: "Forms available in North",
    domOrder: 220,
    hierarchy: {
      role: "unresolved-nested-control",
      candidateParentGroupIds: ["region-selector"],
    },
    options: [
      { id: "forest", label: "Forest", text: "Forest form", sourceOrder: 0, asset_ids: ["forest.glb"] },
      { id: "desert", label: "Desert", text: "Desert form", sourceOrder: 1, asset_ids: ["desert.glb"] },
    ],
  };
  const topLevel = {
    ...variantGroups[0],
    id: "region-selector",
    title: "Choose a region",
    hierarchy: { role: "top-level" },
    options: [
      { id: "north", label: "North", text: "Northern details", sourceOrder: 0 },
      { id: "south", label: "South", text: "Southern details", sourceOrder: 1 },
    ],
  };
  const resourceFolder = await writeFetchedFixture({
    variantGroups: [topLevel, unresolvedChild],
    unresolvedVariantGroups: [unresolvedChild],
  });
  const runtime = await importFetchedStoryResources(resourceFolder, "dev", { storyFolder: path.dirname(resourceFolder) });

  assert.deepEqual(runtime.variantGroups.map((group) => group.id), ["region-selector"]);
  assert.equal(runtime.contentUnits.some((unit) => unit.id === "forms-for-north"), false);
  assert.equal(runtime.rawSummary.unresolvedVariantGroupCount, 1);
  assert.equal(runtime.diagnostics.some((diagnostic) => diagnostic.code === "UNRESOLVED_NESTED_VARIANT_CONTROLS"), true);
});
