import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Matrix4, Quaternion, Vector3 } from "three";
import { normalizeStoryVrPointCloudEffects } from "../storyvr-author/point-cloud-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
export const STORYVR_SCHEMA_VERSION = "storyvr-runtime/v1";

export const STORYVR_HOSTING_CONFIG = {
  devServer: {
    command: "vite --host 127.0.0.1",
    assetRootPolicy: "relative-from-story-app",
  },
  httpsServer: {
    command: "python3 https_server.py",
    lanCommand: "python3 https_server.py --lan",
    assetRootPolicy: "repo-absolute-path",
  },
  build: {
    distFolder: "dist-webxr-adaptation",
    basePathForStory(storyFolder, repoRoot = REPO_ROOT) {
      const hostingRoot = hostingRootForPath(storyFolder, repoRoot);
      const relativeStoryPath = pathIsInside(hostingRoot, storyFolder)
        ? toPosix(path.relative(hostingRoot, storyFolder))
        : path.basename(storyFolder);
      return `/${relativeStoryPath}/dist-webxr-adaptation/`;
    },
  },
};

export function hostingRootForPath(targetPath, repoRoot = REPO_ROOT) {
  if (pathIsInside(repoRoot, targetPath)) return repoRoot;
  const workspaceRoot = path.dirname(repoRoot);
  if (pathIsInside(workspaceRoot, targetPath)) return workspaceRoot;
  return repoRoot;
}

function pathIsInside(rootPath, targetPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * @typedef {Object} StoryVRInput
 * @property {string} storyFolder Absolute story container folder.
 * @property {"dev"|"build"} mode Path-resolution mode.
 * @property {string} family Story family strategy id.
 * @property {string} storySlug Story slug derived from the folder name.
 */

/**
 * @typedef {Object} StoryVRRuntimeInstance
 * @property {string} schemaVersion
 * @property {string} id
 * @property {string} family
 * @property {string} slug
 * @property {string} title
 * @property {Object[]} contentUnits Canonical beat-like units consumed by StoryVR runtime code.
 * @property {Object} sceneTopology Canonical spatial/topological story structure.
 * @property {Object[]} assets Canonical asset references.
 * @property {Object} assetRoot Centralized dev/build/hosted path data.
 * @property {Object} interactions Canonical controls, triggers and hotspot metadata.
 * @property {Object[]} diagnostics Non-fatal compatibility findings for this story.
 */

const VIRTUAL_WALK_PATTERNS = [
  /virtual[-_ ]?walk/i,
  /walk[-_ ]?tour/i,
  /walking[-_ ]?tour/i,
];

const SPORTS_PATTERNS = [
  /world[-_ ]?cup/i,
  /super[-_ ]?bowl/i,
  /usmnt/i,
  /pulisic/i,
  /kadarius/i,
  /toney/i,
  /richarlison/i,
  /messi/i,
  /mckennie/i,
  /batshuayi/i,
  /spain[-_ ]?germany/i,
  /canada[-_ ]?belgium/i,
];

const SOURCE_CANDIDATES = [
  { relPath: "webxr-adaptation/data/story-instance.json", kind: "story-instance-json" },
  { relPath: "webxr-adaptation/src/generated/story-instance.json", kind: "generated-json" },
  { relPath: "webxr-adaptation/src/generated/story-instance.js", kind: "generated-js" },
  { relPath: "webxr-adaptation/src/generated/storyInstance.js", kind: "generated-js" },
  { relPath: "webxr-adaptation/src/generated-story-instance.js", kind: "generated-js" },
  { relPath: "webxr-adaptation/src/story-instance.json", kind: "source-json" },
  { relPath: "webxr-adaptation/src/story-instance.js", kind: "source-js" },
  { relPath: "webxr-adaptation/data/beats.json", kind: "beats-json" },
];

export const STORY_FAMILY_STRATEGIES = {
  global: {
    family: "global",
    description: "Root global-migration generated JSON instance.",
    sourceCandidates: SOURCE_CANDIDATES,
    preferredContentFields: ["beats", "storyBeats", "originalContentBeats", "pages", "regions", "sourceBeats"],
  },
  "web2vr-initial": {
    family: "web2vr-initial",
    description: "Initial Web2VR per-story generated JSON instances.",
    sourceCandidates: SOURCE_CANDIDATES,
    preferredContentFields: ["beats", "storyBeats", "originalContentBeats", "pages", "regions", "sourceBeats"],
  },
  louise: {
    family: "louise",
    description: "Louise stories, mostly data/beats.json plus several legacy sports summaries.",
    sourceCandidates: SOURCE_CANDIDATES,
    preferredContentFields: ["beats", "storyBeats", "originalContentBeats", "pages", "captions"],
  },
  jingchen: {
    family: "jingchen",
    description: "Jingchen stories with generated JS/JSON modules and per-story runtime fields.",
    sourceCandidates: SOURCE_CANDIDATES,
    preferredContentFields: ["beats", "storyBeats", "originalContentBeats", "sourceBeats", "pages", "regions"],
  },
};

export async function discoverStoryFolders(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const candidates = [];
  const skipped = [];

  await addIfStoryFolder(candidates, skipped, path.join(repoRoot, "global-migration"), repoRoot, "global");
  await addStoryChildren(candidates, skipped, path.join(repoRoot, "web2VR-Initial-Adaptations"), repoRoot, "web2vr-initial");
  await addStoryChildren(candidates, skipped, path.join(repoRoot, "louise-10-stories"), repoRoot, "louise");
  await addJingchenStories(candidates, skipped, path.join(repoRoot, "Jingchen-10-stories"), repoRoot);

  const accepted = [];
  for (const story of candidates) {
    const exclusion = classifyExcludedStory(story.storyFolder, story.slug);
    if (exclusion && !options.includeExcluded) {
      skipped.push({ ...story, reason: exclusion.reason, category: exclusion.category });
    } else {
      accepted.push(story);
    }
  }

  accepted.sort(compareStoryRecords);
  skipped.sort(compareStoryRecords);
  return { accepted, skipped };
}

export async function importStoryAssets(storyFolder, mode = "dev", options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const input = makeStoryInput(storyFolder, mode, repoRoot);
  const exclusion = classifyExcludedStory(storyFolder, input.storySlug);
  if (exclusion && !options.includeExcluded) {
    const error = new Error(`Story excluded from StoryVR transformation: ${exclusion.reason}`);
    error.code = "STORYVR_EXCLUDED";
    error.exclusion = exclusion;
    throw error;
  }

  const strategy = STORY_FAMILY_STRATEGIES[input.family];
  if (!strategy) {
    throw new Error(`No StoryVR adapter strategy for ${input.family}`);
  }

  const sourceInfo = await findSourceInfo(storyFolder, strategy, options);
  const raw = await loadSource(sourceInfo);
  const runtime = normalizeRuntimeInstance(raw, input, sourceInfo, strategy, repoRoot);
  validateRuntimeInstance(runtime);
  return runtime;
}

export async function importFetchedStoryResources(resourceFolder, mode = "dev", options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const fullResourceFolder = path.resolve(resourceFolder);
  const metadataRoot = path.join(fullResourceFolder, "metadata");
  const storyStructurePath = path.join(metadataRoot, "story_structure_candidates.json");
  const manifestPath = path.join(metadataRoot, "asset_manifest.json");
  const sourceDiscoveryPath = path.join(metadataRoot, "source_discovery.json");

  if (!(await exists(storyStructurePath))) {
    throw new Error(`Fetched resource folder is missing metadata/story_structure_candidates.json: ${fullResourceFolder}`);
  }
  if (!(await exists(manifestPath))) {
    throw new Error(`Fetched resource folder is missing metadata/asset_manifest.json: ${fullResourceFolder}`);
  }

  const storyStructure = JSON.parse(await readFile(storyStructurePath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sourceDiscovery = (await exists(sourceDiscoveryPath))
    ? JSON.parse(await readFile(sourceDiscoveryPath, "utf8"))
    : {};
  const slug = firstNonEmpty(sourceDiscovery.slug, storySlugFromUrl(sourceDiscovery.story_url || storyStructure.story_url), inferredSlugFromResourceFolder(fullResourceFolder));
  const storyTitle = firstNonEmpty(storyStructure.title, sourceDiscovery.title, slug);
  const assets = assetsFromManifest(manifest);
  const pointCloudEffects = normalizeStoryVrPointCloudEffects(storyStructure.point_cloud_effects, assets);
  const sourceSpatialPlacements = normalizeFetchedSourceSpatialPlacements(storyStructure, assets);
  const rawContentUnits = contentUnitsFromFetchedStructure(storyStructure, { storyTitle });
  const variantGroups = variantGroupsFromFetchedStructure(storyStructure, assets);
  const unresolvedVariantGroupCount = arrayOr(storyStructure.unresolved_variant_groups).length;
  const contentUnits = collapseFetchedVariantGroups(rawContentUnits, variantGroups, storyTitle, assets);
  linkImageAssetsToFetchedContentUnits(contentUnits, assets, storyStructure);
  const diagnostics = [];

  if (!contentUnits.length) {
    diagnostics.push({
      severity: "warning",
      code: "NO_FETCHED_TEXT_UNITS",
      message: "No scroll steps, slides, narrative text parts or text matches with usable text were found in the fetched metadata.",
    });
  }
  if (unresolvedVariantGroupCount > 0) {
    diagnostics.push({
      severity: "warning",
      code: "UNRESOLVED_NESTED_VARIANT_CONTROLS",
      message: `${unresolvedVariantGroupCount} dependent-looking variant control group(s) were omitted because the collector did not establish a parent interaction path.`,
    });
  }

  const runtime = {
    schemaVersion: STORYVR_SCHEMA_VERSION,
    id: `${slug}-storyvr-fetched`,
    family: "fetched-resource",
    slug,
    title: storyTitle,
    byline: "",
    sourceUrl: firstNonEmpty(sourceDiscovery.story_url, storyStructure.story_url, ""),
    source: {
      family: "fetched-resource",
      strategy: "single fetched web resource folder",
      storyFolder: options.storyFolder ? path.resolve(options.storyFolder) : null,
      storyFolderRel: options.storyFolder ? toPosix(path.relative(repoRoot, path.resolve(options.storyFolder))) : null,
      sourcePath: fullResourceFolder,
      sourcePathRel: toPosix(path.relative(repoRoot, fullResourceFolder)),
      sourceFormat: "fetched-resource-folder",
      originalSchema: {
        storyStructure: summarizeOriginalSchema(storyStructure),
        assetManifestCount: Array.isArray(manifest) ? manifest.length : 0,
      },
      generatedAt: sourceDiscovery.timestamp || storyStructure.timestamp || null,
    },
    assetRoot: normalizeFetchedAssetRoot(fullResourceFolder, mode, repoRoot),
    style: { colors: {}, tokens: {} },
    contentUnits,
    ...(variantGroups.length ? { variantGroups } : {}),
    ...(pointCloudEffects.length ? { pointCloudEffects } : {}),
    ...(sourceSpatialPlacements.length ? { sourceSpatialPlacements } : {}),
    sceneTopology: {
      kind: "fetched-resource-sequence",
      routeStops: [],
      regions: [],
      markers: [],
      bodies: [],
      countries: [],
      modelGroups: {},
      sections: [...new Set(contentUnits.map((unit) => unit.section).filter(Boolean))],
      questions: {},
      cameraPresets: [],
      spatialRelationships: {
        headings: arrayOr(storyStructure.headings),
        imageGroups: arrayOr(storyStructure.image_groups),
        jsonCandidates: arrayOr(storyStructure.json_candidates),
      },
    },
    assets,
    interactions: {
      controls: ["next", "back"],
      keyboard: {},
      xrControllers: {},
      locomotion: "story-fixed",
      lifecycle: {},
      triggers: [],
      hotspots: [],
      ...(variantGroups.length ? { variantGroups } : {}),
    },
    compatibility: {
      acceptedForTransformation: true,
      excludedCategories: ["virtual-walk", "sports"],
      sourceAdapter: "single fetched web resource folder",
    },
    diagnostics,
    rawSummary: {
      contentUnitCount: contentUnits.length,
      assetManifestCount: Array.isArray(manifest) ? manifest.length : 0,
      slideCount: arrayOr(storyStructure.slides).length,
      scrollStepCount: arrayOr(storyStructure.scroll_steps).length,
      captionCount: arrayOr(storyStructure.captions).length,
      headingCount: arrayOr(storyStructure.headings).length,
      textOnlyPartCount: arrayOr(storyStructure.text_only_parts).length,
      variantGroupCount: variantGroups.length,
      unresolvedVariantGroupCount,
      ...(pointCloudEffects.length ? { pointCloudEffectCount: pointCloudEffects.length } : {}),
      ...(sourceSpatialPlacements.length ? { sourceSpatialPlacementCount: sourceSpatialPlacements.length } : {}),
    },
  };

  runtime.beats = runtime.contentUnits;
  validateRuntimeInstance(runtime);
  return runtime;
}

export async function migrateStories(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const mode = options.mode || "dev";
  const outRoot = options.outRoot || path.join(repoRoot, "tools/storyvr-adapter/out");
  const { accepted, skipped } = await discoverStoryFolders({ repoRoot, includeExcluded: options.includeExcluded });
  const migrated = [];
  const rejected = [];

  for (const story of accepted) {
    try {
      const runtime = await importStoryAssets(story.storyFolder, mode, {
        repoRoot,
        includeExcluded: options.includeExcluded,
        generateMissing: options.generateMissing,
      });
      const outputPath = outputPathForRuntime(outRoot, runtime);
      if (!options.scanOnly) {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
      }
      migrated.push({
        family: runtime.family,
        slug: runtime.slug,
        storyFolder: runtime.source.storyFolder,
        outputPath: options.scanOnly ? null : outputPath,
        sourcePath: runtime.source.sourcePath,
        contentUnitCount: runtime.contentUnits.length,
        diagnosticCount: runtime.diagnostics.length,
      });
    } catch (error) {
      rejected.push({
        family: story.family,
        slug: story.slug,
        storyFolder: story.storyFolder,
        reason: error.message,
        code: error.code || "STORYVR_ADAPTER_ERROR",
      });
    }
  }

  const report = {
    schemaVersion: "storyvr-migration-report/v1",
    generatedAt: new Date().toISOString(),
    mode,
    scanOnly: Boolean(options.scanOnly),
    includeExcluded: Boolean(options.includeExcluded),
    generateMissing: Boolean(options.generateMissing),
    counts: {
      accepted: accepted.length,
      migrated: migrated.length,
      skipped: skipped.length,
      rejected: rejected.length,
    },
    conflicts: STRUCTURAL_CONFLICTS,
    accepted,
    skipped,
    migrated,
    rejected,
  };

  if (!options.scanOnly || options.writeScanReport) {
    await mkdir(outRoot, { recursive: true });
    await writeFile(path.join(outRoot, "migration-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}

export const STRUCTURAL_CONFLICTS = [
  {
    id: "instance-schema-divergence",
    resolution: "Normalize beats/pages/sourceBeats/regions into contentUnits with original references preserved.",
  },
  {
    id: "runtime-import-format",
    resolution: "Load JSON directly and generated JS modules via ESM import; never import runtime main.js.",
  },
  {
    id: "asset-root-policy",
    resolution: "Emit original, relative-from-app, repo-hosted and filesystem asset roots in one canonical assetRoot object.",
  },
  {
    id: "scene-topology",
    resolution: "Map route stops, regions, markers, bodies, countries and model groups into sceneTopology.",
  },
  {
    id: "interaction-lifecycle",
    resolution: "Map reader actions, transitions, keyboard/controller controls, hotspots and trigger fields into interactions.",
  },
  {
    id: "folder-conventions",
    resolution: "Discover all known generated/story/data/beats locations through family strategies.",
  },
];

function normalizeRuntimeInstance(raw, input, sourceInfo, strategy, repoRoot) {
  const diagnostics = [];
  const storyFolderRel = toPosix(path.relative(repoRoot, input.storyFolder));
  const rawAssetRoot = raw.assetRoot || raw.captureRoot || inferRawAssetRoot(input.storyFolder, repoRoot);
  const contentUnits = normalizeContentUnits(raw, strategy, diagnostics);

  const runtime = {
    schemaVersion: STORYVR_SCHEMA_VERSION,
    id: raw.id || raw.storySlug || raw.slug || `${input.storySlug}-storyvr`,
    family: input.family,
    slug: input.storySlug,
    title: firstNonEmpty(raw.title, raw.headline, raw.source?.headline, raw.sourceTitle, input.storySlug),
    byline: firstNonEmpty(raw.byline, raw.source?.byline, ""),
    sourceUrl: firstNonEmpty(raw.sourceUrl, raw.source?.url, raw.story_url, ""),
    source: {
      family: input.family,
      strategy: strategy.family,
      storyFolder: input.storyFolder,
      storyFolderRel,
      sourcePath: sourceInfo.path,
      sourcePathRel: toPosix(path.relative(repoRoot, sourceInfo.path)),
      sourceFormat: sourceInfo.kind,
      originalSchema: summarizeOriginalSchema(raw),
      generatedAt: raw.generatedAt || null,
    },
    assetRoot: normalizeAssetRoot(rawAssetRoot, input.storyFolder, input.mode, repoRoot),
    style: {
      colors: raw.colors || raw.style?.colors || {},
      tokens: raw.style || raw.tokens || {},
    },
    contentUnits,
    sceneTopology: normalizeSceneTopology(raw, contentUnits),
    assets: normalizeAssets(raw, diagnostics),
    interactions: normalizeInteractions(raw, contentUnits),
    compatibility: {
      acceptedForTransformation: true,
      excludedCategories: ["virtual-walk", "sports"],
      sourceAdapter: strategy.description,
    },
    diagnostics,
    rawSummary: {
      beatCount: Array.isArray(raw.beats) ? raw.beats.length : raw.beatCount || contentUnits.length,
      storyBeatCount: Array.isArray(raw.storyBeats) ? raw.storyBeats.length : 0,
      pageCount: Array.isArray(raw.pages) ? raw.pages.length : 0,
      sourceBeatCount: Array.isArray(raw.sourceBeats) ? raw.sourceBeats.length : 0,
      regionCount: Array.isArray(raw.regions) ? raw.regions.length : 0,
      routeStopCount: Array.isArray(raw.routeStops) ? raw.routeStops.length : 0,
      frameCount: raw.frameCount || 0,
    },
  };

  runtime.beats = runtime.contentUnits;
  return runtime;
}

function normalizeContentUnits(raw, strategy, diagnostics) {
  const source = findContentSource(raw, strategy);
  if (!source.items.length) {
    diagnostics.push({
      severity: "error",
      code: "NO_CONTENT_UNITS",
      message: "No beats/storyBeats/pages/sourceBeats/regions array was found in the selected source artifact.",
    });
    return [];
  }

  return source.items.map((unit, index) => {
    const text = firstNonEmpty(
      unit.verbatimText,
      unit.text,
      unit.narration,
      unit.caption,
      unit.copy,
      unit.sourceText,
      Array.isArray(unit.facts) ? unit.facts.join("\n") : "",
      "",
    );
    if (!text) {
      diagnostics.push({
        severity: "warning",
        code: "EMPTY_CONTENT_TEXT",
        message: `Content unit ${unit.id || index} has no recognized text/caption/narration field.`,
      });
    }

    return {
      id: String(unit.id || unit.sourceSlideId || `${source.field}-${String(index + 1).padStart(2, "0")}`),
      index: numberOr(unit.index, numberOr(unit.sourceSlideIndex, index)),
      kind: firstNonEmpty(unit.sourceKind, unit.mode, unit.visibleLayer, source.field),
      section: firstNonEmpty(unit.section, unit.kicker, unit.navLabel, "Story"),
      title: firstNonEmpty(unit.title, unit.navLabel, unit.kicker, `Beat ${index + 1}`),
      text,
      sourceIds: compact([
        unit.sourceId,
        unit.sourceSlideId,
        unit.sourceStepId,
        unit.sourceKind,
        ...(Array.isArray(unit.sourceTextIds) ? unit.sourceTextIds : []),
      ]),
      media: compactObject({
        image: unit.image,
        sourceImage: unit.sourceImage,
        imageKey: unit.imageKey,
        photoSetKey: unit.photoSetKey,
        modelKey: unit.modelKey,
        modelIds: unit.modelIds,
        models: unit.models,
        markerIds: unit.markerIds || unit.markers,
        routeProgress: unit.routeProgress,
        visibleLayer: unit.visibleLayer,
      }),
      scene: compactObject({
        camera: unit.camera,
        focus: unit.focus,
        focusKey: unit.focusKey,
        focusCountries: unit.focusCountries,
        focusCorridors: unit.focusCorridors,
        focusPoint: unit.focusPoint,
        regionId: unit.regionId,
        routeStop: unit.focus?.routeStop,
        highlightedNodes: unit.highlightedNodes,
        modelNodes: unit.modelNodes,
        highlightedMaterials: unit.highlightedMaterials,
        highlightMaterials: unit.highlightMaterials,
        modelGroups: unit.modelGroups,
        visualState: unit.visualState,
        effect: unit.effect,
        chart: unit.chart,
      }),
      lifecycle: compactObject({
        transition: unit.transition,
        readerAction: unit.readerAction,
        visualFocus: unit.visualFocus,
        sourceTextPreservation: unit.sourceTextPreservation,
        duration: unit.duration,
        time: unit.time,
      }),
      interactions: compactObject({
        hotspots: unit.hotspots,
        triggers: compact([unit.entryTrigger, unit.trigger, unit.action]),
      }),
      originalField: source.field,
    };
  });
}

function contentUnitsFromFetchedStructure(storyStructure, options = {}) {
  const candidates = [];
  const storyTitle = firstNonEmpty(options.storyTitle, storyStructure.title, storyStructure.headline, storyStructure.storyTitle, storyStructure.story_title, "");
  addFetchedUnits(candidates, storyStructure.scroll_steps, "scroll-step", "Scroll");
  addFetchedUnits(candidates, storyStructure.slides, "slide", "Slide");
  addFetchedUnits(candidates, storyStructure.text_only_parts, "text-only", "Narrative Text", "text_only_parts");
  addFetchedUnits(candidates, storyStructure.downloaded_text_matches, "text-match", "Downloaded Text");

  const units = dedupeFetchedUnits(sortFetchedUnitsBySourceOrder(candidates))
    .filter((unit) => unit.text)
    .map((unit, index) => {
      const { __sourceOrder, ...cleanUnit } = unit;
      return {
        ...cleanUnit,
        id: cleanUnit.id || `${cleanUnit.kind}-${String(index + 1).padStart(2, "0")}`,
        index,
        title: cleanUnit.title || titleFromText(cleanUnit.text, index),
        originalField: cleanUnit.originalField || cleanUnit.kind,
      };
    });
  return applyBeatTitlesToFetchedUnits(applyHeadingsToFetchedUnits(units, storyStructure.headings), storyTitle);
}

function variantGroupId(value, fallback) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function variantAssetMatches(asset, value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return false;
  const candidates = [
    asset?.id,
    asset?.path,
    asset?.url,
    asset?.originalUrl,
    path.basename(String(asset?.path || "")),
    path.basename(String(asset?.url || "")),
  ].map((candidate) => String(candidate || "").trim().toLowerCase()).filter(Boolean);
  return candidates.some((candidate) => candidate === key || candidate.endsWith(`/${key}`) || key.endsWith(`/${candidate}`));
}

function variantGroupsFromFetchedStructure(storyStructure, assets) {
  return arrayOr(storyStructure.variant_groups).flatMap((group, groupIndex) => {
    const hierarchyRole = String(group?.hierarchy?.role || "");
    if (["nested", "visual-child", "unresolved-nested-control"].includes(hierarchyRole)) return [];
    if (group?.hierarchy?.parentGroupId || group?.hierarchy?.parent_group_id) return [];
    const id = variantGroupId(group?.id || group?.title, `variant-group-${groupIndex + 1}`);
    const options = arrayOr(group?.options).flatMap((option, optionIndex) => {
      const assetValues = [
        ...arrayOr(option?.asset_ids),
        ...arrayOr(option?.asset_files),
        ...arrayOr(option?.asset_urls),
        option?.assetId,
        option?.assetFile,
        option?.assetUrl,
      ].filter(Boolean);
      const assetIds = assets.filter((asset) => assetValues.some((value) => variantAssetMatches(asset, value))).map((asset) => asset.id);
      const label = firstNonEmpty(option?.label, option?.title, `Option ${optionIndex + 1}`);
      if (!label) return [];
      return [{
        id: variantGroupId(option?.id || label, `${id}-option-${optionIndex + 1}`),
        label,
        text: firstNonEmpty(option?.text, label),
        sourceOrder: Number.isFinite(Number(option?.sourceOrder)) ? Number(option.sourceOrder) : optionIndex,
        domOrder: Number.isFinite(Number(option?.domOrder)) ? Number(option.domOrder) : null,
        assetIds: Array.from(new Set(assetIds)),
        visualChildren: arrayOr(option?.visual_children).map((child) => ({
          ...child,
          options: arrayOr(child?.options).map((childOption) => ({
            ...childOption,
            assetIds: assets
              .filter((asset) => [
                ...arrayOr(childOption?.asset_ids),
                ...arrayOr(childOption?.asset_files),
                ...arrayOr(childOption?.asset_urls),
              ].some((value) => variantAssetMatches(asset, value)))
              .map((asset) => asset.id),
          })),
        })),
        evidence: option?.evidence || null,
      }];
    }).sort((left, right) => left.sourceOrder - right.sourceOrder);
    if (options.length < 2) return [];
    const requestedDefault = String(group?.defaultOptionId || "");
    const defaultOptionId = options.some((option) => option.id === requestedDefault) ? requestedDefault : options[0].id;
    return [{
      schemaVersion: "storyvr-source-variant-group/v1",
      id,
      title: firstNonEmpty(group?.title, "Selectable variants"),
      beatId: id,
      domOrder: Number.isFinite(Number(group?.domOrder)) ? Number(group.domOrder) : options[0].domOrder,
      selectionMode: "single",
      defaultOptionId,
      control: {
        kind: firstNonEmpty(group?.control?.kind, "previous-next"),
        previousLabel: firstNonEmpty(group?.control?.previousLabel, "Previous option"),
        nextLabel: firstNonEmpty(group?.control?.nextLabel, "Next option"),
        wrap: group?.control?.wrap !== false,
      },
      options,
      hierarchy: group?.hierarchy && typeof group.hierarchy === "object" ? { ...group.hierarchy } : null,
      evidence: group?.evidence || null,
    }];
  });
}

function variantUnitAssetIds(unit) {
  return arrayOr(unit?.scene?.attributes?.probeAssetFiles)
    .concat(arrayOr(unit?.scene?.attributes?.probeAssetUrls))
    .concat(arrayOr(unit?.sourceIds))
    .map((value) => path.basename(String(value || "")))
    .filter(Boolean);
}

const FETCHED_VARIANT_TEXT_LOCAL_DOM_ORDER_DISTANCE = 10_000;

function fetchedSelectorClassTokens(value) {
  return Array.from(String(value || "").matchAll(/\.([a-z0-9_-]+)/gi), (match) => match[1].toLowerCase());
}

function fetchedSelectorIdToken(value) {
  return String(value || "").match(/#([a-z0-9_-]+)/i)?.[1]?.toLowerCase() || "";
}

function fetchedSelectorTagToken(value) {
  return String(value || "").trim().match(/^([a-z0-9_-]+)/i)?.[1]?.toLowerCase() || "";
}

function fetchedLegacyUnitSelector(unit) {
  const tag = String(unit?.scene?.tag || "").toLowerCase();
  const id = String(unit?.scene?.elementId || "").trim();
  if (id) return `${tag || "*"}#${id}`;
  const classes = String(unit?.scene?.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 4);
  return classes.length ? `${tag || "*"}.${classes.join(".")}` : tag;
}

function fetchedTextUnitSharesVariantContainer(unit, group) {
  const rootSelector = String(group?.evidence?.rootSelector || "").trim();
  if (!rootSelector) return false;
  const selectors = new Set([
    unit?.scene?.selector,
    ...arrayOr(unit?.scene?.ancestorSelectors),
    fetchedLegacyUnitSelector(unit),
  ].map((value) => String(value || "").trim()).filter(Boolean));
  if (selectors.has(rootSelector)) return true;

  const rootId = fetchedSelectorIdToken(rootSelector);
  const rootTag = fetchedSelectorTagToken(rootSelector);
  const rootClasses = fetchedSelectorClassTokens(rootSelector);
  if (!rootId && rootClasses.length < 2) return false;
  return Array.from(selectors).some((selector) => {
    if (rootTag && fetchedSelectorTagToken(selector) && fetchedSelectorTagToken(selector) !== rootTag) return false;
    if (rootId && fetchedSelectorIdToken(selector) !== rootId) return false;
    const classes = new Set(fetchedSelectorClassTokens(selector));
    return rootClasses.every((className) => classes.has(className));
  });
}

function fetchedVariantTextUnitDistance(unit, group) {
  const unitOrder = Number(unit?.scene?.domOrder);
  if (!Number.isFinite(unitOrder)) return Number.POSITIVE_INFINITY;
  const orders = [group?.domOrder, ...arrayOr(group?.options).map((option) => option?.domOrder)]
    .map(Number)
    .filter(Number.isFinite);
  if (!orders.length) return Number.POSITIVE_INFINITY;
  const start = Math.min(...orders);
  const end = Math.max(...orders);
  if (unitOrder >= start && unitOrder <= end) return 0;
  return unitOrder < start ? start - unitOrder : unitOrder - end;
}

function isFetchedAggregateVariantTextUnit(unit, group, optionLabels) {
  if (!unit?.isTextOnly || optionLabels.length < 2) return false;
  if (unit?.lifecycle?.observed?.variantTextRole === "narrative-prefix") return false;
  const key = fetchedTextKey(unit.text);
  const matchCount = optionLabels.filter((label) => key.includes(label)).length;
  const strongCoverage = matchCount >= Math.max(2, Math.ceil(optionLabels.length * 0.75));
  if (!strongCoverage) return false;
  return fetchedTextUnitSharesVariantContainer(unit, group)
    || fetchedVariantTextUnitDistance(unit, group) <= FETCHED_VARIANT_TEXT_LOCAL_DOM_ORDER_DISTANCE;
}

function collapseFetchedVariantGroups(contentUnits, variantGroups, storyTitle, assets) {
  if (!variantGroups.length) return contentUnits;
  let units = [...contentUnits];
  for (const group of variantGroups) {
    const optionAssetIds = new Set(group.options.flatMap((option) => option.assetIds));
    const optionLabels = group.options.map((option) => fetchedTextKey(option.label)).filter(Boolean);
    const optionUnits = units.filter((unit) => {
      const unitAssets = variantUnitAssetIds(unit);
      return unitAssets.some((assetId) => optionAssetIds.has(assetId));
    });
    const aggregateTextUnits = units.filter((unit) => isFetchedAggregateVariantTextUnit(unit, group, optionLabels));
    const defaultOption = group.options.find((option) => option.id === group.defaultOptionId) || group.options[0];
    const linkedAssets = assetsForVariantGroup(optionAssetIds, optionUnits, assets);
    const sourceUnit = optionUnits[0] || aggregateTextUnits[0] || null;
    const domOrder = Number.isFinite(Number(group.domOrder))
      ? Number(group.domOrder)
      : Math.min(...optionUnits.map((unit) => Number(unit?.scene?.domOrder)).filter(Number.isFinite), Number.MAX_SAFE_INTEGER);
    const host = {
      id: group.beatId,
      index: 0,
      kind: "variant-group",
      subtype: "single-select",
      isTextOnly: linkedAssets.length === 0,
      section: sourceUnit?.section || "Interactive variants",
      // Source Graph title policy prefers sectionHeading. For a collapsed
      // selector, the group heading is the canonical heading for this beat;
      // the surrounding article heading belongs to the preceding narrative.
      sectionHeading: group.title || sourceUnit?.sectionHeading || "",
      title: group.title || storyTitle,
      text: defaultOption.text || defaultOption.label,
      sourceIds: Array.from(new Set([
        group.id,
        ...group.options.flatMap((option) => option.assetIds),
        ...optionUnits.flatMap((unit) => arrayOr(unit.sourceIds)),
      ])),
      linkedAssets,
      scene: {
        ...(sourceUnit?.scene || {}),
        domOrder: Number.isFinite(domOrder) && domOrder !== Number.MAX_SAFE_INTEGER ? domOrder : null,
        variantGroupId: group.id,
      },
      lifecycle: {
        ...(sourceUnit?.lifecycle || {}),
        sourceInteractionPreserved: true,
      },
      interactions: { variantGroupId: group.id },
      variantGroupId: group.id,
      originalField: "variant_groups",
    };
    const removed = new Set([...optionUnits, ...aggregateTextUnits]);
    units = units.filter((unit) => !removed.has(unit));
    units.push(host);
    units = sortFetchedUnitsBySourceOrder(units.map((unit, index) => ({ ...unit, __sourceOrder: index })));
  }
  return units.map((unit, index) => {
    const { __sourceOrder, ...cleanUnit } = unit;
    return { ...cleanUnit, index };
  });
}

function assetsForVariantGroup(optionAssetIds, optionUnits, assets) {
  const byId = new Map(optionUnits.flatMap((unit) => arrayOr(unit.linkedAssets)).map((asset) => [asset?.id, asset]));
  const runtimeById = new Map(arrayOr(assets).map((asset) => [asset?.id, asset]));
  return Array.from(optionAssetIds).map((id) => byId.get(id) || runtimeById.get(id) || { id }).filter(Boolean);
}

function applyHeadingsToFetchedUnits(units, headings) {
  const sortedHeadings = arrayOr(headings)
    .map((heading) => ({
      text: firstNonEmpty(heading.text, heading.heading, heading.title, heading.label, ""),
      domOrder: numberOr(heading.domOrder, Number.NEGATIVE_INFINITY),
    }))
    .filter((heading) => heading.text)
    .sort((a, b) => a.domOrder - b.domOrder);
  if (!sortedHeadings.length) return units;

  return units.map((unit) => {
    if (firstNonEmpty(unit.sectionHeading, "")) return unit;
    const unitOrder = numberOr(unit.scene?.domOrder, Number.POSITIVE_INFINITY);
    const heading = [...sortedHeadings].reverse().find((item) => item.domOrder <= unitOrder) || sortedHeadings[0];
    return heading?.text ? { ...unit, sectionHeading: heading.text } : unit;
  });
}

function applyBeatTitlesToFetchedUnits(units, storyTitle) {
  return units.map((unit, index) => {
    return {
      ...unit,
      title: firstNonEmpty(unit.sectionHeading, storyTitle, titleFromText(unit.text, index)),
    };
  });
}

function sortFetchedUnitsBySourceOrder(units) {
  const hasDomOrder = units.some((unit) => Number.isFinite(Number(unit.scene?.domOrder)));
  if (!hasDomOrder) return units;

  return [...units].sort((a, b) => {
    const aOrder = Number.isFinite(Number(a.scene?.domOrder)) ? Number(a.scene.domOrder) : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(Number(b.scene?.domOrder)) ? Number(b.scene.domOrder) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return numberOr(a.__sourceOrder, 0) - numberOr(b.__sourceOrder, 0);
  });
}

function dedupeFetchedUnits(units) {
  const textKeys = units.map((unit) => fetchedTextKey(unit.text));
  const seen = new Map();
  const results = [];

  units.forEach((unit, index) => {
    const key = textKeys[index];
    if (!key) return;
    if (isCompositeFetchedUnit(key, textKeys, index)) return;

    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      const existing = results[existingIndex];
      existing.sourceIds = Array.from(new Set([...(existing.sourceIds || []), ...(unit.sourceIds || [])]));
      existing.scene = compactObject({
        ...existing.scene,
        duplicateSources: [...(existing.scene?.duplicateSources || []), compactObject({
          kind: unit.kind,
          sourceIndex: unit.scene?.sourceIndex,
          tag: unit.scene?.tag,
          attributes: unit.scene?.attributes,
        })],
      });
      return;
    }

    seen.set(key, results.length);
    results.push(unit);
  });

  return results;
}

function isCompositeFetchedUnit(key, keys, index) {
  let containedChildren = 0;
  for (let candidateIndex = 0; candidateIndex < keys.length; candidateIndex += 1) {
    if (candidateIndex === index) continue;
    const childKey = keys[candidateIndex];
    if (!childKey || childKey.length < 40 || childKey.length >= key.length - 20) continue;
    if (!key.includes(childKey)) continue;
    containedChildren += 1;
    if (containedChildren >= 2) return true;
  }
  return false;
}

function fetchedTextKey(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isUsableFetchedText(value) {
  const key = fetchedTextKey(value);
  return Boolean(key) && !["undefined", "null", "nan"].includes(key);
}

function addFetchedUnits(target, values, kind, section, originalField = kind) {
  arrayOr(values).forEach((item, index) => {
    const text = firstNonEmpty(item.text, item.caption, item.content, item.match, item.value, "");
    if (!isUsableFetchedText(text)) return;
    const isTextOnly = kind === "text-only";
    target.push({
      id: firstNonEmpty(item.id, item.sourceId, `${kind}-${index + 1}`),
      index,
      kind,
      subtype: item.subtype,
      isTextOnly,
      section: firstNonEmpty(item.section, section),
      sectionHeading: firstNonEmpty(item.sectionHeading, ""),
      title: firstNonEmpty(item.title, item.heading, item.label, ""),
      text,
      sourceIds: compact([item.id, item.sourceId, item.url, item.file, item.source]),
      media: compactObject({
        image: item.image,
        url: item.url,
        file: item.file,
      }),
      scene: compactObject({
        sourceIndex: item.index,
        domOrder: item.domOrder,
        tag: item.tag,
        attributes: item.attributes,
        selector: item.selector,
        ancestorSelectors: item.ancestorSelectors,
        elementId: item.elementId,
        className: item.className,
      }),
      lifecycle: compactObject({
        textOnly: isTextOnly,
        narrativeSubtype: item.subtype,
        observed: item.observed,
      }),
      interactions: {},
      originalField,
      __sourceOrder: target.length,
    });
  });
}

function findContentSource(raw, strategy) {
  for (const field of strategy.preferredContentFields) {
    if (Array.isArray(raw[field]) && raw[field].length) return { field, items: raw[field] };
  }
  for (const field of ["beats", "storyBeats", "originalContentBeats", "pages", "sourceBeats", "regions", "captions", "slides", "steps", "scenes"]) {
    if (Array.isArray(raw[field]) && raw[field].length) return { field, items: raw[field] };
  }
  return { field: "none", items: [] };
}

function normalizeSceneTopology(raw, contentUnits) {
  const routeStops = arrayOr(raw.routeStops);
  const regions = arrayOr(raw.regions);
  const markers = arrayOr(raw.markerLabels).concat(arrayOr(raw.visualLabels));
  const bodies = arrayOr(raw.bodies);
  const countries = raw.countries ? Object.values(raw.countries) : [];
  const modelGroups = raw.modelGroups || {};
  const storyBeats = arrayOr(raw.storyBeats);
  const cameraPresets = contentUnits.map((unit) => unit.scene?.camera).filter(Boolean);
  const hasCorridors = contentUnits.some((unit) => arrayOr(unit.scene?.focusCorridors).length > 0);

  return {
    kind: inferTopologyKind({ routeStops, regions, bodies, countries, modelGroups, hasCorridors, raw }),
    routeStops,
    regions,
    markers,
    bodies,
    countries,
    modelGroups,
    sections: arrayOr(raw.sections),
    questions: raw.questions || {},
    cameraPresets,
    spatialRelationships: compactObject({
      layout: raw.layout,
      spatialLayout: raw.spatialLayout,
      spatialLayoutPlan: raw.spatialLayoutPlan,
      photoSets: raw.photoSets,
      models: raw.models,
      focusMap: raw.focusMap,
      storyBeats,
    }),
  };
}

function normalizeInteractions(raw, contentUnits) {
  const beatTriggers = contentUnits.flatMap((unit) => unit.interactions?.triggers || []);
  const beatHotspots = contentUnits.flatMap((unit) => unit.interactions?.hotspots || []);
  return {
    controls: raw.interactions?.controls || raw.interactionPlan || ["next", "back"],
    keyboard: raw.interactions?.keyboard || {},
    xrControllers: raw.interactions?.xrControllers || {},
    locomotion: raw.interactions?.locomotion || "story-fixed",
    lifecycle: compactObject({
      pacing: raw.pacing,
      transitionAndPacingPlan: raw.transitionAndPacingPlan,
      narrationAndTextPreservationPlan: raw.narrationAndTextPreservationPlan,
    }),
    triggers: compact(beatTriggers),
    hotspots: compact(beatHotspots),
  };
}

function normalizeAssets(raw, diagnostics) {
  const results = [];
  collectAssets(raw.assets, ["assets"], results);
  collectAssets(raw.models, ["models"], results);
  collectAssets(raw.images, ["images"], results);
  collectAssets(raw.photoSets, ["photoSets"], results);
  collectAssets(raw.bodies, ["bodies"], results);
  collectAssets(raw.availableAssets, ["availableAssets"], results);
  collectAssets(raw.model, ["model"], results);

  const deduped = [];
  const seen = new Set();
  for (const asset of results) {
    const key = `${asset.type}:${asset.path || asset.url || asset.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(asset);
  }

  if (!deduped.length) {
    diagnostics.push({
      severity: "warning",
      code: "NO_ASSETS_DISCOVERED",
      message: "No recognizable asset references were found in the source artifact.",
    });
  }
  return deduped;
}

function collectAssets(value, context, results) {
  if (!value) return;
  if (typeof value === "string") {
    if (looksLikeAsset(value)) {
      results.push(assetFromValue(value, context));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAssets(item, context.concat(index), results));
    return;
  }
  if (typeof value !== "object") return;

  const direct = firstNonEmpty(value.path, value.url, value.file, value.fileName, value.model, value.before, value.after);
  if (direct && looksLikeAsset(direct)) {
    results.push({
      id: firstNonEmpty(value.id, value.key, context.at(-1), path.basename(direct)),
      path: isRemoteUrl(direct) ? null : direct,
      url: isRemoteUrl(direct) ? direct : null,
      type: firstNonEmpty(value.type, value.asset_type, inferAssetType(direct, context)),
      role: firstNonEmpty(value.role, value.caption, value.relevance, context.join(".")),
      sourceField: context.join("."),
      bytes: value.bytes || value.size || value.file_size || null,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (["sourceUrl", "url", "path", "file", "fileName", "model", "before", "after"].includes(key)) continue;
    collectAssets(child, context.concat(key), results);
  }
}

function assetFromValue(value, context) {
  return {
    id: path.basename(String(value)),
    path: isRemoteUrl(value) ? null : value,
    url: isRemoteUrl(value) ? value : null,
    type: inferAssetType(value, context),
    role: context.join("."),
    sourceField: context.join("."),
    bytes: null,
  };
}

function normalizeAssetRoot(rawAssetRoot, storyFolder, mode, repoRoot) {
  const appRoot = path.join(storyFolder, "webxr-adaptation");
  const captureRoot = inferCaptureRoot(storyFolder, rawAssetRoot, repoRoot);
  const relativeFromApp = toPosix(path.relative(appRoot, captureRoot)) || ".";
  const hostingRoot = hostingRootForPath(captureRoot, repoRoot);
  const hosted = pathIsInside(hostingRoot, captureRoot)
    ? `/${toPosix(path.relative(hostingRoot, captureRoot))}`
    : null;
  return {
    mode,
    original: rawAssetRoot,
    relativeFromApp,
    hosted,
    buildBase: STORYVR_HOSTING_CONFIG.build.basePathForStory(storyFolder, repoRoot),
    filesystem: captureRoot,
    canonical: mode === "build" ? (hosted || captureRoot) : relativeFromApp,
  };
}

function normalizeFetchedAssetRoot(resourceFolder, mode, repoRoot) {
  const hostingRoot = hostingRootForPath(resourceFolder, repoRoot);
  const rel = path.relative(hostingRoot, resourceFolder);
  const insideHostingRoot = pathIsInside(hostingRoot, resourceFolder);
  const hosted = insideHostingRoot ? `/${toPosix(rel)}` : null;
  return {
    mode,
    original: resourceFolder,
    relativeFromApp: null,
    hosted,
    buildBase: null,
    filesystem: resourceFolder,
    canonical: mode === "build" && hosted ? hosted : resourceFolder,
  };
}

function assetsFromManifest(manifest) {
  return arrayOr(manifest).map((entry, index) => {
    const localPath = String(entry.local_path || "");
    const fileName = assetFileName(localPath || entry.final_url || entry.asset_url || `asset-${index + 1}`);
    return {
      id: firstNonEmpty(entry.id, fileName),
      path: localPath ? toPosix(localPath).replace(/^.*\/(models|pointclouds|textures|data|scripts|html|metadata|media)\//, "$1/") : null,
      url: entry.final_url || entry.asset_url || null,
      type: entry.asset_type || inferAssetType(fileName),
      role: firstNonEmpty(entry.adaptation_relevance, entry.role, ""),
      sourceField: "metadata.asset_manifest",
      bytes: entry.file_size || null,
      originalUrl: entry.asset_url || null,
      caption: firstNonEmpty(entry.caption, ""),
      credits: arrayOr(entry.credits),
      sourceImageGroupId: firstNonEmpty(entry.source_image_group_id, ""),
      domOrder: entry.image_group_dom_order ?? null,
      linkedBeatIds: arrayOr(entry.linked_beat_ids),
    };
  });
}

function normalizeFetchedSourceSpatialPlacements(storyStructure, assets) {
  const source = storyStructure?.source_spatial_compositions
    || storyStructure?.sourceSpatialCompositions
    || storyStructure?.animation_probe?.sourceSpatialCompositions
    || null;
  if (source?.schemaVersion !== "storyvr-source-spatial-composition/v1") return [];

  const assetIndex = new Map();
  const addAssetKey = (value, asset) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key || assetIndex.has(key)) return;
    assetIndex.set(key, asset);
    const file = assetFileName(key);
    if (file && !assetIndex.has(file)) assetIndex.set(file, asset);
  };
  for (const asset of assets || []) {
    addAssetKey(asset.id, asset);
    addAssetKey(asset.path, asset);
    addAssetKey(asset.url, asset);
    addAssetKey(asset.originalUrl, asset);
  }
  const resolveAsset = (member) => {
    for (const value of [member?.assetId, member?.assetPath, member?.assetFile, member?.assetUrl, member?.url]) {
      const key = String(value || "").trim().toLowerCase();
      if (!key) continue;
      const match = assetIndex.get(key) || assetIndex.get(assetFileName(key));
      if (match) return match;
    }
    return null;
  };
  const matrixFor = (value) => {
    const values = Array.isArray(value) ? value.map(Number) : null;
    return values?.length === 16 && values.every(Number.isFinite)
      ? new Matrix4().fromArray(values)
      : null;
  };
  const boundsFor = (value) => {
    const minimum = Array.isArray(value?.min) ? value.min.map(Number) : null;
    const maximum = Array.isArray(value?.max) ? value.max.map(Number) : null;
    return minimum?.length === 3
      && maximum?.length === 3
      && [...minimum, ...maximum].every(Number.isFinite)
      ? { minimum, maximum }
      : null;
  };

  const placements = [];
  for (const composition of arrayOr(source.compositions)) {
    if (composition?.accepted !== true || composition?.placementPolicy !== "source-locked") continue;
    const framing = composition.framing || {};
    const bounds = boundsFor(framing.contentBounds || framing.anchorBounds || framing.compositionBounds);
    if (!bounds) continue;
    const size = bounds.maximum.map((value, index) => value - bounds.minimum[index]);
    const maximumSize = Math.max(...size);
    if (!(maximumSize > 0)) continue;
    const scale = 1.9 / maximumSize;
    const center = bounds.minimum.map((value, index) => (value + bounds.maximum[index]) * 0.5);
    const groundAligned = String(framing.verticalAlignment || "").toLowerCase() === "ground";
    const frameMatrix = new Matrix4()
      .makeTranslation(
        -center[0] * scale,
        -(groundAligned ? bounds.minimum[1] : center[1]) * scale,
        -center[2] * scale,
      )
      .multiply(new Matrix4().makeScale(scale, scale, scale));
    const activeSets = composition.activeSetsByBeat && typeof composition.activeSetsByBeat === "object"
      ? composition.activeSetsByBeat
      : {};
    const anchorInstanceId = String(framing.anchorInstanceId || "");
    for (const member of arrayOr(composition.members)) {
      const asset = resolveAsset(member);
      const localMatrix = matrixFor(member?.resolvedLocalMatrix || member?.sourceMatrix || member?.matrix);
      const instanceId = String(member?.instanceId || member?.id || "").trim();
      if (!asset || !localMatrix || !instanceId) continue;
      const position = new Vector3();
      const quaternion = new Quaternion();
      const objectScale = new Vector3();
      frameMatrix.clone().multiply(localMatrix).decompose(position, quaternion, objectScale);
      const activeSceneKeys = Object.entries(activeSets)
        .filter(([, instanceIds]) => {
          const ids = new Set(arrayOr(instanceIds).map(String));
          return ids.has(instanceId) || member.persistent === true || instanceId === anchorInstanceId;
        })
        .map(([key]) => String(key));
      placements.push({
        instanceId,
        assetId: asset.id,
        transform: {
          position: position.toArray(),
          quaternion: quaternion.normalize().toArray(),
          scale: objectScale.toArray(),
        },
        activeSceneKeys,
        beatIds: arrayOr(member.beatIds || member.beat_ids).map(String),
        preserveSourceGeometry: true,
        ...(instanceId === anchorInstanceId ? { sourceRole: "framing-anchor" } : {}),
        ...(member.loaderTransformPolicy ? { loaderTransformPolicy: member.loaderTransformPolicy } : {}),
        ...(member.loaderTransformTarget ? { loaderTransformTarget: member.loaderTransformTarget } : {}),
      });
    }
  }
  return placements;
}

function linkImageAssetsToFetchedContentUnits(contentUnits, assets, storyStructure) {
  const imageGroups = arrayOr(storyStructure.image_groups).filter((group) => !imageGroupRejected(group));
  if (!imageGroups.length || !contentUnits.length || !assets.length) return;

  for (const group of imageGroups) {
    const linkedAssets = assets.filter((asset) => imageGroupMatchesAsset(group, asset));
    if (!linkedAssets.length) continue;
    const beat = nearestNarrativeUnitForImageGroup(contentUnits, group);
    if (!beat) continue;
    beat.linkedAssets = dedupeAssetObjects([...(beat.linkedAssets || []), ...linkedAssets]);
    beat.sourceImageLinked = true;
    beat.isTextOnly = false;
    beat.sourceIds = Array.from(new Set([...(beat.sourceIds || []), group.id, ...imageGroupUrls(group)].filter(Boolean)));

    for (const asset of linkedAssets) {
      asset.caption = asset.caption || imageGroupCaption(group);
      asset.credits = asset.credits?.length ? asset.credits : imageGroupCredits(group);
      asset.sourceImageGroupId = asset.sourceImageGroupId || group.id || "";
      asset.domOrder = asset.domOrder ?? (Number.isFinite(Number(group.domOrder)) ? Number(group.domOrder) : null);
      asset.linkedBeatIds = Array.from(new Set([...(asset.linkedBeatIds || []), beat.id]));
    }
  }
}

function imageGroupRejected(group) {
  return group?.rejected === true
    || group?.imageRelevance?.accepted === false
    || group?.relevance?.accepted === false;
}

function imageGroupMatchesAsset(group, asset) {
  const urls = imageGroupUrls(group);
  const assetValues = [asset.url, asset.originalUrl, asset.path, asset.id].filter(Boolean);
  return assetValues.some((value) => {
    const normalized = String(value || "");
    const file = assetFileName(normalized);
    return urls.some((url) => normalized === url || assetFileName(url) === file);
  });
}

function nearestNarrativeUnitForImageGroup(contentUnits, group) {
  const imageOrder = numberOr(group.domOrder, Number.POSITIVE_INFINITY);
  const candidates = contentUnits
    .filter((unit) => unit.text && unit.kind !== "caption" && unit.kind !== "heading")
    .map((unit, index) => ({
      unit,
      index,
      domOrder: numberOr(unit.scene?.domOrder, index),
    }));
  const preceding = candidates
    .filter((candidate) => candidate.domOrder <= imageOrder)
    .sort((a, b) => b.domOrder - a.domOrder || b.index - a.index);
  if (preceding.length) return preceding[0].unit;
  const following = candidates
    .filter((candidate) => candidate.domOrder > imageOrder)
    .sort((a, b) => a.domOrder - b.domOrder || a.index - b.index);
  return following[0]?.unit || null;
}

function imageGroupUrls(group) {
  const image = group?.image || {};
  const acceptedUrls = Array.isArray(group?.imageRelevance?.acceptedUrls) ? group.imageRelevance.acceptedUrls : [];
  if (acceptedUrls.length) {
    return Array.from(new Set(acceptedUrls.map((value) => String(value || "").trim()).filter(Boolean)));
  }
  return Array.from(new Set([
    image.url,
    ...(Array.isArray(image.srcset) ? image.srcset.map((entry) => typeof entry === "string" ? entry : entry?.url) : []),
    ...(Array.isArray(image.allUrls) ? image.allUrls : []),
    group?.url,
    group?.src,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function imageGroupCaption(group) {
  return firstNonEmpty(group?.caption?.text, group?.caption, "");
}

function imageGroupCredits(group) {
  return arrayOr(group?.credits)
    .map((credit) => firstNonEmpty(credit?.text, credit))
    .filter(Boolean);
}

function dedupeAssetObjects(assets) {
  const seen = new Set();
  const result = [];
  for (const asset of assets) {
    const key = asset?.id || asset?.url || asset?.path;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

function inferCaptureRoot(storyFolder, rawAssetRoot, repoRoot) {
  const raw = String(rawAssetRoot || "");
  if (path.isAbsolute(raw) && raw.startsWith(repoRoot)) return raw;
  if (raw.startsWith("/")) return path.join(repoRoot, raw.slice(1));
  if (raw.startsWith("..")) return path.resolve(storyFolder, "webxr-adaptation", raw);
  if (raw.startsWith("captures/")) return path.join(storyFolder, raw);
  return path.join(storyFolder, "captures", "active");
}

function inferRawAssetRoot(storyFolder, repoRoot) {
  const repoRel = toPosix(path.relative(repoRoot, storyFolder));
  return `/${repoRel}/captures/active`;
}

function storySlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return safeSlug(last.replace(/\.[a-z0-9]+$/i, ""), "nyt-story").toLowerCase();
  } catch {
    return "";
  }
}

function inferredSlugFromResourceFolder(resourceFolder) {
  const base = path.basename(resourceFolder);
  if (base === "active") return safeSlug(path.basename(path.dirname(path.dirname(resourceFolder))), "nyt-story").toLowerCase();
  return safeSlug(base.replace(/_\d{8}T\d{6}Z$/i, ""), "nyt-story").toLowerCase();
}

function titleFromText(text, index) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return `Unit ${index + 1}`;
  const sentence = normalized.split(/[.!?]/)[0].trim();
  return sentence || normalized;
}

function inferTopologyKind({ routeStops, regions, bodies, countries, modelGroups, hasCorridors, raw }) {
  if (hasCorridors || countries.length) return "geo-corridor";
  if (routeStops.length) return "route";
  if (regions.length) return "region-map";
  if (bodies.length || Object.keys(raw.questions || {}).length) return "object-lineup";
  if (Object.keys(modelGroups || {}).length) return "model-section";
  return "beat-sequence";
}

function summarizeOriginalSchema(raw) {
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, value]) => Array.isArray(value) || value === null || typeof value !== "object")
      .map(([key, value]) => [key, Array.isArray(value) ? `array(${value.length})` : typeof value]),
  );
}

function validateRuntimeInstance(runtime) {
  if (runtime.schemaVersion !== STORYVR_SCHEMA_VERSION) throw new Error("Invalid StoryVR schema version.");
  if (!runtime.slug) throw new Error("Runtime instance missing slug.");
  if (!runtime.title) throw new Error(`Runtime instance ${runtime.slug} missing title.`);
  if (!Array.isArray(runtime.contentUnits) || runtime.contentUnits.length === 0) {
    throw new Error(`Runtime instance ${runtime.slug} has no canonical content units.`);
  }
  if (!runtime.assetRoot?.canonical) throw new Error(`Runtime instance ${runtime.slug} missing canonical asset root.`);
}

async function findSourceInfo(storyFolder, strategy, options) {
  const candidates = strategy.sourceCandidates || SOURCE_CANDIDATES;
  const found = await firstExistingSource(storyFolder, candidates);
  if (found) return found;

  if (options.generateMissing) {
    await runBuildScriptIfPresent(storyFolder);
    const generated = await firstExistingSource(storyFolder, candidates);
    if (generated) return generated;
  }

  const rels = candidates.map((item) => item.relPath).join(", ");
  throw new Error(`No supported source artifact found. Checked: ${rels}`);
}

async function firstExistingSource(storyFolder, candidates) {
  for (const candidate of candidates) {
    const fullPath = path.join(storyFolder, candidate.relPath);
    if (await exists(fullPath)) return { ...candidate, path: fullPath };
  }
  return null;
}

async function runBuildScriptIfPresent(storyFolder) {
  const script = path.join(storyFolder, "webxr-adaptation/tools/build-story-instance.mjs");
  if (!(await exists(script))) return;
  const result = spawnSync(process.execPath, [script], {
    cwd: storyFolder,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Generated source build failed for ${storyFolder}: ${detail}`);
  }
}

async function loadSource(sourceInfo) {
  if (sourceInfo.path.endsWith(".json")) {
    return JSON.parse(await readFile(sourceInfo.path, "utf8"));
  }
  if (sourceInfo.path.endsWith(".js")) {
    const stats = await stat(sourceInfo.path);
    const url = `${pathToFileURL(sourceInfo.path).href}?mtime=${stats.mtimeMs}`;
    const module = await import(url);
    const raw = module.storyInstance || module.default || module.STORY_INSTANCE || module.instance;
    if (!raw) throw new Error(`JS source ${sourceInfo.path} did not export storyInstance/default/STORY_INSTANCE.`);
    return raw;
  }
  throw new Error(`Unsupported StoryVR source type: ${sourceInfo.path}`);
}

function makeStoryInput(storyFolder, mode, repoRoot) {
  const fullStoryFolder = path.resolve(storyFolder);
  return {
    storyFolder: fullStoryFolder,
    mode: mode === "build" ? "build" : "dev",
    family: familyForStoryFolder(fullStoryFolder, repoRoot),
    storySlug: path.basename(fullStoryFolder),
  };
}

function familyForStoryFolder(storyFolder, repoRoot) {
  const rel = toPosix(path.relative(repoRoot, storyFolder));
  if (rel === "global-migration") return "global";
  if (rel.startsWith("web2VR-Initial-Adaptations/")) return "web2vr-initial";
  if (rel.startsWith("louise-10-stories/")) return "louise";
  if (rel.startsWith("Jingchen-10-stories/")) return "jingchen";
  return "unknown";
}

export function classifyExcludedStory(storyFolder, slug = path.basename(storyFolder)) {
  const rel = toPosix(path.relative(REPO_ROOT, storyFolder));
  const haystack = `${slug} ${rel}`;
  if (VIRTUAL_WALK_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { category: "virtual-walk", reason: "virtual walk naming convention" };
  }
  if (SPORTS_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { category: "sports", reason: "sports naming convention" };
  }
  return null;
}

async function addStoryChildren(candidates, skipped, familyRoot, repoRoot, family) {
  if (!(await exists(familyRoot))) return;
  for (const entry of await readdir(familyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await addIfStoryFolder(candidates, skipped, path.join(familyRoot, entry.name), repoRoot, family, { ignoreMissing: true });
  }
}

async function addJingchenStories(candidates, skipped, familyRoot, repoRoot) {
  if (!(await exists(familyRoot))) return;
  for (const storyDir of await readdir(familyRoot, { withFileTypes: true })) {
    if (!storyDir.isDirectory() || !/^Story_/i.test(storyDir.name)) continue;
    const storyGroup = path.join(familyRoot, storyDir.name);
    for (const entry of await readdir(storyGroup, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      await addIfStoryFolder(candidates, skipped, path.join(storyGroup, entry.name), repoRoot, "jingchen", { ignoreMissing: true });
    }
  }
}

async function addIfStoryFolder(candidates, skipped, storyFolder, repoRoot, family, options = {}) {
  const appRoot = path.join(storyFolder, "webxr-adaptation");
  if (await exists(appRoot)) {
    candidates.push({
      family,
      slug: path.basename(storyFolder),
      storyFolder,
      storyFolderRel: toPosix(path.relative(repoRoot, storyFolder)),
    });
  } else if (!options.ignoreMissing) {
    skipped.push({
      family,
      slug: path.basename(storyFolder),
      storyFolder,
      storyFolderRel: toPosix(path.relative(repoRoot, storyFolder)),
      reason: "missing webxr-adaptation folder",
      category: "not-story-folder",
    });
  }
}

function outputPathForRuntime(outRoot, runtime) {
  return path.join(outRoot, runtime.family, runtime.slug, "storyvr-runtime.json");
}

function compareStoryRecords(a, b) {
  return `${a.family}/${a.slug}`.localeCompare(`${b.family}/${b.slug}`);
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && Object.keys(value).length) return value;
  }
  return "";
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function arrayOr(value) {
  return Array.isArray(value) ? value : [];
}

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && value !== "");
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === "") return false;
      if (Array.isArray(entry) && !entry.length) return false;
      if (typeof entry === "object" && !Array.isArray(entry) && !Object.keys(entry).length) return false;
      return true;
    }),
  );
}

function looksLikeAsset(value) {
  const text = String(value || "");
  if (!text || /^https?:\/\/www\.nytimes\.com/i.test(text)) return false;
  return isRemoteUrl(text) || /\.(glb|gltf|pcd|bin|json|csv|png|jpe?g|webp|avif|gif|mp4|webm|mp3|wav|svg)$/i.test(text) || /^(models|pointclouds|textures|data|media|audio)\//i.test(text);
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function inferAssetType(value, context = []) {
  const text = String(value || "").toLowerCase();
  const contextText = context.join(".").toLowerCase();
  if (/\.(glb|gltf)$/.test(text) || contextText.includes("model")) return "model";
  if (/\.pcd$/.test(text) || contextText.includes("pointcloud") || contextText.includes("point_cloud")) return "pointcloud";
  if (/\.(png|jpe?g|webp|avif|gif|svg)$/.test(text) || contextText.includes("image") || contextText.includes("texture")) return "texture";
  if (/\.(json|csv|bin)$/.test(text) || contextText.includes("data")) return "data";
  if (/\.(mp4|webm)$/.test(text) || contextText.includes("media") || contextText.includes("video")) return "media";
  if (/\.(mp3|wav)$/.test(text) || contextText.includes("audio")) return "audio";
  return isRemoteUrl(text) ? "remote" : "asset";
}

function assetFileName(value) {
  return String(value || "").split(/[\\/]/).pop() || "";
}

function safeSlug(value, fallback = "item") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return cleaned || fallback;
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}
