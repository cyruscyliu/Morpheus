const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { handleEvalCommand } = require("../dist/commands/eval.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeScript(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  fs.chmodSync(file, 0o755);
  return path.basename(file);
}

function writeConfig(dir, lines) {
  fs.mkdirSync(path.join(dir, ".morpheus"), { recursive: true });
  const file = path.join(dir, "morpheus.yaml");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function withConfig(configPath, fn) {
  const previous = process.env.MORPHEUS_CONFIG;
  const previousCwd = process.cwd();
  process.env.MORPHEUS_CONFIG = configPath;
  process.chdir(path.dirname(configPath));
  try {
    return fn();
  } finally {
    process.chdir(previousCwd);
    if (previous === undefined) {
      delete process.env.MORPHEUS_CONFIG;
    } else {
      process.env.MORPHEUS_CONFIG = previous;
    }
  }
}

test("eval run dispatches multiple comma-separated entries sequentially", async () => {
  const dir = tempDir("morpheus-eval-multi-");
  const markerA = path.join(dir, "marker-a");
  const markerB = path.join(dir, "marker-b");
  const scriptA = writeScript(dir, "battery-a.sh", `echo a >> "${markerA}"\n`);
  const scriptB = writeScript(dir, "battery-b.sh", `echo b >> "${markerB}"\n`);
  const configPath = writeConfig(dir, [
    "workflows:",
    "  sample-build:",
    "    category: build",
    "    steps:",
    "      - id: sample_step",
    "        tool: sample",
    "        command: build",
    "evaluation-entries:",
    `  eval-a:`,
    `    script: ${scriptA}`,
    `  eval-b:`,
    `    script: ${scriptB}`,
  ]);
  await withConfig(configPath, async () => {
    const code = await handleEvalCommand(["run", "--entry", "eval-a,eval-b"]);
    assert.equal(code, 0);
    assert.ok(fs.existsSync(markerA), "entry eval-a ran");
    assert.ok(fs.existsSync(markerB), "entry eval-b ran");
  });
});

test("eval run --parallel dispatches entries concurrently", async () => {
  const dir = tempDir("morpheus-eval-par-");
  const timeline = path.join(dir, "timeline");
  const scriptA = writeScript(dir, "battery-a.sh",
    `date +%s%N >> "${timeline}"; sleep 1.5; date +%s%N >> "${timeline}"\n`);
  const scriptB = writeScript(dir, "battery-b.sh",
    `date +%s%N >> "${timeline}"; sleep 1.5; date +%s%N >> "${timeline}"\n`);
  const configPath = writeConfig(dir, [
    "workflows:",
    "  sample-build:",
    "    category: build",
    "    steps:",
    "      - id: sample_step",
    "        tool: sample",
    "        command: build",
    "evaluation-entries:",
    `  eval-a:`,
    `    script: ${scriptA}`,
    `  eval-b:`,
    `    script: ${scriptB}`,
  ]);
  const started = Date.now();
  await withConfig(configPath, async () => {
    const code = await handleEvalCommand(["run", "--entry", "eval-a,eval-b", "--parallel"]);
    assert.equal(code, 0);
  });
  const elapsedMs = Date.now() - started;
  const stamps = fs.readFileSync(timeline, "utf8").trim().split("\n").map(Number).sort((a, b) => a - b);
  assert.equal(stamps.length, 4, "both entries recorded start and end");
  assert.ok(elapsedMs < 2800, `entries overlapped (took ${elapsedMs}ms; sequential would exceed 4s)`);
});

test("eval run rejects an unknown entry in a multi-entry list", async () => {
  const dir = tempDir("morpheus-eval-unknown-");
  const scriptA = writeScript(dir, "battery-a.sh", "true\n");
  const configPath = writeConfig(dir, [
    "workflows:",
    "  sample-build:",
    "    category: build",
    "    steps:",
    "      - id: sample_step",
    "        tool: sample",
    "        command: build",
    "evaluation-entries:",
    `  eval-a:`,
    `    script: ${scriptA}`,
  ]);
  await withConfig(configPath, async () => {
    const code = await handleEvalCommand(["run", "--entry", "eval-a,eval-missing"]);
    assert.equal(code, 1);
  });
});
