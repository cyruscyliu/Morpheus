// @ts-nocheck
const path = require("path");
const { loadConfig } = require("../core/config");
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
    "  ./bin/morpheus [--config PATH] config check [--json]",
    "",
    "Purpose:",
    "  Validate morpheus.yaml and report config issues before running workflows.",
    "",
    "Commands:",
    "  config check       Validate morpheus.yaml.",
    "",
    "Examples:",
    "  ./bin/morpheus config check",
    "  ./bin/morpheus --config projects/<project>/morpheus.yaml config check --json"
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

function runConfigCheck() {
  const config = loadConfig(process.cwd());
  if (!config.path) {
    throw new Error("could not find morpheus.yaml");
  }
  const issues = [
    ...checkCacheConfig(config.value || {}),
    ...checkToolModes(config.value || {}),
    ...checkToolPaths(config.value || {}),
    ...checkWorkflowRunDirs(config.value || {}),
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
  if (subcommand !== "check") {
    throw new Error(`unknown config command: ${subcommand}`);
  }
  const result = runConfigCheck();
  if (json) {
    printJson(result);
  } else {
    writeStdoutLine(formatText(result));
  }
  return result.exit_code;
}

module.exports = {
  ALLOWED_TOOL_MODES,
  runConfigCheck,
  handleConfigCommand
};
