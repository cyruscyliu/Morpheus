// @ts-nocheck
const path = require("path");
const { loadConfig } = require("./config");
const { writeStdoutLine } = require("./io");

const ALLOWED_TOOL_MODES = ["local", "remote"];

function usage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js config check [--json]"
  ].join("\n");
}

function printJson(value) {
  writeStdoutLine(JSON.stringify(value, null, 2));
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

function formatText(result) {
  if (result.issues.length === 0) {
    return `ok: ${result.summary}`;
  }
  return result.issues
    .map((issue) => `${issue.level}: ${issue.path}: ${issue.message}`)
    .join("\n");
}

function runConfigCheck() {
  const config = loadConfig(process.cwd());
  if (!config.path) {
    throw new Error("could not find morpheus.yaml");
  }
  const issues = [
    ...checkToolModes(config.value || {})
  ];
  return {
    command: "config check",
    status: issues.length === 0 ? "success" : "error",
    exit_code: issues.length === 0 ? 0 : 1,
    summary: issues.length === 0
      ? "morpheus.yaml passed validation"
      : "morpheus.yaml validation failed",
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
