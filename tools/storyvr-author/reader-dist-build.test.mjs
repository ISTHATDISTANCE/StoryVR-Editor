import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReaderDist } from "./engine.mjs";

test("the compile button API enables the production reader build", async () => {
  const serverSource = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  const engineSource = await readFile(new URL("./engine.mjs", import.meta.url), "utf8");
  assert.match(serverSource, /readerDistBuildEnabled:\s*true/);
  assert.match(engineSource, /options\.readerDistBuildEnabled === true[\s\S]*buildReaderDist\(paths, options\)/);
});

async function withWorkspace(run) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "storyvr-reader-build-"));
  const storyFolder = path.join(workspace, "classroom");
  const readerSource = path.join(storyFolder, "webxr-adaptation");
  await mkdir(path.join(readerSource, "src"), { recursive: true });
  await writeFile(path.join(readerSource, "index.html"), '<script type="module" src="/src/main.js"></script>\n', "utf8");
  await writeFile(path.join(readerSource, "src", "main.js"), 'document.body.textContent = "reader";\n', "utf8");
  try {
    return await run({ workspace, storyFolder, readerSource });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test("reader dist build writes the production story folder with the story-aware Vite base", async () => {
  await withWorkspace(async ({ workspace, storyFolder, readerSource }) => {
    let viteConfig = null;
    const result = await buildReaderDist({ storyFolder }, {
      readerBuildRepoRoot: workspace,
      readerViteBuild: async (config) => {
        viteConfig = config;
        await mkdir(config.build.outDir, { recursive: true });
        await writeFile(path.join(config.build.outDir, "index.html"), "built\n", "utf8");
      },
    });

    assert.equal(viteConfig.root, readerSource);
    assert.equal(viteConfig.base, "/classroom/dist-webxr-adaptation/");
    assert.equal(viteConfig.build.outDir, path.join(storyFolder, "dist-webxr-adaptation"));
    assert.equal(viteConfig.build.emptyOutDir, true);
    assert.equal(result.status, "built");
    assert.equal(result.distPath, "classroom/dist-webxr-adaptation");
    assert.equal(result.builtStoryInstance, false);
    assert.equal(await readFile(path.join(storyFolder, "dist-webxr-adaptation", "index.html"), "utf8"), "built\n");
  });
});

test("reader dist build completes a real Vite production build", async () => {
  await withWorkspace(async ({ workspace, storyFolder, readerSource }) => {
    await writeFile(
      path.join(readerSource, "src", "main.js"),
      'document.body.dataset.storyvrBuildMode = import.meta.env.DEV ? "development" : "production";\n',
      "utf8",
    );
    const result = await buildReaderDist({ storyFolder }, {
      readerBuildRepoRoot: workspace,
      readerBuildLogLevel: "silent",
    });

    const builtHtml = await readFile(path.join(storyFolder, "dist-webxr-adaptation", "index.html"), "utf8");
    const assetFolder = path.join(storyFolder, "dist-webxr-adaptation", "assets");
    const builtScriptName = (await readdir(assetFolder)).find((name) => name.endsWith(".js"));
    assert.ok(builtScriptName, "Vite emits the compiled reader script");
    const builtScript = await readFile(path.join(assetFolder, builtScriptName), "utf8");
    assert.equal(result.status, "built");
    assert.match(builtHtml, /\/classroom\/dist-webxr-adaptation\/assets\/index-/);
    assert.match(builtScript, /storyvrBuildMode\s*=\s*["'`]production["'`]/);
    assert.doesNotMatch(builtScript, /storyvrBuildMode\s*=\s*["'`]development["'`]/);
  });
});

test("reader dist build refreshes legacy generated story data before invoking Vite", async () => {
  await withWorkspace(async ({ workspace, storyFolder, readerSource }) => {
    const instanceBuildScript = path.join(readerSource, "tools", "build-story-instance.mjs");
    await mkdir(path.dirname(instanceBuildScript), { recursive: true });
    await writeFile(instanceBuildScript, "// test fixture\n", "utf8");
    const steps = [];

    const result = await buildReaderDist({ storyFolder }, {
      readerBuildRepoRoot: workspace,
      readerBuildStepRunner: async (command, args, options) => {
        steps.push({ kind: "data", command, args, options });
      },
      readerViteBuild: async (config) => {
        steps.push({ kind: "vite", config });
        await mkdir(config.build.outDir, { recursive: true });
        await writeFile(path.join(config.build.outDir, "index.html"), "built\n", "utf8");
      },
    });

    assert.deepEqual(steps.map((step) => step.kind), ["data", "vite"]);
    assert.equal(steps[0].command, process.execPath);
    assert.deepEqual(steps[0].args, [instanceBuildScript]);
    assert.equal(steps[0].options.cwd, workspace);
    assert.equal(result.builtStoryInstance, true);
  });
});

test("reader dist build supports StoryVR with sibling story containers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storyvr-reader-sibling-build-"));
  const repoRoot = path.join(root, "StoryVR");
  const storyFolder = path.join(root, "classroom");
  const readerSource = path.join(storyFolder, "webxr-adaptation");
  await mkdir(path.join(readerSource, "src"), { recursive: true });
  await mkdir(repoRoot, { recursive: true });
  await symlink(fileURLToPath(new URL("../../node_modules", import.meta.url)), path.join(repoRoot, "node_modules"), "dir");
  await writeFile(path.join(readerSource, "index.html"), '<script type="module" src="/src/main.js"></script>\n', "utf8");
  await writeFile(
    path.join(readerSource, "src", "main.js"),
    'import * as THREE from "three"; document.body.textContent = THREE.REVISION;\n',
    "utf8",
  );
  try {
    const result = await buildReaderDist({ storyFolder }, {
      readerBuildRepoRoot: repoRoot,
      readerBuildLogLevel: "silent",
    });
    assert.equal(result.readerSourcePath, "../classroom/webxr-adaptation");
    assert.equal(result.distPath, "classroom/dist-webxr-adaptation");
    assert.match(
      await readFile(path.join(storyFolder, "dist-webxr-adaptation", "index.html"), "utf8"),
      /\/classroom\/dist-webxr-adaptation\/assets\/index-/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
