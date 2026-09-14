const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const bin = path.join(appRoot, "dist", "cli.js");
const profileSource = path.join(repoRoot, "tools", "nvirsh", "profiles", "qemu-debian-arm");

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    ...options,
  });
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-nvirsh-"));
  fs.mkdirSync(path.join(root, ".morpheus"), { recursive: true });
  const sharedCacheRoot = path.join(root, "cache", "hyperarm");
  const configPath = path.join(root, "morpheus.yaml");

  fs.writeFileSync(
    configPath,
    [
      "cache:",
      `  root: ${path.join(root, "cache")}`,
      "  namespace: hyperarm",
      "  downloads: global",
      "  builds: global",
      "  src: global",
      "tools:",
      "  nvirsh:",
      "    profile: qemu-debian-arm64",
      "    build-dir-key: qemu-debian-arm64",
      "    reuse-build-dir: true",
      "    l2-mode: cvm",
      "    firmware: /usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
      "    dependencies:",
      "      qemu:",
      `        path: ${path.join(sharedCacheRoot, "tools", "qemu", "builds", "qemu-11.0.3-aarch64-softmmu", "install", "bin", "qemu-system-aarch64")}`,
      "      buildroot:",
      `        path: ${path.join(sharedCacheRoot, "tools", "buildroot", "builds", "arm64-dev", "output")}`,
      "      qemu-source:",
      `        path: ${path.join(sharedCacheRoot, "tools", "qemu", "src", "qemu-11.0.3")}`,
      `    source: ${JSON.stringify(profileSource)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return { root, configPath };
}

test("nvirsh inspect and stop use the workspace cache", () => {
  const { root: projectRoot, configPath } = makeProject();
  const env = {
    ...process.env,
  };
  const expectedState = path.join(
    projectRoot,
    "cache",
    "hyperarm",
    "tools",
    "nvirsh",
    "builds",
    "qemu-debian-arm64",
    "install",
    "state.json",
  );
  fs.mkdirSync(path.dirname(expectedState), { recursive: true });
  fs.writeFileSync(expectedState, JSON.stringify({
    status: "prepared",
    currentPhase: "prepared",
    runtime: {},
  }, null, 2) + "\n");

  try {
    let result = run(["--config", configPath, "inspect", "--tool", "nvirsh", "--json"], {
      cwd: projectRoot,
      env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "success");
    assert.equal(payload.details.manifest, expectedState);
    assert.ok(["prepared", "stopped"].includes(payload.details.status));

    result = run(["--config", configPath, "stop", "--tool", "nvirsh", "--json"], {
      cwd: projectRoot,
      env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    payload = JSON.parse(result.stdout);
    assert.equal(payload.details.stopped, true);

    result = run(["--config", configPath, "inspect", "--tool", "nvirsh", "--json"], {
      cwd: projectRoot,
      env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    payload = JSON.parse(result.stdout);
    assert.equal(payload.details.current_phase, "stopped");
    assert.equal(payload.details.manifest, expectedState);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
