const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const buildScript = path.join(repoRoot, "tools", "qemu", "scripts", "build.sh");

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

function configureSignature({ targetList = [], configureArgs = [] } = {}) {
  const targetSpace = targetList.join(" ");
  const lines = [
    `target_space=${targetSpace}`,
    "use_system_meson=0",
    "configure_args<<EOF",
  ];
  if (configureArgs.length === 0) {
    lines.push("");
  } else {
    lines.push(...configureArgs);
  }
  lines.push("EOF", "");
  return crypto
    .createHash("sha256")
    .update(lines.join("\n"))
    .digest("hex");
}

function seedReusableTree(
  tmpDir,
  { targetList = [], configureArgs = [] } = {},
) {
  const sourceDir = path.join(tmpDir, "source");
  const buildDir = path.join(tmpDir, "build");
  const installDir = path.join(tmpDir, "install");
  const artifactPath = path.join(installDir, "bin", "qemu-system-aarch64");

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(buildDir, "pyvenv", "bin"), { recursive: true });
  fs.mkdirSync(path.join(installDir, "bin"), { recursive: true });

  writeExecutable(path.join(sourceDir, "configure"), "#!/bin/sh\nexit 99\n");
  fs.writeFileSync(path.join(sourceDir, "dummy.txt"), "source\n");
  writeExecutable(
    path.join(buildDir, "pyvenv", "bin", "meson"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(buildDir, "pyvenv", "bin", "python3"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(
    path.join(buildDir, "build.ninja"),
    `command = ${buildDir}/pyvenv/bin/meson --internal regenerate ${sourceDir} .\n`,
  );
  fs.writeFileSync(
    path.join(buildDir, ".morpheus-configure-signature"),
    configureSignature({ targetList, configureArgs }),
  );
  fs.writeFileSync(artifactPath, "artifact\n");

  const older = new Date(Date.now() - 60_000);
  const newer = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(sourceDir, "configure"), older, older);
  fs.utimesSync(path.join(sourceDir, "dummy.txt"), older, older);
  fs.utimesSync(path.join(buildDir, "build.ninja"), older, older);
  fs.utimesSync(path.join(buildDir, ".morpheus-configure-signature"), older, older);
  fs.utimesSync(path.join(buildDir, "pyvenv", "bin", "meson"), older, older);
  fs.utimesSync(path.join(buildDir, "pyvenv", "bin", "python3"), older, older);
  fs.utimesSync(artifactPath, newer, newer);

  return {
    sourceDir,
    buildDir,
    installDir,
    artifactPath,
  };
}

test("qemu build reuses an existing meson tree with pyvenv paths", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-build-"));
  const resultFile = path.join(tmpDir, "result.json");
  const binDir = path.join(tmpDir, "bin");
  const {
    sourceDir,
    buildDir,
    installDir,
    artifactPath,
  } = seedReusableTree(tmpDir);

  fs.mkdirSync(binDir, { recursive: true });

  writeExecutable(
    path.join(binDir, "python3"),
    "#!/bin/sh\nexec /usr/bin/python3 \"$@\"\n",
  );
  writeExecutable(path.join(binDir, "meson"), "#!/bin/sh\nexit 0\n");

  const runResult = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_BUILD_DIR: buildDir,
      MORPHEUS_QEMU_INSTALL_DIR: installDir,
      MORPHEUS_QEMU_RESULT_FILE: resultFile,
      MORPHEUS_QEMU_REUSE_BUILD_DIR: "true",
      MORPHEUS_QEMU_USE_SYSTEM_MESON: "0",
    },
  });

  assert.equal(runResult.status, 0, runResult.stderr + runResult.stdout);
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(result.details.reused, true);
  assert.equal(fs.existsSync(artifactPath), true);
  assert.equal(fs.existsSync(path.join(buildDir, "build.ninja")), true);
});

test("qemu build ignores regenerated target and configure arg file mtimes when contents match", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-build-"));
  const resultFile = path.join(tmpDir, "result.json");
  const binDir = path.join(tmpDir, "bin");
  const targetListFile = path.join(tmpDir, "target-list.txt");
  const configureArgFile = path.join(tmpDir, "configure-args.txt");
  const {
    sourceDir,
    buildDir,
    installDir,
    artifactPath,
  } = seedReusableTree(tmpDir, {
    targetList: ["aarch64-softmmu"],
    configureArgs: ["--disable-docs"],
  });

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(targetListFile, "aarch64-softmmu\n");
  fs.writeFileSync(configureArgFile, "--disable-docs\n");

  const newer = new Date(Date.now() + 120_000);
  fs.utimesSync(targetListFile, newer, newer);
  fs.utimesSync(configureArgFile, newer, newer);

  writeExecutable(
    path.join(binDir, "python3"),
    "#!/bin/sh\nexec /usr/bin/python3 \"$@\"\n",
  );
  writeExecutable(path.join(binDir, "meson"), "#!/bin/sh\nexit 0\n");

  const runResult = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_BUILD_DIR: buildDir,
      MORPHEUS_QEMU_INSTALL_DIR: installDir,
      MORPHEUS_QEMU_RESULT_FILE: resultFile,
      MORPHEUS_QEMU_REUSE_BUILD_DIR: "true",
      MORPHEUS_QEMU_USE_SYSTEM_MESON: "0",
      MORPHEUS_QEMU_TARGET_LIST_FILE: targetListFile,
      MORPHEUS_QEMU_CONFIGURE_ARG_FILE: configureArgFile,
    },
  });

  assert.equal(runResult.status, 0, runResult.stderr + runResult.stdout);
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(result.details.reused, true);
  assert.equal(fs.existsSync(artifactPath), true);
});
