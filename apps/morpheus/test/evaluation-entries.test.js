const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveEvaluationEntry,
  evaluationEntryIssues,
} = require("../dist/core/evaluation-entries.js");
const { runConfigCheck } = require("../dist/commands/config-check.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConfig(dir, lines) {
  fs.mkdirSync(path.join(dir, ".morpheus"), { recursive: true });
  const file = path.join(dir, "morpheus.yaml");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function withConfig(configPath, fn) {
  const previous = process.env.MORPHEUS_CONFIG;
  const previousCwd = process.cwd();
  process.env.MORPHEUS_CONFIG = configPath;
  process.chdir(path.dirname(configPath));
  try {
    return fn();
  } finally {
    process.chdir(previousCwd);
    if (previous === undefined) {
      delete process.env.MORPHEUS_CONFIG;
    } else {
      process.env.MORPHEUS_CONFIG = previous;
    }
  }
}

const EVAL_YAML = [
  "workflows:",
  "  sample-build:",
  "    category: build",
  "    steps:",
  "      - id: sample_step",
  "        tool: sample",
  "        command: build",
  "  sample-run:",
  "    category: run",
  "    steps:",
  "      - id: sample_run",
  "        tool: sample",
  "        command: exec",
  "evaluation-entries:",
  "  evaluation-000:",
  "    workflow: sample-build",
  "  evaluation-008:",
  "    script: scripts/sample-battery.sh",
];

test("evaluation entry resolves the workflow and script forms", () => {
  const dir = tempDir("morpheus-eval-");
  const configPath = writeConfig(dir, EVAL_YAML);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "sample-battery.sh"), "#!/usr/bin/env bash\n", "utf8");
  withConfig(configPath, () => {
    const yaml = require("yaml");
    const config = yaml.parse(fs.readFileSync(configPath, "utf8"));
    const workflow = resolveEvaluationEntry(config, "evaluation-000");
    assert.deepEqual(workflow, { kind: "workflow", workflow: "sample-build" });
    const script = resolveEvaluationEntry(config, "evaluation-008");
    assert.deepEqual(script, { kind: "script", script: "scripts/sample-battery.sh" });
    assert.equal(resolveEvaluationEntry(config, "missing-entry"), null);
  });
});

test("evaluation entry issues flag unknown workflows", () => {
  const dir = tempDir("morpheus-eval-");
  const configPath = writeConfig(dir, [
    ...EVAL_YAML,
    "  evaluation-099:",
    "    workflow: missing-workflow",
  ]);
  withConfig(configPath, () => {
    const yaml = require("yaml");
    const config = yaml.parse(fs.readFileSync(configPath, "utf8"));
    const issues = evaluationEntryIssues(config);
    const issue = issues.find((entry) => entry.path === "evaluation-entries.evaluation-099");
    assert.ok(issue, "unknown workflow issue");
    assert.equal(issue.level, "error");
    assert.match(issue.message, /unknown workflow/);
  });
});

test("config check fails on an evaluation entry pointing to a missing workflow", () => {
  const dir = tempDir("morpheus-eval-");
  const configPath = writeConfig(dir, [
    ...EVAL_YAML,
    "  evaluation-099:",
    "    workflow: missing-workflow",
  ]);
  withConfig(configPath, () => {
    const result = runConfigCheck(configPath);
    assert.equal(result.exit_code, 1);
    const issue = result.issues.find((entry) => entry.path === "evaluation-entries.evaluation-099");
    assert.ok(issue, "unknown workflow issue");
    assert.equal(issue.level, "error");
    assert.match(issue.message, /unknown workflow/);
  });
});

test("config check fails on a script entry pointing to a missing file", () => {
  const dir = tempDir("morpheus-eval-");
  const configPath = writeConfig(dir, [
    ...EVAL_YAML,
    "  evaluation-100:",
    "    script: scripts/missing-battery.sh",
  ]);
  withConfig(configPath, () => {
    const result = runConfigCheck(configPath);
    assert.equal(result.exit_code, 1);
    const issue = result.issues.find((entry) => entry.path === "evaluation-entries.evaluation-100");
    assert.ok(issue, "missing script issue");
    assert.equal(issue.level, "error");
    assert.match(issue.message, /missing script/);
  });
});

test("config check rejects an entry without workflow or script", () => {
  const dir = tempDir("morpheus-eval-");
  const configPath = writeConfig(dir, [
    ...EVAL_YAML,
    "  evaluation-101:",
    "    description: no target",
  ]);
  withConfig(configPath, () => {
    const result = runConfigCheck(configPath);
    assert.equal(result.exit_code, 1);
    const issue = result.issues.find((entry) => entry.path === "evaluation-entries.evaluation-101");
    assert.ok(issue, "missing target issue");
    assert.match(issue.message, /workflow: or script:/);
  });
});

test("workflow explain reports the template chain and stage provenance", () => {
  const dir = tempDir("morpheus-explain-");
  const configPath = writeConfig(dir, [
    "stage-templates:",
    "  sample-prep:",
    "    id: prep",
    "    name: prep",
    "    steps:",
    "      - id: prep_step",
    "        tool: llbase",
    "        command: build",
    "workflow-templates:",
    "  sample-pipeline:",
    "    stages:",
    "      - id: prep",
    "        stage-template: sample-prep",
    "workflows:",
    "  sample-flow:",
    "    category: build",
    "    template: sample-pipeline",
    "evaluation-entries:",
    "  evaluation-000:",
    "    workflow: sample-flow",
  ]);
  withConfig(configPath, () => {
    const { explainWorkflowPayload } = require("../dist/commands/workflow.js");
    const payload = explainWorkflowPayload("sample-flow");
    assert.equal(payload.details.template, "sample-pipeline");
    assert.equal(payload.details.stages.length, 1);
    const stage = payload.details.stages[0];
    assert.equal(stage.id, "prep");
    assert.equal(stage.stageTemplate, "sample-prep");
    assert.equal(stage.steps[0].id, "prep_step");
    assert.equal(stage.steps[0].tool, "llbase");
  });
});
