import { createHash, randomUUID } from "node:crypto";

export const GENERATIVE_USAGE_SCHEMA_VERSION = "storyvr-generative-token-usage/v1";
export const GENERATIVE_USAGE_HEADER = "x-storyvr-generative-usage";

const GENERATIVE_USAGE = Symbol("storyvr-generative-usage");
const MAX_MEASUREMENTS_PER_RESPONSE = 16;
const MAX_LABEL_LENGTH = 120;
const MAX_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;

/**
 * Normalize provider-reported token usage without estimating or tokenizing.
 * Cached-input, cache-write, and reasoning counts are subsets of input/output.
 */
export function normalizeProviderTokenUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inputTokens = tokenCount(
    value.inputTokens ?? value.input_tokens ?? value.prompt_tokens,
  );
  const outputTokens = tokenCount(
    value.outputTokens ?? value.output_tokens ?? value.completion_tokens,
  );
  if (inputTokens == null || outputTokens == null) return null;

  const inputDetails = objectValue(
    value.inputTokensDetails
      ?? value.input_tokens_details
      ?? value.prompt_tokens_details,
  );
  const outputDetails = objectValue(
    value.outputTokensDetails
      ?? value.output_tokens_details
      ?? value.completion_tokens_details,
  );
  const cachedInputTokens = boundedSubset(
    value.cachedInputTokens
      ?? value.cached_input_tokens
      ?? inputDetails.cachedTokens
      ?? inputDetails.cached_tokens,
    inputTokens,
  );
  const cacheWriteInputTokens = boundedSubset(
    value.cacheWriteInputTokens
      ?? value.cache_write_input_tokens
      ?? inputDetails.cacheWriteTokens
      ?? inputDetails.cache_write_tokens,
    inputTokens,
  );
  const reasoningOutputTokens = boundedSubset(
    value.reasoningOutputTokens
      ?? value.reasoning_output_tokens
      ?? outputDetails.reasoningTokens
      ?? outputDetails.reasoning_tokens,
    outputTokens,
  );

  return Object.freeze({
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
    // Provider schemas define total as input + output. Detail counts above are
    // subsets and must not be added a second time.
    totalTokens: safeTokenSum(inputTokens, outputTokens),
  });
}

export function generativeUsageFromCodexJsonl(stdout, {
  operation,
  provider = "codex-cli",
  model = null,
} = {}) {
  const events = parseJsonLines(stdout);
  const threadId = events.find((event) => event?.type === "thread.started")?.thread_id;
  const completed = events.filter((event) => event?.type === "turn.completed").at(-1);
  return createGenerativeUsageMeasurement({
    provider,
    operation,
    model,
    requestId: threadId || randomUUID(),
    usage: completed?.usage,
  });
}

export function generativeUsageFromOpenAIResponse(response, {
  operation,
  provider = "openai",
  model = response?.model,
} = {}) {
  return createGenerativeUsageMeasurement({
    provider,
    operation,
    model,
    requestId: response?.id || randomUUID(),
    usage: response?.usage,
  });
}

export function createGenerativeUsageMeasurement({
  provider,
  operation,
  model = null,
  requestId,
  usage,
} = {}) {
  const safeProvider = safeLabel(provider, "unknown-provider");
  const safeOperation = safeLabel(operation, "unknown-operation");
  const normalized = normalizeProviderTokenUsage(usage);
  const measurement = {
    schemaVersion: GENERATIVE_USAGE_SCHEMA_VERSION,
    measurementId: `usage-${stableDigest(`${safeProvider}\n${String(requestId || "unknown")}`)}`,
    measurementMethod: "provider-reported",
    measured: Boolean(normalized),
    provider: safeProvider,
    operation: safeOperation,
    ...(safeOptionalLabel(model) ? { model: safeOptionalLabel(model) } : {}),
    ...(normalized || {}),
  };
  return Object.freeze(measurement);
}

export function attachGenerativeUsage(target, ...sources) {
  if ((!target || (typeof target !== "object" && typeof target !== "function"))) return target;
  const measurements = normalizeMeasurements([
    ...generativeUsageOf(target),
    ...sources.flatMap((source) => measurementsFromSource(source)),
  ]);
  try {
    Object.defineProperty(target, GENERATIVE_USAGE, {
      configurable: true,
      enumerable: false,
      value: Object.freeze(measurements),
      writable: false,
    });
  } catch {
    // Instrumentation is best-effort and must never change the generation
    // result for a frozen or otherwise non-extensible domain object.
  }
  return target;
}

export function generativeUsageOf(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
  return Array.isArray(value[GENERATIVE_USAGE]) ? [...value[GENERATIVE_USAGE]] : [];
}

export function generativeUsageHeaderValue(value) {
  const measurements = normalizeMeasurements(generativeUsageOf(value));
  if (!measurements.length) return "";
  return JSON.stringify({
    schemaVersion: GENERATIVE_USAGE_SCHEMA_VERSION,
    measurements,
  });
}

function measurementsFromSource(source) {
  if (!source) return [];
  if (Array.isArray(source)) return source.flatMap((item) => measurementsFromSource(item));
  const attached = generativeUsageOf(source);
  if (attached.length) return attached;
  return source?.schemaVersion === GENERATIVE_USAGE_SCHEMA_VERSION ? [source] : [];
}

function normalizeMeasurements(values) {
  const seen = new Set();
  const normalized = [];
  for (const value of values || []) {
    const measurement = normalizeMeasurement(value);
    if (!measurement || seen.has(measurement.measurementId)) continue;
    seen.add(measurement.measurementId);
    normalized.push(Object.freeze(measurement));
    if (normalized.length >= MAX_MEASUREMENTS_PER_RESPONSE) break;
  }
  return normalized;
}

function normalizeMeasurement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const measurementId = safeOptionalLabel(value.measurementId);
  if (!measurementId) return null;
  const provider = safeLabel(value.provider, "unknown-provider");
  const operation = safeLabel(value.operation, "unknown-operation");
  const usage = normalizeProviderTokenUsage(value);
  const measured = value.measured !== false && Boolean(usage);
  return {
    schemaVersion: GENERATIVE_USAGE_SCHEMA_VERSION,
    measurementId,
    measurementMethod: "provider-reported",
    measured,
    provider,
    operation,
    ...(safeOptionalLabel(value.model) ? { model: safeOptionalLabel(value.model) } : {}),
    ...(measured ? usage : {}),
  };
}

function parseJsonLines(value) {
  const events = [];
  for (const line of String(value || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object" && !Array.isArray(event)) events.push(event);
    } catch {
      // Older Codex CLIs may mix plain output with JSONL. Missing usage is
      // recorded as unavailable rather than guessed.
    }
  }
  return events;
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_TOKEN_COUNT ? number : null;
}

function boundedSubset(value, total) {
  const number = tokenCount(value);
  return number == null ? 0 : Math.min(number, total);
}

function safeTokenSum(left, right) {
  return left > MAX_TOKEN_COUNT - right ? MAX_TOKEN_COUNT : left + right;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeLabel(value, fallback) {
  return safeOptionalLabel(value) || fallback;
}

function safeOptionalLabel(value) {
  const label = String(value || "")
    .replace(/[^A-Za-z0-9._:/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LABEL_LENGTH);
  return label || "";
}

function stableDigest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}
