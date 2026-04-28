// @ts-nocheck
const { handleToolPassthroughCommand } = require("../core/tool-invoke");

function logsUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js logs --tool <name> [--json] [tool logs flags]",
    "  node apps/morpheus/dist/cli.js logs --tool <name> [--json] -- [tool logs flags]",
  ].join("\n");
}

async function handleLogsCommand(argv) {
  return handleToolPassthroughCommand("logs", argv, logsUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleLogsCommand,
};
