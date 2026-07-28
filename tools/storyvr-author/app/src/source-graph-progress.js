function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}

function graphBeatStructure(beats) {
  return (Array.isArray(beats) ? beats : [])
    .filter((beat) => clean(beat?.id))
    .map((beat) => {
      const atomicBeatIds = (Array.isArray(beat?.atomicBeatIds) ? beat.atomicBeatIds : [])
        .map(clean)
        .filter(Boolean);
      return {
        id: clean(beat.id),
        atomicBeatIds: atomicBeatIds.length ? atomicBeatIds : [clean(beat.id)],
      };
    });
}

export function sourceGraphProgressStructureMatches(expectedStructure, beats) {
  const expected = Array.isArray(expectedStructure) ? expectedStructure : [];
  const current = graphBeatStructure(beats);
  if (!expected.length || expected.length !== current.length) return false;
  return expected.every((beat, index) => (
    clean(beat?.id) === current[index].id
    && Array.isArray(beat?.atomicBeatIds)
    && beat.atomicBeatIds.length === current[index].atomicBeatIds.length
    && beat.atomicBeatIds.every(
      (atomicBeatId, atomicIndex) => clean(atomicBeatId) === current[index].atomicBeatIds[atomicIndex],
    )
  ));
}

export function sourceGraphProgressStatusForBeats(navigation, beats) {
  if (!navigation || typeof navigation !== "object") return null;
  if (navigation.status !== "current") return navigation.status || "invalid";
  return sourceGraphProgressStructureMatches(navigation.currentGraphStructure, beats)
    ? "current"
    : "needs-review";
}

export function sourceGraphProgressTargetScrollLeft({
  viewportScrollLeft,
  viewportClientWidth,
  viewportScrollWidth,
  viewportLeft,
  targetLeft,
  inset = 28,
}) {
  const currentScrollLeft = finiteNumber(viewportScrollLeft);
  const clientWidth = Math.max(0, finiteNumber(viewportClientWidth));
  const scrollWidth = Math.max(clientWidth, finiteNumber(viewportScrollWidth, clientWidth));
  const contentTargetLeft = currentScrollLeft
    + finiteNumber(targetLeft)
    - finiteNumber(viewportLeft)
    - Math.max(0, finiteNumber(inset, 28));
  return Math.max(0, Math.min(contentTargetLeft, scrollWidth - clientWidth));
}

export function sourceGraphProgressSegmentIndexForPosition(segmentStartPositions, position) {
  const starts = (Array.isArray(segmentStartPositions) ? segmentStartPositions : [])
    .map((value) => finiteNumber(value, Number.NaN));
  if (!starts.length) return -1;
  const target = finiteNumber(position);
  let activeIndex = starts.findIndex(Number.isFinite);
  if (activeIndex < 0) return -1;
  for (let index = 0; index < starts.length; index += 1) {
    if (!Number.isFinite(starts[index])) continue;
    if (starts[index] > target) break;
    activeIndex = index;
  }
  return activeIndex;
}
