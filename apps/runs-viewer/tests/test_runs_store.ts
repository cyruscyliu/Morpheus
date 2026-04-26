import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  listRunSummaries,
  listRunSummariesWithTotal,
  loadRunDetail,
  loadStepLogText,
} from "../src/server/runs-store.js";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

test("listRunSummaries includes legacy and workflow-first runs", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const legacyId = "2026-04-23-run";
  const legacyDir = path.join(runRoot, legacyId);
  writeJson(path.join(legacyDir, "run.json"), {
    id: legacyId,
    kind: "run",
    status: "success",
    createdAt: "2026-04-23T10:00:00.000Z",
    completedAt: "2026-04-23T10:00:01.000Z",
    changeName: "local",
  });
  writeJson(path.join(legacyDir, "index.json"), {
    stepCount: 1,
    steps: [{ id: "step-001-build", name: "build", status: "success", dir: "steps/step-001-build" }],
  });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "step.json"), {
    id: "step-001-build",
    name: "build",
    status: "success",
  });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "artifacts.json"), []);
  writeText(path.join(legacyDir, "steps", "step-001-build", "logs", "stdout.log"), "legacy log\n");

  const workflowId = "wf-20260423110000-deadbeef";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "tool-buildroot",
    status: "running",
    createdAt: "2026-04-23T11:00:00.000Z",
    updatedAt: "2026-04-23T11:00:02.000Z",
    steps: [
      {
        id: "01-build",
        name: "build",
        status: "running",
        stepDir: path.join(workflowDir, "steps", "01-build"),
      },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-build", "step.json"), {
    id: "01-build",
    name: "build",
    status: "running",
  });
  writeText(path.join(workflowDir, "steps", "01-build", "stdout.log"), "workflow log\n");

  const summaries = listRunSummaries(runRoot);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0]?.id, workflowId);
  assert.equal(summaries[1]?.id, legacyId);

  const result = listRunSummariesWithTotal(runRoot, { limit: "1" });
  assert.equal(result.total, 2);
  assert.equal(result.runs.length, 1);
});

test("loadRunDetail returns steps and log url", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const legacyId = "legacy-1";
  const legacyDir = path.join(runRoot, legacyId);
  writeJson(path.join(legacyDir, "run.json"), { id: legacyId, kind: "run", status: "success", createdAt: "t" });
  writeJson(path.join(legacyDir, "index.json"), {
    stepCount: 1,
    steps: [{ id: "step-001-build", name: "build", status: "success", dir: "steps/step-001-build" }],
  });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "step.json"), { id: "step-001-build", status: "success" });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "artifacts.json"), []);
  writeText(path.join(legacyDir, "steps", "step-001-build", "logs", "stdout.log"), "hello\n");

  const detail = loadRunDetail(runRoot, legacyId);
  assert.ok(detail);
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0]?.logUrl, "/api/runs/legacy-1/steps/step-001-build/log");
  assert.equal(loadStepLogText(runRoot, legacyId, "step-001-build"), "hello\n");
});

test("workflow-first step artifacts fall back to tool result details", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const workflowId = "wf-artifacts";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    status: "success",
    createdAt: "2026-04-24T11:00:00.000Z",
    updatedAt: "2026-04-24T11:00:01.000Z",
    steps: [
      {
        id: "01-step",
        name: "step",
        status: "success",
        stepDir: path.join(workflowDir, "steps", "01-step"),
      },
    ],
  });

  writeJson(path.join(workflowDir, "steps", "01-step", "step.json"), {
    id: "01-step",
    name: "step",
    status: "success",
    artifacts: [],
    toolResult: {
      details: {
        artifacts: [
          { path: "out", location: "/tmp/out" },
          { path: "bin", location: "/tmp/bin" },
        ],
      },
    },
  });
  writeText(path.join(workflowDir, "steps", "01-step", "stdout.log"), "ok\n");

  const detail = loadRunDetail(runRoot, workflowId);
  assert.ok(detail);
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0]?.artifactCount, 2);
  assert.equal(detail.steps[0]?.artifacts?.length, 2);
});
