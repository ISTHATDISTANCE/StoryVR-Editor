# StoryVR standalone workspace

This folder contains the runnable StoryVR authoring system, the NYTimes source
collector/downloader, the animation collector and logic probe, and all Node
dependencies. The complete classroom and shark story containers are siblings
of this folder at `../classroom/` and `../shark/`.

## Requirements

- Node.js 24 or newer
- Python 3 for the local HTTPS server
- Optional: a signed-in `codex` CLI for AI-backed authoring features

The copied `node_modules/` folder is included, so no install step is required on
this Mac. If dependencies ever need to be refreshed, run `npm install`.

## Author a story

From this `StoryVR` folder:

```sh
npm run storyvr:author:classroom
npm run storyvr:author:shark
```

The authoring UI opens at <http://127.0.0.1:5188/>. Run only one of these
commands at a time unless a different `--port` is supplied.

Equivalent generic commands are:

```sh
npm run storyvr:author -- --story-folder ../classroom
npm run storyvr:author -- --story-folder ../shark
```

## Build and serve the readers

```sh
npm run build:classroom
npm run build:shark
npm run serve:https
```

For headset access over the local network:

```sh
npm run serve:https:lan
```

The HTTPS server creates a local certificate in `.certs/` on first run.

## Collect and probe a new story

1. Paste `nyt-console-collector.js` into the permitted story page's browser
   DevTools console and run `NYTAssetCollector.autoRun()`.
2. Use `npm run storyvr:story -- --discovery <downloaded-json> --story-folder
   ../<story-slug>` to fetch and normalize the story.
3. Paste `tools/animation-logic-probe/runtime-animation-collector.js` into the
   story page's DevTools console and export the probe JSON.
4. Analyze it with:

```sh
node tools/animation-logic-probe/analyze-animation-probe.mjs \
  --input <probe-json> \
  --story-folder ../<story-slug>
```

Detailed instructions live in `tools/storyvr-author/README.md`,
`tools/storyvr-adapter/README.md`, and
`tools/animation-logic-probe/README.md`.

## Verification

```sh
npm run check
npm run test:probe
npm run test:author
npm run test:https
```
