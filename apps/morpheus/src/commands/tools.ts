// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { repoRoot } = require("../core/paths");
const { listToolDescriptors, readToolDescriptor } = require("../core/tool-descriptor");
const { writeStdoutLine } = require("../core/io");

function listDeclaredTools() {
  return listToolDescriptors().map((descriptor) => ({
    name: descriptor.name,
    runtime: descriptor.runtime,
    entry: descriptor.entry,
    descriptorPath: descriptor.descriptorPath,
    installRoot: descriptor.installRoot
  }));
}

function requireTool(name) {
  return readToolDescriptor(name);
}

function verifyTool(name) {
  const definition = requireTool(name);
  const installRoot = path.join(repoRoot(), definition.installRoot);
  const entrypoint = definition.entry ? path.join(installRoot, definition.entry) : null;
  const issues = [];

  if (!fs.existsSync(installRoot)) {
    issues.push(`missing install root: ${definition.installRoot}`);
  }
  if (entrypoint && !fs.existsSync(entrypoint)) {
    issues.push(`missing entrypoint: ${path.relative(repoRoot(), entrypoint)}`);
  }

  let status = "ready";
  if (!definition.entry) {
    status = "workflow-only";
  } else if (!fs.existsSync(installRoot) || !fs.existsSync(entrypoint)) {
    status = "missing";
  } else if (issues.length > 0) {
    status = "invalid";
  }

  return {
    name,
    status,
    runtime: definition.runtime || null,
    descriptorPath: definition.descriptorPath,
    installRoot: path.relative(repoRoot(), installRoot),
    entrypoint: entrypoint ? path.relative(repoRoot(), entrypoint) : null,
    wrapper: null,
    issues
  };
}

function parseToolArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

function extractToolSubcommand(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      return {
        subcommand: token,
        rest: [...argv.slice(0, index), ...argv.slice(index + 1)]
      };
    }
  }

  return {
    subcommand: null,
    rest: [...argv]
  };
}

function toolUsage() {
  return [
    "Usage:",
    "  ./bin/morpheus tool list [--json]",
    "",
    "Purpose:",
    "  Inspect declared tools and whether Morpheus can use them directly or through workflows.",
    "",
    "Examples:",
    "  ./bin/morpheus tool list",
    "  ./bin/morpheus tool list --json",
    "",
    "Notes:",
    "  - 'workflow-only' tools are managed through configured workflows.",
    "  - 'ready' tools have a repo-local entrypoint available to Morpheus."
  ].join("\n");
}

function verificationNote(status, issues) {
  if (Array.isArray(issues) && issues.length > 0) {
    return issues.join("; ");
  }
  if (status === "workflow-only") {
    return "run through 'morpheus workflow run'";
  }
  if (status === "ready") {
    return "available to Morpheus";
  }
  return "inspect verification issues";
}

function formatToolListText(items) {
  if (items.length === 0) {
    return "No tools declared.";
  }

  return [
    "name\tstatus\tnote",
    ...items.map((tool) => {
      const status = tool.verification.status;
      const note = verificationNote(status, tool.verification.issues);
      return `${tool.name}\t${status}\t${note}`;
    })
  ].join("\n");
}

function printMaybeJson(value, flags) {
  if (typeof value === "string") {
    writeStdoutLine(value);
    return;
  }

  if (flags.json) {
    writeStdoutLine(JSON.stringify(value, null, 2));
  }
}

async function handleToolCommand(argv) {
  const { subcommand, rest } = extractToolSubcommand(argv);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    writeStdoutLine(toolUsage());
    return 0;
  }

  if (subcommand === "exec" || subcommand === "build") {
    throw new Error(`tool ${subcommand} was removed; start from a configured workflow with 'morpheus workflow run --name <workflow>'`);
  }

  const { flags } = parseToolArgs(rest);

  if (subcommand === "list") {
    const tools = listDeclaredTools();
    const items = tools.map((tool) => {
      const payload = {
        name: tool.name,
        runtime: tool.runtime,
        descriptorPath: tool.descriptorPath,
        installRoot: tool.installRoot,
        entry: tool.entry
      };
      const verification = verifyTool(tool.name);
      return {
        ...payload,
        resolved: {
          installRoot: verification.installRoot,
          entrypoint: verification.entrypoint,
          wrapper: verification.wrapper
        },
        verification: {
          status: verification.status,
          issues: verification.issues
        }
      };
    });
    if (flags.json) {
      printMaybeJson({
        tool_statuses: {
          ready: "repo-local entrypoint is available to Morpheus",
          "workflow-only": "tool is managed through configured workflows",
          missing: "descriptor expects files that are not present",
          invalid: "verification found issues that need attention"
        },
        tools: items.map((tool) => ({
          ...tool,
          verification: {
            ...tool.verification,
            note: verificationNote(tool.verification.status, tool.verification.issues)
          }
        }))
      }, flags);
    } else {
      writeStdoutLine(formatToolListText(items));
    }
    return 0;
  }

  throw new Error(`unknown tool subcommand: ${subcommand}`);
}

module.exports = {
  handleToolCommand,
  listDeclaredTools,
  verifyTool,
  repoRoot
};
