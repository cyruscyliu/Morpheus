// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { repoRoot } = require("./paths");
const { handleManagedRunCommand } = require("./remote");
const { writeStdoutLine } = require("./io");

function descriptorPath(toolName) {
  return path.join(repoRoot(), "tools", toolName, "tool.json");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listDeclaredTools() {
  const toolsRoot = path.join(repoRoot(), "tools");
  if (!fs.existsSync(toolsRoot)) {
    return [];
  }

  return fs
    .readdirSync(toolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const filePath = descriptorPath(entry.name);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const descriptor = readJson(filePath);
      return {
        name: descriptor.name || entry.name,
        runtime: descriptor.runtime,
        entry: descriptor.entry,
        descriptorPath: path.relative(repoRoot(), filePath),
        installRoot: path.relative(repoRoot(), path.dirname(filePath))
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function requireTool(name) {
  const definition = listDeclaredTools().find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`unknown tool: ${name}`);
  }
  return definition;
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
    "  node apps/morpheus/dist/cli.js tool build --tool <name> [--json] [...tool flags]",
    "  node apps/morpheus/dist/cli.js tool list [--json] [--verify]"
  ].join("\n");
}

function formatToolListText(items) {
  if (items.length === 0) {
    return "No tools declared.";
  }

  return items
    .map((tool) => `${tool.name}\t${tool.runtime}\t${tool.entry}`)
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

  if (["build", "run"].includes(subcommand)) {
    return await handleManagedRunCommand("run", rest);
  }

  const { positionals, flags } = parseToolArgs(rest);

  if (subcommand === "list") {
    const includeVerification = Boolean(flags.verify);
    const tools = listDeclaredTools();
    const items = tools.map((tool) => {
      const payload = {
        name: tool.name,
        runtime: tool.runtime,
        descriptorPath: tool.descriptorPath,
        installRoot: tool.installRoot,
        entry: tool.entry
      };
      if (!includeVerification) {
        return payload;
      }
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
      if (!includeVerification) {
        writeStdoutLine(formatToolListText(items));
        return 0;
      }
      const lines = items.map((item) => {
        const status = item.verification.status;
        const issues = item.verification.issues.length > 0 ? `\t${item.verification.issues.join("; ")}` : "";
        return `${item.name}\t${status}${issues}`;
      });
      writeStdoutLine(lines.length === 0 ? "No tools declared." : lines.join("\n"));
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
