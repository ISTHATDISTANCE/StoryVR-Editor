import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

test("every StoryVR story-canvas arrow uses the shared reference treatment", () => {
  assert.match(styles, /--story-canvas-arrow-color:\s*rgba\(0, 127, 115, 0\.74\);/);
  assert.match(styles, /--story-canvas-arrow-stroke-width:\s*3px;/);
  assert.match(styles, /--story-canvas-arrowhead-length:\s*12px;/);
  assert.match(styles, /--story-canvas-arrowhead-half-width:\s*6px;/);

  assert.match(styles, /\.source-graph-link-layer marker path\s*\{[^}]*fill:\s*var\(--story-canvas-arrow-color\);/s);
  assert.match(styles, /\.source-graph-transition-path,[\s\S]*\.source-graph-link-draft\s*\{[^}]*stroke:\s*var\(--story-canvas-arrow-color\);[^}]*stroke-width:\s*var\(--story-canvas-arrow-stroke-width\);/s);

  for (const selector of [
    "source-graph-beat-connector",
    "transition-boundary-arrow",
    "interaction-boundary-arrow",
    "final-review-story-connector",
  ]) {
    assert.match(
      styles,
      new RegExp(`\\.${selector}::before\\s*\\{[^}]*height:\\s*var\\(--story-canvas-arrow-stroke-width\\);[^}]*background:\\s*var\\(--story-canvas-arrow-color\\);`, "s"),
    );
    assert.match(
      styles,
      new RegExp(`\\.${selector}::after\\s*\\{[^}]*border-left:\\s*var\\(--story-canvas-arrowhead-length\\) solid var\\(--story-canvas-arrow-color\\);`, "s"),
    );
  }

  assert.match(source, /markerWidth="12" markerHeight="12"/);
  assert.match(source, /<path d="M 0 0 L 12 6 L 0 12 z"><\/path>/);
  assert.match(source, /<span class="final-review-story-connector" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(styles, /\.transition-boundary-connector\.no-dynamics \.transition-boundary-arrow::before/);
  assert.doesNotMatch(styles, /\.interaction-boundary-connector\.(?:stale|unassigned) \.interaction-boundary-arrow::before/);
});
