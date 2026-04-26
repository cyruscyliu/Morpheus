import fs from "node:fs";
import path from "node:path";
import { isSafeId } from "./validate.js";
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
        const loc = typeof entry.location === "string" ? entry.location : "";
        if (!p || !loc) {
            return null;
        }
        return { path: p, location: loc };
    })
        .filter((entry) => entry !== null);
}
function toolResultArtifacts(record) {
    return normalizeArtifactsArray(record?.toolResult?.details?.artifacts);
}
function artifactsFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        return normalizeArtifactsArray(readJson(filePath));
    }
    catch {
        return [];
    }
}
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function readJsonIfExists(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }
    return readJson(filePath);
}
function safeParseInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function listRunDirs(runRoot) {
    if (!fs.existsSync(runRoot)) {
        return [];
    }
    return fs
        .readdirSync(runRoot)
        .filter((name) => isSafeId(name))
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
function summarizeWorkflowFirst(runDir) {
    const recordPath = path.join(runDir, "workflow.json");
    if (!fs.existsSync(recordPath)) {
        return null;
    }
    const record = readJson(recordPath);
    const steps = Array.isArray(record.steps) ? record.steps : [];
    return {
        id: String(record.id || path.basename(runDir)),
        kind: "workflow",
        status: String(record.status || "unknown"),
        createdAt: record.createdAt || null,
        completedAt: record.status === "success" || record.status === "error" ? record.updatedAt || null : null,
        changeName: null,
        stepCount: steps.length,
    };
}
function summarizeLegacy(runDir) {
    const recordPath = path.join(runDir, "run.json");
    if (!fs.existsSync(recordPath)) {
        return null;
    }
    const record = readJson(recordPath);
    const index = readJsonIfExists(path.join(runDir, "index.json"), { stepCount: 0 });
    return {
        id: String(record.id || path.basename(runDir)),
        kind: String(record.kind || "run"),
        status: String(record.status || "unknown"),
        createdAt: record.createdAt || null,
        completedAt: record.completedAt || null,
        changeName: record.changeName || null,
        stepCount: Number(index.stepCount || 0),
    };
}
function createdKey(summary) {
    return summary.createdAt || summary.id;
}
export function listRunSummaries(runRoot, options = {}) {
    return listRunSummariesWithTotal(runRoot, options).runs;
}
export function listRunSummariesWithTotal(runRoot, options = {}) {
    const offset = safeParseInt(options.offset, 0);
    const limit = Math.min(500, safeParseInt(options.limit, 200));
    const runs = listRunDirs(runRoot)
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
        .filter((entry) => entry !== null)
        .sort((left, right) => createdKey(right).localeCompare(createdKey(left)));
    return {
        runs: runs.slice(offset, offset + limit),
        total: runs.length,
        offset,
        limit,
    };
}
function stepLogUrl(runId, stepId) {
    return `/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/log`;
}
function loadWorkflowFirstDetail(runRoot, runId, options) {
    const runDir = path.join(runRoot, runId);
    const recordPath = path.join(runDir, "workflow.json");
    if (!fs.existsSync(recordPath)) {
        return null;
    }
    const record = readJson(recordPath);
    const stepEntries = Array.isArray(record.steps) ? record.steps : [];
    const steps = stepEntries.map((entry) => {
        const stepId = String(entry.id || "");
        const stepDir = typeof entry.stepDir === "string" ? entry.stepDir : path.join(runDir, "steps", stepId);
        const manifest = readJsonIfExists(path.join(stepDir, "step.json"), null);
        const logFile = manifest && typeof manifest.logFile === "string" ? manifest.logFile : path.join(stepDir, "stdout.log");
        const exists = fs.existsSync(logFile);
        const manifestArtifacts = normalizeArtifactsArray(manifest?.artifacts);
        const artifacts = manifestArtifacts.length > 0 ? manifestArtifacts : toolResultArtifacts(manifest);
        const summary = {
            id: stepId,
            name: manifest?.name || entry.name || null,
            status: String(manifest?.status || entry.status || "unknown"),
            logUrl: exists ? stepLogUrl(runId, stepId) : null,
            artifactCount: artifacts.length ? artifacts.length : 0,
            artifacts,
        };
        if (options.includeLogs && exists) {
            summary.logText = fs.readFileSync(logFile, "utf8");
        }
        return summary;
    });
    return {
        id: String(record.id || runId),
        kind: "workflow",
        status: String(record.status || "unknown"),
        createdAt: record.createdAt || null,
        completedAt: record.status === "success" || record.status === "error" ? record.updatedAt || null : null,
        changeName: null,
        stepCount: steps.length,
        runDir,
        steps,
    };
}
function loadLegacyDetail(runRoot, runId, options) {
    const runDir = path.join(runRoot, runId);
    const recordPath = path.join(runDir, "run.json");
    if (!fs.existsSync(recordPath)) {
        return null;
    }
    const record = readJson(recordPath);
    const index = readJsonIfExists(path.join(runDir, "index.json"), { steps: [] });
    const stepsIndex = Array.isArray(index.steps) ? index.steps : [];
    const steps = stepsIndex.map((entry) => {
        const stepId = String(entry.id || "");
        const stepDir = entry.dir ? path.join(runDir, entry.dir) : path.join(runDir, "steps", stepId);
        const stepRecord = readJsonIfExists(path.join(stepDir, "step.json"), null);
        const artifacts = artifactsFromFile(path.join(stepDir, "artifacts.json"));
        const logsDir = path.join(stepDir, "logs");
        const stdoutLog = path.join(logsDir, "stdout.log");
        const exists = fs.existsSync(stdoutLog);
        const summary = {
            id: stepId,
            name: stepRecord?.name || entry.name || null,
            status: String(stepRecord?.status || entry.status || "unknown"),
            logUrl: exists ? stepLogUrl(runId, stepId) : null,
            artifactCount: artifacts.length ? artifacts.length : 0,
            artifacts,
        };
        if (options.includeLogs && exists) {
            summary.logText = fs.readFileSync(stdoutLog, "utf8");
        }
        return summary;
    });
    return {
        id: String(record.id || runId),
        kind: String(record.kind || "run"),
        status: String(record.status || "unknown"),
        createdAt: record.createdAt || null,
        completedAt: record.completedAt || null,
        changeName: record.changeName || null,
        stepCount: steps.length,
        runDir,
        steps,
    };
}
export function loadRunDetail(runRoot, runId, options = {}) {
    if (!isSafeId(runId)) {
        return null;
    }
    const runDir = path.join(runRoot, runId);
    const kind = detectRunKind(runDir);
    if (kind === "workflow-first") {
        return loadWorkflowFirstDetail(runRoot, runId, options);
    }
    if (kind === "legacy") {
        return loadLegacyDetail(runRoot, runId, options);
    }
    return null;
}
export function loadStepLogText(runRoot, runId, stepId) {
    if (!isSafeId(runId) || !isSafeId(stepId)) {
        return null;
    }
    const runDir = path.join(runRoot, runId);
    const kind = detectRunKind(runDir);
    if (!kind) {
        return null;
    }
    if (kind === "workflow-first") {
        const recordPath = path.join(runDir, "workflow.json");
        if (!fs.existsSync(recordPath)) {
            return null;
        }
        const record = readJson(recordPath);
        const steps = Array.isArray(record.steps) ? record.steps : [];
        const match = steps.find((entry) => String(entry.id || "") === stepId) || null;
        const resolvedStepDir = match && typeof match.stepDir === "string" ? match.stepDir : path.join(runDir, "steps", stepId);
        const manifest = readJsonIfExists(path.join(resolvedStepDir, "step.json"), null);
        const logFile = manifest && typeof manifest.logFile === "string"
            ? manifest.logFile
            : path.join(resolvedStepDir, "stdout.log");
        if (!fs.existsSync(logFile)) {
            return null;
        }
        return fs.readFileSync(logFile, "utf8");
    }
    if (kind === "legacy") {
        const index = readJsonIfExists(path.join(runDir, "index.json"), { steps: [] });
        const stepsIndex = Array.isArray(index.steps) ? index.steps : [];
        const match = stepsIndex.find((entry) => String(entry.id || "") === stepId) || null;
        const stepDir = match && match.dir ? path.join(runDir, match.dir) : path.join(runDir, "steps", stepId);
        const logFile = path.join(stepDir, "logs", "stdout.log");
        if (!fs.existsSync(logFile)) {
            return null;
        }
        return fs.readFileSync(logFile, "utf8");
    }
    return null;
}
