const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const ciConfigPath = path.join(repoRoot, "tests", "morpheus.yaml");
const trackedConfigPaths = [
  ciConfigPath,
  path.join(
    repoRoot,
    "apps",
    "morpheus",
    "test",
    "fixtures",
    "nvirsh-workflows",
    "morpheus.yaml",
  ),
  path.join(
    repoRoot,
    "apps",
    "morpheus",
    "test",
    "fixtures",
    "remote-all-tools",
    "morpheus.yaml",
  ),
];
const expectedWorkflowSteps = {
  "llbase-build-ci": [["llbase", "inspect"]],
  "llbic-build-ci": [["llbic", "inspect"]],
  "llcg-build-ci": [["llcg", "inspect"]],
  "devilang-build-ci": [
    ["devilang", "test-audit-state"],
    ["devilang", "test-static-checks"],
  ],
  "libafl-build-ci": [
    ["libafl", "fetch"],
    ["libafl", "patch"],
  ],
  "libvmm-build-ci": [
    ["sel4", "fetch"],
    ["sel4", "patch"],
    ["microkit-sdk", "fetch"],
    ["microkit-sdk", "patch"],
    ["microkit-sdk", "build"],
    ["libvmm", "fetch"],
    ["libvmm", "patch"],
    ["libvmm", "build"],
  ],
  "microkit-sdk-build-ci": [
    ["sel4", "fetch"],
    ["sel4", "patch"],
    ["microkit-sdk", "fetch"],
    ["microkit-sdk", "patch"],
    ["microkit-sdk", "build"],
  ],
  "sel4-fetch-patch-ci": [
    ["sel4", "fetch"],
    ["sel4", "patch"],
  ],
  "buildroot-build-ci": [
    ["buildroot", "fetch"],
    ["buildroot", "patch"],
    ["buildroot", "build"],
  ],
  "buildroot-fetch-ci": [["buildroot", "fetch"]],
  "buildroot-patch-ci": [
    ["buildroot", "fetch"],
    ["buildroot", "patch"],
  ],
  "qemu-fetch-ci": [["qemu", "fetch"]],
  "qemu-patch-ci": [
    ["qemu", "fetch"],
    ["qemu", "patch"],
  ],
  "qemu-build-ci": [
    ["qemu", "fetch"],
    ["qemu", "patch"],
    ["qemu", "build"],
  ],
  "nqc2-build-ci": [
    ["qemu", "fetch"],
    ["qemu", "patch"],
    ["qemu", "build"],
    ["nqc2", "fetch"],
  ],
  "nvirsh-qemu-arm64-vm-exec-ci": [
    ["buildroot", "fetch"],
    ["buildroot", "patch"],
    ["buildroot", "build"],
    ["qemu", "fetch"],
    ["qemu", "patch"],
    ["qemu", "build"],
    ["nvirsh", "fetch"],
  ],
  "nvirsh-qemu-arm64-cvm-exec-ci": [
    ["buildroot", "fetch"],
    ["buildroot", "patch"],
    ["buildroot", "build"],
    ["linux", "fetch"],
    ["linux", "patch"],
    ["linux", "build"],
    ["qemu", "fetch"],
    ["qemu", "build"],
  ],
};

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath) || ".";
}

function readYaml(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseYaml(filePath) {
  return yaml.parse(readYaml(filePath)) || {};
}

function assertNoYamlParseErrors(filePath) {
  const document = yaml.parseDocument(readYaml(filePath));
  assert.deepEqual(
    document.errors.map((error) => error.message),
    [],
    `${repoRelative(filePath)} contains YAML parse errors`,
  );
}

test("tracked morpheus configs parse without duplicate keys", () => {
  for (const filePath of trackedConfigPaths) {
    assertNoYamlParseErrors(filePath);
  }
});

test("repository root has no implicit Morpheus config", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "morpheus.yaml")), false);
});

test("CI config is an explicit, fixture-only fast workflow set", () => {
  const config = parseYaml(ciConfigPath);
  const workflows = config.workflows || {};
  const workflowNames = Object.keys(workflows).sort();

  assert.deepEqual(workflowNames, Object.keys(expectedWorkflowSteps).sort());
  assert.doesNotMatch(readYaml(ciConfigPath), /https?:\/\//);

  for (const workflowName of workflowNames) {
    assert.match(workflowName, /-ci$/, `CI workflow ${workflowName} must end with -ci`);
    const stages = workflows[workflowName].stages || [];
    assert.deepEqual(
      stages.map((stage) => [stage.tool, stage.command]),
      expectedWorkflowSteps[workflowName],
      `${workflowName} must stay fixture-backed`,
    );
    for (const stage of stages) {
      assert.notEqual(stage.command, "exec", `${workflowName} must not execute a runtime`);
    }
  }
});

test("CI config resolves every seed directory from a checked-in fixture", () => {
  const config = parseYaml(ciConfigPath);
  const tools = config.tools || {};

  const fixtureTools = Object.entries(tools)
    .filter(([, toolConfig]) => toolConfig["seed-dir"])
    .map(([toolName]) => toolName)
    .sort();
  assert.deepEqual(fixtureTools, [
    "buildroot",
    "libafl",
    "libvmm",
    "linux",
    "microkit-sdk",
    "qemu",
    "sel4",
  ]);
  for (const toolName of fixtureTools) {
    const toolConfig = tools[toolName];
    const seedDir = toolConfig["seed-dir"];
    const expectedPrefix = `../tools/${toolName}/tests/fixtures/`;
    assert.ok(seedDir.startsWith(expectedPrefix), `${toolName} must use ${expectedPrefix}`);

    const resolvedSeedDir = path.resolve(path.dirname(ciConfigPath), seedDir);
    assert.ok(fs.existsSync(resolvedSeedDir), `${toolName} fixture is missing: ${seedDir}`);
  }
});
