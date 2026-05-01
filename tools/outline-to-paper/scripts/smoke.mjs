import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const entry = path.join(repoRoot, "tools", "outline-to-paper", "index.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-smoke-"));
const workspace = path.join(root, "workspace");
const runDir = path.join(root, "managed-run", "runs", "outline-to-paper-exec", "steps", "outline-to-paper-exec");
const outline = path.join(root, "outline.json");

fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, "step.json"), JSON.stringify({
  id: "outline-to-paper-exec",
  name: "outline-to-paper-exec",
  tool: "outline-to-paper",
  status: "running",
  stepDir: runDir,
  toolRunDir: runDir,
  logFile: path.join(runDir, "stdout.log"),
}, null, 2));
fs.writeFileSync(outline, JSON.stringify({
  title: "Smoke Paper",
  sections: [
    {
      section_id: "sec-1",
      title: "Smoke Section",
      paragraphs: [
        {
          paragraph_id: "p-1",
          role: "argument",
          arguments: [
            {
              argument_id: "c1",
              type: "claim",
              text: "Smoke claim",
              supports: [],
            },
          ],
        },
      ],
    },
  ],
}));

const result = spawnSync(process.execPath, [entry, "run", "--json", "--workspace", workspace, "--outline", outline], {
  encoding: "utf8",
  cwd: runDir,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const payload = JSON.parse(result.stdout);
if (!payload.details || !payload.details.manifest) {
  throw new Error("missing manifest from outline-to-paper smoke run");
}
if (fs.existsSync(path.join(workspace, "outline-versions"))) {
  throw new Error("workspace-level outline-versions should not be created");
}

process.stdout.write("outline-to-paper smoke ok\n");
