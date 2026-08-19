const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const rootConfig = yaml.parse(
  fs.readFileSync(path.join(repoRoot, "morpheus.yaml"), "utf8"),
);

function workflowStep(workflow, id) {
  const step = (workflow.stages || []).find((entry) => entry.id === id);
  assert.ok(step, `missing workflow step ${id}`);
  return step;
}

function stepArg(step, flag) {
  const args = Array.isArray(step.args) ? step.args : [];
  const index = args.indexOf(flag);
  assert.ok(index >= 0, `missing ${flag} in ${step.id}`);
  return args[index + 1];
}

test("repo CVM exec CI wires explicit linux, qemu, and buildroot artifacts into the independent buildroot-based CVM tool", () => {
  const workflow = rootConfig.workflows["nvirsh-qemu-arm64-cvm-exec-ci"];
  assert.ok(workflow, "missing nvirsh-qemu-arm64-cvm-exec-ci");
  assert.equal(rootConfig.tools["qemu-cca"], undefined);

  const linuxTool = rootConfig.tools["linux"];
  const cvmTool = rootConfig.tools["nvirsh-buildroot-based-cvm"];
  assert.ok(linuxTool, "missing linux tool config");
  assert.ok(cvmTool, "missing nvirsh-buildroot-based-cvm tool config");

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

  assert.equal(linuxTool["seed-dir"], "./tools/linux/tests/fixtures/minimal-linux-src");
  assert.equal(linuxTool["patch-dir"], "./tools/linux/patches/demo");
  assert.equal(cvmTool["host-stack-archive-url"], "https://github.com/p-b-o/qemu-linux-stack/releases/download/build/master-11247fd.tar.xz");
  assert.equal(
    cvmTool["host-stack-archive-sha256"],
    "0d9cc57c109bcdc42294a41334e2909fa51c42784160fb5a7396dfce49c90d07",
  );

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
  assert.equal(
    stepArg(nvirshBuild, "--l1-kernel"),
    "{{steps.linux_build.artifacts.images/Image.location}}",
  );
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
