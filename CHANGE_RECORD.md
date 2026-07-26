# Change Record

This file records Codex-made changes so they can be reverted by scope without sorting through unrelated worktree changes.

Scope note: `Jingchen-10-stories/` and `louise-10-stories/` are intentionally excluded from these records and from current diagnosis unless the user explicitly asks otherwise.

## 2026-06-25 - Fetch Structure De-Dupe

Purpose: reduce repetitive StoryVR beats caused by duplicated NYT DOM structure candidates.

Files:
- `nyt-console-collector.js`
- `nyt-asset-downloader.mjs`
- `tools/storyvr-adapter/storyvr-adapter.mjs`

Changes:
- De-dupe exact repeated story text.
- Prefer text/annotation nodes over broad slide/container wrappers.
- Drop composite container text that only concatenates child slide text.
- Ignore placeholder text values such as `undefined`, `null`, and `nan`.
- De-dupe already-fetched metadata before converting it into StoryVR content units.

Revert scope:
- Restore the files listed above from the prior Git revision, or reverse the patch that introduced this entry.

## 2026-06-25 - Scroll Snapshot Accumulation

Purpose: handle scroll-driven stories whose DOM text changes during auto-scroll.

Files:
- `nyt-console-collector.js`

Changes:
- Accumulate unique headings, captions, scroll steps, and slide candidates at each settled scroll position.
- Export the accumulated structure snapshot instead of relying only on the final DOM state.
- Record each captured structure candidate's first observed scroll position and timestamp.

Revert scope:
- Restore the collector files listed above from the prior Git revision, or reverse the patch that introduced this entry.

## 2026-06-25 - Text-Only Narrative Capture

Purpose: capture non-beat narrative text and label it distinctly from visual beat material.

Files:
- `nyt-console-collector.js`
- `nyt-asset-downloader.mjs`
- `tools/storyvr-adapter/storyvr-adapter.mjs`
- `tools/storyvr-author/engine.mjs`
- `tools/storyvr-author/app/src/main.js`
- `tools/storyvr-author/app/src/styles.css`

Changes:
- Add ordered `text_only_parts` for headline, dek, body paragraphs, and subheads.
- Preserve text-only units in normalized `contentUnits` with `kind: "text-only"`.
- Keep text-only graph items from being treated as missing visual-evidence beats.

Validation:
- `npm run check`
- `npm run self-test`
- Temporary fetched-resource smoke test for `text_only_parts` ordering, duplicate heading suppression, visual-kind preservation, and text-only evidence metadata.

Revert scope:
- Restore the files listed above from the prior Git revision, or reverse the patch that introduced this entry.
