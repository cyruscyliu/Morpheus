// @ts-nocheck
const path = require("path");
const { spawnSync } = require("child_process");
const { applyConfigDefaults } = require("./config");
const { resolveToolDependencies } = require("./dependency-resolver");
const { repoRoot } = require("./paths");
const { readToolDescriptor, renderManagedTemplate } = require("./tool-descriptor");
const { writeStdoutLine } = require("./io");
const {
  parseSshTarget,
  remoteWorkspacePath,
  remoteRepoRoot,
  prepareRemoteMorpheusRuntime,
  runSshStreaming,
} = require("../transport/remote");

function parseToolArgs(argv) {
  const positionals = [];
  const flags = {};
  const passthrough = [];
  let afterDoubleDash = false;
  const repeatableFlags = new Set([
    "qemu-arg",
    "target-list",
    "configure-arg",
    "make-arg",
    "env",
    "path",
    "artifact",
    "config-fragment",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (afterDoubleDash) {
      passthrough.push(token);
      continue;
    }
    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (repeatableFlags.has(key)) {
      if (!next || next.startsWith("--")) {
        flags[key] = Array.isArray(flags[key]) ? [...flags[key]] : [];
      } else {
        const current = Array.isArray(flags[key]) ? flags[key] : [];
        flags[key] = [...current, next];
        index += 1;
      }
      continue;
    }
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags, passthrough };
}

function printJson(value) {
  writeStdoutLine(JSON.stringify(value, null, 2));
}

function requireFlag(flags, name, message) {
  if (!flags[name]) {
    throw new Error(message || `missing required flag: --${name}`);
  }
  return flags[name];
}

function templateValues(buildVersion, buildDirKey) {
  return {
    buildVersion,
    buildDirKey,
  };
}

function localManaged(descriptor) {
  return descriptor.managed && descriptor.managed.local ? descriptor.managed.local : null;
}

function commandSpec(descriptor, command) {
  const managed = localManaged(descriptor);
  return managed && managed.commands && managed.commands[command]
    ? managed.commands[command]
    : null;
}

function defaultSourceDir(workspace, tool, descriptor, buildVersion, buildDirKey) {
  const managed = localManaged(descriptor);
  if (managed && managed.sourceTemplate) {
    return path.join(workspace, renderManagedTemplate(managed.sourceTemplate, templateValues(buildVersion || "default", buildDirKey || "default")));
  }
  const leaf = buildVersion ? `${tool}-${buildVersion}` : tool;
  return path.join(workspace, "tools", tool, "src", leaf);
}

function defaultDownloadsDir(workspace, tool, descriptor) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.downloadsDir) {
    return null;
  }
  return path.join(workspace, managed.downloadsDir);
}

function defaultOutputDir(workspace, descriptor, buildVersion, buildDirKey) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.outputDirTemplate) {
    return null;
  }
  return path.join(workspace, renderManagedTemplate(managed.outputDirTemplate, templateValues(buildVersion || "default", buildDirKey || "default")));
}

function defaultBuildDir(workspace, descriptor, buildVersion, buildDirKey) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.buildDirTemplate) {
    return null;
  }
  return path.join(workspace, renderManagedTemplate(managed.buildDirTemplate, templateValues(buildVersion || "default", buildDirKey || "default")));
}

function defaultInstallDir(workspace, descriptor, buildVersion, buildDirKey) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.installDirTemplate) {
    return null;
  }
  return path.join(workspace, renderManagedTemplate(managed.installDirTemplate, templateValues(buildVersion || "default", buildDirKey || "default")));
}

function resolveManagedPathTemplate(workspace, descriptor, template, buildVersion, buildDirKey) {
  return path.join(
    workspace,
    renderManagedTemplate(template, templateValues(buildVersion || "default", buildDirKey || "default"))
  );
}

function spawnTool(descriptor, args) {
  const entryPath = path.join(repoRoot(), descriptor.installRoot, descriptor.entry);
  if (descriptor.runtime === "node") {
    return spawnSync(process.execPath, [entryPath, ...args], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
  }
  return spawnSync(entryPath, args, {
    encoding: "utf8",
    cwd: process.cwd(),
  });
}

function parseToolPayload(result, fallbackMessage) {
  if (result.status !== 0) {
    let payload = null;
    try {
      payload = result.stdout ? JSON.parse(String(result.stdout).trim().split(/\r?\n/).at(-1)) : null;
    } catch {
      payload = null;
    }
    throw new Error((payload && payload.summary) || result.stderr || result.stdout || fallbackMessage);
  }
  return JSON.parse(String(result.stdout).trim().split(/\r?\n/).at(-1));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function pathFlagSet() {
  return new Set([
    "--source",
    "--downloads-dir",
    "--patch-dir",
    "--output",
    "--build-dir",
    "--install-dir",
    "--path",
    "--run-dir",
    "--state-dir",
    "--kernel",
    "--initrd",
    "--qemu",
    "--microkit-sdk",
    "--toolchain",
    "--libvmm-dir",
    "--contract",
  ]);
}

function rewriteRemoteArgs(args, resolved) {
  const pathFlags = pathFlagSet();
  const rewritten = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    rewritten.push(token);
    if (!pathFlags.has(token) || index + 1 >= args.length) {
      continue;
    }
    index += 1;
    rewritten.push(
      remoteWorkspacePath(
        resolved.workspace,
        resolved.localWorkspace || null,
        args[index]
      )
    );
  }
  return rewritten;
}

function parseLastJsonLine(output) {
  const text = String(output || "").trim();
  if (!text) {
    return null;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      continue;
    }
  }
  return null;
}

async function executeRemoteTopLevelToolCommand(command, tool, args, resolved, flags) {
  const ssh = parseSshTarget(resolved.ssh);
  const remoteRoot = flags["sync-morpheus"]
    ? prepareRemoteMorpheusRuntime(resolved.workspace, ssh)
    : remoteRepoRoot();
  const remoteArgs = rewriteRemoteArgs(args, resolved);
  const morpheusArgs = [
    command,
    "--tool",
    tool,
    "--workspace",
    resolved.workspace,
    ...remoteArgs.slice(2),
  ];
  const commandLine = [
    `"${remoteRoot}/bin/morpheus"`,
    ...morpheusArgs.map((value) => shellQuote(value)),
  ].join(" ");
  const script = [
    "set -e",
    `remote_repo_root=${shellQuote(remoteRoot)}`,
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
    `${commandLine.replace(`"${remoteRoot}/bin/morpheus"`, '"$MORPHEUS_REMOTE_CMD"')}`,
  ].join("\n");
  const result = await runSshStreaming(ssh, script, { collectStdout: true });
  const payload = parseLastJsonLine(result.stdout || "");
  if (result.exitCode !== 0 || !payload) {
    throw new Error((payload && payload.summary) || result.stderr || result.stdout || `failed to ${command} with tool ${tool}`);
  }
  return payload;
}

function normalizeArtifacts(payload) {
  if (!payload || !payload.details) {
    return payload;
  }
  if (Array.isArray(payload.details.artifacts)) {
    return payload;
  }
  if (typeof payload.details.source === "string" && payload.details.source) {
    return {
      ...payload,
      details: {
        ...payload.details,
        artifacts: [
          {
            path: "source-dir",
            location: payload.details.source,
          }
        ],
      },
    };
  }
  return payload;
}

function resolveInvocation(command, flags, options = {}) {
  const tool = requireFlag(flags, "tool", `${command} requires --tool <name>`);
  const descriptor = readToolDescriptor(tool);
  const { flags: resolved } = applyConfigDefaults(
    {
      json: Boolean(flags.json),
      tool,
      workspace: flags.workspace || null,
      source: flags.source || flags.path || null,
      output: flags.output || null,
      "build-dir-key": flags["build-dir-key"] || null,
      "build-version": flags["build-version"] || null,
      "archive-url": flags["archive-url"] || null,
      "patch-dir": flags["patch-dir"] || null,
      "downloads-dir": flags["downloads-dir"] || null,
    },
    { allowGlobalRemote: Boolean(options.allowGlobalRemote), allowToolDefaults: true }
  );
  if (!resolved.workspace) {
    throw new Error(`${command} requires --workspace DIR or workspace.root in morpheus.yaml`);
  }
  return { tool, descriptor, resolved: resolveToolDependencies(resolved, command) };
}

function toolCommandArgs(command, resolved, descriptor, passthrough) {
  const tool = resolved.tool;
  const workspace = resolved.workspace;
  const buildVersion = resolved["build-version"] || null;
  const buildDirKey = resolved["build-dir-key"] || "default";
  const spec = commandSpec(descriptor, command);
  const pathFlags = spec && spec.pathFlags ? spec.pathFlags : {};
  const flagAliases = spec && spec.flagAliases ? spec.flagAliases : {};
  const effectivePaths = {
    source: resolved.source || defaultSourceDir(workspace, tool, descriptor, buildVersion, buildDirKey),
    "downloads-dir": resolved["downloads-dir"] || defaultDownloadsDir(workspace, tool, descriptor),
    "build-dir": resolved["build-dir"] || defaultBuildDir(workspace, descriptor, buildVersion, buildDirKey),
    "install-dir": resolved["install-dir"] || defaultInstallDir(workspace, descriptor, buildVersion, buildDirKey),
    "build-version": buildVersion,
  };
  for (const [genericFlag, template] of Object.entries(pathFlags)) {
    if (effectivePaths[genericFlag]) {
      continue;
    }
    effectivePaths[genericFlag] = resolveManagedPathTemplate(
      workspace,
      descriptor,
      template,
      buildVersion,
      buildDirKey
    );
  }

  const args = ["--json", command];
  if (effectivePaths.source) {
    args.push("--source", effectivePaths.source);
  }
  if (command !== "patch" && buildVersion) {
    args.push("--build-version", buildVersion);
  }
  if (resolved["archive-url"]) {
    args.push("--archive-url", resolved["archive-url"]);
  }
  if (command === "patch") {
    args.push("--patch-dir", requireFlag(resolved, "patch-dir", "patch requires --patch-dir DIR"));
  }
  for (const [genericFlag, value] of Object.entries(effectivePaths)) {
    if (["source", "build-version"].includes(genericFlag) || !value) {
      continue;
    }
    const actualFlag = flagAliases[genericFlag] || genericFlag;
    if (args.includes(`--${actualFlag}`)) {
      continue;
    }
    args.push(`--${actualFlag}`, String(value));
  }

  const forwardedKeys = [
    "defconfig",
    "qemu",
    "microkit-sdk",
    "toolchain",
    "libvmm-dir",
    "runtime-contract",
    "microkit-config",
    "microkit-version",
    "board",
    "example",
    "target",
    "action",
    "kernel",
    "initrd",
    "append",
    "make-target",
  ];
  for (const key of forwardedKeys) {
    if (!Object.prototype.hasOwnProperty.call(resolved, key)) {
      continue;
    }
    const value = resolved[key];
    if (value == null || value === false || value === "" || args.includes(`--${key}`)) {
      continue;
    }
    if (value === true) {
      args.push(`--${key}`);
      continue;
    }
    args.push(`--${key}`, String(value));
  }
  const repeatableForwardedKeys = ["target-list", "configure-arg", "qemu-arg", "make-arg", "config-fragment", "env", "file", "filter", "kconfig", "rust-target"];
  for (const key of repeatableForwardedKeys) {
    if (!Array.isArray(resolved[key]) || resolved[key].length === 0) {
      continue;
    }
    const flag = `--${key}`;
    if (args.includes(flag)) {
      continue;
    }
    for (const item of resolved[key]) {
      args.push(flag, String(item));
    }
  }

  args.push(...passthrough);
  return { args };
}

async function handleToolLifecycleCommand(command, argv, usage, options = {}) {
  const { positionals, flags, passthrough } = parseToolArgs(argv);
  if (positionals.length > 0 || flags.help) {
    writeStdoutLine(usage);
    return 0;
  }

  const { tool, descriptor, resolved } = resolveInvocation(command, flags, options);
  const { args } = toolCommandArgs(command, resolved, descriptor, passthrough);
  const remoteEnabled = Boolean(resolved.ssh && resolved.workspace && resolved.localWorkspace && resolved.workspace !== resolved.localWorkspace);
  const payload = normalizeArtifacts(remoteEnabled
    ? await executeRemoteTopLevelToolCommand(command, tool, args, resolved, flags)
    : parseToolPayload(
      spawnTool(descriptor, args),
      `failed to ${command} with tool ${tool}`
    ));

  if (resolved.json) {
    printJson(payload);
  } else {
    writeStdoutLine(payload.details && payload.details.source ? payload.details.source : payload.summary);
  }
  return payload.exit_code || 0;
}

async function handleToolPassthroughCommand(command, argv, usage, options = {}) {
  const { positionals, flags, passthrough } = parseToolArgs(argv);
  if (positionals.length > 0 || flags.help) {
    writeStdoutLine(usage);
    return 0;
  }

  const tool = requireFlag(flags, "tool", `${command} requires --tool <name>`);
  const { flags: resolved } = applyConfigDefaults(
    { ...flags, json: Boolean(flags.json), tool },
    { allowGlobalRemote: Boolean(options.allowGlobalRemote), allowToolDefaults: true }
  );
  const effective = resolveToolDependencies(resolved);
  const remoteEnabled = Boolean(effective.ssh && effective.workspace && effective.localWorkspace && effective.workspace !== effective.localWorkspace);
  const descriptor = readToolDescriptor(tool);
  const reserved = new Set(["tool", "json", "help"]);
  const args = ["--json", command];
  for (const [key, rawValue] of Object.entries(effective)) {
    if (reserved.has(key)) {
      continue;
    }
    if (["workspace", "localWorkspace", "ssh", "remote", "remoteWorkspace", "remoteTarget", "mode"].includes(key)) {
      continue;
    }
    if (rawValue === true) {
      args.push(`--${key}`);
      continue;
    }
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        args.push(`--${key}`, String(item));
      }
      continue;
    }
    if (rawValue === false || rawValue == null) {
      continue;
    }
    args.push(`--${key}`, String(rawValue));
  }
  args.push(...passthrough);

  const payload = remoteEnabled
    ? await executeRemoteTopLevelToolCommand(command, tool, args, effective, flags)
    : parseToolPayload(
      spawnTool(descriptor, args),
      `failed to ${command} with tool ${tool}`
    );

  if (flags.json) {
    printJson(payload);
  } else if (command === "logs" && payload.details && typeof payload.details.text === "string") {
    writeStdoutLine(payload.details.text);
  } else if (payload.details && payload.details.manifest) {
    writeStdoutLine(payload.details.manifest);
  } else {
    writeStdoutLine(payload.summary || `completed ${command}`);
  }
  return payload.exit_code || 0;
}

module.exports = {
  handleToolLifecycleCommand,
  handleToolPassthroughCommand,
  executeRemoteTopLevelToolCommand,
  parseToolPayload,
  parseToolArgs,
  printJson,
  requireFlag,
  resolveInvocation,
  spawnTool,
  defaultSourceDir,
  defaultDownloadsDir,
};
