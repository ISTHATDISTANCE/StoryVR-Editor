import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAuthorProject, saveStoryGraph } from "./engine.mjs";
import {
  combineSourceGraphCards,
  placeSourceGraphBeatAsVariant,
  reorderSourceGraphBeat,
  reorderSourceGraphVariant,
} from "./app/src/source-graph-canvas.js";

test("manually linked assets promote a text-only beat and persist visual evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-manual-text-link-"));
  try {
    const storyFolder = path.join(root, "manual-link-fixture");
    await mkdir(path.join(storyFolder, "analysis", "storyvr"), { recursive: true });
    const asset = {
      id: "model-window",
      type: "model",
      path: "models/window.glb",
      role: "source",
    };
    const textBeat = {
      id: "body-1",
      kind: "text-only",
      originalField: "text_only_parts",
      isTextOnly: true,
      title: "Opening windows",
      text: "Opening windows improves classroom ventilation.",
      linkedAssets: [asset],
      atomicBeatIds: ["body-1"],
    };
    const graph = {
      schemaVersion: "storyvr-source-graph/v1",
      story: { slug: "manual-link-fixture", title: "Manual Link Fixture" },
      atomicBeats: [textBeat],
      beats: [textBeat],
      entities: [],
      assetInventory: [asset],
      textVisualEvidenceLinks: [{
        beatId: "body-1",
        textCue: "Opening windows",
        assetLinks: [],
        confidence: 1,
        assetExpectation: "none",
      }],
    };

    const saved = await saveStoryGraph({ storyFolder }, graph);
    const beat = saved.beats[0];
    const evidence = saved.textVisualEvidenceLinks[0];

    assert.equal(beat.isTextOnly, false);
    assert.equal(beat.sourceWasTextOnly, true);
    assert.deepEqual(beat.linkedAssets.map((item) => item.id), [asset.id]);
    assert.deepEqual(evidence.assetLinks, [asset.id]);
    assert.equal(evidence.assetExpectation, "visual");

    const unlinkedGraph = structuredClone(saved);
    unlinkedGraph.atomicBeats[0].linkedAssets = [];
    unlinkedGraph.beats[0].linkedAssets = [];
    const unlinked = await saveStoryGraph({ storyFolder }, unlinkedGraph);

    assert.equal(unlinked.beats[0].isTextOnly, true);
    assert.deepEqual(unlinked.textVisualEvidenceLinks[0].assetLinks, []);
    assert.equal(unlinked.textVisualEvidenceLinks[0].assetExpectation, "none");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removed authored and atomic beats stay removed after Source Graph saves", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-remove-beat-"));
  try {
    const storyFolder = path.join(root, "remove-beat-fixture");
    await mkdir(path.join(storyFolder, "analysis", "storyvr"), { recursive: true });
    const beats = ["opening", "irrelevant-aside", "conclusion"].map((id) => ({
      id,
      kind: "text-only",
      originalField: "text_only_parts",
      isTextOnly: true,
      title: id,
      text: `Text for ${id}.`,
      linkedAssets: [],
      atomicBeatIds: [id],
    }));
    const graph = {
      schemaVersion: "storyvr-source-graph/v1",
      story: { slug: "remove-beat-fixture", title: "Remove Beat Fixture" },
      atomicBeats: structuredClone(beats),
      beats: structuredClone(beats),
      entities: [],
      assetInventory: [],
      textVisualEvidenceLinks: beats.map((beat) => ({
        beatId: beat.id,
        textCue: beat.title,
        assetLinks: [],
        confidence: 1,
        assetExpectation: "none",
      })),
      manualBeatAssetLinks: {
        schemaVersion: "storyvr-manual-beat-asset-links/v1",
        byBeatId: {
          "irrelevant-aside": { assetIds: [], touchedAssetIds: ["unused-asset"] },
        },
      },
    };

    const initial = await saveStoryGraph({ storyFolder }, graph);
    const edited = structuredClone(initial);
    edited.beats = edited.beats.filter((beat) => beat.id !== "irrelevant-aside");
    edited.atomicBeats = edited.atomicBeats.filter((beat) => beat.id !== "irrelevant-aside");
    const saved = await saveStoryGraph({ storyFolder }, edited);
    const savedAgain = await saveStoryGraph({ storyFolder }, structuredClone(saved));

    assert.deepEqual(saved.beats.map((beat) => beat.id), ["opening", "conclusion"]);
    assert.deepEqual(saved.atomicBeats.map((beat) => beat.id), ["opening", "conclusion"]);
    assert.deepEqual(saved.textVisualEvidenceLinks.map((link) => link.beatId), ["opening", "conclusion"]);
    assert.equal(saved.manualBeatAssetLinks.byBeatId["irrelevant-aside"], undefined);
    assert.deepEqual(savedAgain.beats.map((beat) => beat.id), ["opening", "conclusion"]);
    assert.deepEqual(savedAgain.atomicBeats.map((beat) => beat.id), ["opening", "conclusion"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("drag-reordered beats and variants keep their authored order across repeated saves", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-card-reorder-"));
  try {
    const storyFolder = path.join(root, "card-reorder-fixture");
    await mkdir(path.join(storyFolder, "analysis", "storyvr"), { recursive: true });
    const atomicBeats = ["beat-a", "beat-b", "beat-b-two", "beat-b-three", "beat-c"].map((id) => ({
      id,
      kind: "text-only",
      originalField: "text_only_parts",
      isTextOnly: true,
      title: id,
      text: `Text for ${id}.`,
      linkedAssets: [],
      atomicBeatIds: [id],
    }));
    const graph = {
      schemaVersion: "storyvr-source-graph/v1",
      story: { slug: "card-reorder-fixture", title: "Card Reorder Fixture" },
      atomicBeats: structuredClone(atomicBeats),
      beats: [atomicBeats[0], { ...atomicBeats[1], variantGroupId: "group-b" }, atomicBeats[4]],
      entities: [],
      assetInventory: [],
      variantGroups: [{
        id: "group-b",
        beatId: "beat-b",
        title: "Beat B options",
        defaultOptionId: "option-one",
        options: [
          { id: "option-one", label: "One", text: "One", sourceBeatId: "beat-b", atomicBeatIds: ["beat-b"], sourceOrder: 0 },
          { id: "option-two", label: "Two", text: "Two", sourceBeatId: "beat-b-two", atomicBeatIds: ["beat-b-two"], sourceOrder: 1 },
          { id: "option-three", label: "Three", text: "Three", sourceBeatId: "beat-b-three", atomicBeatIds: ["beat-b-three"], sourceOrder: 2 },
        ],
      }],
    };

    reorderSourceGraphBeat(graph, { sourceBeatId: "beat-c", targetBeatId: "beat-a", placement: "before" });
    reorderSourceGraphVariant(graph, {
      variantGroupId: "group-b",
      sourceVariantOptionId: "option-three",
      afterOptionId: "option-one",
    });
    const saved = await saveStoryGraph({ storyFolder }, graph);
    const savedAgain = await saveStoryGraph({ storyFolder }, structuredClone(saved));

    for (const value of [saved, savedAgain]) {
      assert.deepEqual(value.beats.map((beat) => beat.id), ["beat-c", "beat-a", "beat-b"]);
      assert.deepEqual(value.variantGroups[0].options.map((option) => option.id), [
        "option-one",
        "option-three",
        "option-two",
      ]);
      assert.deepEqual(value.variantGroups[0].options.map((option) => option.sourceOrder), [0, 1, 2]);
      assert.equal(value.variantGroups[0].defaultOptionId, "option-one");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("drag-combined beats retain the destination title and text order after save normalization", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-card-combine-"));
  try {
    const storyFolder = path.join(root, "card-combine-fixture");
    await mkdir(path.join(storyFolder, "analysis", "storyvr"), { recursive: true });
    const beats = [
      {
        id: "source-a",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Source title",
        sectionHeading: "Source title",
        text: "Source text.",
        linkedAssets: [],
        atomicBeatIds: ["source-a"],
      },
      {
        id: "middle",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Middle title",
        sectionHeading: "Middle title",
        text: "Middle text.",
        linkedAssets: [],
        atomicBeatIds: ["middle"],
      },
      {
        id: "destination-b",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Destination title",
        sectionHeading: "Destination title",
        text: "Destination text.",
        linkedAssets: [],
        atomicBeatIds: ["destination-b"],
      },
    ];
    const graph = {
      schemaVersion: "storyvr-source-graph/v1",
      story: { slug: "card-combine-fixture", title: "Story fallback title" },
      atomicBeats: structuredClone(beats),
      beats: structuredClone(beats),
      entities: [],
      assetInventory: [],
      textVisualEvidenceLinks: [],
    };

    const result = combineSourceGraphCards(graph, {
      source: { cardKind: "beat", beatId: "source-a" },
      target: { cardKind: "beat", beatId: "destination-b" },
      placement: "up",
    });
    const saved = await saveStoryGraph({ storyFolder }, graph);
    const combined = saved.beats.find((beat) => beat.id === result.combinedBeatId);

    assert.deepEqual(saved.beats.map((beat) => beat.id), ["middle", result.combinedBeatId]);
    assert.equal(combined.title, "Destination title");
    assert.equal(combined.sectionHeading, "Destination title");
    assert.equal(combined.text, "Source text.\n\nDestination text.");
    assert.deepEqual(combined.atomicBeatIds, ["source-a", "destination-b"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("drag-created and extended variant groups keep option atoms hidden across repeated saves", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-card-variant-"));
  try {
    const storyFolder = path.join(root, "card-variant-fixture");
    await mkdir(path.join(storyFolder, "analysis", "storyvr"), { recursive: true });
    const beats = [
      {
        id: "option-a",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Option A",
        sectionHeading: "Option A",
        text: "Text A.",
        linkedAssets: [],
        atomicBeatIds: ["option-a"],
      },
      {
        id: "option-b",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Option B",
        sectionHeading: "Option B",
        text: "Text B.",
        linkedAssets: [],
        atomicBeatIds: ["option-b"],
      },
      {
        id: "destination-c",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Destination C",
        sectionHeading: "Destination C",
        text: "Text C.",
        linkedAssets: [],
        atomicBeatIds: ["destination-c"],
      },
    ];
    const graph = {
      schemaVersion: "storyvr-source-graph/v1",
      story: { slug: "card-variant-fixture", title: "Card Variant Fixture" },
      atomicBeats: structuredClone(beats),
      beats: structuredClone(beats),
      entities: [],
      assetInventory: [],
      textVisualEvidenceLinks: [],
    };

    placeSourceGraphBeatAsVariant(graph, {
      sourceBeatId: "option-a",
      targetBeatId: "destination-c",
    });
    const group = graph.variantGroups[0];
    placeSourceGraphBeatAsVariant(graph, {
      sourceBeatId: "option-b",
      targetBeatId: "destination-c",
      afterOptionId: group.defaultOptionId,
    });

    const saved = await saveStoryGraph({ storyFolder }, graph);
    const savedAgain = await saveStoryGraph({ storyFolder }, structuredClone(saved));

    for (const value of [saved, savedAgain]) {
      assert.deepEqual(value.beats.map((beat) => beat.id), ["destination-c"]);
      assert.deepEqual(value.atomicBeats.map((beat) => beat.id), ["option-a", "option-b", "destination-c"]);
      assert.deepEqual(value.beats[0].atomicBeatIds, ["destination-c"]);
      assert.equal(value.beats[0].isCombined, undefined);
      assert.equal(value.variantGroups[0].defaultOptionId, value.variantGroups[0].options[0].id);
      assert.deepEqual(value.variantGroups[0].options.map((option) => option.sourceBeatId), [
        "destination-c",
        "option-b",
        "option-a",
      ]);
      assert.deepEqual(value.variantGroups[0].options.map((option) => option.atomicBeatIds), [
        ["destination-c"],
        ["option-b"],
        ["option-a"],
      ]);
      assert.deepEqual(value.variantGroups[0].options.map((option) => option.sourceOrder), [0, 1, 2]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a beat combined onto a variant option stays inside that option across repeated saves", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-card-variant-combine-"));
  try {
    const storyFolder = path.join(root, "card-variant-combine-fixture");
    await mkdir(path.join(storyFolder, "analysis", "storyvr"), { recursive: true });
    const beats = [
      {
        id: "option-a",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Option A",
        sectionHeading: "Option A",
        text: "Text A.",
        linkedAssets: [],
        atomicBeatIds: ["option-a"],
      },
      {
        id: "combined-source-b",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Combined source B",
        sectionHeading: "Combined source B",
        text: "Text B.",
        linkedAssets: [],
        atomicBeatIds: ["combined-source-b"],
      },
      {
        id: "destination-c",
        kind: "text-only",
        originalField: "text_only_parts",
        isTextOnly: true,
        title: "Destination C",
        sectionHeading: "Destination C",
        text: "Text C.",
        linkedAssets: [],
        atomicBeatIds: ["destination-c"],
      },
    ];
    const graph = {
      schemaVersion: "storyvr-source-graph/v1",
      story: { slug: "card-variant-combine-fixture", title: "Card Variant Combine Fixture" },
      atomicBeats: structuredClone(beats),
      beats: structuredClone(beats),
      entities: [],
      assetInventory: [],
      textVisualEvidenceLinks: [],
    };

    const placement = placeSourceGraphBeatAsVariant(graph, {
      sourceBeatId: "option-a",
      targetBeatId: "destination-c",
    });
    const group = graph.variantGroups[0];
    const targetOptionId = placement.variantOptionId;
    const originalOptionIds = group.options.map((option) => option.id);
    const originalDefaultOptionId = group.defaultOptionId;
    const combination = combineSourceGraphCards(graph, {
      source: { cardKind: "beat", beatId: "combined-source-b" },
      target: {
        cardKind: "variant",
        beatId: "destination-c",
        variantGroupId: group.id,
        variantOptionId: targetOptionId,
      },
      placement: "down",
    });

    assert.equal(combination.changed, true);
    assert.deepEqual(graph.beats.map((beat) => beat.id), ["destination-c"]);
    const saved = await saveStoryGraph({ storyFolder }, graph);
    const savedAgain = await saveStoryGraph({ storyFolder }, structuredClone(saved));

    for (const value of [saved, savedAgain]) {
      assert.deepEqual(value.beats.map((beat) => beat.id), ["destination-c"]);
      assert.deepEqual(value.atomicBeats.map((beat) => beat.id), [
        "option-a",
        "combined-source-b",
        "destination-c",
      ]);
      assert.equal(value.variantGroups[0].defaultOptionId, originalDefaultOptionId);
      assert.deepEqual(value.variantGroups[0].options.map((option) => option.id), originalOptionIds);
      const combinedOption = value.variantGroups[0].options.find((option) => option.id === targetOptionId);
      assert.equal(combinedOption.sourceBeatId, "option-a");
      assert.equal(combinedOption.text, "Text A.\n\nText B.");
      assert.deepEqual(combinedOption.atomicBeatIds, ["option-a", "combined-source-b"]);
      assert.deepEqual(combinedOption.sourceBeatIds, ["option-a", "combined-source-b"]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fetched image groups become linked image assets without caption or heading beats", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-image-text-"));
  try {
    const storyFolder = path.join(root, "mars-fixture");
    const resourceFolder = path.join(storyFolder, "captures", "active");
    const metadataFolder = path.join(resourceFolder, "metadata");
    const textureFolder = path.join(resourceFolder, "textures");
    await mkdir(metadataFolder, { recursive: true });
    await mkdir(textureFolder, { recursive: true });

    const imageUrl = "https://static01.nyt.com/images/2026/07/07/science/mars-surface.jpg";
    const imagePath = path.join(textureFolder, "mars-surface.jpg");
    const storyStructure = {
      story_url: "https://www.nytimes.com/interactive/2026/07/07/science/mars.html",
      title: "Mars Fixture",
      headings: [
        { text: "A Section About Mars Images", domOrder: 1 },
      ],
      text_only_parts: [
        {
          id: "body-1",
          category: "text_only_part",
          subtype: "body",
          text: "The first nearby prose paragraph introduces the Mars image.",
          title: "The first nearby prose paragraph introduces the Mars image.",
          domOrder: 10,
        },
        {
          id: "body-2",
          category: "text_only_part",
          subtype: "body",
          text: "A later paragraph should not receive the preceding image by default.",
          title: "A later paragraph should not receive the preceding image by default.",
          domOrder: 30,
        },
      ],
      captions: [
        { text: "This caption should not become a standalone beat.", domOrder: 21 },
      ],
      image_groups: [
        {
          id: "image-group-1",
          domOrder: 20,
          image: { url: imageUrl, srcset: [imageUrl] },
          caption: { text: "A Mars surface image from the source story." },
          credits: [{ text: "NASA/JPL" }],
        },
      ],
      scroll_steps: [],
      slides: [],
      downloaded_text_matches: [],
      json_candidates: [],
    };
    const manifest = [
      {
        story_url: storyStructure.story_url,
        asset_url: imageUrl,
        final_url: imageUrl,
        local_path: imagePath,
        asset_type: "texture",
        adaptation_relevance: "core_story",
        file_size: 2048,
        source_image_group_id: "image-group-1",
        image_group_dom_order: 20,
        caption: "A Mars surface image from the source story.",
        credits: ["NASA/JPL"],
      },
    ];

    await writeFile(path.join(metadataFolder, "story_structure_candidates.json"), `${JSON.stringify(storyStructure, null, 2)}\n`, "utf8");
    await writeFile(path.join(metadataFolder, "asset_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(path.join(metadataFolder, "source_discovery.json"), `${JSON.stringify({ slug: "mars-fixture", story_url: storyStructure.story_url, title: storyStructure.title }, null, 2)}\n`, "utf8");

    const project = await loadAuthorProject({ storyFolder });
    const graph = project.graph;
    const beatKinds = graph.atomicBeats.map((beat) => beat.kind);
    const firstBeat = graph.atomicBeats[0];
    const imageAsset = graph.assetInventory.find((asset) => asset.sourceImageGroupId === "image-group-1");

    assert.deepEqual(beatKinds, ["text-only", "text-only"]);
    assert.ok(imageAsset);
    assert.equal(firstBeat.title, "A Section About Mars Images");
    assert.equal(firstBeat.sectionHeading, "A Section About Mars Images");
    assert.equal(firstBeat.isTextOnly, false);
    assert.equal(firstBeat.sourceImageLinked, true);
    assert.deepEqual(firstBeat.linkedAssets.map((asset) => asset.id), [imageAsset.id]);
    assert.equal(imageAsset.caption, "A Mars surface image from the source story.");
    assert.deepEqual(imageAsset.credits, ["NASA/JPL"]);
    assert.deepEqual(graph.textVisualEvidenceLinks.find((link) => link.beatId === firstBeat.id).assetLinks, [imageAsset.id]);
    assert.equal(graph.atomicBeats.some((beat) => beat.kind === "caption" || beat.kind === "heading"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("beat titles fall back to story title when no heading is available", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-text-title-"));
  try {
    const storyFolder = path.join(root, "mars-fixture");
    const resourceFolder = path.join(storyFolder, "captures", "active");
    const metadataFolder = path.join(resourceFolder, "metadata");
    await mkdir(metadataFolder, { recursive: true });

    const storyStructure = {
      story_url: "https://www.nytimes.com/interactive/2026/07/07/science/mars.html",
      title: "Explore NASA's InSight Mission on Mars",
      headings: [],
      text_only_parts: [
        {
          id: "body-1",
          category: "text_only_part",
          subtype: "body",
          text: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the planet.",
          title: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the planet.",
          domOrder: 10,
        },
      ],
      scroll_steps: [],
      slides: [
        {
          id: "slide-1",
          category: "slide",
          text: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          title: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          domOrder: 20,
        },
      ],
      downloaded_text_matches: [],
      json_candidates: [],
    };

    await writeFile(path.join(metadataFolder, "story_structure_candidates.json"), `${JSON.stringify(storyStructure, null, 2)}\n`, "utf8");
    await writeFile(path.join(metadataFolder, "asset_manifest.json"), "[]\n", "utf8");
    await writeFile(path.join(metadataFolder, "source_discovery.json"), `${JSON.stringify({ slug: "mars-fixture", story_url: storyStructure.story_url, title: storyStructure.title }, null, 2)}\n`, "utf8");

    const project = await loadAuthorProject({ storyFolder });
    const beat = project.graph.atomicBeats.find((item) => item.id === "body-1");
    const slide = project.graph.atomicBeats.find((item) => item.id === "slide-1");

    assert.equal(beat.title, "Explore NASA's InSight Mission on Mars");
    assert.equal(beat.text, "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the planet.");
    assert.equal(beat.sectionHeading || "", "");
    assert.equal(slide.title, "Explore NASA's InSight Mission on Mars");
    assert.equal(slide.text, "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.");
    assert.equal(slide.sectionHeading || "", "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saved beat titles migrate to section headings on load", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-title-migration-"));
  try {
    const storyFolder = path.join(root, "mars-fixture");
    const resourceFolder = path.join(storyFolder, "captures", "active");
    const metadataFolder = path.join(resourceFolder, "metadata");
    const analysisFolder = path.join(storyFolder, "analysis", "storyvr");
    await mkdir(metadataFolder, { recursive: true });
    await mkdir(analysisFolder, { recursive: true });

    const storyStructure = {
      story_url: "https://www.nytimes.com/interactive/2026/07/07/science/mars.html",
      title: "Explore NASA's InSight Mission on Mars",
      headings: [{ text: "The InSight Lander", domOrder: 1 }],
      text_only_parts: [
        {
          id: "body-1",
          category: "text_only_part",
          subtype: "body",
          text: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the planet.",
          title: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the planet.",
          domOrder: 10,
        },
      ],
      slides: [
        {
          id: "slide-1",
          category: "slide",
          text: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          title: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          domOrder: 20,
        },
      ],
      scroll_steps: [],
      downloaded_text_matches: [],
      json_candidates: [],
    };
    const savedGraph = {
      schemaVersion: "storyvr-source-graph/v1",
      story: {
        slug: "mars-fixture",
        title: storyStructure.title,
        sourceUrl: storyStructure.story_url,
      },
      atomicBeats: [
        {
          id: "body-1",
          kind: "text-only",
          originalField: "text_only_parts",
          isTextOnly: true,
          title: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the plan",
          text: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the planet.",
          sectionHeading: "The InSight Lander",
          linkedAssets: [],
          atomicBeatIds: ["body-1"],
        },
        {
          id: "slide-1",
          kind: "slide",
          originalField: "slides",
          isTextOnly: false,
          title: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          text: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          sectionHeading: "The InSight Lander",
          linkedAssets: [],
          atomicBeatIds: ["slide-1"],
        },
      ],
      beats: [
        {
          id: "body-1",
          kind: "text-only",
          originalField: "text_only_parts",
          isTextOnly: true,
          title: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the plan",
          text: "The InSight spacecraft arrived at Mars in 2018 to listen for marsquakes and study the planet.",
          sectionHeading: "The InSight Lander",
          linkedAssets: [],
          atomicBeatIds: ["body-1"],
        },
        {
          id: "slide-1",
          kind: "slide",
          originalField: "slides",
          isTextOnly: false,
          title: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          text: "THE MARS INSIGHT LANDER is scheduled to land on Mars on Nov. 26.",
          sectionHeading: "The InSight Lander",
          linkedAssets: [],
          atomicBeatIds: ["slide-1"],
        },
      ],
      assetInventory: [],
      textVisualEvidenceLinks: [],
    };

    await writeFile(path.join(metadataFolder, "story_structure_candidates.json"), `${JSON.stringify(storyStructure, null, 2)}\n`, "utf8");
    await writeFile(path.join(metadataFolder, "asset_manifest.json"), "[]\n", "utf8");
    await writeFile(path.join(metadataFolder, "source_discovery.json"), `${JSON.stringify({ slug: "mars-fixture", story_url: storyStructure.story_url, title: storyStructure.title }, null, 2)}\n`, "utf8");
    await writeFile(path.join(analysisFolder, "story-graph.json"), `${JSON.stringify(savedGraph, null, 2)}\n`, "utf8");

    const project = await loadAuthorProject({ storyFolder });

    assert.equal(project.graph.atomicBeats[0].title, "The InSight Lander");
    assert.equal(project.graph.beats[0].title, "The InSight Lander");
    assert.equal(project.graph.atomicBeats[1].title, "The InSight Lander");
    assert.equal(project.graph.beats[1].title, "The InSight Lander");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
