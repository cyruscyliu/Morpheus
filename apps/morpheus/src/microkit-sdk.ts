// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { registerManagedRun, registerManagedWorkspace } = require("./managed-state");
const { repoRoot } = require("./paths");

const TOOL = "microkit-sdk";

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
  return path.join(localToolWorkspace(workspace, tool), "runs", id);
}

function defaultManagedSource(workspace, version) {
  return path.join(localToolWorkspace(workspace, TOOL), "sdk", version ? `microkit-sdk-${version}` : "microkit-sdk");
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

function loadMicrokitConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools[TOOL] ? value.tools[TOOL] : {};
  return {
    baseDir: configDir(config.path),
    value: {
      ...item,
      microkitVersion: item["microkit-version"] || item.microkitVersion || item.version || null,
      archiveUrl: item["archive-url"] || item.archiveUrl || null,
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
    throw new Error((payload && payload.summary) || result.stderr || result.stdout || message);
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
  const { baseDir, value } = loadMicrokitConfig();
  const placementMode = flags.mode || value.mode || "local";
  if (placementMode !== "local") {
    throw new Error("microkit-sdk supports only --mode local");
  }

  const options = {
    id: generateRunId(),
    workspace,
    mode: placementMode,
    path: flags.path
      ? path.resolve(process.cwd(), flags.path)
      : resolveLocalPath(baseDir, value.path || value.source),
    microkitVersion: flags["microkit-version"] || value.microkitVersion || null,
    archiveUrl: flags["archive-url"] || value.archiveUrl || null,
  };

  if (!options.path && options.microkitVersion) {
    options.path = defaultManagedSource(workspace, options.microkitVersion);
  }

  if (!options.path) {
    throw new Error("microkit-sdk requires tools.microkit-sdk.path or tools.microkit-sdk.microkit-version in morpheus.yaml");
  }

  options.provisioning = fs.existsSync(options.path) ? "path" : "build";

  if (options.provisioning === "build" && !options.microkitVersion && !options.archiveUrl) {
    throw new Error("microkit-sdk build requires tools.microkit-sdk.microkit-version or tools.microkit-sdk.archive-url");
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

function localManifest(options, runDir, manifestPath, logFile, inspected) {
  return {
    schemaVersion: 1,
    id: options.id,
    tool: TOOL,
    mode: "local",
    provisioning: "path",
    command: "run",
    status: "success",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    runDir,
    outputDir: runDir,
    logFile,
    manifest: manifestPath,
    directory: inspected.details.directory,
    artifacts: [
      {
        path: "sdk-dir",
        location: inspected.details.directory.path
      }
    ],
    transport: null,
    exitCode: 0
  };
}

function buildManifest(options, runDir, manifestPath, fetched) {
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
    source: fetched.details.source,
    microkitVersion: options.microkitVersion || fetched.details.microkit_version || null,
    archive: fetched.details.archive || null,
    archiveUrl: fetched.details.archive_url || options.archiveUrl || null,
    runDir,
    outputDir: fetched.details.source,
    logFile: path.join(runDir, "stdout.log"),
    manifest: manifestPath,
    directory: fetched.details.directory,
    artifacts: [
      {
        path: "sdk-dir",
        location: fetched.details.directory.path
      }
    ],
    transport: null,
    exitCode: 0
  };
}

function runManagedMicrokitSdk(flags) {
  const options = parseRunOptions(flags);
  registerManagedWorkspace({
    mode: "local",
    root: path.resolve(process.cwd(), options.workspace)
  });
  const runDir = localRunDir(options.workspace, TOOL, options.id);
  const manifestPath = localManifestPath(options.workspace, TOOL, options.id);
  const logFile = localLogPath(options.workspace, TOOL, options.id);
  fs.mkdirSync(runDir, { recursive: true });

  let manifest;
  if (options.provisioning === "path") {
    const inspected = parseJsonResult(
      runTool(["--json", "inspect", "--path", options.path]),
      "failed to inspect Microkit SDK directory"
    );
    fs.writeFileSync(logFile, `${inspected.details.directory.version || ""}\n`, "utf8");
    manifest = localManifest(options, runDir, manifestPath, logFile, inspected);
  } else {
    const fetched = parseJsonResult(
      runTool([
        "--json",
        "build",
        "--source",
        options.path,
        ...(options.microkitVersion ? ["--microkit-version", options.microkitVersion] : []),
        ...(options.archiveUrl ? ["--archive-url", options.archiveUrl] : [])
      ]),
      "failed to build Microkit SDK directory"
    );
    fs.writeFileSync(logFile, `${fetched.details.directory.version || ""}\n`, "utf8");
    manifest = buildManifest(options, runDir, manifestPath, fetched);
  }

  writeJson(manifestPath, manifest);
  registerManifest(manifest);

  return {
    command: "run",
    status: "success",
    exit_code: 0,
    summary: options.provisioning === "path"
      ? "registered managed Microkit SDK directory"
      : "built and registered managed Microkit SDK directory",
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
  runManagedMicrokitSdk
};
