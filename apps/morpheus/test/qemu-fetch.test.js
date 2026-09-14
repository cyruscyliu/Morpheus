const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const fetchScript = path.join(repoRoot, "tools", "qemu", "scripts", "fetch.sh");
const cli = path.join(repoRoot, "apps", "morpheus", "dist", "cli.js");

test("qemu fetch accepts gzip archives", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-fetch-"));
  const seedDir = path.join(tmpDir, "seed");
  const sourceDir = path.join(tmpDir, "source");
  const downloadsDir = path.join(tmpDir, "downloads");
  const archivePath = path.join(tmpDir, "qemu.tar.gz");
  const resultFile = path.join(tmpDir, "result.json");

  fs.mkdirSync(seedDir);
  fs.writeFileSync(path.join(seedDir, "configure"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(seedDir, "configure"), 0o755);

  const tarResult = spawnSync("tar", ["-czf", archivePath, "-C", tmpDir, "seed"], {
    encoding: "utf8",
  });
  assert.equal(tarResult.status, 0, tarResult.stderr);

  const runResult = spawnSync("bash", [fetchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_ARCHIVE_URL: `file://${archivePath}`,
      MORPHEUS_QEMU_DOWNLOADS_DIR: downloadsDir,
      MORPHEUS_QEMU_RESULT_FILE: resultFile,
      MORPHEUS_QEMU_BUILD_VERSION: "test",
    },
  });

  assert.equal(runResult.status, 0, runResult.stderr + runResult.stdout);
  assert.equal(fs.existsSync(path.join(sourceDir, "configure")), true);
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(result.details.fetched_source, true);
});

test("qemu fetch prefers an explicit archive over a configured seed dir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-fetch-"));
  const seedDir = path.join(tmpDir, "seed");
  const archiveRoot = path.join(tmpDir, "archive-root");
  const sourceDir = path.join(tmpDir, "source");
  const downloadsDir = path.join(tmpDir, "downloads");
  const archivePath = path.join(tmpDir, "qemu.tar.gz");
  const resultFile = path.join(tmpDir, "result.json");

  fs.mkdirSync(seedDir);
  fs.writeFileSync(path.join(seedDir, "configure"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(seedDir, "configure"), 0o755);
  fs.writeFileSync(path.join(seedDir, "seed-only.txt"), "seed\n");

  fs.mkdirSync(archiveRoot);
  fs.writeFileSync(path.join(archiveRoot, "configure"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(archiveRoot, "configure"), 0o755);
  fs.writeFileSync(path.join(archiveRoot, "archive-only.txt"), "archive\n");

  const tarResult = spawnSync("tar", ["-czf", archivePath, "-C", tmpDir, "archive-root"], {
    encoding: "utf8",
  });
  assert.equal(tarResult.status, 0, tarResult.stderr);

  const runResult = spawnSync("bash", [fetchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_SEED_DIR: seedDir,
      MORPHEUS_QEMU_ARCHIVE_URL: `file://${archivePath}`,
      MORPHEUS_QEMU_DOWNLOADS_DIR: downloadsDir,
      MORPHEUS_QEMU_RESULT_FILE: resultFile,
      MORPHEUS_QEMU_BUILD_VERSION: "11.0.3-guest",
    },
  });

  assert.equal(runResult.status, 0, runResult.stderr + runResult.stdout);
  assert.equal(fs.existsSync(path.join(sourceDir, "archive-only.txt")), true);
  assert.equal(fs.existsSync(path.join(sourceDir, "seed-only.txt")), false);

  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(result.details.fetched_source, true);
  assert.match(result.details.archive, /qemu\.tar\.gz$/);
});

test("CLI qemu fetch with a configured seed dir does not auto-infer a default archive URL", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-cli-fetch-"));
  const cacheRoot = path.join(tmpDir, "cache");
  const configPath = path.join(tmpDir, "morpheus.yaml");

  fs.mkdirSync(path.join(tmpDir, ".morpheus"), { recursive: true });
  fs.writeFileSync(
    configPath,
    [
      "cache:",
      "  root: ./cache",
      "  namespace: smoke",
      "  downloads: global",
      "  builds: global",
      "  src: global",
      "tools:",
      "  qemu:",
      `    seed-dir: ${JSON.stringify(path.join(repoRoot, "tools", "qemu", "tests", "fixtures", "minimal-qemu-src"))}`,
      "",
    ].join("\n"),
    "utf8",
  );

  const runResult = spawnSync(process.execPath, [
    cli,
    "--json",
    "fetch",
    "--tool",
    "qemu",
  ], {
    encoding: "utf8",
    cwd: tmpDir,
  });

  assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);
  const payload = JSON.parse(runResult.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(
    payload.details.source,
    path.join(cacheRoot, "smoke", "tools", "qemu", "src", "qemu-default"),
  );
  assert.equal(payload.details.archive_url, null);
  assert.equal(
    fs.existsSync(path.join(cacheRoot, "smoke", "tools", "qemu", "src", "qemu-default", "configure")),
    true,
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("CLI qemu fetch with a configured git url does not auto-infer a default archive URL", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-cli-git-fetch-"));
  const cacheRoot = path.join(tmpDir, "cache");
  const configPath = path.join(tmpDir, "morpheus.yaml");
  const repoDir = path.join(tmpDir, "qemu-upstream");

  fs.mkdirSync(path.join(tmpDir, ".morpheus"), { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });

  const initResult = spawnSync("git", ["init", "--initial-branch=main"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  const branchResult = spawnSync("git", ["checkout", "-b", "cca/2025-09-12"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(branchResult.status, 0, branchResult.stderr || branchResult.stdout);
  fs.writeFileSync(path.join(repoDir, "configure"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const addResult = spawnSync("git", ["add", "configure"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
  const commitResult = spawnSync(
    "git",
    [
      "-c",
      "user.name=Morpheus",
      "-c",
      "user.email=morpheus@example.invalid",
      "commit",
      "-m",
      "seed",
    ],
    {
      cwd: repoDir,
      encoding: "utf8",
    },
  );
  assert.equal(commitResult.status, 0, commitResult.stderr || commitResult.stdout);

  fs.writeFileSync(
    configPath,
    [
      "cache:",
      "  root: ./cache",
      "  namespace: smoke",
      "  downloads: global",
      "  builds: global",
      "  src: global",
      "tools:",
      "  qemu:",
      `    git-url: ${JSON.stringify(repoDir)}`,
      "    git-ref: cca/2025-09-12",
      "    build-version: guest-cca-2025-09-12",
      "",
    ].join("\n"),
    "utf8",
  );

  const runResult = spawnSync(process.execPath, [
    cli,
    "--json",
    "fetch",
    "--tool",
    "qemu",
  ], {
    encoding: "utf8",
    cwd: tmpDir,
  });

  assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);
  const payload = JSON.parse(runResult.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.status, "success");
  assert.equal(
    payload.details.source,
    path.join(cacheRoot, "smoke", "tools", "qemu", "src", "qemu-guest-cca-2025-09-12"),
  );
  assert.equal(payload.details.archive_url, null);
  assert.equal(payload.details.git_url, repoDir);
  assert.equal(payload.details.git_ref, "cca/2025-09-12");
  assert.equal(
    fs.existsSync(path.join(cacheRoot, "smoke", "tools", "qemu", "src", "qemu-guest-cca-2025-09-12", "configure")),
    true,
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
