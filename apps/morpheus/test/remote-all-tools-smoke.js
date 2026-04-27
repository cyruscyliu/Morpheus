const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const bin = path.join(appRoot, "dist", "cli.js");
const buildrootFixture = path.join(
  repoRoot,
  "tools",
  "buildroot",
  "test",
  "fixtures",
  "minimal-buildroot"
);
const remoteConfigFixture = path.join(
  appRoot,
  "test",
  "fixtures",
  "remote-all-tools",
  "morpheus.yaml"
);

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    ...options,
  });
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
    MORPHEUS_DISABLE_TOOL_WORKFLOW_WRAP: "1",
  };
}

function writeQemuSource(projectRoot) {
  const sourceRoot = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "qemu",
    "src",
    "qemu"
  );
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
      "\t@printf '%s\\n' '#!/usr/bin/env sh' 'if [ \"$$1\" = \"--version\" ]; then echo \"qemu remote 1.0\"; exit 0; fi' 'exit 0' > build-out/qemu-system-aarch64",
      "\t@chmod +x build-out/qemu-system-aarch64",
      "install:",
      "\t@mkdir -p ${prefix}/bin",
      "\t@cp build-out/qemu-system-aarch64 ${prefix}/bin/qemu-system-aarch64",
      "EOF",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
}

function writeLocalQemuBinary(projectRoot) {
  const binDir = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "qemu",
    "fake-bin"
  );
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "qemu-system-aarch64"),
    [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo 'qemu smoke 1.0'",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
}

function writeSel4Source(projectRoot) {
  const root = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "sel4",
    "src",
    "sel4"
  );
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), "15.0.0\n");
}

function writeMicrokitSdkFixture(projectRoot) {
  const sdkRoot = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "microkit-sdk",
    "builds",
    "default",
    "install"
  );
  const toolchainRoot = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "microkit-sdk",
    "deps",
    "toolchain"
  );
  fs.mkdirSync(path.join(sdkRoot, "bin"), { recursive: true });
  fs.mkdirSync(path.join(toolchainRoot, "bin"), { recursive: true });
  fs.writeFileSync(path.join(sdkRoot, "VERSION"), "2.0.0\n");
  fs.writeFileSync(
    path.join(sdkRoot, "bin", "microkit"),
    "#!/usr/bin/env sh\nexit 0\n",
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(toolchainRoot, "VERSION"), "12.3.0\n");
  fs.writeFileSync(
    path.join(toolchainRoot, "bin", "aarch64-none-elf-gcc"),
    "#!/usr/bin/env sh\nexit 0\n",
    { mode: 0o755 }
  );
}

function writeBuildrootArtifacts(projectRoot) {
  const imagesDir = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "buildroot",
    "images"
  );
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, "Image"), "kernel\n");
  fs.writeFileSync(path.join(imagesDir, "rootfs.cpio.gz"), "initrd\n");
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

function writeLibvmmSource(projectRoot) {
  const root = path.join(
    projectRoot,
    "workflow-workspace",
    "tools",
    "libvmm",
    "src",
    "libvmm"
  );
  const exampleDir = path.join(root, "examples", "virtio");
  fs.mkdirSync(exampleDir, { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), "0.1.0\n");
  fs.writeFileSync(path.join(root, "requirements.txt"), "\n");
  fs.writeFileSync(
    path.join(exampleDir, "Makefile"),
    [
      ".PHONY: all",
      "all:",
      "\t@mkdir -p build",
      "\t@printf 'ok\\n' > build/guest.bin",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "runtime-contract.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "libvmm-runtime-contract",
      provider: "libvmm",
      version: "0.1.0",
      example: "virtio",
      defaultAction: "qemu",
      actions: {
        qemu: {
          command: "make",
          args: ["qemu"],
          cwd: path.join(root, "examples", "virtio"),
          requiredInputs: [
            "libvmm-dir",
            "microkit-sdk",
            "board",
            "kernel",
            "initrd",
            "qemu",
          ],
        },
      },
    }, null, 2)}\n`
  );
  runGit(["init", "-b", "main"], root);
  runGit(["config", "user.email", "smoke@example.com"], root);
  runGit(["config", "user.name", "Smoke Test"], root);
  runGit(["add", "."], root);
  runGit(["commit", "-m", "fixture"], root);
}

function writeRemoteLlBicFixture(remoteRoot) {
  const outputDir = path.join(remoteRoot, "fixtures", "linux-6.18.16-arm64-clang15");
  const sourceDir = path.join(remoteRoot, "src", "linux-6.18.16");
  const configPath = path.join(outputDir, ".config");
  const bitcodeListPath = path.join(outputDir, "bitcode_files.txt");
  const kernelBuildLogPath = path.join(outputDir, "kernel-build.log");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(configPath, "CONFIG_TEST=y\n");
  fs.writeFileSync(bitcodeListPath, "kernel/sched/core.bc\n");
  fs.writeFileSync(path.join(outputDir, "llbic.log"), "llbic inspect fixture\n");
  fs.writeFileSync(kernelBuildLogPath, "kernel build fixture\n");
  fs.writeFileSync(
    path.join(outputDir, "llbic.json"),
    JSON.stringify({
      kernel_version: "6.18.16",
      kernel_name: "linux-6.18.16",
      arch: "arm64",
      build_layout: "out-of-tree",
      config_path: configPath,
      bitcode_list_file: bitcodeListPath,
      source_dir: sourceDir,
      output_dir: outputDir,
      kernel_build_log: kernelBuildLogPath,
      status: "success",
    })
  );
}

function writeRemoteLlCgFixture(remoteRoot) {
  const kernelRoot = path.join(remoteRoot, "kernel-src");
  fs.mkdirSync(path.join(kernelRoot, "drivers", "net"), { recursive: true });
  fs.writeFileSync(
    path.join(kernelRoot, "Makefile"),
    [
      "VERSION = 6",
      "PATCHLEVEL = 18",
      "SUBLEVEL = 16",
      "EXTRAVERSION =",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(kernelRoot, "drivers", "net", "demo.c"),
    "int demo(void) { return 0; }\n"
  );
}

function copyRemoteBuildrootSource(remoteRoot) {
  const sourceRoot = path.join(
    remoteRoot,
    "tools",
    "buildroot",
    "src",
    "buildroot-2025.02.1"
  );
  fs.mkdirSync(path.dirname(sourceRoot), { recursive: true });
  fs.cpSync(buildrootFixture, sourceRoot, { recursive: true });
}

function parseJsonResult(result, label) {
  assert.equal(result.status, 0, `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function main() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-all-tools-project-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-remote-all-tools-root-"));
  const configPath = path.join(projectRoot, "morpheus.yaml");
  fs.copyFileSync(remoteConfigFixture, configPath);

  writeQemuSource(projectRoot);
  writeLocalQemuBinary(projectRoot);
  writeSel4Source(projectRoot);
  writeMicrokitSdkFixture(projectRoot);
  writeBuildrootArtifacts(projectRoot);
  writeLibvmmSource(projectRoot);
  copyRemoteBuildrootSource(remoteRoot);
  writeRemoteLlBicFixture(remoteRoot);
  writeRemoteLlCgFixture(remoteRoot);

  const env = {
    ...process.env,
    ...makeFakeSshEnv(remoteRoot),
    MORPHEUS_STATE_ROOT: path.join(projectRoot, ".state"),
  };

  const results = {};

  results.buildroot = parseJsonResult(
    run(["--json", "tool", "build", "--tool", "buildroot"], {
      cwd: projectRoot,
      env,
    }),
    "remote buildroot"
  );
  assert.equal(results.buildroot.status, "success");
  assert.equal(results.buildroot.details.mode, "remote");

  results.qemu = parseJsonResult(
    run(["--json", "tool", "run", "--tool", "qemu"], {
      cwd: projectRoot,
      env,
    }),
    "remote qemu"
  );
  assert.equal(results.qemu.status, "success");
  assert.equal(results.qemu.details.mode, "remote");

  results.sel4 = parseJsonResult(
    run(["--json", "tool", "build", "--tool", "sel4"], {
      cwd: projectRoot,
      env,
    }),
    "remote sel4"
  );
  assert.equal(results.sel4.status, "success");
  assert.equal(results.sel4.details.mode, "remote");

  results["microkit-sdk"] = parseJsonResult(
    run(["--json", "tool", "build", "--tool", "microkit-sdk"], {
      cwd: projectRoot,
      env,
    }),
    "remote microkit-sdk"
  );
  assert.equal(results["microkit-sdk"].status, "success");
  assert.equal(results["microkit-sdk"].details.mode, "remote");

  results.libvmm = parseJsonResult(
    run(["--json", "tool", "build", "--tool", "libvmm"], {
      cwd: projectRoot,
      env,
    }),
    "remote libvmm"
  );
  assert.equal(results.libvmm.status, "success");
  assert.equal(results.libvmm.details.mode, "remote");

  results.nvirsh = parseJsonResult(
    run(["--json", "tool", "build", "--tool", "nvirsh"], {
      cwd: projectRoot,
      env,
    }),
    "remote nvirsh"
  );
  assert.equal(results.nvirsh.status, "success");
  assert.equal(results.nvirsh.details.mode, "remote");

  results.llbic = parseJsonResult(
    run(
      [
        "--json",
        "tool",
        "build",
        "--tool",
        "llbic",
        "inspect",
        "/remote-workspace/fixtures/linux-6.18.16-arm64-clang15/llbic.json",
      ],
      {
        cwd: projectRoot,
        env,
      }
    ),
    "remote llbic"
  );
  assert.equal(results.llbic.status, "success");
  assert.equal(results.llbic.details.mode, "remote");

  results.llcg = parseJsonResult(
    run(
      [
        "--json",
        "tool",
        "build",
        "--tool",
        "llcg",
        "genmutator",
        "files",
        "--source-dir",
        "/remote-workspace/kernel-src",
        "--file",
        "drivers/net/demo.c",
        "--scope-name",
        "net-demo",
        "--arch",
        "arm64",
      ],
      {
        cwd: projectRoot,
        env,
      }
    ),
    "remote llcg"
  );
  assert.equal(results.llcg.status, "success");
  assert.equal(results.llcg.details.mode, "remote");

  assert.equal(
    fs.existsSync(path.join(projectRoot, "workflow-workspace", "tools", "qemu", "_managed_tool")),
    false
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "workflow-workspace", "tools", "microkit-sdk", "_managed_tool")),
    false
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "workflow-workspace", "tools", "sel4", "_managed_tool")),
    false
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "workflow-workspace", "tools", "libvmm", "_managed_tool")),
    false
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, "workflow-workspace", "tools", "nvirsh", "_managed_tool")),
    false
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "success",
        config: path.relative(repoRoot, configPath),
        project_root: projectRoot,
        remote_root: remoteRoot,
        results: Object.fromEntries(
          Object.entries(results).map(([tool, payload]) => [
            tool,
            {
              status: payload.status,
              id: payload.details.id,
              output_dir: payload.details.output_dir || null,
            },
          ])
        ),
      },
      null,
      2
    )}\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
