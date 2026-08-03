import fs from "node:fs";
import os from "node:os";
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
  id: string;
  name: string;
  category: string;
  configPath: string | null;
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

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(normalized);
  if (!match) {
    throw new Error(`invalid .env entry: ${line}`);
  }

  let value = match[2];
  if (value.startsWith("\"") && value.endsWith("\"")) {
    value = value.slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, "\"");
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }

  return { key: match[1], value };
}

function loadEnvFile(filePath: string | null | undefined): boolean {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, entry.key)) {
      process.env[entry.key] = entry.value;
    }
  }
  return true;
}

function normalizeMorpheusEnv(): void {
  const dataRoot = typeof process.env.MORPHEUS_DATA_ROOT === "string" && process.env.MORPHEUS_DATA_ROOT
    ? process.env.MORPHEUS_DATA_ROOT
    : null;
  const workspacesRoot = typeof process.env.MORPHEUS_WORKSPACES_ROOT === "string" && process.env.MORPHEUS_WORKSPACES_ROOT
    ? process.env.MORPHEUS_WORKSPACES_ROOT
    : null;

  if (dataRoot && !workspacesRoot) {
    process.env.MORPHEUS_WORKSPACES_ROOT = path.join(dataRoot, "workspaces");
  }
  if (workspacesRoot && !dataRoot) {
    process.env.MORPHEUS_DATA_ROOT = path.dirname(workspacesRoot);
  }
}

function loadEnvForPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    const candidate = path.join(current, ".env");
    if (loadEnvFile(candidate)) {
      normalizeMorpheusEnv();
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  normalizeMorpheusEnv();
  return null;
}

function loadEnvForStartDir(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, ".env");
    if (loadEnvFile(candidate)) {
      normalizeMorpheusEnv();
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  normalizeMorpheusEnv();
  return null;
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
  loadEnvForPath(filePath);
  return {
    path: filePath,
    value: (YAML.parse(fs.readFileSync(filePath, "utf8")) || {}) as MorpheusConfigValue,
  };
}

function expandEnvironmentVariables(inputPath: string | undefined): string | undefined {
  if (!inputPath) {
    return inputPath;
  }
  return String(inputPath).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
    if (!Object.prototype.hasOwnProperty.call(process.env, name)) {
      throw new Error(`environment variable not set: ${name}`);
    }
    return String(process.env[name]);
  });
}

function expandUserPath(inputPath: string | undefined): string | undefined {
  if (!inputPath) {
    return inputPath;
  }
  const value = String(inputPath);
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveLocalPath(baseDir: string, inputPath: string | undefined): string | null {
  if (!inputPath) {
    return null;
  }
  const value = expandUserPath(expandEnvironmentVariables(inputPath));
  if (!value) {
    return null;
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

export function findRunRoot(options: { startDir: string }): {
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
} & { label: string } {
  loadEnvForStartDir(options.startDir);
  const config = loadConfig(options.startDir);
  const baseDir = config.path ? path.dirname(config.path) : options.startDir;
  const workspaceRoot = requireWorkspaceRoot(config, baseDir);
  return {
    runRoot: path.join(workspaceRoot, "workflows"),
    workspaceRoot,
    configPath: config.path,
    label: config.path ? path.basename(config.path) : "default",
  };
}
