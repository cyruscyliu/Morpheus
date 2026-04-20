// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { repoRoot } = require("./paths");
const { handleManagedRunCommand } = require("./remote");

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

function getInstallRoot(name) {
  const definition = requireTool(name);
  return path.join(repoRoot(), definition.installRoot);
}

function getEntrypoint(name) {
  const definition = requireTool(name);
  return path.join(getInstallRoot(name), definition.entry);
}

function getWrapperPath(name) {
  return path.join(repoRoot(), "bin", name);
}

function verifyTool(name) {
  const definition = requireTool(name);
  const installRoot = getInstallRoot(name);
  const entrypoint = getEntrypoint(name);
  const wrapperPath = getWrapperPath(name);
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

function selectToolNames(argv, flags) {
  if (flags.all || argv.length === 0) {
    return listDeclaredTools().map((tool) => tool.name);
  }
  return [argv[0]];
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
    "  node apps/morpheus/dist/cli.js tool run --tool buildroot --mode local --workspace DIR (--source DIR | --buildroot-version VER) [--json]",
    "  node apps/morpheus/dist/cli.js tool run --tool buildroot --mode remote --ssh TARGET --workspace DIR (--source DIR | --buildroot-version VER) [--json]",
    "  node apps/morpheus/dist/cli.js tool runs [--workspace DIR] [--ssh TARGET] [--json]",
    "  node apps/morpheus/dist/cli.js tool inspect --id RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js tool logs --id RUN_ID [--follow] [--json]",
    "  node apps/morpheus/dist/cli.js tool fetch --id RUN_ID --dest DIR --path RUN_PATH [--json]",
    "  node apps/morpheus/dist/cli.js tool remove --id RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js tool list [--json]",
    "  node apps/morpheus/dist/cli.js tool verify [<name>|--all] [--json]",
    "  node apps/morpheus/dist/cli.js tool resolve <name> [--json]"
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

function formatVerifyText(items) {
  if (items.length === 0) {
    return "No tools selected.";
  }

  return items
    .map((tool) => {
      const suffix = tool.issues.length > 0 ? `\t${tool.issues.join("; ")}` : "";
      return `${tool.name}\t${tool.status}${suffix}`;
    })
    .join("\n");
}

function formatResolveText(value) {
  return [
    `name: ${value.name}`,
    `runtime: ${value.definition.runtime}`,
    `descriptor: ${value.definition.descriptorPath}`,
    `installRoot: ${value.resolved.installRoot}`,
    `entrypoint: ${value.resolved.entrypoint}`,
    `wrapper: ${value.resolved.wrapper}`,
    `status: ${value.verification.status}`
  ].join("\n");
}

function printMaybeJson(value, flags) {
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

async function handleToolCommand(argv) {
  const { subcommand, rest } = extractToolSubcommand(argv);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    process.stdout.write(`${toolUsage()}\n`);
    return 0;
  }

  if (["run", "runs", "inspect", "logs", "fetch", "remove"].includes(subcommand)) {
    return await handleManagedRunCommand(subcommand === "runs" ? "list" : subcommand, rest);
  }

  const { positionals, flags } = parseToolArgs(rest);

  if (subcommand === "list") {
    const items = listDeclaredTools().map((tool) => ({
      name: tool.name,
      runtime: tool.runtime,
      descriptorPath: tool.descriptorPath,
      installRoot: tool.installRoot,
      entry: tool.entry
    }));
    if (flags.json) {
      printMaybeJson({ tools: items }, flags);
    } else {
      process.stdout.write(`${formatToolListText(items)}\n`);
    }
    return 0;
  }

  if (subcommand === "verify") {
    const names = selectToolNames(positionals, flags);
    const results = names.map((name) => verifyTool(name));
    if (flags.json) {
      printMaybeJson({ verified: results }, flags);
    } else {
      process.stdout.write(`${formatVerifyText(results)}\n`);
    }
    return results.some((item) => item.status !== "valid") ? 1 : 0;
  }

  if (subcommand === "resolve") {
    const name = positionals[0];
    if (!name) {
      throw new Error("tool resolve requires a tool name");
    }
    const definition = requireTool(name);
    const result = verifyTool(name);
    const payload = {
      name,
      definition: {
        runtime: definition.runtime,
        descriptorPath: definition.descriptorPath,
        installRoot: definition.installRoot,
        entry: definition.entry
      },
      resolved: {
        installRoot: path.relative(repoRoot(), getInstallRoot(name)),
        entrypoint: path.relative(repoRoot(), getEntrypoint(name)),
        wrapper: path.relative(repoRoot(), getWrapperPath(name))
      },
      verification: result
    };
    if (flags.json) {
      printMaybeJson(payload, flags);
    } else {
      process.stdout.write(`${formatResolveText(payload)}\n`);
    }
    return result.status === "valid" ? 0 : 1;
  }

  throw new Error(`unknown tool subcommand: ${subcommand}`);
}

module.exports = {
  handleToolCommand,
  listDeclaredTools,
  verifyTool,
  getEntrypoint,
  getInstallRoot,
  repoRoot
};
