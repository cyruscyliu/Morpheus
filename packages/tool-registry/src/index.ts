import type { CatalogEntry } from "@ossr/core";

export const toolCatalog: CatalogEntry[] = [
  {
    name: "llbase",
    summary: "Shared container/runtime images for the LLVM Linux tooling family.",
    path: "tools/llbase",
    kind: "tool"
  },
  {
    name: "llbic",
    summary: "Compile Linux kernels to LLVM bitcode and kernel images.",
    path: "tools/llbic",
    kind: "tool"
  },
  {
    name: "llcg",
    summary: "Generate Linux kernel callgraphs from LLVM bitcode inputs.",
    path: "tools/llcg",
    kind: "tool"
  }
];
