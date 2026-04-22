// @ts-nocheck
const path = require("path");
const { listDeclaredTools } = require("./tools");

const MORPHEUS_APP_CONTRACT = {
  id: "morpheus-app",
  type: "application",
  description: "Orthogonal management layer for workspace metadata, tools, and runs",
  commands: [
    "workspace create",
    "workspace show",
    "config check",
    "tool build",
    "tool list",
    "runs list",
    "runs list --managed",
    "runs inspect",
    "runs logs",
    "runs fetch",
    "runs remove",
    "runs show",
    "runs export-html",
    "contracts"
  ],
  nonGoals: [
    "workflow scheduling",
    "owning tool lifecycles"
  ]
};

const MANAGED_RUNS_CONTRACT = {
  id: "managed-runs",
  type: "management",
  description: "Manage single-tool local and remote runs with stable Morpheus metadata",
  commands: [
    "tool build --tool buildroot --mode local",
    "tool build --tool buildroot --mode remote",
    "runs list --managed",
    "runs inspect --id <run-id>",
    "runs logs --id <run-id>",
    "runs fetch --id <run-id>",
    "runs remove --id <run-id>"
  ],
  directToolCliBoundary: "direct tool CLIs remain available as unmanaged paths",
  modes: ["local", "remote"],
  firstAdapter: "buildroot"
};

const WORKSPACE_CONTRACT = {
  id: "workspace-metadata",
  type: "management",
  description: "Describe shared workspace roots and their current presence on disk",
  commands: [
    "workspace create",
    "workspace show"
  ],
  workspaceStateLayout: [
    "work/downloads/",
    "work/sources/",
    "work/builds/",
    "work/runs/",
    "work/cache/",
    "work/tmp/"
  ]
};

const RUNS_CONTRACT = {
  id: "run-inspection",
  type: "management",
  description: "Inspect prior run packages, artifacts, steps, and exported HTML views",
  commands: [
    "runs list",
    "runs show <run-id>",
    "runs export-html [<run-id>]"
  ],
  defaults: {
    runRoot: "work/runs",
    outputRoot: "work/runs-view"
  }
};

const TOOL_CATALOG_CONTRACT = {
  id: "tool-catalog",
  type: "management",
  description: "Discover repo-local tool descriptors and verify their entrypoints and wrappers",
  commands: [
    "tool list",
    "tool list --verify"
  ]
};

function getContracts() {
  return {
    root: path.resolve(__dirname, ".."),
    generatedAt: new Date().toISOString(),
    contracts: {
      morpheusApp: MORPHEUS_APP_CONTRACT,
      managedRuns: MANAGED_RUNS_CONTRACT,
      workspace: WORKSPACE_CONTRACT,
      runs: RUNS_CONTRACT,
      toolCatalog: {
        ...TOOL_CATALOG_CONTRACT,
        tools: listDeclaredTools().map((tool) => ({
          name: tool.name,
          runtime: tool.runtime,
          descriptorPath: tool.descriptorPath,
          entry: path.join(tool.installRoot, tool.entry)
        }))
      }
    }
  };
}

module.exports = {
  MORPHEUS_APP_CONTRACT,
  MANAGED_RUNS_CONTRACT,
  WORKSPACE_CONTRACT,
  RUNS_CONTRACT,
  TOOL_CATALOG_CONTRACT,
  getContracts
};
