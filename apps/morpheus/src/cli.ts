#!/usr/bin/env node
// @ts-nocheck

const path = require("path");
const { getContracts } = require("./contracts");
const { handleRemoteCommand } = require("./remote");
const { handleRunsCommand } = require("./runs");
const { handleToolCommand } = require("./tools");
const { handleWorkspaceCommand } = require("./workspace");
const { workspacePaths } = require("./paths");

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const booleanFlags = new Set(["json", "help"]);

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
      "  node apps/morpheus/dist/cli.js remote run --tool buildroot --ssh TARGET --workspace DIR --buildroot-version VER [--json]",
      "  node apps/morpheus/dist/cli.js remote inspect --ssh TARGET --workspace DIR --id RUN_ID [--json]",
      "  node apps/morpheus/dist/cli.js remote logs --ssh TARGET --workspace DIR --id RUN_ID [--follow] [--json]",
      "  node apps/morpheus/dist/cli.js remote fetch --ssh TARGET --workspace DIR --id RUN_ID --dest DIR --path REMOTE_PATH [--json]",
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

function argvAfterCommand(argv, command) {
  const index = argv.indexOf(command);
  if (index < 0) {
    return [];
  }
  return argv.slice(index + 1);
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

  if (command === "remote") {
    return handleRemoteCommand(argvAfterCommand(argv, "remote"));
  }

  if (command === "workspace") {
    return handleWorkspaceCommand(argvAfterCommand(argv, "workspace"));
  }

  if (command === "runs") {
    return handleRunsCommand(argvAfterCommand(argv, "runs"), {
      runRoot: paths.runs,
      outputRoot: path.join(paths.root, "runs-view")
    });
  }

  if (command === "tool") {
    return handleToolCommand(argvAfterCommand(argv, "tool"));
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
