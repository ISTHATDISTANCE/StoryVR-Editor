function assertJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Codex response must be a JSON object.");
  }
  return value;
}

function stripMarkdownFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function balancedObjectEnd(value, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return index;
    if (depth < 0) return -1;
  }
  return -1;
}

export function parseCodexJsonObject(value) {
  const cleaned = stripMarkdownFence(value);
  let directError;
  try {
    return assertJsonObject(JSON.parse(cleaned));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    directError = error;
  }

  const start = cleaned.indexOf("{");
  const end = start >= 0 ? balancedObjectEnd(cleaned, start) : -1;
  if (end >= 0) {
    try {
      return assertJsonObject(JSON.parse(cleaned.slice(start, end + 1)));
    } catch {
      // Preserve the original parse error below. Do not accept a valid nested
      // object from inside a malformed outer response.
    }
  }

  const detail = String(directError?.message || "").trim();
  throw new Error(
    `Codex response did not contain a valid JSON object${detail ? `: ${detail}` : "."}`,
  );
}
