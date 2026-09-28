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
//       <flag>+: <value>           # append "<flag> <value>" to the step args
//         (a list appends one pair per element; a null value appends the
//         bare flag without a value)
//       <flag>-: true              # remove every bare "<flag>" occurrence
//       <flag>-: <value>           # remove every "<flag> <value>" pair
//       <flag>-:                   # remove pairs whose value is listed
//         <current>: true
//       step-fields:               # set step fields (not args), e.g.
//         timeout-seconds: 4500
//
// A workflow-templates entry may carry its own overrides; they are applied
// to every consuming workflow before the workflow's own overrides, so the
// workflow values win.
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

// Append "<flag> <value>" pairs to a step's args. A null value appends
// the bare flag without a value; a list appends one pair per element.
function appendStepArgs(step, flag, spec) {
  const values = Array.isArray(spec) ? spec : [spec];
  for (const value of values) {
    if (value === null || value === undefined) {
      step.args.push(flag);
    } else {
      step.args.push(flag, value);
    }
  }
}

// Remove flag occurrences from a step's args. spec === true removes bare
// flags; a scalar removes "<flag> <value>" pairs whose value matches; a
// map removes pairs whose value is one of its keys. Returns the removed
// pair count.
function removeStepArgs(step, flag, spec) {
  const args = Array.isArray(step.args) ? step.args : [];
  const kept = [];
  let removed = 0;
  for (let index = 0; index < args.length; index += 1) {
    if (String(args[index]) !== flag) {
      kept.push(args[index]);
      continue;
    }
    if (spec === true) {
      removed += 1;
      continue;
    }
    const value = args[index + 1];
    const match = isPlainObject(spec)
      ? value !== undefined && Object.prototype.hasOwnProperty.call(spec, String(value))
      : value !== undefined && String(value) === String(spec);
    if (match) {
      index += 1;
      removed += 1;
      continue;
    }
    kept.push(args[index]);
  }
  step.args = kept;
  return removed;
}

function applyStageFlagOverrides(stage, flagMap, unmatched) {
  const steps = Array.isArray(stage.steps) ? stage.steps : [];
  for (const [flagKey, spec] of Object.entries(flagMap)) {
    if (flagKey === "step-fields") {
      if (!isPlainObject(spec)) {
        unmatched.push(`${stage.id || "?"}.step-fields`);
        continue;
      }
      for (const step of steps) {
        if (!step || typeof step !== "object") {
          continue;
        }
        for (const [field, value] of Object.entries(spec)) {
          step[field] = value;
        }
      }
      continue;
    }
    if (flagKey.endsWith("+") || flagKey.endsWith("-")) {
      const suffix = flagKey.slice(-1);
      const flag = normalizeFlagKey(flagKey.slice(0, -1));
      if (!flag) {
        unmatched.push(`${stage.id || "?"}.<empty-flag>`);
        continue;
      }
      let count = 0;
      for (const step of steps) {
        if (!step || typeof step !== "object" || !Array.isArray(step.args)) {
          continue;
        }
        if (suffix === "+") {
          appendStepArgs(step, flag, spec);
          count += 1;
        } else {
          count += removeStepArgs(step, flag, spec);
        }
      }
      if (count === 0) {
        unmatched.push(`${stage.id || "?"}.${flag}${suffix}`);
      }
      continue;
    }
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

function stageTemplates(configValue) {
  return configValue && isPlainObject(configValue["stage-templates"])
    ? configValue["stage-templates"]
    : {};
}

// Expand a stage-level "stage-template: <name>" reference into the named
// stage template's record. The workflow's own stage id is preserved so
// template merges and overrides keep addressing the stage. The mechanism
// is tool-agnostic: any stage can reference any named stage record.
function expandStageTemplates(configValue, stages, workflowName) {
  if (!Array.isArray(stages)) {
    return stages;
  }
  return stages.map((stage) => {
    if (!stage || typeof stage !== "object") {
      return stage;
    }
    const templateName = stage["stage-template"];
    if (!templateName) {
      return stage;
    }
    const template = stageTemplates(configValue)[String(templateName)];
    if (!isPlainObject(template)) {
      throw new Error(`stage template not found: ${templateName} (workflow ${workflowName || "-"})`);
    }
    const { "stage-template": _template, ...stageRest } = stage;
    return {
      ...cloneStages([template])[0],
      id: stage.id || template.id,
      ...stageRest,
    };
  });
}

function resolveWorkflowTemplateRecord(configValue, name) {
  const workflows = configValue && isPlainObject(configValue.workflows) ? configValue.workflows : {};
  const workflow = workflows[name];
  if (!isPlainObject(workflow)) {
    return null;
  }
  const templateName = workflow.template;
  if (!templateName) {
    const record = { ...workflow };
    const stages = expandStageTemplates(configValue, workflowStages(record), name);
    record.stages = applyWorkflowOverrides(stages, record.overrides, name);
    return record;
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
  record.stages = expandStageTemplates(configValue, record.stages, name);
  if (isPlainObject(template.overrides)) {
    record.stages = applyWorkflowOverrides(record.stages, template.overrides, name);
  }
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
