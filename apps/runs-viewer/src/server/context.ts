import path from "node:path";

import { findRunRoot } from "./run-root";

export interface ViewerContext {
  repoRoot: string;
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
}

export function resolveViewerContext(): ViewerContext {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const runRootInfo = findRunRoot({ startDir: process.cwd(), repoRoot });
  return {
    repoRoot,
    runRoot: runRootInfo.runRoot,
    workspaceRoot: runRootInfo.workspaceRoot,
    configPath: runRootInfo.configPath,
  };
}
