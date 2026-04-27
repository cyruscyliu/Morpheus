// @ts-nocheck
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  registerManagedRun,
  registerManagedWorkspace,
  readManagedRun,
  removeManagedRun,
  listManagedRuns
} = require("./managed-state");
const { parseRunOptions: parseManagedMicrokitSdkOptions, runManagedMicrokitSdk } = require("./microkit-sdk");
const { runManagedQemu } = require("./qemu");
const { parseRunOptions: parseManagedNvirshOptions, runManagedNvirsh } = require("./nvirsh");
const { parseRunOptions: parseManagedSel4Options, runManagedSel4 } = require("./sel4");
const { parseRunOptions: parseManagedLibvmmOptions, runManagedLibvmm } = require("./libvmm");
const { buildArtifacts, parseManagedLlBicOptions, runManagedLlBic } = require("./llbic");
const { parseManagedLlCgOptions, resolvePayloadArtifacts, runManagedLlCg } = require("./llcg");
const { findManagedManifestFiles, resolveManagedRunDir } = require("./run-layout");
const { applyConfigDefaults, configDir, loadConfig, resolveLocalPath } = require("./config");
const { logDebug } = require("./logger");
const { writeStdout, writeStdoutLine } = require("./io");
const { repoRoot } = require("./paths");
const { readManagedToolContract, renderManagedTemplate } = require("./tool-descriptor");

const BUILDROOT_TOOL = "buildroot";
const MICROKIT_SDK_TOOL = "microkit-sdk";
const QEMU_TOOL = "qemu";
const NVIRSH_TOOL = "nvirsh";
const SEL4_TOOL = "sel4";
const LIBVMM_TOOL = "libvmm";
const LLBIC_TOOL = "llbic";
const LLCG_TOOL = "llcg";
const MANAGED_TOOL_ADAPTERS = {
  [BUILDROOT_TOOL]: {
    name: BUILDROOT_TOOL,
    modes: ["local", "remote"]
  },
  [MICROKIT_SDK_TOOL]: {
    name: MICROKIT_SDK_TOOL,
    modes: ["local", "remote"]
  },
  [QEMU_TOOL]: {
    name: QEMU_TOOL,
    modes: ["local", "remote"]
  },
  [NVIRSH_TOOL]: {
    name: NVIRSH_TOOL,
    modes: ["local", "remote"]
  },
  [SEL4_TOOL]: {
    name: SEL4_TOOL,
    modes: ["local", "remote"]
  },
  [LIBVMM_TOOL]: {
    name: LIBVMM_TOOL,
    modes: ["local", "remote"]
  },
  [LLBIC_TOOL]: {
    name: LLBIC_TOOL,
    modes: ["local", "remote"]
  },
  [LLCG_TOOL]: {
    name: LLCG_TOOL,
    modes: ["local", "remote"]
  }
};

function parseRunArgs(argv) {
  const flags = {};
  const positionals = [];
  const repeatable = {
    env: [],
    "make-arg": [],
    "qemu-arg": [],
    "configure-arg": [],
    "target-list": [],
    filter: [],
    file: [],
    kconfig: [],
    "rust-target": [],
    path: [],
    artifact: [],
    "config-fragment": []
  };
  const booleanFlags = new Set(["json", "detach", "follow", "verbose", "reuse-build-dir", "attach", "out-of-tree", "outtree", "intree", "rust"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      flags.forwarded = argv.slice(index + 1);
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (Object.prototype.hasOwnProperty.call(repeatable, key)) {
      if (!next || next.startsWith("--")) {
        throw new Error(`missing value for --${key}`);
      }
      repeatable[key].push(next);
      index += 1;
      continue;
    }

    if (!booleanFlags.has(key) && next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return {
    ...flags,
    env: repeatable.env,
    makeArg: repeatable["make-arg"],
    "qemu-arg": repeatable["qemu-arg"],
    "configure-arg": repeatable["configure-arg"],
    "target-list": repeatable["target-list"],
    filter: repeatable.filter,
    file: repeatable.file,
    kconfig: repeatable.kconfig,
    "rust-target": repeatable["rust-target"],
    paths: repeatable.path,
    path: repeatable.path.length > 0 ? repeatable.path[repeatable.path.length - 1] : flags.path,
    positionals,
    forwarded: flags.forwarded || []
  };
}

function managedRunUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js tool build --tool buildroot --mode local --workspace DIR (--source DIR | --buildroot-version VER) [--defconfig NAME] [--patch-dir DIR] [--reuse-build-dir] [--build-dir-key KEY] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool buildroot --mode remote --ssh TARGET --workspace DIR (--source DIR | --buildroot-version VER) [--defconfig NAME] [--patch-dir DIR] [--reuse-build-dir] [--build-dir-key KEY] [--detach] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool microkit-sdk --mode local|remote --workspace DIR [--path PATH] [--archive-url URL] [--microkit-archive-url URL] [--microkit-dir DIR] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool qemu --mode local|remote --workspace DIR (--path PATH | --qemu-version VER) [--archive-url URL] [--build-dir-key KEY] [--target-list NAME ...] [--configure-arg ARG ...] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool run --tool qemu --mode local --workspace DIR [--path PATH] --kernel PATH --initrd PATH [--run-dir DIR] [--append TEXT] [--qemu-arg ARG ...] [--detach] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool nvirsh --mode local|remote --workspace DIR [--target sel4] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool run --tool nvirsh --mode local|remote --workspace DIR [--target sel4] [--attach] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool sel4 --mode local|remote --workspace DIR (--path PATH | --sel4-version VER) [--archive-url URL] [--patch-dir DIR] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool libvmm --mode local|remote --workspace DIR [--source DIR] --board NAME [--example NAME] [--patch-dir DIR] [--linux PATH] [--initrd PATH] [--make-arg KEY=VALUE ...] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool llbic --mode local|remote --workspace DIR <version|subcommand ...> [--arch ARCH] [--out-of-tree] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool llcg --mode local|remote --workspace DIR run|genmutator|inspect ... [--reuse-build-dir] [--build-dir-key KEY] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js runs list --managed [--workspace DIR] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js runs inspect --id RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js runs logs --id RUN_ID [--follow] [--json]",
    "  node apps/morpheus/dist/cli.js runs fetch --id RUN_ID --dest DIR --path RUN_PATH [--path RUN_GLOB ...] [--json]",
    "  node apps/morpheus/dist/cli.js runs remove --id RUN_ID [--json]"
  ].join("\n");
}

function parseSshTarget(input) {
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sshCommand(script) {
  return `bash -lc ${shellQuote(script)}`;
}

function parseKeyValues(values) {
  const result = {};
  for (const item of values || []) {
    const eq = item.indexOf("=");
    if (eq <= 0) {
      throw new Error(`expected KEY=VALUE but received: ${item}`);
    }
    result[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return result;
}

function normalizeArtifactRequests(values) {
  const items = Array.isArray(values) ? values : values ? [values] : [];
  return items.map((item) => String(item)).filter(Boolean);
}

function normalizeConfigFragment(values) {
  const items = Array.isArray(values) ? values : values ? [values] : [];
  return items.map((item) => String(item)).filter(Boolean);
}

function normalizeOptionalPath(value) {
  if (!value) {
    return null;
  }
  return resolveLocalPath(process.cwd(), value);
}

function hasParallelMakeArg(values) {
  return (values || []).some((value) => {
    const item = String(value);
    return /^-j(\d+)?$/.test(item) || /^-j\$\((nproc|proc)\)$/.test(item) || /^--jobs(=.+)?$/.test(item);
  });
}

function detectLocalParallelism() {
  return Math.max(
    1,
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : ((os.cpus() || []).length || 1)
  );
}

function isDynamicParallelMakeArg(value) {
  return /^-j\$\((nproc|proc)\)$/.test(String(value));
}

function resolveLocalMakeArg(value) {
  if (isDynamicParallelMakeArg(value)) {
    return `-j${detectLocalParallelism()}`;
  }
  return String(value);
}

function resolveRemoteShellMakeArg(value) {
  if (isDynamicParallelMakeArg(value)) {
    return '"-j${MORPHEUS_MAKE_JOBS}"';
  }
  return shellQuote(value);
}

function localParallelMakeArgs(values) {
  if (hasParallelMakeArg(values)) {
    return (values || []).map((value) => resolveLocalMakeArg(value));
  }
  return [`-j${detectLocalParallelism()}`, ...(values || [])];
}

function remoteParallelMakeArgs(values) {
  const dynamicParallel = (values || []).some((value) => isDynamicParallelMakeArg(value));
  if (hasParallelMakeArg(values)) {
    return {
      manifestArgs: [...values],
      shellArgs: values.map((value) => resolveRemoteShellMakeArg(value)),
      shellSetup: dynamicParallel
        ? 'MORPHEUS_MAKE_JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)"'
        : ""
    };
  }
  return {
    manifestArgs: ["-j$(nproc)", ...(values || [])],
    shellArgs: [`"-j\${MORPHEUS_MAKE_JOBS}"`, ...(values || []).map((value) => shellQuote(value))],
    shellSetup: 'MORPHEUS_MAKE_JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)"'
  };
}

function generateRunId(tool) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${tool}-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function buildrootTarballUrl(version) {
  return `https://buildroot.org/downloads/buildroot-${version}.tar.gz`;
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

function localBuildDir(workspace, tool, key) {
  return path.join(localToolWorkspace(workspace, tool), "builds", key);
}

function localManifestPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "manifest.json");
}

function localLogPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "stdout.log");
}

function remoteToolWorkspace(workspace, tool) {
  return path.posix.join(workspace, "tools", tool);
}

function toPosixPath(value) {
  return String(value).split(path.sep).join(path.posix.sep);
}

function remoteWorkspacePath(workspace, localWorkspace, localPath) {
  const text = String(localPath || "");
  if (!text) {
    return text;
  }
  if (localWorkspace) {
    const relative = path.relative(
      path.resolve(process.cwd(), localWorkspace),
      path.resolve(process.cwd(), text)
    );
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return path.posix.join(workspace, toPosixPath(relative));
    }
  }
  return toPosixPath(text);
}

function remoteRunDir(workspace, tool, id, localWorkspace) {
  const explicitRunDir = process.env.MORPHEUS_RUN_DIR_OVERRIDE;
  if (explicitRunDir && localWorkspace) {
    const relative = path.relative(
      path.resolve(process.cwd(), localWorkspace),
      path.resolve(process.cwd(), explicitRunDir)
    );
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return path.posix.join(workspace, toPosixPath(relative));
    }
  }

  return path.posix.join(workspace, "runs", id);
}

function remoteBuildDir(workspace, tool, key) {
  return path.posix.join(remoteToolWorkspace(workspace, tool), "builds", key);
}

function remoteManifestPath(workspace, tool, id, localWorkspace) {
  return path.posix.join(remoteRunDir(workspace, tool, id, localWorkspace), "manifest.json");
}

function remoteLogPath(workspace, tool, id, localWorkspace) {
  return path.posix.join(remoteRunDir(workspace, tool, id, localWorkspace), "stdout.log");
}

function wantsSshNoConfigRetry(result) {
  const stderr = String(result && result.stderr ? result.stderr : "");
  return /Bad owner or permissions on .*ssh_config\.d/.test(stderr);
}

function runSsh(target, script, streamOutput) {
  const run = (noSystemConfig) => spawnSync(
    sshBinary(),
    [...sshArgs(target, { noSystemConfig }), sshCommand(script)],
    {
      encoding: "utf8",
      stdio: streamOutput ? ["ignore", "inherit", "pipe"] : ["ignore", "pipe", "pipe"]
    }
  );

  logDebug("remote", "running ssh command", {
    ssh: target.original,
    stream: Boolean(streamOutput),
  });

  let result = run(false);
  if (result.status !== 0 && wantsSshNoConfigRetry(result)) {
    logDebug("remote", "retrying ssh command with -F /dev/null", {
      ssh: target.original,
    });
    result = run(true);
  }
  return normalizeSpawnResult(result);
}

function runSshStreaming(target, script, handlers) {
  const run = (noSystemConfig) => new Promise((resolve) => {
    logDebug("remote", "running ssh streaming command", {
      ssh: target.original,
      noSystemConfig,
    });
    const child = spawn(sshBinary(), [...sshArgs(target, { noSystemConfig }), sshCommand(script)], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";
    let stderrRemainder = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      if (handlers && handlers.collectStdout) {
        stdout += chunk;
      }
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() || "";
      for (const line of lines) {
        if (handlers && handlers.onStdoutLine) {
          handlers.onStdoutLine(line);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      stderrRemainder += chunk;
      const lines = stderrRemainder.split(/\r?\n/);
      stderrRemainder = lines.pop() || "";
      for (const line of lines) {
        if (handlers && handlers.onStderrLine) {
          handlers.onStderrLine(line);
        }
      }
      if (handlers && handlers.onStderr) {
        handlers.onStderr(chunk);
      }
    });

    child.on("error", (error) => {
      resolve({
        stdout,
        stderr,
        exitCode: 1,
        error
      });
    });

    child.on("close", (code) => {
      if (stdoutRemainder) {
        if (handlers && handlers.collectStdout) {
          stdout += stdoutRemainder;
        }
        if (handlers && handlers.onStdoutLine) {
          handlers.onStdoutLine(stdoutRemainder);
        }
      }
      if (stderrRemainder) {
        if (handlers && handlers.onStderrLine) {
          handlers.onStderrLine(stderrRemainder);
        }
      }
      resolve({
        stdout,
        stderr,
        exitCode: code == null ? 1 : code,
        error: null
      });
    });
  });

  return run(false).then((result) => {
    if (result.exitCode !== 0 && wantsSshNoConfigRetry(result)) {
      return run(true);
    }
    return result;
  });
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options && options.cwd,
    env: options && options.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return normalizeSpawnResult(result);
}

function runShell(command) {
  return runCommand("bash", ["-c", command]);
}

function normalizeSpawnResult(result) {
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status == null ? 1 : result.status,
    error: result.error || null
  };
}

function emitJson(value) {
  writeStdoutLine(JSON.stringify(value));
}

function emitText(value) {
  writeStdoutLine(value);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function appendLog(logFile, result) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, result.stdout || "", "utf8");
  fs.appendFileSync(logFile, result.stderr || "", "utf8");
}

function requireFlag(flags, name, message) {
  if (!flags[name]) {
    throw new Error(message || `missing required flag: --${name}`);
  }
  return flags[name];
}

function resolveManagedTool(tool) {
  const adapter = MANAGED_TOOL_ADAPTERS[tool];
  if (!adapter) {
    throw new Error(`unsupported tool: ${tool}`);
  }
  return adapter;
}

function requireManagedTool(flags, command) {
  const tool = requireFlag(
    flags,
    "tool",
    `${command} requires --tool buildroot|microkit-sdk|qemu|nvirsh|sel4|libvmm|llbic|llcg`
  );
  return resolveManagedTool(tool);
}

function ensureLocalBuildrootSource(options) {
  if (options.source) {
    return path.resolve(process.cwd(), options.source);
  }

  const version = requireFlag(
    options,
    "buildrootVersion",
    "run requires --buildroot-version VER when --source is not provided"
  );
  const toolRoot = localToolWorkspace(options.workspace, BUILDROOT_TOOL);
  const cacheDir = path.join(toolRoot, "cache");
  const srcRoot = path.join(toolRoot, "src");
  const tarball = path.join(cacheDir, `buildroot-${version}.tar.gz`);
  const sourceDir = path.join(srcRoot, `buildroot-${version}`);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(srcRoot, { recursive: true });

  if (!fs.existsSync(sourceDir)) {
    if (!fs.existsSync(tarball)) {
      const download = runCommand("curl", ["-fsSL", buildrootTarballUrl(version), "-o", tarball]);
      if (download.exitCode !== 0) {
        throw new Error(download.stderr || `failed to download Buildroot ${version}`);
      }
    }
    const extract = runCommand("tar", ["-xzf", tarball, "-C", srcRoot]);
    if (extract.exitCode !== 0) {
      throw new Error(extract.stderr || `failed to extract Buildroot ${version}`);
    }
  }

  return sourceDir;
}

function parseBuildrootRunOptions(flags) {
  const adapter = requireManagedTool(flags, "run");
  const mode = requireFlag(flags, "mode", "run requires --mode local|remote");
  if (!adapter.modes.includes(mode)) {
    throw new Error(`unsupported run mode: ${mode}`);
  }

  const options = {
    tool: adapter.name,
    mode,
    workspace: requireFlag(flags, "workspace", "run requires --workspace DIR"),
    localWorkspace: flags.localWorkspace || null,
    buildrootVersion: flags["buildroot-version"] || null,
    source: flags.source || null,
    patchDir: normalizeOptionalPath(flags["patch-dir"]),
    reuseBuildDir: Boolean(flags["reuse-build-dir"]),
    buildDirKey: flags["build-dir-key"] || null,
    defconfig: flags.defconfig || null,
    expectedArtifacts: normalizeArtifactRequests(flags.artifact || flags.artifacts),
    configFragment: normalizeConfigFragment(flags["config-fragment"]),
    makeArgs: flags.makeArg || [],
    env: parseKeyValues(flags.env || []),
    forwarded: flags.forwarded || [],
    detach: Boolean(flags.detach),
    json: Boolean(flags.json)
  };

  if (mode === "remote") {
    options.ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
    if (!options.buildrootVersion && !options.source) {
      throw new Error("remote mode requires --source DIR or --buildroot-version VER");
    }
  }

  if (mode === "local" && !options.source && !options.buildrootVersion) {
    throw new Error("local mode requires --source DIR or --buildroot-version VER");
  }

  if (options.patchDir && hasGlobalPatchDirConfig(options.configFragment)) {
    throw new Error("run cannot combine --patch-dir DIR with BR2_GLOBAL_PATCH_DIR in --config-fragment");
  }

  if (options.buildDirKey && !options.reuseBuildDir) {
    throw new Error("run cannot use --build-dir-key KEY without --reuse-build-dir");
  }

  return options;
}

function parseExistingRunOptions(flags, command) {
  const id = requireFlag(flags, "id", `${command} requires --id RUN_ID`);
  const record = readManagedRun(id);
  const tool = flags.tool || (record ? record.tool : BUILDROOT_TOOL);
  resolveManagedTool(tool);
  const ssh = flags.ssh ? parseSshTarget(flags.ssh) : null;
  return {
    workspace: flags.workspace || (record ? record.workspace : null),
    id,
    tool,
    ssh: ssh || (record && record.ssh ? parseSshTarget(record.ssh) : null),
    json: Boolean(flags.json),
    follow: Boolean(flags.follow),
    record
  };
}

function buildCanonicalManifest(base) {
  return {
    schemaVersion: 1,
    id: base.id,
    tool: base.tool,
    mode: base.mode,
    command: "run",
    status: base.status,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    workspace: base.workspace,
    buildDirKey: base.buildDirKey || null,
    buildrootVersion: base.buildrootVersion || null,
    source: base.source || null,
    patchDir: base.patchDir || null,
    defconfig: base.defconfig || null,
    configFragment: base.configFragment || [],
    expectedArtifacts: base.expectedArtifacts || [],
    artifacts: base.artifacts || [],
    makeArgs: base.makeArgs || [],
    env: base.env || {},
    forwarded: base.forwarded || [],
    runDir: base.runDir,
    buildDir: base.buildDir || null,
    outputDir: base.outputDir,
    logFile: base.logFile,
    manifest: base.manifest,
    transport: base.transport || null,
    exitCode: base.exitCode,
    errorMessage: base.errorMessage
  };
}

function registerRunFromManifest(manifest, ssh) {
  return registerManagedRun({
    id: manifest.id,
    tool: manifest.tool,
    mode: manifest.mode,
    workspace: manifest.mode === "local"
      ? path.resolve(process.cwd(), manifest.workspace)
      : manifest.workspace,
    ssh: ssh ? ssh.original : null,
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

function registerRemoteRunRecord(details, ssh) {
  return registerManagedRun({
    id: details.id,
    tool: details.tool || BUILDROOT_TOOL,
    mode: "remote",
    workspace: details.workspace,
    ssh: ssh ? ssh.original : null,
    status: details.status,
    createdAt: details.createdAt,
    updatedAt: details.updatedAt,
    manifest: details.manifest,
    logFile: details.logFile,
    runDir: details.runDir,
    outputDir: details.outputDir,
    artifacts: details.artifacts || []
  });
}

function buildRemoteArtifactRecords(manifest) {
  return (manifest.expectedArtifacts || []).map((requestedPath) => ({
    path: requestedPath,
    remote_location: path.posix.join(manifest.outputDir, requestedPath)
  }));
}

function reconcileRemoteManifest(manifest, ssh) {
  if (!manifest || manifest.mode !== "remote" || manifest.status !== "running") {
    return manifest;
  }
  const assumeInactive = process.env.MORPHEUS_ASSUME_REMOTE_RUN_INACTIVE === "1";
  const manifestBase64 = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64");

  const script = `
python3 - <<'PY'
import base64
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

manifest = json.loads(base64.b64decode(${shellQuote(manifestBase64)}).decode("utf-8"))
manifest_path = Path(manifest["manifest"])
paths = [manifest["id"], manifest["runDir"], manifest["outputDir"]]
active = ${assumeInactive ? "False" : `False
ps = subprocess.run(["ps", "-eo", "pid=,args="], capture_output=True, text=True, check=False)
current_pid = os.getpid()
parent_pid = os.getppid()
for line in ps.stdout.splitlines():
    line = line.strip()
    if not line:
        continue
    pid_text, _, args = line.partition(" ")
    try:
        pid = int(pid_text)
    except ValueError:
        continue
    if pid in (current_pid, parent_pid):
        continue
    markers = (
        " make ",
        "make O=",
        "make -C ",
        "./configure",
        " set -euo pipefail ",
        " tee -a ",
        " gcc ",
        " cc1 ",
        " ld "
    )
    if any(token and token in args for token in paths) and any(marker in args for marker in markers):
        active = True
        break`}
if not active:
    expected = manifest.get("expectedArtifacts", [])
    artifacts = []
    all_present = True
    for relpath in expected:
        fullpath = os.path.join(manifest["outputDir"], relpath)
        if os.path.exists(fullpath):
            artifacts.append({
                "path": relpath,
                "remote_location": fullpath
            })
        else:
            all_present = False
    manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
    if expected and all_present:
        manifest["status"] = "success"
        manifest["exitCode"] = 0
        manifest["artifacts"] = artifacts
        manifest.pop("errorMessage", None)
    else:
        manifest["status"] = "error"
        manifest["exitCode"] = manifest.get("exitCode", 1) or 1
        manifest["errorMessage"] = "remote run stopped without final manifest update"
        if artifacts:
            manifest["artifacts"] = artifacts
    if manifest_path.parent.exists():
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\\n")
print(json.dumps(manifest))
PY
`;
  return JSON.parse(runRequiredSsh(ssh, script, "failed to reconcile remote manifest").stdout);
}

function normalizeWorkspaceFilter(record, workspace) {
  if (!workspace) {
    return true;
  }
  if (record.mode === "local") {
    return path.resolve(process.cwd(), record.workspace) === path.resolve(process.cwd(), workspace);
  }
  return record.workspace === workspace;
}

function localArtifactDir(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "artifacts");
}

function canonicalLocalBuildrootOutputDir(workspace, buildDirKey) {
  if (!workspace || !buildDirKey) {
    return null;
  }
  return path.join(localBuildDir(workspace, BUILDROOT_TOOL, buildDirKey), "output");
}

function validateAndResolveLocalArtifacts(outputDir, requestedPaths) {
  const artifacts = [];
  for (const requestedPath of requestedPaths || []) {
    const resolvedPath = path.resolve(outputDir, requestedPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`expected artifact is missing: ${requestedPath}`);
    }
    artifacts.push({
      path: requestedPath,
      location: resolvedPath
    });
  }
  return artifacts;
}

function hasGlobalPatchDirConfig(fragmentLines) {
  return (fragmentLines || []).some((line) => /^BR2_GLOBAL_PATCH_DIR=/.test(String(line)));
}

function filterBuildrootConfigLines(fragmentLines, predicate) {
  return (fragmentLines || []).filter((line) => !predicate(String(line).trim()));
}

function effectiveBuildrootConfigFragment(fragmentLines, options = {}) {
  const {
    globalPatchDir = null,
    kernelTarballLocation = null,
    kernelConfigFragment = null
  } = options;

  const effective = [...(fragmentLines || [])];
  let next = effective;

  if (kernelTarballLocation) {
    next = filterBuildrootConfigLines(next, (line) => /^BR2_LINUX_KERNEL_CUSTOM_/.test(line));
    next.push("BR2_LINUX_KERNEL_CUSTOM_TARBALL=y");
    next.push(`BR2_LINUX_KERNEL_CUSTOM_TARBALL_LOCATION=${JSON.stringify(kernelTarballLocation)}`);
  }

  if (kernelConfigFragment) {
    const alreadyConfigured = next.some((line) => /^BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES=/.test(String(line).trim()));
    if (!alreadyConfigured) {
      next.push(`BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES=${JSON.stringify(kernelConfigFragment)}`);
    }
  }

  if (globalPatchDir) {
    next.push(`BR2_GLOBAL_PATCH_DIR=${JSON.stringify(globalPatchDir)}`);
  }

  return next;
}

function ensureExistingDirectory(dirPath, label) {
  if (!dirPath) {
    return null;
  }
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return resolved;
}

function findBuildrootCustomKernelVersion(fragmentLines) {
  for (const line of fragmentLines || []) {
    const match = /^BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE="([^"]+)"$/.exec(String(line).trim());
    if (match) {
      return match[1];
    }
  }
  return null;
}

function requireBuildrootCustomKernelVersion(fragmentLines, context) {
  const version = findBuildrootCustomKernelVersion(fragmentLines);
  if (!version) {
    throw new Error(`${context} requires BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE`);
  }
  return version;
}

function kernelHashUrl(version) {
  const major = String(version).split(".")[0];
  if (!/^\d+$/.test(major)) {
    throw new Error(`unsupported kernel version format: ${version}`);
  }
  return `https://cdn.kernel.org/pub/linux/kernel/v${major}.x/sha256sums.asc`;
}

function ensureTarballHashEntry(filePath, tarball, hashUrl) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (new RegExp(`\\b${tarball.replace(/\./g, "\\.")}\\b`).test(existing)) {
    return;
  }

  logDebug("remote", "resolving custom kernel hash", {
    tarball,
    hashUrl,
    hashFile: filePath
  });

  const response = runCommand("curl", ["-fsSL", hashUrl]);
  if (response.exitCode !== 0) {
    throw new Error(response.stderr || `failed to fetch kernel hashes for ${tarball}`);
  }

  const hashLine = response.stdout
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(`  ${tarball}`));
  if (!hashLine) {
    throw new Error(`failed to find kernel hash for ${tarball}`);
  }
  const normalizedHashLine = (() => {
    const fields = hashLine.trim().split(/\s+/);
    if (fields.length === 2) {
      return `sha256  ${fields[0]}  ${fields[1]}`;
    }
    return hashLine.trim();
  })();

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const prefix = existing.trim().length > 0 ? `${existing.replace(/\s*$/, "\n")}` : "";
  const header = existing.includes("# From ")
    ? ""
    : `# From ${hashUrl}\n`;
  fs.writeFileSync(filePath, `${prefix}${header}${normalizedHashLine}\n`, "utf8");
}

function ensureLiteralHashEntry(filePath, tarball, sha256, sourceLabel) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (new RegExp(`\\b${tarball.replace(/\./g, "\\.")}\\b`).test(existing)) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const prefix = existing.trim().length > 0 ? `${existing.replace(/\s*$/, "\n")}` : "";
  const header = sourceLabel && !existing.includes(`# From ${sourceLabel}`)
    ? `# From ${sourceLabel}\n`
    : "";
  fs.writeFileSync(filePath, `${prefix}${header}sha256  ${sha256}  ${tarball}\n`, "utf8");
}

function ensureKernelHashInPatchDir(patchDir, fragmentLines) {
  if (!patchDir) {
    return;
  }
  const version = findBuildrootCustomKernelVersion(fragmentLines);
  if (!version) {
    return;
  }

  const tarball = `linux-${version}.tar.xz`;
  const hashUrl = kernelHashUrl(version);
  ensureTarballHashEntry(path.join(patchDir, "linux", "linux.hash"), tarball, hashUrl);
  ensureTarballHashEntry(
    path.join(patchDir, "linux-headers", "linux-headers.hash"),
    tarball,
    hashUrl
  );
}

function readKernelConfigFragment(patchDir) {
  if (!patchDir) {
    return null;
  }
  const fragmentPath = path.join(patchDir, "linux", "kernel.fragment");
  if (!fs.existsSync(fragmentPath)) {
    return null;
  }
  return fs.readFileSync(fragmentPath, "utf8");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

function kernelPatchFingerprint(patchDir, kernelPatchFiles) {
  if (!patchDir || !kernelPatchFiles || kernelPatchFiles.length === 0) {
    return "nopatch";
  }

  const hash = crypto.createHash("sha256");
  for (const relativePath of [...kernelPatchFiles].sort()) {
    const normalizedPath = String(relativePath).split(path.sep).join(path.posix.sep);
    hash.update(normalizedPath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(patchDir, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function ensurePatchedKernelTarballHashes(globalPatchDir, tarballPath) {
  if (!globalPatchDir || !tarballPath || !fs.existsSync(tarballPath)) {
    return;
  }

  const tarball = path.basename(tarballPath);
  const sha256 = sha256File(tarballPath);
  ensureLiteralHashEntry(
    path.join(globalPatchDir, "linux", "linux.hash"),
    tarball,
    sha256,
    tarballPath
  );
  ensureLiteralHashEntry(
    path.join(globalPatchDir, "linux-headers", "linux-headers.hash"),
    tarball,
    sha256,
    tarballPath
  );
}

function effectiveBuildDirKey(options) {
  if (!options.reuseBuildDir) {
    return null;
  }
  return options.buildDirKey || "default";
}

function walkFiles(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return [];
  }

  const entries = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      entries.push(fullPath);
    }
  }
  return entries.sort();
}

function fileTreeFingerprint(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return null;
  }
  const hash = crypto.createHash("sha256");
  for (const filePath of walkFiles(rootDir)) {
    const relative = path.relative(rootDir, filePath).split(path.sep).join(path.posix.sep);
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function buildrootInputState(options, extras = {}) {
  return {
    buildrootVersion: options.buildrootVersion || null,
    source: options.source || null,
    defconfig: options.defconfig || null,
    configFragment: [...(options.configFragment || [])],
    expectedArtifacts: [...(options.expectedArtifacts || [])],
    makeArgs: [...(options.makeArgs || [])],
    forwarded: [...(options.forwarded || [])],
    patchDirFingerprint: extras.patchDirFingerprint || null,
    kernelPatchFiles: [...(extras.kernelPatchFiles || [])],
    kernelPatchFingerprint: extras.kernelPatchFingerprint || null,
    kernelConfigFragmentContent: extras.kernelConfigFragmentContent || null,
  };
}

function listKernelPatchFiles(patchDir) {
  if (!patchDir) {
    return [];
  }
  const linuxPatchDir = path.join(patchDir, "linux");
  return walkFiles(linuxPatchDir).filter((filePath) => filePath.endsWith(".patch"));
}

function copyPatchTreeWithoutKernelPatches(sourceDir, destinationDir) {
  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.cpSync(sourceDir, destinationDir, {
    recursive: true,
    filter(src) {
      const relative = path.relative(sourceDir, src);
      if (!relative || relative === "") {
        return true;
      }
      const segments = relative.split(path.sep);
      return !(segments[0] === "linux" && src.endsWith(".patch"));
    }
  });
}

function ensurePatchedKernelTarballLocal(options, version, kernelPatchFiles, runDir, logFile, jsonMode) {
  const toolCacheDir = path.join(localToolWorkspace(options.workspace, BUILDROOT_TOOL), "cache");
  const upstreamTarball = path.join(toolCacheDir, `linux-${version}.tar.xz`);
  const stagingDir = path.join(runDir, "kernel-src");
  const patchFingerprint = kernelPatchFingerprint(options.patchDir, kernelPatchFiles);
  const patchedTarball = path.join(runDir, `linux-${version}-patched-${patchFingerprint}.tar.xz`);
  const patchCommands = kernelPatchFiles
    .map((filePath) => `patch -d ${shellQuote(path.join(stagingDir, `linux-${version}`))} -p1 < ${shellQuote(filePath)}`)
    .join("\n");
  const script = `
set -euo pipefail
mkdir -p ${shellQuote(toolCacheDir)}
rm -rf ${shellQuote(stagingDir)}
mkdir -p ${shellQuote(stagingDir)}
if [ ! -f ${shellQuote(upstreamTarball)} ]; then
  curl -fsSL ${shellQuote(buildrootKernelTarballUrl(version))} -o ${shellQuote(upstreamTarball)}
fi
tar -xJf ${shellQuote(upstreamTarball)} -C ${shellQuote(stagingDir)}
${patchCommands}
tar -C ${shellQuote(stagingDir)} -cJf ${shellQuote(patchedTarball)} linux-${version}
`;
  const result = runCommand("bash", ["-lc", script], { env: { ...process.env, ...options.env } });
  appendLog(logFile, result);
  if (!jsonMode) {
    writeStdout(result.stdout);
    process.stderr.write(result.stderr);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "failed to prepare patched kernel tarball");
  }
  return `file://${patchedTarball}`;
}

function buildrootKernelTarballUrl(version) {
  const major = String(version).split(".")[0];
  if (!/^\d+$/.test(major)) {
    throw new Error(`unsupported kernel version format: ${version}`);
  }
  return `https://cdn.kernel.org/pub/linux/kernel/v${major}.x/linux-${version}.tar.xz`;
}

function applyLocalConfigFragment(source, outputDir, fragmentLines, logFile, jsonMode, env) {
  if (!fragmentLines || fragmentLines.length === 0) {
    return { exitCode: 0, stderr: "", stdout: "" };
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.appendFileSync(path.join(outputDir, ".config"), `${fragmentLines.join("\n")}\n`, "utf8");
  const result = runCommand("make", ["-C", source, `O=${outputDir}`, "olddefconfig"], { env });
  appendLog(logFile, result);
  if (!jsonMode) {
    writeStdout(result.stdout);
    process.stderr.write(result.stderr);
  }
  return result;
}

function fetchRemoteArtifacts(options, id, outputDir) {
  if (!options.expectedArtifacts || options.expectedArtifacts.length === 0) {
    return [];
  }

  if (!options.localWorkspace) {
    return options.expectedArtifacts.map((requestedPath) => ({
      path: requestedPath,
      remote_location: path.posix.join(outputDir, requestedPath)
    }));
  }

  const canonicalOutputDir = canonicalLocalBuildrootOutputDir(
    options.localWorkspace,
    effectiveBuildDirKey(options)
  );
  const destination = canonicalOutputDir || localArtifactDir(options.localWorkspace, BUILDROOT_TOOL, id);
  fs.mkdirSync(destination, { recursive: true });

  const sshCommandPrefix = `${shellQuote(sshBinary())} ${sshArgs(options.ssh).map(shellQuote).join(" ")}`;
  const remoteTar = `tar -C ${shellQuote(outputDir)} -cf - ${options.expectedArtifacts.map(shellQuote).join(" ")}`;
  const pipeline = `${sshCommandPrefix} ${shellQuote(sshCommand(remoteTar))} | tar -xf - -C ${shellQuote(destination)}`;
  const result = runCommand("bash", ["-lc", pipeline]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "failed to fetch configured Buildroot artifacts");
  }
  return options.expectedArtifacts.map((requestedPath) => ({
    path: requestedPath,
    remote_location: path.posix.join(outputDir, requestedPath),
    local_location: path.join(destination, requestedPath)
  }));
}

function runLocalBuildroot(options) {
  const id = generateRunId(BUILDROOT_TOOL);
  const runDir = localRunDir(options.workspace, BUILDROOT_TOOL, id);
  const manifest = localManifestPath(options.workspace, BUILDROOT_TOOL, id);
  const logFile = localLogPath(options.workspace, BUILDROOT_TOOL, id);
  const createdAt = nowIso();
  const source = ensureLocalBuildrootSource(options);
  const buildDirKey = effectiveBuildDirKey(options);
  const buildRoot = buildDirKey
    ? localBuildDir(options.workspace, BUILDROOT_TOOL, buildDirKey)
    : runDir;
  const outputDir = path.join(buildRoot, "output");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(logFile, "", "utf8");
  const patchDir = ensureExistingDirectory(options.patchDir, "patch dir");
  ensureKernelHashInPatchDir(patchDir, options.configFragment);
  const kernelPatchFiles = listKernelPatchFiles(patchDir);
  const patchDirFingerprint = fileTreeFingerprint(patchDir);
  const kernelPatchTag = kernelPatchFingerprint(patchDir, kernelPatchFiles);
  const globalPatchDir = patchDir && kernelPatchFiles.length > 0
    ? path.join(buildRoot, "patches-global")
    : patchDir;
  if (patchDir && kernelPatchFiles.length > 0) {
    copyPatchTreeWithoutKernelPatches(patchDir, globalPatchDir);
  }
  const kernelVersion = kernelPatchFiles.length > 0
    ? requireBuildrootCustomKernelVersion(options.configFragment, "kernel patch sync")
    : null;
  const kernelTarballLocation = kernelPatchFiles.length > 0
    ? ensurePatchedKernelTarballLocal(
      options,
      kernelVersion,
      kernelPatchFiles,
      buildRoot,
      logFile,
      options.json
    )
    : null;
  if (kernelTarballLocation && globalPatchDir) {
    ensurePatchedKernelTarballHashes(globalPatchDir, kernelTarballLocation.replace(/^file:\/\//, ""));
  }
  const kernelConfigFragment = globalPatchDir
    ? path.join(globalPatchDir, "linux", "kernel.fragment")
    : null;
  const kernelConfigFragmentContent = readKernelConfigFragment(patchDir);
  const configFragment = effectiveBuildrootConfigFragment(options.configFragment, {
    globalPatchDir,
    kernelTarballLocation,
    kernelConfigFragment: kernelConfigFragment && fs.existsSync(kernelConfigFragment) ? kernelConfigFragment : null
  });
  const makeArgs = localParallelMakeArgs(options.makeArgs);
  const buildStatePath = path.join(buildRoot, ".morpheus-build-state.json");
  const nextInputState = buildrootInputState(options, {
    patchDirFingerprint,
    kernelPatchFiles,
    kernelPatchFingerprint: kernelPatchTag,
    kernelConfigFragmentContent,
  });

  const base = {
    id,
    tool: BUILDROOT_TOOL,
    mode: "local",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    workspace: path.relative(process.cwd(), localWorkspaceRoot(options.workspace)) || ".",
    buildDirKey,
    buildrootVersion: options.buildrootVersion,
    source,
    patchDir,
    defconfig: options.defconfig,
    configFragment: options.configFragment,
    expectedArtifacts: options.expectedArtifacts,
    makeArgs,
    env: options.env,
    forwarded: options.forwarded,
    runDir,
    buildDir: buildRoot,
    outputDir,
    logFile,
    manifest,
    transport: { type: "local" }
  };
  writeJson(manifest, buildCanonicalManifest(base));

  const currentInputState = fs.existsSync(buildStatePath)
    ? readJsonIfExists(buildStatePath, null)
    : null;
  if (
    currentInputState
    && JSON.stringify(currentInputState) === JSON.stringify(nextInputState)
  ) {
    const artifacts = validateAndResolveLocalArtifacts(outputDir, options.expectedArtifacts);
    const finalManifest = buildCanonicalManifest({
      ...base,
      status: "success",
      updatedAt: nowIso(),
      artifacts,
      exitCode: 0,
      warningMessage: "reused existing Buildroot build outputs"
    });
    writeJson(manifest, finalManifest);
    registerRunFromManifest(finalManifest, null);
    return {
      command: "run",
      status: "success",
      exit_code: 0,
      summary: "reused managed Buildroot build outputs",
      details: { id, tool: BUILDROOT_TOOL, mode: "local", workspace: options.workspace, run_dir: runDir, manifest, log_file: logFile, output_dir: outputDir, artifacts },
    };
  }

  let exitCode = 0;
  let errorMessage;
  const env = { ...process.env, ...options.env };

  if (options.defconfig) {
    const defconfig = runCommand("make", ["-C", source, `O=${outputDir}`, options.defconfig], { env });
    appendLog(logFile, defconfig);
    if (!options.json) {
      writeStdout(defconfig.stdout);
      process.stderr.write(defconfig.stderr);
    }
    if (defconfig.exitCode !== 0) {
      exitCode = defconfig.exitCode;
      errorMessage = defconfig.stderr || defconfig.stdout || "Buildroot defconfig failed";
    }
  }

  if (exitCode === 0) {
    const olddefconfig = applyLocalConfigFragment(
      source,
      outputDir,
      configFragment,
      logFile,
      options.json,
      env
    );
    if (olddefconfig.exitCode !== 0) {
      exitCode = olddefconfig.exitCode;
      errorMessage = olddefconfig.stderr || olddefconfig.stdout || "Buildroot olddefconfig failed";
    }
  }

  if (exitCode === 0) {
    const build = runCommand("make", ["-C", source, `O=${outputDir}`, ...makeArgs, ...options.forwarded], { env });
    appendLog(logFile, build);
    if (!options.json) {
      writeStdout(build.stdout);
      process.stderr.write(build.stderr);
    }
    exitCode = build.exitCode;
    if (build.exitCode !== 0) {
      errorMessage = build.stderr || build.stdout || "local Buildroot run failed";
    }
  }

  let artifacts = [];
  if (exitCode === 0) {
    artifacts = validateAndResolveLocalArtifacts(outputDir, options.expectedArtifacts);
  }

  const finalManifest = buildCanonicalManifest({
    ...base,
    status: exitCode === 0 ? "success" : "error",
    updatedAt: nowIso(),
    artifacts,
    exitCode,
    errorMessage
  });
  writeJson(manifest, finalManifest);
  if (exitCode === 0) {
    writeJson(buildStatePath, nextInputState);
  }
  registerRunFromManifest(finalManifest, null);

  return {
    command: "run",
    status: finalManifest.status,
    exit_code: exitCode,
    summary: exitCode === 0 ? "completed managed Buildroot run" : "managed Buildroot run failed",
    details: { id, tool: BUILDROOT_TOOL, mode: "local", workspace: options.workspace, run_dir: runDir, manifest, log_file: logFile, output_dir: outputDir, artifacts },
    error: exitCode === 0 ? undefined : { code: "managed_run_failed", message: errorMessage || "managed run failed" }
  };
}

function buildrootRemoteScript(options, id) {
  const toolRoot = remoteToolWorkspace(options.workspace, BUILDROOT_TOOL);
  const cacheDir = path.posix.join(toolRoot, "cache");
  const srcRoot = path.posix.join(toolRoot, "src");
  const patchDir = options.patchDir
    ? path.posix.join(toolRoot, "patches", id)
    : null;
  const runDir = remoteRunDir(options.workspace, BUILDROOT_TOOL, id, options.localWorkspace);
  const buildDirKey = effectiveBuildDirKey(options);
  const buildRoot = buildDirKey
    ? remoteBuildDir(options.workspace, BUILDROOT_TOOL, buildDirKey)
    : runDir;
  const tarball = options.buildrootVersion
    ? path.posix.join(cacheDir, `buildroot-${options.buildrootVersion}.tar.gz`)
    : null;
  const sourceDir = options.source
    ? path.posix.join(srcRoot, `${id}-source`)
    : path.posix.join(srcRoot, `buildroot-${options.buildrootVersion}`);
  const outputDir = path.posix.join(buildRoot, "output");
  const manifest = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const buildStatePath = path.posix.join(buildRoot, ".morpheus-build-state.json");
  const createdAt = nowIso();
  const makeArgs = remoteParallelMakeArgs(options.makeArgs);
  const kernelPatchFiles = options.kernelPatchFiles || [];
  const kernelVersion = kernelPatchFiles.length > 0
    ? requireBuildrootCustomKernelVersion(options.configFragment, "kernel patch sync")
    : null;
  const kernelPatchTag = kernelPatchFiles.length > 0
    ? kernelPatchFingerprint(options.patchDir, kernelPatchFiles)
    : null;
  const globalPatchDir = patchDir && kernelPatchFiles.length > 0
    ? path.posix.join(buildRoot, "patches-global")
    : patchDir;
  const kernelTarball = kernelPatchFiles.length > 0
    ? path.posix.join(buildRoot, `linux-${kernelVersion}-patched-${kernelPatchTag}.tar.xz`)
    : null;
  const kernelSrcDir = kernelPatchFiles.length > 0
    ? path.posix.join(buildRoot, "kernel-src")
    : null;
  const kernelConfigFragmentContent = options.kernelConfigFragmentContent || null;
  const nextInputState = buildrootInputState(options, {
    patchDirFingerprint: options.patchDirFingerprint || null,
    kernelPatchFiles,
    kernelPatchFingerprint: kernelPatchTag,
    kernelConfigFragmentContent,
  });
  const defconfigCommand = options.defconfig ? `make O=${shellQuote(outputDir)} ${options.defconfig}` : ":";
  const wantsNoopPostImage = (options.configFragment || []).some((line) => /BR2_ROOTFS_POST_IMAGE_SCRIPT\s*=\s*""/.test(String(line)));
  const noopPostImageScript = wantsNoopPostImage
    ? path.posix.join(buildRoot, "morpheus-post-image.sh")
    : null;
  const kernelConfigFragment = globalPatchDir
    ? path.posix.join(globalPatchDir, "linux", "kernel.fragment")
    : null;
  const configFragment = effectiveBuildrootConfigFragment(options.configFragment, {
    globalPatchDir,
    kernelTarballLocation: kernelTarball ? `file://${kernelTarball}` : null,
    kernelConfigFragment
  }).map((line) => {
    if (!wantsNoopPostImage) {
      return line;
    }
    if (/BR2_ROOTFS_POST_IMAGE_SCRIPT\s*=\s*""/.test(String(line))) {
      return `BR2_ROOTFS_POST_IMAGE_SCRIPT="${noopPostImageScript}"`;
    }
    return line;
  });
  const configFragmentCommand = configFragment.length > 0
    ? `cat >> ${shellQuote(path.posix.join(outputDir, ".config"))} <<'CONFIG'
${configFragment.join("\n")}
CONFIG
make O=${shellQuote(outputDir)} olddefconfig`
    : ":";
  const noopPostImageCommand = wantsNoopPostImage
    ? `cat > ${shellQuote(noopPostImageScript)} <<'SH'
#!/bin/sh
exit 0
SH
chmod +x ${shellQuote(noopPostImageScript)}`
    : ":";
  const kernelPatchSetupCommand = kernelPatchFiles.length > 0
    ? `
rm -rf ${shellQuote(globalPatchDir)}
mkdir -p ${shellQuote(globalPatchDir)}
cp -a ${shellQuote(path.posix.join(patchDir, "."))} ${shellQuote(globalPatchDir)}
find ${shellQuote(path.posix.join(globalPatchDir, "linux"))} -type f -name '*.patch' -delete 2>/dev/null || true
${kernelConfigFragmentContent && kernelConfigFragment
      ? `mkdir -p ${shellQuote(path.posix.dirname(kernelConfigFragment))}
cat > ${shellQuote(kernelConfigFragment)} <<'KFRAG'
${String(kernelConfigFragmentContent).replace(/\r?\n$/, "")}
KFRAG`
      : ":"}
rm -rf ${shellQuote(kernelSrcDir)}
mkdir -p ${shellQuote(cacheDir)} ${shellQuote(kernelSrcDir)}
if [ ! -f ${shellQuote(path.posix.join(cacheDir, `linux-${kernelVersion}.tar.xz`))} ]; then
  curl -fsSL ${shellQuote(buildrootKernelTarballUrl(kernelVersion))} -o ${shellQuote(path.posix.join(cacheDir, `linux-${kernelVersion}.tar.xz`))}
fi
tar -xJf ${shellQuote(path.posix.join(cacheDir, `linux-${kernelVersion}.tar.xz`))} -C ${shellQuote(kernelSrcDir)}
${kernelPatchFiles.map((filePath) => `patch -d ${shellQuote(path.posix.join(kernelSrcDir, `linux-${kernelVersion}`))} -p1 < ${shellQuote(path.posix.join(patchDir, filePath))}`).join("\n")}
tar -C ${shellQuote(kernelSrcDir)} -cJf ${shellQuote(kernelTarball)} linux-${kernelVersion}
kernel_sha256=$(sha256sum ${shellQuote(kernelTarball)} | awk '{print $1}')
mkdir -p ${shellQuote(path.posix.join(globalPatchDir, "linux"))} ${shellQuote(path.posix.join(globalPatchDir, "linux-headers"))}
printf '# From %s\nsha256  %s  %s\n' ${shellQuote(kernelTarball)} "$kernel_sha256" ${shellQuote(path.posix.basename(kernelTarball))} >> ${shellQuote(path.posix.join(globalPatchDir, "linux", "linux.hash"))}
printf '# From %s\nsha256  %s  %s\n' ${shellQuote(kernelTarball)} "$kernel_sha256" ${shellQuote(path.posix.basename(kernelTarball))} >> ${shellQuote(path.posix.join(globalPatchDir, "linux-headers", "linux-headers.hash"))}`
    : ":";
  const envPrefix = Object.entries(options.env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  const makeCommand = [
    envPrefix,
    "make",
    `O=${shellQuote(outputDir)}`,
    ...makeArgs.shellArgs,
    ...options.forwarded.map(shellQuote)
  ].filter(Boolean).join(" ");
  const initialManifest = buildCanonicalManifest({
    id,
    tool: BUILDROOT_TOOL,
    mode: "remote",
    status: options.detach ? "submitted" : "running",
    createdAt,
    updatedAt: createdAt,
    workspace: options.workspace,
    buildDirKey,
    buildrootVersion: options.buildrootVersion,
    source: sourceDir,
    patchDir,
    defconfig: options.defconfig,
    configFragment: options.configFragment,
    expectedArtifacts: options.expectedArtifacts,
    makeArgs: makeArgs.manifestArgs,
    env: options.env,
    forwarded: options.forwarded,
    runDir,
    buildDir: buildRoot,
    outputDir,
    logFile,
    manifest,
    transport: { type: "ssh", target: options.ssh }
  });

return `
set -euo pipefail
${makeArgs.shellSetup}
mkdir -p ${shellQuote(cacheDir)} ${shellQuote(srcRoot)} ${shellQuote(runDir)} ${shellQuote(buildRoot)} ${shellQuote(outputDir)}
: > ${shellQuote(logFile)}
cat > ${shellQuote(manifest)} <<'JSON'
${JSON.stringify(initialManifest, null, 2)}
JSON
cat > ${shellQuote(path.posix.join(runDir, "next-build-state.json"))} <<'JSON'
${JSON.stringify(nextInputState, null, 2)}
JSON
python3 - <<'PY'
import json
import os
from pathlib import Path
manifest_path = Path(${shellQuote(manifest)})
state_path = Path(${shellQuote(buildStatePath)})
next_state_path = Path(${shellQuote(path.posix.join(runDir, "next-build-state.json"))})
output_dir = Path(${shellQuote(outputDir)})
manifest = json.loads(manifest_path.read_text())
next_state = json.loads(next_state_path.read_text())
artifacts = manifest.get("expectedArtifacts") or []
if state_path.exists():
    current_state = json.loads(state_path.read_text())
    if current_state == next_state and all((output_dir / relpath).exists() for relpath in artifacts):
        manifest["status"] = "success"
        manifest["exitCode"] = 0
        manifest["updatedAt"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        manifest["warningMessage"] = "reused existing Buildroot build outputs"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\\n")
        raise SystemExit(42)
PY
set +e
{
  set -e
  ${options.source ? ":" : `if [ ! -d ${shellQuote(sourceDir)} ]; then
    if [ ! -f ${shellQuote(tarball)} ]; then
      curl -fsSL ${shellQuote(buildrootTarballUrl(options.buildrootVersion))} -o ${shellQuote(tarball)}
    fi
    tar -xzf ${shellQuote(tarball)} -C ${shellQuote(srcRoot)}
  fi`}
  ${kernelPatchSetupCommand}
  cd ${shellQuote(sourceDir)}
  ${defconfigCommand}
  ${noopPostImageCommand}
  ${configFragmentCommand}
  ${makeCommand}
} 2>&1 | tee -a ${shellQuote(logFile)}
exit_code=\${PIPESTATUS[0]}
set -e
status=success
if [ "\${exit_code}" -ne 0 ]; then
  status=error
fi
export MORPHEUS_STATUS="\${status}"
export MORPHEUS_EXIT_CODE="\${exit_code}"
python3 - <<'PY'
import json
import os
from pathlib import Path
from datetime import datetime, timezone
file = Path(${shellQuote(manifest)})
data = json.loads(file.read_text())
data['status'] = os.environ['MORPHEUS_STATUS']
data['exitCode'] = int(os.environ['MORPHEUS_EXIT_CODE'])
data['updatedAt'] = datetime.now(timezone.utc).isoformat()
if data['status'] == 'error':
    data['errorMessage'] = 'remote Buildroot run failed'
file.write_text(json.dumps(data, indent=2) + '\\n')
PY
if [ "\${exit_code}" -eq 0 ]; then
  cp ${shellQuote(path.posix.join(runDir, "next-build-state.json"))} ${shellQuote(buildStatePath)}
fi
exit "\${exit_code}"
`;
}

async function runRemoteBuildroot(options) {
  const id = generateRunId(BUILDROOT_TOOL);
  const patchDir = ensureExistingDirectory(options.patchDir, "patch dir");
  ensureKernelHashInPatchDir(patchDir, options.configFragment);
  const kernelConfigFragmentContent = readKernelConfigFragment(patchDir);
  const kernelPatchFiles = listKernelPatchFiles(patchDir)
    .map((filePath) => path.relative(patchDir, filePath).split(path.sep).join(path.posix.sep));
  const patchDirFingerprint = fileTreeFingerprint(patchDir);
  const sshCommandPrefix = `${shellQuote(sshBinary())} ${sshArgs(options.ssh).map(shellQuote).join(" ")}`;
  const remoteSourceDir = options.source
    ? path.posix.join(remoteToolWorkspace(options.workspace, BUILDROOT_TOOL), "src", `${id}-source`)
    : null;
  const remotePatchDir = patchDir
    ? path.posix.join(remoteToolWorkspace(options.workspace, BUILDROOT_TOOL), "patches", id)
    : null;
  if (options.source) {
    const sourceRoot = path.resolve(process.cwd(), options.source);
    const parent = path.dirname(sourceRoot);
    const base = path.basename(sourceRoot);
    const destinationParent = path.posix.dirname(remoteSourceDir);
    const remoteScript = `mkdir -p ${shellQuote(destinationParent)} && tar -xf - -C ${shellQuote(destinationParent)} && mv ${shellQuote(path.posix.join(destinationParent, base))} ${shellQuote(remoteSourceDir)}`;
    const pipeline = `tar -C ${shellQuote(parent)} -cf - ${shellQuote(base)} | ${sshCommandPrefix} ${shellQuote(sshCommand(remoteScript))}`;
    runRequiredShell(pipeline, "failed to sync remote Buildroot source");
  }
  if (patchDir) {
    logDebug("remote", "syncing Buildroot patch dir", {
      localPatchDir: patchDir,
      remotePatchDir,
      ssh: options.ssh.original
    });
    const remoteScript = `rm -rf ${shellQuote(remotePatchDir)} && mkdir -p ${shellQuote(remotePatchDir)} && tar -xf - -C ${shellQuote(remotePatchDir)}`;
    const patchPipeline = `tar -C ${shellQuote(patchDir)} -cf - . | ${sshCommandPrefix} ${shellQuote(sshCommand(remoteScript))}`;
    runRequiredShell(patchPipeline, "failed to sync remote Buildroot patch dir");
  }
  const runOptions = {
    ...options,
    kernelPatchFiles,
    patchDirFingerprint,
    kernelConfigFragmentContent,
    patchDir,
    source: remoteSourceDir || options.source
  };
  const script = buildrootRemoteScript(runOptions, id);
  const runDir = remoteRunDir(options.workspace, BUILDROOT_TOOL, id, options.localWorkspace);
  const manifest = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const buildDirKey = effectiveBuildDirKey(options);
  const buildRoot = buildDirKey
    ? remoteBuildDir(options.workspace, BUILDROOT_TOOL, buildDirKey)
    : runDir;
  const outputDir = path.posix.join(buildRoot, "output");
  registerRemoteRunRecord({
    id,
    tool: BUILDROOT_TOOL,
    workspace: options.workspace,
    status: options.detach ? "submitted" : "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest,
    logFile,
    runDir,
    outputDir,
    artifacts: []
  }, options.ssh);

  if (options.detach) {
    const detachedScript = `nohup bash -lc ${shellQuote(script)} > /dev/null 2>&1 < /dev/null & echo $!`;
    const result = runSsh(options.ssh, detachedScript, false);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "failed to submit managed remote run");
    }
    return {
      command: "run",
      status: "submitted",
      exit_code: 0,
      summary: "submitted managed remote Buildroot run",
      details: { id, tool: BUILDROOT_TOOL, mode: "remote", workspace: options.workspace, run_dir: runDir, manifest, log_file: logFile, output_dir: outputDir, pid: Number.parseInt(result.stdout.trim(), 10) }
    };
  }

  const result = options.json
    ? await runSshStreaming(options.ssh, script, {
      onStdoutLine(line) {
        if (line) {
          emitJson({
            command: "run",
            status: "stream",
            exit_code: 0,
            details: { event: "log", id, mode: "remote", line }
          });
        }
      }
    })
    : runSsh(options.ssh, script, true);

  if (result.error) {
    throw new Error(result.error.message || "failed to execute managed remote run");
  }
  if (result.exitCode !== 0 && result.exitCode !== 42) {
    try {
      const tail = runSsh(
        options.ssh,
        `tail -n 200 ${shellQuote(logFile)}`,
        false
      );
      if (tail.exitCode === 0 && tail.stdout) {
        payload.error.details = {
          remote_log_file: logFile,
          log_tail: tail.stdout.trimEnd()
        };
      }
    } catch {
      // Ignore log-tail retrieval failures to preserve the primary exit status.
    }
  }
  const manifestResult = JSON.parse(
    runRequiredSsh(options.ssh, `cat ${shellQuote(manifest)}`, `failed to read remote manifest: ${manifest}`).stdout
  );
  manifestResult.artifacts = fetchRemoteArtifacts(options, id, manifestResult.outputDir);

  const manifestExitCode = typeof manifestResult.exitCode === "number"
    ? manifestResult.exitCode
    : null;
  const manifestStatus = String(manifestResult.status || "").trim().toLowerCase();
  const normalizedExitCode = result.exitCode === 42
    ? 0
    : (manifestExitCode === 0 && manifestStatus === "success")
      ? 0
      : result.exitCode;
  const payload = {
    command: "run",
    status: normalizedExitCode === 0 ? "success" : "error",
    exit_code: normalizedExitCode,
    summary: result.exitCode === 42
      ? "reused managed remote Buildroot build outputs"
      : (normalizedExitCode === 0 ? "completed managed remote Buildroot run" : "managed remote Buildroot run failed"),
    details: { id, tool: BUILDROOT_TOOL, mode: "remote", workspace: options.workspace, run_dir: runDir, manifest, log_file: logFile, output_dir: outputDir },
    error: normalizedExitCode === 0
      ? undefined
      : { code: "managed_run_failed", message: result.stderr || "managed remote run failed" }
  };

  registerRunFromManifest(manifestResult, options.ssh);
  payload.details.artifacts = manifestResult.artifacts;
  return payload;
}

async function runManagedRun(flags, argvCommand = "run") {
  const adapter = requireManagedTool(flags, "run");
  if (adapter.name === MICROKIT_SDK_TOOL) {
    if (flags.mode === "remote") {
      return await runManagedRemoteMicrokitSdk(flags, argvCommand);
    }
    return runManagedMicrokitSdk(flags);
  }
  if (adapter.name === QEMU_TOOL) {
    if (flags.mode === "remote") {
      return await runManagedRemoteQemu(flags, argvCommand);
    }
    return runManagedQemu({ ...flags, __command: argvCommand });
  }
  if (adapter.name === NVIRSH_TOOL) {
    if (flags.mode === "remote") {
      return await runManagedRemoteNvirsh(flags, argvCommand);
    }
    return await runManagedNvirsh(flags);
  }
  if (adapter.name === SEL4_TOOL) {
    if (flags.mode === "remote") {
      return await runManagedRemoteSel4(flags, argvCommand);
    }
    return runManagedSel4(flags);
  }
  if (adapter.name === LIBVMM_TOOL) {
    if (flags.mode === "remote") {
      return await runManagedRemoteLibvmm(flags, argvCommand);
    }
    return runManagedLibvmm(flags);
  }
  if (adapter.name === LLBIC_TOOL) {
    if (flags.mode === "remote") {
      return await runManagedRemoteLlBic(flags, "build");
    }
    return await runManagedLlBic(flags, "build");
  }
  if (adapter.name === LLCG_TOOL) {
    if (argvCommand !== "build") {
      throw new Error("tool run --tool llcg is not supported; use tool build --tool llcg");
    }
    if (flags.mode === "remote") {
      return await runManagedRemoteLlCg(flags, "build");
    }
    return await runManagedLlCg(flags, "build");
  }
  const options = parseBuildrootRunOptions(flags);
  if (options.mode === "local") {
    return runLocalBuildroot(options);
  }
  return await runRemoteBuildroot(options);
}

async function inspectManagedRun(flags) {
  const options = parseExistingRunOptions(flags, "inspect");
  if (!options.workspace) {
    throw new Error(`inspect could not resolve workspace for run: ${options.id}`);
  }
  const manifestPath = options.ssh
    ? remoteManifestPath(options.workspace, options.tool, options.id)
    : (options.record && options.record.manifest
      ? String(options.record.manifest)
      : localManifestPath(options.workspace, options.tool, options.id));
  const manifest = options.ssh
    ? reconcileRemoteManifest(
      JSON.parse(runRequiredSsh(options.ssh, `cat ${shellQuote(manifestPath)}`, `failed to read remote manifest: ${manifestPath}`).stdout),
      options.ssh
    )
    : readJson(manifestPath);
  if ((!manifest.artifacts || manifest.artifacts.length === 0) && manifest.status === "success" && options.ssh) {
    manifest.artifacts = buildRemoteArtifactRecords(manifest);
  }
  if ((!manifest.artifacts || manifest.artifacts.length === 0) && options.record && options.record.artifacts) {
    manifest.artifacts = options.record.artifacts;
  }
  if (options.ssh) {
    registerRunFromManifest(manifest, options.ssh);
  }
  return {
    command: "inspect",
    status: "success",
    exit_code: 0,
    summary: "inspected managed run",
    details: { manifest }
  };
}

async function logsManagedRun(flags) {
  const options = parseExistingRunOptions(flags, "logs");
  if (!options.workspace) {
    throw new Error(`logs could not resolve workspace for run: ${options.id}`);
  }
  const logFile = options.ssh
    ? remoteLogPath(options.workspace, options.tool, options.id)
    : (options.record && options.record.logFile
      ? String(options.record.logFile)
      : localLogPath(options.workspace, options.tool, options.id));
  let output = "";
  if (options.ssh) {
    const command = options.follow ? `tail -n +1 -f ${shellQuote(logFile)}` : `cat ${shellQuote(logFile)}`;
    if (options.json) {
      const result = await runSshStreaming(options.ssh, command, {
        onStdoutLine(line) {
          if (line) {
            emitJson({
              command: "logs",
              status: "stream",
              exit_code: 0,
              details: { event: "log", id: options.id, line }
            });
          }
        }
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `failed to read remote logs: ${logFile}`);
      }
    } else {
      output = runRequiredSsh(options.ssh, command, `failed to read remote logs: ${logFile}`, true).stdout;
    }
  } else {
    output = fs.readFileSync(logFile, "utf8");
    if (!options.json) {
      writeStdout(output);
    }
  }
  if (options.json) {
    for (const line of output.split(/\r?\n/)) {
      if (line) {
        emitJson({ command: "logs", status: "stream", exit_code: 0, details: { event: "log", id: options.id, line } });
      }
    }
  }
  return {
    command: "logs",
    status: "success",
    exit_code: 0,
    summary: "streamed managed run logs",
    details: { id: options.id, tool: options.tool, log_file: logFile, follow: options.follow }
  };
}

function fetchManagedRun(flags) {
  const options = parseExistingRunOptions(flags, "fetch");
  if (!options.workspace) {
    throw new Error(`fetch could not resolve workspace for run: ${options.id}`);
  }
  const destination = path.resolve(process.cwd(), requireFlag(flags, "dest", "fetch requires --dest DIR"));
  const paths = flags.paths || [];
  if (paths.length === 0) {
    throw new Error("fetch requires at least one --path RUN_PATH");
  }
  fs.mkdirSync(destination, { recursive: true });

  if (options.ssh) {
    const remoteBase = remoteRunDir(options.workspace, options.tool, options.id);
    const remotePaths = paths.map((entry) => entry.startsWith("/") ? entry : path.posix.join(remoteBase, entry));
    const remoteScript = `tar -cf - ${remotePaths.map(shellQuote).join(" ")}`;
    const pipeline = `${shellQuote(sshBinary())} ${sshArgs(options.ssh).map(shellQuote).join(" ")} ${shellQuote(sshCommand(remoteScript))} | tar -xf - -C ${shellQuote(destination)}`;
    runRequiredShell(pipeline, "failed to fetch remote paths");
  } else {
    const localBase = options.record && options.record.runDir
      ? String(options.record.runDir)
      : localRunDir(options.workspace, options.tool, options.id);
    const localPaths = paths.map((entry) => path.resolve(localBase, entry));
    const pipeline = `tar -cf - ${localPaths.map(shellQuote).join(" ")} | tar -xf - -C ${shellQuote(destination)}`;
    runRequiredShell(pipeline, "failed to fetch local paths");
  }

  return {
    command: "fetch",
    status: "success",
    exit_code: 0,
    summary: "fetched explicit managed run paths",
    details: { id: options.id, tool: options.tool, dest: destination, paths }
  };
}

function listManagedRunRecords(flags) {
  hydrateManagedRunsFromWorkspace(flags);
  const records = listManagedRuns()
    .filter((record) => normalizeWorkspaceFilter(record, flags.workspace))
    .filter((record) => !flags.ssh || record.ssh === flags.ssh)
    .filter((record) => !flags.tool || record.tool === flags.tool);
  return {
    command: "list",
    status: "success",
    exit_code: 0,
    summary: `listed ${records.length} managed runs`,
    details: {
      runs: records
    }
  };
}

function candidateListContexts(flags) {
  const contexts = [];
  const pushContext = (workspace, ssh) => {
    if (!workspace) {
      return;
    }
    const key = `${ssh || "local"}::${workspace}`;
    if (contexts.some((item) => item.key === key)) {
      return;
    }
    contexts.push({ key, workspace, ssh });
  };

  if (flags.workspace || flags.ssh) {
    pushContext(flags.workspace || null, flags.ssh || null);
  }

  const resolved = applyConfigDefaults({ ...flags }, {
    allowGlobalRemote: true,
    allowToolDefaults: true
  }).flags;
  pushContext(resolved.localWorkspace || resolved.workspace, null);
  if (resolved.ssh && resolved.remoteWorkspace) {
    pushContext(resolved.remoteWorkspace, resolved.ssh);
  } else if (resolved.ssh && resolved.workspace && path.isAbsolute(resolved.workspace)) {
    pushContext(resolved.workspace, resolved.ssh);
  }

  return contexts;
}

function hydrateManagedRunsFromWorkspace(flags) {
  for (const context of candidateListContexts(flags)) {
    if (context.ssh) {
      hydrateRemoteManagedRuns(context.workspace, parseSshTarget(context.ssh));
      continue;
    }
    hydrateLocalManagedRuns(context.workspace);
  }
}

function hydrateLocalManagedRuns(workspace) {
  const workspaceRoot = path.resolve(process.cwd(), workspace);
  const runsRoot = path.join(workspaceRoot, "runs");
  if (!fs.existsSync(runsRoot)) {
    return;
  }
  for (const manifestPath of findManagedManifestFiles(runsRoot)) {
    const manifest = readJson(manifestPath);
    registerRunFromManifest(manifest, null);
  }
}

function hydrateRemoteManagedRuns(workspace, ssh) {
  const script = `
python3 - <<'PY'
import json
from pathlib import Path
root = Path(${shellQuote(workspace)})
items = []
if root.exists():
    runs_root = root / "runs"
    if runs_root.exists():
        for manifest in runs_root.rglob("manifest.json"):
            try:
                items.append(json.loads(manifest.read_text()))
            except Exception:
                pass
print(json.dumps(items))
PY
`;
  const result = runRequiredSsh(ssh, script, "failed to discover remote managed runs");
  const manifests = JSON.parse(result.stdout || "[]");
  for (const manifest of manifests) {
    registerRunFromManifest(manifest, ssh);
  }
}

function removeManagedRunCommand(flags) {
  const options = parseExistingRunOptions(flags, "remove");
  if (!options.workspace) {
    throw new Error(`remove could not resolve workspace for run: ${options.id}`);
  }
  if (options.ssh) {
    const manifest = readRemoteManagedManifest(options);
    const patchPath = remoteEphemeralPatchDir(manifest, options.workspace, options.tool);
    runRequiredSsh(
      options.ssh,
      `rm -rf ${shellQuote(remoteRunDir(options.workspace, options.tool, options.id))}${patchPath ? ` ${shellQuote(patchPath)}` : ""}`,
      "failed to remove remote managed run"
    );
  } else {
    if (options.tool === "nvirsh") {
      stopLocalNvirshRun(options);
    }
    const runDir = options.record && options.record.runDir
      ? String(options.record.runDir)
      : localRunDir(options.workspace, options.tool, options.id);
    fs.rmSync(runDir, {
      recursive: true,
      force: true
    });
  }
  removeManagedRun(options.id);
  return {
    command: "remove",
    status: "success",
    exit_code: 0,
    summary: "removed managed run",
    details: {
      id: options.id,
      tool: options.tool,
      workspace: options.workspace,
      ssh: options.ssh ? options.ssh.original : null
    }
  };
}

function stopLocalNvirshRun(options) {
  if (!options.record || !options.record.manifest) {
    return;
  }
  const candidatePaths = [];
  const recordManifestPath = String(options.record.manifest);
  candidatePaths.push(recordManifestPath);
  if (options.record.runDir) {
    candidatePaths.push(path.join(String(options.record.runDir), "manifest.json"));
  }

  const manifestPath = candidatePaths.find((filePath) => filePath && fs.existsSync(filePath));
  if (!manifestPath) {
    return;
  }

  const manifest = readJson(manifestPath);
  const pid = Number(manifest.pid || 0);
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }

  const ps = runCommand("ps", ["-p", String(pid), "-o", "args="]);
  if (ps.exitCode !== 0) {
    return;
  }
  const args = String(ps.stdout || "").trim();
  const runDir = options.record.runDir ? String(options.record.runDir) : null;
  if (runDir && !args.includes(runDir)) {
    logDebug("runs", "skip stopping nvirsh pid (unexpected command line)", {
      id: options.id,
      pid,
      args
    });
    return;
  }

  logDebug("runs", "stopping local nvirsh run", { id: options.id, pid });
  runCommand("pkill", ["-TERM", "-P", String(pid)]);
  runCommand("kill", ["-TERM", String(pid)]);

  const wait = runCommand("bash", [
    "-lc",
    `for i in $(seq 1 30); do if ! kill -0 ${pid} 2>/dev/null; then exit 0; fi; sleep 0.1; done; exit 1`
  ]);
  if (wait.exitCode === 0) {
    return;
  }
  runCommand("pkill", ["-KILL", "-P", String(pid)]);
  runCommand("kill", ["-KILL", String(pid)]);
}

function runRequiredSsh(target, script, message, streamOutput) {
  const result = runSsh(target, script, Boolean(streamOutput));
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || message);
  }
  return result;
}

function runRequiredShell(command, message) {
  const result = runShell(command);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || message);
  }
  return result;
}

function remoteRepoRoot() {
  const configured = process.env.MORPHEUS_REMOTE_REPO_ROOT || repoRoot();
  return toPosixPath(path.resolve(configured));
}

function remoteMorpheusRuntimeRoot(workspace) {
  return path.posix.join(workspace, ".morpheus", "runtime", "current");
}

function stageLocalMorpheusRuntime() {
  const sourceRoot = path.resolve(repoRoot());
  const stagingParent = path.join(sourceRoot, ".morpheus-sync");
  fs.mkdirSync(stagingParent, { recursive: true });
  const stageRoot = fs.mkdtempSync(path.join(stagingParent, "runtime-"));
  const entries = [
    "apps/morpheus",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
  ];

  for (const relativePath of entries) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    const destinationPath = path.join(stageRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.cpSync(sourcePath, destinationPath, {
      recursive: true,
      filter(entryPath) {
        const base = path.basename(entryPath);
        return base !== ".git" && base !== "node_modules";
      }
    });
  }

  const toolsRoot = path.join(sourceRoot, "tools");
  if (fs.existsSync(toolsRoot)) {
    for (const toolName of fs.readdirSync(toolsRoot)) {
      const toolRoot = path.join(toolsRoot, toolName);
      const descriptorPath = path.join(toolRoot, "tool.json");
      if (!fs.existsSync(descriptorPath) || !fs.statSync(toolRoot).isDirectory()) {
        continue;
      }
      const destinationRoot = path.join(stageRoot, "tools", toolName);
      fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
      fs.cpSync(toolRoot, destinationRoot, {
        recursive: true,
        filter(entryPath) {
          const relative = path.relative(toolRoot, entryPath);
          if (!relative) {
            return true;
          }
          const segments = relative.split(path.sep);
          return !segments.some((segment) => (
            segment === ".git"
            || segment === "node_modules"
            || segment === "downloads"
            || segment === "builds"
            || segment === "out"
            || segment === "test"
            || segment === "src"
            || segment === "docs"
          ));
        }
      });
    }
  }

  return stageRoot;
}

function prepareRemoteMorpheusRuntime(workspace, ssh) {
  const runtimeRoot = remoteMorpheusRuntimeRoot(workspace);
  const localStage = stageLocalMorpheusRuntime();
  try {
    syncLocalDirectoryToRemote(localStage, runtimeRoot, ssh, "morpheus runtime");
  } finally {
    fs.rmSync(localStage, { recursive: true, force: true });
  }

  const script = [
    "set -euo pipefail",
    `cd ${shellQuote(runtimeRoot)}`,
    "if MORPHEUS_PNPM_BIN=\"$(type -P pnpm 2>/dev/null)\" && [ -n \"$MORPHEUS_PNPM_BIN\" ]; then",
    "  \"$MORPHEUS_PNPM_BIN\" install --no-frozen-lockfile",
    "elif MORPHEUS_COREPACK_BIN=\"$(type -P corepack 2>/dev/null)\" && [ -n \"$MORPHEUS_COREPACK_BIN\" ]; then",
    "  \"$MORPHEUS_COREPACK_BIN\" pnpm install --no-frozen-lockfile",
    "else",
    "  echo 'failed to locate pnpm or corepack on remote host' >&2",
    "  exit 1",
    "fi",
    "./node_modules/.bin/tsc -p apps/morpheus/tsconfig.json",
    "mkdir -p bin",
    "cat > bin/morpheus <<'EOF'",
    "#!/usr/bin/env sh",
    "set -eu",
    "exec node \"$(dirname \"$0\")/../apps/morpheus/dist/cli.js\" \"$@\"",
    "EOF",
    "chmod +x bin/morpheus",
  ].join("\n");
  runRequiredSsh(ssh, script, "failed to prepare remote morpheus runtime");
  return runtimeRoot;
}

function syncLocalDirectoryToRemote(localDir, remoteDir, ssh, label) {
  const sourceRoot = path.resolve(process.cwd(), localDir);
  const parent = path.dirname(sourceRoot);
  const base = path.basename(sourceRoot);
  const destinationParent = path.posix.dirname(remoteDir);
  const extractedDir = path.posix.join(destinationParent, base);
  const finalizeMove = extractedDir === remoteDir
    ? "true"
    : `mv ${shellQuote(extractedDir)} ${shellQuote(remoteDir)}`;
  const remoteScript = [
    `rm -rf ${shellQuote(remoteDir)}`,
    `mkdir -p ${shellQuote(destinationParent)}`,
    `tar -xf - -C ${shellQuote(destinationParent)}`,
    finalizeMove,
  ].join(" && ");
  const run = (noSystemConfig) => {
    const pipeline = `tar -C ${shellQuote(parent)} -cf - ${shellQuote(base)} | ${shellQuote(sshBinary())} ${sshArgs(ssh, { noSystemConfig }).map(shellQuote).join(" ")} ${shellQuote(sshCommand(remoteScript))}`;
    return runShell(pipeline);
  };

  let result = run(false);
  if (result.exitCode !== 0 && wantsSshNoConfigRetry(result)) {
    logDebug("remote", "retrying directory sync with -F /dev/null", {
      ssh: ssh.original,
      label,
    });
    result = run(true);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `failed to sync remote ${label}`);
  }
}

function normalizeManagedStatus(payloadStatus, exitCode) {
  const value = String(payloadStatus || "").trim().toLowerCase();
  if (value === "success" || value === "ok") {
    return "success";
  }
  if (value === "running" || value === "submitted") {
    return value;
  }
  if (value === "error" || value === "failed" || value === "fail") {
    return "error";
  }
  return exitCode === 0 ? "success" : "error";
}

function parseLastJsonLine(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to line-oriented recovery.
  }

  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      continue;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(lines.slice(index).join("\n"));
    } catch {
      continue;
    }
  }
  return null;
}

function emitRemoteLogLines(command, id, jsonMode, lines) {
  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (jsonMode) {
      emitJson({
        command,
        status: "stream",
        exit_code: 0,
        details: { event: "log", id, mode: "remote", line }
      });
    } else {
      emitText(line);
    }
  }
}

function emitRemoteLogChunk(command, id, jsonMode, chunk) {
  if (!chunk) {
    return;
  }
  if (jsonMode) {
    emitJson({
      command,
      status: "stream",
      exit_code: 0,
      details: { event: "log", id, mode: "remote", chunk }
    });
    return;
  }
  writeStdout(chunk);
}

function tryParseJsonLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) {
    return null;
  }
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function forwardRemoteManagedOutput(rawLine, options, state) {
  const parsed = tryParseJsonLine(rawLine);
  if (!parsed) {
    emitRemoteLogLines(options.commandLabel, options.id, options.json, [rawLine]);
    return;
  }

  if (
    parsed.status === "stream"
    && parsed.details
    && parsed.details.event === "log"
  ) {
    if (typeof parsed.details.chunk === "string") {
      emitRemoteLogChunk(options.commandLabel, options.id, options.json, parsed.details.chunk);
      return;
    }
    if (typeof parsed.details.line === "string") {
      emitRemoteLogLines(options.commandLabel, options.id, options.json, [parsed.details.line]);
      return;
    }
  }

  state.finalPayload = parsed;
}

function baseRemoteManagedManifest(options) {
  return {
    schemaVersion: 1,
    id: options.id,
    tool: options.tool,
    mode: "remote",
    command: options.subcommand,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    runDir: options.runDir,
    outputDir: options.outputDir,
    logFile: options.logFile,
    manifest: options.manifestPath,
    artifacts: [],
    transport: {
      ssh: options.ssh.original,
    },
    exitCode: null,
  };
}

function writeRemoteJsonFile(ssh, filePath, value, message) {
  runRequiredSsh(
    ssh,
    `mkdir -p ${shellQuote(path.posix.dirname(filePath))} && cat > ${shellQuote(filePath)} <<'JSON'\n${JSON.stringify(value, null, 2)}\nJSON`,
    message,
  );
}

function remoteConfigPath(runDir) {
  return path.posix.join(runDir, "remote-config", "morpheus.yaml");
}

function buildRemoteToolConfig(workspace, tools) {
  return {
    workspace: { root: workspace },
    tools,
  };
}

function mapRemoteManagedArtifacts(payload) {
  const details = payload && payload.details && typeof payload.details === "object"
    ? payload.details
    : {};
  const artifacts = Array.isArray(details.artifacts)
    ? details.artifacts
    : (details.manifest && Array.isArray(details.manifest.artifacts) ? details.manifest.artifacts : []);
  return artifacts
    .map((artifact) => {
      if (!artifact || !artifact.path) {
        return null;
      }
      const location = artifact.location || artifact.local_location || artifact.remote_location || null;
      if (!location) {
        return null;
      }
      return {
        path: artifact.path,
        remote_location: location,
      };
    })
    .filter(Boolean);
}

function syncRemoteInputFile(localPath, remotePath, ssh, label) {
  const source = path.resolve(process.cwd(), localPath);
  const mode = fs.statSync(source).mode & 0o777;
  const remoteScript = [
    `mkdir -p ${shellQuote(path.posix.dirname(remotePath))}`,
    `cat > ${shellQuote(remotePath)}`,
    `chmod ${mode.toString(8)} ${shellQuote(remotePath)}`,
  ].join(" && ");
  const run = (noSystemConfig) => {
    const pipeline = `cat ${shellQuote(source)} | ${shellQuote(sshBinary())} ${sshArgs(ssh, { noSystemConfig }).map(shellQuote).join(" ")} ${shellQuote(sshCommand(remoteScript))}`;
    return runShell(pipeline);
  };

  let result = run(false);
  if (result.exitCode !== 0 && wantsSshNoConfigRetry(result)) {
    result = run(true);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `failed to sync remote ${label}`);
  }
}

function maybeRemotePath(workspace, localWorkspace, localPath) {
  if (!localPath) {
    return null;
  }
  return remoteWorkspacePath(workspace, localWorkspace, localPath);
}

function remoteWorkspaceRelativePath(workspace, targetPath) {
  if (!targetPath) {
    return null;
  }
  const relative = path.posix.relative(workspace, targetPath);
  if (!relative || relative.startsWith("..")) {
    return targetPath;
  }
  return relative;
}

function syncRemoteInputPath(localPath, remotePath, ssh, label) {
  if (!localPath || !remotePath || !fs.existsSync(localPath)) {
    return;
  }
  const stat = fs.statSync(localPath);
  if (stat.isDirectory()) {
    syncLocalDirectoryToRemote(localPath, remotePath, ssh, label);
    return;
  }
  syncRemoteInputFile(localPath, remotePath, ssh, label);
}

function remoteSel4ToolConfig(localOptions, workspace, localWorkspace) {
  return {
    mode: "local",
    path: maybeRemotePath(workspace, localWorkspace, localOptions.path),
    "sel4-version": localOptions.sel4Version || null,
    "archive-url": localOptions.archiveUrl || null,
    "patch-dir": maybeRemotePath(workspace, localWorkspace, localOptions.patchDir),
    "reuse-build-dir": Boolean(localOptions.reuseBuildDir),
    "build-dir-key": localOptions.buildDirKey || null,
  };
}

function remoteMicrokitToolConfig(localOptions, workspace, localWorkspace) {
  return {
    mode: "local",
    path: maybeRemotePath(workspace, localWorkspace, localOptions.path),
    "microkit-version": localOptions.microkitVersion || null,
    "archive-url": localOptions.archiveUrl || null,
    "microkit-archive-url": localOptions.microkitArchiveUrl || null,
    "microkit-dir": maybeRemotePath(workspace, localWorkspace, localOptions.microkitDir),
    "patch-dir": maybeRemotePath(workspace, localWorkspace, localOptions.patchDir),
    boards: localOptions.boards || null,
    configs: localOptions.configs || null,
    "toolchain-dir": maybeRemotePath(workspace, localWorkspace, localOptions.toolchainDir),
    "toolchain-version": localOptions.toolchainVersion || null,
    "toolchain-archive-url": localOptions.toolchainArchiveUrl || null,
    "toolchain-prefix-aarch64": localOptions.toolchainPrefixAarch64 || null,
    "rust-version": localOptions.rustVersion || null,
    "reuse-build-dir": Boolean(localOptions.reuseBuildDir),
    "build-dir-key": localOptions.buildDirKey || null,
  };
}

function remoteLibvmmToolConfig(localOptions, workspace, localWorkspace) {
  return {
    mode: "local",
    source: maybeRemotePath(workspace, localWorkspace, localOptions.source),
    "git-url": localOptions.gitUrl || null,
    "git-ref": localOptions.gitRef || null,
    example: localOptions.example || null,
    board: localOptions.board || null,
    "patch-dir": maybeRemotePath(workspace, localWorkspace, localOptions.patchDir),
    linux: maybeRemotePath(workspace, localWorkspace, localOptions.linux),
    initrd: maybeRemotePath(workspace, localWorkspace, localOptions.initrd),
    "make-args": localOptions.makeArgs || [],
    "reuse-build-dir": Boolean(localOptions.reuseBuildDir),
    "build-dir-key": localOptions.buildDirKey || null,
  };
}

async function executeRemoteManagedToolRun(options) {
  writeRemoteJsonFile(options.ssh, options.manifestPath, baseRemoteManagedManifest(options), `failed to write remote ${options.tool} manifest`);
  if (options.remoteConfig && options.remoteConfigPath) {
    writeRemoteJsonFile(
      options.ssh,
      options.remoteConfigPath,
      options.remoteConfig,
      `failed to write remote ${options.tool} config`
    );
  }

  const preparedRemoteRepoRoot = options.syncMorpheus
    ? prepareRemoteMorpheusRuntime(options.workspace, options.ssh)
    : options.remoteRepoRoot;
  const envLines = Object.entries({
    MORPHEUS_DISABLE_TOOL_WORKFLOW_WRAP: "1",
    ...(options.env || {})
  }).map(([key, value]) => `export ${key}=${shellQuote(value)}`);
  const commandLine = `"$MORPHEUS_REMOTE_CMD" ${options.args.map((value) => shellQuote(value)).join(" ")}`.trim();
  const script = [
    "set -e",
    `remote_repo_root=${shellQuote(preparedRemoteRepoRoot)}`,
    'if [ -x "${remote_repo_root}/bin/morpheus" ]; then',
    '  MORPHEUS_REMOTE_CMD="${remote_repo_root}/bin/morpheus"',
    'elif [ -n "${MORPHEUS_REMOTE_BIN:-}" ]; then',
    '  MORPHEUS_REMOTE_CMD="$MORPHEUS_REMOTE_BIN"',
    "elif command -v morpheus >/dev/null 2>&1; then",
    '  MORPHEUS_REMOTE_CMD="$(command -v morpheus)"',
    "else",
    '  echo "failed to locate remote morpheus executable" >&2',
    "  exit 1",
    "fi",
    ...(options.remoteConfigPath ? [`cd ${shellQuote(path.posix.dirname(options.remoteConfigPath))}`] : []),
    `mkdir -p ${shellQuote(options.runDir)}`,
    `: > ${shellQuote(options.logFile)}`,
    "stdout_capture=$(mktemp)",
    "trap 'rm -f \"$stdout_capture\"' EXIT",
    ...envLines,
    "set +e",
    `(${commandLine}) > >(tee \"$stdout_capture\") 2> >(tee -a ${shellQuote(options.logFile)} >&2)`,
    "exit_code=$?",
    "exit \"${exit_code}\"",
  ].join("\n");

  const state = { finalPayload: null };
  const streamResult = await runSshStreaming(options.ssh, script, {
    collectStdout: true,
    onStdoutLine(line) {
      forwardRemoteManagedOutput(line, options, state);
    },
    onStderrLine(line) {
      forwardRemoteManagedOutput(line, options, state);
    },
  });
  if (streamResult.error) {
    throw new Error(streamResult.error.message || `failed to execute managed remote ${options.tool} run`);
  }

  const payload = state.finalPayload || parseLastJsonLine(streamResult.stdout || "");
  if (!payload || typeof payload !== "object") {
    throw new Error(streamResult.stderr || streamResult.stdout || `${options.tool} did not return a JSON payload`);
  }

  const sourceLogFile = payload
    && payload.details
    && typeof payload.details.log_file === "string"
    ? payload.details.log_file
    : null;
  if (sourceLogFile && sourceLogFile !== options.logFile) {
    try {
      runRequiredSsh(
        options.ssh,
        `mkdir -p ${shellQuote(path.posix.dirname(options.logFile))} && cp ${shellQuote(sourceLogFile)} ${shellQuote(options.logFile)}`,
        `failed to copy remote ${options.tool} log`
      );
    } catch {
      // Preserve the primary run result if the log copy fails.
    }
  }

  const artifacts = options.artifactResolver(payload, options);
  const manifest = {
    ...baseRemoteManagedManifest(options),
    status: normalizeManagedStatus(payload.status, streamResult.exitCode),
    updatedAt: nowIso(),
    artifacts,
    details: payload,
    exitCode: typeof payload.exit_code === "number" ? payload.exit_code : streamResult.exitCode,
    errorMessage: streamResult.exitCode === 0
      ? null
      : (payload.summary || streamResult.stderr || `managed remote ${options.tool} run failed`),
  };
  if (!manifest.errorMessage) {
    delete manifest.errorMessage;
  }
  writeRemoteJsonFile(options.ssh, options.manifestPath, manifest, `failed to update remote ${options.tool} manifest`);
  registerRunFromManifest(manifest, options.ssh);

  return {
    command: options.commandLabel,
    status: manifest.status,
    exit_code: manifest.status === "success" ? 0 : manifest.exitCode,
    summary: payload.summary || `${options.subcommand} managed remote ${options.tool} run`,
    details: options.resultDetails(payload, artifacts, options),
    error: manifest.status === "success"
      ? undefined
      : { code: "managed_run_failed", message: manifest.errorMessage || `managed remote ${options.tool} run failed` },
  };
}

async function runManagedRemoteMicrokitSdk(flags, argvCommand = "build") {
  const localOptions = parseManagedMicrokitSdkOptions({ ...flags, mode: "local" });
  const workspace = localOptions.workspace;
  const localWorkspace = flags.localWorkspace || workspace;
  const ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
  const id = localOptions.id;
  const runDir = remoteRunDir(workspace, MICROKIT_SDK_TOOL, id, localWorkspace);
  const manifestPath = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const outputDir = maybeRemotePath(workspace, localWorkspace, localOptions.path) || runDir;
  const remoteConfig = buildRemoteToolConfig(workspace, {
    [SEL4_TOOL]: remoteSel4ToolConfig(parseManagedSel4Options({ workspace: localWorkspace, mode: "local" }), workspace, localWorkspace),
    [MICROKIT_SDK_TOOL]: remoteMicrokitToolConfig(localOptions, workspace, localWorkspace),
  });
  const configPath = remoteConfigPath(runDir);

  registerManagedWorkspace({ mode: "remote", root: workspace, ssh: ssh.original });
  registerRemoteRunRecord({
    id,
    tool: MICROKIT_SDK_TOOL,
    workspace,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest: manifestPath,
    logFile,
    runDir,
    outputDir,
    artifacts: [],
  }, ssh);

  syncRemoteInputPath(localOptions.path, maybeRemotePath(workspace, localWorkspace, localOptions.path), ssh, "microkit-sdk directory");
  syncRemoteInputPath(localOptions.microkitDir, maybeRemotePath(workspace, localWorkspace, localOptions.microkitDir), ssh, "microkit source directory");
  syncRemoteInputPath(localOptions.patchDir, maybeRemotePath(workspace, localWorkspace, localOptions.patchDir), ssh, "microkit patch directory");
  syncRemoteInputPath(localOptions.toolchainDir, maybeRemotePath(workspace, localWorkspace, localOptions.toolchainDir), ssh, "microkit toolchain directory");
  const sel4Options = parseManagedSel4Options({ workspace: localWorkspace, mode: "local" });
  syncRemoteInputPath(sel4Options.path, maybeRemotePath(workspace, localWorkspace, sel4Options.path), ssh, "sel4 source directory");
  syncRemoteInputPath(sel4Options.patchDir, maybeRemotePath(workspace, localWorkspace, sel4Options.patchDir), ssh, "sel4 patch directory");

  return await executeRemoteManagedToolRun({
    id,
    tool: MICROKIT_SDK_TOOL,
    workspace,
    ssh,
    json: Boolean(flags.json),
    subcommand: localOptions.provisioning === "path" ? "inspect" : "build",
    commandLabel: argvCommand,
    runDir,
    manifestPath,
    logFile,
    outputDir,
    remoteRepoRoot: remoteRepoRoot(),
    syncMorpheus: Boolean(flags["sync-morpheus"]),
    remoteConfig,
    remoteConfigPath: configPath,
    args: [
      "tool",
      "build",
      "--tool",
      MICROKIT_SDK_TOOL,
      "--mode",
      "local",
      "--workspace",
      workspace,
      "--json",
    ],
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
    },
    artifactResolver(payload) {
      return mapRemoteManagedArtifacts(payload);
    },
    resultDetails(payload, artifacts) {
      return {
        id,
        tool: MICROKIT_SDK_TOOL,
        mode: "remote",
        workspace,
        run_dir: runDir,
        managed_manifest: manifestPath,
        log_file: logFile,
        output_dir: outputDir,
        artifacts,
        payload,
      };
    },
  });
}

async function runManagedRemoteSel4(flags, argvCommand = "build") {
  const localOptions = parseManagedSel4Options({ ...flags, mode: "local" });
  const workspace = localOptions.workspace;
  const localWorkspace = flags.localWorkspace || workspace;
  const ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
  const id = localOptions.id;
  const runDir = remoteRunDir(workspace, SEL4_TOOL, id, localWorkspace);
  const manifestPath = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const outputDir = maybeRemotePath(workspace, localWorkspace, localOptions.path) || runDir;
  const remoteConfig = buildRemoteToolConfig(workspace, {
    [SEL4_TOOL]: remoteSel4ToolConfig(localOptions, workspace, localWorkspace),
  });
  const configPath = remoteConfigPath(runDir);

  registerManagedWorkspace({ mode: "remote", root: workspace, ssh: ssh.original });
  registerRemoteRunRecord({
    id,
    tool: SEL4_TOOL,
    workspace,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest: manifestPath,
    logFile,
    runDir,
    outputDir,
    artifacts: [],
  }, ssh);

  syncRemoteInputPath(localOptions.path, maybeRemotePath(workspace, localWorkspace, localOptions.path), ssh, "sel4 source directory");
  syncRemoteInputPath(localOptions.patchDir, maybeRemotePath(workspace, localWorkspace, localOptions.patchDir), ssh, "sel4 patch directory");

  return await executeRemoteManagedToolRun({
    id,
    tool: SEL4_TOOL,
    workspace,
    ssh,
    json: Boolean(flags.json),
    subcommand: localOptions.provisioning === "path" ? "inspect" : "build",
    commandLabel: argvCommand,
    runDir,
    manifestPath,
    logFile,
    outputDir,
    remoteRepoRoot: remoteRepoRoot(),
    syncMorpheus: Boolean(flags["sync-morpheus"]),
    remoteConfig,
    remoteConfigPath: configPath,
    args: [
      "tool",
      "build",
      "--tool",
      SEL4_TOOL,
      "--mode",
      "local",
      "--workspace",
      workspace,
      "--json",
    ],
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
    },
    artifactResolver(payload) {
      return mapRemoteManagedArtifacts(payload);
    },
    resultDetails(payload, artifacts) {
      return {
        id,
        tool: SEL4_TOOL,
        mode: "remote",
        workspace,
        run_dir: runDir,
        managed_manifest: manifestPath,
        log_file: logFile,
        output_dir: outputDir,
        artifacts,
        payload,
      };
    },
  });
}

async function runManagedRemoteLibvmm(flags, argvCommand = "build") {
  const localOptions = parseManagedLibvmmOptions({ ...flags, mode: "local" });
  const sel4Options = parseManagedSel4Options({ workspace: localOptions.workspace, mode: "local" });
  const microkitOptions = parseManagedMicrokitSdkOptions({ workspace: localOptions.workspace, mode: "local" });
  const workspace = localOptions.workspace;
  const localWorkspace = flags.localWorkspace || workspace;
  const ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
  const id = localOptions.id;
  const runDir = remoteRunDir(workspace, LIBVMM_TOOL, id, localWorkspace);
  const manifestPath = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const outputDir = maybeRemotePath(workspace, localWorkspace, localOptions.source) || runDir;
  const remoteConfig = buildRemoteToolConfig(workspace, {
    [SEL4_TOOL]: remoteSel4ToolConfig(sel4Options, workspace, localWorkspace),
    [MICROKIT_SDK_TOOL]: remoteMicrokitToolConfig(microkitOptions, workspace, localWorkspace),
    [LIBVMM_TOOL]: remoteLibvmmToolConfig(localOptions, workspace, localWorkspace),
  });
  const configPath = remoteConfigPath(runDir);

  registerManagedWorkspace({ mode: "remote", root: workspace, ssh: ssh.original });
  registerRemoteRunRecord({
    id,
    tool: LIBVMM_TOOL,
    workspace,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest: manifestPath,
    logFile,
    runDir,
    outputDir,
    artifacts: [],
  }, ssh);

  syncRemoteInputPath(localOptions.source, maybeRemotePath(workspace, localWorkspace, localOptions.source), ssh, "libvmm source directory");
  syncRemoteInputPath(localOptions.patchDir, maybeRemotePath(workspace, localWorkspace, localOptions.patchDir), ssh, "libvmm patch directory");
  syncRemoteInputPath(localOptions.linux, maybeRemotePath(workspace, localWorkspace, localOptions.linux), ssh, "libvmm linux image");
  syncRemoteInputPath(localOptions.initrd, maybeRemotePath(workspace, localWorkspace, localOptions.initrd), ssh, "libvmm initrd");
  syncRemoteInputPath(microkitOptions.path, maybeRemotePath(workspace, localWorkspace, microkitOptions.path), ssh, "microkit-sdk directory");
  syncRemoteInputPath(microkitOptions.microkitDir, maybeRemotePath(workspace, localWorkspace, microkitOptions.microkitDir), ssh, "microkit source directory");
  syncRemoteInputPath(microkitOptions.patchDir, maybeRemotePath(workspace, localWorkspace, microkitOptions.patchDir), ssh, "microkit patch directory");
  syncRemoteInputPath(microkitOptions.toolchainDir, maybeRemotePath(workspace, localWorkspace, microkitOptions.toolchainDir), ssh, "microkit toolchain directory");
  syncRemoteInputPath(sel4Options.path, maybeRemotePath(workspace, localWorkspace, sel4Options.path), ssh, "sel4 source directory");
  syncRemoteInputPath(sel4Options.patchDir, maybeRemotePath(workspace, localWorkspace, sel4Options.patchDir), ssh, "sel4 patch directory");

  return await executeRemoteManagedToolRun({
    id,
    tool: LIBVMM_TOOL,
    workspace,
    ssh,
    json: Boolean(flags.json),
    subcommand: "build",
    commandLabel: argvCommand,
    runDir,
    manifestPath,
    logFile,
    outputDir,
    remoteRepoRoot: remoteRepoRoot(),
    syncMorpheus: Boolean(flags["sync-morpheus"]),
    remoteConfig,
    remoteConfigPath: configPath,
    args: [
      "tool",
      "build",
      "--tool",
      LIBVMM_TOOL,
      "--mode",
      "local",
      "--workspace",
      workspace,
      "--json",
    ],
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
    },
    artifactResolver(payload) {
      return mapRemoteManagedArtifacts(payload);
    },
    resultDetails(payload, artifacts) {
      return {
        id,
        tool: LIBVMM_TOOL,
        mode: "remote",
        workspace,
        run_dir: runDir,
        managed_manifest: manifestPath,
        log_file: logFile,
        output_dir: outputDir,
        artifacts,
        payload,
      };
    },
  });
}

async function runManagedRemoteNvirsh(flags, argvCommand = "run") {
  if (flags.attach) {
    throw new Error("nvirsh remote mode does not support --attach");
  }
  const localOptions = parseManagedNvirshOptions({ ...flags, mode: "local" });
  const workspace = localOptions.workspace;
  const localWorkspace = flags.localWorkspace || workspace;
  const ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
  const id = localOptions.id;
  const runDir = remoteRunDir(workspace, NVIRSH_TOOL, id, localWorkspace);
  const manifestPath = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const outputDir = runDir;

  registerManagedWorkspace({ mode: "remote", root: workspace, ssh: ssh.original });
  registerRemoteRunRecord({
    id,
    tool: NVIRSH_TOOL,
    workspace,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest: manifestPath,
    logFile,
    runDir,
    outputDir,
    artifacts: [],
  }, ssh);

  const pathKeys = [
    ["qemu", localOptions.qemu],
    ["microkit-sdk", localOptions.microkitSdk],
    ["toolchain", localOptions.toolchain],
    ["libvmm-dir", localOptions.libvmmDir],
    ["runtime-contract", localOptions.runtimeContract],
    ["kernel", localOptions.kernel],
    ["initrd", localOptions.initrd],
  ];
  for (const [label, value] of pathKeys) {
    syncRemoteInputPath(value, maybeRemotePath(workspace, localWorkspace, value), ssh, `${NVIRSH_TOOL} ${label}`);
  }

  return await executeRemoteManagedToolRun({
    id,
    tool: NVIRSH_TOOL,
    workspace,
    ssh,
    json: Boolean(flags.json),
    subcommand: argvCommand,
    commandLabel: argvCommand,
    runDir,
    manifestPath,
    logFile,
    outputDir,
    remoteRepoRoot: remoteRepoRoot(),
    syncMorpheus: Boolean(flags["sync-morpheus"]),
    args: [
      "tool",
      argvCommand === "build" ? "build" : "run",
      "--tool",
      NVIRSH_TOOL,
      "--mode",
      "local",
      "--workspace",
      workspace,
      "--target",
      localOptions.target,
      "--name",
      localOptions.name,
      "--qemu",
      maybeRemotePath(workspace, localWorkspace, localOptions.qemu),
      "--microkit-sdk",
      maybeRemotePath(workspace, localWorkspace, localOptions.microkitSdk),
      "--toolchain",
      maybeRemotePath(workspace, localWorkspace, localOptions.toolchain),
      "--libvmm-dir",
      maybeRemotePath(workspace, localWorkspace, localOptions.libvmmDir),
      "--runtime-contract",
      maybeRemotePath(workspace, localWorkspace, localOptions.runtimeContract),
      "--kernel",
      maybeRemotePath(workspace, localWorkspace, localOptions.kernel),
      "--initrd",
      maybeRemotePath(workspace, localWorkspace, localOptions.initrd),
      ...(localOptions.microkitVersion ? ["--microkit-version", localOptions.microkitVersion] : []),
      ...(localOptions.microkitConfig ? ["--microkit-config", localOptions.microkitConfig] : []),
      ...(localOptions.board ? ["--board", localOptions.board] : []),
      ...(argvCommand === "build" ? ["--build-only"] : []),
      ...(localOptions.qemuArgs || []).flatMap((value) => ["--qemu-arg", value]),
      "--json",
    ],
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
    },
    artifactResolver(payload) {
      return mapRemoteManagedArtifacts(payload);
    },
    resultDetails(payload, artifacts) {
      return {
        id,
        tool: NVIRSH_TOOL,
        mode: "remote",
        workspace,
        run_dir: runDir,
        managed_manifest: manifestPath,
        log_file: logFile,
        output_dir: outputDir,
        artifacts,
        payload,
      };
    },
  });
}

async function runManagedRemoteLlBic(flags, argvCommand = "build") {
  const parsed = parseManagedLlBicOptions(flags, argvCommand);
  const workspace = parsed.workspace;
  const ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
  const id = parsed.id;
  const localWorkspace = flags.localWorkspace || parsed.workspace;
  const runDir = remoteRunDir(workspace, LLBIC_TOOL, id, flags.localWorkspace);
  const manifestPath = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const remoteSourcesRoot = remoteWorkspacePath(workspace, localWorkspace, parsed.sourcesRoot);
  const remoteBuildsRoot = remoteWorkspacePath(workspace, localWorkspace, parsed.buildsRoot);
  const remoteConfPath = remoteWorkspacePath(workspace, localWorkspace, parsed.confPath);
  const remoteSourcesArg = remoteWorkspaceRelativePath(workspace, remoteSourcesRoot);
  const remoteBuildsArg = remoteWorkspaceRelativePath(workspace, remoteBuildsRoot);
  const remoteConfArg = remoteWorkspaceRelativePath(workspace, remoteConfPath);
  registerManagedWorkspace({ mode: "remote", root: workspace, ssh: ssh.original });
  registerRemoteRunRecord({
    id,
    tool: LLBIC_TOOL,
    workspace,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest: manifestPath,
    logFile,
    runDir,
    outputDir: remoteBuildsRoot,
    artifacts: [],
  }, ssh);

  return await executeRemoteManagedToolRun({
    id,
    tool: LLBIC_TOOL,
    workspace,
    ssh,
    json: Boolean(flags.json),
    subcommand: parsed.subcommand,
    commandLabel: argvCommand,
    runDir,
    manifestPath,
    logFile,
    outputDir: remoteBuildsRoot,
    remoteRepoRoot: remoteRepoRoot(),
    syncMorpheus: Boolean(flags["sync-morpheus"]),
    args: [
      "tool",
      "build",
      "--tool",
      LLBIC_TOOL,
      "--mode",
      "local",
      "--workspace",
      workspace,
      "--sources",
      remoteSourcesArg,
      "--output",
      remoteBuildsArg,
      "--conf",
      remoteConfArg,
      ...parsed.args,
    ],
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
    },
    artifactResolver(payload) {
      return buildArtifacts(payload, remoteBuildsRoot).map((artifact) => ({
        path: artifact.path,
        location: artifact.location,
      }));
    },
    resultDetails(payload, artifacts, current) {
      return {
        id: current.id,
        tool: LLBIC_TOOL,
        mode: "remote",
        workspace,
        run_dir: runDir,
        manifest: artifacts.find((item) => item.path === "llbic-json")?.location || null,
        managed_manifest: manifestPath,
        log_file: logFile,
        output_dir: artifacts.find((item) => item.path === "output-dir")?.location || remoteBuildsRoot,
        source_dir: artifacts.find((item) => item.path === "source-dir")?.location || null,
        bitcode_list: artifacts.find((item) => item.path === "bitcode-files")?.location || null,
        artifacts,
        payload,
      };
    },
  });
}

function loadQemuRemoteConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools.qemu ? value.tools.qemu : {};
  return {
    baseDir: configDir(config.path),
    value: {
      ...item,
      qemuVersion: item["qemu-version"] || item.qemuVersion || null,
      archiveUrl: item["archive-url"] || item.archiveUrl || null,
      buildDirKey: item["build-dir-key"] || item.buildDirKey || null,
      targetList: Array.isArray(item["target-list"])
        ? [...item["target-list"]]
        : Array.isArray(item.targetList)
          ? [...item.targetList]
          : [],
      configureArgs: Array.isArray(item["configure-arg"])
        ? [...item["configure-arg"]]
        : Array.isArray(item["configure-args"])
          ? [...item["configure-args"]]
          : Array.isArray(item.configureArgs)
            ? [...item.configureArgs]
            : [],
    }
  };
}

function preferredRepeatableRemoteFlag(flags, key, fallback) {
  if (Array.isArray(flags[key])) {
    return flags[key].length > 0 ? [...flags[key]] : [...fallback];
  }
  return flags[key] || [...fallback];
}

function resolveManagedQemuRemoteOptions(flags) {
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("run requires --workspace DIR or a workspace root in morpheus.yaml");
  }

  const { baseDir, value } = loadQemuRemoteConfig();
  const managed = readManagedToolContract(QEMU_TOOL);
  if (!managed || !managed.local) {
    throw new Error("missing managed contract for qemu");
  }

  const buildDirKey = flags["build-dir-key"] || value.buildDirKey || "default";
  const localWorkspace = flags.localWorkspace || null;
  const executable = flags.path
    ? path.resolve(process.cwd(), flags.path)
    : resolveLocalPath(baseDir, value.path || value.executable);
  const qemuVersion = flags["qemu-version"] || value.qemuVersion || null;
  let source = flags.source
    ? path.resolve(process.cwd(), flags.source)
    : resolveLocalPath(baseDir, value.source);
  if (!source && qemuVersion && localWorkspace) {
    source = path.join(
      localWorkspace,
      renderManagedTemplate(managed.local.sourceTemplate, { qemuVersion })
    );
  }

  const provisioning = executable ? "path" : "build";
  if (provisioning === "build" && !qemuVersion && !flags["archive-url"] && !value.archiveUrl && !source) {
    throw new Error("qemu build requires tools.qemu.qemu-version, tools.qemu.archive-url, or tools.qemu.source");
  }

  return {
    id: generateRunId(QEMU_TOOL),
    workspace,
    localWorkspace,
    provisioning,
    executable,
    source,
    qemuVersion,
    archiveUrl: flags["archive-url"] || value.archiveUrl || null,
    buildDirKey,
    targetList: preferredRepeatableRemoteFlag(flags, "target-list", value.targetList || []),
    configureArgs: preferredRepeatableRemoteFlag(flags, "configure-arg", value.configureArgs || []),
    contract: managed.local,
  };
}

async function runManagedRemoteQemu(flags, argvCommand = "build") {
  if (argvCommand === "run") {
    throw new Error("qemu remote runtime is not supported; use --mode local for qemu run");
  }
  const options = resolveManagedQemuRemoteOptions(flags);
  const ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
  const id = options.id;
  const runDir = remoteRunDir(options.workspace, QEMU_TOOL, id, options.localWorkspace);
  const manifestPath = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const remoteSource = options.source
    ? remoteWorkspacePath(options.workspace, options.localWorkspace, options.source)
    : (options.qemuVersion
      ? path.posix.join(
        options.workspace,
        renderManagedTemplate(options.contract.sourceTemplate, { qemuVersion: options.qemuVersion })
      )
      : null);
  const remoteBuildDir = path.posix.join(
    options.workspace,
    renderManagedTemplate(options.contract.buildDirTemplate, { buildDirKey: options.buildDirKey })
  );
  const remoteInstallDir = path.posix.join(
    options.workspace,
    renderManagedTemplate(options.contract.installDirTemplate, { buildDirKey: options.buildDirKey })
  );
  const remoteExecutable = options.executable
    ? remoteWorkspacePath(options.workspace, options.localWorkspace, options.executable)
    : path.posix.join(remoteInstallDir, "bin", options.contract.artifactPath);
  const outputDir = options.provisioning === "path"
    ? path.posix.dirname(remoteExecutable)
    : remoteInstallDir;

  registerManagedWorkspace({ mode: "remote", root: options.workspace, ssh: ssh.original });
  registerRemoteRunRecord({
    id,
    tool: QEMU_TOOL,
    workspace: options.workspace,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest: manifestPath,
    logFile,
    runDir,
    outputDir,
    artifacts: [],
  }, ssh);

  if (options.provisioning === "path" && options.executable && fs.existsSync(options.executable)) {
    syncLocalDirectoryToRemote(
      path.dirname(options.executable),
      path.posix.dirname(remoteExecutable),
      ssh,
      "qemu executable directory",
    );
  }
  if (options.provisioning === "build" && options.source && fs.existsSync(options.source)) {
    syncLocalDirectoryToRemote(options.source, remoteSource, ssh, "qemu source directory");
  }

  return await executeRemoteManagedToolRun({
    id,
    tool: QEMU_TOOL,
    workspace: options.workspace,
    ssh,
    json: Boolean(flags.json),
    subcommand: options.provisioning === "path" ? "inspect" : "build",
    commandLabel: argvCommand,
    runDir,
    manifestPath,
    logFile,
    outputDir,
    remoteRepoRoot: remoteRepoRoot(),
    syncMorpheus: Boolean(flags["sync-morpheus"]),
    args: [
      "tool",
      "build",
      "--tool",
      QEMU_TOOL,
      "--mode",
      "local",
      "--workspace",
      options.workspace,
      ...(options.provisioning === "path"
        ? ["--path", remoteExecutable]
        : [
            "--source",
            remoteSource,
            ...(options.qemuVersion ? ["--qemu-version", options.qemuVersion] : []),
            ...(options.archiveUrl ? ["--archive-url", options.archiveUrl] : []),
            "--build-dir-key",
            options.buildDirKey,
            ...(options.targetList || []).flatMap((item) => ["--target-list", item]),
            ...(options.configureArgs || []).flatMap((item) => ["--configure-arg", item]),
          ]),
      "--json",
    ],
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
    },
    artifactResolver(payload) {
      return [
        {
          path: options.contract.artifactPath,
          remote_location: remoteExecutable,
        }
      ];
    },
    resultDetails(payload, artifacts, current) {
      return {
        id: current.id,
        tool: QEMU_TOOL,
        mode: "remote",
        provisioning: options.provisioning,
        workspace: options.workspace,
        run_dir: runDir,
        managed_manifest: manifestPath,
        log_file: logFile,
        output_dir: outputDir,
        source: remoteSource,
        build_dir: options.provisioning === "build" ? remoteBuildDir : null,
        install_dir: options.provisioning === "build" ? remoteInstallDir : null,
        artifacts,
        payload,
      };
    },
  });
}

async function runManagedRemoteLlCg(flags, argvCommand = "build") {
  const parsed = parseManagedLlCgOptions(flags);
  const workspace = parsed.workspace;
  const ssh = parseSshTarget(requireFlag(flags, "ssh", "remote mode requires --ssh TARGET"));
  const id = parsed.id;
  const runDir = remoteRunDir(workspace, LLCG_TOOL, id, flags.localWorkspace);
  const manifestPath = path.posix.join(runDir, "manifest.json");
  const logFile = path.posix.join(runDir, "stdout.log");
  const outputDir = (flags.output || parsed.reuseBuildDir)
    ? remoteWorkspacePath(workspace, flags.localWorkspace, parsed.outputDir)
    : path.posix.join(runDir, "output");
  const pathFlags = new Set([
    "--output",
    "-o",
    "--source-dir",
    "--llbic-json",
    "--all-bc-list",
    "--bitcode-list",
    "--filter",
    "--file",
  ]);
  const args = [];
  for (let index = 0; index < parsed.args.length; index += 1) {
    const token = parsed.args[index];
    args.push(token);
    if (pathFlags.has(token) && index + 1 < parsed.args.length) {
      index += 1;
      const remoteValue = remoteWorkspacePath(workspace, flags.localWorkspace, parsed.args[index]);
      if (token === "--output" || token === "-o") {
        args.push(remoteWorkspaceRelativePath(workspace, remoteValue));
        continue;
      }
      args.push(remoteValue);
    }
  }
  registerManagedWorkspace({ mode: "remote", root: workspace, ssh: ssh.original });
  registerRemoteRunRecord({
    id,
    tool: LLCG_TOOL,
    workspace,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    manifest: manifestPath,
    logFile,
    runDir,
    outputDir,
    artifacts: [],
  }, ssh);

  return await executeRemoteManagedToolRun({
    id,
    tool: LLCG_TOOL,
    workspace,
    ssh,
    json: Boolean(flags.json),
    subcommand: parsed.subcommand,
    commandLabel: argvCommand,
    runDir,
    manifestPath,
    logFile,
    outputDir,
    remoteRepoRoot: remoteRepoRoot(),
    syncMorpheus: Boolean(flags["sync-morpheus"]),
    args: [
      "tool",
      "build",
      "--tool",
      LLCG_TOOL,
      "--mode",
      "local",
      "--workspace",
      workspace,
      ...(parsed.reuseBuildDir ? ["--reuse-build-dir", "--build-dir-key", parsed.buildDirKey] : []),
      ...args,
    ],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      key === "PATH" || key === "HOME" || key === "USER" || key.startsWith("KERNEL_CALLGRAPH_"),
    )),
    artifactResolver(payload) {
      return resolvePayloadArtifacts(payload).map((artifact) => ({
        path: artifact.path,
        location: artifact.location,
      }));
    },
    resultDetails(payload, artifacts, current) {
      return {
        id: current.id,
        tool: LLCG_TOOL,
        mode: "remote",
        workspace,
        run_dir: runDir,
        manifest: artifacts.find((item) => item.path === "manifest")?.location || null,
        managed_manifest: manifestPath,
        log_file: logFile,
        output_dir: artifacts.find((item) => item.path === "output-dir")?.location || outputDir,
        artifacts,
        payload,
      };
    },
  });
}

function readRemoteManagedManifest(options) {
  if (!options.record || !options.record.manifest || !options.ssh) {
    return null;
  }
  try {
    const result = runRequiredSsh(
      options.ssh,
      `cat ${shellQuote(options.record.manifest)}`,
      "failed to read remote managed manifest"
    );
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function remoteEphemeralPatchDir(manifest, workspace, tool) {
  if (!manifest || manifest.mode !== "remote" || !manifest.patchDir) {
    return null;
  }
  const patchesRoot = `${remoteToolWorkspace(workspace, tool)}/patches/`;
  if (!String(manifest.patchDir).startsWith(patchesRoot)) {
    return null;
  }
  return manifest.patchDir;
}

function printManagedResult(result, flags) {
  if (flags.json) {
    emitJson(result);
    return;
  }
  if (result.details && result.details.manifest) {
    emitText(`id: ${result.details.manifest.id}`);
    emitText(`status: ${result.details.manifest.status}`);
    return;
  }
  if (result.details && result.details.id) {
    emitText(`id: ${result.details.id}`);
  }
  emitText(result.summary || result.status);
}

async function handleManagedRunCommand(command, argv) {
  if (!command || command === "help" || command === "--help") {
    writeStdoutLine(managedRunUsage());
    return 0;
  }

  const parsedFlags = parseRunArgs(argv);
  const { flags } = applyConfigDefaults(parsedFlags, {
    allowGlobalRemote: (command === "run" || command === "build") && parsedFlags.mode !== "local",
    allowToolDefaults: command === "run" || command === "build"
  });
  const existingRunCommand = ["inspect", "logs", "fetch", "remove"].includes(command);
  if (existingRunCommand) {
    if (!Object.prototype.hasOwnProperty.call(parsedFlags, "workspace")) {
      delete flags.workspace;
    }
    if (!Object.prototype.hasOwnProperty.call(parsedFlags, "ssh")) {
      delete flags.ssh;
    }
    if (!Object.prototype.hasOwnProperty.call(parsedFlags, "remote")) {
      delete flags.remote;
      delete flags.remoteTarget;
      delete flags.remoteWorkspace;
    }
  }
  if (command === "list") {
    if (!Object.prototype.hasOwnProperty.call(parsedFlags, "workspace")) {
      delete flags.workspace;
    }
    if (!Object.prototype.hasOwnProperty.call(parsedFlags, "ssh")) {
      delete flags.ssh;
    }
  }
  if (flags.help) {
    writeStdoutLine(managedRunUsage());
    return 0;
  }
  let result;
  if (command === "run" || command === "build") {
    result = await runManagedRun(flags, command);
  } else if (command === "list") {
    result = listManagedRunRecords(flags);
  } else if (command === "inspect") {
    result = await inspectManagedRun(flags);
  } else if (command === "logs") {
    result = await logsManagedRun(flags);
  } else if (command === "fetch") {
    result = fetchManagedRun(flags);
  } else if (command === "remove") {
    result = removeManagedRunCommand(flags);
  } else {
    throw new Error(`unknown managed run command: ${command}`);
  }

  printManagedResult(result, flags);
  return result.exit_code || 0;
}

module.exports = {
  handleManagedRunCommand,
  managedRunUsage,
  parseRunArgs,
  parseSshTarget,
  effectiveBuildrootConfigFragment,
  effectiveBuildDirKey,
  kernelPatchFingerprint,
  listKernelPatchFiles,
  copyPatchTreeWithoutKernelPatches,
  ensurePatchedKernelTarballHashes,
  localRunDir,
  localManifestPath,
  localLogPath,
  remoteRunDir,
  remoteManifestPath,
  remoteLogPath
};
