// @ts-nocheck
const fs = require("fs");
const path = require("path");

function localWorkspaceRoot(workspace) {
  return path.resolve(process.cwd(), workspace);
}

function centeredRunDir(workspace, id) {
  return path.join(localWorkspaceRoot(workspace), "runs", id);
}

function nestedRunsRoot(runDir) {
  return path.join(runDir, "runs");
}

function resolveManagedRunDir(workspace, id) {
  const explicitRunsRoot = process.env.MORPHEUS_RUNS_ROOT_OVERRIDE;
  if (explicitRunsRoot) {
    return path.join(path.resolve(process.cwd(), explicitRunsRoot), id);
  }

  return centeredRunDir(workspace, id);
}

function withNestedRunRoot(parentRunDir, callback) {
  const previousRunsRoot = process.env.MORPHEUS_RUNS_ROOT_OVERRIDE;

  process.env.MORPHEUS_RUNS_ROOT_OVERRIDE = nestedRunsRoot(parentRunDir);

  try {
    return callback();
  } finally {
    if (previousRunsRoot == null) {
      delete process.env.MORPHEUS_RUNS_ROOT_OVERRIDE;
    } else {
      process.env.MORPHEUS_RUNS_ROOT_OVERRIDE = previousRunsRoot;
    }
  }
}

function findManagedManifestFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile() && entry.name === "manifest.json") {
        results.push(nextPath);
      }
    }
  }

  results.sort((left, right) => left.localeCompare(right));
  return results;
}

module.exports = {
  centeredRunDir,
  findManagedManifestFiles,
  localWorkspaceRoot,
  nestedRunsRoot,
  resolveManagedRunDir,
  withNestedRunRoot,
};
