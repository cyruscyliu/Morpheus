const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const patchScript = path.join(repoRoot, "tools", "buildroot", "scripts", "patch.sh");

test("buildroot patch fingerprints nested package patch directories", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-patch-"));
  const sourceDir = path.join(
    tmpDir,
    "cache",
    "tools",
    "buildroot",
    "src",
    "buildroot-2025.05",
  );
  const patchDir = path.join(
    tmpDir,
    "workspace",
    "tools",
    "buildroot",
    "patches",
  );
  const resultFile = path.join(tmpDir, "result.json");
  const stateFile = path.join(sourceDir, ".morpheus-patches.json");
  const qemuPatch = path.join(patchDir, "qemu", "0001-guest-fuzz.patch");

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.dirname(qemuPatch), { recursive: true });
  fs.writeFileSync(qemuPatch, "guest-qemu-v1\n", "utf8");

  let result = spawnSync("bash", [patchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_PATCH_DIR: patchDir,
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const firstResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const firstFingerprint = firstResult.details.fingerprint;
  assert.equal(typeof firstFingerprint, "string");
  assert.notEqual(firstFingerprint, "");
  assert.equal(
    JSON.parse(fs.readFileSync(stateFile, "utf8")).fingerprint,
    firstFingerprint,
  );

  fs.writeFileSync(qemuPatch, "guest-qemu-v2\n", "utf8");

  result = spawnSync("bash", [patchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_PATCH_DIR: patchDir,
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const secondResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const secondFingerprint = secondResult.details.fingerprint;
  assert.notEqual(secondFingerprint, firstFingerprint);
  assert.equal(
    JSON.parse(fs.readFileSync(stateFile, "utf8")).fingerprint,
    secondFingerprint,
  );
});
