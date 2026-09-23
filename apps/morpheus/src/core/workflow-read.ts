// @ts-nocheck
const fs = require("fs");
const path = require("path");

const {
  workflowRunsRoot,
  stageDir,
  stageManifestPath,
} = require("./workflow-runs");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function tryReadJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    const text = fs.readFileSync(filePath, "utf8");
    if (!String(text).trim()) {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  return readJsonLinesIfExists(path.join(runDir, "events.jsonl"));
}

function safeParseInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  if (!runDir) {
    return null;
  }
  if (fs.existsSync(path.join(runDir, "workflow.json"))) {
    return "workflow-first";
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

function cloneArrayEntries(values) {
  return Array.isArray(values)
    ? values.map((entry) => (entry && typeof entry === "object" ? { ...entry } : entry))
    : [];
}

function workflowStageEntries(record) {
  if (!record || typeof record !== "object") {
    return [];
  }
  if (Array.isArray(record.stages) && record.stages.length > 0) {
    return cloneArrayEntries(record.stages);
  }
  if (Array.isArray(record.stages)) {
    return cloneArrayEntries(record.stages);
  }
  return [];
}

function normalizeStageEntryAliases(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  const stagePath = typeof entry.stageDir === "string"
    ? entry.stageDir
    : (typeof entry.stepDir === "string" ? entry.stepDir : null);
  return {
    ...entry,
    stageDir: stagePath,
    stepDir: stagePath,
  };
}

function normalizeWorkflowRecordAliases(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const stageEntries = workflowStageEntries(record);
  const normalizedStages = stageEntries.map((entry) => normalizeStageEntryAliases(entry));
  const currentStageId =
    record.currentStageId != null
      ? record.currentStageId
      : (record.currentStepId != null ? record.currentStepId : null);
  const currentStepId =
    record.currentStepId != null
      ? record.currentStepId
      : currentStageId;
  return {
    ...record,
    currentStageId,
    currentStepId,
    stages: normalizedStages,
  };
}

function readStageManifestIfExists(stageDirPath, fallback = null) {
  const canonical = stageManifestPath(stageDirPath);
  if (fs.existsSync(canonical)) {
    const record = readJsonIfExists(canonical, fallback);
    return record ? normalizeStageEntryAliases(record) : fallback;
  }
  return fallback;
}

function canonicalWorkflowDir(workspaceRoot, workflowId) {
  return path.join(workflowRunsRoot(workspaceRoot), workflowId);
}

function resolveWorkflowDir(workspaceRoot, workflowId) {
  const canonicalDir = canonicalWorkflowDir(workspaceRoot, workflowId);
  if (detectRunKind(canonicalDir)) {
    return canonicalDir;
  }
  return null;
}

function readWorkflowRecord(runDir) {
  const manifestPath = path.join(runDir, "workflow.json");
  const direct = tryReadJson(manifestPath);
  if (direct && typeof direct === "object") {
    return normalizeWorkflowRecordAliases(direct);
  }
  return readJson(manifestPath);
}

function listWorkflowSteps(runDir) {
  const record = tryReadJson(path.join(runDir, "workflow.json"));
  const normalizedRecord = normalizeWorkflowRecordAliases(record);
  if (normalizedRecord && Array.isArray(normalizedRecord.stages) && normalizedRecord.stages.length > 0) {
    return normalizedRecord.stages.map((entry) => {
      const stepId = String(entry && entry.id || "");
      const resolvedStepDir =
        entry && typeof entry.stageDir === "string"
          ? entry.stageDir
          : (entry && typeof entry.stepDir === "string" ? entry.stepDir : stageDir(runDir, stepId));
      return readStageManifestIfExists(resolvedStepDir, { ...entry, id: stepId, stageDir: resolvedStepDir, stepDir: resolvedStepDir });
    });
  }
  const stagesDir = path.join(runDir, "stages");
  if (!fs.existsSync(stagesDir)) {
    return [];
  }
  return fs
    .readdirSync(stagesDir)
    .map((name) => path.join(stagesDir, name))
    .filter((entry) => fs.statSync(entry).isDirectory())
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    .map((stepDirPath) => {
      return readStageManifestIfExists(
        stepDirPath,
        {
          id: path.basename(stepDirPath),
          stageDir: stepDirPath,
          stepDir: stepDirPath,
        }
      );
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
  const normalized = normalizeWorkflowRecordAliases(record);
  const steps = Array.isArray(normalized.steps) && normalized.steps.length > 0
    ? normalized.steps
    : (Array.isArray(normalized.stages) ? normalized.stages : []);
  const stageMatches = steps.filter((entry) => String(entry.stageId || "") === stepId);
  const directMatch = steps.find((entry) => String(entry.id || "") === stepId) || null;
  const matches = stageMatches.length > 0 ? stageMatches : (directMatch ? [directMatch] : []);
  const paths = [];
  for (const match of matches) {
    const resolvedStepDir =
      match && typeof match.stageDir === "string"
        ? match.stageDir
        : (match && typeof match.stepDir === "string" ? match.stepDir : stageDir(runDir, String(match && match.id ? match.id : stepId)));
    const manifest = readStageManifestIfExists(resolvedStepDir, null);
    paths.push(
      manifest && typeof manifest.logFile === "string"
        ? manifest.logFile
        : path.join(resolvedStepDir, "stdout.log"),
    );
    paths.push(...stepSiblingLogPaths(resolvedStepDir));
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
  }

  return uniquePaths(paths);
}

function loadWorkflowStepLogPaths(workspaceRoot, runId, stepId) {
  const runDir = resolveWorkflowDir(workspaceRoot, runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return [];
  }
  return workflowStepLogPaths(runDir, stepId);
}

function loadWorkflowStepLogFiles(workspaceRoot, runId, stepId) {
  const runDir = resolveWorkflowDir(workspaceRoot, runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return [];
  }
  const stageFiles = workflowStepLogPaths(runDir, stepId);
  const workflowRecord = tryReadJson(path.join(runDir, "workflow.json")) || {};
  const stageEntries = Array.isArray(workflowRecord.stages) ? workflowRecord.stages : [];
  const matches = stageEntries.filter((entry) => String(entry.stageId || entry.id || "") === stepId || String(entry.id || "") === stepId);
  const runtimeFiles = [];
  for (const match of matches) {
    const stepDir =
      match && typeof match.stepDir === "string"
        ? match.stepDir
        : (match && typeof match.stageDir === "string" ? match.stageDir : stageDir(runDir, String(match && match.id ? match.id : stepId)));
    const runtimeDir = path.join(stepDir, "runtime");
    const runtimeManifest = readJsonIfExists(path.join(runtimeDir, "manifest.json"), null);
    if (runtimeManifest && typeof runtimeManifest.logFile === "string") {
      runtimeFiles.push(runtimeManifest.logFile);
    }
    if (runtimeManifest && runtimeManifest.stderr && typeof runtimeManifest.stderr === "string") {
      runtimeFiles.push(runtimeManifest.stderr);
    }
    if (runtimeManifest && runtimeManifest.l1Console && typeof runtimeManifest.l1Console === "string") {
      runtimeFiles.push(runtimeManifest.l1Console);
    }
    runtimeFiles.push(...stepSiblingLogPaths(runtimeDir));
  }
  return uniquePaths([...stageFiles, ...runtimeFiles].filter((filePath) => fs.existsSync(filePath)));
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
    logUrl: logExists ? `/api/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stepId)}/log` : null,
    artifactCount: artifacts.length,
    artifacts,
    parameters: stepParameters(manifest),
    stageDir: typeof manifest?.stageDir === "string"
      ? manifest.stageDir
      : (typeof entry?.stageDir === "string" ? entry.stageDir : null),
    stepDir: typeof manifest?.stepDir === "string"
      ? manifest.stepDir
      : (typeof entry?.stepDir === "string" ? entry.stepDir : null),
    stageId: typeof manifest?.stageId === "string"
      ? manifest.stageId
      : (typeof entry?.stageId === "string" ? entry.stageId : null),
    stageName: typeof manifest?.stageName === "string"
      ? manifest.stageName
      : (typeof entry?.stageName === "string" ? entry.stageName : null),
    stageIndex: asNumber(manifest?.stageIndex) ?? asNumber(entry?.stageIndex),
    stageStepIndex: asNumber(manifest?.stageStepIndex) ?? asNumber(entry?.stageStepIndex),
  };
}

function groupStageSummaries(stepSummaries) {
  const groups = [];
  const seen = new Map();
  for (const step of stepSummaries) {
    const stageId = step.stageId || step.id;
    let group = seen.get(stageId);
    if (!group) {
      group = {
        id: stageId,
        name: step.stageName || stageId,
        stageDir: step.stageDir || null,
        stepDir: step.stepDir || null,
        status: "unknown",
        stepCount: 0,
        steps: [],
      };
      seen.set(stageId, group);
      groups.push(group);
    }
    group.steps.push(step);
    group.stepCount += 1;
    group.stageDir = group.stageDir || step.stageDir || step.stepDir || null;
    group.stepDir = group.stepDir || step.stepDir || step.stageDir || null;
    group.name = step.stageName || group.name;
  }
  for (const group of groups) {
    group.status = workflowStatusFromSteps("unknown", group.steps);
  }
  return groups;
}

function summarizeWorkflowFirst(runDir) {
  const record = readWorkflowRecord(runDir);
  const events = readRunEvents(runDir);
  const relations = eventArtifactsConsumed(events);
  const stepEntries = Array.isArray(record.steps) && record.steps.length > 0
    ? record.steps
    : (Array.isArray(record.stages) ? record.stages : []);
  const stepRecords = stepEntries.map((entry) => {
    const stepId = String(entry.id || "");
    const stepDirPath =
      typeof entry.stageDir === "string"
        ? entry.stageDir
        : (typeof entry.stepDir === "string" ? entry.stepDir : stageDir(runDir, stepId));
    const manifest = readStageManifestIfExists(stepDirPath, null);
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
  const stages = groupStageSummaries(steps);
  const graph = buildGraph(steps, relations);
  const status = workflowStatusFromSteps(record.status, steps);
  return {
    id: String(record.id || path.basename(runDir)),
    kind: "workflow",
    format: "workflow-first",
    category: normalizeWorkflowCategory(record.category),
    workflowName: typeof record.workflow === "string" ? record.workflow : null,
    metadata: record.metadata == null ? null : record.metadata,
    status,
    createdAt: record.createdAt || null,
    completedAt: status === "success" || status === "error" ? record.updatedAt || null : null,
    changeName: null,
    stageCount: stages.length,
    stepCount: steps.length,
    runDir,
    graph,
    stages,
    steps,
    record,
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
  const runDir = resolveWorkflowDir(workspaceRoot, runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return null;
  }
  return summarizeWorkflowFirst(runDir);
}

function loadWorkflowEvents(workspaceRoot, runId) {
  const runDir = resolveWorkflowDir(workspaceRoot, runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return null;
  }
  return readRunEvents(runDir);
}

function loadWorkflowStepLogText(workspaceRoot, runId, stepId) {
  const runDir = resolveWorkflowDir(workspaceRoot, runId);
  const kind = detectRunKind(runDir);
  if (!kind) {
    return null;
  }

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

function loadWorkflowLogText(workspaceRoot, runId) {
  const detail = loadWorkflowDetail(workspaceRoot, runId);
  if (!detail) {
    return null;
  }
  const runDir = detail.runDir;
  const sections = [];
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
  loadWorkflowStepLogPaths,
  loadWorkflowStepLogFiles,
  detectRunKind,
  listWorkflowSteps,
};
