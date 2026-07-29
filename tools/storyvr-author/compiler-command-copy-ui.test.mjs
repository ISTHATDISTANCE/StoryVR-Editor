import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./app/src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./app/src/styles.css", import.meta.url), "utf8");

assert.doesNotMatch(source, />Desktop preview<|renderRunCommand\(run\.devCommand/,
  "the redundant source-server desktop preview is not rendered");
assert.match(source, /const staticRunCommand = distBuilt \? run\.serveCommand : run\.headsetCommand/,
  "a successful one-click build leaves only the serve command for the production reader");
assert.match(source, /renderRunCommand\(staticRunCommand, staticRunLabel\)/,
  "the production reader command renders with its own copy control");
assert.match(source, /printed LAN URL on a desktop browser or headset/,
  "the production reader command states that the same served build supports desktop and headset preview");
assert.match(styles, /\.run-step-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/s,
  "the remaining production reader command expands across the available handoff width");
assert.match(source, />Build reader</,
  "the participant-facing action uses a short, direct label");
assert.match(source, /Build details for the facilitator/,
  "technical build handoff remains available in a collapsed facilitator section");
assert.match(source, /runtime\.readerBuild \|\| null/,
  "the compile result keeps the production reader build status");
assert.match(source, /data-copy-run-command[\s\S]*data-copy-run-command-label>Copy</,
  "each command field exposes an accessible Copy button");
assert.match(source, /navigator\.clipboard\?\.writeText/,
  "copy uses the Clipboard API when available");
assert.match(source, /document\.execCommand\?\.\("copy"\)/,
  "copy retains a fallback for non-secure browser contexts");
assert.match(source, /querySelectorAll\("\[data-copy-run-command\]"\)/,
  "rendered command copy controls are bound after each render");
assert.match(styles, /\.command-field\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s,
  "the copy button stays visible while long command text scrolls independently");
assert.match(styles, /\.command-field\s*\{[^}]*height:\s*3rem/s,
  "short and overflowing command fields keep the same outer height");
assert.match(styles, /\.command-line\s*\{[^}]*height:\s*100%[^}]*overflow-x:\s*auto/s,
  "the horizontal scrollbar stays inside the shared fixed-height command row");
assert.match(styles, /\.command-copy-button\.copied\s*\{/,
  "successful copy actions receive visible feedback");

console.log("compiler command copy UI checks passed");
