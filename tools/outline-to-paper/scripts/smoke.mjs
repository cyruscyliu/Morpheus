import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const entry = path.join(repoRoot, "tools", "outline-to-paper", "index.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "outline-to-paper-smoke-"));
const workspace = path.join(root, "workspace");
const runDir = path.join(root, "managed-run");
const outline = path.join(root, "outline.json");

fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(outline, JSON.stringify({
  title: "Smoke Paper",
  claims: [{ claim_id: "c1", text: "claim" }],
  supports: [],
}));

const result = spawnSync(process.execPath, [entry, "run", "--json", "--workspace", workspace, "--outline", outline], {
  encoding: "utf8",
  cwd: repoRoot,
  env: {
    ...process.env,
    MORPHEUS_RUN_DIR_OVERRIDE: runDir,
  },
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const payload = JSON.parse(result.stdout);
if (!payload.details || !payload.details.manifest) {
  throw new Error("missing manifest from outline-to-paper smoke run");
}

process.stdout.write("outline-to-paper smoke ok\n");
