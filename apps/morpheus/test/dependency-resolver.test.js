const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const dependencyResolver = require("../dist/core/dependency-resolver.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConfig(dir, lines) {
  const file = path.join(dir, "morpheus.yaml");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function withConfig(configPath, fn) {
  const previous = process.env.MORPHEUS_CONFIG;
  process.env.MORPHEUS_CONFIG = configPath;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.MORPHEUS_CONFIG;
    } else {
      process.env.MORPHEUS_CONFIG = previous;
    }
  }
}

test("resolveToolDependencies projects managed artifacts into the global cache", () => {
  const projectRoot = tempDir("morpheus-resolve-cache-");
  const workspaceRoot = path.join(projectRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const configPath = writeConfig(projectRoot, [
    "workspace:",
    "  root: ./workspace",
    "cache:",
    "  root: ~/.cache/morpheus",
    "  namespace: hyperarm",
    "  downloads: global",
    "  builds: global",
    "  src: global",
    "tools:",
    "  sel4:",
    "    build-version: c0fc32450fb5e8460083b89a84d067249b109cfc",
    "    build-dir-key: sel4-c0fc3245",
    "  microkit-sdk:",
    "    build-version: 119044f9573674342cedb9694142cce7b832d2ff",
    "    build-dir-key: microkit-sdk-2.1.0",
    "    toolchain-version: 12.3.rel1",
    "    dependencies:",
    "      sel4:",
    "        tool: sel4",
    "        artifact: source-dir",
    "  libvmm:",
    "    build-version: 2fd1d64d7805ad1647af6e2a832e4671d0d40297",
    "    build-dir-key: libvmm-2fd1d64d",
    "    example: virtio",
    "    dependencies:",
    "      microkit-sdk:",
    "        tool: microkit-sdk",
    "        artifact: sdk-dir",
    "",
  ]);

  withConfig(configPath, () => {
    const libvmm = dependencyResolver.resolveToolDependencies(
      {
        tool: "libvmm",
        workspace: workspaceRoot,
        localWorkspace: workspaceRoot,
        json: true,
      },
      "build",
    );

    assert.equal(
      libvmm["microkit-sdk"],
      "/root/.cache/morpheus/hyperarm/tools/microkit-sdk/builds/microkit-sdk-2.1.0/install",
    );

    const microkit = dependencyResolver.resolveToolDependencies(
      {
        tool: "microkit-sdk",
        workspace: workspaceRoot,
        localWorkspace: workspaceRoot,
        json: true,
      },
      "build",
    );

    assert.equal(
      microkit.sel4,
      "/root/.cache/morpheus/hyperarm/tools/sel4/builds/sel4-c0fc3245/source",
    );
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("resolveToolDependencies keeps workspace paths when cache is workspace-scoped", () => {
  const projectRoot = tempDir("morpheus-resolve-workspace-");
  const workspaceRoot = path.join(projectRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const configPath = writeConfig(projectRoot, [
    "workspace:",
    "  root: ./workspace",
    "cache:",
    "  root: ~/.cache/morpheus",
    "  namespace: hyperarm",
    "  downloads: workspace",
    "  builds: workspace",
    "  src: workspace",
    "tools:",
    "  sel4:",
    "    build-version: c0fc32450fb5e8460083b89a84d067249b109cfc",
    "    build-dir-key: sel4-c0fc3245",
    "  microkit-sdk:",
    "    build-version: 119044f9573674342cedb9694142cce7b832d2ff",
    "    build-dir-key: microkit-sdk-2.1.0",
    "    toolchain-version: 12.3.rel1",
    "    dependencies:",
    "      sel4:",
    "        tool: sel4",
    "        artifact: source-dir",
    "",
  ]);

  withConfig(configPath, () => {
    const microkit = dependencyResolver.resolveToolDependencies(
      {
        tool: "microkit-sdk",
        workspace: workspaceRoot,
        localWorkspace: workspaceRoot,
        json: true,
      },
      "build",
    );

    assert.equal(
      microkit.sel4,
      path.join(workspaceRoot, "tools", "sel4", "builds", "sel4-c0fc3245", "source"),
    );
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("resolveToolDependencies rejects global cache configs without a namespace", () => {
  const projectRoot = tempDir("morpheus-resolve-missing-namespace-");
  const workspaceRoot = path.join(projectRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const configPath = writeConfig(projectRoot, [
    "workspace:",
    "  root: ./workspace",
    "cache:",
    "  root: ~/.cache/morpheus",
    "  downloads: global",
    "  builds: global",
    "  src: global",
    "tools:",
    "  sel4:",
    "    build-version: c0fc32450fb5e8460083b89a84d067249b109cfc",
    "    build-dir-key: sel4-c0fc3245",
    "  microkit-sdk:",
    "    build-version: 119044f9573674342cedb9694142cce7b832d2ff",
    "    build-dir-key: microkit-sdk-2.1.0",
    "    dependencies:",
    "      sel4:",
    "        tool: sel4",
    "        artifact: source-dir",
    "",
  ]);

  withConfig(configPath, () => {
    assert.throws(() => {
      dependencyResolver.resolveToolDependencies(
        {
          tool: "microkit-sdk",
          workspace: workspaceRoot,
          localWorkspace: workspaceRoot,
          json: true,
        },
        "build",
      );
    }, /cache\.namespace must be configured when cache\.root is set/);
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});
