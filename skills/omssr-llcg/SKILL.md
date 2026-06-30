---
name: llcg
description: Generate Linux kernel callgraphs from LLVM bitcode, create or inspect mutators, run scoped analyses from build artifacts, and validate callgraph outputs. Use when the user wants a callgraph, scope a graph to files or interfaces, or inspect callgraph pipeline results.
license: MIT
compatibility: Designed for Claude Code (or similar products)
---

# llcg Skill

Use this skill when you need to generate Linux kernel callgraphs with the
`llcg` tool from LLVM bitcode lists, optionally narrow the scope
with reusable mutators, and inspect the resulting run manifest and graph
artifacts.

When the task goes through Morpheus-managed tooling, treat `llcg` as a
scripted managed tool. Use `morpheus build --tool llcg ...` to build the
native llcg components, and `morpheus exec --tool llcg ...` for mutator
generation or callgraph runs.

## What The Tool Does

- `KallGraph` resolves indirect calls from a selected bitcode set.
- `llvm-cg` generates one raw DOT callgraph from the direct plus resolved
  indirect edges.
- Python mutators handle graph-side post-processing such as blocklist pruning,
  extra-edge injection, reachability pruning, and grouped rendering for the
  raw llcg output.

The main user-facing commands are:

```text
tools/llcg/llcg genmutator interfaces
tools/llcg/llcg genmutator files
tools/llcg/llcg run
tools/llcg/llcg inspect <manifest.json>
```

## When To Use Which Command

- Use `genmutator interfaces` when the scope should come from interface presets
  and associated group metadata.
- Use `genmutator files` when the scope should come from an explicit list of
  kernel source files.
- Use `run --bitcode-list ...` for direct runs on an existing bitcode list.
- Use `run --filter ...` with a generated mutator when the run should first
  reduce the bitcode scope and then apply post-mutators automatically.
- Use `inspect` to summarize a previous run manifest or mutator manifest
  without rerunning analysis.

## Agent Workflow

1. Ask the CLI for the current surface first:

   ```bash
   tools/llcg/llcg --help
   tools/llcg/llcg run --help
   ```

2. Prefer `--json` whenever you plan to consume output programmatically.

3. For a scoped run, generate the mutator first:

   ```bash
   tools/llcg/llcg genmutator files \
     --source-dir /path/to/linux \
     --file drivers/virtio/virtio_mmio.c \
     --file drivers/net/virtio_net.c \
     --scope-name virtio-mmio-net \
     --output ./out \
     --json
   ```

   Morpheus-managed equivalent:

   ```bash
   ./bin/morpheus exec --tool llcg \
     --generator files \
     --source-dir /path/to/linux \
     --file drivers/virtio/virtio_mmio.c \
     --file drivers/net/virtio_net.c \
     --scope-name virtio-mmio-net \
     --json
   ```

4. Run the pipeline:

   ```bash
   tools/llcg/llcg run \
     --clang 15 \
     --llbic-json /path/to/llbic.json \
     --all-bc-list /path/to/bitcode_files.txt \
     --filter ./out/virtio-mmio-net-mutator-6.18.16-arm64.json \
     --output ./out \
     --json
   ```

   Morpheus-managed equivalent:

   ```bash
   ./bin/morpheus exec --tool llcg \
     --clang 15 \
     --llbic-json /path/to/llbic.json \
     --all-bc-list /path/to/bitcode_files.txt \
     --filter ./out/virtio-mmio-net-mutator-6.18.16-arm64.json \
     --json
   ```

5. Inspect the emitted manifest instead of reconstructing artifact paths by
   hand:

   ```bash
   tools/llcg/llcg inspect ./out/llcg-manifest.json --json
   ```

## Important Conventions

- Public user terminology is `mutator`, even though the `run` flag remains
  `--filter`.
- `llvm-cg` should be treated as raw callgraph generation only.
- `llcg` should be treated as raw callgraph production plus scope metadata.
- Higher-level graph composition, collapse, and display optimization belong in
  downstream tools such as `driver-callgraph`, not in `llcg`.
- Output naming now prefers a short stem:
  `<scope>_<kernel>_<arch>`.

Typical run artifacts are:

- `<stem>_kallgraph.txt`
- `<stem>_cg_raw.dot`
- `<stem>_cg.dot`
- `<stem>_callgraph.log`
- `llcg-manifest.json`

## Build Notes

- Managed `build` configures and builds the native components for the selected
  `--clang` version.
- Managed `exec` generates mutators when `--generator` is present.
- Managed `exec` runs the callgraph pipeline when callgraph inputs such as
  `--llbic-json`, `--all-bc-list`, and `--filter` are present.
- The docker backend is selected with `--backend docker` or
  `KERNEL_CALLGRAPH_BACKEND=docker`.
- Docker execution reuses an existing compatible `llbic` image and mounts
  external input paths automatically.

## Validation

When changing the Python wrapper or mutator code, validate with:

```bash
python3 -m py_compile kernel-callgraph mutators/*.py
```

When changing the native pipeline, rerun a real scoped example and inspect the
resulting manifest.
