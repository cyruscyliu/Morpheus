// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { workRoot, workspacePaths } = require("./paths");

function parseWorkspaceArgs(argv) {
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

function workspaceUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js workspace create [--json]",
    "  node apps/morpheus/dist/cli.js workspace show [--json]"
  ].join("\n");
}

function toRelative(targetPath) {
  return path.relative(process.cwd(), targetPath) || ".";
}

function statDir(targetPath) {
  return {
    path: toRelative(targetPath),
    exists: fs.existsSync(targetPath),
    kind: "directory"
  };
}

function describeWorkspace() {
  const paths = workspacePaths();
  return {
    root: toRelative(workRoot()),
    environment: {
      override: process.env.MORPHEUS_WORK_ROOT || null,
      legacyOverride: process.env.RESEARCH_RUNTIME_WORK_ROOT || null
    },
    directories: {
      downloads: statDir(paths.downloads),
      sources: statDir(paths.sources),
      builds: statDir(paths.builds),
      llbicBuilds: statDir(paths.llbicBuilds),
      runs: statDir(paths.runs),
      cache: statDir(paths.cache),
      tmp: statDir(paths.tmp)
    }
  };
}

function createWorkspace() {
  const paths = workspacePaths();
  const created = [];
  const existing = [];

  for (const targetPath of Object.values(paths)) {
    if (fs.existsSync(targetPath)) {
      existing.push(statDir(targetPath));
      continue;
    }

    fs.mkdirSync(targetPath, { recursive: true });
    created.push(statDir(targetPath));
  }

  return {
    root: toRelative(workRoot()),
    created,
    existing,
    workspace: describeWorkspace()
  };
}

function printWorkspaceHuman(summary) {
  process.stdout.write("Workspace\n");
  process.stdout.write(`  root: ${summary.root}\n`);
  for (const [name, info] of Object.entries(summary.directories)) {
    process.stdout.write(
      `  ${name}: ${info.path} (${info.exists ? "present" : "missing"})\n`
    );
  }
}

function printCreateHuman(result) {
  process.stdout.write(`Workspace created at ${result.root}\n`);
  process.stdout.write(`  created: ${result.created.length}\n`);
  process.stdout.write(`  existing: ${result.existing.length}\n`);
}

function handleWorkspaceCommand(argv) {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    process.stdout.write(`${workspaceUsage()}\n`);
    return 0;
  }

  const { flags } = parseWorkspaceArgs(argv.slice(1));
  if (subcommand === "create") {
    const result = createWorkspace();
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    printCreateHuman(result);
    return 0;
  }

  if (subcommand === "show") {
    const summary = describeWorkspace();
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return 0;
    }

    printWorkspaceHuman(summary);
    return 0;
  }

  throw new Error(`unknown workspace subcommand: ${subcommand}`);
}

module.exports = {
  createWorkspace,
  describeWorkspace,
  handleWorkspaceCommand
};
