# StoryVR participant installation prompt

Copy the prompt below into Codex on the participant's computer. The assigned
study-story folder or ZIP can be supplied before or during the setup. Codex
installs the StoryVR core and builds the study logger; the final response gives
the facilitator the Chrome steps that must be completed manually.

```text
Act as a cautious local setup agent. Install and validate StoryVR on this
participant's computer. Perform the setup instead of only explaining it.

Approved source and platform channels
- Repository: https://github.com/ISTHATDISTANCE/StoryVR-Editor.git
- Native Windows 11 PowerShell: branch codex/native-windows
- macOS: branch main
- Native Linux: branch codex/native-windows
- Approved macOS revision: 820ef7dfecb43a081936027b5655fe4ec6ced59b
- Approved portable Windows/Linux revision:
  ed6e84ab06e992d7c87d71e5eb19a7850b651ae3
- Never substitute another repository, fork, mirror, branch, or downloaded
  archive unless the study facilitator explicitly supplies it.

Operating-system decision
1. Detect and report the host OS, CPU architecture, active shell, and whether
   the current environment is native Windows, WSL, macOS, or native Linux.
2. On Windows 11, install natively in PowerShell first. WSL is not required.
3. This participant workflow requires the manually loaded Chrome study logger.
   On a Windows host, use native Windows rather than WSL because loading an
   unpacked extension from a WSL/UNC path is not a validated study workflow. If
   native setup is blocked, stop and report the restriction; do not install or
   enable WSL, silently install both versions, or claim full study readiness.
4. If the OS cannot be identified confidently, stop and ask one concise
   question rather than choosing a branch.

Required core software
- Git
- Node.js 24 or newer, with npm
- Python 3
- Google Chrome 114 or newer for the study data-collection extension. Edge or
  another Chromium browser may run core StoryVR, but it does not satisfy this
  study's validated manual extension checklist.
- OpenAI Codex CLI and a study-approved sign-in for StoryVR's AI features
- OpenSSL only when the facilitator requires HTTPS or headset testing

Installation safety
1. Prefer compatible software already installed. Otherwise use an official
   installer or the operating system's normal package manager. Verify the
   package name, publisher, architecture, and version before installing it.
   Before every dependency install, require the manager's trustworthy complete
   dry-run/transaction plan or the installer's complete component plan. Proceed
   only when it is additive: it must not remove, upgrade, replace, repair,
   relink, reassociate, or change any pre-existing package, file, component,
   profile, default application, or system setting. Record the reviewed plan
   and participant approval in the prepared action. If a complete plan is
   unavailable or contains any non-additive change, stop and report that the
   prerequisite must be prepared by the facilitator; do not run the install.
   Never upgrade, replace, repair, or uninstall a pre-existing prerequisite.
   If an incompatible version exists, install a separate user-scoped,
   study-owned version and use its exact path when the platform supports that;
   otherwise stop and report the incompatibility.
   After selecting any prerequisite, record `selectedCommandPath` and invoke
   only that canonical literal executable for every install action, login,
   check, and final launch. Do not fall back to an ambient command name or a
   different PATH entry. Resolve npm from the selected Node installation and
   preserve only a process-local PATH override when one is needed.
2. Ask before any administrator prompt, system-wide installation, persistent
   PATH edit, certificate trust change, firewall change, or Windows feature
   change. Do not install/enable WSL or create a distribution for this study.
   Do not create or modify a background service, login item, scheduled task,
   shell/profile startup file, registry autorun entry, or other autostart
   mechanism for StoryVR or any dependency.
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
7. Automated setup may build and inspect the unpacked study-extension files,
   but it must not open `chrome://extensions`, create/delete a Chrome profile,
   change Developer mode, load/reload/remove an extension, approve an original
   story page, turn on **Data collection**, select a log folder, or start,
   checkpoint, or finalize a collection session. Those are explicit manual
   participant/facilitator actions. Page approval and collection must wait
   until the study's informed-consent procedure is complete.

Study installation record and ownership marker (mandatory)
1. Use a dedicated, newly created study workspace. The workspace path must not
   have existed before this setup, and it must contain both StoryVR-Editor and
   the writable participant story copy as sibling folders. Never reuse an
   existing workspace or checkout, even if it appears compatible; choose a new
   unique path instead.
2. Give this installation a new UUID and choose the final workspace entry path.
   Create that directory in place with an exclusive create operation that fails
   if any entry already exists there; never promote it with an ordinary rename,
   because a rename can overwrite something created after an absence check.
   Immediately record its no-follow identity when a compatible Node executable
   is available. Exclusively write a regular `storyvr-study-bootstrap.json`
   inside it with schema `storyvr-study-bootstrap/v1`, install ID, literal final
   workspace entry path, UID/SID, `workspaceExistedBefore: false`, nullable
   initial workspace identity, ISO-8601 creation time, verified Node pre-state,
   fixed `bootstrapJournalFilename: "storyvr-study-bootstrap.journal.jsonl"`,
   and its genesis hash. Create that append-only journal with a generation-0
   `storyvr-study-bootstrap-journal-entry/v1` record and fsync/hash-verify both.
   Report the exact workspace path as soon as it is created. Never reuse, merge,
   replace, or rename another entry into this workspace.
3. At the workspace root, create these two records plus an append-only journal
   after the read-only inventory but before cloning, copying the story,
   installing any prerequisite other than the clean-machine Node exception,
   changing login state, or making an HTTPS/firewall/trust change:
   - immutable ownership marker: `.storyvr-study-install-marker.json`
   - mutable installation manifest: `storyvr-study-install.json`
   - append-only journal: `storyvr-study-install.journal.jsonl`
   If creation cannot finish, stop without installing anything else. Seed the
   manifest with the read-only pre-state inventory.
   If any of those three bootstrap paths already exists before bootstrap, do
   not overwrite it; choose a different new workspace. After successful
   bootstrap, keep the marker immutable, update only the manifest
   transactionally, and append journal records without rewriting existing
   bytes.
   Clean-machine exception: if no compatible Node.js 24 executable exists, use
   the already sealed provisional bootstrap receipt, obtain approval, and
   append/fsync/hash-verify a bootstrap `node-install-prepared` record containing
   the exact manager/package/scope and verified absence/pre-state before
   installing only Node.js in a user-scoped location. Do not install another
   prerequisite yet. Afterward append a `node-install-result` record containing
   exact before/after paths, version, package-manager receipt, and
   `installedByStudy`; if installation is interrupted before a complete result,
   Node remains KEEP. Invoke that exact new Node executable to read the workspace with
   `fs.lstatSync(path, { bigint: true })`, then create and seal the marker,
   manifest, journal, reservations, and item markers. Import the provisional
   record into journal generation 0 with `preManifestBootstrap: true`, retain
   the bootstrap file as marked evidence, and record Node with
   `installedByStudy: true`. If interrupted before sealing, the uninstall prompt
   may move only the validated provisional metadata workspace to Trash. It may
   offer Node as OPTIONAL REMOVE only when the complete bootstrap result record
   and current package identity/transaction preview satisfy the same shared-tool
   safeguards; otherwise Node and every shared/system component remain KEEP.
   Bootstrap journal records must contain exactly `schema`, `installId`, integer
   `generation`, `previousHash`, `recordType` (`genesis`,
   `node-install-prepared`, or `node-install-result`), `createdAt`, secret-free
   `payload`, and `recordHash`, using the same canonical hash/contiguous-link
   rules as the full journal. The result payload must contain the complete
   package ownership fields and receipt needed for an optional later removal.
4. The ownership marker must be valid JSON with only these stable fields:
   `schema: "storyvr-study-install-marker/v1"`, an `installId` UUID,
   `workspacePath` as the canonical absolute path, `createdByStudy: true`, and
   an ISO-8601 `createdAt`, plus `osUserId` and
   `workspaceFilesystemIdentity`,
   `journalFilename: "storyvr-study-install.journal.jsonl"`, and
   `journalGenesisHash`.
   Record only the numeric UID on
   macOS/Linux/WSL or SID on native Windows, never a username or email. Record
   the workspace directory's no-follow filesystem identity in this exact
   normalized shape on every OS:
   `{ "scheme": "lstat-dev-ino-bigint/v1", "device": "<base-10 integer string>", "inode": "<base-10 integer string>" }`.
   Obtain the integer strings with the selected compatible Node.js 24
   executable and `fs.lstatSync(path, { bigint: true })`; the clean-machine
   exception above establishes Node first when necessary. Never convert
   identities through a floating-point number. If a stable identity cannot be
   read, stop rather than substituting a path or timestamp. The manifest must use
   `schema: "storyvr-study-install/v1"`, contain the same exact `installId`,
   have `workspace.path` equal to the marker's `workspacePath`, and initially
   have `status: "planning"`. The journal must begin with exactly one
   `storyvr-study-install-journal-entry/v1` genesis record containing generation
   0, `recordType: "genesis"`, `actionId: null`, `previousHash: null`, the
   install ID, and payload fields `platform`, `workspacePath`, `osUserId`,
   `workspaceFilesystemIdentity`, `preState`, and boolean
   `preManifestBootstrap`, plus a `recordHash`. Compute each hash from UTF-8 canonical JSON with recursively
   sorted object keys and the `recordHash` field omitted. The marker's genesis
   hash must match that record exactly.
   Every later newline-terminated journal record must use the same schema and
   exact fields: `schema`, `installId`, integer `generation`, `previousHash`,
   `recordType` (`genesis`, `prepared`, `succeeded`, `failed`, or `finalized`), `actionId`
   (null only for genesis/finalized), ISO-8601 `createdAt`, secret-free
   `payload`, and `recordHash`. Generations must increase by exactly one and
   `previousHash` must equal the preceding record hash. Duplicate generations,
   interior/malformed newline-terminated records, hash mismatch, or unknown
   record type invalidates the journal. A read-only recovery may ignore exactly
   one nonempty, non-newline-terminated trailing fragment and use the last fully
   verified record as the head, but installation must not append past or rewrite
   that fragment. Allow `genesis` only at generation 0. Every `prepared` payload
   must contain `targetType`, exact target identifier, `beforeState`, approval,
   and intended action. For an ordinary removable filesystem target it must
   additionally use `targetType: "filesystem-item"` and contain `kind`,
   `itemId`, `reservationPath`, `entryPath`, `stagingEntryPath: null`,
   `parentCanonicalPath`, `existedBefore`, and secret-free `preState`. For the
   study extension's one contained build it must instead use
   `targetType: "contained-output-build"` and contain `kind:
   "storyvr-study-extension"`, the repository's `containerItemId`, canonical
   `buildSourcePath`, canonical unique `buildOutputPath`,
   `existedBefore: false`, and a `beforeState` proving that exact output was
   absent; it has no reservation, child item ID, or child marker. Every
   succeeded/failed payload
   must contain `result`, complete normalized `beforeState` and `afterState`,
   the full secret-free `ownershipDelta`, nullable package receipt/error code,
   and, for ordinary filesystem targets, `itemId`, `createdByStudy`, nullable
   `filesystemIdentity`, and nullable `markerPath`. A contained-output result
   must repeat `targetType`, `kind`, `containerItemId`, `buildSourcePath`, and
   `buildOutputPath`, set `separatelyRemovable: false` and `markerPath: null`,
   and on success contain `buildStatus: "verified"`, `buildMarkerPath`,
   `buildMarkerSha256`, `generatedManifestPath`, `generatedManifestSha256`,
   `generatedStudyConfigPath`, `generatedStudyConfigSha256`, and
   `outputInventorySha256`; on failure those result-only fields may be null and
   the error code must be present. A `finalized` payload must
   contain `status`, a complete secret-free `cleanupSnapshot` containing
   exactly `platform`, `release`, `workspace`, `repository`, `story`,
   `prerequisites`, `codex`, `browser`, `https`, `interactionLogs`,
   `systemChanges`, and `actions`, plus `cleanupSnapshotHash` over that canonical
   JSON. Exclude `journal`, `pendingAction`, record hashes/generations, and
   timestamps so the snapshot is not self-referential; project those
   record-derived fields into the manifest only after the finalized record hash
   exists.
   These exact payloads are the only data eligible for strict recovery.
5. Create `.storyvr-study-item-markers/` at the workspace root as a sidecar
   directory, never inside StoryVR-Editor or the participant story copy. Give
   every study-created filesystem deletion target its own UUID `itemId`,
   reservation named `.storyvr-study-item-markers/<itemId>.reservation.json`,
   and final marker named `.storyvr-study-item-markers/<itemId>.json`. This includes
   StoryVR-Editor, the participant story copy, and every separately created
   certificate, private key, config, shortcut, link, or other local artifact.
   Before creating a target, exclusively create its immutable reservation with
   schema `storyvr-study-item-reservation/v1`, install ID, item ID, action ID,
   kind, intended literal final `entryPath`, `stagingEntryPath: null`,
   canonicalized parent path, `existedBefore: false`, and creation time. After
   the reservation and prepared journal record are durable, create the final
   target itself with an exclusive no-clobber operation: create a directory in
   place with a call that fails on `EEXIST`, create a regular file with
   `O_CREAT|O_EXCL`, or create the requested link/junction with an operation that
   fails if the entry exists. Never use an ordinary rename as the publication
   step. Immediately lstat the new entry without following links and
   exclusively create/fsync its final marker with that identity before adding
   content. Populate a marked directory in place; write a marked file without
   replacing its inode. For a link/junction, creation itself is the complete
   population action. Recheck the no-follow identity after population. Only
   then append a succeeded result and update the manifest. If creation or
   population fails, record failure and leave the exactly marked partial target
   recoverable. Never write into an entry whose exclusive create failed.
   Each final item marker must use schema `storyvr-study-item-marker/v1` and contain
   only `schema`, `installId`, `itemId`, `kind`, `entryPath`,
   `stagingEntryPath: null`, `parentCanonicalPath`, `entryType`, nullable literal `linkTarget`,
   `filesystemIdentity` in the same normalized shape, `createdByStudy: true`,
   and ISO-8601 `createdAt`. Canonicalize the parent without following the final
   path component; never store a link target as the deletion path. Create a marker only after
   verifying that the exact target was absent before setup and was created by
   this installation; also create one for a verified partial target left by a
   failed action. Keep reservations and item markers immutable once written.
   Never create a reservation for a pre-existing path. The workspace
   ownership marker authorizes only the workspace-root record; it is not proof
   that an unmarked child was created by the study.
6. Keep these stable top-level manifest keys: `schema`, `installId`, `status`,
   `platform`, `release`, `workspace`, `repository`, `story`, `prerequisites`,
   `codex`, `browser`, `https`, `interactionLogs`, `systemChanges`, `journal`, `actions`,
   `pendingAction`, `startedAt`, `updatedAt`, and `completedAt`. The manifest is
   the cleanup authority. Use these exact nested names rather than synonyms:
   - `platform`: `environment`, `os`, `architecture`, `shell`, `osUserId`, and
     nullable `wslDistributionId`;
   - `release`: `repositoryUrl`, `branch`, and `revision`;
   - `workspace`: `path`, `canonicalPath`, `filesystemIdentity`,
     `existedBefore`, `createdByStudy`, `bootstrapReceiptPath`, and
     `bootstrapJournalPath`;
   - `repository`: the filesystem-item fields plus `remoteUrl`, `branch`, and
     `revision`;
   - `story`: `original` and `participantCopy`, each using the filesystem-item
     ownership fields, with item/reservation markers only for the copy;
   - `prerequisites`: entries keyed `git`, `node`, `npm`, `python`, `browser`,
     `codex`, and `openssl`, each using the package fields defined below;
   - `codex`: `existedBefore`, `installedByStudy`, `selectedCommandPath`,
     `loginBefore`, `loginAfter`, and `loginChangedByStudy`;
   - `browser`: `product`, `selectedCommandPath`, `existedBefore`,
     `installedByStudy`, `extension`, `profile`, and `developerMode`;
   - `https`: `requested`, `artifacts`, `trustChanges`, and `firewallChanges`;
   - `interactionLogs`: an array of filesystem-item records;
   - `systemChanges`: `pathEntries`, `windowsFeatures`, `trustEntries`,
     `firewallRules`, `shortcuts`, `browserExtensions`, `wslChanges`, and empty
     prohibited-change arrays. `wslChanges` must remain empty because WSL setup
     is prohibited for this study;
   - `journal`: `path`, `generation`, `genesisHash`, and `lastHash`;
   - `actions`: ordered summaries; and `pendingAction`: null or one exact
     prepared action.
   `prerequisites.browser` and `prerequisites.codex` describe software-package
   ownership only; top-level `browser` describes profile/extension state and
   top-level `codex` describes authentication state.
   Store, at minimum:
   - detected OS/environment, architecture, shell, start/update times, and
     status (`planning`, `installing`, `ready`, or `failed`). Under `platform`,
     store the same UID/SID as `osUserId`, but no account name. Under
     `workspace`, store the same filesystem identity as the marker;
   - selected repository URL, release branch, and approved immutable revision;
   - workspace path, repository path, original assigned-story path, and
     participant-copy path. For each, record `existedBefore` and
     `createdByStudy` separately. Every study-created filesystem item entry
     must also record the matching `installId`, `itemId`, `kind`,
     `entryPath`, `stagingEntryPath: null`, `parentCanonicalPath`, `entryType`, nullable `linkTarget`,
     `filesystemIdentity`, absolute `reservationPath`, and
     absolute `markerPath`. The dedicated workspace,
     repository, and participant copy must all record `existedBefore: false`
     and `createdByStudy: true`; the original story must record
     `createdByStudy: false` and must never be a cleanup target. Require the
     original source to resolve outside the dedicated workspace; if it does
     not, select a different new workspace before proceeding;
   - one prerequisite entry for Git, Node.js, npm, Python 3, the selected
     browser, Codex CLI, and optional OpenSSL. Use these exact ownership fields
     for each prerequisite: `existedBefore` and `installedByStudy`; do not use
     `preExisting`, `createdByStudy`, or synonyms for packages. Also record
     resolved command path before/after, version before/after, install scope,
     and, when a package manager was used, its exact manager name, manager
     command path, package identifier, requested version/channel,
     source/publisher, and available receipt or transaction identifier. Use
     null for unavailable fields; do not guess. Record
     `cleanupDefault: "keep"` for every shared/system tool,
     including one installed during this study, because later removal requires
     a separate participant decision;
   - Codex CLI ownership information plus normalized login state before and
     after setup (`signed-in`, `signed-out`, or `unknown`) and a boolean
     `loginChangedByStudy`. Never record an account name, email, organization,
     token, cookie, device code, credential path, or raw login output;
   - whether HTTPS/headset setup was requested. For every generated
     certificate, key, config, or other file, record its exact path,
     `existedBefore`, `createdByStudy`, item-marker identity, and marker path.
     For a certificate, also record its non-secret SHA-256 fingerprint. For
     every trust-store or firewall change, record exact store/rule identifiers,
     pre-existing state, whether the study created it, and the participant
     approval; never store private-key contents;
   - under `systemChanges`, every approved PATH, Windows-feature, trust-store,
     firewall, or comparable change with its exact identifier, before/after
     state, ownership, and approval. Keep service, login-item, scheduled-task,
     shell-profile, and autostart change lists empty because they are
     prohibited;
   - this study's checked-in data-collection extension under
     `browser.extension`, using exactly: `requiredForStudy: true`,
     `installMethod: "manual-load-unpacked"`, `expectedName`,
     `expectedVersion`, `studyConfigId`, canonical `buildSourcePath`,
     `buildOutputPath`, `buildMarkerPath`, `buildMarkerSha256`,
     `generatedManifestPath`, `generatedManifestSha256`,
     `generatedStudyConfigPath`, `generatedStudyConfigSha256`,
     `outputInventorySha256`,
     `buildStatus`, `manualInstallState`, nullable `extensionId`, nullable
     `profileIdentifier`, nullable `profilePath`, nullable `existedBefore`,
     nullable `installedByStudy`, and
     `cleanupMethod: "manual-browser-ui"`. A successful build proves only the
     source artifact: finish automated setup with `buildStatus: "verified"`,
     `manualInstallState: "pending"`, and the runtime identity/ownership fields
     null. Do not add it to `systemChanges.browserExtensions` or claim it was
     loaded. The build output is inside the already marked repository and is
     removed only with that repository; it is not a separate deletion target;
   - under `browser.profile`, record only the selected browser product and the
     automated pre-state. Set `manualCreationState: "pending"`,
     `automaticDeletionAllowed: false`, and `cleanupDefault: "keep"`; do not
     create an item marker or claim a dedicated profile exists during automated
     setup. Under `browser.developerMode`, record automated pre-state as
     `unknown`, `changedByStudy: false`, and `cleanupDefault: "keep"`. The
     facilitator records the manually selected profile path, extension ID, and
     prior Developer-mode state with the cleanup record after loading. Never
     record browser history, cookies, account details, or other profile
     contents;
   - each participant-approved interaction-log destination as an exact
     literal entry path plus canonicalized parent, ownership facts, and
     item-marker identity when the study
     created it. Do not invent, scan for, or record a log destination that the
     participant did not explicitly select;
   - under `journal`, the fixed path, current generation, genesis hash, and last
     record hash; plus an ordered action summary and a single `pendingAction`.
7. Treat a prerequisite as study-created only when it was absent in the
   initial inventory and this setup successfully installed that exact package.
   A version found through a different PATH entry after setup does not prove
   ownership. Never mark a pre-existing program, login, certificate, trust
   entry, firewall rule, workspace, repository, or story as study-created.
   Never use an in-place upgrade of pre-existing software as a study install.
8. Update the journal and manifest around every state-changing action,
   including package installation, PATH or Windows-feature changes, cloning,
   `npm ci`, study-extension building, story copying/extraction, Codex sign-in,
   certificate creation or trust, and firewall changes. Before the action, create any required immutable
   reservation, append and fsync/hash-verify a `prepared` journal record with a
   unique action ID, exact intended target/command, captured pre-state, approval
   if required, and start time, and only then atomically project that record into
   manifest `pendingAction`. The study-extension build is the explicit
   `contained-output-build` exception defined in its section: use its verified
   absent-before/hashes-after journal contract and no child marker. For every
   other filesystem action, perform the exclusive
   entry create, immutable marker write, in-place population, and identity
   recheck described in step 5; only after that sequence inspect the result.
   Then append and fsync/hash-verify a succeeded/failed journal entry containing
   the complete secret-free before/after ownership delta, and only then update
   the manifest ownership record/head, link the already-created immutable item
   marker, and clear `pendingAction`. For a non-filesystem action, inspect the
   result before appending its result record. The journal is authoritative and the manifest is its
   derived current projection. If an action fails or is interrupted,
   preserve it as pending/failed and do not infer success. On resumption, replay
   the journal read-only, verify its complete generation/hash chain against the
   immutable genesis hash, and reconcile only that exact pending action. If a
   reserved target now exists without its final marker, do not adopt, populate,
   or delete it: record the ambiguity and KEEP it. If its matching immutable
   marker exists, inspect it without following links and reconcile only when a
   fresh identity read exactly matches; never broaden the intended path.
9. For each manifest update, serialize valid JSON to a unique temporary file in
   the same directory, re-read and validate its schema/UUID, then replace the
   manifest with a same-filesystem atomic rename. Revalidate that its
   `installId` still matches the immutable marker after replacement. Never edit
   it partially or place credentials in the manifest, marker, journal,
   commands, or error text. Restrict the marker, manifest, journal, bootstrap
   evidence, reservation files, and item markers to the participant account
   where the OS supports user-only permissions.
10. Keep status `installing` while performing operational checks. If an
   operational check fails, append a `finalized` journal record whose payload
   status is `failed`, then atomically set the manifest to `failed` with that
   journal head, retain unresolved evidence, and stop. If all operational checks
   succeed, append and verify a `finalized` record whose payload status is
   `ready`, then atomically set the manifest to `ready`, its journal generation/
   last hash to that final record, and its completion time. Perform the final
   record-integrity checks listed below afterward. Always retain and report the
   absolute manifest path so a later uninstall can preserve pre-existing
   software and data.

Platform-specific setup

In every command below, invoke the previously recorded exact executable paths
for Git, Node, npm, Python, and Codex. The short command names illustrate
arguments only and never override `selectedCommandPath`. Render every real path
with the shell-native single-quote escaping rules in Successful final response;
the angle-bracket tokens below are labels, not text to execute.

Native Windows 11 PowerShell:
- Use git.exe, node.exe, and npm.cmd. Do not invoke npm.ps1 or change the
  execution policy.
- Prefer 64-bit software on x64 Windows and ARM64 software on ARM64 Windows.
- Before bootstrap, select a short, user-owned, nonsynchronized workspace path,
  preferably $env:USERPROFILE\StoryVR-Study-<short-installId>. Avoid
  OneDrive, network drives, and deep nesting.
- Clone branch codex/native-windows with:
    git clone --branch codex/native-windows --single-branch https://github.com/ISTHATDISTANCE/StoryVR-Editor.git '<PowerShell-literal-absolute-marked-empty-StoryVR-Editor-entryPath>'
- Before running any project script, enter StoryVR-Editor and pin the approved
  portable revision:
    git checkout --detach ed6e84ab06e992d7c87d71e5eb19a7850b651ae3
- From StoryVR-Editor, run:
    npm.cmd ci
- Python may be exposed as py -3, python3, or python. Always verify it through
  StoryVR's repository launcher:
    node.exe tools/run-python.mjs --version
- An npm-installed Codex CLI may be exposed as codex.cmd, while the standalone
  installer may expose codex.exe. Resolve either one; never change PowerShell
  policy merely to invoke Codex. StoryVR supports both forms.

macOS:
- Before bootstrap, select a short, user-owned workspace path, preferably
  $HOME/StoryVR-Study-<short-installId>.
- Clone branch main with:
    git clone --branch main --single-branch https://github.com/ISTHATDISTANCE/StoryVR-Editor.git '<POSIX-literal-absolute-marked-empty-StoryVR-Editor-entryPath>'
- Before running any project script, enter StoryVR-Editor and pin the approved
  macOS revision:
    git checkout --detach 820ef7dfecb43a081936027b5655fe4ec6ced59b
- From StoryVR-Editor, run:
    npm ci
- Branch main currently requires the exact python3 command. Verify it with:
    python3 --version

Native Linux:
- Before bootstrap, select a short, user-owned Linux workspace path, preferably
  $HOME/StoryVR-Study-<short-installId>.
- Clone the portable branch with:
    git clone --branch codex/native-windows --single-branch https://github.com/ISTHATDISTANCE/StoryVR-Editor.git '<POSIX-literal-absolute-marked-empty-StoryVR-Editor-entryPath>'
- Before running any project script, enter StoryVR-Editor and pin the approved
  portable revision:
    git checkout --detach ed6e84ab06e992d7c87d71e5eb19a7850b651ae3
- From StoryVR-Editor, run:
    npm ci
- Verify Python through the portable launcher:
    node tools/run-python.mjs --version

For every platform:
1. Before bootstrap, require the chosen final workspace path not to exist. If
   it exists, do not inspect, modify, or reuse it; select another unique path.
   After bootstrap, use only the workspace recorded by the bootstrap receipt
   and require its fresh no-follow identity to match every sealed record before
   adding any target.
2. Keep StoryVR-Editor and the assigned story as sibling folders. Never put the
   story inside the Git repository. On Windows, keep both paths short.
3. Each clone command's destination is the already reserved, exclusively
   created, identity-marked, empty StoryVR-Editor directory. Git may populate
   that directory, but no command may delete, recreate, replace, or rename it.
4. Require package-lock.json and use npm ci or npm.cmd ci. Never copy
   node_modules from another computer or operating system. The portable branch
   installs its cross-platform image runtime through npm; macOS main uses the
   operating system's built-in sips. Do not install ImageMagick.
5. Before `npm ci`, require `git rev-parse HEAD` to equal the approved revision
   for the detected OS exactly. Stop on any mismatch. Record the absolute
   repository path, absolute story path, selected release channel, and commit.

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
   Before any sign-in attempt, atomically record only the normalized login
   state and set the sign-in as the pending action. Afterward, query status
   again and record the normalized result and whether this setup changed it.
3. Never handle the participant's credentials. If the study-approved login is
   unavailable, report that AI-backed StoryVR features are not ready and do not
   claim full installation success. Never sign out an account during setup.

Assigned story handling
1. If no assigned story path has been supplied, ask exactly one concise
   question for the facilitator-provided folder or ZIP path.
2. Preserve the supplied folder or ZIP unchanged. Inspect a ZIP before safe
   extraction, reject entries that escape the destination, and prepare a new
   writable participant copy inside the dedicated workspace and beside
   StoryVR-Editor. Never overwrite a prior participant copy. Record the source
   and destination ownership facts before copying and verify them afterward.
3. Resolve and record the actual story root. It must contain a readable
   captures/active directory, and the story root must be writable. If it does
   not, stop and report the missing path; do not invent or fetch a story.
4. Do not launch the assigned story during installation. First launch can
   initialize or migrate study state. The participant will launch it with the
   final command when instructed.

Study data-collection extension
1. Build the checked-in extension after `npm ci` but before final readiness.
   Derive one unique output path from this installation ID:
   `tools/storyvr-study-extension/builds/participant-<installId>/`. Require that
   exact path not to exist. If it exists, do not replace, merge, reload, or
   adopt it; stop and report the unexpected path. Do not use the shared default
   `unpacked/` output and do not edit `study-config.json` during participant
   setup.
2. With the selected Node directory prepended only to this process's PATH, run
   the exact selected npm executable:

   Native Windows PowerShell:
       & '<PowerShell-literal-absolute-path-to-selected-npm.cmd>' run storyvr:study-extension -- --out '<PowerShell-literal-absolute-unique-extension-buildOutputPath>'

   macOS or native Linux:
       '<POSIX-literal-absolute-path-to-selected-npm>' run storyvr:study-extension -- --out '<POSIX-literal-absolute-unique-extension-buildOutputPath>'

   Require exit code 0. Require the build report to identify the expected
   OS-native relative output path, two approved controller pages, and explicit
   current-tab authorization for original-story access.
3. Verify the generated output statically without opening Chrome. Require a
   real, no-symlink directory at the exact expected path; a regular
   `.storyvr-study-extension-output` containing
   `Generated by tools/storyvr-study-extension/build.mjs.`; and a valid
   Manifest V3 `manifest.json` whose name is
   `StoryVR Study Logger - StoryVR original-story study`, version is `0.3.0`,
   minimum Chrome version is `114`, and permissions are exactly `storage`,
   `activeTab`, and `scripting`. Require controller matches for
   `http://127.0.0.1:5188/*` and `http://localhost:5188/*`.
4. Require generated `study-config.json` to use
   `storyvr-study-extension-config/v2`, study config ID
   `storyvr-consented-original-pages-v1`, and only the two checked-in loopback
   controller origins. Verify every copied source file is byte-identical to its
   counterpart under `tools/storyvr-study-extension/src/`, no output entry is
   a symlink/reparse point, and no unexpected entry exists. Record SHA-256
   hashes for the output marker, generated manifest, generated configuration,
   and a sorted relative-path/type/file-hash inventory.
5. Mark only the build as verified. Chrome generates the unpacked extension ID
   when the facilitator loads it, so leave extension ID, profile identity,
   prior browser state, and installation ownership null and manual setup
   pending. Do not start a collection session as an installation smoke test.
6. Journal this as a typed `contained-output-build` action rather than a
   separately removable filesystem target. Its prepared payload must prove the
   exact unique output path was absent; its succeeded payload must contain the
   canonical output path and all verified hashes/inventory above. Do not create
   a child item marker: the output is contained by the already identity-marked
   repository and is removed only with that repository. If the build fails,
   record the failure and keep the repository/output for diagnosis; never
   rerun into or delete an unexplained existing output.

HTTPS and headset boundary
- Core authoring uses http://127.0.0.1:5188/ and does not require OpenSSL, a
  trusted certificate, LAN access, or a firewall change.
- If HTTPS/headset testing is explicitly required, verify `openssl version`,
  keep the computer and headset on the same private network, and use StoryVR's
  --lan HTTPS command only after approval for any firewall prompt. Allow private
  networks only; never disable the firewall. Create study certificates and keys
  only at new paths inside the dedicated workspace. Record every exact path and
  external trust/firewall identifier transactionally in the manifest.
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
- git rev-parse HEAD exactly equals the approved immutable revision for the
  detected OS.
- git branch -r --contains HEAD includes the expected origin release branch.
- node --version reports 24.0.0 or newer.
- On the portable branch, StoryVR's Python launcher reports Python 3. On branch
  main, python3 --version reports Python 3.
- The appropriate npm ls --depth=0 command succeeds.
- The appropriate npm run check command succeeds.
- git diff --exit-code -- package.json package-lock.json succeeds.
- git status --short has no unexpected tracked or untracked files.
- Google Chrome reports version 114 or newer. Do not substitute Edge or another
  Chromium browser for this study's extension-required setup.
- The Codex version and login-status checks succeed.
- The participant story copy contains captures/active and is writable.
- `npm run storyvr:study-extension` (or `npm.cmd` on Windows) succeeded and the
  complete static extension-artifact verification above passed.
- The manifest truthfully records the extension build as verified and the
  Chrome load as manual/pending; it does not contain an invented extension ID,
  profile path, prior browser state, or installation-ownership claim.
- If HTTPS/headset support is required, openssl version also succeeds.

After those operational checks succeed, perform the finalized-ready journal/
manifest sequence in step 10. Then run these final record-integrity checks:

- The workspace did not pre-exist; both `storyvr-study-install.json` and
  `.storyvr-study-install-marker.json` exist at its root, parse as valid JSON,
  use the required schemas, have identical `installId` and canonical workspace
  path, UID/SID, and filesystem-identity values, and contain no credential
  material.
- The bootstrap receipt/journal parse and verify, name the actual final
  workspace entry, and any Node result is field-equivalent
  to the imported genesis pre-state/package record.
- The manifest status is `ready`, has no `pendingAction`, and every performed
  change has a completed journal entry and ownership classification based on
  verified before/after state.
- The fixed journal file exists, every line parses, generations are contiguous,
  every previous/record hash verifies back to the immutable genesis hash, its
  final `finalized` record says `ready`, and the manifest's journal generation
  and last hash equal the verified journal head. The finalized cleanup snapshot
  hash verifies and the snapshot is field-equivalent to the manifest projection
  over the exact non-record-derived fields listed in the finalized payload
  contract.
- Every study-created filesystem removal target has one regular-file sidecar
  marker whose schema, install ID, item ID, kind, literal entry path,
  canonicalized parent, entry type, and link target match the manifest and
  actual target without following the final component, and whose normalized
  filesystem identity matches a fresh no-follow identity read.
- The verified final cleanup snapshot contains the extension build hashes and
  `manualInstallState: "pending"`, while `systemChanges.browserExtensions`
  remains empty. Core status may be `ready`; study data collection is not ready
  until the facilitator completes the manual Chrome checklist below.

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

Use these native Linux portable-branch forms where applicable:
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

If an operational check fails, follow the finalized-failed sequence in step 10.
If a final record-integrity check fails after a finalized-ready record, and the
journal remains valid/appendable, append and verify a new `finalized` record
whose payload status is `failed`, then atomically update the manifest to
`failed` and the new journal head. If the journal itself is invalid or cannot be
appended safely, do not alter it or claim readiness; preserve all evidence for
facilitator review. Never change only the manifest status while leaving a
finalized-ready journal head. Give only the failed check, concise cause, one
recommended next action, and absolute manifest path. Do not hide a native
Windows failure by silently switching to WSL.

Successful final response

After all required checks pass, output only the matching message below,
substituting the real absolute paths and real install ID. Only the three fields
explicitly labeled for the facilitator to fill may remain incomplete. Render every path as a shell-native
literal: for PowerShell use single quotes and double any embedded single quote;
for POSIX shells use single quotes and encode an embedded single quote with the
standard `'"'"'` sequence. Never place a participant path in a double-quoted
shell string. Derive the selected Node directory from the recorded absolute
Node executable and prepend it only to the launch process's PATH so npm's
`/usr/bin/env node` launcher and child scripts cannot select another Node.
Do not include the setup transcript.

Native Windows PowerShell:

StoryVR core is installed and ready. The study logger build is verified; one manual Chrome step remains before study data collection.

Run in PowerShell:
Set-Location -LiteralPath '<PowerShell-literal-absolute-path-to-StoryVR-Editor>'
$env:PATH = '<PowerShell-literal-absolute-selected-Node-directory>;' + $env:PATH
& '<PowerShell-literal-absolute-path-to-selected-npm.cmd>' run storyvr:author -- --story-folder '<PowerShell-literal-absolute-path-to-assigned-story>'

Keep this terminal open. Open http://127.0.0.1:5188/ only in the dedicated study Chrome profile during step 6 below. After any collection session, never stop the terminal or close StoryVR/Chrome until Data collection is Off, StoryVR says Saved, the logger popup confirms the file was finalized, and the exact complete JSON is preserved. At other times, stop StoryVR with Ctrl+C.
Cleanup record: "<absolute-path-to-storyvr-study-install.json>"

Study logger — facilitator completes this manually:
1. Create and open a new dedicated local Google Chrome study profile. Do not sign in or enable browser sync. If a same-purpose profile or the StoryVR logger already exists, stop and ask the facilitator; do not reuse or replace it.
2. Open chrome://extensions. Record whether Developer mode was already on, then enable it.
3. Select Load unpacked and choose:
   "<absolute-unique-extension-buildOutputPath>"
4. Confirm the displayed name is "StoryVR Study Logger - StoryVR original-story study" and the version is 0.3.0.
5. Record the displayed 32-character extension ID and the Profile Path from chrome://version. Do not edit the cleanup JSON by hand.
6. In this same study profile, open http://127.0.0.1:5188/. If a StoryVR tab was already open in this profile, reload it once.
7. On that StoryVR tab, open the logger popup. Require CURRENT TAB to say "StoryVR controller" and DATA COLLECTION to say "Collection is off". Do not approve any story page and do not turn collection on.
8. Copy the handoff block below into the participant's facilitator study notes and fill its three manual fields.

Leave Data collection OFF. Do not approve an original-story page or choose a log folder until consent is complete and the facilitator begins the session.
When steps 1–8 pass, the manual logger setup is complete; Data collection remains not started.
Manual cleanup handoff — copy to facilitator study notes:
Install ID: <installId>
Extension ID: <facilitator fills after loading>
Chrome Profile Path: <facilitator fills from chrome://version>
Developer mode before setup: <facilitator records enabled or disabled>

macOS or native Linux:

StoryVR core is installed and ready. The study logger build is verified; one manual Chrome step remains before study data collection.

Run:
cd -- '<POSIX-literal-absolute-path-to-StoryVR-Editor>'
PATH='<POSIX-literal-absolute-selected-Node-directory>':"$PATH" '<POSIX-literal-absolute-path-to-selected-npm>' run storyvr:author -- --story-folder '<POSIX-literal-absolute-path-to-assigned-story>'

Keep this terminal open. Open http://127.0.0.1:5188/ only in the dedicated study Chrome profile during step 6 below. After any collection session, never stop the terminal or close StoryVR/Chrome until Data collection is Off, StoryVR says Saved, the logger popup confirms the file was finalized, and the exact complete JSON is preserved. At other times, stop StoryVR with Ctrl+C.
Cleanup record: "<absolute-path-to-storyvr-study-install.json>"

Study logger — facilitator completes this manually:
1. Create and open a new dedicated local Google Chrome study profile. Do not sign in or enable browser sync. If a same-purpose profile or the StoryVR logger already exists, stop and ask the facilitator; do not reuse or replace it.
2. Open chrome://extensions. Record whether Developer mode was already on, then enable it.
3. Select Load unpacked and choose:
   "<absolute-unique-extension-buildOutputPath>"
4. Confirm the displayed name is "StoryVR Study Logger - StoryVR original-story study" and the version is 0.3.0.
5. Record the displayed 32-character extension ID and the Profile Path from chrome://version. Do not edit the cleanup JSON by hand.
6. In this same study profile, open http://127.0.0.1:5188/. If a StoryVR tab was already open in this profile, reload it once.
7. On that StoryVR tab, open the logger popup. Require CURRENT TAB to say "StoryVR controller" and DATA COLLECTION to say "Collection is off". Do not approve any story page and do not turn collection on.
8. Copy the handoff block below into the participant's facilitator study notes and fill its three manual fields.

Leave Data collection OFF. Do not approve an original-story page or choose a log folder until consent is complete and the facilitator begins the session.
When steps 1–8 pass, the manual logger setup is complete; Data collection remains not started.
Manual cleanup handoff — copy to facilitator study notes:
Install ID: <installId>
Extension ID: <facilitator fills after loading>
Chrome Profile Path: <facilitator fills from chrome://version>
Developer mode before setup: <facilitator records enabled or disabled>
```
