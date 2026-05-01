const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const bin = path.join(repoRoot, "tools", "outline-to-paper", "index.js");

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    ...options,
  });
}

function writeCurrentOutlineVersion(stateRoot, versionName, outline) {
  const versionsDir = path.join(stateRoot, "outline-versions");
  const versionPath = path.join(versionsDir, `${versionName}.json`);
  const currentPath = path.join(stateRoot, "current-outline.json");
  fs.mkdirSync(versionsDir, { recursive: true });
  fs.writeFileSync(versionPath, JSON.stringify({
    schema_version: 1,
    version_id: versionName,
    updated_at: "2026-04-30T00:00:00.000Z",
    source: "test",
    outline,
  }));
  try {
    fs.unlinkSync(currentPath);
  } catch {}
  fs.symlinkSync(path.relative(path.dirname(currentPath), versionPath), currentPath);
  return { versionPath, currentPath };
}

function workflowRunDir(projectRoot, workflowId, stepId = "outline_to_paper") {
  return path.join(projectRoot, "workspace", "runs", workflowId, "steps", stepId);
}

function ensureStepDir(stepDir, stepId = path.basename(stepDir), tool = "outline-to-paper") {
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "step.json"), JSON.stringify({
    id: stepId,
    name: stepId,
    tool,
    status: "running",
    stepDir,
    toolRunDir: stepDir,
    logFile: path.join(stepDir, "stdout.log"),
  }, null, 2));
}

test("run emits stable paper artifacts", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = workflowRunDir(projectRoot, "wf-run-artifacts");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  ensureStepDir(runDir);
  fs.writeFileSync(outline, JSON.stringify({
    title: "Paper Test",
    sections: [
      {
        section_id: "sec-1",
        title: "Problem",
        purpose: "Explain the main problem.",
        paragraphs: [
          {
            paragraph_id: "p-1",
            role: "argument",
            topic: "Main claim topic.",
            arguments: [
              {
                argument_id: "c1",
                type: "claim",
                text: "Main claim",
                supports: [
                  {
                    support_id: "s1",
                    type: "fact",
                    status: "available",
                    content: "Concrete support for the claim.",
                    reference_ids: []
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }));

  const result = run(["run", "--json", "--workspace", workspace, "--outline", outline], { cwd: runDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  const manifest = JSON.parse(fs.readFileSync(payload.details.manifest, "utf8"));
  assert.equal(Array.isArray(manifest.artifacts), true);
  assert.equal(fs.existsSync(path.join(payload.details.run_dir, "draft", "paper.tex")), true);
  assert.equal(fs.existsSync(path.join(payload.details.run_dir, "outline", "normalized-outline.md")), true);
});

test("run accepts the managed step run subdirectory as cwd", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-step-run-"));
  const workspace = path.join(projectRoot, "workspace");
  const stepDir = workflowRunDir(projectRoot, "wf-step-run");
  const toolRunDir = path.join(stepDir, "run");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  ensureStepDir(stepDir);
  fs.mkdirSync(toolRunDir, { recursive: true });
  fs.writeFileSync(outline, JSON.stringify({
    title: "Paper Test From Run Dir",
    sections: [
      {
        section_id: "sec-1",
        title: "Problem",
        purpose: "Explain the main problem.",
        paragraphs: []
      }
    ]
  }));

  const result = run(["run", "--json", "--workspace", workspace, "--outline", outline], { cwd: toolRunDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  assert.equal(payload.details.run_dir, stepDir);
});

test("inspect and logs read an existing run", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-inspect-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = workflowRunDir(projectRoot, "wf-inspect");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  ensureStepDir(runDir);
  fs.writeFileSync(outline, JSON.stringify({
    title: "Paper Test 2",
    sections: [
      {
        section_id: "sec-1",
        title: "Section One",
        purpose: "Minimal section for inspect/logs test.",
        paragraphs: []
      }
    ]
  }));

  const first = JSON.parse(run(["run", "--json", "--workspace", workspace, "--outline", outline], { cwd: runDir }).stdout);
  const inspect = run(["inspect", "--json", "--workspace", workspace], { cwd: runDir });
  assert.equal(inspect.status, 0, inspect.stderr || inspect.stdout);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.equal(inspectPayload.details.id, first.details.id);

  const logs = run(["logs", "--json", "--workspace", workspace], { cwd: runDir });
  assert.equal(logs.status, 0, logs.stderr || logs.stdout);
  const logPayload = JSON.parse(logs.stdout);
  assert.match(logPayload.details.text, /\[outline-to-paper\] run start/);
});

test("stop marks a managed run as stopped", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-stop-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = workflowRunDir(projectRoot, "wf-stop");
  fs.mkdirSync(workspace, { recursive: true });
  ensureStepDir(runDir);

  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  const manifestPath = path.join(runDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    id: "outline-stop",
    status: "running",
    workspace,
    runDir,
    pid: sleeper.pid,
  }, null, 2));

  const stopped = run(["stop", "--json", "--workspace", workspace], { cwd: runDir });
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  const payload = JSON.parse(stopped.stdout);
  assert.equal(payload.status, "success");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.status, "stopped");
});

test("run supports stage-limited execution through --only-phase", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-phase-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = workflowRunDir(projectRoot, "wf-phase");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  ensureStepDir(runDir);
  fs.writeFileSync(outline, JSON.stringify({
    title: "Phase Test",
    sections: [
      {
        section_id: "sec-1",
        title: "Section One",
        purpose: "Phase test section.",
        paragraphs: [
          {
            paragraph_id: "p-1",
            role: "argument",
            topic: "Main claim topic.",
            arguments: [
              {
                argument_id: "c1",
                type: "claim",
                text: "Main claim",
                supports: [
                  {
                    support_id: "s1",
                    type: "fact",
                    status: "partial",
                    content: "More evidence needed.",
                    reference_ids: []
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }));

  const result = run(["run", "--json", "--workspace", workspace, "--outline", outline, "--only-phase", "revise"], { cwd: runDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.details.phases, ["revise"]);
  assert.equal(fs.existsSync(path.join(runDir, "revise", "revision-plan.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "draft", "paper.tex")), false);
});

test("revise output preserves nested outline contract without legacy top-level claims", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-revise-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = workflowRunDir(projectRoot, "wf-revise");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  ensureStepDir(runDir);
  fs.writeFileSync(outline, JSON.stringify({
    title: "Revise Contract Test",
    sections: [
      {
        section_id: "sec-1",
        title: "Section One",
        purpose: "Revise contract section.",
        paragraphs: [
          {
            paragraph_id: "p-1",
            role: "argument",
            topic: "Main claim topic.",
            arguments: [
              {
                argument_id: "c1",
                type: "claim",
                text: "Main claim",
                supports: [
                  {
                    support_id: "s1",
                    type: "fact",
                    status: "available",
                    content: "Concrete support for the claim.",
                    reference_ids: []
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }));

  const result = run(["run", "--json", "--workspace", workspace, "--outline", outline, "--only-phase", "revise"], { cwd: runDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const revised = JSON.parse(fs.readFileSync(path.join(runDir, "revise", "revised-outline.json"), "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(revised, "claims"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(revised, "supports"), false);
  assert.equal(Array.isArray(revised.sections), true);
  assert.deepEqual(
    Object.keys(revised.sections[0].paragraphs[0].arguments[0].supports[0]).sort(),
    ["content", "reference_ids", "status", "support_id", "type"],
  );
});

test("outline phase prefers current-outline symlink over the requested source outline", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-current-"));
  const workspace = path.join(projectRoot, "workspace");
  const workflowRunDir = path.join(workspace, "runs", "wf-current");
  const runDir = path.join(workflowRunDir, "steps", "outline_phase");
  const sourceOutline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(sourceOutline, JSON.stringify({
    title: "Source Outline",
    sections: [
      {
        section_id: "source-sec",
        title: "Source Section",
        paragraphs: []
      }
    ]
  }));
  writeCurrentOutlineVersion(workflowRunDir, "outline-v0001", {
    title: "Current Outline",
    sections: [
      {
        section_id: "current-sec",
        title: "Current Section",
        paragraphs: []
      }
    ]
  });

  ensureStepDir(runDir, "outline_phase");
  const result = run(["run", "--json", "--workspace", workspace, "--outline", sourceOutline, "--only-phase", "outline"], { cwd: runDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const normalized = JSON.parse(fs.readFileSync(path.join(runDir, "outline", "normalized-outline.json"), "utf8"));
  const normalizedMarkdown = fs.readFileSync(path.join(runDir, "outline", "normalized-outline.md"), "utf8");
  assert.equal(normalized.title, "Current Outline");
  assert.match(normalizedMarkdown, /^# Current Outline$/m);
});

test("revise phase prefers normalized outline and updates current-outline symlink to a new version", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-loop-"));
  const workspace = path.join(projectRoot, "workspace");
  const workflowRunDir = path.join(workspace, "runs", "wf-test");
  const outlineRunDir = path.join(workflowRunDir, "steps", "outline_phase");
  const reviseRunDir = path.join(workflowRunDir, "steps", "revise_phase");
  const sourceOutline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  ensureStepDir(reviseRunDir, "revise_phase");
  fs.writeFileSync(sourceOutline, JSON.stringify({
    title: "Source Outline",
    sections: [
      {
        section_id: "source-sec",
        title: "Source Section",
        paragraphs: [
          {
            paragraph_id: "p-1",
            role: "argument",
            topic: "topic",
            arguments: [
              {
                argument_id: "c1",
                type: "claim",
                text: "Source claim",
                supports: [
                  {
                    support_id: "s1",
                    type: "fact",
                    status: "partial",
                    content: "Need stronger support.",
                    reference_ids: []
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }));
  fs.mkdirSync(path.join(outlineRunDir, "outline"), { recursive: true });
  fs.writeFileSync(path.join(outlineRunDir, "outline", "normalized-outline.json"), JSON.stringify({
    title: "Normalized Outline",
    sections: [
      {
        section_id: "norm-sec",
        title: "Normalized Section",
        paragraphs: [
          {
            paragraph_id: "p-1",
            role: "argument",
            topic: "topic",
            arguments: [
              {
                argument_id: "c1",
                type: "claim",
                text: "Normalized claim",
                supports: [
                  {
                    support_id: "s1",
                    type: "fact",
                    status: "partial",
                    content: "Need stronger support.",
                    reference_ids: []
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }));

  const result = run(["run", "--json", "--workspace", workspace, "--outline", sourceOutline, "--only-phase", "revise"], { cwd: reviseRunDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const revised = JSON.parse(fs.readFileSync(path.join(reviseRunDir, "revise", "revised-outline.json"), "utf8"));
  const revisedMarkdown = fs.readFileSync(path.join(reviseRunDir, "revise", "revised-outline.md"), "utf8");
  assert.equal(revised.title, "Normalized Outline");
  assert.match(revisedMarkdown, /^# Normalized Outline$/m);
  const currentPath = path.join(workflowRunDir, "current-outline.json");
  const currentMarkdownPath = path.join(workflowRunDir, "current-outline.md");
  assert.equal(fs.lstatSync(currentPath).isSymbolicLink(), true);
  const versionPath = path.resolve(path.dirname(currentPath), fs.readlinkSync(currentPath));
  const versioned = JSON.parse(fs.readFileSync(versionPath, "utf8"));
  const currentMarkdown = fs.readFileSync(currentMarkdownPath, "utf8");
  assert.equal(versioned.schema_version, 1);
  assert.equal(versioned.source, "revise-phase");
  assert.equal(versioned.outline.title, "Normalized Outline");
  assert.match(currentMarkdown, /^# Normalized Outline$/m);
});

test("workflow-local current outline does not leak across workflow runs in one workspace", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-workflow-scope-"));
  const workspace = path.join(projectRoot, "workspace");
  const workflowOneRoot = path.join(workspace, "runs", "wf-one");
  const workflowTwoRoot = path.join(workspace, "runs", "wf-two");
  const runDir = path.join(workflowTwoRoot, "steps", "outline_phase");
  const sourceOutline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(sourceOutline, JSON.stringify({
    title: "Requested Outline",
    sections: [
      {
        section_id: "requested-sec",
        title: "Requested Section",
        paragraphs: []
      }
    ]
  }));
  writeCurrentOutlineVersion(workflowOneRoot, "outline-v0001", {
    title: "Workflow One Outline",
    sections: [
      {
        section_id: "wf-one-sec",
        title: "Workflow One Section",
        paragraphs: []
      }
    ]
  });

  ensureStepDir(runDir, "outline_phase");
  const result = run(["run", "--json", "--workspace", workspace, "--outline", sourceOutline, "--only-phase", "outline"], { cwd: runDir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const normalized = JSON.parse(fs.readFileSync(path.join(runDir, "outline", "normalized-outline.json"), "utf8"));
  assert.equal(normalized.title, "Requested Outline");
  assert.equal(fs.existsSync(path.join(workflowTwoRoot, "current-outline.json")), false);
});
