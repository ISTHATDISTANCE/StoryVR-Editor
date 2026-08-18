# StoryVR Editor

StoryVR Editor is the shared local authoring system for turning a prepared web
story capture into an editable StoryVR experience and a compiled WebXR reader.
This repository contains the editor, adapter, animation probe, session viewer,
reader template, and local HTTPS server. Story-specific source files and
authored output live in separate story folders beside this repository.

## Supported platforms and release branches

StoryVR supports macOS, Linux, and native Windows 11. Use the release branch
for the operating environment in which Node.js will run:

| Environment | Branch | Command shell |
| --- | --- | --- |
| macOS | `main` | zsh or bash |
| Native Linux | `codex/native-windows` | bash or another POSIX shell |
| Native Windows 11 | `codex/native-windows` | PowerShell |
| WSL2 fallback on a Windows host | `codex/native-windows` inside WSL | bash |

Native Windows is the first-choice Windows path; WSL is not required. Use WSL2
only when a managed Windows computer cannot run the native prerequisites. A WSL
installation is separate: install Git, Node, npm, Python, Codex, and
`node_modules/` inside WSL, and use Linux paths rather than `C:\...` paths.

## Prerequisites

Every platform needs:

- Git
- Node.js 24 or newer and its bundled npm
- Python 3; macOS `main` requires `python3`, the portable Linux/WSL launcher
  accepts `python3` or `python`, and native Windows additionally accepts `py -3`
- A current Chromium-based browser such as Chrome or Edge
- Optional: the [Codex CLI](https://developers.openai.com/codex/cli/) for
  AI-backed environment and motion generation
- Optional: OpenSSL and a WebXR headset for local HTTPS immersive testing

On Windows, use 64-bit Node.js and Python unless the computer is ARM64. Run the
commands in PowerShell and invoke npm as `npm.cmd`; this bypasses only the
PowerShell script shim and does not require changing the execution policy.
Keep the workspace in a short, user-owned local path such as
`$env:USERPROFILE\StoryVR`. Avoid OneDrive/network folders and deeply nested
paths. Paths containing spaces are supported when quoted.

Check the bootstrap tools on macOS:

```sh
git --version
node --version
npm --version
python3 --version
```

On native Linux or WSL2, verify Git, Node, and npm before cloning. The portable
launcher verifies whichever Python 3 command is available after `npm ci`:

```sh
git --version
node --version
npm --version
```

Check them in Windows PowerShell:

```powershell
git --version
node.exe --version
npm.cmd --version
py -3 --version
```

On native Windows, if `py -3` is unavailable but another Python 3 command is
installed, continue through `npm.cmd ci` and use the repository launcher in
**Verify the installation**. It selects a working Python 3 interpreter and can
be overridden with `STORYVR_PYTHON` when a machine has multiple installations.

## Install the dependencies

Clone the branch for the current operating environment and install exactly the
versions recorded in `package-lock.json`.

macOS:

```sh
mkdir -p "$HOME/StoryVR"
cd "$HOME/StoryVR"
git clone --branch main --single-branch \
  https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
cd StoryVR-Editor
npm ci
```

Native Linux or WSL2:

```sh
mkdir -p "$HOME/StoryVR"
cd "$HOME/StoryVR"
git clone --branch codex/native-windows --single-branch \
  https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
cd StoryVR-Editor
npm ci
```

Native Windows 11 PowerShell:

```powershell
$Workspace = Join-Path $env:USERPROFILE "StoryVR"
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
Set-Location $Workspace
git clone --branch codex/native-windows --single-branch `
  https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
Set-Location (Join-Path $Workspace "StoryVR-Editor")
npm.cmd ci
```

`node_modules/` is intentionally not stored in Git and cannot be copied between
operating systems. Run `npm ci` after a fresh clone or when the lockfile
changes. Use `npm install <package>` only when intentionally changing a
dependency and its lockfile. Do not use `sudo npm`, `--force`, or
`npm audit fix` as installation workarounds.

On the portable branch, `npm ci` also installs StoryVR's cross-platform image
runtime. Windows and Linux do not need macOS `sips`, ImageMagick, or another
manual image package.

## Prepare a workspace

Keep each story in a sibling folder, not inside this repository:

```text
workspace/
├── StoryVR-Editor/
└── my-story/
    ├── captures/active/
    ├── analysis/
    ├── discovery/
    └── webxr-adaptation/
```

The minimum input for authoring is a prepared capture at
`<story-folder>/captures/active/`. StoryVR writes its graph, decisions, generated
assets, runtime payload, and reader source back into that story folder, so it
must be writable.

## Start the editor

From the `StoryVR-Editor` directory, choose one story and start the authoring
server.

macOS, Linux, or WSL:

```sh
STORY_SLUG=my-story
npm run storyvr:author -- --story-folder "../$STORY_SLUG"
```

Native Windows PowerShell:

```powershell
$StoryFolder = Join-Path (Split-Path (Get-Location) -Parent) "my-story"
npm.cmd run storyvr:author -- --story-folder "$StoryFolder"
```

Open <http://127.0.0.1:5188/> in a browser. Keep the terminal process running
while using the editor. To use a different port:

```sh
npm run storyvr:author -- --story-folder "../$STORY_SLUG" --port 5190
```

```powershell
npm.cmd run storyvr:author -- --story-folder "$StoryFolder" --port 5190
```

You can also address the prepared capture directly:

```sh
npm run storyvr:author -- \
  --resource-folder "../$STORY_SLUG/captures/active"
```

```powershell
npm.cmd run storyvr:author -- `
  --resource-folder (Join-Path $StoryFolder "captures\active")
```

Run only one server on port 5188 at a time.

## Use the authoring workflow

Work through the eight participant-facing steps in order:

1. Story order
2. Place objects
3. Set the scene
4. Object movement
5. Scene changes
6. Guide attention
7. Reader actions
8. Review story

Select **Finish this step** to complete a top-level step and open the next step
automatically. Inside a 3D editor, use **Save scene and return** to return to
that step's story canvas without completing the top-level step. If an earlier
step changes, StoryVR revalidates completed downstream work in order, preserves
steps that are still safe, and stops at the first scene or field that needs
review. Review story stays open after completion so **Build story** remains an
explicit action. It starts a background build from a stable snapshot and writes
the current authored decisions into:

```text
<story-folder>/discovery/storyvr-runtime.json
<story-folder>/webxr-adaptation/
```

If the authored inputs change while the build is running, StoryVR leaves the
previous runtime and reader build in place and reports the result as out of
date so the author can build again.

The editor keeps one browser-session Undo/Redo history. Use `Command-Z` and
`Command-Shift-Z` on macOS, or `Ctrl-Z` and `Ctrl-Shift-Z`/`Ctrl-Y` on
Windows and Linux.

When a project opens, StoryVR can use the signed-in Codex CLI to generate a
semantic progress strip for the saved Story order. Missing or stale grouping
is refreshed in the background after Story order is finished; the continuous
story-part and choice graph remains the source of truth.

Place objects flattens probe-verified source layouts into independent GLB
placements while preserving their shared framing, relative transforms, and
story-part-specific visibility. Each object can then be edited and reset on its own.
The canvas supports drag-box selection, Shift additive selection, Command/Ctrl
toggling, right-drag orbiting, and middle-drag panning.

Set the scene is a Generate-only flow that uses the signed-in Codex CLI to
create a story-part-scoped panorama and matching near-ground texture.

Object movement shows the moving scene objects with expandable motion
descriptions and provides edge buttons for moving directly to the previous or
next story part. Codex can use exact-scene PNG, JPEG, and WebP image planes as
attached visual context for a movement request, but those images remain static
and cannot become motion actors or have their authored placement changed.

Scene changes offers **Auto Interpolation** when two consecutive saved scenes
contain safely matched GLBs or image planes whose position, rotation, or scale
changes. Ambiguous object identities are not guessed, and a saved source scene
change always takes precedence. The author preview and compiled reader use the
same transform interpolation and dissolve unmatched endpoint objects in or out.

Guide attention runs after Scene changes so focus markers are inferred from the
saved scene composition and movement state. It can target a visible GLB, named
part, image plane, or a manually placed scene point; the built reader uses a
sparkle plus a large high-contrast arrow placed well inside the headset's
peripheral edge until the reader reaches the target. Select a focus marker and
press Delete or Backspace to remove it; the removal persists across scene
reloads, and the target can be added again.

Review story always uses the authored Reader camera; right-drag looks around
from that reader pose.

Reader actions uses one shared Quest controller mapping across
controller-button scene changes. Its defaults keep A/X for Next/Previous, use the
left stick for continuous forward/backward movement and strafing, and use the
right stick for 45-degree snap turns, ground-plane teleport on Up, and a
180-degree turn on Down. Locomotion stays on directional stick inputs; Trigger
and Grip remain reserved for UI rays and grabbing, and Menu is unavailable for
StoryVR actions.

### Optional session data collection

The editor's **Data collection** switch is off by default. In a current Chrome
browser, turning it on opens a folder chooser, creates a named
`storyvr-interaction-log/v1` JSON file, and records clicks, selected 3D actions,
and completed spatial transform drags without recording typed values. A drag
record can include its operation, axis, sampled pointer path, affected objects,
and before/after transforms. StoryVR checkpoints new events into that same file
while collection is on. Turning the switch off stops new capture at that moment
and finalizes the same file; canceling the initial folder choice leaves
collection off, and a failed checkpoint or final save keeps the cutoff and
unwritten events available for retry.

For a consented study that also needs activity from an original story page,
build the optional local Chrome extension:

```sh
npm run storyvr:study-extension
```

Then load `tools/storyvr-study-extension/unpacked/` as an unpacked extension.
An original page is observed only after its exact tab, origin, and path are
explicitly approved and StoryVR's **Data collection** switch is on. See
`tools/storyvr-study-extension/README.md` for the privacy boundary and setup.

Open exported logs in the local session viewer:

```sh
npm run storyvr:workflow
```

Then open <http://127.0.0.1:5197/> and import one or more log files. The viewer
shows the step timeline, click markers, spatial-drag spans and paths, pauses,
3D actions, spatial-editor intervals, and evidence-linked moments to review.
Imported logs stay local unless **Generate insights** is selected; that optional
action sends only a compact summary to Codex and places expandable annotations
beside their cited timeline events.

### Optional AI features

StoryVR remains usable without an AI login, but Story order progress grouping,
setting generation, and some movement-generation features require a signed-in
Codex CLI:

```sh
codex login
```

In Windows PowerShell, resolve either the standalone executable or the npm
command shim and reuse that exact path:

```powershell
$CodexCommand = Get-Command codex.exe,codex.cmd -ErrorAction SilentlyContinue |
  Select-Object -First 1
& $CodexCommand.Source --version
& $CodexCommand.Source login
```

StoryVR can launch either the native executable or the npm `.cmd` shim on
Windows. Complete sign-in in the participant's browser; do not share or paste
credentials into the terminal. Use `login --device-auth` only if the normal
localhost callback cannot work and device-code login is enabled for the
study-approved account or workspace.

The editor also exposes the standard Codex browser-login flow in its UI. To use a Codex
binary from a nonstandard location:

```sh
CODEX_BIN=/absolute/path/to/codex \
  npm run storyvr:author -- --story-folder "../$STORY_SLUG"
```

```powershell
$env:CODEX_BIN = $CodexCommand.Source
npm.cmd run storyvr:author -- --story-folder "$StoryFolder"
```

`OPENAI_API_KEY` can support some proposal and recommendation fallbacks, but
environment panorama and matching-ground generation require the Codex CLI.

## Build and preview the WebXR reader

After selecting **Build story** in Review story, you can also rebuild a generic
story reader directly:

```sh
STORY_SLUG=my-story
node tools/storyvr-author/build-reader-dist.mjs \
  "../$STORY_SLUG/webxr-adaptation" \
  "../$STORY_SLUG/dist-webxr-adaptation" \
  "/$STORY_SLUG/dist-webxr-adaptation/" \
  .
```

Native Windows PowerShell:

```powershell
$StorySlug = "my-story"
node.exe tools/storyvr-author/build-reader-dist.mjs `
  (Join-Path $StoryFolder "webxr-adaptation") `
  (Join-Path $StoryFolder "dist-webxr-adaptation") `
  "/$StorySlug/dist-webxr-adaptation/" `
  "."
```

The supported build checks that the Reader source has the managed text-layout
contract before writing to the sibling story's `dist-webxr-adaptation/` folder.
If a story keeps a customized Reader template, merge the pending managed
template update reported by **Build story** before building production files.

Serve the result locally over HTTPS.

macOS on `main`:

```sh
python3 https_server.py \
  --root .. \
  --story-path "/$STORY_SLUG/dist-webxr-adaptation/"
```

Native Linux or WSL2 on the portable branch:

```sh
node tools/run-python.mjs https_server.py \
  --root .. \
  --story-path "/$STORY_SLUG/dist-webxr-adaptation/"
```

Native Windows PowerShell uses the branch's portable Python launcher:

```powershell
node.exe tools/run-python.mjs https_server.py `
  --root .. `
  --story-path "/$StorySlug/dist-webxr-adaptation/"
```

The server listens at `https://127.0.0.1:8443/` by default and creates a
self-signed certificate under `.certs/` on first use. Certificate generation
requires the OpenSSL command-line tool on `PATH`; normal StoryVR authoring at
`http://127.0.0.1:5188/` does not require OpenSSL. An existing certificate and
key can instead be supplied with `--cert` and `--key`.
Pass `--verbose` when you also need bind, root, alternate-host, and discovered
story details at startup.

For a headset on the same local network, bind to the LAN interface and use the
printed headset URL:

macOS on `main`:

```sh
python3 https_server.py \
  --root .. \
  --lan \
  --story-path "/$STORY_SLUG/dist-webxr-adaptation/"
```

Native Linux or WSL2 on the portable branch:

```sh
node tools/run-python.mjs https_server.py \
  --root .. \
  --lan \
  --story-path "/$STORY_SLUG/dist-webxr-adaptation/"
```

Native Windows PowerShell:

```powershell
node.exe tools/run-python.mjs https_server.py `
  --root .. `
  --lan `
  --story-path "/$StorySlug/dist-webxr-adaptation/"
```

LAN/headset testing is optional. Keep the computer and headset on the same
private network and use the exact printed URL. Windows may ask whether Python
can receive connections; allow the private network only if headset testing is
intended. Do not disable the firewall. A headset may allow the local
certificate warning once, but managed browser policies can reject self-signed
certificates. In that case, use a facilitator-provided trusted certificate
instead of weakening browser or operating-system security.

## Normalize or probe a prepared story

If `captures/active/` already exists, normalize it into a runtime payload with:

```sh
npm run storyvr:story -- \
  --resource-folder "../$STORY_SLUG/captures/active" \
  --out "../$STORY_SLUG/discovery/storyvr-runtime.json"
```

To collect runtime animation evidence, paste
`tools/animation-logic-probe/runtime-animation-collector.js` into the permitted
source page's browser DevTools console, export its JSON, and analyze it:

```sh
node tools/animation-logic-probe/analyze-animation-probe.mjs \
  --input /path/to/probe.json \
  --story-folder "../$STORY_SLUG"
```

Detailed subsystem documentation is available in:

- `PARTICIPANT_INSTALL_PROMPT.md` for an OS-aware guided installation
- `tools/storyvr-author/README.md`
- `tools/storyvr-adapter/README.md`
- `tools/animation-logic-probe/README.md`
- `tools/environment-enhancement-lab/README.md`
- `tools/storyvr-workflow-lens/README.md`

## Verify the installation

On macOS using `main`, verify the standalone StoryVR tools and installed package
tree with:

```sh
python3 --version
npm ls --depth=0
npm run check
```

On native Linux or WSL2 using the portable branch, use:

```sh
node tools/run-python.mjs --version
npm ls --depth=0
npm run check
npm run verify:native-runtime
```

On native Windows PowerShell, use:

```powershell
node.exe tools/run-python.mjs --version
npm.cmd ls --depth=0
npm.cmd run check
npm.cmd run verify:native-runtime
```

All three macOS checks and all four portable-branch checks must succeed. The
portable branch's check uses its Python launcher, so a working `python3`
command is not specifically required on Windows.

## Troubleshooting

- **`ERR_CONNECTION_REFUSED` or `Failed to fetch`:** restart the author server
  for the intended story and reload the browser.
- **Port 5188 is already in use:** stop the other StoryVR server or pass
  `--port <another-port>`.
- **The story cannot be imported:** verify that
  `<story-folder>/captures/active/metadata/story_structure_candidates.json`
  exists and that the command points to the correct story folder.
- **A path is too long or access is denied on Windows:** move the whole sibling
  workspace to a short user-owned local folder; do not move only the story or
  place it inside `StoryVR-Editor`.
- **PowerShell blocks `npm.ps1` or `codex.ps1`:** use `npm.cmd` or `codex.cmd`;
  do not change the machine's execution policy for StoryVR.
- **Python is not found:** install Python 3, reopen the terminal, and rerun
  `python3 --version` on macOS `main`, `node tools/run-python.mjs --version` on
  portable Linux/WSL, or `node.exe tools/run-python.mjs --version` on native
  Windows. On the portable branch, set `STORYVR_PYTHON` only when explicitly
  choosing a known Python 3 executable.
- **OpenSSL is not found:** localhost authoring still works. Install OpenSSL or
  provide an existing certificate and key before HTTPS/headset preview.
- **The headset cannot connect:** use the `--lan` command, keep the computer
  and headset on the same private network, use the exact printed HTTPS URL, and
  follow the certificate guidance above.
- **AI generation is unavailable:** confirm the resolved Codex executable works
  and run the standard `codex login` browser flow. Reserve device-code login
  for a callback-blocked environment where it has been enabled.
