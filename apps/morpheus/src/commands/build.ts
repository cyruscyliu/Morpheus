// @ts-nocheck
const { handleToolLifecycleCommand } = require("../core/tool-invoke");

function buildUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js build --tool <name> [--workspace DIR] [--source DIR] [--build-version VER] [--archive-url URL] [--build-dir-key KEY] [--json] [-- <tool args>]",
  ].join("\n");
}

async function handleBuildCommand(argv) {
  return handleToolLifecycleCommand("build", argv, buildUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleBuildCommand,
};
