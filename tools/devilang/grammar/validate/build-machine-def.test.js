"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMachineDef } = require("./build-machine-def");
const { validateMachine } = require("./validate-machine");

function token(text) {
  return {
    getText() {
      return text;
    },
  };
}

function machineItem({ initial, state, trace, transition }) {
  return {
    initialDecl() {
      if (!initial) {
        return null;
      }
      return {
        ID() {
          return token(initial);
        },
      };
    },
    stateDecl() {
      if (!state) {
        return null;
      }
      return {
        ID() {
          return token(state.name);
        },
        FINAL() {
          return state.final ? token("final") : null;
        },
      };
    },
    traceDecl() {
      if (!trace) {
        return null;
      }
      return {
        ID() {
          return token(trace.name);
        },
      };
    },
    transitionDecl() {
      if (!transition) {
        return null;
      }
      return {
        ID() {
          return [
            token(transition.from),
            token(transition.to),
            token(transition.event),
          ];
        },
      };
    },
  };
}

test("buildMachineDef extracts a minimal machine definition", () => {
  const machineCtx = {
    ID() {
      return token("OrderFlow");
    },
    machineItem() {
      return [
        machineItem({ initial: "Idle" }),
        machineItem({ trace: { name: "submit_trace" } }),
        machineItem({ trace: { name: "success_trace" } }),
        machineItem({ state: { name: "Idle", final: false } }),
        machineItem({ state: { name: "Paying", final: false } }),
        machineItem({ state: { name: "Done", final: true } }),
        machineItem({
          transition: { from: "Idle", to: "Paying", event: "submit_trace" },
        }),
        machineItem({
          transition: { from: "Paying", to: "Done", event: "success_trace" },
        }),
      ];
    },
  };

  assert.deepEqual(buildMachineDef(machineCtx), {
    name: "OrderFlow",
    initialState: "Idle",
    traces: [
      { name: "submit_trace" },
      { name: "success_trace" },
    ],
    states: [
      { name: "Idle", final: false },
      { name: "Paying", final: false },
      { name: "Done", final: true },
    ],
    transitions: [
      { from: "Idle", to: "Paying", event: "submit_trace" },
      { from: "Paying", to: "Done", event: "success_trace" },
    ],
  });
});

test("buildMachineDef output feeds validateMachine", () => {
  const machineCtx = {
    ID() {
      return token("OrderFlow");
    },
    machineItem() {
      return [
        machineItem({ initial: "Idle" }),
        machineItem({ trace: { name: "submit_trace" } }),
        machineItem({ state: { name: "Idle", final: false } }),
        machineItem({ state: { name: "Done", final: true } }),
        machineItem({
          transition: { from: "Idle", to: "Paying", event: "submit_trace" },
        }),
      ];
    },
  };

  const def = buildMachineDef(machineCtx);
  const result = validateMachine(def);

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "transitions[0].to",
      message: "transition target state 'Paying' is not declared",
    },
  ]);
});
