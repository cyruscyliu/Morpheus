#!/usr/bin/env node
// @ts-nocheck

const path = require("path");
const { getContracts } = require("./contracts");
const { handleRunsCommand } = require("./runs");
const { handleToolCommand } = require("./tools");
const { handleWorkspaceCommand } = require("./workspace");
const { workspacePaths } = require("./paths");

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

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
    if (next && !next.startsWith("--")) {
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
      "  node apps/morpheus/dist/cli.js workspace show [--json]",
      "  node apps/morpheus/dist/cli.js tool <subcommand> [--json]",
      "  node apps/morpheus/dist/cli.js contracts",
      "  node apps/morpheus/dist/cli.js runs list [--json] [--run-root <path>]",
      "  node apps/morpheus/dist/cli.js runs show <run-id> [--json] [--run-root <path>]",
      "  node apps/morpheus/dist/cli.js runs export-html [<run-id>] [--out <path>] [--run-root <path>]"
    ].join("\n") + "\n"
  );
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

  if (command === "workspace") {
    return handleWorkspaceCommand(argv.slice(1));
  }

  if (command === "runs") {
    return handleRunsCommand(argv.slice(1), {
      runRoot: paths.runs,
      outputRoot: path.join(paths.root, "runs-view")
    });
  }

  if (command === "tool") {
    return handleToolCommand(argv.slice(1));
  }

  throw new Error(`unknown command: ${command}`);
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
