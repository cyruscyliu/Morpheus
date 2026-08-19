const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const buildScript = path.join(
  repoRoot,
  "tools",
  "nvirsh-buildroot-based-cvm",
  "scripts",
  "build.sh",
);
const inspectScript = path.join(
  repoRoot,
  "tools",
  "nvirsh-buildroot-based-cvm",
  "scripts",
  "inspect.sh",
);

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

test("buildroot-based CVM build stages explicit linux, buildroot, and host-stack artifacts", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-"));
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const resultFile = path.join(tmpDir, "result.json");
  const inspectResultFile = path.join(tmpDir, "inspect.json");
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const l1Kernel = path.join(tmpDir, "linux-out", "Image");
  const buildrootOutputDir = path.join(tmpDir, "buildroot-out");
  const archiveRoot = path.join(tmpDir, "host-stack-root");
  const archivePath = path.join(tmpDir, "host-stack.tar.xz");

  writeExecutable(hostQemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.writeFileSync(l1Kernel, "l1-kernel\n");

  fs.mkdirSync(path.join(buildrootOutputDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "build"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "bin"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "share", "qemu"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "lib"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "lib"), { recursive: true });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "Image"), "l2-image\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.cpio.gz"), "l2-initrd\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "build", "vmlinux"), "l2-vmlinux\n");
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "qemu-system-aarch64"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "lib", "ld-linux-aarch64.so.1"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(path.join(buildrootOutputDir, "target", "usr", "share", "qemu", "edk2.bin"), "qemu-data\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "target", "usr", "lib", "libfdt.so.1"), "libfdt\n");
  fs.writeFileSync(
    path.join(buildrootOutputDir, ".morpheus-build-inputs.json"),
    JSON.stringify({ fingerprint: "buildroot-fixture-fingerprint" }, null, 2),
  );

  fs.mkdirSync(path.join(archiveRoot, "out"), { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, "out", "host.ext4"), "host-rootfs\n");
  fs.writeFileSync(path.join(archiveRoot, "out", "flash.bin"), "host-flash\n");
  const tarResult = spawnSync("tar", ["-cJf", archivePath, "-C", archiveRoot, "."], {
    encoding: "utf8",
  });
  assert.equal(tarResult.status, 0, tarResult.stderr || tarResult.stdout);
  const archiveSha256 = spawnSync("sha256sum", [archivePath], {
    encoding: "utf8",
  });
  assert.equal(archiveSha256.status, 0, archiveSha256.stderr || archiveSha256.stdout);
  const archiveHash = archiveSha256.stdout.trim().split(/\s+/)[0];

  const firstRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR: buildDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU: hostQemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR: buildrootOutputDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL: l1Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_HOST_STACK_ARCHIVE_URL: `file://${archivePath}`,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_HOST_STACK_ARCHIVE_SHA256: archiveHash,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REUSE_BUILD_DIR: "true",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
    },
  });
  assert.equal(firstRun.status, 0, firstRun.stderr + firstRun.stdout);
  const firstResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(firstResult.details.reused, false);

  const stateFile = path.join(installDir, "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.tool, "nvirsh-buildroot-based-cvm");
  assert.equal(state.layeredState.l2.mode, "cvm");
  assert.equal(state.hostLaunch.qemu, hostQemu);
  assert.equal(state.hostLaunch.kernel, path.join(buildDir, "l1", "host-boot", "vmlinuz"));
  assert.equal(state.hostLaunch.memory, "4096");
  assert.equal(state.hostLaunch.cpus, "1");
  assert.equal(
    fs.existsSync(path.join(buildDir, "l1", "guest-qemu", "bin", "qemu-system-aarch64")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(buildDir, "l1", "guest-qemu", "share", "qemu", "edk2.bin")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(buildDir, "l1", "guest-qemu", "runtime-libs", "lib", "ld-linux-aarch64.so.1")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(buildDir, "l1", "guest-qemu", "runtime-libs", "lib", "libfdt.so.1")),
    true,
  );

  const secondRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR: buildDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU: hostQemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR: buildrootOutputDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL: l1Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_HOST_STACK_ARCHIVE_URL: `file://${archivePath}`,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_HOST_STACK_ARCHIVE_SHA256: archiveHash,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REUSE_BUILD_DIR: "true",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
    },
  });
  assert.equal(secondRun.status, 0, secondRun.stderr + secondRun.stdout);
  const secondResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(secondResult.details.reused, true);

  const inspectRun = spawnSync("bash", [inspectScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: path.join(tmpDir, "run"),
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: inspectResultFile,
    },
  });
  assert.equal(inspectRun.status, 0, inspectRun.stderr + inspectRun.stdout);
  const inspectResult = JSON.parse(fs.readFileSync(inspectResultFile, "utf8"));
  assert.equal(inspectResult.details.guest_kernel_vmlinux, path.join(buildrootOutputDir, "build", "vmlinux"));
});
