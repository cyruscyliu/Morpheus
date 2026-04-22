// @ts-nocheck
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { registerManagedRun, registerManagedWorkspace } = require("./managed-state");
const { repoRoot } = require("./paths");
const { runManagedSel4 } = require("./sel4");

const TOOL = "microkit-sdk";

function nowIso() {
  return new Date().toISOString();
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
  return path.join(localToolWorkspace(workspace, tool), "runs", id);
}

function defaultManagedSource(workspace, version) {
  return path.join(localToolWorkspace(workspace, TOOL), "sdk", version ? `microkit-sdk-${version}` : "microkit-sdk");
}

function defaultManagedMicrokitSource(workspace, version) {
  const suffix = version ? `microkit-${version}` : "microkit";
  return path.join(localToolWorkspace(workspace, TOOL), "src", suffix);
}

function defaultMicrokitArchiveUrl(version) {
  return `https://github.com/seL4/microkit/archive/refs/tags/${version}.tar.gz`;
}

function looksLikeMicrokitSdk(sdkDir) {
  if (!sdkDir || !fs.existsSync(sdkDir)) {
    return false;
  }
  const microkitBin = path.join(sdkDir, "bin", "microkit");
  return fs.existsSync(microkitBin);
}

function microkitBuildMetaPath(sdkDir) {
  return path.join(sdkDir, ".morpheus-build.json");
}

function stableJsonFingerprint(value) {
  const encoded = JSON.stringify(value, Object.keys(value).sort());
  return crypto.createHash("sha256").update(encoded).digest("hex");
}

function loadBuildMeta(sdkDir) {
  const metaPath = microkitBuildMetaPath(sdkDir);
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function writeBuildMeta(sdkDir, meta) {
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.writeFileSync(microkitBuildMetaPath(sdkDir), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

function defaultArmGnuToolchainVersion() {
  return "12.2.rel1";
}

function defaultArmGnuToolchainArchiveUrl(version) {
  return `https://developer.arm.com/-/media/Files/downloads/gnu/${version}/binrel/arm-gnu-toolchain-${version}-x86_64-aarch64-none-elf.tar.xz`;
}

function defaultArmGnuToolchainRoot(workspace, version) {
  return path.join(localToolWorkspace(workspace, TOOL), "deps", `arm-gnu-toolchain-${version}`);
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

function loadMicrokitConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools[TOOL] ? value.tools[TOOL] : {};
  return {
    baseDir: configDir(config.path),
    value: {
      ...item,
      microkitVersion: item["microkit-version"] || item.microkitVersion || item.version || null,
      archiveUrl: item["archive-url"] || item.archiveUrl || null,
      microkitArchiveUrl: item["microkit-archive-url"] || item.microkitArchiveUrl || null,
      microkitDir: item["microkit-dir"] || item.microkitDir || null,
      boards: item.boards || null,
      configs: item.configs || null,
      toolchainDir: item["toolchain-dir"] || item.toolchainDir || null,
      toolchainVersion: item["toolchain-version"] || item.toolchainVersion || null,
      toolchainArchiveUrl: item["toolchain-archive-url"] || item.toolchainArchiveUrl || null,
      toolchainPrefixAarch64: item["toolchain-prefix-aarch64"] || item.toolchainPrefixAarch64 || null,
    }
  };
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

function runTool(args) {
  return spawnSync(process.execPath, [
    path.join(repoRoot(), "tools", TOOL, "dist", "index.js"),
    ...args
  ], {
    encoding: "utf8",
    cwd: process.cwd()
  });
}

function runBuildSdk(args, options = {}) {
  return spawnSync(process.execPath, [
    path.join(repoRoot(), "scripts", "microkit", "build-sdk.mjs"),
    ...args
  ], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: options.env || process.env
  });
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function removeDirectory(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function extractArchive(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const extracted = runCommand("tar", ["-xf", archivePath, "-C", destination], undefined);
  if (extracted.status !== 0) {
    throw new Error(extracted.stderr || extracted.stdout || `Failed to extract ${archivePath}`);
  }
}

function ensureFetchedMicrokitSourceTree({ workspace, source, microkitVersion, archiveUrl }) {
  const buildScript = path.join(source, "build_sdk.py");
  if (fs.existsSync(buildScript)) {
    return {
      source,
      fetched: false,
      archive: null,
      archive_url: archiveUrl,
    };
  }

  const archiveUrlValue = archiveUrl || (microkitVersion ? defaultMicrokitArchiveUrl(microkitVersion) : null);
  if (!archiveUrlValue) {
    throw new Error(`Missing Microkit source tree (and no archive URL configured): ${source}`);
  }

  const toolRoot = localToolWorkspace(workspace, TOOL);
  const downloadsDir = path.join(toolRoot, "downloads");
  const archiveName = path.basename(new URL(archiveUrlValue).pathname);
  const archivePath = path.join(downloadsDir, archiveName);
  const extractRoot = path.join(downloadsDir, ".extract");

  fs.mkdirSync(downloadsDir, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    const download = runCommand("curl", ["-fsSL", archiveUrlValue, "-o", archivePath], undefined);
    if (download.status !== 0) {
      throw new Error(download.stderr || download.stdout || `Failed to download Microkit source: ${archiveUrlValue}`);
    }
  }

  removeDirectory(extractRoot);
  extractArchive(archivePath, extractRoot);

  const entries = fs.readdirSync(extractRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) {
    throw new Error(`Expected one extracted source directory in ${extractRoot}`);
  }

  removeDirectory(source);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.renameSync(path.join(extractRoot, entries[0].name), source);
  removeDirectory(extractRoot);

  if (!fs.existsSync(path.join(source, "build_sdk.py"))) {
    throw new Error(`Fetched Microkit source is missing build_sdk.py at: ${path.join(source, "build_sdk.py")}`);
  }

  return {
    source,
    fetched: true,
    archive: archivePath,
    archive_url: archiveUrlValue,
  };
}

function ensureArmGnuToolchain({ workspace, toolchainDir, toolchainVersion, toolchainArchiveUrl }) {
  if (toolchainDir) {
    const resolved = toolchainDir;
    const gcc = path.join(resolved, "bin", "aarch64-none-elf-gcc");
    if (!fs.existsSync(gcc)) {
      throw new Error(`toolchain-dir is missing expected aarch64-none-elf toolchain: ${gcc}`);
    }
    return {
      root: resolved,
      binDir: path.join(resolved, "bin"),
      fetched: false,
      archive: null,
      archive_url: null,
      version: toolchainVersion || null,
    };
  }

  const version = toolchainVersion || defaultArmGnuToolchainVersion();
  const archiveUrlValue = toolchainArchiveUrl || defaultArmGnuToolchainArchiveUrl(version);
  const toolRoot = localToolWorkspace(workspace, TOOL);
  const downloadsDir = path.join(toolRoot, "downloads");
  const archiveName = path.basename(new URL(archiveUrlValue).pathname);
  const archivePath = path.join(downloadsDir, archiveName);
  const extractRoot = path.join(downloadsDir, ".extract-toolchain");
  const destination = defaultArmGnuToolchainRoot(workspace, version);

  const gcc = path.join(destination, "bin", "aarch64-none-elf-gcc");
  if (fs.existsSync(gcc)) {
    return {
      root: destination,
      binDir: path.join(destination, "bin"),
      fetched: false,
      archive: archivePath,
      archive_url: archiveUrlValue,
      version,
    };
  }

  fs.mkdirSync(downloadsDir, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    const download = runCommand("curl", ["-fsSL", archiveUrlValue, "-o", archivePath], undefined);
    if (download.status !== 0) {
      throw new Error(download.stderr || download.stdout || `Failed to download toolchain: ${archiveUrlValue}`);
    }
  }

  removeDirectory(extractRoot);
  extractArchive(archivePath, extractRoot);
  const entries = fs.readdirSync(extractRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) {
    throw new Error(`Expected one extracted toolchain directory in ${extractRoot}`);
  }

  removeDirectory(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(path.join(extractRoot, entries[0].name), destination);
  removeDirectory(extractRoot);

  if (!fs.existsSync(gcc)) {
    throw new Error(`Extracted toolchain is missing expected gcc: ${gcc}`);
  }

  return {
    root: destination,
    binDir: path.join(destination, "bin"),
    fetched: true,
    archive: archivePath,
    archive_url: archiveUrlValue,
    version,
  };
}

function pythonVenvRoot(workspace) {
  return path.join(localToolWorkspace(workspace, TOOL), "deps", "python");
}

function pythonVenvBinDir(venvRoot) {
  return path.join(venvRoot, "bin");
}

function pythonVenvPython(venvRoot) {
  return path.join(pythonVenvBinDir(venvRoot), "python3");
}

function ensurePythonModule(python, module) {
  const result = runCommand(python, ["-c", `import ${module}`], undefined);
  return result.status === 0;
}

function ensurePythonVenvWithDeps(workspace) {
  const venvRoot = pythonVenvRoot(workspace);
  const python = pythonVenvPython(venvRoot);
  if (!fs.existsSync(python)) {
    fs.mkdirSync(path.dirname(venvRoot), { recursive: true });
    const created = runCommand("python3", ["-m", "venv", venvRoot], undefined);
    if (created.status !== 0) {
      throw new Error(created.stderr || created.stdout || `failed to create python venv at ${venvRoot}`);
    }
  }

  const missing = [];
  if (!ensurePythonModule(python, "pyfdt.pyfdt")) {
    missing.push("pyfdt");
  }
  if (!ensurePythonModule(python, "yaml")) {
    missing.push("pyyaml");
  }
  if (!ensurePythonModule(python, "jinja2")) {
    missing.push("jinja2");
  }
  if (!ensurePythonModule(python, "lxml.etree")) {
    missing.push("lxml");
  }
  if (!ensurePythonModule(python, "ply.yacc")) {
    missing.push("ply");
  }
  if (!ensurePythonModule(python, "jsonschema")) {
    missing.push("jsonschema");
  }

  if (missing.length > 0) {
    const pip = runCommand(python, ["-m", "pip", "install", "--upgrade", "pip"], undefined);
    if (pip.status !== 0) {
      throw new Error(pip.stderr || pip.stdout || "failed to upgrade pip in venv");
    }
    const installed = runCommand(python, ["-m", "pip", "install", ...missing], undefined);
    if (installed.status !== 0) {
      throw new Error(installed.stderr || installed.stdout || `failed to install python deps in venv: ${missing.join(", ")}`);
    }
  }

  return {
    root: venvRoot,
    python,
    binDir: pythonVenvBinDir(venvRoot),
  };
}

function parseRunOptions(flags) {
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("run requires --workspace DIR or a workspace root in morpheus.yaml");
  }
  const { baseDir, value } = loadMicrokitConfig();
  const placementMode = flags.mode || value.mode || "local";
  if (placementMode !== "local") {
    throw new Error("microkit-sdk supports only --mode local");
  }

  const options = {
    id: generateRunId(),
    workspace,
    mode: placementMode,
    path: flags.path
      ? path.resolve(process.cwd(), flags.path)
      : resolveLocalPath(baseDir, value.path || value.source),
    microkitVersion: flags["microkit-version"] || value.microkitVersion || null,
    archiveUrl: flags["archive-url"] || value.archiveUrl || null,
    microkitArchiveUrl: flags["microkit-archive-url"] || value.microkitArchiveUrl || null,
    microkitDir: flags["microkit-dir"]
      ? path.resolve(process.cwd(), flags["microkit-dir"])
      : resolveLocalPath(baseDir, value.microkitDir),
    boards: flags.boards || value.boards || null,
    configs: flags.configs || value.configs || null,
    toolchainDir: flags["toolchain-dir"]
      ? path.resolve(process.cwd(), flags["toolchain-dir"])
      : resolveLocalPath(baseDir, value.toolchainDir),
    toolchainVersion: flags["toolchain-version"] || value.toolchainVersion || null,
    toolchainArchiveUrl: flags["toolchain-archive-url"] || value.toolchainArchiveUrl || null,
    toolchainPrefixAarch64: flags["toolchain-prefix-aarch64"] || value.toolchainPrefixAarch64 || "aarch64-none-elf",
    reuseBuildDir: Boolean(flags["reuse-build-dir"] ?? value.reuseBuildDir),
    buildDirKey: flags["build-dir-key"] || value.buildDirKey || "default",
  };

  if (options.reuseBuildDir) {
    options.path = path.join(localToolWorkspace(workspace, TOOL), "builds", options.buildDirKey, "sdk");
  } else if (!options.path && options.microkitVersion) {
    options.path = defaultManagedSource(workspace, options.microkitVersion);
  }

  if (!options.path) {
    throw new Error("microkit-sdk requires tools.microkit-sdk.path or tools.microkit-sdk.microkit-version in morpheus.yaml");
  }

  const sdkPresent = looksLikeMicrokitSdk(options.path);
  const explicitBuildInputs = Boolean(options.microkitDir || options.microkitArchiveUrl || options.archiveUrl);

  // Treat `reuse-build-dir` as an explicit opt-in to "managed build semantics".
  // Otherwise, prefer "register an existing SDK directory" when it looks valid.
  options.buildIntent = Boolean(options.reuseBuildDir || !sdkPresent || explicitBuildInputs);
  options.provisioning = options.buildIntent ? "build" : "path";

  if (
    options.provisioning === "build" &&
    !options.archiveUrl &&
    !options.microkitDir &&
    !options.microkitVersion &&
    !options.microkitArchiveUrl
  ) {
    throw new Error(
      [
        "microkit-sdk build requires a source input.",
        "Provide one of:",
        "- tools.microkit-sdk.microkit-version: infer a default Microkit source archive URL and build the SDK, or",
        "- tools.microkit-sdk.microkit-archive-url: archive URL for the Microkit source tree, or",
        "- tools.microkit-sdk.microkit-dir: a local Microkit checkout containing build_sdk.py, or",
        "- tools.microkit-sdk.archive-url: an archive URL for a prebuilt SDK directory, or",
        "- tools.microkit-sdk.path: an existing SDK directory to register.",
        "",
        `Resolved SDK path was: ${options.path}`,
      ].join("\n")
    );
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

function localManifest(options, runDir, manifestPath, logFile, inspected) {
  const artifacts = [
    {
      path: "sdk-dir",
      location: inspected.details.directory.path
    }
  ];
  if (options.toolchainResolved && options.toolchainResolved.root) {
    artifacts.push({
      path: "toolchain-dir",
      location: options.toolchainResolved.root
    });
  }
  return {
    schemaVersion: 1,
    id: options.id,
    tool: TOOL,
    mode: "local",
    provisioning: "path",
    command: "run",
    status: "success",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    buildDirKey: options.reuseBuildDir ? options.buildDirKey : null,
    runDir,
    outputDir: runDir,
    logFile,
    manifest: manifestPath,
    directory: inspected.details.directory,
    artifacts,
    transport: null,
    exitCode: 0
  };
}

function buildManifest(options, runDir, manifestPath, fetched) {
  const artifacts = [
    {
      path: "sdk-dir",
      location: fetched.details.directory.path
    }
  ];
  if (options.toolchainResolved && options.toolchainResolved.root) {
    artifacts.push({
      path: "toolchain-dir",
      location: options.toolchainResolved.root
    });
  }
  return {
    schemaVersion: 1,
    id: options.id,
    tool: TOOL,
    mode: "local",
    provisioning: "build",
    command: "run",
    status: "success",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    source: fetched.details.source,
    buildDirKey: options.reuseBuildDir ? options.buildDirKey : null,
    microkitVersion: options.microkitVersion || fetched.details.microkit_version || null,
    archive: fetched.details.archive || null,
    archiveUrl: fetched.details.archive_url || options.archiveUrl || null,
    runDir,
    outputDir: fetched.details.source,
    logFile: path.join(runDir, "stdout.log"),
    manifest: manifestPath,
    directory: fetched.details.directory,
    toolchain: options.toolchainResolved || null,
    artifacts,
    transport: null,
    exitCode: 0
  };
}

function runManagedMicrokitSdk(flags) {
  const options = parseRunOptions(flags);
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
    const inspected = parseJsonResult(
      runTool(["--json", "inspect", "--path", options.path]),
      "failed to inspect Microkit SDK directory"
    );
    fs.writeFileSync(logFile, `${inspected.details.directory.version || ""}\n`, "utf8");
    manifest = localManifest(options, runDir, manifestPath, logFile, inspected);
  } else {
    let sourceBuild = null;
    let inspected = null;

    const sdkPresent = looksLikeMicrokitSdk(options.path);
    const desiredMicrokitDir =
      options.microkitDir ||
      ((options.microkitVersion || options.microkitArchiveUrl) ? defaultManagedMicrokitSource(options.workspace, options.microkitVersion) : null);

    if (desiredMicrokitDir) {
      options.toolchainResolved = ensureArmGnuToolchain({
        workspace: options.workspace,
        toolchainDir: options.toolchainDir,
        toolchainVersion: options.toolchainVersion,
        toolchainArchiveUrl: options.toolchainArchiveUrl,
      });
      const sel4 = runManagedSel4({ workspace: options.workspace, mode: "local" });
      options.sel4Resolved = {
        run_id: sel4.details.id,
        source_dir: sel4.details.manifest.directory.path,
        patches: sel4.details.manifest.patches || null,
      };

      const sel4Dir = options.sel4Resolved ? options.sel4Resolved.source_dir : null;
      if (!sel4Dir) {
        throw new Error("failed to resolve seL4 dependency for microkit-sdk build");
      }

      const buildInputs = {
        microkit_version: options.microkitVersion || null,
        microkit_source: desiredMicrokitDir,
        sel4_source: sel4Dir,
        sel4_patches_fingerprint:
          options.sel4Resolved && options.sel4Resolved.patches ? options.sel4Resolved.patches.fingerprint : null,
        toolchain_version: options.toolchainResolved ? options.toolchainResolved.version : null,
        toolchain_archive_url: options.toolchainResolved ? options.toolchainResolved.archive_url : null,
        toolchain_root: options.toolchainResolved ? options.toolchainResolved.root : null,
        boards: options.boards || null,
        configs: options.configs || null,
      };
      const fingerprint = stableJsonFingerprint(buildInputs);
      const existingMeta = loadBuildMeta(options.path);

      if (sdkPresent && !existingMeta) {
        writeBuildMeta(options.path, {
          schemaVersion: 1,
          createdAt: nowIso(),
          fingerprint,
          inputs: buildInputs,
          adopted: true,
        });
        const inspected = parseJsonResult(
          runTool(["--json", "inspect", "--path", options.path]),
          "failed to inspect adopted Microkit SDK directory"
        );
        fs.writeFileSync(logFile, `adopted-existing-sdk: true\nfingerprint: ${fingerprint}\n`, "utf8");
        const synthesized = { details: { source: options.path, microkit_version: options.microkitVersion || null, archive: null, archive_url: null, directory: inspected.details.directory } };
        manifest = buildManifest(options, runDir, manifestPath, synthesized);
        manifest.skippedBuild = true;
        manifest.buildInputs = buildInputs;
        manifest.sel4 = options.sel4Resolved || null;
        return finalizeRun(options, manifest, runDir, manifestPath, logFile);
      }

      if (sdkPresent && existingMeta && existingMeta.fingerprint === fingerprint) {
        const inspected = parseJsonResult(
          runTool(["--json", "inspect", "--path", options.path]),
          "failed to inspect cached Microkit SDK directory"
        );
        fs.writeFileSync(logFile, `cached-sdk: true\nfingerprint: ${fingerprint}\n`, "utf8");
        const synthesized = { details: { source: options.path, microkit_version: options.microkitVersion || null, archive: null, archive_url: null, directory: inspected.details.directory } };
        manifest = buildManifest(options, runDir, manifestPath, synthesized);
        manifest.skippedBuild = true;
        manifest.buildInputs = buildInputs;
        manifest.sel4 = options.sel4Resolved || null;
        return finalizeRun(options, manifest, runDir, manifestPath, logFile);
      }

      // Need a build: ensure we have a Microkit source tree available.
      options.microkitDir = desiredMicrokitDir;
      const fetched = ensureFetchedMicrokitSourceTree({
        workspace: options.workspace,
        source: options.microkitDir,
        microkitVersion: options.microkitVersion,
        archiveUrl: options.microkitArchiveUrl,
      });
      sourceBuild = { details: { microkit_source: fetched.source, microkit_archive: fetched.archive, microkit_archive_url: fetched.archive_url } };

      const buildSdkScript = path.join(options.microkitDir, "build_sdk.py");
      if (!fs.existsSync(buildSdkScript)) {
        throw new Error(
          [
            `microkit-sdk source builds require tools.microkit-sdk.microkit-dir to contain build_sdk.py: ${buildSdkScript}`,
            "Either:",
            "- set tools.microkit-sdk.microkit-dir to a Microkit checkout that contains build_sdk.py, and configure tools.sel4 so Morpheus can build the seL4 dependency, or",
            "- remove tools.microkit-sdk.microkit-dir and provide tools.microkit-sdk.archive-url, or",
            "- set tools.microkit-sdk.path to an existing SDK directory."
          ].join("\n")
        );
      }
      const python = ensurePythonVenvWithDeps(options.workspace);
      const env = {
        ...process.env,
        PATH: `${python.binDir}${path.delimiter}${process.env.PATH || ""}`,
      };
      sourceBuild = parseJsonResult(
        runBuildSdk([
          "--json",
          "--microkit-dir",
          options.microkitDir,
          "--sel4-dir",
          sel4Dir,
          "--sdk-out",
          options.path,
          ...(options.boards ? ["--boards", options.boards] : []),
          ...(options.configs ? ["--configs", options.configs] : []),
          "--toolchain-bin-dir",
          options.toolchainResolved.binDir,
          "--toolchain-prefix-aarch64",
          options.toolchainPrefixAarch64,
          "--force"
        ], { env }),
        "failed to build Microkit SDK from source"
      );
      inspected = parseJsonResult(
        runTool(["--json", "inspect", "--path", options.path]),
        "failed to inspect built Microkit SDK directory"
      );

      fs.writeFileSync(
        logFile,
        [
          "source-build: true",
          sourceBuild.details && sourceBuild.details.build_log ? `build_log: ${sourceBuild.details.build_log}` : null,
          inspected.details && inspected.details.directory && inspected.details.directory.version ? `version: ${inspected.details.directory.version}` : null,
          ""
        ].filter(Boolean).join("\n"),
        "utf8"
      );

      const synthesized = {
        details: {
          source: options.path,
          microkit_version: options.microkitVersion || null,
          archive: null,
          archive_url: null,
          directory: inspected.details.directory
        }
      };
      manifest = buildManifest(options, runDir, manifestPath, synthesized);
      manifest.sourceBuild = true;
      manifest.microkitDir = options.microkitDir;
      manifest.sel4Dir = sel4Dir;
      manifest.buildLog = sourceBuild.details ? sourceBuild.details.build_log : null;
      manifest.buildInputs = buildInputs;
      manifest.sel4 = options.sel4Resolved || null;
      writeBuildMeta(options.path, {
        schemaVersion: 1,
        createdAt: nowIso(),
        fingerprint,
        inputs: buildInputs,
        adopted: false,
      });
    } else {
      const fetched = parseJsonResult(
        runTool([
          "--json",
          "build",
          "--source",
          options.path,
          ...(options.microkitVersion ? ["--microkit-version", options.microkitVersion] : []),
          ...(options.archiveUrl ? ["--archive-url", options.archiveUrl] : [])
        ]),
        "failed to build Microkit SDK directory"
      );
      fs.writeFileSync(logFile, `${fetched.details.directory.version || ""}\n`, "utf8");
      manifest = buildManifest(options, runDir, manifestPath, fetched);
    }
  }

  return finalizeRun(options, manifest, runDir, manifestPath, logFile);
}

function finalizeRun(options, manifest, runDir, manifestPath, logFile) {
  writeJson(manifestPath, manifest);
  registerManifest(manifest);

  const actualProvisioning = manifest.provisioning;
  const summary =
    actualProvisioning === "path"
      ? "registered managed Microkit SDK directory"
      : manifest.skippedBuild
        ? "reused managed Microkit SDK directory"
        : "built and registered managed Microkit SDK directory";

  return {
    command: "run",
    status: "success",
    exit_code: 0,
    summary,
    details: {
      id: manifest.id,
      tool: TOOL,
      mode: manifest.mode,
      provisioning: actualProvisioning,
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
  runManagedMicrokitSdk
};
