const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
