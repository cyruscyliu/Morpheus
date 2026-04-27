// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { registerManagedRun, registerManagedWorkspace } = require("./managed-state");
const { resolveManagedRunDir } = require("./run-layout");
const { repoRoot } = require("./paths");
const { runStreamingExec } = require("./streaming-exec");

const TOOL = "llcg";

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

function localWorkspaceRoot(workspace) {
  return path.resolve(process.cwd(), workspace);
}

function localToolWorkspace(workspace, tool) {
  return path.join(localWorkspaceRoot(workspace), "tools", tool);
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

function requireWorkspaceRelative(value, label) {
  const text = String(value || "");
  if (!text) {
    throw new Error(`empty ${label} value`);
  }
  if (text.startsWith("~")) {
    throw new Error(`${label} must be workspace-relative (no ~)`);
  }
  if (/^[a-zA-Z]:[\\/]/.test(text)) {
    throw new Error(`${label} must be workspace-relative (no Windows absolute paths)`);
  }
  if (path.isAbsolute(text)) {
    throw new Error(`${label} must be workspace-relative (no absolute paths)`);
  }
  return text;
}

function resolveWorkspacePath(workspace, configured, fallbackRelative, label) {
  const relative = configured == null || configured === ""
    ? fallbackRelative
    : requireWorkspaceRelative(configured, label);
  return path.join(workspace, relative);
}

function resolvePayloadArtifacts(payload) {
  const details = payload && payload.details ? payload.details : {};
  const pathViews = payload && payload.paths ? payload.paths : {};
  const payloadArtifacts = payload && payload.artifacts ? payload.artifacts : {};
  const result = [];

  if (Array.isArray(payloadArtifacts)) {
    for (const artifact of payloadArtifacts) {
      if (!artifact || typeof artifact !== "object") {
        continue;
      }
      const key = artifact.key || artifact.path;
      const pathView = key ? pathViews[key] : null;
      const resolved = artifact.resolved_path
        || artifact.runtime_path
        || artifact.path
        || (pathView && typeof pathView === "object"
          ? (pathView.resolved_path || pathView.runtime_path || pathView.portable || null)
          : null);
      if (!key || !resolved) {
        continue;
      }
      result.push({ path: key, location: resolved });
    }
  } else {
    for (const [key, exists] of Object.entries(payloadArtifacts)) {
      if (!exists) {
        continue;
      }
      const pathView = pathViews[key];
      const resolved = pathView && typeof pathView === "object"
        ? (pathView.resolved_path || pathView.runtime_path || pathView.portable || null)
        : null;
      if (!resolved) {
        continue;
      }
      result.push({ path: key, location: resolved });
    }
  }

  if (details.output) {
    result.push({ path: "output-dir", location: String(details.output) });
  }
  return result;
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

function parseJsonPayload(output) {
  const text = String(output || "").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.split(/\r?\n/).at(-1) || "null");
    } catch {
      return null;
    }
  }
}

function parseManagedLlCgOptions(flags) {
  const workspace = flags.workspace;
  if (!workspace) {
    throw new Error("llcg requires --workspace DIR or workspace.root in morpheus.yaml");
  }
  const mode = flags.mode || "local";

  const positionals = Array.isArray(flags.positionals) ? [...flags.positionals] : [];
  const subcommand = positionals.shift() || "run";
  if (!["run", "genmutator", "inspect"].includes(subcommand)) {
    throw new Error(`unsupported llcg subcommand for Morpheus: ${subcommand}`);
  }

  const runId = generateRunId();
  const runDir = localRunDir(workspace, runId);
  const reuseBuildDir = Boolean(flags["reuse-build-dir"]);
  const buildDirKey = flags["build-dir-key"] || "default";
  if (flags["build-dir-key"] && !reuseBuildDir) {
    throw new Error("llcg cannot use --build-dir-key KEY without --reuse-build-dir");
  }
  const configuredOutput = flags.output
    ? resolveWorkspacePath(workspace, flags.output, null, "tools.llcg.output")
    : null;
  const outputDir = reuseBuildDir
    ? path.join(configuredOutput || path.join(workspace, "tools", TOOL, "builds"), buildDirKey, "output")
    : (configuredOutput || path.join(runDir, "output"));
  const args = [subcommand, ...positionals];
  if (!args.includes("--json")) {
    args.push("--json");
  }
  if ((subcommand === "run" || subcommand === "genmutator") && !args.includes("--output") && !args.includes("-o")) {
    args.push("--output", outputDir);
  }
  if (subcommand === "run" && flags.clang && !args.includes("--clang")) {
    args.push("--clang", String(flags.clang));
  }
  if (subcommand === "genmutator" && flags.arch && !args.includes("--arch")) {
    args.push("--arch", String(flags.arch));
  }
  if (flags["source-dir"]) {
    args.push("--source-dir", String(flags["source-dir"]));
  }
  if (flags.interfaces) {
    args.push("--interfaces", String(flags.interfaces));
  }
  if (flags["scope-name"]) {
    args.push("--scope-name", String(flags["scope-name"]));
  }
  if (flags["llbic-json"]) {
    args.push("--llbic-json", String(flags["llbic-json"]));
  }
  if (flags["all-bc-list"]) {
    args.push("--all-bc-list", String(flags["all-bc-list"]));
  }
  if (flags["bitcode-list"]) {
    args.push("--bitcode-list", String(flags["bitcode-list"]));
  }
  const filters = [].concat(flags.filter || []);
  for (const filter of filters) {
    args.push("--filter", String(filter));
  }
  const files = [].concat(flags.file || []);
  for (const file of files) {
    args.push("--file", String(file));
  }

  return {
    id: runId,
    workspace,
    mode,
    subcommand,
    args,
    outputDir,
    reuseBuildDir,
    buildDirKey,
  };
}

async function runManagedLlCg(flags, argvCommand = "build") {
  const options = parseManagedLlCgOptions(flags);
  if (options.mode !== "local") {
    throw new Error("llcg supports only --mode local");
  }
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

  const result = await runStreamingExec(path.join(repoRoot(), "bin", "llcg"), options.args, {
    cwd: repoRoot(),
    env: process.env,
    logFile,
    jsonMode: Boolean(flags.json),
    eventCommand: argvCommand,
  });

  const payload = parseJsonPayload(result.stdout);
  if (!payload || typeof payload !== "object") {
    throw new Error(result.stderr || result.stdout || "llcg did not return a JSON payload");
  }

  const artifacts = resolvePayloadArtifacts(payload);
  const manifestArtifact = artifacts.find((item) => item.path === "manifest");
  const outputArtifact = artifacts.find((item) => item.path === "output-dir");
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
    buildDirKey: options.reuseBuildDir ? options.buildDirKey : null,
    runDir,
    outputDir: outputArtifact ? outputArtifact.location : options.outputDir,
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
    summary: payload.summary || `${options.subcommand} managed llcg run`,
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
      artifacts,
      payload,
    },
    error: manifest.status === "success"
      ? undefined
      : { code: "managed_run_failed", message: payload.summary || result.stderr || "managed llcg run failed" },
  };
}

module.exports = {
  parseManagedLlCgOptions,
  resolvePayloadArtifacts,
  runManagedLlCg,
};
