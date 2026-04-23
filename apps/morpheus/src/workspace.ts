// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { workRoot } = require("./paths");
const { registerManagedWorkspace } = require("./managed-state");
const { applyConfigDefaults } = require("./config");
const { logDebug } = require("./logger");
const { writeStdoutLine } = require("./io");

function parseWorkspaceArgs(argv) {
  const positionals = [];
  const flags = {};
  const booleanFlags = new Set(["json", "verbose", "deprecated", "yes"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!booleanFlags.has(key) && next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

function workspaceUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js workspace create [--json]",
    "  node apps/morpheus/dist/cli.js workspace show [--json]",
    "  node apps/morpheus/dist/cli.js workspace clean --deprecated --yes [--json]",
    "  node apps/morpheus/dist/cli.js workspace create --workspace DIR [--json]",
    "  node apps/morpheus/dist/cli.js workspace show --workspace DIR [--json]",
    "  node apps/morpheus/dist/cli.js workspace clean --workspace DIR --deprecated --yes [--json]",
    "  node apps/morpheus/dist/cli.js workspace create --ssh TARGET --workspace DIR [--json]",
    "  node apps/morpheus/dist/cli.js workspace show --ssh TARGET --workspace DIR [--json]",
    "  node apps/morpheus/dist/cli.js workspace clean --ssh TARGET --workspace DIR --deprecated --yes [--json]"
  ].join("\n");
}

function toRelative(targetPath) {
  return path.relative(process.cwd(), targetPath) || ".";
}

function statDir(targetPath) {
  return {
    path: toRelative(targetPath),
    exists: fs.existsSync(targetPath),
    kind: "directory"
  };
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

function sshCommand(script) {
  return `bash -lc ${shellQuote(script)}`;
}

function runSsh(target, script) {
  logDebug("workspace", "running ssh workspace command", {
    ssh: target.original
  });
  const result = spawnSync("ssh", [...sshArgs(target), sshCommand(script)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status == null ? 1 : result.status
  };
}

function managedWorkspacePaths(root, platform) {
  const join = platform === "remote" ? path.posix.join : path.join;
  return {
    root,
    tools: join(root, "tools"),
    runs: join(root, "runs"),
    tmp: join(root, "tmp")
  };
}

function deprecatedWorkspacePaths(root, platform) {
  const join = platform === "remote" ? path.posix.join : path.join;
  return {
    downloads: join(root, "downloads"),
    sources: join(root, "sources"),
    builds: join(root, "builds"),
    cache: join(root, "cache")
  };
}

function managedWorkspaceShape(root, platform, stats) {
  const paths = managedWorkspacePaths(root, platform);
  const entries = {};
  for (const [name, targetPath] of Object.entries(paths)) {
    entries[name] = {
      path: targetPath,
      exists: Boolean(stats[name]),
      kind: "directory"
    };
  }
  const deprecated = {};
  for (const [name, targetPath] of Object.entries(deprecatedWorkspacePaths(root, platform))) {
    deprecated[name] = {
      path: targetPath,
      exists: Boolean(stats[name]),
      kind: "directory"
    };
  }
  return {
    root,
    mode: platform === "remote" ? "remote" : "local",
    directories: entries,
    deprecated
  };
}

function describeManagedWorkspace(workspaceRoot) {
  const paths = managedWorkspacePaths(path.resolve(process.cwd(), workspaceRoot), "local");
  const stats = {};
  for (const [name, targetPath] of Object.entries(paths)) {
    stats[name] = fs.existsSync(targetPath);
  }
  for (const [name, targetPath] of Object.entries(deprecatedWorkspacePaths(paths.root, "local"))) {
    stats[name] = fs.existsSync(targetPath);
  }
  return managedWorkspaceShape(paths.root, "local", stats);
}

function createManagedWorkspace(workspaceRoot) {
  const paths = managedWorkspacePaths(path.resolve(process.cwd(), workspaceRoot), "local");
  const created = [];
  const existing = [];

  logDebug("workspace", "creating local managed workspace", {
    root: paths.root
  });

  for (const [name, targetPath] of Object.entries(paths)) {
    const entry = { path: targetPath, exists: true, kind: "directory" };
    if (fs.existsSync(targetPath)) {
      existing.push(entry);
      continue;
    }
    fs.mkdirSync(targetPath, { recursive: true });
    created.push(entry);
  }

  const result = {
    root: paths.root,
    mode: "local",
    created,
    existing,
    workspace: describeManagedWorkspace(workspaceRoot)
  };
  registerManagedWorkspace({
    root: result.root,
    mode: result.mode,
    directories: result.workspace.directories
  });
  return result;
}

function describeRemoteWorkspace(target, workspaceRoot) {
  const paths = managedWorkspacePaths(workspaceRoot, "remote");
  const deprecated = deprecatedWorkspacePaths(workspaceRoot, "remote");
  const script = `
set -euo pipefail
python3 - <<'PY'
import json
paths = ${JSON.stringify({ ...paths, ...deprecated })}
result = {name: False for name in paths}
from pathlib import Path
for name, value in paths.items():
    result[name] = Path(value).is_dir()
print(json.dumps(result))
PY
`;
  const result = runSsh(target, script);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "failed to inspect remote workspace");
  }
  return {
    ssh: target.original,
    ...managedWorkspaceShape(workspaceRoot, "remote", JSON.parse(result.stdout))
  };
}

function createRemoteWorkspace(target, workspaceRoot) {
  const paths = managedWorkspacePaths(workspaceRoot, "remote");
  logDebug("workspace", "creating remote managed workspace", {
    root: workspaceRoot,
    ssh: target.original
  });
  const script = `
set -euo pipefail
mkdir -p ${Object.values(paths).map(shellQuote).join(" ")}
python3 - <<'PY'
import json
paths = ${JSON.stringify(paths)}
print(json.dumps(list(paths.values())))
PY
`;
  const result = runSsh(target, script);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "failed to create remote workspace");
  }
  const createdPaths = JSON.parse(result.stdout);
  const summary = {
    root: workspaceRoot,
    mode: "remote",
    ssh: target.original,
    created: createdPaths.map((targetPath) => ({
      path: targetPath,
      exists: true,
      kind: "directory"
    })),
    existing: [],
    workspace: describeRemoteWorkspace(target, workspaceRoot)
  };
  registerManagedWorkspace({
    root: summary.root,
    mode: summary.mode,
    ssh: summary.ssh,
    directories: summary.workspace.directories
  });
  return summary;
}

function printWorkspaceHuman(summary) {
  writeStdoutLine("Workspace");
  writeStdoutLine(`  root: ${summary.root}`);
  for (const [name, info] of Object.entries(summary.directories)) {
    writeStdoutLine(`  ${name}: ${info.path} (${info.exists ? "present" : "missing"})`);
  }
  const deprecated = summary.deprecated || {};
  const anyDeprecated = Object.values(deprecated).some((entry) => entry.exists);
  if (anyDeprecated) {
    writeStdoutLine("Deprecated");
    for (const [name, info] of Object.entries(deprecated)) {
      if (!info.exists) {
        continue;
      }
      writeStdoutLine(`  ${name}: ${info.path} (present)`);
    }
  }
}

function printCreateHuman(result) {
  writeStdoutLine(`Workspace created at ${result.root}`);
  writeStdoutLine(`  created: ${result.created.length}`);
  writeStdoutLine(`  existing: ${result.existing.length}`);
}

function aggregateWorkspaceResults(localResult, remoteResult) {
  return {
    mode: "hybrid",
    local: localResult,
    remote: remoteResult
  };
}

function printHybridCreateHuman(result) {
  writeStdoutLine("Local workspace");
  writeStdoutLine(`  root: ${result.local.root}`);
  for (const [name, info] of Object.entries(result.local.workspace.directories)) {
    writeStdoutLine(`  ${name}: ${info.path} (${info.exists ? "present" : "missing"})`);
  }
  writeStdoutLine("Remote workspace");
  writeStdoutLine(`  ssh: ${result.remote.ssh}`);
  writeStdoutLine(`  root: ${result.remote.root}`);
  for (const [name, info] of Object.entries(result.remote.workspace.directories)) {
    writeStdoutLine(`  ${name}: ${info.path} (${info.exists ? "present" : "missing"})`);
  }
}

function printHybridShowHuman(result) {
  writeStdoutLine("Local workspace");
  writeStdoutLine(`  root: ${result.local.root}`);
  for (const [name, info] of Object.entries(result.local.directories)) {
    writeStdoutLine(`  ${name}: ${info.path} (${info.exists ? "present" : "missing"})`);
  }
  const localDeprecated = result.local.deprecated || {};
  if (Object.values(localDeprecated).some((entry) => entry.exists)) {
    writeStdoutLine("Deprecated (local)");
    for (const [name, info] of Object.entries(localDeprecated)) {
      if (!info.exists) {
        continue;
      }
      writeStdoutLine(`  ${name}: ${info.path} (present)`);
    }
  }
  writeStdoutLine("Remote workspace");
  writeStdoutLine(`  ssh: ${result.remote.ssh}`);
  writeStdoutLine(`  root: ${result.remote.root}`);
  for (const [name, info] of Object.entries(result.remote.directories)) {
    writeStdoutLine(`  ${name}: ${info.path} (${info.exists ? "present" : "missing"})`);
  }
  const remoteDeprecated = result.remote.deprecated || {};
  if (Object.values(remoteDeprecated).some((entry) => entry.exists)) {
    writeStdoutLine("Deprecated (remote)");
    for (const [name, info] of Object.entries(remoteDeprecated)) {
      if (!info.exists) {
        continue;
      }
      writeStdoutLine(`  ${name}: ${info.path} (present)`);
    }
  }
}

function removeLocalDeprecated(workspaceRoot) {
  const root = path.resolve(process.cwd(), workspaceRoot);
  const deprecated = deprecatedWorkspacePaths(root, "local");
  const removed = [];
  const missing = [];

  for (const targetPath of Object.values(deprecated)) {
    if (!fs.existsSync(targetPath)) {
      missing.push({ path: toRelative(targetPath), exists: false, kind: "directory" });
      continue;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    removed.push({ path: toRelative(targetPath), exists: false, kind: "directory" });
  }

  return { root: toRelative(root), removed, missing, workspace: describeManagedWorkspace(workspaceRoot) };
}

function removeRemoteDeprecated(target, workspaceRoot) {
  const deprecated = deprecatedWorkspacePaths(workspaceRoot, "remote");
  const script = `
set -euo pipefail
rm -rf ${Object.values(deprecated).map(shellQuote).join(" ")}
python3 - <<'PY'
import json
paths = ${JSON.stringify(deprecated)}
print(json.dumps(list(paths.values())))
PY
`;
  const result = runSsh(target, script);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "failed to remove deprecated remote directories");
  }
  const removedPaths = JSON.parse(result.stdout);
  return {
    root: workspaceRoot,
    ssh: target.original,
    removed: removedPaths.map((entry) => ({ path: entry, exists: false, kind: "directory" })),
    workspace: describeRemoteWorkspace(target, workspaceRoot)
  };
}

function handleWorkspaceCommand(argv) {
  const { positionals, flags: parsedFlags } = parseWorkspaceArgs(argv);
  const subcommand = positionals[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    writeStdoutLine(workspaceUsage());
    return 0;
  }

  const rawFlags = parsedFlags;
  const { flags } = applyConfigDefaults(rawFlags, { allowGlobalRemote: false });
  const sshTarget = flags.ssh ? parseSshTarget(flags.ssh) : null;
  const explicitWorkspace = flags.workspace || null;
  const configuredLocalWorkspace =
    !rawFlags.workspace && !rawFlags.ssh ? flags.localWorkspace || null : null;
  const createBothFromConfig = Boolean(
    configuredLocalWorkspace &&
      sshTarget &&
      explicitWorkspace &&
      configuredLocalWorkspace !== explicitWorkspace
  );

  logDebug("workspace", "resolved workspace command", {
    subcommand,
    rawFlags,
    flags,
    createBothFromConfig
  });

  if (subcommand === "create") {
    if (createBothFromConfig) {
      const localResult = createManagedWorkspace(configuredLocalWorkspace);
      const remoteResult = createRemoteWorkspace(sshTarget, explicitWorkspace);
      const result = aggregateWorkspaceResults(localResult, remoteResult);
      if (flags.json) {
        writeStdoutLine(JSON.stringify(result, null, 2));
        return 0;
      }
      printHybridCreateHuman(result);
      return 0;
    }

    if (sshTarget) {
      if (!explicitWorkspace) {
        throw new Error("workspace create requires --workspace DIR when --ssh is set");
      }
      const result = createRemoteWorkspace(sshTarget, explicitWorkspace);
      if (flags.json) {
        writeStdoutLine(JSON.stringify(result, null, 2));
        return 0;
      }
      writeStdoutLine(`Remote workspace created at ${result.root}`);
      writeStdoutLine(`  ssh: ${result.ssh}`);
      writeStdoutLine(`  created: ${result.created.length}`);
      return 0;
    }

    if (explicitWorkspace) {
      const result = createManagedWorkspace(explicitWorkspace);
      if (flags.json) {
        writeStdoutLine(JSON.stringify(result, null, 2));
        return 0;
      }
      writeStdoutLine(`Workspace created at ${result.root}`);
      writeStdoutLine(`  created: ${result.created.length}`);
      writeStdoutLine(`  existing: ${result.existing.length}`);
      return 0;
    }

    const result = createManagedWorkspace(configuredLocalWorkspace || workRoot());
    if (flags.json) {
      writeStdoutLine(JSON.stringify(result, null, 2));
      return 0;
    }

    printCreateHuman(result);
    return 0;
  }

  if (subcommand === "show") {
    if (createBothFromConfig) {
      const summary = {
        mode: "hybrid",
        local: describeManagedWorkspace(configuredLocalWorkspace),
        remote: describeRemoteWorkspace(sshTarget, explicitWorkspace)
      };
      if (flags.json) {
        writeStdoutLine(JSON.stringify(summary, null, 2));
        return 0;
      }
      printHybridShowHuman(summary);
      return 0;
    }

    if (sshTarget) {
      if (!explicitWorkspace) {
        throw new Error("workspace show requires --workspace DIR when --ssh is set");
      }
      const summary = describeRemoteWorkspace(sshTarget, explicitWorkspace);
      if (flags.json) {
        writeStdoutLine(JSON.stringify(summary, null, 2));
        return 0;
      }
      writeStdoutLine("Remote workspace");
      writeStdoutLine(`  ssh: ${summary.ssh}`);
      writeStdoutLine(`  root: ${summary.root}`);
      for (const [name, info] of Object.entries(summary.directories)) {
        writeStdoutLine(`  ${name}: ${info.path} (${info.exists ? "present" : "missing"})`);
      }
      return 0;
    }

    if (explicitWorkspace) {
      const summary = describeManagedWorkspace(explicitWorkspace);
      if (flags.json) {
        writeStdoutLine(JSON.stringify(summary, null, 2));
        return 0;
      }
      printWorkspaceHuman(summary);
      return 0;
    }

    const summary = describeManagedWorkspace(configuredLocalWorkspace || workRoot());
    if (flags.json) {
      writeStdoutLine(JSON.stringify(summary, null, 2));
      return 0;
    }

    printWorkspaceHuman(summary);
    return 0;
  }

  if (subcommand === "clean") {
    if (!flags.deprecated) {
      throw new Error("workspace clean currently supports only --deprecated");
    }
    if (!flags.yes) {
      throw new Error("workspace clean requires --yes to remove directories");
    }

    if (sshTarget) {
      if (!explicitWorkspace) {
        throw new Error("workspace clean requires --workspace DIR when --ssh is set");
      }
      const result = removeRemoteDeprecated(sshTarget, explicitWorkspace);
      if (flags.json) {
        writeStdoutLine(JSON.stringify({
          command: "workspace clean",
          status: "success",
          exit_code: 0,
          summary: "removed deprecated workspace directories",
          details: result
        }, null, 2));
        return 0;
      }
      writeStdoutLine("Removed deprecated remote workspace directories.");
      return 0;
    }

    const targetWorkspace = explicitWorkspace || configuredLocalWorkspace || workRoot();
    const result = removeLocalDeprecated(targetWorkspace);
    if (flags.json) {
      writeStdoutLine(JSON.stringify({
        command: "workspace clean",
        status: "success",
        exit_code: 0,
        summary: "removed deprecated workspace directories",
        details: result
      }, null, 2));
      return 0;
    }
    writeStdoutLine("Removed deprecated local workspace directories.");
    return 0;
  }

  throw new Error(`unknown workspace subcommand: ${subcommand}`);
}

module.exports = {
  createManagedWorkspace,
  createRemoteWorkspace,
  describeManagedWorkspace,
  describeRemoteWorkspace,
  handleWorkspaceCommand
};
