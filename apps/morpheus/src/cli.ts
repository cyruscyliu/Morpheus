#!/usr/bin/env node
// @ts-nocheck

const path = require("path");
const { handleConfigCommand } = require("./config-check");
const { getContracts } = require("./contracts");
const { handleManagedRunCommand } = require("./remote");
const { handleRunsCommand } = require("./runs");
const { handleToolCommand } = require("./tools");
const { handleWorkflowCommand } = require("./workflow");
const { handleWorkspaceCommand } = require("./workspace");
const { applyConfigDefaults } = require("./config");
const { writeStdout, writeStdoutLine, writeStderrLine } = require("./io");

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
      "  node apps/morpheus/dist/cli.js workspace create [--json]",
      "  node apps/morpheus/dist/cli.js workspace show [--json]",
      "  node apps/morpheus/dist/cli.js config check [--json]",
      "  node apps/morpheus/dist/cli.js tool <subcommand> [--json]",
      "  node apps/morpheus/dist/cli.js workflow <subcommand> [--json]",
      "  node apps/morpheus/dist/cli.js contracts",
      "  node apps/morpheus/dist/cli.js runs list [--json] [--run-root <path>]",
      "  node apps/morpheus/dist/cli.js runs list --managed [--json] [--workspace DIR] [--ssh TARGET]",
      "  node apps/morpheus/dist/cli.js runs inspect --id RUN_ID [--json]",
      "  node apps/morpheus/dist/cli.js runs logs --id RUN_ID [--follow] [--json]",
      "  node apps/morpheus/dist/cli.js runs fetch --id RUN_ID --dest DIR --path RUN_PATH [--path RUN_GLOB ...] [--json]",
      "  node apps/morpheus/dist/cli.js runs remove --id RUN_ID [--json]",
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

function extractSubcommand(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      return {
        subcommand: token,
        rest: [...argv.slice(0, index), ...argv.slice(index + 1)]
      };
    }
  }
  return { subcommand: null, rest: [...argv] };
}

function resolveWorkspaceRoot(flags) {
  const { flags: resolvedRunDefaults } = applyConfigDefaults(
    { tool: "runs", workspace: flags.workspace || null },
    { allowGlobalRemote: false, allowToolDefaults: false }
  );
  return resolvedRunDefaults.workspace || path.join(process.cwd(), "hyperarm-workspace");
}

function looksLikeWorkflowRun(workspaceRoot, runId) {
  if (!runId || runId.startsWith("wf-") === false) {
    return false;
  }
  return require("fs").existsSync(path.join(workspaceRoot, "runs", runId, "workflow.json"));
}

async function main() {
  const argv = process.argv.slice(2);
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];

  if (!command || command === "help" || command === "--help") {
    usage();
    return 0;
  }

  if (command === "contracts") {
    printJson(getContracts());
    return 0;
  }

  if (command === "workspace") {
    return handleWorkspaceCommand(argvWithoutCommand(argv, "workspace"));
  }

  if (command === "config") {
    return handleConfigCommand(argvWithoutCommand(argv, "config"));
  }

  if (command === "runs") {
    const runsArgv = argvWithoutCommand(argv, "runs");
    const { subcommand: runsCommand, rest } = extractSubcommand(runsArgv);
    const managedAlias = runsCommand === "list" && rest.includes("--managed");
    const managedSubcommands = new Set(["inspect", "logs", "fetch", "remove"]);
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const runIdFlagIndex = rest.indexOf("--id");
    const runId = runIdFlagIndex >= 0 ? rest[runIdFlagIndex + 1] : null;
    if (managedAlias) {
      return await handleManagedRunCommand(
        "list",
        rest.filter((token) => token !== "--managed")
      );
    }
    if ((runsCommand === "inspect" || runsCommand === "logs") && looksLikeWorkflowRun(workspaceRoot, runId)) {
      return handleWorkflowCommand([runsCommand, ...rest]);
    }
    if (managedSubcommands.has(runsCommand)) {
      return await handleManagedRunCommand(runsCommand, rest);
    }
    return handleRunsCommand([runsCommand, ...rest].filter(Boolean), {
      runRoot: path.join(workspaceRoot, "runs"),
      outputRoot: path.join(workspaceRoot, "runs-view")
    });
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
