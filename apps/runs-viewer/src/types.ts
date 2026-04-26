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

export interface RunStepSummary {
  id: string;
  name: string | null;
  status: string;
  logUrl: string | null;
  artifactCount: number | null;
  artifacts?: Array<{
    path: string;
    location: string;
  }>;
}

export interface RunDetail extends RunSummary {
  runDir: string | null;
  steps: RunStepSummary[];
}

export interface RunsIndexPayload {
  runRoot: string;
  updatedAt: string;
  runs: RunSummary[];
  totalRuns: number;
  offset: number;
  limit: number;
}
