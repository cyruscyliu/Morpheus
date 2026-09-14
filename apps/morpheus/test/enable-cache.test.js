const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "enable-cache.mjs");

test("enable-cache requires an explicit project config", () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--config PATH is required/);
});

test("enable-cache rejects the CI-only config", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--config", "tests/morpheus.yaml"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CI-only/);
});

test("enable-cache migrates legacy .cache roots into an explicit cache.root", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-enable-cache-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-enable-cache-data-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const configPath = path.join(projectRoot, "morpheus.yaml");
  const cacheRoot = path.join(dataRoot, "cache");
  const legacyBuildDir = path.join(workspaceRoot, "tools", "qemu", "builds", "demo");
  const migratedBuildDir = path.join(
    cacheRoot,
    "hyperarm",
    "tools",
    "qemu",
    "builds",
    "demo",
  );

  fs.mkdirSync(legacyBuildDir, { recursive: true });
  fs.writeFileSync(path.join(legacyBuildDir, "marker.txt"), "ok\n", "utf8");
  fs.writeFileSync(
    configPath,
    [
      "workspace:",
      "  root: ./workspace",
      "cache:",
      "  root: ./.cache",
      "  namespace: hyperarm",
      "tools:",
      "  qemu:",
      "    build-version: 11.0.3",
      "    build-dir-key: demo",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = spawnSync(process.execPath, [scriptPath, "--config", configPath, "--root", cacheRoot], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.cache_root, cacheRoot);
    assert.equal(fs.existsSync(path.join(migratedBuildDir, "marker.txt")), true);

    const rewrittenConfig = fs.readFileSync(configPath, "utf8");
    assert.match(rewrittenConfig, /root:\s+/);
    assert.doesNotMatch(rewrittenConfig, /\.cache/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
