// @ts-nocheck
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { applyConfigDefaults, loadConfig } = require("../core/config");
const { parseToolArgs } = require("../core/tool-invoke");
const { readToolDescriptor } = require("../core/tool-descriptor");
const { repoRoot } = require("../core/paths");
const { writeStdoutLine } = require("../core/io");
const { emitEvent, logDebug, logInfo, withEventContext, withLogFile } = require("../core/logger");
const {
  parseSshTarget,
  syncRemotePathToLocal,
} = require("../transport/remote");
const {
  createWorkflowRun,
  createWorkflowStep,
  updateWorkflowRun,
  updateWorkflowStep,
  workflowManifestPath,
  workflowEventLogPath,
  workflowRunsRoot,
  stepToolRunDir,
} = require("../core/workflow-runs");

function parseWorkflowArgs(argv) {
  const positionals = [];
  const flags = {};
  const booleanFlags = new Set(["json", "follow"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!booleanFlags.has(key) && next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

function workflowUsage() {
  return [
    "Usage:",
    "  node apps/morpheus/dist/cli.js workflow run --name WORKFLOW_NAME [--json]",
    "  node apps/morpheus/dist/cli.js workflow resume --id WORKFLOW_RUN_ID [--from-step STEP_ID] [--json]",
    "  node apps/morpheus/dist/cli.js workflow inspect --id WORKFLOW_RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js workflow logs --id WORKFLOW_RUN_ID [--step STEP_ID] [--follow] [--json]",
    "  node apps/morpheus/dist/cli.js workflow stop --id WORKFLOW_RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js workflow remove --id WORKFLOW_RUN_ID [--json]"
  ].join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonIfExists(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  return readJson(filePath);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function stepToolResultPath(stepDir) {
  return path.join(stepDir, "tool-result.json");
}

function cliEntrypoint() {
  return path.join(repoRoot(), "apps", "morpheus", "dist", "cli.js");
}

function resolveWorkspaceRoot(flags) {
  const { flags: resolved } = applyConfigDefaults(
    {
      tool: "workflow",
      workspace: flags.workspace || null,
    },
    { allowGlobalRemote: false, allowToolDefaults: false }
  );
  if (!resolved.workspace) {
    throw new Error("workflow requires --workspace DIR or workspace.root in morpheus.yaml");
  }
  return resolved.workspace;
}

function getByPath(value, dottedPath) {
  const parts = String(dottedPath || "").split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      if (
        (part === "location" || part === "local_location" || part === "remote_location")
        && (
          Object.prototype.hasOwnProperty.call(current, "local_location")
          || Object.prototype.hasOwnProperty.call(current, "location")
          || Object.prototype.hasOwnProperty.call(current, "remote_location")
        )
      ) {
        current = current.local_location || current.location || current.remote_location;
        continue;
      }
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function templateStepPayloadFromRecord(stepRecord) {
  if (!stepRecord || typeof stepRecord !== "object") {
    return null;
  }
  if (stepRecord.toolResult && typeof stepRecord.toolResult === "object") {
    const artifacts = Array.isArray(stepRecord.artifacts) ? stepRecord.artifacts : [];
    return stepTemplatePayload({
      ...stepRecord.toolResult,
      details: {
        ...(stepRecord.toolResult.details || {}),
        artifacts: Array.isArray(stepRecord.toolResult?.details?.artifacts)
          ? stepRecord.toolResult.details.artifacts
          : artifacts,
      },
    });
  }
  if (Array.isArray(stepRecord.artifacts)) {
    return {
      artifacts: stepArtifactViewMap({
        details: {
          artifacts: stepRecord.artifacts,
        },
      }),
    };
  }
  return null;
}

function resolveTemplateStepValue(context, stepId, stepPath) {
  const direct = getByPath(context.stepResults[stepId], stepPath);
  if (direct != null) {
    return direct;
  }
  if (!context.runDir) {
    return undefined;
  }
  const stepManifestPath = path.join(context.runDir, "steps", stepId, "step.json");
  if (!fs.existsSync(stepManifestPath)) {
    return undefined;
  }
  const stepRecord = readJson(stepManifestPath);
  const payload = templateStepPayloadFromRecord(stepRecord);
  if (!payload) {
    return undefined;
  }
  return getByPath(payload, stepPath);
}

function resolveConfiguredWorkflow(name, explicitConfigPath = null) {
  const config = loadConfig(process.cwd(), { explicitPath: explicitConfigPath });
  const workflows = config && config.value && config.value.workflows ? config.value.workflows : {};
  const workflow = workflows && workflows[name] ? workflows[name] : null;
  if (!workflow) {
    throw new Error(`unknown configured workflow: ${name}`);
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    throw new Error(`configured workflow has no steps: ${name}`);
  }
  return {
    name,
    category: workflow.category || "run",
    steps: workflow.steps,
    configPath: config.path || null,
  };
}

function resolveWorkflowStringTemplate(value, context) {
  return String(value).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
    const expr = String(expression || "").trim();
    if (expr === "workspace.root") {
      return String(context.workspaceRoot);
    }
    if (!expr.startsWith("steps.")) {
      throw new Error(`unsupported workflow template: ${expr}`);
    }
    const pathExpr = expr.slice("steps.".length);
    const dot = pathExpr.indexOf(".");
    if (dot <= 0) {
      throw new Error(`invalid workflow step template: ${expr}`);
    }
    const stepId = pathExpr.slice(0, dot);
    const stepPath = pathExpr.slice(dot + 1);
    const resolved = resolveTemplateStepValue(context, stepId, stepPath);
    if (resolved == null) {
      throw new Error(`workflow template resolved empty value: ${expr}`);
    }
    return String(resolved);
  });
}

function relationRecordFromTemplateExpr(context, currentStepId, expr) {
  if (!currentStepId || !expr.startsWith("steps.")) {
    return null;
  }
  const pathExpr = expr.slice("steps.".length);
  const dot = pathExpr.indexOf(".");
  if (dot <= 0) {
    return null;
  }
  const stepId = pathExpr.slice(0, dot);
  const stepPath = pathExpr.slice(dot + 1);
  const parts = stepPath.split(".");
  if (parts[0] !== "artifacts" || parts.length < 3) {
    return null;
  }
  const artifactAlias = parts[1];
  const property = parts[2];
  const artifact = getByPath(context.stepResults[stepId], `artifacts.${artifactAlias}`);
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  const artifactPath = typeof artifact.path === "string" ? artifact.path : artifactAlias;
  const artifactLocation =
    property === "location"
      ? (artifact.local_location || artifact.location || artifact.remote_location || null)
      : getByPath(artifact, property);
  return {
    kind: "artifact",
    from: stepId,
    to: currentStepId,
    artifactPath: artifactPath || null,
    artifactLocation: artifactLocation == null ? null : String(artifactLocation),
    consumedAs: stepPath,
  };
}

function resolveWorkflowStringTemplateWithTrace(value, context, currentStepId) {
  const relations = [];
  const resolved = String(value).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
    const expr = String(expression || "").trim();
    const relation = relationRecordFromTemplateExpr(context, currentStepId, expr);
    if (relation) {
      relations.push(relation);
    }
    if (expr === "workspace.root") {
      return String(context.workspaceRoot);
    }
    if (!expr.startsWith("steps.")) {
      throw new Error(`unsupported workflow template: ${expr}`);
    }
    const pathExpr = expr.slice("steps.".length);
    const dot = pathExpr.indexOf(".");
    if (dot <= 0) {
      throw new Error(`invalid workflow step template: ${expr}`);
    }
    const stepId = pathExpr.slice(0, dot);
    const stepPath = pathExpr.slice(dot + 1);
    const valueResolved = resolveTemplateStepValue(context, stepId, stepPath);
    if (valueResolved == null) {
      throw new Error(`workflow template resolved empty value: ${expr}`);
    }
    return String(valueResolved);
  });
  return { value: resolved, relations };
}

function resolveConfiguredStepArgs(step, context) {
  const items = Array.isArray(step.args)
    ? step.args
    : (Array.isArray(step.toolArgv) ? step.toolArgv : []);
  const relations = [];
  const currentStepId = step && step.id ? String(step.id) : null;
  const args = items.map((item) => {
    if (typeof item !== "string") {
      return String(item);
    }
    const resolved = resolveWorkflowStringTemplateWithTrace(item, context, currentStepId);
    relations.push(...resolved.relations);
    return resolved.value;
  });
  return { args, relations };
}

function listWorkflowSteps(runDir) {
  const stepsDir = path.join(runDir, "steps");
  if (!fs.existsSync(stepsDir)) {
    return [];
  }
  return fs
    .readdirSync(stepsDir)
    .map((name) => path.join(stepsDir, name))
    .filter((entry) => fs.statSync(entry).isDirectory())
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    .map((stepDir) => {
      const manifestPath = path.join(stepDir, "step.json");
      return fs.existsSync(manifestPath) ? readJson(manifestPath) : { id: path.basename(stepDir), stepDir };
    });
}

function findWorkflowRun(workspaceRoot, id) {
  const runDir = path.join(workflowRunsRoot(workspaceRoot), id);
  const manifestPath = workflowManifestPath(runDir);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`workflow run not found: ${id}`);
  }
  return { runDir, manifestPath };
}

function listRunDirsForWorkflow(workspaceRoot, workflowName) {
  const root = workflowRunsRoot(workspaceRoot);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((entry) => fs.existsSync(path.join(entry, "workflow.json")))
    .map((entry) => readJson(path.join(entry, "workflow.json")))
    .filter((record) => String(record.workflow || "") === String(workflowName || ""))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function stopPid(pid) {
  if (!pid || pid <= 0) {
    return;
  }
  spawnSync("pkill", ["-TERM", "-P", String(pid)], { stdio: "ignore" });
  spawnSync("kill", ["-TERM", String(pid)], { stdio: "ignore" });
  const waited = spawnSync(
    "bash",
    ["-lc", `for i in $(seq 1 30); do if ! kill -0 ${pid} 2>/dev/null; then exit 0; fi; sleep 0.1; done; exit 1`],
    { stdio: "ignore" },
  );
  if (waited.status === 0) {
    return;
  }
  spawnSync("pkill", ["-KILL", "-P", String(pid)], { stdio: "ignore" });
  spawnSync("kill", ["-KILL", String(pid)], { stdio: "ignore" });
}

function toolSupportsCommand(descriptor, command) {
  const contract = String(descriptor && descriptor["cli-contract"] || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return contract.includes(command);
}

function stepToolManifest(step) {
  if (!step || !step.stepDir) {
    return null;
  }
  const manifestPath = path.join(stepToolRunDir(step.stepDir), "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return readJson(manifestPath);
  } catch {
    return null;
  }
}

function shouldStopWorkflowStepTool(step) {
  if (!step || !step.tool || !step.stepDir) {
    return false;
  }
  if (step.status === "created" || step.status === "running") {
    return true;
  }
  const manifest = stepToolManifest(step);
  const status = String(manifest && manifest.status || "").trim().toLowerCase();
  return status === "created" || status === "prepared" || status === "starting" || status === "running";
}

function stopWorkflowStepTool(step) {
  if (!step || !step.tool || !step.stepDir) {
    return null;
  }
  if (!stepToolManifest(step)) {
    return null;
  }

  const descriptor = readToolDescriptor(step.tool);
  if (!toolSupportsCommand(descriptor, "stop")) {
    return null;
  }

  const entryPath = path.join(repoRoot(), descriptor.installRoot, descriptor.entry);
  const args = descriptor.runtime === "node"
    ? [entryPath, "stop", "--json"]
    : ["stop", "--json"];
  const command = descriptor.runtime === "node"
    ? process.execPath
    : entryPath;
  const result = spawnSync(command, args, {
    cwd: step.stepDir,
    encoding: "utf8",
    env: process.env,
  });
  return result;
}

function stopWorkflowRun(workspaceRoot, id) {
  const found = findWorkflowRun(workspaceRoot, id);
  const workflow = readJson(found.manifestPath);
  const steps = listWorkflowSteps(found.runDir);
  const currentChildPid = Number(workflow.currentChildPid || 0);
  const runnerPid = Number(workflow.runnerPid || 0);

  for (const step of steps) {
    if (!shouldStopWorkflowStepTool(step)) {
      continue;
    }
    try {
      stopWorkflowStepTool(step);
    } catch {}
  }

  if (currentChildPid > 0) {
    stopPid(currentChildPid);
  }
  if (runnerPid > 0 && runnerPid !== process.pid) {
    stopPid(runnerPid);
  }

  for (const step of steps) {
    if (step && (step.status === "created" || step.status === "running")) {
      updateWorkflowStep(step.stepDir, (current) => ({
        ...current,
        status: "stopped",
        exitCode: current.exitCode == null ? 130 : current.exitCode,
      }));
    }
  }

  const updatedWorkflow = updateWorkflowRun(found.runDir, (current) => ({
    ...current,
    status: "stopped",
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: Array.isArray(current.steps)
      ? current.steps.map((entry) => (
          entry.status === "created" || entry.status === "running"
            ? { ...entry, status: "stopped" }
            : entry
        ))
      : [],
  }));

  return {
    command: "workflow stop",
    status: "success",
    exit_code: 0,
    summary: "stopped workflow run",
    details: {
      id: updatedWorkflow.id,
      workflow: updatedWorkflow.workflow,
      run_dir: updatedWorkflow.runDir,
      stopped_child_pid: currentChildPid > 0 ? currentChildPid : null,
      stopped_runner_pid: runnerPid > 0 ? runnerPid : null,
    },
  };
}

function removeWorkflowRun(workspaceRoot, id) {
  const found = findWorkflowRun(workspaceRoot, id);
  const workflow = readJson(found.manifestPath);
  const steps = listWorkflowSteps(found.runDir);
  if (workflow.status !== "stopped") {
    throw new Error("workflow remove requires a prior successful workflow stop");
  }
  if (Number(workflow.currentChildPid || 0) > 0 || Number(workflow.runnerPid || 0) > 0) {
    throw new Error("workflow remove requires the workflow to be fully stopped");
  }
  if (steps.some((step) => step && (step.status === "running" || step.status === "created"))) {
    throw new Error("workflow remove requires all workflow steps to be stopped");
  }
  fs.rmSync(found.runDir, { recursive: true, force: true });
  return {
    command: "workflow remove",
    status: "success",
    exit_code: 0,
    summary: "removed workflow run",
    details: {
      id,
      run_dir: found.runDir,
    },
  };
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = stableValue(value[key]);
  }
  return sorted;
}

function stepFingerprint(step, toolCommand, toolArgv, execution) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(stableValue({
    step: step.id,
    tool: step.tool,
    command: toolCommand,
    args: toolArgv,
    resolved: execution && execution.resolved ? execution.resolved : null,
  })));
  return hash.digest("hex");
}

function artifactLocation(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  return artifact.local_location || artifact.location || artifact.remote_location || null;
}

function artifactsExist(stepRecord) {
  const artifacts = Array.isArray(stepRecord && stepRecord.artifacts)
    ? stepRecord.artifacts
    : [];
  for (const artifact of artifacts) {
    const location = artifactLocation(artifact);
    if (!location || !fs.existsSync(location)) {
      return false;
    }
  }
  return true;
}

function workflowResumeStateFromStatus(status) {
  return status === "success" ? "reused" : "rerun";
}

function consumeToolOutput(stdout, stepLogFile) {
  const text = String(stdout || "");
  if (!text.trim()) {
    return null;
  }

  let finalPayload = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      fs.appendFileSync(stepLogFile, `${rawLine}\n`, "utf8");
      continue;
    }

    if (
      parsed &&
      parsed.status === "stream" &&
      parsed.details &&
      parsed.details.event === "log"
    ) {
      if (typeof parsed.details.chunk === "string") {
        fs.appendFileSync(stepLogFile, parsed.details.chunk, "utf8");
        continue;
      }
      if (typeof parsed.details.line === "string") {
        fs.appendFileSync(stepLogFile, `${parsed.details.line}\n`, "utf8");
        continue;
      }
      continue;
    }

    finalPayload = parsed;
  }

  return finalPayload;
}

function writeStepLogLine(stepLogFile, line) {
  const text = String(line || "");
  fs.appendFileSync(stepLogFile, `${text}\n`, "utf8");
  process.stderr.write(`${text}\n`);
}

function emitConsoleEvent(channel, text, eventContext) {
  if (!text) {
    return;
  }
  emitEvent(channel, {
    text,
  }, {
    scope: "step",
    workflowId: eventContext.workflowId || null,
    stepId: eventContext.stepId || null,
    tool: eventContext.tool || null,
  });
}

function processToolStdoutLine(rawLine, stepLogFile, state, eventContext) {
  const line = String(rawLine || "").trim();
  if (!line) {
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    writeStepLogLine(stepLogFile, rawLine);
    emitConsoleEvent("console.stdout", `${rawLine}\n`, eventContext);
    return;
  }

  if (
    parsed &&
    parsed.status === "stream" &&
    parsed.details &&
    parsed.details.event === "log"
  ) {
    if (typeof parsed.details.chunk === "string") {
      fs.appendFileSync(stepLogFile, parsed.details.chunk, "utf8");
      process.stderr.write(parsed.details.chunk);
      emitConsoleEvent("console.stdout", parsed.details.chunk, eventContext);
      return;
    }
    if (typeof parsed.details.line === "string") {
      writeStepLogLine(stepLogFile, parsed.details.line);
      emitConsoleEvent("console.stdout", `${parsed.details.line}\n`, eventContext);
      return;
    }
  }

  if (
    parsed &&
    parsed.status === "stream" &&
    parsed.details &&
    typeof parsed.details.event === "string"
  ) {
    const { event, ...details } = parsed.details;
    emitEvent(event, details, {
      producer: "tool",
      scope: "step",
      workflowId: eventContext.workflowId || null,
      stepId: eventContext.stepId || null,
      tool: eventContext.tool || null,
    });
    return;
  }

  if (parsed && typeof parsed === "object") {
    state.finalPayload = parsed;
  }
}

function parseTrailingJsonObject(output) {
  const text = String(output || "").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    // mixed stdout is expected for streamed tools
  }
  let end = text.lastIndexOf("}");
  while (end >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = end; index >= 0; index -= 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "}") {
        depth += 1;
        continue;
      }
      if (char === "{") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(index, end + 1).trim();
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
    end = text.lastIndexOf("}", end - 1);
  }
  return null;
}

function emitRuntimeEventsFromPayload(workflow, step, toolPayload) {
  const manifest = toolPayload && toolPayload.details && toolPayload.details.manifest;
  if (!manifest || typeof manifest !== "object") {
    return;
  }
  const status = typeof manifest.status === "string" ? manifest.status : "";
  if (status) {
    emitEvent(`runtime.${status}`, {
      manifest,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
    });
  }
}

function emitArtifactEvents(workflow, step, artifacts, relations) {
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string") {
      continue;
    }
    emitEvent("artifact.produced", {
      path: artifact.path,
      location: artifact.local_location || artifact.location || artifact.remote_location || null,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
    });
  }
  for (const relation of Array.isArray(relations) ? relations : []) {
    emitEvent("artifact.consumed", {
      from_step: relation.from || null,
      artifact_path: relation.artifactPath || null,
      artifact_location: relation.artifactLocation || null,
      consumed_as: relation.consumedAs || null,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
    });
  }
}

function runWorkflowChild(args, stepLogFile, env, onSpawn, options = {}) {
  return new Promise((resolve, reject) => {
    const attach = Boolean(options.attach);
    const eventContext = options.eventContext || {};
    const childCwd = options.cwd || process.cwd();
    // `attach` is narrowly scoped to terminal attachment for interactive tools.
    // Non-attached steps remain the default managed workflow execution path.
    const child = attach
      ? spawn(process.execPath, args, {
          cwd: childCwd,
          env,
          stdio: "inherit",
        })
      : spawn(process.execPath, args, {
          cwd: childCwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
    if (typeof onSpawn === "function") {
      onSpawn(child.pid);
    }
    emitEvent("step.process.spawned", {
      argv: args.slice(1),
      pid: child.pid || null,
      attach,
    }, {
      scope: "step",
      workflowId: eventContext.workflowId || null,
      stepId: eventContext.stepId || null,
      tool: eventContext.tool || null,
    });

    if (attach) {
      child.on("error", reject);
      child.on("close", (code) => {
        emitEvent("step.process.exited", {
          pid: child.pid || null,
          exit_code: typeof code === "number" ? code : 1,
        }, {
          scope: "step",
          workflowId: eventContext.workflowId || null,
          stepId: eventContext.stepId || null,
          tool: eventContext.tool || null,
        });
        resolve({
          status: typeof code === "number" ? code : 1,
          stderr: "",
          toolPayload: null,
        });
      });
      return;
    }

    let stdoutBuffer = "";
    let stdoutText = "";
    let stderrText = "";
    const state = { finalPayload: null };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutText += chunk;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const rawLine of lines) {
        processToolStdoutLine(rawLine, stepLogFile, state, eventContext);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrText += chunk;
      fs.appendFileSync(stepLogFile, chunk, "utf8");
      emitConsoleEvent("console.stderr", String(chunk), eventContext);
      process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        processToolStdoutLine(stdoutBuffer, stepLogFile, state, eventContext);
      }
      if ((typeof state.finalPayload !== "object" || state.finalPayload == null) && stdoutText.trim()) {
        const parsed = parseTrailingJsonObject(stdoutText);
        if (parsed && typeof parsed === "object") {
          state.finalPayload = parsed;
        }
      }
      emitEvent("step.process.exited", {
        pid: child.pid || null,
        exit_code: typeof code === "number" ? code : 1,
      }, {
        scope: "step",
        workflowId: eventContext.workflowId || null,
        stepId: eventContext.stepId || null,
        tool: eventContext.tool || null,
      });
      resolve({
        status: typeof code === "number" ? code : 1,
        stderr: stderrText,
        toolPayload: state.finalPayload,
      });
    });
  });
}

function tailFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return null;
    }
    const limit = typeof maxBytes === "number" ? maxBytes : 8192;
    const start = Math.max(0, stat.size - limit);
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString("utf8").trimEnd();
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function stepArtifactsFromToolPayload(toolPayload) {
  if (!toolPayload || !toolPayload.details || !Array.isArray(toolPayload.details.artifacts)) {
    return [];
  }
  return toolPayload.details.artifacts;
}

function stepArtifactViewMap(toolPayload) {
  const artifacts = stepArtifactsFromToolPayload(toolPayload);
  const views = {};
  const aliases = new Set();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string") {
      continue;
    }
    const artifactPath = artifact.path;
    const basename = path.basename(artifactPath);
    const sanitizedBasename = basename.replace(/[^A-Za-z0-9_-]+/g, "-");
    const sanitizedPath = artifactPath.replace(/[^A-Za-z0-9_-]+/g, "-");
    aliases.clear();
    aliases.add(artifactPath);
    aliases.add(basename);
    aliases.add(sanitizedBasename);
    aliases.add(sanitizedPath);
    for (const alias of aliases) {
      if (!alias || Object.prototype.hasOwnProperty.call(views, alias)) {
        continue;
      }
      views[alias] = artifact;
    }
  }
  return views;
}

function stepTemplatePayload(toolPayload) {
  if (!toolPayload || typeof toolPayload !== "object") {
    return toolPayload || null;
  }
  return {
    ...toolPayload,
    artifacts: stepArtifactViewMap(toolPayload),
  };
}

function resolveStepExecution(workspaceRoot, toolArgv, tool, explicitConfigPath = null) {
  const parsed = parseToolArgs(toolArgv || []);
  const descriptor = readToolDescriptor(tool);
  const supportedModes = descriptor && descriptor.managed && Array.isArray(descriptor.managed.modes)
    ? descriptor.managed.modes
    : null;
  const localOnly = Array.isArray(supportedModes) && supportedModes.length > 0 && !supportedModes.includes("remote");
  const { flags: resolved } = applyConfigDefaults(
    {
      ...parsed.flags,
      mode: parsed.flags.mode || (localOnly ? "local" : null),
      tool,
      workspace: workspaceRoot || null,
      json: true,
    },
    {
      allowGlobalRemote: true,
      allowToolDefaults: true,
      explicitConfigPath,
    }
  );
  const remoteEnabled = Boolean(
    resolved.ssh
    && resolved.workspace
    && resolved.localWorkspace
    && resolved.workspace !== resolved.localWorkspace
  );
  return { resolved, remoteEnabled };
}

function materializeRemoteArtifacts(step, toolPayload, execution) {
  if (!execution || !execution.remoteEnabled || !toolPayload || !toolPayload.details || !Array.isArray(toolPayload.details.artifacts)) {
    return toolPayload;
  }
  const ssh = parseSshTarget(execution.resolved.ssh);
  const localizedArtifacts = toolPayload.details.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string" || typeof artifact.location !== "string") {
      return artifact;
    }
    const localLocation = path.join(step.artifactsDir, artifact.path);
    syncRemotePathToLocal(artifact.location, localLocation, ssh, `${step.tool} artifact ${artifact.path}`);
    return {
      ...artifact,
      remote_location: artifact.location,
      local_location: localLocation,
    };
  });
  return {
    ...toolPayload,
    details: {
      ...toolPayload.details,
      artifacts: localizedArtifacts,
    },
  };
}

function attachedWorkflowStepPayload(step, toolCommand, result) {
  const managedManifestPath = path.join(stepToolRunDir(step.stepDir), "manifest.json");
  const managedManifest = readJsonIfExists(managedManifestPath, null);
  const providerManifestPath = managedManifest
    && managedManifest.runtime
    && managedManifest.runtime.providerRun
    && typeof managedManifest.runtime.providerRun.manifest === "string"
      ? managedManifest.runtime.providerRun.manifest
      : null;
  const providerManifest = readJsonIfExists(providerManifestPath, null);

  if (!managedManifest) {
    const fallbackStatus = result.status === 0 ? "success" : "stopped";
    return {
      command: `tool ${toolCommand}`,
      status: fallbackStatus,
      exit_code: result.status == null ? 1 : result.status,
      summary: fallbackStatus === "success"
        ? "completed attached workflow step"
        : "attached workflow step exited before managed run metadata was written",
      details: {
        tool: step.tool,
        attach: true,
      },
    };
  }

  const managedStatus = String(providerManifest?.status || managedManifest.status || "").trim().toLowerCase();
  const payloadStatus = managedStatus === "starting" || managedStatus === "prepared"
    ? "running"
    : (managedStatus || (result.status === 0 ? "success" : "error"));
  const payloadExitCode = typeof providerManifest?.exitCode === "number"
    ? providerManifest.exitCode
    : typeof managedManifest.exitCode === "number"
      ? managedManifest.exitCode
      : (result.status == null ? 0 : result.status);
  const logFile = providerManifest?.logFile
    || managedManifest?.runtime?.providerRun?.log_file
    || managedManifest?.logFile
    || step.logFile;
  const summary = payloadStatus === "running"
    ? `started attached ${step.tool} run`
    : payloadStatus === "success"
      ? `completed attached ${step.tool} run`
      : payloadStatus === "stopped"
        ? `stopped attached ${step.tool} run`
        : (managedManifest.errorMessage || providerManifest?.errorMessage || String(result.stderr || "").trim() || "workflow step failed");

  return {
    command: `tool ${toolCommand}`,
    status: payloadStatus,
    exit_code: payloadExitCode,
    summary,
    details: {
      id: managedManifest.id || null,
      tool: step.tool,
      attach: true,
      run_dir: managedManifest.runDir || stepToolRunDir(step.stepDir),
      manifest: managedManifestPath,
      log_file: logFile,
      managed_status: managedManifest.status || null,
      provider_run: managedManifest.runtime && managedManifest.runtime.providerRun
        ? managedManifest.runtime.providerRun
        : null,
      artifacts: Array.isArray(managedManifest.artifacts) ? managedManifest.artifacts : [],
    },
  };
}

function workflowStepStatusFromResult(result, toolPayload, attach) {
  if (attach && toolPayload) {
    if (toolPayload.status === "running") {
      return "success";
    }
    if (toolPayload.status === "stopped") {
      return "stopped";
    }
    if (toolPayload.status === "success") {
      return "success";
    }
    if (toolPayload.status === "error") {
      return "error";
    }
  }
  return result.status === 0 ? "success" : "error";
}

async function runToolWorkflow({
  steps,
  workflowName,
  workspaceRoot,
  jsonMode,
  commandLabel,
  category = "build",
  existingWorkflow = null,
  existingSteps = null,
  initialStepResults = null,
  startIndex = 0,
  resumeMeta = null,
  configPath = null,
}) {
  const workflow = existingWorkflow || createWorkflowRun(workspaceRoot, workflowName, { category, configPath });
  return await withLogFile(workflowEventLogPath(workflow.runDir), async () => withEventContext({
    workflow_id: workflow.id,
  }, async () => {
  emitEvent("workflow.created", {
    workflow: workflow.workflow,
    category: workflow.category,
    workspace: workflow.workspace,
  }, { scope: "workflow", workflowId: workflow.id });
  updateWorkflowRun(workflow.runDir, (current) => ({
    ...current,
    runnerPid: process.pid,
    currentChildPid: null,
    currentStepId: null,
    ...(resumeMeta ? {
      resumeCount: Number(current.resumeCount || 0) + 1,
      resumedFromStep: resumeMeta.fromStep,
      resumeHistory: [
        ...(Array.isArray(current.resumeHistory) ? current.resumeHistory : []),
        {
          at: new Date().toISOString(),
          fromStep: resumeMeta.fromStep,
          mode: resumeMeta.mode,
        },
      ],
    } : {}),
  }));
  const createdSteps = existingSteps ? [...existingSteps] : [];
  if (!existingSteps) {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      createdSteps.push(createWorkflowStep(
        workflow.runDir,
        index + 1,
        step.name || `${step.tool}.build`,
        { tool: step.tool, id: step.id || null },
      ));
    }
  }
  const stepSpecs = createdSteps.map((created, index) => ({
    id: created.id,
    tool: created.tool,
    name: created.name,
    toolArgv: steps[index] && steps[index].toolArgv ? steps[index].toolArgv : [],
    toolCommand: steps[index] && steps[index].toolCommand ? steps[index].toolCommand : "build",
      attach: Boolean(steps[index] && steps[index].attach),
  }));

  logDebug("workflow", "created workflow run", {
    id: workflow.id,
    workflow: workflow.workflow,
    workspace: workflow.workspace,
    steps: createdSteps.map((step) => ({ id: step.id, tool: step.tool, name: step.name }))
  });
  logInfo("workflow", "created workflow run", {
    id: workflow.id,
    workflow: workflow.workflow,
    workspace: workflow.workspace,
    run_dir: path.relative(process.cwd(), workflow.runDir),
    step_count: createdSteps.length,
    steps: createdSteps.map((step) => ({ id: step.id, tool: step.tool }))
  });

  updateWorkflowRun(workflow.runDir, (current) => ({
    ...current,
    status: "running",
    currentStepId: null,
    currentChildPid: null,
    steps: createdSteps.map((step, index) => {
      const status = index < startIndex
        ? workflowResumeStateFromStatus(step.status)
        : "created";
      return {
        id: step.id,
        name: step.name,
        stepDir: step.stepDir,
        status,
      };
    })
  }));
  emitEvent("workflow.started", {
    workflow: workflow.workflow,
    step_count: createdSteps.length,
  }, { scope: "workflow", workflowId: workflow.id });
  for (const step of createdSteps) {
    emitEvent("step.created", {
      name: step.name,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
    });
  }

  let workflowStatus = "success";
  let exitCode = 0;
  let lastToolPayload = null;
  let lastStderr = "";
  const stepResults = initialStepResults ? { ...initialStepResults } : {};
  let activeStep = null;
  try {
  for (let stepIndex = startIndex; stepIndex < createdSteps.length; stepIndex += 1) {
    const step = createdSteps[stepIndex];
    activeStep = step;
    updateWorkflowRun(workflow.runDir, (current) => ({
      ...current,
      status: "running",
      currentStepId: step.id,
      currentChildPid: null,
      steps: current.steps.map((entry) => entry.id === step.id ? { ...entry, status: "running" } : entry)
    }));
    updateWorkflowStep(step.stepDir, (current) => ({ ...current, status: "running" }));
    emitEvent("step.started", {
      name: step.name,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
    });

    const spec = stepSpecs.find((candidate) => candidate.id === step.id) || null;
    const resolvedStep = spec
      ? resolveConfiguredStepArgs(spec, { workspaceRoot, stepResults, runDir: workflow.runDir })
      : { args: [], relations: [] };
    const toolArgv = resolvedStep.args;
    const toolCommand = spec ? spec.toolCommand : "build";
    const attach = spec ? spec.attach : false;
    const execution = resolveStepExecution(workspaceRoot, toolArgv, step.tool);
    const fingerprint = stepFingerprint(step, toolCommand, toolArgv, execution);
    updateWorkflowStep(step.stepDir, (current) => ({
      ...current,
      fingerprint,
      resolvedInputs: execution && execution.resolved ? execution.resolved : null,
      reuseState: stepIndex < startIndex ? "reused" : "rerun",
    }));
    emitEvent("step.inputs.resolved", {
      resolved: execution && execution.resolved ? execution.resolved : null,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
    });

    const args = (
      ["fetch", "patch", "build", "inspect", "logs", "exec"].includes(toolCommand)
    )
      ? [
          cliEntrypoint(),
          toolCommand,
          "--tool",
          step.tool,
          "--workspace",
          workspaceRoot,
          ...toolArgv
        ]
      : [
          cliEntrypoint(),
          "tool",
          toolCommand,
          "--tool",
          step.tool,
          "--workspace",
          workspaceRoot,
          ...toolArgv
        ];
    if (!attach) {
      args.splice(1, 0, "--json");
    }

    logDebug("workflow", "running workflow step", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      argv: args.slice(1),
      command: toolCommand,
      attach,
    });
    logInfo("workflow", "running workflow step", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      argv: args.slice(1),
      log_file: path.relative(process.cwd(), step.logFile),
      run_dir: path.relative(process.cwd(), stepToolRunDir(step.stepDir)),
      command: toolCommand,
      attach,
    });
    fs.appendFileSync(
      step.logFile,
      `\n[morpheus:workflow] step ${step.id} (${step.tool}) argv=${JSON.stringify(args.slice(1))}\n`,
      "utf8"
    );

    const result = await runWorkflowChild(
      args,
      step.logFile,
      {
        ...process.env,
        MORPHEUS_DISABLE_TOOL_WORKFLOW_WRAP: "1",
        ...(configPath ? { MORPHEUS_CONFIG: configPath } : {}),
        MORPHEUS_EVENT_LOG_FILE: workflowEventLogPath(workflow.runDir),
        MORPHEUS_EVENT_CONTEXT: JSON.stringify({
          workflow_id: workflow.id,
          step_id: step.id,
          tool: step.tool,
        }),
      },
      (childPid) => {
        updateWorkflowRun(workflow.runDir, (current) => ({
          ...current,
          currentStepId: step.id,
          currentChildPid: childPid || null,
        }));
      },
      { attach, cwd: step.stepDir, eventContext: { workflowId: workflow.id, stepId: step.id, tool: step.tool } },
    );
    let toolPayload = attach
      ? attachedWorkflowStepPayload(step, toolCommand, result)
      : result.toolPayload;
    toolPayload = materializeRemoteArtifacts(step, toolPayload, execution);
    if (toolPayload) {
      writeJson(stepToolResultPath(step.stepDir), toolPayload);
    }
    lastToolPayload = toolPayload;
    lastStderr = String(result.stderr || "");
    stepResults[step.id] = stepTemplatePayload(toolPayload);
    const status = workflowStepStatusFromResult(result, toolPayload, attach);
    exitCode = toolPayload && typeof toolPayload.exit_code === "number"
      ? toolPayload.exit_code
      : (result.status == null ? 1 : result.status);

    logDebug("workflow", "completed workflow step", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      status,
      exitCode
    });
    logInfo("workflow", "completed workflow step", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      status,
      exit_code: exitCode
    });
    const updatedStep = updateWorkflowStep(step.stepDir, (current) => ({
      ...current,
      status,
      artifacts: stepArtifactsFromToolPayload(toolPayload),
      toolResult: toolPayload,
      exitCode,
      fingerprint,
      resolvedInputs: execution && execution.resolved ? execution.resolved : null,
      reuseState: "rerun",
    }));
    emitArtifactEvents(workflow, step, updatedStep.artifacts, resolvedStep.relations);
    emitRuntimeEventsFromPayload(workflow, step, toolPayload);
    emitEvent(status === "success" ? "step.completed" : status === "stopped" ? "step.stopped" : "step.failed", {
      exit_code: exitCode,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
    });

    updateWorkflowRun(workflow.runDir, (current) => ({
      ...current,
      status: "running",
      currentChildPid: null,
      steps: current.steps.map((entry) => entry.id === updatedStep.id
        ? { ...entry, status: updatedStep.status }
        : entry
      )
    }));

    if (status === "stopped") {
      workflowStatus = "stopped";
      logInfo("workflow", "workflow step stopped", {
        workflow: workflow.id,
        step: step.id,
        tool: step.tool,
        log_file: path.relative(process.cwd(), step.logFile),
        hint: `./bin/morpheus --json workflow logs --id ${workflow.id} --step ${step.id}`
      });
      break;
    }

    if (status !== "success") {
      workflowStatus = "error";
      logInfo("workflow", "workflow step failed", {
        workflow: workflow.id,
        step: step.id,
        tool: step.tool,
        log_file: path.relative(process.cwd(), step.logFile),
        hint: `./bin/morpheus --json workflow logs --id ${workflow.id} --step ${step.id}`
      });
      break;
    }
  }
  } catch (error) {
    workflowStatus = "error";
    exitCode = exitCode || 1;
    lastStderr = error instanceof Error ? (error.stack || error.message) : String(error);
    if (activeStep) {
      updateWorkflowStep(activeStep.stepDir, (current) => ({
        ...current,
        status: "error",
        exitCode,
      }));
      fs.appendFileSync(
        activeStep.logFile,
        `\n[morpheus:workflow] ${lastStderr}\n`,
        "utf8",
      );
      updateWorkflowRun(workflow.runDir, (current) => ({
        ...current,
        status: "error",
        currentChildPid: null,
        steps: current.steps.map((entry) => entry.id === activeStep.id
          ? { ...entry, status: "error" }
          : entry
        )
      }));
      logInfo("workflow", "workflow step failed before tool execution", {
        workflow: workflow.id,
        step: activeStep.id,
        tool: activeStep.tool,
        log_file: path.relative(process.cwd(), activeStep.logFile),
        error: error instanceof Error ? error.message : String(error),
      });
      emitEvent("step.failed", {
        error: error instanceof Error ? error.message : String(error),
      }, {
        scope: "step",
        workflowId: workflow.id,
        stepId: activeStep.id,
        tool: activeStep.tool,
      });
    }
  }

  const updatedWorkflow = updateWorkflowRun(workflow.runDir, (current) => ({
    ...current,
    status: workflowStatus,
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: current.steps
  }));
  logInfo("workflow", workflowStatus === "success"
    ? "completed workflow run"
    : workflowStatus === "stopped"
      ? "workflow run stopped"
      : "workflow run failed", {
    id: updatedWorkflow.id,
    workflow: updatedWorkflow.workflow,
    status: workflowStatus,
    run_dir: path.relative(process.cwd(), updatedWorkflow.runDir),
  });
  emitEvent(workflowStatus === "success" ? "workflow.completed" : workflowStatus === "stopped" ? "workflow.stopped" : "workflow.failed", {
    exit_code: workflowStatus === "success" ? 0 : exitCode || 1,
    workflow: updatedWorkflow.workflow,
  }, {
    scope: "workflow",
    workflowId: updatedWorkflow.id,
  });

  const payload = {
    command: commandLabel || "workflow run",
    status: workflowStatus,
    exit_code: workflowStatus === "success" ? 0 : exitCode || 1,
    summary: workflowStatus === "success"
      ? "completed workflow run"
      : workflowStatus === "stopped"
        ? "workflow run stopped"
        : "workflow run failed",
    details: {
      id: updatedWorkflow.id,
      workflow: updatedWorkflow.workflow,
      workspace: updatedWorkflow.workspace,
      run_dir: updatedWorkflow.runDir,
      manifest: workflowManifestPath(updatedWorkflow.runDir),
      steps: updatedWorkflow.steps,
      failed_step: workflowStatus === "success"
        ? null
        : (() => {
          const step = updatedWorkflow.steps.find((entry) => entry.status === "error") || updatedWorkflow.steps.at(-1) || null;
          if (!step) {
            return null;
          }
          const stepDir = step.stepDir;
          const logFile = path.join(stepDir, "stdout.log");
          return {
            id: step.id,
            name: step.name,
            tool: (step.name || "").split(".")[0],
            log_file: logFile,
            log_tail: tailFile(logFile, 12000),
          };
        })()
    },
    error: workflowStatus === "success" || workflowStatus === "stopped"
      ? undefined
      : { code: "workflow_failed", message: (lastToolPayload && lastToolPayload.summary) || lastStderr || "workflow step failed" }
  };

  if (jsonMode) {
    writeStdoutLine(JSON.stringify(payload));
  } else {
    writeStdoutLine(`${payload.summary}: ${payload.details.id}`);
  }

  return payload.exit_code || 0;
  }));
}

function collectResumePlan(workspaceRoot, workflowRecord, configured, fromStep) {
  const existingSteps = listWorkflowSteps(workflowRecord.runDir);
  const existingMap = new Map(existingSteps.map((step) => [step.id, step]));
  const createdSteps = [];
  const stepResults = {};
  let startIndex = configured.steps.length;
  let seenFromStep = !fromStep;

  for (let index = 0; index < configured.steps.length; index += 1) {
    const spec = configured.steps[index];
    const stepId = spec.id || spec.name || `step-${index + 1}`;
    let stepRecord = existingMap.get(stepId);
    if (!stepRecord) {
      stepRecord = createWorkflowStep(
        workflowRecord.runDir,
        index + 1,
        spec.name || `${spec.tool}.${spec.command || "exec"}`,
        { tool: spec.tool, id: stepId },
      );
    }
    createdSteps.push(stepRecord);

    if (!seenFromStep && stepId === fromStep) {
      seenFromStep = true;
      startIndex = Math.min(startIndex, index);
      continue;
    }
    if (fromStep && seenFromStep) {
      continue;
    }
    const stepSpec = {
      id: stepId,
      tool: spec.tool,
      name: spec.name || `${spec.tool}.${spec.command || "exec"}`,
      toolArgv: Array.isArray(spec.args) ? spec.args : [],
      toolCommand: spec.command || "exec",
      attach: Boolean(spec.attach),
    };
    const resolvedStep = resolveConfiguredStepArgs(stepSpec, { workspaceRoot, stepResults, runDir: workflowRecord.runDir });
    const toolArgv = resolvedStep.args;
    if (fromStep && !seenFromStep) {
      const execution = resolveStepExecution(workspaceRoot, toolArgv, spec.tool, configured.configPath || workflowRecord.configPath || null);
      const fingerprint = stepFingerprint(stepRecord, spec.command || "exec", toolArgv, execution);
      const reusable = stepRecord.status === "success"
        && stepRecord.fingerprint === fingerprint
        && artifactsExist(stepRecord);
      if (!reusable) {
        throw new Error(`cannot rerun from step ${fromStep}; prior step ${stepId} is not reusable`);
      }
      updateWorkflowStep(stepRecord.stepDir, (current) => ({
        ...current,
        reuseState: "reused",
        resolvedInputs: execution && execution.resolved ? execution.resolved : current.resolvedInputs || null,
      }));
      stepResults[stepId] = stepTemplatePayload(stepRecord.toolResult);
      continue;
    }

    const execution = resolveStepExecution(workspaceRoot, toolArgv, spec.tool, configured.configPath || workflowRecord.configPath || null);
    const fingerprint = stepFingerprint(stepRecord, spec.command || "exec", toolArgv, execution);
    const reusable = stepRecord.status === "success"
      && stepRecord.fingerprint === fingerprint
      && artifactsExist(stepRecord);
    if (reusable && startIndex === configured.steps.length) {
      stepResults[stepId] = stepTemplatePayload(stepRecord.toolResult);
      updateWorkflowStep(stepRecord.stepDir, (current) => ({
        ...current,
        reuseState: "reused",
        resolvedInputs: execution && execution.resolved ? execution.resolved : current.resolvedInputs || null,
      }));
      continue;
    }
    if (startIndex === configured.steps.length) {
      startIndex = index;
    }
  }

  if (fromStep && !seenFromStep) {
    throw new Error(`workflow resume could not resolve step: ${fromStep}`);
  }
  if (startIndex === configured.steps.length) {
    startIndex = configured.steps.length;
  }
  return { createdSteps, stepResults, startIndex };
}

async function runToolBuildWorkflow(options) {
  return await runToolWorkflow(options);
}

function runSingleToolWorkflow({
  tool,
  workflowName,
  workspaceRoot,
  toolArgv,
  jsonMode,
  commandLabel,
  category = "build",
  toolCommand = "build",
  attach = false,
}) {
  return runToolWorkflow({
    steps: [{ tool, name: `${tool}.${toolCommand}`, toolArgv, toolCommand, attach }],
    workflowName,
    workspaceRoot,
    jsonMode,
    commandLabel,
    category,
  });
}

function followLogFile(logFile) {
  return new Promise((resolve, reject) => {
    const child = spawn("tail", ["-n", "+1", "-f", logFile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(0);
        return;
      }
      resolve(code || 0);
    });
  });
}

async function handleWorkflowCommand(argv) {
  const { positionals, flags } = parseWorkflowArgs(argv);
  const subcommand = positionals[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    writeStdoutLine(workflowUsage());
    return 0;
  }

  if (subcommand === "run") {
    if (flags.name) {
      const configured = resolveConfiguredWorkflow(String(flags.name));
      const workspaceRoot = resolveWorkspaceRoot(flags);
      if (flags["from-step"]) {
        const workflowRuns = listRunDirsForWorkflow(workspaceRoot, String(flags.name));
        if (workflowRuns.length === 0) {
          throw new Error(`workflow run --from-step requires an existing workflow run for ${String(flags.name)}`);
        }
        const latest = workflowRuns[0];
        const plan = collectResumePlan(
          workspaceRoot,
          latest,
          configured,
          String(flags["from-step"]),
        );
        return await runToolWorkflow({
          steps: configured.steps.map((step, index) => ({
            id: step.id || step.name || `step-${index + 1}`,
            tool: step.tool,
            name: step.name || `${step.tool}.${step.command || "exec"}`,
            toolArgv: Array.isArray(step.args) ? step.args : [],
            toolCommand: step.command || "exec",
            attach: Boolean(step.attach),
          })),
          workflowName: String(flags.name),
          workspaceRoot,
          jsonMode: Boolean(flags.json),
          category: configured.category || "run",
          commandLabel: "workflow run",
          configPath: configured.configPath,
          existingWorkflow: latest,
          existingSteps: plan.createdSteps,
          initialStepResults: plan.stepResults,
          startIndex: plan.startIndex,
          resumeMeta: {
            mode: "from-step",
            fromStep: String(flags["from-step"]),
          },
        });
      }
      return await runToolWorkflow({
        steps: configured.steps.map((step, index) => ({
          id: step.id || step.name || `step-${index + 1}`,
          tool: step.tool,
          name: step.name || `${step.tool}.${step.command || "exec"}`,
          toolArgv: Array.isArray(step.args) ? step.args : [],
          toolCommand: step.command || "exec",
          attach: Boolean(step.attach),
        })),
        workflowName: String(flags.name),
        workspaceRoot,
        jsonMode: Boolean(flags.json),
        category: configured.category || "run",
        commandLabel: "workflow run",
        configPath: configured.configPath,
      });
    }

    const tool = flags.tool;
    if (!tool) {
      throw new Error("workflow run requires --tool <name> or --name WORKFLOW_NAME");
    }
    const workflowName = flags.workflow || `tool-${tool}`;
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const toolArgv = argv.filter((token) => token !== "run").filter((token) => token !== "--tool").filter((token) => token !== tool)
      .filter((token) => token !== "--workflow").filter((token) => token !== workflowName)
      .filter((token) => token !== "--json").filter((token) => token !== "--workspace").filter((token) => token !== workspaceRoot);

    return runToolWorkflow({
      steps: [{ tool, name: `${tool}.exec`, toolArgv, toolCommand: "exec" }],
      workflowName,
      workspaceRoot,
      jsonMode: Boolean(flags.json),
      category: "run",
      commandLabel: "workflow run",
    });
  }

  if (subcommand === "resume") {
    const id = flags.id;
    if (!id) {
      throw new Error("workflow resume requires --id WORKFLOW_RUN_ID");
    }
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const found = findWorkflowRun(workspaceRoot, id);
    const workflow = readJson(found.manifestPath);
    if (workflow.status === "running") {
      throw new Error("workflow resume requires a non-running workflow run");
    }
    const configured = resolveConfiguredWorkflow(String(workflow.workflow), workflow.configPath || null);
    const fromStep = flags["from-step"] ? String(flags["from-step"]) : null;
    const plan = collectResumePlan(workspaceRoot, workflow, configured, fromStep);
    return await runToolWorkflow({
      steps: configured.steps.map((step, index) => ({
        id: step.id || step.name || `step-${index + 1}`,
        tool: step.tool,
        name: step.name || `${step.tool}.${step.command || "exec"}`,
        toolArgv: Array.isArray(step.args) ? step.args : [],
        toolCommand: step.command || "exec",
        attach: Boolean(step.attach),
      })),
      workflowName: String(workflow.workflow),
      workspaceRoot,
      jsonMode: Boolean(flags.json),
      category: configured.category || "run",
      commandLabel: "workflow resume",
      configPath: configured.configPath,
      existingWorkflow: workflow,
      existingSteps: plan.createdSteps,
      initialStepResults: plan.stepResults,
      startIndex: plan.startIndex,
      resumeMeta: {
        mode: fromStep ? "from-step" : "resume",
        fromStep: fromStep || (configured.steps[plan.startIndex] && (configured.steps[plan.startIndex].id || configured.steps[plan.startIndex].name)) || null,
      },
    });
  }

  if (subcommand === "inspect") {
    const id = flags.id;
    if (!id) {
      throw new Error("workflow inspect requires --id WORKFLOW_RUN_ID");
    }
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const found = findWorkflowRun(workspaceRoot, id);
    const workflow = readJson(found.manifestPath);
    const steps = listWorkflowSteps(found.runDir);
    const payload = {
      command: "workflow inspect",
      status: "success",
      exit_code: 0,
      summary: "inspected workflow run",
      details: { workflow, steps }
    };
    if (flags.json) {
      writeStdoutLine(JSON.stringify(payload));
    } else {
      writeStdoutLine(payload.summary);
    }
    return 0;
  }

  if (subcommand === "logs") {
    const id = flags.id;
    if (!id) {
      throw new Error("workflow logs requires --id WORKFLOW_RUN_ID");
    }
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const found = findWorkflowRun(workspaceRoot, id);
    const steps = listWorkflowSteps(found.runDir);
    if (steps.length === 0) {
      throw new Error("workflow logs found no step logs");
    }
    const stepId = flags.step || steps[0].id;
    const step = steps.find((item) => item.id === stepId);
    if (!step) {
      throw new Error(`workflow logs could not resolve step: ${stepId}`);
    }
    const logFile = step.logFile || path.join(step.stepDir, "stdout.log");
    if (!fs.existsSync(logFile)) {
      throw new Error(`missing log file: ${path.relative(process.cwd(), logFile)}`);
    }
    if (flags.follow) {
      if (flags.json) {
        throw new Error("workflow logs does not support --json with --follow");
      }
      return await followLogFile(logFile);
    }
    const content = fs.readFileSync(logFile, "utf8");
    if (flags.json) {
      writeStdoutLine(JSON.stringify({
        command: "workflow logs",
        status: "success",
        exit_code: 0,
        summary: "printed workflow logs",
        details: { id, step: stepId, log_file: logFile, bytes: Buffer.byteLength(content, "utf8") }
      }));
    } else {
      writeStdoutLine(content.trimEnd());
    }
    return 0;
  }

  if (subcommand === "stop") {
    const id = flags.id;
    if (!id) {
      throw new Error("workflow stop requires --id WORKFLOW_RUN_ID");
    }
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const payload = stopWorkflowRun(workspaceRoot, id);
    if (flags.json) {
      writeStdoutLine(JSON.stringify(payload));
    } else {
      writeStdoutLine(`${payload.summary}: ${payload.details.id}`);
    }
    return 0;
  }

  if (subcommand === "remove") {
    const id = flags.id;
    if (!id) {
      throw new Error("workflow remove requires --id WORKFLOW_RUN_ID");
    }
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const payload = removeWorkflowRun(workspaceRoot, id);
    if (flags.json) {
      writeStdoutLine(JSON.stringify(payload));
    } else {
      writeStdoutLine(`${payload.summary}: ${payload.details.id}`);
    }
    return 0;
  }

  throw new Error(`unknown workflow subcommand: ${subcommand}`);
}

module.exports = {
  handleWorkflowCommand,
  runSingleToolWorkflow,
  runToolBuildWorkflow,
  stopWorkflowRun,
  removeWorkflowRun
};
