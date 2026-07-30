#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, importFetchedStoryResources } from "./storyvr-adapter.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.resourceFolder) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const mode = args.mode === "build" ? "build" : "dev";
const resourceFolder = path.resolve(args.resourceFolder);
const storyFolder = args.storyFolder ? path.resolve(args.storyFolder) : null;

const runtime = await importFetchedStoryResources(resourceFolder, mode, {
  repoRoot: REPO_ROOT,
  storyFolder,
});

const outputPath = resolveOutputPath(args.out, storyFolder, resourceFolder, runtime.slug);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

console.log("StoryVR single-story normalize complete");
console.log(`resource=${path.relative(REPO_ROOT, resourceFolder)}`);
console.log(`output=${path.relative(REPO_ROOT, outputPath)}`);
console.log(`slug=${runtime.slug}`);
console.log(`contentUnits=${runtime.contentUnits.length}`);
console.log(`assets=${runtime.assets.length}`);

function resolveOutputPath(outArg, storyFolder, resourceFolder, slug) {
  if (outArg) {
    const resolved = path.resolve(outArg);
    return path.extname(resolved) === ".json" ? resolved : path.join(resolved, "storyvr-runtime.json");
  }
  if (storyFolder) return path.join(storyFolder, "discovery", "storyvr-runtime.json");
  return path.join(resourceFolder, "metadata", "storyvr-runtime.json");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "--resource-folder") parsed.resourceFolder = next();
    else if (arg === "--story-folder") parsed.storyFolder = next();
    else if (arg === "--out") parsed.out = next();
    else if (arg === "--mode") parsed.mode = next();
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  npm run storyvr:story -- --resource-folder <story/captures/active>

Single-story options:
  --resource-folder <dir>  Already fetched web resource folder for one story.
  --story-folder <dir>     Optional story container for the normalized output.
  --out <path>             Output JSON file or directory. Default: <story-folder>/discovery/storyvr-runtime.json.
  --mode dev|build         Canonical asset-root mode. Default: dev.
`);
}
