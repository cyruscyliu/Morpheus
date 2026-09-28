const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const workflowTemplates = require("../dist/core/workflow-templates.js");
const { resolveConfiguredWorkflow } = require("../dist/commands/workflow.js");
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

const TEMPLATE_YAML = [
  "workflow-templates:",
  "  sample-template:",
  "    category: run",
  "    stages:",
  "      - id: stage-one",
  "        name: stage-one",
  "        steps:",
  "          - id: step-one",
  "            tool: sample",
  "            command: build",
  "            args:",
  "              - --flag",
  "              - template-value",
  "      - id: stage-two",
  "        name: stage-two",
  "        steps:",
  "          - id: step-two",
  "            tool: sample",
  "            command: build",
  "            args:",
  "              - --repeat",
  "              - keep-one",
  "              - --repeat",
  "              - keep-two",
  "workflows:",
  "  sample-inherited:",
  "    template: sample-template",
];

test("workflow with a template inherits the template stages", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, TEMPLATE_YAML);
  withConfig(configPath, () => {
    const resolved = resolveConfiguredWorkflow("sample-inherited");
    assert.deepEqual(resolved.stages.map((stage) => stage.id), ["stage-one", "stage-two"]);
    assert.equal(resolved.category, "run");
  });
});

test("workflow stages replace same-id template stages in place and append new ones", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-override-stages:",
    "    template: sample-template",
    "    stages:",
    "      - id: stage-two",
    "        name: stage-two-replaced",
    "        steps:",
    "          - id: step-two-replaced",
    "            tool: sample",
    "            command: build",
    "      - id: stage-three",
    "        name: stage-three-added",
    "        steps:",
    "          - id: step-three",
    "            tool: sample",
    "            command: build",
  ]);
  withConfig(configPath, () => {
    const resolved = resolveConfiguredWorkflow("sample-override-stages");
    assert.deepEqual(
      resolved.stages.map((stage) => stage.id),
      ["stage-one", "stage-two", "stage-three"],
    );
    assert.equal(resolved.stages[1].name, "stage-two-replaced");
  });
});

test("scalar override replaces every flag value in the stage", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-scalar-override:",
    "    template: sample-template",
    "    overrides:",
    "      stage-one:",
    "        --flag: replaced-value",
  ]);
  withConfig(configPath, () => {
    const resolved = resolveConfiguredWorkflow("sample-scalar-override");
    const step = resolved.steps.find((entry) => entry.id === "step-one");
    assert.deepEqual(step.args, ["--flag", "replaced-value"]);
  });
});

test("replacement-map override replaces only the matching current value", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-map-override:",
    "    template: sample-template",
    "    overrides:",
    "      stage-two:",
    "        --repeat:",
    "          keep-two: replaced-two",
  ]);
  withConfig(configPath, () => {
    const resolved = resolveConfiguredWorkflow("sample-map-override");
    const step = resolved.steps.find((entry) => entry.id === "step-two");
    assert.deepEqual(step.args, ["--repeat", "keep-one", "--repeat", "replaced-two"]);
  });
});

test("dotted override keys address a stage flag directly", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-dotted-override:",
    "    template: sample-template",
    "    overrides:",
    "      stage-one.flag: replaced-value",
  ]);
  withConfig(configPath, () => {
    const resolved = resolveConfiguredWorkflow("sample-dotted-override");
    const step = resolved.steps.find((entry) => entry.id === "step-one");
    assert.deepEqual(step.args, ["--flag", "replaced-value"]);
  });
});

test("override without the leading dashes still matches the flag", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-bare-flag-override:",
    "    template: sample-template",
    "    overrides:",
    "      stage-one:",
    "        flag: replaced-value",
  ]);
  withConfig(configPath, () => {
    const resolved = resolveConfiguredWorkflow("sample-bare-flag-override");
    const step = resolved.steps.find((entry) => entry.id === "step-one");
    assert.deepEqual(step.args, ["--flag", "replaced-value"]);
  });
});

test("overrides applied to a shared template do not leak across workflows", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-override-a:",
    "    template: sample-template",
    "    overrides:",
    "      stage-one:",
    "        --flag: value-a",
    "  sample-override-b:",
    "    template: sample-template",
    "    overrides:",
    "      stage-one:",
    "        --flag: value-b",
  ]);
  withConfig(configPath, () => {
    const resolvedA = resolveConfiguredWorkflow("sample-override-a");
    const resolvedB = resolveConfiguredWorkflow("sample-override-b");
    const stepA = resolvedA.steps.find((entry) => entry.id === "step-one");
    const stepB = resolvedB.steps.find((entry) => entry.id === "step-one");
    assert.deepEqual(stepA.args, ["--flag", "value-a"]);
    assert.deepEqual(stepB.args, ["--flag", "value-b"]);
  });
});

test("unknown template, stage, or unmatched flag raise errors", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-bad-template:",
    "    template: missing-template",
    "  sample-bad-stage:",
    "    template: sample-template",
    "    overrides:",
    "      missing-stage:",
    "        --flag: value",
    "  sample-bad-flag:",
    "    template: sample-template",
    "    overrides:",
    "      stage-one:",
    "        --missing-flag: value",
  ]);
  withConfig(configPath, () => {
    assert.throws(() => resolveConfiguredWorkflow("sample-bad-template"), /workflow template not found/);
    assert.throws(() => resolveConfiguredWorkflow("sample-bad-stage"), /workflow override stage not found/);
    assert.throws(() => resolveConfiguredWorkflow("sample-bad-flag"), /matched no step argument/);
  });
});

test("config check reports template and override errors", () => {
  const dir = tempDir("morpheus-templates-");
  const configPath = writeConfig(dir, [
    ...TEMPLATE_YAML,
    "  sample-bad-config-check:",
    "    template: missing-template",
  ]);
  withConfig(configPath, () => {
    const result = runConfigCheck(configPath);
    assert.equal(result.exit_code, 1);
    const issue = result.issues.find((entry) => entry.path === "workflows.sample-bad-config-check.template");
    assert.ok(issue, "missing template issue");
    assert.equal(issue.level, "error");
  });
});
