// @ts-nocheck
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { loadConfig, configDir } = require("../core/config");
const { evaluationEntries, resolveEvaluationEntry } = require("../core/evaluation-entries");
const { writeStdoutLine, writeStderrLine } = require("../core/io");
const { handleWorkflowCommand } = require("./workflow");

const WORKFLOW_ACTIONS = ["run", "stop", "resume"];

function printJson(value) {
  writeStdoutLine(JSON.stringify(value, null, 2));
}

function usage() {
  return [
    "Usage:",
    "  morpheus [--config PATH] eval list [--json]",
    "  morpheus [--config PATH] eval <run|stop|resume> --entry <name> [--json] [args...]",
    "",
    "Purpose:",
    "  Run a named evaluation entry from morpheus.yaml. A workflow entry",
    "  dispatches the action to its workflow; a script entry runs its",
    "  wrapper script, forwarding any remaining arguments.",
  ].join("\n");
}

function entryPayloadForList(config) {
  const entries = evaluationEntries(config.value || {});
  const details = Object.entries(entries).map(([name, entry]) => {
    const resolved = resolveEvaluationEntry(config.value || {}, name);
    return {
      name,
      kind: resolved.kind,
      workflow: resolved.kind === "workflow" ? resolved.workflow : null,
      script: resolved.kind === "script" ? resolved.script : null,
    };
  });
  return {
    command: "eval list",
    status: "success",
    exit_code: 0,
    summary: `listed ${details.length} evaluation entries`,
    details: { entries: details },
  };
}

async function entryPayloadForAction(config, action, entryName, jsonMode, passthrough = []) {
  const resolved = resolveEvaluationEntry(config.value || {}, entryName);
  if (resolved.kind === "workflow") {
    const argv = [action, "--name", resolved.workflow, ...(jsonMode ? ["--json"] : [])];
    const code = await handleWorkflowCommand(argv);
    return {
      command: `eval ${action}`,
      status: code ? "error" : "success",
      exit_code: code,
      summary: `${action}ed evaluation entry ${entryName} (workflow ${resolved.workflow})`,
      details: { entry: entryName, kind: resolved.kind, workflow: resolved.workflow, exit_code: code },
    };
  }
  const scriptPath = path.resolve(configDir(config.path), resolved.script);
  const code = spawnSync("bash", [scriptPath, ...passthrough], { stdio: "inherit" }).status || 0;
  return {
    command: `eval ${action}`,
    status: code ? "error" : "success",
    exit_code: code,
    summary: `ran evaluation entry ${entryName} (script ${resolved.script})`,
    details: { entry: entryName, kind: resolved.kind, script: resolved.script, exit_code: code },
  };
}

async function handleEvalCommand(argv) {
  const positionals = [];
  const flags = {};
  const passthrough = [];
  const knownFlags = new Set(["json", "help", "entry"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      passthrough.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (knownFlags.has(key)) {
      const next = argv[index + 1];
      if (key !== "json" && key !== "help" && next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    passthrough.push(token);
  }
  const jsonMode = Boolean(flags.json);
  const subcommand = positionals[0];
  if (!subcommand || subcommand === "help" || flags.help) {
    writeStdoutLine(usage());
    return 0;
  }
  const config = loadConfig(process.cwd(), { explicitPath: process.env.MORPHEUS_CONFIG || null });
  const fail = (message) => {
    if (jsonMode) {
      printJson({ command: `eval ${subcommand}`, status: "error", exit_code: 1, summary: message });
    } else {
      writeStderrLine(message);
    }
    return 1;
  };
  if (subcommand === "list") {
    const payload = entryPayloadForList(config);
    if (jsonMode) {
      printJson(payload);
    } else {
      for (const entry of payload.details.entries) {
        const target = entry.kind === "workflow" ? entry.workflow : entry.script;
        writeStdoutLine(`${entry.name}\t${entry.kind}\t${target}`);
      }
    }
    return 0;
  }
  if (!WORKFLOW_ACTIONS.includes(subcommand)) {
    return fail(`unknown eval action: ${subcommand}; expected run|stop|resume|list`);
  }
  const entryName = typeof flags.entry === "string" ? String(flags.entry) : null;
  if (!entryName) {
    return fail(`eval ${subcommand} requires --entry NAME`);
  }
  if (!evaluationEntries(config.value || {})[entryName]) {
    return fail(`unknown evaluation entry: ${entryName}; run 'morpheus eval list' to inspect available entries`);
  }
  const resolved = resolveEvaluationEntry(config.value || {}, entryName);
  if (resolved.kind === "script" && subcommand !== "run") {
    return fail(`evaluation entry ${entryName} is a wrapper script; only run is supported (got ${subcommand})`);
  }
  const payload = await entryPayloadForAction(config, subcommand, entryName, jsonMode, passthrough);
  if (jsonMode) {
    printJson(payload);
  }
  return payload.exit_code;
}

module.exports = { handleEvalCommand };
