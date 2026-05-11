// @ts-nocheck
const fs = require("fs");
const path = require("path");

const {
  workflowRunsRoot,
} = require("./workflow-runs");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return readJson(filePath);
  } catch {
    return fallback;
  }
}

function readJsonLinesIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function readRunEvents(runDir) {
  const canonical = readJsonLinesIfExists(path.join(runDir, "events.jsonl"));
  if (canonical.length > 0) {
    return canonical;
  }
  const progress = readJsonLinesIfExists(path.join(runDir, "progress.jsonl"));
  return progress.map((entry) => ({
    ts: entry.ts,
    producer: "morpheus",
    level: entry.level || "info",
    scope: entry.scope || "workflow",
    event: "morpheus.log",
    workflow_id: null,
    step_id: null,
    tool: null,
    data: {
      message: entry.message || null,
      fields: entry.fields || {},
    },
  }));
}

function safeParseInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function fileHasLogContent(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    return fs.readFileSync(filePath, "utf8").trimEnd().length > 0;
  } catch {
    return false;
  }
}

function listRunDirs(runRoot) {
  if (!fs.existsSync(runRoot)) {
    return [];
  }
  return fs
    .readdirSync(runRoot)
    .filter((name) => /^[A-Za-z0-9._-]+$/.test(name))
    .map((name) => path.join(runRoot, name))
    .filter((entry) => fs.statSync(entry).isDirectory());
}

function detectRunKind(runDir) {
  if (fs.existsSync(path.join(runDir, "workflow.json"))) {
    return "workflow-first";
  }
  if (fs.existsSync(path.join(runDir, "run.json"))) {
    return "legacy";
  }
  return null;
}

function normalizeWorkflowCategory(value) {
  const category = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (category === "build" || category === "run") {
    return category;
  }
  return "unknown";
}

function readWorkflowRecord(runDir) {
  return readJson(path.join(runDir, "workflow.json"));
}

function readLegacyRecord(runDir) {
  return readJson(path.join(runDir, "run.json"));
}

function listWorkflowSteps(runDir) {
  const stepsDir = path.join(runDir, "steps");
  if (!fs.existsSync(stepsDir)) {
    return [];
  }
  return fs
    .readdirSync(stepsDir)
    .map((name) => path.join(stepsDir, name))
    .filter((entry) => fs.statSync(entry).isDirectory())
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    .map((stepDir) => {
      const manifestPath = path.join(stepDir, "step.json");
      return fs.existsSync(manifestPath) ? readJson(manifestPath) : { id: path.basename(stepDir), stepDir };
    });
}

function uniquePaths(values) {
  return [...new Set(values.filter(Boolean))];
}

function stepSiblingLogPaths(stepDir) {
  if (!fs.existsSync(stepDir)) {
    return [];
  }
  return fs
    .readdirSync(stepDir)
    .filter((name) => name.endsWith(".log"))
    .map((name) => path.join(stepDir, name))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    })
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

function normalizeArtifactsArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const p = typeof entry.path === "string" ? entry.path : "";
      const loc =
        typeof entry.location === "string"
          ? entry.location
          : typeof entry.local_location === "string"
            ? entry.local_location
            : typeof entry.remote_location === "string"
              ? entry.remote_location
              : "";
      if (!p || !loc) {
        return null;
      }
      return { path: p, location: loc };
    })
    .filter(Boolean);
}

function toolResultArtifacts(record) {
  return normalizeArtifactsArray(record?.toolResult?.details?.artifacts);
}

function eventArtifactsConsumed(events) {
  return events
    .filter((entry) => entry && entry.event === "artifact.consumed" && entry.step_id)
    .map((entry) => ({
      kind: "artifact",
      from: entry.data?.from_step || null,
      to: entry.step_id || null,
      artifactPath: entry.data?.artifact_path || null,
      consumedAs: entry.data?.consumed_as || null,
      artifactLocation: entry.data?.artifact_location || null,
    }))
    .filter((entry) => typeof entry.from === "string" && typeof entry.to === "string");
}

function workflowStepLogPaths(runDir, stepId) {
  const recordPath = path.join(runDir, "workflow.json");
  if (!fs.existsSync(recordPath)) {
    return [];
  }
  const record = readJson(recordPath);
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const match = steps.find((entry) => String(entry.id || "") === stepId) || null;
  const resolvedStepDir =
    match && typeof match.stepDir === "string" ? match.stepDir : path.join(runDir, "steps", stepId);
  const manifest = readJsonIfExists(path.join(resolvedStepDir, "step.json"), null);
  const paths = [
    manifest && typeof manifest.logFile === "string"
      ? manifest.logFile
      : path.join(resolvedStepDir, "stdout.log"),
    ...stepSiblingLogPaths(resolvedStepDir),
  ];

  const managedRunManifest = readJsonIfExists(path.join(resolvedStepDir, "run", "manifest.json"), null);
  if (managedRunManifest && typeof managedRunManifest.logFile === "string") {
    paths.push(managedRunManifest.logFile);
  }
  const providerLog =
    managedRunManifest &&
    managedRunManifest.runtime &&
    managedRunManifest.runtime.providerRun &&
    typeof managedRunManifest.runtime.providerRun.log_file === "string"
      ? managedRunManifest.runtime.providerRun.log_file
      : "";
  if (providerLog) {
    paths.push(providerLog);
  }

  const stderrLog = path.join(resolvedStepDir, "stderr.log");
  if (fs.existsSync(stderrLog)) {
    paths.push(stderrLog);
  }

  return uniquePaths(paths);
}

function buildGraph(steps, relations) {
  const nodes = steps.map((step) => ({
    id: step.id,
    name: step.name,
    kind: step.kind,
    status: step.status,
    artifactCount: step.artifactCount || 0,
    parameters: Array.isArray(step.parameters) ? step.parameters : [],
  }));

  const stepIds = new Set(steps.map((step) => step.id));
  const edges = [];
  const relationKeys = new Set();

  for (let index = 0; index < steps.length - 1; index += 1) {
    const source = steps[index];
    const target = steps[index + 1];
    if (!source || !target) {
      continue;
    }
    edges.push({
      id: `sequence:${source.id}:${target.id}`,
      source: source.id,
      target: target.id,
      kind: "sequence",
      label: null,
      artifactPath: null,
      inferred: true,
    });
  }

  for (const relation of relations) {
    const source = typeof relation?.from === "string" ? relation.from : "";
    const target = typeof relation?.to === "string" ? relation.to : "";
    if (!stepIds.has(source) || !stepIds.has(target)) {
      continue;
    }
    const kind = relation.kind === "sequence" ? "sequence" : "artifact";
    const relationKey = JSON.stringify({
      kind,
      source,
      target,
      artifactPath: relation.artifactPath || null,
      consumedAs: relation.consumedAs || null,
      artifactLocation: relation.artifactLocation || null,
    });
    if (relationKeys.has(relationKey)) {
      continue;
    }
    relationKeys.add(relationKey);
    edges.push({
      id: `relation:${kind}:${source}:${target}:${relation.artifactPath || relation.kind || "edge"}`,
      source,
      target,
      kind,
      label: relation.artifactPath || relation.consumedAs || relation.kind || null,
      artifactPath: relation.artifactPath || null,
      inferred: false,
    });
  }

  return { nodes, edges };
}

function workflowStatusFromSteps(recordStatus, steps) {
  if (steps.some((step) => step.status === "running")) {
    return "running";
  }
  if (steps.some((step) => step.status === "error" || step.status === "failed")) {
    return "error";
  }
  if (steps.some((step) => step.status === "stopped")) {
    return "stopped";
  }
  if (steps.length > 0 && steps.every((step) => step.status === "success" || step.status === "reused")) {
    return "success";
  }
  return String(recordStatus || "unknown");
}

function stepParameters(manifest) {
  const params = [];
  const mode = typeof manifest?.resolvedInputs?.mode === "string"
    ? manifest.resolvedInputs.mode.trim()
    : "";
  if (mode) {
    params.push(mode);
  }
  return params;
}

function normalizeStepSummary(entry, manifest, runId, stepId, logExists, artifacts) {
  const rawName = typeof manifest?.name === "string" ? manifest.name : (typeof entry?.name === "string" ? entry.name : null);
  const displayName = rawName && !/^[a-z0-9-]+\.run$/i.test(rawName)
    ? rawName
    : stepId.replace(/^[0-9]+-/, "");
  const normalizedStatus =
    (typeof manifest?.status === "string" ? manifest.status : "")
    || (typeof entry?.status === "string" ? entry.status : "")
    || "unknown";
  return {
    id: stepId,
    name: displayName,
    kind: typeof manifest?.kind === "string" ? manifest.kind : (typeof entry?.kind === "string" ? entry.kind : null),
    status: normalizedStatus,
    startedAt: manifest?.startedAt || entry?.startedAt || null,
    endedAt: manifest?.endedAt || entry?.endedAt || null,
    logUrl: logExists ? `/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/log` : null,
    artifactCount: artifacts.length,
    artifacts,
    parameters: stepParameters(manifest),
  };
}

function summarizeWorkflowFirst(runDir) {
  const record = readWorkflowRecord(runDir);
  const events = readRunEvents(runDir);
  const relations = eventArtifactsConsumed(events);
  const stepEntries = Array.isArray(record.steps) ? record.steps : [];
  const stepRecords = stepEntries.map((entry) => {
    const stepId = String(entry.id || "");
    const stepDir = typeof entry.stepDir === "string" ? entry.stepDir : path.join(runDir, "steps", stepId);
    const manifest = readJsonIfExists(path.join(stepDir, "step.json"), null);
    const manifestArtifacts = normalizeArtifactsArray(manifest?.artifacts);
    const artifacts = manifestArtifacts.length > 0 ? manifestArtifacts : toolResultArtifacts(manifest);
    const hasLogs = workflowStepLogPaths(runDir, stepId).some((logFile) => fileHasLogContent(logFile));
    const summary = normalizeStepSummary(entry, manifest, record.id || path.basename(runDir), stepId, hasLogs, artifacts);
    if (hasLogs) {
      summary.logText = loadWorkflowStepLogText(path.dirname(runDir), record.id || path.basename(runDir), stepId);
    }
    return { summary, manifest };
  });
  const steps = stepRecords.map((entry) => entry.summary);
  const graph = buildGraph(steps, relations);
  const status = workflowStatusFromSteps(record.status, steps);
  return {
    id: String(record.id || path.basename(runDir)),
    kind: "workflow",
    format: "workflow-first",
    category: normalizeWorkflowCategory(record.category),
    workflowName: typeof record.workflow === "string" ? record.workflow : null,
    status,
    createdAt: record.createdAt || null,
    completedAt: status === "success" || status === "error" ? record.updatedAt || null : null,
    changeName: null,
    stepCount: steps.length,
    runDir,
    graph,
    steps,
    record,
  };
}

function summarizeLegacy(runDir) {
  const record = readLegacyRecord(runDir);
  const index = readJsonIfExists(path.join(runDir, "index.json"), { steps: [] });
  const stepsIndex = Array.isArray(index.steps) ? index.steps : [];
  const stepSummaries = stepsIndex.map((entry) => {
    const stepId = String(entry.id || "");
    const stepDir = entry && entry.dir ? path.join(runDir, entry.dir) : path.join(runDir, "steps", stepId);
    const stepRecord = readJsonIfExists(path.join(stepDir, "step.json"), null) || {};
    const hasLog = fs.existsSync(path.join(stepDir, "logs", "stdout.log"));
    const artifacts = normalizeArtifactsArray(stepRecord.artifacts || []);
    return {
      id: stepId,
      name: typeof entry.name === "string" ? entry.name : stepId,
      kind: typeof entry.kind === "string" ? entry.kind : null,
      status: String(entry.status || stepRecord.status || "unknown"),
      startedAt: entry.startedAt || stepRecord.startedAt || null,
      endedAt: entry.endedAt || stepRecord.endedAt || null,
      logUrl: hasLog ? `/api/runs/${encodeURIComponent(record.id || path.basename(runDir))}/steps/${encodeURIComponent(stepId)}/log` : null,
      artifactCount: artifacts.length,
      artifacts,
      parameters: [],
    };
  });
  return {
    id: String(record.id || path.basename(runDir)),
    kind: String(record.kind || "run"),
    format: "legacy",
    category: normalizeWorkflowCategory(record.category || record.summary?.category || record.kind),
    workflowName: typeof record.summary?.workflow === "string" ? record.summary.workflow : null,
    status: String(record.status || "unknown"),
    createdAt: record.createdAt || null,
    completedAt: record.completedAt || null,
    changeName: record.changeName || null,
    stepCount: stepSummaries.length,
    runDir,
    graph: buildGraph(stepSummaries, []),
    steps: stepSummaries,
  };
}

function listWorkflowRuns(workspaceRoot, options = {}) {
  const root = workflowRunsRoot(workspaceRoot);
  const offset = safeParseInt(options.offset, 0);
  const limit = Math.min(500, safeParseInt(options.limit, 200));
  const runs = listRunDirs(root)
    .map((runDir) => {
      const kind = detectRunKind(runDir);
      if (kind === "workflow-first") {
        return summarizeWorkflowFirst(runDir);
      }
      if (kind === "legacy") {
        return summarizeLegacy(runDir);
      }
      return null;
    })
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt || right.id || "").localeCompare(String(left.createdAt || left.id || "")));
  return {
    runs: runs.slice(offset, offset + limit),
    total: runs.length,
    offset,
    limit,
  };
}

function loadWorkflowDetail(workspaceRoot, runId) {
  const runDir = path.join(workflowRunsRoot(workspaceRoot), runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return null;
  }
  return kind === "workflow-first" ? summarizeWorkflowFirst(runDir) : summarizeLegacy(runDir);
}

function loadWorkflowEvents(workspaceRoot, runId) {
  const runDir = path.join(workflowRunsRoot(workspaceRoot), runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return null;
  }
  return readRunEvents(runDir);
}

function loadWorkflowStepLogText(workspaceRoot, runId, stepId) {
  const runDir = path.join(workflowRunsRoot(workspaceRoot), runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return null;
  }

  if (kind === "workflow-first") {
    const parts = workflowStepLogPaths(runDir, stepId)
      .map((logFile) => ({ logFile, text: readTextIfExists(logFile).trimEnd() }))
      .filter((entry) => entry.text);
    if (parts.length === 0) {
      return null;
    }
    if (parts.length === 1) {
      return parts[0]?.text || null;
    }
    return parts
      .map((entry) => [`=== ${path.basename(entry.logFile)} ===`, entry.text].join("\n"))
      .join("\n\n");
  }

  const index = readJsonIfExists(path.join(runDir, "index.json"), { steps: [] });
  const stepsIndex = Array.isArray(index.steps) ? index.steps : [];
  const match = stepsIndex.find((entry) => String(entry.id || "") === stepId) || null;
  const stepDir =
    match && match.dir ? path.join(runDir, match.dir) : path.join(runDir, "steps", stepId);
  const logFile = path.join(stepDir, "logs", "stdout.log");
  if (!fs.existsSync(logFile)) {
    return null;
  }
  return fs.readFileSync(logFile, "utf8");
}

function loadWorkflowLogText(workspaceRoot, runId) {
  const detail = loadWorkflowDetail(workspaceRoot, runId);
  if (!detail) {
    return null;
  }
  const runDir = path.join(workflowRunsRoot(workspaceRoot), runId);
  const sections = [];
  const progressLog = readTextIfExists(path.join(runDir, "progress.jsonl")).trim();
  if (progressLog) {
    sections.push(progressLog);
  }

  for (const step of detail.steps) {
    const stepLog = loadWorkflowStepLogText(workspaceRoot, runId, step.id);
    if (!stepLog || !stepLog.trim()) {
      continue;
    }
    sections.push(stepLog.trimEnd());
  }

  return sections.join("\n\n");
}

module.exports = {
  listWorkflowRuns,
  loadWorkflowDetail,
  loadWorkflowEvents,
  loadWorkflowLogText,
  loadWorkflowStepLogText,
  detectRunKind,
  listWorkflowSteps,
};
