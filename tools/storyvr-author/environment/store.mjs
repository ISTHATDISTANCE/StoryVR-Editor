import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
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

export const ENVIRONMENT_STORE_SCHEMA_VERSION = "storyvr-environment-enhancement/v1";
export const MAX_ENVIRONMENT_UPLOAD_BYTES = 120 * 1024 * 1024;

const MANUAL_UPLOAD_EXTENSIONS = new Set([".hdr", ".exr"]);
const GENERATED_UPLOAD_EXTENSION = ".png";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

export const DEFAULT_ENVIRONMENT_MOVEMENT_CUE = Object.freeze({
  enabled: false,
  style: "sand",
  texture: null,
  position: Object.freeze([0, 0.004, -0.4]),
  widthMeters: 2,
  depthMeters: 1.5,
  thicknessMeters: 0.008,
  textureScaleMeters: 0.2,
  opacity: 0.55,
});

const MOVEMENT_CUE_LIMITS = Object.freeze({
  positionMinimum: -100,
  positionMaximum: 100,
  sizeMinimum: 0.1,
  sizeMaximum: 200,
  thicknessMinimum: 0.001,
  thicknessMaximum: 0.25,
  textureScaleMinimum: 0.02,
  textureScaleMaximum: 5,
  opacityMinimum: 0,
  opacityMaximum: 1,
});

const ENVIRONMENT_ASSIGNMENT_KEYS = Object.freeze([
  "selectedSource",
  "pendingSource",
  "candidate",
  "provider",
  "providerAssetId",
  "title",
  "description",
  "sourceUrl",
  "attribution",
  "license",
  "provenance",
  "asset",
  "transform",
  "rendering",
  "movementCue",
  "performance",
  "skipped",
]);
const RETIRED_ENVIRONMENT_METADATA_KEY = ["rights", "Confirmation"].join("");

/**
 * Creates the story-local persistent store used by the Environment Enhancement
 * checkpoint. Draft metadata lives under analysis/storyvr while uploaded files
 * live in the reader app's public directory so Vite copies them into builds.
 *
 * Public methods are asynchronous except for assetPathFromUrl(). Mutations are
 * serialized so a rapid sequence of authoring requests cannot overwrite a
 * newer manifest with an older one. The manifest is always editable; checkpoint
 * save/current/stale state belongs to the StoryVR decision store.
 */
export function createEnvironmentStore({ repoRoot, storyFolder } = {}) {
  const resolvedRepoRoot = path.resolve(requireNonEmptyString(repoRoot, "repoRoot"));
  const storyRoot = path.resolve(resolvedRepoRoot, requireNonEmptyString(storyFolder, "storyFolder"));
  assertInside(resolvedRepoRoot, storyRoot, "storyFolder");
  const assetRoot = path.join(storyRoot, "webxr-adaptation", "public", "environment-enhancement");
  const manifestPath = path.join(storyRoot, "analysis", "storyvr", "environment-enhancement.json");

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

  function selectSource(candidate, { beatId = null } = {}) {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      const normalizedBeatId = optionalBeatId(beatId);
      const previousAssignment = editableAssignmentForBeat(previous, normalizedBeatId);
      const selectedSource = normalizeCandidate(candidate);
      const assignment = normalizeEnvironmentAssignment({
        ...previousAssignment,
        pendingSource: selectedSource,
        skipped: false,
      });
      const next = assignEnvironment(previous, normalizedBeatId, assignment);
      await writeStateAtomic(manifestPath, next);
      return jsonClone(next);
    });
  }

  function importUpload(upload) {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      const beatId = optionalBeatId(upload?.beatId);
      const previousAssignment = editableAssignmentForBeat(previous, beatId);
      const candidate = isPlainObject(upload?.candidate)
        ? upload.candidate
        : previousAssignment.pendingSource || previousAssignment.selectedSource;
      const normalized = normalizeUpload({ ...upload, candidate });
      return installUpload(previous, normalized, (sourcePath) => writeUploadToFile(
        normalized.body,
        sourcePath,
        normalized.upload.expectedBytes,
        MAX_ENVIRONMENT_UPLOAD_BYTES,
      ), {
        beatId,
        previousAssignment,
        groundInput: upload?.ground,
        generateGround: upload?.generateGround,
      });
    });
  }

  function importGenerated(upload) {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      const beatId = optionalBeatId(upload?.beatId);
      const previousAssignment = editableAssignmentForBeat(previous, beatId);
      const normalized = normalizeGeneratedUpload(upload);
      return installUpload(previous, normalized, (sourcePath) => writeUploadToFile(
        normalized.body,
        sourcePath,
        normalized.upload.expectedBytes,
        MAX_ENVIRONMENT_UPLOAD_BYTES,
      ), {
        beatId,
        previousAssignment,
        groundInput: upload?.ground,
      });
    });
  }

  async function installUpload(previous, normalized, receiveSource, {
    beatId = null,
    previousAssignment = editableAssignmentForBeat(previous, beatId),
    groundInput = null,
    generateGround = null,
  } = {}) {
    await mkdir(assetRoot, { recursive: true });

    const workspace = await mkdtemp(path.join(assetRoot, ".upload-"));
    const stagingRoot = path.join(workspace, "payload");
    const sourcePath = path.join(workspace, normalized.upload.filename);

    try {
      const source = await receiveSource(sourcePath);
      await validateMainAsset(sourcePath, normalized.upload.kind);

      let generatedGround = groundInput;
      if (!generatedGround && typeof generateGround === "function") {
        generatedGround = await generateGround({
          sourcePath,
          filename: normalized.upload.filename,
          candidate: jsonClone(normalized.candidate),
          provider: normalized.provider,
          providerAssetId: normalized.providerAssetId,
        });
      }
      const ground = normalizeGeneratedGroundUpload(generatedGround);
      const groundSourcePath = path.join(workspace, ground.filename);
      if (groundSourcePath === sourcePath) {
        throw new TypeError("Generated ground filename must differ from the panorama filename.");
      }
      const groundSource = await writeUploadToFile(
        ground.body,
        groundSourcePath,
        ground.expectedBytes,
        MAX_ENVIRONMENT_UPLOAD_BYTES,
      );
      await validateGeneratedGroundAsset(groundSourcePath);

      await mkdir(stagingRoot, { recursive: true });
      await rename(sourcePath, path.join(stagingRoot, normalized.upload.filename));
      await rename(groundSourcePath, path.join(stagingRoot, ground.filename));

      const files = await collectRegularFiles(stagingRoot);
      const mainAsset = files.find((file) => (
        toPosixPath(path.relative(stagingRoot, file.path)) === normalized.upload.filename
      ));
      const groundAssetFile = files.find((file) => (
        toPosixPath(path.relative(stagingRoot, file.path)) === ground.filename
      ));
      if (!mainAsset || !groundAssetFile) {
        throw new Error("The staged environment bundle is missing its panorama or matching ground.");
      }

      const providerAssetKey = normalized.providerAssetKey;
      const destination = path.join(assetRoot, providerAssetKey);
      const relativeMainPath = normalized.upload.filename;
      const relativeGroundPath = ground.filename;
      const [mainSha256, groundSha256] = await Promise.all([
        sha256File(mainAsset.path),
        sha256File(groundAssetFile.path),
      ]);
      const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
      const now = new Date().toISOString();
      const entryPath = `${providerAssetKey}/${relativeMainPath}`;
      const encodedMainPath = encodeEnvironmentEntryPath(entryPath);
      const localPath = `/environment-assets/${encodedMainPath}`;
      const groundEntryPath = `${providerAssetKey}/${relativeGroundPath}`;
      const groundTexture = {
        role: "ground-texture",
        entryPath: groundEntryPath,
        localPath: `/environment-assets/${encodeEnvironmentEntryPath(groundEntryPath)}`,
        publicPath: `environment-enhancement/${groundEntryPath}`,
        format: "png",
        mediaType: "image/png",
        sha256: groundSha256,
        bytes: groundAssetFile.bytes,
        sourcePanoramaSha256: mainSha256,
        generation: {
          ...jsonClone(ground.metadata),
          generatedAt: now,
        },
      };
      const candidate = normalized.candidate;
      const sourceUrl = firstNonEmptyString(
        candidate.sourceUrl,
        candidate.sourcePageUrl,
        candidate.pageUrl,
        candidate.url,
        candidate.provenance?.sourceUrl,
      );
      const format = path.extname(relativeMainPath).slice(1).toLowerCase();
      const previousCue = normalizeEnvironmentMovementCue(previousAssignment.movementCue);
      const preservePriorVisibility = Boolean(previousAssignment.asset && previousCue.texture);
      const movementCue = normalizeEnvironmentMovementCue({
        ...previousCue,
        enabled: preservePriorVisibility ? previousCue.enabled : true,
        style: "generated",
        texture: groundTexture,
      });
      const sourceMetadata = deepMerge({}, normalized.sourceMetadata, {
        groundGeneration: groundTexture.generation,
      });

      const assignment = normalizeEnvironmentAssignment({
        selectedSource: candidate,
        pendingSource: null,
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
          sourceMetadata,
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
          publicPath: `environment-enhancement/${entryPath}`,
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
          dependencies: [groundTexture],
        },
        transform: deepMerge({}, DEFAULT_TRANSFORM, candidate.transform),
        rendering: deepMerge({}, DEFAULT_RENDERING, candidate.rendering),
        movementCue,
        performance: deepMerge({}, candidate.metrics, candidate.performance, {
          uploadBytes: source.bytes,
          packagedBytes: totalBytes,
          mainAssetBytes: mainAsset.bytes,
          groundTextureBytes: groundAssetFile.bytes,
          fileCount: files.length,
          dependencyCount: Math.max(0, files.length - 1),
          format,
        }),
        skipped: false,
      });
      const next = assignEnvironment(previous, beatId, assignment, now);

      await installStagingDirectory(stagingRoot, destination, () => writeStateAtomic(manifestPath, next));
      // Asset bundles are intentionally retained. More than one beat may point
      // at the same panorama + ground pair, and deleting a replaced beat's
      // previous folder here could invalidate another beat or saved checkpoint.
      return jsonClone(next);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  function updateDraft({
    beatId = null,
    skipped,
    transform,
    rendering,
    movementCue,
  } = {}) {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      const normalizedBeatId = optionalBeatId(beatId);
      const previousAssignment = editableAssignmentForBeat(previous, normalizedBeatId);
      if (!previousAssignment.asset && skipped !== true) {
        throw new Error("Upload an environment asset before editing its draft.");
      }
      if (skipped !== undefined && typeof skipped !== "boolean") {
        throw new TypeError("skipped must be a boolean.");
      }
      if (transform !== undefined && !isPlainObject(transform)) {
        throw new TypeError("transform must be an object.");
      }
      if (rendering !== undefined && !isPlainObject(rendering)) {
        throw new TypeError("rendering must be an object.");
      }
      if (movementCue !== undefined && !isPlainObject(movementCue)) {
        throw new TypeError("movementCue must be an object.");
      }
      const assignment = normalizeEnvironmentAssignment({
        ...previousAssignment,
        ...(skipped !== undefined ? { skipped } : {}),
        transform: deepMerge({}, previousAssignment.transform, transform),
        rendering: deepMerge({}, previousAssignment.rendering, rendering),
        movementCue: movementCue === undefined
          ? normalizeEnvironmentMovementCue(previousAssignment.movementCue)
          : normalizeEnvironmentMovementCue({
            ...movementCue,
            style: previousAssignment.movementCue?.style,
            texture: previousAssignment.movementCue?.texture,
          }, previousAssignment.movementCue),
      });
      const next = assignEnvironment(previous, normalizedBeatId, assignment);
      await writeStateAtomic(manifestPath, next);
      return jsonClone(next);
    });
  }

  function applyAssignment({
    sourceBeatId,
    targetBeatIds,
    expectedRevision,
  } = {}) {
    return serializeMutation(async () => {
      const previous = await readState(manifestPath);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new TypeError("expectedRevision must be a non-negative integer.");
      }
      if (previous.revision !== expectedRevision) {
        const error = new Error("Environment Enhancement changed before the selected beats were updated.");
        error.code = "ENVIRONMENT_REVISION_CONFLICT";
        error.statusCode = 409;
        throw error;
      }
      const sourceId = requireBeatId(sourceBeatId, "sourceBeatId");
      const targets = uniqueBeatIds(targetBeatIds, "targetBeatIds");
      if (!targets.length) throw new TypeError("targetBeatIds must include at least one beat.");
      if (targets.includes(sourceId)) {
        throw new TypeError("targetBeatIds must not include sourceBeatId.");
      }
      const sourceAssignment = effectiveEnvironmentAssignment(previous, sourceId);
      if (!sourceAssignment?.asset || sourceAssignment.skipped === true) {
        throw new Error("The source beat does not have an environment asset to apply.");
      }
      const assignmentsByBeat = {
        ...previous.assignmentsByBeat,
        ...Object.fromEntries(targets.map((beatId) => [
          beatId,
          jsonClone(sourceAssignment),
        ])),
      };
      const next = touch(withTopLevelAssignment(previous, sourceAssignment), {
        assignmentsByBeat,
      });
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
    selectSource,
    importUpload,
    importGenerated,
    updateDraft,
    applyAssignment,
    assetPathFromUrl,
    paths: Object.freeze({ assetRoot, manifestPath, storyRoot }),
  };
}

export function effectiveEnvironmentAssignment(state, beatId) {
  const source = isPlainObject(state) ? state : emptyState();
  const normalizedBeatId = optionalBeatId(beatId);
  if (
    normalizedBeatId
    && isPlainObject(source.assignmentsByBeat)
    && Object.hasOwn(source.assignmentsByBeat, normalizedBeatId)
  ) {
    const direct = source.assignmentsByBeat[normalizedBeatId];
    return isPlainObject(direct) ? normalizeEnvironmentAssignment(direct) : null;
  }
  if (isPlainObject(source.defaultAssignment)) {
    return normalizeEnvironmentAssignment(source.defaultAssignment);
  }
  return null;
}

function editableAssignmentForBeat(state, beatId) {
  return effectiveEnvironmentAssignment(state, beatId) || emptyAssignment();
}

function emptyAssignment() {
  return {
    selectedSource: null,
    pendingSource: null,
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
    movementCue: jsonClone(DEFAULT_ENVIRONMENT_MOVEMENT_CUE),
    performance: {},
    skipped: false,
  };
}

function emptyState() {
  return {
    schemaVersion: ENVIRONMENT_STORE_SCHEMA_VERSION,
    revision: 0,
    createdAt: null,
    updatedAt: null,
    selectedSource: null,
    pendingSource: null,
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
    movementCue: jsonClone(DEFAULT_ENVIRONMENT_MOVEMENT_CUE),
    performance: {},
    skipped: false,
    defaultAssignment: null,
    assignmentsByBeat: {},
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

  const value = omitRetiredEnvironmentConsentMetadata(JSON.parse(source));
  if (!isPlainObject(value) || value.schemaVersion !== ENVIRONMENT_STORE_SCHEMA_VERSION) {
    throw new Error(`Invalid environment store schema in ${manifestPath}.`);
  }
  // Locks lived in this manifest before checkpoint status moved to decisions.
  // Dropping only those legacy fields preserves the selected asset and tuning;
  // the next edit persists the normalized, editable manifest.
  const {
    locked: _legacyLocked,
    lockedAt: _legacyLockedAt,
    ...editableValue
  } = value;
  const hasScopedAssignments = Object.hasOwn(value, "defaultAssignment")
    || Object.hasOwn(value, "assignmentsByBeat");
  const defaultAssignment = hasScopedAssignments
    ? (isPlainObject(value.defaultAssignment)
      ? normalizeEnvironmentAssignment(value.defaultAssignment)
      : null)
    : value.asset
      ? assignmentFromTopLevel(value)
      : null;
  const assignmentsByBeat = normalizeAssignmentsByBeat(value.assignmentsByBeat);
  return {
    ...emptyState(),
    ...editableValue,
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    movementCue: normalizeEnvironmentMovementCue(editableValue.movementCue),
    skipped: editableValue.skipped === true,
    defaultAssignment,
    assignmentsByBeat,
  };
}

function normalizeEnvironmentAssignment(value) {
  const source = omitRetiredEnvironmentConsentMetadata(isPlainObject(value) ? value : {});
  return {
    ...emptyAssignment(),
    ...jsonClone(source),
    transform: deepMerge({}, DEFAULT_TRANSFORM, source.transform),
    rendering: deepMerge({}, DEFAULT_RENDERING, source.rendering),
    movementCue: normalizeEnvironmentMovementCue(source.movementCue),
    performance: isPlainObject(source.performance) ? jsonClone(source.performance) : {},
    skipped: source.skipped === true,
  };
}

function normalizeAssignmentsByBeat(value) {
  if (!isPlainObject(value)) return {};
  const result = {};
  for (const [rawBeatId, assignment] of Object.entries(value)) {
    const beatId = optionalBeatId(rawBeatId);
    if (!beatId) continue;
    result[beatId] = isPlainObject(assignment)
      ? normalizeEnvironmentAssignment(assignment)
      : null;
  }
  return result;
}

function assignmentFromTopLevel(value) {
  const result = {};
  for (const key of ENVIRONMENT_ASSIGNMENT_KEYS) {
    if (Object.hasOwn(value, key)) result[key] = jsonClone(value[key]);
  }
  return normalizeEnvironmentAssignment(result);
}

function withTopLevelAssignment(state, assignment) {
  const normalized = normalizeEnvironmentAssignment(assignment);
  return {
    ...state,
    ...Object.fromEntries(ENVIRONMENT_ASSIGNMENT_KEYS.map((key) => [
      key,
      jsonClone(normalized[key]),
    ])),
  };
}

function assignEnvironment(previous, beatId, assignment, now = new Date().toISOString()) {
  const normalized = normalizeEnvironmentAssignment(assignment);
  const projection = withTopLevelAssignment(previous, normalized);
  if (beatId) {
    return touch(projection, {
      assignmentsByBeat: {
        ...previous.assignmentsByBeat,
        [beatId]: normalized,
      },
    }, now);
  }
  return touch(projection, {
    defaultAssignment: normalized,
  }, now);
}

function optionalBeatId(value) {
  if (value === undefined || value === null || value === "") return null;
  return requireBeatId(value, "beatId");
}

function requireBeatId(value, label) {
  const beatId = requireNonEmptyString(value, label);
  if (containsControlCharacter(beatId)) throw new TypeError(`${label} must not contain control characters.`);
  return beatId;
}

function uniqueBeatIds(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return [...new Set(value.map((beatId) => requireBeatId(beatId, label)))];
}

export function normalizeEnvironmentMovementCue(value, fallback = DEFAULT_ENVIRONMENT_MOVEMENT_CUE) {
  const source = isPlainObject(value) ? value : {};
  const baseline = isPlainObject(fallback) ? fallback : DEFAULT_ENVIRONMENT_MOVEMENT_CUE;
  const textureSource = Object.hasOwn(source, "texture")
    ? source.texture
    : baseline.texture;
  const texture = isPlainObject(textureSource)
    ? normalizeGroundTextureDescriptor(textureSource)
    : null;
  const fallbackOpacity = boundedMovementCueNumber(
    baseline.opacity,
    DEFAULT_ENVIRONMENT_MOVEMENT_CUE.opacity,
    MOVEMENT_CUE_LIMITS.opacityMinimum,
    MOVEMENT_CUE_LIMITS.opacityMaximum,
  );
  const fallbackPosition = normalizedMovementCuePosition(
    baseline.position,
    DEFAULT_ENVIRONMENT_MOVEMENT_CUE.position,
  );
  return {
    enabled: source.enabled === undefined ? baseline.enabled === true : source.enabled === true,
    style: texture ? "generated" : "sand",
    texture,
    position: normalizedMovementCuePosition(source.position, fallbackPosition),
    widthMeters: boundedMovementCueNumber(
      source.widthMeters,
      baseline.widthMeters,
      MOVEMENT_CUE_LIMITS.sizeMinimum,
      MOVEMENT_CUE_LIMITS.sizeMaximum,
    ),
    depthMeters: boundedMovementCueNumber(
      source.depthMeters,
      baseline.depthMeters,
      MOVEMENT_CUE_LIMITS.sizeMinimum,
      MOVEMENT_CUE_LIMITS.sizeMaximum,
    ),
    thicknessMeters: boundedMovementCueNumber(
      source.thicknessMeters,
      baseline.thicknessMeters,
      MOVEMENT_CUE_LIMITS.thicknessMinimum,
      MOVEMENT_CUE_LIMITS.thicknessMaximum,
    ),
    textureScaleMeters: boundedMovementCueNumber(
      source.textureScaleMeters,
      baseline.textureScaleMeters,
      MOVEMENT_CUE_LIMITS.textureScaleMinimum,
      MOVEMENT_CUE_LIMITS.textureScaleMaximum,
    ),
    opacity: boundedMovementCueNumber(
      source.opacity,
      fallbackOpacity,
      MOVEMENT_CUE_LIMITS.opacityMinimum,
      MOVEMENT_CUE_LIMITS.opacityMaximum,
    ),
  };
}

function normalizedMovementCuePosition(value, fallback) {
  const source = Array.isArray(value) ? value : [];
  return [0, 1, 2].map((index) => boundedMovementCueNumber(
    source[index],
    fallback[index],
    MOVEMENT_CUE_LIMITS.positionMinimum,
    MOVEMENT_CUE_LIMITS.positionMaximum,
  ));
}

function boundedMovementCueNumber(value, fallback, minimum, maximum) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.max(minimum, Math.min(maximum, fallbackNumber))
    : minimum;
  if (value === null || value === "" || typeof value === "boolean") return safeFallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : safeFallback;
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

  const candidate = normalizeCandidate(upload.candidate);
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
  if (!MANUAL_UPLOAD_EXTENSIONS.has(extension)) {
    throw new TypeError("upload.filename must end in .hdr or .exr for a 360° image.");
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
      kind: "file",
      filename,
      expectedBytes,
    },
  };
}

function normalizeGeneratedUpload(upload) {
  if (!isPlainObject(upload) || !isPlainObject(upload.candidate)) {
    throw new TypeError("generated upload must contain a candidate object.");
  }
  if (upload.body === undefined || upload.body === null) {
    throw new TypeError("generated upload.body is required.");
  }

  const candidate = normalizeCandidate(upload.candidate);
  if (
    candidate.provider !== "codex-cli"
    || candidate.provenance?.source !== "codex-cli-image-generation"
    || candidate.provenance?.generated !== true
  ) {
    throw new TypeError("generated upload must come from Codex CLI image generation.");
  }
  const filename = safeFilename(upload.filename, "environment.png", "generated upload.filename");
  if (path.extname(filename).toLowerCase() !== GENERATED_UPLOAD_EXTENSION) {
    throw new TypeError("generated upload.filename must end in .png.");
  }
  const expectedBytes = normalizeExpectedBytes(
    upload.expectedBytes,
    "generated upload.expectedBytes",
  );

  return {
    body: upload.body,
    candidate,
    provider: candidate.provider,
    providerAssetId: candidate.providerAssetId,
    providerAssetKey: `${slug(candidate.provider)}-${slug(candidate.providerAssetId)}`,
    sourceMetadata: deepMerge({}, isPlainObject(upload.sourceMetadata) ? upload.sourceMetadata : {}, {
      importMethod: "codex-cli-generation",
      originalFilename: filename,
    }),
    upload: {
      kind: "generated",
      filename,
      expectedBytes,
    },
  };
}

function normalizeGeneratedGroundUpload(value) {
  if (!isPlainObject(value)) {
    throw new TypeError("Every environment panorama requires a generated matching ground texture.");
  }
  if (value.body === undefined || value.body === null) {
    throw new TypeError("Generated matching ground body is required.");
  }
  const metadata = isPlainObject(value.metadata) ? jsonClone(value.metadata) : {};
  if (
    metadata.provider !== "codex-cli"
    || metadata.tool !== "image_generation"
    || metadata.generationRole !== "matching-ground"
  ) {
    throw new TypeError("Matching ground must come from Codex CLI image generation.");
  }
  const filename = safeFilename(value.filename, "ground.png", "generated ground filename");
  if (path.extname(filename).toLowerCase() !== ".png") {
    throw new TypeError("Generated ground filename must end in .png.");
  }
  return {
    body: value.body,
    filename,
    expectedBytes: normalizeExpectedBytes(value.expectedBytes, "generated ground expectedBytes"),
    metadata,
  };
}

function normalizeGroundTextureDescriptor(value) {
  const publicPath = firstNonEmptyString(value.publicPath);
  const entryPath = firstNonEmptyString(value.entryPath);
  const localPath = firstNonEmptyString(value.localPath);
  if (!publicPath || !entryPath) return null;
  return {
    role: "ground-texture",
    entryPath,
    ...(localPath ? { localPath } : {}),
    publicPath,
    format: "png",
    mediaType: "image/png",
    sha256: firstNonEmptyString(value.sha256),
    bytes: Number.isSafeInteger(Number(value.bytes)) && Number(value.bytes) >= 0
      ? Number(value.bytes)
      : 0,
    sourcePanoramaSha256: firstNonEmptyString(value.sourcePanoramaSha256),
    generation: isPlainObject(value.generation) ? jsonClone(value.generation) : null,
  };
}

function normalizeCandidate(value) {
  if (!isPlainObject(value)) throw new TypeError("environment source must be an object.");
  const candidate = jsonClone(value);
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
    throw new TypeError("environment source must identify both its provider and provider asset id.");
  }
  return {
    ...candidate,
    provider,
    providerAssetId,
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

async function validateGeneratedGroundAsset(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".png") {
    throw new Error("Generated matching ground must be a PNG image.");
  }
  const prefix = await readPrefix(filePath, 64);
  const resolution = pngResolution(prefix);
  if (!resolution) throw new Error("Generated matching ground has an invalid PNG signature or IHDR header.");
  if (
    !Number.isSafeInteger(resolution.width)
    || !Number.isSafeInteger(resolution.height)
    || resolution.width <= 0
    || resolution.height <= 0
  ) {
    throw new Error("Generated matching ground has invalid pixel dimensions.");
  }
  if (resolution.width !== resolution.height) {
    throw new Error("Generated matching ground must use a square 1:1 texture.");
  }
}

async function validateMainAsset(filePath, uploadKind = "file") {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".hdr") {
    const prefix = await readPrefix(filePath, 64 * 1024);
    const header = prefix.toString("ascii");
    if (!header.startsWith("#?RADIANCE") && !header.startsWith("#?RGBE")) {
      throw new Error("Uploaded HDR asset is missing a Radiance/RGBE header.");
    }
    const resolution = hdrResolution(header);
    if (!resolution) throw new Error("Uploaded HDR image is missing its pixel dimensions.");
    assertEquirectangularDimensions(resolution.width, resolution.height, "HDR");
    return;
  }
  if (extension === ".exr") {
    const prefix = await readPrefix(filePath, 64 * 1024);
    if (prefix.length < 4 || prefix.readUInt32LE(0) !== 0x01312f76) {
      throw new Error("Uploaded EXR asset has an invalid magic number.");
    }
    const resolution = exrResolution(prefix);
    if (!resolution) throw new Error("Uploaded EXR image is missing a readable dataWindow.");
    assertEquirectangularDimensions(resolution.width, resolution.height, "EXR");
    return;
  }
  if (extension === ".png") {
    if (uploadKind !== "generated") {
      throw new Error("PNG environments may only be installed from Codex CLI generation.");
    }
    const prefix = await readPrefix(filePath, 64);
    const resolution = pngResolution(prefix);
    if (!resolution) throw new Error("Generated PNG image has an invalid signature or IHDR header.");
    assertEquirectangularDimensions(resolution.width, resolution.height, "PNG", "Generated");
  }
}

function hdrResolution(header) {
  const yThenX = header.match(/(?:^|\r?\n)[+-]Y\s+(\d+)\s+[+-]X\s+(\d+)(?:\r?\n|$)/m);
  if (yThenX) return { width: Number(yThenX[2]), height: Number(yThenX[1]) };
  const xThenY = header.match(/(?:^|\r?\n)[+-]X\s+(\d+)\s+[+-]Y\s+(\d+)(?:\r?\n|$)/m);
  return xThenY ? { width: Number(xThenY[1]), height: Number(xThenY[2]) } : null;
}

function exrResolution(header) {
  if (header.length < 8) return null;
  let offset = 8;
  while (offset < header.length) {
    const nameEnd = header.indexOf(0, offset);
    if (nameEnd < 0) return null;
    if (nameEnd === offset) return null;
    const name = header.toString("utf8", offset, nameEnd);
    offset = nameEnd + 1;
    const typeEnd = header.indexOf(0, offset);
    if (typeEnd < 0 || typeEnd + 5 > header.length) return null;
    const type = header.toString("utf8", offset, typeEnd);
    offset = typeEnd + 1;
    const size = header.readUInt32LE(offset);
    offset += 4;
    if (offset + size > header.length) return null;
    if (name === "dataWindow" && type === "box2i" && size >= 16) {
      const minX = header.readInt32LE(offset);
      const minY = header.readInt32LE(offset + 4);
      const maxX = header.readInt32LE(offset + 8);
      const maxY = header.readInt32LE(offset + 12);
      return { width: maxX - minX + 1, height: maxY - minY + 1 };
    }
    offset += size;
  }
  return null;
}

function pngResolution(header) {
  if (
    header.length < 24
    || !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || header.readUInt32BE(8) !== 13
    || header.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function assertEquirectangularDimensions(width, height, format, action = "Uploaded") {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${action} ${format} image has invalid pixel dimensions.`);
  }
  if (Math.abs(width / height - 2) > 0.01) {
    throw new Error(`${action} ${format} image must use a 2:1 equirectangular aspect ratio for a 360° environment.`);
  }
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

async function installStagingDirectory(stagingRoot, destination, commit = async () => {}) {
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

  try {
    await commit();
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
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
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
}

function mediaTypeForFormat(format) {
  if (format === "hdr") return "image/vnd.radiance";
  if (format === "exr") return "image/x-exr";
  if (format === "png") return "image/png";
  return "application/octet-stream";
}

function encodeEnvironmentEntryPath(value) {
  return String(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function safeFilename(value, fallback, label = "upload.filename") {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (
    !candidate
    || candidate === "."
    || candidate === ".."
    || candidate.includes("/")
    || candidate.includes("\\")
    || candidate.includes("?")
    || candidate.includes("#")
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

function omitRetiredEnvironmentConsentMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((item) => omitRetiredEnvironmentConsentMetadata(item));
  }
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === RETIRED_ENVIRONMENT_METADATA_KEY) continue;
    result[key] = omitRetiredEnvironmentConsentMetadata(item);
  }
  return result;
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
