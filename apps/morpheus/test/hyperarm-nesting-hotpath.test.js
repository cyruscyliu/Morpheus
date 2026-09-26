const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const workspaceRoot = path.resolve(repoRoot, "..");
process.env.MORPHEUS_LIBAFL_SEEDCODEC_PATH = path.join(
  workspaceRoot,
  ".morpheus",
  "tools",
  "libafl",
  "scripts",
  "seedcodec.py",
);
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
const consoleFilterPath = path.join(
  repoRoot,
  "tools",
  "libafl",
  "scripts",
  "console-filter.sh",
);
const libaflTool = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "tools", "libafl", "tool.json"), "utf8"),
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
const nvirshStartupBenchmarkSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "nvirsh-buildroot-based-cvm",
    "scripts",
    "benchmark.sh",
  ),
  "utf8",
);
const libaflStartupBenchmarkSource = fs.readFileSync(
  path.join(repoRoot, "tools", "libafl", "scripts", "benchmark.sh"),
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
const libaflPatchSource = fs.readFileSync(
  path.join(repoRoot, "tools", "libafl", "scripts", "patch.sh"),
  "utf8",
);
const qemuSeedPatchSource = fs.readFileSync(
  path.join(
    workspaceRoot,
    "tools",
    "buildroot",
    "patches-cvm",
    "qemu-cca",
    "upstream-v2",
    "0003-libafl-virtio-seed-consumer.patch",
  ),
  "utf8",
);
const libaflBridgeBuildSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "qemu-libafl-bridge",
    "scripts",
    "build.sh",
  ),
  "utf8",
);
const libaflBridgePatchSource = fs.readFileSync(
  path.join(
    repoRoot,
    "tools",
    "qemu-libafl-bridge",
    "patches",
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

test("nested L2 crash feedback requires a verified kernel panic", () => {
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
  assert.match(timeoutBody[1], /l2_kernel_panic_logged\(\)/);
  assert.match(timeoutBody[1], /signal_l2_process_group\(pid, SIGTERM\)/);
  assert.match(stubSource, /morpheus\.capture_runtime=1/);
  assert.match(timeoutBody[1], /log_l2_input_evidence\(\)/);
  assert.match(stubSource, /QEMU_STDOUT_PATH/);
  assert.match(stubSource, /QEMU_STDERR_PATH/);
  assert.match(stubSource, /QEMU_INPUT_STATUS_PATH/);
  assert.doesNotMatch(
    timeoutBody[1],
    /dump_runtime_snapshot\(\)/,
    "normal timeout must not dump every runtime file through hypercalls",
  );

  const panicDetector = stubSource.match(
    /static bool l2_kernel_panic_logged\(void\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(panicDetector, "expected the L2 kernel panic detector");
  assert.match(panicDetector[1], /"Kernel panic"/);
  assert.match(panicDetector[1], /L2_CONSOLE_PATH/);
  assert.match(panicDetector[1], /QEMU_STDOUT_PATH/);
  assert.doesNotMatch(panicDetector[1], /Oops|BUG:|KASAN/);
  assert.doesNotMatch(panicDetector[1], /LAUNCH_STDOUT_PATH|LAUNCH_STDERR_PATH|QEMU_STDERR_PATH/);

  const exitedBody = stubSource.match(
    /if \(WIFEXITED\(status\)\) \{([\s\S]*?)\n  \}\n  if \(WIFSIGNALED\(status\)\)/,
  );
  assert.ok(exitedBody, "expected the L2 exit-status branch");
  assert.match(exitedBody[1], /L2_OUTCOME_LAUNCHER_EXIT/);
  assert.doesNotMatch(exitedBody[1], /LIBAFL_QEMU_END_CRASH/);

  const signaledBody = stubSource.match(
    /if \(WIFSIGNALED\(status\)\) \{([\s\S]*?)\n  \}\n  return false;/,
  );
  assert.ok(signaledBody, "expected the L2 signal-status branch");
  assert.match(signaledBody[1], /L2_OUTCOME_LAUNCHER_SIGNAL/);
  assert.doesNotMatch(signaledBody[1], /LIBAFL_QEMU_END_CRASH/);
  assert.match(stubSource, /stub-outcome kind=%s detail=%d/);
  assert.match(
    stubSource,
    /libafl_qemu_end\(outcome == L2_OUTCOME_KERNEL_PANIC\s*\? LIBAFL_QEMU_END_CRASH\s*:\s*LIBAFL_QEMU_END_OK\)/,
  );
});

test("CVM evidence is only checked after nested QEMU starts", () => {
  assert.match(stubSource, /static bool l2_qemu_exec_started\(void\)/);
  assert.match(stubSource, /qemu-input\.status is written by the wrapper/);
  assert.match(
    stubSource,
    /if \(l2_qemu_exec_started\(\)\) \{\s*log_cvm_evidence\(\);\s*\} else \{\s*lqprintf\("stub: cvm evidence not applicable:/s,
  );
  assert.match(
    stubSource,
    /stub: pre-qemu launcher failure: nested qemu was not started/,
  );
  assert.doesNotMatch(
    stubSource,
    /if \(resolve_l2_cvm_mode\(\)\) \{\s*log_cvm_evidence\(\);/s,
    "CVM mode alone must not imply that nested QEMU was started",
  );
});

test("non-panic L2 outcomes are archived separately from LibAFL objectives", () => {
  assert.match(harnessSource, /objective_dir="\$\{run_dir\}\/objectives"/);
  assert.match(
    harnessSource,
    /stub-outcome kind=\(kernel-panic\|launcher-exit\|launcher-signal\|harness-error\)/,
  );
  assert.match(harnessSource, /path\.join\(outputDir, "outcomes", groupName\)/);
  assert.match(harnessSource, /outcome\.json/);
  assert.match(harnessSource, /outcomes\.json/);
  assert.match(harnessSource, /state\.outcomes = outcomes/);
});

test("runtime extraction preserves an anomalous L2 outcome and its input", () => {
  const functionStart = harnessSource.indexOf("extract_l1_runtime_from_log() {");
  const functionEnd = harnessSource.indexOf("\n}\n\nwrite_result()", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-l2-outcome-"));
  try {
    const outputDir = path.join(tempDir, "runtime");
    const logPath = path.join(tempDir, "launcher.log");
    const extractorPath = path.join(tempDir, "extract.sh");
    fs.writeFileSync(
      logPath,
      [
        "LQPRINTF: stub-outcome kind=launcher-exit detail=139",
        "LQPRINTF: stub-runtime begin name=morpheus-qemu-input.bin size=2 dumped=2 truncated=0",
        "LQPRINTF: stub-runtime data name=morpheus-qemu-input.bin offset=0 hex=1234",
        "LQPRINTF: stub-runtime end name=morpheus-qemu-input.bin",
        "LQPRINTF: stub-runtime begin name=qemu.stdout.log size=12 dumped=12 truncated=0",
        "LQPRINTF: stub-runtime data name=qemu.stdout.log offset=0 hex=6c32206c6f67206c696e650a",
        "LQPRINTF: stub-runtime end name=qemu.stdout.log",
        "LQPRINTF: stub: dumped runtime files to log",
      ].join("\n"),
    );
    writeExecutable(
      extractorPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        harnessSource.slice(functionStart, functionEnd + 2),
        'extract_l1_runtime_from_log "$1" "$2" false',
      ].join("\n"),
    );

    const result = spawnSync("bash", [extractorPath, outputDir, logPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(outputDir, "outcomes.json"), "utf8")),
      [
        {
          index: 0,
          kind: "launcher-exit",
          detail: 139,
          dir: path.join(outputDir, "outcomes", "000000-launcher-exit"),
          trace: path.join(
            outputDir,
            "outcomes",
            "000000-launcher-exit",
            "seed.trace.jsonl",
          ),
          traceEvents: 1,
        },
      ],
    );
    assert.deepEqual(
      fs.readFileSync(
        path.join(
          outputDir,
          "outcomes",
          "000000-launcher-exit",
          "morpheus-qemu-input.bin",
        ),
      ),
      Buffer.from([0x12, 0x34]),
    );
    const trace = fs.readFileSync(
      path.join(
        outputDir,
        "outcomes",
        "000000-launcher-exit",
        "seed.trace.jsonl",
      ),
      "utf8",
    );
    assert.match(trace, /"kind":"trace-meta"/);
    assert.match(trace, /"input_size":2/);
    assert.match(trace, /"kind":"seed-decode-error"/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime extraction rejects a truncated stream unit", () => {
  const functionStart = harnessSource.indexOf("extract_l1_runtime_from_log() {");
  const functionEnd = harnessSource.indexOf("\n}\n\nwrite_result()", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-seed-validation-"));
  try {
    const outputDir = path.join(tempDir, "runtime");
    const logPath = path.join(tempDir, "launcher.log");
    const extractorPath = path.join(tempDir, "extract.sh");
    // v4 wire format: no mmio models, no coherent allocs, one streaming unit
    // whose single word model claims 70 values but only provides 10 bytes.
    const seedInput = Buffer.concat([
      Buffer.alloc(4), // window model count = 0
      Buffer.alloc(4), // coherent alloc count = 0
      Buffer.alloc(8, 0xee), // streaming unit address
      Buffer.from([0x01, 0x00, 0x00, 0x00]), // model_count = 1
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // word offset = 0
      Buffer.from([0x46, 0x00, 0x00, 0x00]), // value count = 70
      Buffer.alloc(10, 0xee), // only 10 value bytes follow (needs 280)
    ]);
    const lines = [
      "LQPRINTF: stub-outcome kind=launcher-exit detail=1",
      `LQPRINTF: stub-runtime begin name=morpheus-qemu-input.bin size=${seedInput.length} dumped=${seedInput.length} truncated=0`,
      `LQPRINTF: stub-runtime data name=morpheus-qemu-input.bin offset=0 hex=${seedInput.toString("hex")}`,
      "LQPRINTF: stub-runtime end name=morpheus-qemu-input.bin",
      "LQPRINTF: stub: dumped runtime files to log",
    ];
    fs.writeFileSync(logPath, lines.join("\n"));
    writeExecutable(
      extractorPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        harnessSource.slice(functionStart, functionEnd + 2),
        'extract_l1_runtime_from_log "$1" "$2" false',
      ].join("\n"),
    );

    const result = spawnSync("bash", [extractorPath, outputDir, logPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const trace = fs.readFileSync(
      path.join(outputDir, "outcomes", "000000-launcher-exit", "seed.trace.jsonl"),
      "utf8",
    );
    assert.match(trace, /"kind":"seed-decode-error"/);
    assert.match(trace, /"detail":"seedcodec-failed"/);
    assert.doesNotMatch(trace, /"kind":"seed-mmio-slot"/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime extraction reports every observed MMIO and DMA event", () => {
  const functionStart = harnessSource.indexOf("extract_l1_runtime_from_log() {");
  const functionEnd = harnessSource.indexOf("\n}\n\nwrite_result()", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-trace-report-"));
  try {
    const outputDir = path.join(tempDir, "runtime");
    const logPath = path.join(tempDir, "launcher.log");
    const extractorPath = path.join(tempDir, "extract.sh");
    // v4 wire format: no mmio models, no coherent allocs, one streaming unit
    // with a single word model of 70 values.
    const seedInput = Buffer.concat([
      Buffer.alloc(4), // window model count = 0
      Buffer.alloc(4), // coherent alloc count = 0
      Buffer.alloc(8, 0xee), // streaming unit address
      Buffer.from([0x01, 0x00, 0x00, 0x00]), // model_count = 1
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // word offset = 0
      Buffer.from([0x46, 0x00, 0x00, 0x00]), // value count = 70
      Buffer.alloc(70 * 4, 0xee), // 70 u32 values
    ]);
    const records = [
      ["morpheus-qemu-input.bin", seedInput],
      [
        "morpheus-qemu-trace.log",
        Buffer.from(
          [
            "virtio_mmio_read virtio_mmio_read offset 0x60",
            "virtio_mmio_write_offset virtio_mmio_write offset 0x50 value 0x0",
            "virtio_mmio_seed_dma addr 0x100002000 len 70 event 0x70604 opcode 0x4 direction 0x2 cursor 70 status 0",
            "virtio_mmio_seed_dma addr 0x100003000 len 4156 event 0x70604 opcode 0x4 direction 0x2 cursor 70 status 0",
          ].join("\n") + "\n",
        ),
      ],
      [
        "qemu.stdout.log",
        Buffer.from(
          "virtio_telemetry op=map kind=payload dir=from_device " +
            "size=4156 aux=0x12000 path=phys\n",
        ),
      ],
    ];
    const lines = ["LQPRINTF: stub-outcome kind=kernel-panic detail=0"];
    for (const [name, data] of records) {
      lines.push(
        `LQPRINTF: stub-runtime begin name=${name} size=${data.length} dumped=${data.length} truncated=0`,
        `LQPRINTF: stub-runtime data name=${name} offset=0 hex=${data.toString("hex")}`,
        `LQPRINTF: stub-runtime end name=${name}`,
      );
    }
    lines.push("LQPRINTF: stub: dumped runtime files to log");
    fs.writeFileSync(logPath, lines.join("\n"));
    writeExecutable(
      extractorPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        harnessSource.slice(functionStart, functionEnd + 2),
        'extract_l1_runtime_from_log "$1" "$2" false',
      ].join("\n"),
    );

    const result = spawnSync("bash", [extractorPath, outputDir, logPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const outcome = JSON.parse(
      fs.readFileSync(path.join(outputDir, "outcomes", "000000-kernel-panic", "outcome.json"), "utf8"),
    );
    assert.deepEqual(outcome, { kind: "kernel-panic", detail: 0 });

    const tracePath = path.join(
      outputDir,
      "outcomes",
      "000000-kernel-panic",
      "seed.trace.jsonl",
    );
    const trace = fs
      .readFileSync(tracePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(trace[0].mmio_observation_events, false);
    assert.equal(trace[0].seed_override_events, 1);
    assert.ok(
      trace.some(
        (event) =>
          event.kind === "seed-stream-unit" &&
          event.models.length === 1 &&
          event.models[0].count === 70,
      ),
    );
    assert.ok(trace.some((event) => event.kind === "mmio-read"));
    assert.ok(trace.some((event) => event.kind === "mmio-write"));
    assert.ok(trace.some((event) => event.kind === "dma-telemetry"));
    assert.ok(trace.some((event) => event.kind === "dma-seed"));
    assert.equal(trace.some((event) => event.kind === "virtio-net-seed-rx"), false);
    assert.equal(trace.some((event) => event.kind === "seed-dma-event"), false);
    assert.ok(trace.every((event) => event.source !== "vhost-user-backend"));
    assert.doesNotMatch(fs.readFileSync(tracePath, "utf8"), /virtio-net profile:/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime extraction parses stock QEMU MMIO traces", () => {
  const functionStart = harnessSource.indexOf("extract_l1_runtime_from_log() {");
  const functionEnd = harnessSource.indexOf("\n}\n\nwrite_result()", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-stock-trace-"));
  try {
    const outputDir = path.join(tempDir, "runtime");
    const logPath = path.join(tempDir, "launcher.log");
    const extractorPath = path.join(tempDir, "extract.sh");
    const records = [
      ["morpheus-qemu-input.bin", Buffer.from([0x01])],
      [
        "morpheus-qemu-trace.log",
        Buffer.from(
          [
            "virtio_mmio_read virtio_mmio_read offset 0x0",
            "virtio_mmio_write_offset virtio_mmio_write offset 0x1c4 value 0x2000",
            "virtio_mmio_write_offset virtio_mmio_write offset 0x1c8 value 0x1",
            "virtio_mmio_write_offset virtio_mmio_write offset 0x1cc value 0x103c",
            "virtio_mmio_write_offset virtio_mmio_write offset 0x1c0 value 0x10606",
          ].join("\n") + "\n",
        ),
      ],
    ];
    const lines = ["LQPRINTF: stub-outcome kind=kernel-panic detail=0"];
    for (const [name, data] of records) {
      lines.push(
        `LQPRINTF: stub-runtime begin name=${name} size=${data.length} dumped=${data.length} truncated=0`,
        `LQPRINTF: stub-runtime data name=${name} offset=0 hex=${data.toString("hex")}`,
        `LQPRINTF: stub-runtime end name=${name}`,
      );
    }
    lines.push("LQPRINTF: stub: dumped runtime files to log");
    fs.writeFileSync(logPath, lines.join("\n"));
    writeExecutable(
      extractorPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        harnessSource.slice(functionStart, functionEnd + 2),
        'extract_l1_runtime_from_log "$1" "$2" false',
      ].join("\n"),
    );

    const result = spawnSync("bash", [extractorPath, outputDir, logPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const trace = fs
      .readFileSync(
        path.join(outputDir, "outcomes", "000000-kernel-panic", "seed.trace.jsonl"),
        "utf8",
      )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(trace[0].mmio_observation_events, false);
    assert.equal(trace[0].mmio_trace_events, true);
    assert.equal(trace[0].mmio_trace_mode, "stock");
    assert.ok(trace.some((event) => event.kind === "mmio-read"));
    assert.ok(trace.some((event) => event.kind === "mmio-write"));
    assert.ok(
      trace.some(
        (event) =>
          event.kind === "dma" &&
          event.operation === "unmap" &&
          event.address === "0x100002000" &&
          event.length === 4156,
      ),
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

test("nested L2 stops the normal wait after guest boot readiness", () => {
  assert.match(stubSource, /#define L2_READY_POLL_MS 250U/);
  assert.match(stubSource, /static bool l2_boot_ready_logged\(void\)/);
  assert.match(stubSource, /"buildroot login:"/);
  assert.match(stubSource, /"Welcome to Buildroot"/);
  assert.match(stubSource, /parent-boot-ready/);
  assert.match(stubSource, /stub: l2 boot ready; continuing run window/);
  assert.match(stubSource, /l2 run window ended and was terminated/);
  assert.match(stubSource, /while \(!boot_ready && elapsed_ms < window_ms\)/);
});

test("SMP startup calibration skips combinations with L1 below L2", () => {
  for (const source of [nvirshStartupBenchmarkSource, libaflStartupBenchmarkSource]) {
    assert.match(
      source,
      /if \[ "\$\{l1_smp\}" -lt "\$\{l2_smp\}" \]; then\s+continue\s+fi/,
    );
    assert.match(source, /constraint: "l1_smp >= l2_smp"/);
  }
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
    /elif \[ "\$\{l2_mode\}" = "cvm" \] &&[\s\S]*nvirsh-buildroot-based-cvm[\s\S]*libafl_l1_smp_requested="1"/,
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
    nvirshBuildrootBasedCvmBuildSource,
    /guest_l2_memory_mb="\$\{MORPHEUS_L2_MEMORY_MB:-1024\}"/,
  );
  assert.match(
    nvirshBuildrootBasedCvmBuildSource,
    /-m "\$\{guest_l2_memory_mb\}M"/,
  );
  assert.match(harnessSource, /--l2-memory-mb\) shift; l2_memory_mb=/);
  assert.match(harnessSource, /MORPHEUS_L2_MEMORY_MB=\$\{l2_memory_mb\}/);
  assert.match(
    harnessSource,
    /launch_env\+=\("MORPHEUS_L2_MEMORY_MB=\$\{l2_memory_mb\}"\)/,
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
  assert.doesNotMatch(nvirshBuildSource, /runtime-libs/);
  assert.doesNotMatch(nvirshBuildSource, /guest_qemu_runtime_loader/);
  assert.doesNotMatch(nvirshBuildSource, /--library-path/);
  assert.doesNotMatch(nvirshBuildSource, /LD_LIBRARY_PATH|LD_PRELOAD/);
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
  assert.match(
    harnessSource,
    /direct_l1_stub_env="\$\{direct_l1_stub_env\} MORPHEUS_L2_ACCEL=\$\{l2_accel\}"/,
  );
  assert.match(
    harnessSource,
    /direct_l1_stub_env="\$\{direct_l1_stub_env\} MORPHEUS_L2_CPU=\$\{l2_cpu\}"/,
  );
  assert.doesNotMatch(harnessSource, /--fuzz-virtio-ids\)/);
  assert.doesNotMatch(harnessSource, /MORPHEUS_QEMU_FUZZ_VIRTIO_IDS/);
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

test("LibAFL exposes configurable grammar mode controls", () => {
  const fields = libaflTool.config.fields;
  assert.equal(fields.grammar.path, true);
  assert.equal(fields["enable-grammar"].boolean, true);
  assert.equal(fields["disable-grammar"].boolean, true);
  assert.equal(fields["devilang-grammar"].path, true);
  assert.equal(fields["enable-devilang-grammar"].boolean, true);
  assert.equal(fields["disable-devilang-grammar"].boolean, true);
  assert.ok(
    libaflTool.managed.local.commands.exec.scalarFlags.includes(
      "grammar",
    ),
  );
  assert.ok(
    libaflTool.managed.local.commands.exec.scalarFlags.includes(
      "devilang-grammar",
    ),
  );
  assert.ok(
    libaflTool.managed.local.commands.exec.scalarFlags.includes(
      "enable-devilang-grammar",
    ),
  );
  assert.ok(
    libaflTool.managed.local.commands.exec.scalarFlags.includes(
      "disable-devilang-grammar",
    ),
  );
  assert.equal(fields["show-console"].boolean, true);
  assert.ok(
    libaflTool.managed.local.commands.exec.scalarFlags.includes(
      "show-console",
    ),
  );
});

test("LibAFL console display switch hides guest streams but keeps raw evidence", () => {
  const fixture = [
    "[libafl/qemu_nesting] starting outer QEMU",
    "L1 console line",
    "[libafl/qemu_nesting] outer QEMU reached guest stub",
    "[libafl/qemu_nesting] host progress",
    "LQPRINTF: stub: launched l2 pid=1",
    "L2 console line",
    "LQPRINTF: stub-outcome kind=complete detail=0",
    "LQPRINTF: stub: qemu stdout: guest line",
    "LQPRINTF: stub-runtime begin name=qemu.stdout.log size=6 dumped=6 truncated=0",
    "LQPRINTF: stub-runtime data name=qemu.stdout.log offset=0 hex=67756573740a",
    "LQPRINTF: stub-runtime end name=qemu.stdout.log",
    "LQPRINTF: stub: dumped runtime files to log",
  ].join("\n") + "\n";
  const hidden = spawnSync("bash", [consoleFilterPath, "false"], {
    input: fixture,
    encoding: "utf8",
  });
  assert.equal(hidden.status, 0, hidden.stderr);
  assert.doesNotMatch(hidden.stdout, /L1 console line/);
  assert.doesNotMatch(hidden.stdout, /L2 console line/);
  assert.doesNotMatch(hidden.stdout, /qemu stdout: guest line/);
  assert.match(hidden.stdout, /\[libafl\/qemu_nesting\] host progress/);
  assert.match(hidden.stdout, /stub-outcome kind=complete/);
  assert.doesNotMatch(hidden.stdout, /\n\n/);

  const shown = spawnSync("bash", [consoleFilterPath, "true"], {
    input: fixture,
    encoding: "utf8",
  });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /L1 console line/);
  assert.match(shown.stdout, /L2 console line/);
  assert.match(shown.stdout, /qemu stdout: guest line/);

  const normalized = spawnSync("bash", [consoleFilterPath, "true"], {
    input: "guest line\r\r\n\r\n",
    encoding: "utf8",
  });
  assert.equal(normalized.status, 0, normalized.stderr);
  assert.equal(normalized.stdout, "guest line\n\n");

  const failedBeforeStub = spawnSync("bash", [consoleFilterPath, "false"], {
    input: [
      "[libafl/qemu_nesting] starting outer QEMU",
      "NOTICE: firmware line",
      "[libafl/qemu_nesting] outer QEMU failed: status=1",
    ].join("\n"),
    encoding: "utf8",
  });
  assert.equal(failedBeforeStub.status, 0, failedBeforeStub.stderr);
  assert.match(failedBeforeStub.stdout, /outer QEMU failed/);
});

test("LibAFL grammar mode fails closed and exposes a no-QEMU probe", () => {
  const genericProbeCommand = libaflTool.managed.local.commands[
    "probe-grammar"
  ];
  assert.deepEqual(genericProbeCommand.requiredFlags, ["source", "grammar"]);
  assert.equal(genericProbeCommand.script.path, "scripts/probe-devilang-grammar.sh");
  const probeCommand = libaflTool.managed.local.commands[
    "probe-devilang-grammar"
  ];
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
  assert.match(
    fuzzerSource,
    /panic!\("failed to load grammar-backed scenario generator: \{err\}"\)/,
  );
  assert.match(fuzzerSource, /--check-devilang-grammar/);
  assert.match(fuzzerSource, /--check-grammar/);
  assert.match(fuzzerSource, /Devilang grammar probe succeeded/);
  assert.ok(libaflTool["cli-contract"].split(",").includes("probe-devilang-grammar"));
  assert.deepEqual(probeCommand.requiredFlags, ["source", "devilang-grammar"]);
  assert.equal(probeCommand.script.path, "scripts/probe-devilang-grammar.sh");
  assert.equal(probeCommand.script.shell, "bash");
});

test("LibAFL bridge keeps the 9p transport enabled across cached builds", () => {
  const dependencySource = fs.readFileSync(
    path.join(repoRoot, "tools", "libafl", "scripts", "install-dependencies.sh"),
    "utf8",
  );
  assert.match(libaflBridgeBuildSource, /--enable-attr/);
  assert.match(libaflBridgeBuildSource, /--enable-virtfs/);
  assert.match(libaflBuildSource, /bridge_config_fingerprint_file/);
  assert.match(libaflBuildSource, /bridge_current\(\)/);
  assert.match(libaflBuildSource, /install_bridge\(\)/);
  assert.doesNotMatch(libaflBuildSource, /bridge_patch_file=/);
  assert.match(libaflBuildSource, /prepare_bridge_source\(\)/);
  assert.match(libaflBuildSource, /LIBAFL_QEMU_DIR="\$\{bridge_storage_dir\}"/);
  assert.doesNotMatch(libaflBuildSource, /LIBAFL_QEMU_CLONE_DIR=/);
  assert.match(libaflBridgeBuildSource, /--as-shared-lib/);
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
    /\.snapshot_manager\(snapshot_manager_from_env\(\)\)/,
  );
  assert.match(
    fuzzerSource,
    /unwrap_or_else\(\|_\| "fast"\.to_owned\(\)\)/,
    "fast snapshots remain the default COW layer",
  );
});

test("LibAFL restores the fuzzing snapshot after an executor timeout", () => {
  assert.match(libaflPatchSource, /v3-timeout-restore/);
  assert.match(
    libaflPatchSource,
    /EmulatorExitResult::Timeout => \{[\s\S]*?emulator\.snapshot_manager\.restore\(qemu, snapshot_id\)\?;[\s\S]*?ExitKind::Timeout/s,
  );
  assert.match(
    libaflPatchSource,
    /crates\/libafl_qemu\/src\/emu\/drivers\/mod\.rs/,
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
  const qemuBridgeSourceDir = path.join(
    tmpDir,
    "build",
    "qemu-libafl-bridge",
  );
  const captureFile = path.join(tmpDir, "qemu-args.txt");
  const grammarModeCaptureFile = path.join(tmpDir, "grammar-mode.txt");
  const grammarPathCaptureFile = path.join(tmpDir, "grammar-path.txt");
  const qemuImgArgsFile = path.join(tmpDir, "qemu-img-args.txt");
  const mkfsExt4ArgsFile = path.join(tmpDir, "mkfs-ext4-args.txt");
  const resultFile = path.join(tmpDir, "result.json");
  const grammarPath = path.join(workspaceDir, "virtio-net.state");
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
  fs.mkdirSync(qemuBridgeSourceDir, { recursive: true });
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
  fs.writeFileSync(grammarPath, "machine synthetic {}\n");
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
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > \"$MORPHEUS_TEST_CAPTURE\"",
      "printf '%s\\n' \"${MORPHEUS_LIBAFL_DEVILANG_GRAMMAR_MODE:-}\" > \"$MORPHEUS_TEST_GRAMMAR_MODE_CAPTURE\"",
      "printf '%s\\n' \"${MORPHEUS_LIBAFL_DEVILANG_GRAMMAR:-}\" > \"$MORPHEUS_TEST_GRAMMAR_PATH_CAPTURE\"",
      "if [ -n \"${MORPHEUS_TEST_CONSOLE_OUTPUT:-}\" ]; then printf '%s\\n' \"${MORPHEUS_TEST_CONSOLE_OUTPUT}\"; fi",
      "",
    ].join("\n"),
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

  const baseHarnessArgs = [
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
    "--l2-memory-mb",
    "512",
  ];
  const runHarness = ({
    targetRunDir,
    targetResultFile,
    targetCaptureFile,
    targetModeCaptureFile,
    targetGrammarPathCaptureFile,
    targetQemuImgArgsFile = qemuImgArgsFile,
    targetMkfsExt4ArgsFile = mkfsExt4ArgsFile,
    args = [],
    env = {},
  }) => spawnSync(
    "bash",
    [harnessScript, ...baseHarnessArgs, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        MORPHEUS_LIBAFL_SOURCE: sourceDir,
        MORPHEUS_LIBAFL_RUN_DIR: targetRunDir,
        MORPHEUS_LIBAFL_INSTALL_DIR: installDir,
        MORPHEUS_LIBAFL_WORKSPACE: workspaceDir,
        MORPHEUS_LIBAFL_RESULT_FILE: targetResultFile,
        MORPHEUS_LIBAFL_RUN_SECONDS: "0",
        MORPHEUS_NVIRSH_INSTALL_DIR: nvirshInstallDir,
        MORPHEUS_TEST_CAPTURE: targetCaptureFile,
        MORPHEUS_TEST_GRAMMAR_MODE_CAPTURE: targetModeCaptureFile,
        MORPHEUS_TEST_GRAMMAR_PATH_CAPTURE: targetGrammarPathCaptureFile,
        MORPHEUS_QEMU_IMG_BIN: fakeQemuImg,
        MORPHEUS_MKFS_EXT4_BIN: fakeMkfsExt4,
        MORPHEUS_QEMU_IMG_ARGS: targetQemuImgArgsFile,
        MORPHEUS_MKFS_EXT4_ARGS: targetMkfsExt4ArgsFile,
        MORPHEUS_REPO_ROOT: repoRoot,
        MORPHEUS_LIBAFL_QEMU_BRIDGE_SOURCE: qemuBridgeSourceDir,
        MORPHEUS_LIBAFL_QEMU_BRIDGE_DATA_DIR: qemuDataDir,
        ...env,
      },
    },
  );
  const run = runHarness({
    targetRunDir: runDir,
    targetResultFile: resultFile,
    targetCaptureFile: captureFile,
    targetModeCaptureFile: grammarModeCaptureFile,
    targetGrammarPathCaptureFile: grammarPathCaptureFile,
    args: ["--grammar", grammarPath],
  });
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  assert.equal(fs.readFileSync(grammarModeCaptureFile, "utf8").trim(), "auto");
  assert.equal(
    path.resolve(fs.readFileSync(grammarPathCaptureFile, "utf8").trim()),
    path.resolve(grammarPath),
  );

  const consoleFixture = [
    "[libafl/qemu_nesting] starting outer QEMU",
    "synthetic L1 console",
    "[libafl/qemu_nesting] outer QEMU reached guest stub",
    "[libafl/qemu_nesting] host progress",
    "LQPRINTF: stub: launched l2 pid=1",
    "synthetic L2 console",
    "LQPRINTF: stub-outcome kind=complete detail=0",
    "LQPRINTF: stub-runtime begin name=qemu.stdout.log size=6 dumped=6 truncated=0",
    "LQPRINTF: stub-runtime data name=qemu.stdout.log offset=0 hex=67756573740a",
    "LQPRINTF: stub-runtime end name=qemu.stdout.log",
    "LQPRINTF: stub: dumped runtime files to log",
  ].join("\n");
  const hiddenConsoleRunDir = path.join(tmpDir, "run-console-hidden");
  const hiddenConsoleRun = runHarness({
    targetRunDir: hiddenConsoleRunDir,
    targetResultFile: path.join(tmpDir, "result-console-hidden.json"),
    targetCaptureFile: path.join(tmpDir, "qemu-args-console-hidden.txt"),
    targetModeCaptureFile: path.join(tmpDir, "grammar-mode-console-hidden.txt"),
    targetGrammarPathCaptureFile: path.join(
      tmpDir,
      "grammar-path-console-hidden.txt",
    ),
    targetQemuImgArgsFile: path.join(tmpDir, "qemu-img-args-console-hidden.txt"),
    targetMkfsExt4ArgsFile: path.join(tmpDir, "mkfs-ext4-args-console-hidden.txt"),
    env: { MORPHEUS_TEST_CONSOLE_OUTPUT: consoleFixture },
  });
  assert.equal(
    hiddenConsoleRun.status,
    0,
    `${hiddenConsoleRun.stderr}\n${hiddenConsoleRun.stdout}`,
  );
  const hiddenConsoleOutput = `${hiddenConsoleRun.stdout}\n${hiddenConsoleRun.stderr}`;
  assert.doesNotMatch(hiddenConsoleOutput, /synthetic L1 console/);
  assert.doesNotMatch(hiddenConsoleOutput, /synthetic L2 console/);
  assert.match(hiddenConsoleOutput, /host progress/);
  assert.match(hiddenConsoleOutput, /stub-outcome kind=complete/);
  const hiddenRawLog = fs.readFileSync(
    path.join(hiddenConsoleRunDir, "launcher.stdout.log"),
    "utf8",
  );
  assert.match(hiddenRawLog, /synthetic L1 console/);
  assert.match(hiddenRawLog, /synthetic L2 console/);
  assert.equal(
    fs.readFileSync(
      path.join(hiddenConsoleRunDir, "l1-runtime", "qemu.stdout.log"),
      "utf8",
    ),
    "guest\n",
  );

  const shownConsoleRun = runHarness({
    targetRunDir: path.join(tmpDir, "run-console-shown"),
    targetResultFile: path.join(tmpDir, "result-console-shown.json"),
    targetCaptureFile: path.join(tmpDir, "qemu-args-console-shown.txt"),
    targetModeCaptureFile: path.join(tmpDir, "grammar-mode-console-shown.txt"),
    targetGrammarPathCaptureFile: path.join(
      tmpDir,
      "grammar-path-console-shown.txt",
    ),
    targetQemuImgArgsFile: path.join(tmpDir, "qemu-img-args-console-shown.txt"),
    targetMkfsExt4ArgsFile: path.join(tmpDir, "mkfs-ext4-args-console-shown.txt"),
    args: ["--show-console"],
    env: { MORPHEUS_TEST_CONSOLE_OUTPUT: consoleFixture },
  });
  assert.equal(
    shownConsoleRun.status,
    0,
    `${shownConsoleRun.stderr}\n${shownConsoleRun.stdout}`,
  );
  const shownConsoleOutput = `${shownConsoleRun.stdout}\n${shownConsoleRun.stderr}`;
  assert.match(shownConsoleOutput, /synthetic L1 console/);
  assert.match(shownConsoleOutput, /synthetic L2 console/);

  const envShownConsoleRun = runHarness({
    targetRunDir: path.join(tmpDir, "run-console-env-shown"),
    targetResultFile: path.join(tmpDir, "result-console-env-shown.json"),
    targetCaptureFile: path.join(tmpDir, "qemu-args-console-env-shown.txt"),
    targetModeCaptureFile: path.join(tmpDir, "grammar-mode-console-env-shown.txt"),
    targetGrammarPathCaptureFile: path.join(
      tmpDir,
      "grammar-path-console-env-shown.txt",
    ),
    targetQemuImgArgsFile: path.join(tmpDir, "qemu-img-args-console-env-shown.txt"),
    targetMkfsExt4ArgsFile: path.join(tmpDir, "mkfs-ext4-args-console-env-shown.txt"),
    env: {
      MORPHEUS_LIBAFL_SHOW_CONSOLE: "true",
      MORPHEUS_TEST_CONSOLE_OUTPUT: consoleFixture,
    },
  });
  assert.equal(
    envShownConsoleRun.status,
    0,
    `${envShownConsoleRun.stderr}\n${envShownConsoleRun.stdout}`,
  );
  const envShownConsoleOutput = `${envShownConsoleRun.stdout}\n${envShownConsoleRun.stderr}`;
  assert.match(envShownConsoleOutput, /synthetic L1 console/);
  assert.match(envShownConsoleOutput, /synthetic L2 console/);

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
    /init=\/bin\/sh -- -c "mkdir -p \/mnt && mount [^\n]* && MORPHEUS_L2_MODE=cvm(?: MORPHEUS_L2_ACCEL=kvm)?(?: MORPHEUS_L2_CPU=host)?(?: MORPHEUS_L2_MEMORY_MB=512)?(?: MORPHEUS_L2_RUN_WINDOW_MS=1000)? exec \/mnt\/libafl_nesting_stub"/,
  );
  assert.match(startup, /MORPHEUS_L2_MODE=cvm/);
  assert.match(startup, /MORPHEUS_L2_MEMORY_MB=512/);
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

  const enabledRunDir = path.join(tmpDir, "run-enabled");
  const enabledModeCaptureFile = path.join(tmpDir, "grammar-mode-enabled.txt");
  const enabledGrammarPathCaptureFile = path.join(tmpDir, "grammar-path-enabled.txt");
  const enabledRun = runHarness({
    targetRunDir: enabledRunDir,
    targetResultFile: path.join(tmpDir, "result-enabled.json"),
    targetCaptureFile: path.join(tmpDir, "qemu-args-enabled.txt"),
    targetModeCaptureFile: enabledModeCaptureFile,
    targetGrammarPathCaptureFile: enabledGrammarPathCaptureFile,
    args: ["--enable-grammar", "--grammar", grammarPath],
  });
  assert.equal(enabledRun.status, 0, `${enabledRun.stderr}\n${enabledRun.stdout}`);
  assert.equal(fs.readFileSync(enabledModeCaptureFile, "utf8").trim(), "on");
  assert.equal(
    path.resolve(fs.readFileSync(enabledGrammarPathCaptureFile, "utf8").trim()),
    path.resolve(grammarPath),
  );

  const configuredRunDir = path.join(tmpDir, "run-configured");
  const configuredModeCaptureFile = path.join(tmpDir, "grammar-mode-configured.txt");
  const configuredGrammarPathCaptureFile = path.join(
    tmpDir,
    "grammar-path-configured.txt",
  );
  const configuredRun = runHarness({
    targetRunDir: configuredRunDir,
    targetResultFile: path.join(tmpDir, "result-configured.json"),
    targetCaptureFile: path.join(tmpDir, "qemu-args-configured.txt"),
    targetModeCaptureFile: configuredModeCaptureFile,
    targetGrammarPathCaptureFile: configuredGrammarPathCaptureFile,
    env: {
      MORPHEUS_LIBAFL_ENABLE_GRAMMAR: "true",
      MORPHEUS_LIBAFL_GRAMMAR: grammarPath,
    },
  });
  assert.equal(
    configuredRun.status,
    0,
    `${configuredRun.stderr}\n${configuredRun.stdout}`,
  );
  assert.equal(
    fs.readFileSync(configuredModeCaptureFile, "utf8").trim(),
    "on",
  );
  assert.equal(
    path.resolve(
      fs.readFileSync(configuredGrammarPathCaptureFile, "utf8").trim(),
    ),
    path.resolve(grammarPath),
  );

  const disabledModeCaptureFile = path.join(tmpDir, "grammar-mode-disabled.txt");
  const disabledGrammarPathCaptureFile = path.join(tmpDir, "grammar-path-disabled.txt");
  const disabledRun = runHarness({
    targetRunDir: path.join(tmpDir, "run-disabled"),
    targetResultFile: path.join(tmpDir, "result-disabled.json"),
    targetCaptureFile: path.join(tmpDir, "qemu-args-disabled.txt"),
    targetModeCaptureFile: disabledModeCaptureFile,
    targetGrammarPathCaptureFile: disabledGrammarPathCaptureFile,
    args: ["--disable-grammar"],
    env: { MORPHEUS_LIBAFL_GRAMMAR: grammarPath },
  });
  assert.equal(disabledRun.status, 0, `${disabledRun.stderr}\n${disabledRun.stdout}`);
  assert.equal(fs.readFileSync(disabledModeCaptureFile, "utf8").trim(), "off");
  assert.equal(fs.readFileSync(disabledGrammarPathCaptureFile, "utf8").trim(), "");

  const missingGrammarRun = runHarness({
    targetRunDir: path.join(tmpDir, "run-missing-grammar"),
    targetResultFile: path.join(tmpDir, "result-missing-grammar.json"),
    targetCaptureFile: path.join(tmpDir, "qemu-args-missing-grammar.txt"),
    targetModeCaptureFile: path.join(tmpDir, "grammar-mode-missing.txt"),
    targetGrammarPathCaptureFile: path.join(tmpDir, "grammar-path-missing.txt"),
    args: ["--enable-grammar"],
    env: { MORPHEUS_LIBAFL_GRAMMAR: "" },
  });
  assert.notEqual(missingGrammarRun.status, 0);
  assert.match(
    missingGrammarRun.stderr,
    /grammar mode on requires --grammar/,
  );
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
  assert.match(
    fuzzerSource,
    /StdMutationalStage::with_max_iterations\(\s*ScenarioMutator/,
  );
});

test("slow nesting executions report broker progress between iterations", () => {
  assert.match(fuzzerSource, /MORPHEUS_LIBAFL_MUTATIONAL_MAX_ITERATIONS/);
  assert.match(fuzzerSource, /parse_mutational_max_iterations/);
  assert.match(fuzzerSource, /fuzzer\s*\.\s*fuzz_loop_for\(/);
  assert.match(fuzzerSource, /fuzz_loop_for\([\s\S]*?,\s*1,\s*\)/);
  assert.match(fuzzerSource, /report_progress\(&mut \$mgr, &mut state\)/);
  assert.equal(
    libaflTool.config.fields["mutational-max-iterations"].aliases[0],
    "mutational-max-iterations",
  );
  assert.ok(
    libaflTool.managed.local.commands.exec.scalarFlags.includes(
      "mutational-max-iterations",
    ),
  );
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
  assert.doesNotMatch(stubSource, /MORPHEUS_QEMU_FUZZ_VIRTIO_IDS/);
  assert.doesNotMatch(rustStubSource, /MORPHEUS_QEMU_FUZZ_VIRTIO_IDS/);
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
    /^\/\/! Structured nested fuzzing support for `LibAFL`\.\n+extern crate alloc;/,
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

test("seed-driven native MMIO and DMA input stays in versioned QEMU code", () => {
  assert.equal(libaflTool.config.fields["device-backend"], undefined);
  assert.ok(
    !libaflTool.managed.local.commands.exec.scalarFlags.includes(
      "device-backend",
    ),
  );
  assert.doesNotMatch(libaflBuildSource, /device_backend|libafl_device_backend/);
  assert.doesNotMatch(
    harnessSource,
    /device_backend|libafl_device_backend|vhost-user/,
  );
  assert.doesNotMatch(
    harnessSource,
    /MORPHEUS_QEMU_INJECT_VIRQ|injected_vintid|injected_period_ms/,
  );
  assert.doesNotMatch(harnessSource, /run_window_ms\(data\)/);
  assert.doesNotMatch(
    nvirshBuildrootBasedCvmBuildSource,
    /device_backend|libafl_device_backend|vhost-user/,
  );
  assert.match(
    nvirshBuildrootBasedCvmBuildSource,
    /validate_guest_qemu_seed_consumer\(\)/,
  );
  assert.match(nvirshBuildrootBasedCvmBuildSource, /MORPHEUS_QEMU_INPUT_PATH/);
  assert.match(
    nvirshBuildrootBasedCvmBuildSource,
    /qemu-seed-consumer=mmio-window/,
  );
  assert.match(nvirshBuildrootBasedCvmBuildSource, /virtio_mmio_seed_read/);
  assert.match(qemuSeedPatchSource, /morpheus_virtio_seed_read_slot/);
  assert.match(qemuSeedPatchSource, /MORPHEUS_SEED_WINDOW_SLOTS 128U/);
  assert.match(qemuSeedPatchSource, /model->visits >= model->count/);
  assert.doesNotMatch(
    qemuSeedPatchSource,
    /morpheus_virtio_seed_queue_dma_complete|virtqueue_pop|virtqueue_fill|virtqueue_flush|dma_memory_write\(vdev->dma_as/,
  );
  assert.doesNotMatch(
    qemuSeedPatchSource,
    /CVE-[0-9]+|virtio-net profile:|synthetic_rx_done|virtio_net_seed_rx|morpheus_virtio_seed_take_rx|morpheus_virtio_seed_dma_write/,
  );
});

test("LibAFL rebuild invalidates stale overlay Cargo packages", () => {
  assert.match(libaflBuildSource, /build_bridge_crate\(\)/);
  assert.match(libaflBuildSource, /build_fuzzer\(\)/);
  assert.match(
    libaflBuildSource,
    /cargo clean[\s\S]*-p libafl_nesting[\s\S]*-p qemu_nesting/,
  );
  assert.doesNotMatch(
    libaflBuildSource,
    /LIBAFL_QEMU_DIR="\$\{bridge_storage_dir\}" cargo build/,
  );
  assert.match(
    libaflBuildSource,
    /qemu_driver_src="\$\{source_dir\}\/crates\/libafl_qemu\/src\/emu\/drivers\/mod\.rs"/,
  );
  assert.match(
    libaflBuildSource,
    /find "\$\{fuzzer_src_dir\}" "\$\{crate_src_dir\}" "\$\{qemu_driver_src\}"/,
  );
});

test("LibAFL stub rebuild uses content fingerprints instead of mtimes", () => {
  assert.match(libaflBuildSource, /stub_fingerprint_file=/);
  assert.match(libaflBuildSource, /stub_fingerprint\(\)/);
  assert.match(libaflBuildSource, /sha256sum "\$\{stub_c_src\}"/);
  assert.match(libaflBuildSource, /record_stub_fingerprint\(\)/);
  assert.doesNotMatch(
    libaflBuildSource,
    /stub_current\(\) \{[^}]*-nt "\$\{stub_c_src\}"/s,
  );
});
