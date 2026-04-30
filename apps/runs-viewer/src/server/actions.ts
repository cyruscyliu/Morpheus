import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadRunDetail } from "./runs-store";
import { resolveViewerContext } from "./context";

export interface ActionResult {
  statusCode: number;
  body: unknown;
}

function workflowCliPath(repoRoot: string): string {
  return path.join(repoRoot, "apps", "morpheus", "dist", "cli.js");
}

function workflowManifestForRun(runRoot: string, runId: string): { configPath?: string | null; workspace?: string | null } | null {
  const manifestPath = path.join(runRoot, runId, "workflow.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

export function stopWorkflowRun(runId: string): ActionResult {
  const context = resolveViewerContext();
  const detail = loadRunDetail(context.runRoot, runId);
  if (!detail) {
    return { statusCode: 404, body: { summary: "workflow run not found" } };
  }
  if (detail.format !== "workflow-first") {
    return { statusCode: 400, body: { summary: "stop only supports workflow-first runs" } };
  }
  const workflowManifest = workflowManifestForRun(context.runRoot, runId);
  const result = spawnSync(
    "node",
    [
      workflowCliPath(context.repoRoot),
      ...(workflowManifest && workflowManifest.configPath ? ["--config", String(workflowManifest.configPath)] : []),
      "--json",
      "workflow",
      "stop",
      "--id",
      runId,
      "--workspace",
      String((workflowManifest && workflowManifest.workspace) || context.workspaceRoot),
    ],
    {
      cwd: context.repoRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return {
      statusCode: 500,
      body: {
        status: "error",
        summary: (result.stderr || result.stdout || "failed to stop workflow").trim(),
      },
    };
  }
  return {
    statusCode: 200,
    body: JSON.parse(String(result.stdout || "{}").trim() || "{}"),
  };
}

export function resumeWorkflowRun(runId: string, fromStep?: string | null): ActionResult {
  const context = resolveViewerContext();
  const detail = loadRunDetail(context.runRoot, runId);
  if (!detail) {
    return { statusCode: 404, body: { summary: "workflow run not found" } };
  }
  if (detail.format !== "workflow-first") {
    return { statusCode: 400, body: { summary: "resume only supports workflow-first runs" } };
  }
  const workflowManifest = workflowManifestForRun(context.runRoot, runId);
  const args = [
    workflowCliPath(context.repoRoot),
    ...(workflowManifest && workflowManifest.configPath ? ["--config", String(workflowManifest.configPath)] : []),
    "--json",
    "workflow",
    "resume",
    "--id",
    runId,
    "--workspace",
    String((workflowManifest && workflowManifest.workspace) || context.workspaceRoot),
  ];
  if (fromStep) {
    args.push("--from-step", fromStep);
  }
  const result = spawnSync("node", args, {
    cwd: context.repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return {
      statusCode: 500,
      body: {
        status: "error",
        summary: (result.stderr || result.stdout || "failed to resume workflow").trim(),
      },
    };
  }
  return {
    statusCode: 200,
    body: JSON.parse(String(result.stdout || "{}").trim() || "{}"),
  };
}

export function removeWorkflowRun(runId: string): ActionResult {
  const context = resolveViewerContext();
  const detail = loadRunDetail(context.runRoot, runId);
  if (!detail) {
    return { statusCode: 404, body: { summary: "workflow run not found" } };
  }
  const runDir = path.resolve(context.runRoot, runId);
  const relative = path.relative(context.runRoot, runDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { statusCode: 400, body: { summary: "invalid run directory" } };
  }
  if (detail.format === "workflow-first" && detail.status === "running") {
    const stopped = stopWorkflowRun(runId);
    if (stopped.statusCode !== 200) {
      return stopped;
    }
  }
  fs.rmSync(runDir, { recursive: true, force: true });
  return {
    statusCode: 200,
    body: {
      command: "remove workflow",
      status: "success",
      exit_code: 0,
      summary: "removed workflow run",
      details: {
        id: runId,
        run_dir: runDir,
      },
    },
  };
}

export function startConfiguredWorkflow(selectedConfigPath: string | null, workflowName: string): ActionResult {
  const context = resolveViewerContext(selectedConfigPath);
  const args = [
    workflowCliPath(context.repoRoot),
    ...(context.configPath ? ["--config", String(context.configPath)] : []),
    "--json",
    "workflow",
    "run",
    "--name",
    workflowName,
    "--workspace",
    context.workspaceRoot,
  ];
  const child = spawn("node", args, {
    cwd: context.repoRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return {
    statusCode: 202,
    body: {
      command: "workflow run",
      status: "submitted",
      exit_code: 0,
      summary: `started workflow ${workflowName}`,
      details: {
        workflow: workflowName,
        workspaceRoot: context.workspaceRoot,
        configPath: context.configPath,
      },
    },
  };
}
