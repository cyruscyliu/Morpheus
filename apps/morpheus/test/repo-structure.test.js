const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const allowedRootEntries = new Set([
  ".cache",
  ".env.example",
  ".git",
  ".github",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "README.md",
  "apps",
  "bin",
  "install-dependencies.sh",
  "morpheus.yaml",
  "node_modules",
  "openspec",
  "package.json",
  "paseo.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "projects",
  "scripts",
  "skills",
  "tools",
  "tsconfig.base.json",
]);
const repoManagedRoots = [
  "apps",
  "bin",
  "openspec",
  "projects",
  "scripts",
  "skills",
  "tools",
];
const allowedHiddenFiles = new Set([
  ".dockerignore",
  ".gitignore",
  ".gitkeep",
  ".openspec.yaml",
]);
const allowedFileExtensions = new Set([
  ".c",
  ".cjs",
  ".cmake",
  ".config",
  ".cpp",
  ".css",
  ".devilang",
  ".dot",
  ".fragment",
  ".g4",
  ".h",
  ".hash",
  ".hpp",
  ".html",
  ".in",
  ".inc",
  ".js",
  ".json",
  ".jsonl",
  ".legacy",
  ".list",
  ".ll",
  ".md",
  ".mid",
  ".mjs",
  ".patch",
  ".pdf",
  ".png",
  ".py",
  ".raw",
  ".rs",
  ".sh",
  ".state",
  ".tex",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".TXT",
  ".yaml",
]);
const allowedBasenamesWithoutExtension = new Set([
  "Dockerfile",
  "Justfile",
  "LICENSE",
  "Makefile",
  "VERSION",
  "configure",
  "devilang",
  "llbic",
  "llcg",
  "morpheus",
]);
const allowedPathSpecificFiles = new Set([
  "tools/llcg/src/KallGraph/SVF-3.3/docs/images/cpu2000-flto",
  "tools/llcg/src/KallGraph/SVF-3.3/docs/images/cpu2006-flto",
  "tools/llcg/src/KallGraph/src/sample_output/20250528_140355/callgraph1",
  "tools/llcg/src/KallGraph/src/sample_output/20250528_140355/callgraph2",
  "tools/llcg/src/KallGraph/src/sample_output/20250528_140355/log",
]);
const bannedDirectoryNames = new Set([
  ".cache",
  ".tmp",
  "__pycache__",
  "build",
  "tmp",
]);
const bannedFileBasenames = [
  /^core\.\d+$/,
];
const bannedFileExtensions = new Set([
  ".log",
  ".out",
  ".pyc",
  ".tmp",
]);

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath) || ".";
}

function shouldSkipStructureSubtree(relativeDir) {
  const normalized = relativeDir.split(path.sep).join("/");

  if (normalized === ".") {
    return false;
  }

  if (
    normalized === ".git" ||
    normalized === ".cache" ||
    normalized.startsWith(".cache/") ||
    normalized === ".tmp" ||
    normalized.startsWith(".tmp/")
  ) {
    return true;
  }

  if (
    /^apps\/[^/]+\/node_modules(?:\/|$)/.test(normalized) ||
    /^apps\/[^/]+\/\.next(?:\/|$)/.test(normalized) ||
    /^apps\/docs\/out(?:\/|$)/.test(normalized) ||
    /^apps\/morpheus\/dist(?:\/|$)/.test(normalized) ||
    /(?:^|\/)tests\/fixtures(?:\/|$)/.test(normalized) ||
    /^projects\/[^/]+\/workspace(?:\/|$)/.test(normalized) ||
    /^projects\/[^/]+\/artifacts\/out(?:\/|$)/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function collectIllegalRootEntries(issues) {
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (!allowedRootEntries.has(entry.name)) {
      issues.push(entry.name);
    }
  }
}

function isAllowedFile(relativePath, baseName) {
  if (allowedPathSpecificFiles.has(relativePath)) {
    return true;
  }

  if (baseName.startsWith(".")) {
    return allowedHiddenFiles.has(baseName);
  }

  if (bannedFileBasenames.some((pattern) => pattern.test(baseName))) {
    return false;
  }

  const extension = path.extname(baseName);
  if (!extension) {
    return allowedBasenamesWithoutExtension.has(baseName);
  }

  if (bannedFileExtensions.has(extension)) {
    return false;
  }

  return allowedFileExtensions.has(extension);
}

function collectIllegalStructure(currentDir, issues) {
  const relativeDir = repoRelative(currentDir);
  const normalizedDir = relativeDir.split(path.sep).join("/");

  if (shouldSkipStructureSubtree(relativeDir)) {
    return;
  }

  if (/^projects\/[^/]+\/projects(?:\/|$)/.test(normalizedDir)) {
    issues.push(relativeDir);
    return;
  }

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = repoRelative(absolutePath);

    if (entry.isDirectory()) {
      if (shouldSkipStructureSubtree(relativePath)) {
        continue;
      }

      if (
        entry.name.startsWith(".") ||
        entry.name.startsWith(".morpheus-") ||
        bannedDirectoryNames.has(entry.name)
      ) {
        issues.push(relativePath);
        continue;
      }

      collectIllegalStructure(absolutePath, issues);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!isAllowedFile(relativePath, entry.name)) {
      issues.push(relativePath);
    }
  }
}

test("repo structure only allows whitelisted files and directories", () => {
  const issues = [];

  collectIllegalRootEntries(issues);

  for (const rootName of repoManagedRoots) {
    const rootPath = path.join(repoRoot, rootName);
    if (!fs.existsSync(rootPath)) {
      continue;
    }
    collectIllegalStructure(rootPath, issues);
  }

  issues.sort();
  assert.deepEqual(
    issues,
    [],
    `illegal repo paths found:\n${issues.map((item) => `- ${item}`).join("\n")}`,
  );
});
