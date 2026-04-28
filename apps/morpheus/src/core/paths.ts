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

  return path.resolve(configured || path.join(repoRoot(), "hyperarm-workspace"));
}

function workspacePaths() {
  const root = workRoot();
  return {
    root,
    tools: path.join(root, "tools"),
    downloads: path.join(root, "downloads"),
    sources: path.join(root, "sources"),
    builds: path.join(root, "builds"),
    llbicBuilds: path.join(root, "builds", "llbic"),
    runs: path.join(root, "runs"),
    cache: path.join(root, "cache"),
    tmp: path.join(root, "tmp")
  };
}

module.exports = {
  repoRoot,
  workRoot,
  workspacePaths
};
