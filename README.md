# StoryVR Editor

StoryVR Editor is the shared local authoring system for turning a prepared web
story capture into an editable StoryVR experience and a compiled WebXR reader.
This repository contains the editor, adapter, animation probe, reader template,
and local HTTPS server. Story-specific source files and authored output live in
separate story folders beside this repository.

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

Work through the checkpoints in order:

1. Source Graph
2. Spatial Relations
3. Environment Enhancement
4. Attention Guidance
5. Dynamics
6. Transition
7. Interaction Control
8. Final Review

Use **Save checkpoint** before moving downstream. If an upstream checkpoint is
changed later, StoryVR marks affected downstream work stale so it can be
reviewed and saved again. Final Review compiles the current authored decisions
into:

```text
<story-folder>/discovery/storyvr-runtime.json
<story-folder>/webxr-adaptation/
```

The editor keeps one browser-session Undo/Redo history. Use `Command-Z` and
`Command-Shift-Z` on macOS, or `Ctrl-Z` and `Ctrl-Shift-Z`/`Ctrl-Y` on
Windows and Linux.

When a project opens, StoryVR can use the signed-in Codex CLI to generate a
semantic progress strip for the saved Source Graph. Missing or stale grouping
is refreshed in the background after the story order is saved; the continuous
beat and variant graph remains the source of truth.

Spatial Relations preserves probe-verified source GLB assemblies as one
editable composition with the captured member transforms and beat-specific
visibility intact. Ordinary or manually customized assets remain independent.
The object list also supports Shift range selection and Command/Ctrl additive
selection for moving related objects together.

Interaction Control uses one shared Quest controller mapping across
controller-button transitions. Its defaults keep A/X for next/back, use the
left stick for continuous forward/backward movement and strafing, and use the
right stick for 45-degree snap turns, ground-plane teleport on Up, and a
180-degree turn on Down. Locomotion stays on directional stick inputs; Trigger
and Grip remain reserved for UI rays and grabbing.

### Optional AI features

StoryVR remains usable without an AI login, but Source Graph progress grouping,
environment generation, and some motion-generation features require a signed-in
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

After compiling in Final Review, build a generic story reader:

```sh
STORY_SLUG=my-story
npx vite build "../$STORY_SLUG/webxr-adaptation" \
  --outDir ../dist-webxr-adaptation \
  --base "/$STORY_SLUG/dist-webxr-adaptation/" \
  --emptyOutDir
```

With Vite's story app as the build root, this writes to the sibling story's
`dist-webxr-adaptation/` folder.

Serve the result locally over HTTPS:

```sh
python3 https_server.py \
  --root .. \
  --story-path "/$STORY_SLUG/dist-webxr-adaptation/"
```

The server listens at `https://127.0.0.1:8443/` by default and creates a
self-signed certificate under `.certs/` on first use.

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
