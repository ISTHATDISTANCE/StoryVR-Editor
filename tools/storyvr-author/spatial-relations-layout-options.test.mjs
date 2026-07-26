import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, server, app, styles, readme] = await Promise.all([
  readFile(new URL("./engine.mjs", import.meta.url), "utf8"),
  readFile(new URL("./server.mjs", import.meta.url), "utf8"),
  readFile(new URL("./app/src/main.js", import.meta.url), "utf8"),
  readFile(new URL("./app/src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("./README.md", import.meta.url), "utf8"),
]);

test("Spatial Relations removes generated layout options end to end", () => {
  assert.doesNotMatch(engine, /SPATIAL_LAYOUT_OPTIONS_SCHEMA_VERSION|generateSpatialRelationsLayoutOptions|layoutOptionsByScene|spatialLayoutOptionsRecord|spatialLayoutSceneInputSignature/);
  assert.doesNotMatch(server, /\/api\/spatial-relations\/layout-options|generateSpatialRelationsLayoutOptions/);
  assert.doesNotMatch(app, /Generated layouts|Generate layouts|Regenerate layouts|data-spatial-generate-layouts|data-spatial-apply-layout|spatialLayoutOptions/);
  assert.doesNotMatch(styles, /\.spatial-layout-controls|\.spatial-layout-option/);
  assert.match(readme, /does not generate alternative layout options/);
});
