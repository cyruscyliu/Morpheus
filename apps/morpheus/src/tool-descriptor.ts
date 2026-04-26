// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { repoRoot } = require("./paths");

function toolDescriptorPath(toolName) {
  return path.join(repoRoot(), "tools", toolName, "tool.json");
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
    descriptorPath: path.relative(repoRoot(), filePath),
    installRoot: path.relative(repoRoot(), path.dirname(filePath))
  };
}

function listToolDescriptors() {
  const toolsRoot = path.join(repoRoot(), "tools");
  if (!fs.existsSync(toolsRoot)) {
    return [];
  }

  return fs
    .readdirSync(toolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readToolDescriptor(entry.name);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readManagedToolContract(toolName) {
  const descriptor = readToolDescriptor(toolName);
  return descriptor.managed || null;
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
  readManagedToolContract,
  readToolDescriptor,
  renderManagedTemplate,
  toolDescriptorPath
};
