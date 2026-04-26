import { spawnSync } from "node:child_process";
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

export function stopWorkflowRun(runId: string): ActionResult {
  const context = resolveViewerContext();
  const detail = loadRunDetail(context.runRoot, runId);
  if (!detail) {
    return { statusCode: 404, body: { summary: "workflow run not found" } };
  }
  if (detail.format !== "workflow-first") {
    return { statusCode: 400, body: { summary: "stop only supports workflow-first runs" } };
  }
  const result = spawnSync(
    "node",
    [
      workflowCliPath(context.repoRoot),
      "--json",
      "workflow",
      "stop",
      "--id",
      runId,
      "--workspace",
      context.workspaceRoot,
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
