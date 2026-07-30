# Change Record

This file records Codex-made changes so they can be reverted by scope without sorting through unrelated worktree changes.

Scope note: `Jingchen-10-stories/` and `louise-10-stories/` are intentionally excluded from these records and from current diagnosis unless the user explicitly asks otherwise.

## 2026-06-25 - Text-Only Narrative Capture

Purpose: preserve non-beat narrative text and label it distinctly from visual beat material.

Files:
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

Revert scope:
- Restore the files listed above from the prior Git revision, or reverse the patch that introduced this entry.
