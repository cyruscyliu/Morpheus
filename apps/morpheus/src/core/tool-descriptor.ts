// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { repoRoot, workspaceRoot } = require("./paths");

function toolRoots() {
  const roots = [];
  try {
    roots.push(path.join(workspaceRoot(), "tools"));
  } catch {
    // Some tests import descriptor helpers outside a workspace. In that case
    // repo-local tools remain the only discoverable tool source.
  }
  roots.push(path.join(repoRoot(), "tools"));
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

function toolDescriptorPath(toolName) {
  for (const toolsRoot of toolRoots()) {
    const candidate = path.join(toolsRoot, toolName, "tool.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(toolRoots()[0], toolName, "tool.json");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readToolDescriptor(toolName) {
  const filePath = toolDescriptorPath(toolName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing tool descriptor: tools/${toolName}/tool.json`);
  }
  const descriptor = readJson(filePath);
  return {
    ...descriptor,
    name: descriptor.name || toolName,
    runtime: descriptor.runtime || null,
    entry: descriptor.entry || null,
    descriptorPathAbsolute: filePath,
    descriptorPath: path.relative(repoRoot(), filePath),
    installRootPath: path.dirname(filePath),
    installRoot: path.relative(repoRoot(), path.dirname(filePath))
  };
}

function listToolDescriptors() {
  const seen = new Set();
  const descriptors = [];
  for (const toolsRoot of toolRoots()) {
    if (!fs.existsSync(toolsRoot)) {
      continue;
    }
    for (const entry of fs.readdirSync(toolsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) {
        continue;
      }
      try {
        const descriptor = readToolDescriptor(entry.name);
        descriptors.push(descriptor);
        seen.add(entry.name);
      } catch {
        // Ignore invalid tool directories in discovery, as before.
      }
    }
  }
  return descriptors.sort((left, right) => left.name.localeCompare(right.name));
}

function renderManagedTemplate(template, values) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`missing template value: ${key}`);
    }
    const value = values[key];
    if (value == null || value === "") {
      throw new Error(`empty template value: ${key}`);
    }
    return String(value);
  });
}

module.exports = {
  listToolDescriptors,
  readToolDescriptor,
  renderManagedTemplate
};
