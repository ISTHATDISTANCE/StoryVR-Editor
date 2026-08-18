# Codex cross-device sync notes

Use this file as the shared operating contract for Codex sessions working on
the standalone StoryVR repository from macOS, Linux, or Windows. `AGENTS.md`
remains authoritative for repository layout and exclusions.

## Repository and platform branches

- Canonical remote:
  `https://github.com/ISTHATDISTANCE/StoryVR-Editor.git`
- macOS branch: `main`
- Native Linux branch: `codex/native-windows`
- Native Windows 11 branch: `codex/native-windows`
- WSL2 fallback branch: `codex/native-windows` inside WSL

Native Windows PowerShell is the preferred Windows environment. WSL2 is a
fallback for a machine that cannot satisfy the native prerequisites; do not
install or switch to WSL silently. A WSL checkout is a Linux checkout and must
have its own Git, Node, Python, Codex, and `node_modules` installation.

Before editing, verify a clean checkout and establish a fast-forward-only
baseline for the active platform branch. On macOS:

```sh
git status --short
git fetch --prune origin
git switch main
git pull --ff-only origin main
```

On native Linux or WSL2:

```sh
git status --short
git fetch --prune origin
git switch codex/native-windows
git pull --ff-only origin codex/native-windows
```

On native Windows PowerShell:

```powershell
git status --short
git fetch --prune origin
git switch codex/native-windows
git pull --ff-only origin codex/native-windows
```

Do not force-push. Do not merge `codex/native-windows` into `main`, or replace
one platform branch with the other, without explicit user direction and
cross-platform validation. Commit and push meaningful changes to the active
branch so the matching device can continue from the same state.

## Local prerequisites

Every environment needs Git, Node.js 24 or newer, npm, Python 3, and a current
Chromium browser. The Codex CLI is required for StoryVR's AI-backed environment
and motion features. OpenSSL is needed only to generate a local HTTPS
certificate for Reader/headset preview; the author at
`http://127.0.0.1:5188/` does not need it.

On Windows:

- Use PowerShell on Windows 11 and invoke npm as `npm.cmd` so no execution-policy
  change is needed.
- Prefer native x64 tools on x64 Windows and ARM64 tools on ARM64 Windows.
- Keep the repository and sibling story folders in a short user-owned local
  path such as `$env:USERPROFILE\StoryVR`; avoid OneDrive, network drives, and
  deep nesting.
- Use `codex.cmd` when the npm-installed Codex CLI exposes that shim. StoryVR's
  process launcher supports `.cmd` files.
- Use `node.exe tools/run-python.mjs <args>` for Python. The wrapper probes
  `py -3`, `python3`, and `python`, in that order, and accepts an exact
  `STORYVR_PYTHON` executable override.
- Do not require Developer Mode or administrator access merely to assemble a
  Reader. Any permission, firewall, or certificate-trust request must be
  explicit and limited to the intended operation.

On macOS using `main`:

- Provide Python 3 as the exact `python3` command used by the current `main`
  package scripts and HTTPS commands.
- Use the normal `npm` and `codex` commands for the active shell.

On native Linux or WSL2 using the portable branch:

- Use `node tools/run-python.mjs <args>` for Python.
- Use the normal `npm` and `codex` commands for the active shell.

Install dependencies separately in every checkout. Never sync or copy
`node_modules` across devices or operating systems:

```sh
npm ci
```

```powershell
npm.cmd ci
```

The lockfile installs the cross-platform process and image runtimes. Windows
and Linux do not need a manual `sips` or ImageMagick installation.

## Story workspace contract

Keep story containers beside `StoryVR-Editor`, never inside it:

```text
workspace/
├── StoryVR-Editor/
└── <story-slug>/
    ├── captures/active/
    ├── analysis/
    ├── discovery/
    ├── webxr-adaptation/
    └── dist-webxr-adaptation/
```

Story-specific paths, authored files, screenshots, and build output remain in
the sibling story container. Generic StoryVR tooling remains in this
repository. Preserve sibling-story hosting behavior when changing path or
Reader-build code.

The standalone repository intentionally excludes NYT collector/downloader
code, tests and test-only material from the source workspace, generated caches,
secrets, and participant data. Do not reintroduce them during a cross-device
sync.

## Cross-platform implementation rules

- Build paths with Node/Python path APIs; do not assume `/` or a drive letter.
- Quote paths in displayed commands. PowerShell examples must use PowerShell
  syntax and `npm.cmd`.
- On `codex/native-windows`, route Python through `tools/run-python.mjs`; do not
  add new hard-coded `python3` package scripts or generated commands to that
  branch.
- Keep subprocess execution compatible with Windows `.exe` and `.cmd` shims.
- Do not add a macOS-only executable without a Windows/Linux implementation.
- Treat OpenSSL, certificate trust, LAN binding, and firewall access as
  optional headset concerns, not prerequisites for localhost authoring.
- Prefer short Windows workspace paths over global long-path, execution-policy,
  or Developer Mode changes.

The participant-facing installation workflow is maintained in
`PARTICIPANT_INSTALL_PROMPT.md`. Keep its OS-to-branch selection, verification
commands, and final launch message synchronized with the actual code.

## Tracking policy

Commit project material that must move between devices, including generic
tooling, documentation, and intended StoryVR source/build changes. Do not commit
local-only material:

- `node_modules/`
- `.certs/`
- `.playwright-cli/`
- `__pycache__/` and Python bytecode
- `.env` files, secrets, logs, and caches
- `.DS_Store`, `Thumbs.db`, and `Desktop.ini`
- participant study data unless the user explicitly selects an approved,
  de-identified artifact

## Validation before commit or push

On macOS using `main`:

```sh
node --version
npm --version
python3 --version
npm ls --depth=0
npm run check
git status --short --ignored
find . -type f -size +95M \
  -not -path './.git/*' \
  -not -path './node_modules/*'
```

On native Linux or WSL2 using the portable branch:

```sh
node --version
npm --version
node tools/run-python.mjs --version
npm ls --depth=0
npm run check
npm run verify:native-runtime
git status --short --ignored
find . -type f -size +95M \
  -not -path './.git/*' \
  -not -path './node_modules/*'
```

On native Windows PowerShell:

```powershell
node.exe --version
npm.cmd --version
node.exe tools/run-python.mjs --version
npm.cmd ls --depth=0
npm.cmd run check
npm.cmd run verify:native-runtime
git status --short --ignored
Get-ChildItem -Recurse -Force -File |
  Where-Object {
    $_.Length -gt 95MB -and
    $_.FullName -notmatch '[\\/](?:\.git|node_modules)[\\/]'
  } |
  Select-Object FullName, Length
```

Also validate a disposable assembled Reader through
`tools/storyvr-author/build-reader-dist.mjs` whenever Reader templates, build
links, generated commands, or hosting paths change. A raw Vite run against the
unassembled Reader template is not a supported substitute.

Before pushing, review the staged diff, confirm that `package.json` and
`package-lock.json` change together when dependencies change, verify the active
branch and upstream, and ensure no story, secret, certificate, dependency
folder, or generated validation artifact was staged accidentally.
