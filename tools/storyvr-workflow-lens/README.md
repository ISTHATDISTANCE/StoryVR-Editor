# StoryVR Session Viewer

This local web tool opens `storyvr-interaction-log/v1` JSON. It shows a timeline with a background color for each StoryVR step. It also marks clicks, pauses, 3D actions, and moments that may be good or may need attention. Codex can give an optional second review.

## Run and import

From the workspace root, run either:

```sh
npm run storyvr:workflow
```

or the server directly:

```sh
node tools/storyvr-workflow-lens/server.mjs
```

Open [http://127.0.0.1:5197/](http://127.0.0.1:5197/) (or the URL printed by the server if the port is overridden). The bundled demonstration session loads automatically; **Reset demo** restores it. Use **Import logs** or drag one or more `.json` files onto the page to inspect exported StoryVR logs. Imports are read in the browser and are not written into a story folder.

The demo uses all eight StoryVR steps. It includes 3D actions, a fast group of clicks, a long pause, a step back, and a later recovery. The data is made up and contains no names or typed values.

## What the tool shows

- A zoomable timeline with a color for each step, plus click, 3D, and key-moment marks.
- Time by step, step path, click pace, click location, clicked items, and a searchable click list.
- Possible good moments, concerns, and items to watch. These are clues, not facts. A long pause may be a break. Fast clicks may be on purpose.
- A downloadable review JSON. The download does not change the source log.

## Codex and privacy

Imported logs stay on this computer unless the user selects **Review current session**. Codex receives a short log summary, not the original file. Each Codex point must link to recorded clicks and times. The server does not save the log, summary, or result.

The logger leaves out typed values and sensitive data fields. A log can still include story titles, button labels, scene names, and file names. Remove identifying labels before sharing it. Do not put names, email addresses, codes, prompts, or typed text in demo logs.

## Interpretation limits

The v1 log records clicks and some 3D selections. Legacy exports do not record scrolling; merged study-extension exports can include the surface, page key, and coarse scroll-depth thresholds. They still do not record typing, form changes, hover, long drags, camera moves, network results, or app errors. Screen size is saved only when logging starts. A step change is confirmed by the next recorded click, so its exact time may be unclear. Time and pause numbers show recorded activity, not attention or success.

A click alone does not prove that a save, step change, build, or generated result worked. The tool and Codex keep that limit clear.
