// @ts-nocheck
// Workflow template and override resolution for morpheus.yaml.
//
// A workflow may declare:
//   template: <workflow-templates entry name>
//   overrides:
//     <stage-id>:                  # or dotted "<stage-id>.<flag>" keys
//       <flag>: <value>            # replace the value after every <flag>
//       <flag>:                    # replace only the matching current value
//         <current>: <replacement>
//
// Template merge: the workflow record wins over the template record. A
// workflow stage with the same id replaces the template stage in place;
// template-only stages keep their order and workflow-only stages append.

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneStages(stages) {
  return JSON.parse(JSON.stringify(Array.isArray(stages) ? stages : []));
}

function workflowStages(record) {
  return Array.isArray(record && record.stages) ? record.stages : [];
}

function normalizeFlagKey(flag) {
  const value = String(flag || "").trim();
  if (!value) {
    return null;
  }
  return value.startsWith("--") ? value : `--${value}`;
}

function mergeTemplateStages(templateStages, workflowStageList) {
  const merged = cloneStages(templateStages);
  for (const stage of workflowStageList) {
    const id = stage && typeof stage === "object" ? String(stage.id || "") : "";
    const index = merged.findIndex(
      (entry) => entry && typeof entry === "object" && String(entry.id || "") === id,
    );
    if (index >= 0) {
      merged[index] = stage;
    } else {
      merged.push(stage);
    }
  }
  return merged;
}

function applyStageFlagOverrides(stage, flagMap, unmatched) {
  const steps = Array.isArray(stage.steps) ? stage.steps : [];
  for (const [flagKey, spec] of Object.entries(flagMap)) {
    const flag = normalizeFlagKey(flagKey);
    if (!flag) {
      unmatched.push(`${stage.id || "?"}.<empty-flag>`);
      continue;
    }
    let applied = 0;
    for (const step of steps) {
      if (!step || typeof step !== "object" || !Array.isArray(step.args)) {
        continue;
      }
      const args = step.args;
      for (let index = 0; index < args.length; index += 1) {
        if (String(args[index]) !== flag || index + 1 >= args.length) {
          continue;
        }
        const current = args[index + 1];
        const replacement = isPlainObject(spec)
          ? (Object.prototype.hasOwnProperty.call(spec, String(current)) ? spec[String(current)] : undefined)
          : spec;
        if (replacement === undefined || replacement === null) {
          continue;
        }
        args[index + 1] = replacement;
        applied += 1;
      }
    }
    if (applied === 0) {
      unmatched.push(`${stage.id || "?"}.${flag}`);
    }
  }
  return stage;
}

function applyWorkflowOverrides(stages, overrides, workflowName) {
  if (!isPlainObject(overrides)) {
    return stages;
  }
  const resolved = stages.map((stage) => (stage && typeof stage === "object" ? { ...stage } : stage));
  const unmatched = [];
  for (const [key, spec] of Object.entries(overrides)) {
    const dot = key.indexOf(".");
    let stageId = key;
    let flagKey = null;
    if (dot > 0) {
      stageId = key.slice(0, dot);
      flagKey = key.slice(dot + 1);
    }
    const stage = resolved.find((entry) => entry && typeof entry === "object" && String(entry.id || "") === stageId);
    if (!stage) {
      throw new Error(`workflow override stage not found: ${stageId} (workflow ${workflowName || "-"})`);
    }
    let flagMap;
    if (flagKey != null) {
      flagMap = { [flagKey]: spec };
    } else if (isPlainObject(spec)) {
      flagMap = spec;
    } else {
      throw new Error(`workflow override for stage ${stageId} must be a map of flags (workflow ${workflowName || "-"})`);
    }
    applyStageFlagOverrides(stage, flagMap, unmatched);
  }
  if (unmatched.length > 0) {
    throw new Error(`workflow override flag matched no step argument: ${unmatched.join(", ")} (workflow ${workflowName || "-"})`);
  }
  return resolved;
}

function workflowTemplates(configValue) {
  return configValue && isPlainObject(configValue["workflow-templates"])
    ? configValue["workflow-templates"]
    : {};
}

function resolveWorkflowTemplateRecord(configValue, name) {
  const workflows = configValue && isPlainObject(configValue.workflows) ? configValue.workflows : {};
  const workflow = workflows[name];
  if (!isPlainObject(workflow)) {
    return null;
  }
  const templateName = workflow.template;
  if (!templateName) {
    return { ...workflow };
  }
  const template = workflowTemplates(configValue)[String(templateName)];
  if (!isPlainObject(template)) {
    throw new Error(`workflow template not found: ${templateName} (workflow ${name})`);
  }
  const { template: _template, overrides, ...workflowRest } = workflow;
  const mergedStages = isPlainObject(workflowRest) && Array.isArray(workflowRest.stages)
    ? mergeTemplateStages(workflowStages(template), workflowStages(workflowRest))
    : cloneStages(workflowStages(template));
  const { stages: _templateStages, ...templateRest } = template;
  const record = { ...templateRest, ...workflowRest, stages: mergedStages };
  record.stages = applyWorkflowOverrides(record.stages, overrides, name);
  return record;
}

function workflowTemplateIssues(configValue) {
  const issues = [];
  const workflows = configValue && isPlainObject(configValue.workflows) ? configValue.workflows : {};
  for (const [name, workflow] of Object.entries(workflows)) {
    if (!isPlainObject(workflow)) {
      continue;
    }
    const templates = workflowTemplates(configValue);
    if (workflow.template && !isPlainObject(templates[String(workflow.template)])) {
      issues.push({
        level: "error",
        path: `workflows.${name}.template`,
        message: `workflow template not found: ${workflow.template}`,
      });
      continue;
    }
    try {
      resolveWorkflowTemplateRecord(configValue, name);
    } catch (error) {
      issues.push({
        level: "error",
        path: `workflows.${name}.overrides`,
        message: String(error && error.message ? error.message : error),
      });
    }
  }
  return issues;
}

module.exports = {
  applyWorkflowOverrides,
  resolveWorkflowTemplateRecord,
  workflowTemplateIssues,
};
