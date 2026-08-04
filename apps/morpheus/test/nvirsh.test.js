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
  const configPath = path.join(root, "morpheus.yaml");
  fs.writeFileSync(
    configPath,
    [
      "workspace:",
      `  root: ${path.join(repoRoot, ".cache", "hyperarm")}`,
      "tools:",
      "  nvirsh:",
      "    profile: qemu-debian-arm64",
      "    build-dir-key: qemu-debian-arm64",
      "    reuse-build-dir: true",
      "    l2-mode: cvm",
      "    firmware: /usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
      "    dependencies:",
      "      qemu:",
      `        path: ${path.join(repoRoot, ".cache", "hyperarm", "tools", "qemu", "builds", "qemu-11.0.3-aarch64-softmmu", "install", "bin", "qemu-system-aarch64")}`,
      "      buildroot:",
      `        path: ${path.join(repoRoot, ".cache", "hyperarm", "tools", "buildroot", "builds", "arm64-dev", "output")}`,
      "      qemu-source:",
      `        path: ${path.join(repoRoot, ".cache", "hyperarm", "tools", "qemu", "src", "qemu-11.0.3")}`,
      `    source: ${JSON.stringify(profileSource)}`,
      "",
    ].join("\n")
  );
  return { root, configPath };
}

test("nvirsh build exec inspect and stop manage a nested stack", () => {
  const { root: projectRoot, configPath } = makeProject();
  const env = {
    ...process.env,
  };
  const runRoot = path.join(repoRoot, ".cache", "hyperarm", "tools", "nvirsh", "runs", "qemu-debian-arm64");
  fs.rmSync(runRoot, { recursive: true, force: true });

  let result = run(["--config", configPath, "build", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "build");
  assert.equal(payload.status, "success");
  assert.equal(payload.details.profile, "qemu-debian-arm64");
  assert.match(payload.details.state_file, /state\.json$/);
  const state = JSON.parse(fs.readFileSync(payload.details.state_file, "utf8"));
  assert.equal(state.layeredState.l2.mode, "cvm");
  assert.equal(state.layeredState.l2.cvm, true);

  result = run(["--config", configPath, "exec", "--tool", "nvirsh", "--json", "--phase", "launch", "--detach"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "exec");
  assert.equal(payload.status, "success");
  assert.equal(payload.details.phase, "launch");
  assert.equal(payload.details.detached, true);
  assert.ok(Number.isInteger(payload.details.pid));
  assert.match(payload.details.log_file, /stdout\.log$/);
  assert.match(payload.details.manifest, /manifest\.json$/);

  result = run(["--config", configPath, "inspect", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  assert.equal(payload.details.status, "running");
  assert.equal(payload.details.current_phase, "launch");

  result = run(["--config", configPath, "stop", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.details.stopped, true);

  result = run(["--config", configPath, "inspect", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.details.current_phase, "stopped");
  assert.equal(payload.details.layered_state.l2.status, "stopped");

  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
});
