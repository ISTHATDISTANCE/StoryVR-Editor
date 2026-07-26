#!/usr/bin/env node
import path from "node:path";
import { REPO_ROOT, migrateStories } from "./storyvr-adapter.mjs";

const args = parseArgs(process.argv.slice(2));
const mode = args.mode === "build" ? "build" : "dev";
const outRoot = path.resolve(REPO_ROOT, args.out || "tools/storyvr-adapter/out");

const report = await migrateStories({
  repoRoot: REPO_ROOT,
  mode,
  outRoot,
  scanOnly: Boolean(args.scanOnly),
  includeExcluded: Boolean(args.includeExcluded),
  generateMissing: Boolean(args.generateMissing),
  writeScanReport: Boolean(args.writeReport),
});

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report, outRoot);
}

if (report.counts.rejected > 0 && args.failOnReject) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") parsed.mode = argv[++index];
    else if (arg === "--out") parsed.out = argv[++index];
    else if (arg === "--scan-only") parsed.scanOnly = true;
    else if (arg === "--include-excluded") parsed.includeExcluded = true;
    else if (arg === "--generate-missing") parsed.generateMissing = true;
    else if (arg === "--write-report") parsed.writeReport = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--fail-on-reject") parsed.failOnReject = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return parsed;
}

function printHumanReport(report, outRoot) {
  const label = report.scanOnly ? "StoryVR scan" : "StoryVR migration";
  console.log(`${label} (${report.mode})`);
  console.log(`accepted=${report.counts.accepted} migrated=${report.counts.migrated} skipped=${report.counts.skipped} rejected=${report.counts.rejected}`);
  if (!report.scanOnly) {
    console.log(`output=${path.relative(REPO_ROOT, outRoot)}`);
  }

  if (report.skipped.length) {
    console.log("\nSkipped excluded stories:");
    for (const skipped of report.skipped) {
      console.log(`- ${skipped.family}/${skipped.slug}: ${skipped.reason}`);
    }
  }

  if (report.rejected.length) {
    console.log("\nRejected stories:");
    for (const rejected of report.rejected) {
      console.log(`- ${rejected.family}/${rejected.slug}: ${rejected.reason}`);
    }
  }

  if (report.migrated.length) {
    console.log("\nMigrated stories:");
    for (const story of report.migrated) {
      const output = story.outputPath ? path.relative(REPO_ROOT, story.outputPath) : "(scan only)";
      console.log(`- ${story.family}/${story.slug}: ${story.contentUnitCount} units -> ${output}`);
    }
  }
}

function printHelp() {
  console.log(`Usage: node tools/storyvr-adapter/migrate-stories.mjs [options]

Options:
  --mode dev|build       Path mode for canonical asset roots. Default: dev.
  --scan-only            Discover and report without writing runtime JSON.
  --write-report         Write migration-report.json even in scan-only mode.
  --generate-missing     Run a story's build-story-instance.mjs if no supported source exists.
  --include-excluded     Include virtual-walk and sports stories for debugging.
  --fail-on-reject       Exit nonzero if any accepted story cannot be normalized.
  --out <path>           Output root. Default: tools/storyvr-adapter/out.
  --json                 Print the full structured report.
`);
}
