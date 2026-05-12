import path from "node:path";

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

export function resolveViewerContext(selectedConfigPath?: string | null): ViewerContext {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const bootstrapContext = {
    repoRoot,
    configPath: selectedConfigPath || null,
    workspaceRoot: process.cwd(),
  };
  const initialConfigInfo = loadConfigContext(bootstrapContext);
  const initialContext = {
    repoRoot,
    configPath: initialConfigInfo.configPath,
    workspaceRoot: initialConfigInfo.workspaceRoot,
  };
  const availableConfigs = listViewerConfigs(initialContext);
  const requested = selectedConfigPath
    ? availableConfigs.find((item) => item.configPath === selectedConfigPath)?.configPath || selectedConfigPath
    : availableConfigs[0]?.configPath || initialConfigInfo.configPath || null;
  const runRootInfo = loadConfigContext({
    repoRoot,
    configPath: requested,
    workspaceRoot: initialContext.workspaceRoot,
  });
  const availableWorkflows = listConfiguredWorkflows({
    repoRoot,
    configPath: runRootInfo.configPath,
    workspaceRoot: runRootInfo.workspaceRoot,
  });
  return {
    repoRoot,
    runRoot: runRootInfo.runRoot,
    workspaceRoot: runRootInfo.workspaceRoot,
    configPath: runRootInfo.configPath,
    configLabel: availableConfigs.find((item) => item.configPath === runRootInfo.configPath)?.label
      || path.basename(runRootInfo.configPath || "default"),
    availableConfigs,
    availableWorkflows,
  };
}
