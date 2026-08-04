const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function withRepoRoot(repoRootValue, callback) {
  const pathsModulePath = require.resolve("../dist/core/paths.js");
  require(pathsModulePath);
  const moduleEntry = require.cache[pathsModulePath];
  const original = moduleEntry.exports;
  moduleEntry.exports = {
    ...original,
    repoRoot: () => repoRootValue,
  };
  try {
    return callback();
  } finally {
    moduleEntry.exports = original;
  }
}

test("workflow export requires --output-dir outside the data root layout", () => {
  const fakeRepoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "morpheus-export-no-dataroot-")
  );
  const fakeWorkspaceRoot = path.join(fakeRepoRoot, "workspace");
  const fakeConfigPath = path.join(fakeRepoRoot, "morpheus.yaml");

  fs.mkdirSync(fakeWorkspaceRoot, { recursive: true });
  fs.writeFileSync(
    fakeConfigPath,
    [
      "workspace:",
      "  root: ./workspace",
      "workflows:",
      "  bundle-target:",
      "    category: build",
      "    steps:",
      "      - id: build",
      "        tool: qemu",
      "        command: build",
      "",
    ].join("\n"),
    "utf8",
  );

  const { exportWorkflowBundle } = withRepoRoot(
    fakeRepoRoot,
    () => require("../dist/commands/workflow-export.js")
  );

  assert.throws(
    () =>
      withRepoRoot(fakeRepoRoot, () =>
        exportWorkflowBundle({
          workflowName: "bundle-target",
          linkMode: "hardlink",
          prepare: false,
          force: false,
          configPath: fakeConfigPath,
        })
      ),
    /workflow export requires --output-dir/,
  );

  fs.rmSync(fakeRepoRoot, { recursive: true, force: true });
});
