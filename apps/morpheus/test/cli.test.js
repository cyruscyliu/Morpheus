const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const bin = path.join(appRoot, "dist", "cli.js");
const buildrootFixture = path.join(repoRoot, "tools", "buildroot", "test", "fixtures", "minimal-buildroot");
const { applyConfigDefaults } = require("../dist/core/config.js");
const { effectiveBuildDirKey } = require("../dist/transport/remote.js");

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
    ["buildroot", "libvmm", "llbic", "llcg", "microkit-sdk", "nvirsh", "qemu", "sel4"]
  );
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

test("tool run removes an active conflicting workspace-scoped runtime before launch", () => {
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
    "run",
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
      "        command: run",
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

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(env.MORPHEUS_WORK_ROOT, { recursive: true, force: true });
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
