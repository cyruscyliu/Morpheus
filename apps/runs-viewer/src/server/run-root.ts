import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

interface ConfigFile<TValue> {
  path: string | null;
  value: TValue;
}

interface MorpheusConfigValue {
  workspace?: { root?: string };
  workflows?: Record<string, { category?: string }>;
}

export interface ViewerConfigOption {
  id: string;
  label: string;
  configPath: string | null;
  workspaceRoot: string;
  runRoot: string;
}

export interface ViewerWorkflowOption {
  name: string;
  category: string;
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

export function findRunRoot(options: { startDir: string; repoRoot: string }): {
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
} & { label: string } {
  const config = loadConfig(options.startDir);
  const baseDir = config.path ? path.dirname(config.path) : options.startDir;
  const workspaceRoot =
    resolveLocalPath(baseDir, config.value.workspace?.root) ||
    path.resolve(options.repoRoot, "hyperarm-workspace");
  return {
    runRoot: path.join(workspaceRoot, "runs"),
    workspaceRoot,
    configPath: config.path,
    label: config.path ? path.basename(config.path) : "default",
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
  const workspaceRoot =
    resolveLocalPath(baseDir, config.value.workspace?.root) ||
    path.resolve(options.repoRoot, "hyperarm-workspace");
  return {
    runRoot: path.join(workspaceRoot, "runs"),
    workspaceRoot,
    configPath: config.path,
    label: config.path ? path.basename(config.path) : "default",
  };
}

export function listConfiguredWorkflows(options: {
  startDir: string;
  configPath: string | null;
}): ViewerWorkflowOption[] {
  const config = loadConfig(options.startDir, options.configPath);
  const workflows = config.value.workflows || {};
  return Object.entries(workflows)
    .map(([name, item]) => ({
      name,
      category: item && item.category ? String(item.category) : "run",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function discoverViewerConfigs(options: {
  startDir: string;
  repoRoot: string;
}): ViewerConfigOption[] {
  const names = fs.readdirSync(options.repoRoot)
    .filter((entry) => /^morpheus.*\.ya?ml$/i.test(entry))
    .sort((left, right) => left.localeCompare(right));
  const items = names.map((name) => {
    const configPath = path.join(options.repoRoot, name);
    const resolved = findRunRootForConfig({
      startDir: options.startDir,
      repoRoot: options.repoRoot,
      configPath,
    });
    return {
      id: configPath,
      label: name,
      configPath,
      workspaceRoot: resolved.workspaceRoot,
      runRoot: resolved.runRoot,
    };
  });
  if (items.length > 0) {
    return items;
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
