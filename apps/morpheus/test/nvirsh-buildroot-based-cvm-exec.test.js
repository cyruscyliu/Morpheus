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
const execScript = path.join(
  repoRoot,
  "tools",
  "nvirsh-buildroot-based-cvm",
  "scripts",
  "exec.sh",
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

function prepareBuildFixture(tmpDir, hostQemu, options = {}) {
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const resultFile = path.join(tmpDir, "build-result.json");
  const l1Kernel = path.join(tmpDir, "linux-out", "Image");
  const l1FirmwareA = path.join(tmpDir, "firmware", "SBSA_FLASH0.fd");
  const l1FirmwareB = path.join(tmpDir, "firmware", "SBSA_FLASH1.fd");
  const buildrootOutputDir = path.join(tmpDir, "buildroot-out");
  const helperMode = Boolean(options.helperMode);

  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.writeFileSync(l1Kernel, "l1-kernel\n");
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
  if (helperMode) {
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
  }
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
      ...(helperMode
        ? {
            MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_QEMU_EDK2: path.join(tmpDir, "linaro", "edk2-aarch64-code.fd"),
            MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_GUEST_DISK: path.join(tmpDir, "linaro", "guest-disk.img"),
            MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_L2_KVMTOOL_EFI: path.join(tmpDir, "linaro", "KVMTOOL_EFI.fd"),
          }
        : {}),
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: resultFile,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
    },
  });
  assert.equal(buildRun.status, 0, buildRun.stderr + buildRun.stdout);

  return {
    buildDir,
    installDir,
    buildrootOutputDir,
    resultFile,
  };
}

function prepareHelperArtifacts(tmpDir) {
  const helperDir = path.join(tmpDir, "linaro");
  fs.mkdirSync(helperDir, { recursive: true });
  fs.writeFileSync(path.join(helperDir, "edk2-aarch64-code.fd"), "qemu-edk2\n");
  fs.writeFileSync(path.join(helperDir, "guest-disk.img"), "guest-disk\n");
  fs.writeFileSync(path.join(helperDir, "KVMTOOL_EFI.fd"), "kvmtool-efi\n");
}

test("buildroot-based CVM exec launches L1 with explicit firmware, rootfs, share, and append wiring", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-exec-"));
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const argsLog = path.join(tmpDir, "host-qemu.args.log");
  const execResultFile = path.join(tmpDir, "exec-result.json");
  const runDir = path.join(tmpDir, "run");

  writeExecutable(
    hostQemu,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      `printf '%s\\n' \"$@\" > ${JSON.stringify(argsLog)}`,
      "share_dir=''",
      "for arg in \"$@\"; do",
      "  case \"$arg\" in",
      "    local,security_model=none,path=*,id=hostshare)",
      "      share_dir=\"${arg#local,security_model=none,path=}\"",
      "      share_dir=\"${share_dir%,id=hostshare}\"",
      "      ;;",
      "  esac",
      "done",
      "if [ -n \"$share_dir\" ]; then",
      "  runtime_dir=\"$share_dir/morpheus-l2-runtime\"",
      "  mkdir -p \"$runtime_dir\"",
      "  printf '%s\\n' 'buildroot login:' > \"$runtime_dir/qemu.stdout.log\"",
      "  : > \"$runtime_dir/qemu.stderr.log\"",
      "fi",
      "trap 'exit 0' TERM INT",
      "while :; do sleep 1; done",
    ].join("\n"),
  );

  const { buildDir, installDir } = prepareBuildFixture(tmpDir, hostQemu);

  const execRun = spawnSync("bash", [execScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: runDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_PHASE: "launch",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: execResultFile,
    },
  });
  assert.equal(execRun.status, 0, execRun.stderr + execRun.stdout);

  const execResult = JSON.parse(fs.readFileSync(execResultFile, "utf8"));
  assert.equal(execResult.details.phase, "launch");
  assert.equal(execResult.details.build_dir_key, "fixture-cvm");

  const manifest = JSON.parse(
    fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.status, "success");
  assert.equal(manifest.hostLaunch.machine, "sbsa-ref");
  assert.equal(
    manifest.hostLaunch.firmwareA,
    path.join(buildDir, "l1", "host-firmware", "SBSA_FLASH0.fd"),
  );
  assert.equal(
    manifest.hostLaunch.firmwareB,
    path.join(buildDir, "l1", "host-firmware", "SBSA_FLASH1.fd"),
  );

  const args = fs.readFileSync(argsLog, "utf8").trim().split("\n");
  assert.ok(args.includes("-machine"));
  assert.ok(args.includes("sbsa-ref"));
  assert.ok(args.includes("-cpu"));
  assert.ok(args.includes("max,x-rme=on,sme=off,pauth-impdef=on,sve=off"));
  assert.ok(
    args.includes(
      `file=${path.join(buildDir, "l1", "host-firmware", "SBSA_FLASH0.fd")},format=raw,if=pflash`,
    ),
  );
  assert.ok(
    args.includes(
      `file=${path.join(buildDir, "l1", "host-firmware", "SBSA_FLASH1.fd")},format=raw,if=pflash`,
    ),
  );
  assert.ok(
    args.includes(
      `file=fat:rw:${path.join(runDir, "l1-boot-fat")},format=raw`,
    ),
  );
  assert.ok(
    args.includes(
      `format=raw,id=hd0,if=none,file=${path.join(buildDir, "l1", "host-rootfs", "rootfs.ext2")}`,
    ),
  );
  assert.ok(args.includes("virtio-blk-pci,drive=hd0"));
  assert.ok(args.includes("virtio-9p-pci,fsdev=hostshare,mount_tag=host"));
  assert.ok(
    args.includes(
      `local,security_model=none,path=${path.join(buildDir, "l1")},id=hostshare`,
    ),
  );
  assert.ok(
    args.includes(
      `local,security_model=none,path=${path.join(buildDir, "l1")},id=hostshare`,
    ),
  );
  assert.equal(args.includes("-kernel"), false);
  assert.equal(args.includes("-append"), false);
  assert.equal(args.includes("-enable-kvm"), false);

  const startupScript = fs.readFileSync(
    path.join(runDir, "l1-boot-fat", "startup.nsh"),
    "utf8",
  );
  assert.match(startupScript, /^mode 100 31$/m);
  assert.match(startupScript, /^pci$/m);
  assert.match(
    startupScript,
    /fs0:\\Image root=\/dev\/vda console=ttyAMA0 init=\/bin\/sh -- -c "mount -t 9p -o trans=virtio,version=9p2000\.L host \/mnt && exec \/mnt\/launch-l2-hoststack\.sh"/,
  );
});

test("buildroot-based CVM exec writes an error manifest when the L1 host launch exits early", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-exec-fail-"));
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const execResultFile = path.join(tmpDir, "exec-result.json");
  const runDir = path.join(tmpDir, "run");

  writeExecutable(
    hostQemu,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "exit 1",
    ].join("\n"),
  );

  const { installDir } = prepareBuildFixture(tmpDir, hostQemu);

  const execRun = spawnSync("bash", [execScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: runDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_PHASE: "launch",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: execResultFile,
    },
  });
  assert.equal(execRun.status, 1, execRun.stderr + execRun.stdout);
  assert.doesNotMatch(execRun.stderr + execRun.stdout, /\$4: unbound variable/);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.status, "error");
  assert.equal(manifest.exitCode, 1);
});

test("buildroot-based CVM exec helper mode requires guest RSI evidence before success", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-exec-helper-"));
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const execResultFile = path.join(tmpDir, "exec-result.json");
  const runDir = path.join(tmpDir, "run");

  prepareHelperArtifacts(tmpDir);
  writeExecutable(
    hostQemu,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "share_dir=''",
      "for arg in \"$@\"; do",
      "  case \"$arg\" in",
      "    local,security_model=none,path=*,id=hostshare)",
      "      share_dir=\"${arg#local,security_model=none,path=}\"",
      "      share_dir=\"${share_dir%,id=hostshare}\"",
      "      ;;",
      "  esac",
      "done",
      "runtime_dir=\"$share_dir/morpheus-l2-runtime\"",
      "mkdir -p \"$runtime_dir\"",
      "printf '%s\\n' 'MORPHEUS_RSI_EVIDENCE: [    0.000000] RME: Using RSI version 1.0' > \"$runtime_dir/qemu.stdout.log\"",
      "printf '%s\\n' 'buildroot login:' >> \"$runtime_dir/qemu.stdout.log\"",
      ": > \"$runtime_dir/qemu.stderr.log\"",
      "trap 'exit 0' TERM INT",
      "while :; do sleep 1; done",
    ].join("\n"),
  );

  const { installDir } = prepareBuildFixture(tmpDir, hostQemu, { helperMode: true });

  const execRun = spawnSync("bash", [execScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: runDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_PHASE: "launch",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: execResultFile,
    },
  });
  assert.equal(execRun.status, 0, execRun.stderr + execRun.stdout);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.status, "success");
  assert.equal(
    manifest.runtime.l2.rsiEvidence,
    "MORPHEUS_RSI_EVIDENCE: [    0.000000] RME: Using RSI version 1.0",
  );
  assert.equal(manifest.runtime.l2.rsiEvidenceMissing, false);
});

test("buildroot-based CVM exec helper mode fails when guest RSI evidence is missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-cvm-exec-helper-fail-"));
  const hostQemu = path.join(tmpDir, "host-qemu", "bin", "qemu-system-aarch64");
  const execResultFile = path.join(tmpDir, "exec-result.json");
  const runDir = path.join(tmpDir, "run");

  prepareHelperArtifacts(tmpDir);
  writeExecutable(
    hostQemu,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "share_dir=''",
      "for arg in \"$@\"; do",
      "  case \"$arg\" in",
      "    local,security_model=none,path=*,id=hostshare)",
      "      share_dir=\"${arg#local,security_model=none,path=}\"",
      "      share_dir=\"${share_dir%,id=hostshare}\"",
      "      ;;",
      "  esac",
      "done",
      "runtime_dir=\"$share_dir/morpheus-l2-runtime\"",
      "mkdir -p \"$runtime_dir\"",
      "printf '%s\\n' 'MORPHEUS_RSI_EVIDENCE_MISSING' > \"$runtime_dir/qemu.stdout.log\"",
      "printf '%s\\n' 'buildroot login:' >> \"$runtime_dir/qemu.stdout.log\"",
      ": > \"$runtime_dir/qemu.stderr.log\"",
      "trap 'exit 0' TERM INT",
      "while :; do sleep 1; done",
    ].join("\n"),
  );

  const { installDir } = prepareBuildFixture(tmpDir, hostQemu, { helperMode: true });

  const execRun = spawnSync("bash", [execScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_INSTALL_DIR: installDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RUN_DIR: runDir,
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_PHASE: "launch",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_BUILD_DIR_KEY: "fixture-cvm",
      MORPHEUS_NVIRSH_BUILDROOT_BASED_CVM_RESULT_FILE: execResultFile,
    },
  });
  assert.equal(execRun.status, 1, execRun.stderr + execRun.stdout);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.status, "error");
  assert.equal(manifest.errorMessage, "guest RSI evidence missing from realm console");
  assert.equal(manifest.runtime.l2.rsiEvidence, null);
  assert.equal(manifest.runtime.l2.rsiEvidenceMissing, true);
});
