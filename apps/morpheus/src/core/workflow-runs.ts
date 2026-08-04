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
  return path.join(path.resolve(process.cwd(), workspaceRoot), "workflows");
}

function workflowRunsRoot(workspaceRoot) {
  return workflowInstancesRoot(workspaceRoot);
}

function legacyWorkflowRunsRoot(workspaceRoot) {
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

function workflowEventLogPath(workflowRunDir) {
  return path.join(workflowRunDir, "events.jsonl");
}

function stageDir(workflowRunDir, stageId) {
  return path.join(workflowRunDir, "stages", stageId);
}

function legacyStepDir(workflowRunDir, stepId) {
  return path.join(workflowRunDir, "steps", stepId);
}

function stepDir(workflowRunDir, stepId) {
  return stageDir(workflowRunDir, stepId);
}

function stageManifestPath(stageDirPath) {
  return path.join(stageDirPath, "stage.json");
}

function legacyStepManifestPath(stepDirPath) {
  return path.join(stepDirPath, "step.json");
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
  if (Array.isArray(record.steps) && record.steps.length > 0) {
    return cloneArrayEntries(record.steps);
  }
  if (Array.isArray(record.stages)) {
    return cloneArrayEntries(record.stages);
  }
  if (Array.isArray(record.steps)) {
    return cloneArrayEntries(record.steps);
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
    steps: normalizedStages.map((entry) => ({ ...entry })),
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

function readLegacyWorkflowName(runDir) {
  const workflowRecord = tryReadJson(path.join(runDir, "workflow.json"));
  if (workflowRecord && typeof workflowRecord.workflow === "string" && workflowRecord.workflow.trim()) {
    return workflowRecord.workflow.trim();
  }
  const legacyRecord = tryReadJson(path.join(runDir, "run.json"));
  if (
    legacyRecord
    && legacyRecord.summary
    && typeof legacyRecord.summary.workflow === "string"
    && legacyRecord.summary.workflow.trim()
  ) {
    return legacyRecord.summary.workflow.trim();
  }
  return null;
}

function workflowCreatedAt(runDir) {
  const workflowRecord = tryReadJson(path.join(runDir, "workflow.json"));
  if (workflowRecord && typeof workflowRecord.createdAt === "string" && workflowRecord.createdAt.trim()) {
    return workflowRecord.createdAt.trim();
  }
  const legacyRecord = tryReadJson(path.join(runDir, "run.json"));
  if (legacyRecord && typeof legacyRecord.createdAt === "string" && legacyRecord.createdAt.trim()) {
    return legacyRecord.createdAt.trim();
  }
  return path.basename(runDir);
}

function findLatestLegacyWorkflowRunDir(workspaceRoot, workflowName) {
  const normalized = String(workflowName || "").trim();
  if (!normalized) {
    return null;
  }
  const root = legacyWorkflowRunsRoot(workspaceRoot);
  const matches = listRunDirs(root)
    .filter((runDir) => readLegacyWorkflowName(runDir) === normalized)
    .sort((left, right) => String(workflowCreatedAt(right)).localeCompare(String(workflowCreatedAt(left))));
  return matches[0] || null;
}

function rewritePathString(value, sourceRoot, targetRoot) {
  if (typeof value !== "string") {
    return value;
  }
  if (value === sourceRoot) {
    return targetRoot;
  }
  const prefix = `${sourceRoot}${path.sep}`;
  if (value.startsWith(prefix)) {
    return path.join(targetRoot, value.slice(prefix.length));
  }
  return value;
}

function rewritePathTree(value, sourceRoot, targetRoot) {
  if (Array.isArray(value)) {
    return value.map((entry) => rewritePathTree(entry, sourceRoot, targetRoot));
  }
  if (!value || typeof value !== "object") {
    return rewritePathString(value, sourceRoot, targetRoot);
  }
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = rewritePathTree(entry, sourceRoot, targetRoot);
  }
  return next;
}

function copyTree(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(sourcePath);
      try {
        fs.unlinkSync(targetPath);
      } catch {}
      fs.symlinkSync(link, targetPath);
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function rewriteJsonFilePaths(filePath, sourceRoot, targetRoot) {
  const text = fs.readFileSync(filePath, "utf8");
  if (!String(text).trim()) {
    return;
  }
  const next = rewritePathTree(JSON.parse(text), sourceRoot, targetRoot);
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function rewriteJsonlFilePaths(filePath, sourceRoot, targetRoot) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return "";
    }
    try {
      return JSON.stringify(rewritePathTree(JSON.parse(line), sourceRoot, targetRoot));
    } catch {
      return line;
    }
  }).join("\n");
  fs.writeFileSync(filePath, next.endsWith("\n") || next.length === 0 ? next : `${next}\n`, "utf8");
}

function rewriteCopiedTreePaths(targetDir, sourceRoot, targetRoot) {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      rewriteCopiedTreePaths(targetPath, sourceRoot, targetRoot);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.endsWith(".json")) {
      try {
        rewriteJsonFilePaths(targetPath, sourceRoot, targetRoot);
      } catch {}
      continue;
    }
    if (entry.name.endsWith(".jsonl")) {
      try {
        rewriteJsonlFilePaths(targetPath, sourceRoot, targetRoot);
      } catch {}
    }
  }
}

function rewriteWorkflowIdsInJsonl(filePath, workflowId) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return "";
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "workflow_id")) {
        parsed.workflow_id = workflowId;
      }
      return JSON.stringify(parsed);
    } catch {
      return line;
    }
  }).join("\n");
  fs.writeFileSync(filePath, next.endsWith("\n") || next.length === 0 ? next : `${next}\n`, "utf8");
}

function finalizeMigratedWorkflowRecord(targetDir, workflowId) {
  const manifestPath = workflowManifestPath(targetDir);
  const workflowRecord = tryReadJson(manifestPath);
  if (workflowRecord && typeof workflowRecord === "object") {
    const previousId = typeof workflowRecord.id === "string" ? workflowRecord.id : null;
    writeJson(manifestPath, normalizeWorkflowRecordAliases({
      ...workflowRecord,
      id: workflowId,
      workflow: typeof workflowRecord.workflow === "string" && workflowRecord.workflow.trim()
        ? workflowRecord.workflow
        : workflowId,
      workflowDir: targetDir,
      runDir: targetDir,
      legacyRunId: previousId && previousId !== workflowId ? previousId : workflowRecord.legacyRunId || null,
    }));
  }

  const legacyPath = legacyRunRecordPath(targetDir);
  const legacyRecord = tryReadJson(legacyPath);
  if (legacyRecord && typeof legacyRecord === "object") {
    const previousId = typeof legacyRecord.id === "string" ? legacyRecord.id : null;
    writeJson(legacyPath, {
      ...legacyRecord,
      id: workflowId,
      summary: {
        ...(legacyRecord.summary && typeof legacyRecord.summary === "object" ? legacyRecord.summary : {}),
        workflow: workflowId,
      },
      legacyRunId: previousId && previousId !== workflowId ? previousId : legacyRecord.legacyRunId || null,
    });
  }

  const eventLog = workflowEventLogPath(targetDir);
  if (fs.existsSync(eventLog)) {
    try {
      rewriteWorkflowIdsInJsonl(eventLog, workflowId);
    } catch {}
  }
}

function migrateLegacyWorkflowRunToInstance(workspaceRoot, workflowId) {
  const sourceDir = findLatestLegacyWorkflowRunDir(workspaceRoot, workflowId);
  if (!sourceDir) {
    return null;
  }
  const targetDir = workflowRunDir(workspaceRoot, workflowId);
  if (!fs.existsSync(targetDir)) {
    copyTree(sourceDir, targetDir);
  }
  rewriteCopiedTreePaths(targetDir, sourceDir, targetDir);
  fs.mkdirSync(path.join(targetDir, "stages"), { recursive: true });
  if (!fs.existsSync(workflowEventLogPath(targetDir))) {
    fs.writeFileSync(workflowEventLogPath(targetDir), "", "utf8");
  }
  finalizeMigratedWorkflowRecord(targetDir, workflowId);
  return targetDir;
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
  writeJson(legacyRunRecordPath(runDir), {
    id,
    kind: "workflow",
    category: record.category,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: null,
    summary: {
      workflow: record.workflow,
      category: record.category,
      metadata: record.metadata == null ? null : record.metadata,
    }
  });
  return record;
}

function updateWorkflowRun(runDir, mutator) {
  const manifestPath = workflowManifestPath(runDir);
  const current = normalizeWorkflowRecordAliases(readJson(manifestPath));
  const next = normalizeWorkflowRecordAliases(mutator({ ...current }));
  next.category = normalizeWorkflowCategory(next.category, normalizeWorkflowCategory(current.category, "build"));
  next.updatedAt = nowIso();
  writeJson(manifestPath, next);
  writeJson(legacyRunRecordPath(runDir), {
    id: next.id,
    kind: "workflow",
    category: next.category,
    status: next.status,
    createdAt: next.createdAt,
    completedAt: next.status === "success" || next.status === "error" || next.status === "stopped"
      ? next.updatedAt
      : null,
    summary: {
      workflow: next.workflow,
      category: next.category,
      metadata: next.metadata == null ? null : next.metadata,
    }
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
  const legacyManifestPath = legacyStepManifestPath(stepDirPath);
  const current = normalizeStageRecordAliases(
    fs.existsSync(manifestPath)
      ? readJson(manifestPath)
      : readJson(legacyManifestPath)
  );
  const next = normalizeStageRecordAliases(mutator({ ...current }));
  next.updatedAt = nowIso();
  writeJson(manifestPath, next);
  return next;
}

module.exports = {
  createWorkflowRun,
  createWorkflowStep,
  generateWorkflowRunId,
  legacyWorkflowRunsRoot,
  legacyStepDir,
  legacyStepManifestPath,
  findLatestLegacyWorkflowRunDir,
  migrateLegacyWorkflowRunToInstance,
  sanitizeStepName,
  legacyRunRecordPath,
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
