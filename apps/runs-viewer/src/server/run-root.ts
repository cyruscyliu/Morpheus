import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

interface ConfigFile<TValue> {
  path: string | null;
  value: TValue;
}

interface MorpheusConfigValue {
  workspace?: { root?: string };
}

function findConfigPath(startDir: string): string | null {
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

function loadConfig(startDir: string): ConfigFile<MorpheusConfigValue> {
  const filePath = findConfigPath(startDir);
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
} {
  const config = loadConfig(options.startDir);
  const baseDir = config.path ? path.dirname(config.path) : options.startDir;
  const workspaceRoot =
    resolveLocalPath(baseDir, config.value.workspace?.root) ||
    path.resolve(options.repoRoot, "hyperarm-workspace");
  return {
    runRoot: path.join(workspaceRoot, "runs"),
    workspaceRoot,
    configPath: config.path,
  };
}

