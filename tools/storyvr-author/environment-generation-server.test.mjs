import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
const generator = await readFile(new URL("./environment/generator.mjs", import.meta.url), "utf8");

test("environment generation installs a panorama and matching ground through non-serialized Codex routes", () => {
  assert.match(server, /POST \/api\/environment-enhancement\/generate/);
  assert.match(server, /readLimitedJsonBody\(req, MAX_ENVIRONMENT_GENERATION_JSON_BYTES\)/);
  assert.match(server, /decodeEnvironmentGenerationReferenceImages\(body\.referenceImages\)/);
  assert.match(server, /generateEnvironmentImageWithCodex\(\{[\s\S]*prompt,[\s\S]*referenceImages,/);
  assert.match(server, /POST \/api\/environment-enhancement\/upload/);
  assert.match(server, /environmentGenerationBusy/);
  assert.match(server, /generateMatchingGroundTextureWithCodex/);
  assert.match(server, /referenceImage: generated\.image/);
  assert.match(server, /referenceImagePath: sourcePath/);
  assert.match(server, /currentEnvironment\.revision !== baselineEnvironment\.revision/);
  assert.match(server, /environmentStore\.importGenerated/);
  assert.match(server, /beatId,\s*candidate,[\s\S]*filename: generated\.filename/);
  assert.match(server, /environmentStore\.importUpload/);
  assert.match(server, /const beatId = requireAuthoredEnvironmentBeat\(projectState, url\.searchParams\.get\("beatId"\)\)/);
  assert.match(server, /ground:\s*\{[\s\S]*filename: ground\.filename/);
  assert.match(server, /generateGround: async \(\{ sourcePath, candidate: installedCandidate \}\)/);
  assert.match(server, /serializeAuthorMutation\(async \(\) =>/);
  assert.match(
    server,
    /pathname !== "\/api\/environment-enhancement\/generate"/,
    "the long Codex call stays outside the global author mutation queue",
  );
  assert.match(
    server,
    /pathname !== "\/api\/environment-enhancement\/upload"/,
    "upload-side ground generation also stays outside the global author mutation queue",
  );
});

test("environment mutations are beat-scoped and applying reuses an assignment atomically", () => {
  assert.match(server, /POST \/api\/environment-enhancement\/apply/);
  assert.match(server, /sourceBeatId = requireAuthoredEnvironmentBeat/);
  assert.match(server, /targetBeatIds = \[\.\.\.new Set/);
  assert.match(server, /environmentStore\.applyAssignment\(\{[\s\S]*sourceBeatId,[\s\S]*targetBeatIds,[\s\S]*expectedRevision/);
  assert.match(server, /environmentStore\.selectSource\(candidate, \{ beatId \}\)/);
  assert.match(server, /environmentStore\.updateDraft\(\{[\s\S]*beatId,[\s\S]*skipped: body\.skipped/);
  assert.match(server, /defaultAssignment,[\s\S]*assignmentsByBeat,/);
  assert.match(
    server,
    /const current = await environmentStore\.getState\(\);[\s\S]*saveEnvironmentEnhancementCheckpoint\(authorOptions\(\), current\)/,
    "checkpoint save validates the complete assignment bundle instead of one active beat",
  );
});

test("Codex image generation is a no-shell read-only ephemeral CLI invocation", () => {
  assert.match(generator, /"--enable",\s*"image_generation"/);
  assert.match(generator, /"--ask-for-approval",\s*"never",\s*"exec"/);
  assert.match(generator, /"--ignore-user-config"/);
  assert.match(generator, /"--ephemeral"/);
  assert.match(generator, /"--sandbox",\s*"read-only"/);
  assert.match(generator, /referenced_image_paths:/);
  assert.match(generator, /Treat the supplied images only as visual references/);
  assert.match(generator, /Reference images must be valid PNG, JPEG, or WebP files/);
  assert.match(generator, /seamless, tileable/);
  assert.match(generator, /shell: false/);
  assert.doesNotMatch(generator, /OPENAI_API_KEY/);
});
