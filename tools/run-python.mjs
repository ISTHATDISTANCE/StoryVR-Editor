#!/usr/bin/env node

import spawn from "cross-spawn";

const pythonArgs = process.argv.slice(2);
const configuredPython = String(process.env.STORYVR_PYTHON || "").trim();
const candidates = configuredPython
  ? [{ command: configuredPython, prefixArgs: [] }]
  : process.platform === "win32"
    ? [
        { command: "py", prefixArgs: ["-3"] },
        { command: "python3", prefixArgs: [] },
        { command: "python", prefixArgs: [] },
      ]
    : [
        { command: "python3", prefixArgs: [] },
        { command: "python", prefixArgs: [] },
      ];

const selected = candidates.find(({ command, prefixArgs }) => {
  const probe = spawn.sync(command, [
    ...prefixArgs,
    "-c",
    "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)",
  ], {
    stdio: "ignore",
    windowsHide: true,
  });
  return !probe.error && probe.status === 0;
});

if (!selected) {
  const searched = candidates
    .map(({ command, prefixArgs }) => [command, ...prefixArgs].join(" "))
    .join(", ");
  console.error(
    `StoryVR requires Python 3. No usable interpreter was found (${searched}). `
      + "Install Python 3 or set STORYVR_PYTHON to its executable path.",
  );
  process.exit(1);
}

const child = spawn(selected.command, [...selected.prefixArgs, ...pythonArgs], {
  env: process.env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error(`Could not start Python 3: ${error.message}`);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
});
