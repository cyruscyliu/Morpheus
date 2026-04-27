// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { applyConfigDefaults, loadConfig } = require("./config");
const { repoRoot } = require("./paths");
const { writeStdoutLine } = require("./io");
const { logDebug, logInfo, withLogFile } = require("./logger");
const {
  createWorkflowRun,
  createWorkflowStep,
  updateWorkflowRun,
  updateWorkflowStep,
  workflowManifestPath,
  workflowRunsRoot,
  stepToolRunDir,
} = require("./workflow-runs");

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
    "  node apps/morpheus/dist/cli.js workflow run --tool <name> [--workflow NAME] [--json] [...tool flags]",
    "  node apps/morpheus/dist/cli.js workflow run --name WORKFLOW_NAME [--json]",
    "  node apps/morpheus/dist/cli.js workflow inspect --id WORKFLOW_RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js workflow logs --id WORKFLOW_RUN_ID [--step STEP_ID] [--follow] [--json]",
    "  node apps/morpheus/dist/cli.js workflow stop --id WORKFLOW_RUN_ID [--json]"
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
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function resolveConfiguredWorkflow(name) {
  const config = loadConfig(process.cwd());
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
    const stepValue = context.stepResults[stepId];
    const resolved = getByPath(stepValue, stepPath);
    if (resolved == null) {
      throw new Error(`workflow template resolved empty value: ${expr}`);
    }
    return String(resolved);
  });
}

function resolveConfiguredStepArgs(step, context) {
  const items = Array.isArray(step.args)
    ? step.args
    : (Array.isArray(step.toolArgv) ? step.toolArgv : []);
  return items.map((item) => {
    if (typeof item !== "string") {
      return String(item);
    }
    return resolveWorkflowStringTemplate(item, context);
  });
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

function stopWorkflowRun(workspaceRoot, id) {
  const found = findWorkflowRun(workspaceRoot, id);
  const workflow = readJson(found.manifestPath);
  const steps = listWorkflowSteps(found.runDir);
  const currentChildPid = Number(workflow.currentChildPid || 0);
  const runnerPid = Number(workflow.runnerPid || 0);

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

function processToolStdoutLine(rawLine, stepLogFile, state) {
  const line = String(rawLine || "").trim();
  if (!line) {
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    writeStepLogLine(stepLogFile, rawLine);
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
      return;
    }
    if (typeof parsed.details.line === "string") {
      writeStepLogLine(stepLogFile, parsed.details.line);
      return;
    }
  }

  state.finalPayload = parsed;
}

function runWorkflowChild(args, stepLogFile, env, onSpawn, options = {}) {
  return new Promise((resolve, reject) => {
    const attach = Boolean(options.attach);
    const child = attach
      ? spawn(process.execPath, args, {
          cwd: process.cwd(),
          env,
          stdio: "inherit",
        })
      : spawn(process.execPath, args, {
          cwd: process.cwd(),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
    if (typeof onSpawn === "function") {
      onSpawn(child.pid);
    }

    if (attach) {
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          status: typeof code === "number" ? code : 1,
          stderr: "",
          toolPayload: null,
        });
      });
      return;
    }

    let stdoutBuffer = "";
    let stderrText = "";
    const state = { finalPayload: null };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const rawLine of lines) {
        processToolStdoutLine(rawLine, stepLogFile, state);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrText += chunk;
      fs.appendFileSync(stepLogFile, chunk, "utf8");
      process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        processToolStdoutLine(stdoutBuffer, stepLogFile, state);
      }
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
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string") {
      continue;
    }
    views[artifact.path] = artifact;
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
}) {
  const workflow = createWorkflowRun(workspaceRoot, workflowName, { category });
  return await withLogFile(path.join(workflow.runDir, "progress.jsonl"), async () => {
  updateWorkflowRun(workflow.runDir, (current) => ({
    ...current,
    runnerPid: process.pid,
    currentChildPid: null,
    currentStepId: null,
  }));
  const createdSteps = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    createdSteps.push(createWorkflowStep(
      workflow.runDir,
      index + 1,
      step.name || `${step.tool}.build`,
      { tool: step.tool, id: step.id || null },
    ));
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
    steps: createdSteps.map((step) => ({ id: step.id, name: step.name, stepDir: step.stepDir, status: "created" }))
  }));

  let workflowStatus = "success";
  let exitCode = 0;
  let lastToolPayload = null;
  let lastStderr = "";
  const stepResults = {};
  for (const step of createdSteps) {
    updateWorkflowRun(workflow.runDir, (current) => ({
      ...current,
      status: "running",
      currentStepId: step.id,
      currentChildPid: null,
      steps: current.steps.map((entry) => entry.id === step.id ? { ...entry, status: "running" } : entry)
    }));
    updateWorkflowStep(step.stepDir, (current) => ({ ...current, status: "running" }));

    const spec = stepSpecs.find((candidate) => candidate.id === step.id) || null;
    const toolArgv = spec
      ? resolveConfiguredStepArgs(spec, { workspaceRoot, stepResults })
      : [];
    const toolCommand = spec ? spec.toolCommand : "build";
    const attach = spec ? spec.attach : false;

    const args = [
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
        MORPHEUS_RUN_DIR_OVERRIDE: stepToolRunDir(step.stepDir),
        MORPHEUS_EVENT_LOG_FILE: path.join(step.stepDir, "progress.jsonl")
      },
      (childPid) => {
        updateWorkflowRun(workflow.runDir, (current) => ({
          ...current,
          currentStepId: step.id,
          currentChildPid: childPid || null,
        }));
      },
      { attach },
    );
    const toolPayload = attach
      ? attachedWorkflowStepPayload(step, toolCommand, result)
      : result.toolPayload;
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
      exitCode
    }));

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
  });
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
      return await runToolWorkflow({
        steps: configured.steps.map((step, index) => ({
          id: step.id || step.name || `step-${index + 1}`,
          tool: step.tool,
          name: step.name || `${step.tool}.${step.command || "run"}`,
          toolArgv: Array.isArray(step.args) ? step.args : [],
          toolCommand: step.command || "run",
          attach: Boolean(step.attach),
        })),
        workflowName: String(flags.name),
        workspaceRoot,
        jsonMode: Boolean(flags.json),
        category: configured.category || "run",
        commandLabel: "workflow run",
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
      steps: [{ tool, name: `${tool}.run`, toolArgv, toolCommand: "run" }],
      workflowName,
      workspaceRoot,
      jsonMode: Boolean(flags.json),
      category: "run",
      commandLabel: "workflow run",
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

  throw new Error(`unknown workflow subcommand: ${subcommand}`);
}

module.exports = {
  handleWorkflowCommand,
  runSingleToolWorkflow,
  runToolBuildWorkflow,
  stopWorkflowRun
};
