import { STEP_DEFINITIONS } from "./interaction-analysis.mjs";

const STEP_BY_ID = new Map(STEP_DEFINITIONS.map((step) => [step.id, step]));

/**
 * Turn deterministic workflow analysis into the small amount of copy needed
 * for a first-glance session summary. This deliberately avoids interpreting
 * pauses or intent; it only describes recorded progress, time, and moments.
 */
export function buildSessionSummary(analysis) {
  const session = analysis?.session || {};
  const source = analysis?.source || {};
  const journey = analysis?.journey || {};
  const stats = analysis?.stats || {};
  const moments = Array.isArray(analysis?.moments) ? analysis.moments : [];
  const dwell = Array.isArray(analysis?.stepDwell) ? analysis.stepDwell : [];
  const visitedStepIds = uniqueStrings(
    Array.isArray(journey.uniqueStepIds)
      ? journey.uniqueStepIds
      : dwell.map((entry) => entry?.stepId),
  );
  const visitedStepCount = numberOr(journey.visitedStepCount, visitedStepIds.length, 0);
  const totalStepCount = STEP_DEFINITIONS.length;
  const durationMs = Math.max(0, numberOr(session.durationMs, 0));
  const interactionCount = Math.max(0, numberOr(stats.interactionCount, 0));
  const backtrackCount = Math.max(0, numberOr(journey.backwardTransitionCount, 0));
  const concernCount = moments.filter((moment) => momentValence(moment) === "concern").length;
  const startStepId = journey.startStepId || session.initialStepId || visitedStepIds[0] || "unknown";
  const endStepId = journey.endStepId || visitedStepIds.at(-1) || startStepId;
  const longestStep = dwell.reduce((longest, entry) => (
    numberOr(entry?.durationMs, 0) > numberOr(longest?.durationMs, -1) ? entry : longest
  ), null);
  const fullWorkflow = visitedStepCount >= totalStepCount && Boolean(journey.completedFinalReview || source.endedAt);
  const status = fullWorkflow ? "Full workflow recorded" : `${visitedStepCount} of ${totalStepCount} steps recorded`;
  const headline = fullWorkflow
    ? `All ${totalStepCount} StoryVR steps in ${formatDuration(durationMs)}`
    : `${visitedStepCount} of ${totalStepCount} StoryVR steps in ${formatDuration(durationMs)}`;

  const description = [
    `Started in ${stepLabel(startStepId)} and ${source.endedAt ? "ended" : "was last recorded"} in ${stepLabel(endStepId)}.`,
    longestStep
      ? `${stepLabel(longestStep.stepId)} took the most time (${formatDuration(longestStep.durationMs)}).`
      : "Time by step was not available.",
    `${backtrackCount ? `The path includes ${backtrackCount} ${plural(backtrackCount, "return")} to an earlier step` : "The path shows no returns to an earlier step"}, and ${concernCount ? `${concernCount} ${plural(concernCount, "moment")} may need attention` : "no moments were flagged for attention"}.`,
  ].join(" ");

  return Object.freeze({
    fullWorkflow,
    status,
    headline,
    description,
    durationMs,
    durationLabel: formatDuration(durationMs),
    interactionCount,
    visitedStepCount,
    totalStepCount,
    concernCount,
    momentCount: moments.length,
    backtrackCount,
    startStepId,
    startStepLabel: stepLabel(startStepId),
    endStepId,
    endStepLabel: stepLabel(endStepId),
    longestStepId: longestStep?.stepId || null,
    longestStepLabel: longestStep ? stepLabel(longestStep.stepId) : null,
    longestStepDurationMs: longestStep ? Math.max(0, numberOr(longestStep.durationMs, 0)) : 0,
  });
}

function stepLabel(stepId) {
  return STEP_BY_ID.get(stepId)?.label || titleFromId(stepId || "unknown");
}

function momentValence(moment) {
  const value = String(moment?.valence || moment?.type || moment?.category || "watch").toLowerCase();
  if (["bad", "negative", "friction", "concern", "needs-attention", "error"].includes(value)) return "concern";
  if (["good", "positive", "success"].includes(value)) return "good";
  return "watch";
}

function formatDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 1_000) return `${Math.round(value)}ms`;
  const seconds = Math.floor(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function plural(count, noun) {
  return count === 1 ? noun : `${noun}s`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function numberOr(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function titleFromId(value) {
  return String(value || "unknown").replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
