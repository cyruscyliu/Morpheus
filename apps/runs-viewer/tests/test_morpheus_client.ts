import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  listRunSummariesWithTotal,
  loadRunDetail,
  loadRunEvents,
  loadStepLogText,
  loadRunLogText,
} from "../src/server/morpheus-client.js";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

test("morpheus client reads workflow runs, detail, events, and logs through the CLI", () => {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-client-viewer-"));
  const runId = "wf-client-1";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-build");
  fs.mkdirSync(stepDir, { recursive: true });
  writeText(path.join(stepDir, "stdout.log"), "hello\n");
  writeText(path.join(stepDir, "stderr.log"), "warn\n");
  writeJson(path.join(stepDir, "step.json"), {
    id: "01-build",
    name: "build",
    kind: "tool",
    status: "success",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
    artifacts: [{ path: "out", location: path.join(stepDir, "artifacts", "out") }],
  });
  writeJson(path.join(runDir, "workflow.json"), {
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    steps: [{ id: "01-build", name: "build", status: "success", stepDir }],
  });
  writeJson(path.join(runDir, "run.json"), {
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  });
  writeText(
    path.join(runDir, "events.jsonl"),
    `${JSON.stringify({
      ts: "2026-04-26T12:01:00.000Z",
      producer: "morpheus",
      level: "info",
      scope: "workflow",
      event: "workflow.started",
      workflow_id: runId,
      step_id: null,
      tool: null,
      data: { message: "started" },
    })}\n`,
  );

  const context = {
    repoRoot,
    workspaceRoot,
    configPath: null,
  };

  const runs = listRunSummariesWithTotal(context, {});
  assert.equal(runs.total, 1);
  assert.equal(runs.runs[0]?.id, runId);
  assert.equal(runs.runs[0]?.workflowName, "qemu-build");

  const detail = loadRunDetail(context, runId);
  assert.ok(detail);
  assert.equal(detail?.id, runId);
  assert.equal(detail?.steps[0]?.artifacts?.[0]?.path, "out");

  const events = loadRunEvents(context, runId);
  assert.equal(events?.[0]?.event, "workflow.started");
  assert.equal(loadStepLogText(context, runId, "01-build"), "hello\nwarn\n");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});
