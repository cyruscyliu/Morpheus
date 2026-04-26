// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { registerManagedRun, registerManagedWorkspace } = require("./managed-state");
const { repoRoot } = require("./paths");
const { runManagedMicrokitSdk } = require("./microkit-sdk");

const TOOL = "libvmm";

function nowIso() {
  return new Date().toISOString();
}

function generateRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 10);
  return `${TOOL}-${stamp}-${random}`;
}

function localWorkspaceRoot(workspace) {
  return path.resolve(process.cwd(), workspace);
}

function localToolWorkspace(workspace, tool) {
  return path.join(localWorkspaceRoot(workspace), "tools", tool);
}

function localRunDir(workspace, tool, id) {
  return path.join(localWorkspaceRoot(workspace), "runs", id);
}

function defaultManagedSource(workspace) {
  return path.join(localToolWorkspace(workspace, TOOL), "src", "libvmm");
}

function localManifestPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "manifest.json");
}

function localLogPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "stdout.log");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadLibvmmConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools[TOOL] ? value.tools[TOOL] : {};
  return {
    baseDir: configDir(config.path),
    value: {
      ...item,
      gitUrl: item["git-url"] || item.gitUrl || null,
      gitRef: item["git-ref"] || item.gitRef || null,
      example: item.example || null,
      patchDir: item["patch-dir"] || item.patchDir || null,
      board: item.board || null,
      linux: item.linux || null,
      initrd: item.initrd || null,
      makeArgs: item["make-args"] || item.makeArgs || null,
      reuseBuildDir: item["reuse-build-dir"] ?? item.reuseBuildDir ?? null,
      buildDirKey: item["build-dir-key"] || item.buildDirKey || null,
    }
  };
}

function parseJsonResult(result, message) {
  if (result.status !== 0) {
    let payload = null;
    try {
      payload = result.stdout ? JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)) : null;
    } catch {
      payload = null;
    }
    const summary = payload && payload.summary ? String(payload.summary) : "";
    const stderr = result.stderr ? String(result.stderr) : "";
    const stdout = result.stdout ? String(result.stdout) : "";
    const stderrTail = stderr.length > 8000 ? stderr.slice(stderr.length - 8000) : stderr;
    const extra = stderrTail && (!summary || !summary.includes(stderrTail.trim()))
      ? `\n\n[tool stderr (tail)]\n${stderrTail.trim()}`
      : "";
    throw new Error((summary || stderrTail || stdout || message) + extra);
  }
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function runTool(args) {
  return spawnSync(process.execPath, [
    path.join(repoRoot(), "tools", TOOL, "dist", "index.js"),
    ...args
  ], {
    encoding: "utf8",
    cwd: process.cwd()
  });
}

function parseRunOptions(flags) {
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("run requires --workspace DIR or a workspace root in morpheus.yaml");
  }
  const { baseDir, value } = loadLibvmmConfig();
  const placementMode = flags.mode || value.mode || "local";
  if (placementMode !== "local") {
    throw new Error("libvmm supports only --mode local");
  }

  const options = {
    id: generateRunId(),
    workspace,
    mode: placementMode,
    source: flags.source
      ? path.resolve(process.cwd(), flags.source)
      : resolveLocalPath(baseDir, value.source),
    gitUrl: flags["git-url"] || value.gitUrl || null,
    gitRef: flags["git-ref"] || value.gitRef || null,
    example: flags.example || value.example || "virtio",
    board: flags.board || value.board || null,
    patchDir: flags["patch-dir"]
      ? path.resolve(process.cwd(), flags["patch-dir"])
      : resolveLocalPath(baseDir, value.patchDir),
    linux: flags.linux ? path.resolve(process.cwd(), flags.linux) : resolveLocalPath(baseDir, value.linux),
    initrd: flags.initrd ? path.resolve(process.cwd(), flags.initrd) : resolveLocalPath(baseDir, value.initrd),
    makeArgs: flags.makeArg || value.makeArgs || [],
    reuseBuildDir: Boolean(flags["reuse-build-dir"] ?? value.reuseBuildDir),
    buildDirKey: flags["build-dir-key"] || value.buildDirKey || "default",
  };

  if (options.reuseBuildDir) {
    options.source = path.join(localToolWorkspace(workspace, TOOL), "builds", options.buildDirKey, "source");
  } else if (!options.source) {
    options.source = defaultManagedSource(workspace);
  }

  if (!options.board) {
    throw new Error("libvmm requires tools.libvmm.board in morpheus.yaml (or --board)");
  }

  return options;
}

function registerManifest(manifest) {
  registerManagedRun({
    id: manifest.id,
    tool: manifest.tool,
    mode: manifest.mode,
    workspace: path.resolve(process.cwd(), manifest.workspace),
    ssh: null,
    status: manifest.status,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    manifest: manifest.manifest,
    logFile: manifest.logFile,
    runDir: manifest.runDir,
    outputDir: manifest.outputDir,
    artifacts: manifest.artifacts
  });
}

function buildManifest(options, runDir, manifestPath, built, toolchain) {
  return {
    schemaVersion: 1,
    id: options.id,
    tool: TOOL,
    mode: "local",
    provisioning: "build",
    command: "run",
    status: "success",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    source: built.details.source,
    buildDirKey: options.reuseBuildDir ? options.buildDirKey : null,
    gitUrl: built.details.git_url || options.gitUrl || null,
    gitRef: built.details.git_ref || options.gitRef || null,
    example: built.details.example || options.example,
    board: built.details.microkit_board || options.board,
    microkitSdk: built.details.microkit_sdk || null,
    runDir,
    outputDir: built.details.source,
    logFile: path.join(runDir, "stdout.log"),
    manifest: manifestPath,
    directory: built.details.directory,
    toolchain: toolchain || null,
    artifacts: built.details.artifacts || [],
    transport: null,
    exitCode: 0
  };
}

function runManagedLibvmm(flags) {
  const options = parseRunOptions(flags);
  registerManagedWorkspace({
    mode: "local",
    root: path.resolve(process.cwd(), options.workspace)
  });
  const runDir = localRunDir(options.workspace, TOOL, options.id);
  const manifestPath = localManifestPath(options.workspace, TOOL, options.id);
  const logFile = localLogPath(options.workspace, TOOL, options.id);
  fs.mkdirSync(runDir, { recursive: true });

  const microkit = runManagedMicrokitSdk({ workspace: options.workspace, mode: "local" });
  const sdkArtifact = (microkit.details.manifest.artifacts || []).find((item) => item.path === "sdk-dir");
  if (!sdkArtifact || !sdkArtifact.location) {
    throw new Error("libvmm could not resolve Microkit SDK artifact sdk-dir");
  }
  const toolchainArtifact = (microkit.details.manifest.artifacts || []).find((item) => item.path === "toolchain-dir");
  const toolchainBinDir = toolchainArtifact && toolchainArtifact.location
    ? path.join(toolchainArtifact.location, "bin")
    : null;

  const workspaceRoot = path.resolve(process.cwd(), options.workspace);
  const venvPython = path.join(workspaceRoot, "tools", TOOL, "pyvenv", "bin", "python");
  const hasPythonOverride = (options.makeArgs || []).some((arg) => typeof arg === "string" && arg.startsWith("PYTHON="));
  const makeArgs = (!hasPythonOverride && fs.existsSync(venvPython))
    ? [...options.makeArgs, `PYTHON=${venvPython}`]
    : options.makeArgs;

  const built = parseJsonResult(
    runTool([
      "--json",
      "build",
      "--source",
      options.source,
      "--microkit-sdk",
      sdkArtifact.location,
      "--board",
      options.board,
      ...(options.example ? ["--example", options.example] : []),
      ...(options.patchDir ? ["--patch-dir", options.patchDir] : []),
      ...(options.linux ? ["--linux", options.linux] : []),
      ...(options.initrd ? ["--initrd", options.initrd] : []),
      ...(toolchainBinDir ? ["--toolchain-bin-dir", toolchainBinDir] : []),
      ...(options.gitUrl ? ["--git-url", options.gitUrl] : []),
      ...(options.gitRef ? ["--git-ref", options.gitRef] : []),
      ...makeArgs.flatMap((arg) => ["--make-arg", arg]),
    ]),
    "failed to build libvmm"
  );

  fs.writeFileSync(logFile, `${built.details && built.details.directory ? built.details.directory.path : ""}\n`, "utf8");
  const manifest = buildManifest(options, runDir, manifestPath, built, toolchainArtifact || null);
  writeJson(manifestPath, manifest);
  registerManifest(manifest);

  return {
    command: "run",
    status: "success",
    exit_code: 0,
    summary: "built and registered managed libvmm directory",
    details: {
      id: manifest.id,
      tool: TOOL,
      mode: manifest.mode,
      provisioning: manifest.provisioning,
      workspace: options.workspace,
      run_dir: runDir,
      manifest,
      log_file: logFile,
      output_dir: manifest.outputDir,
      artifacts: manifest.artifacts
    }
  };
}

module.exports = {
  runManagedLibvmm
};
