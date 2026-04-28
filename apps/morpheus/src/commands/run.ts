// @ts-nocheck
const { handleToolPassthroughCommand } = require("../core/tool-invoke");

function runUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js run --tool <name> [--json] [tool run flags]",
    "  node apps/morpheus/dist/cli.js run --tool <name> [--json] -- [tool run flags]",
  ].join("\n");
}

async function handleRunCommand(argv) {
  return handleToolPassthroughCommand("run", argv, runUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleRunCommand,
};
