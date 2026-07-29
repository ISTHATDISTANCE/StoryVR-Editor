import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateStoryCanvasSegments,
  generateStoryCanvasSegmentsWithCodex,
  storyCanvasSegmentsGenerationContext,
} from "./engine.mjs";
import {
  STORY_CANVAS_SEGMENTS_SCHEMA_VERSION,
  storyCanvasSegmentGenerationSignature,
  storyCanvasSegmentGraphSignature,
} from "./story-canvas-segments.mjs";

function fixtureGraph({ beatCount = 4, revision = "", edges = null } = {}) {
  const beats = Array.from({ length: beatCount }, (_, index) => ({
    id: `beat-${index + 1}`,
    atomicBeatIds: [`beat-${index + 1}`],
    kind: "text-only",
    title: `Beat ${index + 1}`,
    text: `Narrative evidence ${index + 1}${revision ? ` ${revision}` : ""}.`,
  }));
  return {
    schemaVersion: "storyvr-source-graph/v1",
    story: {
      slug: "generation-test-story",
      title: "Generation Test Story",
    },
    atomicBeats: structuredClone(beats),
    beats,
    ...(edges ? { edges: structuredClone(edges) } : {}),
  };
}

function validModelOutput(graph, { extraSegmentFields = false, splitAt = null } = {}) {
  const beatIds = graph.beats.map((beat) => beat.id);
  const boundary = splitAt ?? Math.max(1, Math.floor(beatIds.length / 2));
  const extra = extraSegmentFields
    ? { confidence: 0.91, explanation: "This field must not be persisted." }
    : {};
  return {
    segments: [
      {
        id: "opening",
        label: "Opening",
        beatIds: beatIds.slice(0, boundary),
        ...extra,
      },
      {
        id: "resolution",
        label: "Resolution",
        beatIds: beatIds.slice(boundary),
        ...extra,
      },
    ],
    ignoredTopLevelField: "The engine owns the persisted artifact shape.",
    engine: { provider: "injected-test-generator" },
  };
}

function transition(fromBeatId, toBeatId, id = `${fromBeatId}-to-${toBeatId}`) {
  return {
    id,
    kind: "transition",
    from: { cardKind: "beat", beatId: fromBeatId, side: "right" },
    to: { cardKind: "beat", beatId: toBeatId, side: "left" },
  };
}

async function createHarness(t, graph = fixtureGraph()) {
  const storyFolder = await mkdtemp(path.join(os.tmpdir(), "storyvr-canvas-generation-"));
  t.after(() => rm(storyFolder, { recursive: true, force: true }));
  const analysisRoot = path.join(storyFolder, "analysis", "storyvr");
  const graphPath = path.join(analysisRoot, "story-graph.json");
  const segmentsPath = path.join(analysisRoot, "story-canvas-segments.json");
  await mkdir(analysisRoot, { recursive: true });
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  return {
    storyFolder,
    graphPath,
    segmentsPath,
    options: { storyFolder },
  };
}

async function readStoredJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeGraph(filePath, graph) {
  await writeFile(filePath, `${JSON.stringify(graph, null, 2)}\n`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function writeFakeCodexExecutable(filePath, modelOutput) {
  const event = {
    type: "item.completed",
    item: {
      type: "agent_message",
      text: JSON.stringify(modelOutput),
    },
  };
  await writeFile(filePath, [
    "#!/usr/bin/env node",
    "process.stdin.resume();",
    `const event = ${JSON.stringify(event)};`,
    "process.stdin.on(\"end\", () => {",
    "  process.stdout.write(`${JSON.stringify(event)}\\n`);",
    "});",
    "",
  ].join("\n"));
  await chmod(filePath, 0o755);
}

test("initial generation receives the complete saved story and persists a validated artifact", async (t) => {
  const graph = fixtureGraph({
    edges: [
      transition("beat-1", "beat-2"),
      transition("beat-2", "beat-3"),
      transition("beat-3", "beat-4"),
    ],
  });
  const harness = await createHarness(t, graph);
  const contexts = [];

  const result = await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async (context) => {
      contexts.push(context);
      return validModelOutput(graph);
    },
  });

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].mode, "initial-generation");
  assert.equal(contexts[0].previousGrouping, null);
  assert.deepEqual(contexts[0].beats.map((beat) => beat.id), graph.beats.map((beat) => beat.id));
  assert.equal(contexts[0].flow.mode, "explicit");
  assert.equal(contexts[0].flow.edges.length, 3);
  assert.equal(result.status, "current");
  assert.equal(result.generationStatus, "current");
  assert.equal(result.provenance.source, "codex-generated");
  assert.equal(result.provenance.mode, "initial-generation");

  const stored = await readStoredJson(harness.segmentsPath);
  assert.equal(stored.schemaVersion, STORY_CANVAS_SEGMENTS_SCHEMA_VERSION);
  assert.equal(stored.graphSignature, result.graphSignature);
  assert.equal(stored.generationSignature, contexts[0].generationSignature);
  assert.equal(stored.generationSignature, result.generationSignature);
  assert.deepEqual(stored.segments, validModelOutput(graph).segments);
});

test("the Codex stream handler accepts ordinary stdout without crashing the author server", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  const fakeCodexPath = path.join(harness.storyFolder, "fake-codex.mjs");
  await writeFakeCodexExecutable(fakeCodexPath, validModelOutput(graph));

  const result = await generateStoryCanvasSegmentsWithCodex(
    storyCanvasSegmentsGenerationContext(graph),
    {
      codexBin: fakeCodexPath,
      storyCanvasSegmentsCodexWorkspace: harness.storyFolder,
      storyCanvasSegmentsCodexTimeoutMs: 5_000,
    },
  );

  assert.deepEqual(result.segments, validModelOutput(graph).segments);
  assert.equal(result.engine.provider, "codex-cli");
});

test("a current saved generation is reused without invoking the generator", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  let generatorCalls = 0;
  const options = {
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => {
      generatorCalls += 1;
      return validModelOutput(graph);
    },
  };

  const first = await generateStoryCanvasSegments(options);
  const second = await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => {
      throw new Error("A current generation must be served from the saved cache.");
    },
  });

  assert.equal(generatorCalls, 1);
  assert.deepEqual(second.segments, first.segments);
  assert.equal(second.generationSignature, first.generationSignature);
});

test("a saved content and flow change supplies the previous grouping as incremental context", async (t) => {
  const originalGraph = fixtureGraph({
    edges: [
      transition("beat-1", "beat-2"),
      transition("beat-2", "beat-3"),
      transition("beat-3", "beat-4"),
    ],
  });
  const harness = await createHarness(t, originalGraph);
  await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => validModelOutput(originalGraph),
  });

  const changedGraph = fixtureGraph({
    edges: [
      transition("beat-1", "beat-3"),
      transition("beat-3", "beat-2"),
      transition("beat-2", "beat-4"),
    ],
  });
  changedGraph.beats[1].text += " A newly saved turning point changes its narrative role.";
  changedGraph.atomicBeats[1].text = changedGraph.beats[1].text;
  await writeGraph(harness.graphPath, changedGraph);
  let incrementalContext;
  const result = await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async (context) => {
      incrementalContext = context;
      return validModelOutput(changedGraph, { splitAt: 1 });
    },
  });

  assert.ok(incrementalContext);
  assert.equal(incrementalContext.mode, "incremental-update");
  assert.equal(
    incrementalContext.generationSignature,
    result.generationSignature,
  );
  assert.deepEqual(
    incrementalContext.previousGrouping.segments.map(({ id, label, beatIds }) => ({
      id,
      label,
      beatIds,
    })),
    validModelOutput(originalGraph).segments,
  );
  assert.deepEqual(
    incrementalContext.beats.map((beat) => beat.id),
    changedGraph.beats.map((beat) => beat.id),
    "incremental context keeps a compact complete ordered outline",
  );
  assert.match(
    incrementalContext.changedBeats.find((beat) => beat.id === "beat-2")?.text,
    /newly saved turning point/,
  );
  assert.equal(incrementalContext.flow.mode, "explicit");
  assert.ok(incrementalContext.flow.edges.some((edge) => (
    edge.from.beatId === "beat-1" && edge.to.beatId === "beat-3"
  )));
  assert.deepEqual(incrementalContext.changeSummary.addedBeatIds, []);
  assert.deepEqual(incrementalContext.changeSummary.removedBeatIds, []);
  assert.deepEqual(incrementalContext.changeSummary.movedBeatIds, []);
  assert.ok(incrementalContext.changeSummary.changedBeatIds.includes("beat-2"));
  assert.equal(incrementalContext.changeSummary.orderChanged, false);
  assert.equal(incrementalContext.changeSummary.flowChanged, true);
  assert.equal(result.provenance.mode, "incremental-update");
  assert.equal(result.generationStatus, "current");
  assert.deepEqual(result.segments.map((segment) => segment.beatCount), [1, 3]);
});

test("same-signature automatic and forced requests share one in-flight generator", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  const generatorStarted = deferred();
  const generatorResult = deferred();
  let generatorCalls = 0;
  let generationContext;
  const options = {
    ...harness.options,
    storyCanvasSegmentsGenerator: async (context) => {
      generatorCalls += 1;
      generationContext = context;
      generatorStarted.resolve();
      return generatorResult.promise;
    },
  };

  const automaticRequest = generateStoryCanvasSegments(options);
  await generatorStarted.promise;
  const forcedRequest = generateStoryCanvasSegments(options, { force: true });
  generatorResult.resolve(validModelOutput(graph));
  const [automatic, forced] = await Promise.all([automaticRequest, forcedRequest]);

  assert.equal(generatorCalls, 1);
  assert.deepEqual(forced.segments, automatic.segments);
  const stored = await readStoredJson(harness.segmentsPath);
  assert.equal(stored.schemaVersion, STORY_CANVAS_SEGMENTS_SCHEMA_VERSION);
  assert.equal(stored.graphSignature, automatic.graphSignature);
  assert.equal(stored.generationSignature, automatic.generationSignature);
  assert.deepEqual(stored.inputSummary, generationContext.inputSummary);
  assert.deepEqual(stored.provenance, automatic.provenance);
  assert.deepEqual(stored.segments, validModelOutput(graph).segments);
});

test("invalid model output is rejected without altering the current saved grouping", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => validModelOutput(graph),
  });
  const before = await readFile(harness.segmentsPath, "utf8");

  await assert.rejects(
    () => generateStoryCanvasSegments({
      ...harness.options,
      storyCanvasSegmentsGenerator: async () => ({
        segments: [
          { id: "broken", label: "Broken", beatIds: ["beat-1", "beat-3"] },
        ],
      }),
    }, { force: true }),
    (error) => (
      error.statusCode === 502
      && /do not match the saved Source Graph/i.test(error.message)
      && error.diagnostics.some((diagnostic) => /at least two/i.test(diagnostic))
    ),
  );

  assert.equal(await readFile(harness.segmentsPath, "utf8"), before);
});

test("an eight-section model response is rejected without overwriting the prior file", async (t) => {
  const graph = fixtureGraph({ beatCount: 8 });
  const harness = await createHarness(t, graph);
  await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => validModelOutput(graph),
  });
  const before = await readFile(harness.segmentsPath, "utf8");

  await assert.rejects(
    () => generateStoryCanvasSegments({
      ...harness.options,
      storyCanvasSegmentsGenerator: async () => ({
        segments: graph.beats.map((beat, index) => ({
          id: `section-${index + 1}`,
          label: `Section ${index + 1}`,
          beatIds: [beat.id],
        })),
      }),
    }, { force: true }),
    (error) => (
      error.statusCode === 502
      && error.diagnostics.some((diagnostic) => /at most seven/i.test(diagnostic))
    ),
  );

  assert.equal(await readFile(harness.segmentsPath, "utf8"), before);
});

test("generator failure is reported without altering the current saved grouping", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => validModelOutput(graph),
  });
  const before = await readFile(harness.segmentsPath, "utf8");

  await assert.rejects(
    () => generateStoryCanvasSegments({
      ...harness.options,
      storyCanvasSegmentsGenerator: async () => {
        throw new Error("Injected provider outage");
      },
    }, { force: true }),
    (error) => (
      error.statusCode === 502
      && /could not create valid story progress/i.test(error.message)
      && !/Injected provider outage/.test(error.message)
    ),
  );

  assert.equal(await readFile(harness.segmentsPath, "utf8"), before);
});

test("model-only segment fields are removed before the generated artifact is persisted", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => validModelOutput(graph, {
      extraSegmentFields: true,
    }),
  });

  const stored = await readStoredJson(harness.segmentsPath);
  assert.deepEqual(stored.segments, validModelOutput(graph).segments);
  assert.equal(Object.hasOwn(stored, "ignoredTopLevelField"), false);
});

test("a multi-beat legacy one-section grouping is regenerated instead of baselined", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  await writeFile(harness.segmentsPath, `${JSON.stringify({
    schemaVersion: STORY_CANVAS_SEGMENTS_SCHEMA_VERSION,
    graphSignature: storyCanvasSegmentGraphSignature(graph),
    provenance: { source: "legacy-test-fixture" },
    segments: [
      {
        id: "whole-story",
        label: "Whole story",
        beatIds: graph.beats.map((beat) => beat.id),
      },
    ],
  }, null, 2)}\n`);
  let generatorCalls = 0;

  const result = await generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async (context) => {
      generatorCalls += 1;
      assert.equal(context.mode, "incremental-update");
      return validModelOutput(graph);
    },
  });

  assert.equal(generatorCalls, 1);
  assert.deepEqual(result.segments.map((segment) => segment.id), ["opening", "resolution"]);
  assert.equal(result.generationStatus, "current");
});

test("a corrupt previous grouping is surfaced and preserved instead of silently overwritten", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  const corrupt = "{ this is deliberately not valid JSON }\n";
  await writeFile(harness.segmentsPath, corrupt);
  let generatorCalls = 0;

  await assert.rejects(
    () => generateStoryCanvasSegments({
      ...harness.options,
      storyCanvasSegmentsGenerator: async () => {
        generatorCalls += 1;
        return validModelOutput(graph);
      },
    }),
    (error) => (
      Number.isInteger(error.statusCode)
      && /story progress|canvas segments|json/i.test(error.message)
    ),
  );

  assert.equal(generatorCalls, 0);
  assert.equal(await readFile(harness.segmentsPath, "utf8"), corrupt);
});

test("a graph change during generation returns 409 and discards the stale result", async (t) => {
  const graph = fixtureGraph();
  const harness = await createHarness(t, graph);
  const generatorStarted = deferred();
  const generatorResult = deferred();
  const generation = generateStoryCanvasSegments({
    ...harness.options,
    storyCanvasSegmentsGenerator: async () => {
      generatorStarted.resolve();
      return generatorResult.promise;
    },
  });

  await generatorStarted.promise;
  const changedGraph = fixtureGraph({ revision: "saved while generation was in flight" });
  await writeGraph(harness.graphPath, changedGraph);
  generatorResult.resolve(validModelOutput(graph));

  await assert.rejects(
    () => generation,
    (error) => (
      error.statusCode === 409
      && /changed while Codex was organizing/i.test(error.message)
    ),
  );
  await assert.rejects(access(harness.segmentsPath), (error) => error.code === "ENOENT");
});

test("the public generation context includes every beat without invoking Codex", () => {
  const graph = fixtureGraph({ beatCount: 25 });
  const context = storyCanvasSegmentsGenerationContext(graph);

  assert.equal(context.beats.length, graph.beats.length);
  assert.deepEqual(context.beats.map((beat) => beat.id), graph.beats.map((beat) => beat.id));
  assert.equal(context.generationSignature, storyCanvasSegmentGenerationSignature(graph));
});
