// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { logDebug } = require("./logger");

function managedStateRoot() {
  if (process.env.MORPHEUS_STATE_ROOT) {
    return path.resolve(process.env.MORPHEUS_STATE_ROOT);
  }

  const config = loadConfig(process.cwd());
  const baseDir = configDir(config.path);
  const configValue = config.value || {};
  const workspaceRoot = configValue.workspace && configValue.workspace.root
    ? resolveLocalPath(baseDir, configValue.workspace.root)
    : null;

  if (workspaceRoot) {
    return path.join(workspaceRoot, ".morpheus", "managed");
  }

  return path.join(baseDir, ".morpheus", "managed");
}

function workspaceRegistryPath() {
  return path.join(managedStateRoot(), "workspaces.json");
}

function runRegistryDir() {
  return path.join(managedStateRoot(), "runs");
}

function runRegistryPath(id) {
  return path.join(runRegistryDir(), `${id}.json`);
}

function ensureManagedState() {
  logDebug("state", "ensuring managed state root", {
    root: managedStateRoot()
  });
  fs.mkdirSync(managedStateRoot(), { recursive: true });
  fs.mkdirSync(runRegistryDir(), { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureManagedState();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function workspaceKey(value) {
  return [
    value.mode || "local",
    value.ssh || "local",
    value.root
  ].join("::");
}

function listManagedWorkspaces() {
  return readJson(workspaceRegistryPath(), []);
}

function registerManagedWorkspace(value) {
  const items = listManagedWorkspaces();
  const key = workspaceKey(value);
  const next = items.filter((item) => workspaceKey(item) !== key);
  next.push({
    ...value,
    registeredAt: value.registeredAt || new Date().toISOString()
  });
  next.sort((left, right) => workspaceKey(left).localeCompare(workspaceKey(right)));
  writeJson(workspaceRegistryPath(), next);
  return next.find((item) => workspaceKey(item) === key);
}

function registerManagedRun(value) {
  writeJson(runRegistryPath(value.id), {
    ...value,
    registeredAt: value.registeredAt || new Date().toISOString()
  });
  return readManagedRun(value.id);
}

function readManagedRun(id) {
  return readJson(runRegistryPath(id), null);
}

function removeManagedRun(id) {
  const filePath = runRegistryPath(id);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function listManagedRuns() {
  if (!fs.existsSync(runRegistryDir())) {
    return [];
  }
  return fs
    .readdirSync(runRegistryDir())
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(runRegistryDir(), name), null))
    .filter(Boolean)
    .sort((left, right) => (right.createdAt || right.id).localeCompare(left.createdAt || left.id));
}

module.exports = {
  managedStateRoot,
  listManagedWorkspaces,
  registerManagedWorkspace,
  registerManagedRun,
  readManagedRun,
  removeManagedRun,
  listManagedRuns
};
