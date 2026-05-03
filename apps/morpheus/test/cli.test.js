const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync, spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const bin = path.join(appRoot, "dist", "cli.js");
const buildrootFixture = path.join(repoRoot, "tools", "buildroot", "test", "fixtures", "minimal-buildroot");
const { applyConfigDefaults } = require("../dist/core/config.js");
const { effectiveBuildDirKey, syncRemotePathToLocal } = require("../dist/transport/remote.js");

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: path.resolve(appRoot, "..", ".."),
    ...options
  });
}

function writeConfig(dir, content) {
  fs.writeFileSync(path.join(dir, "morpheus.yaml"), content);
}

function isolatedEnv(extra = {}) {
  return {
    ...process.env,
    MORPHEUS_WORK_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-test-work-")),
    ...extra
  };
}

function pidState(pid) {
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function assertPidInactive(pid) {
  const state = pidState(pid);
  assert.ok(!state || state.startsWith("Z"), `expected pid ${pid} to be inactive, got ${state}`);
}

function makeFakeSshEnv(remoteRoot) {
  const fakeBin = path.join(remoteRoot, "fake-ssh-bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const sshPath = path.join(fakeBin, "ssh");
  fs.writeFileSync(
    sshPath,
    `#!/usr/bin/env python3
import subprocess
import sys

argv = sys.argv[1:]
while argv:
    if argv[0] == "-p":
        argv = argv[2:]
        continue
    if len(argv) == 1:
        script = argv[0]
        root = ${JSON.stringify(remoteRoot)}
        rewritten = script.replace("'/remote-workspace'", "'" + root + "'")
        rewritten = rewritten.replace("/remote-workspace", root)
        result = subprocess.run(
            ["bash", "-lc", rewritten],
            stdin=sys.stdin.buffer,
            stdout=sys.stdout.buffer,
            stderr=sys.stderr.buffer,
            check=False,
        )
        raise SystemExit(result.returncode)
    if argv[0] == "bash":
        argv = argv[1:]
        break
    argv = argv[1:]

if len(argv) < 2 or argv[0] != "-lc":
    print("unexpected ssh invocation", file=sys.stderr)
    raise SystemExit(1)

script = argv[1]
root = ${JSON.stringify(remoteRoot)}
rewritten = script.replace("'/remote-workspace'", "'" + root + "'")
rewritten = rewritten.replace("/remote-workspace", root)
result = subprocess.run(
    ["bash", "-lc", rewritten],
    stdin=sys.stdin.buffer,
    stdout=sys.stdout.buffer,
    stderr=sys.stderr.buffer,
    check=False,
)
raise SystemExit(result.returncode)
`,
    { mode: 0o755 }
  );
  return {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
    MORPHEUS_SSH_BIN: sshPath,
  };
}

test("workspace show returns JSON metadata", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-show-project-"));
  const result = run(["workspace", "show", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.root, "string");
  assert.equal(typeof payload.directories.runs.exists, "boolean");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("syncRemotePathToLocal replaces existing localized directories", () => {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-sync-"));
  const sourceDir = path.join(remoteRoot, "qemu-8.2.7");
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-local-sync-"));
  const destination = path.join(localRoot, "source-dir");
  const env = { ...process.env, ...makeFakeSshEnv(remoteRoot) };

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "first.txt"), "first\n");

  const previousEnv = process.env;
  process.env = env;
  try {
    syncRemotePathToLocal("/remote-workspace/qemu-8.2.7", destination, { host: "fake" }, "test artifact");
    assert.equal(fs.readFileSync(path.join(destination, "first.txt"), "utf8"), "first\n");

    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "second.txt"), "second\n");

    syncRemotePathToLocal("/remote-workspace/qemu-8.2.7", destination, { host: "fake" }, "test artifact");

    assert.equal(fs.readFileSync(path.join(destination, "second.txt"), "utf8"), "second\n");
    assert.equal(fs.existsSync(path.join(destination, "first.txt")), false);
    assert.equal(fs.existsSync(path.join(destination, "qemu-8.2.7")), false);
  } finally {
    process.env = previousEnv;
    fs.rmSync(localRoot, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
  }
});

test("config check reports success for local and remote modes", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-check-ok-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  buildroot:",
      "    mode: remote",
      "  nvirsh:",
      "    mode: local",
      ""
    ].join("\n")
  );

  const result = run(["config", "check", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("config check rejects non-local-non-remote modes", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-check-bad-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  qemu:",
      "    mode: build",
      ""
    ].join("\n")
  );

  const result = run(["config", "check", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "error");
  assert.equal(payload.details.issues[0].path, "tools.qemu.mode");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool list discovers repo-local tools", () => {
  const result = run(["tool", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.tools.map((tool) => tool.name),
    ["buildroot", "libvmm", "llbic", "llcg", "microkit-sdk", "nvirsh", "outline-to-paper", "qemu", "sel4"]
  );
});

test("config check can use explicit --config outside the config directory", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-explicit-"));
  const nestedRoot = path.join(projectRoot, "nested", "cwd");
  fs.mkdirSync(nestedRoot, { recursive: true });
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );

  const result = run(["--config", path.join(projectRoot, "morpheus.yaml"), "config", "check", "--json"], {
    cwd: nestedRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow commands are available through Morpheus", () => {
  const result = run(["workflow", "--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /workflow run/);
  assert.match(result.stdout, /workflow inspect/);
  assert.match(result.stdout, /workflow stop/);
  assert.match(result.stdout, /workflow remove/);
});

test("workflow stop marks a running workflow as stopped", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-stop-"));
  const runId = "wf-stop-test";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-build");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-build",
    name: "build",
    status: "running",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "tool-buildroot",
    category: "build",
    status: "running",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: "01-build",
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-build", name: "build", stepDir, status: "running" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "running",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: null,
    summary: { workflow: "tool-buildroot", category: "build" },
  }, null, 2)}\n`);

  const result = run(["--json", "workflow", "stop", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  const workflow = JSON.parse(fs.readFileSync(path.join(runDir, "workflow.json"), "utf8"));
  const step = JSON.parse(fs.readFileSync(path.join(stepDir, "step.json"), "utf8"));
  assert.equal(workflow.status, "stopped");
  assert.equal(step.status, "stopped");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow stop invokes tool stop for attached managed runs", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-stop-tool-"));
  const runId = "wf-stop-tool-test";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-run");
  const toolRunDir = stepDir;
  fs.mkdirSync(toolRunDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");

  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  fs.writeFileSync(path.join(toolRunDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(toolRunDir, "manifest.json"), `${JSON.stringify({
    id: "nvirsh-run",
    tool: "nvirsh",
    status: "running",
    stateDir: toolRunDir,
    logFile: path.join(toolRunDir, "stdout.log"),
    manifest: path.join(toolRunDir, "manifest.json"),
    pid: sleeper.pid,
    runtime: {
      providerRun: null,
    },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-run",
    name: "run",
    tool: "nvirsh",
    status: "running",
    stepDir,
    toolRunDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "tool-nvirsh",
    category: "run",
    status: "running",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: "01-run",
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-run", name: "run", stepDir, status: "running" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "run",
    status: "running",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: null,
    summary: { workflow: "tool-nvirsh", category: "run" },
  }, null, 2)}\n`);

  const result = run(["--json", "workflow", "stop", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const workflow = JSON.parse(fs.readFileSync(path.join(runDir, "workflow.json"), "utf8"));
  const step = JSON.parse(fs.readFileSync(path.join(stepDir, "step.json"), "utf8"));
  const managed = JSON.parse(fs.readFileSync(path.join(toolRunDir, "manifest.json"), "utf8"));
  assert.equal(workflow.status, "stopped");
  assert.equal(step.status, "stopped");
  assert.equal(managed.status, "stopped");
  assert.equal(managed.signal, "SIGTERM");

  try {
    process.kill(sleeper.pid, "SIGKILL");
  } catch {}

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow stop invokes tool stop for detached managed runs whose step already succeeded", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-stop-detached-tool-"));
  const runId = "wf-stop-detached-tool-test";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-run");
  const toolRunDir = stepDir;
  fs.mkdirSync(toolRunDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");

  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  fs.writeFileSync(path.join(toolRunDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(toolRunDir, "manifest.json"), `${JSON.stringify({
    id: "nvirsh-run",
    tool: "nvirsh",
    status: "running",
    stateDir: toolRunDir,
    logFile: path.join(toolRunDir, "stdout.log"),
    manifest: path.join(toolRunDir, "manifest.json"),
    pid: sleeper.pid,
    runtime: {
      providerRun: null,
    },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-run",
    name: "run",
    tool: "nvirsh",
    status: "success",
    stepDir,
    toolRunDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "tool-nvirsh",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-run", name: "run", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:01:00.000Z",
    summary: { workflow: "tool-nvirsh", category: "run" },
  }, null, 2)}\n`);

  const result = run(["--json", "workflow", "stop", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const managed = JSON.parse(fs.readFileSync(path.join(toolRunDir, "manifest.json"), "utf8"));
  assert.equal(managed.status, "stopped");

  try {
    process.kill(sleeper.pid, "SIGKILL");
  } catch {}
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow stop reaps lingering managed tool processes even when the tool manifest already says stopped", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-stop-stopped-tool-"));
  const runId = "wf-stop-stopped-tool-test";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-run");
  const toolRunDir = stepDir;
  fs.mkdirSync(toolRunDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");

  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  fs.writeFileSync(path.join(toolRunDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(toolRunDir, "manifest.json"), `${JSON.stringify({
    id: "nvirsh-run",
    tool: "nvirsh",
    status: "stopped",
    stateDir: toolRunDir,
    logFile: path.join(toolRunDir, "stdout.log"),
    manifest: path.join(toolRunDir, "manifest.json"),
    pid: sleeper.pid,
    runtime: {
      providerRun: null,
    },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-run",
    name: "run",
    tool: "nvirsh",
    status: "success",
    stepDir,
    toolRunDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "tool-nvirsh",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-run", name: "run", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:01:00.000Z",
    summary: { workflow: "tool-nvirsh", category: "run" },
  }, null, 2)}\n`);

  assert.doesNotThrow(() => process.kill(sleeper.pid, 0));

  const result = run(["--json", "workflow", "stop", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertPidInactive(sleeper.pid);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow remove requires a prior stop and removes stopped workflow state", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-remove-"));
  const runId = "wf-remove-test";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-run");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-run",
    name: "run",
    status: "running",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "tool-nvirsh",
    category: "run",
    status: "running",
    createdAt: "2026-04-29T08:00:00.000Z",
    updatedAt: "2026-04-29T08:00:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: "01-run",
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-run", name: "run", stepDir, status: "running" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "run",
    status: "running",
    createdAt: "2026-04-29T08:00:00.000Z",
    completedAt: null,
    summary: { workflow: "tool-nvirsh", category: "run" },
  }, null, 2)}\n`);

  const rejected = run(["--json", "workflow", "remove", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);

  const stopped = run(["--json", "workflow", "stop", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);

  const removed = run(["--json", "workflow", "remove", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.equal(fs.existsSync(runDir), false);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow remove stops lingering managed tool processes before deleting the run", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-remove-stop-tool-"));
  const runId = "wf-remove-stop-tool-test";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-run");
  const toolRunDir = stepDir;
  fs.mkdirSync(toolRunDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");

  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  fs.writeFileSync(path.join(toolRunDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(toolRunDir, "manifest.json"), `${JSON.stringify({
    id: "nvirsh-run",
    tool: "nvirsh",
    status: "stopped",
    stateDir: toolRunDir,
    logFile: path.join(toolRunDir, "stdout.log"),
    manifest: path.join(toolRunDir, "manifest.json"),
    pid: sleeper.pid,
    runtime: {
      providerRun: null,
    },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-run",
    name: "run",
    tool: "nvirsh",
    status: "success",
    stepDir,
    toolRunDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "tool-nvirsh",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-29T08:00:00.000Z",
    updatedAt: "2026-04-29T08:00:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-run", name: "run", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-29T08:00:00.000Z",
    completedAt: "2026-04-29T08:01:00.000Z",
    summary: { workflow: "tool-nvirsh", category: "run" },
  }, null, 2)}\n`);

  assert.doesNotThrow(() => process.kill(sleeper.pid, 0));

  const removed = run(["--json", "workflow", "remove", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.equal(fs.existsSync(runDir), false);
  assertPidInactive(sleeper.pid);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("tool exec removes an active conflicting workspace-scoped runtime before launch", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-run-guard-project-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const stateDir = path.join(workspaceRoot, "tmp", "nvirsh", "existing");
  const depsDir = path.join(projectRoot, "deps");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(depsDir, { recursive: true });
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workspace",
      ""
    ].join("\n")
  );

  const holder = spawn("sleep", ["300"], {
    detached: true,
    stdio: "ignore",
  });
  holder.unref();
  assert.doesNotThrow(() => process.kill(holder.pid, 0));
  spawnSync("bash", ["-lc", "sleep 0.1"]);
  assert.doesNotThrow(() => process.kill(holder.pid, 0));

  fs.writeFileSync(path.join(stateDir, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    tool: "nvirsh",
    id: "existing",
    name: "existing",
    target: "sel4",
    command: "run",
    status: "running",
    stateDir,
    manifest: path.join(stateDir, "manifest.json"),
    runGuard: {
      scope: "workspace",
      tool: "nvirsh",
      key: "sel4:qemu",
    },
    runtime: {
      provider: {
        tool: "libvmm",
        action: "qemu",
      },
    },
    pid: holder.pid,
  }, null, 2)}\n`);

  const qemu = path.join(depsDir, "qemu-system-aarch64");
  const microkitSdk = path.join(depsDir, "microkit-sdk");
  const toolchain = path.join(depsDir, "arm-toolchain");
  const libvmmDir = path.join(depsDir, "libvmm");
  const kernel = path.join(projectRoot, "Image");
  const initrd = path.join(projectRoot, "rootfs.cpio.gz");
  fs.writeFileSync(qemu, "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
  for (const dir of [microkitSdk, toolchain, libvmmDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(kernel, "kernel");
  fs.writeFileSync(initrd, "initrd");

  const result = run([
    "--json",
    "exec",
    "--tool",
    "nvirsh",
    "--workspace",
    workspaceRoot,
    "--name",
    "sel4-dev",
    "--target",
    "sel4",
    "--qemu",
    qemu,
    "--microkit-sdk",
    microkitSdk,
    "--toolchain",
    toolchain,
    "--libvmm-dir",
    libvmmDir,
    "--kernel",
    kernel,
    "--initrd",
    initrd,
    "--detach",
  ], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  assert.equal(fs.existsSync(stateDir), false);

  process.kill(holder.pid, "SIGKILL");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool exec surfaces detached nvirsh startup failures", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-nvirsh-run-fails-fast-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const depsDir = path.join(projectRoot, "deps");
  fs.mkdirSync(depsDir, { recursive: true });

  const qemu = path.join(depsDir, "qemu-system-aarch64");
  const microkitSdk = path.join(depsDir, "microkit-sdk");
  const toolchain = path.join(depsDir, "arm-toolchain");
  const libvmmDir = path.join(depsDir, "libvmm");
  const kernel = path.join(projectRoot, "Image");
  const initrd = path.join(projectRoot, "rootfs.cpio.gz");

  fs.writeFileSync(
    qemu,
    [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"qemu stub 1.0\"",
      "  exit 0",
      "fi",
      "echo \"qemu launch failed\" >&2",
      "exit 2",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  for (const dir of [microkitSdk, toolchain, libvmmDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(libvmmDir, "examples", "virtio"), { recursive: true });
  fs.writeFileSync(
    path.join(libvmmDir, "examples", "virtio", "Makefile"),
    [
      ".PHONY: clean qemu",
      "clean:",
      "\t@true",
      "qemu:",
      "\t$(QEMU) -machine virt",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(microkitSdk, "VERSION"), "1.4.1\n");
  fs.writeFileSync(path.join(toolchain, "VERSION"), "arm-toolchain\n");
  fs.writeFileSync(path.join(libvmmDir, "VERSION"), "libvmm-dev\n");
  fs.writeFileSync(kernel, "kernel");
  fs.writeFileSync(initrd, "initrd");

  const result = run([
    "--json",
    "exec",
    "--tool",
    "nvirsh",
    "--workspace",
    workspaceRoot,
    "--name",
    "sel4-dev",
    "--target",
    "sel4",
    "--qemu",
    qemu,
    "--microkit-sdk",
    microkitSdk,
    "--microkit-version",
    "1.4.1",
    "--toolchain",
    toolchain,
    "--libvmm-dir",
    libvmmDir,
    "--kernel",
    kernel,
    "--initrd",
    initrd,
    "--detach",
  ], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "error");
  assert.equal(payload.exit_code, 2);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow run resolves prior step artifacts in configured workflows", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-configured-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const fixtureRoot = path.join(projectRoot, "fixtures", "linux-6.18.16-arm64-clang15");
  const sourceDir = path.join(projectRoot, "fixtures", "linux-6.18.16");
  const bitcodeListPath = path.join(fixtureRoot, "bitcode_files.txt");
  const kernelBuildLogPath = path.join(fixtureRoot, "kernel-build.log");
  const llbicManifestPath = path.join(fixtureRoot, "llbic.json");
  const env = isolatedEnv();

  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(bitcodeListPath, "kernel/sched/core.bc\n");
  fs.writeFileSync(path.join(fixtureRoot, "llbic.log"), "llbic inspect fixture\n");
  fs.writeFileSync(kernelBuildLogPath, "kernel build fixture\n");
  fs.writeFileSync(
    llbicManifestPath,
    JSON.stringify({
      kernel_version: "6.18.16",
      kernel_name: "linux-6.18.16",
      arch: "arm64",
      build_layout: "out-of-tree",
      bitcode_list_file: bitcodeListPath,
      source_dir: sourceDir,
      output_dir: fixtureRoot,
      kernel_build_log: kernelBuildLogPath,
      status: "success"
    })
  );

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  llbic-artifact-resolution:",
      "    category: run",
      "    steps:",
      "      - id: inspect_a",
      "        tool: llbic",
      "        command: exec",
      `        args: ["inspect", "${llbicManifestPath}"]`,
      ""
    ].join("\n")
  );

  const result = run([
    "--json",
    "workflow",
    "run",
    "--name",
    "llbic-artifact-resolution"
  ], {
    cwd: projectRoot,
    env
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.details.steps.length, 1);
  const runDir = payload.details.run_dir;
  const events = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(events.some((entry) => entry.event === "workflow.created"), true);
  assert.equal(events.some((entry) => entry.event === "workflow.started"), true);
  assert.equal(events.some((entry) => entry.event === "step.created" && entry.step_id === "inspect_a"), true);
  assert.equal(events.some((entry) => entry.event === "step.started" && entry.step_id === "inspect_a"), true);
  assert.equal(events.some((entry) => entry.event === "step.completed" && entry.step_id === "inspect_a"), true);
  assert.equal(events.some((entry) => entry.event === "workflow.completed"), true);

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(env.MORPHEUS_WORK_ROOT, { recursive: true, force: true });
});

test("workflow run writes failure events to canonical event log", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-events-fail-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  failing-workflow:",
      "    category: build",
      "    steps:",
      "      - id: patch_missing",
      "        tool: qemu",
      "        command: patch",
      "        args:",
      "          - --source",
      `          - ${path.join(projectRoot, "missing-source")}`,
      "          - --patch-dir",
      `          - ${path.join(projectRoot, "missing-patches")}`,
      ""
    ].join("\n")
  );

  const result = run(["--json", "workflow", "run", "--name", "failing-workflow"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "error");
  const runDir = payload.details.run_dir;
  const events = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(events.some((entry) => entry.event === "step.failed" && entry.step_id === "patch_missing"), true);
  assert.equal(events.some((entry) => entry.event === "workflow.failed"), true);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow run captures tool phase events in canonical event log", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-phase-events-"));
  const sourceParent = path.join(projectRoot, "archive-src");
  const archiveSource = path.join(sourceParent, "qemu-1.0.0");
  const archivePath = path.join(projectRoot, "qemu-1.0.0.tar.xz");
  fs.mkdirSync(archiveSource, { recursive: true });
  fs.writeFileSync(
    path.join(archiveSource, "configure"),
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "prefix=\"\"",
      "for arg in \"$@\"; do",
      "  case \"$arg\" in",
      "    --prefix=*) prefix=\"${arg#--prefix=}\" ;;",
      "  esac",
      "done",
      "cat > Makefile <<MAKE",
      "all:",
      "\t@echo BUILDING",
      "install:",
      "\t@mkdir -p ${prefix}/bin",
      "\t@printf '#!/usr/bin/env sh\\necho qemu\\n' > ${prefix}/bin/qemu-system-aarch64",
      "\t@chmod +x ${prefix}/bin/qemu-system-aarch64",
      "MAKE",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const archive = spawnSync("tar", ["-cJf", archivePath, "-C", sourceParent, "qemu-1.0.0"], {
    encoding: "utf8",
  });
  assert.equal(archive.status, 0, archive.stdout || archive.stderr);

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  qemu-phase-events:",
      "    category: build",
      "    steps:",
      "      - id: fetch_qemu",
      "        tool: qemu",
      "        command: fetch",
      "        args:",
      "          - --qemu-version",
      "          - 1.0.0",
      "          - --archive-url",
      `          - ${pathToFileURL(archivePath).toString()}`,
      "      - id: build_qemu",
      "        tool: qemu",
      "        command: build",
      "        args:",
      "          - --source",
      "          - \"{{steps.fetch_qemu.artifacts.source-dir.location}}\"",
      "          - --build-dir",
      "          - ./workflow-workspace/tools/qemu/builds/test/build",
      "          - --install-dir",
      "          - ./workflow-workspace/tools/qemu/builds/test/install",
      "",
    ].join("\n")
  );

  const result = run(["--json", "workflow", "run", "--name", "qemu-phase-events"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  const events = fs.readFileSync(path.join(payload.details.run_dir, "events.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const phases = events
    .filter((entry) => entry.event === "tool.phase" && entry.step_id === "build_qemu")
    .map((entry) => entry.data && entry.data.phase);
  assert.deepEqual(phases, ["configure", "build", "install"]);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow run records outline-to-paper artifacts for downstream reuse", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-outline-to-paper-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const outlinePath = path.join(projectRoot, "fixtures", "outline.json");
  const supportPath = path.join(projectRoot, "fixtures", "support.json");
  fs.mkdirSync(path.dirname(outlinePath), { recursive: true });
  fs.writeFileSync(outlinePath, JSON.stringify({
    title: "Workflow Paper",
    claims: [{ claim_id: "c1", text: "Main claim" }],
  }));
  fs.writeFileSync(supportPath, JSON.stringify({
    supports: [{ support_id: "s1", claim_id: "c1", type: "fact", status: "available" }],
  }));

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  outline-paper:",
      "    category: run",
      "    steps:",
      "      - id: outline_to_paper",
      "        tool: outline-to-paper",
      "        command: exec",
      "        args:",
      "          - --outline",
      `          - ${outlinePath}`,
      "          - --support",
      `          - ${supportPath}`,
      "          - --template",
      "          - acsac26",
      ""
    ].join("\n")
  );

  const result = run(["--json", "workflow", "run", "--name", "outline-paper"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  const runDir = payload.details.run_dir;
  const stepDir = path.join(runDir, "steps", "outline_to_paper");
  const toolResult = JSON.parse(fs.readFileSync(path.join(stepDir, "tool-result.json"), "utf8"));
  const artifacts = toolResult && toolResult.details && Array.isArray(toolResult.details.artifacts)
    ? toolResult.details.artifacts
    : [];
  assert.equal(artifacts.some((item) => item.path === "plan/section-plan.json"), true);
  assert.equal(artifacts.some((item) => item.path === "draft/paper.tex"), true);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow resume reuses workflow config path for nondefault workflow files", () => {
  const configPath = path.join(repoRoot, "morpheus.o2p.yaml");
  const first = run(["--config", configPath, "--json", "workflow", "run", "--name", "outline-paper-sample"], {
    cwd: repoRoot,
    env: isolatedEnv(),
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout.trim());
  const runId = firstPayload.details.id;

  const resumed = run(["--json", "workflow", "resume", "--id", runId, "--workspace", path.join(repoRoot, "workspace-o2p")], {
    cwd: repoRoot,
    env: isolatedEnv(),
  });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const resumedPayload = JSON.parse(resumed.stdout.trim());
  assert.equal(resumedPayload.status, "success");
});

test("managed remote run resolves ssh and workspace from morpheus.yaml", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-run-project-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "  remote: true",
      "remote:",
      "  ssh: builder@example.com:2222",
      "  workspace:",
      "    root: ./remote-workflow-workspace",
      ""
    ].join("\n")
  );

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "core", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "buildroot",
    mode: "remote",
    source: buildrootFixture
  }, { allowGlobalRemote: true, allowToolDefaults: true });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.workspace, "./remote-workflow-workspace");
  assert.equal(resolved.flags.ssh, "builder@example.com:2222");
  assert.equal(resolved.flags.remote, "remote");
  assert.equal(resolved.flags.remoteTarget, "remote");

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow resume reuses successful prefix in place", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-resume-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const depsDir = path.join(projectRoot, "deps");
  fs.mkdirSync(depsDir, { recursive: true });
  const qemuA = path.join(depsDir, "qemu-a");
  const qemuB = path.join(depsDir, "qemu-b");
  fs.writeFileSync(qemuA, '#!/usr/bin/env sh\necho "QEMU emulator version 1.0"\n', { mode: 0o755 });
  fs.writeFileSync(qemuB, '#!/usr/bin/env sh\necho "QEMU emulator version 1.0"\n', { mode: 0o755 });
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workspace",
      "workflows:",
      "  inspect-pair:",
      "    category: build",
      "    steps:",
      "      - id: inspect_a",
      "        tool: qemu",
      "        command: inspect",
      "        args:",
      "          - --path",
      `          - ${qemuA}`,
      "      - id: inspect_b",
      "        tool: qemu",
      "        command: inspect",
      "        args:",
      "          - --path",
      `          - ${qemuB}`,
      ""
    ].join("\n")
  );

  const first = run(["--json", "workflow", "run", "--name", "inspect-pair"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout.trim());
  const runId = firstPayload.details.id;
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepAPath = path.join(runDir, "steps", "inspect_a", "step.json");
  const stepBPath = path.join(runDir, "steps", "inspect_b", "step.json");
  const workflowPath = path.join(runDir, "workflow.json");
  const stepA = JSON.parse(fs.readFileSync(stepAPath, "utf8"));
  const stepB = JSON.parse(fs.readFileSync(stepBPath, "utf8"));
  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  workflow.status = "error";
  stepB.status = "error";
  fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
  fs.writeFileSync(stepBPath, `${JSON.stringify(stepB, null, 2)}\n`);

  const resumed = run(["--json", "workflow", "resume", "--id", runId, "--workspace", workspaceRoot], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const resumedStepA = JSON.parse(fs.readFileSync(stepAPath, "utf8"));
  const resumedWorkflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  assert.equal(resumedStepA.reuseState, "reused");
  assert.equal(resumedWorkflow.resumeCount, 1);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow run --from-step reuses earlier validated steps from latest run", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-from-step-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const depsDir = path.join(projectRoot, "deps");
  fs.mkdirSync(depsDir, { recursive: true });
  const qemuA = path.join(depsDir, "qemu-a");
  const qemuB = path.join(depsDir, "qemu-b");
  fs.writeFileSync(qemuA, '#!/usr/bin/env sh\necho "QEMU emulator version 1.0"\n', { mode: 0o755 });
  fs.writeFileSync(qemuB, '#!/usr/bin/env sh\necho "QEMU emulator version 1.0"\n', { mode: 0o755 });
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workspace",
      "workflows:",
      "  inspect-pair:",
      "    category: build",
      "    steps:",
      "      - id: inspect_a",
      "        tool: qemu",
      "        command: inspect",
      "        args:",
      "          - --path",
      `          - ${qemuA}`,
      "      - id: inspect_b",
      "        tool: qemu",
      "        command: inspect",
      "        args:",
      "          - --path",
      `          - ${qemuB}`,
      ""
    ].join("\n")
  );

  const first = run(["--json", "workflow", "run", "--name", "inspect-pair"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout.trim());
  const runId = firstPayload.details.id;
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepAPath = path.join(runDir, "steps", "inspect_a", "step.json");

  const rerun = run(["--json", "workflow", "run", "--name", "inspect-pair", "--from-step", "inspect_b"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  const stepA = JSON.parse(fs.readFileSync(stepAPath, "utf8"));
  assert.equal(stepA.reuseState, "reused");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow run --from-step resolves templated prior-step args for reuse validation", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-from-step-template-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const sourceParent = path.join(projectRoot, "archive-src");
  const archiveSource = path.join(sourceParent, "qemu-1.0.0");
  const archivePath = path.join(projectRoot, "qemu-1.0.0.tar.xz");
  const patchDir = path.join(projectRoot, "patches");
  fs.mkdirSync(archiveSource, { recursive: true });
  fs.mkdirSync(patchDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveSource, "configure"),
    [
      "#!/usr/bin/env sh",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const archive = spawnSync("tar", ["-cJf", archivePath, "-C", sourceParent, "qemu-1.0.0"], {
    encoding: "utf8",
  });
  assert.equal(archive.status, 0, archive.stdout || archive.stderr);
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workspace",
      "workflows:",
      "  inspect-template-pair:",
      "    category: build",
      "    steps:",
      "      - id: fetch_a",
      "        tool: qemu",
      "        command: fetch",
      "        args:",
      "          - --qemu-version",
      "          - 1.0.0",
      "          - --archive-url",
      `          - ${pathToFileURL(archivePath).toString()}`,
      "      - id: patch_b",
      "        tool: qemu",
      "        command: patch",
      "        args:",
      "          - --source",
      "          - \"{{steps.fetch_a.artifacts.source-dir.location}}\"",
      "          - --patch-dir",
      `          - ${patchDir}`,
      ""
    ].join("\n")
  );

  const first = run(["--json", "workflow", "run", "--name", "inspect-template-pair"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout.trim());
  const runId = firstPayload.details.id;
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepAPath = path.join(runDir, "steps", "fetch_a", "step.json");
  const eventsPath = path.join(runDir, "events.jsonl");
  const relations = fs.readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "artifact.consumed");
  assert.equal(relations.some((entry) =>
    entry.data
    && entry.data.from_step === "fetch_a"
    && entry.step_id === "patch_b"
    && entry.data.artifact_path === "source-dir"
  ), true);
  const allEvents = fs.readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const consumedIndex = allEvents.findIndex((entry) =>
    entry.event === "artifact.consumed"
    && entry.step_id === "patch_b"
    && entry.data
    && entry.data.from_step === "fetch_a",
  );
  const spawnedIndex = allEvents.findIndex((entry) =>
    entry.event === "step.process.spawned"
    && entry.step_id === "patch_b",
  );
  assert.notEqual(consumedIndex, -1);
  assert.notEqual(spawnedIndex, -1);
  assert.equal(consumedIndex < spawnedIndex, true);

  const rerun = run(["--json", "workflow", "run", "--name", "inspect-template-pair", "--from-step", "patch_b"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  const stepA = JSON.parse(fs.readFileSync(stepAPath, "utf8"));
  assert.equal(stepA.reuseState, "reused");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("explicit local tool workspace is not overridden by morpheus.yaml remote", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-tool-explicit-project-"));
  const explicitWorkspace = path.join(projectRoot, "explicit-workspace");
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "remote:",
      "  ssh: builder@example.com:2222",
      "  workspace:",
      "    root: ./remote-workflow-workspace",
      "tools:",
      "  buildroot:",
      "    mode: remote",
      ""
    ].join("\n")
  );

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "core", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "buildroot",
    mode: "local",
    workspace: explicitWorkspace,
    source: buildrootFixture
  }, { allowGlobalRemote: false, allowToolDefaults: true });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.workspace, explicitWorkspace);
  assert.equal(resolved.flags.ssh, undefined);
  assert.equal(resolved.flags.remote, undefined);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool config can make only Buildroot run remotely", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-tool-remote-project-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "remote:",
      "  ssh: builder@example.com:2222",
      "  workspace:",
      "    root: ./remote-buildroot-workspace",
      "tools:",
      "  buildroot:",
      "    mode: remote",
      ""
    ].join("\n")
  );

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "core", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "buildroot",
    source: buildrootFixture
  }, {
    allowGlobalRemote: true,
    allowToolDefaults: true
  });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.mode, "remote");
  assert.equal(resolved.flags.workspace, "./remote-buildroot-workspace");
  assert.equal(resolved.flags.ssh, "builder@example.com:2222");
  assert.equal(resolved.flags.remote, "remote");
  assert.equal(resolved.flags.remoteTarget, "remote");

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workspace show supports remote managed workspace lookup", () => {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-run-"));
  const env = {
    ...process.env,
    ...makeFakeSshEnv(remoteRoot)
  };

  const create = run([
    "workspace",
    "create",
    "--ssh",
    "builder@example.com:2222",
    "--workspace",
    "/remote-workspace",
    "--json"
  ], { env });
  assert.equal(create.status, 0, create.stderr || create.stdout);

  const show = run([
    "workspace",
    "show",
    "--ssh",
    "builder@example.com:2222",
    "--workspace",
    "/remote-workspace",
    "--json"
  ], { env });
  assert.equal(show.status, 0, show.stderr || show.stdout);
  const payload = JSON.parse(show.stdout);
  assert.equal(payload.mode, "remote");
  assert.equal(payload.directories.tools.exists, true);
  assert.equal(payload.directories.runs.exists, true);

  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("tool config can provide buildroot defaults and expected artifacts", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-defaults-project-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "remote:",
      "  ssh: builder@example.com:2222",
      "  workspace:",
      "    root: ./remote-workflow-workspace",
      "tools:",
      "  buildroot:",
      "    mode: remote",
      "    buildroot-version: 2025.02.1",
      "    patch-dir: ./workflow-workspace/tools/buildroot/patches",
      "    defconfig: qemu_aarch64_virt_defconfig",
      "    make-args:",
      "      - -j16",
      "    config-fragment:",
      "      - BR2_TOOLCHAIN_BUILDROOT_GLIBC=y",
      "      - BR2_TARGET_GENERIC_GETTY_PORT=\"ttyAMA0\"",
      "    artifacts:",
      "      - images/Image",
      "      - images/rootfs.cpio.gz",
      ""
    ].join("\n")
  );

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "core", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "buildroot"
  }, {
    allowGlobalRemote: true,
    allowToolDefaults: true
  });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.mode, "remote");
  assert.deepEqual(resolved.flags.artifacts, ["images/Image", "images/rootfs.cpio.gz"]);
  assert.equal(resolved.flags.defconfig, "qemu_aarch64_virt_defconfig");
  assert.deepEqual(resolved.flags["config-fragment"], [
    "BR2_TOOLCHAIN_BUILDROOT_GLIBC=y",
    "BR2_TARGET_GENERIC_GETTY_PORT=\"ttyAMA0\""
  ]);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool config resolves managed buildroot patch-dir relative to workspace root", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-workspace-paths-project-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  buildroot:",
      "    patch-dir: tools/buildroot/patches",
      ""
    ].join("\n")
  );

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "core", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "buildroot"
  }, {
    allowGlobalRemote: false,
    allowToolDefaults: true
  });
  process.chdir(previousCwd);

  assert.equal(
    resolved.flags["patch-dir"],
    path.join(projectRoot, "workflow-workspace", "tools", "buildroot", "patches")
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
});
