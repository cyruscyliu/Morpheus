// @ts-nocheck
const fs = require("fs");
const path = require("path");

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

function isWorkspaceDir(dir) {
  const current = path.resolve(dir || process.cwd());
  const configPath = path.join(current, "morpheus.yaml");
  const marker = path.join(current, ".morpheus");
  return fs.existsSync(configPath)
    && fs.existsSync(marker)
    && fs.statSync(marker).isDirectory();
}

function workspaceRoot(startDir) {
  const current = path.resolve(startDir || process.cwd());
  if (!isWorkspaceDir(current)) {
    throw new Error("could not find workspace: current directory must contain morpheus.yaml and .morpheus");
  }
  return current;
}

function workRoot() {
  return workspaceRoot();
}

function workspacePaths() {
  const { loadConfig, configDir, resolveCachePolicy } = require("./config");
  const root = workRoot();
  const config = loadConfig(process.cwd());
  const policy = resolveCachePolicy(config.value || {}, config.path, configDir(config.path));
  const cacheRoot = policy && policy.root ? policy.root : null;
  if (!cacheRoot) {
    throw new Error("cache.root must be configured in morpheus.yaml");
  }

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
  isWorkspaceDir,
  workspaceRoot,
  workRoot,
  workspacePaths
};