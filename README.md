# OSSR

OSSR is a TypeScript-rooted monorepo for composable systems-research tools and workflows.

## Layout

- `apps/cli`: future `ossr` command line entrypoint
- `apps/web`: initial docs/site app derived from `ossr-release`
- `packages/core`: shared runtime types and helpers
- `packages/schemas`: stable tool/workflow/artifact schemas
- `packages/workflows`: workflow composition layer
- `packages/tool-registry`: metadata and discovery for embedded tools
- `tools/llbase`: shared container/runtime images for the LLVM Linux tooling family
- `tools/llbic`: kernel-to-LLVM bitcode build CLI
- `tools/llcg`: Linux kernel callgraph generation CLI

## Monorepo Model

OSSR distinguishes between:

- `tool`: one atomic executable capability
- `workflow`: a reusable composition of tools

The initial embedded tools are imported from sibling repositories so they can be consolidated here later without preserving nested Git history.

## Next Steps

1. Implement `apps/cli` as the canonical `ossr tool` / `ossr workflow` entrypoint.
2. Wrap `tools/llbase`, `tools/llbic`, and `tools/llcg` with shared metadata under `packages/tool-registry`.
3. Fold the current website in `apps/web` into the future OSSR docs and catalog UI.
