import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("runs viewer workflow action routes forward config selection", () => {
  const actionsTs = fs.readFileSync(path.join(appRoot, "src", "server", "actions.ts"), "utf8");
  const removeRouteTs = fs.readFileSync(path.join(appRoot, "app", "api", "runs", "[runId]", "remove", "route.ts"), "utf8");
  const stopRouteTs = fs.readFileSync(path.join(appRoot, "app", "api", "runs", "[runId]", "stop", "route.ts"), "utf8");
  const resumeRouteTs = fs.readFileSync(path.join(appRoot, "app", "api", "runs", "[runId]", "resume", "route.ts"), "utf8");

  assert.match(actionsTs, /export function stopWorkflowRun\(runId: string, selectedConfigPath\?: string \| null\)/);
  assert.match(actionsTs, /export function removeWorkflowRun\(runId: string, selectedConfigPath\?: string \| null\)/);
  assert.match(actionsTs, /resolveViewerContext\(selectedConfigPath\)/);
  assert.match(removeRouteTs, /removeWorkflowRun\(runId, url\.searchParams\.get\("config"\)\)/);
  assert.match(stopRouteTs, /stopWorkflowRun\(runId, url\.searchParams\.get\("config"\)\)/);
  assert.match(resumeRouteTs, /resumeWorkflowRun\(runId, fromStep, url\.searchParams\.get\("config"\)\)/);
});
