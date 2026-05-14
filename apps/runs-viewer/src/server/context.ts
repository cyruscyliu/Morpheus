import path from "node:path";
import fs from "node:fs";

import {
  type ViewerConfigOption,
  type ViewerWorkflowOption,
} from "./run-root";
import { listConfiguredWorkflows, listViewerConfigs, loadConfigContext } from "./morpheus-client";

export interface ViewerContext {
  repoRoot: string;
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
  configLabel: string;
  availableConfigs: ViewerConfigOption[];
  availableWorkflows: ViewerWorkflowOption[];
}

export interface ViewerReadContext {
  repoRoot: string;
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
}

const repoRootCache = new Map<string, string>();
const readContextCache = new Map<string, ViewerReadContext>();
const viewerContextCache = new Map<string, ViewerContext>();

function resolveRepoRoot(startDir: string): string {
  const cached = repoRootCache.get(startDir);
  if (cached) {
    return cached;
  }
  let current = path.resolve(startDir);
  while (true) {
    const pnpmLock = path.join(current, "pnpm-lock.yaml");
    const morpheusApp = path.join(current, "apps", "morpheus");
    const runsViewerApp = path.join(current, "apps", "runs-viewer");
    if (fs.existsSync(pnpmLock) && fs.existsSync(morpheusApp) && fs.existsSync(runsViewerApp)) {
      repoRootCache.set(startDir, current);
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      const fallback = path.resolve(startDir, "..", "..");
      repoRootCache.set(startDir, fallback);
      return fallback;
    }
    current = parent;
  }
}

export function resolveReadContext(selectedConfigPath?: string | null): ViewerReadContext {
  const repoRoot = resolveRepoRoot(process.cwd());
  const cacheId = JSON.stringify({ repoRoot, selectedConfigPath: selectedConfigPath || null });
  const cached = readContextCache.get(cacheId);
  if (cached) {
    return cached;
  }
  const bootstrapContext = {
    repoRoot,
    configPath: selectedConfigPath || null,
    workspaceRoot: process.cwd(),
  };
  const initialConfigInfo = loadConfigContext(bootstrapContext);
  const resolved = {
    repoRoot,
    runRoot: initialConfigInfo.runRoot,
    configPath: initialConfigInfo.configPath,
    workspaceRoot: initialConfigInfo.workspaceRoot,
  };
  readContextCache.set(cacheId, resolved);
  return resolved;
}

export function resolveViewerContext(selectedConfigPath?: string | null): ViewerContext {
  const initialContext = resolveReadContext(selectedConfigPath);
  const cacheId = JSON.stringify({
    repoRoot: initialContext.repoRoot,
    configPath: initialContext.configPath || null,
    workspaceRoot: initialContext.workspaceRoot,
  });
  const cached = viewerContextCache.get(cacheId);
  if (cached) {
    return cached;
  }
  const availableConfigs = listViewerConfigs(initialContext);
  const requested = selectedConfigPath
    ? availableConfigs.find((item) => item.configPath === selectedConfigPath)?.configPath || selectedConfigPath
    : availableConfigs[0]?.configPath || initialContext.configPath || null;
  const runRootInfo = loadConfigContext({
    repoRoot: initialContext.repoRoot,
    configPath: requested,
    workspaceRoot: initialContext.workspaceRoot,
  });
  const availableWorkflows = listConfiguredWorkflows({
    repoRoot: initialContext.repoRoot,
    configPath: runRootInfo.configPath,
    workspaceRoot: runRootInfo.workspaceRoot,
  });
  const resolved = {
    repoRoot: initialContext.repoRoot,
    runRoot: runRootInfo.runRoot,
    workspaceRoot: runRootInfo.workspaceRoot,
    configPath: runRootInfo.configPath,
    configLabel: availableConfigs.find((item) => item.configPath === runRootInfo.configPath)?.label
      || path.basename(runRootInfo.configPath || "default"),
    availableConfigs,
    availableWorkflows,
  };
  viewerContextCache.set(cacheId, resolved);
  return resolved;
}
