import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("Workflow Viewer copy and stable rail contract are present", () => {
  const indexHtml = fs.readFileSync(path.join(appRoot, "src", "index.html"), "utf8");
  const mainTs = fs.readFileSync(path.join(appRoot, "src", "main.ts"), "utf8");
  const stylesCss = fs.readFileSync(path.join(appRoot, "src", "styles.css"), "utf8");

  assert.match(indexHtml, /Morpheus Workflow Viewer/);
  assert.match(indexHtml, />Workflow Viewer</);
  assert.match(indexHtml, /id="runs-summary" class="pane-title">0 \/ 0</);
  assert.match(indexHtml, />Workflow</);
  assert.match(indexHtml, />Step Log</);

  assert.match(mainTs, /`\$\{filtered\.length\} \/ \$\{total\}`/);
  assert.match(mainTs, /Select a workflow/);
  assert.match(mainTs, /category-pill/);
  assert.match(mainTs, /stop-workflow/);
  assert.match(mainTs, /remove-workflow/);

  assert.match(stylesCss, /\.workspace-main\.runs-pane-collapsed \{/);
  assert.match(stylesCss, /56px/);
  assert.doesNotMatch(stylesCss, /\.workspace-main\.runs-pane-collapsed \.list-pane \{\s*display: none;/);
});
