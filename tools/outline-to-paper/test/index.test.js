const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const bin = path.join(repoRoot, "tools", "outline-to-paper", "index.js");

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    ...options,
  });
}

function managedEnv(runDir) {
  return {
    ...process.env,
    MORPHEUS_RUN_DIR_OVERRIDE: runDir,
  };
}

function writeCurrentOutlineVersion(workspace, versionName, outline) {
  const versionsDir = path.join(workspace, "outline-versions");
  const versionPath = path.join(versionsDir, `${versionName}.json`);
  const currentPath = path.join(workspace, "current-outline.json");
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

test("run emits stable paper artifacts", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = path.join(projectRoot, "managed-run");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
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

  const result = run(["run", "--json", "--workspace", workspace, "--outline", outline], {
    env: managedEnv(runDir),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "success");
  const manifest = JSON.parse(fs.readFileSync(payload.details.manifest, "utf8"));
  assert.equal(Array.isArray(manifest.artifacts), true);
  assert.equal(fs.existsSync(path.join(payload.details.run_dir, "draft", "paper.tex")), true);
});

test("inspect and logs read an existing run", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-inspect-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = path.join(projectRoot, "managed-run");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
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

  const first = JSON.parse(run(["run", "--json", "--workspace", workspace, "--outline", outline], {
    env: managedEnv(runDir),
  }).stdout);
  const inspect = run(["inspect", "--json", "--workspace", workspace], {
    env: managedEnv(runDir),
  });
  assert.equal(inspect.status, 0, inspect.stderr || inspect.stdout);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.equal(inspectPayload.details.id, first.details.id);

  const logs = run(["logs", "--json", "--workspace", workspace], {
    env: managedEnv(runDir),
  });
  assert.equal(logs.status, 0, logs.stderr || logs.stdout);
  const logPayload = JSON.parse(logs.stdout);
  assert.match(logPayload.details.text, /\[outline-to-paper\] run start/);
});

test("run supports stage-limited execution through --only-phase", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-phase-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = path.join(projectRoot, "managed-run");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
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

  const result = run(["run", "--json", "--workspace", workspace, "--outline", outline, "--only-phase", "revise"], {
    env: managedEnv(runDir),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.details.phases, ["revise"]);
  assert.equal(fs.existsSync(path.join(runDir, "revise", "revision-plan.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "draft", "paper.tex")), false);
});

test("revise output preserves nested outline contract without legacy top-level claims", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-revise-"));
  const workspace = path.join(projectRoot, "workspace");
  const runDir = path.join(projectRoot, "managed-run");
  const outline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
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

  const result = run(["run", "--json", "--workspace", workspace, "--outline", outline, "--only-phase", "revise"], {
    env: managedEnv(runDir),
  });
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
  const runDir = path.join(projectRoot, "managed-run");
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
  writeCurrentOutlineVersion(workspace, "outline-v0001", {
    title: "Current Outline",
    sections: [
      {
        section_id: "current-sec",
        title: "Current Section",
        paragraphs: []
      }
    ]
  });

  const result = run(["run", "--json", "--workspace", workspace, "--outline", sourceOutline, "--only-phase", "outline"], {
    env: managedEnv(runDir),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const normalized = JSON.parse(fs.readFileSync(path.join(runDir, "outline", "normalized-outline.json"), "utf8"));
  assert.equal(normalized.title, "Current Outline");
});

test("revise phase prefers normalized outline and updates current-outline symlink to a new version", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-loop-"));
  const workspace = path.join(projectRoot, "workspace");
  const workflowRunDir = path.join(workspace, "runs", "wf-test");
  const outlineRunDir = path.join(workflowRunDir, "steps", "outline_phase", "run");
  const reviseRunDir = path.join(workflowRunDir, "steps", "revise_phase", "run");
  const sourceOutline = path.join(projectRoot, "outline.json");
  fs.mkdirSync(workspace, { recursive: true });
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

  const result = run(["run", "--json", "--workspace", workspace, "--outline", sourceOutline, "--only-phase", "revise"], {
    env: managedEnv(reviseRunDir),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const revised = JSON.parse(fs.readFileSync(path.join(reviseRunDir, "revise", "revised-outline.json"), "utf8"));
  assert.equal(revised.title, "Normalized Outline");
  const currentPath = path.join(workspace, "current-outline.json");
  assert.equal(fs.lstatSync(currentPath).isSymbolicLink(), true);
  const versionPath = path.resolve(path.dirname(currentPath), fs.readlinkSync(currentPath));
  const versioned = JSON.parse(fs.readFileSync(versionPath, "utf8"));
  assert.equal(versioned.schema_version, 1);
  assert.equal(versioned.source, "revise-phase");
  assert.equal(versioned.outline.title, "Normalized Outline");
});
