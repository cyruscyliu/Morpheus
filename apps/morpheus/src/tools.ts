// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { repoRoot } = require("./paths");
const { handleManagedRunCommand } = require("./remote");
const { runSingleToolWorkflow, runToolBuildWorkflow } = require("./workflow");
const { applyConfigDefaults, loadConfig } = require("./config");
const { listToolDescriptors, readToolDescriptor, toolDescriptorPath } = require("./tool-descriptor");
const { writeStdoutLine } = require("./io");
const { logInfo } = require("./logger");

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
    "  node apps/morpheus/dist/cli.js tool build --tool <name> [--json] [...tool flags]",
    "  node apps/morpheus/dist/cli.js tool run --tool <name> [--json] [...tool flags]",
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

function resolveWorkspaceRoot(flags) {
  const { flags: resolved } = applyConfigDefaults(
    {
      tool: "workflow",
      workspace: flags.workspace || null,
    },
    { allowGlobalRemote: false, allowToolDefaults: false }
  );
  if (!resolved.workspace) {
    throw new Error("tool build requires --workspace DIR or workspace.root in morpheus.yaml");
  }
  return resolved.workspace;
}

function toolDependencyNamesFromConfig(tool) {
  const config = loadConfig(process.cwd());
  const value = (config && config.value) || {};
  const tools = value.tools || {};
  const toolConfig = tools[tool] || {};
  const dependencies = toolConfig.dependencies || {};

  const result = new Set();
  const visit = (node) => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node !== "object") {
      return;
    }
    if (node.tool && node.artifact) {
      result.add(String(node.tool));
    }
    for (const value of Object.values(node)) {
      visit(value);
    }
  };

  visit(dependencies);
  result.delete(tool);
  return [...result];
}

function sortToolDependencies(tools) {
  const priority = new Map([
    ["buildroot", 0],
    ["qemu", 1],
    ["microkit-sdk", 2],
    ["sel4", 3],
    ["libvmm", 4],
    ["nvirsh", 5]
  ]);
  return [...tools].sort((left, right) => {
    const leftRank = priority.has(left) ? priority.get(left) : 100;
    const rightRank = priority.has(right) ? priority.get(right) : 100;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });
}

function stripFlagPair(argv, flagName) {
  const next = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === flagName) {
      index += 1;
      continue;
    }
    next.push(token);
  }
  return next;
}

function stripBooleanFlag(argv, flagName) {
  return argv.filter((token) => token !== flagName);
}

function isRecoverableNvirshDependencyError(error) {
  const message = error && error.message ? String(error.message) : "";
  return (
    /could not resolve .* artifact .* from /.test(message)
    || /missing .* dependency configuration/.test(message)
    || /unsupported .* dependency configuration/.test(message)
  );
}

async function runNvirshDependencyWorkflow(rest, flags) {
  const workflowName = `tool-${flags.tool}`;
  const workspaceRoot = resolveWorkspaceRoot(flags);
  let toolArgv = [...rest];
  toolArgv = stripBooleanFlag(toolArgv, "--json");
  toolArgv = stripFlagPair(toolArgv, "--tool");
  toolArgv = stripFlagPair(toolArgv, "--workspace");

  const dependencies = sortToolDependencies(toolDependencyNamesFromConfig(flags.tool));
  const inheritedArgs = flags.verbose ? ["--verbose"] : [];
  const steps = dependencies.map((name) => ({ tool: name, name: `${name}.build`, toolArgv: inheritedArgs }));
  return await runToolBuildWorkflow({
    steps,
    workflowName,
    workspaceRoot,
    jsonMode: false,
    commandLabel: "tool run",
    category: "build",
  });
}

async function handleToolCommand(argv) {
  const { subcommand, rest } = extractToolSubcommand(argv);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    writeStdoutLine(toolUsage());
    return 0;
  }

  if (subcommand === "run") {
    if (rest.includes("--help") || rest.includes("help")) {
      return await handleManagedRunCommand("run", ["--help"]);
    }
    if (process.env.MORPHEUS_DISABLE_TOOL_WORKFLOW_WRAP === "1") {
      return await handleManagedRunCommand("run", rest);
    }
    const { flags } = parseToolArgs(rest);
    const tool = flags.tool;
    if (!tool) {
      throw new Error("tool run requires --tool <name>");
    }
    logInfo("tool", "received tool run request", {
      tool,
      json: Boolean(flags.json),
      workspace: flags.workspace || null,
      attach: Boolean(flags.attach),
    });
    const workflowName = `tool-${tool}`;
    const workspaceRoot = resolveWorkspaceRoot(flags);
    let toolArgv = [...rest];
    toolArgv = stripBooleanFlag(toolArgv, "--json");
    toolArgv = stripFlagPair(toolArgv, "--tool");
    toolArgv = stripFlagPair(toolArgv, "--workspace");

    if (tool === "nvirsh") {
      try {
        return await runSingleToolWorkflow({
          tool,
          workflowName,
          workspaceRoot,
          toolArgv,
          jsonMode: Boolean(flags.json),
          commandLabel: "tool run",
          category: "run",
          toolCommand: "run",
          attach: Boolean(flags.attach),
        });
      } catch (error) {
        if (!isRecoverableNvirshDependencyError(error)) {
          throw error;
        }
        const exitCode = await runNvirshDependencyWorkflow(rest, flags);
        if (exitCode !== 0) {
          return exitCode;
        }
        return await runSingleToolWorkflow({
          tool,
          workflowName,
          workspaceRoot,
          toolArgv,
          jsonMode: Boolean(flags.json),
          commandLabel: "tool run",
          category: "run",
          toolCommand: "run",
          attach: Boolean(flags.attach),
        });
      }
    }
    return await runSingleToolWorkflow({
      tool,
      workflowName,
      workspaceRoot,
      toolArgv,
      jsonMode: Boolean(flags.json),
      commandLabel: "tool run",
      category: "run",
      toolCommand: "run",
      attach: Boolean(flags.attach),
    });
  }

  if (subcommand === "build") {
    if (rest.includes("--help") || rest.includes("help")) {
      return await handleManagedRunCommand("build", ["--help"]);
    }
    if (process.env.MORPHEUS_DISABLE_TOOL_WORKFLOW_WRAP === "1") {
      return await handleManagedRunCommand("build", rest);
    }
    const { flags } = parseToolArgs(rest);
    const tool = flags.tool;
    if (!tool) {
      throw new Error("tool build requires --tool <name>");
    }
    logInfo("tool", "received tool build request", {
      tool,
      json: Boolean(flags.json),
      workspace: flags.workspace || null,
    });
    const workflowName = `tool-${tool}`;
    const workspaceRoot = resolveWorkspaceRoot(flags);
    let toolArgv = [...rest];
    toolArgv = stripBooleanFlag(toolArgv, "--json");
    toolArgv = stripFlagPair(toolArgv, "--tool");
    toolArgv = stripFlagPair(toolArgv, "--workspace");

    if (tool === "nvirsh") {
      const dependencies = sortToolDependencies(toolDependencyNamesFromConfig(tool));
      const inheritedArgs = flags.verbose ? ["--verbose"] : [];
      if (flags.attach) {
        throw new Error("tool build --tool nvirsh does not launch the runtime; use tool run --tool nvirsh --attach");
      }
      const steps = [
        ...dependencies.map((name) => ({ tool: name, name: `${name}.build`, toolArgv: inheritedArgs })),
        { tool, name: `${tool}.build`, toolArgv: [...toolArgv, "--build-only"] }
      ];
      return await runToolBuildWorkflow({
        steps,
        workflowName,
        workspaceRoot,
        jsonMode: Boolean(flags.json),
        commandLabel: `tool ${subcommand}`,
        category: "build",
      });
    }

    return runSingleToolWorkflow({
      tool,
      workflowName,
      workspaceRoot,
      toolArgv,
      jsonMode: Boolean(flags.json),
      commandLabel: `tool ${subcommand}`,
    });
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
