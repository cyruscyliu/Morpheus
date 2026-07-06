"use strict";

function textOf(node) {
  if (!node || typeof node.getText !== "function") {
    return "";
  }
  return String(node.getText());
}

function childText(node, methodName) {
  if (!node || typeof node[methodName] !== "function") {
    return "";
  }
  return textOf(node[methodName]());
}

function buildStateDef(stateDeclCtx) {
  return {
    name: childText(stateDeclCtx, "ID"),
    final: typeof stateDeclCtx?.FINAL === "function" && Boolean(stateDeclCtx.FINAL()),
  };
}

function buildTransitionDef(transitionDeclCtx) {
  const ids = typeof transitionDeclCtx?.ID === "function" ? transitionDeclCtx.ID() : [];
  return {
    from: textOf(ids[0]),
    to: textOf(ids[1]),
    event: textOf(ids[2]),
  };
}

function buildTraceDef(traceDeclCtx) {
  return {
    name: childText(traceDeclCtx, "ID"),
  };
}

function buildMachineDef(machineCtx) {
  if (!machineCtx || typeof machineCtx !== "object") {
    throw new TypeError("machine parse tree context is required");
  }

  if (typeof machineCtx.ID !== "function") {
    throw new TypeError("machine context must provide ID()");
  }

  const items =
    typeof machineCtx.machineItem === "function" ? machineCtx.machineItem() || [] : [];

  const def = {
    name: childText(machineCtx, "ID"),
    initialState: "",
    states: [],
    traces: [],
    transitions: [],
  };

  for (const item of items) {
    if (item && typeof item.initialDecl === "function" && item.initialDecl()) {
      def.initialState = childText(item.initialDecl(), "ID");
      continue;
    }

    if (item && typeof item.stateDecl === "function" && item.stateDecl()) {
      def.states.push(buildStateDef(item.stateDecl()));
      continue;
    }

    if (item && typeof item.traceDecl === "function" && item.traceDecl()) {
      def.traces.push(buildTraceDef(item.traceDecl()));
      continue;
    }

    if (item && typeof item.transitionDecl === "function" && item.transitionDecl()) {
      def.transitions.push(buildTransitionDef(item.transitionDecl()));
    }
  }

  return def;
}

module.exports = {
  buildMachineDef,
};
