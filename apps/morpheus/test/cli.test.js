const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  effectiveBuildrootConfigFragment,
  kernelPatchFingerprint,
  listKernelPatchFiles,
  copyPatchTreeWithoutKernelPatches,
  ensurePatchedKernelTarballHashes,
  effectiveBuildDirKey
} = require("../dist/remote.js");

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
    MORPHEUS_SSH_BIN: sshPath
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
    if len(argv) == 1:
        result = subprocess.run(
            ["bash", "-lc", argv[0]],
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

result = subprocess.run(
    ["bash", "-lc", argv[1]],
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
    MORPHEUS_SSH_BIN: sshPath
  };
}

function makeEmptyPsEnv() {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-fake-ps-"));
  const psPath = path.join(fakeBin, "ps");
  fs.writeFileSync(
    psPath,
    "#!/usr/bin/env sh\nexit 0\n",
    { mode: 0o755 }
  );
  return {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`
  };
}

function makeFakeCurlEnv(hashLines) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-fake-curl-"));
  const curlPath = path.join(fakeBin, "curl");
  fs.writeFileSync(
    curlPath,
    `#!/usr/bin/env sh
cat <<'EOF'
${hashLines.join("\n")}
EOF
`,
    { mode: 0o755 }
  );
  return {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`
  };
}

test("kernel patch helpers keep linux hashes but move linux patches out of global patching", () => {
  const patchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-kernel-patches-"));
  const globalRoot = path.join(patchRoot, "..", `${path.basename(patchRoot)}-global`);
  fs.mkdirSync(path.join(patchRoot, "linux"), { recursive: true });
  fs.mkdirSync(path.join(patchRoot, "linux-headers"), { recursive: true });
  fs.mkdirSync(path.join(patchRoot, "busybox"), { recursive: true });
  fs.writeFileSync(path.join(patchRoot, "linux", "0001-demo.patch"), "diff --git a/a b/a\n");
  fs.writeFileSync(path.join(patchRoot, "linux", "linux.hash"), "sha256  deadbeef  linux-6.18.16.tar.xz\n");
  fs.writeFileSync(path.join(patchRoot, "linux-headers", "linux-headers.hash"), "sha256  deadbeef  linux-6.18.16.tar.xz\n");
  fs.writeFileSync(path.join(patchRoot, "busybox", "0001-busybox.patch"), "diff --git a/a b/a\n");

  assert.deepEqual(
    listKernelPatchFiles(patchRoot).map((filePath) => path.relative(patchRoot, filePath)),
    ["linux/0001-demo.patch"]
  );

  copyPatchTreeWithoutKernelPatches(patchRoot, globalRoot);
  assert.equal(fs.existsSync(path.join(globalRoot, "linux", "0001-demo.patch")), false);
  assert.equal(fs.existsSync(path.join(globalRoot, "linux", "linux.hash")), true);
  assert.equal(fs.existsSync(path.join(globalRoot, "linux-headers", "linux-headers.hash")), true);
  assert.equal(fs.existsSync(path.join(globalRoot, "busybox", "0001-busybox.patch")), true);

  fs.rmSync(patchRoot, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
});

test("effective Buildroot config switches patched kernels to a custom tarball", () => {
  const fragment = effectiveBuildrootConfigFragment([
    "BR2_LINUX_KERNEL_CUSTOM_VERSION=y",
    "BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE=\"6.18.16\"",
    "BR2_TARGET_ROOTFS_CPIO_GZIP=y"
  ], {
    globalPatchDir: "/remote/patches-global",
    kernelTarballLocation: "file:///remote/linux-6.18.16-patched.tar.xz"
  });

  assert.equal(fragment.includes("BR2_LINUX_KERNEL_CUSTOM_VERSION=y"), false);
  assert.equal(fragment.includes("BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE=\"6.18.16\""), false);
  assert.equal(fragment.includes("BR2_LINUX_KERNEL_CUSTOM_TARBALL=y"), true);
  assert.equal(
    fragment.includes("BR2_LINUX_KERNEL_CUSTOM_TARBALL_LOCATION=\"file:///remote/linux-6.18.16-patched.tar.xz\""),
    true
  );
  assert.equal(fragment.includes("BR2_GLOBAL_PATCH_DIR=\"/remote/patches-global\""), true);
  assert.equal(fragment.includes("BR2_TARGET_ROOTFS_CPIO_GZIP=y"), true);
});

test("patched kernel tarball hashes are added to run-local linux hash files", () => {
  const patchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-patched-kernel-hashes-"));
  const tarballPath = path.join(patchRoot, "linux-6.18.16-patched.tar.xz");
  fs.mkdirSync(path.join(patchRoot, "linux"), { recursive: true });
  fs.mkdirSync(path.join(patchRoot, "linux-headers"), { recursive: true });
  fs.writeFileSync(tarballPath, "patched-kernel-tarball");

  ensurePatchedKernelTarballHashes(patchRoot, tarballPath);

  assert.match(
    fs.readFileSync(path.join(patchRoot, "linux", "linux.hash"), "utf8"),
    /linux-6\.18\.16-patched\.tar\.xz/
  );
  assert.match(
    fs.readFileSync(path.join(patchRoot, "linux-headers", "linux-headers.hash"), "utf8"),
    /linux-6\.18\.16-patched\.tar\.xz/
  );

  fs.rmSync(patchRoot, { recursive: true, force: true });
});

test("kernel patch fingerprint changes when patch contents change", () => {
  const patchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-kernel-fingerprint-"));
  fs.mkdirSync(path.join(patchRoot, "linux"), { recursive: true });
  const patchPath = path.join(patchRoot, "linux", "0001-demo.patch");
  fs.writeFileSync(patchPath, "diff --git a/a b/a\n+one\n");
  const first = kernelPatchFingerprint(patchRoot, ["linux/0001-demo.patch"]);
  fs.writeFileSync(patchPath, "diff --git a/a b/a\n+two\n");
  const second = kernelPatchFingerprint(patchRoot, ["linux/0001-demo.patch"]);

  assert.notEqual(first, second);

  fs.rmSync(patchRoot, { recursive: true, force: true });
});

test("effective build dir key defaults to default when reuse is enabled", () => {
  assert.equal(effectiveBuildDirKey({ reuseBuildDir: false, buildDirKey: null }), null);
  assert.equal(effectiveBuildDirKey({ reuseBuildDir: true, buildDirKey: null }), "default");
  assert.equal(effectiveBuildDirKey({ reuseBuildDir: true, buildDirKey: "arm64-dev" }), "arm64-dev");
});

test("workspace show returns JSON metadata", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-show-project-"));
  const result = run(["workspace", "show", "--json"], {
    cwd: projectRoot,
    env: isolatedEnv()
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.root, "string");
  assert.equal(path.basename(payload.root).startsWith("morpheus-test-work-"), true);
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
  assert.deepEqual(payload.details.allowed_tool_modes, ["local", "remote"]);

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
  assert.match(payload.details.issues[0].message, /expected one of: local, remote/);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("workspace create builds the standard directory layout", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-create-project-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-work-"));
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const result = run(["workspace", "create", "--json"], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_WORK_ROOT: workspaceRoot
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.created.length, 8);
  assert.equal(payload.workspace.directories.runs.exists, true);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "runs")), true);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
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
    ["buildroot", "libvmm", "llbic", "llcg", "microkit-sdk", "nvirsh", "qemu", "sel4"]
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
  const result = run(["tool", "build", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--mode local/);
  assert.match(result.stdout, /--mode remote/);
});

test("managed run validates required mode in JSON mode", () => {
  const result = run(["--json", "tool", "build", "--tool", "buildroot"], {
    cwd: os.tmpdir(),
    env: isolatedEnv()
  });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "error");
  assert.match(payload.summary, /run requires --mode local\|remote/);
});

test("inspect validates managed run flags in JSON mode", () => {
  const result = run(["--json", "runs", "inspect"]);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "error");
  assert.match(payload.summary, /inspect requires --id RUN_ID/);
});

test("managed local Buildroot run creates a Morpheus run record", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-run-"));
  const env = isolatedEnv();

  const result = run([
    "--json",
    "tool",
    "build",
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
  ], {
    cwd: workspaceRoot,
    env
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(payload.details.mode, "local");
  assert.equal(fs.existsSync(payload.details.manifest), true);
  assert.equal(fs.existsSync(path.join(payload.details.output_dir, "images", "smoke-rootfs.tar")), true);

  const inspect = run([
    "--json",
    "runs",
    "inspect",
    "--id",
    payload.details.id
  ], {
    cwd: workspaceRoot,
    env
  });

  assert.equal(inspect.status, 0, inspect.stderr || inspect.stdout);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.equal(inspectPayload.details.manifest.id, payload.details.id);
  assert.equal(inspectPayload.details.manifest.mode, "local");

  const list = run(["--json", "runs", "list", "--managed", "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
    env
  });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const listPayload = JSON.parse(list.stdout);
  assert.equal(listPayload.details.runs.some((item) => item.id === payload.details.id), true);

  const remove = run(["--json", "runs", "remove", "--id", payload.details.id], {
    cwd: workspaceRoot,
    env
  });
  assert.equal(remove.status, 0, remove.stderr || remove.stdout);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tools", "buildroot", "runs", payload.details.id)), false);

  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("managed local Buildroot run can reuse a persistent build directory", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-run-reuse-"));
  const env = isolatedEnv();

  const result = run([
    "--json",
    "tool",
    "build",
    "--tool",
    "buildroot",
    "--mode",
    "local",
    "--workspace",
    workspaceRoot,
    "--source",
    buildrootFixture,
    "--defconfig",
    "qemu_x86_64_defconfig",
    "--reuse-build-dir",
    "--build-dir-key",
    "dev"
  ], {
    cwd: workspaceRoot,
    env
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(
    payload.details.output_dir,
    path.join(workspaceRoot, "tools", "buildroot", "builds", "dev", "output")
  );

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

test("tool config can enable a reusable remote build directory", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-reuse-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-reuse-root-"));
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
      "    reuse-build-dir: true",
      "    build-dir-key: arm64-dev",
      "    defconfig: qemu_aarch64_virt_defconfig",
      "    artifacts:",
      "      - images/Image",
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
    "build",
    "--tool",
    "buildroot"
  ], { env, cwd: projectRoot });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(
    payload.details.output_dir,
    "/remote-workspace/tools/buildroot/builds/arm64-dev/output"
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
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
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "buildroot"
  }, { allowGlobalRemote: true, allowToolDefaults: true });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.mode, "remote");
  assert.equal(resolved.flags["buildroot-version"], "2025.02.1");
  assert.equal(
    resolved.flags["patch-dir"],
    path.join(projectRoot, "workflow-workspace", "tools", "buildroot", "patches")
  );
  assert.equal(resolved.flags.defconfig, "qemu_aarch64_virt_defconfig");
  assert.deepEqual(resolved.flags.makeArg, ["-j16"]);
  assert.deepEqual(resolved.flags["config-fragment"], [
    "BR2_TOOLCHAIN_BUILDROOT_GLIBC=y",
    "BR2_TARGET_GENERIC_GETTY_PORT=\"ttyAMA0\""
  ]);
  assert.deepEqual(resolved.flags.artifact, ["images/Image", "images/rootfs.cpio.gz"]);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool config can provide nvirsh defaults", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-nvirsh-config-project-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  qemu:",
      "    mode: local",
      "    path: ./workflow-workspace/tools/qemu/bin/qemu-system-aarch64",
      "  nvirsh:",
      "    mode: local",
      "    target: sel4",
      "    name: sel4-dev",
      "    microkit-sdk: ./deps/microkit-sdk",
      "    microkit-version: 1.4.1",
      "    toolchain: ./deps/arm-gnu-toolchain",
      "    libvmm-dir: ./deps/libvmm",
      "    sel4-dir: ./deps/seL4",
      "    sel4-version: 15.0.0",
      "    qemu-args:",
      "      - -machine",
      "      - virt",
      ""
    ].join("\n")
  );

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "nvirsh"
  }, { allowToolDefaults: true });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.mode, "local");
  assert.equal(resolved.flags.target, "sel4");
  assert.equal(resolved.flags.name, "sel4-dev");
  assert.equal(resolved.flags["microkit-version"], "1.4.1");
  assert.equal(resolved.flags["sel4-version"], "15.0.0");
  assert.deepEqual(resolved.flags["qemu-arg"], ["-machine", "virt"]);

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("tool config can provide qemu defaults", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-config-project-"));
  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  qemu:",
      "    mode: local",
      "    path: ./workflow-workspace/tools/qemu/bin/qemu-system-aarch64",
      ""
    ].join("\n")
  );

  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  const { applyConfigDefaults } = require(path.join(appRoot, "dist", "config.js"));
  const resolved = applyConfigDefaults({
    tool: "qemu"
  }, { allowToolDefaults: true });
  process.chdir(previousCwd);

  assert.equal(resolved.flags.mode, "local");
  assert.equal(
    resolved.flags.path,
    path.join(projectRoot, "workflow-workspace", "tools", "qemu", "bin", "qemu-system-aarch64")
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("managed qemu run registers a local executable artifact", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-project-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const qemuPath = path.join(workspaceRoot, "tools", "qemu", "bin", "qemu-system-aarch64");
  fs.mkdirSync(path.dirname(qemuPath), { recursive: true });
  fs.writeFileSync(
    qemuPath,
    [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"qemu stub 1.0\"",
      "  exit 0",
      "fi",
      "exit 0",
      ""
    ].join("\n"),
    { mode: 0o755 }
  );

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  qemu:",
      "    mode: local",
      "    path: ./workflow-workspace/tools/qemu/bin/qemu-system-aarch64",
      ""
    ].join("\n")
  );

  const result = run([
    "--json",
    "tool",
    "build",
    "--tool",
    "qemu"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.details.tool, "qemu");
  assert.equal(payload.details.manifest.artifacts[0].path, "qemu-system-aarch64");

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("managed microkit-sdk run registers a local sdk artifact", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-microkit-project-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const sdkPath = path.join(workspaceRoot, "tools", "microkit-sdk", "sdk");
  fs.mkdirSync(sdkPath, { recursive: true });
  fs.writeFileSync(path.join(sdkPath, "VERSION"), "2.0.1\n");
  fs.mkdirSync(path.join(sdkPath, "bin"), { recursive: true });
  fs.writeFileSync(path.join(sdkPath, "bin", "microkit"), "#!/bin/sh\necho microkit\n", "utf8");
  fs.chmodSync(path.join(sdkPath, "bin", "microkit"), 0o755);

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  microkit-sdk:",
      "    mode: local",
      "    path: ./workflow-workspace/tools/microkit-sdk/sdk",
      "    microkit-version: 2.0.1",
      ""
    ].join("\n")
  );

  const result = run([
    "--json",
    "tool",
    "build",
    "--tool",
    "microkit-sdk"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.details.tool, "microkit-sdk");
  assert.equal(payload.details.manifest.artifacts[0].path, "sdk-dir");

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("managed sel4 run can build a source tree from an archive url", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-sel4-fetch-project-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const origin = path.join(projectRoot, "origin-seL4");
  const sourceName = "seL4-15.0.0";
  const sourceDir = path.join(origin, sourceName);
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "VERSION"), "15.0.0\n");
  fs.writeFileSync(path.join(sourceDir, "README.md"), "# seL4\n");

  const patchDir = path.join(projectRoot, "sel4-patches");
  fs.mkdirSync(patchDir, { recursive: true });
  fs.writeFileSync(
    path.join(patchDir, "0001-readme.patch"),
    [
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-# seL4",
      "+# seL4 patched",
      ""
    ].join("\n"),
    "utf8"
  );

  const archivePath = path.join(projectRoot, "sel4-source.tar.xz");
  const command = spawnSync("tar", ["-cJf", archivePath, "-C", origin, sourceName], {
    encoding: "utf8"
  });
  assert.equal(command.status, 0, command.stdout || command.stderr);
  const archiveUrl = pathToFileURL(archivePath).toString();

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  sel4:",
      "    mode: local",
      "    sel4-version: 15.0.0",
      `    archive-url: ${archiveUrl}`,
      `    patch-dir: ${patchDir}`,
      ""
    ].join("\n")
  );

  const result = run([
    "--json",
    "tool",
    "build",
    "--tool",
    "sel4"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.details.tool, "sel4");
  assert.equal(payload.details.manifest.artifacts[0].path, "source-dir");
  assert.equal(
    payload.details.manifest.source,
    path.join(workspaceRoot, "tools", "sel4", "src", "seL4-15.0.0")
  );
  assert.equal(
    fs.readFileSync(path.join(payload.details.manifest.source, "README.md"), "utf8").trim(),
    "# seL4 patched"
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("managed qemu run can build an executable from source", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-build-project-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const sourceRoot = path.join(workspaceRoot, "tools", "qemu", "src", "qemu");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, "configure"),
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "prefix=''",
      "for arg in \"$@\"; do",
      "  case \"$arg\" in",
      "    --prefix=*) prefix=\"${arg#--prefix=}\" ;;",
      "  esac",
      "done",
      "cat > Makefile <<EOF",
      "all:",
      "\t@mkdir -p build-out",
      "\t@printf '%s\\n' '#!/usr/bin/env sh' 'if [ \"$$1\" = \"--version\" ]; then echo \"qemu built 1.0\"; exit 0; fi' 'exit 0' > build-out/qemu-system-aarch64",
      "\t@chmod +x build-out/qemu-system-aarch64",
      "install:",
      "\t@mkdir -p ${prefix}/bin",
      "\t@cp build-out/qemu-system-aarch64 ${prefix}/bin/qemu-system-aarch64",
      "EOF",
      ""
    ].join("\n"),
    { mode: 0o755 }
  );

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  qemu:",
      "    mode: local",
      "    source: ./workflow-workspace/tools/qemu/src/qemu",
      "    build-dir-key: aarch64-softmmu",
      "    target-list:",
      "      - aarch64-softmmu",
      ""
    ].join("\n")
  );

  const result = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "qemu"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.details.mode, "local");
  assert.equal(payload.details.provisioning, "build");
  assert.equal(payload.details.manifest.source, sourceRoot);
  assert.equal(
    payload.details.manifest.stagedSource,
    path.join(workspaceRoot, "tools", "qemu", "builds", "aarch64-softmmu", "source")
  );
  assert.equal(
    fs.existsSync(path.join(workspaceRoot, "tools", "qemu", "builds", "aarch64-softmmu", "install", "bin", "qemu-system-aarch64")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(workspaceRoot, "tools", "qemu", "builds", "aarch64-softmmu", "source", "configure")),
    true
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("managed qemu run can fetch and unpack a managed source tree from qemu-version", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-fetch-project-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const archiveSourceParent = path.join(projectRoot, "archive-src");
  const archiveSource = path.join(archiveSourceParent, "qemu-1.0.0");
  const archivePath = path.join(projectRoot, "qemu-1.0.0.tar.xz");
  fs.mkdirSync(archiveSource, { recursive: true });
  fs.writeFileSync(
    path.join(archiveSource, "configure"),
    [
      "#!/usr/bin/env sh",
      "set -eu",
      "prefix=''",
      "for arg in \"$@\"; do",
      "  case \"$arg\" in",
      "    --prefix=*) prefix=\"${arg#--prefix=}\" ;;",
      "  esac",
      "done",
      "cat > Makefile <<EOF",
      "all:",
      "\t@mkdir -p build-out",
      "\t@printf '%s\\n' '#!/usr/bin/env sh' 'if [ \"$$1\" = \"--version\" ]; then echo \"qemu fetched 1.0\"; exit 0; fi' 'exit 0' > build-out/qemu-system-aarch64",
      "\t@chmod +x build-out/qemu-system-aarch64",
      "install:",
      "\t@mkdir -p ${prefix}/bin",
      "\t@cp build-out/qemu-system-aarch64 ${prefix}/bin/qemu-system-aarch64",
      "EOF",
      ""
    ].join("\n"),
    { mode: 0o755 }
  );
  const archive = spawnSync("tar", ["-cJf", archivePath, "-C", archiveSourceParent, "qemu-1.0.0"], {
    encoding: "utf8"
  });
  assert.equal(archive.status, 0, archive.stdout || archive.stderr);

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  qemu:",
      "    mode: local",
      "    qemu-version: 1.0.0",
      `    archive-url: ${pathToFileURL(archivePath).toString()}`,
      ""
    ].join("\n")
  );

  const result = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "qemu"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.details.manifest.qemuVersion, "1.0.0");
  assert.equal(
    payload.details.manifest.source,
    path.join(workspaceRoot, "tools", "qemu", "src", "qemu-1.0.0")
  );
  assert.equal(
    fs.existsSync(path.join(workspaceRoot, "tools", "qemu", "src", "qemu-1.0.0", "configure")),
    true
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("managed nvirsh run resolves buildroot artifacts from morpheus.yaml", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-nvirsh-project-"));
  const workspaceRoot = path.join(projectRoot, "workflow-workspace");
  const buildrootRunId = "buildroot-20260421-abcdef01";
  const buildrootRunDir = path.join(workspaceRoot, "tools", "buildroot", "runs", buildrootRunId);
  const buildrootOutputDir = path.join(buildrootRunDir, "output");
  const kernelPath = path.join(buildrootOutputDir, "images", "Image");
  const initrdPath = path.join(buildrootOutputDir, "images", "rootfs.cpio.gz");
  const depsRoot = path.join(projectRoot, "deps");
  const qemuPath = path.join(workspaceRoot, "tools", "qemu", "bin", "qemu-system-aarch64");
  const microkitSdk = path.join(workspaceRoot, "tools", "microkit-sdk", "sdk");
  const toolchain = path.join(depsRoot, "arm-gnu-toolchain");
  const libvmmDir = path.join(depsRoot, "libvmm");
  const sel4Dir = path.join(workspaceRoot, "tools", "sel4", "src", "seL4");

  fs.mkdirSync(path.dirname(kernelPath), { recursive: true });
  fs.writeFileSync(kernelPath, "kernel");
  fs.writeFileSync(initrdPath, "initrd");
  fs.mkdirSync(path.dirname(qemuPath), { recursive: true });
  fs.mkdirSync(depsRoot, { recursive: true });
  fs.writeFileSync(
    qemuPath,
    [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"qemu stub 1.0\"",
      "  exit 0",
      "fi",
      "echo \"managed qemu launch: $*\"",
      "exit 0",
      ""
    ].join("\n"),
    { mode: 0o755 }
  );
  for (const dir of [microkitSdk, toolchain, libvmmDir, sel4Dir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(microkitSdk, "VERSION"), "1.4.1\n");
  fs.mkdirSync(path.join(microkitSdk, "bin"), { recursive: true });
  fs.writeFileSync(path.join(microkitSdk, "bin", "microkit"), "#!/usr/bin/env sh\necho microkit\n", "utf8");
  fs.chmodSync(path.join(microkitSdk, "bin", "microkit"), 0o755);
  fs.writeFileSync(path.join(toolchain, "VERSION"), "arm-toolchain\n");
  fs.writeFileSync(path.join(libvmmDir, "VERSION"), "libvmm-dev\n");
  fs.writeFileSync(path.join(sel4Dir, "VERSION"), "15.0.0\n");

  fs.writeFileSync(
    path.join(buildrootRunDir, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: buildrootRunId,
      tool: "buildroot",
      mode: "local",
      command: "run",
      status: "success",
      createdAt: "2026-04-21T08:00:00.000Z",
      updatedAt: "2026-04-21T08:00:00.000Z",
      workspace: workspaceRoot,
      runDir: buildrootRunDir,
      outputDir: buildrootOutputDir,
      logFile: path.join(buildrootRunDir, "stdout.log"),
      manifest: path.join(buildrootRunDir, "manifest.json"),
      artifacts: [
        { path: "images/Image", location: kernelPath },
        { path: "images/rootfs.cpio.gz", location: initrdPath }
      ]
    }, null, 2)
  );

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "tools:",
      "  qemu:",
      "    mode: local",
      "    path: ./workflow-workspace/tools/qemu/bin/qemu-system-aarch64",
      "  microkit-sdk:",
      "    mode: local",
      "    path: ./workflow-workspace/tools/microkit-sdk/sdk",
      "    microkit-version: 1.4.1",
      "  sel4:",
      "    mode: local",
      "    path: ./workflow-workspace/tools/sel4/src/seL4",
      "    sel4-version: 15.0.0",
      "  nvirsh:",
      "    mode: local",
      "    target: sel4",
      "    name: sel4-dev",
      "    microkit-version: 1.4.1",
      "    toolchain: ./deps/arm-gnu-toolchain",
      "    libvmm-dir: ./deps/libvmm",
      "    sel4-version: 15.0.0",
      "    qemu-args:",
      "      - -machine",
      "      - virt",
      "    dependencies:",
      "      qemu:",
      "        tool: qemu",
      "        artifact: qemu-system-aarch64",
      "      microkit-sdk:",
      "        tool: microkit-sdk",
      "        artifact: sdk-dir",
      "      kernel:",
      "        tool: buildroot",
      "        artifact: images/Image",
      "      initrd:",
      "        tool: buildroot",
      "        artifact: images/rootfs.cpio.gz",
      "      sel4:",
      "        tool: sel4",
      "        artifact: source-dir",
      ""
    ].join("\n")
  );

  const qemuRegister = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "qemu"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });
  assert.equal(qemuRegister.status, 0, qemuRegister.stderr || qemuRegister.stdout);

  const microkitRegister = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "microkit-sdk"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });
  assert.equal(microkitRegister.status, 0, microkitRegister.stderr || microkitRegister.stdout);

  const sel4Register = run([
    "--json",
    "tool",
    "build",
    "--tool",
    "sel4"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });
  assert.equal(sel4Register.status, 0, sel4Register.stderr || sel4Register.stdout);

  const result = run([
    "--json",
    "tool",
    "build",
    "--tool",
    "nvirsh"
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "success");
  assert.equal(payload.details.tool, "nvirsh");
  assert.equal(payload.details.manifest.tool, "nvirsh");
  assert.equal(payload.details.manifest.artifacts.length, 2);

  const inspect = run([
    "--json",
    "runs",
    "inspect",
    "--id",
    payload.details.id
  ], {
    cwd: projectRoot,
    env: {
      ...isolatedEnv(),
      MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
    }
  });
  assert.equal(inspect.status, 0, inspect.stderr || inspect.stdout);
  const inspectPayload = JSON.parse(inspect.stdout.trim());
  assert.equal(inspectPayload.details.manifest.tool, "nvirsh");

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
      "\t@i=1; while [ $$i -le 5000 ]; do echo \"stream line $$i from fake remote build\"; i=`expr $$i + 1`; done",
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

test("managed remote Buildroot run syncs a Buildroot patch dir into the remote workspace", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-patch-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-patch-root-"));
  const seededSourceRoot = path.join(
    remoteRoot,
    "tools",
    "buildroot",
    "src",
    "buildroot-2025.02.1"
  );
  const patchRoot = path.join(projectRoot, "workflow-workspace", "tools", "buildroot", "patches", "busybox");
  fs.mkdirSync(patchRoot, { recursive: true });
  fs.writeFileSync(
    path.join(patchRoot, "0001-demo.patch"),
    [
      "diff --git a/demo.txt b/demo.txt",
      "--- a/demo.txt",
      "+++ b/demo.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n")
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
      "    patch-dir: ./workflow-workspace/tools/buildroot/patches",
      "    defconfig: qemu_aarch64_virt_defconfig",
      "    artifacts:",
      "      - images/Image",
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
  const remoteManifestPath = path.join(
    remoteRoot,
    "tools",
    "buildroot",
    "runs",
    payload.details.id,
    "manifest.json"
  );
  const remoteManifest = JSON.parse(fs.readFileSync(remoteManifestPath, "utf8"));
  assert.equal(
    remoteManifest.patchDir,
    path.join(remoteRoot, "tools", "buildroot", "patches", payload.details.id)
  );
  assert.equal(
    fs.existsSync(path.join(remoteRoot, "tools", "buildroot", "patches", payload.details.id, "busybox", "0001-demo.patch")),
    true
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("managed remote Buildroot run records a custom kernel hash in the workspace patch tree", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-kernel-hash-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-kernel-hash-root-"));
  const seededSourceRoot = path.join(
    remoteRoot,
    "tools",
    "buildroot",
    "src",
    "buildroot-2025.02.1"
  );
  const patchRoot = path.join(projectRoot, "workflow-workspace", "tools", "buildroot", "patches", "linux");
  fs.mkdirSync(patchRoot, { recursive: true });
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
      "    patch-dir: ./workflow-workspace/tools/buildroot/patches",
      "    defconfig: qemu_aarch64_virt_defconfig",
      "    config-fragment:",
      "      - BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE=\"6.18.16\"",
      "    artifacts:",
      "      - images/Image",
      ""
    ].join("\n")
  );

  const env = {
    ...process.env,
    ...makeFakeSshEnv(remoteRoot),
    ...makeFakeCurlEnv([
      "sha256  deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  linux-6.18.16.tar.xz"
    ])
  };

  const result = run([
    "--json",
    "tool",
    "run",
    "--tool",
    "buildroot"
  ], { env, cwd: projectRoot });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const hashFile = path.join(projectRoot, "workflow-workspace", "tools", "buildroot", "patches", "linux", "linux.hash");
  assert.equal(fs.existsSync(hashFile), true);
  assert.match(
    fs.readFileSync(hashFile, "utf8"),
    /linux-6\.18\.16\.tar\.xz/
  );
  const headersHashFile = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "buildroot",
    "patches",
    "linux-headers",
    "linux-headers.hash"
  );
  assert.equal(fs.existsSync(headersHashFile), true);
  assert.match(
    fs.readFileSync(headersHashFile, "utf8"),
    /linux-6\.18\.16\.tar\.xz/
  );

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("runs list --managed can discover remote managed runs from workspace state", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-list-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-list-root-"));
  const runId = "buildroot-20260420-deadbeef";
  const runRoot = path.join(remoteRoot, "tools", "buildroot", "runs", runId);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(
    path.join(runRoot, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: runId,
      tool: "buildroot",
      mode: "remote",
      command: "run",
      status: "running",
      createdAt: "2026-04-20T15:00:00.000Z",
      updatedAt: "2026-04-20T15:10:00.000Z",
      workspace: "/remote-workspace",
      runDir: "/remote-workspace/tools/buildroot/runs/buildroot-20260420-deadbeef",
      outputDir: "/remote-workspace/tools/buildroot/runs/buildroot-20260420-deadbeef/output",
      logFile: "/remote-workspace/tools/buildroot/runs/buildroot-20260420-deadbeef/stdout.log",
      manifest: "/remote-workspace/tools/buildroot/runs/buildroot-20260420-deadbeef/manifest.json",
      artifacts: []
    }, null, 2)
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
      ""
    ].join("\n")
  );

  const env = {
    ...process.env,
    ...makeFakeSshEnv(remoteRoot),
    ...makeEmptyPsEnv(),
    MORPHEUS_ASSUME_REMOTE_RUN_INACTIVE: "1",
    MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
  };

  const result = run(["--json", "runs", "list", "--managed"], { env, cwd: projectRoot });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.details.runs.some((item) => item.id === runId), true);
  assert.equal(payload.details.runs.find((item) => item.id === runId).ssh, "builder@example.com:2222");

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("runs inspect reconciles a stale remote running manifest to success", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-inspect-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-inspect-root-"));
  const runId = "buildroot-20260420-stale0001";
  const runRoot = path.join(remoteRoot, "tools", "buildroot", "runs", runId);
  const outputRoot = path.join(runRoot, "output");
  fs.mkdirSync(path.join(outputRoot, "images"), { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "images", "Image"), "kernel");
  fs.writeFileSync(path.join(outputRoot, "images", "rootfs.cpio.gz"), "rootfs");
  fs.writeFileSync(
    path.join(runRoot, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: runId,
      tool: "buildroot",
      mode: "remote",
      command: "run",
      status: "running",
      createdAt: "2026-04-20T15:00:00.000Z",
      updatedAt: "2026-04-20T15:00:00.000Z",
      workspace: remoteRoot,
      outputDir: path.join(remoteRoot, "tools", "buildroot", "runs", "buildroot-20260420-stale0001", "output"),
      runDir: path.join(remoteRoot, "tools", "buildroot", "runs", "buildroot-20260420-stale0001"),
      logFile: path.join(remoteRoot, "tools", "buildroot", "runs", "buildroot-20260420-stale0001", "stdout.log"),
      manifest: path.join(remoteRoot, "tools", "buildroot", "runs", "buildroot-20260420-stale0001", "manifest.json"),
      expectedArtifacts: ["images/Image", "images/rootfs.cpio.gz"],
      artifacts: []
    }, null, 2)
  );

  writeConfig(
    projectRoot,
    [
      "workspace:",
      "  root: ./workflow-workspace",
      "remote:",
      "  ssh: builder@example.com:2222",
      "  workspace:",
      `    root: ${remoteRoot}`,
      ""
    ].join("\n")
  );

  const env = {
    ...process.env,
    ...makeFakeSshEnv(remoteRoot),
    MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state")
  };

  const result = run([
    "--json",
    "runs",
    "inspect",
    "--id",
    runId,
    "--workspace",
    remoteRoot,
    "--ssh",
    "builder@example.com:2222"
  ], { env, cwd: projectRoot });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.details.manifest.status, "success");
  assert.equal(payload.details.manifest.artifacts.length, 2);

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
