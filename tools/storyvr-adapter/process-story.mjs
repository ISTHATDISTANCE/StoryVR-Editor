#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, importFetchedStoryResources } from "./storyvr-adapter.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.resourceFolder && !args.discovery)) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const mode = args.mode === "build" ? "build" : "dev";
const fetchResult = args.resourceFolder
  ? {
      resourceFolder: path.resolve(args.resourceFolder),
      storyFolder: args.storyFolder ? path.resolve(args.storyFolder) : null,
      fetched: false,
    }
  : await fetchDiscoveryResources(args);

const runtime = await importFetchedStoryResources(fetchResult.resourceFolder, mode, {
  repoRoot: REPO_ROOT,
  storyFolder: fetchResult.storyFolder,
});

const outputPath = resolveOutputPath(args.out, fetchResult.storyFolder, fetchResult.resourceFolder, runtime.slug);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

console.log(`StoryVR single-story ${fetchResult.fetched ? "fetch+normalize" : "normalize"} complete`);
console.log(`resource=${path.relative(REPO_ROOT, fetchResult.resourceFolder)}`);
console.log(`output=${path.relative(REPO_ROOT, outputPath)}`);
console.log(`slug=${runtime.slug}`);
console.log(`contentUnits=${runtime.contentUnits.length}`);
console.log(`assets=${runtime.assets.length}`);

async function fetchDiscoveryResources(options) {
  const discoveryPath = path.resolve(options.discovery);
  const discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
  const storyUrl = options.url || discovery.story_url || "";
  const slug = safeSlug(options.slug || discovery.slug || storySlugFromUrl(storyUrl), "nyt-story").toLowerCase();
  const storyFolder = path.resolve(options.storyFolder || path.join(REPO_ROOT, slug));
  const activeFolder = path.join(storyFolder, "captures", "active");

  if ((await directoryIsNonEmpty(activeFolder)) && !options.replaceActive) {
    throw new Error(`Refusing to overwrite existing active capture. Pass --replace-active or use --resource-folder ${activeFolder}`);
  }

  const discoveryArchive = path.join(storyFolder, "discovery", path.basename(discoveryPath));
  const tempParent = path.join(storyFolder, "captures", ".storyvr-fetch");
  await rm(tempParent, { recursive: true, force: true });
  await mkdir(tempParent, { recursive: true });
  await mkdir(path.dirname(discoveryArchive), { recursive: true });
  await cp(discoveryPath, discoveryArchive);

  const downloaderArgs = [
    path.join(REPO_ROOT, "nyt-asset-downloader.mjs"),
    "--input",
    discoveryPath,
    "--out",
    tempParent,
    "--profile",
    options.profile || "adaptation",
  ];
  if (options.maxDepth) downloaderArgs.push("--max-depth", String(options.maxDepth));
  if (options.maxCandidates) downloaderArgs.push("--max-candidates", String(options.maxCandidates));
  for (const prefix of options.storyPrefixes || []) downloaderArgs.push("--story-prefix", prefix);

  const result = spawnSync(process.execPath, downloaderArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Fetch step failed: ${detail}`);
  }

  const downloadedFolder = await newestChildDirectory(tempParent);
  if (!downloadedFolder) {
    throw new Error(`Fetch step did not produce a downloaded resource folder under ${tempParent}`);
  }

  await rm(activeFolder, { recursive: true, force: true });
  await mkdir(path.dirname(activeFolder), { recursive: true });
  await cp(downloadedFolder, activeFolder, { recursive: true });
  await rm(tempParent, { recursive: true, force: true });

  return { resourceFolder: activeFolder, storyFolder, fetched: true };
}

function resolveOutputPath(outArg, storyFolder, resourceFolder, slug) {
  if (outArg) {
    const resolved = path.resolve(outArg);
    return path.extname(resolved) === ".json" ? resolved : path.join(resolved, "storyvr-runtime.json");
  }
  if (storyFolder) return path.join(storyFolder, "discovery", "storyvr-runtime.json");
  return path.join(resourceFolder, "metadata", "storyvr-runtime.json");
}

async function newestChildDirectory(parent) {
  const entries = await readdir(parent, { withFileTypes: true });
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = path.join(parent, entry.name);
        return { fullPath, mtimeMs: (await stat(fullPath)).mtimeMs };
      }),
  );
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs[0]?.fullPath || null;
}

async function directoryIsNonEmpty(dir) {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const parsed = { storyPrefixes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "--resource-folder") parsed.resourceFolder = next();
    else if (arg === "--discovery") parsed.discovery = next();
    else if (arg === "--story-folder") parsed.storyFolder = next();
    else if (arg === "--url") parsed.url = next();
    else if (arg === "--slug") parsed.slug = next();
    else if (arg === "--out") parsed.out = next();
    else if (arg === "--mode") parsed.mode = next();
    else if (arg === "--profile") parsed.profile = next();
    else if (arg === "--max-depth") parsed.maxDepth = next();
    else if (arg === "--max-candidates") parsed.maxCandidates = next();
    else if (arg === "--story-prefix") parsed.storyPrefixes.push(next());
    else if (arg === "--replace-active") parsed.replaceActive = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function storySlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "nyt-story";
    return safeSlug(last.replace(/\.[a-z0-9]+$/i, ""), "nyt-story");
  } catch {
    return "";
  }
}

function safeSlug(value, fallback = "item") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return cleaned || fallback;
}

function printHelp() {
  console.log(`Usage:
  npm run storyvr:story -- --resource-folder <story/captures/active>
  npm run storyvr:story -- --discovery <nyt_asset_discovery.json> --story-folder <story-slug-folder>

Single-story options:
  --resource-folder <dir>  Already fetched web resource folder for one story.
  --discovery <file>       Collector JSON exported by nyt-console-collector.js; runs the fetch step first.
  --story-folder <dir>     Story container for fetched output. Default with --discovery: ./<slug>.
  --replace-active         Replace <story-folder>/captures/active during fetch.
  --out <path>             Output JSON file or directory. Default: <story-folder>/discovery/storyvr-runtime.json.
  --mode dev|build         Canonical asset-root mode. Default: dev.
  --url <url>              Optional source URL override for slug/story metadata.
  --slug <slug>            Optional slug override.
  --profile <name>         Downloader profile: adaptation or archive. Default: adaptation.
  --story-prefix <url>     Downloader story asset prefix. Repeatable.
`);
}
