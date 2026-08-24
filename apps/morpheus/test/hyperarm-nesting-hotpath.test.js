const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const stubSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "libafl",
    "patches",
    "overlay",
    "crates",
    "libafl_nesting",
    "c_src",
    "libafl_nesting_stub.c",
  ),
  "utf8",
);
const rustStubSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "libafl",
    "patches",
    "overlay",
    "crates",
    "libafl_nesting",
    "src",
    "bin",
    "libafl_nesting_stub.rs",
  ),
  "utf8",
);
const generatorSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "libafl",
    "patches",
    "overlay",
    "crates",
    "libafl_nesting",
    "src",
    "generator.rs",
  ),
  "utf8",
);
const nvirshBuildSource = fs.readFileSync(
  path.join(repoRoot, "tools", "nvirsh", "scripts", "build.sh"),
  "utf8",
);
const nvirshProfile = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      "tools",
      "nvirsh",
      "profiles",
      "qemu-debian-arm",
      "profile.json",
    ),
    "utf8",
  ),
);
const harnessSource = fs.readFileSync(
  path.join(repoRoot, "tools", "libafl", "scripts", "exec.sh"),
  "utf8",
);
const nvirshExecSource = fs.readFileSync(
  path.join(repoRoot, "tools", "nvirsh", "scripts", "exec.sh"),
  "utf8",
);
const nvirshBuildrootBasedCvmBuildSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "nvirsh-buildroot-based-cvm",
    "scripts",
    "build.sh",
  ),
  "utf8",
);
const nvirshBuildrootBasedCvmExecSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "nvirsh-buildroot-based-cvm",
    "scripts",
    "exec.sh",
  ),
  "utf8",
);
const nvirshBuildrootBasedCvmL1LaunchSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "nvirsh-buildroot-based-cvm",
    "scripts",
    "l1-launch.sh",
  ),
  "utf8",
);
const nvirshStopSource = fs.readFileSync(
  path.join(repoRoot, "tools", "nvirsh", "scripts", "stop.sh"),
  "utf8",
);
const libaflBuildSource = fs.readFileSync(
  path.join(repoRoot, "tools", "libafl", "scripts", "build.sh"),
  "utf8",
);
const libaflBridgePatchSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "libafl",
    "patches",
    "qemu-libafl-bridge",
    "0001-handle-bufferless-zero-writes-in-snapshot-cow.patch",
  ),
  "utf8",
);
const fuzzerSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "libafl",
    "patches",
    "overlay",
    "fuzzers",
    "full_system",
    "qemu_nesting",
    "src",
    "fuzzer_breakpoint.rs",
  ),
  "utf8",
);
const libaflNestingLibSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "libafl",
    "patches",
    "overlay",
    "crates",
    "libafl_nesting",
    "src",
    "lib.rs",
  ),
  "utf8",
);

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

test("nested L2 timeout cleanup cannot serialize the next fuzz input", () => {
  assert.match(stubSource, /POSIX_SPAWN_SETPGROUP/);
  assert.match(stubSource, /posix_spawnattr_setpgroup\(&spawn_attributes, 0\)/);
  assert.match(stubSource, /setpgid\(pid, pid\)/);
  assert.match(stubSource, /signal_l2_process_group\(pid, SIGTERM\)/);
  assert.match(stubSource, /signal_l2_process_group\(pid, SIGKILL\)/);
  assert.match(stubSource, /reap_l2_process\(pid, &status\)/);

  const timeoutBody = stubSource.match(
    /if \(wait_ret == 0\) \{([\s\S]*?)\n  \}\n  if \(wait_ret < 0\)/,
  );
  assert.ok(timeoutBody, "expected the L2 timeout branch");
  assert.match(timeoutBody[1], /l2_guest_crash_logged\(\)/);
  assert.match(timeoutBody[1], /signal_l2_process_group\(pid, SIGTERM\)/);
  assert.match(stubSource, /morpheus\.capture_runtime=1/);
  assert.match(stubSource, /maybe_dump_l2_diagnostics\(\)/);
  assert.match(timeoutBody[1], /log_l2_input_evidence\(\)/);
  assert.match(
    timeoutBody[1],
    /if \(runtime_capture_enabled\(\) && !crash_logged\) \{\s*dump_l2_diagnostics\(\);/,
  );
  assert.match(stubSource, /QEMU_STDOUT_PATH/);
  assert.match(stubSource, /QEMU_STDERR_PATH/);
  assert.match(stubSource, /QEMU_INPUT_STATUS_PATH/);
  assert.doesNotMatch(
    timeoutBody[1],
    /dump_runtime_snapshot\(\)/,
    "normal timeout must not dump every runtime file through hypercalls",
  );
});

test("nested L2 launcher prepares libc state before spawning", () => {
  assert.match(stubSource, /#include <spawn\.h>/);
  assert.match(stubSource, /prepare_l2_launcher\(&shell, &launch_script\)/);
  assert.match(stubSource, /open_launch_log\(LAUNCH_STDOUT_PATH\)/);
  assert.match(stubSource, /build_launch_environment\(overrides, override_count\)/);
  assert.match(
    stubSource,
    /posix_spawn_file_actions_adddup2\(\s*&file_actions, launch_stdout_fd, STDOUT_FILENO\)/,
  );

  const launchStart = stubSource.indexOf("static bool launch_l2(");
  const launchEnd = stubSource.indexOf("\nint main(void)", launchStart);
  assert.ok(launchStart >= 0 && launchEnd > launchStart);
  const launchSource = stubSource.slice(launchStart, launchEnd);
  assert.doesNotMatch(launchSource, /if \(pid == 0\)/);
  assert.doesNotMatch(launchSource, /fork\(\)/);
  assert.doesNotMatch(launchSource, /setenv\(|unsetenv\(/);
  assert.match(launchSource, /posix_spawn\(&pid, shell/);
});

test("nested fuzzing has no synthetic L2 oracle trigger", () => {
  assert.doesNotMatch(stubSource, /MORPHEUS_L2_ENABLE_ORACLE_TEST_BUG/);
  assert.doesNotMatch(stubSource, /oracle test bug/i);
  assert.doesNotMatch(stubSource, /0x5aa5|0xa5U|0x5aU/);
  assert.doesNotMatch(rustStubSource, /MORPHEUS_L2_ENABLE_ORACLE_TEST_BUG/);
  assert.doesNotMatch(generatorSource, /oracle_action|0x5aa5/i);
  assert.doesNotMatch(nvirshBuildSource, /hyperarm_oracle_bug/);
  assert.doesNotMatch(nvirshBuildSource, /MORPHEUS_L2_ENABLE_ORACLE_TEST_BUG/);
});

test("generated CVM hoststack uses QEMU and keeps the runtime shared", () => {
  assert.match(nvirshBuildSource, /phase="\$\{MORPHEUS_NVIRSH_PHASE:-build\}"/);
  assert.match(
    nvirshBuildSource,
    /unsupported nvirsh build phase: \$\{phase\}; use --phase build\|smoke/,
  );
  assert.match(
    nvirshBuildSource,
    /l1_cpus="\$\(morpheus_resolve_l1_qemu_cpus "\$\{l1_cpus:-\}"\)"/,
  );
  assert.match(
    nvirshBuildSource,
    /l1_memory="\$\(morpheus_resolve_l1_qemu_memory_mb "\$\{l1_memory:-\}"\)"/,
  );
  assert.match(nvirshBuildSource, /default_guest_jobs="\$\(morpheus_default_jobs\)"/);
  assert.match(
    nvirshBuildSource,
    /if \[ "\$\{guest_jobs\}" -gt "\$\{default_guest_jobs\}" \]; then\s+guest_jobs="\$\{default_guest_jobs\}"/,
  );
  assert.match(
    nvirshBuildSource,
    /if \[ -n "\$\{l1_cpus:-\}" \] && \[\[ "\$\{l1_cpus\}" =~ \^\[0-9\]\+\$ \]\] &&[\s\S]*\[\s*"\$\{guest_jobs\}" -gt "\$\{l1_cpus\}"\s*\]; then\s+guest_jobs="\$\{l1_cpus\}"/,
  );
  assert.match(
    nvirshBuildSource,
    /if \[ "\$\{l2_cvm\}" = "true" \]; then[\s\S]*l1_memory="\$\(morpheus_default_cvm_l1_qemu_memory_mb\)"[\s\S]*l1_cpus="\$\(morpheus_default_cvm_l1_qemu_cpus\)"/,
  );
  assert.match(
    nvirshExecSource,
    /if \(l2Cvm\) \{[\s\S]*l1Machine = "virt,secure=on,virtualization=on,gic-version=3,iommu=smmuv3";[\s\S]*l1Cpus = "1";[\s\S]*l1Cpu = "max";/,
  );
  assert.match(
    nvirshExecSource,
    /l1_cpus="\$\(morpheus_resolve_l1_qemu_cpus "\$\{l1_cpus:-\}"\)"/,
  );
  assert.match(
    nvirshExecSource,
    /l1_memory="\$\(morpheus_resolve_l1_qemu_memory_mb "\$\{l1_memory:-\}"\)"/,
  );
  assert.match(
    nvirshExecSource,
    /if \[ "\$\{l2_cvm\}" != "true" \]; then[\s\S]*l1_cpus="\$\(morpheus_resolve_l1_qemu_cpus "\$\{l1_cpus:-\}"\)"/,
  );
  assert.match(
    nvirshExecSource,
    /if \[ "\$\{l2_cvm\}" != "true" \]; then[\s\S]*l1_memory="\$\(morpheus_resolve_l1_qemu_memory_mb "\$\{l1_memory:-\}"\)"/,
  );
  assert.match(
    nvirshExecSource,
    /else[\s\S]*l1_cpus="\$\(morpheus_default_cvm_l1_qemu_cpus\)"[\s\S]*l1_memory="\$\(morpheus_default_cvm_l1_qemu_memory_mb\)"/,
  );
  assert.match(
    harnessSource,
    /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/\.\.\/_shared\/scripts\/parallelism\.sh"/,
  );
  assert.match(
    harnessSource,
    /libafl_l1_smp="\$\(morpheus_resolve_l1_qemu_cpus "\$\{libafl_l1_smp_requested\}"\)"/,
  );
  assert.match(
    harnessSource,
    /l1_memory="\$\(morpheus_resolve_l1_qemu_memory_mb "\$\{l1_memory_requested\}"\)"/,
  );
  assert.match(
    harnessSource,
    /l1_memory_cvm="\$\{l1_memory\}"/,
  );
  assert.match(
    harnessSource,
    /l1_smp_cvm="\$\{libafl_l1_smp\}"/,
  );
  assert.match(
    nvirshBuildrootBasedCvmBuildSource,
    /l1_cpus="\$\(morpheus_default_cvm_l1_qemu_cpus\)"/,
  );
  assert.match(
    nvirshBuildrootBasedCvmBuildSource,
    /l1_memory="\$\(morpheus_default_cvm_l1_qemu_memory_mb\)"/,
  );
  assert.match(
    nvirshBuildrootBasedCvmL1LaunchSource,
    /l1_cpus="\$\(morpheus_default_cvm_l1_qemu_cpus\)"/,
  );
  assert.match(
    nvirshBuildrootBasedCvmL1LaunchSource,
    /l1_memory="\$\(morpheus_default_cvm_l1_qemu_memory_mb\)"/,
  );
  assert.match(
    nvirshBuildrootBasedCvmExecSource,
    /bash "\$\{script_dir\}\/l1-launch\.sh"/,
  );
  assert.match(nvirshBuildSource, /normalize_cvm_qemu_cpu\(\)/);
  assert.match(nvirshBuildSource, /l2_launch_mode="cvm-kvm"/);
  assert.match(nvirshBuildSource, /MORPHEUS_L2_GUEST_IMAGE_DIR/);
  assert.match(nvirshBuildSource, /launch_guest_image_dir="\$\{guest_image_dir\}"/);
  assert.match(
    nvirshBuildSource,
    /if \[ "\$\{l2_cvm\}" = "true" \]; then[\s\S]*launch_guest_image_dir="\/host\/guest-images"/,
  );
  assert.match(
    nvirshBuildSource,
    /l2_cpu_effective="host"[\s\S]*effective-cpu=%s/,
  );
  assert.match(nvirshBuildSource, /host stack launch files staged on host share/);
  assert.match(nvirshBuildSource, /hoststack_launch_script="\$\{build_l1_dir\}\/launch-l2-hoststack\.sh"/);
  assert.match(nvirshBuildSource, /runtime_guest_images_dir="\$\{build_l1_dir\}\/guest-images"/);
  assert.match(
    nvirshBuildSource,
    /if \[ -f "\$\{stack_dir\}\/out\/Image" \]; then[\s\S]*elif \[ -f "\$\{stack_dir\}\/out\/Image\.gz" \]; then/,
  );
  const qemuSyncStart = nvirshBuildSource.indexOf("copy_qemu_source_to_guest() {");
  const qemuSyncEnd = nvirshBuildSource.indexOf(
    '\nif [ "${l2_cvm}" = "true" ]; then',
    qemuSyncStart,
  );
  assert.ok(qemuSyncStart >= 0 && qemuSyncEnd > qemuSyncStart);
  const qemuSyncBody = nvirshBuildSource.slice(qemuSyncStart, qemuSyncEnd);
  assert.match(qemuSyncBody, /scp/);
  assert.doesNotMatch(qemuSyncBody, /copy_to_guest/);
  assert.match(
    nvirshBuildSource,
    /copy_to_guest "\$\{build_l0_dir\}\/id_ed25519" "\$\{l1_ssh_port\}" "\$\{build_l1_dir\}\/launch-l2-hoststack\.sh" "\/root\/launch-l2-hoststack\.sh"/,
  );
  assert.doesNotMatch(nvirshBuildSource, /copy_to_guest .*\/host\/guest-images/);
  assert.match(nvirshBuildSource, /qemu\.stdout\.log/);
  assert.match(nvirshBuildSource, /qemu\.stderr\.log/);
  assert.match(nvirshBuildSource, /--disable-virtfs/);
  assert.doesNotMatch(
    nvirshBuildSource,
    /-virtfs "local,path=\/host,mount_tag=host,security_model=mapped,readonly=off"/,
  );
  assert.match(nvirshBuildSource, /-nodefaults/);
  assert.match(nvirshBuildSource, /-chardev stdio,mux=on,id=chr0,signal=off/);
  assert.match(nvirshBuildSource, /-device virtio-serial-pci/);
  assert.match(nvirshBuildSource, /-device virtconsole,chardev=chr0/);
  assert.match(nvirshBuildSource, /-device virtio-net-pci,netdev=net0,romfile=''/);
  assert.doesNotMatch(nvirshBuildSource, /pvpanic-pci/);
  assert.match(nvirshBuildSource, /qemu-input\.status/);
  assert.match(nvirshBuildSource, /guest-image-dir=%s/);
  assert.match(nvirshBuildSource, /exec >>"\\\$\{runtime_dir\}\/qemu\.stdout\.log"/);
  assert.match(
    nvirshBuildSource,
    /exec >>"\\\$\{runtime_dir\}\/qemu\.stdout\.log" 2>>"\\\$\{runtime_dir\}\/qemu\.stderr\.log" \/host\/launch-l2\.sh/,
  );
  assert.match(nvirshBuildSource, /qemu-system-aarch64/);
  assert.match(nvirshBuildSource, /\/host\/guest-qemu\/bin\/qemu-system-aarch64/);
  assert.match(nvirshBuildSource, /\/host\/guest-qemu\/runtime-libs/);
  assert.match(nvirshBuildSource, /guest_qemu_runtime_loader/);
  assert.match(nvirshBuildSource, /--library-path/);
  assert.match(
    nvirshBuildSource,
    /-object rme-guest,id=rme0,measurement-algorithm=sha512/,
  );
  assert.match(nvirshBuildSource, /l2-cvm requires \/dev\/kvm inside l1/);
  assert.match(nvirshBuildSource, /-enable-kvm/);
  assert.match(nvirshBuildSource, /-cpu "\$\{l2_cpu_effective\}"/);
  assert.doesNotMatch(nvirshBuildSource, /lkvm/);
  assert.equal(
    nvirshProfile.l1.ccaHostStack.archiveUrl,
    "https://github.com/p-b-o/qemu-linux-stack/releases/download/build/master-11247fd.tar.xz",
  );
  assert.equal(
    nvirshProfile.l1.ccaHostStack.archiveSha256,
    "0d9cc57c109bcdc42294a41334e2909fa51c42784160fb5a7396dfce49c90d07",
  );
  assert.match(
    nvirshBuildSource,
    /if \[ "\$\{phase\}" = "smoke" \]; then[\s\S]*currentPhase: "smoke"[\s\S]*smoke: "success"[\s\S]*build: "pending"[\s\S]*launch: "pending"/,
  );
  assert.match(
    nvirshBuildSource,
    /if \[ "\$\{phase\}" = "smoke" \]; then[\s\S]*staged smoke-phase host artifacts/,
  );
});

test("parallelism helpers expose a dedicated L1 QEMU CPU default", () => {
  const parallelismSource = fs.readFileSync(
    path.join(repoRoot, "tools", "_shared", "scripts", "parallelism.sh"),
    "utf8",
  );
  assert.match(parallelismSource, /morpheus_default_l1_qemu_cpus\(\)/);
  assert.match(parallelismSource, /morpheus_default_l1_qemu_cpus\(\) \{\s+morpheus_default_jobs\s*\n\}/);
  assert.match(parallelismSource, /morpheus_default_l1_qemu_memory_mb\(\)/);
  assert.match(parallelismSource, /memory_mb="\$\(\( cpus \* 1024 \)\)"/);
});

test("prepared L1 snapshot reuse tracks guest stub and buildroot inputs", () => {
  assert.match(
    nvirshBuildSource,
    /state_matches_l1_provision\(\)[\s\S]*recordedStub === \(guestStub \|\| ""\)/,
  );
  assert.match(
    nvirshBuildSource,
    /state_matches_l1_provision\(\)[\s\S]*recordedStubSha256 === currentStubSha256/,
  );
  assert.match(
    nvirshBuildSource,
    /state_matches_l1_provision\(\)[\s\S]*recordedGuestQemuSourceSha256 === currentGuestQemuSourceSha256/,
  );
  assert.doesNotMatch(
    nvirshBuildSource,
    /state_matches_l1_provision\(\)[\s\S]*recordedScriptSha256 === currentScriptSha256/,
  );
  assert.match(
    nvirshBuildSource,
    /state_matches_l1_provision\(\)[\s\S]*buildrootImagesMatch/,
  );
  assert.match(nvirshBuildSource, /buildInputsFingerprint/);
  assert.match(nvirshBuildSource, /recordedBuildrootInputsFingerprint/);
  assert.match(nvirshBuildSource, /reuse_prepared_build="false"/);
  assert.match(nvirshBuildSource, /refresh_reused_state\(\)/);
  assert.match(
    nvirshBuildSource,
    /if \[ "\$\{reuse_build_dir\}" = "true" \] && \[ -f "\$\{state_file\}" \]; then[\s\S]*refresh_reused_state[\s\S]*reused prepared build tree/,
  );
  assert.match(
    nvirshBuildSource,
    /if \[ "\$\{reuse_prepared_build\}" = "true" \]; then[\s\S]*reused existing prepared build tree/,
  );
  assert.match(nvirshBuildSource, /build_l1_previous_dir="\$\{build_dir\}\/l1\.previous"/);
  assert.match(nvirshBuildSource, /restore_previous_l1_dir_on_exit="false"/);
  assert.match(
    nvirshBuildSource,
    /if \[ -d "\$\{build_l1_dir\}" \]; then\s+mv "\$\{build_l1_dir\}" "\$\{build_l1_previous_dir\}"/,
  );
  assert.match(nvirshBuildSource, /restore_previous_l1_dir\(\)/);
  assert.match(nvirshBuildSource, /discard_previous_l1_dir\(\)/);
  assert.match(
    nvirshBuildSource,
    /state_matches_l1_provision "\$\{state_file\}"; then\s+preserve_l0="true"\s+reuse_provisioned_l1="true"/,
  );
  assert.match(
    nvirshBuildSource,
    /reuse_provisioned_l1="true"[\s\S]*if \[ -x "\$\{build_l1_dir\}\/launch-l2\.sh" \]/,
  );
});

test("LibAFL input is handed from the CVM hoststack to QEMU", () => {
  assert.match(
    nvirshBuildSource,
    /MORPHEUS_L2_GUEST_IMAGE_DIR:-\/host\/guest-images/,
  );
  assert.match(
    nvirshBuildSource,
    /guest_image_dir="\\\$\{MORPHEUS_L2_GUEST_IMAGE_DIR:-\$\{launch_guest_image_dir\}\}"/,
  );
  assert.match(
    nvirshBuildSource,
    /-kernel "\\\$\{guest_image_dir\}\/Image"[\s\S]*-initrd "\\\$\{guest_image_dir\}\/rootfs\.cpio\.gz"/,
  );
  assert.match(nvirshBuildSource, /MORPHEUS_QEMU_INPUT_PATH/);
  assert.match(nvirshBuildSource, /MORPHEUS_QEMU_INPUT_STATUS_PATH/);
  assert.match(nvirshBuildSource, /input-status-path=/);
  assert.match(nvirshBuildSource, /input-path=%s/);
  assert.match(nvirshBuildSource, /qemu\.stdout\.log/);
  assert.match(nvirshBuildSource, /qemu\.stderr\.log/);
  assert.doesNotMatch(nvirshBuildSource, /lkvm/);
  assert.doesNotMatch(nvirshBuildSource, /kvmtool-virtio-mmio-input/);
});

test("LibAFL CVM harness supports buildroot-based prepared state", () => {
  assert.match(harnessSource, /const tool = String\(state\.tool \|\| ""\)/);
  assert.match(
    harnessSource,
    /const hoststackRootfs = l1State\.rootfs\s+\|\| hostStack\.rootfs/,
  );
  assert.match(
    harnessSource,
    /const hoststackShareDir = l1State\.shareDir\s+\|\| l1State\.runtimeShareDir/,
  );
  assert.match(
    harnessSource,
    /const hostKernel = String\(host\.kernel \|\| ""\)/,
  );
  assert.match(
    harnessSource,
    /stage_buildroot_cvm_share\(\) \{/,
  );
  assert.match(
    harnessSource,
    /cp -f "\$\{stub_elf\}" "\$\{staging_dir\}\/libafl_nesting_stub"/,
  );
  assert.match(
    harnessSource,
    /cp -a "\$\{source_share\}\/guest-images" "\$\{staging_dir\}\/"/,
  );
  assert.match(
    harnessSource,
    /cp -a "\$\{source_share\}\/guest-qemu" "\$\{staging_dir\}\/"/,
  );
  assert.match(
    harnessSource,
    /direct_l1_stub_env="MORPHEUS_L2_MODE=\$\{l2_mode\}"/,
  );
  assert.match(harnessSource, /--fuzz-virtio-ids\)/);
  assert.match(
    harnessSource,
    /MORPHEUS_QEMU_FUZZ_VIRTIO_IDS=\$\{fuzz_virtio_ids\}/,
  );
  assert.match(
    harnessSource,
    /direct_l1_stub_launch_cmd="mkdir -p \/mnt && mount -t ext4 -o ro \/dev\/vdb \/mnt && \$\{direct_l1_stub_env\} exec \$\{direct_l1_share_stub_path\}"/,
  );
  assert.match(
    harnessSource,
    /direct_l1_share_stub_path="\/mnt\/libafl_nesting_stub"/,
  );
  assert.match(
    harnessSource,
    /direct_l1_share_prefix="\$\{direct_l1_append%% init=\/root\/libafl_nesting_stub \*\}"/,
  );
  assert.match(
    harnessSource,
    /direct_l1_share_suffix="\$\{direct_l1_append#\* init=\/root\/libafl_nesting_stub \}"/,
  );
  assert.match(
    harnessSource,
    /direct_l1_share_append="\$\{direct_l1_share_prefix\} init=\/bin\/sh -- -c \\\"\$\{direct_l1_stub_launch_cmd\}\\\" \$\{direct_l1_share_suffix\}"/,
  );
  assert.doesNotMatch(
    harnessSource,
    /direct_l1_share_append="\$\{direct_l1_append\//,
    "CVM boot command must not use Bash replacement with an && payload",
  );
  assert.match(
    harnessSource,
    /create_l1_uefi_boot_image\(\) \{/,
  );
  assert.match(
    harnessSource,
    /l1_boot_image="\$\{run_dir\}\/l1-boot-fat\.img"/,
  );
  assert.match(
    harnessSource,
    /l1_boot_startup="\$\{run_dir\}\/l1-boot-fat-startup\.nsh"/,
  );
  assert.match(
    harnessSource,
    /if \[ "\$\{nvirsh_state_tool\}" = "nvirsh-buildroot-based-cvm" \]; then/,
  );
  assert.match(
    harnessSource,
    /create_l1_uefi_boot_image "\$\{l1_boot_image\}" "\$\{direct_l1_kernel\}" "\$\{l1_boot_startup\}"/,
  );
  assert.match(harnessSource, /partitionStartSectors = 63/);
  assert.match(harnessSource, /mbr\.writeUInt32LE\(partitionStartSectors/);
  assert.match(harnessSource, /volumeStart = partitionStartSectors \* bytesPerSector/);
  assert.match(
    harnessSource,
    /-drive" "format=raw,id=hd0,if=none,file=\$\{l1_hoststack_rootfs\},snapshot=on"/,
  );
  assert.match(
    harnessSource,
    /-drive" "format=raw,id=share,if=none,file=\$\{l1_share_image\},snapshot=on"/,
  );
  assert.match(
    harnessSource,
    /-drive" "file=\$\{l1_boot_image\},format=raw,snapshot=on"/,
  );
  assert.doesNotMatch(harnessSource, /virtio-blk-pci,drive=bootfat/);
  assert.match(
    harnessSource,
    /file=\$\{firmware\},format=raw,if=pflash,snapshot=on/,
  );
  assert.match(
    harnessSource,
    /file=\$\{firmware_b\},format=raw,if=pflash,snapshot=on/,
  );
  const buildrootCvmStart = harnessSource.indexOf(
    'if [ "${nvirsh_state_tool}" = "nvirsh-buildroot-based-cvm" ]; then',
  );
  const buildrootCvmEnd = harnessSource.indexOf(
    '\n  else\n    if [ ! -f "${direct_l1_kernel}" ]',
    buildrootCvmStart,
  );
  assert.ok(buildrootCvmStart >= 0 && buildrootCvmEnd > buildrootCvmStart);
  const buildrootCvmSource = harnessSource.slice(buildrootCvmStart, buildrootCvmEnd);
  assert.match(buildrootCvmSource, /"-L" "\$\{qemu_data_dir\}"/);
  assert.match(buildrootCvmSource, /stage_buildroot_cvm_share/);
  assert.doesNotMatch(buildrootCvmSource, /virtio-9p/);
  assert.doesNotMatch(buildrootCvmSource, /-fsdev/);
  assert.doesNotMatch(
    harnessSource,
    /file=fat:rw:\$\{l1_boot_dir\},format=raw/,
  );
});

test("LibAFL bridge keeps the 9p transport enabled across cached builds", () => {
  const dependencySource = fs.readFileSync(
    path.join(repoRoot, "tools", "libafl", "scripts", "install-dependencies.sh"),
    "utf8",
  );
  assert.match(libaflBuildSource, /--enable-attr/);
  assert.match(libaflBuildSource, /--enable-virtfs/);
  assert.match(libaflBuildSource, /bridge_config_fingerprint_file/);
  assert.match(libaflBuildSource, /bridge_current\(\)/);
  assert.match(libaflBuildSource, /install_bridge\(\)/);
  assert.match(libaflBuildSource, /bridge_patch_file=/);
  assert.match(libaflBuildSource, /prepare_bridge_source\(\)/);
  assert.match(libaflBuildSource, /LIBAFL_QEMU_DIR="\$\{bridge_storage_dir\}"/);
  assert.doesNotMatch(libaflBuildSource, /LIBAFL_QEMU_CLONE_DIR=/);
  assert.match(
    libaflBuildSource,
    /QEMU bridge transport: virtfs\/9p enabled/,
  );
  assert.match(libaflBridgePatchSource, /BDRV_REQ_ZERO_WRITE/);
  assert.match(libaflBridgePatchSource, /if \(!qiov\)/);
  assert.match(libaflBridgePatchSource, /write_zeroes_to_cache_layer/);
  assert.match(libaflBridgePatchSource, /new_chunks/);
  const cacheInvalidateStart = libaflBridgePatchSource.indexOf(
    "diff --git a/system/physmem.c",
  );
  const cacheInvalidateEnd = libaflBridgePatchSource.indexOf(
    "diff --git ",
    cacheInvalidateStart + 1,
  );
  assert.ok(cacheInvalidateStart >= 0 && cacheInvalidateEnd > cacheInvalidateStart);
  const cacheInvalidateSource = libaflBridgePatchSource.slice(
    cacheInvalidateStart,
    cacheInvalidateEnd,
  );
  assert.match(
    cacheInvalidateSource,
    /\+\s+syx_snapshot_dirty_list_add_hostaddr_range\(cache->ptr \+ addr,\s+\+\s+access_len\);/,
    "DMA cache writes must enter LibAFL snapshot dirty tracking",
  );
  const rootRestoreStart = libaflBridgePatchSource.indexOf(
    "void syx_snapshot_root_restore",
  );
  const rootRestoreEnd = libaflBridgePatchSource.indexOf(
    "@@ -768,19",
    rootRestoreStart,
  );
  assert.ok(rootRestoreStart >= 0 && rootRestoreEnd > rootRestoreStart);
  const rootRestoreSource = libaflBridgePatchSource.slice(
    rootRestoreStart,
    rootRestoreEnd,
  );
  assert.ok(
    rootRestoreSource.indexOf("+    g_hash_table_foreach") <
      rootRestoreSource.indexOf("+    device_restore_all"),
    "snapshot RAM must be restored before device state",
  );
  assert.match(
    libaflBridgePatchSource,
    /restore_to_increment\(snapshot, last_increment\);\n\+\s+device_restore_all\(last_increment->dss\);/,
  );
  assert.match(dependencySource, /libattr1-dev/);
});

test("LibAFL systemmode nesting uses the COW snapshot manager", () => {
  assert.match(fuzzerSource, /FastSnapshotManager/);
  assert.match(
    fuzzerSource,
    /\.snapshot_manager\(FastSnapshotManager::default\(\)\)/,
  );
  assert.doesNotMatch(
    fuzzerSource,
    /QemuSnapshotManager/,
    "migration snapshots do not initialize the LibAFL block COW layer",
  );
});

test("buildroot CVM launch preserves the handoff and requested L1 memory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-libafl-exec-"));
  const runDir = path.join(tmpDir, "run");
  const installDir = path.join(tmpDir, "libafl-install");
  const nvirshInstallDir = path.join(tmpDir, "nvirsh-install");
  const nvirshBuildDir = path.join(tmpDir, "nvirsh-build");
  const sourceDir = path.join(tmpDir, "libafl-source");
  const workspaceDir = path.join(tmpDir, "workspace");
  const shareDir = path.join(nvirshBuildDir, "l1");
  const qemuDataDir = path.join(
    tmpDir,
    "build",
    "qemu-libafl-bridge",
    "build",
    "qemu-bundle",
    "usr",
    "local",
    "share",
    "qemu",
  );
  const captureFile = path.join(tmpDir, "qemu-args.txt");
  const qemuImgArgsFile = path.join(tmpDir, "qemu-img-args.txt");
  const mkfsExt4ArgsFile = path.join(tmpDir, "mkfs-ext4-args.txt");
  const resultFile = path.join(tmpDir, "result.json");
  const stateFile = path.join(nvirshInstallDir, "state.json");
  const firmwareA = path.join(tmpDir, "firmware-a.fd");
  const firmwareB = path.join(tmpDir, "firmware-b.fd");
  const l1Kernel = path.join(nvirshBuildDir, "l1", "host-boot", "Image");
  const l1Rootfs = path.join(nvirshBuildDir, "l1", "host-rootfs", "rootfs.ext2");
  const fakeFuzzer = path.join(installDir, "bin", "qemu_nesting");
  const fakeStub = path.join(installDir, "bin", "libafl_nesting_stub");
  const fakeQemuImg = path.join(tmpDir, "bin", "qemu-img");
  const fakeMkfsExt4 = path.join(tmpDir, "bin", "mkfs.ext4");
  const harnessScript = path.join(repoRoot, "tools", "libafl", "scripts", "exec.sh");

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(path.dirname(fakeStub), { recursive: true });
  fs.mkdirSync(nvirshInstallDir, { recursive: true });
  fs.mkdirSync(qemuDataDir, { recursive: true });
  fs.mkdirSync(path.dirname(l1Kernel), { recursive: true });
  fs.mkdirSync(path.dirname(l1Rootfs), { recursive: true });
  fs.mkdirSync(path.dirname(firmwareA), { recursive: true });
  fs.mkdirSync(shareDir, { recursive: true });
  fs.writeFileSync(path.join(qemuDataDir, "efi-virtio.rom"), "synthetic-rom\n");
  fs.writeFileSync(l1Kernel, "synthetic-kernel\n");
  fs.writeFileSync(l1Rootfs, "synthetic-rootfs\n");
  fs.writeFileSync(firmwareA, "synthetic-firmware-a\n");
  fs.writeFileSync(firmwareB, "synthetic-firmware-b\n");
  fs.writeFileSync(fakeStub, "synthetic-stub\n");
  writeExecutable(
    path.join(shareDir, "launch-l2-hoststack.sh"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(shareDir, "launch-l2.sh"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.mkdirSync(path.join(shareDir, "guest-images"), { recursive: true });
  fs.mkdirSync(path.join(shareDir, "guest-qemu"), { recursive: true });
  fs.writeFileSync(
    path.join(shareDir, "guest-images", "Image"),
    "synthetic-guest-image\n",
  );
  fs.writeFileSync(
    path.join(shareDir, "guest-qemu", "qemu-system-aarch64"),
    "synthetic-guest-qemu\n",
  );
  writeExecutable(
    fakeQemuImg,
    "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MORPHEUS_QEMU_IMG_ARGS\"\ntruncate -s \"$5\" \"$4\"\n",
  );
  writeExecutable(
    fakeMkfsExt4,
    "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MORPHEUS_MKFS_EXT4_ARGS\"\nlast=\"\"\nfor arg in \"$@\"; do last=\"$arg\"; done\n: > \"$last\"\n",
  );
  writeExecutable(
    fakeFuzzer,
    "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MORPHEUS_TEST_CAPTURE\"\n",
  );

  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      schemaVersion: 1,
      tool: "nvirsh-buildroot-based-cvm",
      status: "stopped",
      currentPhase: "stopped",
      buildDir: nvirshBuildDir,
      hostLaunch: {
        firmwareA,
        firmwareB,
        kernel: l1Kernel,
        machine: "sbsa-ref",
        cpu: "max,x-rme=on,sme=off,pauth-impdef=on,sve=off",
        cmdline: "root=/dev/vda console=ttyAMA0",
        memory: "4096",
        cpus: "8",
        accel: "",
        enableKvm: false,
      },
      layeredState: {
        l1: {
          rootfs: l1Rootfs,
          shareDir,
          launchScriptHoststack: path.join(shareDir, "launch-l2-hoststack.sh"),
        },
        l2: { mode: "cvm" },
      },
    }, null, 2),
  );

  const run = spawnSync(
    "bash",
    [
      harnessScript,
      "--nvirsh-state",
      stateFile,
      "--l2-mode",
      "cvm",
      "--l2-accel",
      "kvm",
      "--l2-cpu",
      "host",
      "--l2-run-window-ms",
      "1000",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        MORPHEUS_LIBAFL_SOURCE: sourceDir,
        MORPHEUS_LIBAFL_RUN_DIR: runDir,
        MORPHEUS_LIBAFL_INSTALL_DIR: installDir,
        MORPHEUS_LIBAFL_WORKSPACE: workspaceDir,
        MORPHEUS_LIBAFL_RESULT_FILE: resultFile,
        MORPHEUS_LIBAFL_RUN_SECONDS: "0",
        MORPHEUS_NVIRSH_INSTALL_DIR: nvirshInstallDir,
        MORPHEUS_TEST_CAPTURE: captureFile,
        MORPHEUS_QEMU_IMG_BIN: fakeQemuImg,
        MORPHEUS_MKFS_EXT4_BIN: fakeMkfsExt4,
        MORPHEUS_QEMU_IMG_ARGS: qemuImgArgsFile,
        MORPHEUS_MKFS_EXT4_ARGS: mkfsExt4ArgsFile,
        MORPHEUS_REPO_ROOT: repoRoot,
      },
    },
  );
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);

  const stagingDir = path.join(runDir, "l1-share-staging");
  const shareImage = path.join(runDir, "l1-share.ext4");
  assert.ok(fs.statSync(stagingDir).isDirectory());
  assert.ok(fs.statSync(shareImage).isFile());
  for (const relativePath of [
    "libafl_nesting_stub",
    "launch-l2-hoststack.sh",
    "launch-l2.sh",
    "launch-l2-inner.sh",
    "guest-images/Image",
    "guest-qemu/qemu-system-aarch64",
  ]) {
    assert.ok(
      fs.statSync(path.join(stagingDir, relativePath)).isFile(),
      `staged share is missing ${relativePath}`,
    );
  }
  assert.equal(
    fs.readFileSync(path.join(stagingDir, "libafl_nesting_stub"), "utf8"),
    "synthetic-stub\n",
  );
  assert.equal(fs.readFileSync(fakeStub, "utf8"), "synthetic-stub\n");
  assert.equal(
    fs.readFileSync(path.join(shareDir, "launch-l2.sh"), "utf8"),
    "#!/bin/sh\nexit 0\n",
  );

  const qemuImgArgs = fs.readFileSync(qemuImgArgsFile, "utf8").trimEnd().split("\n");
  assert.deepEqual(qemuImgArgs.slice(0, 3), ["create", "-f", "raw"]);
  assert.equal(path.normalize(qemuImgArgs[3]), path.normalize(shareImage));
  assert.match(qemuImgArgs[4], /^[0-9]+M$/);
  const mkfsExt4Args = fs.readFileSync(mkfsExt4ArgsFile, "utf8").trimEnd().split("\n");
  assert.deepEqual(mkfsExt4Args, ["-m", "0", "-d", stagingDir, shareImage]);

  const qemuArgs = fs.readFileSync(captureFile, "utf8").trimEnd().split("\n");
  const memoryIndex = qemuArgs.indexOf("-m");
  assert.ok(memoryIndex >= 0, "L1 QEMU args must include memory");
  assert.equal(qemuArgs[memoryIndex + 1], "4096");
  const searchPathIndex = qemuArgs.indexOf("-L");
  assert.ok(searchPathIndex >= 0, "buildroot CVM QEMU args must include -L");
  assert.equal(
    path.normalize(qemuArgs[searchPathIndex + 1]),
    path.normalize(qemuDataDir),
  );
  assert.equal(
    qemuArgs.includes("-fw_cfg"),
    false,
    "sbsa-ref does not provide a fw_cfg device",
  );
  assert.ok(qemuArgs.includes("-smbios"), "L1 controls retain SMBIOS fallback");

  const startup = fs.readFileSync(
    path.join(runDir, "l1-boot-fat-startup.nsh"),
    "utf8",
  );
  assert.match(startup, /^fs0:\\Image /m);
  assert.match(
    startup,
    /init=\/bin\/sh -- -c "mkdir -p \/mnt && mount [^\n]* && MORPHEUS_L2_MODE=cvm(?: MORPHEUS_L2_RUN_WINDOW_MS=1000)? exec \/mnt\/libafl_nesting_stub"/,
  );
  assert.match(startup, /MORPHEUS_L2_MODE=cvm/);
  assert.match(startup, /MORPHEUS_L2_RUN_WINDOW_MS=1000/);
  assert.doesNotMatch(startup, /init=\/root\/libafl_nesting_stub/);
  assert.equal((startup.match(/init=/g) || []).length, 1);

  const bootImage = fs.readFileSync(path.join(runDir, "l1-boot-fat.img"));
  const partitionEntry = 446;
  const partitionStart = bootImage.readUInt32LE(partitionEntry + 8);
  const partitionLength = bootImage.readUInt32LE(partitionEntry + 12);
  assert.equal(bootImage[partitionEntry + 4], 0x06);
  assert.equal(partitionStart, 63);
  assert.equal(
    partitionLength,
    Math.floor(bootImage.length / 512) - partitionStart,
  );
  const volumeOffset = partitionStart * 512;
  assert.equal(bootImage[volumeOffset + 510], 0x55);
  assert.equal(bootImage[volumeOffset + 511], 0xaa);
});

test("CVM stub prefers the mounted /mnt hoststack and falls back to /host", () => {
  assert.match(stubSource, /#define HOST_SHARE_DIR "\/mnt"/);
  assert.match(stubSource, /#define HOST_SHARE_FALLBACK_DIR "\/host"/);
  assert.match(stubSource, /HOSTSTACK_LAUNCH_PATH/);
  assert.match(stubSource, /HOSTSTACK_FALLBACK_LAUNCH_PATH/);
  assert.match(stubSource, /HOSTSTACK_LOCAL_LAUNCH_PATH/);
  assert.ok(stubSource.includes("if (!mount_host_share_if_needed()) {"));
  assert.ok(
    stubSource.includes(
      String.raw`append_marker("mount-host-share=failed\n");`,
    ),
  );
  assert.match(
    stubSource,
    /selected_hoststack_launch_path = launch_paths\[i\];/,
  );
  assert.match(
    stubSource,
    /launch_script = selected_hoststack_launch_path;\s*append_marker\("hoststack-launch=%s\\n", launch_script\);/,
  );
  const bashShellCheck = stubSource.indexOf(
    'if (path_executable("/bin/bash"))',
  );
  const shShellCheck = stubSource.indexOf(
    'if (path_executable("/bin/sh"))',
  );
  assert.ok(bashShellCheck >= 0, "stub keeps bash as the primary launcher shell");
  assert.ok(shShellCheck > bashShellCheck, "stub uses sh only as a fallback");
  assert.match(stubSource, /posix_spawn\(&pid, shell, &file_actions, &spawn_attributes/);
  assert.doesNotMatch(
    stubSource,
    /path_executable\(HOSTSTACK_LOCAL_LAUNCH_PATH\)/,
  );
});

test("nvirsh detached launch hands off pid management to stop", () => {
  assert.match(nvirshExecSource, /preserve_qemu_pid_file="true"/);
  assert.match(nvirshExecSource, /wait_for_cvm_l2_ready\(\)/);
  assert.match(nvirshExecSource, /grep -a -q -- 'qemu-exit-status=' "\$\{l2_launch_marker_log\}"/);
  assert.match(nvirshExecSource, /summarize_l2_failure\(\)/);
  assert.match(
    nvirshExecSource,
    /write_manifest "error" "\$\{launch_status\}" "\$\(summarize_l2_failure "launch-l2-hoststack\.sh failed"\)"/,
  );
  assert.match(nvirshStopSource, /build_dir="\$\{manifest_fields\[1\]:-\}"/);
  assert.match(nvirshStopSource, /l0\/l1\.pid/);
});

test("nested fuzz loop avoids a duplicate L2 shadow execution", () => {
  assert.doesNotMatch(fuzzerSource, /ShadowTracingStage/);
  assert.doesNotMatch(fuzzerSource, /CmpLogObserver/);
  assert.match(fuzzerSource, /StdMutationalStage::new\(\s*ScenarioMutator/);
});

test("full runtime capture is opt-in for the fuzzing harness", () => {
  assert.match(harnessSource, /--capture-runtime\)/);
  assert.match(harnessSource, /morpheus\.capture_runtime=1/);
  assert.match(
    harnessSource,
    /direct_l1_stub_env="\$\{direct_l1_stub_env\} MORPHEUS_CAPTURE_RUNTIME=1"/,
  );
  assert.match(stubSource, /MORPHEUS_L2_MODE/);
  assert.match(stubSource, /env_l2_mode\(/);
  assert.match(stubSource, /MORPHEUS_L2_RUN_WINDOW_MS/);
  assert.match(stubSource, /MORPHEUS_CAPTURE_RUNTIME/);
  assert.match(stubSource, /MORPHEUS_QEMU_FUZZ_VIRTIO_IDS/);
  assert.match(rustStubSource, /MORPHEUS_QEMU_FUZZ_VIRTIO_IDS/);
  assert.match(stubSource, /qemu\.stdout\.log/);
});

test("LibAFL CVM snapshot devices use single virtio-blk queues", () => {
  assert.match(
    harnessSource,
    /virtio-blk-pci,drive=hd0,num-queues=1/,
  );
  assert.match(
    harnessSource,
    /virtio-blk-pci,drive=share,num-queues=1/,
  );
});

test("LibAFL nesting crate keeps the module doc comment before Rust items", () => {
  assert.match(
    libaflNestingLibSource,
    /^\/\/! Structured nested fuzzing support for `LibAFL`\.\n\nextern crate alloc;/,
  );
});

test("LibAFL build installs the C guest stub used by nesting fuzzing", () => {
  assert.match(
    libaflBuildSource,
    /stub_c_src="\$\{source_dir\}\/crates\/libafl_nesting\/c_src\/libafl_nesting_stub\.c"/,
  );
  assert.match(libaflBuildSource, /build_guest_stub\(\)/);
  assert.match(libaflBuildSource, /aarch64-linux-gnu-gcc/);
  assert.match(libaflBuildSource, /"\$\{stub_c_src\}"/);
});
