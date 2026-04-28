import fs from "node:fs";
import path from "node:path";

import type {
  RunArtifactRef,
  RunDetail,
  RunGraphEdge,
  RunGraphNode,
  RunStepSummary,
  RunSummary,
} from "../types";
import { isSafeId } from "./validate";

interface ListOptions {
  limit?: string | null;
  offset?: string | null;
}

export interface ListRunsResult {
  runs: RunSummary[];
  total: number;
  offset: number;
  limit: number;
}

interface LoadOptions {
  includeLogs?: boolean;
}

interface RunRelationRecord {
  kind?: string;
  from?: string;
  to?: string;
  artifactPath?: string;
}

function normalizeWorkflowCategory(value: unknown): "build" | "run" | "unknown" {
  const category = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (category === "build" || category === "run") {
    return category;
  }
  return "unknown";
}

function legacyCategoryFromRecord(record: any): "build" | "run" | "unknown" {
  const explicit = normalizeWorkflowCategory(record?.category);
  if (explicit !== "unknown") {
    return explicit;
  }
  const summaryCategory = normalizeWorkflowCategory(record?.summary?.category);
  if (summaryCategory !== "unknown") {
    return summaryCategory;
  }
  const kind = normalizeWorkflowCategory(record?.kind);
  if (kind !== "unknown") {
    return kind;
  }
  return "unknown";
}

function normalizeArtifactsArray(value: any): RunArtifactRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry: any) => {
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
    .filter((entry): entry is RunArtifactRef => entry !== null);
}

function toolResultArtifacts(record: any): RunArtifactRef[] {
  return normalizeArtifactsArray(record?.toolResult?.details?.artifacts);
}

function artifactsFromFile(filePath: string): RunArtifactRef[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    return normalizeArtifactsArray(readJson(filePath));
  } catch {
    return [];
  }
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return readJson(filePath) as T;
}

function readJsonLinesIfExists(filePath: string): any[] {
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
    .filter((entry) => entry !== null);
}

function readTextIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function fileHasLogContent(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    return fs.readFileSync(filePath, "utf8").trimEnd().length > 0;
  } catch {
    return false;
  }
}

function uniquePaths(values: string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value)))];
}

function workflowStepLogPaths(runDir: string, stepId: string): string[] {
  const recordPath = path.join(runDir, "workflow.json");
  if (!fs.existsSync(recordPath)) {
    return [];
  }
  const record = readJson(recordPath);
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const match = steps.find((entry: any) => String(entry.id || "") === stepId) || null;
  const resolvedStepDir =
    match && typeof match.stepDir === "string" ? match.stepDir : path.join(runDir, "steps", stepId);
  const manifest = readJsonIfExists<any>(path.join(resolvedStepDir, "step.json"), null as any);
  const paths = [
    manifest && typeof manifest.logFile === "string"
      ? manifest.logFile
      : path.join(resolvedStepDir, "stdout.log"),
  ];

  const managedRunManifest = readJsonIfExists<any>(path.join(resolvedStepDir, "run", "manifest.json"), null as any);
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

  return uniquePaths(paths);
}

function safeParseInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function listRunDirs(runRoot: string): string[] {
  if (!fs.existsSync(runRoot)) {
    return [];
  }
  return fs
    .readdirSync(runRoot)
    .filter((name) => isSafeId(name))
    .map((name) => path.join(runRoot, name))
    .filter((entry) => fs.statSync(entry).isDirectory());
}

function detectRunKind(runDir: string): "workflow-first" | "legacy" | null {
  if (fs.existsSync(path.join(runDir, "workflow.json"))) {
    return "workflow-first";
  }
  if (fs.existsSync(path.join(runDir, "run.json"))) {
    return "legacy";
  }
  return null;
}

function summarizeWorkflowFirst(runDir: string): RunSummary | null {
  const recordPath = path.join(runDir, "workflow.json");
  if (!fs.existsSync(recordPath)) {
    return null;
  }
  const record = readJson(recordPath);
  const steps = Array.isArray(record.steps) ? record.steps : [];
  return {
    id: String(record.id || path.basename(runDir)),
    kind: "workflow",
    format: "workflow-first",
    category: normalizeWorkflowCategory(record.category),
    workflowName: typeof record.workflow === "string" ? record.workflow : null,
    status: String(record.status || "unknown"),
    createdAt: record.createdAt || null,
    completedAt: record.status === "success" || record.status === "error" ? record.updatedAt || null : null,
    changeName: null,
    stepCount: steps.length,
  };
}

function summarizeLegacy(runDir: string): RunSummary | null {
  const recordPath = path.join(runDir, "run.json");
  if (!fs.existsSync(recordPath)) {
    return null;
  }
  const record = readJson(recordPath);
  const index = readJsonIfExists(path.join(runDir, "index.json"), { stepCount: 0 });
  return {
    id: String(record.id || path.basename(runDir)),
    kind: String(record.kind || "run"),
    format: "legacy",
    category: legacyCategoryFromRecord(record),
    workflowName: typeof record.summary?.workflow === "string" ? record.summary.workflow : null,
    status: String(record.status || "unknown"),
    createdAt: record.createdAt || null,
    completedAt: record.completedAt || null,
    changeName: record.changeName || null,
    stepCount: Number(index.stepCount || 0),
  };
}

function createdKey(summary: RunSummary): string {
  return summary.createdAt || summary.id;
}

function normalizeStepKind(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeStepSummary(entry: any, manifest: any, runId: string, stepId: string, logExists: boolean, artifacts: RunArtifactRef[]): RunStepSummary {
  return {
    id: stepId,
    name: manifest?.name || entry?.name || null,
    kind: normalizeStepKind(manifest?.kind, entry?.kind),
    status: String(manifest?.status || entry?.status || "unknown"),
    startedAt: manifest?.startedAt || entry?.startedAt || null,
    endedAt: manifest?.endedAt || entry?.endedAt || null,
    logUrl: logExists ? stepLogUrl(runId, stepId) : null,
    artifactCount: artifacts.length,
    artifacts,
  };
}

function buildGraph(steps: RunStepSummary[], relations: RunRelationRecord[]): { nodes: RunGraphNode[]; edges: RunGraphEdge[] } {
  const nodes: RunGraphNode[] = steps.map((step) => ({
    id: step.id,
    name: step.name,
    kind: step.kind,
    status: step.status,
    artifactCount: step.artifactCount || 0,
  }));

  const stepIds = new Set(steps.map((step) => step.id));
  const edges: RunGraphEdge[] = [];

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
    edges.push({
      id: `relation:${kind}:${source}:${target}:${relation.artifactPath || relation.kind || "edge"}`,
      source,
      target,
      kind,
      label: relation.kind || null,
      artifactPath: relation.artifactPath || null,
      inferred: false,
    });
  }

  return { nodes, edges };
}

export function listRunSummaries(runRoot: string, options: ListOptions = {}): RunSummary[] {
  return listRunSummariesWithTotal(runRoot, options).runs;
}

export function listRunSummariesWithTotal(runRoot: string, options: ListOptions = {}): ListRunsResult {
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
    .filter((entry): entry is RunSummary => entry !== null)
    .sort((left, right) => createdKey(right).localeCompare(createdKey(left)));

  return {
    runs: runs.slice(offset, offset + limit),
    total: runs.length,
    offset,
    limit,
  };
}

function stepLogUrl(runId: string, stepId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/log`;
}

function loadWorkflowFirstDetail(runRoot: string, runId: string, options: LoadOptions): RunDetail | null {
  const runDir = path.join(runRoot, runId);
  const recordPath = path.join(runDir, "workflow.json");
  if (!fs.existsSync(recordPath)) {
    return null;
  }
  const record = readJson(recordPath);
  const stepEntries = Array.isArray(record.steps) ? record.steps : [];
  const relations = readJsonLinesIfExists(path.join(runDir, "relations.jsonl")) as RunRelationRecord[];

  const steps: RunStepSummary[] = stepEntries.map((entry: any) => {
    const stepId = String(entry.id || "");
    const stepDir = typeof entry.stepDir === "string" ? entry.stepDir : path.join(runDir, "steps", stepId);
    const manifest = readJsonIfExists<any>(path.join(stepDir, "step.json"), null as any);
    const exists = workflowStepLogPaths(runDir, stepId).some((logFile) => fileHasLogContent(logFile));

    const manifestArtifacts = normalizeArtifactsArray(manifest?.artifacts);
    const artifacts = manifestArtifacts.length > 0 ? manifestArtifacts : toolResultArtifacts(manifest);

    const summary: any = normalizeStepSummary(entry, manifest, runId, stepId, exists, artifacts);
    if (options.includeLogs && exists) {
      summary.logText = loadStepLogText(runRoot, runId, stepId);
    }
    return summary as RunStepSummary;
  });

  return {
    id: String(record.id || runId),
    kind: "workflow",
    format: "workflow-first",
    category: normalizeWorkflowCategory(record.category),
    workflowName: typeof record.workflow === "string" ? record.workflow : null,
    status: String(record.status || "unknown"),
    createdAt: record.createdAt || null,
    completedAt: record.status === "success" || record.status === "error" ? record.updatedAt || null : null,
    changeName: null,
    stepCount: steps.length,
    runDir,
    graph: buildGraph(steps, relations),
    steps,
  };
}

function loadLegacyDetail(runRoot: string, runId: string, options: LoadOptions): RunDetail | null {
  const runDir = path.join(runRoot, runId);
  const recordPath = path.join(runDir, "run.json");
  if (!fs.existsSync(recordPath)) {
    return null;
  }

  const record = readJson(recordPath);
  const index = readJsonIfExists<any>(path.join(runDir, "index.json"), { steps: [] } as any);
  const stepsIndex = Array.isArray(index.steps) ? index.steps : [];
  const relations = readJsonLinesIfExists(path.join(runDir, "relations.jsonl")) as RunRelationRecord[];

  const steps: RunStepSummary[] = stepsIndex.map((entry: any) => {
    const stepId = String(entry.id || "");
    const stepDir = entry.dir ? path.join(runDir, entry.dir) : path.join(runDir, "steps", stepId);
    const stepRecord = readJsonIfExists<any>(path.join(stepDir, "step.json"), null as any);
    const artifacts = artifactsFromFile(path.join(stepDir, "artifacts.json"));

    const logsDir = path.join(stepDir, "logs");
    const stdoutLog = path.join(logsDir, "stdout.log");
    const exists = fileHasLogContent(stdoutLog);

    const summary: any = normalizeStepSummary(entry, stepRecord, runId, stepId, exists, artifacts);
    if (options.includeLogs && exists) {
      summary.logText = fs.readFileSync(stdoutLog, "utf8");
    }
    return summary as RunStepSummary;
  });

  return {
    id: String(record.id || runId),
    kind: String(record.kind || "run"),
    format: "legacy",
    category: legacyCategoryFromRecord(record),
    workflowName: typeof record.summary?.workflow === "string" ? record.summary.workflow : null,
    status: String(record.status || "unknown"),
    createdAt: record.createdAt || null,
    completedAt: record.completedAt || null,
    changeName: record.changeName || null,
    stepCount: steps.length,
    runDir,
    graph: buildGraph(steps, relations),
    steps,
  };
}

export function loadRunDetail(
  runRoot: string,
  runId: string,
  options: LoadOptions = {},
): RunDetail | null {
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

export function loadStepLogText(runRoot: string, runId: string, stepId: string): string | null {
  if (!isSafeId(runId) || !isSafeId(stepId)) {
    return null;
  }

  const runDir = path.join(runRoot, runId);
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

  if (kind === "legacy") {
    const index = readJsonIfExists<any>(path.join(runDir, "index.json"), { steps: [] as any[] } as any);
    const stepsIndex = Array.isArray(index.steps) ? index.steps : [];
    const match = stepsIndex.find((entry: any) => String(entry.id || "") === stepId) || null;
    const stepDir =
      match && match.dir ? path.join(runDir, match.dir) : path.join(runDir, "steps", stepId);
    const logFile = path.join(stepDir, "logs", "stdout.log");
    if (!fs.existsSync(logFile)) {
      return null;
    }
    return fs.readFileSync(logFile, "utf8");
  }

  return null;
}

export function loadRunLogText(runRoot: string, runId: string): string | null {
  if (!isSafeId(runId)) {
    return null;
  }

  const detail = loadRunDetail(runRoot, runId);
  if (!detail) {
    return null;
  }

  const sections: string[] = [];
  const runDir = path.join(runRoot, runId);
  const progressLog = readTextIfExists(path.join(runDir, "progress.jsonl")).trim();
  if (progressLog) {
    sections.push(["=== workflow.progress ===", progressLog].join("\n"));
  }

  for (const step of detail.steps) {
    const stepLog = loadStepLogText(runRoot, runId, step.id);
    if (!stepLog || !stepLog.trim()) {
      continue;
    }
    sections.push(
      [`=== ${step.name || step.id} (${step.status}) ===`, stepLog.trimEnd()].join("\n"),
    );
  }

  return sections.join("\n\n");
}
