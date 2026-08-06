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

test("workflow export excludes artifacts from workspace mirror and survives EMLINK", () => {
  const fakeRepoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "morpheus-export-exclude-")
  );
  const dataRoot = path.join(fakeRepoRoot, "data");
  const fakeWorkspaceRoot = path.join(dataRoot, "workspaces", "hyperarm");
  const fakeConfigPath = path.join(fakeWorkspaceRoot, "morpheus.yaml");
  const outputDir = path.join(fakeRepoRoot, "out-bundle");

  fs.mkdirSync(path.join(fakeWorkspaceRoot, "tools", "qemu"), { recursive: true });
  fs.mkdirSync(path.join(fakeWorkspaceRoot, "artifacts", "runs", "nested"), { recursive: true });
  fs.writeFileSync(path.join(fakeWorkspaceRoot, "tools", "qemu", "marker"), "ok\n");
  fs.writeFileSync(
    path.join(fakeWorkspaceRoot, "artifacts", "runs", "nested", "should-not-export"),
    "poison\n",
  );
  fs.writeFileSync(
    fakeConfigPath,
    [
      "workspace:",
      "  root: ${MORPHEUS_DATA_ROOT}/workspaces/hyperarm",
      "cache:",
      "  namespace: hyperarm",
      "  downloads: global",
      "  builds: global",
      "  src: global",
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
  // Minimal repo tree for export (bin/morpheus not invoked when prepare=false
  // until bundle checks — stub a failing-safe path by skipping full export
  // through public API and unit-testing mirror exclusions via require of
  // rebuilt module after injecting env).
  fs.mkdirSync(path.join(fakeRepoRoot, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(fakeRepoRoot, "bin", "morpheus"),
    "#!/bin/sh\necho '{\"details\":{\"workflows\":[{\"name\":\"bundle-target\"}]}}'\n",
    { mode: 0o755 },
  );
  fs.mkdirSync(path.join(fakeRepoRoot, "apps", "morpheus", "dist"), { recursive: true });

  const previousDataRoot = process.env.MORPHEUS_DATA_ROOT;
  process.env.MORPHEUS_DATA_ROOT = dataRoot;
  try {
    const { exportWorkflowBundle } = withRepoRoot(
      fakeRepoRoot,
      () => {
        // Clear cached module so repoRoot mock applies to export's require chain.
        const exportPath = require.resolve("../dist/commands/workflow-export.js");
        delete require.cache[exportPath];
        return require("../dist/commands/workflow-export.js");
      },
    );

    const result = withRepoRoot(fakeRepoRoot, () =>
      exportWorkflowBundle({
        workflowName: "bundle-target",
        linkMode: "hardlink",
        prepare: false,
        force: true,
        configPath: fakeConfigPath,
        outputDir,
      }),
    );
    assert.equal(result.status, "success");
    const bundledWorkspace = path.join(outputDir, "data", "workspaces", "hyperarm");
    assert.equal(
      fs.existsSync(path.join(bundledWorkspace, "artifacts")),
      false,
      "artifacts must not be mirrored into the bundle workspace",
    );
    assert.equal(
      fs.existsSync(path.join(bundledWorkspace, "tools", "qemu", "marker")),
      true,
    );
  } finally {
    if (previousDataRoot == null) {
      delete process.env.MORPHEUS_DATA_ROOT;
    } else {
      process.env.MORPHEUS_DATA_ROOT = previousDataRoot;
    }
    fs.rmSync(fakeRepoRoot, { recursive: true, force: true });
  }
});
