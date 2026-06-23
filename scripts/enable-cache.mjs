import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const requireFromMorpheusApp = createRequire(new URL("../apps/morpheus/package.json", import.meta.url));
const YAML = requireFromMorpheusApp("yaml");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function expandUser(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveLocal(baseDir, inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  const expanded = expandUser(String(inputPath));
  return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

function inferNamespace(configPath, repoRoot) {
  const relative = path.relative(repoRoot, configPath);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length >= 3 && parts[0] === "projects" && parts[2] === "morpheus.yaml") {
    return parts[1];
  }
  if (path.resolve(configPath) === path.join(repoRoot, "morpheus.yaml")) {
    return "root";
  }
  return path.basename(path.dirname(configPath)) || "default";
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    fail(`failed: ${command} ${args.join(" ")}`);
  }
}

function ensurePatchSymlink(workspaceRoot, cacheToolsRoot, toolName) {
  const workspacePatches = path.join(workspaceRoot, "tools", toolName, "patches");
  if (!fs.existsSync(workspacePatches) || !fs.statSync(workspacePatches).isDirectory()) {
    return false;
  }
  const cacheToolDir = path.join(cacheToolsRoot, toolName);
  const cachePatches = path.join(cacheToolDir, "patches");
  fs.mkdirSync(cacheToolDir, { recursive: true });
  if (fs.existsSync(cachePatches)) {
    return false;
  }
  fs.symlinkSync(workspacePatches, cachePatches, "dir");
  return true;
}

function migrateToolTrees(workspaceRoot, cacheToolsRoot, toolName, kinds) {
  const migrated = [];
  for (const kind of kinds) {
    const sourceDir = path.join(workspaceRoot, "tools", toolName, kind);
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      continue;
    }
    const targetDir = path.join(cacheToolsRoot, toolName, kind);
    fs.mkdirSync(targetDir, { recursive: true });
    run("rsync", ["-a", `${sourceDir}/`, `${targetDir}/`]);
    migrated.push(kind);
  }
  return migrated;
}

function readScalar(doc, pathItems) {
  const value = doc.getIn(pathItems);
  return value == null ? null : String(value);
}

function ensureCacheConfig(doc, configPath, repoRoot, flags) {
  const namespace = flags.namespace || readScalar(doc, ["cache", "namespace"]) || inferNamespace(configPath, repoRoot);
  const cacheRootRaw = flags.root || readScalar(doc, ["cache", "root"]) || "./.cache";
  const expected = {
    root: cacheRootRaw,
    namespace,
    downloads: "global",
    builds: "global",
    src: "global",
  };

  const existingRoot = readScalar(doc, ["cache", "root"]);
  const existingNamespace = readScalar(doc, ["cache", "namespace"]);
  const existingDownloads = readScalar(doc, ["cache", "downloads"]);
  const existingBuilds = readScalar(doc, ["cache", "builds"]);
  const existingSrc = readScalar(doc, ["cache", "src"]);

  if (existingRoot && existingRoot !== expected.root) {
    fail(`cache.root already set to ${existingRoot}; refusing to overwrite in ${configPath}`);
  }
  if (existingNamespace && existingNamespace !== expected.namespace) {
    fail(`cache.namespace already set to ${existingNamespace}; refusing to overwrite in ${configPath}`);
  }
  if (existingDownloads && existingDownloads !== expected.downloads) {
    fail(`cache.downloads already set to ${existingDownloads}; refusing to overwrite in ${configPath}`);
  }
  if (existingBuilds && existingBuilds !== expected.builds) {
    fail(`cache.builds already set to ${existingBuilds}; refusing to overwrite in ${configPath}`);
  }
  if (existingSrc && existingSrc !== expected.src) {
    fail(`cache.src already set to ${existingSrc}; refusing to overwrite in ${configPath}`);
  }

  doc.setIn(["cache", "root"], expected.root);
  doc.setIn(["cache", "namespace"], expected.namespace);
  doc.setIn(["cache", "downloads"], expected.downloads);
  doc.setIn(["cache", "builds"], expected.builds);
  doc.setIn(["cache", "src"], expected.src);
  return expected;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const configPath = flags.config
    ? path.resolve(flags.config)
    : path.join(repoRoot, "morpheus.yaml");
  if (!fs.existsSync(configPath)) {
    fail(`config file not found: ${configPath}`);
  }

  const configDir = path.dirname(configPath);
  const doc = YAML.parseDocument(fs.readFileSync(configPath, "utf8"));
  const workspaceRootRaw = doc.getIn(["workspace", "root"]);
  if (!workspaceRootRaw) {
    fail("workspace.root must be configured before enabling cache");
  }

  const cacheConfig = ensureCacheConfig(doc, configPath, repoRoot, flags);
  const workspaceRoot = resolveLocal(configDir, String(workspaceRootRaw));
  const cacheRoot = resolveLocal(configDir, String(cacheConfig.root));
  const namespace = cacheConfig.namespace;
  const cacheToolsRoot = path.join(cacheRoot, namespace, "tools");
  fs.writeFileSync(configPath, String(doc), "utf8");

  fs.mkdirSync(cacheToolsRoot, { recursive: true });
  const toolRoot = path.join(workspaceRoot, "tools");
  const toolNames = fs.existsSync(toolRoot)
    ? fs.readdirSync(toolRoot).filter((name) => {
        const full = path.join(toolRoot, name);
        return fs.statSync(full).isDirectory();
      })
    : [];

  const summary = {
    config: configPath,
    workspace: workspaceRoot,
    cache_root: cacheRoot,
    namespace,
    tools: {},
  };

  for (const toolName of toolNames) {
    const migrated = migrateToolTrees(workspaceRoot, cacheToolsRoot, toolName, ["src", "downloads", "builds"]);
    const linkedPatches = ensurePatchSymlink(workspaceRoot, cacheToolsRoot, toolName);
    if (migrated.length === 0 && !linkedPatches) {
      continue;
    }
    summary.tools[toolName] = {
      migrated,
      patches_symlinked: linkedPatches,
    };
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
