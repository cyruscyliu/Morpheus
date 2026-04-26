// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { registerManagedRun, registerManagedWorkspace } = require("./managed-state");
const { repoRoot } = require("./paths");

const TOOL = "qemu";

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

function localBuildDir(workspace, tool, key) {
  return path.join(localToolWorkspace(workspace, tool), "builds", key);
}

function defaultManagedSource(workspace, version) {
  return path.join(localToolWorkspace(workspace, TOOL), "src", `qemu-${version}`);
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

function loadQemuConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools.qemu ? value.tools.qemu : {};
  return {
    baseDir: configDir(config.path),
    value: {
      ...item,
      qemuVersion: item["qemu-version"] || item.qemuVersion || null,
      archiveUrl: item["archive-url"] || item.archiveUrl || null,
      targetList: Array.isArray(item["target-list"])
        ? [...item["target-list"]]
        : Array.isArray(item.targetList)
          ? [...item.targetList]
          : [],
      configureArgs: Array.isArray(item["configure-args"])
        ? [...item["configure-args"]]
        : Array.isArray(item.configureArgs)
          ? [...item.configureArgs]
          : [],
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

function runQemuTool(args) {
  return spawnSync(process.execPath, [
    path.join(repoRoot(), "tools", "qemu", "dist", "index.js"),
    ...args
  ], {
    encoding: "utf8",
    cwd: process.cwd()
  });
}

function buildKeyFromFlags(flags) {
  return flags["build-dir-key"] || "default";
}

function preferredRepeatableFlag(flags, key, fallback) {
  if (Array.isArray(flags[key])) {
    return flags[key].length > 0 ? [...flags[key]] : [...fallback];
  }
  return flags[key] || [...fallback];
}

function parseRunOptions(flags) {
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("run requires --workspace DIR or a workspace root in morpheus.yaml");
  }
  const { baseDir, value } = loadQemuConfig();
  const placementMode = flags.mode || value.mode || "local";
  if (placementMode !== "local") {
    throw new Error("qemu supports only --mode local");
  }

  const options = {
    id: generateRunId(),
    workspace,
    mode: placementMode,
    executable: flags.path
      ? path.resolve(process.cwd(), flags.path)
      : resolveLocalPath(baseDir, value.path || value.executable),
    qemuVersion: flags["qemu-version"] || value.qemuVersion || null,
    archiveUrl: flags["archive-url"] || value.archiveUrl || null,
    source: flags.source
      ? path.resolve(process.cwd(), flags.source)
      : resolveLocalPath(baseDir, value.source),
    configureArgs: preferredRepeatableFlag(flags, "configure-arg", value.configureArgs || []),
    targetList: preferredRepeatableFlag(flags, "target-list", value.targetList || []),
    buildDirKey: buildKeyFromFlags(flags)
  };

  if (!options.source && options.qemuVersion) {
    options.source = defaultManagedSource(workspace, options.qemuVersion);
  }

  const hasExecutable = Boolean(options.executable && fs.existsSync(options.executable));
  options.provisioning = hasExecutable ? "path" : "build";

  if (options.provisioning === "path" && !options.executable) {
    throw new Error("qemu requires --path PATH or tools.qemu.path in morpheus.yaml");
  }

  if (options.provisioning === "build") {
    const sourceExists = Boolean(options.source && fs.existsSync(options.source));
    if (!options.qemuVersion && !options.archiveUrl && !sourceExists) {
      throw new Error("qemu build requires tools.qemu.qemu-version, tools.qemu.archive-url, or an existing tools.qemu.source directory");
    }
    if (!options.source) {
      throw new Error("qemu build requires tools.qemu.source or tools.qemu.qemu-version in morpheus.yaml");
    }
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

function localExecutableManifest(options, runDir, manifestPath, logFile, inspected) {
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
    executable: inspected.details.executable,
    artifacts: [
      {
        path: "qemu-system-aarch64",
        location: inspected.details.executable.path
      }
    ],
    transport: null,
    exitCode: 0
  };
}

function buildModeManifest(options, runDir, manifestPath, result) {
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
    source: options.source,
    qemuVersion: options.qemuVersion || result.details.qemu_version || null,
    archive: result.details.archive || null,
    archiveUrl: result.details.archive_url || options.archiveUrl || null,
    stagedSource: result.details.staged_source || null,
    buildDirKey: options.buildDirKey,
    buildDir: result.details.build_dir,
    installDir: result.details.install_dir,
    runDir,
    outputDir: result.details.install_dir,
    logFile: result.details.log_file,
    manifest: manifestPath,
    executable: result.details.executable,
    artifacts: [
      {
        path: "qemu-system-aarch64",
        location: result.details.executable.path
      }
    ],
    targetList: result.details.target_list || [],
    configureArgs: result.details.configure_args || [],
    transport: null,
    exitCode: 0
  };
}

function runManagedQemu(flags) {
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
      runQemuTool(["--json", "inspect", "--path", options.executable]),
      "failed to inspect QEMU executable"
    );
    fs.writeFileSync(logFile, `${inspected.details.executable.version || ""}\n`, "utf8");
    manifest = localExecutableManifest(options, runDir, manifestPath, logFile, inspected);
  } else {
    const buildRoot = localBuildDir(options.workspace, TOOL, options.buildDirKey);
    const buildDir = path.join(buildRoot, "build");
    const installDir = path.join(buildRoot, "install");
    const downloadsDir = path.join(localToolWorkspace(options.workspace, TOOL), "downloads");
    const args = [
      "--json",
      "build",
      "--source",
      options.source,
      ...(options.qemuVersion ? ["--qemu-version", options.qemuVersion] : []),
      ...(options.archiveUrl ? ["--archive-url", options.archiveUrl] : []),
      "--downloads-dir",
      downloadsDir,
      "--build-dir",
      buildDir,
      "--install-dir",
      installDir,
      ...(options.targetList || []).flatMap((item) => ["--target-list", item]),
      ...(options.configureArgs || []).flatMap((item) => ["--configure-arg", item])
    ];
    const built = parseJsonResult(
      runQemuTool(args),
      "failed to build QEMU executable"
    );
    manifest = buildModeManifest(options, runDir, manifestPath, built);
  }

  writeJson(manifestPath, manifest);
  registerManifest(manifest);

  return {
    command: "run",
    status: "success",
    exit_code: 0,
    summary: options.provisioning === "path"
      ? "registered managed qemu executable"
      : "built and registered managed qemu executable",
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
  runManagedQemu
};
