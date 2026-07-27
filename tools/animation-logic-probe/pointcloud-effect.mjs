import crypto from "node:crypto";
import path from "node:path";

const MAX_PCD_HEADER_BYTES = 64 * 1024;
const MAX_PCD_ASCII_ROWS = 300_000;
const MAX_PCD_UNIQUE_VALUES = 256;
const TRANSMISSION_DRIVER_PATTERN = /^cough_driver_(\d+)$/i;
const TRANSMISSION_SAMPLE_INTERVAL_SECONDS = 0.05;
const TRANSMISSION_POSITION_X_MULTIPLIER = 100;
const TRANSMISSION_POSITION_X_THRESHOLD = 0.05;

function sha1(value, length = 16) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, length);
}

function cleanString(value) {
  return String(value || "").trim();
}

function cleanAssetReference(value) {
  return cleanString(value)
    .replace(/&amp;/g, "&")
    .replace(/\\\//g, "/")
    .replace(/^[("'`]+/, "")
    .replace(/[)"'`,;}\]]+$/g, "");
}

function normalizeUrl(rawValue, baseUrl = "") {
  const value = cleanAssetReference(rawValue);
  if (!value || /^(?:data|blob|javascript|mailto|tel):/i.test(value)) return "";
  try {
    const normalized = new URL(value, baseUrl || undefined);
    if (!/^https?:$/i.test(normalized.protocol)) return "";
    normalized.hash = "";
    return normalized.href;
  } catch {
    return "";
  }
}

function decodedBasename(value) {
  try {
    return path.posix.basename(decodeURIComponent(new URL(value, "https://storyvr.invalid/").pathname))
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  } catch {
    return path.posix.basename(cleanAssetReference(value)).replace(/\s+/g, " ").trim().toLowerCase();
  }
}

function pcdUrl(value) {
  try {
    return /\.pcd$/i.test(new URL(value, "https://storyvr.invalid/").pathname);
  } catch {
    return /\.pcd$/i.test(cleanAssetReference(value));
  }
}

function glbUrl(value) {
  try {
    return /\.(?:glb|gltf)$/i.test(new URL(value, "https://storyvr.invalid/").pathname);
  } catch {
    return /\.(?:glb|gltf)$/i.test(cleanAssetReference(value));
  }
}

function jsonArgumentsForCall(text, callPattern) {
  const source = String(text || "");
  const matches = [];
  callPattern.lastIndex = 0;
  let call;
  while ((call = callPattern.exec(source))) {
    const openParen = source.indexOf("(", call.index);
    if (openParen < 0) continue;
    let start = openParen + 1;
    while (/\s/.test(source[start] || "")) start += 1;
    if (source[start] !== "{") continue;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      if (depth !== 0) continue;
      try {
        matches.push(JSON.parse(source.slice(start, index + 1)));
      } catch {
        // Only strict JSON source-config payloads are accepted as explicit links.
      }
      callPattern.lastIndex = index + 1;
      break;
    }
  }
  return matches;
}

function pointCloudConfigSources(probe) {
  const storyUrl = probe?.story_url || "";
  const sources = [];
  const seen = new Set();
  const add = (text, metadata = {}) => {
    const value = String(text || "");
    if (!value) return;
    const key = `${metadata.sourceType || ""}:${metadata.source || ""}:${sha1(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      text: value,
      sourceType: metadata.sourceType || "probe-text",
      source: metadata.source || "probe-text",
      sourceUrl: metadata.sourceUrl || storyUrl
    });
  };

  for (const script of Array.isArray(probe?.scripts) ? probe.scripts : []) {
    const source = script?.src || `inline_script_${script?.index ?? sources.length}`;
    add(script?.text, {
      sourceType: script?.src ? "external-script-capture" : "inline-script",
      source,
      sourceUrl: script?.src || storyUrl
    });
  }
  for (const item of Array.isArray(probe?.data_params) ? probe.data_params : []) {
    add(item?.text, {
      sourceType: "dom-data-param",
      source: `${item?.attribute || "data-param"}:${item?.id ?? item?.index ?? sources.length}`,
      sourceUrl: storyUrl
    });
  }
  return sources;
}

export function discoverExplicitPointCloudLinks(probe) {
  const links = new Map();
  for (const source of pointCloudConfigSources(probe)) {
    const payloads = jsonArgumentsForCall(
      source.text,
      /(?:NYTG\.)?WEBGL_DATA\s*\.\s*push\s*\(/g
    );
    for (const payload of payloads) {
      for (const [modelIndex, model] of (Array.isArray(payload?.models) ? payload.models : []).entries()) {
        const modelReference = cleanAssetReference(model?.src || model?.model || model?.gltf || "");
        const pointCloudReference = cleanAssetReference(
          model?.ptcloud || model?.pointcloud || model?.pointCloud || ""
        );
        if (!glbUrl(modelReference) || !pcdUrl(pointCloudReference)) continue;
        const key = `${modelReference}|${pointCloudReference}|${source.source}`;
        const id = `pointcloud-link-${sha1(key, 12)}`;
        links.set(key, {
          id,
          schemaVersion: "storyvr-explicit-pointcloud-link/v1",
          detection: "explicit-source-config",
          configKey: Object.hasOwn(model, "ptcloud")
            ? "ptcloud"
            : Object.hasOwn(model, "pointcloud")
              ? "pointcloud"
              : "pointCloud",
          modelReference,
          pointCloudReference,
          modelIndex,
          transform: model?.transform && typeof model.transform === "object" ? model.transform : null,
          sourceType: source.sourceType,
          source: source.source,
          sourceUrl: source.sourceUrl
        });
      }
    }
  }
  return Array.from(links.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function pointCloudResourceRecords(probe) {
  const storyUrl = probe?.story_url || "";
  const records = new Map();
  for (const entries of [
    probe?.resource_entries,
    probe?.candidate_resources,
    probe?.dom_asset_references,
    probe?.storyvr_author_input?.asset_candidates
  ]) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const rawUrl = entry?.url || entry?.name || entry?.asset_url || "";
      const url = normalizeUrl(rawUrl, storyUrl);
      if (!url || !pcdUrl(url)) continue;
      records.set(url, {
        url,
        capturedAssetType: entry?.assetType || entry?.asset_type || entry?.type || "",
        initiatorType: entry?.initiatorType || entry?.sourceType || "",
        candidate: entry?.candidate === true
      });
    }
  }
  return Array.from(records.values()).sort((left, right) => left.url.localeCompare(right.url));
}

export function pointCloudDownloadCandidates(probe, links = discoverExplicitPointCloudLinks(probe)) {
  if (!links.length) return [];
  const resources = pointCloudResourceRecords(probe);
  const candidates = new Map();
  for (const link of links) {
    const referenceBasename = decodedBasename(link.pointCloudReference);
    const matches = resources.filter((resource) => decodedBasename(resource.url) === referenceBasename);
    const absoluteReference = /^(?:https?:)?\/\//i.test(link.pointCloudReference)
      ? normalizeUrl(link.pointCloudReference, link.sourceUrl || probe?.story_url || "")
      : "";
    if (absoluteReference && pcdUrl(absoluteReference)) {
      matches.push({ url: absoluteReference, capturedAssetType: "", initiatorType: "", candidate: false });
    }
    for (const match of matches) {
      if (candidates.has(match.url)) continue;
      candidates.set(match.url, {
        url: match.url,
        assetType: "pointcloud",
        rawValue: link.pointCloudReference,
        resolutionKind: match.url === absoluteReference
          ? "explicit-source-absolute-reference"
          : "captured-resource-basename-match",
        resolutionRank: match.url === absoluteReference ? 0 : 1,
        source: link.source,
        sourceType: link.sourceType,
        baseUrl: link.sourceUrl,
        pointCloudLinkId: link.id,
        modelReference: link.modelReference
      });
    }
  }
  return Array.from(candidates.values()).sort((left, right) => (
    left.resolutionRank - right.resolutionRank || left.url.localeCompare(right.url)
  ));
}

function pcdHeader(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error("Point-cloud download was empty.");
  const prefix = bytes.subarray(0, Math.min(bytes.length, MAX_PCD_HEADER_BYTES)).toString("latin1");
  if (!/^\s*#?\s*\.?PCD\b/im.test(prefix) && !/Point Cloud Data file format/i.test(prefix)) {
    throw new Error("Downloaded point-cloud candidate did not contain a PCD header.");
  }
  const dataMatch = /^DATA\s+([^\s]+).*$/im.exec(prefix);
  if (!dataMatch) throw new Error("Downloaded PCD did not declare a DATA encoding.");
  const newlineIndex = prefix.indexOf("\n", dataMatch.index);
  if (newlineIndex < 0) throw new Error("Downloaded PCD header was incomplete.");
  const headerText = prefix.slice(0, newlineIndex + 1);
  const values = new Map();
  for (const line of headerText.split(/\r?\n/)) {
    const match = /^\s*([A-Z]+)\s+(.+?)\s*$/i.exec(line);
    if (match) values.set(match[1].toUpperCase(), match[2].trim());
  }
  const tokens = (key) => cleanString(values.get(key)).split(/\s+/).filter(Boolean);
  const number = (key) => {
    const parsed = Number(values.get(key));
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    headerText,
    dataOffset: Buffer.byteLength(headerText, "latin1"),
    version: cleanString(values.get("VERSION")),
    fields: tokens("FIELDS"),
    sizes: tokens("SIZE").map(Number),
    types: tokens("TYPE"),
    counts: tokens("COUNT").map(Number),
    width: number("WIDTH"),
    height: number("HEIGHT"),
    declaredPointCount: number("POINTS"),
    dataEncoding: cleanString(dataMatch[1]).toLowerCase()
  };
}

function roundedNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function newColumnAccumulator(index) {
  return {
    index,
    numericCount: 0,
    integerCount: 0,
    min: Infinity,
    max: -Infinity,
    unique: new Map(),
    uniqueTruncated: false
  };
}

function addColumnValue(column, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  column.numericCount += 1;
  if (Number.isInteger(value)) column.integerCount += 1;
  column.min = Math.min(column.min, value);
  column.max = Math.max(column.max, value);
  if (!column.uniqueTruncated) {
    const key = String(value);
    column.unique.set(key, (column.unique.get(key) || 0) + 1);
    if (column.unique.size > MAX_PCD_UNIQUE_VALUES) {
      column.unique.clear();
      column.uniqueTruncated = true;
    }
  }
}

function finalizeColumn(column, name) {
  const uniqueValues = column.uniqueTruncated
    ? []
    : Array.from(column.unique.keys()).map(Number).sort((left, right) => left - right);
  const valueCounts = column.uniqueTruncated
    ? {}
    : Object.fromEntries(uniqueValues.map((value) => [String(value), column.unique.get(String(value))]));
  return {
    index: column.index,
    name,
    numericCount: column.numericCount,
    integerLike: column.numericCount > 0 && column.integerCount === column.numericCount,
    min: roundedNumber(column.min),
    max: roundedNumber(column.max),
    uniqueValueCount: column.uniqueTruncated ? null : uniqueValues.length,
    uniqueValues,
    valueCounts,
    uniqueValuesTruncated: column.uniqueTruncated
  };
}

export function summarizePcd(bytes) {
  const header = pcdHeader(bytes);
  const summary = {
    parseStatus: "ok",
    version: header.version,
    declaredFields: header.fields,
    declaredSizes: header.sizes,
    declaredTypes: header.types,
    declaredCounts: header.counts,
    width: header.width,
    height: header.height,
    declaredPointCount: header.declaredPointCount,
    dataEncoding: header.dataEncoding,
    headerByteLength: header.dataOffset,
    payloadByteLength: Math.max(0, bytes.length - header.dataOffset),
    observedPointCount: null,
    observedColumnCount: null,
    columns: [],
    bounds: null,
    limitations: []
  };
  if (header.dataEncoding !== "ascii") {
    summary.limitations.push(`Column statistics were not decoded for PCD DATA ${header.dataEncoding}.`);
    return summary;
  }

  const rows = bytes.subarray(header.dataOffset).toString("utf8").split(/\r?\n/).filter((line) => line.trim());
  const sampledRows = rows.slice(0, MAX_PCD_ASCII_ROWS);
  let observedColumnCount = 0;
  const columns = [];
  for (const row of sampledRows) {
    const values = row.trim().split(/\s+/);
    observedColumnCount = Math.max(observedColumnCount, values.length);
    while (columns.length < values.length) columns.push(newColumnAccumulator(columns.length));
    values.forEach((value, index) => addColumnValue(columns[index], value));
  }
  const names = Array.from({ length: observedColumnCount }, (_, index) => (
    header.fields[index] || `_extra_${index - header.fields.length + 1}`
  ));
  summary.observedPointCount = rows.length;
  summary.observedColumnCount = observedColumnCount;
  summary.columns = columns.map((column, index) => finalizeColumn(column, names[index]));
  if (rows.length > sampledRows.length) {
    summary.limitations.push(`Column statistics were sampled from the first ${sampledRows.length} of ${rows.length} points.`);
  }
  if (header.declaredPointCount !== null && rows.length !== header.declaredPointCount) {
    summary.limitations.push(`PCD POINTS declared ${header.declaredPointCount}, but ${rows.length} ASCII rows were observed.`);
  }
  if (observedColumnCount !== header.fields.length) {
    summary.limitations.push(
      `PCD FIELDS declared ${header.fields.length} columns, but data rows contain ${observedColumnCount}; extra columns are preserved as _extra_N.`
    );
  }
  const x = summary.columns.find((column) => column.name.toLowerCase() === "x");
  const y = summary.columns.find((column) => column.name.toLowerCase() === "y");
  const z = summary.columns.find((column) => column.name.toLowerCase() === "z");
  if (x && y && z) {
    summary.bounds = {
      min: [x.min, y.min, z.min],
      max: [x.max, y.max, z.max]
    };
  }
  return summary;
}

export function validatePcdBytes(bytes) {
  return summarizePcd(bytes);
}

export function parseGlbDocument(bytes, fileLabel = "GLB") {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.toString("utf8", 0, 4) !== "glTF") {
    throw new Error(`${fileLabel} is not a GLB file.`);
  }
  const version = bytes.readUInt32LE(4);
  if (version !== 2) throw new Error(`${fileLabel} uses unsupported GLB version ${version}.`);
  const declaredLength = bytes.readUInt32LE(8);
  const totalLength = Math.min(declaredLength || bytes.length, bytes.length);
  let offset = 12;
  let json = null;
  const binaryChunks = [];
  while (offset + 8 <= totalLength) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLength > totalLength) throw new Error(`${fileLabel} contains a truncated GLB chunk.`);
    if (chunkType === 0x4e4f534a) {
      const jsonText = bytes.toString("utf8", offset, offset + chunkLength).replace(/\0+$/g, "").trim();
      json = JSON.parse(jsonText);
    } else if (chunkType === 0x004e4942) {
      binaryChunks.push(bytes.subarray(offset, offset + chunkLength));
    }
    offset += chunkLength;
  }
  if (!json) throw new Error(`No JSON chunk found in ${fileLabel}.`);
  return { json, binaryChunks };
}

const ACCESSOR_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};

const COMPONENT_READERS = {
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) }
};

function decodeAccessor(document, accessorIndex) {
  const accessor = document?.json?.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing glTF accessor ${accessorIndex}.`);
  if (accessor.sparse) throw new Error(`Sparse glTF accessor ${accessorIndex} is not supported by the point-cloud specialization.`);
  const bufferView = document.json.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`Missing glTF bufferView for accessor ${accessorIndex}.`);
  const binary = document.binaryChunks?.[bufferView.buffer || 0];
  if (!binary) throw new Error(`No embedded GLB binary buffer is available for accessor ${accessorIndex}.`);
  const componentCount = ACCESSOR_COMPONENTS[accessor.type];
  const reader = COMPONENT_READERS[accessor.componentType];
  if (!componentCount || !reader) throw new Error(`Unsupported glTF accessor format for accessor ${accessorIndex}.`);
  const elementByteLength = componentCount * reader.bytes;
  const stride = Number(bufferView.byteStride || elementByteLength);
  const start = Number(bufferView.byteOffset || 0) + Number(accessor.byteOffset || 0);
  const count = Number(accessor.count || 0);
  if (!Number.isInteger(count) || count < 0 || count > 2_000_000) {
    throw new Error(`Unsafe glTF accessor count ${accessor.count} for accessor ${accessorIndex}.`);
  }
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const elementOffset = start + index * stride;
    if (elementOffset + elementByteLength > binary.length) {
      throw new Error(`glTF accessor ${accessorIndex} exceeds its embedded buffer.`);
    }
    const row = [];
    for (let component = 0; component < componentCount; component += 1) {
      row.push(reader.read(view, elementOffset + component * reader.bytes));
    }
    values.push(row);
  }
  return values;
}

function sampleLinearSeries(times, values, time, interpolation) {
  if (!times.length || !values.length || times.length !== values.length) return null;
  if (time <= times[0]) return values[0];
  if (time >= times[times.length - 1]) return values[values.length - 1];
  let low = 0;
  let high = times.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  if (interpolation === "STEP") return values[low];
  if (interpolation !== "LINEAR") return null;
  const span = times[high] - times[low];
  const ratio = span > 0 ? (time - times[low]) / span : 0;
  return values[low].map((value, index) => value + (values[high][index] - value) * ratio);
}

function transmissionDriverTimeline(document) {
  const candidates = [];
  for (const [animationIndex, animation] of (document?.json?.animations || []).entries()) {
    const channels = [];
    for (const [channelIndex, channel] of (animation.channels || []).entries()) {
      const nodeName = document.json.nodes?.[channel.target?.node]?.name || "";
      const match = TRANSMISSION_DRIVER_PATTERN.exec(nodeName);
      if (!match || channel.target?.path !== "translation") continue;
      channels.push({
        channelIndex,
        groupIndex: Number(match[1]),
        nodeName,
        samplerIndex: channel.sampler
      });
    }
    if (channels.length) candidates.push({ animationIndex, animation, channels });
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.channels.length - left.channels.length || left.animationIndex - right.animationIndex);
  const selected = candidates[0];
  const emitTimes = [];
  const errors = [];
  for (const channel of selected.channels.sort((left, right) => left.groupIndex - right.groupIndex)) {
    try {
      const sampler = selected.animation.samplers?.[channel.samplerIndex];
      const times = decodeAccessor(document, sampler?.input).map((row) => row[0]);
      const values = decodeAccessor(document, sampler?.output);
      const interpolation = cleanString(sampler?.interpolation || "LINEAR").toUpperCase();
      const duration = times.at(-1) || 0;
      let emitTimeSeconds = null;
      const sampleCount = Math.ceil(duration / TRANSMISSION_SAMPLE_INTERVAL_SECONDS);
      for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
        const time = Math.min(duration, sampleIndex * TRANSMISSION_SAMPLE_INTERVAL_SECONDS);
        const value = sampleLinearSeries(times, values, time, interpolation);
        if (!value) break;
        if (value[0] * TRANSMISSION_POSITION_X_MULTIPLIER >= TRANSMISSION_POSITION_X_THRESHOLD) {
          emitTimeSeconds = roundedNumber(time, 3);
          break;
        }
      }
      emitTimes.push({
        groupIndex: channel.groupIndex,
        nodeName: channel.nodeName,
        emitTimeSeconds,
        interpolation,
        keyframeCount: times.length,
        inputTimeRangeSeconds: [roundedNumber(times[0], 6), roundedNumber(times.at(-1), 6)]
      });
    } catch (error) {
      errors.push(`${channel.nodeName}: ${error.message}`);
    }
  }
  return {
    schemaVersion: "storyvr-transmission-pointcloud-driver-timeline/v1",
    specialization: "explicit-ptcloud-cough-driver-gates",
    clipIndex: selected.animationIndex,
    clipName: selected.animation.name || "",
    sampleIntervalSeconds: TRANSMISSION_SAMPLE_INTERVAL_SECONDS,
    threshold: {
      property: "position.x",
      multiplier: TRANSMISSION_POSITION_X_MULTIPLIER,
      comparator: ">=",
      value: TRANSMISSION_POSITION_X_THRESHOLD,
      rawPositionXValue: TRANSMISSION_POSITION_X_THRESHOLD / TRANSMISSION_POSITION_X_MULTIPLIER
    },
    driverCount: selected.channels.length,
    emittedDriverCount: emitTimes.filter((item) => item.emitTimeSeconds !== null).length,
    emitTimes,
    errors
  };
}

function groupColumnForTimeline(pcdSummary, timeline) {
  const driverCount = Number(timeline?.driverCount || 0);
  if (!driverCount) return null;
  const expectedValues = Array.from({ length: driverCount }, (_, index) => index);
  const candidates = (pcdSummary?.columns || []).filter((column) => (
    column.integerLike
    && !column.uniqueValuesTruncated
    && column.uniqueValues.length === expectedValues.length
    && column.uniqueValues.every((value, index) => value === expectedValues[index])
  ));
  candidates.sort((left, right) => {
    const leftExplicit = /(?:group|class|label|cluster|phase)/i.test(left.name) ? 0 : left.name.startsWith("_extra_") ? 1 : 2;
    const rightExplicit = /(?:group|class|label|cluster|phase)/i.test(right.name) ? 0 : right.name.startsWith("_extra_") ? 1 : 2;
    return leftExplicit - rightExplicit || left.index - right.index;
  });
  return candidates[0] || null;
}

function modelTransformEvidence(document) {
  const distanceMarkers = [];
  const anchorCandidates = [];
  for (const [index, node] of (document?.json?.nodes || []).entries()) {
    const record = {
      nodeIndex: index,
      name: node.name || "",
      translation: Array.isArray(node.translation) ? node.translation.map((value) => roundedNumber(Number(value), 9)) : null,
      rotation: Array.isArray(node.rotation) ? node.rotation.map((value) => roundedNumber(Number(value), 9)) : null,
      scale: Array.isArray(node.scale) ? node.scale.map((value) => roundedNumber(Number(value), 9)) : null
    };
    if (/^label_(?:3|6|10|16|26)ft$/i.test(record.name)) distanceMarkers.push(record);
    if (/(?:mouth|head|figure_main|main_fig)/i.test(record.name)) anchorCandidates.push(record);
  }
  return {
    distanceMarkers: distanceMarkers.sort((left, right) => left.name.localeCompare(right.name)),
    anchorCandidates: anchorCandidates.slice(0, 24)
  };
}

function downloadForReference(downloads, reference, assetType) {
  const basename = decodedBasename(reference);
  return (downloads || []).find((download) => (
    download.assetType === assetType
    && [download.url, download.finalUrl].some((value) => decodedBasename(value) === basename)
  )) || null;
}

function evidenceRefsForLink(sourceEvidence, link) {
  const needles = [decodedBasename(link.modelReference), decodedBasename(link.pointCloudReference)].filter(Boolean);
  return (sourceEvidence || [])
    .filter((item) => needles.some((needle) => String(item?.context || "").toLowerCase().includes(needle)))
    .map((item) => item.id)
    .filter(Boolean)
    .slice(0, 12);
}

export function analyzeExplicitPointCloudEffects({
  links,
  downloads,
  sourceEvidence = []
}) {
  if (!Array.isArray(links) || !links.length) return [];
  return links.map((link) => {
    const modelDownload = downloadForReference(downloads, link.modelReference, "model");
    const pointCloudDownload = downloadForReference(downloads, link.pointCloudReference, "pointcloud");
    let pcdSummary = null;
    let pointCloudParseError = "";
    if (pointCloudDownload?.bytes) {
      try {
        pcdSummary = summarizePcd(pointCloudDownload.bytes);
      } catch (error) {
        pointCloudParseError = error.message;
      }
    }
    let document = null;
    let modelParseError = "";
    if (modelDownload?.bytes) {
      try {
        document = parseGlbDocument(modelDownload.bytes, modelDownload.url || link.modelReference);
      } catch (error) {
        modelParseError = error.message;
      }
    }
    const timeline = document ? transmissionDriverTimeline(document) : null;
    const groupColumn = groupColumnForTimeline(pcdSummary, timeline);
    const limitations = [];
    if (!modelDownload) limitations.push("The explicitly linked GLB was not downloaded.");
    if (!pointCloudDownload) limitations.push("The explicitly linked PCD was not downloaded.");
    if (modelParseError) limitations.push(`GLB driver decoding failed: ${modelParseError}`);
    if (pointCloudParseError) limitations.push(`PCD parsing failed: ${pointCloudParseError}`);
    if (document && !timeline) {
      limitations.push("No transmission cough_driver_N translation-channel family was found; no story-specific reveal schedule was inferred.");
    }
    if (timeline && timeline.emittedDriverCount !== timeline.driverCount) {
      limitations.push(`Only ${timeline.emittedDriverCount}/${timeline.driverCount} driver threshold crossings were decoded.`);
    }
    if (timeline && pcdSummary && !groupColumn) {
      limitations.push("No PCD column matched the complete zero-based driver group range.");
    }
    const complete = Boolean(
      modelDownload
      && pointCloudDownload
      && pcdSummary
      && timeline
      && timeline.driverCount > 0
      && timeline.emittedDriverCount === timeline.driverCount
      && groupColumn
    );
    return {
      id: `pointcloud-effect-${sha1(`${link.id}|${modelDownload?.url || ""}|${pointCloudDownload?.url || ""}`, 12)}`,
      schemaVersion: "storyvr-pointcloud-composite-effect/v1",
      captureStatus: complete ? "complete" : "partial",
      scope: {
        activation: "explicit-source-ptcloud-link-only",
        specialization: "transmission-cough-story",
        requiredForUnrelatedStories: false
      },
      sourceLink: {
        id: link.id,
        detection: link.detection,
        configKey: link.configKey,
        sourceType: link.sourceType,
        source: link.source,
        modelIndex: link.modelIndex,
        transform: link.transform
      },
      model: {
        reference: link.modelReference,
        assetUrl: modelDownload?.url || "",
        finalUrl: modelDownload?.finalUrl || "",
        file: modelDownload ? path.basename(modelDownload.localPath || decodedBasename(modelDownload.url)) : "",
        fileSize: Number(modelDownload?.fileSize || 0),
        parseStatus: document ? "ok" : modelDownload ? "failed" : "unavailable"
      },
      pointCloud: {
        reference: link.pointCloudReference,
        assetUrl: pointCloudDownload?.url || "",
        finalUrl: pointCloudDownload?.finalUrl || "",
        file: pointCloudDownload ? path.basename(pointCloudDownload.localPath || decodedBasename(pointCloudDownload.url)) : "",
        fileSize: Number(pointCloudDownload?.fileSize || 0),
        parseStatus: pcdSummary ? "ok" : pointCloudDownload ? "failed" : "unavailable",
        summary: pcdSummary,
        driverGroupColumn: groupColumn ? {
          index: groupColumn.index,
          name: groupColumn.name,
          values: groupColumn.uniqueValues,
          pointCountsByGroup: groupColumn.valueCounts
        } : null
      },
      driverTimeline: timeline,
      reconstructionContract: timeline && groupColumn ? {
        kind: "fixed-pointcloud-progressive-opacity-reveal",
        sourcePointMotion: "fixed",
        revealMechanism: "group opacity gates",
        groupIndexColumn: groupColumn.name,
        groupCount: timeline.driverCount,
        emitTimesSeconds: timeline.emitTimes.map((item) => ({
          groupIndex: item.groupIndex,
          emitTimeSeconds: item.emitTimeSeconds,
          driverNode: item.nodeName
        })),
        interpretationBasis: "Explicit ptcloud source link, decoded PCD group values, and decoded cough_driver_N GLB translation samplers."
      } : null,
      alignmentEvidence: document ? modelTransformEvidence(document) : null,
      evidenceRefs: evidenceRefsForLink(sourceEvidence, link),
      limitations
    };
  });
}
