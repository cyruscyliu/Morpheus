// @ts-nocheck
const fs = require("fs");
const path = require("path");

const WORKFLOW_SCHEMA_VERSION = 1;
const STAGE_SCHEMA_VERSION = 1;

function normalizeWorkflowCategory(value, fallback = "build") {
  const category = String(value || "").trim().toLowerCase();
  if (category === "build" || category === "run") {
    return category;
  }
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function generateWorkflowRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 10);
  return `wf-${stamp}-${random}`;
}

function sanitizeStepName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "step";
}

function workflowInstancesRoot(workspaceRoot) {
  return path.join(path.resolve(process.cwd(), workspaceRoot), "runs");
}

function workflowRunsRoot(workspaceRoot) {
  return workflowInstancesRoot(workspaceRoot);
}

function workflowRunDir(workspaceRoot, workflowRunId) {
  return path.join(workflowRunsRoot(workspaceRoot), workflowRunId);
}

function workflowManifestPath(workflowRunDir) {
  return path.join(workflowRunDir, "workflow.json");
}

function workflowEventLogPath(workflowRunDir) {
  return path.join(workflowRunDir, "events.jsonl");
}

function stageDir(workflowRunDir, stageId) {
  return path.join(workflowRunDir, "stages", stageId);
}

function stepDir(workflowRunDir, stepId) {
  return stageDir(workflowRunDir, stepId);
}

function stageManifestPath(stageDirPath) {
  return path.join(stageDirPath, "stage.json");
}

function stepManifestPath(stepDir) {
  return stageManifestPath(stepDir);
}

function stepLogPath(stepDir) {
  return path.join(stepDir, "stdout.log");
}

function stepArtifactsDir(stepDir) {
  return path.join(stepDir, "artifacts");
}

function stepToolRunDir(stepDir) {
  return stepDir;
}

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function normalizeStageRecordAliases(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const stagePath = typeof record.stageDir === "string"
    ? record.stageDir
    : (typeof record.stepDir === "string" ? record.stepDir : null);
  return {
    ...record,
    stageDir: stagePath,
    stepDir: stagePath,
  };
}

function listRunDirs(runRoot) {
  if (!fs.existsSync(runRoot)) {
    return [];
  }
  return fs
    .readdirSync(runRoot)
    .filter((name) => /^[A-Za-z0-9._-]+$/.test(name))
    .map((name) => path.join(runRoot, name))
    .filter((entry) => {
      try {
        return fs.statSync(entry).isDirectory();
      } catch {
        return false;
      }
    });
}

function createWorkflowRun(workspaceRoot, workflowName, options = {}) {
  const id = String(options.id || workflowName || generateWorkflowRunId()).trim();
  const runDir = workflowRunDir(workspaceRoot, id);
  const createdAt = nowIso();
  const category = normalizeWorkflowCategory(options.category, "build");
  fs.mkdirSync(path.join(runDir, "stages"), { recursive: true });
  if (!fs.existsSync(workflowEventLogPath(runDir))) {
    fs.writeFileSync(workflowEventLogPath(runDir), "", "utf8");
  }

  const record = normalizeWorkflowRecordAliases({
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id,
    workflow: workflowName || "workflow",
    configPath: options.configPath || null,
    metadata: options.metadata == null ? null : options.metadata,
    category,
    status: "created",
    createdAt,
    updatedAt: createdAt,
    eventLogFile: workflowEventLogPath(runDir),
    workspace: path.resolve(process.cwd(), workspaceRoot),
    workflowDir: runDir,
    runDir,
    currentStageId: null,
    stages: [],
  });

  writeJson(workflowManifestPath(runDir), record);
  return record;
}

function updateWorkflowRun(runDir, mutator) {
  const manifestPath = workflowManifestPath(runDir);
  const current = normalizeWorkflowRecordAliases(readJson(manifestPath));
  const next = normalizeWorkflowRecordAliases(mutator({ ...current }));
  next.category = normalizeWorkflowCategory(next.category, normalizeWorkflowCategory(current.category, "build"));
  next.updatedAt = nowIso();
  writeJson(manifestPath, next);
  return next;
}

function createWorkflowStep(runDir, index, name, options = {}) {
  const stepId = options.id || `${String(index).padStart(2, "0")}-${sanitizeStepName(name)}`;
  const dir = stepDir(runDir, stepId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(stepArtifactsDir(dir), { recursive: true });
  if (!fs.existsSync(stepLogPath(dir))) {
    fs.writeFileSync(stepLogPath(dir), "", "utf8");
  }

  const createdAt = nowIso();
  const record = normalizeStageRecordAliases({
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: stepId,
    name: name || stepId,
    status: "created",
    createdAt,
    updatedAt: createdAt,
    eventLogFile: workflowEventLogPath(runDir),
    stageDir: dir,
    stepDir: dir,
    toolRunDir: stepToolRunDir(dir),
    logFile: stepLogPath(dir),
    artifactsDir: stepArtifactsDir(dir),
    tool: options.tool || null,
    stageId: options.stageId || null,
    stageName: options.stageName || null,
    stageIndex: Number.isInteger(options.stageIndex) ? options.stageIndex : null,
    stageStepIndex: Number.isInteger(options.stageStepIndex) ? options.stageStepIndex : null,
    mode: options.mode || null,
    inputs: options.inputs || [],
    expectedArtifacts: options.expectedArtifacts || [],
    artifacts: options.artifacts || []
  });

  writeJson(stepManifestPath(dir), record);
  return record;
}

function updateWorkflowStep(stepDirPath, mutator) {
  const manifestPath = stepManifestPath(stepDirPath);
  const current = normalizeStageRecordAliases(readJson(manifestPath));
  const next = normalizeStageRecordAliases(mutator({ ...current }));
  next.updatedAt = nowIso();
  writeJson(manifestPath, next);
  return next;
}

module.exports = {
  createWorkflowRun,
  createWorkflowStep,
  generateWorkflowRunId,
  sanitizeStepName,
  stageDir,
  stageManifestPath,
  stepArtifactsDir,
  stepToolRunDir,
  stepDir,
  workflowInstancesRoot,
  workflowEventLogPath,
  stepLogPath,
  stepManifestPath,
  updateWorkflowRun,
  updateWorkflowStep,
  workflowManifestPath,
  workflowRunDir,
  workflowRunsRoot
};
