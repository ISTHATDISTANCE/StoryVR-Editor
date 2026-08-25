export const GENERATIVE_TOKEN_USAGE_SCHEMA_VERSION = "storyvr-generative-token-usage/v1";

const MAX_BREAKDOWN_ROWS = 32;
const MAX_LABEL_LENGTH = 120;
const MAX_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;

export function createGenerativeTokenUsageSummary() {
  return {
    schemaVersion: GENERATIVE_TOKEN_USAGE_SCHEMA_VERSION,
    measurementMethod: "provider-reported",
    measuredRequestCount: 0,
    unmeasuredRequestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    byProvider: [],
    byOperation: [],
  };
}

/** Parse StoryVR's transient usage response header without affecting requests. */
export function parseGenerativeUsageEnvelope(value) {
  if (!value) return [];
  let envelope = value;
  if (typeof envelope === "string") {
    try {
      envelope = JSON.parse(envelope);
    } catch {
      return [];
    }
  }
  if (
    !envelope
    || typeof envelope !== "object"
    || Array.isArray(envelope)
    || envelope.schemaVersion !== GENERATIVE_TOKEN_USAGE_SCHEMA_VERSION
    || !Array.isArray(envelope.measurements)
  ) return [];
  return envelope.measurements
    .map(normalizeMeasurement)
    .filter(Boolean);
}

export function accumulateGenerativeTokenUsage(summary, measurements, seenMeasurementIds = new Set()) {
  const next = cloneSummary(normalizeGenerativeTokenUsageSummary(summary)
    || createGenerativeTokenUsageSummary());
  let addedCount = 0;

  for (const value of Array.isArray(measurements) ? measurements : []) {
    const measurement = normalizeMeasurement(value);
    if (!measurement || seenMeasurementIds.has(measurement.measurementId)) continue;
    seenMeasurementIds.add(measurement.measurementId);
    addedCount += 1;
    addMeasurement(next, measurement);
  }

  next.byProvider = sortedBreakdown(next.byProvider);
  next.byOperation = sortedBreakdown(next.byOperation);
  return { summary: next, addedCount };
}

export function normalizeGenerativeTokenUsageSummary(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schemaVersion !== GENERATIVE_TOKEN_USAGE_SCHEMA_VERSION
  ) return null;
  const inputTokens = countOrZero(value.inputTokens);
  const outputTokens = countOrZero(value.outputTokens);
  return {
    schemaVersion: GENERATIVE_TOKEN_USAGE_SCHEMA_VERSION,
    measurementMethod: "provider-reported",
    measuredRequestCount: countOrZero(value.measuredRequestCount),
    unmeasuredRequestCount: countOrZero(value.unmeasuredRequestCount),
    inputTokens,
    cachedInputTokens: Math.min(countOrZero(value.cachedInputTokens), inputTokens),
    cacheWriteInputTokens: Math.min(countOrZero(value.cacheWriteInputTokens), inputTokens),
    outputTokens,
    reasoningOutputTokens: Math.min(countOrZero(value.reasoningOutputTokens), outputTokens),
    totalTokens: safeTokenSum(inputTokens, outputTokens),
    byProvider: normalizeBreakdown(value.byProvider),
    byOperation: normalizeBreakdown(value.byOperation),
  };
}

function addMeasurement(summary, measurement) {
  if (measurement.measured) {
    summary.measuredRequestCount = safeTokenSum(summary.measuredRequestCount, 1);
    summary.inputTokens = safeTokenSum(summary.inputTokens, measurement.inputTokens);
    summary.cachedInputTokens = safeTokenSum(summary.cachedInputTokens, measurement.cachedInputTokens);
    summary.cacheWriteInputTokens = safeTokenSum(summary.cacheWriteInputTokens, measurement.cacheWriteInputTokens);
    summary.outputTokens = safeTokenSum(summary.outputTokens, measurement.outputTokens);
    summary.reasoningOutputTokens = safeTokenSum(summary.reasoningOutputTokens, measurement.reasoningOutputTokens);
    summary.totalTokens = safeTokenSum(summary.inputTokens, summary.outputTokens);
  } else {
    summary.unmeasuredRequestCount = safeTokenSum(summary.unmeasuredRequestCount, 1);
  }
  addBreakdownMeasurement(summary.byProvider, "provider", measurement.provider, measurement);
  addBreakdownMeasurement(summary.byOperation, "operation", measurement.operation, measurement);
}

function addBreakdownMeasurement(rows, key, label, measurement) {
  let row = rows.find((candidate) => candidate[key] === label);
  if (!row) {
    if (rows.length >= MAX_BREAKDOWN_ROWS) return;
    row = {
      [key]: label,
      measuredRequestCount: 0,
      unmeasuredRequestCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    };
    rows.push(row);
  }
  if (measurement.measured) {
    row.measuredRequestCount = safeTokenSum(row.measuredRequestCount, 1);
    row.inputTokens = safeTokenSum(row.inputTokens, measurement.inputTokens);
    row.cachedInputTokens = safeTokenSum(row.cachedInputTokens, measurement.cachedInputTokens);
    row.cacheWriteInputTokens = safeTokenSum(row.cacheWriteInputTokens, measurement.cacheWriteInputTokens);
    row.outputTokens = safeTokenSum(row.outputTokens, measurement.outputTokens);
    row.reasoningOutputTokens = safeTokenSum(row.reasoningOutputTokens, measurement.reasoningOutputTokens);
    row.totalTokens = safeTokenSum(row.inputTokens, row.outputTokens);
  } else {
    row.unmeasuredRequestCount = safeTokenSum(row.unmeasuredRequestCount, 1);
  }
}

function normalizeMeasurement(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schemaVersion !== GENERATIVE_TOKEN_USAGE_SCHEMA_VERSION
  ) return null;
  const measurementId = safeLabel(value.measurementId);
  const provider = safeLabel(value.provider);
  const operation = safeLabel(value.operation);
  if (!measurementId || !provider || !operation) return null;
  const inputTokens = tokenCount(value.inputTokens);
  const outputTokens = tokenCount(value.outputTokens);
  if (value.measured !== false && (inputTokens == null || outputTokens == null)) return null;
  const measured = value.measured !== false;
  return {
    schemaVersion: GENERATIVE_TOKEN_USAGE_SCHEMA_VERSION,
    measurementId,
    measurementMethod: "provider-reported",
    provider,
    operation,
    measured,
    ...(measured ? {
      inputTokens,
      cachedInputTokens: boundedSubset(value.cachedInputTokens, inputTokens),
      cacheWriteInputTokens: boundedSubset(value.cacheWriteInputTokens, inputTokens),
      outputTokens,
      reasoningOutputTokens: boundedSubset(value.reasoningOutputTokens, outputTokens),
      totalTokens: safeTokenSum(inputTokens, outputTokens),
    } : {}),
  };
}

function normalizeBreakdown(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, MAX_BREAKDOWN_ROWS).map((value) => {
    const key = value?.provider ? "provider" : "operation";
    const label = safeLabel(value?.[key]);
    if (!label) return null;
    const inputTokens = countOrZero(value.inputTokens);
    const outputTokens = countOrZero(value.outputTokens);
    return {
      [key]: label,
      measuredRequestCount: countOrZero(value.measuredRequestCount),
      unmeasuredRequestCount: countOrZero(value.unmeasuredRequestCount),
      inputTokens,
      cachedInputTokens: Math.min(countOrZero(value.cachedInputTokens), inputTokens),
      cacheWriteInputTokens: Math.min(countOrZero(value.cacheWriteInputTokens), inputTokens),
      outputTokens,
      reasoningOutputTokens: Math.min(countOrZero(value.reasoningOutputTokens), outputTokens),
      totalTokens: safeTokenSum(inputTokens, outputTokens),
    };
  }).filter(Boolean);
}

function sortedBreakdown(values) {
  return values.sort((left, right) => (
    String(left.provider || left.operation).localeCompare(String(right.provider || right.operation))
  ));
}

function cloneSummary(value) {
  return {
    ...value,
    byProvider: value.byProvider.map((row) => ({ ...row })),
    byOperation: value.byOperation.map((row) => ({ ...row })),
  };
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_TOKEN_COUNT ? number : null;
}

function countOrZero(value) {
  return tokenCount(value) ?? 0;
}

function boundedSubset(value, total) {
  return Math.min(countOrZero(value), total);
}

function safeTokenSum(left, right) {
  return left > MAX_TOKEN_COUNT - right ? MAX_TOKEN_COUNT : left + right;
}

function safeLabel(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._:/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LABEL_LENGTH);
}
