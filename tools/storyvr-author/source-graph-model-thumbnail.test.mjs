import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainUrl = new URL("./app/src/main.js", import.meta.url);
const stylesUrl = new URL("./app/src/styles.css", import.meta.url);

test("Source Graph model icons render cached GLB snapshots instead of a 3D word", async () => {
  const source = await readFile(mainUrl, "utf8");
  const previewFunction = source.match(/function renderSourceGraphAssetPreview\(asset\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(previewFunction, /data-source-graph-model-thumbnail/);
  assert.match(previewFunction, /is-loading/);
  assert.doesNotMatch(previewFunction, />\s*3D\s*</);
  assert.equal((source.match(/renderSourceGraphAssetPreview\(asset\)/g) || []).length, 4);
  assert.match(source, /initializeSourceGraphModelThumbnails\(active\)/);
  assert.match(source, /active\?\.id === "source-graph"/);
  assert.match(source, /active\?\.id === ATTENTION_GUIDANCE_COMPONENT_ID && !activeAttentionSceneContext\(\)/);
});

test("thumbnail capture is lazy, deduplicated, compressed-model capable, and non-rerendering", async () => {
  const source = await readFile(mainUrl, "utf8");
  const thumbnailFlow = source.match(/function initializeSourceGraphModelThumbnails\(active\) \{[\s\S]*?\nfunction renderAssetCaptionCredits/)?.[0] || "";

  assert.match(source, /sourceGraphModelThumbnailCache = new Map\(\)/);
  assert.match(source, /sourceGraphModelThumbnailPending = new Map\(\)/);
  assert.match(source, /sourceGraphModelThumbnailQueue/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /createEnvironmentGltfLoader\(renderer\)/);
  assert.match(source, /preserveDrawingBuffer: true/);
  assert.match(source, /fitSourceGraphModelThumbnailCamera\(bounds\)/);
  assert.match(source, /new THREE\.OrthographicCamera/);
  assert.match(source, /applyMatrix4\(camera\.matrixWorldInverse\)/);
  assert.match(source, /fitSourceGraphModelThumbnailCanvas\(canvas\)/);
  assert.match(source, /getImageData\(0, 0, sourceCanvas\.width, sourceCanvas\.height\)/);
  assert.match(source, /availableWidth \/ cropWidth/);
  assert.match(source, /fittedCanvas\.toBlob\([^]*"image\/webp"/);
  assert.match(source, /image\.draggable = false/);
  assert.doesNotMatch(thumbnailFlow, /render(?:PreservingScroll)?\(\)/);
});

test("Source Graph thumbnail styling contains the full model silhouette without a library folder background", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const libraryIconRule = styles.match(/\.source-graph-asset-icon-card \.asset-icon \{\s*display: grid;[\s\S]*?\n\}/)?.[0] || "";
  const libraryImageRule = styles.match(/\.source-graph-asset-icon-card img \{\s*object-fit: cover;[\s\S]*?\n\}/)?.[0] || "";

  assert.match(styles, /\.source-graph-model-thumbnail/);
  assert.match(styles, /\.source-graph-model-thumbnail-image/);
  assert.match(styles, /object-fit:\s*contain/);
  assert.match(styles, /\.source-graph-model-thumbnail\.is-unavailable/);
  assert.match(libraryIconRule, /background:\s*transparent/);
  assert.match(libraryIconRule, /box-shadow:\s*none/);
  assert.doesNotMatch(libraryIconRule, /linear-gradient/);
  assert.match(libraryImageRule, /border:\s*0/);
  assert.match(libraryImageRule, /background:\s*transparent/);
  assert.match(libraryImageRule, /box-shadow:\s*none/);
  assert.match(styles, /\.source-graph-asset-icon-card img\.source-graph-model-thumbnail-image \{\s*padding:\s*0;/);
  assert.match(styles, /\.source-graph-beat-asset \.asset-icon\.source-graph-model-thumbnail \{\s*background:\s*transparent;/);
  assert.match(styles, /\.source-graph-beat-asset img\.source-graph-model-thumbnail-image \{\s*padding:\s*0;/);
  assert.match(styles, /\.source-graph-model-thumbnail\.is-ready::before/);
  assert.doesNotMatch(styles, /\.source-graph-model-thumbnail::before\s*\{/);
});
