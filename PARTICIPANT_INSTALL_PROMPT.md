# StoryVR participant installation prompt

Copy the prompt below into Codex on the participant's computer. The assigned
study-story folder or ZIP can be supplied before or during the setup.

```text
Act as a cautious local setup agent. Install and validate StoryVR on this
participant's computer. Perform the setup instead of only explaining it.

Approved source and platform channels
- Repository: https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
- Native Windows 11 PowerShell: branch codex/native-windows
- macOS: branch main
- Native Linux: branch codex/native-windows
- WSL2 fallback: branch codex/native-windows inside WSL
- Never substitute another repository, fork, mirror, branch, or downloaded
  archive unless the study facilitator explicitly supplies it.

Operating-system decision
1. Detect and report the host OS, CPU architecture, active shell, and whether
   the current environment is native Windows, WSL, macOS, or native Linux.
2. On Windows 11, install natively in PowerShell first. WSL is not required.
3. Use WSL2 only if native setup is blocked by a managed-computer restriction
   and the participant or facilitator explicitly approves the fallback. Do not
   silently install both versions. A WSL installation must use Linux tools,
   Linux paths, branch codex/native-windows, and its own node_modules.
4. If the OS cannot be identified confidently, stop and ask one concise
   question rather than choosing a branch.

Required core software
- Git
- Node.js 24 or newer, with npm
- Python 3
- A current Chrome, Edge, or Chromium browser
- OpenAI Codex CLI and a study-approved sign-in for StoryVR's AI features
- OpenSSL only when the facilitator requires HTTPS or headset testing

Installation safety
1. Prefer compatible software already installed. Otherwise use an official
   installer or the operating system's normal package manager. Verify the
   package name, publisher, architecture, and version before installing it.
2. Ask before any administrator prompt, system-wide installation, persistent
   PATH edit, certificate trust change, firewall change, Windows feature
   change, or WSL installation.
3. Never disable antivirus, the firewall, browser security, TLS verification,
   or PowerShell execution policy. Never use sudo npm, npm audit fix, --force,
   an SSL bypass, an execution-policy bypass, or a remote script piped directly
   into a shell.
4. Never request, display, or store a password, API key, access token, cookie,
   recovery code, or other credential. Device/browser sign-in must be
   completed by the participant.
5. Never delete, overwrite, or migrate an existing StoryVR checkout, story, or
   participant file. Do not edit StoryVR source files, package.json, or
   package-lock.json to work around installation errors.
6. Keep downloads and installations on the participant's computer. Do not
   upload the assigned story or participant files.

Platform-specific setup

Native Windows 11 PowerShell:
- Use git.exe, node.exe, and npm.cmd. Do not invoke npm.ps1 or change the
  execution policy.
- Prefer 64-bit software on x64 Windows and ARM64 software on ARM64 Windows.
- Use a short, user-owned, nonsynchronized local workspace, preferably
  $env:USERPROFILE\StoryVR. Avoid OneDrive, network drives, and deep nesting.
- Clone branch codex/native-windows with:
    git clone --branch codex/native-windows --single-branch https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
- From StoryVR-Editor, run:
    npm.cmd ci
- Python may be exposed as py -3, python3, or python. Always verify it through
  StoryVR's repository launcher:
    node.exe tools/run-python.mjs --version
- An npm-installed Codex CLI may be exposed as codex.cmd, while the standalone
  installer may expose codex.exe. Resolve either one; never change PowerShell
  policy merely to invoke Codex. StoryVR supports both forms.

macOS:
- Use a short, user-owned local workspace, preferably $HOME/StoryVR.
- Clone branch main with:
    git clone --branch main --single-branch https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
- From StoryVR-Editor, run:
    npm ci
- Branch main currently requires the exact python3 command. Verify it with:
    python3 --version

Native Linux or WSL2:
- Use a short, user-owned Linux workspace, preferably $HOME/StoryVR. In WSL,
  keep the checkout under the Linux home directory rather than /mnt/c.
- Clone the portable branch with:
    git clone --branch codex/native-windows --single-branch https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
- From StoryVR-Editor, run:
    npm ci
- Verify Python through the portable launcher:
    node tools/run-python.mjs --version

For every platform:
1. If the chosen workspace already exists, do not overwrite it. Reuse an
   existing checkout only after verifying that its origin is the approved URL,
   it is on the expected branch, and it has no uncommitted changes; otherwise
   create a new sibling workspace with a clear numeric suffix.
2. Keep StoryVR-Editor and the assigned story as sibling folders. Never put the
   story inside the Git repository. On Windows, keep both paths short.
3. Require package-lock.json and use npm ci or npm.cmd ci. Never copy
   node_modules from another computer or operating system. The portable branch
   installs its cross-platform image runtime through npm; macOS main uses the
   operating system's built-in sips. Do not install ImageMagick.
4. Record the absolute repository path, absolute story path, selected branch,
   and exact commit returned by git rev-parse HEAD.

Codex setup
1. Use only the official Codex CLI guidance at
   https://learn.chatgpt.com/docs/auth. On Windows, resolve either codex.exe or
   codex.cmd with `Get-Command codex.exe,codex.cmd -ErrorAction
   SilentlyContinue | Select-Object -First 1`, require one result, and reuse its
   `.Source` path for every Codex command. On other platforms use `codex`.
2. Run the matching `codex login status` command. If sign-in is required, run
   the standard `codex login` command and let the participant complete the
   browser flow with the study-approved account or sign-in method. Use
   `login --device-auth` only if the normal localhost callback cannot work and
   device-code login is enabled for the study-approved account or workspace.
3. Never handle the participant's credentials. If the study-approved login is
   unavailable, report that AI-backed StoryVR features are not ready and do not
   claim full installation success.

Assigned story handling
1. If no assigned story path has been supplied, ask exactly one concise
   question for the facilitator-provided folder or ZIP path.
2. Preserve the supplied folder or ZIP unchanged. Inspect a ZIP before safe
   extraction, reject entries that escape the destination, and prepare a new
   writable participant copy beside StoryVR-Editor. Never overwrite a prior
   participant copy.
3. Resolve and record the actual story root. It must contain a readable
   captures/active directory, and the story root must be writable. If it does
   not, stop and report the missing path; do not invent or fetch a story.
4. Do not launch the assigned story during installation. First launch can
   initialize or migrate study state. The participant will launch it with the
   final command when instructed.

HTTPS and headset boundary
- Core authoring uses http://127.0.0.1:5188/ and does not require OpenSSL, a
  trusted certificate, LAN access, or a firewall change.
- If HTTPS/headset testing is explicitly required, verify `openssl version`,
  keep the computer and headset on the same private network, and use StoryVR's
  --lan HTTPS command only after approval for any firewall prompt. Allow private
  networks only; never disable the firewall.
- A self-signed certificate may be rejected by a managed headset/browser. If
  so, request a facilitator-provided trusted certificate; do not weaken browser
  or operating-system security. Optional headset readiness is separate from a
  successful core installation unless the facilitator says it is required.

Exact verification

Run every applicable check from StoryVR-Editor. Do not claim success unless all
required checks exit successfully.

All platforms:
- git --version succeeds.
- git remote get-url origin exactly identifies the approved repository.
- git branch --show-current equals the selected branch.
- git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' identifies the
  matching origin branch.
- git rev-parse HEAD succeeds; record the commit.
- node --version reports 24.0.0 or newer.
- On the portable branch, StoryVR's Python launcher reports Python 3. On branch
  main, python3 --version reports Python 3.
- The appropriate npm ls --depth=0 command succeeds.
- The appropriate npm run check command succeeds.
- git diff --exit-code -- package.json package-lock.json succeeds.
- git status --short has no unexpected tracked or untracked files.
- The selected current Chromium browser can be found.
- The Codex version and login-status checks succeed.
- The participant story copy contains captures/active and is writable.
- If HTTPS/headset support is required, openssl version also succeeds.

Use these native Windows forms where applicable:
    node.exe --version
    npm.cmd --version
    node.exe tools/run-python.mjs --version
    npm.cmd ls --depth=0
    npm.cmd run check
    npm.cmd run verify:native-runtime
    $CodexCommand = Get-Command codex.exe,codex.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    & $CodexCommand.Source --version
    & $CodexCommand.Source login status

Use these native Linux/WSL portable-branch forms where applicable:
    node --version
    npm --version
    node tools/run-python.mjs --version
    npm ls --depth=0
    npm run check
    npm run verify:native-runtime
    codex --version
    codex login status

Use these macOS main-branch forms where applicable:
    node --version
    npm --version
    python3 --version
    npm ls --depth=0
    npm run check
    codex --version
    codex login status

If a required check fails, do not say StoryVR is ready. Give only the failed
check, the concise cause, and one recommended next action. Do not hide a native
Windows failure by silently switching to WSL.

Successful final response

After all required checks pass, output only the matching short message below,
substituting the real absolute paths. Do not include the setup transcript.

Native Windows PowerShell:

StoryVR is installed and ready.

Run in PowerShell:
Set-Location "<absolute-path-to-StoryVR-Editor>"
npm.cmd run storyvr:author -- --story-folder "<absolute-path-to-assigned-story>"

Open http://127.0.0.1:5188/
Keep this terminal open. Stop StoryVR with Ctrl+C.

macOS, native Linux, or WSL:

StoryVR is installed and ready.

Run:
cd "<absolute-path-to-StoryVR-Editor>"
npm run storyvr:author -- --story-folder "<absolute-path-to-assigned-story>"

Open http://127.0.0.1:5188/
Keep this terminal open. Stop StoryVR with Ctrl+C.
```
