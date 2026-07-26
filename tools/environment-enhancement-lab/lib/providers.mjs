const POLY_HAVEN_API = "https://api.polyhaven.com";
const AMBIENT_CG_API = "https://ambientcg.com/api/v3/assets";
const SKETCHFAB_API = "https://api.sketchfab.com/v3";

const DEFAULT_PROVIDERS = ["polyhaven", "ambientcg", "sketchfab"];
const SEARCH_RESULT_LIMIT = 12;
const FETCH_TIMEOUT_MS = 8_000;
const POLY_HAVEN_HEADERS = {
  Accept: "application/json",
  "User-Agent": "StoryVR-Environment-Enhancement-Lab/0.1 (academic prototype)",
};
const JSON_HEADERS = { Accept: "application/json" };
const AMBIENT_INCLUDE = [
  "type",
  "releaseDate",
  "shortDescription",
  "longDescription",
  "title",
  "url",
  "tags",
  "dimensions",
  "downloads",
  "previews",
  "thumbnails",
  "technique",
].join(",");

const CC0_LICENSE = Object.freeze({
  name: "CC0 1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attributionRequired: false,
  commercialUse: true,
});

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "around",
  "environment",
  "environmental",
  "enhancement",
  "for",
  "in",
  "of",
  "realistic",
  "scene",
  "setting",
  "story",
  "surrounding",
  "surroundings",
  "the",
  "to",
  "vr",
  "webxr",
  "with",
]);

const AI_GENERATED_TAGS = new Set([
  "ai-generated",
  "aigenerated",
  "generated-by-ai",
  "generative-ai",
  "text-to-3d",
]);

function cloneLicense(license) {
  return { ...license };
}

function cleanText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(typeof item === "object" ? item?.name ?? item?.slug : item)).filter(Boolean))];
}

function queryTerms(query) {
  const tokens = String(query ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  const meaningful = [...new Set(tokens.filter((token) => token.length > 1 && !QUERY_STOP_WORDS.has(token)))];
  return meaningful.length ? meaningful : [...new Set(tokens.filter((token) => token.length > 1))];
}

function scoreSearchResult({ title, description, tags, categories, popularity = 0 }, terms) {
  if (!terms.length) return Math.log10(1 + (finiteNumber(popularity) ?? 0));

  const titleText = cleanText(title).toLowerCase();
  const descriptionText = cleanText(description).toLowerCase();
  const tagValues = stringArray(tags).map((tag) => tag.toLowerCase());
  const categoryValues = stringArray(categories).map((category) => category.toLowerCase());
  let score = 0;
  let matches = 0;

  for (const term of terms) {
    let termScore = 0;
    if (titleText === term) termScore += 16;
    else if (titleText.split(/[^a-z0-9]+/).includes(term)) termScore += 11;
    else if (titleText.includes(term)) termScore += 7;
    if (tagValues.includes(term)) termScore += 9;
    else if (tagValues.some((tag) => tag.includes(term))) termScore += 5;
    if (categoryValues.some((category) => category.split(/[^a-z0-9]+/).includes(term))) termScore += 5;
    else if (categoryValues.some((category) => category.includes(term))) termScore += 3;
    if (descriptionText.includes(term)) termScore += 2;
    if (termScore > 0) matches += 1;
    score += termScore;
  }

  if (!matches) return Number.NEGATIVE_INFINITY;
  score += matches === terms.length ? 8 : 0;
  score += Math.log10(1 + (finiteNumber(popularity) ?? 0)) * 0.15;
  return score;
}

function safeErrorMessage(error) {
  if (error?.name === "AbortError") return "Request was cancelled";
  return cleanText(error?.message, "Provider request failed").slice(0, 300);
}

function abortError(reason) {
  const error = new Error("Request was cancelled", reason === undefined ? undefined : { cause: reason });
  error.name = "AbortError";
  return error;
}

async function fetchJson(url, { fetchImpl, signal, headers = JSON_HEADERS } = {}) {
  if (signal?.aborted) throw abortError(signal.reason);
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", relayAbort, { once: true });

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`Provider request timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      Promise.resolve().then(() => fetchImpl(url, { method: "GET", headers, signal: controller.signal })),
      timeoutPromise,
    ]);
    if (!response || typeof response.ok !== "boolean") throw new Error("Provider returned an invalid HTTP response");
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status ?? "error"}`);
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", relayAbort);
  }
}

function normalizedMetrics({ triangles = null, vertices = null, downloadBytes = null, textureBytes = null } = {}) {
  return {
    triangles: finiteNumber(triangles),
    vertices: finiteNumber(vertices),
    downloadBytes: finiteNumber(downloadBytes),
    textureBytes: finiteNumber(textureBytes),
  };
}

function polyHavenCreator(metadata) {
  const authors = metadata?.authors && typeof metadata.authors === "object" ? Object.keys(metadata.authors) : [];
  return {
    name: authors.length ? authors.join(", ") : "Poly Haven",
    url: "https://polyhaven.com",
  };
}

function normalizePolyHavenCandidate(sourceId, metadata, downloadBytes = null) {
  const assetType = Number(metadata?.type) === 0 ? "hdri" : "model";
  const title = cleanText(metadata?.name, sourceId);
  const creator = polyHavenCreator(metadata);
  const sourceUrl = `https://polyhaven.com/a/${encodeURIComponent(sourceId)}`;
  return {
    id: `polyhaven:${sourceId}`,
    provider: "polyhaven",
    sourceId,
    title,
    description: cleanText(metadata?.description),
    assetType,
    previewUrl: cleanText(metadata?.thumbnail_url),
    sourceUrl,
    creator,
    license: cloneLicense(CC0_LICENSE),
    tags: [...new Set([...stringArray(metadata?.tags), ...stringArray(metadata?.categories)])],
    metrics: normalizedMetrics({ triangles: assetType === "model" ? metadata?.polycount : null, downloadBytes }),
    formatLabel: assetType === "hdri" ? "HDRI (.hdr)" : "glTF file set",
    humanCreated: true,
    attribution: `${title} by ${creator.name} on Poly Haven (CC0 1.0). ${sourceUrl}`,
  };
}

async function searchPolyHaven({ terms, fetchImpl, signal }) {
  const requests = ["models", "hdris"].map(async (type) => {
    const url = new URL("/assets", POLY_HAVEN_API);
    url.searchParams.set("type", type);
    return fetchJson(url, { fetchImpl, signal, headers: POLY_HAVEN_HEADERS });
  });
  const settled = await Promise.allSettled(requests);
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  if (!fulfilled.length) throw settled[0]?.reason ?? new Error("Poly Haven is unavailable");

  const items = [];
  for (const result of fulfilled) {
    const assets = result.value && typeof result.value === "object" ? result.value : {};
    for (const [sourceId, metadata] of Object.entries(assets)) {
      if (![0, 2].includes(Number(metadata?.type))) continue;
      const score = scoreSearchResult(
        {
          title: metadata?.name,
          description: metadata?.description,
          tags: metadata?.tags,
          categories: metadata?.categories,
          popularity: metadata?.download_count,
        },
        terms,
      );
      if (!Number.isFinite(score)) continue;
      items.push({ score, candidate: normalizePolyHavenCandidate(sourceId, metadata) });
    }
  }

  items.sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));
  const failed = settled.filter((result) => result.status === "rejected");
  return {
    items: items.slice(0, SEARCH_RESULT_LIMIT),
    warning: failed.length ? `${failed.length} of 2 Poly Haven asset indexes failed` : undefined,
  };
}

function ambientAssetType(type) {
  if (type === "hdri") return "hdri";
  if (type === "terrain") return "terrain";
  return "model";
}

function ambientDownloadScore(download, type) {
  const attributes = cleanText(download?.attributes).toLowerCase();
  const extension = cleanText(download?.extension).toLowerCase();
  let score = 0;
  if (attributes.includes("2k")) score += type === "hdri" ? 45 : 35;
  else if (attributes.includes("1k")) score += 40;
  else if (attributes.includes("4k")) score += 10;
  if (attributes.includes("lq")) score += 12;
  if (attributes.includes("jpg")) score += 5;
  if (/\bglb\b/.test(attributes)) score += 160;
  else if (/\bgltf\b/.test(attributes)) score += 155;

  if (type === "hdri") {
    if (extension === "hdr") score += 130;
    else if (extension === "exr") score += 120;
    else if (extension === "zip") score += 100;
  } else if (type === "terrain") {
    if (extension === "glb") score += 150;
    else if (extension === "gltf") score += 145;
    else if (extension === "obj") score += 120;
    else if (extension === "zip") score += 90;
  } else {
    if (extension === "glb") score += 150;
    else if (extension === "gltf") score += 145;
    else if (extension === "zip") score += 120;
    else if (extension === "obj") score += 90;
  }
  return score;
}

function preferredAmbientDownload(asset) {
  const downloads = Array.isArray(asset?.downloads) ? asset.downloads : [];
  return downloads
    .filter((download) => cleanText(download?.url) && cleanText(download?.extension))
    .map((download) => ({ download, score: ambientDownloadScore(download, asset?.type) }))
    .sort((a, b) => b.score - a.score || (finiteNumber(a.download?.size) ?? Infinity) - (finiteNumber(b.download?.size) ?? Infinity))[0]?.download ?? null;
}

function ambientFormatLabel(asset, selectedDownload = preferredAmbientDownload(asset)) {
  if (!selectedDownload) return "Reference only";
  const variant = cleanText(selectedDownload.attributes);
  const extension = cleanText(selectedDownload.extension).toUpperCase();
  const prefix = asset?.type === "hdri" ? "HDRI" : asset?.type === "terrain" ? "Terrain" : "3D asset";
  return [prefix, variant, extension].filter(Boolean).join(" · ");
}

function normalizeAmbientCandidate(asset) {
  const sourceId = cleanText(asset?.id);
  const title = cleanText(asset?.title, sourceId);
  const sourceUrl = cleanText(asset?.url, `https://ambientcg.com/a/${encodeURIComponent(sourceId)}`);
  const selectedDownload = preferredAmbientDownload(asset);
  const previewUrl = cleanText(asset?.thumbnails?.["512-WEBP"])
    || cleanText(asset?.thumbnails?.["512-PNG"])
    || cleanText(asset?.thumbnails?.["256-WEBP"])
    || cleanText(asset?.thumbnails?.["256-PNG"]);
  return {
    id: `ambientcg:${sourceId}`,
    provider: "ambientcg",
    sourceId,
    title,
    description: cleanText(asset?.shortDescription, cleanText(asset?.longDescription)),
    assetType: ambientAssetType(asset?.type),
    previewUrl,
    sourceUrl,
    creator: { name: "ambientCG", url: "https://ambientcg.com" },
    license: cloneLicense(CC0_LICENSE),
    tags: stringArray(asset?.tags),
    metrics: normalizedMetrics({ downloadBytes: selectedDownload?.size }),
    formatLabel: ambientFormatLabel(asset, selectedDownload),
    humanCreated: true,
    attribution: `${title} by ambientCG (CC0 1.0). ${sourceUrl}`,
  };
}

async function searchAmbientCg({ terms, fetchImpl, signal }) {
  const searches = terms.length ? terms.slice(0, 4) : [""];
  const requests = searches.map(async (term) => {
    const url = new URL(AMBIENT_CG_API);
    url.searchParams.set("type", "3d-model,hdri,terrain");
    url.searchParams.set("limit", "24");
    url.searchParams.set("include", AMBIENT_INCLUDE);
    if (term) url.searchParams.set("q", term);
    return fetchJson(url, { fetchImpl, signal });
  });
  const settled = await Promise.allSettled(requests);
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  if (!fulfilled.length) throw settled[0]?.reason ?? new Error("ambientCG is unavailable");

  const assetsById = new Map();
  for (const result of fulfilled) {
    for (const asset of Array.isArray(result.value?.assets) ? result.value.assets : []) {
      const sourceId = cleanText(asset?.id);
      if (sourceId && ["3d-model", "hdri", "terrain"].includes(asset?.type)) assetsById.set(sourceId, asset);
    }
  }

  const items = [];
  for (const asset of assetsById.values()) {
    const score = scoreSearchResult(
      {
        title: asset?.title,
        description: `${cleanText(asset?.shortDescription)} ${cleanText(asset?.longDescription)}`,
        tags: asset?.tags,
      },
      terms,
    );
    if (!Number.isFinite(score)) continue;
    items.push({ score, candidate: normalizeAmbientCandidate(asset) });
  }
  items.sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));
  const failed = settled.filter((result) => result.status === "rejected");
  return {
    items: items.slice(0, SEARCH_RESULT_LIMIT),
    warning: failed.length ? `${failed.length} of ${requests.length} ambientCG searches failed` : undefined,
  };
}

function normalizeSketchfabLicense(rawLicense) {
  const label = cleanText(typeof rawLicense === "string" ? rawLicense : rawLicense?.label, "Creative Commons");
  const normalized = label.toLowerCase().replace(/_/g, "-").trim();
  if (normalized.includes("cc0") || normalized.includes("public domain")) return cloneLicense(CC0_LICENSE);

  const slugLicense = normalized.replace(/^cc[-\s]+/, "");
  const recognized = /^by(?:-(?:nc|nd|sa)){0,2}$/.test(slugLicense)
    || normalized.includes("attribution")
    || normalized.includes("cc by");
  if (!recognized) {
    return {
      name: label,
      url: "https://creativecommons.org/licenses/",
      attributionRequired: true,
      commercialUse: false,
    };
  }

  const nonCommercial = normalized.includes("noncommercial") || normalized.includes("non-commercial") || /\bnc\b/.test(normalized);
  const noDerivatives = normalized.includes("noderiv") || normalized.includes("no deriv") || /\bnd\b/.test(normalized);
  const shareAlike = normalized.includes("sharealike") || normalized.includes("share alike") || /\bsa\b/.test(normalized);
  let slug = "by";
  if (nonCommercial) slug += "-nc";
  if (noDerivatives) slug += "-nd";
  else if (shareAlike) slug += "-sa";
  return {
    name: `CC ${slug.toUpperCase()} 4.0`,
    url: `https://creativecommons.org/licenses/${slug}/4.0/`,
    attributionRequired: true,
    commercialUse: !nonCommercial,
  };
}

function sketchfabPreview(thumbnails) {
  const images = Array.isArray(thumbnails?.images) ? thumbnails.images : [];
  return images
    .filter((item) => cleanText(item?.url))
    .sort((a, b) => Math.abs((finiteNumber(a?.width) ?? 0) - 720) - Math.abs((finiteNumber(b?.width) ?? 0) - 720))[0]?.url ?? "";
}

function sketchfabAssetType(model) {
  const environmentTerms = new Set(["environment", "habitat", "interior", "landscape", "ocean", "reef", "room", "seabed", "underwater", "world"]);
  const words = new Set(queryTerms(`${cleanText(model?.name)} ${stringArray(model?.tags).join(" ")}`));
  return [...environmentTerms].some((term) => words.has(term)) ? "scene" : "model";
}

function sketchfabHumanCreated(model) {
  const tags = stringArray(model?.tags).map((tag) => tag.toLowerCase().replace(/\s+/g, "-"));
  return !tags.some((tag) => AI_GENERATED_TAGS.has(tag));
}

function normalizeSketchfabCandidate(model, actualDownloadBytes = null) {
  const sourceId = cleanText(model?.uid);
  const title = cleanText(model?.name, sourceId);
  const creatorName = cleanText(model?.user?.displayName, cleanText(model?.user?.username, "Sketchfab creator"));
  const sourceUrl = cleanText(model?.viewerUrl, `https://sketchfab.com/3d-models/${encodeURIComponent(sourceId)}`);
  const license = normalizeSketchfabLicense(model?.license);
  const archive = model?.archives?.gltf ?? model?.archives?.glb ?? null;
  const downloadBytes = finiteNumber(actualDownloadBytes) ?? finiteNumber(archive?.size);
  return {
    id: `sketchfab:${sourceId}`,
    provider: "sketchfab",
    sourceId,
    title,
    description: cleanText(model?.description),
    assetType: sketchfabAssetType(model),
    previewUrl: sketchfabPreview(model?.thumbnails),
    sourceUrl,
    creator: {
      name: creatorName,
      url: cleanText(model?.user?.profileUrl, "https://sketchfab.com"),
    },
    license,
    tags: stringArray(model?.tags),
    metrics: normalizedMetrics({
      triangles: archive?.faceCount ?? model?.faceCount,
      vertices: archive?.vertexCount ?? model?.vertexCount,
      downloadBytes,
    }),
    formatLabel: "glTF archive",
    humanCreated: sketchfabHumanCreated(model),
    attribution: `${title} by ${creatorName} on Sketchfab, ${license.name}. ${sourceUrl}`,
  };
}

async function searchSketchfab({ terms, fetchImpl, signal }) {
  const url = new URL("/v3/search", "https://api.sketchfab.com");
  url.searchParams.set("type", "models");
  url.searchParams.set("downloadable", "true");
  url.searchParams.set("count", "24");
  if (terms.length) url.searchParams.set("q", terms.join(" "));
  const payload = await fetchJson(url, { fetchImpl, signal });
  const items = [];
  for (const model of Array.isArray(payload?.results) ? payload.results : []) {
    if (!cleanText(model?.uid) || model?.isDownloadable === false) continue;
    const score = scoreSearchResult(
      {
        title: model?.name,
        description: model?.description,
        tags: model?.tags,
        categories: model?.categories,
        popularity: model?.likeCount,
      },
      terms,
    );
    if (!Number.isFinite(score)) continue;
    items.push({ score, candidate: normalizeSketchfabCandidate(model) });
  }
  items.sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));
  return { items: items.slice(0, SEARCH_RESULT_LIMIT) };
}

const SEARCH_HANDLERS = {
  polyhaven: searchPolyHaven,
  ambientcg: searchAmbientCg,
  sketchfab: searchSketchfab,
};

function providerName(value) {
  const normalized = cleanText(value).toLowerCase().replace(/[-_\s]/g, "");
  if (normalized === "polyhaven") return "polyhaven";
  if (normalized === "ambientcg") return "ambientcg";
  if (normalized === "sketchfab") return "sketchfab";
  return normalized;
}

function requestedProviders(providers) {
  const values = providers === undefined ? DEFAULT_PROVIDERS : Array.isArray(providers) ? providers : [providers];
  return [...new Set(values.map(providerName).filter(Boolean))];
}

/**
 * Search the supported public catalogs without allowing one provider failure to
 * hide successful results from the others.
 */
export async function searchEnvironmentCandidates({ query = "", providers, fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
  const terms = queryTerms(query);
  const selectedProviders = requestedProviders(providers);
  const searches = selectedProviders.map(async (provider) => {
    const handler = SEARCH_HANDLERS[provider];
    if (!handler) return { provider, error: new Error(`Unsupported provider: ${provider}`) };
    try {
      return { provider, result: await handler({ terms, fetchImpl, signal }) };
    } catch (error) {
      return { provider, error };
    }
  });

  const settled = await Promise.all(searches);
  if (signal?.aborted) throw abortError(signal.reason);

  const providerStatus = {};
  const rankedCandidates = [];
  for (const entry of settled) {
    if (entry.error) {
      providerStatus[entry.provider] = { status: "error", count: 0, error: safeErrorMessage(entry.error) };
      continue;
    }
    const items = Array.isArray(entry.result?.items) ? entry.result.items : [];
    providerStatus[entry.provider] = {
      status: "ok",
      count: items.length,
      ...(entry.result?.warning ? { warning: entry.result.warning } : {}),
    };
    rankedCandidates.push(...items);
  }

  rankedCandidates.sort((a, b) => b.score - a.score || a.candidate.provider.localeCompare(b.candidate.provider));
  return { candidates: rankedCandidates.map((item) => item.candidate), providerStatus };
}
