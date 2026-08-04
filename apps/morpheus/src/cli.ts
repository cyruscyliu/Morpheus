#!/usr/bin/env node
// @ts-nocheck

const fs = require("fs");
const path = require("path");
const { handleConfigCommand } = require("./commands/config-check");
const { handleBuildCommand } = require("./commands/build");
const { handleFetchCommand } = require("./commands/fetch");
const { handleInspectCommand } = require("./commands/inspect");
const { handleLogsCommand } = require("./commands/logs");
const { handlePatchCommand } = require("./commands/patch");
const { handleExecCommand } = require("./commands/exec");
const { handleGenhtmlCommand } = require("./commands/genhtml");
const { handlePostprocessCommand } = require("./commands/postprocess");
const { handleStopCommand } = require("./commands/stop");
const { handleToolCommand } = require("./commands/tools");
const { handleWorkflowCommand } = require("./commands/workflow");
const { findConfigPath, normalizeMorpheusEnv } = require("./core/config");
const { writeStdout, writeStdoutLine, writeStderrLine } = require("./core/io");

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(normalized);
  if (!match) {
    throw new Error(`invalid .env entry: ${line}`);
  }

  let value = match[2];
  if (value.startsWith("\"") && value.endsWith("\"")) {
    value = value.slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, "\"");
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }

  return {
    key: match[1],
    value
  };
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, entry.key)) {
      process.env[entry.key] = entry.value;
    }
  }
  return true;
}

function loadProjectEnv(explicitConfigPath) {
  const candidates = [process.cwd()];
  if (explicitConfigPath) {
    candidates.push(path.dirname(path.resolve(explicitConfigPath)));
  }

  const seen = new Set();
  for (const startDir of candidates) {
    let current = path.resolve(startDir);
    while (true) {
      if (!seen.has(current)) {
      const envPath = path.join(current, ".env");
      if (loadEnvFile(envPath)) {
        normalizeMorpheusEnv();
        return envPath;
      }
      seen.add(current);
    }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  normalizeMorpheusEnv();
  return null;
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const booleanFlags = new Set(["json", "help", "verbose"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positionals.push(...argv.slice(index));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!booleanFlags.has(key) && next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

function printJson(value) {
  writeStdoutLine(JSON.stringify(value, null, 2));
}

function usage() {
  writeStdout(
    [
      "Usage:",
      "  ./bin/morpheus <command> [options]",
      "",
      "Commands:",
      "  config check       Validate morpheus.yaml.",
      "  tool list          List declared tools and their readiness.",
      "  workflow runs      List managed workflow instances.",
      "  workflow list      List configured workflows.",
      "  workflow export    Export a runnable workflow bundle.",
      "  workflow run       Start a configured workflow.",
      "  workflow resume    Resume a workflow instance.",
      "  workflow inspect   Inspect workflow state and stages.",
      "  workflow events    Print workflow events.",
      "  workflow logs      Print workflow stage logs.",
      "  workflow stop      Stop a running workflow instance.",
      "  workflow remove    Remove a stopped workflow instance.",
      "",
      "Start Here:",
      "  ./bin/morpheus tool list",
      "  ./bin/morpheus --config <workspace-root>/morpheus.yaml config show --json",
      "  ./bin/morpheus --config <workspace-root>/morpheus.yaml workflow list --json",
      "  ./bin/morpheus --config <workspace-root>/morpheus.yaml config check --json",
      "  ./bin/morpheus --config <workspace-root>/morpheus.yaml workflow runs --json",
      "  ./bin/morpheus --config <workspace-root>/morpheus.yaml workflow run --name <workflow> --json",
      "",
      "Examples:",
      "  ./bin/morpheus --config <workspace-root>/morpheus.yaml workflow inspect --name <workflow> --json",
      "  ./bin/morpheus --config <workspace-root>/morpheus.yaml workflow logs --name <workflow> --stage <stage-id>",
      "",
      "Notes:",
      "  - Prefer passing --config explicitly for workflow commands.",
      "  - Use --json for machine-readable output.",
      "  - Tool execution is workflow-first; start with 'workflow run'."
    ].join("\n") + "\n"
  );
}

function argvWithoutCommand(argv, command) {
  const index = argv.indexOf(command);
  if (index < 0) {
    return [...argv];
  }
  return [...argv.slice(0, index), ...argv.slice(index + 1)];
}

function stripGlobalFlags(argv) {
  const next = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--config") {
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) {
        index += 1;
      }
      continue;
    }
    next.push(token);
  }
  return next;
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rawArgv);
  const explicitConfig = typeof flags.config === "string" ? String(flags.config) : null;
  loadProjectEnv(explicitConfig);
  const wantsHelp = Boolean(flags.help) || positionals[0] === "help" || rawArgv.includes("--help");
  const command = positionals[0];
  const subcommand = positionals[1];
  const isReadOnlyConfigCommand =
    command === "config"
    && (
      subcommand === "show"
      || (subcommand === "check" && !flags.json)
    );
  const isReadOnlyWorkflowCommand = command === "workflow" && ["list", "runs", "inspect", "events", "logs"].includes(String(subcommand || ""));
  const suppressImplicitConfigWarning = wantsHelp || isReadOnlyConfigCommand || isReadOnlyWorkflowCommand;
  if (flags.config && typeof flags.config === "string") {
    process.env.MORPHEUS_CONFIG = path.resolve(String(flags.config));
  }
  const argv = stripGlobalFlags(rawArgv);
  const configAwareCommands = new Set(["config", "fetch", "patch", "build", "inspect", "logs", "exec", "postprocess", "genhtml", "stop", "workflow"]);

  if (!command || command === "help" || command === "--help") {
    usage();
    return 0;
  }

  if (!suppressImplicitConfigWarning && !explicitConfig && !process.env.MORPHEUS_CONFIG && configAwareCommands.has(String(command))) {
    const implicitConfig = findConfigPath(process.cwd());
    if (implicitConfig) {
      writeStderrLine(`warning: using implicitly discovered config ${implicitConfig}; pass --config explicitly`);
    }
  }

  if (command === "config") {
    return handleConfigCommand(argvWithoutCommand(argv, "config"));
  }

  if (command === "fetch") {
    return handleFetchCommand(argvWithoutCommand(argv, "fetch"));
  }

  if (command === "patch") {
    return handlePatchCommand(argvWithoutCommand(argv, "patch"));
  }

  if (command === "build") {
    return handleBuildCommand(argvWithoutCommand(argv, "build"));
  }

  // Keep these passthrough commands for internal workflow execution and
  // compatibility, even though workflow-first commands are the documented
  // public surface.
  if (command === "inspect") {
    return handleInspectCommand(argvWithoutCommand(argv, "inspect"));
  }

  if (command === "logs") {
    return handleLogsCommand(argvWithoutCommand(argv, "logs"));
  }

  if (command === "exec") {
    return handleExecCommand(argvWithoutCommand(argv, "exec"));
  }

  if (command === "postprocess") {
    return handlePostprocessCommand(argvWithoutCommand(argv, "postprocess"));
  }

  if (command === "genhtml") {
    return handleGenhtmlCommand(argvWithoutCommand(argv, "genhtml"));
  }

  if (command === "stop") {
    return handleStopCommand(argvWithoutCommand(argv, "stop"));
  }

  if (command === "tool") {
    return await handleToolCommand(argvWithoutCommand(argv, "tool"));
  }

  if (command === "workflow") {
    return handleWorkflowCommand(argvWithoutCommand(argv, "workflow"));
  }

  throw new Error(`unknown command: ${command}`);
}

(async () => {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (process.argv.includes("--json")) {
      printJson({
        command: process.argv.slice(2).filter((arg) => arg !== "--json").slice(0, 2).join(" ") || "help",
        status: "error",
        exit_code: 1,
        summary: error.message,
        error: {
          code: "morpheus_error",
          message: error.message
        }
      });
    } else {
      writeStderrLine(error.message);
    }
    process.exitCode = 1;
  }
})();
