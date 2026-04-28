// @ts-nocheck
const path = require("path");
const { loadConfig, configDir, resolveLocalPath } = require("./config");
const { readToolDescriptor, renderManagedTemplate } = require("./tool-descriptor");

function workspaceRoot(flags) {
  return flags.localWorkspace || flags.workspace || null;
}

function configuredTool(name) {
  const config = loadConfig(process.cwd());
  const value = config.value || {};
  const item = value.tools && value.tools[name] ? value.tools[name] : null;
  return {
    baseDir: configDir(config.path),
    item,
    config: value,
  };
}

function toolBuildVersion(item) {
  return item && (item["build-version"] || item.buildVersion || item["qemu-version"] || item.qemuVersion || item["sel4-version"] || item.sel4Version || item["microkit-version"] || item.microkitVersion || null);
}

function toolBuildDirKey(item, fallback = "default") {
  return item && (item["build-dir-key"] || item.buildDirKey || null) || fallback;
}

function managedPath(template, values, rootDir) {
  return path.join(rootDir, renderManagedTemplate(template, values));
}

function descriptorTemplateValues(tool, item, descriptor) {
  const buildVersion = toolBuildVersion(item) || "default";
  const buildDirKey = toolBuildDirKey(item, buildVersion ? `${tool}-${buildVersion}` : "default");
  const toolchainVersion = item && (item["toolchain-version"] || item.toolchainVersion || "12.3.rel1");
  const example = item && item.example ? item.example : "virtio";
  const managed = descriptor.managed && descriptor.managed.local ? descriptor.managed.local : null;
  return {
    buildVersion,
    buildDirKey,
    toolchainVersion,
    example,
    artifactPath: managed && managed.artifactPath ? managed.artifactPath : "",
  };
}

function artifactPathForTool(tool, artifact, rootDir) {
  const { item } = configuredTool(tool);
  const descriptor = readToolDescriptor(tool);
  const managed = descriptor.managed && descriptor.managed.local ? descriptor.managed.local : null;
  if (!managed || !managed.artifacts || !managed.artifacts[artifact]) {
    return null;
  }
  const artifactSpec = managed.artifacts[artifact];
  if (artifactSpec.path) {
    return resolveLocalPath(process.cwd(), artifactSpec.path);
  }
  if (artifactSpec.pathTemplate) {
    return managedPath(artifactSpec.pathTemplate, descriptorTemplateValues(tool, item, descriptor), rootDir);
  }
  return null;
}

function resolveDependencySpec(spec, rootDir) {
  if (!spec) {
    return null;
  }
  if (typeof spec === "string") {
    return resolveLocalPath(process.cwd(), spec);
  }
  if (spec.path) {
    return resolveLocalPath(process.cwd(), spec.path);
  }
  if (spec.tool && spec.artifact) {
    return artifactPathForTool(spec.tool, spec.artifact, rootDir);
  }
  return null;
}

function resolveConfigPath(item, dottedPath) {
  const parts = String(dottedPath || "").split(".").filter(Boolean);
  let current = item;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
      return null;
    }
    current = current[part];
  }
  return current;
}

function resolveToolDependencies(flags, command = null) {
  const tool = flags.tool;
  if (!tool) {
    return flags;
  }
  const rootDir = workspaceRoot(flags);
  if (!rootDir) {
    return flags;
  }
  const { item } = configuredTool(tool);
  if (!item) {
    return flags;
  }
  const next = { ...flags };
  const descriptor = readToolDescriptor(tool);
  const inputs = descriptor.inputs && command && descriptor.inputs[command]
    ? descriptor.inputs[command]
    : null;
  if (!inputs) {
    return next;
  }

  const dependencies = item.dependencies || {};
  for (const [dependencyKey, rule] of Object.entries(inputs.dependencies || {})) {
    const flag = rule && rule.flag ? rule.flag : dependencyKey;
    if (next[flag]) {
      continue;
    }
    next[flag] = resolveDependencySpec(dependencies[dependencyKey], rootDir);
  }

  for (const [configPath, rule] of Object.entries(inputs.config || {})) {
    const flag = rule && rule.flag ? rule.flag : null;
    if (!flag || next[flag]) {
      continue;
    }
    next[flag] = resolveDependencySpec(resolveConfigPath(item, configPath), rootDir);
  }

  return next;
}

module.exports = {
  resolveToolDependencies,
};
