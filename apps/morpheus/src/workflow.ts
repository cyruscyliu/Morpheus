// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { applyConfigDefaults } = require("./config");
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
    "  node apps/morpheus/dist/cli.js workflow inspect --id WORKFLOW_RUN_ID [--json]",
    "  node apps/morpheus/dist/cli.js workflow logs --id WORKFLOW_RUN_ID [--step STEP_ID] [--follow] [--json]"
  ].join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
      parsed.details.event === "log" &&
      typeof parsed.details.line === "string"
    ) {
      fs.appendFileSync(stepLogFile, `${parsed.details.line}\n`, "utf8");
      continue;
    }

    finalPayload = parsed;
  }

  return finalPayload;
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

function runToolBuildWorkflow({ steps, workflowName, workspaceRoot, jsonMode, commandLabel }) {
  const workflow = createWorkflowRun(workspaceRoot, workflowName);
  return withLogFile(path.join(workflow.runDir, "progress.jsonl"), () => {
  const createdSteps = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    createdSteps.push(createWorkflowStep(workflow.runDir, index + 1, step.name || `${step.tool}.build`, { tool: step.tool }));
  }
  const stepSpecs = createdSteps.map((created, index) => ({
    id: created.id,
    tool: created.tool,
    name: created.name,
    toolArgv: steps[index] && steps[index].toolArgv ? steps[index].toolArgv : []
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
    steps: createdSteps.map((step) => ({ id: step.id, name: step.name, stepDir: step.stepDir, status: "created" }))
  }));

  let workflowStatus = "success";
  let exitCode = 0;
  let lastToolPayload = null;
  let lastStderr = "";
  for (const step of createdSteps) {
    updateWorkflowRun(workflow.runDir, (current) => ({
      ...current,
      status: "running",
      steps: current.steps.map((entry) => entry.id === step.id ? { ...entry, status: "running" } : entry)
    }));
    updateWorkflowStep(step.stepDir, (current) => ({ ...current, status: "running" }));

    const spec = stepSpecs.find((candidate) => candidate.id === step.id) || null;
    const toolArgv = spec ? spec.toolArgv : [];

    const args = [
      cliEntrypoint(),
      "--json",
      "tool",
      "build",
      "--tool",
      step.tool,
      "--workspace",
      workspaceRoot,
      ...toolArgv
    ];

    logDebug("workflow", "running workflow step", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      argv: args.slice(1)
    });
    logInfo("workflow", "running workflow step", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      argv: args.slice(1),
      log_file: path.relative(process.cwd(), step.logFile),
      run_dir: path.relative(process.cwd(), stepToolRunDir(step.stepDir)),
    });
    fs.appendFileSync(
      step.logFile,
      `\n[morpheus:workflow] step ${step.id} (${step.tool}) argv=${JSON.stringify(args.slice(1))}\n`,
      "utf8"
    );

    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      cwd: process.cwd(),
      env: {
        ...process.env,
        MORPHEUS_DISABLE_TOOL_WORKFLOW_WRAP: "1",
        MORPHEUS_RUN_DIR_OVERRIDE: stepToolRunDir(step.stepDir),
        MORPHEUS_EVENT_LOG_FILE: path.join(step.stepDir, "progress.jsonl")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    fs.appendFileSync(step.logFile, result.stderr || "", "utf8");

    const toolPayload = consumeToolOutput(result.stdout || "", step.logFile);
    if (toolPayload) {
      writeJson(stepToolResultPath(step.stepDir), toolPayload);
    }
    lastToolPayload = toolPayload;
    lastStderr = String(result.stderr || "");
    const status = result.status === 0 ? "success" : "error";
    exitCode = result.status == null ? 1 : result.status;

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
      steps: current.steps.map((entry) => entry.id === updatedStep.id
        ? { ...entry, status: updatedStep.status }
        : entry
      )
    }));

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
    steps: current.steps
  }));
  logInfo("workflow", workflowStatus === "success" ? "completed workflow run" : "workflow run failed", {
    id: updatedWorkflow.id,
    workflow: updatedWorkflow.workflow,
    status: workflowStatus,
    run_dir: path.relative(process.cwd(), updatedWorkflow.runDir),
  });

  const payload = {
    command: commandLabel || "workflow run",
    status: workflowStatus,
    exit_code: workflowStatus === "success" ? 0 : exitCode || 1,
    summary: workflowStatus === "success" ? "completed workflow run" : "workflow run failed",
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
    error: workflowStatus === "success"
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

function runSingleToolWorkflow({ tool, workflowName, workspaceRoot, toolArgv, jsonMode, commandLabel }) {
  return runToolBuildWorkflow({
    steps: [{ tool, name: `${tool}.build`, toolArgv }],
    workflowName,
    workspaceRoot,
    jsonMode,
    commandLabel
  });
}

function handleWorkflowCommand(argv) {
  const { positionals, flags } = parseWorkflowArgs(argv);
  const subcommand = positionals[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    writeStdoutLine(workflowUsage());
    return 0;
  }

  if (subcommand === "run") {
    const tool = flags.tool;
    if (!tool) {
      throw new Error("workflow run requires --tool <name>");
    }
    const workflowName = flags.workflow || `tool-${tool}`;
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const toolArgv = argv.filter((token) => token !== "run").filter((token) => token !== "--tool").filter((token) => token !== tool)
      .filter((token) => token !== "--workflow").filter((token) => token !== workflowName)
      .filter((token) => token !== "--json").filter((token) => token !== "--workspace").filter((token) => token !== workspaceRoot);

    return runSingleToolWorkflow({ tool, workflowName, workspaceRoot, toolArgv, jsonMode: Boolean(flags.json) });
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

  throw new Error(`unknown workflow subcommand: ${subcommand}`);
}

module.exports = {
  handleWorkflowCommand,
  runSingleToolWorkflow,
  runToolBuildWorkflow
};
