// @ts-nocheck
const { handleToolPassthroughCommand } = require("../core/tool-invoke");

function inspectUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js inspect --tool <name> [--json] [tool inspect flags]",
    "  node apps/morpheus/dist/cli.js inspect --tool <name> [--json] -- [tool inspect flags]",
  ].join("\n");
}

async function handleInspectCommand(argv) {
  return handleToolPassthroughCommand("inspect", argv, inspectUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleInspectCommand,
};
