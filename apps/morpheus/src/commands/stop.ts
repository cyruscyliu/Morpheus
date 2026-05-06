// @ts-nocheck
const { handleToolPassthroughCommand } = require("../core/tool-invoke");

function stopUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js stop --tool <name> [--workspace DIR] [--json] [-- <tool args>]",
  ].join("\n");
}

async function handleStopCommand(argv) {
  return handleToolPassthroughCommand("stop", argv, stopUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleStopCommand,
};
