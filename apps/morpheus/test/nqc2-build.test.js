const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const buildScript = path.join(repoRoot, "tools", "nqc2", "scripts", "build.sh");

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  fs.chmodSync(filePath, 0o755);
}

test("NQC2 guest plugin build uses the supplied guest ABI and toolchain", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-nqc2-build-"));
  const sourceDir = path.join(tmpDir, "source");
  const qemuInstallDir = path.join(tmpDir, "host-qemu");
  const guestHeader = path.join(tmpDir, "guest-qemu", "include", "plugins", "qemu-plugin.h");
  const guestCompiler = path.join(tmpDir, "guest-toolchain", "bin", "guest-gcc");
  const guestSysroot = path.join(tmpDir, "guest-toolchain", "sysroot");
  const compilerLog = path.join(tmpDir, "guest-compiler.log");
  const etraceRepo = path.join(tmpDir, "build", "qemu-etrace");
  const installDir = path.join(tmpDir, "install");
  const traceDir = path.join(tmpDir, "trace");
  const resultFile = path.join(tmpDir, "result.json");

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "VERSION"), "synthetic\n", "utf8");
  fs.mkdirSync(path.join(qemuInstallDir, "include"), { recursive: true });
  fs.writeFileSync(path.join(qemuInstallDir, "include", "qemu-plugin.h"), "host ABI\n", "utf8");
  writeExecutable(
    path.join(qemuInstallDir, "bin", "qemu-system-aarch64"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.mkdirSync(path.dirname(guestHeader), { recursive: true });
  fs.writeFileSync(guestHeader, "guest ABI v7\n", "utf8");
  fs.mkdirSync(path.join(guestSysroot, "usr", "include", "glib-2.0"), { recursive: true });
  fs.mkdirSync(path.join(guestSysroot, "usr", "lib", "glib-2.0", "include"), { recursive: true });
  fs.writeFileSync(path.join(guestSysroot, "usr", "include", "glib-2.0", "glib.h"), "\n", "utf8");
  fs.writeFileSync(
    path.join(guestSysroot, "usr", "lib", "glib-2.0", "include", "glibconfig.h"),
    "\n",
    "utf8",
  );

  writeExecutable(
    guestCompiler,
    "#!/bin/sh\n"
      + "printf '%s\\n' \"$*\" >> \"${NQC2_GUEST_COMPILER_LOG}\"\n"
      + "output=''\n"
      + "while [ $# -gt 0 ]; do\n"
      + "  if [ \"$1\" = '-o' ]; then output=$2; shift 2; else shift; fi\n"
      + "done\n"
      + ": > \"$output\"\n",
  );
  writeExecutable(
    path.join(tmpDir, "host-cc"),
    "#!/bin/sh\n"
      + "output=''\n"
      + "while [ $# -gt 0 ]; do\n"
      + "  if [ \"$1\" = '-o' ]; then output=$2; shift 2; else shift; fi\n"
      + "done\n"
      + ": > \"$output\"\n",
  );

  fs.mkdirSync(path.join(etraceRepo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(etraceRepo, "binutils-2.42-install", "include"), { recursive: true });
  fs.mkdirSync(path.join(etraceRepo, "binutils-2.42-install", "lib"), { recursive: true });
  fs.writeFileSync(path.join(etraceRepo, "binutils-2.42-install", "include", "bfd.h"), "\n");
  fs.writeFileSync(path.join(etraceRepo, "binutils-2.42-install", "lib", "libiberty.a"), "\n");
  fs.writeFileSync(path.join(etraceRepo, "Makefile"), "all:\n\t@test -x qemu-etrace\n");
  writeExecutable(path.join(etraceRepo, "qemu-etrace"), "#!/bin/sh\nexit 0\n");

  const result = spawnSync("bash", [buildScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CC: path.join(tmpDir, "host-cc"),
      NQC2_GUEST_COMPILER_LOG: compilerLog,
      MORPHEUS_NQC2_SOURCE: sourceDir,
      MORPHEUS_NQC2_QEMU: path.join(qemuInstallDir, "bin", "qemu-system-aarch64"),
      MORPHEUS_NQC2_GUEST_QEMU_PLUGIN_HEADER: guestHeader,
      MORPHEUS_NQC2_GUEST_CROSS_COMPILE: guestCompiler,
      MORPHEUS_NQC2_GUEST_SYSROOT: guestSysroot,
      MORPHEUS_NQC2_BUILD_DIR: path.join(tmpDir, "build"),
      MORPHEUS_NQC2_INSTALL_DIR: installDir,
      MORPHEUS_NQC2_TRACE_DIR: traceDir,
      MORPHEUS_NQC2_RESULT_FILE: resultFile,
    },
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  const compilerInvocation = fs.readFileSync(compilerLog, "utf8");
  assert.match(compilerInvocation, new RegExp(`--sysroot=${guestSysroot}`));
  assert.match(
    compilerInvocation,
    new RegExp(`-I${path.join(guestSysroot, "usr", "include", "glib-2.0")}`),
  );
  assert.equal(fs.existsSync(path.join(installDir, "lib", "nqc2", "nqc2-plugin-aarch64.so")), true);
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(payload.artifacts.some((artifact) => artifact.path === "nqc2-plugin-so-aarch64"), true);
});
