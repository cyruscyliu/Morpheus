import type { CatalogEntry } from "@morpheus/core";

export const workflowCatalog: CatalogEntry[] = [
  {
    name: "kernel-callgraph",
    summary: "Compile a kernel to LLVM bitcode with llbic, then generate a scoped callgraph with llcg.",
    path: "workflows/kernel-callgraph",
    kind: "workflow"
  }
];
