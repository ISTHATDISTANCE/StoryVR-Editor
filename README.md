# StoryVR Editor

StoryVR Editor is the shared local authoring system for turning a prepared web
story capture into an editable StoryVR experience and a compiled WebXR reader.
This repository contains the editor, adapter, animation probe, session viewer,
reader template, and local HTTPS server. Story-specific source files and
authored output live in separate story folders beside this repository.

For the upcoming user study, **session data collection and AI features are
required**. Complete the [session data collection setup](#required-session-data-collection)
and [AI setup](#required-ai-features) before the participant begins study tasks.

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
- Google Chrome 114 or newer for the study's data-collection extension and
  validated manual installation workflow
- The [Codex CLI](https://developers.openai.com/codex/cli/) with a study-approved
  sign-in, required for the study's AI-backed environment and motion workflow
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

> **Participant study installations:** use `PARTICIPANT_INSTALL_PROMPT.md`
> instead of the manual developer commands below. The guided workflow creates a
> new dedicated workspace plus ownership records required by
> `PARTICIPANT_UNINSTALL_PROMPT.md`. A manual checkout has no such proof, so the
> uninstall prompt will deliberately refuse to remove it.

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
that step's story canvas without completing the top-level step. Every editor can
be opened, changed, and autosaved independently using the latest saved drafts
and inferred scene data; switching steps saves pending drafts without marking a
step finished. A material upstream edit can mark affected downstream work for
review, but it does not lock those editors. **Review story** completion and
**Build story** still require every decision to be current and valid. Review
story stays open after completion so **Build story** remains an explicit action.
It starts a background build from a stable snapshot and writes the current
authored decisions into:

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
is refreshed in the background from the latest saved graph regardless of which
step is open; the continuous story-part and choice graph remains the source of
truth.

Place objects flattens probe-verified source layouts into independent GLB
placements while preserving their shared framing, relative transforms, and
story-part-specific visibility. Each object can then be edited and reset on its own.
The canvas supports drag-box selection, Shift additive selection, Command/Ctrl
toggling, right-drag orbiting, and middle-drag panning.

Set the scene is a Generate-only flow that uses the signed-in Codex CLI to
create a panorama and matching near-ground texture for the exact open story
scene. Parallel variant choices can own different settings; legacy beat-level
settings remain the fallback until an exact variant is authored. Each exact
scene keeps its own conversation, so follow-up messages edit the saved panorama
and matching ground while preserving prior visual intent and tuning. Successful
image updates save with the exchange atomically; clarification-only and
unchanged replies keep the current setting and Reader build valid. Clearing a
scene's conversation keeps its installed images, and author-only conversation
metadata is excluded from the compiled Reader and build signatures. Failed image
generation keeps the previous setting and records bounded, sanitized diagnostics
under the story's `analysis/storyvr/generation-diagnostics/` folder.

Object movement exposes the complete saved Reader, GLB, and image roster plus
runtime-generated objects. Codex can animate exact-scene GLBs and image planes
with declarative timelines or create temporary primitives, lights, and particle
emitters. Each scene and variant keeps its own saved conversation and accepted
plan, so follow-ups such as “make it slower” can refine, add, remove, or stop
behavior without restating the original request. Successful turns and plan
updates save atomically; clarification-only or no-change replies can be kept
without invalidating the Reader build, while failures leave the prior result
intact. Codex interprets the complete request and conversation instead of local
keyword rules. An exact restoration can reuse an accepted assistant plan snapshot
while preserving its seed, timing, and manual generated-object offsets. Select
saved GLBs or image planes in the scene to make them the exact
subjects for the next message; unselected animation remains unchanged. With no
selection, Codex derives subjects from the request and saved scene, and Reader
is never selected automatically. Plans validate each track against its target,
reject invisible or identity-only results, and make one bounded repair attempt
when generated actions are incompatible. Appearance-only prompts can animate
color and brightness without adding unrequested object movement. Conversation
history remains authoring-only and is omitted from Reader exports and build
input signatures. The author preview and Reader share visible-pivot compensation
and explicit clip loop behavior so generated motion preserves the authored
object framing.

Scene changes offers **Auto Interpolation** when two consecutive saved scenes
contain safely matched GLBs or image planes whose position, rotation, or scale
changes. Ambiguous object identities are not guessed, and a saved source scene
change always takes precedence. The author preview and compiled reader use the
same transform interpolation and dissolve unmatched endpoint objects in or out.
Other exact routes without a saved mapping or safe interpolation retain the
truthful no-saved-change label while offering a full-editor sudden-cut preview
with one-second source and destination holds; this does not alter Reader timing
or story-canvas thumbnails.
Every exact directed scene arrow—including choices within one story part—can
keep its own generated-transition conversation. Follow-up messages refine the
latest saved transition while preserving effects outside the current selection.
Validated messages save the route-scoped plan and conversation atomically, and
clarifications can be retained without invalidating an unchanged Reader build.
New transition actions use explicit property keyframes for visibility,
saved-relative transforms, material color, and emissive effects, and can bind a
verified embedded GLB clip to an exact endpoint object. The Author and Reader
share the same progress-driven sampler while preserving the exact saved endpoints,
including during pause and backwards scrubbing. Provider failures remain errors
instead of becoming keyword-derived fallback transitions.
Clearing a connection removes its generated transition and conversation as one
Undoable change. Conversation text remains author-only and is excluded from the
compiled Reader.

Set the scene, Object movement, and Scene changes share a derived story-memory
index built from the latest saved scenes, choices, exact object identities,
available clips, settings, and accepted plans. This lets an author refer to prior
work naturally—for example, to reuse another scene's background or movement—while
keeping the referenced source unchanged and rebinding the result to the current
scene. The derived `analysis/storyvr/shared-memory.json` file is excluded from
Reader builds and authoring-history signatures.

Guide attention runs after Scene changes so focus markers are inferred from the
saved scene composition and movement state. It can target a visible GLB, named
part, image plane, or a manually placed scene point; the built reader uses a
sparkle plus a large high-contrast arrow placed well inside the headset's
peripheral edge until the reader reaches the target. Select a focus marker and
press Delete or Backspace to remove it; the removal persists across scene
reloads, and the target can be added again.

Review story opens at the authored Reader camera; right-drag looks around
transiently, and **Reset view** restores the saved Reader pose without changing
authored state or Undo/Redo history.

Reader actions uses one shared Quest controller mapping across
controller-button scene changes. Its defaults keep A/X for Next/Previous, use the
left stick for continuous forward/backward movement and strafing, and use the
right stick for 45-degree snap turns, ground-plane teleport on Up, and a
180-degree turn on Down. Locomotion stays on directional stick inputs; Trigger
and Grip remain reserved for UI rays and grabbing, while Menu can be assigned
only to non-locomotion StoryVR navigation.

Reader locomotion keeps physical walking dwell-gated and treats virtual
teleport as route-scoped: entering the exact visible target from outside—by
continuous movement or an exact teleport landing—advances once to the saved
destination, while teleport elsewhere remains ordinary free movement and never
changes the story part.

### Required session data collection

Session data collection, including the StoryVR study Chrome extension, is
required for every user-study session. Complete the extension setup below
before the session. The editor's **Data collection** switch is off by default
and must stay off during installation. After informed consent is complete, the
facilitator must approve the original story page and turn collection on before
the participant begins study tasks.

In Chrome, turning **Data collection** on opens a folder chooser, creates a named
`storyvr-interaction-log/v1` JSON file, and records clicks, selected 3D actions,
and completed spatial transform drags without recording typed values. A drag
record can include its operation, axis, sampled pointer path, affected objects,
and before/after transforms. StoryVR checkpoints new events into that same file
while collection is on. Turning the switch off stops new capture at that moment
and finalizes the same file; canceling the initial folder choice leaves
collection off, and a failed checkpoint or final save keeps the cutoff and
unwritten events available for retry.

While collection is on, the same log also accumulates provider-reported token
usage for StoryVR generation requests, including measured/unavailable request
counts and input, output, cached-input, cache-write, and reasoning-output
subtotals. StoryVR records no prompts, generated output, credentials, provider
response IDs, Codex thread IDs, or local paths in this summary. Older logs
without token usage remain valid and display as not measured rather than zero.

Build the required local Chrome extension from the repository root:

```sh
npm run storyvr:study-extension
```

On native Windows PowerShell, use `npm.cmd run storyvr:study-extension`.
The build creates `tools/storyvr-study-extension/unpacked/`, including its
`manifest.json`. This generated folder is intentionally excluded from GitHub
and will not exist in a fresh clone until the build runs.

In the dedicated study Chrome profile, open `chrome://extensions`, enable
**Developer mode**, select **Load unpacked**, and choose the generated folder.
Keep StoryVR and the original story in that same profile. If StoryVR was already
open, reload its tab once after loading the extension.
An original page is observed only after its exact tab, origin, and path are
explicitly approved and StoryVR's **Data collection** switch is on. See
`tools/storyvr-study-extension/README.md` for the privacy boundary and setup.

For participant-study setup, `PARTICIPANT_INSTALL_PROMPT.md` builds and
statically verifies a unique `tools/storyvr-study-extension/builds/participant-<installId>/`
directory, then hands Chrome loading to the facilitator as an explicit manual
checklist. When using that workflow, load the exact absolute directory printed
in its final checklist. `PARTICIPANT_UNINSTALL_PROMPT.md`
requires collection finalization and log preservation first, then pauses for
manual removal from the exact study Chrome profile. Neither prompt automates
Developer mode, extension loading/removal, or browser-profile deletion.

Open exported logs in the local session viewer:

```sh
npm run storyvr:workflow
```

Then open <http://127.0.0.1:5197/> and import one or more log files. The viewer
shows the step timeline, click markers, spatial-drag spans and paths, pauses,
3D actions, spatial-editor intervals, provider-reported AI usage, and
evidence-linked moments to review.
Imported logs stay local unless **Generate insights** is selected; that optional
action sends only a compact summary to Codex and places expandable annotations
beside their cited timeline events.

### Required AI features

AI features are required for the upcoming user study. Install the Codex CLI and
complete the study-approved sign-in before the participant begins study tasks.
Story order progress grouping, setting generation, and AI movement-generation
features depend on this setup. Sign in with:

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

StoryVR pins generation to `gpt-5.6-sol` independently of the user's global
Codex model. Structured text and JSON planning—Story progress, Object movement,
Scene changes, proposals, and performance planning—uses Ultra reasoning and has
no StoryVR-imposed time limit. Output-size safeguards remain; image generation,
login, uploads, and local builds retain their separate bounded timeouts.

The editor exposes the Codex device-auth flow in its UI and never receives CLI
credentials or tokens. To use a Codex binary from a nonstandard location:

```sh
CODEX_BIN=/absolute/path/to/codex \
  npm run storyvr:author -- --story-folder "../$STORY_SLUG"
```

```powershell
$env:CODEX_BIN = $CodexCommand.Source
npm.cmd run storyvr:author -- --story-folder "$StoryFolder"
```

An explicit `CODEX_BIN` takes priority. Otherwise StoryVR checks an executable
`CODEX_CLI_PATH`, then on macOS the CLI bundled with ChatGPT or Codex, and then
`codex` on `PATH`. Restart the StoryVR server after changing the executable or
its configuration.

`OPENAI_API_KEY` can support some proposal and recommendation fallbacks, but
environment panorama and matching-ground generation require the Codex CLI.
Study AI setup is complete only when the Codex CLI is signed in and available
to StoryVR.

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
- `PARTICIPANT_UNINSTALL_PROMPT.md` for manifest-verified, recoverable cleanup
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
  and complete the device-auth flow shown by the editor, or run the approved
  terminal login flow for the current workspace.
