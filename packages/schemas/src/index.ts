export interface ToolManifest {
  name: string;
  kind: "tool";
  summary: string;
  repoPath: string;
  outputs?: string[];
}

export interface WorkflowManifest {
  name: string;
  kind: "workflow";
  summary: string;
  uses: string[];
}
