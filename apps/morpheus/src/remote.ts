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
const { runManagedMicrokitSdk } = require("./microkit-sdk");
const { runManagedNvirsh } = require("./nvirsh");
const { runManagedQemu } = require("./qemu");
const { runManagedSel4 } = require("./sel4");
const { applyConfigDefaults, resolveLocalPath } = require("./config");
const { logDebug } = require("./logger");
const { writeStdout, writeStdoutLine } = require("./io");

const BUILDROOT_TOOL = "buildroot";
const MICROKIT_SDK_TOOL = "microkit-sdk";
const QEMU_TOOL = "qemu";
const NVIRSH_TOOL = "nvirsh";
const SEL4_TOOL = "sel4";
const MANAGED_TOOL_ADAPTERS = {
  [BUILDROOT_TOOL]: {
    name: BUILDROOT_TOOL,
    modes: ["local", "remote"]
  },
  [MICROKIT_SDK_TOOL]: {
    name: MICROKIT_SDK_TOOL,
    modes: ["local"]
  },
  [QEMU_TOOL]: {
    name: QEMU_TOOL,
    modes: ["local"]
  },
  [NVIRSH_TOOL]: {
    name: NVIRSH_TOOL,
    modes: ["local"]
  },
  [SEL4_TOOL]: {
    name: SEL4_TOOL,
    modes: ["local"]
  }
};

function parseRunArgs(argv) {
  const flags = {};
  const repeatable = {
    env: [],
    "make-arg": [],
    "qemu-arg": [],
    "configure-arg": [],
    "target-list": [],
    path: [],
    artifact: [],
    "config-fragment": []
  };
  const booleanFlags = new Set(["json", "detach", "follow", "verbose", "reuse-build-dir"]);

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
    "qemu-arg": repeatable["qemu-arg"],
    "configure-arg": repeatable["configure-arg"],
    "target-list": repeatable["target-list"],
    paths: repeatable.path,
    forwarded: flags.forwarded || []
  };
}

function managedRunUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js tool build --tool buildroot --mode local --workspace DIR (--source DIR | --buildroot-version VER) [--defconfig NAME] [--patch-dir DIR] [--reuse-build-dir] [--build-dir-key KEY] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool buildroot --mode remote --ssh TARGET --workspace DIR (--source DIR | --buildroot-version VER) [--defconfig NAME] [--patch-dir DIR] [--reuse-build-dir] [--build-dir-key KEY] [--detach] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool microkit-sdk --mode local --workspace DIR (--path PATH | --microkit-version VER) [--archive-url URL] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool qemu --mode local --workspace DIR (--path PATH | --qemu-version VER) [--archive-url URL] [--build-dir-key KEY] [--target-list NAME ...] [--configure-arg ARG ...] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool nvirsh --mode local --workspace DIR [--target sel4] [--json]",
    "  node apps/morpheus/dist/cli.js tool build --tool sel4 --mode local --workspace DIR (--path PATH | --sel4-version VER) [--archive-url URL] [--git-url URL] [--git-ref REF] [--json]",
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

function sshArgs(target) {
  const args = [];
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
  return path.join(localToolWorkspace(workspace, tool), "runs", id);
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

function remoteRunDir(workspace, tool, id) {
  return path.posix.join(remoteToolWorkspace(workspace, tool), "runs", id);
}

function remoteBuildDir(workspace, tool, key) {
  return path.posix.join(remoteToolWorkspace(workspace, tool), "builds", key);
}

function remoteManifestPath(workspace, tool, id) {
  return path.posix.join(remoteRunDir(workspace, tool, id), "manifest.json");
}

function remoteLogPath(workspace, tool, id) {
  return path.posix.join(remoteRunDir(workspace, tool, id), "stdout.log");
}

function runSsh(target, script, streamOutput) {
  const result = spawnSync(sshBinary(), [...sshArgs(target), sshCommand(script)], {
    encoding: "utf8",
    stdio: streamOutput ? ["ignore", "inherit", "pipe"] : ["ignore", "pipe", "pipe"]
  });
  return normalizeSpawnResult(result);
}

function runSshStreaming(target, script, handlers) {
  return new Promise((resolve) => {
    const child = spawn(sshBinary(), [...sshArgs(target), sshCommand(script)], {
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
  const tool = requireFlag(flags, "tool", `${command} requires --tool buildroot|microkit-sdk|qemu|nvirsh|sel4`);
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

function hasGlobalPatchDirConfig(fragmentLines) {
  return (fragmentLines || []).some((line) => /^BR2_GLOBAL_PATCH_DIR=/.test(String(line)));
}

function filterBuildrootConfigLines(fragmentLines, predicate) {
  return (fragmentLines || []).filter((line) => !predicate(String(line).trim()));
}

function effectiveBuildrootConfigFragment(fragmentLines, options = {}) {
  const {
    globalPatchDir = null,
    kernelTarballLocation = null
  } = options;

  const effective = [...(fragmentLines || [])];
  let next = effective;

  if (kernelTarballLocation) {
    next = filterBuildrootConfigLines(next, (line) => /^BR2_LINUX_KERNEL_CUSTOM_/.test(line));
    next.push("BR2_LINUX_KERNEL_CUSTOM_TARBALL=y");
    next.push(`BR2_LINUX_KERNEL_CUSTOM_TARBALL_LOCATION=${JSON.stringify(kernelTarballLocation)}`);
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
  const configFragment = effectiveBuildrootConfigFragment(options.configFragment, {
    globalPatchDir,
    kernelTarballLocation
  });
  const makeArgs = localParallelMakeArgs(options.makeArgs);

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
  const runDir = remoteRunDir(options.workspace, BUILDROOT_TOOL, id);
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
  const manifest = remoteManifestPath(options.workspace, BUILDROOT_TOOL, id);
  const logFile = remoteLogPath(options.workspace, BUILDROOT_TOOL, id);
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
  const defconfigCommand = options.defconfig ? `make O=${shellQuote(outputDir)} ${options.defconfig}` : ":";
  const configFragment = effectiveBuildrootConfigFragment(options.configFragment, {
    globalPatchDir,
    kernelTarballLocation: kernelTarball ? `file://${kernelTarball}` : null
  });
  const configFragmentCommand = configFragment.length > 0
    ? `cat >> ${shellQuote(path.posix.join(outputDir, ".config"))} <<'CONFIG'
${configFragment.join("\n")}
CONFIG
make O=${shellQuote(outputDir)} olddefconfig`
    : ":";
  const kernelPatchSetupCommand = kernelPatchFiles.length > 0
    ? `
rm -rf ${shellQuote(globalPatchDir)}
mkdir -p ${shellQuote(globalPatchDir)}
cp -a ${shellQuote(path.posix.join(patchDir, "."))} ${shellQuote(globalPatchDir)}
find ${shellQuote(path.posix.join(globalPatchDir, "linux"))} -type f -name '*.patch' -delete 2>/dev/null || true
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
  const patchDir = ensureExistingDirectory(options.patchDir, "patch dir");
  ensureKernelHashInPatchDir(patchDir, options.configFragment);
  const kernelPatchFiles = listKernelPatchFiles(patchDir)
    .map((filePath) => path.relative(patchDir, filePath).split(path.sep).join(path.posix.sep));
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
    patchDir,
    source: remoteSourceDir || options.source
  };
  const script = buildrootRemoteScript(runOptions, id);
  const manifest = remoteManifestPath(options.workspace, BUILDROOT_TOOL, id);
  const runDir = remoteRunDir(options.workspace, BUILDROOT_TOOL, id);
  const logFile = remoteLogPath(options.workspace, BUILDROOT_TOOL, id);
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
  const adapter = requireManagedTool(flags, "run");
  if (adapter.name === MICROKIT_SDK_TOOL) {
    return runManagedMicrokitSdk(flags);
  }
  if (adapter.name === QEMU_TOOL) {
    return runManagedQemu(flags);
  }
  if (adapter.name === NVIRSH_TOOL) {
    return await runManagedNvirsh(flags);
  }
  if (adapter.name === SEL4_TOOL) {
    return runManagedSel4(flags);
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
    : localManifestPath(options.workspace, options.tool, options.id);
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
    : localLogPath(options.workspace, options.tool, options.id);
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
  const runsRoot = path.join(path.resolve(process.cwd(), workspace), "tools");
  if (!fs.existsSync(runsRoot)) {
    return;
  }
  const manifests = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const toolRunsRoot = path.join(runsRoot, entry.name, "runs");
      if (!fs.existsSync(toolRunsRoot)) {
        return [];
      }
      return fs.readdirSync(toolRunsRoot, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => path.join(toolRunsRoot, item.name, "manifest.json"))
        .filter((filePath) => fs.existsSync(filePath));
    });
  for (const manifestPath of manifests) {
    const manifest = readJson(manifestPath);
    registerRunFromManifest(manifest, null);
  }
}

function hydrateRemoteManagedRuns(workspace, ssh) {
  const script = `
python3 - <<'PY'
import json
from pathlib import Path
root = Path(${shellQuote(path.posix.join(workspace, "tools"))})
items = []
if root.exists():
    for manifest in root.glob("*/runs/*/manifest.json"):
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
  if (command === "run") {
    result = await runManagedRun(flags);
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
