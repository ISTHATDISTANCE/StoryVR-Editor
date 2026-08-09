# StoryVR Session Viewer

This local web tool opens `storyvr-interaction-log/v1` JSON. It shows a timeline with a background color for each StoryVR step. It also marks clicks, spatial transform drags, pauses, other 3D actions, and moments that may be good or may need attention. Codex can add optional evidence-linked annotations directly to that timeline.

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

- A zoomable timeline with a color for each step, click markers, duration spans for spatial drags, other 3D marks, key-moment flags, and optional generated annotations.
- Time by step, step path, interaction pace, an interaction map with click dots and drag paths, repeated targets, and a searchable event list.
- Drag details include the operation, axis, duration, affected object identifiers, and before/after transforms.
- Possible good moments, concerns, and items to watch. These are clues, not facts. A long pause may be a break. Fast clicks may be on purpose.
- A downloadable review JSON. The download does not change the source log.

## Codex and privacy

Imported logs stay on this computer unless the user selects **Generate insights** beside the timeline. Codex receives a short log summary, not the original file. Each generated annotation must link to recorded event numbers and times. The server does not save the log, summary, or result.

The logger leaves out typed values and sensitive data fields. A log can still include story titles, button labels, scene names, and file names. Remove identifying labels before sharing it. Do not put names, email addresses, codes, prompts, or typed text in demo logs.

## Interpretation limits

Current v1 exports record clicks and spatial-editor transform drags. A transform drag can contain its object, duration, sampled pointer path, operation and axis, and before/after transform. Camera orbit/pan, marquee selection, and other long drags are not captured. Legacy v1 exports may contain only clicks and some 3D selections. Legacy exports do not record scrolling; merged study-extension exports can include the surface, page key, and coarse scroll-depth thresholds. The logs still do not record typing, form changes, hover, network results, or app errors. Screen size is saved only when logging starts, so the interaction map may be less exact after a resize. A workflow navigation destination is confirmed by the next event with step context, so its exact boundary may be unclear. Time and pause numbers show recorded activity, not attention or success.

A click or drag alone does not prove that a save, step change, build, or generated result worked. The tool and Codex keep that limit clear.
