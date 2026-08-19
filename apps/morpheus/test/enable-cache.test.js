const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "enable-cache.mjs");

test("enable-cache migrates legacy .cache roots into MORPHEUS_DATA_ROOT/cache", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-enable-cache-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-enable-cache-data-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  const configPath = path.join(projectRoot, "morpheus.yaml");
  const legacyBuildDir = path.join(workspaceRoot, "tools", "qemu", "builds", "demo");
  const migratedBuildDir = path.join(
    dataRoot,
    "cache",
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
    const result = spawnSync(process.execPath, [scriptPath, "--config", configPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MORPHEUS_DATA_ROOT: dataRoot,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.cache_root, path.join(dataRoot, "cache"));
    assert.equal(fs.existsSync(path.join(migratedBuildDir, "marker.txt")), true);

    const rewrittenConfig = fs.readFileSync(configPath, "utf8");
    assert.doesNotMatch(rewrittenConfig, /cache:\s*\n\s*root:/m);
    assert.doesNotMatch(rewrittenConfig, /\.cache/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
