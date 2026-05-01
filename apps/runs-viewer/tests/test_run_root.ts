import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findRunRoot } from "../src/server/run-root.js";

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("findRunRoot resolves workspace.root relative to morpheus.yaml", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-viewer-"));
  const repoRoot = path.join(baseDir, "repo");
  const projectDir = path.join(repoRoot, "apps", "runs-viewer");
  const startDir = path.join(projectDir, "nested");
  const workspaceDir = path.join(repoRoot, "my-workspace");

  writeFile(
    path.join(repoRoot, "morpheus.yaml"),
    ["workspace:", "  root: my-workspace", ""].join("\n"),
  );

  const resolved = findRunRoot({ startDir, repoRoot });
  assert.equal(resolved.configPath, path.join(repoRoot, "morpheus.yaml"));
  assert.equal(resolved.workspaceRoot, workspaceDir);
  assert.equal(resolved.runRoot, path.join(workspaceDir, "runs"));
});

test("findRunRoot requires workspace.root when config is missing", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-viewer-"));
  const repoRoot = path.join(baseDir, "repo");
  const startDir = path.join(repoRoot, "apps", "runs-viewer");

  assert.throws(
    () => findRunRoot({ startDir, repoRoot }),
    /workspace\.root must be configured in Morpheus config/,
  );
});

test("findRunRoot honors MORPHEUS_CONFIG for nonstandard config filenames", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-viewer-"));
  const repoRoot = path.join(baseDir, "repo");
  const startDir = path.join(repoRoot, "apps", "runs-viewer");
  const workspaceDir = path.join(repoRoot, "my-o2p-workspace");
  const configPath = path.join(repoRoot, "morpheus.o2p.yaml");

  writeFile(
    configPath,
    ["workspace:", "  root: my-o2p-workspace", ""].join("\n"),
  );

  const previous = process.env.MORPHEUS_CONFIG;
  process.env.MORPHEUS_CONFIG = configPath;
  try {
    const resolved = findRunRoot({ startDir, repoRoot });
    assert.equal(resolved.configPath, configPath);
    assert.equal(resolved.workspaceRoot, workspaceDir);
    assert.equal(resolved.runRoot, path.join(workspaceDir, "runs"));
  } finally {
    if (previous == null) {
      delete process.env.MORPHEUS_CONFIG;
    } else {
      process.env.MORPHEUS_CONFIG = previous;
    }
  }
});
