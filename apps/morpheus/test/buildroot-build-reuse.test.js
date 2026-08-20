const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const buildScript = path.join(repoRoot, "tools", "buildroot", "scripts", "build.sh");
const fixtureSource = path.join(
  repoRoot,
  "tools",
  "buildroot",
  "tests",
  "fixtures",
  "minimal-buildroot",
);

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function artifactMap(result) {
  return new Map((result.artifacts || []).map((entry) => [entry.path, entry.location]));
}

function assertManagedGuestArtifacts(result, outputDir) {
  const artifacts = artifactMap(result);
  assert.equal(artifacts.get("output-dir"), outputDir);
  assert.equal(artifacts.get("target-dir"), path.join(outputDir, "target"));
  assert.equal(artifacts.get("images-dir"), path.join(outputDir, "images"));
  assert.equal(artifacts.get("images/Image"), path.join(outputDir, "images", "Image"));
  assert.equal(
    artifacts.get("images/rootfs.cpio.gz"),
    path.join(outputDir, "images", "rootfs.cpio.gz"),
  );
  assert.equal(artifacts.get("build/vmlinux"), path.join(outputDir, "build", "linux-6.18.16", "vmlinux"));
  assert.equal(
    artifacts.get("target/usr/bin/qemu-system-aarch64"),
    path.join(outputDir, "target", "usr", "bin", "qemu-system-aarch64"),
  );
  assert.equal(
    artifacts.get("target/usr/share/qemu"),
    path.join(outputDir, "target", "usr", "share", "qemu"),
  );
}

test("buildroot build reuses an existing output tree before mutating .config", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-build-"));
  const sourceDir = path.join(tmpDir, "source");
  const outputDir = path.join(tmpDir, "output");
  const resultFile = path.join(tmpDir, "result.json");

  fs.cpSync(fixtureSource, sourceDir, { recursive: true });

  const firstRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(firstRun.status, 0, firstRun.stderr + firstRun.stdout);
  const firstResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(firstResult.details.reused, false);
  assertManagedGuestArtifacts(firstResult, outputDir);

  const buildLog = path.join(outputDir, "build.log");
  const defconfigLog = path.join(outputDir, "defconfig.log");
  const buildLogMtime = fs.statSync(buildLog).mtimeMs;
  assert.deepEqual(
    fs.readFileSync(defconfigLog, "utf8").trim().split("\n"),
    [
      "configured qemu_aarch64_virt_defconfig",
      "applied olddefconfig",
    ],
  );

  const secondRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(secondRun.status, 0, secondRun.stderr + secondRun.stdout);
  const secondResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(secondResult.details.reused, true);
  assertManagedGuestArtifacts(secondResult, outputDir);
  assert.equal(fs.statSync(buildLog).mtimeMs, buildLogMtime);
  assert.deepEqual(
    fs.readFileSync(defconfigLog, "utf8").trim().split("\n"),
    [
      "configured qemu_aarch64_virt_defconfig",
      "applied olddefconfig",
    ],
  );
});

test("buildroot build accepts and upgrades a legacy input fingerprint", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-legacy-"));
  const sourceDir = path.join(tmpDir, "source");
  const outputDir = path.join(tmpDir, "output");
  const resultFile = path.join(tmpDir, "result.json");
  const stateFile = path.join(outputDir, ".morpheus-build-inputs.json");

  fs.cpSync(fixtureSource, sourceDir, { recursive: true });

  const firstRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(firstRun.status, 0, firstRun.stderr + firstRun.stdout);

  const buildLog = path.join(outputDir, "build.log");
  const buildLogMtime = fs.statSync(buildLog).mtimeMs;
  const legacyFingerprint = sha256("");
  const currentFingerprint = sha256("defconfig=qemu_aarch64_virt_defconfig\n");
  assert.notEqual(legacyFingerprint, currentFingerprint);

  fs.writeFileSync(
    stateFile,
    JSON.stringify({ fingerprint: legacyFingerprint }, null, 2),
    "utf8",
  );

  const secondRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(secondRun.status, 0, secondRun.stderr + secondRun.stdout);
  const secondResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(secondResult.details.reused, true);
  assert.equal(fs.statSync(buildLog).mtimeMs, buildLogMtime);
  assert.equal(
    JSON.parse(fs.readFileSync(stateFile, "utf8")).fingerprint,
    currentFingerprint,
  );
});

test("buildroot build reuses valid artifacts even when the output tree looks stale", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-stale-"));
  const sourceDir = path.join(tmpDir, "source");
  const outputDir = path.join(tmpDir, "output");
  const resultFile = path.join(tmpDir, "result.json");

  fs.cpSync(fixtureSource, sourceDir, { recursive: true });

  const firstRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(firstRun.status, 0, firstRun.stderr + firstRun.stdout);

  const buildLog = path.join(outputDir, "build.log");
  const buildLogMtime = fs.statSync(buildLog).mtimeMs;
  const configPath = path.join(outputDir, ".config");
  const now = new Date();
  fs.utimesSync(configPath, now, now);

  const secondRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(secondRun.status, 0, secondRun.stderr + secondRun.stdout);
  const secondResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(secondResult.details.reused, true);
  assert.equal(fs.statSync(buildLog).mtimeMs, buildLogMtime);
});

test("buildroot build applies make args to defconfig and fingerprints them for reuse", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-buildroot-make-args-"));
  const sourceDir = path.join(tmpDir, "source");
  const outputDir = path.join(tmpDir, "output");
  const resultFile = path.join(tmpDir, "result.json");
  const makeArgFile = path.join(tmpDir, "make-args.txt");

  fs.cpSync(fixtureSource, sourceDir, { recursive: true });
  fs.writeFileSync(makeArgFile, "BR2_EXTERNAL=/tmp/cca-a\n", "utf8");

  const firstRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_MAKE_ARG_FILE: makeArgFile,
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(firstRun.status, 0, firstRun.stderr + firstRun.stdout);
  assert.equal(JSON.parse(fs.readFileSync(resultFile, "utf8")).details.reused, false);
  assert.deepEqual(
    fs.readFileSync(path.join(outputDir, "defconfig.log"), "utf8").trim().split("\n"),
    [
      "configured qemu_aarch64_virt_defconfig",
      "BR2_EXTERNAL=/tmp/cca-a",
      "applied olddefconfig",
      "BR2_EXTERNAL=/tmp/cca-a",
    ],
  );
  const buildLog = path.join(outputDir, "build.log");
  const firstBuildLogMtime = fs.statSync(buildLog).mtimeMs;

  const secondRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_MAKE_ARG_FILE: makeArgFile,
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(secondRun.status, 0, secondRun.stderr + secondRun.stdout);
  assert.equal(JSON.parse(fs.readFileSync(resultFile, "utf8")).details.reused, true);
  assert.equal(fs.statSync(buildLog).mtimeMs, firstBuildLogMtime);

  fs.writeFileSync(makeArgFile, "BR2_EXTERNAL=/tmp/cca-b\n", "utf8");

  const thirdRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_BUILDROOT_SOURCE: sourceDir,
      MORPHEUS_BUILDROOT_OUTPUT: outputDir,
      MORPHEUS_BUILDROOT_DEFCONFIG: "qemu_aarch64_virt_defconfig",
      MORPHEUS_BUILDROOT_MAKE_ARG_FILE: makeArgFile,
      MORPHEUS_BUILDROOT_RESULT_FILE: resultFile,
      MORPHEUS_BUILDROOT_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(thirdRun.status, 0, thirdRun.stderr + thirdRun.stdout);
  assert.equal(JSON.parse(fs.readFileSync(resultFile, "utf8")).details.reused, false);
  assert.notEqual(fs.statSync(buildLog).mtimeMs, firstBuildLogMtime);
  assert.deepEqual(
    fs.readFileSync(path.join(outputDir, "defconfig.log"), "utf8").trim().split("\n"),
    [
      "configured qemu_aarch64_virt_defconfig",
      "BR2_EXTERNAL=/tmp/cca-b",
      "applied olddefconfig",
      "BR2_EXTERNAL=/tmp/cca-b",
    ],
  );
});
