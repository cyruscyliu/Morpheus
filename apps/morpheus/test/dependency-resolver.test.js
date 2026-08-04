const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const dependencyResolver = require("../dist/core/dependency-resolver.js");
const { applyConfigDefaults, loadConfig } = require("../dist/core/config.js");

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

function workflowStepIds(workflow) {
  if (!workflow || typeof workflow !== "object") {
    return [];
  }
  if (Array.isArray(workflow.steps) && workflow.steps.length > 0) {
    return workflow.steps.map((step) => String(step.id || ""));
  }
  if (Array.isArray(workflow.stages) && workflow.stages.length > 0) {
    return workflow.stages.flatMap((stage) => {
      if (!stage || typeof stage !== "object") {
        return [];
      }
      if (Array.isArray(stage.steps) && stage.steps.length > 0) {
        return stage.steps.map((step) => String(step.id || ""));
      }
      return [String(stage.id || "")];
    });
  }
  return [];
}

test("resolveToolDependencies projects managed artifacts into the global cache", () => {
  const projectRoot = tempDir("morpheus-resolve-cache-");
  const workspaceRoot = path.join(projectRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const configPath = writeConfig(projectRoot, [
    "workspace:",
    "  root: ./workspace",
    "cache:",
    "  root: ./.cache",
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
      path.join(projectRoot, ".cache", "hyperarm", "tools", "microkit-sdk", "builds", "microkit-sdk-2.1.0", "install"),
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
      path.join(projectRoot, ".cache", "hyperarm", "tools", "sel4", "builds", "sel4-c0fc3245", "source"),
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
    "  root: ./.cache",
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
    "  root: ./.cache",
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

test("resolveToolDependencies projects nvirsh runtime inputs through Morpheus", () => {
  const projectRoot = tempDir("morpheus-resolve-nvirsh-");
  const workspaceRoot = path.join(projectRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const configPath = writeConfig(projectRoot, [
    "workspace:",
    "  root: ./workspace",
    "cache:",
    "  root: ./.cache",
    "  namespace: hyperarm",
    "  downloads: global",
    "  builds: global",
    "  src: global",
    "tools:",
    "  qemu:",
    "    build-version: 11.0.3",
    "    build-dir-key: qemu-11.0.3-aarch64-softmmu",
    "  buildroot:",
    "    build-version: 2025.02.12",
    "    build-dir-key: arm64-dev",
    "  nvirsh:",
    "    build-dir-key: qemu-debian-arm64",
    "    dependencies:",
    "      qemu:",
    "        tool: qemu",
    "        artifact: qemu-system-aarch64",
    "      buildroot:",
    "        tool: buildroot",
    "        artifact: output-dir",
    "",
  ]);

  withConfig(configPath, () => {
    const nvirsh = dependencyResolver.resolveToolDependencies(
      {
        tool: "nvirsh",
        workspace: workspaceRoot,
        localWorkspace: workspaceRoot,
        json: true,
      },
      "build",
    );

    assert.equal(
      nvirsh.qemu,
      path.join(projectRoot, ".cache", "hyperarm", "tools", "qemu", "builds", "qemu-11.0.3-aarch64-softmmu", "install", "bin", "qemu-system-aarch64"),
    );
    assert.equal(
      nvirsh["buildroot-output-dir"],
      path.join(projectRoot, ".cache", "hyperarm", "tools", "buildroot", "builds", "arm64-dev", "output"),
    );
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("applyConfigDefaults resolves nvirsh firmware path from config", () => {
  const projectRoot = tempDir("morpheus-nvirsh-firmware-");
  const workspaceRoot = path.join(projectRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const configPath = writeConfig(projectRoot, [
    "workspace:",
    "  root: ./workspace",
    "tools:",
    "  nvirsh:",
    "    firmware: /usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
    "",
  ]);

  withConfig(configPath, () => {
    const resolved = applyConfigDefaults(
      {
        tool: "nvirsh",
        workspace: workspaceRoot,
      },
      { allowToolDefaults: true },
    );

    assert.equal(
      resolved.flags.firmware,
      "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
    );
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("applyConfigDefaults preserves explicit nvirsh l2 mode selector", () => {
  const projectRoot = tempDir("morpheus-nvirsh-l2-mode-");
  const workspaceRoot = path.join(projectRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const configPath = writeConfig(projectRoot, [
    "workspace:",
    "  root: ./workspace",
    "tools:",
    "  nvirsh:",
    "    l2-mode: cvm",
    "",
  ]);

  withConfig(configPath, () => {
    const resolved = applyConfigDefaults(
      {
        tool: "nvirsh",
        workspace: workspaceRoot,
      },
      { allowToolDefaults: true },
    );

    assert.equal(resolved.flags["l2-mode"], "cvm");
  });

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("repo nvirsh vm and cvm workflows build Buildroot before nvirsh", () => {
  const configRoot = path.resolve(repoRoot, "..");
  const rootConfig = loadConfig(configRoot, {
    explicitPath: path.join(configRoot, "morpheus.yaml"),
  }).value;

  for (const workflowName of ["nvirsh-qemu-arm64-vm-exec-ci", "nvirsh-qemu-arm64-cvm-exec-ci"]) {
    const rootWorkflow = rootConfig.workflows[workflowName];
    assert.ok(rootWorkflow, `missing root ${workflowName} workflow`);
    const stepIds = workflowStepIds(rootWorkflow);
    assert.ok(
      stepIds.indexOf("buildroot_fetch") < stepIds.indexOf("buildroot_patch"),
      `expected buildroot_fetch before buildroot_patch in ${workflowName}`,
    );
    assert.ok(
      stepIds.indexOf("buildroot_patch") < stepIds.indexOf("buildroot_build"),
      `expected buildroot_patch before buildroot_build in ${workflowName}`,
    );
    assert.ok(
      stepIds.indexOf("buildroot_build") < stepIds.indexOf("nvirsh_build"),
      `expected buildroot_build before nvirsh_build in ${workflowName}`,
    );
    assert.ok(
      stepIds.indexOf("nvirsh_build") < stepIds.indexOf("nvirsh_exec"),
      `expected nvirsh_build before nvirsh_exec in ${workflowName}`,
    );
  }
});
