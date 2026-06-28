const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const rootConfigPath = path.join(repoRoot, "morpheus.yaml");
const trackedConfigPaths = [
  rootConfigPath,
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

test("root morpheus.yaml keeps CI-only workflow names", () => {
  const config = parseYaml(rootConfigPath);
  const workflowNames = Object.keys(config.workflows || {});

  assert.notEqual(workflowNames.length, 0, "root morpheus.yaml should define CI workflows");
  for (const workflowName of workflowNames) {
    assert.match(
      workflowName,
      /-ci$/,
      `root workflow ${workflowName} must end with -ci`,
    );
  }
});

test("root morpheus.yaml uses canonical fixture seed paths", () => {
  const config = parseYaml(rootConfigPath);
  const tools = config.tools || {};

  for (const [toolName, toolConfig] of Object.entries(tools)) {
    const seedDir = toolConfig && toolConfig["seed-dir"];
    if (!seedDir) {
      continue;
    }
    const expectedPrefix = `./tools/${toolName}/tests/fixtures/`;
    assert.ok(
      seedDir.startsWith(expectedPrefix),
      `tools.${toolName}.seed-dir must stay under ${expectedPrefix}`,
    );

    const resolvedSeedDir = path.join(repoRoot, seedDir.replace(/^\.\//, ""));
    assert.ok(
      fs.existsSync(resolvedSeedDir),
      `tools.${toolName}.seed-dir target is missing: ${seedDir}`,
    );
  }
});
