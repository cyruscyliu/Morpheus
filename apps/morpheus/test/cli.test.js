const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const bin = path.join(appRoot, "dist", "cli.js");
const fixtureRuns = path.join(appRoot, "test", "fixtures", "runs");

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: path.resolve(appRoot, "..", ".."),
    ...options
  });
}

test("workspace show returns JSON metadata", () => {
  const result = run(["workspace", "show", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.root, "work");
  assert.equal(typeof payload.directories.runs.exists, "boolean");
});

test("tool list discovers repo-local tools", () => {
  const result = run(["tool", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.tools.map((tool) => tool.name),
    ["buildroot", "llbic", "llcg"]
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
