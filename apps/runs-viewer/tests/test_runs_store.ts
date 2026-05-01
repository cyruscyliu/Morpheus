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
    category: "run",
    status: "success",
    createdAt: "2026-04-23T10:00:00.000Z",
    completedAt: "2026-04-23T10:00:01.000Z",
    changeName: "local",
  });
  writeJson(path.join(legacyDir, "index.json"), {
    stepCount: 1,
    steps: [{ id: "step-001-build", name: "build", kind: "tool", status: "success", dir: "steps/step-001-build" }],
  });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "step.json"), {
    id: "step-001-build",
    name: "build",
    kind: "tool",
    status: "success",
  });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "artifacts.json"), []);
  writeText(path.join(legacyDir, "steps", "step-001-build", "logs", "stdout.log"), "legacy log\n");

  const workflowId = "wf-20260423110000-deadbeef";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "tool-buildroot",
    category: "build",
    status: "running",
    createdAt: "2026-04-23T11:00:00.000Z",
    updatedAt: "2026-04-23T11:00:02.000Z",
    steps: [
      {
        id: "01-build",
        name: "build",
        kind: "tool",
        status: "running",
        stepDir: path.join(workflowDir, "steps", "01-build"),
      },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-build", "step.json"), {
    id: "01-build",
    name: "build",
    kind: "tool",
    status: "running",
  });
  writeText(path.join(workflowDir, "steps", "01-build", "stdout.log"), "workflow log\n");

  const summaries = listRunSummaries(runRoot);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0]?.id, workflowId);
  assert.equal(summaries[0]?.format, "workflow-first");
  assert.equal(summaries[0]?.category, "build");
  assert.equal(summaries[1]?.id, legacyId);
  assert.equal(summaries[1]?.format, "legacy");
  assert.equal(summaries[1]?.category, "run");

  const result = listRunSummariesWithTotal(runRoot, { limit: "1" });
  assert.equal(result.total, 2);
  assert.equal(result.runs.length, 1);
});

test("loadRunDetail returns steps, kinds, and graph metadata", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const legacyId = "legacy-1";
  const legacyDir = path.join(runRoot, legacyId);
  writeJson(path.join(legacyDir, "run.json"), {
    id: legacyId,
    kind: "run",
    category: "run",
    status: "success",
    createdAt: "t",
  });
  writeJson(path.join(legacyDir, "index.json"), {
    stepCount: 1,
    steps: [{ id: "step-001-build", name: "build", kind: "tool", status: "success", dir: "steps/step-001-build" }],
  });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "step.json"), { id: "step-001-build", kind: "tool", status: "success" });
  writeJson(path.join(legacyDir, "steps", "step-001-build", "artifacts.json"), []);
  writeText(path.join(legacyDir, "steps", "step-001-build", "logs", "stdout.log"), "hello\n");

  const detail = loadRunDetail(runRoot, legacyId);
  assert.ok(detail);
  assert.equal(detail.category, "run");
  assert.equal(detail.format, "legacy");
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0]?.kind, "tool");
  assert.equal(detail.steps[0]?.logUrl, "/api/runs/legacy-1/steps/step-001-build/log");
  assert.equal(detail.graph.nodes.length, 1);
  assert.equal(detail.graph.edges.length, 0);
  assert.equal(loadStepLogText(runRoot, legacyId, "step-001-build"), "hello\n");
});

test("workflow-first step artifacts fall back to tool result details", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const workflowId = "wf-artifacts";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    category: "build",
    status: "success",
    createdAt: "2026-04-24T11:00:00.000Z",
    updatedAt: "2026-04-24T11:00:01.000Z",
    steps: [
      {
        id: "01-step",
        name: "step",
        kind: "analysis",
        status: "success",
        stepDir: path.join(workflowDir, "steps", "01-step"),
      },
    ],
  });

  writeJson(path.join(workflowDir, "steps", "01-step", "step.json"), {
    id: "01-step",
    name: "step",
    kind: "analysis",
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
  assert.equal(detail.category, "build");
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0]?.kind, "analysis");
  assert.equal(detail.steps[0]?.artifactCount, 2);
  assert.equal(detail.steps[0]?.artifacts?.length, 2);
});

test("workflow-first step artifacts accept local and remote locations", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const workflowId = "wf-remote-artifacts";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    category: "build",
    status: "success",
    createdAt: "2026-04-24T11:00:00.000Z",
    updatedAt: "2026-04-24T11:00:01.000Z",
    steps: [
      {
        id: "01-step",
        name: "step",
        kind: "tool",
        status: "success",
        stepDir: path.join(workflowDir, "steps", "01-step"),
      },
    ],
  });

  writeJson(path.join(workflowDir, "steps", "01-step", "step.json"), {
    id: "01-step",
    name: "step",
    kind: "tool",
    status: "success",
    artifacts: [
      {
        path: "images/Image",
        remote_location: "/remote/output/images/Image",
        local_location: "/local/output/images/Image",
      },
      {
        path: "images/rootfs.cpio.gz",
        remote_location: "/remote/output/images/rootfs.cpio.gz",
      },
    ],
  });
  writeText(path.join(workflowDir, "steps", "01-step", "stdout.log"), "ok\n");

  const detail = loadRunDetail(runRoot, workflowId);
  assert.ok(detail);
  assert.equal(detail.category, "build");
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0]?.artifactCount, 2);
  assert.deepEqual(detail.steps[0]?.artifacts, [
    { path: "images/Image", location: "/local/output/images/Image" },
    { path: "images/rootfs.cpio.gz", location: "/remote/output/images/rootfs.cpio.gz" },
  ]);
});

test("legacy records fall back to summary category when explicit category is absent", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");
  const legacyId = "legacy-summary-category";
  const legacyDir = path.join(runRoot, legacyId);

  writeJson(path.join(legacyDir, "run.json"), {
    id: legacyId,
    kind: "workflow",
    status: "success",
    createdAt: "2026-04-25T12:00:00.000Z",
    summary: { workflow: "tool-buildroot", category: "build" },
  });
  writeJson(path.join(legacyDir, "index.json"), { stepCount: 0, steps: [] });

  const summaries = listRunSummaries(runRoot);
  assert.equal(summaries[0]?.category, "build");
  assert.equal(summaries[0]?.workflowName, "tool-buildroot");
});

test("workflow graph uses explicit relations and ordered fallback edges", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const workflowId = "wf-relations";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "callgraph",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T10:00:00.000Z",
    updatedAt: "2026-04-26T10:01:00.000Z",
    steps: [
      { id: "01-prepare", name: "prepare", kind: "tool", status: "success", stepDir: path.join(workflowDir, "steps", "01-prepare") },
      { id: "02-build", name: "build", kind: "tool", status: "success", stepDir: path.join(workflowDir, "steps", "02-build") },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-prepare", "step.json"), { id: "01-prepare", name: "prepare", kind: "tool", status: "success" });
  writeJson(path.join(workflowDir, "steps", "02-build", "step.json"), { id: "02-build", name: "build", kind: "tool", status: "success" });
  writeText(path.join(workflowDir, "steps", "01-prepare", "stdout.log"), "prepare\n");
  writeText(path.join(workflowDir, "steps", "02-build", "stdout.log"), "build\n");
  writeText(path.join(workflowDir, "relations.jsonl"), `${JSON.stringify({ kind: "artifact", from: "01-prepare", to: "02-build", artifactPath: "artifacts/input.json" })}\n`);

  const detail = loadRunDetail(runRoot, workflowId);
  assert.ok(detail);
  assert.equal(detail.graph.nodes.length, 2);
  assert.equal(detail.graph.edges.length, 2);
  assert.deepEqual(detail.graph.edges.map((edge) => edge.kind), ["sequence", "artifact"]);
  assert.equal(detail.graph.edges[0]?.inferred, true);
  assert.equal(detail.graph.edges[1]?.artifactPath, "artifacts/input.json");
  assert.equal(detail.graph.edges[1]?.label, "artifacts/input.json");
  assert.equal(detail.graph.edges[1]?.inferred, false);
});

test("workflow graph keeps multiple artifact relations for the same step pair", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const workflowId = "wf-multi-artifact-edge";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "artifact-flow",
    category: "run",
    status: "success",
    createdAt: "2026-04-26T10:00:00.000Z",
    updatedAt: "2026-04-26T10:01:00.000Z",
    steps: [
      { id: "01-build", name: "build", kind: "tool", status: "success", stepDir: path.join(workflowDir, "steps", "01-build") },
      { id: "02-run", name: "run", kind: "tool", status: "success", stepDir: path.join(workflowDir, "steps", "02-run") },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-build", "step.json"), { id: "01-build", name: "build", kind: "tool", status: "success" });
  writeJson(path.join(workflowDir, "steps", "02-run", "step.json"), { id: "02-run", name: "run", kind: "tool", status: "success" });
  writeText(path.join(workflowDir, "steps", "01-build", "stdout.log"), "build\n");
  writeText(path.join(workflowDir, "steps", "02-run", "stdout.log"), "run\n");
  writeText(
    path.join(workflowDir, "relations.jsonl"),
    [
      JSON.stringify({ kind: "artifact", from: "01-build", to: "02-run", artifactPath: "images/Image" }),
      JSON.stringify({ kind: "artifact", from: "01-build", to: "02-run", artifactPath: "images/rootfs.cpio.gz" }),
    ].join("\n") + "\n",
  );

  const detail = loadRunDetail(runRoot, workflowId);
  assert.ok(detail);
  assert.equal(detail.graph.edges.length, 3);
  assert.equal(detail.graph.edges[1]?.kind, "artifact");
  assert.equal(detail.graph.edges[1]?.source, "01-build");
  assert.equal(detail.graph.edges[1]?.target, "02-run");
  assert.equal(detail.graph.edges[1]?.label, "images/Image");
  assert.equal(detail.graph.edges[2]?.kind, "artifact");
  assert.equal(detail.graph.edges[2]?.label, "images/rootfs.cpio.gz");
});

test("workflow graph infers artifact relations from resolved inputs when relation log is absent", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const workflowId = "wf-inferred-artifacts";
  const workflowDir = path.join(runRoot, workflowId);
  const producedLocation = "/tmp/workspace/tools/qemu/src/qemu-1.0.0";
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "artifact-flow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T10:00:00.000Z",
    updatedAt: "2026-04-26T10:01:00.000Z",
    steps: [
      { id: "01-fetch", name: "fetch", kind: "tool", status: "success", stepDir: path.join(workflowDir, "steps", "01-fetch") },
      { id: "02-patch", name: "patch", kind: "tool", status: "success", stepDir: path.join(workflowDir, "steps", "02-patch") },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-fetch", "step.json"), {
    id: "01-fetch",
    name: "fetch",
    kind: "tool",
    status: "success",
    artifacts: [
      { path: "source-dir", location: producedLocation },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "02-patch", "step.json"), {
    id: "02-patch",
    name: "patch",
    kind: "tool",
    status: "success",
    resolvedInputs: {
      source: producedLocation,
      mode: "local",
    },
  });
  writeText(path.join(workflowDir, "steps", "01-fetch", "stdout.log"), "fetch\n");
  writeText(path.join(workflowDir, "steps", "02-patch", "stdout.log"), "patch\n");

  const detail = loadRunDetail(runRoot, workflowId);
  assert.ok(detail);
  assert.equal(detail.graph.edges.length, 2);
  assert.deepEqual(detail.graph.edges.map((edge) => edge.kind), ["sequence", "artifact"]);
  assert.equal(detail.graph.edges[1]?.source, "01-fetch");
  assert.equal(detail.graph.edges[1]?.target, "02-patch");
  assert.equal(detail.graph.edges[1]?.artifactPath, "source-dir");
  assert.equal(detail.graph.edges[1]?.label, "source-dir");
});

test("workflow-first steps with empty logs do not advertise log URLs", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");

  const workflowId = "wf-empty-step-log";
  const workflowDir = path.join(runRoot, workflowId);
  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "callgraph",
    category: "build",
    status: "error",
    createdAt: "2026-04-26T10:00:00.000Z",
    updatedAt: "2026-04-26T10:01:00.000Z",
    steps: [
      { id: "01-has-log", name: "prepare", kind: "tool", status: "success", stepDir: path.join(workflowDir, "steps", "01-has-log") },
      { id: "02-empty-log", name: "build", kind: "tool", status: "created", stepDir: path.join(workflowDir, "steps", "02-empty-log") },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-has-log", "step.json"), { id: "01-has-log", name: "prepare", kind: "tool", status: "success" });
  writeJson(path.join(workflowDir, "steps", "02-empty-log", "step.json"), { id: "02-empty-log", name: "build", kind: "tool", status: "created" });
  writeText(path.join(workflowDir, "steps", "01-has-log", "stdout.log"), "prepare\n");
  writeText(path.join(workflowDir, "steps", "02-empty-log", "stdout.log"), "");

  const detail = loadRunDetail(runRoot, workflowId);
  assert.ok(detail);
  assert.equal(detail.steps[0]?.logUrl, `/api/runs/${workflowId}/steps/01-has-log/log`);
  assert.equal(detail.steps[1]?.logUrl, null);
});

test("listRunSummaries reconciles stale running workflows to error", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");
  const workflowId = "wf-stale-running-summary";
  const workflowDir = path.join(runRoot, workflowId);

  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "stale-workflow",
    category: "run",
    status: "running",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:01:00.000Z",
    runnerPid: 99999999,
    currentChildPid: null,
    currentStepId: "01-step",
    steps: [
      {
        id: "01-step",
        name: "step",
        status: "running",
        stepDir: path.join(workflowDir, "steps", "01-step"),
      },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-step", "step.json"), {
    id: "01-step",
    name: "step",
    kind: "tool",
    status: "running",
  });

  const summaries = listRunSummaries(runRoot);
  assert.equal(summaries[0]?.status, "error");

  const record = JSON.parse(fs.readFileSync(path.join(workflowDir, "workflow.json"), "utf8"));
  assert.equal(record.status, "error");
  assert.equal(record.runnerPid, null);
  assert.equal(record.currentChildPid, null);
  assert.equal(record.steps[0]?.status, "error");
});

test("loadRunDetail reconciles stale running step status to error", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-store-"));
  const runRoot = path.join(workspaceRoot, "runs");
  const workflowId = "wf-stale-running-detail";
  const workflowDir = path.join(runRoot, workflowId);

  writeJson(path.join(workflowDir, "workflow.json"), {
    id: workflowId,
    workflow: "stale-workflow",
    category: "run",
    status: "running",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:01:00.000Z",
    runnerPid: 99999999,
    currentChildPid: null,
    currentStepId: "01-step",
    steps: [
      {
        id: "01-step",
        name: "step",
        status: "running",
        stepDir: path.join(workflowDir, "steps", "01-step"),
      },
    ],
  });
  writeJson(path.join(workflowDir, "steps", "01-step", "step.json"), {
    id: "01-step",
    name: "step",
    kind: "tool",
    status: "running",
  });

  const detail = loadRunDetail(runRoot, workflowId);
  assert.ok(detail);
  assert.equal(detail.status, "error");
  assert.equal(detail.steps[0]?.status, "error");

  const stepRecord = JSON.parse(fs.readFileSync(path.join(workflowDir, "steps", "01-step", "step.json"), "utf8"));
  assert.equal(stepRecord.status, "error");
});
