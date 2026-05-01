export interface RunSummary {
  id: string;
  kind: string;
  format: "legacy" | "workflow-first";
  category: "build" | "run" | "unknown";
  workflowName: string | null;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
  changeName: string | null;
  stepCount: number;
}

export interface RunArtifactRef {
  path: string;
  location: string;
}

export interface RunGraphNode {
  id: string;
  name: string | null;
  kind: string | null;
  status: string;
  artifactCount: number;
  parameters?: string[];
}

export interface RunGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "sequence" | "artifact";
  label: string | null;
  artifactPath: string | null;
  inferred: boolean;
}

export interface RunStepSummary {
  id: string;
  name: string | null;
  kind: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  logUrl: string | null;
  artifactCount: number | null;
  artifacts?: RunArtifactRef[];
  parameters?: string[];
}

export interface RunDetail extends RunSummary {
  runDir: string | null;
  graph: {
    nodes: RunGraphNode[];
    edges: RunGraphEdge[];
  };
  steps: RunStepSummary[];
}

export interface RunsIndexPayload {
  runRoot: string;
  workspaceRoot: string;
  configPath: string | null;
  configLabel: string;
  availableConfigs: Array<{
    id: string;
    label: string;
    configPath: string | null;
    workspaceRoot: string;
    runRoot: string;
  }>;
  availableWorkflows: Array<{
    name: string;
    category: string;
  }>;
  updatedAt: string;
  runs: RunSummary[];
  totalRuns: number;
  offset: number;
  limit: number;
}
