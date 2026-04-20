// @ts-nocheck
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  registerManagedRun,
  readManagedRun,
  removeManagedRun,
  listManagedRuns
} = require("./managed-state");
const { applyConfigDefaults } = require("./config");

const BUILDROOT_TOOL = "buildroot";
const MANAGED_TOOL_ADAPTERS = {
  [BUILDROOT_TOOL]: {
    name: BUILDROOT_TOOL,
    modes: ["local", "remote"]
  }
};

function parseRunArgs(argv) {
  const flags = {};
  const repeatable = {
    env: [],
    "make-arg": [],
    path: [],
    artifact: [],
    "config-fragment": []
  };
  const booleanFlags = new Set(["json", "detach", "follow", "verbose"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      flags.forwarded = argv.slice(index + 1);
      break;
    }
    if (!token.startsWith("--")) {
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
    paths: repeatable.path,
    forwarded: flags.forwarded || []
  };
}

function managedRunUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js tool run --tool buildroot --mode local --workspace DIR (--source DIR | --buildroot-version VER) [--defconfig NAME] [--json]",
    "  node apps/morpheus/dist/cli.js tool run --tool buildroot --mode remote --ssh TARGET --workspace DIR (--source DIR | --buildroot-version VER) [--defconfig NAME] [--detach] [--json]",
    "  node apps/morpheus/dist/cli.js tool runs [--workspace DIR] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool inspect --id RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js tool logs --id RUN_ID [--follow] [--json]",
    "  node apps/morpheus/dist/cli.js tool fetch --id RUN_ID --dest DIR --path RUN_PATH [--path RUN_GLOB ...] [--json]",
    "  node apps/morpheus/dist/cli.js tool remove --id RUN_ID [--json]"
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

function sshArgs(target) {
  const args = [];
  if (target.port !== undefined) {
    args.push("-p", String(target.port));
  }
  args.push(sshDestination(target));
  return args;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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
  return path.join(localToolWorkspace(workspace, tool), "runs", id);
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

function remoteRunDir(workspace, tool, id) {
  return path.posix.join(remoteToolWorkspace(workspace, tool), "runs", id);
}

function remoteManifestPath(workspace, tool, id) {
  return path.posix.join(remoteRunDir(workspace, tool, id), "manifest.json");
}

function remoteLogPath(workspace, tool, id) {
  return path.posix.join(remoteRunDir(workspace, tool, id), "stdout.log");
}

function runSsh(target, script, streamOutput) {
  const result = spawnSync("ssh", [...sshArgs(target), "bash", "-lc", script], {
    encoding: "utf8",
    stdio: streamOutput ? ["ignore", "inherit", "pipe"] : ["ignore", "pipe", "pipe"]
  });
  return normalizeSpawnResult(result);
}

function runSshStreaming(target, script, handlers) {
  return new Promise((resolve) => {
    const child = spawn("ssh", [...sshArgs(target), "bash", "-lc", script], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";

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
      resolve({
        stdout,
        stderr,
        exitCode: code == null ? 1 : code,
        error: null
      });
    });
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
  return runCommand("bash", ["-lc", command]);
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
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function emitText(value) {
  process.stdout.write(`${value}\n`);
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
  const tool = requireFlag(flags, "tool", `${command} requires --tool buildroot`);
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

  if (!fs.existsSync(tarball)) {
    const download = runCommand("curl", ["-fsSL", buildrootTarballUrl(version), "-o", tarball]);
    if (download.exitCode !== 0) {
      throw new Error(download.stderr || `failed to download Buildroot ${version}`);
    }
  }

  if (!fs.existsSync(sourceDir)) {
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

  return options;
}

function parseExistingRunOptions(flags, command) {
  const tool = flags.tool || BUILDROOT_TOOL;
  resolveManagedTool(tool);
  const id = requireFlag(flags, "id", `${command} requires --id RUN_ID`);
  const record = readManagedRun(id);
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
    buildrootVersion: base.buildrootVersion || null,
    source: base.source || null,
    defconfig: base.defconfig || null,
    configFragment: base.configFragment || [],
    expectedArtifacts: base.expectedArtifacts || [],
    artifacts: base.artifacts || [],
    makeArgs: base.makeArgs || [],
    env: base.env || {},
    forwarded: base.forwarded || [],
    runDir: base.runDir,
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
  return path.join(localToolWorkspace(workspace, tool), "runs", id, "artifacts");
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

function applyLocalConfigFragment(source, outputDir, fragmentLines, logFile, jsonMode, env) {
  if (!fragmentLines || fragmentLines.length === 0) {
    return { exitCode: 0, stderr: "", stdout: "" };
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.appendFileSync(path.join(outputDir, ".config"), `${fragmentLines.join("\n")}\n`, "utf8");
  const result = runCommand("make", ["-C", source, `O=${outputDir}`, "olddefconfig"], { env });
  appendLog(logFile, result);
  if (!jsonMode) {
    process.stdout.write(result.stdout);
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

  const destination = localArtifactDir(options.localWorkspace, BUILDROOT_TOOL, id);
  fs.mkdirSync(destination, { recursive: true });
  const archiveBase64 = runRequiredSsh(
    options.ssh,
    `
python3 - <<'PY'
import base64
import io
import os
import tarfile
paths = ${JSON.stringify(options.expectedArtifacts)}
root = ${JSON.stringify(outputDir)}
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode="w") as archive:
    for relpath in paths:
        fullpath = os.path.join(root, relpath)
        if not os.path.exists(fullpath):
            raise SystemExit(f"missing artifact: {relpath}")
        archive.add(fullpath, arcname=relpath)
print(base64.b64encode(buffer.getvalue()).decode("ascii"))
PY
`,
    "failed to fetch configured Buildroot artifacts"
  ).stdout.trim();
  const archivePath = path.join(destination, "artifacts.tar");
  fs.writeFileSync(archivePath, Buffer.from(archiveBase64, "base64"));
  const extract = runCommand("tar", ["-xf", archivePath, "-C", destination]);
  fs.rmSync(archivePath, { force: true });
  if (extract.exitCode !== 0) {
    throw new Error(extract.stderr || "failed to extract configured Buildroot artifacts");
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
  const outputDir = path.join(runDir, "output");
  const manifest = localManifestPath(options.workspace, BUILDROOT_TOOL, id);
  const logFile = localLogPath(options.workspace, BUILDROOT_TOOL, id);
  const createdAt = nowIso();
  const source = ensureLocalBuildrootSource(options);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(logFile, "", "utf8");
  const makeArgs = localParallelMakeArgs(options.makeArgs);

  const base = {
    id,
    tool: BUILDROOT_TOOL,
    mode: "local",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    workspace: path.relative(process.cwd(), localWorkspaceRoot(options.workspace)) || ".",
    buildrootVersion: options.buildrootVersion,
    source,
    defconfig: options.defconfig,
    configFragment: options.configFragment,
    expectedArtifacts: options.expectedArtifacts,
    makeArgs,
    env: options.env,
    forwarded: options.forwarded,
    runDir,
    outputDir,
    logFile,
    manifest,
    transport: { type: "local" }
  };
  writeJson(manifest, buildCanonicalManifest(base));

  let exitCode = 0;
  let errorMessage;
  const env = { ...process.env, ...options.env };

  if (options.defconfig) {
    const defconfig = runCommand("make", ["-C", source, `O=${outputDir}`, options.defconfig], { env });
    appendLog(logFile, defconfig);
    if (!options.json) {
      process.stdout.write(defconfig.stdout);
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
      options.configFragment,
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
      process.stdout.write(build.stdout);
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
  const runDir = remoteRunDir(options.workspace, BUILDROOT_TOOL, id);
  const tarball = options.buildrootVersion
    ? path.posix.join(cacheDir, `buildroot-${options.buildrootVersion}.tar.gz`)
    : null;
  const sourceDir = options.source
    ? path.posix.join(srcRoot, `${id}-source`)
    : path.posix.join(srcRoot, `buildroot-${options.buildrootVersion}`);
  const outputDir = path.posix.join(runDir, "output");
  const manifest = remoteManifestPath(options.workspace, BUILDROOT_TOOL, id);
  const logFile = remoteLogPath(options.workspace, BUILDROOT_TOOL, id);
  const createdAt = nowIso();
  const makeArgs = remoteParallelMakeArgs(options.makeArgs);
  const defconfigCommand = options.defconfig ? `make O=${shellQuote(outputDir)} ${options.defconfig}` : ":";
  const configFragmentCommand = options.configFragment.length > 0
    ? `cat >> ${shellQuote(path.posix.join(outputDir, ".config"))} <<'CONFIG'
${options.configFragment.join("\n")}
CONFIG
make O=${shellQuote(outputDir)} olddefconfig`
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
    buildrootVersion: options.buildrootVersion,
    source: sourceDir,
    defconfig: options.defconfig,
    configFragment: options.configFragment,
    expectedArtifacts: options.expectedArtifacts,
    makeArgs: makeArgs.manifestArgs,
    env: options.env,
    forwarded: options.forwarded,
    runDir,
    outputDir,
    logFile,
    manifest,
    transport: { type: "ssh", target: options.ssh }
  });

return `
set -euo pipefail
${makeArgs.shellSetup}
mkdir -p ${shellQuote(cacheDir)} ${shellQuote(srcRoot)} ${shellQuote(runDir)} ${shellQuote(outputDir)}
: > ${shellQuote(logFile)}
${options.source ? ":" : `if [ ! -f ${shellQuote(tarball)} ]; then
  curl -fsSL ${shellQuote(buildrootTarballUrl(options.buildrootVersion))} -o ${shellQuote(tarball)}
fi
if [ ! -d ${shellQuote(sourceDir)} ]; then
  tar -xzf ${shellQuote(tarball)} -C ${shellQuote(srcRoot)}
fi`}
cat > ${shellQuote(manifest)} <<'JSON'
${JSON.stringify(initialManifest, null, 2)}
JSON
cd ${shellQuote(sourceDir)}
set +e
{
  ${defconfigCommand}
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
exit "\${exit_code}"
`;
}

async function runRemoteBuildroot(options) {
  const id = generateRunId(BUILDROOT_TOOL);
  const remoteSourceDir = options.source
    ? path.posix.join(remoteToolWorkspace(options.workspace, BUILDROOT_TOOL), "src", `${id}-source`)
    : null;
  if (options.source) {
    const sourceRoot = path.resolve(process.cwd(), options.source);
    const parent = path.dirname(sourceRoot);
    const base = path.basename(sourceRoot);
    const destinationParent = path.posix.dirname(remoteSourceDir);
    const pipeline = `tar -C ${shellQuote(parent)} -cf - ${shellQuote(base)} | ssh ${sshArgs(options.ssh).map(shellQuote).join(" ")} bash -lc ${shellQuote(`mkdir -p ${shellQuote(destinationParent)} && tar -xf - -C ${shellQuote(destinationParent)} && mv ${shellQuote(path.posix.join(destinationParent, base))} ${shellQuote(remoteSourceDir)}`)}`;
    runRequiredShell(pipeline, "failed to sync remote Buildroot source");
  }
  const runOptions = {
    ...options,
    source: remoteSourceDir || options.source
  };
  const script = buildrootRemoteScript(runOptions, id);
  const manifest = remoteManifestPath(options.workspace, BUILDROOT_TOOL, id);
  const runDir = remoteRunDir(options.workspace, BUILDROOT_TOOL, id);
  const logFile = remoteLogPath(options.workspace, BUILDROOT_TOOL, id);
  const outputDir = path.posix.join(runDir, "output");

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
  const payload = {
    command: "run",
    status: result.exitCode === 0 ? "success" : "error",
    exit_code: result.exitCode,
    summary: result.exitCode === 0 ? "completed managed remote Buildroot run" : "managed remote Buildroot run failed",
    details: { id, tool: BUILDROOT_TOOL, mode: "remote", workspace: options.workspace, run_dir: runDir, manifest, log_file: logFile, output_dir: outputDir },
    error: result.exitCode === 0 ? undefined : { code: "managed_run_failed", message: result.stderr || "managed remote run failed" }
  };
  const manifestResult = JSON.parse(
    runRequiredSsh(options.ssh, `cat ${shellQuote(manifest)}`, `failed to read remote manifest: ${manifest}`).stdout
  );
  manifestResult.artifacts = fetchRemoteArtifacts(options, id, manifestResult.outputDir);
  registerRunFromManifest(manifestResult, options.ssh);
  payload.details.artifacts = manifestResult.artifacts;
  return payload;
}

async function runManagedRun(flags) {
  const options = parseBuildrootRunOptions(flags);
  if (options.mode === "local") {
    return runLocalBuildroot(options);
  }
  return await runRemoteBuildroot(options);
}

function inspectManagedRun(flags) {
  const options = parseExistingRunOptions(flags, "inspect");
  if (!options.workspace) {
    throw new Error(`inspect could not resolve workspace for run: ${options.id}`);
  }
  const manifestPath = options.ssh
    ? remoteManifestPath(options.workspace, options.tool, options.id)
    : localManifestPath(options.workspace, options.tool, options.id);
  const manifest = options.ssh
    ? JSON.parse(runRequiredSsh(options.ssh, `cat ${shellQuote(manifestPath)}`, `failed to read remote manifest: ${manifestPath}`).stdout)
    : readJson(manifestPath);
  if ((!manifest.artifacts || manifest.artifacts.length === 0) && options.record && options.record.artifacts) {
    manifest.artifacts = options.record.artifacts;
  }
  return {
    command: "inspect",
    status: "success",
    exit_code: 0,
    summary: "inspected managed run",
    details: { manifest }
  };
}

function logsManagedRun(flags) {
  const options = parseExistingRunOptions(flags, "logs");
  if (!options.workspace) {
    throw new Error(`logs could not resolve workspace for run: ${options.id}`);
  }
  const logFile = options.ssh
    ? remoteLogPath(options.workspace, options.tool, options.id)
    : localLogPath(options.workspace, options.tool, options.id);
  let output = "";
  if (options.ssh) {
    const command = options.follow ? `tail -n +1 -f ${shellQuote(logFile)}` : `cat ${shellQuote(logFile)}`;
    output = runRequiredSsh(options.ssh, command, `failed to read remote logs: ${logFile}`, !options.json).stdout;
  } else {
    output = fs.readFileSync(logFile, "utf8");
    if (!options.json) {
      process.stdout.write(output);
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
    const pipeline = `ssh ${sshArgs(options.ssh).map(shellQuote).join(" ")} bash -lc ${shellQuote(`tar -cf - ${remotePaths.map(shellQuote).join(" ")}`)} | tar -xf - -C ${shellQuote(destination)}`;
    runRequiredShell(pipeline, "failed to fetch remote paths");
  } else {
    const localBase = localRunDir(options.workspace, options.tool, options.id);
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

function removeManagedRunCommand(flags) {
  const options = parseExistingRunOptions(flags, "remove");
  if (!options.workspace) {
    throw new Error(`remove could not resolve workspace for run: ${options.id}`);
  }
  if (options.ssh) {
    runRequiredSsh(
      options.ssh,
      `rm -rf ${shellQuote(remoteRunDir(options.workspace, options.tool, options.id))}`,
      "failed to remove remote managed run"
    );
  } else {
    fs.rmSync(localRunDir(options.workspace, options.tool, options.id), {
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
    process.stdout.write(`${managedRunUsage()}\n`);
    return 0;
  }

  const parsedFlags = parseRunArgs(argv);
  const { flags } = applyConfigDefaults(parsedFlags, {
    allowGlobalRemote: command === "run" && parsedFlags.mode !== "local",
    allowToolDefaults: command === "run"
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
  if (flags.help) {
    process.stdout.write(`${managedRunUsage()}\n`);
    return 0;
  }
  let result;
  if (command === "run") {
    result = await runManagedRun(flags);
  } else if (command === "list") {
    result = listManagedRunRecords(flags);
  } else if (command === "inspect") {
    result = inspectManagedRun(flags);
  } else if (command === "logs") {
    result = logsManagedRun(flags);
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
  localRunDir,
  localManifestPath,
  localLogPath,
  remoteRunDir,
  remoteManifestPath,
  remoteLogPath
};
