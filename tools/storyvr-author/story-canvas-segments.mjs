import { createHash } from "node:crypto";

export const STORY_CANVAS_SEGMENTS_SCHEMA_VERSION = "storyvr-story-canvas-segments/v1";

function clean(value) {
  return String(value ?? "").trim();
}

function authoredBeatIds(beat) {
  const ids = (Array.isArray(beat?.atomicBeatIds) ? beat.atomicBeatIds : [])
    .map(clean)
    .filter(Boolean);
  return ids.length ? ids : [clean(beat?.id)].filter(Boolean);
}

export function storyCanvasSegmentGraphStructure(graph) {
  return (Array.isArray(graph?.beats) ? graph.beats : [])
    .filter((beat) => clean(beat?.id))
    .map((beat) => ({
      id: clean(beat.id),
      atomicBeatIds: authoredBeatIds(beat),
    }));
}

export function storyCanvasSegmentGraphSignature(graph) {
  return createHash("sha256")
    .update(JSON.stringify(storyCanvasSegmentGraphStructure(graph)))
    .digest("hex");
}

export function normalizeStoryCanvasSegments(value, graph) {
  if (!value || typeof value !== "object") return null;

  const beats = (Array.isArray(graph?.beats) ? graph.beats : [])
    .filter((beat) => clean(beat?.id));
  const beatIds = beats.map((beat) => clean(beat.id));
  const beatIndexById = new Map(beatIds.map((beatId, index) => [beatId, index]));
  const errors = [];
  const seenSegmentIds = new Set();
  const seenBeatIds = new Set();
  const rawSegments = Array.isArray(value.segments) ? value.segments : [];

  if (clean(value.schemaVersion) !== STORY_CANVAS_SEGMENTS_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${STORY_CANVAS_SEGMENTS_SCHEMA_VERSION}.`);
  }
  if (!rawSegments.length) errors.push("At least one story canvas segment is required.");

  const segments = rawSegments.map((segment, segmentIndex) => {
    const id = clean(segment?.id);
    const label = clean(segment?.label);
    const members = (Array.isArray(segment?.beatIds) ? segment.beatIds : [])
      .map(clean)
      .filter(Boolean);
    const indices = members
      .map((beatId) => beatIndexById.get(beatId))
      .filter((index) => Number.isInteger(index));

    if (!id) errors.push(`Segment ${segmentIndex + 1} is missing an id.`);
    else if (seenSegmentIds.has(id)) errors.push(`Segment id "${id}" is duplicated.`);
    else seenSegmentIds.add(id);
    if (!label) errors.push(`Segment ${id || segmentIndex + 1} is missing a label.`);
    if (!members.length) errors.push(`Segment ${id || segmentIndex + 1} has no beatIds.`);

    for (const beatId of members) {
      if (!beatIndexById.has(beatId)) {
        errors.push(`Segment ${id || segmentIndex + 1} references unknown beat "${beatId}".`);
        continue;
      }
      if (seenBeatIds.has(beatId)) errors.push(`Beat "${beatId}" appears in more than one segment.`);
      seenBeatIds.add(beatId);
    }

    const startIndex = indices.length ? Math.min(...indices) : -1;
    const endIndex = indices.length ? Math.max(...indices) : -1;
    const expectedIndices = startIndex >= 0
      ? Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset)
      : [];
    if (
      indices.length
      && (
        indices.length !== expectedIndices.length
        || indices.some((index, indexIndex) => index !== expectedIndices[indexIndex])
      )
    ) {
      errors.push(`Segment ${id || segmentIndex + 1} must contain one contiguous beat range in story order.`);
    }

    return {
      id,
      label,
      beatIds: members,
      startIndex,
      endIndex,
      beatCount: indices.length,
    };
  });

  const flattenedBeatIds = segments.flatMap((segment) => segment.beatIds);
  if (
    flattenedBeatIds.length !== beatIds.length
    || flattenedBeatIds.some((beatId, index) => beatId !== beatIds[index])
  ) {
    errors.push("Segments must cover every authored beat exactly once in current story order.");
  }

  const currentGraphSignature = storyCanvasSegmentGraphSignature(graph);
  const currentGraphStructure = storyCanvasSegmentGraphStructure(graph);
  const configuredGraphSignature = clean(value.graphSignature);
  if (!configuredGraphSignature) errors.push("graphSignature is required.");
  const signatureMatches = configuredGraphSignature === currentGraphSignature;

  return {
    schemaVersion: STORY_CANVAS_SEGMENTS_SCHEMA_VERSION,
    graphSignature: configuredGraphSignature,
    currentGraphSignature,
    currentGraphStructure,
    status: errors.length ? "invalid" : signatureMatches ? "current" : "needs-review",
    provenance: value.provenance && typeof value.provenance === "object"
      ? structuredClone(value.provenance)
      : {},
    segments,
    errors,
  };
}
