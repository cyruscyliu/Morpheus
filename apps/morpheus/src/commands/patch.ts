// @ts-nocheck
const { handleToolLifecycleCommand } = require("../core/tool-invoke");

function patchUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js patch --tool <name> [--workspace DIR] [--source DIR] --patch-dir DIR [--json]",
  ].join("\n");
}

async function handlePatchCommand(argv) {
  return handleToolLifecycleCommand("patch", argv, patchUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handlePatchCommand,
};
