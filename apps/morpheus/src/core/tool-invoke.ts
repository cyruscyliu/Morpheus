// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { applyConfigDefaults } = require("./config");
const { resolveToolDependencies } = require("./dependency-resolver");
const { repoRoot } = require("./paths");
const { readToolDescriptor, renderManagedTemplate } = require("./tool-descriptor");
const { writeStdout, writeStdoutLine, writeStderrLine } = require("./io");
const {
  parseSshTarget,
  remoteWorkspacePath,
  remoteRepoRoot,
  prepareRemoteMorpheusRuntime,
  runSshStreaming,
  syncRemoteInputPath,
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
  writeStdoutLine(JSON.stringify(value));
}

function requireFlag(flags, name, message) {
  if (!flags[name]) {
    throw new Error(message || `missing required flag: --${name}`);
  }
  return flags[name];
}

function isRunningPid(pid) {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function templateValues(buildVersion, buildDirKey, extras = {}) {
  return {
    buildVersion,
    buildDirKey,
    tool: extras.tool || null,
    toolchainVersion: extras.toolchainVersion || "12.3.rel1",
    example: extras.example || "virtio",
  };
}

function localManaged(descriptor) {
  return descriptor.managed && descriptor.managed.local ? descriptor.managed.local : null;
}

function descriptorSupportsRemote(descriptor) {
  const modes = descriptor && descriptor.managed && Array.isArray(descriptor.managed.modes)
    ? descriptor.managed.modes
    : null;
  if (!modes || modes.length === 0) {
    return true;
  }
  return modes.includes("remote");
}

function commandSpec(descriptor, command) {
  const managed = localManaged(descriptor);
  return managed && managed.commands && managed.commands[command]
    ? managed.commands[command]
    : null;
}

function forwardedFlagSpec(descriptor, command) {
  const managed = localManaged(descriptor) || {};
  const spec = commandSpec(descriptor, command) || {};
  const defaultScalarByCommand = {
    fetch: Array.isArray(managed.fetchFlags) ? managed.fetchFlags : [],
    patch: [],
  };
  const defaultRepeatableByCommand = {
    fetch: [],
    patch: [],
  };
  return {
    scalar: Array.isArray(spec.scalarFlags)
      ? spec.scalarFlags
      : (Object.prototype.hasOwnProperty.call(defaultScalarByCommand, command)
        ? defaultScalarByCommand[command]
        : null),
    repeatable: Array.isArray(spec.repeatableFlags)
      ? spec.repeatableFlags
      : (Object.prototype.hasOwnProperty.call(defaultRepeatableByCommand, command)
        ? defaultRepeatableByCommand[command]
        : null),
  };
}

function defaultSourceDir(workspace, tool, descriptor, buildVersion, buildDirKey, extras = {}) {
  const managed = localManaged(descriptor);
  if (managed && managed.sourceTemplate) {
    return path.join(workspace, renderManagedTemplate(managed.sourceTemplate, templateValues(buildVersion || "default", buildDirKey || "default", extras)));
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

function defaultOutputDir(workspace, descriptor, buildVersion, buildDirKey, extras = {}) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.outputDirTemplate) {
    return null;
  }
  return path.join(workspace, renderManagedTemplate(managed.outputDirTemplate, templateValues(buildVersion || "default", buildDirKey || "default", extras)));
}

function defaultBuildDir(workspace, descriptor, buildVersion, buildDirKey, extras = {}) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.buildDirTemplate) {
    return null;
  }
  return path.join(workspace, renderManagedTemplate(managed.buildDirTemplate, templateValues(buildVersion || "default", buildDirKey || "default", extras)));
}

function defaultInstallDir(workspace, descriptor, buildVersion, buildDirKey, extras = {}) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.installDirTemplate) {
    return null;
  }
  return path.join(workspace, renderManagedTemplate(managed.installDirTemplate, templateValues(buildVersion || "default", buildDirKey || "default", extras)));
}

function defaultExecRunDir(workspace, tool, descriptor, extras = {}) {
  const managed = localManaged(descriptor);
  if (!managed || !managed.execDirTemplate) {
    return null;
  }
  return path.join(
    workspace,
    renderManagedTemplate(
      managed.execDirTemplate,
      templateValues("default", "default", { ...extras, tool }),
    ),
  );
}

function resolveManagedPathTemplate(workspace, descriptor, template, buildVersion, buildDirKey, extras = {}) {
  return path.join(
    workspace,
    renderManagedTemplate(template, templateValues(buildVersion || "default", buildDirKey || "default", extras))
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

async function runToolStreaming(descriptor, args, options = {}) {
  const entryPath = path.join(repoRoot(), descriptor.installRoot, descriptor.entry);
  const childCwd = options.cwd || process.cwd();
  const child = descriptor.runtime === "node"
    ? spawn(process.execPath, [entryPath, ...args], {
        cwd: childCwd,
        env: options.env || process.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn(entryPath, args, {
        cwd: childCwd,
        env: options.env || process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

  return await new Promise((resolve, reject) => {
    let stdoutText = "";
    let stderrText = "";
    let stdoutBuffer = "";
    let finalPayload = null;

    const handleStdoutLine = (rawLine) => {
      const line = String(rawLine || "");
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        if (!options.jsonMode) {
          writeStdoutLine(line);
        }
        return;
      }
      if (
        parsed
        && parsed.status === "stream"
        && parsed.details
      ) {
        if (options.jsonMode) {
          writeStdoutLine(trimmed);
        } else if (parsed.details.event === "log" && typeof parsed.details.chunk === "string") {
          writeStdout(parsed.details.chunk);
        } else if (parsed.details.event === "log" && typeof parsed.details.line === "string") {
          writeStderrLine(parsed.details.line);
        }
        return;
      }
      finalPayload = parsed;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutText += chunk;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        handleStdoutLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrText += chunk;
      if (!options.jsonMode) {
        process.stderr.write(chunk);
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        handleStdoutLine(stdoutBuffer);
      }
      if ((!finalPayload || typeof finalPayload !== "object") && stdoutText.trim()) {
        finalPayload = parseLastJsonLine(stdoutText);
      }
      resolve({
        status: typeof code === "number" ? code : 1,
        stdout: stdoutText,
        stderr: stderrText,
        toolPayload: finalPayload,
      });
    });
  });
}

function parseToolPayload(result, fallbackMessage) {
  if (result.toolPayload && typeof result.toolPayload === "object") {
    if (result.status !== 0) {
      throw new Error(result.toolPayload.summary || result.stderr || result.stdout || fallbackMessage);
    }
    return result.toolPayload;
  }
  if (result.status !== 0) {
    const payload = parseLastJsonLine(result.stdout || "");
    throw new Error((payload && payload.summary) || result.stderr || result.stdout || fallbackMessage);
  }
  const payload = parseLastJsonLine(result.stdout || "");
  if (payload && typeof payload === "object") {
    return payload;
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

function isRemoteManagedPath(value, resolved) {
  if (!value || !resolved || !resolved.workspace || !resolved.localWorkspace) {
    return false;
  }
  if (resolved.workspace === resolved.localWorkspace) {
    return false;
  }
  const candidate = String(value);
  const remoteRoot = path.posix.normalize(String(resolved.workspace));
  const remoteValue = path.posix.normalize(candidate);
  return remoteValue === remoteRoot || remoteValue.startsWith(`${remoteRoot}/`);
}

function parseLastJsonLine(output) {
  const text = String(output || "").trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // fall through to line-based parsing for mixed output
  }
  let end = text.lastIndexOf("}");
  while (end >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = end; index >= 0; index -= 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "}") {
        depth += 1;
        continue;
      }
      if (char === "{") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(index, end + 1));
            if (parsed && typeof parsed === "object") {
              return parsed;
            }
          } catch {
            break;
          }
        }
      }
    }
    end = text.lastIndexOf("}", end - 1);
  }
  return null;
}

function findManifestFiles(rootDir) {
  const results = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else if (entry.isFile() && entry.name === "manifest.json") {
        results.push(nextPath);
      }
    }
  }
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function getByPath(value, dottedPath) {
  const parts = String(dottedPath || "").split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
      return "";
    }
    current = current[part];
  }
  return current == null ? "" : current;
}

function renderRunGuardKey(template, data) {
  return String(template || "").replace(/\{([^}]+)\}/g, (_, key) => String(getByPath(data, key.trim()) || ""));
}

function invocationRunGuard(tool, descriptor, effective) {
  const guard = descriptor && descriptor.runGuard ? descriptor.runGuard : null;
  if (!guard || guard.scope !== "workspace" || !guard.keyTemplate) {
    return null;
  }
  const data = {
    tool,
    target: effective.target || "default",
    action: effective.action || effective["runtime-action"] || "run",
    example: effective.example || "default",
    runtime: {
      provider: {
        action: effective["runtime-action"] || effective.action || "run",
      },
    },
    provider: {
      action: effective.action || "run",
      example: effective.example || "default",
    },
  };
  return {
    scope: guard.scope,
    tool,
    key: renderRunGuardKey(guard.keyTemplate, data),
  };
}

function manifestRunGuard(manifest) {
  if (!manifest || manifest.status !== "running") {
    return null;
  }
  return manifest.runGuard || null;
}

function ensureNoWorkspaceRunConflict(tool, descriptor, effective) {
  const workspaceRoot = effective.localWorkspace || effective.workspace;
  if (!workspaceRoot) {
    return;
  }
  const runGuard = invocationRunGuard(tool, descriptor, effective);
  if (!runGuard) {
    return;
  }
  const roots = [
    path.join(workspaceRoot, "tmp"),
    path.join(workspaceRoot, "runs"),
  ];
  for (const rootDir of roots) {
    for (const manifestFile of findManifestFiles(rootDir)) {
      let manifest = null;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      } catch {
        continue;
      }
      const manifestGuard = manifestRunGuard(manifest);
      if (
        !manifestGuard
        || manifestGuard.scope !== runGuard.scope
        || manifestGuard.tool !== runGuard.tool
        || manifestGuard.key !== runGuard.key
      ) {
        continue;
      }
      const pid = Number(manifest.pid || manifest.launcherPid || manifest.runnerPid || 0);
      if (!isRunningPid(pid)) {
        continue;
      }
      const providerManifestPath = manifest.runtime
        && manifest.runtime.providerRun
        && typeof manifest.runtime.providerRun.manifest === "string"
        ? manifest.runtime.providerRun.manifest
        : null;
      if (providerManifestPath && fs.existsSync(providerManifestPath)) {
        try {
          const providerManifest = JSON.parse(fs.readFileSync(providerManifestPath, "utf8"));
          const providerPid = Number(providerManifest.pid || providerManifest.launcherPid || providerManifest.runnerPid || 0);
          if (isRunningPid(providerPid)) {
            try {
              process.kill(providerPid, "SIGTERM");
            } catch {}
          }
        } catch {}
      }
      for (const runningPid of [
        Number(manifest.pid || 0),
        Number(manifest.launcherPid || 0),
        Number(manifest.runnerPid || 0),
      ]) {
        if (!isRunningPid(runningPid)) {
          continue;
        }
        try {
          process.kill(runningPid, "SIGTERM");
        } catch {}
      }
      const waited = spawnSync(
        "bash",
        ["-lc", `for i in $(seq 1 30); do if ! kill -0 ${pid} 2>/dev/null; then exit 0; fi; sleep 0.1; done; exit 1`],
        { stdio: "ignore" },
      );
      if (waited.status !== 0) {
        for (const runningPid of [
          Number(manifest.pid || 0),
          Number(manifest.launcherPid || 0),
          Number(manifest.runnerPid || 0),
        ]) {
          if (!isRunningPid(runningPid)) {
            continue;
          }
          try {
            process.kill(runningPid, "SIGKILL");
          } catch {}
        }
      }
      const cleanupRoots = [
        typeof manifest.stateDir === "string" ? manifest.stateDir : null,
        typeof manifest.runDir === "string" ? manifest.runDir : null,
      ].filter(Boolean);
      for (const cleanupRoot of cleanupRoots) {
        fs.rmSync(cleanupRoot, { recursive: true, force: true });
      }
      return;
    }
  }
}

function canonicalLocalArtifactPath(tool, descriptor, resolved, artifact) {
  if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string") {
    return null;
  }
  const managed = localManaged(descriptor);
  if (!managed || !managed.artifacts || !resolved || !resolved.workspace) {
    return null;
  }
  const spec = managed.artifacts[artifact.path];
  if (!spec || !spec.pathTemplate) {
    return null;
  }
  const buildVersion = resolved["build-version"] || "default";
  const buildDirKey = resolved["build-dir-key"] || "default";
  const templateExtras = {
    toolchainVersion: resolved["toolchain-version"] || null,
    example: resolved.example || null,
  };
  return resolveManagedPathTemplate(
    resolved.workspace,
    descriptor,
    spec.pathTemplate,
    buildVersion,
    buildDirKey,
    templateExtras
  );
}

function materializeRemoteCanonicalArtifacts(tool, descriptor, payload, resolved) {
  if (!payload || !payload.details || !Array.isArray(payload.details.artifacts)) {
    return payload;
  }
  const artifacts = payload.details.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || typeof artifact.location !== "string") {
      return artifact;
    }
    const localLocation = canonicalLocalArtifactPath(tool, descriptor, resolved, artifact);
    if (!localLocation) {
      return artifact;
    }
    return {
      ...artifact,
      remote_location: artifact.location,
      local_location: localLocation,
    };
  });
  return {
    ...payload,
    details: {
      ...payload.details,
      artifacts,
    },
  };
}

async function executeRemoteTopLevelToolCommand(command, tool, args, resolved, flags) {
  const ssh = parseSshTarget(resolved.ssh);
  const remoteRoot = resolved["sync-morpheus"]
    ? prepareRemoteMorpheusRuntime(resolved.workspace, ssh)
    : remoteRepoRoot();
  const remoteArgs = rewriteRemoteArgs(args, resolved);
  const pathFlags = pathFlagSet();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!pathFlags.has(token) || index + 1 >= args.length) {
      continue;
    }
    const localValue = args[index + 1];
    const remoteValue = remoteArgs[index + 1];
    if (!isRemoteManagedPath(localValue, resolved)) {
      syncRemoteInputPath(localValue, remoteValue, ssh, `${tool} ${token.slice(2)}`);
    }
    index += 1;
  }
  const morpheusArgs = [
    command,
    "--tool",
    tool,
    "--workspace",
    resolved.workspace,
    "--json",
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
    'cd "$remote_repo_root"',
    `${commandLine.replace(`"${remoteRoot}/bin/morpheus"`, '"$MORPHEUS_REMOTE_CMD"')}`,
  ].join("\n");
  const result = await runSshStreaming(ssh, script, {
    collectStdout: true,
    onStdoutLine(line) {
      if (!flags.json) {
        return;
      }
      try {
        const parsed = JSON.parse(String(line || "").trim());
        if (parsed && parsed.status === "stream") {
          writeStdoutLine(line);
        }
      } catch {
        // final pretty JSON is handled after collection
      }
    },
    onStderr(chunk) {
      if (!flags.json && chunk) {
        process.stderr.write(chunk);
      }
    }
  });
  const payload = parseLastJsonLine(result.stdout || "");
  if (result.exitCode !== 0 || !payload) {
    throw new Error((payload && payload.summary) || result.stderr || result.stdout || `failed to ${command} with tool ${tool}`);
  }
  return materializeRemoteCanonicalArtifacts(tool, readToolDescriptor(tool), payload, resolved);
}

function normalizeArtifacts(payload, command, resolved, descriptor) {
  if (!payload || !payload.details) {
    return payload;
  }
  if (Array.isArray(payload.details.artifacts)) {
    return payload;
  }
  const artifacts = [];
  if (payload.details.artifact && typeof payload.details.artifact === "object") {
    artifacts.push(payload.details.artifact);
  }
  if (command === "build" && descriptor) {
    const managed = localManaged(descriptor);
    const buildVersion = resolved && resolved["build-version"] ? resolved["build-version"] : null;
    const buildDirKey = resolved && resolved["build-dir-key"] ? resolved["build-dir-key"] : "default";
    const workspace = resolved && resolved.workspace ? resolved.workspace : null;
    const templateExtras = {
      toolchainVersion: resolved && resolved["toolchain-version"] ? resolved["toolchain-version"] : null,
      example: resolved && resolved.example ? resolved.example : null,
    };
    if (managed && managed.artifacts && workspace) {
      for (const [artifactPath, spec] of Object.entries(managed.artifacts)) {
        if (!spec || typeof spec !== "object" || !spec.pathTemplate) {
          continue;
        }
        if (artifacts.some((entry) => entry && entry.path === artifactPath)) {
          continue;
        }
        artifacts.push({
          path: artifactPath,
          location: resolveManagedPathTemplate(
            workspace,
            descriptor,
            spec.pathTemplate,
            buildVersion || "default",
            buildDirKey || "default",
            templateExtras
          ),
        });
      }
    }
  }
  if (typeof payload.details.source === "string" && payload.details.source) {
    if (!artifacts.some((entry) => entry && entry.path === "source-dir")) {
      artifacts.push({
        path: "source-dir",
        location: payload.details.source,
      });
    }
  }
  if (artifacts.length > 0) {
    return {
      ...payload,
      details: {
        ...payload.details,
        artifacts,
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
      mode: flags.mode || (descriptorSupportsRemote(descriptor) ? null : "local"),
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
  const templateExtras = {
    toolchainVersion: resolved["toolchain-version"] || null,
    example: resolved.example || null,
  };
  const spec = commandSpec(descriptor, command);
  const forwardSpec = forwardedFlagSpec(descriptor, command);
  const pathFlags = spec && spec.pathFlags ? spec.pathFlags : {};
  const flagAliases = spec && spec.flagAliases ? spec.flagAliases : {};
  const effectivePaths = {
    source: resolved.source || defaultSourceDir(workspace, tool, descriptor, buildVersion, buildDirKey, templateExtras),
    "build-version": buildVersion,
  };
  const optionalManagedPathResolvers = {
    "downloads-dir": () => resolved["downloads-dir"] || defaultDownloadsDir(workspace, tool, descriptor),
    "build-dir": () => resolved["build-dir"] || defaultBuildDir(workspace, descriptor, buildVersion, buildDirKey, templateExtras),
    "install-dir": () => resolved["install-dir"] || defaultInstallDir(workspace, descriptor, buildVersion, buildDirKey, templateExtras),
  };
  for (const [genericFlag, resolveValue] of Object.entries(optionalManagedPathResolvers)) {
    if (
      resolved[genericFlag] != null
      || Object.prototype.hasOwnProperty.call(pathFlags, genericFlag)
    ) {
      effectivePaths[genericFlag] = resolveValue();
    }
  }
  for (const [genericFlag, template] of Object.entries(pathFlags)) {
    if (effectivePaths[genericFlag]) {
      continue;
    }
      effectivePaths[genericFlag] = resolveManagedPathTemplate(
        workspace,
        descriptor,
        template,
        buildVersion,
        buildDirKey,
        templateExtras
      );
    }

  const args = ["--json", command];
  if (effectivePaths.source) {
    args.push("--source", effectivePaths.source);
  }
  if (buildVersion && (command !== "patch" || descriptor.name === "qemu")) {
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

  const defaultForwardedKeys = [
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
    "name",
    "target",
    "action",
    "kernel",
    "initrd",
    "append",
    "make-target",
  ];
  const forwardedKeys = Array.isArray(forwardSpec.scalar)
    ? forwardSpec.scalar
    : defaultForwardedKeys;
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
  const defaultRepeatableForwardedKeys = ["target-list", "configure-arg", "qemu-arg", "make-arg", "config-fragment", "env", "file", "filter", "kconfig", "rust-target"];
  const repeatableForwardedKeys = Array.isArray(forwardSpec.repeatable)
    ? forwardSpec.repeatable
    : defaultRepeatableForwardedKeys;
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
      await runToolStreaming(descriptor, args, { jsonMode: Boolean(resolved.json) }),
      `failed to ${command} with tool ${tool}`
    ), command, resolved, descriptor);

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
  const descriptor = readToolDescriptor(tool);
  const { flags: resolved } = applyConfigDefaults(
    {
      ...flags,
      json: Boolean(flags.json),
      mode: flags.mode || (descriptorSupportsRemote(descriptor) ? null : "local"),
      tool,
    },
    { allowGlobalRemote: Boolean(options.allowGlobalRemote), allowToolDefaults: true }
  );
  const toolCommand = command;
  const effective = resolveToolDependencies(resolved, toolCommand);
  if (command === "exec") {
    ensureNoWorkspaceRunConflict(tool, descriptor, effective);
  }
  const remoteEnabled = Boolean(effective.ssh && effective.workspace && effective.localWorkspace && effective.workspace !== effective.localWorkspace);
  const reserved = new Set(["tool", "json", "help", "workspace", "localWorkspace", "ssh", "remote", "remoteWorkspace", "remoteTarget", "mode"]);
  const args = [toolCommand, "--json"];
  for (const [key, rawValue] of Object.entries(effective)) {
    if (reserved.has(key)) {
      continue;
    }
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
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
  const workspaceForExec = effective.localWorkspace || effective.workspace;
  const legacyExecRunDir = command === "exec" && workspaceForExec
    ? path.join(workspaceForExec, "tmp", tool, "exec")
    : null;
  const managedRunDir = command === "exec" && workspaceForExec
    ? (
      defaultExecRunDir(workspaceForExec, tool, descriptor, {
        toolchainVersion: effective["toolchain-version"] || null,
        example: effective.example || null,
      })
      || legacyExecRunDir
    )
    : null;
  if (
    command === "exec"
    && workspaceForExec
    && managedRunDir
    && legacyExecRunDir
    && managedRunDir !== legacyExecRunDir
  ) {
    fs.rmSync(path.dirname(legacyExecRunDir), { recursive: true, force: true });
  }
  const workflowStepCwd = command === "exec" && fs.existsSync(path.join(process.cwd(), "step.json"))
    ? process.cwd()
    : null;
  const childCwd = workflowStepCwd || managedRunDir || process.cwd();

  const payload = remoteEnabled
    ? await executeRemoteTopLevelToolCommand(command, tool, args, effective, flags)
    : parseToolPayload(
      await runToolStreaming(descriptor, args, { jsonMode: Boolean(flags.json), env: process.env, cwd: childCwd }),
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
