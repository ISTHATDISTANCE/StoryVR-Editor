import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureReaderApp } from "./engine.mjs";

const templateMainPath = new URL("./reader-template/src/main.js", import.meta.url);

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function withStory(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-reader-template-sync-"));
  const storyFolder = path.join(root, "classroom");
  await mkdir(storyFolder, { recursive: true });
  try {
    return await run({
      storyFolder,
      paths: { storyFolder },
      runtime: { slug: "classroom", title: "Classroom" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("managed reader templates refresh only while their recorded hash is unchanged", async () => {
  await withStory(async ({ storyFolder, paths, runtime }) => {
    const first = await ensureReaderApp(paths, runtime);
    assert.ok(first.provenance.createdFiles.includes("src/main.js"));

    const readerMainPath = path.join(storyFolder, "webxr-adaptation", "src", "main.js");
    const manifestPath = path.join(storyFolder, "webxr-adaptation", ".storyvr-reader-template.json");
    const managedSource = await readFile(readerMainPath, "utf8");
    const previousManagedSource = managedSource.replace(
      "const SOURCE_FOCUS_DYNAMIC_REFRESH_MS = 100;",
      "const SOURCE_FOCUS_DYNAMIC_REFRESH_MS = 99;",
    );
    assert.notEqual(previousManagedSource, managedSource);
    const priorManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    priorManifest.files["src/main.js"].managedHash = hash(previousManagedSource);
    await writeFile(manifestPath, `${JSON.stringify(priorManifest, null, 2)}\n`, "utf8");
    await writeFile(readerMainPath, previousManagedSource, "utf8");

    const refreshed = await ensureReaderApp(paths, runtime);
    assert.equal(await readFile(readerMainPath, "utf8"), managedSource);
    assert.ok(refreshed.provenance.updatedFiles.includes("src/main.js"));

    const customSource = `${managedSource}\n// Local story-specific reader customization.\n`;
    await writeFile(readerMainPath, customSource, "utf8");

    const second = await ensureReaderApp(paths, runtime);
    assert.equal(await readFile(readerMainPath, "utf8"), customSource, "customized managed source is preserved");
    assert.ok(second.provenance.preservedCustomFiles.includes("src/main.js"));
    assert.ok(second.diagnostics.some((item) => item.code === "READER_TEMPLATE_CUSTOM_SOURCE_PRESERVED"));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const pendingPath = path.join(storyFolder, "webxr-adaptation", manifest.files["src/main.js"].updatePath);
    assert.equal(await readFile(pendingPath, "utf8"), managedSource);
  });
});

test("a strongly fingerprinted legacy StoryVR reader is backed up before one-time adoption", async () => {
  await withStory(async ({ storyFolder, paths, runtime }) => {
    const templateSource = await readFile(templateMainPath, "utf8");
    const legacySource = templateSource.replace(
      /const readerPublicBaseUrl = import\.meta\.env\?\.DEV\n\s*\?[^\n]+\n\s*:[^\n]+;/,
      'const readerPublicBaseUrl = import.meta.env?.BASE_URL || new URL(/* @vite-ignore */ "../public/", import.meta.url).href;',
    );
    assert.notEqual(legacySource, templateSource, "fixture represents an older generated reader");
    const readerMainPath = path.join(storyFolder, "webxr-adaptation", "src", "main.js");
    await mkdir(path.dirname(readerMainPath), { recursive: true });
    await writeFile(readerMainPath, legacySource, "utf8");

    const result = await ensureReaderApp(paths, runtime);
    assert.ok(result.provenance.adoptedLegacyFiles.includes("src/main.js"));
    assert.equal(await readFile(readerMainPath, "utf8"), templateSource);
    const backupPath = path.join(
      storyFolder,
      "webxr-adaptation",
      ".storyvr-template-backups",
      hash(legacySource).slice(0, 12),
      "src",
      "main.js",
    );
    assert.equal(await readFile(backupPath, "utf8"), legacySource);
  });
});

test("unrecognized or explicitly opted-out legacy reader source is never overwritten", async () => {
  await withStory(async ({ storyFolder, paths, runtime }) => {
    const templateSource = await readFile(templateMainPath, "utf8");
    const customSource = `${templateSource}\n// @storyvr-custom-reader\n`;
    const readerMainPath = path.join(storyFolder, "webxr-adaptation", "src", "main.js");
    await mkdir(path.dirname(readerMainPath), { recursive: true });
    await writeFile(readerMainPath, customSource, "utf8");

    const result = await ensureReaderApp(paths, runtime);
    assert.equal(await readFile(readerMainPath, "utf8"), customSource);
    assert.ok(result.provenance.preservedCustomFiles.includes("src/main.js"));
    assert.equal(result.provenance.adoptedLegacyFiles.includes("src/main.js"), false);
  });
});
