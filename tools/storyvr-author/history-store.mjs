import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_CHECKPOINTS = 128;

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
    await mkdir(root, { recursive: true });
    const session = {
      id,
      root,
      createdAt: Date.now(),
      touchedAt: Date.now(),
      checkpoints: new Map(),
      signatureToId: new Map(),
    };
    sessions.set(id, session);
    const checkpoint = await captureCheckpoint(id);
    return { sessionId: id, ...checkpoint };
  }

  async function captureCheckpoint(sessionId) {
    const session = requireSession(sessionId);
    if (session.checkpoints.size >= maxCheckpoints) {
      throw historyError(409, `This StoryVR history session reached its ${maxCheckpoints}-checkpoint limit. Reload the author workspace to start a new session.`);
    }
    session.touchedAt = Date.now();
    const checkpointId = randomUUID();
    const checkpointRoot = path.join(session.root, checkpointId);
    const filesRoot = path.join(checkpointRoot, "files");
    await mkdir(filesRoot, { recursive: true });

    const manifest = await collectAuthorArtifacts(paths, assetRoot);
    const hash = createHash("sha256");
    for (const entry of manifest) {
      hash.update(`${entry.relativePath}\0${entry.kind}\0${entry.size}\0${entry.fingerprint}\n`);
      const destination = path.join(filesRoot, entry.relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      if (entry.kind === "environment-asset") await linkOrClone(entry.absolutePath, destination);
      else await copyFile(entry.absolutePath, destination);
    }
    const signature = hash.digest("hex");
    const existingId = session.signatureToId.get(signature);
    if (existingId && session.checkpoints.has(existingId)) {
      await rm(checkpointRoot, { recursive: true, force: true });
      return { checkpointId: existingId, signature };
    }

    const checkpoint = {
      id: checkpointId,
      root: checkpointRoot,
      signature,
      manifest: manifest.map(({ relativePath, kind, size }) => ({ relativePath, kind, size })),
      createdAt: Date.now(),
    };
    await writeFile(path.join(checkpointRoot, "manifest.json"), `${JSON.stringify({
      schemaVersion: "storyvr-history-checkpoint/v1",
      signature,
      files: checkpoint.manifest,
    }, null, 2)}\n`);
    session.checkpoints.set(checkpointId, checkpoint);
    session.signatureToId.set(signature, checkpointId);
    return { checkpointId, signature };
  }

  async function restoreCheckpoint(sessionId, checkpointId) {
    const session = requireSession(sessionId);
    const checkpoint = session.checkpoints.get(String(checkpointId || ""));
    if (!checkpoint) throw historyError(404, "StoryVR history checkpoint was not found in this browser session.");
    session.touchedAt = Date.now();

    const rollback = await captureCheckpoint(sessionId);
    try {
      await applyCheckpoint(paths, assetRoot, checkpoint);
    } catch (error) {
      const rollbackCheckpoint = session.checkpoints.get(rollback.checkpointId);
      if (rollbackCheckpoint) await applyCheckpoint(paths, assetRoot, rollbackCheckpoint).catch(() => {});
      throw error;
    }
    return { checkpointId: checkpoint.id, signature: checkpoint.signature, restored: true };
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

async function collectAuthorArtifacts(paths, assetRoot) {
  const entries = [];
  const staticFiles = [
    paths.storyGraphPath,
    paths.sourceMotionOverridesPath,
    paths.sourceMotionPlaybackPath,
    paths.proceduralDynamicsPath,
    path.join(paths.analysisRoot, "environment-enhancement.json"),
  ].filter(Boolean);
  for (const filePath of staticFiles) await addFileIfPresent(entries, paths.storyFolder, filePath, "author-json");
  await addJsonDirectory(entries, paths.storyFolder, paths.proposalsRoot);
  await addJsonDirectory(entries, paths.storyFolder, paths.decisionsRoot);
  await walkFiles(assetRoot, async (filePath) => {
    await addFileIfPresent(entries, paths.storyFolder, filePath, "environment-asset");
  });
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function addJsonDirectory(entries, storyFolder, directory) {
  let names;
  try {
    names = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of names) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await addFileIfPresent(entries, storyFolder, path.join(directory, entry.name), "author-json");
    }
  }
}

async function addFileIfPresent(entries, storyFolder, filePath, kind) {
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
  let fingerprint;
  if (kind === "author-json") {
    fingerprint = createHash("sha256").update(await readFile(absolutePath)).digest("hex");
  } else {
    fingerprint = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`;
  }
  entries.push({ absolutePath, relativePath, kind, size: metadata.size, fingerprint });
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
    if (entry.name.startsWith(".upload-") || entry.name.startsWith(".backup-")) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkFiles(entryPath, visitor);
    else if (entry.isFile()) await visitor(entryPath);
  }
}

async function linkOrClone(source, destination) {
  try {
    await link(source, destination);
    return;
  } catch (error) {
    if (!["EXDEV", "EPERM", "EACCES", "EMLINK", "EEXIST"].includes(error?.code)) throw error;
  }
  await copyFile(source, destination, fsConstants.COPYFILE_FICLONE).catch(async (error) => {
    if (!["ENOSYS", "ENOTSUP", "EINVAL", "EXDEV"].includes(error?.code)) throw error;
    await copyFile(source, destination);
  });
}

async function applyCheckpoint(paths, assetRoot, checkpoint) {
  const filesRoot = path.join(checkpoint.root, "files");
  const desired = new Set(checkpoint.manifest.map((entry) => entry.relativePath));
  const staticFiles = [
    paths.storyGraphPath,
    paths.sourceMotionOverridesPath,
    paths.sourceMotionPlaybackPath,
    paths.proceduralDynamicsPath,
    path.join(paths.analysisRoot, "environment-enhancement.json"),
  ].filter(Boolean);
  for (const filePath of staticFiles) {
    const relative = toPosix(path.relative(paths.storyFolder, filePath));
    if (!desired.has(relative)) await rm(filePath, { force: true });
  }
  await removeJsonFilesNotInCheckpoint(paths.proposalsRoot, paths.storyFolder, desired);
  await removeJsonFilesNotInCheckpoint(paths.decisionsRoot, paths.storyFolder, desired);
  await rm(assetRoot, { recursive: true, force: true });

  for (const entry of checkpoint.manifest) {
    const source = path.join(filesRoot, entry.relativePath);
    const destination = path.join(paths.storyFolder, entry.relativePath);
    assertInside(paths.storyFolder, destination, "restored history artifact");
    await mkdir(path.dirname(destination), { recursive: true });
    if (entry.kind === "environment-asset") await linkOrClone(source, destination);
    else await replaceFileAtomic(source, destination);
  }
}

async function removeJsonFilesNotInCheckpoint(directory, storyFolder, desired) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(directory, entry.name);
    const relative = toPosix(path.relative(storyFolder, filePath));
    if (!desired.has(relative)) await rm(filePath, { force: true });
  }
}

async function replaceFileAtomic(source, destination) {
  const temporary = `${destination}.history-${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
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

function historyError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
