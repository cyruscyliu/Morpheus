// @ts-nocheck
const fs = require("fs");
const path = require("path");

const WORKFLOW_SCHEMA_VERSION = 1;
const STEP_SCHEMA_VERSION = 1;

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

function workflowRunsRoot(workspaceRoot) {
  return path.join(path.resolve(process.cwd(), workspaceRoot), "runs");
}

function workflowRunDir(workspaceRoot, workflowRunId) {
  return path.join(workflowRunsRoot(workspaceRoot), workflowRunId);
}

function workflowManifestPath(workflowRunDir) {
  return path.join(workflowRunDir, "workflow.json");
}

function legacyRunRecordPath(workflowRunDir) {
  return path.join(workflowRunDir, "run.json");
}

function stepDir(workflowRunDir, stepId) {
  return path.join(workflowRunDir, "steps", stepId);
}

function stepManifestPath(stepDir) {
  return path.join(stepDir, "step.json");
}

function stepLogPath(stepDir) {
  return path.join(stepDir, "stdout.log");
}

function stepArtifactsDir(stepDir) {
  return path.join(stepDir, "artifacts");
}

function stepToolRunDir(stepDir) {
  return path.join(stepDir, "run");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createWorkflowRun(workspaceRoot, workflowName, options = {}) {
  const id = options.id || generateWorkflowRunId();
  const runDir = workflowRunDir(workspaceRoot, id);
  const createdAt = nowIso();
  fs.mkdirSync(path.join(runDir, "steps"), { recursive: true });

  const record = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id,
    workflow: workflowName || "workflow",
    status: "created",
    createdAt,
    updatedAt: createdAt,
    workspace: path.resolve(process.cwd(), workspaceRoot),
    runDir,
    steps: []
  };

  writeJson(workflowManifestPath(runDir), record);
  writeJson(legacyRunRecordPath(runDir), {
    id,
    kind: "workflow",
    status: record.status,
    createdAt: record.createdAt,
    completedAt: null,
    summary: { workflow: record.workflow }
  });
  return record;
}

function updateWorkflowRun(runDir, mutator) {
  const manifestPath = workflowManifestPath(runDir);
  const current = readJson(manifestPath);
  const next = mutator({ ...current });
  next.updatedAt = nowIso();
  writeJson(manifestPath, next);
  writeJson(legacyRunRecordPath(runDir), {
    id: next.id,
    kind: "workflow",
    status: next.status,
    createdAt: next.createdAt,
    completedAt: next.status === "success" || next.status === "error" ? next.updatedAt : null,
    summary: { workflow: next.workflow }
  });
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
  const record = {
    schemaVersion: STEP_SCHEMA_VERSION,
    id: stepId,
    name: name || stepId,
    status: "created",
    createdAt,
    updatedAt: createdAt,
    stepDir: dir,
    toolRunDir: stepToolRunDir(dir),
    logFile: stepLogPath(dir),
    artifactsDir: stepArtifactsDir(dir),
    tool: options.tool || null,
    mode: options.mode || null,
    inputs: options.inputs || [],
    expectedArtifacts: options.expectedArtifacts || [],
    artifacts: options.artifacts || []
  };

  writeJson(stepManifestPath(dir), record);
  return record;
}

function updateWorkflowStep(stepDirPath, mutator) {
  const manifestPath = stepManifestPath(stepDirPath);
  const current = readJson(manifestPath);
  const next = mutator({ ...current });
  next.updatedAt = nowIso();
  writeJson(manifestPath, next);
  return next;
}

module.exports = {
  createWorkflowRun,
  createWorkflowStep,
  generateWorkflowRunId,
  sanitizeStepName,
  legacyRunRecordPath,
  stepArtifactsDir,
  stepToolRunDir,
  stepDir,
  stepLogPath,
  stepManifestPath,
  updateWorkflowRun,
  updateWorkflowStep,
  workflowManifestPath,
  workflowRunDir,
  workflowRunsRoot
};
