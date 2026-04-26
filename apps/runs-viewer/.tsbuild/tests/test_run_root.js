import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findRunRoot } from "../src/server/run-root.js";
function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}
test("findRunRoot resolves workspace.root relative to morpheus.yaml", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-viewer-"));
    const repoRoot = path.join(baseDir, "repo");
    const projectDir = path.join(repoRoot, "apps", "runs-viewer");
    const startDir = path.join(projectDir, "nested");
    const workspaceDir = path.join(repoRoot, "my-workspace");
    writeFile(path.join(repoRoot, "morpheus.yaml"), ["workspace:", "  root: my-workspace", ""].join("\n"));
    const resolved = findRunRoot({ startDir, repoRoot });
    assert.equal(resolved.configPath, path.join(repoRoot, "morpheus.yaml"));
    assert.equal(resolved.workspaceRoot, workspaceDir);
    assert.equal(resolved.runRoot, path.join(workspaceDir, "runs"));
});
test("findRunRoot falls back to hyperarm-workspace when config missing", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-viewer-"));
    const repoRoot = path.join(baseDir, "repo");
    const startDir = path.join(repoRoot, "apps", "runs-viewer");
    const resolved = findRunRoot({ startDir, repoRoot });
    assert.equal(resolved.configPath, null);
    assert.equal(resolved.workspaceRoot, path.join(repoRoot, "hyperarm-workspace"));
    assert.equal(resolved.runRoot, path.join(repoRoot, "hyperarm-workspace", "runs"));
});
