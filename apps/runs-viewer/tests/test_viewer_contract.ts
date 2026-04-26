import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Workflow Viewer uses Next.js app routes and shadcn/ui shell", () => {
  const pageTsx = fs.readFileSync(path.join(appRoot, "app", "page.tsx"), "utf8");
  const layoutTsx = fs.readFileSync(path.join(appRoot, "app", "layout.tsx"), "utf8");
  const viewerTsx = fs.readFileSync(path.join(appRoot, "components", "workflow-viewer.tsx"), "utf8");
  const buttonTsx = fs.readFileSync(path.join(appRoot, "components", "ui", "button.tsx"), "utf8");
  const globalsCss = fs.readFileSync(path.join(appRoot, "app", "globals.css"), "utf8");
  const packageJson = fs.readFileSync(path.join(appRoot, "package.json"), "utf8");

  assert.match(layoutTsx, /Morpheus Workflow Viewer/);
  assert.match(pageTsx, /WorkflowViewer/);

  assert.match(viewerTsx, /EventSource/);
  assert.match(viewerTsx, /workflow-table/);
  assert.match(viewerTsx, /loadWorkflowLog/);
  assert.match(viewerTsx, /Refresh/);
  assert.match(viewerTsx, /Loading log/);
  assert.match(viewerTsx, /EventSource/);

  assert.match(buttonTsx, /class-variance-authority/);
  assert.match(packageJson, /"next"/);
  assert.match(packageJson, /"react"/);
  assert.match(packageJson, /"tailwindcss"/);
  assert.match(globalsCss, /\.workflow-table-shell/);
  assert.match(globalsCss, /\.workflow-log-shell/);
  assert.match(globalsCss, /\.workflow-table/);
});
