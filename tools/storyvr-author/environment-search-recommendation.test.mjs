import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  environmentSearchRecommendationContext,
  environmentSearchRecommendationSignature,
  loadEnvironmentSearchRecommendation,
  recommendEnvironmentSearchKeywords,
} from "./engine.mjs";

function storyFixture(beatCount = 101) {
  const beats = Array.from({ length: beatCount }, (_, index) => ({
    id: `beat-${index + 1}`,
    kind: index % 2 ? "text-only" : "slide",
    title: `Beat ${index + 1}`,
    section: `Section ${Math.floor(index / 10) + 1}`,
    text: index === beatCount - 1
      ? "FINAL-BEAT-ENVIRONMENT-SENTINEL describes a quiet glass conservatory after rain."
      : `Narrative content for beat ${index + 1}.`,
  }));
  return {
    project: { story: { slug: "complete-story", title: "Complete Story" } },
    graph: { story: { slug: "complete-story", title: "Complete Story" }, beats },
  };
}

function aiResult(provider = "codex-cli") {
  return {
    query: "rainy glass conservatory interior",
    keywords: ["rainy", "glass", "conservatory", "interior"],
    suggestions: ["botanical greenhouse interior", "botanical greenhouse interior", "garden room after rain"],
    rationale: "The complete narrative repeatedly resolves inside a sheltered botanical setting.",
    evidenceBeatIds: ["beat-1", "beat-101", "not-a-real-beat"],
    engine: { provider },
  };
}

test("AI environment recommendation receives every saved story beat and caches by the full-story signature", async (t) => {
  const storyFolder = await mkdtemp(path.join(os.tmpdir(), "storyvr-environment-recommendation-"));
  t.after(() => rm(storyFolder, { recursive: true, force: true }));
  const { project, graph } = storyFixture();
  const captured = [];
  const options = {
    storyFolder,
    aiProvider: "codex",
    environmentRecommendationCodex: async (context) => {
      captured.push(context);
      return aiResult();
    },
    environmentRecommendationOpenAI: async () => {
      throw new Error("OpenAI should not run when Codex succeeds.");
    },
  };

  const context = environmentSearchRecommendationContext(project, graph);
  assert.equal(context.beats.length, 101);
  assert.deepEqual(context.beats.map((beat) => beat.id), graph.beats.map((beat) => beat.id));
  assert.match(context.beats.at(-1).text, /FINAL-BEAT-ENVIRONMENT-SENTINEL/);

  const first = await recommendEnvironmentSearchKeywords(options, { project, graph });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].beats.length, 101);
  assert.match(captured[0].beats.at(-1).text, /FINAL-BEAT-ENVIRONMENT-SENTINEL/);
  assert.equal(first.query, "rainy glass conservatory interior");
  assert.equal(first.source, "ai-story-analysis");
  assert.equal(first.beatCount, 101);
  assert.deepEqual(first.suggestions, ["botanical greenhouse interior", "garden room after rain"]);
  assert.deepEqual(first.evidenceBeatIds, ["beat-1", "beat-101"]);
  assert.equal(first.storySignature, environmentSearchRecommendationSignature(project, graph));

  const cached = await recommendEnvironmentSearchKeywords(options, { project, graph });
  assert.equal(captured.length, 1, "an unchanged complete story reuses its saved AI recommendation");
  assert.deepEqual(cached, first);
  assert.deepEqual(await loadEnvironmentSearchRecommendation(options, { project, graph }), first);

  const changedGraph = structuredClone(graph);
  changedGraph.beats.at(-1).text += " The final location is now an open-air observatory.";
  assert.notEqual(
    environmentSearchRecommendationSignature(project, changedGraph),
    environmentSearchRecommendationSignature(project, graph),
    "changing only the final beat invalidates the full-story signature",
  );
  assert.equal(await loadEnvironmentSearchRecommendation(options, { project, graph: changedGraph }), null);
  await recommendEnvironmentSearchKeywords(options, { project, graph: changedGraph });
  assert.equal(captured.length, 2, "a change in beat 101 invokes AI again");
  assert.match(captured[1].beats.at(-1).text, /open-air observatory/);
});

test("AI provider failure never writes deterministic environment keywords", async (t) => {
  const storyFolder = await mkdtemp(path.join(os.tmpdir(), "storyvr-environment-recommendation-failure-"));
  t.after(() => rm(storyFolder, { recursive: true, force: true }));
  const { project, graph } = storyFixture(3);
  const options = {
    storyFolder,
    aiProvider: "codex",
    environmentRecommendationCodex: async () => { throw new Error("Codex unavailable"); },
    environmentRecommendationOpenAI: async () => { throw new Error("OpenAI unavailable"); },
  };

  await assert.rejects(
    () => recommendEnvironmentSearchKeywords(options, { project, graph }),
    (error) => error.statusCode === 503 && /enter environment search terms manually/i.test(error.message),
  );
  const recommendationPath = path.join(storyFolder, "analysis", "storyvr", "environment-search-recommendation.json");
  await assert.rejects(access(recommendationPath), /ENOENT/);

  const openai = await recommendEnvironmentSearchKeywords({
    ...options,
    environmentRecommendationOpenAI: async () => aiResult("openai"),
  }, { project, graph });
  assert.equal(openai.engine.provider, "openai");
  assert.equal(openai.source, "ai-story-analysis");

  const malformedCodexFallback = await recommendEnvironmentSearchKeywords({
    ...options,
    environmentRecommendationCodex: async () => ({ ...aiResult(), query: "", keywords: [] }),
    environmentRecommendationOpenAI: async () => aiResult("openai"),
  }, { project, graph, force: true });
  assert.equal(malformedCodexFallback.engine.provider, "openai", "invalid Codex output falls back to the second AI provider");
});

test("Environment Enhancement has no deterministic story-keyword table or beat-count shortcut", async () => {
  const [client, server] = await Promise.all([
    readFile(new URL("./app/src/main.js", import.meta.url), "utf8"),
    readFile(new URL("./server.mjs", import.meta.url), "utf8"),
  ]);
  for (const source of [client, server]) {
    assert.doesNotMatch(source, /environmentDerivedBrief|deriveEnvironmentBrief/);
    assert.doesNotMatch(source, /furnished house interior living room bedroom/);
    assert.doesNotMatch(source, /realistic underwater ocean reef seabed/);
  }
  assert.doesNotMatch(environmentSearchRecommendationContext.toString(), /slice\s*\(/);
  assert.match(client, /environment-enhancement\/recommend-search/);
});
