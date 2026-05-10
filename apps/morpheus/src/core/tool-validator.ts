// @ts-nocheck
export {};

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const { repoRoot } = require("./paths");
const { TOOL_DESCRIPTOR_SCHEMA } = require("./tool-schema");
const { readToolDescriptor } = require("./tool-descriptor");

function toolDescriptorPath(toolName) {
  return path.join(repoRoot(), "tools", toolName, "tool.json");
}

function okCheck(id, description, details = {}) {
  return { id, description, status: "pass", details };
}

function failCheck(id, description, message, details = {}) {
  return { id, description, status: "fail", message, details };
}

function warnCheck(id, description, message, details = {}) {
  return { id, description, status: "warn", message, details };
}

function parseCliContract(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isWorkspaceManagedPathForTool(toolName, value) {
  const text = String(value || "");
  return (
    text.startsWith(`tools/${toolName}/`)
    || text.startsWith("runs/")
    || text.startsWith("tmp/")
  );
}

function collectWorkspacePathChecks(toolName, descriptor) {
  const checks = [];
  const managed = descriptor && descriptor.managed && descriptor.managed.local
    ? descriptor.managed.local
    : null;
  if (!managed) {
    return checks;
  }
  const hasSource = Boolean(managed.sourceTemplate);
  const hasBuild = Boolean(managed.buildDirTemplate || managed.installDirTemplate || managed.outputDirTemplate);
  const hasDownloads = Boolean(managed.downloadsDir);
  const hasRuns = Boolean(managed.execDirTemplate);
  checks.push(
    hasSource
      ? okCheck("workspace.src", "tool declares a source workspace layout", { value: managed.sourceTemplate })
      : failCheck("workspace.src", "tool declares a source workspace layout", "missing sourceTemplate")
  );
  checks.push(
    hasBuild
      ? okCheck("workspace.builds", "tool declares a build workspace layout", {
          buildDirTemplate: managed.buildDirTemplate || null,
          installDirTemplate: managed.installDirTemplate || null,
          outputDirTemplate: managed.outputDirTemplate || null,
        })
      : failCheck("workspace.builds", "tool declares a build workspace layout", "missing build/install/output directory template")
  );
  checks.push(
    hasDownloads
      ? okCheck("workspace.downloads", "tool declares a downloads cache layout", { value: managed.downloadsDir })
      : warnCheck("workspace.downloads", "tool declares a downloads cache layout", "no downloadsDir declared")
  );
  checks.push(
    hasRuns
      ? okCheck("workspace.runs", "tool declares a runs layout", { value: managed.execDirTemplate })
      : warnCheck("workspace.runs", "tool declares a runs layout", "no execDirTemplate declared")
  );
  const templateFields = [
    ["sourceTemplate", managed.sourceTemplate],
    ["downloadsDir", managed.downloadsDir],
    ["outputDirTemplate", managed.outputDirTemplate],
    ["buildDirTemplate", managed.buildDirTemplate],
    ["installDirTemplate", managed.installDirTemplate],
    ["execDirTemplate", managed.execDirTemplate],
  ];
  for (const [field, value] of templateFields) {
    if (!value) {
      continue;
    }
    checks.push(
      isWorkspaceManagedPathForTool(toolName, value)
        ? okCheck(`workspace.${field}`, `${field} stays within managed workspace layout`, { value })
        : failCheck(`workspace.${field}`, `${field} stays within managed workspace layout`, "path must stay under tools/, runs/, or tmp/", { value })
    );
  }
  for (const [artifactPath, spec] of Object.entries(managed.artifacts || {})) {
    if (!spec || typeof spec !== "object") {
      continue;
    }
    if (spec.pathTemplate) {
      checks.push(
        isWorkspaceManagedPathForTool(toolName, spec.pathTemplate)
          ? okCheck(`workspace.artifact.${artifactPath}`, `artifact ${artifactPath} stays within managed workspace layout`, { value: spec.pathTemplate })
          : failCheck(`workspace.artifact.${artifactPath}`, `artifact ${artifactPath} stays within managed workspace layout`, "artifact pathTemplate must stay under tools/, runs/, or tmp/", { value: spec.pathTemplate })
      );
    }
  }
  return checks;
}

function collectCommandChecks(toolName, descriptor) {
  const checks = [];
  const contractCommands = parseCliContract(descriptor["cli-contract"]);
  const managed = descriptor && descriptor.managed && descriptor.managed.local
    ? descriptor.managed.local
    : null;
  if (!managed || !managed.commands) {
    checks.push(failCheck("commands.present", "cli-contract commands are implemented for Morpheus", "managed.local.commands is missing"));
    return checks;
  }

  const implemented = new Set(Object.keys(managed.commands || {}));
  for (const command of contractCommands) {
    if (!implemented.has(command)) {
      checks.push(failCheck(`commands.${command}`, `command ${command} is implemented`, "missing managed.local.commands entry"));
      continue;
    }
    const spec = managed.commands[command];
    if (!spec || typeof spec !== "object") {
      checks.push(failCheck(`commands.${command}`, `command ${command} is implemented`, "command spec is not an object"));
      continue;
    }
    if (!spec.script || !spec.script.path || !spec.script.shell) {
      checks.push(failCheck(`commands.${command}.script`, `command ${command} declares an executable script`, "script.path and script.shell are required"));
    } else {
      const scriptPath = path.join(repoRoot(), "tools", toolName, spec.script.path);
      checks.push(
        fs.existsSync(scriptPath)
          ? okCheck(`commands.${command}.script`, `command ${command} declares an executable script`, { script: path.relative(repoRoot(), scriptPath) })
          : failCheck(`commands.${command}.script`, `command ${command} declares an executable script`, "script file does not exist", { script: path.relative(repoRoot(), scriptPath) })
      );
    }
  }

  for (const [command, spec] of Object.entries(managed.commands || {})) {
    const artifact = spec && spec.result ? spec.result.artifact : null;
    if (artifact && artifact.path && managed.artifacts && !managed.artifacts[artifact.path]) {
      checks.push(failCheck(`commands.${command}.artifact`, `command ${command} publishes a declared artifact`, `artifact path '${artifact.path}' is not declared in managed.local.artifacts`));
    } else if (artifact && artifact.path) {
      checks.push(okCheck(`commands.${command}.artifact`, `command ${command} publishes a declared artifact`, { artifact: artifact.path }));
    }
  }
  return checks;
}

function validateToolDescriptor(toolName) {
  const filePath = toolDescriptorPath(toolName);
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      tool: toolName,
      descriptorPath: `tools/${toolName}/tool.json`,
      issues: [{ path: "tool", message: `missing tool descriptor: tools/${toolName}/tool.json` }],
      checks: [failCheck("descriptor.exists", "tool descriptor exists", `missing tool descriptor: tools/${toolName}/tool.json`)],
    };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(TOOL_DESCRIPTOR_SCHEMA);
  const ok = validate(raw);
  const schemaIssues = ok
    ? []
    : (validate.errors || []).map((error) => ({
        path: error.instancePath || "/",
        message: error.message || "schema validation failed",
      }));
  const descriptor = readToolDescriptor(toolName);
  const checks = [
    ok
      ? okCheck("schema", "tool.json matches the Morpheus tool descriptor schema")
      : failCheck("schema", "tool.json matches the Morpheus tool descriptor schema", "schema validation failed", { issues: schemaIssues }),
    raw.name === toolName
      ? okCheck("name", "descriptor name matches the tool directory", { value: raw.name })
      : failCheck("name", "descriptor name matches the tool directory", `expected '${toolName}', got '${raw.name}'`, { value: raw.name }),
    parseCliContract(raw["cli-contract"]).length > 0
      ? okCheck("contract", "cli-contract declares at least one command", { commands: parseCliContract(raw["cli-contract"]) })
      : failCheck("contract", "cli-contract declares at least one command", "cli-contract is empty"),
    ...(collectWorkspacePathChecks(toolName, descriptor)),
    ...(collectCommandChecks(toolName, descriptor)),
  ];
  const issues = [
    ...schemaIssues,
    ...checks
      .filter((check) => check.status === "fail")
      .map((check) => ({
        path: check.id,
        message: check.message || check.description,
      })),
  ];
  return {
    ok: issues.length === 0,
    tool: toolName,
    descriptorPath: path.relative(repoRoot(), filePath),
    issues,
    checks,
  };
}

module.exports = {
  validateToolDescriptor,
};
