import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { RunDetail, RunEventRecord, RunSummary } from "../types";
import type { ViewerContext } from "./context";

interface ListOptions {
  limit?: string | null;
  offset?: string | null;
}

interface ListRunsResult {
  runs: RunSummary[];
  total: number;
  offset: number;
  limit: number;
}

function cliInvocation(repoRoot: string): { command: string; args: string[] } {
  const distCli = path.join(repoRoot, "apps", "morpheus", "dist", "cli.js");
  if (fs.existsSync(distCli)) {
    return { command: process.execPath, args: [distCli] };
  }
  const srcCli = path.join(repoRoot, "apps", "morpheus", "src", "cli.ts");
  return { command: process.execPath, args: ["--import", "tsx", srcCli] };
}

function runWorkflowJson(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
  args: string[],
): any {
  const cli = cliInvocation(context.repoRoot);
  const result = spawnSync(
    cli.command,
    [
      ...cli.args,
      ...(context.configPath ? ["--config", String(context.configPath)] : []),
      "--json",
      ...args,
      "--workspace",
      context.workspaceRoot,
    ],
    {
      cwd: context.repoRoot,
      encoding: "utf8",
    },
  );
  const text = String(result.stdout || "").trim() || String(result.stderr || "").trim();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (result.status !== 0) {
    const summary = payload && typeof payload.summary === "string"
      ? payload.summary
      : (result.stderr || result.stdout || "morpheus command failed").trim();
    throw new Error(summary);
  }
  return payload;
}

function runWorkflowText(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
  args: string[],
): string {
  const cli = cliInvocation(context.repoRoot);
  const result = spawnSync(
    cli.command,
    [
      ...cli.args,
      ...(context.configPath ? ["--config", String(context.configPath)] : []),
      ...args,
      "--workspace",
      context.workspaceRoot,
    ],
    {
      cwd: context.repoRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "morpheus command failed").trim());
  }
  return String(result.stdout || "");
}

export function listRunSummariesWithTotal(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
  options: ListOptions = {},
): ListRunsResult {
  const args = ["workflow", "runs"];
  if (options.limit != null) {
    args.push("--limit", String(options.limit));
  }
  if (options.offset != null) {
    args.push("--offset", String(options.offset));
  }
  const payload = runWorkflowJson(context, args);
  const details = payload && payload.details ? payload.details : {};
  return {
    runs: Array.isArray(details.runs) ? details.runs as RunSummary[] : [],
    total: typeof details.total === "number" ? details.total : 0,
    offset: typeof details.offset === "number" ? details.offset : 0,
    limit: typeof details.limit === "number" ? details.limit : 200,
  };
}

export function loadRunDetail(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
  runId: string,
): RunDetail | null {
  try {
    const payload = runWorkflowJson(context, ["workflow", "inspect", "--id", runId]);
    return (payload && payload.details ? payload.details : null) as RunDetail | null;
  } catch (error) {
    if (String((error as Error).message || "").includes("workflow run not found")) {
      return null;
    }
    throw error;
  }
}

export function loadRunEvents(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
  runId: string,
): RunEventRecord[] | null {
  try {
    const payload = runWorkflowJson(context, ["workflow", "events", "--id", runId]);
    const details = payload && payload.details ? payload.details : {};
    return Array.isArray(details.events) ? details.events as RunEventRecord[] : [];
  } catch (error) {
    if (String((error as Error).message || "").includes("workflow run not found")) {
      return null;
    }
    throw error;
  }
}

export function loadStepLogText(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
  runId: string,
  stepId: string,
): string | null {
  try {
    return runWorkflowText(context, ["workflow", "logs", "--id", runId, "--step", stepId]);
  } catch (error) {
    if (String((error as Error).message || "").includes("workflow run not found")) {
      return null;
    }
    if (String((error as Error).message || "").includes("could not resolve step")) {
      return null;
    }
    if (String((error as Error).message || "").includes("missing log file")) {
      return null;
    }
    throw error;
  }
}

export function loadRunLogText(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
  runId: string,
): string | null {
  const detail = loadRunDetail(context, runId);
  if (!detail) {
    return null;
  }
  const sections: string[] = [];
  const events = loadRunEvents(context, runId) || [];
  const eventText = events
    .filter((entry) => entry && (entry.event === "console.stdout" || entry.event === "console.stderr"))
    .map((entry) => (entry.data && typeof entry.data.text === "string" ? entry.data.text : ""))
    .join("");
  if (eventText.trim()) {
    sections.push(["=== workflow.events ===", eventText.trimEnd()].join("\n"));
  }

  for (const step of detail.steps || []) {
    const stepLog = loadStepLogText(context, runId, step.id);
    if (!stepLog || !stepLog.trim()) {
      continue;
    }
    sections.push([`=== ${step.name || step.id} (${step.status}) ===`, stepLog.trimEnd()].join("\n"));
  }

  return sections.join("\n\n");
}
