#!/usr/bin/env node
// @ts-nocheck

const path = require("path");
const { handleConfigCommand } = require("./commands/config-check");
const { handleBuildCommand } = require("./commands/build");
const { handleFetchCommand } = require("./commands/fetch");
const { handleInspectCommand } = require("./commands/inspect");
const { handleLogsCommand } = require("./commands/logs");
const { handlePatchCommand } = require("./commands/patch");
const { handleExecCommand } = require("./commands/exec");
const { handleToolCommand } = require("./commands/tools");
const { handleWorkflowCommand } = require("./commands/workflow");
const { handleWorkspaceCommand } = require("./commands/workspace");
const { writeStdout, writeStdoutLine, writeStderrLine } = require("./core/io");

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
      "  node apps/morpheus/dist/cli.js workspace create [--workspace DIR] [--json]",
      "  node apps/morpheus/dist/cli.js workspace show [--workspace DIR] [--json]",
      "  node apps/morpheus/dist/cli.js config check [--json]",
      "  node apps/morpheus/dist/cli.js tool list [--json]",
      "  node apps/morpheus/dist/cli.js workflow run --name WORKFLOW_NAME [--json]",
      "  node apps/morpheus/dist/cli.js workflow inspect --id WORKFLOW_RUN_ID [--json]",
      "  node apps/morpheus/dist/cli.js workflow logs --id WORKFLOW_RUN_ID [--step STEP_ID] [--follow] [--json]",
      "  node apps/morpheus/dist/cli.js workflow stop --id WORKFLOW_RUN_ID [--json]",
      "  node apps/morpheus/dist/cli.js workflow remove --id WORKFLOW_RUN_ID [--json]"
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
  if (flags.config && typeof flags.config === "string") {
    process.env.MORPHEUS_CONFIG = path.resolve(String(flags.config));
  }
  const argv = stripGlobalFlags(rawArgv);
  const command = positionals[0];

  if (!command || command === "help" || command === "--help") {
    usage();
    return 0;
  }

  if (command === "workspace") {
    return handleWorkspaceCommand(argvWithoutCommand(argv, "workspace"));
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
