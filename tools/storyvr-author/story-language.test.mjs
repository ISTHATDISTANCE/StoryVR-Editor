import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  participantComponentLabel,
  participantStatusLabel,
  storyDynamicsPlaceholder,
  storyProfileId,
  storyShortName,
  storyStageInstruction,
} from "./app/src/story-language.js";

function fixture(slug, title, beatCount = 3) {
  return {
    project: { story: { slug, title } },
    graph: {
      beats: Array.from({ length: beatCount }, (_, index) => ({ id: `beat-${index + 1}` })),
    },
  };
}

test("the three current stories receive distinct, concise guidance", () => {
  const shark = fixture("shark-season-attacks-survival-tips", "Shark Season", 16);
  const classroom = fixture("reopen-schools-safety-ventilation", "Opening Windows", 40);
  const transmission = fixture("coronavirus-transmission-cough-6-feet-ar-ul", "Social Distancing", 17);

  assert.equal(storyProfileId(shark), "shark");
  assert.equal(storyProfileId(classroom), "classroom");
  assert.equal(storyProfileId(transmission), "transmission");
  assert.equal(storyShortName(shark), "Shark safety");
  assert.equal(storyShortName(classroom), "Classroom ventilation");
  assert.equal(storyShortName(transmission), "Cough droplets and distance");

  assert.match(storyStageInstruction(shark, "source-graph"), /16 shark story parts/);
  assert.match(storyStageInstruction(classroom, "source-graph"), /40 scenes.*ventilation/);
  assert.match(storyStageInstruction(transmission, "source-graph"), /17 scenes.*cough.*distance/);
});

test("story-specific movement examples never leak across stories", () => {
  const shark = fixture("shark-season-attacks-survival-tips", "Shark Season");
  const classroom = fixture("reopen-schools-safety-ventilation", "Opening Windows");
  const transmission = fixture("coronavirus-transmission-cough-6-feet-ar-ul", "Social Distancing");

  assert.match(storyDynamicsPlaceholder(shark), /sharks/i);
  assert.doesNotMatch(storyDynamicsPlaceholder(classroom), /shark/i);
  assert.match(storyDynamicsPlaceholder(classroom), /air.*windows/i);
  assert.doesNotMatch(storyDynamicsPlaceholder(transmission), /shark|classroom/i);
  assert.match(storyDynamicsPlaceholder(transmission), /no extra object movement/i);
  assert.doesNotMatch(storyDynamicsPlaceholder(transmission), /reveal|droplet/i);
  assert.match(storyStageInstruction(transmission, "dynamic-geometry"), /no extra object movement/i);
  assert.doesNotMatch(storyStageInstruction(transmission, "dynamic-geometry"), /\bmove\b/i);
  assert.doesNotMatch(storyStageInstruction(transmission, "environment-enhancement"), /dark|custom/i);
});

test("plain labels and status words replace internal workflow language", () => {
  assert.equal(participantComponentLabel("source-graph"), "Story order");
  assert.equal(participantComponentLabel("interaction-control"), "Reader actions");
  assert.equal(participantComponentLabel("transition-pacing"), "Review story");
  assert.equal(participantStatusLabel("saved"), "Complete");
  assert.equal(participantStatusLabel("stale"), "Review again");
  assert.equal(participantStatusLabel("blocked"), "Waiting");
});

test("unknown stories receive a safe generic default", () => {
  const unknown = fixture("new-story", "A New Story", 5);
  assert.equal(storyProfileId(unknown), "default");
  assert.equal(storyShortName(unknown), "A New Story");
  assert.equal(
    storyStageInstruction(unknown, "source-graph"),
    "Arrange the 5 story parts in the order readers should see them.",
  );
  assert.doesNotMatch(storyDynamicsPlaceholder(unknown), /shark|classroom|cough/i);
});

test("a different story mentioning sharks does not silently inherit the current Shark profile", () => {
  const unrelated = fixture("museum-ocean-predators", "A Museum Story About Sharks", 4);
  assert.equal(storyProfileId(unrelated), "default");
  assert.doesNotMatch(storyStageInstruction(unrelated, "source-graph"), /choice sections/i);
});

test("all eight primary instructions stay short and avoid developer language", () => {
  const stories = [
    fixture("shark-season-attacks-survival-tips", "Shark Season", 16),
    fixture("reopen-schools-safety-ventilation", "Opening Windows", 40),
    fixture("coronavirus-transmission-cough-6-feet-ar-ul", "Social Distancing", 17),
  ];
  const componentIds = [
    "source-graph",
    "spatial-relations",
    "environment-enhancement",
    "attention-guidance",
    "dynamic-geometry",
    "inter-beat-dynamics",
    "interaction-control",
    "transition-pacing",
  ];
  const developerTerms = /\b(?:GLB|checkpoint|dimension|boundary|inference|provenance|mixer)\b/i;

  for (const story of stories) {
    for (const componentId of componentIds) {
      const instruction = storyStageInstruction(story, componentId);
      assert.doesNotMatch(instruction, developerTerms);
      assert.ok(instruction.length <= 140, `${componentId} instruction is concise`);
      assert.ok(instruction.split(/[.!?]+/).filter(Boolean).length <= 2);
    }
  }
});

test("the authoring landings use the centralized story-specific guidance", async () => {
  const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
  for (const functionName of [
    "renderGraphEditor",
    "renderSpatialRelationsCanvasWorkspace",
    "renderEnvironmentEnhancementCanvasWorkspace",
    "renderAttentionGuidanceCanvasWorkspace",
    "renderDynamicGeometryCanvasWorkspace",
    "renderInterBeatDynamicsCanvasWorkspace",
    "renderInteractionControlCanvasWorkspace",
    "renderFinalReviewWorkspace",
  ]) {
    const start = source.indexOf(`function ${functionName}(`);
    const end = source.indexOf("\nfunction ", start + 1);
    assert.notEqual(start, -1, `${functionName} exists`);
    assert.match(source.slice(start, end), /storyStageInstruction\(state\.data,/);
  }
  assert.doesNotMatch(source, /Have the placed sharks swim slowly in wide clockwise loops/);
});
