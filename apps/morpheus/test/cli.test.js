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
const buildrootFixture = path.join(repoRoot, "tools", "buildroot", "tests", "fixtures", "minimal-buildroot");
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
  const env = isolatedEnv();
  const result = run(["workspace", "show", "--json"], {
    cwd: projectRoot,
    env
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "workspace show");
  assert.equal(payload.status, "success");
  assert.equal(payload.details.root, path.relative(projectRoot, env.MORPHEUS_WORK_ROOT));
  assert.equal(typeof payload.details.directories.runs.exists, "boolean");
  assert.equal(payload.details.directories.tools.path, path.relative(projectRoot, path.join(env.MORPHEUS_WORK_ROOT, "tools")));
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workspace show prints a human-readable summary in text mode", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-show-text-"));
  const result = run(["workspace", "show"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Workspace$/m);
  assert.match(result.stdout, /^  mode: local$/m);
  assert.match(result.stdout, /^  status: managed workspace not created yet$/m);
  assert.match(result.stdout, /^  tools: .* \(missing\)$/m);
  assert.match(result.stdout, /^  runs: .* \(missing\)$/m);
  assert.match(result.stdout, /^  tmp: .* \(missing\)$/m);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workspace show does not warn when config is discovered implicitly", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-show-implicit-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );

  const result = run(["workspace", "show"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
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
      "  qemu:",
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

test("config check prints a human-readable success summary", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-check-text-ok-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  buildroot:",
      "    mode: remote",
      ""
    ].join("\n")
  );

  const result = run(["config", "check"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Config check$/m);
  assert.match(result.stdout, /^  config: morpheus\.yaml$/m);
  assert.match(result.stdout, /^  status: ok$/m);
  assert.match(result.stdout, /^  summary: morpheus\.yaml passed validation$/m);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("config check warns on workflows that hardcode run dirs", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-check-warn-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  sample-run:",
      "    category: run",
      "    steps:",
      "      - tool: nvirsh",
      "        command: exec",
      "        args:",
      "          - --run-dir",
      "          - ./runs/nvirsh",
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
  assert.ok(payload.details.issues.some((issue) => issue.level === "warn" && issue.path.includes("workflows.sample-run")));
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

test("config check prints human-readable issues on failure", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-check-text-bad-"));
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

  const result = run(["config", "check"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /^Config check$/m);
  assert.match(result.stdout, /^  status: error$/m);
  assert.match(result.stdout, /^Issues:$/m);
  assert.match(result.stdout, /^  error: tools\.qemu\.mode: invalid mode 'build', expected one of: local, remote$/m);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool list discovers repo-local tools", () => {
  const result = run(["tool", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "tool list");
  assert.equal(payload.status, "success");
  assert.equal(typeof payload.details.tool_statuses.ready, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "tools"), false);
  assert.deepEqual(
    payload.details.tools.map((tool) => tool.name),
    ["buildroot", "libafl", "libvmm", "llbase", "llbic", "llcg", "microkit-sdk", "nqc2", "nvirsh", "outline-to-paper", "pkvm-aarch64", "qemu", "sel4"]
  );
});

test("tool list reports workflow-only tools without wrapper errors", () => {
  const result = run(["tool", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const buildroot = payload.details.tools.find((tool) => tool.name === "buildroot");
  const llbase = payload.details.tools.find((tool) => tool.name === "llbase");
  const llcg = payload.details.tools.find((tool) => tool.name === "llcg");
  const nvirsh = payload.details.tools.find((tool) => tool.name === "nvirsh");
  assert.equal(buildroot.verification.status, "workflow-only");
  assert.equal(buildroot.verification.note, "run through 'morpheus workflow run'");
  assert.deepEqual(buildroot.verification.issues, []);
  assert.equal(llbase.verification.status, "workflow-only");
  assert.equal(llbase.verification.note, "run through 'morpheus workflow run'");
  assert.deepEqual(llbase.verification.issues, []);
  assert.equal(llcg.verification.status, "workflow-only");
  assert.equal(llcg.verification.note, "run through 'morpheus workflow run'");
  assert.deepEqual(llcg.verification.issues, []);
  assert.equal(nvirsh.verification.status, "workflow-only");
  assert.equal(nvirsh.verification.note, "run through 'morpheus workflow run'");
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

test("workflow imports resolve root morpheus.yaml relative to the selected config file", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-root-import-"));
  const projectConfigDir = path.join(projectRoot, "projects", "hyperarm");
  fs.mkdirSync(projectConfigDir, { recursive: true });
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  nvirsh-arm64-build:",
      "    category: build",
      "    steps:",
      "      - tool: qemu",
      "        command: build",
      ""
    ].join("\n")
  );
  writeConfig(
    projectConfigDir,
    [
      "workspace:",
      "  root: ./workspace",
      "imports:",
      "  workflows:",
      "    - root.nvirsh-arm64-build",
      ""
    ].join("\n")
  );

  const result = run(["--config", path.join(projectConfigDir, "morpheus.yaml"), "workflow", "list", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.details.workflows.map((workflow) => workflow.name),
    ["nvirsh-arm64-build"],
  );
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow imports from generated project configs skip the project config", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-temp-import-"));
  const projectConfigDir = path.join(projectRoot, "projects", "hyperarm");
  const generatedConfigDir = path.join(projectConfigDir, "workspace", "tmp");
  fs.mkdirSync(generatedConfigDir, { recursive: true });
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  nvirsh-arm64-build:",
      "    category: build",
      "    steps:",
      "      - tool: qemu",
      "        command: build",
      ""
    ].join("\n")
  );
  writeConfig(
    projectConfigDir,
    [
      "workspace:",
      "  root: ./workspace",
      "imports:",
      "  workflows:",
      "    - root.nvirsh-arm64-build",
      ""
    ].join("\n")
  );
  const generatedConfig = path.join(generatedConfigDir, "libafl-fuzzing.yaml");
  fs.writeFileSync(
    generatedConfig,
    [
      "workspace:",
      "  root: ./workspace",
      "imports:",
      "  workflows:",
      "    - root.nvirsh-arm64-build",
      ""
    ].join("\n")
  );

  const result = run(["--config", generatedConfig, "workflow", "list", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.details.workflows.map((workflow) => workflow.name),
    ["nvirsh-arm64-build"],
  );
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("config check does not warn when config is discovered implicitly", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-implicit-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );

  const result = run(["config", "check"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("config-aware commands warn when config is discovered implicitly", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-warning-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );

  const result = run(["config", "check", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /warning: using implicitly discovered config/);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow commands are available through Morpheus", () => {
  const result = run(["workflow", "--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Purpose:$/m);
  assert.match(result.stdout, /^Commands:$/m);
  assert.match(result.stdout, /workflow list/);
  assert.match(result.stdout, /workflow runs/);
  assert.match(result.stdout, /workflow run/);
  assert.match(result.stdout, /workflow inspect/);
  assert.match(result.stdout, /workflow events/);
  assert.match(result.stdout, /workflow stop/);
  assert.match(result.stdout, /workflow remove/);
});

test("top-level help groups commands for discovery", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Commands:$/m);
  assert.match(result.stdout, /^  workspace create   Create a managed workspace layout\.$/m);
  assert.match(result.stdout, /^  tool list          List declared tools and their readiness\.$/m);
  assert.match(result.stdout, /^  workflow run       Start a configured workflow\.$/m);
  assert.match(result.stdout, /^Examples:$/m);
  assert.match(result.stdout, /^  \.\/bin\/morpheus workspace show$/m);
});

test("workspace help includes commands and examples", () => {
  const result = run(["workspace", "--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Purpose:$/m);
  assert.match(result.stdout, /^Commands:$/m);
  assert.match(result.stdout, /^  workspace create   Create local or remote managed workspace directories\.$/m);
  assert.match(result.stdout, /^Examples:$/m);
  assert.match(result.stdout, /^  \.\/bin\/morpheus workspace show$/m);
});

test("config help includes purpose and examples", () => {
  const result = run(["config", "--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Purpose:$/m);
  assert.match(result.stdout, /^Commands:$/m);
  assert.match(result.stdout, /^  Validate morpheus\.yaml and report config issues before running workflows\.$/m);
  assert.match(result.stdout, /^Examples:$/m);
});

test("tool help includes purpose and examples", () => {
  const result = run(["tool", "--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Purpose:$/m);
  assert.match(result.stdout, /^Commands:$/m);
  assert.match(result.stdout, /^  Inspect declared tools and whether Morpheus can use them directly or through workflows\.$/m);
  assert.match(result.stdout, /^Examples:$/m);
});

test("workflow list discovers configured workflows in json", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-list-json-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  sample-build:",
      "    category: build",
      "    steps:",
      "      - tool: qemu",
      "        command: build",
      "  sample-run:",
      "    steps:",
      "      - tool: qemu",
      "        command: exec",
      ""
    ].join("\n")
  );

  const result = run(["workflow", "list", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "workflow list");
  assert.equal(payload.status, "success");
  assert.deepEqual(
    payload.details.workflows.map((workflow) => workflow.name),
    ["sample-build", "sample-run"]
  );
  assert.equal(payload.details.workflows[0].category, "build");
  assert.equal(payload.details.workflows[0].steps, 1);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow list prints a text table for configured workflows", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-list-text-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "workflows:",
      "  alpha:",
      "    steps:",
      "      - tool: qemu",
      "        command: exec",
      ""
    ].join("\n")
  );

  const result = run(["workflow", "list"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^name\tcategory\tsteps\tconfig/m);
  assert.match(result.stdout, /^alpha\trun\t1\tmorpheus\.yaml$/m);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow run missing configured workflow suggests workflow list", () => {
  const result = run(["workflow", "run", "--name", "missing-workflow"], {
    cwd: repoRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown configured workflow: missing-workflow/);
  assert.match(result.stderr, /morpheus workflow list/);
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
  assert.equal(payload.details.run_dir, path.join("runs", runId));
  const workflow = JSON.parse(fs.readFileSync(path.join(runDir, "workflow.json"), "utf8"));
  const step = JSON.parse(fs.readFileSync(path.join(stepDir, "step.json"), "utf8"));
  assert.equal(workflow.status, "stopped");
  assert.equal(step.status, "stopped");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow stop prints a human-readable summary in text mode", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-stop-text-"));
  const runId = "wf-stop-text";
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
    workflow: "qemu-build",
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
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);

  const result = run(["workflow", "stop", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^stopped workflow run$/m);
  assert.match(result.stdout, /^Run ID: wf-stop-text$/m);
  assert.match(result.stdout, /^Workflow: qemu-build$/m);
  assert.match(result.stdout, /^Status: stopped$/m);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow inspect reconciles stale running workflows with dead pids", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-stale-"));
  const runId = "wf-stale-test";
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
    exitCode: null,
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
    currentChildPid: 999999,
    runnerPid: 999998,
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
  fs.writeFileSync(path.join(runDir, "events.jsonl"), "", "utf8");

  const result = run(["--json", "workflow", "inspect", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.command, "workflow inspect");
  assert.equal(payload.details.id, runId);
  assert.equal(payload.details.status, "error");
  assert.equal(payload.details.runDir, path.join("runs", runId));
  assert.equal(payload.details.workflowName, "tool-buildroot");
  assert.equal(payload.details.graph.nodes.length, 1);
  assert.equal(payload.details.steps[0].status, "error");
  assert.equal(payload.details.steps[0].name, "build");

  const workflow = JSON.parse(fs.readFileSync(path.join(runDir, "workflow.json"), "utf8"));
  const step = JSON.parse(fs.readFileSync(path.join(stepDir, "step.json"), "utf8"));
  const legacy = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
  assert.equal(workflow.status, "error");
  assert.equal(step.status, "error");
  assert.equal(legacy.status, "error");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow runs lists managed workflow runs in json", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-runs-json-"));
  const runId = "wf-runs-json";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-build");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "ok\n", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-build",
    name: "build",
    status: "success",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
    artifacts: [{ path: "out", location: path.join(stepDir, "artifacts", "out") }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-build", name: "build", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);

  const result = run(["workflow", "runs", "--workspace", workspaceRoot, "--json"], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "workflow runs");
  assert.equal(payload.details.total, 1);
  assert.equal(payload.details.runs[0].id, runId);
  assert.equal(payload.details.runs[0].workflowName, "qemu-build");
  assert.equal(payload.details.runs[0].stepCount, 1);
  assert.ok(!("graph" in payload.details.runs[0]));
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow events returns canonical event records in json", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-events-json-"));
  const runId = "wf-events-json";
  const runDir = path.join(workspaceRoot, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    steps: [],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "events.jsonl"), [
    JSON.stringify({
      ts: "2026-04-26T12:01:00.000Z",
      producer: "morpheus",
      level: "info",
      scope: "workflow",
      event: "workflow.started",
      workflow_id: runId,
      step_id: null,
      tool: null,
      data: { message: "started" },
    }),
  ].join("\n") + "\n");

  const result = run(["workflow", "events", "--id", runId, "--workspace", workspaceRoot, "--json"], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "workflow events");
  assert.equal(payload.details.id, runId);
  assert.equal(payload.details.events.length, 1);
  assert.equal(payload.details.events[0].event, "workflow.started");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow inspect missing run suggests valid follow-up commands", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-missing-run-"));
  const result = run(["workflow", "inspect", "--id", "missing-run", "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /workflow run not found: missing-run/);
  assert.match(result.stderr, /morpheus workflow list/);
  assert.match(result.stderr, /morpheus workflow inspect --id <run-id>/);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow logs json reports log paths relative to cwd", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-logs-json-"));
  const runId = "wf-logs-json";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-fetch");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "fetch log\n", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-fetch",
    name: "fetch",
    status: "success",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-fetch", name: "fetch", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);

  const result = run(["workflow", "logs", "--id", runId, "--workspace", workspaceRoot, "--json"], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "workflow logs");
  assert.equal(payload.details.log_file, path.join("runs", runId, "steps", "01-fetch", "stdout.log"));
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow inspect prints a human-readable summary in text mode", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-inspect-text-"));
  const runId = "wf-inspect-text";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-build");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-build",
    name: "build",
    status: "success",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-build", name: "build", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);

  const result = run(["workflow", "inspect", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Workflow: qemu-build$/m);
  assert.match(result.stdout, /^Run ID: wf-inspect-text$/m);
  assert.match(result.stdout, /^Status: success$/m);
  assert.match(result.stdout, /^Current Step: -$/m);
  assert.match(result.stdout, /^id\tstatus\tname$/m);
  assert.match(result.stdout, /^01-build\tsuccess\tbuild$/m);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow inspect does not warn when config is discovered implicitly", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-inspect-implicit-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const runId = "wf-inspect-implicit";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-build");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-build",
    name: "build",
    status: "success",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-build", name: "build", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);

  const result = run(["workflow", "inspect", "--id", runId], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow logs announces the selected default step in text mode", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-logs-text-"));
  const runId = "wf-logs-text";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDirA = path.join(runDir, "steps", "01-fetch");
  const stepDirB = path.join(runDir, "steps", "02-build");
  fs.mkdirSync(stepDirA, { recursive: true });
  fs.mkdirSync(stepDirB, { recursive: true });
  fs.writeFileSync(path.join(stepDirA, "stdout.log"), "fetch log\n", "utf8");
  fs.writeFileSync(path.join(stepDirB, "stdout.log"), "build log\n", "utf8");
  fs.writeFileSync(path.join(stepDirA, "step.json"), `${JSON.stringify({
    id: "01-fetch",
    name: "fetch",
    status: "success",
    stepDir: stepDirA,
    logFile: path.join(stepDirA, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(stepDirB, "step.json"), `${JSON.stringify({
    id: "02-build",
    name: "build",
    status: "success",
    stepDir: stepDirB,
    logFile: path.join(stepDirB, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [
      { id: "01-fetch", name: "fetch", stepDir: stepDirA, status: "success" },
      { id: "02-build", name: "build", stepDir: stepDirB, status: "success" }
    ],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);

  const result = run(["workflow", "logs", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Selected step: 01-fetch$/m);
  assert.match(result.stdout, /^fetch log$/m);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow logs does not warn when config is discovered implicitly", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-logs-implicit-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const runId = "wf-logs-implicit";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-fetch");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "fetch log\n", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-fetch",
    name: "fetch",
    status: "success",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-fetch", name: "fetch", stepDir, status: "success" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "build",
    status: "success",
    createdAt: "2026-04-26T12:00:00.000Z",
    completedAt: "2026-04-26T12:05:00.000Z",
    summary: { workflow: "qemu-build", category: "build" },
  }, null, 2)}\n`);

  const result = run(["workflow", "logs", "--id", runId], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  fs.rmSync(projectRoot, { recursive: true, force: true });
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
    workflow: "tool-qemu",
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
    summary: { workflow: "tool-qemu", category: "run" },
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
  const removedPayload = JSON.parse(removed.stdout.trim());
  assert.equal(removedPayload.details.run_dir, path.join("runs", runId));
  assert.equal(fs.existsSync(runDir), false);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow remove prints a human-readable summary in text mode", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-remove-text-"));
  const runId = "wf-remove-text";
  const runDir = path.join(workspaceRoot, "runs", runId);
  const stepDir = path.join(runDir, "steps", "01-run");
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), "", "utf8");
  fs.writeFileSync(path.join(stepDir, "step.json"), `${JSON.stringify({
    id: "01-run",
    name: "run",
    status: "stopped",
    stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "workflow.json"), `${JSON.stringify({
    id: runId,
    workflow: "qemu-build",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-29T08:00:00.000Z",
    updatedAt: "2026-04-29T08:05:00.000Z",
    workspace: workspaceRoot,
    runDir,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: [{ id: "01-run", name: "run", stepDir, status: "stopped" }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    id: runId,
    kind: "workflow",
    category: "run",
    status: "stopped",
    createdAt: "2026-04-29T08:00:00.000Z",
    completedAt: null,
    summary: { workflow: "qemu-build", category: "run" },
  }, null, 2)}\n`);

  const result = run(["workflow", "remove", "--id", runId, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^removed workflow run$/m);
  assert.match(result.stdout, /^Run ID: wf-remove-text$/m);
  assert.match(result.stdout, /^Workflow: qemu-build$/m);
  assert.match(result.stdout, /^Status: removed$/m);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
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
      "        command: inspect",
      `        args: ["--target", "${llbicManifestPath}"]`,
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
  const runDir = path.join(projectRoot, payload.details.run_dir);
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

test("workflow run builds qemu through scripted fetch patch build steps", () => {
  const workspaceRoot = path.join(repoRoot, "workspace");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const result = run([
    "--json",
    "--config",
    path.join(repoRoot, "morpheus.yaml"),
    "workflow",
    "run",
    "--name",
    "qemu-build-ci",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.steps.length, 3);
  assert.deepEqual(
    payload.details.steps.map((step) => step.id),
    ["qemu_fetch", "qemu_patch", "qemu_build"],
  );

  const executable = path.join(
    workspaceRoot,
    "tools",
    "qemu",
    "builds",
    "default",
    "install",
    "bin",
    "qemu-system-aarch64",
  );
  assert.equal(fs.existsSync(executable), true);
  const built = spawnSync(executable, [], { encoding: "utf8" });
  assert.match(built.stdout, /trace=patched/);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow run builds buildroot through scripted fetch patch build steps", () => {
  const workspaceRoot = path.join(repoRoot, "workspace");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const result = run([
    "--json",
    "--config",
    path.join(repoRoot, "morpheus.yaml"),
    "workflow",
    "run",
    "--name",
    "buildroot-build-ci",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.steps.length, 3);
  assert.deepEqual(
    payload.details.steps.map((step) => step.id),
    ["buildroot_fetch", "buildroot_patch", "buildroot_build"],
  );

  const image = path.join(
    workspaceRoot,
    "tools",
    "buildroot",
    "builds",
    "default",
    "output",
    "images",
    "Image",
  );
  const rootfs = path.join(
    workspaceRoot,
    "tools",
    "buildroot",
    "builds",
    "default",
    "output",
    "images",
    "rootfs.cpio.gz",
  );
  assert.equal(fs.existsSync(image), true);
  assert.equal(fs.existsSync(rootfs), true);
  assert.match(fs.readFileSync(image, "utf8"), /patched fake arm64 kernel image/);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow run builds sel4 through scripted fetch patch build steps", () => {
  const workspaceRoot = path.join(repoRoot, "workspace");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const result = run([
    "--json",
    "--config",
    path.join(repoRoot, "morpheus.yaml"),
    "workflow",
    "run",
    "--name",
    "sel4-build-ci",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.steps.length, 3);
  assert.deepEqual(
    payload.details.steps.map((step) => step.id),
    ["sel4_fetch", "sel4_patch", "sel4_build"],
  );

  const versionFile = path.join(
    workspaceRoot,
    "tools",
    "sel4",
    "builds",
    "default",
    "source",
    "VERSION",
  );
  assert.equal(fs.existsSync(versionFile), true);
  assert.match(fs.readFileSync(versionFile, "utf8"), /1\.0\.1-patched/);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow run builds microkit-sdk through scripted fetch patch build steps", () => {
  const workspaceRoot = path.join(repoRoot, "workspace");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const result = run([
    "--json",
    "--config",
    path.join(repoRoot, "morpheus.yaml"),
    "workflow",
    "run",
    "--name",
    "microkit-sdk-build-ci",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.steps.length, 6);

  const generated = path.join(
    workspaceRoot,
    "tools",
    "microkit-sdk",
    "builds",
    "default",
    "install",
    "board",
    "qemu_virt_aarch64",
    "debug",
    "include",
    "kernel",
    "gen_config.h",
  );
  const toolchain = path.join(
    workspaceRoot,
    "tools",
    "microkit-sdk",
    "deps",
    "arm-gnu-toolchain-fixture",
    "bin",
    "aarch64-none-elf-gcc",
  );
  assert.equal(fs.existsSync(generated), true);
  assert.equal(fs.existsSync(toolchain), true);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workflow run builds libvmm through scripted fetch patch build steps", () => {
  const workspaceRoot = path.join(repoRoot, "workspace");
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const result = run([
    "--json",
    "--config",
    path.join(repoRoot, "morpheus.yaml"),
    "workflow",
    "run",
    "--name",
    "libvmm-build-ci",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.steps.length, 9);

  const contract = path.join(
    workspaceRoot,
    "tools",
    "libvmm",
    "builds",
    "default",
    "source",
    "runtime-contract.json",
  );
  const guest = path.join(
    workspaceRoot,
    "tools",
    "libvmm",
    "builds",
    "default",
    "source",
    "examples",
    "virtio",
    "build",
    "guest.bin",
  );
  assert.equal(fs.existsSync(contract), true);
  assert.equal(fs.existsSync(guest), true);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
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
  const runDir = path.join(projectRoot, payload.details.run_dir);
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
  const events = fs.readFileSync(path.join(projectRoot, payload.details.run_dir, "events.jsonl"), "utf8")
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
    sections: [{ heading: "Introduction", claim_ids: ["c1"] }],
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
  const runDir = path.join(projectRoot, payload.details.run_dir);
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
  const configPath = path.join(repoRoot, "projects", "o2p", "morpheus.yaml");
  const first = run(["--config", configPath, "--json", "workflow", "run", "--name", "outline-paper-sample"], {
    cwd: repoRoot,
    env: isolatedEnv(),
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout.trim());
  const runId = firstPayload.details.id;

  const resumed = run(["--json", "workflow", "resume", "--id", runId, "--workspace", path.join(repoRoot, "projects", "o2p", "workspace")], {
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

test("workflow run --only-step executes just the requested step", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-only-step-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const depsDir = path.join(projectRoot, "deps");
  fs.mkdirSync(depsDir, { recursive: true });
  const qemuA = path.join(depsDir, "qemu-a");
  const qemuB = path.join(depsDir, "qemu-b");
  const qemuC = path.join(depsDir, "qemu-c");
  for (const qemuPath of [qemuA, qemuB, qemuC]) {
    fs.writeFileSync(qemuPath, '#!/usr/bin/env sh\necho "QEMU emulator version 1.0"\n', { mode: 0o755 });
  }
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workspace",
      "workflows:",
      "  inspect-triple:",
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
      "      - id: inspect_c",
      "        tool: qemu",
      "        command: inspect",
      "        args:",
      "          - --path",
      `          - ${qemuC}`,
      ""
    ].join("\n")
  );

  const first = run(["--json", "workflow", "run", "--name", "inspect-triple"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout.trim());
  const runDir = path.join(workspaceRoot, "runs", firstPayload.details.id);
  const stepAPath = path.join(runDir, "steps", "inspect_a", "step.json");
  const stepBPath = path.join(runDir, "steps", "inspect_b", "step.json");
  const stepCLog = path.join(runDir, "steps", "inspect_c", "stdout.log");
  const stepCLogBefore = fs.statSync(stepCLog).mtimeMs;

  fs.writeFileSync(qemuB, '#!/usr/bin/env sh\necho "QEMU emulator version 2.0"\n', { mode: 0o755 });
  const rerun = run(["--json", "workflow", "run", "--name", "inspect-triple", "--only-step", "inspect_b"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  const rerunPayload = JSON.parse(rerun.stdout.trim());
  const workflow = JSON.parse(fs.readFileSync(path.join(runDir, "workflow.json"), "utf8"));
  const stepA = JSON.parse(fs.readFileSync(stepAPath, "utf8"));
  const stepB = JSON.parse(fs.readFileSync(stepBPath, "utf8"));
  const stepCStatus = workflow.steps.find((step) => step.id === "inspect_c").status;
  assert.equal(rerunPayload.details.id, firstPayload.details.id);
  assert.equal(workflow.resumeHistory.at(-1).mode, "single-step");
  assert.equal(workflow.resumeHistory.at(-1).fromStep, "inspect_b");
  assert.equal(stepA.reuseState, "reused");
  assert.equal(stepB.reuseState, "rerun");
  assert.equal(stepCStatus, "success");
  assert.equal(fs.statSync(stepCLog).mtimeMs, stepCLogBefore);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workflow run rejects removed --one-step control", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-workflow-one-step-"));
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
      ""
    ].join("\n")
  );

  const result = run(["--json", "workflow", "run", "--name", "inspect-pair", "--one-step"], {
    cwd: projectRoot,
    env: isolatedEnv(),
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.error.message, /--one-step was removed/);
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
  assert.equal(payload.command, "workspace show");
  assert.equal(payload.details.mode, "remote");
  assert.equal(payload.details.directories.tools.exists, true);
  assert.equal(payload.details.directories.runs.exists, true);

  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("workspace show prints a human-readable remote summary", () => {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-show-text-"));
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
    "/remote-workspace"
  ], { env });
  assert.equal(show.status, 0, show.stderr || show.stdout);
  assert.match(show.stdout, /^Remote workspace$/m);
  assert.match(show.stdout, /^  ssh: builder@example\.com:2222$/m);
  assert.match(show.stdout, /^  mode: remote$/m);
  assert.match(show.stdout, /^  status: managed workspace ready$/m);
  assert.match(show.stdout, /^  tools: .* \(present\)$/m);
  assert.match(show.stdout, /^  runs: .* \(present\)$/m);
  assert.match(show.stdout, /^  tmp: .* \(present\)$/m);

  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("workspace create prints a human-readable local summary", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-create-local-"));
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  const result = run([
    "workspace",
    "create",
    "--workspace",
    workspaceRoot
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Workspace created$/m);
  assert.match(result.stdout, /^  created: 4$/m);
  assert.match(result.stdout, /^  existing: 0$/m);
  assert.match(result.stdout, new RegExp(`^  root: ${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(result.stdout, /^  mode: local$/m);
  assert.match(result.stdout, /^  status: managed workspace ready$/m);
  assert.match(result.stdout, /^  tools: .* \(present\)$/m);
  assert.match(result.stdout, /^  runs: .* \(present\)$/m);
  assert.match(result.stdout, /^  tmp: .* \(present\)$/m);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workspace create prints a human-readable remote summary", () => {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-create-text-"));
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
    "/remote-workspace"
  ], { env });
  assert.equal(create.status, 0, create.stderr || create.stdout);
  assert.match(create.stdout, /^Workspace created$/m);
  assert.match(create.stdout, /^  created: 4$/m);
  assert.match(create.stdout, /^  root: \/remote-workspace$/m);
  assert.match(create.stdout, /^  ssh: builder@example\.com:2222$/m);
  assert.match(create.stdout, /^  mode: remote$/m);
  assert.match(create.stdout, /^  status: managed workspace ready$/m);
  assert.match(create.stdout, /^  tools: .* \(present\)$/m);
  assert.match(create.stdout, /^  runs: .* \(present\)$/m);
  assert.match(create.stdout, /^  tmp: .* \(present\)$/m);

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
