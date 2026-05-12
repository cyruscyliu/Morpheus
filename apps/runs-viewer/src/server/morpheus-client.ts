import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { RunDetail, RunEventRecord, RunSummary } from "../types";
import type { ViewerContext } from "./context";
import type { ViewerConfigOption, ViewerWorkflowOption } from "./run-root";

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

interface ConfigShowResult {
  configPath: string | null;
  workspaceRoot: string;
  runRoot: string;
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

function runConfigJson(
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
      "config",
      ...args,
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

export function listConfiguredWorkflows(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
): ViewerWorkflowOption[] {
  const payload = runWorkflowJson(context, ["workflow", "list"]);
  const details = payload && payload.details ? payload.details : {};
  const workflows = Array.isArray(details.workflows) ? details.workflows : [];
  return workflows
    .map((workflow: any) => ({
      id: `${context.configPath || "default"}::${String(workflow?.name || "")}`,
      name: String(workflow?.name || ""),
      category: workflow && workflow.category ? String(workflow.category) : "run",
      configPath: context.configPath,
    }))
    .filter((workflow: ViewerWorkflowOption) => workflow.name.length > 0)
    .sort((left: ViewerWorkflowOption, right: ViewerWorkflowOption) => left.name.localeCompare(right.name));
}

export function loadConfigContext(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
): ConfigShowResult {
  const payload = runConfigJson(context, ["show"]);
  const details = payload && payload.details ? payload.details : {};
  return {
    configPath: typeof details.config_path === "string" ? details.config_path : null,
    workspaceRoot: String(details.workspace_root || context.workspaceRoot),
    runRoot: String(details.run_root || path.join(context.workspaceRoot, "runs")),
  };
}

export function listViewerConfigs(
  context: Pick<ViewerContext, "repoRoot" | "configPath" | "workspaceRoot">,
): ViewerConfigOption[] {
  const payload = runWorkflowJson(context, ["workflow", "list"]);
  const details = payload && payload.details ? payload.details : {};
  const configs = Array.isArray(details.configs) ? details.configs : [];
  return configs
    .map((config: any) => ({
      id: String(config?.id || config?.configPath || ""),
      label: String(config?.label || ""),
      configPath: config && typeof config.configPath === "string" ? config.configPath : null,
      workspaceRoot: String(config?.workspaceRoot || ""),
      runRoot: String(config?.runRoot || ""),
    }))
    .filter((config: ViewerConfigOption) => config.id.length > 0 && config.label.length > 0)
    .sort((left: ViewerConfigOption, right: ViewerConfigOption) => left.label.localeCompare(right.label));
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

  for (const step of detail.steps || []) {
    const stepLog = loadStepLogText(context, runId, step.id);
    if (!stepLog || !stepLog.trim()) {
      continue;
    }
    sections.push(stepLog.trimEnd());
  }

  return sections.join("\n\n");
}
