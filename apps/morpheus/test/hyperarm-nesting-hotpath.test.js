const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
const nvirshStopSource = fs.readFileSync(
  path.join(repoRoot, "tools", "nvirsh", "scripts", "stop.sh"),
  "utf8",
);
const libaflBuildSource = fs.readFileSync(
  path.join(repoRoot, "tools", "libafl", "scripts", "build.sh"),
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

test("nested L2 timeout cleanup cannot serialize the next fuzz input", () => {
  assert.match(stubSource, /setpgid\(0, 0\)/);
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
    nvirshBuildrootBasedCvmExecSource,
    /l1_cpus="\$\(morpheus_default_cvm_l1_qemu_cpus\)"/,
  );
  assert.match(
    nvirshBuildrootBasedCvmExecSource,
    /l1_memory="\$\(morpheus_default_cvm_l1_qemu_memory_mb\)"/,
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

test("CVM stub prefers the shared hoststack launcher and mounts /host if needed", () => {
  assert.match(stubSource, /HOSTSTACK_LAUNCH_PATH/);
  assert.match(stubSource, /HOSTSTACK_LOCAL_LAUNCH_PATH/);
  assert.match(
    stubSource,
    /if \(!mount_host_share_if_needed\(\)\) \{\s*append_marker\("mount-host-share=failed\\n"\);/,
  );
  assert.match(
    stubSource,
    /launch_script = HOSTSTACK_LAUNCH_PATH;\s*argv\[1\] = \(char \*\)launch_script;/,
  );
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
  assert.match(stubSource, /qemu\.stdout\.log/);
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
