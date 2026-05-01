// @ts-nocheck
const { handleToolPassthroughCommand } = require("../core/tool-invoke");

function execUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js exec --tool <name> [--json] [tool exec flags]",
    "  node apps/morpheus/dist/cli.js exec --tool <name> [--json] -- [tool exec flags]",
  ].join("\n");
}

async function handleExecCommand(argv) {
  return handleToolPassthroughCommand("exec", argv, execUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleExecCommand,
};
