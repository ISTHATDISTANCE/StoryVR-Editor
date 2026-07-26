# Codex Cross-Device Sync Notes

Use this file as the shared message for Codex sessions on both Mac and Windows. It is intentionally separate from `AGENTS.md`; do not edit `AGENTS.md` for cross-device sync notes unless the user explicitly asks.

# Copied AGENTS.md Instructions

# Workspace Instructions

## WebXR Story Adaptation Organization

For any future WebXR story adaptation, keep all story-specific material inside one story container folder named with the story slug. Use `global-migration/` as the current example, but apply this convention generally to later stories.

- Story folders use `<story-slug>/`.
- App source goes in `<story-slug>/webxr-adaptation/`.
- Active source capture goes in `<story-slug>/captures/active/`.
- Retained archive captures go in `<story-slug>/captures/<archive-name>/`.
- Static build output goes in `<story-slug>/dist-webxr-adaptation/`.
- Screenshots go in `<story-slug>/screenshots/playwright/`.
- Notes go in `<story-slug>/analysis/`.
- Discovery JSON goes in `<story-slug>/discovery/`.

Keep generic root tooling at the workspace root:

- `package.json`
- `package-lock.json`
- `node_modules/`
- `https_server.py`
- `nyt-asset-downloader.mjs`
- `nyt-console-collector.js`

When adding or moving a WebXR story adaptation, update all path dependencies to match the story folder. Check npm scripts, `build-story-instance.mjs` source and output paths, generated `assetRoot`, README URLs, HTTPS printed URLs, and the Vite static `--base` path.

## Repository Sync

- Canonical remote: `https://github.com/ISTHATDISTANCE/web2VR_4_dev_repo.git`
- Primary branch: `main`
- Pull before starting work on either device.
- Commit and push after meaningful changes so the other device can continue from the same state.
- Do not force-push unless the user explicitly requests it and understands the risk.

## Local Environment

- Use Node.js `>=24.0.0`.
- Run `npm install` separately on each machine after cloning or after dependency changes.
- Run `npm install` inside `web2vr-initial-adaptations/` when working with that package.
- Dependencies, local HTTPS certificates, caches, logs, and OS-generated files are local-only and should not be synced through Git.

## Tracking Policy

Commit project material that should move between devices:

- Story folders and their `webxr-adaptation/` source.
- `captures/`, `analysis/`, `discovery/`, and `screenshots/`.
- `dist-webxr-adaptation/` static build output.
- `outputs/` presentation and probe artifacts.
- Root tooling and notes.

Do not commit local-only material:

- `node_modules/`
- `.certs/`
- `.playwright-cli/`
- `__pycache__/` and Python bytecode.
- `.env` files and secrets.
- macOS and Windows generated files such as `.DS_Store`, `Thumbs.db`, and `Desktop.ini`.

## Validation

Run these before committing or pushing:

```sh
npm run check
```

```sh
cd web2vr-initial-adaptations
npm run check
```

For Git hygiene, also check:

```sh
git status --short --ignored
find . -type f -size +95M -not -path './.git/*' -not -path './node_modules/*' -not -path './*/node_modules/*'
```
