import path from "node:path";

import {
  discoverViewerConfigs,
  findRunRootForConfig,
  listConfiguredWorkflows,
  type ViewerConfigOption,
  type ViewerWorkflowOption,
} from "./run-root";

export interface ViewerContext {
  repoRoot: string;
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
  configLabel: string;
  availableConfigs: ViewerConfigOption[];
  availableWorkflows: ViewerWorkflowOption[];
}

export function resolveViewerContext(selectedConfigPath?: string | null): ViewerContext {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const availableConfigs = discoverViewerConfigs({ startDir: process.cwd(), repoRoot });
  const requested = selectedConfigPath
    ? availableConfigs.find((item) => item.configPath === selectedConfigPath)?.configPath || selectedConfigPath
    : availableConfigs[0]?.configPath || null;
  const runRootInfo = findRunRootForConfig({ startDir: process.cwd(), repoRoot, configPath: requested });
  const availableWorkflows = listConfiguredWorkflows({
    startDir: process.cwd(),
    configPath: runRootInfo.configPath,
  });
  return {
    repoRoot,
    runRoot: runRootInfo.runRoot,
    workspaceRoot: runRootInfo.workspaceRoot,
    configPath: runRootInfo.configPath,
    configLabel: runRootInfo.label,
    availableConfigs,
    availableWorkflows,
  };
}
