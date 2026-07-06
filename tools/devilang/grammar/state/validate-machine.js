"use strict";

function issue(path, message) {
  return { path, message };
}

function normalizeInitialState(def) {
  if (typeof def?.initialState === "string") {
    return def.initialState;
  }
  if (typeof def?.initial === "string") {
    return def.initial;
  }
  return "";
}

function validateMachine(def) {
  const issues = [];

  if (!def || typeof def !== "object" || Array.isArray(def)) {
    return {
      ok: false,
      issues: [issue("machine", "machine definition must be an object")],
    };
  }

  if (typeof def.name !== "string" || def.name.trim() === "") {
    issues.push(issue("name", "machine name is required"));
  }

  const initialState = normalizeInitialState(def).trim();
  if (!initialState) {
    issues.push(issue("initialState", "initial state is required"));
  }

  const rawStates = Array.isArray(def.states) ? def.states : null;
  if (!rawStates) {
    issues.push(issue("states", "states must be an array"));
  }

  const rawTraces = Array.isArray(def.traces) ? def.traces : null;
  if (!rawTraces) {
    issues.push(issue("traces", "traces must be an array"));
  }

  const rawTransitions = Array.isArray(def.transitions) ? def.transitions : null;
  if (!rawTransitions) {
    issues.push(issue("transitions", "transitions must be an array"));
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const stateNames = new Set();
  const traceNames = new Set();
  for (let index = 0; index < rawStates.length; index += 1) {
    const state = rawStates[index];
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      issues.push(issue(`states[${index}]`, "state must be an object"));
      continue;
    }

    const name = typeof state.name === "string" ? state.name.trim() : "";
    if (!name) {
      issues.push(issue(`states[${index}].name`, "state name is required"));
      continue;
    }

    if (stateNames.has(name)) {
      issues.push(issue(`states[${index}].name`, `duplicate state '${name}'`));
      continue;
    }

    stateNames.add(name);
  }

  for (let index = 0; index < rawTraces.length; index += 1) {
    const trace = rawTraces[index];
    if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
      issues.push(issue(`traces[${index}]`, "trace must be an object"));
      continue;
    }

    const name = typeof trace.name === "string" ? trace.name.trim() : "";
    if (!name) {
      issues.push(issue(`traces[${index}].name`, "trace name is required"));
      continue;
    }

    if (traceNames.has(name)) {
      issues.push(issue(`traces[${index}].name`, `duplicate trace '${name}'`));
      continue;
    }

    traceNames.add(name);
  }

  if (initialState && !stateNames.has(initialState)) {
    issues.push(
      issue(
        "initialState",
        `initial state '${initialState}' is not declared`,
      ),
    );
  }

  for (let index = 0; index < rawTransitions.length; index += 1) {
    const transition = rawTransitions[index];
    const basePath = `transitions[${index}]`;

    if (!transition || typeof transition !== "object" || Array.isArray(transition)) {
      issues.push(issue(basePath, "transition must be an object"));
      continue;
    }

    const from = typeof transition.from === "string" ? transition.from.trim() : "";
    const to = typeof transition.to === "string" ? transition.to.trim() : "";
    const event = typeof transition.event === "string" ? transition.event.trim() : "";

    if (!from) {
      issues.push(issue(`${basePath}.from`, "transition source state is required"));
    } else if (!stateNames.has(from)) {
      issues.push(
        issue(`${basePath}.from`, `transition source state '${from}' is not declared`),
      );
    }

    if (!to) {
      issues.push(issue(`${basePath}.to`, "transition target state is required"));
    } else if (!stateNames.has(to)) {
      issues.push(
        issue(`${basePath}.to`, `transition target state '${to}' is not declared`),
      );
    }

    if (!event) {
      issues.push(issue(`${basePath}.event`, "transition trace is required"));
    } else if (!traceNames.has(event)) {
      issues.push(
        issue(`${basePath}.event`, `transition trace '${event}' is not declared`),
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

module.exports = {
  validateMachine,
};
