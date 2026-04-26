// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { registerManagedRun, registerManagedWorkspace } = require("./managed-state");
const { resolveManagedRunDir } = require("./run-layout");
const { repoRoot } = require("./paths");
const { runStreamingExec } = require("./streaming-exec");

const TOOL = "llbic";

function nowIso() {
  return new Date().toISOString();
}

function generateRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 10);
  return `${TOOL}-${stamp}-${random}`;
}

function localRunDir(workspace, id) {
  return resolveManagedRunDir(workspace, id);
}

function localManifestPath(workspace, id) {
  return path.join(localRunDir(workspace, id), "manifest.json");
}

function localLogPath(workspace, id) {
  return path.join(localRunDir(workspace, id), "stdout.log");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolvePortablePath(value, rootDir) {
  if (!value) {
    return null;
  }
  const text = String(value);
  if (path.isAbsolute(text)) {
    return text;
  }
  return path.resolve(rootDir, text);
}

function loadLlBicConfig() {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools.llbic ? value.tools.llbic : {};
  return {
    baseDir: configDir(config.path),
    value: item,
  };
}

function parseLlBicOptions(flags, argvCommand) {
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("llbic requires --workspace DIR or workspace.root in morpheus.yaml");
  }
  const { baseDir, value } = loadLlBicConfig();
  const mode = flags.mode || value.mode || "local";
  if (mode !== "local") {
    throw new Error("llbic supports only --mode local");
  }

  const positionals = Array.isArray(flags.positionals) ? [...flags.positionals] : [];
  const supportedSubcommands = new Set(["build", "compile", "inspect", "clean"]);
  let subcommand = positionals[0] || "";
  if (!subcommand || subcommand.startsWith("-") || !supportedSubcommands.has(subcommand)) {
    subcommand = argvCommand === "build" ? "build" : "run";
  } else {
    positionals.shift();
  }

  if (!supportedSubcommands.has(subcommand)) {
    throw new Error(`unsupported llbic subcommand for Morpheus: ${subcommand}`);
  }

  const buildsRoot = resolveLocalPath(baseDir, value.output || path.join(workspace, "tools", "llbic", "builds"));
  const sourcesRoot = resolveLocalPath(baseDir, value.sources || path.join(workspace, "tools", "llbic", "src"));
  const confPath = resolveLocalPath(baseDir, value.conf || path.join(workspace, "tools", "llbic", "sources.conf"));

  const args = [subcommand, ...positionals];
  if (!args.includes("--json")) {
    args.push("--json");
  }
  if (
    (subcommand === "build" || subcommand === "compile")
    && !args.includes("--outtree")
    && !args.includes("--out-of-tree")
    && !args.includes("--intree")
    && (value["out-of-tree"] !== false && value.outOfTree !== false)
  ) {
    args.push("--out-of-tree");
  }
  if ((subcommand === "build" || subcommand === "compile") && flags["out-of-tree"] && !args.includes("--out-of-tree")) {
    args.push("--out-of-tree");
  }
  if ((subcommand === "build" || subcommand === "compile") && flags.outtree && !args.includes("--outtree")) {
    args.push("--outtree");
  }
  if ((subcommand === "build" || subcommand === "compile") && flags.intree && !args.includes("--intree")) {
    args.push("--intree");
  }
  if ((subcommand === "build" || subcommand === "compile") && (flags.arch || value.arch) && !args.includes("--arch") && !args.includes("-a")) {
    args.push("--arch", String(flags.arch || value.arch));
  }
  if ((subcommand === "build" || subcommand === "compile") && (flags.clang || value.clang) && !args.includes("--clang")) {
    args.push("--clang", String(flags.clang || value.clang));
  }
  if ((subcommand === "build" || subcommand === "compile") && flags.verbose && !args.includes("--verbose") && !args.includes("-V")) {
    args.push("--verbose");
  }
  if ((subcommand === "build" || subcommand === "compile") && flags.cross && !args.includes("--cross")) {
    args.push("--cross", String(flags.cross));
  }
  if ((subcommand === "build" || subcommand === "compile") && flags.defconfig && !args.includes("--defconfig")) {
    args.push("--defconfig", String(flags.defconfig));
  }
  if ((subcommand === "build" || subcommand === "compile") && flags.output && !args.includes("--output") && !args.includes("-o")) {
    args.push("--output", String(flags.output));
  }
  for (const fragment of [].concat(flags.kconfig || []).concat(value.kconfig || [])) {
    args.push("--kconfig", String(fragment));
  }
  for (const file of [].concat(flags.file || [])) {
    args.push("--file", String(file));
  }
  for (const target of [].concat(flags["rust-target"] || [])) {
    args.push("--rust-target", String(target));
  }
  if ((flags.rust || value.rust) && !args.includes("--rust")) {
    args.push("--rust");
  }

  return {
    id: generateRunId(),
    workspace,
    mode,
    subcommand,
    args,
    llbicRoot: repoRoot(),
    sourcesRoot,
    buildsRoot,
    confPath,
  };
}

function buildArtifacts(payload, rootDir) {
  const outputDir = resolvePortablePath(payload.output_dir, rootDir);
  const sourceDir = resolvePortablePath(payload.source_dir, rootDir);
  const bitcodeList = resolvePortablePath(payload.bitcode_list_file, rootDir);
  const llbicLog = outputDir ? path.join(outputDir, "llbic.log") : null;
  const kernelBuildLog = resolvePortablePath(payload.kernel_build_log, rootDir);
  const manifest = outputDir ? path.join(outputDir, "llbic.json") : null;

  return [
    sourceDir ? { path: "source-dir", location: sourceDir } : null,
    outputDir ? { path: "output-dir", location: outputDir } : null,
    manifest ? { path: "llbic-json", location: manifest } : null,
    bitcodeList ? { path: "bitcode-files", location: bitcodeList } : null,
    llbicLog ? { path: "llbic-log", location: llbicLog } : null,
    kernelBuildLog ? { path: "kernel-build-log", location: kernelBuildLog } : null,
  ].filter(Boolean);
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
    artifacts: manifest.artifacts || [],
  });
}

async function runManagedLlBic(flags, argvCommand = "build") {
  const options = parseLlBicOptions(flags, argvCommand);
  registerManagedWorkspace({
    mode: "local",
    root: path.resolve(process.cwd(), options.workspace),
  });

  const runDir = localRunDir(options.workspace, options.id);
  const manifestPath = localManifestPath(options.workspace, options.id);
  const logFile = localLogPath(options.workspace, options.id);
  fs.mkdirSync(runDir, { recursive: true });
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, "", "utf8");
  }

  const result = await runStreamingExec(path.join(repoRoot(), "bin", "llbic"), options.args, {
    cwd: repoRoot(),
    env: {
      ...process.env,
      LLBIC_SOURCES: options.sourcesRoot,
      LLBIC_OUTPUT: options.buildsRoot,
      LLBIC_CONF: options.confPath,
    },
    logFile,
    jsonMode: Boolean(flags.json),
    eventCommand: argvCommand,
  });

  let payload = null;
  try {
    payload = JSON.parse(String(result.stdout || "").trim().split(/\r?\n/).at(-1) || "null");
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(result.stderr || result.stdout || "llbic did not return a JSON payload");
  }

  const artifacts = buildArtifacts(payload, repoRoot());
  const outputDirArtifact = artifacts.find((item) => item.path === "output-dir");
  const manifestArtifact = artifacts.find((item) => item.path === "llbic-json");
  const manifest = {
    schemaVersion: 1,
    id: options.id,
    tool: TOOL,
    mode: "local",
    command: options.subcommand,
    status: payload.status || (result.status === 0 ? "success" : "error"),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspace: options.workspace,
    runDir,
    outputDir: outputDirArtifact ? outputDirArtifact.location : runDir,
    logFile,
    manifest: manifestPath,
    toolManifest: manifestArtifact ? manifestArtifact.location : null,
    details: payload,
    artifacts,
    transport: null,
    exitCode: typeof payload.exit_code === "number" ? payload.exit_code : result.status,
  };
  writeJson(manifestPath, manifest);
  registerManifest(manifest);

  return {
    command: argvCommand,
    status: manifest.status,
    exit_code: manifest.exitCode,
    summary: payload.summary || `${options.subcommand} managed llbic run`,
    details: {
      id: options.id,
      tool: TOOL,
      mode: manifest.mode,
      workspace: options.workspace,
      run_dir: runDir,
      manifest: manifestArtifact ? manifestArtifact.location : null,
      managed_manifest: manifestPath,
      log_file: logFile,
      output_dir: manifest.outputDir,
      source_dir: artifacts.find((item) => item.path === "source-dir")?.location || null,
      bitcode_list: artifacts.find((item) => item.path === "bitcode-files")?.location || null,
      artifacts,
      payload,
    },
    error: manifest.status === "success"
      ? undefined
      : { code: "managed_run_failed", message: payload.summary || result.stderr || "managed llbic run failed" },
  };
}

module.exports = {
  runManagedLlBic,
};
