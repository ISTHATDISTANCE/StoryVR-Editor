import { accessSync, constants, statSync } from "node:fs";

export const STORYVR_CODEX_MODEL = "gpt-5.6-sol";
export const STORYVR_CODEX_MODEL_ARGS = Object.freeze(["--model", STORYVR_CODEX_MODEL]);
export const STORYVR_CODEX_PLANNING_ARGS = Object.freeze([
  ...STORYVR_CODEX_MODEL_ARGS,
  "--config", 'model_reasoning_effort="ultra"',
]);

function executableFile(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// Prefer the desktop runtime to an older standalone CLI on PATH, while keeping
// explicit executable overrides available for other installations and tests.
export function resolveStoryvrCodexBin(override, {
  env = process.env,
  platform = process.platform,
  isExecutable = executableFile,
} = {}) {
  if (override) return override;
  if (env.CODEX_BIN) return env.CODEX_BIN;
  const candidates = [
    env.CODEX_CLI_PATH,
    ...(platform === "darwin" ? [
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
    ] : []),
  ];
  return candidates.find((candidate) => candidate && isExecutable(candidate)) || "codex";
}
