// @ts-nocheck
const path = require("path");

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

function workRoot() {
  const { loadConfig, configDir, resolveLocalPath } = require("./config");
  const override = process.env.MORPHEUS_WORK_ROOT || process.env.RESEARCH_RUNTIME_WORK_ROOT;
  if (override) {
    return path.resolve(override);
  }

  const config = loadConfig(process.cwd());
  const baseDir = configDir(config.path);
  const configured = config.value && config.value.workspace && config.value.workspace.root
    ? resolveLocalPath(baseDir, config.value.workspace.root)
    : null;

  if (!configured) {
    throw new Error("workspace.root must be configured in Morpheus config or provided via MORPHEUS_WORK_ROOT");
  }

  return path.resolve(configured);
}

function dataRoot() {
  if (process.env.MORPHEUS_DATA_ROOT) {
    return path.resolve(process.env.MORPHEUS_DATA_ROOT);
  }
  if (process.env.MORPHEUS_WORKSPACES_ROOT) {
    return path.resolve(path.dirname(process.env.MORPHEUS_WORKSPACES_ROOT));
  }
  return null;
}

function defaultCacheRoot() {
  if (process.env.MORPHEUS_CACHE_ROOT) {
    return path.resolve(process.env.MORPHEUS_CACHE_ROOT);
  }
  const root = dataRoot();
  if (!root) {
    return null;
  }
  return path.join(root, "cache");
}

function workspacePaths() {
  const root = workRoot();
  const cacheRoot = defaultCacheRoot() || path.join(root, "cache");

  return {
    root,
    tools: path.join(root, "tools"),
    downloads: path.join(root, "downloads"),
    sources: path.join(root, "sources"),
    builds: path.join(root, "builds"),
    llbicBuilds: path.join(root, "builds", "llbic"),
    runs: path.join(root, "runs"),
    cache: cacheRoot,
    tmp: path.join(root, "tmp")
  };
}

module.exports = {
  repoRoot,
  workRoot,
  dataRoot,
  defaultCacheRoot,
  workspacePaths
};
