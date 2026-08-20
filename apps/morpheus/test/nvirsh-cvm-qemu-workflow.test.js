const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workflowFixture = yaml.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      "apps",
      "morpheus",
      "test",
      "fixtures",
      "nvirsh-workflows",
      "morpheus.yaml",
    ),
    "utf8",
  ),
);

function workflowStep(workflow, id) {
  const step = (workflow.stages || []).find((entry) => entry.id === id);
  assert.ok(step, `missing workflow step ${id}`);
  return step;
}

function workflowStage(workflow, id) {
  const stage = (workflow.stages || []).find((entry) => entry.id === id);
  assert.ok(stage, `missing workflow stage ${id}`);
  return stage;
}

function stageStep(stage, id) {
  const step = (stage.steps || []).find((entry) => entry.id === id);
  assert.ok(step, `missing workflow step ${id}`);
  return step;
}

function stepArg(step, flag) {
  const args = Array.isArray(step.args) ? step.args : [];
  const index = args.indexOf(flag);
  assert.ok(index >= 0, `missing ${flag} in ${step.id}`);
  return args[index + 1];
}

test("CVM workflow fixture wires explicit linux, qemu, and buildroot artifacts into the independent buildroot-based CVM tool", () => {
  const workflow = workflowFixture.workflows["nvirsh-qemu-arm64-cvm-exec"];
  assert.ok(workflow, "missing nvirsh-qemu-arm64-cvm-exec fixture");
  assert.equal(workflowFixture.tools["qemu-cca"], undefined);
  assert.equal(workflowFixture.tools["nvirsh-buildroot-based-cvm"], undefined);

  const linuxTool = workflowFixture.tools["linux"];
  assert.ok(linuxTool, "missing linux tool config");

  const buildrootBuild = workflowStep(workflow, "buildroot_build");
  const linuxFetch = workflowStep(workflow, "linux_fetch");
  const linuxPatch = workflowStep(workflow, "linux_patch");
  const linuxBuild = workflowStep(workflow, "linux_build");
  const qemuHostFetch = workflowStep(workflow, "qemu_host_fetch");
  const qemuHostBuild = workflowStep(workflow, "qemu_host_build");
  const nvirshBuild = workflowStep(workflow, "nvirsh_build");
  const nvirshInspect = workflowStep(workflow, "nvirsh_inspect");

  assert.equal(linuxFetch.tool, "linux");
  assert.equal(linuxPatch.tool, "linux");
  assert.equal(linuxBuild.tool, "linux");
  assert.equal(qemuHostFetch.tool, "qemu");
  assert.equal(qemuHostBuild.tool, "qemu");
  assert.equal(nvirshBuild.tool, "nvirsh-buildroot-based-cvm");
  assert.equal(nvirshInspect.tool, "nvirsh-buildroot-based-cvm");

  assert.equal(linuxTool["seed-dir"], "./minimal-linux-src");
  assert.equal(linuxTool["patch-dir"], "./patches");

  assert.equal(stepArg(linuxPatch, "--source"), "{{steps.linux_fetch.artifacts.source-dir.location}}");
  assert.equal(stepArg(linuxBuild, "--source"), "{{steps.linux_patch.artifacts.source-dir.location}}");
  assert.equal(stepArg(linuxBuild, "--defconfig"), "qemu_virt_defconfig");

  assert.equal(
    stepArg(qemuHostBuild, "--source"),
    "{{steps.qemu_host_fetch.artifacts.source-dir.location}}",
  );
  assert.equal(stepArg(qemuHostBuild, "--build-dir-key"), "qemu-ci-host-fixture");
  assert.ok((qemuHostBuild.args || []).includes("--reuse-build-dir"));

  assert.equal(
    stepArg(nvirshBuild, "--qemu"),
    "{{steps.qemu_host_build.artifacts.qemu-system-aarch64.location}}",
  );
  assert.equal(
    stepArg(nvirshBuild, "--buildroot-output-dir"),
    "{{steps.buildroot_build.artifacts.output-dir.location}}",
  );
  assert.equal(stepArg(buildrootBuild, "--defconfig"), "qemu_aarch64_virt_defconfig");
  assert.equal(
    stepArg(nvirshBuild, "--l1-kernel"),
    "{{steps.linux_build.artifacts.images/Image.location}}",
  );
  assert.equal(
    stepArg(nvirshBuild, "--l1-firmware-a"),
    "./apps/morpheus/test/fixtures/nvirsh-workflows/SBSA_FLASH0.fd",
  );
  assert.equal(
    stepArg(nvirshBuild, "--l1-firmware-b"),
    "./apps/morpheus/test/fixtures/nvirsh-workflows/SBSA_FLASH1.fd",
  );
  assert.equal(stepArg(nvirshBuild, "--l1-machine"), "sbsa-ref");
  assert.equal(
    stepArg(nvirshBuild, "--l1-cpu"),
    "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
  );
  assert.equal(stepArg(nvirshBuild, "--l1-cmdline"), "root=/dev/vda console=ttyAMA0");
  assert.equal(stepArg(nvirshBuild, "--l1-memory-mb"), "4096");
  assert.equal(stepArg(nvirshBuild, "--l1-cpus"), "1");
  assert.equal(
    stepArg(nvirshBuild, "--build-dir-key"),
    "qemu-buildroot-based-cvm-smoke",
  );
  assert.equal(
    stepArg(nvirshInspect, "--build-dir-key"),
    "qemu-buildroot-based-cvm-smoke",
  );

  assert.equal(buildrootBuild.stageIndex, 0);
  assert.equal(linuxBuild.stageIndex, 1);
  assert.equal(qemuHostBuild.stageIndex, 2);
  assert.equal(nvirshBuild.stageIndex, 3);
  assert.equal(nvirshInspect.stageIndex, 4);
  assert.equal(
    (workflow.stages || []).some((entry) => entry.id === "qemu_guest_fetch"),
    false,
  );
  assert.equal(
    (workflow.stages || []).some((entry) => entry.id === "qemu_guest_patch"),
    false,
  );
  assert.equal(
    (workflow.stages || []).some((entry) => entry.id === "nvirsh_fetch"),
    false,
  );
});

test("DMA/MMIO CVM workflow fixture wires separate L1 and L2 kernels plus Buildroot guest QEMU into the independent CVM tool", () => {
  const workflow = workflowFixture.workflows["nvirsh-qemu-arm64-cvm-dma-mmio-exec"];
  assert.ok(workflow, "missing nvirsh-qemu-arm64-cvm-dma-mmio-exec fixture");
  assert.equal(workflowFixture.tools["qemu-cca"], undefined);
  assert.equal(workflowFixture.tools["nvirsh-buildroot-based-cvm"], undefined);

  const buildroot = workflowStage(workflow, "buildroot");
  const linux = workflowStage(workflow, "linux");
  const linuxL2 = workflowStage(workflow, "linux-l2");
  const qemuHost = workflowStage(workflow, "qemu-host");
  const nvirsh = workflowStage(workflow, "nvirsh");
  const nvirshExecStage = workflowStage(workflow, "nvirsh-exec");

  const buildrootBuild = stageStep(buildroot, "buildroot_build");
  const linuxFetch = stageStep(linux, "linux_fetch");
  const linuxBuild = stageStep(linux, "linux_build");
  const linuxL2Fetch = stageStep(linuxL2, "linux_l2_fetch");
  const linuxL2Patch = stageStep(linuxL2, "linux_l2_patch");
  const linuxL2Build = stageStep(linuxL2, "linux_l2_build");
  const qemuHostFetch = stageStep(qemuHost, "qemu_host_fetch");
  const qemuHostBuild = stageStep(qemuHost, "qemu_host_build");
  const nvirshBuild = stageStep(nvirsh, "nvirsh_build");
  const nvirshExec = stageStep(nvirshExecStage, "nvirsh_exec");

  assert.equal(linuxFetch.tool, "linux");
  assert.equal(linuxBuild.tool, "linux");
  assert.equal(linuxL2Fetch.tool, "linux");
  assert.equal(linuxL2Patch.tool, "linux");
  assert.equal(linuxL2Build.tool, "linux");
  assert.equal(qemuHostFetch.tool, "qemu");
  assert.equal(qemuHostBuild.tool, "qemu");
  assert.equal(nvirshBuild.tool, "nvirsh-buildroot-based-cvm");
  assert.equal(nvirshExec.tool, "nvirsh-buildroot-based-cvm");

  assert.equal(stepArg(buildrootBuild, "--defconfig"), "qemu_aarch64_virt_defconfig");
  assert.equal(
    (buildrootBuild.args || []).some((arg) => String(arg).includes("BR2_LINUX_KERNEL")),
    false,
  );
  assert.equal(
    (buildrootBuild.args || []).some((arg) => String(arg).includes("BR2_KERNEL_HEADERS_AS_KERNEL")),
    false,
  );

  assert.equal(stepArg(linuxBuild, "--source"), "{{steps.linux_fetch.artifacts.source-dir.location}}");
  assert.equal(stepArg(linuxL2Patch, "--source"), "{{steps.linux_l2_fetch.artifacts.source-dir.location}}");
  assert.equal(stepArg(linuxL2Patch, "--patch-dir"), "./patches/l2-mmio");
  assert.equal(
    stepArg(linuxL2Build, "--source"),
    "{{steps.linux_l2_patch.artifacts.source-dir.location}}",
  );

  assert.equal(
    stepArg(qemuHostBuild, "--source"),
    "{{steps.qemu_host_fetch.artifacts.source-dir.location}}",
  );
  assert.equal(stepArg(qemuHostBuild, "--build-dir-key"), "qemu-ci-host-fixture");
  assert.ok((qemuHostBuild.args || []).includes("--reuse-build-dir"));

  assert.equal(
    stepArg(nvirshBuild, "--qemu"),
    "{{steps.qemu_host_build.artifacts.qemu-system-aarch64.location}}",
  );
  assert.equal(
    stepArg(nvirshBuild, "--buildroot-output-dir"),
    "{{steps.buildroot_build.artifacts.output-dir.location}}",
  );
  assert.equal(
    stepArg(nvirshBuild, "--l2-kernel"),
    "{{steps.linux_l2_build.artifacts.images/Image.location}}",
  );
  assert.equal(
    stepArg(nvirshBuild, "--l2-qemu"),
    "{{steps.buildroot_build.artifacts.target/usr/bin/qemu-system-aarch64.location}}",
  );
  assert.equal(stepArg(nvirshBuild, "--l2-virtio-transport"), "mmio");
  assert.equal(
    stepArg(nvirshBuild, "--l1-kernel"),
    "{{steps.linux_build.artifacts.images/Image.location}}",
  );
  assert.equal(
    stepArg(nvirshBuild, "--l1-firmware-a"),
    "./apps/morpheus/test/fixtures/nvirsh-workflows/SBSA_FLASH0.fd",
  );
  assert.equal(
    stepArg(nvirshBuild, "--l1-firmware-b"),
    "./apps/morpheus/test/fixtures/nvirsh-workflows/SBSA_FLASH1.fd",
  );
  assert.equal(stepArg(nvirshBuild, "--l1-machine"), "sbsa-ref");
  assert.equal(
    stepArg(nvirshBuild, "--l1-cpu"),
    "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
  );
  assert.equal(stepArg(nvirshBuild, "--l1-cmdline"), "root=/dev/vda console=ttyAMA0");
  assert.equal(stepArg(nvirshBuild, "--l1-memory-mb"), "8192");
  assert.equal(stepArg(nvirshBuild, "--l1-cpus"), "8");
  assert.equal(
    stepArg(nvirshBuild, "--build-dir-key"),
    "qemu-buildroot-based-cvm-dma-mmio-fixture",
  );
  assert.equal(
    stepArg(nvirshExec, "--build-dir-key"),
    "qemu-buildroot-based-cvm-dma-mmio-fixture",
  );
  assert.equal(stepArg(nvirshExec, "--phase"), "launch");

  assert.deepEqual(
    (workflow.stages || []).map((stage) => stage.id),
    ["buildroot", "linux", "linux-l2", "qemu-host", "nvirsh", "nvirsh-exec"],
  );
  assert.equal(
    (workflow.stages || []).some((entry) => entry.id === "qemu-guest"),
    false,
  );
});
