import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { build } from "vite";

const [readerSourceArgument, distFolderArgument, buildBase, dependencyRootArgument] = process.argv.slice(2);
if (!readerSourceArgument || !distFolderArgument || !buildBase || !dependencyRootArgument) {
  throw new Error("Usage: build-reader-dist.mjs <reader-source> <dist-folder> <build-base> <dependency-root>");
}

const readerSource = path.resolve(readerSourceArgument);
const distFolder = path.resolve(distFolderArgument);
const dependencyRoot = path.resolve(dependencyRootArgument);
const textLayoutContractVersion = "storyvr-text-layout/v1";
const textLayoutScriptMarker = `const STORYVR_TEXT_LAYOUT_CONTRACT_VERSION = "${textLayoutContractVersion}";`;
const textLayoutStylesMarker = `/* STORYVR_TEXT_LAYOUT_CONTRACT_VERSION: ${textLayoutContractVersion} */`;

function sourceHasExactMarker(source, marker) {
  return String(source || "").split(/\r?\n/).some((line) => line.trim() === marker);
}

async function requireTextLayoutContract(filePath, marker, label) {
  let source = "";
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!sourceHasExactMarker(source, marker)) {
    throw new Error(`${label} ${filePath} is missing the ${textLayoutContractVersion} layout contract.`);
  }
}

await requireTextLayoutContract(
  path.join(readerSource, "src", "main.js"),
  textLayoutScriptMarker,
  "Reader source",
);
await requireTextLayoutContract(
  path.join(readerSource, "src", "styles.css"),
  textLayoutStylesMarker,
  "Reader stylesheet",
);

const threePackageRoot = path.join(dependencyRoot, "node_modules", "three");
const aliases = existsSync(threePackageRoot)
  ? [
      {
        find: /^three$/,
        replacement: path.join(threePackageRoot, "build", "three.module.js"),
      },
      {
        find: /^three\/addons\//,
        replacement: `${path.join(threePackageRoot, "examples", "jsm")}/`,
      },
    ]
  : [];

// Vite's programmatic build API does not set NODE_ENV like the Vite CLI does.
// Force production semantics so import.meta.env.DEV branches cannot leak
// source-only /public paths into the deployed reader bundle.
process.env.NODE_ENV = "production";

await build({
  root: readerSource,
  base: buildBase,
  mode: "production",
  configFile: false,
  logLevel: process.env.STORYVR_READER_BUILD_LOG_LEVEL || "warn",
  clearScreen: false,
  resolve: {
    alias: aliases,
  },
  build: {
    outDir: distFolder,
    emptyOutDir: true,
  },
});
