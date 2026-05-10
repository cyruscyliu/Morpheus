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
const { emitEvent, withEventContext, withLogFile } = require("../core/logger");
const { runConfigCheck } = require("./config-check");
const { validateToolDescriptor } = require("../core/tool-validator");
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
const {
  listWorkflowRuns,
  loadWorkflowDetail,
  loadWorkflowEvents,
  loadWorkflowLogText,
  loadWorkflowStepLogText,
} = require("../core/workflow-read");

function parseWorkflowArgs(argv) {
  const positionals = [];
  const flags = {};
  const booleanFlags = new Set(["json", "follow", "one-step"]);

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
    "  ./bin/morpheus [--config PATH] workflow runs [--limit N] [--offset N] [--json]",
    "  ./bin/morpheus [--config PATH] workflow list [--json]",
    "  ./bin/morpheus --config projects/<project>/morpheus.yaml workflow run --name WORKFLOW_NAME [--json]",
    "  ./bin/morpheus [--config PATH] workflow resume --id WORKFLOW_RUN_ID [--from-step STEP_ID] [--one-step] [--json]",
    "  ./bin/morpheus [--config PATH] workflow inspect --id WORKFLOW_RUN_ID [--json]",
    "  ./bin/morpheus [--config PATH] workflow events --id WORKFLOW_RUN_ID [--json]",
    "  ./bin/morpheus [--config PATH] workflow logs --id WORKFLOW_RUN_ID [--step STEP_ID] [--follow]",
    "  ./bin/morpheus [--config PATH] workflow stop --id WORKFLOW_RUN_ID [--json]",
    "  ./bin/morpheus [--config PATH] workflow remove --id WORKFLOW_RUN_ID [--json]",
    "",
    "Purpose:",
    "  Discover, run, inspect, and manage Morpheus workflow runs.",
    "",
    "Commands:",
    "  workflow runs      List managed workflow runs.",
    "  workflow list      List configured workflows.",
    "  workflow run       Start a configured workflow.",
    "  workflow resume    Resume a previous workflow run.",
    "  workflow inspect   Inspect workflow state and steps.",
    "  workflow events    Print workflow events for a run.",
    "  workflow logs      Print logs for a workflow step.",
    "  workflow stop      Stop a running workflow.",
    "  workflow remove    Remove a stopped workflow run.",
    "",
    "Examples:",
    "  ./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow runs --json",
    "  ./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow list --json",
    "  ./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow run --name qemu-build --json",
    "  ./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow inspect --id <run-id> --json",
    "  ./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow events --id <run-id> --json",
    "  ./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow logs --id <run-id> --step <step-id>",
    "",
    "Notes:",
    "  - Pass --config explicitly for project workflows.",
    "  - 'workflow logs --follow' streams text logs and does not support --json."
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

function relativeToCwd(targetPath) {
  return path.relative(process.cwd(), targetPath);
}

function relativizeWorkflowRecord(workflow) {
  if (!workflow || typeof workflow !== "object") {
    return workflow;
  }
  return {
    ...workflow,
    workspace: typeof workflow.workspace === "string" ? relativeToCwd(workflow.workspace) : workflow.workspace,
    runDir: typeof workflow.runDir === "string" ? relativeToCwd(workflow.runDir) : workflow.runDir,
  };
}

function relativizeStepRecord(step) {
  if (!step || typeof step !== "object") {
    return step;
  }
  const preferredLogFile = resolvePreferredStepLogFile(step);
  return {
    ...step,
    stepDir: typeof step.stepDir === "string" ? relativeToCwd(step.stepDir) : step.stepDir,
    logFile: typeof preferredLogFile === "string" ? relativeToCwd(preferredLogFile) : preferredLogFile,
  };
}

function normalizeWorkflowInspectDetails(workflow, steps) {
  const workflowRecord = relativizeWorkflowRecord(workflow) || {};
  return {
    id: workflowRecord.id || null,
    workflow: workflowRecord.workflow || null,
    category: workflowRecord.category || null,
    status: workflowRecord.status || null,
    workspace: workflowRecord.workspace || null,
    run_dir: workflowRecord.runDir || null,
    current_step_id: workflowRecord.currentStepId || null,
    current_child_pid: workflowRecord.currentChildPid == null ? null : workflowRecord.currentChildPid,
    runner_pid: workflowRecord.runnerPid == null ? null : workflowRecord.runnerPid,
    created_at: workflowRecord.createdAt || null,
    updated_at: workflowRecord.updatedAt || null,
    steps: steps.map((step) => {
      const stepRecord = relativizeStepRecord(step) || {};
      return {
        id: stepRecord.id || null,
        name: stepRecord.name || null,
        status: stepRecord.status || null,
        step_dir: stepRecord.stepDir || null,
        log_file: stepRecord.logFile || null,
        exit_code: stepRecord.exitCode == null ? null : stepRecord.exitCode,
      };
    }),
  };
}

function cliEntrypoint() {
  return path.join(repoRoot(), "apps", "morpheus", "dist", "cli.js");
}

function isWithinDir(parentDir, candidatePath) {
  if (!parentDir || !candidatePath) {
    return false;
  }
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function resolvePreferredStepLogFile(step) {
  if (!step || typeof step !== "object") {
    return null;
  }
  const candidate = step
    && step.toolResult
    && step.toolResult.details
    && typeof step.toolResult.details.log_file === "string"
      ? step.toolResult.details.log_file
      : null;
  if (candidate && isWithinDir(step.stepDir, candidate)) {
    return candidate;
  }
  return step.logFile || (step.stepDir ? path.join(step.stepDir, "stdout.log") : null);
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

function ensureStepArtifactLocalized(stepRecord, artifactPath) {
  if (!stepRecord || !stepRecord.stepDir || !Array.isArray(stepRecord.artifacts)) {
    return stepRecord;
  }
  const artifactIndex = stepRecord.artifacts.findIndex((artifact) => (
    artifact && typeof artifact === "object" && artifact.path === artifactPath
  ));
  if (artifactIndex < 0) {
    return stepRecord;
  }
  const artifact = stepRecord.artifacts[artifactIndex];
  if (!artifact || typeof artifact !== "object") {
    return stepRecord;
  }
  const localLocation = path.join(stepRecord.artifactsDir, artifact.path);
  const remoteLocation = typeof artifact.remote_location === "string"
    ? artifact.remote_location
    : (typeof artifact.location === "string" ? artifact.location : null);
  const sshTarget = stepRecord.resolvedInputs && typeof stepRecord.resolvedInputs.ssh === "string"
    ? stepRecord.resolvedInputs.ssh
    : null;
  if (!remoteLocation || !sshTarget) {
    return stepRecord;
  }
  syncRemotePathToLocal(remoteLocation, localLocation, parseSshTarget(sshTarget), `${stepRecord.tool} artifact ${artifact.path}`);
  return updateWorkflowStep(stepRecord.stepDir, (current) => ({
    ...current,
    artifacts: (Array.isArray(current.artifacts) ? current.artifacts : []).map((entry) => (
      entry && typeof entry === "object" && entry.path === artifact.path
        ? {
            ...entry,
            remote_location: remoteLocation,
            local_location: localLocation,
          }
        : entry
    )),
    toolResult: current.toolResult && typeof current.toolResult === "object"
      ? {
          ...current.toolResult,
          details: current.toolResult.details && Array.isArray(current.toolResult.details.artifacts)
            ? {
                ...current.toolResult.details,
                artifacts: current.toolResult.details.artifacts.map((entry) => (
                  entry && typeof entry === "object" && entry.path === artifact.path
                    ? {
                        ...entry,
                        remote_location: remoteLocation,
                        local_location: localLocation,
                      }
                    : entry
                )),
              }
            : current.toolResult.details,
        }
      : current.toolResult,
  }));
}

function templateStepPayloadFromRecord(stepRecord, options = {}) {
  if (!stepRecord || typeof stepRecord !== "object") {
    return null;
  }
  const artifactPath = options && options.artifactPath ? options.artifactPath : null;
  const effectiveStepRecord = artifactPath ? ensureStepArtifactLocalized(stepRecord, artifactPath) : stepRecord;
  if (effectiveStepRecord.toolResult && typeof effectiveStepRecord.toolResult === "object") {
    const artifacts = Array.isArray(effectiveStepRecord.artifacts) ? effectiveStepRecord.artifacts : [];
    return stepTemplatePayload({
      ...effectiveStepRecord.toolResult,
      details: {
        ...(effectiveStepRecord.toolResult.details || {}),
        artifacts: Array.isArray(effectiveStepRecord.toolResult?.details?.artifacts)
          ? effectiveStepRecord.toolResult.details.artifacts
          : artifacts,
      },
    });
  }
  if (Array.isArray(effectiveStepRecord.artifacts)) {
    return {
      artifacts: stepArtifactViewMap({
        details: {
          artifacts: effectiveStepRecord.artifacts,
        },
      }),
    };
  }
  return null;
}

function preferredArtifactLocation(artifact, preferLocal) {
  if (!artifact || typeof artifact !== "object") {
    return undefined;
  }
  return preferLocal
    ? (artifact.local_location || artifact.location || artifact.remote_location || undefined)
    : (artifact.remote_location || artifact.location || artifact.local_location || undefined);
}

function resolveArtifactTemplateValue(payload, stepPath, preferLocal) {
  const parts = String(stepPath || "").split(".");
  if (parts[0] !== "artifacts" || parts.length < 3) {
    return getByPath(payload, stepPath);
  }
  const artifact = getByPath(payload, `artifacts.${parts[1]}`);
  if (!artifact || typeof artifact !== "object") {
    return getByPath(payload, stepPath);
  }
  if (parts[2] === "location") {
    return preferredArtifactLocation(artifact, preferLocal);
  }
  if (parts[2] === "local_location") {
    return artifact.local_location || artifact.location || artifact.remote_location || undefined;
  }
  if (parts[2] === "remote_location") {
    return artifact.remote_location || artifact.location || artifact.local_location || undefined;
  }
  return getByPath(payload, stepPath);
}

function resolveTemplateStepValue(context, stepId, stepPath) {
  const preferLocal = !context.currentStepRemoteEnabled;
  const parts = String(stepPath || "").split(".");
  const artifactPath = parts[0] === "artifacts" && parts.length >= 3 ? parts[1] : null;

  if (artifactPath && context.runDir) {
    const stepManifestPath = path.join(context.runDir, "steps", stepId, "step.json");
    if (fs.existsSync(stepManifestPath)) {
      const stepRecord = readJson(stepManifestPath);
      const unresolvedPayload = templateStepPayloadFromRecord(stepRecord, {});
      const unresolvedArtifact = unresolvedPayload
        ? getByPath(unresolvedPayload, `artifacts.${artifactPath}`)
        : null;
      const localizedArtifactPath = unresolvedArtifact && typeof unresolvedArtifact.path === "string"
        ? unresolvedArtifact.path
        : artifactPath;
      const payload = templateStepPayloadFromRecord(stepRecord, {
        artifactPath: preferLocal ? localizedArtifactPath : null,
      });
      if (payload) {
        const localized = resolveArtifactTemplateValue(payload, stepPath, preferLocal);
        if (localized != null) {
          return localized;
        }
      }
    }
  }

  const direct = resolveArtifactTemplateValue(context.stepResults[stepId], stepPath, preferLocal);
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
  const payload = templateStepPayloadFromRecord(stepRecord, { artifactPath });
  if (!payload) {
    return undefined;
  }
  return resolveArtifactTemplateValue(payload, stepPath, preferLocal);
}

function listConfiguredWorkflows(explicitConfigPath = null) {
  const config = loadConfig(process.cwd(), { explicitPath: explicitConfigPath });
  const workflows = config && config.value && config.value.workflows ? config.value.workflows : {};
  const items = Object.entries(workflows)
    .map(([name, workflow]) => {
      const value = workflow && typeof workflow === "object" ? workflow : {};
      const steps = Array.isArray(value.steps) ? value.steps : [];
      return {
        name,
        category: value.category || "run",
        steps: steps.length,
        config: config.path ? path.relative(process.cwd(), config.path) || "morpheus.yaml" : null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    command: "workflow list",
    status: "success",
    exit_code: 0,
    summary: items.length === 0 ? "no configured workflows" : "listed configured workflows",
    details: {
      config: config.path ? path.relative(process.cwd(), config.path) || "morpheus.yaml" : null,
      workflows: items,
    }
  };
}

function listManagedWorkflowRuns(workspaceRoot, flags) {
  const payload = listWorkflowRuns(workspaceRoot, {
    limit: flags.limit,
    offset: flags.offset,
  });
  return {
    command: "workflow runs",
    status: "success",
    exit_code: 0,
    summary: payload.runs.length === 0 ? "no workflow runs" : "listed workflow runs",
    details: {
      run_root: relativeToCwd(workflowRunsRoot(workspaceRoot)),
      workspace: path.resolve(process.cwd(), workspaceRoot),
      runs: payload.runs.map((run) => ({
        id: run.id,
        kind: run.kind,
        format: run.format,
        category: run.category,
        workflowName: run.workflowName,
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        changeName: run.changeName,
        stepCount: run.stepCount,
        runDir: run.runDir ? relativeToCwd(run.runDir) : run.runDir,
      })),
      total: payload.total,
      offset: payload.offset,
      limit: payload.limit,
    }
  };
}

function eventPayloadForRun(workspaceRoot, id) {
  const events = loadWorkflowEvents(workspaceRoot, id);
  if (!events) {
    throw new Error(`workflow run not found: ${id}; use 'morpheus workflow list' to start a run or 'morpheus workflow inspect --id <run-id>' with a valid id`);
  }
  return {
    command: "workflow events",
    status: "success",
    exit_code: 0,
    summary: "listed workflow events",
    details: {
      id,
      events,
    }
  };
}

function inspectPayloadForRun(workspaceRoot, id) {
  const detail = loadWorkflowDetail(workspaceRoot, id);
  if (!detail) {
    throw new Error(`workflow run not found: ${id}; use 'morpheus workflow list' to start a run or 'morpheus workflow inspect --id <run-id>' with a valid id`);
  }
  return {
    command: "workflow inspect",
    status: "success",
    exit_code: 0,
    summary: "inspected workflow run",
    details: {
      id: detail.id,
      kind: detail.kind,
      format: detail.format,
      category: detail.category,
      workflowName: detail.workflowName,
      status: detail.status,
      createdAt: detail.createdAt,
      completedAt: detail.completedAt,
      changeName: detail.changeName,
      stepCount: detail.stepCount,
      runDir: detail.runDir ? relativeToCwd(detail.runDir) : detail.runDir,
      graph: detail.graph,
      steps: detail.steps.map((step) => ({
        ...step,
        stepDir: step.stepDir ? relativeToCwd(step.stepDir) : step.stepDir,
        logUrl: step.logUrl || null,
        artifacts: Array.isArray(step.artifacts) ? step.artifacts : [],
      })),
    }
  };
}

function resolveConfiguredWorkflow(name, explicitConfigPath = null) {
  const config = loadConfig(process.cwd(), { explicitPath: explicitConfigPath });
  const workflows = config && config.value && config.value.workflows ? config.value.workflows : {};
  const workflow = workflows && workflows[name] ? workflows[name] : null;
  if (!workflow) {
    throw new Error(`unknown configured workflow: ${name}; run 'morpheus workflow list' to inspect available workflows`);
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
      ? preferredArtifactLocation(artifact, !context.currentStepRemoteEnabled)
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
  const provisionalArgs = items.map((item) => typeof item === "string" ? item : String(item));
  const currentStepExecution = resolveStepExecution(
    context.workspaceRoot,
    provisionalArgs,
    step.tool,
    context.configPath || null,
  );
  const templateContext = {
    ...context,
    currentStepRemoteEnabled: Boolean(currentStepExecution && currentStepExecution.remoteEnabled),
  };
  const args = items.map((item) => {
    if (typeof item !== "string") {
      return String(item);
    }
    const resolved = resolveWorkflowStringTemplateWithTrace(item, templateContext, currentStepId);
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
    throw new Error(`workflow run not found: ${id}; use 'morpheus workflow list' to start a run or 'morpheus workflow inspect --id <run-id>' with a valid id`);
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

function isRunningPid(pid) {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

function reconcileStaleWorkflowRun(found) {
  const workflow = readJson(found.manifestPath);
  const steps = listWorkflowSteps(found.runDir);
  if (workflow.status !== "running") {
    return { workflow, steps };
  }

  const runnerPid = Number(workflow.runnerPid || 0);
  const currentChildPid = Number(workflow.currentChildPid || 0);
  const runnerAlive = isRunningPid(runnerPid);
  const childAlive = isRunningPid(currentChildPid);
  if (runnerAlive || childAlive) {
    return { workflow, steps };
  }

  for (const step of steps) {
    if (step.status === "running") {
      updateWorkflowStep(step.stepDir, (current) => ({
        ...current,
        status: "error",
        exitCode: current.exitCode == null ? 1 : current.exitCode,
      }));
    }
  }

  const updatedWorkflow = updateWorkflowRun(found.runDir, (current) => ({
    ...current,
    status: "error",
    currentStepId: null,
    currentChildPid: null,
    runnerPid: null,
    steps: Array.isArray(current.steps)
      ? current.steps.map((entry) => (
          entry.status === "running"
            ? { ...entry, status: "error" }
            : entry
        ))
      : [],
  }));

  fs.appendFileSync(
    workflowEventLogPath(found.runDir),
    `${JSON.stringify({
      ts: new Date().toISOString(),
      producer: "morpheus",
      level: "error",
      scope: "workflow",
      event: "workflow.runner.stale",
      workflow_id: updatedWorkflow.id,
      data: {
        runnerPid: runnerPid > 0 ? runnerPid : null,
        currentChildPid: currentChildPid > 0 ? currentChildPid : null,
        message: "workflow runner process disappeared before recording a terminal state",
      },
    })}\n`,
    "utf8",
  );

  return {
    workflow: updatedWorkflow,
    steps: listWorkflowSteps(found.runDir),
  };
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

  if (!descriptor.entry) {
    const command = process.execPath;
    const args = [
      path.join(repoRoot(), "apps", "morpheus", "dist", "cli.js"),
      "stop",
      "--tool",
      step.tool,
      "--json",
    ];
    return spawnSync(command, args, {
      cwd: step.stepDir,
      encoding: "utf8",
      env: process.env,
    });
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

function stopWorkflowStepToolProcesses(step) {
  const manifest = stepToolManifest(step);
  if (!manifest) {
    return;
  }
  for (const pid of [
    Number(manifest.pid || 0),
    Number(manifest.launcherPid || 0),
    Number(manifest.runnerPid || 0),
  ]) {
    if (pid > 0) {
      stopPid(pid);
    }
  }
}

function stopWorkflowRun(workspaceRoot, id) {
  const found = findWorkflowRun(workspaceRoot, id);
  const workflow = readJson(found.manifestPath);
  const steps = listWorkflowSteps(found.runDir);
  const currentChildPid = Number(workflow.currentChildPid || 0);
  const runnerPid = Number(workflow.runnerPid || 0);

  for (const step of steps) {
    if (!step || !step.tool || !step.stepDir || !stepToolManifest(step)) {
      continue;
    }
    try {
      stopWorkflowStepTool(step);
    } catch {}
    try {
      stopWorkflowStepToolProcesses(step);
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
      status: updatedWorkflow.status,
      run_dir: relativeToCwd(updatedWorkflow.runDir),
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
  for (const step of steps) {
    if (!step || !step.tool || !step.stepDir || !stepToolManifest(step)) {
      continue;
    }
    try {
      stopWorkflowStepTool(step);
    } catch {}
    try {
      stopWorkflowStepToolProcesses(step);
    } catch {}
  }
  const currentChildPid = Number(workflow.currentChildPid || 0);
  const runnerPid = Number(workflow.runnerPid || 0);
  if (currentChildPid > 0) {
    stopPid(currentChildPid);
  }
  if (runnerPid > 0 && runnerPid !== process.pid) {
    stopPid(runnerPid);
  }
  fs.rmSync(found.runDir, { recursive: true, force: true });
  return {
    command: "workflow remove",
    status: "success",
    exit_code: 0,
    summary: "removed workflow run",
    details: {
      id,
      workflow: workflow.workflow,
      status: "removed",
      run_dir: relativeToCwd(found.runDir),
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
  const remoteEnabled = Boolean(
    stepRecord
    && stepRecord.resolvedInputs
    && typeof stepRecord.resolvedInputs.ssh === "string"
    && stepRecord.resolvedInputs.workspace
    && stepRecord.resolvedInputs.localWorkspace
    && stepRecord.resolvedInputs.workspace !== stepRecord.resolvedInputs.localWorkspace
  );
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") {
      return false;
    }
    if (remoteEnabled) {
      const remoteLocation = artifact.remote_location || artifact.location || null;
      if (!remoteLocation) {
        return false;
      }
      continue;
    }
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

function emitProducedArtifactEvents(workflow, step, artifacts) {
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
}

function emitConsumedArtifactEvents(workflow, step, relations) {
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
  const localizedArtifacts = toolPayload.details.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string" || typeof artifact.location !== "string") {
      return artifact;
    }
    return {
      ...artifact,
      remote_location: artifact.location,
      local_location: path.join(step.artifactsDir, artifact.path),
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

function runWorkflowBuildPreflight(steps) {
  const configResult = runConfigCheck();
  if (configResult.exit_code !== 0) {
    const firstError = Array.isArray(configResult.issues)
      ? configResult.issues.find((issue) => issue.level !== "warn")
      : null;
    throw new Error(firstError
      ? `build preflight failed: ${firstError.path}: ${firstError.message}`
      : "build preflight failed");
  }

  const toolNames = new Set(
    (Array.isArray(steps) ? steps : [])
      .map((step) => (step && step.tool ? String(step.tool) : ""))
      .filter(Boolean)
  );
  for (const toolName of toolNames) {
    const result = validateToolDescriptor(toolName);
    if (!result.ok) {
      const firstIssue = Array.isArray(result.issues) ? result.issues[0] : null;
      throw new Error(firstIssue
        ? `build preflight failed for ${toolName}: ${firstIssue.path}: ${firstIssue.message}`
        : `build preflight failed for ${toolName}`);
    }
  }
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
  endIndex = null,
  resumeMeta = null,
  configPath = null,
}) {
  if (category === "build") {
    runWorkflowBuildPreflight(steps);
  }
  const workflow = existingWorkflow || createWorkflowRun(workspaceRoot, workflowName, { category, configPath });
  return await withLogFile(workflowEventLogPath(workflow.runDir), async () => withEventContext({
    workflow_id: workflow.id,
  }, async () => {
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

  emitEvent("workflow.created", {
    id: workflow.id,
    workflow: workflow.workflow,
    category: workflow.category,
    workspace: workflow.workspace,
    run_dir: path.relative(process.cwd(), workflow.runDir),
    step_count: createdSteps.length,
    steps: createdSteps.map((step) => ({ id: step.id, tool: step.tool, name: step.name })),
  }, { scope: "workflow", workflowId: workflow.id });

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
  const stopIndex = endIndex == null ? createdSteps.length : Math.min(endIndex, createdSteps.length);
  for (let stepIndex = startIndex; stepIndex < stopIndex; stepIndex += 1) {
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
      ? resolveConfiguredStepArgs(spec, { workspaceRoot, stepResults, runDir: workflow.runDir, configPath })
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
    emitConsumedArtifactEvents(workflow, step, resolvedStep.relations);

    const args = (
      ["fetch", "patch", "build", "inspect", "logs", "exec", "stop", "postprocess", "genhtml"].includes(toolCommand)
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

    emitEvent("step.launching", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      argv: args.slice(1),
      log_file: path.relative(process.cwd(), step.logFile),
      run_dir: path.relative(process.cwd(), stepToolRunDir(step.stepDir)),
      command: toolCommand,
      attach,
    }, {
      scope: "step",
      workflowId: workflow.id,
      stepId: step.id,
      tool: step.tool,
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
        ...(configPath ? { MORPHEUS_CONFIG: configPath } : {}),
        MORPHEUS_SCRIPT_LOG_FILE: step.logFile,
        MORPHEUS_EVENT_LOG_FILE: workflowEventLogPath(workflow.runDir),
        MORPHEUS_STEP_ATTACH: attach ? "true" : "false",
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
    emitProducedArtifactEvents(workflow, step, updatedStep.artifacts);
    emitRuntimeEventsFromPayload(workflow, step, toolPayload);
    emitEvent(status === "success" ? "step.completed" : status === "stopped" ? "step.stopped" : "step.failed", {
      workflow: workflow.id,
      step: step.id,
      tool: step.tool,
      status,
      exit_code: exitCode,
      log_file: path.relative(process.cwd(), step.logFile),
      ...(status === "success" ? {} : {
        hint: `./bin/morpheus --json workflow logs --id ${workflow.id} --step ${step.id}`,
      }),
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
      break;
    }

    if (status !== "success") {
      workflowStatus = "error";
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
      emitEvent("step.failed", {
        workflow: workflow.id,
        step: activeStep.id,
        tool: activeStep.tool,
        log_file: path.relative(process.cwd(), activeStep.logFile),
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
  emitEvent(workflowStatus === "success"
    ? "workflow.completed"
    : workflowStatus === "stopped"
      ? "workflow.stopped"
      : "workflow.failed", {
    id: updatedWorkflow.id,
    workflow: updatedWorkflow.workflow,
    status: workflowStatus,
    run_dir: path.relative(process.cwd(), updatedWorkflow.runDir),
    exit_code: workflowStatus === "success" ? 0 : exitCode || 1,
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
      run_dir: relativeToCwd(updatedWorkflow.runDir),
      manifest: relativeToCwd(workflowManifestPath(updatedWorkflow.runDir)),
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
            log_file: relativeToCwd(logFile),
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
    const resolvedStep = resolveConfiguredStepArgs(stepSpec, {
      workspaceRoot,
      stepResults,
      runDir: workflowRecord.runDir,
      configPath: configured.configPath || workflowRecord.configPath || null,
    });
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

function formatWorkflowInspectText(workflow, steps) {
  const lines = [
    `Workflow: ${workflow.workflow || "-"}`,
    `Run ID: ${workflow.id || "-"}`,
    `Status: ${workflow.status || "-"}`,
    `Category: ${workflow.category || "-"}`,
    `Current Step: ${workflow.currentStepId || "-"}`,
    `Created: ${workflow.createdAt || "-"}`,
    `Updated: ${workflow.updatedAt || "-"}`,
    "Steps:",
    "id\tstatus\tname",
    ...steps.map((step) => `${step.id || "-"}\t${step.status || "-"}\t${step.name || "-"}`),
  ];
  return lines.join("\n");
}

function formatWorkflowLifecycleText(payload) {
  const details = payload && payload.details ? payload.details : {};
  const lines = [
    `${payload.summary}`,
    `Run ID: ${details.id || "-"}`,
    `Workflow: ${details.workflow || "-"}`,
    `Status: ${details.status || "-"}`,
  ];
  return lines.join("\n");
}

async function handleWorkflowCommand(argv) {
  const { positionals, flags } = parseWorkflowArgs(argv);
  const subcommand = positionals[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    writeStdoutLine(workflowUsage());
    return 0;
  }

  if (subcommand === "runs") {
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const payload = listManagedWorkflowRuns(workspaceRoot, flags);
    if (flags.json) {
      writeStdoutLine(JSON.stringify(payload, null, 2));
    } else if (payload.details.runs.length === 0) {
      writeStdoutLine("No workflow runs.");
    } else {
      writeStdoutLine([
        "id\tworkflow\tcategory\tstatus\tcreated\tsteps",
        ...payload.details.runs.map((run) => (
          `${run.id}\t${run.workflowName || "-"}\t${run.category}\t${run.status}\t${run.createdAt || "-"}\t${run.stepCount}`
        )),
      ].join("\n"));
    }
    return 0;
  }

  if (subcommand === "list") {
    const payload = listConfiguredWorkflows();
    if (flags.json) {
      writeStdoutLine(JSON.stringify(payload, null, 2));
    } else if (payload.details.workflows.length === 0) {
      writeStdoutLine("No configured workflows.");
    } else {
      writeStdoutLine([
        "name\tcategory\tsteps\tconfig",
        ...payload.details.workflows.map((workflow) => (
          `${workflow.name}\t${workflow.category}\t${workflow.steps}\t${workflow.config || "-"}`
        ))
      ].join("\n"));
    }
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
    const oneStep = Boolean(flags["one-step"]);
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
      endIndex: oneStep ? plan.startIndex + 1 : null,
      resumeMeta: {
        mode: oneStep ? "single-step" : (fromStep ? "from-step" : "resume"),
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
    reconcileStaleWorkflowRun(found);
    const payload = inspectPayloadForRun(workspaceRoot, id);
    if (flags.json) {
      writeStdoutLine(JSON.stringify(payload, null, 2));
    } else {
      const detail = payload.details;
      writeStdoutLine(formatWorkflowInspectText({
        workflow: detail.workflowName,
        id: detail.id,
        status: detail.status,
        category: detail.category,
        currentStepId: null,
        createdAt: detail.createdAt,
        updatedAt: detail.completedAt || detail.createdAt,
      }, detail.steps));
    }
    return 0;
  }

  if (subcommand === "events") {
    const id = flags.id;
    if (!id) {
      throw new Error("workflow events requires --id WORKFLOW_RUN_ID");
    }
    const workspaceRoot = resolveWorkspaceRoot(flags);
    const found = findWorkflowRun(workspaceRoot, id);
    reconcileStaleWorkflowRun(found);
    const payload = eventPayloadForRun(workspaceRoot, id);
    if (flags.json) {
      writeStdoutLine(JSON.stringify(payload, null, 2));
    } else if (payload.details.events.length === 0) {
      writeStdoutLine("No workflow events.");
    } else {
      writeStdoutLine(payload.details.events.map((entry) => JSON.stringify(entry)).join("\n"));
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
    const logFile = resolvePreferredStepLogFile(step) || path.join(step.stepDir, "stdout.log");
    if (!fs.existsSync(logFile)) {
      throw new Error(`missing log file: ${path.relative(process.cwd(), logFile)}`);
    }
    if (flags.follow) {
      if (flags.json) {
        throw new Error("workflow logs does not support --json with --follow");
      }
      if (!flags.step) {
        writeStdoutLine(`Selected step: ${stepId}`);
      }
      return await followLogFile(logFile);
    }
    const content = flags.step
      ? (loadWorkflowStepLogText(workspaceRoot, id, stepId) || "")
      : (loadWorkflowStepLogText(workspaceRoot, id, stepId) || "");
    if (flags.json) {
      writeStdoutLine(JSON.stringify({
        command: "workflow logs",
        status: "success",
        exit_code: 0,
        summary: "printed workflow logs",
        details: { id, step: stepId, log_file: relativeToCwd(logFile), bytes: Buffer.byteLength(content, "utf8") }
      }));
    } else {
      if (!flags.step) {
        writeStdoutLine(`Selected step: ${stepId}`);
      }
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
      writeStdoutLine(formatWorkflowLifecycleText(payload));
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
      writeStdoutLine(formatWorkflowLifecycleText(payload));
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
