// @ts-nocheck
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("yaml");
const { logDebug } = require("./logger");

const RESERVED_MANAGED_TOOL_CONFIG_KEYS = new Set([
  "mode",
  "remote",
  "reuse-build-dir",
  "build-dir-key",
  "patch-dir",
  "artifacts",
  "dependencies",
]);

const { readToolDescriptor } = require("./tool-descriptor");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function explicitConfigPath(inputPath) {
  if (!inputPath) {
    return null;
  }
  const resolved = path.resolve(String(inputPath));
  if (!fs.existsSync(resolved)) {
    throw new Error(`config file not found: ${inputPath}`);
  }
  return resolved;
}

function configuredConfigPath() {
  return explicitConfigPath(process.env.MORPHEUS_CONFIG || null);
}

function findConfigPath(startDir, options = {}) {
  const chosen = explicitConfigPath(options.explicitPath || configuredConfigPath());
  if (chosen) {
    return chosen;
  }
  let current = path.resolve(startDir || process.cwd());
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

function importedRootConfigPath(filePath) {
  const selectedConfigPath = path.resolve(filePath);
  let current = path.dirname(selectedConfigPath);
  let skippedNearestConfig = false;
  while (true) {
    const candidate = path.join(current, "morpheus.yaml");
    if (fs.existsSync(candidate)) {
      if (path.resolve(candidate) === selectedConfigPath || !skippedNearestConfig) {
        skippedNearestConfig = true;
      } else {
        return candidate;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(__dirname, "..", "..", "..", "..", "morpheus.yaml");
}

function mergeImportedWorkflows(configValue, filePath, options = {}) {
  if (!filePath || !isPlainObject(configValue)) {
    return configValue;
  }
  const imports = configValue.imports;
  if (!isPlainObject(imports) || !imports.workflows) {
    return configValue;
  }
  const requested = Array.isArray(imports.workflows)
    ? imports.workflows
    : [imports.workflows];
  const importPath = importedRootConfigPath(filePath);
  if (!fs.existsSync(importPath)) {
    throw new Error("root morpheus.yaml not found for workflow imports");
  }
  const importedValue = yaml.parse(fs.readFileSync(importPath, "utf8")) || {};
  const importedWorkflowsAll = isPlainObject(importedValue.workflows)
    ? importedValue.workflows
    : {};
  const importedWorkflows = {};
  for (const item of requested) {
    const value = String(item || "").trim();
    if (!value) {
      continue;
    }
    const [scope, workflowName] = value.split(".", 2);
    if (scope !== "root" || !workflowName) {
      throw new Error(`unsupported workflow import reference: ${value}`);
    }
    if (String(workflowName).endsWith("-ci")) {
      throw new Error(`cannot import ci workflow: ${value}`);
    }
    if (!Object.prototype.hasOwnProperty.call(importedWorkflowsAll, workflowName)) {
      throw new Error(`imported workflow not found: ${value}`);
    }
    importedWorkflows[workflowName] = importedWorkflowsAll[workflowName];
  }
  const localWorkflows = isPlainObject(configValue.workflows) ? configValue.workflows : {};
  return {
    ...configValue,
    workflows: {
      ...importedWorkflows,
      ...localWorkflows,
    },
  };
}

function loadConfig(startDir, options = {}) {
  const filePath = findConfigPath(startDir, options);
  if (!filePath) {
    return {
      path: null,
      value: {}
    };
  }
  const parsed = yaml.parse(fs.readFileSync(filePath, "utf8")) || {};
  return {
    path: filePath,
    value: mergeImportedWorkflows(parsed, filePath, options)
  };
}

function configDir(configPath) {
  if (!configPath) {
    return process.cwd();
  }
  return path.dirname(configPath);
}

function appRepoRoot() {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

function expandUserPath(inputPath) {
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

function resolveLocalPath(baseDir, inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  const value = expandUserPath(inputPath);
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

function resolveCachePolicy(configValue, configPath, baseDir) {
  if (!isPlainObject(configValue) || !isPlainObject(configValue.cache) || !configValue.cache.root) {
    return null;
  }
  if (!configValue.cache.namespace) {
    throw new Error("cache.namespace must be configured when cache.root is set");
  }
  return {
    root: resolveLocalPath(baseDir, configValue.cache.root),
    namespace: String(configValue.cache.namespace),
    downloads: String(configValue.cache.downloads || "workspace"),
    builds: String(configValue.cache.builds || "workspace"),
    src: String(configValue.cache.src || "workspace"),
  };
}

function resolveManagedToolPath(baseDir, workspaceRoot, toolName, inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  const value = String(inputPath);
  if (value.startsWith("~") || path.isAbsolute(value)) {
    return value;
  }
  if (workspaceRoot && value.startsWith(`tools/${toolName}/`)) {
    return path.resolve(workspaceRoot, value);
  }
  return resolveLocalPath(baseDir, value);
}

function resolveRemoteName(configValue, name) {
  if (!name && configValue.remote && configValue.remote.ssh) {
    return {
      name: "remote",
      ssh: configValue.remote.ssh
    };
  }

  if (name === "remote" && configValue.remote && configValue.remote.ssh) {
    return {
      name,
      ssh: configValue.remote.ssh
    };
  }

  const targets = configValue.remote && configValue.remote.targets;
  if (!name) {
    return null;
  }
  if (!targets || !targets[name] || !targets[name].ssh) {
    throw new Error(`unknown configured remote: ${name}`);
  }
  return {
    name,
    ssh: targets[name].ssh
  };
}

function resolveRemoteWorkspaceName(configValue, name) {
  if (configValue.remote && configValue.remote.workspace && configValue.remote.workspace.root) {
    const target = resolveRemoteName(configValue, null);
    return {
      name: name || "remote",
      target: target.name,
      ssh: target.ssh,
      root: configValue.remote.workspace.root
    };
  }

  const workspaces = configValue.remote && configValue.remote.workspaces;
  if (!name || !workspaces || !workspaces[name]) {
    return null;
  }
  const item = workspaces[name];
  if (!item.target || !item.root) {
    throw new Error(`invalid configured remote workspace: ${name}`);
  }
  const target = resolveRemoteName(configValue, item.target);
  return {
    name,
    target: target.name,
    ssh: target.ssh,
    root: item.root
  };
}

function resolveDefaultRemote(configValue) {
  if (configValue.remote && configValue.remote.ssh) {
    return resolveRemoteName(configValue, null);
  }

  const remoteName = configValue.remote && configValue.remote.default;
  return resolveRemoteName(configValue, remoteName);
}

function resolveWorkspaceName(configValue, name, options) {
  const baseDir = (options && options.baseDir) || process.cwd();
  if (configValue.workspace && configValue.workspace.root) {
    if (!name || name === "default" || name === "workspace") {
      return {
        name: name || "workspace",
        root: resolveLocalPath(baseDir, configValue.workspace.root),
        remote: configValue.workspace.remote || null
      };
    }
  }

  const items = configValue.workspaces && configValue.workspaces.items;
  if (!name) {
    return null;
  }
  if (!items || !items[name] || !items[name].root) {
    return null;
  }
  const item = items[name];
  return {
    name,
    root: resolveLocalPath(baseDir, item.root),
    remote: item.remote || null
  };
}

function resolveDefaultWorkspace(configValue, options) {
  if (configValue.workspace && configValue.workspace.root) {
    return {
      name: "workspace",
      root: resolveLocalPath((options && options.baseDir) || process.cwd(), configValue.workspace.root),
      remote: configValue.workspace.remote || null
    };
  }

  const name = configValue.workspaces && configValue.workspaces.default;
  return resolveWorkspaceName(configValue, name, options);
}

function resolveToolName(configValue, name) {
  if (!name || !configValue.tools || !configValue.tools[name]) {
    return null;
  }
  const item = configValue.tools[name];
  const descriptor = readToolDescriptor(name);
  const fields = descriptor.config && descriptor.config.fields ? descriptor.config.fields : {};
  const normalized = {
    name,
    raw: item,
    __fieldMeta: fields,
  };
  for (const [canonical, spec] of Object.entries(fields)) {
    const aliases = Array.isArray(spec.aliases) ? spec.aliases : [canonical];
    const values = aliases
      .filter((alias) => Object.prototype.hasOwnProperty.call(item, alias))
      .map((alias) => item[alias]);
    if (values.length === 0) {
      normalized[canonical] = null;
      continue;
    }
    if (spec.repeatable) {
      const list = [];
      for (const value of values) {
        if (Array.isArray(value)) {
          list.push(...value);
        } else {
          list.push(value);
        }
      }
      normalized[canonical] = list;
      continue;
    }
    if (spec.boolean) {
      normalized[canonical] = values[0] ?? null;
      continue;
    }
    normalized[canonical] = values[0];
  }
  return {
    ...normalized,
  };
}

function applyToolConfigDefaults(next, toolEntry) {
  const raw = toolEntry && toolEntry.raw;
  if (!isPlainObject(raw)) {
    return;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_MANAGED_TOOL_CONFIG_KEYS.has(key)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      continue;
    }
    next[key] = value;
  }
}

function applyRemoteReference(configValue, next, remoteName) {
  if (next.ssh) {
    return;
  }

  if (!configValue.remote) {
    return;
  }

  if (!remoteName) {
    return;
  }

  const remoteWorkspace = resolveRemoteWorkspaceName(configValue, remoteName);
  if (remoteWorkspace) {
    next.remoteWorkspace = remoteWorkspace.root;
    next.workspace = remoteWorkspace.root;
    next.ssh = remoteWorkspace.ssh;
    next.remote = remoteWorkspace.name;
    next.remoteTarget = remoteWorkspace.target;
    return;
  }

  const remote = resolveRemoteName(configValue, remoteName);
  next.ssh = remote && remote.ssh;
  next.remote = remote && remote.name;
}

function applyConfigDefaults(flags, options) {
  const config = loadConfig(process.cwd(), {
    explicitPath: options && options.explicitConfigPath ? options.explicitConfigPath : null,
  });
  const value = config.value || {};
  const baseDir = configDir(config.path);
  const next = { ...flags };
  const cachePolicy = resolveCachePolicy(value, config.path, baseDir);
  if (cachePolicy) {
    next.__cache_root = cachePolicy.root;
    next.__cache_namespace = cachePolicy.namespace;
    next.__cache_downloads = cachePolicy.downloads;
    next.__cache_builds = cachePolicy.builds;
    next.__cache_src = cachePolicy.src;
  }
  const allowGlobalRemote = Boolean(options && options.allowGlobalRemote);
  const allowToolDefaults = Boolean(options && options.allowToolDefaults);
  let workspaceEntry = null;
  if (next.workspace) {
    workspaceEntry = resolveWorkspaceName(value, next.workspace, { baseDir });
    if (workspaceEntry) {
      next.localWorkspace = workspaceEntry.root;
      next.workspace = workspaceEntry.root;
    } else {
      const raw = String(next.workspace);
      const looksLikePath = raw.includes("/") || raw.includes("\\") || raw.startsWith(".") || raw.startsWith("~");
      if (looksLikePath) {
        const resolved = resolveLocalPath(baseDir, raw);
        next.localWorkspace = resolved;
        next.workspace = resolved;
      }
    }
  } else {
    workspaceEntry = resolveDefaultWorkspace(value, { baseDir });
    if (workspaceEntry) {
      next.localWorkspace = workspaceEntry.root;
      next.workspace = workspaceEntry.root;
    }
  }

  const toolEntry = allowToolDefaults ? resolveToolName(value, next.tool) : null;
  if (toolEntry && toolEntry["mode"] && !next.mode) {
    next.mode = toolEntry["mode"];
  }
  const toolDisallowsRemote = next.mode === "local";

  if (toolEntry && toolEntry["remote"] && next.mode !== "local" && !next.remote && !next.ssh) {
    next.remote = toolEntry["remote"];
  }

  if (toolEntry && toolEntry["source"] && !next.source) {
    next.source = resolveManagedToolPath(baseDir, next.localWorkspace, next.tool, toolEntry["source"]);
  }

  const fieldMeta = toolEntry && toolEntry.__fieldMeta ? toolEntry.__fieldMeta : {};
  for (const [key, value] of Object.entries(toolEntry || {})) {
    if (key === "raw" || key === "name" || key === "__fieldMeta" || value == null) {
      continue;
    }
    const meta = fieldMeta[key] || {};
    if (meta.path) {
      if (!next[key]) {
        next[key] = resolveManagedToolPath(baseDir, next.localWorkspace, next.tool, value);
      }
      continue;
    }
    if (Array.isArray(value)) {
      if (!next[key]) {
        next[key] = [...value];
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(next, key) || next[key] == null) {
      next[key] = value;
    }
  }

  if (toolEntry && toolEntry["reuse-build-dir"] !== null
    && !Object.prototype.hasOwnProperty.call(next, "reuse-build-dir")) {
    next["reuse-build-dir"] = Boolean(toolEntry["reuse-build-dir"]);
  }

  if (toolEntry) {
    applyToolConfigDefaults(next, toolEntry);
  }

  if (!toolDisallowsRemote && next.mode !== "local") {
    applyRemoteReference(value, next, next.remote);
  }

  if (!next.ssh && !toolDisallowsRemote && next.mode !== "local") {
    const remoteName = workspaceEntry && workspaceEntry.remote;
    if (remoteName === true || remoteName === "true") {
      applyRemoteReference(value, next, "remote");
    } else {
      applyRemoteReference(value, next, remoteName);
    }
  }

  if (!next.ssh && allowGlobalRemote && !toolDisallowsRemote && next.mode !== "local") {
    applyRemoteReference(value, next, "remote");
  }

  if (!next.ssh && allowGlobalRemote && !toolDisallowsRemote && next.mode !== "local") {
    const remote = resolveDefaultRemote(value);
    if (remote) {
      next.ssh = remote.ssh;
      next.remote = remote.name;
    }
  }

  logDebug("config", "resolved defaults", {
    configPath: config.path,
    cwd: process.cwd(),
    flags: next
  });

  return {
    configPath: config.path,
    flags: next
  };
}

module.exports = {
  applyConfigDefaults,
  configDir,
  configuredConfigPath,
  explicitConfigPath,
  findConfigPath,
  loadConfig,
  RESERVED_MANAGED_TOOL_CONFIG_KEYS,
  resolveLocalPath,
  resolveCachePolicy
};
