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
  const entrypoint = path.join(installRoot, definition.entry);
  const wrapperPath = path.join(repoRoot(), "bin", name);
  const issues = [];

  if (!fs.existsSync(installRoot)) {
    issues.push(`missing install root: ${definition.installRoot}`);
  }
  if (!fs.existsSync(entrypoint)) {
    issues.push(`missing entrypoint: ${path.relative(repoRoot(), entrypoint)}`);
  }
  if (!fs.existsSync(wrapperPath)) {
    issues.push(`missing wrapper: ${path.relative(repoRoot(), wrapperPath)}`);
  }

  let status = "valid";
  if (!fs.existsSync(installRoot) || !fs.existsSync(entrypoint) || !fs.existsSync(wrapperPath)) {
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
    entrypoint: path.relative(repoRoot(), entrypoint),
    wrapper: path.relative(repoRoot(), wrapperPath),
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
    "  node apps/morpheus/dist/cli.js tool list [--json]"
  ].join("\n");
}

function formatToolListText(items) {
  if (items.length === 0) {
    return "No tools declared.";
  }

  return items
    .map((tool) => {
      const status = tool.verification.status;
      const issues = tool.verification.issues.length > 0 ? `\t${tool.verification.issues.join("; ")}` : "";
      return `${tool.name}\t${status}${issues}`;
    })
    .join("\n");
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
      printMaybeJson({ tools: items }, flags);
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
