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

function createCpioArchive(archivePath, files) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-cpio-root-"));
  for (const [relativePath, value] of Object.entries(files)) {
    const targetPath = path.join(rootDir, relativePath);
    if (value && typeof value === "object" && value.directory) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, value.contents);
    if (value.mode != null) {
      fs.chmodSync(targetPath, value.mode);
    }
  }
  const archive = spawnSync(
    "bash",
    ["-lc", "find . | LC_ALL=C sort | cpio --reproducible --quiet -o -H newc"],
    { cwd: rootDir },
  );
  assert.equal(archive.status, 0, archive.stderr?.toString() || archive.stdout?.toString());
  fs.writeFileSync(archivePath, archive.stdout);
}

function alignTo4(value) {
  return (value + 3) & ~3;
}

function parseNewcEntries(archivePath) {
  const archive = fs.readFileSync(archivePath);
  const entries = [];
  let offset = 0;

  while (offset + 110 <= archive.length) {
    while (offset < archive.length && archive[offset] === 0) {
      offset += 1;
    }
    if (offset + 110 > archive.length) {
      break;
    }

    const magic = archive.toString("ascii", offset, offset + 6);
    assert.match(magic, /^07070[12]$/);

    const parseHexField = (fieldOffset) =>
      Number.parseInt(archive.toString("ascii", offset + fieldOffset, offset + fieldOffset + 8), 16);

    const fileSize = parseHexField(54);
    const nameSize = parseHexField(94);
    const nameStart = offset + 110;
    const nameEnd = nameStart + nameSize;
    const name = archive.toString("utf8", nameStart, nameEnd - 1).replace(/^\.\//, "");
    const dataStart = alignTo4(nameEnd);
    const dataEnd = dataStart + fileSize;

    offset = alignTo4(dataEnd);
    if (name === "TRAILER!!!") {
      continue;
    }

    entries.push({
      name,
      content: archive.subarray(dataStart, dataEnd),
    });
  }

  return entries;
}

function listCpioEntries(archivePath) {
  return parseNewcEntries(archivePath).map((entry) => entry.name);
}

function readCpioEntry(archivePath, entryPath) {
  const normalizedEntryPath = entryPath.replace(/^\.\//, "");
  const entries = parseNewcEntries(archivePath);
  const matchedEntry = [...entries].reverse().find((entry) => entry.name === normalizedEntryPath);
  assert.ok(matchedEntry, `missing cpio entry: ${normalizedEntryPath}`);
  return matchedEntry.content.toString("utf8");
}

function gunzipFile(gzipPath) {
  const result = spawnSync("gzip", ["-dc"], {
    input: fs.readFileSync(gzipPath),
  });
  assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
  return result.stdout;
}

test("buildroot-based CVM build stages explicit linux, buildroot, and firmware-backed host artifacts", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-"));
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const resultFile = path.join(tmpDir, "result.json");
  const inspectResultFile = path.join(tmpDir, "inspect.json");
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const l1Kernel = path.join(tmpDir, "linux-out", "Image");
  const l1FirmwareA = path.join(tmpDir, "firmware", "SBSA_FLASH0.fd");
  const l1FirmwareB = path.join(tmpDir, "firmware", "SBSA_FLASH1.fd");
  const buildrootOutputDir = path.join(tmpDir, "buildroot-out");
  const explicitL2Kernel = path.join(tmpDir, "explicit-l2", "Image");
  const explicitL2Qemu = path.join(tmpDir, "explicit-l2", "qemu-system-aarch64");

  writeExecutable(hostQemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.writeFileSync(l1Kernel, "l1-kernel\n");
  fs.mkdirSync(path.dirname(explicitL2Kernel), { recursive: true });
  fs.writeFileSync(explicitL2Kernel, "explicit-l2-kernel\n");
  writeExecutable(explicitL2Qemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(l1FirmwareA), { recursive: true });
  fs.writeFileSync(l1FirmwareA, "flash-a\n");
  fs.writeFileSync(l1FirmwareB, "flash-b\n");

  fs.mkdirSync(path.join(buildrootOutputDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "build"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "bin"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "share", "qemu"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "lib"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "lib"), { recursive: true });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "Image"), "l2-image\n");
  createCpioArchive(path.join(buildrootOutputDir, "images", "rootfs.cpio"), {
    "init": {
      contents: "#!/bin/sh\nexec /sbin/init\n",
      mode: 0o755,
    },
  });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.cpio.gz"), "l2-initrd\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.ext2"), "l1-rootfs\n");
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

  const firstRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR: buildDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU: hostQemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR: buildrootOutputDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL: l1Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_A: l1FirmwareA,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_B: l1FirmwareB,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MACHINE: "sbsa-ref",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPU: "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CMDLINE: "root=/dev/vda console=ttyAMA0",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MEMORY_MB: "4096",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPUS: "1",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REUSE_BUILD_DIR: "true",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
    },
  });
  assert.equal(firstRun.status, 0, firstRun.stderr + firstRun.stdout);
  const firstResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(firstResult.details.reused, false);
  assert.deepEqual(firstResult.artifacts, [
    { path: "prepared-state", location: path.join(installDir, "state.json") },
    { path: "share-dir", location: path.join(buildDir, "l1") },
  ]);

  const stateFile = path.join(installDir, "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.tool, "nvirsh-buildroot-based-cvm");
  assert.equal(state.layeredState.l2.mode, "cvm");
  assert.equal(state.layeredState.l2.buildrootImages.virtioTransport, "pci");
  assert.equal(state.hostLaunch.qemu, hostQemu);
  assert.equal(state.hostLaunch.firmwareA, path.join(buildDir, "l1", "host-firmware", "SBSA_FLASH0.fd"));
  assert.equal(state.hostLaunch.firmwareB, path.join(buildDir, "l1", "host-firmware", "SBSA_FLASH1.fd"));
  assert.equal(state.hostLaunch.kernel, path.join(buildDir, "l1", "host-boot", "Image"));
  assert.equal(state.hostLaunch.machine, "sbsa-ref");
  assert.equal(state.hostLaunch.cpu, "max,x-rme=on,sme=off,pauth-impdef=on,sve=off");
  assert.equal(state.hostLaunch.cmdline, "root=/dev/vda console=ttyAMA0");
  assert.equal(state.hostLaunch.memory, "4096");
  assert.equal(state.hostLaunch.cpus, "1");
  assert.equal(state.hostLaunch.enableKvm, false);
  assert.equal(
    state.layeredState.l1.rootfs,
    path.join(buildDir, "l1", "host-rootfs", "rootfs.ext2"),
  );
  assert.equal(state.layeredState.l1.hostStackArchive, undefined);
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
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2.sh"), "utf8"),
    /^#!\/bin\/sh$/m,
  );
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2.sh"), "utf8"),
    /runtime_dir="\$\{MORPHEUS_L2_RUNTIME_DIR:-\/mnt\/morpheus-l2-runtime\}"/,
  );
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2-hoststack.sh"), "utf8"),
    /^#!\/bin\/sh$/m,
  );
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2-hoststack.sh"), "utf8"),
    /exec \/mnt\/launch-l2\.sh/,
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
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_A: l1FirmwareA,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_B: l1FirmwareB,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MACHINE: "sbsa-ref",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPU: "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CMDLINE: "root=/dev/vda console=ttyAMA0",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MEMORY_MB: "4096",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPUS: "1",
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
  assert.equal(inspectResult.details.guest_virtio_transport, "pci");
});

test("buildroot-based CVM build reuses the linux kernel when buildroot does not provide one", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-shared-kernel-"));
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const resultFile = path.join(tmpDir, "result.json");
  const inspectResultFile = path.join(tmpDir, "inspect.json");
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const l1Kernel = path.join(tmpDir, "linux-out", "Image");
  const l1FirmwareA = path.join(tmpDir, "firmware", "SBSA_FLASH0.fd");
  const l1FirmwareB = path.join(tmpDir, "firmware", "SBSA_FLASH1.fd");
  const buildrootOutputDir = path.join(tmpDir, "buildroot-out");

  writeExecutable(hostQemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.writeFileSync(l1Kernel, "shared-kernel\n");
  fs.mkdirSync(path.dirname(l1FirmwareA), { recursive: true });
  fs.writeFileSync(l1FirmwareA, "flash-a\n");
  fs.writeFileSync(l1FirmwareB, "flash-b\n");

  fs.mkdirSync(path.join(buildrootOutputDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "bin"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "share", "qemu"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "lib"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "lib"), { recursive: true });
  createCpioArchive(path.join(buildrootOutputDir, "images", "rootfs.cpio"), {
    "init": {
      contents: "#!/bin/sh\nexec /sbin/init\n",
      mode: 0o755,
    },
  });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.cpio.gz"), "l2-initrd\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.ext2"), "l1-rootfs\n");
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "qemu-system-aarch64"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "lib", "ld-linux-aarch64.so.1"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "share", "qemu", "edk2.bin"),
    "qemu-data\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "lib", "libfdt.so.1"),
    "libfdt\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, ".morpheus-build-inputs.json"),
    JSON.stringify({ fingerprint: "buildroot-fixture-fingerprint" }, null, 2),
  );

  const buildRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR: buildDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU: hostQemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR: buildrootOutputDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL: l1Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_A: l1FirmwareA,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_B: l1FirmwareB,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MACHINE: "sbsa-ref",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPU: "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CMDLINE: "root=/dev/vda console=ttyAMA0",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MEMORY_MB: "4096",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPUS: "1",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REUSE_BUILD_DIR: "true",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm-shared-kernel",
    },
  });
  assert.equal(buildRun.status, 0, buildRun.stderr + buildRun.stdout);

  assert.equal(
    fs.readFileSync(path.join(buildDir, "l1", "guest-images", "Image"), "utf8"),
    "shared-kernel\n",
  );

  const inspectRun = spawnSync("bash", [inspectScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: path.join(tmpDir, "run"),
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm-shared-kernel",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: inspectResultFile,
    },
  });
  assert.equal(inspectRun.status, 0, inspectRun.stderr + inspectRun.stdout);

  const inspectResult = JSON.parse(fs.readFileSync(inspectResultFile, "utf8"));
  assert.equal(inspectResult.details.guest_kernel_vmlinux, null);
  assert.equal(
    inspectResult.details.guest_kernel_image,
    path.join(buildDir, "l1", "guest-images", "Image"),
  );
  assert.equal(inspectResult.details.guest_virtio_transport, "pci");
});

test("buildroot-based CVM build switches to the Linaro helper launch path when realm helper artifacts are provided", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-linaro-helper-"));
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const resultFile = path.join(tmpDir, "result.json");
  const inspectResultFile = path.join(tmpDir, "inspect.json");
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const qemuEdk2 = path.join(tmpDir, "host-qemu", "share", "qemu", "edk2-aarch64-code.fd");
  const l2GuestDisk = path.join(tmpDir, "linaro", "guest-disk.img");
  const l2KvmtoolEfi = path.join(tmpDir, "linaro", "KVMTOOL_EFI.fd");
  const l1Kernel = path.join(tmpDir, "linux-out", "Image");
  const l1FirmwareA = path.join(tmpDir, "firmware", "SBSA_FLASH0.fd");
  const l1FirmwareB = path.join(tmpDir, "firmware", "SBSA_FLASH1.fd");
  const buildrootOutputDir = path.join(tmpDir, "buildroot-out");

  writeExecutable(hostQemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(qemuEdk2), { recursive: true });
  fs.writeFileSync(qemuEdk2, "qemu-edk2\n");
  fs.mkdirSync(path.dirname(l2GuestDisk), { recursive: true });
  fs.writeFileSync(l2GuestDisk, "guest-disk\n");
  fs.writeFileSync(l2KvmtoolEfi, "kvmtool-efi\n");
  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.writeFileSync(l1Kernel, "shared-kernel\n");
  fs.mkdirSync(path.dirname(l1FirmwareA), { recursive: true });
  fs.writeFileSync(l1FirmwareA, "flash-a\n");
  fs.writeFileSync(l1FirmwareB, "flash-b\n");

  fs.mkdirSync(path.join(buildrootOutputDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "build"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "bin"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "share", "qemu"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "lib"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "lib"), { recursive: true });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "Image"), "l2-image\n");
  createCpioArchive(path.join(buildrootOutputDir, "images", "rootfs.cpio"), {
    "init": {
      contents: "#!/bin/sh\nexec /sbin/init\n",
      mode: 0o755,
    },
    "etc": { directory: true },
    "etc/init.d": { directory: true },
  });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.cpio.gz"), "l2-initrd\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.ext2"), "l1-rootfs\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "build", "vmlinux"), "l2-vmlinux\n");
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "qemu-system-aarch64"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "gen-run-vmm.sh"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "realm-measurements"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "lkvm"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "lib", "ld-linux-aarch64.so.1"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "share", "qemu", "edk2.bin"),
    "qemu-data\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "lib", "libfdt.so.1"),
    "libfdt\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, ".morpheus-build-inputs.json"),
    JSON.stringify({ fingerprint: "buildroot-fixture-fingerprint" }, null, 2),
  );

  const buildRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR: buildDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU: hostQemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU_EDK2: qemuEdk2,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_GUEST_DISK: l2GuestDisk,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_KVMTOOL_EFI: l2KvmtoolEfi,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR: buildrootOutputDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL: l1Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_A: l1FirmwareA,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_B: l1FirmwareB,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MACHINE: "sbsa-ref",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPU: "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CMDLINE: "root=/dev/vda console=ttyAMA0",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_MEMORY_MB: "4096",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_CPUS: "1",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REUSE_BUILD_DIR: "true",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm-linaro-helper",
    },
  });
  assert.equal(buildRun.status, 0, buildRun.stderr + buildRun.stdout);

  const state = JSON.parse(fs.readFileSync(path.join(installDir, "state.json"), "utf8"));
  assert.equal(state.layeredState.l2.buildrootImages.launchMode, "linaro-gen-run-vmm");
  assert.equal(state.layeredState.l2.buildrootImages.virtioTransport, "pci");
  assert.equal(
    state.layeredState.l2.buildrootImages.helperCfg,
    path.join(buildDir, "l1", "gen-run-vmm.cfg"),
  );
  assert.equal(
    state.layeredState.l2.buildrootImages.guestDisk,
    path.join(buildDir, "l1", "guest-disk.img"),
  );
  assert.equal(
    state.layeredState.l2.buildrootImages.qemuEfi,
    path.join(buildDir, "l1", "Build", "ArmVirtQemu-AARCH64", "DEBUG_GCC5", "FV", "QEMU_EFI.fd"),
  );
  assert.equal(
    fs.readFileSync(path.join(buildDir, "l1", "gen-run-vmm.cfg"), "utf8"),
    "KERNEL=/mnt/Image\nINITRD=/mnt/rootfs.cpio\nEDK2_DIR=/mnt/\nRUN_DISK=/mnt/guest-disk.img\n",
  );
  assert.equal(
    listCpioEntries(path.join(buildDir, "l1", "rootfs.cpio")).includes("etc/init.d/S60morpheus-rsi-evidence"),
    true,
  );
  assert.match(
    readCpioEntry(
      path.join(buildDir, "l1", "rootfs.cpio"),
      "etc/init.d/S60morpheus-rsi-evidence",
    ),
    /MORPHEUS_RSI_EVIDENCE:/,
  );
  fs.writeFileSync(
    path.join(tmpDir, "inflated-rootfs.cpio"),
    gunzipFile(path.join(buildDir, "l1", "rootfs.cpio.gz")),
  );
  assert.equal(
    listCpioEntries(path.join(tmpDir, "inflated-rootfs.cpio")).includes("etc/init.d/S60morpheus-rsi-evidence"),
    true,
  );
  assert.equal(
    fs.readFileSync(path.join(buildDir, "l1", "guest-disk.img"), "utf8"),
    "guest-disk\n",
  );
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2.sh"), "utf8"),
    /gen-run-vmm\.sh --tap --serial/,
  );
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2-hoststack.sh"), "utf8"),
    /MORPHEUS_L2_GEN_RUN_VMM_CFG/,
  );
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2-hoststack.sh"), "utf8"),
    /mount -t sysfs sysfs \/sys/,
  );
  assert.match(
    fs.readFileSync(path.join(buildDir, "l1", "launch-l2-hoststack.sh"), "utf8"),
    /\/etc\/init\.d\/S50macvtap start/,
  );

  const inspectRun = spawnSync("bash", [inspectScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: path.join(tmpDir, "run"),
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm-linaro-helper",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: inspectResultFile,
    },
  });
  assert.equal(inspectRun.status, 0, inspectRun.stderr + inspectRun.stdout);

  const inspectResult = JSON.parse(fs.readFileSync(inspectResultFile, "utf8"));
  assert.equal(inspectResult.details.guest_launch_mode, "linaro-gen-run-vmm");
  assert.equal(inspectResult.details.guest_virtio_transport, "pci");
  assert.equal(
    inspectResult.details.guest_helper_cfg,
    path.join(buildDir, "l1", "gen-run-vmm.cfg"),
  );
  assert.equal(inspectResult.details.guest_rsi_evidence, null);
});

test("buildroot-based CVM build supports direct MMIO-backed L2 virtio devices", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-mmio-"));
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const resultFile = path.join(tmpDir, "result.json");
  const inspectResultFile = path.join(tmpDir, "inspect.json");
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const l1Kernel = path.join(tmpDir, "linux-out", "Image");
  const l1FirmwareA = path.join(tmpDir, "firmware", "SBSA_FLASH0.fd");
  const l1FirmwareB = path.join(tmpDir, "firmware", "SBSA_FLASH1.fd");
  const buildrootOutputDir = path.join(tmpDir, "buildroot-out");
  const explicitL2Kernel = path.join(tmpDir, "explicit-l2", "Image");
  const explicitL2Qemu = path.join(tmpDir, "explicit-l2", "qemu-system-aarch64");

  writeExecutable(hostQemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.writeFileSync(l1Kernel, "l1-kernel\n");
  fs.mkdirSync(path.dirname(explicitL2Kernel), { recursive: true });
  fs.writeFileSync(explicitL2Kernel, "explicit-l2-kernel\n");
  writeExecutable(explicitL2Qemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(l1FirmwareA), { recursive: true });
  fs.writeFileSync(l1FirmwareA, "flash-a\n");
  fs.writeFileSync(l1FirmwareB, "flash-b\n");

  fs.mkdirSync(path.join(buildrootOutputDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "build"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "bin"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "share", "qemu"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "lib"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "lib"), { recursive: true });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "Image"), "l2-image\n");
  createCpioArchive(path.join(buildrootOutputDir, "images", "rootfs.cpio"), {
    "init": {
      contents: "#!/bin/sh\nexec /sbin/init\n",
      mode: 0o755,
    },
  });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.cpio.gz"), "l2-initrd\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.ext2"), "l1-rootfs\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "build", "vmlinux"), "l2-vmlinux\n");
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "qemu-system-aarch64"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "lib", "ld-linux-aarch64.so.1"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "share", "qemu", "edk2.bin"),
    "qemu-data\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "lib", "libfdt.so.1"),
    "libfdt\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, ".morpheus-build-inputs.json"),
    JSON.stringify({ fingerprint: "buildroot-fixture-fingerprint" }, null, 2),
  );

  const buildRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR: buildDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU: hostQemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR: buildrootOutputDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL: l1Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_KERNEL: explicitL2Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_A: l1FirmwareA,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_B: l1FirmwareB,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_QEMU: explicitL2Qemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_VIRTIO_TRANSPORT: "mmio",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_REUSE_BUILD_DIR: "true",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm-mmio",
    },
  });
  assert.equal(buildRun.status, 0, buildRun.stderr + buildRun.stdout);

  const state = JSON.parse(fs.readFileSync(path.join(installDir, "state.json"), "utf8"));
  assert.equal(state.layeredState.l2.buildrootImages.launchMode, "direct-qemu");
  assert.equal(state.layeredState.l2.buildrootImages.virtioTransport, "mmio");
  assert.equal(
    fs.readFileSync(path.join(buildDir, "l1", "guest-images", "Image"), "utf8"),
    "explicit-l2-kernel\n",
  );
  assert.equal(
    fs.readFileSync(path.join(buildDir, "l1", "guest-qemu", "bin", "qemu-system-aarch64"), "utf8"),
    "#!/bin/sh\nexit 0\n",
  );
  const launchScript = fs.readFileSync(path.join(buildDir, "l1", "launch-l2.sh"), "utf8");
  assert.equal(
    launchScript.includes(
      "printf 'launch-mode=direct-qemu\\n' >> \"${launch_marker}\"",
    ),
    true,
  );
  assert.match(
    launchScript,
    /guest_virtio_transport="mmio"/,
  );
  assert.match(
    launchScript,
    /guest_realm_measurements="\/usr\/bin\/realm-measurements"/,
  );
  assert.match(
    launchScript,
    /guest_qemu_dtb="\$\{runtime_dir\}\/qemu-gen\.dtb"/,
  );
  assert.match(
    launchScript,
    /guest_bootargs="console=hvc0 oops=panic panic_on_warn=1 panic=-1 kasan\.fault=panic"/,
  );
  assert.match(
    launchScript,
    /guest_virtio_net_device="virtio-net-device,netdev=net0"/,
  );
  assert.match(
    launchScript,
    /guest_bootargs="console=ttyAMA0 oops=panic panic_on_warn=1 panic=-1 kasan\.fault=panic"/,
  );
  assert.match(
    launchScript,
    /if \[ "\$\{guest_virtio_transport\}" = "mmio" \]; then\s+# Nested KVM cannot reliably route virtio-mmio ioeventfds through the\s+# Realm boundary\. Keep queue notifications in QEMU and use the modern\s+# transport interface expected by the MMIO-only L2 kernel\.\s+set -- "\$@" \\\s+-global "virtio-mmio\.force-legacy=off" \\\s+-global "virtio-mmio\.ioeventfd=off"\s+fi/,
  );
  assert.match(
    launchScript,
    /guest_qemu_has_morpheus_mmio_patch="false"/,
  );
  assert.match(
    launchScript,
    /if LC_ALL=C grep -a -q 'virtio_mmio_fuzz_read' "\$\{guest_qemu\}" 2>\/dev\/null &&/,
  );
  assert.match(
    launchScript,
    /LC_ALL=C grep -a -q 'virtio_mmio_dma_fuzz' "\$\{guest_qemu\}" 2>\/dev\/null; then/,
  );
  assert.match(
    launchScript,
    /if \[ "\$\{guest_qemu_has_morpheus_mmio_patch\}" = "true" \]; then\s+set -- "\$@" \\\s+-trace "events=\$\{guest_qemu_trace_events\},file=\$\{runtime_dir\}\/morpheus-qemu-trace\.log"/,
  );
  assert.match(
    launchScript,
    /-dtb "\$\{guest_qemu_dtb\}"/,
  );
  assert.match(
    launchScript,
    /-initrd "\$\{guest_image_dir\}\/rootfs\.cpio"/,
  );
  assert.match(
    launchScript,
    /"\$\{guest_realm_measurements\}" \\\s+-c "\$\{guest_realm_configs_dir\}\/qemu-max-8\.2\.conf" \\\s+-c "\$\{guest_realm_configs_dir\}\/kvm\.conf" \\\s+-k "\$\{guest_image_dir\}\/Image" \\\s+-i "\$\{guest_image_dir\}\/rootfs\.cpio" \\\s+--no-measurements \\\s+--output-dtb "\$\{guest_qemu_dtb\}" \\\s+qemu \\\s+"\$@"/,
  );
  assert.match(
    launchScript,
    /-M "confidential-guest-support=rme0"/,
  );
  assert.match(
    launchScript,
    /-object "rme-guest,id=rme0"/,
  );
  assert.match(
    launchScript,
    /-M virt \\\s+-enable-kvm \\\s+-M "gic-version=3,its=on" \\\s+-smp 2/,
  );
  const mmioCommandSection = launchScript.slice(
    0,
    launchScript.indexOf('if [ "${guest_virtio_transport}" != "mmio" ]; then'),
  );
  assert.doesNotMatch(
    mmioCommandSection,
    /-device "\$\{guest_virtio_serial_device\}"/,
  );
  assert.doesNotMatch(
    mmioCommandSection,
    /-device "virtconsole,chardev=chr0"/,
  );
  assert.match(
    launchScript,
    /if \[ "\$\{guest_virtio_transport\}" != "mmio" \]; then\s+set -- "\$@" \\\s+-device "\$\{guest_virtio_serial_device\}" \\\s+-device "virtconsole,chardev=chr0"\s+fi/,
  );
  assert.match(
    launchScript,
    /-append "\$\{guest_bootargs\}"/,
  );
  assert.doesNotMatch(
    launchScript,
    /measurement-algorithm=sha512/,
  );

  const inspectRun = spawnSync("bash", [inspectScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: path.join(tmpDir, "run"),
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm-mmio",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: inspectResultFile,
    },
  });
  assert.equal(inspectRun.status, 0, inspectRun.stderr + inspectRun.stdout);

  const inspectResult = JSON.parse(fs.readFileSync(inspectResultFile, "utf8"));
  assert.equal(inspectResult.details.guest_launch_mode, "direct-qemu");
  assert.equal(inspectResult.details.guest_virtio_transport, "mmio");
});

test("buildroot-based CVM build rejects MMIO transport in Linaro helper mode", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-helper-mmio-"));
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const resultFile = path.join(tmpDir, "result.json");
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const qemuEdk2 = path.join(tmpDir, "host-qemu", "share", "qemu", "edk2-aarch64-code.fd");
  const l2GuestDisk = path.join(tmpDir, "linaro", "guest-disk.img");
  const l2KvmtoolEfi = path.join(tmpDir, "linaro", "KVMTOOL_EFI.fd");
  const l1Kernel = path.join(tmpDir, "linux-out", "Image");
  const l1FirmwareA = path.join(tmpDir, "firmware", "SBSA_FLASH0.fd");
  const l1FirmwareB = path.join(tmpDir, "firmware", "SBSA_FLASH1.fd");
  const buildrootOutputDir = path.join(tmpDir, "buildroot-out");

  writeExecutable(hostQemu, "#!/bin/sh\nexit 0\n");
  fs.mkdirSync(path.dirname(qemuEdk2), { recursive: true });
  fs.writeFileSync(qemuEdk2, "qemu-edk2\n");
  fs.mkdirSync(path.dirname(l2GuestDisk), { recursive: true });
  fs.writeFileSync(l2GuestDisk, "guest-disk\n");
  fs.writeFileSync(l2KvmtoolEfi, "kvmtool-efi\n");
  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.writeFileSync(l1Kernel, "shared-kernel\n");
  fs.mkdirSync(path.dirname(l1FirmwareA), { recursive: true });
  fs.writeFileSync(l1FirmwareA, "flash-a\n");
  fs.writeFileSync(l1FirmwareB, "flash-b\n");

  fs.mkdirSync(path.join(buildrootOutputDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "build"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "bin"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "share", "qemu"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "lib"), { recursive: true });
  fs.mkdirSync(path.join(buildrootOutputDir, "target", "usr", "lib"), { recursive: true });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "Image"), "l2-image\n");
  createCpioArchive(path.join(buildrootOutputDir, "images", "rootfs.cpio"), {
    "init": {
      contents: "#!/bin/sh\nexec /sbin/init\n",
      mode: 0o755,
    },
    "etc": { directory: true },
    "etc/init.d": { directory: true },
  });
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.cpio.gz"), "l2-initrd\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "images", "rootfs.ext2"), "l1-rootfs\n");
  fs.writeFileSync(path.join(buildrootOutputDir, "build", "vmlinux"), "l2-vmlinux\n");
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "qemu-system-aarch64"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "gen-run-vmm.sh"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "realm-measurements"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "usr", "bin", "lkvm"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildrootOutputDir, "target", "lib", "ld-linux-aarch64.so.1"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "share", "qemu", "edk2.bin"),
    "qemu-data\n",
  );
  fs.writeFileSync(
    path.join(buildrootOutputDir, "target", "usr", "lib", "libfdt.so.1"),
    "libfdt\n",
  );

  const buildRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR: buildDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU: hostQemu,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU_EDK2: qemuEdk2,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_GUEST_DISK: l2GuestDisk,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_KVMTOOL_EFI: l2KvmtoolEfi,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILDROOT_OUTPUT_DIR: buildrootOutputDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_KERNEL: l1Kernel,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_A: l1FirmwareA,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L1_FIRMWARE_B: l1FirmwareB,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_VIRTIO_TRANSPORT: "mmio",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm-helper-mmio",
    },
  });
  assert.equal(buildRun.status, 1);
  assert.match(
    buildRun.stderr + buildRun.stdout,
    /linaro helper launch only supports l2 virtio transport pci/,
  );
});
