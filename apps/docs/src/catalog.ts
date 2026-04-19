export type CatalogKind = "tool" | "workflow";

export interface CatalogEntry {
  name: string;
  kind: CatalogKind;
  path: string;
  summary: string;
  description: string;
  highlights: string[];
  commands: string[];
}

const CATALOG: CatalogEntry[] = [
  {
    name: "llbase",
    kind: "tool",
    path: "tools/llbase",
    summary: "Shared container/runtime images for the LLVM Linux tooling family.",
    description:
      "Reusable Docker runtime images that provide the LLVM and Linux build environment shared by the ll* toolchain projects.",
    highlights: [
      "Publishes latest, mid, and legacy image families",
      "Keeps shared runtime concerns in one place",
      "Provides the base execution layer for sibling tools",
    ],
    commands: [
      "docker compose build llbase",
      "docker compose build llbase-mid",
      "docker compose build llbase-legacy",
    ],
  },
  {
    name: "llbic",
    kind: "tool",
    path: "tools/llbic",
    summary: "Compile Linux kernels to LLVM bitcode and kernel images.",
    description:
      "Kernel build automation for researchers who need reproducible LLVM bitcode, manifests, and output artifacts instead of ad hoc scripts.",
    highlights: [
      "Builds selected Linux kernels into LLVM bitcode artifacts",
      "Emits stable machine-readable manifests for automation",
      "Supports Rust-enabled kernel families where published toolchains exist",
    ],
    commands: [
      "./llbic build 6.18.16 --out-of-tree --json",
      "./llbic inspect out/linux-6.18.16-x86_64-clang18/llbic.json --json",
    ],
  },
  {
    name: "llcg",
    kind: "tool",
    path: "tools/llcg",
    summary: "Generate Linux kernel callgraphs from LLVM bitcode inputs.",
    description:
      "Callgraph generation and scoping tooling for turning LLVM bitcode lists into reproducible graph artifacts with indirect-call resolution.",
    highlights: [
      "Runs KallGraph and llvm-cg over LLVM bitcode lists",
      "Supports interface and file-scoped mutator generation",
      "Produces final callgraph and collapsed grouped views",
    ],
    commands: [
      "./bin/llcg genmutator interfaces --source-dir /path/to/linux --interfaces networking,storage --output ./out --json",
      "./bin/llcg run --clang 15 --llbic-json ../llbic/out/linux-6.18.16-x86_64-clang15/llbic.json --all-bc-list ../llbic/out/linux-6.18.16-x86_64-clang15/bitcode_files.txt --output ./out --json",
    ],
  },
  {
    name: "kernel-callgraph",
    kind: "workflow",
    path: "workflows/kernel-callgraph",
    summary: "Compile a kernel to LLVM bitcode with llbic, then generate a scoped callgraph with llcg.",
    description:
      "A draft Morpheus workflow that composes llbase, llbic, and llcg into one reproducible path from kernel source selection to final callgraph artifacts.",
    highlights: [
      "Uses llbase as the runtime and toolchain layer",
      "Builds LLVM bitcode artifacts with llbic",
      "Generates final callgraph artifacts with llcg",
    ],
    commands: ["morpheus workflow run kernel-callgraph"],
  },
];

export function getCatalog(): CatalogEntry[] {
  return [...CATALOG];
}
