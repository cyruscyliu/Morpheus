// @ts-nocheck
const fs = require("fs");
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findConfigPath(startDir) {
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

function loadConfig(startDir) {
  const filePath = findConfigPath(startDir);
  if (!filePath) {
    return {
      path: null,
      value: {}
    };
  }
  return {
    path: filePath,
    value: yaml.parse(fs.readFileSync(filePath, "utf8")) || {}
  };
}

function configDir(configPath) {
  if (!configPath) {
    return process.cwd();
  }
  return path.dirname(configPath);
}

function resolveLocalPath(baseDir, inputPath) {
  if (!inputPath) {
    return inputPath;
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
  return {
    name,
    mode: item.mode || null,
    remote: item.remote || null,
    source: item.source || null,
    patchDir: item["patch-dir"] || item.patchDir || null,
    reuseBuildDir: item["reuse-build-dir"] ?? item.reuseBuildDir ?? null,
    buildDirKey: item["build-dir-key"] || item.buildDirKey || null,
    buildrootVersion: item["buildroot-version"] || item.buildrootVersion || null,
    qemuVersion: item["qemu-version"] || item.qemuVersion || null,
    archiveUrl: item["archive-url"] || item.archiveUrl || null,
    executable: item.executable || null,
    path: item.path || null,
    targetList: Array.isArray(item["target-list"])
      ? [...item["target-list"]]
      : Array.isArray(item.targetList)
        ? [...item.targetList]
        : null,
    configureArgs: Array.isArray(item["configure-arg"])
      ? [...item["configure-arg"]]
      : Array.isArray(item["configure-args"])
        ? [...item["configure-args"]]
        : Array.isArray(item.configureArgs)
          ? [...item.configureArgs]
          : null,
    defconfig: item.defconfig || null,
    target: item.target || null,
    instanceName: item.name || null,
    qemu: item.qemu || null,
    microkitSdk: item["microkit-sdk"] || item.microkitSdk || null,
    microkitVersion: item["microkit-version"] || item.microkitVersion || null,
    toolchain: item.toolchain || null,
    libvmmDir: item["libvmm-dir"] || item.libvmmDir || null,
    sel4Dir: item["sel4-dir"] || item.sel4Dir || null,
    sel4Version: item["sel4-version"] || item.sel4Version || null,
    board: item.board || null,
    append: item.append || null,
    makeArgs: Array.isArray(item["make-arg"])
      ? [...item["make-arg"]]
      : Array.isArray(item["make-args"])
        ? [...item["make-args"]]
        : Array.isArray(item.makeArgs)
          ? [...item.makeArgs]
          : null,
    qemuArgs: Array.isArray(item["qemu-arg"])
      ? [...item["qemu-arg"]]
      : Array.isArray(item["qemu-args"])
        ? [...item["qemu-args"]]
        : Array.isArray(item.qemuArgs)
          ? [...item.qemuArgs]
          : null,
    artifacts: Array.isArray(item.artifacts) ? [...item.artifacts] : null,
    configFragment: Array.isArray(item["config-fragment"])
      ? [...item["config-fragment"]]
      : Array.isArray(item.configFragment)
        ? [...item.configFragment]
        : null
    ,
    dependencies: item.dependencies || null,
    raw: item
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
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const baseDir = configDir(config.path);
  const next = { ...flags };
  const allowGlobalRemote = Boolean(options && options.allowGlobalRemote);
  const allowToolDefaults = Boolean(options && options.allowToolDefaults);
  const toolDisallowsRemote = ["microkit-sdk", "qemu", "nvirsh", "sel4", "libvmm"].includes(next.tool);

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
  if (toolEntry && toolEntry.mode && !next.mode) {
    next.mode = toolEntry.mode;
  }

  if (toolEntry && toolEntry.remote && next.mode !== "local" && !next.remote && !next.ssh) {
    next.remote = toolEntry.remote;
  }

  if (toolEntry && toolEntry.source && !next.source) {
    next.source = resolveLocalPath(baseDir, toolEntry.source);
  }

  if (toolEntry && toolEntry.path && !next.path) {
    next.path = resolveLocalPath(baseDir, toolEntry.path);
  }

  if (toolEntry && toolEntry.executable && !next.path) {
    next.path = resolveLocalPath(baseDir, toolEntry.executable);
  }

  if (toolEntry && toolEntry.targetList && !next["target-list"]) {
    next["target-list"] = [...toolEntry.targetList];
  }

  if (toolEntry && toolEntry.configureArgs && !next["configure-arg"]) {
    next["configure-arg"] = [...toolEntry.configureArgs];
  }

  if (toolEntry && toolEntry.patchDir && !next["patch-dir"]) {
    next["patch-dir"] = resolveLocalPath(baseDir, toolEntry.patchDir);
  }

  if (toolEntry && toolEntry.reuseBuildDir !== null
    && !Object.prototype.hasOwnProperty.call(next, "reuse-build-dir")) {
    next["reuse-build-dir"] = Boolean(toolEntry.reuseBuildDir);
  }

  if (toolEntry && toolEntry.buildDirKey && !next["build-dir-key"]) {
    next["build-dir-key"] = toolEntry.buildDirKey;
  }

  if (toolEntry && toolEntry.buildrootVersion && !next["buildroot-version"]) {
    next["buildroot-version"] = toolEntry.buildrootVersion;
  }

  if (toolEntry && toolEntry.qemuVersion && !next["qemu-version"]) {
    next["qemu-version"] = toolEntry.qemuVersion;
  }

  if (toolEntry && toolEntry.archiveUrl && !next["archive-url"]) {
    next["archive-url"] = toolEntry.archiveUrl;
  }

  if (toolEntry && toolEntry.defconfig && !next.defconfig) {
    next.defconfig = toolEntry.defconfig;
  }

  if (toolEntry && toolEntry.target && !next.target) {
    next.target = toolEntry.target;
  }

  if (toolEntry && toolEntry.instanceName && !next.name) {
    next.name = toolEntry.instanceName;
  }

  if (toolEntry && toolEntry.qemu && !next.qemu) {
    next.qemu = resolveLocalPath(baseDir, toolEntry.qemu);
  }

  if (toolEntry && toolEntry.microkitSdk && !next["microkit-sdk"]) {
    next["microkit-sdk"] = resolveLocalPath(baseDir, toolEntry.microkitSdk);
  }

  if (toolEntry && next.tool !== "microkit-sdk" && toolEntry.microkitVersion && !next["microkit-version"]) {
    next["microkit-version"] = toolEntry.microkitVersion;
  }

  if (toolEntry && toolEntry.toolchain && !next.toolchain) {
    next.toolchain = resolveLocalPath(baseDir, toolEntry.toolchain);
  }

  if (toolEntry && toolEntry.libvmmDir && !next["libvmm-dir"]) {
    next["libvmm-dir"] = resolveLocalPath(baseDir, toolEntry.libvmmDir);
  }

  if (toolEntry && toolEntry.sel4Dir && !next["sel4-dir"]) {
    next["sel4-dir"] = resolveLocalPath(baseDir, toolEntry.sel4Dir);
  }

  if (toolEntry && toolEntry.sel4Version && !next["sel4-version"]) {
    next["sel4-version"] = toolEntry.sel4Version;
  }

  if (toolEntry && toolEntry.board && !next.board) {
    next.board = toolEntry.board;
  }

  if (toolEntry && toolEntry.append && !next.append) {
    next.append = toolEntry.append;
  }

  if (toolEntry && toolEntry.makeArgs && !next.makeArg) {
    next.makeArg = [...toolEntry.makeArgs];
  }

  if (toolEntry && toolEntry.qemuArgs && !next["qemu-arg"]) {
    next["qemu-arg"] = [...toolEntry.qemuArgs];
  }

  if (toolEntry && toolEntry.artifacts && !next.artifact) {
    next.artifact = [...toolEntry.artifacts];
  }

  if (toolEntry && toolEntry.configFragment && !next["config-fragment"]) {
    next["config-fragment"] = [...toolEntry.configFragment];
  }

  if (toolEntry) {
    applyToolConfigDefaults(next, toolEntry);
  }

  if (!toolDisallowsRemote) {
    applyRemoteReference(value, next, next.remote);
  }

  if (!next.ssh && !toolDisallowsRemote) {
    const remoteName = workspaceEntry && workspaceEntry.remote;
    if (remoteName === true || remoteName === "true") {
      applyRemoteReference(value, next, "remote");
    } else {
      applyRemoteReference(value, next, remoteName);
    }
  }

  if (!next.ssh && allowGlobalRemote && !toolDisallowsRemote) {
    applyRemoteReference(value, next, "remote");
  }

  if (!next.ssh && allowGlobalRemote && !toolDisallowsRemote) {
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
  findConfigPath,
  loadConfig,
  RESERVED_MANAGED_TOOL_CONFIG_KEYS,
  resolveLocalPath
};
