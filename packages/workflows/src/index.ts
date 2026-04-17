import type { CatalogEntry } from "@ossr/core";

export const workflowCatalog: CatalogEntry[] = [
  {
    name: "kernel-callgraph",
    summary: "Compile a kernel to LLVM bitcode with llbic, then generate a scoped callgraph with llcg.",
    path: "workflows/kernel-callgraph",
    kind: "workflow"
  }
];
