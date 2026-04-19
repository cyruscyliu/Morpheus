# kernel-callgraph

Draft NS3L workflow composed from:

1. `llbase` for the runtime/toolchain image
2. `llbic` to compile a selected Linux kernel into LLVM bitcode artifacts
3. `llcg` to resolve indirect calls and generate final callgraph artifacts

This workflow will become the first-class `morpheus workflow run kernel-callgraph` implementation.
