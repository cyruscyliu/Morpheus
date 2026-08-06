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
const harnessSource = fs.readFileSync(
  path.join(repoRoot, "tools", "libafl", "scripts", "exec.sh"),
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
  assert.doesNotMatch(
    timeoutBody[1],
    /dump_runtime_snapshot\(\)/,
    "normal timeout must not dump every runtime file through hypercalls",
  );
});

test("generated CVM hoststack cleanup terminates lkvm descendants", () => {
  assert.match(nvirshBuildSource, /stop_lkvm\(\)/);
  assert.match(nvirshBuildSource, /kill -TERM "\\\$\{pid\}"/);
  assert.match(nvirshBuildSource, /kill -KILL "\\\$\{pid\}"/);
  assert.match(nvirshBuildSource, /stop_lkvm\n  set -e/);
  assert.match(nvirshBuildSource, /l1_provision_cmdline=/);
  assert.match(nvirshBuildSource, /s\/\\\\<init=\[\^ \]\*\/\/g/);
});

test("nested fuzz loop avoids a duplicate L2 shadow execution", () => {
  assert.doesNotMatch(fuzzerSource, /ShadowTracingStage/);
  assert.doesNotMatch(fuzzerSource, /CmpLogObserver/);
  assert.match(fuzzerSource, /StdMutationalStage::new\(\s*ScenarioMutator/);
});

test("full runtime capture is opt-in for the fuzzing harness", () => {
  assert.match(harnessSource, /--capture-runtime\)/);
  assert.match(harnessSource, /morpheus\.capture_runtime=1/);
});
