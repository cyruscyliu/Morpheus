// @ts-nocheck
const { handleToolPassthroughCommand } = require("../core/tool-invoke");

function genhtmlUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js genhtml --tool TOOL --workspace DIR [tool args...] [--json]"
  ].join("\n");
}

async function handleGenhtmlCommand(argv) {
  return handleToolPassthroughCommand("genhtml", argv, genhtmlUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleGenhtmlCommand,
  genhtmlUsage,
};
