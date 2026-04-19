// @ts-nocheck
const path = require("path");

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function workRoot() {
  return path.resolve(
    process.env.MORPHEUS_WORK_ROOT ||
      process.env.RESEARCH_RUNTIME_WORK_ROOT ||
      path.join(repoRoot(), "work")
  );
}

function workspacePaths() {
  const root = workRoot();
  return {
    root,
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
