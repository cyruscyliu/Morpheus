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
      "  root: ./workflow-workspace",
      "tools:",
      "  nvirsh:",
      "    profile: qemu-debian-arm64",
      "    build-dir-key: qemu-debian-arm64",
      `    source: ${JSON.stringify(profileSource)}`,
      "",
    ].join("\n")
  );
  return { root, configPath };
}

test("nvirsh build exec inspect logs and stop manage a nested stack", () => {
  const { root: projectRoot, configPath } = makeProject();
  const env = {
    ...process.env,
    MORPHEUS_WORK_ROOT: path.join(projectRoot, "workflow-workspace"),
  };

  let result = run(["--config", configPath, "build", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "build");
  assert.equal(payload.status, "success");
  assert.equal(payload.details.profile, "qemu-debian-arm64");
  assert.match(payload.details.state_file, /state\.json$/);

  result = run(["--config", configPath, "exec", "--tool", "nvirsh", "--json", "--phase", "launch"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "exec");
  assert.equal(payload.status, "success");
  assert.equal(payload.details.phase, "launch");
  assert.ok(Number.isInteger(payload.details.pid) || payload.details.pid === null);

  result = run(["--config", configPath, "inspect", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  assert.equal(payload.details.status, "running");
  assert.equal(payload.details.current_phase, "launch");

  result = run(["--config", configPath, "logs", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.match(payload.details.text, /launched l2/);

  result = run(["--config", configPath, "stop", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.details.stopped, true);

  result = run(["--config", configPath, "inspect", "--tool", "nvirsh", "--json"], { cwd: projectRoot, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.details.status, "stopped");

  fs.rmSync(projectRoot, { recursive: true, force: true });
});
