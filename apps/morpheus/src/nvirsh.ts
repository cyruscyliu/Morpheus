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
const { findManagedManifestFiles, resolveManagedRunDir } = require("./run-layout");
const { repoRoot } = require("./paths");

const TOOL = "nvirsh";

function nowIso() {
  return new Date().toISOString();
}

function resolveExecutable(command) {
  if (command.includes(path.sep)) {
    return command;
  }
  const pathValue = process.env.PATH || "";
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = path.join(entry, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return command;
}

function sshBinary() {
  return process.env.MORPHEUS_SSH_BIN || resolveExecutable("ssh");
}

function parseSshTarget(input) {
  if (!input) {
    throw new Error("missing ssh target");
  }
  if (input.startsWith("ssh://")) {
    const url = new URL(input);
    if (!url.hostname) {
      throw new Error(`invalid SSH target: ${input}`);
    }
    return {
      original: input,
      user: url.username || undefined,
      host: url.hostname,
      port: url.port ? Number(url.port) : undefined
    };
  }

  const match = /^(?:(?<user>[^@]+)@)?(?<host>[^:]+)(?::(?<port>\d+))?$/.exec(input);
  if (!match || !match.groups || !match.groups.host) {
    throw new Error(`invalid SSH target: ${input}`);
  }
  return {
    original: input,
    user: match.groups.user,
    host: match.groups.host,
    port: match.groups.port ? Number(match.groups.port) : undefined
  };
}

function sshDestination(target) {
  return target.user ? `${target.user}@${target.host}` : target.host;
}

function sshArgs(target, options = {}) {
  const args = [];
  if (options.noSystemConfig) {
    args.push("-F", "/dev/null");
  }
  if (target.port !== undefined) {
    args.push("-p", String(target.port));
  }
  args.push(sshDestination(target));
  return args;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sshCommand(script) {
  return `bash -lc ${shellQuote(script)}`;
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
  return resolveManagedRunDir(workspace, id);
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

function runNodeTool(args, options = {}) {
  const attach = Boolean(options.attach);
  const stdio = attach ? "inherit" : ["ignore", "pipe", "pipe"];
  return spawnSync(process.execPath, [
    path.join(repoRoot(), "tools", "nvirsh", "dist", "index.js"),
    ...args
  ], {
    encoding: "utf8",
    cwd: process.cwd(),
    stdio
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
  hydrateCenteredRunRecords(workspace, "buildroot");

  hydrateWorkflowStepRunRecords(workspace, "buildroot");
}

function artifactLocation(artifact) {
  return artifact && (artifact.local_location || artifact.location || artifact.localPath || artifact.path);
}

function localArtifactDir(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "artifacts");
}

function hydrateWorkflowStepRunRecords(workspace, tool) {
  const runsRoot = path.join(localWorkspaceRoot(workspace), "runs");
  if (!fs.existsSync(runsRoot)) {
    return;
  }

  for (const manifestPath of findManagedManifestFiles(runsRoot)) {
    if (!manifestPath.includes(`${path.sep}steps${path.sep}`)) {
      continue;
    }
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch {
      continue;
    }
    if (!manifest || manifest.tool !== tool) {
      continue;
    }
    registerManagedRun({
      id: manifest.id,
      tool: manifest.tool,
      mode: manifest.mode,
      workspace: path.resolve(process.cwd(), workspace),
      ssh: manifest.transport && manifest.transport.type === "ssh" && manifest.transport.target
        ? manifest.transport.target.original
        : null,
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

function hydrateCenteredRunRecords(workspace, tool) {
  const runsRoot = path.join(localWorkspaceRoot(workspace), "runs");
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
    if (!manifest || manifest.tool !== tool) {
      continue;
    }
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

function normalizeRemotePath(dirPath, relativePath) {
  return path.posix.join(String(dirPath).replace(/\/+$/, ""), String(relativePath).replace(/^\/+/, ""));
}

function fetchRemoteArtifact(record, remotePath, localPath) {
  const ssh = parseSshTarget(record.ssh);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const run = (noSystemConfig) => spawnSync(
    sshBinary(),
    [...sshArgs(ssh, { noSystemConfig }), sshCommand(`cat ${shellQuote(remotePath)}`)],
    { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 1024 }
  );

  let result = run(false);
  const stderr = (result.stderr || Buffer.from("")).toString("utf8");
  if (result.status !== 0 && /Bad owner or permissions on/.test(stderr)) {
    result = run(true);
  }

  if (result.status !== 0) {
    const message = (result.stderr || Buffer.from("")).toString("utf8")
      || (result.stdout || Buffer.from("")).toString("utf8")
      || `failed to fetch remote artifact: ${remotePath}`;
    throw new Error(message.trim());
  }

  fs.writeFileSync(localPath, result.stdout || Buffer.from(""));
}

function hydrateToolRunRecords(workspace, tool) {
  hydrateCenteredRunRecords(workspace, tool);

  hydrateWorkflowStepRunRecords(workspace, tool);
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
      if (artifact.remote_location && record.mode === "remote" && record.ssh) {
        const destination = path.join(localArtifactDir(workspace, record.tool, record.id), spec.artifact);
        fetchRemoteArtifact(record, artifact.remote_location, destination);
        const updated = {
          ...record,
          artifacts: (record.artifacts || []).map((entry) => entry.path === artifact.path
            ? { ...entry, local_location: destination }
            : entry
          )
        };
        registerManagedRun(updated);
        return destination;
      }
    }

    if (record.outputDir) {
      if (record.mode === "local") {
        const candidate = path.join(record.outputDir, spec.artifact);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }

      if (record.mode === "remote" && record.ssh) {
        const remoteLocation = normalizeRemotePath(record.outputDir, spec.artifact);
        const destination = path.join(localArtifactDir(workspace, record.tool, record.id), spec.artifact);
        fetchRemoteArtifact(record, remoteLocation, destination);
        const updated = {
          ...record,
          artifacts: [
            ...(record.artifacts || []),
            {
              path: spec.artifact,
              remote_location: remoteLocation,
              local_location: destination
            }
          ]
        };
        registerManagedRun(updated);
        return destination;
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
    toolManifest: base.toolManifestPath,
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
  const current = readJson(base.toolManifestPath);
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
    toolManifestPath: path.join(runDir, "manifest.json"),
    manifestPath: path.join(runDir, "managed.json"),
    logFile: path.join(runDir, "stdout.log"),
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
    microkitConfig: flags["microkit-config"] || value["microkit-config"] || value.microkitConfig || null,
    toolchain,
    libvmmDir,
    board: flags.board || value.board || "qemu_arm_virt",
    qemuArgs: flags["qemu-arg"]
      || value["qemu-arg"]
      || value["qemu-args"]
      || value.qemuArgs
      || [],
    attach: Boolean(flags.attach || value.attach),
    kernel,
    initrd,
    dependencies: {
      qemu: dependencies.qemu || value.qemu || null,
      microkitSdk: dependencies["microkit-sdk"] || dependencies.microkitSdk || value["microkit-sdk"] || value.microkitSdk || null,
      toolchain: dependencies.toolchain || value.toolchain || null,
      libvmm: dependencies.libvmm || dependencies["libvmm-dir"] || value["libvmm-dir"] || value.libvmmDir || null,
      kernel: dependencies.kernel || null,
      initrd: dependencies.initrd || null,
      sel4: null
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
  ];
  if (options.microkitVersion) {
    args.push("--microkit-version", options.microkitVersion);
  }
  if (options.microkitConfig) {
    args.push("--microkit-config", options.microkitConfig);
  }
  if (options.board) {
    args.push("--board", options.board);
  }
  for (const value of options.qemuArgs || []) {
    args.push("--qemu-arg", value);
  }
  return args;
}

function launchArgs(options) {
  if (options.attach) {
    return [
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
      ...((options.qemuArgs || []).flatMap((value) => ["--qemu-arg", value])),
    ];
  }
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

  let launch = null;
  if (options.attach) {
    if (flags.json) {
      throw new Error("nvirsh --attach cannot be combined with --json");
    }
    const result = runNodeTool(launchArgs(options), { attach: true });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "failed to launch nvirsh target");
    }
    manifest = writeCanonicalManifest(options);
  } else {
    launch = parseJsonResult(
      runNodeTool(launchArgs(options)),
      "failed to launch nvirsh target"
    );
    manifest = writeCanonicalManifest(options);
  }

  return {
    command: "run",
    status: "success",
    exit_code: 0,
    summary: options.attach ? "completed attached nvirsh run" : "started managed nvirsh run",
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
      launch: launch && launch.details ? launch.details.manifest : null
    }
  };
}

module.exports = {
  runManagedNvirsh
};
