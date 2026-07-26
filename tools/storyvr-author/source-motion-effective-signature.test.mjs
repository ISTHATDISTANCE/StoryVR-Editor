import assert from "node:assert/strict";
import test from "node:test";
import { sourceMotionEffectiveSignature } from "./engine.mjs";

function fixturePlayback() {
  return {
    assets: [{
      assetId: "scene.glb",
      mode: "shared-timeline",
      timeline: { timeMapping: "shared-absolute" },
      materials: [{
        id: "concentration-layer",
        recipe: "layered-texture-atlas-scalar-field",
        target: { node: "slice_target_00" },
        parameters: {
          channel: "blue",
          scalarGain: 3,
          colorRamp: [
            { at: 0, color: "#f5dc72" },
            { at: 1, color: "#c71f1f" },
          ],
        },
      }],
      bindings: [{
        operation: "material-uniform",
        target: { material: "concentration-layer", uniform: "showAmt" },
      }],
    }],
  };
}

test("source motion signature includes complete declarative material recipes", () => {
  const playback = fixturePlayback();
  const baseline = sourceMotionEffectiveSignature(null, playback);

  assert.equal(
    sourceMotionEffectiveSignature(null, structuredClone(playback)),
    baseline,
    "an unchanged material contract should have a stable signature",
  );

  const changedParameter = structuredClone(playback);
  changedParameter.assets[0].materials[0].parameters.scalarGain = 4;
  assert.notEqual(
    sourceMotionEffectiveSignature(null, changedParameter),
    baseline,
    "recipe parameter changes must invalidate source-motion dependents",
  );

  const changedTarget = structuredClone(playback);
  changedTarget.assets[0].materials[0].target.node = "slice_target_01";
  assert.notEqual(
    sourceMotionEffectiveSignature(null, changedTarget),
    baseline,
    "material target changes must invalidate source-motion dependents",
  );

  const futureRecipeField = structuredClone(playback);
  futureRecipeField.assets[0].materials[0].parameters.atlasRowOffset = 0.125;
  assert.notEqual(
    sourceMotionEffectiveSignature(null, futureRecipeField),
    baseline,
    "new declarative recipe fields should be covered without engine-specific handling",
  );
});

test("source motion signature treats an omitted material list as empty", () => {
  const withoutMaterials = fixturePlayback();
  delete withoutMaterials.assets[0].materials;
  const withEmptyMaterials = structuredClone(withoutMaterials);
  withEmptyMaterials.assets[0].materials = [];

  assert.equal(
    sourceMotionEffectiveSignature(null, withoutMaterials),
    sourceMotionEffectiveSignature(null, withEmptyMaterials),
  );
});

test("source motion normalization preserves parallel route identities and scene contexts", () => {
  const linking = {
    tracks: [{
      trackId: "route-motion",
      effective: {
        beatIds: [],
        transitions: ["white", "tiger"].map((optionId) => ({
          edgeId: `${optionId}-to-ending`,
          fromBeatId: "shark-cards",
          toBeatId: "ending",
          fromContext: { beatId: "shark-cards", variantGroupId: "sharks", variantOptionId: optionId },
          toContext: { beatId: "ending", variantGroupId: null, variantOptionId: null },
        })),
      },
    }],
  };

  const signature = JSON.parse(sourceMotionEffectiveSignature(linking));
  const transitions = signature.tracks[0].effective.transitions;
  assert.equal(transitions.length, 2);
  assert.deepEqual(transitions.map((transition) => transition.edgeId), ["white-to-ending", "tiger-to-ending"]);
  assert.deepEqual(transitions.map((transition) => transition.boundaryId), ["white-to-ending", "tiger-to-ending"]);
  assert.deepEqual(transitions.map((transition) => transition.routeId), ["white-to-ending", "tiger-to-ending"]);
  assert.deepEqual(transitions.map((transition) => transition.fromContext.variantOptionId), ["white", "tiger"]);
});
