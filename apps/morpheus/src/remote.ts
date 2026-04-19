// @ts-nocheck
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseRemoteArgs(argv) {
  const positionals = [];
  const flags = {};
  const repeatable = {
    env: [],
    "make-arg": [],
    path: []
  };

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

    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return {
    positionals,
    flags: {
      ...flags,
      env: repeatable.env,
      makeArg: repeatable["make-arg"],
      paths: repeatable.path,
      forwarded: flags.forwarded || []
    }
  };
}

function remoteUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js remote run --tool buildroot --ssh TARGET --workspace DIR --buildroot-version VER [--defconfig NAME] [--detach] [--json]",
    "  node apps/morpheus/dist/cli.js remote inspect --ssh TARGET --workspace DIR --id RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js remote logs --ssh TARGET --workspace DIR --id RUN_ID [--follow] [--json]",
    "  node apps/morpheus/dist/cli.js remote fetch --ssh TARGET --workspace DIR --id RUN_ID --dest DIR --path REMOTE_PATH [--path REMOTE_GLOB ...] [--json]"
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

function generateRunId(tool) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${tool}-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildrootTarballUrl(version) {
  return `https://buildroot.org/downloads/buildroot-${version}.tar.gz`;
}

function toolWorkspace(workspace, tool) {
  return path.posix.join(workspace, "tools", tool);
}

function remoteRunDir(workspace, tool, id) {
  return path.posix.join(toolWorkspace(workspace, tool), "runs", id);
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
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status == null ? 1 : result.status,
    error: result.error || null
  };
}

function runShell(command) {
  const result = spawnSync("bash", ["-lc", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
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

function buildrootRemoteScript(options, id) {
  const toolRoot = toolWorkspace(options.workspace, "buildroot");
  const cacheDir = path.posix.join(toolRoot, "cache");
  const srcRoot = path.posix.join(toolRoot, "src");
  const runDir = remoteRunDir(options.workspace, "buildroot", id);
  const tarball = path.posix.join(cacheDir, `buildroot-${options.buildrootVersion}.tar.gz`);
  const sourceDir = path.posix.join(srcRoot, `buildroot-${options.buildrootVersion}`);
  const outputDir = path.posix.join(runDir, "output");
  const manifest = remoteManifestPath(options.workspace, "buildroot", id);
  const logFile = remoteLogPath(options.workspace, "buildroot", id);
  const defconfigCommand = options.defconfig
    ? `make O=${shellQuote(outputDir)} ${options.defconfig}`
    : ":";
  const envPrefix = Object.entries(options.env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const makeCommand = [
    envPrefix,
    "make",
    `O=${shellQuote(outputDir)}`,
    ...options.makeArgs.map(shellQuote),
    ...options.forwarded.map(shellQuote)
  ].filter(Boolean).join(" ");
  const manifestJson = JSON.stringify({
    id,
    tool: "buildroot",
    mode: "remote",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: options.detach ? "submitted" : "running",
    command: "remote run",
    workspace: options.workspace,
    buildrootVersion: options.buildrootVersion,
    defconfig: options.defconfig || null,
    ssh: options.ssh,
    makeArgs: options.makeArgs,
    env: options.env,
    forwarded: options.forwarded,
    runDir,
    outputDir,
    logFile
  }, null, 2);

  return `
set -euo pipefail
mkdir -p ${shellQuote(cacheDir)} ${shellQuote(srcRoot)} ${shellQuote(runDir)} ${shellQuote(outputDir)}
: > ${shellQuote(logFile)}
if [ ! -f ${shellQuote(tarball)} ]; then
  curl -fsSL ${shellQuote(buildrootTarballUrl(options.buildrootVersion))} -o ${shellQuote(tarball)}
fi
if [ ! -d ${shellQuote(sourceDir)} ]; then
  tar -xzf ${shellQuote(tarball)} -C ${shellQuote(srcRoot)}
fi
cat > ${shellQuote(manifest)} <<'JSON'
${manifestJson}
JSON
cd ${shellQuote(sourceDir)}
set +e
{
  ${defconfigCommand}
  ${makeCommand}
} 2>&1 | tee -a ${shellQuote(logFile)}
exit_code=\${PIPESTATUS[0]}
set -e
status=success
if [ "\${exit_code}" -ne 0 ]; then
  status=error
fi
python3 - <<'PY'
import json
from pathlib import Path
from datetime import datetime, timezone
file = Path(${shellQuote(manifest)})
data = json.loads(file.read_text())
data['status'] = '${'${status}'}'
data['exitCode'] = int('${'${exit_code}'}')
data['updatedAt'] = datetime.now(timezone.utc).isoformat()
if data['status'] == 'error':
    data['errorMessage'] = 'remote Buildroot run failed'
file.write_text(json.dumps(data, indent=2) + '\\n')
PY
exit "\${exit_code}"
`;
}

function requireFlag(flags, name, message) {
  if (!flags[name]) {
    throw new Error(message || `missing required flag: --${name}`);
  }
  return flags[name];
}

function parseBuildrootRunOptions(flags) {
  const tool = requireFlag(flags, "tool", "remote run requires --tool buildroot");
  if (tool !== "buildroot") {
    throw new Error(`unsupported remote tool: ${tool}`);
  }
  return {
    tool,
    ssh: parseSshTarget(requireFlag(flags, "ssh", "remote run requires --ssh TARGET")),
    workspace: requireFlag(flags, "workspace", "remote run requires --workspace DIR"),
    buildrootVersion: requireFlag(flags, "buildroot-version", "remote run requires --buildroot-version VER"),
    defconfig: flags.defconfig || null,
    makeArgs: flags.makeArg || [],
    env: parseKeyValues(flags.env || []),
    forwarded: flags.forwarded || [],
    detach: Boolean(flags.detach)
  };
}

function parseExistingRunOptions(flags, command) {
  return {
    ssh: parseSshTarget(requireFlag(flags, "ssh", `remote ${command} requires --ssh TARGET`)),
    workspace: requireFlag(flags, "workspace", `remote ${command} requires --workspace DIR`),
    id: requireFlag(flags, "id", `remote ${command} requires --id RUN_ID`),
    tool: flags.tool || "buildroot"
  };
}

function runRemoteRun(flags) {
  const options = parseBuildrootRunOptions(flags);
  const id = generateRunId("buildroot");
  const script = buildrootRemoteScript(options, id);
  const manifest = remoteManifestPath(options.workspace, "buildroot", id);
  const runDir = remoteRunDir(options.workspace, "buildroot", id);
  const logFile = remoteLogPath(options.workspace, "buildroot", id);

  if (options.detach) {
    const detachedScript = `nohup bash -lc ${shellQuote(script)} > /dev/null 2>&1 < /dev/null & echo $!`;
    const result = runSsh(options.ssh, detachedScript, false);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "failed to submit remote run");
    }
    const pid = Number.parseInt(result.stdout.trim(), 10);
    return {
      command: "remote run",
      status: "submitted",
      exit_code: 0,
      summary: "submitted remote Buildroot run",
      details: { id, tool: "buildroot", workspace: options.workspace, run_dir: runDir, manifest, log_file: logFile, pid }
    };
  }

  const result = runSsh(options.ssh, script, !flags.json);
  if (flags.json) {
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line) {
        emitJson({
          command: "remote run",
          status: "stream",
          exit_code: 0,
          details: { event: "log", id, line }
        });
      }
    }
  }
  return {
    command: "remote run",
    status: result.exitCode === 0 ? "success" : "error",
    exit_code: result.exitCode,
    summary: result.exitCode === 0 ? "completed remote Buildroot run" : "remote Buildroot run failed",
    details: { id, tool: "buildroot", workspace: options.workspace, run_dir: runDir, manifest, log_file: logFile },
    error: result.exitCode === 0 ? undefined : { code: "remote_run_failed", message: result.stderr || "remote run failed" }
  };
}

function runRemoteInspect(flags) {
  const options = parseExistingRunOptions(flags, "inspect");
  const manifest = remoteManifestPath(options.workspace, options.tool, options.id);
  const result = runSsh(options.ssh, `cat ${shellQuote(manifest)}`, false);
  if (result.exitCode !== 0) {
    throw new Error(`failed to read remote manifest: ${manifest}`);
  }
  return {
    command: "remote inspect",
    status: "success",
    exit_code: 0,
    summary: "inspected remote run",
    details: { manifest: JSON.parse(result.stdout) }
  };
}

function runRemoteLogs(flags) {
  const options = parseExistingRunOptions(flags, "logs");
  const logFile = remoteLogPath(options.workspace, options.tool, options.id);
  const command = flags.follow ? `tail -n +1 -f ${shellQuote(logFile)}` : `cat ${shellQuote(logFile)}`;
  const result = runSsh(options.ssh, command, !flags.json);
  if (result.exitCode !== 0) {
    throw new Error(`failed to read remote logs: ${logFile}`);
  }
  if (flags.json) {
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line) {
        emitJson({
          command: "remote logs",
          status: "stream",
          exit_code: 0,
          details: { event: "log", id: options.id, line }
        });
      }
    }
  }
  return {
    command: "remote logs",
    status: "success",
    exit_code: 0,
    summary: "streamed remote logs",
    details: { id: options.id, tool: options.tool, follow: Boolean(flags.follow), log_file: logFile }
  };
}

function runRemoteFetch(flags) {
  const options = parseExistingRunOptions(flags, "fetch");
  const destination = path.resolve(process.cwd(), requireFlag(flags, "dest", "remote fetch requires --dest DIR"));
  const paths = flags.paths || [];
  if (paths.length === 0) {
    throw new Error("remote fetch requires at least one --path REMOTE_PATH");
  }
  fs.mkdirSync(destination, { recursive: true });
  const remoteBase = remoteRunDir(options.workspace, options.tool, options.id);
  const remotePaths = paths.map((entry) => (
    entry.startsWith("/") ? entry : path.posix.join(remoteBase, entry)
  ));
  const pipeline = `ssh ${sshArgs(options.ssh).map(shellQuote).join(" ")} bash -lc ${shellQuote(`tar -cf - ${remotePaths.map(shellQuote).join(" ")}`)} | tar -xf - -C ${shellQuote(destination)}`;
  const result = runShell(pipeline);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "failed to fetch remote paths");
  }
  return {
    command: "remote fetch",
    status: "success",
    exit_code: 0,
    summary: "fetched explicit remote paths",
    details: { id: options.id, tool: options.tool, dest: destination, paths }
  };
}

function printRemoteResult(result, flags) {
  if (flags.json) {
    emitJson(result);
    return;
  }
  if (result.status === "submitted") {
    emitText(`submitted: ${result.details.id}`);
    emitText(`manifest: ${result.details.manifest}`);
    return;
  }
  if (result.details && result.details.manifest && result.details.manifest.id) {
    emitText(`id: ${result.details.manifest.id}`);
    emitText(`status: ${result.details.manifest.status}`);
    return;
  }
  if (result.details && result.details.id) {
    emitText(`id: ${result.details.id}`);
  }
  emitText(result.summary || result.status);
}

function handleRemoteCommand(argv) {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    process.stdout.write(`${remoteUsage()}\n`);
    return 0;
  }

  const { flags } = parseRemoteArgs(argv.slice(1));
  let result;
  if (subcommand === "run") {
    result = runRemoteRun(flags);
  } else if (subcommand === "inspect") {
    result = runRemoteInspect(flags);
  } else if (subcommand === "logs") {
    result = runRemoteLogs(flags);
  } else if (subcommand === "fetch") {
    result = runRemoteFetch(flags);
  } else {
    throw new Error(`unknown remote subcommand: ${subcommand}`);
  }

  printRemoteResult(result, flags);
  return result.exit_code || 0;
}

module.exports = {
  handleRemoteCommand,
  parseRemoteArgs,
  parseSshTarget,
  remoteRunDir,
  remoteManifestPath,
  remoteLogPath,
  remoteUsage
};
