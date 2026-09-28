const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const submoduleRoot = path.resolve(__dirname, "../../..");
const workspaceRoot = path.resolve(__dirname, "../../../..");

test("CVM exec directories include invocation identity", () => {
  const descriptor = JSON.parse(fs.readFileSync(
    path.join(submoduleRoot, "tools/nvirsh-buildroot-based-cvm/tool.json"),
    "utf8",
  ));
  assert.equal(
    descriptor.managed.local.execDirTemplate,
    "runs/nvirsh-buildroot-based-cvm/{buildDirKey}/{invocationId}",
  );
});

test("qemu host stage resets the shared source to the clean patch variant", () => {
  const yaml = fs.readFileSync(path.join(workspaceRoot, "morpheus.yaml"), "utf8");
  const start = yaml.indexOf("  qemu-host:");
  const end = yaml.indexOf("\n  linux:", start);
  const stage = yaml.slice(start, end);
  assert.match(stage, /id: qemu_host_patch/);
  assert.match(stage, /tools\/qemu\/patches\/empty/);
});

test("reacquiring a build lock key does not deadlock", () => {
  const lockScript = path.join(submoduleRoot, "tools/_shared/scripts/lock.sh");
  const result = spawnSync("timeout", ["5", "bash", "-c", `source '${lockScript}'; morpheus_build_lock test same; morpheus_build_lock test same; morpheus_lock_release`], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("source and build locks remain independently held", () => {
  const lockScript = path.join(submoduleRoot, "tools/_shared/scripts/lock.sh");
  const lockRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "morpheus-lock-test-"));
  const sourceLock = path.join(lockRoot, "source.lock");
  const holder = require("node:child_process").spawn("bash", ["-c", `source '${lockScript}'; morpheus_lock_acquire '${sourceLock}'; morpheus_build_lock test-key different; test -n "$MORPHEUS_LOCK_FD"; test -n "$MORPHEUS_BUILD_LOCK_FD"; sleep 2`], {
    env: { ...process.env, MORPHEUS_LOCK_ROOT: lockRoot },
    encoding: "utf8",
  });
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const blocked = spawnSync("timeout", ["1", "bash", "-c", `source '${lockScript}'; morpheus_lock_acquire '${sourceLock}'`], { encoding: "utf8" });
      try {
        assert.notEqual(blocked.status, 0);
        holder.kill();
        resolve();
      } catch (error) {
        holder.kill();
        reject(error);
      }
    }, 100);
  });
});
