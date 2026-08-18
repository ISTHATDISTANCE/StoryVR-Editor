import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_CHECKPOINTS = 128;

export function createAuthorArtifactSignatureReader({ paths, environmentAssetRoot } = {}) {
  if (!paths?.storyFolder || !paths?.analysisRoot) throw new TypeError("StoryVR author signatures require resolved author paths.");
  const storyFolder = path.resolve(paths.storyFolder);
  const assetRoot = path.resolve(environmentAssetRoot || path.join(storyFolder, "webxr-adaptation", "public", "environment-enhancement"));
  assertInside(storyFolder, assetRoot, "environmentAssetRoot");
  const digestCache = new Map();
  return async () => checkpointSignature(await collectAuthorArtifacts(paths, assetRoot, digestCache));
}

export function createStoryBuildInputSignatureReader({
  paths,
  environmentAssetRoot,
  repositoryRoot,
  referenceStoryFolder,
} = {}) {
  if (!paths?.storyFolder || !paths?.analysisRoot || !paths?.resourceFolder) {
    throw new TypeError("StoryVR build signatures require resolved author paths.");
  }
  const storyFolder = path.resolve(paths.storyFolder);
  const resourceFolder = path.resolve(paths.resourceFolder);
  const readerSource = path.join(storyFolder, "webxr-adaptation");
  const assetRoot = path.resolve(
    environmentAssetRoot || path.join(readerSource, "public", "environment-enhancement"),
  );
  const resolvedRepositoryRoot = repositoryRoot ? path.resolve(repositoryRoot) : null;
  const resolvedReferenceStoryFolder = path.resolve(referenceStoryFolder || storyFolder);
  assertInside(storyFolder, resourceFolder, "resourceFolder");
  assertInside(storyFolder, assetRoot, "environmentAssetRoot");
  const digestCache = new Map();
  return async () => storyBuildInputSignature(await collectStoryBuildInputArtifacts({
    paths,
    storyFolder,
    resourceFolder,
    readerSource,
    assetRoot,
    repositoryRoot: resolvedRepositoryRoot,
    referenceStoryFolder: resolvedReferenceStoryFolder,
    digestCache,
  }));
}

export function createHistoryCheckpointStore({
  paths,
  environmentAssetRoot,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  maxCheckpoints = DEFAULT_MAX_CHECKPOINTS,
} = {}) {
  if (!paths?.storyFolder || !paths?.analysisRoot) throw new TypeError("StoryVR history requires resolved author paths.");
  const storyFolder = path.resolve(paths.storyFolder);
  const assetRoot = path.resolve(environmentAssetRoot || path.join(storyFolder, "webxr-adaptation", "public", "environment-enhancement"));
  assertInside(storyFolder, assetRoot, "environmentAssetRoot");

  const sessions = new Map();
  let historyRootPromise = null;
  const historyRoot = async () => {
    if (!historyRootPromise) historyRootPromise = mkdtemp(path.join(os.tmpdir(), "storyvr-history-"));
    return historyRootPromise;
  };

  async function createSession() {
    await sweepExpiredSessions();
    const id = randomUUID();
    const root = path.join(await historyRoot(), id);
    const checkpointsRoot = path.join(root, "checkpoints");
    const blobsRoot = path.join(root, "blobs");
    await Promise.all([
      mkdir(checkpointsRoot, { recursive: true }),
      mkdir(blobsRoot, { recursive: true }),
    ]);
    const session = {
      id,
      root,
      checkpointsRoot,
      blobsRoot,
      createdAt: Date.now(),
      touchedAt: Date.now(),
      checkpoints: new Map(),
      signatureToId: new Map(),
      digestCache: new Map(),
    };
    sessions.set(id, session);
    const checkpoint = await captureCheckpoint(id);
    return { sessionId: id, ...checkpoint };
  }

  async function captureCheckpoint(sessionId) {
    const session = requireSession(sessionId);
    session.touchedAt = Date.now();
    const manifest = await collectAuthorArtifacts(paths, assetRoot, session.digestCache);
    const signature = checkpointSignature(manifest);
    const existingId = session.signatureToId.get(signature);
    if (existingId && session.checkpoints.has(existingId)) {
      return {
        checkpointId: existingId,
        signature,
        deduplicated: true,
        capturedFileCount: manifest.length,
        storedBlobCount: 0,
      };
    }
    if (session.checkpoints.size >= maxCheckpoints) {
      throw historyError(409, `This StoryVR history session reached its ${maxCheckpoints}-checkpoint limit. Reload the author workspace to start a new session.`);
    }

    const checkpointId = randomUUID();
    const checkpointRoot = path.join(session.checkpointsRoot, checkpointId);
    let storedBlobCount = 0;
    for (const entry of manifest) {
      if (await ensureContentBlob(session, entry)) storedBlobCount += 1;
    }
    await mkdir(checkpointRoot, { recursive: true });
    const checkpoint = {
      id: checkpointId,
      root: checkpointRoot,
      signature,
      manifest: manifest.map(({ relativePath, kind, size, digest }) => ({ relativePath, kind, size, digest })),
      createdAt: Date.now(),
    };
    try {
      await writeFile(path.join(checkpointRoot, "manifest.json"), `${JSON.stringify({
        schemaVersion: "storyvr-history-checkpoint/v2",
        signature,
        files: checkpoint.manifest,
      }, null, 2)}\n`);
    } catch (error) {
      await rm(checkpointRoot, { recursive: true, force: true });
      throw error;
    }
    session.checkpoints.set(checkpointId, checkpoint);
    session.signatureToId.set(signature, checkpointId);
    return {
      checkpointId,
      signature,
      deduplicated: false,
      capturedFileCount: manifest.length,
      storedBlobCount,
    };
  }

  async function restoreCheckpoint(sessionId, checkpointId) {
    const session = requireSession(sessionId);
    const checkpoint = session.checkpoints.get(String(checkpointId || ""));
    if (!checkpoint) throw historyError(404, "StoryVR history checkpoint was not found in this browser session.");
    session.touchedAt = Date.now();

    const rollbackCheckpoint = await captureRestoreRollbackCheckpoint(session);
    try {
      const applied = await applyCheckpoint(paths, assetRoot, checkpoint, session);
      return {
        checkpointId: checkpoint.id,
        signature: checkpoint.signature,
        restored: true,
        ...applied,
      };
    } catch (error) {
      await applyCheckpoint(paths, assetRoot, rollbackCheckpoint, session).catch(() => {});
      throw error;
    }
  }

  async function captureRestoreRollbackCheckpoint(session) {
    if (session.checkpoints.size < maxCheckpoints) {
      const rollback = await captureCheckpoint(session.id);
      return session.checkpoints.get(rollback.checkpointId);
    }

    // A full session cannot register another checkpoint, but restore still
    // needs an exact snapshot in case applying the requested target fails.
    session.touchedAt = Date.now();
    const manifest = await collectAuthorArtifacts(paths, assetRoot, session.digestCache);
    for (const entry of manifest) await ensureContentBlob(session, entry);
    return {
      id: null,
      root: null,
      signature: checkpointSignature(manifest),
      manifest: manifest.map(({ relativePath, kind, size, digest }) => ({ relativePath, kind, size, digest })),
      createdAt: Date.now(),
    };
  }

  async function deleteSession(sessionId) {
    const session = sessions.get(String(sessionId || ""));
    if (!session) return false;
    sessions.delete(session.id);
    await rm(session.root, { recursive: true, force: true });
    return true;
  }

  async function sweepExpiredSessions(now = Date.now()) {
    const expired = [...sessions.values()].filter((session) => now - session.touchedAt >= sessionTtlMs);
    await Promise.all(expired.map((session) => deleteSession(session.id)));
  }

  async function dispose() {
    sessions.clear();
    if (!historyRootPromise) return;
    const root = await historyRootPromise.catch(() => null);
    if (root) await rm(root, { recursive: true, force: true });
  }

  return {
    createSession,
    captureCheckpoint,
    restoreCheckpoint,
    deleteSession,
    sweepExpiredSessions,
    dispose,
  };

  function requireSession(sessionId) {
    const session = sessions.get(String(sessionId || ""));
    if (!session) throw historyError(404, "StoryVR history session was not found. Reload the author workspace to start a new session.");
    return session;
  }
}

async function collectAuthorArtifacts(paths, assetRoot, digestCache = new Map()) {
  const entries = [];
  const staticFiles = [
    paths.storyGraphPath,
    paths.sourceMotionOverridesPath,
    paths.sourceMotionPlaybackPath,
    paths.proceduralDynamicsPath,
    path.join(paths.analysisRoot, "environment-enhancement.json"),
  ].filter(Boolean);
  for (const filePath of staticFiles) {
    await addFileIfPresent(entries, paths.storyFolder, filePath, "author-json", digestCache);
  }
  await addJsonDirectory(entries, paths.storyFolder, paths.proposalsRoot, digestCache);
  await addJsonDirectory(entries, paths.storyFolder, paths.decisionsRoot, digestCache);
  await walkFiles(assetRoot, async (filePath) => {
    await addFileIfPresent(entries, paths.storyFolder, filePath, "environment-asset", digestCache);
  });
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectStoryBuildInputArtifacts({
  paths,
  storyFolder,
  resourceFolder,
  readerSource,
  assetRoot,
  repositoryRoot,
  referenceStoryFolder,
  digestCache,
}) {
  const entries = [];
  const staticFiles = [
    paths.projectPath,
    paths.storyGraphPath,
    paths.sourceMotionOverridesPath,
    paths.sourceMotionPlaybackPath,
    paths.proceduralDynamicsPath,
    path.join(paths.analysisRoot, "environment-enhancement.json"),
  ].filter(Boolean);
  for (const filePath of staticFiles) {
    await addFileIfPresent(entries, storyFolder, filePath, "build-author-json", digestCache);
  }
  await addJsonDirectory(entries, storyFolder, paths.decisionsRoot, digestCache);
  const localAnimationProbeRoot = path.join(storyFolder, "analysis", "animation-logic-probe");
  await walkNamedFiles(
    localAnimationProbeRoot,
    new Set(["codex-animation-judgment.json", "animation-evidence.json"]),
    3,
    async (filePath) => {
      await addFileIfPresent(entries, storyFolder, filePath, "build-animation-probe", digestCache);
    },
  );
  if (repositoryRoot) {
    const referencedProbeFiles = await storyGraphAnimationProbeFiles(paths.storyGraphPath, repositoryRoot);
    for (const filePath of referencedProbeFiles) {
      // Story-local probe artifacts were already collected from
      // analysis/animation-logic-probe above. Sibling-story layouts encode
      // those paths relative to the repository root (for example
      // ../classroom/...), so do not reclassify them as repository externals.
      if (pathIsInside(referenceStoryFolder, filePath)) continue;
      await addExternalFileIfPresent(
        entries,
        repositoryRoot,
        filePath,
        "build-animation-probe-fallback",
        digestCache,
      );
    }
  }
  await walkStoryBuildInputFiles(resourceFolder, async (filePath) => {
    await addFileIfPresent(entries, storyFolder, filePath, "build-resource", digestCache);
  });
  await walkStoryBuildInputFiles(readerSource, async (filePath) => {
    await addFileIfPresent(entries, storyFolder, filePath, "build-reader-source", digestCache);
  }, { readerSource: true });
  if (!assetRoot.startsWith(`${path.resolve(readerSource)}${path.sep}`)) {
    await walkStoryBuildInputFiles(assetRoot, async (filePath) => {
      await addFileIfPresent(entries, storyFolder, filePath, "build-environment-asset", digestCache);
    });
  }
  const unique = new Map(entries.map((entry) => [entry.relativePath, entry]));
  return [...unique.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function storyGraphAnimationProbeFiles(storyGraphPath, repositoryRoot) {
  let graph;
  try {
    graph = JSON.parse(await readFile(storyGraphPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
  const judgments = new Set();
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (
        (key === "artifactPath" || key === "path")
        && value.split(/[\\/]/).at(-1) === "codex-animation-judgment.json"
      ) {
        judgments.add(path.isAbsolute(value) ? path.resolve(value) : path.resolve(repositoryRoot, value));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    }
  };
  visit(graph);
  return [...judgments].flatMap((judgmentPath) => [
    judgmentPath,
    path.join(path.dirname(judgmentPath), "animation-evidence.json"),
  ]);
}

async function walkNamedFiles(directory, names, maxDepth, visitor, depth = 0) {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === ".storyvr-build-fallback") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && names.has(entry.name)) await visitor(entryPath);
    else if (entry.isDirectory()) await walkNamedFiles(entryPath, names, maxDepth, visitor, depth + 1);
  }
}

async function addExternalFileIfPresent(entries, root, filePath, kind, digestCache) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!metadata.isFile()) return;
  const absolutePath = path.resolve(filePath);
  assertInside(root, absolutePath, "StoryVR repository build artifact");
  const relativePath = `@repository/${toPosix(path.relative(root, absolutePath))}`;
  const digest = await digestForFile(absolutePath, metadata, digestCache);
  entries.push({ absolutePath, relativePath, kind, size: metadata.size, digest });
}

async function walkStoryBuildInputFiles(directory, visitor, options = {}, root = directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === ".DS_Store" || entry.name.startsWith(".generation-") || entry.name.startsWith(".backup-")) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    const relativePath = toPosix(path.relative(root, entryPath));
    if (
      options.readerSource
      && (
        relativePath === "data/story-instance.json"
        || relativePath.startsWith(".storyvr-template-backups/")
        || relativePath.startsWith(".storyvr-template-updates/")
      )
    ) continue;
    if (entry.isDirectory()) await walkStoryBuildInputFiles(entryPath, visitor, options, root);
    else if (entry.isFile()) await visitor(entryPath);
  }
}

async function addJsonDirectory(entries, storyFolder, directory, digestCache) {
  let names;
  try {
    names = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of names) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await addFileIfPresent(entries, storyFolder, path.join(directory, entry.name), "author-json", digestCache);
    }
  }
}

async function addFileIfPresent(entries, storyFolder, filePath, kind, digestCache) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!metadata.isFile()) return;
  const absolutePath = path.resolve(filePath);
  assertInside(storyFolder, absolutePath, "history artifact");
  const relativePath = toPosix(path.relative(storyFolder, absolutePath));
  const digest = await digestForFile(absolutePath, metadata, digestCache);
  entries.push({ absolutePath, relativePath, kind, size: metadata.size, digest });
}

async function walkFiles(directory, visitor) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".generation-") || entry.name.startsWith(".backup-")) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkFiles(entryPath, visitor);
    else if (entry.isFile()) await visitor(entryPath);
  }
}

function checkpointSignature(manifest) {
  const hash = createHash("sha256");
  hash.update("storyvr-history-checkpoint/v2\n");
  for (const entry of manifest) {
    hash.update(`${entry.relativePath}\0${entry.kind}\0${entry.size}\0${entry.digest}\n`);
  }
  return hash.digest("hex");
}

function storyBuildInputSignature(manifest) {
  const hash = createHash("sha256");
  hash.update("storyvr-build-input/v1\n");
  for (const entry of manifest) {
    hash.update(`${entry.relativePath}\0${entry.kind}\0${entry.size}\0${entry.digest}\n`);
  }
  return hash.digest("hex");
}

async function digestForFile(filePath, metadata, digestCache) {
  const cacheKey = path.resolve(filePath);
  const metadataSignature = [
    metadata.dev,
    metadata.ino,
    metadata.size,
    metadata.mtimeMs,
    metadata.ctimeMs,
  ].join(":");
  const cached = digestCache.get(cacheKey);
  if (cached?.metadataSignature === metadataSignature) return cached.digest;
  const digest = await fileDigest(filePath);
  digestCache.set(cacheKey, { metadataSignature, digest });
  return digest;
}

async function fileDigest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function contentBlobPath(session, digest) {
  if (!/^[a-f0-9]{64}$/.test(String(digest || ""))) throw new Error("StoryVR history artifact digest is invalid.");
  return path.join(session.blobsRoot, digest);
}

async function ensureContentBlob(session, entry) {
  const destination = contentBlobPath(session, entry.digest);
  const existing = await stat(destination).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (!existing.isFile() || existing.size !== entry.size) {
      throw new Error("StoryVR history content storage is inconsistent.");
    }
    return false;
  }

  const temporary = path.join(session.blobsRoot, `.blob-${randomUUID()}.tmp`);
  try {
    await cloneOrCopyFile(entry.absolutePath, temporary);
    const [storedMetadata, storedDigest] = await Promise.all([
      stat(temporary),
      fileDigest(temporary),
    ]);
    if (storedMetadata.size !== entry.size || storedDigest !== entry.digest) {
      throw new Error("An authored file changed while StoryVR was capturing history. Try the action again.");
    }
    await rename(temporary, destination);
    return true;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function cloneOrCopyFile(source, destination) {
  await copyFile(source, destination, fsConstants.COPYFILE_FICLONE).catch(async (error) => {
    if (!["ENOSYS", "ENOTSUP", "EINVAL", "EXDEV"].includes(error?.code)) throw error;
    await copyFile(source, destination);
  });
}

async function applyCheckpoint(paths, assetRoot, checkpoint, session) {
  const currentManifest = await collectAuthorArtifacts(paths, assetRoot, session.digestCache);
  const currentByPath = new Map(currentManifest.map((entry) => [entry.relativePath, entry]));
  const desiredByPath = new Map(checkpoint.manifest.map((entry) => [entry.relativePath, entry]));
  const removed = currentManifest.filter((entry) => !desiredByPath.has(entry.relativePath));
  const changed = checkpoint.manifest.filter((entry) => {
    const current = currentByPath.get(entry.relativePath);
    return !current || current.kind !== entry.kind || current.digest !== entry.digest;
  });

  for (const entry of removed) {
    await rm(entry.absolutePath, { force: true });
    session.digestCache.delete(entry.absolutePath);
    const cleanup = cleanupBoundaryForArtifact(paths, assetRoot, entry);
    if (cleanup) await removeEmptyAncestors(path.dirname(entry.absolutePath), cleanup.boundary, cleanup.removeBoundary);
  }

  for (const entry of changed) {
    const source = contentBlobPath(session, entry.digest);
    const destination = path.join(paths.storyFolder, entry.relativePath);
    assertInside(paths.storyFolder, destination, "restored history artifact");
    await mkdir(path.dirname(destination), { recursive: true });
    await replaceFileAtomic(source, destination);
    session.digestCache.delete(path.resolve(destination));
  }

  return {
    removedFileCount: removed.length,
    restoredFileCount: changed.length,
    unchangedFileCount: checkpoint.manifest.length - changed.length,
  };
}

function cleanupBoundaryForArtifact(paths, assetRoot, entry) {
  const absolutePath = path.resolve(entry.absolutePath);
  const resolvedAssetRoot = path.resolve(assetRoot);
  if (absolutePath.startsWith(`${resolvedAssetRoot}${path.sep}`)) {
    return { boundary: resolvedAssetRoot, removeBoundary: true };
  }
  for (const directory of [paths.proposalsRoot, paths.decisionsRoot].filter(Boolean)) {
    const boundary = path.resolve(directory);
    if (absolutePath.startsWith(`${boundary}${path.sep}`)) return { boundary, removeBoundary: false };
  }
  return null;
}

async function removeEmptyAncestors(directory, boundary, removeBoundary) {
  let current = path.resolve(directory);
  const resolvedBoundary = path.resolve(boundary);
  while (current === resolvedBoundary || current.startsWith(`${resolvedBoundary}${path.sep}`)) {
    if (current === resolvedBoundary && !removeBoundary) return;
    try {
      await rmdir(current);
    } catch (error) {
      if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) return;
      throw error;
    }
    if (current === resolvedBoundary) return;
    current = path.dirname(current);
  }
}

async function replaceFileAtomic(source, destination) {
  const temporary = `${destination}.history-${randomUUID()}.tmp`;
  try {
    await cloneOrCopyFile(source, temporary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertInside(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside the active StoryVR story folder.`);
  }
}

function pathIsInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function historyError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
