import path from "node:path";

export function quoteShellArgument(value, {
  platform = process.platform,
} = {}) {
  const text = String(value ?? "");
  if (platform === "win32") return `'${text.replace(/'/g, "''")}'`;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export function shellCommandName(command, {
  platform = process.platform,
} = {}) {
  const name = String(command || "").trim();
  if (platform === "win32" && (name === "npm" || name === "npx")) return `${name}.cmd`;
  return name;
}

export function directoryLinkType({
  platform = process.platform,
} = {}) {
  return platform === "win32" ? "junction" : "dir";
}

export function commandInDirectory(directory, commands, {
  platform = process.platform,
} = {}) {
  const steps = (Array.isArray(commands) ? commands : [commands])
    .map((command) => String(command || "").trim())
    .filter(Boolean);
  if (!steps.length) throw new TypeError("Provide at least one command to run.");

  if (platform === "win32") {
    const chained = steps.map((command, index) => {
      if (index === steps.length - 1) return command;
      return `${command}; if ($LASTEXITCODE -ne 0) { throw "StoryVR command failed with exit code $LASTEXITCODE." }`;
    }).join("; ");
    return `Set-Location -LiteralPath ${quoteShellArgument(path.win32.normalize(directory), { platform })}; if (-not $?) { throw "Could not open the StoryVR command folder." }; ${chained}`;
  }

  return `cd ${quoteShellArgument(directory, { platform })} && ${steps.join(" && ")}`;
}

export function pythonRunnerInvocation(repositoryRoot, args = [], {
  platform = process.platform,
} = {}) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const runner = pathApi.join(repositoryRoot, "tools", "run-python.mjs");
  return ["node", quoteShellArgument(runner, { platform }), ...args.map((value) => quoteShellArgument(value, { platform }))]
    .join(" ");
}

export function readerRunCommands({
  repositoryRoot,
  readerDistBuildScript,
  readerSource,
  distFolder,
  buildBase,
  hostingRoot,
  distPath,
  instanceBuildScript = null,
  viteRoot = null,
  devPort = 5177,
  platform = process.platform,
} = {}) {
  const required = {
    repositoryRoot,
    readerDistBuildScript,
    readerSource,
    distFolder,
    buildBase,
    hostingRoot,
    distPath,
  };
  for (const [label, value] of Object.entries(required)) {
    if (!String(value || "").trim()) throw new TypeError(`StoryVR reader command requires ${label}.`);
  }

  const instanceBuildCommand = instanceBuildScript
    ? `node ${quoteShellArgument(instanceBuildScript, { platform })}`
    : null;
  const viteRootArgument = viteRoot
    ? `${quoteShellArgument(viteRoot, { platform })} `
    : "";
  const devSteps = [
    instanceBuildCommand,
    `${shellCommandName("npx", { platform })} vite ${viteRootArgument}--host 127.0.0.1 --port ${devPort} --strictPort`,
  ].filter(Boolean);
  const readerBuildCommand = [
    "node",
    quoteShellArgument(readerDistBuildScript, { platform }),
    quoteShellArgument(readerSource, { platform }),
    quoteShellArgument(distFolder, { platform }),
    quoteShellArgument(buildBase, { platform }),
    quoteShellArgument(repositoryRoot, { platform }),
  ].join(" ");
  const buildSteps = [instanceBuildCommand, readerBuildCommand].filter(Boolean);
  const httpsArgs = ["https_server.py", "--lan"];
  const pathApi = platform === "win32" ? path.win32 : path;
  if (pathApi.resolve(hostingRoot) !== pathApi.resolve(repositoryRoot)) {
    httpsArgs.push("--root", pathApi.relative(repositoryRoot, hostingRoot));
  }
  httpsArgs.push("--story-path", distPath);
  const httpsCommand = pythonRunnerInvocation(repositoryRoot, httpsArgs, { platform });

  return {
    devCommand: commandInDirectory(repositoryRoot, devSteps, { platform }),
    buildCommand: commandInDirectory(repositoryRoot, buildSteps, { platform }),
    serveCommand: commandInDirectory(repositoryRoot, [httpsCommand], { platform }),
    headsetCommand: commandInDirectory(repositoryRoot, [...buildSteps, httpsCommand], { platform }),
  };
}
