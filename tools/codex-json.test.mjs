import assert from "node:assert/strict";
import test from "node:test";

import { parseCodexJsonObject } from "./codex-json.mjs";

test("parses an exact JSON object", () => {
  assert.deepEqual(parseCodexJsonObject('{"actors":3}'), { actors: 3 });
});

test("parses a Markdown-fenced JSON object", () => {
  assert.deepEqual(
    parseCodexJsonObject("```json\n{\"actors\":3}\n```"),
    { actors: 3 },
  );
});

test("recovers the valid object when Codex appends an extra closing brace", () => {
  const response = JSON.stringify({
    schemaVersion: "storyvr-dynamics-scene-candidate/v3",
    scenePatch: {
      motionPlan: {
        actors: [
          {
            entityId: "glb:hammer:beat:slide-1",
            trajectory: { kind: "waypoint-loop" },
          },
          {
            entityId: "glb:nurse:beat:slide-1",
            trajectory: { kind: "waypoint-loop" },
          },
          {
            entityId: "glb:white:beat:slide-1",
            trajectory: { kind: "waypoint-loop" },
          },
        ],
      },
    },
  });

  const parsed = parseCodexJsonObject(`${response}}`);
  assert.equal(parsed.scenePatch.motionPlan.actors.length, 3);
});

test("balances braces inside strings and ignores trailing prose", () => {
  assert.deepEqual(
    parseCodexJsonObject('Result:\n{"summary":"sharks {approach} \\"front\\"","actors":3}}\nDone.'),
    {
      summary: 'sharks {approach} "front"',
      actors: 3,
    },
  );
});

test("rejects arrays and incomplete objects", () => {
  assert.throws(
    () => parseCodexJsonObject("[{\"actors\":3}]"),
    /must be a JSON object/,
  );
  assert.throws(
    () => parseCodexJsonObject('{"actors":3'),
    /did not contain a valid JSON object/,
  );
});

test("does not recover a nested object from malformed outer JSON", () => {
  assert.throws(
    () =>
      parseCodexJsonObject(
        '{"scenePatch": invalid, "fallback":{"motionPlan":{"actors":[]}}}',
      ),
    /did not contain a valid JSON object/,
  );
});
