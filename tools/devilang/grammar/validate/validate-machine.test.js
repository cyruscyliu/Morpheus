"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateMachine } = require("./validate-machine");

test("validateMachine accepts a minimal machine", () => {
  const result = validateMachine({
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

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("validateMachine rejects undeclared transition targets", () => {
  const result = validateMachine({
    name: "OrderFlow",
    initialState: "Idle",
    traces: [
      { name: "submit_trace" },
      { name: "success_trace" },
    ],
    states: [
      { name: "Idle", final: false },
      { name: "Done", final: true },
    ],
    transitions: [
      { from: "Idle", to: "Paying", event: "submit_trace" },
      { from: "Paying", to: "Done", event: "success_trace" },
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "transitions[0].to",
      message: "transition target state 'Paying' is not declared",
    },
    {
      path: "transitions[1].from",
      message: "transition source state 'Paying' is not declared",
    },
  ]);
});

test("validateMachine rejects duplicate state names and missing initial state", () => {
  const result = validateMachine({
    name: "OrderFlow",
    initialState: "Missing",
    traces: [{ name: "noop_trace" }],
    states: [
      { name: "Idle", final: false },
      { name: "Idle", final: true },
    ],
    transitions: [],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "states[1].name",
      message: "duplicate state 'Idle'",
    },
    {
      path: "initialState",
      message: "initial state 'Missing' is not declared",
    },
  ]);
});

test("validateMachine rejects undeclared transition traces", () => {
  const result = validateMachine({
    name: "OrderFlow",
    initialState: "Idle",
    traces: [{ name: "submit_trace" }],
    states: [
      { name: "Idle", final: false },
      { name: "Done", final: true },
    ],
    transitions: [
      { from: "Idle", to: "Done", event: "success_trace" },
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "transitions[0].event",
      message: "transition trace 'success_trace' is not declared",
    },
  ]);
});
