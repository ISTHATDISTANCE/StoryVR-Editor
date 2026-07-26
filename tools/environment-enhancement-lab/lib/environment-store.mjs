import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const ENVIRONMENT_STORE_SCHEMA_VERSION = "storyvr-environment-enhancement-lab/v1";
export const MAX_ENVIRONMENT_UPLOAD_BYTES = 120 * 1024 * 1024;

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAIN_ASSET_EXTENSIONS = new Map([
  [".glb", 0],
  [".gltf", 1],
  [".hdr", 2],
  [".exr", 3],
]);

const DEFAULT_TRANSFORM = Object.freeze({
  position: Object.freeze([0, 0, 0]),
  rotationY: 0,
  scale: 1,
});

const DEFAULT_RENDERING = Object.freeze({
  visible: true,
  castShadow: false,
  receiveShadow: true,
  exposure: 1,
  fogColor: "#dce8e2",
  fogDensity: 0,
  backgroundMode: "asset",
});

/**
 * Creates the persistent store used by the Environment Enhancement lab.
 *
 * Public methods are asynchronous except for assetPathFromUrl(). Mutations are
 * serialized so a rapid sequence of authoring requests cannot overwrite a
 * newer manifest with an older one.
 */
export function createEnvironmentStore({ repoRoot, labRoot, storyFolder } = {}) {
  const resolvedRepoRoot = path.resolve(requireNonEmptyString(repoRoot, "repoRoot"));
  const resolvedLabRoot = path.resolve(requireNonEmptyString(labRoot, "labRoot"));
  const storyMode = typeof storyFolder === "string" && storyFolder.trim().length > 0;

  let assetRoot;
  let manifestPath;

  if (storyMode) {
    const storyRoot = path.resolve(resolvedRepoRoot, storyFolder);
    assertInside(resolvedRepoRoot, storyRoot, "storyFolder");
    assetRoot = path.join(storyRoot, "webxr-adaptation", "public", "environment-lab");
    manifestPath = path.join(storyRoot, "analysis", "storyvr", "environment-enhancement-lab.json");
  } else {
    const dataRoot = path.join(resolvedLabRoot, ".lab-data");
    assetRoot = path.join(dataRoot, "environment-lab");
    manifestPath = path.join(dataRoot, "environment-enhancement-lab.json");
  }

  let mutationQueue = Promise.resolve();

  const serializeMutation = (operation) => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  };

  async function getState() {
    await mutationQueue;
    return jsonClone(await readState(manifestPath));
  }

  function importUpload(upload) {
    return serializeMutation(async () => {
      const normalized = normalizeUpload(upload);
      return installUpload(normalized, (sourcePath) => writeUploadToFile(
        normalized.body,
        sourcePath,
        normalized.upload.expectedBytes,
        MAX_ENVIRONMENT_UPLOAD_BYTES,
      ));
    });
  }

  async function installUpload(normalized, receiveSource) {
    const previous = await readState(manifestPath);
    assertUnlocked(previous, "upload another environment asset");
    await mkdir(assetRoot, { recursive: true });

    const workspace = await mkdtemp(path.join(assetRoot, ".upload-"));
    const stagingRoot = path.join(workspace, "payload");
    const sourceFilename = normalized.upload.kind === "zip"
      ? "source.zip"
      : normalized.upload.filename;
    const sourcePath = path.join(workspace, sourceFilename);

    try {
        const source = await receiveSource(sourcePath);

        if (normalized.upload.kind === "zip") {
          await inspectZipArchive(sourcePath);
          await mkdir(stagingRoot, { recursive: true });
          await runUnzip(["-qq", sourcePath, "-d", stagingRoot]);
          await assertExtractedTreeIsSafe(stagingRoot);
        } else {
          await mkdir(stagingRoot, { recursive: true });
          await rename(sourcePath, path.join(stagingRoot, normalized.upload.filename));
        }

        const files = await collectRegularFiles(stagingRoot);
        const mainAsset = chooseMainAsset(files);
        if (!mainAsset) {
          throw new Error("Uploaded package does not contain a supported .glb, .gltf, .hdr, or .exr asset.");
        }
        await validateMainAsset(mainAsset.path, stagingRoot);

        const providerAssetKey = normalized.providerAssetKey;
        const destination = path.join(assetRoot, providerAssetKey);
        const relativeMainPath = toPosixPath(path.relative(stagingRoot, mainAsset.path));
        const mainSha256 = await sha256File(mainAsset.path);
        const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

        await installStagingDirectory(stagingRoot, destination);

        const now = new Date().toISOString();
        const entryPath = `${providerAssetKey}/${relativeMainPath}`;
        const encodedMainPath = entryPath.split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/");
        const localPath = `/environment-assets/${encodedMainPath}`;
        const candidate = normalized.candidate;
        const sourceUrl = firstNonEmptyString(
          candidate.sourceUrl,
          candidate.sourcePageUrl,
          candidate.pageUrl,
          candidate.url,
          candidate.provenance?.sourceUrl,
        );
        const format = path.extname(relativeMainPath).slice(1).toLowerCase();

        const next = {
          schemaVersion: ENVIRONMENT_STORE_SCHEMA_VERSION,
          revision: previous.revision + 1,
          createdAt: previous.createdAt || now,
          updatedAt: now,
          locked: false,
          lockedAt: null,
          candidate,
          provider: normalized.provider,
          providerAssetId: normalized.providerAssetId,
          title: firstNonEmptyString(candidate.title, candidate.name, candidate.label) || normalized.providerAssetId,
          description: firstNonEmptyString(candidate.description),
          sourceUrl,
          attribution: firstNonEmptyString(candidate.attribution, candidate.license?.attribution),
          license: jsonClone(candidate.license ?? candidate.provenance?.license ?? null),
          provenance: {
            ...jsonClone(isPlainObject(candidate.provenance) ? candidate.provenance : {}),
            provider: normalized.provider,
            providerAssetId: normalized.providerAssetId,
            sourceUrl,
            sourceMetadata: normalized.sourceMetadata,
            uploadedAt: now,
          },
          asset: {
            providerAssetKey,
            provider: normalized.provider,
            providerAssetId: normalized.providerAssetId,
            title: firstNonEmptyString(candidate.title, candidate.name, candidate.label) || normalized.providerAssetId,
            sourceUrl,
            attribution: firstNonEmptyString(candidate.attribution, candidate.license?.attribution),
            localPath,
            entryPath,
            format,
            mediaType: mediaTypeForFormat(format),
            sha256: mainSha256,
            bytes: mainAsset.bytes,
            sourceUpload: {
              kind: normalized.upload.kind,
              filename: normalized.upload.filename,
              sha256: source.sha256,
              bytes: source.bytes,
            },
            dependencies: [],
          },
          transform: deepMerge({}, DEFAULT_TRANSFORM, candidate.transform),
          rendering: deepMerge({}, DEFAULT_RENDERING, candidate.rendering),
          performance: deepMerge({}, candidate.metrics, candidate.performance, {
            uploadBytes: source.bytes,
            packagedBytes: totalBytes,
            mainAssetBytes: mainAsset.bytes,
            fileCount: files.length,
            dependencyCount: Math.max(0, files.length - 1),
            format,
          }),
        };

        await writeStateAtomic(manifestPath, next);
        return jsonClone(next);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  function updateDraft({ transform, rendering } = {}) {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      assertUnlocked(previous, "edit the environment draft");
      if (!previous.asset) throw new Error("Upload an environment asset before editing its draft.");
      if (transform !== undefined && !isPlainObject(transform)) {
        throw new TypeError("transform must be an object.");
      }
      if (rendering !== undefined && !isPlainObject(rendering)) {
        throw new TypeError("rendering must be an object.");
      }

      const next = touch(previous, {
        transform: deepMerge({}, previous.transform, transform),
        rendering: deepMerge({}, previous.rendering, rendering),
      });
      await writeStateAtomic(manifestPath, next);
      return jsonClone(next);
    });
  }

  function lockSelection() {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      if (!previous.asset) throw new Error("Upload an environment asset before locking the selection.");
      if (previous.locked) return jsonClone(previous);
      const now = new Date().toISOString();
      const next = touch(previous, { locked: true, lockedAt: now }, now);
      await writeStateAtomic(manifestPath, next);
      return jsonClone(next);
    });
  }

  function unlockSelection() {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      if (!previous.locked) return jsonClone(previous);
      const next = touch(previous, { locked: false, lockedAt: null });
      await writeStateAtomic(manifestPath, next);
      return jsonClone(next);
    });
  }

  function assetPathFromUrl(pathname) {
    if (typeof pathname !== "string") return null;
    const rawPathname = pathname.split(/[?#]/, 1)[0];
    let decoded;
    try {
      decoded = decodeURIComponent(rawPathname);
    } catch {
      return null;
    }

    if (!decoded.startsWith("/environment-assets/")) return null;
    const relative = decoded.slice("/environment-assets/".length);
    const segments = relative.split("/");
    if (
      segments.length < 2
      || segments.some((segment) => !segment || segment === "." || segment === "..")
      || segments.some((segment) => segment.includes("\\") || containsControlCharacter(segment))
      || /^[A-Za-z]:/.test(segments[0])
    ) {
      return null;
    }

    const resolved = path.resolve(assetRoot, ...segments);
    try {
      assertInside(assetRoot, resolved, "asset URL");
      return resolved;
    } catch {
      return null;
    }
  }

  return {
    getState,
    importUpload,
    updateDraft,
    lockSelection,
    unlockSelection,
    assetPathFromUrl,
  };
}

function emptyState() {
  return {
    schemaVersion: ENVIRONMENT_STORE_SCHEMA_VERSION,
    revision: 0,
    createdAt: null,
    updatedAt: null,
    locked: false,
    lockedAt: null,
    candidate: null,
    provider: null,
    providerAssetId: null,
    title: null,
    description: null,
    sourceUrl: null,
    attribution: null,
    license: null,
    provenance: null,
    asset: null,
    transform: jsonClone(DEFAULT_TRANSFORM),
    rendering: jsonClone(DEFAULT_RENDERING),
    performance: {},
  };
}

async function readState(manifestPath) {
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }

  const value = JSON.parse(source);
  if (!isPlainObject(value) || value.schemaVersion !== ENVIRONMENT_STORE_SCHEMA_VERSION) {
    throw new Error(`Invalid environment store schema in ${manifestPath}.`);
  }
  return {
    ...emptyState(),
    ...value,
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
  };
}

async function writeStateAtomic(manifestPath, state) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function normalizeUpload(upload) {
  if (!isPlainObject(upload) || !isPlainObject(upload.candidate)) {
    throw new TypeError("upload must contain a candidate object.");
  }
  if (upload.body === undefined || upload.body === null) {
    throw new TypeError("upload.body is required.");
  }

  const candidate = jsonClone(upload.candidate);
  const provider = firstNonEmptyString(
    typeof candidate.provider === "string" ? candidate.provider : candidate.provider?.id,
    candidate.provenance?.provider,
    candidate.source,
  );
  const providerAssetId = firstNonEmptyString(
    candidate.providerAssetId,
    candidate.assetId,
    candidate.sourceId,
    candidate.id,
  );
  if (!provider || !providerAssetId) {
    throw new TypeError("candidate must identify both its provider and provider asset id.");
  }

  const filename = safeFilename(upload.filename, "", "upload.filename");
  const extension = path.extname(filename).toLowerCase();
  if (extension !== ".zip" && !MAIN_ASSET_EXTENSIONS.has(extension)) {
    throw new TypeError("upload.filename must end in .zip, .glb, .gltf, .hdr, or .exr.");
  }
  const expectedBytes = normalizeExpectedBytes(upload.expectedBytes, "upload.expectedBytes");

  return {
    body: upload.body,
    candidate,
    provider,
    providerAssetId,
    providerAssetKey: `${slug(provider)}-${slug(providerAssetId)}`,
    sourceMetadata: deepMerge({}, isPlainObject(upload.sourceMetadata) ? upload.sourceMetadata : {}, {
      importMethod: "user-upload",
      originalFilename: filename,
    }),
    upload: {
      kind: extension === ".zip" ? "zip" : "file",
      filename,
      expectedBytes,
    },
  };
}

async function writeUploadToFile(body, outputPath, expectedBytes, maximumBytes) {
  if (maximumBytes < 0) {
    throw new Error(`Environment upload exceeds the ${MAX_ENVIRONMENT_UPLOAD_BYTES}-byte limit.`);
  }

  const digest = createHash("sha256");
  const handle = await open(outputPath, "wx");
  let bytes = 0;
  try {
    for await (const chunk of uploadChunks(body)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maximumBytes) {
        throw new Error(`Environment upload exceeds the ${MAX_ENVIRONMENT_UPLOAD_BYTES}-byte limit.`);
      }
      digest.update(buffer);
      await handle.write(buffer);
    }
  } catch (error) {
    await handle.close();
    await rm(outputPath, { force: true });
    throw error;
  }
  await handle.close();

  if (expectedBytes !== null && bytes !== expectedBytes) {
    await rm(outputPath, { force: true });
    throw new Error(`Environment upload size did not match the expected ${expectedBytes} bytes.`);
  }
  return { bytes, sha256: digest.digest("hex") };
}

async function* uploadChunks(body) {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    yield body;
    return;
  }
  if (body instanceof ArrayBuffer) {
    yield new Uint8Array(body);
    return;
  }
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (body && typeof body[Symbol.asyncIterator] === "function") {
    yield* body;
    return;
  }
  if (body && typeof body.stream === "function") {
    yield* uploadChunks(body.stream());
    return;
  }
  throw new TypeError("upload.body must be a readable file body.");
}

async function inspectZipArchive(archivePath) {
  const [{ stdout: namesOutput }, { stdout: longOutput }, { stdout: totalsOutput }] = await Promise.all([
    runUnzip(["-Z1", archivePath]),
    runUnzip(["-Z", "-l", archivePath]),
    runUnzip(["-Z", "-t", archivePath]),
  ]);

  const names = namesOutput.split(/\r?\n/).filter(Boolean);
  if (!names.length) throw new Error("Environment ZIP package is empty.");
  if (names.length > MAX_ARCHIVE_ENTRIES) throw new Error("Environment ZIP package contains too many entries.");

  for (const name of names) assertSafeArchiveEntry(name);

  for (const line of longOutput.split(/\r?\n/)) {
    const mode = line.trimStart();
    if (/^l[rwx-]{9}\s/.test(mode)) {
      throw new Error("Environment ZIP package contains a symbolic link.");
    }
    if (/^[bcps][rwx-]{9}\s/.test(mode)) {
      throw new Error("Environment ZIP package contains a non-regular filesystem entry.");
    }
  }

  const totals = totalsOutput.match(/(\d+) files?,\s+(\d+) bytes uncompressed/i);
  if (totals) {
    const entryCount = Number(totals[1]);
    const uncompressedBytes = Number(totals[2]);
    if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error("Environment ZIP package contains too many entries.");
    if (uncompressedBytes > MAX_ENVIRONMENT_UPLOAD_BYTES) {
      throw new Error(`Environment ZIP expands beyond the ${MAX_ENVIRONMENT_UPLOAD_BYTES}-byte limit.`);
    }
  }
}

function assertSafeArchiveEntry(name) {
  if (
    !name
    || containsControlCharacter(name)
    || name.includes("\\")
    || name.startsWith("/")
    || /^[A-Za-z]:/.test(name)
    || name.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe path in environment ZIP package: ${JSON.stringify(name)}.`);
  }
}

async function runUnzip(args) {
  try {
    return await execFile("/usr/bin/unzip", args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    throw new Error(`Unable to inspect or extract environment ZIP package: ${error.message}`, { cause: error });
  }
}

async function assertExtractedTreeIsSafe(root) {
  const pending = [root];
  let totalBytes = 0;
  let entryCount = 0;
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error("Environment ZIP package contains too many entries.");
      const entryPath = path.join(current, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) throw new Error("Environment ZIP package contains a symbolic link.");
      if (metadata.isDirectory()) {
        pending.push(entryPath);
      } else if (metadata.isFile()) {
        totalBytes += metadata.size;
        if (totalBytes > MAX_ENVIRONMENT_UPLOAD_BYTES) {
          throw new Error(`Environment ZIP expands beyond the ${MAX_ENVIRONMENT_UPLOAD_BYTES}-byte limit.`);
        }
      } else {
        throw new Error("Environment ZIP package contains a non-regular filesystem entry.");
      }
    }
  }
}

async function collectRegularFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        const metadata = await stat(entryPath);
        files.push({ path: entryPath, bytes: metadata.size });
      }
    }
  }
  return files;
}

function chooseMainAsset(files) {
  return files
    .filter((file) => MAIN_ASSET_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
    .sort((left, right) => {
      const extensionDifference = MAIN_ASSET_EXTENSIONS.get(path.extname(left.path).toLowerCase())
        - MAIN_ASSET_EXTENSIONS.get(path.extname(right.path).toLowerCase());
      if (extensionDifference) return extensionDifference;
      const depthDifference = left.path.split(path.sep).length - right.path.split(path.sep).length;
      if (depthDifference) return depthDifference;
      return left.path.localeCompare(right.path);
    })[0] || null;
}

async function validateMainAsset(filePath, packageRoot) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".glb") {
    await validateGlb(filePath);
    return;
  }
  if (extension === ".gltf") {
    await validateGltf(filePath, packageRoot);
    return;
  }
  if (extension === ".hdr") {
    const prefix = await readPrefix(filePath, 16);
    const header = prefix.toString("ascii");
    if (!header.startsWith("#?RADIANCE") && !header.startsWith("#?RGBE")) {
      throw new Error("Uploaded HDR asset is missing a Radiance/RGBE header.");
    }
    return;
  }
  if (extension === ".exr") {
    const prefix = await readPrefix(filePath, 4);
    if (prefix.length !== 4 || prefix.readUInt32LE(0) !== 0x01312f76) {
      throw new Error("Uploaded EXR asset has an invalid magic number.");
    }
  }
}

async function validateGlb(filePath) {
  const metadata = await stat(filePath);
  const header = await readPrefix(filePath, 12);
  if (header.length !== 12 || header.toString("ascii", 0, 4) !== "glTF") {
    throw new Error("Uploaded GLB asset has an invalid magic header.");
  }
  if (header.readUInt32LE(4) !== 2) {
    throw new Error("Uploaded GLB asset must use glTF version 2.");
  }
  if (header.readUInt32LE(8) !== metadata.size) {
    throw new Error("Uploaded GLB asset's declared length does not match the file size.");
  }
}

async function validateGltf(filePath, packageRoot) {
  let document;
  try {
    document = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Uploaded glTF asset is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!isPlainObject(document) || document.asset?.version !== "2.0") {
    throw new Error("Uploaded glTF asset must declare asset.version 2.0.");
  }

  const references = [
    ...(Array.isArray(document.buffers) ? document.buffers : []),
    ...(Array.isArray(document.images) ? document.images : []),
  ];
  for (const reference of references) {
    if (typeof reference?.uri !== "string") continue;
    const resolved = resolveGltfDependency(filePath, packageRoot, reference.uri);
    if (!resolved) continue;
    let metadata;
    try {
      metadata = await stat(resolved);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Uploaded glTF asset references a missing dependency: ${reference.uri}.`);
      }
      throw error;
    }
    if (!metadata.isFile()) {
      throw new Error(`Uploaded glTF dependency is not a regular file: ${reference.uri}.`);
    }
  }
}

function resolveGltfDependency(gltfPath, packageRoot, uri) {
  if (/^data:/i.test(uri)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new Error(`Uploaded glTF asset contains an invalid dependency URI: ${uri}.`);
  }
  const pathname = decoded.split(/[?#]/, 1)[0];
  const segments = pathname.split("/");
  if (
    !pathname
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(pathname)
    || pathname.startsWith("/")
    || /^[A-Za-z]:/.test(pathname)
    || pathname.includes("\\")
    || containsControlCharacter(pathname)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Uploaded glTF asset contains an unsafe dependency URI: ${uri}.`);
  }
  const resolved = path.resolve(path.dirname(gltfPath), ...segments);
  assertInside(packageRoot, resolved, "glTF dependency URI");
  return resolved;
}

async function readPrefix(filePath, length) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function installStagingDirectory(stagingRoot, destination) {
  const backup = `${destination}.backup-${randomUUID()}`;
  let hadExistingDestination = false;
  try {
    await rename(destination, backup);
    hadExistingDestination = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    await rename(stagingRoot, destination);
  } catch (error) {
    if (hadExistingDestination) await rename(backup, destination);
    throw error;
  }

  if (hadExistingDestination) await rm(backup, { recursive: true, force: true });
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function touch(previous, updates, now = new Date().toISOString()) {
  return {
    ...previous,
    ...updates,
    schemaVersion: ENVIRONMENT_STORE_SCHEMA_VERSION,
    revision: previous.revision + 1,
    updatedAt: now,
  };
}

function assertUnlocked(state, action) {
  if (state.locked) throw new Error(`Unlock the environment selection before attempting to ${action}.`);
}

function mediaTypeForFormat(format) {
  if (format === "glb") return "model/gltf-binary";
  if (format === "gltf") return "model/gltf+json";
  if (format === "hdr") return "image/vnd.radiance";
  if (format === "exr") return "image/x-exr";
  return "application/octet-stream";
}

function safeFilename(value, fallback, label = "upload.filename") {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (
    !candidate
    || candidate === "."
    || candidate === ".."
    || candidate.includes("/")
    || candidate.includes("\\")
    || containsControlCharacter(candidate)
  ) {
    throw new TypeError(`${label} must be a safe base filename.`);
  }
  return candidate;
}

function normalizeExpectedBytes(value, label) {
  if (value === undefined || value === null) return null;
  const expectedBytes = Number(value);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  if (expectedBytes > MAX_ENVIRONMENT_UPLOAD_BYTES) {
    throw new Error(`Environment upload exceeds the ${MAX_ENVIRONMENT_UPLOAD_BYTES}-byte limit.`);
  }
  return expectedBytes;
}

function slug(value) {
  const result = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!result) throw new TypeError("Provider and asset identifiers must contain letters or numbers.");
  return result;
}

function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (isPlainObject(value)) {
        target[key] = deepMerge(isPlainObject(target[key]) ? { ...target[key] } : {}, value);
      } else if (value !== undefined) {
        target[key] = jsonClone(value);
      }
    }
  }
  return target;
}

function jsonClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function containsControlCharacter(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function assertInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside its allowed root.`);
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}
