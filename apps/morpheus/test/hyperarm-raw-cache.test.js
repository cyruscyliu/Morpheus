const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const rawFuzzScript = path.join(
  repoRoot,
  "projects",
  "hyperarm",
  "run-libafl-fuzzing-raw.sh",
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("raw HyperArm fuzzing resolves cache below the configured data root", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-raw-data-"));
  const workspaceRoot = path.join(dataRoot, "workspaces", "hyperarm");
  const configPath = path.join(workspaceRoot, "morpheus.yaml");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(configPath, `workspace:\n  root: ${workspaceRoot}\n`);

  try {
    const result = spawnSync(
      "bash",
      [rawFuzzScript, "--seconds", "1", "--config", configPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MORPHEUS_CACHE_ROOT: "",
          MORPHEUS_CONFIG: "",
          MORPHEUS_DATA_ROOT: "",
          MORPHEUS_WORKSPACES_ROOT: "",
        },
      },
    );

    const expectedState = path.join(
      dataRoot,
      "cache",
      "hyperarm",
      "tools",
      "nvirsh",
      "builds",
      "qemu-debian-arm64",
      "install",
      "state.json",
    );
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(
      result.stderr,
      new RegExp(`missing prepared nvirsh state: ${escapeRegExp(expectedState)}`),
    );
    assert.doesNotMatch(
      result.stderr,
      new RegExp(escapeRegExp(path.join(repoRoot, ".cache", "hyperarm"))),
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
