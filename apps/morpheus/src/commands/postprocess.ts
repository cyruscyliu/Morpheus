// @ts-nocheck
const { handleToolPassthroughCommand } = require("../core/tool-invoke");

function postprocessUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js postprocess --tool TOOL --workspace DIR [tool args...] [--json]"
  ].join("\n");
}

async function handlePostprocessCommand(argv) {
  return handleToolPassthroughCommand("postprocess", argv, postprocessUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handlePostprocessCommand,
  postprocessUsage,
};
