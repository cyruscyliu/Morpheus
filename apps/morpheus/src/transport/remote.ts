// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { repoRoot } = require("../core/paths");
const { logDebug } = require("../core/logger");

function toPosixPath(value) {
  return String(value).split(path.sep).join(path.posix.sep);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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

  const match = String(input || "").match(/^(?:(.+)@)?([^:]+)(?::(\d+))?$/);
  if (!match) {
    throw new Error(`invalid SSH target: ${input}`);
  }
  return {
    original: input,
    user: match[1] || undefined,
    host: match[2],
    port: match[3] ? Number(match[3]) : undefined
  };
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

function normalizeSpawnResult(result) {
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status == null ? 1 : result.status,
    error: result.error || null
  };
}

function sshBinary() {
  return process.env.MORPHEUS_SSH_BIN || "ssh";
}

function sshArgs(target, options = {}) {
  const args = [];
  if (options.noSystemConfig) {
    args.push("-F", "/dev/null");
  }
  if (target.port) {
    args.push("-p", String(target.port));
  }
  args.push(target.user ? `${target.user}@${target.host}` : target.host);
  return args;
}

function sshCommand(script) {
  return `bash -lc ${shellQuote(script)}`;
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

function runRequiredSsh(target, script, message, streamOutput) {
  const result = runSsh(target, script, Boolean(streamOutput));
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || message);
  }
  return result;
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

function remoteRepoRoot() {
  const configured = process.env.MORPHEUS_REMOTE_REPO_ROOT || repoRoot();
  return toPosixPath(path.resolve(configured));
}

function remoteMorpheusRuntimeRoot(workspace) {
  return path.posix.join(workspace, ".morpheus", "runtime", "current");
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
  const run = (noSystemConfig) => {
    const pipeline = `tar -C ${shellQuote(parent)} -cf - ${shellQuote(base)} | ${shellQuote(sshBinary())} ${sshArgs(ssh, { noSystemConfig }).map(shellQuote).join(" ")} ${shellQuote(sshCommand(`rm -rf ${shellQuote(remoteDir)} ${shellQuote(extractedDir)} && mkdir -p ${shellQuote(destinationParent)} && tar -C ${shellQuote(destinationParent)} -xf - && ${finalizeMove}`))}`;
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

function syncLocalFileToRemote(localPath, remotePath, ssh, label) {
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

function syncRemoteInputPath(localPath, remotePath, ssh, label) {
  if (!localPath || !remotePath || !fs.existsSync(localPath)) {
    return;
  }
  const stat = fs.statSync(localPath);
  if (stat.isDirectory()) {
    syncLocalDirectoryToRemote(localPath, remotePath, ssh, label);
    return;
  }
  syncLocalFileToRemote(localPath, remotePath, ssh, label);
}

function syncRemotePathToLocal(remotePath, localPath, ssh, label) {
  if (!remotePath || !localPath) {
    return;
  }
  const destination = path.resolve(process.cwd(), localPath);
  const destinationParent = path.dirname(destination);
  const base = path.posix.basename(remotePath);
  const extractedPath = path.join(destinationParent, base);
  const finalizeMove = path.resolve(extractedPath) === path.resolve(destination)
    ? "true"
    : `mv ${shellQuote(extractedPath)} ${shellQuote(destination)}`;
  fs.mkdirSync(destinationParent, { recursive: true });
  const remoteScript = [
    "set -e",
    `if [ -d ${shellQuote(remotePath)} ]; then`,
    `  tar -C ${shellQuote(path.posix.dirname(remotePath))} -cf - ${shellQuote(base)}`,
    `elif [ -e ${shellQuote(remotePath)} ]; then`,
    `  tar -C ${shellQuote(path.posix.dirname(remotePath))} -cf - ${shellQuote(base)}`,
    "else",
    `  echo "missing remote path: ${String(remotePath).replace(/"/g, '\\"')}" >&2`,
    "  exit 1",
    "fi",
  ].join("\n");
  const run = (noSystemConfig) => {
    const pipeline = `${shellQuote(sshBinary())} ${sshArgs(ssh, { noSystemConfig }).map(shellQuote).join(" ")} ${shellQuote(sshCommand(remoteScript))} | tar -C ${shellQuote(destinationParent)} -xf - && ${finalizeMove}`;
    return runShell(pipeline);
  };

  let result = run(false);
  if (result.exitCode !== 0 && wantsSshNoConfigRetry(result)) {
    result = run(true);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `failed to sync local ${label}`);
  }
}

function stageLocalMorpheusRuntime() {
  const sourceRoot = path.resolve(repoRoot());
  const stagingParent = path.join(sourceRoot, ".morpheus-sync");
  fs.mkdirSync(stagingParent, { recursive: true });
  const stageRoot = fs.mkdtempSync(path.join(stagingParent, "runtime-"));
  const entries = [
    "apps/morpheus",
    "morpheus.yaml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "scripts/install-bin.mjs",
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
    "node scripts/install-bin.mjs",
  ].join("\n");
  runRequiredSsh(ssh, script, "failed to prepare remote morpheus runtime");
  return runtimeRoot;
}

function effectiveBuildDirKey(options) {
  if (!options.reuseBuildDir) {
    return null;
  }
  return options.buildDirKey || "default";
}

module.exports = {
  parseSshTarget,
  remoteWorkspacePath,
  remoteRepoRoot,
  prepareRemoteMorpheusRuntime,
  runSshStreaming,
  syncRemoteInputPath,
  syncRemotePathToLocal,
  effectiveBuildDirKey,
};
