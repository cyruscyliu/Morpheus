const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const buildScript = path.join(repoRoot, "tools", "linux", "scripts", "build.sh");
const fixtureSource = path.join(
  repoRoot,
  "tools",
  "linux",
  "tests",
  "fixtures",
  "minimal-linux-src",
);

test("linux build reuses an existing output tree when the inputs are unchanged", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-linux-build-"));
  const sourceDir = path.join(tmpDir, "source");
  const outputDir = path.join(tmpDir, "output");
  const resultFile = path.join(tmpDir, "result.json");
  const makeArgFile = path.join(tmpDir, "make-args.txt");

  fs.cpSync(fixtureSource, sourceDir, { recursive: true });
  fs.writeFileSync(makeArgFile, "CROSS_COMPILE=synthetic-cross-\n", "utf8");

  const firstRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_LINUX_SOURCE: sourceDir,
      MORPHEUS_LINUX_OUTPUT: outputDir,
      MORPHEUS_LINUX_DEFCONFIG: "qemu_virt_defconfig",
      MORPHEUS_LINUX_MAKE_ARG_FILE: makeArgFile,
      MORPHEUS_LINUX_RESULT_FILE: resultFile,
      MORPHEUS_LINUX_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(firstRun.status, 0, firstRun.stderr + firstRun.stdout);
  const firstResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(firstResult.details.reused, false);

  const buildLog = path.join(outputDir, "build.log");
  const buildLogMtime = fs.statSync(buildLog).mtimeMs;
  assert.deepEqual(
    fs.readFileSync(path.join(outputDir, "defconfig.log"), "utf8").trim().split("\n"),
    ["configured qemu_virt_defconfig", "applied olddefconfig"],
  );
  assert.deepEqual(
    fs.readFileSync(path.join(outputDir, "make-args.log"), "utf8").trim().split("\n"),
    [
      "defconfig-cross=synthetic-cross-",
      "olddefconfig-cross=synthetic-cross-",
      "image-cross=synthetic-cross-",
    ],
  );
  assert.equal(fs.existsSync(path.join(outputDir, "arch", "arm64", "boot", "Image")), true);
  assert.equal(fs.existsSync(path.join(outputDir, "vmlinux")), true);

  const secondRun = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_LINUX_SOURCE: sourceDir,
      MORPHEUS_LINUX_OUTPUT: outputDir,
      MORPHEUS_LINUX_DEFCONFIG: "qemu_virt_defconfig",
      MORPHEUS_LINUX_MAKE_ARG_FILE: makeArgFile,
      MORPHEUS_LINUX_RESULT_FILE: resultFile,
      MORPHEUS_LINUX_REUSE_BUILD_DIR: "true",
    },
  });
  assert.equal(secondRun.status, 0, secondRun.stderr + secondRun.stdout);
  const secondResult = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(secondResult.details.reused, true);
  assert.equal(fs.statSync(buildLog).mtimeMs, buildLogMtime);
});

test("linux build replaces duplicate config symbols from a fragment", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-linux-config-"));
  const sourceDir = path.join(tmpDir, "source");
  const outputDir = path.join(tmpDir, "output");
  const resultFile = path.join(tmpDir, "result.json");
  const fragmentFile = path.join(tmpDir, "fragment.config");

  fs.cpSync(fixtureSource, sourceDir, { recursive: true });
  fs.writeFileSync(
    fragmentFile,
    "# CONFIG_OVERRIDE is not set\nCONFIG_OVERRIDE=y\n# CONFIG_BASE is not set\nCONFIG_NEW=y\n",
    "utf8",
  );

  const result = spawnSync("bash", [buildScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_LINUX_SOURCE: sourceDir,
      MORPHEUS_LINUX_OUTPUT: outputDir,
      MORPHEUS_LINUX_DEFCONFIG: "qemu_virt_defconfig",
      MORPHEUS_LINUX_CONFIG_FRAGMENT_FILE: fragmentFile,
      MORPHEUS_LINUX_RESULT_FILE: resultFile,
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);

  const config = fs.readFileSync(path.join(outputDir, ".config"), "utf8");
  assert.match(config, /^# CONFIG_BASE is not set$/m);
  assert.match(config, /^CONFIG_OVERRIDE=y$/m);
  assert.match(config, /^CONFIG_NEW=y$/m);
  assert.doesNotMatch(config, /^# CONFIG_OVERRIDE is not set$/m);
});
