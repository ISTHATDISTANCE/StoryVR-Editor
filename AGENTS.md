# Workspace Instructions

## WebXR Story Adaptation Organization

For any future WebXR story adaptation, keep all story-specific material inside
one story container folder named with the story slug. In this `web2vr_5`
workspace, story containers are siblings of `StoryVR/`, while the shared
StoryVR system and generic tooling remain inside `StoryVR/`.

- Story folders use `../<story-slug>/` when addressed from `StoryVR/`.
- App source goes in `<story-slug>/webxr-adaptation/`.
- Active source capture goes in `<story-slug>/captures/active/`.
- Retained archive captures go in `<story-slug>/captures/<archive-name>/`.
- Static build output goes in `<story-slug>/dist-webxr-adaptation/`.
- Screenshots go in `<story-slug>/screenshots/playwright/`.
- Notes go in `<story-slug>/analysis/`.
- Discovery JSON goes in `<story-slug>/discovery/`.

Keep generic StoryVR tooling inside `StoryVR/`:

- `package.json`
- `package-lock.json`
- `node_modules/`
- `https_server.py`

Do not copy the root NYT source-asset collector/downloader or any test files
from `web2vr_4` into this standalone repository.

When adding or moving a WebXR story adaptation, update all path dependencies to match the story folder. Check npm scripts, `build-story-instance.mjs` source and output paths, generated `assetRoot`, README URLs, HTTPS printed URLs, and the Vite static `--base` path.
