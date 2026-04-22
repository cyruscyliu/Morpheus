// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const {
  listManagedRuns,
  registerManagedRun,
  registerManagedWorkspace
} = require("./managed-state");
const { repoRoot } = require("./paths");

const TOOL = "nvirsh";

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

function localManifestPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "manifest.json");
}

function localLogPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "stdout.log");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveRuntimePath(baseDir, inputPath) {
  if (!inputPath) {
    return null;
  }
  return resolveLocalPath(baseDir, inputPath);
}

function runNodeTool(args) {
  return spawnSync(process.execPath, [
    path.join(repoRoot(), "tools", "nvirsh", "dist", "index.js"),
    ...args
  ], {
    encoding: "utf8",
    cwd: process.cwd()
  });
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

function loadNvirshConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  return {
    configPath: config.path,
    baseDir: configDir(config.path),
    value: value.tools && value.tools.nvirsh ? value.tools.nvirsh : {}
  };
}

function hydrateBuildrootRunRecords(workspace) {
  const runsRoot = path.join(localWorkspaceRoot(workspace), "tools", "buildroot", "runs");
  if (!fs.existsSync(runsRoot)) {
    return;
  }
  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(runsRoot, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = readJson(manifestPath);
    registerManagedRun({
      id: manifest.id,
      tool: manifest.tool,
      mode: manifest.mode,
      workspace: path.resolve(process.cwd(), workspace),
      ssh: null,
      status: manifest.status,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      manifest: manifest.manifest,
      logFile: manifest.logFile,
      runDir: manifest.runDir,
      outputDir: manifest.outputDir,
      artifacts: manifest.artifacts || []
    });
  }
}

function artifactLocation(artifact) {
  return artifact && (artifact.local_location || artifact.location || artifact.localPath || artifact.path);
}

function hydrateToolRunRecords(workspace, tool) {
  const runsRoot = path.join(localWorkspaceRoot(workspace), "tools", tool, "runs");
  if (!fs.existsSync(runsRoot)) {
    return;
  }
  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(runsRoot, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = readJson(manifestPath);
    registerManagedRun({
      id: manifest.id,
      tool: manifest.tool,
      mode: manifest.mode,
      workspace: path.resolve(process.cwd(), workspace),
      ssh: null,
      status: manifest.status,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      manifest: manifest.manifest,
      logFile: manifest.logFile,
      runDir: manifest.runDir,
      outputDir: manifest.outputDir,
      artifacts: manifest.artifacts || []
    });
  }
}

function resolveDependencyArtifact(workspace, baseDir, explicitPath, spec, label) {
  if (explicitPath) {
    return resolveRuntimePath(process.cwd(), explicitPath);
  }

  if (!spec) {
    throw new Error(`missing ${label} dependency configuration`);
  }

  if (typeof spec === "string") {
    return resolveRuntimePath(baseDir, spec);
  }

  if (spec.path) {
    return resolveRuntimePath(baseDir, spec.path);
  }

  if (!spec.tool || !spec.artifact) {
    throw new Error(`unsupported ${label} dependency configuration`);
  }

  if (spec.tool === "buildroot") {
    hydrateBuildrootRunRecords(workspace);
  } else {
    hydrateToolRunRecords(workspace, spec.tool);
  }
  const records = listManagedRuns()
    .filter((record) => record.tool === spec.tool)
    .filter((record) => !spec.id || record.id === spec.id)
    .filter((record) => record.status === "success")
    .sort((left, right) => (right.createdAt || right.id).localeCompare(left.createdAt || left.id));

  for (const record of records) {
    for (const artifact of record.artifacts || []) {
      if (artifact.path !== spec.artifact) {
        continue;
      }
      const resolved = artifactLocation(artifact);
      if (resolved && fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }

  throw new Error(`could not resolve ${label} artifact ${spec.artifact} from ${spec.tool}`);
}

function buildManifest(base, runtime) {
  return {
    ...runtime,
    schemaVersion: 1,
    id: base.id,
    tool: TOOL,
    mode: "local",
    command: "run",
    workspace: base.workspace,
    runDir: base.runDir,
    outputDir: base.runDir,
    manifest: base.manifestPath,
    logFile: base.logFile,
    createdAt: runtime.createdAt || base.createdAt,
    updatedAt: nowIso(),
    artifacts: [
      { path: "kernel", location: base.kernel },
      { path: "initrd", location: base.initrd }
    ],
    dependencies: base.dependencies,
    transport: null
  };
}

function writeCanonicalManifest(base) {
  const current = readJson(base.manifestPath);
  const next = buildManifest(base, current);
  writeJson(base.manifestPath, next);
  registerManagedRun({
    id: next.id,
    tool: next.tool,
    mode: next.mode,
    workspace: path.resolve(process.cwd(), next.workspace),
    ssh: null,
    status: next.status,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
    manifest: next.manifest,
    logFile: next.logFile,
    runDir: next.runDir,
    outputDir: next.outputDir,
    artifacts: next.artifacts || []
  });
  return next;
}

function parseRunOptions(flags) {
  const toolConfig = loadNvirshConfig();
  const value = toolConfig.value || {};
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("run requires --workspace DIR or a workspace root in morpheus.yaml");
  }
  const runId = generateRunId();
  const runDir = localRunDir(workspace, TOOL, runId);
  const dependencies = value.dependencies || {};
  const kernel = resolveDependencyArtifact(workspace, toolConfig.baseDir, flags.kernel, dependencies.kernel, "kernel");
  const initrd = resolveDependencyArtifact(workspace, toolConfig.baseDir, flags.initrd, dependencies.initrd, "initrd");
  const toolchain = resolveDependencyArtifact(
    workspace,
    toolConfig.baseDir,
    flags.toolchain,
    dependencies.toolchain || value.toolchain,
    "toolchain"
  );
  const libvmmDir = resolveDependencyArtifact(
    workspace,
    toolConfig.baseDir,
    flags["libvmm-dir"],
    dependencies.libvmm || dependencies["libvmm-dir"] || value["libvmm-dir"] || value.libvmmDir,
    "libvmm-dir"
  );

  return {
    id: runId,
    workspace,
    runDir,
    manifestPath: localManifestPath(workspace, TOOL, runId),
    logFile: localLogPath(workspace, TOOL, runId),
    target: flags.target || value.target || "sel4",
    name: flags.name || value.name || runId,
    qemu: resolveDependencyArtifact(workspace, toolConfig.baseDir, flags.qemu, dependencies.qemu || value.qemu, "qemu"),
    microkitSdk: resolveDependencyArtifact(
      workspace,
      toolConfig.baseDir,
      flags["microkit-sdk"],
      dependencies["microkit-sdk"] || dependencies.microkitSdk || value["microkit-sdk"] || value.microkitSdk,
      "microkit-sdk"
    ),
    microkitVersion: flags["microkit-version"] || value["microkit-version"] || value.microkitVersion || null,
    toolchain,
    libvmmDir,
    sel4Dir: resolveDependencyArtifact(
      workspace,
      toolConfig.baseDir,
      flags["sel4-dir"],
      dependencies.sel4 || dependencies["sel4-dir"] || value.sel4 || value["sel4-dir"] || value.sel4Dir,
      "sel4"
    ),
    sel4Version: flags["sel4-version"] || value["sel4-version"] || value.sel4Version || "15.0.0",
    board: flags.board || value.board || "qemu_arm_virt",
    append: flags.append || value.append || null,
    qemuArgs: flags["qemu-arg"]
      || value["qemu-arg"]
      || value["qemu-args"]
      || value.qemuArgs
      || [],
    kernel,
    initrd,
    dependencies: {
      qemu: dependencies.qemu || value.qemu || null,
      microkitSdk: dependencies["microkit-sdk"] || dependencies.microkitSdk || value["microkit-sdk"] || value.microkitSdk || null,
      toolchain: dependencies.toolchain || value.toolchain || null,
      libvmm: dependencies.libvmm || dependencies["libvmm-dir"] || value["libvmm-dir"] || value.libvmmDir || null,
      kernel: dependencies.kernel || null,
      initrd: dependencies.initrd || null,
      sel4: dependencies.sel4 || dependencies["sel4-dir"] || value.sel4 || value["sel4-dir"] || value.sel4Dir || null
    },
    createdAt: nowIso()
  };
}

function prepareArgs(options) {
  const args = [
    "--json",
    "prepare",
    "--state-dir",
    options.runDir,
    "--name",
    options.name,
    "--target",
    options.target,
    "--qemu",
    options.qemu,
    "--microkit-sdk",
    options.microkitSdk,
    "--toolchain",
    options.toolchain,
    "--libvmm-dir",
    options.libvmmDir,
    "--sel4-dir",
    options.sel4Dir,
    "--sel4-version",
    options.sel4Version
  ];
  if (options.microkitVersion) {
    args.push("--microkit-version", options.microkitVersion);
  }
  if (options.board) {
    args.push("--board", options.board);
  }
  if (options.append) {
    args.push("--append", options.append);
  }
  for (const value of options.qemuArgs || []) {
    args.push("--qemu-arg", value);
  }
  return args;
}

function launchArgs(options) {
  const args = [
    "--json",
    "run",
    "--state-dir",
    options.runDir,
    "--name",
    options.name,
    "--target",
    options.target,
    "--kernel",
    options.kernel,
    "--initrd",
    options.initrd,
    "--detach"
  ];
  if (options.append) {
    args.push("--append", options.append);
  }
  for (const value of options.qemuArgs || []) {
    args.push("--qemu-arg", value);
  }
  return args;
}

async function runManagedNvirsh(flags) {
  if (flags.mode && flags.mode !== "local") {
    throw new Error("nvirsh supports only --mode local");
  }

  const options = parseRunOptions(flags);
  registerManagedWorkspace({
    mode: "local",
    root: path.resolve(process.cwd(), options.workspace)
  });
  fs.mkdirSync(options.runDir, { recursive: true });

  const prepare = parseJsonResult(
    runNodeTool(prepareArgs(options)),
    "failed to prepare nvirsh target"
  );
  let manifest = writeCanonicalManifest(options);

  const launch = parseJsonResult(
    runNodeTool(launchArgs(options)),
    "failed to launch nvirsh target"
  );
  manifest = writeCanonicalManifest(options);

  return {
    command: "run",
    status: "success",
    exit_code: 0,
    summary: "started managed nvirsh run",
    details: {
      id: options.id,
      tool: TOOL,
      mode: "local",
      workspace: options.workspace,
      run_dir: options.runDir,
      manifest,
      log_file: options.logFile,
      output_dir: options.runDir,
      artifacts: manifest.artifacts,
      prepare: prepare.details ? prepare.details.manifest : null,
      launch: launch.details ? launch.details.manifest : null
    }
  };
}

module.exports = {
  runManagedNvirsh
};
