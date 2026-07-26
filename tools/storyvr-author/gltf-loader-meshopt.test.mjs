import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("every StoryVR GLTF loader supports Meshopt-compressed models", () => {
  const factory = functionSource("createGltfLoader");
  assert.match(factory, /setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.equal(
    (source.match(/new GLTFLoader\(\)/g) || []).length,
    1,
    "all author previews create GLTFLoader instances through the shared factory",
  );
});

test("the selected-model preview loads through the configured factory", () => {
  assert.match(functionSource("initializeSelectedModelViewer"), /const loader = createGltfLoader\(\)/);
});
