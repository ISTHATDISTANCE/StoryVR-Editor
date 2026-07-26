import assert from "node:assert/strict";
import test from "node:test";

import { refreshSourceGraphCanonicalVariantText } from "./engine.mjs";

function canonicalRuntime() {
  return {
    variantGroups: [{
      id: "location-selector",
      beatId: "location-beat",
      defaultOptionId: "florida",
      options: [
        {
          id: "florida",
          label: "Florida",
          text: "Florida.\n\nFlorida has the highest number of shark bites in the country.",
        },
        {
          id: "hawaii",
          label: "Hawaii",
          text: "Hawaii.\n\nHawaii sees a high number of serious encounters.",
        },
        {
          id: "gulf-coast",
          label: "Gulf Coast",
          text: "Gulf Coast.\n\nThe Gulf Coast sees relatively few attacks.",
        },
      ],
    }],
  };
}

test("canonical variant text backfills label-only options without replacing authored text or links", () => {
  const graph = {
    variantGroups: [{
      id: "location-selector",
      beatId: "location-beat",
      defaultOptionId: "florida",
      control: { kind: "previous-next", wrap: false },
      options: [
        { id: "florida", label: "Florida", text: "Florida", assetIds: ["bull-shark.glb"] },
        { id: "hawaii", label: "Hawaii", text: "Author shortened this paragraph.", assetIds: ["tiger-shark.glb"] },
        { id: "gulf-coast", label: "Gulf Coast", text: "Gulf Coast. The Gulf Coast sees relatively few attacks.", assetIds: [] },
      ],
    }],
  };

  const refreshed = refreshSourceGraphCanonicalVariantText(graph, canonicalRuntime());
  const [florida, hawaii, gulfCoast] = refreshed.variantGroups[0].options;

  assert.equal(florida.text, "Florida.\n\nFlorida has the highest number of shark bites in the country.");
  assert.deepEqual(florida.assetIds, ["bull-shark.glb"]);
  assert.equal(hawaii.text, "Author shortened this paragraph.");
  assert.deepEqual(hawaii.assetIds, ["tiger-shark.glb"]);
  assert.equal(gulfCoast.text, "Gulf Coast.\n\nThe Gulf Coast sees relatively few attacks.");
  assert.equal(refreshed.variantGroups[0].defaultOptionId, "florida");
  assert.deepEqual(refreshed.variantGroups[0].control, { kind: "previous-next", wrap: false });
  assert.equal(graph.variantGroups[0].options[0].text, "Florida");
});

test("canonical variant refresh ignores unmatched groups and options", () => {
  const graph = {
    variantGroups: [{
      id: "authored-selector",
      options: [
        { id: "one", label: "One", text: "One", assetIds: ["one.glb"] },
        { id: "two", label: "Two", text: "Two", assetIds: ["two.glb"] },
      ],
    }],
  };

  assert.equal(refreshSourceGraphCanonicalVariantText(graph, canonicalRuntime()), graph);
});
