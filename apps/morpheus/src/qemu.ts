// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { registerManagedRun, registerManagedWorkspace } = require("./managed-state");
const { resolveManagedRunDir } = require("./run-layout");
const { repoRoot } = require("./paths");
const { readManagedToolContract, renderManagedTemplate } = require("./tool-descriptor");

const TOOL = "qemu";
const MANAGED = readManagedToolContract(TOOL);

function nowIso() {
  return new Date().toISOString();
}

function generateRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 10);
  return `${TOOL}-${stamp}-${random}`;
}

function localRunDir(workspace, tool, id) {
  return resolveManagedRunDir(workspace, id);
}

function localWorkspaceRoot(workspace) {
  return path.resolve(process.cwd(), workspace);
}

function contractLocal() {
  if (!MANAGED || !MANAGED.local) {
    throw new Error("missing managed contract for qemu");
  }
  return MANAGED.local;
}

function contractWorkspacePath(workspace, template, values) {
  return path.join(
    localWorkspaceRoot(workspace),
    renderManagedTemplate(template, values)
  );
}

function defaultManagedSource(workspace, version) {
  return contractWorkspacePath(
    workspace,
    contractLocal().sourceTemplate,
    { qemuVersion: version }
  );
}

function managedDownloadsDir(workspace) {
  return path.join(localWorkspaceRoot(workspace), contractLocal().downloadsDir);
}

function managedBuildDir(workspace, buildDirKey) {
  return contractWorkspacePath(
    workspace,
    contractLocal().buildDirTemplate,
    { buildDirKey }
  );
}

function managedInstallDir(workspace, buildDirKey) {
  return contractWorkspacePath(
    workspace,
    contractLocal().installDirTemplate,
    { buildDirKey }
  );
}

function localManifestPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "manifest.json");
}

function localLogPath(workspace, tool, id) {
  return path.join(localRunDir(workspace, tool, id), "stdout.log");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadQemuConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools.qemu ? value.tools.qemu : {};
  return {
    baseDir: configDir(config.path),
    value: {
      ...item,
      qemuVersion: item["qemu-version"] || item.qemuVersion || null,
      archiveUrl: item["archive-url"] || item.archiveUrl || null,
      targetList: Array.isArray(item["target-list"])
        ? [...item["target-list"]]
        : Array.isArray(item.targetList)
          ? [...item.targetList]
          : [],
      configureArgs: Array.isArray(item["configure-args"])
        ? [...item["configure-args"]]
        : Array.isArray(item.configureArgs)
          ? [...item.configureArgs]
          : [],
    }
  };
}

function parseToolPayload(result, message) {
  const payload = result && result.toolPayload ? result.toolPayload : null;
  if (result.status !== 0 || !payload || payload.status === "error") {
    throw new Error((payload && payload.summary) || result.stderr || message);
  }
  return payload;
}

async function runQemuTool(args, options = {}) {
  return await new Promise((resolve, reject) => {
    const logFile = options.logFile || null;
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, "", "utf8");
      }
    }

    const child = spawn(process.execPath, [
      path.join(repoRoot(), "tools", "qemu", "dist", "index.js"),
      ...args,
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrText = "";
    let finalPayload = null;

    const appendLogLine = (line) => {
      if (!logFile || typeof line !== "string") {
        return;
      }
      fs.appendFileSync(logFile, `${line}\n`, "utf8");
    };

    const appendLogChunk = (chunk) => {
      if (!logFile || !chunk) {
        return;
      }
      fs.appendFileSync(logFile, chunk, "utf8");
    };

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
        appendLogLine(line);
        if (!options.jsonMode) {
          process.stderr.write(`${line}\n`);
        }
        return;
      }

      if (
        parsed
        && parsed.status === "stream"
        && parsed.details
        && parsed.details.event === "log"
      ) {
        if (typeof parsed.details.chunk === "string") {
          appendLogChunk(parsed.details.chunk);
          if (options.jsonMode) {
            fs.writeSync(1, `${JSON.stringify(parsed)}\n`);
          } else {
            process.stderr.write(parsed.details.chunk);
          }
          return;
        }
        if (typeof parsed.details.line === "string") {
          appendLogLine(parsed.details.line);
          if (options.jsonMode) {
            fs.writeSync(1, `${JSON.stringify(parsed)}\n`);
          } else {
            process.stderr.write(`${parsed.details.line}\n`);
          }
          return;
        }
      }

      finalPayload = parsed;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        handleStdoutLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrText += chunk;
      if (logFile) {
        fs.appendFileSync(logFile, chunk, "utf8");
      }
      if (!options.jsonMode) {
        process.stderr.write(chunk);
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        handleStdoutLine(stdoutBuffer);
      }
      resolve({
        status: typeof code === "number" ? code : 1,
        stderr: stderrText,
        toolPayload: finalPayload,
      });
    });
  });
}

function buildKeyFromFlags(flags) {
  return flags["build-dir-key"] || "default";
}

function preferredRepeatableFlag(flags, key, fallback) {
  if (Array.isArray(flags[key])) {
    return flags[key].length > 0 ? [...flags[key]] : [...fallback];
  }
  return flags[key] || [...fallback];
}

function parseRunOptions(flags, command = "run") {
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("run requires --workspace DIR or a workspace root in morpheus.yaml");
  }
  const { baseDir, value } = loadQemuConfig();
  const placementMode = flags.mode || value.mode || "local";

  const options = {
    id: generateRunId(),
    workspace,
    command,
    mode: placementMode,
    executable: flags.path
      ? path.resolve(process.cwd(), flags.path)
      : resolveLocalPath(baseDir, value.path || value.executable),
    qemuVersion: flags["qemu-version"] || value.qemuVersion || null,
    archiveUrl: flags["archive-url"] || value.archiveUrl || null,
    source: flags.source
      ? path.resolve(process.cwd(), flags.source)
      : resolveLocalPath(baseDir, value.source),
    configureArgs: preferredRepeatableFlag(flags, "configure-arg", value.configureArgs || []),
    targetList: preferredRepeatableFlag(flags, "target-list", value.targetList || []),
    buildDirKey: buildKeyFromFlags(flags),
    kernel: flags.kernel ? path.resolve(process.cwd(), flags.kernel) : null,
    initrd: flags.initrd ? path.resolve(process.cwd(), flags.initrd) : null,
    runDir: flags["run-dir"] ? path.resolve(process.cwd(), flags["run-dir"]) : null,
    qemuArgs: Array.isArray(flags["qemu-arg"]) ? [...flags["qemu-arg"]] : [],
    append: flags.append ? String(flags.append) : "",
    detach: Boolean(flags.detach),
  };

  options.runtimeRequested = command === "run";

  if (!options.source && options.qemuVersion) {
    options.source = defaultManagedSource(workspace, options.qemuVersion);
  }

  const hasExecutable = Boolean(options.executable && fs.existsSync(options.executable));
  options.provisioning = hasExecutable ? "path" : "build";

  if (options.provisioning === "path" && !options.executable) {
    throw new Error("qemu requires --path PATH or tools.qemu.path in morpheus.yaml");
  }

  if (options.provisioning === "build") {
    const sourceExists = Boolean(options.source && fs.existsSync(options.source));
    if (!options.qemuVersion && !options.archiveUrl && !sourceExists) {
      throw new Error("qemu build requires tools.qemu.qemu-version, tools.qemu.archive-url, or an existing tools.qemu.source directory");
    }
    if (!options.source) {
      throw new Error("qemu build requires tools.qemu.source or tools.qemu.qemu-version in morpheus.yaml");
    }
  }

  return options;
}

function registerManifest(manifest) {
  registerManagedRun({
    id: manifest.id,
    tool: manifest.tool,
    mode: manifest.mode,
    workspace: path.resolve(process.cwd(), manifest.workspace),
    ssh: null,
    status: manifest.status,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    manifest: manifest.manifest,
    logFile: manifest.logFile,
    runDir: manifest.runDir,
    outputDir: manifest.outputDir,
    artifacts: manifest.artifacts
  });
}

function localExecutableManifest(options, runDir, manifestPath, logFile, inspected) {
  const artifactPath = contractLocal().artifactPath;
  return {
    schemaVersion: 1,
    id: options.id,
    tool: TOOL,
    mode: "local",
    provisioning: "path",
    command: options.command,
    status: "success",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    runDir,
    outputDir: runDir,
    logFile,
    manifest: manifestPath,
    executable: inspected.details.executable,
    artifacts: [
      {
        path: artifactPath,
        location: inspected.details.executable.path
      }
    ],
    transport: null,
    exitCode: 0
  };
}

function buildModeManifest(options, runDir, manifestPath, logFile, result) {
  const artifactPath = contractLocal().artifactPath;
  return {
    schemaVersion: 1,
    id: options.id,
    tool: TOOL,
    mode: "local",
    provisioning: "build",
    command: options.command,
    status: "success",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    source: options.source,
    qemuVersion: options.qemuVersion || result.details.qemu_version || null,
    archive: result.details.archive || null,
    archiveUrl: result.details.archive_url || options.archiveUrl || null,
    stagedSource: result.details.staged_source || null,
    buildDirKey: options.buildDirKey,
    buildDir: result.details.build_dir,
    installDir: result.details.install_dir,
    runDir,
    outputDir: result.details.install_dir,
    logFile,
    sourceLogFile: result.details.log_file || null,
    manifest: manifestPath,
    executable: result.details.executable,
    artifacts: [
      {
        path: artifactPath,
        location: result.details.executable.path
      }
    ],
    targetList: result.details.target_list || [],
    configureArgs: result.details.configure_args || [],
    transport: null,
    exitCode: 0
  };
}

async function runManagedQemu(flags) {
  const options = parseRunOptions(flags, flags.__command || "run");
  registerManagedWorkspace({
    mode: "local",
    root: path.resolve(process.cwd(), options.workspace)
  });
  const runDir = localRunDir(options.workspace, TOOL, options.id);
  const manifestPath = localManifestPath(options.workspace, TOOL, options.id);
  const logFile = localLogPath(options.workspace, TOOL, options.id);
  fs.mkdirSync(runDir, { recursive: true });

  let manifest;
  if (options.provisioning === "path") {
    const inspected = parseToolPayload(
      await runQemuTool(["--json", "inspect", "--path", options.executable], {
        logFile,
        jsonMode: Boolean(flags.json),
      }),
      "failed to inspect QEMU executable"
    );
    fs.writeFileSync(logFile, `${inspected.details.executable.version || ""}\n`, "utf8");
    manifest = localExecutableManifest(options, runDir, manifestPath, logFile, inspected);
  } else {
    const buildDir = managedBuildDir(options.workspace, options.buildDirKey);
    const installDir = managedInstallDir(options.workspace, options.buildDirKey);
    const downloadsDir = managedDownloadsDir(options.workspace);
    const args = [
      "--json",
      "build",
      "--source",
      options.source,
      ...(options.qemuVersion ? ["--qemu-version", options.qemuVersion] : []),
      ...(options.archiveUrl ? ["--archive-url", options.archiveUrl] : []),
      "--downloads-dir",
      downloadsDir,
      "--build-dir",
      buildDir,
      "--install-dir",
      installDir,
      ...(options.targetList || []).flatMap((item) => ["--target-list", item]),
      ...(options.configureArgs || []).flatMap((item) => ["--configure-arg", item])
    ];
    const built = parseToolPayload(
      await runQemuTool(args, {
        logFile,
        jsonMode: Boolean(flags.json),
      }),
      "failed to build QEMU executable"
    );
    manifest = buildModeManifest(options, runDir, manifestPath, logFile, built);
  }

  if (options.runtimeRequested) {
    if (!options.kernel || !options.initrd) {
      throw new Error("qemu run requires --kernel PATH and --initrd PATH");
    }
    const executablePath = manifest.artifacts[0] && manifest.artifacts[0].location
      ? manifest.artifacts[0].location
      : options.executable;
    const runtimeRunDir = options.runDir || path.join(runDir, "runtime");
    const runtime = parseToolPayload(
      await runQemuTool([
        "--json",
        "run",
        "--path",
        executablePath,
        "--kernel",
        options.kernel,
        "--initrd",
        options.initrd,
        "--run-dir",
        runtimeRunDir,
        ...(options.append ? ["--append", options.append] : []),
        ...(options.detach ? ["--detach"] : []),
        ...(options.qemuArgs || []).flatMap((item) => ["--qemu-arg", item]),
      ], {
        logFile,
        jsonMode: Boolean(flags.json),
      }),
      "failed to start local QEMU runtime"
    );
    writeJson(manifestPath, {
      ...manifest,
      command: "run",
      runtime: runtime.details && runtime.details.manifest ? runtime.details.manifest : runtime.details || null,
      updatedAt: nowIso(),
    });
    registerManifest(readJson(manifestPath));
    return {
      command: "run",
      status: runtime.status || "success",
      exit_code: runtime.exit_code || 0,
      summary: runtime.summary || "started managed qemu runtime",
      details: {
        id: manifest.id,
        tool: TOOL,
        mode: manifest.mode,
        provisioning: manifest.provisioning,
        workspace: options.workspace,
        run_dir: runDir,
        manifest: readJson(manifestPath),
        log_file: logFile,
        output_dir: manifest.outputDir,
        runtime: runtime.details || null,
        artifacts: manifest.artifacts,
      }
    };
  }

  writeJson(manifestPath, manifest);
  registerManifest(manifest);

  return {
    command: options.command,
    status: "success",
    exit_code: 0,
    summary: options.provisioning === "path"
      ? "registered managed qemu executable"
      : "built and registered managed qemu executable",
    details: {
      id: manifest.id,
      tool: TOOL,
      mode: manifest.mode,
      provisioning: manifest.provisioning,
      workspace: options.workspace,
      run_dir: runDir,
      manifest,
      log_file: logFile,
      output_dir: manifest.outputDir,
      artifacts: manifest.artifacts
    }
  };
}

module.exports = {
  runManagedQemu
};
