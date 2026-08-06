// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadConfig, configDir, resolveLocalPath } = require("../core/config");
const { repoRoot } = require("../core/paths");

function isWithinDir(parentDir, candidatePath) {
  if (!parentDir || !candidatePath) {
    return false;
  }
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function relativePosix(baseDir, targetPath) {
  return path.relative(baseDir, targetPath).replace(/\\/g, "/");
}

function detectDataRoot(workspaceRoot) {
  const absolute = path.resolve(workspaceRoot);
  const marker = `${path.sep}workspaces${path.sep}`;
  const index = absolute.lastIndexOf(marker);
  if (index < 0) {
    return null;
  }
  return absolute.slice(0, index);
}

function ensureMissingOrDelete(outputDir, force) {
  if (!fs.existsSync(outputDir)) {
    return;
  }
  if (!force) {
    throw new Error(`output directory already exists: ${outputDir}`);
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
}

function validateSafeOutputDir(outputDir, sourceRoots) {
  for (const sourceRoot of sourceRoots) {
    if (!sourceRoot) {
      continue;
    }
    if (isWithinDir(outputDir, sourceRoot)) {
      throw new Error(`output directory cannot contain source root: ${outputDir}`);
    }
  }
}

function resolveConfiguredWorkflowBundle(configPath, workflowName) {
  const config = loadConfig(process.cwd(), { explicitPath: configPath });
  if (!config.path) {
    throw new Error("could not resolve Morpheus config");
  }
  const workflows = config.value && config.value.workflows && typeof config.value.workflows === "object"
    ? config.value.workflows
    : {};
  const workflow = workflows[workflowName];
  if (!workflow) {
    throw new Error(`unknown configured workflow: ${workflowName}; run 'morpheus workflow list' to inspect available workflows`);
  }
  const baseDir = configDir(config.path);
  const workspaceRoot = config.value && config.value.workspace && config.value.workspace.root
    ? resolveLocalPath(baseDir, config.value.workspace.root)
    : null;
  if (!workspaceRoot) {
    throw new Error("workspace.root must be configured in Morpheus config");
  }
  return {
    configPath: config.path,
    configValue: config.value || {},
    baseDir,
    workflow,
    workspaceRoot,
    workflowName,
  };
}

function collectExclusions(sourceRoot, outputDir, extraNames = []) {
  const exclusions = new Set(extraNames);
  const relativeOutput = path.relative(sourceRoot, outputDir);
  if (relativeOutput && !relativeOutput.startsWith("..")) {
    exclusions.add(relativeOutput.replace(/\\/g, "/"));
  }
  return exclusions;
}

function shouldExclude(sourceRoot, candidatePath, exclusions) {
  const relative = path.relative(sourceRoot, candidatePath);
  if (!relative) {
    return false;
  }
  const normalized = relative.replace(/\\/g, "/");
  for (const prefix of exclusions) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

function copyTree(sourceRoot, destinationRoot, exclusions) {
  fs.cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    preserveTimestamps: true,
    filter(candidatePath) {
      return !shouldExclude(sourceRoot, candidatePath, exclusions);
    }
  });
}

function hardlinkTree(sourceRoot, destinationRoot, exclusions) {
  const stack = [[sourceRoot, destinationRoot]];
  while (stack.length > 0) {
    const [sourcePath, destinationPath] = stack.pop();
    if (shouldExclude(sourceRoot, sourcePath, exclusions)) {
      continue;
    }
    const stat = fs.lstatSync(sourcePath);
    if (stat.isDirectory()) {
      fs.mkdirSync(destinationPath, { recursive: true, mode: stat.mode });
      for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
        stack.push([
          path.join(sourcePath, entry.name),
          path.join(destinationPath, entry.name)
        ]);
      }
      continue;
    }
    if (stat.isSymbolicLink()) {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.symlinkSync(fs.readlinkSync(sourcePath), destinationPath);
      continue;
    }
    if (stat.isFile()) {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      try {
        fs.linkSync(sourcePath, destinationPath);
      } catch (error) {
        // pnpm and prior exports can already exhaust nlink; fall back to copy.
        const code = error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
        if (code === "EMLINK" || code === "EPERM" || code === "EXDEV") {
          fs.copyFileSync(sourcePath, destinationPath);
        } else {
          throw error;
        }
      }
      continue;
    }
  }
}

function mirrorTree(sourceRoot, destinationRoot, options = {}) {
  const linkMode = options.linkMode || "copy";
  const exclusions = collectExclusions(sourceRoot, destinationRoot, options.excludeNames || []);
  fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
  if (linkMode === "hardlink") {
    hardlinkTree(sourceRoot, destinationRoot, exclusions);
    return;
  }
  copyTree(sourceRoot, destinationRoot, exclusions);
}

function runWorkflow(configPath, workflowName) {
  const result = spawnSync(
    path.join(repoRoot(), "bin", "morpheus"),
    ["--config", configPath, "workflow", "run", "--name", workflowName],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(stderr ? `workflow prepare failed: ${stderr}` : "workflow prepare failed");
  }
}

function runBundleCheck(scriptPath, argv, message) {
  const result = spawnSync(scriptPath, argv, { encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(stderr ? `${message}: ${stderr}` : message);
  }
  return String(result.stdout || "");
}

function exportWorkflowBundle(options) {
  const workflowName = String(options.workflowName || "");
  if (!workflowName) {
    throw new Error("workflow export requires --name WORKFLOW_NAME");
  }
  const linkMode = String(options.linkMode || "copy");
  if (linkMode !== "copy" && linkMode !== "hardlink") {
    throw new Error("workflow export --link-mode must be one of: copy, hardlink");
  }
  const configPath = options.configPath || process.env.MORPHEUS_CONFIG || null;
  const loaded = resolveConfiguredWorkflowBundle(configPath, workflowName);
  const workspaceName = path.basename(loaded.workspaceRoot);
  const dataRoot = detectDataRoot(loaded.workspaceRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "").slice(0, 15) + "Z";
  if (!options.outputDir && !dataRoot) {
    throw new Error(
      "workflow export requires --output-dir when workspace.root is outside a data-root workspaces directory"
    );
  }
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(dataRoot, "artifacts", "workflow-bundles", workflowName, stamp);
  const sourceConfigRoot = isWithinDir(loaded.workspaceRoot, loaded.configPath)
    ? loaded.workspaceRoot
    : (isWithinDir(repoRoot(), loaded.configPath) ? repoRoot() : null);
  if (!sourceConfigRoot) {
    throw new Error("--config must resolve inside the repo root or workspace root");
  }
  const sourceConfigRel = relativePosix(sourceConfigRoot, loaded.configPath);
  const bundleConfigRel = sourceConfigRoot === loaded.workspaceRoot
    ? path.posix.join("data", "workspaces", workspaceName, sourceConfigRel)
    : path.posix.join("repo", sourceConfigRel);
  const workflowCategory = String(loaded.workflow.category || "run");

  validateSafeOutputDir(outputDir, [repoRoot(), loaded.workspaceRoot]);
  ensureMissingOrDelete(outputDir, Boolean(options.force));
  if (options.prepare) {
    runWorkflow(loaded.configPath, workflowName);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const bundleRepoRoot = path.join(outputDir, "repo");
  const bundleWorkspaceRoot = path.join(outputDir, "data", "workspaces", workspaceName);
  mirrorTree(repoRoot(), bundleRepoRoot, {
    linkMode,
    excludeNames: [".git", ".cache", ".morpheus-sync", "artifacts"]
  });
  mirrorTree(loaded.workspaceRoot, bundleWorkspaceRoot, {
    linkMode,
    excludeNames: [".git", ".cache", ".morpheus-sync", "artifacts", "tmp", "runs", "workflows", "poison"]
  });

  const bundleConfigPath = path.join(outputDir, bundleConfigRel);
  if (sourceConfigRoot === loaded.workspaceRoot) {
    const sourceConfigPath = path.join(bundleWorkspaceRoot, sourceConfigRel);
    if (!fs.existsSync(sourceConfigPath)) {
      throw new Error(`missing bundled config: ${bundleConfigRel}`);
    }
  } else {
    const sourceConfigPath = path.join(bundleRepoRoot, sourceConfigRel);
    if (!fs.existsSync(sourceConfigPath)) {
      throw new Error(`missing bundled config: ${bundleConfigRel}`);
    }
  }

  const manifest = {
    workflow: workflowName,
    workflow_category: workflowCategory,
    exported_at: new Date().toISOString(),
    workspace_name: workspaceName,
    source: {
      config_kind: sourceConfigRoot === loaded.workspaceRoot ? "workspace" : "repo",
      config_relative_path: sourceConfigRel,
      workspace_root: sourceConfigRoot === loaded.workspaceRoot ? "workspace" : null,
    },
    bundle: {
      repo_root: "repo",
      workspace_root: path.posix.join("data", "workspaces", workspaceName),
      config_path: bundleConfigRel,
    }
  };

  fs.writeFileSync(
    path.join(outputDir, "export-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const morpheusScript = `#!/usr/bin/env sh
set -eu

bundle_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export MORPHEUS_REPO_ROOT="\${bundle_dir}/repo"
export MORPHEUS_DATA_ROOT="\${bundle_dir}/data"

cd "\${bundle_dir}/repo"
exec ./bin/morpheus --config "\${bundle_dir}/${bundleConfigRel}" "$@"
`;
  fs.writeFileSync(path.join(outputDir, "morpheus.sh"), morpheusScript, "utf8");
  fs.chmodSync(path.join(outputDir, "morpheus.sh"), 0o755);

  const runWorkflowScript = `#!/usr/bin/env sh
set -eu

bundle_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "\${bundle_dir}/morpheus.sh" workflow run --name "${workflowName}" "$@"
`;
  fs.writeFileSync(path.join(outputDir, "run-workflow.sh"), runWorkflowScript, "utf8");
  fs.chmodSync(path.join(outputDir, "run-workflow.sh"), 0o755);

  const inspectWorkflowScript = `#!/usr/bin/env sh
set -eu

bundle_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "\${bundle_dir}/morpheus.sh" workflow inspect --name "${workflowName}" "$@"
`;
  fs.writeFileSync(path.join(outputDir, "inspect-workflow.sh"), inspectWorkflowScript, "utf8");
  fs.chmodSync(path.join(outputDir, "inspect-workflow.sh"), 0o755);

  const readme = [
    "# Workflow Bundle",
    "",
    "This bundle exports one configured Morpheus workflow.",
    "",
    `- workflow: \`${workflowName}\``,
    `- category: \`${workflowCategory}\``,
    `- workspace: \`${workspaceName}\``,
    `- config: \`${bundleConfigRel}\``,
    "",
    "Usage:",
    "",
    "```bash",
    "./morpheus.sh workflow list --json",
    "./run-workflow.sh --json",
    "```",
    "",
    "Host prerequisites still apply.",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(outputDir, "README.md"), `${readme}\n`, "utf8");

  const bundleMorpheusPath = path.join(outputDir, "morpheus.sh");
  runBundleCheck(bundleMorpheusPath, ["config", "show", "--json"], "bundle config check failed");
  const workflowListJson = runBundleCheck(
    bundleMorpheusPath,
    ["workflow", "list", "--json"],
    "bundle workflow list failed"
  );
  const workflowList = JSON.parse(workflowListJson);
  const items =
    workflowList && workflowList.details && Array.isArray(workflowList.details.workflows)
      ? workflowList.details.workflows
      : [];
  if (!items.some((item) => item && item.name === workflowName)) {
    throw new Error(`exported bundle is missing workflow: ${workflowName}`);
  }

  return {
    command: "workflow export",
    status: "success",
    exit_code: 0,
    summary: "exported runnable workflow bundle",
    details: {
      workflow: workflowName,
      category: workflowCategory,
      output_dir: relativePosix(process.cwd(), outputDir),
      config: relativePosix(process.cwd(), loaded.configPath),
      workspace_root: relativePosix(process.cwd(), loaded.workspaceRoot),
      bundle_config: relativePosix(outputDir, bundleConfigPath),
      link_mode: linkMode,
      prepare: Boolean(options.prepare),
    },
  };
}

module.exports = {
  exportWorkflowBundle
};
