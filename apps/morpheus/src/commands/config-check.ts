// @ts-nocheck
const path = require("path");
const { loadConfig, configDir, resolveConfiguredWorkspaceRoot } = require("../core/config");
const { workflowTemplateIssues, resolveWorkflowTemplateRecord } = require("../core/workflow-templates");
const { evaluationEntryIssues } = require("../core/evaluation-entries");
const { writeStdoutLine } = require("../core/io");

const ALLOWED_TOOL_MODES = ["local", "remote"];
const TOOL_PATH_KEYS = new Set([
  "patch-dir",
  "source",
  "sources",
  "output",
  "conf",
  "path",
  "executable",
  "toolchain",
  "microkit-dir",
  "sel4-dir",
  "libvmm-dir",
  "toolchain-dir",
]);

function usage() {
  return [
    "Usage:",
    "  morpheus [--config PATH] config show [--json]",
    "  morpheus [--config PATH] config check [--json]",
    "",
    "Purpose:",
    "  Validate morpheus.yaml and report config issues before running workflows.",
    "  Use 'config show' to inspect the resolved config, workspace, and run-root.",
    "",
    "Commands:",
    "  config show        Show resolved config, workspace, and run-root details.",
    "  config check       Validate morpheus.yaml.",
    "",
    "Examples:",
    "  morpheus config show",
    "  morpheus --config <workspace-root>/morpheus.yaml config show --json",
    "  morpheus config check",
    "  morpheus --config <workspace-root>/morpheus.yaml config check --json"
  ].join("\n");
}

function printJson(value) {
  writeStdoutLine(JSON.stringify(value, null, 2));
}

function isWorkspaceRelativePath(value) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  if (text.startsWith("~")) {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(text)) {
    return false;
  }
  return !path.isAbsolute(text);
}

function checkToolModes(value) {
  const issues = [];
  const tools = value.tools || {};
  for (const [toolName, toolConfig] of Object.entries(tools)) {
    if (!toolConfig || typeof toolConfig !== "object") {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(toolConfig, "mode")) {
      continue;
    }
    const mode = toolConfig.mode;
    if (!mode) {
      continue;
    }
    if (!ALLOWED_TOOL_MODES.includes(mode)) {
      issues.push({
        level: "error",
        path: `tools.${toolName}.mode`,
        message: `invalid mode '${mode}', expected one of: local, remote`
      });
    }
  }
  return issues;
}

function checkToolPaths(value) {
  const issues = [];
  const tools = value.tools || {};
  for (const [toolName, toolConfig] of Object.entries(tools)) {
    if (!toolConfig || typeof toolConfig !== "object") {
      continue;
    }
    for (const [key, raw] of Object.entries(toolConfig)) {
      if (raw == null) {
        continue;
      }
      if (typeof raw !== "string") {
        continue;
      }
      if (String(key).toLowerCase().endsWith("-url") || String(key).toLowerCase().includes("url")) {
        continue;
      }
      const pathKey = TOOL_PATH_KEYS.has(key) || String(key).endsWith("-dir");
      if (!pathKey) {
        continue;
      }
      if (!isWorkspaceRelativePath(raw)) {
        issues.push({
          level: "error",
          path: `tools.${toolName}.${key}`,
          message: "tool path values must be workspace-relative (no absolute paths or ~)"
        });
      }
    }
  }
  return issues;
}

function checkCacheConfig(value) {
  const issues = [];
  const cache = value.cache;
  if (!cache || typeof cache !== "object") {
    return issues;
  }
  // cache.root in morpheus.yaml is the only cache source. When omitted,
  // tool trees stay workspace-local.
  if (cache.root && !cache.namespace) {
    issues.push({
      level: "error",
      path: "cache.namespace",
      message: "cache.namespace is required when cache.root is configured"
    });
  }
  return issues;
}

function checkWorkflowRunDirs(value) {
  const issues = [];
  const workflows = value.workflows;
  if (!workflows || typeof workflows !== "object") {
    return issues;
  }
  for (const [workflowName, workflow] of Object.entries(workflows)) {
    const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] || {};
      const args = Array.isArray(step.args) ? step.args : [];
      const runDirIndex = args.findIndex((item) => item === "--run-dir");
      if (runDirIndex < 0 || !args[runDirIndex + 1]) {
        continue;
      }
      issues.push({
        level: "warn",
        path: `workflows.${workflowName}.steps.${index}.args`,
        message: "workflow step sets --run-dir; prefer the step-local runtime directory unless an override is required"
      });
    }
  }
  return issues;
}

// Validate every `{{steps.<id>...}}` reference in every concrete workflow's
// resolved step args: the referenced step id must be one of the workflow's
// own steps. Artifact-alias validity is left to the runtime, which consumes
// the tool's own emitted result payload.
function checkStepArtifactReferences(value) {
  const issues = [];
  const workflows = value.workflows;
  if (!workflows || typeof workflows !== "object") {
    return issues;
  }
  for (const [workflowName] of Object.entries(workflows)) {
    let expanded = null;
    try {
      expanded = resolveWorkflowTemplateRecord(value, workflowName);
    } catch {
      continue;
    }
    if (!expanded || !Array.isArray(expanded.stages)) {
      continue;
    }
    const stepIds = new Set();
    const scanSteps = [];
    for (const stage of expanded.stages) {
      for (const step of (stage && stage.steps) || []) {
        if (step && step.id) {
          stepIds.add(String(step.id));
          scanSteps.push(step);
        }
      }
    }
    for (const step of Array.isArray(expanded.steps) ? expanded.steps : []) {
      if (step && step.id) {
        stepIds.add(String(step.id));
        scanSteps.push(step);
      }
    }
    for (const step of scanSteps) {
      if (!step || !step.tool || !Array.isArray(step.args)) {
        continue;
      }
      for (const arg of step.args) {
        for (const match of String(arg || "").matchAll(/\{\{\s*steps\.([^.}\s]+)/g)) {
          const stepId = match[1];
          if (!stepIds.has(stepId)) {
            issues.push({
              level: "error",
              path: `workflows.${workflowName}.steps.${step.id}`,
              message: `step reference points to unknown step: ${stepId}`,
            });
          }
        }
      }
    }
  }
  return issues;
}

// Workflows reuse cached build artifacts by matching --build-dir-key
// strings. Steps that share a (tool, command, --build-dir-key) triple must
// agree on the build-defining arguments; per-run flags (source tree,
// output dir, run dir) are excluded. Steps without an explicit
// --build-dir-key inherit the tool config's default key and are grouped
// under it too. Divergence makes the cache behavior uncertain: one
// consumer's rebuild clobbers what the others expect.
function checkBuildKeyConsistency(value) {
  const issues = [];
  const workflows = value.workflows;
  if (!workflows || typeof workflows !== "object") {
    return issues;
  }
  const runSpecificFlags = new Set(["--source", "--source-dir", "--output", "--run-dir"]);
  const groups = new Map();
  for (const [workflowName] of Object.entries(workflows)) {
    let expanded = null;
    try {
      expanded = resolveWorkflowTemplateRecord(value, workflowName);
    } catch {
      continue;
    }
    if (!expanded) {
      continue;
    }
    const collect = (steps) => {
      for (const step of steps || []) {
        if (!step || !step.tool || !Array.isArray(step.args)) {
          continue;
        }
        if (step.command && step.command !== "build") {
          continue;
        }
        const keyIndex = step.args.findIndex((item) => item === "--build-dir-key");
        let buildKey = keyIndex >= 0 ? String(step.args[keyIndex + 1] || "") : "";
        if (!buildKey) {
          const toolConfig = value.tools && typeof value.tools === "object"
            ? value.tools[step.tool]
            : null;
          buildKey = toolConfig && typeof toolConfig === "object"
            ? String(toolConfig["build-dir-key"] || "")
            : "";
        }
        if (!buildKey) {
          continue;
        }
        const args = step.args.filter((arg, index) => (
          !runSpecificFlags.has(String(arg))
          && String(arg) !== "--build-dir-key"
          && String(step.args[index - 1] || "") !== "--build-dir-key"
          && (index === 0 || !runSpecificFlags.has(String(step.args[index - 1])))
        ));
        const groupKey = `${step.tool}|${step.command || "exec"}|${buildKey}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push({
          workflow: workflowName,
          step: String(step.id),
          signature: JSON.stringify(args),
        });
      }
    };
    for (const stage of Array.isArray(expanded.stages) ? expanded.stages : []) {
      collect(stage && stage.steps);
    }
    collect(Array.isArray(expanded.steps) ? expanded.steps : null);
  }
  for (const [groupKey, members] of groups) {
    const first = members[0];
    const diverged = members.find((member) => member.signature !== first.signature);
    if (diverged) {
      const label = groupKey.split("|").join(" / ");
      issues.push({
        level: "warn",
        path: `workflows.${diverged.workflow}.steps.${diverged.step}`,
        message: `build key ${label} is shared by ${members.length} steps with diverging arguments; the cache reuse behavior is uncertain`,
      });
    }
  }
  return issues;
}

function formatText(result) {
  const lines = [
    "Config check",
    `  config: ${result.details.config}`,
    `  status: ${result.status === "success" ? "ok" : "error"}`,
    `  summary: ${result.summary}`,
  ];
  if (result.issues.length === 0) {
    return lines.join("\n");
  }
  const warnings = result.issues.filter((issue) => issue.level === "warn");
  const errors = result.issues.filter((issue) => issue.level !== "warn");
  return [
    ...lines,
    ...(warnings.length > 0 ? [
      "Warnings:",
      ...warnings.map((issue) => `  warn: ${issue.path}: ${issue.message}`),
    ] : []),
    ...(errors.length > 0 ? [
      "Issues:",
      ...errors.map((issue) => `  ${issue.level}: ${issue.path}: ${issue.message}`)
    ] : [])
  ].join("\n");
}

function runConfigShow() {
  const config = loadConfig(process.cwd());
  if (!config.path) {
    throw new Error("could not find morpheus.yaml");
  }
  const baseDir = configDir(config.path);
  const workspaceRoot = resolveConfiguredWorkspaceRoot(config.value || {}, baseDir);
  const workflows = config.value && config.value.workflows && typeof config.value.workflows === "object"
    ? config.value.workflows
    : {};
  return {
    command: "config show",
    status: "success",
    exit_code: 0,
    summary: "resolved morpheus config",
    details: {
      config: path.relative(process.cwd(), config.path) || "morpheus.yaml",
      config_path: config.path,
      workspace_root: workspaceRoot,
      workflow_root: path.join(workspaceRoot, "runs"),
      run_root: path.join(workspaceRoot, "runs"),
      workflow_count: Object.keys(workflows).length,
    },
  };
}

function runConfigCheck(explicitConfigPath = null) {
  const config = loadConfig(process.cwd(), { explicitPath: explicitConfigPath });
  if (!config.path) {
    throw new Error("could not find morpheus.yaml");
  }
  const issues = [
    ...checkCacheConfig(config.value || {}),
    ...checkToolModes(config.value || {}),
    ...checkToolPaths(config.value || {}),
    ...checkWorkflowRunDirs(config.value || {}),
    ...workflowTemplateIssues(config.value || {}),
    ...checkStepArtifactReferences(config.value || {}),
    ...checkBuildKeyConsistency(config.value || {}),
    ...evaluationEntryIssues(config.value || {}, configDir(config.path)),
  ];
  const hasErrors = issues.some((issue) => issue.level !== "warn");
  return {
    command: "config check",
    status: hasErrors ? "error" : "success",
    exit_code: hasErrors ? 1 : 0,
    summary: hasErrors
      ? "morpheus.yaml validation failed"
      : (issues.length > 0 ? "morpheus.yaml passed validation with warnings" : "morpheus.yaml passed validation"),
    details: {
      config: path.relative(process.cwd(), config.path) || "morpheus.yaml",
      allowed_tool_modes: ALLOWED_TOOL_MODES,
      issues
    },
    issues
  };
}

function parseConfigArgs(argv) {
  const positionals = [];
  const flags = {};

  for (const token of argv) {
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    flags[token.slice(2)] = true;
  }

  return { positionals, flags };
}

function handleConfigCommand(argv) {
  const { positionals, flags } = parseConfigArgs(argv);
  const subcommand = positionals[0];
  const json = Boolean(flags.json);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    writeStdoutLine(usage());
    return 0;
  }
  if (subcommand !== "check" && subcommand !== "show") {
    throw new Error(`unknown config command: ${subcommand}`);
  }
  const result = subcommand === "show" ? runConfigShow() : runConfigCheck();
  if (json) {
    printJson(result);
  } else {
    writeStdoutLine(subcommand === "show"
      ? [
          "Config show",
          `  config: ${result.details.config}`,
          `  workspace_root: ${result.details.workspace_root}`,
          `  workflow_root: ${result.details.workflow_root}`,
          `  workflow_count: ${result.details.workflow_count}`,
        ].join("\n")
      : formatText(result));
  }
  return result.exit_code;
}

module.exports = {
  ALLOWED_TOOL_MODES,
  runConfigShow,
  runConfigCheck,
  handleConfigCommand
};
