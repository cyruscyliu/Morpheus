#!/usr/bin/env node
// @ts-nocheck

const path = require("path");
const { getContracts } = require("./contracts");
const { handleManagedRunCommand } = require("./remote");
const { handleRunsCommand } = require("./runs");
const { handleToolCommand } = require("./tools");
const { handleWorkspaceCommand } = require("./workspace");
const { workspacePaths } = require("./paths");

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
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stdout.write(
    [
      "Usage:",
      "  node apps/morpheus/dist/cli.js run --tool buildroot --mode local --workspace DIR (--source DIR | --buildroot-version VER) [--json]",
      "  node apps/morpheus/dist/cli.js run --tool buildroot --mode remote --ssh TARGET --workspace DIR (--source DIR | --buildroot-version VER) [--json]",
      "  node apps/morpheus/dist/cli.js list [--workspace DIR] [--ssh TARGET] [--json]",
      "  node apps/morpheus/dist/cli.js inspect --id RUN_ID [--json]",
      "  node apps/morpheus/dist/cli.js logs --id RUN_ID [--follow] [--json]",
      "  node apps/morpheus/dist/cli.js fetch --id RUN_ID --dest DIR --path RUN_PATH [--json]",
      "  node apps/morpheus/dist/cli.js remove --id RUN_ID [--json]",
      "  node apps/morpheus/dist/cli.js workspace create [--json]",
      "  node apps/morpheus/dist/cli.js workspace show [--json]",
      "  node apps/morpheus/dist/cli.js tool <subcommand> [--json]",
      "  node apps/morpheus/dist/cli.js contracts",
      "  node apps/morpheus/dist/cli.js runs list [--json] [--run-root <path>]",
      "  node apps/morpheus/dist/cli.js runs show <run-id> [--json] [--run-root <path>]",
      "  node apps/morpheus/dist/cli.js runs export-html [<run-id>] [--out <path>] [--run-root <path>]"
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

function main() {
  const argv = process.argv.slice(2);
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const paths = workspacePaths();

  if (!command || command === "help" || command === "--help") {
    usage();
    return 0;
  }

  if (command === "contracts") {
    printJson(getContracts());
    return 0;
  }

  if (["run", "list", "inspect", "logs", "fetch", "remove"].includes(command)) {
    return handleManagedRunCommand(command, argvWithoutCommand(argv, command));
  }

  if (command === "workspace") {
    return handleWorkspaceCommand(argvWithoutCommand(argv, "workspace"));
  }

  if (command === "runs") {
    return handleRunsCommand(argvWithoutCommand(argv, "runs"), {
      runRoot: paths.runs,
      outputRoot: path.join(paths.root, "runs-view")
    });
  }

  if (command === "tool") {
    return handleToolCommand(argvWithoutCommand(argv, "tool"));
  }

  throw new Error(`unknown command: ${command}`);
}

try {
  process.exitCode = main();
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
    process.stderr.write(`${error.message}\n`);
  }
  process.exitCode = 1;
}
