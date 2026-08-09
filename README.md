# StoryVR Editor

StoryVR Editor is the shared local authoring system for turning a prepared web
story capture into an editable StoryVR experience and a compiled WebXR reader.
This repository contains the editor, adapter, animation probe, session viewer,
reader template, and local HTTPS server. Story-specific source files and
authored output live in separate story folders beside this repository.

## Prerequisites

- Node.js 24 or newer
- npm (included with Node.js)
- Python 3 for the local HTTPS server
- Optional: the [Codex CLI](https://developers.openai.com/codex/cli/) for
  AI-backed environment and motion generation
- Optional: a WebXR headset on the same network for immersive testing

Check the installed versions:

```sh
node --version
npm --version
python3 --version
```

## Install the dependencies

Clone the repository, enter it, and install exactly the versions recorded in
`package-lock.json`:

```sh
git clone https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
cd StoryVR-Editor
npm ci
```

`node_modules/` is intentionally not stored in Git. Run `npm ci` after a fresh
clone or when the lockfile changes. Use `npm install <package>` only when you
intend to add or update a dependency and update the lockfile.

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
server:

```sh
STORY_SLUG=my-story
npm run storyvr:author -- --story-folder "../$STORY_SLUG"
```

Open <http://127.0.0.1:5188/> in a browser. Keep the terminal process running
while using the editor. To use a different port:

```sh
npm run storyvr:author -- --story-folder "../$STORY_SLUG" --port 5190
```

You can also address the prepared capture directly:

```sh
npm run storyvr:author -- \
  --resource-folder "../$STORY_SLUG/captures/active"
```

Run only one server on port 5188 at a time.

## Use the authoring workflow

Work through the eight participant-facing steps in order:

1. Story order
2. Place objects
3. Set the scene
4. Guide attention
5. Object movement
6. Scene changes
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
create a story-part-scoped panorama and matching near-ground texture. Guide
attention can target a visible GLB, named part, image plane, or a manually
placed scene point; the built reader uses a sparkle plus a large high-contrast
arrow placed well inside the headset's peripheral edge until the reader reaches
the target. Select a focus marker and press Delete or Backspace to remove it;
the removal persists across scene reloads, and the target can be added again.

Object movement shows the moving scene objects with expandable motion
descriptions and provides edge buttons for moving directly to the previous or
next story part. Codex can use exact-scene PNG, JPEG, and WebP image planes as
attached visual context for a movement request, but those images remain static
and cannot become motion actors or have their authored placement changed.
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
3D actions, and evidence-linked moments to review. Imported logs stay local
unless **Generate insights** is selected; that optional action sends only a
compact summary to Codex and places the returned evidence-linked annotations
on the timeline.

### Optional AI features

StoryVR remains usable without an AI login, but Story order progress grouping,
setting generation, and some movement-generation features require a signed-in
Codex CLI:

```sh
codex login --device-auth
```

The editor also exposes the Codex device-login flow in its UI. To use a Codex
binary from a nonstandard location:

```sh
CODEX_BIN=/absolute/path/to/codex \
  npm run storyvr:author -- --story-folder "../$STORY_SLUG"
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

The supported build checks that the Reader source has the managed text-layout
contract before writing to the sibling story's `dist-webxr-adaptation/` folder.
If a story keeps a customized Reader template, merge the pending managed
template update reported by **Build story** before building production files.

Serve the result locally over HTTPS:

```sh
python3 https_server.py \
  --root .. \
  --story-path "/$STORY_SLUG/dist-webxr-adaptation/"
```

The server listens at `https://127.0.0.1:8443/` by default and creates a
self-signed certificate under `.certs/` on first use.
Pass `--verbose` when you also need bind, root, alternate-host, and discovered
story details at startup.

For a headset on the same local network, bind to the LAN interface and use the
printed headset URL:

```sh
python3 https_server.py \
  --root .. \
  --lan \
  --story-path "/$STORY_SLUG/dist-webxr-adaptation/"
```

The headset may require you to accept the local certificate warning once.

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

- `tools/storyvr-author/README.md`
- `tools/storyvr-adapter/README.md`
- `tools/animation-logic-probe/README.md`
- `tools/environment-enhancement-lab/README.md`
- `tools/storyvr-workflow-lens/README.md`

## Verify the installation

Run `npm run check` for syntax validation across the standalone StoryVR tools.

## Troubleshooting

- **`ERR_CONNECTION_REFUSED` or `Failed to fetch`:** restart the author server
  for the intended story and reload the browser.
- **Port 5188 is already in use:** stop the other StoryVR server or pass
  `--port <another-port>`.
- **The story cannot be imported:** verify that
  `<story-folder>/captures/active/metadata/story_structure_candidates.json`
  exists and that the command points to the correct story folder.
- **The headset cannot connect:** use the `--lan` command, keep the Mac and
  headset on the same network, use the exact printed HTTPS URL, and accept the
  local certificate warning.
- **AI generation is unavailable:** confirm `codex --version` works and run
  `codex login --device-auth`.
