import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

interface ConfigFile<TValue> {
  path: string | null;
  value: TValue;
}

interface MorpheusConfigValue {
  workspace?: { root?: string };
  workflows?: Record<string, { category?: string }>;
}

interface GitWorktreeRecord {
  root: string;
  branch: string | null;
}

export interface ViewerConfigOption {
  id: string;
  label: string;
  configPath: string | null;
  workspaceRoot: string;
  runRoot: string;
}

export interface ViewerWorkflowOption {
  id: string;
  name: string;
  category: string;
  label: string;
  configPath: string | null;
}

function gitBranchLabel(workspaceRoot: string): string | null {
  const result = spawnSync("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  const value = String(result.stdout || "").trim();
  if (!value || value === "HEAD") {
    return null;
  }
  return value;
}

function configDisplayLabel(
  configPath: string,
  workspaceRoot: string,
  branchHint: string | null = null,
): string {
  const worktreeRoot = gitWorktreeRootForPath(configPath) || workspaceRoot;
  const branch = branchHint || gitBranchLabel(worktreeRoot);
  const configName = relativeConfigName(configPath, worktreeRoot);
  if (branch) {
    return `${branch}:${configName}`;
  }
  return configName;
}

function gitWorktreeRootForPath(targetPath: string): string | null {
  const basePath = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
    ? targetPath
    : path.dirname(targetPath);
  const result = spawnSync("git", ["-C", basePath, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  const value = String(result.stdout || "").trim();
  return value || null;
}

function relativeConfigName(configPath: string, worktreeRoot: string): string {
  const relative = path.relative(worktreeRoot, configPath);
  if (!relative || relative.startsWith("..")) {
    return path.basename(configPath);
  }
  return relative;
}

function parseGitWorktreeList(output: string): GitWorktreeRecord[] {
  const records: GitWorktreeRecord[] = [];
  let currentRoot: string | null = null;
  let currentBranch: string | null = null;

  const flush = () => {
    if (!currentRoot) {
      return;
    }
    records.push({ root: currentRoot, branch: currentBranch });
    currentRoot = null;
    currentBranch = null;
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      currentRoot = line.slice("worktree ".length).trim();
      continue;
    }
    if (line.startsWith("branch refs/heads/")) {
      currentBranch = line.slice("branch refs/heads/".length).trim() || null;
      continue;
    }
    if (line === "branch HEAD") {
      currentBranch = null;
    }
  }

  flush();
  return records;
}

function listGitWorktreeConfigPaths(repoRoot: string): Array<{
  configPath: string;
  worktreeRoot: string;
  branch: string | null;
}> {
  const result = spawnSync("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [];
  }
  return parseGitWorktreeList(String(result.stdout || ""))
    .flatMap((item) => {
      const configPaths = [path.join(item.root, "morpheus.yaml")];
      const projectsRoot = path.join(item.root, "projects");
      if (fs.existsSync(projectsRoot) && fs.statSync(projectsRoot).isDirectory()) {
        for (const entry of fs.readdirSync(projectsRoot).sort((left, right) => left.localeCompare(right))) {
          configPaths.push(path.join(projectsRoot, entry, "morpheus.yaml"));
        }
      }
      return configPaths
        .filter((configPath) => fs.existsSync(configPath))
        .map((configPath) => ({
          configPath,
          worktreeRoot: item.root,
          branch: item.branch,
        }));
    });
}

function explicitConfigPath(inputPath: string | null | undefined): string | null {
  if (!inputPath) {
    return null;
  }
  const resolved = path.resolve(String(inputPath));
  if (!fs.existsSync(resolved)) {
    throw new Error(`config file not found: ${inputPath}`);
  }
  return resolved;
}

function configuredConfigPath(inputPath?: string | null): string | null {
  return explicitConfigPath(inputPath ?? process.env.MORPHEUS_CONFIG);
}

function findConfigPath(startDir: string, explicitPath?: string | null): string | null {
  const chosen = configuredConfigPath(explicitPath);
  if (chosen) {
    return chosen;
  }
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "morpheus.yaml");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function loadConfig(startDir: string, explicitPath?: string | null): ConfigFile<MorpheusConfigValue> {
  const filePath = findConfigPath(startDir, explicitPath);
  if (!filePath) {
    return { path: null, value: {} };
  }
  return {
    path: filePath,
    value: (YAML.parse(fs.readFileSync(filePath, "utf8")) || {}) as MorpheusConfigValue,
  };
}

function resolveLocalPath(baseDir: string, inputPath: string | undefined): string | null {
  if (!inputPath) {
    return null;
  }
  const value = String(inputPath);
  if (value.startsWith("~")) {
    return value;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

function requireWorkspaceRoot(config: ConfigFile<MorpheusConfigValue>, baseDir: string): string {
  const resolved = resolveLocalPath(baseDir, config.value.workspace?.root);
  if (!resolved) {
    throw new Error("workspace.root must be configured in Morpheus config");
  }
  return resolved;
}

export function findRunRoot(options: { startDir: string; repoRoot: string }): {
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
} & { label: string } {
  const config = loadConfig(options.startDir);
  const baseDir = config.path ? path.dirname(config.path) : options.startDir;
  const workspaceRoot = requireWorkspaceRoot(config, baseDir);
  return {
    runRoot: path.join(workspaceRoot, "runs"),
    workspaceRoot,
    configPath: config.path,
    label: config.path ? configDisplayLabel(config.path, workspaceRoot) : "default",
  };
}

export function findRunRootForConfig(options: {
  startDir: string;
  repoRoot: string;
  configPath: string | null;
}): {
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
  label: string;
} {
  const config = loadConfig(options.startDir, options.configPath);
  const baseDir = config.path ? path.dirname(config.path) : options.startDir;
  const workspaceRoot = requireWorkspaceRoot(config, baseDir);
  return {
    runRoot: path.join(workspaceRoot, "runs"),
    workspaceRoot,
    configPath: config.path,
    label: config.path ? configDisplayLabel(config.path, workspaceRoot) : "default",
  };
}

export function listConfiguredWorkflows(options: {
  startDir: string;
  configPath: string | null;
}): ViewerWorkflowOption[] {
  const config = loadConfig(options.startDir, options.configPath);
  const configLabel = config.path ? configDisplayLabel(config.path, requireWorkspaceRoot(config, config.path ? path.dirname(config.path) : options.startDir)) : "default";
  const workflows = config.value.workflows || {};
  return Object.entries(workflows)
    .map(([name, item]) => ({
      id: `${config.path || "default"}::${name}`,
      name,
      category: item && item.category ? String(item.category) : "run",
      label: `${name}: ${configLabel}`,
      configPath: config.path,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function discoverViewerConfigs(options: {
  startDir: string;
  repoRoot: string;
}): ViewerConfigOption[] {
  const worktreeConfigs = listGitWorktreeConfigPaths(options.repoRoot).map((item) => {
    const resolved = findRunRootForConfig({
      startDir: options.startDir,
      repoRoot: options.repoRoot,
      configPath: item.configPath,
    });
    const relativeLabel = configDisplayLabel(
      item.configPath,
      item.worktreeRoot,
      item.branch,
    );
    return {
      id: item.configPath,
      label: relativeLabel,
      configPath: item.configPath,
      workspaceRoot: resolved.workspaceRoot,
      runRoot: resolved.runRoot,
    };
  });
  if (worktreeConfigs.length > 0) {
    return worktreeConfigs.sort((left, right) => left.label.localeCompare(right.label));
  }
  const fallback = findRunRoot(options);
  return [{
    id: fallback.configPath || "default",
    label: fallback.label,
    configPath: fallback.configPath,
    workspaceRoot: fallback.workspaceRoot,
    runRoot: fallback.runRoot,
  }];
}
