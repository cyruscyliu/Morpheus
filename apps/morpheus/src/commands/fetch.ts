// @ts-nocheck
const { handleToolLifecycleCommand } = require("../core/tool-invoke");

function fetchUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js fetch --tool <name> [--workspace DIR] [--build-version VER] [--archive-url URL] [--source DIR] [--downloads-dir DIR] [--json]",
  ].join("\n");
}

async function handleFetchCommand(argv) {
  return handleToolLifecycleCommand("fetch", argv, fetchUsage(), { allowGlobalRemote: true });
}

module.exports = {
  handleFetchCommand,
};
