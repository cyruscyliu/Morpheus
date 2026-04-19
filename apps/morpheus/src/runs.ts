// @ts-nocheck
const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return readJson(filePath);
}

function readJsonLinesIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseRunArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

function runsUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js runs list [--json] [--run-root <path>]",
    "  node apps/morpheus/dist/cli.js runs show <run-id> [--json] [--run-root <path>]",
    "  node apps/morpheus/dist/cli.js runs export-html [<run-id>] [--out <path>] [--run-root <path>]"
  ].join("\n");
}

function formatValue(value) {
  if (value == null) {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatDurationMs(durationMs) {
  if (durationMs == null || Number.isNaN(durationMs)) {
    return "incomplete";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function summarizeFields(summary) {
  const preferredKeys = [
    "requestedKernelVersion",
    "resolvedKernelVersion",
    "arch",
    "scopeMode",
    "interface",
    "buildMode",
    "verificationStatus"
  ];
  const pairs = [];
  const seen = new Set();

  for (const key of preferredKeys) {
    if (summary && Object.prototype.hasOwnProperty.call(summary, key)) {
      pairs.push(`${key}=${formatValue(summary[key])}`);
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(summary || {})) {
    if (!seen.has(key)) {
      pairs.push(`${key}=${formatValue(value)}`);
    }
  }

  return pairs;
}

function getRunRoot(flags, options) {
  return path.resolve(flags["run-root"] || options.runRoot);
}

function getOutputPath(flags, options, runId) {
  if (flags.out) {
    return path.resolve(flags.out);
  }

  const baseDir = path.resolve(options.outputRoot);
  if (runId) {
    return path.join(baseDir, `${runId}.html`);
  }
  return path.join(baseDir, "index.html");
}

function normalizeRunSummary(runDir, runRecord, indexRecord) {
  const createdAt = runRecord.createdAt || null;
  const completedAt = runRecord.completedAt || null;
  const durationMs =
    createdAt && completedAt
      ? Math.max(0, Date.parse(completedAt) - Date.parse(createdAt))
      : null;

  return {
    id: runRecord.id || path.basename(runDir),
    kind: runRecord.kind || "run",
    status: runRecord.status || "unknown",
    changeName: runRecord.changeName || null,
    createdAt,
    completedAt,
    durationMs,
    durationLabel: formatDurationMs(durationMs),
    runDir,
    summary: runRecord.summary || {},
    summaryFields: summarizeFields(runRecord.summary || {}),
    stepCount: indexRecord.stepCount || 0,
    artifactCount: indexRecord.artifactCount || 0,
    assessmentCount: indexRecord.assessmentCount || 0,
    steps: Array.isArray(indexRecord.steps) ? indexRecord.steps : []
  };
}

function listRunSummaries(runRoot) {
  if (!fs.existsSync(runRoot)) {
    return [];
  }

  return fs
    .readdirSync(runRoot)
    .map((name) => path.join(runRoot, name))
    .filter((runDir) => fs.existsSync(runDir) && fs.statSync(runDir).isDirectory())
    .map((runDir) => {
      const runPath = path.join(runDir, "run.json");
      if (!fs.existsSync(runPath)) {
        return null;
      }

      const runRecord = readJson(runPath);
      const indexRecord = readJsonIfExists(path.join(runDir, "index.json"), {});
      return normalizeRunSummary(runDir, runRecord, indexRecord);
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftKey = left.createdAt || left.id;
      const rightKey = right.createdAt || right.id;
      return rightKey.localeCompare(leftKey);
    });
}

function loadAssessments(stepDir) {
  if (!fs.existsSync(stepDir)) {
    return [];
  }

  return fs
    .readdirSync(stepDir)
    .filter((name) => name.startsWith("assessment-") && name.endsWith(".json"))
    .sort()
    .map((name) => readJson(path.join(stepDir, name)));
}

function normalizeStep(step, stepDir) {
  const artifacts = readJsonIfExists(path.join(stepDir, "artifacts.json"), []);
  const invocation = readJsonIfExists(path.join(stepDir, "invocation.json"), null);
  const assessments = loadAssessments(stepDir);

  return {
    id: step.id,
    name: step.name || path.basename(stepDir),
    kind: step.kind || "unknown",
    description: step.description || "",
    status: step.status || "unknown",
    startedAt: step.startedAt || null,
    endedAt: step.endedAt || null,
    dir: stepDir,
    artifacts,
    artifactCount: artifacts.length,
    assessments,
    assessmentCount: assessments.length,
    invocation,
    invocationRecorded: Boolean(invocation)
  };
}

function listStepDirectories(runDir) {
  const stepsDir = path.join(runDir, "steps");
  if (!fs.existsSync(stepsDir)) {
    return [];
  }

  return fs
    .readdirSync(stepsDir)
    .map((name) => path.join(stepsDir, name))
    .filter((entry) => fs.statSync(entry).isDirectory())
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

function loadRunDetail(runRoot, runId) {
  const runDir = path.join(runRoot, runId);
  const runPath = path.join(runDir, "run.json");
  if (!fs.existsSync(runPath)) {
    throw new Error(`run not found: ${runId}`);
  }

  const runRecord = readJson(runPath);
  const indexRecord = readJsonIfExists(path.join(runDir, "index.json"), {});
  const summary = normalizeRunSummary(runDir, runRecord, indexRecord);
  const intent = readJsonIfExists(path.join(runDir, "intent.json"), null);
  const contracts = readJsonIfExists(path.join(runDir, "contracts.json"), null);
  const relations = readJsonLinesIfExists(path.join(runDir, "relations.jsonl"));
  const indexedSteps = new Map();
  for (const step of summary.steps) {
    indexedSteps.set(step.id, step);
  }

  const steps = listStepDirectories(runDir).map((stepDir) => {
    const stepRecord = readJsonIfExists(path.join(stepDir, "step.json"), {
      id: path.basename(stepDir)
    });
    const indexed = indexedSteps.get(stepRecord.id) || {};
    return normalizeStep({ ...indexed, ...stepRecord }, stepDir);
  });

  return {
    ...summary,
    intent,
    contracts,
    relations,
    relationCount: relations.length,
    steps
  };
}

function formatRunListText(runs) {
  if (runs.length === 0) {
    return "No runs found.";
  }

  return runs
    .map((run) => {
      const summary = run.summaryFields.length > 0 ? ` ${run.summaryFields.join(" ")}` : "";
      return [
        `[${run.status}]`,
        run.createdAt || "-",
        run.id,
        `steps=${run.stepCount}`,
        `artifacts=${run.artifactCount}`,
        `assessments=${run.assessmentCount}`,
        `duration=${run.durationLabel}${summary}`
      ].join(" ");
    })
    .join("\n");
}

function formatStepText(step) {
  const lines = [
    `- ${step.id} ${step.name} kind=${step.kind} status=${step.status}`,
    `  started=${step.startedAt || "-"} ended=${step.endedAt || "-"}`,
    `  invocation=${step.invocationRecorded ? "recorded" : "missing"} artifacts=${step.artifactCount} assessments=${step.assessmentCount}`
  ];

  if (step.artifacts.length > 0) {
    lines.push("  artifacts:");
    for (const artifact of step.artifacts) {
      lines.push(
        `    - ${artifact.id} role=${formatValue(artifact.role)} type=${formatValue(artifact.type)} path=${formatValue(artifact.path)}`
      );
    }
  } else {
    lines.push("  artifacts: none");
  }

  if (step.assessments.length > 0) {
    lines.push("  assessments:");
    for (const assessment of step.assessments) {
      lines.push(
        `    - ${assessment.id} kind=${formatValue(assessment.kind)} status=${formatValue(assessment.status)}`
      );
    }
  } else {
    lines.push("  assessments: none");
  }

  return lines.join("\n");
}

function formatRunDetailText(run) {
  const lines = [
    `Run ${run.id}`,
    `kind=${run.kind} status=${run.status} change=${run.changeName || "-"} duration=${run.durationLabel}`,
    `created=${run.createdAt || "-"} completed=${run.completedAt || "-"}`,
    `steps=${run.stepCount} artifacts=${run.artifactCount} assessments=${run.assessmentCount} relations=${run.relationCount}`
  ];

  if (run.summaryFields.length > 0) {
    lines.push(`summary: ${run.summaryFields.join(" ")}`);
  } else {
    lines.push("summary: none");
  }

  lines.push("");
  lines.push("Steps:");
  if (run.steps.length === 0) {
    lines.push("- none");
  } else {
    for (const step of run.steps) {
      lines.push(formatStepText(step));
    }
  }

  lines.push("");
  lines.push("Relations:");
  if (run.relations.length === 0) {
    lines.push("- none");
  } else {
    for (const relation of run.relations) {
      lines.push(
        `- ${formatValue(relation.from)} --${formatValue(relation.edge)}--> ${formatValue(relation.to)}`
      );
    }
  }

  lines.push("");
  lines.push("Intent:");
  lines.push(run.intent ? JSON.stringify(run.intent, null, 2) : "unavailable");

  lines.push("");
  lines.push("Contracts:");
  lines.push(run.contracts ? JSON.stringify(run.contracts, null, 2) : "unavailable");

  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderKeyValueList(entries) {
  if (!entries || entries.length === 0) {
    return '<p class="empty">None recorded.</p>';
  }

  return [
    '<ul class="kv-list">',
    ...entries.map(
      ([label, value]) =>
        `<li><span class="kv-key">${escapeHtml(label)}</span><span class="kv-value">${escapeHtml(formatValue(value))}</span></li>`
    ),
    "</ul>"
  ].join("");
}

function renderJsonBlock(value) {
  if (!value) {
    return '<p class="empty">Unavailable.</p>';
  }

  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function renderArtifactList(items) {
  if (!items || items.length === 0) {
    return '<p class="empty">No artifacts recorded.</p>';
  }

  return [
    '<ul class="record-list">',
    ...items.map(
      (artifact) => {
        const artifactPath = formatValue(artifact.path);
        const href =
          artifactPath && artifactPath !== "-"
            ? `file://${encodeURI(String(artifactPath))}`
            : null;
        const pathMarkup = href
          ? `<a class="path-link" href="${href}">${escapeHtml(artifactPath)}</a>`
          : `<code>${escapeHtml(artifactPath)}</code>`;

        return `<li><strong>${escapeHtml(artifact.label || artifact.id || "artifact")}</strong><span>${escapeHtml(
          `role=${formatValue(artifact.role)} type=${formatValue(artifact.type)}`
        )}</span>${pathMarkup}</li>`;
      }
    ),
    "</ul>"
  ].join("");
}

function renderAssessmentList(items) {
  if (!items || items.length === 0) {
    return '<p class="empty">No assessments recorded.</p>';
  }

  return [
    '<ul class="record-list">',
    ...items.map(
      (assessment) =>
        `<li><strong>${escapeHtml(assessment.id || assessment.kind || "assessment")}</strong><span>${escapeHtml(
          `kind=${formatValue(assessment.kind)} status=${formatValue(assessment.status)}`
        )}</span></li>`
    ),
    "</ul>"
  ].join("");
}

function renderRelationList(items) {
  if (!items || items.length === 0) {
    return '<p class="empty">No relations recorded.</p>';
  }

  return [
    '<ul class="relation-list">',
    ...items.map(
      (relation) =>
        `<li><code>${escapeHtml(formatValue(relation.from))}</code><span class="relation-edge">${escapeHtml(
          formatValue(relation.edge)
        )}</span><code>${escapeHtml(formatValue(relation.to))}</code></li>`
    ),
    "</ul>"
  ].join("");
}

function summarizeRunNarrative(run) {
  const summary = run.summary || {};
  const target = summary.interface || summary.scopeMode || run.kind || "run";
  const kernel = summary.resolvedKernelVersion || summary.requestedKernelVersion;

  if (run.status === "success") {
    return `Succeeded${kernel ? ` on kernel ${kernel}` : ""}${target ? ` for ${target}` : ""}.`;
  }

  if (run.status === "failure") {
    const failingStep =
      (run.steps || []).find((step) => step.status === "failure") ||
      (run.steps || []).find((step) => step.kind === "assessment" && step.status !== "success");
    return `Failed${failingStep ? ` in ${failingStep.name}` : ""}${kernel ? ` on kernel ${kernel}` : ""}.`;
  }

  if (run.status === "running") {
    return `Still running with ${run.stepCount} recorded step${run.stepCount === 1 ? "" : "s"}${target ? ` for ${target}` : ""}.`;
  }

  return `Recorded ${run.kind || "run"} history entry.`;
}

function renderStepCards(steps) {
  if (!steps || steps.length === 0) {
    return '<p class="empty">No steps recorded.</p>';
  }

  return steps
    .map((step) => {
      const stepMeta = [
        ["Kind", step.kind],
        ["Started", step.startedAt || "-"],
        ["Ended", step.endedAt || "-"],
        ["Invocation", step.invocationRecorded ? "recorded" : "missing"]
      ];
      const openAttr =
        step.status === "failure" || step.status === "running" ? " open" : "";

      return [
        `<details class="step-card"${openAttr}>`,
        `<summary><span class="step-title">${escapeHtml(step.name)}</span><span class="step-meta">${escapeHtml(
          `${step.id} • ${step.artifactCount} artifacts • ${step.assessmentCount} assessments`
        )}</span><span class="status status-${escapeHtml(step.status)}">${escapeHtml(step.status)}</span></summary>`,
        `<div class="step-body">`,
        renderKeyValueList(stepMeta),
        `<div class="split"><div><h5>Artifacts</h5>${renderArtifactList(step.artifacts)}</div><div><h5>Assessments</h5>${renderAssessmentList(step.assessments)}</div></div>`,
        `</div>`,
        `</details>`
      ].join("");
    })
    .join("");
}

function renderRunCard(run) {
  const summaryMeta = [
    ["Kind", run.kind],
    ["Created", run.createdAt || "-"],
    ["Completed", run.completedAt || "-"],
    ["Duration", run.durationLabel],
    ["Change", run.changeName || "-"]
  ];
  const headline = summarizeRunNarrative(run);

  return [
    `<article class="run-card" id="${escapeHtml(run.id)}">`,
    `<div class="card-header"><div><p class="eyebrow">${escapeHtml(run.kind)}</p><h2>${escapeHtml(
      run.id
    )}</h2><p class="headline">${escapeHtml(headline)}</p></div><span class="status status-${escapeHtml(
      run.status
    )}">${escapeHtml(run.status)}</span></div>`,
    renderKeyValueList(summaryMeta),
    `<section><h4>Key Facts</h4>${run.summaryFields.length > 0 ? `<div class="chips">${run.summaryFields
      .map((field) => `<span class="chip">${escapeHtml(field)}</span>`)
      .join("")}</div>` : '<p class="empty">No summary fields recorded.</p>'}</section>`,
    `<section><h4>Flow</h4>${renderStepCards(run.steps)}</section>`,
    `<section><details><summary>Relations</summary>${renderRelationList(run.relations)}</details></section>`,
    `<section class="split"><div><details><summary>Intent</summary>${renderJsonBlock(
      run.intent
    )}</details></div><div><details><summary>Contracts</summary>${renderJsonBlock(
      run.contracts
    )}</details></div></section>`,
    `</article>`
  ].join("");
}

function renderRunsIndexPage(runRoot, runs) {
  const statusCounts = {};
  for (const run of runs) {
    statusCounts[run.status] = (statusCounts[run.status] || 0) + 1;
  }

  const runCards = runs
    .map((run) => {
      const headline = summarizeRunNarrative(run);
      const chips =
        run.summaryFields.length > 0
          ? `<div class="chips compact">${run.summaryFields
              .slice(0, 3)
              .map((field) => `<span class="chip">${escapeHtml(field)}</span>`)
              .join("")}</div>`
          : '<p class="empty">No summary fields recorded.</p>';

      return [
        `<article class="run-summary-card status-edge-${escapeHtml(run.status)}">`,
        `<a class="summary-card-link" href="${encodeURIComponent(run.id)}.html" aria-label="Open ${escapeHtml(
          run.id
        )}"></a>`,
        `<div class="card-header compact"><div><p class="eyebrow">${escapeHtml(run.kind)}</p><h3>${escapeHtml(
          run.id
        )}</h3><p class="headline small">${escapeHtml(headline)}</p></div><span class="status status-${escapeHtml(
          run.status
        )}">${escapeHtml(run.status)}</span></div>`,
        `<div class="summary-meta"><span>${escapeHtml(run.createdAt || "-")}</span><span>${escapeHtml(
          run.durationLabel
        )}</span><span>${escapeHtml(run.changeName || "no change")}</span><span>steps ${escapeHtml(
          run.stepCount
        )}</span><span>artifacts ${escapeHtml(run.artifactCount)}</span><span>assessments ${escapeHtml(
          run.assessmentCount
        )}</span></div>`,
        chips,
        "</article>"
      ].join("");
    })
    .join("");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Morpheus Runs</title>",
    `<style>
      :root { color-scheme: light; --bg:#f4f1e8; --ink:#1f1d1a; --muted:#6f675c; --panel:#fffdf8; --border:#d8cfbf; --accent:#165d52; --success:#1f7a4d; --failure:#b13a2d; --running:#9a6b10; }
      * { box-sizing:border-box; }
      body { margin:0; font-family:"IBM Plex Sans","Segoe UI",sans-serif; background:linear-gradient(180deg,#f7f3ea 0%,#efe8da 100%); color:var(--ink); }
      main { max-width:1040px; margin:0 auto; padding:22px 16px 40px; }
      header { margin-bottom:14px; }
      h1,h2,h3,h4,h5,p { margin:0; }
      h1 { font-size:2rem; margin-bottom:4px; }
      p.lede { color:var(--muted); max-width:72ch; font-size:0.96rem; }
      .overview { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
      .panel, .run-card, .run-summary-card, .step-card { background:rgba(255,253,248,0.94); border:1px solid var(--border); border-radius:14px; padding:12px; box-shadow:0 8px 20px rgba(77,57,33,0.06); }
      .panel { padding:10px 12px; }
      .status { display:inline-flex; align-items:center; border-radius:999px; padding:4px 10px; font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; }
      .status-success { background:rgba(31,122,77,0.12); color:var(--success); }
      .status-failure { background:rgba(177,58,45,0.12); color:var(--failure); }
      .status-running { background:rgba(154,107,16,0.14); color:var(--running); }
      .status-unknown { background:rgba(111,103,92,0.14); color:var(--muted); }
      .card-header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px; }
      .card-header.compact { margin-bottom:6px; }
      .eyebrow { color:var(--muted); font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px; }
      .headline { color:var(--muted); margin-top:4px; max-width:60ch; }
      .headline.small { font-size:0.92rem; max-width:none; }
      .run-grid { display:grid; gap:8px; }
      .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
      .chip { background:#e8f0ed; color:var(--accent); padding:4px 8px; border-radius:999px; font-size:0.82rem; }
      .summary-meta { display:flex; flex-wrap:wrap; gap:8px 10px; color:var(--muted); font-size:0.86rem; margin:0; }
      .empty { color:var(--muted); font-size:0.9rem; }
      .run-summary-card { position:relative; overflow:hidden; padding:10px 12px; }
      .summary-card-link { position:absolute; inset:0; z-index:1; }
      .run-summary-card > * { position:relative; z-index:2; }
      .status-edge-success { border-left:4px solid var(--success); }
      .status-edge-failure { border-left:4px solid var(--failure); }
      .status-edge-running { border-left:4px solid var(--running); }
      @media (max-width: 900px) { main { padding:18px 12px 28px; } }
    </style>`,
    "</head>",
    "<body>",
    "<main>",
    `<header><h1>Morpheus Runs</h1><p class="lede">Chronological history of recorded runs from <code>${escapeHtml(
      runRoot
    )}</code>. Open any entry to inspect its steps, artifacts, assessments, and provenance.</p></header>`,
    `<section class="overview"><div class="panel"><strong>${runs.length}</strong> runs</div><div class="panel"><strong>${statusCounts.success || 0}</strong> success</div><div class="panel"><strong>${statusCounts.failure || 0}</strong> failure</div><div class="panel"><strong>${statusCounts.running || 0}</strong> running</div></section>`,
    `<section class="run-grid">${runCards}</section>`,
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

function renderSingleRunPage(runRoot, run) {
  const headline = summarizeRunNarrative(run);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(run.id)} - Morpheus Run</title>`,
    `<style>
      body { margin:0; font-family:"IBM Plex Sans","Segoe UI",sans-serif; background:#f3eee3; color:#201d17; }
      main { max-width:920px; margin:0 auto; padding:20px 14px 36px; }
      a { color:#165d52; }
      .hero, .run-card, .step-card { background:#fffdf8; border:1px solid #d8cfbf; border-radius:14px; padding:12px; box-shadow:0 8px 20px rgba(77,57,33,0.06); }
      .hero { margin-bottom:12px; }
      .status { display:inline-flex; border-radius:999px; padding:4px 10px; font-weight:700; text-transform:uppercase; font-size:0.8rem; }
      .status-success { background:rgba(31,122,77,0.12); color:#1f7a4d; }
      .status-failure { background:rgba(177,58,45,0.12); color:#b13a2d; }
      .status-running { background:rgba(154,107,16,0.14); color:#9a6b10; }
      .status-unknown { background:rgba(111,103,92,0.14); color:#6f675c; }
      h1,h2,h3,h4,h5,p { margin:0; }
      .eyebrow { color:#6f675c; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; }
      .headline { color:#6f675c; margin-top:4px; }
      .back { margin-bottom:10px; display:inline-block; }
      .split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      .kv-list, .record-list, .relation-list { list-style:none; padding:0; margin:0; }
      .kv-list li, .record-list li, .relation-list li { padding:6px 0; border-bottom:1px solid rgba(216,207,191,0.6); }
      .kv-list li:last-child, .record-list li:last-child, .relation-list li:last-child { border-bottom:none; }
      .kv-key { display:block; color:#6f675c; font-size:0.85rem; text-transform:uppercase; }
      .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
      .chip { background:#e8f0ed; color:#165d52; padding:4px 8px; border-radius:999px; font-size:0.82rem; }
      pre { white-space:pre-wrap; overflow-wrap:anywhere; background:#f2ede4; border-radius:12px; padding:14px; font-family:"IBM Plex Mono","SFMono-Regular",monospace; font-size:0.9rem; }
      .empty { color:#6f675c; }
      .path-link { font-family:"IBM Plex Mono","SFMono-Regular",monospace; font-size:0.88rem; color:#165d52; text-decoration:none; overflow-wrap:anywhere; }
      .path-link:hover { text-decoration:underline; }
      details { background:#f8f4ec; border:1px solid rgba(216,207,191,0.9); border-radius:12px; padding:12px 14px; }
      details summary { cursor:pointer; font-weight:700; color:#165d52; }
      .step-card summary { display:flex; gap:10px; align-items:center; justify-content:space-between; list-style:none; }
      .step-title { font-weight:700; }
      .step-meta { color:#6f675c; font-size:0.84rem; flex:1; }
      .step-body { margin-top:10px; }
      section { margin-top:12px; }
      @media (max-width: 900px) { .split { grid-template-columns:1fr; } .step-card summary { flex-wrap:wrap; } }
    </style>`,
    "</head>",
    "<body>",
    "<main>",
    `<a class="back" href="index.html">Back to all runs</a>`,
    `<section class="hero"><p class="eyebrow">${escapeHtml(run.kind)}</p><h1>${escapeHtml(
      run.id
    )}</h1><p class="headline">${escapeHtml(headline)}</p><p>Static run export from <code>${escapeHtml(
      runRoot
    )}</code>.</p></section>`,
    renderRunCard(run),
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

function exportRunsHtml(runRoot, outputPath, runId) {
  const runs = listRunSummaries(runRoot);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (runId) {
    const html = renderSingleRunPage(runRoot, loadRunDetail(runRoot, runId));
    fs.writeFileSync(outputPath, `${html}\n`, "utf8");
  } else {
    const details = runs.map((run) => loadRunDetail(runRoot, run.id));
    const indexHtml = renderRunsIndexPage(runRoot, details);
    fs.writeFileSync(outputPath, `${indexHtml}\n`, "utf8");

    for (const run of details) {
      const detailPath = path.join(path.dirname(outputPath), `${run.id}.html`);
      fs.writeFileSync(detailPath, `${renderSingleRunPage(runRoot, run)}\n`, "utf8");
    }
  }

  return {
    runRoot,
    outputPath,
    runId: runId || null,
    generatedAt: new Date().toISOString(),
    mode: runId ? "single-run" : "run-index"
  };
}

function printRunOutput(value, flags, formatter) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatter(value)}\n`);
}

function handleRunsCommand(argv, options) {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    process.stdout.write(`${runsUsage()}\n`);
    return 0;
  }

  const { positionals, flags } = parseRunArgs(argv.slice(1));
  const runRoot = getRunRoot(flags, options);

  if (subcommand === "list") {
    const runs = listRunSummaries(runRoot);
    printRunOutput(
      {
        runRoot,
        count: runs.length,
        runs
      },
      flags,
      (value) => formatRunListText(value.runs)
    );
    return 0;
  }

  if (subcommand === "show") {
    const runId = positionals[0];
    if (!runId) {
      throw new Error("runs show requires a run id");
    }

    const run = loadRunDetail(runRoot, runId);
    printRunOutput(run, flags, formatRunDetailText);
    return 0;
  }

  if (subcommand === "export-html") {
    const runId = positionals[0] || null;
    const output = exportRunsHtml(runRoot, getOutputPath(flags, options, runId), runId);
    printRunOutput(
      output,
      flags,
      (value) => `HTML exported to ${value.outputPath}`
    );
    return 0;
  }

  throw new Error(`unknown runs subcommand: ${subcommand}`);
}

module.exports = {
  handleRunsCommand,
  listRunSummaries,
  loadRunDetail,
  exportRunsHtml
};
