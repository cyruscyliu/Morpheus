const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const bin = path.join(appRoot, "dist", "cli.js");
const fixtureRuns = path.join(appRoot, "test", "fixtures", "runs");
const buildrootFixture = path.join(repoRoot, "tools", "buildroot", "test", "fixtures", "minimal-buildroot");

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
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-fake-ssh-"));
  const sshPath = path.join(fakeBin, "ssh");
  fs.writeFileSync(
    sshPath,
    `#!/usr/bin/env python3
import os
import subprocess
import sys

argv = sys.argv[1:]
while argv:
    if argv[0] == "-p":
        argv = argv[2:]
        continue
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
result = subprocess.run(["bash", "-lc", rewritten], check=False)
raise SystemExit(result.returncode)
`,
    { mode: 0o755 }
  );
  return {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`
  };
}

function makePassthroughSshEnv() {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-fake-ssh-pass-"));
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
    if argv[0] == "bash":
        argv = argv[1:]
        break
    argv = argv[1:]

if len(argv) < 2 or argv[0] != "-lc":
    print("unexpected ssh invocation", file=sys.stderr)
    raise SystemExit(1)

result = subprocess.run(["bash", "-lc", argv[1]], check=False)
raise SystemExit(result.returncode)
`,
    { mode: 0o755 }
  );
  return {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`
  };
}

test("workspace show returns JSON metadata", () => {
  const result = run(["workspace", "show", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.root, "work");
  assert.equal(typeof payload.directories.runs.exists, "boolean");
});

test("workspace create builds the standard directory layout", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-work-"));
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const result = run(["workspace", "create", "--json"], {
    env: {
      ...process.env,
      MORPHEUS_WORK_ROOT: workspaceRoot
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.created.length, 8);
  assert.equal(payload.workspace.directories.runs.exists, true);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "runs")), true);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workspace create supports explicit local managed workspaces", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-managed-"));
  const workspacePath = path.join(workspaceRoot, "local-workspace");

  const result = run(["workspace", "create", "--workspace", workspacePath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "local");
  assert.equal(payload.workspace.directories.tools.exists, true);
  assert.equal(payload.workspace.directories.runs.exists, true);
  assert.equal(fs.existsSync(path.join(workspacePath, "tools")), true);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("workspace create and show support explicit remote managed workspaces", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-project-"));
  const env = {
    ...process.env,
    ...makePassthroughSshEnv()
  };

  const create = run([
    "workspace",
    "create",
    "--ssh",
    "builder@example.com:2222",
    "--workspace",
    "./remote-workspace",
    "--json"
  ], { env, cwd: projectRoot });

  assert.equal(create.status, 0, create.stderr || create.stdout);
  const createPayload = JSON.parse(create.stdout);
  assert.equal(createPayload.mode, "remote");
  assert.equal(createPayload.ssh, "builder@example.com:2222");
  assert.equal(createPayload.workspace.directories.tools.exists, true);
  assert.equal(createPayload.workspace.directories.runs.exists, true);
  assert.equal(fs.existsSync(path.join(projectRoot, "remote-workspace", "tools")), true);

  const show = run([
    "workspace",
    "show",
    "--ssh",
    "builder@example.com:2222",
    "--workspace",
    "./remote-workspace",
    "--json"
  ], { env, cwd: projectRoot });

  assert.equal(show.status, 0, show.stderr || show.stdout);
  const showPayload = JSON.parse(show.stdout);
  assert.equal(showPayload.mode, "remote");
  assert.equal(showPayload.ssh, "builder@example.com:2222");
  assert.equal(showPayload.directories.cache.exists, true);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workspace commands resolve remote targets from morpheus.yaml", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-project-"));
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

  const env = {
    ...process.env,
    ...makePassthroughSshEnv()
  };

  const create = run([
    "workspace",
    "create",
    "--json"
  ], { env, cwd: projectRoot });

  assert.equal(create.status, 0, create.stderr || create.stdout);
  const createPayload = JSON.parse(create.stdout);
  assert.equal(createPayload.mode, "hybrid");
  assert.equal(createPayload.local.mode, "local");
  assert.equal(createPayload.remote.mode, "remote");
  assert.equal(createPayload.remote.ssh, "builder@example.com:2222");
  assert.equal(fs.existsSync(path.join(projectRoot, "workflow-workspace")), true);

  const show = run([
    "workspace",
    "show",
    "--json"
  ], { env, cwd: projectRoot });

  assert.equal(show.status, 0, show.stderr || show.stdout);
  const showPayload = JSON.parse(show.stdout);
  assert.equal(showPayload.mode, "hybrid");
  assert.equal(showPayload.local.root, path.join(projectRoot, "workflow-workspace"));
  assert.equal(showPayload.remote.root, "./remote-workflow-workspace");

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workspace create resolves workspace roots relative to morpheus.yaml", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-rel-"));
  const nested = path.join(projectRoot, "nested");
  fs.mkdirSync(nested, { recursive: true });

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );

  const env = isolatedEnv();

  const result = run(["workspace", "create", "--json"], { env, cwd: nested });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const expectedRoot = path.join(projectRoot, "workflow-workspace");
  assert.equal(payload.root, expectedRoot);
  assert.equal(fs.existsSync(expectedRoot), true);

  fs.rmSync(env.MORPHEUS_WORK_ROOT, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workspace create verbose logs resolved decisions", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-verbose-project-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      ""
    ].join("\n")
  );

  const result = run(["workspace", "create", "--json", "--verbose"], { cwd: projectRoot });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /\[morpheus:config\] resolved defaults/);
  assert.match(result.stderr, /\[morpheus:workspace\] resolved workspace command/);
  assert.match(result.stderr, /\[morpheus:state\] ensuring managed state root/);
  assert.equal(fs.existsSync(path.join(projectRoot, "work")), false);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool list discovers repo-local tools", () => {
  const result = run(["tool", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.tools.map((tool) => tool.name),
    ["buildroot", "llbic", "llcg"]
  );
});

test("runs show reads fixture run packages", () => {
  const result = run([
    "runs",
    "show",
    "sample-run",
    "--json",
    "--run-root",
    fixtureRuns
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.id, "sample-run");
  assert.equal(payload.steps.length, 1);
  assert.equal(payload.steps[0].artifactCount, 1);
});

test("workflow commands are no longer part of the app surface", () => {
  const result = run(["workflow", "list"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command: workflow/);
});

test("managed run help is available through Morpheus", () => {
  const result = run(["tool", "run", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--mode local/);
  assert.match(result.stdout, /--mode remote/);
});

test("managed run validates required mode in JSON mode", () => {
  const result = run(["--json", "tool", "run", "--tool", "buildroot"], {
    cwd: os.tmpdir(),
    env: isolatedEnv()
  });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "error");
  assert.match(payload.summary, /run requires --mode local\|remote/);
});

test("inspect validates managed run flags in JSON mode", () => {
  const result = run(["--json", "tool", "inspect"]);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "error");
  assert.match(payload.summary, /inspect requires --id RUN_ID/);
});

test("managed local Buildroot run creates a Morpheus run record", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-run-"));

  const result = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "buildroot",
    "--mode",
    "local",
    "--workspace",
    workspaceRoot,
    "--source",
    buildrootFixture,
    "--defconfig",
    "qemu_x86_64_defconfig"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.mode, "local");
  assert.equal(fs.existsSync(payload.details.manifest), true);
  assert.equal(fs.existsSync(path.join(payload.details.output_dir, "images", "smoke-rootfs.tar")), true);

  const inspect = run([
    "--json",
    "tool",
    "inspect",
    "--id",
    payload.details.id
  ]);

  assert.equal(inspect.status, 0, inspect.stderr || inspect.stdout);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.equal(inspectPayload.details.manifest.id, payload.details.id);
  assert.equal(inspectPayload.details.manifest.mode, "local");

  const list = run(["--json", "tool", "runs", "--workspace", workspaceRoot]);
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const listPayload = JSON.parse(list.stdout);
  assert.equal(listPayload.details.runs.some((item) => item.id === payload.details.id), true);

  const remove = run(["--json", "tool", "remove", "--id", payload.details.id]);
  assert.equal(remove.status, 0, remove.stderr || remove.stdout);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tools", "buildroot", "runs", payload.details.id)), false);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
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
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "config.js"));
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
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "buildroot"
  }, { allowGlobalRemote: true, allowToolDefaults: true });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.mode, "remote");
  assert.equal(resolved.flags["buildroot-version"], "2025.02.1");
  assert.equal(resolved.flags.defconfig, "qemu_aarch64_virt_defconfig");
  assert.deepEqual(resolved.flags.makeArg, ["-j16"]);
  assert.deepEqual(resolved.flags["config-fragment"], [
    "BR2_TOOLCHAIN_BUILDROOT_GLIBC=y",
    "BR2_TARGET_GENERIC_GETTY_PORT=\"ttyAMA0\""
  ]);
  assert.deepEqual(resolved.flags.artifact, ["images/Image", "images/rootfs.cpio.gz"]);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("managed remote Buildroot JSON run streams large logs without truncation", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-stream-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-stream-root-"));
  const sourceRoot = path.join(remoteRoot, "tools", "buildroot", "src", "buildroot-2025.02.1");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, "Makefile"),
    [
      ".DEFAULT_GOAL := all",
      "",
      "qemu_aarch64_virt_defconfig:",
      "\t@mkdir -p $(O) $(O)/images",
      "\t@printf 'BR2_aarch64=y\\n' > $(O)/.config",
      "",
      "olddefconfig:",
      "\t@mkdir -p $(O) $(O)/images",
      "",
      "all:",
      "\t@mkdir -p $(O)/images",
      "\t@i=1; while [ $$i -le 25000 ]; do echo \"stream line $$i from fake remote build\"; i=`expr $$i + 1`; done",
      "\t@printf 'kernel' > $(O)/images/Image",
      "\t@gzip -nc $(O)/images/Image > $(O)/images/rootfs.cpio.gz",
      ""
    ].join("\n")
  );

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "remote:",
      "  ssh: builder@example.com:2222",
      "  workspace:",
      "    root: /remote-workspace",
      "tools:",
      "  buildroot:",
      "    mode: remote",
      "    buildroot-version: 2025.02.1",
      "    defconfig: qemu_aarch64_virt_defconfig",
      "    artifacts:",
      "      - images/Image",
      "      - images/rootfs.cpio.gz",
      ""
    ].join("\n")
  );

  const env = {
    ...process.env,
    ...makeFakeSshEnv(remoteRoot)
  };

  const result = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "buildroot"
  ], { env, cwd: projectRoot, maxBuffer: 1024 * 1024 * 64 });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.ok(lines.length > 1000);
  const payload = JSON.parse(lines.at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.artifacts.length, 2);
  assert.equal(payload.details.id.startsWith("buildroot-"), true);
  assert.match(lines[0], /"status":"stream"/);

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("managed remote Buildroot run can fetch configured artifacts back locally", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-artifacts-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-artifacts-root-"));
  const seededSourceRoot = path.join(
    remoteRoot,
    "tools",
    "buildroot",
    "src",
    "buildroot-2025.02.1"
  );
  fs.mkdirSync(path.dirname(seededSourceRoot), { recursive: true });
  fs.cpSync(buildrootFixture, seededSourceRoot, { recursive: true });

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "remote:",
      "  ssh: builder@example.com:2222",
      "  workspace:",
      "    root: /remote-workspace",
      "tools:",
      "  buildroot:",
      "    mode: remote",
      "    buildroot-version: 2025.02.1",
      "    defconfig: qemu_aarch64_virt_defconfig",
      "    config-fragment:",
      "      - BR2_TOOLCHAIN_BUILDROOT_GLIBC=y",
      "      - BR2_TARGET_GENERIC_GETTY_PORT=\"ttyAMA0\"",
      "    artifacts:",
      "      - images/Image",
      "      - images/rootfs.cpio.gz",
      ""
    ].join("\n")
  );

  const env = {
    ...process.env,
    ...makeFakeSshEnv(remoteRoot)
  };

  const result = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "buildroot"
  ], { env, cwd: projectRoot });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.mode, "remote");
  assert.equal(payload.details.artifacts.length, 2);
  assert.equal(
    fs.existsSync(path.join(projectRoot, "workflow-workspace", "tools", "buildroot", "runs", payload.details.id, "artifacts", "images", "Image")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "workflow-workspace", "tools", "buildroot", "runs", payload.details.id, "artifacts", "images", "rootfs.cpio.gz")),
    true
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("explicit local tool workspace is not overridden by morpheus.yaml remote", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-config-local-project-"));
  const explicitWorkspace = path.join(projectRoot, "local-workspace");
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
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "config.js"));
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

  const create = run([
    "workspace",
    "create",
    "--json"
  ], { cwd: projectRoot });

  assert.equal(create.status, 0, create.stderr || create.stdout);
  const createPayload = JSON.parse(create.stdout);
  assert.equal(createPayload.mode, "local");

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "config.js"));
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
  assert.equal(payload.directories.sources.exists, true);

  fs.rmSync(remoteRoot, { recursive: true, force: true });
});
