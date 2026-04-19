// @ts-nocheck
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function appendJsonLine(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(data)}\n`, "utf8");
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function relativeTo(baseDir, targetPath) {
  const rel = path.relative(baseDir, targetPath);
  return rel.startsWith("..") ? path.resolve(targetPath) : rel || ".";
}

function createRun(options) {
  const runId = options.runId || `${nowIso().replace(/[:.]/g, "-")}-${slugify(options.kind || "run")}`;
  const runDir = path.resolve(options.runRoot, runId);
  const stepsDir = path.join(runDir, "steps");
  ensureDir(stepsDir);

  const ctx = {
    runId,
    runDir,
    stepsDir,
    kind: options.kind || "run",
    changeName: options.changeName || null,
    createdAt: nowIso(),
    stepCounter: 0,
    steps: [],
    assessments: [],
    artifacts: []
  };

  const runRecord = {
    id: runId,
    kind: ctx.kind,
    changeName: ctx.changeName,
    status: "running",
    createdAt: ctx.createdAt,
    runDir
  };

  writeJson(path.join(runDir, "run.json"), runRecord);
  writeJson(path.join(runDir, "intent.json"), options.intent);
  if (options.contracts) {
    writeJson(path.join(runDir, "contracts.json"), options.contracts);
  }

  updateIndex(ctx);
  return ctx;
}

function beginStep(ctx, options) {
  ctx.stepCounter += 1;
  const stepId = `step-${String(ctx.stepCounter).padStart(3, "0")}-${slugify(options.name)}`;
  const stepDir = path.join(ctx.stepsDir, stepId);
  const stepRecord = {
    id: stepId,
    name: options.name,
    kind: options.kind,
    description: options.description || "",
    status: "running",
    startedAt: nowIso(),
    endedAt: null
  };

  ensureDir(stepDir);
  ensureDir(path.join(stepDir, "logs"));
  ensureDir(path.join(stepDir, "outputs"));
  writeJson(path.join(stepDir, "step.json"), stepRecord);
  writeJson(path.join(stepDir, "artifacts.json"), []);
  ctx.steps.push({ ...stepRecord, dir: stepDir });
  updateIndex(ctx);

  return {
    id: stepId,
    dir: stepDir,
    outputsDir: path.join(stepDir, "outputs"),
    logsDir: path.join(stepDir, "logs")
  };
}

function completeStep(ctx, step, status, extra) {
  const recordPath = path.join(step.dir, "step.json");
  const record = readJson(recordPath);
  record.status = status;
  record.endedAt = nowIso();
  if (extra) {
    Object.assign(record, extra);
  }
  writeJson(recordPath, record);

  const inMemory = ctx.steps.find((item) => item.id === record.id);
  if (inMemory) {
    Object.assign(inMemory, record);
  }
  updateIndex(ctx);
  return record;
}

function recordInvocation(step, invocation) {
  writeJson(path.join(step.dir, "invocation.json"), invocation);
  return invocation;
}

function recordArtifact(ctx, step, artifact) {
  const recordPath = path.join(step.dir, "artifacts.json");
  const artifacts = readJson(recordPath);
  const artifactRecord = {
    id: artifact.id || `${step.id}-artifact-${String(artifacts.length + 1).padStart(2, "0")}`,
    role: artifact.role,
    type: artifact.type,
    label: artifact.label || artifact.type,
    path: artifact.path,
    sha256: artifact.sha256 || sha256File(artifact.path),
    retention: artifact.retention || "reference",
    metadata: artifact.metadata || {}
  };
  artifacts.push(artifactRecord);
  writeJson(recordPath, artifacts);
  ctx.artifacts.push(artifactRecord);
  updateIndex(ctx);
  return artifactRecord;
}

function recordAssessment(ctx, step, kind, assessment) {
  const filePath = path.join(step.dir, `assessment-${kind}.json`);
  const record = {
    id: `${step.id}-${kind}`,
    kind,
    createdAt: nowIso(),
    ...assessment
  };
  writeJson(filePath, record);
  ctx.assessments.push(record);
  updateIndex(ctx);
  return record;
}

function addRelation(ctx, relation) {
  appendJsonLine(path.join(ctx.runDir, "relations.jsonl"), relation);
}

function updateIndex(ctx) {
  const index = {
    runId: ctx.runId,
    kind: ctx.kind,
    stepCount: ctx.steps.length,
    artifactCount: ctx.artifacts.length,
    assessmentCount: ctx.assessments.length,
    steps: ctx.steps.map((step) => ({
      id: step.id,
      name: step.name,
      kind: step.kind,
      status: step.status,
      dir: relativeTo(ctx.runDir, step.dir)
    }))
  };
  writeJson(path.join(ctx.runDir, "index.json"), index);
}

function finalizeRun(ctx, status, summary) {
  const runPath = path.join(ctx.runDir, "run.json");
  const runRecord = readJson(runPath);
  runRecord.status = status;
  runRecord.completedAt = nowIso();
  runRecord.summary = summary || {};
  writeJson(runPath, runRecord);
  updateIndex(ctx);
  return runRecord;
}

module.exports = {
  ensureDir,
  readJson,
  writeJson,
  appendJsonLine,
  sha256File,
  nowIso,
  slugify,
  relativeTo,
  createRun,
  beginStep,
  completeStep,
  recordInvocation,
  recordArtifact,
  recordAssessment,
  addRelation,
  finalizeRun
};
