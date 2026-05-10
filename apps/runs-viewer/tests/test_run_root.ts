import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { discoverViewerConfigs, findRunRoot } from "../src/server/run-root.js";

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return String(result.stdout || "").trim();
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
  const workspaceDir = path.join(repoRoot, "projects", "o2p", "workspace");
  const configPath = path.join(repoRoot, "projects", "o2p", "morpheus.yaml");

  writeFile(
    configPath,
    ["workspace:", "  root: ./workspace", ""].join("\n"),
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

test("discoverViewerConfigs lists git worktree Morpheus configs", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-runs-viewer-"));
  const repoRoot = path.join(baseDir, "repo");
  const startDir = path.join(repoRoot, "apps", "runs-viewer");
  const worktreeA = path.join(baseDir, "outline-to-paper");
  const worktreeB = path.join(baseDir, "libafl-qemu-vm-fuzzing");
  const worktreeC = path.join(baseDir, "plan-nvirsh-nested-virtualization");

  fs.mkdirSync(repoRoot, { recursive: true });
  runGit(["init"], repoRoot);
  runGit(["config", "user.email", "test@example.com"], repoRoot);
  runGit(["config", "user.name", "Test User"], repoRoot);

  writeFile(
    path.join(repoRoot, "morpheus.yaml"),
    ["workspace:", "  root: ./workspace", ""].join("\n"),
  );
  writeFile(
    path.join(repoRoot, "projects", "hyperarm", "morpheus.yaml"),
    ["workspace:", "  root: ./projects/hyperarm/workspace", ""].join("\n"),
  );
  writeFile(
    path.join(repoRoot, "projects", "o2p", "morpheus.yaml"),
    ["workspace:", "  root: ./projects/o2p/workspace", ""].join("\n"),
  );
  writeFile(path.join(repoRoot, "README.md"), "test\n");
  runGit(["add", "."], repoRoot);
  runGit(["commit", "-m", "init"], repoRoot);

  const rootBranch = runGit(["branch", "--show-current"], repoRoot);
  runGit(["worktree", "add", "-b", "outline-to-paper", worktreeA], repoRoot);
  runGit(["worktree", "add", "-b", "libafl-qemu-vm-fuzzing", worktreeB], repoRoot);
  runGit(["worktree", "add", "-b", "plan-nvirsh-nested-virtualization", worktreeC], repoRoot);

  const configs = discoverViewerConfigs({ startDir, repoRoot });
  const labels = configs.map((item) => item.label).sort();

  assert.deepEqual(labels, [
    `${rootBranch}:morpheus.yaml`,
    `${rootBranch}:projects/hyperarm/morpheus.yaml`,
    `${rootBranch}:projects/o2p/morpheus.yaml`,
    "libafl-qemu-vm-fuzzing:morpheus.yaml",
    "libafl-qemu-vm-fuzzing:projects/hyperarm/morpheus.yaml",
    "libafl-qemu-vm-fuzzing:projects/o2p/morpheus.yaml",
    "outline-to-paper:morpheus.yaml",
    "outline-to-paper:projects/hyperarm/morpheus.yaml",
    "outline-to-paper:projects/o2p/morpheus.yaml",
    "plan-nvirsh-nested-virtualization:morpheus.yaml",
    "plan-nvirsh-nested-virtualization:projects/hyperarm/morpheus.yaml",
    "plan-nvirsh-nested-virtualization:projects/o2p/morpheus.yaml",
  ].sort());
  assert.deepEqual(
    configs.map((item) => item.configPath).sort(),
    [
      path.join(repoRoot, "morpheus.yaml"),
      path.join(repoRoot, "projects", "hyperarm", "morpheus.yaml"),
      path.join(repoRoot, "projects", "o2p", "morpheus.yaml"),
      path.join(worktreeA, "morpheus.yaml"),
      path.join(worktreeA, "projects", "hyperarm", "morpheus.yaml"),
      path.join(worktreeA, "projects", "o2p", "morpheus.yaml"),
      path.join(worktreeB, "morpheus.yaml"),
      path.join(worktreeB, "projects", "hyperarm", "morpheus.yaml"),
      path.join(worktreeB, "projects", "o2p", "morpheus.yaml"),
      path.join(worktreeC, "morpheus.yaml"),
      path.join(worktreeC, "projects", "hyperarm", "morpheus.yaml"),
      path.join(worktreeC, "projects", "o2p", "morpheus.yaml"),
    ].sort(),
  );
});
