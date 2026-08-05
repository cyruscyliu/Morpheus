#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const maxBuffer = 1024 * 1024 * 128;

function usage() {
  process.stdout.write(`Usage:
  scripts/run-evaluations.mjs
    --spec PATH
    [--config PATH]
    [--evaluation ID]
    [--driver ID]
    [--kernel VERSION]
    [--output-root PATH]
    [--link-mode copy|hardlink]
    [--force]
    [--dry-run]
    [--json]

Run evaluation workflows in three phases:
1. export the configured workflow bundle through Morpheus
2. run the exported workflow bundle through its own run-workflow.sh
3. collect evaluation metrics from the bundle-local workflow results
`);
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function expandUser(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function expandEnv(input) {
  return String(input).replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
    if (!(name in process.env)) {
      throw new Error(`missing environment variable: ${name}`);
    }
    return String(process.env[name]);
  });
}

function resolveInputPath(baseDir, inputPath) {
  if (!inputPath) {
    return "";
  }
  const expanded = expandEnv(expandUser(String(inputPath)));
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

function parseArgs(argv) {
  const flags = {
    evaluation: [],
    driver: [],
    kernel: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-h" || token === "--help") {
      flags.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      fail(`unknown argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const expectsValue = !["dry-run", "force", "json"].includes(key);
    if (!expectsValue) {
      flags[key] = true;
      continue;
    }
    if (!next || next.startsWith("--")) {
      fail(`missing value for --${key}`);
    }
    index += 1;
    if (["evaluation", "driver", "kernel"].includes(key)) {
      for (const part of String(next).split(",")) {
        const trimmed = part.trim();
        if (trimmed) {
          flags[key].push(trimmed);
        }
      }
      continue;
    }
    flags[key] = next;
  }
  return flags;
}

function readJsonFile(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function writeJsonFile(targetPath, payload) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function singularize(value) {
  return value.endsWith("s") && value.length > 1 ? value.slice(0, -1) : value;
}

function normalizeAxisItem(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const display =
      value.value ??
      value.id ??
      value.version ??
      value.name;
    if (display == null || display === "") {
      throw new Error(`matrix item is missing value: ${JSON.stringify(value)}`);
    }
    const workflowValue = value.workflow_value ?? value.slug ?? display;
    return {
      value: String(display),
      workflowValue: String(workflowValue),
      raw: value,
    };
  }
  return {
    value: String(value),
    workflowValue: String(value),
    raw: value,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function workflowCombos(evaluation) {
  const pattern = String(evaluation.workflow_pattern || "");
  if (!pattern) {
    throw new Error(`evaluation ${evaluation.id} is missing workflow_pattern`);
  }
  const placeholders = unique(
    [...pattern.matchAll(/<([^>]+)>/g)].map((match) => String(match[1]))
  );
  if (placeholders.length === 0) {
    return [{
      workflow: pattern,
      context: {},
    }];
  }

  const matrix = evaluation.input_matrix || {};
  const axes = placeholders.map((placeholder) => {
    const exact = Array.isArray(matrix[placeholder]) ? matrix[placeholder] : null;
    const plural = Array.isArray(matrix[`${placeholder}s`]) ? matrix[`${placeholder}s`] : null;
    const fallback = Object.entries(matrix).find(([key, values]) => {
      return Array.isArray(values) && singularize(key) === placeholder;
    });
    const values = exact || plural || (fallback ? fallback[1] : null);
    if (!values) {
      throw new Error(
        `evaluation ${evaluation.id} is missing matrix values for <${placeholder}>`
      );
    }
    return {
      name: placeholder,
      values: values.map(normalizeAxisItem),
    };
  });

  const combos = [];
  function visit(index, currentContext) {
    if (index >= axes.length) {
      let workflow = pattern;
      for (const [key, value] of Object.entries(currentContext)) {
        workflow = workflow.split(`<${key}>`).join(slug(value.workflowValue));
      }
      if (/<[^>]+>/.test(workflow)) {
        throw new Error(`workflow pattern left unresolved placeholders: ${workflow}`);
      }
      const context = Object.fromEntries(
        Object.entries(currentContext).map(([key, value]) => [key, value.value])
      );
      combos.push({ workflow, context });
      return;
    }
    const axis = axes[index];
    for (const value of axis.values) {
      visit(index + 1, {
        ...currentContext,
        [axis.name]: value,
      });
    }
  }

  visit(0, {});
  return combos;
}

function maybeReadJsonFile(targetPath) {
  return fs.existsSync(targetPath) ? readJsonFile(targetPath) : null;
}

function maybeReadTextFile(targetPath) {
  return fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
}

function countLines(text) {
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).filter(Boolean).length;
}

function dotStats(targetPath) {
  const text = maybeReadTextFile(targetPath);
  const lines = text.split(/\r?\n/);
  let edgeCount = 0;
  const nodes = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "{" || trimmed === "}") {
      continue;
    }
    const edgeMatch = trimmed.match(/^"?(.*?)"?\s*->\s*"?(.*?)"?(?:\s*\[|;|$)/);
    if (edgeMatch) {
      edgeCount += 1;
      if (edgeMatch[1]) {
        nodes.add(edgeMatch[1]);
      }
      if (edgeMatch[2]) {
        nodes.add(edgeMatch[2]);
      }
      continue;
    }
    if (
      trimmed.startsWith("graph ") ||
      trimmed.startsWith("node ") ||
      trimmed.startsWith("edge ") ||
      trimmed.startsWith("subgraph ")
    ) {
      continue;
    }
    const nodeMatch = trimmed.match(/^"?(.*?)"?(?:\s*\[|\s*;|$)/);
    if (nodeMatch && nodeMatch[1]) {
      const token = nodeMatch[1].trim();
      if (
        token &&
        !token.includes("=") &&
        !token.startsWith("label ") &&
        !token.startsWith("rankdir")
      ) {
        nodes.add(token);
      }
    }
  }

  return {
    line_count: countLines(text),
    node_count: nodes.size,
    edge_count: edgeCount,
  };
}

function stateStats(targetPath) {
  const text = fs.readFileSync(targetPath, "utf8");
  const lines = text.split(/\r?\n/);
  let structCount = 0;
  let headCount = 0;
  let positionCount = 0;

  for (const line of lines) {
    if (line.startsWith("struct ")) {
      structCount += 1;
    }
    if (line.startsWith("head ")) {
      headCount += 1;
    }
    if (line.includes("position =")) {
      positionCount += 1;
    }
  }

  return {
    bytes: fs.statSync(targetPath).size,
    line_count: lines.filter(Boolean).length,
    struct_count: structCount,
    head_count: headCount,
    position_count: positionCount,
  };
}

function fileStats(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return null;
  }
  return {
    bytes: fs.statSync(targetPath).size,
  };
}

function sha256File(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return null;
  }
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(targetPath));
  return hash.digest("hex");
}

function kernelVersionFromPath(targetPath) {
  const match = String(targetPath || "").match(/linux-([^/]+)\//);
  return match ? String(match[1]) : "";
}

function stageJsonPath(workflowDir, stageId) {
  const candidates = [
    path.join(workflowDir, "stages", stageId, "stage.json"),
    path.join(workflowDir, "steps", stageId, "step.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function readStage(workflowDir, stageId) {
  const targetPath = stageJsonPath(workflowDir, stageId);
  return targetPath ? readJsonFile(targetPath) : null;
}

function artifactLocation(stage, artifactPath) {
  if (!stage) {
    return "";
  }
  const artifacts = Array.isArray(stage.artifacts) ? stage.artifacts : [];
  const artifact = artifacts.find((entry) => String(entry && entry.path || "") === artifactPath);
  if (artifact && typeof artifact.location === "string" && artifact.location) {
    return artifact.location;
  }

  const detailArtifacts = Array.isArray(stage.toolResult?.details?.artifacts)
    ? stage.toolResult.details.artifacts
    : [];
  const detailArtifact = detailArtifacts.find((entry) => String(entry && entry.path || "") === artifactPath);
  if (detailArtifact && typeof detailArtifact.location === "string" && detailArtifact.location) {
    return detailArtifact.location;
  }

  const details = stage.toolResult?.details || {};
  const candidates = [
    artifactPath,
    artifactPath.replace(/-/g, "_"),
    artifactPath.replace(/_/g, "-"),
  ];
  for (const candidate of candidates) {
    const value = details[candidate];
    if (typeof value !== "string" || !value) {
      continue;
    }
    if (path.isAbsolute(value)) {
      return value;
    }
    const outputDir = typeof details.output === "string" ? details.output : "";
    return outputDir ? path.join(outputDir, value) : value;
  }

  return "";
}

function stepSummary(stage) {
  if (!stage) {
    return null;
  }
  const createdAt = stage.createdAt ? Date.parse(stage.createdAt) : Number.NaN;
  const updatedAt = stage.updatedAt ? Date.parse(stage.updatedAt) : Number.NaN;
  return {
    status: stage.status || "",
    created_at: stage.createdAt || "",
    updated_at: stage.updatedAt || "",
    duration_seconds:
      Number.isFinite(createdAt) && Number.isFinite(updatedAt)
        ? Math.max(0, (updatedAt - createdAt) / 1000)
        : null,
  };
}

function aggregateTiming(workflowDir, stageIds) {
  let earliest = null;
  let latest = null;
  const steps = {};

  for (const stageId of stageIds) {
    const stage = readStage(workflowDir, stageId);
    if (!stage) {
      continue;
    }
    steps[stageId] = stepSummary(stage);
    const createdAt = stage.createdAt ? Date.parse(stage.createdAt) : Number.NaN;
    const updatedAt = stage.updatedAt ? Date.parse(stage.updatedAt) : Number.NaN;
    if (Number.isFinite(createdAt)) {
      earliest = earliest === null ? createdAt : Math.min(earliest, createdAt);
    }
    if (Number.isFinite(updatedAt)) {
      latest = latest === null ? updatedAt : Math.max(latest, updatedAt);
    }
  }

  return {
    steps,
    total_seconds:
      earliest !== null && latest !== null
        ? Math.max(0, (latest - earliest) / 1000)
        : null,
  };
}

function analysisKindForWorkflow(workflowName) {
  if (workflowName.includes("driver-callgraph")) {
    return "driver-callgraph";
  }
  if (workflowName.includes("devilang")) {
    return "devilang";
  }
  if (workflowName.includes("nvirsh-qemu-arm64")) {
    return "nvirsh";
  }
  throw new Error(`unsupported workflow kind: ${workflowName}`);
}

function collectDriverCallgraphMetrics(context) {
  const workflowJson = readJsonFile(path.join(context.workflowDir, "workflow.json"));
  const driverCallgraphBuild = readStage(context.workflowDir, "driver_callgraph_build");
  const driverCallgraphLlcg = readStage(context.workflowDir, "driver_callgraph_llcg");
  const debugPath = artifactLocation(driverCallgraphBuild, "debug-json");
  const llcgDotPath = artifactLocation(driverCallgraphLlcg, "cg_dot");
  const debug = readJsonFile(debugPath);

  return {
    workflow: context.workflow,
    run_id: workflowJson.id || context.workflow,
    snapshot_date: context.snapshotDate || "",
    analysis_kind: "driver-callgraph",
    kernel_version: context.kernel || "",
    driver_id: context.driver || "",
    driver_version: context.kernel ? `in-tree@${context.kernel}` : "",
    exported_at: context.exportedAt || "",
    timing: aggregateTiming(context.workflowDir, [
      "llbase_build",
      "llbic_build",
      "llcg_build",
      "driver_callgraph_scope",
      "driver_callgraph_groups",
      "driver_callgraph_llcg",
      "driver_callgraph_build",
    ]),
    callgraph: {
      llcg_node_count: debug.llcg_node_count ?? null,
      llcg_edge_count: debug.llcg_edge_count ?? null,
      slice_node_count: debug.slice_node_count ?? null,
      slice_edge_count: debug.slice_edge_count ?? null,
      collapsed_node_count: debug.collapsed_node_count ?? null,
      collapsed_edge_count: debug.collapsed_edge_count ?? null,
      groups_total: debug.groups_total ?? null,
      lifecycle_roots: Array.isArray(debug.lifecycle_roots)
        ? debug.lifecycle_roots.length
        : null,
      lifecycle_selected_roots: Array.isArray(debug.lifecycle_selected_roots)
        ? debug.lifecycle_selected_roots.length
        : null,
      runtime_roots: Array.isArray(debug.runtime_roots)
        ? debug.runtime_roots.length
        : null,
      llcg_dot_stats: dotStats(llcgDotPath),
    },
    model: null,
  };
}

function collectDevilangMetrics(context) {
  const workflowJson = readJsonFile(path.join(context.workflowDir, "workflow.json"));
  const devilangExec = readStage(context.workflowDir, "devilang_exec");
  const llcgRun = readStage(context.workflowDir, "llcg_run");
  const bootingStatePath = artifactLocation(devilangExec, "booting-state");
  const runtimeStatePath = artifactLocation(devilangExec, "runtime-state");
  const pointsToPath = artifactLocation(devilangExec, "points-to-json");
  const kallgraphPath = artifactLocation(llcgRun, "kallgraph_text");
  const llcgDotPath = artifactLocation(llcgRun, "cg_dot");
  const pointsTo = maybeReadJsonFile(pointsToPath) || {};
  const booting = stateStats(bootingStatePath);
  const runtime = stateStats(runtimeStatePath);

  return {
    workflow: context.workflow,
    run_id: workflowJson.id || context.workflow,
    snapshot_date: context.snapshotDate || "",
    analysis_kind: "devilang",
    kernel_version: context.kernel || "",
    driver_id: context.driver || "",
    driver_version: context.kernel ? `in-tree@${context.kernel}` : "",
    exported_at: context.exportedAt || "",
    timing: aggregateTiming(context.workflowDir, [
      "llbase_build",
      "llbic_build",
      "llcg_build",
      "devilang_build",
      "llcg_mutator",
      "llcg_kallgraph_scope",
      "llcg_run",
      "devilang_exec",
    ]),
    callgraph: {
      llcg_dot_stats: dotStats(llcgDotPath),
      kallgraph_line_count: countLines(maybeReadTextFile(kallgraphPath)),
      points_to_query_count: Array.isArray(pointsTo.queries)
        ? pointsTo.queries.length
        : null,
    },
    model: {
      booting_machine_name: String(devilangExec?.toolResult?.details?.booting_machine_name || ""),
      runtime_machine_name: String(devilangExec?.toolResult?.details?.runtime_machine_name || ""),
      booting,
      runtime,
      total_struct_count: booting.struct_count + runtime.struct_count,
      total_head_count: booting.head_count + runtime.head_count,
      total_position_count: booting.position_count + runtime.position_count,
    },
  };
}

function collectNvirshMetrics(context) {
  const workflowJson = readJsonFile(path.join(context.workflowDir, "workflow.json"));
  const nvirshBuild = readStage(context.workflowDir, "nvirsh_build");
  const nvirshExec = readStage(context.workflowDir, "nvirsh_exec");
  const nvirshStop = readStage(context.workflowDir, "nvirsh_stop");
  const statePath = artifactLocation(nvirshBuild, "prepared-state")
    || String(nvirshBuild?.toolResult?.details?.state_file || "");
  const runtimeManifestPath = String(
    nvirshStop?.toolResult?.details?.manifest
    || nvirshExec?.toolResult?.details?.manifest
    || ""
  );
  const state = statePath ? readJsonFile(statePath) : {};
  const runtimeManifest = runtimeManifestPath && fs.existsSync(runtimeManifestPath)
    ? readJsonFile(runtimeManifestPath)
    : {};
  const buildrootImages = state.layeredState?.l2?.buildrootImages || {};
  const guestKernelVmlinux = String(buildrootImages.vmlinux || "");
  const guestKernelImage = String(buildrootImages.image || "");
  const guestInitrd = String(buildrootImages.initrd || "");
  const guestKernelVersion =
    kernelVersionFromPath(guestKernelVmlinux)
    || String(workflowJson.metadata?.["guest-kernel-version"] || "")
    || String(context.kernel || "");

  return {
    workflow: context.workflow,
    run_id: workflowJson.id || context.workflow,
    snapshot_date: context.snapshotDate || "",
    analysis_kind: "nvirsh",
    kernel_version: guestKernelVersion,
    exported_at: context.exportedAt || "",
    timing: aggregateTiming(context.workflowDir, [
      "buildroot_fetch",
      "buildroot_patch",
      "buildroot_build",
      "qemu_fetch",
      "qemu_patch",
      "qemu_build",
      "nvirsh_fetch",
      "nvirsh_build",
      "nvirsh_exec",
      "nvirsh_stop",
    ]),
    nvirsh: {
      profile: String(state.profile || workflowJson.metadata?.profile || ""),
      build_dir_key: String(state.buildDirKey || nvirshBuild?.resolvedInputs?.["build-dir-key"] || ""),
      l2_mode: String(state.layeredState?.l2?.mode || ""),
      l2_cvm: Boolean(state.layeredState?.l2?.cvm),
      state_status: String(state.status || ""),
      current_phase: String(runtimeManifest.currentPhase || state.currentPhase || ""),
      runtime_status: String(runtimeManifest.status || ""),
      launch_phase_status: String(runtimeManifest.phases?.launch || ""),
      stop_phase_status: String(runtimeManifest.phases?.stop || ""),
      detached: runtimeManifest.runtime?.detached ?? nvirshExec?.toolResult?.details?.detached ?? null,
    },
    guest: {
      kernel_version: guestKernelVersion,
      kernel_vmlinux: guestKernelVmlinux || null,
      kernel_image: guestKernelImage || null,
      initrd_image: guestInitrd || null,
      kernel_image_bytes: fileStats(guestKernelImage)?.bytes ?? null,
      initrd_bytes: fileStats(guestInitrd)?.bytes ?? null,
      kernel_image_sha256: String(buildrootImages.imageSha256 || sha256File(guestKernelImage) || ""),
      initrd_sha256: String(buildrootImages.initrdSha256 || sha256File(guestInitrd) || ""),
    },
    callgraph: null,
    model: null,
  };
}

function collectMetrics(context) {
  const analysisKind = analysisKindForWorkflow(context.workflow);
  if (analysisKind === "driver-callgraph") {
    return collectDriverCallgraphMetrics(context);
  }
  if (analysisKind === "devilang") {
    return collectDevilangMetrics(context);
  }
  if (analysisKind === "nvirsh") {
    return collectNvirshMetrics(context);
  }
  throw new Error(`unsupported analysis kind: ${analysisKind}`);
}

function getByPath(payload, valuePath) {
  const parts = String(valuePath).split(".");
  let current = payload;
  for (const part of parts) {
    if (current == null || typeof current !== "object" || !(part in current)) {
      return null;
    }
    current = current[part];
  }
  return current ?? null;
}

function pickMetrics(payload, metricPaths) {
  const selected = {};
  for (const valuePath of metricPaths || []) {
    selected[valuePath] = getByPath(payload, valuePath);
  }
  return selected;
}

function runJson(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    maxBuffer,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `command failed (${result.status}): ${command} ${args.join(" ")}${detail ? `\n${detail}` : ""}`
    );
  }
  const stdout = String(result.stdout || "").trim();
  if (!stdout) {
    return null;
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `invalid json from command: ${command} ${args.join(" ")}\n${stdout}`
    );
  }
}

function timestampSlug(date = new Date()) {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/[:]/g, "").replace("T", "-").replace("Z", "");
}

function defaultOutputRoot(specPath) {
  return path.join(path.dirname(specPath), "runs", timestampSlug());
}

function relativeOrAbsolute(targetPath) {
  const relative = path.relative(process.cwd(), targetPath);
  return relative && !relative.startsWith("..") ? relative : targetPath;
}

function selectEvaluations(spec, flags, specDir) {
  const wantedEvaluations = new Set(flags.evaluation || []);
  const wantedDrivers = new Set(flags.driver || []);
  const wantedKernels = new Set(flags.kernel || []);
  const overrideConfigPath = flags.config
    ? resolveInputPath(process.cwd(), flags.config)
    : "";
  const items = [];

  for (const evaluation of spec.evaluations || []) {
    if (wantedEvaluations.size > 0 && !wantedEvaluations.has(evaluation.id)) {
      continue;
    }
    const configPath = resolveInputPath(
      specDir,
      overrideConfigPath || evaluation.config || spec.config || ""
    );
    if (!configPath) {
      throw new Error(`evaluation ${evaluation.id} is missing config`);
    }
    for (const combo of workflowCombos(evaluation)) {
      const driver = combo.context.driver || "";
      const kernel = combo.context.kernel || "";
      if (wantedDrivers.size > 0 && !wantedDrivers.has(driver)) {
        continue;
      }
      if (wantedKernels.size > 0 && !wantedKernels.has(kernel)) {
        continue;
      }
      items.push({
        evaluation,
        configPath,
        exportWorkflow: String(
          evaluation.export_workflow ||
          evaluation.exportWorkflow ||
          combo.workflow
        ),
        workflow: combo.workflow,
        driver,
        kernel,
        snapshotDate: String(evaluation.input_matrix?.snapshot_date || ""),
      });
    }
  }

  return items;
}

function printPlan(items, outputRoot, asJson) {
  const payload = {
    output_root: outputRoot,
    workflows: items.map((item) => ({
      evaluation_id: item.evaluation.id,
      export_workflow: item.exportWorkflow,
      workflow: item.workflow,
      driver: item.driver,
      kernel: item.kernel,
      config: item.configPath,
    })),
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`output_root=${payload.output_root}\n`);
  for (const workflow of payload.workflows) {
    process.stdout.write(
      `evaluation=${workflow.evaluation_id} export=${workflow.export_workflow} workflow=${workflow.workflow} driver=${workflow.driver} kernel=${workflow.kernel}\n`
    );
  }
}

function groupEvaluationItems(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.evaluation.id;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        evaluation: item.evaluation,
        configPath: item.configPath,
        exportWorkflow: item.exportWorkflow,
        items: [item],
      });
      continue;
    }
    if (existing.configPath !== item.configPath) {
      throw new Error(`evaluation ${key} resolved to multiple config paths`);
    }
    if (existing.exportWorkflow !== item.exportWorkflow) {
      throw new Error(`evaluation ${key} resolved to multiple export workflows`);
    }
    existing.items.push(item);
  }
  return [...groups.values()];
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function markdownCell(value) {
  return value == null ? "" : String(value).replace(/\|/g, "\\|");
}

function latexEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function humanizeSlug(value) {
  return String(value)
    .split(/[-_]+/g)
    .filter(Boolean)
    .join(" ");
}

function formatMetricValue(column, value) {
  if (value == null || value === "") {
    return "--";
  }
  if (typeof value === "number") {
    if (column === "timing.total_seconds") {
      return value.toFixed(3);
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(3).replace(/\.?0+$/, "");
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function resultValue(result, column) {
  if (column in result) {
    return result[column];
  }
  return result.selected_metrics?.[column] ?? null;
}

function groupResultsByEvaluation(results) {
  const groups = new Map();
  for (const result of results) {
    const key = result.evaluation_id || "unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(result);
  }
  return [...groups.entries()].map(([evaluationId, groupResults]) => ({
    evaluationId,
    results: groupResults,
  }));
}

function sumSelectedMetric(results, key) {
  return results.reduce((total, result) => {
    const value = result.selected_metrics?.[key];
    return typeof value === "number" ? total + value : total;
  }, 0);
}

function findExtremeResult(results, key, direction) {
  let selected = null;
  for (const result of results) {
    const value = result.selected_metrics?.[key];
    if (typeof value !== "number") {
      continue;
    }
    if (!selected) {
      selected = { result, value };
      continue;
    }
    if (direction === "max" ? value > selected.value : value < selected.value) {
      selected = { result, value };
    }
  }
  return selected;
}

function latexColumnLabel(column) {
  const labels = {
    evaluation_id: "Evaluation",
    workflow: "Workflow",
    driver: "Driver",
    kernel: "Kernel",
    status: "Status",
    "timing.total_seconds": "Time (s)",
    kernel_version: "Kernel version",
    driver_id: "Driver ID",
    driver_version: "Driver version",
    "callgraph.llcg_node_count": "LLCG nodes",
    "callgraph.llcg_edge_count": "LLCG edges",
    "callgraph.slice_node_count": "Slice nodes",
    "callgraph.slice_edge_count": "Slice edges",
    "callgraph.collapsed_node_count": "Collapsed nodes",
    "callgraph.collapsed_edge_count": "Collapsed edges",
    "callgraph.groups_total": "Groups",
    "callgraph.kallgraph_line_count": "KallGraph lines",
    "callgraph.llcg_dot_stats.node_count": "LLCG nodes",
    "callgraph.llcg_dot_stats.edge_count": "LLCG edges",
    "model.booting.bytes": "Boot bytes",
    "model.booting.struct_count": "Boot structs",
    "model.booting.head_count": "Boot heads",
    "model.booting.position_count": "Boot positions",
    "model.runtime.bytes": "Runtime bytes",
    "model.runtime.struct_count": "Runtime structs",
    "model.runtime.head_count": "Runtime heads",
    "model.runtime.position_count": "Runtime positions",
    "model.total_struct_count": "Total structs",
    "model.total_head_count": "Total heads",
    "model.total_position_count": "Total positions",
  };
  return labels[column] || column;
}

function columnAlignment(results, column) {
  const values = results
    .map((result) => resultValue(result, column))
    .filter((value) => value != null && value !== "");
  return values.length > 0 && values.every((value) => typeof value === "number")
    ? "r"
    : "l";
}

function renderLatexTable({ caption, label, headers, rows, alignments }) {
  const lines = [
    "\\begin{table}[htbp]",
    "\\centering",
    "\\scriptsize",
    `\\caption{${latexEscape(caption)}}`,
    `\\label{${label}}`,
    `\\begin{tabular}{${alignments.join("")}}`,
    "\\hline",
    `${headers.map((header) => latexEscape(header)).join(" & ")} \\\\`,
    "\\hline",
    ...rows.map(
      (row) => `${row.map((cell) => latexEscape(cell)).join(" & ")} \\\\`
    ),
    "\\hline",
    "\\end{tabular}",
    "\\end{table}",
  ];
  return lines.join("\n");
}

function evaluationMetricColumns(results) {
  if (results.length === 0) {
    return [];
  }
  const hiddenMetrics = new Set([
    "driver_id",
    "driver_version",
    "kernel_version",
  ]);
  const metricColumns = Object.keys(results[0].selected_metrics || {}).filter(
    (column) => !hiddenMetrics.has(column)
  );
  const columns = ["driver", "kernel"];
  if (results.some((result) => result.status !== "success")) {
    columns.push("status");
  }
  return [...columns, ...metricColumns];
}

function renderEvaluationLatexTable(evaluationId, results) {
  const columns = evaluationMetricColumns(results);
  const rows = results.map((result) =>
    columns.map((column) =>
      formatMetricValue(column, resultValue(result, column))
    )
  );
  return renderLatexTable({
    caption: `Results for ${humanizeSlug(evaluationId)}`,
    label: `tab:${slug(evaluationId)}-results`,
    headers: columns.map(latexColumnLabel),
    rows,
    alignments: columns.map((column) => columnAlignment(results, column)),
  });
}

function renderSummaryLatexTable(groups) {
  const headers = [
    "Evaluation",
    "Runs",
    "Success",
    "Failure",
    "Total (s)",
    "Avg (s)",
  ];
  const rows = groups.map(({ evaluationId, results }) => {
    const successCount = results.filter((result) => result.status === "success").length;
    const failureCount = results.length - successCount;
    const totalSeconds = sumSelectedMetric(results, "timing.total_seconds");
    const averageSeconds = results.length > 0 ? totalSeconds / results.length : 0;
    return [
      humanizeSlug(evaluationId),
      String(results.length),
      String(successCount),
      String(failureCount),
      totalSeconds.toFixed(3),
      averageSeconds.toFixed(3),
    ];
  });
  return renderLatexTable({
    caption: "Evaluation summary",
    label: "tab:evaluation-summary",
    headers,
    rows,
    alignments: ["l", "r", "r", "r", "r", "r"],
  });
}

function renderLatexReport(results) {
  const groups = groupResultsByEvaluation(results);
  const sections = ["% Generated by scripts/run-evaluations.mjs"];
  if (groups.length > 1) {
    sections.push(renderSummaryLatexTable(groups));
  }
  for (const group of groups) {
    sections.push(renderEvaluationLatexTable(group.evaluationId, group.results));
  }
  return `${sections.join("\n\n")}\n`;
}

function describeRun(result) {
  return `driver ${result.driver} on kernel ${result.kernel}`;
}

function renderEvaluationNarrative(group) {
  const { evaluationId, results } = group;
  const successCount = results.filter((result) => result.status === "success").length;
  const failureCount = results.length - successCount;
  const totalSeconds = sumSelectedMetric(results, "timing.total_seconds");
  const averageSeconds = results.length > 0 ? totalSeconds / results.length : 0;
  const lines = [
    `## ${evaluationId}`,
    "",
    `${successCount} of ${results.length} runs succeeded and ${failureCount} failed. Total runtime was ${totalSeconds.toFixed(3)} s and average runtime was ${averageSeconds.toFixed(3)} s.`,
    "",
  ];

  const largestCallgraph = findExtremeResult(
    results,
    "callgraph.llcg_node_count",
    "max"
  );
  const smallestCallgraph = findExtremeResult(
    results,
    "callgraph.llcg_node_count",
    "min"
  );
  if (largestCallgraph && smallestCallgraph) {
    lines.push(
      `The largest LLCG came from ${describeRun(largestCallgraph.result)} with ${largestCallgraph.value} nodes and ${formatMetricValue("callgraph.llcg_edge_count", largestCallgraph.result.selected_metrics["callgraph.llcg_edge_count"])} edges.`
    );
    lines.push("");
    lines.push(
      `The smallest LLCG came from ${describeRun(smallestCallgraph.result)} with ${smallestCallgraph.value} nodes and ${formatMetricValue("callgraph.llcg_edge_count", smallestCallgraph.result.selected_metrics["callgraph.llcg_edge_count"])} edges.`
    );
    lines.push("");
  }

  const largestModel = findExtremeResult(results, "model.total_struct_count", "max");
  const smallestModel = findExtremeResult(results, "model.total_struct_count", "min");
  if (largestModel && smallestModel) {
    lines.push(
      `The largest model came from ${describeRun(largestModel.result)} with ${largestModel.value} total structs.`
    );
    lines.push("");
    lines.push(
      `The smallest model came from ${describeRun(smallestModel.result)} with ${smallestModel.value} total structs.`
    );
    lines.push("");
  }

  const fastestRun = findExtremeResult(results, "timing.total_seconds", "min");
  const slowestRun = findExtremeResult(results, "timing.total_seconds", "max");
  if (fastestRun && slowestRun) {
    lines.push(
      `The fastest run was ${describeRun(fastestRun.result)} at ${fastestRun.value.toFixed(3)} s.`
    );
    lines.push("");
    lines.push(
      `The slowest run was ${describeRun(slowestRun.result)} at ${slowestRun.value.toFixed(3)} s.`
    );
    lines.push("");
  }

  const collapseRatios = results
    .map((result) => {
      const collapsed = result.selected_metrics?.["callgraph.collapsed_node_count"];
      const llcg = result.selected_metrics?.["callgraph.llcg_node_count"];
      if (typeof collapsed !== "number" || typeof llcg !== "number" || llcg === 0) {
        return null;
      }
      return collapsed / llcg;
    })
    .filter((value) => typeof value === "number");
  if (collapseRatios.length > 0) {
    const minRatio = Math.min(...collapseRatios) * 100;
    const maxRatio = Math.max(...collapseRatios) * 100;
    lines.push(
      `Collapsed callgraphs retained between ${minRatio.toFixed(1)}% and ${maxRatio.toFixed(1)}% of LLCG nodes across this matrix.`
    );
    lines.push("");
  }

  const runtimeDominatesBoot = results.every((result) => {
    const runtimeBytes = result.selected_metrics?.["model.runtime.bytes"];
    const bootBytes = result.selected_metrics?.["model.booting.bytes"];
    return (
      typeof runtimeBytes === "number" &&
      typeof bootBytes === "number" &&
      runtimeBytes > bootBytes
    );
  });
  if (runtimeDominatesBoot) {
    lines.push(
      "Every run produced a larger runtime state artifact than booting state artifact."
    );
    lines.push("");
  }

  const guestKernelVersions = [...new Set(
    results
      .map((result) =>
        result.selected_metrics?.["guest.kernel_version"]
        || result.selected_metrics?.kernel_version
      )
      .filter(Boolean)
  )].sort();
  if (guestKernelVersions.length > 0) {
    lines.push(`Guest kernels covered: ${guestKernelVersions.join(", ")}.`);
    lines.push("");
  }

  const l2Modes = [...new Set(
    results
      .map((result) => result.selected_metrics?.["nvirsh.l2_mode"])
      .filter(Boolean)
  )].sort();
  if (l2Modes.length === 1) {
    lines.push(`All runs used l2 mode ${l2Modes[0]}.`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function renderNarrativeReport(results) {
  const groups = groupResultsByEvaluation(results);
  const successCount = results.filter((result) => result.status === "success").length;
  const failureCount = results.length - successCount;
  const lines = [
    "# Evaluation Analysis",
    "",
    `${successCount} of ${results.length} runs succeeded and ${failureCount} failed.`,
    "",
  ];

  if (groups.length > 1) {
    lines.push("## Overview");
    lines.push("");
    for (const group of groups) {
      const totalSeconds = sumSelectedMetric(group.results, "timing.total_seconds");
      const averageSeconds =
        group.results.length > 0 ? totalSeconds / group.results.length : 0;
      lines.push(
        `\`${group.evaluationId}\` ran ${group.results.length} workflows in ${totalSeconds.toFixed(3)} s total, with ${averageSeconds.toFixed(3)} s average runtime.`
      );
      lines.push("");
    }
  }

  for (const group of groups) {
    lines.push(renderEvaluationNarrative(group));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function tableColumns(results) {
  const metricKeys = new Set();
  for (const result of results) {
    const selectedMetrics = result.selected_metrics || {};
    for (const key of Object.keys(selectedMetrics)) {
      metricKeys.add(key);
    }
  }
  return [
    "evaluation_id",
    "workflow",
    "driver",
    "kernel",
    "status",
    "bundle_dir",
    "result_dir",
    "error_message",
    ...[...metricKeys].sort(),
  ];
}

function tableRows(results, columns) {
  return results.map((result) => {
    const row = {};
    row.evaluation_id = result.evaluation_id || "";
    row.workflow = result.workflow || "";
    row.driver = result.driver || "";
    row.kernel = result.kernel || "";
    row.status = result.status || "";
    row.bundle_dir = result.bundle_dir || "";
    row.result_dir = result.result_dir || "";
    row.error_message = result.error?.message || "";
    const selectedMetrics = result.selected_metrics || {};
    for (const column of columns) {
      if (column in row) {
        continue;
      }
      const value = selectedMetrics[column];
      row[column] =
        value != null && typeof value === "object"
          ? JSON.stringify(value)
          : (value ?? "");
    }
    return row;
  });
}

function writeTableFiles(targetRoot, results) {
  const columns = tableColumns(results);
  const rows = tableRows(results, columns);
  const csvLines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  const markdownLines = [
    `| ${columns.map(markdownCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => markdownCell(row[column])).join(" | ")} |`),
  ];
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetRoot, "evaluation-results.csv"),
    `${csvLines.join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetRoot, "evaluation-results.md"),
    `${markdownLines.join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetRoot, "evaluation-results.tex"),
    renderLatexReport(results),
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetRoot, "evaluation-analysis.md"),
    renderNarrativeReport(results),
    "utf8",
  );
}

function removeTree(targetPath) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    usage();
    return;
  }

  if (!flags.spec) {
    fail("--spec is required");
  }
  const linkMode = flags["link-mode"] || "hardlink";
  if (!["copy", "hardlink"].includes(linkMode)) {
    fail("--link-mode must be one of: copy, hardlink");
  }

  const specPath = resolveInputPath(process.cwd(), flags.spec);
  if (!fs.existsSync(specPath)) {
    fail(`missing spec: ${specPath}`);
  }
  const specDir = path.dirname(specPath);
  const spec = readJsonFile(specPath);
  const outputRoot = flags["output-root"]
    ? resolveInputPath(process.cwd(), flags["output-root"])
    : defaultOutputRoot(specPath);

  let items;
  try {
    items = selectEvaluations(spec, flags, specDir);
  } catch (error) {
    fail(error.message);
  }
  let groups;
  try {
    groups = groupEvaluationItems(items);
  } catch (error) {
    fail(error.message);
  }

  if (items.length === 0) {
    fail("no workflows matched the current filters");
  }

  if (flags["dry-run"]) {
    printPlan(items, relativeOrAbsolute(outputRoot), Boolean(flags.json));
    return;
  }

  if (fs.existsSync(outputRoot)) {
    if (!flags.force) {
      fail(`output root already exists: ${outputRoot}`);
    }
    removeTree(outputRoot);
  }
  fs.mkdirSync(outputRoot, { recursive: true });

  const startedAt = new Date().toISOString();
  const summary = {
    schema_version: 1,
    spec: relativeOrAbsolute(specPath),
    output_root: relativeOrAbsolute(outputRoot),
    started_at: startedAt,
    completed_at: null,
    status: "running",
    success_count: 0,
    failure_count: 0,
    results: [],
  };

  for (const group of groups) {
    const bundleDir = path.join(outputRoot, group.evaluation.id, "bundle");
    fs.mkdirSync(path.dirname(bundleDir), { recursive: true });
    let exportPayload = null;

    try {
      process.stderr.write(
        `export bundle for ${group.evaluation.id} with ${group.exportWorkflow}\n`
      );
      exportPayload = runJson(
        "./bin/morpheus",
        [
          "--config",
          group.configPath,
          "workflow",
          "export",
          "--name",
          group.exportWorkflow,
          "--output-dir",
          bundleDir,
          "--link-mode",
          linkMode,
          "--force",
          "--json",
        ],
        { cwd: repoRoot }
      );
    } catch (error) {
      for (const item of group.items) {
        const resultDir = path.join(outputRoot, group.evaluation.id, "results", item.workflow);
        const result = {
          status: "error",
          evaluation_id: item.evaluation.id,
          workflow: item.workflow,
          driver: item.driver,
          kernel: item.kernel,
          bundle_dir: relativeOrAbsolute(bundleDir),
          result_dir: relativeOrAbsolute(resultDir),
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
        writeJsonFile(path.join(resultDir, "evaluation-result.json"), result);
        summary.results.push(result);
        summary.failure_count += 1;
      }
      continue;
    }

    const exportManifest = readJsonFile(path.join(bundleDir, "export-manifest.json"));
    const workspaceRoot = path.join(bundleDir, exportManifest.bundle.workspace_root);
    const bundleMorpheus = path.join(bundleDir, "morpheus.sh");

    for (const item of group.items) {
      const resultDir = path.join(outputRoot, group.evaluation.id, "results", item.workflow);
      try {
        process.stderr.write(`run ${item.workflow} in exported bundle\n`);
        const bundleRunPayload = runJson(
          bundleMorpheus,
          ["workflow", "run", "--name", item.workflow, "--json"],
          { cwd: bundleDir }
        );

        const workflowDir = path.join(workspaceRoot, "workflows", item.workflow);
        if (!fs.existsSync(path.join(workflowDir, "workflow.json"))) {
          throw new Error(`missing workflow result after bundle run: ${workflowDir}`);
        }

        const metrics = collectMetrics({
          workflowDir,
          workflow: item.workflow,
          driver: item.driver,
          kernel: item.kernel,
          snapshotDate: item.snapshotDate,
          exportedAt: exportManifest.exported_at || "",
        });
        const selectedMetrics = pickMetrics(
          metrics,
          item.evaluation.evaluation_metrics || []
        );

        const result = {
          status: "success",
          evaluation_id: item.evaluation.id,
          workflow: item.workflow,
          driver: item.driver,
          kernel: item.kernel,
          bundle_dir: relativeOrAbsolute(bundleDir),
          result_dir: relativeOrAbsolute(resultDir),
          export_workflow: group.exportWorkflow,
          export: exportPayload?.details || null,
          bundle_run: {
            status: bundleRunPayload?.status || "unknown",
            summary: bundleRunPayload?.summary || "",
          },
          selected_metrics: selectedMetrics,
          metrics_file: "evaluation-metrics.json",
          result_file: "evaluation-result.json",
        };

        writeJsonFile(path.join(resultDir, "evaluation-metrics.json"), metrics);
        writeJsonFile(path.join(resultDir, "evaluation-result.json"), result);
        summary.results.push(result);
        summary.success_count += 1;
      } catch (error) {
        const result = {
          status: "error",
          evaluation_id: item.evaluation.id,
          workflow: item.workflow,
          driver: item.driver,
          kernel: item.kernel,
          bundle_dir: relativeOrAbsolute(bundleDir),
          result_dir: relativeOrAbsolute(resultDir),
          export_workflow: group.exportWorkflow,
          export: exportPayload?.details || null,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
        writeJsonFile(path.join(resultDir, "evaluation-result.json"), result);
        summary.results.push(result);
        summary.failure_count += 1;
      }
    }
  }

  summary.completed_at = new Date().toISOString();
  summary.status = summary.failure_count > 0 ? "partial" : "success";
  writeJsonFile(path.join(outputRoot, "evaluation-summary.json"), summary);
  writeTableFiles(outputRoot, summary.results);
  for (const group of groups) {
    writeTableFiles(
      path.join(outputRoot, group.evaluation.id),
      summary.results.filter((result) => result.evaluation_id === group.evaluation.id),
    );
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(`output_root=${summary.output_root}\n`);
  process.stdout.write(`summary=${relativeOrAbsolute(path.join(outputRoot, "evaluation-summary.json"))}\n`);
  for (const result of summary.results) {
    process.stdout.write(
      `evaluation=${result.evaluation_id} workflow=${result.workflow} bundle=${result.bundle_dir}\n`
    );
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
